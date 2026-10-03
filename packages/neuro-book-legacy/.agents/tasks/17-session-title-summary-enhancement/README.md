# Session Title/Summary Enhancement

## User Request

- 检查 Agent session 是否已有 `title` / `summary` 字段，或相关替代字段。
- 设计并实现一个独立 summarizer profile，用 `report_result` 生成 session `title` / `summary`。
- 18 runtime pipeline hooks 已完成第一版，现在本任务重新按 18 的 Run Kernel / runtime hooks / SessionWritePlan 合同落地。

## Goal

- 任意 source profile 都可以声明启用 summarizer，不限定 leader。
- summarizer 是普通 profile，不是 Run Kernel 特例；用户也可以用自己的 `.profile.tsx` 实现同类 summarizer。
- summarizer 有隐藏 system session 身份，可拥有 HistorySet 初始化历史；但每次摘要运行中的 assistant/toolResult transcript 不写入 summarizer session。
- 每次摘要都从 source session 当前 active path 重建 Agent Dialogue Content，不维护 summarizer cursor，不做 summarizer 自身 compact。
- source session 的 `title` / `summary` 是 active-path-specific projection：rollback / tree 切换 / fork 后，展示元数据跟随当前 active path。
- 摘要失败、超限、过期结果都不影响 source invocation 的 completed / waiting / error 结果，只更新 summarizer 状态。

## Implementation Goal

这轮 17 重做完成时，要交付一个可以真实运行的 session title/summary summarizer 系统，而不是只保留设计草案：

- `summarizer` builtin profile 能被 profile catalog 加载，且只通过 `report_result` 输出 `{ title, summary }`。
- `defineAgentProfile({ summarizer })` 能让任意 source profile 启用摘要；`profileKey: "summarizer"` 时，`input` 类型自动适配 summarizer InputSchema，并由 harness 注入 `sourceSessionId`。
- source invocation `completed` 后，harness 会 fire-and-forget 触发 hidden system summarizer session；source 的 HTTP result、SSE terminal state 和后续操作不等待摘要完成。
- summarizer 每次运行都从 source session 当前 active path 重建 Agent Dialogue Content，并在 profile TSX `ModelContext` 中作为动态上下文注入；summarizer 自己的 assistant/toolResult transcript 不写入 session history。
- summarizer 成功后通过 `SessionWritePlan` 写回 source session 的 active-path-specific `title` / `summary` projection；写回前必须校验 source active leaf 未变化。
- summarizer running / dirty / error / lastRunAt / token 状态能通过 source session snapshot 投影给前端，且不生成 source ErrorBubble。
- 旧 `session.summarizer` profile key、旧 state key、旧 hard-coded 自动运行路径和旧 compiled artifact 被清理；开发版不做 alias 或 legacy 兼容。

验收标准：

- 后端 targeted tests 覆盖 profile key hard-cut、runtime-only transcript、source projection 写回、stale leaf guard、dirty/coalesced 调度和 Agent Dialogue Content 边界。
- 前端 targeted tests 覆盖 snapshot summarizer state 保留、session list 优先展示 summary、摘要错误低干扰展示。
- 18 相关 runtime 宽套件仍通过；`tsc` 如仍失败，只允许剩余既有无关错误，并在任务报告中明确标注。

## Target Outcome

完成后，项目应该得到这些行为：

- profile 作者可以在 `defineAgentProfile({ summarizer: ... })` 声明摘要 companion。
- builtin summarizer profile key 硬切为 `summarizer`；旧 `session.summarizer` 只作为历史实现清理对象，不做兼容 alias。
- summarizer profile 只允许 `report_result` 工具，`report_result.data` 必须符合 `{ title, summary }`。
- harness 在 source invocation 正常完成后触发后台摘要；第一版不在 waiting / error / aborted 后触发。
- summarizer 运行使用普通 Run Kernel，但通过 profile TSX + runtime hooks 组合实现：
  - `context(ctx)` / `prepare(ctx)` 在 prepareRun 阶段构造 Agent Dialogue Content，并放入 `ModelContext`。
  - `ingestTurn` 返回 `transcript: "runtime_only"`。
  - `settleRun` 读取 `reportResult`，校验 source active leaf 仍匹配，然后用 `SessionWritePlan` 写 source projection。
