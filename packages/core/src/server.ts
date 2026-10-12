import http from 'http';
import fs from 'fs';
import path from 'path';
import { URL, fileURLToPath } from 'url';
import { CodeGraphCore, WorkspaceProfiler, saveDrilldownLayout, loadDrilldownLayout } from './index.js';
import { ElkLayoutEngine } from './layout/elk-layout.js';
import { CodeNode } from './types/index.js';
import { PluginUpdater } from './updater/plugin-updater.js';

export interface ServerOptions {
  port?: number;
  workspaceRoot: string;
  scopePath?: string;
  staticDir?: string;
  pluginRoot?: string;
  repo?: string;
  huaweiUrl?: string;
}

export class CodeGraphServer {
  private server: http.Server;
  public core: CodeGraphCore;
  public updater: PluginUpdater;
  public pluginRoot: string;
  private port: number;
  private workspaceRoot: string;
  private staticDir?: string;
  private isScanning: boolean = false;
  private drilldownCache: Map<string, any> = new Map();
  private drilldownQueue: string[] = [];
  private isQueueProcessing: boolean = false;

  public startBackgroundDrilldown(graph: any): void {
    if (!graph || !graph.architectureView?.modules) return;
    const modules = graph.architectureView.modules;
    for (const m of modules) {
      if (!this.drilldownCache.has(m.id) && !this.drilldownQueue.includes(m.id)) {
        this.drilldownQueue.push(m.id);
      }
    }
    if (!this.isQueueProcessing && this.drilldownQueue.length > 0) {
      this.processNextDrilldown();
    }
  }

  public async computeModuleDrilldown(
    moduleId: string,
    graph: any
  ): Promise<{ layout: any; portEdges: any[]; nodes: any[]; edges: any[] } | null> {
    const targetModule = graph.architectureView?.modules?.find((m: any) => m.id === moduleId);
    if (!targetModule) return null;

    const moduleFiles = new Set(targetModule.files || []);
    const internalNodes = (Object.values(graph.allNodes || {}).filter(
      (n: any) => moduleFiles.has(n.filePath) && n.entityType !== 'FILE'
    ) as unknown) as CodeNode[];
    const internalNodeIds = new Set(internalNodes.map((n) => n.id));

    // 单次扫描快速分类全部连线：内部调用、打入入口、打出外部，时间复杂度 O(E)
    const internalCalls: Array<{ source: string; target: string }> = [];
    const incomingToInternal: Array<{ source: string; target: string }> = [];
    const outgoingFromInternal: Array<{ source: string; target: string }> = [];

    for (const e of graph.allEdges || []) {
      const sIn = internalNodeIds.has(e.source);
      const tIn = internalNodeIds.has(e.target);
      if (sIn && tIn) {
        internalCalls.push({ source: e.source, target: e.target });
      } else if (!sIn && tIn) {
        incomingToInternal.push({ source: e.source, target: e.target });
      } else if (sIn && !tIn) {
        outgoingFromInternal.push({ source: e.source, target: e.target });
      }
    }

    // 内部符号名称 O(1) 索引构建
    const nodeNameMap = new Map<string, string[]>();
    for (const n of internalNodes) {
      if (!nodeNameMap.has(n.name)) nodeNameMap.set(n.name, []);
      nodeNameMap.get(n.name)!.push(n.id);
      if (n.id !== n.name) {
        if (!nodeNameMap.has(n.id)) nodeNameMap.set(n.id, []);
        nodeNameMap.get(n.id)!.push(n.id);
      }
    }

    const portEdges: Array<{ source: string; target: string; isPortEdge: boolean }> = [];
    (targetModule.inPorts || []).forEach((port: string) => {
      const inPortId = `inport_${port}`;
      const matchedIds = nodeNameMap.get(port);
      if (matchedIds && matchedIds.length > 0) {
        matchedIds.forEach((id) => {
          portEdges.push({ source: inPortId, target: id, isPortEdge: true });
        });
      } else if (incomingToInternal.length > 0) {
        portEdges.push({ source: inPortId, target: incomingToInternal[0].target, isPortEdge: true });
      }
    });

    (targetModule.outPorts || []).forEach((port: string) => {
      const outPortId = `outport_${port}`;
      const matchingOut = outgoingFromInternal.filter(
        (og) =>
          graph.allNodes[og.target]?.name === port ||
          og.target.endsWith(port) ||
          og.target.includes(port)
      );
      if (matchingOut.length > 0) {
        matchingOut.forEach((og) => {
          portEdges.push({ source: og.source, target: outPortId, isPortEdge: true });
        });
      }
    });

    const layout = await ElkLayoutEngine.layoutModuleDetail(
      internalNodes,
      internalCalls,
      {
        inPorts: targetModule.inPorts,
        outPorts: targetModule.outPorts,
        portEdges,
      }
    );

    const drilldownResult = { layout, portEdges, version: 'v6' };
    this.drilldownCache.set(moduleId, drilldownResult);

    // 仅保存独立轻量分片 .codegraph/drilldowns/<id>.json (< 5ms)，彻底移除全量 saveToCache() 巨石 I/O
    try {
      saveDrilldownLayout(this.workspaceRoot, moduleId, drilldownResult);
    } catch (e) {
      console.warn(`[CodeGraph] 模块下钻独立分片落盘异常: ${moduleId}`, e);
    }

    return { layout, portEdges, nodes: internalNodes, edges: internalCalls };
  }

