---
layout: home

hero:
  name: "NeuroBook"
  text: "Long-form writing deserves an IDE"
  tagline: Almost everyone has a novel in them, and most of them die halfway. Not from a lack of talent — from a lack of engineering. Worldbuilding, setups, prose and AI collaboration, all in one workspace you can actually see.
  actions:
    - theme: brand
      text: Download and Install
      link: /en/quick-start
    - theme: alt
      text: Write Your First Book
      link: /en/tutorials/
    - theme: alt
      text: What Is NeuroBook
      link: /en/introduction
    - theme: alt
      text: 简体中文
      link: /

features:
  - title: 🌍 Your world stops contradicting itself
    details: The arm that got severed last volume does not grow back on its own. World Engine records world state as a timeline of slices, so the state of any character, faction or inventory count at any moment is computed rather than remembered — which means it never drifts. Adding backstory is just inserting a slice at the right moment, so flashbacks and revelations come for free.
  - title: 🧵 Setups you plant actually get paid off
    details: "Planted a gun in chapter 3 and still not fired by chapter 200? The promise ledger tracks every setup as a debt you owe the reader: planted, advanced, fulfilled — all auditable, and it flows into the writing brief when you reach the target chapter. Want a romance beat every few chapters? Track that too, and it will tell you it has been thirty chapters."
  - title: 🗂️ The manuscript is your own files
    details: Worldbuilding lives in lorebook/, prose lives in manuscript/ — plain local Markdown files plus one project SQLite database. Any editor can open them, and moving house is copying a directory. No cloud lock-in and no export feature needed, because they were files all along.
  - title: ✍️ A whole AI writing crew
    details: Not one chat box doing everything. leader plans and dispatches, writer writes prose, retrieval looks up your worldbuilding, researcher checks external sources — so numbers are not invented (the engine has them on the books) and facts are not guessed (it goes and checks). Discuss mode gives ideas without touching the manuscript; plan mode proposes first and executes only after you approve.
  - title: 🧹 Strip out the AI smell
    details: Lint your prose the way eslint lints code. llmlint ships 360 rules covering filler words, mechanical transitions, formulaic parallelism, hollow summaries and other AI tells. Static rules scan a full manuscript in seconds, and mechanical issues can be fixed automatically. It works as a polishing skill inside the editor and as a standalone CLI.
  - title: 🧭 An assistant that has read the manual
    details: You do not have to master a complex tool. The built-in assistant has read the entire documentation set — ask it "what should I do first on a new book" or "how do I register a setup" and it will teach you, or just do it for you. The only skill required is typing.
  - title: 💻 Runs on your own machine
    details: Unzip and run on Windows; container or Bun on Linux and macOS. The database is a local SQLite file, you bring your own model provider and API key, and token spend is broken out by input / output / cache so you can see exactly what a chapter cost.
---

## Where to Start

**Not installed yet?** Read [Quick Start](/en/quick-start) — Windows users unzip and run, and you can be writing in five minutes. To choose a deployment method or install on a server, read [Deployment](/en/deployment).

**Already installed?** Go to [From Your First Book to Chapter Three](/en/tutorials/): create a project, build the worldbook, initialize the world engine, and write the first three chapters.

**Want to understand it first?** Read the [Introduction](/en/introduction), or go straight to the four core capabilities: [World Engine](/en/core/world-engine), [Plot Workbench](/en/core/plot-workbench), [Markdown Studio](/en/core/markdown-studio), [llmlint](/en/core/llmlint).

## Documentation Map

- [Introduction](/en/introduction): what NeuroBook is, who it is for, and how it differs from an ordinary AI chat tool.
- [Quick Start](/en/quick-start): download, launch, configure a model — the shortest path.
- [Tutorials](/en/tutorials/): from your first project to chapter three, in six sessions.
- [Core Capabilities](/en/core/world-engine): World Engine, Plot Workbench, Markdown Studio and llmlint in depth.
- [Guides](/en/guide/settings): settings, themes, change history, account and cloud backup.
- [Agent](/en/agent/): the mental model behind agents, sessions, profiles, skills, workflows and the three modes.
- [Profile](/en/profile/): what each built-in profile does and where its boundaries are.
- [Profile TSX](/en/profile-tsx/): write your own agent profile.
- [Deployment and Operations](/en/deployment): installation, starting and stopping, where your data lives, privacy boundaries.
- [Design Notes](/en/blog-agent-rp-harness): why writing is split across multiple agents.

## About AI Roleplay

Early versions of NeuroBook shipped AI roleplay (RP) and world simulation modules. **The current version has removed the RP entry points from the regular interface** while it is redesigned to the standard set by writing mode; there is no timeline yet. The related profiles, data structures and historical material all remain in the codebase.

SillyTavern character card import **still works**: an `inspect → unpack → import` three-step flow that archives the original card and its worldbook intact and moves stable settings into the worldbook. What you get afterwards is **material for novel writing** — it does not start an RP session. See [Import a Character Card](/en/tutorials/05-import-character-card).

## More Entry Points

- [Release History](/en/changelog/): what changed in past versions and what to watch out for when upgrading.
- [NeuroBook Reference Bookshelf](https://github.com/notnotype/neuro-book/blob/master/packages/neuro-book/assets/reference/README.md): stable references written for implementers.
- [Agent Reference](https://github.com/notnotype/neuro-book/blob/master/packages/neuro-book/assets/reference/agent/README.md): implementation contracts for sessions, profiles, tools, skills and workflows.
- [English README](https://github.com/notnotype/neuro-book/blob/master/README.en.md): the project's English entry on GitHub.
