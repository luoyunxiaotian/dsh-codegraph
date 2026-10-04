import React, { useState, useEffect } from 'react';
import {
  Compass,
  Folder,
  Play,
  Check,
  Edit2,
  ArrowLeft,
  CheckCircle2,
  AlertTriangle,
  Sparkles,
  Smartphone,
  Monitor,
  Globe,
  Server,
  Wrench,
  Layers,
  RefreshCw,
} from 'lucide-react';
import {
  ProjectPlatform,
  WorkspaceDiscoveryResult,
} from '../../../core/src/types/index.js';

interface SetupViewProps {
  workspaceRoot: string;
  onStartScan: (
    scopePath: string,
    customWorkspace?: string,
    selectedProjectIds?: string[]
  ) => Promise<void>;
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

  // 动态多端与多工程嗅探状态
  const [discovery, setDiscovery] = useState<WorkspaceDiscoveryResult | null>(null);
  const [isDiscovering, setIsDiscovering] = useState<boolean>(false);
  const [selectedProjectIds, setSelectedProjectIds] = useState<string[]>([]);

  useEffect(() => {
    setCurrentWsRoot(workspaceRoot);
  }, [workspaceRoot]);

  // 当工作区路径变更时，自动发起快速工程画像嗅探
  useEffect(() => {
    let isMounted = true;
    const fetchDiscovery = async () => {
      if (!currentWsRoot) return;
      setIsDiscovering(true);
      try {
        const res = await fetch(`/api/discover?workspace=${encodeURIComponent(currentWsRoot)}`);
        const data: WorkspaceDiscoveryResult = await res.json();
        if (isMounted) {
          setDiscovery(data);
          if (data.projects && data.projects.length > 0) {
            const rec = data.projects.filter((p) => p.isRecommended).map((p) => p.id);
            setSelectedProjectIds(rec.length > 0 ? rec : data.projects.map((p) => p.id));
          } else {
            setSelectedProjectIds([]);
          }
        }
      } catch (err) {
        console.warn('工程画像嗅探失败:', err);
      } finally {
        if (isMounted) setIsDiscovering(false);
      }
    };

    fetchDiscovery();
    return () => {
      isMounted = false;
    };
  }, [currentWsRoot]);

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

  const toggleProject = (id: string) => {
    setSelectedProjectIds((prev) =>
      prev.includes(id) ? prev.filter((i) => i !== id) : [...prev, id]
    );
  };

  const selectPreset = (type: 'recommended' | 'clients' | 'backend' | 'all') => {
    if (!discovery?.projects) return;
    if (type === 'recommended') {
      const rec = discovery.projects.filter((p) => p.isRecommended).map((p) => p.id);
      setSelectedProjectIds(rec.length > 0 ? rec : discovery.projects.map((p) => p.id));
    } else if (type === 'clients') {
      setSelectedProjectIds(
        discovery.projects
          .filter(
            (p) =>
              p.platform.startsWith('MOBILE_') ||
              p.platform.startsWith('DESKTOP_') ||
              p.platform === 'WEB_FRONTEND'
          )
          .map((p) => p.id)
      );
    } else if (type === 'backend') {
      setSelectedProjectIds(
        discovery.projects.filter((p) => p.platform === 'BACKEND_SERVICE').map((p) => p.id)
      );
    } else if (type === 'all') {
      setSelectedProjectIds(discovery.projects.map((p) => p.id));
    }
  };

  const handleScan = () => {
    if (discovery?.hasDangerousRoot) return;
    onStartScan(scopePath, currentWsRoot, selectedProjectIds);
  };

  const getPlatformIcon = (p: ProjectPlatform) => {
    switch (p) {
      case 'MOBILE_ANDROID':
      case 'MOBILE_IOS':
        return <Smartphone className="w-3.5 h-3.5 text-emerald-400" />;
      case 'DESKTOP_CPP':
      case 'DESKTOP_PYTHON':
      case 'DESKTOP_ELECTRON':
        return <Monitor className="w-3.5 h-3.5 text-sky-400" />;
      case 'WEB_FRONTEND':
        return <Globe className="w-3.5 h-3.5 text-blue-400" />;
      case 'BACKEND_SERVICE':
        return <Server className="w-3.5 h-3.5 text-indigo-400" />;
      case 'TOOL_SCRIPT':
        return <Wrench className="w-3.5 h-3.5 text-amber-400" />;
      default:
        return <Layers className="w-3.5 h-3.5 text-dsh-tertiary" />;
    }
  };

