import fs from 'fs';
import path from 'path';
import {
  ProjectPlatform,
  DetectedProjectProfile,
  WorkspaceDiscoveryResult,
} from '../types/index.js';
import { sanitizeIdentifier } from '../parser/scip-utils.js';

export class WorkspaceProfiler {
  /**
   * 1. 系统关键路径与敏感盘符硬拦截检查
   */
  public static checkDangerousRoot(targetPath: string): { isDangerous: boolean; reason?: string } {
    const resolved = path.resolve(targetPath);
    const normalized = resolved.replace(/\\/g, '/');

    // 1.1 磁盘根目录拦截 (如 C:\, D:\, /)
    if (/^[a-zA-Z]:\/?$/.test(normalized) || normalized === '/') {
      return {
        isDangerous: true,
        reason: `您选择的是磁盘根目录 (${resolved})。为防止递归全盘导致系统卡死，请选择具体的开发项目子文件夹。`,
      };
    }

    // 1.2 系统级保护目录拦截
    const systemProtectedDirs = [
      'c:/windows',
      'c:/program files',
      'c:/program files (x86)',
      'c:/programdata',
      '/system',
      '/usr',
      '/etc',
      '/bin',
      '/sbin',
      '/var',
    ];

    const lower = normalized.toLowerCase();
    for (const sysDir of systemProtectedDirs) {
      if (lower === sysDir || lower.startsWith(sysDir + '/')) {
        return {
          isDangerous: true,
          reason: `路径 (${resolved}) 属于操作系统保护目录，不可作为代码分析工作区。`,
        };
      }
    }

    // 1.3 用户系统主目录拦截 (如 C:\Users\Username)
    // 检查是否直接包含了 Desktop, AppData, Documents 等顶级系统文件夹且根部没有任何项目描述文件
    if (/^[a-zA-Z]:\/users\/[^/]+$/i.test(normalized)) {
      try {
        const entries = fs.readdirSync(resolved);
        const hasSysFolders = entries.some((e) => /^(desktop|documents|appdata|downloads|pictures)$/i.test(e));
        const hasProjectAnchor = entries.some((e) =>
          /^(package\.json|go\.mod|pom\.xml|cargo\.toml|requirements\.txt|\.git)$/i.test(e)
        );
        if (hasSysFolders && !hasProjectAnchor) {
          return {
            isDangerous: true,
            reason: `您选择的是用户全局主目录 (${resolved})。请进入具体的子项目文件夹（如工作区或代码库）进行分析。`,
          };
        }
      } catch {}
    }

    return { isDangerous: false };
  }

  /**
   * 2. 多工程与多端画像智能嗅探
   */
  public static discover(workspaceRoot: string): WorkspaceDiscoveryResult {
    const root = path.resolve(workspaceRoot);
    const dangerCheck = this.checkDangerousRoot(root);
    if (dangerCheck.isDangerous) {
      return {
        isSingleProject: false,
        hasDangerousRoot: true,
        dangerousRootReason: dangerCheck.reason,
        projects: [],
      };
    }

    const detectedDirs: string[] = [];
    const visitedRealPaths = new Set<string>();

    // 忽略的常规缓存与工具目录
    const ignoreNames = new Set([
      'node_modules',
      '.git',
      'venv',
      '.venv',
      '__pycache__',
      'target',
      'bin',
      'obj',
      'dist',
      'build',
      '.gradle',
      '.idea',
      '.vscode',
      'appdata',
      '.next',
      '.turbo',
    ]);

    // 检查根目录自身是否是一个独立工程锚点
    const rootHasAnchor = this.hasProjectAnchor(root);

    // 递归嗅探子目录 (深度限制为 3 层，仅用于寻找工程根节点，不限制具体工程内部的代码深度)
    const scanDirForAnchors = (currentDir: string, currentDepth: number) => {
      if (currentDepth > 3) return;

      let realPath: string;
      try {
        realPath = fs.realpathSync(currentDir);
      } catch {
        return;
      }

      // 软链接循环环路防护 (Symlink Cycle Guard)
      if (visitedRealPaths.has(realPath)) return;
      visitedRealPaths.add(realPath);

      let entries: fs.Dirent[] = [];
      try {
        entries = fs.readdirSync(currentDir, { withFileTypes: true });
      } catch {
        return;
      }

      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const name = entry.name;
        if (name.startsWith('.') && name !== '.git') continue;
        if (ignoreNames.has(name.toLowerCase())) continue;

        const subDir = path.join(currentDir, name);
        if (this.hasProjectAnchor(subDir)) {
          detectedDirs.push(subDir);
          // 找到子工程锚点后，继续探查其下可能存在的子微服务 (最多再深一层)
          if (currentDepth < 2) {
            scanDirForAnchors(subDir, currentDepth + 1);
          }
        } else {
          scanDirForAnchors(subDir, currentDepth + 1);
        }
      }
    };

