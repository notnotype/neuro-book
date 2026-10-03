# TSX Profile Workbench

> 2026-07-31 authoring/CLI 取代说明：下文 `assets/workspace/.nbook/agent/scripts/profile.ts` 与 `.output/server/scripts/**` 路径只表示历史实现。当前作者使用 `nbook/profile-sdk`；需要文风/参考预设能力时可显式使用正式 `nbook/profile-sdk/writing` 子入口。Agent 稳定入口是 `.nbook/agent/bin/profile`，Source checkout wrapper 调 Product-owned source entry，发行物通过 Task 130 的 Product Runtime Contract 解析 `profile` 逻辑命令，不保留旧路径 fallback。

## User Request

- 继续推进 TSX profile 这一块：先制定实现计划，再用 `$grill-with-docs` 对计划做术语和架构边界审问。
- 本阶段先立刻建立当前任务文档，把旧低代码 profile 工作台和当前 TSX profile runtime 的关系说清楚。

## Goal

- 为新的 TSX Profile Workbench 建立当前任务真相源。
- 跑通自定义 profile / agent 闭环：用户和 Agent 都能创建、编辑、校验、预览并运行自定义 `.profile.tsx`。
- 让 user-assets 入口重新具备 profile 管理能力，但不把旧 `profile-templates` / `user-profile-templates` 写入 API 作为新实现合同。
- 第一版采用 TSX 源码优先：外层入口负责 profile 可见性、选择、新建和 runtime 状态；Workbench 编辑器组件只负责编辑调用方传入的 TSX profile 文件路径，提供源码编辑、`ProfilePrompt` 可视化辅助编辑和真实 prepare 预览。通用文件导航、tab 和保存冲突处理继续复用 user-assets 文件树与编辑器基础设施。当前实现中独立 Workbench dialog 自带受控 profile 文件下拉，但它仍只扫描用户 profile 根，不扫描系统 profile。

## Current State

- 当前 Agent 主链路已切到 Pi-based `server/agent`，profile runtime 使用 `defineAgentProfile({ manifest, inputSchema, outputSchema, allowedToolKeys, context?, prepare?, ingest? })`。
- 当前 active v3 profile 底层输出是 `ProfileTurnPlan`：`systemPrompt`、`historyInitMessages`、`appendingMessages`、`modelContextAppendingMessages`、`modelContextMessages`、`stateWrites`。普通 profile 推荐写 `context(ctx) => <ProfilePrompt />`，由 `server/agent/profiles/profile-dsl.ts` 编译为 `ProfileTurnPlan`；高级 profile 可以直接覆写 `prepare(ctx) => ProfileTurnPlan`。`context` 与 `prepare` 不能同时存在。
- `ProfilePrompt` / `System` / `HistorySet` / `ModelContext` / `AppendingSet` / `FileChangeNotice` / `Compaction` / `CompactionPrompt` / `CompactionSummaryPrefix` / `Reminder` / `Watch` / `SkillCatalog` / `ActivatedSkills` 已成为 `server/agent` active profile 的可执行 TSX DSL。旧 `DynamicSet` 已硬切删除，model-only 分区统一使用 `ModelContext`。
- Profile 真相源是完整 `.profile.tsx` 单文件：
  - 系统 profile root：`assets/workspace/.nbook/agent/profiles`
  - 用户 profile root：`workspace/.nbook/agent/profiles`
- Workbench 的用户 profile 模式已切成两阶段：
  - 自动阶段只调用 `POST /api/agent/profiles/source-draft` 做轻量 TSX DSL tree 解析，不触发 `AgentProfileCatalog` / runtime profile loader。
  - 手动阶段由用户点击顶部“编译”按钮触发 `POST /api/agent/profiles/compile`，先保存当前源码，再只编译当前选中的用户 profile；真实 TSX profile 加载、detail 和可选 prepare preview 在后台 worker 中执行。
  - 顶部“编译全部”触发 `POST /api/agent/profiles/compile-all`，只编译 `workspace/.nbook/agent/profiles` 下的用户 profile，不编译系统 profile。
  - 顶部“预览”和旧“验证”语义使用 worker dry-run，只在临时 profile root 中编译当前编辑器源码，不写真实用户 `.compiled`。
  - “创建 Session”只有在最近一次编译通过且源码未再次修改时启用；保存文件本身不等于编译。
- `.compiled` 运行真相源已落地：普通 runtime catalog 只读 `.compiled/manifest.json` 与匹配的 `.compiled/*.mjs`，config snapshot、catalog、创建 session 和 invoke 都不会触发 TSX 编译。源码变更后 profile 会变成 `compile_stale`，必须通过 Workbench 或 `profile compile` 手动编译后才能运行。
- `user-assets` 是前端入口，挂载目标是 Workspace Root `.nbook`，即 `workspace/.nbook/`；它不是新的配置 scope，也不是嵌套资产根。
- `leader.default` 和 `leader.assets` 只是系统内置 agent key/name，不再表达 leader/subagent 架构分层。
- `InputSchema` / `OutputSchema` 使用 TypeBox / JSON Schema；旧文档中基于 Zod 的 Schema Builder 设计不是当前实现真相。v3 `InputSchema` 表示创建 agent/session 时传入的实例初始化参数，不承载每轮任务 prompt；每轮任务输入通过 `invoke_agent` 或 `/api/agent/sessions/:sessionId/invocations` 传递。profile contract 仍要求 `inputSchema` 字段存在；产品语义中的“InputSchema 为空”指 `InputSchema = Type.Object({})` 这类空对象 schema，表示这是普通 agent，没有特殊实例配置，创建后直接通过 invoke 对话即可。
- 当前保留并扩展的 profile API：
  - `GET /api/agent/profiles/catalog`
  - `POST /api/agent/profiles/detail`
  - `POST /api/agent/profiles/preview-prepare`
  - `GET /api/agent/profiles/files`
  - `GET /api/agent/profiles/templates`
  - `POST /api/agent/profiles/source`
  - `POST /api/agent/profiles/save`
  - `POST /api/agent/profiles/create`
  - `POST /api/agent/profiles/delete`
- 已按用户要求从 git 恢复旧 TSX profile preview 页面和关联组件：
  - `app/pages/tsx-profile-editor.preview.vue`
  - `app/components/profile-template-editor/**`
  - `shared/dto/profile-template.dto.ts`
  - `server/api/agent/profile-templates/**`
  - `server/api/agent/user-profile-templates/**`
- 恢复后的旧 route 文件在当前 HEAD 中仍是 `throwAgentV2Removed()` tombstone，不是真实可用实现；旧 AST/结构编辑服务在 `server/agent-v2/profile-templates/profile-template-service.ts` 归档中。实现时旧 API 直接删除，不做兼容层。
- 旧 `ProfileTemplateVisualEditor` 仍是当前 UI 基底：页面布局、视觉样式和主要交互已经调好，后续基于这个页面调整，而不是另起一套全新 UI。它依赖旧 `ProfilePrompt` tree、Zod Schema Builder、`leader/subagent` kind 和旧写入 API 的部分必须迁到新的 TypeBox / `.profile.tsx` / `server/agent` profile API。
- 旧版界面截图中的三栏布局继续作为 UI 基底：左侧组件库，中间 `ProfilePrompt` 可视化画布，右侧源码/属性/变量/运行时/Agent 面板，顶部保留 profile 选择、预览、验证、新建、保存等动作区。后续只围绕新 runtime contract 微调，不重做视觉结构。

