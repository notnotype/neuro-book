# Leader Profile v2 Adaptation

## User Request

- 先制定实现计划，并把实现计划写到 task 文件夹。
- 后续要完整适配 v2 的 `server/agent-v2/profiles/builtin/leader-default.profile.tsx`，目标落点是当前 v3 assets profile。
- 当前阶段继续更新计划文档，并用 `$grill-with-docs` 审问关键设计。
- 用户明确纠偏：harness 要改成刚刚决定的新架构，不能把现有 `PreparedTurn` 字段和当前实现顺序当作目标架构。
- 最新目标拆成四条主线：
  - 实现新设计的 harness 架构。
  - 改造 Profile 机制和 TSX DSL。
  - 迁移 `server/agent-v2/profiles/builtin/leader-default.profile.tsx`。
  - 同步改造 TSX 可视化编辑器前端。

## Scope Update

本任务不再只是“把 v2 leader prompt 搬到 v3 profile”。它要把 `leader.default` 迁移作为 tracer bullet，一次性打通四个必须同时成立的面：

1. Harness 架构：按新 contract 重建 invoke、profile prepare、pre-loop session 写入、ReAct loop 输入组装、SSE 前端同步和 session 持久化边界。
2. Profile 机制：把 `.profile.tsx`、`defineAgentProfile`、TypeBox schema、allowed tools、TSX DSL、preview/check/catalog 统一成当前 v3 的正式 profile contract。
3. Leader 迁移：把 v2 `leader-default.profile.tsx` 的核心协作语义迁到当前 `assets/workspace/.nbook/agent/profiles/builtin/leader.default.profile.tsx`，同时移除旧工具名诱导。
4. TSX 可视化编辑器：把 Workbench 从“辅助编辑 systemPrompt 字符串”升级为“围绕新 TSX Profile DSL 做源码真相源下的结构化辅助编辑”。

这四条线不能拆成互不相干的小修：如果 harness 不支持 pre-loop AppendingSet 写入，前端看不到 system reminder；如果 Profile DSL 不定，leader 迁移只能退化成大字符串；如果 Workbench 不跟着改，用户 profile 编辑入口会继续停留在旧 systemPrompt range 模型。

## Latest Harness Alignment

已按最新 [Agent Harness](../../modules/agent/harness.md) 重新校准本计划。这里记录本任务必须实现的目标语义，避免把当前代码里的过渡字段当成长期合同：

- 当前实现事实已经切到 `ProfileTurnPlan`：`systemPrompt`、`historyInitMessages`、`appendingMessages`、`modelContextAppendingMessages`、`modelContextMessages`、`stateWrites`。
- 旧 `PreparedTurn` 字段 `historyMessages`、`dynamicMessages`、`toolKeys`、`sessionWrites` 已不再是 active profile 输出合同；`validateProfileTurnPlan()` 会拒绝旧字段。
- `prepare()` / DSL compiler 不返回最终 `messages` / `contextMessages`，也不返回同时含 history 的 context 与单独 history seed。prompt 模式下可通过 `ctx.runtime.pendingUserMessage` 读取尚未落盘的本轮用户输入，供 `ActivatedSkills`、`Reminder`、条件上下文判断使用。
- 工具集合不再通过 `prepare()` 返回；harness 只读 `profile.allowedToolKeys`，再按 runtime registry 和目标 profile 派生动态工具 schema。
- Pre-loop 写入由 harness 统一提交：`historyInitMessages` 只在当前 active path 没有 model-visible message 时写入；`modelContextAppendingMessages` 与 `appendingMessages` 每轮写入 session；`stateWrites` 只写受控 profile/session state；随后 prompt invocation 的真实用户消息写入 session。
- 前端可见顺序必须保持：Profile 产生的可见 AppendingSet 消息先进入 session，然后是真实用户消息，然后才是 ReAct loop 的 streaming assistant/toolResult。
- ReAct loop 输入由 harness 在 pre-loop 写入后重新 reduce session 得到：`reduced session messages + modelContextMessages`。
- `modelContextMessages` 是旧 `dynamicMessages` 的目标形态：只影响本轮模型上下文，不进入 session，也不显示在前端历史里。TSX DSL 层直接硬切 `DynamicSet`，不提供公开迁移别名。
- Profile 生成的可见上下文写入 session 时使用 `custom_message visibleToModel: true`；`custom_message` 是 session entry 标记，内部仍必须携带 provider 可接受的 `user` / `assistant` / `toolResult` message。
- `ingest` 本阶段仍不负责 assistant/toolResult 归档策略；loop 内 `message_end` 继续由 harness 持久化，保证 SSE、waiting approval/input 和 resume 一致。

## Goal

- 以 [Agent Harness](../../modules/agent/harness.md) 文档为基础，把 invoke -> profile prepare -> pre-loop session 写入 -> ReAct loop -> SSE -> session 持久化的边界设计稳定下来。
- 借 `leader.default` 适配把当前 TSX Profile 机制完整定下来，而不是只把 v2 prompt 文案搬进现有 `prepare()` 返回值。
- 重新支持并优化 TSX Profile JSX DSL，让 v2 `ProfilePrompt` / `HistorySet` / `DynamicSet` / `AppendingSet` / `Reminder` / `Watch` / `SkillCatalog` / `ActivatedSkills` 等节点都有清晰的新规范和 active runtime 实现。
- 把 v2 `leader.default` 的核心协作、写作、workspace、多 agent 和提示词分层语义迁移到当前 Pi-based `server/agent` profile contract。
- 让 TSX Profile Workbench / 可视化编辑器从“只替换 systemPrompt 字符串”升级到围绕新 TSX DSL 做源码与结构化辅助编辑。
- 迁移后 `leader.default` 仍通过动态 profile catalog 从 `assets/workspace/.nbook/agent/profiles/builtin/leader.default.profile.tsx` 加载，并允许 `workspace/.nbook/agent/profiles/builtin/leader.default.profile.tsx` 用户覆盖。
- 旧 v2 工具以后再迁移。本任务可以先定义 Plot System、task、SQL 等能力在 Profile DSL 中的表达边界，但不恢复不存在的旧工具调用。
- 在适配过程中持续发现当前 v3 profile/harness 的缺口，并把需要后续 runtime 支持的问题记录为 TODO，而不是用 prompt hack 掩盖。

## Current State Before This Task

- v2 源 profile：`server/agent-v2/profiles/builtin/leader-default.profile.tsx`。
- v3 系统 profile：`assets/workspace/.nbook/agent/profiles/builtin/leader.default.profile.tsx`。
- v3 用户覆盖 profile：`workspace/.nbook/agent/profiles/builtin/leader.default.profile.tsx`，如果存在且内容仍是旧压缩版，需要同步，否则用户覆盖会遮蔽系统修复。
- 迁移前的 v3 profile contract 是 `defineAgentProfile({ manifest, inputSchema, outputSchema, allowedToolKeys, prepare, ingest? })`，`prepare(ctx)` 返回旧 `PreparedTurn`：
  - `systemPrompt`
  - `historyMessages`
  - `dynamicMessages`
  - `appendingMessages`
  - `toolKeys`
  - `sessionWrites`
- 以上字段只描述迁移前事实，不是本任务要保留的目标接口。新 harness 不应继续让 profile 直接返回 `toolKeys`、任意 `sessionWrites` 或已经混好历史的最终 `messages`。
- 当前 v3 runtime 不执行 v2 的 `ProfilePrompt` / `HistorySet` / `DynamicSet` / `AppendingSet` / `Reminder` / `Watch` JSX DSL；本任务需要把这些 TSX 节点重新设计为 active v3 Profile 规范的一部分。
- 当前 TSX 可视化编辑器第一版只从 `systemPrompt` / `renderSystemPrompt()` 源码 range 构造一个 System Prompt 占位节点；如果 TSX DSL 成为正式 profile 机制，前端需要重新围绕 `ProfilePrompt` / `System` / `History` / `Appending` 等节点做 AST round-trip。
- 当前 harness 行为：
  - `historyMessages` 只在 `profile.history.injected` 不存在时写入一次 session history。
  - `dynamicMessages` 只进入本轮模型上下文，不持久化。
  - `appendingMessages` 每轮都会追加到 session history。
  - Provider 级 system prompt 走 `systemPrompt` 字段，不通过 messages 内的 system message 表达。
- 当前 `leader.default` / `leader.assets` 默认可见工具：
  - `read`
  - `write`
  - `edit`
  - `apply_patch`
  - `bash`
  - `create_agent`
  - `invoke_agent`
  - `get_agent`
  - `get_session`
  - `detach_agent`
  - `request_user_input`
  - `enter_plan_mode`
  - `exit_plan_mode`
  - `skill`
- 当前不在 v3 registry 中的 v2 能力不能直接写进 active prompt 的工具指令：
  - `read_file` / `write_file` / `edit_file` / `execute_shell`
  - `create_subagent` / `list_subagents` / `invoke_subagent`
  - `task_create` / `task_set_status`
  - `execute_sql`
  - 旧 plot/story 工具，例如 `get_plot_tree`、`get_story_thread`、`get_story_scene_context`、`get_chapter_plot`。

