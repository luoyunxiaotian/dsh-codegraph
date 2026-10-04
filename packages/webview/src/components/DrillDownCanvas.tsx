import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  Handle,
  Position,
  NodeProps,
  useNodesState,
  useEdgesState,
  ReactFlowInstance,
  Node,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { ModuleContainer, CodeNode, CodeEdge } from '../../../core/src/types/index.js';
import {
  Box,
  Code,
  ArrowLeftCircle,
  ArrowRightCircle,
  ArrowLeft,
  MessageSquarePlus,
  Bot,
  Copy,
  FileCode,
  Maximize2,
  Globe,
  BookOpen,
  Wand2,
  GitFork,
  Filter,
  Sparkles,
  Route,
} from 'lucide-react';
import { ContextMenu, ContextMenuItem } from './ContextMenu.js';
import { insertIntoChat, copyToClipboard, showToast } from '../utils/chatBridge.js';
import { useTheme } from '../context/ThemeContext.js';

interface DrillDownCanvasProps {
  module: ModuleContainer;
  allNodes: Record<string, CodeNode>;
  allEdges: CodeEdge[];
  onSelectNode: (nodeId: string, filePath: string, line: number) => void;
  onBackToArchitecture: () => void;
}

// 模块内部符号节点
const InternalSymbolNode = ({ data }: NodeProps) => {
  const node = data.node as CodeNode;
  const onSelectNode = data.onSelectNode as (id: string, path: string, line: number) => void;
  const isFocused = Boolean(data.isFocused);
  const isConnected = Boolean(data.isConnected);
  const isDimmed = Boolean(data.isDimmed);

  const isClass = node.entityType === 'CLASS';
  const isContract = node.entityType === 'CONTRACT_ENDPOINT' || node.entityType === 'CONTRACT_TOPIC';

  return (
    <div
      onClick={() => onSelectNode(node.id, node.filePath, node.loc.startLine)}
      title={node.metadata?.story?.summaryText || `${node.name}: 点击打开交互透视与源码`}
      style={{
        opacity: isDimmed ? 0.35 : 1,
        transition: 'opacity 0.2s ease, box-shadow 0.2s ease',
        boxShadow: isFocused
          ? '0 0 0 2px #3b82f6, 0 6px 20px -2px rgba(59, 130, 246, 0.35)'
          : isConnected
          ? '0 0 0 1.5px rgba(59, 130, 246, 0.6), 0 4px 12px -2px rgba(59, 130, 246, 0.15)'
          : undefined,
      }}
      className={`w-[220px] bg-dsh-layer1 border ${
        isFocused
          ? 'border-dsh-blue'
          : isConnected
          ? 'border-dsh-blue/70'
          : isContract
          ? 'border-indigo-500/50 hover:border-indigo-400 shadow-indigo-950/20'
          : 'border-dsh-border2 hover:border-dsh-blue'
      } rounded-md shadow p-2.5 cursor-grab active:cursor-grabbing group transition-all select-none`}
    >
      <Handle type="target" position={Position.Left} />
      <Handle type="source" position={Position.Right} />

      <div className="flex items-center justify-between mb-1.5">
        <div className="flex items-center gap-1">
          <span
            className={`text-[9px] px-1.5 py-0.5 rounded font-mono ${
              isContract
                ? 'bg-indigo-500/10 text-indigo-300 border border-indigo-500/30'
                : isClass
                ? 'bg-dsh-amber-tint text-dsh-amber border border-dsh-amber-border'
                : 'bg-dsh-blue-tint text-dsh-blue border border-dsh-blue-border'
            }`}
          >
            {isContract ? (node.entityType === 'CONTRACT_ENDPOINT' ? 'REST API' : 'TOPIC') : node.entityType}
          </span>
          {node.language && node.language !== 'contract' && (
            <span className="text-[9px] px-1 py-0.2 rounded font-mono bg-dsh-layer2 text-dsh-tertiary border border-dsh-border1 uppercase">
              {node.language}
            </span>
          )}
        </div>
        <span className="text-[10px] text-dsh-dimmed font-mono">L{node.loc.startLine}</span>
      </div>

      <div className="flex items-center gap-1.5 mb-1">
        {isContract ? (
          <Globe className="w-3.5 h-3.5 text-indigo-400 shrink-0" />
        ) : isClass ? (
          <Box className="w-3.5 h-3.5 text-dsh-amber shrink-0" />
        ) : (
          <Code className="w-3.5 h-3.5 text-dsh-blue shrink-0" />
        )}
        <span className="text-[12px] font-semibold text-dsh-primary truncate" title={node.name}>
          {node.name}
        </span>
      </div>

      <div className="text-[10px] text-dsh-tertiary truncate border-t border-dsh-border1 pt-1 font-mono">
        {node.filePath.split(/[/\\]/).pop()}
      </div>
    </div>
  );
};

