# ADR 0003：Agent Job 观察使用因果游标

- 状态：Accepted
- 日期：2026-07-27
- 关联任务：[Task 111 Plan G](../../.agents/tasks/111-workflow-agent-integration/PLAN-G-job-sse.md)

## 背景

后台工具的启动结果通过 Agent Session SSE 到达，Job 快照通过独立的 Jobs SSE 到达。两条连接各自有序，但彼此没有交付顺序保证。因此，前端先收到 `{jobId}`、随后在当前 Job 列表中找不到它，只能证明 Job 事件尚未到达，不能证明 Job 不存在。

旧实现以 `feed.loaded && !job` 推断 unavailable。它会在正常竞态中短暂显示“已中断”，并可能让 Workflow 气泡提前停止 Run 轮询。Job 被用户清除时，同一推断还会把已经完成的 Workflow 状态降级为 interrupted。

## 决策

每个成功启动的后台 Job 返回：

```ts
type AgentJobStartDto = {
    jobId: string;
    jobEventCursor: {eventEpoch: string; after: number};
};
```

`jobEventCursor` 必须来自该 Job 首次 `job_upserted(running)` 的实际发布帧。Manager 先发布，再启动执行器，并保存发布结果；不能在执行器启动后读取 Hub 当前游标，因为执行器的同步代码可能立即发布 waiting/running。shutdown 开始后拒绝 spawn，使成功回执必然对应一个创建事件。

前端由 Jobs feed 集中归约观察状态：

- `pending`：没有创建游标且列表中没有 Job，或 feed 尚未应用到创建游标。
- `available`：列表中有 Job，且没有游标；或同 epoch 的已应用 seq 已覆盖创建游标且 Job 存在。
- `unavailable`：同 epoch 的已应用 seq 已覆盖创建游标但 Job 不存在；或观察到 epoch 不同后，新一轮快照恢复成功且仍无法找到 Job。

跨 epoch 不能直接判 unavailable。feed 可能仍保留服务重启前的最后可信快照，而启动回执已经来自新进程；必须先成功恢复一次新快照。恢复期间保留最后可信列表和游标，由 generation guard 隔离旧响应。

跨 epoch 的恢复证据必须绑定完整观察目标 `{jobId, eventEpoch, after}`，并记录恢复开始时的快照 revision。观察器切换 Job 时，即使两个 Job 复用同一个旧游标，也必须为新目标重新恢复；只有目标仍匹配且快照 revision 已前进，才能判定 unavailable。不能把前一个 Job 的恢复完成当作后一个 Job 的不存在证据。

观察目标本身也是 consumer 所有权边界。无 Job ID 时不取得 Jobs feed consumer，也不继承 feed 的历史错误；`null -> A -> B -> null` 中 A 到 B 继续复用当前连接，回到 null 才释放该观察器的 consumer。初始目标与首个 consumer 同时建立时，目标登记后完成的初始原子快照可以作为跨 epoch 恢复证据，不需要再发一遍相同快照请求；目标切换后则必须为新目标取得新的 revision 证据。

没有 `jobEventCursor` 的旧持久化工具结果只能是 pending 或 available，不能通过等待时间、首次加载完成或列表缺失猜测 unavailable。

Workflow Run 是 Workflow 最终状态的唯一真相源。Job 只提供启动阶段提示、预览和取消能力；Job unavailable、cancelled 或 interrupted 不停止 Run 观察，也不能覆盖已经观测到的 Run 状态。只有 Run 终态、Run 404 或页面销毁停止 Run 轮询。

## 原因

服务端已经为 Jobs SSE 维护 epoch、全局 seq 和原子列表恢复点。把首次创建事件的实际游标带回调用方，复用了现有事件序模型，不需要增加第二次绑定快照、延时窗口、单 Job 轮询或持久 tombstone。

该合同提供的是可证明的“观察面是否越过创建点”，不是 exactly-once 交付，也不把 Job 提升为 Workflow 结果真相源。

## 后果

- 后台 `run_workflow`、`invoke_agent`、`bash` 和正式 Workflow HTTP 启动响应都必须携带创建游标。
- Job 列表过滤参数必须严格校验，避免非法过滤被误解为“列表为空”的存在性证据。
- 观察目标切换会触发一次受现有 single-flight 约束的恢复，不增加按 Job 状态或持久 tombstone。
- consumer 的引用计数由 feed Module 按 Vue effect scope 与动态目标统一管理；调用方不能手工 retain/release。单 Job 观察器只获得只读 feed view，不拥有手动全量刷新能力。
- Job 清除或服务重启后，取消与 preview 可能不可用，但 Run 仍按自己的接口收敛。
- Workflow 应答、重放和 Run 切换只重启 Run 观察，不得通过 Job 观察器刷新全量 Jobs。自动恢复与任务中心显式刷新是 Jobs 快照的两个入口。
- Workflow Run SSE 仍是独立后续事项；本 ADR 不改变当前 Run HTTP 轮询。

## 未采用方案

- 延时宽限：时间不能证明跨连接事件顺序，慢机器和重连会再次误判。
- 绑定观察器后额外读取一次列表：增加请求和竞态，仍需定义快照与创建的先后关系。
- 单 Job 周期轮询：恢复已经迁移掉的轮询成本，并让多个气泡重复请求。
- 持久 tombstone：为进程内 Job 列表引入新的持久状态模型，超出“证明是否越过创建点”的需求。
