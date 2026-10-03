import React, { useState, useEffect } from 'react';
import { Compass, Folder, Play, Check, Edit2, ArrowLeft, CheckCircle2 } from 'lucide-react';

interface SetupViewProps {
  workspaceRoot: string;
  onStartScan: (scopePath: string, customWorkspace?: string) => Promise<void>;
  isLoading: boolean;
  hasExistingGraph?: boolean;
  onCancel?: () => void;
}

export const SetupView: React.FC<SetupViewProps> = ({
  workspaceRoot,
  onStartScan,
  isLoading,
  hasExistingGraph,
  onCancel,
}) => {
  const [scopePath, setScopePath] = useState<string>('.');
  const [currentWsRoot, setCurrentWsRoot] = useState<string>(workspaceRoot);
  const [isEditingWs, setIsEditingWs] = useState<boolean>(false);

  useEffect(() => {
    setCurrentWsRoot(workspaceRoot);
  }, [workspaceRoot]);

  const [excludes, setExcludes] = useState({
    git: true,
    nodeModules: true,
    venv: true,
    dist: true,
    tests: false,
  });

  const toggleExclude = (key: keyof typeof excludes) => {
    setExcludes((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const handleScan = () => {
    onStartScan(scopePath, currentWsRoot);
  };

  return (
    <div className="flex items-center justify-center min-h-[calc(100vh-44px)] p-6 bg-dsh-base select-none">
      <div className="w-full max-w-xl bg-dsh-layer1 border border-dsh-border2 rounded-lg shadow-2xl p-7">
        {/* Header */}
        <div className="flex items-center justify-between pb-5 mb-5 border-b border-dsh-border1">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-md bg-dsh-blue-tint border border-dsh-blue-border flex items-center justify-center text-dsh-blue">
              <Compass className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-semibold text-dsh-primary">
                代码图谱与流程分析
              </h2>
              <p className="text-[12px] text-dsh-tertiary">
                本地离线解析 · 双模型架构流 · 毫秒级增量同步
              </p>
            </div>
          </div>

          {hasExistingGraph && onCancel && (
            <button
              onClick={onCancel}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-transparent hover:bg-dsh-layer2 border border-dsh-border3 text-dsh-secondary hover:text-dsh-primary text-xs font-medium transition-colors"
              title="返回已分析图谱，不重新扫描"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              <span>返回图谱</span>
            </button>
          )}
        </div>

        {/* Workspace directory */}
        <div className="mb-5 p-3.5 rounded-md bg-dsh-platform border border-dsh-border1">
          <div className="flex items-center justify-between mb-1.5">
            <div className="flex items-center gap-2">
              <span className="text-[12px] font-medium text-dsh-secondary">分析工程根目录</span>
              <span className="text-[11px] px-2 py-0.5 rounded-full bg-dsh-green-tint text-dsh-green border border-dsh-green-border flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-dsh-green"></span>
                已自动匹配工作区
              </span>
            </div>
            <button
              onClick={() => setIsEditingWs(!isEditingWs)}
              className="text-[12px] text-dsh-blue hover:text-dsh-blue-hover flex items-center gap-1 transition-colors"
            >
              {isEditingWs ? <Check className="w-3.5 h-3.5" /> : <Edit2 className="w-3 h-3" />}
              {isEditingWs ? '完成' : '修改路径'}
            </button>
          </div>

          {isEditingWs ? (
            <div className="mt-2">
              <input
                type="text"
                value={currentWsRoot}
                onChange={(e) => setCurrentWsRoot(e.target.value)}
                placeholder="输入目标工程绝对路径"
                className="w-full px-3 py-1.5 bg-dsh-base border border-dsh-blue-border rounded-md text-[12px] font-mono text-dsh-primary focus:outline-none focus:border-dsh-blue"
              />
            </div>
          ) : (
            <div className="text-[12px] font-mono text-dsh-secondary break-all select-all py-0.5">
              {currentWsRoot || '正在探测工作区...'}
            </div>
          )}
        </div>

        {/* Scope path input */}
        <div className="mb-5">
          <div className="flex items-center justify-between mb-1.5">
            <label className="text-[13px] font-medium text-dsh-primary">
              扫描范围 (子目录)
            </label>
            <span className="text-[11px] text-dsh-dimmed font-mono">
              {currentWsRoot ? `${currentWsRoot}${scopePath === '.' ? '' : `/${scopePath}`}` : '...'}
            </span>
          </div>
          <div className="relative flex items-center">
            <Folder className="w-4 h-4 text-dsh-tertiary absolute left-3 pointer-events-none" />
            <input
              type="text"
              value={scopePath}
              onChange={(e) => setScopePath(e.target.value)}
              placeholder="默认为根目录 . ，也可指定如 ./src 或 ./backend"
              className="w-full pl-9 pr-3 py-2 bg-dsh-platform border border-dsh-border2 focus:border-dsh-blue focus:outline-none rounded-md text-[13px] font-mono text-dsh-primary placeholder-dsh-dimmed transition-colors"
            />
          </div>
          <p className="text-[11px] text-dsh-dimmed mt-1.5">
            输入 <code className="text-dsh-secondary font-mono">.</code> 将对工作区全量分析；也可输入如 <code className="text-dsh-secondary font-mono">./src</code> 聚焦子模块。
          </p>
        </div>

        {/* Exclude chips */}
        <div className="mb-6">
          <label className="block text-[13px] font-medium text-dsh-primary mb-2">
            默认排除规则
          </label>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            {[
              { key: 'nodeModules' as const, label: 'node_modules' },
              { key: 'git' as const, label: '.git' },
              { key: 'venv' as const, label: 'venv / __pycache__' },
              { key: 'dist' as const, label: 'dist / build' },
              { key: 'tests' as const, label: 'tests (单元测试)' },
            ].map(({ key, label }) => {
              const isChecked = excludes[key];
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => toggleExclude(key)}
                  className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-[12px] font-medium transition-all ${
                    isChecked
                      ? 'bg-dsh-blue-tint border border-dsh-blue-border text-dsh-blue'
                      : 'bg-dsh-platform border border-dsh-border1 text-dsh-tertiary hover:text-dsh-secondary'
                  }`}
                >
                  <span className={`w-3.5 h-3.5 rounded flex items-center justify-center border text-[9px] ${
                    isChecked ? 'border-dsh-blue bg-dsh-blue text-white' : 'border-dsh-border3'
                  }`}>
                    {isChecked && <Check className="w-2.5 h-2.5 stroke-[3]" />}
                  </span>
                  <span>{label}</span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Action Button */}
        <div className="flex items-center justify-between pt-4 border-t border-dsh-border1">
          <div className="flex items-center gap-1.5 text-[12px] text-dsh-tertiary">
            <CheckCircle2 className="w-4 h-4 text-dsh-green" />
            <span>本地离线静态解析 · 0 Token 消耗</span>
          </div>

          <div className="flex items-center gap-2">
            {hasExistingGraph && onCancel && (
              <button
                type="button"
                onClick={onCancel}
                disabled={isLoading}
                className="px-3.5 py-1.5 rounded-md border border-dsh-border3 hover:bg-dsh-layer2 text-dsh-secondary hover:text-dsh-primary text-[13px] font-medium transition-colors"
              >
                取消
              </button>
            )}

            <button
              onClick={handleScan}
              disabled={isLoading || !currentWsRoot}
              className={`flex items-center gap-1.5 px-4 py-1.5 rounded-md text-[13px] font-medium transition-all ${
                isLoading || !currentWsRoot
                  ? 'bg-dsh-layer3 text-dsh-dimmed cursor-not-allowed'
                  : 'bg-dsh-blue hover:bg-dsh-blue-hover text-white active:bg-dsh-blue-active shadow-sm'
              }`}
            >
              {isLoading ? (
                <>
                  <div className="w-3.5 h-3.5 border-2 border-white/20 border-t-white rounded-full animate-spin" />
                  <span>正在解析 AST 拓扑...</span>
                </>
              ) : (
                <>
                  <Play className="w-3.5 h-3.5 fill-current" />
                  <span>开始扫描</span>
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
