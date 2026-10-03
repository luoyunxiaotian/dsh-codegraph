import Parser from 'web-tree-sitter';
import {
  CodeNode,
  CodeEdge,
  EntityType,
  SemanticRole,
  LanguageExtractor,
  ExtractedFileResult,
  FileImportInfo,
  UnresolvedCall,
  UnresolvedInheritance,
} from '../../types/index.js';
import {
  formatNodeId,
  formatQualifiedName,
  formatScipUri,
  normalizeRoutePattern,
} from '../scip-utils.js';

export class JavaExtractor implements LanguageExtractor {
  public readonly language = 'java';
  public readonly fileExtensions = ['.java'];
  public readonly wasmGrammarName = 'java';

  public extractFile(
    tree: Parser.Tree,
    filePath: string,
    sourceCode: string
  ): ExtractedFileResult {
    return extractJavaFile(tree, filePath, sourceCode);
  }
}

/**
 * 深度解析 Java 源码文件，提取 Package、Class、Interface、Method、Spring Boot 路由与 RestTemplate/WebClient 调用
 */
export function extractJavaFile(
  tree: Parser.Tree,
  filePath: string,
  sourceCode: string
): ExtractedFileResult {
  const nodes: CodeNode[] = [];
  const edges: CodeEdge[] = [];
  const imports: FileImportInfo[] = [];
  const unresolvedCalls: UnresolvedCall[] = [];
  const unresolvedInheritance: UnresolvedInheritance[] = [];

  let packageName = '';

  // 1. 创建文件节点
  const fileNodeId = formatNodeId(filePath, 'file');
  const fileName = filePath.split(/[/\\]/).pop() || filePath;
  const fileScip = formatScipUri('java', filePath, '', fileName, 'def');

  nodes.push({
    id: fileNodeId,
    name: fileName,
    qualifiedName: formatQualifiedName(filePath, 'file'),
    entityType: 'FILE',
    semanticRole: 'UNKNOWN',
    filePath,
    language: 'java',
    scipUri: fileScip,
    loc: {
      startLine: tree.rootNode.startPosition.row + 1,
      endLine: tree.rootNode.endPosition.row + 1,
    },
  });

  const contextStack: CodeNode[] = [];

  function getCurrentCaller(): CodeNode | undefined {
    for (let i = contextStack.length - 1; i >= 0; i--) {
      const n = contextStack[i];
      if (
        n.entityType === 'FUNCTION' ||
        n.entityType === 'METHOD' ||
        n.entityType === 'ENDPOINT'
      ) {
        return n;
      }
    }
    return undefined;
  }

  // 提取节点修饰符列表中的注解文本
  function extractAnnotations(modifiersNode?: Parser.SyntaxNode): string[] {
    if (!modifiersNode) return [];
    const annotations: string[] = [];
    for (let i = 0; i < modifiersNode.namedChildCount; i++) {
      const child = modifiersNode.namedChild(i);
      if (child && (child.type === 'marker_annotation' || child.type === 'annotation')) {
        annotations.push(child.text);
      }
    }
    return annotations;
  }

  // 从 Spring 注解解析路由前缀
  function parseSpringRoute(annotations: string[]): {
    isEndpoint: boolean;
    method?: string;
    routePath?: string;
  } {
    for (const ann of annotations) {
      const mMatch = ann.match(/@(Get|Post|Put|Delete|Patch)Mapping\s*(?:\(\s*(?:(?:value|path)\s*=\s*)?["']([^"']*)["']\s*\))?/i);
      if (mMatch) {
        return {
          isEndpoint: true,
          method: mMatch[1].toUpperCase(),
          routePath: mMatch[2] || '',
        };
      }

      const reqMatch = ann.match(/@RequestMapping\s*(?:\(\s*(?:(?:value|path)\s*=\s*)?["']([^"']*)["'](?:[^)]*method\s*=\s*RequestMethod\.([A-Z]+))?\s*\))?/i);
      if (reqMatch) {
        return {
          isEndpoint: true,
          method: reqMatch[2] ? reqMatch[2].toUpperCase() : 'GET',
          routePath: reqMatch[1] || '',
        };
      }
    }
    return { isEndpoint: false };
  }

  function traverse(cursorNode: Parser.SyntaxNode) {
    const nodeType = cursorNode.type;

    // 1. package 声明
    if (nodeType === 'package_declaration') {
      const pkgIdent = cursorNode.namedChildren.find((c) => c.type === 'scoped_identifier' || c.type === 'identifier');
      if (pkgIdent) {
        packageName = pkgIdent.text;
      }
      return;
    }

    // 2. import 声明
    if (nodeType === 'import_declaration') {
      const line = cursorNode.startPosition.row + 1;
      const ident = cursorNode.namedChildren.find((c) => c.type === 'scoped_identifier' || c.type === 'identifier');
      if (ident) {
        const fullImp = ident.text;
        const shortName = fullImp.split('.').pop() || fullImp;
        imports.push({
          modulePath: fullImp,
          importedNames: [{ name: shortName }],
          isFromImport: true,
          line,
        });
      }
      return;
    }

    // 3. class 声明
    if (nodeType === 'class_declaration') {
      const nameNode = cursorNode.childForFieldName('name');
      const className = nameNode ? nameNode.text : 'AnonymousClass';
      const modifiers = cursorNode.childForFieldName('modifiers');
      const annotations = extractAnnotations(modifiers || undefined);

      let classRoutePrefix = '';
      let isController = false;
      let isService = false;
      let isRepo = false;

      for (const ann of annotations) {
        if (/@(RestController|Controller)\b/i.test(ann)) isController = true;
        if (/@Service\b/i.test(ann)) isService = true;
        if (/@(Repository|Mapper)\b/i.test(ann)) isRepo = true;

        const reqMatch = ann.match(/@RequestMapping\s*(?:\(\s*(?:(?:value|path)\s*=\s*)?["']([^"']*)["']\s*\))?/i);
        if (reqMatch) {
          classRoutePrefix = reqMatch[1] || '';
        }
      }

      const semanticRole: SemanticRole = isController
        ? 'ENTRY'
        : isService
        ? 'SERVICE'
        : isRepo
        ? 'REPOSITORY'
        : 'UNKNOWN';

      const nodeId = formatNodeId(filePath, className);
      const qName = packageName ? `${packageName}.${className}` : className;
      const scipUri = formatScipUri('java', filePath, packageName, className, 'class');

      const classNode: CodeNode = {
        id: nodeId,
        name: className,
        qualifiedName: qName,
        entityType: 'CLASS',
        semanticRole,
        filePath,
        language: 'java',
        scipUri,
        loc: {
          startLine: cursorNode.startPosition.row + 1,
          endLine: cursorNode.endPosition.row + 1,
        },
        metadata: { annotations, classRoutePrefix },
      };
      nodes.push(classNode);

      edges.push({
        id: `contains_${fileNodeId}_${nodeId}`,
        source: fileNodeId,
        target: nodeId,
        relation: 'CONTAINS',
        confidence: 'EXTRACTED',
      });

      // 提取继承与接口实现
      const superclassNode = cursorNode.childForFieldName('superclass');
      if (superclassNode) {
        const typeNode = superclassNode.namedChildren.find((c) => c.type === 'type_identifier');
        if (typeNode) {
          unresolvedInheritance.push({
            classNodeId: nodeId,
            superclassName: typeNode.text,
            line: typeNode.startPosition.row + 1,
          });
        }
      }

      const interfacesNode = cursorNode.childForFieldName('interfaces');
      if (interfacesNode) {
        const typeList = interfacesNode.namedChildren.find((c) => c.type === 'type_list');
        if (typeList) {
          for (let j = 0; j < typeList.namedChildCount; j++) {
            const iface = typeList.namedChild(j);
            if (iface) {
              unresolvedInheritance.push({
                classNodeId: nodeId,
                superclassName: iface.text,
                line: iface.startPosition.row + 1,
              });
            }
          }
        }
      }

      contextStack.push(classNode);
      const bodyNode = cursorNode.childForFieldName('body');
      if (bodyNode) {
        for (let i = 0; i < bodyNode.namedChildCount; i++) {
          const child = bodyNode.namedChild(i);
          if (child) traverse(child);
        }
      }
      contextStack.pop();
      return;
    }

    // 4. interface 声明
    if (nodeType === 'interface_declaration') {
      const nameNode = cursorNode.childForFieldName('name');
      const ifaceName = nameNode ? nameNode.text : 'AnonymousInterface';
      const nodeId = formatNodeId(filePath, ifaceName);
      const qName = packageName ? `${packageName}.${ifaceName}` : ifaceName;
      const scipUri = formatScipUri('java', filePath, packageName, ifaceName, 'interface');

      const ifaceNode: CodeNode = {
        id: nodeId,
        name: ifaceName,
        qualifiedName: qName,
        entityType: 'INTERFACE',
        semanticRole: 'MODEL',
        filePath,
        language: 'java',
        scipUri,
        loc: {
          startLine: cursorNode.startPosition.row + 1,
          endLine: cursorNode.endPosition.row + 1,
        },
      };
      nodes.push(ifaceNode);

      edges.push({
        id: `contains_${fileNodeId}_${nodeId}`,
        source: fileNodeId,
        target: nodeId,
        relation: 'CONTAINS',
        confidence: 'EXTRACTED',
      });
      return;
    }

    // 5. method 声明
    if (nodeType === 'method_declaration') {
      const nameNode = cursorNode.childForFieldName('name');
      const methodName = nameNode ? nameNode.text : 'anonymous_method';
      const parentContainer = contextStack[contextStack.length - 1] || nodes[0];
      const modifiers = cursorNode.childForFieldName('modifiers');
      const annotations = extractAnnotations(modifiers || undefined);

      const routeInfo = parseSpringRoute(annotations);
      const isEndpoint = routeInfo.isEndpoint;

      const nodeId = formatNodeId(filePath, `${parentContainer.name}_${methodName}`);
      const qName = `${parentContainer.qualifiedName}.${methodName}`;
      const scipUri = formatScipUri('java', filePath, `${packageName}#${parentContainer.name}`, methodName, 'method');

      const methodNode: CodeNode = {
        id: nodeId,
        name: methodName,
        qualifiedName: qName,
        entityType: isEndpoint ? 'ENDPOINT' : 'METHOD',
        semanticRole: isEndpoint ? 'ENTRY' : 'UNKNOWN',
        filePath,
        language: 'java',
        scipUri,
        loc: {
          startLine: cursorNode.startPosition.row + 1,
          endLine: cursorNode.endPosition.row + 1,
        },
      };

      if (isEndpoint && routeInfo.method) {
        const prefix = (parentContainer.metadata?.classRoutePrefix as string) || '';
        const fullRoute = normalizeRoutePattern(`${prefix}/${routeInfo.routePath || ''}`);
        methodNode.endpointMeta = {
          httpMethod: routeInfo.method,
          routePath: fullRoute,
          isClientCall: false,
        };
      }

      nodes.push(methodNode);
      edges.push({
        id: `contains_${parentContainer.id}_${nodeId}`,
        source: parentContainer.id,
        target: nodeId,
        relation: 'CONTAINS',
        confidence: 'EXTRACTED',
      });

      contextStack.push(methodNode);
      const bodyNode = cursorNode.childForFieldName('body');
      if (bodyNode) {
        for (let i = 0; i < bodyNode.namedChildCount; i++) {
          const child = bodyNode.namedChild(i);
          if (child) traverse(child);
        }
      }
      contextStack.pop();
      return;
    }

    // 6. 调用表达式 (method_invocation)
    if (nodeType === 'method_invocation') {
      const caller = getCurrentCaller() || nodes[0];
      const line = cursorNode.startPosition.row + 1;
      const nameNode = cursorNode.childForFieldName('name');
      const methodName = nameNode ? nameNode.text : cursorNode.text;

      let apiCallMeta: { httpMethod: string; routePattern: string } | undefined;

      // 提取 RestTemplate 调用: restTemplate.getForObject("/api/users", ...)
      const fullCallText = cursorNode.text;
      const rtMatch = fullCallText.match(/(?:restTemplate|webClient)\.(get|post|put|delete)/i);
      if (rtMatch) {
        const argsNode = cursorNode.childForFieldName('arguments');
        if (argsNode && argsNode.namedChildCount > 0) {
          const firstArg = argsNode.namedChild(0);
          if (firstArg && firstArg.type === 'string_literal') {
            const rawUrl = firstArg.text.replace(/^"|"$/g, '');
            const pathMatch = rawUrl.match(/^(?:https?:\/\/[^/]+)?(\/[^?#]*)/);
            if (pathMatch) {
              apiCallMeta = {
                httpMethod: rtMatch[1].toUpperCase(),
                routePattern: normalizeRoutePattern(pathMatch[1]),
              };
            }
          }
        }
      }

      unresolvedCalls.push({
        callerNodeId: caller.id,
        calleeExpression: methodName,
        line,
        apiCallMeta,
      });
    }

    // 默认遍历
    for (let i = 0; i < cursorNode.namedChildCount; i++) {
      const child = cursorNode.namedChild(i);
      if (child) traverse(child);
    }
  }

  traverse(tree.rootNode);

  return {
    filePath,
    language: 'java',
    nodes,
    edges,
    imports,
    unresolvedCalls,
    unresolvedInheritance,
  };
}
