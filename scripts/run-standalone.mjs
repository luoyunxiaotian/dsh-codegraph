/**
 * dsh-codegraph 免安装 / 免构建独立运行器（Linux・macOS・Windows 通用）
 *
 * 【为什么有这个文件】本仓库上游的两种用法是：① 装进 DSH（cordis.patch.yml 引用）② 双击
 *   `start-codegraph.bat`（依赖 PowerShell 7 + 先 `pnpm install` + `pnpm build` 出
 *   `packages/core/dist/cli.js`）。本文件是**第三种、最轻的用法**：直接跑仓库里已带的预构建产物
 *   `dist/index.js`（npm 包 main），在普通 Node 进程里起它自带的 HTTP 服务与 webview ——
 *   **不装插件、不装依赖、不构建**，适合评估/试用或临时看某个工程的架构图谱。
 *
 * 原理：包的入口只导出 DSH 插件接口 `apply/inject/name`，而 `apply(ctx, config)` 内部就是
 *   `new CodeGraphServer({ workspaceRoot, port, scopePath, staticDir }).start()` —— 所以给一个
 *   最小可用的 ctx 垫片（apply 只用到 `on('dispose')`，可选 `tools.register`）即可独立起服务。
 *
 * 用法（在仓库根目录执行）：
 *   node scripts/run-standalone.mjs <目标代码目录> [端口]
 * 例：
 *   node scripts/run-standalone.mjs ../dsh-git-push 3333
 *   node scripts/run-standalone.mjs . 3333          # 分析本仓库自身
 *
 * 说明：服务只监听本机；Ctrl+C 退出（会触发插件注册的 dispose 优雅关闭）。
 */
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const pluginDir = resolve(here, '..'); // 本文件在 <repo>/scripts/ 下 → 仓库根即插件目录

const [targetArg, portArg] = process.argv.slice(2);
if (!targetArg) {
  console.error('用法: node scripts/run-standalone.mjs <目标代码目录> [端口]');
  process.exit(2);
}
const targetDir = resolve(targetArg);
const port = Number(portArg || 3333);

if (!existsSync(targetDir)) {
  console.error(`目标目录不存在: ${targetDir}`);
  process.exit(2);
}
const entry = join(pluginDir, 'dist', 'index.js');
if (!existsSync(entry)) {
  console.error(`找不到预构建产物 ${entry} —— 请先 \`pnpm install && pnpm run build\`（或改用上游的独立模式脚本）。`);
  process.exit(2);
}

const mod = await import(pathToFileURL(entry).href);
console.log(`[standalone] 插件: ${mod.name}（导出 ${Object.keys(mod).join(', ')}）`);

// 最小 ctx 垫片：只提供 apply() 真正用到的能力（生命周期 on + 工具注册 + 工作区查询）
const registeredTools = [];
const ctx = {
  on: () => {},
  tools: { register: (t) => { registeredTools.push(t); } },
  workspaceRegistry: { list: () => [{ path: targetDir }] },
  log: console,
};

mod.apply(ctx, { workspaceRoot: targetDir, port });
console.log(`[standalone] 目标目录: ${targetDir}`);
console.log(`[standalone] 交互视窗: http://127.0.0.1:${port}`);
console.log(`[standalone] Agent 工具: ${registeredTools.map((t) => t.name).join(', ') || '（无）'}`);

const shutdown = () => { console.log('[standalone] 收到退出信号，关闭中…'); process.exit(0); };
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
