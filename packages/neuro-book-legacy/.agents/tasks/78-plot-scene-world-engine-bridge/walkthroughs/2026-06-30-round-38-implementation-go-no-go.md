# 2026-06-30 Round 38 - Implementation Go No-Go

## Scope

本轮做进入实现前的 go/no-go 检查。目标是判断当前探索是否已经足够，后续是否应继续设计，还是可以从 Slice 1 开始实现。

本轮不修改业务代码。

## Go Criteria

以下条件已经满足：

- Scene / World Engine 桥接主实现已完成。
- `StoryPlot / Plot Beat` 已从正式模型和工具退场。
- `SceneWorldAnchorResolutionService` 已落地，Plot 聚合读取可 calendar-free 解析 subject identity。
- Profile 架构已收敛为 Director + Brief Compiler。
- 工具暴露矩阵已决策为第一阶段 Director-only brief。
- `get_chapter_writer_brief` v1 状态合同已定义。
- 实现切片顺序已定义。
- 前三个切片已有逐文件 blueprint。
- 完成审计矩阵已列出未完成证据。

## No-Go Risks

以下风险仍存在，但不阻塞开始 Slice 1：

- `ChapterWriterBriefService` 具体 DTO 名称和字段还需在实现时按现有 `plot.dto.ts` 风格命名。
- OpenAPI spec 测试现有落点需要实现时确认。
- Scene World Context 是否抽查询型 anchor resolution Interface 可后置，不必先做。
- ChapterOverride 不在 Task 78，实现时必须避免把 POV/tone/do-not-reveal 做成假字段。

## Recommended Next Action

进入实现时，从 Slice 1 开始：

1. 更新 reference routing / leader-default / novel-writing-workflow。
2. 更新 leader.default / director / writer prompt。
3. 更新 `DirectorOutputSchema`。
4. 更新 profile tests。

不要先实现 `get_chapter_writer_brief`。原因：

- 当前 director prompt 仍会把缺失事实导向 simulator。
- 当前 schema 仍允许 `plot` kind。
- 先加 tool 会让新工具被旧 profile 心智错误使用。

## Stop Conditions

实现中如果遇到以下情况，应停止并报告：

- 为了通过测试必须保留 `simulator_requests`。
- `DirectorOutputSchema` 被外部运行时强依赖旧字段，无法直接删除。
- OpenAPI generator 无法暴露 explicit path，必须重构生成链。
- brief v1 被迫加入 ChapterOverride 字段才能满足调用方。

这些情况都意味着设计假设被推翻，需要重新评估。

## Result

探索阶段已经足够支撑实现。继续纯设计的边际收益开始下降；下一步应进入 Slice 1 `Profile Contract Cleanup`，但当前 goal 仍未完成，因为 profile/tool 改造尚未落地。

