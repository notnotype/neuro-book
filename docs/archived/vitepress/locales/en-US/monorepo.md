# Monorepo Layout

The repository root owns workspace orchestration, unified documentation, CI, governance, installation, delivery, releases and the Desktop Envelope. The main application is `packages/neuro-book`. Autonomous packages own their source, tests, Tasks and engineering documentation.

| Owner | Contents |
| --- | --- |
| `packages/neuro-book` | NeuroBook application, app scripts, app Tasks and system runtime references |
| `packages/neuro-book-manager` | Installation, updates, instances and Runtime management |
| `packages/neuro-book-contracts` | Cross-host wire and data contracts |
| `packages/neuro-book-test-support` | Shared test temporary roots and fixture support |
| Six autonomous projects | `neuro-agent-harness`, `llmlint`, `nb-history`, `nb-workflow`, `nb-memory`, `nb-ui` |
| `desktop` | Electron, Tauri, shared host code and portable packaging |
| `vitepress` | Bilingual user documentation for the entire monorepo |

Run `bun install --frozen-lockfile` at the repository root. Develop the main app with `bun --cwd packages/neuro-book run dev`; package-specific commands are linked from [Projects](/en/projects/). The engineering boundary source remains `docs/modules/monorepo-boundaries.md` in the repository and is not duplicated into the public site.
