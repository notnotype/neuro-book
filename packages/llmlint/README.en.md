# llmlint Development Repository

`llmlint` is a Chinese text linter for LLM output. It uses deterministic rules to locate likely AI-writing patterns, then lets a person or Agent judge and repair them in context.

This repository root is the **development workspace** (`llmlint-dev`) for tests, evaluations (`evals/`), and the detection website (`web/`). The installable and publishable Agent Skill / CLI package lives in [`skill/`](./skill/) (package name: `llmlint`) and is the runtime source of truth.

| Surface | Location | Purpose | Documentation |
| --- | --- | --- | --- |
| **Skill / CLI** | [`skill/`](./skill/) | Installable engine, rules, and command line | [`skill/README.en.md`](./skill/README.en.md) |
| **Development workspace** | Repository root | Tests, type checking, and evaluation harness | This file + [`evals/README.md`](./evals/README.md) |
| **Detection website** | [`web/`](./web/) | Browser-local detection and judgment collection | [`web/README.md`](./web/README.md) |

---

## Requirements

- **Bun >= 1.3**, or **Node >= 22.19 + `tsx`**
- **Git**

---

## For Users

Use `llmlint` as an Agent Skill / CLI to detect and revise AI-writing patterns in Chinese text.

### Install

The recommended installation uses the `skills` CLI:

```bash
npx skills add notnotype/llmlint --skill llmlint --full-depth
```

For manual installation, copy [`skill/`](./skill/) into your Agent's skills directory as `llmlint/`. On first activation, install dependencies in the skill root before running any llmlint CLI command:

```bash
cd skill
bun install --frozen-lockfile
```

At runtime, the agent prefers the absolute skill root supplied by its catalog; if the host only exposes a `SKILL.md` locator, it uses that file's parent directory. It does not depend on a fixed `.nbook`, `.claude`, or `.codex` install path. `skill/package.json.version` is the skill version source of truth.

`SKILL.md` treats this as a dependency gate before `status`. Later uses reuse the installation while the dependency fields and `bun.lock` contract remain valid and `node_modules` exists. Version, prompt, rule, or source-only updates do not trigger reinstall.

### Configure

No additional configuration is required after dependencies are installed. See [`skill/references/cli-usage.md`](./skill/references/cli-usage.md) for CLI options, output formats, and the JSON schema.

### Data and privacy

`contribute` only writes a local outbox and does not upload in this version. `detect` is a separate external path: it sends uncached text chunks to the configured service (an HF Space by default), but sends no filename or project path. `sharing.off` does not disable `detect`, and llmlint cannot control remote logging or retention. See [`skill/README.en.md#data-sharing-and-privacy`](./skill/README.en.md#data-sharing-and-privacy) for tiers and withdrawal.

### Web scan boundary

Browser-local detection and server-side MachineScan currently execute only locatable regex+handler spans. Density rules remain visible in the registry but do not enter Web `hitsJson` or `docScore`. Use CLI `check` or Agent `lint_check` for the complete regex+density+handler static scan.

### Run

```bash
# From the skill/ directory
bun bin/llmlint.ts check <file>      # Native Bun
npx tsx bin/llmlint.ts check <file>  # Node + tsx
```

---

## For Developers

Use the repository root to modify the engine, rules, or evaluations. Use `web/` to develop the detection and data-collection site.

### Install

```bash
# Repository root: tests, evals, and development tooling
bun install

# Website dependencies are declared separately
cd web && bun install
```

The website has its own dependencies and SQLite database; root installation does not install `web/node_modules`.

### Configure

The development workspace itself needs no configuration. Initialize the website environment and database from `web/` before first use:

```bash
cp .env.example .env                     # Adjust DATABASE_URL / NUXT_AUTH_ENABLED / NUXT_SESSION_PASSWORD as needed
bun run db:init && bun run db:generate   # 1. Create tables  2. Generate the Prisma client
```

Run `db:init` before starting the website. Repeat it only after deleting the database or adding migrations. `DATABASE_URL` must be present in `.env`.

The external AIGC detector and LLM Agent channels are optional. They read `evals/eval.config.json` from the repository root; if the file is absent, those channels are disabled without affecting other features:

```bash
cp evals/eval.config.example.json evals/eval.config.json
```

- `datasetsRoot`, `proxy`, and CLI relay addresses are placeholders; replace them for your environment.
- `detector` configures the external AIGC detector. Set `proxy` where required, or remove it for direct access.
- `repair.model` and `classifier.model` select the LLM channels.
- `modelsConfig` points to a NeuroBook-compatible model configuration containing API keys. Never commit API keys.

Restart the development server after changing channel configuration.

### Run

From the repository root:

```bash
bun test               # Vitest suite
bun run typecheck      # TypeScript without emit
bun run verify         # Typecheck + tests + CLI smoke checks
bun run eval:fixture   # Run fixture evaluation into .agent/evals/fixture-report
```

Run the website from `web/`, or use the root forwarding script:

```bash
cd web && bun run dev  # Builds registry/report, then starts Nuxt (default: http://localhost:3000)
bun run web:dev        # Equivalent from the repository root
```

Further reading:

- [`web/README.md`](./web/README.md) describes the Nuxt 4 SPA, Nitro API, authentication, persistence, build-time registry, and deployment.
- [`evals/METHODOLOGY.md`](./evals/METHODOLOGY.md) is the evaluation methodology; [`evals/README.md`](./evals/README.md) documents the harness commands.
- `evals/` is a tracked development asset, but `evals/corpus/` is intentionally ignored because the source corpus is not publishable. Put temporary output under `.agent/evals/` or `evals/tmp/`.
- [`CONTEXT.md`](./CONTEXT.md) defines project terminology and invariants. [`PROJECT-STATUS.md`](./PROJECT-STATUS.md) tracks current work and follow-ups.

---

## NeuroBook system assets

[`skill/`](./skill/) is the sole llmlint Skill source. The NeuroBook monorepo projects runtime assets from this directory while preparing Source/Product system assets; no sibling mirror or manual sync command is maintained.

---

## License

This development repository and the installable [`skill/`](./skill/) package are licensed under the [GNU Affero General Public License v3.0 only](./LICENSE), identified by the SPDX expression `AGPL-3.0-only`. Copyright © 2026 notnotype.