// In-Port 端口卡片
const InPortNode = ({ data }: NodeProps) => {
  const name = (data as any)?.name as string;
  const isFocused = Boolean((data as any)?.isFocused);
  const isConnected = Boolean((data as any)?.isConnected);
  const isDimmed = Boolean((data as any)?.isDimmed);

  return (
    <div
      style={{
        opacity: isDimmed ? 0.35 : 1,
        transition: 'opacity 0.2s ease, box-shadow 0.2s ease',
        boxShadow: isFocused
          ? '0 0 0 2px #10b981, 0 6px 20px -2px rgba(16, 185, 129, 0.35)'
          : isConnected
          ? '0 0 0 1.5px rgba(16, 185, 129, 0.6)'
          : undefined,
      }}
      className={`w-[170px] bg-dsh-green-tint border ${
        isFocused
          ? 'border-emerald-500'
          : isConnected
          ? 'border-emerald-500/80'
          : 'border-dsh-green-border'
      } rounded-md p-2 shadow flex items-center gap-2 select-none cursor-grab active:cursor-grabbing`}
    >
      <Handle type="source" position={Position.Right} />
      <ArrowLeftCircle className="w-3.5 h-3.5 text-dsh-green shrink-0" />
      <div className="truncate">
        <div className="text-[9px] text-dsh-green font-bold uppercase tracking-tight">📥 IN-PORT (外部入口)</div>
        <div className="text-[11px] font-mono text-dsh-primary truncate" title={name}>
          {name}
        </div>
      </div>
    </div>
  );
};

// Out-Port 端口卡片
const OutPortNode = ({ data }: NodeProps) => {
  const name = (data as any)?.name as string;
  const isFocused = Boolean((data as any)?.isFocused);
  const isConnected = Boolean((data as any)?.isConnected);
  const isDimmed = Boolean((data as any)?.isDimmed);

  return (
    <div
      style={{
        opacity: isDimmed ? 0.35 : 1,
        transition: 'opacity 0.2s ease, box-shadow 0.2s ease',
        boxShadow: isFocused
          ? '0 0 0 2px #3b82f6, 0 6px 20px -2px rgba(59, 130, 246, 0.35)'
          : isConnected
          ? '0 0 0 1.5px rgba(59, 130, 246, 0.6)'
          : undefined,
      }}
      className={`w-[170px] bg-dsh-blue-tint border ${
        isFocused
          ? 'border-blue-500'
          : isConnected
          ? 'border-blue-500/80'
          : 'border-dsh-blue-border'
      } rounded-md p-2 shadow flex items-center justify-between select-none cursor-grab active:cursor-grabbing`}
    >
      <Handle type="target" position={Position.Left} />
      <div className="truncate">
        <div className="text-[9px] text-dsh-blue font-bold uppercase tracking-tight">📤 OUT-PORT (外调依赖)</div>
        <div className="text-[11px] font-mono text-dsh-primary truncate" title={name}>
          {name}
        </div>
      </div>
      <ArrowRightCircle className="w-3.5 h-3.5 text-dsh-blue shrink-0 ml-1" />
    </div>
  );
};

/**
 * 客户端拓扑排版算法 (Kahn Topological DAG Layering & Cycle Breaking)
 * 复杂度 O(V + E)，耗时 < 15ms，彻底杜绝环路依赖无限循环卡死！
 */