## Walkthrough

- 已检查 `docs/tasks/02-pi-agent-harness-migration/README.md`，确认当前 profile runtime、assets root、TypeBox contract 和 user-assets 入口定义。
- 已检查旧 `docs/tasks/archived/user-assets-workspace/README.md` 与 `docs/tasks/archived/tsx-profile-template-editor/README.md`，发现其中仍保留旧 root、Zod、leader/subagent、低代码画布和旧 API 设计，只能作为历史背景。
- 当前计划先建立新的 focused walkthrough，然后继续 grill 以下决策：
  - Workbench 第一版是源码优先，还是恢复低代码画布。
  - Workbench 是否自己内置源码编辑器，还是复用 user-assets 文件编辑器。
  - 系统 profile 的“编辑”语义是直接修改系统文件，还是复制为用户覆盖。
  - 新建 profile key 是否继续限制 `leader.*` / `subagent.*`。
  - 默认 profile 设置是否属于 Workbench。
  - 坏 TSX 文件是否允许保存。
  - Schema Builder 是否进入第一版。
- 已恢复并阅读旧 `tsx-profile-editor.preview` 相关代码，结论：
  - 独立 preview 页面只挂载 `ProfileTemplateVisualEditor mode="system-template"`。
  - `UserProfileWorkbenchDialog` 会挂载 `ProfileTemplateVisualEditor mode="user-profile"`，但当前 Header/Page 挂载点仍未恢复。
  - `ProfileTemplateVisualEditor` 的 user-profile 模式已经尝试接入新 `/api/agent/profiles/catalog/detail/preview-prepare`，但仍调用旧 `/api/agent/user-profile-templates/*` 保存、创建、恢复和 schema 更新接口。
  - 当前 `shared/dto/agent-profile.dto.ts` 已移除旧 `AgentProfileSchemaFieldDto`、`AgentProfileDetailDto.root` 和旧 template variable DTO 继承；旧编辑器若直接进入 active build 会出现类型/运行合同不匹配。
  - “旧画布编辑”改称 `ProfilePrompt` 可视化辅助编辑：它指 `ProfileTemplateVisualEditor` 左侧组件库 + 中间拖拽节点树 + 右侧 Inspector 对 `ProfilePrompt` JSX 的查看和编辑能力。它只适用于能稳定解析出 `ProfilePrompt`/节点树的源码区域；不适用于任意 TypeBox profile 的全部 TSX 逻辑。
- 已按用户要求复查旧 `server/agent-v2/profiles/builtin/leader-default.profile.tsx`、`reference/agent/context.md` 与 `docs/tasks/02-pi-agent-harness-migration/README.md`：
  - v2 旧 leader 的 `buildLeaderDefaultPrompt(ctx)` 通过局部变量构造 `historySet`、`dynamicSet`、`appendingSet`，最后返回 `<ProfilePrompt>{historySet}{dynamicSet}{appendingSet}</ProfilePrompt>`。
  - v2 `ctx.input.prompt` / `<Message source="input">` 是旧直接 prompt 模式的输入写入策略；v3 已把 `InputSchema` 收窄为 agent 实例初始化参数，不能把它当作默认模板的每轮任务 prompt。
  - v3 prompt / continue 的用户消息由 session invocation 入口写入，profile 负责围绕 session history 生成 system / dynamic / appending 上下文，不默认伪造或搬运 `ctx.input.prompt`。
  - 因此模板不能默认声明 `{ prompt: string }`，也不能默认把 `ctx.input.prompt` 放进 appending 区；是否把实例初始化字段渲染进上下文由 profile 作者决定。
- 已核对 TypeBox 当前行为：`Type.Object({})` 默认允许额外字段，`Value.Check(Type.Object({}), { extra: "x" })` 为 true，`Value.Parse` 会保留额外字段。只有显式写 `Type.Object({}, { additionalProperties: false })` 时才拒绝额外字段。对 Workbench 来说，`Type.Object({})` 更像“无已知字段约束”，不是“禁止传任何字段”。
- 已核对当前 `report_result` 工具 schema 仍要求 `result: string` 并允许可选 `data`；这和本任务新决策中的“空 OutputSchema + report_result 只要求 walkthrough”还不一致。后续实现阶段需要同步调整 `report_result` 工具 schema、collector 和 profile 输出校验，不把当前工具合同当作最终设计。
- 已实现第一版 `report_result` 动态 schema：模型可见工具参数由目标 profile 的 `OutputSchema` 派生；空 `OutputSchema = Type.Object({})` 只暴露 `walkthrough`，非空 `OutputSchema` 暴露 `walkthrough + data`，并在工具执行时用 TypeBox 校验 `data`。
- 已实现第一版用户 profile 源码 API：runtime catalog 只返回可加载 profile，坏文件通过 `files/source/save` 按 `fileName` 读取、保存和诊断。
- 已实现两个系统模板：`assets/workspace/.nbook/agent/profile-templates/basic-agent.profile-template.tsx` 与 `report-agent.profile-template.tsx`。模板只做 key/name/description/systemPrompt 占位替换，不引入模板引擎。
- 已把 `ProfileTemplateVisualEditor mode="user-profile"` 切到新 `/api/agent/profiles/*` 写入 API。旧 `profile-templates` / `user-profile-templates` tombstone route 仍保留 501 helper，避免开发服务器启动期 import 崩溃；普通 user profile 工作台不再依赖这些旧写入 API。
- 第一版可视化辅助编辑已从旧 `systemPrompt` / `renderSystemPrompt()` range 升级为解析 `context()` 返回的 `<ProfilePrompt>` TSX DSL tree。源码仍是真相源，复杂 prompt/helper/schema/工具逻辑继续走源码编辑；画布写回只替换已定位的 `ProfilePrompt` JSX 片段。
- Prepare Preview 现在展示 `systemPrompt`、`history`、`modelContext`、`modelContextAppending`、`appending`、`compaction`、`stateWrites` 与 `reactMessages`。`reactMessages` 与真实 Harness 共用顺序组装器：非空 session 不重复注入 HistorySet，ModelContext 普通消息先进入 model-only 分区，随后是 ModelContext 动态追加与 AppendingSet，真实 CurrentUserInput 始终位于最后。`FileChangeNotice` 在 dry-run 中只显示运行时占位消息，不读取真实 history。
- 已把 user-assets 顶部 Header 的 Agent 按钮旁接入 Profile 工作台入口，挂载 `UserProfileWorkbenchDialog`；默认打开用户资产中的 `builtin/leader.assets.profile.tsx`。
- 已把 `/tsx-profile-editor.preview` 调试页切到 `ProfileTemplateVisualEditor mode="user-profile"`，不再默认触发旧 `profile-templates` tombstone API。
- 已把 user-profile 模式下的源码解析、预览和显式验证改为基于当前编辑器源码：服务端在 `.agent/workspace/profile-source-check/*` 临时 user profile root 中覆盖当前文件，再走真实 catalog/detail/prepare 链路，不污染 `workspace/.nbook/agent/profiles`。
- 已修复第一版可视化辅助编辑的写回边界：画布编辑只替换已定位的 `<ProfilePrompt>` JSX 片段，不再走旧 editable `systemPrompt` 文本源码 range。写回时会过滤 `status`、`previewText` 等低代码内部展示属性，`ToolCall` 正文写回为 runtime DSL 的 `args` prop，`If.condition` 默认保留为 TSX 表达式。
- 坏 profile 文件按 `fileName` 读取时会尽量保留 catalog loader 的真实 diagnostics；只有没有匹配 issue 时才回落到 `load_failed`。
- 已把 Workbench 自动编辑阶段从真实 profile 编译链路中拆出：
  - `GET /api/agent/profiles/files` 只扫描用户 profile root 并用源码正则读取 manifest 摘要，不调用 runtime catalog。
  - `POST /api/agent/profiles/source-draft` 只解析源码中的 `context() => <ProfilePrompt />` 稳定 DSL tree，不加载 `.profile.tsx` 模块。
  - 保存和新建用户 profile 返回轻量 draft detail，不自动跑完整 runtime 编译。