- 同一个 source session 的摘要调度采用 latest-only / coalesced 语义：运行中又触发时只标 dirty，当前结束后按最新 active path 再跑一次。
- 前端通过 snapshot 看到 summarizer 状态：running / dirty / lastRunAt / lastError / lastDialogueContentTokens。

非目标：

- 第一版不支持 Turn Transaction 中途触发摘要。
- 第一版不把 tool call、tool result、thinking、harness reminder 纳入 Agent Dialogue Content。
- 第一版不做 server restart 后自动恢复正在运行的 summarizer job。
- 第一版不把 summarizer 做成 sessionless 执行体。

## Baseline After 18

- `SessionMetadata` 已有 `title?: string` / `summary?: string`。
- `SessionUpdateEntry` 已支持 append-only 写入 `updates.title` / `updates.summary`。
- `AgentSessionSummaryDto` 和 snapshot 已暴露 `title` / `summary`。
- `SessionSummarizerStateDto` 已作为前端投影类型存在。
- 18 已提供 summarizer 所需的 runtime 基础能力：
  - `runtime: { hooks }`。
  - `ctx.input` 类型推导。
  - `ctx.session.read(sessionId?)`。
  - `ctx.session.agentDialogueContent()`。
  - `runtimeMessages`。
  - `ingestTurn.transcript = "runtime_only"`。
  - `settleRun` 读取 `reportResult` 并返回 `SessionWritePlan`。
  - `SessionWritePlan` ordered ops 和 projection append。
- 旧 hard-coded summarizer 自动运行路径已从 active harness 删除。
- 实现前代码里仍残留旧 `session.summarizer` profile、contract、compiled artifact、状态 key、测试和 DTO 命名；本任务按开发版原则硬切清理。
- 实现前 `ProfilePrepareContext.session` 还是 reduce 后的当前 session context，没有 `read()` / `agentDialogueContent()` helper；本任务需要把 runtime hook 的只读 session facade 能力扩展到 profile prepare ctx，支持 TSX `ModelContext` 直接读取 source session。

## New Design

### Profile Declaration

source profile 通过顶层 `summarizer` 字段声明 companion：

```ts
export default defineAgentProfile({
    manifest: {
        key: "leader.default",
        name: "Leader",
    },
    inputSchema: LeaderDefaultInputSchema,
    allowedToolKeys: [...],
    summarizer: {
        profileKey: "summarizer",
        input: {
            trigger: "afterInvocation",
            interval: {
                kind: "sourceInvocation",
                value: 1,
            },
            maxDialogueContentTokens: 80000,
        },
    },
    runtime: agentRuntimeBuiltins.defaultSessionRuntime(),
    context(ctx) {
        // normal profile prompt
    },
});
```

约束：

- `summarizer.enabled === false` 表示显式关闭。
- `sourceSessionId` 由 harness 创建 summarizer session 时注入，profile 作者不填写。
- `profileKey: "summarizer"` 时，`input` 类型应自动收窄为 `Omit<SessionSummarizerInput, "sourceSessionId">`。
- summarizer session 不进入 linked-agent 关系，不写 `agent.link.*`。
- summarizer 模型选择走普通 profile 配置，不跟随 source profile。

### Summarizer Profile

builtin `summarizer` profile 是普通 profile：

- `manifest.key = "summarizer"`。
- `allowedToolKeys = ["report_result"]`。
- `InputSchema` 只承载初始化参数和调度参数，不承载每轮 source 文本。
- `OutputSchema` 用于 `report_result.data`，字段为 `{ title, summary }`。
- `HistorySet` 可用于初始化角色/格式要求。
- `AppendingSet` 为空；每轮 source 内容在 profile prepare 阶段写进 `ModelContext`，不通过 `runtimeMessages` 追加。

建议 schema：

```ts
type SessionSummarizerInput = {
    sourceSessionId: number;
    trigger?: "afterInvocation";
    interval?: {
        kind: "sourceInvocation" | "dialogueContentTokens";
        value: number;
    };
    maxDialogueContentTokens?: number;
};

type SessionSummarizerOutput = {
    title: string;
    summary: string;
};
```

