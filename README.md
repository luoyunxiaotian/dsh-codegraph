# dsh-codegraph

> 🧭 **DeepSeek Harness 原生代码架构图谱与业务时序流分析插件**  
> 0-Token 纯本地静态解析 · 宏观架构拓扑 · 业务时序流程 · 模块符号下钻 · 深浅色主题实时跟随

[![DeepSeek Harness Plugin](https://img.shields.io/badge/DSH-Plugin-4176e6?style=flat-square&logo=deepseek)](https://github.com/luoyunxiaotian/dsh-codegraph)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg?style=flat-square)](https://opensource.org/licenses/MIT)
[![Node: >=20](https://img.shields.io/badge/node-%3E%3D20-green?style=flat-square)](https://nodejs.org)
[![0-Token](https://img.shields.io/badge/Cost-0%20Token-blue?style=flat-square)](#)

---

## ✨ 核心特性

- **🚀 0-Token 纯本地离线解析**  
  基于 WebAssembly 版 `web-tree-sitter` 进行静态 AST 语法树提取，**不消耗任何 API Token**、**不上传任何项目源码**、断网亦可全速运行。
- **🏛️ 宏观架构视图 (Macro Architecture)**  
  自动扫描源码工程，基于 Louvain 社区图聚类算法将成百上千个源文件智能归集为模块容器，自动计算跨模块调用与数据总线。支持鼠标自由拖拽选项卡、空白处/卡片右键菜单、双击模块平滑下钻。
- **🌊 业务时序流视图 (Business Process Flow)**  
  自动追踪业务逻辑调用链，将离散的函数调用编排为直观的时序流程图，精准区分触发入口（Trigger Entry）、分支决策（Decision）、数据存储（Data Store）与终态输出。
- **🔍 模块微观下钻 (Module DrillDown)**  
  深入模块内部查看其包含的类、函数符号、内部调用网络，以及该模块向外暴露的 In-Ports 与 Out-Ports 桩点接口。
- **🎨 官方级深浅色主题无缝跟随**  
  深度复刻 DeepSeek Harness 官方前端设计系统（DSH Tokens、圆角、排版与微交互）。宿主切换白色浅色或黑色深色主题时，图谱视窗 **0ms 实时变色**，且保留缩放、平移与交互状态不重置。
- **🤖 深度 AI Agent 协同与 5 大专属工具 (v1.5.0 新增)**  
  - **开局轻量骨架注入**：自动向 DeepSeek Agent 装配 ~300 Token 架构骨架，开局即拥有全局认知，会话期指纹冻结保护 DeepSeek KV Cache。
  - **5 个专职独立工具**：
    1. `codegraph_get_architecture`：宏观架构概览、模块依赖拓扑与公开端口契约；
    2. `codegraph_trace_flow`：端到端业务时序流穿透，一键获取有序执行步骤与源码锚点；
    3. `codegraph_impact_analysis`：代码改动影响面评估 (Blast Radius)，多跳向上递归追踪波及调用方与风险评级；
    4. `codegraph_inspect_narrative`：0-Token 本地交互叙事引擎，高密度解析职责、谁调它、它调谁，避免读入冗长大文件；
    5. `codegraph_audit_health`：全库检测循环依赖环路与反向分层越权，验证架构防劣化。
  - **确定性保真与响应 Memoization**：输出 Markdown 严格排序归一化，工具结果内存级秒级缓存，彻底解决调用工具导致大模型 Prompt Cache 击穿的问题。
- **⚡ 本地缓存与毫秒级增量静默自愈**  
  扫描结果持久化存储于工程根目录 `.codegraph/`，重启 DSH 即刻秒级恢复；代码编辑后后台 300ms 防抖静默增量热更新（Hash + Git 差异比对），Agent 随时获取最新图谱状态。

---

## 📦 安装与启用

### 方式一：克隆到 DeepSeek Harness 插件目录（推荐）

打开终端，进入你的 DeepSeek Harness 插件目录并克隆本仓库：

```bash
# 进入 DSH 插件存储目录 (Windows 用户一般位于 %USERPROFILE%\.dsh\plugins)
cd ~/.dsh/plugins

# 克隆插件
git clone https://github.com/luoyunxiaotian/dsh-codegraph.git dsh-codegraph
```

在你的 DSH 桌面配置文件（例如 `~/.dsh/profiles/desktop/cordis.patch.yml`）中添加插件引用：

```yaml
- insert:
    - id: codegraph
      name: dsh-codegraph
      config:
        port: 3333
```

重启 DeepSeek Harness，即可在任意会话顶部看到 **「代码图谱」** 专属标签页！

---

### 方式二：作为独立桌面工具运行 (Standalone)

如果你希望在独立浏览器或非 DSH 环境下使用代码图谱：

1. 克隆或下载本工程：
   ```bash
   git clone https://github.com/luoyunxiaotian/dsh-codegraph.git
   cd dsh-codegraph
   ```
2. 双击运行根目录下的 **`start-codegraph.bat`**（或 `启动CodeGraph.bat`）；
3. 也可以直接将任意项目工程文件夹拖拽到脚本图标上一键分析；
4. 服务启动后将自动调起系统浏览器打开 `http://localhost:3333`。

---

## 🌐 支持的编程语言与引擎生态

得益于 WebAssembly 驱动的 Tree-Sitter 语法解析能力与专属 AST 语义提取器，本图谱开箱支持以下核心语言生态与游戏引擎：

| 语言生态 | 扩展名 | 适用技术栈 / 游戏引擎 | 核心提取能力 |
| :--- | :--- | :--- | :--- |
| **Python** | `.py` | FastAPI, Django, Flask, 脚本工具 | Class, Def, Import, Calls, Decorator, Docstring |
| **TypeScript / JavaScript** | `.ts`, `.tsx`, `.js`, `.jsx` | React, Vue, Node.js, Next.js | Class, Interface, Function, Import/Export, Calls |
| **Vue SFC** | `.vue` | Vue 2/3, Nuxt, Vite 全家桶 | Vue Component 容器, Script 方法/状态, Template 嵌套 |
| **Go** | `.go` | Gin, gRPC, 云原生后端微服务 | Struct, Interface, Func, Package Import, Method |
| **Java** | `.java` | Spring Boot, Android 后端 | Class, Interface, Method, Import, Package |
| **Kotlin** | `.kt`, `.kts` | Android 原生, KMP 跨端, 现代 JVM | Class, Interface, Object, Retrofit/Ktor 路由与请求 |
| **Swift** | `.swift` | iOS / macOS / SwiftUI 原生全家桶 | Class, Struct, Protocol, Extension, URLSession 请求 |
| **C / C++** | `.c`, `.cpp`, `.h`, `.hpp` | **Unreal Engine (虚幻引擎)**, 基础库 | Struct, Class, Function, Include, 多继承与宏方法 |
| **C#** | `.cs` | **Unity 游戏引擎**, **Godot (C#)**, .NET | MonoBehaviour, Class, Interface, Method, Using |
| **Rust** | `.rs` | Axum, Actix, Reqwest, 系统底层 | Struct, Enum, Fn, Impl, Trait, Use, HTTP 路由 |

> 📌 **后续路线图规划 (梯队推进中)**：Lua (`.lua`, 覆盖游戏热更/Cocos/Roblox)、Unity (`.asmdef`)、Protobuf (`.proto`, gRPC 跨语言中枢对齐)、SQL DDL、Dart (`.dart`)、PHP 及 Ruby 正在依序推进中。

---

## 💾 缓存机制与工作区零污染设计

1. **秒级持久化缓存**：首次扫描会在被分析工程根目录生成 `.codegraph/graph-cache.json`。后续启动或切换视图无需重复耗时解析，极速秒开。
2. **非侵入式 Git 本地排除 (Zero Git-Status Pollution)**：
   - 插件会自动将 `.codegraph/` 登记至目标仓库本地私有排除文件 **`.git/info/exclude`** 中；
   - 与常规 `.gitignore` 具备完全相同的忽略能力，但**绝对不会修改您的工作区 `.gitignore` 文件**，不会造成任何意外的代码改动或干扰 CI/CD 流水线。
3. **事件循环友好 (Non-blocking)**：
   - 全量解析采用宏任务批次切片机制（Time-slicing via `setImmediate`），在大规模仓库扫描期间不占死 Node.js 事件循环，确保 HTTP API 响应正常且支持优雅中断。

---

## 🛠️ 项目工程结构

```
dsh-codegraph/
├── dist/                      # 预编译即用产物 (DSH 安装即跑，无需本地构建)
│   ├── index.js               # DSH Host 端核心插件与本地分析服务
│   ├── client.js              # DSH Web Client 端会话视窗挂载
│   ├── webview/               # React Flow 前端交互工作台 SPA
│   └── wasm/                  # Tree-Sitter 离线 WebAssembly 语法包
├── packages/
│   ├── core/                  # AST 解析引擎、图算法、ELK 布局与增量更新
│   ├── webview/               # 基于 TailwindCSS + ReactFlow 的 DSH 原生画风界面
│   └── harness-adapter/       # DSH Cordis 插件与槽位注入适配器
├── scripts/
│   ├── bundle-plugin.mjs      # 插件统一打包聚合脚本
│   └── start.ps1              # 跨平台一键自启动守护脚本
├── cordis.patch.yml           # DSH 插件补丁声明定义
├── package.json               # 插件主包清单
└── README.md
```

---

## 🤝 贡献与二次开发

欢迎提交 Issue 或 Pull Request！

```bash
# 1. 安装全量 monorepo 依赖
pnpm install

# 2. 构建全量子包并输出插件产物
pnpm run build

# 3. 运行本地开发调试
pnpm --filter @codegraph/core dev
pnpm --filter @codegraph/webview dev
```

---

## 📄 开源许可证

本项目基于 [MIT License](LICENSE) 开源协议。
