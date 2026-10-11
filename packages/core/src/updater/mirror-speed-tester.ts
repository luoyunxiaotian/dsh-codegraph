import { MirrorEndpoint, MirrorSpeedResult } from './types.js';

export const DEFAULT_REPO = 'luoyunxiaotian/dsh-codegraph';

/**
 * 格式化字节速度为易读字符串 (如 "3.8 MB/s" 或 "512 KB/s")
 */
export function formatSpeed(bps: number): string {
  if (bps <= 0) return '0 B/s';
  if (bps < 1024) return `${bps} B/s`;
  if (bps < 1024 * 1024) return `${(bps / 1024).toFixed(1)} KB/s`;
  return `${(bps / (1024 * 1024)).toFixed(2)} MB/s`;
}

/**
 * 内置分级镜像源池配置 (包含 5 大主流国内 GitHub 代理/CDN + 华为云终极兜底)
 */
export function getDefaultMirrors(repo: string = DEFAULT_REPO, customHuaweiUrl?: string): MirrorEndpoint[] {
  const mirrors: MirrorEndpoint[] = [
    {
      id: 'ghproxy',
      name: 'GHProxy 高速镜像',
      type: 'proxy',
      resolveUrl: (rel) => `https://ghproxy.net/https://raw.githubusercontent.com/${repo}/main/${rel}`,
    },
    {
      id: 'mirror_ghproxy',
      name: 'Mirror-GHProxy 节点',
      type: 'proxy',
      resolveUrl: (rel) => `https://mirror.ghproxy.com/https://raw.githubusercontent.com/${repo}/main/${rel}`,
    },
    {
      id: 'gitmirror',
      name: 'GitMirror 同步源',
      type: 'raw',
      resolveUrl: (rel) => `https://raw.gitmirror.com/${repo}/main/${rel}`,
    },
    {
      id: 'gh_proxy_net',
      name: 'GH-Proxy 备用节点',
      type: 'proxy',
      resolveUrl: (rel) => `https://gh-proxy.com/https://raw.githubusercontent.com/${repo}/main/${rel}`,
    },
    {
      id: 'jsdelivr_cdn',
      name: 'jsDelivr 全球加速 CDN',
      type: 'cdn',
      resolveUrl: (rel) => `https://cdn.jsdelivr.net/gh/${repo}@main/${rel}`,
    },
    {
      id: 'huawei_fallback',
      name: '华为云开源镜像 (终极兜底)',
      type: 'huawei_fallback',
      isFallback: true,
      resolveUrl: (rel) => {
        if (customHuaweiUrl) {
          const base = customHuaweiUrl.replace(/\/+$/, '');
          return `${base}/${rel}`;
        }
        // 默认华为开源镜像加速端点与反代通道
        return `https://mirrors.huaweicloud.com/github-mirror/${repo}/main/${rel}`;
      },
    },
    {
      id: 'github_direct',
      name: 'GitHub 官方源 (直连)',
      type: 'raw',
      resolveUrl: (rel) => `https://raw.githubusercontent.com/${repo}/main/${rel}`,
    },
  ];

  return mirrors;
}

/**
 * 3 秒持续吞吐实测竞速器 (Sustained Download Throughput Racer)
 * 核心法则：拒绝假高响应 TTFB，跨越 TCP 慢启动，以 2.5~3 秒内实际下载的字节流吞吐量评选最优源。
 */
export class MirrorSpeedTester {
  /**
   * 对单个镜像执行持续流式测速
   */
  public static async testSingleMirror(
    mirror: MirrorEndpoint,
    sampleRelativePath: string = 'feed/manifest.json',
    windowMs: number = 2800,
    timeoutMs: number = 6000
  ): Promise<MirrorSpeedResult> {
    const targetUrl = mirror.resolveUrl(sampleRelativePath);
    const controller = new AbortController();
    const timeoutTimer = setTimeout(() => controller.abort(), timeoutMs);

    const startTime = Date.now();
    let firstByteTime = 0;
    let totalBytesReceived = 0;

    try {
      const response = await fetch(targetUrl, {
        headers: {
          'User-Agent': 'CodeGraph-Updater/2.0.0',
          'Cache-Control': 'no-cache',
        },
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status} ${response.statusText}`);
      }

      firstByteTime = Date.now();
      const latencyMs = firstByteTime - startTime;

      if (!response.body) {
        throw new Error('未获取到响应数据流 (Empty Body)');
      }

      const reader = response.body.getReader();
      const raceStartTime = Date.now();

      // 在持续时间窗口内不断累加实际传输的真实数据块
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value) {
          totalBytesReceived += value.length;
        }

        // 达到测速窗口时长 (2.8秒) 即主动结算，无需继续下载多余流量
        if (Date.now() - raceStartTime >= windowMs) {
          break;
        }
      }

      clearTimeout(timeoutTimer);
      try {
        await reader.cancel();
      } catch {}

      const durationSec = Math.max((Date.now() - raceStartTime) / 1000, 0.2);
      const speedBps = Math.round(totalBytesReceived / durationSec);

      return {
        id: mirror.id,
        name: mirror.name,
        speedBps,
        speedFormatted: formatSpeed(speedBps),
        latencyMs,
        success: true,
        isFallback: mirror.isFallback,
      };
    } catch (err: any) {
      clearTimeout(timeoutTimer);
      return {
        id: mirror.id,
        name: mirror.name,
        speedBps: 0,
        speedFormatted: '连接失败',
        latencyMs: 9999,
        success: false,
        error: err.name === 'AbortError' ? '连接超时' : (err.message || '网络异常'),
        isFallback: mirror.isFallback,
      };
    }
  }

  /**
   * 并发对所有镜像发起实测竞速，并输出速度排行榜
   */
  public static async raceAllMirrors(
    mirrors: MirrorEndpoint[],
    sampleRelativePath: string = 'feed/manifest.json',
    windowMs: number = 2800
  ): Promise<MirrorSpeedResult[]> {
    console.log(`[CodeGraph Updater] 正在对 ${mirrors.length} 个镜像节点启动 3 秒持续吞吐实测竞速...`);

    const results = await Promise.all(
      mirrors.map((m) => this.testSingleMirror(m, sampleRelativePath, windowMs))
    );

    // 排序逻辑：
    // 1. 成功优先于失败
    // 2. 持续下载速度 (speedBps) 降序排列
    // 3. 华为兜底源若成功，作为保底锚点
    results.sort((a, b) => {
      if (a.success && !b.success) return -1;
      if (!a.success && b.success) return 1;
      return b.speedBps - a.speedBps;
    });

    console.log('[CodeGraph Updater] 镜像实测竞速榜单:');
    results.forEach((r, idx) => {
      const tag = idx === 0 && r.success ? '🏆 [最优源]' : r.isFallback ? '🛡️ [兜底源]' : `[#${idx + 1}]`;
      console.log(`  ${tag} ${r.name.padEnd(26)} -> 持续速度: ${r.speedFormatted.padEnd(10)} 响应延迟: ${r.latencyMs}ms ${r.error ? `(${r.error})` : ''}`);
    });

    return results;
  }
}
