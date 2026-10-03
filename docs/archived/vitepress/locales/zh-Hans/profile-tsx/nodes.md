# 节点说明

Profile TSX 节点会被编译成 `ProfileTurnPlan`。不同节点进入不同上下文区域，因此不要把所有内容都塞进 system prompt。

## ProfilePrompt

`ProfilePrompt` 是根节点。顶层推荐只放：

- `System`
- `HistorySet`
- `ModelContext`
- `AppendingSet`
- `If`
- `Fragment`

不要在根节点下放非空裸文本。

::: tip 压缩策略不是节点
压缩（compaction）与摘要策略写在 `defineAgentProfile({runtimeDefaults: {...}})` 里，不是 TSX 节点。运行时最终值还会叠加 Global / Project 的配置，见 [Profile 介绍](/profile/)。
:::

## System

`System` 定义 profile 的长期身份、任务边界和工具原则。

适合放：

- profile 是谁。
- profile 不应该做什么。
- 工具和输出边界。
- 长期协作规则。

不适合放当前 Project Workspace、当前选中文件、本轮任务摘要或大段共享协议。共享协议优先放进 `reference/`，再用 `Import`。

## HistorySet

`HistorySet` 是稳定历史前缀。session 缺少前缀时写入，已有前缀时不每轮重复。

适合放：

- `AgentCatalog`：可创建 / 可调用的 linked agent 清单
- `SkillCatalog`：可用 Skill 清单
- `WorkflowCatalog`：可用 Workflow 清单
- `<Import path="reference/..." />`
- 稳定共享规范

`Import`、`SkillCatalog`、`AgentCatalog`、`WorkflowCatalog` 都是 string fragment，必须包在 `Message` 或 `System` 这类 string 容器里。

## ModelContext

`ModelContext` 只进入本轮模型上下文，不写入产品历史。

适合放：

- `SqlSchemaSummary`：当前 Project SQLite 的结构摘要
- `LinkedAgentsSummary`：当前 linked agent 状态
- 本轮临时摘要
- 不应持久化的 `Reminder` / `Watch`

判据是"这段内容下一轮还成立吗"：成立的进 `HistorySet` 写一次，不成立的进 `ModelContext` 每轮重算。

## AppendingSet

`AppendingSet` 产出的非空消息会贴近当前用户输入，并写入当前历史光标。

适合放：

- `WorkspaceFocusReminder`
- `ModeAvailabilityReminder`
- `ModeReminder`
- `LinkedAgentsReminder`
- `TaskReminder`
- `MentionedSkillsReminder`
- `ActivatedSkills`
- `FileChangeNotice`：把本轮外部文件变更以 Git 风格 notice 注入，`mode` 取自 profile settings
- `ModeSlot`：按当前 Agent 模式（normal / discuss / plan）替换文案的插槽

`AppendingSet` 也不接受非空裸文本，文本要放在 `Message` 内。

## 完整节点表

DSL 的可用节点是**穷举**的——写了表外的名字会直接抛「未知 Profile DSL JSX 节点」，编译不过。当前全部 28 个：

| 分类 | 节点 |
| --- | --- |
| 结构 | `ProfilePrompt`、`System`、`HistorySet`、`ModelContext`、`AppendingSet` |
| 消息 | `Message`、`AIMessage`、`ToolCall`、`ToolResult` |
| 控制 | `If`、`Watch`、`Import` |
| 清单 | `AgentCatalog`、`SkillCatalog`、`WorkflowCatalog`、`LinkedAgentsSummary`、`SqlSchemaSummary` |
| 提醒 | `Reminder`、`SystemReminder`、`WorkspaceFocusReminder`、`LinkedAgentsReminder`、`TaskReminder`、`MentionedSkillsReminder`、`ActivatedSkills`、`FileChangeNotice` |
| 模式 | `ModeReminder`、`ModeAvailabilityReminder`、`ModeSlot` |

模式相关三个节点的语义见 [Agent 模式](/agent/modes)。

## Import

`Import` 用于导入共享文本文件：

```tsx
<HistorySet>
    <Message>
        <Import path="reference/agent/project-workspace-guide.md" />
    </Message>
</HistorySet>
```

V1 允许路径：

- `AGENTS.md`
- `reference/**`
- `docs/**`

缺失文件默认返回空字符串；`required={true}` 时缺失会报错。渲染结果是 Markdown fenced block。

## Reminder 和 Watch

`Reminder` 用于按条件注入提醒；`Watch` 用于观察变量变化并在变化时写入消息。

它们适合放在 `ModelContext` 或 `AppendingSet`，不要放入 `HistorySet`。

## 继续阅读

- [Profile Import Reference](https://github.com/notnotype/neuro-book/blob/master/packages/neuro-book/assets/reference/agent/profile-import.md)
- [Agent 上下文构成](https://github.com/notnotype/neuro-book/blob/master/packages/neuro-book/assets/reference/agent/context.md)
