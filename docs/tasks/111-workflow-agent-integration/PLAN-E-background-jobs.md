# PLAN-E：统一后台任务框架（AgentJobManager）+ 非阻塞工具 + sidecar 清理

状态：一期已实现（2026-07-21）；浏览器与真实模型验收待执行，二期事项保留。承接用户四点指令：中途消息写树 / 清理 sidecar / 统一 summarizer 等后台概念 / 实现非阻塞工具调用与后台任务 API。

> 历史说明（2026-07-27）：本文的 Job HTTP 轮询是一期实现，已由 [PLAN-G](PLAN-G-job-sse.md) 的共享 Jobs SSE 替代。Workflow RunView 的独立轮询仍保留。

## 现状盘点（调研结论）

| 现有机制 | 形态 | 问题 |
| --- | --- | --- |
| summarizer | harness 内建 fire-and-forget（`summarizerRuns` Map + `scheduleSessionSummarizer`），回流=写 custom state | 不可列出/取消，生命周期与 close 等待逻辑私有 |
| sidecar profile pass | **同步旁路**（主 run prepareRun/settleRun 阶段内联子 profile 循环 + merge 进主 turn），非后台任务 | 与 workflow excursion 能力重叠（Task 110 已验证）；唯一活消费者 `simulator.actor` context-load |
| `backgroundTasks` Set | 无名 Promise 集合，仅 close 前等待 | 无身份、无观测、无回流 |
| workflow run | `run_workflow` 阻塞 await done | 长 run 挂死 invocation；重启丢结果 |
| followup 队列 | `followUpQueues` + `drainFollowUps`：忙时排队、invocation 完成即触发 | ——（这是现成的回流通道，直接复用） |

## 核心设计：AgentJobManager（`server/agent/jobs/`）

Job = 有身份、有状态机、有观测面、有回流策略的后台工作单元。harness 持有 `harness.jobs`。

```ts
type AgentJobKind = "workflow" | "invoke_agent" | "bash";   // 一期；summarizer 二期并入
type AgentJobStatus = "running" | "waiting" | "completed" | "failed" | "cancelled" | "interrupted";

type AgentJobSnapshot = {
    jobId: string;                  // "job_<n>" 进程内递增 + 启动时间戳前缀防重启撞号
    kind: AgentJobKind;
    title: string;                  // 人话标题（管理列表/气泡）
    ownerSessionId: number | null;  // 发起者 = 回流收件人；用户从 UI 直接触发时为空
    originToolCallId?: string;      // 发起工具调用（前端气泡锚定）
    status: AgentJobStatus;
    createdAt: number;
    endedAt?: number;
    /** kind 专属观测指针：workflow→{runId}；bash→{command}；invoke_agent→{sessionId} */
    ref: JsonValue;
    /** 有界结果摘要；完整结果走 kind 专属查询面（workflow runs/:id 等） */
    resultPreview?: string;
    error?: string;
};

class AgentJobManager {
    /** 启动一个 job：登记 + 落薄登记表 + 后台执行 + settle 时按 deliver 回流 */
    spawn(spec: {
        kind: AgentJobKind;
        title: string;
        ownerSessionId?: number;
        originToolCallId?: string;
        ref?: JsonValue;
        run: (ctx: JobRunContext) => Promise<JobOutcome>;
        /** best-effort 取消钩子（bash=kill 进程；workflow=kernel abort；invoke=harness abort） */
        onCancel?: () => void | Promise<void>;
        /** 缺省：有 owner 则 "followup"，无则 "none" */
        deliver?: "followup" | "none";
    }): AgentJobSnapshot;
    list(filter?: {ownerSessionId?: number; status?: AgentJobStatus}): AgentJobSnapshot[];
    get(jobId: string): AgentJobSnapshot | null;
    cancel(jobId: string): Promise<AgentJobSnapshot>;
    /** harness.close 统一等待（吸收 summarizerRuns/backgroundTasks 的私有等待逻辑） */
    waitIdle(): Promise<void>;
}

type JobRunContext = {
    signal: AbortSignal;
    setPreview(text: string): void;
    /** workflow ask 等待/恢复时同步 Job 状态。 */
    setWaiting(text: string): void;
    setRunning(): void;
};

type JobOutcome = {
    resultPreview: string;          // 有界人话摘要
    /** followup 正文；缺省用 resultPreview 组装；完整数据走 kind 专属查询面 */
    message?: string;
};
```

### 回流（deliver="followup"）

job settle（完成/失败/取消/中断都回流）→ `harness.invokeAgent({mode: "prompt", caller: {kind: "system"}, message: 结果卡文本})`。owner 空闲时立即触发新回合，忙时由 harness 进入持久 followup queue。回流只带文本，不传 payload，避免撞 owner profile 的 PayloadSchema；完整数据走 `get_job` 或 kind 专属查询面。`waitIdle()` 等待完整 Job promise，因此包含结果卡投递。结果卡文本模板：`[后台任务完成] <title>（job_x）：<resultPreview>`。

