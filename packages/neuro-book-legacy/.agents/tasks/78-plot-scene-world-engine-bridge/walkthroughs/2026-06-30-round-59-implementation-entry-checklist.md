# 2026-06-30 Round 59 - Implementation Entry Checklist

## Scope

本轮把继续设计与进入实现的边界写清楚。目标是给下一步 Slice 1 `Profile Contract Cleanup` 一个明确 checklist，并记录继续纯设计的收益已经很低。

本轮不修改业务代码。

## Current Gap

当前架构设计已经足够具体：

- Profile topology：Director + Brief Compiler。
- Tool exposure：第一阶段 Director-only brief。
- Patch sequence：Profile Contract Cleanup -> OpenAPI Explicit Path -> Chapter Writer Brief Module -> Agent Tool Binding。
- Brief status：path error -> `needs_plot` -> `needs_world_anchor` -> `needs_world_context` -> `ready`。
- Brief DTO/service/OpenAPI：`ChapterWriterBriefDtoSchema` 归属 `shared/dto/plot.dto.ts`，`ChapterWriterBriefService` 是 Plot 只读深接口，OpenAPI explicit path 必须先落地。
- Runtime acceptance：必须区分 source、registry/binding、catalog/build-status、compiled current pointer 和真实 Agent smoke。

剩余问题不是“架构选型不清楚”，而是实现还没落地。

## Entry Checklist For Slice 1

进入 `Profile Contract Cleanup` 前，按以下顺序改：

1. `server/agent/profiles/builtin-contracts.ts`
   - `DirectorOutputSchema` 删除 `simulator_requests`。
   - 新增或保留 `world_engine_requests`，字段 description 面向 leader 可读。
   - `plot_updates.kind` 删除旧 `plot` kind。
   - root object 和 `plot_updates` item 显式 `additionalProperties: false`。

2. `assets/workspace/.nbook/agent/profiles/builtin/director.profile.tsx`
   - 删除 `simulator.leader` / `Simulation gate`。
   - 报告字段改为 `plot_updates`、`chapter_plan`、`writer_handoff`、`world_engine_requests`、`open_questions`。
   - 写清 director 不写 World Engine、不直接调用 writer；需要世界事实时返回请求给 leader。

3. `reference/agent/profile-routing.md`
   - `leader.default` 的普通写作主链允许路由到 director 处理 Plot / brief。
   - `director` 的职责改为 Scene-only Plot + writer handoff / brief compiler，不再转 simulator。

4. `reference/agent/leader-default.md` / `reference/agent/novel-writing-workflow.md`
   - leader 负责 World Engine 和调用 writer，但 Plot 结构改动转 director。
   - 不再说 director / Plot 对普通写作不存在。

5. `assets/workspace/.nbook/agent/profiles/builtin/writer.profile.tsx`
   - 保持 writer 无 Plot tools。
   - 注释从“写作模式不使用 Plot 系统”改为“writer 不直接使用 Plot tools；上游 brief 可来自 Plot / World Engine 聚合”。

6. Tests / checks
   - 用 TypeBox `Value.Check()` 验证新 `DirectorOutputSchema` 接受新合同、拒绝 `simulator_requests`、拒绝 `plot_updates.kind = "plot"`、拒绝 root/item 额外字段。
   - 搜索 source profile / reference 不再有普通写作链路的 simulator gate。

## Stop Conditions

实现中如果出现以下情况，应停下并报告，而不是用 hack 绕过：

- `report_result.data` 在 runtime 层仍可选，但实现试图把“必须提供 data”写成已保证事实。
- `DirectorOutputSchema` 无法 strict，导致旧字段和新字段可以混用。
- leader/director/writer 的职责为了省一次调用而重新混成一个浅 Module。
- brief tool 需要 writer target path 才能工作，说明 `chapterPath` 和 `writer.input.path` 的 Interface 被混淆。
- compiled artifact 无法更新或 build-status 显示 stale/failed，却继续声称 Agent 可用。

## Result

本轮结论：继续纯设计的边际收益已经很低。下一次若进入实现，应从 Slice 1 `Profile Contract Cleanup` 开始；若仍保持只读探索，则应只补充能改变实现顺序或验收边界的新证据，不再扩写同一套架构说明。