## Adaptation Strategy

- 先定 TSX Profile DSL 规范，再迁移完整 `leader.default`。
- `prepare` 是 Profile 提供给 harness 的底层接口，但也要方便高级用户覆写；普通 profile 作者主要关心如何用 TSX DSL 直观构造上下文。
- 底层 `prepare` 不负责提供 tools；harness 从 `profile.allowedToolKeys` 获取本轮可见工具。`prepare` 只负责产出 ReAct loop 前的上下文分区，例如 provider `systemPrompt`、首轮稳定历史片段、本轮 appending 片段和本轮非持久动态片段。
- `prepare` 不应同时返回 `historySeed` 与已经包含 history 的 `contextMessages` 这类双真相源。最终 ReAct `messages` 应由 harness 在提交 pre-loop 片段后，从 session reduce 结果加上非持久动态片段统一组装。
- 进入 ReAct loop 前哪些消息写入 session，需要在 DSL 编译器和 harness 之间划清责任：TSX DSL 表达意图，harness 负责按统一规则落盘，避免 profile 自己随意写 session。
- `ingest` 未来可以负责 ReAct loop 结果的后处理，例如 title/summary 或选择性归档策略。但让 ingest 决定哪些 `AIMessage` / `ToolResult` 可以持久化会牵涉 live SSE、waiting 恢复和前端展示，本任务先不实现 ingest 改造。
- Profile 必须能够通过 TSX/XML 标签直观地 prepare 上下文；profile 作者可以直接写 JSX 标签，也可以用普通 TypeScript 函数返回 JSX tree 来复用片段。
- 不继续采用 v2 `SimpleProfile` class 继承设计。v3 profile 仍以 `.profile.tsx` 文件和 `defineAgentProfile` 为外层入口，TSX DSL 是该入口内的 prompt/context 声明能力。
- 稳定身份、协作模式、Markdown 扩展、内容节点、Lorebook、Manuscript、Plot System、工具使用原则、多 agent 协作说明应能通过 TSX Profile 节点表达，而不是只靠手写 `systemPrompt` 字符串。
- `HistorySet` 的历史迁移行为本次先不迁移到旧会话；先定义新规范和新会话语义，避免隐式改写 append-only history。
- `HistorySet` / `ModelContext` / `AppendingSet` / `Reminder` / `If` / `Watch` 必须迁移，并明确各自的上下文位置与持久化语义。旧 `DynamicSet` 在新 DSL 中硬切删除，不提供公开迁移别名。
- `AppendingSet` 是本轮向 session 增加消息的唯一途径：它内部产出的消息既进入本轮上下文，也写入 session。其他 set 不能绕过它直接追加 session 消息。
- TSX DSL 不支持 `<Message role="system">`。provider 级 system prompt、长期稳定约束、system reminder 等需要分别设计明确节点或编译规则，不把 `system` 当作普通 message role。
- `SkillCatalog` / `ActivatedSkills` 必须迁移，所有 TSX Node 都要纳入新规范；其中 catalog、activated skill、runtime reminders 的持久化边界需要重新定清楚。
- 旧 v2 工具以后再迁移。本任务不恢复 `read_file`、`execute_shell`、task、SQL、plot/story 等旧工具名，但 Profile DSL 可以为未来工具能力预留清晰扩展点。
- v2 plot/story 和 task 说明可以保留概念层表达，但所有具体工具调用必须等对应 v3 工具重建后再进入模型可见 active prompt。
- 前端可视化编辑器要跟随新 DSL：源码仍是真相源，但结构化编辑目标从 `systemPrompt` 字符串 range 改为可解析 TSX Profile tree。

## Target Architecture

## Terminology Clarification

### `context(ctx) => JSX`

这是普通 profile 作者优先使用的声明式入口。它返回 TSX DSL tree，例如：

```tsx
context(ctx) {
    return (
        <ProfilePrompt>
            <System>...</System>
            <HistorySet>...</HistorySet>
            <ModelContext>...</ModelContext>
            <AppendingSet>
                <Reminder id="workspace">
                    <Message role="user">...</Message>
                </Reminder>
            </AppendingSet>
        </ProfilePrompt>
    );
}
```

`context()` 不直接写 session，也不直接拼最终 model messages。它只是用 JSX/XML 标签描述 profile 本轮希望提供哪些上下文。runtime 编译这棵树，得到底层 `ProfileTurnPlan`。

### `prepare(ctx) => ProfileTurnPlan`

这是 profile 给 harness 的底层接口。高级 profile 可以绕过 TSX DSL，直接返回 `ProfileTurnPlan`。普通 profile 推荐写 `context()`，由 runtime 自动编译。第一版推荐 `context` 与 `prepare` 二选一；如果同时存在，应作为 profile contract 错误处理。

### `ProfileTurnPlan`

`ProfileTurnPlan` 是本轮 ReAct loop 前的“上下文施工单”，不是最终发给模型的 `messages`。它只告诉 harness：

- provider 级 system prompt 是什么。
- 首轮稳定上下文候选是什么。
- 本轮需要写入 session 的 AppendingSet 消息是什么。
- 本轮只给模型看的 model-only context 是什么。
- Reminder / Watch 这类节点需要更新哪些受控状态。

harness 会先按这个 plan 写入 session，再重新 reduce session，最后组装真正传给 ReAct loop 的 messages。

### `stateWrites`

`stateWrites` 是 Reminder / Watch / profile runtime 用来记录内部状态的受控 session entry。例如：

- 某个 `Reminder` 上一次注入的 fingerprint。
- 某个 `Watch` 上一次看到的值。
- 某个 profile runtime 节点需要在本轮后记住的轻量状态。

它不是给 profile 任意写 session 的逃生口；用户层要新增模型可见消息，只能通过 `AppendingSet`。

### Custom Entry 特性

当前 session 没有“原地更新 metadata”的存储面。`custom` 也是 append-only entry：

- 写入 `custom` 会追加一个新的 session entry；`appendEntry()` 会在非 leaf entry 后自动追加 leaf，把 active leaf 移到这次写入。
- `custom` entry 只有 `key: string` 和 `value: JsonValue`，不能直接保存函数、Date、Map 或非 JSON 值。
- `repo.reduce()` 沿 active path 读取 `custom`，同一个 key 后写覆盖前写，最终体现在 `ctx.session.customState[key]`。
- `custom` 不进入 provider messages，也不会作为聊天消息展示；但它仍会通过 `session_entry` 事件被前端知道。
- 因为它在 active path 上 reduce，状态天然跟随分支；fork / tree 切换后看到的是该分支路径上的最后一个 custom 值。

所以 Reminder / Watch 状态不能“不新建 entry”保存；但第一版不为每个 reminder/watch 单独写 entry，而是把同一 profile 的状态聚合到一个 `custom` entry：

```ts
type ProfileRuntimeState = {
    reminders?: Record<string, ReminderState>;
    watches?: Record<string, WatchState>;
};
```

entry key 固定为 `profileState.${profileKey}`。每轮 DSL compiler 在内存里合并旧状态与新状态，只在有变化时写一个聚合 `custom` entry。

设计约束：

- `stateWrites` 只允许写 `custom` entry，第一版 key 必须是 `profileState.${profileKey}`，value 必须符合 `ProfileRuntimeState`。
- `stateWrites` 不允许写 `message` / `custom_message` / `model_change` / `profile_change` / `invocation_lifecycle` 等会改变会话可见历史或运行配置的 entry。
- `stateWrites` 不进入 provider messages；它只会在下一次 `repo.reduce()` 后体现到 `ctx.session.customState`。
- `stateWrites` 应该是幂等的状态更新。相同 key 的后写值覆盖前写值，不依赖删除历史。
- 普通 TSX DSL 作者不直接接触 `stateWrites`；它由 `Reminder` / `Watch` 这类节点编译产生。
- 高级 `prepare()` 可以直接返回 `stateWrites`，也可以手写完整 `ProfileRuntimeState` 对象；validator 只放行聚合 profile state 的 `custom` entry，并整体验证 value shape。

### HistorySet 注入判断

新 harness 不需要 `profile.history.injected` 这类状态标记。`HistorySet` 是否应该写入，直接看当前 active path reduce 后是否已有 model-visible message：

- 没有任何 model-visible message：这是空会话的首次 invoke，可以写入 `HistorySet` 初始化消息。
- 已有任意 model-visible message：不再写入 `HistorySet`，避免给已有会话做隐式 prompt 迁移或补丁。

这里的 model-visible message 包括普通 `message`，以及 `visibleToModel: true` 的 `custom_message`。`invocation_lifecycle`、`custom` state、title/summary 等非消息 entry 不影响 HistorySet 注入判断。

这个规则的代价是：如果用户在非空 session 切换 profile，新 profile 的 `HistorySet` 不会自动补进历史。这个代价是有意接受的，因为当前任务明确不做旧会话隐式回填；profile 演化或切换后的显式迁移以后单独设计。

