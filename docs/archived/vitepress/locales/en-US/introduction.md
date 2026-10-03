# Introduction

NeuroBook is a creative writing IDE built to get you to **finish** the long one.

The problem it solves is not the short one — "generate me a paragraph" — but the ongoing management problem of long-form work: the worldbuilding changes, the plot moves, setups pile up unpaid, chapters affect each other, and the decision you made three months ago is one you have already forgotten. A stronger model does not fix any of that. **Engineering** does.

## What It Is

NeuroBook is closer to a local IDE for novelists than to an ordinary chat box.

It gives you four layers:

- **World state**: World Engine records a changing world as a timeline plus slices, and the state at any moment is computed by the engine — not remembered by the model, so it never drifts.
- **Story structure**: two trees keep "where the story is told" separate from "why it happens"; setups are booked into the promise ledger, and creative decisions are filed as ADR-style records.
- **Content management**: worldbuilding, prose, drafts and references are all local Markdown files that any editor can open.
- **AI collaboration**: leader plans, writer writes prose, retrieval looks up your worldbuilding, researcher checks external sources — plus orchestrated Workflows and background Jobs.

All of it lands in the same Project Workspace. You can see your own files directly, and you can let the Agent read, reorganize and edit them within explicit boundaries.

The underlying runtime extends the Pi framework, reusing base abstractions such as multi-provider, tool calling and the append-only session tree, and adds Profile and TSX Profile: a Profile defines an Agent's behavioral boundaries, and a TSX Profile describes dynamic context with type-safe context templates.

## Who It Is For

NeuroBook fits:

- Novelists who maintain a world, a cast list and story threads over the long haul.
- Writing teams that need the worldbuilding library, the prose and the task record managed in one place.
- People who want AI for retrieval, planning, drafting and cleanup, not just for chatting.
- Users who need local deployment, control over where data lives, and a Markdown workflow they can take with them.

If you only need a one-off short piece, an ordinary AI chat tool is lighter. If you are running a long book over months, NeuroBook's file, story and Agent structure fits better.

## Common Questions

**Can I use it only to manage the worldbuilding and write the prose myself?**

Yes, and it is a perfectly valid way to work. World Engine, the promise ledger, decision records and consistency audits do not require the AI to write anything for you — you write the prose in the editor and let the AI only check whether it contradicts earlier chapters and remind you which setup is overdue. Switch the Agent to [discuss mode](/en/agent/modes) and it will offer ideas without touching the manuscript.

**Can I publish what the AI writes as-is?**

Not recommended. The AI here is an assistant, not a ghostwriter: it is good at organizing material, verifying details, brainstorming with you and drafting a skeleton, but the call on the finished text is yours. [llmlint](/en/core/llmlint) exists specifically to catch the "AI smell" — the fact that it exists tells you the problem is real. Platform policies on AI-generated content differ, so check yours before you publish.

**I already have a pile of drafts and an Excel worldbuilding sheet. Can I bring them in?**

The prose, yes: `manuscript/` is an ordinary directory, so copy your `.txt` / `.md` files in chapter by chapter, or run the [book deconstruction workflow](/en/agent/workflow) and let the AI split it into chapters and write the summaries. There is no one-click Excel import for worldbuilding sheets; in practice you paste the table to the Agent and have it write entries following the structure of `lorebook/`.

**What does it require from my machine?**

The Windows portable build contains everything needed to run. An ordinary laptop is enough and no GPU is required — **the model runs in the cloud**; your machine only edits and stores. What it takes up is basically your own manuscript plus SQLite, which is tiny. Only building from source (`source-product` / `source-docker`) needs a serious amount of memory; see [Deployment](/en/deployment).

## The Core Workflow

A typical run looks like this:

1. Create a Project Workspace.
2. Organize characters, places, organizations, rules and notes in `lorebook/`.
3. Initialize World Engine: set up the timeline and record the opening state.
4. Plan threads and scenes in the Plot Workbench, and register your setups as promises.
5. Once the story is signed off, advance World Engine, then have writer write prose into `manuscript/`.
6. After writing, backfill the world facts you just created and run llmlint over the style.

NeuroBook is not trying to make every decision for you. It is trying to break a complicated creative process into units of work you can see, revisit and pick back up.

## How It Differs from Ordinary Tools

An ordinary AI chat tool only knows the current conversation. NeuroBook keeps the work in a Project Workspace and lets the Agent read and modify real files under tool permissions.

An ordinary Markdown editor manages text. NeuroBook also manages content nodes, references, story structure and the Agent collaboration process itself.

An ordinary project management tool records tasks. In NeuroBook, the tasks, the worldbuilding, the prose and the story structure all serve novel writing.

## About AI Roleplay

Early versions shipped AI roleplay (RP) and world simulation modules. **The current version has removed the RP entry points from the regular interface** while it is redesigned to the standard set by writing mode; there is no timeline yet. The related profiles and data structures remain in the codebase.

SillyTavern character card import still works, but what you get afterwards is **material for novel writing** — it does not start an RP session.

## Next Steps

- Want to get it running first: read [Quick Start](/en/quick-start).
- Want to see the core capabilities: [World Engine](/en/core/world-engine), [Plot Workbench](/en/core/plot-workbench), [Markdown Studio](/en/core/markdown-studio), [llmlint](/en/core/llmlint).
- Choosing a deployment method: read [Deployment](/en/deployment).
- Want to understand the Agent: read [the Agent mental model](/en/agent/).
