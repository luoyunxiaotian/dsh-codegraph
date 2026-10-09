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
  formatContractRpcId,
} from '../scip-utils.js';

export class ProtoExtractor implements LanguageExtractor {
  public readonly language = 'protobuf';
  public readonly fileExtensions = ['.proto'];
  public readonly wasmGrammarName = 'none';

  public extractFile(
    _tree: any,
    filePath: string,
    sourceCode: string
  ): ExtractedFileResult {
    return extractProtobufFile(filePath, sourceCode);
  }
}

/**
 * 深度解析 Google Protocol Buffers 文件 (.proto)
 * 提取 Package、Service、RPC 跨语言契约中枢、Message 数据模型、Enum 及跨服务数据流向
 */
export function extractProtobufFile(
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
    language: 'protobuf',
    scipUri: formatScipUri('protobuf', filePath, '', fileName, 'def'),
    loc: { startLine: 1, endLine: lines.length },
  };
  nodes.push(fileNode);

  // 过滤注释: 去除 // 与 /* ... */
  const cleanCode = sourceCode.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');

  // 2. 提取 package 包名
  let packageName = '';
  const packageMatch = cleanCode.match(/\bpackage\s+([a-zA-Z0-9_.]+)\s*;/);
  if (packageMatch) {
    packageName = packageMatch[1].trim();
  }

  // 3. 提取 import 语句
  const importMatches = cleanCode.matchAll(/\bimport\s+["']([^"']+)["']\s*;/g);
  for (const im of importMatches) {
    const importPath = im[1].trim();
    const modName = importPath.split('/').pop()?.replace(/\.proto$/i, '') || importPath;
    imports.push({
      modulePath: importPath,
      importedNames: [{ name: modName }],
      line: 1,
    });

    edges.push({
      id: `import_${fileNodeId}_${importPath}`,
      source: fileNodeId,
      target: importPath,
      relation: 'IMPORTS',
      confidence: 'EXTRACTED',
      sourceLine: 1,
    });
  }

  // 4. 提取 Message 数据结构模型
  const messageMatches = cleanCode.matchAll(/\bmessage\s+([a-zA-Z0-9_]+)\s*\{([\s\S]*?)\}/g);
  for (const mm of messageMatches) {
    const msgName = mm[1];
    const msgNodeId = formatNodeId(filePath, msgName);

    const msgNode: CodeNode = {
      id: msgNodeId,
      name: msgName,
      qualifiedName: packageName ? `${packageName}.${msgName}` : msgName,
      entityType: 'CLASS',
      semanticRole: 'MODEL',
      filePath,
      language: 'protobuf',
      scipUri: formatScipUri('protobuf', filePath, '', msgName, 'class'),
      loc: { startLine: 1, endLine: lines.length },
    };
    nodes.push(msgNode);

    edges.push({
      id: `contains_${fileNodeId}_${msgNodeId}`,
      source: fileNodeId,
      target: msgNodeId,
      relation: 'CONTAINS',
      confidence: 'EXTRACTED',
    });
  }

  // 5. 提取 Enum 枚举
  const enumMatches = cleanCode.matchAll(/\benum\s+([a-zA-Z0-9_]+)\s*\{([\s\S]*?)\}/g);
  for (const em of enumMatches) {
    const enumName = em[1];
    const enumNodeId = formatNodeId(filePath, enumName);

    const enumNode: CodeNode = {
      id: enumNodeId,
      name: enumName,
      qualifiedName: packageName ? `${packageName}.${enumName}` : enumName,
      entityType: 'CLASS',
      semanticRole: 'MODEL',
      filePath,
      language: 'protobuf',
      scipUri: formatScipUri('protobuf', filePath, '', enumName, 'class'),
      loc: { startLine: 1, endLine: lines.length },
    };
    nodes.push(enumNode);

    edges.push({
      id: `contains_${fileNodeId}_${enumNodeId}`,
      source: fileNodeId,
      target: enumNodeId,
      relation: 'CONTAINS',
      confidence: 'EXTRACTED',
    });
  }

  // 6. 提取 Service 与 RPC 方法
  const serviceMatches = cleanCode.matchAll(/\bservice\s+([a-zA-Z0-9_]+)\s*\{([\s\S]*?)\}/g);
  for (const sm of serviceMatches) {
    const serviceName = sm[1];
    const serviceBody = sm[2];
    const serviceNodeId = formatNodeId(filePath, serviceName);

    const serviceNode: CodeNode = {
      id: serviceNodeId,
      name: serviceName,
      qualifiedName: packageName ? `${packageName}.${serviceName}` : serviceName,
      entityType: 'INTERFACE',
      semanticRole: 'CONTRACT',
      filePath,
      language: 'protobuf',
      scipUri: formatScipUri('protobuf', filePath, '', serviceName, 'interface'),
      loc: { startLine: 1, endLine: lines.length },
    };
    nodes.push(serviceNode);

    edges.push({
      id: `contains_${fileNodeId}_${serviceNodeId}`,
      source: fileNodeId,
      target: serviceNodeId,
      relation: 'CONTAINS',
      confidence: 'EXTRACTED',
    });

    // 提取 rpc 方法: rpc MethodName (ReqType) returns (RespType);
    const rpcMatches = serviceBody.matchAll(
      /\brpc\s+([a-zA-Z0-9_]+)\s*\(\s*(?:stream\s+)?([a-zA-Z0-9_.]+)\s*\)\s*returns\s*\(\s*(?:stream\s+)?([a-zA-Z0-9_.]+)\s*\)/g
    );

    for (const rm of rpcMatches) {
      const methodName = rm[1];
      const reqType = rm[2].split('.').pop() || rm[2];
      const respType = rm[3].split('.').pop() || rm[3];

      const rpcContractId = formatContractRpcId(serviceName, methodName);
      const rpcNode: CodeNode = {
        id: rpcContractId,
        name: `${serviceName}.${methodName}`,
        qualifiedName: packageName ? `${packageName}.${serviceName}.${methodName}` : `${serviceName}.${methodName}`,
        entityType: 'CONTRACT_RPC',
        semanticRole: 'CONTRACT',
        filePath,
        language: 'protobuf',
        scipUri: `scip/protobuf/contract/${serviceName}/${methodName}`,
        signature: `rpc ${methodName}(${rm[2]}) returns (${rm[3]})`,
        rpcMeta: {
          serviceName,
          methodName,
          isClientCall: false,
        },
        loc: { startLine: 1, endLine: lines.length },
      };
      nodes.push(rpcNode);

      // 服务接口包含 RPC 方法
      edges.push({
        id: `contains_${serviceNodeId}_${rpcContractId}`,
        source: serviceNodeId,
        target: rpcContractId,
        relation: 'CONTAINS',
        confidence: 'EXTRACTED',
      });

      // RPC 方法与入参/出参 Message 关联 (READS_WRITES 数据流)
      const reqMsgId = formatNodeId(filePath, reqType);
      edges.push({
        id: `rpc_in_${rpcContractId}_${reqMsgId}`,
        source: rpcContractId,
        target: reqMsgId,
        relation: 'READS_WRITES',
        confidence: 'INFERRED',
      });

      const respMsgId = formatNodeId(filePath, respType);
      edges.push({
        id: `rpc_out_${rpcContractId}_${respMsgId}`,
        source: rpcContractId,
        target: respMsgId,
        relation: 'READS_WRITES',
        confidence: 'INFERRED',
      });
    }
  }

  return {
    filePath,
    language: 'protobuf',
    nodes,
    edges,
    imports,
    unresolvedCalls,
    unresolvedInheritance,
  };
}
