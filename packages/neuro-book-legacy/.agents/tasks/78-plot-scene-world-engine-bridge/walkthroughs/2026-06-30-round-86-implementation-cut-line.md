# Round 86: Implementation Cut Line

## Scope

本轮汇总当前探索是否还需要继续扩展设计。结论是：profile 架构和四个实现切片已经足够明确，后续继续探索的收益很低；下一步应进入 Slice 1 `Profile Contract Cleanup`。

## Current Evidence

已明确的架构：

- `leader.default`：用户/canon/World Engine 入口；涉及 Scene / Chapter / writer handoff 时调用 `director`。
- `director`：Plot write owner + brief compiler；不写 World Engine；返回 `world_engine_requests`。
- `writer`：正文写作；不持有 Plot tools；只消费完整 `invoke_agent.message` brief 和 `invoke_agent.input.path`。
- `world.engine`：复杂 World Engine schema/calendar/state specialist；不接管 Plot / brief / 正文。

已明确的实现切片：

- Slice 1：Profile Contract Cleanup。
- Slice 2：OpenAPI Explicit Path。
- Slice 3：Chapter Writer Brief Module。
- Slice 4：Agent Tool Binding。

已明确的 critical guards：

- user root 覆盖 system root，验收必须检查 active user source/artifact。
- compiled artifact 是 runtime truth source，source 修改不等于 runtime 生效。
- `DirectorOutputSchema` 必须 strict。
- `get_agent_profile` 只暴露 toolKeys/schema summary，description 是 Agent-facing Interface。
- brief tool 不读写 `plot.selection`。
- `ChapterWriterBriefService` 是 read model Module，tool 只做 adapter。
- OpenAPI catch-all route 需要 explicit path 和 duplicate operation guard。

## Remaining Unknowns

仍有几个实现时会自然暴露的细节，但不需要继续前置设计：

- `ChapterWriterBriefDtoSchema` 的最终字段命名。
- warnings 文案的中文具体写法。
- `suggestedBriefMarkdown` 的模板微调。
- `findChapterScenesForBrief()` 是在现有 repository 扩方法，还是新增专用 read repository。
- profile 编译命令是否需要同时跑 system/user，取决于实现后的 sync 策略。

这些都属于 Implementation 细节，不影响当前 architecture choice。

## Cut Line

后续探索不应再重复回答以下问题：

- 是否采用 Director + Brief Compiler：已定。
- leader 是否拿全套 Plot write tools：第一阶段不拿。
- writer 是否拿 Plot tools：不拿。
- world.engine 是否成为 brief owner：不成为。
- brief v1 是否包含 ChapterOverride POV/tone：不包含，Task 80 后续扩展。
- brief tool 是否串调用已有 Plot tools：不串，走 `ChapterWriterBriefService`。

## Next Implementation Step

进入 Slice 1 时建议按这个顺序：

1. 修改 `DirectorOutputSchema` 为 strict，删除 `simulator_requests`，新增 `world_engine_requests`。
2. 修改 `director.profile.tsx`，删除 simulator gate，写清 World Engine requests 交回 leader。
3. 修改 `leader.default` profile / reference / workflow routing，让普通写作入口能路由 director。
4. 修改 writer 注释和 reference，表达为“不直接持有 Plot tools，但消费上游 Scene / World Context brief”。
5. 添加 profile contract 测试和 schema strict 负例。
6. 编译 system/user profile，并检查 active artifact。

## Conclusion

Task 78 的设计探索已经形成足够清晰的 profile 系统架构。下一轮有明确实现许可时，应从 Slice 1 开始；若仍只允许探索，后续应只记录新证据或实现中发现的矛盾，不再扩写重复方案。

