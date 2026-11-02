---
schema: nbook.task/v2
taskId: t29-kernel-impl
status: planned
updated: 2026-11-02
---

# 世界引擎内核实现（nb-canon）

## 目标与范围

按 t27 的内核 Spec 实现 nb-canon 包与插件接入：模型与计算、分段日志存储、白名单 MDX 渲染与带值写法、项目进程里的服务；星瑕样本在新内核上重放出与 t16 原型相同的结果。不做 Agent 工具、记账管线与正式的作者界面（Work README 决定表 2026-11-02）。

合同：实现 t27 写的内核 Spec（`docs/specs/canon/`，写好后补链接）；新建 capability，不改已有 Spec 的行为。

前置：t27 的 Spec 经开发者批准。

## 当前状态

2026-11-02 经 nbdev 新建，尚未开工。

## 下一步

t27 的 Spec 批准后，按 implementation-planning 写实施计划，在 worktree 里分四段实现。
