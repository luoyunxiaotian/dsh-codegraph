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

export class PhpExtractor implements LanguageExtractor {
  public readonly language = 'php';
  public readonly fileExtensions = ['.php'];
  public readonly wasmGrammarName = 'php';

  public extractFile(
    tree: Parser.Tree,
    filePath: string,
    sourceCode: string
  ): ExtractedFileResult {
    return extractPhpFile(tree, filePath, sourceCode);
  }
}

/**
 * 深度解析 PHP / Laravel / Symfony 源码文件 (.php)
 * 提取 Namespace、Class/Interface/Trait、Method、路由定义与 HTTP 客户端调用
 */
export function extractPhpFile(
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
  const fileScip = formatScipUri('php', filePath, '', fileName, 'def');

  const fileNode: CodeNode = {
    id: fileNodeId,
    name: fileName,
    qualifiedName: formatQualifiedName(filePath, 'file'),
    entityType: 'FILE',
    semanticRole: 'UNKNOWN',
    filePath,
    language: 'php',
    scipUri: fileScip,
    loc: {
      startLine: tree.rootNode.startPosition.row + 1,
      endLine: tree.rootNode.endPosition.row + 1,
    },
  };
  nodes.push(fileNode);

  let currentNamespace = '';
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

    // 2. 提取 namespace
    if (nodeType === 'namespace_definition') {
      const nsNameNode = cursorNode.namedChildren.find((c) => c.type === 'namespace_name');
      if (nsNameNode) {
        currentNamespace = nsNameNode.text.trim();
      }
    }

    // 3. 提取 use (namespace_use_declaration)
    if (nodeType === 'namespace_use_declaration') {
      for (let i = 0; i < cursorNode.namedChildCount; i++) {
        const clause = cursorNode.namedChild(i);
        if (!clause || clause.type !== 'namespace_use_clause') continue;

        const fullName = clause.text.trim().replace(/;$/, '');
        const aliasMatch = fullName.match(/\s+as\s+(\w+)$/i);
        const modPath = aliasMatch ? fullName.replace(/\s+as\s+\w+$/i, '').trim() : fullName;
        const alias = aliasMatch ? aliasMatch[1] : undefined;
        const shortName = alias || modPath.split('\\').pop() || modPath;

        imports.push({
          modulePath: modPath,
          importedNames: [{ name: shortName, alias }],
          isFromImport: true,
          line: cursorNode.startPosition.row + 1,
        });
      }
      return;
    }

    // 4. 提取 Class / Interface / Trait
    if (
      nodeType === 'class_declaration' ||
      nodeType === 'interface_declaration' ||
      nodeType === 'trait_declaration'
    ) {
      const isInterface = nodeType === 'interface_declaration';
      const isTrait = nodeType === 'trait_declaration';
      const nameNode = cursorNode.namedChildren.find((c) => c.type === 'name');
      if (!nameNode) return;

      const className = nameNode.text.trim();
      const qualifiedName = currentNamespace ? `${currentNamespace}\\${className}` : className;
      const classId = formatNodeId(filePath, className);
      const classScip = formatScipUri('php', filePath, currentNamespace, className, isInterface || isTrait ? 'interface' : 'class');

      let role: SemanticRole = 'UNKNOWN';
      if (
        className.endsWith('Controller') ||
        cursorNode.text.includes('extends Controller')
      ) {
        role = 'ENTRY';
      } else if (
        className.endsWith('Model') ||
        className.endsWith('Entity') ||
        cursorNode.text.includes('extends Model')
      ) {
        role = 'MODEL';
      } else if (
        className.endsWith('Service') ||
        className.endsWith('Repository') ||
        className.endsWith('Provider')
      ) {
        role = 'SERVICE';
      }

      const classNode: CodeNode = {
        id: classId,
        name: className,
        qualifiedName,
        entityType: isInterface || isTrait ? 'INTERFACE' : 'CLASS',
        semanticRole: role,
        filePath,
        language: 'php',
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

      // 提取继承 base_clause (extends) 和 class_interface_clause (implements)
      const baseClause = cursorNode.namedChildren.find((c) => c.type === 'base_clause');
      if (baseClause) {
        const parentNameNode = baseClause.namedChildren.find((c) => c.type === 'name' || c.type === 'qualified_name');
        if (parentNameNode) {
          const parentName = parentNameNode.text.trim();
          unresolvedInheritance.push({
            classNodeId: classId,
            superclassName: parentName,
            line: baseClause.startPosition.row + 1,
          });
        }
      }

      const interfaceClause = cursorNode.namedChildren.find((c) => c.type === 'class_interface_clause');
      if (interfaceClause) {
        for (let i = 0; i < interfaceClause.namedChildCount; i++) {
          const item = interfaceClause.namedChild(i);
          if (item && (item.type === 'name' || item.type === 'qualified_name')) {
            const ifaceName = item.text.trim();
            unresolvedInheritance.push({
              classNodeId: classId,
              superclassName: ifaceName,
              line: item.startPosition.row + 1,
            });
          }
        }
      }

      contextStack.push(classNode);

      // 处理 declaration_list
      const declList = cursorNode.namedChildren.find((c) => c.type === 'declaration_list');
      if (declList) {
        for (let j = 0; j < declList.namedChildCount; j++) {
          const member = declList.namedChild(j);
          if (!member) continue;

          // Trait use 声明 (use LoggableTrait;)
          if (member.type === 'use_declaration') {
            const traitNameNode = member.namedChildren.find((c) => c.type === 'name' || c.type === 'qualified_name');
            if (traitNameNode) {
              unresolvedInheritance.push({
                classNodeId: classId,
                superclassName: traitNameNode.text.trim(),
                line: member.startPosition.row + 1,
              });
            }
            continue;
          }

          // 方法声明 (method_declaration)
          if (member.type === 'method_declaration') {
            const methodNameNode = member.namedChildren.find((c) => c.type === 'name');
            if (methodNameNode) {
              const methodName = methodNameNode.text.trim();
              const methodId = formatNodeId(filePath, `${className}.${methodName}`);
              const methodScip = formatScipUri('php', filePath, className, methodName, 'method');

              const isControllerMethod = role === 'ENTRY';
              const methodNode: CodeNode = {
                id: methodId,
                name: methodName,
                qualifiedName: `${qualifiedName}::${methodName}`,
                entityType: isControllerMethod ? 'ENDPOINT' : 'METHOD',
                semanticRole: isControllerMethod ? 'ENTRY' : 'SERVICE',
                filePath,
                language: 'php',
                scipUri: methodScip,
                loc: {
                  startLine: member.startPosition.row + 1,
                  endLine: member.endPosition.row + 1,
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

              contextStack.push(methodNode);
              const body = member.namedChildren.find((c) => c.type === 'compound_statement');
              if (body) {
                traverse(body);
              }
              contextStack.pop();
            }
            continue;
          }

          traverse(member);
        }
      }

      contextStack.pop();
      return;
    }

    // 5. 顶层函数声明 (function_definition)
    if (nodeType === 'function_definition') {
      const nameNode = cursorNode.namedChildren.find((c) => c.type === 'name');
      if (nameNode) {
        const funcName = nameNode.text.trim();
        const funcId = formatNodeId(filePath, funcName);
        const funcScip = formatScipUri('php', filePath, currentNamespace, funcName, 'def');

        const funcNode: CodeNode = {
          id: funcId,
          name: funcName,
          qualifiedName: currentNamespace ? `${currentNamespace}\\${funcName}` : funcName,
          entityType: 'FUNCTION',
          semanticRole: 'SERVICE',
          filePath,
          language: 'php',
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

        contextStack.push(funcNode);
        const body = cursorNode.namedChildren.find((c) => c.type === 'compound_statement');
        if (body) {
          traverse(body);
        }
        contextStack.pop();
      }
      return;
    }

    // 6. 提取 Laravel 路由注册 (Route::get('/path', ...)) 或 HTTP 请求 (Http::post(...))
    if (nodeType === 'scoped_call_expression' || nodeType === 'member_call_expression') {
      const text = cursorNode.text;
      const caller = getCurrentCaller();

      // 检测 Laravel Route::get/post
      const routeMatch = text.match(/Route::(get|post|put|delete|patch|match|any)\s*\(\s*['"]([^'"]+)['"]/i);
      if (routeMatch) {
        const verb = routeMatch[1].toUpperCase();
        const path = routeMatch[2];
        const normPath = normalizeRoutePattern(path);

        const routeId = formatNodeId(filePath, `route_${verb}_${normPath}`);
        const routeNode: CodeNode = {
          id: routeId,
          name: `${verb} ${normPath}`,
          qualifiedName: `${verb} ${normPath}`,
          entityType: 'ENDPOINT',
          semanticRole: 'ENTRY',
          filePath,
          language: 'php',
          scipUri: formatScipUri('php', filePath, 'Route', `${verb}_${normPath}`, 'def'),
          loc: {
            startLine: cursorNode.startPosition.row + 1,
            endLine: cursorNode.endPosition.row + 1,
          },
          endpointMeta: {
            httpMethod: verb,
            routePath: normPath,
            isClientCall: false,
          },
        };

        nodes.push(routeNode);
        edges.push({
          id: `defines_${fileNodeId}_${routeId}`,
          source: fileNodeId,
          target: routeId,
          relation: 'CONTAINS',
          confidence: 'EXTRACTED',
        });

        if (caller) {
          edges.push({
            id: `calls_${caller.id}_${routeId}`,
            source: caller.id,
            target: routeId,
            relation: 'CALLS',
            confidence: 'EXTRACTED',
          });
        }
      }

      // 检测 Http::get / Http::post 网络客户端请求
      const httpMatch = text.match(/\b(Http::|\$client->|\$httpClient->)(get|post|put|delete|patch)\s*\(\s*['"]([^'"]+)['"]/i);
      if (httpMatch && caller) {
        const method = httpMatch[2].toUpperCase();
        const url = httpMatch[3];
        const normPattern = normalizeRoutePattern(url);
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

      // 普通方法调用捕获
      if (caller) {
        const memberName = cursorNode.namedChildren.find((c) => c.type === 'name')?.text.trim();
        if (memberName && !['get', 'post', 'put', 'delete'].includes(memberName)) {
          unresolvedCalls.push({
            callerNodeId: caller.id,
            calleeExpression: memberName,
            line: cursorNode.startPosition.row + 1,
          });
        }
      }
    }

    // 7. 对象实例化 ($service = new AuthService())
    if (nodeType === 'object_creation_expression') {
      const caller = getCurrentCaller();
      const clsNameNode = cursorNode.namedChildren.find((c) => c.type === 'name' || c.type === 'qualified_name');
      if (caller && clsNameNode) {
        unresolvedCalls.push({
          callerNodeId: caller.id,
          calleeExpression: clsNameNode.text.trim(),
          line: cursorNode.startPosition.row + 1,
        });
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
    language: 'php',
    nodes,
    edges,
    imports,
    unresolvedCalls,
    unresolvedInheritance,
  };
}
