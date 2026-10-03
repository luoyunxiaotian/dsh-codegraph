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
} from 'lucide-react';
import { ArchetypeType } from '../../../core/src/types/index.js';
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
}) => {
  const { theme, toggleTheme } = useTheme();

  return (
    <header className="h-11 bg-dsh-base border-b border-dsh-border2 flex items-center justify-between px-3.5 z-20 shrink-0 select-none">
      {/* Left: Brand, Project Title & Breadcrumb */}
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-2">
          {/* DeepSeek Harness Style Logo Badge */}
          <div className="w-6 h-6 rounded-md bg-dsh-blue-tint border border-dsh-blue-border flex items-center justify-center text-dsh-blue font-bold text-xs">
            CG
          </div>
          <div className="flex items-center gap-1.5">
            <span className="text-[13px] font-semibold text-dsh-primary tracking-tight">
              {projectName}
            </span>
            <span className="text-[11px] text-dsh-tertiary px-1.5 py-0.5 rounded bg-dsh-platform border border-dsh-border1 font-mono">
              {scopePath === '.' ? '根目录' : scopePath}
            </span>
            {cacheTime && (
              <span
                className="text-[11px] text-dsh-tertiary px-1.5 py-0.5 rounded bg-dsh-platform border border-dsh-border1 font-mono flex items-center gap-1"
                title="图谱已加载自本地工程缓存 (.codegraph/)"
              >
                <span className="w-1.5 h-1.5 rounded-full bg-dsh-blue inline-block"></span>
                <span>本地缓存 {cacheTime}</span>
              </span>
            )}
          </div>

          {currentView === 'drilldown' && selectedModuleName && (
            <div className="flex items-center text-[12px] text-dsh-tertiary ml-1">
              <ChevronRight className="w-3.5 h-3.5 mx-0.5 text-dsh-dimmed" />
              <button
                onClick={() => onViewChange('architecture')}
                className="hover:text-dsh-primary transition-colors text-dsh-tertiary"
              >
                架构
              </button>
              <ChevronRight className="w-3.5 h-3.5 mx-0.5 text-dsh-dimmed" />
              <span className="text-dsh-blue font-medium">{selectedModuleName}</span>
            </div>
          )}
        </div>

        {/* Center: DeepSeek Harness Segmented Control */}
        <div className="ml-4 flex items-center p-0.5 rounded-lg bg-dsh-platform border border-dsh-border1">
          <button
            onClick={() => onViewChange('architecture')}
            className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[12px] font-medium transition-all ${
              currentView === 'architecture'
                ? 'bg-dsh-layer2 border border-dsh-border2 text-dsh-primary shadow-sm'
                : 'text-dsh-tertiary hover:text-dsh-primary'
            }`}
          >
            <Layers className="w-3.5 h-3.5" />
            <span>宏观架构</span>
          </button>
          <button
            onClick={() => onViewChange('flow')}
            className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[12px] font-medium transition-all ${
              currentView === 'flow'
                ? 'bg-dsh-layer2 border border-dsh-border2 text-dsh-primary shadow-sm'
                : 'text-dsh-tertiary hover:text-dsh-primary'
            }`}
          >
            <GitBranch className="w-3.5 h-3.5" />
            <span>业务时序流</span>
          </button>
          {selectedModuleName && (
            <button
              onClick={() => onViewChange('drilldown')}
              className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[12px] font-medium transition-all ${
                currentView === 'drilldown'
                  ? 'bg-dsh-layer2 border border-dsh-border2 text-dsh-primary shadow-sm'
                : 'text-dsh-tertiary hover:text-dsh-primary'
              }`}
            >
              <Search className="w-3.5 h-3.5" />
              <span>模块下钻</span>
            </button>
          )}
        </div>
      </div>

      {/* Right: Archetype selector, Health score & DSH Action Buttons */}
      <div className="flex items-center gap-2">
        {/* Archetype & Health Indicator */}
        <div className="flex items-center gap-1.5 px-2 py-1 rounded-md bg-dsh-platform border border-dsh-border1 text-[12px]">
          {isAutoCorrected ? (
            <span className="flex items-center gap-1 text-dsh-amber text-[11px]" title="检测到调用倒挂或偏离，已自动纠错回退至真实拓扑">
              <AlertTriangle className="w-3.5 h-3.5 text-dsh-amber" />
              <span>已自动纠错</span>
            </span>
          ) : (
            <span className="flex items-center gap-1 text-dsh-green text-[11px]" title="装配后一致性审计通过">
              <CheckCircle2 className="w-3.5 h-3.5 text-dsh-green" />
              <span className="font-mono">H={healthScore ?? 1.0}</span>
            </span>
          )}

          <div className="h-3 w-[1px] bg-dsh-border2 mx-0.5" />

          <select
            value={archetype}
            onChange={(e) => onArchetypeChange(e.target.value as ArchetypeType)}
            className="bg-transparent text-dsh-secondary hover:text-dsh-primary focus:outline-none cursor-pointer text-[12px] font-medium"
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
          className="flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-dsh-layer1 hover:bg-dsh-layer2 border border-dsh-border2 text-[12px] text-dsh-secondary hover:text-dsh-primary transition-colors disabled:opacity-40"
          title="毫秒级热同步当前代码编辑改动"
        >
          <Zap className={`w-3.5 h-3.5 text-dsh-blue ${isUpdating ? 'animate-pulse' : ''}`} />
          <span>增量更新</span>
        </button>

        <button
          onClick={onFullRescan}
          disabled={isUpdating}
          className="flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-dsh-layer1 hover:bg-dsh-layer2 border border-dsh-border2 text-[12px] text-dsh-secondary hover:text-dsh-primary transition-colors disabled:opacity-40"
          title="重新执行全量解析"
        >
          <RefreshCw className={`w-3.5 h-3.5 text-dsh-tertiary ${isUpdating ? 'animate-spin' : ''}`} />
          <span>重扫</span>
        </button>

        <button
          onClick={onReset}
          className="p-1.5 rounded-md text-dsh-tertiary hover:text-dsh-primary hover:bg-dsh-layer2 transition-colors"
          title="切换分析目录 / 重新配置"
        >
          <SlidersHorizontal className="w-3.5 h-3.5" />
        </button>

        <button
          onClick={toggleTheme}
          className="p-1.5 rounded-md text-dsh-tertiary hover:text-dsh-primary hover:bg-dsh-layer2 transition-colors"
          title={theme === 'dark' ? '当前: 深色主题 (点击切换为浅色)' : '当前: 浅色主题 (点击切换为深色)'}
        >
          {theme === 'dark' ? (
            <Sun className="w-3.5 h-3.5 text-amber-400" />
          ) : (
            <Moon className="w-3.5 h-3.5 text-dsh-blue" />
          )}
        </button>
      </div>
    </header>
  );
};
