# Workflows and Jobs

A workflow orchestrates several agents with a **replayable TypeScript script**. A Job is the background unit of work that carries a long task's lifecycle.

Both solve the same class of problem: some work does not fit into one conversation — it needs concurrency, loops, several rounds of review, or ten minutes of runtime.

## When to Use a Workflow

**Use a workflow when:**

- The same multi-stage process runs again and again (book splitting, parallel brainstorming, a write-review loop)
- You need fixed fan-out, join, loop or human confirmation points instead of letting the main agent improvise
- The run has to show you a state chart
- You need a custom result plus the participating sessions and token usage back in one go

**A child agent is enough when:**

- There is one short task and it hands the result back
- The process is still being explored and the steps will change a lot with what you find
- You do not need replayable orchestration, concurrency control or a state chart

::: tip Skill vs. Workflow
A Skill provides **knowledge and method** (how to do it); a workflow provides **fixed execution orchestration** (in what order, how many in parallel, how many rounds). Do not build a workflow just to package a block of instructions.
:::

## Built-in Workflows

| Key | What it does |
| --- | --- |
| `parallel-brainstorm` | Parallel brainstorming: several temporary agents produce ideas at once, then the output is merged and deduplicated |
| `write-review-loop` | The write-review loop: write → review → revise |
| `chapter-write-review-revise` | The full chapter-level chain: a real writer writes the chapter into the target file under contract, three reviewers run concurrently on consistency, pacing and style, and revision loops on major issues until it converges |
| `consistency-audit` | Consistency audit: chapter-by-chapter concurrent audits of location, injuries, items, knowledge, timeline and setting contradictions, then a cross-chapter roll-up |
| `split-book` | Book splitting: concurrent per-chapter summaries plus a merged plot analysis |
| `book-deconstruct` | Commercial deconstruction: samples chapters and breaks each one down by hook, promise, payoff, pacing, information reveal and end-of-chapter push, producing a competitor analysis report |
| `character-qa-fanout` | Batch character Q&A candidates: generates several candidate answers per question in concurrent groups and collects the contradictions |

An agent sees the available list through the `WorkflowCatalog` and triggers one with `run_workflow`.

## Adhoc Agents

Most steps in a workflow do not need a full built-in profile — they only need a prompt and an output shape. These temporary agents are called **adhoc**: declare a prompt and an outputSchema and it runs, then it is discarded without ever landing in the profile directory.

`chapter-write-review-revise` is a deliberate exception: its writing step uses the **real `writer` profile**, because the chapter has to be genuinely written to disk under the leader-writer contract, and an adhoc agent cannot carry that.

## Background Jobs and the Jobs Center

`run_workflow` **runs in the background by default**. On trigger the agent immediately gets a job handle and ends its turn normally — it does not sit there spinning for a result. When the job finishes, the result **flows back** as a system message and triggers a new turn of the conversation.

An agent has three job tools: `list_jobs`, `get_job` and `cancel_job`. `invoke_agent` and `bash` also take a `background` parameter and go through the same mechanism.

Your entry point is **Jobs** in the top bar:

- The badge shows how many jobs are running
- The panel can group and filter by status, show details, copy results, cancel a job and clear finished records

While a workflow runs, a dedicated bubble in the chat shows its state chart; double-click it to open the full run details.

::: warning Cancellation semantics
Cancellation is bounded. For a provider or tool that does not respond to an interrupt signal, the system forces closure at the boundary, and late writes already in flight are not committed. After a cancellation, the job and run status follow the run's real terminal state.
:::

## Writing Your Own Workflow

Each workflow owns one directory, and the entry point is always `workflow.ts`:

```text
agent/workflows/
└── my-workflow/
    └── workflow.ts
```

Three-layer overrides, addressed by key:

| Layer | Location |
| --- | --- |
| System built-in | Ships with NeuroBook |
| User layer | `.nbook/agent/workflows/<key>/workflow.ts` under the Workspace Root |
| Project layer | `.nbook/agent/workflows/<key>/workflow.ts` under the current project root |

On a name collision **the whole entry is replaced**, not merged. The project layer is read only when the caller explicitly binds that project — a project workflow never leaks into another project.

A workflow that users run must provide a `wf.chart` state chart, so the run can be watched.

## Keep Reading

- [Workflow Reference](https://github.com/notnotype/neuro-book/blob/master/packages/neuro-book/assets/reference/agent/workflow/README.md): when to use one, directory overrides, the `run_workflow` contract.
- [Writing Workflows](https://github.com/notnotype/neuro-book/blob/master/packages/neuro-book/assets/reference/agent/workflow/authoring.md): definitions, parameters, concurrency, return values and determinism constraints.
- [State Chart Spec](https://github.com/notnotype/neuro-book/blob/master/packages/neuro-book/assets/reference/agent/workflow/chart.md): the `wf.chart` API and charting conventions.
- [Agent Tools](/en/agent/tools): where `run_workflow` and the job tools sit.
