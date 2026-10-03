import fs from 'fs';
import path from 'path';
import { ArchetypeType, ArchetypeMatchResult, ArchetypeHealthResult, CodeNode, CodeEdge } from '../types/index.js';

export class ArchetypeEngine {
  /**
   * 基于目录模式与依赖声明初步侦测架构原型
   */
  public static detectArchetype(
    workspaceRoot: string,
    fileList: string[]
  ): ArchetypeMatchResult {
    const root = path.resolve(workspaceRoot);
    const matchedRules: string[] = [];

    // 1. 读取依赖声明文件内容 (跨语言支持)
    let dependencyText = '';
    const depFiles = [
      'requirements.txt', 'pyproject.toml', 'Pipfile', 'setup.py',
      'package.json', 'go.mod', 'pom.xml', 'build.gradle', 'build.gradle.kts',
      'Cargo.toml', 'CMakeLists.txt'
    ];
    for (const df of depFiles) {
      const fullPath = path.join(root, df);
      if (fs.existsSync(fullPath)) {
        try {
          dependencyText += fs.readFileSync(fullPath, 'utf-8').toLowerCase() + '\n';
        } catch {}
      }
    }

    const normFiles = fileList.map((f) => f.toLowerCase().replace(/\\/g, '/'));

    // 2. 规则集检测：Web 分层架构 (FastAPI, Express, Nest, Next, Gin, Spring, Axum, ASP.NET)
    let webScore = 0;
    if (/(fastapi|flask|django|tornado|aiohttp|express|koa|fastify|nestjs|next|nuxt|hono|gin-gonic|labstack\/echo|spring-boot|spring-web|axum|actix-web|aspnetcore|fastendpoints)/i.test(dependencyText)) {
      webScore += 0.45;
      matchedRules.push('依赖声明中包含主流 Web 框架');
    }
    const hasRouters = normFiles.some((f) => /(router|controller|api|views|endpoints?)/.test(f));
    const hasServices = normFiles.some((f) => /(service|usecase|domain|biz)/.test(f));
    const hasData = normFiles.some((f) => /(model|schema|dao|repo|entity)/.test(f));

    if (hasRouters) webScore += 0.25;
    if (hasServices) webScore += 0.20;
    if (hasData) webScore += 0.15;

    // 3. 规则集检测：异步任务与事件管道 (Celery, Kafka, Redis, RabbitMQ, BullMQ)
    let workerScore = 0;
    if (/(celery|kafka|pika|redis|rq|dramatiq|bull|bullmq|kafkajs|amqplib|asynq|rocketmq|rdkafka|lapin)/i.test(dependencyText)) {
      workerScore += 0.45;
      matchedRules.push('依赖声明中包含任务队列或消息中间件');
    }
    const hasTasks = normFiles.some((f) => /(task|worker|queue|consumer|event|job)/.test(f));
    if (hasTasks) workerScore += 0.35;

    // 4. 规则集检测：CLI 命令行管道 (Click, Typer, Commander, Cobra, Clap)
    let cliScore = 0;
    if (/(click|typer|fire|prompt_toolkit|commander|yargs|oclif|cobra|urfave\/cli|clap)/i.test(dependencyText)) {
      cliScore += 0.45;
      matchedRules.push('依赖声明中包含 CLI 框架');
    }
    const hasCliDir = normFiles.some((f) => /(cli|command|pipeline|cmd)/.test(f));
    const hasMain = normFiles.some((f) => /(__main__\.py|main\.py|main\.go|main\.rs|index\.ts|app\.ts)/.test(f));
    if (hasCliDir) cliScore += 0.30;
    if (hasMain) cliScore += 0.15;

    // 裁决最高得分的原型
    const scores = [
      { type: 'WEB_LAYERED' as ArchetypeType, score: Math.min(webScore, 0.95) },
      { type: 'WORKER_PIPELINE' as ArchetypeType, score: Math.min(workerScore, 0.95) },
      { type: 'CLI_PIPELINE' as ArchetypeType, score: Math.min(cliScore, 0.95) },
    ];

    scores.sort((a, b) => b.score - a.score);
    const top = scores[0];

    // 初判阈值：>= 0.70 判定命中，否则降级回退到 UNIVERSAL 通用通道
    if (top && top.score >= 0.70) {
      return {
        archetype: top.type,
        confidence: Number(top.score.toFixed(2)),
        matchedRules,
      };
    }

    return {
      archetype: 'UNIVERSAL',
      confidence: top ? Number(top.score.toFixed(2)) : 0.2,
      matchedRules: ['未命中已知高置信度原型，回退至通用自适应拓扑'],
    };
  }