### System Profile Sync Metadata

为了让系统 profile 更新能安全同步到用户覆盖，本任务新增两类元数据：

1. 系统侧 build 产物：`assets/workspace/.nbook/agent/profiles/.system-profile-metadata.json`
   - 由 build 前置脚本生成，例如 `scripts/prepare-system-profile-metadata.ts`，并挂到 `package.json` 的 build / prepare 链路里，保证发版或本地 build 时自动更新。
   - 记录每个系统 profile 的 `fileName`、`profileKey`、`sha256`、`bytes`、`generatedAt`。
   - `sha256` 使用文件原始 bytes 计算，不做格式归一化；build 时更新，因此“系统 profile 更新”就是同一 `fileName/profileKey` 的系统 hash 发生变化。
   - `profileKey` 通过加载 profile manifest 获取；如果某个 `.profile.tsx` 编译失败，metadata 脚本应失败，避免写出无法被 runtime catalog 使用的 metadata。
   - metadata 文件本身不参与 profile hash，避免 build 每次因为 `generatedAt` 自我扰动。

2. 用户侧同步状态：`workspace/.nbook/agent/profiles/.profile-sync-state.json`
   - 由 `syncSystemAssetsToUserAssets()` 或 profile 恢复系统版本动作维护。
   - 记录用户文件上一次从哪个系统 hash 同步而来，例如 `upstreamHash` 和 `lastSyncedUserHash`。
   - 如果当前用户文件 hash 等于 `lastSyncedUserHash`，说明用户没有在同步后手改，可以安全用新的系统 profile 覆盖并更新 metadata。
   - 如果当前用户文件 hash 不等于 `lastSyncedUserHash`，说明用户覆盖已经被手改，不能自动覆盖，只报告“系统 profile 有更新但用户覆盖遮蔽”。
   - 如果用户文件存在但没有 sync state，视为 untracked 用户文件，不自动覆盖。

同步判定：

```text
systemHash = system metadata 当前 hash
recordedUpstreamHash = user sync state 记录的上次系统 hash
currentUserHash = 当前用户覆盖文件 hash
lastSyncedUserHash = user sync state 记录的上次同步后用户文件 hash

系统更新：systemHash !== recordedUpstreamHash
用户未改：currentUserHash === lastSyncedUserHash
可自动同步：系统更新 && 用户未改
必须保留用户覆盖：用户已改 || 缺少 sync state
```

这套 metadata 只解决“系统文件同步到用户覆盖”的安全判断，不参与 runtime profile 版本固定。Session 仍只持久化 `profileKey`，下一轮运行读取当前 catalog。

第一版 metadata 形状：

```json
{
    "generatedAt": "2026-05-23T00:00:00.000Z",
    "profilesRoot": "assets/workspace/.nbook/agent/profiles",
    "profiles": [
        {
            "fileName": "builtin/leader.default.profile.tsx",
            "profileKey": "leader.default",
            "sha256": "hex-encoded-sha256",
            "bytes": 12345
        }
    ]
}
```

用户侧 sync state 形状：

```json
{
    "profiles": [
        {
            "fileName": "builtin/leader.default.profile.tsx",
            "profileKey": "leader.default",
            "upstreamHash": "hex-encoded-sha256",
            "lastSyncedUserHash": "hex-encoded-sha256",
            "syncedAt": "2026-05-23T00:00:00.000Z"
        }
    ]
}
```

实现落点：

- 新增 `scripts/prepare-system-profile-metadata.ts`，扫描 `assets/workspace/.nbook/agent/profiles/**/*.profile.tsx`，加载 profile manifest，计算 hash，写入系统侧 metadata。
- `syncSystemAssetsToUserAssets()` 读取系统侧 metadata 与用户侧 sync state；缺文件时继续执行 copy-missing，但不会覆盖已有用户 profile。
- 当用户 profile 是上一次自动同步产物时，系统 profile hash 变化后自动覆盖用户文件，并刷新 sync state。
- 当用户 profile 被手改或缺少 sync state 时，不覆盖，只记录或返回“系统 profile 更新被用户覆盖遮蔽”的诊断。
- “恢复系统版本”动作也应写 sync state，这样后续 build 后的系统更新可以继续自动同步。

### Target Harness Contract

目标不是把旧 `PreparedTurn` 字段换个名字，而是改成下面这条单一真相源链路：

```text
POST /api/agent/sessions/:id/invocations
-> 构造 pending user message，但暂不写 session
-> reduce 当前 session，传给 profile.prepare()
-> profile.prepare() 返回 ProfileTurnPlan，不返回最终 contextMessages
-> harness 统一提交 pre-loop 写入
   1. history init entries，仅当前 active path 没有 model-visible message 时写入
   2. appending entries，本轮写入 session
   3. profile state entries，例如 Reminder / Watch baseline
-> prompt 模式写入 pending user message
-> 重新 reduce session
-> 用 reduce 后的 session messages + model-only context 组装 ReAct messages
-> 进入 ReAct loop
-> ReAct loop 的 assistant/toolResult message_end 由 harness 持久化并发 SSE
```

目标底层 `prepare` 返回值暂命名为 `ProfileTurnPlan`：

```ts
type ProfileTurnPlan = {
    systemPrompt?: string;
    historyInitMessages?: Message[];
    appendingMessages?: Message[];
    modelContextAppendingMessages?: Message[];
    modelContextMessages?: AgentMessage[];
    stateWrites?: SessionEntryDraft[];
};
```

约束：

- `ProfileTurnPlan` 不包含 `contextMessages` / `messages` / `historySeed` 这类双真相源字段。最终 ReAct `messages` 只能由 harness 在 pre-loop 写入后重新 reduce session，再拼接 `modelContextMessages` 得到。
- `ProfileTurnPlan` 不包含 `toolKeys`。本轮工具集合由 `profile.allowedToolKeys` 与 runtime tool registry 决定。后续如果需要高级动态裁剪，必须单独设计，不借 `prepare` 偷渡。
- `stateWrites` 只允许 DSL runtime 为 Reminder / Watch / profile 状态更新生成受控 custom entry，不能让普通 profile 任意写 session。用户层向 session 增加模型可见消息的显式通道是 `AppendingSet`；`ModelContext` 内的 `Reminder` 会被 runtime 转成 `modelContextAppendingMessages`，按同样 pre-loop 可见写入语义处理。
- `appendingMessages` 必须在真实用户消息之前写入 session，这样前端能先看到 `<system-reminder>` / activated skill / plan mode reminder，再看到用户输入和 AI streaming。
- `modelContextAppendingMessages` 必须和 `appendingMessages` 一样在真实用户消息前写入 session；它用于表达“源码归属在 ModelContext，但产品上必须可见”的 Reminder。
- `modelContextMessages` 必须在 pre-loop 写入完成并重新 reduce 后才拼入 ReAct input，不能提前混进 `context.messages`，避免 AppendingSet 重复进入模型上下文。
- `ingest` 本任务先不改造成消息归档策略。assistant / toolResult 仍由 harness 在 ReAct loop `message_end` 时写回 session，保证 SSE、waiting 和 resume 语义稳定。
- `continue + resolution` 仍先把 resolution toolResult 写入 session，再进入 profile prepare。普通 `continue` 不自动伪造用户消息。

### Target Profile DSL

