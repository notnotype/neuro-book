# Task 111：Workflow 正式接入 NeuroBook Agent

状态：实现完成（Plan G Jobs SSE 于 2026-07-27 收口）；浏览器与真实模型验收待执行。上游：Task 110（内核端口化 + demo 页 + `wf.chart` 状态图已定形）。

## 用户需求（原话要点）

1. 以状态机可视化为主，整理核心代码，把 workflow 正式接入 NeuroBook 的 agent。
2. 设计 workflow 工具；建立几个内置 workflow。
3. 存储：workflow 不放进 skill，单独建一个和 skill 同构的 `workflows` 文件夹，同样支持用户资产覆盖。
4. 前端对 workflow 工具调用做适配：一个功能强大的 workflow 展示气泡。
5. workflow 工具返回值：除了 workflow 自定义返回值，还必须返回创建的 session id、token 用量等元数据。
6. agent 能指定 workflow 使用的模型 id；用户在设置中自定义「agent 可见模型清单」（每条 = `provider-id/model-id` + 一句用途描述；通常 ≤5 条；默认 1 条 = 当前模型）。
7. workflow API 与使用指南**不要绑死在工具描述里**，写进 `reference/` 文档，工具只给文档引用（渐进式加载）。

## 验收标准（用户定）

- 拆书 workflow 可以使用。
- leader 能像 skill catalog 一样按需主动调用对应 workflow。
- 用户能主动触发 workflow。
- workflow 工具需要用户审批。
- 前端能看到 workflow 执行情况（状态图为主）。
- agent 能根据用户需求随机应变地写出 workflow，且写得好——会用 `wf.chart` 可视化 API 展示运行情况。

## 调研结论（2026-07-19）

- **Skill 存储范式**（`server/agent/skills/skill-catalog.ts`）：`SkillCatalog(systemRoot, userRoot)`，目录名 = key，用户同名目录整体覆盖系统目录，frontmatter 出 name/description/whenToUse。harness 构造处（`neuro-agent-harness.ts:555`）用 `<systemNbookRoot>/agent/skills` 与 `<userNbookRoot>/agent/skills` 双根。workflow 复刻此范式即可：`agent/workflows` 双根 + `WorkflowCatalog`。
- **Prompt 接入范式**：`profile-dsl.ts` 的 `SkillCatalog({mode})` fragment 渲染目录清单进 system prompt，agent 再用文件工具读 SKILL.md——正是用户要的「渐进式加载」。workflow 照做：`WorkflowCatalog` fragment 只列 key/描述/whenToUse + 指向 reference 文档。
- **工具契约**（`server/agent/tools/types.ts`）：`defineAgentTool` 支持 `approvalRequired: true`（用户审批）、`executeWithContext`（拿 harness/sessionId）、`onUpdate` 流式部分结果（气泡实时刷新可用）、`details: JsonValue`（结构化结果，前端气泡消费）。
- **模型链**：`modelResolver(config, profileKey, {modelKey})` 已支持 per-invocation 模型覆盖（`neuro-agent-harness.ts:2715`）；`config.models.providers` 为真相源。设置侧已有 `model-settings-draft/view` + `ModelLibraryDialog` 等组件可挂新表单。
- **前端气泡范式**：`app/components/novel-ide/agent/tool-render-registry.ts` 按工具名注册 `{mode, typeLabel, component}`；`WorkflowRunPanel.vue`（demo 页）已有状态图/时间线/卡片渲染，可下沉复用。
- **Task 110 遗留清单直接并入本任务**：waiting 穿透、面 B `run_workflow` 工具、脚本沙盒化、`harness.createAgent` 补 kind+tags、直聊互斥统一、D15 剩余、chart 事件进公共 projection DTO。
- **F9 红线**：加载用户 workflow 源码用 `require("typescript")` 转译，勿 ESM import（dev OOM）。

## 模块拆分

