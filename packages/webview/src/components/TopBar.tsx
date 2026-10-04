import React from 'react';
import {
  Layers,
  GitBranch,
  Search,
  RefreshCw,
  Zap,
  SlidersHorizontal,
  ChevronRight,
  CheckCircle2,
  AlertTriangle,
  Sun,
  Moon,
  ExternalLink,
  FolderTree,
} from 'lucide-react';
import { ArchetypeType, DetectedProjectProfile, ProjectPlatform } from '../../../core/src/types/index.js';
import { useTheme } from '../context/ThemeContext.js';

interface TopBarProps {
  projectName: string;
  scopePath: string;
  currentView: 'architecture' | 'flow' | 'drilldown';
  onViewChange: (view: 'architecture' | 'flow' | 'drilldown') => void;
  archetype: ArchetypeType;
  isAutoCorrected?: boolean;
  healthScore?: number;
  onArchetypeChange: (arch: ArchetypeType) => void;
  onIncrementalUpdate: () => void;
  onFullRescan: () => void;
  onReset: () => void;
  isUpdating: boolean;
  selectedModuleName?: string | null;
  cacheTime?: string | null;
  languages?: Record<string, number>;
  projects?: DetectedProjectProfile[];
  activeProjectId?: string;
  onSwitchProject?: (projectId?: string) => void;
  onOpenScopeDrawer?: () => void;
}

