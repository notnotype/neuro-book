# Pi Agent Harness Migration

## 2026-07-12：Agent 关联生命周期收口

Agent 关系正式分为 append-only 历史账本与唯一当前有效关系投影。`agent.link.*` 会激活或重新激活目标关系，`agent.detach.*` 只解除已存在关系，不再制造 `unknown` 幽灵记录；关系索引同时维护 archived Session 集合，Runtime、Profile、`get_agent`、`get_session`、snapshot、relations API 与前端关联面板统一排除 detached 或任一端 archived 的关系。公开 `AgentLinkedSessionDto` 不再暴露 `detached`，解除关系后双方列表立即消失，历史 link/detach entry 仍完整保留用于回放与排障。

Session Control Plane 使用单一进程内关系变更队列串行 create/link、detach 与 archive。带 parent 的 create 在队列内完成 parent 归档校验、child 创建和唯一正式 link 写入；archive 在同一队列内读取最新索引，解除全部入站与出站关系后再追加 `session_archived`。手动归档和 Project Workspace 批量归档共用同一路径，受影响对端会收到 snapshot refresh。旧的已归档 Session 即使缺少历史 detach entry，也不会进入任何当前关系消费者；重复归档会补齐旧数据缺失的 detach。

多 Session 写入继续复用 `SessionWriteExecutor` 的有序锁，但 JSONL 跨文件写入不是原子事务：detach 先于 archive 按顺序追加，失败后可安全重试，不宣称 batch commit。关系强一致保证限于当前单进程 Harness，与 EventHub 的部署边界一致；没有为尚不存在的多实例写入增加分布式锁。`detachAgent` 返回 `detached` / `already_detached` / `not_linked` 判别状态，工具不再把重复或无效解绑报告为成功。

验证：关系账本与前端 session/API/stream 定向测试共 37 项通过（其中关系账本 3 项）；全仓 typecheck 的本轮关联改动零新增错误。新增 Harness 用例覆盖 detach 判别、create/archive 并发串行、旧 archived target 单一投影和归档级联，但当前测试收集被无关的 `shared/dto/config.dto.ts` 缺失 `MAX_AGENT_DIFF_MAX_CHARS` 阻断；全仓 typecheck 另有 Profile Runtime 设置面板缺少 `sources` props 的既有并行红灯。

## 2026-07-12：运行策略所有权收口

Summarizer、Compaction 与 FileChangeNotice diff 预算统一由 Harness 消费。Profile 仅通过 `runtimeDefaults` 声明出厂默认；配置层提供 Global/Project 通用默认与 Profile 覆盖。Compaction 默认开启（summarizer system Profile 默认关闭），自动摘要默认关闭，手动 summarize/compact 强制执行最终策略。trigger 与 keep-recent 使用无冲突判别联合并按原子值替换。

## User Request

- 全面重构当前 Agent 系统，逐步替换 LangChain provider/message/tool 边界，转向 `earendil-works/pi`。
- 本阶段已经从后端 harness 延伸到正式 HTTP 与前端 Agent 抽屉迁移，统一切到 session/invocation/event contract。
- 记录已经确认的设计方向、剩余关键问题和后续实现任务，后续实现继续基于本文档推进。

## Goal

- 建立新的 Agent Harness 与前后端 session contract，使用 Pi 的 message、event、tool execution 和 session 语义作为主干。
- 保留 Neuro Book 的 TSX Profile、用户 assets、workspace、agent、skill 等领域能力。
- 明确哪些部分直接采用 Pi，哪些部分由 Neuro Book 自己拥有。
- 在真正实现前，先固定关键边界，避免只把 LangChain provider 局部替换后继续保留旧系统复杂度。

## Current State

- 当前 Agent 主链路已硬切到 Pi-based `server/agent`。旧 v2 已移动到 `server/agent-v2` 与 `assets/agent-v2`，只作为迁移参考，不进入 active typecheck、测试或运行时。
- 旧 thread/message Prisma 模型已删除；新的 session 真相来自 JSONL append-only entry tree，前端也已经从 thread/subagent 心智迁到 session/linked agent 心智。
- 正式 HTTP 入口已经回到 `/api/agent/**`：前端使用 `/api/agent/sessions/**` 的 snapshot、invocation、command、tree、abort 和 events contract；临时 `/api/agent-v3/**` 已删除。
- Agent 抽屉已接入新的 session snapshot + session event hub：支持聊天、停止、审批/输入恢复、模型选择、Plan Mode、compact slash command、linked agents、edit/retry/rollback/fallback、分支切换和多窗口事件同步的基础链路。
- Agent 历史 session 读取已兼容缺失或不可运行 profile：snapshot / live state / relations / list 不再因旧 session 引用已删除 profile 失败，summary 会标记 `profileAvailability` 与 `profileIssueMessage`；继续运行类入口会拒绝并给出恢复 profile 或新建/切换 session 的提示。前端对这类 session 进入只读历史模式，保留历史浏览和管理动作，禁用会发起新 run 或改变后续运行参数的入口。
- TSX Profile runtime 支持 builtin/user assets 动态加载、InputSchema/OutputSchema、allowed tools、workspace 默认 profile、用户资产工作区和 active TSX DSL。profile 输出合同已切到 `ProfileTurnPlan`，普通 profile 可通过 `context(ctx) => <ProfilePrompt />` 声明 `System` / `HistorySet` / `ModelContext` / `AppendingSet` 等分区；高级 profile 可直接覆写 `prepare(ctx) => ProfileTurnPlan`。TSX Profile Workbench 已接入用户 profile 源码写入、新建模板、文件 diagnostics、真实 prepare preview、创建 session 入口和稳定 `<ProfilePrompt>` DSL tree 解析/局部写回。
- Profile runtime 已硬切为 `.compiled` 运行真相源：源码只负责编辑，catalog/config snapshot/创建 session/invoke 只读 `.compiled/manifest.json` 与 compiled artifact，不再自动编译 TSX。Workbench 自动编辑路径仍只做轻量源码解析，手动编译才写 `.compiled`。
- 本地 Pi 仓库位于 `.agent/workspace/pi`；已完成基础调研，见 `docs/research/pi-agent-harness.md`。
- Pi TUI / coding-agent 产品层作为 Neuro Book harness 的主要参考：它证明“产品自己拥有 session manager、资源解析、UI/TUI 状态，再调用 Pi core Agent”是可行路径。

## Walkthrough

