# 2026-06-30 Round 43 - HistorySet Rollout Constraint

## Scope

本轮专门审查 profile prompt 更新的 rollout 约束。目标是确认 Slice 1 修改 reference 文件是否足够，以及旧 Agent Session 会不会继续携带旧 Plot / simulator 路由。

本轮不修改业务代码。

## Evidence

`reference/agent/context.md` 的 Profile 上下文规则：

- `System` 每轮由 profile `context()` 生成，是当前 provider prompt 的 systemPrompt。
- `HistorySet` 是稳定历史前缀。
- `HistorySet` 在 session 已有稳定历史前缀时不会每轮重复写入。
- `Import` 常用于 `HistorySet > Message > Import`。

当前 `leader.default.profile.tsx`：

- `HistorySet` 导入 `reference/agent/profile-routing.md`。
- `HistorySet` 导入 `reference/agent/leader-default.md`。
- `System` 里仍明确说普通写作不维护旧 Plot / simulation，且不要调用、创建或路由到它们。

当前 `director.profile.tsx`：

- `System` 里直接包含 `Simulation gate`、`simulator_requests` 和 `simulator.leader`。
- `HistorySet` 导入 Plot reference，但 Plot reference 本身已经是 Scene-only，不是主要矛盾。

当前 `writer.profile.tsx`：

- `normalizePayloadContext()` 注释仍说写作模式不使用 Plot 系统。
- writer 没有 Plot tools，这是正确工具边界；问题是文字容易被理解为 Plot System 完全不参与 writer brief 上游。

## Risk

如果 Slice 1 只改 reference：

- 新建 session 会读到新 reference。
- 旧 session 可能继续在历史中保留旧 `profile-routing.md` / `leader-default.md` 文本。
- leader 的当前 System 仍会说不要路由到 Plot / director。
- director 的当前 System 仍会要求 simulator gate。

这会造成“文档已改，但 Agent 行为仍旧”的误判。

## Options

### A. Reference-only

只改 `reference/agent/*.md`。

结论：不够。它无法约束旧 session，也无法覆盖当前 profile System 中的旧文字。

### B. System-authoritative

同时改 reference 和 profile System。reference 负责稳定共享协议；profile System 负责每轮当前职责和工具边界。

结论：采用。

关键规则：

- leader System 必须明确：写作模式的动态状态走 World Engine；需要长期 Plot 结构时调用 director；leader 第一阶段不持有 Plot write tools。
- director System 必须明确：Plot write owner；未裁决世界事实返回 `world_engine_requests` 给 leader；不调用 simulator，不写 World Engine。
- writer System / payload context 必须明确：writer 不持有 Plot tools、不接 Plot ids；上游 brief 可以来自 Plot/World Engine 聚合，但 writer 只消费完整 `invoke_agent.message`。

### C. Runtime history migration

为旧 session 重写历史前缀或插入迁移消息。

结论：当前不建议。它涉及 Agent history 迁移，不属于 Task 78 的最小 Slice 1。只要当前 System 足够明确，旧 history 的风险可控。

## Test Implication

Profile tests 不能只拼接 `historyInitMessages` 再查全文。需要至少分别检查：

- `prepared.systemPrompt` 不含旧 gate。
- `prepared.systemPrompt` 包含当前职责。
- 拼接后的 prompt 不含会直接误导的旧字段名，如 `simulator_requests`。

对旧 session 的自动迁移不作为 Slice 1 验收；但实现完成后应在 walkthrough 中说明实际结果与计划的出入：现有 session 历史不会被回写，当前 System 是本轮生效层。

## Result

Slice 1 的核心不是“改 reference”，而是“让当前 profile System 成为 Plot / World Engine / director / writer 协作的权威 Interface”。reference 同步仍必须做，但不能替代 System prompt 改造。

