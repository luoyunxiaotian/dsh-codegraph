import { FullGraphResult, ModuleBus } from '../types/index.js';

export interface CycleReport {
  type: 'MODULE_CYCLE' | 'FILE_CYCLE';
  nodes: string[];
  description: string;
}

export interface LayerViolation {
  source: string;
  target: string;
  sourceRole?: string;
  targetRole?: string;
  reason: string;
}

export interface ArchitectureHealthReport {
  score: number; // 0 - 100
  status: 'HEALTHY' | 'WARNING' | 'CRITICAL';
  cycles: CycleReport[];
  layerViolations: LayerViolation[];
  summary: string;
}

export class ArchitectureHealthAuditor {
  /**
   * 针对代码图谱执行全局架构合规性与健康度排查
   */
  public static audit(graph: FullGraphResult): ArchitectureHealthReport {
    const modules = graph.architectureView.modules || [];
    const buses = graph.architectureView.buses || [];
    const allNodes = graph.allNodes;
    const allEdges = graph.allEdges;

    const cycles: CycleReport[] = [];
    const layerViolations: LayerViolation[] = [];

    // 1. 模块级循环依赖检测 (Module Cycles)
    const moduleAdj = new Map<string, Set<string>>();
    for (const m of modules) {
      moduleAdj.set(m.name, new Set());
    }
    for (const b of buses) {
      if (b.sourceModule !== b.targetModule) {
        if (!moduleAdj.has(b.sourceModule)) moduleAdj.set(b.sourceModule, new Set());
        moduleAdj.get(b.sourceModule)!.add(b.targetModule);
      }
    }

    // DFS 寻找有向图环路
    const visited = new Set<string>();
    const recStack = new Set<string>();
    const path: string[] = [];

    const detectModuleCycles = (u: string) => {
      visited.add(u);
      recStack.add(u);
      path.push(u);

      const neighbors = moduleAdj.get(u) || new Set();
      for (const v of neighbors) {
        if (!visited.has(v)) {
          detectModuleCycles(v);
        } else if (recStack.has(v)) {
          // 发现环路
          const cycleStartIdx = path.indexOf(v);
          const cyclePath = path.slice(cycleStartIdx).concat(v);
          const cycleKey = cyclePath.join(' -> ');
          if (!cycles.some((c) => c.nodes.join(' -> ') === cycleKey)) {
            cycles.push({
              type: 'MODULE_CYCLE',
              nodes: cyclePath,
              description: `模块循环依赖: ${cyclePath.join(' -> ')}`,
            });
          }
        }
      }

      path.pop();
      recStack.delete(u);
    };

    for (const m of modules) {
      if (!visited.has(m.name)) {
        detectModuleCycles(m.name);
      }
    }

    // 2. 分层违规排查 (Layer Violations)
    // 根据角色定义的层级优先级 (数字越大层级越高，高层依赖低层为合法，低层反向依赖高层为违规)
    const roleRank: Record<string, number> = {
      ENTRY: 4,
      CONTROLLER: 4,
      PRESENTATION: 4,
      SERVICE: 3,
      DOMAIN: 3,
      USE_CASE: 3,
      REPOSITORY: 2,
      DATA: 2,
      INFRASTRUCTURE: 1,
      UTIL: 1,
      MODEL: 1,
    };

    for (const edge of allEdges) {
      const srcNode = allNodes[edge.source];
      const tgtNode = allNodes[edge.target];
      if (!srcNode || !tgtNode) continue;
      if (srcNode.filePath === tgtNode.filePath) continue; // 同文件内部调用不计

      const srcRank = roleRank[srcNode.semanticRole] || 0;
      const tgtRank = roleRank[tgtNode.semanticRole] || 0;

      // 如果底层 (Rank <= 2，如 Repo 或 Infra) 反向调用或依赖上层 (Rank >= 4，如 Controller/Entry)
      if (srcRank > 0 && tgtRank > 0 && srcRank <= 2 && tgtRank >= 4) {
        const violationKey = `${srcNode.filePath} -> ${tgtNode.filePath}`;
        if (!layerViolations.some((v) => `${v.source} -> ${v.target}` === violationKey)) {
          layerViolations.push({
            source: srcNode.name,
            target: tgtNode.name,
            sourceRole: srcNode.semanticRole,
            targetRole: tgtNode.semanticRole,
            reason: `底层组件 [${srcNode.semanticRole}] \`${srcNode.name}\` 反向依赖了上层入口 [${tgtNode.semanticRole}] \`${tgtNode.name}\` (${srcNode.filePath.replace(/\\/g, '/')} -> ${tgtNode.filePath.replace(/\\/g, '/')})`,
          });
        }
      }
    }

    // 确定性排序 (消除输出抖动)
    cycles.sort((a, b) => a.description.localeCompare(b.description));
    layerViolations.sort((a, b) => a.reason.localeCompare(b.reason));

    // 3. 计算健康度得分
    let score = 100;
    score -= cycles.length * 15; // 每个模块环扣 15 分
    score -= Math.min(layerViolations.length * 5, 30); // 分层违规每个扣 5 分，最多扣 30 分
    score = Math.max(score, 0);

    let status: 'HEALTHY' | 'WARNING' | 'CRITICAL' = 'HEALTHY';
    if (score < 60 || cycles.length >= 2) {
      status = 'CRITICAL';
    } else if (score < 85 || cycles.length > 0 || layerViolations.length > 0) {
      status = 'WARNING';
    }

    let summary = '项目架构规范良好，未发现恶性循环依赖或明显反向分层越权调用。';
    if (status === 'CRITICAL') {
      summary = `⚠️ 架构存在严重风险！检测到 ${cycles.length} 处模块循环依赖和 ${layerViolations.length} 处反向分层依赖，严重影响代码可维护性与测试解耦。`;
    } else if (status === 'WARNING') {
      summary = `架构存在部分潜在异味：发现 ${cycles.length} 处循环关联或 ${layerViolations.length} 处分层跨权调用，建议重构消除。`;
    }

    return {
      score,
      status,
      cycles,
      layerViolations,
      summary,
    };
  }

