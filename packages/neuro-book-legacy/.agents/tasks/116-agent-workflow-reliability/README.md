# Task 116：Agent 与 Workflow 可靠性收口

状态：已实施并完成聚焦验收（2026-07-22）；浏览器、真实 provider 与真实 Project Workspace 验收待用户执行。

上游：[Task 111：Workflow 正式接入 NeuroBook Agent](../111-workflow-agent-integration/README.md)。

## User Request / Topic

本任务统一收口 Task 111 实现与代码审查后暴露的 Agent Invocation、后台 Job、Workflow Run、结果回流和 Catalog 可靠性问题。

用户要求：

1. 排查 Leader 派发子 Agent 后，子 Agent 在 provider API error 等异常路径卡住、不再返回，并进一步阻塞 Leader 的问题；用户已实测 cancel 接口存在无法取消的情况。
2. 删除现行文档中的 Sidecar 能力介绍，暂不补充新的替代宣传；历史任务和归档资料保留历史性质。
3. 修复 Workflow Run 标识在服务或 Runner 重建后复用的问题。已知证据：
   - 失败运行：[workspace/.nbook/agent/sessions/755.jsonl:72](../../../workspace/.nbook/agent/sessions/755.jsonl#L72)
   - 后续成功运行：[workspace/.nbook/agent/sessions/755.jsonl:100](../../../workspace/.nbook/agent/sessions/755.jsonl#L100)
   - 两次运行都显示为 `run_1`，导致日志关联和故障追踪产生歧义。
4. Workflow 完成通知必须：
   - 用 `<system-reminder>` 包裹；
   - 直接返回完整 JSON，不使用 Markdown code fence；
   - 不截断 Workflow 自定义结果；
   - 返回完整总用量；
   - 返回每一个参与 session 的完整 token 用量；
   - `get_job` 同样返回完整 JSON，不得截断。
5. 修复 Project Workspace `.nbook/agent/workflows` 未被 Workflow Catalog 识别的问题。真实项目中的 `brainstorm-opening` 已存在，但当前 Catalog 只报告 `parallel-brainstorm`、`split-book`、`write-review-loop`。
6. 将 Task 111 审查中与同一生命周期链相关的取消、waiting、dispose、持久化乱序和前端异步竞态问题一起审计并收口；不处理无关 Git 变更。

## Goal

让 Agent Invocation、后台 Job 与 Workflow Run 在正常完成、provider/API error、waiting、取消、服务释放和服务重建等链路下都能进入一致、可观察且不会永久占用 admission 的终态；让 Workflow Catalog 按稳定覆盖规则发现 Project Workspace workflow；让 Workflow 完成通知和 `get_job` 消费同一个完整结构化结果合同。

完成必须由以下证据证明：

- 一个不响应 AbortSignal、但可在断言后释放的 provider/tool 测试，证明 cancel 在固定期限内解除目标 session 和前台 `invoke_agent` 调用，迟到结果不能污染 transcript 或产生第二个终态。
- running、waiting、最后一个 activity 边界的 Workflow cancel 回归，证明 Job 与 Run 均为 `cancelled`，且 waiting Run 不能 resume/rerun。
- Harness dispose 回归，证明长期 waiting Job 不会阻塞停服。
- Run ID 跨 Runner 实例不重用的测试。
- Project Workspace Catalog 的列出、同名覆盖、工具执行、正式 API 和 prompt 可见性测试。
- 大于 4000 字符的 Workflow 结果，以及多 session、多轮 invocation、cache/reasoning/cost 用量测试，证明通知和 `get_job` 均无截断且统计完整。
- 相关聚焦测试和 typecheck 通过；不自动执行浏览器验证，浏览器与真实 provider 验收由用户确认后另行进行。

## Current State

### Task 111 基线

- Task 111 已接入 WorkflowCatalog、后台 `run_workflow`、AgentJobManager、Job/Run 前端观察面和三个 bundled workflow。
- Run、Job 与事件观测仍以进程内状态为主；run-as-session 持久化和公共 SSE projection 尚未完成。
- PLAN-E 已删除 Sidecar runtime，但现行文档仍有遗留介绍。

### 当前边界

- 本任务的诊断与实现已经完成；只审查和修改本任务明确列出的可靠性链路，不回退或整理无关变更。
- Run/Job 观测和结果仍主要以内存为真相源；跨服务重建后的 durable result、run-as-session 持久化与公共 SSE projection 不在本任务范围。

## Diagnosis

### D1：子 Agent 卡住会同步阻塞 Leader

#### 现象

- 前台 `invoke_agent` 直接等待 `harness.invokeAgent()`。
- 目标子 Agent 如果卡在 provider async iterator、`stream.result()` 或工具 Promise 上，Leader 的工具调用也不会返回。
- 用户调用 cancel 后可能仍长期看到目标 session 占用，Leader 同样没有恢复。

#### 已确认根因

当前 `NeuroAgentHarness.abortInvocation()` 只完成：

1. 将 active invocation 标记为 `aborting`；
2. 触发 `AbortController.abort()`；
3. 向接口调用方返回“已请求取消”。

真正释放 `activeInvocations` 仍依赖原 provider/tool Promise 自行 settle，随后才会进入失败收口和 admission 释放。如果底层异步操作忽略 signal 或永不 settle，session 会永久停在 `aborting`。

这也说明 cancel 接口的当前成功响应只代表 signal 已发出，不代表 invocation 已终止。

#### 影响范围

- 目标子 Agent session 无法继续使用。
- 前台 `invoke_agent` Promise 不返回，Leader 被连带阻塞。
- Harness dispose 或依赖 idle 的测试/停服链可能被拖住。
- 如果只强制删除 active 状态而没有 fencing，迟到 provider 结果可能继续写 session、重复落 terminal lifecycle。

#### 系统性修复约束

修复不能只是给 `invoke_agent` 外面套一个文本超时。必须同时解决执行权、终态唯一性和迟到写入：

1. 为每个 invocation 建立明确的外部完成 promise/settle 边界。
2. cancel 触发 signal 后等待一个短、固定的宽限期。
3. 宽限期后仍未 settle，由 Harness 强制提交一次 `aborted` terminal、释放 admission，并让等待该 invocation 的调用方有界返回。
4. 所有 finalization、completion、failure 和关键 transcript 写入前校验 `(sessionId, invocationId)` ownership。
5. 原 provider/tool Promise 迟到后发现 ownership 已失效，丢弃结果，不得二次落库或覆盖 aborted 状态。
6. provider 单次请求还应有独立的有界 timeout，防止 API error/retry/stream 异常在用户未主动 cancel 时无限悬挂；该 timeout 与整轮 Agent invocation 的长任务时限不能混为一层。
7. JS 无法硬杀一个不合作的 Promise 或已产生的外部副作用；本任务保证的是 Harness admission、session transcript、调用方 promise 和终态投影有界收口。

### D2：Workflow cancel、Job cancel 与 waiting 状态分裂

#### 已确认根因

- 原 Workflow cancel 主要设置 abort 请求，在 activity 边界生效。
- waiting Workflow 没有正在推进的 activity，因此可能持续保留 `waiting`，即使对应 Job 已收到 cancel。
- Run 与 Job 会出现一个仍 waiting、另一个已经 cancel/cancelling 的状态分裂。
- waiting Job 会使 `jobs.waitIdle()` 长期不返回；Harness dispose 直接等待 idle 时可能永久阻塞。

#### 修复合同

- `RunStatus` 必须有一等 `cancelled` 终态。
- waiting Run cancel 后立即进入 `cancelled`、清除 pending asks，并禁止 resume/rerun。
- 最后一个 activity 执行期间 cancel，迟到的成功不能覆盖 `cancelled`。
- Job 观察到 Run cancelled 时必须同步进入 cancelled，不应转换成 generic failure。
- AgentJobManager 提供停服专用的 `shutdown()`：取消 running/waiting Job，等待执行、回流与持久化全部落定。
- Harness dispose 使用 shutdown，而普通 `waitIdle()` 继续保持“真的等到所有 Job 落定”的语义。

### D3：Run ID 在服务重建后复用

#### 已确认根因

原 Runner 使用实例内自增计数器：

```ts
private nextRunId = 1;
runId: `run_${this.nextRunId++}`
```

Runner 或服务重建后计数器从 1 重新开始，因此 session 755 中失败与成功运行都可能显示为 `run_1`。这不是 Run 持久化本身导致的，但会放大当前内存观测面的歧义。

#### 修复合同

- Run ID 使用跨 Runner 实例不重用的 UUID 形状。
- ID 唯一性与 Run 持久化分开处理：本任务先消除标识复用；run-as-session 持久化仍是后续独立架构工作。
- 服务重启后尚未持久化的活动 Run 仍应明确表现为 interrupted/unavailable，不能伪装成另一个新 Run。

### D4：Workflow 通知和 `get_job` 缺少完整结果真相源

#### 已确认根因

- `workflow-job.ts` 对超过 4000 字符的结果主动裁剪，并提示“完整结果用 get_job 查询”。
- AgentJobManager 原来只保存有界 `preview`，没有保存完整结构化 outcome。
- `get_job` 需要重新查询进程内 Workflow Run；它不是完整结果的稳定真相源，服务重建后也无法恢复。
- 通知与 `get_job` 各自重新拼装字段，存在合同漂移风险。
- Task 111 的 Workflow journal usage 原来只保留 input/output，无法恢复 cache、reasoning、totalTokens 和 cost 等 provider 已提供字段。

#### 结果合同

Job 列表与 Job 详情必须分离：

- `list_jobs` / Job list HTTP 只返回轻量快照和有界 preview，避免一个列表请求携带全部大型结果。
- 单 Job detail、`get_job` 和完成通知消费同一份完整 `result`，不做字符裁剪。
- 一期完整结果仍是进程内 Job detail；跨服务重建的 durable Job/Run result 不在本任务中伪造完成，重建后按 interrupted/unavailable 报告。

Workflow 完成结果的计划形状：

```json
{
  "runId": "run_<uuid>",
  "workflowKey": "split-book",
  "status": "completed",
  "result": {},
  "sessions": [
    {
      "sessionId": 123,
      "profileKey": "adhoc",
      "title": "章节分析",
      "tokens": {
        "inputTokens": 100,
        "outputTokens": 50,
        "cacheReadTokens": 20,
        "cacheWriteTokens": 0,
        "totalTokens": 170,
        "cost": {
          "input": 0,
          "output": 0,
          "cacheRead": 0,
          "cacheWrite": 0,
          "total": 0
        }
      }
    }
  ],
  "usage": {
    "inputTokens": 100,
    "outputTokens": 50,
    "cacheReadTokens": 20,
    "cacheWriteTokens": 0,
    "totalTokens": 170,
    "cost": {
      "input": 0,
      "output": 0,
      "cacheRead": 0,
      "cacheWrite": 0,
      "total": 0
    }
  }
}
```

如果 provider 提供 `cacheWrite1hTokens` 或 `reasoningTokens`，同样必须累计并保留；没提供时字段缺省，不能伪造为真实观测值。

完成通知固定为：

```xml
<system-reminder>
[后台 Workflow 完成]
{完整 JSON}
请根据该结果向用户汇报，或继续后续编排。
</system-reminder>
```

不使用 Markdown code fence，不输出“截断后用 get_job 查询”提示。

### D5：Project Workspace Workflow 未进入 Catalog

#### 现象与证据

项目文件真实存在于：

```text
workspace/ming-ding-zhi-shi-2/.nbook/agent/workflows/brainstorm-opening/workflow.ts
```

但当前 Catalog 错误只报告 bundled/user 层的：

```text
parallel-brainstorm、split-book、write-review-loop
```

#### 已确认根因

WorkflowCatalog 原来只有两层根目录：

1. Bundled Workspace Template 中的 system workflow；
2. Workspace Root `.nbook/agent/workflows` 中的 user-assets workflow。

它没有接收当前 session 所属 Project Workspace 的物理根，因此完全不会扫描 `<Project Workspace>/.nbook/agent/workflows`。

#### 修复合同

正式覆盖顺序为：

```text
Bundled system → Workspace Root .nbook user-assets → Project Workspace .nbook
```

后层同名目录整体覆盖前层。以下入口必须使用同一个项目化 Catalog 解析结果：

- `list_workflows`
- `run_workflow`
- 正式 Workflow catalog/run HTTP API
- `/workflow.preview`
- Project-bound Leader 的 WorkflowCatalog prompt
- Profile preview/prepare 中的 WorkflowCatalog prompt

Project Workspace 切换时，前端请求必须使用 revision 或等价的 latest-request-wins 约束，避免旧项目响应覆盖新项目 Catalog。

### D6：Job JSONL 状态可能乱序

- `spawn`、`setWaiting`、`setRunning` 原来通过多个 fire-and-forget `appendFile` 写入。
- terminal write 即使被 await，也不能保证早先的 running/waiting append 已经完成。
- 服务恢复按最后一行判断状态，乱序时可能把已完成 Job 误判为 interrupted。

修复应使用单一 promise queue 串行 append；terminal、recover 和 shutdown 必须等待队列落定。

## Task 111 Review Items Included

以下问题与本任务的生命周期或项目化 Workflow 链直接相关，后续实现阶段一并核对；未通过测试前不标记完成：

- `WorkflowRunPanel.vue` 切换 run 时旧响应覆盖新 run、ask 草稿串到其他 run。
- 未回答的 Workflow ask 被自动补成 `false`、`[]` 或空字符串，而不是阻止提交并指出缺失应答。
- `useAgentJob.cancel()` 在切换 job 时，旧 cancel/refresh 响应可能污染新 job。
- `/workflow.preview` 切换 Project Workspace 时 Catalog 请求竞态。
- Workflow Catalog `argsHint` 缺少完整 runtime validation。
- ad-hoc `outputSchema` 非法时存在 fail-open 风险，必须 fail-closed。
- Workflow 启动初期的观测事件可能发生在 EventBuffer 初始化前而丢失。
- `split-book` 面对空 manuscript 时不应继续调用模型。
- Workflow `cancelled` 状态需要同步到 service waiter、RunState、工具 details、气泡状态归约和状态文案。

## Decisions / Discussion

- 本任务采用统一可靠性 Task，不再为上述五项分别创建碎片任务。
- Agent cancel 与 Workflow cancel 是两套状态机，但必须通过 Job/collaboration adapter 传播一致终态；不能把二者混成一个布尔 `cancelled` 补丁。
- cancel 的系统性保证是“调用方和 Harness 状态有界收口 + 迟到结果 fenced”，不是声称 JavaScript 可以强杀所有第三方 Promise。
- Run ID 唯一性本轮修复；Run/Job 完整跨重启持久化继续保留为后续架构工作。
- Workflow JSON 是结果真相，短 preview 只是列表/UI 摘要；不能从 preview 反向恢复结果。
- session 统计必须列出每个触达 session。没有发生模型调用的 session 仍保留，`tokens` 为 `null`；同 session 多轮 invocation 的 usage 累加。
- Sidecar 现行介绍只删除，不在本轮用 Workflow 文案大段替代；历史 walkthrough 和归档合同保留。
- 不处理与其它任务无关的 Git 变更。
- 不自动进行浏览器验证；自动化聚焦测试通过后再向用户建议真实 Project Workspace、真实 provider 和浏览器走查。

## Implementation Plan

### Phase A：锁定回归反馈环

- 新增不响应 AbortSignal 的可控 provider/tool 黑盒夹具。
- 新增 running/waiting/last-activity Workflow cancel 测试。
- 新增 dispose + waiting Job 测试。
- 新增大型 Workflow JSON、多 session、多轮完整 usage 测试。
- 新增 Project Workspace Catalog 全链测试。

### Phase B：收口底层状态机

- 在 sibling `nb-workflow` 修改 Run ID 和 `cancelled` 终态，再通过正式同步脚本回灌 vendor。
- 实现 Agent invocation completion boundary、cancel grace deadline 和 ownership fencing。
- 实现 AgentJobManager shutdown 与 JSONL 串行写。
- 对齐 Workflow Run、Job、service waiter、HTTP 和 UI 的 cancelled 终态。

### Phase C：完整结果与 Catalog

- 拆分 Job summary/detail，保存完整结构化 result。
- 完成通知改为 `<system-reminder>` + 完整 JSON。
- `get_job` 返回完整格式化 JSON，不经过 preview/clip。
- 将完整 provider usage 写入 Workflow journal，并按每 session/总量汇总。
- 完成 system/user/project 三层 Catalog 在工具、API、prompt 和 preview 的统一接入。

### Phase D：Task 111 审查项与文档

- 修复 run/job/project 切换竞态、ask 校验、schema fail-closed、首事件丢失和空稿预检。
- 删除现行 Sidecar 介绍，保留历史/归档内容。
- 更新本任务 walkthrough；所有实现与验证完成后同步 `PROJECT-STATUS.md`。

### Phase E：验证与最终审查

- 运行 sibling `nb-workflow` 全套测试和 NeuroBook 聚焦测试。
- 运行 `bun run typecheck`。
- 按 Task 116 相关 diff 做最终代码审查，不审无关 Git 变更。
- 报告实际实现与本计划的出入、未执行的浏览器/真实 provider 验收及剩余 TODO。

## Implementation Walkthrough

### 2026-07-21 至 2026-07-22：诊断与提前发生的部分实施（历史记录）

在用户明确要求“先别动手修”之前，连续的 `continue` 已使工作进入部分实施；以下记录保留当时边界，已被后续正式实施记录覆盖。

已确认并已部分修改：

- sibling `nb-workflow`：
  - Run ID 从实例内计数器改为 UUID。
  - `RunStatus` 增加 `cancelled`。
  - waiting Run cancel 后禁止 resume/rerun。
  - 最后一个 activity 期间 cancel 时，迟到成功不能覆盖 cancelled。
  - Workflow journal 的 invocation usage 合同开始扩展为完整 token/cost 字段。
  - 已运行 `bun test`：16 项通过、0 项失败。
  - 已运行 `bun scripts/cli/sync-nb-workflow.ts` 回灌 NeuroBook vendor。
- Project Workflow Catalog：
  - 已开始增加 `project` source 和 Project Workspace 覆盖层。
  - 已开始接入 `run_workflow`、`list_workflows`、正式 API 和 `/workflow.preview`。
- 当时尚未完成 prompt 全链、前端 revision 和聚焦验证；后续已完成。
- AgentJobManager / Workflow result：
  - 已开始拆分 Job 轻量快照与完整 detail。
  - 已开始保存完整结构化 result、增加 `<system-reminder>`、移除 4000 字符裁剪。
  - 已开始增加 shutdown/cancelActive 与 JSONL persist queue。
  - 已开始适配完整 usage 和 Run cancelled。
- 当时相关代码和测试尚未完成整体校正；后续已完成聚焦测试和 typecheck。
- 前端：
  - 已开始适配 Workflow `cancelled` 和 Project Catalog。
- 当时切换竞态、ask 缺失校验等审查项尚未完成；后续已完成。

已完成：

- Harness 有界取消、外部 invocation completion boundary 和迟到结果 fencing。
- 子 Agent provider/tool 忽略 AbortSignal、cancel 连带 Leader 的黑盒回归。
- Harness dispose 正式接入 Job shutdown。
- 现行 Sidecar 文档删除，历史任务和归档资料保留。
- Task 116 聚焦测试、typecheck 和相关 diff 审查。

### 2026-07-22：Task 116 实施与验证

- 用户确认实施 Task 116；Run/Job/Harness、Workflow Catalog、完整结果与前端竞态统一收口。
- Harness 对不响应 AbortSignal 的 provider/tool 在 150ms 宽限后强制提交唯一 aborted 终态，释放 admission，迟到结果按 invocation ownership 丢弃；dispose 使用 Job shutdown，不再被 waiting Job 卡住。
- invocation ownership 校验下沉到统一 SessionWriteExecutor 的物理写入锁内，覆盖 transcript、tool sink、runtime hook 与 lifecycle；即使 settle hook 在强制取消后才恢复，也不能追加迟到 session 状态。
- Workflow Run 使用 UUID；waiting/running/last-activity cancel 统一到 cancelled，禁止 cancelled resume/rerun；Job JSONL 以单 Promise queue 串行持久化。
- Job detail 保存完整 result；通知与 `get_job` 使用同一份完整 JSON，通知统一 `<system-reminder>`；list 仍只返回有界 preview。Workflow usage 按 session 和 run 累加完整 token/cache/reasoning/cost 字段。
- Harness invocation usage 改为累加一次 ReAct invocation 的每个 provider turn；Workflow journal 不再只记录最后一个 assistant turn 的 token/cost，因而 session 与总计统计覆盖多轮工具调用。
- Catalog 覆盖顺序收口为 system → Workspace Root user-assets → Project Workspace，并接入工具、API、prompt、preview；项目切换使用 latest-request-wins。
- 补齐 ad-hoc schema fail-closed、split-book 空稿预检、首事件缓冲、Workflow cancelled 前端归约、ask 缺失阻止提交、Run/Job/cancel 请求 fencing。
- 删除现行 Sidecar 能力介绍；保留 `docs/tasks/**` 与 `docs/archived/**` 历史材料。

## Verification / Test

已获得的实现验证：

- sibling `nb-workflow`：`bun test`，18 pass / 0 fail（含 `wf.all` 并发 Agent activity 取消回归）。
- NeuroBook Task 116 最终宽集合：15 个 Test Files、116 项通过（包含 Harness、Agent collaboration、Workflow、Catalog/API、Job、profile 与前端 Workflow 气泡回归）。
- 本轮新增 signal/Catalog 聚焦集合：4 个 Test Files、5 项通过；其中包含前台/后台 invocation signal、Workflow AgentPort、`wait:true` 和 Project Workspace catalog 工具/API 证据。
- `bun run typecheck`：通过。
- Sidecar 现行文档扫描（排除 tasks/archived/drafts/public）：0 命中。

### 计划与实际差异

- 原计划为 provider 请求另加超时层；实际沿用现有 Provider Config `timeoutMs` 下沉 Pi provider 的请求超时，不再制造第二套 timeout，并用 Harness cancel watchdog 处理不合作 Promise 的有界释放。
- 最终代码审查额外发现 settle hook 的迟到 session 写入窗口，因此 ownership fence 进一步下沉到统一 SessionWriteExecutor，并新增对应黑盒回归。
- 原计划按用户要求多 Agent 并行；本次协作调度接口持续返回 `unsupported`，实施和最终审查由主 Agent 完成。
- 未自动执行浏览器、真实 provider 或真实 Project Workspace 验收；这些仍保持为手工验收边界。
- 共享工作树中 Task 117 与其他变更不属于本任务；本任务没有整理、回退或计入这些改动。

本轮补强的计划与实际差异：

- 没有新增公开 invocation handle；以内部 `AbortSignal` + admission 后精确 invocation 绑定完成取消归属，避免扩大公共 API。
- 没有增加第二套全局 Promise timeout；继续使用已有 provider `timeoutMs`，Harness watchdog 只负责不合作调用的取消收口。
- 没有对任意非 Agent 自定义 Promise 做强制竞态隔离；JavaScript 无法回滚外部副作用，本轮只对 Agent invocation、Workflow journal、Run/Job 状态提供有界合同。

尚未执行：

- 浏览器验证。
- 真实 provider API error/cancel smoke。
- 真实 Project Workspace `brainstorm-opening` Catalog/运行验收。

## TODO / Follow-ups

- [x] 完成 Harness cancel watchdog/completion boundary/fencing。
- [x] 完成 AgentJobManager shutdown 与 Harness dispose 接入。
- [x] 完成 Job/Workflow 完整 JSON 与完整 usage 合同。
- [x] 完成 Run/Job cancelled 全链适配。
- [x] 完成 Project Workspace Workflow Catalog 工具、API、prompt、preview 全链。
- [x] 收口 Task 111 review items。
- [x] 删除现行 Sidecar 介绍。
- [x] 运行聚焦测试和 typecheck。
- [x] 更新本 README 的实际实施/验证/计划出入。
- [x] 更新 `PROJECT-STATUS.md` 的 Task 116 状态。
- [ ] 经用户同意后执行浏览器、真实 provider 与真实 Project Workspace 验收。

### 2026-07-22：Task 117 外部进程收口

- 后台 Bash 继续复用本 Task 的 AgentJobManager AbortSignal、cancelled 状态与 Harness shutdown；OS 进程树生命周期下沉到 `@notnotype/owned-process`，没有在 Job 状态机里复制 Windows Job Object 逻辑。
- `cancel_job` 与 Harness dispose触发AbortSignal后，Bash lease先完成完整进程树与stdio收口，再让Job执行Promise落定；迟到输出仍受本Task的Job completion boundary约束。
- Task 117真实Bun + Git Bash timeout/abort、后台Job cancel与Harness shutdown smoke已通过；AgentJobManager本轮未新增第二套取消状态。
- Bash最终错误只读取lease completion reason，解决timeout先发生、清理期间abort覆盖分类的竞态；前后台OutputAccumulator在ownership failure与`finish()`自身失败时仍关闭临时文件。

### 2026-07-22：取消链与 Workflow 生命周期补强

最终审查发现，Task 116 已完成 Harness 自身的强制取消，但上层传播仍有遗漏：前台 `invoke_agent` 未接收 Leader signal，后台 invoke 的取消钩子按 session 猜测目标，Workflow Agent activity 与 `run_workflow(wait:true)` 未共享取消上下文，前端可能在 Job cancelled 后停止 Run 轮询。本轮补齐这些链路：

- `InvokeAgentInput.signal` 在 Harness admission 成功后绑定到精确 invocation；父 Leader 和后台 Job 不再按 session 猜测取消对象。
- Harness 外部 signal listener 的解绑跟随公开 invocation completion boundary；即使 watchdog 强制返回而底层 Promise 迟迟不 settle，也不会遗留旧监听器。
- sibling `nb-workflow` 的 Run signal 下沉到 `AgentPort`，activity 取消后不再提交迟到 journal；vendor 已通过 `sync:nb-workflow` 回灌。
- `HarnessAgentPort`、`run_workflow(wait:true)`、前后台 invoke 均接入 signal；并发 `wf.map` / `wf.all` 共享 Run 取消上下文，并有 `wf.all` 多 Agent 取消回归。
- Workflow Run 轮询不再因为 Job cancelled 直接停止；Job 仍以 Run 执行链最终收口为 cancelled。
- 独立 Run 面板与聊天 Workflow 气泡共用同一轮询判定：Job cancelled 响应先到时继续读取 Run，直到 Run 自身终态；Run 404、Job unavailable/interrupted 才提前停止。
- 增加精确 signal、Workflow Job/AgentPort、wait:true、Project Catalog 工具和正式 catalog API 回归测试。
- 更新现行 Workflow Reference 与 cancel 工具合同；Task 117 的 owned-process 生命周期保持复用。

### 2026-07-22：本轮审查补强

- 发现 queued follow-up 的 queue item id 被误当成 invocation ownership，导致标题投影写入被新 fencing 拒绝；已将排队项标题写入明确归类为 admission 元数据写入，只有已接收 invocation 才使用 execution ownership fence。
- 新增真实临时 Project Workspace → Profile prepare preview 测试，确认项目层 `brainstorm-opening` 进入 Project-bound prompt，且使用与 Catalog/API 相同的项目根解析。
- 新增 `runSummary()` 多 session、多轮 invocation、cache/reasoning/cost 累加测试，并覆盖无模型调用 session 的 `tokens: null` 合同。
- 新增 provider async iterator 抛错与 `stream.result()` rejection 测试，验证错误结果、单一 error lifecycle、admission 释放和同 session 后续重试均能收口。
- 本轮新增回归共 3 个文件、4 项测试；该组测试、前一轮 9 文件 37 项聚焦集合及 `bun run typecheck` 均通过。sibling `nb-workflow` 仍为 18 pass / 0 fail。
- 按用户要求未处理工作树中的其他任务变更，也未执行浏览器、真实 provider 或真实 Project Workspace 手工验收。

### 2026-07-27：summarizer ownership fence 生产回归

- session 773 的摘要失败证明 Task 116 的 invocation ownership fence 正常工作：session 774 的隐藏 summarizer invocation 不应直接获得 session 773 的写入权。
- 根因是受管 summarizer Profile 比 Harness 内存测试 Profile 多出一个跨 session `settleRun` hook，不是需要放宽 fence 的新业务例外。
- 受管 Profile 已删除该 hook，source session 写回继续由 Harness 在隐藏 invocation 正常结束后统一完成；真实受管 Profile 已覆盖“无 settleRun hook + 正常标题/摘要写回 + source leaf 变化重跑 + 用户标题锁只更新摘要”三条聚焦回归。
