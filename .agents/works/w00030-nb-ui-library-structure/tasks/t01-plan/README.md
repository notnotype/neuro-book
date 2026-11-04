---
schema: nbook.task/v2
taskId: t01-plan
status: active
updated: 2026-10-20
---

# 整理计划

## 目标与范围

为本 Work 写实施计划：按 w00029 t05 的库审查报告整改顺序第 2 到 4 步，拆成 t02（原子类前缀、滚动条 token）、t03（弹出列表零件）、t04（公开 API 对齐与迁移表）。

合同：本 Task 只出计划，行为合同未变；各实施 Task 的合同在计划里列出。

## 当前状态

计划草稿 [plan.md](plan.md)（2026-10-20）。要开发者定的四件事与“其余部分是否同意”发在评审板 `artifacts/decisions/`（v1）；第 5 项（浮层外观以 CSS 类为准）与 w00029 t05 的 F43 同题，在那边的评审板上答。

## 决定

开发者 2026-10-20 在评审板 `decisions` v1 上答复，全部取推荐：

1. 评审板上答“原子类加 `nb:` 前缀，不用 `@layer`”；同日开发者在会话里改定：全仓统一用 Tailwind v4，nb-ui 不再发预编译产物、由宿主的 Tailwind 编译 nb-ui 源码（会话里两选一选了“宿主编译”），旧应用的样式失效、不管它。开发者同时指出：撞名的根因是两套原子 CSS 引擎这一底层选型，应当早提异议，而不是在审查给的两个补丁里挑。开发者顺带问 nb-ui 与 neuro-book 现在是不是还用 UnoCSS：nb-ui 的产物与 playground 用 Tailwind v4（`src/tailwind.css`），neuro-book 用 UnoCSS（`uno.config.ts`，`presetWind3`），nb-story、dev-panel 用 Tailwind v4。撞名发生在 nb-ui 产物与 neuro-book 的 UnoCSS 之间，以及 nb-ui 产物与 nb-story、dev-panel 自己的 Tailwind 之间。
2. 等 w00027：t02、t03 等 w00027 t07 的 S2a、S2b 进 master；t04 等 w00027 t07 做完。
3. t04 不留旧名别名，调用方同一个提交改完，靠打开未知属性检查兜住。
4. `Dialog` 拆出 `FloatingWindow`，`Dialog` 只做模态。
5. 计划的其余部分同意。第 5 项（浮层外观）在 w00029 t05 的评审板上定为只认 CSS 类。

## 下一步

无。计划已执行完：t02、t03 按计划完成；计划里的“t04：公开 API 对齐”由 [t05](../t05-public-api-alignment/README.md) 接过（t04 这个编号给了后来插入的主题字号 Task）。
