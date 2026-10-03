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

export class PythonExtractor implements LanguageExtractor {
  public readonly language = 'python';
  public readonly fileExtensions = ['.py'];
  public readonly wasmGrammarName = 'python';

  public extractFile(
    tree: Parser.Tree,
    filePath: string,
    sourceCode: string
  ): ExtractedFileResult {
    return extractPythonFile(tree, filePath, sourceCode);
  }
}

/**
 * 深度解析单个 Python 源码文件，提取类、函数、路由契约、异步任务与调用图谱
 */
export function extractPythonFile(
  tree: Parser.Tree,
  filePath: string,
  sourceCode: string
): ExtractedFileResult {
  const nodes: CodeNode[] = [];
  const edges: CodeEdge[] = [];
  const imports: FileImportInfo[] = [];
  const unresolvedCalls: UnresolvedCall[] = [];
  const unresolvedInheritance: UnresolvedInheritance[] = [];

  // 1. 创建顶层文件节点
  const fileNodeId = formatNodeId(filePath, 'file');
  const fileName = filePath.split(/[/\\]/).pop() || filePath;
  const fileScip = formatScipUri('python', filePath, '', fileName, 'def');

  nodes.push({
    id: fileNodeId,
    name: fileName,
    qualifiedName: formatQualifiedName(filePath, 'file'),
    entityType: 'FILE',
    semanticRole: 'UNKNOWN',
    filePath,
    language: 'python',
    scipUri: fileScip,
    loc: {
      startLine: tree.rootNode.startPosition.row + 1,
      endLine: tree.rootNode.endPosition.row + 1,
    },
  });

  // 遍历上下文栈 (类、外层函数等)
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

  function getDocstring(bodyNode: Parser.SyntaxNode): string | undefined {
    if (!bodyNode || bodyNode.namedChildCount === 0) return undefined;
    const firstStatement = bodyNode.namedChild(0);
    if (
      firstStatement &&
      firstStatement.type === 'expression_statement' &&
      firstStatement.namedChildCount > 0 &&
      firstStatement.namedChild(0)?.type === 'string'
    ) {
      return firstStatement
        .namedChild(0)
        ?.text.replace(/^['"]{1,3}|['"]{1,3}$/g, '')
        .trim();
    }
    return undefined;
  }

  // 提取 Web 路由与 HTTP 元数据 (FastAPI, Flask, Django, Tornado 等)
  function parseRouteMeta(decorators: string[]): {
    isEndpoint: boolean;
    method?: string;
    routePath?: string;
  } {
    for (const dec of decorators) {
      // FastAPI / Starlette / APIRouter: @app.get("/users"), @router.post("/login")
      const fastApiMatch = dec.match(
        /@(?:app|router|api|blueprint|bp|route|server|web)\.(get|post|put|delete|patch|options|head|api_route)\s*\(\s*["']([^"']+)["']/i
      );
      if (fastApiMatch) {
        return {
          isEndpoint: true,
          method: fastApiMatch[1].toUpperCase(),
          routePath: fastApiMatch[2],
        };
      }

      // Flask style: @app.route("/users", methods=["POST"])
      const flaskMatch = dec.match(
        /@(?:app|blueprint|bp|api)\.route\s*\(\s*["']([^"']+)["'](?:[^)]*methods\s*=\s*\[\s*["']([A-Z]+)["'])?/i
      );
      if (flaskMatch) {
        return {
          isEndpoint: true,
          method: (flaskMatch[2] || 'GET').toUpperCase(),
          routePath: flaskMatch[1],
        };
      }

      // Django REST Framework / other action decorators
      if (/@(?:action|api_view)\b/i.test(dec)) {
        return { isEndpoint: true, method: 'GET', routePath: '' };
      }
    }
    return { isEndpoint: false };
  }

  // 提取异步任务队列/消息事件元数据 (Celery, RQ, Kafka)
  function parseWorkerMeta(decorators: string[]): {
    isWorker: boolean;
    topicName?: string;
  } {
    for (const dec of decorators) {
      const taskMatch = dec.match(
        /@(?:task|shared_task|celery|job)\s*(?:\(\s*(?:name\s*=\s*)?["']([^"']+)["'])?/i
      );
      if (taskMatch) {
        return { isWorker: true, topicName: taskMatch[1] };
      }
      if (/@(?:schedule|worker|event|receiver|on_event)\b/i.test(dec)) {
        return { isWorker: true };
      }
    }
    return { isWorker: false };
  }

  function isCliCommand(decorators: string[]): boolean {
    const cliPattern = /@(click|app|cli|typer|cmd)\.(command|group)\b/i;
    return decorators.some((dec) => cliPattern.test(dec));
  }

  function isStandardEntryName(name: string): boolean {
    const entryNames = new Set([
      'main',
      'run',
      'start',
      'cli',
      'handler',
      'lambda_handler',
      'entrypoint',
      'execute',
      'dispatch',
      'process_request',
      'handle_request',
      'pipeline',
      'solve',
      'serve',
      'bootstrap',
    ]);
    return entryNames.has(name.toLowerCase());
  }

  function traverse(cursorNode: Parser.SyntaxNode) {
    const nodeType = cursorNode.type;

    // 1. 提取普通 import (import os, sys)
    if (nodeType === 'import_statement') {
      const line = cursorNode.startPosition.row + 1;
      for (let i = 0; i < cursorNode.namedChildCount; i++) {
        const child = cursorNode.namedChild(i);
        if (child?.type === 'dotted_name') {
          imports.push({
            modulePath: child.text,
            importedNames: [{ name: child.text }],
            isFromImport: false,
            line,
          });
        } else if (child?.type === 'aliased_import') {
          const orig = child.childForFieldName('name')?.text || '';
          const alias = child.childForFieldName('alias')?.text;
          imports.push({
            modulePath: orig,
            importedNames: [{ name: orig, alias }],
            isFromImport: false,
            line,
          });
        }
      }
    }

    // 2. 提取 from ... import ...
    if (nodeType === 'import_from_statement') {
      const line = cursorNode.startPosition.row + 1;
      const moduleNode = cursorNode.childForFieldName('module_name');
      const modulePath = moduleNode ? moduleNode.text : '';

      const importedNames: Array<{ name: string; alias?: string }> = [];
      for (let i = 0; i < cursorNode.namedChildCount; i++) {
        const child = cursorNode.namedChild(i);
        if (!child || child === moduleNode) continue;

        if (child.type === 'dotted_name') {
          importedNames.push({ name: child.text });
        } else if (child.type === 'aliased_import') {
          const orig = child.childForFieldName('name')?.text || '';
          const alias = child.childForFieldName('alias')?.text;
          importedNames.push({ name: orig, alias });
        } else if (child.type === 'wildcard_import') {
          importedNames.push({ name: '*' });
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

    // 3. 提取类定义 (class MyClass:)
    if (nodeType === 'class_definition') {
      const nameNode = cursorNode.childForFieldName('name');
      const className = nameNode ? nameNode.text : 'AnonymousClass';
      const nodeId = formatNodeId(filePath, className);
      const bodyNode = cursorNode.childForFieldName('body');
      const docstring = bodyNode ? getDocstring(bodyNode) : undefined;
      const scipUri = formatScipUri('python', filePath, '', className, 'class');

      const classNode: CodeNode = {
        id: nodeId,
        name: className,
        qualifiedName: formatQualifiedName(filePath, className),
        entityType: 'CLASS',
        semanticRole: 'UNKNOWN',
        filePath,
        language: 'python',
        scipUri,
        loc: {
          startLine: cursorNode.startPosition.row + 1,
          endLine: cursorNode.endPosition.row + 1,
        },
        docstring,
      };
      nodes.push(classNode);

      // 文件包含该类
      edges.push({
        id: `contains_${fileNodeId}_${nodeId}`,
        source: fileNodeId,
        target: nodeId,
        relation: 'CONTAINS',
        confidence: 'EXTRACTED',
      });

      // 提取基类继承
      const superclassesNode = cursorNode.childForFieldName('superclasses');
      if (superclassesNode) {
        for (let i = 0; i < superclassesNode.namedChildCount; i++) {
          const sc = superclassesNode.namedChild(i);
          if (sc) {
            unresolvedInheritance.push({
              classNodeId: nodeId,
              superclassName: sc.text,
              line: sc.startPosition.row + 1,
            });
          }
        }
      }

      contextStack.push(classNode);
      if (bodyNode) {
        for (let i = 0; i < bodyNode.namedChildCount; i++) {
          const child = bodyNode.namedChild(i);
          if (child) traverse(child);
        }
      }
      contextStack.pop();
      return;
    }

    // 4. 提取函数与方法定义 (包括装饰器修饰函数)
    let funcNode: Parser.SyntaxNode | null = null;
    const decorators: string[] = [];

    if (nodeType === 'decorated_definition') {
      for (let i = 0; i < cursorNode.namedChildCount; i++) {
        const child = cursorNode.namedChild(i);
        if (child?.type === 'decorator') {
          decorators.push(child.text);
        } else if (
          child?.type === 'function_definition' ||
          child?.type === 'async_function_definition'
        ) {
          funcNode = child;
        }
      }
    } else if (
      nodeType === 'function_definition' ||
      nodeType === 'async_function_definition'
    ) {
      funcNode = cursorNode;
    }

    if (funcNode) {
      const nameNode = funcNode.childForFieldName('name');
      const funcName = nameNode ? nameNode.text : 'anonymous_func';
      const isInsideClass = contextStack.some((n) => n.entityType === 'CLASS');
      const parentContainer = contextStack[contextStack.length - 1] || nodes[0];

      const routeMeta = parseRouteMeta(decorators);
      const workerMeta = parseWorkerMeta(decorators);
      const isCli = isCliCommand(decorators);
      const isStdEntry = !isInsideClass && isStandardEntryName(funcName);

      const isEntry =
        routeMeta.isEndpoint || workerMeta.isWorker || isCli || isStdEntry;

      const entityType: EntityType = routeMeta.isEndpoint
        ? 'ENDPOINT'
        : isInsideClass
        ? 'METHOD'
        : 'FUNCTION';

      const semanticRole: SemanticRole = isEntry ? 'ENTRY' : 'UNKNOWN';

      const nodeId = formatNodeId(
        filePath,
        isInsideClass ? `${parentContainer.name}_${funcName}` : funcName
      );
      const bodyNode = funcNode.childForFieldName('body');
      const docstring = bodyNode ? getDocstring(bodyNode) : undefined;
      const paramsNode = funcNode.childForFieldName('parameters');
      const signature = `def ${funcName}${paramsNode ? paramsNode.text : '()'}`;

      const parentScope = isInsideClass ? parentContainer.name : '';
      const scipUri = formatScipUri(
        'python',
        filePath,
        parentScope,
        funcName,
        isInsideClass ? 'method' : 'def'
      );

      const codeNode: CodeNode = {
        id: nodeId,
        name: funcName,
        qualifiedName: formatQualifiedName(
          filePath,
          isInsideClass ? `${parentContainer.name}.${funcName}` : funcName
        ),
        entityType,
        semanticRole,
        filePath,
        language: 'python',
        scipUri,
        loc: {
          startLine:
            (cursorNode.type === 'decorated_definition' ? cursorNode : funcNode)
              .startPosition.row + 1,
          endLine: funcNode.endPosition.row + 1,
        },
        signature,
        docstring,
        metadata: {
          decorators,
          isAsync: funcNode.type === 'async_function_definition',
        },
      };

      // 填充契约元数据
      if (routeMeta.isEndpoint && routeMeta.method) {
        codeNode.endpointMeta = {
          httpMethod: routeMeta.method,
          routePath: normalizeRoutePattern(routeMeta.routePath || `/${funcName}`),
          isClientCall: false,
        };
      }

      if (workerMeta.isWorker) {
        codeNode.topicMeta = {
          topicName: workerMeta.topicName || funcName,
          isPublisher: false,
        };
      }

      nodes.push(codeNode);

      // 父容器包含该函数/方法
      edges.push({
        id: `contains_${parentContainer.id}_${nodeId}`,
        source: parentContainer.id,
        target: nodeId,
        relation: 'CONTAINS',
        confidence: 'EXTRACTED',
      });

      contextStack.push(codeNode);
      if (bodyNode) {
        for (let i = 0; i < bodyNode.namedChildCount; i++) {
          const child = bodyNode.namedChild(i);
          if (child) traverse(child);
        }
      }
      contextStack.pop();
      return;
    }

    // 5. 提取函数调用 (call AST 节点)
    if (nodeType === 'call') {
      const functionNode = cursorNode.childForFieldName('function');
      if (functionNode) {
        const caller = getCurrentCaller() || nodes[0];
        if (caller) {
          const callText = functionNode.text;
          const line = cursorNode.startPosition.row + 1;

          // 识别 HTTP 客户端调用 (requests, httpx, aiohttp)
          const httpMatch = callText.match(
            /(?:requests|httpx|session|client|http)\.(get|post|put|delete|patch)\b/i
          );
          let apiCallMeta:
            | { httpMethod: string; routePattern: string }
            | undefined;

          if (httpMatch) {
            const argsNode = cursorNode.childForFieldName('arguments');
            if (argsNode && argsNode.namedChildCount > 0) {
              const firstArg = argsNode.namedChild(0);
              if (firstArg && firstArg.type === 'string') {
                const url = firstArg.text.replace(/^['"]|['"]$/g, '');
                // 仅识别路径形 URL 如 /api/v1/users 或完整 URL 中的路径部分
                const pathMatch = url.match(/^(?:https?:\/\/[^/]+)?(\/[^?#]*)/);
                if (pathMatch) {
                  apiCallMeta = {
                    httpMethod: httpMatch[1].toUpperCase(),
                    routePattern: normalizeRoutePattern(pathMatch[1]),
                  };
                }
              }
            }
          }

          // 识别任务/消息队列投递 (task.delay, task.apply_async, producer.send)
          let topicMeta: { topicName: string; isPublish: boolean } | undefined;
          if (/(?:\.delay|\.apply_async)\b/.test(callText)) {
            const taskObj = callText.replace(/\.(delay|apply_async)$/, '');
            topicMeta = { topicName: taskObj, isPublish: true };
          } else if (/(?:send_task|publish)\b/.test(callText)) {
            const argsNode = cursorNode.childForFieldName('arguments');
            if (argsNode && argsNode.namedChildCount > 0) {
              const firstArg = argsNode.namedChild(0);
              if (firstArg && firstArg.type === 'string') {
                topicMeta = {
                  topicName: firstArg.text.replace(/^['"]|['"]$/g, ''),
                  isPublish: true,
                };
              }
            }
          }

          unresolvedCalls.push({
            callerNodeId: caller.id,
            calleeExpression: callText,
            line,
            apiCallMeta,
            topicMeta,
          });
        }
      }
    }

    // 默认深度优先递归
    for (let i = 0; i < cursorNode.namedChildCount; i++) {
      const child = cursorNode.namedChild(i);
      if (child) traverse(child);
    }
  }

  traverse(tree.rootNode);

  return {
    filePath,
    language: 'python',
    nodes,
    edges,
    imports,
    unresolvedCalls,
    unresolvedInheritance,
  };
}
