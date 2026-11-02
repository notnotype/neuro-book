---
schema: nbook.task/v2
taskId: t05-public-api-alignment
status: planned
updated: 2026-11-02
---

# nb-ui 公开 API 一次对齐（附迁移表与对外版本）

## 目标与范围

浮层、尺寸、语调、文案、列表数据的公开 API 各只有一套写法，仓库内调用方一次迁完，插件作者有迁移表

行为合同未变：产品行为不改，改的是 nb-ui 的公开 API 与 `packages/nb-ui/docs/` 的规范；对外是一次不兼容版本，迁移说明随本 Task 写。计划见 [plan.md](plan.md)，接过 [t01 总计划](../t01-plan/plan.md) 的“t04：公开 API 对齐”一节。

## 当前状态

2026-11-02 开发者同意按当前 master 重新核对 t01 计划的 t04 条目、写成本 Task 的计划；核对结果与计划已写进 [plan.md](plan.md)，开发者同日确认计划末尾三项（都取推荐）。同日计划审查：Sonnet 17 条、omp 8 条，全部成立，计划已据此修订（不抽外壳组件、保留取消与关闭按钮两个原因、不设强制的列表公共接口、`ContextMenu`/`Menubar` 传送目标与最上层判定不改、L07 第 2 点不做），处理见 [`evidences/design-review.txt`](evidences/design-review.txt)。worktree `.worktree/w00030-t05-api-alignment` 已建，尚未开工。

发版时必做（本 Task 不改版本号）：内置主题 `hostVersion` 与 `NB_UI_VERSION` 改 0.4；依赖 nb-ui 的已发布包一起升版本发布；应用与 SDK 升 0.13.0。详见计划第 7 节。

## 下一步

开发者看过修订后的计划，从 S0 开始。
