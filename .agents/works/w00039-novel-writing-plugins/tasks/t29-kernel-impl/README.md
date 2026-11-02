---
schema: nbook.task/v2
taskId: t29-kernel-impl
status: active
updated: 2026-11-02
---

# 世界引擎内核实现（nb-canon）

## 目标与范围

按 t27 的内核 Spec 实现 nb-canon 包与插件接入：模型与计算、分段日志存储、白名单 MDX 渲染与带值写法、项目进程里的服务；星瑕样本在新内核上重放出与 t16 原型相同的结果。不做 Agent 工具、记账管线与正式的作者界面（Work README 决定表 2026-11-02）。

合同：实现 t27 写的内核 Spec（`docs/specs/canon/`，写好后补链接）；新建 capability，不改已有 Spec 的行为。

前置：t27 的 Spec 经开发者批准。

## 当前状态

2026-11-02 经 nbdev 新建，尚未开工。

执行位置：`.worktree/w00039-t29-canon-kernel`，分支 `feat/w00039-t29-canon-kernel`。开发者 11-02：本次在单独的分支上进行，没有开发者允许不合并进 master。

2026-11-02 开发者指定按 autonomous-delivery 推进（Work README 决定表）。实施计划 [plan.md](plan.md)：nb-canon 新包加 canon 插件，八个切片；按条目的时间线做增量计算，差分测试守住“增量等于整本重算”。独立设计的对照在 [`evidences/independent-design.txt`](evidences/independent-design.txt)。合同是分支上的 Spec 第二版（提交 2f0b6ed7e），第一轮审查的处理见 t27 的证据。

计划审查：omp 写了 1 条后额度用完，按规则改派 Claude Opus 接手，共 27 条（阻断 1、重要 20、建议 6），全部成立（1 条接受取舍）；按它改出 Spec 第三版（分支 75a6ff4c7）并重写计划，处理见 [`evidences/plan-review-resolution.txt`](evidences/plan-review-resolution.txt)。依赖试验见 [`evidences/dependency-spike.txt`](evidences/dependency-spike.txt)。

## 下一步

按计划的九个切片实施，从第 1 片（包骨架与 core）开始。
