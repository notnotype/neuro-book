# Leader Default Prompt Parity

## User Request

- 为 `leader.default` 制定新的 v2 prompt 迁移计划文档。
- 迁移目标是把 v2 的 `server/agent-v2/profiles/builtin/leader-default.profile.tsx` 的真实提示词语义完整迁入当前 v3 TSX profile。
- 同时做一轮轻量 `$grill-with-docs`，把迁移前的关键设计问题问清楚。
- 用户已确认：task 工具、plot 工具、SQL 工具、writer/retrieval profile、Plot System 工具指令和 Plan Mode full/sparse/exit/reentry 都要迁移。

## Goal

- 让当前 v3 `leader.default` 不只是压缩版迁移，而是对齐 v2 leader 生态：leader prompt、task 工具、plot 工具、SQL 工具、writer profile、retrieval profile 和 Plan Mode reminder。
- 迁移必须保持当前 active v3 profile contract：`defineAgentProfile({ context })`、TSX Profile DSL、`ProfileTurnPlan`、`allowedToolKeys` 和 harness pre-loop 写入规则。
- v2 工具迁移到当前 `server/agent` 工具注册表；不要恢复旧 `server/agent-v2` runtime。

## Current State

- v2 真实来源是 `server/agent-v2/profiles/builtin/leader-default.profile.tsx`；`assets/agent-v2/profiles/builtin/leader-default.profile.tsx` 只是 wrapper。
- 当前 v3 系统 profile 是 `assets/workspace/.nbook/agent/profiles/builtin/leader.default.profile.tsx`。
- 当前 v3 用户覆盖 profile 是 `workspace/.nbook/agent/profiles/builtin/leader.default.profile.tsx`，如果存在且未同步，会遮蔽系统 profile 更新。
- 当前 v3 profile 已使用 `ProfilePrompt` / `System` / `HistorySet` / `ModelContext` / `AppendingSet` / `Reminder` / `Watch` / `SkillCatalog` / `ActivatedSkills`。
- 当前 v3 `leader.default` 已迁入 v2 生态语义，并继续用本任务记录后续 prompt / tool query 修正。
- 当前 v3 已有工具：`read`、`write`、`edit`、`apply_patch`、`bash`、`create_agent`、`invoke_agent`、`get_agent`、`get_agent_profile`、`get_session`、`detach_agent`、`request_user_input`、`enter_plan_mode`、`exit_plan_mode`、`task_create`、`task_set_status`、Plot read/write 工具、`execute_sql`、`report_result`。独立 `skill` 工具已禁用，skill 正文通过 `read` 读取 SkillCatalog location。
- 当前 v3 已注册 `writer` / `retrieval` profile；`AgentCatalog` 只提供索引，profile schema 详情通过 `get_agent_profile` 查询。
- v2 task 工具依赖旧 `context.agentGateway.createTaskList/setTaskStatus`；v3 没有同名 gateway，需要用 session `custom` entry 或 harness API 重建等价状态面。
- 前端任务卡代码仍存在：`app/components/novel-ide/agent/AgentTaskBubble.vue`、`task-list.ts` 和 `tool-render-registry.ts` 已识别 `task_create` / `task_set_status`，迁移重点是让 v3 工具返回兼容 `rawResult` 的 task list。
- v2 plot 工具依赖旧 `AgentToolContext.getScope()/setStudio()`、`studio.novelId` 和 `studio.extra.selectedStoryThreadId/selectedStorySceneId`；v3 `ToolExecutionContext` 目前只有 session、workspace 和 harness，需要补足 novel/plot selection 状态来源。
- v2 SQL 工具在 `server/agent-v2/tools/sql/execute-sql.tool.ts`，支持单条 `SELECT` / `WITH` / `INSERT` / `UPDATE` / `DELETE`，禁止 DDL、事务控制、session control 和多语句；查询结果限制 200 行，statement timeout 1500ms，并提供 schema summary helper。
- v2 writer/retrieval profile 依赖 `SimpleProfile`、Zod schema、旧 file tool 名和旧 plot helper；迁移时要改成 TypeBox、TSX DSL、v3 file tool 名和 v3 `report_result` 输出合同。
- v2 Plan Mode work directory 规则在 `server/agent-v2/plan-mode-path.ts`：有小说 workspace 时是 `${workspace}/.agent/${threadId}/`，否则是 `workspace/.agent/${threadId}/`。

## Implementation Plan

1. 清理当前 v3 leader DSL 表达
   - 删除 `<Message>{renderHistoryIntro()}</Message>`，它只是迁移解释，不应进入模型历史。
   - 把 `<SkillCatalog text={renderAgentCatalog(ctx)} />` 改为 `<AgentCatalog />` + `<SkillCatalog />`；前者展示 agent profile 索引，后者只展示 skills。
   - 把 plan mode 的 TS 条件表达式改为 `<If condition={ctx.session.planModeActive}>`。
   - `Watch` 默认使用 children 表达固定提醒；只有需要 `previousValue/currentValue` 分支文案时才保留 `render`。

2. 迁移 v2 task 工具到 v3
   - 新增 `task_create` 和 `task_set_status` 到当前 `server/agent/tools` 注册表。
   - 状态存入当前 session 的 `custom` entry，建议 key 为 `agent.tasks`，保持 append-only + reduce 语义。
   - `task_create` 替换当前任务列表；`task_set_status` 更新单个 step，设置 `in_progress` 时把其他未完成 `in_progress` 退回 `pending`。
   - 工具返回完整 task list，并通过 tool raw result 保持 `AgentTaskBubble` 可解析。
   - 不重做任务卡 UI；复用现有 `AgentTaskBubble.vue` / `tool-render-registry.ts`。
   - `leader.default` 的 `allowedToolKeys` 加入 `task_create` / `task_set_status`。

