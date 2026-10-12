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
  const tag = 'v2.1.4';
  const releaseTitle = 'v2.1.4 - 修复页面切换后图谱画面丢失、视口自适应重绘与工作区多级嗅探';

  const releaseBody = `## 🚀 CodeGraph v2.1.4 视口稳定性与自愈重绘发布

本次更新重点攻克**从对话或其他页面切回代码图谱页面时画面丢失（黑屏/空白）**的体验断点，全面加固视口常驻与宿主通信恢复机制：

### ⚡ 核心改进与特性
* **移除宏观与时序流画布视口过度裁剪 (Viewport Cull Fix)**：
  * 彻底移除了 \`ArchitectureCanvas\` 与 \`ProcessFlowCanvas\` 上的 \`onlyRenderVisibleElements={true}\`；
  * 杜绝在标签页切换导致容器处于隐藏 (0x0) 状态时，ReactFlow 将卡片节点全量从 DOM 中剔除而导致的切回空白问题；宏观卡片永远稳定常驻。
* **全生命周期视窗激活自愈机制 (Auto-Recover on Return)**：
  * 在宏观图、时序图与下钻图画布中全面植入 \`visibilitychange\`、\`window.focus\`、\`resize\` 以及宿主通信 \`codegraph:view-active\` 监听；
  * 从对话或其他页面点回图谱时，画布自动在 50~100ms 内平滑执行 \`fitView({ padding: 0.15 })\`，画面瞬时亮起并完美居中。
* **宿主 8 级工作区容灾嗅探链与持久化记忆**：
  * 加固宿主适配器 \`activeWorkspace\` 解析链，深度对接 Cordis \`uiWorkspace\`、\`workspacesService\` 历史快照与会话专属路径，杜绝切回时工作区丢失；
  * 新增切回聚焦时主动向 iframe 发送视图激活脉冲，自动唤醒画布。
* **服务端宏观架构极速秒回与响应彻底瘦身**：
  * \`/api/workspace\` 与 \`/api/status\` 优先复用当前内存中已有的图谱结果 (**0ms 秒回**)；内存未命中时仅读取轻量 \`manifest.json\` (**< 2ms**，杜绝读取数千个分片)；
  * 响应中彻底剥离 7.2MB 的下钻排版大数组，仅下发轻量宏观排版 (< 5KB)，传输时间降至 1ms。

---
**质量与测试**：
全套 16 项自动化单元与跨语言集成测试 100% 绿灯全部通过。`;

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
