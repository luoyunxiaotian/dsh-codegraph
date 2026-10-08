import { CodeNode, CodeEdge, RelationType, FullGraphResult } from '../types/index.js';

export interface CallerInfo {
  nodeId: string;
  name: string;
  filePath: string;
  line: number;
  relation: RelationType;
  module?: string;
  hop: number;
}

export interface ImpactAnalysisResult {
  targetSymbol: string;
  targetNodes: Array<{ id: string; name: string; filePath: string; line: number }>;
  riskLevel: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  directCallers: CallerInfo[];
  transitiveCallers: CallerInfo[];
  affectedFiles: string[];
  affectedModules: string[];
  recommendation: string;
}

export class ImpactAnalyzer {
  /**
   * 针对指定符号或文件执行多跳递归影响面分析 (Blast Radius)
   */
  public static analyze(
    targetQuery: string,
    graph: FullGraphResult,
    options: { maxDepth?: number; filePath?: string } = {}
  ): ImpactAnalysisResult {
    const maxDepth = options.maxDepth ?? 3;
    const allNodes = graph.allNodes;
    const allEdges = graph.allEdges;
    const modules = graph.architectureView.modules || [];

    // 辅助: 查找文件所属模块
    const findModuleForFile = (filePath: string): string => {
      for (const m of modules) {
        if (m.files.some((f) => f === filePath || filePath.endsWith(f) || f.endsWith(filePath))) {
          return m.name;
        }
      }
      return 'default';
    };

    // 1. 寻找匹配的目标节点
    const q = targetQuery.trim().toLowerCase();
    const matchedNodes: CodeNode[] = [];

    for (const node of Object.values(allNodes)) {
      if (options.filePath && !node.filePath.toLowerCase().includes(options.filePath.toLowerCase())) {
        continue;
      }
      if (
        node.name.toLowerCase() === q ||
        node.qualifiedName.toLowerCase() === q ||
        node.id.toLowerCase() === q ||
        (q.length > 2 && (node.name.toLowerCase().includes(q) || node.qualifiedName.toLowerCase().includes(q)))
      ) {
        matchedNodes.push(node);
      }
    }

    if (matchedNodes.length === 0) {
      return {
        targetSymbol: targetQuery,
        targetNodes: [],
        riskLevel: 'LOW',
        directCallers: [],
        transitiveCallers: [],
        affectedFiles: [],
        affectedModules: [],
        recommendation: `未在代码图谱中检索到符号 "${targetQuery}"。请核对符号拼写，或使用原生 grep / read_file 查看。`,
      };
    }

    // 2. 递归反向回溯 (BFS / DFS 向上追溯 Callers)
    const directCallers: CallerInfo[] = [];
    const transitiveCallers: CallerInfo[] = [];
    const visitedNodeIds = new Set<string>(matchedNodes.map((n) => n.id));
    const affectedFilesSet = new Set<string>(matchedNodes.map((n) => n.filePath));
    const affectedModulesSet = new Set<string>(matchedNodes.map((n) => findModuleForFile(n.filePath)));

    // 当前探测队列: Array<{ nodeId: string, hop: number }>
    let currentFrontier = matchedNodes.map((n) => ({ nodeId: n.id, hop: 1 }));

    while (currentFrontier.length > 0) {
      const nextFrontier: Array<{ nodeId: string; hop: number }> = [];

      for (const item of currentFrontier) {
        if (item.hop > maxDepth) continue;

        // 查找所有以该节点为 target 的边 (即 source 是 caller)
        const incomingEdges = allEdges.filter((e) => e.target === item.nodeId);

        for (const edge of incomingEdges) {
          const callerNode = allNodes[edge.source];
          if (!callerNode) continue;

          const isDirect = item.hop === 1;
          const normalizedCallerPath = callerNode.filePath.replace(/\\/g, '/');
          const callerInfo: CallerInfo = {
            nodeId: callerNode.id,
            name: callerNode.name,
            filePath: normalizedCallerPath,
            line: edge.sourceLine || callerNode.loc?.startLine || 1,
            relation: edge.relation,
            module: findModuleForFile(callerNode.filePath),
            hop: item.hop,
          };

          affectedFilesSet.add(normalizedCallerPath);
          affectedModulesSet.add(callerInfo.module || 'default');

          if (isDirect) {
            // 避免重复直接调用者
            if (!directCallers.some((c) => c.nodeId === callerNode.id && c.line === callerInfo.line)) {
              directCallers.push(callerInfo);
            }
          } else {
            if (!transitiveCallers.some((c) => c.nodeId === callerNode.id)) {
              transitiveCallers.push(callerInfo);
            }
          }

          if (!visitedNodeIds.has(callerNode.id)) {
            visitedNodeIds.add(callerNode.id);
            nextFrontier.push({ nodeId: callerNode.id, hop: item.hop + 1 });
          }
        }
      }

      currentFrontier = nextFrontier;
    }

    // 3. 计算风险等级 (Risk Level)
    const affectedFileCount = affectedFilesSet.size;
    const affectedModuleCount = affectedModulesSet.size;
    const hasContract = matchedNodes.some((n) => n.endpointMeta || n.rpcMeta || n.topicMeta);

    let riskLevel: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL' = 'LOW';
    if (hasContract || affectedFileCount > 6 || affectedModuleCount >= 3) {
      riskLevel = 'CRITICAL';
    } else if (affectedFileCount >= 4 || affectedModuleCount >= 2 || directCallers.length >= 5) {
      riskLevel = 'HIGH';
    } else if (affectedFileCount >= 2 || directCallers.length >= 2) {
      riskLevel = 'MEDIUM';
    }

    // 4. 生成改动防踩坑建议
    let recommendation = '改动波及面较小，主要集中在同文件或少数模块内，请注意单元测试覆盖。';
    if (riskLevel === 'CRITICAL') {
      recommendation = `⚠️ 极高风险改动！该符号直接关联对外契约接口或波及 ${affectedModuleCount} 个独立模块 (${Array.from(affectedModulesSet).join(', ')})。修改入参或签名极易造成跨端或运行时破坏，必须确保向后兼容或同步重构所有调用方。`;
    } else if (riskLevel === 'HIGH') {
      recommendation = `高风险改动：跨越 ${affectedModuleCount} 个模块，共有 ${directCallers.length} 个直接调用点。重构时必须核验直接调用方的参数适配。`;
    }

    // 4. 确定性排序 (消除输出抖动，保护 LLM Prompt Cache)
    directCallers.sort((a, b) => {
      const modCmp = (a.module || '').localeCompare(b.module || '');
      if (modCmp !== 0) return modCmp;
      const fileCmp = a.filePath.localeCompare(b.filePath);
      if (fileCmp !== 0) return fileCmp;
      return a.line - b.line;
    });

    transitiveCallers.sort((a, b) => {
      if (a.hop !== b.hop) return a.hop - b.hop;
      const modCmp = (a.module || '').localeCompare(b.module || '');
      if (modCmp !== 0) return modCmp;
      const fileCmp = a.filePath.localeCompare(b.filePath);
      if (fileCmp !== 0) return fileCmp;
      return a.line - b.line;
    });

    const sortedTargetNodes = matchedNodes
      .map((n) => ({
        id: n.id,
        name: n.name,
        filePath: n.filePath.replace(/\\/g, '/'),
        line: n.loc?.startLine || 1,
      }))
      .sort((a, b) => {
        const fileCmp = a.filePath.localeCompare(b.filePath);
        if (fileCmp !== 0) return fileCmp;
        return a.line - b.line;
      });

    const sortedAffectedFiles = Array.from(affectedFilesSet)
      .map((f) => f.replace(/\\/g, '/'))
      .sort((a, b) => a.localeCompare(b));

    const sortedAffectedModules = Array.from(affectedModulesSet).sort((a, b) => a.localeCompare(b));

    return {
      targetSymbol: targetQuery,
      targetNodes: sortedTargetNodes,
      riskLevel,
      directCallers,
      transitiveCallers,
      affectedFiles: sortedAffectedFiles,
      affectedModules: sortedAffectedModules,
      recommendation,
    };
  }

