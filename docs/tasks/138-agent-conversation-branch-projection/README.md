# Agent 对话分支投影修复

## Relative documents refs

- [Task 49 Agent Session Tree UI Refactor](../49-agent-session-tree-ui/README.md)
- [Task 106 Agent Chat Flow Pagination](../106-agent-chat-flow-pagination/README.md)
- [session-tree.ts](../../../app/components/novel-ide/agent/session-tree.ts)
- [public-chat-entry-projection.ts](../../../server/agent/events/public-chat-entry-projection.ts)

## User Request / Topic

用户报告：AI 消息工具条上的分支切换按钮不见了，「之前在这个位置（目前有复制、重试等功能）能 branch 的」。

## 调研结论：按钮从未被删除

`AgentTextBubble.vue` 的 `‹ n/N ›` 从首次公开提交 `fb47271b` 起就在同一条工具条上，逐提交核对（27 个提交）都存在，当前工作区也没有改动它。真正的问题是它的显示条件在真实数据上几乎必然落空，并且偶尔在错误的位置显示。

对 `workspace/.nbook/agent/sessions/` 全量真实会话按旧代码模拟：

| 旧实现 | 数量 |
|---|---|
| 原始树分叉点（`childCount > 1`） | 200 |
| 产出切换器状态的 | 100 |
| ↳ 挂在真的会渲染成气泡的消息上 | 70（全是 assistant） |
| ↳ 挂在根本不渲染的 entry 上（永远不可见） | 30（`origin: harness/workflow` 的 user 消息） |
| 那 70 个里，另一条 lane 是 `custom agent.link.*` 记账 entry | 67（假分支，切过去会把对话截断） |
| 真正由重试 / 编辑 / 报错重跑产生、能显示的分支 | **0** |

### 根因

一棵 session 树同时承担两种语义：

- **对话内容**：`message` / `custom_message` / `compaction` / `branch_summary` / 运行报错。
- **运行期记账**：`invocation_lifecycle` / `model_change` / `custom(agent.link.*)` / `session_update` / `variable_patch` 等。

两者共用 `parentId` 链是正确的（`reduce()` 需要按活动路径拿到全部事实），错的是 UI 把这棵混合树直接当分支树用：`isRawBranchPoint` = `childCount > 1`，记账 entry 因此抢占了分支根的位置。

每次 invoke 写入的第一条 entry 必然是 `invocation_lifecycle: start`（`neuro-agent-harness.ts` `admitInvocation`，早于用户消息写入的 `prepareRun`），换模型还会多插一条 `model_change`。旧判据要求「分支根自己就是消息」，于是重试分支全部落空。

### 关键约束（数据证明，决定了必须改 DTO）

`role = "user"` 的 message entry 共 874 条，其中只有 `origin=prompt` 的 420 条会渲染成气泡，其余 454 条（`workflow` 349 / `harness` 101 / `manual` 1）不会。而 `SessionTreeNode` 既不携带 `origin`，也不携带 `invocation_lifecycle.status`——**前端无法自行判断哪条 entry 会变成气泡**。这个事实必须由服务端下发，不是过度设计。

## Decisions

| 编号 | 决策 | 理由 |
|---|---|---|
| ADR-1 | 分支锚点 = 用户消息 + AI 消息 + **运行报错** | 重试失败时活动叶子停在报错上；报错不算锚点会出现「跑挂之后切不回上一个好答案」的单向门 |
| ADR-2 | 切换器挂在分支自己的第一个气泡（lane root），不挂在分叉点 | 与 ChatGPT / Claude 一致，也与既有实现一致：重试 → 出现在 AI 回复上；编辑重发 → 出现在用户消息上 |
| ADR-3 | **Session Tree 对话框保持 raw 语义，本轮完全不动** | 它是审计工具，`agent.link` / `model_change` / lifecycle 分叉在那里出现是正确的。**显式推翻 Task 49「气泡与对话框同一套 branch 语义」** |
| ADR-4 | fork 补 `/fork` slash command 并修掉 `parentSessionId` 误分类；**不实现历史复制** | fork 此前完全不可达。历史复制留作独立后续任务 |
| ADR-5 | 「回退」改名「从这里分叉」，图标换 `git-branch-plus`，去掉 danger 配色 | 该按钮实际是 `moveTree(position:"at")`，不删除任何内容，旧文案与图标误导 |

