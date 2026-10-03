# Round 121: Static Proof vs Faux Smoke vs Real Agent Smoke

## Scope

本轮区分 Task 78 后续 profile/tool 改造的三类证据，避免把静态证明或假 harness smoke 误当成真实 Agent 行为验证。没有改业务代码、没有运行测试。

## Layer 1: Static Proof

Static proof 证明 Interface 已安装：

- source profile 不含旧 simulator gate。
- `DirectorOutputSchema` strict，旧字段被拒绝。
- OpenAPI spec 生成 world-context 与 chapter-writer-brief 两个独立 path。
- `ChapterWriterBriefDtoSchema`、`ChapterWriterBriefService`、HTTP route、facade 存在。
- `get_chapter_writer_brief` 出现在 runtime tool、global registry、typed profile binding、director toolset。
- compiled manifest 指向新 artifact，active artifact 内容不含旧合同。

它能证明 Module seam 正确，但不能证明模型会按预期调用。

## Layer 2: Faux Harness Proof

Faux smoke 使用确定性 fake model / fake tool call 验证运行通路：

- director 可以调用 `get_chapter_writer_brief` 并收到 `suggestedBriefMarkdown` text。
- `report_result` 接受新 `world_engine_requests`，拒绝旧 `simulator_requests`。
- writer profile 只收到 `invoke_agent.message` 中的完整 brief 与 `input.path`，没有 Plot/brief toolKeys。
- tool result 的 `details` 保留完整 DTO，但可见 text 是 writer handoff markdown。

它能证明 runtime pipeline、tool result shape 和 schema enforcement 可跑通，但仍不证明真实模型会自然选择这条路径。

## Layer 3: Real Agent Smoke

真实 Agent smoke 才能证明 Agent 易用性目标：

1. 用户让 `leader.default` 为一个章节准备写作。
2. leader 识别 Scene / Chapter / writer brief 属于 director，而不是直接让 writer 猜 Plot 上下文。
3. director 使用 `get_chapter_writer_brief` 取得 scene/world-only brief。
4. 如果 Scene 缺 Plot、缺 World Anchor 或缺 World Context，director 返回 `world_engine_requests` / `open_questions`，不返回 `simulator_requests`。
5. leader 处理必要 World Engine 决策后，把完整 `suggestedBriefMarkdown` 放入 `invoke_agent.message` 调 writer。
6. writer 只写 `invoke_agent.input.path` 指定 Markdown，不持有 Plot tools，不接 Plot ids。
7. 整条链路没有调用 `simulator.leader`，也没有要求 writer 自己串 Plot tools。

真实 smoke 可以在实现完成后用小型测试 Project 做，浏览器验证不是第一证据面；需要的是 Agent session 行为和 tool trace。

## Claim Rules

- 只有 static proof：可以说“合同和 runtime 注册已安装”。
- static + faux proof：可以说“运行通路可执行，schema/tool 形状可验证”。
- static + faux + real proof：才可以说“Agent 在真实任务中能按新 profile 架构使用 Plot / World Engine brief”。

## Completion Impact

Task 78 的 profile/tool 改造不能在 Layer 1 或 Layer 2 后标记完成。最终完成审计必须保留真实 Agent smoke 或等价 replay 证据，否则只能声明实现切片完成，不能声明 Agent 易用性目标完成。

## Conclusion

本轮把“证明什么”拆清楚：static proof 保护 Interface，faux proof 保护 runtime pipeline，real smoke 保护模型行为。三层证据缺一层，都不能替代最终完成判断。