- 已新增手动后台编译链路：
  - `POST /api/agent/profiles/compile` 接收 `fileName`、可选源码快照、`preview`、`sessionId` 和 input overrides；如果带源码，endpoint 会先保存源码，再由 worker 编译磁盘文件。
  - `server/agent/profiles/profile-compile-worker.ts` 维护单例 long-lived worker、串行队列和同 `fileName` stale 等待任务。
  - worker 内调用共享 artifact compiler 写入用户 profile root 的 `.compiled`，再走真实 runtime detail 和可选 `previewAgentProfilePrepare()`。
  - worker 崩溃会结构化失败当前任务，并重建后续 worker。
- 已完成 review 修复：
  - 前端手动编译捕获提交时的 `fileName/source` 快照；如果编译期间用户继续编辑或切换文件，旧结果返回后只标记 `stale`，不会把新源码误判为“编译通过”。
  - worker crash / dispose 不再让 compile endpoint 抛 rejected promise；当前任务和等待任务都会 resolve 为 `ok:false`、`code=compile_worker_failed` 的结构化 issue。
  - 旧源码覆盖编译不再写全局 `.agent/workspace/profile-module-cache`；当前运行合同已经收敛到 profile root 内 `.compiled`。
- 已修复 Workbench 编译按钮语义：
  - 顶部“编译”已从旧 `validate` 事件拆成真实 `compile` 事件，会调用 `/api/agent/profiles/compile`。
  - 顶部新增“编译全部”，会调用 `/api/agent/profiles/compile-all`，后台 worker 在全量任务到来时会 stale 掉等待中的单文件任务，避免旧 manifest 覆盖全量结果。
  - “编译全部”也会先保存当前正在编辑的源码；保存失败或保存后源码继续变化时不会静默跳过，而是给 notification。
- 已修复 Agent Drawer 的 session snapshot 错误可见性：
  - `GET /api/agent/sessions/:id` 失败会通过 `resolveApiErrorMessage()` 解析后端 message 并弹出 notification。
  - `syncActiveSessionSnapshot()` 改为内部捕获错误并返回 boolean，避免 snapshot 失败在 invoke / session 切换后静默吞掉或打断原本的错误展示。
- 已完成 `.compiled` 运行真相源实现：
  - 新增共享 artifact compiler，使用 esbuild bundle 生成 profile root 内 `.compiled/*.mjs` 与 `.compiled/manifest.json`；repo-local 代码打进 artifact，Node builtins 和 `node_modules` external。
  - `AgentProfileCatalog` 删除普通 runtime 路径里的自动 TSX 编译，只加载 fresh compiled artifact。
  - 系统 `.compiled` 由 `scripts/prepare-system-profile-metadata.ts` 生成，并接入 `dev` / `build` / `nuxt:build`。
  - Workbench 编译按钮保存源码后进入后台 worker，worker 写用户 root `.compiled`；保存和预览都不会改变运行可用状态。
  - 新增 Agent runtime `profile status/check/compile/preview` CLI，系统 wrapper 位于 `assets/workspace/.nbook/agent/bin/profile`。
  - 删除旧 `scripts/compile-profile.ts`、`scripts/check-profile.ts`、`scripts/profile-compile-cli.ts`；项目根 `scripts/build/profile.ts` 是开发 convenience 入口。

## Decisions

- 新任务真相源是本文档；旧 `user-assets-workspace` 和 `tsx-profile-template-editor` 文档只作为历史背景，后续如引用必须先对照本文档和 `pi-agent-harness-migration`。
- Profile Workbench 第一版不恢复旧低代码写入 API；旧 `profile-templates` / `user-profile-templates` API 直接删除，后续根据 v3 profile 经验重新设计新的 `/api/agent/profiles/*` 写入 API。
- Profile Workbench 编辑器是 profile 专用编辑器；它只编辑调用方传入的 TSX 文件路径，可以直接源码编辑，也可以通过 `ProfilePrompt` 可视化辅助编辑查看、编辑 TSX 文件中可解析的 prompt 区域。后续如接 LSP，类型信息可能不完整，不能把 LSP 当作第一版必需前提。
- Workbench 编辑器不决定“用户能看到哪些 profile”，也不内置系统 profile 扫描策略；profile 列表、可见性、默认选择和入口权限由调用方/外层容器负责。实现时需要拆分外层 host 与可复用编辑器组件，避免把 catalog 选择逻辑塞进编辑器。
- Profile Workbench 不复制一套通用文件 IDE；通用文件树、tab、Monaco 承载和保存冲突处理继续复用 user-assets 既有基础设施。
- Workbench 编辑器不允许编辑系统 profile。user-assets 同步会自动把需要的系统 profile 复制到用户资产，因此正常情况下 `leader.assets` 这类 profile 会以用户资产文件形式出现；不再提供显式“创建用户覆盖”动作。
- Profile Workbench 不承担默认 profile 配置；默认 profile 仍归 Config/设置页。
- 保存文件和 profile 可运行性分离：允许保存编译失败或契约失败的 TSX 文件；自动解析只展示轻量 DSL/source issue，手动“编译”展示 runtime detail / prepare issue，运行同 key profile 前必须有一次最新源码对应的编译通过结果。
- “运行前必须编译”已从 Workbench UI 状态推进到 runtime catalog 硬合同：`.profile.tsx` 源码是编辑真相源，`.compiled` 产物是运行真相源。所有普通 runtime API 只读取已编译产物，不再在 `profiles.snapshot()`、`profiles.get()`、设置页、创建 session 或 invoke 时自动把 TSX 源码编译成 JS。
- `.compiled` 目录放在各 profile root 内，而不是 `.agent` 临时目录：
  - 系统 profile：`assets/workspace/.nbook/agent/profiles/.compiled/`
  - 用户 profile：`workspace/.nbook/agent/profiles/.compiled/`
  - `.agent/workspace/profile-module-cache` 已退出 runtime 合同；当前 catalog signature 和运行可用性只看 profile root 内 `.compiled`。
