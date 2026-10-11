export interface ManifestFileEntry {
  path: string;
  size: number;
  sha256: string;
}

export interface ReleaseManifest {
  version: string;
  publishedAt: string;
  notes?: string;
  minSupported?: string;
  files: ManifestFileEntry[];
  signature?: string;
}

export interface MirrorEndpoint {
  id: string;
  name: string;
  type: 'proxy' | 'raw' | 'cdn' | 'huawei_fallback';
  /**
   * 将目标 raw/github 路径转换为该镜像的具体访问 URL
   */
  resolveUrl: (relativePath: string) => string;
  isFallback?: boolean;
}

export interface MirrorSpeedResult {
  id: string;
  name: string;
  speedBps: number; // 持续下载吞吐率 (字节/秒)
  speedFormatted: string; // 如 "4.2 MB/s"
  latencyMs: number;
  success: boolean;
  error?: string;
  isFallback?: boolean;
}

export interface UpdateCheckResult {
  hasUpdate: boolean;
  currentVersion: string;
  latestVersion: string;
  publishedAt?: string;
  notes?: string;
  manifest?: ReleaseManifest;
  fastestMirror?: MirrorSpeedResult;
  allMirrors?: MirrorSpeedResult[];
}

export interface UpdateProgress {
  phase: 'idle' | 'checking' | 'racing' | 'downloading' | 'verifying' | 'installing' | 'completed' | 'error';
  percent: number; // 0 - 100
  totalFiles?: number;
  completedFiles?: number;
  totalBytes?: number;
  downloadedBytes?: number;
  speedBps?: number;
  speedFormatted?: string;
  currentFile?: string;
  activeMirrorName?: string;
  error?: string;
}
