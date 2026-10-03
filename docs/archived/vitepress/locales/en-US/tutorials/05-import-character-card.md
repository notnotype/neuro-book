# Import a Character Card

::: warning What this section actually gets you
If you came here to start an RP session from a character card: **the RP entry points are currently unavailable** while they are redesigned to the standard set by writing mode.

What this section does is **archive a SillyTavern character card and its worldbook intact and migrate them into your worldbook**, as material for **writing a novel**. Importing does not start any RP or simulation flow.
:::

By the end of this section you will know how to turn a SillyTavern character card into material, worldbook entries and RP migration references that NeuroBook can manage.

A SillyTavern card is usually more than "one character." It can contain a worldbook, variable initialization, dynamic update rules, prompt templates, regex scripts and author notes. The NeuroBook import flow preserves the original material first, then migrates the stable content into the Project Workspace.

## Prepare the Card File

Put the character card file somewhere the Agent can read it. Common inputs are:

- `.json`: an already-exported character card JSON.
- `.raw.json`: the raw JSON extracted from a PNG.
- `.png`: the embedded JSON is read best-effort; if that fails you need to extract a `.raw.json` first.

If you are not sure the file can be read, ask the Agent first:

```text
I want to import this SillyTavern character card. Check whether the file exists and whether the format is supported, and tell me whether the next step is inspect or extracting raw.json first.
```

## The Three-Stage Flow

When using `novel-import-silly-tavern-card`, read it as three stages by default:

1. `inspect`: look at the overview only, generate no files.
2. `unpack`: unpack into a stable archive, written to `reference/silly-tavern/{slug}/`.
3. `import`: import the stable content from the unpacked directory into the current Project Workspace.

You can have the Agent read the Skill first:

```text
Use "novel-import-silly-tavern-card" to import this card. Run inspect first, give me the overview and the risks, then ask me whether to unpack.
```

## inspect: See the Card Clearly

The point of `inspect` is to let you and the Agent see what is actually in the card:

- Basic character information.
- How many worldbook entries there are and of what type.
- Whether it contains dynamic MVU, prompt templates or scripts.
- Which content is suitable for importing into `lorebook/`.
- Which content is only suitable for archiving into `reference/`.

This stage writes no files, so it is a quick way to judge the quality of a card.

## unpack: Preserve the Original Material

Once you decide to continue, run `unpack`. It breaks the card out into a stable directory, for example:

```text
reference/silly-tavern/{slug}/
```

This directory is a material archive, not an official worldbook. It keeps the raw card, the overview, the worldbook entries, extension scripts, variables and a generated report. That way, even if the import strategy changes later, you can migrate again from the original archive.

After unpacking you usually see something like:

```text
reference/silly-tavern/{slug}/
  raw/
  overview.md
  inspect.json
  worldbook/
  extensions/
  unpack-report.md
  generated.json
```

## import: Migrate into the Project Workspace

`import` reads the unpacked directory and brings the stable text into the project.

Typical results:

- Characters, places, factions, items and world rules go into `lorebook/`, with world rules written to `lorebook/world/rule/` and system mechanics to `lorebook/system/`.
- Dynamic mechanics, low-confidence content and mixed-responsibility content stay in `reference/silly-tavern/{slug}/`; low-confidence but reusable stable entries may go into `lorebook/note/` marked as pending.
- With `--rp`, an extra `simulation-migration/` directory is generated as an archive of legacy RP migration candidates. Ordinary writing mode does not use this directory — it just sets aside the RP-related dynamic mechanics for reference if RP capability is ever needed again.

Note that `--rp` does not mean an RP runtime starts, and it does not put you into any simulation flow.

After the import, the project may gain:

```text
lorebook/character/...
lorebook/location/...
lorebook/faction/...
lorebook/item/...
lorebook/event/...
lorebook/system/...
lorebook/world/rule/...
lorebook/note/...
reference/silly-tavern/{slug}/simulation-migration/
```

## Tidy Up After Importing

Once the import finishes, have the Agent review it:

```text
Review the lorebook entries we just imported. The goal is to keep the stable settings and flag the dynamic mechanics, the omniscient-view secrets, and the state content that needs registering in the World Engine.
```

Watch for these in particular:

- The lorebook is omniscient canon; it does not mean the characters know any of it.
- Do not park a character's current state in the lorebook long-term. It should be registered as a World Engine subject instead (current character state → subject timeline slices).
- Key items, mechanisms or places with state of their own are also worth registering as World Engine subjects.
- Do not force mixed-responsibility entries into several nodes automatically. Record the reason in the report and let a human decide later.

If the import produces a lot, do not rush to register it all in the World Engine at once. Have the Agent sort it into three buckets — ready to write with, needs migrating, archive only:

```text
Sort the results of this import into three groups: lorebook entries already usable for writing, dynamic state that needs registering in the World Engine, and dynamic mechanics that stay in reference. List the paths and the reasoning for each group.
```

That is the end of the tutorial route. Go back to the methods in the previous section and keep writing with these characters: let the settings you have confirmed feed into the `novel-writing` loop, and if this batch of characters later needs fuller world state tracking, use `novel-setup` phase four to register them as trackable subjects.