- 已确认 `pi-ai` 的 canonical LLM message 只有 `user` / `assistant` / `toolResult`，assistant content 使用 `text` / `thinking` / `toolCall` block。
- 已确认 `pi-ai.Context` 支持 `systemPrompt?: string`，provider adapter 会将其映射到 OpenAI system/instructions、Anthropic system、Google systemInstruction 等 provider-native 字段。
- 已确认 `pi-agent-core` 的事件主干包含 `agent_start` / `turn_start` / `message_start` / `message_update` / `message_end` / `tool_execution_start` / `tool_execution_update` / `tool_execution_end` / `turn_end` / `agent_end`。
- 已确认 Pi 的 session/thread 机制是 append-only entry tree：entry 通过 `id` / `parentId` 组成树，active leaf 表示当前分支，`buildSessionContext()` 从 leaf 回溯并 reduce 出 LLM context。
- 已确认 Pi 的低层 tool lifecycle 使用 `beforeToolCall` / `afterToolCall` callback；高层 `AgentHarness` 会把它们包装成 hook event。
- 已确认 Pi 的 subagent 示例是 extension + CLI subprocess，不适合 Neuro Book 长期直接照搬；Neuro Book 只借鉴其 agent 调用模式，不保留 leader/subagent 领域分层。
- 已确认 `pi-coding-agent` 没有直接以 `AgentHarness` 作为产品主干，而是使用自己的 `AgentSession` / `SessionManager` / extension runner 包装 Pi core `Agent`。这支持 Neuro Book 自己实现 `NeuroAgentHarness`。
- 已确认 Pi 推荐把可编辑资源和会话状态放到清晰的本地目录约定下，例如 project-local `.pi/skills` / `.pi/prompts` / `.pi/extensions`、global `~/.pi/agent/...`、session JSONL 目录等；Neuro Book 应借鉴“约定目录直接挂在项目配置根下”，而不是继续把所有覆盖资源都塞进 `workspace/.nbook/assets`。
- Pi 相关参考文档已确认并用于本计划：`packages/coding-agent/README.md`（`/tree`、`/fork`、`/clone`、session 存储与互动命令）、`packages/coding-agent/docs/session-format.md`（JSONL session tree、`leaf`、`branchWithSummary`、`getTree`）、`packages/coding-agent/docs/compaction.md`（auto/manual compaction、branch summarization）、`packages/agent/docs/agent-harness.md`（harness phase、leaf 持久化、compaction/tree navigation）。
- Pi-based 后端主实现已落到 `server/agent`：包含 `messages`、`events`、`session`、`profiles`、`tools`、`harness` 模块，并添加 `@earendil-works/pi-ai`、`@earendil-works/pi-agent-core`、`typebox` 依赖。
- 已实现 `JsonlSessionRepository`：全局数字 `sessionId`、`session-seq.json`、`workspace/.nbook/agent/sessions/<workspace-key>/<session-id>.jsonl`、append entry、leaf 持久化、active path reduce、tree 和 fork。session command 由 `NeuroAgentHarness.runCommand()` 处理，前端只把识别到的 slash command 路由到 `/api/agent/sessions/:sessionId/commands`；`/invocations` 不解析 slash command，用户输入 `/xxx` 时仍可作为普通文本发给模型。
- 已实现 TypeBox profile contract：`defineAgentProfile({ manifest, inputSchema, outputSchema, allowedToolKeys, context?, prepare?, ingest? })`，默认 builtin `leader.default` 已用于 v3 闭环。`context(ctx) => JSX` 会编译为 `ProfileTurnPlan`，`prepare(ctx) => ProfileTurnPlan` 是高级覆写入口；两者不能同时存在。工具只来自 profile `allowedToolKeys`，`prepare()` 不再返回 `toolKeys`。
- 已实现内置工具：基础文件/命令工具 `read`、`write`、`edit`、`apply_patch`、`bash`，以及 `report_result`、`request_user_input`、`enter_plan_mode`、`exit_plan_mode`、`create_agent`、`invoke_agent`、`get_agent`、`get_agent_profile`、`get_session`、`detach_agent`。`leader.default` 还恢复了 v2 生态工具：`task_create`、`task_set_status`、plot read/write 工具和 `execute_sql`；`leader.assets` 仍只暴露资产编辑所需工具。独立 `skill` 工具已禁用，skill 正文通过 `read` 读取 SkillCatalog location。`report_result` 只给需要结构化输出的目标 agent 使用。`create_agent` 由父 session 调用时会写 owned link，`get_agent()` 无参返回当前父 session 拥有且未 detach 的 agent 列表。
- 已实现 `NeuroAgentHarness` 第一版。底层 provider streaming 使用 Pi `streamSimple` 和 Pi message/event 类型；tool loop 由 Neuro Book 自己控制，以支持 approval tool call 挂起时不生成 toolResult。Pi core `Agent` / `AgentLoop` 第一版不作为主循环直接使用，因为公开 hook 只能 block 并生成错误 toolResult，不能表达“等待用户审批并保留未完成 tool call”。
- 已实现 approval resume：hardcoded approval tool call 会停在 assistant message，session 尾部没有对应 toolResult；`continue + resolution` 会校验 pending tool call、append 标准 `ToolResultMessage`，再继续 provider run。
- 已实现 `report_result` 收集和缺失提醒：如果 profile 可见工具包含 `report_result` 但目标 agent 普通结束，harness 会追加一条用户提醒并再跑一轮；第二轮仍未 report 时返回最后普通消息和“未正确 report”的说明。
- 已修正 AppendingSet 顺序：prompt run 先 prepare 并按 `historyInitMessages -> appendingMessages -> stateWrites` 写入 session，再写当前 user message，provider context 中当前用户输入仍是最后一条；AppendingSet 已写 session 后不会在同一轮 provider context 中重复出现。
- 已实现 compaction LLM summary：保留固定压缩 prompt 与 summary prefix，自动压缩按 Pi token estimate/threshold 判断，手动 `/compact` 使用真实 provider 生成摘要并追加 `compaction` entry；summary 生成失败时不写 entry。
- 已补 compaction cut point 安全规则：保留 recent messages 时不会从 `toolResult` 半截开始；若 active tail 存在未完成 tool call，则拒绝 compact，避免破坏 approval / continue 恢复语义。
- 已补真实 provider smoke 脚本 `scripts/smoke-agent.ts`，通过 Global Config `workspace/.nbook/config.json` 或设置页中的 provider/model 配置创建 `leader.default` session，验证真实 provider、usage、event 和 session JSONL 落盘链路。根 `config.yaml` 只保留启动/部署类 Boot Config，不再作为模型 Provider 真值源。
- 已补第一批回归测试：session JSONL、leaf/tree/fork、approval pending/resolution、harness faux provider 端到端、report_result、缺失 report 自动提醒、AppendingSet 去重、owned agent link、LLM compaction summary、tool call/result cut point。
- 已完成 v3 动态 profile catalog 硬切：只扫描 `assets/workspace/.nbook/agent/profiles` 与 `workspace/.nbook/agent/profiles`；runtime catalog 面向可加载、可运行的 profile 列表，坏 `.profile.tsx` 不作为可运行 profile 项进入 catalog。坏文件修复由后续 TSX Profile Workbench 的 file diagnostics 按 `fileName` 打开源码处理，catalog snapshot 只保留运行时可用 profile 及必要加载问题摘要，不把 catalog 当成坏文件浏览器。
- 已实现 builtin schema 锁定：用户覆盖 `leader.default` 等 builtin key 时，运行时实现可以覆盖，但 Input/Output schema 会继续使用内置 schema；schema 冲突进入 catalog issue。
- 验收阶段修复 TSX profile 运行时加载边界：Nuxt dev server 是 Node 进程，不能像 Bun 测试一样无条件原生 import `.profile.tsx`；`AgentProfileCatalog` 现在优先使用当前运行时 native dynamic import，只有遇到 Node 不认识 `.tsx` 的错误时才 fallback 到 `tsx/esm/api` 的 `tsImport`，避免已经启用 TS loader 的 Node/Nuxt 进程二次套 loader 卡住。
- 验收阶段已把 `/api/agent/profiles/catalog`、`/api/agent/profiles/detail`、`/api/agent/profiles/preview-prepare` 从 v2 removed stub 改为 v3 profile 只读/预览适配：catalog 返回 `AgentProfileCatalogItemDto`，detail 返回源码、manifest、allowed tools 与 TypeBox schema 摘要，preview 调用真实 `profile.prepare()` 并展示 `systemPrompt`、History/Dynamic/Appending 消息。
- 已为新 Agent 增加动态 profile 类型索引输出 `server/agent/profiles/dynamic-profile-types.generated.ts`，`scripts/prepare-profile-types.ts` 只读取新 `.nbook/agent/profiles` root。旧 `scripts/check-profile.ts` / `scripts/compile-profile.ts` / `scripts/profile-compile-cli.ts` 已删除；Agent/user 操作入口统一为 Workbench 和 Agent runtime `profile status/check/compile/preview`。
- 已实现轻量 session query service 与模型工具 `get_session`：默认返回 metadata、active leaf、title/summary、usage 和 linked agents，不返回 tree，也不返回历史消息；只有显式传 `includeRecentMessages` 时才按 token budget 返回当前 active path 的最近消息。
- 已接入 `profile.ingest()`：harness run save point 后调用 ingest；第一版只允许写 `messageWrites` 与 `sessionUpdates.title/summary`，越权字段会使本次 run 返回 error，且不会写入部分 ingest 结果。
- 已把 owned / linked agents 完全改为 append-only session state：`create_agent` 和 `detach_agent` 写父 session 的 `custom` entry，`get_agent()` 与 profile prepare 的 `session.linkedAgents` 都从 active path reduce 得到，不再依赖内存 `detachedSessions`。
- 已新增 v3 `SkillCatalog`，只扫描 `assets/workspace/.nbook/agent/skills` 与 `workspace/.nbook/agent/skills`；同名 skill 目录由用户目录整体覆盖。独立 `skill` 工具已禁用，Agent 通过 catalog 的 `location` 用 `read` 打开 `SKILL.md`；reference/scripts/templates/examples 由入口文档按需继续读取。
- 已修复 active user-assets profile 遮蔽问题：未手改的 `workspace/.nbook/agent/profiles/builtin/leader.default.profile.tsx` 会随系统 profile metadata 同步到最新版，实际运行的 user override 已包含 `get_agent_profile`，且不再暴露旧 `skill` 工具。系统 profile metadata 与 `.profile-sync-state.json` 已更新，避免 catalog 把当前用户覆盖误报为遮蔽。
- Agent 可用 CLI 不再放在项目根 `scripts/` 下；内容节点 CLI 放在 `assets/workspace/.nbook/agent/scripts/workspace.ts`，并通过 `assets/workspace/.nbook/agent/bin/workspace` 暴露为 `workspace` 命令。bash 工具会自动把 user-assets bin 和 system bin 加入 PATH，并注入 `RIPGREP_CONFIG_PATH` 指向 `.nbook/agent/config/ripgreprc`，让 `rg --files` 统一输出 `/` 路径。profile/skill prompt 应推荐 `workspace node ...` 与 `rg --files | rg '(^|/)index\.md$'` 这类基于 `/` 的过滤；不全局设置 `MSYS_NO_PATHCONV=1`。
- writer 已硬切为“一章节一 agent”输入合同：调用方传 `chapterPaths` 绑定唯一章节，writer 自动读取本章 Chapter Plot 并只写显式章节 `index.md`；`lorebookEntries` 只接收 path 字符串数组。writer writing style / writing reference 资源已迁到 `assets/workspace/.nbook/agent/writing-presets/{styles,references}`，用户覆盖在 `workspace/.nbook/agent/writing-presets/{styles,references}`，不再位于 profile 源码目录。
- 已新增正式 `/api/agent/sessions/**` 后端入口：支持 list/create/snapshot、blocking invocation、command、abort、tree、session event SSE 和 session archive/list 隐藏。
- 已给 `NeuroAgentHarness.invokeAgent()` 增加 session event hub 集成；blocking JSON 仍返回运行结果，SSE route 通过 envelope 推送 Pi-like event 与 session control event。
- 已新增 `scripts/smoke-agent-http.ts`，用于在本地 dev server 已启动时通过 HTTP create + invoke 验证正式 `/api/agent/sessions/**` API。
- 已完成前端迁移 API 方向调研：Pi TUI 通过 snapshot/reduce 加载 session，通过 `AgentSession.subscribe()` 订阅事件，通过 `/tree` 移动 leaf，通过 `/fork` 创建新 session；Pi 不支持原地编辑聊天消息，编辑用户消息等价于回到该消息之前并追加修改后的新输入，保留旧分支。
- 已确认基础工具迁移不只是工具 registry 改名：v3 `leader.default` / 后续完整 leader profile 也必须迁移到 Pi 风格工具名 `read` / `write` / `edit` / `bash` / `apply_patch`，不再向模型暴露 v2 `read_file` / `write_file` / `edit_file` / `execute_shell` 心智。
- 已确认完整 v3 leader 的真实落点是系统 assets：把当前 v2 完整 leader 改写为 v3 TypeBox/TSX profile 后放入 `assets/workspace/.nbook/agent/profiles/builtin/leader.default.profile.tsx`，让它经过动态 profile catalog、用户覆盖、typecheck 和 preview 这条真实链路。
- 已确认完整 leader 第一版只做结构迁移与工具名迁移：通用工程/文件/agent 协作能力切到 v3 contract，小说业务提示块（剧情结构、内容节点、Markdown Studio 写作格式、Plan Mode reminder 等）可以先按原语义搬迁，不在本阶段深度改写。
- 已确认实现顺序：先确认 v3 profile 路径统一使用复数 `agent/profiles`，同步 catalog、typegen、check-profile、测试 fixture 与最小 profile 验证；确认扫描和 contract 正常后，再迁移完整 `leader.default`。
- 已确认 v3 profile 文件命名约定：默认使用 `<profileKey>.profile.tsx`，例如 `leader.default.profile.tsx`、`writer.profile.tsx`、`custom.my-agent.profile.tsx`。目录只负责分组，例如 `builtin/leader.default.profile.tsx`。
- 已确认 v3 typegen 读取系统/user assets profiles，但 builtin key 继续使用源码内 builtin contract 作为静态类型来源；用户或系统 assets 覆盖 builtin key 只影响运行实现，不覆盖开发期 Input/Output 静态类型。自定义新 key 才从 assets `.profile.tsx` 生成类型索引。
- 已确认 `leader.assets` 是用户资产编辑工作区专用 agent；验收阶段已从 v2 assets editor 迁移为 v3 TypeBox/TSX profile，放入 `assets/workspace/.nbook/agent/profiles/builtin/leader.assets.profile.tsx`，并使用同一套 Pi 风格基础工具。
- 已确认 v3 `leader.default` allowed tools：`read`、`write`、`edit`、`apply_patch`、`bash`、`create_agent`、`invoke_agent`、`get_agent`、`get_agent_profile`、`get_session`、`detach_agent`、`request_user_input`、`enter_plan_mode`、`exit_plan_mode`，并已恢复 task / Plot / SQL 业务工具。顶层 leader 不默认启用 `report_result`，避免主对话被被调用 agent 的完成协议绑死。
- 已确认 `invoke_agent` 对 `report_result` 的完成规则：只有目标 profile 的 `allowedToolKeys` 包含 `report_result` 时，harness 才要求目标 agent 以 `report_result` 结束并启用一次自动提醒；如果目标 profile 没有允许 `report_result`，则按普通 completion 返回 `finalMessage`，不触发缺失 report 提醒。
- 已确认后续 TSX Profile Workbench 的 schema 语义：`profile.inputSchema` / `profile.outputSchema` 字段仍应存在；普通 agent 使用 `InputSchema = Type.Object({})` 表示无特殊实例配置，使用 `OutputSchema = Type.Object({})` 表示无额外结构化输出约束。是否走 `report_result` 由 `allowedToolKeys` 是否包含 `report_result` 决定；`OutputSchema = Type.Object({})` 但允许 `report_result` 时，目标 agent 仍使用 report 完成协议，但 report 参数只要求通用 `walkthrough`，没有额外结构化 payload 限定。`OutputSchema` 非空时，`report_result.data` 需要按目标 profile 的 `OutputSchema` 生成模型可见类型并执行 TypeBox 校验。当前 active `report_result` 工具仍是旧的 `result/data` schema，后续实现 Workbench/template 时需要同步调整工具 schema、collector 和输出校验。
- 已确认在后端基础任务全部完成后，新增独立 prompt 阶段 checklist：先回查本地 PI 源码，再统一校准 v3 基础工具 description / prompt guidelines / model-visible result wording，以及 v3 leader 提示词里的工具使用规则。
- 已实现 Pi 风格基础工具：`read`、`write`、`edit`、`apply_patch`、`bash`。这些工具都绑定 agent session 的 `workspaceRoot` 作为 cwd，不暴露 `workdir`；普通小说入口 cwd 固定为 Workspace Root `workspace`，当前项目通过 `AppendingSet` runtime reminders 的 `Current Project Workspace` 表达，便于同一 agent 跨多个 Project Workspace 写作；`user-assets` 入口 cwd 仍是 `workspace/.nbook`。`bash` 只调用真实 bash，stdout/stderr 合并，长输出写系统临时 `.log` 并把尾部与 `Full output` 路径返回给模型。
- 已让 v3 harness 的 toolResult 保留工具原始 content，避免 `read` 图片等非文本结果被压扁成纯文本。
- 已把完整 v3 `leader.default` 主实现放入 `assets/workspace/.nbook/agent/profiles/builtin/leader.default.profile.tsx`，通过动态 profile catalog 加载。源码内 `server/agent/profiles/default-profile.ts` 仍保留为最小 fallback，但不再默认允许 `report_result`。
- 已把 v3 `leader.assets` 主实现放入 `assets/workspace/.nbook/agent/profiles/builtin/leader.assets.profile.tsx`，使用户资产 workspace 的系统默认 profile 可以被真实 catalog 加载；`leader.assets` 作为 builtin key 不进入 dynamic profile type index。
- 已新增 profile 文件名 warning：`<profileKey>.profile.tsx` 与 `manifest.key` 不一致时进入 catalog issue，但不阻断加载，`loadStatus` 仍保持 loaded。
- 已补测试证明：默认 leader 不包含 `report_result` 时普通 completion 不触发缺失 report 提醒；显式允许 `report_result` 的 profile 仍触发结构化完成协议与一次自动提醒。
- 已完成第一轮 Prompt Phase 校准：回查本地 Pi `read/write/edit/bash` 源码后，对齐 v3 基础工具 description、read 截断续读提示、bash 输出说明和 `leader.default` 的工具选择规则；同时修复 assets profile 中 `String.raw` 导致中文提示词被转成模型可见 unicode escape 的问题。
- 已完成 v2 -> v3 主路径硬切：`server/agent-v3` 提升为 `server/agent`，旧 `server/agent` 移到 `server/agent-v2`，旧 `assets/agent` 移到 `assets/agent-v2`，`tsconfig` 排除 v2 归档目录。
- 已删除旧 Prisma `AgentThreadKind`、`AgentThreadRunStatus`、`AgentThread`、`AgentMessage`，并重新生成 Prisma client。
- 已从 active runtime 移除 LangChain 依赖：删除旧 `server/utils/model.ts` / `model.test.ts` / `agent-message-utils.ts`，`package.json` / `bun.lock` / `nuxt.config.ts` 不再声明 `@langchain/*` 或 `langchain`。
- 已新增轻量 `server/utils/model-settings.ts`，保留模型设置 DTO 组装、profile 模型配置和 enabled model 列表；旧模型健康检查/远程发现暂时返回“等待迁移到 Pi provider”的结果。
- 已删除旧 `/api/agent/threads/**` 路由与旧 thread message route；正式 `/api/agent/**` 现在指向新 session contract。
- 已把非 Agent 的旧 LangChain 调用禁用：`server/api/writing/continue.post.ts` 和 `server/content/ai-annotation-executor.ts` 明确返回迁移待办错误，后续再接 Pi provider。
- 已把 workspace 内容节点 CLI 从归档的 `assets/agent-v2/scripts/workspace.ts` 迁入 active Agent assets：`assets/workspace/.nbook/agent/scripts/workspace.ts`。项目根 `scripts/` 保留给开发、部署、构建脚本，不作为 Agent runtime 合同。
- 已收窄“同步系统 assets”：Agent profile/skill 从 `assets/workspace/.nbook` 补到 `workspace/.nbook`；旧 workspace 模板已迁到 `assets/workspace/.nbook/templates` 与 `workspace/.nbook/templates`，不再把 `assets/agent-v2` 归档同步给用户。
- 已确认前端 Agent 迁移目标是尽量还原旧抽屉完整功能，而不是只恢复最小聊天入口。普通聊天、session 列表、linked agents、message edit、refresh/retry、rollback、branch 切换、model override、Plan Mode soft toggle、request_user_input / approval resume 都进入新 session/invocation/event contract 的设计范围。
- 已确认正式前端迁移时删除旧 `/api/agent/threads/**` contract，不做 thread -> session 兼容层；新前端只使用 `/api/agent/sessions/**`、session command、session events 和 profile/skill catalog 等新入口。
- 已确认前端 session stream 第一版直接暴露 Pi `AgentEvent` 语义，不再设计一套旧 UI projection event。Neuro Book 只额外提供少量 session control event，例如 `snapshot_required`、`follow_up_queued`、`session_entry`、`session_state_changed`。
- 已新增 `shared/dto/agent-session.dto.ts` 作为正式前后端 DTO，删除 active code 对 `shared/dto/agent-v3.dto.ts` 和旧 `shared/dto/agent-chat.dto.ts` 的 Agent UI 依赖。
- 已实现 session event hub：同一个 session 支持多 subscriber、递增 `seq`、bounded replay、`snapshot_required`、Pi event envelope 和 `follow_up_queued` / `session_entry` / `session_state_changed` / `invocation_aborted` 等 control event。
- 已实现 active invocation lock：同一 `sessionId` 串行运行 provider loop / compact / control command；运行中新的普通 prompt 进入 FIFO followUp queue，approval resolution 优先恢复当前 pending tool call。
- 已实现 abort 控制入口：取消当前 provider/tool run，默认清空未 drain followUp queue，已落盘消息和状态不回滚，无 active invocation 时幂等返回 idle。
- 已实现 `tree + next.invoke` API，前端 edit message、retry/refresh、rollback/fallback 都走 append-only branch navigation，不原地修改或删除旧分支；当前实现先移动 leaf 再 invoke，失败时不会自动回滚 leaf，后续需补真正原子语义。
- 已实现 session command dispatcher：`/plan`、`/model`、`/compact` 等控制动作走 `/api/agent/sessions/:sessionId/commands`；`/invocations` 不解析 slash command，用户输入 `/xxx` 时仍可作为普通文本发送给模型。
- 已调整 Agent 抽屉 slash command：`/plan` 是唯一 Plan Mode 命令，行为等同按钮/Shift+Tab toggle；底部压缩按钮已移除，但 `/compact` 仍保留；当输入框已有普通文本时不再提示 `/compact`、`/clear`、`/new` 这类 session-control 命令。
- 已调整 `/clear` 语义：不再新建 session，而是通过 session tree 把当前 `active leaf` 移到空历史。旧 entries 和分支仍保留，后续 prompt 从同一 session 的空 leaf 下追加新分支。
- 已调整前端 session message 投影：`custom_message` 会显示为系统卡片，其中 `<system-reminder>` / `system-reminder` custom message 使用轻量 System Reminder 样式；`compaction` 与 `branch_summary` 也会作为可见系统卡片展示，避免 session 中模型可见或历史结构变化对用户完全不透明。
- 已实现 Agent Harness 错误可见化：`invocation_lifecycle status="error"` 现在保存 `errorInfo`，包含 `message` 与 `phase`（`pre_loop` / `model` / `ingest` / `compaction` 等）。前端 snapshot 与 SSE 增量都会把没有对应 assistant error 的 lifecycle error 投影为红色 `Run Error` 系统卡片；该卡片模型不可见，不进入 reducer 的 `messages`。阻塞式 invoke HTTP 返回 `{status:"error"}` 时会先同步 snapshot，若仍没有可见错误再弹 notification 兜底。
- 已完成前端 Agent 抽屉迁移：删除旧 `useAgentApi` / `useAgentThreadSession`，新增 `useAgentSessionApi` / `useAgentSession`；`AgentThreadDialog.vue` 改为 `AgentSessionDialog.vue`，`AgentSubagentPanel.vue` 改为 `AgentLinkedAgentPanel.vue`。
- 已把 `NovelAgentDrawer.vue` 接到新 session snapshot/event store，保留发送、停止、继续、审批/输入恢复、Plan Mode、模型选择、compact、session 列表、linked agents、edit/retry/rollback/fallback 等核心入口。
- 已把聊天渲染切到新 card 派生层：输入为原始 `AgentMessage[]`、session event 和 live invocation，输出用户/assistant 文本卡、通用工具卡，以及 `write` / `edit` / `apply_patch` 等专用工具卡；`read`、`bash` 当前先走通用工具卡，后续按实际体验再补专用渲染。`message_update` 与 `tool_execution_update` 只更新 live card，历史真相仍以后端 snapshot 为准。
- 配置系统已切到 `/api/config/*`：旧 `/api/settings/workspace-agent-profiles`、`/api/settings/*` 与 `/api/workspace-settings` 已删除，不做兼容 adapter。默认 Agent Profile 现在由 Config 系统解析：Global Config `workspace/.nbook/config.json` 保存 `agent.defaultProfileKey.userAssets` / `agent.defaultProfileKey.novel`，Project Config `workspace/{project}/.nbook/config.json` 可覆盖当前小说 Project Workspace 的 `agent.defaultProfileKey`，新建 session 读取最新 effective default profile。

## Decisions

- 后端 harness 内部运行时事件主干采用 Pi `AgentEvent` 语义。
- 后端 harness 第一版不直接依赖 Pi `AgentHarness`。Neuro Book 自建 `NeuroAgentHarness`，底层使用 `pi-ai` + `pi-agent-core` 的 `Agent` / `AgentLoop` 能力。
- 前端已接入新 session/invocation/event contract，不兼容旧 thread DTO，也不保留 thread -> session adapter。
- 第一版启用 `custom` entry 承载产品/运行时状态，例如 agent link/detach、session metadata、UI 状态和内部索引。`custom_message` 作为 entry 类型保留，但默认不主动使用；只有确实需要“模型可见 + UI 可自定义渲染 + 不归类为普通 user/assistant/toolResult”的内容时再启用。
- 采用 Pi 的 `Context` 形状：

```ts
type Context = {
    systemPrompt?: string;
    messages: Message[];
};
```

- `messages[]` 不允许直接放 LangChain `SystemMessage` 或 OpenAI 风格 `{ role: "system" }`。现有 TSX Profile 迁移时必须适配这一点。
- 当前阶段不 fork Pi 的 `Message` union 去加入 `SystemMessage`。system prompt 可以属于 session 可追踪历史，但发送给 provider 时走 `Context.systemPrompt`。
- 当前前端会在 session snapshot 顶部把 `systemPrompt` 展示为只读 System Prompt 卡片，默认收起并使用 Markdown 渲染；它不伪装成 `custom_message`，也不作为普通聊天历史写入 session。
- v3 彻底禁止 TSX Profile 在 `messages[]` 中生成中间 `SystemMessage`。Profile prepare contract 只能输出 `systemPrompt?: string` 与 Pi-compatible `messages: Message[]`。旧 profile 如果需要“中途提醒”，应改成普通 user/assistant message、dynamic context 或 custom session state，而不是 SystemMessage。
- TSX Profile 机制保留。Pi 不替代 Neuro Book profile，Pi 替代的是 profile 之后的 provider/message/tool/runtime 形状。
- `prepare()` 当前返回 Pi/Neuro Book harness 可消费的 `ProfileTurnPlan`：`systemPrompt`、`historyInitMessages`、`appendingMessages`、`modelContextAppendingMessages`、`modelContextMessages`、`stateWrites`。普通 profile 推荐写 `context(ctx) => JSX`，由 DSL runtime 编译成该 plan。
- Pi append-only entry tree 语义全面采用。实现上可以先用 JSONL，也可以直接做 DB-compatible entry schema；长期应能从 JSONL 迁移到 DB。
- Profile 即 Agent。用户可以像开发本地插件一样开发 `.profile.tsx`，系统在不重启的情况下动态发现、加载和校验这些 agent。
- 删除 leader/subagent 领域分层，统一为 agent。`leader.default`、`leader.assets` 只是历史命名保留的 agent key，和其他 agent 没有类型层级差异。旧 `create_subagent` / `invoke_subagent` 已迁移为 `create_agent` / `invoke_agent`；Pi subagent 示例只作为多 agent 编排模式参考，不进入 Neuro Book 的 active API 命名。
- Agent runtime 统一采用 TypeBox / JSON Schema。v3 profile 的 `InputSchema` / `OutputSchema`、内置工具 schema 和 agent catalog schema 都迁移为 TypeBox，不保留 Zod 兼容层。非 Agent 的 API DTO 暂不作为本重构范围。
- 新 Agent 主实现直接落在 `server/agent`。旧 v2 归档在 `server/agent-v2`，不再作为运行时 fallback。
- v2 后端测试不作为迁移包袱保留。新 v3 根据新的 harness/session/tool/profile contract 重新建立测试。
- 不直接把 Pi `AgentHarness` 作为 Neuro Book 后端主干。Neuro Book 实现自己的 `NeuroAgentHarness`，参照 Pi TUI / coding-agent 的产品层做法：产品层拥有 session、workspace、profile、resource、tool policy、SSE/事件适配和前端状态语义，底层使用 Pi core `Agent` / `AgentLoop`、Pi message/tool/event 类型。
- JSONL session 第一版放在 `workspace/.nbook/agent/sessions`。这是 Neuro Book workspace 容器级运行时状态目录，不是用户 assets 覆盖目录；session entry schema 要保持 append-only tree，并预留未来迁移到数据库的字段形状。
- 用户资产工作区根目录从旧的 `workspace/.nbook/assets` 重新评估为 Workspace Root `.nbook`，当前 `user-assets` 入口直接挂载 `workspace/.nbook`。第一阶段仍保留 `workspaceKind: "user-assets"` 作为前端/API 查询入口，但它只表示“打开 Workspace Root `.nbook`”，不是新的配置 scope；长期再演进到显式 workspace root / workspace scope。
- `.nbook` 作为 Neuro Book workspace 配置目录，既承载运行时元数据，也承载用户可编辑的配置/资源覆盖层。
- 去掉 `resources` 目录层级。参照 Pi 的 project-local `.pi/...` 习惯，资源目录直接挂在 `.nbook` 下。
- Agent 相关可编辑资源放在 `.nbook/agent/...` 下：profiles、skills 与 sessions 同属 agent 体系，但通过子目录区分“可编辑定义”和“运行时会话”。
- 完整 builtin leader profile 不再长期放在 `server/agent/profiles/default-profile.ts` 作为主实现。主实现落到 `assets/workspace/.nbook/agent/profiles/builtin/leader.default.profile.tsx`；源码内最小 builtin 先保留为 contract / smoke fallback，后续评估删除，不能成为用户可编辑链路之外的第二套真实 prompt。
- 非 Agent 的可覆盖资源放在 `.nbook/templates/...` 等领域目录下，不再保留旧的 `.nbook/assets/server/workspace/...`。旧 `server/workspace` 暴露实现分层，迁移后改成更领域化的 `templates`。
- 系统级 Agent assets 已采用和用户 workspace 配置根镜像的结构：系统根为 `assets/workspace/.nbook/agent`，用户根为 `workspace/.nbook/agent`。workspace 模板覆盖已切到 `assets/workspace/.nbook/templates` 与 `workspace/.nbook/templates`。

