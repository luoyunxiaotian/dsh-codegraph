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
        'elk.layered.spacing.nodeNodeBetweenLayers': '80',
        'elk.edgeRouting': 'ORTHOGONAL',
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
   */
  public static async layoutModuleDetail(
    internalNodes: CodeNode[],
    internalCalls: Array<{ source: string; target: string }>
  ): Promise<LayoutResult> {
    const children: ElkNode[] = internalNodes.map((n) => ({
      id: n.id,
      width: 220,
      height: 75,
    }));

    const edges: ElkExtendedEdge[] = internalCalls.map((c, idx) => ({
      id: `detail_edge_${idx}`,
      sources: [c.source],
      targets: [c.target],
    }));

    const rootGraph: ElkNode = {
      id: 'module_detail_root',
      layoutOptions: {
        'elk.algorithm': 'layered',
        'elk.direction': 'RIGHT',
        'elk.spacing.nodeNode': '35',
        'elk.layered.spacing.nodeNodeBetweenLayers': '55',
        'elk.edgeRouting': 'ORTHOGONAL',
      },
      children,
      edges,
    };

    const layouted = await elk.layout(rootGraph);

    const layoutedNodes: LayoutedNode[] = (layouted.children || []).map((c: any) => ({
      id: c.id,
      x: c.x || 0,
      y: c.y || 0,
      width: c.width || 220,
      height: c.height || 75,
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
}
