# 2026-06-29 Round 03 - Workflow Reconciliation Options

## Scope

本轮探索 Plot System 与 World Engine 在 Agent 工作流中的组合方式。重点不是已有字段是否存在，而是“Agent 每轮应该先做什么、后做什么、谁负责写入哪个系统”。

## Current Tension

Task 78 后，系统事实上有两套互补结构：

- Plot System：`Thread / Scene / chapterPath / purpose / writingTip / refs / worldAnchor`
- World Engine：`subject / slice / patch / instant / reduce`

但旧写作 workflow 曾经为了让 World Engine 成为唯一状态源，把 Plot 整体降级为 legacy。现在需要重新给 Plot 一个更窄但有效的位置：它不是状态源，而是“作者视角的 Scene 编排层”。

## Option A - World Engine First

流程：

1. leader 和用户确认剧情事实。
2. leader 用 `execute_world` 写入 slices / patches。
3. 再创建或更新 Scene，把 `worldAnchor` 指向这段时间和 subjects。
4. 最后用 Scene / Thread summary 写作者视角摘要。

优点：

- 动态事实不会滞后；World Engine 始终先成为真相源。
- writer 查询 World Engine 时不容易读到未落定状态。

缺点：

- 对“先规划剧情，再决定是否 canon”的场景不自然。
- Agent 可能为了做大纲而过早写入 World Engine。
- 如果用户只是要整理未来章节，必须不断声明“这还不是 canon”。

适用：

- 已确认要写入时间线的剧情推进。
- 章节写作前的最终状态推进。
- 写后事实回补。

## Option B - Plot Scene First

流程：

1. director / leader 先建 draft Scene，记录目的、摘要、参与 subjects 候选和可能时间。
2. 用户确认后，leader 才用 World Engine 写 slices / patches。
3. 回填 Scene 的 `worldAnchor`、summary 和 Thread summary。

优点：

- 适合创作讨论和未来规划。
- Scene 可以作为候选剧情容器，降低“未确认推演误入 canon”的风险。
- 更贴近 Plot Workbench 的作者体验。

缺点：

- 如果 Scene 长期没有连接 World Engine，writer brief 可能缺真实状态。
- 需要明确 Scene status / summary 不能被误解成已发生事实。
- Agent 需要纪律：未确认 Scene 不调用 `get_scene_world_context` 当真相。

适用：

- 未来章节规划。
- 多方案剧情设计。
- 大纲整理。

## Option C - Chapter-Centric Brief First

流程：

1. 以目标 chapter 为中心读取 `get_chapter_plot`。
2. 对每个 Scene 查询 `get_story_scene_context` 和 `get_scene_world_context`。
3. 组装 writer brief，再调用 writer。
4. writer 只读 World Engine 自查状态并写正文。

优点：

- 直接服务“写这一章”的常见用户请求。
- 能把 Plot 的结构价值自然转成 writer 可用输入。
- writer 不需要 Plot tools，保持职责清晰。

缺点：

- 如果前置 Scene / World Anchor 没维护好，这个流程只能发现缺口，不能自动修复。
- 需要 brief 组装规范，否则 leader 每次手写易遗漏信息控制、Scene 顺序、World 查询提示。

适用：

- 状态已推进后的章节写作。
- 已有 Plot Workbench 数据的项目。

## Option D - Unified Story Transaction

流程：

1. Agent 提交一个高层“story transaction”：Scene 变更 + World Engine patches + Thread summary 更新。
2. 服务层协调写入 Plot 和 World Engine。

优点：

- Agent 使用最方便。
- 可以在服务层集中做一致性检查。

缺点：

- 复杂度高；需要跨模块事务语义。
- World Engine CodeAct 目前是独立工具事务，和 Plot SQLite 写入不一定能自然组成一个原子事务。
- 过早抽象会遮蔽创作确认流程。

适用：

- 后续成熟阶段，不适合作为当前下一步。

## Recommended Workflow

采用分阶段组合，不强行统一成一个工具：

### 1. Exploration / Planning

- 用户只是讨论剧情时，优先自然对话。
- 需要结构化保存时，写 Plot Scene，但允许 `worldAnchor` 为空。
- 不写 World Engine，除非用户确认这是 canon 或当前时间线事实。

### 2. Canonization

- 用户确认剧情事实后，leader 用 `execute_world` 写入 slices / patches。
- 根据写入结果更新 Scene 的 `worldAnchor`、Scene summary 和 Thread summary。
- 这一阶段是 Plot 与 World Engine 对齐点。

### 3. Chapter Handoff

- 写章节前，用 `get_chapter_plot` 获取章内 Scene。
- 对目标 Scene 调用 `get_scene_world_context`。
- 生成简化 writer brief：章节目标、Scene 顺序、信息控制、写作约束、World Engine 查询提示。
- writer 不读 Plot，保持只读 World Engine。

### 4. Post-Write Reconciliation

- leader 检查正文新增事实。
- 若新增事实被用户接受，先补 World Engine，再更新 Scene / Thread 摘要。
- 若不接受，改正文或撤回对应计划。

## Invariant

无论哪种流程，都必须保持：

- Plot 不保存动态当前状态。
- World Engine 不保存 writer-facing 节奏、POV、语气等章节指令。
- Scene summary 可以描述事实结果，但事实真相以 World Engine patches 为准。
- 未连接 World Engine 的 Scene 不能被当作已发生状态。