## Pi Tool Execution Notes

- assistant message 中的 tool call 是 content block：

```ts
{
    type: "toolCall";
    id: string;
    name: string;
    arguments: Record<string, unknown>;
}
```

- 执行流程：
  - 解析 assistant message 中的 tool calls。
  - 根据全局 `toolExecution` 和单个 tool `executionMode` 决定 parallel 或 sequential。
  - 对每个 tool call 执行 `prepareArguments`。
  - 使用 TypeBox schema 校验参数。
  - 调用 `beforeToolCall`，可返回 `{ block: true, reason }` 阻止执行。
  - 调用 tool `execute(toolCallId, params, signal, onUpdate)`。
  - tool 可通过 `onUpdate` 产生 `tool_execution_update`。
  - 调用 `afterToolCall`，可改写 `content` / `details` / `isError` / `terminate`。
  - 生成标准 `ToolResultMessage`，然后进入下一轮 LLM context。
- 并行执行时，`tool_execution_end` 可按完成顺序发出；tool result message 应按 assistant 原始 tool call 顺序进入上下文。
- Neuro Book 的审批、白名单、Plan Mode gate、skill gate、workspace/assets 权限检查适合落在 `beforeToolCall` 对应的后端 harness hook。
- `report_result`、`request_user_input`、agent 结果归一化、超长输出截断适合落在 `afterToolCall` 对应的后端 harness hook。
- 第一版不做插件式 hook registry，采用固定 tool pipeline：schema validate -> tool policy / allowedToolKeys -> execute -> result normalize -> special handling -> persist events。路径访问不做 workspaceRoot 硬沙箱；workspaceRoot 只作为工具创建时绑定的默认根目录。
- v3 基础文件/命令工具采用 Pi coding-agent 的模型可见命名，不继续兼容 v2 旧工具名：`read_file` -> `read`，`write_file` -> `write`，`edit_file` -> `edit`，`execute_shell` -> `bash`。`apply_patch` 作为 Neuro Book/Codex 风格的补丁编辑工具继续保留，并纳入同一套文件工具路径和返回合同。
- v3 不把 `@earendil-works/pi-coding-agent` 作为运行时依赖来直接复用产品层工具。基础工具在 `server/agent/tools` 内参考 Pi 源码自实现：schema、模型可见 content string、截断策略、bash 查找和 tool result 合同对齐 Pi，但文件系统操作、session metadata、事件和测试边界归 Neuro Book harness 拥有。
- Pi 文档默认暴露的核心写入工具是 `read`、`write`、`edit`、`bash`。Pi 源码还提供 `grep` / `find` / `ls` 工具，并在工具内部把返回路径规范化为 `/`；Neuro Book v3 本轮不注册这些模型工具，继续在 leader prompt / AGENTS 指南中要求 Agent 通过 `bash` 调用既有 CLI，例如 `rg --files`、`rg <pattern>`、`find`、`ls`、`workspace node ...` 等。Agent bash runtime 通过 ripgrep config 让 `rg` 输出 `/` 路径，因此 prompt 可直接使用 `(^|/)` 路径过滤。
- v3 不把 `rg` 设计成单独模型工具名。`rg` 是推荐 CLI，属于 `bash` 内的命令用法；这样保留当前项目的 v2 工作习惯，也避免同时维护两套文件发现工具语义。
- v3 `bash` 严格要求真实 bash。实现参考 Pi：Windows 优先自动查找 Git Bash 或 PATH 上的 `bash.exe`，Unix 优先 `/bin/bash` 或 PATH 上的 `bash`；如果找不到 bash，工具直接报错，不回退 PowerShell。
- v3 `read` / `write` / `edit` / `bash` 都不把 `workdir` 暴露给模型。Pi 的做法是在创建工具时绑定 cwd；Neuro Book v3 同样在创建工具时绑定当前 agent session 的 workspaceRoot 作为 cwd。普通小说 session 的 cwd 固定为 `workspace`，相对路径必须显式写 Project Workspace slug，例如 `novel-7/lorebook/...`；user-assets session 的 cwd 是 `workspace/.nbook`，相对路径使用 `agent/profiles/...` / `agent/skills/...`。绝对路径按绝对路径解析；第一版不额外限制路径必须位于 workspaceRoot 内。
- `report_result` 实现为普通 tool，但 `afterToolCall` / harness completion collector 会识别它的结构化结果并更新 run completion state。
- `report_result` 不作为所有 agent 的隐式内置工具。profile 作者必须在工具权限中显式允许 `report_result`，目标 agent 才能调用它。第一版不自动给所有 agent 注入 `report_result`。
- `request_user_input` 保留为 v3 tool contract，并与 Plan Mode 审批共用 `continue + resolution` 恢复入口。第一版不新增 custom pending entry；等待态由 session 尾部未完成的 hardcoded approval tool call 推导。
- tool result 的 model-visible content 进入 LLM context；raw/details 只进入 session entry metadata，不默认塞给模型。
- `report_result` 缺失时的返回规则：
  - 如果目标 agent 正常结束 ReAct，但最后一条消息不是 `report_result`，harness 先自动追加一条提醒，要求目标 agent 以 `report_result` 结束；如果下一轮仍然以普通消息结束，则把“最后一条普通消息 + 未正确 report 的提醒”一起返回给调用方。
  - 如果是 harness 级错误，例如 provider/API 超时，则调用方直接收到错误报告。
  - 如果是 `report_result` 参数错误，不单独做特殊分支处理；目标 agent 的 ReAct loop 自行纠错，这类情况归入上面两种结果路径。

## Session / Thread Plan

- 新后端 harness 使用 session 作为核心抽象，不再把 provider history 当作一组可变 message。
- 第一版 session repo 使用 JSONL 文件，根目录固定为 `workspace/.nbook/agent/sessions`。
- session 文件属于运行时数据，不进入用户 assets 覆盖体系。用户在 `workspace` 工作区编辑资源时，默认不应该把 session JSONL 当作普通 profile/skill 文件来维护。
- 目标 entry 类型至少包含：
  - `message`
  - `model_change`
  - `thinking_level_change`
  - `profile_change`
  - `variable_change`
  - `session_update`
  - `compaction`
  - `branch_summary`
  - `custom`
  - `custom_message`
  - `label`
  - `leaf`
- `leaf` 必须持久化，不能只是内存 cursor。
- `session_update` 用于 append-only 地更新 session metadata，例如 `title` / `summary`。最终 session 标题和摘要由 reducer 取 active path 上最新值，不做原地覆盖。
- `custom` 和 `custom_message` 的区别：
  - `custom` 是运行时/产品状态 entry，例如 UI 状态、pending 状态、内部索引、工具详情或审计信息。它参与 session reducer 的 `customState`，但不进入 LLM context。
  - `custom_message` 是产品自定义但模型可见的消息 entry。它可以进入 LLM context，并可单独控制 UI 是否展示。
- `request_user_input` 和 Plan Mode 等等待态统一通过硬编码 approval tool 集合处理。当前集合为 `request_user_input`、`enter_plan_mode`、`exit_plan_mode`；独立 `skill` 工具已禁用，不再参与 approval 恢复。
- 第一版不为等待态新增 `custom pending` entry。pending 状态由 session active leaf 推导：最后一条 assistant message 中存在 hardcoded approval tool call，且后续没有对应 `toolResult`。
- 活跃进程内，`beforeToolCall` 可以等待用户操作；用户批准/拒绝/回答后，harness 生成对应 `toolResult` 并继续当前 run。
- 如果程序在等待审批期间终止，重启后前端/后端通过 session 尾部 assistant tool call 恢复待处理状态。恢复时调用 `continue` 的 `resolution` 参数，由 harness 先 append 对应 `toolResult`，再执行 Pi `continue()`。未批准的工具不会因为重启被自动执行。
- 构造模型上下文时，从 active leaf 回溯到 root，得到 path，再 reduce 出 `systemPrompt`、`messages`、model、thinking level、profile/runtime state。
- Neuro Book 的 reducer 结果采用 `NeuroSessionContext` 方向，比 Pi `SessionContext` 多保留 profile、workspace 和产品状态：

```ts
type NeuroSessionContext = {
    systemPrompt: string;
    messages: AgentMessage[];
    model: ModelRef | null;
    thinkingLevel: string;
    profileKey: string;
    workspaceRoot: string;
    customState: Record<string, unknown>;
};
```

- 旧 thread 历史不应被静默改写；继续采用 append-only 语义。
- 如果先用 JSONL，应保持 entry schema 和未来 DB 表结构兼容。
- 参照 Pi session tree：单个 session 文件内保留分支树，`leaf` / active cursor 需要持久化；fork/clone/tree navigation 后续在同一 entry tree 语义上实现。
- Pi 中可回溯/选择的“阶段”是 session `entry`。每个 entry 都有 `id`、`parentId`、`timestamp`，组成 append-only tree；当前所在阶段由 `leaf` 指针表示。
- 回到任意阶段不是删除历史，而是把 `leaf` 移到目标 entry。之后继续追加会在该 entry 下产生新 branch。Pi 的 `moveTo(entryId)` / tree selection 就是这个语义。
- entry 可以存自定义数据：
  - `custom` entry：存扩展/产品状态，不进入 LLM context。
  - `custom_message` entry：存自定义消息，可进入 LLM context，并可控制是否在 UI 显示。
  - `label` entry：给某个 entry 加用户标签/书签。
  - `branch_summary` / `compaction` entry：系统级 summary entry，也可带 `details`。
- 旧 v2 `AgentThread` / `AgentMessage` 不迁移到 v3 session。当前还没有真实用户数据，允许彻底重构，避免为了旧模型引入兼容补丁。
- v3 内部与 API 命名都使用 `sessionId`，不继续沿用旧 `threadId`。`sessionId` 第一版使用全局唯一数字递增 ID，便于模型、UI、日志和跨 workspace agent 调用直接引用；本阶段先把后端 contract 定干净，前端后续跟随迁移。
- 本次是完全重构，不做兼容补丁。过时的 v2 设计只作为理解材料，不作为 v3 约束；遇到边界不清时优先参考 Pi 的 session / resource / event 设计重新优化。
- Agent 调用第一版保留两个显式接口，而不是一个接口里塞 `mode`：
  - `prompt`：追加新的用户输入并启动 run。
  - `continue`：不追加新用户输入，从当前 session/context 继续 run。
- session JSONL 文件按 workspace key 分目录，但文件名使用全局唯一数字 `sessionId`：

```text
workspace/.nbook/agent/sessions/
  global/
    <session-id>.jsonl
  <novel-workspace-key>/
    <session-id>.jsonl
```

- 全局 `workspace` 的 workspace key 使用 `global`。小说 workspace key 后续可用 novel slug/id，但必须稳定、文件名安全，并能从 session metadata 反查真实 workspace root。
- `sessionId` 不按 workspace 重新从 1 开始。全局递增可以避免两个 workspace 同时存在 `sessionId=1` 时，工具/API 必须额外携带 workspace scope 才能定位 session。
- 全局 session 计数器第一版可以放在 `workspace/.nbook/agent/session-seq.json` 或 `workspace/.nbook/agent/sessions/index.json`。后续迁移到数据库时，数字 `sessionId` 可以直接映射为自增主键。
- `profileKey` 是选择 profile/agent 实现的稳定业务 key，例如 `leader.default`、`leader.assets`、`writer`、`retrieval`。session metadata / session entry 记录 `profileKey`，构造上下文时用它加载当前最新 profile。
- 不引入 `profile epoch` 作为第一版核心概念。当前基础模型仍是“session 历史消息 + profileKey + 每轮 prepare”。`HistorySet` 是否注入由历史状态决定：如果历史里已经有 profile 稳定前缀，则不重复注入；如果是新 session 或显式切换 profile 后需要新稳定前缀，则按新 session 状态处理。
- profile source hash 不冻结执行。v3 保持“下次运行按 profileKey 加载当前最新 profile 实现”的语义；hash 不写入 session schema，第一版不做 profile 来源审计。
- profile TSX 源码变化本身不主动改写所有旧 session，也不追加 `profile_snapshot` entry。是否重新注入 `HistorySet` 只由 session 历史状态和显式 profile 切换行为决定。
- session entry 不保存完整 prepared prompt。持久化历史由真实 user/assistant/tool messages、`HistorySet` 首次稳定前缀、`AppendingSet` 需要写入历史的运行期消息，以及 profile/session state entry 组成。
- `HistorySet` 渲染结果是 `message[]`，并作为 `custom_message visibleToModel: true` entries 写入 session。第一版不引入 `profile_history` entry 作为历史容器。
- 普通 `message` entry 增加可选 `origin` 元数据；真实 prompt 用户输入写 `origin: "prompt"`，harness 自动提醒、toolResult、ingest 等写其他 origin。该字段用于 `repeatEveryTurns` 这类 runtime 语义区分真实用户 prompt 轮次；旧 entry 为空仍可读取。
- `create_agent` 创建空 session 时不立刻注入 `HistorySet`。空 session 只保存实例配置、metadata 和必要 session entries；第一次 `invoke_agent(prompt)` 或 `continue` 实际运行时再 prepare，并在需要时把 `HistorySet` 写入 session。
- `HistorySet` 只在当前 active path 没有 model-visible message 时写入 session，不因 profile 源码更新自动替换，也不使用 `profile.history.injected` 标记。profile 更新只影响后续 `systemPrompt`、`ModelContext`、`AppendingSet` 和 prepare/context 行为，不改写已经落入 history 的稳定前缀。
- `ModelContext` 是本轮上下文：普通 message 进入本轮 provider context，不写 session。`ModelContext` 内触发的 `Reminder` 会编译为 `modelContextAppendingMessages`，按 AppendingSet 语义在 ReAct 前写入 session 并展示。旧 `DynamicSet` 已删除，不提供公开 alias。
- `AppendingSet` 是贴近当前输入的最新上下文区域：进入本轮 provider context，并且渲染出的非空 messages 默认全部写入 session。v3 可以优化具体 entry 形态，但不能把它降级成“不进上下文”或“只是不持久化”的区域。
- `AppendingSet`、本轮 user message、需要写入 history 的运行期上下文，应在 provider 调用前写入 session。这样即使 run 被 abort 或 provider 报错，session 仍记录模型实际看到过的上下文。
- `prepare()` 在 prompt 用户消息落盘前运行，但 `ctx.runtime.pendingUserMessage` 会提供本轮只读 pending prompt，方便 `ActivatedSkills` 或条件 reminder 读取当前输入。真实用户消息仍由 harness 在 `historyInitMessages -> modelContextAppendingMessages -> appendingMessages -> stateWrites` 后统一写入 session。
- run 被 abort、provider error 或工具系统错误时，已经写入的 user message / AppendingSet / 部分 assistant streaming message 都保留，并追加 run status / error entry 标记结果，不做回滚。
- v3 prompt contract 采用 `ProfileTurnPlan.systemPrompt?: string` 作为 provider 级 system prompt。TSX DSL 中 `System` 编译为该字段；`HistorySet` 编译为 history init，`ModelContext` 普通消息编译为 model-only 分区，`ModelContext` 内的 `Reminder` 编译为 `modelContextAppendingMessages`，`AppendingSet` 编译为 pre-loop session append 分区。不支持 JSX `<Message role="system">`。
- `reserveTokens` / `keepRecentTokens` 属于 compaction policy，第一版跟随 harness/config 设置。profile 不提供 compaction 建议值，也不提供压缩提示词。

