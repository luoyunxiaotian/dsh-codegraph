import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { FullGraphResult } from '../types/index.js';
import { LayoutResult } from '../layout/elk-layout.js';

export interface ManifestCacheData {
  version: number;
  savedAt: string;
  workspaceRoot: string;
  scopePath: string;
  meta: any;
  architectureView: any;
  processFlows: any[];
  layout?: {
    architecture?: LayoutResult;
    drilldowns?: Record<string, { layout: LayoutResult; portEdges: any[]; version?: string }>;
  };
}

export interface SymbolsCacheData {
  allNodes: Record<string, any>;
  allEdges: any[];
}

export interface CompilerCacheData {
  baselineHashes: Record<string, string>;
  extractions?: Record<string, any>;
}

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
export const CACHE_FILE_NAME = 'graph-cache.json'; // 兼容旧版
export const MANIFEST_FILE_NAME = 'manifest.json';
export const SYMBOLS_FILE_NAME = 'symbols.json';
export const COMPILER_CACHE_FILE_NAME = 'compiler-cache.json';
export const ARCHITECTURE_DOC_NAME = 'architecture.md';
export const DRILLDOWNS_DIR_NAME = 'drilldowns';
export const CACHE_SUBDIR_NAME = 'cache';
export const FILES_SUBDIR_NAME = 'files';
export const HASHES_FILE_NAME = 'hashes.json';

/**
 * 获取工作区对应的 .codegraph 缓存目录
 */
export function getCacheDir(workspaceRoot: string): string {
  return path.join(path.resolve(workspaceRoot), CACHE_DIR_NAME);
}

/**
 * 获取工作区对应的图谱缓存文件路径 (旧版单文件)
 */
export function getCacheFilePath(workspaceRoot: string): string {
  return path.join(getCacheDir(workspaceRoot), CACHE_FILE_NAME);
}

export function getManifestFilePath(workspaceRoot: string): string {
  return path.join(getCacheDir(workspaceRoot), MANIFEST_FILE_NAME);
}

export function getSymbolsFilePath(workspaceRoot: string): string {
  return path.join(getCacheDir(workspaceRoot), SYMBOLS_FILE_NAME);
}

export function getCompilerCacheFilePath(workspaceRoot: string): string {
  return path.join(getCacheDir(workspaceRoot), COMPILER_CACHE_FILE_NAME);
}

export function getArchitectureDocPath(workspaceRoot: string): string {
  return path.join(getCacheDir(workspaceRoot), ARCHITECTURE_DOC_NAME);
}

export function getDrilldownsDir(workspaceRoot: string): string {
  return path.join(getCacheDir(workspaceRoot), DRILLDOWNS_DIR_NAME);
}

export function getDrilldownFilePath(workspaceRoot: string, moduleId: string): string {
  const safeId = moduleId.replace(/[^a-zA-Z0-9_\-\.]/g, '_');
  return path.join(getDrilldownsDir(workspaceRoot), `${safeId}.json`);
}

export function getCacheSubdir(workspaceRoot: string): string {
  return path.join(getCacheDir(workspaceRoot), CACHE_SUBDIR_NAME);
}

export function getHashesFilePath(workspaceRoot: string): string {
  return path.join(getCacheSubdir(workspaceRoot), HASHES_FILE_NAME);
}

export function getCacheFilesDir(workspaceRoot: string): string {
  return path.join(getCacheSubdir(workspaceRoot), FILES_SUBDIR_NAME);
}

/**
 * 检查当前工作区是否已存在持久化图谱缓存 (优先检测新版 manifest.json，回退检测旧版)
 */
export function hasCache(workspaceRoot: string): boolean {
  try {
    const manifestPath = getManifestFilePath(workspaceRoot);
    if (fs.existsSync(manifestPath)) return true;
    const legacyPath = getCacheFilePath(workspaceRoot);
    return fs.existsSync(legacyPath);
  } catch {
    return false;
  }
}

/**
 * 极速仅读取宏观架构 manifest.json (耗时 < 5ms，首屏极速加载专用)
 */
