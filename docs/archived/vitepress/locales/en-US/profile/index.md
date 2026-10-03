# What Is a Profile

A profile defines the behavioral boundary of an Agent. In NeuroBook v3, a profile *is* the agent type: creating a `leader.default`, a `writer` or a `retrieval` all amount to creating a session of some profile.

Most users only ever need to pick a profile. Profile authors have to understand the TSX Profile DSL, tool permissions, input and output schemas, dynamic context, compaction policy, summarization policy and Runtime Hooks.

## What a Profile Contains

At minimum, a profile contains:

- `manifest.key`: the stable profile key, for example `leader.default`.
- `manifest.name`: the user-visible name.
- `initialSchema`: the input contract used when a session is created.
- `outputSchema`: the output contract used when a structured result is required.
- `tools`: the root tool binding object for this profile. It determines the tool schemas the model sees and the maximum tool permissions.
- `toolKeys`: optional, narrows down which tools the main run can actually execute. When it is not declared, it equals every key of the root `tools`.
- `context(ctx)`: builds system, history, dynamic context and reminders with the TSX DSL. Mutually exclusive with `prepare` — declaring both is an error.
- `runtimeDefaults`: declares only the factory defaults for summarization, compaction and the file-change budget. At runtime the Harness layers Global / Project shared values and Profile overrides on top.
- `capabilities.creation`: only `public` allows another Agent to spin it up with `create_agent`; `system_only` is created solely by internal Harness flows.
- `home`: this profile's own resource directory (personas, style presets, reference material).
- `skills.include`: the Skill allowlist. Visibility in the catalog is not permission — the allowlist is applied uniformly in the prepare layer.
- runtime hooks: control bypasses and lifecycle behavior.

Runtime policy does not belong to `settingsForm`. The final precedence is fixed: Harness defaults < Profile `runtimeDefaults` < Global shared values < Global Profile overrides < Project shared values < Project Profile overrides. Discriminated unions (the compaction trigger and keep-recent, for example) are replaced wholesale by the higher layer; everything else is inherited field by field.

When a structured result is required, a profile returns it through `report_result`.

## System Profiles and User Profiles

Built-in system profiles live in:

```text
assets/workspace/.nbook/agent/profiles/builtin/
```

User overrides and custom profiles live in:

```text
workspace/.nbook/agent/profiles/
```

The runtime uses the `.compiled` artifact. Saving a TSX source file does not mean it has taken effect at runtime — you have to compile it through the Workbench or with `profile compile`.

## Common Built-in Profiles

There are 14 built-in profiles today.

**Main writing chain**:

| Profile | Responsibility |
| --- | --- |
| `leader.default` | Overall dispatcher for an ordinary novel project. Holds the full set of plot read/write and World Engine tools, and handles Skills, writer, retrieval, researcher and the writing workflow. |
| `writer` | Writes finished prose. A long-lived session that gets its task and target file each round through a message plus payload. Read-only against plot and the World Engine. |
| `retrieval` | Content node recall and candidate judgment. |
| `researcher` | Online research and source verification. |
| `world.engine` | Maintenance and validation of a complex World Engine, in readwrite mode. |
| `director` | Story director. An advanced manual profile, not a required stop in ordinary writing. |

**Background and support** (not created directly by users):

| Profile | Responsibility |
| --- | --- |
| `inline.editor` | The Inline AI in Markdown Studio, running as its own background session. |
| `summarizer` | Generates session titles and summaries in the background. |
| `memory.curator` | Produces memory patches for `subject_memory_update`. |
| `leader.assets` | Helps you understand and maintain user-assets, profiles and skills. |

**RP / world simulation** (entry points taken down, redesign in progress):

| Profile | Responsibility |
| --- | --- |
| `rp.leader` | RP hosting and screenwriting entry point. |
| `rp.writer` | Renders the visible prose of an RP turn. |
| `simulator.leader` | World simulation supervisor. |
| `simulator.actor` | Roleplay agent for a single subject. |

There is one more kind that never lands in a directory: the **adhoc profile**, a temporary agent that declares nothing but a prompt and an output structure, created by a workflow at runtime and thrown away after use. See [Workflows and Jobs](/en/agent/workflow).

## Keep Reading

- [Leader](./leader.md): how the default leader dispatches writing, retrieval, research and RP.
- [Writer](./writer.md): the prose-writing boundaries of the ordinary writer.
- [Other Profiles](./other-profiles.md): retrieval, summarizer, assets and the RP profiles.
- [Profile Guide](https://github.com/notnotype/neuro-book/blob/master/packages/neuro-book/assets/reference/agent/profile-guide.md): the main entry point for profile authors.