3. 迁移 v2 plot 工具到 v3
   - 新增 plot 工具：`get_plot_tree`、`get_story_thread`、`get_story_scene_context`、`get_chapter_plot`、`create_story_thread`、`update_story_thread`、`create_story_scene`、`update_story_scene`、`create_story_plot`、`update_story_plot`。
   - 复用当前 `plotFacade` 和 `shared/dto/plot.dto` schema，但将工具 schema 改为 v3/pi tool 使用的 TypeBox 或当前 registry 可接受 schema。
   - 明确 novelId 来源：由 agent 在工具参数中显式指定；工具不从 session/workspace 静默推断 novelId。
   - 如果缺少 `novelId`，工具返回清晰错误，要求重新调用并传入 novelId。
   - 当前选中 Thread/Scene 状态存入 session `custom` entry，建议 key 为 `plot.selection`；读取类工具可回写 selection，便于后续调用省略 id。
   - `leader.default` 的 `allowedToolKeys` 加入全部 plot 工具。

4. 迁移 v2 SQL 工具到 v3
   - 新增 `execute_sql` 到当前 `server/agent/tools` 注册表。
   - 复用 v2 SQL 安全边界：单语句；只允许 `SELECT` / `WITH` / `INSERT` / `UPDATE` / `DELETE`；禁止 DDL、事务、session control、多语句、`COPY`、`VACUUM` 等。
   - 保留查询行数上限、statement timeout、只读事务包装和写入事务包装。
   - 迁移 `getAgentSqlSchemaSummary()` / `buildAgentSqlSchemaSummary()`，供 leader prompt 在允许 SQL 工具时注入 schema 摘要。
   - 保留 SQL 错误改写逻辑，继续提示业务表名和 camelCase 字段需要双引号。
   - 工具 description 改写当前 v3 文件工具名：文件正文读写用 `read` / `write` / `edit` / `apply_patch`，不要再出现 `read_file` / `edit_file` / `write_file`。
   - `leader.default` 的 `allowedToolKeys` 加入 `execute_sql`，并恢复 SQL 使用原则。

5. 迁移 writer / retrieval profile
   - 新增系统 profile 文件，key 使用 `writer` 与 `retrieval`；不再强调 subagent，调用方仍可通过 `create_agent` / `invoke_agent` 把它们当作专用 agent 使用。
   - 使用当前 v3 `defineAgentProfile({ context })` + TSX DSL，不恢复 `SimpleProfile`。
   - schema 从 v2 Zod 迁到 TypeBox，并导出 `InputSchema` / `OutputSchema` / `Input` / `Output`。
   - writer 工具改为 v3 名：`read`、`write`、`edit`、`apply_patch`、`report_result`；不默认给 `bash`。
   - retrieval 工具改为 v3 名：`bash`、`read`、`report_result`。独立 `skill` 工具已禁用，需要 skill 正文时按 SkillCatalog location 用 `read` 打开。
   - writer 的 plotPoints 读取改走迁移后的 plot helper 或直接复用 `plotFacade`；retrieval 的 metadata inventory prompt 改成当前 v3 `bash` 和 workspace CLI 规则。
   - 保留 writer 的“小猫之神”persona。
   - 恢复 v2 writer 写作风格和参考文档加载能力，包括 `writer-writing-style`、`writer-writing-reference` 和对应 writing-styles / writing-references assets。
   - `retrieval` 中的 inventory 改称“内容节点元数据清单”：第一步先用 `workspace node parse --stdin --ndjson` 生成内容节点摘要表，再做必要的精确搜索。
   - 为两个系统 profile 生成 metadata，并确保 user assets 同步。

6. 完整迁移 v2 leader prompt section
   - 以 `server/agent-v2/profiles/builtin/leader-default.profile.tsx` 为唯一 v2 prompt 来源。
   - 扩充 `renderSystemPrompt()`，覆盖 v2 的 System、协作模式、Markdown 扩展、工具使用、输出效率、Task Management、多 Agent、目录介绍、内容节点、Lorebook、Manuscript、Plot System、Shell commands。
   - 将 v2 工具名改写为当前 v3 工具名。
   - task、plot 和 SQL 工具迁移完成后，恢复对应 active tool instruction。

7. 完整迁移 Plan Mode reminder
   - 为 v3 harness/session 增加能表达 v2 reminder kind 的运行状态：`full`、`sparse`、`exit`、`reentry_full`。
   - `enter_plan_mode` / `exit_plan_mode` 工具在 approval resolution 后写入对应状态，下一轮 prepare 能注入正确 reminder。
   - Plan Mode work directory 命名参考 v2：有当前 workspace 时使用 `${workspaceRoot}/.agent/${sessionId}/`，否则使用 `workspace/.agent/${sessionId}/`。
   - leader prompt 使用 `<If>` / `<Reminder>` 表达 Plan Mode 注入，不用 TS 条件表达式散落在 JSX 中。
   - 保持 Plan Mode 是 soft mode：工具仍可见，但 prompt 和 reminder 明确禁止未批准实现。

8. 保持 runtime reminder 边界
   - `ModelContext` 只保留真正 model-only 的动态上下文。
   - `AppendingSet` 保留 workdir / project workspace / plan mode availability reminder、linked agents reminder、task reminder、plan mode reminder 和 ActivatedSkills。
   - task reminder 从 `ctx.session.customState["agent.tasks"]` 读取任务列表，只在存在未完成步骤时注入；`watchValue` 使用 compact task fingerprint，并设置 repeatEveryTurns，避免每轮重复刷屏。
   - 不恢复 v2 `<Message source="input">`；当前真实用户输入继续由 harness 作为 pending user message 写入 session。

9. 同步用户覆盖和 metadata
   - 同步修改系统 profile 与用户覆盖 profile，避免用户覆盖遮蔽系统修复。
   - 重新生成系统 profile metadata。

