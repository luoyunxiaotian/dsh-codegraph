import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { execSync, execFileSync } from 'child_process';
import fg from 'fast-glob';
import { ExtractorRegistry } from '../parser/extractor-registry.js';

/** 变更类型（增量更新只关心这三种）。 */
type ChangeKind = 'added' | 'modified' | 'deleted';

export interface FileChangeSet {
  added: string[];
  modified: string[];
  deleted: string[];
  isGitAccelerated: boolean;
}

export class DualTrackWatcher {
  private workspaceRoot: string;
  private scopePath: string;
  private hashMap: Map<string, string> = new Map(); // relativePath -> sha256
  private isGitRepo: boolean = false;
  /**
   * 上次扫描时的 HEAD（`git rev-parse HEAD`）。
   *
   * 增量判据要用「上次扫描点 .. 当前 HEAD」的**提交区间** —— 只跑 `git status` 会漏掉
   * 「扫描之后被 commit」的改动（快路径返回空，图谱静默陈旧）。
   * 空字符串表示尚无基线（非 git 仓库 / 首次运行 / 空仓库无 HEAD）→ 落回 Hash 内容比对通道。
   */
  private lastScannedCommit: string = '';

  constructor(workspaceRoot: string, scopePath: string = '.') {
    this.workspaceRoot = path.resolve(workspaceRoot);
    this.scopePath = scopePath;
    this.checkGitAvailability();
  }

  private checkGitAvailability(): void {
    const gitDir = path.join(this.workspaceRoot, '.git');
    this.isGitRepo = fs.existsSync(gitDir);
  }

  /**
   * 计算单文件的 SHA-256 哈希值
   */
  public static computeFileHash(filePath: string): string {
    const content = fs.readFileSync(filePath);
    return crypto.createHash('sha256').update(content).digest('hex');
  }

  /**
   * 扫描指定范围目录下的所有代码文件并构建初始哈希基准表
   */
  public async buildBaseline(patterns?: string[]): Promise<Map<string, string>> {
    const globs = patterns && patterns.length > 0 ? patterns : ExtractorRegistry.getGlobPatterns();
    const searchRoot = path.resolve(this.workspaceRoot, this.scopePath);
    const files = await fg(globs, {
      cwd: searchRoot,
      absolute: false,
      caseSensitiveMatch: false,
      ignore: [
        '**/node_modules/**',
        '**/.git/**',
        '**/venv/**',
        '**/.venv/**',
        '**/__pycache__/**',
        '**/dist/**',
        '**/build/**',
        '**/target/**',
        '**/bin/**',
        '**/obj/**',
        '**/out/**',
        '**/.vs/**',
        '**/.idea/**',
        '**/.vscode/**',
      ],
    });

    this.hashMap.clear();
    for (const relFile of files) {
      // 统一转换为相对于工作区根目录的规范路径
      const workspaceRelPath = path
        .relative(this.workspaceRoot, path.join(searchRoot, relFile))
        .replace(/\\/g, '/');
      const fullPath = path.join(this.workspaceRoot, workspaceRelPath);
      try {
        const hash = DualTrackWatcher.computeFileHash(fullPath);
        this.hashMap.set(workspaceRelPath, hash);
      } catch (err) {
        // 忽略可能存在的读取权限异常
      }
    }

    // 记录基线对应的提交点：之后所有增量判据都从「这个提交之后」开始算（含已提交的改动）
    this.lastScannedCommit = this.currentHead();
    return new Map(this.hashMap);
  }

  /**
   * 增量变更检测：优先 Git 快路径（**提交区间 ∪ 工作区状态**），不可用时兜底 Hash 内容比对。
   */
  public async detectChanges(patterns?: string[]): Promise<FileChangeSet> {
    const globs = patterns && patterns.length > 0 ? patterns : ExtractorRegistry.getGlobPatterns();
    // 1. Git 快路径：需要「是 git 仓库」且「已有基线提交点」，否则无法界定提交区间
    if (this.isGitRepo && this.lastScannedCommit) {
      try {
        const gitChanges = this.detectViaGit();
        const total = gitChanges.added.length + gitChanges.modified.length + gitChanges.deleted.length;
        // 快路径为空**且**哈希基线非空（说明确实没有变化）→ 直接返回；
        // 哈希基线为空（如进程重启后首次增量）→ 落 Hash 通道重建，避免「以为没变」
        if (total > 0 || this.hashMap.size > 0) {
          this.applyChangesToHashMap(gitChanges);
          // 基线推进到当前 HEAD：已提交的改动本次已算过，避免下次重复报同一批文件
          this.lastScannedCommit = this.currentHead() || this.lastScannedCommit;
          return { ...gitChanges, isGitAccelerated: true };
        }
      } catch (err) {
        // Git 提取失败时无缝降级回退到全量 Hash 扫描
      }
    }

    // 2. 通用 Hash 纯内容对比通道 (无 Git 依赖)
    const hashChanges = await this.detectViaHash(globs);
    this.applyChangesToHashMap(hashChanges);
    this.lastScannedCommit = this.currentHead() || this.lastScannedCommit;
    return { ...hashChanges, isGitAccelerated: false };
  }

