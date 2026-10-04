import React, { useEffect, useState, useCallback } from 'react';
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
} from 'lucide-react';
import { CodeNode } from '../../../core/src/types/index.js';

interface CodeDrawerProps {
  node: CodeNode | null;
  workspaceRoot?: string;
  onClose: () => void;
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

export const CodeDrawer: React.FC<CodeDrawerProps> = ({ node, workspaceRoot, onClose }) => {
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

      const allFileLines = data.content.split('\n');
      const startLine = node.loc?.startLine && node.loc.startLine > 0 ? node.loc.startLine : 1;
      const endLine = node.loc?.endLine && node.loc.endLine >= startLine ? node.loc.endLine : startLine;

      // 上下文安全扩展 (前展 3 行，后展 4 行，确保至少展示 12 行代码)
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
    <div className="fixed top-11 right-0 bottom-0 w-[480px] bg-dsh-platform border-l border-dsh-border2 shadow-2xl z-30 flex flex-col select-none animate-in slide-in-from-right duration-200">
      {/* Header */}
      <div className="p-3.5 border-b border-dsh-border1 flex items-center justify-between bg-dsh-layer1/60">
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

      {/* Meta info */}
      <div className="p-3.5 space-y-2 border-b border-dsh-border1 text-[12px] bg-dsh-layer1/30">
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
        {node.signature && (
          <div className="pt-1">
            <span className="text-dsh-tertiary block mb-1">函数签名:</span>
            <div className="p-2 rounded bg-dsh-base font-mono text-[11px] text-dsh-green break-all border border-dsh-border1">
              {node.signature}
            </div>
          </div>
        )}
        {node.docstring && (
          <div className="pt-1">
            <span className="text-dsh-tertiary block mb-1">文档说明:</span>
            <div className="text-[11px] text-dsh-secondary italic bg-dsh-base p-2 rounded border border-dsh-border1">
              "{node.docstring}"
            </div>
          </div>
        )}
      </div>

      {/* Source preview area */}
      <div className="flex-1 p-3.5 flex flex-col min-h-0">
        <div className="flex items-center justify-between mb-2">
          <span className="text-[12px] font-medium text-dsh-secondary">
            {isContract ? '契约架构定义:' : '源码上下文 (含行号):'}
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

      {/* Footer Actions */}
      <div className="p-3.5 border-t border-dsh-border1 bg-dsh-layer1/50">
        <button
          onClick={openInEditor}
          disabled={isContract}
          className={`w-full flex items-center justify-center gap-2 py-2 px-4 rounded-md text-[13px] font-medium transition-all shadow-sm ${
            isContract
              ? 'bg-dsh-layer2 text-dsh-tertiary cursor-not-allowed border border-dsh-border1'
              : 'text-white bg-dsh-blue hover:bg-dsh-blue-hover active:bg-dsh-blue-active'
          }`}
        >
          <ExternalLink className="w-3.5 h-3.5" />
          <span>{isContract ? '跨语言契约无物理文件 (虚拟中枢)' : '在本地编辑器中打开代码'}</span>
        </button>
      </div>
    </div>
  );
};
