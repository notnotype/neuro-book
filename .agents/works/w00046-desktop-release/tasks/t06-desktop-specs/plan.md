# t06 计划：桌面发行的 Spec

## Context

提案 [desktop-distribution](../../../../../docs/proposals/desktop-distribution.md) 已接受，长期决定见 [ADR 0051](../../../../../docs/adr/0051-desktop-shell-electrobun-tag-release.md)。实现 Task t07 到 t10 动代码之前，要先有 `planned` 合同与编号验收（[规格驱动、验收先行](../../../../../docs/specs/README.md#开发方式规格驱动验收先行)）。本 Task 只写 Spec，不改代码。

开发者 2026-11-13 指定用 autonomous-delivery 推进 t06 到 t11：本该由开发者决定的点照推荐做，记进 [待确认清单](../../pending-confirmations.md)。

工作方式：Spec 在主工作区的 master 上写；写完按 reviewing 做设计审查（后端与设计类，派一个 omp 会话），阻塞等结论，处理后提交。

## 技术选型

无（只写文档）。

## 关键设计

### 能力划分

| 能力 | 文件 | 职责 | 依赖 |
|---|---|---|---|
| `runtime.desktop-shell`（新建） | `docs/specs/runtime/desktop-shell.md` | 桌面壳：单实例与开窗转交、连接服务端、窗口与导航、关闭的流程（壳一侧）、三态停止、崩溃、WebView2、状态根与便携 | `runtime.server-host`（认领应答、`--stop-stdin`）、`runtime.browser-host`（页面一侧的关闭前询问） |
| `runtime.desktop-update`（新建） | `docs/specs/runtime/desktop-update.md` | 桌面版的更新：检查、只升不降、提示、下载、下次启动换上、安装级排他、便携版只提示 | `runtime.desktop-shell` |
| `runtime.browser-host`（改，条目级 planned） | 同名文件 | 宿主发起的关闭前询问：页面怎样接下询问、跑关闭参与方、汇总在跑的工作、回答；页面一侧的桌面约定只给最小的方法 | — |
| `workbench.editor`（改） | 同名文件 | 作为关闭参与方：结算输入、自动保存或询问、保存失败不关 | `runtime.browser-host` |
| `agent.conversation`、`workbench.background-tasks`（改） | 同名文件 | 作为“在跑的工作”的提供方 | `runtime.browser-host` |
| `runtime.server-host`（改） | 同名文件 | 托管入口、`--stop-stdin` 与认领应答写成托管宿主依赖的合同；不承诺里去掉“桌面版的启动与停止通道另行设计” | — |
| `runtime.cli`（改） | 同名文件 | 应用包带托管入口；Windows 上 `nbook start` 的停止限制；与桌面壳共用状态根 | — |
| 术语表 | `docs/specs/runtime/glossary.md` | 加“桌面壳”“关闭前询问”“托管入口” | — |

更新单独成一份 Spec：它可以独立验收（t10 单独交付），而且壳的其余行为不依赖它。

关闭前询问拆在两边：壳一侧（截止、原生对话框、串行提交、最后一窗的判断）是 desktop-shell 的合同；页面一侧（参与方、汇总、回答）是 browser-host 的合同，desktop-shell 链接过去。跨两个能力的交互写在提供方：询问由页面回答，页面是提供方，所以协议的形状写在 browser-host。

“有任务在跑”的判断放在页面一侧：页面已经订阅了会话的 `activity`（[`agent/conversation`](../../../../../docs/specs/agent/conversation.md) 输出 19）与后台任务清单，不需要服务端新增汇总接口；壳只在“关最后一个窗口、且服务端归它”时以 `quit` 的原因询问，页面据此决定要不要提示。

### 已定的取值（写进 Spec，记进待确认清单）

- 应用标识 `io.github.notnotype.neurobook`，发布频道 `stable`，更新源是本仓库 GitHub Releases 最新 Release 的下载地址；
- 桌面锁的地址：`<状态根>/desktop.sock`，Windows `\\.\pipe\nbook-desktop-<哈希>`；协议是一行 JSON 的 `hello` 与 `open-window`；
- 截止：页面接下询问 3 秒；等“启动中、停止中”的实例与等旧壳退出 60 秒（同 `nbook start`）；壳停止服务端 90 秒；
- 便携标记：便携包根目录的 `NeuroBook.portable`，状态根是同目录的 `data\`；
- 壳的日志在 `<状态根>/logs/desktop/`，服务端的输出写进同目录的文件；
- 窗口第一版不记大小与位置；
- 服务端停止超时的记录在下一次启动的启动页上提示，带“打开日志目录”“继续”；
- 自己拥有的服务端意外退出时弹原生对话框：“重新启动服务”“退出”；
- 更新：启动后检查，之后每 24 小时；提示与下载完成用工作台通知；已更新时通知一次；
- 关闭时的编辑器对话框：“全部保存 / 不保存 / 取消”，列出文件；有写不出的文档时只有“不保存 / 取消”。

### 推迟

- `docs/standards/repository-workflow.md` 的发布一节推迟到 t11 改写：它描述的是现行做法，流水线上线前改写会让文档与现实不符；流水线的门禁与重跑规则在 t11 的计划里定。记进待确认清单（推进顺序内的调整）。
- `runtime/external-tools` 属 t05。

## Spec 与文档改动

见上表。另：`docs/specs/README.md` 的待实现规范表加两行；`.agents/works/w00046-desktop-release/README.md` 链接待确认清单。

## 切片

1. 写全部 Spec 改动，`bun run docs:check` 通过，连同计划、待确认清单、Task README 一起提交。
2. 设计审查（omp），处理，修订后与审查证据一起提交。

## 验收映射

本 Task 不实现行为。新 Spec 的编号由 t07 到 t10 的计划映射到测试。

## 验证

`bun run docs:check`；人工按 docs/specs/README.md 的“需人工核对”逐条过一遍。

## 不做与风险

- 风险：Electrobun 2.0.6 在 Windows 上的几项能力（沙箱下的事件桥、执行页面脚本、`will-close` 的同步否决、新窗口与导航的拦截）只在文档与源码里核实过，没有在 Windows 上实测。Spec 只写可观察行为，实现方式由 t08、t09 的计划核实；核实不了时回到 Spec 改合同并记进待确认清单。
