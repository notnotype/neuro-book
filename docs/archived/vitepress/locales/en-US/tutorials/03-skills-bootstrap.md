# Ignite the Story with Skills

By the end of this section you will know how to get the Agent to call the Skills you use most, and how to land your idea, project description, worldbook and character design into the Project Workspace.

A Skill is not a button that runs a script. It is closer to a job card written for the Agent: when to use it, what to read first, how to check in with you, and which content belongs in which files.

## Step One: Explore the Idea

If all you have is a vague notion, start by having the Agent use `novel-idea-exploration`.

Something like:

```text
Use novel-idea-exploration to talk this idea through with me: an amnesiac ticket inspector, a night train, cities made of dreams. The goal is a story seed I can keep developing.
```

This round is not about writing prose. It is about pinning down the genre promise, the protagonist's desire, the central conflict, the spectacle of the world, and what the reader is expecting.

When you are done you should have a story seed you can build on. It may not be in the worldbook yet, but it should be enough to answer:

- What kind of story this is.
- Who the protagonist is.
- What the most compelling promise of volume one is.
- Why a reader would keep going.

## Step Two: Initialize the Novel Project

Once the seed is reasonably stable, use `novel-setup` (phase one: project initialization).

```text
Use novel-setup to initialize this book in the current Project Workspace. List the files you will create or update first, then do it.
```

This phase usually sorts out:

- The concept and synopsis of the work.
- The protagonist, the key supporting cast and the initial conflict.
- A minimal usable `lorebook/` skeleton.
- The direction of the opening three chapters.

You can ask the Agent to show its plan before it writes anything:

```text
Before you execute, list the file paths you intend to create or update. Wait for my confirmation before writing.
```

## Step Three: Build the Worldbook

Next continue into phase two of `novel-setup` (the worldbook framework). The worldbook is not an encyclopedia; it is the creative manual the AI writes from. At the start it only needs to be enough to support the first three chapters — do not try to write the entire universe in one sitting.

Have the Agent cover these types first:

- `lorebook/character/`: the protagonist, important supporting characters, and the antagonist or whoever represents the opposing force.
- `lorebook/location/`: the places that appear in the opening.
- `lorebook/faction/`: the factions that matter.
- `lorebook/item/`: key items.
- `lorebook/world/`: world rules, institutions, history or anomalies.
- `lorebook/instruction/`: book-level creative instructions, such as narrative boundaries and style notes.

A minimal usable worldbook can look like this:

```text
lorebook/
  character/
    protagonist/index.md
    important-npc/index.md
  location/
    opening-location/index.md
  world/
    basic-rules/index.md
  instruction/
    style/index.md
```

## Step Four: Deepen the Characters

Once the protagonist and the key players start to come into focus, move to phase three of `novel-setup` (character design and refinement).

```text
Continue with the character design phase of novel-setup and deepen the protagonist and the first important supporting character. Write the stable settings into the lorebook.
```

The point of character design is not to pile up backstory; it is to give characters enough to drive the plot. At minimum you need to know:

- What he wants.
- What he is afraid of.
- How he misreads the world.
- How he connects to the opening event.

## Step Five: Initialize the World Engine (novel-setup phase four)

Once the direction is settled and you are about to write for real, have the Agent run phase four of `novel-setup` (World Engine initialization). This step settles how time is reckoned in this world and when the story opens, and registers the characters whose state needs tracking as the story moves.

```text
Continue with novel-setup phase four and set up the world engine to track character state for me.
```

The Agent walks you through confirming the time format, designing the subjects worth tracking, and then writes the opening state. After that you can query state in plain language and record story facts the same way — "where is this character now", "what injuries did he take in the last fight" — without maintaining any files by hand.

The next section, on the first three chapters, uses the World Engine you set up here.

## What You Should See Afterwards

The Project Workspace should contain at least:

```text
project.yaml
lorebook/character/...
lorebook/location/...
lorebook/world/...
lorebook/instruction/...
manuscript/001-volume/
world-engine/
```

If the Agent only chats at you and never writes files, push back directly:

```text
Write the stable settings we just confirmed into the current Project Workspace. List the target file paths before you write.
```

## The Skills You Will Use Most

Early in a book these are the ones that come up:

| Skill | When to use it |
| --- | --- |
| `novel-guide` | You are not sure which skill you need — start with the overall roadmap. |
| `novel-idea-exploration` | You have an idea but no story skeleton yet. |
| `novel-setup` | The four setup phases: project initialization, worldbook framework, character design and refinement, World Engine initialization. |
| `novel-writing` | The main loop: plot design, recording it, writing real chapters, revising and polishing. The golden opening three chapters live here too. |
| `novel-technique-character-card-workshop` | The character is still just labels and vibes and you want a heavyweight character interrogation. |

The next section turns all this preparation into the first three chapters.