export function loadManifestOnly(workspaceRoot: string): ManifestCacheData | null {
  try {
    const manifestPath = getManifestFilePath(workspaceRoot);
    if (fs.existsSync(manifestPath)) {
      const content = fs.readFileSync(manifestPath, 'utf-8');
      return JSON.parse(content) as ManifestCacheData;
    }

    // 回退旧版读取并仅提取宏观部分
    const legacyPath = getCacheFilePath(workspaceRoot);
    if (fs.existsSync(legacyPath)) {
      const content = fs.readFileSync(legacyPath, 'utf-8');
      const data = JSON.parse(content) as PersistentCacheData;
      if (data && data.graph && data.graph.architectureView) {
        return {
          version: data.version || 1,
          savedAt: data.savedAt,
          workspaceRoot: data.workspaceRoot,
          scopePath: data.scopePath,
          meta: data.graph.meta,
          architectureView: data.graph.architectureView,
          processFlows: data.graph.processFlows,
          layout: data.layout,
        };
      }
    }
    return null;
  } catch (err) {
    console.warn(`[CodeGraph] 读取宏观 manifest 失败: ${workspaceRoot}`, err);
    return null;
  }
}

/**
 * 仅读取微观符号表 symbols.json (按需/后台预热专用)
 */
export function loadSymbolsOnly(workspaceRoot: string): SymbolsCacheData | null {
  try {
    const symbolsPath = getSymbolsFilePath(workspaceRoot);
    if (fs.existsSync(symbolsPath)) {
      const content = fs.readFileSync(symbolsPath, 'utf-8');
      return JSON.parse(content) as SymbolsCacheData;
    }

    // 回退旧版读取
    const legacyPath = getCacheFilePath(workspaceRoot);
    if (fs.existsSync(legacyPath)) {
      const content = fs.readFileSync(legacyPath, 'utf-8');
      const data = JSON.parse(content) as PersistentCacheData;
      if (data && data.graph) {
        return {
          allNodes: data.graph.allNodes || {},
          allEdges: data.graph.allEdges || [],
        };
      }
    }
    return null;
  } catch (err) {
    console.warn(`[CodeGraph] 读取微观 symbols 失败: ${workspaceRoot}`, err);
    return null;
  }
}

/**
 * 保存模块下钻独立分片布局 (.codegraph/drilldowns/<moduleId>.json)
 */
export function saveDrilldownLayout(
  workspaceRoot: string,
  moduleId: string,
  data: { layout: LayoutResult; portEdges: any[]; version?: string }
): void {
  try {
    const dir = getDrilldownsDir(workspaceRoot);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    const cacheDir = getCacheDir(workspaceRoot);
    const internalGitignore = path.join(cacheDir, '.gitignore');
    if (!fs.existsSync(internalGitignore)) {
      try { fs.writeFileSync(internalGitignore, "*\n", 'utf-8'); } catch {}
    }
    const filePath = getDrilldownFilePath(workspaceRoot, moduleId);
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
  } catch (err) {
    console.warn(`[CodeGraph] 保存模块下钻分片失败: ${moduleId}`, err);
  }
}

/**
 * 读取模块下钻独立分片布局 (优先分片文件，回退 manifest.json)
 */
export function loadDrilldownLayout(
  workspaceRoot: string,
  moduleId: string
): { layout: LayoutResult; portEdges: any[]; version?: string } | null {
  try {
    const filePath = getDrilldownFilePath(workspaceRoot, moduleId);
    if (fs.existsSync(filePath)) {
      const content = fs.readFileSync(filePath, 'utf-8');
      return JSON.parse(content);
    }
    // 回退旧版 manifest.json 中的 drilldowns
    const manifest = loadManifestOnly(workspaceRoot);
    if (manifest?.layout?.drilldowns?.[moduleId]) {
      return manifest.layout.drilldowns[moduleId];
    }
    return null;
  } catch (err) {
    console.warn(`[CodeGraph] 读取模块下钻分片失败: ${moduleId}`, err);
    return null;
  }
}

/**
 * 读取当前工作区的持久化图谱缓存 (优先解耦多文件与分片切片，回退旧版单文件)
 */