## Workspace / Assets Redesign Notes

- 当前稳定术语见 `reference/workspace/TERMS.md`：
  - Workspace Root：应用运行数据根目录，默认 `workspace/`。
  - Workspace Root `.nbook`：全局控制区，默认 `workspace/.nbook/`。
  - Project Workspace：单本小说或具体项目目录，默认 `workspace/{project}/`。
  - user-assets：前端用于编辑 Workspace Root `.nbook` 的入口，不是独立配置层。
- `user-assets` 入口当前直接挂载 `workspace/.nbook`，不再使用 `workspace/.nbook/assets` 作为嵌套资产根。
- 第一版仍使用 `workspaceKind: "user-assets"` 作为前端和 workspace-files API 的查询入口；这只是兼容入口命名，内部解析到 `workspace/.nbook`。后续若继续演进，可把查询模型收敛到显式 workspace root / workspace scope。
- 当前只支持两类编辑目标：
  - Project Workspace：`workspace/{project}`，用于单本小说内容。
  - Workspace Root `.nbook`：`workspace/.nbook`，用于全局配置、用户 assets、Agent profiles/skills 覆盖层和运行状态。
- `.nbook` 是 Neuro Book 控制目录，既承载运行时元数据，也承载用户可编辑的配置/资源覆盖层。
- 当前目标目录结构：
  - `workspace/.nbook/config.json`：Global Config。
  - `workspace/{project}/.nbook/config.json`：Project Config。
  - `workspace/.nbook/agent/profiles`：用户自定义或覆盖 Agent profile。
  - `workspace/.nbook/agent/skills`：用户自定义或覆盖 skill；同名 skill 继续按整个目录覆盖。
  - `workspace/.nbook/agent/sessions`：Pi-style append-only session JSONL。
  - `workspace/.nbook/templates/content-node-templates`：内容节点模板用户覆盖。
  - `workspace/.nbook/templates/novel-directory-templates`：新小说 Project Workspace 初始模板用户覆盖。
- 系统内置 `assets/workspace/.nbook/` 同步调整为相同结构：
  - `assets/workspace/.nbook/agent/profiles` 覆盖到 `workspace/.nbook/agent/profiles`。
  - `assets/workspace/.nbook/agent/skills` 覆盖到 `workspace/.nbook/agent/skills`。
  - `assets/workspace/.nbook/templates/content-node-templates` 覆盖到 `workspace/.nbook/templates/content-node-templates`。
  - `assets/workspace/.nbook/templates/novel-directory-templates` 覆盖到 `workspace/.nbook/templates/novel-directory-templates`。当前 manuscript 模板推荐 `manuscript/001-volume/001-chapter/` 这种 volume / chapter 层级，不再只给浅层单章示例。
- 覆盖机制以 `.nbook` root 为统一边界比较内部相对路径。系统 `assets/workspace/.nbook/<relative>` 被用户 `workspace/.nbook/<relative>` 覆盖；同名 skill 目录仍按整个目录覆盖，其他资源按文件覆盖。
- 系统 assets 路径迁移采用一次性硬切，不保留旧 `assets/agent/...`、`assets/server/workspace/...`、`workspace/.nbook/assets/...` 的兼容扫描 fallback。迁移实现必须同步更新 resolver、同步系统 assets、profile catalog、skill catalog、workspace template loader、profile check/prepare 脚本、测试 fixture 和提示词中的路径说明。
- user-assets 文件树默认显示 `workspace/.nbook` 内容，包括 `agent/sessions`。这个入口用于编辑和检查 Neuro Book 配置、资源与运行时会话。普通 `workspace/{project}` Project Workspace 可以继续隐藏或弱化自身 `.nbook`，避免写作时被内部配置和 session 文件干扰。
- 旧 `workspace/.nbook/assets/...` 用户目录不做迁移脚本，也不做运行时 fallback；当前还没有真实用户数据，直接硬切。
- “同步系统 assets”迁移后从 `assets/workspace/.nbook` 复制缺失文件到 `workspace/.nbook`，目标已存在时继续跳过，不覆盖用户文件。

## Profile Fusion Plan

- 当前 TSX Profile 的 DSL 和用户资产体系继续保留。
- v3 术语收敛为：profile 就是 agent 定义；agent session 是某个 profile/agent 的运行实例。不再保留 `leader` / `subagent` 作为架构概念。
- `leader.default` 和 `leader.assets` 只是系统内置 agent 的 key/name。使用这两个 agent 的入口负责按它们各自的 `InputSchema` 创建实例配置；运行时不再因为 key 前缀给它们特殊类型待遇。
- Agent session 与 agent instance 第一版保持 1:1：
  - `AgentDefinition` 是 `.profile.tsx` 定义。
  - `AgentInstance` 是 `profileKey + input`，其中 `input` 由该 agent 的 `InputSchema` 校验。
  - `AgentSession` 绑定一个 `AgentInstance` 的 append-only 历史。
  - `AgentSession` metadata 第一版包含 `title` 和 `summary` 两个可读字段。它们可以由 AI 或用户更新，用于在 `get_agent()`、UI 列表和父 agent prepare snapshot 中识别 agent 目的。
  - 允许空 session：`create_agent` 可以只创建 `AgentInstance + AgentSession`，不立即写入 user message。`profileKey + input` 必须已知并通过 schema 校验，但 `title` / `summary` 初始可以为空；第一次 run 后再由 profile/harness 生成或更新。`get_agent` 列表中如果 `title` 为空，展示层可退回 `profileKey`。
  - 同一个 session 不允许中途切换 `profileKey` / agent definition；要换 agent 就创建或打开另一个 session。
  - 第一版不允许修改已创建 agent 的 `input`。要调整实例配置就创建新 agent。未来如果需要支持修改，应采用 append-only input update entry，并由 reducer 取 active path 上最后一次合法 update 作为当前 input，不做原地覆盖。
  - 这样可以避免稳定历史前缀、provider 级 systemPrompt、compact summary、tool allowlist 和实例 input 在同一条历史里混用。
  - `create_agent` 返回最小可识别信息：`sessionId`、`profileKey`，以及可选 `title`。调用方后续只用全局 `sessionId` 调用或查询该 agent。
  - `workspaceRoot` 在 `create_agent` 时固定，第一版不允许修改。要换 workspace 就创建新 agent，避免文件工具权限、相对路径和历史消息里的路径语义混用。
- 用户自定义 agent 开发方式：
  - agent/profile 模块继续使用 `defineAgentProfile` 契约。
  - 模块显式导出 `profileManifest`、`InputSchema`、`OutputSchema`、`Input`、`Output`。
  - 用户或 Agent 修改 `.profile.tsx` 后，通过单文件 typecheck 命令校验；共享源码变化再跑 `bun run typecheck`。第一版不依赖任何准备好的兼容层，profile 源码与静态类型索引保持同一套 TypeBox 约束。
  - 动态 loader 监听或按需扫描系统/用户 `.nbook/agent/profiles/**/*.profile.tsx`，支持不重启发现新增、删除和修改的 agent。
  - 文件名建议与 manifest key 对齐为 `<profileKey>.profile.tsx`。loader 第一版不因为文件名不一致而拒绝加载，避免用户重命名文件时直接破坏运行；`profile check` 和 catalog issue 应提示文件名与 manifest key 不一致。
  - 用户自定义 profile 的运行时加载与静态类型推导分两层：运行时直接动态 import + TypeBox 校验，不依赖 prepare/typegen；开发期如果需要按 `profileKey` 静态推导 `Input` / `Output`，则通过 typegen 生成 `DynamicProfileInputMap` / `DynamicProfileOutputMap` 并与 builtin map 合并。builtin key 的静态类型永远不被用户覆盖改写。
- Profile catalog 是运行时事实源：可以列出动态发现的 agent，并读取每个 agent 的 manifest、InputSchema、OutputSchema、allowed tools、加载错误和可预览的 prepare 结果；v3 runtime 删除 `kind` 字段，不再区分 leader/subagent。
- Profile catalog loader 的错误策略分层处理：单个 profile 加载失败时，catalog snapshot 继续可用，只记录该 profile 的加载错误且不把它作为可调用 agent；当前 session 正在使用的 profile 本身加载或 prepare 失败时，本次 run 直接失败并返回明确错误，不静默 fallback 到旧版本或系统默认 profile。
- 每个 profile 实例在 prepare/context 时都可以访问当前已注册 agent catalog 的 schema/manifest，并自行决定是否把这些信息用于 `ModelContext` 或 `AppendingSet` 注入到自己的提示词中。schema 不是专门注入给某个 leader，而是 profile runtime 可访问的能力。
- prepare runtime 暴露的是本轮只读 catalog snapshot。虽然 Node 运行在单线程事件循环上，`prepare` 仍可能 `await`，期间文件 watcher 或用户操作可能更新 registry；因此本轮 prepare 应捕获一致快照，避免同一轮提示词构造中前后读到不同 catalog。
- catalog schema 访问第一版使用 getter / lazy detail 形态：
  - `ctx.agentCatalog.list()` 返回轻量条目：key、name、description、allowed tools、schema 摘要、加载状态。
  - `ctx.agentCatalog.detail(profileKey)` 返回该 agent 的完整 InputSchema / OutputSchema JSON Schema。
  - getter 从本轮 snapshot 读取，不触发 registry mutation。
  - profile 作者决定是否把 list/detail 结果渲染进 `ModelContext` 或 `AppendingSet`。
- `allowedToolKeys` 在 v3 仍作为 runtime 硬权限和默认可见工具集合。用户自定义 profile 可以自己放开工具，但 harness 只向模型暴露目标 profile 声明允许的工具，不把所有工具默认暴露。
- `allowedToolKeys` 同时是“模型可见工具集合”和“执行硬权限上限”。harness 只向模型暴露其中列出的工具，执行前也必须再次校验；即使模型生成了未暴露工具的 tool call，也要拒绝。
- profile 可以声明空 `allowedToolKeys`，用于纯聊天或纯提示 agent。没有 `report_result` 权限的 agent 不能调用结构化结果工具，`invoke_agent` 按普通 completion / missing report 规则处理。
- skill 第一版不做代码层面的 `allowedSkillKeys` 硬拦。可见性先由 `SkillCatalog` 支持属性过滤：Agent 只能在 catalog 中看到指定 skill；实际正文读取通过通用 `read` 工具完成，不再经过独立 `skill` 工具审批流。TODO：未来补 skill 白名单或启用控制。
- v3 调整 InputSchema 语义：
  - `InputSchema` 不再表示每次 invoke 时的自然语言请求参数。
  - `InputSchema` 表示创建某个 agent 实例时的结构化配置，也就是“用这些字段构造一个 Profile 实例”。
  - `ctx.input` / `scope.input` 在 `buildPrompt(ctx)` 中仍然可用，含义是该 agent 实例的配置字段。
  - 每次调用 agent 的运行时输入统一为 `message`，可以包含文本和图片。
  - 用户自定义 profile 的静态类型靠 prepare/typegen 生成索引；运行时直接按 profile module 的 TypeBox schema 校验，不走 Zod 或旧兼容分支。
- `create_agent` / `invoke_agent` 工具语义：
  - `create_agent` 使用目标 agent 的 `InputSchema` 校验并保存实例配置，可以创建任意 agent 实例和空 session。
  - 当 `create_agent` 由某个父 agent session 调用时，默认自动建立 owned / linked agent 关系；该关系挂在当前父 session 上，不挂到整个 workspace。父 agent 后续 prepare 能看到这个 agent session。
  - `create_agent` 创建的目标 agent 不继承父 agent 的工具权限。目标 agent 始终使用自己的 profile `allowedToolKeys`、模型设置、thinking 设置和 workspaceRoot。
  - `create_agent` 第一版只允许传目标 agent `InputSchema` 所需字段，不允许额外覆盖 model / thinkingLevel / workspaceRoot。后续如需修改这些运行设置，应设计独立 agent settings。
  - `create_agent` 可以接受可选 `title` / `summary` 初始值；如果未提供，后续由 agent 或 UI 根据运行结果更新。
  - `invoke_agent` 调用已有 session，只接收目标 `sessionId` 和 `message`，message 可包含图片；它不再接收目标 agent 的 `InputSchema` 结构。
  - 所有 agent 遵循相同 invoke 输入形态。
- `invoke_agent` 同样支持两种调用模式：`prompt` 和 `continue`。`prompt` 追加新输入并开启新一轮运行；`continue` 不追加新用户消息，只从当前 session active leaf 继续执行。基于上一次 invocation 的恢复/继续也归入 `invoke_agent`，而不是单独拆成别的工具。
  - `invoke_agent` 的 `prompt` 模式必须带 `message`；`continue` 模式不允许带 `message`。
  - `continue` 模式可以携带 `resolution`，用于补齐尾部未完成 approval tool call 的 `toolResult` 后再继续运行。`resolution` 是 harness control-plane 入参，不直接暴露给模型；模型最终只看到由 harness 生成的标准 textual `toolResult`。
  - `resolution` 第一版只支持 hardcoded approval tool 集合：`request_user_input`、`enter_plan_mode`、`exit_plan_mode`。harness 必须验证 session 尾部 assistant message 中存在匹配 `toolCallId` / `toolName`，且尚无对应 `toolResult`，否则拒绝恢复。
  - `resolution` 使用 `server/agent/tools/types.ts` 中的 `AgentResolution`：

    ```ts
    type AgentResolution =
        | {
            kind: "tool_approval";
            toolCallId: string;
            approved: boolean;
            resultText?: string;
            data?: JsonValue;
        }
        | {
            kind: "user_input";
            toolCallId: string;
            answers: Array<{
                questionIndex: number;
                text: string;
            }>;
        };
    ```

  - `request_user_input.answers` 第一版允许自由文本回答。前端负责按题号组装最终文本，后端只接收 `questionIndex + text` 结构，不在 harness 内做文本拼装。
  - `payload` 用于承载审批型工具的结构化业务参数，例如 `exit_plan_mode` 的 `planFilePath` / `planContent` 或后续 UI-only 预览字段。harness 读取这些字段来应用副作用和生成 tool result；tool result 的 model-visible content 仍然是短文本。
  - approval 恢复流程：读取尾部 assistant tool call -> 校验 `resolution` -> 按 hardcoded tool 逻辑应用副作用或拒绝副作用 -> append 标准 `ToolResultMessage` -> 调用 Pi `continue()`。
  - `invoke_agent.block` 可选，默认 `true`。阻塞调用等待目标 agent 本轮运行结束后返回结果；非阻塞调用后续再做，第一版只在 schema / TODO 中预留方向。
  - `invoke_agent` 运行目标 session 时，使用目标 session 自己绑定的 workspaceRoot，不继承调用方 workspaceRoot。跨 workspace 调用可以发生，但被调用 agent 仍在自己的 workspace 边界内运行。
  - 父 agent 调用子/关联 agent 时，不把目标 session tree 挂到父 session tree 下面。父 session 只记录一次 tool call / tool result 摘要，目标 agent 的完整历史留在目标 session 中。
  - 父 agent 拥有或关联的 agent 列表仍然需要对 profile prepare 可见。v2 `leader.default` 里依赖 `scope.agent.subagents` 注入“当前已关联 subagent”；v3 删除 leader/subagent 概念后，应改成通用的 owned / linked agents snapshot。
  - `create_agent` 可以创建任意 agent。由某个 agent 调用创建时，自动 link 到该父 agent；用户/API 显式给某个 agent 创建子 agent 时，也按该父 agent owned link 处理。普通用户/API 直接创建 agent 则只创建独立 session，第一版不做前端自动 link。
  - `get_agent(id?: number)` 作为第一版查询工具：无参时返回当前父 agent 拥有且未 detach 的 agents 列表；有参时返回指定 agent 的轻量详情。它面向模型识别和继续协作，不返回运维噪声。
  - `get_agent` 不返回完整 `input` 配置，也不引入 `inputSummary`。识别 agent 用途统一依赖 session metadata 的 `title` / `summary`。
  - `get_agent` 第一版字段收敛为：`sessionId`、`profileKey`、`title`、`summary`、`status`、`lastResult`、`lastError`。`lastResult` 优先来自最后一次成功 `report_result`，没有时可退回最后 assistant 摘要；usage、run timing、messageCount、toolCallCount 等运行统计不默认暴露给模型工具，后续进入 session/API 调试面。
  - `get_agent` 的 `id` 直接使用数字递增 `sessionId`，不再引入父 agent 本地短 ID 或额外映射表。
  - `get_agent(id)` 的 `id` 只接受全局 `sessionId`，不支持别名、局部 id 或 profile key 查询。
  - `get_agent(id)` 第一版允许按全局 `sessionId` 查询 agent，不限制必须是当前父 agent owned。后续如果需要权限隔离，再在 session API/tool policy 层收紧。
  - `get_agent` 只做状态查询，不承接恢复逻辑；恢复/继续统一回到 `invoke_agent` 的 `prompt` / `continue` 两种模式。
  - `detach_agent` 解除当前父 agent 对某个 owned agent 的拥有/可见关系。它不删除目标 agent session，不修改目标 agent history，不停止正在运行的目标 agent，只让父 agent 的 prepare snapshot 和 `get_agent()` 无参列表不再显示它。
  - link / detach 事实可以作为 session entry 保留以便回放和排障，但 detached agent 不再进入当前父 session 的 prepare snapshot。
- `sessionId` 与 `invocationId`：
  - `sessionId` 是长期 agent session 标识，绑定一个 `AgentInstance` 和 append-only entry tree。第一版使用全局唯一数字递增 ID；一个 session 可以被多次 `invoke_agent` / prompt / continue。
  - `invocationId` 是单次调用/run 标识，只表示“这一次 invoke_agent 请求”。它用于非阻塞调用、事件订阅、日志追踪和精确查询某一次 run；不是 agent 长期身份。
  - 当前 `invocationId` 使用 UUID 字符串；`sessionId` 继续使用全局数字递增 ID。