### ModelContext And Runtime Shape

`ModelContext` 这个名字继续保留，但文档中固定它的含义：

> `ModelContext` 是本轮模型可见、不写入 session history 的动态上下文；它不是 provider 请求的全部上下文容器。

这里的重点是“动态”和“不持久化”。

- `HistorySet` 更像 profile 初始化时写进 session 的稳定背景。
- `AppendingSet` 更像 profile 在本轮追加到会话语境中的补充内容。
- `ModelContext` 则是每一次 prepareRun 时临时计算出来、只给本轮模型看的上下文。

因此 `ModelContext` 这个名字可以继续用。它虽然不是完整 provider context，但在 profile TSX 作者视角里足够直观：这里放“这轮模型应该额外看到的材料”。后续如果要避免误解，可以在文档和类型注释里称它为 dynamic model context，而不是改掉 JSX 标签名。

这里有一个重要边界：profile 作者写的 `context(ctx)` / `prepare(ctx)` 属于 Run Kernel 的 `prepareRun` 阶段。也就是说，`ModelContext` 里的内容是在一次 invocation 启动时构造出来的本轮动态上下文，不是每个 ReAct turn 都会重新计算的订阅式上下文。

summarizer 的 source Agent Dialogue Content 应该在 profile TSX 的 `context(ctx)` / `prepare(ctx)` 阶段构造，并放入 `ModelContext`：

```tsx
context(ctx) {
    const dialogue = await ctx.session.agentDialogueContent({
        sessionId: ctx.input.sourceSessionId,
        input: ctx.input,
    });

    return (
        <ProfilePrompt>
            <System>你负责生成当前会话标题和摘要。</System>
            <HistorySet>
                <Message>只使用 report_result 返回结果，不要输出普通闲聊。</Message>
            </HistorySet>
            <ModelContext>
                <Message>{dialogue.text}</Message>
            </ModelContext>
        </ProfilePrompt>
    );
}
```

因此，本任务需要把 `ctx.session.read()` / `ctx.session.agentDialogueContent()` 暴露到 `ProfilePrepareContext`，让 profile 作者不必写 runtime hook 才能读取 source session。

这也意味着 source 内容只在 prepareRun 注入一次：

- summarizer invocation 启动后，prepareRun 执行 profile TSX，读取 source session 当前 active path。
- 这一次构造出的 Agent Dialogue Content 进入 `ModelContext`。
- 同一次 summarizer run 内，如果因为缺失 `report_result` 触发 reminder retry，不重新读取 source，也不把全文再次塞进下一轮。
- 如果 source 后续又变化，由 scheduler 在下一次 summarizer invocation 重新触发，而不是在当前 run 里动态漂移。

这样 profile 作者能在 TSX 模板里直接写“我要读取哪个 source session，并把它转成 ModelContext”，而 Run Kernel 不需要知道 summarizer 的业务含义。

如果未来 summarizer 需要多 turn、并且确实需要每个 turn 都重新读取 source session，应作为新的 runtime hook 行为设计；第一版不做。第一版的选择是更可预测的：一次 summarizer invocation 读取一次 source active path，后续 source 变化交给 scheduler 触发下一次 invocation。

### Runtime Hook Shape

第一版可以先给 profile 作者暴露足够的 public helper：

- `agentRuntimeBuiltins.profilePrompt()`
- `agentRuntimeBuiltins.sessionContext()`
- `agentRuntimeBuiltins.reportResult()`
- `agentRuntimeBuiltins.runtimeOnlyTranscript()`

如果不新增这些 helper，也可以先在 builtin summarizer profile 内显式声明 hook；但文档和 profile 示例不能使用当前代码没有的 public API。

summarizer runtime 组合：

- 组合 `profilePrompt`，让 `<System>` 进入 provider system prompt。
- 组合 `sessionContext`，让 `HistorySet` 初始化和 `ModelContext` 参与本轮模型上下文。
- 组合 `reportResult`，让缺失 `report_result` 时进入同一 RunFrame 的 reminder retry。
- 组合 `runtimeOnlyTranscript`，让 assistant/toolResult 不写入 summarizer session history。
- 不组合 `transcriptPersistence`，避免 summarizer 的 assistant/toolResult transcript 落盘。
- 不组合 `compact`，summarizer 不做自身 compact。

