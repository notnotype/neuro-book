# Agent 上下文构成

## 基本概念

- memory / checkpoint：持久化消息树，允许 fork，用于恢复线程历史。
- history message：当前活动分支加载出的 `BaseMessage[]`。
- prompt message：本轮真正发送给模型的 `BaseMessage[]`。
- persisted message：`profile.prepare()` 要求 run 开始前写入产品历史的消息。
- scope：本轮 run 开始时的变量快照，不是响应式对象。

Profile `prepare()` 会读取 history 和变量快照，调用 profile 的 TSX `context()`，再把 `<ProfilePrompt>` 树拆成模型上下文、历史写入请求和 runtime state 更新。

## Prepare 生命周期

Profile `prepare(context)` 的核心顺序：

1. Harness 构造 `ProfilePrepareContext`，包含 session facade、profile initial、变量访问器、catalog 和 runtime 信息。
2. 执行 profile `context(ctx)`，要求返回 `<ProfilePrompt>` 根节点。
3. 编译 `System`、`HistorySet`、`ModelContext`、`AppendingSet`、`Compaction` 和 runtime state 写入。
4. Harness 把编译后的 `ProfileTurnPlan` 组合进本轮 provider prompt 和写入计划。

Harness 随后会先提交 profile 要求的历史写入，再调用模型：

- `systemPrompt` 是 profile system prompt。
- `historyInitMessages` 是缺少历史根前缀时写入历史根部的稳定上下文。
- `modelContextMessages` 是本轮只给模型看的上下文。
- `appendingMessages` 是贴近当前输入、会写入当前光标的上下文。
- `modelContextAppendingMessages` 是 `ModelContext` 中 `Reminder` / `Watch` 生成的本轮追加上下文；它按 AppendingSet 语义写入当前历史光标，但仍在语义上归属 ModelContext 动态节点。
- `turnContexts` 是 profile 显式声明、运行时按本轮外部数据物化的上下文计划，例如 `FileChangeNotice`；Harness 只负责通用物化、插入与成功交付结算。
- `stateWrites` 写 profile runtime state，例如 `Reminder` / `Watch` baseline。

## ProfilePrompt 拆分规则

当前 active DSL 要求 profile 返回：

```tsx
<ProfilePrompt>
    <System>...</System>
    <HistorySet>...</HistorySet>
    <ModelContext>...</ModelContext>
    <AppendingSet>...</AppendingSet>
</ProfilePrompt>
```

顶层推荐显式写出三类 set，但实际收集规则更细：

- `System` 只能放在 `ProfilePrompt` 顶层，可以出现多次，最终按顺序合并为 system prompt。
- `HistorySet`、`ModelContext`、`AppendingSet` 只能放在 `ProfilePrompt` 顶层。
- `Compaction` 只能放在 `ProfilePrompt` 顶层。
- 顶层裸 `<Message>` 等普通节点目前不作为 active DSL 的推荐写法；请放入明确 set。

因此完整模型消息顺序是：

```text
systemPrompt
-> history / historyInitMessages
-> modelContextMessages
-> appendingMessages
-> current user message
```

大多数 profile 按推荐结构书写时，可以简化理解为：

```text
System + HistorySet/history -> ModelContext -> AppendingSet -> CurrentUserInput
```

## HistorySet

`HistorySet` 用于长期稳定上下文，典型内容包括长期工具原则、稳定写作约束、共享规范和需要首轮持久化的 skill catalog。

关键规则：

- `HistorySet` 会被渲染成候选稳定前缀。
- 如果 session 已经有稳定历史前缀，runtime 不会每轮重复写入 `HistorySet`。
- 如果 session 缺少稳定历史前缀，`HistorySet` 渲染结果会进入模型上下文并写入历史根部。
- `SkillCatalog` 返回 string，必须包在 `<Message>` 内；需要首轮持久化时通常写成 `<Message><SkillCatalog /></Message>`。
- `Import` 返回 string，必须包在 `<Message>` 或 `<System>` 内；共享 reference 通常写成 `<HistorySet><Message><Import path="reference/..." /></Message></HistorySet>`。
- 不要把 `Watch` / `Reminder` 放进 `HistorySet`。

