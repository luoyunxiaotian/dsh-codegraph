import fs from 'fs';
import path from 'path';
import { FullGraphResult } from '../types/index.js';
import { LayoutResult } from '../layout/elk-layout.js';

export interface PersistentCacheData {
  version: number;
  savedAt: string;
  workspaceRoot: string;
  scopePath: string;
  graph: FullGraphResult;
  layout?: {
    architecture?: LayoutResult;
    drilldowns?: Record<string, { layout: LayoutResult; portEdges: any[]; version?: string }>;
  };
  baselineHashes: Record<string, string>;
  extractions?: Record<string, any>;
}

export const CACHE_DIR_NAME = '.codegraph';
export const CACHE_FILE_NAME = 'graph-cache.json';

/**
 * 获取工作区对应的 .codegraph 缓存目录
 */
export function getCacheDir(workspaceRoot: string): string {
  return path.join(path.resolve(workspaceRoot), CACHE_DIR_NAME);
}

/**
 * 获取工作区对应的图谱缓存文件路径
 */
export function getCacheFilePath(workspaceRoot: string): string {
  return path.join(getCacheDir(workspaceRoot), CACHE_FILE_NAME);
}

/**
 * 检查当前工作区是否已存在持久化图谱缓存
 */
export function hasCache(workspaceRoot: string): boolean {
  try {
    const filePath = getCacheFilePath(workspaceRoot);
    return fs.existsSync(filePath);
  } catch {
    return false;
  }
}

/**
 * 读取当前工作区的持久化图谱缓存
 */
export function loadCache(workspaceRoot: string): PersistentCacheData | null {
  try {
    const filePath = getCacheFilePath(workspaceRoot);
    if (!fs.existsSync(filePath)) {
      return null;
    }

    const content = fs.readFileSync(filePath, 'utf-8');
    const data = JSON.parse(content) as PersistentCacheData;
    if (data && data.graph && data.graph.architectureView) {
      return data;
    }
    return null;
  } catch (err) {
    console.warn(`[CodeGraph] 读取持久化缓存失败: ${workspaceRoot}`, err);
    return null;
  }
}

/**
 * 将图谱结果、布局数据与哈希基准持久化保存至工程根目录下的 .codegraph/graph-cache.json
 */
export function saveCache(workspaceRoot: string, data: PersistentCacheData): void {
  try {
    const resolvedRoot = path.resolve(workspaceRoot);
    const cacheDir = getCacheDir(resolvedRoot);
    if (!fs.existsSync(cacheDir)) {
      fs.mkdirSync(cacheDir, { recursive: true });
    }

    // 确保将 .codegraph/ 登记至目标仓库本地私有排除项 (.git/info/exclude) 避免提交污染工作区
    ensureGitignore(resolvedRoot);

    const targetPath = getCacheFilePath(resolvedRoot);
    const tmpPath = `${targetPath}.tmp`;
    const jsonStr = JSON.stringify(data);

    // 原子化安全写入：先写临时文件再原子重命名
    try {
      fs.writeFileSync(tmpPath, jsonStr, 'utf-8');
      if (fs.existsSync(targetPath)) {
        try {
          fs.unlinkSync(targetPath);
        } catch {}
      }
      fs.renameSync(tmpPath, targetPath);
    } catch {
      // 降级兜底直接覆写
      fs.writeFileSync(targetPath, jsonStr, 'utf-8');
      if (fs.existsSync(tmpPath)) {
        try {
          fs.unlinkSync(tmpPath);
        } catch {}
      }
    }

    console.log(`[CodeGraph] 图谱缓存已保存至: ${targetPath}`);
  } catch (err) {
    console.warn(`[CodeGraph] 保存图谱缓存失败: ${workspaceRoot}`, err);
  }
}

/**
 * 若目标目录为 Git 仓库，优先将 .codegraph/ 登记至 Git 本地私有排除文件 (.git/info/exclude)
 * 具备与 .gitignore 相同的忽略机制，且绝对不会修改用户的 .gitignore 或污染工作区 git status。
 */
export function ensureGitignore(workspaceRoot: string): void {
  try {
    const gitDir = path.join(workspaceRoot, '.git');
    if (!fs.existsSync(gitDir)) {
      return;
    }

    // 解析真实的 Git 数据目录 (兼容标准 Git 仓库、submodule 与 worktree)
    let actualGitDir = gitDir;
    try {
      const stat = fs.statSync(gitDir);
      if (stat.isFile()) {
        const gitFileContent = fs.readFileSync(gitDir, 'utf-8').trim();
        const match = gitFileContent.match(/^gitdir:\s*(.+)$/i);
        if (match) {
          actualGitDir = path.resolve(workspaceRoot, match[1].trim());
        }
      }
    } catch {}

    const infoDir = path.join(actualGitDir, 'info');
    if (!fs.existsSync(infoDir)) {
      fs.mkdirSync(infoDir, { recursive: true });
    }

    const excludePath = path.join(infoDir, 'exclude');
    let content = '';
    if (fs.existsSync(excludePath)) {
      content = fs.readFileSync(excludePath, 'utf-8');
    }

    const lines = content.split(/\r?\n/);
    const hasCodegraph = lines.some((line) => {
      const trimmed = line.trim();
      return (
        trimmed === '.codegraph' ||
        trimmed === '.codegraph/' ||
        trimmed === '/.codegraph' ||
        trimmed === '/.codegraph/'
      );
    });

    if (!hasCodegraph) {
      const endsWithNewline = content.length === 0 || content.endsWith('\n') || content.endsWith('\r\n');
      const appendContent = `${endsWithNewline ? '' : '\n'}# CodeGraph local cache\n.codegraph/\n`;
      fs.appendFileSync(excludePath, appendContent, 'utf-8');
      console.log(`[CodeGraph] 已为目标仓库自动登记本地排除规则 (.git/info/exclude: .codegraph/)`);
    }
  } catch (err) {
    console.warn(`[CodeGraph] 自动更新本地排除规则失败:`, err);
  }
}
