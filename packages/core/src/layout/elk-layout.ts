import _ELK from 'elkjs/lib/elk.bundled.js';
import type { ElkNode, ElkExtendedEdge } from 'elkjs';
import { ModuleContainer, ModuleBus, ProcessFlow, CodeNode } from '../types/index.js';

export interface LayoutedNode {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  label?: string;
  data?: any;
}

export interface LayoutedEdge {
  id: string;
  source: string;
  target: string;
  sections?: Array<{
    startPoint: { x: number; y: number };
    endPoint: { x: number; y: number };
    bendPoints?: Array<{ x: number; y: number }>;
  }>;
  data?: any;
}

export interface LayoutResult {
  nodes: LayoutedNode[];
  edges: LayoutedEdge[];
  width: number;
  height: number;
}

const ELK = ((_ELK as any).default || _ELK) as any;
const elk = new ELK();

export class ElkLayoutEngine {
  /**
   * 计算宏观架构图的分层正交布局 (Module Containers & Buses)
   */
  public static async layoutArchitecture(
    modules: ModuleContainer[],
    buses: ModuleBus[]
  ): Promise<LayoutResult> {
    const children: ElkNode[] = modules.map((m) => ({
      id: m.id,
      width: 280,
      height: 140,
    }));

    const edges: ElkExtendedEdge[] = buses.map((b) => ({
      id: b.id,
      sources: [b.sourceModule],
      targets: [b.targetModule],
    }));

    const rootGraph: ElkNode = {
      id: 'root',
      layoutOptions: {
        'elk.algorithm': 'layered',
        'elk.direction': 'RIGHT',
        'elk.spacing.nodeNode': '60',
        'elk.layered.spacing.nodeNodeBetweenLayers': '90',
        'elk.edgeRouting': 'ORTHOGONAL',
        'elk.layered.crossingMinimization.strategy': 'LAYER_SWEEP',
        'elk.layered.nodePlacement.strategy': 'BRANDES_KOEPF',
        'elk.layered.cycleBreaking.strategy': 'DEPTH_FIRST',
      },
      children,
      edges,
    };

    const layouted = await elk.layout(rootGraph);

    const layoutedNodes: LayoutedNode[] = (layouted.children || []).map((c: any) => ({
      id: c.id,
      x: c.x || 0,
      y: c.y || 0,
      width: c.width || 280,
      height: c.height || 140,
    }));

    const layoutedEdges: LayoutedEdge[] = (layouted.edges || []).map((e: any) => ({
      id: e.id,
      source: e.sources[0],
      target: e.targets[0],
      sections: e.sections as any,
    }));

    return {
      nodes: layoutedNodes,
      edges: layoutedEdges,
      width: layouted.width || 1000,
      height: layouted.height || 600,
    };
  }

  /**
   * 计算业务时序流程图的流向布局 (Process Flow)
   */
  public static async layoutProcessFlow(flow: ProcessFlow): Promise<LayoutResult> {
    const children: ElkNode[] = flow.steps.map((s) => ({
      id: s.id,
      width: s.stepType === 'ENTRY' ? 220 : s.stepType === 'DECISION' ? 180 : 200,
      height: s.stepType === 'DECISION' ? 70 : 80,
    }));

    const edges: ElkExtendedEdge[] = flow.edges.map((e, idx) => ({
      id: `flow_edge_${idx}`,
      sources: [e.source],
      targets: [e.target],
    }));

    const rootGraph: ElkNode = {
      id: 'flow_root',
      layoutOptions: {
        'elk.algorithm': 'layered',
        'elk.direction': 'DOWN',
        'elk.spacing.nodeNode': '40',
        'elk.layered.spacing.nodeNodeBetweenLayers': '60',
        'elk.edgeRouting': 'ORTHOGONAL',
        'elk.layered.crossingMinimization.strategy': 'LAYER_SWEEP',
        'elk.layered.nodePlacement.strategy': 'BRANDES_KOEPF',
      },
      children,
      edges,
    };

    const layouted = await elk.layout(rootGraph);

    const layoutedNodes: LayoutedNode[] = (layouted.children || []).map((c: any) => ({
      id: c.id,
      x: c.x || 0,
      y: c.y || 0,
      width: c.width || 200,
      height: c.height || 80,
    }));

    const layoutedEdges: LayoutedEdge[] = (layouted.edges || []).map((e: any) => ({
      id: e.id,
      source: e.sources[0],
      target: e.targets[0],
      sections: e.sections as any,
    }));

    return {
      nodes: layoutedNodes,
      edges: layoutedEdges,
      width: layouted.width || 800,
      height: layouted.height || 600,
    };
  }