  /**
   * 格式化为 Markdown 报告
   */
  public static formatMarkdown(report: ArchitectureHealthReport): string {
    const lines: string[] = [];
    const statusBadges: Record<string, string> = {
      HEALTHY: '🟢 HEALTHY (健康)',
      WARNING: '🟡 WARNING (存在异味/告警)',
      CRITICAL: '🔴 CRITICAL (高危架构缺陷)',
    };

    lines.push(`### 🛡️ 架构合规与健康度排查报告`);
    lines.push(`- **健康得分**: **${report.score} / 100**`);
    lines.push(`- **状态判定**: ${statusBadges[report.status] || report.status}`);
    lines.push(`- **审计结论**: ${report.summary}`);

    if (report.cycles.length > 0) {
      lines.push(`\n**🔄 循环依赖闭环检测 (共 ${report.cycles.length} 处)**:`);
      for (const c of report.cycles) {
        lines.push(`- ⚠️ \`${c.description}\``);
      }
      lines.push(`> 提示: 循环依赖会导致模块初始化顺序不可控、打包体积膨胀以及单元测试难以 Mock，建议通过引入接口契约或抽取公共下层模块解耦。`);
    } else {
      lines.push(`\n**循环依赖检测**: ✅ 未发现模块级循环依赖。`);
    }

    if (report.layerViolations.length > 0) {
      lines.push(`\n**⚡ 分层跨权违规 (共 ${report.layerViolations.length} 处)**:`);
      for (const v of report.layerViolations.slice(0, 6)) {
        lines.push(`- ${v.reason}`);
      }
      if (report.layerViolations.length > 6) {
        lines.push(`- ... (另有 ${report.layerViolations.length - 6} 处次要违规)`);
      }
    } else {
      lines.push(`\n**分层越权检测**: ✅ 核心层级依赖方向符合架构规范。`);
    }

    return lines.join('\n');
  }
}