### 中途交互（最终合同）

JobManager 不提供静默 `notify` 写树旁路。workflow 需要驱动 caller 思考时，通过 `wf.caller()` 取得普通 SessionHandle 后执行真实 invocation；只需留下轻量记录时使用该 handle 的 `append`。人工参与点统一使用 `wf.ask`，由 Run 进入 waiting、Job 同步 waiting，用户应答后两者一起恢复 running。

### 崩溃恢复（薄登记表，一期就做）

`<workspaceRoot>/.nbook/agent/jobs.jsonl`：append-only 状态翻转记录（jobId/kind/title/ownerSessionId/status/originToolCallId）。**不存观测载荷**。启动时扫描：上次 running/waiting 的 job → 标 `interrupted` → 给 owner 补发一条中断 followup（「后台任务在重启中丢失，可重新发起」）。非阻塞模式下"重启丢回流"从静默变成显式告知。

## 工具面 API

- `run_workflow`：**默认后台**。立即返回 `{jobId, runId, status: "started"}` + 提示语（结果会以后续消息回来，本回合可直接收尾）。`wait: true` 保留阻塞路径（短平快内联脚本用）。
- `invoke_agent`：加 `background?: boolean`（默认 false 行为不变）；true 时包成 job。
- `bash`：加 `background?: boolean`；true 时立即返回 jobId，输出滚动缓冲（有界）挂 job，`get_job` 可查 tail。
- 新管理工具：`list_jobs`（过滤 mine/all + status）/ `get_job({jobId})`（快照 + kind 专属详情）/ `cancel_job({jobId})`。
- prompt 纪律（WorkflowCatalog fragment + 新 Jobs 段合并）：后台任务启动后**直接结束回合等待回流**，不要空转轮询 get_job；get_job 用于用户主动询问进度时。

## HTTP / 前端面

- `GET /api/agent/jobs`（?ownerSessionId=&status=）/ `GET /api/agent/jobs/:id` / `POST /api/agent/jobs/:id/cancel`。
- 一期观测使用 HTTP：workflow 气泡同时轮询 jobId 与 runId，任务中心列表也可复用 Job API；Job SSE projection 留二期。
- 前端 C 已完成 workflow Job + Run 双观察、Composer Workflow 待处理区的 waiting 应答与取消；bash/invoke 后台 job 通用小气泡留二期，Header 任务中心入口设计定稿见 [PLAN-F](PLAN-F-jobs-center.md)。

## workflow 内核 cancel（粗粒度）

kernel `WorkflowRunner` 加 `cancel(runId)`：置 aborted 标志，每个 activity 边界检查并抛 `CancelledError`（不掐正在跑的单次模型调用，跑完当前步即停；journal 保留，可 rerun 恢复）。sibling 仓改 + sync。

## sidecar 清理范围

拆除：harness `runSidecarPasses` 两个调用点 + `SidecarRunContext`/`AppliedSidecarMerge`/`frame.activeSidecar`/`requiredResultToolName` 分支 + `report_sidecar_result` 工具与 schema + `profiles/types.ts` `Sidecar*` 类型与 `sidecars` 声明面 + `builtin.result.sidecar` + `simulator.actor.profile.tsx` sidecar 声明 + 相关测试 + `reference/agent/sidecar-profile-pass.md` 归档。

**功能影响**：`simulator.actor` 失去 context-load 记忆预载（RP tick actor 扮演前的第一人称记忆旁路）。处置两案：
- 甲：纯删，RP actor 记忆旁路暂缺（RP 线后续用 workflow/job 重建）；
- 乙：拆机制同时用普通子 session invoke 在 actor profile prepare 内重建等效行为（工作量 +中）。

## 分期

- **一期（已实现）**：JobManager + 登记表 + followup 回流 + caller invocation/append 合同 + 三管理工具 + run_workflow 默认后台（wait 保留）+ bash/invoke background + HTTP 面 + kernel cancel + sidecar 清理（按拍板方案）+ summarizer/backgroundTasks 的 close 等待并入 waitIdle（行为不变）。
- **二期**：summarizer 完整 Job 化（进列表可观测/可 force）；任务中心 UI（设计定稿 [PLAN-F](PLAN-F-jobs-center.md)）；bash 流式输出查询；run-as-session 持久化。

## 拍板记录（2026-07-20）

