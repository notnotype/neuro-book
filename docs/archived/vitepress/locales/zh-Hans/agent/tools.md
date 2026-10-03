# Agent 工具

Agent 工具是模型能请求执行的能力。NeuroBook 的工具设计目标是让 Agent 在明确边界内读写项目、调用专用 agent、推进世界与剧情，并留下可追踪的 session 记录。

每个 profile 通过工具白名单决定自己能用哪些。**没有任何一个 profile 拥有全部工具**——writer 拿不到剧情写入工具，world.engine 拿不到 web 工具，这是设计而不是遗漏。

## 完整工具清单

| 分组 | 工具 | 说明 |
| --- | --- | --- |
| 文件 | `read` `write` `edit` `apply_patch` `bash` | 读写文件与执行命令 |
| 协作 | `create_agent` `invoke_agent` `get_agent` `get_agent_profile` `get_session` `detach_agent` | 创建和调用 linked agent |
| 控制 | `request_user_input` `switch_mode` | 向用户提问、请求切换模式 |
| 任务 | `task_create` `task_set_status` | 会话内的任务清单 |
| 剧情（读） | `get_story_tree` `get_story_thread` `get_story_scene_context` `get_scene_world_context` `get_story_chapter` `get_chapter_writer_brief` `get_story_promise` `get_story_decision` | 不传 id 时返回列表 |
| 剧情（写） | `save_story_act` `save_story_chapter` `save_story_thread` `save_story_scene` `save_story_promise` `save_promise_beat` `save_story_decision` | 必填 `action` 枚举，含生命周期动作 |
| 世界引擎 | `execute_world` | 单一 CodeAct 工具，readonly / readwrite 双形态 |
| Workflow | `run_workflow` `list_workflows` | 触发与列出可用 workflow |
| 后台任务 | `list_jobs` `get_job` `cancel_job` | 长任务生命周期 |
| SQL | `execute_sql` | 只操作当前项目的 `project.sqlite` |
| 联网 | `web_search` `web_fetch` | 通常只给 researcher |
| 选题 | `novel_rankings` `novel_book_detail` | 榜单快照与书籍详情，只读 |
| Subject 记忆 | `subject_rag_search` `subject_event_append` `subject_memory_update` | 历史系统，见下文 |
| 结果 | `report_result` | 返回结构化结果 |

工具在定义时必须**显式声明**自己会不会改动工作区。声明为改动的工具（文件写入 + 7 个剧情写工具：6 个 `save_story_*` 加 `save_promise_beat`）在只读模式下会被拦截并要求审批，见 [三种模式](/agent/modes)。

## 文件工具

常见文件任务优先使用文件工具：

- `read`：读取文件内容。
- `write`：新建文件或完整重写文件。
- `edit`：精确修改已有文件。
- `apply_patch`：适合一个 cohesive patch 的 Codex 风格补丁。
- `bash`：搜索、构建、测试、运行脚本和 workspace CLI。

原则很简单：读文件用 `read`，搜文件用 `rg`，修改文件用 `edit` / `write` / `apply_patch`。不要用 shell 拼接高风险写入命令替代文件编辑工具。

`read`、`write`、`edit`、`apply_patch`和Subject文件工具都经过统一文件授权：解析File Address、检查目标Project已打开，并验证真实路径没有通过symlink/junction逃出所属根。跨Project必须使用完整`workspace/<project>/<relative-path>`地址。

`bash`是明确的例外：它是受信任完整Shell。系统只通过`authorizeProcessCwd()`确认当前Project已打开且cwd可信，不承诺限制命令中的文件访问，也不会因为Discuss/Plan模式增加新的Bash审批。

## Agent 协作工具

`leader.default` 可以创建或调用 linked agent：

- `get_agent_profile`：先看目标 profile 的能力、输入输出和工具权限。
- `create_agent`：创建新 linked session。
- `invoke_agent`：调用已有 linked agent。
- `get_agent` / `get_session`：查看当前 linked agent 或 session 元数据。
- `detach_agent`：解除 link，不删除 session。

实践上，简单任务不要为了形式创建 agent。只有当 writer、retrieval、researcher、RP actor 这类专门 profile 能明显降低上下文污染或职责混乱时，才创建或复用 linked agent。

协作工具当前合同：

