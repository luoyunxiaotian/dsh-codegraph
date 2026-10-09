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

export class SqlExtractor implements LanguageExtractor {
  public readonly language = 'sql';
  public readonly fileExtensions = ['.sql'];
  public readonly wasmGrammarName = 'none';

  public extractFile(
    _tree: any,
    filePath: string,
    sourceCode: string
  ): ExtractedFileResult {
    return extractSqlFile(filePath, sourceCode);
  }
}

/**
 * 深度解析 SQL DDL 结构定义文件 (.sql)
 * 提取 Table 数据表、Primary/Foreign Key 跨表关联外键依赖网、View 视图及其数据消费链
 */
export function extractSqlFile(
  filePath: string,
  sourceCode: string
): ExtractedFileResult {
  const nodes: CodeNode[] = [];
  const edges: CodeEdge[] = [];
  const imports: FileImportInfo[] = [];
  const unresolvedCalls: UnresolvedCall[] = [];
  const unresolvedInheritance: UnresolvedInheritance[] = [];

  const lines = sourceCode.split('\n');
  const fileName = filePath.split(/[/\\]/).pop() || filePath;

  // 1. 创建文件节点
  const fileNodeId = formatNodeId(filePath, 'file');
  const fileNode: CodeNode = {
    id: fileNodeId,
    name: fileName,
    qualifiedName: formatQualifiedName(filePath, 'file'),
    entityType: 'FILE',
    semanticRole: 'UNKNOWN',
    filePath,
    language: 'sql',
    scipUri: formatScipUri('sql', filePath, '', fileName, 'def'),
    loc: { startLine: 1, endLine: lines.length },
  };
  nodes.push(fileNode);

  // 移除注释: -- 单行注释 与 /* ... */ 多行注释
  const cleanSql = sourceCode.replace(/--.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
  const statements = cleanSql.split(';').map((s) => s.trim()).filter(Boolean);

  const tableNodesMap = new Map<string, CodeNode>();

  for (const stmt of statements) {
    // 2. 提取 CREATE TABLE
    const createTableMatch = stmt.match(
      /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:`|"|\[)?(?:[a-zA-Z0-9_]+\.)?([a-zA-Z0-9_]+)(?:`|"|\])?\s*\(([\s\S]*)\)/i
    );

    if (createTableMatch) {
      const tableName = createTableMatch[1];
      const body = createTableMatch[2];
      const tableNodeId = formatNodeId(filePath, tableName);

      const tableNode: CodeNode = {
        id: tableNodeId,
        name: tableName,
        qualifiedName: formatQualifiedName(filePath, tableName),
        entityType: 'CLASS',
        semanticRole: 'REPOSITORY',
        filePath,
        language: 'sql',
        scipUri: formatScipUri('sql', filePath, '', tableName, 'class'),
        loc: { startLine: 1, endLine: lines.length },
      };
      nodes.push(tableNode);
      tableNodesMap.set(tableName.toLowerCase(), tableNode);

      edges.push({
        id: `contains_${fileNodeId}_${tableNodeId}`,
        source: fileNodeId,
        target: tableNodeId,
        relation: 'CONTAINS',
        confidence: 'EXTRACTED',
      });

      // 显式外键: FOREIGN KEY (...) REFERENCES target_table(...)
      const fkMatches = body.matchAll(
        /(?:CONSTRAINT\s+[a-zA-Z0-9_]+\s+)?FOREIGN\s+KEY\s*\(([a-zA-Z0-9_,\s`"]+)\)\s*REFERENCES\s+(?:[a-zA-Z0-9_]+\.)?([a-zA-Z0-9_]+)\s*(?:\(([a-zA-Z0-9_,\s`"]+)\))?/gi
      );
      for (const fkm of fkMatches) {
        const targetTable = fkm[2].trim();
        unresolvedCalls.push({
          callerNodeId: tableNodeId,
          calleeExpression: targetTable,
          line: 1,
        });

        edges.push({
          id: `fk_${tableNodeId}_${targetTable}`,
          source: tableNodeId,
          target: targetTable,
          relation: 'READS_WRITES',
          confidence: 'EXTRACTED',
        });
      }

      // 行内约束外键: col_name type REFERENCES target_table(col)
      const inlineFkMatches = body.matchAll(
        /([a-zA-Z0-9_]+)\s+[^,]+\s+REFERENCES\s+(?:[a-zA-Z0-9_]+\.)?([a-zA-Z0-9_]+)\s*(?:\(([a-zA-Z0-9_,\s`"]+)\))?/gi
      );
      for (const ifkm of inlineFkMatches) {
        const targetTable = ifkm[2].trim();
        unresolvedCalls.push({
          callerNodeId: tableNodeId,
          calleeExpression: targetTable,
          line: 1,
        });

        const edgeId = `fk_inline_${tableNodeId}_${targetTable}`;
        if (!edges.some((e) => e.id === edgeId)) {
          edges.push({
            id: edgeId,
            source: tableNodeId,
            target: targetTable,
            relation: 'READS_WRITES',
            confidence: 'EXTRACTED',
          });
        }
      }
      continue;
    }

    // 3. 提取 ALTER TABLE ... ADD CONSTRAINT FOREIGN KEY
    const alterTableMatch = stmt.match(
      /ALTER\s+TABLE\s+(?:[a-zA-Z0-9_]+\.)?([a-zA-Z0-9_]+)\s+ADD\s+(?:CONSTRAINT\s+[a-zA-Z0-9_]+\s+)?FOREIGN\s+KEY\s*\(([a-zA-Z0-9_,\s`"]+)\)\s*REFERENCES\s+(?:[a-zA-Z0-9_]+\.)?([a-zA-Z0-9_]+)/i
    );
    if (alterTableMatch) {
      const sourceTable = alterTableMatch[1].trim();
      const targetTable = alterTableMatch[3].trim();
      const sourceNodeId = formatNodeId(filePath, sourceTable);

      unresolvedCalls.push({
        callerNodeId: sourceNodeId,
        calleeExpression: targetTable,
        line: 1,
      });

      edges.push({
        id: `fk_alter_${sourceTable}_${targetTable}`,
        source: sourceNodeId,
        target: targetTable,
        relation: 'READS_WRITES',
        confidence: 'EXTRACTED',
      });
      continue;
    }

    // 4. 提取 CREATE VIEW 视图
    const createViewMatch = stmt.match(
      /CREATE\s+(?:OR\s+REPLACE\s+)?VIEW\s+(?:[a-zA-Z0-9_]+\.)?([a-zA-Z0-9_]+)\s+AS\s+SELECT\s+([\s\S]+)/i
    );
    if (createViewMatch) {
      const viewName = createViewMatch[1];
      const selectBody = createViewMatch[2];
      const viewNodeId = formatNodeId(filePath, viewName);

      const viewNode: CodeNode = {
        id: viewNodeId,
        name: `${viewName} (View)`,
        qualifiedName: formatQualifiedName(filePath, viewName),
        entityType: 'CLASS',
        semanticRole: 'MODEL',
        filePath,
        language: 'sql',
        scipUri: formatScipUri('sql', filePath, '', viewName, 'class'),
        loc: { startLine: 1, endLine: lines.length },
      };
      nodes.push(viewNode);

      edges.push({
        id: `contains_${fileNodeId}_${viewNodeId}`,
        source: fileNodeId,
        target: viewNodeId,
        relation: 'CONTAINS',
        confidence: 'EXTRACTED',
      });

      // 提取引用的源表: FROM 或 JOIN 后跟的表名
      const fromMatches = selectBody.matchAll(/\b(?:FROM|JOIN)\s+(?:[a-zA-Z0-9_]+\.)?([a-zA-Z0-9_]+)\b/gi);
      for (const fm of fromMatches) {
        const sourceTable = fm[1].trim();
        edges.push({
          id: `view_source_${viewNodeId}_${sourceTable}`,
          source: viewNodeId,
          target: sourceTable,
          relation: 'READS_WRITES',
          confidence: 'EXTRACTED',
        });
      }
    }
  }

  return {
    filePath,
    language: 'sql',
    nodes,
    edges,
    imports,
    unresolvedCalls,
    unresolvedInheritance,
  };
}