- `System` / provider system prompt：只影响 provider `systemPrompt`，不作为普通 message 写入 session，也不允许用 `<Message role="system">` 表达。第一版 `System` 只能接收 string-like children：普通 string，以及 `SkillCatalog` / `ActivatedSkills` 这类返回 string 的 fragment；不能嵌套 `Message`、数组或复杂 JSX。虽然允许 string fragment，但推荐把 `SkillCatalog` / `ActivatedSkills` 放到 `ModelContext` 的 `Message` 中，让 provider system prompt 保持稳定。
- `HistorySet`：首轮稳定上下文。只能在当前 active path 没有 model-visible message 时初始化稳定前缀，不做旧会话隐式回填或 profile 演化 patch。它可以产生多条 `custom_message visibleToModel: true`，内部 message role 必须是 provider 支持的普通 role，不允许 system role 偷渡。`HistorySet` 允许 `AIMessage` / `ToolResult` 作为示例历史，但必须满足 provider message 顺序：带 tool call 的 `AIMessage` 后面才能跟对应 `ToolResult`。
- `ModelContext`：本轮 context。它替代旧 `DynamicSet`，新 DSL 直接删除 `DynamicSet`。普通消息不写 session、不被前端历史展示，只进入本轮模型输入；`ModelContext` 内的 `Reminder` 触发时输出到 `modelContextAppendingMessages`，按 pre-loop appending 语义写入 session 并展示；`Watch` 在这里仍只产出 model-only message。
- `AppendingSet`：本轮向 session 追加模型可见消息的唯一用户层通道。它的输出必须在 ReAct loop 前写入 session，并通过 `session_entry` SSE 先展示给前端。写入 session 时同样使用 `custom_message visibleToModel: true`。`AppendingSet` 中的普通 `Message` 每轮无条件写入 session；需要避免重复时必须用 `Reminder` / `Watch` 包裹。
- `Reminder`：可以出现在 `AppendingSet` 或 `ModelContext` 内。它决定本轮是否产出 pre-loop 可见 message，同时产生受控 `stateWrites` 更新 profile/session state。继续使用现有 v2 形态：`<Reminder>...</Reminder>` 内部接受 `Message` / `AIMessage` / `HumanMessage` / `ToolResult` 这类消息节点。
- `Watch`：本任务随 `stateWrites` 一起实现。它可以出现在 `AppendingSet` 或 `ModelContext` 内，用于根据外部状态变化生成消息，并通过 `stateWrites` 记录 baseline。位于 `AppendingSet` 时产出 session-visible appending message；位于 `ModelContext` 时只产出本轮 model-only message。
- `SkillCatalog`：返回 string 片段。它不是特殊 set 节点，理论上能放在任何支持 string-like children 的节点内部，例如 `System`、`Message` 或其他文本容器；具体是否持久化由外层 set 决定。虽然 `System` 可嵌入它，但推荐放到 `ModelContext` 的 `Message` 中。
- `ActivatedSkills`：返回 string 片段。它不是固定 AppendingSet 节点，理论上能放在任何支持 string children 的节点内部；具体是否持久化由外层 set 决定。
- `Message`：仅支持 provider 可接受的普通消息角色，例如 `user` / `assistant` / `toolResult` 或项目确定的别名。`role="system"` 非法。`HumanMessage` 是 `Message role="user"` 的更直观别名。
- `AIMessage` / `ToolCall` / `ToolResult`：作为历史样例或少量结构化上下文节点迁移，但必须遵守 provider message union 和 harness 持久化边界。`ToolCall` 只允许作为 `AIMessage` 子节点；`ToolResult` 必须有 `toolCallId`，并且必须能对应前序 `AIMessage` 的 tool call。
- `If`：保留为条件渲染节点，本身不产生分区，只展开合法子节点。条件为 false 时完全不渲染子树，也不更新子树内 `Reminder` / `Watch` state。

### Reminder Design

`Reminder` 是一个“是否注入这段消息”的 timing wrapper，不拥有 role/content。实际消息由内部 `Message` / `HumanMessage` / `AIMessage` / `ToolResult` 决定。

第一版 props：

```ts
type ReminderProps = {
    id: string;
    when?: boolean;
    watchPath?: ProfileWatchPath;
    watchValue?: JsonValue;
    repeatEveryTurns?: number;
    children?: ProfileMessageChildren;
};
```

规则：

- 只能放在 `AppendingSet` 内；放在 `System`、`HistorySet`、`ModelContext` 或 `Message` 内都诊断为非法。
- `id` 是同一 profile 内稳定的状态 key，不能在运行时根据用户输入生成随机值。
- `when` 默认为 `true`；为 `false` 时不渲染 children，也不更新 reminder state。
- `watchPath` 与 `watchValue` 至多存在一个；二者同时存在时报 profile contract 错误。
- `watchPath` 用于低代码编辑器和简单 profile，读取 `ctx` 中允许暴露给 profile 的只读运行上下文；`watchValue` 用于 TypeScript 用户自己计算好的 JSON 值。
- `watchPath` 第一版读取 profile context 只读对象，路径根限定为 `ctx.session`、`ctx.input`、`ctx.runtime`、`ctx.workspace`；这些根下面不做字段级白名单。它不支持任意全局 deep path，也不沿用 v2 的 `scope.*` 作为公开合同。
- `repeatEveryTurns` 必须是正整数；计数基准是当前 active path 中真实 `message role="user"` 的 prompt 轮数，加上本轮 pending prompt。`continue + resolution`、`custom_message` 里的 profile reminder 都不参与 turn 计数，避免审批恢复或 reminder 自己把间隔冲乱。
- `children` 最终必须渲染成 provider 可接受的 message；`<Message role="system">` 仍然非法。需要系统提醒效果时，用 `HumanMessage` / `Message role="user"` 包 `<system-reminder>` 文本。

触发规则：

- 没有 `watchPath` / `watchValue` / `repeatEveryTurns`：每次 `AppendingSet` 编译时都注入。这个模式适合明确每轮都要展示的上下文，调用方要自己承担历史膨胀。
- 有 watch 值：首次看到值时注入；之后只有 fingerprint 变化才注入。
- 有 repeat：首次注入；之后当 `currentUserTurn - lastInjectedUserTurn >= repeatEveryTurns` 时注入。
- 同时有 watch 和 repeat：fingerprint 变化或 repeat 到期任一条件满足就注入。
- fingerprint 使用稳定 JSON 序列化；非 JSON 值不能作为 `watchValue`，应在 profile 代码里先转成 JSON summary。

状态写入：

```ts
type ReminderState = {
    kind: "profile.reminder";
    fingerprint?: string;
    lastInjectedUserTurn: number;
    lastInjectedAt: number;
};
```

状态写入合并到 `customState["profileState.${profileKey}"].reminders[id]`。只有带 watch 或 repeat 的 reminder 才需要写 state；无状态的每轮 reminder 不写 state。

### Watch Design

`Watch` 是“观察一个值，变化时生成消息”的节点。它和 `Reminder` 的区别是：`Reminder` 的 children 是固定消息，只由时机决定是否注入；`Watch` 的消息由 `render(change)` 根据前后值生成。

第一版 props：

```ts
type WatchProps<TValue extends JsonValue = JsonValue> = {
    id?: string;
    path?: ProfileWatchPath;
    value?: TValue;
    render: (change: {
        previousValue: TValue | undefined;
        currentValue: TValue | undefined;
        changed: boolean;
        initial: boolean;
        ctx: ProfileContext;
    }) => ProfileChild;
};
```

规则：

- 只能放在 `AppendingSet` 或 `ModelContext` 内。
- `path` 与 `value` 至多存在一个；二者同时存在时报 profile contract 错误。
- 使用 `value` 时必须提供 `id`，因为 value 本身不能稳定命名状态。
- 使用 `path` 且未提供 `id` 时，状态 key 使用 `path`。
- `path` 第一版与 `Reminder.watchPath` 共用 `ProfileWatchPath` 根：只允许 `ctx.session`、`ctx.input`、`ctx.runtime`、`ctx.workspace` 下的只读字段，不做字段级白名单。
- 首次 baseline 不存在且当前值为 `undefined`：只写 baseline，不生成消息。
- 首次 baseline 不存在且当前值非 `undefined`：调用 `render({ initial: true, changed: true })`。这保留 v2 的“首次有效值也可以提醒”能力。
- baseline 存在且 fingerprint 未变：不生成消息，但可以刷新 baseline timestamp。
- baseline 存在且 fingerprint 改变：调用 `render({ initial: false, changed: true })`。返回消息在 `AppendingSet` 内进入 session-visible appending messages；在 `ModelContext` 内只进入本轮 `modelContextMessages`。
- `render()` 返回 `null` / `false` / 空白消息时不产生 appending message，但 baseline 仍更新，避免同一变化下一轮反复触发。
- `ModelContext` 和 `AppendingSet` 中相同 `id/path` 的 `Watch` 共用同一个 baseline。同轮按源码顺序渲染，后面的 watch 读取前面 watch 已经在内存里更新过的 baseline，避免重复触发。

状态写入：

```ts
type WatchState = {
    kind: "profile.watch";
    hasValue: boolean;
    fingerprint: string;
    value: JsonValue | null;
    updatedAt: number;
};
```

状态写入合并到 `customState["profileState.${profileKey}"].watches[idOrPath]`。`value` 存快照是为了让下一轮 `render()` 能拿到 `previousValue`；`hasValue` 用来区分 `undefined` 与 `null`。

实现顺序：

1. DSL compiler 在渲染 `AppendingSet` / `ModelContext` 时处理 `Reminder` / `Watch`，读取当前 `ctx.session.customState` 的旧状态；`Reminder` 在 `ModelContext` 中输出到 `modelContextAppendingMessages`。
2. 先计算 `modelContextAppendingMessages` / `appendingMessages`，同时在内存里合并下一份 `ProfileRuntimeState`。
3. Harness 按 `historyInitMessages -> modelContextAppendingMessages -> appendingMessages -> stateWrites -> pending user message` 写入 session；`stateWrites` 最多包含一个 `profileState.${profileKey}` 聚合 custom entry。
4. 写入完成后重新 reduce session，再把 reduce 后消息与 `modelContextMessages` 组装给 ReAct loop。
5. 单测锁定：Reminder 首次/变化/repeat、Watch undefined/null 区分、Watch render 返回空时仍更新 baseline、profile state 不进入 provider messages。

推荐 profile 形态：

```tsx
export default defineAgentProfile({
    manifest: profileManifest,
    inputSchema: InputSchema,
    outputSchema: OutputSchema,
    allowedToolKeys,
    context(ctx) {
        return (
            <ProfilePrompt>
                <System>...</System>
                <HistorySet>...</HistorySet>
                <ModelContext>...</ModelContext>
                <AppendingSet>...</AppendingSet>
            </ProfilePrompt>
        );
    },
});
```