这意味着 `HistorySet` 是“首次注入稳定前缀”，不是每轮重新生成的 system prompt patch 机制。

## ModelContext

`ModelContext` 用于本轮临时上下文，只进入 provider prompt，不写入产品历史。

允许内容通常是普通 `<Message>`、`Reminder`、`Watch`、`If` / fragment 展开的普通消息。适合放当前线程摘要、只对本轮有意义的状态、临时工具说明等。

注意：

- `Reminder` / `Watch` 在 `ModelContext` 中生成的消息进入 `modelContextAppendingMessages`，不写入产品历史。
- 裸文本必须放在 `<Message>` 或其他 string-like 节点内。

`SkillCatalog` / `ActivatedSkills` 本身只是 string 片段，也必须放进 `<Message>` 内。需要持久化的 catalog 放 `HistorySet`；显式激活 skill 内容通常放 `AppendingSet`。

## AppendingSet

`AppendingSet` 是贴近当前输入的最新上下文区域。它产出的非空消息会进入 provider prompt，并写入当前历史光标。

推荐顺序：

```tsx
<AppendingSet>
    <Reminder id="workspace" watchPath="client.currentProjectWorkspace" repeatEveryTurns={5}>
        <Message>当前 workspace</Message>
    </Reminder>
    <Reminder id="plan-mode">
        <Message>本轮 Plan Mode reminder</Message>
    </Reminder>
    <Watch ... />
    <Message>
        <MentionedSkillsReminder />
    </Message>
</AppendingSet>
```

节点语义：

- `Reminder`：根据 `when`、`watchPath` / `watchValue`、函数 `watch` 和 `repeatEveryTurns` 判断是否注入。注入后会更新 profile runtime state。
- `Watch`：比较当前变量值与 profile runtime state baseline；变化时生成消息，并更新 watched baseline。
- `ActivatedSkills`：用户本轮显式输入 `$skill-name` 时，系统预加载对应 `SKILL.md` 后返回的文本片段。

`AppendingSet` 不接受非空裸文本；文本必须放在 `<Message>` 内。

当前用户输入不属于 `AppendingSet`。它由 Harness 作为独立 durable prompt 持久化，并在 provider 消息中保持为 `CurrentUserInput` 最后一段。Profile 不应把 `ctx.invocation.message` 再复制成 `<Message>`，否则同一用户要求会重复进入模型。

### FileChangeNotice

`FileChangeNotice` 是由 profile 控制的运行时上下文节点，只能作为 `AppendingSet` 的直接子节点：

```tsx
<AppendingSet>
    <FileChangeNotice mode={ctx.settings.fileChangeAwareness} />
    <ModeAvailabilityReminder />
</AppendingSet>
```

- `mode="off"` 不产生计划；`minimal` 只描述路径和条数；`full` 额外描述归因与操作类型。
- `<FileChangeNotice>` 只声明 awareness mode。每个文件最终 unified diff 的字符预算来自当前 Profile 的通用运行设置 `agent.profiles[profileKey].fileChangeNotice.diffMaxChars`，范围 0–8192，缺省 512（约 256 tokens）；0 表示不内联 diff。
- 系统整轮预算不可由 Profile 放宽：inline 总额为 `min(8192, diffMaxChars × 4)`，最多计算 4 个文件详情、逐项列出 50 个文件，最终 `<file-change-notice>` 不超过 12,288 字符。reference 只保留 hunk 位置、字符数和变更行统计，不保存 diff 正文；某段放不下时整段降级，不截断正文。
- 逐文件条目只陈述状态、路径、归因、位置与 diff 统计；完整读取、敏感路径限制和删除路径限制由 footer 按整批文件聚合，每类指导最多出现一次。Notice 不查询或推断 Inbox 状态。
- 敏感路径在读取 snapshot 正文前由服务端硬阻断：`.ssh/.aws/.azure/.kube/.docker/.gnupg`、所有 `.env` 变体与 `.envrc`、明确凭据文件、私钥名和 `.pem/.key/.p12/.pfx/.jks/.keystore`。策略不扫描内容，也不使用 `secret` 等宽泛子串；Profile 不能放宽，notice 不得出现正文或 diff。
- 敏感文件 footer 只说明正文与 diff 未进入 notice，并要求仅在当前任务确有需要时先征得用户同意；不承诺该路径存在于文件变更收件箱。
- 删除文件不生成可点击的当前文件引用。小型删除可内联 removed diff；超限或不可用时明确说明没有当前文件，并在进一步查看历史或恢复前询问用户；不承诺该路径存在于文件变更收件箱。
- Profile 未声明该节点时，即使 Project 存在 unseen 文件变更也不会注入提醒。
- Workbench dry-run 只显示占位消息，不读取真实 history。
- 真实运行只在 notice 进入模型且 turn ingest 成功后推进游标；失败时下轮仍会重现，保持 at-least-once。
- notice 正文使用英文 Git 风格状态：`added`、`modified`、`deleted`、`renamed`、`restored`、`reverted`；组合操作按净状态与历史分类，不用最后一条 edit 覆盖 create/rename 等主语义。

