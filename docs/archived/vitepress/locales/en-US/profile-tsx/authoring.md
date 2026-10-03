# Write a Profile from Scratch

This page is the end-to-end path: create the file → write the exports → compile → use it in the interface → what to check when it breaks.

## 1. Where the File Goes and What to Call It

User profiles live under the Workspace Root's `.nbook`:

```text
workspace/.nbook/agent/profiles/<key>.profile.tsx
```

**The file name must be `<key>.profile.tsx`**, and `<key>` has to match `profileManifest.key`. If they disagree, the profile fails with `filename_mismatch`.

You do not have to start from a blank file. The repository ships two templates:

```text
assets/workspace/.nbook/agent/profile-templates/basic-agent.profile-template.tsx
assets/workspace/.nbook/agent/profile-templates/report-agent.profile-template.tsx
```

`basic-agent` is the smallest runnable skeleton; `report-agent` adds structured output.

## 2. What You Must Export

This is the module contract. Miss one item and it will not compile:

| Export | Required | Notes |
| --- | --- | --- |
| `profileManifest` | Yes | `key` and `name`, plus optional `description` and `version` (a positive integer; incrementing it triggers a profile home upgrade) |
| `InitialSchema` | Yes | The input contract used when a session is created. Write `Type.Object({})` if it takes no parameters |
| `OutputSchema` | Yes | The output contract. Use an empty object if there is no structured result |
| `PayloadSchema` | No | Only declare it if you need `invoke_agent.input` |
| `SettingsSchema` + `settingsForm` | No | Declare both together when you want a settings form; read the merged values at runtime through `ctx.settings` |
| `Initial` / `Payload` / `Output` / `Settings` | Yes (whenever the matching schema exists) | Type aliases derived with `Static<typeof XxxSchema>` |
| `default` | Yes | The return value of `defineAgentProfile({...})` |

For the minimal skeleton, see [Examples](./examples.md).

::: warning Overriding a built-in profile comes with extra limits
When you override a built-in profile you **may not change the key or the three schemas**; doing so fails with `builtin_schema_locked`. If you want a different structure, create your own profile instead of overriding one.
:::

## 3. Compile

**Saving the TSX does not make it take effect.** The runtime reads the `.compiled` artifact; the source is only the source of truth.

```bash
profile check <key>      # validate only, emits nothing
profile compile <key>    # emit .compiled, which is the step that actually takes effect
profile preview <key>    # see the context the model really receives — the most useful command when tuning prompts
profile status <key>     # show the current compile state
```

`profile` is put on PATH by `.nbook/agent/bin`. Optional flags: `--all` (batch), `--project <path>` (project-level profiles) and `--strict-variables`.

When developing a built-in profile inside the repository, use the full path plus `--system`:

```bash
bun scripts/build/profile.ts compile builtin/leader.default.profile.tsx --system
```

`preview` is the most underrated command — it prints the real context after prepare, so you can see immediately whether your `Import` took effect and which layer a reminder landed in.

## 4. Using It in the Interface

This step is counter-intuitive: **the new-agent dropdown does not list your custom profile.**

There are three ways in:

1. **Make it the default profile.** Set it in the Agent Profile panel on the settings page, and every agent you create afterwards uses it.
2. **Let leader spawn it.** Declare `capabilities.creation = "public"` in the profile and leader can create its linked session with `create_agent`. Without that declaration, only internal Harness flows can create it.
3. **The TSX Profile workbench.** Visual editing, compiling, previewing and restoring the system version.

::: warning The workbench entry only exists in User Assets mode
The Profile workbench button only appears after you switch the top bar to user assets. A normal novel project's top bar does not have it, and no amount of hunting will turn it up.
:::

## 5. Where to Look When It Breaks

A profile carries a status and a set of issue codes. The common ones:

| Code | Meaning | What to do |
| --- | --- | --- |
| `not_compiled` | Never compiled | Run `profile compile` |
| `compile_stale` | The source changed but was not recompiled | Run `profile compile` |
| `compile_failed` | Compilation failed | Read the error; usually an unknown DSL node or a type error |
| `filename_mismatch` | The file name does not match the key | Rename the file |
| `invalid_export` / `schema_missing` | The exports are incomplete | Fill the gaps against the table in section 2 |
| `builtin_schema_locked` | You tried to change a built-in profile's key or schema | Create your own profile |
| `system_profile_shadowed` | Your profile shadows a system profile with the same name | Confirm this is intentional |
| `source_stale` / `dependency_stale` | A file it depends on changed | Recompile |
| `compiled_load_failed` | The artifact failed to load | Delete the artifact and recompile |

**The runtime strictly refuses stale and failed profiles** — it will not limp along on an old artifact, so an error means the profile really is not in effect.

## 6. Common Traps

**An unknown node throws immediately.** The DSL's node table is exhaustive; write a name that is not on it and compilation blows up. All 28 nodes are listed in [Node Reference](./nodes.md).

**Compaction policy is not a node.** It goes in `defineAgentProfile({runtimeDefaults: {...}})`.

**It is `context` or `prepare`, never both** — declaring both is an error.

**The Skill allowlist is permission, not visibility.** `skills.include` filters at the prepare layer, so seeing a Skill in the catalog does not mean it can be used.

## Keep Reading

- [Node Reference](./nodes.md): the 28 DSL nodes and the rules for which layer they belong to.
- [Examples](./examples.md): skeletons you can copy directly.
- [Profile Guide](https://github.com/notnotype/neuro-book/blob/master/packages/neuro-book/assets/reference/agent/profile-guide.md): the full contract.
- [Compiled Artifacts](https://github.com/notnotype/neuro-book/blob/master/packages/neuro-book/assets/reference/agent/profile-compiled-artifacts.md): the `.compiled` format and the release flow.