- `.compiled/manifest.json` 是 runtime 可信索引，记录 `fileName`、`profileKey`、源码 hash、稳定编译产物路径、artifact hash、依赖 hash、compiler/cache version 和生成时间。catalog 只能在 manifest 中的源码 hash、artifact hash 与当前 `.profile.tsx` / `.mjs` 匹配时 import 对应 `.mjs`；import 仍使用 artifact hash query bust Node ESM cache。
- profile 源码变更后不自动编译；catalog 应把该 profile 标记为 `compile_stale` 或 `not_compiled`，并阻止创建 session / invoke 使用它，直到用户或构建脚本显式编译。
- 系统 profile 在构建/开发启动阶段预编译：`bun run build`、`bun run nuxt:build` 和 `bun run dev` 会先生成系统 profile 的 `.compiled` 产物。Docker runner 复制 `assets` 时会带上系统 `.compiled`。
- 用户 profile 不能依赖镜像构建时预编译，因为生产 `workspace/` 通常是运行时挂载。用户 profile 的 `.compiled` 产物由 Workbench 手动“编译”或管理员 CLI 显式生成；保存源码不等于应用到 runtime。
- Workbench 操作语义已收敛为：
  - `保存`：只保存 `.profile.tsx`，保存后若源码 hash 与 `.compiled` manifest 不一致，则状态为“源码已修改，需编译”。
  - `编译`：保存当前源码并在后台 worker 中生成 `.compiled` 产物和 manifest；成功后 profile 才可运行。
  - `预览`：可以 dry-run 当前编辑器源码，但不写 `.compiled`，不改变 runtime 可运行状态。
  - `创建 Session`：只在 `.compiled` manifest 与当前源码 hash 匹配且 artifact 可 import 时启用。
- runtime catalog 状态需要区分：
  - `loaded`：compiled artifact 存在、manifest hash 匹配、import 成功。
  - `not_compiled`：有源码但没有 compiled artifact。
  - `compile_stale`：compiled artifact 存在但源码或依赖 hash 已变化。
  - `compiled_load_failed`：manifest/artifact 存在但 import 失败。
  - `source_error`：源码文件不可读或轻量文件级诊断失败。
- `.compiled` artifact 采用 esbuild bundle：
  - repo-local profile runtime/helper 代码可以 bundle 进产物，降低运行时解析成本。
  - `node_modules` 依赖和 Node builtins 保持 external，避免把大型依赖复制进每个 profile artifact。
  - artifact 文件名使用稳定 stem，例如 `builtin/leader.default.profile.tsx` 生成 `builtin__leader.default.mjs` 和 `builtin__leader.default.types.d.ts`；hash 留在 manifest 和 import query 中，不再放进文件名。
  - artifact 必须记录 compiler version / cache version / source hash / artifact hash / dependency hash；hash 不匹配时 runtime 不 import。
  - 用户 profile 仍是受信任的本地代码，本轮不引入 sandbox。
- 系统 `.compiled` 产物属于 system assets：
  - `bun run dev`、`bun run build`、`bun run nuxt:build` 在启动或构建前预编译系统 profile 一次，形成热态缓存。
  - Docker / 生产镜像复制 `assets` 时也携带 `assets/workspace/.nbook/agent/profiles/.compiled/`。
  - dev/build 只预编译系统 profile，不监听源码变化自动重编译；系统 profile 修改后需要重新运行显式编译或重启构建链路。
  - 系统 profile / variable definition manifest 是 tracked 发布产物；prepare 脚本在内容未变化时保留原 `generatedAt`，部署脚本也会在 `git pull` 前 targeted restore 这些可再生成文件，避免远端 checkout 因无意义 generated diff 阻塞。
  - `bun run dev` 会在系统 prepare 后同步未手改 user-assets；用户覆盖层仍优先运行，但源码、manifest、artifact 会作为整体对齐，已手改 profile 不会被 dev 自动覆盖或编译。
- 用户 `.compiled` 产物属于 user-assets：
  - 用户产物写入 `workspace/.nbook/agent/profiles/.compiled/`，不进入 Git。
  - 生产环境通常挂载运行时 `workspace/`，因此用户 profile 不可能依赖镜像构建时预编译。
  - 已存在的手改用户 profile 或缺少 sync state 的用户覆盖不自动编译、不自动覆盖；catalog/detail 只提示 `not_compiled` / `compile_stale` / shadow warning，用户通过 Workbench 或 CLI 手动编译。
- 系统 profile 同步到 user-assets 时也同步匹配的 `.compiled` artifact：
  - 用户文件缺失时复制系统源码与对应 compiled artifact，并写入 sync state。
  - 用户文件未手改且系统 hash 更新时，自动覆盖源码和 compiled artifact。
  - 用户文件已手改或缺 sync state 时，保留用户源码和用户 compiled artifact，不静默替换。
  - 系统/用户 `.compiled` 现在使用稳定文件名；编译会清理 manifest 未引用的旧 hash artifact，避免 Git 与本地目录持续堆积历史产物。
- 新 Agent runtime CLI 统一为 `profile` 命令，不继续把仓库根 `scripts/` 当成用户/Agent 面向入口：
  - `profile status`：查看源码、compiled manifest、stale/not compiled/load failed/sync warning。
  - `profile check`：检查磁盘上的 profile 源码和 contract，不写 `.compiled`。
  - `profile compile`：只编译已保存到磁盘的源码，写入 `.compiled` artifact 与 manifest。
  - `profile preview`：dry-run 当前已保存源码的 `prepare()`，展示 `systemPrompt`、HistorySet、AppendingSet、ModelContext、stateWrites、最终 ReAct messages 和 `report_result` schema，不写 `.compiled`。
  - 旧 `scripts/compile-profile.ts`、`scripts/check-profile.ts`、`scripts/profile-compile-cli.ts` 已删除，不保留旧别名；`scripts/prepare-profile-types.ts` 如只服务动态 typegen 可以保留。
- `leader.assets` 与 `profile-system-guide` 后续要跟随新心智更新：
  - 主提示词只放普通用户能理解的 profile 心智，不塞 `.compiled/manifest.json` 的深层细节。
  - 明确“保存 profile 源码不等于可运行”；需要 Workbench 编译或 `profile compile`。
  - 提醒 CLI 可完成 `profile status/check/compile/preview`。
  - 移除手工调用 HTTP compile endpoint、`bun scripts/compile-profile.ts`、`bun scripts/check-profile.ts` 作为用户操作建议。
