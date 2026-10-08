import { CodeNode, CodeEdge, RelationType, FullGraphResult } from '../types/index.js';

export interface PathHop {
  hopIndex: number;
  fromNode: {
    id: string;
    name: string;
    filePath: string;
    line: number;
    module?: string;
  };
  toNode: {
    id: string;
    name: string;
    filePath: string;
    line: number;
    module?: string;
  };
  relation: RelationType;
  callLine?: number;
}

export interface CallPathResult {
  found: boolean;
  isReversed?: boolean;
  fromQuery: string;
  toQuery: string;
  fromNode?: { id: string; name: string; filePath: string; line: number };
  toNode?: { id: string; name: string; filePath: string; line: number };
  hopCount: number;
  path: PathHop[];
  message: string;
}

export class CallPathFinder {
  /**
   * 在代码图谱中执行 A ➔ B 广度优先 (BFS) 最短调用路径穿透搜索
   */
  public static findShortestPath(
    fromQuery: string,
    toQuery: string,
    graph: FullGraphResult,
    options: { maxDepth?: number; fromFile?: string; toFile?: string } = {}
  ): CallPathResult {
    const maxDepth = options.maxDepth ?? 10;
    const allNodes = graph.allNodes;
    const allEdges = graph.allEdges;
    const modules = graph.architectureView?.modules || [];

    const findModuleForFile = (filePath: string): string => {
      for (const m of modules) {
        if (m.files.some((f) => f === filePath || filePath.endsWith(f) || f.endsWith(filePath))) {
          return m.name;
        }
      }
      return 'default';
    };

    const matchCandidates = (query: string, fileFilter?: string): CodeNode[] => {
      const q = query.trim().toLowerCase();
      const nodes = Object.values(allNodes);

      // 1. 精确匹配
      let matches = nodes.filter((n) => {
        if (fileFilter && !n.filePath.toLowerCase().includes(fileFilter.toLowerCase())) return false;
        return (
          n.name.toLowerCase() === q ||
          n.qualifiedName.toLowerCase() === q ||
          n.id.toLowerCase() === q
        );
      });

      // 2. 若无精确匹配，尝试子串匹配
      if (matches.length === 0 && q.length > 2) {
        matches = nodes.filter((n) => {
          if (fileFilter && !n.filePath.toLowerCase().includes(fileFilter.toLowerCase())) return false;
          return n.name.toLowerCase().includes(q) || n.qualifiedName.toLowerCase().includes(q);
        });
      }

      return matches;
    };

    const fromNodes = matchCandidates(fromQuery, options.fromFile);
    if (fromNodes.length === 0) {
      return {
        found: false,
        fromQuery,
        toQuery,
        hopCount: 0,
        path: [],
        message: `未在图谱中找到起点符号 [${fromQuery}] 对应的函数或组件`,
      };
    }

    const toNodes = matchCandidates(toQuery, options.toFile);
    if (toNodes.length === 0) {
      return {
        found: false,
        fromQuery,
        toQuery,
        hopCount: 0,
        path: [],
        message: `未在图谱中找到终点符号 [${toQuery}] 对应的函数或组件`,
      };
    }

    // 构建有向邻接表 (优先 CALLS 关系，辅以 IMPORTS/CONTAINS)
    const forwardAdj = new Map<string, Array<{ targetId: string; edge: CodeEdge }>>();
    const reverseAdj = new Map<string, Array<{ sourceId: string; edge: CodeEdge }>>();

    for (const edge of Object.values(allEdges)) {
      if (!forwardAdj.has(edge.source)) forwardAdj.set(edge.source, []);
      forwardAdj.get(edge.source)!.push({ targetId: edge.target, edge });

      if (!reverseAdj.has(edge.target)) reverseAdj.set(edge.target, []);
      reverseAdj.get(edge.target)!.push({ sourceId: edge.source, edge });
    }

    const targetSet = new Set(toNodes.map((n) => n.id));

    // 执行正向 BFS 搜索: from -> to
    const bfs = (
      startNodes: CodeNode[],
      targets: Set<string>,
      adjacency: Map<string, Array<{ targetId: string; edge: CodeEdge }>>
    ): { targetReached?: string; parentMap: Map<string, { prevId: string; edge: CodeEdge }> } => {
      const parentMap = new Map<string, { prevId: string; edge: CodeEdge }>();
      const visited = new Set<string>();
      const queue: Array<{ nodeId: string; depth: number }> = [];

      for (const start of startNodes) {
        if (targets.has(start.id)) {
          return { targetReached: start.id, parentMap };
        }
        visited.add(start.id);
        queue.push({ nodeId: start.id, depth: 0 });
      }

      while (queue.length > 0) {
        const { nodeId, depth } = queue.shift()!;
        if (depth >= maxDepth) continue;

        const neighbors = adjacency.get(nodeId) || [];
        for (const { targetId, edge } of neighbors) {
          if (!visited.has(targetId)) {
            visited.add(targetId);
            parentMap.set(targetId, { prevId: nodeId, edge });

            if (targets.has(targetId)) {
              return { targetReached: targetId, parentMap };
            }

            queue.push({ nodeId: targetId, depth: depth + 1 });
          }
        }
      }

      return { targetReached: undefined, parentMap };
    };

    // 1. 先尝试正向调用链路 (From ➔ To)
    const forwardResult = bfs(fromNodes, targetSet, forwardAdj);

    if (forwardResult.targetReached) {
      const targetId = forwardResult.targetReached;
      const targetNode = allNodes[targetId];
      const hops: PathHop[] = [];

      let curr = targetId;
      while (forwardResult.parentMap.has(curr)) {
        const { prevId, edge } = forwardResult.parentMap.get(curr)!;
        const prevNode = allNodes[prevId];
        const nextNode = allNodes[curr];

        if (prevNode && nextNode) {
          hops.unshift({
            hopIndex: 0,
            fromNode: {
              id: prevNode.id,
              name: prevNode.name,
              filePath: prevNode.filePath,
              line: prevNode.loc?.startLine || 1,
              module: findModuleForFile(prevNode.filePath),
            },
            toNode: {
              id: nextNode.id,
              name: nextNode.name,
              filePath: nextNode.filePath,
              line: nextNode.loc?.startLine || 1,
              module: findModuleForFile(nextNode.filePath),
            },
            relation: edge.relation,
            callLine: edge.sourceLine,
          });
        }
        curr = prevId;
      }

      hops.forEach((h, idx) => (h.hopIndex = idx + 1));
      const startNode = allNodes[curr] || fromNodes[0];

      return {
        found: true,
        isReversed: false,
        fromQuery,
        toQuery,
        fromNode: {
          id: startNode.id,
          name: startNode.name,
          filePath: startNode.filePath,
          line: startNode.loc?.startLine || 1,
        },
        toNode: {
          id: targetNode.id,
          name: targetNode.name,
          filePath: targetNode.filePath,
          line: targetNode.loc?.startLine || 1,
        },
        hopCount: hops.length,
        path: hops,
        message: `成功查找到从 [${startNode.name}] 到 [${targetNode.name}] 的最短调用链 (共 ${hops.length} 步)`,
      };
    }

    // 2. 若正向未找到，探测是否存在反向调用 (To ➔ From)，友好提示 Agent
    const fromSet = new Set(fromNodes.map((n) => n.id));
    const reverseResult = bfs(toNodes, fromSet, forwardAdj);
    if (reverseResult.targetReached) {
      return {
        found: false,
        isReversed: true,
        fromQuery,
        toQuery,
        hopCount: 0,
        path: [],
        message: `提示：未发现 [${fromQuery}] ➔ [${toQuery}] 的调用流，但在相反方向上检测到 [${toQuery}] 正在调用 [${fromQuery}]。如需追踪请颠倒起点与终点。`,
      };
    }

    return {
      found: false,
      isReversed: false,
      fromQuery,
      toQuery,
      hopCount: 0,
      path: [],
      message: `未在当前代码图谱中检测到从 [${fromQuery}] 直达 [${toQuery}] 的调用链路 (最大搜索深度 ${maxDepth} 跳)。两者可能通过事件派发、消息总线解耦或属于不同独立层级。`,
    };
  }

