# 96 - Session 标题所有权与 summarizer 策略调整

## 2026-07-12：通用运行策略统一

- Summarizer 改由 `runtimeDefaults.summarizer` 提供 Profile 出厂默认。
- Harness 按“系统默认 < Profile 默认 < Global 通用 < Global Profile < Project 通用 < Project Profile”解析最终策略。
- 自动摘要默认关闭；`leader.default` 与 `leader.assets` 通过 Profile 默认开启。手动 `/summarize` 忽略自动开关，但继续使用最终策略。
- `summarizer` system session 禁止递归摘要，并通过 Profile 默认关闭 Compaction。
- Config DTO 返回 Profile 默认、四层显式 patch 与最终有效值，设置 UI 可展示继承来源。
- 审查修复：Global/Project 通用 runtime defaults 已进入 dirty snapshot；仅修改通用策略也能保存。运行字段采用“空白继承、非法阻止保存”的局部校验，整数不再截断，percent/diff 边界明确。
- UI 按字段展示 Harness / Profile / Global / Project 的真实继承来源；清除当前覆盖会立即回落到排除本层后的继承值。
- Profile DSL 与 Config DTO 复用 shared 严格 schema，未知判别 kind、缺失 value、多余字段和非法范围均在定义期拒绝。

## 用户需求

1. session 支持手动改名，改名后 agent（summarizer / invoke title）不再自动覆盖标题。
2. summarizer 生成的 title/summary 可能不准，希望类似 Claude recap 的机制。
3. 第一次对话完毕自动生成 title+summary（现有首跑行为已满足）；用户改过 title 后 summary 不再覆盖 title，除非用户用 slash command 交还所有权。
4. 机制可配置：summarizer 需要能按 profile 禁用。

## 拍板决策

- **解锁语义**：UI 改名和 `/rename` 都锁定标题；专门的 `/summarize` 命令把命名权交还给 AI 并立即重新生成（用户选定的方案）。
- **空闲触发暂缓**：不做"离开一段时间后台自动 summary"，保留现有 16 轮（sourceInvocation interval）机制；idle 触发记入 PROJECT-STATUS TODO。
- **配置位置**：`agent.profiles[profileKey].summarizer.enabled`（Global/Project Config），Project 覆盖 Global；当前规则见文末 2026-07-11 收口：声明策略默认开启，未声明策略默认关闭。

## 实现

### 后端

- `server/agent/session/custom-state-keys.ts`：新增 `SESSION_TITLE_OWNER_STATE_KEY = "session.titleOwner"`，值 `{owner: "user" | "auto"}`，缺省视为 auto。
- `shared/dto/agent-session.dto.ts`：`AgentCommandRequestDtoSchema` 新增 `rename`（带 title）与 `summarize` 两个 command。
- `server/agent/harness/neuro-agent-harness.ts`：
  - `rename` 命令：projection 写 `session_update {title}` + titleOwner=user。
  - `summarize` 命令：写 titleOwner=auto、清掉 `summarizer.state` 的 fingerprint/lastError，强制 `scheduleSessionSummarizer` 立即重跑，返回 started。
  - `writeInvokeTitle`：owner=user 时跳过 invoke 传入的 title。
  - `runSessionSummarizerJob`：读取 effective config，`agent.profiles[key].summarizer.enabled === false` 时直接跳过（配置优先于 profile 源码默认）。
- `assets/workspace/.nbook/agent/profiles/builtin/summarizer.profile.tsx`：只读取 source dialogue 并通过 `report_result` 返回结构化结果；source session 的 titleOwner 与写回统一由 Harness 处理。

### 配置

- `shared/dto/config.dto.ts`：`ConfigAgentProfileMapDtoSchema` entry 新增 `summarizer: {enabled?}`；`ConfigAgentProfileSettingsDto.agentProfiles` 新增 `hasSummarizer`。
- `server/config/types.ts` / `normalizer.ts`：`AgentProfileSummarizerConfig` 类型；normalize/complete/effective 合并链路透传，project 覆盖 global。
- `server/config/config-service.ts`：`stripProfileResourceMutations` 保留 summarizer 字段（否则 project 保存会丢配置）；DTO 组装读取 catalog item 的 `hasSummarizer`。
- `server/agent/profiles/types.ts` / `catalog.ts`：`AgentCatalogItem` 新增 `hasSummarizer`（来自 profile.summarizer），避免 settings 接口额外 `profiles.get`（守住"只读取带 settings form 的 profile"契约）。

### 前端

- `AgentChatSurface.vue`：`/rename <标题>`、`/summarize` slash command；`renameSessionFromDialog`（prompt 弹窗改名）并 defineExpose。
- `AgentModeSessionSidebar.vue` / `AgentSessionDialog.vue`：session 条目 hover 操作新增重命名按钮（emit rename）。
- `app/pages/index.vue`：sidebar `@rename` 接线。
- `useStructuredReferenceMenu.ts`：命令菜单新增 rename / summarize 项。
- `NovelIdeAgentProfileModelSettingsPanel.vue`：声明了 summarizer 的 profile 展示"自动摘要"三态开关（继承/开启/关闭），Global/Project 两级。
- i18n：zh-CN / en-US 新增相应文案。

