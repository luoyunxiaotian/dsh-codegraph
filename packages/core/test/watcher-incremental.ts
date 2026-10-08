/**
 * 增量变更检测回归测试（DualTrackWatcher）。
 *
 * 背景（本用例要钉死的缺陷）：`detectChanges()` 原先优先走 `git status --porcelain -uall`，
 *   而它只反映**工作区未提交**的改动；一旦某次扫描后把改动 `git commit` 了，快路径返回空，
 *   且 `if (gitChanges) return` 会短路掉哈希兜底 —— 于是图谱静默陈旧（用户改了→提交了→图谱没变）。
 *
 * 判据（修复后必须成立）：
 *   ① 未提交的工作区改动 → 检出 modified
 *   ② **已提交**的改动 → 必须检出 modified（修复前为空，即本用例的主要红点）
 *   ③ 重命名（`git mv` 并提交）→ 必须检出条目（`R` 码此前被忽略）
 *   ④ 无任何变更 → 返回空（不能因修复而永远报「有变更」）
 *
 * 路径全部由 `import.meta.url` / `os.tmpdir()` 派生，不硬编码绝对路径。
 */
import fs from 'fs';
import os from 'os';
import path from 'path';
import { execFileSync } from 'child_process';
import { fileURLToPath } from 'url';

import { DualTrackWatcher } from '../src/watcher/hash-watcher.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/** 在指定目录执行 git（失败直接抛，测试要看到真实错误）。 */
function git(cwd: string, args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf-8' });
}

/** 断言数组包含某文件（相对路径，正斜杠）。 */
function assertHas(list: string[], file: string, what: string): void {
  if (!list.includes(file)) {
    throw new Error(`${what}: 期望检出 ${file}，实际 ${JSON.stringify(list)}`);
  }
}

/** 断言变更集为空。 */
function assertEmpty(c: { added: string[]; modified: string[]; deleted: string[] }, what: string): void {
  const n = c.added.length + c.modified.length + c.deleted.length;
  if (n !== 0) {
    throw new Error(`${what}: 期望无变更，实际 added=${JSON.stringify(c.added)} modified=${JSON.stringify(c.modified)} deleted=${JSON.stringify(c.deleted)}`);
  }
}

/** 断言变更集非空。 */
function assertNonEmpty(c: { added: string[]; modified: string[]; deleted: string[] }, what: string): void {
  const n = c.added.length + c.modified.length + c.deleted.length;
  if (n === 0) throw new Error(`${what}: 期望检出变更，实际为空`);
}

/** 主入口：由 packages/core/test/run.ts 调用。 */
export async function runWatcherIncrementalTests(): Promise<void> {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'codegraph-watcher-'));
  const globs = ['**/*.ts'];
  try {
    git(root, ['init', '-q']);
    git(root, ['config', 'user.email', 'test@example.com']);
    git(root, ['config', 'user.name', 'codegraph-test']);
    fs.writeFileSync(path.join(root, 'a.ts'), 'export const a = 1;\n');
    fs.writeFileSync(path.join(root, 'b.ts'), 'export const b = 2;\n');
    git(root, ['add', '-A']);
    git(root, ['commit', '-qm', 'init']);

    const watcher = new DualTrackWatcher(root, '.');
    await watcher.buildBaseline(globs);

    // ① 无变更 → 空
    assertEmpty(await watcher.detectChanges(globs), '基线刚建完');

    // ② 未提交的工作区改动 → modified
    fs.writeFileSync(path.join(root, 'a.ts'), 'export const a = 11;\n');
    const uncommitted = await watcher.detectChanges(globs);
    assertHas(uncommitted.modified, 'a.ts', '未提交改动');

    // ③ 已提交的改动 → 必须检出（修复前这里为空）
    git(root, ['add', '-A']);
    git(root, ['commit', '-qm', 'change a']);
    assertEmpty(await watcher.detectChanges(globs), '提交后无新改动');

    fs.writeFileSync(path.join(root, 'b.ts'), 'export const b = 22;\n');
    git(root, ['add', '-A']);
    git(root, ['commit', '-qm', 'change b']);
    const committed = await watcher.detectChanges(globs);
    assertHas(committed.modified, 'b.ts', '已提交的改动（本用例主要红点）');

    // ④ 重命名（提交）→ 至少要有条目；`R` 码此前完全被忽略
    git(root, ['mv', 'b.ts', 'c.ts']);
    git(root, ['commit', '-qm', 'rename b -> c']);
    const renamed = await watcher.detectChanges(globs);
    assertNonEmpty(renamed, '重命名后（R 码）');
    // 重命名语义：旧名算删除、新名算新增（或至少被算作 modified 之一）
    const renamedSeen = [...renamed.added, ...renamed.modified, ...renamed.deleted];
    if (!renamedSeen.includes('c.ts') && !renamedSeen.includes('b.ts')) {
      throw new Error(`重命名: 期望看到 b.ts/c.ts 之一，实际 ${JSON.stringify(renamedSeen)}`);
    }

    console.log('  ✓ 增量检测：未提交改动 / 已提交改动 / 重命名 均能被检出，且无变更时不误报');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}