- Runtime profile catalog 面向可被 profile/runtime 使用的 agent 列表，不承担“坏文件浏览器”职责。坏 `.profile.tsx` 文件不进入运行时 catalog；外层入口如需修复坏文件，应通过文件清单/diagnostics 按 `fileName` 调用 Workbench 编辑器打开源码。
- 自定义 profile / agent 是第一版成功标准，不再只做 builtin profile 浏览或系统 profile 覆盖。
- 保留 `tsx-profile-editor.preview` 独立 debug page，并基于当前已调好的 `ProfileTemplateVisualEditor` 页面继续调整。
- 第一版需要 UI 新建自定义 profile，生成 TypeBox `defineAgentProfile` 骨架。新建入口推荐 `agent.<slug>` 命名，但不强制限制 profile key 必须符合该格式。
- 新建 profile 默认文件名使用 `<profileKey>.profile.tsx`，例如 `agent.my-helper.profile.tsx`；目录只作为人为分组，不默认把点号拆成目录层级。
- 自定义 profile 创建后必须能立即创建 session 并运行，含义是新文件 contract 正确时可立刻进入真实 runtime 链路：文件写入 `workspace/.nbook/agent/profiles` 后，catalog 能发现并加载它，detail/preview 能按该 `profileKey` 读取 schema 与 prepare 结果，随后 `POST /api/agent/sessions` 可用同一个 `profileKey` 和可选 `input` 创建 session。UI 新建成功后不自动创建 session。
- Workbench 的 profile 写入、保存等变更 API 统一使用 `fileName` 定位文件，避免坏 TSX 缺失 `manifest.key` 时无法修复。运行和 preview 仍使用已加载 profile 的 `profileKey`。
- Workbench 编辑器不接受绝对路径。调用方只能传受控 profile root 下的相对 `fileName`；开发调试入口也应通过受控 source/root + relative fileName 打开。
- TypeBox Schema Builder 后续重新设计；第一版只做 schema 只读展示和骨架生成，不恢复旧 Zod Schema Builder，也不做旧 builder 兼容迁移。
- `ProfilePrompt` 可视化辅助编辑保留为可复用 UI 能力，用于查看、编辑 TSX 文件中可解析的提示词区域；第一版不能依赖它覆盖完整 `.profile.tsx`。
- `ProfilePrompt` 可视化辅助编辑以源码为真相源；解析失败时源码编辑仍可保存，可视化区降级为空态或最近一次成功解析结果。
- 可视化辅助编辑保存时只局部替换已定位的提示词源码 range，参考旧可视化编辑器与旧任务文档的 AST/round-trip 经验；helper function、schema、imports、allowed tools 和 prepare 外围逻辑保留源码编辑。若后续模板采用 v3 `systemPrompt` 字符串或对象 DSL，则替换边界应落在该结构的源码 range，而不是强行寻找不存在的 `<ProfilePrompt>`。
- 第一版提供模板 TSX 文件用于新建 profile。所有模板都显式导出 `InputSchema`、`OutputSchema`、`Input` 和 `Output`；“空 OutputSchema”用 `OutputSchema = Type.Object({})` 表达，不省略 schema 常量。普通 agent 的 `OutputSchema = Type.Object({})` 且不允许 `report_result`；通用报告 agent 的 `OutputSchema = Type.Object({})` 且允许 `report_result`。
- 第一版模板必须清楚展示 `InputSchema` 语义，但普通模板默认使用空对象 schema。`profile.inputSchema` 不应为空；`InputSchema = Type.Object({})` 是“无特殊实例配置”的源码表达，UI/API 可以不传 `input`，运行时会按 `{}` 校验。
- 模板使用 active TSX DSL 表达 system prompt：`context() { return <ProfilePrompt><System>{renderSystemPrompt()}</System></ProfilePrompt>; }`。不把 provider 级 system prompt 写进 JSX `<Message role="system">`；`Message role="system"` 在 runtime 中会报 contract error。
- 不使用 `<Message role="system">` 表达 provider 级 system prompt 的原因：Pi/当前 v3 的 provider 入口是 `Context.systemPrompt?: string`；迁移文档已决定不 fork Pi 的 message union 去加入中间 `SystemMessage`。如果后续重新引入 JSX DSL，也应先设计一个 active runtime 可执行的 `SystemSet` / prompt builder，而不是在模板里临时创造特殊节点。
- 模板固定导出 `profileManifest`，推荐形态是 `export const profileManifest = {...} as const`，再传入 `defineAgentProfile({ manifest: profileManifest, ... })`。这样 Workbench 能稳定定位并辅助编辑 key、name、description，不需要在 `defineAgentProfile()` 的对象字面量里做脆弱匹配。
- 模板固定导出顶层 `allowedToolKeys` 数组，推荐形态是 `export const allowedToolKeys = [...] as const`。工具 checklist 第一版只编辑这个稳定数组；如果用户改成复杂表达式，Workbench 降级为只读展示和源码编辑，不尝试重写表达式。
- 模板默认 `context()` 保持最小，只声明 `System`，不默认塞入 `ModelContext` / `AppendingSet`。是否把 Workspace、history、实例 input 或 invocation 内容渲染进上下文由 profile 作者决定。
- `ProfilePrompt` 可视化辅助编辑第一版承诺编辑稳定的 TSX DSL tree：`ProfilePrompt`、`System`、`HistorySet`、`ModelContext`、`AppendingSet`、`Compaction`、`CompactionPrompt`、`CompactionSummaryPrefix`、`Message`、`AIMessage`、`ToolCall`、`ToolResult`、`Reminder`、`Watch`、`If`、`SkillCatalog`、`ActivatedSkills`。复杂 TypeScript helper、schema、imports、allowed tools 和无法稳定 round-trip 的 `Watch.render` 继续源码编辑。
- `InputSchema` 和 `OutputSchema` 产品语义上都可以为空，但源码模板仍显式导出 schema 常量：
  - `InputSchema` 为空表示源码中导出的 `InputSchema = Type.Object({})`，也就是普通 agent，没有特殊实例配置；创建 session 时可不传 `input`，任务通过 invoke 对话传入。
  - `OutputSchema` 为空表示源码中导出的 `OutputSchema = Type.Object({})`。
  - `OutputSchema = Type.Object({})` 且允许 `report_result`，表示该 agent 仍走 report 完成协议，但 `report_result` 参数只有一个通用 `walkthrough`，没有特别结构化参数限定。
  - `OutputSchema = Type.Object({})` 且不允许 `report_result`，表示不走 report 完成协议，`invoke_agent` 按普通 completion / finalMessage 处理。
  - `OutputSchema` 非空时，`report_result` 的结构化 payload 按该 schema 校验。
