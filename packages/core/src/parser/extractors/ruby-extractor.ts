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

export class RubyExtractor implements LanguageExtractor {
  public readonly language = 'ruby';
  public readonly fileExtensions = ['.rb'];
  public readonly wasmGrammarName = 'ruby';

  public extractFile(
    tree: Parser.Tree,
    filePath: string,
    sourceCode: string
  ): ExtractedFileResult {
    return extractRubyFile(tree, filePath, sourceCode);
  }
}

/**
 * 深度解析 Ruby / Rails 源码文件 (.rb)
 * 提取 require、Module/Class、Method、Rails 关联与 HTTP 客户端网络请求 (Net::HTTP / Faraday)
 */
export function extractRubyFile(
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
  const fileScip = formatScipUri('ruby', filePath, '', fileName, 'def');

  const fileNode: CodeNode = {
    id: fileNodeId,
    name: fileName,
    qualifiedName: formatQualifiedName(filePath, 'file'),
    entityType: 'FILE',
    semanticRole: 'UNKNOWN',
    filePath,
    language: 'ruby',
    scipUri: fileScip,
    loc: {
      startLine: tree.rootNode.startPosition.row + 1,
      endLine: tree.rootNode.endPosition.row + 1,
    },
  };
  nodes.push(fileNode);

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

  function getScopePrefix(): string {
    const modules: string[] = [];
    for (const n of contextStack) {
      if (n.entityType === 'MODULE' || n.entityType === 'CLASS') {
        modules.push(n.name);
      }
    }
    return modules.join('::');
  }

  function findStringLiteral(node: Parser.SyntaxNode): string | undefined {
    if (node.type === 'string' || node.type === 'string_content') {
      return node.text.trim().replace(/^['"]|['"]$/g, '');
    }
    for (let i = 0; i < node.namedChildCount; i++) {
      const c = node.namedChild(i);
      if (c) {
        const found = findStringLiteral(c);
        if (found) return found;
      }
    }
    return undefined;
  }

  function traverse(cursorNode: Parser.SyntaxNode) {
    const nodeType = cursorNode.type;

    // 2. 提取 require / require_relative
    if (nodeType === 'call') {
      const idNode = cursorNode.namedChildren.find((c) => c.type === 'identifier');
      if (idNode && (idNode.text === 'require' || idNode.text === 'require_relative')) {
        const argList = cursorNode.namedChildren.find((c) => c.type === 'argument_list');
        if (argList) {
          const strNode = argList.namedChildren.find((c) => c.type === 'string');
          if (strNode) {
            const reqPath = strNode.text.trim().replace(/^['"]|['"]$/g, '');
            const modName = reqPath.split('/').pop() || reqPath;
            imports.push({
              modulePath: reqPath,
              importedNames: [{ name: modName }],
              isFromImport: idNode.text === 'require',
              line: cursorNode.startPosition.row + 1,
            });
            return;
          }
        }
      }
    }

    // 3. 提取 Module 定义
    if (nodeType === 'module') {
      const nameNode = cursorNode.namedChildren.find((c) => c.type === 'constant');
      if (!nameNode) return;

      const modName = nameNode.text.trim();
      const parentScope = getScopePrefix();
      const fullModName = parentScope ? `${parentScope}::${modName}` : modName;
      const modId = formatNodeId(filePath, fullModName);
      const modScip = formatScipUri('ruby', filePath, parentScope, modName, 'interface');

      const modNode: CodeNode = {
        id: modId,
        name: modName,
        qualifiedName: fullModName,
        entityType: 'MODULE',
        semanticRole: 'SERVICE',
        filePath,
        language: 'ruby',
        scipUri: modScip,
        loc: {
          startLine: cursorNode.startPosition.row + 1,
          endLine: cursorNode.endPosition.row + 1,
        },
      };

      nodes.push(modNode);
      const parentId = contextStack.length > 0 ? contextStack[contextStack.length - 1].id : fileNodeId;
      edges.push({
        id: `defines_${parentId}_${modId}`,
        source: parentId,
        target: modId,
        relation: 'CONTAINS',
        confidence: 'EXTRACTED',
      });

      contextStack.push(modNode);
      const body = cursorNode.namedChildren.find((c) => c.type === 'body_statement');
      if (body) {
        traverse(body);
      }
      contextStack.pop();
      return;
    }

    // 4. 提取 Class 定义
    if (nodeType === 'class') {
      const nameNode = cursorNode.namedChildren.find((c) => c.type === 'constant' || c.type === 'scope_resolution');
      if (!nameNode) return;

      const className = nameNode.text.trim();
      const parentScope = getScopePrefix();
      const fullClassName = parentScope ? `${parentScope}::${className}` : className;
      const classId = formatNodeId(filePath, fullClassName);
      const classScip = formatScipUri('ruby', filePath, parentScope, className, 'class');

      let superclassName: string | undefined;
      const superNode = cursorNode.namedChildren.find((c) => c.type === 'superclass');
      if (superNode) {
        const supConst = superNode.namedChildren.find((c) => c.type === 'constant' || c.type === 'scope_resolution');
        if (supConst) {
          superclassName = supConst.text.trim();
        }
      }

      let role: SemanticRole = 'UNKNOWN';
      if (
        className.endsWith('Controller') ||
        (superclassName && (superclassName.includes('Controller') || superclassName === 'ApplicationController'))
      ) {
        role = 'ENTRY';
      } else if (
        superclassName &&
        (superclassName.includes('Record') || superclassName === 'ApplicationRecord' || superclassName === 'ActiveRecord::Base')
      ) {
        role = 'MODEL';
      } else if (
        className.endsWith('Service') ||
        className.endsWith('Worker') ||
        className.endsWith('Job') ||
        className.endsWith('Mailer')
      ) {
        role = 'SERVICE';
      }

      const classNode: CodeNode = {
        id: classId,
        name: className,
        qualifiedName: fullClassName,
        entityType: 'CLASS',
        semanticRole: role,
        filePath,
        language: 'ruby',
        scipUri: classScip,
        loc: {
          startLine: cursorNode.startPosition.row + 1,
          endLine: cursorNode.endPosition.row + 1,
        },
      };

      nodes.push(classNode);
      const parentId = contextStack.length > 0 ? contextStack[contextStack.length - 1].id : fileNodeId;
      edges.push({
        id: `defines_${parentId}_${classId}`,
        source: parentId,
        target: classId,
        relation: 'CONTAINS',
        confidence: 'EXTRACTED',
      });

      if (superclassName) {
        unresolvedInheritance.push({
          classNodeId: classId,
          superclassName,
          line: superNode!.startPosition.row + 1,
        });
      }

      contextStack.push(classNode);

      const body = cursorNode.namedChildren.find((c) => c.type === 'body_statement');
      if (body) {
        for (let i = 0; i < body.namedChildCount; i++) {
          const item = body.namedChild(i);
          if (!item) continue;

          if (item.type === 'call') {
            const callId = item.namedChildren.find((c) => c.type === 'identifier');
            if (callId && (callId.text === 'include' || callId.text === 'extend')) {
              const argList = item.namedChildren.find((c) => c.type === 'argument_list');
              if (argList) {
                const mixinConst = argList.namedChildren.find((c) => c.type === 'constant' || c.type === 'scope_resolution');
                if (mixinConst) {
                  unresolvedInheritance.push({
                    classNodeId: classId,
                    superclassName: mixinConst.text.trim(),
                    line: item.startPosition.row + 1,
                  });
                }
              }
            }
          }

          traverse(item);
        }
      }

      contextStack.pop();
      return;
    }

    // 5. 提取方法 (method / singleton_method)
    if (nodeType === 'method' || nodeType === 'singleton_method') {
      const isSingleton = nodeType === 'singleton_method';
      const nameNode = cursorNode.namedChildren.find((c) => c.type === 'identifier');
      if (!nameNode) return;

      const rawName = nameNode.text.trim();
      const methodName = isSingleton ? `self.${rawName}` : rawName;
      const parentClass = contextStack.length > 0 ? contextStack[contextStack.length - 1] : undefined;
      const classPrefix = parentClass ? `${parentClass.name}.` : '';
      const methodId = formatNodeId(filePath, `${classPrefix}${methodName}`);
      const methodScip = formatScipUri('ruby', filePath, parentClass?.name || '', methodName, 'method');

      const isControllerAction = parentClass?.semanticRole === 'ENTRY';
      const methodNode: CodeNode = {
        id: methodId,
        name: methodName,
        qualifiedName: `${parentClass?.qualifiedName || ''}#${methodName}`,
        entityType: isControllerAction ? 'ENDPOINT' : 'METHOD',
        semanticRole: isControllerAction ? 'ENTRY' : 'SERVICE',
        filePath,
        language: 'ruby',
        scipUri: methodScip,
        loc: {
          startLine: cursorNode.startPosition.row + 1,
          endLine: cursorNode.endPosition.row + 1,
        },
      };

      nodes.push(methodNode);
      if (parentClass) {
        edges.push({
          id: `contains_${parentClass.id}_${methodId}`,
          source: parentClass.id,
          target: methodId,
          relation: 'CONTAINS',
          confidence: 'EXTRACTED',
        });
      } else {
        edges.push({
          id: `defines_${fileNodeId}_${methodId}`,
          source: fileNodeId,
          target: methodId,
          relation: 'CONTAINS',
          confidence: 'EXTRACTED',
        });
      }

      contextStack.push(methodNode);
      const body = cursorNode.namedChildren.find((c) => c.type === 'body_statement');
      if (body) {
        traverse(body);
      }
      contextStack.pop();
      return;
    }

    // 6. 提取 HTTP 客户端请求 (Net::HTTP / Faraday / HTTParty) 与普通调用
    if (nodeType === 'call') {
      const text = cursorNode.text;
      const caller = getCurrentCaller();

      const httpMatch = text.match(/\b(Net::HTTP|Faraday|HTTParty|RestClient)\s*\.\s*(get|post|put|delete|patch)\s*\(/i);
      if (httpMatch && caller) {
        const method = httpMatch[2].toUpperCase();
        const urlCandidate = findStringLiteral(cursorNode);
        if (urlCandidate && (urlCandidate.startsWith('/') || urlCandidate.startsWith('http://') || urlCandidate.startsWith('https://'))) {
          const normPattern = normalizeRoutePattern(urlCandidate);
          unresolvedCalls.push({
            callerNodeId: caller.id,
            calleeExpression: `HTTP_${method}_${normPattern}`,
            apiCallMeta: {
              httpMethod: method,
              routePattern: normPattern,
            },
            line: cursorNode.startPosition.row + 1,
          });
        }
      }

      // 普通调用记录
      if (caller) {
        const idNode = cursorNode.namedChildren.find((c) => c.type === 'identifier');
        if (idNode) {
          const callee = idNode.text.trim();
          if (callee && !['require', 'require_relative', 'include', 'extend', 'before_action'].includes(callee)) {
            unresolvedCalls.push({
              callerNodeId: caller.id,
              calleeExpression: callee,
              line: cursorNode.startPosition.row + 1,
            });
          }
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
    language: 'ruby',
    nodes,
    edges,
    imports,
    unresolvedCalls,
    unresolvedInheritance,
  };
}