10. 更新文档
   - 本文档记录计划、grill 决策、实际结果和验证。
   - 更新 `docs/tasks/05-leader-profile-v2-adaptation/README.md`，链接到本任务并说明 prompt parity pass。
   - 如实际长期状态变化，更新 `docs/tasks/02-pi-agent-harness-migration/README.md` 和 `PROJECT-STATUS.md`。

## Test Plan

- 更新 `server/agent/profiles/leader-assets-profile.test.ts`：
  - 断言 prompt 包含 v2 核心 section：Task Management、内容节点引用分流、Anatomy Lorebook、Anatomy Manuscript、Anatomy Plot System、workspace CLI、Plan Mode。
  - 断言 prompt 包含当前 v3 文件和 agent 工具名：`read`、`write`、`edit`、`bash`、`create_agent`、`invoke_agent`、`get_agent`、`get_session`。
  - 断言 prompt 包含已迁移 task/plot/SQL 工具名：`task_create`、`task_set_status`、`execute_sql`、`get_plot_tree`、`get_story_thread`、`get_story_scene_context`、`get_chapter_plot`、`create_story_thread`、`update_story_thread`、`create_story_scene`、`update_story_scene`、`create_story_plot`、`update_story_plot`。
  - 断言 prompt 不包含未迁移旧工具名：`read_file`、`write_file`、`edit_file`、`execute_shell`、`create_subagent`、`invoke_subagent`、`list_subagents`。
  - 断言 `historyInitMessages` 包含 `Available agents`，但不包含迁移解释性的 `renderHistoryIntro` 文案。
  - 断言 plan mode active 时 `appendingMessages` 包含 Plan Mode reminder。
- 新增工具测试：
  - `task_create` / `task_set_status` 写入并 reduce session task list。
  - task tool result 能被 `parseTaskList()` 解析，现有 `AgentTaskBubble` 不需要改结构。
  - plot read 工具能通过 agent 显式传入的 `novelId` 调用 facade 并返回结构化结果。
  - plot 工具缺少 `novelId` 时返回清晰错误。
  - plot selection custom state 能被后续省略 id 的工具读取。
  - `execute_sql` 拒绝多语句、DDL、事务控制；只读查询限制行数；业务表/字段大小写错误会返回提示。
- 新增 profile 测试：
  - `writer` / `retrieval` 能从 assets catalog 加载。
  - 两者允许 `report_result`，且 OutputSchema 与 report_result 动态 schema 一致。
  - writer/retrieval prompt 不包含 v2 文件工具名。
- 验证命令：
  - `bunx vitest run server/agent/profiles/leader-assets-profile.test.ts server/agent/profiles/profile-dsl.test.ts server/agent/profiles/catalog.test.ts`
  - `bunx vitest run server/agent/tools/*.test.ts server/agent/harness/neuro-agent-harness.test.ts`
  - `bun scripts/check-profile.ts assets/workspace/.nbook/agent/profiles/builtin/leader.default.profile.tsx`
  - `bun scripts/check-profile.ts workspace/.nbook/agent/profiles/builtin/leader.default.profile.tsx`
  - `bun scripts/check-profile.ts assets/workspace/.nbook/agent/profiles/builtin/writer.profile.tsx`
  - `bun scripts/check-profile.ts assets/workspace/.nbook/agent/profiles/builtin/retrieval.profile.tsx`
  - `bun scripts/prepare-system-profile-metadata.ts`
  - `rg -n "read_file|write_file|edit_file|execute_shell|create_subagent|invoke_subagent|list_subagents" assets/workspace/.nbook/agent/profiles/builtin workspace/.nbook/agent/profiles/builtin server/agent/profiles/leader-assets-profile.test.ts`

## Grill Questions

1. task 工具是否迁移？
   - 决定：迁移 `task_create` / `task_set_status`，并恢复 leader prompt 中的 Task Management active instruction。

2. writer / retrieval 是否迁移？
   - 决定：迁移 `writer` / `retrieval`，并在 leader prompt 中恢复这两个专用 agent 的使用说明。

3. plot 工具是否迁移？
   - 决定：迁移 plot read/write 工具，并恢复 Plot System 工具级 workflow。

4. Plan Mode 是否完整迁移？
   - 决定：完整迁移 v2 full/sparse/exit/reentry reminder，需要补 v3 runtime 状态。

5. `SkillCatalog` 是否允许继续传 `text`？
   - 决定：可以保留 `text` escape hatch；`leader.default` 默认使用 `<SkillCatalog />`。

## Next Grill Questions

1. v3 task 状态是否也做前端任务卡？
   - 决定：做。复用 v2 留下的现有前端任务卡，必要时从 git 恢复缺失代码；当前检查发现任务卡仍在。

2. plot 工具的 `novelId` 来源是什么？
   - 决定：由 agent 自己在工具参数中显式指定。

3. `writer` 是否保留“小猫之神”风格设定？
   - 决定：保留，并恢复 v2 写作风格和参考文档加载。

4. retrieval 的第一步 inventory 规则是否要继续禁止先用 `rg`？
   - 解释：inventory 指“内容节点元数据清单”，也就是先用 workspace CLI 批量解析 index.md 元数据，拿到 path/title/type/status/refs/summary，再决定读哪些节点或做精确搜索。
   - 推荐：保留这条流程，但把文案改成“内容节点元数据清单”，避免术语不清。

5. Plan Mode thread work directory 的 v3 路径怎么命名？
   - 决定：参考 v2，使用 `${workspaceRoot}/.agent/${sessionId}/`；无 workspace 时 fallback 到 `workspace/.agent/${sessionId}/`。

## Open Questions

1. SQL 工具是否也要顺手迁移？
   - 决定：迁移 SQL 工具。

