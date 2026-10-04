import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  Handle,
  Position,
  NodeProps,
  BaseEdge,
  getSmoothStepPath,
  EdgeProps,
  EdgeLabelRenderer,
  useNodesState,
  useEdgesState,
  ReactFlowInstance,
  Node,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { ProcessFlow, ProcessFlowStep } from '../../../core/src/types/index.js';
import {
  GitBranch,
  PlayCircle,
  Database,
  Code,
  CheckCircle,
  MessageSquarePlus,
  Bot,
  Copy,
  FileCode,
  Maximize2,
  Workflow,
  BookOpen,
} from 'lucide-react';
import { ContextMenu, ContextMenuItem } from './ContextMenu.js';
import { insertIntoChat, copyToClipboard } from '../utils/chatBridge.js';
import { useTheme } from '../context/ThemeContext.js';

interface ProcessFlowCanvasProps {
  flows: ProcessFlow[];
  onSelectNode: (nodeId: string, filePath: string, line: number) => void;
}

// DeepSeek Harness 风格时序步骤卡片
const FlowStepNode = ({ data }: NodeProps) => {
  const step = data.step as ProcessFlowStep;
  const onSelectNode = data.onSelectNode as (id: string, path: string, line: number) => void;

  const isEntry = step.stepType === 'ENTRY';
  const isStore = step.stepType === 'STORE';
  const isDecision = step.stepType === 'DECISION';
  const isOutput = step.stepType === 'OUTPUT';

  const badgeConfig = isEntry
    ? { text: 'TRIGGER ENTRY', bg: 'bg-dsh-blue-tint text-dsh-blue border-dsh-blue-border' }
    : isStore
    ? { text: 'DATA STORE', bg: 'bg-dsh-green-tint text-dsh-green border-dsh-green-border' }
    : isDecision
    ? { text: 'DECISION', bg: 'bg-dsh-amber-tint text-dsh-amber border-dsh-amber-border' }
    : isOutput
    ? { text: 'OUTPUT', bg: 'bg-purple-500/10 text-purple-600 dark:text-purple-300 border-purple-500/30 dark:bg-purple-950/40' }
    : { text: 'STEP', bg: 'bg-dsh-platform text-dsh-secondary border-dsh-border2' };

  return (
    <div
      onClick={() => onSelectNode(step.nodeId, step.filePath, step.line)}
      title={`${step.name}(): 点击查看业务交互解析与源码`}
      className="w-[230px] bg-dsh-layer1 border border-dsh-border2 hover:border-dsh-blue rounded-md shadow p-3 cursor-grab active:cursor-grabbing group transition-all select-none"
    >
      <Handle type="target" position={Position.Top} className="opacity-0" />
      <Handle type="source" position={Position.Bottom} className="opacity-0" />

      {/* Top: Type badge & Line */}
      <div className="flex items-center justify-between mb-2">
        <span className={`text-[10px] px-1.5 py-0.5 rounded border font-semibold ${badgeConfig.bg}`}>
          {badgeConfig.text}
        </span>
        <span className="text-[10px] text-dsh-dimmed font-mono">L{step.line}</span>
      </div>

      {/* Symbol Name */}
      <div className="flex items-center gap-2 mb-2">
        {isEntry ? (
          <PlayCircle className="w-4 h-4 text-dsh-blue shrink-0" />
        ) : isStore ? (
          <Database className="w-4 h-4 text-dsh-green shrink-0" />
        ) : isDecision ? (
          <CheckCircle className="w-4 h-4 text-dsh-amber shrink-0" />
        ) : (
          <Code className="w-4 h-4 text-dsh-tertiary shrink-0" />
        )}
        <span className="text-[13px] font-semibold text-dsh-primary truncate" title={step.name}>
          {step.name}()
        </span>
      </div>

      {/* Footer: Path & Action */}
      <div className="text-[11px] text-dsh-tertiary truncate flex items-center justify-between border-t border-dsh-border1 pt-1.5">
        <span className="truncate max-w-[150px] font-mono">{step.filePath}</span>
        <span className="text-dsh-blue opacity-0 group-hover:opacity-100 transition-opacity">查看 ↗</span>
      </div>
    </div>
  );
};

