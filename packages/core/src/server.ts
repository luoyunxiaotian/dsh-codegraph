import http from 'http';
import fs from 'fs';
import path from 'path';
import { URL, fileURLToPath } from 'url';
import { CodeGraphCore, WorkspaceProfiler } from './index.js';
import { ElkLayoutEngine } from './layout/elk-layout.js';

export interface ServerOptions {
  port?: number;
  workspaceRoot: string;
  scopePath?: string;
  staticDir?: string;
}

export class CodeGraphServer {
  private server: http.Server;
  private core: CodeGraphCore;
  private port: number;
  private workspaceRoot: string;
  private staticDir?: string;
  private isScanning: boolean = false;

  constructor(options: ServerOptions) {
    this.port = options.port || 3333;
    this.workspaceRoot = path.resolve(options.workspaceRoot);
    this.staticDir = options.staticDir;

    if (!this.staticDir) {
      try {
        const __filename = fileURLToPath(import.meta.url);
        const __dirname = path.dirname(__filename);
        const candidate = path.resolve(__dirname, '../../webview/dist');
        if (fs.existsSync(candidate)) {
          this.staticDir = candidate;
        }
      } catch {}
    }

    this.core = new CodeGraphCore({
      workspaceRoot: this.workspaceRoot,
      scopePath: options.scopePath || '.',
    });

    this.server = http.createServer((req, res) => this.handleRequest(req, res));
  }

  public async start(autoPort: boolean = true): Promise<number> {
    return new Promise((resolve, reject) => {
      const tryListen = (p: number) => {
        const onError = (err: any) => {
          if (err.code === 'EADDRINUSE' && autoPort) {
            console.warn(`[CodeGraph] 端口 ${p} 已被占用，正在尝试下一个可用端口 ${p + 1}...`);
            this.port = p + 1;
            try {
              this.server.close(() => {
                tryListen(this.port);
              });
            } catch {
              tryListen(this.port);
            }
          } else {
            this.server.removeListener('error', onError);
            reject(err);
          }
        };

        this.server.once('error', onError);
        this.server.removeAllListeners('listening');
        this.server.listen(p, () => {
          this.server.removeListener('error', onError);
          console.log(`[CodeGraph] Web 服务器已就绪: http://localhost:${this.port}`);
          resolve(this.port);
        });
      };

      tryListen(this.port);
    });
  }

  public setWorkspace(workspaceRoot: string, scopePath?: string): void {
    const resolved = path.resolve(workspaceRoot);
    if (this.workspaceRoot !== resolved) {
      this.workspaceRoot = resolved;
      this.core.setWorkspaceRoot(this.workspaceRoot, scopePath || '.');
      console.log(`[CodeGraph] 工作区已动态切换至: ${this.workspaceRoot}`);
    } else if (scopePath) {
      this.core.setScopePath(scopePath);
    }
  }

  public stop(): Promise<void> {
    return new Promise((resolve) => {
      this.server.close(() => resolve());
    });
  }