  const getPlatformBadge = (p: ProjectPlatform) => {
    switch (p) {
      case 'MOBILE_ANDROID':
        return { label: 'Android 移动端', cls: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' };
      case 'MOBILE_IOS':
        return { label: 'iOS 移动端', cls: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' };
      case 'DESKTOP_CPP':
        return { label: 'PC 桌面端 (C++)', cls: 'bg-sky-500/10 text-sky-400 border-sky-500/20' };
      case 'DESKTOP_PYTHON':
        return { label: 'PC 桌面端 (Python)', cls: 'bg-amber-500/10 text-amber-400 border-amber-500/20' };
      case 'DESKTOP_ELECTRON':
        return { label: 'PC 桌面端 (Electron)', cls: 'bg-cyan-500/10 text-cyan-400 border-cyan-500/20' };
      case 'WEB_FRONTEND':
        return { label: 'Web 前端', cls: 'bg-blue-500/10 text-blue-400 border-blue-500/20' };
      case 'BACKEND_SERVICE':
        return { label: '后端微服务', cls: 'bg-indigo-500/10 text-indigo-400 border-indigo-500/20' };
      case 'TOOL_SCRIPT':
        return { label: '辅助工具/脚本', cls: 'bg-zinc-500/10 text-zinc-400 border-zinc-500/20' };
      default:
        return { label: '子工程', cls: 'bg-dsh-layer2 text-dsh-secondary border-dsh-border1' };
    }
  };

  const hasDangerous = Boolean(discovery?.hasDangerousRoot);
  const isMultiProject = Boolean(discovery?.projects && discovery.projects.length > 1);

  return (
    <div className="w-full h-full min-h-0 flex items-center justify-center p-6 bg-dsh-base select-none overflow-y-auto">
      <div className="w-full max-w-2xl bg-dsh-layer1 border border-dsh-border2 rounded-lg shadow-2xl p-7 my-auto">
        {/* Header */}
        <div className="flex items-center justify-between pb-5 mb-5 border-b border-dsh-border1">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-md bg-dsh-blue-tint border border-dsh-blue-border flex items-center justify-center text-dsh-blue">
              <Compass className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-semibold text-dsh-primary">
                代码图谱与多端生态分析
              </h2>
              <p className="text-[12px] text-dsh-tertiary">
                本地离线解析 · 多端协同总览 · 毫秒级单工程聚焦 · 0-Token消耗
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

        {/* 危险系统目录硬拦截警告 */}
        {hasDangerous && (
          <div className="mb-5 p-3.5 rounded-md bg-red-500/10 border border-red-500/30 text-red-400 text-xs">
            <div className="font-semibold flex items-center gap-1.5 mb-1 text-red-300">
              <AlertTriangle className="w-4 h-4 text-red-400" />
              <span>系统敏感目录安全拦截</span>
            </div>
            <p className="leading-relaxed">
              {discovery?.dangerousRootReason ||
                '所选路径属于系统盘根目录或受保护操作系统目录。为防止遍历全盘导致资源耗尽，拒绝全盘扫描。请点击下方“修改路径”指定具体的开发项目文件夹。'}
            </p>
          </div>
        )}

        {/* Workspace directory */}
        <div className="mb-5 p-3.5 rounded-md bg-dsh-platform border border-dsh-border1">
          <div className="flex items-center justify-between mb-1.5">
            <div className="flex items-center gap-2">
              <span className="text-[12px] font-medium text-dsh-secondary">分析工程根目录</span>
              {!hasDangerous && (
                <span className="text-[11px] px-2 py-0.5 rounded-full bg-dsh-green-tint text-dsh-green border border-dsh-green-border flex items-center gap-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-dsh-green"></span>
                  已自动匹配工作区
                </span>
              )}
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

        {/* 多工程与多端智能识别与范围确认面板 */}
        {isMultiProject && (
          <div className="mb-5 p-3.5 rounded-md bg-dsh-platform border border-dsh-border2">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <span className="text-[13px] font-semibold text-dsh-primary flex items-center gap-1.5">
                  <Layers className="w-4 h-4 text-dsh-blue" />
                  <span>嗅探到多端与多工程生态 ({discovery?.projects.length} 个端/版本)</span>
                </span>
                {isDiscovering && <RefreshCw className="w-3.5 h-3.5 text-dsh-blue animate-spin" />}
              </div>

              {/* 快捷预设 */}
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => selectPreset('recommended')}
                  className="flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-medium bg-dsh-blue-tint border border-dsh-blue-border text-dsh-blue hover:bg-dsh-blue/20 transition-colors"
                  title="自动组合各平台最新主力活跃工程"
                >
                  <Sparkles className="w-3 h-3" />
                  <span>⭐ 全端协同生态</span>
                </button>
                <button
                  type="button"
                  onClick={() => selectPreset('clients')}
                  className="px-1.5 py-0.5 rounded text-[11px] bg-dsh-layer2 hover:bg-dsh-layer3 text-dsh-secondary hover:text-dsh-primary border border-dsh-border1 transition-colors"
                >
                  仅客户端
                </button>
                <button
                  type="button"
                  onClick={() => selectPreset('backend')}
                  className="px-1.5 py-0.5 rounded text-[11px] bg-dsh-layer2 hover:bg-dsh-layer3 text-dsh-secondary hover:text-dsh-primary border border-dsh-border1 transition-colors"
                >
                  仅后端
                </button>
                <button
                  type="button"
                  onClick={() => selectPreset('all')}
                  className="px-1.5 py-0.5 rounded text-[11px] bg-dsh-layer2 hover:bg-dsh-layer3 text-dsh-secondary hover:text-dsh-primary border border-dsh-border1 transition-colors"
                >
                  全选
                </button>
              </div>
            </div>

            <p className="text-[11px] text-dsh-tertiary mb-3">
              已为您自动区分移动端、桌面端、Web端及各版本。勾选要纳入协同总览的端（历史归档与测试脚本默认备选）：
            </p>

            {/* 项目列表卡片 */}
            <div className="max-h-56 overflow-y-auto space-y-1.5 pr-1">
              {discovery?.projects.map((proj) => {
                const isChecked = selectedProjectIds.includes(proj.id);
                const badge = getPlatformBadge(proj.platform);

                return (
                  <div
                    key={proj.id}
                    onClick={() => toggleProject(proj.id)}
                    className={`p-2.5 rounded-md border transition-all cursor-pointer flex items-center justify-between gap-3 ${
                      isChecked
                        ? 'bg-dsh-layer1 border-dsh-blue/60 shadow-sm'
                        : 'bg-dsh-platform/40 border-dsh-border1 opacity-50 hover:opacity-90'
                    }`}
                  >
                    <div className="flex items-center gap-2.5 min-w-0">
                      <div
                        className={`w-4 h-4 rounded border flex items-center justify-center shrink-0 transition-colors ${
                          isChecked
                            ? 'bg-dsh-blue border-dsh-blue text-white'
                            : 'border-dsh-border3 bg-transparent'
                        }`}
                      >
                        {isChecked && <Check className="w-3 h-3 stroke-[3]" />}
                      </div>

                      <div className="truncate">
                        <div className="flex items-center gap-1.5">
                          {getPlatformIcon(proj.platform)}
                          <span className="text-[12px] font-semibold text-dsh-primary truncate font-mono">
                            {proj.name}
                          </span>
                          {proj.versionString && (
                            <span className="text-[10px] px-1 py-0.2 rounded font-mono font-medium bg-dsh-layer2 text-dsh-blue border border-dsh-blue-border">
                              {proj.versionString}
                            </span>
                          )}
                          <span className={`text-[10px] px-1.5 py-0.2 rounded border font-medium ${badge.cls}`}>
                            {badge.label}
                          </span>
                        </div>
                        <div className="text-[10px] text-dsh-dimmed font-mono truncate">
                          {proj.relPath} · {proj.primaryLanguage} · {proj.fileCount} 文件
                        </div>
                      </div>
                    </div>

                    <div className="shrink-0 flex items-center gap-2">
                      <span
                        className={`text-[10px] px-2 py-0.5 rounded border font-medium ${
                          proj.isRecommended
                            ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30'
                            : 'bg-zinc-500/10 text-zinc-400 border-zinc-500/30'
                        }`}
                        title={proj.recommendReason}
                      >
                        {proj.isRecommended ? '⭐ 主力推荐' : '归档/备选'}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Scope path input (单工程模式时展示详细子目录输入) */}
        {!isMultiProject && (
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
        )}

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
                  <span
                    className={`w-3.5 h-3.5 rounded flex items-center justify-center border text-[9px] ${
                      isChecked ? 'border-dsh-blue bg-dsh-blue text-white' : 'border-dsh-border3'
                    }`}
                  >
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
              disabled={isLoading || !currentWsRoot || hasDangerous || (isMultiProject && selectedProjectIds.length === 0)}
              className={`flex items-center gap-1.5 px-4 py-1.5 rounded-md text-[13px] font-medium transition-all ${
                isLoading || !currentWsRoot || hasDangerous || (isMultiProject && selectedProjectIds.length === 0)
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
                  <span>开始扫描 {isMultiProject ? `(${selectedProjectIds.length} 个端)` : ''}</span>
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