高级用户仍可覆写底层 `prepare(ctx): ProfileTurnPlan`，但普通 profile 推荐使用 `context(ctx) => JSX`。如果同时提供 `context` 与 `prepare`，应以 `prepare` 为高级覆写入口还是诊断为冲突，需要继续 grill 后定稿。

目标 Workbench 语义：

- 外层 host 决定用户能看到哪些 profile、当前编辑哪个 `fileName`、是否允许保存；Workbench 编辑器组件只编辑传入的受控 TSX 文件。
- 源码是真相源。解析失败时仍允许源码保存，并展示 diagnostics。
- 可视化编辑第一阶段实现新 DSL 中本任务提到的全部节点：`System`、`HistorySet`、`ModelContext`、`AppendingSet`、`Message`、`AIMessage`、`ToolCall`、`ToolResult`、`Reminder`、`Watch`、`If`、`SkillCatalog`、`ActivatedSkills`。复杂 TypeScript helper 继续通过源码编辑。
- Preview 展示 harness 编译结果，而不是只展示 `systemPrompt` 字符串：`systemPrompt`、HistorySet 初始化候选、ModelContext Reminder pre-loop 写入、AppendingSet pre-loop 写入、ModelContext model-only context、最终 ReAct messages 预览。

## Resolved Decisions From Latest Grill

- `prepare()` / `context()` 可以看到 pending user message 的只读视图，用于 skill 激活和条件上下文；真实用户消息仍由 harness 统一写入 session。
- `context(ctx) => JSX` 与底层 `prepare(ctx) => ProfileTurnPlan` 不允许同时存在；同时存在时报 profile contract 错误。
- 记录 TODO：后续可以研究把 steer / follow-up queue 也交给 profile 管理，而不是继续全部放在 harness。
- system reminder 继续使用现有 `<Reminder>` 形态，不新建 `<SystemReminder>` 节点。`Reminder` 只控制是否注入，内部 message 节点决定实际 role/content。
- TSX 自定义消息节点需要重新设计：`Reminder` 内部可接受 `Message` / `AIMessage` / `HumanMessage` / `ToolResult` 等消息节点；最终编译为 provider 可接受的 message，再包进 session `custom_message`。
- Profile 生成的 `HistorySet` / `AppendingSet` 可见消息写入 session 时使用 `custom_message visibleToModel: true`。
- `HistorySet` 是否注入不需要 `profile.history.injected` 标记，直接看当前 active path 是否已有 model-visible message。
- `SkillCatalog` 返回 string，能放在任何支持 string children 的节点内部，不做只能放 `HistorySet` 的限制。
- `ActivatedSkills` 返回 string，能放在任何支持 string children 的节点内部，不固定放进 `AppendingSet`。
- `Watch` 随 `stateWrites` 一起实现。
- `Reminder` / `Watch` state 不加 profile version。
- Reminder / Watch 状态使用 `profileState.${profileKey}` 聚合 custom entry；custom entry 不能原地更新，只能 append，新值在 reduce 时覆盖旧值。
- 高级 `prepare(ctx): ProfileTurnPlan` 可以返回 `stateWrites`，也可以手写完整 `ProfileRuntimeState` 对象，但只能返回受控的聚合 profile state custom entry，且必须通过 shape 校验。
- `System` 第一版只接收 string-like children，允许 `SkillCatalog` / `ActivatedSkills` 这类 string fragment，但推荐把它们放到 `ModelContext` 的 `Message` 中。
- `HistorySet` / `AppendingSet` 写入 session 时都使用 `custom_message visibleToModel: true`。普通 prompt 用户输入写入 `message origin: "prompt"`，`Reminder.repeatEveryTurns` 只计算这种真实 prompt 轮次，避免 `custom_message` reminder 或 harness 自动提醒污染间隔。
- `HistorySet` 允许 `AIMessage` / `ToolResult` 作为示例历史，但必须符合 provider tool-call 顺序。
- `ToolCall` 只允许作为 `AIMessage` 子节点；`ToolResult.toolCallId` 必填，并校验前序 `AIMessage` 存在对应 tool call。
- `AppendingSet` 内普通 `Message` 每轮无条件写入 session；需要去重或按变化触发时用 `Reminder` / `Watch`。
- `ModelContext` 允许 `Watch` 与 `Reminder`；`Watch` 在 `ModelContext` 中只产出 model-only message，`Reminder` 在 `ModelContext` 中输出到 `modelContextAppendingMessages` 并按 appending 语义写入 session。
- 相同 `id/path` 的 `Watch` 在 `ModelContext` 和 `AppendingSet` 中共用 baseline，同轮按源码顺序处理，避免重复触发。
- `If` 条件 false 时完全不渲染子树，也不更新子树内状态。
- `Reminder.watchPath` / `Watch.path` 第一版走 profile context 只读路径，根限定为 `ctx.session`、`ctx.input`、`ctx.runtime`、`ctx.workspace`，根下面不做字段级白名单。
- 带 `watchPath` / `watchValue` 的 `Reminder` 首次看到值时注入，之后按 fingerprint 变化或 repeat 间隔注入。
- `repeatEveryTurns` 只计算真实 prompt 用户消息；`continue + resolution` 不推进 reminder 间隔。
- 系统 profile metadata 脚本如果遇到 `.profile.tsx` 编译或 manifest 加载失败，直接 fail build，不跳过坏文件。
- 用户 profile 覆盖同步通过系统 metadata 与用户 sync state 判断：自动同步只发生在“系统更新且用户文件未手改”时；缺 state 或用户已改都保留用户覆盖。
- 系统 profile 更新但用户覆盖已手改时，catalog/detail API 返回 warning；前端 profile 列表或 detail 顶部显示该诊断。
- `.profile-sync-state.json` 不做特殊隐藏；它可以作为普通 user-assets dotfile 出现在文件树中，profile catalog 会因为它不是 `.profile.tsx` 而自然忽略。
- 新 DSL 硬切删除 `DynamicSet`，公开只保留 `ModelContext`。
- Workbench 第一阶段实现本任务提到的全部 DSL 节点，包括 `Watch.render` 的结构化展示与编辑；复杂 TypeScript helper 仍通过源码编辑。
- v2 leader 中 Plot System / task / SQL 概念层可以保留，但旧工具名和调用旧工具的命令式说明不能进入 active prompt。
- 本任务暂不新增稳定 `reference/agent/profile-dsl.md`；先把设计记录在任务 README 与 harness 文档中。

## Implementation Guardrails

- `Watch.render` 的可视化编辑只承诺稳定、可 round-trip 的结构化形态；任意 TypeScript 表达式、复杂 helper 和无法稳定解析的 render body 继续通过源码编辑，不在 UI 里伪装成已完整结构化支持。
- DSL validator 必须强校验非法嵌套和非法消息序列。`System`、`Reminder`、`Watch`、`ToolCall`、`ToolResult`、`HistorySet` 示例历史和 `ModelContext`/`AppendingSet` 落点错误都应直接报 profile contract 错误。
- `ProfileRuntimeState` 必须整体验证 shape。高级 `prepare()` 不能借 `stateWrites` 写任意 session entry，也不能写 `profileState.${profileKey}` 之外的 custom key。
- Workbench 前端拖拽/插入规则和后端 parser/validator 的合法嵌套规则必须同源或共用同一份规则定义，避免前端能构造但后端拒绝。
- 实现顺序必须是：先实现 runtime DSL + harness，再迁移 `leader.default` profile，最后做 Workbench。Workbench 不能围绕尚未跑通的 DSL 先行扩展。

## Open Decisions To Grill

这些问题会影响 runtime contract、TSX DSL 形状或前端编辑器模型，不能在实现时临时绕开：

暂无。

## Implementation Plan

1. Harness architecture
   - 将 harness 目标接口改为 `ProfileTurnPlan`，淘汰旧目标中的 `PreparedTurn.toolKeys`、`sessionWrites` 和任何最终 `contextMessages`。
   - `profile.prepare()` 或 DSL compiler 只返回 system prompt、history init、appending、model-only context 和受控 state writes。
   - tools 不从 prepare 返回；由 `profile.allowedToolKeys` 决定。
   - HistorySet 初始化不再依赖 `profile.history.injected`，而是直接检查当前 active path 是否已有 model-visible message。
   - 明确 pre-loop 写入顺序：history init、AppendingSet 片段、受控 profile state、当前用户消息。
   - AppendingSet 写入 session 后必须通过 `session_entry` SSE 让前端先看到 system reminder / appending context，再看到用户输入和 AI streaming。
   - 本阶段不改造 ingest 对 assistant/toolResult 的归档决策，继续由 harness 在 `message_end` 持久化 ReAct loop 产物。
   - 验证：补 harness 测试锁定 pre-loop entry 顺序、SSE entry 发布、最终 ReAct messages 来自 reduce 后 session + model-only context，且不重复包含 AppendingSet。

