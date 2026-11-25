---
schema: nbook.task/v2
taskId: t56-layout-docs-gaps
status: done
updated: 2026-11-25
---

# nb-layout 说明补齐（t50 摩擦第 5 组）

## 目标与范围

把 t50 摩擦记录第 5 组的 13 条（5、10、14、16、18、21、22、32、33、40、43、44、46）补进 README、grid.md 与组件说明，不改行为；要改行为的候选记待确认

合同：不改行为。说明写进包内文档（`packages/nb-layout/README.md`、`src/vue/NestedGrid.md`、`FloatWindowHandles.md`、`DropFeedbackOverlay.md`，`NestedGrid.vue` 三处 JSDoc）；[`ui/nested-grid`](../../../../../docs/specs/ui/nested-grid.md) 输出 79、97、120 与“时序与寿命”的 `content-parked` 一句按实现写准。

## 当前状态

2026-11-25 完成，合入 master。编码由 coder 子代理在 `w00026/t56-docs` 上做（4 个提交），主会话审 diff、重跑包测试、`docs:check`、`governance:check`，退出码都是 0；按开发者这天定的做法不单独审查，留到 t59 之后一次交 omp。

- 13 条都核实过再写：14 与 5、43 的大半开工前已在说明里，只补缺的句子；18、32、40 用探针确认与记录一致。
- 46 与摩擦记录只对了一半：载入时就为零的叶不停放只对 `leaf` 插槽成立，内容层的项量到容器之后就停放。说明与 Spec 输出 120 按这个写。
- 改行为的候选没做，记在下面，等后续 Task 或开发者定。

## 没做的候选

- 16：`sashDisabled` 等回调直接给挨着线的叶（现在给直接孩子，可能是分支 id）。
- 32：内容换叶、同一轮删掉原叶时也留着缩回（现在一帧消失，与“关掉”不一致）。
- 46：零尺寸的叶一律停放（`leaf` 插槽与内容层的口径不一致）。
- 最大化：`exclude` 的叶被外接矩形罩住时看不见却不加 `inert`，Tab 走得到。
- `sashDisabled` 每次渲染都调，`sashKind`、`sashStyle`、`paneLabel` 进缓存表，口径不一。
- 同类的说明问题，不在 13 条里：`DropSectorsOverlay.md` 开头也链到工作台的 Spec；`src/sortable.ts` 的 JSDoc 引了工作台 Spec 的输出编号，会随 `.d.ts` 发布。

## 下一步

无。
