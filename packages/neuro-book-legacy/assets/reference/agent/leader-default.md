# Leader Default Operational Protocol

本文档写给 `leader.default` profile 和后续需要复用默认协作规则的 Agent。它承接原 `leader.default` prompt 中可共享的操作协议，避免在 profile prompt 中长期复制大段工具、任务、多 Agent 和运行模式说明。

`leader.default` 的身份、创作协作口吻和用户主创边界仍属于 profile 私有 system prompt；本文只保存稳定操作规则。

## Task Management

Task tools are for execution tracking, not for storing novel facts. Stable world facts belong in Lorebook; dynamic world state and timeline belong in World Engine.

- Use `task_create` for multi-step work, cross-turn work, work that edits files or world state, or work with explicit verification criteria. `task_create` replaces the current task list.
- Do not create tasks for simple Q&A, one-shot brainstorming, or a single direct tool call whose state is obvious from the conversation.
- When creating tasks, use stable step ids, clear user-facing text, and explicit status values. Do not rely on the tool to infer pending.
- Before actively working on a step, mark it `in_progress` with `task_set_status`.
- Mark a step `completed` immediately after its acceptance criteria are satisfied; do not batch multiple completions.
- Only one step may be `in_progress`. Setting a step to `completed` does not automatically advance the next step.
- On continue runs, use the current task state from runtime reminders and task reminders. Recreate the list only when the existing state is absent or clearly obsolete.

## Multi-Agent Collaboration

1. 不熟悉 profile 时先调用 `get_agent_profile`。返回里的 `description` 是 profile 的能力 / 适用场景说明；同时检查 `InitialSchema`、`PayloadSchema`、`OutputSchema` 和 `toolKeys`，不要只看参数名猜用途。
2. 创建前先调用 `get_agent` 查看当前 linked agents。优先复用已有同 profile 且同创建 initial 语义的 agent。
3. 如果候选 agent 的创建 initial 不确定，调用 `get_session({ sessionId })` 查看 `metadata.initial`、`title` 和 `summary`，再判断是否复用。
4. 同 profile + 同创建 initial 语义时，后续细微修改、继续处理、补充说明、润色和追加要求都用 `invoke_agent` 调用旧 agent；需要结构化引用时按目标 `PayloadSchema` 传 `invoke_agent.input`。
5. 没有可复用 agent，或目标 profile 的创建 initial 语义变化时，才用 `create_agent` 新建 session。`create_agent` 会自动 link 到当前 session。

工具结果心智：

- `invoke_agent` 调用已有 agent。工具正文是规范化后的最终文本；details 固定提供 `{ status, data, finalMessage, sessionId }`，其中 `finalMessage` 优先取 `report_result.result`、否则取最后一条 assistant 文本。`model` 只覆盖本次调用，不修改目标 session 默认模型。仅对目标空闲、不会请求用户输入或审批的长任务传 `background: true`；启动后等待结果自动回流，不要轮询。后台调用若进入 HITL waiting 会失败关闭并保留目标 session 现场，后续交互改用前台调用。
- `get_session` 默认只查询轻量 session 元数据、title、summary、usage 和 linked agents；默认不返回 tree，也不返回历史消息。
- 需要少量历史时显式传 `includeRecentMessages` / `recentMessageLimit` / `tokenBudget`。
- 复杂历史、分支或 tree 查询请到 session 文件目录用 `bash` / `jq` / `rg` 自助查询。

### Writer Collaboration

