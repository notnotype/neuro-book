# Project Status

截至 2026-08-17。本文只记录仓库级现状；具体 TODO 以 GitHub Issue 为准，实现过程与证据以对应 Task 为准，当前版本发布载荷以 [`RELEASE.md`](RELEASE.md) 为准。

## 一句话结论

NeuroBook 当前处于快速开发阶段，产品主线已收敛到 Novel 写作模式 v1；核心数据与运行时合同基本落地，主要缺口是 stable 发布、真实 Provider、完整浏览器流程和持续作者试用。

## 产品基线

- 普通写作入口是 Novel IDE / Markdown Studio；共享 Activity Bar 提供书架、文件、角色、剧情、World、Jobs/Trace/History、用户资产、账户和设置。
- 默认链路是“灵感探索 → Project / Lorebook → World Engine 初始化 → 剧情规划与状态推进 → 章节写作 → 写后回补与修订”。
- Project 内容以 `project.yaml`、`manuscript/`、`lorebook/`、`agents/`、`manual/`、`reference/` 和 `.nbook/` 为核心；RAG、RP、simulation 等历史能力不进入普通写作模式默认入口。
- 用户状态由 State Root 承载，可重建数据由 Cache Root 承载。App SQLite 位于 Workspace Root `.nbook`；Project SQLite 位于具体 Project Workspace `.nbook`。
- Product Application Root 只读；Profile/Variable 编译、用户同步与动态 import cache 写入 State Root。安装、发布与 Desktop 继续遵循现行 manifest 和 runtime contract。

## 核心模块状态

