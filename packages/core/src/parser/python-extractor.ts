import Parser from 'web-tree-sitter';
import { CodeNode, CodeEdge, EntityType, SemanticRole } from '../types/index.js';

export interface FileImportInfo {
  modulePath: string;     // 例如 "fastapi" 或 "src.services.user"
  importedNames: Array<{ name: string; alias?: string }>;
  isFromImport: boolean;
  line: number;
}

export interface UnresolvedCall {
  callerNodeId: string;
  calleeExpression: string; // 调用的函数名或表达式 (如 "query_users" 或 "self.db.fetch")
  line: number;
}

export interface UnresolvedInheritance {
  classNodeId: string;
  superclassName: string;
  line: number;
}

export interface ExtractedFileResult {
  filePath: string;
  nodes: CodeNode[];
  edges: CodeEdge[];
  imports: FileImportInfo[];
  unresolvedCalls: UnresolvedCall[];
  unresolvedInheritance: UnresolvedInheritance[];
}

/**
 * 辅助函数：根据相对文件路径生成标准节点 ID
 */
export function formatNodeId(filePath: string, entityName: string): string {
  const cleanPath = filePath
    .replace(/\\/g, '/')
    .replace(/^\.\//, '')
    .replace(/\.[^/.]+$/, '')
    .replace(/[^a-zA-Z0-9_]/g, '_')
    .toLowerCase();
  const cleanEntity = entityName.replace(/[^a-zA-Z0-9_]/g, '_').toLowerCase();
  return `${cleanPath}_${cleanEntity}`;
}

/**
 * 辅助函数：根据相对文件路径生成标准限定名 (Qualified Name)
 */
export function formatQualifiedName(filePath: string, entityName: string): string {
  const cleanPath = filePath
    .replace(/\\/g, '/')
    .replace(/^\.\//, '')
    .replace(/\.[^/.]+$/, '')
    .replace(/\//g, '.');
  return `${cleanPath}.${entityName}`;
}

/**
 * 深度解析单个 Python 源码文件
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

  // 创建文件级节点
  const fileNodeId = formatNodeId(filePath, 'file');
  nodes.push({
    id: fileNodeId,
    name: filePath.split(/[/\\]/).pop() || filePath,
    qualifiedName: formatQualifiedName(filePath, 'file'),
    entityType: 'FILE',
    semanticRole: 'UNKNOWN',
    filePath,
    loc: {
      startLine: tree.rootNode.startPosition.row + 1,
      endLine: tree.rootNode.endPosition.row + 1,
    },
  });

  // 当前遍历上下文堆栈 (类名、函数名)
  const contextStack: CodeNode[] = [];

  function getCurrentCaller(): CodeNode | undefined {
    for (let i = contextStack.length - 1; i >= 0; i--) {
      const n = contextStack[i];
      if (n.entityType === 'FUNCTION' || n.entityType === 'METHOD' || n.entityType === 'ENDPOINT') {
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
      return firstStatement.namedChild(0)?.text.replace(/^['"]{1,3}|['"]{1,3}$/g, '').trim();
    }
    return undefined;
  }

  function isWebEndpoint(decorators: string[]): boolean {
    const routePattern = /@(app|router|api|blueprint|bp|route|server|web)\.(get|post|put|delete|patch|options|head|route|websocket|api_route)\b/i;
    const extraPattern = /@(action|api_view)\b/i;
    return decorators.some((dec) => routePattern.test(dec) || extraPattern.test(dec));
  }

  function isWorkerTask(decorators: string[]): boolean {
    const taskPattern = /@(task|shared_task|celery|job|schedule|worker|event|receiver|on_event)\b/i;
    return decorators.some((dec) => taskPattern.test(dec));
  }

  function isCliCommand(decorators: string[]): boolean {
    const cliPattern = /@(click|app|cli|typer|cmd)\.(command|group)\b/i;
    return decorators.some((dec) => cliPattern.test(dec));
  }

  function isStandardEntryName(name: string): boolean {
    const entryNames = new Set([
      'main', 'run', 'start', 'cli', 'handler', 'lambda_handler',
      'entrypoint', 'execute', 'dispatch', 'process_request', 'handle_request',
      'pipeline', 'solve', 'serve', 'bootstrap'
    ]);
    return entryNames.has(name.toLowerCase());
  }

  function traverse(cursorNode: Parser.SyntaxNode) {
    const nodeType = cursorNode.type;

    // 1. 提取普通 import 语句 (import os, sys)
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

    // 2. 提取 from ... import ... 语句
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

      const classNode: CodeNode = {
        id: nodeId,
        name: className,
        qualifiedName: formatQualifiedName(filePath, className),
        entityType: 'CLASS',
        semanticRole: 'UNKNOWN',
        filePath,
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
        } else if (child?.type === 'function_definition' || child?.type === 'async_function_definition') {
          funcNode = child;
        }
      }
    } else if (nodeType === 'function_definition' || nodeType === 'async_function_definition') {
      funcNode = cursorNode;
    }

    if (funcNode) {
      const nameNode = funcNode.childForFieldName('name');
      const funcName = nameNode ? nameNode.text : 'anonymous_func';
      const isInsideClass = contextStack.some((n) => n.entityType === 'CLASS');
      const parentContainer = contextStack[contextStack.length - 1] || nodes[0]; // 父类或当前文件

      const isEndpoint = isWebEndpoint(decorators);
      const isCli = isCliCommand(decorators);
      const isWorker = isWorkerTask(decorators);
      const isStdEntry = !isInsideClass && isStandardEntryName(funcName);

      const isEntry = isEndpoint || isCli || isWorker || isStdEntry;

      const entityType: EntityType = isEndpoint ? 'ENDPOINT' : isInsideClass ? 'METHOD' : 'FUNCTION';
      const semanticRole: SemanticRole = isEntry ? 'ENTRY' : 'UNKNOWN';

      const nodeId = formatNodeId(filePath, isInsideClass ? `${parentContainer.name}_${funcName}` : funcName);
      const bodyNode = funcNode.childForFieldName('body');
      const docstring = bodyNode ? getDocstring(bodyNode) : undefined;
      const paramsNode = funcNode.childForFieldName('parameters');
      const signature = `def ${funcName}${paramsNode ? paramsNode.text : '()'}`;

      const codeNode: CodeNode = {
        id: nodeId,
        name: funcName,
        qualifiedName: formatQualifiedName(filePath, isInsideClass ? `${parentContainer.name}.${funcName}` : funcName),
        entityType,
        semanticRole,
        filePath,
        loc: {
          startLine: (cursorNode.type === 'decorated_definition' ? cursorNode : funcNode).startPosition.row + 1,
          endLine: funcNode.endPosition.row + 1,
        },
        signature,
        docstring,
        metadata: {
          decorators,
          isAsync: funcNode.type === 'async_function_definition',
        },
      };
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
          unresolvedCalls.push({
            callerNodeId: caller.id,
            calleeExpression: functionNode.text,
            line: cursorNode.startPosition.row + 1,
          });
        }
      }
    }

    // 默认深度优先递归子节点
    for (let i = 0; i < cursorNode.namedChildCount; i++) {
      const child = cursorNode.namedChild(i);
      if (child) traverse(child);
    }
  }

  traverse(tree.rootNode);

  return {
    filePath,
    nodes,
    edges,
    imports,
    unresolvedCalls,
    unresolvedInheritance,
  };
}
