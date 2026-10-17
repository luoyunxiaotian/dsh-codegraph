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
  const tag = 'v2.1.7';
  const releaseTitle = 'v2.1.7 - 彻底解决 CodeGraphServer 优雅退出 Keep-Alive 挂起与 DSH Desktop 更新超时强杀';

  const releaseBody = `## 🚀 CodeGraph v2.1.7 进程生命周期与热更新优雅退出加固正式发布

本次更新重点修复了 **DSH 桌面端（DeepSeek Harness Desktop）在执行软件版本更新与重启时，因后台插件进程无法优雅退出而触发 10 秒超时强杀（SIGTERM）并导致更新被中断** 的生产级阻断问题：

### ⚡ 核心改进与特性
* **彻底根治 Keep-Alive 长连接挂起导致停机阻塞 (Active Connection Teardown)**：
  * Node.js 原生 \`http.Server.close()\` 默认仅停止接收入站请求，但绝不会主动掐断活跃的 TCP 连接。由于现代浏览器/Chromium 默认开启 \`Connection: keep-alive\`，空闲 Socket 长期保活导致 \`close\` 回调一直挂起等待；
  * \`CodeGraphServer.stop()\` 接入 Node.js 18.2.0+ 原生 API：\`closeAllConnections()\` 与 \`closeIdleConnections()\`，在接收注销信号瞬间主动掐断全部客户端长连接；
  * 新增底层 Socket 生命周期全程追踪兜底（\`openSockets: Set<net.Socket>\`），停机时强力 \`socket.destroy()\`，向前兼容所有 Node.js 运行时环境，实现 **0ms 极速停机退出**。
* **1000ms 熔断安全超时守卫 (Safety Timeout Guard)**：
  * 在 \`stop()\` 的 Promise 中内置带 \`.unref()\` 的 1 秒超时安全守卫，即使发生任何极端底层/操作系统 Socket 异常，也保证在 1 秒内安全 resolve，彻底绝缘 DSH Desktop 的 10 秒 Graceful Deadline 保护机制。
* **排版队列与定时器受控销毁**：
  * 引入 \`isStopped\` 受控状态标志，在服务注销时彻底清空后台异步下钻排版队列（\`drilldownQueue\`）并注销 \`drilldownTimer\`，确保 Node.js 事件循环瞬间清空，进程无任何活动句柄残留。
* **宿主注销防抖定时器严密清空**：
  * 在 \`harness-adapter\` 的 \`ctx.on('dispose')\` 中严格将 \`debounceTimer\` 重置清空。

---
**质量与测试**：
新增针对 HTTP Keep-Alive 连接保活场景下的服务关闭自动化测试（测试 17），全套 17 项核心测试 100% 绿灯全部通过，验证服务在活跃长连接下 0ms 瞬间退出。`;

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