2. task 状态是否需要进入 `ctx.session.customState` 并被 leader `Reminder` 注入？
   - 决定：需要注入。

## Decisions

- task 工具迁移到 v3，并恢复 leader Task Management prompt。
- task 工具需要复用前端任务卡。
- plot 工具迁移到 v3，并恢复 leader Plot System 工具 workflow。
- plot 工具的 novelId 由 agent 显式传入。
- SQL 工具迁移到 v3，并恢复 leader SQL 使用原则。
- `writer` / `retrieval` 迁移到 v3 系统 profile；不再使用 `subagent.*` 命名。
- writer 保留“小猫之神”persona，并恢复 v2 写作风格与参考文档。
- Plan Mode full/sparse/exit/reentry 完整迁移，需要补 v3 runtime 状态。
- Plan Mode work directory 命名参考 v2：`${workspaceRoot}/.agent/${sessionId}/`。
- task 状态进入 session customState，并由 leader `Reminder` 注入给后续轮次。
- `SkillCatalog text` 作为 escape hatch 保留；leader 默认不使用。

## Files Changed

- `docs/tasks/06-leader-default-prompt-parity/README.md`
- `server/agent/harness/neuro-agent-harness.ts`
- `server/agent/harness/model-resolver.ts`
- `server/config/config-service.ts`
- `server/agent/session/custom-state-keys.ts`
- `server/agent/tools/builtin-tools.ts`
- `server/agent/tools/task-tools.ts`
- `server/agent/tools/task-tools.test.ts`
- `server/agent/tools/plot-tools.ts`
- `server/agent/tools/sql-tool.ts`
- `server/agent/profiles/builtin-contracts.ts`
- `server/agent/profiles/leader-assets-profile.test.ts`
- `assets/workspace/.nbook/agent/profiles/builtin/leader.default.profile.tsx`
- `assets/workspace/.nbook/agent/profiles/builtin/writer.profile.tsx`
- `assets/workspace/.nbook/agent/profiles/builtin/retrieval.profile.tsx`
- `server/agent/profiles/writer-writing-style.ts`
- `server/agent/profiles/writer-writing-reference.ts`
- `assets/workspace/.nbook/agent/profiles/.system-profile-metadata.json`
- `workspace/.nbook/agent/profiles/builtin/leader.default.profile.tsx`

## Verification

- `bun scripts/check-profile.ts assets/workspace/.nbook/agent/profiles/builtin/leader.default.profile.tsx`：通过。
- `bun scripts/check-profile.ts assets/workspace/.nbook/agent/profiles/builtin/writer.profile.tsx`：通过。
- `bun scripts/check-profile.ts assets/workspace/.nbook/agent/profiles/builtin/retrieval.profile.tsx`：通过。
- `bun scripts/check-profile.ts workspace/.nbook/agent/profiles/builtin/leader.default.profile.tsx`：通过。
- `bun scripts/prepare-system-profile-metadata.ts`：通过，生成 4 个系统 profile metadata。
- `bunx tsc --noEmit --pretty false`：通过。
- `bunx vitest run server/agent/profiles/leader-assets-profile.test.ts server/agent/profiles/catalog.test.ts server/agent/profiles/profile-dsl.test.ts server/agent/harness/neuro-agent-harness.test.ts server/agent/tools/*.test.ts`：通过，37 tests。

## Follow-up Review Fixes

- 修复 plot selection 跨 novel 混用：plot 工具仍要求 agent 显式传 `novelId`，允许跨 project/novel 访问；但省略 `threadId` / `sceneId` 时，只能复用同一 `novelId` 的 `plot.selection`。如果当前 selection 属于另一个 `novelId`，工具会要求显式传入对应 id，避免把 A 小说的 thread/scene 静默套到 B 小说。
- 修复 plot refs schema：`refs[].note` 与共享 DTO 对齐为可省略；传给 `plotFacade` 前补齐为 `null`。
- 新增 TSX DSL 节点 `<SqlSchemaSummary />`：它是 string fragment，可放在 `System`、`Message` 等支持 string 的节点内部。`leader.default` 现在在 `ModelContext` 中注入 SQL schema summary，辅助 `execute_sql` 使用当前业务表和 camelCase 字段。
- Workbench/可视化编辑器同步识别 `SqlSchemaSummary`，包含 parser、DTO、组件库、树规则、图标和源码生成路径。

### Follow-up Verification

- `bunx vitest run server/agent/profiles/profile-dsl.test.ts server/agent/tools/plot-tools.test.ts server/agent/profiles/leader-assets-profile.test.ts server/agent/profiles/workbench-service.test.ts`：通过，20 tests。
- `bun scripts/check-profile.ts assets/workspace/.nbook/agent/profiles/builtin/leader.default.profile.tsx`：通过。
- `bunx tsc --noEmit --pretty false`：通过。
- `bunx vitest run server/agent/tools/task-tools.test.ts`：通过。
- 旧工具名扫描：系统/用户 profile 未命中旧工具名；只命中 `server/agent/profiles/leader-assets-profile.test.ts` 中的 `not.toContain(...)` 断言。

## Implementation Result