| 模块 | 计划文档 | 负责 | 内容 |
| --- | --- | --- | --- |
| A 核心 | [PLAN-A-core.md](PLAN-A-core.md) | 主会话（本 agent） | workflow API 定形、WorkflowCatalog 存储、`run_workflow` 工具（审批 + 返回契约 + 模型指定）、run 事件投影到工具 details、拆书内置 workflow |
| B 设置 | [PLAN-B-model-roster.md](PLAN-B-model-roster.md) | 子任务 agent | 「agent 可见模型清单」配置模型 + 设置 UI + prompt 渲染 |
| C 前端 | [PLAN-C-workflow-bubble.md](PLAN-C-workflow-bubble.md) | 子任务 agent | workflow 展示气泡（状态图为主），tool-render-registry 接入，复用 workflow-preview 组件 |
| D 文档与内置库 | [PLAN-D-reference-and-builtins.md](PLAN-D-reference-and-builtins.md) | 子任务 agent | `reference/agent/workflow/` 编写指南（含 `wf.chart` 可视化规范）、除拆书外的内置 workflow |
| E 后台任务框架 | [PLAN-E-background-jobs.md](PLAN-E-background-jobs.md) | 主会话（本 agent） | AgentJobManager 统一后台任务、run_workflow 非阻塞化 + followup 回流、非阻塞 bash/invoke_agent、job 管理工具、sidecar 机制拆除 |
| F 任务中心 | [PLAN-F-jobs-center.md](PLAN-F-jobs-center.md) | 主会话（本 agent） | Header「Jobs」入口 + 运行数徽标、DialogWindow 任务中心（分组列表/过滤/取消/详情/复制）、`clearFinished` 内存回收面；其中共享轮询已被 Plan G 替代 |
| G Jobs SSE | [PLAN-G-job-sse.md](PLAN-G-job-sse.md) | 主会话（本 agent） | 原子快照游标 + 全局 Job EventHub + 通用 Node SSE writer + 页面级单例状态机；删除 Jobs 周期轮询（已实施 2026-07-27，浏览器走查待用户） |

依赖关系：A 先行（API/DTO 定形是 B/C/D 的地基）；B 独立可并行；C 依赖 A 的 details DTO；D 依赖 A 的 API 定稿；F 依赖 E 的 Job HTTP 面；G 依赖 E/F 的 Manager 与任务中心消费面。

## 执行记录

### 2026-07-20 模块 A 实施（主会话）

按 [PLAN-A-core.md](PLAN-A-core.md) 完成，实际落地与计划的出入见文末。

**内核（sibling nb-workflow，commit 358d680，已 sync 回灌 vendor）**
- `wf.agents.create` 加 `model?: string`（进参数指纹与 SessionPort.createSession init）。
- `begin/start` 加 run 级选项 `defaultModel`（create 未显式指定时的兜底模型）与 `workspace`（per-run workspace 端口，覆盖 RunEnv 全局端口——面 B 按发起方 Project Workspace 注入）。
- `AgentInvokeOutcome` 加 `usage?: {inputTokens, outputTokens} | null`：随 journal 持久，宿主据此汇总 run 级用量。

**NeuroBook 侧新增/改动**
- `server/agent/workflow/workflow-catalog.ts`（新）：与 SkillCatalog 同构的双根 WorkflowCatalog（`agent/workflows/<key>/workflow.ts`，用户覆盖系统，目录名=稳定 key）；`require("typescript")` 转译（F9）+ 无 require 受限求值（workflow 源码禁 import）；mtime 缓存；`compileInline` 供内联脚本。挂进 harness：`harness.workflows`（`neuro-agent-harness.ts` 与 skills 同层）。
- `server/agent/harness/agent-visible-models.ts`（新）：`resolveAgentVisibleModels`（唯一真相源：配置过滤失效条目，空则兜底单条默认模型）+ `assertVisibleModel`。配置面：`EffectiveConfig.agent.visibleModels`（`server/config/types.ts` + normalizer 规范化/解析，global-only）。
- `server/agent/tools/workflow-tools.ts`（新）：`run_workflow`（approvalRequired；workflowKey/script 二选一；model 按可见清单校验；onUpdate 心跳推 runId+状态图 partial；waiting 是正常返回并告知 agent 勿重调）+ `list_workflows`。返回契约 details：`{runId, workflowKey, status, result, error, pendingAsks, sessions[{sessionId,profileKey,title,tokens}], usage, chartMermaid}`。注册进 builtin tools。
- `workflow-demo-service.ts` 提升：`startWorkflowRun`（defaultModel/workspace 透传）、`runSummary`（解析 journal 指纹汇总 session+usage）、runInfo 泛化（phase 观测不再依赖 demo 场景表）；createRealSession 回调支持 model（经 `runCommand model` 落 model_change entry）与 kind/tags。
- `HarnessAgentPort` 回传 usage；`NeuroWorkflowSessionPort` createSession 面加 model/kind/tags。
- **A8**：`harness.createAgent` 面补 `kind`/`tags` 透传（CreateAgentInput → repo.createSession）。
- 正式 API：`server/api/agent/workflow/`（catalog.get / runs.post / runs/[runId].get / runs/[runId]/resume.post）。
- Prompt 面：profile-dsl 新 fragment `WorkflowCatalog`（ctx.workflows 快照，3 个 harness prepare site + profile 预览注入；jsx-runtime、source-parser、profile-template.dto、模板编辑器登记）；`builtin.workflow.run/list` 绑定；`leader.default` 挂 fragment + 两工具。
- 内置拆书：`assets/workspace/.nbook/agent/workflows/split-book/workflow.ts`（researcher ×N 并发逐章摘要 → 合并剧情分析；全程 wf.chart；ephemeral session）。
- `reference/agent/workflow/README.md`（新）：编写参考（wf API / chart 口诀 / 确定性红线），已登记 reference/agent/README.md 索引；工具与 prompt 只留引用（渐进式加载）。
- 测试：`workflow-catalog.test.ts`（双根覆盖 / 内联编译与 require 拒绝 / bundled split-book 防语法回归）。

