# Agent Harness

The Agent Harness is NeuroBook's Agent runtime kernel. It creates sessions, prepares profile context, calls the model, executes tools, writes the JSONL session, and handles linked agents, queues, SSE and runtime hooks.

An ordinary author does not need to understand the Harness first. You only need this page when you are debugging Agent behavior, writing a profile, analyzing session events, or designing a new runtime mechanism.

## The Run Path

A normal invocation roughly goes through:

1. Create or resume a session.
2. Validate the profile initial.
3. Run the profile's `context()` to produce a `ProfileTurnPlan`.
4. Assemble system, history, model context, appending context and the current user input.
5. Call the provider.
6. Execute tools or linked agents.
7. Write the transcript, runtime state and session projection.
8. Publish state to the frontend over SSE.

## Runtime Hooks

Runtime hooks split behaviors like profile prompt, session context, transcript persistence, report_result and compact into composable mechanisms. Multi-stage side work is no longer executed inline by a runtime hook; it goes to an explicit Workflow and a background Job.

This keeps a profile from having to stuff all of its runtime logic into the prompt, and it lets the Harness handle things explicitly at stages such as prepareRun, prepareTurn, ingestTurn, prepareNextTurn and settleRun.

## Sessions and SSE

Agent sessions use JSONL append-only storage, and the frontend syncs current state through a snapshot plus SSE events. Reconnect, waiting, follow-up, steer and abort all rely on the Harness maintaining one consistent runtime projection.

## Keep Reading

- [Runtime Hooks](https://github.com/notnotype/neuro-book/blob/master/packages/neuro-book/assets/reference/agent/runtime-hooks.md): implementation reference for the five lifecycle stages.
- [Agent SSE](https://github.com/notnotype/neuro-book/blob/master/packages/neuro-book/assets/reference/agent/sse.md): the frontend sync event contract.
- [Harness Black-Box Contract](https://github.com/notnotype/neuro-book/blob/master/packages/neuro-book/.agents/tasks/18-agent-runtime-pipeline-hooks/HARNESS-BLACK-BOX-CONTRACT.md): the external behavior contract for prompt / continue / steer / followup.
- [How Agent Context Is Assembled](https://github.com/notnotype/neuro-book/blob/master/packages/neuro-book/assets/reference/agent/context.md): how the context for one invocation is put together.