- 已给 v3 harness 增加 `readSessionContext()` 与 `appendCustomState()`，工具可通过正式 API 读取 reduced session 和追加 custom entry。
- 已新增固定 custom keys：`agent.tasks`、`plot.selection`、`agent.planMode`。
- 已迁移 `task_create` / `task_set_status`。状态写入 `agent.tasks`，tool `details` 返回完整 task list，前端现有 `AgentTaskBubble` 可继续解析。
- 已迁移 plot 工具：`get_plot_tree`、`get_story_thread`、`get_story_scene_context`、`get_chapter_plot`、`create_story_thread`、`update_story_thread`、`create_story_scene`、`update_story_scene`、`create_story_plot`、`update_story_plot`。所有工具都要求显式传 `novelId`；Thread/Scene 选择写入 `plot.selection`。
- 已迁移 `execute_sql` 到 v3 registry，保留单语句、安全关键字、读写事务、200 rows limit、1500ms timeout 和大小写提示。
- 已新增 v3 系统 profile：`writer`、`retrieval`，使用 TypeBox + `defineAgentProfile` + TSX DSL。
- 已更新 `leader.default`：allowed tools 包含 task/plot/SQL；默认 `<SkillCatalog />`；条件逻辑使用 `<If>`；恢复 Task Management、writer/retrieval、Plot System、SQL、Plan Mode active instruction。
- 已同步用户覆盖 `workspace/.nbook/agent/profiles/builtin/leader.default.profile.tsx` 为系统 profile wrapper，避免旧覆盖遮蔽系统迁移。
- 已让 `plot-tools` 和 config/prisma 相关路径按需加载，避免无 `DATABASE_URL` 的 harness 测试只因 import 工具或 config-service 就初始化数据库。

## Plan Deviations

- writer profile 没有恢复旧 `SimpleProfile`，但已恢复 v2 writing-styles / writing-references 的动态加载机制：`writer-writing-style` 与 `writer-writing-reference` 会优先读取系统/user `.nbook` profile assets，并把 `server/agent-v2/profiles/builtin/writing-styles`、`server/agent-v2/profiles/builtin/writing-references` 作为 fallback source。
- retrieval profile 保留了 v2 的“第一步内容节点元数据清单”流程，但未恢复旧 `SimpleProfile` helper；这是预期行为。
- plot 工具 schema 使用 TypeBox 手写 v3 tool schema，没有复用 v2 Zod schema；这是为了保持当前 v3 registry 形态。

## TODO / Follow-ups

- 后续可把 v2 `writing-styles` / `writing-references` 的默认资产正式复制到 `.nbook` 系统 assets；当前 helper 已支持 `.nbook` 覆盖与 v2 fallback。
- 后续可补 plot/SQL 的数据库集成测试；当前已有 typecheck、profile check、harness 和 task 工具单测覆盖。

## 2026-05-24 Profile Catalog / Skill Catalog Follow-up

### User Request

- 修正 catalog 语义：`SkillCatalog` 只展示 skills，新增 `AgentCatalog` 展示可创建/调用的 agent profiles。
- 补充 `WriterInputSchema` / `RetrievalInputSchema` 等字段 description，让 leader 能从 agent catalog 正确构造 `create_agent` input。
- 恢复 writer 对 `plotPoints` / `lorebookEntries` 的 v2 自动展开能力。
- 继续补齐 leader / writer / retrieval 的 v2 协议细节。

### Implementation Result

- `ProfilePrepareContext` 新增 `skills` 快照；harness 和 profile prepare preview 会同时传入 `profiles.snapshot()` 与 `skills.list()`。
- `SkillCatalog` 已恢复 skill-only catalog 语义：只渲染 `## Skill` 与 `## Available Skills`，数据来自 `.nbook/agent/skills` catalog，并支持 `when_to_use` frontmatter 摘要；当前已禁用独立 `skill` 工具，catalog 同时展示 key/name/location，Agent 按 location 用 `read` 打开对应 `SKILL.md`。
- 新增 TSX DSL string fragment `<AgentCatalog />`：渲染 `## Available Agents`，只展示 profile key、name、description 和 source；schema / allowed tools 详情改由 `get_agent_profile` 按需查询。
- Workbench/低代码编辑器已识别 `AgentCatalog` 节点：parser、JSX runtime、DTO、组件库、树规则、图标和样式均已同步。
- `leader.default` 的 `HistorySet` 现在同时注入 `<AgentCatalog />` 与 `<SkillCatalog />`；`retrieval` 保持只注入 `<SkillCatalog />`。
- `server/agent/profiles/builtin-contracts.ts` 为 leader / writer / retrieval 的 TypeBox schema 补齐 description。
- `writer.profile.tsx` 已恢复 v2 自动展开：
  - `plotPoints` 继续表示 Scene ID；传入时必须同时提供 `novelId`。
  - 通过当前 `plotFacade` 展开 Scene / Thread / Plots / Chapter Plot。
  - `lorebookEntries` 按 `priority` 排序，读取当前 `ctx.session.workspaceRoot` 下的内容节点 `index.md` 和可选 `state.md`。
  - 清洗 frontmatter，只暴露 writer 需要的字段，隐藏 retrieval / inject / visibility / private 字段。
- `writer` prompt 补回 v2 写作协议：content node rules、viewpoint boundary、char performance、paragraph rhythm、markdown dialect、polishing workflow、output protocol。
- `retrieval` prompt 补回 v2 检索协议：`retrieval.trigger` 语义、active 优先、rg retry 边界、refs 一跳扩展、walkthrough 一句话、不编辑文件、不 prose-only final answer。
- `leader.default` prompt 补回一批 v2 协作、workspace、内容节点、Plan Mode 和 shell/path 边界细则。

### Verification

- `bun scripts/check-profile.ts assets/workspace/.nbook/agent/profiles/builtin/leader.default.profile.tsx`：通过。
- `bun scripts/check-profile.ts assets/workspace/.nbook/agent/profiles/builtin/writer.profile.tsx`：通过。
- `bun scripts/check-profile.ts assets/workspace/.nbook/agent/profiles/builtin/retrieval.profile.tsx`：通过。
- `bunx vitest run server/agent/profiles/profile-dsl.test.ts server/agent/profiles/leader-assets-profile.test.ts server/agent/profiles/catalog.test.ts server/agent/skills/skill-catalog.test.ts`：通过，27 tests。
- `bun scripts/prepare-system-profile-metadata.ts`：通过，生成 4 个系统 profile metadata。
- 旧工具名扫描：系统/用户 profile 未命中旧工具名；只命中测试中的 `not.toContain(...)` 断言。

