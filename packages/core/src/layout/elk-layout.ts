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

    const layoutedNodes: LayoutedNode[] = (layouted.children || []).map((c: any) => ({
      id: c.id,
      x: c.x || 0,
      y: c.y || 0,
      width: c.width || (c.id.startsWith('inport_') || c.id.startsWith('outport_') ? 170 : 230),
      height: c.height || (c.id.startsWith('inport_') || c.id.startsWith('outport_') ? 52 : 85),
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
}
