---
schema: nbook.task/v2
taskId: t45-story-side-by-side-cards
status: active
updated: 2026-11-22
---

# nb-story 并排看卡片

## 目标与范围

开发者 2026-11-22 定（问“nb-story 改造做到哪一步”时选“加并排看卡片”）：nb-story 右侧详情可以再开一张卡片并排对照，卡片能拖到左右两半，nb-story 自己检验 nb-layout 的拖动公开面（ADR 0054 第 8 条：第一个外部使用方）。这是 nb-story 的新功能，按 [design-review](../../../../skills/design-review/SKILL.md) 先出静态稿、在评审板上定外观与交互，再写 Spec 与计划。

合同：会改 [`story/viewer`](../../../../../docs/specs/story/viewer.md)（右侧详情的输出条目），定稿后写。

## 当前状态

2026-11-22：评审板第 1 轮（[`artifacts/review/index.html`](artifacts/review/index.html)）问四件事：并排时右侧详情多宽、第二张卡从哪里打开、两张都开着时普通点名字换哪一张、拖卡片换边的样子；另列了直接做的八条（最多两张、拖到另一半对调、窄窗口不并排等）。

- 草稿：worktree `.worktree/w00026-t45-drafts`（分支 `w00026/t45-drafts`，不合并、不推送）里临时改了 `BookFrame.vue`，截图脚本是 `packages/nb-story/e2e/shoot-current.e2e.ts`，都不提交。截图用 e2e 夹具起的真实 `nbstory serve` 与 100 章样例书，亮色，1440×900；原图在本地 `shots/`。
- 量到的宽度：两张各保持原宽时右侧详情 800、正文 450；各占一半时每张卡 199。

## 下一步

等开发者答复第 1 轮；答复前先做 t44（三栏改用 NestedGrid）与 t46。定稿后写 Spec 与计划。