function calculateClientTopologicalLayout(
  module: ModuleContainer,
  internalNodes: CodeNode[],
  allEdges: CodeEdge[]
): Record<string, { x: number; y: number }> {
  const positions: Record<string, { x: number; y: number }> = {};
  const internalIds = new Set(internalNodes.map((n) => n.id));

  // 1. In-Ports 固定排布在最左列
  module.inPorts.forEach((port, idx) => {
    positions[`inport_${port}`] = { x: 50, y: 100 + idx * 75 };
  });

  // 2. 构建内部有向图 (Adjacency & in-degrees，自动过滤自环)
  const adj: Record<string, string[]> = {};
  const inDegree: Record<string, number> = {};
  internalNodes.forEach((n) => {
    adj[n.id] = [];
    inDegree[n.id] = 0;
  });

  allEdges.forEach((e) => {
    if (internalIds.has(e.source) && internalIds.has(e.target) && e.source !== e.target) {
      adj[e.source]?.push(e.target);
      inDegree[e.target] = (inDegree[e.target] || 0) + 1;
    }
  });

  // 3. 安全分层：采用 Kahn 拓扑分层 + 环路安全截断 (绝对杜绝无限循环死锁)
  const rank: Record<string, number> = {};
  const inDegreeWork = { ...inDegree };
  let currentLayer: string[] = [];

  // 入度为 0 的节点作为第 0 层 (Entry/Root)
  internalNodes.forEach((n) => {
    if ((inDegreeWork[n.id] || 0) === 0) {
      rank[n.id] = 0;
      currentLayer.push(n.id);
    }
  });

  // 若无入度为 0 的节点（全图成环），选取第一个节点作为起点，打破死锁
  if (currentLayer.length === 0 && internalNodes.length > 0) {
    const firstId = internalNodes[0].id;
    rank[firstId] = 0;
    currentLayer.push(firstId);
  }

  let layerIndex = 0;
  const maxSafeDepth = Math.min(internalNodes.length, 50); // 安全深度上限

  while (currentLayer.length > 0 && layerIndex < maxSafeDepth) {
    const nextLayer: string[] = [];
    currentLayer.forEach((u) => {
      (adj[u] || []).forEach((v) => {
        inDegreeWork[v] = (inDegreeWork[v] || 1) - 1;
        // 当入度降为 0 且尚未分配层级时，加入下一层
        if (inDegreeWork[v] <= 0 && rank[v] === undefined) {
          rank[v] = layerIndex + 1;
          nextLayer.push(v);
        }
      });
    });
    currentLayer = nextLayer;
    layerIndex++;
  }

  // 对处于环路中未被拓扑遍历到的剩余节点，平滑分派到后置层，保证 100% 覆盖
  let unassignedCount = 0;
  internalNodes.forEach((n) => {
    if (rank[n.id] === undefined) {
      rank[n.id] = layerIndex + Math.floor(unassignedCount / 10);
      unassignedCount++;
    }
  });

  // 4. 按层分组
  const layers: Record<number, CodeNode[]> = {};
  let maxRank = 0;
  internalNodes.forEach((n) => {
    const r = rank[n.id] || 0;
    if (r > maxRank) maxRank = r;
    if (!layers[r]) layers[r] = [];
    layers[r].push(n);
  });

  // 5. 排布各层内部节点 (规避超高纵向堆叠，每层超过 10 个时自动双列折叠)
  Object.keys(layers).forEach((rKey) => {
    const r = Number(rKey);
    const nodesInLayer = layers[r] || [];
    nodesInLayer.sort((a, b) => a.name.localeCompare(b.name));

    const maxPerCol = 10;
    nodesInLayer.forEach((n, idx) => {
      const colOffset = Math.floor(idx / maxPerCol);
      const rowIdx = idx % maxPerCol;
      positions[n.id] = {
        x: 300 + (r * 320) + (colOffset * 250),
        y: 80 + rowIdx * 115,
      };
    });
  });

  // 6. Out-Ports 固定排布在最右列
  const rightX = 350 + (maxRank + 2) * 320;
  module.outPorts.forEach((port, idx) => {
    positions[`outport_${port}`] = { x: Math.max(rightX, 800), y: 100 + idx * 75 };
  });

  return positions;
}

// 模块级下钻内存缓存 (避免切出切进重新耗时排版)
const moduleLayoutMemoryCache = new Map<string, { positions: Record<string, { x: number; y: number }>; portEdges: Array<{ source: string; target: string }> }>();