// 带条件标签的时序平滑连线
const FlowSmoothEdge = ({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  data,
}: EdgeProps) => {
  const [edgePath, labelX, labelY] = getSmoothStepPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
    borderRadius: 12,
  });

  const condition = (data as any)?.condition;

  return (
    <>
      <BaseEdge id={id} path={edgePath} className="flow-running-edge" />
      {condition && (
        <EdgeLabelRenderer>
          <div
            style={{
              position: 'absolute',
              transform: `translate(-50%, -50%) translate(${labelX}px,${labelY}px)`,
              pointerEvents: 'all',
            }}
            className="px-2 py-0.5 rounded bg-dsh-layer2 border border-dsh-border3 text-[10px] text-dsh-amber shadow"
          >
            {condition}
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
};

export const ProcessFlowCanvas: React.FC<ProcessFlowCanvasProps> = ({ flows, onSelectNode }) => {
  const { isDark } = useTheme();
  const [selectedFlowIndex, setSelectedFlowIndex] = useState<number>(0);
  const currentFlow = flows[selectedFlowIndex] || flows[0];

  const nodeTypes = useMemo(() => ({ flowStep: FlowStepNode }), []);
  const edgeTypes = useMemo(() => ({ flowSmooth: FlowSmoothEdge }), []);

  const [rfInstance, setRfInstance] = useState<ReactFlowInstance | null>(null);
  const [nodes, setNodes, onNodesChange] = useNodesState<any>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<any>([]);

  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    title?: string;
    items: ContextMenuItem[];
  } | null>(null);

  useEffect(() => {
    if (!currentFlow) {
      setNodes([]);
      setEdges([]);
      return;
    }

    const flowNodes = currentFlow.steps.map((s, idx) => ({
      id: s.id,
      type: 'flowStep',
      position: {
        x: 350 + (idx % 2 === 1 ? 60 : -60) * (idx > 3 ? 1 : 0),
        y: 60 + idx * 110,
      },
      data: {
        step: s,
        onSelectNode,
      },
    }));

    const flowEdges = currentFlow.edges.map((e, idx) => ({
      id: `flow_e_${idx}`,
      source: e.source,
      target: e.target,
      type: 'flowSmooth',
      data: { condition: e.condition },
    }));

    setNodes(flowNodes);
    setEdges(flowEdges);
  }, [currentFlow, onSelectNode, setNodes, setEdges]);

  // 步骤卡片右键菜单
  const handleNodeContextMenu = useCallback(
    (event: React.MouseEvent | MouseEvent, node: Node) => {
      event.preventDefault();
      const step = node.data.step as ProcessFlowStep;

      const items: ContextMenuItem[] = [
        {
          label: '添加此步骤代码定位到聊天框',
          icon: <MessageSquarePlus className="w-3.5 h-3.5 text-dsh-blue" />,
          onClick: () => {
            const text = `@${step.filePath}:${step.line} (${step.name})`;
            insertIntoChat(text, { title: `代码定位: ${step.name}` });
          },
        },
        {
          label: '发送整条业务调用链到聊天框',
          icon: <Workflow className="w-3.5 h-3.5 text-dsh-secondary" />,
          onClick: () => {
            const chain = currentFlow.steps
              .map((s, idx) => `${idx + 1}. [${s.stepType}] ${s.name}() -> @${s.filePath}:${s.line}`)
              .join('\n');
            const text = `[业务时序链: ${currentFlow.title}]\n执行步骤：\n${chain}`;
            insertIntoChat(text, { title: `时序链: ${currentFlow.title}` });
          },
        },
        {
          label: '让 AI 审查此调用链路与潜在缺陷',
          icon: <Bot className="w-3.5 h-3.5 text-purple-400" />,
          onClick: () => {
            const chain = currentFlow.steps
              .map((s, idx) => `${idx + 1}. [${s.stepType}] ${s.name}() (@${s.filePath}:${s.line})`)
              .join('\n');
            const text = `请帮我审查从入口【${currentFlow.title}】出发的时序执行链，分析以下步骤是否存在未捕获异常、性能瓶颈、缺少权限校验或潜在逻辑死锁问题：\n${chain}`;
            insertIntoChat(text, { title: `审查链路: ${currentFlow.title}` });
          },
        },
        {
          label: '交互透视与说明 (0-Token)',
          icon: <BookOpen className="w-3.5 h-3.5 text-dsh-blue" />,
          onClick: () => onSelectNode(step.nodeId, step.filePath, step.line),
        },
        {
          label: '查看源码定义',
          icon: <FileCode className="w-3.5 h-3.5 text-dsh-secondary" />,
          divider: true,
          onClick: () => onSelectNode(step.nodeId, step.filePath, step.line),
        },
        {
          label: '复制路径与行号 (file:line)',
          icon: <Copy className="w-3.5 h-3.5 text-dsh-tertiary" />,
          onClick: () => copyToClipboard(`${step.filePath}:${step.line}`, '路径与行号'),
        },
        {
          label: '复制符号函数名',
          icon: <Copy className="w-3.5 h-3.5 text-dsh-tertiary" />,
          onClick: () => copyToClipboard(step.name, '函数名'),
        },
      ];

      setContextMenu({
        x: event.clientX,
        y: event.clientY,
        title: `步骤: ${step.name}()`,
        items,
      });
    },
    [currentFlow, onSelectNode]
  );

  // 空白处右键菜单
  const handlePaneContextMenu = useCallback(
    (event: React.MouseEvent | MouseEvent) => {
      event.preventDefault();
      if (!currentFlow) return;

      const items: ContextMenuItem[] = [
        {
          label: `发送【${currentFlow.title}】时序链到聊天框`,
          icon: <MessageSquarePlus className="w-3.5 h-3.5 text-dsh-blue" />,
          onClick: () => {
            const chain = currentFlow.steps
              .map((s, idx) => `${idx + 1}. [${s.stepType}] ${s.name}() -> @${s.filePath}:${s.line}`)
              .join('\n');
            const text = `[业务时序链: ${currentFlow.title}]\n执行步骤：\n${chain}`;
            insertIntoChat(text, { title: `时序链: ${currentFlow.title}` });
          },
        },
        {
          label: '适屏居中 (Fit View)',
          icon: <Maximize2 className="w-3.5 h-3.5 text-dsh-secondary" />,
          divider: true,
          onClick: () => rfInstance?.fitView({ duration: 300 }),
        },
      ];

      setContextMenu({
        x: event.clientX,
        y: event.clientY,
        title: '时序流选项',
        items,
      });
    },
    [currentFlow, rfInstance]
  );

  if (flows.length === 0) {
    return (
      <div className="flex items-center justify-center h-[calc(100vh-44px)] text-dsh-tertiary text-[13px] bg-dsh-base">
        当前工程未提取到显式业务入口流程
      </div>
    );
  }

  return (
    <div className="relative w-full h-[calc(100vh-56px)] bg-dsh-base">
      {/* 顶部流程选择栏 */}
      <div className="absolute top-3.5 left-3.5 z-10 flex items-center gap-2 px-3 py-1.5 rounded-lg bg-dsh-layer1 border border-dsh-border2 shadow-md">
        <GitBranch className="w-4 h-4 text-dsh-blue ml-0.5" />
        <span className="text-[13px] text-dsh-secondary font-medium">业务流程:</span>
        <select
          value={selectedFlowIndex}
          onChange={(e) => setSelectedFlowIndex(Number(e.target.value))}
          className="bg-dsh-platform border border-dsh-border2 rounded px-2.5 py-1 text-[13px] text-dsh-primary focus:outline-none cursor-pointer"
        >
          {flows.map((f, i) => (
            <option key={f.flowId} value={i} className="bg-dsh-layer1 text-dsh-primary">
              {f.title} ({f.steps.length} 步骤)
            </option>
          ))}
        </select>
      </div>

      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        onInit={setRfInstance}
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
