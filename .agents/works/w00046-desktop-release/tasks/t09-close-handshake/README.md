---
schema: nbook.task/v2
taskId: t09-close-handshake
status: active
updated: 2026-11-13
---

# 关闭前询问

## 目标与范围

页面与壳之间的关闭前询问：浏览器宿主接下壳的询问、盖“正在关闭”层、按顺序问参与方，关最后一个窗口时取服务端“在跑的工作”提示；编辑器作为参与方结算保存；工作台通知加 `onClose`。依据提案 4.3 关闭窗口。

合同：[`runtime/browser-host`](../../../../../docs/specs/runtime/browser-host.md) 输出 9 到 11、[`runtime/server-host`](../../../../../docs/specs/runtime/server-host.md) 的“在跑的工作”、[`workbench/editor`](../../../../../docs/specs/workbench/editor.md) 输出 66、[`agent/sessions`](../../../../../docs/specs/agent/sessions.md) 输出 20、[`workbench/background-tasks`](../../../../../docs/specs/workbench/background-tasks.md) 输出 17、[`workbench/notifications`](../../../../../docs/specs/workbench/notifications.md) 输出 18；Windows 上与 [`runtime/desktop-shell`](../../../../../docs/specs/runtime/desktop-shell.md) 场景 5、6、7 联合验收。计划见 [plan.md](plan.md)。

## 当前状态

2026-11-13：
- 前端部分的设计审查（Sonnet）报了 13 条，全部成立、照改（[报告](evidences/design-review-r1-sonnet.txt)、[处理](evidences/design-review-r1-sonnet-disposition.txt)）；Spec 补了三处，待确认清单加了五条。
- 服务端部分（在跑的工作）的 omp 设计审查在跑，切片 1、2 等它的结论。
- 前端各片先实施（与服务端部分文件不重叠），代码在 Work 分支：
  - 切片 5 `0bdce81c7`：通知的用户关闭回告，nb-ui `onDismiss`、工作台 `onClose`；
  - 切片 3：
    - `d7de9fc33`：桥的共用形状与校验、关闭参与方能力、页面的询问控制器，`close-query.test.ts` 11 条；
    - `16ac2f275`：正在关闭层与宿主的询问、挡输入、启动前接线；
  - 切片 4 `efc3614cf`：编辑器参与方，`window-close.test.ts` 8 条；
  - `596b7a84e`：真实浏览器验收 `e2e/desktop-close.e2e.ts`，2 条，用假壳派发询问。

## 下一步

1. 处理 omp 的服务端审查，实施切片 1、2：在跑的工作的宿主能力与接口、项目子进程取工作、Agent 与后台任务的登记。
2. e2e 补 `quit` 时取工作的提示。
3. Spec 去掉 planned、补实现合同。
4. Windows 联合验收。