这几个名字的职责要分清：

- `sessionContext` 管“模型运行前”：profile 的 `HistorySet` / `ModelContext` / `AppendingSet` 是否进入默认 session/model context 机制。
- `transcriptPersistence` 管“模型运行后”：assistant/toolResult transcript 是否写入 session history。
- summarizer 需要前者，不需要后者。

更具体地说：

- `sessionContext` 是“把 profile 准备好的上下文喂给模型”的能力。没有它，`ProfilePrompt` 里构造出来的 `HistorySet` / `ModelContext` 不会按普通 session 语义参与本轮 provider input。
- `transcriptPersistence` 是“把模型这一轮真的说了什么、调用了什么工具、工具返回了什么，写回 session history”的能力。普通聊天 profile 需要它，因为聊天记录要留档；summarizer 不需要它，因为摘要结果已经通过 `report_result` 和 `settleRun` 写回 source session。
- `runtimeOnlyTranscript` 不是“不让模型运行”，而是“允许这一轮内部产生 assistant/tool/toolResult 消息，用来完成 ReAct loop，但这些消息只活在当前 RunFrame 里”。所以 report_result 缺失时 reminder 还能继续工作，但 summarizer session 历史不会被这些 retry 污染。

用人话说：`sessionContext` 负责“开场前把材料摆上桌”，`transcriptPersistence` 负责“散场后把聊天记录归档”。summarizer 要摆材料，但不要归档它自己的中间聊天记录。

对 summarizer 来说，这三个能力组合起来形成一个清晰的 session 模型：

- summarizer 仍然有自己的 session，因此可以像普通 profile 一样拥有 `HistorySet` 初始化历史、model config 和 profile input。
- summarizer 的 `HistorySet` 只在 session 初始化时写入一次，用来保存角色、格式、输出约束这类稳定说明。
- 每次 summarizer invocation 的 source 内容都通过 `ModelContext` 临时进入模型输入，不写入 summarizer session。
- summarizer invocation 中产生的 assistant/tool call/tool result 只存在于当前 RunFrame，用 `runtimeOnlyTranscript` 保持 ReAct 内部闭环，不通过 `transcriptPersistence` 落盘。
- summarizer 不组合 `compact`，因为它自己的 transcript 不增长；真正可能变长的是 source session，而 source session 已经由自己的 compact 机制处理。summarizer 只读取 source active path 上已经压缩后的 Agent Dialogue Content。

因此，summarizer 不是特殊的 sessionless 执行体；它是一个“有初始化 session、没有运行 transcript 持久化”的普通 profile。这个取舍能让 profile 作者继续使用熟悉的 `defineAgentProfile` / `ProfilePrompt` / runtime hooks，同时避免后台摘要把自己的内部过程写成一条越来越长的历史线。

summarizer 运行行为：

1. scheduler preflight
   - 读取 source snapshot。
   - 构造 Agent Dialogue Content，估算 token。
   - 若超过 `maxDialogueContentTokens`，直接写 source `summarizer.state.lastError`，不启动 summarizer run。
   - 否则把本次 `sourceLeafId`、`dialogueContentFingerprint`、`dialogueContentTokens` 写入 source `summarizer.state.running`，再启动 hidden summarizer run。

2. profile prepare / `ModelContext`
   - summarizer profile 在 `context(ctx)` / `prepare(ctx)` 中读取 source Agent Dialogue Content。
   - 将 dialogue text 放入 `ModelContext`。
   - source 内容只在 prepareRun 注入一次；`prepareNextTurn` 不重新注入 source，避免 report_result retry 时重复塞全文。

3. `ingestTurn`
   - 返回 `{ transcript: "runtime_only" }`。
   - assistant/toolResult 只闭合当前 RunFrame，不写 summarizer session history。
   - `report_result` 缺失 reminder 也必须保持 runtime-only。