export const DrillDownCanvas: React.FC<DrillDownCanvasProps> = ({
  module,
  allNodes,
  allEdges,
  onSelectNode,
  onBackToArchitecture,
}) => {
  const { isDark } = useTheme();
  const nodeTypes = useMemo(
    () => ({
      internalSymbol: InternalSymbolNode,
      inPort: InPortNode,
      outPort: OutPortNode,
    }),
    []
  );

  const [rfInstance, setRfInstance] = useState<ReactFlowInstance | null>(null);
  const [nodes, setNodes, onNodesChange] = useNodesState<any>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<any>([]);

  // 连线与理线控制状态
  const [routingMode, setRoutingMode] = useState<'smoothstep' | 'bezier'>('smoothstep');
  const [filterCallsOnly, setFilterCallsOnly] = useState<boolean>(false);
  const [hoveredNodeId, setHoveredNodeId] = useState<string | null>(null);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [isUntangling, setIsUntangling] = useState<boolean>(false);
  const [nodePositions, setNodePositions] = useState<Record<string, { x: number; y: number }>>({});
  const [serverPortEdges, setServerPortEdges] = useState<Array<{ source: string; target: string }>>([]);

  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    title?: string;
    items: ContextMenuItem[];
  } | null>(null);

  const moduleFiles = useMemo(() => new Set(module.files), [module.files]);
  const internalNodes = useMemo(
    () =>
      Object.values(allNodes).filter(
        (n) => moduleFiles.has(n.filePath) && n.entityType !== 'FILE'
      ),
    [allNodes, moduleFiles]
  );
  const internalNodeIds = useMemo(() => new Set(internalNodes.map((n) => n.id)), [internalNodes]);

  // 计算端口关联边 (In-Ports 打入入口，内部符号打出 Out-Ports)
  const resolvedPortEdges = useMemo(() => {
    if (serverPortEdges.length > 0) {
      return serverPortEdges;
    }
    const list: Array<{ source: string; target: string }> = [];

    // 1. In-Ports -> 内部目标符号
    module.inPorts.forEach((port) => {
      const inPortId = `inport_${port}`;
      const matched = internalNodes.filter((n) => n.name === port || n.id === port);
      if (matched.length > 0) {
        matched.forEach((m) => list.push({ source: inPortId, target: m.id }));
      } else {
        const incoming = allEdges.filter(
          (e) => internalNodeIds.has(e.target) && !internalNodeIds.has(e.source)
        );
        if (incoming.length > 0) {
          list.push({ source: inPortId, target: incoming[0].target });
        }
      }
    });

    // 2. 内部符号 -> Out-Ports 外部调用
    module.outPorts.forEach((port) => {
      const outPortId = `outport_${port}`;
      const outgoing = allEdges.filter(
        (e) =>
          internalNodeIds.has(e.source) &&
          (allNodes[e.target]?.name === port || e.target.endsWith(port))
      );
      if (outgoing.length > 0) {
        outgoing.forEach((og) => list.push({ source: og.source, target: outPortId }));
      }
    });

    return list;
  }, [module.inPorts, module.outPorts, internalNodes, internalNodeIds, allEdges, allNodes, serverPortEdges]);

  // 执行自动理线与最优分层布局 (附带本地内存缓存与性能降级)
  const performUntangleLayout = useCallback(
    async (showFeedback = true, forceRefresh = false) => {
      // 0. 优先检测客户端内存缓存
      if (!forceRefresh && moduleLayoutMemoryCache.has(module.id)) {
        const cached = moduleLayoutMemoryCache.get(module.id)!;
        setNodePositions(cached.positions);
        if (cached.portEdges) setServerPortEdges(cached.portEdges);
        setTimeout(() => rfInstance?.fitView({ duration: 300 }), 30);
        return;
      }

      setIsUntangling(true);

      // 若卡片较多 (> 60 节点)，先行极速应用客户端拓扑排版，实现 0 延迟首帧展示
      if (internalNodes.length > 60) {
        const quickPos = calculateClientTopologicalLayout(module, internalNodes, allEdges);
        setNodePositions(quickPos);
        setTimeout(() => rfInstance?.fitView({ duration: 300 }), 20);
      }

      try {
        const res = await fetch('/api/layout-drilldown', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ moduleId: module.id, forceRefresh }),
        });
        const data = await res.json();
        if (data.success && data.layout?.nodes) {
          const posMap: Record<string, { x: number; y: number }> = {};
          data.layout.nodes.forEach((n: any) => {
            posMap[n.id] = { x: n.x, y: n.y };
          });
          setNodePositions(posMap);
          const portEdges = data.portEdges || [];
          setServerPortEdges(portEdges);
          moduleLayoutMemoryCache.set(module.id, { positions: posMap, portEdges });

          if (showFeedback) showToast('✓ 已使用 ELK Sugiyama 正交分层完成智能理线');
          setTimeout(() => rfInstance?.fitView({ duration: 400 }), 50);
          return;
        }
      } catch {
        // 服务端不可达时平滑降级
      } finally {
        setIsUntangling(false);
      }

      const clientPos = calculateClientTopologicalLayout(module, internalNodes, allEdges);
      setNodePositions(clientPos);
      moduleLayoutMemoryCache.set(module.id, { positions: clientPos, portEdges: [] });
      if (showFeedback) showToast('✓ 已完成客户端拓扑分层理线');
      setTimeout(() => rfInstance?.fitView({ duration: 400 }), 50);
    },
    [module, internalNodes, allEdges, rfInstance]
  );

  // 初始化加载自动理线
  useEffect(() => {
    performUntangleLayout(false, false);
  }, [module.id]);

  // 基础原始边集合 (不受 hover 抖动影响)
  const rawEdges = useMemo(() => {
    const list: any[] = [];
    allEdges.forEach((e, idx) => {
      if (internalNodeIds.has(e.source) && internalNodeIds.has(e.target)) {
        if (filterCallsOnly && e.relation !== 'CALLS' && e.relation !== 'CALLS_CONTRACT' && e.relation !== 'HANDLED_BY') {
          return;
        }
        list.push({
          id: `drill_e_${idx}`,
          source: e.source,
          target: e.target,
          relation: e.relation,
          isPortEdge: false,
        });
      }
    });

    resolvedPortEdges.forEach((pe, idx) => {
      list.push({
        id: `drill_port_e_${idx}`,
        source: pe.source,
        target: pe.target,
        relation: 'CALLS',
        isPortEdge: true,
      });
    });

    return list;
  }, [allEdges, internalNodeIds, filterCallsOnly, resolvedPortEdges]);

  // 1. 同步节点：仅在模块、位置或点击聚焦发生变化时更新，悬浮(hover)绝不重建节点！
  useEffect(() => {
    const reactNodes: any[] = [];

    // 计算点击聚焦所关联的节点
    const connectedNodeIds = new Set<string>();
    if (selectedNodeId) {
      connectedNodeIds.add(selectedNodeId);
      rawEdges.forEach((e) => {
        if (e.source === selectedNodeId || e.target === selectedNodeId) {
          connectedNodeIds.add(e.source);
          connectedNodeIds.add(e.target);
        }
      });
    }

    // In-Ports
    module.inPorts.forEach((port, idx) => {
      const id = `inport_${port}`;
      const pos = nodePositions[id] || { x: 50, y: 100 + idx * 75 };
      const isFocused = selectedNodeId === id;
      const isConnected = Boolean(selectedNodeId && connectedNodeIds.has(id));
      const isDimmed = Boolean(selectedNodeId && !connectedNodeIds.has(id));

      reactNodes.push({
        id,
        type: 'inPort',
        position: pos,
        data: { name: port, portType: 'IN', isFocused, isConnected, isDimmed },
      });
    });

    // Internal symbols
    internalNodes.forEach((n, idx) => {
      const pos = nodePositions[n.id] || { x: 300 + (idx % 4) * 280, y: 80 + Math.floor(idx / 4) * 110 };
      const isFocused = selectedNodeId === n.id;
      const isConnected = Boolean(selectedNodeId && connectedNodeIds.has(n.id));
      const isDimmed = Boolean(selectedNodeId && !connectedNodeIds.has(n.id));

      reactNodes.push({
        id: n.id,
        type: 'internalSymbol',
        position: pos,
        data: { node: n, onSelectNode, isFocused, isConnected, isDimmed },
      });
    });

    // Out-Ports
    module.outPorts.forEach((port, idx) => {
      const id = `outport_${port}`;
      const pos = nodePositions[id] || { x: 900, y: 100 + idx * 75 };
      const isFocused = selectedNodeId === id;
      const isConnected = Boolean(selectedNodeId && connectedNodeIds.has(id));
      const isDimmed = Boolean(selectedNodeId && !connectedNodeIds.has(id));

      reactNodes.push({
        id,
        type: 'outPort',
        position: pos,
        data: { name: port, portType: 'OUT', isFocused, isConnected, isDimmed },
      });
    });

    setNodes(reactNodes);
  }, [module, internalNodes, nodePositions, selectedNodeId, rawEdges, onSelectNode, setNodes]);

  // 2. 同步边：轻量更新边的状态与样式，支持 hover 与 click 聚焦点无闪烁渲染
  const focusedNodeId = selectedNodeId || hoveredNodeId;

  useEffect(() => {
    const connectedEdgeIds = new Set<string>();
    if (focusedNodeId) {
      rawEdges.forEach((e) => {
        if (e.source === focusedNodeId || e.target === focusedNodeId) {
          connectedEdgeIds.add(e.id);
        }
      });
    }

    const reactEdges = rawEdges.map((e) => {
      const isConnected = focusedNodeId ? connectedEdgeIds.has(e.id) : true;
      const isOutgoing = focusedNodeId && e.source === focusedNodeId;
      const isIncoming = focusedNodeId && e.target === focusedNodeId;

      let strokeColor = isDark ? 'rgba(148, 163, 184, 0.45)' : 'rgba(100, 116, 139, 0.45)';
      if (e.isPortEdge) {
        strokeColor = isDark ? '#818cf8' : '#6366f1';
      }

      if (focusedNodeId) {
        if (isOutgoing) {
          strokeColor = '#3b82f6'; // 出站: 天蓝
        } else if (isIncoming) {
          strokeColor = '#10b981'; // 入站: 翠绿
        } else {
          strokeColor = isDark ? 'rgba(255, 255, 255, 0.05)' : 'rgba(0, 0, 0, 0.05)';
        }
      }

      return {
        id: e.id,
        source: e.source,
        target: e.target,
        type: routingMode === 'smoothstep' ? 'smoothstep' : 'default',
        pathOptions: routingMode === 'smoothstep' ? { borderRadius: 16 } : undefined,
        animated: Boolean(focusedNodeId && isConnected),
        zIndex: focusedNodeId ? (isConnected ? 20 : 1) : 5,
        style: {
          stroke: strokeColor,
          strokeWidth: focusedNodeId ? (isConnected ? 2.5 : 1) : e.isPortEdge ? 1.6 : 1.4,
          opacity: focusedNodeId ? (isConnected ? 1 : 0.08) : 0.75,
          strokeDasharray: e.isPortEdge && !focusedNodeId ? '4 4' : undefined,
          transition: 'stroke 0.15s ease, opacity 0.15s ease, stroke-width 0.15s ease',
        },
      };
    });

    setEdges(reactEdges);
  }, [rawEdges, focusedNodeId, routingMode, isDark, setEdges]);

  // 节点右键处理
  const handleNodeContextMenu = useCallback(
    (event: React.MouseEvent | MouseEvent, node: Node) => {
      event.preventDefault();

      if (node.type === 'internalSymbol') {
        const codeNode = node.data.node as CodeNode;
        const items: ContextMenuItem[] = [
          {
            label: '添加符号定义到聊天框',
            icon: <MessageSquarePlus className="w-3.5 h-3.5 text-dsh-blue" />,
            onClick: () => {
              const text = `@${codeNode.filePath}:${codeNode.loc.startLine} (${codeNode.entityType}: ${codeNode.name})`;
              insertIntoChat(text, { title: `符号: ${codeNode.name}` });
            },
          },
          {
            label: '让 AI 解释与优化此实现',
            icon: <Bot className="w-3.5 h-3.5 text-purple-400" />,
            onClick: () => {
              const text = `请查看文件 \`${codeNode.filePath}\` 第 ${codeNode.loc.startLine} 行的【${codeNode.name}】(${codeNode.entityType})，帮我深入解释其实现逻辑并给出重构与性能优化建议。完整限定名: \`${codeNode.qualifiedName}\``;
              insertIntoChat(text, { title: `优化符号: ${codeNode.name}` });
            },
          },
          {
            label: '交互透视与说明 (0-Token)',
            icon: <BookOpen className="w-3.5 h-3.5 text-dsh-blue" />,
            onClick: () => onSelectNode(codeNode.id, codeNode.filePath, codeNode.loc.startLine),
          },
          {
            label: '抽屉查看源码',
            icon: <FileCode className="w-3.5 h-3.5 text-dsh-secondary" />,
            divider: true,
            onClick: () => onSelectNode(codeNode.id, codeNode.filePath, codeNode.loc.startLine),
          },
          {
            label: '锁定高亮此节点关联',
            icon: <Sparkles className="w-3.5 h-3.5 text-amber-400" />,
            onClick: () => setSelectedNodeId(codeNode.id),
          },
          {
            label: '复制完整限定名 (Qualified Name)',
            icon: <Copy className="w-3.5 h-3.5 text-dsh-tertiary" />,
            onClick: () => copyToClipboard(codeNode.qualifiedName, '符号限定名'),
          },
          {
            label: '复制路径与行号 (file:line)',
            icon: <Copy className="w-3.5 h-3.5 text-dsh-tertiary" />,
            onClick: () => copyToClipboard(`${codeNode.filePath}:${codeNode.loc.startLine}`, '路径与行号'),
          },
        ];

        setContextMenu({
          x: event.clientX,
          y: event.clientY,
          title: `符号: ${codeNode.name}`,
          items,
        });
        return;
      }

      if (node.type === 'inPort' || node.type === 'outPort') {
        const portName = node.data.name as string;
        const portType = node.data.portType as string;
        const items: ContextMenuItem[] = [
          {
            label: '添加端口接口信息到聊天框',
            icon: <MessageSquarePlus className="w-3.5 h-3.5 text-dsh-blue" />,
            onClick: () => {
              const text = `[模块接口: ${portType === 'IN' ? '输入端' : '输出依赖'}] \`${portName}\` (所属模块: **${module.name}**)`;
              insertIntoChat(text, { title: `端口: ${portName}` });
            },
          },
          {
            label: '锁定高亮此端口连线',
            icon: <Sparkles className="w-3.5 h-3.5 text-amber-400" />,
            onClick: () => setSelectedNodeId(node.id),
          },
          {
            label: '复制端口标识',
            icon: <Copy className="w-3.5 h-3.5 text-dsh-tertiary" />,
            onClick: () => copyToClipboard(portName, '端口标识'),
          },
        ];

        setContextMenu({
          x: event.clientX,
          y: event.clientY,
          title: `端口: ${portName}`,
          items,
        });
      }
    },
    [module.name, onSelectNode]
  );

  // 空白处右键处理
  const handlePaneContextMenu = useCallback(
    (event: React.MouseEvent | MouseEvent) => {
      event.preventDefault();

      const items: ContextMenuItem[] = [
        {
          label: `发送【${module.name}】内部结构到聊天框`,
          icon: <MessageSquarePlus className="w-3.5 h-3.5 text-dsh-blue" />,
          onClick: () => {
            const files = module.files.map((f) => `- \`${f}\``).join('\n');
            const text = `[模块下钻架构: ${module.name}]\n包含 ${module.files.length} 个文件，${module.inPorts.length} 个外部调用入口，${module.outPorts.length} 个外部依赖端口。\n文件清单：\n${files}`;
            insertIntoChat(text, { title: `模块内部结构: ${module.name}` });
          },
        },
        {
          label: '一键自动理线 (强制重新排版)',
          icon: <Wand2 className="w-3.5 h-3.5 text-dsh-blue" />,
          onClick: () => performUntangleLayout(true, true),
        },
        {
          label: '返回宏观架构',
          icon: <ArrowLeft className="w-3.5 h-3.5 text-dsh-secondary" />,
          divider: true,
          onClick: onBackToArchitecture,
        },
        {
          label: '适屏居中 (Fit View)',
          icon: <Maximize2 className="w-3.5 h-3.5 text-dsh-secondary" />,
          onClick: () => rfInstance?.fitView({ duration: 300 }),
        },
      ];

      setContextMenu({
        x: event.clientX,
        y: event.clientY,
        title: '模块选项',
        items,
      });
    },
    [module, performUntangleLayout, onBackToArchitecture, rfInstance]
  );

  return (
    <div className="relative w-full h-[calc(100vh-56px)] bg-dsh-base">
      {/* 顶部面包屑快速返回条 */}
      <div className="absolute top-3.5 left-3.5 z-10 flex items-center gap-2 px-3 py-1.5 rounded-lg bg-dsh-layer1/95 border border-dsh-border2 shadow-md text-[13px]">
        <button
          onClick={onBackToArchitecture}
          className="text-dsh-blue hover:text-dsh-blue-hover font-medium flex items-center gap-1.5 transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          <span>返回宏观架构</span>
        </button>
        <span className="text-dsh-border3">/</span>
        <span className="text-dsh-primary font-semibold">{module.name}</span>
        <span className="text-[12px] text-dsh-tertiary">({module.files.length} 个源码文件)</span>
      </div>

      {/* 顶部右侧理线控制工具栏 (固定布局，避免因提示变化跳动) */}
      <div className="absolute top-3.5 right-3.5 z-10 flex items-center gap-2 p-1.5 rounded-lg bg-dsh-layer1/95 backdrop-blur border border-dsh-border2 shadow-md text-[13px]">
        {/* 一键理线按钮 */}
        <button
          onClick={() => performUntangleLayout(true, true)}
          disabled={isUntangling}
          title="使用 ELK Sugiyama 分层正交算法重新排版并规避连线交叉"
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-dsh-blue text-white hover:bg-dsh-blue-hover active:scale-95 transition-all font-medium disabled:opacity-50"
        >
          <Wand2 className={`w-4 h-4 ${isUntangling ? 'animate-spin' : ''}`} />
          <span>{isUntangling ? '理线中...' : '一键理线'}</span>
        </button>

        {/* 平滑正交 / 优雅曲线 切换 */}
        <button
          onClick={() => setRoutingMode((prev) => (prev === 'smoothstep' ? 'bezier' : 'smoothstep'))}
          title={routingMode === 'smoothstep' ? '切换为贝塞尔优雅曲线' : '切换为平滑正交折线 (规避斜切交叉)'}
          className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md hover:bg-dsh-layer2 text-dsh-secondary hover:text-dsh-primary border border-dsh-border1 transition-colors"
        >
          {routingMode === 'smoothstep' ? (
            <>
              <GitFork className="w-4 h-4 text-dsh-blue" />
              <span>正交折线</span>
            </>
          ) : (
            <>
              <Route className="w-4 h-4 text-purple-400" />
              <span>贝塞尔曲线</span>
            </>
          )}
        </button>

        {/* 核心调用 / 全部连线 过滤 */}
        <button
          onClick={() => setFilterCallsOnly((prev) => !prev)}
          title={filterCallsOnly ? '显示全部连线 (包含导入和结构依赖)' : '降噪：仅显示核心函数调用 (隐藏导入边)'}
          className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-md border transition-colors ${
            filterCallsOnly
              ? 'bg-amber-500/10 text-amber-400 border-amber-500/30'
              : 'hover:bg-dsh-layer2 text-dsh-secondary hover:text-dsh-primary border-dsh-border1'
          }`}
        >
          <Filter className="w-4 h-4" />
          <span>{filterCallsOnly ? '仅核心调用' : '全部连线'}</span>
        </button>

        {/* 锁定聚焦解除提示 */}
        {selectedNodeId && (
          <button
            onClick={() => {
              setSelectedNodeId(null);
              setHoveredNodeId(null);
            }}
            title="点击退出锁定聚焦模式"
            className="flex items-center gap-1 px-2 py-1 rounded bg-indigo-500/15 text-indigo-300 border border-indigo-500/30 hover:bg-indigo-500/25 transition-all text-[12px]"
          >
            <Sparkles className="w-3.5 h-3.5 text-indigo-400" />
            <span>已聚焦</span>
            <span className="opacity-70 ml-0.5">✕</span>
          </button>
        )}
      </div>

      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        nodeTypes={nodeTypes}
        onInit={setRfInstance}
        onNodeMouseEnter={(_, node) => {
          if (!selectedNodeId) {
            setHoveredNodeId(node.id);
          }
        }}
        onNodeMouseLeave={() => {
          if (!selectedNodeId) {
            setHoveredNodeId(null);
          }
        }}
        onNodeClick={(_, node) => setSelectedNodeId((prev) => (prev === node.id ? null : node.id))}
        onPaneClick={() => {
          setSelectedNodeId(null);
          setHoveredNodeId(null);
        }}
        onNodeContextMenu={handleNodeContextMenu}
        onPaneContextMenu={handlePaneContextMenu}
        fitView
        minZoom={0.3}
        maxZoom={2.0}
      >
        <Background color={isDark ? 'rgba(255, 255, 255, 0.08)' : 'rgba(0, 0, 0, 0.08)'} gap={24} size={1} />
        <Controls />
        <MiniMap
          nodeColor="#4176e6"
          maskColor={isDark ? 'rgba(21, 21, 23, 0.85)' : 'rgba(240, 242, 245, 0.85)'}
          className="bg-dsh-platform border border-dsh-border2 rounded-md"
        />
      </ReactFlow>

      {/* 右键菜单 */}
      {contextMenu && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          title={contextMenu.title}
          items={contextMenu.items}
          onClose={() => setContextMenu(null)}
        />
      )}
    </div>
  );
};
