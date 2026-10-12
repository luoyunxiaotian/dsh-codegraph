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
  const tag = 'v2.1.3';
  const releaseTitle = 'v2.1.3 - 模块下钻秒开直出、宏观拓扑瘦身与工程上下文自保护重构';

  const releaseBody = `## 🚀 CodeGraph v2.1.3 核心性能与稳定性发布

本次更新重点攻克**模块下钻假等待遮罩**、**大型工程离开代码图谱后再切回加载异常**、以及**生成图谱后宿主会话历史载入变慢与上下文撑爆**等痛点，全面提升流畅度与稳定性：

### ⚡ 核心改进与特性
* **模块下钻 0 遮罩秒开直出 (Instant DrillDown & Prefetch)**：
  * **180ms 防抖遮罩**：已就绪或已缓存模块在 15ms 内极速返回，直接取消遮罩定时器，彻底告别假等待“正在优先构建内部流线”转圈；
  * **宏观卡片 Hover 智能预取 (Prefetch)**：鼠标滑过模块卡片瞬间静默拉取排版并注入内存，双击时 **100% 内存秒开直出**；
  * 精简 \`useEffect\` 依赖为 \`[module.id, workspaceRoot]\`，单次初始化彻底解耦，杜绝二次排版死循环。
* **大项目离开切回稳定性与 API 响应瘦身**：
  * **彻底瘦身 \`/api/workspace\`**：仅下发核心宏观拓扑架构（<50KB），剔除数万个微观 AST 节点，根除大项目 100MB 巨石 JSON 造成的 V8 \`Invalid string length\` 500 报错与主线程卡死；
  * **清理 10 秒高频 POST 轮询**：宿主心跳切换为极轻量 \`GET /api/status\` (<1ms)，大幅降低宿主与插件通信开销；
  * **Windows 路径严格归一化比对**：消除大小写与斜杠差异引起的误清空重置与 iframe 误重载。
* **工程上下文自保护隔离机制**：
  * 在 \`.codegraph\` 内部自动生成 \`.gitignore\` 与 \`.ignore\` 规则（\`*\\n\`），向 DSH 宿主全文索引器与上下文引擎显式声明全局忽略该目录，彻底杜绝数十兆缓存切片扫入会话历史；
  * 加固 \`getStableSkeleton\`，设置 2500 字符防御性截断，确保 LLM System Prompt 稳定不膨胀。

---
**质量与测试**：
全套 16 项自动化单元与集成测试（多语言 AST 解析、Sugiyama 正交分层理线排版、增量自愈、本地排除、微服务契约、跨端生态等）100% 绿灯全部通过。`;

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
