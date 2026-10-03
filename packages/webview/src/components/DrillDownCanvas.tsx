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
} from 'lucide-react';
import { ContextMenu, ContextMenuItem } from './ContextMenu.js';
import { insertIntoChat, copyToClipboard } from '../utils/chatBridge.js';
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

  const isClass = node.entityType === 'CLASS';
  const isContract = node.entityType === 'CONTRACT_ENDPOINT' || node.entityType === 'CONTRACT_TOPIC';

  return (
    <div
      onClick={() => onSelectNode(node.id, node.filePath, node.loc.startLine)}
      className={`w-[220px] bg-dsh-layer1 border ${
        isContract
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
  return (
    <div className="w-[160px] bg-dsh-green-tint border border-dsh-green-border rounded-md p-2 shadow flex items-center gap-2 select-none cursor-grab active:cursor-grabbing">
      <Handle type="source" position={Position.Right} />
      <ArrowLeftCircle className="w-3.5 h-3.5 text-dsh-green shrink-0" />
      <div className="truncate">
        <div className="text-[9px] text-dsh-green font-bold uppercase tracking-tight">📥 IN-PORT (外部调用)</div>
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
  return (
    <div className="w-[160px] bg-dsh-blue-tint border border-dsh-blue-border rounded-md p-2 shadow flex items-center justify-between select-none cursor-grab active:cursor-grabbing">
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

  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    title?: string;
    items: ContextMenuItem[];
  } | null>(null);

  const moduleFiles = useMemo(() => new Set(module.files), [module.files]);

  useEffect(() => {
    const internalNodes = Object.values(allNodes).filter(
      (n) => moduleFiles.has(n.filePath) && n.entityType !== 'FILE'
    );

    const reactNodes: any[] = [];
    const reactEdges: any[] = [];

    // 1. 排布 In-Ports (左列)
    module.inPorts.forEach((port, idx) => {
      reactNodes.push({
        id: `inport_${port}`,
        type: 'inPort',
        position: { x: 50, y: 100 + idx * 65 },
        data: { name: port, portType: 'IN' },
      });
    });

    // 2. 排布内部符号 (中列矩阵)
    internalNodes.forEach((n, idx) => {
      const col = Math.floor(idx / 5);
      const row = idx % 5;
      reactNodes.push({
        id: n.id,
        type: 'internalSymbol',
        position: { x: 260 + col * 250, y: 80 + row * 90 },
        data: { node: n, onSelectNode },
      });
    });

    // 3. 排布 Out-Ports (右列)
    const maxCol = Math.max(1, Math.ceil(internalNodes.length / 5));
    const rightX = 300 + maxCol * 250;
    module.outPorts.forEach((port, idx) => {
      reactNodes.push({
        id: `outport_${port}`,
        type: 'outPort',
        position: { x: rightX, y: 100 + idx * 65 },
        data: { name: port, portType: 'OUT' },
      });
    });

    // 4. 内部连线
    const internalNodeIds = new Set(internalNodes.map((n) => n.id));
    allEdges.forEach((e, idx) => {
      if (internalNodeIds.has(e.source) && internalNodeIds.has(e.target)) {
        reactEdges.push({
          id: `drill_e_${idx}`,
          source: e.source,
          target: e.target,
          type: 'default',
        });
      }
    });

    setNodes(reactNodes);
    setEdges(reactEdges);
  }, [module, allNodes, allEdges, moduleFiles, onSelectNode, setNodes, setEdges]);

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
            label: '抽屉查看源码',
            icon: <FileCode className="w-3.5 h-3.5 text-dsh-secondary" />,
            divider: true,
            onClick: () => onSelectNode(codeNode.id, codeNode.filePath, codeNode.loc.startLine),
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
    [module, onBackToArchitecture, rfInstance]
  );

  return (
    <div className="relative w-full h-[calc(100vh-44px)] bg-dsh-base">
      {/* 顶部面包屑快速返回条 */}
      <div className="absolute top-3 left-3 z-10 flex items-center gap-2 p-1.5 rounded-md bg-dsh-layer1 border border-dsh-border2 shadow-md text-[12px]">
        <button
          onClick={onBackToArchitecture}
          className="text-dsh-blue hover:text-dsh-blue-hover font-medium flex items-center gap-1 transition-colors"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          <span>返回宏观架构</span>
        </button>
        <span className="text-dsh-border3">/</span>
        <span className="text-dsh-primary font-semibold">{module.name}</span>
        <span className="text-[11px] text-dsh-tertiary">({module.files.length} 个源码文件)</span>
      </div>

      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        nodeTypes={nodeTypes}
        onInit={setRfInstance}
        onNodeContextMenu={handleNodeContextMenu}
        onPaneContextMenu={handlePaneContextMenu}
        fitView
        minZoom={0.3}
        maxZoom={2.0}
      >
        <Background color={isDark ? 'rgba(255, 255, 255, 0.08)' : 'rgba(0, 0, 0, 0.08)'} gap={24} size={1} />
        <Controls className="bg-dsh-layer1 border-dsh-border2 text-dsh-secondary fill-dsh-secondary rounded-md" />
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
