# Leader

A leader profile is responsible for reading your intent, picking a workflow, invoking Skills and coordinating other agents. The entry point for ordinary writing is `leader.default`; the entry point for maintaining user assets is `leader.assets`.

## leader.default

`leader.default` is the main entry point for an ordinary novel project. It can:

- Work out whether you are initializing a project, organizing the lorebook, planning story, writing a chapter, polishing or importing material.
- Read the SkillCatalog and open the matching `SKILL.md` when it needs to.
- Call `retrieval` to pick the relevant worldbuilding for the writer.
- Create or reuse a `writer` to write finished chapters.
- **Manage the Thread / Scene / Chapter Plot of the main writing chain.**
- **Use `get_chapter_writer_brief` to compile a complete chapter brief for the writer, including Scene / World Context.**
- Advance the World Engine's dynamic world state and timeline.
- Call `researcher` for anything that needs the internet or up-to-date material.
- Trigger a Workflow for multi-stage orchestration; see [Workflows and Jobs](/en/agent/workflow).

`leader.default` should not do everything itself. Its value lies in judging when to hand work to a specialized profile.

The default writing chain is:

```text
story design → you sign off → advance World Engine → update plot structure → call writer for prose → backfill after writing
```

## simulator.leader (entry point taken down)

::: warning
`simulator.leader` is the dispatcher for RP / world simulation. It is **hidden from the New Agent menu** and is being redesigned. Existing sessions and the profile files are kept. The RP Tick protocol is still documented in the [rp-tick reference](https://github.com/notnotype/neuro-book/blob/master/packages/neuro-book/assets/reference/agent/rp-tick/README.md).
:::

## leader.assets

`leader.assets` is aimed at the user-assets workspace. It helps you understand and maintain profiles, Skills, a profile's default home resources, templates and override layers.

It is not the same thing as the ordinary novel leader, and it should not take on chapter writing directly.

## Keep Reading

- [Leader Default Operational Protocol](https://github.com/notnotype/neuro-book/blob/master/packages/neuro-book/assets/reference/agent/leader-default.md)
- [Novel Writing Workflow](https://github.com/notnotype/neuro-book/blob/master/packages/neuro-book/assets/reference/agent/novel-writing-workflow.md)
