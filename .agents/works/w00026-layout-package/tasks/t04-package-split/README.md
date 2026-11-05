---
schema: nbook.task/v2
taskId: t04-package-split
status: planned
updated: 2026-11-05
---

# 拆包：nb-layout（不改行为）

## 目标与范围

新建 packages/nb-layout，按 t01 决定 10 搬走布局件，使用方（24 个文件）一次改完，nb-ui 不重导出；Lab 场景、e2e 与验收页、locales 跟着走；登记 monorepo-boundaries，更新 ADR 0029 的发布清单。不改任何行为。新包不读全局 window、document。

合同：待补充（链接具体 Spec，或说明行为合同是否改变）。

## 当前状态

2026-11-05 经 nbdev 新建，尚未开工。

## 下一步

待补充。
