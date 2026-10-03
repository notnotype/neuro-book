# Profile TSX

TSX profiles are the main way to write an agent profile in NeuroBook. TSX is the context template language: one file expresses a profile's system prompt, history, dynamic context, runtime reminders and compilation strategy.

If you only use NeuroBook, you never need to write TSX. This section is for people creating a custom profile, modifying a built-in one, or maintaining user-assets. The point of TSX profiles is to keep agent context type-safe, previewable and checkable, and to give low-code editing and visual tooling a structure to work against.

## Minimal Structure

A TSX profile's `context()` returns a `<ProfilePrompt>`:

```tsx
<ProfilePrompt>
    <System>You are a specialized Agent.</System>
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
```

The intuition behind the four regions:

- `System`: long-term identity and responsibilities.
- `HistorySet`: history. Written when a session has no prefix yet, and not repeated every turn once the prefix exists.
- `ModelContext`: dynamic context — temporary context that only this turn's model sees.
- `AppendingSet`: reminders. Runtime reminders that sit close to the current user input and usually do get written into history.

## Compiling and Running

The TSX source file is not the runtime source of truth. The runtime uses the `.compiled` artifact.

After changing a profile you have to run check / compile, or the runtime keeps using the old artifact. For your own profiles, use the runtime CLI:

```bash
profile check agent.example      # validate only
profile compile agent.example    # emit .compiled, which is what actually takes effect
profile preview agent.example    # see the context the model really receives
```

When developing a built-in profile inside the repository, add `--system`:

```bash
bun scripts/build/profile.ts compile builtin/leader.default.profile.tsx --system
```

For visual editing, use the TSX Profile workbench. Its entry point only appears in **User Assets mode** — switch the top bar to user assets and the button shows up. A normal novel project's top bar does not have it.

## Keep Reading

- [Write a Profile from Scratch](./authoring.md)
- [Node Reference](./nodes.md)
- [Examples](./examples.md)
- [Profile Guide](https://github.com/notnotype/neuro-book/blob/master/packages/neuro-book/assets/reference/agent/profile-guide.md)
- [Agent Context Composition](https://github.com/notnotype/neuro-book/blob/master/packages/neuro-book/assets/reference/agent/context.md)