4. `settleRun`
   - 读取 `ctx.runResult.reportResult.data`。
   - trim 并校验 title / summary 非空和长度。
   - 重新读取 source session 和 `summarizer.state.running.sourceLeafId`，确认 current active leaf 仍匹配。
   - 若 leaf 不匹配，只写 `summarizer.state.dirty = true`，不覆盖旧 title/summary。
   - 若匹配，写 source projection：
     - `session_update { title, summary }`
     - `custom summarizer.state { running:false, dirty: previousDirty, lastRunAt, lastDialogueContentTokens, lastDialogueContentFingerprint }`
   - `previousDirty` 用于 coalesced 调度：如果当前 summarizer run 期间 source session 又完成了新的 invocation，就保留 `dirty:true`，让 scheduler 在当前 run 结束后按最新 active path 再跑一次；否则为 `false`。

### Agent Dialogue Content

Agent Dialogue Content 是 summarizer 的唯一 source 文本。

第一版包含：

- active path 上的普通 user message 可见正文。
- active path 上的普通 assistant message 可见正文。
- active path 上的 compaction summary message。

第一版排除：

- tool call 参数。
- tool result。
- thinking / reasoning。
- harness reminder。
- profile `HistorySet` / `ModelContext` 注入消息。
- custom message / custom state。
- summarizer 自身 transcript。

如果后续发现 Agent Dialogue Content 不够用，再扩展 helper；不要在 summarizer profile 里临时拼 raw session entry。

### Scheduler

summarizer 调度属于 Harness / Coordinator 周边服务，不进入 Run Kernel 核心对象。

触发规则：

- source invocation `completed` 后检查 summarizer。
- 第一版不在 `waiting`、`error`、`aborted` 后触发。
- 第一版不在每个 Turn Transaction 后触发；`sourceTurn` 只作为 future note，不进入可运行 schema。

运行规则：

- 每个 source session 同时最多一个 summarizer run。
- 运行中再次触发，只写 `summarizer.state.dirty = true`。
- 当前 run 完成后，如果 dirty 仍为 true，按最新 source active path 再触发一次。
- summarizer fire-and-forget，不阻塞 source invocation HTTP response。
- summarizer 错误只写 source `summarizer.state.lastError`，不反写 source invocation lifecycle。

### State

状态真相源写在 source session projection custom state：

```ts
type SummarizerState = {
    running?: boolean;
    dirty?: boolean;
    profileKey?: string;
    sessionId?: number;
    sourceLeafId?: string | null;
    lastRunAt?: number;
    lastError?: string;
    lastDialogueContentTokens?: number;
    lastDialogueContentFingerprint?: string;
};
```

key 硬切为 `summarizer.state`。

旧 `session.summarizer.state` 不做兼容读取；开发期旧 session 可以丢弃。

### Projection

title / summary 写回 source session 时必须是 active-path-specific projection。

第一版需要补足 projection scope：

- projection entry 不进入 tree，不移动 active leaf。
- projection 必须绑定 source active leaf。
- reduce session summary 时，只应用与当前 active leaf 匹配的 title/summary projection。
- active path 没有匹配 projection 时 fallback 到默认 title / last message preview。

如果当前 `SessionWritePlan` 的 `append + projection: true` 还没有 scope 字段，本任务需要扩展最小 scope：

```ts
projection?: true | {
    scope: "activeLeaf";
    leafId: SessionEntryId | null;
};
```

也可以先把 scope 存进 entry metadata，但不建议再做临时 custom state 拼接；title/summary 应继续走 `session_update` reduce 路径。

写回前仍必须做 stale leaf guard：

- summarizer 启动时记录 source active leaf。
- `settleRun` 写回前重新读取 source active leaf。
- leaf 不一致时，第一版只写 `summarizer.state.dirty = true`，不写 title/summary projection。
- 后续如果要保留旧 branch 的摘要，可以允许写旧 leaf scoped projection，同时 dirty 当前 leaf；第一版先不做。

## Implementation Plan

### Phase 1: Hard-Cut Contract Cleanup

- 将 builtin profile key 从 `session.summarizer` 改为 `summarizer`。
- 将 schema / contract 命名从 `SessionSummarizer*` 视情况保留为类型名，但描述和 KnownProfileInputs key 改为 `"summarizer"`。
- 将 `SESSION_SUMMARIZER_STATE_KEY` 的值改为 `summarizer.state`。
- 清理或替换旧 compiled artifact：`builtin__session.summarizer.mjs`。
- leader 默认 profile 的 `summarizer.profileKey` 改为 `"summarizer"`。
- 将 runtime hook 的只读 session facade 能力扩展到 `ProfilePrepareContext`，至少提供 `ctx.session.read()` 和 `ctx.session.agentDialogueContent()`。

