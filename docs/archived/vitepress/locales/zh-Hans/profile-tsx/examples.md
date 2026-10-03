# 示例

这一页给出几个 Profile TSX 的常见写法。完整合同以 [Profile Guide](https://github.com/notnotype/neuro-book/blob/master/packages/neuro-book/assets/reference/agent/profile-guide.md) 为准。

## 最小 profile

```tsx
/** @jsxImportSource nbook/profile-sdk */
/** @jsxRuntime automatic */
import {
    AppendingSet,
    HistorySet,
    Message,
    ModelContext,
    ProfilePrompt,
    SkillCatalog,
    SqlSchemaSummary,
    System,
    Type,
    WorkspaceFocusReminder,
    builtin,
    defineAgentProfile,
    toolset,
} from "nbook/profile-sdk";

export const profileManifest = {
    key: "agent.example",
    name: "Example Agent",
    description: "示例 profile。",
} as const;

export const InitialSchema = Type.Object({
    prompt: Type.String(),
});

export default defineAgentProfile({
    manifest: profileManifest,
    initialSchema: InitialSchema,
    tools: toolset(
        builtin.file.read,
        builtin.file.write,
        builtin.file.edit,
    ),
    context() {
        return (
            <ProfilePrompt>
                <System>
                    你是 Example Agent。只处理用户明确要求的任务。
                </System>
                <HistorySet>
                    <Message>
                        <SkillCatalog />
                    </Message>
                </HistorySet>
                <ModelContext>
                    <Message>
                        <SqlSchemaSummary />
                    </Message>
                </ModelContext>
                <AppendingSet>
                    <WorkspaceFocusReminder />
                </AppendingSet>
            </ProfilePrompt>
        );
    },
});
```

## 导入共享 Reference

```tsx
<HistorySet>
    <Message>
        <Import path="AGENTS.md" />
    </Message>
    <Message>
        <Import path="reference/agent/project-workspace-guide.md" />
    </Message>
</HistorySet>
```

适合把长期共享规则放进 `reference/`，避免复制大段 prompt。

## Catalog 节点该放在哪一层

`AgentCatalog`、`SkillCatalog`、`WorkflowCatalog` 描述的是**这个 profile 长期可用的能力**，属于稳定前缀，放 `HistorySet`：

```tsx
<HistorySet>
    <Message>
        <AgentCatalog />
    </Message>
    <Message>
        <SkillCatalog />
    </Message>
    <Message>
        <WorkflowCatalog />
    </Message>
</HistorySet>
```

`SqlSchemaSummary` 描述的是**当前项目此刻的数据结构**，会随项目变化，放 `ModelContext`：

```tsx
<ModelContext>
    <Message>
        <SqlSchemaSummary />
    </Message>
</ModelContext>
```

判据是"这段内容下一轮还成立吗"：成立的进 `HistorySet` 写一次，不成立的进 `ModelContext` 每轮重算。以上写法取自 `leader.default` 实际实现。

## 贴近用户输入的提醒

```tsx
<AppendingSet>
    <WorkspaceFocusReminder />
    <ModeReminder />
</AppendingSet>
```

这些提醒会靠近当前用户消息，帮助模型在执行前记住当前工作边界。

## 检查与编译命令

命令面是 `status | check | compile | preview`，可选 `--system`（改内置 profile）、`--all`、`--project <path>`、`--strict-variables`。

写自己的 profile（用户层，不加 `--system`）：

```bash
# 1. 校验源码：只报错，不产出 .compiled
profile check agent.example

# 2. 编译：产出 .compiled，运行时才会真正生效
profile compile agent.example

# 3. 预览：看 prepare 之后模型实际收到的 context，调 prompt 时最有用
profile preview agent.example
```

`profile` 是 Agent runtime 的稳定入口，由 `.nbook/agent/bin` 注入 PATH。在仓库里开发内置 profile 时用完整路径加 `--system`：

```bash
profile compile builtin/leader.default.profile.tsx --system
```

::: warning 保存不等于生效
`.profile.tsx` 是源码真相源，`.compiled` 才是运行时真相源。只保存 TSX 不编译，运行时仍然用旧产物，profile 会挂 `compile_stale`。
:::