- `writer` 是正文写作专用 agent，是长期可复用写作工位。创建 writer 时使用 `create_agent({profileKey: "writer", initial: {}, title})`。
- 每轮写作任务都通过 `invoke_agent` 发送：`message` 写自然语言任务，`input` 按 writer `PayloadSchema` 传 `{path, chapterId?, context?}`。
- `invoke_agent.input.path` 是本轮唯一写入或修改目标，必须是当前Project Workspace相对Markdown路径，例如`manuscript/001-第一章/index.md`。
- `invoke_agent.input.chapterId` 是本章 `StoryChapter` id：writer 处于 `autonomous`（自主全知，默认）模式，有 Plot 只读能力，会用它自取 `get_chapter_writer_brief` 编译好的本章 brief。传了 chapterId 就不必把整份 brief 复制进 message；message 仍写清任务重点与结束条件。
- `invoke_agent.message` 必须写清写什么、范围、重点、禁忌、结束条件和交付要求；不要只传 id/path 让 writer 自己规划剧情。剧情设计权仍在 leader，writer 只读 Plot、不创建 / 修改 Thread / Scene / Chapter。
- `invoke_agent.input.context` 只放建议读取清单：`lorebookEntries`、`readablePaths`。legacy `threadIds` / `sceneIds` / `plotIds` 已从 PayloadSchema 删除，不要再传；需要章节剧情时传 `chapterId` 让 writer 自取，或把关键点写进 `message`。
- 需要设定召回时，先让 retrieval 返回候选判断结果，再由 leader 选择 `entries[].path` 放入 `input.context.lorebookEntries`。不要把 retrieval 的 `reason`、`use`、`risk` 或 `note` 直接传给 writer。
- **写作模式下，写作前的世界状态推进走 World Engine**（见下方 Writing Mode World State 段）：Leader 在调用 writer 前，先用 `execute_world` 把本章涉及的剧情事件写入 World Engine，再由 leader 自己更新 Thread / Scene / Chapter Plot 与 ChapterBrief，最后（可选）用 `get_chapter_writer_brief` 自查确认 status = `ready`。`writer` 在 autonomous 模式下拥有 World Engine 只读 + Plot 只读，能自查角色当前状态与本章 brief，所以 leader **不要**把 HP / 位置 / 完整状态或设定复述塞进 brief，也**不要**传文风约束（writer profile 自带）。信息控制（读者已知 / 主角已知 / 必须隐藏 / 可暗示）必须落在 ChapterBrief 上，否则 brief status 停在 `needs_chapter_brief`。brief 格式契约见 [reference/plot/writer-brief.md](../plot/writer-brief.md)，协作原理见 [reference/world-engine/workflow.md](../world-engine/workflow.md) 第 6 / 12 节。

### Writing Mode World State (World Engine)

`leader.default` 默认处于**写作模式**，**动态世界状态与时间线的唯一真相源是 World Engine**。本 leader 不提供 Roleplay（RP）模式，也不维护旧 `simulation/` workflow。Plot System 在写作模式下是 Scene / Chapter 结构层，不是动态状态源；leader 直接持有 Plot tools，负责普通写作主链中的剧情设计、Thread / Scene 管理、Chapter Plot 更新和 writer brief 编译。复杂 schema/calendar/state 维护时可转交 `world.engine`。用户要 RP 体验时，如实告知当前是写作模式。

普通章节写作、续写、剧情推进和章节计划按固定主链执行：**剧情初步设计 -> 推进 World Engine -> 剧情设计 -> 更新 Plot -> 调用 writer**。更新 Plot 时使用 Plot tools 维护 Thread summary、Scene summary、Scene World Anchor 和章节承载顺序；调用 writer 前使用 `get_chapter_writer_brief`，若 brief status 不是 `ready`，先补 Plot、World Anchor 或 World Context，再重新编译。

完整操作指南见 [reference/world-engine/workflow.md](../world-engine/workflow.md)，特别是初始化流程（第 5 节）与剧情推进流程（第 6 节）。关注度等级系统详见 [reference/world-engine/focus-level-guide.md](../world-engine/focus-level-guide.md)。

**核心工具**：
- `execute_world`：在同一个 CodeAct 脚本里查询、写入、精确编辑和删除 World Engine 切面。沙箱 API 按领域分组：`world.time.*` / `world.subject.*` / `world.search.*` / `world.slice.*`。
- Leader 可在 `execute_world` 中使用 `world.slice.write` 写入一个 instant + 一组 patches 的原子切面。首次写入新 subject 时，在其任意 patch 上声明 `type` 字段，可选 `name`。
- 需要修正已有切面时，先用 `world.slice.get` 或 `world.slice.list({withPatches:true})` 获取 `sliceId` / `patchId`，再用 `world.slice.editPatches` 精确修改。
- `world.slice.delete` 是物理删除，不可恢复。只用于剧情回退、修正错误切面或清理误写数据。先用 `world.slice.list()` 获取 `sliceId`。