验证：

- profile catalog 能加载 `summarizer`。
- `profileKey: "summarizer"` 时 summarizer input 有类型适配。
- 旧 `session.summarizer` 不再作为 runnable builtin profile 出现。

### Phase 2: Summarizer Runtime Profile

- 实现 builtin `summarizer.profile.tsx`。
- 只允许 `report_result`。
- 在 TSX `ModelContext` 中注入 source Agent Dialogue Content。
- runtime 组合 `profilePrompt` / `sessionContext` / `reportResult` / `runtimeOnlyTranscript`，不组合 `transcriptPersistence` / `compact`。
- `ingestTurn` 使用 `runtime_only`。
- `settleRun` 通过 `SessionWritePlan` 写 source projection。

验证：

- summarizer session 运行后自身 session history 只包含初始化历史，不包含 assistant/toolResult transcript。
- `report_result.data` 成功写回 source title/summary。
- 缺失 `report_result` 时 reminder 不写 summarizer session history。

### Phase 3: Source Profile Declaration + Scheduler

- 保留并收紧 `defineAgentProfile.summarizer` 校验。
- harness 在 source invocation completed 后触发 summarizer。
- harness 直接创建 hidden system summarizer session，不走 linked-agent。
- 实现 latest-only/coalesced 状态机。

验证：

- 任意启用 summarizer 的 profile 完成 invocation 后触发摘要。
- running 时重复触发只标 dirty，不创建重复 session。
- dirty run 完成后按最新 active path 再跑一次。
- waiting/error/aborted 不触发摘要。
- 超过 `maxDialogueContentTokens` 时 scheduler preflight 直接跳过 run，只写 summarizer 状态。

### Phase 4: Active-Path Projection

- 为 projection write 增加 active leaf scope。
- title/summary reduce 只应用当前 active leaf 对应 projection。
- tree move / rollback / fork 后 title/summary 跟随 active path。
- `projection` 类型使用 `true | { scope: "activeLeaf"; leafId }`，避免破坏现有普通 projection 调用。

验证：

- stale summarizer 结果不会覆盖新 active leaf。
- tree 切换后展示对应 path 的 title/summary。
- source active leaf 为空时 projection 行为明确：只能绑定 `null`，且只在 empty path 生效。

### Phase 5: UI State

- snapshot 继续暴露 `summarizer?: AgentSessionSummarizerStateDto`。
- 前端抽屉头部低噪声显示 running / dirty / lastError。
- session list 描述优先显示 `summary`，没有则 fallback 到 last message preview。

验证：

- `session_state_changed.snapshot.summarizer.running` 可见。
- 摘要失败只显示 summarizer warning，不产生 source ErrorBubble。
- 新 prompt / retry 后旧 summarizer error 状态按状态机清理或覆盖。

## Files To Update

- `assets/workspace/.nbook/agent/profiles/builtin/session.summarizer.profile.tsx` -> `summarizer.profile.tsx`
- `assets/workspace/.nbook/agent/profiles/builtin/leader.default.profile.tsx`
- `assets/workspace/.nbook/agent/profiles/builtin/leader.assets.profile.tsx`
- `assets/workspace/.nbook/agent/profiles/.compiled/*`
- `assets/workspace/.nbook/agent/profiles/.system-profile-metadata.json`
- `server/agent/profiles/builtin-contracts.ts`
- `server/agent/profiles/default-profile.ts`
- `server/agent/profiles/define-agent-profile.ts`
- `server/agent/profiles/summarizer-profile.ts`
- `server/agent/profiles/types.ts`
- `server/agent/session/dialogue-content.ts`
- `server/agent/session/dialogue-content.test.ts`
- `server/agent/session/custom-state-keys.ts`
- `server/agent/session/session-repo.ts`
- `server/agent/session/session-repo.test.ts`
- `server/agent/session/types.ts`
- `server/agent/session/write-plan.ts`
- `server/agent/harness/neuro-agent-harness.ts`
- `server/agent/harness/neuro-agent-harness.test.ts`
- `shared/dto/agent-session.dto.ts`
- `app/components/novel-ide/NovelAgentDrawer.vue`
- `app/components/novel-ide/agent/AgentSessionDialog.vue`
- `app/components/novel-ide/agent/useAgentSession.test.ts`
- `docs/tasks/17-session-title-summary-enhancement/README.md`
- `PROJECT-STATUS.md`