2. TSX Profile DSL spec
   - 定义 active v3 支持的 TSX nodes、合法嵌套、输出分层和持久化语义。
   - 覆盖本次要实现的 v2 核心节点或其新名称等价物：`ProfilePrompt`、`HistorySet`、`AppendingSet`、`Message`、`AIMessage`、`ToolCall`、`Reminder`、`Watch`、`If`、`SkillCatalog`、`ActivatedSkills`。
   - 将旧 `DynamicSet` 语义硬切为 `ModelContext`，不提供公开迁移别名。
   - 明确不支持 `<Message role="system">` 后，system prompt、system reminder、历史稳定上下文分别使用什么节点或编译规则表达。
   - 继续使用 `<Reminder>` 表达 system reminder；`Reminder` 内部通过 `Message` / `AIMessage` / `HumanMessage` / `ToolResult` 这类消息节点承载实际内容。
   - 明确 `AppendingSet` 是唯一 session append 通道，`HistorySet` 首轮稳定前缀和 profile/session state 更新不应伪装成本轮追加消息。
   - 明确 `Watch` 在 `AppendingSet` 与 `ModelContext` 中的不同输出落点；`Reminder` 在 `ModelContext` 中输出到 `modelContextAppendingMessages`。
   - 明确 `HistorySet` 示例历史中 `AIMessage` / `ToolResult` 的合法顺序。
   - 建立 DSL validator，并强校验 `System`、`Reminder`、`Watch`、`ToolCall`、`ToolResult` 和消息序列。
   - 将合法嵌套规则抽成前后端可共用或可同源生成的定义。
   - 明确哪些节点只影响 provider `systemPrompt`，哪些产出 history 初始化片段、AppendingSet 片段、model-only 片段和 profile state updates。
   - 验证：为节点合法性、空输出、顺序和持久化边界设计测试。

3. Profile runtime integration
   - 把 `prepare` / `ingest` 定位为底层接口；新增用户层 `context(ctx) => JSX` 构造入口，由 runtime 编译成底层 `ProfileTurnPlan`。
   - 设计 Profile 文件如何返回 JSX DSL：外层继续使用 `defineAgentProfile`，在其中提供直观的 TSX prepare/context builder；同时允许普通函数返回 TSX tree 作为复用片段。
   - `context` 与 `prepare` 同时存在时报 profile contract 错误。
   - 不恢复 `SimpleProfile` class 继承模型；把 v2 class profile 的有价值语义迁到函数式 `.profile.tsx` contract。
   - 接入 dynamic profile catalog、preview-prepare、check-profile 和 Workbench 可视化辅助编辑。
   - 验证：真实 `leader.default.profile.tsx` 能通过 JSX DSL 产出新 harness 可消费的 `ProfileTurnPlan`。

4. Harness ReAct loop contract
   - 明确 ReAct loop 输入参数：`sessionId`、`workspaceKey`、`workspaceRoot`、`systemPrompt`、`messages`、`model`、`apiKey`、`toolKeys`、`profileKey`、`thinkingLevel`、`abortSignal`、`invocationId`、`onEvent`。
   - 明确 ReAct loop 输出结果：`events`、`finalAssistant`、`reportResult`、`waiting`。
   - 明确 loop 内消息持久化来源：assistant / toolResult 的 `message_end` 事件会写入 session；进入 loop 前由 DSL/harness 决定写入的消息必须已经落盘。
   - 本任务先不改造 `ingest`；先保持 loop 内 `message_end` 由 harness 持久化，避免同时改动 live SSE、waiting 恢复和结果归档。

5. Prompt parity inventory
   - 对 v2 `leader-default.profile.tsx` 按区块列出要迁移、要改写、要暂缓的内容。
   - 输出迁移表：v2 section、v3 落点、处理方式、阻塞原因。
   - 验证：搜索迁移表中所有旧工具名，确认不会进入 active v3 prompt。

6. Rewrite v3 `leader.default` with TSX DSL
   - 扩展 `assets/workspace/.nbook/agent/profiles/builtin/leader.default.profile.tsx`，优先使用新 TSX Profile DSL 表达提示词分层。
   - 保留当前 v3 工具名和 TypeBox contract。
   - 增加 v2 关键业务块：
     - System / 协作模式
     - Markdown 扩展写作格式
     - 工具使用与输出效率
     - 多 agent 协作
     - 目录介绍
     - 内容节点
     - Anatomy Lorebook
     - Anatomy Manuscript
     - Anatomy Plot System
     - Shell / workspace CLI 规则
     - Plan Mode 基础约束
   - 验证：测试断言这些 section 存在，旧工具名不存在。

7. Rebuild runtime reminders
   - 用 `AppendingSet` / `Reminder` / `Watch` 表达当前可见 runtime reminders；`ModelContext` 只保留真正 model-only 的动态上下文。
   - 包含：
     - workspace root
     - profile key
     - plan mode active 状态
     - available agents
     - linked agents
     - profile input role，如果存在
   - 对每个节点明确是否持久写入，不把每轮重复提醒误写成无限历史膨胀。
   - 验证：单测读取 `prepared.dynamicMessages`，确认 linked agents / catalog profile 可见。

8. TSX visual editor and Workbench
   - 在 runtime DSL + harness 与 `leader.default` profile 迁移跑通之后再实现 Workbench 改造。
   - 更新 Workbench 文档中过期的“只解析 systemPrompt range”决策，改为围绕新 TSX DSL 的可视化辅助编辑。
   - 后端源码解析从 System Prompt 占位节点升级为 TSX Profile tree AST；第一阶段优先解析 `context(ctx) { return (<ProfilePrompt>...</ProfilePrompt>) }` 或等价稳定源码区域。
   - 保留源码为真相源，解析失败时源码编辑仍可保存。
   - 前端组件库、画布和 Inspector 跟随新节点命名与合法嵌套规则，并实现本任务提到的全部 DSL 节点。
   - 删除旧 `DynamicSet` 组件和物料，改为 `ModelContext`。
   - `Watch.render` 也进入结构化编辑范围，但只对稳定可 round-trip 的 render 形态提供 UI 编辑；复杂 helper / 无法 round-trip 的表达式继续通过源码编辑。
   - Preview/validate 展示 harness 编译后的分区结果：systemPrompt、history 初始化片段、AppendingSet pre-loop 写入片段、ModelContext 片段、最终 ReAct messages 预览。
   - 验证：补 Workbench service / parser / round-trip tests，必要时再补前端组件测试。

9. Sync user override when needed
   - 新增 build-time 系统 profile metadata：`assets/workspace/.nbook/agent/profiles/.system-profile-metadata.json`。
   - `scripts/prepare-system-profile-metadata.ts` 扫描系统 `.profile.tsx`，加载 manifest，计算 hash；任一系统 profile 编译或 manifest 加载失败时 fail build。
   - `syncSystemAssetsToUserAssets()` 读取系统 metadata 与用户 `.profile-sync-state.json`。
   - 用户 profile 缺失时沿用 copy-missing，并写入 sync state。
   - 用户 profile 存在且 `currentUserHash === lastSyncedUserHash` 时，若系统 hash 变化则自动覆盖用户文件并刷新 sync state。
   - 用户 profile 存在但缺 sync state，或 `currentUserHash !== lastSyncedUserHash` 时，保留用户覆盖并返回诊断。
   - 诊断由 catalog/detail API 返回 warning，前端 profile 列表或 detail 顶部展示。
   - `.profile-sync-state.json` 不做特殊隐藏；它不是 `.profile.tsx`，profile catalog 自然不会当 profile 加载。
   - “恢复系统版本”动作也写 sync state，让后续系统 profile 更新能继续安全自动同步。
   - 验证：分别检查 system root 和被自动同步后的 user root profile；手改用户覆盖时断言不会覆盖。

10. Tests
   - 更新 `server/agent/profiles/leader-assets-profile.test.ts`。
   - 保留现有断言：
     - allowed tools 使用 v3 工具名。
     - 不包含 v2 旧工具名。
     - `leader.default` 不默认允许 `report_result`。
     - 不使用 `historyMessages` 隐式回填。
   - 新增断言：
     - prompt 包含 v2 迁移后的核心 section。
     - dynamic context 包含 workspace、profile key、available agents、linked agents。
     - prompt 明确 `request_user_input` 只用于结构化选择、跨轮阻塞等待或审批式决策。
   - 验证命令：
     - `bunx vitest run server/agent/profiles/leader-assets-profile.test.ts server/agent/profiles/catalog.test.ts`
     - `bun scripts/profile.ts check builtin/leader.default.profile.tsx --system`
     - 如同步用户覆盖，再运行 `bun scripts/profile.ts check builtin/leader.default.profile.tsx`

