import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { execSync } from 'child_process';
import fg from 'fast-glob';

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
  public async buildBaseline(patterns: string[] = ['**/*.py']): Promise<Map<string, string>> {
    const searchRoot = path.resolve(this.workspaceRoot, this.scopePath);
    const files = await fg(patterns, {
      cwd: searchRoot,
      absolute: false,
      ignore: ['**/node_modules/**', '**/.git/**', '**/venv/**', '**/__pycache__/**', '**/dist/**', '**/build/**'],
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

    return new Map(this.hashMap);
  }

  /**
   * 增量变更检测：优先尝试 Git 差异加速，兜底运行 Hash 对比
   */
  public async detectChanges(patterns: string[] = ['**/*.py']): Promise<FileChangeSet> {
    // 1. 若当前存在 Git 仓库，优先走 Git 快速通道加速
    if (this.isGitRepo) {
      try {
        const gitChanges = this.detectViaGit();
        if (gitChanges) {
          this.applyChangesToHashMap(gitChanges);
          return { ...gitChanges, isGitAccelerated: true };
        }
      } catch (err) {
        // Git 提取失败时无缝降级回退到全量 Hash 扫描
      }
    }

    // 2. 通用 Hash 纯内容对比通道 (无 Git 依赖)
    const hashChanges = await this.detectViaHash(patterns);
    this.applyChangesToHashMap(hashChanges);
    return { ...hashChanges, isGitAccelerated: false };
  }

  private detectViaGit(): FileChangeSet | null {
    const cmd = 'git status --porcelain -uall';
    const output = execSync(cmd, { cwd: this.workspaceRoot, encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'] });
    const lines = output.split('\n').filter((l) => l.trim().length > 0);

    const added: string[] = [];
    const modified: string[] = [];
    const deleted: string[] = [];

    const normScope = this.scopePath.replace(/\\/g, '/').replace(/^\.\//, '');

    for (const line of lines) {
      const status = line.substring(0, 2).trim();
      const filePath = line.substring(3).trim().replace(/\\/g, '/');

      // 仅处理在 Scope 范围内的 Python 文件
      if (!filePath.endsWith('.py')) continue;
      if (normScope && normScope !== '.' && !filePath.startsWith(normScope)) continue;

      if (status === '??' || status === 'A') {
        added.push(filePath);
      } else if (status === 'M' || status === 'MM' || status === 'AM') {
        modified.push(filePath);
      } else if (status === 'D') {
        deleted.push(filePath);
      }
    }

    return { added, modified, deleted, isGitAccelerated: true };
  }

  private async detectViaHash(patterns: string[]): Promise<FileChangeSet> {
    const searchRoot = path.resolve(this.workspaceRoot, this.scopePath);
    const currentFiles = await fg(patterns, {
      cwd: searchRoot,
      absolute: false,
      ignore: ['**/node_modules/**', '**/.git/**', '**/venv/**', '**/__pycache__/**', '**/dist/**', '**/build/**'],
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
