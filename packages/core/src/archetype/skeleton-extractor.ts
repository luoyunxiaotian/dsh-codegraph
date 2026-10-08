import { FullGraphResult } from '../types/index.js';

/**
 * 轻量级全局架构骨架提取器 (ArchitectureSkeletonExtractor)
 * 将复杂的 AST 全局图谱浓缩为约 250~300 Token 的高密度结构化 Markdown，
 * 专门作为会话启动阶段或系统提示词装配时的轻量级 Context 注水。
 */
export class ArchitectureSkeletonExtractor {
  public static extract(graph: FullGraphResult, workspaceRoot?: string): string {
    const meta = graph.meta;
    const modules = graph.architectureView.modules || [];
    const flows = graph.processFlows || [];

    // 1. 架构范式转中文可读标签
    const archetypeMap: Record<string, string> = {
      WEB_LAYERED: 'Web 分层架构 (Controller -> Service -> Dao/Repo)',
      WORKER_PIPELINE: '任务管道 / 事件流驱动架构',
      CLI_PIPELINE: 'CLI 命令行 / 数据处理流水线',
      LIBRARY_SDK: '核心库 / SDK 模式',
      UNIVERSAL: '自适应模块化拓扑',
    };
    const archetypeDesc = archetypeMap[meta.archetype] || meta.archetype || '模块化拓扑';

    const lines: string[] = [];
    lines.push('<code_graph_architecture>');
    lines.push('[项目架构骨架概览]');
    lines.push(`- 项目名称: ${meta.projectName || 'workspace'}`);
    lines.push(`- 架构范式: ${archetypeDesc}${meta.archetypeHealth?.score ? ` (健康度评分: ${(meta.archetypeHealth.score * 100).toFixed(0)}分)` : ''}`);
    lines.push(`- 规模统计: ${meta.fileCount} 个源码文件, ${modules.length} 个核心模块, ${meta.nodeCount} 个关键符号`);

    if (meta.isMultiProject && meta.projects && meta.projects.length > 1) {
      const projNames = meta.projects.map((p) => p.name || p.id).slice(0, 5).join(', ');
      lines.push(`- 子工程生态: 包含 ${meta.projects.length} 个子端/子包 (${projNames}${meta.projects.length > 5 ? ' 等' : ''})`);
    }

    // 2. 核心模块与入口清单 (按名称字母序严格排序，精简控制在 6 个关键模块内)
    if (modules.length > 0) {
      lines.push('\n[核心模块清单]');
      const sortedModules = [...modules].sort((a, b) => a.name.localeCompare(b.name));
      const displayModules = sortedModules.slice(0, 6);
      for (const m of displayModules) {
        // 寻找代表性入口文件 (index, main, app, cli, server, mod, 或首个文件)
        const rawEntry = m.files.find((f) => /(index|main|app|cli|server|mod)\.(ts|js|py|go|rs|cs|java|cpp)/i.test(f)) || m.files[0] || '';
        const entryFile = rawEntry.replace(/\\/g, '/');
        const portInfo = m.inPorts.length > 0 || m.outPorts.length > 0 ? ` (入端口: ${m.inPorts.length}, 出端口: ${m.outPorts.length})` : '';
        const entryInfo = entryFile ? ` -> 主入口/代表文件: ${entryFile}` : '';
        lines.push(`* ${m.name}: ${m.files.length} 个文件${portInfo}${entryInfo}`);
      }
      if (modules.length > 6) {
        lines.push(`* ... (另有 ${modules.length - 6} 个辅助模块)`);
      }
    }

    // 3. 典型业务时序流 (按流程名称严格排序，控制在 3-4 条核心业务流)
    if (flows.length > 0) {
      lines.push('\n[核心业务流程]');
      const sortedFlows = [...flows].sort((a, b) => a.title.localeCompare(b.title));
      const displayFlows = sortedFlows.slice(0, 4);
      for (const f of displayFlows) {
        lines.push(`* ${f.title} (${f.steps.length} 步时序链路)`);
      }
      if (flows.length > 4) {
        lines.push(`* ... (另有 ${flows.length - 4} 条时序流程)`);
      }
    }

    // 4. 强烈推荐引导建议 (优先调用图谱，避免盲目 grep/read)
    lines.push('\n[智能体协同指引]');
    lines.push('💡 当前工程已挂载本地 CodeGraph AST 图谱引擎。在分析代码结构、寻找关键声明、排查调用链路（支持 from➔to 最短路径穿透）或修改前评估影响面时，强烈建议优先使用 codegraph 专属工具（如 codegraph_get_architecture, codegraph_trace_flow, codegraph_impact_analysis, codegraph_inspect_narrative, codegraph_audit_health）获取确定性拓扑，避免盲目 grep/read 大文件；仅在需要编辑修改具体源码时使用 edit/read。');
    lines.push('</code_graph_architecture>');

    return lines.join('\n');
  }
}
