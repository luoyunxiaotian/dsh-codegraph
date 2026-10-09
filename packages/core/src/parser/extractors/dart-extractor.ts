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

export class DartExtractor implements LanguageExtractor {
  public readonly language = 'dart';
  public readonly fileExtensions = ['.dart'];
  public readonly wasmGrammarName = 'dart';

  public extractFile(
    tree: Parser.Tree,
    filePath: string,
    sourceCode: string
  ): ExtractedFileResult {
    return extractDartFile(tree, filePath, sourceCode);
  }
}

/**
 * 深度解析 Dart / Flutter 源码文件 (.dart)
 * 提取 Import、Class/Widget、Method/Function、Mixin、继承实现与 HTTP 客户端网络请求 (http/dio)
 */
export function extractDartFile(
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
  const fileScip = formatScipUri('dart', filePath, '', fileName, 'def');

  const fileNode: CodeNode = {
    id: fileNodeId,
    name: fileName,
    qualifiedName: formatQualifiedName(filePath, 'file'),
    entityType: 'FILE',
    semanticRole: 'UNKNOWN',
    filePath,
    language: 'dart',
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

  // 辅助查找类型标识符
  function extractTypeIdentifiers(node: Parser.SyntaxNode): string[] {
    const results: string[] = [];
    function scan(n: Parser.SyntaxNode) {
      if (n.type === 'type_identifier' || n.type === 'identifier') {
        const txt = n.text.trim();
        if (txt && !['extends', 'implements', 'with'].includes(txt)) {
          results.push(txt);
        }
      }
      for (let i = 0; i < n.namedChildCount; i++) {
        const c = n.namedChild(i);
        if (c) scan(c);
      }
    }
    scan(node);
    return results;
  }

  // 提取 URL 字符串
  function findUrlLiteral(node: Parser.SyntaxNode): string | undefined {
    if (node.type === 'string_literal') {
      const text = node.text.trim().replace(/^['"]|['"]$/g, '');
      if (text.startsWith('/') || text.startsWith('http://') || text.startsWith('https://')) {
        return text;
      }
    }
    for (let i = 0; i < node.namedChildCount; i++) {
      const c = node.namedChild(i);
      if (c) {
        const found = findUrlLiteral(c);
        if (found) return found;
      }
    }
    return undefined;
  }

  // 遍历 AST
  function traverse(cursorNode: Parser.SyntaxNode) {
    const nodeType = cursorNode.type;

    // 2. 提取 import (import 'package:flutter/material.dart';)
    if (nodeType === 'import_or_export' || nodeType === 'library_import') {
      let uriText = '';
      let aliasText: string | undefined;

      for (let i = 0; i < cursorNode.namedChildCount; i++) {
        const child = cursorNode.namedChild(i);
        if (!child) continue;
        if (child.type === 'import_specification' || child.type === 'string_literal') {
          uriText = child.text.trim().replace(/^['"]|['"]$/g, '');
        } else if (child.type === 'prefix') {
          // as alias
          const id = child.namedChildren.find((c) => c.type === 'identifier');
          if (id) aliasText = id.text.trim();
        }
      }

      if (!uriText) {
        const match = cursorNode.text.match(/['"]([^'"]+)['"]/);
        if (match) uriText = match[1];
      }

      if (uriText) {
        const modName = aliasText || uriText.split('/').pop()?.replace('.dart', '') || uriText;
        imports.push({
          modulePath: uriText,
          importedNames: [{ name: modName, alias: aliasText }],
          isFromImport: uriText.startsWith('package:') || uriText.startsWith('dart:'),
          line: cursorNode.startPosition.row + 1,
        });
      }
      return;
    }

    // 3. 提取 class / mixin 定义
    if (nodeType === 'class_definition' || nodeType === 'mixin_declaration') {
      const isMixin = nodeType === 'mixin_declaration';
      const nameNode = cursorNode.namedChildren.find((c) => c.type === 'identifier');
      if (!nameNode) return;

      const className = nameNode.text.trim();
      const classId = formatNodeId(filePath, className);
      const classScip = formatScipUri('dart', filePath, '', className, isMixin ? 'interface' : 'class');

      let semanticRole: SemanticRole = 'UNKNOWN';
      const fullHeader = cursorNode.text.slice(0, 200);

      if (
        fullHeader.includes('Widget') ||
        fullHeader.includes('State<') ||
        className.endsWith('Page') ||
        className.endsWith('Screen') ||
        className.endsWith('Widget') ||
        className.endsWith('View')
      ) {
        semanticRole = 'ENTRY';
      } else if (
        className.endsWith('Controller') ||
        className.endsWith('Bloc') ||
        className.endsWith('Cubit') ||
        className.endsWith('Notifier') ||
        className.endsWith('ViewModel')
      ) {
        semanticRole = 'ENTRY';
      } else if (
        className.endsWith('Service') ||
        className.endsWith('Repository') ||
        className.endsWith('Client') ||
        className.endsWith('Api')
      ) {
        semanticRole = 'SERVICE';
      } else if (
        className.endsWith('Model') ||
        className.endsWith('Dto') ||
        className.endsWith('Entity')
      ) {
        semanticRole = 'MODEL';
      } else {
        semanticRole = 'UNKNOWN';
      }

      const classNode: CodeNode = {
        id: classId,
        name: className,
        qualifiedName: formatQualifiedName(filePath, className),
        entityType: isMixin ? 'INTERFACE' : 'CLASS',
        semanticRole,
        filePath,
        language: 'dart',
        scipUri: classScip,
        loc: {
          startLine: cursorNode.startPosition.row + 1,
          endLine: cursorNode.endPosition.row + 1,
        },
      };

      nodes.push(classNode);
      edges.push({
        id: `defines_${fileNodeId}_${classId}`,
        source: fileNodeId,
        target: classId,
        relation: 'CONTAINS',
        confidence: 'EXTRACTED',
      });

      // 提取继承 (superclass, mixins, interfaces)
      for (let i = 0; i < cursorNode.namedChildCount; i++) {
        const child = cursorNode.namedChild(i);
        if (!child) continue;
        if (
          child.type === 'superclass' ||
          child.type === 'mixins' ||
          child.type === 'interfaces'
        ) {
          const parentNames = extractTypeIdentifiers(child);
          for (const parentName of parentNames) {
            unresolvedInheritance.push({
              classNodeId: classId,
              superclassName: parentName,
              line: child.startPosition.row + 1,
            });
          }
        }
      }

      contextStack.push(classNode);

      // 处理 class_body
      const bodyNode = cursorNode.namedChildren.find((c) => c.type === 'class_body');
      if (bodyNode) {
        for (let j = 0; j < bodyNode.namedChildCount; j++) {
          const child = bodyNode.namedChild(j);
          if (!child) continue;

          if (child.type === 'method_signature') {
            const funcSig = child.namedChildren.find((c) => c.type === 'function_signature') || child;
            const idNode = funcSig.namedChildren.find((c) => c.type === 'identifier') || child.namedChildren.find((c) => c.type === 'identifier');
            if (idNode) {
              const methodName = idNode.text.trim();
              const methodId = formatNodeId(filePath, `${className}.${methodName}`);
              const methodScip = formatScipUri('dart', filePath, className, methodName, 'method');

              let role: SemanticRole = 'UNKNOWN';
              if (['build', 'initState', 'dispose', 'didUpdateWidget'].includes(methodName)) {
                role = 'ENTRY';
              }

              const methodNode: CodeNode = {
                id: methodId,
                name: methodName,
                qualifiedName: formatQualifiedName(filePath, `${className}.${methodName}`),
                entityType: 'METHOD',
                semanticRole: role,
                filePath,
                language: 'dart',
                scipUri: methodScip,
                loc: {
                  startLine: child.startPosition.row + 1,
                  endLine: child.endPosition.row + 1,
                },
              };

              nodes.push(methodNode);
              edges.push({
                id: `contains_${classId}_${methodId}`,
                source: classId,
                target: methodId,
                relation: 'CONTAINS',
                confidence: 'EXTRACTED',
              });

              const nextNode = bodyNode.namedChild(j + 1);
              if (nextNode && nextNode.type === 'function_body') {
                contextStack.push(methodNode);
                traverse(nextNode);
                contextStack.pop();
                j++;
                continue;
              }
            }
          } else {
            traverse(child);
          }
        }
      }

      contextStack.pop();
      return;
    }

    // 4. 提取顶层函数 (function_signature + function_body)
    if (nodeType === 'function_signature') {
      const idNode = cursorNode.namedChildren.find((c) => c.type === 'identifier');
      if (idNode) {
        const funcName = idNode.text.trim();
        const funcId = formatNodeId(filePath, funcName);
        const funcScip = formatScipUri('dart', filePath, '', funcName, 'def');

        const funcNode: CodeNode = {
          id: funcId,
          name: funcName,
          qualifiedName: formatQualifiedName(filePath, funcName),
          entityType: 'FUNCTION',
          semanticRole: funcName === 'main' ? 'ENTRY' : 'SERVICE',
          filePath,
          language: 'dart',
          scipUri: funcScip,
          loc: {
            startLine: cursorNode.startPosition.row + 1,
            endLine: cursorNode.endPosition.row + 1,
          },
        };

        nodes.push(funcNode);
        edges.push({
          id: `defines_${fileNodeId}_${funcId}`,
          source: fileNodeId,
          target: funcId,
          relation: 'CONTAINS',
          confidence: 'EXTRACTED',
        });

        const parent = cursorNode.parent;
        if (parent) {
          const body = parent.namedChildren.find((c) => c.type === 'function_body');
          if (body) {
            contextStack.push(funcNode);
            traverse(body);
            contextStack.pop();
          }
        }
      }
      return;
    }

    // 5. 提取 HTTP 客户端请求 (http.get/post, dio.get/post) 与普通调用
    if (nodeType === 'expression_statement' || nodeType === 'selector' || nodeType === 'argument_part') {
      const exprText = cursorNode.text;

      const httpMatch = exprText.match(/\b(http|dio|client)\s*\.\s*(get|post|put|delete|patch|head)\s*\(/i);
      if (httpMatch) {
        const method = httpMatch[2].toUpperCase();
        const caller = getCurrentCaller();
        const urlCandidate = findUrlLiteral(cursorNode);

        if (caller && urlCandidate) {
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
    }

    // 6. 普通方法/函数调用
    if (nodeType === 'selector' && cursorNode.namedChildren.some((c) => c.type === 'argument_part')) {
      const caller = getCurrentCaller();
      if (caller) {
        const firstId = cursorNode.namedChildren.find((c) => c.type === 'identifier');
        if (firstId) {
          const calleeName = firstId.text.trim();
          if (calleeName && calleeName.length > 1) {
            unresolvedCalls.push({
              callerNodeId: caller.id,
              calleeExpression: calleeName,
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
    language: 'dart',
    nodes,
    edges,
    imports,
    unresolvedCalls,
    unresolvedInheritance,
  };
}
