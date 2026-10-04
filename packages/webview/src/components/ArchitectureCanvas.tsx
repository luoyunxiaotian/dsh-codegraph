import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  Handle,
  Position,
  NodeProps,
  EdgeProps,
  BaseEdge,
  getBezierPath,
  getSmoothStepPath,
  EdgeLabelRenderer,
  useNodesState,
  useEdgesState,
  ReactFlowInstance,
  Node,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { ModuleContainer, ModuleBus } from '../../../core/src/types/index.js';
import { LayoutResult } from '../../../core/src/layout/elk-layout.js';
import {
  Box,
  FileCode,
  ArrowRightCircle,
  ArrowLeftCircle,
  MessageSquarePlus,
  Bot,
  Search,
  Copy,
  Maximize2,
  Globe,
  Wand2,
  GitFork,
  Route,
  Sparkles,
} from 'lucide-react';
import { ContextMenu, ContextMenuItem } from './ContextMenu.js';
import { insertIntoChat, copyToClipboard, showToast } from '../utils/chatBridge.js';
import { useTheme } from '../context/ThemeContext.js';

interface ArchitectureCanvasProps {
  modules: ModuleContainer[];
  buses: ModuleBus[];
  layout?: LayoutResult;
  onDrillDown: (moduleId: string) => void;
}

