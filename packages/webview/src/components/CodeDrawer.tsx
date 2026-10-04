import React, { useEffect, useState, useCallback, useMemo } from 'react';
import {
  X,
  ExternalLink,
  FileCode,
  Check,
  Copy,
  Loader2,
  AlertCircle,
  RefreshCw,
  Globe,
  Radio,
  BookOpen,
  ArrowDownLeft,
  ArrowUpRight,
  Compass,
  Lightbulb,
  FileText,
  Code2,
  Layers,
} from 'lucide-react';
import {
  CodeNode,
  CodeEdge,
  NodeInteractionStory,
} from '../../../core/src/types/index.js';
import { InteractionNarrator } from '../../../core/src/graph/interaction-narrator.js';

interface CodeDrawerProps {
  node: CodeNode | null;
  workspaceRoot?: string;
  allNodes?: Record<string, CodeNode>;
  allEdges?: CodeEdge[];
  onClose: () => void;
  onNavigateToNode?: (nodeId: string) => void;
}

interface CodeLineItem {
  lineNum: number;
  text: string;
  isHighlighted: boolean;
}

/**
 * 为跨语言契约中枢 (REST API / RPC / Topic) 格式化虚拟契约定义
 */
function formatSyntheticContract(node: CodeNode): string {
  if (node.entityType === 'CONTRACT_ENDPOINT' || node.endpointMeta) {
    const method = (node.endpointMeta?.httpMethod || 'ANY').toUpperCase();
    const route = node.endpointMeta?.routePath || node.name;
    return [
      '// =====================================================================',
      '// 跨语言 REST API 契约中枢定义 (Polyglot REST Contract Hub)',
      '// =====================================================================',
      `HTTP METHOD : ${method}`,
      `ROUTE PATH  : ${route}`,
      `CONTRACT ID : ${node.id}`,
      `SCIP URI    : ${node.scipUri || 'N/A'}`,
      '',
      '// [架构中枢说明]:',
      '// 该节点由本地 AST 引擎分析生成，专用于消除多端开发语言壁垒。',
      '// 它将前端/移动端请求 (fetch / axios / HttpClient) 与后端路由实现 (FastAPI / Express / ASP.NET) 对齐。',
      '// 如需查看具体实现代码，请在左侧架构画布双击或展开下钻视图。',
    ].join('\n');
  }

  if (node.entityType === 'CONTRACT_TOPIC' || node.topicMeta) {
    const topic = node.topicMeta?.topicName || node.name;
    return [
      '// =====================================================================',
      '// 跨语言消息主题 / 事件队列契约定义 (Event & Topic Contract Hub)',
      '// =====================================================================',
      `TOPIC NAME  : ${topic}`,
      `CONTRACT ID : ${node.id}`,
      `SCIP URI    : ${node.scipUri || 'N/A'}`,
      '',
      '// [架构中枢说明]:',
      '// 该节点代表分布式消息发布/订阅 (Pub/Sub) 契约总线。',
      '// 连接事件发布方 (Publisher) 与所有后端的消费处理器 (Subscriber/Worker)。',
    ].join('\n');
  }

  if (node.entityType === 'CONTRACT_RPC' || node.rpcMeta) {
    const svc = node.rpcMeta?.serviceName || 'N/A';
    const mtd = node.rpcMeta?.methodName || node.name;
    return [
      '// =====================================================================',
      '// 跨语言 RPC 服务方法契约定义 (RPC/Protobuf Contract Hub)',
      '// =====================================================================',
      `SERVICE     : ${svc}`,
      `METHOD      : ${mtd}`,
      `CONTRACT ID : ${node.id}`,
      `SCIP URI    : ${node.scipUri || 'N/A'}`,
      '',
      '// [架构中枢说明]:',
      '// 该节点代表跨语言 RPC 契约，对齐客户端 Stub 调用与服务端服务实现。',
    ].join('\n');
  }

  return [
    '// =====================================================================',
    `// 架构抽象节点: ${node.name}`,
    '// =====================================================================',
    `TYPE        : ${node.entityType}`,
    `ID          : ${node.id}`,
    '',
    '// 该节点为架构宏观抽象节点，无对应物理源码文件。',
  ].join('\n');
}

