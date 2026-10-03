# From SillyTavern to a Writing Agent Harness: NeuroBook Exploration Notes

This article is not a systematic introduction to NeuroBook. That belongs in the tutorials, the Reference and the product docs.

::: warning These are exploration notes, not a description of the current version
The three-layer RP / world simulation structure described here is a design direction. **The current version has removed the RP entry points from the regular interface** and the product has narrowed onto long-form writing. For what actually works today, see [Core Capabilities](/en/core/world-engine) or the [Tutorials](/en/tutorials/).
:::

What this records is a process of exploration: why I came to think existing AI writing tools were not enough, why the SillyTavern model hits a ceiling in long-running writing and RP, why code agents pointed somewhere new, and why NeuroBook ended up as a "writing-specialised Agent Harness".

## Where It Started: The Big Flaw in the SillyTavern Model

SillyTavern's character card ecosystem is genuinely strong. It proved something: an author can package a world, its characters, its rules and its mechanics into distributable content, and a user can load it and start playing.

Look at it as a system, though, and the core is still close to single-turn generation:

```text
character card + preset + worldbook + current chat + plugin injections
-> one LLM call
-> one reply
```

For lightweight RP that works very well, but a few problems are baked in.

First, a turn contains only one real generation. Prose, character reactions, narration, plot movement and state changes are all crammed into the same call. Once the model is done the user sees only the result; there is nowhere to insert review, critique, polishing or a rewrite. Even if the provider does some polishing of its own, it happens invisibly and never becomes a workflow you can control.

Second, the prompt is enormous. The character card, the preset, the lorebook, variables, the status bar and dynamic plugin data all get concatenated into the context. Every variable change, every shift in lorebook recall, every status bar update can invalidate the cache, which hits time to first token and the feel of the whole interaction.

Third, there is no strong memory system by design. Long-term memory usually comes down to manual summaries, chat digests, a plugin database or some external system. Summarizing relieves the context length pressure, but summarizing itself introduces loss, distortion and something you cannot audit.

Fourth, past a certain number of lorebook entries the model runs out of attention. A context window large enough to hold everything does not mean the model has actually "read and retrieved every entry". It is still predicting the next token, and it will happily skip a rare but load-bearing detail, a hidden condition, or the boundary of what a character is allowed to know.

Fifth, characters end up omniscient. Most character card worldbooks are written from a god's-eye view, yet the prose comes out of the same LLM. It reads the GM's truth, plays the character and writes the user-visible text all at once. With a large context, holding "who knows what" steady is beyond it.

Put together, these say the core tension in SillyTavern is not that "the model is not a good enough writer". It is that one generation is carrying far too many jobs.

## What Agents Changed: Retrieval Should Not Rest on Attention

Code agents offered an important lesson.

A good code agent does not stuff the entire repository into context and then trust attention to guess right. It uses tools first — `rg`, file reads, tests, type checks — to locate the relevant files and the relevant context, and only then edits.

That solves one piece of the problem for a writing system: retrieval.

In creative writing we should not expect a model to notice every relevant piece of worldbuilding inside one gigantic prompt either. The saner shape is:

```text
current task / current story state / current user action
-> actively retrieve the relevant lorebook, manuscript, Plot and simulation state
-> assemble the context this turn actually needs
-> then generate or adjudicate
```

It is the same instinct as a code agent searching for the relevant functions, types and tests before it edits.

But a code agent only solves part of it. It is good at repositories because a repository comes with structure for free: files, functions, types, tests, call graphs, stack traces. Creative writing has no such shared structure. Anyone can bend a general-purpose Pi agent or code agent into their own writing setup, and in the short term that works — but the barrier is high, and it never produces a content standard that others can read, distribute or migrate.

That is where I think NeuroBook is needed: not porting a code agent over to writing, but building a domain structure for writing and RP.

## Why Writing Needs Its Own Agent Framework

AI writing is not structureless. We have simply not been modelling the structure explicitly.

A novel project has to answer at least these questions:

- Where does the worldbuilding live?
- Where does the prose live?
- Where does the current story state live?
- Which material is god's-eye truth?
- Which material is something a character already knows?
- Which items are only a type, and which are stateful instances?
- In an imported character card, which parts are stable canon and which are dynamic scripting?
- What should the writer be handed before it writes prose?
- Once the prose is written, who commits the state changes?

Without a shared convention, distributing content is hard. When one author publishes a character card, a worldbook or a novel project, the next person cannot tell which files are canon, which are temporary state, which are prompt tricks, which are variable UI, and which are information a character is allowed to have.

In that ecosystem the SillyTavern worldbook carries far too many jobs:

- It handles ordinary lore recall.
- It initializes MVU variables.
- It holds the variable update rules.
- It renders variables and the status bar.
- It may contain prompt templates.
- It may contain game mechanics, locations, factions, events, character sheets and formatting requirements.