  /**
   * 将影响面分析结果转换为高密度 Markdown 报告
   */
  public static formatMarkdown(res: ImpactAnalysisResult): string {
    const lines: string[] = [];
    const riskBadges: Record<string, string> = {
      LOW: '🟢 LOW (低风险)',
      MEDIUM: '🟡 MEDIUM (中等风险)',
      HIGH: '🟠 HIGH (高风险)',
      CRITICAL: '🔴 CRITICAL (极高风险 - 跨模块/对外契约)',
    };

    lines.push(`### ⚠️ 代码改动影响面评估 (Blast Radius): \`${res.targetSymbol}\``);
    lines.push(`- **综合风险评级**: ${riskBadges[res.riskLevel] || res.riskLevel}`);
    lines.push(`- **波及范围统计**: 涉及 **${res.affectedFiles.length}** 个源码文件, 跨越 **${res.affectedModules.length}** 个核心模块 (\`${res.affectedModules.join('`, `')}\`)`);

    if (res.targetNodes.length > 0) {
      lines.push('\n**目标符号定义位置**:');
      for (const tn of res.targetNodes) {
        lines.push(`- \`${tn.name}\` -> [${tn.filePath}:${tn.line}](${tn.filePath}#L${tn.line})`);
      }
    }

    if (res.directCallers.length > 0) {
      lines.push(`\n**直接调用方 (Direct Callers, 共 ${res.directCallers.length} 处)**:`);
      for (const c of res.directCallers.slice(0, 8)) {
        lines.push(`- [模块: ${c.module || 'default'}] \`${c.name}\` -> [${c.filePath}:${c.line}](${c.filePath}#L${c.line}) (${c.relation})`);
      }
      if (res.directCallers.length > 8) {
        lines.push(`- ... (另有 ${res.directCallers.length - 8} 处直接调用方未展开)`);
      }
    } else {
      lines.push('\n**直接调用方**: 未发现直接调用方 (可能是顶层入口或未导出的私有符号)。');
    }

    if (res.transitiveCallers.length > 0) {
      lines.push(`\n**间接影响链路 (Transitive Callers, 共 ${res.transitiveCallers.length} 处)**:`);
      for (const c of res.transitiveCallers.slice(0, 5)) {
        lines.push(`- [Hop ${c.hop}] \`${c.name}\` in \`${c.filePath}\` (模块: ${c.module || 'default'})`);
      }
      if (res.transitiveCallers.length > 5) {
        lines.push(`- ... (另有 ${res.transitiveCallers.length - 5} 处间接调用方)`);
      }
    }

    lines.push(`\n**改动建议与注意事项**:`);
    lines.push(`> ${res.recommendation}`);

    return lines.join('\n');
  }
}