11. Documentation
   - 更新 `docs/tasks/02-pi-agent-harness-migration/README.md`，把“TODO：继续做更完整 prompt parity”改成当前实际完成范围与剩余缺口。
   - 更新 `docs/tasks/04-tsx-profile-workbench/README.md`，把可视化编辑器目标从 systemPrompt range 改到新 TSX DSL tree。
   - 更新 `docs/modules/agent/harness.md`，记录实现后的 harness pre-loop 提交流程。
   - 更新本文档 Walkthrough / Files Changed / Verification。
   - 本任务暂不新增稳定 `reference/agent/profile-dsl.md`；等 DSL 经实现验证后再考虑沉淀到 spec。
   - 如实际 runtime 行为或长期 TODO 变化，再更新 `PROJECT-STATUS.md`。

## Acceptance Criteria

- `leader.default` 从 `assets/workspace/.nbook/agent/profiles/builtin/leader.default.profile.tsx` 加载成功。
- `leader.default` 使用新的 TSX Profile DSL 表达核心 prompt 分层和可见 runtime reminders。
- build / prepare 链路会生成系统 profile metadata；坏系统 profile 会让 metadata 脚本失败。
- 用户覆盖 profile 只在 sync state 证明用户未手改时自动同步；手改或缺 state 时不覆盖。
- TSX Profile DSL 不依赖 `SimpleProfile` class 继承。
- TSX Profile DSL 支持直接 JSX 标签和函数返回 JSX tree 两种写法，并通过 `context(ctx) => JSX` 或底层 `prepare(ctx) => ProfileTurnPlan` 进入 runtime。
- `<Message role="system">` 被禁止或诊断为非法；相关 system 语义有明确替代节点或编译规则。
- `DynamicSet` 在新 DSL 中不可用；旧 model-only 语义统一由 `ModelContext` 表达。
- `Reminder` 继续作为 system reminder / runtime reminder 的注入节点，内部接受消息节点承载实际内容。
- Profile 生成的可见上下文通过 `custom_message visibleToModel: true` 写入 session，真实用户输入仍通过普通 `message role="user"` 写入。
- `HistorySet` 初始化只看当前 active path 是否已有 model-visible message，不写 `profile.history.injected` 标记。
- `AppendingSet` 是本轮向 session 追加消息的唯一通道，并有测试锁定。
- `prepare()` 产出 `ProfileTurnPlan`；harness 提交 pre-loop session 片段后再统一组装最终 ReAct `messages`，不返回重复包含 history 的 `contextMessages`。
- `prepare()` 不返回 `toolKeys`；运行工具集合来自 `profile.allowedToolKeys`。
- 前端在一次 prompt invocation 中能按顺序看到 pre-loop AppendingSet 消息、用户消息和后续 AI streaming。
- TSX 可视化编辑器能解析、展示、局部编辑新 DSL tree；保存仍以源码为真相源。
- prompt 中不出现 v2 旧工具名作为 active instruction。
- allowed tools 与当前 v3 registry 一致，不包含不存在的工具。
- v2 关键业务语义已经迁入或明确记录为 TODO。
- 测试覆盖 TSX Node 合法性、prompt section、工具命名、model-only context、Reminder / Watch 触发和 history 不回填边界。
- 任务文档记录实际实现结果、验证结果和计划偏差。

## Implementation Walkthrough

- 已新增 active TSX Profile DSL runtime：
  - `server/agent/profiles/profile-dsl.ts`
  - `server/agent/profiles/profile-dsl/jsx-runtime.ts`
  - `server/agent/profiles/profile-dsl/jsx-dev-runtime.ts`
- 已把 profile 输出合同硬切为 `ProfileTurnPlan`，并在 `validateProfileTurnPlan()` 中拒绝旧 `PreparedTurn` 字段。
- `defineAgentProfile()` 已支持 `context(ctx) => JSX` 与 `prepare(ctx) => ProfileTurnPlan` 二选一；同时存在时报 contract error。
- Harness 已改为：
  - tools 只读 `profile.allowedToolKeys`。
  - pre-loop 写入顺序为 `historyInitMessages -> modelContextAppendingMessages -> appendingMessages -> stateWrites -> pending user message`。
  - `HistorySet` 注入只看当前 active path 是否已有 model-visible message，不再使用 `profile.history.injected`。
  - ReAct loop messages 使用重新 reduce 后的 session messages 加 `modelContextMessages`。
  - assistant/toolResult 继续由 loop 内 `message_end` 持久化；`ingest` 暂不接管归档策略。
- 已实现 `Reminder` / `Watch` 状态：
  - 状态聚合写入 `custom profileState.${profileKey}`。
  - `Reminder` 允许在 `AppendingSet` 与 `ModelContext`；在 `ModelContext` 中触发时输出到 `modelContextAppendingMessages`，仍按 appending 语义在 ReAct 前写入 session 并通过 SSE 展示。
  - `Watch` 允许在 `AppendingSet` 与 `ModelContext`。
  - `watchPath` / `path` 根限定为 `ctx.session`、`ctx.input`、`ctx.runtime`、`ctx.workspace`。
  - `repeatEveryTurns` 只计算 active path 中 `origin: "prompt"` 的真实用户 prompt 轮次；prompt 模式下 profile 可读 `ctx.runtime.pendingUserMessage`，但真实用户消息仍在 appending/state 之后写入 session。
- 已新增系统 profile metadata：
  - `scripts/prepare-system-profile-metadata.ts`
  - `assets/workspace/.nbook/agent/profiles/.system-profile-metadata.json`
  - `syncSystemAssetsToUserAssets()` 维护用户侧 `.profile-sync-state.json`，只在用户未手改时自动同步系统 profile 更新。
- 已迁移系统 `leader.default`：
  - `assets/workspace/.nbook/agent/profiles/builtin/leader.default.profile.tsx` 使用新 TSX DSL。
  - 用户覆盖 `workspace/.nbook/agent/profiles/builtin/leader.default.profile.tsx` 已同步到同一 DSL 形态。
  - prompt 保留 v2 核心协作、Markdown 扩展、workspace、多 agent、Lorebook、Manuscript、Plot System、Plan Mode 和工具使用原则。
  - 不引入 v2 旧工具名作为可调用工具指令。
- 已适配 TSX Profile Workbench：
  - 前端节点物料从 `DynamicSet` 切为 `ModelContext`，补 `System` / `ToolResult` 等新节点。
  - 后端新增 `server/agent/profiles/profile-dsl-source-parser.ts`，解析 `context()` 返回的 `<ProfilePrompt>` TSX DSL tree。
  - 画布写回改为局部替换已定位的 `ProfilePrompt` JSX 片段，不再只替换旧 system prompt 字符串 range。
  - `ToolCall` 画布正文映射为 runtime DSL 的 `args` prop，避免生成不可运行的 children 形态。
  - preview 展示 `systemPrompt`、history init、modelContextAppending、appending、modelContext、stateWrites 和按真实 HistorySet 条件近似组装的最终 `reactMessages`。

### 2026-05-23 Reminder / System Prompt UI Follow-up

- 修复 pre-loop profile 提醒在前端晚到的问题：`prepare()` 写入 history/modelContextAppending/appending/state 后会立刻发布 `session_state_changed`；前端也会把 `session_entry` 中的 profile system reminder 即时投影到消息流。
- 新增 session snapshot `systemPrompt` 字段；前端在对话顶部展示当前 profile system prompt，使用 Markdown 渲染并默认收起。该卡片只是只读展示，不写入普通 session history。
- `leader.default` 的 workspace / linked agents / tasks 三条基础 `Reminder` 放在 `ModelContext` 中；runtime 编译为 `modelContextAppendingMessages`，保证它们仍在用户输入和 AI streaming 前可见。

### 2026-05-24 Leader Assets TSX DSL Follow-up

- `leader.assets` 已从高级 `prepare()` 手写 `modelContextMessages` 迁为 `context() => <ProfilePrompt>`，与 `leader.default` 使用同一套 active TSX DSL contract。
- `leader.assets` 复用现有系统级 DSL 节点：`ProfilePrompt`、`System`、`HistorySet`、`ModelContext`、`AppendingSet`、`Message`、`AgentCatalog`、`SkillCatalog`、`LinkedAgentsReminder`、`PlanModeReminder`、`MentionedSkillsReminder`。
- user-assets 专属的 workspace reminder 和 skill catalog wording 保留在 `leader.assets.profile.tsx` 本地 helper 中；它们暂时没有跨 profile 复用价值，不提升为系统级 TSX Node helper。
- `leader.assets` 的 `HistorySet` 现在注入 agent catalog 与 user-assets 版本 skill catalog；`AppendingSet` 注入 user-assets cwd/边界提醒、linked agents、plan mode 和 `$skill` 提醒。
- 系统 `.compiled` artifact 与 `.system-profile-metadata.json` 已重新生成，`leader.assets` 当前系统 artifact 为 `565a51165bf46b43d5405a53.mjs`。

## Plan Deviations

