# Agent Jobs

本文登记后台 Job 的快照、事件恢复、背压和生命周期稳定合同。Session 事件合同见 [sse.md](sse.md)；Jobs 使用独立全局 EventHub，不进入按 `sessionId` 隔离的 Session EventHub。

## 数据模型

公开类型真相源是 `shared/dto/agent-job.dto.ts`。

- `AgentJobSnapshot`：列表和事件使用的有界快照，包含身份、状态、时间、`ref`、preview 与 error，不含完整结果。
- `AgentJobDetail`：单 Job GET 返回，在快照上按需增加完整 `result`。
- `AgentJobEventCursor`：`{eventEpoch, after}`；`after` 是快照已经覆盖的最后一个全局事件 seq。
- `AgentJobStartDto`：`{jobId, jobEventCursor}`；游标精确指向该 Job 首次 `job_upserted(running)` 事件。
- Job 状态：`running | waiting | completed | failed | cancelled | interrupted`。
- `deliveryStatus`：执行状态之外的结果回流状态。`not_required` 表示没有 owner 或显式关闭回流；`pending` 表示等待直接投递或进入队列；`accepted` 表示已直接接收或可靠进入 follow-up queue；`failed` 表示投递失败，失败原因在 `deliveryError`，不改写 Job 的执行终态。

Job 的运行期列表由内存 Map 投影，跨进程 durable truth 位于 `<Workspace Root>/.nbook/agent/jobs/<jobId>.json`。每个文件保存公开终态、完整 `result`、已解析的 kind 详情、Session/usage 摘要和结果回流的稳定消息身份；服务重启后终态历史重新加载到列表。

## Durable 历史与重启

- terminal Job 必须先完成单文件的原子 durable commit，再发布 `completed`、`failed`、`cancelled` 或 `interrupted` 的列表快照和 SSE 事件。commit 失败时不得公开 `completed`。
- 进程启动会读取所有 durable 文件。`running` / `waiting` 只能收口为 `interrupted`，不会伪造旧结果，也不会重启旧 Workflow；已完成 Job 的完整结果仍可通过详情接口读取。
- 旧 `jobs.jsonl` 只作为迁移输入：只把遗留 `running` / `waiting` 行转换为 `interrupted`，不能从旧登记表伪造 terminal result；原文件保留供审计，之后不再追加。
- 单个 JSON 文件损坏或身份不匹配时，会移出正常 `jobs/` 目录并保留原始内容，其他 Job 继续恢复；该 Job 不会被猜测为 completed。
- “清除已结束”显式删除对应 durable 文件；`deliveryStatus=pending` 的 Job 必须等结果可靠进入队列或被标记 `failed` 后才能删除。不设置猜测性 TTL。

## HTTP 快照

`GET /api/agent/jobs?ownerSessionId=&status=` 保留过滤能力，返回：

```ts
type AgentJobListResponseDto = {
    jobs: AgentJobSnapshot[];
    eventCursor: {eventEpoch: string; after: number};
};
```

Manager 必须在同一同步方法内读取列表与游标。客户端先取得快照，再从该游标建立 SSE；快照后、建连前产生的变化由 replay 补齐。

过滤参数严格校验：`ownerSessionId` 只能是正整数，`status` 只能是公开 Job 状态；数组、未知字段和非法值返回 HTTP 400，`data.code = "INVALID_AGENT_JOB_LIST_QUERY"`，`data.issues` 保留 Zod issues。非法查询不能静默投影为空列表。

`GET /api/agent/jobs/:jobId` 只在需要完整 `result` 或 kind-specific `detail` 时按需调用，不是状态观察接口。HTTP 路由、Agent `get_job` 和任务中心共用 `AgentJobManager.get()`；详情 provider 异步读取 Workflow Run，避免各入口分别拼装合同。

Workflow Job 的 `detail` 形状为：

```ts
{
    runId: string,
    workflowKey: string,
    runStatus: "running" | "waiting" | "completed" | "failed" | "cancelled",
    pendingAsks: PendingAsk[],
    sessions: Array<{sessionId, profileKey, title, tokens}>,
    usage: WorkflowUsage,
    result: JsonValue | null,
}
```

`usage` 是公开 token 投影，不包含价格 `cost`；`result` 是已完成 Run 的完整结构化返回值。详情读取失败不会改变执行状态，调用方仍可看到快照和执行结果（若已有）。

