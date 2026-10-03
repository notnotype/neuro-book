# Novel Writing Workflow And Emulation

## User Request

- 先规范写作流程：提供标准流程，但具体怎么走仍由 `leader` 和用户决定。
- 列出当前限定写作流程的相关 skill，并考虑重新命名为更清晰的 workflow step，例如 `novel-workflow-step-01-*`。
- 明确写作流程中 emulation 的定位：主要在推进剧情、剧情设计、判断当前状态时使用。
- `leader.default` 熟悉项目后，如需要设计剧情，可以启动 emulator，根据用户指令或自动判断做世界模拟，得到下一 tick 的剧情。
- emulator 应可在项目初始化后由用户选择初始化。
- 设计 `emulation/runs` / 当前 `simulation/runs` 的 tick 产物结构。
- runs 文件数需要在 AI 易编辑和分类明确之间取舍；第一版接受 `report.md + prose.md`。
- `rp.writer` 写给用户看的正文应单独保存到 `prose.md`。当前 RP 合同已收紧：`rp.leader` 只组装正文链接和元场景，不直接写世界内正文。未来 workflow/runtime 支持后，`input.md` 等机械文件可由系统自动生成。

## Current Outcome

已把讨论同步到稳定 reference：

- [../../../reference/agent/novel-writing-workflow.md](../../../reference/agent/novel-writing-workflow.md)
- [../../../reference/agent/project-workspace-guide.md](../../../reference/agent/project-workspace-guide.md)
- [../../../reference/content/directory-protocol.md](../../../reference/content/directory-protocol.md)

本轮只同步文档，不改实际 skill 目录名、profile 合同或 Project 模板。

后续实现计划已经单独进入：

- [../32-novel-workflow-emulation-implementation/README.md](../32-novel-workflow-emulation-implementation/README.md)

## Decisions

- 写作模式采用“推荐标准流程”，不是固定流水线；`leader.default` 可以根据用户意图跳步。
- 普通 `writer` profile 继续只负责章节正文，不自动读取或维护 `simulation/`。
- 写作中的 `emulation` 是世界运行态推进概念；当前落地目录仍是 `simulation/`。是否把目录重命名为 `emulation/` 后续单独设计。
- `leader.default` 可以在写作模式下维护 `simulation/`，但应把它当作世界状态 commit，而不是普通草稿。
- emulation 主要在剧情推进、角色/势力/地点反应判断、信息差、实体状态变化和写后状态提交时使用。
- 项目初始化后可新增 `emulation bootstrap` skill，用于初始化 subjects、entities、当前状态和 000000 tick，但不推进剧情。
- `世界模拟` 应拆分或重命名为 `novel-workflow-06-emulation-tick`，负责推进一个 tick。
- 小说 skill 后续建议分为三类：`novel-workflow-*`、`novel-technique-*`、`novel-import-*`。
- runs 第一版推荐 `simulation/runs/ticks/{id}-{slug}/report.md` + `prose.md`。
- `report.md` 保存后台推演、裁决、状态提交、信息边界、writer-safe brief、未决问题和下一步钩子。
- `prose.md` 保存用户最终看到的正文。RP Tick 应保存 `rp.writer` 输出的完整正文；`rp.leader` 只组装正文链接和元场景。正式章节正文仍以 `manuscript/.../index.md` 为主。
- `input.md`、`actor-packets.json`、`commits.json`、`tool-log.json` 等机械产物暂不要求 Agent 手写；未来 workflow/runtime 可以自动生成。

## Proposed Skill Renaming

| Proposed Key | Current Skill | Purpose |
| --- | --- | --- |
| `novel-workflow-01-idea-exploration` | `小说灵感探索流程` | 从模糊灵感整理成故事雏形。 |
| `novel-workflow-02-project-bootstrap` | `小说初始化流程` | 建立故事概念、简介和最小 lorebook 骨架。 |
| `novel-workflow-03-lorebook-bootstrap` | `世界书初始化流程` | 建立开篇可用的稳定世界说明书。 |
| `novel-workflow-04-character-design` | `角色设计流程` | 深化主角、配角、反派、势力代表。 |
| `novel-workflow-05-emulation-bootstrap` | 新增建议 | 初始化世界运行态目录、subjects、entities 和当前 tick。 |
| `novel-workflow-06-emulation-tick` | `世界模拟` 拆分建议 | 根据当前状态推演下一 tick，产出 run report 和状态提交。 |
| `novel-workflow-07-opening-plot-design` | `开局剧情设计` | 把 lorebook + emulation 当前状态转成开篇可执行剧情。 |
| `novel-workflow-08-plot-planning` | `剧情规划流程` | 中长期剧情讨论、结构拆分和 Plot System 落点。 |
| `novel-workflow-09-chapter-writing` | 新增建议 | 调用普通 writer 写章节正文。 |
| `novel-workflow-10-revision` | 新增建议 | 章节修改、节奏检查、局部重写和润色。 |

## Proposed Runs Shape

```text
simulation/runs/
|-- current.md
|-- index.md
`-- ticks/
    |-- 000001-night-market-riot/
    |   |-- report.md
    |   `-- prose.md
    `-- 000002-after-escape/
        |-- report.md
        `-- prose.md
```

`report.md` 是 leader / simulator 的创作判断文件。`prose.md` 是用户可见正文文件。这个组合比单文件更利于长正文复用，也比多文件 tick 更适合 AI 维护。

## Follow-ups

- 决定是否从 `simulation/` 真实重命名为 `emulation/`，或继续保留 `simulation/` 作为统一目录名。
- 根据新命名方案重命名或复制系统 skills，并处理 user-assets 同步影响。
- 新增 `novel-workflow-05-emulation-bootstrap` skill。
- 拆分或重写 `世界模拟` 为 `novel-workflow-06-emulation-tick`。
- 更新 Project 模板，把 `simulation/runs/ticks/000001/` 示例改为 `000001-short-slug/report.md + prose.md`。
- 更新 `leader.default` prompt，让它知道写作流程中的 emulation 决策点。
- 如需自动生成 `input.md`、`commits.json`、`tool-log.json`，在 workflow/runtime 机制中设计，而不是让 Agent 手工维护。

## Files Changed

- `docs/tasks/31-novel-writing-workflow-emulation/README.md`
- `reference/agent/novel-writing-workflow.md`
- `reference/agent/project-workspace-guide.md`
- `reference/agent/README.md`
- `reference/content/directory-protocol.md`
- `reference/README.md`

## Verification

- 本次为设计文档同步，未修改运行代码、profile、skill 目录或模板。
- 未运行代码测试。