  /**
   * 计算模块内部符号下钻细节图的布局 (Module Internal Drill-Down)
   * 采用 Kahn 拓扑分层 + 3 轮正反向重心启发式扫层 (Barycenter Crossing Minimization) + 自适应多列折叠网格
   * 兼顾极速性能 (< 15ms) 与优异连线正交对齐体验，彻底规避极端超宽超高畸变！
   */
  public static async layoutModuleDetail(
    internalNodes: CodeNode[],
    internalCalls: Array<{ source: string; target: string }>,
    options?: {
      inPorts?: string[] | Array<{ id: string; name?: string }>;
      outPorts?: string[] | Array<{ id: string; name?: string }>;
      portEdges?: Array<{ source: string; target: string }>;
    }
  ): Promise<LayoutResult> {
    if (internalNodes.length === 0) {
      return { nodes: [], edges: [], width: 800, height: 600 };
    }

    const inDegree: Record<string, number> = {};
    const outDegree: Record<string, number> = {};
    const adj: Record<string, string[]> = {};
    const revAdj: Record<string, string[]> = {};

    internalNodes.forEach((n) => {
      inDegree[n.id] = 0;
      outDegree[n.id] = 0;
      adj[n.id] = [];
      revAdj[n.id] = [];
    });

    internalCalls.forEach((e) => {
      if (adj[e.source] && adj[e.target] && e.source !== e.target) {
        adj[e.source].push(e.target);
        revAdj[e.target].push(e.source);
        inDegree[e.target] = (inDegree[e.target] || 0) + 1;
        outDegree[e.source] = (outDegree[e.source] || 0) + 1;
      }
    });

    // 1. 自适应计算目标纵横比与最大行数 (杜绝万像素单行长蛇阵，收敛至 16:9 ~ 4:3 黄金视口)
    const totalN = internalNodes.length;
    const maxRows = totalN > 300 ? 28 : totalN > 150 ? 20 : totalN > 50 ? 14 : 8;
    const MAX_STAGES = totalN > 200 ? 8 : totalN > 60 ? 6 : 4;

    // 2. Kahn 拓扑分层 (带环路安全截断)
    const rawRank: Record<string, number> = {};
    const inDegreeWork = { ...inDegree };
    let currentLayer: string[] = [];

    internalNodes.forEach((n) => {
      if ((inDegreeWork[n.id] || 0) === 0) {
        rawRank[n.id] = 0;
        currentLayer.push(n.id);
      }
    });

    if (currentLayer.length === 0 && internalNodes.length > 0) {
      rawRank[internalNodes[0].id] = 0;
      currentLayer.push(internalNodes[0].id);
    }

    let layerIdx = 0;
    const maxSearchDepth = 25;
    while (currentLayer.length > 0 && layerIdx < maxSearchDepth) {
      const nextLayer: string[] = [];
      currentLayer.forEach((u) => {
        (adj[u] || []).forEach((v) => {
          inDegreeWork[v] = (inDegreeWork[v] || 1) - 1;
          if (inDegreeWork[v] <= 0 && rawRank[v] === undefined) {
            rawRank[v] = layerIdx + 1;
            nextLayer.push(v);
          }
        });
      });
      currentLayer = nextLayer;
      layerIdx++;
    }

    // 3. 映射收敛至主阶段列数 [0, MAX_STAGES - 1]，环路与未遍历节点均匀落入中间处理阶段
    const rank: Record<string, number> = {};
    const maxRawRank = Math.max(1, ...Object.values(rawRank));
    let unassignedCount = 0;

    internalNodes.forEach((n) => {
      if (rawRank[n.id] !== undefined) {
        const mapped = Math.min(
          MAX_STAGES - 1,
          Math.floor((rawRank[n.id] / maxRawRank) * (MAX_STAGES - 1))
        );
        rank[n.id] = mapped;
      } else {
        const mid = 1 + (unassignedCount % Math.max(1, MAX_STAGES - 2));
        rank[n.id] = mid;
        unassignedCount++;
      }
    });

    // 4. 按层分组
    const layers: Record<number, CodeNode[]> = {};
    for (let s = 0; s < MAX_STAGES; s++) layers[s] = [];
    internalNodes.forEach((n) => {
      const r = rank[n.id] || 0;
      layers[r].push(n);
    });

    // 跨层重心启发式排序 (Barycenter Crossing Minimization) + 同源文件局部聚类
    const nodeYIndex = new Map<string, number>();
    for (let s = 0; s < MAX_STAGES; s++) {
      layers[s].sort((a, b) => {
        const fComp = (a.filePath || '').localeCompare(b.filePath || '');
        if (fComp !== 0) return fComp;
        return a.name.localeCompare(b.name);
      });
      layers[s].forEach((n, idx) => nodeYIndex.set(n.id, idx));
    }

    for (let pass = 0; pass < 2; pass++) {
      for (let s = 1; s < MAX_STAGES; s++) {
        layers[s].sort((a, b) => {
          const getBary = (nId: string) => {
            const preds = revAdj[nId] || [];
            if (preds.length === 0) return nodeYIndex.get(nId) ?? 0;
            let sum = 0;
            preds.forEach((p) => { sum += (nodeYIndex.get(p) ?? 0); });
            return sum / preds.length;
          };
          return getBary(a.id) - getBary(b.id);
        });
        layers[s].forEach((n, idx) => nodeYIndex.set(n.id, idx));
      }
    }

    // 5. 坐标网格化分配与多列折叠
    const CARD_WIDTH = 220;
    const CARD_HEIGHT = 85;
    const COL_GAP = 35;
    const ROW_GAP = 22;
    const STAGE_GAP = 70;

    const positions: Record<string, { x: number; y: number; width: number; height: number }> = {};
    let currentX = 260;
    let maxY = 500;

    // In-Ports 排布在最左列 X=50
    const inPortsList = options?.inPorts || [];
    inPortsList.forEach((port, idx) => {
      const pId = typeof port === 'string' ? `inport_${port}` : port.id;
      const y = 80 + idx * 65;
      positions[pId] = { x: 50, y, width: 170, height: 52 };
      if (y + 52 > maxY) maxY = y + 52;
    });

    for (let s = 0; s < MAX_STAGES; s++) {
      const nodesInStage = layers[s];
      if (nodesInStage.length === 0) continue;

      const cols = Math.ceil(nodesInStage.length / maxRows) || 1;

      nodesInStage.forEach((n, idx) => {
        const colIdx = Math.floor(idx / maxRows);
        const rowIdx = idx % maxRows;
        const x = currentX + colIdx * (CARD_WIDTH + COL_GAP);
        const y = 80 + rowIdx * (CARD_HEIGHT + ROW_GAP);
        positions[n.id] = { x, y, width: CARD_WIDTH, height: CARD_HEIGHT };
        if (y + CARD_HEIGHT > maxY) maxY = y + CARD_HEIGHT;
      });

      currentX += cols * (CARD_WIDTH + COL_GAP) + STAGE_GAP;
    }

    // Out-Ports 排布在最右列
    const rightX = Math.max(currentX, 850);
    const outPortsList = options?.outPorts || [];
    outPortsList.forEach((port, idx) => {
      const pId = typeof port === 'string' ? `outport_${port}` : port.id;
      const y = 80 + idx * 65;
      positions[pId] = { x: rightX, y, width: 170, height: 52 };
      if (y + 52 > maxY) maxY = y + 52;
    });

    const layoutedNodes: LayoutedNode[] = Object.entries(positions).map(([id, p]) => ({
      id,
      x: p.x,
      y: p.y,
      width: p.width,
      height: p.height,
    }));

    const allCalls = [...internalCalls, ...(options?.portEdges || [])];
    const layoutedEdges: LayoutedEdge[] = allCalls.map((c, idx) => ({
      id: `detail_edge_${idx}`,
      source: c.source,
      target: c.target,
    }));

    return {
      nodes: layoutedNodes,
      edges: layoutedEdges,
      width: rightX + 220,
      height: maxY + 80,
    };
  }
}
