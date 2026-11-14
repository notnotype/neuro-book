---
schema: nbook.task/v2
taskId: t09-close-handshake
status: done
updated: 2026-11-14
---

# 关闭前询问

## 目标与范围

页面与壳之间的关闭前询问：浏览器宿主接下壳的询问、盖“正在关闭”层、按顺序问参与方，关最后一个窗口时取服务端“在跑的工作”提示；编辑器作为参与方结算保存；工作台通知加 `onClose`。依据提案 4.3 关闭窗口。

合同：[`runtime/browser-host`](../../../../../docs/specs/runtime/browser-host.md) 输出 9 到 11、[`runtime/server-host`](../../../../../docs/specs/runtime/server-host.md) 的“在跑的工作”、[`workbench/editor`](../../../../../docs/specs/workbench/editor.md) 输出 66、[`agent/sessions`](../../../../../docs/specs/agent/sessions.md) 输出 20、[`workbench/background-tasks`](../../../../../docs/specs/workbench/background-tasks.md) 输出 17、[`workbench/notifications`](../../../../../docs/specs/workbench/notifications.md) 输出 18；Windows 上与 [`runtime/desktop-shell`](../../../../../docs/specs/runtime/desktop-shell.md) 场景 5、6、7 联合验收。计划见 [plan.md](plan.md)。

## 当前状态

2026-11-13：切片 1 到 5 都已实施，代码在 Work 分支 `feat/w00046-desktop-release`。

实现审查两份，都已处理：
- 前端（Sonnet）6 条：修正 `538376667`，[报告](evidences/impl-review-r1-sonnet.txt)、[处理](evidences/impl-review-r1-sonnet-disposition.txt)；
- 服务端与 t08 修正（omp）6 条：修正 `a3d8006ca`，[报告](evidences/impl-review-r1-omp.txt)、[处理](evidences/impl-review-r1-omp-disposition.txt)。

Windows 联合验收（2026-11-14，与 t08 第 2 轮一起，[证据](../t08-desktop-shell/evidences/windows-shell-r2.txt)）：关最后一个窗口的 quit、编辑中关窗（取消、全部保存）、页面卡死、最后一次关闭中再打开都通过；有工作在跑时关窗（场景 7）要真实的 Agent 会话，没在 Windows 上做。

设计审查两份，发现都成立、照改：
- 前端（Sonnet）13 条：[报告](evidences/design-review-r1-sonnet.txt)、[处理](evidences/design-review-r1-sonnet-disposition.txt)；
- 服务端（omp）6 条：[报告](evidences/design-review-r1-omp.txt)、[处理](evidences/design-review-r1-omp-disposition.txt)。

各片提交：
- 切片 5 `0bdce81c7`：通知的用户关闭回告；
- 切片 3：
  - `d7de9fc33`：桥与询问控制器；
  - `16ac2f275`：正在关闭层、宿主询问与挡输入；
  - `1b331b4a9`：内置目录在建窗口时登记；
- 切片 4 `efc3614cf`：编辑器参与方；
- 切片 1、2：由 Opus 编码子代理在独立 worktree 实施（[交付报告](evidences/server-impl-report.txt)），主会话审过 diff 后合入：
  - `825b1c012`：服务端在跑的工作与项目取工作；
  - `4a1d496db`：Agent 与后台任务的登记；
  - `75c33a1d4`：起标题的会话不算在跑的工作，能力改为可选依赖；
- e2e `596b7a84e`，加一条 `quit` 的用例；
- `a04be981e`：开发模式监视根的期望补上 nb-flock 与 owned-process。后者是 t08 加依赖带来的；前者是 master 上已有的失败。

验证：
- 单元测试：服务端、项目、agent、tasks、编辑器、页面、共用与桌面核心 1026 条，只有监视根这 1 条失败，已修；
- 前端 dom 测试 156 条、nb-harness 句柄表 7 条；
- e2e 3 个文件 31 条：`desktop-close`、`editor-autosave`、`browser-host`；
- 类型检查与治理检查。

## 下一步

无。2026-11-14 合入 master（`fe4560370`），Spec 去掉 planned、补实现合同（`194393cd3`）；desktop-shell 待开发者批准晋升 `implemented`。
