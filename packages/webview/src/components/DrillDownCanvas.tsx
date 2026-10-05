import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
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
  workspaceRoot?: string;
  allNodes: Record<string, CodeNode>;
  allEdges: CodeEdge[];
  onSelectNode: (nodeId: string, filePath: string, line: number) => void;
  onBackToArchitecture: () => void;
}

// 模块内部符号节点 (支持视口自适应 LOD 色块分级渲染与 React.memo 记忆化)
const InternalSymbolNode = React.memo(({ data }: NodeProps) => {
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
      className={`node-compact-card w-[220px] h-[85px] box-border bg-dsh-layer1 border ${
        isFocused
          ? 'border-dsh-blue node-focused'
          : isConnected
          ? 'border-dsh-blue/70 node-connected'
          : isContract
          ? 'border-indigo-500/50 hover:border-indigo-400 shadow-indigo-950/20'
          : 'border-dsh-border2 hover:border-dsh-blue'
      } rounded-md shadow p-2.5 cursor-grab active:cursor-grabbing group transition-all select-none flex flex-col justify-between overflow-hidden`}
    >
      <Handle type="target" position={Position.Left} />
      <Handle type="source" position={Position.Right} />

      {/* 1. 全量精细模式 (默认正常缩放，或在卡片被选中/直连时强制保持) */}
      <div className="node-full-detail flex-1 flex flex-col justify-between">
        <div className="flex items-center justify-between mb-1">
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

      {/* 2. LOD 极简同色色块模式 (在视口缩小且非选中时激活，外框不消失，文字图标转为同色几何色块) */}
      <div className="node-skeleton-detail flex-1 flex flex-col justify-between py-1">
        <div className="flex items-center justify-between">
          <div
            className={`h-3 w-16 rounded ${
              isContract
                ? 'node-skeleton-badge-contract'
                : isClass
                ? 'node-skeleton-badge-class'
                : 'node-skeleton-badge-func'
            }`}
          />
          <div className="h-2.5 w-8 rounded node-skeleton-meta" />
        </div>
        <div className="flex items-center gap-2 my-1">
          <div
            className={`w-4 h-4 rounded shrink-0 ${
              isContract
                ? 'node-skeleton-badge-contract'
                : isClass
                ? 'node-skeleton-badge-class'
                : 'node-skeleton-badge-func'
            }`}
          />
          <div className="h-3.5 w-32 rounded node-skeleton-title" />
        </div>
        <div className="h-2.5 w-24 rounded node-skeleton-sub mt-0.5 border-t border-dsh-border1/40 pt-1" />
      </div>
    </div>
  );
});

// In-Port 端口卡片 (支持 LOD 色块与 React.memo)
const InPortNode = React.memo(({ data }: NodeProps) => {
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
      className={`node-compact-card w-[170px] h-[52px] box-border bg-dsh-green-tint border ${
        isFocused
          ? 'border-emerald-500 node-focused'
          : isConnected
          ? 'border-emerald-500/80 node-connected'
          : 'border-dsh-green-border'
      } rounded-md p-2 shadow flex items-center justify-between select-none cursor-grab active:cursor-grabbing overflow-hidden`}
    >
      <Handle type="source" position={Position.Right} />

      {/* 精细全量详情 */}
      <div className="node-full-detail w-full flex items-center gap-2">
        <ArrowLeftCircle className="w-3.5 h-3.5 text-dsh-green shrink-0" />
        <div className="truncate flex-1">
          <div className="text-[9px] text-dsh-green font-bold uppercase tracking-tight">📥 IN-PORT</div>
          <div className="text-[11px] font-mono text-dsh-primary truncate" title={name}>
            {name}
          </div>
        </div>
      </div>

      {/* LOD 极简色块 */}
      <div className="node-skeleton-detail w-full flex items-center gap-2">
        <div className="w-4 h-4 rounded-full node-skeleton-badge-inport shrink-0" />
        <div className="flex-1 space-y-1.5">
          <div className="w-14 h-2.5 rounded node-skeleton-badge-inport opacity-85" />
          <div className="w-24 h-3 rounded node-skeleton-title" />
        </div>
      </div>
    </div>
  );
});