export function loadCache(workspaceRoot: string): PersistentCacheData | null {
  try {
    const manifestPath = getManifestFilePath(workspaceRoot);
    if (fs.existsSync(manifestPath)) {
      const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8')) as ManifestCacheData;
      const symbols = loadSymbolsOnly(workspaceRoot) || { allNodes: {}, allEdges: [] };
      
      let compilerCache: CompilerCacheData = { baselineHashes: {}, extractions: {} };
      const hashesPath = getHashesFilePath(workspaceRoot);
      const cacheFilesDir = getCacheFilesDir(workspaceRoot);

      if (fs.existsSync(hashesPath)) {
        try {
          const hashesData = JSON.parse(fs.readFileSync(hashesPath, 'utf-8'));
          const baselineHashes = hashesData.baselineHashes || {};
          const fileToHashMap: Record<string, string> = hashesData.fileToHashMap || {};
          const extractions: Record<string, any> = {};

          for (const [filePath, hash] of Object.entries(fileToHashMap)) {
            const shardPath = path.join(cacheFilesDir, `${hash}.json`);
            if (fs.existsSync(shardPath)) {
              try {
                extractions[filePath] = JSON.parse(fs.readFileSync(shardPath, 'utf-8'));
              } catch {}
            }
          }
          compilerCache = { baselineHashes, extractions };
        } catch {}
      } else {
        // 回退旧版单体 compiler-cache.json
        const compilerPath = getCompilerCacheFilePath(workspaceRoot);
        if (fs.existsSync(compilerPath)) {
          try {
            compilerCache = JSON.parse(fs.readFileSync(compilerPath, 'utf-8'));
          } catch {}
        }
      }

      const fullGraph: FullGraphResult = {
        meta: manifest.meta,
        architectureView: manifest.architectureView,
        processFlows: manifest.processFlows,
        allNodes: symbols.allNodes,
        allEdges: symbols.allEdges,
      };

      return {
        version: manifest.version || 2,
        savedAt: manifest.savedAt,
        workspaceRoot: manifest.workspaceRoot,
        scopePath: manifest.scopePath,
        graph: fullGraph,
        layout: manifest.layout,
        baselineHashes: compilerCache.baselineHashes,
        extractions: compilerCache.extractions,
      };
    }

    // 回退旧版单文件
    const legacyPath = getCacheFilePath(workspaceRoot);
    if (fs.existsSync(legacyPath)) {
      const content = fs.readFileSync(legacyPath, 'utf-8');
      const data = JSON.parse(content) as PersistentCacheData;
      if (data && data.graph && data.graph.architectureView) {
        return data;
      }
    }
    return null;
  } catch (err) {
    console.warn(`[CodeGraph] 读取持久化缓存失败: ${workspaceRoot}`, err);
    return null;
  }
}

/**
 * 自动生成通俗易懂、人类直接可读的架构白皮书 Markdown
 */