### Plan Deviations

- `SkillCatalogItem` 只做轻量 frontmatter 解析，没有完整 YAML parser；当前足够读取 `name`、`description` 和常见 string/list 形态的 `when_to_use`。如果未来 skill frontmatter 复杂化，再改为复用 `parseFrontmatterDocument()`。
- writer 的 plot 成功展开未在本轮做数据库集成测试；本轮覆盖了缺 `novelId` 的错误路径和 lorebook 文件展开路径，profile check 也通过。

## 2026-05-24 leader.default Prompt Cleanup Follow-up

### User Request

- 降低 `leader.default.profile.tsx` 内自定义 helper 函数数量；可复用 runtime 逻辑抽成通用 TSX DSL 节点。
- `<system-reminder>` 内尽量使用英语。
- 对照 v2 leader，恢复被压缩的 Plan Mode full/sparse/exit/reentry 文案，并继续检查提示词丢失。

### Implementation Result

- 新增一组通用 Profile DSL 节点：`SystemReminder`、`WorkdirReminder`、`ProjectWorkspaceReminder`、`PlanModeAvailabilityReminder`、`LinkedAgentsSummary`、`ProjectReminder`、`LinkedAgentsReminder`、`TaskReminder`、`PlanModeReminder`、`ActivePlanModeReminder`、`MentionedSkillsReminder`、`PlotFocusReminder`。
- `leader.default.profile.tsx` 已移除本文件内 runtime helper 函数，系统提示词改为 `LEADER_SYSTEM_PROMPT` 常量；cwd / Project Workspace / plan mode availability、linked agents、task、Plan Mode、plot focus、显式 `$skill` 提醒都由通用节点表达。
- `SkillCatalog` / `AgentCatalog` 的默认 `<system-reminder>` 文案改为英语；动态 reminder 文案也改为英语。
- `PlanModeReminder` 恢复 v2 的英文结构：`## Exited Plan Mode`、`## Re-entering Plan Mode`、`## Thread Work Directory`、`## Restrictions`、`## Workflow`，并补回 soft Plan Mode、当前 thread Markdown 工作目录、禁止 Explore agent、探索后报告、`request_user_input` 与 `exit_plan_mode` 边界。
- `leader.default` prompt 补回 v2 中缺失或被压缩的关键协议：`<system-reminder>` 标签语义、AGENTS.md 优先级、不要把建议下一步当批准执行、Inline Comment `id`、Task Management 不是小说事实、内容节点引用分流、`inject` / `retrieval.trigger`、manuscript `lorebook-notes` 边界、Plot 修改后连续性检查、workspace CLI 示例与 workdir 重复路径提醒。
- TSX Profile Workbench 已识别新增 DSL 节点，包括 DTO enum、source parser、组件库、树规则、图标和节点样式。

### Verification

- `bun scripts/check-profile.ts assets/workspace/.nbook/agent/profiles/builtin/leader.default.profile.tsx`：通过。
- `bun scripts/check-profile.ts assets/workspace/.nbook/agent/profiles/builtin/writer.profile.tsx`：通过。
- `bun scripts/check-profile.ts assets/workspace/.nbook/agent/profiles/builtin/retrieval.profile.tsx`：通过。
- `bunx vitest run server/agent/profiles/profile-dsl.test.ts server/agent/profiles/leader-assets-profile.test.ts server/agent/profiles/workbench-service.test.ts server/agent/profiles/catalog.test.ts server/agent/skills/skill-catalog.test.ts`：通过，36 tests。
- `bunx tsc --noEmit --pretty false`：通过。
- `bun scripts/prepare-system-profile-metadata.ts`：通过，生成 4 个系统 profile metadata。
- 旧工具名与 `{sessionId}` 扫描：系统 `leader.default.profile.tsx` 未命中；只命中测试里的 `not.toContain(...)` 断言。

## 2026-05-24 Agent Prompt / Tool Query Follow-up

### User Request

- `PlanModeReminder` 不能设计得太死；允许通过子节点自定义 full / sparse / exit / reentry 四种提示词。
- Agent bash 工具会自动把 user-assets 和 system Agent bin 加入 PATH，因此 `workspace node ...` / `workspace schema ...` 是 Agent 可直接运行的稳定入口。
- 修复 `execute_sql` 对 PostgreSQL camelCase 字段双引号规则的提示。
- 修复 `create_agent.input` 因 `Type.Unknown()` 导致模型传 JSON 字符串后 profile input parse 失败的问题。
- 将 `AgentCatalog` 收敛为索引，新增按需查询 profile schema 的工具。
- 重设计 `get_session`，默认不向模型返回完整 tree 或历史消息。

### Implementation Result

- `PlanModeReminder` 支持四个 slot 子节点：`PlanModeFull`、`PlanModeSparse`、`PlanModeExit`、`PlanModeReentry`。未提供 slot 时使用内置英文默认文案；提供 slot 时仍由 `PlanModeReminder` 读取 `agent.planMode`、选择 kind、包裹 `<system-reminder>` 并避免重复注入。
- Workbench/低代码编辑器已同步识别四个 Plan Mode slot 节点：DTO、parser、组件库、树规则、节点视图和可视化编辑器均已更新。
- `AgentCatalog` 现在只输出 `Available Agents` 索引，不再默认展开 schema 或 allowed tools；新增 `get_agent_profile(profileKey)` 工具返回单个 profile 的 description、allowedToolKeys、InputSchema、OutputSchema 和 report_result schema 摘要。
- `create_agent.input` 的模型可见 schema 已收紧为 JSON object；执行层仍将 `null/undefined` 转 `{}`，并保留 JSON string object 的 legacy fallback。array、number、boolean、普通字符串和 `key=value` 文本会返回清晰错误，并提示先调用 `get_agent_profile` 查看 InputSchema。
- `get_session` 默认只返回 metadata、activeLeafId、title、summary、usage 和 linkedAgents；不返回 tree，也不返回历史消息。显式传 `includeRecentMessages` 时，只返回当前 active path 的最近消息，并受 `recentMessageLimit` 与 `tokenBudget` 限制。
- `leader.default` / `leader.assets` allowed tools 已加入 `get_agent_profile`；leader prompt 明确创建或调用不熟悉 agent 前先查询 profile schema。
- `leader.default` / `retrieval` prompt 中的内容节点 CLI 示例统一使用 Agent runtime 命令 `workspace node ...` / `workspace schema ...`。
- `execute_sql` tool description、`SqlSchemaSummary` 附近提示和 leader prompt 均明确 PostgreSQL camelCase 字段必须双引号，例如 `"novelId"`、`"createdAt"`、`"sortOrder"`。