## 验证

- `bun test ./server/agent/harness/neuro-agent-harness.test.ts` 161 pass（新增用例：rename 锁定 → summarizer 只更新 summary → summarize 解锁并立即重跑）。
- `bun test ./server/config/ ./server/agent/profiles/profile-dsl.test.ts` 64 pass。
- `bun run typecheck` 绿。
- summarizer profile 重编译 + `prepare-system-assets --sync-user-assets`（updated profiles 1）。

## 与计划的出入

- 初版把 `hasSummarizer` 放在 config-service 里逐个 `profiles.get`，触发既有契约测试失败（settings 接口只允许对带 settings form 的 profile get）；改为在 catalog snapshot 层携带该信息，更系统。
- 空闲触发（idle debounce）按用户拍板暂缓，未实现。

## 2026-07-08 审查修复轮（code review 10 findings）

high effort code review 确认 10 个问题（9 CONFIRMED + 1 PLAUSIBLE），本轮系统性修复，不打补丁。两个新拍板：

- **D1（已由 2026-07-11 新决策取代）**：配置禁用只约束后台自动摘要；手动 `/summarize` 继续绕过禁用。现在未声明专用策略的普通 Profile 也可手动摘要，并使用系统默认策略。
- **D2**：`hasExitedPlan` 规格补充——途经 plan 后任何路径回到 normal（含 plan→discuss→normal 间接路径）都算一个计划周期结束，之后再进 plan 走 reentry；plan↔discuss 互切仍不算。已同步 Task 90 README。

### 修复内容

- **标题所有权共享解析器**：`custom-state-keys.ts` 导出 `SessionTitleOwnerState` 类型 + `readTitleOwner()`；harness 私有实现删除，summarizer profile 改 import 共享 helper（消除双解析器漂移）；rename/summarize 写入用 `satisfies` 约束。
- **summarizer force 机制**：`SessionSummarizerJob.forceRequested` + `scheduleSessionSummarizer(id, {force})`，替代原来"清 fingerprint"的 hack。force 跳过 `shouldRunSummarizer` 判定但保留 token 上限检查；在途 run 的 writeback 覆盖 fingerprint 也不影响 force 重跑（并发窗口关闭）。`/summarize` 命令重写为：预检 profile 声明 → 单 write plan 只写 titleOwner=auto → force 调度（挂 `.catch` 消除 unhandled rejection）。
- **配置禁用 gate 归位**：effective config 读取从 do/while 循环体提到 job 级缓存（每 job 一次，不再每轮 2 次读盘）；禁用时 `continue` 而非 `return`（保住运行中排队的 force 请求）；force 按 D1 绕过禁用。
- **normalizer 字段级合并**：`normalizeAgentProfileSummarizer` 非法/空输入返回 `undefined`（不再返回 `{}`）；effective 合并改 `project?.enabled ?? global?.enabled` 字段级——project 的空/非法值不再遮蔽 global 的禁用。`normalizeCompleteAgentProfiles` 补齐同一 normalize（原来裸透传）。
- **设置面板不丢覆盖**：summarizer 持久化门控从 `hasSummarizer && enabled !== null` 改为仅 `enabled !== null`——profile 编译失败（hasSummarizer=false）时保存其它设置不再丢掉已存的 `enabled:false`；`hasSummarizer` 只保留 UI 展示职责。
- **writeInvokeTitle 消除冗余读**：签名加可选 `context` 参数，两个调用点复用已读 snapshot，invoke 热路径少一次全量会话文件读。
- **前端 rename 收口**：`AgentChatSurface.vue` 提取共享 `renameSession()` 核心（UI 弹窗 / `/rename` slash 两处复用）；`/rename` 标题解析改 slice 保留内部空格；`/summarize` 包 try/catch + `notifyAgentError`（后端"未声明摘要功能"报错能显示给用户）。
- **visitedPlan 机制**（D2）：`agent.mode` state 新增 `visitedPlan` 字段（自上次回 normal 后是否进过 plan）；回 normal 时结算进 `hasExitedPlan` 并重置；`agentModeState` 是唯一写入点。
- 顺手修：summarizer profile hook 内两次 `ctx.session.read` 合并为一次。

### 验证

- `bun test ./server/agent/harness/neuro-agent-harness.test.ts ./server/agent/profiles/profile-dsl.test.ts`：188 pass / 1 fail（见下方"外部回归"）。新增用例：summarize 对未声明 summarizer 的 profile 报错且不解锁标题所有权；plan→discuss→normal 间接退出后再进 plan 走 reentry。
- `bun test ./server/config/`：41 pass（新增 normalizer summarizer 字段级合并 3 用例）。
- `bun run typecheck` exit 0。
- summarizer profile 重编译 + `--sync-user-assets`，与 workspace 副本 diff 一致。

### 与计划的出入

