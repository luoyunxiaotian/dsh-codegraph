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
   * 采用 Sugiyama 分层排版算法 + LAYER_SWEEP 交叉最小化策略 + In/Out Port 首尾层约束
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
    const children: ElkNode[] = [];

    // 1. In-Ports (固定在最左侧首层)
    const inPortsList = options?.inPorts || [];
    inPortsList.forEach((p) => {
      const id = typeof p === 'string' ? `inport_${p}` : p.id;
      children.push({
        id,
        width: 170,
        height: 52,
        layoutOptions: {
          'elk.layered.layering.layerConstraint': 'FIRST',
        },
      });
    });

    // 2. 内部符号节点 (中间层)
    internalNodes.forEach((n) => {
      children.push({
        id: n.id,
        width: 230,
        height: 85,
      });
    });

    // 3. Out-Ports (固定在最右侧尾层)
    const outPortsList = options?.outPorts || [];
    outPortsList.forEach((p) => {
      const id = typeof p === 'string' ? `outport_${p}` : p.id;
      children.push({
        id,
        width: 170,
        height: 52,
        layoutOptions: {
          'elk.layered.layering.layerConstraint': 'LAST',
        },
      });
    });

    // 4. 汇总所有连线 (内部调用 + 端口连线)
    const allCalls = [...internalCalls, ...(options?.portEdges || [])];
    const edges: ElkExtendedEdge[] = allCalls.map((c, idx) => ({
      id: `detail_edge_${idx}`,
      sources: [c.source],
      targets: [c.target],
    }));

    const totalNodes = children.length;
    // 自适应分级：超大模块(>200)极速交互排序，中型模块(>50)启发式中位数排序，小型模块精细扫层
    const crossingStrategy = totalNodes > 200 ? 'INTERACTIVE' : totalNodes > 50 ? 'MEDIAN' : 'LAYER_SWEEP';
    const maxIterations = totalNodes > 200 ? '1' : totalNodes > 50 ? '2' : '4';

    const rootGraph: ElkNode = {
      id: 'module_detail_root',
      layoutOptions: {
        'elk.algorithm': 'layered',
        'elk.direction': 'RIGHT',
        'elk.spacing.nodeNode': '40',
        'elk.layered.spacing.nodeNodeBetweenLayers': '90',
        'elk.edgeRouting': 'NONE', // 连线由前端 React Flow smoothstep 原生绘制，无需在服务端浪费大量 CPU 遍历正交网格
        'elk.layered.crossingMinimization.strategy': crossingStrategy,
        'elk.layered.crossingMinimization.greedySwitchCrossingMinimization.maxIterations': maxIterations,
        'elk.layered.nodePlacement.strategy': 'BRANDES_KOEPF',
        'elk.layered.cycleBreaking.strategy': 'DEPTH_FIRST',
      },
      children,
      edges,
    };

    const layouted = await elk.layout(rootGraph);

    // 5. 层级折叠与多列网格规整 (规避超高纵向堆叠，单列超过 10 个节点时自动折叠成多列网格)
    const rawChildren: any[] = layouted.children || [];
    
    // 找出所有唯一的层级 X 坐标 (容差 35px)
    const sortedByX = [...rawChildren].sort((a, b) => (a.x || 0) - (b.x || 0));
    const layers: Array<{ baseX: number; nodes: any[] }> = [];

    sortedByX.forEach((child) => {
      const x = child.x || 0;
      const matchedLayer = layers.find((l) => Math.abs(l.baseX - x) <= 35);
      if (matchedLayer) {
        matchedLayer.nodes.push(child);
      } else {
        layers.push({ baseX: x, nodes: [child] });
      }
    });

    const maxPerCol = 10;
    let accumulatedExtraX = 0;
    let maxOverallX = 1000;
    let maxOverallY = 600;

    const layoutedNodes: LayoutedNode[] = [];

    layers.forEach((layer) => {
      // 保持 ELK 计算出的 Y 排序（保留其交叉最小化优化）
      layer.nodes.sort((a, b) => (a.y || 0) - (b.y || 0));

      const isPortLayer = layer.nodes.every((n) => n.id.startsWith('inport_') || n.id.startsWith('outport_'));
      const effectiveMaxPerCol = isPortLayer ? 12 : maxPerCol;
      const layerBaseX = layer.baseX + accumulatedExtraX;

      layer.nodes.forEach((n, idx) => {
        const colIdx = Math.floor(idx / effectiveMaxPerCol);
        const rowIdx = idx % effectiveMaxPerCol;
        const w = n.width || (n.id.startsWith('inport_') || n.id.startsWith('outport_') ? 170 : 230);
        const h = n.height || (n.id.startsWith('inport_') || n.id.startsWith('outport_') ? 52 : 85);
        const colSpacing = w + 40;
        const rowSpacing = h + 30;

        const posX = layerBaseX + colIdx * colSpacing;
        const posY = 40 + rowIdx * rowSpacing;

        layoutedNodes.push({
          id: n.id,
          x: posX,
          y: posY,
          width: w,
          height: h,
        });

        if (posX + w > maxOverallX) maxOverallX = posX + w;
        if (posY + h > maxOverallY) maxOverallY = posY + h;
      });

      const totalColsInLayer = Math.ceil(layer.nodes.length / effectiveMaxPerCol);
      if (totalColsInLayer > 1) {
        const sampleW = layer.nodes[0]?.width || 230;
        accumulatedExtraX += (totalColsInLayer - 1) * (sampleW + 40);
      }
    });

    const layoutedEdges: LayoutedEdge[] = (layouted.edges || []).map((e: any) => ({
      id: e.id,
      source: e.sources[0],
      target: e.targets[0],
      sections: e.sections as any,
    }));

    return {
      nodes: layoutedNodes,
      edges: layoutedEdges,
      width: Math.max(layouted.width || 1000, maxOverallX + 100),
      height: Math.max(maxOverallY + 100, 600),
    };
  }
}