### Verification

- `bunx vitest run server/agent/profiles/profile-dsl.test.ts server/agent/harness/neuro-agent-harness.test.ts server/agent/profiles/leader-assets-profile.test.ts`：通过，44 tests。
- `bunx vitest run server/agent/profiles/workbench-service.test.ts server/agent/profiles/catalog.test.ts server/agent/skills/skill-catalog.test.ts`：通过，18 tests。
- `bunx vitest run server/agent/tools/task-tools.test.ts server/agent/tools/plot-tools.test.ts server/agent/tools/file-tools.test.ts server/agent/tools/approval.test.ts`：通过，17 tests。
- `bunx tsc --noEmit --pretty false`：通过。
- `bun scripts/check-profile.ts assets/workspace/.nbook/agent/profiles/builtin/leader.default.profile.tsx`：通过。
- `bun scripts/check-profile.ts assets/workspace/.nbook/agent/profiles/builtin/writer.profile.tsx`：通过。
- `bun scripts/check-profile.ts assets/workspace/.nbook/agent/profiles/builtin/retrieval.profile.tsx`：通过。
- `bun scripts/prepare-system-profile-metadata.ts`：通过，生成 4 个系统 profile metadata。
- workspace CLI 扫描：`leader.default.profile.tsx` 与 `retrieval.profile.tsx` 使用 `workspace node ...`，该命令由 Agent bin 注入 PATH。

### Plan Deviations

- `get_agent_profile` 作为通用内置工具实现，没有单独新增 API endpoint；本轮需求是模型工具查询 profile catalog，现有 HTTP detail API 仍服务 UI/Workbench。
- `server/agent/tools/*.test.ts` 在 PowerShell 下不会自动展开 glob，本轮验证改为显式列出四个现有工具测试文件。

## 2026-05-24 Skill Tool Disable And v2 Skill Migration

### User Request

- 核对 SkillCatalog / read 路线，避免 prompt 继续要求调用已禁用的 `skill` 工具。
- 检查并迁移当前 v2 已存在的 skills。

### Implementation Result

- 禁用当前 `skill` approval tool。`SkillCatalog` 展示 key/name/description/when_to_use/location，模型需要使用 skill 时用 `read` 打开 catalog location 的 `SKILL.md`。
- `leader.default`、`leader.assets`、`retrieval` 和源码 fallback profile 的 `allowedToolKeys` 均移除 `skill`；模型看得到 SkillCatalog，但只能通过通用 `read` 读取 catalog location。
- `MentionedSkillsReminder` / `ActivatedSkills` 已统一引导按 SkillCatalog location 读取 `SKILL.md`，并保持“不可见 skill 不要猜”的边界。
- 已把 `assets/agent-v2/skills` 下 12 个旧 skill 目录迁移到 `assets/workspace/.nbook/agent/skills`：番茄小说导入、角色设计流程、剧情规划流程、开局剧情设计、世界模拟、世界书初始化流程、爽文、小说初始化流程、小说灵感探索流程、skill-creator、skill-creator-zh、tsx-profile-editing。
- 已对迁移后的 `tsx-profile-editing`、`skill-creator`、`skill-creator-zh`、番茄小说导入做路径和术语校正，避免继续提示旧 `assets/agent/skills`、Zod、DynamicSet、read_file 或 execute_shell。

### Verification

- `bun scripts/compile-profile.ts assets/workspace/.nbook/agent/profiles/builtin/leader.default.profile.tsx`：通过，allowed tools 不含 `skill`。
- `bun scripts/compile-profile.ts assets/workspace/.nbook/agent/profiles/builtin/leader.assets.profile.tsx`：通过，allowed tools 不含 `skill`。
- `bun scripts/compile-profile.ts assets/workspace/.nbook/agent/profiles/builtin/retrieval.profile.tsx`：通过，allowed tools 为 `bash, read, report_result`。
- `bun scripts/prepare-system-profile-metadata.ts`：通过，更新 4 个系统 profile metadata。
- `bunx vitest run server/agent/skills/skill-catalog.test.ts server/agent/profiles/profile-dsl.test.ts server/agent/profiles/leader-assets-profile.test.ts`：通过，24 tests。
- `bunx vitest run server/agent/harness/neuro-agent-harness.test.ts server/agent/tools/approval.test.ts`：通过，28 tests。
- 搜索确认：active 系统 profile、`server/agent` builtin tools 和 harness 中无 `skill` 工具注册或 `allowedToolKeys` 声明；active prompt 文案不再包含 `skill({ ... })` 调用指令。

## 2026-05-24 Workspace CLI And Active Profile Visibility Follow-up

### User Request