export function generateArchitectureMarkdown(
  projectName: string,
  workspaceRoot: string,
  manifest: ManifestCacheData
): string {
  const modules = manifest.architectureView?.modules || [];
  const buses = manifest.architectureView?.buses || [];
  const flows = manifest.processFlows || [];

  let md = `# 🏛️ ${projectName} 系统架构全景白皮书\n\n`;
  md += `> **工程名称**: ${projectName}  \n`;
  md += `> **根目录**: \`${workspaceRoot}\`  \n`;
  md += `> **生成时间**: ${manifest.savedAt || new Date().toISOString()}  \n`;
  md += `> **架构版本**: v2.0.0 (High Performance Decoupled)  \n\n`;
  md += `---\n\n`;

  // 1. Mermaid 架构流图
  md += `## 1. 宏观分层架构拓扑 (Mermaid)\n\n`;
  md += `\`\`\`mermaid\nflowchart TD\n`;
  for (const mod of modules) {
    const safeId = mod.id.replace(/[^a-zA-Z0-9_]/g, '_');
    const fileCount = mod.files?.length || 0;
    md += `  ${safeId}["📦 ${mod.name} (${fileCount} files)"]\n`;
  }
  for (const bus of buses) {
    const srcId = bus.sourceModule.replace(/[^a-zA-Z0-9_]/g, '_');
    const tgtId = bus.targetModule.replace(/[^a-zA-Z0-9_]/g, '_');
    const count = bus.callCount || 1;
    md += `  ${srcId} -->|"${count} calls"| ${tgtId}\n`;
  }
  md += `\`\`\`\n\n`;

  // 2. 核心架构模块清单
  md += `## 2. 核心架构模块清单\n\n`;
  md += `| 模块名称 | 职责定位 / 角色 | 源码文件数 | 所属工程/平台 | 对外端口 (InPorts) | 依赖端口 (OutPorts) |\n`;
  md += `| :--- | :--- | :---: | :---: | :---: | :---: |\n`;
  for (const mod of modules) {
    const role = (mod as any).story?.roleTitle || mod.archetype || '业务模块';
    const inCount = mod.inPorts?.length || 0;
    const outCount = mod.outPorts?.length || 0;
    const plat = mod.projectPlatform || '通用';
    md += `| **${mod.name}** | ${role} | ${mod.files?.length || 0} | ${plat} | ${inCount} 个 | ${outCount} 个 |\n`;
  }
  md += `\n`;

  // 3. 跨模块通信总线
  md += `## 3. 跨模块通信总线 (Module Buses)\n\n`;
  if (buses.length > 0) {
    md += `| 来源模块 | 目标模块 | 通信调用数 | 协议类型 / 契约说明 |\n`;
    md += `| :--- | :--- | :---: | :--- |\n`;
    for (const b of buses) {
      md += `| \`${b.sourceModule}\` | \`${b.targetModule}\` | ${b.callCount || 1} 次 | 跨模块代码调用 / 契约交互 |\n`;
    }
  } else {
    md += `*未检测到跨模块跨层调用，各模块高度内聚。*\n`;
  }
  md += `\n`;

  // 4. 端到端业务时序流
  if (flows.length > 0) {
    md += `## 4. 关键端到端时序流程 (Process Flows)\n\n`;
    for (const flow of flows) {
      md += `### 🔄 ${flow.name || flow.id}\n`;
      if (flow.steps && flow.steps.length > 0) {
        md += `- **步骤流转**: ${flow.steps.map((s: any) => `\`${s.caller || s.source}\` ➔ \`${s.callee || s.target}\``).join(' ➔ ')}\n`;
      }
      md += `\n`;
    }
  }

  return md;
}

/**
 * 将图谱结果分层解耦保存：
 * 1. manifest.json (标准 2 格缩进美化换行，几十 KB，极速秒读)
 * 2. symbols.json (按节点折行紧凑格式，剥离预烘焙 story 冗余，体积锐减 70%)
 * 3. compiler-cache.json (编译器独占 AST 抽取与增量哈希)
 * 4. architecture.md (自动生成高可读性 Markdown 架构文档)
 */
export function saveCache(workspaceRoot: string, data: PersistentCacheData): void {
  try {
    const resolvedRoot = path.resolve(workspaceRoot);
    const cacheDir = getCacheDir(resolvedRoot);
    if (!fs.existsSync(cacheDir)) {
      fs.mkdirSync(cacheDir, { recursive: true });
    }

    // 在 .codegraph 自身目录下写入自保护忽略规则，杜绝 DSH 宿主上下文引擎、ripgrep、全局文件索引器扫描分片文件
    try {
      const internalGitignore = path.join(cacheDir, '.gitignore');
      if (!fs.existsSync(internalGitignore)) {
        fs.writeFileSync(internalGitignore, "*\n", 'utf-8');
      }
      const internalIgnore = path.join(cacheDir, '.ignore');
      if (!fs.existsSync(internalIgnore)) {
        fs.writeFileSync(internalIgnore, "*\n", 'utf-8');
      }
    } catch {}

    // 登记私有排除规则
    ensureGitignore(resolvedRoot);

    // 1. 拆分 Manifest：剥离庞大 drilldowns，仅保留宏观架构布局，文件尺寸保持数十 KB 秒开
    const manifestLayout = data.layout?.architecture
      ? { architecture: data.layout.architecture }
      : undefined;

    // 若数据中带有下钻排版，逐个独立落盘至 .codegraph/drilldowns/<moduleId>.json
    if (data.layout?.drilldowns) {
      for (const [modId, drillData] of Object.entries(data.layout.drilldowns)) {
        saveDrilldownLayout(resolvedRoot, modId, drillData);
      }
    }

    const manifest: ManifestCacheData = {
      version: 2,
      savedAt: data.savedAt || new Date().toISOString(),
      workspaceRoot: data.workspaceRoot || resolvedRoot,
      scopePath: data.scopePath || '.',
      meta: data.graph.meta,
      architectureView: data.graph.architectureView,
      processFlows: data.graph.processFlows,
      layout: manifestLayout,
    };
    const manifestPath = getManifestFilePath(resolvedRoot);
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf-8');

    // 2. 瘦身并拆分 Symbols (剥离预烘焙长篇 story，仅保留 summaryText 与轻量角色标识)
    const slimNodes: Record<string, any> = {};
    for (const [id, node] of Object.entries(data.graph.allNodes || {})) {
      const { metadata, ...rest } = node as any;
      let slimMeta = metadata;
      if (metadata && metadata.story) {
        const { story, ...otherMeta } = metadata;
        slimMeta = {
          ...otherMeta,
          summaryText: story.summaryText,
          roleTitle: story.roleTitle,
        };
      }
      slimNodes[id] = { ...rest, metadata: slimMeta };
    }

    const nodeEntries = Object.entries(slimNodes).map(
      ([id, n]) => `    ${JSON.stringify(id)}: ${JSON.stringify(n)}`
    );
    const edgeEntries = (data.graph.allEdges || []).map((e) => `    ${JSON.stringify(e)}`);
    const symbolsContent = `{\n  "allNodes": {\n${nodeEntries.join(',\n')}\n  },\n  "allEdges": [\n${edgeEntries.join(',\n')}\n  ]\n}`;
    const symbolsPath = getSymbolsFilePath(resolvedRoot);
    fs.writeFileSync(symbolsPath, symbolsContent, 'utf-8');

    // 3. 拆分 Compiler Cache：按文件分片独立落盘 (Clangd 模式，每文件数 KB，彻底告别 50MB 巨石无换行)
    const cacheFilesDir = getCacheFilesDir(resolvedRoot);
    if (!fs.existsSync(cacheFilesDir)) {
      fs.mkdirSync(cacheFilesDir, { recursive: true });
    }

    const baselineHashes = data.baselineHashes || {};
    const fileToHashMap: Record<string, string> = {};

    if (data.extractions) {
      for (const [filePath, ext] of Object.entries(data.extractions)) {
        let hash = baselineHashes[filePath];
        if (!hash) {
          hash = crypto.createHash('sha256').update(filePath).digest('hex').slice(0, 32);
        }
        fileToHashMap[filePath] = hash;
        const shardPath = path.join(cacheFilesDir, `${hash}.json`);
        fs.writeFileSync(shardPath, JSON.stringify(ext, null, 2), 'utf-8');
      }
    }

    const hashesData = {
      version: 2,
      savedAt: data.savedAt || new Date().toISOString(),
      baselineHashes,
      fileToHashMap,
    };
    const hashesPath = getHashesFilePath(resolvedRoot);
    fs.writeFileSync(hashesPath, JSON.stringify(hashesData, null, 2), 'utf-8');

    // 清理旧版单体 compiler-cache.json (无损平滑迁移)
    const oldCompilerPath = getCompilerCacheFilePath(resolvedRoot);
    if (fs.existsSync(oldCompilerPath)) {
      try {
        fs.unlinkSync(oldCompilerPath);
      } catch {}
    }

    // 4. 自动生成架构 Markdown 白皮书
    const docPath = getArchitectureDocPath(resolvedRoot);
    const mdContent = generateArchitectureMarkdown(
      data.graph.meta?.projectName || path.basename(resolvedRoot),
      resolvedRoot,
      manifest
    );
    fs.writeFileSync(docPath, mdContent, 'utf-8');

    // 5. 安全清理旧版单一大文件 graph-cache.json (无损升级)
    const legacyPath = getCacheFilePath(resolvedRoot);
    if (fs.existsSync(legacyPath)) {
      try {
        fs.unlinkSync(legacyPath);
      } catch {}
    }

    console.log(`[CodeGraph] 图谱缓存已解耦分片保存至: ${cacheDir} (manifest, symbols, cache/files, drilldowns, architecture.md)`);
  } catch (err) {
    console.warn(`[CodeGraph] 保存解耦图谱缓存失败: ${workspaceRoot}`, err);
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
