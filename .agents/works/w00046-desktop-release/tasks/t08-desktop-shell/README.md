---
schema: nbook.task/v2
taskId: t08-desktop-shell
status: active
updated: 2026-11-13
---

# Electrobun 桌面壳

## 目标与范围

新建桌面壳：随包 Bun 拉起托管入口、从认领应答取地址、单实例锁与带版本的开窗转交、连接判定表、三态停止与截止、导航与新窗口、WebView2 检查、状态根与便携标记、缺省端口；Hutch 与 Electrobun 固定版本。依据提案 4.2 到 4.5、ADR 0051 决定 1、2、4、5。

合同：[`runtime/desktop-shell`](../../../../../docs/specs/runtime/desktop-shell.md)（壳一侧）；[`runtime/server-host`](../../../../../docs/specs/runtime/server-host.md) 的实例认领（nb-host 认领的扩展）。计划见 [plan.md](plan.md)。

## 当前状态

2026-11-13：计划经 omp 设计审查一轮（有效 12 条，阻断 2，全部照改，[报告](evidences/design-review-r1-omp.txt)、[处理](evidences/design-review-r1-disposition.txt)）；Spec 随之小改（`hello` 状态用 `ready`、对话框是壳的小窗口、新窗口的已知限制）。

代码在 Work 分支 `feat/w00046-desktop-release`（worktree `.worktree/w00046-desktop-release`）：

- 切片 1 `a1ee6a9b3`：nb-host 认领加 `socketName`、按字节的 `messageLimit`、绝对的 3 秒收请求截止、同步的 `requests` 与 `unknownReply`、`sendRequest`，`publish` 的 `rpcUrl` 可为 null。nb-host 全部测试、应用的命令行与服务端测试通过。
- `7f760b404`：owned-process 的租约交出目标 pid（`rootPid`）；核实了两个平台的监督进程都把标准输入转给目标。
- 切片 2（`packages/neuro-book/src/desktop/`）：`0ef17f9c9` 状态根与便携、长截止分段、连接判定；`cf4add662` 桌面锁与开窗转交；`522cc169f` 自有服务端（真实服务端测试：只认自己 pid 的就绪、被抢先交回外部实例、重新启动用上一次端口、意外退出、停止卡住时到截止结束整棵树连孙进程）；关窗协调 `windows.ts`（8 个用例）。`bun test src/desktop` 全过。

- 切片 2 续：`6095cc535` 关窗协调；`7ebc09fe7` 壳的流程 `shell.ts`（取锁与转交、连接或拉起、“上次没有正常停止”的提示、最后一次关闭后停服放锁、启动中关窗作废）。`bun test src/desktop` 28 个全过。
- 切片 3：`c705d0e03` Electrobun 适配层（窗口与关窗否决、壳的对话框窗口、导航规则、预加载、桥、WebView2 检查）与 Hutch 配置；`844c0a079` 预打包的主进程改放 `bundle/`，与 Electrobun 自己的 `build/` 输出分开。
- 切片 4：`runtime/server-host` 的实现合同写进认领档案的 `socketName`、`messageLimit`、`requests`、`unknownReply`、绝对截止与 `sendRequest`。

Windows 实测第 1 轮（[证据](evidences/windows-shell-r1.txt)，只用 UI 自动化读文字，不截屏）：启动与两份认领、第二次启动转交开窗、关窗被否决、3 秒后壳的“没有响应”对话框、对话框开着时转交照常、“取消关闭”。pc-notype 17:05 后离线，剩下的待它恢复后补：强制关闭、关掉最后一个窗口后的停服与退出、服务端意外退出的对话框、外链交系统浏览器、便携 zip、`Alt+F4` 与任务栏关闭。

计划里“用只回答桥协议的测试页面驱动 `ack`、`allow`、`deny`”在 t08 没做：产品页面在 t09 才参与关窗，这几条路径由 `windows.test.ts` 覆盖，Windows 上与 t09 联合验收。

实现审查第 1 轮（omp）报 9 条（阻断 1、重要 8），均成立、均改（[报告](evidences/impl-review-r1-omp.txt)、[处理](evidences/impl-review-r1-disposition.txt)）。修正提交 `9c73f22e6`、`0060cb892`、`fcc04a4b7`，Work 分支上桌面核心、桥与询问的 51 条测试、认领 17 条、类型检查、打包与治理检查通过。

## 下一步

pc-notype 恢复后用新构建跑 Windows 实测第 2 轮：上面剩下的项、审查修正里只能在 Windows 上验的第 1、4、6、8 条，并与 t09 联合验收；之后合入 master。
