import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import {
  ReleaseManifest,
  ManifestFileEntry,
  MirrorEndpoint,
  MirrorSpeedResult,
  UpdateCheckResult,
  UpdateProgress,
} from './types.js';
import {
  DEFAULT_REPO,
  getDefaultMirrors,
  MirrorSpeedTester,
  formatSpeed,
} from './mirror-speed-tester.js';

/**
 * 语义化版本号比较 (支持 2.0.0, v2.1.0, 2.0.0-beta.1 等)
 * 返回值: >0 表示 a > b; <0 表示 a < b; 0 表示相等
 */
export function compareVersions(a: string, b: string): number {
  const cleanA = a.replace(/^v/i, '').trim();
  const cleanB = b.replace(/^v/i, '').trim();

  const partsA = cleanA.split('-')[0].split('.').map((n) => parseInt(n, 10) || 0);
  const partsB = cleanB.split('-')[0].split('.').map((n) => parseInt(n, 10) || 0);

  const len = Math.max(partsA.length, partsB.length);
  for (let i = 0; i < len; i++) {
    const numA = partsA[i] || 0;
    const numB = partsB[i] || 0;
    if (numA > numB) return 1;
    if (numA < numB) return -1;
  }
  return 0;
}

/**
 * 计算文件的 SHA-256 哈希值
 */
export function sha256File(filePath: string): string {
  const content = fs.readFileSync(filePath);
  return crypto.createHash('sha256').update(content).digest('hex');
}

/**
 * Windows 下重命名覆盖带指数退避重试 (抵抗防病毒软件或索引器短暂文件锁 EPERM / EBUSY)
 */
export async function renameWithRetry(
  sourcePath: string,
  targetPath: string,
  maxAttempts: number = 6,
  initialBackoffMs: number = 100
): Promise<void> {
  let attempt = 0;
  while (true) {
    try {
      if (fs.existsSync(targetPath)) {
        try {
          fs.unlinkSync(targetPath);
        } catch {}
      }
      fs.renameSync(sourcePath, targetPath);
      return;
    } catch (err: any) {
      attempt++;
      if (attempt >= maxAttempts) {
        // 最后一次尝试降级使用文件覆写复制
        try {
          fs.copyFileSync(sourcePath, targetPath);
          try {
            fs.unlinkSync(sourcePath);
          } catch {}
          return;
        } catch (copyErr) {
          throw new Error(`覆盖文件失败 [${targetPath}]: ${err.message || copyErr}`);
        }
      }
      const backoff = initialBackoffMs * Math.pow(1.5, attempt);
      await new Promise((r) => setTimeout(r, backoff));
    }
  }
}

/**
 * 核心插件更新管理器 (PluginUpdater)
 */
export class PluginUpdater {
  private pluginRoot: string;
  private repo: string;
  private customHuaweiUrl?: string;
  private cachedCheckResult: UpdateCheckResult | null = null;
  private lastCheckTime: number = 0;
  private currentProgress: UpdateProgress = { phase: 'idle', percent: 0 };

  constructor(pluginRoot: string, repo: string = DEFAULT_REPO, customHuaweiUrl?: string) {
    this.pluginRoot = path.resolve(pluginRoot);
    this.repo = repo;
    this.customHuaweiUrl = customHuaweiUrl;
  }

  public getProgress(): UpdateProgress {
    return this.currentProgress;
  }

  /**
   * 获取本地插件当前版本号 (读取 package.json)
   */
  public getLocalVersion(): string {
    try {
      const pkgPath = path.join(this.pluginRoot, 'package.json');
      if (fs.existsSync(pkgPath)) {
        const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
        if (pkg.version) return pkg.version;
      }
    } catch {}
    return '2.0.0';
  }

  /**
   * 执行所有镜像 3 秒持续吞吐实测竞速
   */
  public async raceMirrors(): Promise<MirrorSpeedResult[]> {
    const mirrors = getDefaultMirrors(this.repo, this.customHuaweiUrl);
    return await MirrorSpeedTester.raceAllMirrors(mirrors, 'feed/manifest.json', 2800);
  }

