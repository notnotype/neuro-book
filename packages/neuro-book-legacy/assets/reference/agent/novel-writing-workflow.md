# Novel Writing Workflow

本文定义普通写作模式的 skill 体系和主协作链。World Engine 是写作模式下动态世界状态与时间线的唯一真相源；旧 `simulation/` / `emulation` 流程只作为 legacy RP 或历史维护资料保留（skill 已归档到 `packages/neuro-book/docs/archived/skills/`）。Plot System 在普通写作模式下只作为 Scene / Chapter 结构层，由 `leader.default` 管理，不保存第二份动态世界状态。

完整 World Engine 原理与 leader/writer 协作契约见 [../world-engine/workflow.md](../world-engine/workflow.md)。写作 skill 的全局路线图是 Bundled Workspace Template 中的 `novel-guide` skill；本文与它保持同一口径。

## Current Contract

当前普通写作链路由 `leader.default` 直接负责 Plot / Scene、World Engine 推进、writer brief 编译和 writer 调度，正文写作由普通 `writer` profile 执行。

- `leader.default` 负责和用户讨论剧情、确认 canon、推进 World Engine、维护 Thread / Scene / Chapter Plot、选择必要 lorebook、编译 `get_chapter_writer_brief`，并调度 `writer`。
- `director` 只保留为高级或手动剧情导演 profile；不是普通写作主链必经节点。
- `writer` 是章节正文 agent，不是剧情导演、世界模拟 agent 或状态写入 agent。
- `writer` 创建 initial 为空；每轮通过 `invoke_agent.message` 接收写作 brief，通过 `invoke_agent.input` 接收唯一目标 `path` 和建议读取清单。
- `writer` 拥有只读 `execute_world`，只能查询 World Engine；不能写入、删除或编辑 slice。
- `writer` 不直接持有 Plot tools，不读取 `simulation/` 作为普通写作状态源；payload 里遗留的 `threadIds` / `sceneIds` / `plotIds` 兼容字段会被忽略。需要 Scene / World Context 时，由上游把完整 brief 写进 `invoke_agent.message`。
- `writer` 不默认展开全项目 lorebook；只按 brief 判断是否读取 `lorebookEntries` / `readablePaths`。
- 写作前，leader 应先完成“剧情初步设计 -> 推进 World Engine -> 剧情设计 -> 更新 Plot -> get_chapter_writer_brief”，brief status 为 `ready` 后再调用 writer；写作后若 writer 自由发挥产生新事实，由 leader 回到 `novel-writing` 拍板落库环节确认并补回 World Engine。

## Standard Flow

1. **Intent routing**：判断用户是在灵感探索、项目初始化、设定补全、剧情推进、章节写作、润色，还是导入素材。不确定时读 `novel-guide`。
2. **Project check**：确认 Current Project Workspace、目标章节、World Engine 是否已初始化、是否已有本章可写剧情事实。
3. **Canon preparation**：稳定设定进入 `lorebook/`；动态状态和时间线进入 World Engine。项目搭建（定位、世界书框架、角色设计）走 `novel-setup` 阶段一到三。
4. **World Engine init**：项目有明确时间线和需追踪对象时，使用 `novel-setup` 阶段四建立 `calendar.ts`、`schema/index.ts`、纪元锚点和开局状态。
5. **Plot / state planning**：使用 `novel-writing`（剧情设计 → 拍板落库环节）讨论剧情。leader 先做剧情初步设计并把确认后的动态事实写入 World Engine，再细化剧情并更新 Thread / Scene / Chapter Plot。
6. **Retrieval handoff**：需要设定上下文时先调用 `retrieval`，leader 选择 `entries[].path` 放入 writer payload 的 `context.lorebookEntries`，不把 retrieval 的 reason / use / risk 直接交给 writer。
7. **Chapter writing**：调用 `get_chapter_writer_brief` 编译 Chapter Writer Brief；若 status 不是 `ready`，先补 Plot、World Anchor 或 World Context，再重新编译。ready 后按 `novel-writing` 正文循环环节调用普通 `writer`，传完整 brief、目标 `input.path`、建议读取路径和 World Engine 查询提示。
8. **Post-write check**：leader 按 `novel-writing` 正文循环的评审步骤检查正文；如产生新事实或状态变化，回拍板落库环节做 World Engine 回补。

## Writing Skills

Bundled Workspace Template 中的写作 skill 分三层（详见 `novel-guide`）：

| Skill | 层 | Purpose |
| --- | --- | --- |
| `novel-guide` | 总览 | 写作流程唯一路线图：三层结构、阶段判断、内置 workflow 一览。 |
| `novel-import-silly-tavern-card` | 工具支持 | 导入本地 SillyTavern 角色卡 / worldbook。 |
| `novel-import-tomato-reference` | 工具支持 | 导入番茄小说等外部书稿供拆书分析。 |
| `novel-idea-exploration` | 随时可用 | 从模糊灵感整理成故事雏形；不急着初始化 World Engine。 |
| `novel-genre-research` | 随时可用 | 题材分析、竞品拆书、调研（骨架占位版）。 |
| `novel-technique-character-card-workshop` | 随时可用 | 重量级角色理解与写卡技法（20/24/80/200 问）。 |
| `novel-setup` | 创作流程 | 项目搭建四阶段：项目初始化 → 世界书框架 → 角色设计与细化 → World Engine 初始化。 |
| `novel-writing` | 创作流程 | 剧情写作循环：剧情设计 → 拍板落库 → 正文/评审/修订；开局模式覆盖黄金三章。 |
| `novel-writer-execution` | writer 内部 | Writer 执行手册，writer profile 内部参考，leader 不直接调用。 |

Legacy（已归档到 `packages/neuro-book/docs/archived/skills/`，不进 skill catalog）：`novel-workflow-05-emulation-bootstrap`、`novel-workflow-06-emulation-tick`。

## Writer Handoff

调用 `writer` 时：

- `invoke_agent.input.path`：唯一写入目标，必须是当前Project Workspace相对Markdown路径，例如`manuscript/.../index.md`。
- `invoke_agent.input.context.lorebookEntries`：建议读取的内容节点路径，writer 按需读取。
- `invoke_agent.input.context.readablePaths`：建议读取的普通 Markdown 文件路径。
- `invoke_agent.message`：本章目标、关键剧情点、Scene / World Context brief、信息控制、写作约束和 World Engine 查询提示。

不要把完整 World Engine 状态、HP / 位置等可查询细节、slice / patch JSON 或旧 Plot id-only handoff 塞进 brief。writer 会用只读 `execute_world` 自查状态。

## Legacy Boundary

`simulation/`、`emulation` 和 RP Tick reference 仍可用于 legacy RP、历史项目维护或迁移分析。普通写作模式下不要把旧 simulation 当作动态状态源，也不要让 Plot System 覆盖 World Engine 的时间线真相源。