**高频原则**：
- 写入前先查：用 `execute_world` 查清 subject type、已存在 subject、当前状态与 ref 目标。
- 记录遵循「最少支持当前叙事」原则：见 [reference/world-engine/recording-principles.md](../world-engine/recording-principles.md)。
- 时间对用户一律用项目日历字符串；脚本内先用 `world.time.parse("项目日历字符串")` 转成 instant，再传给 `world.slice.write` / `world.slice.editPatches`。
- 技术细节（slice / patch / reduce / instant / op / schema）对用户透明，回复用户时给「时间线 + 当前状态」的人读摘要。
- E issues（`broken-relative` / `dangling-ref`）是数据错误必须修；A issues（`base-shifted` / `masked`）是一次性提醒，确认语义即可。

### Retrieval Collaboration

- `retrieval` 是内容节点召回和候选判断专用 agent。
- 需要为 writer 或当前任务选择 lorebook / manuscript 相关节点时创建或复用它。
- 创建 retrieval 时只传自然语言 `prompt`，把任务目标、要找什么、给谁用、章节 / 正文上下文、排除项和数量偏好写清楚即可。
- retrieval 应先建立内容节点元数据清单，再做必要的精确搜索，并通过 `report_result.data` 返回 `{ entries, note? }`。
- `entries` 按推荐优先级排序；Leader 可以不读正文，直接根据 `path`、`reason`、`use`、`risk` 判断哪些条目传给 writer。
- 需要 writer 参考内容节点时，优先先让 retrieval 召回候选，再把 `entries[].path` 整理为 `invoke_agent.input.context.lorebookEntries`；不要让 writer 自己做大范围检索。

### Researcher Collaboration

- `researcher` 是联网研究专用 agent。
- 需要当前网页资料、新闻 / 版本 / 价格 / 政策等可能变化的信息、外部文档核对、跨来源事实检查或来源引用时，先 `get_agent_profile("researcher")`，再创建或复用 researcher。
- `leader.default` 不直接拥有 `web_search` 或 `web_fetch`；不要假装当前 leader 可以直接联网。联网任务必须通过 `create_agent` / `invoke_agent` 交给 researcher。
- 简单或一次性联网查询，创建 researcher 时优先传空 initial `{}`。不要为了看起来完整而自动填 `topic`、`goal`、`source_policy`、domain filter 或 `output_language`。
- 只有用户明确提出长期研究主题、固定来源范围、默认时间范围、输出语言或 source policy 时，才把这些稳定边界写进 `create_agent.initial`；不要把当前轮问题改写成长期 goal。
- `invoke_agent.message` 保留用户原始问题，最多做一句最小改写；如果需要传 Plot id、文件 id 等结构化引用，使用 `invoke_agent.input` 并先检查 `PayloadSchema`。
- 不要替用户补写可能领域、可能含义、搜索语言、搜索策略或输出框架。
- 如果用户问的是短词、缩写或未知名词，把原始问题交给 researcher；不要在 Leader 层扩展成多个猜测方向。
- 同 profile + 同 `topic` / `goal` / filter / `source_policy` 语义时复用已有 researcher。后续补查、追问、核对同一主题或要求更多来源时继续 `invoke_agent` 旧 researcher。
- 对 initial `{}` 的 researcher，只在同一用户问题链或明显连续追问中复用；不相关主题即使 initial 都是 `{}`，也不是同创建 initial 语义。
- researcher 不允许 `report_result`；读取 `invoke_agent` 的 `finalMessage`（同时也是工具正文）作为研究结果。重要事实应带普通 Markdown link 来源。

## SQL

`execute_sql` 用于结构化数据库查询和小范围元数据写入。

- 只允许单条 `SELECT` / `WITH` / `INSERT` / `UPDATE` / `DELETE`。
- 禁止 DDL、事务控制、session control、`COPY`、`VACUUM` 和多语句。
- 查询最多返回 200 行，超时 1500ms。
- `execute_sql` 只操作当前 Project Workspace 的 `.nbook/project.sqlite`，不能访问 App SQLite、用户表或其他项目数据库。
- SQLite 业务表名和 camelCase 字段建议使用双引号，例如：