**验证**：`bunx vitest run server/agent/workflow`（10/10）+ profile-dsl（42 含）全绿；`bun run typecheck` 全绿。`server/config/config-service.test.ts`「删除 Provider 前扫描…」1 例失败为**既有失败**（干净树复现，与本次无关）。

**与计划的出入**
- waiting 穿透（A8 备选）按降级方案落地：`wf.ask` 挂起时 `run_workflow` 正常返回 waiting + runId，应答走 run API/气泡，不阻塞工具调用——未做「工具内等待用户」。
- 内联 script 沙盒 V1 = 无 require 白名单 + 用户审批门（PLAN 预告过，维持）；完整沙盒记后续 TODO。
- 直聊互斥统一到 harness 未做（仍是 Task 110 已知边界），记后续 TODO。
- `reference/agent/workflow/README.md` 由 A 先写核心版（原计划全归 D）；D 仍负责 chart 好坏示例扩写与其余内置 workflow。
- ctx.workflows 为可选字段（避免炸旧测试构造面），fragment 空时渲染为空。

### 2026-07-20 验收轮修复：approvalRequired 工具批准后未执行（session 755 现场）

- **现象**：leader 调 `run_workflow` → 用户批准 → agent 收到的工具结果只有「批准」二字，workflow 从未启动（无参与者 session 被创建）。
- **根因**：harness 既有审批语义是「审批应答文本即工具结果」（`resolutionToToolResult`）——`run_workflow` 是全仓第一个真用 `approvalRequired: true` 的工具，暴露了该合同不适用于「批准后需要真实执行」的工具。Task 90 写审批已有正确先例（`writerApprovalToolResult` 批准后 `executeTool` 落真实结果），但显式排除了 approvalRequired 工具。
- **修复（系统性）**：新增 `declaredApprovalToolResult`——声明式 `approvalRequired` 工具（排除 userInputRequest/switch_mode）批准后真实执行、以执行结果落库；拒绝落引导文本。接入 `appendResolution`/`appendResolutions` 两条路径。契约固化：**批准不是结果，执行才是**。
- 测试同步：`profile 自带审批工具` 用例原断言「批准后不执行」＝旧合同，改写为断言真实执行。
- 语义确认：`run_workflow` 是**阻塞**工具——批准后 resume invocation 会一直跑到 workflow 完成，结果（result+sessions+usage+chartMermaid）作为 toolResult 回给 agent；`wf.ask` 挂起时才提前返回 waiting+runId。后台任务管理工具（列出/查询/取消 run）记 TODO 待定。
- 验证：harness 测试 181/182（唯一失败「已删除的session模型…」为干净树复现的既有失败）；typecheck 全绿。

### 2026-07-21 模块 E 实施（主会话）：后台任务框架 + sidecar 拆除

按 [PLAN-E-background-jobs.md](PLAN-E-background-jobs.md) 完成一期。

**AgentJobManager（`server/agent/jobs/agent-job-manager.ts`，新）**
- Job = 身份（jobId/kind/title/ownerSessionId/ref）+ 状态机（running/waiting/completed/failed/cancelled/interrupted）+ 观测面（preview/时间戳）+ 回流策略。API：`spawn/list/get/cancel/waitIdle/recoverInterrupted`。
- 回流通道 = `mode:"prompt"` 的普通 invokeAgent（caller `{kind:"system"}`）：owner 空闲立即触发新回合，忙时 harness 自动入 followup 队列。回流只带文本结果卡不带 payload（避免撞 owner profile PayloadSchema）；`waitIdle()` 等待完整 Job promise，包含结果卡投递。
- 崩溃恢复薄登记表：`<workspaceRoot>/.nbook/agent/jobs.jsonl` append-only 状态翻转；harness 启动扫描未终态 job → interrupted + 补发中断通知 followup。
- harness 挂载：`harness.jobs`；`drainBackgroundTasks` 尾部 `waitIdle()` 收口测试面。

**run_workflow 非阻塞化（`workflow-tools.ts`）**
- 默认后台：审批后 spawn job 立即返回 `{jobId, runId, status:"started"}`，工具正文明确「不要轮询等待」；workflow 完成后结果卡（result JSON 截断 4000 + sessions + usage + 汇报指令）以 followup 回流。`wait:true` 保留原阻塞路径+心跳。
- `wf.ask` 挂起：job 转 waiting（`service.waitForRunSettled` 事件驱动，settleWaiters 于非 running status 事件 flush），用户面板应答后自动恢复跟踪。
- kernel 取消（sibling nb-workflow cf34d15，已 sync vendor）：`cancel(runId)` 置 `abortRequested`，`activity()` 边界抛 `WorkflowCancelledError`（failed 归约）；`execute()` 开始时重置（rerun 可恢复）；不掐进行中的单次 agent 调用。

