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

export class RustExtractor implements LanguageExtractor {
  public readonly language = 'rust';
  public readonly fileExtensions = ['.rs'];
  public readonly wasmGrammarName = 'rust';

  public extractFile(
    tree: Parser.Tree,
    filePath: string,
    sourceCode: string
  ): ExtractedFileResult {
    return extractRustFile(tree, filePath, sourceCode);
  }
}

/**
 * 深度解析 Rust 源码文件，提取 Struct、Trait、Impl 块、Function、Axum/Actix 路由与 Reqwest 客户端调用
 */
export function extractRustFile(
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
  const fileScip = formatScipUri('rust', filePath, '', fileName, 'def');

  nodes.push({
    id: fileNodeId,
    name: fileName,
    qualifiedName: formatQualifiedName(filePath, 'file'),
    entityType: 'FILE',
    semanticRole: 'UNKNOWN',
    filePath,
    language: 'rust',
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

    // 1. 提取 use 导入语句
    if (nodeType === 'use_declaration') {
      const line = cursorNode.startPosition.row + 1;
      const text = cursorNode.text.replace(/^use\s+|;$/g, '').trim();
      const parts = text.split('::');
      const lastPart = parts.pop() || text;
      const modPath = parts.join('/');
      imports.push({
        modulePath: modPath,
        importedNames: [{ name: lastPart }],
        isFromImport: true,
        line,
      });
      return;
    }

    // 2. 提取 struct 声明
    if (nodeType === 'struct_item') {
      const nameNode = cursorNode.childForFieldName('name');
      const structName = nameNode ? nameNode.text : 'AnonymousStruct';
      const nodeId = formatNodeId(filePath, structName);
      const scipUri = formatScipUri('rust', filePath, '', structName, 'class');

      const structNode: CodeNode = {
        id: nodeId,
        name: structName,
        qualifiedName: formatQualifiedName(filePath, structName),
        entityType: 'CLASS',
        semanticRole: 'UNKNOWN',
        filePath,
        language: 'rust',
        scipUri,
        loc: {
          startLine: cursorNode.startPosition.row + 1,
          endLine: cursorNode.endPosition.row + 1,
        },
      };
      nodes.push(structNode);

      edges.push({
        id: `contains_${fileNodeId}_${nodeId}`,
        source: fileNodeId,
        target: nodeId,
        relation: 'CONTAINS',
        confidence: 'EXTRACTED',
      });
      return;
    }

    // 3. 提取 trait 声明
    if (nodeType === 'trait_item') {
      const nameNode = cursorNode.childForFieldName('name');
      const traitName = nameNode ? nameNode.text : 'AnonymousTrait';
      const nodeId = formatNodeId(filePath, traitName);
      const scipUri = formatScipUri('rust', filePath, '', traitName, 'interface');

      const traitNode: CodeNode = {
        id: nodeId,
        name: traitName,
        qualifiedName: formatQualifiedName(filePath, traitName),
        entityType: 'INTERFACE',
        semanticRole: 'MODEL',
        filePath,
        language: 'rust',
        scipUri,
        loc: {
          startLine: cursorNode.startPosition.row + 1,
          endLine: cursorNode.endPosition.row + 1,
        },
      };
      nodes.push(traitNode);

      edges.push({
        id: `contains_${fileNodeId}_${nodeId}`,
        source: fileNodeId,
        target: nodeId,
        relation: 'CONTAINS',
        confidence: 'EXTRACTED',
      });
      return;
    }

    // 4. 提取 impl 块 (impl Struct or impl Trait for Struct)
    if (nodeType === 'impl_item') {
      const typeNode = cursorNode.childForFieldName('type');
      const traitNode = cursorNode.childForFieldName('trait');

      const typeName = typeNode ? typeNode.text : 'UnknownType';
      const traitName = traitNode ? traitNode.text : undefined;

      const structNodeId = formatNodeId(filePath, typeName);
      const parentContainer = nodes.find((n) => n.id === structNodeId) || nodes[0];

      // 若为 impl Trait for Struct，记录接口实现
      if (traitName) {
        unresolvedInheritance.push({
          classNodeId: structNodeId,
          superclassName: traitName,
          line: cursorNode.startPosition.row + 1,
        });
      }

      // 遍历 impl 块中的函数与方法
      const bodyNode = cursorNode.childForFieldName('body');
      if (bodyNode) {
        contextStack.push(parentContainer);
        for (let i = 0; i < bodyNode.namedChildCount; i++) {
          const child = bodyNode.namedChild(i);
          if (child) traverse(child);
        }
        contextStack.pop();
      }
      return;
    }

    // 5. 提取函数与方法定义 (function_item)
    if (nodeType === 'function_item') {
      const nameNode = cursorNode.childForFieldName('name');
      const funcName = nameNode ? nameNode.text : 'anonymous_func';
      const isInsideImpl = contextStack.some((n) => n.entityType === 'CLASS' || n.entityType === 'INTERFACE');
      const parentContainer = contextStack[contextStack.length - 1] || nodes[0];

      // 提取 Actix 宏属性 #[get("/api/users/{id}")]
      let httpMethod: string | undefined;
      let routePath: string | undefined;
      for (let i = 0; i < cursorNode.namedChildCount; i++) {
        const child = cursorNode.namedChild(i);
        if (child?.type === 'attribute_item') {
          const actixMatch = child.text.match(/#\[(get|post|put|delete|patch)\s*\(\s*["']([^"']*)["']\s*\)\]/i);
          if (actixMatch) {
            httpMethod = actixMatch[1].toUpperCase();
            routePath = actixMatch[2];
          }
        }
      }

      const isEntry = !!httpMethod || /^(main|start|run|serve)$/i.test(funcName);
      const entityType: EntityType = httpMethod ? 'ENDPOINT' : isInsideImpl ? 'METHOD' : 'FUNCTION';
      const semanticRole: SemanticRole = isEntry ? 'ENTRY' : 'UNKNOWN';

      const nodeId = formatNodeId(filePath, isInsideImpl ? `${parentContainer.name}_${funcName}` : funcName);
      const scipUri = formatScipUri(
        'rust',
        filePath,
        isInsideImpl ? parentContainer.name : '',
        funcName,
        isInsideImpl ? 'method' : 'def'
      );

      const funcNode: CodeNode = {
        id: nodeId,
        name: funcName,
        qualifiedName: formatQualifiedName(filePath, isInsideImpl ? `${parentContainer.name}.${funcName}` : funcName),
        entityType,
        semanticRole,
        filePath,
        language: 'rust',
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

    // 6. 提取调用表达式 (call_expression)
    // 包含 Axum 路由绑定 Router::new().route("/api/users", get(h)) 与 reqwest 客户端调用
    if (nodeType === 'call_expression') {
      const fnNode = cursorNode.childForFieldName('function');
      const caller = getCurrentCaller() || nodes[0];
      const line = cursorNode.startPosition.row + 1;

      if (fnNode && caller) {
        const calleeText = fnNode.text;

        // Axum route: .route("/api/users", get(handler))
        if (/\.route\b/.test(calleeText)) {
          const argsNode = cursorNode.childForFieldName('arguments');
          if (argsNode && argsNode.namedChildCount >= 2) {
            const firstArg = argsNode.namedChild(0);
            const secondArg = argsNode.namedChild(1);
            if (firstArg && firstArg.type === 'string_literal') {
              const routeRaw = firstArg.text.replace(/^"|"$/g, '');
              const normRoute = normalizeRoutePattern(routeRaw);
              let m = 'GET';
              if (secondArg) {
                const sText = secondArg.text;
                const mMatch = sText.match(/\b(get|post|put|delete|patch)\b/i);
                if (mMatch) m = mMatch[1].toUpperCase();
              }

              const endpointNodeId = formatNodeId(filePath, `route_${m}_${normRoute}`);
              const endpointNode: CodeNode = {
                id: endpointNodeId,
                name: `${m} ${normRoute}`,
                qualifiedName: formatQualifiedName(filePath, `route.${m}.${normRoute}`),
                entityType: 'ENDPOINT',
                semanticRole: 'ENTRY',
                filePath,
                language: 'rust',
                scipUri: formatScipUri('rust', filePath, '', `${m}_${normRoute}`, 'def'),
                loc: {
                  startLine: line,
                  endLine: cursorNode.endPosition.row + 1,
                },
                endpointMeta: {
                  httpMethod: m,
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

        // Reqwest 客户端: reqwest::get("..."), client.post("...")
        let apiCallMeta: { httpMethod: string; routePattern: string } | undefined;
        const reqwestMatch = calleeText.match(/(?:reqwest|client)\.(get|post|put|delete)/i);
        if (reqwestMatch) {
          const argsNode = cursorNode.childForFieldName('arguments');
          if (argsNode && argsNode.namedChildCount > 0) {
            const firstArg = argsNode.namedChild(0);
            if (firstArg && firstArg.type === 'string_literal') {
              const url = firstArg.text.replace(/^"|"$/g, '');
              const pathMatch = url.match(/^(?:https?:\/\/[^/]+)?(\/[^?#]*)/);
              if (pathMatch) {
                apiCallMeta = {
                  httpMethod: reqwestMatch[1].toUpperCase(),
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

    // 默认遍历
    for (let i = 0; i < cursorNode.namedChildCount; i++) {
      const child = cursorNode.namedChild(i);
      if (child) traverse(child);
    }
  }

  traverse(tree.rootNode);

  return {
    filePath,
    language: 'rust',
    nodes,
    edges,
    imports,
    unresolvedCalls,
    unresolvedInheritance,
  };
}
