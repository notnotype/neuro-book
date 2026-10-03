# NeuroAgentHarness

`@notnotype/neuro-agent-harness` is a multi-host Agent Harness. It provides profiles, a run kernel, append-only sessions, invocations, approval, compaction, tool loops, event recovery, and replaceable Session Store and Model Runtime ports.

## Install

```bash
bun add @notnotype/neuro-agent-harness@0.1.0
```

Node.js 22 ESM projects can install it with npm. The package ships ESM, type declarations and user documentation.

## Public Surface

The root export contains Harness, Profile, Tool, Capability, Session/Event/Model contracts, workflow helpers and error types. `storage/memory`, `storage/jsonl` and `testing` are explicit subpaths. Persistence, providers, SSE/HTTP, file authorization and host product concepts remain Adapter responsibilities.

See the [project README](https://github.com/notnotype/neuro-book/blob/master/packages/neuro-agent-harness/README.md) for invariants, recovery semantics and custom Store requirements.