// Out-Port 端口卡片 (支持 LOD 色块与 React.memo)
const OutPortNode = React.memo(({ data }: NodeProps) => {
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
      className={`node-compact-card w-[170px] h-[52px] box-border bg-dsh-blue-tint border ${
        isFocused
          ? 'border-blue-500 node-focused'
          : isConnected
          ? 'border-blue-500/80 node-connected'
          : 'border-dsh-blue-border'
      } rounded-md p-2 shadow flex items-center justify-between select-none cursor-grab active:cursor-grabbing overflow-hidden`}
    >
      <Handle type="target" position={Position.Left} />

      {/* 精细全量详情 */}
      <div className="node-full-detail w-full flex items-center justify-between">
        <div className="truncate flex-1">
          <div className="text-[9px] text-dsh-blue font-bold uppercase tracking-tight">📤 OUT-PORT</div>
          <div className="text-[11px] font-mono text-dsh-primary truncate" title={name}>
            {name}
          </div>
        </div>
        <ArrowRightCircle className="w-3.5 h-3.5 text-dsh-blue shrink-0 ml-1" />
      </div>

      {/* LOD 极简色块 */}
      <div className="node-skeleton-detail w-full flex items-center justify-between">
        <div className="flex-1 space-y-1.5">
          <div className="w-14 h-2.5 rounded node-skeleton-badge-outport opacity-85" />
          <div className="w-24 h-3 rounded node-skeleton-title" />
        </div>
        <div className="w-4 h-4 rounded-full node-skeleton-badge-outport shrink-0 ml-1" />
      </div>
    </div>
  );
});

/**
 * 客户端拓扑排版算法 (Kahn Topological DAG Layering + Barycenter Crossing Minimization)
 * 复杂度 O(V + E)，耗时 < 15ms，彻底杜绝环路依赖无限循环卡死！
 */