  /**
   * 将调用链路格式化为高可读性、确定性的 Markdown 文本
   */
  public static formatMarkdown(result: CallPathResult): string {
    const lines: string[] = [];

    if (!result.found) {
      lines.push(`### ⛓️ 调用链穿透结果: \`${result.fromQuery}\` ➔ \`${result.toQuery}\``);
      lines.push(`> ⚠️ **未连通**: ${result.message}`);
      lines.push(`\n**建议排查步骤**:`);
      lines.push(`1. 使用 \`codegraph_inspect_narrative\` 查询 \`${result.fromQuery}\`，查看其所有直接下游依赖 (Out-Ports / Callees)`);
      lines.push(`2. 使用 \`codegraph_inspect_narrative\` 查询 \`${result.toQuery}\`，查看其所有上游来源 (In-Ports / Callers)`);
      lines.push(`3. 检查两者是否通过事件发布订阅 (EventBus)、HTTP 路由或全局依赖注入间接交互`);
      return lines.join('\n');
    }

    lines.push(`### ⛓️ 最短调用链路穿透: \`${result.fromNode?.name || result.fromQuery}\` ➔ \`${result.toNode?.name || result.toQuery}\` (共 ${result.hopCount} 步)`);
    lines.push(`- **起点**: \`${result.fromNode?.name}\` (\`${result.fromNode?.filePath}:${result.fromNode?.line}\`)`);
    lines.push(`- **终点**: \`${result.toNode?.name}\` (\`${result.toNode?.filePath}:${result.toNode?.line}\`)`);
    lines.push(`- **穿透深度**: ${result.hopCount} 级调用\n`);

    lines.push(`**逐步执行链路**:`);
    for (const hop of result.path) {
      const fromLoc = `\`${hop.fromNode.filePath}:${hop.callLine || hop.fromNode.line}\``;
      const toLoc = `\`${hop.toNode.filePath}:${hop.toNode.line}\``;
      const fromMod = hop.fromNode.module ? `[${hop.fromNode.module}] ` : '';
      const toMod = hop.toNode.module ? `[${hop.toNode.module}] ` : '';

      lines.push(
        `${hop.hopIndex}. ${fromMod}\`${hop.fromNode.name}()\` (${fromLoc}) ➔ \`${hop.relation}\` ➔ ${toMod}\`${hop.toNode.name}()\` (${toLoc})`
      );
    }

    lines.push(`\n✅ **调用链达成**: 已完整连通起点与终点。`);
    return lines.join('\n');
  }
}
