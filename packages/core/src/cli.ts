import fs from 'fs';
import path from 'path';
import { exec } from 'child_process';
import { CodeGraphCore } from './index.js';
import { CodeGraphServer } from './server.js';

async function main() {
  const args = process.argv.slice(2);
  const command = args[0] === 'serve' ? 'serve' : 'scan';
  const targetDir = (command === 'serve' ? args[1] : args[0]) || '.';
  const resolvedTarget = path.resolve(targetDir);

  if (command === 'serve') {
    let port = 3333;
    const portIdx = args.indexOf('--port');
    if (portIdx !== -1 && args[portIdx + 1]) {
      port = parseInt(args[portIdx + 1], 10);
    }
    const noOpen = args.includes('--no-open');

    console.log(`\n======================================================`);
    console.log(`🧭 CodeGraph Studio 交互式工作台服务`);
    console.log(`======================================================`);
    console.log(`工作区根目录: ${resolvedTarget}`);
    console.log(`本地服务端口: ${port}`);

    const server = new CodeGraphServer({
      workspaceRoot: resolvedTarget,
      port,
    });

    const actualPort = await server.start();
    const url = `http://localhost:${actualPort}`;
    console.log(`👉 工作台访问地址: ${url}`);
    console.log(`💡 提示: 按 Ctrl + C 可终止服务\n`);

    if (!noOpen) {
      const openCmd =
        process.platform === 'win32'
          ? `start ${url}`
          : process.platform === 'darwin'
          ? `open ${url}`
          : `xdg-open ${url}`;
      exec(openCmd);
    }

    process.on('SIGINT', async () => {
      console.log('\n[CodeGraph] 正在停止服务...');
      await server.stop();
      process.exit(0);
    });

    return;
  }

  // 默认：执行命令行全量静态分析并输出报告
  console.log(`\n======================================================`);
  console.log(`🧭 CodeGraph Studio 核心分析引擎 (0-Token 本地运行)`);
  console.log(`======================================================`);
  console.log(`目标分析目录: ${resolvedTarget}`);

  const core = new CodeGraphCore({
    workspaceRoot: resolvedTarget,
    scopePath: '.',
  });

  try {
    const result = await core.scan();

    console.log(`\n📊 分析报告概要:`);
    console.log(`------------------------------------------------------`);
    console.log(`- 架构原型初判: ${result.meta.archetype}`);
    console.log(`- 是否自动纠错: ${result.meta.isAutoCorrected ? '⚠️ 是 (已回滚至真实自适应拓扑)' : '否 (通过一致性审计)'}`);
    if (result.meta.archetypeHealth) {
      console.log(`- 综合健康评分: ${result.meta.archetypeHealth.score} (通过: ${result.meta.archetypeHealth.passed})`);
      for (const r of result.meta.archetypeHealth.reasons) {
        console.log(`  * ${r}`);
      }
    }
    console.log(`- 源码文件总数: ${result.meta.fileCount}`);
    console.log(`- 提取符号节点: ${result.meta.nodeCount}`);
    console.log(`- 提取关系连线: ${result.meta.edgeCount}`);
    console.log(`- 宏观模块数量: ${result.architectureView.modules.length}`);
    console.log(`- 跨模块总线条数: ${result.architectureView.buses.length}`);
    console.log(`- 业务时序流程数: ${result.processFlows.length}`);

    console.log(`\n📦 模块构成与虚拟端口:`);
    console.log(`------------------------------------------------------`);
    for (const m of result.architectureView.modules) {
      console.log(`[${m.name}] (包含 ${m.files.length} 个文件)`);
      if (m.inPorts.length > 0) console.log(`  ├─ 📥 In-Ports: [${m.inPorts.join(', ')}]`);
      if (m.outPorts.length > 0) console.log(`  └─ 📤 Out-Ports: [${m.outPorts.join(', ')}]`);
    }

    if (result.processFlows.length > 0) {
      console.log(`\n🌊 提取的典型业务时序流程:`);
      console.log(`------------------------------------------------------`);
      for (const flow of result.processFlows.slice(0, 3)) {
        console.log(`● ${flow.title}:`);
        const stepsDesc = flow.steps.map((s) => `[${s.name}]`).join(' ➔ ');
        console.log(`  ${stepsDesc}`);
      }
    }

    // 保存输出 JSON
    const outputDir = path.join(resolvedTarget, '.codegraph');
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }
    const outputPath = path.join(outputDir, 'graph.json');
    fs.writeFileSync(outputPath, JSON.stringify(result, null, 2), 'utf-8');
    console.log(`\n✅ 图谱数据已持久化保存至: ${outputPath}\n`);

  } catch (err) {
    console.error('执行失败:', err);
    process.exit(1);
  }
}

main();