**job 管理工具与 HTTP 面**
- `server/agent/tools/job-tools.ts`（新）：`list_jobs`（默认本 session，all/status 过滤）/ `get_job`（快照 + workflow 详情：runState+runSummary）/ `cancel_job`（仅 owner session）。注册进 builtin tools + `builtin.jobs.*` 绑定 + leader.default 挂载。
- `server/api/agent/jobs/`（新三路由）：列表 / 详情 / cancel。

**非阻塞工具调用**
- `bash` 加 `background`：spawn job，输出走 `ctx.setPreview` 实时预览，完成结果卡（6000 截断 + `details.fullOutput` 逻辑 locator）回流。旧 `fullOutputPath` 设计已由 Task 130 的 Cache Root/owner/TTL 合同取代。
- `invoke_agent.model` 下沉为本次 invocation 的 `modelKey` override：经过可见模型清单校验，但不写 `model_change`、不修改目标 session 默认模型；同进程 waiting/resume 与持久 followup queue 都保留该 override。
- `invoke_agent` 返回 details 固定为 `{status, data, finalMessage, sessionId}`，其中 `report_result.result` 优先，否则取最后一条 assistant 文本；`background:true` 另返回 `jobId/background`，完成结果卡沿用同一结构。
- 后台 invoke V1 采用 fail-closed：目标忙碌时不写入 followup queue；本次调用若进入用户输入/审批 waiting，Job 失败并保留目标 session 的 waiting 现场，不伪报 completed。跨 HITL 自动续接留后续系统设计。

**ad-hoc agent（E3 七点定稿落地）**
- `server/agent/profiles/adhoc-profile.ts`（新）：内置 `adhoc` profile，initial = `{name?, systemPrompt, outputSchema?}` 纯数据 spec；工具面固定 read + report_result。
- 动态 report_result schema 通用机制：`ReportResultToolBinding.dataSchemaFromInitial`（tools/types.ts）+ `reportResultSchemaForProfile(profile, override?)` + harness `toolOverrides` 传 `sessionInitial`（snapshot.metadata.initial 解析）。无 profileKey 特判。
- workflow 求值作用域注入 typebox `Type`（workflow-catalog evaluate 第四参；禁 import 红线不动）。

**sidecar 机制拆除（拍板：纯删）**
- harness：runSidecarPasses 及全部 sidecar 私有方法/类型/参数管线删除；`runToolBatch`/`executeToolSegment`/`executeTool` 的 sidecarResult/activeSidecar 面删除；`resultToolPermissionError` 删除；只有 sidecar 设置过的 RunFrame 旗标（disableSteer/suppressEvents/forceRuntimeOnlyTranscript/forcePersistTranscript/restoreLeaf*/disableAutomaticCompaction/activeSidecar）连同分支一并删除简化（transcriptParentLeafId 保留——主 run steer/context 链仍用）。
- 类型与工具面：run-kernel-types（RunSidecarToolResult/ActiveSidecarRun/各结果面 sidecar 字段）、run-frame-state、prepare-next-turn（requiredResultToolName 收敛为 report_result）、turn-transaction、profiles/types（Sidecar* 五类型 + sidecars 字段）、define-agent-profile（assertProfileSidecars）、control-tools（report_sidecar_result 工具 + createReportSidecarResultTool + activeSidecar 选项）、report-result-schema（reportSidecarResultSchemaForProfile/sidecarDataKeyedObjectSchema）、profile-tools（builtin.result.sidecar）、tools/types（ReportSidecarResultToolBinding）、tools/index 再导出、caller kind "sidecar"（harness/types）。
- DTO/前端：agent-profile.dto 的 reportSidecarResultSchema 字段、profile-http-service/workbench-service/preview-prepare、ProfileTemplateVisualEditor.vue 消费点。
- `simulator.actor`：context-load / memory-save 两旁路删除，tools 收敛为 report_result（**RP 记忆旁路暂缺，后续以 workflow/job 形态重建**，profile 内注释留了口子；`<actor-sidecar-context>` 标签语义保留）。
- 文档：`reference/agent/sidecar-profile-pass.md` 归档至 `docs/archived/reference/agent/`（头部加归档说明），reference 索引同步。

**Prompt/文档口径**
- WorkflowCatalog fragment：加后台语义纪律（默认非阻塞 / 结果自动回流 / 勿轮询 / jobs 三工具用法 / wait:true 边界）。
- `reference/agent/workflow/README.md`：新增「后台运行与 wait」「ad-hoc agent」两节，返回契约区分即时返回与阻塞 details；authoring.md 补 adhoc + Type 注入引用。