| 模块 | 当前状态 | 依据 |
| --- | --- | --- |
| 写作模式 v1 | 主路径阶段完成，进入体验打磨 | [Task 64](packages/neuro-book/.agents/tasks/64-world-engine-prompt-engineering/README.md)、[Task 87](packages/neuro-book/.agents/tasks/87-plot-two-trees-and-writer-modes/README.md)、[Task 124](packages/neuro-book/.agents/tasks/124-writing-pipeline-batch3/README.md) |
| World Engine | 核心模型、API、Workbench 和作者主路径阶段完成 | [Task 56](packages/neuro-book/.agents/tasks/56-world-engine/README.md)、[Task 65](packages/neuro-book/.agents/tasks/65-world-engine-calendar-enhancement/README.md)、[Task 71](packages/neuro-book/.agents/tasks/71-world-engine-codeact-readwrite/README.md) |
| Plot | 两棵树模型已落地：承载树负责章节呈现，因果树负责剧情组织，`StoryScene` 连接两者 | [Task 78](packages/neuro-book/.agents/tasks/78-plot-scene-world-engine-bridge/README.md)、[Task 93](packages/neuro-book/.agents/tasks/93-plot-planning-layer/README.md)、[Task 99](packages/neuro-book/.agents/tasks/99-plot-planning-ui/README.md) |
| Agent / Workflow | 主要链路已实现；上下文压缩已补齐有界摘要、最终请求门禁、失败 checkpoint、thrashing 保护和受验证恢复材料；真实 Project、外部 Provider 和完整浏览器产品流程仍待做 | [Task 104](packages/neuro-book/.agents/tasks/104-pi-models-runtime-upgrade/README.md)、[Task 111](packages/neuro-book/.agents/tasks/111-workflow-agent-integration/README.md)、[Task 116](packages/neuro-book/.agents/tasks/116-agent-workflow-reliability/README.md)、[Task 139](packages/neuro-book/.agents/tasks/139-agent-abort-error-projection/README.md)、[Task 147](packages/neuro-book/.agents/tasks/147-agent-context-compaction-reliability/README.md) |
| Project 生命周期与存储 | 生命周期、快照、路径和运行产物合同已实现；跨环境发布验收未完成 | [Task 118](packages/neuro-book/.agents/tasks/118-project-catalog-snapshot-path-integration/README.md)、[Task 125](packages/neuro-book/.agents/tasks/125-runtime-artifact-storage-lifecycle/README.md) |
| Product Runtime / Manager | `0.9.6-canary.20260814.024826Z.9653191d` 已完成五平台 Product、Windows Portable、容器和公开资产验收；stable、公开签名安装器和正式 Desktop 发行方案仍未完成 | [Task 105](.agents/tasks/105-unified-installation-manager/README.md)、[Task 145](.agents/tasks/145-electron-desktop-productization/README.md) |
| Task 143 Desktop Envelope | Windows-first Electron/Tauri spike 已完成合同和共享 Workbench Chrome 验收；内部 Desktop 产品化证据继续由 Task 145维护 | [Task 143](.agents/tasks/143-desktop-envelope-installation-spike/README.md)、[Task 145](.agents/tasks/145-electron-desktop-productization/README.md) |
| Task 145 Electron Desktop Productization | Windows x64 内部 Desktop beta 的安装、UAC、Repair、卸载和 Sandbox `--delete-data` 验收已收口；公开 Application Canary `v0.9.6-canary.20260814.024826Z.9653191d` 已发布，但不包含 Electron Desktop ZIP/Depot。原生 Snap、真实外部 Provider、公开签名、updater 和 macOS 实包仍未完成 | [Task 145](.agents/tasks/145-electron-desktop-productization/README.md)、[ADR 0014](packages/neuro-book/docs/adr/0014-electron-desktop-productization.md)、[ADR 0016](packages/neuro-book/docs/adr/0016-windows-desktop-uac-broker.md)、[#87](https://github.com/notnotype/neuro-book/issues/87) |
| Agent 资产安装协议 | 方案已起草并完成自审，尚未实施 | [Task 135](packages/neuro-book/.agents/tasks/135-agent-asset-install-protocol/README.md) |
| llmlint | 3.0.0 收编到 workspace；`packages/llmlint/skill` 是唯一运行时 Skill 源，由 system assets projection 生成目标模板 | [Task 51](.agents/tasks/51-anti-ai-slop-skill/README.md) |

## 关键实现合同

- **运行目录**：`NEURO_BOOK_STATE_ROOT` 是用户状态真相源，`NEURO_BOOK_CACHE_ROOT` 是可重建缓存真相源。Installed Windows 使用 `%LOCALAPPDATA%/NeuroBook/{data,cache,desktop}`；Portable 使用 `data/` 与 `.cache/`。
- **Product 资产**：Product Application Root 只读。Profile/Variable 编译、用户同步和动态 import cache 写入 State Root，不通过修改 `/app` 权限或依赖宿主 `node_modules` 工作。
- **数据库**：App SQLite 位于 State Root 的 `workspace/.nbook/neuro-book.sqlite`；每个 Project 的 SQLite 位于对应 Project Workspace 的 `.nbook/project.sqlite`。项目身份和展示 metadata 以 Project Workspace 根目录的 `project.yaml` 为准。
- **World Engine**：schema 入口是 `world-engine/schema/index.ts`，日历入口是 `world-engine/calendar.ts`；写入统一使用 `patches` 的四种操作 `replace`、`increment`、`remove`、`append`，Agent 通过 `execute_world` 使用读写或只读模式。
- **认证**：鉴权配置属于 State Root 的 Boot Config；服务器默认开启，Windows Portable 默认关闭，修改后需要重启。
- **安装与发布**：Installation Manifest v5、Release Manifest v5 和 Product Runtime Contract v5 是安装、Manager、Portable、Container 与 Agent CLI 共用的版本合同。

## 最新收口

- [Task 139](packages/neuro-book/.agents/tasks/139-agent-abort-error-projection/README.md) 将主动取消与运行错误分开：取消显示中性状态，保留已生成的半截正文，并避免重复错误气泡。
- [Task 138](packages/neuro-book/.agents/tasks/138-agent-conversation-branch-projection/README.md) 将对话分支切换改为基于可见对话锚点的投影，运行期记账 entry 不再制造假分支。
- [Task 111](packages/neuro-book/.agents/tasks/111-workflow-agent-integration/README.md) 已补齐 Workflow 的持久身份、公开投影、Job/Run 详情、`wf.ask` 和 Composer/Preview 防重复提交；动态 `outputSchema` 的 `report_result` 合同也已补齐。
- Product Runtime 已完成 Windows clean archive、Verifier、migration、Profile/Variable、SQLite、Sharp、Workspace CLI、HTTP/shutdown 和 State Root 生命周期验证；`v0.9.6-canary.20260814.024826Z.9653191d` 又完成了五平台 Product、Portable、容器、公开 manifest/checksum 和 GHCR 验收。真实作者流程和 stable 发布仍单独记录。
- Task 143 已完成 Windows x64 的 Electron/Tauri Portable、ASAR、Manager CLI 用户级安装、Desktop Bridge/Supervisor、动态 loopback、认证关闭和 Tauri Job Object forced smoke；证据见 [Task 143 walkthrough](.agents/tasks/143-desktop-envelope-installation-spike/README.md)。共享 Workbench Chrome、书架/Project、Inline Editor Agent 和 Agent/IDE 切换已完成 Edge headless/headed 验收；原生拖动/Snap/托盘/对话框、完整 SSE/WebSocket、WebView2 分发、签名安装器/updater、macOS 实际包和完整 crash/disconnect 矩阵仍未完成。
- Task 143 本轮收口补齐了 Portable Envelope 内容摘要、startup nonce header 保护、State Root 日志入口、Windows PATH fail-closed 读取、同盘 staging 和 Tauri 关闭幂等 claim；随后完成当前 Source 冻结后的 clean Build A/B 与 E/F Portable 重建。最终证据记录 Product image `sha256:8aae90a2d5953e1eb2aa4e7aac4326b232f80ddbcc8082bc15f8e239819cb49b`、Electron ZIP 389,594,292 bytes、Tauri ZIP 243,829,892 bytes，两个 ZIP 与 payload 均逐字节一致；旧 stale Tauri/Manager bundle 失败已由重建二进制后的仓库外 headless smoke 复核通过。随后生成固定七项的 Aggregate Depot，G/H 两批共享 verifier 通过且逐字节一致；聚合 ZIP 为 628,325,258 bytes，仍是未签名 spike 交付。
- Task 143 的 2026-08-06 收口又补齐了 Desktop Menu Contract：自绘标题栏提供完整下拉菜单，Electron 原生菜单和 Tauri 页面事件覆盖 15 个公开命令，Settings、编辑、缩放、刷新和 About 均有实际消费；共享分发器拒绝未知运行时命令。该批次的 focused Desktop Contract 为 3 files / 15 tests，根 typecheck、Electron bundle、Tauri `cargo fmt --check`/`cargo check` 与 security audit 已通过；随后在同一 Source commit 上完成 Product Build A/B、两个 Portable 组包和仓库外 smoke，数字见 [Task 143 walkthrough](.agents/tasks/143-desktop-envelope-installation-spike/README.md)。
- Task 143 最新收口又修复了两个 clean-runner 问题：Windows Registry `UninstallString` 现在始终使用 Windows 分隔符；Desktop Contract 使用独立 esbuild TypeScript transform，不依赖 `.nuxt/tsconfig.json`，无 `.nuxt` 本地验证为 4 files / 19 tests。提交 `906271b4` 的最终 CI 已确认 Desktop Contract 三平台和 Product Platform 四平台均通过；根 Typecheck/Full tests advisory 的既有失败（Prisma generated client、隐式 `any`、POSIX `C:/...` fixture）单独登记，不能当作本轮桌面回归。最终 Full tests 为 464 passed、3 skipped，24 个文件 / 78 个测试失败；这些失败仍来自 POSIX `C:/...` 伪路径门禁。
- Task 143 的 Workbench Chrome 批次删除了重复的工作区/书架 Header 和 IDE Agent Drawer，建立 request-scoped Chrome context、48px Activity Bar、四区 Desktop 标题栏与独立 Inline Editor Agent controller；Desktop Bridge 升级到 v2，不保留 v1 fallback。当前门禁为根/scripts typecheck、Desktop Contract `7 files / 28 tests`、相邻 UI `6 files / 21 tests`、Manager `1 file / 12 tests`、Electron bundle、Tauri fmt/check，以及 Edge headless/headed Workbench smoke 全部通过。
- Task 145 已从最新 `origin/master` 建立生产分支并创建 Issue #87。2026-08-12 晚间完成三个发行缺陷修复并重新构建：`windows-bun-stage0.ps1` 补 UTF-8 BOM（打包器加 BOM 门禁）；win32-x64 Product 镜像 app-local 携带 MSVC Runtime DLL（`NEURO_BOOK_MSVC_RUNTIME_DIR` 显式构建输入）；Windows Uninstall Host 长路径（`\\?\` 前缀）、纯 ASCII 脚本与 launcher root 清理。最终 Product image `sha256:df2f4812...`（3250 files / 136,634,228 bytes，A/B 一致），Electron Portable ZIP `7ac0c915...`（390,489,189 bytes）与 Desktop Depot ZIP `cf7f2b2c...`（387,870,766 bytes）连续组包两次逐字节一致；MSVC Runtime DLL 已入仓 `scripts/build/inputs/msvc-runtime` 作为默认构建输入，CI Windows Product 发布链路不再断链。宿主机 machine 全链路（可见 UAC）绑定旧 image `c5f208` 保持有效（交互/生命周期路径未变）；Windows Sandbox `--delete-data` 全自动验收（Store `wsb.exe` CLI + System 上下文）对新 image 通过，证据 `ok=true`（11/11 项检查）。最终门禁 Manager 41 files / 327 tests、Desktop Contract、typecheck、Electron bundle、packaging security audit 与 `git diff --check` 全绿；PR #88 必检此前已通过，Full tests advisory 的 Harness 黑盒 30 秒超时为既有基线（Issue #90），与桌面改动无关；详见 [Task 145 final acceptance](.agents/tasks/145-electron-desktop-productization/evidences/final-acceptance.json)。
- Task 143 的最终 Workbench 证据使用 Source `15d47946` 完成 Product A/B 和 Portable A/B：Product 为 3,242 文件 / 134,549,619 bytes、imageId `sha256:a330b98936df7694135c020e98fb824648192767d6e25a09405f3f14305d95f3`；Electron/Tauri ZIP 分别为 389,600,838 / 243,840,895 bytes，聚合 Depot 为 628,342,701 bytes，重复组包逐字节一致。仓库外 Electron graceful、Tauri graceful/forced/立即重启均通过；Electron 真包 CDP 已验证 36px 标题栏、48px Activity Bar、drag/no-drag、Settings 和 Quit。Tauri 原生拖动/菜单/托盘/Snap、B/S Docker 和 State Root 实际删除本轮未完成，详见 [Workbench Chrome evidence](.agents/tasks/143-desktop-envelope-installation-spike/evidences/workbench-chrome-acceptance.json)。
 - 2026-08-14：PR [#101](https://github.com/notnotype/neuro-book/pull/101) 已合并，Provider API / Automatic Model Discovery 的代理安全、`file:` URL 拒绝、diagnostics、Google `input: ["text"]` 和 duplicate-only `partial` 合同已进入 `master`。Issue [#100](https://github.com/notnotype/neuro-book/issues/100) 的独立 Provider 详情 UI 问题在隔离 Chromium 桌面/窄屏路径中未稳定复现，已关闭；未提交猜测性 UI 修复。详见 [Task 104](packages/neuro-book/.agents/tasks/104-pi-models-runtime-upgrade/README.md) 与 [Task 148](packages/neuro-book/.agents/tasks/148-provider-details-transition/README.md)。
- 2026-08-14：Issue [#109](https://github.com/notnotype/neuro-book/issues/109) 修复 Manager 在 Podman Compose 前置裸容器 ID 时无法解析 Application State migration 报告的问题；Podman provider 现在仅在独立 `podman-compose` 可用时固定注入，否则保留用户环境变量并允许 `podman compose` 自行委托。源码回归与 Manager 全量测试通过；本机未安装 Podman，真实 macOS/Podman machine 链路仍待容器 runner 验收，详见 [Task 105](.agents/tasks/105-unified-installation-manager/README.md)。
- 测试写入 Project Workspace 的高风险路径已切换到隔离 Runtime Workspace Root；相关清理竞态和真实根残留已有专项记录，详见 [Task 125 Round 04](packages/neuro-book/.agents/tasks/125-runtime-artifact-storage-lifecycle/walkthroughs/round-04-workspace-test-isolation.md)。
- 2026-08-25：Issue [#109](https://github.com/notnotype/neuro-book/issues/109) 收口——release-container 新增 `verify-public-ghcr-podman-delegate` job，以 PATH 屏蔽 podman-compose 的方式真机验收 `podman compose` 委托路径；`verify-public-ghcr.sh` 以第 6 参选择 provider 合同。发版过程暴露并修复 tarball 内部 `file:` 依赖（[#179](https://github.com/notnotype/neuro-book/pull/179)）与 bun.lock Windows 分隔符（[#181](https://github.com/notnotype/neuro-book/pull/181)）两个发布链缺陷；Manager canary.55/.56 为未过门禁的审计记录，canary.57 已公开。详见 [Task 105](.agents/tasks/105-unified-installation-manager/README.md)。
- [Task 147](packages/neuro-book/.agents/tasks/147-agent-context-compaction-reliability/README.md) 修复了压缩摘要请求自身超窗：摘要输入/输出独立预算，所有生产 provider seam 在调用前检查最终上下文，自动摘要失败写确定性 checkpoint，重复压缩检测与 thrashing 停止，受验证恢复材料注入。Faux Provider、完整 Harness、文件工具和 typecheck 已通过；真实 provider trace、作者视角长 session 与压缩频率尚未验收。

## 当前风险与验收缺口

- **发布**：当前公开版本仍是 canary；stable、公开签名、后台 updater 与正式 Desktop 发行未完成。历史版本和精确资产身份见 `vitepress/locales/zh-Hans/changelog/` 与对应 Task。
- **产品验收**：聚焦测试、typecheck 和构建不能代替浏览器、真实 Project Workspace、真实 Provider/Model 与作者视角写作 smoke。
- **Desktop**：Windows x64 内部 beta 已有阶段证据；原生 Snap、完整 SSE/WebSocket 断连矩阵、macOS 实包和公开 Desktop 资产仍缺。
- **Agent 长上下文验收**：Task 147 的 Faux Provider、完整 Harness、文件工具和 typecheck 已通过；真实 provider trace、作者视角长 session 与压缩频率尚未验收，不能用自动化测试替代。
- **写作产品线**：下一阶段是 dogfooding、章节写作与修订反馈、World Engine 体验，以及运行状态是否显式提交等产品决策。
- **架构债务**：shared/Manager 运行时依赖环、shared 与 `server/agent` 的类型环、大型 Facade 和 OpenAPI 生成物边界仍由 [ADR 0015](packages/neuro-book/docs/adr/0015-architecture-boundaries-and-deferred-structure.md) 与相关 Issue 管理，不是已复现故障。
- **事务边界**：文件系统、Project SQLite、History SQLite、Session JSONL 与 Job JSON 不承诺全局原子事务；当前不引入分布式事务框架。
- **上游依赖**：Nitro dev source-map 临时补丁待上游稳定版本实际包含修复后移除。
