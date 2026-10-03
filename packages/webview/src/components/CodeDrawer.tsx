import React, { useEffect, useState } from 'react';
import { X, ExternalLink, FileCode, Check, Copy } from 'lucide-react';
import { CodeNode } from '../../../core/src/types/index.js';

interface CodeDrawerProps {
  node: CodeNode | null;
  onClose: () => void;
}

export const CodeDrawer: React.FC<CodeDrawerProps> = ({ node, onClose }) => {
  const [sourceSnippet, setSourceSnippet] = useState<string>('');
  const [copied, setCopied] = useState<boolean>(false);

  useEffect(() => {
    if (!node) {
      setSourceSnippet('');
      return;
    }

    fetch(`/api/file?path=${encodeURIComponent(node.filePath)}`)
      .then((res) => res.json())
      .then((data) => {
        if (data.content) {
          const lines = data.content.split('\n');
          const start = Math.max(0, node.loc.startLine - 1);
          const end = Math.min(lines.length, node.loc.endLine + 2);
          const snippet = lines.slice(start, end).join('\n');
          setSourceSnippet(snippet);
        }
      })
      .catch(() => {
        setSourceSnippet('# 无法读取本地文件源码');
      });
  }, [node]);

  if (!node) return null;

  const copyPath = () => {
    navigator.clipboard.writeText(`${node.filePath}:${node.loc.startLine}`);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const openInEditor = () => {
    window.open(`vscode://file/${node.filePath}:${node.loc.startLine}`);
  };

  return (
    <div className="fixed top-11 right-0 bottom-0 w-[440px] bg-dsh-platform border-l border-dsh-border2 shadow-2xl z-30 flex flex-col select-none animate-in slide-in-from-right duration-200">
      {/* Header */}
      <div className="p-3.5 border-b border-dsh-border1 flex items-center justify-between">
        <div className="flex items-center gap-2 truncate">
          <div className="w-6 h-6 rounded bg-dsh-blue-tint border border-dsh-blue-border flex items-center justify-center text-dsh-blue shrink-0">
            <FileCode className="w-3.5 h-3.5" />
          </div>
          <span className="text-[13px] font-semibold text-dsh-primary truncate" title={node.name}>
            {node.name}
          </span>
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-dsh-layer2 text-dsh-secondary border border-dsh-border2 font-mono">
            {node.entityType}
          </span>
        </div>
        <button
          onClick={onClose}
          className="p-1 rounded-md text-dsh-tertiary hover:text-dsh-primary hover:bg-dsh-layer2 transition-colors"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Meta info */}
      <div className="p-3.5 space-y-2 border-b border-dsh-border1 text-[12px]">
        <div className="flex items-center justify-between text-dsh-tertiary">
          <span>文件路径:</span>
          <span className="font-mono text-dsh-secondary truncate max-w-[270px]" title={node.filePath}>
            {node.filePath}
          </span>
        </div>
        <div className="flex items-center justify-between text-dsh-tertiary">
          <span>代码区间:</span>
          <span className="font-mono text-dsh-blue">
            Line {node.loc.startLine} ~ {node.loc.endLine}
          </span>
        </div>
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

      {/* Source preview */}
      <div className="flex-1 p-3.5 flex flex-col min-h-0">
        <div className="flex items-center justify-between mb-2">
          <span className="text-[12px] font-medium text-dsh-secondary">源码上下文:</span>
          <button
            onClick={copyPath}
            className="flex items-center gap-1 text-[11px] text-dsh-tertiary hover:text-dsh-blue transition-colors"
          >
            {copied ? <Check className="w-3 h-3 text-dsh-green" /> : <Copy className="w-3 h-3" />}
            <span>{copied ? '已复制' : '复制行号'}</span>
          </button>
        </div>
        <pre className="flex-1 p-3 rounded-md bg-dsh-base border border-dsh-border1 text-[11px] font-mono text-dsh-primary overflow-auto whitespace-pre leading-relaxed select-text">
          {sourceSnippet || '正在加载源码...'}
        </pre>
      </div>

      {/* Footer Actions */}
      <div className="p-3.5 border-t border-dsh-border1 bg-dsh-layer1/50">
        <button
          onClick={openInEditor}
          className="w-full flex items-center justify-center gap-2 py-2 px-4 rounded-md text-[13px] font-medium text-white bg-dsh-blue hover:bg-dsh-blue-hover active:bg-dsh-blue-active transition-all shadow-sm"
        >
          <ExternalLink className="w-3.5 h-3.5" />
          <span>在本地编辑器中打开代码</span>
        </button>
      </div>
    </div>
  );
};