**阶段验证**：`bunx vitest run server/agent/workflow` 14/14 全绿；`bun run typecheck` 主代码 0 错误。sidecar 测试与完整收口验证见后续记录。

**与计划的出入 / 已知残留**
- adhoc V1 不开放 initial.tools 白名单（frame.toolKeys 静态来自 rootToolKeys，动态收窄需动 prepareRun）——固定 read+report_result，二期再议。
- HarnessAgentPort 对忙碌 caller 的 invoke 仍走 throw（未做排队等待放宽）——非阻塞世界的已知边界，记 TODO。
- 后台 invoke 尚不跨用户输入/审批 waiting 自动续接；若要支持，必须把 invocation resume、持久 followup queue 与 Job 取消归属一起建模，不能只轮询 session 状态。

### 2026-07-21 模块 B 实施：Agent 可见模型清单

- `agent.visibleModels` 成为 Global Config 一等字段；运行时统一通过 `resolveAgentVisibleModels` 过滤失效 provider/model，空清单回退当前默认模型。`run_workflow`、`invoke_agent.model` 与 workflow 内联 `wf.agents.create({model})` 都在宿主边界消费同一门禁。
- 设置页新增 `AgentVisibleModelsEditor.vue`，支持选择模型、填写用途、增删与排序；保存链保持条目顺序。Provider ID 重命名会同步迁移模型 key，删除或停用 Provider/Model 会清理失效引用。
- WorkflowCatalog prompt 向 leader 展示允许模型及用途；工具可通过 `list_workflows` 刷新清单，不在工具描述中复制配置真相。

### 2026-07-21 模块 C 实施：Workflow 气泡与主动触发

- `run_workflow` 注册为 block 气泡 `AgentWorkflowBubble.vue`。气泡同时观察 Job 与 Run：Job 管后台生命周期/取消，Run 管 `wf.chart`、时间线、参与 session、usage 与 `wf.ask`；running 快轮询、waiting 降频、终态停止。
- waiting 可在气泡内按 ask 规格应答并继续；取消、失败、中断与服务重启后的 Job/Run 404 都有独立终态，不会把工具调用本身的 success 误判成 workflow completed。
- `/workflow.preview` 接入正式 Catalog 与显式 Project Workspace，主动触发返回并消费 `{jobId, runId}`；demo 场景仍保留为内核观察面。

### 2026-07-21 模块 D 实施：Reference 与内置 Workflow

- `reference/agent/workflow/` 已形成入口、authoring 与 chart 三份稳定 Reference，覆盖目录覆盖规则、工具/API 返回、后台 Job、`adhoc`、确定性/replay 边界，以及 `wf.chart` 好坏示例。
- 三个 bundled workflow 均使用 `adhoc + outputSchema + ephemeral:true`：`split-book`、`parallel-brainstorm`、`write-review-loop`。参与者必须通过 `report_result.data` 返回符合 schema 的结构化结果；缺失或非法 data 会直接失败，不再解析自由文本兜底。
- `adhoc.outputSchema` 已下沉为动态 `report_result` data schema，并让 `data` 在配置 schema 时必填；workflow 求值作用域由宿主注入 TypeBox `Type`，workflow 源码仍禁止 import/require。

### 2026-07-21 PLAN-E 收口：sidecar 测试与稳定文档

- 删除旧 sidecar trace/context-load/memory-save 测试与类型引用；`simulator.actor` 的稳定断言收敛为 `rootToolKeys=["report_result"]` 且无 `sidecars`。
- Profile/runtime、RP packet/LOD/information-control、Subject RAG 等 Reference 已改为普通 invocation、Workflow 与 Job 合同；`docs/agent/sidecar.md` 和归档 Reference 只保留退役/迁移说明。
- Subject RAG 数据、索引和工具继续保留，但当前没有内置自动消费者；原 `actor.context-load` / `memory-save` 不再运行，RP 自动记忆必须以后续 workflow/job 显式重建。
- 产品 README 中的 Sidecar 能力描述已替换为 Workflow 与后台 Job。

### 2026-07-21 收口验证

- `bun run typecheck`：通过。
- 相关 16 个测试文件拆分执行，共 119 项通过；大组合出现的 4 个超时用例单跑后分别通过（`workflow-demo-service` 5/5、RP profiles 9/9）。
- Config Service 新增可见模型持久化用例 1/1 通过；完整 Config Service 套件运行 120 秒超时，未得到完整断言结果。
- Harness 定向模型 override/queue 用例 3/3 通过；Harness 全量 160/161，唯一失败是可在干净树复现的 session recovery `model=null` 既有问题，不经过本轮 invocation override 路径。
- 后台 invoke fail-closed 定向回归 3/3 通过：正常后台结果、HITL waiting 不伪完成、`queueIfBusy:false` 忙碌拒绝。
- `agent-collaboration-tools` + `AgentJobManager` 完整窄测 14/14 通过，覆盖普通 prompt 回流与 `waitIdle()` 等待投递完成。
- Profile 流程依次执行：`compile --all --system` 生成 14 artifacts；`profile:metadata` 为 0 stale；`check --all --system` 通过。
- 未执行浏览器与真实模型验收；拆书的真实 Project Workspace、审批、气泡、waiting/resume 与结果回流仍需手工走查。