- 空 `OutputSchema` 不等于 warning。是否要求 report 完成协议由 `allowedToolKeys` 是否包含 `report_result` 决定；`OutputSchema` 只决定 report payload 是否有额外结构约束。
- `report_result.data` 可以做类型标注：实现阶段应按当前运行目标 profile 的 `OutputSchema` 动态派生模型可见 tool schema。`OutputSchema = Type.Object({})` 时 schema 只有 `{ walkthrough: string }`；非空 `OutputSchema` 时 schema 是 `{ walkthrough: string, data: OutputSchema }`，其中 `data` 必填并由 TypeBox 校验。这样模型在调用工具时能看到 `data` 的 JSON Schema，而不是依赖提示词描述。
- 模板必须导出 `OutputSchema`，即使它是 `Type.Object({})`。不推荐导出的是另一份手写的 `report_result` 参数 schema 或 `ReportResultSchema`：`report_result` 的模型可见参数应由当前目标 profile 的 `OutputSchema` 和 `allowedToolKeys` 动态派生，避免 `OutputSchema`、工具 schema 和 UI 展示形成多个真相源。
- `/tsx-profile-editor.preview` 面向开发者和调试，不作为普通用户主入口。
- Workbench 编辑器本身不内置 profile 文件清单；user-assets 外层入口如需提供列表，只扫描用户 profile 根 `workspace/.nbook/agent/profiles`，不扫描系统级 profile。调用方可以直接指定一个受控相对文件打开，用于开发调试或特定入口。
- Profile Workbench 是通用 TSX 低代码编辑器的产品化调用方；已调好的旧可视化编辑器 UI 作为基底，只做适配新 TypeBox profile/runtime 的微调，不重新设计 UI。所谓“复用旧解析服务”只是实现层是否迁移旧 AST/round-trip 逻辑的问题，不改变 UI 基底。
- “文件源码详情”是区别于 runtime detail 的概念：坏 `.profile.tsx` 无法作为 runtime profile 加载时，仍可以按 `fileName` 读取源码、展示 diagnostics，并尝试解析可视化 `ProfilePrompt` 片段。
- 模板 TSX 文件放在系统 assets 的非 runtime profile 目录，例如 `assets/workspace/.nbook/agent/profile-templates/*.profile-template.tsx`；模板不是可运行 profile，不进入 `agent/profiles` catalog。
- 新建 profile 从模板生成时只做少量占位替换：`profileManifest.key`、`name`、`description` 和初始 system prompt 文本；不引入复杂模板引擎。
- 新建模板贴合 active v3 `ProfileTurnPlan` / TSX DSL 合同，同时让 `<ProfilePrompt>` 源码 range 稳定，便于可视化辅助编辑做局部 round-trip。纯函数式 `prepare()` 仍保留为高级覆写入口；普通模板推荐 `context()`，因为它能被 Workbench 解析为结构化 DSL tree。
- 模板文案默认使用中文；变量名、profile key、文件名和 TypeScript 标识符保持英文。
- 第一版模板数量先收敛为两个：普通 `basic-agent` 与结构化 `report-agent`。
- `basic-agent` 模板默认只允许读取能力，避免用户刚创建的普通 agent 默认获得写文件或 shell 权限；后续再通过工具权限选择器扩展。
- `report-agent` 模板默认使用 `OutputSchema = Type.Object({})` + `report_result`，表示只要求通用 `walkthrough`。结构化输出示例可以作为后续单独模板或示例，不放进默认 `report-agent`，避免普通 report agent 一开始就被 schema 概念干扰。它可以保留必要的读取能力，但不默认给写文件工具。
- Prepare preview 的 input 编辑第一版使用 JSON textarea/editor，不根据 InputSchema 生成表单；schema 表单留给后续 TypeBox Schema Builder / preview helper。
- `allowedToolKeys` 第一版仍以源码为真相源。Workbench 可以提供 checklist 辅助编辑，但只在能稳定定位 `const allowedToolKeys = [...]` 或等价数组 literal 时做局部替换；找不到稳定数组时只读展示，不重写复杂表达式。
- 工具权限选择器第一版不按危险等级做复杂分组，保持简单 checklist。模板默认只勾选读取能力；`report-agent` 额外勾选 `report_result`。
- `bash` 默认不选。用户勾选时显示强警告，说明它允许执行命令，风险高于普通读写工具。
- `report_result` + `OutputSchema = Type.Object({})` 在 UI 中命名为“通用报告模式”，说明该 agent 需要通过 `report_result` 完成，但只提交必填 `walkthrough`。
- `OutputSchema` 非空但没有选择 `report_result` 时不阻止创建或保存，只展示轻 warning：结构化输出 schema 当前没有提交工具，运行时不会校验输出。
- `OutputSchema` 非空但没有选择 `report_result` 时的 warning 文案应明确表达“schema 已定义但当前没有提交点”，而不是把它描述为错误。该状态合法，只是运行时不会强制收集或校验结构化输出。
- 新建模板始终导出 `export type Input = Static<typeof InputSchema>` 与 `export type Output = Static<typeof OutputSchema>`。即使 `OutputSchema = Type.Object({})`，也导出 `Output`，保证 typegen 和 profile 模块骨架一致。
- 如果 `profileManifest.key` 与文件名不一致，编辑器只展示 warning，不自动移动、重命名或改写文件名。
- 保存源码后不自动跑完整 typecheck/profile check。保存后只做轻量 source diagnostics 和必要的当前文件状态刷新；显式“验证”按钮再跑 profile check 或 prepare preview。
- 显式“验证”按钮第一版跑三类检查：源码/契约检查、真实 `prepare()` preview、以及当前 profile 派生出的模型可见 `report_result` 参数 schema preview。验证结果应让用户同时看到“能不能加载”“prepare 会产出什么”“模型实际会看到什么工具参数”。
- 暂不为本任务单独建立 ADR；当前 walkthrough 足够记录这些实现边界。若后续正式改变 runtime catalog 的坏文件语义，再评估 ADR。
- 用户 profile 文件清单若由外层提供，应包含 runtime loader 支持的 `.profile.tsx`、`.profile.ts`、`.profile.mjs`、`.profile.js`；新建模板默认生成 `.profile.tsx`。

## Implementation Plan

1. 文档对齐
   - 新建本文档作为当前任务 walkthrough。
   - 在旧相关任务文档顶部标注过期方向，链接到本文档。
   - 后续实现阶段继续更新 `PROJECT-STATUS.md`。

2. Workbench UI 第一版
   - 在 user-assets Header 或侧边入口恢复 Profile Workbench 入口。
   - 基于恢复后的 `app/pages/tsx-profile-editor.preview.vue` 与 `app/components/profile-template-editor/ProfileTemplateVisualEditor.vue` 调整，不重做一套完全独立 UI。
   - 保留旧版三栏 UI 骨架：左侧组件库，中间可视化画布，右侧源码/属性/变量/运行时/Agent tabs，顶部工具栏放 profile 选择和主要动作。
   - 拆分外层 host 与 Workbench 编辑器组件：host 决定可见 profile、当前文件和入口权限；编辑器组件只编辑传入的受控 TSX fileName。
   - Runtime catalog 列表展示可加载 profile 的 key、来源、覆盖状态、load status、schema locked、canEdit/canRestore；坏 profile 文件不放进运行时 catalog。
   - Workbench 编辑器不内置 profile 文件清单；user-assets host 如需列表，只扫描用户 profile 根，不扫描系统级 profile。调用方可以直接指定受控相对文件打开。
   - Workbench 另行提供按 `fileName` 定位的文件源码详情或 diagnostics 入口，用于打开、保存和修复坏 `.profile.tsx`。
   - Detail 面板展示源码摘要、manifest、allowed tools、InputSchema/OutputSchema JSON、issues。
   - 保留源码编辑面板作为主编辑路径；同时保留 `ProfilePrompt` 可视化辅助编辑，用于查看和编辑可解析 prompt 区域。第一版解析 active v3 `context()` 返回的 `<ProfilePrompt>` JSX tree；无法解析时降级源码编辑。
   - 可视化辅助编辑解析失败时，源码编辑仍是唯一真相源；可视化区只做降级展示，不阻止保存。
   - 保存冲突不在编辑器内重造弹窗，优先调用外层或共享保存 wrapper，复用 user-assets 既有保存冲突处理。
   - 如复用旧 `ProfileTemplateVisualEditor`，必须先去掉旧 tombstone API 依赖和旧 `leader/subagent` / Zod Schema Builder 假设。

3. 最小写入 API
   - 删除旧 `profile-templates` / `user-profile-templates` API，不做旧合同兼容。
   - 基于当前 v3 runtime 重新设计新的 `/api/agent/profiles/*` 写入 API。
   - 写入 API 统一使用 `fileName` 定位 profile 文件；不要要求坏文件先能解析出 `profileKey`。
   - 写入 API 默认只写用户 profile 根；不提供系统 profile 编辑能力。
   - 新建 profile：从系统 profile template 复制生成标准 TypeBox `defineAgentProfile` 骨架；推荐 key 为 `agent.<slug>`，但不强制。
   - Profile template 放在非 runtime profile 目录，扩展名使用 `.profile-template.tsx`，避免 runtime catalog 扫描。
   - 模板占位替换保持简单，只替换 key、name、description 和初始提示词。
   - 第一版模板只提供 `basic-agent` 和 `report-agent`。两者都导出 `InputSchema = Type.Object({})`、`OutputSchema = Type.Object({})`、`Input` 和 `Output`；`basic-agent` 默认只给读能力，`report-agent` 默认允许 `report_result`，表示只要求通用 `walkthrough`。
   - 模板固定导出 `profileManifest` 和顶层 `allowedToolKeys`，方便 Workbench 做稳定源码 range 辅助编辑。
   - 模板不额外导出手写的 `report_result` 参数 schema；运行时和预览面板统一从目标 profile 的 `OutputSchema` 派生工具参数。
   - 工具权限 checklist 只做稳定数组的局部辅助替换；复杂 `allowedToolKeys` 表达式保留源码编辑。`bash` 默认不选，勾选时提示高风险。
   - 恢复系统版本：删除用户覆盖文件。
   - 写入后刷新 profile catalog，不自动恢复坏文件。