## Continue 模式

leader UI 主路径会先把本轮用户输入写入 history，再触发 run。

Runtime 对当前用户消息的处理：

- 如果历史尾部是当前用户消息，runtime 会把 `AppendingSet` 生成的消息插入到它之前。
- 当前用户消息保持为模型看到的最后一条。
- 显式 skill 激活会从当前用户输入文本中提取 `$skill`。

真实顺序：

```text
HistoryWithoutCurrentUserInput
-> ModelContext
-> AppendingSet
-> CurrentUserInput
```

## Watch 语义

`Watch` 在 `prepare()` 阶段执行，不是响应式订阅。

```tsx
<Watch
    path="client.currentProjectWorkspace"
    render={({previousValue, currentValue}) => {
        if (!currentValue) {
            return null;
        }
        return (
            <Message>
                {`当前小说 workspace 已设置为：${currentValue}`}
            </Message>
        );
    }}
/>
```

规则：

- `path` 必须以 `client`、`global`、`project` 或 `session` 变量路径开始。
- 当前值会写入 profile runtime state。
- fingerprint 相同不触发 render。
- 首次观察到非 `undefined` 的有效值会触发 render，`previousValue` 为 `undefined`。
- 首次观察到 `undefined` 只记录 baseline，不插入消息。
- `hasValue` 用于区分 `undefined` 与 `null`。

适合 watch 的变量：

- 当前章节标签。
- 当前选中资源。
- 需要作为长期历史事件保留的外部状态切换。

如果只是要靠近当前输入提醒模型，例如当前 Project Workspace，优先使用 `ProjectWorkspaceReminder()` 或 `Reminder watchPath="client.currentProjectWorkspace"`。

## 一轮请求示例

第一次请求，用户输入 `你好`：

```text
1. HistorySet
   - SystemMessage: 你是一个 Agent
   - SystemMessage: 可用 Skills
2. ModelContext
   - 本轮临时上下文
3. AppendingSet
   - Message: 当前 workspace reminder（写入历史）
4. CurrentUserInput
   - HumanMessage: 你好
```

第二次请求，历史尾部已存在用户输入 `当前是什么模式`：

```text
1. HistoryWithoutCurrentUserInput
   - 已持久化 system prompt
   - 已持久化 skill catalog
   - 上一轮 user / assistant 历史
2. ModelContext
   - 本轮临时上下文
3. AppendingSet
   - Message: Plan Mode reminder（插入到当前用户输入之前）
4. CurrentUserInput
   - HumanMessage: 当前是什么模式
```

## 相关实现

- `server/agent/profiles/profile-dsl.ts`：active Profile DSL 节点、编译和 `Import` 渲染。
- `server/agent/profiles/profile-dsl/jsx-runtime.ts`：TSX 自动运行时入口。
- `server/agent/profiles/prompt-order.ts`：统一组装 `History → ModelContext → AppendingSet → CurrentUserInput`。
- `server/agent/profiles/profile-turn-context.ts`：Profile 动态 turn context 的物化、插入和成功交付结算。
- `server/agent/profiles/profile-dsl.test.ts`：基础上下文顺序、节点位置和 string fragment 测试。
- `reference/agent/profile-import.md`：`Import` 节点规范。