## Verification Plan

- `bunx vitest run server/agent/session/dialogue-content.test.ts server/agent/session/session-repo.test.ts --reporter=dot`
- `bunx vitest run server/agent/profiles/define-agent-runtime.test.ts server/agent/profiles/catalog.test.ts --reporter=dot`
- `bunx vitest run server/agent/harness/neuro-agent-harness.test.ts -t "summarizer|summary|title" --reporter=dot`
- `bunx vitest run app/components/novel-ide/agent/useAgentSession.test.ts app/components/novel-ide/agent/agent-message.test.ts app/utils/agent-message-projection.test.ts --reporter=dot`
- `bun scripts/profile.ts compile --all --system`
- `bun scripts/profile.ts compile --all`
- `bunx tsc --noEmit --pretty false`

当前已知：`tsc` 可能仍因既有 `server/agent/skills/silly-tavern-card-cli.test.ts` marker optional 错误失败；本任务只在不扩大 scope 时报告它。

## Implementation Result

- 已硬切 builtin profile key 为 `summarizer`，旧 `session.summarizer` 源文件和 compiled artifact 已删除，不做 alias。
- `leader.default` / `leader.assets` 已声明 `summarizer: { profileKey: "summarizer" }`；其他 profile 也可以用同一声明启用。
- builtin `summarizer.profile.tsx` 只允许 `report_result`，在 `ModelContext` 中读取 source session 的 Agent Dialogue Content，并通过 `runtimeOnlyTranscript` 避免自身 assistant/toolResult transcript 落盘。
- harness 在 source invocation completed 后后台调度 summarizer；测试环境可以显式关闭后台调度，生产默认开启。
- summarizer 调度实现为 per-source-session coalesced job：运行中再次触发只标 dirty，当前任务结束后按最新 source active path 再判断是否重跑。
- source `title` / `summary` 写回使用 active-leaf scoped projection；stale leaf guard 失败时只写 `summarizer.state.dirty`，不覆盖当前 active path 标题/摘要。
- source snapshot 继续投影 `summarizer` 状态，前端抽屉显示低噪声状态 chip，session 列表预览优先使用 `summary`。
- review 后修复三处边界：
  - `sourceInvocation.value` 现在按 source prompt turn 计数生效，第一次成功摘要后才进入间隔判断。
  - summarizer 运行失败不会把本次 fingerprint 记为成功 fingerprint，同一份 Agent Dialogue Content 可以被后续调度重试。
  - projection entry 不再出现在 session tree 视图里，也不参与 tree `childCount` / `terminal` 计算。

实际偏差：

- 第一版没有实现手动 `summarize` command。旧 command 是 no-op，已删除，当前入口只保留 source invocation completed 后自动调度。
- summarizer 后台任务默认 fire-and-forget，但 harness 暴露 `drainBackgroundTasks()` / `drainSessionSummarizer()` 供测试和关闭流程等待后台安静。

验证结果：