- **外部回归（非本任务引入）**：harness 测试 "Plan Mode 使用 Project Workspace .agent/plan 并支持 exit preview" 失败。根因是并行 Task 94 会话未提交的 `project-session.ts`（`project-resources.ts` 改名而来）在 `openProject` 里新增 `assertProjectWorkspaceDirectory` 校验——按**全局** `resolveWorkspaceContainerRoot()` 解析项目目录，而该测试的项目建在临时 workspaceRoot 下，invoke 在 pre_loop 阶段死于 404 "Project Workspace 不存在"，pending approval 从未产生。本任务改动不在失败路径上（错误来自 harness L697 的 ensure-open，先于 prepareRun）。修法（如测试用 `setWorkspaceAssetRootContextForTest` 对齐容器根，或 ensure-open 语义调整）应由 Task 94 会话决定，未代为修复——首次 open 还会跑 `initProjectDatabase` 等副作用，贸然给 163 个测试共用的 harness 套件引入 ProjectSession 生命周期风险不值当。
- configDisabled gate 初版写 `return`，自查发现会丢运行中排队的 force 请求（用户 `/summarize` 恰逢自动 job 在跑且配置禁用时会被吞），改为 `continue` + 循环条件加 `forceRequested`。
- config 测试首跑出现 1 次无关抖动（同一用例重跑三次全绿），未追根因。
- "配置禁用 + force 绕过"的 harness 集成测试未加（需在 harness 测试环境落 global config 文件，成本高）；由 normalizer 单测 + gate 代码路径覆盖，与计划中的预案一致。

## 后续 TODO

- 空闲一段时间后台自动 summary（idle debounce 触发），替代/补充现有 16 轮间隔机制。
- 浏览器验收：改名按钮、/rename、/summarize、设置面板开关（可让 agent 进行浏览器验证）。

## 2026-07-11 Profile 通用开关收口

- 所有普通 Profile 都可在 Global/Project 设置中配置 `summarizer.enabled`，设置卡不再由 `hasSummarizer` 控制可见性。
- `hasSummarizer` 只表示 Profile 是否声明专用执行策略：声明策略且无用户覆盖时默认开启；未声明策略时默认关闭。
- 用户显式开启未声明策略的 Profile，或手动执行 `/summarize` 时，使用系统默认策略：`summarizer` profile、16 个 source invocation 间隔、80,000 dialogue token 上限。
- Profile `summarizer` 声明只定义 profileKey、interval 和 token 上限等执行策略，不再包含静态 `enabled` 开关。
- hidden summarizer 的结果由 Harness 统一写回 source session：标题遵守 `session.titleOwner`，summary 始终更新；source leaf 在运行中变化时只标 dirty 并基于新 leaf 重跑。`systemRole=summarizer` session 不递归调度自身摘要。

### 2026-07-19 system-only creation boundary

- `summarizer` profile 声明 `capabilities.creation = "system_only"`。它的 `sourceSessionId`、system role 和 source-side `summarizer.state` 由 Harness 调度器共同建立，不能通过 `create_agent` 或公开 session API手动创建。
- 公共创建入口按通用 capability 拒绝，不硬编码 `summarizer` key；私有 `createSystemAgent()` 继续供摘要调度器创建隐藏 session。
- AgentCatalog 的可创建列表过滤 system-only profile；`get_agent_profile` / Workbench catalog 显式返回 creation capability，避免把“可加载、可检查”误解为“可公开创建”。
- 该边界同时阻止调用者伪造 `sourceSessionId`，借 summarizer settle hook 跨 session 写标题或摘要。
- 验证覆盖默认开关 resolver、普通 Profile 手动 summarize、interval、失败重试、leaf stale 重跑和标题所有权；摘要聚焦 7 tests、相关组合回归 11 files / 167 tests 与全仓 typecheck 通过。
- 等 Task 94 会话收敛后确认 "Plan Mode exit preview" harness 测试恢复绿。

## 2026-07-27：受管 Profile 写回漂移修复

- 生产受管 `summarizer.profile.tsx` 曾残留 `write-source-summary` 的 `settleRun` hook，而 Harness 测试默认使用的内存 summarizer 没有该 hook，形成生产 Profile 与测试 Profile 漂移。
- session 773 的两次失败均来自同一合同冲突：隐藏 summarizer invocation 实际属于 session 774，Profile hook 却在 `settleRun` 中直接写 session 773，因此被 `SessionWriteExecutor` 的 invocation ownership fence 正确拒绝。这不是偶发竞争，也不是门禁过严。
- 修复删除受管 Profile 的跨 session hook 及其专用 helper/import；隐藏 run 只产出 `report_result`，`settleSessionSummarizerResult()` 成为 source session 标题、摘要、用户标题锁和 leaf-stale 判定的唯一写回入口。
- ownership fence 保持不变，不为 summarizer 增加跨 session 例外。Harness 的正常写回、source leaf 运行中变化、用户手动标题锁三条用例均显式注册真实受管 Profile；正常写回用例同时断言 runtime 不含 `settleRun` hook，防止生产/测试再次漂移。
- 已重编译 `summarizer` 并同步 bundled/user assets；上述 3 条真实 Profile 聚焦回归通过。
