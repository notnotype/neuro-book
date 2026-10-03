# Node Reference

Profile TSX nodes compile into a `ProfileTurnPlan`. Different nodes land in different context regions, which is why you should not stuff everything into the system prompt.

## ProfilePrompt

`ProfilePrompt` is the root node. At the top level, keep it to:

- `System`
- `HistorySet`
- `ModelContext`
- `AppendingSet`
- `If`
- `Fragment`

Do not put non-empty bare text directly under the root node.

::: tip Compaction policy is not a node
Compaction and summarization policy go in `defineAgentProfile({runtimeDefaults: {...}})`, not in a TSX node. The final runtime value also layers Global and Project configuration on top — see [What Is a Profile](/en/profile/).
:::

## System

`System` defines the profile's long-term identity, task boundaries and tool principles.

Good candidates:

- Who the profile is.
- What the profile should not do.
- Tool and output boundaries.
- Long-term collaboration rules.

It is the wrong place for the current Project Workspace, the currently selected file, a summary of this turn's task, or long shared protocols. Put shared protocols in `reference/` and pull them in with `Import`.

## HistorySet

`HistorySet` is the stable history prefix. It is written when a session has no prefix yet, and not repeated every turn once one exists.

Good candidates:

- `AgentCatalog`: the list of linked agents that can be created or called
- `SkillCatalog`: the list of available Skills
- `WorkflowCatalog`: the list of available Workflows
- `<Import path="reference/..." />`
- Stable shared conventions

`Import`, `SkillCatalog`, `AgentCatalog` and `WorkflowCatalog` are all string fragments, so they must sit inside a string container such as `Message` or `System`.

## ModelContext

`ModelContext` only enters this turn's model context and is never written into the product history.

Good candidates:

- `SqlSchemaSummary`: a structural summary of the current Project SQLite database
- `LinkedAgentsSummary`: the current state of linked agents
- Summaries that apply only to this turn
- Any `Reminder` / `Watch` that should not be persisted

The test is "will this still be true next turn?" If yes, put it in `HistorySet` and write it once. If no, put it in `ModelContext` and recompute it every turn.

## AppendingSet

Non-empty messages produced by `AppendingSet` sit next to the current user input and are written at the current history cursor.

Good candidates:

- `WorkspaceFocusReminder`
- `ModeAvailabilityReminder`
- `ModeReminder`
- `LinkedAgentsReminder`
- `TaskReminder`
- `MentionedSkillsReminder`
- `ActivatedSkills`
- `FileChangeNotice`: injects this turn's external file changes as a Git-style notice, with `mode` taken from the profile settings
- `ModeSlot`: a slot whose text is swapped according to the current agent mode (normal / discuss / plan)

`AppendingSet` also rejects non-empty bare text; text has to go inside a `Message`.

## The Full Node Table

The set of usable DSL nodes is **exhaustive** — a name that is not on the table throws `未知 Profile DSL JSX 节点` ("unknown Profile DSL JSX node") and fails to compile. All 28 of them today:

| Category | Nodes |
| --- | --- |
| Structure | `ProfilePrompt`, `System`, `HistorySet`, `ModelContext`, `AppendingSet` |
| Messages | `Message`, `AIMessage`, `ToolCall`, `ToolResult` |
| Control | `If`, `Watch`, `Import` |
| Catalogs | `AgentCatalog`, `SkillCatalog`, `WorkflowCatalog`, `LinkedAgentsSummary`, `SqlSchemaSummary` |
| Reminders | `Reminder`, `SystemReminder`, `WorkspaceFocusReminder`, `LinkedAgentsReminder`, `TaskReminder`, `MentionedSkillsReminder`, `ActivatedSkills`, `FileChangeNotice` |
| Modes | `ModeReminder`, `ModeAvailabilityReminder`, `ModeSlot` |

For the semantics of the three mode nodes, see [Three Modes](/en/agent/modes).

## Import

`Import` pulls in a shared text file:

```tsx
<HistorySet>
    <Message>
        <Import path="reference/agent/project-workspace-guide.md" />
    </Message>
</HistorySet>
```

Paths allowed in V1:

- `AGENTS.md`
- `reference/**`
- `docs/**`

A missing file returns an empty string by default; with `required={true}`, a missing file is an error. The result renders as a Markdown fenced block.

## Reminder and Watch

`Reminder` injects a reminder when a condition holds; `Watch` observes a variable and writes a message when it changes.

Both belong in `ModelContext` or `AppendingSet`, never in `HistorySet`.

## Keep Reading

- [Profile Import Reference](https://github.com/notnotype/neuro-book/blob/master/packages/neuro-book/assets/reference/agent/profile-import.md)
- [Agent Context Composition](https://github.com/notnotype/neuro-book/blob/master/packages/neuro-book/assets/reference/agent/context.md)