- `bunx vitest run server/agent/harness/neuro-agent-harness.test.ts --reporter=dot`：74 passed。
- `bunx vitest run server/agent/profiles/define-agent-runtime.test.ts server/agent/session/write-plan.test.ts server/agent/session/session-repo.test.ts server/agent/session/dialogue-content.test.ts server/agent/profiles/catalog.test.ts server/agent/profiles/profile-dsl.test.ts server/agent/profiles/leader-assets-profile.test.ts app/components/novel-ide/agent/useAgentSession.test.ts app/components/novel-ide/agent/agent-message.test.ts app/utils/agent-message-projection.test.ts --reporter=dot`：10 files / 103 tests passed。
- review 修复后追加验证：`bunx vitest run server/agent/session/session-repo.test.ts server/agent/harness/neuro-agent-harness.test.ts --reporter=dot`：2 files / 84 tests passed。
- follow-up 修复后追加验证：`bunx vitest run server/agent/session/session-repo.test.ts server/agent/harness/neuro-agent-harness.test.ts -t "summarizer|active leaf scoped projection" --reporter=dot`：2 files / 7 tests passed。
- follow-up 修复后追加验证：`bunx vitest run server/agent/session/session-repo.test.ts --reporter=dot`：1 file / 9 tests passed。
- `bun scripts/profile.ts compile --all --system`、`bun scripts/profile.ts compile --all`：均生成 `summarizer` artifact。
- `bun scripts/profile.ts status summarizer`、`bun scripts/profile.ts status summarizer --system`：均为 loaded。
- `bunx tsc --noEmit --pretty false --incremental false`：仍失败于既有 `server/agent/skills/silly-tavern-card-cli.test.ts` marker optional 错误，未命中本任务路径。

## Walkthrough

- 2026-05-27：检查 session/profile/harness 现状，确认 `title` / `summary` 字段已存在，但默认仍主要由程序生成。
- 2026-05-27：实现过第一版 `session.summarizer`、Agent Dialogue Content、后台 system session、summary 状态投影和前端展示；该实现现在作为历史参考，不再作为目标合同。
- 2026-05-28：设计推进后确认 17 等待 18 runtime pipeline hooks 完成后重新计划。
- 2026-05-28：确认 summarizer 不限定 leader，所有 profile 都可以通过声明式 `summarizer` 启用。
- 2026-05-28：确认 summarizer source 内容第一版继续使用 Agent Dialogue Content；`title` / `summary` 是 active-path-specific，会随 session active path 回退、切换、fork 一起变化。
- 2026-05-28：确认 summarizer 不保存自身工具调用、tool result 或 assistant transcript；每次模型上下文都从 source session 重新构建，并间接复用 source session compaction。
- 2026-05-28：确认 summarizer 不作为 Run Kernel 特例；profile 作者可以通过 `runtime: { hooks }` 写出 summarizer 行为。
- 2026-05-29：18 runtime pipeline hooks 第一版完成，提供 `runtime_only` transcript、runtimeMessages、settleRun writePlans、ctx.session facade 和 SessionWriteExecutor。
- 2026-05-29：重写 17 任务文档。17 新计划以 18 的 runtime hooks 为基础，硬切 `summarizer` profile key，清理旧 `session.summarizer`，并把实现分为 contract cleanup、runtime profile、scheduler、active-path projection 和 UI state 五个阶段。
- 2026-05-29：确认 source Agent Dialogue Content 只在 prepareRun 注入一次；`ModelContext` 固定为本轮动态、不持久化上下文；`sessionContext`、`transcriptPersistence`、`runtimeOnlyTranscript` 的职责边界写入任务文档。
- 2026-05-29：实现 17 新版 summarizer：新增 `summarizer` builtin profile、runtime-only transcript、source Agent Dialogue Content 注入、后台 coalesced scheduler、active-leaf scoped title/summary projection、summarizer 状态投影和前端低噪声展示；补充 targeted tests 并重新编译 system/user profile artifacts。
- 2026-05-29：根据代码审查修复 summarizer 调度和 projection tree 边界：`sourceInvocation.value` 按 source prompt turn 间隔生效，失败后同内容可重试，projection entry 从 session tree 视图过滤。
- 2026-05-30：修复后续普通请求会让已生成摘要消失的问题。根因是 active-leaf scoped projection 只在当前 leaf 等于绑定 leaf 时生效；继续对话后绑定 leaf 仍在 active path 上，但 active leaf 已变成新消息，导致 title/summary fallback 到默认值。现在 projection 在绑定 leaf 仍处于当前 active path 上时继续生效，rollback 到绑定点之前或切到其他分支时仍失效。

## Historical Artifacts

这些内容是旧实现留下的参考，不代表新目标合同：

- `session.summarizer` profile key。
- `session.summarizer.state` custom state key。
- hard-coded summarizer 自动运行路径。
- invocation-level `profile.ingest()`。
- append-only summarizer transcript。
- 旧验证记录中针对 `session.summarizer` 的测试命名。

实现时可以直接硬切、硬删，不需要 legacy 兼容。