That is enormous freedom for a creator, and it is also where the pressure on migration and long-term maintenance comes from.

NeuroBook's direction is to keep the freedom and give each job a clearer place to live.

## The Root Cause Behind Information Control

One of the hardest problems in RP is information control.

At a real tabletop the ownership is obvious: the GM knows the truth of the world, and a player knows only what their character could plausibly know. Players reason, misread, guess, and get told what they observe — but a player does not get to leaf through the GM's notes on the truth.

In AI RP that boundary breaks easily, and the reason is that in the SillyTavern model every line of prose comes from one LLM. That LLM sees the god's-eye lorebook, the character prompt, the chat so far and the live variables, and then produces the user-visible text in one pass.

A human writer reasons like this:

```text
This blacksmith lives in the city, so he probably knows what slime gel is ordinarily used for;
but he is no alchemist, so he has no business knowing what it really does in the forbidden rite.
```

An LLM does not work that way. It does not first maintain a strict knowledge graph of who knows what and then speak from a character's viewpoint. It mostly predicts the next token given the context. The larger that context and the more god's-eye material inside it, the more likely it is to write down something that should have stayed hidden.

So information control cannot rest on one line in the prompt saying "do not reveal secrets". The flow of information has to be controlled in the structure of the content and in the agent pipeline.

## A Real Worldbook Entry

I went through a lot of worldbook entries from SillyTavern character cards. Take this file:

```text
workspace/gong-li-yu-lu-xue-yuan/reference/silly-tavern/命定之诗与黄昏之歌v4.2/worldbook/entries/000601-DLC-角色-天原绘璃奈-天原绘璃奈(OwO-人造龙姬，活跃于艾瑟嘉德学院区).md
```

It records one character's basics, backstory, appearance, personality, goals and motives, combat ability and personal effects. Part of that backstory: she is the "artificial dragon princess" of the Aethergard academy district, born out of a joint experiment, with no parents in any biological sense — the academy's scholars are as close as it gets. The outside world does not know the real purpose behind her creation, and she is still asking the same question herself.

This is plainly god's-eye truth. It suits the author, the GM and the simulator leader, but it does not belong in front of every character, and certainly not unfiltered in front of the user's own character.

Philosophically, a character inside a story never gets the truth itself. They get observations, rumours, misunderstandings, evidence, inferences, and whatever fragment the GM chooses to pass on.

So the lorebook's place is canon / prototype / truth source. What a character can actually use has to come from their own experience, knowledge, psychology and state.

That is why NeuroBook later separated `lorebook/` from `simulation/subjects/`.

## Prototypes and Entities: A Blood Potion, and a Poisoned One

Here is a smaller example: the blood potion.

As a consumable type, its general definition belongs in the lorebook:

```text
lorebook/item/consumable/blood-potion/
```

That is where the omniscient rules go: that it usually heals wounds, the going price, the ingredients, the side effects, what happens if you drink three in a row.

If a character carries three ordinary blood potions, there is no need to instantiate anything three times. The character's `state.md` can simply record:

```yaml
inventory:
  - prototype: lorebook/item/consumable/blood-potion/
    subjectVisibleName: Blood Potion
    quantity: 3
    subjectKnownEffect: commonly used to heal wounds
```

But if one of them has been poisoned, it is no longer just part of a count. It has its own state, a hidden truth and narrative stakes, so it becomes an entity:

```text
simulation/entities/poisoned-blood-potion-001/
```

That entity's `state.md` records the real state:

```yaml
holder: simulation/subjects/npc-a/
condition:
  poisoned: true
subjectVisibleName: Blood Potion
subjectVisibleProperties:
  - looks no different from an ordinary blood potion
```

Whether NPC-A knows it is poisoned is not decided by the entity. It is decided by NPC-A's own `memory.jsonl` and `events.jsonl`.

That is the heart of prototype / instance plus subject-facing view:

- `lorebook/` holds prototypes, rules and omniscient canon.
- `simulation/entities/` holds stateful instances.
- `simulation/subjects/` holds what a subject has seen, knows, misunderstands and has lived through.

## From One Generation to a Chain You Can Inspect

In the SillyTavern model the prose comes out of a single model call. The experience is immediate, but writing loses a step it needs: review.

Human writing is rarely "write it once and that is the final draft". The natural flow is:

```text
writer -> critic -> writer
```

Or, stretched out a little:

```text
plan -> draft -> critique -> revise -> final
```

In LLM research this pattern goes by critique-and-revise, Self-Refine, or the Reflexion family. Like ReAct, it stops treating the model as a one-shot text generator and lets it think, act, observe and correct across several steps.

Writing needs that loop more than most tasks.