  /**
   * 装配后一致性审计与健康度裁决模型 (防止假目录与流向倒挂)
   */
  public static verifyPostAssemblyHealth(
    archetype: ArchetypeType,
    nodes: CodeNode[],
    edges: CodeEdge[]
  ): ArchetypeHealthResult {
    // 若本就是 UNIVERSAL 通道，无需回滚校验
    if (archetype === 'UNIVERSAL') {
      return {
        passed: true,
        score: 1.0,
        slotFillRatio: 1.0,
        flowConcordanceRatio: 1.0,
        symbolCoverageRatio: 1.0,
        reasons: ['通用通道免除模板一致性审计'],
      };
    }

    const reasons: string[] = [];

    // 1. 槽位有效填充率 (S_fill)
    let slotFillRatio = 1.0;
    const entryNodes = nodes.filter((n) => n.semanticRole === 'ENTRY');
    const serviceNodes = nodes.filter((n) => n.semanticRole === 'SERVICE');
    const dataNodes = nodes.filter((n) => n.semanticRole === 'REPOSITORY' || n.semanticRole === 'MODEL');

    if (archetype === 'WEB_LAYERED') {
      // Web 原型必须至少有入口或明确的控制器
      if (entryNodes.length === 0) {
        slotFillRatio -= 0.5;
        reasons.push('关键槽位缺失: 未发现任何 Web 路由或入口端点');
      }
      if (serviceNodes.length === 0 && dataNodes.length === 0) {
        slotFillRatio -= 0.3;
        reasons.push('业务层或数据层槽位完全为空');
      }
    }
    slotFillRatio = Math.max(slotFillRatio, 0);

    // 2. 流程流向顺应率 (S_flow)
    // 检查是否有大量的反向调用 (例如 Model -> Controller 严重逆流)
    let flowConcordanceRatio = 1.0;
    let invertedCount = 0;
    const callEdges = edges.filter((e) => e.relation === 'CALLS');

    const nodeRoleMap = new Map<string, string>();
    for (const n of nodes) {
      nodeRoleMap.set(n.id, n.semanticRole);
    }

    for (const e of callEdges) {
      const srcRole = nodeRoleMap.get(e.source);
      const tgtRole = nodeRoleMap.get(e.target);

      // Web 原型中，数据层不应反向调用表现层入口
      if ((srcRole === 'REPOSITORY' || srcRole === 'MODEL') && tgtRole === 'ENTRY') {
        invertedCount++;
      }
    }

    if (callEdges.length > 0) {
      const invertedRate = invertedCount / callEdges.length;
      if (invertedRate > 0.25) {
        flowConcordanceRatio -= Math.min(invertedRate * 2, 0.7);
        reasons.push(`严重调用逆流: 发现 ${(invertedRate * 100).toFixed(1)}% 的反向倒挂调用`);
      }
    }
    flowConcordanceRatio = Math.max(flowConcordanceRatio, 0);

    // 3. 符号覆盖捕获率 (S_coverage)
    const classifiedCount = nodes.filter((n) => n.semanticRole !== 'UNKNOWN').length;
    const symbolCoverageRatio = nodes.length > 0 ? classifiedCount / nodes.length : 1.0;
    if (symbolCoverageRatio < 0.35) {
      reasons.push(`孤岛率过高: 仅有 ${(symbolCoverageRatio * 100).toFixed(1)}% 的符号归入原型槽位`);
    }

    // 综合健康度计算 H = 0.35 * S_fill + 0.40 * S_flow + 0.25 * S_coverage
    const H = Number((0.35 * slotFillRatio + 0.40 * flowConcordanceRatio + 0.25 * symbolCoverageRatio).toFixed(2));
    const passed = H >= 0.65;

    if (!passed) {
      reasons.unshift(`一致性综合健康度不足 (H = ${H} < 0.65)，触发自动纠错回滚`);
    } else {
      reasons.push(`装配一致性校验通过 (H = ${H})`);
    }

    return {
      passed,
      score: H,
      slotFillRatio: Number(slotFillRatio.toFixed(2)),
      flowConcordanceRatio: Number(flowConcordanceRatio.toFixed(2)),
      symbolCoverageRatio: Number(symbolCoverageRatio.toFixed(2)),
      reasons,
    };
  }
}