- `get_agent_profile({ profileKey })` 返回 `creationMode`、`createAgentAllowed`、`InitialSchema`、`PayloadSchema`、`OutputSchema` 和 `toolKeys`；不返回 profile 源码或 report schema。
- `create_agent({ profileKey, initial })` 只能创建 `creationMode=public` 的 linked session，并用 `InitialSchema` 校验；`initial` 必须是真实 JSON object。`system_only` profile 只由 Harness 内部流程创建。
- `invoke_agent({ sessionId, mode, message, input, title, model?, background? })` 调用已有 session；`message` 是自然语言字符串，`input` 是本轮 payload object，会按目标 `PayloadSchema` 校验。`model` 必须来自 Agent 可见模型清单，并且只覆盖本次调用，不修改 session 默认模型。
- `prompt` / `steer` / `followup` 可以只传 `message` 或只传 `input`；`continue` 不接受 `message` 或 `input`。
- 同步 `invoke_agent` 的工具正文是规范化最终文本；details 固定提供 `{ status, data, finalMessage, sessionId }`，可选附带 `stats` / `error`。`finalMessage` 优先取 `report_result.result`，否则取最后一条 assistant 文本；没有结构化结果时 `data` 为 `null`。
- `background: true` 立即返回 `{ jobId, status: "started", data: null, finalMessage: "", sessionId }`，最终结果以后续消息回流。启动后正常结束当前回合，不要用 `get_job` 空转轮询。
- Initial/Payload/report data 校验失败时会返回带 JSON Pointer 的字段错误；按路径修正对象，不要把对象 stringify 后重试。

## 世界引擎工具

World Engine 只有一个工具 `execute_world`，内部是受控代码沙箱，API 分四组：`world.time.*`、`world.subject.*`、`world.search.*`、`world.slice.*`。

**读写分权是硬边界**：leader 和 `world.engine` 使用 readwrite 模式；**writer 使用 readonly 模式，不注入 `world.slice.write` / `editPatches` / `delete`**。写正文的 Agent 查得到世界状态，但改不了。

时间在沙箱内用 `world.time.parse` / `format` 与内部刻度互转；同一时刻只能有一个切面，同刻多个变更必须合并进同一个 patch 数组。详见 [World Engine](/core/world-engine)。

## 剧情工具

读工具统一 `get_story_*` 前缀，**不传 id 时是列表模式**。写工具合并成 `save_*` 加一个必填的 `action` 枚举——除了 create / update，生命周期动作（归档、放弃、兑现、拍板、作废）也走 action。

**物理删除不开放给 Agent**。Agent 能做的最多是软删（归档 / 放弃），删数据得你自己在界面上操作。

## SQL

`execute_sql` 只操作当前 Project Workspace 的 `.nbook/project.sqlite`，用于剧情结构等结构化数据。正文、世界书和普通 Markdown 文件仍必须通过文件工具读写。

## Subject 记忆工具

Subject RAG 的数据与专用工具仍保留：

- `subject_rag_search`：检索当前 subject 的 `events.jsonl` 和 `memory.jsonl`。它要求配置 embedding 服务，未配置时会明确失败，不做关键词 fallback。
- `subject_event_append`：追加合法 `events.jsonl`，并标记对应 RAG source dirty。
- `subject_memory_update`：把本轮 subject-facing facts 数组交给 `memory.curator` profile，由它生成 JSON Patch，工具层校验并写回 `memory.jsonl`。

当前内置 `simulator.actor` 只开放 `report_result`，不会自动调用这些工具；仓库暂未提供自动记忆消费者。未来应由显式 workflow/job 在受控边界内接入。工具仍不用于完整 Project RAG，也不得让 actor 读取其他 subject 的私有记忆。subject 侧 `events.md` / `knowledge.md` 是旧合同，当前工具不会读取或自动迁移。

## Skill 不是工具

当前没有独立 `skill` 工具。Agent 会在 `SkillCatalog` 中看到可用 Skill，需要使用时再用 `read` 打开对应 `SKILL.md`。

这让 Skill 保持为可读工作流程，而不是不可见黑箱脚本。

## 继续阅读

- [Workflow 与 Job](./workflow.md)：`run_workflow` 与后台任务。
- [三种模式](./modes.md)：只读模式下写工具怎么被门控。
- [World Engine](/core/world-engine)：`execute_world` 背后的模型。
- [Leader Default Operational Protocol](https://github.com/notnotype/neuro-book/blob/master/packages/neuro-book/assets/reference/agent/leader-default.md)
- [Project Workspace Guide](https://github.com/notnotype/neuro-book/blob/master/packages/neuro-book/assets/reference/agent/project-workspace-guide.md)
- [Agent Profile Guide](https://github.com/notnotype/neuro-book/blob/master/packages/neuro-book/assets/reference/agent/profile-guide.md)