- `invoke_agent` 阻塞返回契约：
  - Pi core 的 `prompt()` / `continue()` await 到 `agent_end`，事件里 `turn_end` 带本 turn 的 assistant message 和 toolResults，`agent_end` 带本次 run 新产生的 messages。Pi coding-agent 的多 agent extension 返回 model-visible content，同时把完整子进程结果放在 tool details：每个结果包含 messages、usage、model、stopReason、errorMessage 等。
  - 旧 v2 子线程调用曾同步等待子线程完成，再从子线程历史中优先解析最后一次 `report_result`，否则退回最后一条 assistant 文本；中间 live 消息不嵌回父线程。
  - v3 采用两者折中：`invoke_agent` 返回目标 session 的本次运行摘要、最终 assistant 摘要、usage 汇总和 `report_result` 结果；完整 history 只通过 session API 查询，不塞入工具返回。
  - 当前 service 返回：

    ```ts
    type InvokeAgentResult = {
        sessionId: number;
        invocationId: string;
        status: "completed" | "waiting" | "error";
        finalMessage?: string;
        reportResult?: {
            result: string;
            success?: boolean;
            data?: unknown;
        };
        error?: string;
        usage?: Usage;
        events: AgentEvent[];
    };
    ```

  - 阻塞返回值必须包含 `sessionId` 与 `invocationId`。`sessionId` 是目标 agent 长期身份；`invocationId` 是本次 run 的追踪号，用于后续事件订阅、调试和非阻塞调用。第一版 `invocationId` 只在 API/tool 返回值中出现，不额外暴露给模型提示词。
  - `block: false` 第一版不实现，只保留 TODO。当前 `invoke_agent` 默认并实际只支持阻塞调用。

- `report_result` 是 OutputSchema 的提交点：`OutputSchema = Type.Object({})` 时只要求 `walkthrough`；非空 OutputSchema 时要求 `walkthrough + data`，其中 `data` 的模型可见类型由目标 profile 的 `OutputSchema` 派生。如果目标 agent 的 `data` 校验失败，`report_result` 工具返回 tool error，让目标 agent 在自己的 session 内观察错误并更正；这不是立刻返回给父 agent 的失败。
  - 目标 agent 只有遇到不可挽回错误才向调用方返回错误，例如 provider/API 错误、工具系统错误、被显式停止且没有可用结果，或运行结束但目标 profile/policy 要求 `report_result` 而始终没有成功提交。
  - v3 可以参考 v2 `collectSubAgentCompletion` / `resolveSubAgentCompletionResult` 的完成判定：等待目标 session run 结束后，从历史里优先解析最后一次成功的 `report_result`；没有时再按 profile/policy 决定是否退回最后 assistant 文本，或报“未产出可用最终结果”。
  - 如果目标 agent 没有调用 `report_result`，但产出了最终 assistant 文本，`invoke_agent` 是否可返回 `finalMessage` 由目标 profile/policy 决定；通用 agent 可以允许，结构化输出 agent 应要求 `report_result`。

## Agent Tool Inventory

### 当前系统已注册工具

当前 `server/agent` 工具 registry 已存在这些工具：

- `read`：读取文本文件或图片；文本支持 `offset` / `limit`，大文件返回 continuation/truncation 提示。
- `write`：创建或完整覆写文件。
- `edit`：对单文件做精确文本替换。
- `apply_patch`：应用 Codex 风格 freeform patch。模型直接传 `*** Begin Patch` / `*** End Patch` 包裹的 patch 文本，不再传 JSON、`{ path, patch }` 或 `fuzzFactor`。
- `bash`：在绑定 workspace root 下执行 bash 命令，合并 stdout/stderr，并记录长输出截断详情。
- `report_result`：agent 提交最终结果；只应暴露给需要 report 完成协议的目标 agent。当前代码仍是旧 `result/data` 参数，后续目标语义是：`OutputSchema = Type.Object({})` 时只提交 `walkthrough`，非空 OutputSchema 时还提交按 schema 校验的 `data`。
- `request_user_input`：发起需要用户回答的 approval tool call，恢复时走 `continue + resolution`。
- `enter_plan_mode` / `exit_plan_mode`：请求进入或退出软 Plan Mode。
- 独立 `skill` 工具已禁用。模型需要使用 skill 时，通过 `SkillCatalog` 中的 `location` 用 `read` 打开对应 `SKILL.md`。
- `create_agent`：创建新的 agent session，并在父 session 调用时写入 owned link；`input` 模型可见 schema 要求 JSON object，`null`/`undefined` 归一为 `{}`，array、普通字符串、number、boolean 和 `key=value` 文本会报错。执行层保留 JSON string object 的 legacy fallback，用于恢复旧会话或偶发坏调用。
- `invoke_agent`：调用已有 agent session，支持 prompt / continue。
- `get_agent`：无参列出当前 session 拥有的 agents；传 `sessionId` 时查询指定 owned agent 摘要。
- `get_agent_profile`：按 `profileKey` 查询 profile catalog 详情，返回 description、allowed tools、InputSchema、OutputSchema 和 report_result schema 摘要；用于创建或调用不熟悉 agent 前确认 input 形态。
- `get_session`：查询轻量 session metadata、active leaf、title/summary、usage 和 linked agents；默认不返回 tree，也不返回历史消息。显式传 `includeRecentMessages` 时只查询当前 active path 最近消息，并受 `recentMessageLimit` / `tokenBudget` 限制。
- `detach_agent`：解除当前父 agent 对某个 owned agent 的拥有/可见关系，不删除目标 session。

Profile 仍通过 `allowedToolKeys` 决定最终暴露给模型的工具集合。当前 `leader.default` 默认暴露 `read`、`write`、`edit`、`apply_patch`、`bash`、`create_agent`、`invoke_agent`、`get_agent`、`get_agent_profile`、`get_session`、`detach_agent`、`request_user_input`、`enter_plan_mode`、`exit_plan_mode`，并已恢复 task / Plot / SQL 业务工具；`leader.assets` 暴露资产编辑所需基础工具和 agent 查询工具。独立 `skill` 工具已禁用；Skill 通过 `read` 读取 catalog location。顶层 leader 不默认暴露 `report_result`。后续 Workbench 第一版只把 `allowedToolKeys` 作为简单 checklist 辅助编辑，不做复杂危险等级分组；`bash` 默认不选并显示高风险提示。

旧 v2 工具名不在当前 registry 中：`read_file` / `write_file` / `edit_file` / `execute_shell` 已迁移为 Pi 风格命名。业务工具已按新合同恢复一批：`execute_sql`、`task_create` / `task_set_status`、剧情/Plot 查询与编辑工具。小说元数据工具如后续需要恢复，应继续按新工具合同重新设计，而不是恢复旧 v2 命名。

### v3 agent 相关工具命名结论

- `create_agent`：创建任意 agent 实例和空 session；`input` 必须是 object。执行层保留 JSON string object legacy fallback，但不要在新调用中使用。
- `invoke_agent`：按 `sessionId` 调用 agent，支持 `prompt` / `continue`；第一版同步等待目标 session 完成。
- `get_agent(id?: number)`：无参列出当前拥有的 agents；有参查询指定 owned agent 详情。
- `get_agent_profile(profileKey)`：查询 profile schema 摘要和 allowed tools。
- `get_session({ sessionId?, includeRecentMessages?, recentMessageLimit?, tokenBudget? })`：查询当前或指定 owned session 的轻量状态；默认无 tree / 无历史。
- `detach_agent`：解除当前父 agent 对某个 owned agent 的拥有/可见关系，不删除目标 session。
- 第一版不再单独设计 `query_agent` / `get_agent_status` / `list_agents` / `list_linked_agents`，统一收敛到 `get_agent` / `get_session`。

### v3 计划中的基础文件/命令工具

- Tool result 与 Pi 保持一致：工具执行返回 `{ content, details?, terminate? }`；`content` 是模型可见的 text/image block，`details` 是 UI/session metadata。工具失败直接 throw，由 harness 转成 `ToolResultMessage { isError: true }`。发送给模型时，provider adapter 只使用 `ToolResultMessage.content` 和 `isError` 组装 provider-native tool result；`details` 不进入模型上下文，只供事件、session、UI 和 harness 特殊逻辑使用。
- 基础工具的模型可见 content string 形态按 Pi coding-agent 对齐，不重新设计文案：`read` 返回原文片段并追加 Pi 风格 continuation/truncation 提示；`write` 返回 `Successfully wrote N bytes to path`；`edit` 返回 `Successfully replaced N block(s) in path.`；`bash` 返回 stdout/stderr 合并文本、`(no output)`、或在错误时追加 `Command exited with code N` / `Command timed out after N seconds`；长输出追加 `Full output: <temp path>` 提示。
- `bash` 输出策略按 Pi：stdout 和 stderr 合并为一个模型可见文本流；内存中只保留滚动尾部。超过最大行数或最大字节数时，把完整原始输出写入临时 `.log` 文件，模型只看到尾部和 `Full output: <temp path>`。第一版临时文件使用系统 temp 目录与随机文件名，例如 `neuro-bash-<id>.log`，不写入 `.nbook` session 目录；session entry 只记录模型可见尾部与 `details.fullOutputPath`。
- `read({ path, offset?, limit? })`：读取文件内容；`offset` 是 1-based 起始行，`limit` 是最大行数。返回 text content；第一版支持读取图片并返回 text note + image content，若模型/provider 不支持 vision，则只返回文本提示，不把图片塞进模型上下文。大文件按行数/字节截断，模型可见文本里给出 continuation 提示，例如 `Use offset=N to continue`；`details.truncation` 记录截断信息。
- `write({ path, content })`：创建或完整覆写文件，自动创建父目录；适合新文件或完整重写，不作为小范围 patch 工具。成功时返回短文本，例如 `Successfully wrote N bytes to path`；`details` 为空。
- `edit({ path, edits })`：对单文件做精确文本替换；`edits[].oldText` 必须在原文件中唯一且互不重叠，`edits[].newText` 是替换文本。所有 `oldText` 都基于原文件匹配，不按 edits 顺序增量匹配；临近或同块修改应合并为一个 edit entry。成功时返回短文本，例如 `Successfully replaced N block(s) in path`；`details.diff` 保存 unified diff，`details.firstChangedLine` 用于 UI 定位。
- `apply_patch(rawPatchText)`：应用 Codex 风格 freeform patch；和 `edit` 一样是文件编辑工具，只是参数和编辑机制不同。patch 文本必须以 `*** Begin Patch` 开始、以 `*** End Patch` 结束，可在一个 patch 内 add / update / delete / move 多个文件，也支持多 hunk；路径仍受 `workspaceRoot` 限制。成功时返回短文本，例如 `Patch applied`；`details.diff` 保存实际 diff，`details.files` 记录受影响文件。旧 `{ path, patch }` / `fuzzFactor` 形态不再是公开协议。
- `bash({ command, timeout? })`：执行 bash 命令；对应 v2 `execute_shell`，命令参数仍是单个字符串。工具创建时绑定 agent session 的 workspace 根目录，不暴露 `workdir` 参数；输出截断、超时、abort 和 bash 自动查找由工具内部处理。Windows 也必须运行 bash，不再给模型提供 PowerShell 分支提示；bash 命令中的 workspace 相对路径优先使用 `/`，如果必须使用 Windows 反斜杠路径则需要加引号。成功时返回 stdout/stderr 合并后的文本；无输出时返回 `(no output)`；非零 exit、timeout、abort 都 throw，harness 将输出文本和状态一起转成错误 tool result。`details.truncation` / `details.fullOutputPath` 记录长输出信息。
- `rg` / `find` / `ls` / `workspace node ...` 等 CLI：不作为单独模型工具注册，继续通过 `bash` 调用，并由 leader prompt 提示优先使用 `rg --files`、精确过滤和 workspace CLI，避免宽泛递归扫描。bash runtime 注入 `RIPGREP_CONFIG_PATH` 后，路径过滤使用 `(^|/)...` 这类基于 `/` 的正则。
- 路径策略与 Pi 保持接近：工具内部用绑定 cwd 解析相对路径，也允许绝对路径。第一版不做“路径必须位于 workspaceRoot 内”的硬限制；workspaceRoot 是默认根目录和 UI/提示词语义边界，不是 sandbox。
- 迁移重点是 profile output contract：
  - 从 LangChain `BaseMessage[]` 改为 Pi-compatible prepared turn。
  - `SystemMessage` 不允许出现在 Pi `messages[]`。
  - 首要系统提示词由当前 active profile 的 `ProfileTurnPlan.systemPrompt` 进入 provider `Context.systemPrompt`。
  - 中间位置已有 `SystemMessage` 的 profile 直接迁移为非法输出，profile 作者需要改写为 dynamic context 或普通 message。
- Profile prepare 仍然是“History + 动态内容”：
  - `ProfileTurnPlan.systemPrompt` 来自当前 profile，生成本轮唯一 provider 级 `systemPrompt`。它可以随 profile 源码变化在下一次运行生效，但不写为普通历史消息。
  - History 来自 session active path，包含真实对话历史、profile `HistorySet` 首次稳定前缀，以及已持久化的 `AppendingSet` 运行期消息。
  - `ModelContext` 来自当前 profile、runtime scope、workspace 状态等，是本轮临时上下文；它进入 provider context，但不写 session。
  - AppendingSet 是贴近当前输入的最新上下文区域；它进入 provider context，并且其中的非空 messages 默认全部写入 session。
- v3 正式引入 `profile.ingest()`，但第一版保持窄权限。它只负责 profile-generated messages 和 session metadata 的写入建议，不接管 harness 权限。

```ts
type ProfileIngestResult = {
    messageWrites?: Message[];
    sessionUpdates?: {
        title?: string;
        summary?: string;
    };
};
```

- `ingest()` 第一版不允许写任意 `custom` entry，不允许修改 `profileKey`、model、thinking level，不允许 link/detach agent，也不触发 queue、compact 或 tool policy。`Reminder` / `Watch` 的 state 更新仍由 harness 的 `AppendingSet` renderer 处理。
- `HistorySet` 的新边界：
  - 它不再承担 system prompt 角色；需要 provider 级系统提示的内容必须进入 `ProfileTurnPlan.systemPrompt` / `System`。
  - 它仍然适合放 SkillCatalog、长期规则、工作区初始背景等需要首轮持久化的上下文。
  - 新 session 首轮把 `HistorySet` 渲染结果写成普通 session message entries。旧 session 下次运行时不会因为 profile 源码变化自动重写这段历史，也不会写 profile 来源审计 entry。
  - compact 后 context reducer 用 compaction summary + recent messages 取代被压缩的旧历史；profile 不应该再把原始 `HistorySet` 当作“补丁”重新塞回上下文。
- `AppendingSet` 保留名称，语义继续对齐现有 TSX Profile 文档：运行时提醒、watch/reminder 触发文本、显式激活 skill 摘要等需要靠近本轮请求的上下文放在这里。当前用户输入由 Harness 作为独立 `CurrentUserInput` 持久化，不属于 AppendingSet，profile 不应复制 `ctx.invocation.message`。v3 可以重新设计 AppendingSet 写入 session 的 entry 形态，但不能把它变成“不写上下文”。
- `Reminder` 可以放在 `AppendingSet` 或 `ModelContext` 中；`Watch` 可以放在 `AppendingSet` 或 `ModelContext` 中。它们不是普通 string 片段，而是带 profile state 更新、注入频率、变量 fingerprint 和历史写入语义的动态节点；不允许放入 `HistorySet`。`ModelContext` 内的 `Reminder` 归属仍是 ModelContext，但输出按 appending 语义展示并写 session。`SkillCatalog`、`ActivatedSkills` 等返回 string 的通用节点仍由 profile 作者决定包进哪个 `Message` / set 中。
- Pi 没有等价的 `AppendingSet` DSL，但有相同层次的机制：`transformContext` 可在 provider 调用前转换本轮上下文，`prepareNextTurn` 可在 save point 后刷新下一轮 context/model/state，`nextTurn` 会把消息插入下一轮用户消息之前。Neuro Book 的 `AppendingSet` 应映射到这类 turn-preparation/context-tail 语义，同时保留“必要运行期消息可持久化”的产品语义。
- Profile preview 当前展示 `systemPrompt`、`historyInitMessages`、`modelContextAppendingMessages`、`appendingMessages`、`modelContextMessages` 和 `stateWrites`，而不是 LangChain message list。
- Profile 的 InputSchema/OutputSchema 迁移策略：
  - builtin profile 的静态类型保持稳定。
  - 用户覆盖 builtin key 不允许改 builtin Input/Output 类型。
  - 用户自定义 profile 要获得 key -> input/output 静态推导，仍需要 prepare 类型索引。
  - v3 typegen 可以扫描系统/user assets profiles；但 builtin key 的静态 Input/Output 类型必须来自源码 builtin contract，不能被 assets 覆盖。assets 覆盖 builtin key 时，只覆盖运行时实现和提示词。
  - v3 agent 模块统一使用 TypeBox / JSON Schema，profile `InputSchema` / `OutputSchema` 也属于 agent 模块，新的 v3 profile 必须使用 TypeBox。
  - 前端和非 agent 业务模块仍可继续使用 Zod；跨边界时通过 JSON Schema / DTO 转换，不要求全仓统一到 TypeBox。
  - 现有 v2 Zod profile 不作为 v3 兼容来源；v3 迁移时直接改写为 TypeBox，不保留 Zod -> JSON Schema runtime fallback。

## Turn Queue / Interrupt Plan

- NeuroAgentHarness 采用 Pi 的 turn-safe queue 语义，但用 Neuro Book 的 session/profile/context 组织实现。
- Pi 层级归属：
  - `steer` / `followUp` 是 Pi core `Agent` 已提供的队列 API，并在 `AgentLoop` safe point 通过 `getSteeringMessages` / `getFollowUpMessages` 注入。
  - `nextTurn` 不是低层 `Agent` 的基础 API；它存在于 Pi `AgentHarness` / `coding-agent` 这类产品层。Neuro Book 第一版不实现 `nextTurn`。
  - NeuroAgentHarness 第一版只暴露 `steer/followUp` 运行期队列；后续如果需要“下一次用户 prompt 前插入”的语义，再作为独立产品层能力评估。
