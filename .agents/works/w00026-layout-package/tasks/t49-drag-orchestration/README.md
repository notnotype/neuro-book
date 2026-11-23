---
schema: nbook.task/v2
taskId: t49-drag-orchestration
status: active
updated: 2026-11-23
---

# 手感编排进库

## 目标与范围

撕下来源、来源收起后按新布局重判、指针不动不重判、空位粘住等编排从应用提进 nb-layout（提案“手感引擎分两步”的第二步）；工作台与 nb-story 并排卡片两个宿主验证，先写接口草案交审查，先标 @experimental。

合同：[`ui/layout-drag`](../../../../../docs/specs/ui/layout-drag.md) 加实时布局的编排；[`ui/workbench-layout`](../../../../../docs/specs/ui/workbench-layout.md) 输出 38 行为不变、通用部分改链接；nb-story [`story/viewer`](../../../../../docs/specs/story/viewer.md) 输出 68 的换边从落点指示改成实时让位（t45 定“实时让位等 t49”）。

## 当前状态

2026-11-23：[计划第 1 稿](plan.md)：引擎放 nb-layout 核心入口（纯 TS），会话接上它并负责唤醒，`useLiveDrag` 给 Vue 宿主；工作台改用它，nb-story 的拖详情换边作第二个宿主。worktree `.worktree/w00026-t49`（分支 `w00026/t49-drag-orchestration`），改前的基线在跑。

2026-11-23：第 1 稿两份设计审查（细节 Sonnet 阻断 1、重要 7、建议 4；整体 Opus 阻断 1、重要 7、建议 2，证据在 `evidences/`）都成立，改成[第 2 稿](plan.md)：落点只是落点、`offer` 与被拒绝留在宿主；会话只加通用的 `sampled`；公开名字只从 `./vue` 出；加 Lab 场景 `live-panels` 作收起与粘住的第二个形状；进 `[Unreleased]`，0.1.0 没发时合入前停下问。改前基线：三份工作台拖动 e2e 68 条全过。

2026-11-23：第 2 轮（细节：重要 5、建议 6；整体：重要 4、建议 4；都没有阻断）都成立，改成[第 3 稿](plan.md)：接线进库（`createLiveDragSession`、`useLiveDragSession`），“指针不动不重判”进引擎（`unmoved`），拿起的内容由 `NestedGrid` 自己留住，引擎规则逐条写全。

2026-11-23：第 3 轮（细节：重要 4、建议 3；整体：重要 4、建议 1；都没有阻断）都成立，改成[第 4 稿](plan.md)：合成的四条先后写死、来源类型分开（`live` 返回 `L`）、`grid` 必填、`unmoved` 的清除规则、`resolve` 的 Spec 措辞、nb-story 三处。三轮的重要条数 14、9、8，多半是上一稿的改法带出来的，都过得了类型检查。同一对象审满三轮，**停下等开发者**：A 按第 4 稿开工、不再审第 4 轮，切片 2、3 落地各派一次后台实现审查（推荐）；B 拆成两个 Task，t49 只做引擎、合成、`NestedGrid` 留住与工作台改用，Lab 场景与 nb-story 换边另起。

2026-11-23：开发者选 A：按第 4 稿开工，不审第 4 轮；切片 2、3 落地各派一次后台实现审查（Claude Sonnet）。

2026-11-23：切片 1 到 3 提交在 `w00026/t49-drag-orchestration`：
- 切片 1（`fed1207e0`）：引擎 `nb-layout/src/live-drag.ts`（不从入口导出），工作台 `live-drag.test.ts` 的 24 例迁来并按规则补到 33 例；五个变异都被抓住。
- 切片 2（`fa694ead7`）：会话加 `sampled`；`createLiveDragSession`、`useLiveDragSession`；`NestedGrid` 留住不在 `contents` 里的拿起项、expose `origin`、`motionMs`。四个变异都被抓住。
- 切片 1、2 的后台实现审查（Claude Sonnet，[报告](evidences/impl-review-s12.txt)）：重要 1、建议 8。成立的修在 `aac7b7e67`：先交出状态再排渲染之后的跟手（只有卡片拿起收回的那一帧原来会错一帧）、合成对键盘拖动不走实时布局、`card.rect` 收这一刻的几何、补整帧先后与非零原点等用例。合成接 `sampled` 的先后在 happy-dom 里分不出（它把帧回调里新排的帧放进同一批跑），那例删掉，由 `workbench-drag-cost.e2e.ts` 的每帧上限守着（`7a8dc0049`）。`lifted` 要和摘掉它的 `contents` 同一次渲染里变（审查第 7 条），写进 Spec；API 报告在切片 6 重生成。
- 切片 3（`e5874e4f3`）：工作台改用 `createLiveDragSession`，删掉 `live-drag.ts`；三份工作台 e2e 68 条全过，和改前的基线一样。后台实现审查（Claude Sonnet，[报告](evidences/impl-review-s3.txt)）：阻断 0、重要 0、建议 6。改了四条（`cd8266de5`）：留住的拿起项用拿起那一刻的叶（中途预览把它摆到别的叶、再摘掉时，原来会落到已经不在的叶上）；收起那一刻的判定排在遮挡判断之前；来源那块的矩形只问一次；`WorkbenchSurface.md` 与注释跟上。不改两条：工作台 `facts` 的映射另写单测（逐行对过，e2e 守着）；引擎量到之前每次判定都现量（只在拿起到第一帧那一段）。
- 切片 4（`65160b5e3`）：Lab 场景 `live-panels` 与 `lab-live-panels.e2e.ts` 5 例。变异：粘住、`unmoved`、不清 `unmoved`、拿起前不 `settleMotion` 各让对应用例失败；“留住拿起项”第一次没被抓住（预览一直把来源摆在新块上），第 1 例改成中途先停到不是落点的地方。

## 下一步

切片 4（Lab 场景 `live-panels` 与 `lab-live-panels.e2e.ts`）在验证；之后切片 5（nb-story 换边）、切片 6（Spec 与文档）。