function calculateClientTopologicalLayout(
  module: ModuleContainer,
  internalNodes: CodeNode[],
  allEdges: CodeEdge[]
): Record<string, { x: number; y: number }> {
  const positions: Record<string, { x: number; y: number }> = {};
  if (internalNodes.length === 0) return positions;

  const internalIds = new Set(internalNodes.map((n) => n.id));

  // 1. In-Ports 固定排布在最左列 X=50
  module.inPorts.forEach((port, idx) => {
    positions[`inport_${port}`] = { x: 50, y: 80 + idx * 70 };
  });

  // 2. 构建内部有向图 (Adjacency & in-degrees，自动过滤自环)
  const adj: Record<string, string[]> = {};
  const revAdj: Record<string, string[]> = {};
  const inDegree: Record<string, number> = {};
  internalNodes.forEach((n) => {
    adj[n.id] = [];
    revAdj[n.id] = [];
    inDegree[n.id] = 0;
  });

  allEdges.forEach((e) => {
    if (internalIds.has(e.source) && internalIds.has(e.target) && e.source !== e.target) {
      adj[e.source]?.push(e.target);
      revAdj[e.target]?.push(e.source);
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
  const maxSafeDepth = Math.min(internalNodes.length, 30);

  while (currentLayer.length > 0 && layerIndex < maxSafeDepth) {
    const nextLayer: string[] = [];
    currentLayer.forEach((u) => {
      (adj[u] || []).forEach((v) => {
        inDegreeWork[v] = (inDegreeWork[v] || 1) - 1;
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
      rank[n.id] = layerIndex + Math.floor(unassignedCount / 8);
      unassignedCount++;
    }
  });

  // 4. 按层分组
  const layers: Record<number, CodeNode[]> = {};
  internalNodes.forEach((n) => {
    const r = rank[n.id] || 0;
    if (!layers[r]) layers[r] = [];
    layers[r].push(n);
  });

  const sortedLayerRanks = Object.keys(layers).map(Number).sort((a, b) => a - b);

  // 5. 跨层重心启发式排序 (Barycenter Crossing Minimization)
  const nodeYIndex = new Map<string, number>();
  sortedLayerRanks.forEach((r) => {
    layers[r].sort((a, b) => {
      const fComp = (a.filePath || '').localeCompare(b.filePath || '');
      if (fComp !== 0) return fComp;
      return a.name.localeCompare(b.name);
    });
    layers[r].forEach((n, idx) => nodeYIndex.set(n.id, idx));
  });

  for (let pass = 0; pass < 3; pass++) {
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

  // 6. 排布各层内部节点 (规避超高纵向堆叠，根据节点总数自适应列容量)
  const maxPerCol = internalNodes.length > 100 ? 16 : internalNodes.length > 30 ? 12 : 8;
  const CARD_WIDTH = 220;
  const CARD_HEIGHT = 85;
  const X_GAP = 60;
  const Y_GAP = 25;
  let currentLayerBaseX = 300;

  sortedLayerRanks.forEach((r) => {
    const nodesInLayer = layers[r] || [];
    const cols = Math.ceil(nodesInLayer.length / maxPerCol) || 1;

    nodesInLayer.forEach((n, idx) => {
      const colOffset = Math.floor(idx / maxPerCol);
      const rowIdx = idx % maxPerCol;
      positions[n.id] = {
        x: currentLayerBaseX + colOffset * (CARD_WIDTH + 35),
        y: 80 + rowIdx * (CARD_HEIGHT + Y_GAP),
      };
    });

    currentLayerBaseX += cols * (CARD_WIDTH + 35) + X_GAP;
  });

  // 7. Out-Ports 固定排布在最右列
  const rightX = Math.max(currentLayerBaseX, 850);
  module.outPorts.forEach((port, idx) => {
    positions[`outport_${port}`] = { x: rightX, y: 80 + idx * 70 };
  });

  return positions;
}

// 模块级下钻持久化缓存 (同时保障内存与 LocalStorage 双层存储)
interface PersistedDrillLayout {
  positions: Record<string, { x: number; y: number }>;
  portEdges: Array<{ source: string; target: string }>;
}

const moduleLayoutMemoryCache = new Map<string, PersistedDrillLayout>();

function getPersistedLayout(workspaceRoot: string | undefined, moduleId: string): PersistedDrillLayout | null {
  try {
    const key = `dsh_cg_drill_${workspaceRoot || 'default'}_${moduleId}`;
    const raw = localStorage.getItem(key);
    if (raw) {
      return JSON.parse(raw);
    }
  } catch (e) {
    console.warn('Failed to read drilldown layout from localStorage', e);
  }
  return null;
}

function savePersistedLayout(workspaceRoot: string | undefined, moduleId: string, data: PersistedDrillLayout) {
  try {
    const key = `dsh_cg_drill_${workspaceRoot || 'default'}_${moduleId}`;
    localStorage.setItem(key, JSON.stringify(data));
  } catch (e) {
    console.warn('Failed to save drilldown layout to localStorage', e);
  }
}

export const DrillDownCanvas: React.FC<DrillDownCanvasProps> = ({
  module,
  workspaceRoot,
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

  const rfInstanceRef = useRef<any>(null);
  const [rfInstance, setRfInstance] = useState<any>(null);
  const [nodes, setNodes, onNodesChange] = useNodesState<any>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<any>([]);

  // 连线与理线控制状态
  const [routingMode, setRoutingMode] = useState<'smoothstep' | 'bezier'>('smoothstep');
  const [filterCallsOnly, setFilterCallsOnly] = useState<boolean>(false);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [isUntangling, setIsUntangling] = useState<boolean>(false);

  // 视口自适应 LOD 细节分级状态：缩小视野下未选中卡片降级为同色色块，零重排零卡顿
  const [isLodCompact, setIsLodCompact] = useState<boolean>(false);
  const isLodCompactRef = useRef<boolean>(false);

  const handleMove = useCallback((_: any, viewport: { zoom: number }) => {
    const compact = viewport.zoom < 0.65;
    if (compact !== isLodCompactRef.current) {
      isLodCompactRef.current = compact;
      setIsLodCompact(compact);
    }
  }, []);

  // 首帧立即根据内存/LocalStorage/极速Kahn拓扑排版初始化坐标，杜绝首帧白屏与跳动
  const [nodePositions, setNodePositions] = useState<Record<string, { x: number; y: number }>>(() => {
    const mem = moduleLayoutMemoryCache.get(module.id);
    if (mem && Object.keys(mem.positions).length > 0) return mem.positions;
    const stored = getPersistedLayout(workspaceRoot, module.id);
    if (stored && stored.positions && Object.keys(stored.positions).length > 0) {
      moduleLayoutMemoryCache.set(module.id, stored);
      return stored.positions;
    }
    const moduleFiles = new Set(module.files);
    const iNodes = Object.values(allNodes).filter(
      (n) => moduleFiles.has(n.filePath) && n.entityType !== 'FILE'
    );
    return calculateClientTopologicalLayout(module, iNodes, allEdges);
  });
  const [serverPortEdges, setServerPortEdges] = useState<Array<{ source: string; target: string }>>(() => {
    const mem = moduleLayoutMemoryCache.get(module.id);
    if (mem?.portEdges) return mem.portEdges;
    const stored = getPersistedLayout(workspaceRoot, module.id);
    if (stored?.portEdges) return stored.portEdges;
    return [];
  });

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

  // 执行自动理线与最优分层布局 (支持双层持久化与自动适屏)
  const performUntangleLayout = useCallback(
    async (showFeedback = true, forceRefresh = false) => {
      // 0. 优先检测客户端内存缓存
      if (!forceRefresh && moduleLayoutMemoryCache.has(module.id)) {
        const cached = moduleLayoutMemoryCache.get(module.id)!;
        setNodePositions(cached.positions);
        if (cached.portEdges) setServerPortEdges(cached.portEdges);
        setTimeout(() => (rfInstanceRef.current || rfInstance)?.fitView({ padding: 0.15, duration: 250 }), 30);
        return;
      }

      // 0.1 优先检测本地持久化缓存 (LocalStorage)
      if (!forceRefresh) {
        const persisted = getPersistedLayout(workspaceRoot, module.id);
        if (persisted && persisted.positions && Object.keys(persisted.positions).length > 0) {
          setNodePositions(persisted.positions);
          if (persisted.portEdges) setServerPortEdges(persisted.portEdges);
          moduleLayoutMemoryCache.set(module.id, persisted);
          setTimeout(() => (rfInstanceRef.current || rfInstance)?.fitView({ padding: 0.15, duration: 250 }), 30);
          return;
        }
      }

      setIsUntangling(true);

      try {
        const res = await fetch('/api/layout-drilldown', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ moduleId: module.id, forceRefresh }),
        });
        const data = await res.json();
        if (data.success && data.layout?.nodes && (!data.layout.width || data.layout.width < 30000)) {
          const posMap: Record<string, { x: number; y: number }> = {};
          data.layout.nodes.forEach((n: any) => {
            posMap[n.id] = { x: n.x, y: n.y };
          });
          setNodePositions(posMap);
          const portEdges = data.portEdges || [];
          setServerPortEdges(portEdges);
          const layoutData: PersistedDrillLayout = { positions: posMap, portEdges };
          moduleLayoutMemoryCache.set(module.id, layoutData);
          savePersistedLayout(workspaceRoot, module.id, layoutData);

          if (showFeedback) showToast('✓ 已完成智能分层理线与连线交叉优化并自动保存');
          setTimeout(() => (rfInstanceRef.current || rfInstance)?.fitView({ padding: 0.15, duration: 350 }), 50);
          return;
        }
      } catch (err) {
        console.warn('服务端理线请求失败，采用客户端拓扑排版降级:', err);
      } finally {
        setIsUntangling(false);
      }

      const clientPos = calculateClientTopologicalLayout(module, internalNodes, allEdges);
      setNodePositions(clientPos);
      const clientData: PersistedDrillLayout = { positions: clientPos, portEdges: [] };
      moduleLayoutMemoryCache.set(module.id, clientData);
      savePersistedLayout(workspaceRoot, module.id, clientData);
      if (showFeedback) showToast('✓ 已完成智能分层理线与连线交叉优化并自动保存');
      setTimeout(() => (rfInstanceRef.current || rfInstance)?.fitView({ padding: 0.15, duration: 350 }), 50);
    },
    [module, workspaceRoot, internalNodes, allEdges, rfInstance]
  );

  // 模块切换或首次载入时，优先应用缓存或触发自动理线
  useEffect(() => {
    const mem = moduleLayoutMemoryCache.get(module.id);
    if (mem && Object.keys(mem.positions).length > 0) {
      setNodePositions(mem.positions);
      if (mem.portEdges) setServerPortEdges(mem.portEdges);
      setTimeout(() => (rfInstanceRef.current || rfInstance)?.fitView({ padding: 0.15, duration: 250 }), 40);
      return;
    }

    const stored = getPersistedLayout(workspaceRoot, module.id);
    if (stored && stored.positions && Object.keys(stored.positions).length > 0) {
      setNodePositions(stored.positions);
      if (stored.portEdges) setServerPortEdges(stored.portEdges);
      moduleLayoutMemoryCache.set(module.id, stored);
      setTimeout(() => (rfInstanceRef.current || rfInstance)?.fitView({ padding: 0.15, duration: 250 }), 40);
      return;
    }

    performUntangleLayout(false, false);
  }, [module.id, workspaceRoot, performUntangleLayout]);

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
        width: 170,
        height: 52,
        zIndex: isFocused ? 30 : isConnected ? 20 : 10,
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
        width: 220,
        height: 85,
        zIndex: isFocused ? 30 : isConnected ? 20 : 10,
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
        width: 170,
        height: 52,
        zIndex: isFocused ? 30 : isConnected ? 20 : 10,
        data: { name: port, portType: 'OUT', isFocused, isConnected, isDimmed },
      });
    });

    setNodes(reactNodes);
  }, [module, internalNodes, nodePositions, selectedNodeId, rawEdges, onSelectNode, setNodes]);

  // 2. 同步边：轻量更新边的状态与样式，仅在点击选中卡片时高亮并按需播放流动动画，未选中时全量静态化且沉底
  useEffect(() => {
    const connectedEdgeIds = new Set<string>();
    if (selectedNodeId) {
      rawEdges.forEach((e) => {
        if (e.source === selectedNodeId || e.target === selectedNodeId) {
          connectedEdgeIds.add(e.id);
        }
      });
    }

    const reactEdges = rawEdges.map((e) => {
      const isConnected = selectedNodeId ? connectedEdgeIds.has(e.id) : true;
      const isOutgoing = selectedNodeId && e.source === selectedNodeId;
      const isIncoming = selectedNodeId && e.target === selectedNodeId;

      // 默认常态：极细淡灰/淡紫，不透明度收敛至 0.32~0.35，沉于卡片最底层，绝不遮挡文字
      let strokeColor = isDark ? 'rgba(148, 163, 184, 0.32)' : 'rgba(100, 116, 139, 0.35)';
      if (e.isPortEdge) {
        strokeColor = isDark ? 'rgba(129, 140, 248, 0.45)' : 'rgba(99, 102, 241, 0.45)';
      }

      if (selectedNodeId) {
        if (isOutgoing) {
          strokeColor = '#3b82f6'; // 出站: 天蓝
        } else if (isIncoming) {
          strokeColor = '#10b981'; // 入站: 翠绿
        } else {
          strokeColor = isDark ? 'rgba(255, 255, 255, 0.04)' : 'rgba(0, 0, 0, 0.04)';
        }
      }

      return {
        id: e.id,
        source: e.source,
        target: e.target,
        type: routingMode === 'smoothstep' ? 'smoothstep' : 'default',
        pathOptions: routingMode === 'smoothstep' ? { borderRadius: 16 } : undefined,
        animated: Boolean(selectedNodeId && isConnected), // 仅在选中卡片后播放虚线流动动画！未选中时绝不播放
        zIndex: selectedNodeId ? (isConnected ? 5 : 0) : 0, // 连线层级永远在卡片(zIndex>=10)底层，彻底避免覆盖卡片内容
        style: {
          stroke: strokeColor,
          strokeWidth: selectedNodeId ? (isConnected ? 2.4 : 1) : 1.2,
          opacity: selectedNodeId ? (isConnected ? 1 : 0.05) : (isDark ? 0.35 : 0.38),
          vectorEffect: 'non-scaling-stroke',
        },
      };
    });

    setEdges(reactEdges);
  }, [rawEdges, selectedNodeId, routingMode, isDark, setEdges]);

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
    <div className={`relative w-full h-[calc(100vh-56px)] bg-dsh-base ${isLodCompact ? 'rf-lod-compact' : ''}`}>
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
        onInit={(instance) => {
          setRfInstance(instance);
          rfInstanceRef.current = instance;
          const initialCompact = instance.getZoom() < 0.65;
          isLodCompactRef.current = initialCompact;
          setIsLodCompact(initialCompact);
          setTimeout(() => {
            instance.fitView({ padding: 0.15, duration: 250 });
          }, 30);
        }}
        onMove={handleMove}
        onNodeClick={(_, node) => setSelectedNodeId((prev) => (prev === node.id ? null : node.id))}
        onPaneClick={() => setSelectedNodeId(null)}
        onNodeDragStop={(_, node) => {
          setNodePositions((prev) => {
            const updated = {
              ...prev,
              [node.id]: { x: Math.round(node.position.x), y: Math.round(node.position.y) },
            };
            const mem = moduleLayoutMemoryCache.get(module.id);
            const layoutData = { positions: updated, portEdges: mem?.portEdges || serverPortEdges };
            moduleLayoutMemoryCache.set(module.id, layoutData);
            savePersistedLayout(workspaceRoot, module.id, layoutData);
            return updated;
          });
        }}
        onNodeContextMenu={handleNodeContextMenu}
        onPaneContextMenu={handlePaneContextMenu}
        fitView
        fitViewOptions={{ padding: 0.15 }}
        nodeDragThreshold={2}
        elevateNodesOnSelect={true}
        minZoom={0.05}
        maxZoom={2.0}
      >
        <Background color={isDark ? 'rgba(255, 255, 255, 0.08)' : 'rgba(0, 0, 0, 0.08)'} gap={24} size={1} />
        <Controls />
        <MiniMap
          pannable={true}
          zoomable={true}
          onClick={(_, position) => {
            const inst = rfInstanceRef.current || rfInstance;
            if (inst) {
              inst.setCenter(position.x, position.y, { zoom: inst.getZoom(), duration: 250 });
            }
          }}
          nodeColor={(n) => {
            if (n.type === 'inPort') return '#10b981';
            if (n.type === 'outPort') return '#3b82f6';
            const node = (n.data as any)?.node;
            if (node?.entityType === 'CLASS') return '#f59e0b';
            if (node?.entityType === 'CONTRACT_ENDPOINT' || node?.entityType === 'CONTRACT_TOPIC') return '#818cf8';
            return '#3b82f6';
          }}
          maskColor={isDark ? 'rgba(21, 21, 23, 0.85)' : 'rgba(240, 242, 245, 0.85)'}
          className="bg-dsh-platform border border-dsh-border2 rounded-md shadow-lg cursor-grab active:cursor-grabbing"
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
