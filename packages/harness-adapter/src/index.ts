import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import {
  CodeGraphCore,
  CodeGraphServer,
  FullGraphResult,
  CodeNode,
  InteractionNarrator,
  NodeInteractionStory,
  ImpactAnalyzer,
  ArchitectureHealthAuditor,
  ArchitectureSkeletonExtractor,
} from '@codegraph/core';

export const name = 'dsh-codegraph';

export const inject = ['tools', 'systemPrompt'];

export interface AdapterConfig {
  port?: number;
  workspaceRoot?: string;
  scopePath?: string;
}

export function apply(ctx: any, config: AdapterConfig = {}) {
  const port = config.port || 3333;
  let serverInstance: CodeGraphServer | null = null;
  let coreInstance: CodeGraphCore | null = null;
  let fsWatcher: fs.FSWatcher | null = null;
  let debounceTimer: NodeJS.Timeout | null = null;

  // 路径跨平台归一化对比辅助函数
  const normalizePath = (p: string) => path.resolve(p).toLowerCase().replace(/\\/g, '/');

  // 获取当前活跃工作区根目录
  const getWorkspaceRoot = (): string => {
    try {
      if (ctx.workspaceRegistry && typeof ctx.workspaceRegistry.list === 'function') {
        const list = ctx.workspaceRegistry.list();
        if (list && list.length > 0 && list[0].path) {
          return list[0].path;
        }
      }
      if (ctx.workspace && typeof ctx.workspace.root === 'string') {
        return ctx.workspace.root;
      }
      if (ctx.workspace && typeof ctx.workspace.getPath === 'function') {
        return ctx.workspace.getPath();
      }
    } catch {}
    return process.cwd();
  };

  let currentRoot = config.workspaceRoot || getWorkspaceRoot();

  // 会话期冻结骨架快照 (Session-Frozen Baseline, 专治大模型 KV Cache 穿透)
  let cachedSkeletonSnapshot: string | null = null;

  // 工具响应级内存 LRU 缓存 (Tool Result Memoization, 确保 Byte-Identical 且 0ms 响应)
  let graphVersion = 1;
  const toolResultCache = new Map<string, string>();
  const MAX_CACHE_ENTRIES = 120;

  const getCachedToolResult = (toolName: string, args: Record<string, any>): string | null => {
    try {
      const sortedKeys = Object.keys(args || {}).sort();
      const sortedObj: Record<string, any> = {};
      for (const k of sortedKeys) {
        sortedObj[k] = args[k];
      }
      const key = `${graphVersion}:${toolName}:${JSON.stringify(sortedObj)}`;
      return toolResultCache.get(key) || null;
    } catch {
      return null;
    }
  };

  const setCachedToolResult = (toolName: string, args: Record<string, any>, result: string) => {
    try {
      const sortedKeys = Object.keys(args || {}).sort();
      const sortedObj: Record<string, any> = {};
      for (const k of sortedKeys) {
        sortedObj[k] = args[k];
      }
      const key = `${graphVersion}:${toolName}:${JSON.stringify(sortedObj)}`;
      if (toolResultCache.size >= MAX_CACHE_ENTRIES) {
        const oldestKey = toolResultCache.keys().next().value;
        if (oldestKey) toolResultCache.delete(oldestKey);
      }
      toolResultCache.set(key, result);
    } catch {}
  };

  // 1. 初始化并托管本地 CodeGraph 核心服务 (共享内存 Core 实例)
  try {
    let staticDir: string | undefined;
    try {
      const __filename = fileURLToPath(import.meta.url);
      const __dirname = path.dirname(__filename);
      const candidates = [
        path.resolve(__dirname, 'webview'),
        path.resolve(__dirname, '../webview'),
        path.resolve(__dirname, '../../webview/dist'),
        path.resolve(__dirname, '../packages/webview/dist'),
      ];
      for (const dir of candidates) {
        if (fs.existsSync(dir) && fs.existsSync(path.join(dir, 'index.html'))) {
          staticDir = dir;
          break;
        }
      }
    } catch {}

    serverInstance = new CodeGraphServer({
      workspaceRoot: currentRoot,
      port,
      scopePath: config.scopePath || '.',
      staticDir,
    });

    // 关键：Webview Server 与 Agent 共享同一份内存单例
    coreInstance = serverInstance.core;

    serverInstance
      .start()
      .then(() => {
        console.log(`[CodeGraph] 适配器已成功挂载，交互视窗: http://127.0.0.1:${port}`);
      })
      .catch((err) => {
        console.warn(`[CodeGraph] 服务启动警告:`, err.message);
      });

    // 预热加载图谱缓存 (优先从 .codegraph/graph-cache.json 读取，无则首次扫描)
    if (coreInstance) {
      const cached = coreInstance.loadFromCache();
      if (!cached) {
        coreInstance.scan().catch((err) => {
          console.warn(`[CodeGraph] 初始图谱扫描提示:`, err.message);
        });
      }
    }
  } catch (err: any) {
    console.error(`[CodeGraph] 初始化服务失败:`, err);
  }

  // 2. 启动 300ms 防抖静默后台增量自愈监听器 (Silent Self-Healing)
  try {
    const onFileChanged = (filename?: string) => {
      if (!filename) return;
      if (/(node_modules|\.git|dist|build|\.codegraph|out|bin|obj|\.next)/i.test(filename)) return;
      if (!/\.(ts|tsx|js|jsx|py|go|rs|cs|java|cpp|c|h|hpp)$/i.test(filename)) return;

      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(async () => {
        try {
          if (coreInstance) {
            await coreInstance.updateIncremental();
            graphVersion++; // 代码变更，递增图谱版本，安全失效查询缓存
            toolResultCache.clear();
            console.log(`[CodeGraph] 后台静默自愈增量更新完成 (版本 v${graphVersion}, 文件: ${filename})`);
          }
        } catch (e: any) {
          console.warn(`[CodeGraph] 增量自愈警告:`, e.message);
        }
      }, 300);
    };

    if (fs.existsSync(currentRoot)) {
      fsWatcher = fs.watch(currentRoot, { recursive: true }, (_, filename) => {
        onFileChanged(filename || undefined);
      });
      console.log(`[CodeGraph] 已开启后台 300ms 防抖增量自愈监听: ${currentRoot}`);
    }
  } catch (err: any) {
    console.warn(`[CodeGraph] 启动文件自愈监听警告:`, err.message);
  }

  // 3. 宿主生命周期注销
  ctx.on('dispose', async () => {
    if (debounceTimer) clearTimeout(debounceTimer);
    if (fsWatcher) {
      try {
        fsWatcher.close();
      } catch {}
      fsWatcher = null;
    }
    toolResultCache.clear();
    cachedSkeletonSnapshot = null;
    if (serverInstance) {
      try {
        await serverInstance.stop();
        console.log(`[CodeGraph] 服务已停止`);
      } catch {}
      serverInstance = null;
    }
  });

  // 优化版：确保图谱数据就绪 (消除 workspaceRoot 引发的假未命中和重复扫描)
  const ensureGraphReady = async (customRoot?: string): Promise<FullGraphResult> => {
    if (!coreInstance) {
      throw new Error('CodeGraphCore 尚未初始化');
    }

    // 严格检查是否确实切换了工作区路径
    const isDifferentRoot = customRoot && normalizePath(customRoot) !== normalizePath(currentRoot);
    if (isDifferentRoot) {
      currentRoot = customRoot;
      coreInstance.setWorkspaceRoot(currentRoot);
      cachedSkeletonSnapshot = null;
      toolResultCache.clear();
      graphVersion++;
    }

    // 1. 优先使用当前内存中的图谱结果 (0ms 瞬时命中)
    let result = coreInstance.getLastResult();
    if (result && !isDifferentRoot) {
      return result;
    }

    // 2. 尝试从本地 .codegraph/graph-cache.json 读取持久化缓存
    const cached = coreInstance.loadFromCache();
    if (cached && cached.graph) {
      return cached.graph;
    }

    // 3. 仅在冷启动且无缓存时，才执行全量扫描
    result = await coreInstance.scan();
    return result;
  };

  // 生成或复用稳定的架构骨架快照 (Session-Frozen Snapshot)
  const getStableSkeleton = (graph: FullGraphResult): string => {
    if (cachedSkeletonSnapshot) {
      return cachedSkeletonSnapshot;
    }
    cachedSkeletonSnapshot = ArchitectureSkeletonExtractor.extract(graph, currentRoot);
    return cachedSkeletonSnapshot;
  };

  // 4. 接入 DSH System Prompt 上下文装配钩子 (轻量注入 ~300 Token 架构骨架)
  const registerSystemPromptHook = () => {
    try {
      // 方式 A: 监听 system-prompt/assemble waterfall
      ctx.on('system-prompt/assemble', async (assembly: any, _context: any, next: any) => {
        try {
          if (coreInstance) {
            let result = coreInstance.getLastResult();
            if (!result) {
              const cached = coreInstance.loadFromCache();
              if (cached) result = cached.graph;
            }
            if (result && assembly && Array.isArray(assembly.contexts)) {
              const exists = assembly.contexts.some((c: any) => c.name === 'codegraph-architecture');
              if (!exists) {
                const skeleton = getStableSkeleton(result);
                // order 置为 200，后置挂载在基础指令之后，保护全局核心前缀
                assembly.contexts.push({
                  name: 'codegraph-architecture',
                  order: 200,
                  text: skeleton,
                });
              }
            }
          }
        } catch (e: any) {
          console.warn('[CodeGraph] 装配 system-prompt 上下文警告:', e.message);
        }
        return next();
      });

      // 方式 B: 若宿主显式提供了 ctx.systemPrompt.context 注册能力
      if (ctx.systemPrompt && typeof ctx.systemPrompt.context === 'function') {
        ctx.systemPrompt.context({
          name: 'codegraph-architecture',
          order: 200,
          text: () => {
            if (!coreInstance) return '';
            let graph = coreInstance.getLastResult();
            if (!graph) {
              const cached = coreInstance.loadFromCache();
              if (cached) graph = cached.graph;
            }
            if (!graph) return '';
            return getStableSkeleton(graph);
          },
        });
      }

      console.log('[CodeGraph] Agent 架构骨架上下文钩子已成功挂载 (Session-Frozen)');
    } catch (e: any) {
      console.warn('[CodeGraph] 挂载架构骨架上下文警告:', e.message);
    }
  };

  if (ctx.systemPrompt) {
    registerSystemPromptHook();
  } else if (typeof ctx.inject === 'function') {
    ctx.inject(['systemPrompt'], () => {
      registerSystemPromptHook();
    });
  }

  // 5. 注册 5 个专职独立的 Agent Tool (带结果 Memoization 与严格确定性)
  const registerToolsOn = (toolsService: any) => {
    try {
      // -------------------------------------------------------------
      // 工具 1: codegraph_get_architecture (宏观架构与模块契约)
      // -------------------------------------------------------------
      toolsService.register({
        name: 'codegraph_get_architecture',
        description:
          '查询项目的宏观分层架构、核心模块清单、对外暴露端口(InPorts/OutPorts)与跨模块通信总线(ModuleBus)。当需要掌握全局架构或了解模块对外契约时使用。',
        parameters: {
          module: {
            type: 'string',
            description: '可选：指定单个模块名称 (如 core, webview)。不传则返回全局架构视图与全部模块列表。',
          },
          workspaceRoot: {
            type: 'string',
            description: '可选：指定需要分析的项目根目录完整路径 (默认当前工作区)',
          },
        },
        output: {
          schema: { type: 'string' },
          render: (_args: any, value: string) => [{ type: 'text', text: value }],
        },
        async execute(args: { module?: string; workspaceRoot?: string }) {
          const cached = getCachedToolResult('codegraph_get_architecture', args);
          if (cached) return cached;

          const graph = await ensureGraphReady(args.workspaceRoot);
          const meta = graph.meta;
          const rawModules = graph.architectureView.modules || [];
          const rawBuses = graph.architectureView.buses || [];

          // 严格确定性排序
          const modules = [...rawModules].sort((a, b) => a.name.localeCompare(b.name));
          const buses = [...rawBuses].sort((a, b) => {
            const srcCmp = a.sourceModule.localeCompare(b.sourceModule);
            if (srcCmp !== 0) return srcCmp;
            return a.targetModule.localeCompare(b.targetModule);
          });

          let output = '';

          // 若指定了单个模块
          if (args.module) {
            const targetMod = modules.find(
              (m) => m.name.toLowerCase() === args.module!.toLowerCase() || m.id.toLowerCase() === args.module!.toLowerCase()
            );
            if (!targetMod) {
              output = `未找到模块 "${args.module}"。当前可用模块: ${modules.map((m) => m.name).join(', ')}`;
              setCachedToolResult('codegraph_get_architecture', args, output);
              return output;
            }

            const connectedBuses = buses.filter(
              (b) => b.sourceModule === targetMod.name || b.targetModule === targetMod.name
            );

            const lines: string[] = [];
            lines.push(`### 📦 模块详情: \`${targetMod.name}\``);
            lines.push(`- **所属工程/平台**: ${targetMod.projectPlatform || '通用'}`);
            lines.push(`- **文件总数**: ${targetMod.files.length} 个文件`);
            lines.push(`- **输入端口 (InPorts, 共 ${targetMod.inPorts.length} 个)**: ${targetMod.inPorts.slice().sort().join(', ') || '无对外暴露虚拟输入端口'}`);
            lines.push(`- **输出端口 (OutPorts, 共 ${targetMod.outPorts.length} 个)**: ${targetMod.outPorts.slice().sort().join(', ') || '无对外依赖虚拟输出端口'}`);

            lines.push(`\n**模块通信总线关系**:`);
            if (connectedBuses.length > 0) {
              for (const b of connectedBuses) {
                const isOut = b.sourceModule === targetMod.name;
                const arrow = isOut ? `➔ 调用下游 [${b.targetModule}]` : `⬅ 被上游 [${b.sourceModule}] 调用`;
                const topSymbols = b.symbols.slice(0, 3).map((s) => s.targetSymbol).sort().join(', ');
                lines.push(`- ${arrow} (关联调用 ${b.callCount} 次, 典型符号: ${topSymbols})`);
              }
            } else {
              lines.push('- 暂无跨模块总线连接 (高内聚独立模块)');
            }

            lines.push(`\n**代表性文件路径 (前 15 个)**:`);
            const sortedFiles = targetMod.files.map((f) => f.replace(/\\/g, '/')).sort();
            for (const f of sortedFiles.slice(0, 15)) {
              lines.push(`- \`${f}\``);
            }
            if (sortedFiles.length > 15) {
              lines.push(`- ... (另有 ${sortedFiles.length - 15} 个文件)`);
            }

            output = lines.join('\n');
            setCachedToolResult('codegraph_get_architecture', args, output);
            return output;
          }

          // 全局架构大纲
          const lines: string[] = [];
          lines.push(`### 🏛️ 项目宏观架构概览: \`${meta.projectName}\``);
          lines.push(`- **架构范式**: \`${meta.archetype}\`${meta.archetypeHealth ? ` (健康得分: ${(meta.archetypeHealth.score * 100).toFixed(0)}分)` : ''}`);
          lines.push(`- **全局规模**: ${meta.fileCount} 个源文件, ${meta.nodeCount} 个关键符号节点, ${meta.edgeCount} 条跨文件拓扑关系`);

          lines.push(`\n**核心模块清单 (共 ${modules.length} 个模块)**:`);
          for (const m of modules) {
            lines.push(`- **\`${m.name}\`**: ${m.files.length} 个文件 | InPorts: ${m.inPorts.length} | OutPorts: ${m.outPorts.length}`);
          }

          if (buses.length > 0) {
            lines.push(`\n**模块总线拓扑 (Module Buses)**:`);
            for (const b of buses.slice(0, 8)) {
              const topSym = b.symbols.slice(0, 2).map((s) => s.targetSymbol).sort().join(', ');
              lines.push(`- \`${b.sourceModule}\` ➔ \`${b.targetModule}\` (${b.callCount} 次调用, 接口: ${topSym})`);
            }
            if (buses.length > 8) {
              lines.push(`- ... (另有 ${buses.length - 8} 条总线连接)`);
            }
          }

          output = lines.join('\n');
          setCachedToolResult('codegraph_get_architecture', args, output);
          return output;
        },
      });

      // -------------------------------------------------------------
      // 工具 2: codegraph_trace_flow (端到端业务时序流穿透)
      // -------------------------------------------------------------
      toolsService.register({
        name: 'codegraph_trace_flow',
        description:
          '端到端业务时序流穿透查询。按执行时序获取关键业务流（如请求处理、认证鉴权、数据同步）的完整调用步骤序列及具体源码位置(文件与精确行号)。当需要理解业务执行流转路径时使用。',
        parameters: {
          flowId: {
            type: 'string',
            description: '可选：业务流程唯一 ID',
          },
          query: {
            type: 'string',
            description: '可选：业务流程名称或关键词模糊搜索 (如 login, sync, scan)',
          },
          workspaceRoot: {
            type: 'string',
            description: '可选：指定工作区根目录完整路径',
          },
        },
        output: {
          schema: { type: 'string' },
          render: (_args: any, value: string) => [{ type: 'text', text: value }],
        },
        async execute(args: { flowId?: string; query?: string; workspaceRoot?: string }) {
          const cached = getCachedToolResult('codegraph_trace_flow', args);
          if (cached) return cached;

          const graph = await ensureGraphReady(args.workspaceRoot);
          let rawFlows = graph.processFlows || [];

          if (args.flowId) {
            rawFlows = rawFlows.filter((f) => f.flowId === args.flowId);
          } else if (args.query) {
            const q = args.query.toLowerCase();
            rawFlows = rawFlows.filter((f) => f.title.toLowerCase().includes(q) || f.flowId.toLowerCase().includes(q));
          }

          // 确定性排序
          const flows = [...rawFlows].sort((a, b) => a.title.localeCompare(b.title) || a.flowId.localeCompare(b.flowId));

          if (flows.length === 0) {
            const allTitles = (graph.processFlows || [])
              .map((f) => `\`${f.title}\` (id: ${f.flowId})`)
              .sort()
              .join(', ');
            const output = `未检索到匹配的业务时序流。当前可用流程: ${allTitles || '无'}`;
            setCachedToolResult('codegraph_trace_flow', args, output);
            return output;
          }

          const lines: string[] = [];
          for (const f of flows.slice(0, 3)) {
            lines.push(`### ⚡ 业务时序链: \`${f.title}\` (ID: ${f.flowId})`);
            lines.push(`- **时序总步数**: ${f.steps.length} 步`);
            lines.push(`\n**执行流转路径 (按先后次序执行)**:`);

            f.steps.forEach((s, idx) => {
              const cond = s.condition ? ` [分支条件: ${s.condition}]` : '';
              const stepTypeBadge = `[${s.stepType}]`;
              const cleanPath = s.filePath.replace(/\\/g, '/');
              lines.push(`${idx + 1}. ${stepTypeBadge} **\`${s.name}\`** (所属模块: \`${s.module}\`)${cond}`);
              lines.push(`   └─ 源码锚点: [${cleanPath}:${s.line}](${cleanPath}#L${s.line})`);
            });
            lines.push('');
          }

          if (flows.length > 3) {
            lines.push(`*... (另有 ${flows.length - 3} 个匹配流程未展开，可指定 query 或 flowId 细化查询)*`);
          }

          const output = lines.join('\n');
          setCachedToolResult('codegraph_trace_flow', args, output);
          return output;
        },
      });

      // -------------------------------------------------------------
      // 工具 3: codegraph_impact_analysis (代码改动影响面与波及范围)
      // -------------------------------------------------------------
      toolsService.register({
        name: 'codegraph_impact_analysis',
        description:
          '代码改动影响面与波及范围分析 (Blast Radius)。输入准备修改的函数、类、接口或文件路径，向上多跳递归推导所有直接与间接调用方，评估风险等级(LOW/MEDIUM/HIGH/CRITICAL)并输出防踩坑建议。在修改或重构核心代码前强烈推荐使用。',
        parameters: {
          symbol: {
            type: 'string',
            required: true,
            description: '准备修改的符号名称 (函数名、类名、接口名或方法名)',
          },
          filePath: {
            type: 'string',
            description: '可选：目标符号所在的文件路径 (用于同名符号精确区分)',
          },
          depth: {
            type: 'number',
            description: '可选：向上递归回溯的调用深度跳数 (默认 3，最大 5)',
          },
          workspaceRoot: {
            type: 'string',
            description: '可选：指定工作区根目录完整路径',
          },
        },
        output: {
          schema: { type: 'string' },
          render: (_args: any, value: string) => [{ type: 'text', text: value }],
        },
        async execute(args: { symbol: string; filePath?: string; depth?: number; workspaceRoot?: string }) {
          if (!args.symbol) {
            return '错误：必须提供 symbol 参数 (准备修改的符号名称)';
          }
          const cached = getCachedToolResult('codegraph_impact_analysis', args);
          if (cached) return cached;

          const graph = await ensureGraphReady(args.workspaceRoot);
          const maxDepth = Math.min(Math.max(args.depth || 3, 1), 5);
          const result = ImpactAnalyzer.analyze(args.symbol, graph, {
            maxDepth,
            filePath: args.filePath,
          });
          const output = ImpactAnalyzer.formatMarkdown(result);
          setCachedToolResult('codegraph_impact_analysis', args, output);
          return output;
        },
      });

      // -------------------------------------------------------------
      // 工具 4: codegraph_inspect_narrative (0-Token 符号拓扑交互叙事)
      // -------------------------------------------------------------
      toolsService.register({
        name: 'codegraph_inspect_narrative',
        description:
          '0-Token 符号拓扑交互叙事查询。利用本地 AST 叙事引擎生成指定函数、类或组件的高密度职责说明、入站调用者列表、出站依赖项及网络契约。适合在理解关键代码逻辑的同时节省 Token、避免直接读入冗长大文件。',
        parameters: {
          symbol: {
            type: 'string',
            required: true,
            description: '需要透视的符号名称 (如 AuthService, compile, handleRequest)',
          },
          filePath: {
            type: 'string',
            description: '可选：符号所在文件路径 (同名符号区分)',
          },
          workspaceRoot: {
            type: 'string',
            description: '可选：指定工作区根目录完整路径',
          },
        },
        output: {
          schema: { type: 'string' },
          render: (_args: any, value: string) => [{ type: 'text', text: value }],
        },
        async execute(args: { symbol: string; filePath?: string; workspaceRoot?: string }) {
          if (!args.symbol) {
            return '错误：必须提供 symbol 参数';
          }
          const cached = getCachedToolResult('codegraph_inspect_narrative', args);
          if (cached) return cached;

          const graph = await ensureGraphReady(args.workspaceRoot);
          const allNodes = graph.allNodes;
          const allEdges = graph.allEdges;

          const q = args.symbol.toLowerCase();
          const matchedNodes = Object.values(allNodes)
            .filter((n) => {
              if (args.filePath && !n.filePath.toLowerCase().includes(args.filePath.toLowerCase())) {
                return false;
              }
              return (
                n.name.toLowerCase() === q ||
                n.qualifiedName.toLowerCase() === q ||
                n.id.toLowerCase() === q ||
                (q.length > 2 && n.name.toLowerCase().includes(q))
              );
            })
            .sort((a, b) => a.filePath.localeCompare(b.filePath) || a.loc.startLine - b.loc.startLine);

          if (matchedNodes.length === 0) {
            const output = `未在图谱中检索到符号 "${args.symbol}"。请核对拼写，或使用原生 grep 搜索。`;
            setCachedToolResult('codegraph_inspect_narrative', args, output);
            return output;
          }

          const targetNode = matchedNodes[0];
          const story: NodeInteractionStory = InteractionNarrator.generateNodeStory(
            targetNode,
            allNodes,
            allEdges
          );

          const lines: string[] = [];
          const cleanTargetPath = targetNode.filePath.replace(/\\/g, '/');
          lines.push(`### 🧭 符号拓扑交互透视: \`${story.name}\``);
          lines.push(`- **限定全名**: \`${targetNode.qualifiedName}\``);
          lines.push(`- **语义角色**: \`${story.role}\` (${targetNode.entityType})`);
          lines.push(`- **源码位置**: [${cleanTargetPath}:${targetNode.loc?.startLine || 1}](${cleanTargetPath}#L${targetNode.loc?.startLine || 1})`);
          if (targetNode.signature) {
            lines.push(`- **符号签名**: \`${targetNode.signature}\``);
          }
          lines.push(`- **功能概述**: ${story.docstringSummary || story.summary}`);

          // 确定性排序调用者
          const sortedCallers = [...story.callers].sort((a, b) => a.filePath.localeCompare(b.filePath) || a.line - b.line);
          if (sortedCallers.length > 0) {
            lines.push(`\n**入站调用者 (Callers, 共 ${story.inDegree} 处)**:`);
            for (const c of sortedCallers.slice(0, 8)) {
              const cp = c.filePath.replace(/\\/g, '/');
              lines.push(`- \`${c.name}\` -> [${cp}:${c.line}](${cp}#L${c.line}) (${c.relationText})`);
            }
            if (sortedCallers.length > 8) {
              lines.push(`- ... (另有 ${sortedCallers.length - 8} 处调用方)`);
            }
          } else {
            lines.push('\n**入站调用者**: 无直接入站调用 (可能为入口点或包私有符号)。');
          }

          // 确定性排序依赖项
          const sortedCallees = [...story.callees].sort((a, b) => a.filePath.localeCompare(b.filePath) || a.line - b.line);
          if (sortedCallees.length > 0) {
            lines.push(`\n**出站依赖项 (Callees, 共 ${story.outDegree} 处)**:`);
            for (const c of sortedCallees.slice(0, 8)) {
              const cp = c.filePath.replace(/\\/g, '/');
              lines.push(`- \`${c.name}\` -> [${cp}:${c.line}](${cp}#L${c.line}) (${c.relationText})`);
            }
            if (sortedCallees.length > 8) {
              lines.push(`- ... (另有 ${sortedCallees.length - 8} 处出站调用)`);
            }
          }

          if (story.contracts.length > 0) {
            lines.push(`\n**关联网络契约 (Contracts)**:`);
            const sortedContracts = [...story.contracts].sort((a, b) => a.title.localeCompare(b.title));
            for (const ct of sortedContracts) {
              lines.push(`- [${ct.protocol}] \`${ct.title}\` (${ct.summary})`);
            }
          }

          const output = lines.join('\n');
          setCachedToolResult('codegraph_inspect_narrative', args, output);
          return output;
        },
      });

      // -------------------------------------------------------------
      // 工具 5: codegraph_audit_health (架构合规与循环依赖排查)
      // -------------------------------------------------------------
      toolsService.register({
        name: 'codegraph_audit_health',
        description:
          '项目全局架构合规性与健康度排查。检测工程中是否存在模块间恶性循环依赖闭环(Circular Dependencies)以及底层反向越权依赖上层(Layer Violations)。在完成功能开发或重构后、准备提交代码前用于验证架构防劣化。',
        parameters: {
          workspaceRoot: {
            type: 'string',
            description: '可选：指定工作区根目录完整路径 (默认当前工作区)',
          },
        },
        output: {
          schema: { type: 'string' },
          render: (_args: any, value: string) => [{ type: 'text', text: value }],
        },
        async execute(args: { workspaceRoot?: string }) {
          const cached = getCachedToolResult('codegraph_audit_health', args);
          if (cached) return cached;

          const graph = await ensureGraphReady(args.workspaceRoot);
          const report = ArchitectureHealthAuditor.audit(graph);
          const output = ArchitectureHealthAuditor.formatMarkdown(report);
          setCachedToolResult('codegraph_audit_health', args, output);
          return output;
        },
      });

      // -------------------------------------------------------------
      // 兼容旧版单一总线工具 query_code_graph (保持向下兼容)
      // -------------------------------------------------------------
      toolsService.register({
        name: 'query_code_graph',
        description: '兼容旧版：使用本地 AST 语义引擎查询架构概要、模块、时序流或影响面分析',
        parameters: {
          action: {
            type: 'string',
            required: true,
            enum: ['summary', 'modules', 'flows', 'impact', 'audit'],
            description: '操作：summary (架构概要), modules (模块清单), flows (时序链), impact (影响面分析), audit (架构合规审计)',
          },
          query: {
            type: 'string',
            description: '搜索词或目标符号',
          },
          workspaceRoot: {
            type: 'string',
            description: '可选：指定工作区根目录',
          },
        },
        output: {
          schema: { type: 'string' },
          render: (_args: any, value: string) => [{ type: 'text', text: value }],
        },
        async execute(args: { action: string; query?: string; workspaceRoot?: string }) {
          const cached = getCachedToolResult('query_code_graph', args);
          if (cached) return cached;

          const graph = await ensureGraphReady(args.workspaceRoot);
          let output = '';
          switch (args.action) {
            case 'summary':
              output = ArchitectureSkeletonExtractor.extract(graph, args.workspaceRoot);
              break;
            case 'modules':
              output = JSON.stringify(
                [...(graph.architectureView.modules || [])]
                  .sort((a, b) => a.name.localeCompare(b.name))
                  .map((m) => ({ id: m.id, name: m.name, files: m.files.length }))
              );
              break;
            case 'flows':
              output = JSON.stringify(
                [...(graph.processFlows || [])]
                  .sort((a, b) => a.title.localeCompare(b.title))
                  .map((f) => ({ id: f.flowId, title: f.title, steps: f.steps.length }))
              );
              break;
            case 'impact':
              output = ImpactAnalyzer.formatMarkdown(ImpactAnalyzer.analyze(args.query || '', graph));
              break;
            case 'audit':
              output = ArchitectureHealthAuditor.formatMarkdown(ArchitectureHealthAuditor.audit(graph));
              break;
            default:
              output = `未知 action: ${args.action}`;
              break;
          }
          setCachedToolResult('query_code_graph', args, output);
          return output;
        },
      });

      console.log('[CodeGraph] 5 大专属 Agent 工具已成功注册至 DSH (已开启确定性保真与 Memoization 缓存)');
    } catch (e: any) {
      console.warn('[CodeGraph] 注册 Agent 工具警告:', e.message);
    }
  };

  if (ctx.tools && typeof ctx.tools.register === 'function') {
    registerToolsOn(ctx.tools);
  } else if (typeof ctx.inject === 'function') {
    ctx.inject(['tools'], (scope: any) => {
      if (scope.tools && typeof scope.tools.register === 'function') {
        registerToolsOn(scope.tools);
      }
    });
  }
}
