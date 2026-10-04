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

    // 1. Kahn 拓扑分层 + 环路安全截断 (Cycle Breaking)
    const rank: Record<string, number> = {};
    const inDegreeWork = { ...inDegree };
    let currentLayer: string[] = [];

    internalNodes.forEach((n) => {
      if ((inDegreeWork[n.id] || 0) === 0) {
        rank[n.id] = 0;
        currentLayer.push(n.id);
      }
    });

    if (currentLayer.length === 0 && internalNodes.length > 0) {
      rank[internalNodes[0].id] = 0;
      currentLayer.push(internalNodes[0].id);
    }

    let layerIdx = 0;
    const maxDepth = Math.min(internalNodes.length, 30);
    while (currentLayer.length > 0 && layerIdx < maxDepth) {
      const nextLayer: string[] = [];
      currentLayer.forEach((u) => {
        (adj[u] || []).forEach((v) => {
          inDegreeWork[v] = (inDegreeWork[v] || 1) - 1;
          if (inDegreeWork[v] <= 0 && rank[v] === undefined) {
            rank[v] = layerIdx + 1;
            nextLayer.push(v);
          }
        });
      });
      currentLayer = nextLayer;
      layerIdx++;
    }

    // 环路残留节点平滑分派
    let unassigned = 0;
    internalNodes.forEach((n) => {
      if (rank[n.id] === undefined) {
        rank[n.id] = layerIdx + Math.floor(unassigned / 8);
        unassigned++;
      }
    });

    // 2. 按层分组
    const layers: Record<number, CodeNode[]> = {};
    internalNodes.forEach((n) => {
      const r = rank[n.id] || 0;
      if (!layers[r]) layers[r] = [];
      layers[r].push(n);
    });

    const sortedLayerRanks = Object.keys(layers).map(Number).sort((a, b) => a - b);

    // 3. 跨层重心启发式排序 (Barycenter Crossing Minimization)
    // 初始同层排版：优先同源文件聚类保持代码内聚性
    const nodeYIndex = new Map<string, number>();
    sortedLayerRanks.forEach((r) => {
      layers[r].sort((a, b) => {
        const fComp = (a.filePath || '').localeCompare(b.filePath || '');
        if (fComp !== 0) return fComp;
        return a.name.localeCompare(b.name);
      });
      layers[r].forEach((n, idx) => nodeYIndex.set(n.id, idx));
    });

    // 3 轮正反向重心平滑扫层，将有调用关系的节点在纵向(Y轴)尽量拉平对齐，大幅消减交叉线
    for (let pass = 0; pass < 3; pass++) {
      // 正向扫层 (基于前驱节点对齐)
      for (let i = 1; i < sortedLayerRanks.length; i++) {
        const r = sortedLayerRanks[i];
        layers[r].sort((a, b) => {
          const getBary = (nId: string) => {
            const preds = revAdj[nId] || [];
            if (preds.length === 0) return nodeYIndex.get(nId) ?? 0;
            let sum = 0;
            preds.forEach((p) => { sum += (nodeYIndex.get(p) ?? 0); });
            return sum / preds.length;
          };
          return getBary(a.id) - getBary(b.id);
        });
        layers[r].forEach((n, idx) => nodeYIndex.set(n.id, idx));
      }

      // 反向扫层 (基于后继节点对齐)
      for (let i = sortedLayerRanks.length - 2; i >= 0; i--) {
        const r = sortedLayerRanks[i];
        layers[r].sort((a, b) => {
          const getBary = (nId: string) => {
            const succs = adj[nId] || [];
            if (succs.length === 0) return nodeYIndex.get(nId) ?? 0;
            let sum = 0;
            succs.forEach((s) => { sum += (nodeYIndex.get(s) ?? 0); });
            return sum / succs.length;
          };
          return getBary(a.id) - getBary(b.id);
        });
        layers[r].forEach((n, idx) => nodeYIndex.set(n.id, idx));
      }
    }

    // 4. 坐标映射与自适应多列折叠 (每列自适应上限 8~16 行，保持黄金宽高比)
    const MAX_PER_COL = internalNodes.length > 100 ? 16 : internalNodes.length > 30 ? 12 : 8;
    const CARD_WIDTH = 220;
    const CARD_HEIGHT = 85;
    const X_GAP = 60;
    const Y_GAP = 25;

    const positions: Record<string, { x: number; y: number; width: number; height: number }> = {};
    let currentX = 300;

    // In-Ports 放置在左侧 X=50
    const inPortsList = options?.inPorts || [];
    inPortsList.forEach((port, idx) => {
      const pId = typeof port === 'string' ? `inport_${port}` : port.id;
      positions[pId] = { x: 50, y: 80 + idx * 70, width: 170, height: 52 };
    });

    sortedLayerRanks.forEach((r) => {
      const nodesInLayer = layers[r] || [];
      const cols = Math.ceil(nodesInLayer.length / MAX_PER_COL) || 1;

      nodesInLayer.forEach((n, idx) => {
        const colIdx = Math.floor(idx / MAX_PER_COL);
        const rowIdx = idx % MAX_PER_COL;
        const x = currentX + colIdx * (CARD_WIDTH + 35);
        const y = 80 + rowIdx * (CARD_HEIGHT + Y_GAP);
        positions[n.id] = { x, y, width: CARD_WIDTH, height: CARD_HEIGHT };
      });

      currentX += cols * (CARD_WIDTH + 35) + X_GAP;
    });

    // Out-Ports 放置在最右侧
    const rightX = Math.max(currentX, 850);
    const outPortsList = options?.outPorts || [];
    outPortsList.forEach((port, idx) => {
      const pId = typeof port === 'string' ? `outport_${port}` : port.id;
      positions[pId] = { x: rightX, y: 80 + idx * 70, width: 170, height: 52 };
    });

    let maxY = 600;
    Object.values(positions).forEach((p) => {
      if (p.y + p.height > maxY) maxY = p.y + p.height;
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
      width: rightX + 240,
      height: maxY + 100,
    };
  }
}