export const CodeDrawer: React.FC<CodeDrawerProps> = ({
  node,
  workspaceRoot,
  allNodes = {},
  allEdges = [],
  onClose,
  onNavigateToNode,
}) => {
  const [activeTab, setActiveTab] = useState<'narrative' | 'source'>('narrative');
  const [status, setStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');
  const [errorMessage, setErrorMessage] = useState<string>('');
  const [lines, setLines] = useState<CodeLineItem[]>([]);
  const [rawSnippet, setRawSnippet] = useState<string>('');
  const [resolvedFullPath, setResolvedFullPath] = useState<string>('');
  const [copied, setCopied] = useState<boolean>(false);

  const isContract = !!(
    node &&
    (node.entityType.startsWith('CONTRACT_') ||
      node.filePath.startsWith('contracts/') ||
      node.language === 'contract')
  );

  // 1. 获取或即时计算 0-Token 本地交互透视故事
  const story: NodeInteractionStory | null = useMemo(() => {
    if (!node) return null;
    if (node.metadata?.story) {
      return node.metadata.story as NodeInteractionStory;
    }
    // 客户端实时容错兜底合成
    return InteractionNarrator.generateNodeStory(node, allNodes, allEdges);
  }, [node, allNodes, allEdges]);

  // 2. 加载物理文件源码逻辑
  const loadFile = useCallback(async () => {
    if (!node) {
      setStatus('idle');
      setLines([]);
      setRawSnippet('');
      setResolvedFullPath('');
      return;
    }

    // 虚拟契约节点无需网络请求，直接内存合成标准契约规范
    if (isContract) {
      const synthetic = formatSyntheticContract(node);
      setRawSnippet(synthetic);
      setResolvedFullPath(node.filePath);
      setLines([
        {
          lineNum: 1,
          text: synthetic,
          isHighlighted: false,
        },
      ]);
      setStatus('success');
      return;
    }

    setStatus('loading');
    setErrorMessage('');

    try {
      const params = new URLSearchParams();
      params.set('path', node.filePath);
      if (workspaceRoot && workspaceRoot !== '当前工作区') {
        params.set('workspace', workspaceRoot);
      }

      const res = await fetch(`/api/file?${params.toString()}`);
      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        throw new Error(data.error || `HTTP ${res.status} 读取文件失败`);
      }

      if (typeof data.content !== 'string') {
        throw new Error('服务端返回的文件内容格式异常');
      }

      const allFileLines: string[] = data.content.split('\n');
      const startLine = node.loc?.startLine && node.loc.startLine > 0 ? node.loc.startLine : 1;
      const endLine = node.loc?.endLine && node.loc.endLine >= startLine ? node.loc.endLine : startLine;

      // 上下文安全扩展 (前展 4 行，后展 4 行，确保至少展示 12 行代码)
      const startIdx = Math.max(0, startLine - 4);
      const endIdx = Math.min(allFileLines.length, Math.max(endLine + 4, startIdx + 12));

      const sliced: string[] = allFileLines.slice(startIdx, endIdx);
      const items: CodeLineItem[] = sliced.map((text: string, idx: number) => {
        const lineNum = startIdx + idx + 1;
        return {
          lineNum,
          text,
          isHighlighted: lineNum >= startLine && lineNum <= endLine,
        };
      });

      setLines(items);
      setRawSnippet(sliced.join('\n'));
      setResolvedFullPath(data.fullPath || node.filePath);
      setStatus('success');
    } catch (err: any) {
      console.warn('[CodeDrawer] 加载源码失败:', err);
      setStatus('error');
      setErrorMessage(err.message || '无法读取本地文件源码');
    }
  }, [node, isContract, workspaceRoot]);

  useEffect(() => {
    loadFile();
  }, [loadFile]);

  if (!node) return null;

  const copyPath = () => {
    const target = resolvedFullPath || node.filePath;
    const line = node.loc?.startLine || 1;
    navigator.clipboard.writeText(`${target}:${line}`);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const copyCode = () => {
    navigator.clipboard.writeText(rawSnippet);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const openInEditor = () => {
    if (isContract) return;
    const target = resolvedFullPath || node.filePath;
    const norm = target.replace(/\\/g, '/');
    const uri = norm.startsWith('/') ? `vscode://file${norm}` : `vscode://file/${norm}`;
    window.open(`${uri}:${node.loc?.startLine || 1}`);
  };

  return (
    <div className="fixed top-11 right-0 bottom-0 w-[490px] bg-dsh-platform border-l border-dsh-border2 shadow-2xl z-30 flex flex-col select-none animate-in slide-in-from-right duration-200">
      {/* 顶部标题与实体元信息 */}
      <div className="p-3 border-b border-dsh-border1 flex items-center justify-between bg-dsh-layer1/70">
        <div className="flex items-center gap-2 truncate">
          <div
            className={`w-6 h-6 rounded flex items-center justify-center shrink-0 border ${
              isContract
                ? 'bg-indigo-500/10 text-indigo-400 border-indigo-500/30'
                : 'bg-dsh-blue-tint text-dsh-blue border-dsh-blue-border'
            }`}
          >
            {isContract ? (
              node.entityType === 'CONTRACT_ENDPOINT' ? (
                <Globe className="w-3.5 h-3.5" />
              ) : (
                <Radio className="w-3.5 h-3.5" />
              )
            ) : (
              <FileCode className="w-3.5 h-3.5" />
            )}
          </div>
          <span className="text-[13px] font-semibold text-dsh-primary truncate" title={node.name}>
            {node.name}
          </span>
          <span
            className={`text-[10px] px-1.5 py-0.5 rounded border font-mono ${
              isContract
                ? 'bg-indigo-500/10 text-indigo-300 border-indigo-500/30'
                : 'bg-dsh-layer2 text-dsh-secondary border-dsh-border2'
            }`}
          >
            {isContract
              ? node.entityType === 'CONTRACT_ENDPOINT'
                ? 'REST 契约'
                : 'TOPIC 契约'
              : node.entityType}
          </span>
          {node.language && node.language !== 'contract' && (
            <span className="text-[9px] px-1 py-0.2 rounded font-mono bg-dsh-base text-dsh-tertiary border border-dsh-border1 uppercase">
              {node.language}
            </span>
          )}
        </div>
        <button
          onClick={onClose}
          className="p-1 rounded-md text-dsh-tertiary hover:text-dsh-primary hover:bg-dsh-layer2 transition-colors"
          title="关闭抽屉"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* 核心双 Tab 导航控制条 */}
      <div className="flex items-center border-b border-dsh-border1 bg-dsh-layer1/40 px-3 pt-1.5 gap-2">
        <button
          onClick={() => setActiveTab('narrative')}
          className={`flex items-center gap-1.5 pb-2 px-2 text-[12px] font-medium border-b-2 transition-all ${
            activeTab === 'narrative'
              ? 'border-dsh-blue text-dsh-blue'
              : 'border-transparent text-dsh-tertiary hover:text-dsh-primary'
          }`}
        >
          <BookOpen className="w-3.5 h-3.5" />
          <span>交互透视与说明</span>
          <span className="text-[9px] px-1 py-0.2 rounded bg-dsh-blue-tint text-dsh-blue border border-dsh-blue-border ml-0.5">
            0-Token
          </span>
        </button>
        <button
          onClick={() => setActiveTab('source')}
          className={`flex items-center gap-1.5 pb-2 px-2 text-[12px] font-medium border-b-2 transition-all ${
            activeTab === 'source'
              ? 'border-dsh-blue text-dsh-blue'
              : 'border-transparent text-dsh-tertiary hover:text-dsh-primary'
          }`}
        >
          <Code2 className="w-3.5 h-3.5" />
          <span>源码上下文</span>
        </button>
      </div>

      {/* TAB 1: 交互透视与通俗人话解说 */}
      {activeTab === 'narrative' && (
        <div className="flex-1 p-3.5 overflow-y-auto space-y-3.5 select-text">
          {/* 1. 架构角色定位卡 */}
          <div className="p-3 rounded-md bg-dsh-base border border-dsh-border1 shadow-sm space-y-2">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1.5">
                <Compass className="w-4 h-4 text-dsh-blue" />
                <span className="text-[12px] font-semibold text-dsh-primary">
                  {story?.roleTitle || '业务组件'}
                </span>
              </div>
              <div className="flex items-center gap-1.5 font-mono text-[10px]">
                <span className="px-1.5 py-0.5 rounded bg-dsh-layer2 text-dsh-green border border-dsh-green-border/30">
                  📥 入站 {story?.inDegree ?? 0}
                </span>
                <span className="px-1.5 py-0.5 rounded bg-dsh-layer2 text-dsh-blue border border-dsh-blue-border/30">
                  📤 出站 {story?.outDegree ?? 0}
                </span>
              </div>
            </div>
            <p className="text-[11px] text-dsh-secondary leading-relaxed">
              {story?.roleDescription}
            </p>
          </div>

          {/* 2. 原生开发者说明 / 功能简述 */}
          <div className="p-3 rounded-md bg-dsh-base border border-dsh-border1 shadow-sm space-y-1.5">
            <div className="flex items-center gap-1.5 text-dsh-tertiary text-[11px]">
              <FileText className="w-3.5 h-3.5 text-dsh-amber" />
              <span className="font-medium text-dsh-secondary">功能与业务意图:</span>
            </div>
            <div className="p-2.5 rounded bg-dsh-layer1/60 border border-dsh-border1 text-[11px] text-dsh-primary leading-relaxed">
              {story?.summaryText || '暂无文档说明'}
            </div>
            {node.signature && (
              <div className="pt-1">
                <span className="text-[10px] text-dsh-dimmed block mb-1">代码声明签名:</span>
                <div className="p-1.5 rounded bg-dsh-layer2 font-mono text-[10px] text-dsh-green break-all border border-dsh-border1">
                  {node.signature}
                </div>
              </div>
            )}
          </div>

          {/* 3. 交互流向透视 (人话小故事) */}
          <div className="p-3 rounded-md bg-dsh-base border border-dsh-border1 shadow-sm space-y-3">
            <div className="flex items-center gap-1.5 text-[12px] font-semibold text-dsh-primary border-b border-dsh-border1 pb-1.5">
              <Layers className="w-3.5 h-3.5 text-dsh-blue" />
              <span>交互流向透视</span>
            </div>

            {/* 输入来源 (谁在调用它) */}
            <div className="space-y-1.5">
              <div className="flex items-center gap-1 text-[11px] font-medium text-dsh-secondary">
                <ArrowDownLeft className="w-3.5 h-3.5 text-dsh-green shrink-0" />
                <span>输入交互 (谁在触发/调用本组件):</span>
              </div>
              {story && story.callers.length > 0 ? (
                <div className="space-y-1">
                  {story.callers.map((caller, idx) => (
                    <div
                      key={idx}
                      onClick={() => onNavigateToNode?.(caller.nodeId)}
                      className="p-2 rounded bg-dsh-layer1 hover:bg-dsh-layer2/80 border border-dsh-border1 hover:border-dsh-blue/50 transition-all cursor-pointer group flex items-start justify-between"
                      title="点击快速聚焦此关联节点"
                    >
                      <div className="truncate mr-2">
                        <div className="text-[11px] font-medium text-dsh-primary group-hover:text-dsh-blue transition-colors truncate">
                          {caller.name}
                        </div>
                        <div className="text-[10px] text-dsh-dimmed font-mono truncate">
                          @{caller.filePath}:{caller.line}
                        </div>
                      </div>
                      <span className="text-[9px] px-1.5 py-0.5 rounded bg-dsh-green-tint text-dsh-green border border-dsh-green-border shrink-0">
                        {caller.relationText}
                      </span>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-[11px] text-dsh-dimmed italic pl-2 py-1">
                  （作为初始触发端或公开入口，无内部上游调用者）
                </div>
              )}
            </div>

            {/* 输出依赖 (它在调用谁) */}
            <div className="space-y-1.5 pt-1">
              <div className="flex items-center gap-1 text-[11px] font-medium text-dsh-secondary">
                <ArrowUpRight className="w-3.5 h-3.5 text-dsh-blue shrink-0" />
                <span>输出交互 (它在调用/调度哪些下游):</span>
              </div>
              {story && story.callees.length > 0 ? (
                <div className="space-y-1">
                  {story.callees.map((callee, idx) => (
                    <div
                      key={idx}
                      onClick={() => onNavigateToNode?.(callee.nodeId)}
                      className="p-2 rounded bg-dsh-layer1 hover:bg-dsh-layer2/80 border border-dsh-border1 hover:border-dsh-blue/50 transition-all cursor-pointer group flex items-start justify-between"
                      title="点击快速聚焦此关联节点"
                    >
                      <div className="truncate mr-2">
                        <div className="text-[11px] font-medium text-dsh-primary group-hover:text-dsh-blue transition-colors truncate">
                          {callee.name}
                        </div>
                        <div className="text-[10px] text-dsh-dimmed font-mono truncate">
                          @{callee.filePath}:{callee.line}
                        </div>
                      </div>
                      <span className="text-[9px] px-1.5 py-0.5 rounded bg-dsh-blue-tint text-dsh-blue border border-dsh-blue-border shrink-0">
                        {callee.relationText}
                      </span>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-[11px] text-dsh-dimmed italic pl-2 py-1">
                  （作为最末端落地执行单元，无外部下游业务依赖）
                </div>
              )}
            </div>

            {/* 跨端契约中枢协同 */}
            {story && story.contracts.length > 0 && (
              <div className="space-y-1.5 pt-1 border-t border-dsh-border1">
                <div className="flex items-center gap-1 text-[11px] font-medium text-indigo-400">
                  <Globe className="w-3.5 h-3.5 shrink-0" />
                  <span>跨端契约协同:</span>
                </div>
                <div className="space-y-1">
                  {story.contracts.map((c, idx) => (
                    <div
                      key={idx}
                      className="p-2 rounded bg-indigo-500/5 border border-indigo-500/20 text-[10px] flex items-center justify-between"
                    >
                      <span className="font-mono text-indigo-300 font-semibold">{c.name}</span>
                      <span className="text-dsh-tertiary">{c.description}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* 4. 架构影响面与演进建议 */}
          {story?.architectureAdvice && (
            <div className="p-3 rounded-md bg-amber-500/5 border border-amber-500/20 shadow-sm flex items-start gap-2.5">
              <Lightbulb className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
              <div className="space-y-0.5">
                <span className="text-[11px] font-semibold text-amber-300 block">架构演进与改动建议</span>
                <p className="text-[11px] text-dsh-secondary leading-relaxed">
                  {story.architectureAdvice}
                </p>
              </div>
            </div>
          )}
        </div>
      )}

      {/* TAB 2: 源码上下文视图 */}
      {activeTab === 'source' && (
        <div className="flex-1 flex flex-col min-h-0">
          {/* 路径与行区间信息 */}
          <div className="p-3 space-y-1.5 border-b border-dsh-border1 text-[12px] bg-dsh-layer1/30">
            <div className="flex items-center justify-between text-dsh-tertiary">
              <span>文件路径:</span>
              <span className="font-mono text-dsh-secondary truncate max-w-[310px]" title={node.filePath}>
                {node.filePath}
              </span>
            </div>
            {!isContract && (
              <div className="flex items-center justify-between text-dsh-tertiary">
                <span>代码区间:</span>
                <span className="font-mono text-dsh-blue">
                  Line {node.loc?.startLine || 1} ~ {node.loc?.endLine || 1}
                </span>
              </div>
            )}
          </div>

          {/* 源码预览主体 */}
          <div className="flex-1 p-3.5 flex flex-col min-h-0">
            <div className="flex items-center justify-between mb-2">
              <span className="text-[12px] font-medium text-dsh-secondary">
                {isContract ? '契约架构定义:' : '源码上下文 (高精行号):'}
              </span>
              <div className="flex items-center gap-2">
                <button
                  onClick={copyCode}
                  disabled={status !== 'success'}
                  className="flex items-center gap-1 text-[11px] text-dsh-tertiary hover:text-dsh-blue disabled:opacity-40 transition-colors"
                >
                  {copied ? <Check className="w-3 h-3 text-dsh-green" /> : <Copy className="w-3 h-3" />}
                  <span>{copied ? '已复制' : '复制代码'}</span>
                </button>
                {!isContract && (
                  <button
                    onClick={copyPath}
                    className="flex items-center gap-1 text-[11px] text-dsh-tertiary hover:text-dsh-blue transition-colors ml-2"
                  >
                    <span>复制路径:行号</span>
                  </button>
                )}
              </div>
            </div>

            {/* 状态 1: 正在读取 */}
            {status === 'loading' && (
              <div className="flex-1 p-6 rounded-md bg-dsh-base border border-dsh-border1 flex flex-col items-center justify-center gap-3 text-dsh-secondary">
                <Loader2 className="w-6 h-6 text-dsh-blue animate-spin" />
                <span className="text-[12px] font-medium text-dsh-primary">正在从本地磁盘读取源码...</span>
                <span
                  className="text-[10px] text-dsh-dimmed font-mono truncate max-w-[340px]"
                  title={node.filePath}
                >
                  {node.filePath}
                </span>
              </div>
            )}

            {/* 状态 2: 读取失败 */}
            {status === 'error' && (
              <div className="flex-1 p-5 rounded-md bg-dsh-base border border-red-500/30 flex flex-col items-center justify-center gap-3 text-center">
                <div className="w-9 h-9 rounded-full bg-red-500/10 flex items-center justify-center text-red-500">
                  <AlertCircle className="w-5 h-5" />
                </div>
                <div className="space-y-1">
                  <div className="text-[13px] font-medium text-red-400">读取本地源码失败</div>
                  <div className="text-[11px] text-dsh-tertiary max-w-[340px] break-words">
                    {errorMessage}
                  </div>
                </div>
                <button
                  onClick={loadFile}
                  className="mt-2 flex items-center gap-1.5 px-3 py-1.5 rounded bg-dsh-layer2 hover:bg-dsh-border2 border border-dsh-border2 text-[11px] text-dsh-primary transition-colors shadow-sm"
                >
                  <RefreshCw className="w-3.5 h-3.5 text-dsh-blue" />
                  <span>重新加载</span>
                </button>
              </div>
            )}

            {/* 状态 3: 虚拟契约中枢展示 */}
            {status === 'success' && isContract && (
              <pre className="flex-1 p-3 rounded-md bg-dsh-base border border-indigo-500/20 text-[11px] font-mono text-indigo-200/90 overflow-auto whitespace-pre leading-relaxed select-text shadow-inner">
                {rawSnippet}
              </pre>
            )}

            {/* 状态 4: 物理文件代码展示 (高精行号高亮对齐) */}
            {status === 'success' && !isContract && (
              <div className="flex-1 p-2 rounded-md bg-dsh-base border border-dsh-border1 text-[11px] font-mono overflow-auto select-text leading-relaxed shadow-inner">
                {lines.length === 0 ? (
                  <div className="p-4 text-center text-dsh-dimmed text-[12px] italic">
                    (文件内容为空)
                  </div>
                ) : (
                  lines.map((item, idx) => (
                    <div
                      key={idx}
                      className={`flex items-start rounded-sm transition-colors ${
                        item.isHighlighted
                          ? 'bg-dsh-blue-tint/50 text-dsh-primary font-medium border-l-2 border-dsh-blue pl-1'
                          : 'text-dsh-secondary hover:bg-dsh-layer2/40 pl-1.5'
                      }`}
                    >
                      <span className="w-9 shrink-0 text-right pr-3 select-none text-dsh-dimmed font-mono text-[10px] pt-0.5">
                        {item.lineNum}
                      </span>
                      <span className="whitespace-pre flex-1 overflow-x-visible">
                        {item.text || ' '}
                      </span>
                    </div>
                  ))
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* 底部操作工具栏 */}
      <div className="p-3 border-t border-dsh-border1 bg-dsh-layer1/60 flex items-center gap-2">
        {activeTab === 'narrative' ? (
          <button
            onClick={() => setActiveTab('source')}
            className="flex-1 flex items-center justify-center gap-1.5 py-2 px-3 rounded-md text-[12px] font-medium text-dsh-primary bg-dsh-layer2 hover:bg-dsh-border2 border border-dsh-border2 transition-all shadow-sm"
          >
            <Code2 className="w-3.5 h-3.5 text-dsh-blue" />
            <span>查看对应源码实现 ➔</span>
          </button>
        ) : (
          <button
            onClick={() => setActiveTab('narrative')}
            className="flex-1 flex items-center justify-center gap-1.5 py-2 px-3 rounded-md text-[12px] font-medium text-dsh-primary bg-dsh-layer2 hover:bg-dsh-border2 border border-dsh-border2 transition-all shadow-sm"
          >
            <BookOpen className="w-3.5 h-3.5 text-dsh-blue" />
            <span>返回交互透视说明 ➔</span>
          </button>
        )}

        <button
          onClick={openInEditor}
          disabled={isContract}
          className={`py-2 px-3 rounded-md text-[12px] font-medium transition-all shadow-sm flex items-center gap-1.5 ${
            isContract
              ? 'bg-dsh-layer2 text-dsh-dimmed cursor-not-allowed border border-dsh-border1'
              : 'text-white bg-dsh-blue hover:bg-dsh-blue-hover active:bg-dsh-blue-active'
          }`}
          title={isContract ? '虚拟节点无本地物理文件' : '在本地 VS Code 中打开'}
        >
          <ExternalLink className="w-3.5 h-3.5" />
          <span>在编辑器打开</span>
        </button>
      </div>
    </div>
  );
};