- Workbench parser 第一版没有覆盖任意 TypeScript 控制流；只解析稳定的 `context()` 返回 JSX tree、局部 JSX binding、常见 conditional expression 和可保留源码的表达式节点。复杂 helper / `Watch.render` 仍走源码编辑。
- `prepare-system-profile-metadata.ts` 已实现，并接入 `package.json` 的 `build` / `nuxt:build`，另提供 `profile:metadata` 手动脚本。
- 初始 tracer bullet 只要求 `leader.default` 硬切 TSX DSL；后续 follow-up 已把 `leader.assets` 也迁到 TSX DSL。user-assets 专属逻辑没有新增为系统级 helper，避免把单 profile 文案过度抽象到 runtime。
- 未自动做浏览器验证，符合项目规则；需要用户明确要求后再打开浏览器检查 Workbench UI。

## Risks

- v2 prompt 中部分剧情/Plot 能力依赖旧工具；如果只迁 prompt 不补工具，模型会被诱导调用不存在的能力。处理方式：概念可保留，工具级动作暂缓或改写。
- 当前 `appendingMessages` 会持久写入，不能直接模拟 v2 `Reminder` / `Watch`。处理方式：本任务必须先定新 DSL 和 harness 输出语义，避免迁移后造成历史膨胀。
- 用户覆盖 profile 可能遮蔽系统 assets。处理方式：实现阶段必须检查 user root 是否存在覆盖，并谨慎同步。
- 大 prompt 修改容易引入旧工具名残留。处理方式：测试和 `rg` 双重检查。
- `bun run typecheck` 当前可能受既有无关前端错误影响。处理方式：本任务优先跑 profile check 和相关 profile tests，若 typecheck 失败需标明是否为既有无关错误。

## Files Planned

- `assets/workspace/.nbook/agent/profiles/builtin/leader.default.profile.tsx`
- `workspace/.nbook/agent/profiles/builtin/leader.default.profile.tsx`（若需要同步用户覆盖）
- `server/agent/prompts/**` 或新的 TSX Profile DSL runtime 文件（具体路径待设计确认）
- `server/agent/profiles/**` 中的 DSL 编译/preview/check 接线（具体路径待设计确认）
- `server/agent/profiles/types.ts`
- `server/agent/harness/neuro-agent-harness.ts`
- `server/agent/profiles/leader-assets-profile.test.ts`
- `app/components/profile-template-editor/**`
- `server/agent/profiles/workbench-service.ts`
- `shared/dto/agent-profile.dto.ts`
- `docs/tasks/05-leader-profile-v2-adaptation/README.md`
- `docs/tasks/04-tsx-profile-workbench/README.md`
- `docs/tasks/02-pi-agent-harness-migration/README.md`
- `docs/modules/agent/harness.md`
- `PROJECT-STATUS.md`（如长期 TODO 或模块状态变化）

## Files Changed

- `server/agent/profiles/profile-dsl.ts`
- `server/agent/profiles/profile-dsl/jsx-runtime.ts`
- `server/agent/profiles/profile-dsl/jsx-dev-runtime.ts`
- `server/agent/profiles/profile-dsl-source-parser.ts`
- `server/agent/profiles/types.ts`
- `server/agent/profiles/define-agent-profile.ts`
- `server/agent/harness/neuro-agent-harness.ts`
- `server/agent/profiles/catalog.ts`
- `server/workspace-files/novel-workspace.ts`
- `scripts/prepare-system-profile-metadata.ts`
- `package.json`
- `assets/workspace/.nbook/agent/profiles/.system-profile-metadata.json`
- `assets/workspace/.nbook/agent/profiles/.compiled/manifest.json`
- `assets/workspace/.nbook/agent/profiles/builtin/leader.default.profile.tsx`
- `workspace/.nbook/agent/profiles/builtin/leader.default.profile.tsx`
- `assets/workspace/.nbook/agent/profiles/builtin/leader.assets.profile.tsx`
- `assets/workspace/.nbook/agent/profile-templates/basic-agent.profile-template.tsx`
- `assets/workspace/.nbook/agent/profile-templates/report-agent.profile-template.tsx`
- `app/components/profile-template-editor/**`
- `shared/dto/profile-template.dto.ts`
- `server/agent/profiles/profile-http-service.ts`
- `server/agent/profiles/workbench-service.ts`
- `server/agent/profiles/profile-dsl.test.ts`
- `server/agent/harness/neuro-agent-harness.test.ts`
- `server/agent/profiles/leader-assets-profile.test.ts`
- `server/agent/profiles/workbench-service.test.ts`
- `docs/modules/agent/harness.md`
- `docs/tasks/05-leader-profile-v2-adaptation/README.md`
- `docs/tasks/04-tsx-profile-workbench/README.md`
- `docs/tasks/02-pi-agent-harness-migration/README.md`
- `PROJECT-STATUS.md`

## Verification Plan

- `bunx vitest run server/agent/profiles/leader-assets-profile.test.ts server/agent/profiles/catalog.test.ts`
- `bunx vitest run server/agent/harness/neuro-agent-harness.test.ts`
- `bunx vitest run server/agent/profiles/workbench-service.test.ts`
- `bun scripts/prepare-system-profile-metadata.ts`
- `bun scripts/profile.ts check builtin/leader.default.profile.tsx --system`
- `bun scripts/profile.ts check builtin/leader.default.profile.tsx`（仅当同步用户覆盖）
- `rg -n "read_file|write_file|edit_file|execute_shell|create_subagent|invoke_subagent|list_subagents|task_create|task_set_status|execute_sql|get_plot_tree|get_story_thread|get_story_scene_context|get_chapter_plot" assets/workspace/.nbook/agent/profiles/builtin/leader.default.profile.tsx workspace/.nbook/agent/profiles/builtin/leader.default.profile.tsx server/agent/profiles/leader-assets-profile.test.ts`

## Verification Results

- `bunx vitest run server/agent/profiles/profile-dsl.test.ts server/agent/profiles/catalog.test.ts server/agent/profiles/leader-assets-profile.test.ts server/agent/profiles/workbench-service.test.ts` 通过，19 tests passed。
- `$env:DATABASE_URL='postgresql://user:pass@127.0.0.1:5432/neuro_book_test'; bunx vitest run server/agent/harness/neuro-agent-harness.test.ts` 通过，19 tests passed。
- `bun scripts/prepare-system-profile-metadata.ts` 通过，生成 2 个系统 profile metadata。
- `bun scripts/profile.ts check builtin/leader.default.profile.tsx --system` 通过。
- `bun scripts/profile.ts check builtin/leader.default.profile.tsx` 通过。
- 旧工具名搜索只命中 `server/agent/profiles/leader-assets-profile.test.ts` 中的 `not.toContain(...)` 断言，系统和用户 `leader.default.profile.tsx` 未命中旧工具名。
- `bun run typecheck` 仍失败，但本轮新增类型错误已修复；剩余为既有无关问题：
  - `app/components/novel-ide/NovelAgentDrawer.vue` 的 `modelKey`。
  - `NovelIdeAgentProfileDefaultSettingsPanel.vue` / `NovelIdeAgentProfileModelSettingsPanel.vue` 的 `defaultProfileKey` 可选性。
  - `app/pages/index.vue` 的 `workspaceKind` / `currentNovelId`。
- `bunx vitest run server/agent/profiles/leader-assets-profile.test.ts`：通过，5 tests passed。
- `bun scripts/prepare-system-profile-metadata.ts`：通过，生成 4 个系统 profile metadata，并刷新系统 `.compiled` artifact。
- `bun scripts/profile.ts check builtin/leader.assets.profile.tsx --system`：通过。
- `bun scripts/profile.ts status builtin/leader.assets.profile.tsx --system`：通过，`leader.assets` 为 `loaded`，artifact 为 `565a51165bf46b43d5405a53.mjs`。
- `bun scripts/profile.ts status --all --system`：通过，`leader.assets`、`leader.default`、`retrieval`、`writer` 均为 `loaded`。
- `bunx tsc --noEmit --pretty false --skipLibCheck`：失败在既有无关类型问题 `server/agent/harness/neuro-agent-harness.test.ts(425,46): Property 'reasoning' does not exist on type 'StreamOptions'`，未发现本次 `leader.assets` TSX DSL 迁移引入的类型错误。

## TODO / Follow-ups

- 后续如新增独立发版脚本，需要确认它同样先运行 `profile:metadata`，避免系统 profile metadata 漏更新。
- 记录后续方向：可以研究把 steer / follow-up 也交给 profile 管理，而不是继续全部由 harness 管理。
- 继续增强 TSX 可视化编辑器：复杂 `Watch.render`、跨函数 JSX 片段、TypeBox Schema Builder、allowedToolKeys checklist 和更完整的 AST round-trip。
- 旧 Plot / task / SQL 等工具以后单独迁移；本任务不恢复旧工具名，但 DSL 和 leader prompt 不应阻塞未来工具补回。
- `.compiled` profile 运行真相源已落地：`leader.default`、`leader.assets`、`writer`、`retrieval` 等系统 profile 的 compiled artifact 随 system assets 预编译并发布；用户覆盖只在 sync state 证明未手改时同步源码和 artifact。`leader.assets` 提示词和 `profile-system-guide` 已改为推荐 Workbench 编译或 `profile status/check/compile/preview`，不再推荐旧 `scripts/compile-profile.ts` / `scripts/check-profile.ts`。