  /**
   * 检查 GitHub 是否有新版本 (内置多镜像容错下载 manifest.json)
   */
  public async checkForUpdate(
    currentVersion?: string,
    forceRefresh: boolean = false
  ): Promise<UpdateCheckResult> {
    const localVer = currentVersion || this.getLocalVersion();
    const now = Date.now();
    // 默认 15 分钟内复用检测缓存 (除非显式 forceRefresh)
    if (!forceRefresh && this.cachedCheckResult && now - this.lastCheckTime < 15 * 60 * 1000) {
      return this.cachedCheckResult;
    }

    this.currentProgress = { phase: 'checking', percent: 10 };
    const mirrors = getDefaultMirrors(this.repo, this.customHuaweiUrl);

    let manifest: ReleaseManifest | null = null;
    let fetchError = '';

    // 尝试拉取 feed/manifest.json
    for (const mirror of mirrors) {
      const url = mirror.resolveUrl('feed/manifest.json');
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 5000);
        const res = await fetch(url, {
          headers: { 'User-Agent': 'CodeGraph-Updater/2.0.0', 'Cache-Control': 'no-cache' },
          signal: controller.signal,
        });
        clearTimeout(timeout);

        if (res.ok) {
          const text = await res.text();
          manifest = JSON.parse(text) as ReleaseManifest;
          if (manifest && manifest.version && Array.isArray(manifest.files)) {
            break;
          }
        }
      } catch (e: any) {
        fetchError = e.message || '网络拉取失败';
      }
    }

    if (!manifest) {
      this.currentProgress = { phase: 'error', percent: 0, error: `获取版本清单失败: ${fetchError}` };
      return {
        hasUpdate: false,
        currentVersion: localVer,
        latestVersion: localVer,
        notes: `检测失败: 未能从任何镜像源拉取到更新清单 (${fetchError})`,
      };
    }

    const hasUpdate = compareVersions(manifest.version, localVer) > 0;

    const result: UpdateCheckResult = {
      hasUpdate,
      currentVersion: localVer,
      latestVersion: manifest.version,
      publishedAt: manifest.publishedAt,
      notes: manifest.notes || '常规功能维护与性能优化',
      manifest,
    };

    this.cachedCheckResult = result;
    this.lastCheckTime = now;
    this.currentProgress = { phase: 'idle', percent: 100 };
    return result;
  }

  /**
   * 执行完整的更新流程：增量比对 -> 3秒竞速择优 -> Staging下载校验 -> 备份 -> 原子替换
   */
  public async applyUpdate(
    manifest: ReleaseManifest,
    onProgress?: (progress: UpdateProgress) => void
  ): Promise<{ success: boolean; updatedFilesCount: number; message: string }> {
    const notify = (p: Partial<UpdateProgress>) => {
      this.currentProgress = { ...this.currentProgress, ...p };
      if (onProgress) onProgress(this.currentProgress);
    };

    const stageDir = path.join(this.pluginRoot, '.codegraph-update-stage');
    const backupDir = path.join(this.pluginRoot, '.codegraph-update-backup');

    try {
      // =======================================================================
      // 步骤 1: 增量比对 (比对本地文件的 SHA256，仅提取变更/缺失的文件)
      // =======================================================================
      notify({ phase: 'checking', percent: 5 });
      const changedFiles: ManifestFileEntry[] = [];

      for (const entry of manifest.files) {
        const localPath = path.join(this.pluginRoot, entry.path);
        if (!fs.existsSync(localPath)) {
          changedFiles.push(entry);
          continue;
        }

        try {
          const stat = fs.statSync(localPath);
          if (stat.size !== entry.size) {
            changedFiles.push(entry);
            continue;
          }
          const hash = sha256File(localPath);
          if (hash !== entry.sha256) {
            changedFiles.push(entry);
          }
        } catch {
          changedFiles.push(entry);
        }
      }

      console.log(`[CodeGraph Updater] 增量比对完成: 共 ${manifest.files.length} 个清单文件，需更新 ${changedFiles.length} 个文件`);

      if (changedFiles.length === 0) {
        notify({ phase: 'completed', percent: 100 });
        return { success: true, updatedFilesCount: 0, message: '当前所有文件均已是最新状态，无需覆盖更新。' };
      }

      // =======================================================================
      // 步骤 2: 3 秒持续吞吐实测竞速 (评选当前真带宽最高的最优源)
      // =======================================================================
      notify({ phase: 'racing', percent: 15 });
      const mirrors = getDefaultMirrors(this.repo, this.customHuaweiUrl);
      const raceResults = await MirrorSpeedTester.raceAllMirrors(mirrors, 'feed/manifest.json', 2800);

      // 过滤出成功的镜像 (保留华为兜底源作为终极备选)
      const validMirrors = mirrors.filter((m) => {
        const r = raceResults.find((res) => res.id === m.id);
        return r && r.success;
      });

      // 确保华为源始终在候选池末尾兜底
      const huaweiMirror = mirrors.find((m) => m.id === 'huawei_fallback');
      if (huaweiMirror && !validMirrors.some((m) => m.id === 'huawei_fallback')) {
        validMirrors.push(huaweiMirror);
      }

      if (validMirrors.length === 0) {
        throw new Error('所有下载镜像实测均不可用，请检查网络连接或自定义华为镜像');
      }

      const bestMirror = validMirrors[0];
      const bestRace = raceResults.find((r) => r.id === bestMirror.id);
      console.log(`[CodeGraph Updater] 本次更新采用主力源: ${bestMirror.name} (持续速度: ${bestRace?.speedFormatted || '未知'})`);

      // =======================================================================
      // 步骤 3: Staging 临时安全下载 (带 3 次重试与顺位降级)
      // =======================================================================
      if (fs.existsSync(stageDir)) fs.rmSync(stageDir, { recursive: true, force: true });
      fs.mkdirSync(stageDir, { recursive: true });

      let completedFiles = 0;
      let totalDownloadedBytes = 0;
      const totalBytes = changedFiles.reduce((acc, f) => acc + f.size, 0);

      const downloadStartTime = Date.now();

      for (const file of changedFiles) {
        const stageTarget = path.join(stageDir, file.path);
        fs.mkdirSync(path.dirname(stageTarget), { recursive: true });

        notify({
          phase: 'downloading',
          percent: 20 + Math.round((completedFiles / changedFiles.length) * 55),
          totalFiles: changedFiles.length,
          completedFiles,
          totalBytes,
          downloadedBytes: totalDownloadedBytes,
          currentFile: file.path,
          activeMirrorName: bestMirror.name,
        });

        let downloadSuccess = false;
        let lastDownloadErr = '';

        // 镜像重试与顺位降级循环
        for (let mIdx = 0; mIdx < validMirrors.length; mIdx++) {
          const currentMirror = validMirrors[mIdx];
          const downloadUrl = currentMirror.resolveUrl(file.path);

          for (let attempt = 1; attempt <= 3; attempt++) {
            try {
              const controller = new AbortController();
              const timeout = setTimeout(() => controller.abort(), 20000);
              const res = await fetch(downloadUrl, {
                headers: { 'User-Agent': 'CodeGraph-Updater/2.0.0' },
                signal: controller.signal,
              });
              clearTimeout(timeout);

              if (!res.ok) {
                throw new Error(`HTTP ${res.status}`);
              }

              const buffer = Buffer.from(await res.arrayBuffer());

              // 严格校验大小与哈希
              if (buffer.length !== file.size) {
                throw new Error(`文件大小不符 (实际: ${buffer.length}, 期望: ${file.size})`);
              }
              const calcHash = crypto.createHash('sha256').update(buffer).digest('hex');
              if (calcHash !== file.sha256) {
                throw new Error('文件 SHA-256 完整性校验未通过');
              }

              fs.writeFileSync(stageTarget, buffer);
              totalDownloadedBytes += buffer.length;
              completedFiles++;
              downloadSuccess = true;

              const elapsedSec = Math.max((Date.now() - downloadStartTime) / 1000, 0.5);
              const currentSpeed = Math.round(totalDownloadedBytes / elapsedSec);

              notify({
                downloadedBytes: totalDownloadedBytes,
                completedFiles,
                speedBps: currentSpeed,
                speedFormatted: formatSpeed(currentSpeed),
              });
              break;
            } catch (err: any) {
              lastDownloadErr = err.message || '传输失败';
              await new Promise((r) => setTimeout(r, 400 * attempt));
            }
          }

          if (downloadSuccess) break;
          console.warn(`[CodeGraph Updater] 镜像 [${currentMirror.name}] 下载 ${file.path} 失败，尝试顺位切换到下一个镜像...`);
        }

        if (!downloadSuccess) {
          throw new Error(`下载文件 [${file.path}] 失败: ${lastDownloadErr}`);
        }
      }

      // =======================================================================
      // 步骤 4: 完整性二次复验 (Verify Staged)
      // =======================================================================
      notify({ phase: 'verifying', percent: 80 });
      for (const file of changedFiles) {
        const stageTarget = path.join(stageDir, file.path);
        if (!fs.existsSync(stageTarget)) throw new Error(`暂存文件缺失: ${file.path}`);
        const hash = sha256File(stageTarget);
        if (hash !== file.sha256) throw new Error(`暂存文件哈希偏差: ${file.path}`);
      }

      // =======================================================================
      // 步骤 5: 安全备份当前版本 (Backup Current)
      // =======================================================================
      notify({ phase: 'installing', percent: 85 });
      if (fs.existsSync(backupDir)) fs.rmSync(backupDir, { recursive: true, force: true });
      fs.mkdirSync(backupDir, { recursive: true });

      for (const file of changedFiles) {
        const localPath = path.join(this.pluginRoot, file.path);
        if (fs.existsSync(localPath)) {
          const backupTarget = path.join(backupDir, file.path);
          fs.mkdirSync(path.dirname(backupTarget), { recursive: true });
          fs.copyFileSync(localPath, backupTarget);
        }
      }

      // =======================================================================
      // 步骤 6: 原子替换 (Atomic Swap with Windows Rename Retry)
      // =======================================================================
      notify({ phase: 'installing', percent: 90 });
      try {
        for (const file of changedFiles) {
          const stageSource = path.join(stageDir, file.path);
          const finalTarget = path.join(this.pluginRoot, file.path);
          const tempTarget = `${finalTarget}.cg-new`;

          fs.mkdirSync(path.dirname(finalTarget), { recursive: true });
          fs.copyFileSync(stageSource, tempTarget);
          await renameWithRetry(tempTarget, finalTarget);
        }

        // 更新本地 package.json 声明版本
        const localPkgPath = path.join(this.pluginRoot, 'package.json');
        if (fs.existsSync(localPkgPath)) {
          try {
            const pkg = JSON.parse(fs.readFileSync(localPkgPath, 'utf-8'));
            pkg.version = manifest.version;
            fs.writeFileSync(localPkgPath, JSON.stringify(pkg, null, 2), 'utf-8');
          } catch {}
        }
      } catch (swapErr: any) {
        // 自愈回滚机制：发生异常时从备份目录全量还原
        console.error('[CodeGraph Updater] 替换中途发生异常，正在执行自愈回滚...', swapErr);
        for (const file of changedFiles) {
          const backupSource = path.join(backupDir, file.path);
          const finalTarget = path.join(this.pluginRoot, file.path);
          if (fs.existsSync(backupSource)) {
            try {
              fs.copyFileSync(backupSource, finalTarget);
            } catch {}
          }
        }
        throw new Error(`替换文件异常并已成功自愈回滚: ${swapErr.message}`);
      }

      // =======================================================================
      // 步骤 7: 清理临时目录并报告完成
      // =======================================================================
      try {
        fs.rmSync(stageDir, { recursive: true, force: true });
        fs.rmSync(backupDir, { recursive: true, force: true });
      } catch {}

      notify({ phase: 'completed', percent: 100 });
      this.cachedCheckResult = null; // 清空旧检查缓存

      return {
        success: true,
        updatedFilesCount: changedFiles.length,
        message: `✓ 成功增量升级至 v${manifest.version} (已安全替换 ${changedFiles.length} 个核心文件)`,
      };
    } catch (err: any) {
      notify({ phase: 'error', percent: 0, error: err.message || '更新失败' });
      // 清理临时目录
      try {
        if (fs.existsSync(stageDir)) fs.rmSync(stageDir, { recursive: true, force: true });
      } catch {}
      throw err;
    }
  }
}
