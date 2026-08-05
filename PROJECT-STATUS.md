# Project Status

> 截至 2026-08-05。本文只记录仓库级现状，不替代 `docs/tasks/` 中的实现 walkthrough；具体 TODO 和后续安排以对应 Issue、Task 为准。

## 一句话结论

NeuroBook 当前处于快速开发阶段，产品主线已经收敛到 **Novel 写作模式 v1**。Markdown Studio、Project Workspace、Agent、World Engine 和 Plot 工作台的核心合同已基本落地；当前主要缺口是产品级发布验收、浏览器/真实模型验收和持续作者试用，不是核心数据模型的重新设计。

## 产品基线

- 普通写作入口以 Novel IDE / Markdown Studio 为主，顶栏提供 Bookshelf、World、Plot、User Assets 和 Agent。
- 默认写作链路是：`灵感探索 → Project / Lorebook → World Engine 初始化 → 08 剧情规划与状态推进 → 09 章节写作 → 写后回补与修订`。
- 默认 Project 提供 `manuscript/`、`lorebook/`、`agents/`、`manual/`、`reference/` 和 `world-engine/` 骨架；新 Project 不再生成 `simulation/`。
- RAG、RP、simulation 等历史能力仍保留在代码和历史资料中，但不进入普通写作模式的默认入口。
- 默认模板只创建 `leader.default/` 和 `writer/` 上下文；RP profile 与历史 profile 文件不删除，恢复入口另行设计。

## 核心模块状态

| 模块 | 当前状态 | 依据 |
| --- | --- | --- |
| 写作模式 v1 | 主路径阶段完成，进入体验打磨 | [Task 64](docs/tasks/64-world-engine-prompt-engineering/README.md)、[Task 87](docs/tasks/87-plot-two-trees-and-writer-modes/README.md)、[Task 124](docs/tasks/124-writing-pipeline-batch3/README.md) |
| World Engine | 核心模型、API、Workbench 和作者主路径阶段完成 | [Task 56](docs/tasks/56-world-engine/README.md)、[Task 65](docs/tasks/65-world-engine-calendar-enhancement/README.md)、[Task 71](docs/tasks/71-world-engine-codeact-readwrite/README.md) |
| Plot | 两棵树模型已落地：承载树负责章节呈现，因果树负责剧情组织，`StoryScene` 连接两者 | [Task 78](docs/tasks/78-plot-scene-world-engine-bridge/README.md)、[Task 93](docs/tasks/93-plot-planning-layer/README.md)、[Task 99](docs/tasks/99-plot-planning-ui/README.md) |
| Agent / Workflow | 主要链路已实现；人工界面、真实 Project、provider 和模型验收待做 | [Task 111](docs/tasks/111-workflow-agent-integration/README.md)、[Task 116](docs/tasks/116-agent-workflow-reliability/README.md)、[Task 139](docs/tasks/139-agent-abort-error-projection/README.md) |
| Project 生命周期与存储 | 生命周期、快照、路径和运行产物合同已实现；跨环境发布验收未完成 | [Task 118](docs/tasks/118-project-catalog-snapshot-path-integration/README.md)、[Task 125](docs/tasks/125-runtime-artifact-storage-lifecycle/README.md) |
| Product Runtime / Manager | Windows Product 本地验收通过；正式 Release Candidate 仍待多平台和容器验收 | [Task 105](docs/tasks/105-unified-installation-manager/README.md)、[Task 130](docs/tasks/130-desktop-application-foundation/README.md)、[Task 117](docs/tasks/117-windows-process-tree-lifecycle/README.md) |
| Task 140 Desktop Envelope | Windows-first Electron/Tauri 自动化与 Manager CLI 安装合同已通过；真实窗口、WebView2、签名发行与最终框架选择仍未完成 | [Task 140](docs/tasks/140-desktop-envelope-installation-spike/README.md) |
| Agent 资产安装协议 | 方案已起草并完成自审，尚未实施 | [Task 135](docs/tasks/135-agent-asset-install-protocol/README.md) |
| llmlint | 3.0.0 已同步到 sibling、内置 vendored runtime 和 user runtime | [Task 51](docs/tasks/51-anti-ai-slop-skill/README.md) |

## 关键实现合同

