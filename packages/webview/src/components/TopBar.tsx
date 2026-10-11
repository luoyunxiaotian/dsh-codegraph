import React, { useState, useRef, useEffect } from 'react';
import {
  Layers,
  GitBranch,
  Search,
  RefreshCw,
  Zap,
  SlidersHorizontal,
  ChevronRight,
  ChevronDown,
  CheckCircle2,
  AlertTriangle,
  Sun,
  Moon,
  ExternalLink,
  FolderTree,
  Download,
  MoreHorizontal,
} from 'lucide-react';
import { ArchetypeType, DetectedProjectProfile, ProjectPlatform } from '../../../core/src/types/index.js';
import { UpdateCheckResult } from '../../../core/src/updater/types.js';
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
  updateInfo?: UpdateCheckResult | null;
  onOpenUpdateModal?: () => void;
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
  updateInfo,
  onOpenUpdateModal,
}) => {
  const { theme, toggleTheme } = useTheme();
  const [isMoreMenuOpen, setIsMoreMenuOpen] = useState(false);
  const [isLangMenuOpen, setIsLangMenuOpen] = useState(false);
  const moreMenuRef = useRef<HTMLDivElement>(null);
  const langMenuRef = useRef<HTMLDivElement>(null);

  // 监听外部点击与 ESC 快捷键自动收起浮层菜单
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (moreMenuRef.current && !moreMenuRef.current.contains(e.target as Node)) {
        setIsMoreMenuOpen(false);
      }
      if (langMenuRef.current && !langMenuRef.current.contains(e.target as Node)) {
        setIsLangMenuOpen(false);
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setIsMoreMenuOpen(false);
        setIsLangMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, []);

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
  const primaryLang = langEntries[0];

  const getLangBadgeColor = (l: string) => {
    switch (l.toLowerCase()) {
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
    <header className="h-14 bg-dsh-base border-b border-dsh-border2 flex items-center justify-between px-3 md:px-4 z-30 shrink-0 select-none gap-2 md:gap-4 overflow-visible relative">
      {/* ========================================================================= */}
      {/* 1. Left: Brand Logo, Project Name, Scope & Compact Language Capsule       */}
      {/* ========================================================================= */}
      <div className="flex items-center gap-2 md:gap-2.5 min-w-0 shrink">
        {/* DeepSeek Harness Style Logo Badge */}
        <div className="w-7 h-7 rounded-lg bg-dsh-blue-tint border border-dsh-blue-border flex items-center justify-center text-dsh-blue font-bold text-xs shadow-sm shrink-0">
          CG
        </div>

        <div className="flex items-center gap-1.5 md:gap-2 min-w-0">
          <span
            className="text-[14px] md:text-[15px] font-bold text-dsh-primary tracking-tight truncate max-w-[110px] sm:max-w-[150px] md:max-w-[200px] lg:max-w-[260px]"
            title={projectName}
          >
            {projectName}
          </span>

          {/* 路径与缓存状态胶囊 (窄屏自适应隐藏冗余文本) */}
          <span
            className="text-[11px] text-dsh-tertiary px-2 py-0.5 rounded-md bg-dsh-platform border border-dsh-border1 font-mono shrink-0 hidden sm:inline-flex items-center gap-1"
            title={`分析范围: ${scopePath}${cacheTime ? ` | 本地缓存时间: ${cacheTime}` : ''}`}
          >
            <span>{scopePath === '.' ? '根目录' : scopePath}</span>
            {cacheTime && <span className="w-1.5 h-1.5 rounded-full bg-dsh-blue inline-block" />}
          </span>

          {/* 聚合多语言展示胶囊 (Hover / 点击展开符号统计，节省 ~160px) */}
          {langEntries.length > 0 && (
            <div className="relative shrink-0" ref={langMenuRef}>
              <button
                onClick={() => setIsLangMenuOpen((prev) => !prev)}
                title="点击查看工程语言与符号统计分布"
                className="flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-md border font-mono bg-dsh-platform hover:bg-dsh-layer2 text-dsh-secondary border-dsh-border1 transition-colors"
              >
                <span className="font-semibold text-dsh-blue">
                  {primaryLang[0].toUpperCase()}
                </span>
                {langEntries.length > 1 && (
                  <span className="text-dsh-tertiary text-[10px]">
                    +{langEntries.length - 1}语
                  </span>
                )}
                <ChevronDown
                  className={`w-3 h-3 text-dsh-dimmed transition-transform duration-150 ${
                    isLangMenuOpen ? 'rotate-180' : ''
                  }`}
                />
              </button>

              {isLangMenuOpen && (
                <div className="absolute left-0 top-full mt-1.5 z-50 p-2.5 rounded-xl bg-dsh-layer1/98 backdrop-blur-md border border-dsh-border2 shadow-2xl min-w-[190px] animate-in fade-in zoom-in-95 duration-150">
                  <div className="text-[11px] font-semibold text-dsh-tertiary uppercase tracking-wider mb-2 px-1">
                    代码语言与符号分布
                  </div>
                  <div className="flex flex-col gap-1 max-h-56 overflow-y-auto">
                    {langEntries.map(([lang, count]) => (
                      <div
                        key={lang}
                        className="flex items-center justify-between px-2 py-1 rounded bg-dsh-platform/50 text-[12px] font-mono"
                      >
                        <span className={`px-1.5 py-0.5 rounded text-[10px] border font-semibold ${getLangBadgeColor(lang)}`}>
                          {lang.toUpperCase()}
                        </span>
                        <span className="text-dsh-secondary font-medium">{count} 符号</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* 模块下钻面包屑 (模块下钻视图激活时展示) */}
          {currentView === 'drilldown' && selectedModuleName && (
            <div className="flex items-center text-[12px] md:text-[13px] text-dsh-tertiary min-w-0 shrink">
              <ChevronRight className="w-3.5 h-3.5 mx-0.5 text-dsh-dimmed shrink-0" />
              <button
                onClick={() => onViewChange('architecture')}
                className="hover:text-dsh-primary transition-colors text-dsh-tertiary font-medium shrink-0"
              >
                架构
              </button>
              <ChevronRight className="w-3.5 h-3.5 mx-0.5 text-dsh-dimmed shrink-0" />
              <span className="text-dsh-blue font-semibold truncate max-w-[100px] sm:max-w-[140px]" title={selectedModuleName}>
                {selectedModuleName}
              </span>
            </div>
          )}
        </div>
      </div>

      {/* ========================================================================= */}
      {/* 2. Center: Segmented Control (Views) & Multi-Project Ecosystem Dropdown   */}
      {/* ========================================================================= */}
      <div className="flex items-center gap-2 shrink-0">
        <div className="flex items-center p-0.5 rounded-lg bg-dsh-platform border border-dsh-border1">
          <button
            onClick={() => onViewChange('architecture')}
            className={`flex items-center gap-1.5 px-2.5 sm:px-3 py-1.5 rounded-md text-[12px] sm:text-[13px] font-medium transition-all ${
              currentView === 'architecture'
                ? 'bg-dsh-layer2 border border-dsh-border2 text-dsh-primary shadow-sm font-semibold'
                : 'text-dsh-tertiary hover:text-dsh-primary'
            }`}
          >
            <Layers className="w-4 h-4" />
            <span className="hidden sm:inline">宏观架构</span>
            <span className="sm:hidden">架构</span>
          </button>

          <button
            onClick={() => onViewChange('flow')}
            className={`flex items-center gap-1.5 px-2.5 sm:px-3 py-1.5 rounded-md text-[12px] sm:text-[13px] font-medium transition-all ${
              currentView === 'flow'
                ? 'bg-dsh-layer2 border border-dsh-border2 text-dsh-primary shadow-sm font-semibold'
                : 'text-dsh-tertiary hover:text-dsh-primary'
            }`}
          >
            <GitBranch className="w-4 h-4" />
            <span className="hidden sm:inline">业务时序流</span>
            <span className="sm:hidden">时序流</span>
          </button>

          {selectedModuleName && (
            <button
              onClick={() => onViewChange('drilldown')}
              className={`flex items-center gap-1.5 px-2.5 sm:px-3 py-1.5 rounded-md text-[12px] sm:text-[13px] font-medium transition-all ${
                currentView === 'drilldown'
                  ? 'bg-dsh-layer2 border border-dsh-border2 text-dsh-primary shadow-sm font-semibold'
                  : 'text-dsh-tertiary hover:text-dsh-primary'
              }`}
            >
              <Search className="w-4 h-4" />
              <span className="hidden sm:inline">模块下钻</span>
              <span className="sm:hidden">下钻</span>
            </button>
          )}
        </div>

        {/* 多端工程选择器 (当检测到多个子工程时轻量呈现) */}
        {projects && projects.length > 1 && (
          <div className="flex items-center gap-1 px-2 py-1 rounded-lg bg-dsh-platform border border-dsh-border1 text-[12px]">
            <select
              value={activeProjectId || 'all'}
              onChange={(e) => onSwitchProject?.(e.target.value === 'all' ? undefined : e.target.value)}
              className="bg-transparent text-dsh-primary focus:outline-none cursor-pointer text-[12px] font-semibold max-w-[130px] sm:max-w-[180px] truncate"
              title="在全生态协同总览与单工程独立视图间切换"
            >
              <option value="all" className="bg-dsh-layer1 text-dsh-primary font-medium">
                🌐 全生态 ({projects.length}端)
              </option>
              {projects.map((p) => (
                <option key={p.id} value={p.id} className="bg-dsh-layer1 text-dsh-primary font-medium">
                  {getPlatformEmoji(p.platform)} {p.name} {p.versionString ? `(${p.versionString})` : ''}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>

      {/* ========================================================================= */}
      {/* 3. Right: Archetype & Health, Action Buttons, Theme & More Menu           */}
      {/* ========================================================================= */}
      <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
        {/* 架构范式与健康度紧凑胶囊 (合并显示，节省 ~120px) */}
        <div className="flex items-center gap-1.5 px-2 sm:px-2.5 py-1 rounded-lg bg-dsh-platform border border-dsh-border1 text-[12px]">
          {isAutoCorrected ? (
            <span className="flex items-center gap-1 text-dsh-amber font-medium" title="检测到调用倒挂或偏离，已自动纠错回退至真实拓扑">
              <AlertTriangle className="w-3.5 h-3.5 text-dsh-amber shrink-0" />
              <span className="hidden xl:inline text-[11px]">已纠错</span>
            </span>
          ) : (
            <span className="flex items-center gap-1 text-dsh-green font-medium" title="装配后一致性审计通过">
              <CheckCircle2 className="w-3.5 h-3.5 text-dsh-green shrink-0" />
              <span className="font-mono text-[11px]">H={healthScore ?? 1.0}</span>
            </span>
          )}

          <div className="h-3.5 w-[1px] bg-dsh-border2 shrink-0" />

          <select
            value={archetype}
            onChange={(e) => onArchetypeChange(e.target.value as ArchetypeType)}
            className="bg-transparent text-dsh-secondary hover:text-dsh-primary focus:outline-none cursor-pointer text-[12px] font-medium max-w-[85px] sm:max-w-[125px] truncate"
            title="切换拓扑架构范式"
          >
            <option value="UNIVERSAL" className="bg-dsh-layer1 text-dsh-primary">自适应拓扑</option>
            <option value="WEB_LAYERED" className="bg-dsh-layer1 text-dsh-primary">Web 分层</option>
            <option value="WORKER_PIPELINE" className="bg-dsh-layer1 text-dsh-primary">任务队列</option>
            <option value="CLI_PIPELINE" className="bg-dsh-layer1 text-dsh-primary">CLI 管道</option>
          </select>
        </div>

        {/* 编译与刷新操作组 (紧凑组合按钮，节省 ~80px) */}
        <div className="flex items-center rounded-lg bg-dsh-layer1 border border-dsh-border2 p-0.5 shadow-sm">
          <button
            onClick={onIncrementalUpdate}
            disabled={isUpdating}
            className="flex items-center gap-1 px-2.5 py-1 rounded-md hover:bg-dsh-layer2 text-[12px] text-dsh-secondary hover:text-dsh-primary transition-colors disabled:opacity-40 font-medium"
            title="毫秒级热同步当前代码编辑改动"
          >
            <Zap className={`w-3.5 h-3.5 text-dsh-blue ${isUpdating ? 'animate-pulse' : ''}`} />
            <span className="hidden sm:inline">增量更新</span>
            <span className="sm:hidden">增量</span>
          </button>

          <div className="h-3.5 w-[1px] bg-dsh-border2 mx-0.5" />

          <button
            onClick={onFullRescan}
            disabled={isUpdating}
            className="flex items-center gap-1 px-2 py-1 rounded-md hover:bg-dsh-layer2 text-[12px] text-dsh-secondary hover:text-dsh-primary transition-colors disabled:opacity-40 font-medium"
            title="重新执行全量解析"
          >
            <RefreshCw className={`w-3.5 h-3.5 text-dsh-tertiary ${isUpdating ? 'animate-spin' : ''}`} />
            <span className="hidden lg:inline">重扫</span>
          </button>
        </div>

        {/* 发现新版本时优先展示醒目的呼吸灯更新胶囊 */}
        {updateInfo?.hasUpdate && (
          <button
            onClick={onOpenUpdateModal}
            className="relative flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-emerald-500/10 hover:bg-emerald-500/20 border border-emerald-500/30 text-emerald-400 text-[12px] font-semibold transition-all shadow-[0_0_12px_rgba(16,185,129,0.25)] animate-pulse"
            title={`发现新版本 v${updateInfo.latestVersion}，点击查看并升级`}
          >
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
            </span>
            <span className="hidden sm:inline">v{updateInfo.latestVersion} 可更新</span>
            <span className="sm:hidden">更新</span>
          </button>
        )}

        {/* 深浅色主题切换 */}
        <button
          onClick={toggleTheme}
          className="p-1.5 rounded-lg text-dsh-secondary hover:text-dsh-primary hover:bg-dsh-layer2 transition-colors border border-transparent hover:border-dsh-border2"
          title={theme === 'dark' ? '深色主题 (点击切换)' : '浅色主题 (点击切换)'}
        >
          {theme === 'dark' ? (
            <Sun className="w-4 h-4 text-amber-400" />
          ) : (
            <Moon className="w-4 h-4 text-dsh-blue" />
          )}
        </button>

        {/* 「更多功能」收纳菜单 (More Menu - 收纳设置、端管理、版本与新窗口打开) */}
        <div className="relative" ref={moreMenuRef}>
          <button
            onClick={() => setIsMoreMenuOpen((prev) => !prev)}
            className="p-1.5 rounded-lg text-dsh-secondary hover:text-dsh-primary hover:bg-dsh-layer2 transition-colors border border-transparent hover:border-dsh-border2"
            title="更多选项与工具"
          >
            <MoreHorizontal className="w-4 h-4" />
          </button>

          {isMoreMenuOpen && (
            <div className="absolute right-0 top-full mt-1.5 z-50 w-52 p-1.5 rounded-xl bg-dsh-layer1/98 backdrop-blur-md border border-dsh-border2 shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-150">
              <button
                onClick={() => {
                  setIsMoreMenuOpen(false);
                  onReset();
                }}
                className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-[12px] text-dsh-secondary hover:text-dsh-primary hover:bg-dsh-layer2 transition-colors text-left"
              >
                <SlidersHorizontal className="w-4 h-4 text-dsh-blue shrink-0" />
                <div className="flex flex-col">
                  <span className="font-medium text-dsh-primary">切换分析目录</span>
                  <span className="text-[10px] text-dsh-dimmed">重新选择工作区或扫描路径</span>
                </div>
              </button>

              {projects && projects.length > 1 && (
                <button
                  onClick={() => {
                    setIsMoreMenuOpen(false);
                    onOpenScopeDrawer?.();
                  }}
                  className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-[12px] text-dsh-secondary hover:text-dsh-primary hover:bg-dsh-layer2 transition-colors text-left"
                >
                  <FolderTree className="w-4 h-4 text-emerald-400 shrink-0" />
                  <div className="flex flex-col">
                    <span className="font-medium text-dsh-primary">端与版本范围管理</span>
                    <span className="text-[10px] text-dsh-dimmed">配置纳入分析的子工程范围</span>
                  </div>
                </button>
              )}

              <button
                onClick={() => {
                  setIsMoreMenuOpen(false);
                  onOpenUpdateModal?.();
                }}
                className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-[12px] text-dsh-secondary hover:text-dsh-primary hover:bg-dsh-layer2 transition-colors text-left"
              >
                <Download className="w-4 h-4 text-indigo-400 shrink-0" />
                <div className="flex flex-col">
                  <span className="font-medium text-dsh-primary">插件版本与在线更新</span>
                  <span className="text-[10px] text-dsh-dimmed">
                    {updateInfo?.hasUpdate ? `可升级至 v${updateInfo.latestVersion}` : '当前已是最新版本'}
                  </span>
                </div>
              </button>

              <div className="my-1 border-t border-dsh-border1 mx-1" />

              <button
                onClick={() => {
                  setIsMoreMenuOpen(false);
                  window.open(window.location.href, '_blank');
                }}
                className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-[12px] text-dsh-secondary hover:text-dsh-primary hover:bg-dsh-layer2 transition-colors text-left"
              >
                <ExternalLink className="w-4 h-4 text-dsh-tertiary shrink-0" />
                <div className="flex flex-col">
                  <span className="font-medium text-dsh-primary">新窗口独立全屏</span>
                  <span className="text-[10px] text-dsh-dimmed">在独立浏览器标签页打开</span>
                </div>
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
};