4. 自定义 profile / agent 闭环
   - 新建 profile contract 正确时能出现在 runtime catalog 中。
   - `POST /api/agent/profiles/detail` 能返回源码、manifest、schema、allowed tools 和 issues。
   - `POST /api/agent/profiles/preview-prepare` 能用自定义 input 预览真实 `prepare()` 输出。
   - `POST /api/agent/sessions` 能使用自定义 `profileKey` 和可选 `input` 创建 session；默认空实例配置的 profile 可以不传 `input`。UI 不在新建成功后自动创建 session。
   - 对新建后立即可运行的验证是链路验证，不是自动启动：文件落盘 -> catalog 加载 -> detail/preview 正常 -> sessions API 可创建。
   - 用户能通过 Profile Workbench 的源码编辑和 `ProfilePrompt` 可视化辅助编辑查看、编辑 TSX 文件。
   - Agent 可通过普通文件工具编辑 `workspace/.nbook/agent/profiles/**/*.profile.tsx`，修改后由 catalog/check/preview 验证。

5. Prepare Preview
- 继续使用真实 `profile.prepare()` 预览。
- 第一版支持 JSON input、简单 history 和当前 workspace context；这里的 input 是 agent 实例初始化参数，不是每轮任务 prompt。input 编辑器先用 JSON textarea/editor，不从 InputSchema 自动生成表单。
- 不调用 LLM、不创建真实 session、不写 session metadata。
- 显式验证同时展示 runtime profile 契约检查、prepare preview 和动态 `report_result` 参数 schema preview。
- 预览会额外展示 `reactMessages` 分区，让用户看到 harness 最终会传给 ReAct loop 的消息形态；它仍是 dry-run 预览，不写 session。

6. 后续辅助编辑
   - TypeBox Schema Builder 基于当前 v3 profile 经验重新设计；只在 TypeBox schema 可稳定定位时做局部辅助替换。
   - 复杂 prompt/helper/schema 都保留源码编辑或 Agent 辅助编辑。
   - 第一版不把 TypeBox Schema Builder 写入验收；只要求新建模板解释 `InputSchema = Type.Object({})` 与 `OutputSchema = Type.Object({})` 的语义，模板始终导出 `Input` / `Output` 类型。
   - 后续实现 `report_result` 新语义时，需要把当前 `result/data` 工具参数调整为按目标 profile 派生的动态 schema：`OutputSchema = Type.Object({})` 只暴露并校验 `walkthrough`，非空 OutputSchema 暴露并校验 `walkthrough + data`，其中 `data` 的模型可见类型来自 `OutputSchema`。
   - `ProfilePrompt` 可视化辅助编辑写回后是否自动跑 prepare preview、源码保存后是否自动刷新 runtime catalog/detail，先调研旧编辑器节奏、当前 dynamic import/cache 行为和 UI 成本后再决定。

## 2026-07-06 Profile CLI / Workbench CWD Fix

- 修复 profile CLI 从 Workspace Root `.nbook` 执行时把用户 profile root 解析成嵌套 `workspace/.nbook/workspace/.nbook` 的问题。`scripts/build/profile.ts` 改为复用 Workspace assets root resolver，并在 CLI build 入口统一切到应用根。
- `agent/scripts/profile.ts` 改为先识别 Product Runtime manifest；Product Root 走 `.output/server/scripts/build/profile.ts`，源码仓即使存在旧 `.output` 仍走根源码入口，避免 user-assets wrapper 吃到 stale product copy。
- Product 分支 `agent/bin/profile` / `profile.cmd` 使用 `neuro-book-product` / `neuro-book-output` manifest 判定，执行 `.output/server/scripts/build/profile.ts` 前切到 Product Root，保持 Product Runtime 的 cwd 合同。
- Workbench 刷新 profile 文件列表时改为优先保留当前选中项；仅当前文件不存在时才 fallback 到 `preferredTemplate` 或 `leader.default`，避免保存 `leader.default` 后跳回 `leader.assets` 并误触发“编译未开始”。

## 2026-07-10 Task 102 DSL / Preview 演进

- Workbench DTO、源码 parser、节点库、画布节点和图标已识别 `FileChangeNotice`；节点只能直接放在 `AppendingSet`，公开属性只保留 `mode`，支持 `off/minimal/full` 或 settings 表达式。单文件 diff 上限由 Profile 通用运行设置控制。
- 组件库新建 `FileChangeNotice` 的 literal 默认固定为 `{mode: "minimal"}`；Inspector 对 literal mode 使用 `off/minimal/full` 下拉，不再编辑 diff 字符预算。
- source parser 回归锁定 `<FileChangeNotice mode={ctx.settings.fileChangeAwareness} />` 的表达式往返，不把它降级成普通源码文本。
- literal 回归锁定 `<FileChangeNotice mode="minimal" />` 的画布生成与 parser round-trip。
- Profile Preview 的分区展示顺序已改为 `history → modelContext → modelContextAppending/appending`，最终 `reactMessages` 通过统一 assembler 生成。
- 当前用户输入属于 Harness 的 `CurrentUserInput`，Workbench 不建议 profile 作者把 `ctx.invocation.message` 复制到 AppendingSet。
- 验证：Task 102/Profile 聚焦套件 7 files / 70 tests、14 个 builtin Profile artifacts 全部 loaded、全仓 typecheck 通过；Task 102 浏览器终验已完成。

详见 [Task 102](../102-agent-change-inbox-and-prompt-order/README.md)。

## Files Changed

- `docs/tasks/04-tsx-profile-workbench/README.md`
- `scripts/build/profile.ts`
- `scripts/build/profile-cli-path.test.ts`
- `assets/workspace/.nbook/agent/bin/profile`
- `assets/workspace/.nbook/agent/bin/profile.cmd`
- `assets/workspace/.nbook/agent/scripts/profile.ts`
- `docs/tasks/02-pi-agent-harness-migration/README.md`
- `docs/tasks/05-leader-profile-v2-adaptation/README.md`
- `docs/modules/agent/harness.md`
- `assets/workspace/.nbook/agent/profile-templates/basic-agent.profile-template.tsx`
- `assets/workspace/.nbook/agent/profile-templates/report-agent.profile-template.tsx`
- `app/components/profile-template-editor/ProfileTemplateHeader.vue`
- `app/components/profile-template-editor/ProfileTemplateInspectorPanel.vue`
- `app/components/profile-template-editor/ProfileTemplateVisualEditor.vue`
- `app/components/profile-template-editor/profile-template-selection-utils.ts`
- `app/components/profile-template-editor/profile-template-selection-utils.test.ts`
- `app/components/profile-template-editor/UserProfileWorkbenchDialog.vue`
- `app/components/profile-template-editor/profile-template-form-utils.ts`
- `app/components/novel-ide/NovelAgentDrawer.vue`
- `app/components/novel-ide/NovelIdeHeader.vue`
- `app/pages/index.vue`
- `app/pages/tsx-profile-editor.preview.vue`
- `server/api/agent/profiles/*`
- `server/agent/profiles/profile-source-check.ts`
- `server/agent/profiles/profile-compile-worker.ts`
- `server/agent/profiles/profile-compile-worker-entry.ts`
- `server/agent/profiles/profile-compile-worker-runtime.ts`
- `server/agent/profiles/profile-dsl-source-parser.ts`
- `server/agent/profiles/workbench-service.ts`
- `server/agent/profiles/report-result-schema.ts`
- `server/agent/profiles/profile-http-service.ts`
- `server/agent/tools/builtin-tools.ts`
- `server/agent/tools/tool-registry.ts`
- `server/agent/harness/neuro-agent-harness.ts`
- `shared/dto/agent-profile.dto.ts`
- `shared/dto/profile-template.dto.ts`
- `server/agent/test/setup.ts`
- `vitest.config.ts`
- `scripts/build/profile.ts`

