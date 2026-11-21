<div align="center">

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/images/readme/neurobook-lockup-horizontal-reversed.svg" />
  <img src="docs/images/readme/neurobook-lockup-horizontal-color.svg" width="420" alt="NeuroBook" />
</picture>

**The creative writing IDE that gets your novel finished.**

[Install](#install-and-run) · [Write a plugin](#write-a-plugin) · [Roadmap](#roadmap) · [Discord](https://discord.gg/bSQB7mNpHB) · QQ Group 287447372

[![npm](https://img.shields.io/npm/v/@notnotype/neuro-book?label=npm)](https://www.npmjs.com/package/@notnotype/neuro-book)
[![License: AGPL v3](https://img.shields.io/badge/License-AGPL%20v3-blue.svg)](LICENSE)
[![Discord](https://img.shields.io/badge/Discord-join%20community-5865F2?logo=discord&logoColor=white)](https://discord.gg/bSQB7mNpHB)
![QQ Group](https://img.shields.io/badge/QQ%20Group-287447372-12B7F5?logo=qq&logoColor=white)

[简体中文](README.md) · **English**

</div>

<img src="docs/images/readme/mascot.webp" align="right" width="170" alt="NeuroBook's mascot: a white-haired cat-eared girl holding a star staff" />

Everyone has a novel in them, and most of those novels die halfway — not from lack of talent, but from lack of engineering. NeuroBook wants to turn thirty years of software engineering practice and a century of creative writing methodology into one set of tools shared by you and your AI. Your work lives in local Markdown files — take it anywhere.

> [!NOTE]
> **This is the v2 preview (0.11).** NeuroBook is being rebuilt from scratch per [NeuroBook v2: side-by-side rebuild](docs/proposals/neuro-book-v2-rebuild.md): first a solid foundation — workbench, files and editors, settings and plugins — then AI writing, the World Engine and the plot workbench, one at a time (see the [roadmap](#roadmap)). Software and APIs will still change; feedback is welcome.

<br clear="right" />

## Install and run

Requires [Bun](https://bun.sh) 1.4.4 or newer (NeuroBook runs on Bun only).

```sh
bun add -g @notnotype/neuro-book
nbook
```

`nbook` starts the local server in the foreground and opens your browser; Ctrl-C stops it, and running it again opens the instance that is already running. The server listens on loopback only; on a remote machine, forward it with `ssh -L 4217:127.0.0.1:4217 <host>`. Data lives in your platform's data directory (`~/.local/share/neuro-book` on Linux), and books default to `NeuroBook` under your documents folder (`~/NeuroBook` when there is none). Options, data locations and upgrades are described in the [app package notes](packages/neuro-book/scripts/app-package/README.md) (Chinese).

## What it does today

- **Bookshelf**: the home page when no book is open — stats, where you left off, and the mascot on your desk; create a book, open an existing folder, change covers and details.
- **Workbench**: activity bar, sidebars, editor area, panel and status bar; views can be dragged elsewhere and maximized, and the layout is remembered; command palette (`Ctrl/Cmd+Shift+P`) and quick open.
- **Files**: an explorer for plain, content and binder folders, with drag and drop, rename and batch operations; changes made outside the app show up immediately.
- **Editors**: a Markdown editor that reads and writes your book's dialect (Chinese typesetting rules, unknown syntax kept as is), plus a source editor, an image viewer and a sandboxed HTML preview; unsaved changes are guarded when switching or closing.
- **Settings**: a settings window organized by section, with separate user and book layers, or edit the settings file directly.
- **Plugins**: views, commands, menus, status bar items and settings sections are all open to plugins — the built-in features are plugins too. Install from the plugins page or with `nbook plugin install`; changes apply after a restart.

<img src="docs/images/readme/bookshelf.webp" width="100%" alt="The bookshelf: writing stats, where you left off, the mascot and book cards" />

<img src="docs/images/readme/workbench.webp" width="100%" alt="The workbench: chapters in the explorer on the left, chapter one open in the Markdown editor on the right" />

## Write a plugin

<img src="docs/images/readme/mood-write.webp" align="right" width="64" alt="" />

Plugins are written in TypeScript and Vue. The SDK package `@notnotype/nb-plugin-sdk` ships the author command `nbooke`; no global install needed:

```sh
bunx -p @notnotype/nb-plugin-sdk nbooke create my-plugin
cd my-plugin && bun install
bun run build
nbook plugin install dist
```

The generated plugin adds a view to the sidebar, a command to the palette and an entry to settings — change it and it's yours. Author docs, the available APIs and example plugins are in the [SDK author guide](packages/neuro-book/plugin-sdk/README.md) (Chinese). Plugins are fully trusted and can access all your books and local resources; install only from sources you trust.

## Roadmap

<img src="docs/images/readme/mood-idea.webp" align="right" width="64" alt="" />

AI can write a good paragraph, but not a good novel: lore lives in chat memory and drifts; the gun planted in chapter 3 still hasn't fired by chapter 200; the prose reads like AI; and drafts, lore and plot discussions are scattered across three tools. The previous version (0.10.x) tackled these as engineering problems; v2 is rebuilding them one by one on the new foundation. These are **not in v2 yet**:

- **AI writing studio**: a leader plans and dispatches, a writer drafts prose, a researcher looks things up; discuss, plan and execute modes, each switch needing your approval; inline edits in the editor.
- **World Engine**: event sourcing with timelines and snapshots — the state of any character, faction or kingdom at any moment is computed from earlier changes, and adding lore means inserting a snapshot.
- **Plot workbench**: a carrier tree for where the story is told and a causal tree for why it happens; foreshadowing tracked as promises from setup through payoff; creative decisions recorded on the spot.
- **llmlint**: lint your manuscript the way eslint lints code — 360 rules for filler words, mechanical transitions, formulaic parallelism and other AI tells. Available on its own today: [notnotype/llmlint](https://github.com/notnotype/llmlint).
- **Desktop app**: its own window and a bundled runtime, no Bun install needed.

Usable on its own today: the story graph `nbstory`, which turns a novel into a spoiler-free memory graph you can query by reading position, with a CLI, a web viewer, built-in Q&A and a Skill for Claude Code and Codex (`bun add -g @notnotype/nb-story`; see [nb-story](packages/nb-story/README.md)).

Every design has a source — proven software engineering practice on one side, creative writing theory on the other:

| NeuroBook feature        | Software engineering heritage                | Creative writing heritage                                    |
| ------------------------ | -------------------------------------------- | ------------------------------------------------------------ |
| World Engine             | Event Sourcing (Martin Fowler)               | The Story Bible                                              |
| Promise system           | Technical debt tracking (Ward Cunningham)    | Chekhov's gun; Sanderson's promise / progress / payoff       |
| Chapter information control | Least privilege / information hiding      | Hitchcock's bomb under the table                             |
| Carrier / causal trees   | Separation of concerns                       | fabula / sjuzhet                                             |
| Creative decision records | ADRs (Michael Nygard)                       | The Chinese commentary tradition (Jin Shengtan, Zhiyanzhai)  |
| llmlint                  | lint (Bell Labs, 1978)                       | Orwell, "Politics and the English Language"                  |
| Three modes + approval   | Code review, plan / apply                    | Editorial review                                             |

## Previous version

0.10.x (Windows portable build, NeuroBook Manager, Docker) is on [Releases](https://github.com/notnotype/neuro-book/releases) and no longer maintained; its documentation is in [`docs/archived/`](docs/archived/vitepress/locales/en-US/index.md).

## npm packages

All published under `@notnotype` on npm, Bun only, licensed AGPL-3.0-only. The app and the SDK ship build output ([ADR 0033](docs/adr/0033-app-delivered-as-built-npm-package.md)); the rest ship source ([ADR 0029](docs/adr/0029-workspace-packages-publish-source-to-npm.md)).

| Package | Contents |
|---|---|
| [`@notnotype/neuro-book`](packages/neuro-book/scripts/app-package/README.md) | The NeuroBook app and the `nbook` command |
| [`@notnotype/nb-plugin-sdk`](packages/neuro-book/plugin-sdk/README.md) | Plugin SDK and the `nbooke` author command |
| [`@notnotype/nb-story`](packages/nb-story/README.md) | Story graph: the `nbstory` CLI, local web viewer and Q&A, a Skill for external agents |
| [`@notnotype/nb-harness`](packages/nb-harness/README.md) | Agent harness: profiles, tools and a run |
| [`@notnotype/nb-profile`](packages/nb-profile/README.md) | Profile definition, loading and JSX rendering |
| [`@notnotype/nb-session`](packages/nb-session/README.md) | Agent session logs |
| [`@notnotype/nb-flock`](packages/nb-flock/README.md) | Process-level exclusive file lock, released when the process exits |
| [`@notnotype/nb-runtime`](packages/nb-runtime/README.md) | Kernel: lifecycle, services, plugins, startup gates, diagnostics, remote services |
| [`@notnotype/nb-ui`](packages/nb-ui/README.md) | Vue base components and themes (compiled by the host with Vite and Tailwind v4) |
| [`@notnotype/nb-agent-ui`](packages/nb-agent-ui/README.md) | Agent conversation view |
| [`@notnotype/nb-form`](packages/nb-form/README.md) | Forms drawn from a data schema |
| [`@notnotype/nb-markdown`](packages/nb-markdown/README.md) | Markdown language, codecs and components |

## Contributing to NeuroBook

Run from source: `bun install` at the repository root, then `bun run dev` in `packages/neuro-book`. Package responsibilities and dependency directions are in [Monorepo module boundaries](docs/modules/monorepo-boundaries.md), the workflow in the [contributing guide](CONTRIBUTING.md), and the current state in [PROJECT-STATUS.md](PROJECT-STATUS.md) (all in Chinese).

## Community

- 💬 Discord: https://discord.gg/bSQB7mNpHB
- 🐧 QQ group: 287447372

Come say hi — feature requests, bug reports, or just tell us about the book you're writing.

## License

NeuroBook is free and open-source software licensed under the [GNU Affero General Public License v3.0 only](LICENSE), identified by the SPDX expression `AGPL-3.0-only`. The license permits use, study, modification, distribution, and commercial use. Modified versions that are distributed or made available to users over a network must provide the corresponding source code under the AGPLv3.

Brand images — the logo, wordmark and mascot — are provided under the same license ([sources](docs/images/readme/README.md)). Original works created, edited, or published with NeuroBook do not automatically become subject to the AGPL merely because the software was used. Independently licensed third-party components in this repository remain under their respective licenses. Copyright © 2026 notnotype.

## Star History

<a href="https://www.star-history.com/?repos=notnotype%2Fneuro-book&type=date&legend=top-left">
 <picture>
   <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/chart?repos=notnotype/neuro-book&type=date&theme=dark&legend=top-left&sealed_token=ago-VvdvFFQoL3gwjchdv-mcsM5c6Jq5jL8IHxVu4HwYL6d45RujQKDxAzgV-pzxLGddtmU92wJo44_ZhFx-zOI0MXUc46jN6Dq27ZwiLyXfoBdUYSJlVQ" />
   <source media="(prefers-color-scheme: light)" srcset="https://api.star-history.com/chart?repos=notnotype/neuro-book&type=date&legend=top-left&sealed_token=ago-VvdvFFQoL3gwjchdv-mcsM5c6Jq5jL8IHxVu4HwYL6d45RujQKDxAzgV-pzxLGddtmU92wJo44_ZhFx-zOI0MXUc46jN6Dq27ZwiLyXfoBdUYSJlVQ" />
   <img alt="Star History Chart" src="https://api.star-history.com/chart?repos=notnotype/neuro-book&type=date&legend=top-left&sealed_token=ago-VvdvFFQoL3gwjchdv-mcsM5c6Jq5jL8IHxVu4HwYL6d45RujQKDxAzgV-pzxLGddtmU92wJo44_ZhFx-zOI0MXUc46jN6Dq27ZwiLyXfoBdUYSJlVQ" />
 </picture>
</a>
