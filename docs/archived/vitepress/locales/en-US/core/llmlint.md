# llmlint Prose Linting

Readers spot AI writing instantly. Filler words, mechanical transitions, formulaic parallelism, the summary paragraph that says everything and nothing — these are not "bad writing", they are **recognizable template marks**.

llmlint lints a manuscript the way eslint lints code.

## What it checks

360 rules (266 enabled by default), covering the typical tells of AI writing:

- Filler words and redundant modifiers
- Mechanical transitions and boilerplate connective tissue
- Formulaic rhetorical questions, binary contrasts, three-part parallelism
- Hollow summaries and one-size-fits-all endings
- Monotonous rhythm, repetitive sentence shapes

Rules are classified along two axes. **Review method** is agent (needs a judgement call in context), human (the author has to decide) or none (mechanically decidable). **Fixability** is auto (can be rewritten automatically), candidate (offers options) or manual (a human has to do it).

## Two layers of detection

**Static rules** scan a full manuscript in seconds and produce stable, reproducible candidate locations. They are fast, but they are **evidence, not a verdict**.

**LLM rules** make the contextual call — the same sentence pattern is rhythm in a page-turner and abuse in literary fiction. Static rules cannot tell those apart; a model can.

The role of each layer is explicit: **a hit does not mean change it**. The goal is not to drive the hit count to zero, it is to shed template weight that serves no purpose while keeping the facts of the original, its story function, its character voices and its stylistic intent. Driving P(AI) to 0 while wrecking the writing is a failure, not a success.

## How to use it

**Inside the editor**: llmlint is a built-in Skill, so you can simply ask the Agent to run it on the current chapter. The Agent runs the static pass, reviews the hits in context, and produces a fix plan — **you see it before anything changes**.

**As a standalone CLI**:

```bash
llmlint check <file or glob>   # check; multi-file, Markdown masking, JSON / compact output
llmlint fix <file>             # mechanical auto fixes only
```

`check` supports Markdown masking, so code blocks and link URLs stay out of detection.

## The limits of fixing

Automatic fixing **only touches the mechanical auto class**. Anything that needs a judgement call is never changed silently, because the cost of a wrong fix far exceeds the cost of a missed one.

Agent-assisted fixing goes through approval: plan first, you approve, only then does it touch the manuscript. Hard calls can be written down as local learning notes, so the same kind of case does not have to be argued out again next time.

## It is a standalone project

llmlint has its own repository and license and can be used entirely outside NeuroBook, on any Chinese LLM output:

- Repository: [notnotype/llmlint](https://github.com/notnotype/llmlint)
- What ships inside NeuroBook is a runtime copy of it, distributed alongside NeuroBook

Rules can be overridden by namespace or one at a time, and different tasks can be configured with different rule sets.

## Further reading

- [Markdown Studio](/en/core/markdown-studio): where the manuscript is written.
- [Agent Tools](/en/agent/tools): how an Agent calls a Skill.
