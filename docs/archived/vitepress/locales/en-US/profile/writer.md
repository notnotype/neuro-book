# Writer

::: tip Ordinary authors do not need this page
This page describes the internal contract of the `writer` profile — input format, fields, tool boundaries — and is written for profile authors and developers.

**If you just want the AI to write a chapter**, tell the leader and it will call the writer for you — [Write the First Three Chapters](/en/tutorials/04-first-three-chapters) is all you need.
:::

`writer` is the agent that writes finished prose. Its job is to take a writing goal that has already been settled, along with Plot context, worldbuilding references and writing constraints, and land all of it in the Markdown file named for this round.

It is not a planner, it is not retrieval, and it does not maintain plot structure or world state — it is **read-only** against plot and the World Engine.

## Long-Lived Writer Sessions

An ordinary `writer` is a reusable writing station. Create it with an empty initial:

```json
{
  "profileKey": "writer",
  "initial": {}
}
```

Each round states the task in natural language through `invoke_agent.message`, and names the single target file plus the suggested reading list through `invoke_agent.input`:

```json
{
  "message": "Continue this chapter. Start from the protagonist pushing open the archive door, and end when she finds a page missing from the ledger and decides to keep it to herself.\n\n[Scene Context]\n- Setting: the archive room in the west annex hall of the imperial palace, early evening\n- Time range: Imperial Era 520, fourth month, day 12, hour of the Monkey to hour of the Rooster\n- Characters on stage: Xiao Yunshu (protagonist, female court official)\n- Prior events: she was sent to audit the accounts, but she suspects it is a trap\n- Key plot point: she finds page 8 torn out of the ledger and realizes someone left that trace on purpose\n- Information control: she knows the page is missing but not who tore it out; the reader knows exactly as much as she does\n- World Engine query hint: query Xiao Yunshu's state, location and state of mind at the hour of the Rooster on Imperial Era 520, fourth month, day 12\n\nWhen the draft is done, polish it once, then report_result with the paths you actually changed and a plot summary of about 100 words.",
  "input": {
    "path": "my-novel/manuscript/001-volume/003-chapter/index.md",
    "context": {
      "lorebookEntries": ["my-novel/lorebook/character/protagonist/"],
      "readablePaths": ["my-novel/manuscript/001-volume/002-chapter/index.md"]
    }
  }
}
```

`message` must express this round's task on its own: what to write, the scope, the constraints, the stopping condition and what to deliver. `input.context` is only a structured list of references; it cannot stand in for the task description.

**Note**: the legacy fields `context.threadIds/sceneIds/plotIds` may optionally be kept for backward compatibility, but the writer will not use them to read Plot on its own. When Scene / World Context is needed, the leader must compile the full brief and put it into `message`.

## Profile Presets

`writer` offers visual preset configuration through profile settings. You find it in the "Agent Profile Models" panel on the settings page: the `writer` card shows a "Profile Presets" section.

Current fields:

- `customTopSystemPrompt`: the highest-priority pinned prompt, inserted at the very front of the Writer system prompt. It is the custom rule with the highest precedence; leave it blank and nothing is injected.
- `writingStylePreset`: the default style requirements (written as a rule list), sourced from `agents/writer/styles/` in the current Project Workspace. In Project Config you can select, edit, add, rename and delete any resource other than the active one.
- `writingReferencePreset`: the default style reference sample (prose to imitate), sourced from `agents/writer/references/` in the current Project Workspace, with the same select / edit / add / rename / delete options in Project Config.
- `narrativePerson`: the default narrative person — first, second and third person are supported.
- `paragraphRhythm` / `wordCountControl` / `polishingWorkflow` / `adultStylePrompt`: paragraph rhythm, default word count, polishing workflow and adult style enhancement. All of them are long-term defaults; when this round's message asks for something explicit, the task wins. If `adultStylePrompt` is blank, nothing is injected at all.

These settings are saved in the `agent.profiles.writer.settings` patch in Config. Global Config can only store configuration values such as a selected key or the narrative person — it is not bound to any one Project's resource files. Project Config lets each individual field either "inherit" or "override", and commits resource content changes in the same save. They take effect on the next writer prepare / run, and existing long-lived sessions do not need to be rebuilt.

The first time you open the Project-scope Agent Profile Models panel, or before the current Project's `writer` runs, the system makes sure `agents/writer/` has been initialized. The default resources come from the built-in `writer.home`; the write only fills in missing files and never overwrites a style or reference sample you have already changed. "Reset Home" in Project scope wipes them and regenerates them from the current profile version.

Precedence:

- Style, person or narrative requirements stated explicitly in this round's `invoke_agent.message` win.
- Next come the profile presets in `ctx.settings`.
- Last is the writer profile's built-in defaults.

Do not push default preferences like style or narrative person back into `initial` or `invoke_agent.input`. `initial` is still stable creation-time data, and `input` is still the structured payload for a single task.

## What the Writer Can See

The writer prepare stage injects only:

- The single target file behind `input.path`.
- The derivable `projectPath`, `projectSlug` and optional `chapterPath`.
- The `lorebookEntries` and `readablePaths` suggested reading lists.

The writer does not automatically read Plot, the lorebook or the body of ordinary files. **Whatever Scene / World Context this round needs is compiled upstream by the leader through `get_chapter_writer_brief` and written into `invoke_agent.message` in full.**

The writer calls tools on its own as needed:

- `read`: reads the target file, a lorebook node's `index.md` / `state.md`, or `readablePaths`.
- `execute_world`: read-only queries against World Engine state (a character's location, HP, relationships and so on).

The first version enforces no hard permission limit at the file tool layer. The writer prompt requires it to write only `input.path` and to read only the material that `message` and `context` point at.

## Preparation Before Writing

Before calling the writer, the leader should have as much of this ready as it can:

- `input.path`: the single target Markdown file. It must be a path relative to the current Project Workspace, for example `manuscript/.../index.md`.
- `message`: this round's prose task, scope, focus, prohibitions and stopping condition.
- **Scene / World Context**: the chapter brief the leader compiled with `get_chapter_writer_brief`, containing:
  - key plot points and a Scene summary
  - the time range and the subjects on stage
  - information control requirements (who knows what)
  - World Engine query hints ("query the protagonist's state at era 12345")
- Worldbuilding references: the lorebook entries or readablePaths worth reading.
- Facts and boundaries that must not be changed.

If the plot state has not been settled yet, run the World Engine advance flow first instead of letting the writer decide for itself how the world changes.

## How the RP Writer Differs

`rp.writer` is used only to render the visible text of an RP Tick. Its profile initial is empty and it consumes nothing but the Writer Brief injected from above. The ordinary `writer` targets finished prose files and takes on neither RP Tick hosting nor world state maintenance.

## Keep Reading

- [Novel Writing Workflow](https://github.com/notnotype/neuro-book/blob/master/packages/neuro-book/assets/reference/agent/novel-writing-workflow.md)
- [Write the First Three Chapters](/en/tutorials/04-first-three-chapters)
- [Leader Collaboration Protocol](https://github.com/notnotype/neuro-book/blob/master/packages/neuro-book/assets/reference/agent/leader-default.md)
