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

export class LuaExtractor implements LanguageExtractor {
  public readonly language = 'lua';
  public readonly fileExtensions = ['.lua'];
  public readonly wasmGrammarName = 'lua';

  public extractFile(
    tree: Parser.Tree,
    filePath: string,
    sourceCode: string
  ): ExtractedFileResult {
    return extractLuaFile(tree, filePath, sourceCode);
  }
}

/**
 * 深度解析 Lua 源码文件 (.lua)
 * 提取 Table/Class、Function/Method、require 依赖模块、调用关系、面向对象元表继承及 API 请求
 */
export function extractLuaFile(
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
  const fileScip = formatScipUri('lua', filePath, '', fileName, 'def');

  const fileNode: CodeNode = {
    id: fileNodeId,
    name: fileName,
    qualifiedName: formatQualifiedName(filePath, 'file'),
    entityType: 'FILE',
    semanticRole: 'UNKNOWN',
    filePath,
    language: 'lua',
    scipUri: fileScip,
    loc: {
      startLine: tree.rootNode.startPosition.row + 1,
      endLine: tree.rootNode.endPosition.row + 1,
    },
  };
  nodes.push(fileNode);

  // 跟踪已声明的 Table / Class (如 Player, M, Config)
  const classMap = new Map<string, CodeNode>();

  function getOrCreateClassNode(className: string, line: number): CodeNode {
    let node = classMap.get(className);
    if (!node) {
      const classId = formatNodeId(filePath, className);
      node = {
        id: classId,
        name: className,
        qualifiedName: formatQualifiedName(filePath, className),
        entityType: 'CLASS',
        semanticRole: 'SERVICE',
        filePath,
        language: 'lua',
        scipUri: formatScipUri('lua', filePath, '', className, 'class'),
        loc: {
          startLine: line,
          endLine: line,
        },
      };
      nodes.push(node);
      classMap.set(className, node);

      // 连接文件到 Class
      edges.push({
        id: `contains_${fileNodeId}_${classId}`,
        source: fileNodeId,
        target: classId,
        relation: 'CONTAINS',
        confidence: 'EXTRACTED',
      });
    }
    return node;
  }

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

  function cleanString(str: string): string {
    return str.replace(/^["']|["']$/g, '').trim();
  }

  function traverse(cursorNode: Parser.SyntaxNode) {
    const nodeType = cursorNode.type;

    // 2. 检查 require 模块导入
    if (nodeType === 'call') {
      const callee = cursorNode.childForFieldName('called') || cursorNode.namedChildren[0];
      if (callee && callee.text === 'require') {
        const argsNode = cursorNode.namedChildren[1];
        if (argsNode) {
          let reqPath = '';
          const strNode = argsNode.type === 'string'
            ? argsNode
            : argsNode.namedChildren.find((c) => c.type === 'string' || (c.type === 'expression_list' && c.namedChildren[0]?.type === 'string'));
          
          if (strNode) {
            reqPath = cleanString(strNode.text);
          } else {
            const raw = argsNode.text.replace(/[()]/g, '');
            reqPath = cleanString(raw);
          }

          if (reqPath) {
            const modName = reqPath.split('.').pop() || reqPath;
            imports.push({
              modulePath: reqPath,
              importedNames: [{ name: modName }],
              line: cursorNode.startPosition.row + 1,
            });

            // 产生 IMPORTS 边
            const caller = getCurrentCaller() || fileNode;
            edges.push({
              id: `import_${caller.id}_${reqPath}`,
              source: caller.id,
              target: reqPath,
              relation: 'IMPORTS',
              confidence: 'EXTRACTED',
              sourceLine: cursorNode.startPosition.row + 1,
            });
          }
        }
      }
    }

    // 3. 检查 setmetatable OOP 类继承模式:
    // setmetatable(Player, { __index = Base }) 或 local Player = setmetatable({}, { __index = Base })
    if (nodeType === 'call') {
      const callee = cursorNode.namedChildren[0];
      if (callee && callee.text === 'setmetatable') {
        const argsNode = cursorNode.namedChildren[1];
        if (argsNode) {
          // 查找 __index = Base
          const argText = argsNode.text;
          const match = argText.match(/__index\s*=\s*([a-zA-Z0-9_]+)/);
          if (match) {
            const baseClass = match[1];
            // 查找派生类名称
            let subClassName = '';
            const parent = cursorNode.parent;
            if (parent && parent.type === 'local_variable_declaration') {
              const varList = parent.namedChildren.find((c) => c.type === 'variable_list');
              if (varList) subClassName = varList.text.trim();
            } else if (parent && parent.type === 'variable_assignment') {
              const varList = parent.namedChildren.find((c) => c.type === 'variable_list');
              if (varList) subClassName = varList.text.trim();
            }

            if (subClassName) {
              const subClassNode = getOrCreateClassNode(subClassName, cursorNode.startPosition.row + 1);
              unresolvedInheritance.push({
                classNodeId: subClassNode.id,
                superclassName: baseClass,
                line: cursorNode.startPosition.row + 1,
              });
            }
          }
        }
      }
    }

    // 4. 函数定义语句 (function Player:jump() / function Player.new() / function globalFn())
    if (nodeType === 'function_definition_statement') {
      const varNode = cursorNode.namedChildren[0];
      const paramsNode = cursorNode.namedChildren[1]?.type === 'parameter_list' ? cursorNode.namedChildren[1] : undefined;
      const blockNode = cursorNode.namedChildren.find((c) => c.type === 'block');

      if (varNode) {
        const fullFnName = varNode.text.trim();
        const line = cursorNode.startPosition.row + 1;
        const endLine = cursorNode.endPosition.row + 1;

        if (fullFnName.includes(':') || fullFnName.includes('.')) {
          // 属于 Table / Class 的方法或函数
          const isColon = fullFnName.includes(':');
          const delimiter = isColon ? ':' : '.';
          const parts = fullFnName.split(delimiter);
          const tblName = parts[0];
          const methodName = parts.slice(1).join(delimiter);

          const classNode = getOrCreateClassNode(tblName, line);
          const methodNodeId = formatNodeId(filePath, `${tblName}_${methodName}`);
          const methodNode: CodeNode = {
            id: methodNodeId,
            name: methodName,
            qualifiedName: formatQualifiedName(filePath, `${tblName}.${methodName}`),
            entityType: isColon ? 'METHOD' : 'FUNCTION',
            semanticRole: methodName === 'new' || methodName === 'init' ? 'SERVICE' : 'SERVICE',
            filePath,
            language: 'lua',
            scipUri: formatScipUri('lua', filePath, tblName, methodName, 'method'),
            signature: `function ${fullFnName}(${paramsNode ? paramsNode.text : ''})`,
            loc: { startLine: line, endLine },
          };
          nodes.push(methodNode);

          edges.push({
            id: `contains_${classNode.id}_${methodNodeId}`,
            source: classNode.id,
            target: methodNodeId,
            relation: 'CONTAINS',
            confidence: 'EXTRACTED',
          });

          contextStack.push(methodNode);
          if (blockNode) traverse(blockNode);
          contextStack.pop();
          return;
        } else {
          // 全局函数
          const fnNodeId = formatNodeId(filePath, fullFnName);
          const fnNode: CodeNode = {
            id: fnNodeId,
            name: fullFnName,
            qualifiedName: formatQualifiedName(filePath, fullFnName),
            entityType: 'FUNCTION',
            semanticRole: 'SERVICE',
            filePath,
            language: 'lua',
            scipUri: formatScipUri('lua', filePath, '', fullFnName, 'def'),
            signature: `function ${fullFnName}(${paramsNode ? paramsNode.text : ''})`,
            loc: { startLine: line, endLine },
          };
          nodes.push(fnNode);

          edges.push({
            id: `contains_${fileNodeId}_${fnNodeId}`,
            source: fileNodeId,
            target: fnNodeId,
            relation: 'CONTAINS',
            confidence: 'EXTRACTED',
          });

          contextStack.push(fnNode);
          if (blockNode) traverse(blockNode);
          contextStack.pop();
          return;
        }
      }
    }

    // 5. 本地函数定义 (local function helper())
    if (nodeType === 'local_function_definition_statement') {
      const idNode = cursorNode.namedChildren[0];
      const paramsNode = cursorNode.namedChildren[1]?.type === 'parameter_list' ? cursorNode.namedChildren[1] : undefined;
      const blockNode = cursorNode.namedChildren.find((c) => c.type === 'block');

      if (idNode) {
        const fnName = idNode.text.trim();
        const line = cursorNode.startPosition.row + 1;
        const endLine = cursorNode.endPosition.row + 1;

        const fnNodeId = formatNodeId(filePath, fnName);
        const fnNode: CodeNode = {
          id: fnNodeId,
          name: fnName,
          qualifiedName: formatQualifiedName(filePath, fnName),
          entityType: 'FUNCTION',
          semanticRole: 'UTIL',
          filePath,
          language: 'lua',
          scipUri: formatScipUri('lua', filePath, '', fnName, 'def'),
          signature: `local function ${fnName}(${paramsNode ? paramsNode.text : ''})`,
          loc: { startLine: line, endLine },
        };
        nodes.push(fnNode);

        edges.push({
          id: `contains_${fileNodeId}_${fnNodeId}`,
          source: fileNodeId,
          target: fnNodeId,
          relation: 'CONTAINS',
          confidence: 'EXTRACTED',
        });

        contextStack.push(fnNode);
        if (blockNode) traverse(blockNode);
        contextStack.pop();
        return;
      }
    }

    // 6. 变量赋值为函数 (Player.attack = function() ... end)
    if (nodeType === 'variable_assignment') {
      const varList = cursorNode.namedChildren.find((c) => c.type === 'variable_list');
      const exprList = cursorNode.namedChildren.find((c) => c.type === 'expression_list');
      if (varList && exprList) {
        const fnExpr = exprList.namedChildren.find((c) => c.type === 'function_definition');
        if (fnExpr) {
          const varName = varList.text.trim();
          const line = cursorNode.startPosition.row + 1;
          const endLine = cursorNode.endPosition.row + 1;

          if (varName.includes('.')) {
            const parts = varName.split('.');
            const tblName = parts[0];
            const methodName = parts.slice(1).join('.');

            const classNode = getOrCreateClassNode(tblName, line);
            const methodNodeId = formatNodeId(filePath, `${tblName}_${methodName}`);
            const methodNode: CodeNode = {
              id: methodNodeId,
              name: methodName,
              qualifiedName: formatQualifiedName(filePath, `${tblName}.${methodName}`),
              entityType: 'METHOD',
              semanticRole: 'SERVICE',
              filePath,
              language: 'lua',
              scipUri: formatScipUri('lua', filePath, tblName, methodName, 'method'),
              signature: `${varName} = function()`,
              loc: { startLine: line, endLine },
            };
            nodes.push(methodNode);

            edges.push({
              id: `contains_${classNode.id}_${methodNodeId}`,
              source: classNode.id,
              target: methodNodeId,
              relation: 'CONTAINS',
              confidence: 'EXTRACTED',
            });

            contextStack.push(methodNode);
            const block = fnExpr.namedChildren.find((c) => c.type === 'block');
            if (block) traverse(block);
            contextStack.pop();
            return;
          }
        }
      }
    }

    // 7. 函数内调用表达式与 REST API 客户端侦测
    if (nodeType === 'call') {
      const caller = getCurrentCaller();
      if (caller) {
        const callee = cursorNode.namedChildren[0];
        if (callee && callee.text !== 'require' && callee.text !== 'setmetatable') {
          const callText = callee.text.trim();
          const line = cursorNode.startPosition.row + 1;

          // 7.1 检测 REST API 请求 (如 http.get("/api/..."), client:post("/api/..."))
          let apiMeta: { httpMethod?: string; routePattern?: string } | undefined;
          const lowerCallee = callText.toLowerCase();
          const httpMethodMatch = lowerCallee.match(/\b(get|post|put|delete|patch)\b/);
          if (httpMethodMatch) {
            const argsNode = cursorNode.namedChildren[1];
            if (argsNode) {
              const strChild = argsNode.text.match(/["'](\/[^"']+)["']/);
              if (strChild) {
                const method = httpMethodMatch[1].toUpperCase();
                const route = normalizeRoutePattern(strChild[1]);
                apiMeta = { httpMethod: method, routePattern: route };

                // 注册客户端端点节点
                const epId = formatNodeId(filePath, `${caller.name}_call_${method}_${route}`);
                nodes.push({
                  id: epId,
                  name: `${method} ${route}`,
                  qualifiedName: formatQualifiedName(filePath, `${method} ${route}`),
                  entityType: 'ENDPOINT',
                  semanticRole: 'CONTRACT',
                  filePath,
                  language: 'lua',
                  endpointMeta: {
                    httpMethod: method,
                    routePath: route,
                    isClientCall: true,
                  },
                  loc: { startLine: line, endLine: line },
                });

                edges.push({
                  id: `client_call_${caller.id}_${epId}`,
                  source: caller.id,
                  target: epId,
                  relation: 'CALLS_CONTRACT',
                  confidence: 'EXTRACTED',
                  sourceLine: line,
                });
              }
            }
          }

          unresolvedCalls.push({
            callerNodeId: caller.id,
            calleeExpression: callText,
            line,
            apiCallMeta: apiMeta,
          });
        }
      }
    }

    // 递归遍历子节点
    for (let i = 0; i < cursorNode.namedChildCount; i++) {
      const child = cursorNode.namedChild(i);
      if (child) traverse(child);
    }
  }

  traverse(tree.rootNode);

  return {
    filePath,
    language: 'lua',
    nodes,
    edges,
    imports,
    unresolvedCalls,
    unresolvedInheritance,
  };
}