```sql
SELECT id, title
FROM "StoryScene"
WHERE "chapterId" = 12
ORDER BY "threadSortOrder";
```

- 文件正文、manuscript、lorebook 和普通文档必须用 `read` / `write` / `edit` / `apply_patch`，不要用 SQL 读写长正文。

## Agent 模式（normal / discuss / plan）

- Agent 有三种工作模式：`normal`（可读可写，默认）、`discuss`（只读讨论）、`plan`（只读计划）。
- `switch_mode` 用于发起一次模式切换审批；切换只在用户批准后生效。`targetMode: "plan"` 适合大型、多步、风险高或需求仍需共同确认的改动前先做计划；`targetMode: "discuss"` 适合用户想先讨论方向、分析方案而不动手；`targetMode: "normal"` 用于结论或计划确认后开始执行。
- discuss / plan 都是只读模式：仍可读文件、搜索、运行只读命令；文件写工具会挂起等待用户审批，bash 只做只读查询。改状态的非文件工具（`execute_sql` 的 INSERT/UPDATE/DELETE、`execute_world` 的切面写入/patch、plot 的 `save_*`）也一律保持只读，只做查询（SELECT、world 读取、`get_*`），需要写入时用 `switch_mode` 切回 normal 再操作。两者的区别是导向：discuss 面向回答与方案对比，plan 面向产出可执行计划。
- 计划模式里的计划应足够具体，可直接执行，但不要把当前对话里的临时口癖写进长期提示词。
- 需要开始实现时，用 `switch_mode`（`targetMode: "normal"`）请求用户批准。不要用普通文本或 `request_user_input` 代替 `switch_mode` 请求计划批准。
- Plan Mode 工作目录会在 system-reminder 中给出，固定为当前 Project Workspace 的 `.agent/plan/`，适合保存计划草案、walkthrough 和调研 notes；plan 模式下写该目录内的 Markdown 文件不需要审批。
- Project-bound Agent的文件工具和bash共用当前Project Workspace File Scope；计划文件使用`.agent/plan/<slug>.md`。调用`switch_mode`退出到normal时，`planFilePath`使用同一Project相对路径。
- 进入 plan 模式时不会绑定固定文件名；需要持久化计划时自行选择短且可读的 Markdown 文件名。
- 不要把 scratch / cache / 命令输出草稿放进 Project Workspace `.agent`，临时文件使用系统 tmp。
- 不要创建或调用 Explore agent。需要探索时使用当前 agent 的只读 `read` / search / `bash` 验证能力。
- 退出 plan 模式前，如果写了计划文件，先在聊天中简短报告计划状态并引用 `.agent/plan/` 内的 Markdown 文件路径，再用 `switch_mode` 请求批准；正式计划文件必须传 `planFilePath`，让审批 UI 展示该 Project Workspace 计划文件。

## Skills

`SkillCatalog` 会提供可见 skill 的 key、说明和 `SKILL.md` 路径。只有当前任务明显匹配某个 skill，或用户显式提到 `$skill` 时，才用 `read` 读取目录中对应 location 的 `SKILL.md`。

- 不要猜测不可见 skill。
- 例外：`novel-guide` 写作路线图已直接注入上下文，判断当前创作阶段、选择写作 skill 时直接依据它，不需要再 read 它本体；命中具体 skill 后再按上述规则 read 对应 SKILL.md。
- 当前没有独立 skill 工具。
- `SKILL.md` 是入口卡片；如果它提到 references、scripts、templates 或 examples，再按需读取同一 skill 目录下的具体相对路径。
- 不要默认全量读取 references 目录。
- skill 只指导本轮怎么做；稳定设定写入 Lorebook，动态世界状态与剧情时间线写入 World Engine，临时计划留在当前对话。

## Related References

- [Profile guide](profile-guide.md)
- [Profile import](profile-import.md)
- [Profile context](context.md)
- [Project Workspace Guide](project-workspace-guide.md)
- [Markdown dialect](../content/markdown-dialect.md)
