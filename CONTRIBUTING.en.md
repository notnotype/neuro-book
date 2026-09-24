# Contributing to NeuroBook

[中文](CONTRIBUTING.md)

This guide is for human contributors and covers the public path from reporting a problem to submitting a Pull Request (PR). Coding agents read [`AGENTS.md`](AGENTS.md) and [`.omp/RULES.md`](.omp/RULES.md); detailed coding and maintainer rules live under [`docs/standards/`](docs/standards/).

## Before You Start

Choose the entry that matches the change:

- Typo fixes, broken links, and small documentation corrections that do not change meaning may go directly to a PR.
- A small, well-defined bug should reference an issue; use “Bug report” if none exists.
- New features, cross-module changes, data-shape changes, and runtime contract changes require a “Feature request”; start after a maintainer marks it `status: ready`.
- Profile, Skill, Workflow, and prompt contributions use “Prompts and built-in Agent assets”.
- Installation and usage questions use “Usage and installation question”.
- If no category fits, use “Other issue”; it is not a way to bypass private security reporting or required design discussion.
- Do not open a public issue or PR for a vulnerability. Follow the [security policy](.github/SECURITY.md) and use private vulnerability reporting.

Issue acceptance approves a direction, not a specific implementation or delivery date. If you offer to implement, wait for `status: claimed` before starting so work is not duplicated.

## Local Development

You need Git, [Bun](https://bun.sh/), and tools required by the target platform. The repository root only keeps governance, documentation, and release orchestration commands; application commands run inside the main application package. Install and start with:

```bash
bun install
bun run --cwd packages/neuro-book dev
```

Choose checks that cover the change:

```bash
bun run --cwd packages/neuro-book test -- path/to/relevant.test.ts
bun run --cwd packages/neuro-book typecheck
bun run --cwd packages/neuro-book build
bun run docs:check
bun run docs:build
```

Commands for other packages are defined in each package's `package.json`.

List exact commands and results in the PR; mark omitted checks as “not run.” Focused tests, full tests, builds, browser verification, and real-provider acceptance are distinct evidence.

Use Bun consistently and check existing dependencies before adding one. Do not commit `.env`, `config.yaml`, Project Workspaces, manuscript content, API keys, sessions, traces, databases, caches, or unredacted logs. Do not run release commands, change versions, create `chore(release)` commits, or contribute material you cannot redistribute.

## Find the Right Specification

Confirm the current contract before editing:

| Entry | Purpose |
|---|---|
| [`docs/specs/README.md`](docs/specs/README.md) | Registry for current behavior, data, interfaces, failures, and acceptance |
| [`docs/specs/foundation/terminology.md`](packages/neuro-book/docs/specs/foundation/terminology.md) | Standard Workspace, runtime, storage, and Agent terminology |
| [`docs/standards/code/README.md`](docs/standards/code/README.md) | Route changes to frontend, server, desktop, scripts, database, or package standards |
| [`docs/testing/README.md`](docs/testing/README.md) | Tests, temporary roots, environment, acceptance, and evidence |
| [`docs/adr/`](packages/neuro-book/docs/adr/) | Reasons behind accepted architecture decisions |
| [`.agents/works/`](.agents/works/README.md) | Current Work/Task: scope, process, and evidence for major implementations; `.agents/tasks/` only keeps historical records |
| [`PROJECT-STATUS.md`](PROJECT-STATUS.md) | Repository state and current acceptance gaps |
| [`RELEASE.md`](RELEASE.md) | Current release payload consumed by release tooling |

`packages/neuro-book/assets/reference/` is the application seed source for product Agent/Profile Reference; Profiles keep the logical `reference/**` paths, while explicit Runtime resolves the physical root through the Runtime Asset Adapter. The spec registry tracks its migration. Do not infer a full current contract from an issue title, one code path, a Proposal, or a Task.

## Issues and Implementation Authorization

The five issue forms automatically add one `type:*` and `status: needs-triage`; The prompt form also adds `area: agent`. Every open issue keeps exactly one `type:*` and one `status:*`:

- `status: needs-triage`: awaiting first review.
- `status: needs-info`: missing reporter information; triage again after a response.
- `status: needs-design`: direction or contracts are unsettled; implementation must not start.
- `status: ready`: scope is accepted and may be claimed.
- `status: claimed`: a specific implementer is authorized; do not start parallel work.
- `status: blocked`: an external prerequisite blocks progress; return to the accurate state afterward.

Use `help wanted` and `good first issue` only with `status: ready`; a good first issue must also be small, self-contained, and independently verifiable. External contributors do not allocate Task numbers by default; maintainers assign them when needed.

## Prepare a Change

- Branch from the latest `master`; do not force-push maintainer branches or rewrite another contributor's commits.
- Keep one coherent problem per PR; exclude unrelated formatting, dependency upgrades, upstream merges, and opportunistic fixes.
- Reuse existing components, types, errors, and tests; update the current spec when product behavior changes.
- Test behavior, boundaries, failures, and state transitions; redact logs, screenshots, and test data before upload.
- Route file and Project Workspace operations through existing authorization, normalization, and containment boundaries.
- Recommended Conventional Commit types are `feat`, `fix`, `docs`, `refactor`, `test`, `build`, `ci`, and `chore`.

Maintainer Issue, Task, worktree, sibling, vendor, and merge workflows are documented in [`docs/standards/repository-workflow.md`](docs/standards/repository-workflow.md).

## Pull Request

Use the repository template and state: the linked issue; scope and explicit exclusions; user-visible behavior and affected contracts; exact verification commands and results; checks not run and known limitations; data, configuration, installation, security, and privacy impact; and screenshots/recordings or “browser verification not run” for frontend work.

Before starting, confirm the issue is not `status: claimed` or assigned to someone else. A small documentation fix allowed to go directly to PR may use “none”; other changes follow the issue requirements above. Green CI means automated checks completed, not that merge is approved.

## Review and Merge

Respond directly to behavioral issues, risks, and test gaps with current contracts and evidence. Maintainers may reduce scope, request evidence, or reopen interface discussion; they own final scope, Task numbering, release notes, and merge method.

Do not merge, close issues, deploy, or release unless a maintainer explicitly authorizes it. A PR may close when direction changes, it remains inactive, its scope is too large, or it cannot be verified; a smaller, clearer contribution may start later.

## License

By submitting code, documentation, or other material, you confirm that you have the right to contribute it and agree that it will be released under the repository's [GNU Affero General Public License v3.0 only](LICENSE). The project does not require a CLA or DCO.