  /**
   * Git 快路径：**提交区间 ∪ 工作区状态**（缺任一会漏变更）。
   *
   * - 提交区间 `git diff --name-status <lastScannedCommit>..HEAD`：覆盖「上次扫描后被 commit」的改动
   *   （旧实现只跑 `git status`，这类改动完全检不到 —— 图谱静默陈旧）。
   * - 工作区状态 `git status --porcelain -uall`：覆盖未提交改动与未跟踪文件。
   * - 状态码按**首字符**分类（旧实现只枚举 `??/A/M/MM/AM/D`，`R`/`RM`/`UU`/`AD` 等全被忽略）。
   * - 同一文件出现在多处时按优先级归并：added > modified > deleted。
   */
  private detectViaGit(): FileChangeSet {
    const normScope = this.scopePath.replace(/\\/g, '/').replace(/^\.\//, '');
    const inScope = (file: string): boolean => {
      if (!ExtractorRegistry.getExtractorForFile(file)) return false;
      if (normScope && normScope !== '.' && !file.startsWith(normScope)) return false;
      return true;
    };
    const bucket = new Map<string, ChangeKind>();
    /**
     * 精修判据：git 只回答「哪些文件被碰过」，不回答「内容是否真的变了」。
     * 例：上次增量已应用过某文件（工作区改了但还没提交），本次提交后提交区间会**再报一次**；
     * 若不滤掉，同一文件会被重复解析。这里只对候选文件做一次内容哈希比对（成本可控）。
     * 已删除的文件无法比对 → 按变更处理；基线里没有的文件 → 视为新增/未知，按变更处理。
     */
    const isReallyChanged = (file: string): boolean => {
      const full = path.join(this.workspaceRoot, file);
      if (!fs.existsSync(full)) return true;
      const stored = this.hashMap.get(file);
      if (!stored) return true;
      return DualTrackWatcher.computeFileHash(full) !== stored;
    };
    const mark = (file: string, kind: ChangeKind): void => {
      const norm = file.replace(/\\/g, '/');
      if (!norm || !inScope(norm)) return;
      if (kind !== 'deleted' && !isReallyChanged(norm)) return; // 内容没变 → 不是真变更
      const prev = bucket.get(norm);
      if (prev === 'added' || prev === kind) return;
      if (prev === 'modified' && kind === 'deleted') return; // 修改优先于删除
      bucket.set(norm, kind);
    };

    // 1) 提交区间（含已提交的改动）
    const diffOut = this.execGit(['diff', '--name-status', `${this.lastScannedCommit}..HEAD`]);
    for (const item of DualTrackWatcher.parseNameStatus(diffOut)) mark(item.file, item.kind);

    // 2) 工作区状态（未提交 + 未跟踪）
    const statusOut = this.execGit(['status', '--porcelain', '-uall']);
    for (const item of DualTrackWatcher.parsePorcelain(statusOut)) mark(item.file, item.kind);

    const added: string[] = [];
    const modified: string[] = [];
    const deleted: string[] = [];
    for (const [file, kind] of bucket.entries()) {
      if (kind === 'added') added.push(file);
      else if (kind === 'deleted') deleted.push(file);
      else modified.push(file);
    }
    return { added, modified, deleted, isGitAccelerated: true };
  }

  /** 解析 `git diff --name-status` 输出（重命名/复制按「旧路径删除 + 新路径新增」）。 */
  private static parseNameStatus(output: string): Array<{ file: string; kind: ChangeKind }> {
    const out: Array<{ file: string; kind: ChangeKind }> = [];
    for (const line of output.split('\n')) {
      const cols = line.split('\t').map((s) => s.trim()).filter(Boolean);
      if (cols.length < 2) continue;
      const code = cols[0].charAt(0).toUpperCase();
      if (code === 'R' || code === 'C') {
        if (cols[1]) out.push({ file: cols[1], kind: 'deleted' });
        if (cols[2]) out.push({ file: cols[2], kind: 'added' });
      } else if (code === 'A') {
        out.push({ file: cols[1], kind: 'added' });
      } else if (code === 'D') {
        out.push({ file: cols[1], kind: 'deleted' });
      } else if (code === 'M' || code === 'T') {
        out.push({ file: cols[1], kind: 'modified' });
      }
    }
    return out;
  }

  /** 解析 `git status --porcelain -uall` 输出（**按首字符**分类，不枚举组合码）。 */
  private static parsePorcelain(output: string): Array<{ file: string; kind: ChangeKind }> {
    const out: Array<{ file: string; kind: ChangeKind }> = [];
    for (const rawLine of output.split('\n')) {
      const line = rawLine.replace(/\r$/, '');
      if (line.trim().length === 0) continue;
      const code = line.substring(0, 2);
      const rest = line.substring(3).trim();
      if (!rest) continue;
      if (code.charAt(0) === 'R' || code.charAt(0) === 'C') {
        const [oldPath, newPath] = rest.split(' -> ').map((s) => s.trim());
        if (oldPath) out.push({ file: oldPath, kind: 'deleted' });
        if (newPath) out.push({ file: newPath, kind: 'added' });
        continue;
      }
      if (code === '??' || code.charAt(0) === 'A') out.push({ file: rest, kind: 'added' });
      else if (code.charAt(0) === 'D') out.push({ file: rest, kind: 'deleted' });
      else out.push({ file: rest, kind: 'modified' }); // M/T/U 等一律按修改处理（冲突交由后续解析）
    }
    return out;
  }

  /** 执行 git 并返回 stdout（失败抛错，由调用方决定是否降级到 Hash 通道）。 */
  private execGit(args: string[]): string {
    return execFileSync('git', args, {
      cwd: this.workspaceRoot,
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
  }

  /** 当前 HEAD 的 sha（非 git / 空仓库无 HEAD 时返回空串）。 */
  private currentHead(): string {
    if (!this.isGitRepo) return '';
    try {
      return execFileSync('git', ['rev-parse', 'HEAD'], {
        cwd: this.workspaceRoot,
        encoding: 'utf-8',
        stdio: ['ignore', 'pipe', 'ignore'],
      }).trim();
    } catch {
      return '';
    }
  }

  private async detectViaHash(patterns: string[]): Promise<FileChangeSet> {
    const searchRoot = path.resolve(this.workspaceRoot, this.scopePath);
    const currentFiles = await fg(patterns, {
      cwd: searchRoot,
      absolute: false,
      caseSensitiveMatch: false,
      ignore: [
        '**/node_modules/**',
        '**/.git/**',
        '**/venv/**',
        '**/.venv/**',
        '**/__pycache__/**',
        '**/dist/**',
        '**/build/**',
        '**/target/**',
        '**/bin/**',
        '**/obj/**',
        '**/out/**',
        '**/.vs/**',
        '**/.idea/**',
        '**/.vscode/**',
      ],
    });

    const currentMap = new Map<string, string>();
    for (const relFile of currentFiles) {
      const workspaceRelPath = path
        .relative(this.workspaceRoot, path.join(searchRoot, relFile))
        .replace(/\\/g, '/');
      const fullPath = path.join(this.workspaceRoot, workspaceRelPath);
      try {
        const hash = DualTrackWatcher.computeFileHash(fullPath);
        currentMap.set(workspaceRelPath, hash);
      } catch {}
    }

    const added: string[] = [];
    const modified: string[] = [];
    const deleted: string[] = [];

    // 检测新增与修改
    for (const [file, hash] of currentMap.entries()) {
      if (!this.hashMap.has(file)) {
        added.push(file);
      } else if (this.hashMap.get(file) !== hash) {
        modified.push(file);
      }
    }

    // 检测已删除
    for (const file of this.hashMap.keys()) {
      if (!currentMap.has(file)) {
        deleted.push(file);
      }
    }

    return { added, modified, deleted, isGitAccelerated: false };
  }

  private applyChangesToHashMap(changes: FileChangeSet): void {
    for (const del of changes.deleted) {
      this.hashMap.delete(del);
    }
    for (const addOrMod of [...changes.added, ...changes.modified]) {
      const fullPath = path.join(this.workspaceRoot, addOrMod);
      if (fs.existsSync(fullPath)) {
        this.hashMap.set(addOrMod, DualTrackWatcher.computeFileHash(fullPath));
      }
    }
  }

  public getTrackedFileCount(): number {
    return this.hashMap.size;
  }

  public getHashMap(): Record<string, string> {
    const map: Record<string, string> = {};
    for (const [key, value] of this.hashMap.entries()) {
      map[key] = value;
    }
    return map;
  }

  public setHashMap(map: Record<string, string>): void {
    this.hashMap.clear();
    for (const [key, value] of Object.entries(map)) {
      this.hashMap.set(key, value);
    }
  }
}
