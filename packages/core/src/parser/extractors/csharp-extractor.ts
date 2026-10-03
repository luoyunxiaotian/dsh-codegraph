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

export class CSharpExtractor implements LanguageExtractor {
  public readonly language = 'csharp';
  public readonly fileExtensions = ['.cs'];
  public readonly wasmGrammarName = 'c_sharp';

  public extractFile(
    tree: Parser.Tree,
    filePath: string,
    sourceCode: string
  ): ExtractedFileResult {
    return extractCSharpFile(tree, filePath, sourceCode);
  }
}

/**
 * 深度解析 C# 源码文件，提取 Namespace、Class、Interface、Method、ASP.NET Core 路由与 HttpClient 调用
 */
export function extractCSharpFile(
  tree: Parser.Tree,
  filePath: string,
  sourceCode: string
): ExtractedFileResult {
  const nodes: CodeNode[] = [];
  const edges: CodeEdge[] = [];
  const imports: FileImportInfo[] = [];
  const unresolvedCalls: UnresolvedCall[] = [];
  const unresolvedInheritance: UnresolvedInheritance[] = [];

  let currentNamespace = '';

  // 1. 创建文件节点
  const fileNodeId = formatNodeId(filePath, 'file');
  const fileName = filePath.split(/[/\\]/).pop() || filePath;
  const fileScip = formatScipUri('csharp', filePath, '', fileName, 'def');

  nodes.push({
    id: fileNodeId,
    name: fileName,
    qualifiedName: formatQualifiedName(filePath, 'file'),
    entityType: 'FILE',
    semanticRole: 'UNKNOWN',
    filePath,
    language: 'csharp',
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

  function extractAttributes(node: Parser.SyntaxNode): string[] {
    const attributes: string[] = [];
    for (let i = 0; i < node.namedChildCount; i++) {
      const child = node.namedChild(i);
      if (child && child.type === 'attribute_list') {
        attributes.push(child.text);
      }
    }
    return attributes;
  }

  function parseAspNetRoute(attributes: string[]): {
    isEndpoint: boolean;
    method?: string;
    routePath?: string;
  } {
    for (const attr of attributes) {
      const httpMatch = attr.match(/\[\s*Http(Get|Post|Put|Delete|Patch)\s*(?:\(\s*["']([^"']*)["']\s*\))?\s*\]/i);
      if (httpMatch) {
        return {
          isEndpoint: true,
          method: httpMatch[1].toUpperCase(),
          routePath: httpMatch[2] || '',
        };
      }
    }
    return { isEndpoint: false };
  }

  function traverse(cursorNode: Parser.SyntaxNode) {
    const nodeType = cursorNode.type;

    // 1. 命名空间声明
    if (nodeType === 'namespace_declaration' || nodeType === 'file_scoped_namespace_declaration') {
      const nameNode = cursorNode.childForFieldName('name');
      if (nameNode) {
        currentNamespace = nameNode.text;
      }
      if (nodeType === 'file_scoped_namespace_declaration') {
        // file_scoped_namespace_declaration 后面平铺，继续向下遍历
        return;
      }
    }

    // 2. using 指令
    if (nodeType === 'using_directive') {
      const line = cursorNode.startPosition.row + 1;
      const text = cursorNode.text.replace(/^using\s+|;$/g, '').trim();
      const lastPart = text.split('.').pop() || text;
      imports.push({
        modulePath: text,
        importedNames: [{ name: lastPart }],
        isFromImport: false,
        line,
      });
      return;
    }

    // 3. class 声明
    if (nodeType === 'class_declaration') {
      const nameNode = cursorNode.childForFieldName('name');
      const className = nameNode ? nameNode.text : 'AnonymousClass';
      const attributes = extractAttributes(cursorNode);

      let classRoutePrefix = '';
      let isApiController = false;
      for (const attr of attributes) {
        if (/\[\s*ApiController\s*\]/i.test(attr)) isApiController = true;
        const rMatch = attr.match(/\[\s*Route\s*\(\s*["']([^"']*)["']\s*\)\s*\]/i);
        if (rMatch) {
          classRoutePrefix = rMatch[1];
        }
      }

      // 替换 [controller] 占位符 (如 api/[controller] -> api/User)
      if (classRoutePrefix.includes('[controller]')) {
        const cleanCtrlName = className.replace(/Controller$/i, '');
        classRoutePrefix = classRoutePrefix.replace(/\[controller\]/gi, cleanCtrlName);
      }

      const nodeId = formatNodeId(filePath, className);
      const qName = currentNamespace ? `${currentNamespace}.${className}` : className;
      const scipUri = formatScipUri('csharp', filePath, currentNamespace, className, 'class');

      const classNode: CodeNode = {
        id: nodeId,
        name: className,
        qualifiedName: qName,
        entityType: 'CLASS',
        semanticRole: isApiController ? 'ENTRY' : 'UNKNOWN',
        filePath,
        language: 'csharp',
        scipUri,
        loc: {
          startLine: cursorNode.startPosition.row + 1,
          endLine: cursorNode.endPosition.row + 1,
        },
        metadata: { attributes, classRoutePrefix },
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
      const baseList = cursorNode.namedChildren.find((c) => c.type === 'base_list');
      if (baseList) {
        for (let j = 0; j < baseList.namedChildCount; j++) {
          const baseType = baseList.namedChild(j);
          if (baseType) {
            unresolvedInheritance.push({
              classNodeId: nodeId,
              superclassName: baseType.text,
              line: baseType.startPosition.row + 1,
            });
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
      const qName = currentNamespace ? `${currentNamespace}.${ifaceName}` : ifaceName;
      const scipUri = formatScipUri('csharp', filePath, currentNamespace, ifaceName, 'interface');

      const ifaceNode: CodeNode = {
        id: nodeId,
        name: ifaceName,
        qualifiedName: qName,
        entityType: 'INTERFACE',
        semanticRole: 'MODEL',
        filePath,
        language: 'csharp',
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
      const attributes = extractAttributes(cursorNode);

      const routeInfo = parseAspNetRoute(attributes);
      const isEndpoint = routeInfo.isEndpoint;

      const nodeId = formatNodeId(filePath, `${parentContainer.name}_${methodName}`);
      const qName = `${parentContainer.qualifiedName}.${methodName}`;
      const scipUri = formatScipUri('csharp', filePath, `${currentNamespace}#${parentContainer.name}`, methodName, 'method');

      const methodNode: CodeNode = {
        id: nodeId,
        name: methodName,
        qualifiedName: qName,
        entityType: isEndpoint ? 'ENDPOINT' : 'METHOD',
        semanticRole: isEndpoint ? 'ENTRY' : 'UNKNOWN',
        filePath,
        language: 'csharp',
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

    // 6. 调用表达式 (invocation_expression)
    if (nodeType === 'invocation_expression') {
      const caller = getCurrentCaller() || nodes[0];
      const line = cursorNode.startPosition.row + 1;
      const fullText = cursorNode.text;

      let apiCallMeta: { httpMethod: string; routePattern: string } | undefined;
      const httpMatch = fullText.match(/(?:httpClient|_httpClient)\.(Get|Post|Put|Delete)Async/i);
      if (httpMatch) {
        const argsNode = cursorNode.childForFieldName('arguments');
        if (argsNode && argsNode.namedChildCount > 0) {
          const firstArg = argsNode.namedChild(0);
          if (firstArg && firstArg.type === 'string_literal') {
            const rawUrl = firstArg.text.replace(/^"|"$/g, '');
            const pathMatch = rawUrl.match(/^(?:https?:\/\/[^/]+)?(\/[^?#]*)/);
            if (pathMatch) {
              apiCallMeta = {
                httpMethod: httpMatch[1].toUpperCase(),
                routePattern: normalizeRoutePattern(pathMatch[1]),
              };
            }
          }
        }
      }

      unresolvedCalls.push({
        callerNodeId: caller.id,
        calleeExpression: fullText.split('(')[0],
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
    language: 'csharp',
    nodes,
    edges,
    imports,
    unresolvedCalls,
    unresolvedInheritance,
  };
}
