---
schema: nbook.task/v2
taskId: t13-tray
status: active
updated: 2026-11-16
---

# 系统托盘与关掉最后一个窗口时的去向

## 目标与范围

托盘图标与菜单；关最后一个窗口默认退出、设置里可改为留在托盘；有任务在跑时的提示加“在后台继续”

合同：改 [`runtime.desktop-shell`](../../../../../docs/specs/runtime/desktop-shell.md)（后台与托盘、关最后一个窗口的去向）与 [`runtime.browser-host`](../../../../../docs/specs/runtime/browser-host.md) 输出 10（在跑的工作的提示多“在后台继续”）。计划见 [plan.md](plan.md)。

## 当前状态

2026-11-15 经 nbdev 新建。2026-11-16 写好计划，设计审查中。Windows 上的验收要等 pc-notype 能构建（t18 里 Defender 删了 Hutch，等开发者处理）。

## 下一步

处理设计审查，按计划的切片实施。
