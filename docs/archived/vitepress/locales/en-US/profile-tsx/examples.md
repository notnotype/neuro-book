# Examples

This page collects a few common ways to write a Profile TSX file. The [Profile Guide](https://github.com/notnotype/neuro-book/blob/master/packages/neuro-book/assets/reference/agent/profile-guide.md) is the authority on the full contract.

## Minimal profile

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
    description: "An example profile.",
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
                    You are Example Agent. Only handle tasks the user explicitly asks for.
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

## Importing a shared reference

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

Use this to move long-lived shared rules into `reference/` instead of copying large blocks of prompt around.

## Which layer catalog nodes belong to

`AgentCatalog`, `SkillCatalog` and `WorkflowCatalog` describe **the capabilities this profile has for the long term**. They belong to the stable prefix, so they go in `HistorySet`:

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

`SqlSchemaSummary` describes **the current project's data structure right now**. It changes as the project changes, so it goes in `ModelContext`:

```tsx
<ModelContext>
    <Message>
        <SqlSchemaSummary />
    </Message>
</ModelContext>
```

The test is "will this still be true next turn?" If yes, put it in `HistorySet` and write it once. If no, put it in `ModelContext` and recompute it every turn. The layouts above are taken from the real `leader.default` implementation.

## Reminders next to the user input

```tsx
<AppendingSet>
    <WorkspaceFocusReminder />
    <ModeReminder />
</AppendingSet>
```

These reminders end up close to the current user message, which helps the model remember the current working boundaries before it acts.

## Check and compile commands

The command surface is `status | check | compile | preview`, with optional `--system` (for modifying a built-in profile), `--all`, `--project <path>` and `--strict-variables`.

Writing your own profile (user layer, no `--system`):

```bash
# 1. Validate the source: reports errors only, emits no .compiled
profile check agent.example

# 2. Compile: emits .compiled, which is what the runtime actually picks up
profile compile agent.example

# 3. Preview: see the context the model really receives after prepare — the most useful command when tuning prompts
profile preview agent.example
```

`profile` is the stable entry point of the Agent runtime, put on PATH by `.nbook/agent/bin`. When developing a built-in profile inside the repository, use the full path plus `--system`:

```bash
profile compile builtin/leader.default.profile.tsx --system
```

::: warning Saving is not the same as taking effect
`.profile.tsx` is the source of truth for the source; `.compiled` is the source of truth for the runtime. Save the TSX without compiling and the runtime keeps using the old artifact, and the profile fails with `compile_stale`.
:::
