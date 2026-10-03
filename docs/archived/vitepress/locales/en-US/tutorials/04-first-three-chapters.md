# Write the First Three Chapters

By the end of this section you will have connected your project settings, your opening plot and writer, and you will have draft prose for the first three chapters.

The goal of the first three chapters is not to finish the book. It is to build an opening a reader wants to keep turning: the protagonist appears, something goes wrong, the central question surfaces, and a clear hook lands around the end of chapter three.

::: tip You do not have to create the chapter directories
At the end of the last section, `manuscript/` only had a volume directory (`001-volume/`). **The chapter directories and their `index.md` files are created by writer as it writes** — give it the target path in your prompt and it will create whatever is missing.

If you would rather control it yourself, right-click in the file tree to create the directory and file. Same result.
:::

## Design the Opening First

Before calling writer, use the opening mode of `novel-writing`.

```text
Use the opening mode of novel-writing to design the first three chapters of this project. Read the existing lorebook, then give me each chapter's goal, conflict and closing hook, plus any worldbuilding that still needs filling in.
```

If the project already has the World Engine initialized, leader checks the current world state first. If not, you can still move forward with ordinary worldbuilding and plot discussion.

Opening mode should ideally produce:

- Chapter one: the crack in the protagonist's ordinary life, and the first anomaly.
- Chapter two: the protagonist acts, and finds the problem runs deeper.
- Chapter three: a choice, a loss or a new goal with no way back.

Before any prose gets written, ask the Agent for a version you can sign off on:

```text
Before you call writer, give me a writing sheet for the first three chapters: each chapter's goal, POV character, main conflict, closing hook, and the lorebook entries that must be used.
```

## Decide Whether You Need World State Tracking

If the first three chapters involve character reactions, faction moves, changes to a place, who holds which item, a countdown or a hidden state, first confirm the World Engine is initialized (`novel-setup` phase four), then have leader advance the opening facts into the timeline before writing.

The usual phrasing:

```text
Before writing chapter one, confirm the World Engine is initialized and advance the story facts we settled for the first three chapters into the timeline.
```

## Pre-Writing Checklist

Before calling writer, settle at least these questions:

- Which `manuscript/.../index.md` this chapter goes into.
- Whose POV this chapter is in.
- What the state is at the start of the chapter.
- What must happen by the end of the chapter.
- Which settings are not allowed to change.
- Whether a specific style or reference preset should be used.

If you have not thought it through yet, have the Agent ask you first:

```text
Before writing chapter one, ask me at most 5 necessary questions. Only ask about things that decide whether the prose works.
```

## Call writer to Write the Chapter

Once each chapter's goal is clear, run the prose loop of `novel-writing`.

```text
Use novel-writing to write chapter one. The target chapter is manuscript/001-volume/001-chapter/index.md. Write only the finished prose into that chapter file.
```

The ordinary `writer` is the prose agent. It has read-only access to the World Engine, and it should not go rummaging through every file on its own. leader compiles the chapter brief first (goals, information control), writer reads that brief itself and queries the World Engine for current state, and the style constraints come with writer.

Write chapters two and three the same way:

```text
Continue with chapter two. The target chapter is manuscript/001-volume/002-chapter/index.md. Check the state and Plot left behind by chapter one first, then call writer.
```

```text
Continue with chapter three. The target chapter is manuscript/001-volume/003-chapter/index.md. The end of chapter three needs to land the first strong hook.
```

## Check It After Writing

After each chapter, run a light pass with the review and revision step of `novel-writing`:

```text
Review chapter one: pacing, information release, character motivation, closing hook. Give me suggestions first, then ask whether to apply them.
```

If the prose has changed the state of the world — a character is injured, an item changed hands, a place was destroyed — leader should write those changes back into the World Engine timeline instead of leaving them in the chat log.

There are also things worth checking with your own eyes:

- Whether the first page tells the reader who the protagonist is and what the trouble is.
- Whether each chapter ends with a reason to keep reading.
- Whether exposition is crowding out character action.
- Whether the protagonist actually makes a choice instead of being pushed along by events.
- Whether writing the chapter produced new facts that need to go into the lorebook, Plot or the World Engine.

## Common Rework Prompts

When the direction is right but the pacing drags:

```text
Keep the events of this chapter as they are. Compress the expository passages and strengthen the action, the dialogue and the closing hook.
```

When the voice is wrong:

```text
Do not change any story facts. Adjust the narrative voice only. Aim for a serialized web-fiction feel: shorter paragraphs, clearer emotional escalation.
```

When there is too much worldbuilding:

```text
Point out the settings this chapter explains too early. Move anything that does not bear on the current conflict to later chapters, and keep only what the reader needs to follow the action.
```

## Minimum Acceptance Check

After this section the project should contain at least:

- `manuscript/001-volume/001-chapter/index.md`
- `manuscript/001-volume/002-chapter/index.md`
- `manuscript/001-volume/003-chapter/index.md`
- The matching story goals or Plot records.
- The `lorebook/` entries you needed.

## Getting the Manuscript Out

A finished chapter is just a Markdown file, so **there is no "export" step**:

- **Publishing somewhere**: select all and copy in the editor, or open `manuscript/001-volume/001-chapter/index.md` straight from your system file manager — any editor can read it. For where the files physically live, see [Running, Data and Privacy](/en/operations#where-your-data-lives).
- **Packaging the whole book**: copy the `manuscript/` directory and you have the book; chapter order is directory-name order.
- **Word count**: the editor status bar shows the count for the current file.

::: warning Before you share
A project download package includes the file history database, **which contains content you have deleted**. To show your work to someone, send the Markdown files under `manuscript/`, not the download package. See [Privacy Boundaries](/en/operations#privacy-boundaries).
:::

## When It Goes Wrong

Every file change the Agent makes is recorded. The **Changes** entry in the top bar shows every file modification from this round, so you can review them one by one and roll back what you need. That is also why it is better to have the Agent write files than to copy and paste yourself — there is a ledger to audit.

The next section imports an external character card into this project.
