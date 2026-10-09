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

export class KotlinExtractor implements LanguageExtractor {
  public readonly language = 'kotlin';
  public readonly fileExtensions = ['.kt', '.kts'];
  public readonly wasmGrammarName = 'kotlin';

  public extractFile(
    tree: Parser.Tree,
    filePath: string,
    sourceCode: string
  ): ExtractedFileResult {
    return extractKotlinFile(tree, filePath, sourceCode);
  }
}

/**
 * 深度解析 Kotlin 源码文件 (.kt / .kts)
 * 提取 Package、Import、Class/Interface/DataClass/Object、Function、Retrofit/Ktor 路由与客户端请求
 */
export function extractKotlinFile(
  tree: Parser.Tree,
  filePath: string,
  sourceCode: string
): ExtractedFileResult {
  const nodes: CodeNode[] = [];
  const edges: CodeEdge[] = [];
  const imports: FileImportInfo[] = [];
  const unresolvedCalls: UnresolvedCall[] = [];
  const unresolvedInheritance: UnresolvedInheritance[] = [];

  // 1. 创建文件节点
  const fileNodeId = formatNodeId(filePath, 'file');
  const fileName = filePath.split(/[/\\]/).pop() || filePath;
  const fileScip = formatScipUri('kotlin', filePath, '', fileName, 'def');

  const fileNode: CodeNode = {
    id: fileNodeId,
    name: fileName,
    qualifiedName: formatQualifiedName(filePath, 'file'),
    entityType: 'FILE',
    semanticRole: 'UNKNOWN',
    filePath,
    language: 'kotlin',
    scipUri: fileScip,
    loc: {
      startLine: tree.rootNode.startPosition.row + 1,
      endLine: tree.rootNode.endPosition.row + 1,
    },
  };
  nodes.push(fileNode);

  let currentPackage = '';
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

  function traverse(cursorNode: Parser.SyntaxNode) {
    const nodeType = cursorNode.type;

    // 2. 提取 package 包命名空间
    if (nodeType === 'package_header') {
      const idNode = cursorNode.childForFieldName('identifier') || cursorNode.namedChildren.find((c) => c.type === 'identifier');
      if (idNode) {
        currentPackage = idNode.text.trim();
      }
      return;
    }

    // 3. 提取 import 语句
    if (nodeType === 'import_header') {
      const idNode = cursorNode.childForFieldName('identifier') || cursorNode.namedChildren.find((c) => c.type === 'identifier');
      if (idNode) {
        const fullImport = idNode.text.trim();
        const parts = fullImport.split('.');
        const importedName = parts.pop() || fullImport;
        const modulePath = parts.join('.');

        imports.push({
          modulePath: modulePath || importedName,
          importedNames: [{ name: importedName }],
          isFromImport: true,
          line: cursorNode.startPosition.row + 1,
        });
      }
      return;
    }

    // 4. 提取 class / interface / data class / object 声明
    if (nodeType === 'class_declaration' || nodeType === 'object_declaration') {
      const nameNode = cursorNode.childForFieldName('name') || cursorNode.namedChildren.find((c) => c.type === 'type_identifier' || c.type === 'simple_identifier');
      const rawName = nameNode ? nameNode.text : 'AnonymousClass';
      const isInterface = cursorNode.text.startsWith('interface ') || cursorNode.children.some((c) => c.text === 'interface');

      const entityType: EntityType = isInterface ? 'INTERFACE' : 'CLASS';
      const qualified = currentPackage ? `${currentPackage}.${rawName}` : rawName;
      const nodeId = formatNodeId(filePath, rawName);
      const scipUri = formatScipUri('kotlin', filePath, currentPackage, rawName, isInterface ? 'interface' : 'class');

      const classNode: CodeNode = {
        id: nodeId,
        name: rawName,
        qualifiedName: formatQualifiedName(filePath, qualified),
        entityType,
        semanticRole: 'UNKNOWN',
        filePath,
        language: 'kotlin',
        scipUri,
        loc: {
          startLine: cursorNode.startPosition.row + 1,
          endLine: cursorNode.endPosition.row + 1,
        },
      };
      nodes.push(classNode);

      const parentContainer = contextStack[contextStack.length - 1] || fileNode;
      edges.push({
        id: `contains_${parentContainer.id}_${nodeId}`,
        source: parentContainer.id,
        target: nodeId,
        relation: 'CONTAINS',
        confidence: 'EXTRACTED',
      });

      // 提取父类或接口继承 (delegation_specifier / user_type)
      for (let i = 0; i < cursorNode.namedChildCount; i++) {
        const child = cursorNode.namedChild(i);
        if (child?.type === 'delegation_specifier' || child?.type === 'user_type') {
          const typeId = child.childForFieldName('type') || child.namedChildren.find((c) => c.type === 'type_identifier');
          const superName = typeId ? typeId.text : child.text.split('(')[0].trim();
          if (superName && superName !== rawName) {
            unresolvedInheritance.push({
              classNodeId: nodeId,
              superclassName: superName,
              line: child.startPosition.row + 1,
            });
          }
        }
      }

      // 遍历类体内容
      const bodyNode = cursorNode.childForFieldName('body') || cursorNode.namedChildren.find((c) => c.type === 'class_body');
      if (bodyNode) {
        contextStack.push(classNode);
        for (let i = 0; i < bodyNode.namedChildCount; i++) {
          const child = bodyNode.namedChild(i);
          if (child) traverse(child);
        }
        contextStack.pop();
      }
      return;
    }

    // 5. 提取函数与方法定义 (function_declaration)
    if (nodeType === 'function_declaration') {
      const nameNode = cursorNode.childForFieldName('name') || cursorNode.namedChildren.find((c) => c.type === 'simple_identifier');
      const funcName = nameNode ? nameNode.text : 'anonymous_func';
      const isInsideClass = contextStack.some((n) => n.entityType === 'CLASS' || n.entityType === 'INTERFACE');
      const parentContainer = contextStack[contextStack.length - 1] || fileNode;

      // 提取 Retrofit / Spring / Ktor 路由注解 (@GET("/path"), @PostMapping("..."))
      let httpMethod: string | undefined;
      let routePath: string | undefined;

      const modifiersNode = cursorNode.childForFieldName('modifiers') || cursorNode.namedChildren.find((c) => c.type === 'modifiers');
      if (modifiersNode) {
        const modText = modifiersNode.text;
        const retrofitMatch = modText.match(/@(GET|POST|PUT|DELETE|PATCH)\s*\(\s*["']([^"']*)["']\s*\)/i);
        if (retrofitMatch) {
          httpMethod = retrofitMatch[1].toUpperCase();
          routePath = retrofitMatch[2];
        } else {
          const springMatch = modText.match(/@(Get|Post|Put|Delete|Patch)Mapping\s*\(\s*(?:value\s*=\s*)?["']([^"']*)["']\s*\)/i);
          if (springMatch) {
            httpMethod = springMatch[1].toUpperCase();
            routePath = springMatch[2];
          }
        }
      }

      const isEntry = !!httpMethod || /^(main|onCreate|onStart|start)$/i.test(funcName);
      const entityType: EntityType = httpMethod ? 'ENDPOINT' : isInsideClass ? 'METHOD' : 'FUNCTION';
      const semanticRole: SemanticRole = isEntry ? 'ENTRY' : 'UNKNOWN';

      const nodeId = formatNodeId(filePath, isInsideClass ? `${parentContainer.name}_${funcName}` : funcName);
      const scipUri = formatScipUri(
        'kotlin',
        filePath,
        isInsideClass ? parentContainer.name : currentPackage,
        funcName,
        isInsideClass ? 'method' : 'def'
      );

      const funcNode: CodeNode = {
        id: nodeId,
        name: funcName,
        qualifiedName: formatQualifiedName(filePath, isInsideClass ? `${parentContainer.name}.${funcName}` : funcName),
        entityType,
        semanticRole,
        filePath,
        language: 'kotlin',
        scipUri,
        loc: {
          startLine: cursorNode.startPosition.row + 1,
          endLine: cursorNode.endPosition.row + 1,
        },
      };

      if (httpMethod && routePath) {
        funcNode.endpointMeta = {
          httpMethod,
          routePath: normalizeRoutePattern(routePath),
          isClientCall: false,
        };
      }

      nodes.push(funcNode);
      edges.push({
        id: `contains_${parentContainer.id}_${nodeId}`,
        source: parentContainer.id,
        target: nodeId,
        relation: 'CONTAINS',
        confidence: 'EXTRACTED',
      });

      // 遍历函数体内的语句与调用
      contextStack.push(funcNode);
      const bodyNode = cursorNode.childForFieldName('body') || cursorNode.namedChildren.find((c) => c.type === 'function_body');
      if (bodyNode) {
        for (let i = 0; i < bodyNode.namedChildCount; i++) {
          const child = bodyNode.namedChild(i);
          if (child) traverse(child);
        }
      }
      contextStack.pop();
      return;
    }

    // 6. 提取调用表达式 (call_expression)
    if (nodeType === 'call_expression') {
      const caller = getCurrentCaller() || fileNode;
      const line = cursorNode.startPosition.row + 1;
      const calleeText = cursorNode.text.split('(')[0].trim();

      if (calleeText) {
        // 识别 Ktor / OkHttp / Retrofit 客户端请求
        let apiCallMeta: { httpMethod: string; routePattern: string } | undefined;
        const clientMatch = calleeText.match(/(?:client|httpClient)\.(get|post|put|delete)/i);
        if (clientMatch) {
          const argsNode = cursorNode.childForFieldName('arguments') || cursorNode.namedChildren.find((c) => c.type === 'call_suffix');
          if (argsNode) {
            const urlMatch = argsNode.text.match(/["']([^"']+)["']/);
            if (urlMatch) {
              const url = urlMatch[1];
              const pathMatch = url.match(/^(?:https?:\/\/[^/]+)?(\/[^?#]*)/);
              apiCallMeta = {
                httpMethod: clientMatch[1].toUpperCase(),
                routePattern: normalizeRoutePattern(pathMatch ? pathMatch[1] : url),
              };
            }
          }
        }

        unresolvedCalls.push({
          callerNodeId: caller.id,
          calleeExpression: calleeText,
          line,
          apiCallMeta,
        });
      }
    }

    // 默认深度遍历
    for (let i = 0; i < cursorNode.namedChildCount; i++) {
      const child = cursorNode.namedChild(i);
      if (child) traverse(child);
    }
  }

  traverse(tree.rootNode);

  return {
    filePath,
    language: 'kotlin',
    nodes,
    edges,
    imports,
    unresolvedCalls,
    unresolvedInheritance,
  };
}