## Verification

- 2026-07-06 本轮修复验证：
  - `bash -c './workspace/.nbook/agent/bin/profile status leader.default'`：通过，返回 `leader.default: loaded`。
  - `bash -c './assets/workspace/.nbook/agent/bin/profile status leader.default'`：通过，源码仓存在 `.output` 时仍返回 `leader.default: loaded`。
  - 在 `workspace/.nbook` 下执行 `bash -c './agent/bin/profile status leader.default'`：通过，返回 `leader.default: loaded`。
  - 在 `workspace/.nbook` 下执行 `bash -c './agent/bin/profile check leader.default'`：通过，返回 `profile check passed`。
  - 临时 Product Root smoke：同时放置根 `scripts/build/profile.ts` 与 `.output/server/scripts/build/profile.ts` 后运行 `assets/workspace/.nbook/agent/bin/profile`，输出 `product-bin` 且 cwd 为临时 Product Root，确认 sh wrapper 命中 `.output/server`。
  - `bunx vitest run app/components/profile-template-editor/profile-template-selection-utils.test.ts scripts/build/profile-cli-path.test.ts server/agent/profiles/workbench-service.test.ts --testTimeout=120000 --hookTimeout=120000`：通过，3 files / 15 tests passed。
  - `bunx vitest run server/agent/profiles/profile-compile-worker.test.ts -t "Product Root 仅有 .output package manifest" --testTimeout=120000 --hookTimeout=120000`：通过，1 test passed / 20 skipped。
  - `bunx vitest run server/agent/profiles/catalog.test.ts -t "Product profile artifact|通用 .output Product runner|Product 用户层 artifact" --testTimeout=120000 --hookTimeout=120000`：通过，4 tests passed / 39 skipped。
  - `bunx vitest run server/agent/profiles/catalog.test.ts server/agent/profiles/profile-compile-worker.test.ts --testTimeout=120000 --hookTimeout=120000`：本轮复查中超过 2 分钟无增量输出且未按单测超时退出，已中断；改用上方 Product 相关窄用例覆盖本轮改动边界。
- `bunx tsc --noEmit --pretty false` 通过。
- `bunx vitest run server/agent/profiles/workbench-service.test.ts server/agent/profiles/profile-compile-worker.test.ts server/agent/profiles/catalog.test.ts` 通过，覆盖轻量 draft 读取不触发 runtime catalog、真实 worker service 后台编译、worker crash 结构化 issue、catalog compiled-only 加载和 user profile 文件读写。
- 手动跑过 Node worker service 探针：`useProfileCompileWorker().compile({ fileName: "builtin/leader.default.profile.tsx", preview: false })` 返回 `ok: true`、`manifest.key = leader.default`、error issue 数为 0。
- 手动跑过 Bun worker service 探针：同样返回 `ok: true`、`manifest.key = leader.default`、error issue 数为 0。
- Workbench 自动编辑路径已复查：源码输入和画布编辑只调用 `source-draft` 轻量解析；用户显式点击预览时调用后台 worker 的 `compile` dry-run 模式，只在临时 profile root 编译并清理，不写真实用户 `.compiled`；普通 `compile` endpoint 非 dry-run 模式是唯一写用户 `.compiled` 的 UI 入口。`preview-prepare + sourceOverride` 后端保留为兼容 API，但 Workbench 不再使用它。
- `bunx vitest run server/agent/profiles/workbench-service.test.ts server/agent/profiles/report-result-schema.test.ts server/agent/profiles/catalog.test.ts` 通过，覆盖模板发现、受控 `fileName`、新建 profile 加载、临时源码覆盖不写入真实用户 profile 文件、runtime catalog 与 report_result schema 派生。
- `bunx vitest run server/agent/profiles/workbench-service.test.ts` 通过，覆盖新 TSX DSL tree 解析：`ProfilePrompt` / `System` / `HistorySet` / `ModelContext` / `AppendingSet` / `FileChangeNotice` / `ToolCall` / `ToolResult`，其中 `FileChangeNotice.mode` 保留 settings expression。后续需要补覆盖 `Compaction` tree round-trip。
- `bunx vitest run server/agent/profiles/catalog.test.ts server/agent/profiles/workbench-service.test.ts server/agent/profiles/profile-compile-worker.test.ts server/agent/profiles/leader-assets-profile.test.ts server/agent/profiles/profile-dsl.test.ts` 通过，46 tests passed，覆盖 active DSL、compiled-only catalog、leader profile、Workbench parser、后台编译，以及 `dryRun` preview 不写真实用户源码或 `.compiled`。
- `bun scripts/prepare-system-profile-metadata.ts` 通过，生成 4 个系统 profile 的 `.compiled` artifact 与 `.system-profile-metadata.json`。
- `bun scripts/build/profile.ts status --all --system` 通过，系统 profiles 均为 `loaded`。
- `bun scripts/build/profile.ts check builtin/leader.default.profile.tsx --system` 通过。
- `bun assets/workspace/.nbook/agent/scripts/profile.ts status --all --system` 通过，确认 Agent runtime wrapper 可用。
- 未自动做浏览器验证；按项目规则需要用户明确要求后再打开浏览器检查 UI。

## Plan Deviations

- 原计划写的是 `.profile.tsx/.profile.ts` 直接走 `tsx/esm/api.tsImport`。实现中改为 esbuild bundle 到 profile root `.compiled/*.mjs` 后再 import，因为真实 worker service 在 Bun worker 和被 `tsImport` 加载的 catalog 场景下会生成不可解析的 `tsx://...` 虚拟模块，同时 `.compiled` 需要成为可发布的运行真相源。
- 第一版仍是单 worker 串行队列，没有实现 worker pool。当前目标是避免 Nitro 主线程被 TSX 编译卡住，不承诺降低单次冷态 profile 编译时间。

## TODO / Follow-ups

- Dev reload / HMR 自动编译暂不实现：后续如果需要 dev-only 自动重编译系统 profile 或可选用户 profile，必须走 worker 或 child process，不能回到 runtime API 自动编译。
- 后续补 `.compiled` 的清理策略：单文件编译会保留旧 artifact 文件，当前不影响运行，但可以增加 prune 命令或在全量系统编译时继续清理。
- 后续补 TypeBox Schema Builder，只在能稳定定位 `InputSchema` / `OutputSchema` 源码 range 时做局部替换。
- 后续补完整 `allowedToolKeys` checklist 局部替换；当前 UI 只读展示工具权限，源码仍是真相源。
- 后续补更完整的 `ProfilePrompt` AST round-trip，包括复杂 `Watch.render`、helper 变量绑定和跨函数片段；当前已支持稳定 `context()` 返回的 TSX DSL tree 与整段 `ProfilePrompt` 局部替换。
- 后续按用户要求做浏览器交互验收：新建、保存坏文件、验证、创建 session、preview debug route。
