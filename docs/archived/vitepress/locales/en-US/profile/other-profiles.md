# Other Profiles

Beyond leader and writer, NeuroBook ships a set of specialized profiles. They all exist for the same reason: to narrow the boundary of responsibility so each agent only handles what it is good at.

## retrieval

`retrieval` is the agent for content node recall and candidate judgment. It takes a natural language prompt, searches content nodes such as `lorebook/` and `manuscript/`, and returns candidate entries as a structured result.

The leader reads `entries[].path`, `reason`, `use` and `risk`, then decides which paths go to the writer. Do not hand retrieval's full analysis to the writer as-is.

## researcher

`researcher` handles online research. `leader.default` has no direct web search capability of its own; anything that needs current material, prices, policies, versions, news or source verification should go to the researcher.

The researcher normally returns plain Markdown results with source links rather than using `report_result`.

## summarizer

`summarizer` is a background profile that generates session titles and summaries. It does not save its own assistant/tool transcript into the main history; instead it reads the source dialogue runtime-only and writes back to the source session's metadata.

## leader.assets

`leader.assets` helps you maintain the profiles, Skills, templates, profile default home resources and config override layers under `workspace/.nbook`. It is the right agent for explaining how user-assets works, creating a profile template or checking profile compilation status.

## world.engine

`world.engine` handles maintenance and validation of a complex World Engine, using `execute_world` in readwrite mode. Day-to-day writing does not need it — `leader.default` can advance world state by itself. Reach for it only for schema design, bulk corrections or tracking down a stubborn issue.

## inline.editor

`inline.editor` is the profile behind Inline AI in Markdown Studio. It runs on its own background session, so it neither occupies the main Agent session nor pops the Agent panel open.

## memory.curator

`memory.curator` produces memory patches for the `subject_memory_update` tool. It is invoked by the tool layer, not created directly by users.

## Simulation Profiles (entry points taken down)

::: warning
`simulator.leader`, `simulator.actor` and `rp.writer` belong to the RP / world simulation system. They are **hidden from the New Agent menu** and are being redesigned to the standard set by writing mode. The profile files and existing sessions are kept.

`simulator.actor` currently exposes only `report_result`, and neither retrieves nor saves memory automatically. The Subject RAG data and tools are still there but have **no built-in consumer**; see [Subject RAG Memory](/en/agent/subject-rag-memory).
:::

## Keep Reading

- [Agent Reference](https://github.com/notnotype/neuro-book/blob/master/packages/neuro-book/assets/reference/agent/README.md)
- [Agent Workflows and Jobs](/en/agent/workflow)