## 回流状态

Job 执行完成、失败、取消和中断都保留自己的 `status`。当 Job 需要把结果送回 owner Session 时，Manager 另外维护 `deliveryStatus`：

- `pending`：结果尚未被 owner 直接接收，或尚未可靠写入 follow-up queue；
- `accepted`：直接 invocation 已被接收，或 queue 已持久化，后续由 Harness drain；
- `failed`：回流返回错误或抛异常。Manager 不自动重试，也不把它伪装成执行失败；完整结果从 `get_job` 和任务中心详情读取；
- `not_required`：没有 owner，或入口明确使用 `deliver: "none"`。

回流使用显式系统消息身份。直接投递、忙时队列、队列 drain 和重启恢复都写入系统消息投影（`custom_message`），不会进入普通用户消息 projection。恢复时每条中断通知独立处理；一条失败不会阻塞其他 Job，也不会启动新的重试协调器。

## Jobs SSE

端点：

```text
GET /api/agent/jobs/events?eventEpoch=<epoch>&after=<seq>
```

两项 query 都必填。事件流无 owner/status 过滤，单页面所有消费者共享一条连接。

`after` 只接受十进制非负整数字符串或非负整数；空串、小数、负数、数组和未知字段返回 HTTP 400，`data.code = "INVALID_AGENT_JOB_EVENTS_QUERY"`。`eventEpoch` 去除首尾空白后必须非空。

```ts
type AgentJobEventDto = {
    eventEpoch: string;
    seq: number;
    event:
        | {type: "connected"; eventEpoch: string; latestSeq: number}
        | {type: "snapshot_required"; reason: string}
        | {type: "job_upserted"; job: AgentJobSnapshot}
        | {type: "jobs_removed"; jobIds: string[]};
};
```

`connected` 是握手帧，不推进 seq，也不进入 replay。`job_upserted` 与 `jobs_removed` 是 durable 增量。`snapshot_required` 表示增量基线不再可信，客户端必须重新 GET 快照，不能猜测或跳过。

## 序号与恢复

- `eventEpoch` 在进程启动时随机生成；进程重启必然变化。
- durable 变化使用进程级全局递增 seq。
- 客户端丢弃 `seq <= after` 的重复帧。
- 下一 durable 帧必须满足 `seq === after + 1`；gap、epoch 变化或 `snapshot_required` 都触发单飞快照恢复。
- 游标缺 epoch、跨 epoch、超前或早于 replay floor 时，只向该订阅者发送 `snapshot_required`。
- replay 即使当前没有订阅者也保留，专门覆盖 HTTP 快照与 SSE 建连之间的窗口。

断线不立即 GET 快照。客户端从最后已应用游标按 `300/800/1500/3000/5000ms` 重连，之后保持 5 秒；短暂 `onOpen` 不清零失败序列，连接连续存活至少 5 秒后，下一次断线才从 300ms 重新开始。正常 EOF 与异常 rejection 都算断线；若 replay 已失效，服务端再用 `snapshot_required` 要求恢复。若首次快照本身失败，客户端还无法建立 SSE，此时按同一退避序列重试快照；首次成功后转入 SSE，健康期间不再周期 GET。

## 内存与背压

- replay：最多 500 帧、4 MiB，任一预算先到即从最旧帧裁剪。
- 每订阅者 live queue：最多 128 帧、1 MiB；超限只关闭该慢订阅者。
- 单个公开 SSE frame：最多 128 KiB。过大的 Job 快照降级为同 seq 的 `snapshot_required`。
- payload 在发布时经 JSON detach 与深冻结；replay 和 writer 共享一次序列化得到的 frame。
- Node writer 每次只向 response 写一帧；`write(false)` 后等待 drain。socket close/error、订阅 overflow 或 Hub close 都会清理监听器并结束 writer。

不发送 heartbeat。连接活性依赖现有 socket 关闭检测与客户端重连。

## Manager 发布时机