  private async processNextDrilldown(): Promise<void> {
    if (this.drilldownQueue.length === 0) {
      this.isQueueProcessing = false;
      return;
    }
    this.isQueueProcessing = true;
    const nextModId = this.drilldownQueue.shift();
    if (nextModId && !this.drilldownCache.has(nextModId)) {
      const graph = this.core.getLastResult();
      if (graph) {
        try {
          await this.computeModuleDrilldown(nextModId, graph);
        } catch (e) {
          console.warn(`[CodeGraph] 后台异步排版模块 ${nextModId} 警告:`, e);
        }
      }
    }
    setTimeout(() => this.processNextDrilldown(), 60);
  }

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

    let resolvedPluginRoot = options.pluginRoot;
    if (!resolvedPluginRoot) {
      try {
        const __filename = fileURLToPath(import.meta.url);
        let curr = path.dirname(__filename);
        for (let i = 0; i < 6; i++) {
          if (
            fs.existsSync(path.join(curr, 'feed', 'manifest.json')) ||
            fs.existsSync(path.join(curr, 'dist', 'client.js')) ||
            (fs.existsSync(path.join(curr, 'package.json')) &&
              (fs.existsSync(path.join(curr, 'packages')) || fs.existsSync(path.join(curr, 'dist'))))
          ) {
            resolvedPluginRoot = curr;
            break;
          }
          const p = path.dirname(curr);
          if (p === curr) break;
          curr = p;
        }
      } catch {}
    }
    this.pluginRoot = path.resolve(resolvedPluginRoot || process.cwd());
    this.updater = new PluginUpdater(this.pluginRoot, options.repo, options.huaweiUrl);

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
    const normCurrent = this.workspaceRoot.toLowerCase().replace(/[\\\/]+/g, '/');
    const normTarget = resolved.toLowerCase().replace(/[\\\/]+/g, '/');
    if (normCurrent !== normTarget) {
      this.workspaceRoot = resolved;
      this.drilldownCache.clear();
      this.core.setWorkspaceRoot(this.workspaceRoot, scopePath || '.');
      console.log(`[CodeGraph] 工作区已动态切换至: ${this.workspaceRoot}`);
    } else if (scopePath && scopePath !== this.core.getScopePath()) {
      this.drilldownCache.clear();
      this.core.setScopePath(scopePath);
    }
  }

  private getReadyDrilldowns(): string[] {
    const readySet = new Set<string>(this.drilldownCache.keys());
    try {
      const drillDir = path.join(this.workspaceRoot, '.codegraph', 'drilldowns');
      if (fs.existsSync(drillDir)) {
        const files = fs.readdirSync(drillDir);
        for (const f of files) {
          if (f.endsWith('.json')) {
            readySet.add(f.slice(0, -5));
          }
        }
      }
    } catch {}
    return Array.from(readySet);
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
    // =======================================================================
    // 插件自更新 API 系列 (检测、竞速、进度、应用)
    // =======================================================================
    if (pathname === '/api/update/check') {
      let forceRefresh = reqUrl.searchParams.get('force') === 'true';
      let version = reqUrl.searchParams.get('version') || undefined;
      if (req.method === 'POST') {
        const body = await this.readJsonBody(req);
        if (body?.forceRefresh !== undefined) forceRefresh = !!body.forceRefresh;
        if (body?.version) version = body.version;
      }
      const result = await this.updater.checkForUpdate(version, forceRefresh);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, ...result }));
      return;
    }

    if (pathname === '/api/update/race') {
      const results = await this.updater.raceMirrors();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, mirrors: results }));
      return;
    }

    if (pathname === '/api/update/progress') {
      const progress = this.updater.getProgress();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, progress }));
      return;
    }

    if (pathname === '/api/update/apply' && req.method === 'POST') {
      const body = await this.readJsonBody(req);
      let manifest = body?.manifest;
      if (!manifest) {
        const checkRes = await this.updater.checkForUpdate(undefined, true);
        if (!checkRes.manifest) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: false, error: '未能获取有效的更新清单' }));
          return;
        }
        manifest = checkRes.manifest;
      }
      try {
        const result = await this.updater.applyUpdate(manifest);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ...result }));
      } catch (err: any) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: err.message || '更新应用失败' }));
      }
      return;
    }

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
          graph: {
            meta: newResult.meta,
            architectureView: newResult.architectureView,
            processFlows: newResult.processFlows,
            allNodes: {},
            allEdges: [],
          },
          layout: { architecture: archLayout },
        })
      );
      return;
    }

    if (pathname === '/api/layout-architecture' && req.method === 'POST') {
      let last = this.core.getLastResult();
      if (!last) {
        const cached = this.core.loadFromCache();
        if (cached) last = cached.graph;
      }
      if (!last) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: '图谱尚未初始化' }));
        return;
      }
      const archLayout = await ElkLayoutEngine.layoutArchitecture(
        last.architectureView.modules,
        last.architectureView.buses
      );
      this.core.setLastLayout({ architecture: archLayout });
      this.core.saveToCache({ architecture: archLayout });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, layout: { architecture: archLayout } }));
      return;
    }

    if (pathname === '/api/layout-drilldown' && req.method === 'POST') {
      const body = await this.readJsonBody(req);
      const moduleId = body?.moduleId;
      const forceRefresh = !!body?.forceRefresh;

      if (!moduleId) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: '缺少 moduleId 参数' }));
        return;
      }

      let last = this.core.getLastResult();
      if (!last) {
        const cached = this.core.loadFromCache();
        if (cached) last = cached.graph;
      }
      if (!last) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: '图谱尚未初始化' }));
        return;
      }

      const targetModule = last.architectureView.modules.find((m) => m.id === moduleId);
      if (!targetModule) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: `模块不存在: ${moduleId}` }));
        return;
      }

      const moduleFiles = new Set(targetModule.files);
      const internalNodes = Object.values(last.allNodes).filter(
        (n) => moduleFiles.has(n.filePath) && n.entityType !== 'FILE'
      );
      const internalNodeIds = new Set(internalNodes.map((n) => n.id));
      const internalCalls: Array<{ source: string; target: string }> = [];
      last.allEdges.forEach((e) => {
        if (internalNodeIds.has(e.source) && internalNodeIds.has(e.target)) {
          internalCalls.push({ source: e.source, target: e.target });
        }
      });

      // 1. 快速内存缓存命中检测 (0ms 返回，附带节点与边，确保秒级渲染)
      if (!forceRefresh) {
        if (this.drilldownCache.has(moduleId)) {
          const cached = this.drilldownCache.get(moduleId);
          if (cached?.version === 'v6' && cached?.layout?.width && cached.layout.width < 12000) {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(
              JSON.stringify({
                success: true,
                layout: cached.layout,
                portEdges: cached.portEdges,
                nodes: internalNodes,
                edges: internalCalls,
                fromCache: true,
              })
            );
            return;
          }
        }

        // 检测核心引擎与磁盘独立分片缓存 (.codegraph/drilldowns/<id>.json)
        let diskCache = this.core.getLastLayout()?.drilldowns?.[moduleId];
        if (!diskCache) {
          diskCache = loadDrilldownLayout(this.workspaceRoot, moduleId) as any;
        }
        if (diskCache && diskCache?.version === 'v6' && diskCache?.layout?.width && diskCache.layout.width < 12000) {
          this.drilldownCache.set(moduleId, diskCache);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(
            JSON.stringify({
              success: true,
              layout: diskCache.layout,
              portEdges: diskCache.portEdges,
              nodes: internalNodes,
              edges: internalCalls,
              fromCache: true,
            })
          );
          return;
        }
      }

      // 2. 交互抢占式插队：若在后台队列中排队，立即移出队列并置顶优先计算
      const qIdx = this.drilldownQueue.indexOf(moduleId);
      if (qIdx !== -1) {
        this.drilldownQueue.splice(qIdx, 1);
      }

      const result = await this.computeModuleDrilldown(moduleId, last);
      if (!result) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: '计算下钻排版失败' }));
        return;
      }

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          success: true,
          layout: result.layout,
          portEdges: result.portEdges,
          nodes: result.nodes,
          edges: result.edges,
        })
      );
      return;
    }

    if (pathname === '/api/symbols' && req.method === 'GET') {
      let last = this.core.getLastResult();
      if (!last) {
        const cached = this.core.loadFromCache();
        if (cached) last = cached.graph;
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      if (last) {
        const slimNodes: Record<string, any> = {};
        for (const [id, node] of Object.entries(last.allNodes || {})) {
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
        res.end(JSON.stringify({ success: true, allNodes: slimNodes, allEdges: last.allEdges || [] }));
      } else {
        res.end(JSON.stringify({ success: false, allNodes: {}, allEdges: [] }));
      }
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

      // 如果内存中尚无图谱结果，自动探测本地持久化缓存
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

      if (last) {
        this.startBackgroundDrilldown(last);
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
          // 宏观首屏仅返回架构 modules, buses 与 processFlows，排除成千上万个微观节点，极速秒开
          graph: {
            meta: last?.meta,
            architectureView: last?.architectureView,
            processFlows: last?.processFlows,
            allNodes: {},
            allEdges: [],
          },
          layout,
          readyDrilldowns: this.getReadyDrilldowns(),
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

          // 彻底瘦身：只返回轻量宏观架构数据，杜绝数万微观 AST 符号造成数十兆巨石 JSON 导致 V8 内存溢出与宿主主线程卡死
          const slimGraph = cached?.graph
            ? {
                meta: cached.graph.meta,
                architectureView: cached.graph.architectureView,
                processFlows: cached.graph.processFlows,
                allNodes: {},
                allEdges: [],
              }
            : null;

          if (cached?.graph) {
            this.startBackgroundDrilldown(cached.graph);
          }

          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(
            JSON.stringify({
              success: true,
              workspaceRoot: this.workspaceRoot,
              hasCache: !!cached,
              graph: slimGraph,
              layout,
              readyDrilldowns: this.getReadyDrilldowns(),
              projects: this.core.getProjects(),
              selectedProjectIds: this.core.getSelectedProjectIds(),
              activeProjectId: this.core.getActiveProjectId(),
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

        // 自动持久化保存解耦缓存
        this.core.saveToCache({ architecture: archLayout });
        this.drilldownCache.clear();
        this.startBackgroundDrilldown(graphResult);

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            success: true,
            graph: {
              meta: graphResult.meta,
              architectureView: graphResult.architectureView,
              processFlows: graphResult.processFlows,
              allNodes: {},
              allEdges: [],
            },
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
      this.drilldownCache.clear();
      this.startBackgroundDrilldown(updated);

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          success: true,
          graph: {
            meta: updated.meta,
            architectureView: updated.architectureView,
            processFlows: updated.processFlows,
            allNodes: {},
            allEdges: [],
          },
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

      // 策略 A: 若传参本就是现有绝对路径 (如 D:\Projects\...)
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
