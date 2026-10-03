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
} from '../scip-utils.js';

export class CppExtractor implements LanguageExtractor {
  public readonly language = 'cpp';
  public readonly fileExtensions = ['.cpp', '.cc', '.cxx', '.c', '.hpp', '.hxx', '.h'];
  public readonly wasmGrammarName = 'cpp';

  public extractFile(
    tree: Parser.Tree,
    filePath: string,
    sourceCode: string
  ): ExtractedFileResult {
    return extractCppFile(tree, filePath, sourceCode);
  }
}

/**
 * 深度解析 C/C++ 源码文件，提取 Namespace、Class、Struct、Function、Method、#include 依赖与函数调用
 */
export function extractCppFile(
  tree: Parser.Tree,
  filePath: string,
  sourceCode: string
): ExtractedFileResult {
  const nodes: CodeNode[] = [];
  const edges: CodeEdge[] = [];
  const imports: FileImportInfo[] = [];
  const unresolvedCalls: UnresolvedCall[] = [];
  const unresolvedInheritance: UnresolvedInheritance[] = [];

  const lang = filePath.endsWith('.c') || filePath.endsWith('.h') ? 'c' : 'cpp';

  // 1. 创建文件节点
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
  let currentNamespace = '';

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

  function extractDeclaratorName(declarator: Parser.SyntaxNode | null): string {
    if (!declarator) return 'anonymous_func';
    if (declarator.type === 'identifier' || declarator.type === 'field_identifier') {
      return declarator.text;
    }
    if (declarator.type === 'function_declarator') {
      const inner = declarator.childForFieldName('declarator');
      return extractDeclaratorName(inner);
    }
    if (declarator.type === 'qualified_identifier') {
      const nameChild = declarator.childForFieldName('name');
      return nameChild ? nameChild.text : declarator.text;
    }
    const nameNode = declarator.childForFieldName('declarator');
    if (nameNode) return extractDeclaratorName(nameNode);
    return declarator.text.replace(/\(.*\)/, '').trim();
  }

  function traverse(cursorNode: Parser.SyntaxNode) {
    const nodeType = cursorNode.type;

    // 1. 提取 #include 预处理指令
    if (nodeType === 'preproc_include') {
      const pathNode = cursorNode.childForFieldName('path');
      if (pathNode) {
        const rawInc = pathNode.text.replace(/^[<"]|[>"]$/g, '');
        imports.push({
          modulePath: rawInc,
          importedNames: [{ name: rawInc.split('/').pop() || rawInc }],
          isFromImport: false,
          line: cursorNode.startPosition.row + 1,
        });
      }
      return;
    }

    // 2. 提取 namespace
    if (nodeType === 'namespace_definition') {
      const nameNode = cursorNode.childForFieldName('name');
      const prevNamespace = currentNamespace;
      if (nameNode) {
        currentNamespace = currentNamespace ? `${currentNamespace}::${nameNode.text}` : nameNode.text;
      }
      const bodyNode = cursorNode.childForFieldName('body');
      if (bodyNode) {
        for (let i = 0; i < bodyNode.namedChildCount; i++) {
          const child = bodyNode.namedChild(i);
          if (child) traverse(child);
        }
      }
      currentNamespace = prevNamespace;
      return;
    }

    // 3. 提取 class / struct 声明
    if (nodeType === 'class_specifier' || nodeType === 'struct_specifier') {
      const nameNode = cursorNode.childForFieldName('name');
      const className = nameNode ? nameNode.text : 'AnonymousType';
      const nodeId = formatNodeId(filePath, className);
      const qName = currentNamespace ? `${currentNamespace}::${className}` : className;
      const scipUri = formatScipUri(lang, filePath, currentNamespace, className, 'class');

      const classNode: CodeNode = {
        id: nodeId,
        name: className,
        qualifiedName: qName,
        entityType: 'CLASS',
        semanticRole: 'UNKNOWN',
        filePath,
        language: lang,
        scipUri,
        loc: {
          startLine: cursorNode.startPosition.row + 1,
          endLine: cursorNode.endPosition.row + 1,
        },
      };
      nodes.push(classNode);

      edges.push({
        id: `contains_${fileNodeId}_${nodeId}`,
        source: fileNodeId,
        target: nodeId,
        relation: 'CONTAINS',
        confidence: 'EXTRACTED',
      });

      // 提取基类继承
      const baseClause = cursorNode.namedChildren.find((c) => c.type === 'base_class_clause');
      if (baseClause) {
        for (let i = 0; i < baseClause.namedChildCount; i++) {
          const baseSpec = baseClause.namedChild(i);
          if (baseSpec && (baseSpec.type === 'type_identifier' || baseSpec.type === 'qualified_identifier')) {
            unresolvedInheritance.push({
              classNodeId: nodeId,
              superclassName: baseSpec.text,
              line: baseSpec.startPosition.row + 1,
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

    // 4. 提取函数与方法定义 (function_definition)
    if (nodeType === 'function_definition') {
      const declaratorNode = cursorNode.childForFieldName('declarator');
      const funcName = extractDeclaratorName(declaratorNode);
      const isInsideClass = contextStack.some((n) => n.entityType === 'CLASS');
      const parentContainer = contextStack[contextStack.length - 1] || nodes[0];

      const isEntry = !isInsideClass && /^(main|_tmain|WinMain|run|start)$/i.test(funcName);
      const entityType: EntityType = isInsideClass ? 'METHOD' : 'FUNCTION';
      const semanticRole: SemanticRole = isEntry ? 'ENTRY' : 'UNKNOWN';

      const nodeId = formatNodeId(filePath, isInsideClass ? `${parentContainer.name}_${funcName}` : funcName);
      const qName = isInsideClass
        ? `${parentContainer.qualifiedName}::${funcName}`
        : currentNamespace
        ? `${currentNamespace}::${funcName}`
        : funcName;

      const scipUri = formatScipUri(
        lang,
        filePath,
        isInsideClass ? parentContainer.name : currentNamespace,
        funcName,
        isInsideClass ? 'method' : 'def'
      );

      const funcNode: CodeNode = {
        id: nodeId,
        name: funcName,
        qualifiedName: qName,
        entityType,
        semanticRole,
        filePath,
        language: lang,
        scipUri,
        loc: {
          startLine: cursorNode.startPosition.row + 1,
          endLine: cursorNode.endPosition.row + 1,
        },
      };
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

    // 5. 提取函数调用 (call_expression)
    if (nodeType === 'call_expression') {
      const fnNode = cursorNode.childForFieldName('function');
      const caller = getCurrentCaller() || nodes[0];
      const line = cursorNode.startPosition.row + 1;

      if (fnNode && caller) {
        const calleeText = fnNode.text;
        unresolvedCalls.push({
          callerNodeId: caller.id,
          calleeExpression: calleeText,
          line,
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
    language: lang,
    nodes,
    edges,
    imports,
    unresolvedCalls,
    unresolvedInheritance,
  };
}
