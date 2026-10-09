import {
  CodeNode,
  CodeEdge,
  ExtractedFileResult,
} from '../types/index.js';
import {
  normalizeRoutePattern,
  formatContractEndpointId,
  formatContractTopicId,
  formatContractRpcId,
} from '../parser/scip-utils.js';

export interface ContractLinkResult {
  contractNodes: CodeNode[];
  contractEdges: CodeEdge[];
}

/**
 * 跨语言契约中枢链接引擎 (Polyglot Contract Hub Linker)
 * 消除多语言孤岛：将前端 fetch/axios、后端 FastAPI/Express/Gin/Spring/Axum/ASP.NET 路由与消息总线、gRPC/Protobuf 自动对齐
 */
export class ContractLinker {
  public static linkContracts(
    nodes: Map<string, CodeNode>,
    extractions: Iterable<ExtractedFileResult>
  ): ContractLinkResult {
    const contractNodesMap = new Map<string, CodeNode>();
    const contractEdges: CodeEdge[] = [];

    // 1. 索引后端路由端点 (Server Endpoints) 与 RPC 服务端点
    // Map: contractEndpointId -> CodeNode (Handler)
    const serverEndpointMap = new Map<string, CodeNode[]>();
    const serverRpcMap = new Map<string, CodeNode[]>();

    for (const node of nodes.values()) {
      if (node.endpointMeta && !node.endpointMeta.isClientCall) {
        const method = (node.endpointMeta.httpMethod || 'GET').toUpperCase();
        const normRoute = normalizeRoutePattern(node.endpointMeta.routePath);
        const contractId = formatContractEndpointId(method, normRoute);

        const list = serverEndpointMap.get(contractId) || [];
        list.push(node);
        serverEndpointMap.set(contractId, list);

        // 确保契约中枢节点存在
        if (!contractNodesMap.has(contractId)) {
          contractNodesMap.set(contractId, {
            id: contractId,
            name: `${method} ${normRoute}`,
            qualifiedName: `contract.rest.${method.toLowerCase()}.${normRoute}`,
            entityType: 'CONTRACT_ENDPOINT',
            semanticRole: 'CONTRACT',
            filePath: 'contracts/rest-api',
            language: 'contract',
            scipUri: `scip/contract/rest/${method}${normRoute}`,
            loc: { startLine: 1, endLine: 1 },
            endpointMeta: {
              httpMethod: method,
              routePath: normRoute,
            },
          });
        }
      }

      // 索引后端事件消费者/Worker 任务
      if (node.topicMeta && !node.topicMeta.isPublisher && node.topicMeta.topicName) {
        const topicName = node.topicMeta.topicName;
        const topicContractId = formatContractTopicId(topicName);

        if (!contractNodesMap.has(topicContractId)) {
          contractNodesMap.set(topicContractId, {
            id: topicContractId,
            name: `Topic: ${topicName}`,
            qualifiedName: `contract.topic.${topicName}`,
            entityType: 'CONTRACT_TOPIC',
            semanticRole: 'CONTRACT',
            filePath: 'contracts/topics',
            language: 'contract',
            scipUri: `scip/contract/topic/${topicName}`,
            loc: { startLine: 1, endLine: 1 },
            topicMeta: {
              topicName,
            },
          });
        }

        // 契约主题 -> 消费实现函数: SUBSCRIBES
        const edgeId = `contract_sub_${topicContractId}_${node.id}`;
        contractEdges.push({
          id: edgeId,
          source: topicContractId,
          target: node.id,
          relation: 'SUBSCRIBES',
          confidence: 'EXTRACTED',
          weight: 3,
        });
      }

      // 索引后端 RPC 服务端点 (gRPC / Protobuf RPC Services)
      if (node.rpcMeta && !node.rpcMeta.isClientCall && node.rpcMeta.serviceName && node.rpcMeta.methodName) {
        const { serviceName, methodName } = node.rpcMeta;
        const rpcContractId = formatContractRpcId(serviceName, methodName);

        const list = serverRpcMap.get(rpcContractId) || [];
        list.push(node);
        serverRpcMap.set(rpcContractId, list);

        if (!contractNodesMap.has(rpcContractId)) {
          contractNodesMap.set(rpcContractId, {
            id: rpcContractId,
            name: `${serviceName}.${methodName}`,
            qualifiedName: `contract.rpc.${serviceName.toLowerCase()}.${methodName.toLowerCase()}`,
            entityType: 'CONTRACT_RPC',
            semanticRole: 'CONTRACT',
            filePath: 'contracts/rpc',
            language: 'contract',
            scipUri: `scip/contract/rpc/${serviceName}/${methodName}`,
            loc: { startLine: 1, endLine: 1 },
            rpcMeta: {
              serviceName,
              methodName,
            },
          });
        }
      }
    }

    // 2. 扫描客户端调用并建立跨语言连接
    for (const ext of extractions) {
      for (const call of ext.unresolvedCalls) {
        // 2.1 客户端 REST API 请求调用
        if (call.apiCallMeta && call.apiCallMeta.routePattern) {
          const method = (call.apiCallMeta.httpMethod || 'GET').toUpperCase();
          const normRoute = normalizeRoutePattern(call.apiCallMeta.routePattern);
          const contractId = formatContractEndpointId(method, normRoute);

          // 若此前尚未注册该路由契约中枢，自动合成契约节点
          if (!contractNodesMap.has(contractId)) {
            contractNodesMap.set(contractId, {
              id: contractId,
              name: `${method} ${normRoute}`,
              qualifiedName: `contract.rest.${method.toLowerCase()}.${normRoute}`,
              entityType: 'CONTRACT_ENDPOINT',
              semanticRole: 'CONTRACT',
              filePath: 'contracts/rest-api',
              language: 'contract',
              scipUri: `scip/contract/rest/${method}${normRoute}`,
              loc: { startLine: 1, endLine: 1 },
              endpointMeta: {
                httpMethod: method,
                routePath: normRoute,
              },
            });
          }

          // 前端/客户端 Caller -> 契约中枢: CALLS_CONTRACT
          const edgeId = `contract_call_${call.callerNodeId}_${contractId}_${call.line}`;
          contractEdges.push({
            id: edgeId,
            source: call.callerNodeId,
            target: contractId,
            relation: 'CALLS_CONTRACT',
            confidence: 'EXTRACTED',
            sourceLine: call.line,
            weight: 3,
          });
        }

        // 2.2 消息事件/任务投递调用
        if (call.topicMeta && call.topicMeta.isPublish && call.topicMeta.topicName) {
          const topicName = call.topicMeta.topicName;
          const topicContractId = formatContractTopicId(topicName);

          if (!contractNodesMap.has(topicContractId)) {
            contractNodesMap.set(topicContractId, {
              id: topicContractId,
              name: `Topic: ${topicName}`,
              qualifiedName: `contract.topic.${topicName}`,
              entityType: 'CONTRACT_TOPIC',
              semanticRole: 'CONTRACT',
              filePath: 'contracts/topics',
              language: 'contract',
              scipUri: `scip/contract/topic/${topicName}`,
              loc: { startLine: 1, endLine: 1 },
              topicMeta: {
                topicName,
              },
            });
          }

          // 发布者 -> 契约主题: PUBLISHES
          const edgeId = `contract_pub_${call.callerNodeId}_${topicContractId}_${call.line}`;
          contractEdges.push({
            id: edgeId,
            source: call.callerNodeId,
            target: topicContractId,
            relation: 'PUBLISHES',
            confidence: 'EXTRACTED',
            sourceLine: call.line,
            weight: 3,
          });
        }

        // 2.3 客户端 gRPC / RPC 方法调用
        if (call.rpcCallMeta && call.rpcCallMeta.serviceName && call.rpcCallMeta.methodName) {
          const { serviceName, methodName } = call.rpcCallMeta;
          const rpcContractId = formatContractRpcId(serviceName, methodName);

          if (!contractNodesMap.has(rpcContractId)) {
            contractNodesMap.set(rpcContractId, {
              id: rpcContractId,
              name: `${serviceName}.${methodName}`,
              qualifiedName: `contract.rpc.${serviceName.toLowerCase()}.${methodName.toLowerCase()}`,
              entityType: 'CONTRACT_RPC',
              semanticRole: 'CONTRACT',
              filePath: 'contracts/rpc',
              language: 'contract',
              scipUri: `scip/contract/rpc/${serviceName}/${methodName}`,
              loc: { startLine: 1, endLine: 1 },
              rpcMeta: {
                serviceName,
                methodName,
              },
            });
          }

          // 客户端 Caller -> 契约中枢: CALLS_CONTRACT
          const edgeId = `contract_rpc_${call.callerNodeId}_${rpcContractId}_${call.line}`;
          contractEdges.push({
            id: edgeId,
            source: call.callerNodeId,
            target: rpcContractId,
            relation: 'CALLS_CONTRACT',
            confidence: 'EXTRACTED',
            sourceLine: call.line,
            weight: 3,
          });
        }
      }
    }

    // 3. 将所有已注册的契约中枢连接至服务端实现 (HANDLED_BY)
    for (const [contractId, handlers] of serverEndpointMap.entries()) {
      for (const handler of handlers) {
        const edgeId = `contract_handled_${contractId}_${handler.id}`;
        contractEdges.push({
          id: edgeId,
          source: contractId,
          target: handler.id,
          relation: 'HANDLED_BY',
          confidence: 'EXTRACTED',
          weight: 3,
        });
      }
    }

    for (const [contractId, handlers] of serverRpcMap.entries()) {
      for (const handler of handlers) {
        const edgeId = `contract_rpc_handled_${contractId}_${handler.id}`;
        contractEdges.push({
          id: edgeId,
          source: contractId,
          target: handler.id,
          relation: 'HANDLED_BY',
          confidence: 'EXTRACTED',
          weight: 3,
        });
      }
    }

    return {
      contractNodes: Array.from(contractNodesMap.values()),
      contractEdges,
    };
  }
}
