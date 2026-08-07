# ADR 0014：Agent Job 终态历史的单文件持久化

- 状态：Accepted
- 日期：2026-08-07
- 关联任务：[Task 142](../tasks/142-post-merge-reliability-hardening/README.md)、[Task 111 Workflow 接入](../tasks/111-workflow-agent-integration/README.md)
- 相关参考：[Agent Jobs](../../reference/agent/jobs.md)

## 背景

原有后台 Job 的完整结果只在当前进程内存中保留，`jobs.jsonl` 只记录状态登记。进程在 Job 完成后、结果回流前崩溃时，用户可能看到任务已完成，却无法重新读取完整结果或可靠投递结果。

本轮需要保住用户真正需要的终态结果和结果回流身份，但不把 Workflow 的完整运行日志、状态图、逐步时间线或断点续跑一起升级为持久化产品能力。

## 决策

### Durable truth

每个 Job 使用一个文件：

```text
<Workspace Root>/.nbook/agent/jobs/<jobId>.json
```

文件保存 schema version、公开 Job snapshot、完整 `result`、已完成时可解析的 kind 详情、公开 Session/usage 摘要和结果回流所需的稳定 `deliveryId` / `clientMessageId`。写入使用同目录临时文件、文件 `fsync` 和原子 rename；支持目录同步的平台再同步目录。

Job 终态必须先完成 durable commit，再发布终态列表快照或 SSE 事件。终态 commit 失败时不能公开 `completed`；如果失败本身也无法持久化，运行期只能公开“结果保存失败”的 `failed`，不伪造已完成结果。

### 重启

- durable 文件中的 `completed`、`failed`、`cancelled` 和 `interrupted` 重新进入任务列表；
- `running` / `waiting` 转为 `interrupted`，结果标记为进程重启丢失，不自动续跑；
- terminal Job 的 Run 详情不可用时，保留 Job 自身已保存的终态和结果；界面提示运行细节不可用，不能把 completed 降级为 interrupted；
- `deliveryStatus=pending` 使用原有 stable delivery identity 重新尝试进入 Harness 的 durable follow-up queue；`accepted=queued` 只重新触发已有队列 drain，不重复写入用户消息。

### 旧登记表与损坏文件

旧 `<Workspace Root>/.nbook/agent/jobs.jsonl` 只作为迁移输入。仅迁移最后状态仍为 `running` / `waiting` 的 Job，转为 `interrupted`；旧表不包含足够信息时不能伪造 terminal result，且原文件保留供审计，之后不再追加。

无法解析或身份不匹配的单个 durable 文件会被改名移出正常 `jobs/` 文件名范围，并保留原内容。该文件对应的 Job 不进入列表，其他文件继续恢复；日志记录 Job ID 和隔离路径，便于人工诊断。

### 生命周期

“清除已结束”是唯一的用户触发清理入口，同时删除内存列表条目和对应 durable 文件。结果仍处于 `pending` 回流的 Job 不允许清除；不增加没有产品依据的自动 TTL。

## 不在本 ADR 范围内

- 不持久化 Workflow 图、journal、逐步时间线或 pending ask；
- 不实现 Workflow 断点续跑、旧 Run 重建或跨进程恢复运行中的模型调用；
- 不改数据库 schema，不增加第二套 Job 状态服务；
- 不自动迁移或删除旧缓存、Session、trace、日志和用户数据。

## 后果

- 用户重启服务后仍能看到已结束 Job，并读取已保存的完整结果；
- 结果回流可能在重启后继续进入原有 durable queue，但 Provider 回合是否已经完成不属于 Job durable truth；
- 运行中 Job 会明确显示为 interrupted，用户需要重新发起，不会得到假装续跑的结果；
- 单文件损坏不会阻塞整个任务中心，但需要人工决定是否恢复或删除隔离文件；
- Workflow 细节仍由当前进程的 Run API 提供，重启后只能显示 Job 已保存的终态和结果。