export const TopBar: React.FC<TopBarProps> = ({
  projectName,
  scopePath,
  currentView,
  onViewChange,
  archetype,
  isAutoCorrected,
  healthScore,
  onArchetypeChange,
  onIncrementalUpdate,
  onFullRescan,
  onReset,
  isUpdating,
  selectedModuleName,
  cacheTime,
  languages,
  projects,
  activeProjectId,
  onSwitchProject,
  onOpenScopeDrawer,
}) => {
  const { theme, toggleTheme } = useTheme();

  const getPlatformEmoji = (p: ProjectPlatform) => {
    switch (p) {
      case 'MOBILE_ANDROID': return '📱';
      case 'MOBILE_IOS': return '🍏';
      case 'DESKTOP_CPP': return '💻';
      case 'DESKTOP_PYTHON': return '🐍';
      case 'DESKTOP_ELECTRON': return '⚡';
      case 'WEB_FRONTEND': return '🌐';
      case 'BACKEND_SERVICE': return '⚙️';
      case 'TOOL_SCRIPT': return '🔧';
      default: return '📦';
    }
  };

  const langEntries = languages ? Object.entries(languages) : [];
  const displayLangs = langEntries.slice(0, 3);
  const remainingLangsCount = langEntries.length - 3;

  const getLangBadgeColor = (l: string) => {
    switch (l) {
      case 'python': return 'bg-yellow-500/10 text-yellow-500 border-yellow-500/30';
      case 'typescript': return 'bg-blue-500/10 text-blue-400 border-blue-500/30';
      case 'javascript': return 'bg-amber-500/10 text-amber-400 border-amber-500/30';
      case 'go': return 'bg-cyan-500/10 text-cyan-400 border-cyan-500/30';
      case 'java': return 'bg-orange-500/10 text-orange-400 border-orange-500/30';
      case 'rust': return 'bg-red-500/10 text-red-400 border-red-500/30';
      case 'cpp':
      case 'c': return 'bg-sky-500/10 text-sky-400 border-sky-500/30';
      case 'csharp': return 'bg-purple-500/10 text-purple-400 border-purple-500/30';
      default: return 'bg-dsh-layer2 text-dsh-tertiary border-dsh-border1';
    }
  };

  return (
    <header className="h-14 bg-dsh-base border-b border-dsh-border2 flex items-center justify-between px-4 z-20 shrink-0 select-none overflow-x-auto gap-4">
      {/* 1. Left: Brand, Project Title & Breadcrumb */}
      <div className="flex items-center gap-3 shrink-0">
        {/* DeepSeek Harness Style Logo Badge */}
        <div className="w-7 h-7 rounded-lg bg-dsh-blue-tint border border-dsh-blue-border flex items-center justify-center text-dsh-blue font-bold text-xs shadow-sm">
          CG
        </div>

        <div className="flex items-center gap-2">
          <span className="text-[15px] font-bold text-dsh-primary tracking-tight">
            {projectName}
          </span>

          <span className="text-[12px] text-dsh-tertiary px-2 py-0.5 rounded-md bg-dsh-platform border border-dsh-border1 font-mono">
            {scopePath === '.' ? '根目录' : scopePath}
          </span>

          {cacheTime && (
            <span
              className="text-[12px] text-dsh-tertiary px-2 py-0.5 rounded-md bg-dsh-platform border border-dsh-border1 font-mono flex items-center gap-1.5"
              title="图谱已加载自本地工程缓存 (.codegraph/)"
            >
              <span className="w-1.5 h-1.5 rounded-full bg-dsh-blue inline-block"></span>
              <span>本地缓存 {cacheTime}</span>
            </span>
          )}

          {langEntries.length > 0 && (
            <div className="flex items-center gap-1.5 ml-1">
              {displayLangs.map(([lang, count]) => (
                <span
                  key={lang}
                  className={`text-[11px] px-2 py-0.5 rounded-md border font-mono font-medium ${getLangBadgeColor(lang)}`}
                  title={`${lang}: ${count} 个符号`}
                >
                  {lang.toUpperCase()} {count}
                </span>
              ))}
              {remainingLangsCount > 0 && (
                <span
                  className="text-[11px] px-1.5 py-0.5 rounded-md border font-mono bg-dsh-layer2 text-dsh-tertiary border-dsh-border1 cursor-help"
                  title={langEntries.slice(3).map(([l, c]) => `${l}: ${c}`).join(', ')}
                >
                  +{remainingLangsCount}
                </span>
              )}
            </div>
          )}

          {currentView === 'drilldown' && selectedModuleName && (
            <div className="flex items-center text-[13px] text-dsh-tertiary ml-1.5">
              <ChevronRight className="w-4 h-4 mx-0.5 text-dsh-dimmed" />
              <button
                onClick={() => onViewChange('architecture')}
                className="hover:text-dsh-primary transition-colors text-dsh-tertiary font-medium"
              >
                架构
              </button>
              <ChevronRight className="w-4 h-4 mx-0.5 text-dsh-dimmed" />
              <span className="text-dsh-blue font-semibold">{selectedModuleName}</span>
            </div>
          )}
        </div>
      </div>

      {/* 2. Center: DeepSeek Harness Segmented Control & Scope Switcher */}
      <div className="flex items-center gap-3 shrink-0">
        <div className="flex items-center p-0.5 rounded-lg bg-dsh-platform border border-dsh-border1">
          <button
            onClick={() => onViewChange('architecture')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[13px] font-medium transition-all ${
              currentView === 'architecture'
                ? 'bg-dsh-layer2 border border-dsh-border2 text-dsh-primary shadow-sm font-semibold'
                : 'text-dsh-tertiary hover:text-dsh-primary'
            }`}
          >
            <Layers className="w-4 h-4" />
            <span>宏观架构</span>
          </button>

          <button
            onClick={() => onViewChange('flow')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[13px] font-medium transition-all ${
              currentView === 'flow'
                ? 'bg-dsh-layer2 border border-dsh-border2 text-dsh-primary shadow-sm font-semibold'
                : 'text-dsh-tertiary hover:text-dsh-primary'
            }`}
          >
            <GitBranch className="w-4 h-4" />
            <span>业务时序流</span>
          </button>

          {selectedModuleName && (
            <button
              onClick={() => onViewChange('drilldown')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[13px] font-medium transition-all ${
                currentView === 'drilldown'
                  ? 'bg-dsh-layer2 border border-dsh-border2 text-dsh-primary shadow-sm font-semibold'
                  : 'text-dsh-tertiary hover:text-dsh-primary'
              }`}
            >
              <Search className="w-4 h-4" />
              <span>模块下钻</span>
            </button>
          )}
        </div>

        {/* Project & Scope Switcher */}
        {projects && projects.length > 1 && (
          <div className="flex items-center gap-1.5">
            <div className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-dsh-platform border border-dsh-border1 text-[13px]">
              <span className="text-[12px] text-dsh-tertiary font-medium">作用域:</span>
              <select
                value={activeProjectId || 'all'}
                onChange={(e) => onSwitchProject?.(e.target.value === 'all' ? undefined : e.target.value)}
                className="bg-transparent text-dsh-primary focus:outline-none cursor-pointer text-[13px] font-semibold max-w-[200px] truncate"
                title="在全生态协同总览与单工程独立视图间毫秒级切换"
              >
                <option value="all" className="bg-dsh-layer1 text-dsh-primary font-medium">
                  🌐 全生态协同总览 ({projects.length} 个端)
                </option>
                {projects.map((p) => (
                  <option key={p.id} value={p.id} className="bg-dsh-layer1 text-dsh-primary font-medium">
                    {getPlatformEmoji(p.platform)} {p.name} {p.versionString ? `(${p.versionString})` : ''}
                  </option>
                ))}
              </select>
            </div>

            <button
              onClick={onOpenScopeDrawer}
              className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-dsh-layer1 hover:bg-dsh-layer2 border border-dsh-border2 text-[12px] text-dsh-secondary hover:text-dsh-primary transition-colors"
              title="自定义管理要纳入分析的多端与版本范围"
            >
              <FolderTree className="w-4 h-4 text-dsh-blue" />
              <span>端与版本范围</span>
            </button>
          </div>
        )}
      </div>

      {/* 3. Right: Archetype selector, Health score & DSH Action Buttons */}
      <div className="flex items-center gap-2 shrink-0">
        {/* Archetype & Health Indicator */}
        <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-dsh-platform border border-dsh-border1 text-[13px]">
          {isAutoCorrected ? (
            <span className="flex items-center gap-1 text-dsh-amber text-[12px] font-medium" title="检测到调用倒挂或偏离，已自动纠错回退至真实拓扑">
              <AlertTriangle className="w-4 h-4 text-dsh-amber" />
              <span>已纠错</span>
            </span>
          ) : (
            <span className="flex items-center gap-1 text-dsh-green text-[12px] font-medium" title="装配后一致性审计通过">
              <CheckCircle2 className="w-4 h-4 text-dsh-green" />
              <span className="font-mono">H={healthScore ?? 1.0}</span>
            </span>
          )}

          <div className="h-3.5 w-[1px] bg-dsh-border2" />

          <select
            value={archetype}
            onChange={(e) => onArchetypeChange(e.target.value as ArchetypeType)}
            className="bg-transparent text-dsh-secondary hover:text-dsh-primary focus:outline-none cursor-pointer text-[13px] font-medium"
          >
            <option value="UNIVERSAL" className="bg-dsh-layer1 text-dsh-primary">自适应真实拓扑 (通用)</option>
            <option value="WEB_LAYERED" className="bg-dsh-layer1 text-dsh-primary">Web 分层架构</option>
            <option value="WORKER_PIPELINE" className="bg-dsh-layer1 text-dsh-primary">异步任务队列</option>
            <option value="CLI_PIPELINE" className="bg-dsh-layer1 text-dsh-primary">CLI 数据管道</option>
          </select>
        </div>

        {/* Action Buttons */}
        <button
          onClick={onIncrementalUpdate}
          disabled={isUpdating}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-dsh-layer1 hover:bg-dsh-layer2 border border-dsh-border2 text-[13px] text-dsh-secondary hover:text-dsh-primary transition-colors disabled:opacity-40 font-medium"
          title="毫秒级热同步当前代码编辑改动"
        >
          <Zap className={`w-4 h-4 text-dsh-blue ${isUpdating ? 'animate-pulse' : ''}`} />
          <span>增量更新</span>
        </button>

        <button
          onClick={onFullRescan}
          disabled={isUpdating}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-dsh-layer1 hover:bg-dsh-layer2 border border-dsh-border2 text-[13px] text-dsh-secondary hover:text-dsh-primary transition-colors disabled:opacity-40 font-medium"
          title="重新执行全量解析"
        >
          <RefreshCw className={`w-4 h-4 text-dsh-tertiary ${isUpdating ? 'animate-spin' : ''}`} />
          <span>重扫</span>
        </button>

        <button
          onClick={onReset}
          className="p-2 rounded-lg text-dsh-secondary hover:text-dsh-primary hover:bg-dsh-layer2 transition-colors border border-transparent hover:border-dsh-border2"
          title="切换分析目录 / 重新配置"
        >
          <SlidersHorizontal className="w-4 h-4" />
        </button>

        <button
          onClick={toggleTheme}
          className="p-2 rounded-lg text-dsh-secondary hover:text-dsh-primary hover:bg-dsh-layer2 transition-colors border border-transparent hover:border-dsh-border2"
          title={theme === 'dark' ? '当前: 深色主题 (点击切换为浅色)' : '当前: 浅色主题 (点击切换为深色)'}
        >
          {theme === 'dark' ? (
            <Sun className="w-4 h-4 text-amber-400" />
          ) : (
            <Moon className="w-4 h-4 text-dsh-blue" />
          )}
        </button>

        <button
          onClick={() => window.open(window.location.href, '_blank')}
          className="p-2 rounded-lg text-dsh-secondary hover:text-dsh-primary hover:bg-dsh-layer2 transition-colors border border-transparent hover:border-dsh-border2"
          title="在独立浏览器视窗中全屏打开"
        >
          <ExternalLink className="w-4 h-4" />
        </button>
      </div>
    </header>
  );
};
