# llmlint

`llmlint` uses deterministic rules to locate patterns in Chinese LLM output, then leaves contextual repair decisions to a person or Agent. The installable Skill and CLI live under the project's `skill/` directory.

## Install

```bash
npx skills add notnotype/llmlint --skill llmlint --full-depth
```

Install dependencies once in the skill root, then run:

```bash
bun install --frozen-lockfile
bun bin/llmlint.ts check <file>
```

`check` performs the complete static scan. `detect` is a separate external detection path that sends uncached text blocks to the configured service; `contribute` currently writes only to a local outbox. Read the [data and privacy contract](https://github.com/notnotype/neuro-book/blob/master/packages/llmlint/skill/README.md) before enabling those paths. CLI arguments and JSON schemas are in the [usage reference](https://github.com/notnotype/neuro-book/blob/master/packages/llmlint/skill/references/cli-usage.md).
