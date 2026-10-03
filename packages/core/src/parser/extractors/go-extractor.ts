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

export class GoExtractor implements LanguageExtractor {
  public readonly language = 'go';
  public readonly fileExtensions = ['.go'];
  public readonly wasmGrammarName = 'go';

  public extractFile(
    tree: Parser.Tree,
    filePath: string,
    sourceCode: string
  ): ExtractedFileResult {
    return extractGoFile(tree, filePath, sourceCode);
  }
}

/**
 * 深度解析 Go 语言源码文件，提取 Package、Struct、Interface、Method、Gin/Echo 路由与 HTTP/gRPC 调用
 */
export function extractGoFile(
  tree: Parser.Tree,
  filePath: string,
  sourceCode: string
): ExtractedFileResult {
  const nodes: CodeNode[] = [];
  const edges: CodeEdge[] = [];
  const imports: FileImportInfo[] = [];
  const unresolvedCalls: UnresolvedCall[] = [];
  const unresolvedInheritance: UnresolvedInheritance[] = [];

  let packageName = 'main';

  // 1. 创建文件节点
  const fileNodeId = formatNodeId(filePath, 'file');
  const fileName = filePath.split(/[/\\]/).pop() || filePath;
  const fileScip = formatScipUri('go', filePath, '', fileName, 'def');

  nodes.push({
    id: fileNodeId,
    name: fileName,
    qualifiedName: formatQualifiedName(filePath, 'file'),
    entityType: 'FILE',
    semanticRole: 'UNKNOWN',
    filePath,
    language: 'go',
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

  function traverse(cursorNode: Parser.SyntaxNode) {
    const nodeType = cursorNode.type;

    // 1. 提取 package 名称
    if (nodeType === 'package_clause') {
      const pkgId = cursorNode.childForFieldName('package_name') || cursorNode.namedChild(0);
      if (pkgId) {
        packageName = pkgId.text;
      }
      return;
    }

    // 2. 提取 import 语句
    if (nodeType === 'import_declaration') {
      const line = cursorNode.startPosition.row + 1;
      for (let i = 0; i < cursorNode.namedChildCount; i++) {
        const spec = cursorNode.namedChild(i);
        if (spec && spec.type === 'import_spec') {
          const pathNode = spec.childForFieldName('path');
          const nameNode = spec.childForFieldName('name');
          if (pathNode) {
            const rawPath = pathNode.text.replace(/^"|"$/g, '');
            const alias = nameNode ? nameNode.text : undefined;
            const importedPkg = alias || rawPath.split('/').pop() || rawPath;
            imports.push({
              modulePath: rawPath,
              importedNames: [{ name: importedPkg, alias }],
              isFromImport: false,
              line,
            });
          }
        }
      }
      return;
    }

    // 3. 提取 type 声明 (struct 与 interface)
    if (nodeType === 'type_declaration') {
      for (let i = 0; i < cursorNode.namedChildCount; i++) {
        const typeSpec = cursorNode.namedChild(i);
        if (typeSpec && typeSpec.type === 'type_spec') {
          const nameNode = typeSpec.childForFieldName('name');
          const typeNode = typeSpec.childForFieldName('type');
          if (!nameNode || !typeNode) continue;

          const typeName = nameNode.text;
          const isInterface = typeNode.type === 'interface_type';
          const isStruct = typeNode.type === 'struct_type';

          const entityType: EntityType = isInterface ? 'INTERFACE' : 'CLASS';
          const semanticRole: SemanticRole = isInterface ? 'MODEL' : 'UNKNOWN';
          const nodeId = formatNodeId(filePath, typeName);
          const scipUri = formatScipUri('go', filePath, packageName, typeName, isInterface ? 'interface' : 'class');

          const typeCodeNode: CodeNode = {
            id: nodeId,
            name: typeName,
            qualifiedName: formatQualifiedName(filePath, `${packageName}.${typeName}`),
            entityType,
            semanticRole,
            filePath,
            language: 'go',
            scipUri,
            loc: {
              startLine: typeSpec.startPosition.row + 1,
              endLine: typeSpec.endPosition.row + 1,
            },
          };
          nodes.push(typeCodeNode);

          edges.push({
            id: `contains_${fileNodeId}_${nodeId}`,
            source: fileNodeId,
            target: nodeId,
            relation: 'CONTAINS',
            confidence: 'EXTRACTED',
          });

          // 如果 struct 嵌入了其他 struct (Go 组合继承)
          if (isStruct) {
            const fieldList = typeNode.childForFieldName('fields') || typeNode.namedChildren.find((c) => c.type === 'field_declaration_list');
            if (fieldList) {
              for (let j = 0; j < fieldList.namedChildCount; j++) {
                const fieldDecl = fieldList.namedChild(j);
                // 匿名嵌入字段
                if (fieldDecl && fieldDecl.namedChildCount === 1) {
                  const embeddedType = fieldDecl.namedChild(0);
                  if (embeddedType) {
                    unresolvedInheritance.push({
                      classNodeId: nodeId,
                      superclassName: embeddedType.text.replace(/^\*/, ''),
                      line: embeddedType.startPosition.row + 1,
                    });
                  }
                }
              }
            }
          }
        }
      }
      return;
    }

    // 4. 提取普通函数 (func Foo())
    if (nodeType === 'function_declaration') {
      const nameNode = cursorNode.childForFieldName('name');
      const funcName = nameNode ? nameNode.text : 'anonymous_func';
      const isEntry = /^(main|init|run|start|serve)$/i.test(funcName);
      const nodeId = formatNodeId(filePath, funcName);
      const scipUri = formatScipUri('go', filePath, packageName, funcName, 'def');

      const funcNode: CodeNode = {
        id: nodeId,
        name: funcName,
        qualifiedName: formatQualifiedName(filePath, `${packageName}.${funcName}`),
        entityType: 'FUNCTION',
        semanticRole: isEntry ? 'ENTRY' : 'UNKNOWN',
        filePath,
        language: 'go',
        scipUri,
        loc: {
          startLine: cursorNode.startPosition.row + 1,
          endLine: cursorNode.endPosition.row + 1,
        },
      };
      nodes.push(funcNode);

      edges.push({
        id: `contains_${fileNodeId}_${nodeId}`,
        source: fileNodeId,
        target: nodeId,
        relation: 'CONTAINS',
        confidence: 'EXTRACTED',
      });

      contextStack.push(funcNode);
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

    // 5. 提取带有 Receiver 的方法 (func (s *UserService) GetUser())
    if (nodeType === 'method_declaration') {
      const nameNode = cursorNode.childForFieldName('name');
      const methodName = nameNode ? nameNode.text : 'anonymous_method';
      const receiverNode = cursorNode.childForFieldName('receiver');

      let receiverTypeName = 'UnknownStruct';
      if (receiverNode) {
        // (s *UserService) 提取 UserService
        const rMatch = receiverNode.text.match(/\*?([a-zA-Z0-9_]+)\s*\)?$/);
        if (rMatch) receiverTypeName = rMatch[1];
      }

      const parentStructNodeId = formatNodeId(filePath, receiverTypeName);
      const parentContainer = nodes.find((n) => n.id === parentStructNodeId) || nodes[0];

      const nodeId = formatNodeId(filePath, `${receiverTypeName}_${methodName}`);
      const scipUri = formatScipUri('go', filePath, `${packageName}#${receiverTypeName}`, methodName, 'method');

      const methodNode: CodeNode = {
        id: nodeId,
        name: methodName,
        qualifiedName: formatQualifiedName(filePath, `${packageName}.${receiverTypeName}.${methodName}`),
        entityType: 'METHOD',
        semanticRole: 'UNKNOWN',
        filePath,
        language: 'go',
        scipUri,
        loc: {
          startLine: cursorNode.startPosition.row + 1,
          endLine: cursorNode.endPosition.row + 1,
        },
      };
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

    // 6. 提取调用表达式 (call_expression)
    // 涵盖 Gin/Echo/Chi 路由注册、HTTP Client 请求、普通函数调用
    if (nodeType === 'call_expression') {
      const fnNode = cursorNode.childForFieldName('function');
      const caller = getCurrentCaller() || nodes[0];
      const line = cursorNode.startPosition.row + 1;

      if (fnNode && caller) {
        const calleeText = fnNode.text;

        // 6.1 Gin/Echo/Chi 路由注册: r.GET("/api/users/:id", h), router.POST("/login", ...)
        const ginMatch = calleeText.match(/(?:r|router|e|app|group|api|v1|v2)\.(GET|POST|PUT|DELETE|PATCH|Any)\b/i);
        if (ginMatch) {
          const argsNode = cursorNode.childForFieldName('arguments');
          if (argsNode && argsNode.namedChildCount > 0) {
            const firstArg = argsNode.namedChild(0);
            if (firstArg && (firstArg.type === 'interpreted_string_literal' || firstArg.type === 'raw_string_literal')) {
              const routeRaw = firstArg.text.replace(/^["`]|["`]$/g, '');
              const normRoute = normalizeRoutePattern(routeRaw);
              const httpMethod = ginMatch[1].toUpperCase();

              const endpointNodeId = formatNodeId(filePath, `route_${httpMethod}_${normRoute}`);
              const endpointNode: CodeNode = {
                id: endpointNodeId,
                name: `${httpMethod} ${normRoute}`,
                qualifiedName: formatQualifiedName(filePath, `route.${httpMethod}.${normRoute}`),
                entityType: 'ENDPOINT',
                semanticRole: 'ENTRY',
                filePath,
                language: 'go',
                scipUri: formatScipUri('go', filePath, packageName, `${httpMethod}_${normRoute}`, 'def'),
                loc: {
                  startLine: line,
                  endLine: cursorNode.endPosition.row + 1,
                },
                endpointMeta: {
                  httpMethod,
                  routePath: normRoute,
                  isClientCall: false,
                },
              };
              nodes.push(endpointNode);
              edges.push({
                id: `contains_${fileNodeId}_${endpointNodeId}`,
                source: fileNodeId,
                target: endpointNodeId,
                relation: 'CONTAINS',
                confidence: 'EXTRACTED',
              });
            }
          }
        }

        // 6.2 客户端 HTTP 请求: http.Get("..."), http.Post("..."), client.Get("...")
        let apiCallMeta: { httpMethod: string; routePattern: string } | undefined;
        const httpCallMatch = calleeText.match(/(?:http|client)\.(Get|Post|Put|Delete)\b/i);
        if (httpCallMatch) {
          const argsNode = cursorNode.childForFieldName('arguments');
          if (argsNode && argsNode.namedChildCount > 0) {
            const firstArg = argsNode.namedChild(0);
            if (firstArg && (firstArg.type === 'interpreted_string_literal' || firstArg.type === 'raw_string_literal')) {
              const url = firstArg.text.replace(/^["`]|["`]$/g, '');
              const pathMatch = url.match(/^(?:https?:\/\/[^/]+)?(\/[^?#]*)/);
              if (pathMatch) {
                apiCallMeta = {
                  httpMethod: httpCallMatch[1].toUpperCase(),
                  routePattern: normalizeRoutePattern(pathMatch[1]),
                };
              }
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

    // 默认深度遍历子节点
    for (let i = 0; i < cursorNode.namedChildCount; i++) {
      const child = cursorNode.namedChild(i);
      if (child) traverse(child);
    }
  }

  traverse(tree.rootNode);

  return {
    filePath,
    language: 'go',
    nodes,
    edges,
    imports,
    unresolvedCalls,
    unresolvedInheritance,
  };
}
