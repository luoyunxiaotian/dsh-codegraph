import { execSync } from 'child_process';

async function publishRelease() {
  console.log('🔍 从本地系统凭据管理器获取 GitHub 认证令牌...');
  const credOutput = execSync('git credential fill', {
    input: 'url=https://github.com\n\n',
    encoding: 'utf-8',
  });

  const tokenMatch = credOutput.match(/password=([^\r\n]+)/);
  const userMatch = credOutput.match(/username=([^\r\n]+)/);

  if (!tokenMatch) {
    throw new Error('未能在本地 Git Credential Manager 中找到 GitHub Token');
  }

  const token = tokenMatch[1].trim();
  const username = userMatch ? userMatch[1].trim() : 'luoyunxiaotian';
  const repoName = 'dsh-codegraph';
  const tag = 'v2.1.8';
  const releaseTitle = 'v2.1.8 - 彻底重构 Cordis v4 ctx.effect 插件生命周期注销与 DSH Desktop 热更新零超时退出';

  const releaseBody = `## 🚀 CodeGraph v2.1.8 插件生命周期与宿主热更新注销彻底修复发布

本次更新彻底根治了 **DeepSeek Harness Desktop (DSH Desktop) 在执行版本升级重启时，Host 宿主子进程无法优雅退出并触发 10 秒超时强杀（SIGTERM）导致更新中断** 的核心架构级问题：

### ⚡ 核心修复与改进
* **Cordis v4 生命周期注销规范重构 (Bug A 彻底修复)**：
  * 排查证实 DSH Desktop 运行的 Cordis v4.x 架构中已完全不存在 \`'dispose'\` 事件，历史代码绑定的 \`ctx.on('dispose')\` 在宿主停机时**从未被触发**，导致后台 HTTP 服务与文件监听长期遗留活动句柄；
  * 全面重写生命周期注销逻辑，采用 Cordis v4 官方标准 **\`ctx.effect(() => () => cleanup(), 'codegraph: cleanup')\`**，并同时向下兼容 \`ctx.on('dispose')\`；
  * 新增幂等清理屏障，确保在宿主 fiber 注销时 100% 触发卸载，自动销毁 \`fsWatcher\`、防抖定时器并调用 \`serverInstance.stop()\`。
* **HTTP Keep-Alive 原生熔断与底座 Socket 销毁 (Bug B 巩固)**：
  * 在 \`CodeGraphServer.stop()\` 中优先调用 Node.js 原生 API \`closeAllConnections()\` 与 \`closeIdleConnections()\`；
  * 底层对所有活跃 TCP 连接进行全生命周期追踪（\`openSockets\`），停机时毫秒级主动掐断连接池；
  * 内置 1000ms 超时安全熔断守卫，彻底杜绝任何形式的停机阻塞。
* **后台排版队列与循环定时器受控注销**：
  * 引入 \`isStopped\` 标志位，注销时彻底清除 \`drilldownQueue\` 并销毁 \`drilldownTimer\`，确保事件循环无任何微任务泄漏。

---
**自动化回归与验证**：
全套 18 项自动化单元与跨端集成测试（包括新增的 **[测试 18] Cordis v4 宿主注销触发 ctx.effect 优雅退出与资源清理验证**）100% 全部绿灯通过。`;

  console.log(`🚀 正在向 GitHub 发布 Release: ${tag} (${releaseTitle})...`);

  const res = await fetch(`https://api.github.com/repos/${username}/${repoName}/releases`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'User-Agent': 'DSH-CodeGraph-Publisher',
      'Accept': 'application/vnd.github+json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      tag_name: tag,
      target_commitish: 'main',
      name: releaseTitle,
      body: releaseBody,
      draft: false,
      prerelease: false,
    }),
  });

  const data = await res.json();
  if (!res.ok) {
    throw new Error(`创建 Release 失败 (${res.status}): ${data.message || JSON.stringify(data)}`);
  }

  console.log('✅ GitHub Release 发布成功！');
  console.log(`🔗 发行版链接: ${data.html_url}`);
}

publishRelease().catch((err) => {
  console.error('❌ 发布失败:', err.message);
  process.exit(1);
});