### 2026-07-22 模块 F 实施（主会话）：任务中心

按 [PLAN-F-jobs-center.md](PLAN-F-jobs-center.md) 完成。

**后端**
- `AgentJobManager.clearFinished(): number`：清除内存 Map 中终态条目（jobs.jsonl 登记表不动）。计划外补丁：终态翻转发生在回流投递之前，被清条目可能仍有在途 followup——新增 `removedSettle` promise 链，`waitIdle()` 尾部等待它，保住「waitIdle 含回流完成」合同。
- `server/api/agent/jobs/clear-finished.post.ts`（薄包装）→ `{removed}`。
- `agent-job-manager.test.ts` 补 1 例（completed 被清 / running 保留）。

**前端**
- `app/composables/useAgentJobsFeed.ts`（新）：模块级单例共享轮询（F6：shallowRef 整替，不进 useState/payload）；变频矩阵按 PLAN-F（开 1500/5000ms，关 5000/12000ms）；递归 setTimeout + revision guard。
- `NovelIdeHeader.vue`：Trace 后新增「Jobs」按钮（全模式可见）+ `agentJobsActiveCount` prop + accent 徽标（>99 显 `99+`）+ `open-agent-jobs` emit。
- `app/components/novel-ide/jobs/`（新目录）：`AgentJobsDialog.vue`（DialogWindow 壳 + 过滤 chips + 进行中/已结束分组 + 清除已结束 + 刷新 + feed error 条）、`AgentJobRow.vue`（kind 图标/状态 chip/meta/preview、waiting 气泡指引、取消、展开详情=ref 指针复制 + preview/error 全文 + completed 按需拉 result 进 JsonViewer、404 显不可查询）。
- `index.vue` 接线 + `ide.header.agentJobsTitle` / `ide.agentJobs.*` i18n（zh-CN + en-US）。

**验证**：`bunx vitest run server/agent/jobs` 4/4；`bun run typecheck` exit 0（全绿——PLAN-E 时代搁置的测试文件错误已被 Task 116 收口消化，验收清单第 2 条的「既有错误」前提已不存在）。浏览器走查待用户。

**与计划的出入**
- `index.vue` 实际只有一处 `<NovelIdeHeader>`（计划按两处布局写），接线相应只做一处；`setPanelOpen` 从 index.vue watch 移进 `AgentJobsDialog` 内部 watch modelValue（更内聚）。
- feed 生命周期不靠 index.vue onMounted/onScopeDispose 显式管理：`useAgentJobsFeed()` 调用即幂等启动，消费者计数归零自动停。
- i18n 补计划遗漏的 `clearFailed` key；`clearFinished` 的 `removedSettle` 链为计划外系统性补丁（见后端小节）。

### 2026-07-27 Plan G 实施：后台任务 Jobs SSE

按 [PLAN-G-job-sse.md](PLAN-G-job-sse.md) 完成。

- 新增共享 Job DTO 与 Job 专用 EventHub：进程 epoch、全局 seq、500 帧/4 MiB replay、128 帧/1 MiB subscriber queue、128 KiB 单帧；不可恢复游标明确返回 `snapshot_required`。
- `AgentJobManager.recovery()` 原子返回列表与游标；spawn/waiting/running/terminal/clear 都发布完整增量；preview 每 Job 250ms 尾沿合并；shutdown 先关闭订阅与 timer。
- Node SSE writer 收窄为 payload 无关通用 writer，Session 与 Jobs 路由共用背压和 socket 清理；新增 `/api/agent/jobs/events`。
- `useAgentJobsFeed` 改为 transport 可注入的模块级 SSE 单例，具备重复/gap/epoch 检查、单飞恢复、旧响应隔离和固定退避；`useAgentJob` 改为共享列表 selector，删除单 Job GET 与定时器。
- 任务中心移除 `setPanelOpen`/取消后强刷，增加仅面板打开且有活跃 Job 时运行的单一秒表；完整 result 详情 GET 与 Workflow RunView 轮询保持不变。
- 稳定合同新增 [reference/agent/jobs.md](../../../reference/agent/jobs.md)；PLAN-E/F 轮询描述标记为历史实现。

**与计划的出入**：公开 SSE query 收紧为 `eventEpoch`/`after` 都必填；为测试状态机新增 transport 注入工厂。未新增 heartbeat、依赖或持久化格式。

