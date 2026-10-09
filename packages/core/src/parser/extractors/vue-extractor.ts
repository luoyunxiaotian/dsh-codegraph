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

export class VueExtractor implements LanguageExtractor {
  public readonly language = 'vue';
  public readonly fileExtensions = ['.vue'];
  public readonly wasmGrammarName = 'vue';

  public extractFile(
    tree: Parser.Tree,
    filePath: string,
    sourceCode: string
  ): ExtractedFileResult {
    return extractVueFile(tree, filePath, sourceCode);
  }
}

/**
 * 深度解析 Vue 单文件组件 (.vue)
 * 提取根组件节点、<script>/<script setup> 内部导包、状态、函数与网络请求，以及 <template> 模板子组件引用
 */
export function extractVueFile(
  tree: Parser.Tree,
  filePath: string,
  sourceCode: string
): ExtractedFileResult {
  const nodes: CodeNode[] = [];
  const edges: CodeEdge[] = [];
  const imports: FileImportInfo[] = [];
  const unresolvedCalls: UnresolvedCall[] = [];
  const unresolvedInheritance: UnresolvedInheritance[] = [];

  // 1. 创建文件与根组件节点 (Vue Component)
  const fileNodeId = formatNodeId(filePath, 'file');
  const fileName = filePath.split(/[/\\]/).pop() || filePath;
  const componentName = fileName.replace(/\.vue$/i, '') || 'AnonymousComponent';
  const fileScip = formatScipUri('vue', filePath, '', fileName, 'def');

  const fileNode: CodeNode = {
    id: fileNodeId,
    name: fileName,
    qualifiedName: formatQualifiedName(filePath, 'file'),
    entityType: 'FILE',
    semanticRole: 'UNKNOWN',
    filePath,
    language: 'vue',
    scipUri: fileScip,
    loc: {
      startLine: 1,
      endLine: Math.max(1, sourceCode.split('\n').length),
    },
  };
  nodes.push(fileNode);

  // 2. 将 Vue 组件本身登记为核心容器节点
  const componentNodeId = formatNodeId(filePath, componentName);
  const componentNode: CodeNode = {
    id: componentNodeId,
    name: componentName,
    qualifiedName: formatQualifiedName(filePath, componentName),
    entityType: 'CLASS',
    semanticRole: 'UNKNOWN',
    filePath,
    language: 'vue',
    scipUri: formatScipUri('vue', filePath, '', componentName, 'class'),
    loc: {
      startLine: 1,
      endLine: fileNode.loc.endLine,
    },
  };
  nodes.push(componentNode);

  edges.push({
    id: `contains_${fileNodeId}_${componentNodeId}`,
    source: fileNodeId,
    target: componentNodeId,
    relation: 'CONTAINS',
    confidence: 'EXTRACTED',
  });

  // 3. 提取 <script> 或 <script setup> 代码块
  let scriptCode = '';
  let scriptStartLine = 1;

  // 策略 A: 从 tree-sitter-vue AST 提取 script_element
  try {
    for (let i = 0; i < tree.rootNode.namedChildCount; i++) {
      const child = tree.rootNode.namedChild(i);
      if (child && child.type === 'script_element') {
        scriptStartLine = child.startPosition.row + 1;
        const textNode = child.childForFieldName('text') || child.namedChildren.find((c) => c.type === 'raw_text');
        if (textNode) {
          scriptCode = textNode.text;
        } else {
          scriptCode = child.text.replace(/^<script[^>]*>|<\/script>$/gi, '');
        }
        break;
      }
    }
  } catch {}

  // 策略 B: 兜底正则提取
  if (!scriptCode) {
    const scriptMatch = sourceCode.match(/<script\b[^>]*>([\s\S]*?)<\/script>/i);
    if (scriptMatch) {
      scriptCode = scriptMatch[1];
      const prefix = sourceCode.slice(0, scriptMatch.index || 0);
      scriptStartLine = prefix.split('\n').length;
    }
  }

  // 4. 解析 Script 代码块中的 Import 导入与函数定义
  if (scriptCode) {
    const lines = scriptCode.split('\n');

    // 4.1 提取 Import 语句
    // 支持: import A from './A.vue'; import { b, c as d } from 'pkg'; import './style.css';
    const importRegex = /import\s+(?:([\w*\s{},]+)\s+from\s+)?['"]([^'"]+)['"]/g;
    let match: RegExpExecArray | null;
    while ((match = importRegex.exec(scriptCode)) !== null) {
      const importClause = match[1]?.trim();
      const modulePath = match[2]?.trim();
      if (!modulePath) continue;

      const lineOffset = scriptCode.slice(0, match.index).split('\n').length;
      const actualLine = scriptStartLine + lineOffset - 1;

      const importedNames: Array<{ name: string; alias?: string }> = [];
      if (importClause) {
        if (importClause.includes('{')) {
          const namedPart = importClause.replace(/^.*?\{|\}.*$/g, '');
          namedPart.split(',').forEach((p) => {
            const item = p.trim();
            if (!item) return;
            if (item.includes(' as ')) {
              const [orig, alias] = item.split(/\s+as\s+/);
              importedNames.push({ name: orig.trim(), alias: alias.trim() });
            } else {
              importedNames.push({ name: item });
            }
          });
        }
        const defaultMatch = importClause.replace(/\{[\s\S]*\}/, '').trim();
        if (defaultMatch) {
          const defName = defaultMatch.replace(/,/g, '').trim();
          if (defName) {
            importedNames.push({ name: defName });
          }
        }
      }

      imports.push({
        modulePath,
        importedNames: importedNames.length > 0 ? importedNames : [{ name: modulePath }],
        isFromImport: !!importClause,
        line: actualLine,
      });
    }

    // 4.2 提取函数/方法定义与网络 API 请求
    // 支持: function doSomething() {}, const load = async () => {}, const fetchData = function() {}
    const funcRegex = /(?:function\s+([a-zA-Z_$][\w$]*)|(?:const|let|var)\s+([a-zA-Z_$][\w$]*)\s*=\s*(?:async\s*)?(?:\([^)]*\)|[a-zA-Z_$][\w$]*)\s*=>)/g;
    while ((match = funcRegex.exec(scriptCode)) !== null) {
      const funcName = match[1] || match[2];
      if (!funcName) continue;

      const lineOffset = scriptCode.slice(0, match.index).split('\n').length;
      const actualLine = scriptStartLine + lineOffset - 1;

      const funcNodeId = formatNodeId(filePath, `${componentName}_${funcName}`);
      const funcNode: CodeNode = {
        id: funcNodeId,
        name: funcName,
        qualifiedName: formatQualifiedName(filePath, `${componentName}.${funcName}`),
        entityType: 'FUNCTION',
        semanticRole: 'UNKNOWN',
        filePath,
        language: 'vue',
        scipUri: formatScipUri('vue', filePath, componentName, funcName, 'method'),
        loc: {
          startLine: actualLine,
          endLine: actualLine,
        },
      };

      nodes.push(funcNode);
      edges.push({
        id: `contains_${componentNodeId}_${funcNodeId}`,
        source: componentNodeId,
        target: funcNodeId,
        relation: 'CONTAINS',
        confidence: 'EXTRACTED',
      });
    }

    // 4.3 提取客户端调用 (fetch, axios.get, apiCall)
    const clientCallRegex = /(?:fetch|axios\.(get|post|put|delete)|client\.(get|post)|request\.(get|post))\s*\(\s*['"`]([^'"`]+)['"`]/g;
    while ((match = clientCallRegex.exec(scriptCode)) !== null) {
      const httpMethod = (match[1] || match[2] || match[3] || 'GET').toUpperCase();
      const rawUrl = match[4];
      const lineOffset = scriptCode.slice(0, match.index).split('\n').length;
      const actualLine = scriptStartLine + lineOffset - 1;

      const pathMatch = rawUrl.match(/^(?:https?:\/\/[^/]+)?(\/[^?#]*)/);
      const routePattern = normalizeRoutePattern(pathMatch ? pathMatch[1] : rawUrl);

      unresolvedCalls.push({
        callerNodeId: componentNodeId,
        calleeExpression: match[0],
        line: actualLine,
        apiCallMeta: {
          httpMethod,
          routePattern,
        },
      });
    }

    // 4.4 提取常规方法调用
    const generalCallRegex = /(?:([a-zA-Z_$][\w$]*)\s*\()/g;
    while ((match = generalCallRegex.exec(scriptCode)) !== null) {
      const callee = match[1];
      if (
        callee &&
        !['import', 'function', 'if', 'for', 'while', 'switch', 'catch', 'return'].includes(callee)
      ) {
        const lineOffset = scriptCode.slice(0, match.index).split('\n').length;
        const actualLine = scriptStartLine + lineOffset - 1;
        unresolvedCalls.push({
          callerNodeId: componentNodeId,
          calleeExpression: callee,
          line: actualLine,
        });
      }
    }
  }

  // 5. 扫描 <template> 中的子组件使用 (如 <UserCard />, <ProfileHeader :prop="x">)
  const templateMatch = sourceCode.match(/<template\b[^>]*>([\s\S]*?)<\/template>/i);
  if (templateMatch) {
    const templateContent = templateMatch[1];
    // 匹配 PascalCase 自定义组件标签
    const tagMatches = templateContent.matchAll(/<([A-Z][a-zA-Z0-9]+)\b/g);
    const seenTags = new Set<string>();

    for (const t of tagMatches) {
      const tag = t[1];
      if (!seenTags.has(tag) && tag !== componentName) {
        seenTags.add(tag);
        // 记录组件调用与渲染关联
        unresolvedCalls.push({
          callerNodeId: componentNodeId,
          calleeExpression: tag,
          line: 1,
        });
      }
    }
  }

  return {
    filePath,
    language: 'vue',
    nodes,
    edges,
    imports,
    unresolvedCalls,
    unresolvedInheritance,
  };
}