- 不收紧 `get_session(sessionId)` 的读取权限，允许读取任意 sessionId。
- 修复 workspace CLI 不在 PATH 中导致 prompt 指导错误的问题。
- 确认实际运行的 `leader.default` 能看到 `get_agent_profile`，避免用户覆盖 profile 遮蔽系统新版。
- 将 writer writing style / writing reference 资源迁入 system assets。
- 将新小说 manuscript 模板从浅层单章升级为更规范的 volume / chapter 层级。

### Implementation Result

- 通过 `syncSystemAssetsToUserAssets()` 将未手改的用户覆盖 profile 同步到系统最新版；active `workspace/.nbook/agent/profiles/builtin/leader.default.profile.tsx` 现在包含 `get_agent_profile`，且不再包含旧 `skill` 工具。
- 更新 `.profile-sync-state.json` 与 `.system-profile-metadata.json`，让 `leader.default`、`leader.assets`、`writer`、`retrieval` 的系统 hash 和用户覆盖同步状态一致；同步结果不再报告 profile warning。
- 将 active profile 和相关 skill 中的内容节点 CLI 文案统一为真实可执行的 `workspace node ...` / `workspace schema ...` 形态。
- 将 v2 `server/agent-v2/profiles/builtin/writing-styles` 与 `writing-references` 复制到 `assets/workspace/.nbook/agent/profiles/builtin/writing-styles` 和 `writing-references`，writer 不再只能依赖 v2 归档目录兜底。
- 将新小说模板中的 `manuscript/001-opening/` 替换为 `manuscript/001-volume/001-chapter/`，并同步到 `workspace/.nbook/templates/novel-directory-templates` 用户模板副本。

### Verification

- `bun scripts/check-profile.ts assets/workspace/.nbook/agent/profiles/builtin/leader.default.profile.tsx`：通过。
- `bun scripts/check-profile.ts workspace/.nbook/agent/profiles/builtin/leader.default.profile.tsx`：通过，source root 为 `user`，allowed tools 包含 `get_agent_profile` 且不包含 `skill`。
- `bun scripts/check-profile.ts assets/workspace/.nbook/agent/profiles/builtin/writer.profile.tsx`：通过。
- `bun scripts/check-profile.ts assets/workspace/.nbook/agent/profiles/builtin/retrieval.profile.tsx`：通过。
- `bunx vitest run server/agent/profiles/leader-assets-profile.test.ts server/agent/profiles/profile-dsl.test.ts server/agent/harness/neuro-agent-harness.test.ts`：通过，47 tests。
- `rg -n "workspace node" assets/workspace/.nbook workspace/.nbook -g "*.md" -g "*.tsx"`：命中均为 Agent 可执行的 `workspace` bin 入口。
- writer assets 加载检查：system assets 中可加载 52 个 writing styles、1 个 writing reference，并包含默认 preset。

## 2026-05-24 Plan Mode Directory And Task Governance Follow-up

### User Request

- Project Workspace 内的 Plan Mode 计划文件统一放到 `.agent/plan/`，不按 session 分目录。
- v3 `exit_plan_mode` tool 支持附带 plan file preview。
- 更新 Project Workspace 模板，明确 `.agent/plan/` 用途；临时 scratch/cache 使用系统临时目录。
- 将仓库级 `docs/tasks` 改为 active 编号目录 + `docs/tasks/archived/` 归档区；按目录 LastWriteTime 归档三天前任务。

### Implementation Result

- 新增 Plan Mode 路径 helper：Plan Mode 目录固定为当前 Project Workspace 的 `.agent/plan/`。
- UI `/plan` soft toggle 和 `enter_plan_mode` / `exit_plan_mode` approval 状态写入同一份 `agent.planMode.workDirectory`。
- `exit_plan_mode` schema 增加可选 `planFilePath`；pending approval snapshot 会读取 `.agent/plan/*.md` 并向前端返回 `planFilePath` / `planContent`，复用现有 `AgentExitPlanModeBubble`。
- `PlanModeReminder` fallback、leader prompt、Project Workspace 模板文案均改为 `.agent/plan/`，并明确 scratch/cache 不放 Project Workspace `.agent`。
- Project Workspace 模板新增 `.agent/plan/.gitkeep`。
- `docs/tasks` active 目录改为 `01-...` 到 `06-...`；三天前任务移动到 `docs/tasks/archived/`，并更新文档索引与交叉链接。

### Verification

- `bunx vitest run server/agent/harness/neuro-agent-harness.test.ts server/agent/profiles/profile-dsl.test.ts server/agent/profiles/leader-assets-profile.test.ts server/workspace-files/workspace-files.test.ts`：通过，80 tests。
- `bunx tsc --noEmit --pretty false`：通过。
- `bun scripts/check-profile.ts assets/workspace/.nbook/agent/profiles/builtin/leader.default.profile.tsx`：通过。
- `bun scripts/check-profile.ts workspace/.nbook/agent/profiles/builtin/leader.default.profile.tsx`：通过。
- active `docs/tasks` 目录命名检查：通过，均符合 `^\d{2}-[a-z0-9-]+$`。
- 旧 `docs/tasks/<slug>/` 具体路径残留扫描：通过，无旧 active/archived slug 直链残留。

## 2026-05-24 Writer Contract Follow-up

### Current State Update

- writer 已从旧 `plotPoints + novelId + outputPath + lorebookEntries object[]` 硬切为 `chapterPaths + lorebookEntries string[]`。
- `leader.default` 的 writer 段落已改为“一章节一 agent”：调用方先创建章节内容节点，并在 Plot System 中把 Scene 挂到该 `chapterPath`；writer 只写显式传入章节的 `index.md`。
- retrieval 继续向 Leader 返回详细召回对象；Leader 调 writer 时只提取每项的 `path` 作为 `writer.lorebookEntries`。
- writing style/reference presets 已从 `agent/profiles/builtin/writing-*` 迁到 `agent/writing-presets/{styles,references}`，不再作为 profile 源码目录的一部分。