**验证**：Jobs route/EventHub/Manager/SSE writer/feed/observer/parser 聚焦 8 个文件、45 项通过。`bun run typecheck` 本轮文件零错误，但全仓仍被并行工作区既有的设置页 2 项、Harness 测试 1 项和 llmlint 测试类型漂移阻断。

**验收边界**：浏览器 Network 单连接、dev server 重启、真实 Workflow/模型仍待用户验收。

### 2026-07-27 Plan G 审查加固：Job 因果观察与三路 SSE 重连

- 后台 Job 启动入口统一返回创建事件游标；Manager 从首次 running 实际发布帧取值，shutdown 后拒绝新 spawn。
- `useAgentJobsFeed.observe()` 以 epoch/seq 证明 feed 是否越过创建点，替代 `loaded + missing` 猜测；无游标旧结果保持 pending/available。
- Workflow Run 独占 Workflow 终态：Job 清除或不可查询只影响取消与 preview，Run 终态不再退化，Run 404 才归约 interrupted。
- Jobs、Agent Session、Project Presence 共用小型稳定窗口退避；Project 每次重连重新 open，短连接不再永久 300ms 抖动。
- 新增 [ADR 0003](../../adr/0003-agent-job-observation-causality.md)，并同步 Agent Jobs/SSE Reference。

**历史验证基线**：当时记录为聚焦 16 个文件、113 项通过，但没有覆盖孤儿 Run、同游标 Job 切换、真实 H3 400 响应和完整 Project 通知周期；不能把该数字当作后续竞态已覆盖。未执行浏览器验收。

**与原 Plan G 的出入**：原 45 项通过没有覆盖跨 SSE 乱序、open 后立即 EOF、Job 清除早于 Run 终态与 Project timer 绕过 reopen；本节单独记录加固范围，不追溯扩大原验证结论。Workflow Run SSE 仍未迁移。

### 2026-07-27 Plan G 审查补漏与合同收口

- `spawnWorkflowJob()` 在 Run 已创建但 Job 登记失败时补偿取消 Run，并把原始 spawn 错误返回调用方；补齐 Manager shutdown 真实场景。
- `useAgentJobsFeed.observe()` 将 watcher 合并，并把跨 epoch 恢复证据绑定完整观察目标与快照 revision；切换到共用旧游标的另一个 Job 不再永久 pending。
- Jobs list/events 非法 query 在真实 H3 response 边界稳定返回 HTTP 400 与各自错误码；events `after` 只接受严格十进制非负整数。
- Workflow Run 可见后独占 Workflow 状态、结果和错误；Job error 移到独立“后台任务错误”区域，`jobPollError` 更名为 `jobFeedError`。
- Project Presence 补齐连续短连接、稳定五秒通知复位、新目标和 dispose 的确定性 fake-timer 测试。

**验证**：17 文件 Jobs/Workflow/三路 SSE 聚焦组合 129 项通过；补漏 6 文件组合 48 项通过，Project 短连接定向用例 1 项通过。第一次完整组合因后台 bash 输出清理测试仍使用已退役的 ToolExecutionContext fixture 而 3 项失败；fixture 更新为当前 `workspaceRoot/currentProject` 合同后单文件 3 项和完整组合均通过，生产 bash 未修改。

**类型检查**：`bun run typecheck` 已执行，但当前工作区并行进行的 Project/Session 身份合同迁移造成大量旧字段调用点与测试夹具错误，并仍包含 llmlint config 类型漂移；本轮按边界不修改这些无关在途改动，因此没有 clean typecheck 结论。

**与计划的出入**：计划预期全仓只剩 llmlint 类型漂移，实际并行身份迁移扩大了阻断范围；测试数也从旧记录 113 增至实际 129。没有新增 ADR、两阶段 Job 注册、通用 recovery 框架或持久状态，未执行浏览器验收。

### 2026-07-28 Plan G 生命周期补漏与开发拓扑收口

- `index.vue` 不再无条件调用 `useAgentJobsFeed()`。Header 成为徽标 feed 的真实 owner，并只随 `projectSurfaceActive` 挂载；任务中心只在工作面激活且窗口打开时挂载，工作面失活会先关闭窗口。裸 `/` Project 选择页因此没有 Jobs GET/SSE consumer。
- 最后一个 consumer 卸载仍只中止前端连接，不取消服务端 Job；重新进入 Project/User Assets 工作面时用一次原子快照恢复离开期间的变化，随后维持一条共享 SSE。
- 新增初始快照连续失败回归，锁定 `300/800/1500ms` 退避节点；快照成功并建立 SSE 后推进五分钟不再 GET。该恢复属于“尚未建立事件流”的故障恢复，不是健康态轮询。
- Source dev 脚本固定为 `nuxt dev --no-fork`，使开发拓扑符合单 Workspace Root、单 Session Store lease owner。没有弱化 `runtime.lease`、增加锁重试、删除锁文件或吞掉 `ELOCKED`；同一 State Root 不支持并行启动两个 dev server。

