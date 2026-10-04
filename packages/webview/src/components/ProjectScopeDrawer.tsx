import React, { useState } from 'react';
import {
  X,
  Layers,
  Sparkles,
  Smartphone,
  Monitor,
  Globe,
  Server,
  Wrench,
  Check,
  RotateCw,
  FolderTree,
} from 'lucide-react';
import { DetectedProjectProfile, ProjectPlatform } from '../../../core/src/types/index.js';

interface ProjectScopeDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  projects: DetectedProjectProfile[];
  initialSelectedIds: string[];
  onApplyScope: (selectedIds: string[]) => void;
  isLoading: boolean;
}

export const ProjectScopeDrawer: React.FC<ProjectScopeDrawerProps> = ({
  isOpen,
  onClose,
  projects,
  initialSelectedIds,
  onApplyScope,
  isLoading,
}) => {
  const [selectedIds, setSelectedIds] = useState<string[]>(initialSelectedIds);

  if (!isOpen) return null;

  const toggleProject = (id: string) => {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((i) => i !== id) : [...prev, id]
    );
  };

  const selectPreset = (type: 'recommended' | 'clients' | 'backend' | 'all') => {
    if (type === 'recommended') {
      const rec = projects.filter((p) => p.isRecommended).map((p) => p.id);
      setSelectedIds(rec.length > 0 ? rec : projects.map((p) => p.id));
    } else if (type === 'clients') {
      setSelectedIds(
        projects
          .filter(
            (p) =>
              p.platform.startsWith('MOBILE_') ||
              p.platform.startsWith('DESKTOP_') ||
              p.platform === 'WEB_FRONTEND'
          )
          .map((p) => p.id)
      );
    } else if (type === 'backend') {
      setSelectedIds(
        projects.filter((p) => p.platform === 'BACKEND_SERVICE').map((p) => p.id)
      );
    } else if (type === 'all') {
      setSelectedIds(projects.map((p) => p.id));
    }
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

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/60 backdrop-blur-sm transition-opacity select-none">
      <div className="w-full max-w-md h-full bg-dsh-layer1 border-l border-dsh-border2 shadow-2xl flex flex-col animate-in slide-in-from-right duration-200">
        {/* Drawer Header */}
        <div className="p-4 border-b border-dsh-border1 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-md bg-dsh-blue-tint border border-dsh-blue-border flex items-center justify-center text-dsh-blue">
              <FolderTree className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-sm font-semibold text-dsh-primary">
                多端与版本范围管理
              </h3>
              <p className="text-[11px] text-dsh-tertiary">
                自主勾选要纳入图谱分析的目标端、语言栈与历史版本
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-md text-dsh-tertiary hover:text-dsh-primary hover:bg-dsh-layer2 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Presets Bar */}
        <div className="p-3 border-b border-dsh-border1 bg-dsh-platform/50 flex items-center gap-1.5 flex-wrap">
          <span className="text-[11px] text-dsh-dimmed mr-1">快捷预设:</span>
          <button
            type="button"
            onClick={() => selectPreset('recommended')}
            className="flex items-center gap-1 px-2 py-1 rounded text-[11px] font-medium bg-dsh-blue-tint border border-dsh-blue-border text-dsh-blue hover:bg-dsh-blue/20 transition-colors"
          >
            <Sparkles className="w-3 h-3" />
            <span>全端协同生态 (推荐)</span>
          </button>
          <button
            type="button"
            onClick={() => selectPreset('clients')}
            className="px-2 py-1 rounded text-[11px] font-medium bg-dsh-layer2 border border-dsh-border2 text-dsh-secondary hover:text-dsh-primary transition-colors"
          >
            仅客户端
          </button>
          <button
            type="button"
            onClick={() => selectPreset('backend')}
            className="px-2 py-1 rounded text-[11px] font-medium bg-dsh-layer2 border border-dsh-border2 text-dsh-secondary hover:text-dsh-primary transition-colors"
          >
            仅后端
          </button>
          <button
            type="button"
            onClick={() => selectPreset('all')}
            className="px-2 py-1 rounded text-[11px] font-medium bg-dsh-layer2 border border-dsh-border2 text-dsh-secondary hover:text-dsh-primary transition-colors"
          >
            全选
          </button>
        </div>

        {/* Project List */}
        <div className="flex-1 overflow-y-auto p-4 space-y-2.5">
          {projects.map((proj) => {
            const isChecked = selectedIds.includes(proj.id);
            const badge = getPlatformBadge(proj.platform);

            return (
              <div
                key={proj.id}
                onClick={() => toggleProject(proj.id)}
                className={`p-3 rounded-lg border transition-all cursor-pointer ${
                  isChecked
                    ? 'bg-dsh-layer2/80 border-dsh-blue/70 shadow-sm'
                    : 'bg-dsh-platform/40 border-dsh-border1 opacity-60 hover:opacity-100 hover:border-dsh-border2'
                }`}
              >
                <div className="flex items-start gap-2.5">
                  <div
                    className={`mt-0.5 w-4 h-4 rounded border flex items-center justify-center shrink-0 transition-colors ${
                      isChecked
                        ? 'bg-dsh-blue border-dsh-blue text-white'
                        : 'border-dsh-border3 bg-transparent'
                    }`}
                  >
                    {isChecked && <Check className="w-3 h-3 stroke-[3]" />}
                  </div>

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-1 mb-1">
                      <div className="flex items-center gap-1.5 truncate">
                        {getPlatformIcon(proj.platform)}
                        <span className="text-[13px] font-semibold text-dsh-primary truncate">
                          {proj.name}
                        </span>
                        {proj.versionString && (
                          <span className="text-[10px] px-1.5 py-0.2 rounded font-mono font-medium bg-dsh-layer3 text-dsh-blue border border-dsh-blue-border">
                            {proj.versionString}
                          </span>
                        )}
                      </div>

                      <span
                        className={`text-[10px] px-1.5 py-0.5 rounded border font-medium shrink-0 ${
                          proj.isRecommended
                            ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30'
                            : 'bg-zinc-500/10 text-zinc-400 border-zinc-500/30'
                        }`}
                      >
                        {proj.isRecommended ? '⭐ 主力工程' : '历史/工具'}
                      </span>
                    </div>

                    <div className="flex items-center gap-2 text-[11px] text-dsh-tertiary mb-1 font-mono">
                      <span>路径: {proj.relPath}</span>
                      <span>·</span>
                      <span>{proj.fileCount} 文件</span>
                    </div>

                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className={`text-[10px] px-1.5 py-0.2 rounded border ${badge.cls}`}>
                        {badge.label}
                      </span>
                      <span className="text-[10px] px-1.5 py-0.2 rounded bg-dsh-layer3 text-dsh-secondary border border-dsh-border2 font-mono">
                        {proj.primaryLanguage}
                      </span>
                      {proj.frameworks.map((fw) => (
                        <span
                          key={fw}
                          className="text-[10px] px-1.5 py-0.2 rounded bg-dsh-layer3 text-dsh-tertiary border border-dsh-border1"
                        >
                          {fw}
                        </span>
                      ))}
                    </div>

                    {proj.recommendReason && (
                      <div className="mt-1.5 text-[10px] text-dsh-dimmed italic">
                        {proj.recommendReason}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {/* Drawer Footer */}
        <div className="p-4 border-t border-dsh-border1 bg-dsh-platform flex items-center justify-between">
          <span className="text-xs text-dsh-secondary font-mono">
            已选择: <span className="text-dsh-blue font-bold">{selectedIds.length}</span> / {projects.length} 个端
          </span>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              disabled={isLoading}
              className="px-3 py-1.5 rounded-md border border-dsh-border3 text-dsh-secondary hover:text-dsh-primary text-xs font-medium transition-colors"
            >
              取消
            </button>

            <button
              type="button"
              onClick={() => onApplyScope(selectedIds)}
              disabled={isLoading || selectedIds.length === 0}
              className="flex items-center gap-1.5 px-4 py-1.5 rounded-md bg-dsh-blue hover:bg-dsh-blue-hover text-white text-xs font-medium transition-colors disabled:opacity-40"
            >
              {isLoading ? (
                <>
                  <RotateCw className="w-3.5 h-3.5 animate-spin" />
                  <span>正在重新扫描...</span>
                </>
              ) : (
                <>
                  <Check className="w-3.5 h-3.5" />
                  <span>应用并重新扫描</span>
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
