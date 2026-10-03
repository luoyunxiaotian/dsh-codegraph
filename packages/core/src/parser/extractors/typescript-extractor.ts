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

export class TypeScriptExtractor implements LanguageExtractor {
  public readonly language = 'typescript';
  public readonly fileExtensions = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'];
  public readonly wasmGrammarName = 'typescript';

  public extractFile(
    tree: Parser.Tree,
    filePath: string,
    sourceCode: string
  ): ExtractedFileResult {
    return extractTypeScriptFile(tree, filePath, sourceCode);
  }
}

/**
 * 深度解析 TS / TSX / JS / JSX 源码文件，提取类、接口、函数、Express/Nest/Next 路由与前端客户端请求
 */
export function extractTypeScriptFile(
  tree: Parser.Tree,
  filePath: string,
  sourceCode: string
): ExtractedFileResult {
  const nodes: CodeNode[] = [];
  const edges: CodeEdge[] = [];
  const imports: FileImportInfo[] = [];
  const unresolvedCalls: UnresolvedCall[] = [];
  const unresolvedInheritance: UnresolvedInheritance[] = [];

  const lang = filePath.endsWith('.js') || filePath.endsWith('.jsx') || filePath.endsWith('.mjs') || filePath.endsWith('.cjs')
    ? 'javascript'
    : 'typescript';

  // 1. 文件节点
  const fileNodeId = formatNodeId(filePath, 'file');
  const fileName = filePath.split(/[/\\]/).pop() || filePath;
  const fileScip = formatScipUri(lang, filePath, '', fileName, 'def');

  nodes.push({
    id: fileNodeId,
    name: fileName,
    qualifiedName: formatQualifiedName(filePath, 'file'),
    entityType: 'FILE',
    semanticRole: 'UNKNOWN',
    filePath,
    language: lang,
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

  // 检查是否在 Next.js App Router 的 route.ts/js 中 (如 app/api/users/[id]/route.ts)
  function isNextJsRouteFile(pathStr: string): boolean {
    const norm = pathStr.replace(/\\/g, '/').toLowerCase();
    return (norm.includes('/app/') || norm.includes('/api/')) && /route\.[jt]sx?$/.test(norm);
  }

  function deriveNextJsRoutePath(pathStr: string): string {
    const norm = pathStr.replace(/\\/g, '/');
    const match = norm.match(/(?:app|pages\/api)(\/.*)\/route\.[jt]sx?$/);
    if (match) {
      let r = match[1];
      // [id] -> {param}
      r = r.replace(/\[([^\]]+)\]/g, '{$1}');
      return normalizeRoutePattern(r);
    }
    return '/api';
  }

  function traverse(cursorNode: Parser.SyntaxNode) {
    const nodeType = cursorNode.type;

    // 1. 提取 ES Module import 语句 (import { a } from './b')
    if (nodeType === 'import_statement') {
      const line = cursorNode.startPosition.row + 1;
      const sourceNode = cursorNode.childForFieldName('source');
      const modulePath = sourceNode ? sourceNode.text.replace(/^['"]|['"]$/g, '') : '';

      const importedNames: Array<{ name: string; alias?: string }> = [];
      const importClause = cursorNode.namedChildren.find((c) => c.type === 'import_clause');
      if (importClause) {
        for (let i = 0; i < importClause.namedChildCount; i++) {
          const child = importClause.namedChild(i);
          if (!child) continue;

          if (child.type === 'identifier') {
            // import React from 'react'
            importedNames.push({ name: child.text, alias: 'default' });
          } else if (child.type === 'named_imports') {
            for (let j = 0; j < child.namedChildCount; j++) {
              const specifier = child.namedChild(j);
              if (specifier?.type === 'import_specifier') {
                const nameNode = specifier.childForFieldName('name');
                const aliasNode = specifier.childForFieldName('alias');
                if (nameNode) {
                  importedNames.push({
                    name: nameNode.text,
                    alias: aliasNode ? aliasNode.text : undefined,
                  });
                }
              }
            }
          } else if (child.type === 'namespace_import') {
            const alias = child.namedChildren.find((c) => c.type === 'identifier')?.text;
            importedNames.push({ name: '*', alias });
          }
        }
      }

      if (modulePath) {
        imports.push({
          modulePath,
          importedNames,
          isFromImport: true,
          line,
        });
      }
    }

    // 2. 提取 CommonJS require (const a = require('./b'))
    if (nodeType === 'variable_declarator') {
      const init = cursorNode.childForFieldName('value');
      if (
        init &&
        init.type === 'call_expression' &&
        init.childForFieldName('function')?.text === 'require'
      ) {
        const args = init.childForFieldName('arguments');
        if (args && args.namedChildCount > 0) {
          const modArg = args.namedChild(0);
          if (modArg && modArg.type === 'string') {
            const modulePath = modArg.text.replace(/^['"]|['"]$/g, '');
            const nameNode = cursorNode.childForFieldName('name');
            const varName = nameNode ? nameNode.text : '';
            imports.push({
              modulePath,
              importedNames: [{ name: varName }],
              isFromImport: false,
              line: cursorNode.startPosition.row + 1,
            });
          }
        }
      }
    }

    // 3. 提取 class 声明
    if (nodeType === 'class_declaration' || nodeType === 'class') {
      const nameNode = cursorNode.childForFieldName('name');
      const className = nameNode ? nameNode.text : 'AnonymousClass';
      const nodeId = formatNodeId(filePath, className);
      const scipUri = formatScipUri(lang, filePath, '', className, 'class');

      // 提取装饰器 (NestJS @Controller)
      const decorators: string[] = [];
      let parentIter = cursorNode.parent;
      if (parentIter && parentIter.type === 'export_statement') {
        parentIter = parentIter.parent;
      }
      for (let i = 0; i < cursorNode.namedChildCount; i++) {
        const child = cursorNode.namedChild(i);
        if (child?.type === 'decorator') {
          decorators.push(child.text);
        }
      }

      let routePrefix = '';
      for (const dec of decorators) {
        const ctrlMatch = dec.match(/@Controller\s*\(\s*["']([^"']*)["']\s*\)/i);
        if (ctrlMatch) {
          routePrefix = ctrlMatch[1] || '';
        }
      }

      const classNode: CodeNode = {
        id: nodeId,
        name: className,
        qualifiedName: formatQualifiedName(filePath, className),
        entityType: 'CLASS',
        semanticRole: routePrefix ? 'ENTRY' : 'UNKNOWN',
        filePath,
        language: lang,
        scipUri,
        loc: {
          startLine: cursorNode.startPosition.row + 1,
          endLine: cursorNode.endPosition.row + 1,
        },
        metadata: { decorators, routePrefix },
      };
      nodes.push(classNode);

      // 文件包含类
      edges.push({
        id: `contains_${fileNodeId}_${nodeId}`,
        source: fileNodeId,
        target: nodeId,
        relation: 'CONTAINS',
        confidence: 'EXTRACTED',
      });

      // 提取继承与接口实现 (extends / implements)
      for (let i = 0; i < cursorNode.namedChildCount; i++) {
        const child = cursorNode.namedChild(i);
        if (child?.type === 'class_heritage') {
          for (let j = 0; j < child.namedChildCount; j++) {
            const h = child.namedChild(j);
            if (h && (h.type === 'extends_clause' || h.type === 'implements_clause')) {
              for (let k = 0; k < h.namedChildCount; k++) {
                const typeNode = h.namedChild(k);
                if (typeNode && typeNode.type !== 'extends' && typeNode.type !== 'implements') {
                  unresolvedInheritance.push({
                    classNodeId: nodeId,
                    superclassName: typeNode.text,
                    line: typeNode.startPosition.row + 1,
                  });
                }
              }
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

    // 4. 提取 interface 声明
    if (nodeType === 'interface_declaration') {
      const nameNode = cursorNode.childForFieldName('name');
      const ifaceName = nameNode ? nameNode.text : 'AnonymousInterface';
      const nodeId = formatNodeId(filePath, ifaceName);
      const scipUri = formatScipUri(lang, filePath, '', ifaceName, 'interface');

      const ifaceNode: CodeNode = {
        id: nodeId,
        name: ifaceName,
        qualifiedName: formatQualifiedName(filePath, ifaceName),
        entityType: 'INTERFACE',
        semanticRole: 'MODEL',
        filePath,
        language: lang,
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

    // 5. 提取方法定义 (method_definition inside class)
    if (nodeType === 'method_definition') {
      const nameNode = cursorNode.childForFieldName('name');
      const methodName = nameNode ? nameNode.text : 'anonymous_method';
      const parentContainer = contextStack[contextStack.length - 1] || nodes[0];

      // 提取装饰器 (NestJS @Get, @Post)
      const decorators: string[] = [];
      for (let i = 0; i < cursorNode.namedChildCount; i++) {
        const child = cursorNode.namedChild(i);
        if (child?.type === 'decorator') {
          decorators.push(child.text);
        }
      }

      let httpMethod: string | undefined;
      let subRoute: string | undefined;
      for (const dec of decorators) {
        const mMatch = dec.match(/@(Get|Post|Put|Delete|Patch|Options|Head)\s*(?:\(\s*["']?([^"']*)["']?\s*\))?/i);
        if (mMatch) {
          httpMethod = mMatch[1].toUpperCase();
          subRoute = mMatch[2] || '';
        }
      }

      const isEndpoint = !!httpMethod;
      const nodeId = formatNodeId(filePath, `${parentContainer.name}_${methodName}`);
      const scipUri = formatScipUri(lang, filePath, parentContainer.name, methodName, 'method');

      const methodNode: CodeNode = {
        id: nodeId,
        name: methodName,
        qualifiedName: formatQualifiedName(filePath, `${parentContainer.name}.${methodName}`),
        entityType: isEndpoint ? 'ENDPOINT' : 'METHOD',
        semanticRole: isEndpoint ? 'ENTRY' : 'UNKNOWN',
        filePath,
        language: lang,
        scipUri,
        loc: {
          startLine: cursorNode.startPosition.row + 1,
          endLine: cursorNode.endPosition.row + 1,
        },
      };

      if (isEndpoint && httpMethod) {
        const baseRoute = (parentContainer.metadata?.routePrefix as string) || '';
        const fullRoute = normalizeRoutePattern(`${baseRoute}/${subRoute || ''}`);
        methodNode.endpointMeta = {
          httpMethod,
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

    // 6. 提取顶层函数 (function_declaration) 与变量函数 (const x = () => {})
    let funcName: string | undefined;
    let funcBodyNode: Parser.SyntaxNode | null = null;
    let isNextJsExport = false;

    if (nodeType === 'function_declaration') {
      const nameNode = cursorNode.childForFieldName('name');
      funcName = nameNode ? nameNode.text : 'anonymous_func';
      funcBodyNode = cursorNode.childForFieldName('body');
    } else if (nodeType === 'variable_declarator') {
      const nameNode = cursorNode.childForFieldName('name');
      const valNode = cursorNode.childForFieldName('value');
      if (valNode && (valNode.type === 'arrow_function' || valNode.type === 'function_expression')) {
        funcName = nameNode ? nameNode.text : 'anonymous_arrow';
        funcBodyNode = valNode.childForFieldName('body');
      }
    }

    if (funcName && funcBodyNode) {
      // 检查 Next.js route.ts 中的 GET/POST/PUT/DELETE
      let endpointMeta: { httpMethod: string; routePath: string; isClientCall?: boolean } | undefined;
      const upperName = funcName.toUpperCase();
      if (
        isNextJsRouteFile(filePath) &&
        ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'].includes(upperName)
      ) {
        isNextJsExport = true;
        endpointMeta = {
          httpMethod: upperName,
          routePath: deriveNextJsRoutePath(filePath),
          isClientCall: false,
        };
      }

      const isEntry = isNextJsExport || /^(main|start|handler|run|bootstrap|init)$/i.test(funcName);
      const entityType: EntityType = endpointMeta ? 'ENDPOINT' : 'FUNCTION';
      const semanticRole: SemanticRole = isEntry ? 'ENTRY' : 'UNKNOWN';

      const nodeId = formatNodeId(filePath, funcName);
      const scipUri = formatScipUri(lang, filePath, '', funcName, 'def');

      const funcNode: CodeNode = {
        id: nodeId,
        name: funcName,
        qualifiedName: formatQualifiedName(filePath, funcName),
        entityType,
        semanticRole,
        filePath,
        language: lang,
        scipUri,
        loc: {
          startLine: cursorNode.startPosition.row + 1,
          endLine: cursorNode.endPosition.row + 1,
        },
        endpointMeta,
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
      for (let i = 0; i < funcBodyNode.namedChildCount; i++) {
        const child = funcBodyNode.namedChild(i);
        if (child) traverse(child);
      }
      contextStack.pop();
      return;
    }

    // 7. 提取调用表达式 (call_expression)
    // 包含 Express 路由定义、HTTP 客户端 (fetch/axios) 请求、以及普通调用
    if (nodeType === 'call_expression') {
      const fnNode = cursorNode.childForFieldName('function');
      const caller = getCurrentCaller() || nodes[0];
      const line = cursorNode.startPosition.row + 1;

      if (fnNode && caller) {
        const calleeText = fnNode.text;

        // 7.1 Express/Router 路由定义: app.get('/api/users', handler), router.post('/login', ...)
        const expressMatch = calleeText.match(/(?:app|router|server|api)\.(get|post|put|delete|patch)\b/i);
        if (expressMatch) {
          const argsNode = cursorNode.childForFieldName('arguments');
          if (argsNode && argsNode.namedChildCount > 0) {
            const firstArg = argsNode.namedChild(0);
            if (firstArg && (firstArg.type === 'string' || firstArg.type === 'template_string')) {
              const routeRaw = firstArg.text.replace(/^[`'"]|[`'"]$/g, '');
              const normRoute = normalizeRoutePattern(routeRaw);
              const httpMethod = expressMatch[1].toUpperCase();

              // 创建 Express 路由端点节点
              const endpointNodeId = formatNodeId(filePath, `route_${httpMethod}_${normRoute}`);
              const endpointNode: CodeNode = {
                id: endpointNodeId,
                name: `${httpMethod} ${normRoute}`,
                qualifiedName: formatQualifiedName(filePath, `route.${httpMethod}.${normRoute}`),
                entityType: 'ENDPOINT',
                semanticRole: 'ENTRY',
                filePath,
                language: lang,
                scipUri: formatScipUri(lang, filePath, '', `${httpMethod}_${normRoute}`, 'def'),
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

        // 7.2 客户端 API 请求调用 (fetch('/api/...'), axios.get('/api/...'), api.post('/...'))
        let apiCallMeta: { httpMethod: string; routePattern: string } | undefined;
        let topicMeta: { topicName: string; isPublish: boolean } | undefined;

        if (calleeText === 'fetch') {
          const argsNode = cursorNode.childForFieldName('arguments');
          if (argsNode && argsNode.namedChildCount > 0) {
            const firstArg = argsNode.namedChild(0);
            const urlRaw = firstArg?.text.replace(/^[`'"]|[`'"]$/g, '');
            if (urlRaw && urlRaw.includes('/')) {
              const pathPart = urlRaw.match(/^(?:https?:\/\/[^/]+)?(\/[^?#]*)/);
              if (pathPart) {
                // 检查第二个参数 options.method
                let httpMethod = 'GET';
                if (argsNode.namedChildCount > 1) {
                  const opts = argsNode.namedChild(1)?.text;
                  const mMatch = opts?.match(/method:\s*['"]([A-Z]+)['"]/i);
                  if (mMatch) httpMethod = mMatch[1].toUpperCase();
                }
                apiCallMeta = {
                  httpMethod,
                  routePattern: normalizeRoutePattern(pathPart[1]),
                };
              }
            }
          }
        } else {
          // axios.get, axios.post, api.get, client.post, http.get
          const clientMatch = calleeText.match(/(?:axios|api|client|request|http)\.(get|post|put|delete|patch)\b/i);
          if (clientMatch) {
            const argsNode = cursorNode.childForFieldName('arguments');
            if (argsNode && argsNode.namedChildCount > 0) {
              const firstArg = argsNode.namedChild(0);
              const urlRaw = firstArg?.text.replace(/^[`'"]|[`'"]$/g, '');
              if (urlRaw) {
                const pathPart = urlRaw.match(/^(?:https?:\/\/[^/]+)?(\/[^?#]*)/);
                if (pathPart) {
                  apiCallMeta = {
                    httpMethod: clientMatch[1].toUpperCase(),
                    routePattern: normalizeRoutePattern(pathPart[1]),
                  };
                }
              }
            }
          }
        }

        // 7.3 消息发布/事件监听 (socket.emit, eventEmitter.emit)
        if (/\.emit\b/.test(calleeText)) {
          const argsNode = cursorNode.childForFieldName('arguments');
          if (argsNode && argsNode.namedChildCount > 0) {
            const firstArg = argsNode.namedChild(0);
            if (firstArg && (firstArg.type === 'string' || firstArg.type === 'template_string')) {
              topicMeta = {
                topicName: firstArg.text.replace(/^[`'"]|[`'"]$/g, ''),
                isPublish: true,
              };
            }
          }
        }

        unresolvedCalls.push({
          callerNodeId: caller.id,
          calleeExpression: calleeText,
          line,
          apiCallMeta,
          topicMeta,
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
    language: lang,
    nodes,
    edges,
    imports,
    unresolvedCalls,
    unresolvedInheritance,
  };
}