  private async handleRequest(req: http.IncomingMessage, res: http.ServerResponse) {
    // 跨域支持 (CORS)
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    const reqUrl = new URL(req.url || '/', `http://${req.headers.host}`);
    const pathname = reqUrl.pathname;

    // API 路由分发
    if (pathname.startsWith('/api/')) {
      try {
        await this.handleApi(pathname, req, res, reqUrl);
      } catch (err: any) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message || 'Internal Server Error' }));
      }
      return;
    }

    // 静态前端文件托管
    if (this.staticDir && fs.existsSync(this.staticDir)) {
      let filePath = path.join(this.staticDir, pathname === '/' ? 'index.html' : pathname);
      if (!fs.existsSync(filePath)) {
        filePath = path.join(this.staticDir, 'index.html'); // SPA fallback
      }

      if (fs.existsSync(filePath)) {
        const ext = path.extname(filePath);
        const mimeTypes: Record<string, string> = {
          '.html': 'text/html',
          '.js': 'application/javascript',
          '.css': 'text/css',
          '.json': 'application/json',
          '.svg': 'image/svg+xml',
          '.png': 'image/png',
          '.wasm': 'application/wasm',
        };
        res.writeHead(200, { 'Content-Type': mimeTypes[ext] || 'application/octet-stream' });
        fs.createReadStream(filePath).pipe(res);
        return;
      }
    }

    // 默认内置极简欢迎界面 (若未编译独立 webview)
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(`
      <html>
        <head><title>CodeGraph Studio</title></head>
        <body style="font-family:sans-serif;padding:40px;background:#0f172a;color:#f8fafc;">
          <h2>🧭 CodeGraph Studio 核心服务运行中</h2>
          <p>工作区目录: <code>${this.workspaceRoot}</code></p>
          <p>API 就绪: <a style="color:#38bdf8" href="/api/status">/api/status</a></p>
        </body>
      </html>
    `);
  }

  private readJsonBody(req: http.IncomingMessage): Promise<any> {
    return new Promise((resolve) => {
      let data = '';
      req.on('data', (chunk) => {
        data += chunk;
      });
      req.on('end', () => {
        try {
          resolve(data ? JSON.parse(data) : {});
        } catch {
          resolve({});
        }
      });
      req.on('error', () => {
        resolve({});
      });
    });
  }

  private async handleApi(
    pathname: string,
    req: http.IncomingMessage,
    res: http.ServerResponse,
    reqUrl: URL
  ) {
    if (pathname === '/api/discover') {
      let targetRoot = this.workspaceRoot;
      if (req.method === 'POST') {
        const body = await this.readJsonBody(req);
        if (body?.workspaceRoot) targetRoot = path.resolve(body.workspaceRoot);
      } else {
        const q = reqUrl.searchParams.get('workspace');
        if (q) targetRoot = path.resolve(q);
      }
      const result = WorkspaceProfiler.discover(targetRoot);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(result));
      return;
    }

    if (pathname === '/api/switch-project' && req.method === 'POST') {
      const body = await this.readJsonBody(req);
      const newResult = this.core.switchActiveProject(body.activeProjectId);
      if (!newResult) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: '图谱尚未初始化或未加载' }));
        return;
      }

      const archLayout = await ElkLayoutEngine.layoutArchitecture(
        newResult.architectureView.modules,
        newResult.architectureView.buses
      );

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          success: true,
          graph: newResult,
          layout: { architecture: archLayout },
        })
      );
      return;
    }

    if (pathname === '/api/status' && req.method === 'GET') {
      const wsParam = reqUrl.searchParams.get('workspace');
      if (wsParam && fs.existsSync(wsParam)) {
        this.setWorkspace(wsParam);
      }
      let last = this.core.getLastResult();
      let layout = this.core.getLastLayout();
      let fromCache = false;
      let savedAt: string | undefined;

      // 如果内存中尚无图谱结果，自动探测本地持久化缓存 .codegraph/graph-cache.json
      if (!last) {
        const cached = this.core.loadFromCache();
        if (cached) {
          last = cached.graph;
          layout = cached.layout;
          fromCache = true;
          savedAt = cached.savedAt;
        }
      }

      // 如果有图谱但缺少 layout，实时补齐并保存
      if (last && (!layout || !layout.architecture)) {
        try {
          const archLayout = await ElkLayoutEngine.layoutArchitecture(
            last.architectureView.modules,
            last.architectureView.buses
          );
          layout = { architecture: archLayout };
          this.core.setLastLayout(layout);
          this.core.saveToCache(layout);
        } catch (err) {
          console.warn('[CodeGraph] 自动计算缓存布局失败:', err);
        }
      }

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          initialized: !!last,
          fromCache,
          savedAt,
          workspaceRoot: this.workspaceRoot,
          scopePath: this.core.getScopePath(),
          meta: last?.meta,
          graph: last,
          layout,
          projects: this.core.getProjects(),
          selectedProjectIds: this.core.getSelectedProjectIds(),
          activeProjectId: this.core.getActiveProjectId(),
        })
      );
      return;
    }

    if (pathname === '/api/workspace' && req.method === 'POST') {
      const body = await this.readJsonBody(req);
      if (body && typeof body.workspaceRoot === 'string' && body.workspaceRoot.trim()) {
        const targetRoot = body.workspaceRoot.trim();
        if (fs.existsSync(targetRoot)) {
          this.setWorkspace(targetRoot, body.scopePath);
          const cached = this.core.loadFromCache();
          let layout = cached?.layout;
          if (cached && (!layout || !layout.architecture)) {
            try {
              const archLayout = await ElkLayoutEngine.layoutArchitecture(
                cached.graph.architectureView.modules,
                cached.graph.architectureView.buses
              );
              layout = { architecture: archLayout };
              this.core.setLastLayout(layout);
              this.core.saveToCache(layout);
            } catch (err) {
              console.warn('[CodeGraph] 自动计算缓存布局失败:', err);
            }
          }
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(
            JSON.stringify({
              success: true,
              workspaceRoot: this.workspaceRoot,
              hasCache: !!cached,
              graph: cached?.graph,
              layout,
            })
          );
          return;
        } else {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: `目录不存在: ${targetRoot}` }));
          return;
        }
      }
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: '缺少有效的 workspaceRoot 参数' }));
      return;
    }

    if (pathname === '/api/scan' && req.method === 'POST') {
      if (this.isScanning) {
        res.writeHead(409, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: '正在扫描中，请勿重复触发' }));
        return;
      }

      this.isScanning = true;
      try {
        const body = await this.readJsonBody(req);
        if (body && typeof body.workspaceRoot === 'string' && body.workspaceRoot.trim()) {
          this.setWorkspace(body.workspaceRoot.trim(), body.scopePath);
        } else if (body && typeof body.scopePath === 'string') {
          this.core.setScopePath(body.scopePath);
        }

        const graphResult = await this.core.scan(true, {
          selectedProjectIds: body?.selectedProjectIds,
          activeProjectId: body?.activeProjectId,
        });
        // 计算 ELK 布局坐标
        const archLayout = await ElkLayoutEngine.layoutArchitecture(
          graphResult.architectureView.modules,
          graphResult.architectureView.buses
        );

        // 自动持久化保存至 .codegraph/graph-cache.json
        this.core.saveToCache({ architecture: archLayout });

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            success: true,
            graph: graphResult,
            layout: {
              architecture: archLayout,
            },
          })
        );
      } finally {
        this.isScanning = false;
      }
      return;
    }

    if (pathname === '/api/incremental' && req.method === 'POST') {
      const updated = await this.core.updateIncremental();
      const archLayout = await ElkLayoutEngine.layoutArchitecture(
        updated.architectureView.modules,
        updated.architectureView.buses
      );

      // 自动持久化保存更新后的图谱和布局
      this.core.saveToCache({ architecture: archLayout });

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          success: true,
          graph: updated,
          layout: {
            architecture: archLayout,
          },
        })
      );
      return;
    }

    if (pathname === '/api/file' && req.method === 'GET') {
      const reqUrl = new URL(req.url || '/', `http://${req.headers.host}`);
      const filePath = reqUrl.searchParams.get('path');
      if (!filePath) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: '缺少 path 参数' }));
        return;
      }

      // 1. 处理跨语言契约虚拟中枢节点 (如 contracts/rest-api, contracts/topics)
      if (filePath.startsWith('contracts/')) {
        const contractType = filePath.replace('contracts/', '');
        const content = [
          '// =====================================================================',
          `// 跨语言契约虚拟中枢定义 (Virtual Contract: ${contractType})`,
          '// =====================================================================',
          '// 该节点由代码图谱 AST 引擎根据跨语言调用关系自动合成，无物理源码文件。',
          '// 它将前端 HTTP/RPC 请求与后端服务接口、消息队列订阅关系在架构图中对齐。',
          '// =====================================================================',
        ].join('\n');
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ content, fullPath: filePath, isContract: true }));
        return;
      }

      // 2. 动态同步工作区路径 (优先使用前端显式传入的 workspace 参数)
      const wsParam = reqUrl.searchParams.get('workspace');
      let effectiveWorkspace = this.workspaceRoot;
      if (wsParam && fs.existsSync(wsParam)) {
        effectiveWorkspace = path.resolve(wsParam);
        if (this.workspaceRoot !== effectiveWorkspace) {
          this.setWorkspace(effectiveWorkspace);
        }
      }

      // 3. 多策略寻找物理文件路径 (兼容绝对路径、相对路径、Windows 反斜杠与跨子工程定位)
      const candidates: string[] = [];

      // 策略 A: 若传参本就是现有绝对路径 (如 H:\直播插件\...)
      if (path.isAbsolute(filePath) || /^[a-zA-Z]:[/\\]/.test(filePath)) {
        candidates.push(filePath);
      }

      // 策略 B: 相对于当前主工作区
      candidates.push(path.resolve(effectiveWorkspace, filePath));
      candidates.push(path.resolve(effectiveWorkspace, filePath.replace(/\//g, path.sep)));

      // 策略 C: 相对于当前 scopePath
      if (this.core.getScopePath() && this.core.getScopePath() !== '.') {
        candidates.push(path.resolve(effectiveWorkspace, this.core.getScopePath(), filePath));
      }

      // 策略 D: 遍历探测所有已识别的子工程相对路径
      const projects = this.core.getProjects();
      for (const proj of projects) {
        if (proj.relPath) {
          candidates.push(path.resolve(effectiveWorkspace, proj.relPath, filePath));
        }
      }

      // 策略 E: 兜底原 workspaceRoot
      if (this.workspaceRoot !== effectiveWorkspace) {
        candidates.push(path.resolve(this.workspaceRoot, filePath));
      }

      // 执行存在性探测
      let targetFile: string | null = null;
      for (const cand of candidates) {
        if (fs.existsSync(cand) && fs.statSync(cand).isFile()) {
          targetFile = cand;
          break;
        }
      }

      if (!targetFile) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            error: `本地文件不存在: ${filePath}`,
            workspace: effectiveWorkspace,
            checkedCandidates: candidates.slice(0, 5),
          })
        );
        return;
      }

      try {
        let content = fs.readFileSync(targetFile, 'utf-8');
        // 剥离 Windows C#/C++ 常见的 UTF-8 BOM 标记 (\uFEFF)
        if (content.charCodeAt(0) === 0xfeff) {
          content = content.slice(1);
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ content, fullPath: targetFile }));
      } catch (err: any) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: `读取文件失败: ${err.message}` }));
      }
      return;
    }

    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Not Found' }));
  }
}