**验证**：Jobs feed、页面/dev 接线、`useAgentJob`、Workflow 气泡与 Header 账户接线共 5 文件、32 项通过。`bun run typecheck` 已运行，只剩既有 `server/agent/skills/llmlint.test.ts` fixture 漂移；本轮文件零新增错误。未执行浏览器验收。

**与计划的出入**：实现未修改 feed 或 Job HTTP/SSE 公开 Interface，也未新增 ADR。为让接线合同进入现有 Vitest include，测试放在 `app/composables/agent-jobs-wiring.test.ts`，而非未被测试配置收集的 Jobs 组件目录。

### 2026-07-28 Plan G 最终收口：Job 观察所有权与 Workflow 去强刷

- `AgentJobsFeedController` 的公开手工引用计数改为 effect-scope-aware `consume(enabled)`；Header/任务中心仍为显式消费者，`useAgentJob()` 只有非空目标时才持有 consumer。无目标 observer 固定为 pending、无错误、不可取消、零 Jobs 请求。
- feed 能力拆为只读 View 与任务中心完整 Interface；单 Job observer 不再暴露 `refresh()`。Workflow 气泡和 preview RunPanel 删除应答、重放和 Run 切换后的 Jobs 强刷，Run 轮询判定也不再接收 Job 状态。
- `/workflow.preview` 正式列表首次显式 Jobs GET 保留；demo 面板不传 Job ID，因此 demo 启动/切换/应答/重放不创建 Jobs consumer。
- 测试发现并修复首个 consumer 与跨 epoch observer 同时建立时的 single-flight 收敛竞态：目标登记后完成的初始原子快照可以作为恢复证据；A → B 仍按新目标取得 revision 证据。

**验证**：计划内 6 文件组合 49/49 通过。`bun run typecheck` 本轮文件零错误，全仓只剩既有 llmlint fixture 26 项。未自动执行浏览器验收。

**与计划的出入**：新增的初始快照恢复证据是测试暴露的实际竞态修复；没有新增请求、状态容器、协议或 ADR。测试文件已从组件目录迁到 `app/composables/useAgentJob.test.ts`。

### 2026-08-04 adhoc 动态 outputSchema 合同修复

- 修复 `builtin.result.main({dataSchemaFromInitial})` binding 只包含动态 schema 字段时，被两个重复的 `isReportResultBinding()` 漏判的问题。之前 harness 没有把 session initial 的 `outputSchema` 传入 report_result schema，模型可见参数缺少 `data`，执行层也会把缺 data 的调用当成成功。
- 将守卫集中到 `server/agent/profiles/report-result-schema.ts`，harness 复用唯一实现；显式声明 outputSchema（包括空 schema）继续要求 `data`，静态 profile 和未声明 outputSchema 的 adhoc 行为不变。
- 新增真实 adhoc harness 回归，覆盖 provider 可见 schema、缺 data 错误重试、合法结构化结果、空 schema 的 `{}` 结果，以及未声明 outputSchema 时只返回 `result` 的兼容边界。profile 聚焦 8 项、harness report_result 15 项、5 个 bundled workflow 文件 16 项、profile preview 2 项通过；`bun run typecheck` 退出码为 0。`llmlint-full-review` 使用同一 adhoc 动态合同，但依赖外部 llmlint 命令和审批流程，本轮未执行完整 workflow 专项冒烟，真实 Harness 回归覆盖其共享运行时 seam。

## 后续 TODO

- [ ] 统一 workflow/session 忙碌语义：HarnessAgentPort 对 busy caller 的 invoke 与真实直聊对 workflow 锁的互斥都需要收口到 harness admission。
- [ ] 后台 `invoke_agent` 跨用户输入/审批 waiting 自动续接；需同时建模 invocation resume、持久 followup queue 与 Job 取消归属。
- [ ] `adhoc.initial.tools` 白名单（需 prepareRun 支持动态 toolKeys 收窄）；V1 固定 read + report_result。
- [ ] Workflow RunView 仍独立 HTTP 轮询；后续补 Run SSE 与 run-as-session 持久化。Jobs 观察面已由 Plan G 迁移到 SSE。
- [ ] 完整脚本沙盒化。
- [ ] D15 剩余（systemRole 并入 kind + session 列表按 kind 隐藏）；findByTag 索引化。
- [ ] 拆书 workflow 真跑验收（真实 Project Workspace manuscript + 审批 + 气泡 + waiting/resume + 结果回流）。
- [ ] RP 记忆旁路（原 actor.context-load / memory-save）以 workflow/job 形态重建。