1. **sidecar：纯删**。simulator.actor 记忆旁路暂缺，RP 线以后用 workflow/job 重建。
2. **中途消息：invoke 语义，推翻「静默 notify」设计**。「workflow 调用和用户调用是一样的」——workflow 对 caller 的交互 = `wf.caller()` 返回的普通 SessionHandle 上执行 `invoke`，触发一轮真实 harness 调用并等待结果；轻量不思考的写树使用同一 handle 的 `append`。caller 忙碌时当前 HarnessAgentPort 仍 fail-fast，统一 busy admission 留后续。
3. **run_workflow 默认后台 + wait:true 保留；bash / invoke_agent 加 background** ✓。
4. **崩溃恢复薄登记表一期做** ✓。

### 追加需求 E2：invoke_agent 工具加强

- `model?: string`：本次 invocation 的模型 override（不改 session 默认；`assertVisibleModel` 校验）。`InvokeAgentInput` 补 modelKey override 面。
- 返回值规范化：content 文本 = `report_result.result` ?? 最后一条 AI 消息；details 补 `{status, data, finalMessage, sessionId}` 结构化面。与 workflow 内 `wf.agents.invoke` 的返回语义对齐（同一套「agent 返回值」定义）。
- `background?: boolean`：true 时包成 job，结果 followup 回流。
- 后台 V1 只承载可直接 settle 的非交互调用：通过 `queueIfBusy:false` 禁止忙碌目标悄悄入队；若本次调用进入用户输入/审批 waiting，Job 失败并保留目标现场。跨 HITL 自动续接需要把 resume、持久 followup queue 与取消归属一起建模，留二期。

### 追加需求 E3：ad-hoc agent（免 profile 创建，系统性方案）

需求：拆书这类场景需要「提示词 + 结构化输出 schema」直接造一个简单 agent，不写 profile 文件。

**方案：内置 `adhoc` profile，用 profile 体系本身表达 ad-hoc**（不给 create_agent 开旁路）：

- 新内置 profile `adhoc`：`InitialSchema = {name?: string; systemPrompt: string; outputSchema?: object(JSON Schema)}`。
- `outputSchema` 动态成为该 session `report_result` 的 dataSchema（校验层运行时按 initial 解析）；有 schema 时 system prompt 附「必须调用 report_result 且 data 符合 schema」纪律。
- V1 工具面固定为 read + report_result；`initial.tools` 动态白名单需要 prepareRun 支持运行时收窄，留二期。
- 消费面天然统一：`create_agent({profileKey:"adhoc", initial:{...}})`、workflow 内 `wf.agents.create("adhoc", {initial, model})`，审批/只读模式/catalog 可见性全套机制免费继承。
- 不做：运行时注册新 profileKey、per-call 匿名 profile 对象——都会破坏 catalog/编译产物体系。

**E3 定稿细化（2026-07-20 二轮拍板，勿重议）：**

1. **拒绝完整 defineProfile 进 workflow**：TSX 会造出平行于正式编译体系的影子编译链（双真相源=技术债），且 agent 同时接 workflow + profile DSL 两套系统上下文接不住、审批卡不可读。「精简版 defineProfile」的正确形态 = **纯数据 spec**（上面的 initial），不是代码 DSL。表达力渐进解锁走加受控数据字段，不开代码口子。
2. **typebox 宿主注入**：workflow 求值作用域注入 `Type`（与 `wf` 平级；`new Function` 多传一参），outputSchema 合同=「JSON Schema 对象」——`Type.Object({...})` 与裸字面量都合法（typebox 产物即 JSON Schema）；运行时校验统一 typebox `Value.Check`。禁 import 红线不动。
3. **不加 initial.humanMessage**：分界固定「initial=角色（稳定），invoke.message=任务（每次）」；few-shot/格式示范写进 systemPrompt。
4. **不做 inputSchema**：PayloadSchema 的价值在陌生调用方合同；adhoc 调用方=定义它的同段 workflow 代码，无价值。参数拼 message；外部文件 workflow 先 `wf.workspace.read` 再拼。
5. **outputSchema 走 report_result**（不用 provider 结构化输出：支持参差+与工具循环冲突）：`report_result` 为 adhoc 常驻根工具；V1 的另外一个根工具固定为 read，不开放 `initial.tools`。有 schema→data 必填且按 initial 校验（`reportResultSchemaForProfile` 层支持从 session initial 取 schema）+ prompt 纪律；无 schema→report_result 文本汇报，调用方按「report_result 优先、否则最后一条 AI 消息」统一规范取返回值。
6. **ephemeral 口径**：不给 adhoc 做默认 ephemeral 特判（kernel 默认持久是 D14 通用拍板；按 profileKey 改默认=魔法）。推荐写法 `ephemeral: true` 固定进 reference 示例——run 成功自动归档（失败/挂起留现场，rerun 重放复用同 session）；需跨 run 记忆的参与者用 `acquire({profileKey, tag})`。
7. 开放问题（二期议）：目录级配套 profile——`workflows/<key>/profiles/*.profile.tsx` 由正式编译体系收编，服务「workflow 需要复杂配套 profile」场景。
