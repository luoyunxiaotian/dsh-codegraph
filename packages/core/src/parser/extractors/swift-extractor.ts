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

export class SwiftExtractor implements LanguageExtractor {
  public readonly language = 'swift';
  public readonly fileExtensions = ['.swift'];
  public readonly wasmGrammarName = 'swift';

  public extractFile(
    tree: Parser.Tree,
    filePath: string,
    sourceCode: string
  ): ExtractedFileResult {
    return extractSwiftFile(tree, filePath, sourceCode);
  }
}

/**
 * 深度解析 Swift 源码文件 (.swift)
 * 提取 Import、Class/Struct/Protocol/Extension、Function/Method、URLSession/Alamofire 客户端请求与继承关系
 */
export function extractSwiftFile(
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
  const fileScip = formatScipUri('swift', filePath, '', fileName, 'def');

  const fileNode: CodeNode = {
    id: fileNodeId,
    name: fileName,
    qualifiedName: formatQualifiedName(filePath, 'file'),
    entityType: 'FILE',
    semanticRole: 'UNKNOWN',
    filePath,
    language: 'swift',
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

  function traverse(cursorNode: Parser.SyntaxNode) {
    const nodeType = cursorNode.type;

    // 2. 提取 import 语句 (import Foundation, import UIKit)
    if (nodeType === 'import_declaration') {
      const idNode = cursorNode.childForFieldName('identifier') || cursorNode.namedChildren.find((c) => c.type === 'identifier');
      if (idNode) {
        const modName = idNode.text.trim();
        imports.push({
          modulePath: modName,
          importedNames: [{ name: modName }],
          isFromImport: true,
          line: cursorNode.startPosition.row + 1,
        });
      }
      return;
    }

    // 3. 提取 protocol 协议声明
    if (nodeType === 'protocol_declaration') {
      const nameNode = cursorNode.childForFieldName('name') || cursorNode.namedChildren.find((c) => c.type === 'type_identifier');
      const protoName = nameNode ? nameNode.text : 'AnonymousProtocol';
      const nodeId = formatNodeId(filePath, protoName);
      const scipUri = formatScipUri('swift', filePath, '', protoName, 'interface');

      const protoNode: CodeNode = {
        id: nodeId,
        name: protoName,
        qualifiedName: formatQualifiedName(filePath, protoName),
        entityType: 'INTERFACE',
        semanticRole: 'UNKNOWN',
        filePath,
        language: 'swift',
        scipUri,
        loc: {
          startLine: cursorNode.startPosition.row + 1,
          endLine: cursorNode.endPosition.row + 1,
        },
      };
      nodes.push(protoNode);

      edges.push({
        id: `contains_${fileNodeId}_${nodeId}`,
        source: fileNodeId,
        target: nodeId,
        relation: 'CONTAINS',
        confidence: 'EXTRACTED',
      });

      // 提取继承的父协议 (inheritance_specifier)
      for (let i = 0; i < cursorNode.namedChildCount; i++) {
        const child = cursorNode.namedChild(i);
        if (child?.type === 'inheritance_specifier') {
          const typeId = child.childForFieldName('type') || child.namedChildren.find((c) => c.type === 'type_identifier' || c.type === 'user_type');
          if (typeId) {
            unresolvedInheritance.push({
              classNodeId: nodeId,
              superclassName: typeId.text.trim(),
              line: child.startPosition.row + 1,
            });
          }
        }
      }

      // 遍历协议内的方法声明
      const bodyNode = cursorNode.childForFieldName('body') || cursorNode.namedChildren.find((c) => c.type === 'protocol_body');
      if (bodyNode) {
        contextStack.push(protoNode);
        for (let i = 0; i < bodyNode.namedChildCount; i++) {
          const child = bodyNode.namedChild(i);
          if (child) traverse(child);
        }
        contextStack.pop();
      }
      return;
    }

    // 4. 提取 class / struct / actor 声明
    if (nodeType === 'class_declaration') {
      const nameNode = cursorNode.childForFieldName('name') || cursorNode.namedChildren.find((c) => c.type === 'type_identifier');
      const rawName = nameNode ? nameNode.text : 'AnonymousType';
      const nodeId = formatNodeId(filePath, rawName);
      const scipUri = formatScipUri('swift', filePath, '', rawName, 'class');

      const classNode: CodeNode = {
        id: nodeId,
        name: rawName,
        qualifiedName: formatQualifiedName(filePath, rawName),
        entityType: 'CLASS',
        semanticRole: 'UNKNOWN',
        filePath,
        language: 'swift',
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

      // 提取父类或协议遵从 (inheritance_specifier)
      for (let i = 0; i < cursorNode.namedChildCount; i++) {
        const child = cursorNode.namedChild(i);
        if (child?.type === 'inheritance_specifier') {
          const typeId = child.childForFieldName('type') || child.namedChildren.find((c) => c.type === 'type_identifier' || c.type === 'user_type');
          if (typeId) {
            const superName = typeId.text.trim();
            if (superName && superName !== rawName) {
              unresolvedInheritance.push({
                classNodeId: nodeId,
                superclassName: superName,
                line: child.startPosition.row + 1,
              });
            }
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

    // 5. 提取 extension 扩展声明 (为已有类型扩展方法和遵循协议)
    if (nodeType === 'extension_declaration') {
      const nameNode = cursorNode.childForFieldName('name') || cursorNode.namedChildren.find((c) => c.type === 'type_identifier' || c.type === 'user_type');
      const extTargetName = nameNode ? nameNode.text : 'ExtensionTarget';

      // 查找当前文件或全局是否已存在该类节点，若无则挂靠至文件
      const existingClass = nodes.find((n) => n.name === extTargetName) || fileNode;

      // 检查 extension 中的协议遵从
      for (let i = 0; i < cursorNode.namedChildCount; i++) {
        const child = cursorNode.namedChild(i);
        if (child?.type === 'inheritance_specifier') {
          const typeId = child.childForFieldName('type') || child.namedChildren.find((c) => c.type === 'type_identifier' || c.type === 'user_type');
          if (typeId) {
            unresolvedInheritance.push({
              classNodeId: existingClass.id,
              superclassName: typeId.text.trim(),
              line: child.startPosition.row + 1,
            });
          }
        }
      }

      const bodyNode = cursorNode.childForFieldName('body') || cursorNode.namedChildren.find((c) => c.type === 'class_body');
      if (bodyNode) {
        contextStack.push(existingClass);
        for (let i = 0; i < bodyNode.namedChildCount; i++) {
          const child = bodyNode.namedChild(i);
          if (child) traverse(child);
        }
        contextStack.pop();
      }
      return;
    }

    // 6. 提取函数与方法定义 (function_declaration / protocol_function_declaration)
    if (nodeType === 'function_declaration' || nodeType === 'protocol_function_declaration') {
      const nameNode = cursorNode.childForFieldName('name') || cursorNode.namedChildren.find((c) => c.type === 'simple_identifier');
      const funcName = nameNode ? nameNode.text : 'anonymous_func';
      const isInsideClass = contextStack.some((n) => n.entityType === 'CLASS' || n.entityType === 'INTERFACE');
      const parentContainer = contextStack[contextStack.length - 1] || fileNode;

      const isEntry = /^(main|viewDidLoad|viewWillAppear|application|scene)$/i.test(funcName);
      const entityType: EntityType = isInsideClass ? 'METHOD' : 'FUNCTION';
      const semanticRole: SemanticRole = isEntry ? 'ENTRY' : 'UNKNOWN';

      const nodeId = formatNodeId(filePath, isInsideClass ? `${parentContainer.name}_${funcName}` : funcName);
      const scipUri = formatScipUri(
        'swift',
        filePath,
        isInsideClass ? parentContainer.name : '',
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
        language: 'swift',
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

      // 遍历函数体内调用
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

    // 7. 提取调用表达式 (call_expression)
    if (nodeType === 'call_expression') {
      const caller = getCurrentCaller() || fileNode;
      const line = cursorNode.startPosition.row + 1;
      const calleeText = cursorNode.text.split('(')[0].trim();

      if (calleeText) {
        // 识别 URLSession / Alamofire 网络请求
        let apiCallMeta: { httpMethod: string; routePattern: string } | undefined;
        if (
          calleeText.includes('URLSession') ||
          calleeText.includes('dataTask') ||
          calleeText.includes('AF.request') ||
          calleeText.startsWith('URL(')
        ) {
          const urlMatch = cursorNode.text.match(/["'](https?:\/\/[^"']+|(?:\/[a-zA-Z0-9_\-\/]+))["']/);
          if (urlMatch) {
            const rawUrl = urlMatch[1];
            const pathMatch = rawUrl.match(/^(?:https?:\/\/[^/]+)?(\/[^?#]*)/);
            apiCallMeta = {
              httpMethod: calleeText.includes('.post') ? 'POST' : 'GET',
              routePattern: normalizeRoutePattern(pathMatch ? pathMatch[1] : rawUrl),
            };
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
    language: 'swift',
    nodes,
    edges,
    imports,
    unresolvedCalls,
    unresolvedInheritance,
  };
}