The writer drafts. The critic checks pacing, information release, character motivation, consistency with canon and style. The writer rewrites against that feedback. If all of it happens invisibly inside a provider, the user has nothing to inspect; if it happens explicitly inside an Agent Harness, the user can see every step, pause every step, and replace every step.

Which is why NeuroBook should not be in the business of building a bigger prompt. What it needs is a composable agent pipeline.

## The Overall Direction NeuroBook Arrived At

Pull those threads together and what NeuroBook is exploring is a writing-specialised agent framework.

This is not a rejection of SillyTavern. Quite the opposite: SillyTavern proved the value of character cards, worldbooks and a creator ecosystem. NeuroBook wants to take one more step — to break those assets into a structure that can be maintained for the long haul, retrieved from, migrated, and worked on by several agents at once.

The direction that has held up best so far:

```text
external material -> reference/
stable canon      -> lorebook/
final prose       -> manuscript/
live world state  -> simulation/
story structure   -> Plot System
collaboration     -> Agent Harness
```

In writing mode, `leader.default` reads the user's intent and calls retrieval, writer, researcher or a simulation tick as needed. The writer does not maintain world state; it is responsible for chapter prose and nothing else.

In RP mode, `simulator.leader` acts as GM / simulator leader and dispatches `simulator.actor` and `rp.writer`. The actor never reads the full lorebook; it consumes a filtered GM packet. The writer only renders user-visible prose and makes no GM rulings.

Importing a SillyTavern character card runs in stages:

```text
inspect -> unpack -> import
```

inspect only looks at the overview. unpack preserves the raw material. import moves stable worldbook entries into the lorebook and archives the dynamic machinery into reference, where it waits to be migrated into simulation mechanics.

The point of this design is not the directories themselves. It is the separation of duties:

- The lorebook no longer does everything.
- The writer no longer does everything.
- The actor is no longer forced to be omniscient.
- The GM / simulator leader owns information filtering and world adjudication.
- The Harness turns retrieval, review, memory persistence and state commits into steps that actually run.

## Why the Harness Is Not Optional

Left to the prompt, most of a design is just hoping the model complies. The harness turns some of that hope into structure.

For instance:

- Which messages get written into history?
- Which context is visible only to this turn's model call?
- Which retrieval runs stay out of the main conversation?
- Which tools is each agent allowed to use, given its role?
- After the actor responds, how do `events.jsonl`, `memory.jsonl` and `mind.md` get saved?
- Does the writer's output go to the critic and come back for revision?
- Who commits state changes, and where do they go?

Answer all of that inside one prompt and the system quickly degenerates into an enormous string of concatenated instructions. It is slow, and worse, it cannot be inspected, composed or distributed reliably.

What the harness does is break the writing process into units that run, that you can observe, compose and replace. It is what lets NeuroBook move step by step from "AI writes a passage" to "AI takes part in a long-running creative system".

## In Summary

NeuroBook's starting point was simple: existing AI RP and AI writing tools cram far too much into a single model call.

SillyTavern opened the door to content distribution with character cards and worldbooks, but single-turn generation, oversized prompts, weak memory, weak retrieval, weak information control and polishing you cannot inspect all become bottlenecks on a long project.

Code agents pointed somewhere else: the model can retrieve first and act second, it can use tools, it can split a hard task into steps. Creative writing cannot reuse a code agent's structure directly, though. It needs its own file conventions, story structure, lorebook protocol, information control model and writing workflow.

That is NeuroBook's direction:

- Use `lorebook/` for stable god's-eye canon.
- Use `simulation/subjects/` for a character's own knowledge, experience, psychology and state.
- Use `simulation/entities/` for stateful instances.
- Use `reference/` to keep external material and the evidence behind a migration.
- Use `manuscript/` to hold the finished prose.
- Use an Agent Harness to organize retrieval, writer, critic, actor, GM and state commits.

The goal is not to have the AI generate a longer block of text in one shot. It is to move AI writing into a system that can be searched, reviewed, remembered, distributed and maintained over the long term.

## Keep Reading

- [Agent Runtime Hooks](https://github.com/notnotype/neuro-book/blob/master/packages/neuro-book/assets/reference/agent/runtime-hooks.md)
- [Subject RAG Memory](https://github.com/notnotype/neuro-book/blob/master/packages/neuro-book/assets/reference/content/subject-rag-memory.md)
- [Novel Writing Workflow](https://github.com/notnotype/neuro-book/blob/master/packages/neuro-book/assets/reference/agent/novel-writing-workflow.md)
- [Content Reference](https://github.com/notnotype/neuro-book/blob/master/packages/neuro-book/assets/reference/content/README.md)
- [Agent RP Mode Task](https://github.com/notnotype/neuro-book/blob/master/packages/neuro-book/.agents/tasks/01-agent-roleplay-mode/README.md)