- spawn：Job 写入 Map 后、执行器同步代码运行前发布 running 快照，并把该实际发布帧的 epoch/seq 固化为启动回执。首次公开帧超限而降级时 spawn 失败，不返回没有创建事件的 Job。
- `setPreview()`：每 Job 250ms 尾沿合并，主要约束 bash stdout 分片洪峰。
- `setWaiting()`、`setRunning()`、terminal：取消待发 preview timer，立即发布包含最新 preview 的完整快照。
- `clearFinished()`：一次发布实际移除的 Job ID 列表。
- shutdown：先关闭 Job EventHub 和 preview timers；之后的取消/terminal 变化不再发布。
- shutdown 开始后拒绝新 spawn。

完整 Job 状态变化必须通过 Manager 上述入口完成。不要从 route、执行器或 UI 另建旁路事件。

## 前端消费

`useAgentJobsFeed(enabled)` 是页面级模块单例，Project/User Assets 工作面内的 Header、已打开的任务中心和有非空目标的 `useAgentJob()` 共用。consumer lease 由 feed Module 的 `consume(enabled)` 在 Vue effect scope 内自动管理，调用方不接触引用计数。初始 disabled 不请求快照或 SSE；false → true 的首个 consumer 读取一次原子快照并建流；true → false 只有在最后一个 consumer 离开时才 abort。Header 是徽标的常驻消费者，但只随 `projectSurfaceActive` 挂载；任务中心关闭即卸载自身 consumer。Project 选择页不挂载任何 Jobs consumer，因此不请求快照或事件流。

最后一个 consumer 卸载时只 abort 浏览器侧 SSE 与重连，不取消服务端 Job。重新进入工作面时读取一次原子快照，再以该游标建立一条 SSE，从而恢复离开期间的变化。feed 保留最后可信列表与最后已应用游标，使用 `shallowRef` 整体替换，避免递归 `JsonValue` 的深响应展开。

完整 `AgentJobsFeed` 只提供给任务中心，包含 `refresh()` 和 `clearFinished()`；只读 `AgentJobsFeedView` 只有状态与 `observe()`。`refresh()` 是任务中心的一次显式快照恢复；`clearFinished()` 成功后也只恢复一次。二者都不启动定时轮询。单 Job `AgentJobObserver` 只接收 View，从类型层没有全量刷新能力，也不发单 Job 状态 GET。

`useAgentJob(jobId, jobEventCursor)` 以 nullable Job ID 驱动 consumer。`null` 和防御性的空字符串都表示无观察目标，此时 `job=null`、`observation=pending`、`error=""`、不可取消且不持有 feed；A → B 切换保持同一 consumer 和 SSE，交由因果观察算法切换目标。

单 Job 观察必须调用 feed 的 `observe(jobId, jobEventCursor)`，状态固定为：

- `pending`：还没有创建游标，或已应用游标尚未覆盖创建点；
- `available`：无创建游标但列表已有 Job，或同 epoch 已覆盖创建点且 Job 存在；
- `unavailable`：同 epoch 已覆盖创建点但 Job 不存在，或 epoch 不同且随后一次快照恢复成功。

不同 epoch 初见时先恢复快照，不能直接判 unavailable。跨 epoch 恢复证据绑定完整目标 `{jobId, eventEpoch, after}` 与恢复开始时的快照 revision；观察目标在首次 consumer 快照应用前已登记时，该初始原子快照本身可以推进 revision 并完成收敛，不再重复 GET。切换 Job 即使复用相同游标也必须重新收敛，不能沿用前一个 Job 的证据。旧工具结果没有创建游标时，不允许以 loaded、延时或 missing 猜测不可用。完整决策见 [ADR 0003](../../docs/adr/0003-agent-job-observation-causality.md)。

Workflow RunView 是 Workflow 状态、结果和错误的唯一真相源，也是另一套更细的状态图/日志/待应答观察面。当前仍轮询 `/api/agent/workflow/runs/:runId`；Job 不可查询只关闭取消与 preview，不停止 Run 观察，也不覆盖 Run 终态。Job error 只能显示在明确标注的“后台任务”区域，不能进入 Workflow error。应答、重放与 Run 切换只重启 Run 轮询，不刷新 Jobs。不得把 Run 误记为已迁移到 Jobs SSE。

`/workflow.preview` 的正式入口在页面首次加载/手动刷新正式列表时显式 GET 一次 Jobs，用原子列表游标作为恢复出的 Run 观察基线；这是页面自己的正式列表读取，不是 Job observer 的刷新。demo 面板没有 Job ID，启动、切换、应答和重放均不取得 Jobs consumer，也不增加 Jobs GET/SSE。
