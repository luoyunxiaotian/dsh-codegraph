import {
  CodeNode,
  CodeEdge,
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

export class UnityAsmdefExtractor implements LanguageExtractor {
  public readonly language = 'unity';
  public readonly fileExtensions = ['.asmdef', '.asmref'];
  public readonly wasmGrammarName = 'none';

  public extractFile(
    _tree: any,
    filePath: string,
    sourceCode: string
  ): ExtractedFileResult {
    return extractUnityAsmdefFile(filePath, sourceCode);
  }
}

/**
 * 深度解析 Unity 程序集定义文件 (.asmdef / .asmref)
 * 提取 Unity 模块边界、命名空间、程序集依赖网与跨模块调用中枢
 */
export function extractUnityAsmdefFile(
  filePath: string,
  sourceCode: string
): ExtractedFileResult {
  const nodes: CodeNode[] = [];
  const edges: CodeEdge[] = [];
  const imports: FileImportInfo[] = [];
  const unresolvedCalls: UnresolvedCall[] = [];
  const unresolvedInheritance: UnresolvedInheritance[] = [];

  const lineCount = sourceCode.split('\n').length;
  const fileName = filePath.split(/[/\\]/).pop() || filePath;
  const isAsmref = filePath.toLowerCase().endsWith('.asmref');

  // 1. 创建文件节点
  const fileNodeId = formatNodeId(filePath, 'file');
  const fileNode: CodeNode = {
    id: fileNodeId,
    name: fileName,
    qualifiedName: formatQualifiedName(filePath, 'file'),
    entityType: 'FILE',
    semanticRole: 'UNKNOWN',
    filePath,
    language: 'unity',
    scipUri: formatScipUri('unity', filePath, '', fileName, 'def'),
    loc: { startLine: 1, endLine: lineCount },
  };
  nodes.push(fileNode);

  try {
    const data = JSON.parse(sourceCode);

    if (isAsmref) {
      // 2. 解析 .asmref (程序集引用别名)
      const refTarget = typeof data.reference === 'string' ? data.reference.trim() : '';
      const moduleName = fileName.replace(/\.asmref$/i, '');
      const moduleId = formatNodeId(filePath, moduleName);

      const moduleNode: CodeNode = {
        id: moduleId,
        name: moduleName,
        qualifiedName: formatQualifiedName(filePath, moduleName),
        entityType: 'MODULE',
        semanticRole: 'UTIL',
        filePath,
        language: 'unity',
        scipUri: formatScipUri('unity', filePath, '', moduleName, 'class'),
        metadata: {
          isAsmref: true,
          reference: refTarget,
        },
        loc: { startLine: 1, endLine: lineCount },
      };
      nodes.push(moduleNode);

      edges.push({
        id: `contains_${fileNodeId}_${moduleId}`,
        source: fileNodeId,
        target: moduleId,
        relation: 'CONTAINS',
        confidence: 'EXTRACTED',
      });

      if (refTarget) {
        imports.push({
          modulePath: refTarget,
          importedNames: [{ name: refTarget }],
          line: 1,
        });

        unresolvedCalls.push({
          callerNodeId: moduleId,
          calleeExpression: refTarget,
          line: 1,
        });

        edges.push({
          id: `import_${moduleId}_${refTarget}`,
          source: moduleId,
          target: refTarget,
          relation: 'IMPORTS',
          confidence: 'EXTRACTED',
          sourceLine: 1,
        });
      }
    } else {
      // 3. 解析 .asmdef (Unity 核心程序集定义)
      const asmName = (typeof data.name === 'string' && data.name.trim())
        ? data.name.trim()
        : fileName.replace(/\.asmdef$/i, '');

      const moduleId = formatNodeId(filePath, asmName);
      const lowerName = asmName.toLowerCase();
      let role: 'SERVICE' | 'UTIL' | 'INFRA' = 'SERVICE';
      if (lowerName.includes('editor') || lowerName.includes('test')) {
        role = 'UTIL';
      } else if (lowerName.includes('core') || lowerName.includes('infra') || lowerName.includes('engine')) {
        role = 'INFRA';
      }

      const moduleNode: CodeNode = {
        id: moduleId,
        name: asmName,
        qualifiedName: data.rootNamespace ? `${data.rootNamespace}.${asmName}` : asmName,
        entityType: 'MODULE',
        semanticRole: role,
        filePath,
        language: 'unity',
        scipUri: formatScipUri('unity', filePath, '', asmName, 'class'),
        metadata: {
          rootNamespace: data.rootNamespace,
          allowUnsafeCode: data.allowUnsafeCode,
          includePlatforms: data.includePlatforms,
          excludePlatforms: data.excludePlatforms,
          autoReferenced: data.autoReferenced,
          noEngineReferences: data.noEngineReferences,
        },
        loc: { startLine: 1, endLine: lineCount },
      };
      nodes.push(moduleNode);

      edges.push({
        id: `contains_${fileNodeId}_${moduleId}`,
        source: fileNodeId,
        target: moduleId,
        relation: 'CONTAINS',
        confidence: 'EXTRACTED',
      });

      // 4. 解析 references 依赖列表
      if (Array.isArray(data.references)) {
        for (const ref of data.references) {
          if (typeof ref === 'string' && ref.trim()) {
            const rawRef = ref.trim();
            const cleanRef = rawRef.replace(/^guid:/i, '');

            imports.push({
              modulePath: cleanRef,
              importedNames: [{ name: cleanRef }],
              line: 1,
            });

            unresolvedCalls.push({
              callerNodeId: moduleId,
              calleeExpression: cleanRef,
              line: 1,
            });

            edges.push({
              id: `import_${moduleId}_${cleanRef}`,
              source: moduleId,
              target: cleanRef,
              relation: 'IMPORTS',
              confidence: 'EXTRACTED',
              sourceLine: 1,
            });
          }
        }
      }
    }
  } catch (err) {
    console.warn(`[UnityAsmdefExtractor] 解析 Unity 文件失败: ${filePath}`, err);
  }

  return {
    filePath,
    language: 'unity',
    nodes,
    edges,
    imports,
    unresolvedCalls,
    unresolvedInheritance,
  };
}