- **运行目录**：`NEURO_BOOK_STATE_ROOT` 是用户状态真相源，`NEURO_BOOK_CACHE_ROOT` 是可重建缓存真相源。Installed Windows 使用 `%LOCALAPPDATA%/NeuroBook/{data,cache,desktop}`；Portable 使用 `data/` 与 `.cache/`。
- **Product 资产**：Product Application Root 只读。Profile/Variable 编译、用户同步和动态 import cache 写入 State Root，不通过修改 `/app` 权限或依赖宿主 `node_modules` 工作。
- **数据库**：App SQLite 位于 State Root 的 `workspace/.nbook/neuro-book.sqlite`；每个 Project 的 SQLite 位于对应 Project Workspace 的 `.nbook/project.sqlite`。项目身份和展示 metadata 以 Project Workspace 根目录的 `project.yaml` 为准。
- **World Engine**：schema 入口是 `world-engine/schema/index.ts`，日历入口是 `world-engine/calendar.ts`；写入统一使用 `patches` 的四种操作 `replace`、`increment`、`remove`、`append`，Agent 通过 `execute_world` 使用读写或只读模式。
- **认证**：鉴权配置属于 State Root 的 Boot Config；服务器默认开启，Windows Portable 默认关闭，修改后需要重启。
- **安装与发布**：Installation Manifest v5、Release Manifest v5 和 Product Runtime Contract v5 是安装、Manager、Portable、Container 与 Agent CLI 共用的版本合同。

## 最新收口

- [Task 139](docs/tasks/139-agent-abort-error-projection/README.md) 将主动取消与运行错误分开：取消显示中性状态，保留已生成的半截正文，并避免重复错误气泡。
- [Task 138](docs/tasks/138-agent-conversation-branch-projection/README.md) 将对话分支切换改为基于可见对话锚点的投影，运行期记账 entry 不再制造假分支。
- [Task 111](docs/tasks/111-workflow-agent-integration/README.md) 已补齐 Workflow 的持久身份、公开投影、Job/Run 详情、`wf.ask` 和 Composer/Preview 防重复提交；动态 `outputSchema` 的 `report_result` 合同也已补齐。
- Product Runtime 已完成 Windows clean archive、Verifier、migration、Profile/Variable、SQLite、Sharp、Workspace CLI、HTTP/shutdown 和 State Root 生命周期验证。该证据不等于五平台 Release、真实 Docker/Podman、最终 Portable、浏览器或桌面壳验收。
- Task 140 已完成 Windows x64 的 Electron/Tauri Portable、ASAR、Manager CLI 用户级安装、Desktop Bridge/Supervisor、动态 loopback、认证关闭和 Tauri Job Object forced smoke；证据见 [Task 140 walkthrough](docs/tasks/140-desktop-envelope-installation-spike/README.md)。真实窗口/SSE/WebSocket/编辑器交互、WebView2 分发、签名安装器/updater、macOS 实际包和完整 crash/disconnect 矩阵仍未完成。
- Task 140 本轮收口补齐了 Portable Envelope 内容摘要、startup nonce header 保护、State Root 日志入口、Windows PATH fail-closed 读取、同盘 staging 和 Tauri 关闭幂等 claim；focused/type/security 门禁已重跑通过。此前 source-locked Build A/B 与 Portable 数字尚未包含这些最新改动，新的 clean build/Portable smoke 仍需单独记录，不能直接复用旧产物结论。
- 测试写入 Project Workspace 的高风险路径已切换到隔离 Runtime Workspace Root；相关清理竞态和真实根残留已有专项记录，详见 [Task 125 Round 04](docs/tasks/125-runtime-artifact-storage-lifecycle/walkthroughs/round-04-workspace-test-isolation.md)。

## 当前风险与验收缺口

- **发布链路**：仍需完成 Linux/macOS baseline、正式五平台 Candidate、真实 Docker/rootless Podman、最终 Portable verifier、桌面壳生命周期和公开 Release 证据。
- **产品验收**：多项 Task 的 focused tests 和 typecheck 已通过，但浏览器人工验收、真实 Project Workspace、真实 provider/model 和作者视角写作 smoke 不能由单测替代。
- **写作产品线**：下一阶段重点是 dogfooding、章节写作与修订反馈、World Engine 体验打磨，以及 `memory.jsonl` / `state.md` 是否显式提交等产品决策，见 [#21](https://github.com/notnotype/neuro-book/issues/21)。
- **未决方向**：一次性对话模型接入见 [#19](https://github.com/notnotype/neuro-book/issues/19)；整书导入见 [#22](https://github.com/notnotype/neuro-book/issues/22)；Session 摘要空闲触发见 [#23](https://github.com/notnotype/neuro-book/issues/23)。
- **维护成本**：仓库结构优化的后续批次暂缓，先处理 Workflow、Product Runtime 和生命周期链路的集成与验收，见 [Task 123](docs/tasks/123-repo-structure-optimization/README.md)。
- **上游依赖**：Nitro dev source-map 临时补丁等待上游稳定版实际包含修复后移除，见 [#20](https://github.com/notnotype/neuro-book/issues/20)。

## 验证口径

- Task 中的 focused test、typecheck、构建、浏览器验收和真实模型验收分别记录，不能互相替代。
- 最近 Workflow 收口记录了服务端 17 个文件 260 项、前端 5 个文件 39 项自动化验证通过；相关 `typecheck` 复跑退出码为 0。
- 本文件更新未自动运行测试或浏览器验收；详细命令、通过数量和未运行项以对应 Task walkthrough 为准。