- `steer`：用户或系统在 agent 工作中追加的“纠偏/补充”消息。它不打断当前 assistant message 和当前 tool batch；等当前 assistant turn 及其 tool result 完成后，在下一次 LLM 调用前注入上下文。
- `followUp`：等待 agent 本来要停止时再送入的后续消息。只有当当前 ReAct loop 没有更多 tool calls、也没有 pending steering messages 时才注入；Neuro Book 第一版按 FIFO 一次只消费一条 followUp，然后以 fresh loop 继续。
- 同一个 `sessionId` 第一版不允许同时运行多个 active invocation。所谓“多个正在运行的 invocation”是指用户在一个 session 还在 streaming/tool 执行/等待本轮结束时，又从另一个浏览器窗口或同一窗口提交了新的 prompt/continue。v3 不启动并行 run，也不让两个 provider loop 同时写同一个 session tree；新的用户 prompt 会进入当前 active invocation 的 `followUp` queue，等当前 ReAct loop 没有更多 tool calls 且没有 pending steer 时按 FIFO 继续执行。
- active invocation lock 指每个 session 同一时刻最多只有一个正在修改 session / 调 provider / 跑工具 / compact 的 active invocation。它不是数据库锁，也不是跨进程锁；第一版是 harness 内的 session 级运行态互斥。它防止两个 provider loop 同时追加同一棵 session tree，也防止 `/tree`、`/model`、`/compact` 等控制命令在运行中移动 leaf 或改 state。
- 运行中收到 steer / followUp 后，应通过 session event hub 广播 `steer_queued` / `follow_up_queued` 事件，让所有订阅该 session 的窗口都能看到“消息已引导/已排队”。queued message 本身不立刻改写 active leaf；只有真正 drain 并进入 provider context 时，才作为标准 user message 写入 session。
- `continue + resolution` 是审批恢复控制流，不走 followUp queue。如果 session 正在等待 approval resolution，这时提交 resolution 会补齐对应 toolResult 并继续当前 invocation；如果同一时刻又提交普通 prompt，则普通 prompt 进入 followUp queue。
- `steer` / `followUp` 的固定提示词不交给 profile 决定。它们属于 harness 交互协议，由 NeuroAgentHarness 写死或通过 harness-level policy 配置；profile 只负责常规 systemPrompt、history、dynamic/appending 上下文。
- `steer` / `followUp` / `abort` / clear queue 第一版全部由 harness 写死，不开放给 profile 直接触发或改写。
- `abort` / interrupt：取消当前低层 run，向 provider/tools 传递 abort signal，清空 steering/followUp 队列。已完成的 session writes 不回滚，pending writes 按 save point / failure cleanup 规则落盘或标记中断。
- queue drain mode 第一版固定为分队列策略：
  - `steer` 使用 `"all"`：同一个可引导点一次性 drain 当前所有 pending steer，并作为多条 user messages 注入当前 ReAct loop 的下一次模型调用。
  - `followUp` 使用 `"one-at-a-time"`：当前 ReAct loop 真正结束后一次只取最早一条 followUp，并以 fresh loop 继续。
- save point 定义为一次 assistant turn 和对应 tool results 完成之后。save point 负责：
  - 按事件顺序持久化 agent-emitted messages。
  - flush pending session writes。
  - 重新从 session/profile/workspace resources 构造下一轮 context snapshot。
  - 应用 run 期间发生的 model/profile/tool/resource 设置变化到下一轮，而不修改正在进行中的 provider request。
- 可引导点是 save point 的一个子场景：如果 save point 后存在 pending steer，则当前 ReAct loop 不结束，harness 会一次性 drain 所有 pending steer，并在下一次 provider request 前注入；只有没有 pending steer 且没有更多 tool calls 时，loop 才算真正结束并进入 followUp drain。
- AppendingSet 和 queue 机制的关系：
  - AppendingSet 是 profile prepare 阶段根据当前 input/scope/history 生成的 turn-tail context。
  - steer/followUp 是运行期间或用户交互产生的 queued user messages。
  - 两者最终都会参与 provider context，但来源和持久化时机不同；实现上不要把 queued user messages 塞进 profile TSX 节点里。
- `request_user_input` / Plan Mode 审批第一版不走 queue 恢复，而是走 `continue + resolution`：用户操作先补齐对应 tool call 的 `toolResult`，然后由 Pi `continue()` 从 tool result 继续。queue 只负责运行中的 steer/followUp 消息，不负责审批恢复。

## Continue / Compaction Plan

- Pi 调用链：
  - core `Agent.prompt(...)` 会把文本或消息归一成 `AgentMessage[]`，然后调用 `runAgentLoop(prompts, context, config, ...)`。
  - `runAgentLoop` 会把 prompts 追加到 `context.messages`，并为这些 prompt messages 发出 `message_start/message_end`。
  - core `Agent.continue()` 调用 `runAgentLoopContinue(context, config, ...)`，不新增 prompt message。
  - Pi `Agent.continue()` 如果当前最后一条是 assistant，会先尝试 drain queued steering/follow-up；没有 queued message 时才报 `Cannot continue from message role: assistant`。
  - Pi `AgentLoop` 在每轮 assistant/tool 结束后调用 `prepareNextTurn`，让上层刷新 context/model/reasoning；随后通过 `getSteeringMessages` / `getFollowUpMessages` drain 队列。
- Pi 的 `agentLoopContinue(context, config)` 语义是：从已有 context 继续跑，不新增 prompt message，不发新的 user `message_start/end`。它要求 context 最后一条能转换成 LLM 的 `user` 或 `toolResult`，不能从 assistant message 继续。
- Neuro Book 后端 API / service 层也按 Pi 语义拆成两个调用入口：
  - `prompt(sessionId, input)`：写入新的 user message entry，再运行 prompt loop。
  - `continue(sessionId)`：不新增 user message，基于当前 active leaf 继续运行。
- NeuroAgentHarness 的 continue 应沿用这个语义：当用户输入已经先写入 session，或 tool result 已经落入 session，需要继续触发模型时，使用 continue run。Profile prepare/context 负责生成 `ProfileTurnPlan`，harness 再把 session history、`ModelContext`、`AppendingSet` 和当前尾部用户输入整理成合法 provider context。
- 当 session 尾部是需要审批/用户输入的 assistant tool call 时，不能直接调用 Pi `continue()`；必须先通过 `continue(sessionId, { resolution })` 让 harness append 对应 `toolResult`。这样重启后也能从 session 尾部自然恢复，而不需要额外 custom pending entry。
- `CurrentUserInput` 是 v2 为适配“前端先写用户消息，再 continue run”而引入的 prepare 内部技巧，不作为 v3 概念保留。
- v3 第一版实现 session command，命令本身对 LLM 透明，不作为普通 user message 写入模型上下文：
  - `/new`：基于当前 session 的 `profileKey + input + workspaceRoot` 新建空 session，不清空旧 session，返回新 `sessionId`。新 session 初始没有 user message，LLM 对该命令无感。
  - `/retry [entryId?]`：在同一个 session tree 内重新生成。若未传 entryId，默认从当前 leaf 找到可继续点；如果当前 leaf 是 assistant message，则把 leaf 移回其 parent，再重新 continue，生成 sibling assistant branch；如果当前 leaf 是 user/toolResult，则直接从当前 leaf continue。旧回复保留，用户后续可用 `/tree` 切换。
  - `/tree [entryId?]`：查看或切换当前 session tree。无参数时返回 tree 摘要；带 entryId 时把当前 leaf 移到目标 entry。它承接“回溯”“回退到某条消息”“切换旧回复/新回复”等操作，不再单独设计 `/back`、`/rollback`。
  - `/fork [entryId?]`：从当前 session 的当前 leaf 或指定 entry 创建一个新 session，保留 parent session 关系。它适合从历史点另开一条线，不影响当前会话。
  - `/compact [instructions]`：手动压缩当前 session，instructions 作为本次 compact 的附加要求进入压缩请求，并写入 `compaction.details.instructions`。
  - `/plan on|off|toggle [reason]`：手动切换当前 session 的软 Plan Mode。命令写 append-only session state entry，并通过 event hub 广播；命令本身不作为 user message 进入模型上下文。
  - `/model <modelKey|default>`：切换当前 session 的 per-session model override，写 append-only model state entry，并通过 event hub 广播。`default` 表示清空 override，回到 profile/default model resolver。
- `/tree` 参考 Pi 的 tree navigation：在当前 session 内移动 leaf，并在跨分支离开当前路径时可生成 `branch_summary` 保存被离开分支的上下文。`/fork` 参考 Pi coding-agent 的 `/fork`：创建新 session，而不是只在当前 tree 内移动 leaf。
- 前端按钮触发的 Plan Mode、manual compact、tree/retry/fork、model override 等控制动作都走同一个 session command dispatcher，而不是各自设计散落 endpoint。当前 `POST /api/agent/sessions/:sessionId/commands` 接收 discriminated union body，例如 `{ command: "compact", instructions }`、`{ command: "plan", active }` 或 `{ command: "model", modelKey }`。
- 2026-06-28 性能治理后，command response 也改为判别联合：`plan/model/thinking/archive` 返回 `kind:"live_state"`，`compact` 返回 `kind:"live_state", status:"started"`，`retry/tree` 返回 `kind:"snapshot"`，`new/fork` 返回 `kind:"created_session"`。轻控制命令不再生成完整 snapshot，前端收到 live state 只更新 session shell，不补拉 `/sessions/:sessionId`。
- command routing 由前端负责。`POST /api/agent/sessions/:sessionId/invocations` 允许用户发送以 `/` 开头的普通文本，后端不在 invoke 入口自动解析 command；只有 `/commands` 入口会执行 control-plane command。这避免用户想让模型“解释 `/compact` 这个字符串”时被后端吞掉。
- session command 是 control-plane 操作，不走 followUp queue。已有 active invocation 时，`/tree`、`/fork`、`/retry`、`/compact`、`/plan`、`/model` 等 command 都返回 `active_invocation_exists`，要求用户先 abort 或等待 idle，避免同一 session tree 被运行中的 provider loop 和控制命令同时修改。
- `/commands` HTTP 入口本身不长时间等待。它负责解析并发起 command：短命令同步写 entry 并返回完成结果；`/compact` 这类需要 provider 的命令只启动 compact active invocation 并立即返回 `started`。compact 过程通过同一个 session SSE/event hub 同步，完成后写 `compaction` entry 并广播 state/event。
- v3 参考 Pi 重新设计用户输入流：
  - prompt run：用户输入作为新 `message` entry 写入 session，并作为 prompts 传给低层 loop；profile prepare 不再负责伪造这一条输入。
  - continue run：session/context 已经以 `user` 或 `toolResult` 结尾，不新增 prompt message，直接调用 continue loop。
  - profile 负责围绕当前 session history 生成 `HistorySet` / `ModelContext` / `AppendingSet` 上下文，但不负责“把当前用户输入从 history 尾部取出再塞回最后”这类 v2 补丁。
- AppendingSet 仍然是靠近当前输入的上下文区域。prompt run 时它应排在新用户输入之前；continue run 时它应排在既有尾部 user/toolResult 之前或由 harness 的 context assembler 保证最终 provider context 合法。
- `ModelContext` 不需要特殊节点才能“动态”：profile 在 prepare/context 阶段运行 TSX/函数表达式，本来就可以读取 input/scope/history 并输出动态内容。`ModelContext` 的价值是给这些动态内容一个明确位置和“不写 session”的可读契约。旧 `DynamicSet` 名称已删除。
- Pi compaction 采用 append-only session entry，不删除原 JSONL 历史。NeuroAgentHarness 第一版实现自动与手动压缩：自动压缩在 provider 调用前按 token 阈值触发，手动压缩通过 slash command `/compact [instructions]` 触发。核心规则：
  - 自动触发：`contextTokens > contextWindow - reserveTokens`，也可手动 `/compact [instructions]`。
  - 从最新消息往前保留约 `keepRecentTokens`，找到 cut point。
  - 生成 summary。
  - 追加 `compaction` entry，包含 `summary`、`firstKeptEntryId`、`tokensBefore`、`details`。
  - `buildSessionContext()` 后续输出 summary message + `firstKeptEntryId` 之后的消息；完整旧历史仍留在 JSONL 中，可通过 tree 回看。
  - cut point 尽量落在 turn 边界，避免把 tool result 和 tool call 拆开；超长单 turn 会走 split-turn summary。
- NeuroAgentHarness 应借鉴 Pi compaction：使用 append-only `compaction` entry，保留完整 session tree，通过 context reducer 决定 provider 看到 summary + recent messages。compact 只影响后续 provider context，不删除旧 entries。
- Pi 的“保留最近几条消息”不是按固定条数做，而是通过 `keepRecentTokens` 按 token 预算从最新消息向前保留 recent context；同时会找合法 cut point，避免截断 tool result。NeuroAgentHarness 当前已开放 profile compaction policy，但底层仍必须尊重 tool-call/result 完整性。
- compaction summary 的默认提示词由 harness 固定提供；profile 可以通过顶层 `compaction.prompt` 覆盖。默认压缩提示词为：

```text
You are performing a CONTEXT CHECKPOINT COMPACTION. Create a handoff summary for another LLM that will resume the task.

Include:
- Current progress and key decisions made
- Important context, constraints, or user preferences
- What remains to be done (clear next steps)
- Any critical data, examples, or references needed to continue

Be concise, structured, and focused on helping the next LLM seamlessly continue the work.
```

- compact 后注入后续 context 的摘要前缀默认固定；profile 可以通过顶层 `compaction.summaryPrefix` 覆盖。默认摘要前缀为：

```text
Another language model started to solve this problem and produced a summary of its thinking process. You also have access to the state of the tools that were used by that language model. Use this to build on the work that has already been done and avoid duplicating work. Here is the summary produced by the other language model, use the information in this summary to assist with your own analysis:
```

- harness 负责 cut point、token budget、entry 写入和 tool-call/result 完整性。profile 通过 `defineAgentProfile({ compaction })` 顶层静态配置显式提供 compaction policy：`enabled`、`triggerPercent` 或 `triggerTokens`、`reserveTokens`、`keepRecentTokens` 或 `keepRecentPercent`、`prompt`、`summaryPrefix`。自动 compact 和手动 `/compact` 共用同一套 profile policy；没有 `compaction` 配置时不压缩，手动 `/compact` 报错，自动路径只在上下文超过模型窗口时返回明确错误。默认 prompt、默认 prefix、`reserveTokens=8000`、`keepRecentTokens=24000` 只作为显式 `compaction` 省略字段时的默认值。自动 compact 成功后，下一轮前会重新注入一次 `HistorySet` 初始化消息。

## Frontend Session API Contract

- Agent HTTP 主入口已经是 `/api/agent/**`。临时 `/api/agent-v3/**` 和旧 `/api/agent/threads/**` 已删除，不做兼容重定向。
- 新 UI、composable、DTO 都使用 `sessionId/session` 命名，不沿用旧 `threadId/thread`。
- 前后端 DTO 放入 `shared/dto/agent-session.dto.ts`。本次迁移不考虑 legacy 兼容：旧 `shared/dto/agent-chat.dto.ts`、旧 `useAgentApi`、旧 thread/subagent API 引用已经删除或替换为新 session API/store，不保留 legacy wrapper 或 thread -> session adapter。
- 用户直接创建的顶层 session 与 agent 创建/拥有的 linked session 第一版用 `SessionMetadata.parentSessionId` 区分：没有 `parentSessionId` 的 session 是 workspace 顶层 session；有 `parentSessionId` 的 session 是某个 owner session 的 linked agent。用户在某个 session 面板里手动创建 linked agent，也按 linked session 处理。若后续 UI 需要区分“用户手动创建 linked agent”和“模型通过 create_agent 工具创建 linked agent”，再补 `custom` entry 或 metadata `createdBy`，但第一版列表分组不依赖这个细分。
- session 列表分两个视角：主对话列表只展示当前 workspace 下的顶层 sessions；当前 session 的 linked agents 由 linked agent 面板展示，数据来自 owner session 的 linked agent reduce 结果。
- session summary 不返回完整 messages。当前返回 `sessionId`、`profileKey`、`workspaceKey`、`workspaceRoot`、`parentSessionId`、`title`、`summary`、`status`、`updatedAt`、`archived`、`lastMessagePreview`、`usage` 等轻量字段。
- session 创建与列表 API 固定为：
  - `GET /api/agent/sessions?workspaceKey=...&includeArchived=false`：列当前 workspace 下的顶层 sessions，不返回 linked agents 的完整列表。
  - `POST /api/agent/sessions`：创建 session，body 包含 `profileKey`、可选 `input`、`workspaceRoot`、`workspaceKey`、`parentSessionId`。有 `parentSessionId` 时创建 linked session；无 `parentSessionId` 时创建顶层 session。
  - `GET /api/agent/sessions/:sessionId`：返回 snapshot。
  - `/new` command 只是 UI / command dispatcher 的快捷入口，底层复用同一个 create session service。
- 首次打开 Agent 抽屉时的 session 选择策略：前端按当前 workspace 调 `GET /api/agent/sessions`，优先打开本浏览器记住的 `lastSessionId`；如果该 session 不存在或已归档，则打开最近更新的顶层 session；如果列表为空，才自动创建一个当前 workspace 默认 profile session。这样避免每次打开抽屉都新建 session，同时支持同一 workspace 多窗口工作。
- session 删除第一版采用归档/隐藏，不做物理删除。用户点击删除时写 append-only `session_archived` entry，session 列表默认不显示 archived session；调试、恢复和后续管理功能仍可找到 JSONL 历史。物理删除后续再作为单独管理能力设计。
- 创建运行的正式入口是 `POST /api/agent/sessions/:sessionId/invocations`。它不表示一定创建一个并发 provider run；如果该 session 当前 idle，则创建新的 active invocation；如果该 session 已有 active invocation，则按请求类型排队或恢复当前 invocation。
- `POST /api/agent/sessions/:sessionId/invocations` 当前请求参数为：

