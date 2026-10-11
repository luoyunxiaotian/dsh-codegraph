import React, { useState, useEffect, useRef } from 'react';
import {
  X,
  RefreshCw,
  Zap,
  CheckCircle2,
  AlertCircle,
  Download,
  Gauge,
  ShieldCheck,
} from 'lucide-react';
import {
  UpdateCheckResult,
  MirrorSpeedResult,
  UpdateProgress,
} from '../../../core/src/updater/types.js';

interface UpdateModalProps {
  isOpen: boolean;
  onClose: () => void;
  updateInfo: UpdateCheckResult | null;
  onCheckUpdate: (force?: boolean) => Promise<UpdateCheckResult | null>;
}

export const UpdateModal: React.FC<UpdateModalProps> = ({
  isOpen,
  onClose,
  updateInfo,
  onCheckUpdate,
}) => {
  const [isChecking, setIsChecking] = useState<boolean>(false);
  const [isRacing, setIsRacing] = useState<boolean>(false);
  const [isApplying, setIsApplying] = useState<boolean>(false);
  const [mirrorResults, setMirrorResults] = useState<MirrorSpeedResult[]>([]);
  const [progress, setProgress] = useState<UpdateProgress>({ phase: 'idle', percent: 0 });
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const pollTimerRef = useRef<any>(null);

  // 格式化字节大小
  const formatBytes = (bytes?: number) => {
    if (!bytes || bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`;
  };

  // 执行镜像测速
  const handleRaceMirrors = async () => {
    setIsRacing(true);
    setErrorMessage(null);
    try {
      const res = await fetch('/api/update/race');
      const data = await res.json();
      if (data.success && Array.isArray(data.mirrors)) {
        setMirrorResults(data.mirrors);
      } else {
        setErrorMessage(data.error || '测速请求失败');
      }
    } catch (e: any) {
      setErrorMessage(e.message || '测速失败');
    } finally {
      setIsRacing(false);
    }
  };

  // 手动重新检查版本
  const handleCheck = async () => {
    setIsChecking(true);
    setErrorMessage(null);
    try {
      const res = await onCheckUpdate(true);
      if (!res || !res.latestVersion) {
        setErrorMessage('未能从服务器获取最新版本信息，请检查后台服务连接状态');
      }
    } catch (e: any) {
      setErrorMessage(e.message || '检测更新失败');
    } finally {
      setIsChecking(false);
    }
  };

  // 轮询更新进度
  const startProgressPolling = () => {
    if (pollTimerRef.current) clearInterval(pollTimerRef.current);
    pollTimerRef.current = setInterval(async () => {
      try {
        const res = await fetch('/api/update/progress');
        const data = await res.json();
        if (data.success && data.progress) {
          setProgress(data.progress);
          if (data.progress.phase === 'completed') {
            if (pollTimerRef.current) clearInterval(pollTimerRef.current);
            setIsApplying(false);
            setSuccessMessage('更新成功！插件文件已原子替换为最新版本。');
          } else if (data.progress.phase === 'error') {
            if (pollTimerRef.current) clearInterval(pollTimerRef.current);
            setIsApplying(false);
            setErrorMessage(data.progress.error || '更新失败');
          }
        }
      } catch {}
    }, 400);
  };

  // 停止轮询
  const stopProgressPolling = () => {
    if (pollTimerRef.current) {
      clearInterval(pollTimerRef.current);
      pollTimerRef.current = null;
    }
  };

  useEffect(() => {
    return () => stopProgressPolling();
  }, []);

  // 首次打开弹窗时若镜像列表为空，自动触发一次测速
  useEffect(() => {
    if (isOpen && mirrorResults.length === 0) {
      handleRaceMirrors();
    }
  }, [isOpen]);

  // 执行一键更新
  const handleApplyUpdate = async () => {
    setIsApplying(true);
    setErrorMessage(null);
    setSuccessMessage(null);
    setProgress({ phase: 'checking', percent: 5 });

    startProgressPolling();

    try {
      const res = await fetch('/api/update/apply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ manifest: updateInfo?.manifest }),
      });
      const data = await res.json();
      stopProgressPolling();
      setIsApplying(false);

      if (data.success) {
        setProgress({ phase: 'completed', percent: 100 });
        setSuccessMessage(data.message || '更新已完成');
      } else {
        setProgress({ phase: 'error', percent: 0, error: data.error });
        setErrorMessage(data.error || '更新未成功');
      }
    } catch (e: any) {
      stopProgressPolling();
      setIsApplying(false);
      setProgress({ phase: 'error', percent: 0, error: e.message });
      setErrorMessage(e.message || '网络连接中断');
    }
  };

  if (!isOpen) return null;

  const currentVer = updateInfo?.currentVersion || '2.0.0';
  const latestVer = updateInfo?.latestVersion || currentVer;
  const hasUpdate = !!updateInfo?.hasUpdate;

  // 计算最高测速值作为进度条基准
  const maxSpeedBps = Math.max(...mirrorResults.map((m) => m.speedBps || 0), 1024 * 1024);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-fade-in select-none">
      <div className="bg-dsh-base border border-dsh-border2 rounded-2xl shadow-2xl max-w-2xl w-full flex flex-col max-h-[90vh] overflow-hidden text-dsh-primary">
        {/* 1. Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-dsh-border2 bg-dsh-platform shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-xl bg-blue-500/10 text-dsh-blue border border-blue-500/20">
              <Zap className="w-5 h-5 text-dsh-blue" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="font-semibold text-[16px] text-dsh-primary">CodeGraph 插件更新管理</h3>
                <span className="px-2 py-0.5 rounded text-[11px] font-mono bg-dsh-layer2 text-dsh-tertiary border border-dsh-border1">
                  v{currentVer}
                </span>
              </div>
              <p className="text-[12px] text-dsh-tertiary">
                集成 GitHub 最新发布检测、3秒持续吞吐竞速与华为云终极兜底
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            disabled={isApplying}
            className="p-1.5 rounded-lg text-dsh-tertiary hover:text-dsh-primary hover:bg-dsh-layer2 transition-colors disabled:opacity-40"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* 2. Scrollable Body */}
        <div className="p-6 overflow-y-auto space-y-5 flex-1 text-[13px]">
          {/* Status Banner */}
          <div
            className={`p-4 rounded-xl border flex items-start gap-3.5 transition-all ${
              hasUpdate
                ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300'
                : 'bg-dsh-platform border-dsh-border2 text-dsh-secondary'
            }`}
          >
            {hasUpdate ? (
              <div className="p-1 rounded-lg bg-emerald-500/20 text-emerald-400 mt-0.5">
                <CheckCircle2 className="w-5 h-5" />
              </div>
            ) : (
              <div className="p-1 rounded-lg bg-dsh-layer2 text-dsh-tertiary mt-0.5">
                <ShieldCheck className="w-5 h-5" />
              </div>
            )}
            <div className="flex-1">
              <div className="flex items-center justify-between">
                <span className="font-semibold text-[14px]">
                  {hasUpdate ? `✨ 发现新版本: v${latestVer}` : '✓ 当前已是最新版本'}
                </span>
                {updateInfo?.publishedAt && (
                  <span className="text-[11px] font-mono opacity-70">
                    发布于 {new Date(updateInfo.publishedAt).toLocaleDateString()}
                  </span>
                )}
              </div>
              <p className="text-[12px] mt-1 opacity-90 leading-relaxed">
                {hasUpdate
                  ? updateInfo?.notes || '常规性能优化与多语言特性支持，推荐立即升级。'
                  : `当前安装的 CodeGraph 插件版本 (v${currentVer}) 与 GitHub 官方发布清单保持一致，无需升级。`}
              </p>
            </div>
          </div>

          {/* Mirrors Speed Benchmark Section */}
          <div className="rounded-xl border border-dsh-border2 bg-dsh-platform p-4 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Gauge className="w-4 h-4 text-dsh-blue" />
                <span className="font-semibold text-dsh-primary">国内高速镜像实测榜单</span>
                <span className="text-[11px] text-dsh-tertiary font-normal">
                  (跨越 TCP 慢启动实测持续吞吐量)
                </span>
              </div>
              <button
                onClick={handleRaceMirrors}
                disabled={isRacing || isApplying}
                className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-dsh-layer1 hover:bg-dsh-layer2 border border-dsh-border1 text-[12px] text-dsh-secondary hover:text-dsh-primary transition-colors disabled:opacity-40"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${isRacing ? 'animate-spin text-dsh-blue' : ''}`} />
                <span>{isRacing ? '3秒实测竞速中...' : '重新测速'}</span>
              </button>
            </div>

            {/* Mirror List */}
            <div className="space-y-2">
              {mirrorResults.length === 0 && !isRacing && (
                <div className="text-center py-4 text-dsh-tertiary text-[12px]">
                  尚未执行镜像测速，点击右上角「重新测速」开始实测。
                </div>
              )}

              {mirrorResults.map((m, idx) => {
                const ratio = Math.min(100, Math.round(((m.speedBps || 0) / maxSpeedBps) * 100));
                const isWinner = idx === 0 && m.success;

                return (
                  <div
                    key={m.id}
                    className={`p-2.5 rounded-lg border transition-all ${
                      isWinner
                        ? 'bg-blue-500/5 border-blue-500/30'
                        : 'bg-dsh-base border-dsh-border1'
                    }`}
                  >
                    <div className="flex items-center justify-between text-[12px]">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-dsh-primary">{m.name}</span>
                        {(m.isFallback || m.id.includes('huawei')) && (
                          <span className="px-1.5 py-0.2 rounded text-[10px] bg-amber-500/10 text-amber-400 border border-amber-500/30">
                            终极兜底
                          </span>
                        )}
                        {isWinner && (
                          <span className="px-1.5 py-0.2 rounded text-[10px] bg-blue-500/10 text-blue-400 border border-blue-500/30 font-semibold">
                            🏆 最优推荐
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-2">
                        {m.success ? (
                          <span className="font-mono font-semibold text-emerald-400">
                            {m.speedFormatted}
                          </span>
                        ) : (
                          <span className="font-mono text-red-400 text-[11px]">网络超时/阻断</span>
                        )}
                      </div>
                    </div>

                    {/* Speed bar */}
                    {m.success && (
                      <div className="w-full bg-dsh-layer2 h-1.5 rounded-full mt-2 overflow-hidden">
                        <div
                          className={`h-full rounded-full transition-all duration-500 ${
                            isWinner ? 'bg-dsh-blue' : 'bg-emerald-500/60'
                          }`}
                          style={{ width: `${ratio}%` }}
                        />
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {/* Progress / Updating Area */}
          {(isApplying || progress.phase !== 'idle') && (
            <div className="rounded-xl border border-blue-500/30 bg-blue-500/5 p-4 space-y-3">
              <div className="flex items-center justify-between text-[13px]">
                <div className="flex items-center gap-2 font-semibold text-dsh-primary">
                  {progress.phase === 'checking' && '🔍 正在比对本地文件 SHA-256 增量差异...'}
                  {progress.phase === 'racing' && '🏎️ 正在执行 3 秒持续吞吐实测竞速选源...'}
                  {progress.phase === 'downloading' && '⬇️ 正在安全下载增量文件...'}
                  {progress.phase === 'verifying' && '🛡️ 正在校验文件散列完整性...'}
                  {progress.phase === 'installing' && '🔄 正在执行 Windows 原子安全覆盖与备份...'}
                  {progress.phase === 'completed' && '✅ 插件升级顺利完成！'}
                  {progress.phase === 'error' && '❌ 更新异常'}
                </div>
                <span className="font-mono font-semibold text-dsh-blue">{progress.percent}%</span>
              </div>

              {/* Progress Bar */}
              <div className="w-full bg-dsh-layer2 h-2.5 rounded-full overflow-hidden">
                <div
                  className="h-full bg-gradient-to-r from-blue-500 via-indigo-500 to-emerald-400 transition-all duration-300 rounded-full"
                  style={{ width: `${progress.percent}%` }}
                />
              </div>

              {/* Progress Detail */}
              <div className="flex items-center justify-between text-[11px] text-dsh-tertiary font-mono">
                <span className="truncate max-w-[340px]" title={progress.currentFile}>
                  {progress.currentFile ? `文件: ${progress.currentFile}` : '准备中...'}
                </span>
                <div className="flex items-center gap-2">
                  {progress.speedFormatted && (
                    <span className="text-emerald-400 font-semibold">{progress.speedFormatted}</span>
                  )}
                  {progress.totalBytes ? (
                    <span>
                      {formatBytes(progress.downloadedBytes)} / {formatBytes(progress.totalBytes)}
                    </span>
                  ) : null}
                </div>
              </div>
            </div>
          )}

          {/* Success Banner */}
          {successMessage && (
            <div className="p-4 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-300 space-y-2">
              <div className="flex items-center gap-2 font-semibold text-[14px]">
                <CheckCircle2 className="w-5 h-5 text-emerald-400" />
                <span>{successMessage}</span>
              </div>
              <p className="text-[12px] opacity-90">
                前端静态资源与脚本已就绪。点击下方按钮刷新视窗即可使用新版功能；若涉及新工具与后端协议，建议在 DeepSeek Harness 侧重启插件。
              </p>
              <div className="pt-2 flex items-center gap-2">
                <button
                  onClick={() => window.location.reload()}
                  className="px-3.5 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-semibold text-[12px] transition-colors shadow"
                >
                  🔄 立即刷新 Webview 视窗
                </button>
              </div>
            </div>
          )}

          {/* Error Banner */}
          {errorMessage && (
            <div className="p-3.5 rounded-xl bg-red-500/10 border border-red-500/30 text-red-300 flex items-start gap-2.5">
              <AlertCircle className="w-5 h-5 text-red-400 shrink-0 mt-0.5" />
              <div className="text-[12px] leading-relaxed">
                <div className="font-semibold">操作遇到错误:</div>
                <div className="mt-0.5 opacity-90">{errorMessage}</div>
              </div>
            </div>
          )}
        </div>

        {/* 3. Footer */}
        <div className="px-6 py-4 border-t border-dsh-border2 bg-dsh-platform flex items-center justify-between shrink-0">
          <button
            onClick={handleCheck}
            disabled={isChecking || isApplying}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-dsh-layer1 hover:bg-dsh-layer2 border border-dsh-border2 text-[12px] text-dsh-secondary hover:text-dsh-primary transition-colors disabled:opacity-40"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isChecking ? 'animate-spin text-dsh-blue' : ''}`} />
            <span>{isChecking ? '检查中...' : '强制重新检查'}</span>
          </button>

          <div className="flex items-center gap-2.5">
            <button
              onClick={onClose}
              disabled={isApplying}
              className="px-4 py-1.5 rounded-lg border border-dsh-border2 bg-dsh-base hover:bg-dsh-layer1 text-dsh-secondary hover:text-dsh-primary text-[13px] font-medium transition-colors disabled:opacity-40"
            >
              关闭
            </button>

            {hasUpdate && progress.phase !== 'completed' && (
              <button
                onClick={handleApplyUpdate}
                disabled={isApplying}
                className="flex items-center gap-1.5 px-4 py-1.5 rounded-lg bg-dsh-blue hover:bg-blue-600 text-white text-[13px] font-semibold transition-all shadow-md shadow-blue-500/20 disabled:opacity-40"
              >
                <Download className="w-4 h-4" />
                <span>{isApplying ? '正在增量升级...' : `一键极速升级 (v${latestVer})`}</span>
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
