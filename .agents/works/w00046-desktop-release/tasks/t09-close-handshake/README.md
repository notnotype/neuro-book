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

2026-11-13：计划初稿，待设计审查（前端部分 Sonnet，服务端部分 omp；omp 等 t08 的实现审查跑完再开，同一时间只跑一个）。

## 下一步

设计审查，处理后按切片实施。