```ts
type AgentInvocationRequest = {
    mode: "prompt" | "continue" | "steer" | "followup";
    message?: AgentUserMessageInput;
    resolution?: AgentResolution;
    block?: boolean;
};

type AgentUserMessageInput = {
    text: string;
    images?: Array<{
        type: "image";
        mimeType: string;
        data: string;
    }>;
};
```

- 参数规则：
  - `mode: "prompt"` / `"steer"` / `"followup"` 必须带 `message`。
  - `mode: "continue"` 不允许带 `message`，但可以带 `resolution`。
  - `resolution` 使用现有 `AgentResolution` 结构，只用于恢复尾部未完成 approval tool call，例如 `request_user_input`、`enter_plan_mode`、`exit_plan_mode`。它不是模型最终回答，而是前端/用户对等待中 tool call 的恢复动作，后端会转换成标准 tool result message 后继续运行。
  - `block: false` 字段已预留，但当前 harness 会返回错误；前端第一版不要传 `block: false`。
  - 当前没有 `queue.whenRunning` / `response.block` 包装字段。运行中收到普通 prompt 时仍可兼容进入 followUp queue；新前端应在 running 时显式发送 `steer` 或 `followup`。控制动作通过 `/commands` 或 `/tree`，并在 running session 时返回 `active_invocation_exists`。
- 当前返回值为：

```ts
type AgentInvocationResponse = {
    sessionId: number;
    invocationId: string;
    status: "completed" | "waiting" | "error";
    finalMessage?: string;
    reportResult?: {
        result: string;
        success?: boolean;
        data?: unknown;
    };
    error?: string;
    usage?: Usage;
    events: AgentEvent[];
    queuedItem?: AgentQueuedMessage;
};
```

- queued steer / followUp 当前也复用 `waiting` 返回，并在 `finalMessage` 中包含 queued item id；同时通过 session event hub 广播 `steer_queued` / `follow_up_queued`，并在响应中返回可选 `queuedItem` 方便前端立即展示。这是第一版实现细节，后续可以再独立成显式 `queued` status。
- 第一版不支持取消 queued steer / followUp。queued message 尚未 drain 时也不提供删除接口；如果用户误发，可以继续发送新的 steer / followUp 纠正。若 queued message 已经 drain 并写入 session，则通过 `tree` 回退或分支切换处理。
- followUp queue 第一版使用 FIFO 自动执行：当前 ReAct loop 完整结束且没有 pending steer 后，harness 自动取下一条 queued followUp 继续运行。如果当前 session 停在 approval pending，followUp 只排队并进入 snapshot，不抢占 approval resolution；用户提交 `continue + resolution` 后先恢复当前 tool call。abort 默认清空尚未 drain 的 steer / followUp queue。
- active invocation lock 是 session 级运行互斥：同一个 `sessionId` 在同一时刻只能有一个正在修改 session tree、调用 provider、执行工具或执行 compact / command 的 active invocation。它不是数据库锁，也不是跨进程锁；第一版是 harness 进程内的运行态保护，用来防止两个浏览器窗口或两个请求同时向同一棵 JSONL entry tree 追加互相交错的消息。
- active invocation lock 拦截的是“会改变 session 真相”的并发动作：并行 provider loop、compact、tree/fork/retry、model/plan command、approval resume 等。普通 prompt 在运行中默认进入 followUp queue；控制命令在运行中返回 `active_invocation_exists`；approval resolution 恢复当前 active invocation，不创建第二个 run。
- active invocation 当前带 `mode: "prompt" | "continue" | "compact"`，并共享同一个 session active invocation lock。
- invocation lifecycle 会写入轻量 session entry。第一版 event hub 和 lock 仍是内存态；重启后不自动恢复 provider/tool run，只把状态暴露给 UI 和后续命令处理。
- session command 当前请求为 discriminated union：

```ts
type AgentCommandRequest =
    | { command: "new" }
    | { command: "archive"; reason?: string }
    | { command: "compact"; instructions?: string }
    | { command: "plan"; active: boolean }
    | { command: "model"; modelKey: string | null }
    | { command: "thinking"; thinkingLevel: "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | null }
    | { command: "retry"; entryId?: string }
    | { command: "fork"; entryId?: string }
    | { command: "tree"; targetEntryId: string; position?: "at" | "before" };
```

```ts
type AgentCommandResponse = {
    status: "completed" | "started";
    sessionId: number;
    snapshot?: AgentSessionSnapshot;
    createdSession?: AgentSessionSummary;
};
```

- `/commands` 不允许长 HTTP 阻塞。`/compact` 返回 `started` 后，压缩过程通过 `/events` 推送；前端如果需要最终状态，从后续 `message_end` / `session_entry` / `session_state_changed` 或重新拉 snapshot 获得。
- 中断运行的正式入口是 `POST /api/agent/sessions/:sessionId/abort`，请求参数为：

```ts
type AgentAbortRequest = {
    reason?: string;
    clearQueue?: boolean;
};
```

- abort 语义：
  - 取消当前 active invocation 的 provider stream 和正在执行的工具。
  - 已经写入 session 的 user、assistant partial、tool result、session writes 不回滚。
  - `clearQueue` 默认 `true`，清掉尚未 drain 的 steer / followUp queue；第一版不提供“保留 queued steer / followUp”UI。
  - abort 后通过 session event hub 广播 `invocation_aborted`，session 回到 idle。
  - 如果当前 session 没有 active invocation，返回 `{ status: "idle" }`，不报错。
- 前端加载 session 采用 `snapshot + event patches`：
  - 首次打开某个 Agent 抽屉或独立窗口时，调用 `GET /api/agent/sessions/:sessionId` 拉取 snapshot。
  - snapshot 返回 metadata、activeLeafId、active path messages、tree summary、linked agents、pending approval、model/thinking/plan-mode state 等 UI 初始化所需状态。
  - snapshot 的 `thinkingLevel` 是 session 级显式覆盖；`null` 表示跟随 Agent Profile，`off` 表示当前 session 显式关闭 thinking。
  - 后续主要通过 `GET /api/agent/sessions/:sessionId/events?after=<seq>` 同步增量事件。
  - SSE 重连、切窗口、发现 event gap、用户手动刷新或服务端返回 `snapshot_required` 时，前端重新 `GET /api/agent/sessions/:sessionId` 对齐真相。
- snapshot 指服务端从 session JSONL active path reducer 加上当前内存运行态合成的一次完整 UI 状态快照。它不是单纯的历史消息列表，还应包含 active invocation、pending approval、尚未 drain 的 steer / followUp queue、linked agents、tree summary、model / thinking / Plan Mode 等当前状态。首次加载、重连缺 event、手动刷新和 `snapshot_required` 都应重新拉 snapshot。
- snapshot 的 active path messages 使用原始 `AgentMessage[]`，不返回旧前端 conversation tree projection。前端基于 `AgentMessage[]` 与 Pi `AgentEvent` 做渲染转换；tree 只返回轻量 entry summary 与 active leaf 信息。
- 前端 store 的 canonical 数据形态是新 session contract：`AgentSessionSnapshot`、原始 `AgentMessage[]`、`AgentSessionEvent[]`、`liveInvocation`、`steerQueue`、`followUpQueue` 等。ChatDrawer 需要的不是 legacy message DTO，而是新的卡片渲染模型：把 session message、Pi event、tool execution 和 live state 派生成一组卡片，用于展示普通 assistant/user 文本、通用 tool call、以及针对 `read` / `write` / `edit` / `apply_patch` / `bash` 等工具做过 UI 适配的卡片。
- ChatDrawer 第一版应把“卡片列表”作为渲染目标：通用 tool call 有基础卡片，文件编辑类工具可以显示 diff / path / 状态，`bash` 可以显示命令、运行状态和流式输出尾部。流式工具输出不要求写进 `snapshot.messages`，但需要进入 live card state，让同一工具卡片能随 `tool_execution_update` 增量刷新；最终仍以后端 snapshot / session entry 作为历史真相。
- ChatDrawer 卡片模型放在前端专用派生层，不进入后端 DTO，也不塞进 store 作为持久真相。当前落点是 `app/components/novel-ide/agent/agent-message.ts` 与 `useAgentSession.ts`：输入 snapshot `AgentMessage[]`、session event 和 live invocation，输出 `AgentChatFlow` 使用的 text/tool card 列表。
- session JSONL / reducer 是真相；SSE 只是增量广播通道。前端不能把 event stream 当作唯一历史来源，也不能依赖单个 invoke 请求返回的 events 重建全量历史。
- event hub 第一版不持久化 SSE / stream events。事件只进入内存 bounded replay buffer；重启、buffer 过期或客户端 event gap 时，前端通过 session snapshot 恢复。JSONL 只保存 message、leaf、session_update、custom、compaction 等最终事实 entry。
- 已新增 session 级 event hub，不再使用旧单次 `invoke-stream`：
  - 同一个 `sessionId` 允许多个 subscriber。
  - 同一轮 invocation 的事件 fan-out 给所有正在订阅该 session 的浏览器窗口。
  - event 使用 session 内递增 `seq` 或全局递增 `eventSeq`，客户端保存最后收到的序号。
  - 服务端保留 bounded replay buffer；新窗口先拉 snapshot，再订阅 events，若当前 session 正在流式输出，应能 replay 当前 invocation 的已发生事件。
  - 如果 `after` 太旧或 replay buffer 不足，服务端发送 `snapshot_required`，由前端重新拉 snapshot。
  - 第一版 event hub 不做跨进程同步。这里的“跨进程”指多个 Node / Nuxt worker 或多台实例之间共享实时事件；如果 A 请求落在进程 1、B 的 SSE 连接落在进程 2，纯内存 event hub 无法互相广播。第一版按单进程本地使用设计，丢失事件时靠 snapshot 恢复；后续多实例部署再考虑 Redis pub/sub、数据库通知或消息队列。
- `snapshot_required` 是服务端控制事件，表示当前 SSE replay 已不足以让客户端安全补齐状态，例如客户端请求的 `after` 太旧、replay buffer 已被截断、服务端重启导致内存事件丢失，或者 session state 发生了无法只靠增量事件安全合并的变化。客户端收到后不继续猜测历史，直接重拉 snapshot。
- `seq gap` 是客户端本地发现事件序号不连续，例如上一次收到 `seq=42`，下一条却是 `seq=45`。这说明中间事件丢失或连接切换期间错过了事件；处理方式和 `snapshot_required` 一样，重拉 snapshot 并清理当前 live patch。
- SSE 的运行期事件直接使用 Pi `AgentEvent` 语义：`agent_start`、`turn_start`、`message_start`、`message_update`、`message_end`、`tool_execution_start`、`tool_execution_update`、`tool_execution_end`、`turn_end`、`agent_end`。服务端可以在外层附加 `seq/sessionId/invocationId` 等 transport metadata，但不把 Pi event 映射成旧前端的 `assistant_delta`、`tool_call_started`、`thread_snapshot` 等另一套生命周期。
- Neuro Book 只新增少量 session control event，用来表达 Pi loop 之外的状态：`snapshot_required`、`follow_up_queued`、`session_entry`、`session_state_changed`、`invocation_aborted`。这些事件不替代 Pi event，只补齐 session hub、queue 和 UI state 的需要。
- SSE event envelope 固定为“transport 外壳 + 原始 Pi event / session control event”：

```ts
type AgentSessionEvent =
    | {
        seq: number;
        sessionId: number;
        invocationId?: string;
        kind: "pi";
        event: AgentEvent;
    }
    | {
        seq: number;
        sessionId: number;
        invocationId?: string;
        kind: "session";
        event: AgentSessionControlEvent;
    };
```

- `seq` 用于 replay/gap detection；`invocationId` 用于 UI 把事件归到当前 run 或 compact run；`event` 内部尽量保持 Pi 原始形状，避免重建第二套运行期生命周期。
- steer / followUp queue 需要进入 snapshot，也需要通过 event hub 广播：
  - 运行中收到 steer / followUp 时，后端先创建内存 queue item，不立刻写 session history。
  - event hub 广播 `steer_queued` / `follow_up_queued`，让同一 session 的其他浏览器窗口也看到“消息已引导/已排队”。
  - 新打开窗口拉 snapshot 时，也应能看到尚未 drain 的 queued steer / followUp。
  - 到 drain point 时，queued steer / followUp 才作为标准 user message 写入 session，并广播正常 message / entry 事件。
- PI assistant streaming 持久化参考与第一版决策：
  - `message_update` 是 UI / event stream 层的增量事件，不直接写 session JSONL。
  - `AgentSession` 在收到 `message_end` 时持久化 user / assistant / toolResult message，以保持 transcript ordering。
  - provider abort/error 会产出最终 assistant message，`stopReason` 为 `"aborted"` 或 `"error"`；只要 core 发出 `message_end`，PI 仍按最终 message 写 session。
  - PI 的 `getLastAssistantText()` 会跳过没有内容的 aborted assistant message，但不会禁止有内容的 aborted message 留在历史里。
  - Neuro Book 第一版跟随这个策略：`message_update` 只广播，`message_end` 才写 session；abort 时若有最终 assistant message，就按 `stopReason: "aborted"` 写入，空内容 aborted message 可选择不在 UI 主历史突出展示。
- `retry`、`edit message`、`rollback/fallback` 都归一到底层 `tree` 语义：
  - `tree` 本身只移动 active leaf，不删除历史，不调用 LLM。
  - `edit message` 等价于移动到目标 user/custom message 的 parent，再把 edited message 作为新 prompt 追加并 invoke；旧分支保留。
  - `retry/refresh` 等价于移动到目标 assistant message 的 parent，再重新 continue 或 prompt，生成 sibling assistant branch；旧回复保留。
  - `rollback/fallback` 等价于移动到目标 entry 或目标 entry 的 parent，后续由用户选择继续、重新发或切换分支。
- 第一版 session 有 active invocation 时禁止 `tree` 操作，包括 `tree + next.invoke`。如果当前 session 正在 streaming、执行工具或等待本轮结束，后端返回 `active_invocation_exists`；用户需要先 abort 当前 invocation，等 session idle 后再 edit/retry/rollback/fallback。这样避免 active run 的后续事件写入已经移动过 leaf 的 session tree。
- API 层已提供 `tree + invoke` 能力，减少前端分两次请求导致的竞态。当前实现仍是先移动 leaf 再 invoke，若后续 invoke 失败不会自动回滚 leaf；真正原子语义后续补齐。当前形态：

```ts
type AgentTreeRequest = {
    targetEntryId: string;
    position: "at" | "before";
    next?: {
        type: "invoke";
        mode: "prompt" | "continue";
        message?: AgentUserMessageInput;
    };
};
```

- 旧 UI 的“删除/回退/编辑/刷新”按钮可以保留，但交互语义需要改成 append-only branch navigation：
  - 不原地改 message entry。
  - 不物理删除旧 branch。
  - 主聊天区第一版展示 active path 线性消息，不直接展开完整 session tree。分支信息通过 message switcher、tree summary 或专门分支入口展示。
  - UI 上应明确当前 active branch，并允许用户切换旧回复和新回复。
  - 编辑消息可以保留“原地编辑”的交互感觉，但提交时底层执行 `tree + next.invoke`：移动到目标消息 parent，追加 edited user message，生成新分支；旧分支保留。
- 前端渲染和核心交互已迁移到新 session/event 数据源：`AgentChatFlow`、message bubble、tool bubble、composer、消息操作、审批/输入恢复、模型选择、Plan Mode、refresh/retry、rollback/fallback、edit message 等旧抽屉核心入口继续保留。旧 `useAgentApi` 已删除，不做 legacy wrapper。
- 前端命名已做一次性硬切：`thread` 心智迁到 `session`，`subagent` 心智迁到 `linked agent` / `agent`。`AgentThreadDialog.vue` 已改为 `AgentSessionDialog.vue`，`useAgentThreadSession.ts` 已改为 `useAgentSession.ts`，`AgentSubagentPanel.vue` 已改为 `AgentLinkedAgentPanel.vue`。
- `model override` 是 per-session 状态，不是 per-invocation 参数。前端切换模型时应写 append-only session state entry，影响后续 invocation；当前已经启动的 active invocation 不被中途切换模型。assistant message 自身仍应记录本次实际使用的 provider / model，方便历史解释。
- `model override` 不单独设计 `PATCH /model` endpoint。模型选择 UI 调用 `/commands`，使用 `/model <modelKey|default>` 命令；这样模型切换、Plan Mode、compact、tree/retry/fork 都共享同一个 session command 入口。
- `Plan Mode soft toggle` 是 per-session 状态，但不单独设计 patch endpoint；它走通用 session command dispatcher，例如 `/plan on`、`/plan off`、`/plan toggle`。command 写 session state entry，并通过 event hub 广播，确保同一个 session 的多个浏览器窗口看到一致状态。
- `/compact` 同样走通用 session command dispatcher。它负责发起 compact active invocation，实际压缩进度和结果通过 SSE 同步；它不是普通 user prompt，也不进入 followUp queue。
- approval resume 仍通过 `continue + AgentResolution` 恢复当前 pending tool call，不写成普通 user message。

## 2026-07-10 Task 102 Prompt / Turn Context 演进