    scanDirForAnchors(root, 1);

    // 如果根目录有锚点且没有探测到多个子工程，或者完全没探测到子工程：将根目录本身作为单工程
    if (detectedDirs.length === 0 || (rootHasAnchor && detectedDirs.length === 0)) {
      const singleProfile = this.profileProject(root, root);
      return {
        isSingleProject: true,
        hasDangerousRoot: false,
        projects: [singleProfile],
      };
    }

    // 若根目录有代码，同时其下包含多个子工程 (如 Monorepo 根目录下有 packages/ 或 services/)
    if (rootHasAnchor && !detectedDirs.includes(root)) {
      // 检查根目录自身是否主要是根配置文件
      const rootSourceFiles = this.countSourceFiles(root, 1);
      if (rootSourceFiles > 5) {
        detectedDirs.unshift(root);
      }
    }

    // 逐个生成 4 维工程画像指纹
    const profiles: DetectedProjectProfile[] = detectedDirs.map((d) => this.profileProject(root, d));

    // 执行多端生态智能组合推荐算法 (Multi-Platform Ecosystem Grouping)
    this.applySmartRecommendations(profiles);

    return {
      isSingleProject: profiles.length <= 1,
      hasDangerousRoot: false,
      projects: profiles,
    };
  }

  /**
   * 检查指定目录是否包含工程描述锚点
   */
  private static hasProjectAnchor(dirPath: string): boolean {
    const anchors = [
      'package.json',
      'go.mod',
      'pom.xml',
      'build.gradle',
      'build.gradle.kts',
      'settings.gradle',
      'cargo.toml',
      'requirements.txt',
      'pyproject.toml',
      'setup.py',
      'pipfile',
      'cmakelists.txt',
      'makefile',
      'androidmanifest.xml',
      'tauri.conf.json',
      'project.godot',
      '.git',
    ];

    try {
      const files = fs.readdirSync(dirPath);
      const lowerFiles = new Set(files.map((f) => f.toLowerCase()));
      for (const a of anchors) {
        if (lowerFiles.has(a)) return true;
      }
      // 检查 .sln / .csproj / .vcxproj / .asmdef
      for (const f of lowerFiles) {
        if (f.endsWith('.sln') || f.endsWith('.csproj') || f.endsWith('.vcxproj') || f.endsWith('.asmdef')) {
          return true;
        }
      }
    } catch {}

    return false;
  }

  /**
   * 生成单个工程的 4 维画像指纹 (平台形态、技术栈、版本号、活跃度)
   */
  private static profileProject(workspaceRoot: string, projectDir: string): DetectedProjectProfile {
    const relPath = path.relative(workspaceRoot, projectDir).replace(/\\/g, '/') || '.';
    const dirName = path.basename(projectDir);
    const id = relPath === '.' ? 'root' : sanitizeIdentifier(relPath).toLowerCase();

    // 1. 读取依赖文件与特征内容
    let depContent = '';
    const readDep = (filename: string) => {
      const p = path.join(projectDir, filename);
      if (fs.existsSync(p)) {
        try {
          depContent += fs.readFileSync(p, 'utf-8').toLowerCase() + '\n';
        } catch {}
      }
    };
    readDep('package.json');
    readDep('requirements.txt');
    readDep('pyproject.toml');
    readDep('go.mod');
    readDep('pom.xml');
    readDep('build.gradle');
    readDep('build.gradle.kts');
    readDep('cargo.toml');
    readDep('cmakelists.txt');

    // 2. 统计文件数量、扩展名分布与最近编辑时间
    const extStats: Record<string, number> = {};
    let lastModifiedMs = 0;
    let fileCount = 0;

    const countFiles = (dir: string, depth: number) => {
      if (depth > 8) return;
      try {
        const list = fs.readdirSync(dir, { withFileTypes: true });
        for (const item of list) {
          const itemPath = path.join(dir, item.name);
          if (item.isDirectory()) {
            if (!/^(node_modules|\.git|venv|\.venv|target|bin|obj|dist|build)$/i.test(item.name)) {
              countFiles(itemPath, depth + 1);
            }
          } else {
            const ext = path.extname(item.name).toLowerCase();
            if (/^\.(py|ts|tsx|js|jsx|go|java|kt|kts|rs|c|cpp|cc|cxx|h|hpp|cs|vue|swift|lua|asmdef|asmref|gd|tscn)$/.test(ext)) {
              extStats[ext] = (extStats[ext] || 0) + 1;
              fileCount++;
              try {
                const stat = fs.statSync(itemPath);
                if (stat.mtimeMs > lastModifiedMs) {
                  lastModifiedMs = stat.mtimeMs;
                }
              } catch {}
            }
          }
        }
      } catch {}
    };

    countFiles(projectDir, 1);

    // 3. 计算主导语言
    let primaryLanguage = 'unknown';
    let maxExtCount = 0;
    for (const [ext, count] of Object.entries(extStats)) {
      if (count > maxExtCount) {
        maxExtCount = count;
        if (['.ts', '.tsx'].includes(ext)) primaryLanguage = 'typescript';
        else if (['.js', '.jsx'].includes(ext)) primaryLanguage = 'javascript';
        else if (ext === '.py') primaryLanguage = 'python';
        else if (ext === '.go') primaryLanguage = 'go';
        else if (ext === '.java') primaryLanguage = 'java';
        else if (['.kt', '.kts'].includes(ext)) primaryLanguage = 'kotlin';
        else if (ext === '.swift') primaryLanguage = 'swift';
        else if (ext === '.vue') primaryLanguage = 'vue';
        else if (ext === '.lua') primaryLanguage = 'lua';
        else if (['.asmdef', '.asmref'].includes(ext)) primaryLanguage = 'unity';
        else if (['.gd', '.tscn'].includes(ext)) primaryLanguage = 'godot';
        else if (ext === '.rs') primaryLanguage = 'rust';
        else if (['.cpp', '.cc', '.cxx', '.hpp'].includes(ext)) primaryLanguage = 'cpp';
        else if (['.c', '.h'].includes(ext)) primaryLanguage = 'c';
        else if (ext === '.cs') primaryLanguage = 'csharp';
      }
    }

    // 4. 识别框架与技术栈
    const frameworks: string[] = [];
    if (/(react|@types\/react)/i.test(depContent)) frameworks.push('React');
    if (/vue/i.test(depContent) || primaryLanguage === 'vue') frameworks.push('Vue');
    if (/(next|nuxt)/i.test(depContent)) frameworks.push('Next.js');
    if (/vite/i.test(depContent)) frameworks.push('Vite');
    if (/(fastapi|flask|django)/i.test(depContent)) frameworks.push('FastAPI/Web');
    if (/(pyqt5|pyqt6|pyside2|pyside6|tkinter|wxpython)/i.test(depContent)) frameworks.push('PyQt');
    if (/(gin-gonic|labstack\/echo|gofiber)/i.test(depContent)) frameworks.push('Gin');
    if (/(spring-boot|spring-web)/i.test(depContent)) frameworks.push('Spring Boot');
    if (/(axum|actix-web)/i.test(depContent)) frameworks.push('Axum');
    if (/(qt5|qt6|qapplication|qmainwindow)/i.test(depContent)) frameworks.push('Qt');
    if (/(cmake)/i.test(depContent)) frameworks.push('CMake');
    if (/(electron)/i.test(depContent)) frameworks.push('Electron');
    if (/(tauri)/i.test(depContent)) frameworks.push('Tauri');
    if (primaryLanguage === 'godot' || fs.existsSync(path.join(projectDir, 'project.godot'))) frameworks.push('Godot');
    if (primaryLanguage === 'unity' || fs.existsSync(path.join(projectDir, 'ProjectSettings'))) frameworks.push('Unity');

    // 5. 判定目标平台形态 (Platform Fingerprinting)
    let platform: ProjectPlatform = 'UNKNOWN';
    const lowerRel = relPath.toLowerCase();

    // 5.1 Game Engine (Godot / Unity / Cocos / Lua)
    if (
      frameworks.includes('Godot') ||
      frameworks.includes('Unity') ||
      primaryLanguage === 'godot' ||
      primaryLanguage === 'unity' ||
      (primaryLanguage === 'lua' && /(game|engine|scripts|roblox|cocos)/i.test(lowerRel))
    ) {
      platform = 'GAME_ENGINE';
    }
    // 5.2 Android
    else if (
      fs.existsSync(path.join(projectDir, 'AndroidManifest.xml')) ||
      fs.existsSync(path.join(projectDir, 'src/main/AndroidManifest.xml')) ||
      /com\.android\.(application|library)/i.test(depContent) ||
      /(android)/i.test(lowerRel)
    ) {
      platform = 'MOBILE_ANDROID';
    }
    // 5.3 iOS
    else if (
      fs.existsSync(path.join(projectDir, 'Podfile')) ||
      primaryLanguage === 'swift' ||
      /(ios|apple)/i.test(lowerRel)
    ) {
      platform = 'MOBILE_IOS';
    }
    // 5.4 PC Desktop C++
    else if (
      (primaryLanguage === 'cpp' || primaryLanguage === 'c') &&
      (frameworks.includes('Qt') || /(desktop|client|pc|gui|win32)/i.test(lowerRel))
    ) {
      platform = 'DESKTOP_CPP';
    }
    // 5.5 PC Desktop Python
    else if (
      primaryLanguage === 'python' &&
      (frameworks.includes('PyQt') || /(desktop|client|pc|gui)/i.test(lowerRel))
    ) {
      platform = 'DESKTOP_PYTHON';
    }
    // 5.6 PC Desktop Electron / Tauri
    else if (frameworks.includes('Electron') || frameworks.includes('Tauri')) {
      platform = 'DESKTOP_ELECTRON';
    }
    // 5.7 Web 前端
    else if (
      (primaryLanguage === 'typescript' || primaryLanguage === 'javascript' || primaryLanguage === 'vue') &&
      (frameworks.includes('React') || frameworks.includes('Vue') || frameworks.includes('Next.js') || frameworks.includes('Vite') || /(web|frontend|client|portal)/i.test(lowerRel))
    ) {
      platform = 'WEB_FRONTEND';
    }
    // 5.8 后端服务
    else if (
      frameworks.includes('FastAPI/Web') ||
      frameworks.includes('Gin') ||
      frameworks.includes('Spring Boot') ||
      frameworks.includes('Axum') ||
      /(server|backend|service|api|microservice)/i.test(lowerRel) ||
      fs.existsSync(path.join(projectDir, 'Dockerfile'))
    ) {
      platform = 'BACKEND_SERVICE';
    }
    // 5.9 辅助工具
    else if (/(tools?|scripts?|util(s)?|benchmark|test)/i.test(lowerRel)) {
      platform = 'TOOL_SCRIPT';
    }
    // 5.10 兜底分类
    else if (primaryLanguage === 'cpp') {
      platform = 'DESKTOP_CPP';
    } else if (primaryLanguage === 'python') {
      platform = 'BACKEND_SERVICE';
    } else if (primaryLanguage === 'typescript' || primaryLanguage === 'javascript' || primaryLanguage === 'vue') {
      platform = 'WEB_FRONTEND';
    } else if (primaryLanguage === 'lua') {
      platform = 'GAME_ENGINE';
    } else if (['go', 'java', 'rust', 'csharp'].includes(primaryLanguage)) {
      platform = 'BACKEND_SERVICE';
    }

    // 6. 提取局域版本号 (如 v0.1.5, v0.5, 1.0, v015, v01)
    let versionString: string | undefined;
    const combinedName = relPath + '_' + dirName;
    const dottedMatch = combinedName.match(/(?:v|_|-)(\d+\.\d+(?:\.\d+)*)/i);
    if (dottedMatch) {
      versionString = `v${dottedMatch[1]}`;
    } else {
      const compactMatch = combinedName.match(/(?:^|[_/-])[vV](\d{1,4})(?:$|[_/-])/);
      if (compactMatch) {
        const digits = compactMatch[1];
        if (digits.length === 2) {
          versionString = `v${digits[0]}.${digits[1]}`;
        } else if (digits.length === 3) {
          versionString = `v${digits[0]}.${digits[1]}.${digits[2]}`;
        } else {
          versionString = `v${digits}`;
        }
      }
    }

    return {
      id,
      name: dirName || relPath,
      relPath,
      platform,
      primaryLanguage,
      frameworks,
      versionString,
      lastModifiedMs,
      fileCount,
      isRecommended: true, // 初始置为 true，由后续推荐决策矩阵调整
      recommendReason: '全端协同生态推荐项',
    };
  }

  /**
   * 3. 智能生态矩阵聚合决策 (组合出最佳多端协同生态)
   */
  private static applySmartRecommendations(profiles: DetectedProjectProfile[]): void {
    if (profiles.length <= 1) return;

    // 先标记明确处于归档/历史目录下的工程
    for (const p of profiles) {
      if (this.isArchiveDirectory(p.relPath)) {
        p.isRecommended = false;
        p.recommendReason = '历史归档 / 早期版本 (备选参考)';
      }
    }

    // 按平台生态族系 (MOBILE, DESKTOP, WEB, BACKEND, SDK, TOOL) 分组
    const familyGroups = new Map<string, DetectedProjectProfile[]>();
    for (const p of profiles) {
      const family = this.getPlatformFamily(p.platform);
      const list = familyGroups.get(family) || [];
      list.push(p);
      familyGroups.set(family, list);
    }

    for (const [family, group] of familyGroups.entries()) {
      // 辅助工具默认不作为核心主力推荐
      if (family === 'TOOL') {
        for (const item of group) {
          item.isRecommended = false;
          item.recommendReason = '辅助工具 / 开发脚本 (备选)';
        }
        continue;
      }

      // 筛选活跃候选工程 (优先排除归档目录)
      const activeCandidates = group.filter((p) => !this.isArchiveDirectory(p.relPath));
      const pool = activeCandidates.length > 0 ? activeCandidates : group;

      // 按 (版本号 SemVer 降序, 代码规模降序, 最近修改时间降序) 排序
      pool.sort((a, b) => {
        const verA = this.parseSemVer(a.versionString);
        const verB = this.parseSemVer(b.versionString);
        if (verA !== verB) return verB - verA;
        if (a.fileCount !== b.fileCount) return b.fileCount - a.fileCount;
        return b.lastModifiedMs - a.lastModifiedMs;
      });

      // 排名第一的推荐为该端主力
      const winner = pool[0];
      winner.isRecommended = true;
      winner.recommendReason = `${this.getPlatformDisplayName(winner.platform)} 当前主力 (${winner.versionString || '最新活跃'})`;

      // 同族系其余的工程标记为归档或备选
      for (const item of group) {
        if (item.id === winner.id) continue;
        item.isRecommended = false;
        if (!item.recommendReason || item.recommendReason === '全端协同生态推荐项') {
          item.recommendReason = this.isArchiveDirectory(item.relPath)
            ? '历史归档 / 早期原型 (备选参考)'
            : '备选分支 / 历史版本';
        }
      }
    }
  }

  private static getPlatformFamily(p: ProjectPlatform): string {
    if (p === 'MOBILE_ANDROID' || p === 'MOBILE_IOS') return 'MOBILE';
    if (p === 'DESKTOP_CPP' || p === 'DESKTOP_PYTHON' || p === 'DESKTOP_ELECTRON') return 'DESKTOP';
    if (p === 'WEB_FRONTEND') return 'WEB';
    if (p === 'BACKEND_SERVICE') return 'BACKEND';
    if (p === 'SHARED_SDK') return 'SDK';
    if (p === 'TOOL_SCRIPT') return 'TOOL';
    return 'UNKNOWN';
  }

  private static isArchiveDirectory(relPath: string): boolean {
    return /(?:^|[\\/])(?:archive|archives|backup|backups|old|legacy|deprecated|history|draft|v0)(?:$|[\\/])/i.test(
      relPath
    );
  }

  private static getPlatformDisplayName(p: ProjectPlatform): string {
    switch (p) {
      case 'MOBILE_ANDROID': return '移动端 (Android)';
      case 'MOBILE_IOS': return '移动端 (iOS)';
      case 'DESKTOP_CPP': return 'PC 桌面端 (C++)';
      case 'DESKTOP_PYTHON': return 'PC 桌面端 (Python)';
      case 'DESKTOP_ELECTRON': return 'PC 桌面端 (Electron/Tauri)';
      case 'WEB_FRONTEND': return '网页前端 (Web)';
      case 'BACKEND_SERVICE': return '后端微服务 (API)';
      case 'SHARED_SDK': return '共享 SDK / 基础库';
      case 'TOOL_SCRIPT': return '辅助开发工具';
      default: return '子工程';
    }
  }

  private static parseSemVer(ver?: string): number {
    if (!ver) return 0;
    const clean = ver.replace(/^v/i, '');
    const parts = clean.split('.').map((p) => parseInt(p, 10) || 0);
    const major = parts[0] || 0;
    const minor = parts[1] || 0;
    const patch = parts[2] || 0;
    return major * 10000 + minor * 100 + patch;
  }

  private static countSourceFiles(dir: string, depth: number): number {
    let count = 0;
    try {
      const list = fs.readdirSync(dir, { withFileTypes: true });
      for (const item of list) {
        if (!item.isDirectory()) {
          const ext = path.extname(item.name).toLowerCase();
          if (/^\.(py|ts|tsx|js|jsx|go|java|kt|rs|c|cpp|cs)$/.test(ext)) count++;
        }
      }
    } catch {}
    return count;
  }
}