`model_change` 不算独立分支（用户拍板）由 ADR-1 的通用锚点规则天然满足，**没有写特例代码**。

## Implementation Walkthrough

### 服务端：把「这条 entry 是什么气泡」变成单一真相

- `shared/dto/agent-public-event.dto.ts` 新增 `ChatEntryKind = AgentChatEntryDto["type"]`——从 DTO 派生，不自造并行词汇。
- `public-chat-entry-projection.ts` 新增 `chatEntryKind(entry)`：纯结构判断，不做正文裁剪（`tree()` 在 recovery 热路径上，每个 entry 调用一次）。
- `projectAgentChatEntry` 改为开头单一 null 出口 `if (chatEntryKind(entry) === null) return null;`，内部所有 `return null` 全部删除，末尾改为抛错。**「渲染 / 不渲染」在代码结构上只剩一个出口**，两边漂移会立刻抛错而不是安静少渲染一个气泡。
- `projectMessageEntry` 返回类型收紧为非 nullable；typecheck 证明 `StoredAgentMessage` 的 role 联合已穷尽（末尾兜底分支被判为 `never`），因此直接返回 toolResult 投影，新增 role 会产生编译错误。
- `SessionTreeNode.messageId` **删除**（它恒等于 `entry.id`，零信息量），换成 `chatEntry?: ChatEntryKind`；`session-repo.tree()` 填充。

### 前端：锚点条件化投影

- `session-tree.ts` 新增 `isBranchAnchor(node)`：读 `node.chatEntry`，取 `user` / `assistant` / `invocation_error`。服务端只给事实，「哪些气泡算一条分支的开头」是 UI 策略，留在 UI 层。
- `deriveSwitcherByMessageId` 重写为锚点条件化：每个锚点归属到最近的锚点祖先，记账 entry 全部透明；组内 lane > 1 才是对话分支点；`currentIndex` 取活动 lane，`< 0` 时跳过。
- `resolveBranchSwitchTarget` / `terminalByBranchRootId` 未改——切换仍落到目标分支在原始树里的最新终点，`moveLeaf` 需要真实 entry id。
- `deriveAgentSessionTreeRows` / `isRawBranchPoint` / lane depth / guide / 折叠 / search **一行未动**（ADR-3）。

### UI

- 新增 `AgentBranchSwitcher.vue`（两处消费才抽的组件），`AgentTextBubble` 的普通气泡与报错卡片共用。
- 报错卡片原本整块是一个 `<button>`，改为 flex 行：折叠按钮 `flex-1`，右侧挂切换器（避免嵌套 button）。只在 `systemDisplayKind === "error"` 且有 `branchSwitcher` 时显示。
- 「回退」→「从这里分叉」：图标 `undo-2` → `git-branch-plus`，去 danger 配色；事件 `delete` → `branch-from-here`，函数 `rollbackMessage` → `branchFromMessage`，i18n key `rollback*` → `branchFromHere*`（中英双语）。注意 `zh-CN.ts` 稿件章节区另有一个同名 `rollback` key，未动。

### fork

- `forkSession()` 不再设 `parentSessionId`——该字段表达「子 Agent」关系，会话列表按它区分顶层与子 Agent，fork 占用它会让新会话从顶层列表消失。出处改由单条 `custom` entry `fork.from = {sessionId, entryId?}` 承载，取代 `fork.fromEntryId`。
- `AgentChatSurface.handleSlashCommand` 新增 `/fork`，复用既有 `applyAgentCommandResult` 的 `created_session` 分支（刷新列表 + 打开新会话）。成功通知明确告知历史未复制、新会话是空的，并指向消息上的分支切换。

## Verification / Test