- Harness 与 Profile Preview 已改为共用 `server/agent/profiles/prompt-order.ts`，provider 消息顺序固定为 `History → ModelContext → AppendingSet → CurrentUserInput`；回归测试不再允许 ModelContext 落到当前用户输入之后。
- 当前用户输入继续由 Harness 作为独立 durable prompt 持有。`writer` 与 `inline.editor` 已移除对 `ctx.invocation.message` 的 AppendingSet 复制，仅在 message 缺失时渲染条件式安全提示。
- 文件变更感知不再是 Harness 业务分支。Profile 通过 `<FileChangeNotice mode={...} />` 声明 `turnContexts`，通用物化器按 `appendingIndex` 插入消息，成功 ingest 后再结算 history cursor。
- 未声明 `FileChangeNotice` 的 profile 不再回退 minimal；Leader 显式 full、Writer 显式 minimal、Inline Editor 不声明。
- 黑盒回归已锁定「有 Project + 产生 unseen + profile 未声明节点 = 0 notice」；Task 102 聚焦 48/48、Agent tools 147/147、全仓 typecheck 退出 0。

详见 [Task 102](../102-agent-change-inbox-and-prompt-order/README.md) 与 [`reference/agent/context.md`](../../../reference/agent/context.md)。

## Remaining Questions

- 前端仍需要一次真实浏览器交互验收：多窗口订阅、followUp queue、approval resume、Plan Mode、model command、compact、edit/retry/rollback/fallback 的端到端体验需要在开发服务器里手动确认。
- 旧低代码 Profile template visual editor 已从 active UI/API 移除；`profile-templates` 与 `user-profile-templates` 旧路由当前只保留 501 tombstone，避免旧 import 造成 dev server 启动问题，但不再作为新合同。新的 TSX Profile Workbench 已切到 `/api/agent/profiles/*`、轻量 source-draft、后台 worker 编译与 `.compiled` 运行真相源，不恢复旧低代码保存/新建/restore/schema builder 兼容层。
- Session event hub 第一版是单进程内存广播；跨 Nuxt worker / 多实例部署时仍需要 Redis pub/sub、数据库通知或其他共享事件通道。

## Files Changed

- `docs/tasks/02-pi-agent-harness-migration/README.md`
- `.gitignore`：忽略手动 smoke 产生的 `.agent/agent-smoke/`。
- `scripts/smoke-agent.ts`：真实 provider 手动 smoke。
- `scripts/smoke-agent-http.ts`：HTTP smoke，调用正式 `/api/agent/sessions/**` 入口。
- `assets/workspace/.nbook/agent/scripts/workspace.ts`：active Agent workspace 内容节点 CLI，从 v2 归档目录解耦，并通过 Agent bin 暴露为 `workspace`。
- `scripts/build/profile.ts`：开发 convenience CLI；Agent runtime 稳定入口是 system/user assets 中的 `profile status/check/compile/preview`。
- `scripts/prepare-profile-types.ts`：输出动态 profile 类型索引到 `server/agent/profiles/dynamic-profile-types.generated.ts`。
- `shared/dto/agent-session.dto.ts`：正式 session/invocation/event HTTP DTO。
- `server/api/agent/sessions/**`：正式 session / invocation / command / abort / tree / events HTTP 路由。
- `package.json` / `bun.lock`：保留 Pi 与 TypeBox 依赖，移除 LangChain 依赖。
- `server/agent/**`：Pi-based 主 Agent 后端。
- `server/agent-v2/**`、`assets/agent-v2/**`：旧 v2 归档参考。
- `server/api/agent-v3/**`、`server/api/agent/threads/**`：已删除临时 v3 与旧 thread HTTP 路由。
- `server/utils/model-settings.ts`：从旧 LangChain provider 文件中拆出的轻量模型设置转换能力。
- `app/components/novel-ide/agent/tiptap/AgentReferenceNode.ts`
- `app/components/novel-ide/agent/tiptap/AgentSkillNode.ts`
- `app/composables/useAgentSessionApi.ts`：正式前端 session API composable。
- `app/components/novel-ide/NovelAgentDrawer.vue`：接入新 session API、snapshot、event stream 和 command/tree/abort/invocation 操作。
- `app/components/novel-ide/agent/useAgentSession.ts`：前端 session canonical store 与 event merge。
- `app/components/novel-ide/agent/AgentSessionDialog.vue`、`AgentLinkedAgentPanel.vue`：替换旧 thread dialog 与 subagent panel。
- `app/components/novel-ide/agent/agent-message.ts`：从 Pi message/session event 派生聊天卡片模型。
- `app/composables/useAgentApi.ts`、`app/components/novel-ide/agent/useAgentThreadSession.ts`、`AgentThreadDialog.vue`、`AgentSubagentPanel.vue`、`AgentSubagentBubble.vue`：已删除旧 Agent 前端入口。
- `assets/workspace/.nbook/agent/profiles/builtin/leader.assets.profile.tsx`：新增 v3 用户资产助手 profile，替代 v2 `leader.assets` 的运行入口。
- `shared/dto/config.dto.ts`、`server/config/**`、`server/api/config/**`、`app/composables/useConfigApi.ts`：统一 Config 系统入口，替代旧 workspace 默认 profile 专用接口。
- `server/api/settings/workspace-agent-profiles.*`、`server/api/workspace-settings/**`、`server/workspace-settings/**`、`shared/dto/workspace-settings.dto.ts`：已删除。
- `server/utils/model.ts` / `server/utils/model.test.ts` / `server/utils/agent-message-utils.ts`：已删除，旧 provider 代码只保留在 v2 归档历史中。
- `PROJECT-STATUS.md`

## Verification

- `bunx prisma generate`：通过；Prisma client 已按删除旧 Agent thread/message schema 重新生成。
- `bun test server/agent`：Agent harness / API helper / profile / tool / session event hub 测试通过。
- `bun test server/config server/agent`：Config 与 Agent 回归测试通过。
- `bunx tsc --noEmit --pretty false`：通过。
- `bun scripts/prepare-profile-types.ts --all`：通过；builtin key 不生成动态类型索引，当前输出 0 个 dynamic profile type entries。
- `bun test server/config server/agent`：通过；覆盖 `leader.assets` 真实 catalog 加载和 Config editor snapshot 默认 profile 解析。
- 手动 HTTP 复现：`GET /api/config/editor-snapshot?workspaceKind=user-assets` 能通过 `defaultProfileSettings.effectiveProfileKey` 返回 `leader.assets`，且 catalog 中 `leader.assets` / `leader.default` 均为 `loaded`；`POST /api/agent/sessions` 使用 `profileKey: "leader.assets"` 能成功创建 session，不再报 `未找到 agent profile: leader.assets`。
- 验收阶段追加验证：`node --import tsx` 下直接调用 v3 profile HTTP service，`catalog` / `detail` / `previewAgentProfilePrepare` 均能在本地返回，`leader.assets` 预览得到 `systemPrompt` + dynamic message。当前 3000 dev server 进程若对 `/` 与 `/api/config/editor-snapshot` 超时，应先判断 dev server 进程整体状态，再做浏览器/HTTP 交互复验。
- `bun scripts/smoke-agent.ts`：通过；使用真实 provider `xiaomimimo/mimo-v2.5-pro`，通过 assets 版 `leader.default` 普通 completion 返回 `agent session smoke ok`，并拿到 usage 与 session JSONL。
- `scripts/smoke-agent-http.ts` 需要本地 dev server，当前只作为手动 HTTP smoke 入口记录；本轮未自动启动浏览器或 dev server 做交互验收。
- 搜索检查：active `app` / `server` / `shared` / `scripts` 中不再引用 `agent-v3`、`AgentV3`、`useAgentV3`、`agent-v3.dto`、`useAgentApi`、`/api/agent/threads`、`AgentThreadDialog`、`AgentSubagentPanel`、`useAgentThreadSession`；旧 `agent-chat.dto` 命中仅保留在 `server/agent-v2` 归档目录。
- 搜索检查：active `app` / `server` / `shared` 中不再引用 `/api/settings/workspace-agent-profiles`、`/api/workspace-settings` 或 `WorkspaceAgentProfileSettings`。
- 设计依据来自本地 Pi 源码和调研文档 `docs/research/pi-agent-harness.md`。Bash PATH 修复参考 Pi `createBashTool(..., { commandPrefix, spawnHook })` 的 runtime 注入模型：在 bash runtime 统一前置 Agent bin，而不是让 profile/prompt 猜路径。
- Agent CLI / bash PATH 追加验证：`bun test server/agent/tools/file-tools.test.ts server/workspace-files/workspace-files.test.ts server/agent/profiles/leader-assets-profile.test.ts` 通过，覆盖 `workspace --help`、`workspace node parse/validate`、user-assets bin 优先级、user-assets bin 覆盖实际执行、Git Bash 内 PATH 前置、系统 assets 同步补齐 `agent/bin` 与 `agent/scripts`、已有用户覆盖不被 sync 覆盖、`RIPGREP_CONFIG_PATH` 注入与 user-assets rg config 优先级、`rg --files` 输出 `/` 路径，以及 active profile 不再使用 PowerShell 示例、`--path-separator=/`、`MSYS_NO_PATHCONV=1` 或 `(^|[\\/])index` 管道。
- Agent CLI 交付约束：`assets/workspace/.nbook/agent/bin/workspace` 已进入 Git 索引并标记为 `100755`；`.gitattributes` 固定无扩展 shell wrapper 与 `.ts` 为 LF，避免 Windows `core.autocrlf` 把 shebang wrapper 转成 CRLF。
- Profile `.compiled` 追加验证：系统 profiles 均通过 `bun scripts/build/profile.ts status --all --system` 检查为 `loaded`；系统资产准备脚本会生成 `.compiled` artifact 与 `.system-profile-metadata.json`。
- 删除/不可运行 profile 兼容验证：`bunx vitest run server/agent/harness/neuro-agent-harness.test.ts -t "profile 的历史 session|不可运行 profile|pending approval 没有可靠 waiting lifecycle" --testTimeout 20000` 通过，覆盖缺失 profile 的 list/snapshot/live state/relations、全局 pending approval 降级展示、prompt/continue/steer/followup/resolution 拒绝、`new`/`compact`/`tree + invoke` 拒绝且不移动 leaf，以及不可运行 profile 的 `unloadable` 标记。`bun run typecheck` 仍失败在既有无关红灯（tiptap agent-suggestion、ProfileTemplateNodeView、compaction.ts、silly-tavern-card-cli.test.ts）；整份 harness 单跑新增兼容用例通过，但全量 `neuro-agent-harness.test.ts` 当前仍有 compaction/summarizer 持久化断言和少量后台任务串扰失败，本轮未扩大修复范围。

## 2026-07-10 Task 102 验收修复

- `FileChangeNotice` 继续由 Profile `turnContexts` 声明；Harness 不恢复任何 hard-coded notice 分支，也不读取 profile setting 猜 fallback。
- 动态上下文 settlement 仍只在 provider turn ingest 成功后执行。FauxProvider 黑盒新增 provider error → 同一 notice 在重试轮再次出现 → 成功后下一轮不新增 notice 的 at-least-once 覆盖，并锁定 notice 位于 CurrentUserInput 前。
- Agent notice 预处理现在是有界成本：最多 4 个文件执行安全 diff / `structuredPatch`，reference 不保存正文，最多列 50 文件，最终 notice ≤12,288 字符；遗漏摘要仍视为本轮交付，settlement 推进全部 unseen 的最大 entry id。
- 最终消息顺序保持 `History → ModelContext → AppendingSet → CurrentUserInput`，本轮未改变 CurrentUserInput 的 durable prompt 所有权。

## TODO / Follow-ups

- 补完整 session history HTTP/API 或调试 API：当前正式 HTTP 只提供前端 snapshot 和轻量 session query，不提供完整 history 原文下载。
- 强化 v3 tool policy：当前已按 `allowedToolKeys` 控制模型可见工具与执行硬权限；SkillCatalog 负责模型可见 skill 索引，正文读取走通用 `read`。后续还需要补更细粒度 skill 白名单或启用控制。第一版不做 workspaceRoot 路径硬沙箱。
- TODO：源码内 `server/agent/profiles/default-profile.ts` 最小 fallback 先保留，后续当系统 assets profile、测试 fixture、smoke 和用户覆盖链路稳定后评估删除，避免长期维护两套 `leader.default` prompt。
- leader prompt 第一版迁移范围已收窄：当前优先保证 TypeBox schema、history/dynamic/appending 映射、allowedToolKeys、agent catalog/linked agents 注入和新工具名正确；第一轮 Prompt Phase 已校准基础工具选择规则，剧情结构、内容节点、Markdown Studio 写作格式、Plan Mode reminder 等重型业务提示块后续再继续做完整 wording parity。
- `leader.default` allowedToolKeys 第一版不包含 `report_result`。如果未来某个 leader 需要被其他 agent 调用并以结构化结果结束，应通过专门 profile 或“可被 invoke_agent 调用”能力声明处理，不把顶层默认 leader 绑定到 report 协议。
- `invoke_agent` 不把 `report_result` 当成所有 agent 的隐式完成协议。目标 profile 允许 `report_result` 时，调用方期待结构化结果，harness 会在普通结束时提醒一次；目标 profile 不允许 `report_result` 时，调用方只拿普通 `finalMessage`，不做缺失 report 纠错。
- TODO：继续做更完整的 prompt parity。第一轮已对齐 Pi 基础工具 description 和 `leader.default` / `leader.assets` 工具选择规则；后续需要继续校准 skill 激活文案、Plan Mode reminder 和更完整的小说业务提示块。
- TODO：未来区分“可被 invoke_agent 调用的 agent”和“只能由用户直接打开/运行的 agent”，避免没有合适完成协议的 agent 被其他 agent 误调用。
- TODO：为 `invoke_agent` 预留非阻塞调用。`block: false` 后续应立即返回 invocationId / sessionId，并通过 session event 或订阅 API 观察完成状态；第一版不实现非阻塞调用。
- TODO：补浏览器端真实交互验收，重点看多窗口同步、流式工具卡、approval resume、followUp queue、compact 和 tree+invoke 操作。
- TODO：event hub 后续支持跨进程/多实例广播；第一版是单进程内存 replay，重启或多 worker 场景通过 snapshot 恢复，不保证实时 fan-out。
- TODO：重新设计 TSX profile 写入工作台。当前 Agent 抽屉已经迁移，user-assets 入口可以直接编辑 `workspace/.nbook/agent/profiles` 下的 TSX profile 源文件；旧 `ProfileTemplateVisualEditor` 与旧写入接口因尚未适配新 TSX profile 契约，已从 active surface 移除。后续按 TSX 源码编辑优先的方向重接，不恢复旧低代码兼容层。
- TODO：补 `.compiled` artifact 清理策略。当前全量系统编译会清理系统 `.compiled`，单文件用户编译会保留旧 artifact 文件；后续可增加 prune 命令或 UI 清理动作。
- 为动态 agent catalog 增加 lazy detail 查询能力；当前 prepare 已可读取 catalog snapshot 中的 InputSchema / OutputSchema，但还没有针对大 catalog 的分页/按 key 查询优化。
- user-assets 当前稳定形态：用户覆盖根为 `workspace/.nbook`，系统资源根为 `assets/workspace/.nbook`，agent profile/skill 放入 `.nbook/agent`，workspace 模板放入 `.nbook/templates`。后续如继续改入口命名，应以 `reference/workspace/TERMS.md` 为术语真值。
- assets 路径硬切已完成；后续若新增系统资源，先放到 `assets/workspace/.nbook/<relative>`，再确认同步逻辑和用户覆盖层 `workspace/.nbook/<relative>` 一致，不恢复旧路径 fallback。
- 后续评估文件/变量回溯能力：变量可通过 `variable_set` / custom state entry reduce；文件回溯需要专门的 `file_snapshot` / `file_patch` entry 或接入 Git/worktree snapshot，第一版 session 只记录文件操作事实，不承诺文件内容回滚。
- 若开始实现，持续更新本文档和 `PROJECT-STATUS.md`。

## 2026-08-01 调用树级联停止与 UI 收敛

### 问题与根因

- 主 Agent 的停止入口只按当前 session 中止一个 AbortController；`invoke_agent` 创建的子 session 拥有独立 Controller，且调用方 metadata 没有父 invocation id，因此子 Agent、孙 Agent和并行兄弟仍会继续运行。
- 前端收到 `invocation_aborted` 后进入 `aborting`，但 recovery 已无 active invocation 时刻意不转 idle，导致输出按钮和运行态长期不复位。

### 实施结果

1. `invoke_agent` 在 caller metadata 中携带父 `invocationId`。Harness 维护仅限当前进程运行期的双向父子 invocation 索引，不把 session ownership 错当运行调用树。
2. `abortInvocation()` 递归标记并中止当前调用树，使用 invocation id 防止误停同一 session 后续的新调用；父调用已 aborting 时新接入的竞态子调用会立即自停。
3. Harness 为活动 invocation 建立 settlement，停止 API 在整棵树完成 terminal 清理后才返回；无关 session 不进入 aborting。
4. 前端 recovery/live shell 一旦确认 `activeInvocation=null`，无论之前是否 aborting 都清理待提交流式更新并恢复 `idle`，输入栏回到可发送状态。

### 验证结果

- 新增黑盒覆盖主 Agent → 两个并行子 Agent → 孙 Agent 的递归中止，并确认无关 session 保持 running；前端 reducer 覆盖 `invocation_aborted → activeInvocation=null → idle`。
- 合并定向回归 6 文件、57/57；Harness 黑盒 19/19；关键修正后回归 5 文件、45/45。
- 最终关键回归连同 RP 一致性审计和 100 Tick 长场景为 8 文件、60/60，通过。
- 扩大 RP/Harness 回归 317/319；既有“已删除 session 模型恢复投影”断言仍失败，与调用树停止无关。
- `bunx tsc --noEmit --pretty false` 无本轮诊断；仅剩既有 `SelectOption` 导出错误。

### 与计划的出入

- 原方案考虑由 `invoke_agent` 工具自行监听父 AbortSignal；最终把父子关系与递归中止放在 Harness 统一管理，工具只传递父 invocation 身份。这样多层级、并行兄弟、竞态接入和 invocation-id 防误停都由同一状态机约束。
