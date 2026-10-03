# Subject RAG Memory (legacy)

::: danger Current status: not wired up
This is the first-generation long-term memory mechanism from the RP / world simulation era. **There is no built-in consumer today.** The data structures, the index and the three low-level tools are all still here, but the built-in `simulator.actor` exposes only `report_result` and neither retrieves nor saves memory by itself, and the RP entry points have been removed from the regular interface.

Read it as a low-level capability a future workflow or job could wire up, not as a feature you can use now. **You do not need this page to write a novel** — in writing mode the source of truth for world state is the [World Engine](/en/core/world-engine).
:::

Subject RAG is not a search over the whole book, and it is not a lorebook search. It only helps one `simulator.actor` recall what it has been through and how it currently sees certain people and events.

## What It Solves

In long-running RP, a character easily loses their memory, or turns omniscient because they have seen too much god's-eye worldbuilding. Subject RAG separates the two problems:

- A character's experiences and stable beliefs are written into their own subject files.
- The actor's main run does not read those files in full.
- An explicit external flow can retrieve a few relevant memories, compress them into actor-safe context, and inject that through an actor-facing message.
- The main run acts only on the actor-safe information it was explicitly given.

That way a character can recall their past without automatically knowing hidden truths held in the lorebook, in entities, or in other subjects.

## Subject Files

Every important character, player protagonist or faction representative should have their own subject directory:

```text
simulation/subjects/{subject-id}/
|-- subject.md
|-- soul.md
|-- events.jsonl
|-- memory.jsonl
|-- mind.md
`-- state.md
```

The files have distinct roles:

| File | Purpose |
| --- | --- |
| `subject.md` | The omniscient secret dossier. Only `simulator.leader` may read it; it holds hidden truths and dispatch hints, and it never enters the actor's main path or the RAG index. |
| `soul.md` | A first-person roleplay handbook (no frontmatter), imported straight into the actor's main run as its identity. It holds only what the character knows about itself, no secrets, and never enters the RAG index. |
| `events.jsonl` | The experience stream, one line per experience, observation, thing overheard, misunderstanding or inference. |
| `memory.jsonl` | Stable beliefs, one line per topic recording the character's current view. |
| `mind.md` | Current psychology, emotions, doubts and short-term motives. |
| `state.md` | Current location, physical condition, possessions, short-term goals and visible status. |

There is no intermediate file for initializing memory: when a subject is created, `simulator.leader` writes the cold-start experiences straight into `events.jsonl` and the cold-start stable beliefs straight into `memory.jsonl`.

On the subject side, `events.md` / `knowledge.md` are an old contract. The current runtime no longer reads them and does not migrate them automatically.

## Two Layers of Long-Term Memory

`events.jsonl` is like the character's diary. It records how they experienced and understood something at the time, and it does not have to be tidy facts from the start:

```jsonl
{"time":"Morning of the first day of school","text":"I was about to be late when a girl with pink hair gave me a hand. I still do not know her name; I only felt I should find a chance to thank her."}
{"time":"Before the first class","text":"During roll call I heard the teacher call the pink-haired girl Elena. I remembered the name, but I have not fully connected her with the girl who helped me that morning."}
```

`memory.jsonl` holds the character's current stable view:

```jsonl
{"topic":"Elena","aliases":["the girl with pink hair","the girl who helped me that morning"],"view":"I have realized that Elena is the pink-haired girl who helped me on the morning of the first day of school. She kept me from being late, so I feel clear gratitude and closeness toward her."}
```

`events.jsonl` suits appending; `memory.jsonl` suits updating, merging, renaming and deleting.

## The Current Actor Integration Boundary

The `simulator.actor` main run does not read `events.jsonl` or `memory.jsonl` in full, and today there is no automatic flow retrieving them on its behalf either. A single call consumes only `soul.md`, the current actor-facing message, and whatever actor-safe information the caller has already put into that message explicitly.

A future workflow or job should complete this chain explicitly:

1. Build a retrieval query from the current actor-facing packet.
2. Use `subject_rag_search` to search the current subject's `events` and `memory` separately.
3. Rerank, deduplicate, filter and compress into actor-safe context.
4. Inject the actor-safe context through an actor-facing message.
5. After the actor returns, have the external flow call `subject_event_append` / `subject_memory_update` under explicit rules.

The repository does not yet ship this built-in automatic workflow. So configuring an embedding service or preparing JSONL files will not, on its own, give an actor long-term memory.

## The RAG Index

Subject RAG uses a rebuildable cache inside the project:

```text
{project}/.nbook/subject-rag.sqlite
```

The source of truth is still `events.jsonl` and `memory.jsonl`. The index only speeds retrieval up and can be deleted and rebuilt; deleting it does not delete a character's memory.

Retrieval is confined to the current subject. In implementation the index is partitioned by `subject_path` and `source_type`, so an actor cannot recall another subject's private memory.

When memory is written, the tools only mark the source dirty. Before the next `subject_rag_search`, the source hash and dirty flag are checked and the matching index is rebuilt synchronously if needed.

If you switch the embedding model or its dimensions, the old index fails loudly. The first-version remedy is to delete `{project}/.nbook/subject-rag.sqlite` and let the next search rebuild it.

## Embedding Settings

Subject RAG needs its own embedding service. It does not use Pi's chat / vision model catalog.

Open the `Embedding` tab in settings:

- Global scope configures an OpenAI-compatible embedding service, API key, base URL, model name and dimensions.
- Project scope can only override the model name and dimensions for the current project.

The RAG call:

```text
POST {baseURL}/embeddings
```

If embeddings are not enabled, or the model, dimensions, API key or base URL is missing, `subject_rag_search` fails loudly rather than quietly falling back to keyword search.

Configuration errors like that only surface when `subject_rag_search` is called explicitly. The current actor run never triggers retrieval on its own, so the absence of errors is no proof that long-term memory is working.

## Scope

The first version of Subject RAG does only this:

- Search the current subject's `events.jsonl`.
- Search the current subject's `memory.jsonl`.
- Provide the low-level capability for an explicit workflow or job to build an actor-safe memory digest.
- Provide append and curation tools for a controlled external memory maintenance flow.

For now it does not do:

- lorebook RAG.
- Project-wide RAG.
- GraphRAG.
- An automatic who-knows-what knowledge graph.
- Automatic migration of the old `events.md` / `knowledge.md`.

## Keep Reading

- [Agent Workflows and Jobs](./workflow.md)
- [Agent Tools](./tools.md)
- [Subject RAG Reference](https://github.com/notnotype/neuro-book/blob/master/packages/neuro-book/assets/reference/content/subject-rag-memory.md)