- `bun run test app/components/novel-ide/agent/ server/agent/events/public-chat-entry-projection.test.ts server/agent/session/session-repo.test.ts`：28 files / 278 tests 全绿。
- `bun run typecheck`：只剩两个既有无关错误 `assets/workspace/.nbook/agent/skills/llmlint/src/report.ts(100,31)` 与 `(100,62)`（vendored 快照）。
- 新增测试：
  - `public-chat-entry-projection.test.ts` 表驱动不变量 `(chatEntryKind(e) === null) === (projectAgentChatEntry(e) === null)`，覆盖 `origin: harness/workflow/manual` 的 user 消息、steer、空正文报错、`model_change`、`custom`、`compaction` 等 21 种 entry。
  - `session-tree.test.ts` fixture 换成真实形状（旧 fixture 默认每个节点都是带 messageId 的消息，正是这个 bug 一直照不出来的原因），新增 8 个用例：重试、换模型重试、连续失败后成功（会话 775 形状）、停在报错分支时切回好答案、`agent.link` 假分支（会话 177 形状）、幽灵 user 消息、编辑重发、分叉不在活动路径上。
- 真实数据回归（一次性脚本，直接调用发货代码 `repo.tree()` + `deriveAgentTreeState()`，跑完已删除）：

  ```
  扫描 session 文件: 549
  有分支切换器的 session: 69
  切换器总数: 91
  承载气泡类型: { assistant: 49, user: 15, invocation_error: 27 }
  lane 类型 (195 条): { assistant: 139, user: 25, invocation_error: 31 }
  不变量全部成立
  ```

  三条不变量：承载切换器的节点必须会渲染成气泡；每条 lane 都必须是锚点（**记账 entry 为 lane 的情况为 0**）；`currentIndex` 指向的 lane 必须就是承载者。
- 具体会话抽查：
  - 会话 775（用户报告当天的会话）：`3/3` 挂在 assistant 气泡上，lane 1/2 是两次运行报错，lane 3 是换模型后的成功回复；另有一个 `2/2` 挂在编辑重发的用户消息上。
  - 会话 177（含子 Agent link）：原来的假 `2/2` 已消失，无切换器。

### 待用户浏览器验收

- 会话 775 → AI 回复工具条出现 `‹ 3/3 ›`，左右切换可看到两次报错卡片，报错卡片上也能继续切换。
- 会话 177 → 假 `2/2` 消失。
- 任意会话点重试 → AI 回复上出现 `‹ 1/2 ›`，切换后正文随之变化。
- 编辑一条用户消息重发 → 用户消息上出现 `‹ 1/2 ›`。
- 「从这里分叉」按钮为分支图标、非红色，确认弹窗说明不会删除内容。
- 输入 `/fork` → 新建并打开一个空会话，且它出现在**顶层**会话列表（不是子 Agent），通知说明历史未复制。

## 已知边界

- `tree` 只在 recovery 时刷新。重试 / 编辑 / 分叉都走显式 `moveLeaf(origin:"move")` 从而 bump `activePathRevision` 触发 recovery，切换器能及时出现；「运行报错后尚未重试」这一瞬间树是旧的，但此时也还没有分支。
- 分叉整体不在 active path 上时不显示切换器，这类分支仍通过 Session Tree 对话框审计——与 Task 49 的既有约定一致。
- `tool_result` 与 system 卡片（reminder / compaction / branch_summary）不作为分支锚点：前者并入 assistant 气泡没有独立工具条，后者是每轮注入的脚手架，不是「另一个版本」。

## 交付状态

- 六个批次全部实现并随 PR [#34](https://github.com/notnotype/neuro-book/pull/34) `fix(agent): recover missing sessions and project conversation branches` 合并进 `master`（commit `30c524d1`）。
- **任务编号与计划不一致**：计划里写的是 135，建目录时 135 已被 [Agent 资产安装协议](../135-agent-asset-install-protocol/README.md) 占用，实际编号为 138。Task 49 回写里的三处 `Task 135` 链接已在 2026-08-04 修正为 138（此前指向错误目录）。
- master 复验（2026-08-04）：`bun run test app/components/novel-ide/agent/session-tree.test.ts server/agent/events/public-chat-entry-projection.test.ts server/agent/session/session-repo.test.ts` → 3 files / 102 tests 全绿。
- **浏览器验收仍未执行**，清单见上一节；这是本任务唯一未完成的验证环节。

## TODO / Follow-ups

- [ ] 浏览器验收（用户执行或授权）。
- [ ] 真 fork：把活动路径复制进新会话，需处理附件授权、关系账本与 project 绑定，独立任务。
- [ ] `JsonlSessionRepository.appendUserMessage()` 只有测试在用（写 `origin: "manual"`），属于混在生产代码里的测试 helper，可考虑下沉到测试工具。