const ModuleCardNode = ({ data }: NodeProps) => {
  const mod = data.module as ModuleContainer;
  const onDrillDown = data.onDrillDown as (id: string) => void;
  const isFocused = Boolean(data.isFocused);
  const isConnected = Boolean(data.isConnected);
  const isDimmed = Boolean(data.isDimmed);
  const isContract = mod.id === 'mod_contracts' || mod.archetypeRole === 'Contract Hub';

  const getPlatformBadge = (p?: any) => {
    if (!p) return null;
    switch (p) {
      case 'MOBILE_ANDROID': return { label: '📱 Android', cls: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30' };
      case 'MOBILE_IOS': return { label: '🍏 iOS', cls: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30' };
      case 'DESKTOP_CPP': return { label: '💻 PC (C++)', cls: 'bg-sky-500/10 text-sky-400 border-sky-500/30' };
      case 'DESKTOP_PYTHON': return { label: '🐍 PC (Py)', cls: 'bg-amber-500/10 text-amber-400 border-amber-500/30' };
      case 'DESKTOP_ELECTRON': return { label: '⚡ PC (Electron)', cls: 'bg-cyan-500/10 text-cyan-400 border-cyan-500/30' };
      case 'WEB_FRONTEND': return { label: '🌐 Web', cls: 'bg-blue-500/10 text-blue-400 border-blue-500/30' };
      case 'BACKEND_SERVICE': return { label: '⚙️ 后端 API', cls: 'bg-indigo-500/10 text-indigo-400 border-indigo-500/30' };
      case 'TOOL_SCRIPT': return { label: '🔧 工具', cls: 'bg-zinc-500/10 text-zinc-400 border-zinc-500/30' };
      default: return null;
    }
  };

  const platformBadge = getPlatformBadge(mod.projectPlatform);

  return (
    <div
      onDoubleClick={() => onDrillDown(mod.id)}
      style={{
        opacity: isDimmed ? 0.35 : 1,
        transition: 'opacity 0.2s ease, box-shadow 0.2s ease',
        boxShadow: isFocused
          ? '0 0 0 2px #3b82f6, 0 8px 24px -2px rgba(59, 130, 246, 0.35)'
          : isConnected
          ? '0 0 0 1.5px rgba(59, 130, 246, 0.6), 0 4px 14px -2px rgba(59, 130, 246, 0.15)'
          : undefined,
      }}
      className={`w-[270px] bg-dsh-layer1 border ${
        isFocused
          ? 'border-dsh-blue'
          : isConnected
          ? 'border-dsh-blue/80'
          : isContract
          ? 'border-indigo-500/50 hover:border-indigo-400 shadow-indigo-950/20'
          : 'border-dsh-border2 hover:border-dsh-blue/80'
      } rounded-md shadow-lg p-3.5 transition-all cursor-grab active:cursor-grabbing group select-none`}
    >
      {/* 桩点 */}
      <Handle type="target" position={Position.Left} className="opacity-0" />
      <Handle type="source" position={Position.Right} className="opacity-0" />

      {/* 标题栏 */}
      <div className="flex items-center justify-between pb-2 mb-2.5 border-b border-dsh-border1">
        <div className="flex items-center gap-2 truncate">
          <div
            className={`w-5 h-5 rounded flex items-center justify-center shrink-0 ${
              isContract
                ? 'bg-indigo-500/10 border border-indigo-500/30 text-indigo-400'
                : 'bg-dsh-blue-tint border border-dsh-blue-border text-dsh-blue'
            }`}
          >
            {isContract ? <Globe className="w-3.5 h-3.5" /> : <Box className="w-3.5 h-3.5" />}
          </div>
          <span className="text-[13px] font-semibold text-dsh-primary truncate" title={mod.name}>
            {mod.name}
          </span>
        </div>
        <div className="flex items-center gap-1 shrink-0 ml-1">
          {platformBadge && (
            <span className={`text-[9px] px-1 py-0.2 rounded border font-medium ${platformBadge.cls}`}>
              {platformBadge.label}
            </span>
          )}
          <span
            className={`text-[10px] px-1.5 py-0.5 rounded font-mono border ${
              isContract
                ? 'bg-indigo-500/10 text-indigo-300 border-indigo-500/30'
                : 'bg-dsh-layer2 text-dsh-secondary border-dsh-border2'
            }`}
          >
            {isContract ? '契约中枢' : `${mod.files.length} 文件`}
          </span>
        </div>
      </div>

      {/* 模块交互职责人话简述 */}
      {(mod as any).story?.purposeDescription && (
        <div
          className="text-[11px] text-dsh-secondary bg-dsh-base/60 p-2 rounded border border-dsh-border1/60 mb-2.5 leading-relaxed"
          title={(mod as any).story.purposeDescription}
        >
          {(mod as any).story.purposeDescription}
        </div>
      )}

      {/* 文件列表摘要 */}
      <div className="space-y-1 mb-2.5">
        {mod.files.slice(0, 3).map((f, i) => (
          <div key={i} className="flex items-center gap-1.5 text-[11px] text-dsh-tertiary truncate">
            <FileCode className="w-3.5 h-3.5 text-dsh-dimmed shrink-0" />
            <span className="truncate font-mono">{f.split(/[/\\]/).pop()}</span>
          </div>
        ))}
        {mod.files.length > 3 && (
          <div className="text-[10px] text-dsh-dimmed pl-4">
            + 另有 {mod.files.length - 3} 个文件...
          </div>
        )}
      </div>

      {/* 端口与交互总线摘要 */}
      <div className="pt-2 border-t border-dsh-border1 flex items-center justify-between text-[11px]">
        <span className="flex items-center gap-1 text-dsh-green" title={mod.inPorts.join(', ')}>
          <ArrowLeftCircle className="w-3.5 h-3.5" />
          <span>{mod.inPorts.length} In-Ports</span>
        </span>
        <span className="flex items-center gap-1 text-dsh-blue" title={mod.outPorts.join(', ')}>
          <span>{mod.outPorts.length} Out-Ports</span>
          <ArrowRightCircle className="w-3.5 h-3.5" />
        </span>
      </div>

      {/* 下钻与右键提示 */}
      <div className="mt-2 text-[10px] text-center text-dsh-dimmed group-hover:text-dsh-blue transition-colors flex items-center justify-center gap-2">
        <span>双击下钻</span>
        <span>·</span>
        <span>右键选项</span>
      </div>
    </div>
  );
};

// DeepSeek Harness 风格总线边
const BusEdge = ({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  data,
  style,
}: EdgeProps) => {
  const isSmooth = (data as any)?.routingMode === 'smoothstep';
  const pathFn = isSmooth ? getSmoothStepPath : getBezierPath;
  const [edgePath, labelX, labelY] = pathFn({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
    borderRadius: 16,
  } as any);

  const callCount = (data as any)?.callCount || 1;
  const isDimmed = Boolean((data as any)?.isDimmed);
  const isFocused = Boolean((data as any)?.isFocused);

  return (
    <>
      <BaseEdge id={id} path={edgePath} style={style} />
      {!isDimmed && (
        <EdgeLabelRenderer>
          <div
            style={{
              position: 'absolute',
              transform: `translate(-50%, -50%) translate(${labelX}px,${labelY}px)`,
              pointerEvents: 'all',
            }}
            className={`px-2 py-0.5 rounded-full ${
              isFocused
                ? 'bg-dsh-blue text-white shadow-md shadow-blue-500/30 border border-blue-400 font-bold'
                : 'bg-dsh-layer2 border border-dsh-border3 text-dsh-secondary shadow'
            } text-[11px] font-mono hover:border-dsh-blue transition-all cursor-default select-none`}
            title={`${callCount} 组跨模块调用 / 导入关联`}
          >
            {callCount} {callCount > 1 ? 'links' : 'link'}
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
};

export const ArchitectureCanvas: React.FC<ArchitectureCanvasProps> = ({
  modules,
  buses,
  layout,
  onDrillDown,
}) => {
  const { isDark } = useTheme();
  const nodeTypes = useMemo(() => ({ moduleCard: ModuleCardNode }), []);
  const edgeTypes = useMemo(() => ({ busEdge: BusEdge }), []);

  const [rfInstance, setRfInstance] = useState<ReactFlowInstance | null>(null);

  const [nodes, setNodes, onNodesChange] = useNodesState<any>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<any>([]);

  // 连线与聚焦点控制
  const [routingMode, setRoutingMode] = useState<'smoothstep' | 'bezier'>('smoothstep');
  const [hoveredModuleId, setHoveredModuleId] = useState<string | null>(null);
  const [selectedModuleId, setSelectedModuleId] = useState<string | null>(null);
  const [isUntangling, setIsUntangling] = useState<boolean>(false);
  const [currentLayout, setCurrentLayout] = useState<LayoutResult | undefined>(layout);

  useEffect(() => {
    setCurrentLayout(layout);
  }, [layout]);

  const focusedModuleId = selectedModuleId || hoveredModuleId;

  // 2. 右键菜单状态
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    title?: string;
    items: ContextMenuItem[];
  } | null>(null);

  // 1. 同步节点：仅在模块、布局或点击选中变更时更新，悬浮(hover)绝不重建节点！
  useEffect(() => {
    const connectedModIds = new Set<string>();
    if (selectedModuleId) {
      connectedModIds.add(selectedModuleId);
      buses.forEach((b) => {
        if (b.sourceModule === selectedModuleId || b.targetModule === selectedModuleId) {
          connectedModIds.add(b.sourceModule);
          connectedModIds.add(b.targetModule);
        }
      });
    }

    const computedNodes = modules.map((m) => {
      const layoutPos = currentLayout?.nodes.find((n) => n.id === m.id);
      const isFocused = selectedModuleId === m.id;
      const isConnected = Boolean(selectedModuleId && connectedModIds.has(m.id));
      const isDimmed = Boolean(selectedModuleId && !connectedModIds.has(m.id));

      return {
        id: m.id,
        type: 'moduleCard',
        position: {
          x: layoutPos ? layoutPos.x : 100,
          y: layoutPos ? layoutPos.y : 100,
        },
        data: {
          module: m,
          onDrillDown,
          isFocused,
          isConnected,
          isDimmed,
        },
      };
    });

    setNodes(computedNodes);
  }, [modules, currentLayout, selectedModuleId, buses, onDrillDown, setNodes]);

  // 2. 同步边：轻量更新边的状态与样式，支持 hover/click 聚焦点无闪烁渲染
  useEffect(() => {
    const connectedBusIds = new Set<string>();
    if (focusedModuleId) {
      buses.forEach((b) => {
        if (b.sourceModule === focusedModuleId || b.targetModule === focusedModuleId) {
          connectedBusIds.add(b.id);
        }
      });
    }

    const computedEdges = buses.map((b) => {
      const isConnected = focusedModuleId ? connectedBusIds.has(b.id) : true;
      const isOutgoing = focusedModuleId && b.sourceModule === focusedModuleId;
      const isIncoming = focusedModuleId && b.targetModule === focusedModuleId;
      const isDimmed = Boolean(focusedModuleId && !isConnected);

      let strokeColor = isDark ? 'rgba(99, 102, 241, 0.65)' : 'rgba(79, 70, 229, 0.65)';
      if (focusedModuleId) {
        if (isOutgoing) {
          strokeColor = '#3b82f6';
        } else if (isIncoming) {
          strokeColor = '#10b981';
        } else {
          strokeColor = isDark ? 'rgba(255, 255, 255, 0.05)' : 'rgba(0, 0, 0, 0.05)';
        }
      }

      return {
        id: b.id,
        source: b.sourceModule,
        target: b.targetModule,
        type: 'busEdge',
        animated: Boolean(focusedModuleId && isConnected),
        zIndex: focusedModuleId ? (isConnected ? 20 : 1) : 5,
        style: {
          stroke: strokeColor,
          strokeWidth: focusedModuleId ? (isConnected ? 3 : 1) : 2,
          opacity: focusedModuleId ? (isConnected ? 1 : 0.08) : 0.85,
          transition: 'stroke 0.15s ease, opacity 0.15s ease, stroke-width 0.15s ease',
        },
        data: {
          callCount: b.callCount,
          symbols: b.symbols,
          routingMode,
          isFocused: focusedModuleId && isConnected,
          isDimmed,
        },
      };
    });

    setEdges(computedEdges);
  }, [buses, focusedModuleId, routingMode, isDark, setEdges]);

  // 重置 / 一键排版为算法分层布局
  const handleResetLayout = useCallback(async () => {
    setIsUntangling(true);
    try {
      const res = await fetch('/api/layout-architecture', { method: 'POST' });
      const data = await res.json();
      if (data.success && data.layout?.architecture) {
        setCurrentLayout(data.layout.architecture);
        showToast('✓ 已使用 ELK Sugiyama 正交分层完成智能理线');
        setTimeout(() => rfInstance?.fitView({ duration: 400 }), 50);
        return;
      }
    } catch {
      // 本地降级
    } finally {
      setIsUntangling(false);
    }

    if (currentLayout) {
      setNodes((prevNodes: Node[]) =>
        prevNodes.map((n) => {
          const layoutPos = currentLayout.nodes.find((ln) => ln.id === n.id);
          return {
            ...n,
            position: {
              x: layoutPos ? layoutPos.x : 100,
              y: layoutPos ? layoutPos.y : 100,
            },
          };
        })
      );
      rfInstance?.fitView({ duration: 300 });
      showToast('✓ 已恢复标准正交分层排版');
    }
  }, [currentLayout, rfInstance, setNodes]);

  // 卡片右键处理
  const handleNodeContextMenu = useCallback(
    (event: React.MouseEvent | MouseEvent, node: Node) => {
      event.preventDefault();
      const mod = node.data.module as ModuleContainer;

      const items: ContextMenuItem[] = [
        {
          label: '添加模块所有文件到聊天框',
          icon: <MessageSquarePlus className="w-3.5 h-3.5 text-dsh-blue" />,
          onClick: () => {
            const fileList = mod.files.map((f) => `- \`${f}\``).join('\n');
            const text = `[代码图谱-模块] **${mod.name}**\n包含文件：\n${fileList}`;
            insertIntoChat(text, { title: `模块 ${mod.name}` });
          },
        },
        {
          label: '让 AI 诊断此模块职责与风险',
          icon: <Bot className="w-3.5 h-3.5 text-purple-400" />,
          onClick: () => {
            const fileList = mod.files.map((f) => `- ${f}`).join('\n');
            const text = `请结合当前工程架构，帮我深入分析模块【${mod.name}】（包含 ${mod.files.length} 个文件）的职责设计、对外依赖暴露以及潜在的重构建议。\n相关文件：\n${fileList}`;
            insertIntoChat(text, { title: `诊断模块 ${mod.name}` });
          },
        },
        {
          label: '深入下钻该模块架构',
          icon: <Search className="w-3.5 h-3.5 text-dsh-secondary" />,
          onClick: () => onDrillDown(mod.id),
        },
        {
          label: '锁定高亮该模块及总线',
          icon: <Sparkles className="w-3.5 h-3.5 text-amber-400" />,
          onClick: () => setSelectedModuleId(mod.id),
        },
        {
          label: '复制所有文件相对路径',
          icon: <Copy className="w-3.5 h-3.5 text-dsh-tertiary" />,
          divider: true,
          onClick: () => copyToClipboard(mod.files.join('\n'), '文件路径清单'),
        },
        {
          label: '复制模块名称',
          icon: <Copy className="w-3.5 h-3.5 text-dsh-tertiary" />,
          onClick: () => copyToClipboard(mod.name, '模块名称'),
        },
      ];

      setContextMenu({
        x: event.clientX,
        y: event.clientY,
        title: `模块: ${mod.name}`,
        items,
      });
    },
    [onDrillDown]
  );

  // 空白处右键处理
  const handlePaneContextMenu = useCallback(
    (event: React.MouseEvent | MouseEvent) => {
      event.preventDefault();

      const items: ContextMenuItem[] = [
        {
          label: '发送架构全景概要到聊天框',
          icon: <MessageSquarePlus className="w-3.5 h-3.5 text-dsh-blue" />,
          onClick: () => {
            const summary = modules.map((m) => `- **${m.name}** (${m.files.length} 个文件)`).join('\n');
            const text = `[代码图谱-架构全景]\n当前分析工程包含 ${modules.length} 个模块，${buses.length} 组跨模块调用关联：\n${summary}`;
            insertIntoChat(text, { title: '架构全景' });
          },
        },
        {
          label: '一键自动理线 (ELK Sugiyama)',
          icon: <Wand2 className="w-3.5 h-3.5 text-dsh-blue" />,
          divider: true,
          onClick: handleResetLayout,
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
        title: '画布选项',
        items,
      });
    },
    [modules, buses, handleResetLayout, rfInstance]
  );

  return (
    <div className="w-full h-[calc(100vh-56px)] bg-dsh-base relative">
      {/* 顶部右侧理线与连线控制工具栏 (固定布局，避免因提示变化跳动) */}
      <div className="absolute top-3.5 right-3.5 z-10 flex items-center gap-2 p-1.5 rounded-lg bg-dsh-layer1/95 backdrop-blur border border-dsh-border2 shadow-md text-[13px]">
        {/* 一键理线按钮 */}
        <button
          onClick={handleResetLayout}
          disabled={isUntangling}
          title="使用 ELK Sugiyama 正交分层算法重新排列模块并最小化总线交叉"
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

        {/* 锁定聚焦解除提示 */}
        {selectedModuleId && (
          <button
            onClick={() => {
              setSelectedModuleId(null);
              setHoveredModuleId(null);
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
        edgeTypes={edgeTypes}
        onInit={setRfInstance}
        onNodeMouseEnter={(_, node) => {
          if (!selectedModuleId) {
            setHoveredModuleId(node.id);
          }
        }}
        onNodeMouseLeave={() => {
          if (!selectedModuleId) {
            setHoveredModuleId(null);
          }
        }}
        onNodeClick={(_, node) => setSelectedModuleId((prev) => (prev === node.id ? null : node.id))}
        onNodeDoubleClick={(_, node) => onDrillDown(node.id)}
        onPaneClick={() => {
          setSelectedModuleId(null);
          setHoveredModuleId(null);
        }}
        onNodeContextMenu={handleNodeContextMenu}
        onPaneContextMenu={handlePaneContextMenu}
        fitView
        minZoom={0.2}
        maxZoom={2.5}
      >
        <Background color={isDark ? 'rgba(255, 255, 255, 0.08)' : 'rgba(0, 0, 0, 0.08)'} gap={24} size={1} />
        <Controls />
        <MiniMap
          nodeColor="#4176e6"
          maskColor={isDark ? 'rgba(21, 21, 23, 0.85)' : 'rgba(240, 242, 245, 0.85)'}
          className="bg-dsh-platform border border-dsh-border2 rounded-md"
        />
      </ReactFlow>

      {/* 右键菜单弹出层 */}
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
