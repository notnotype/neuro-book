---
schema: nbook.spec/v1
kind: behavior
status: implemented
capability: agent.sessions
owners:
  - nbook.agent
---

# Agent 的会话服务

## 目标与非目标

`nbook.agent` 在服务端持有 Agent 会话：会话放在状态根、跨项目；窗口经远程服务建会话、发指令、读日志、订阅运行，关掉窗口运行照常，再打开时补齐；别的插件经 `agent.startTask` 以某个 Profile 发起一次任务。

不承诺：

- 只有浏览器能经远程服务调用；项目实例要用时另加按项目绑定的校验。
- 不做“积压过多就断开”：远程通道没有发送背压（[`runtime/plugin-channel.md`](../runtime/plugin-channel.md)），只把流式增量合并压低帧数。
- 资源方案只有 `session://`；其余由资源能力定义。
- 审批只有按模式的最小规则（输出 4），没有按工具的规则表。
- 没有压缩方法与出站过滤。
- 旧格式的会话不在读取时转换。

## 术语与参与者

- **句柄表**：服务端里每个会话一条记录，管打开、复用与关闭。
- **引用**：正在用一个打开着的会话的东西（执行中的指令与查询、订阅、等运行结果）。
- **视图**：交给调用方的 `SessionApi`；它本身不持引用，每次调用时向句柄表取会话。
- **任务**：经 `startTask` 发起的会话与它的第一次运行。

会话、指令、查询、帧见 [`harness/runtime.md`](../harness/runtime.md) 与 [`harness/session.md`](../harness/session.md)。

## 输入与前置条件

- 会话目录：`<状态根>/agent/sessions/<会话 id>/`（日志格式见 [`harness/session.md`](../harness/session.md)）；`session://` 是其中的 `home/`。
- 远程服务 `nbook.agent/sessions`，版本 1，服务端提供，调用方 `browser`：

| 方法 | 读写 | 作用 |
|---|---|---|
| `list({project?, archived?, background?})` | 读 | 会话列表（缺省不列后台会话） |
| `create({profile, initial?, project?})` | 写 | 建会话 |
| `send`、`enqueue`、`edit`、`remove`、`resolve`、`start`、`abort`、`rewind`、`switchBranch`、`fork`、`compact`、`changeSettings`、`changeProfile`、`setTitle`、`archive` | 写 | 内核的指令，各带 `sessionId` 与 `commandId` |
| `snapshot`、`log`、`rewindTargets`、`path`、`siblings`、`runResult`、`preview`、`diagnostics` | 读 | 内核的查询，各带 `sessionId` |
| `eventChunk({sessionId, seq, index})`、`previewChunk({token, index})` | 读 | 分段读回大的事件与预览 |
| `profiles()` | 读 | Profile 目录（[`agent/contributions.md`](contributions.md) 输出 7） |
| `startTask({taskId, profile, initial?, input, project?, background?})` | 写 | 发起任务 |

- 事件 `frames`，过滤 `{sessionId}`：内核的帧（`log`、`delta`、`status`、`diagnostic`、`progress`）。
- 服务键 `agentKey`（服务端同进程）：`create(options)` → 视图或失败码；`session(id, issuer?)` → 视图；`list(filter?)`；`profiles()`；`running()` → 正在运行的会话 id（不含后台会话，planned）；`startTask(...)` → `{sessionId, runId, result: Promise<RunResult>}`。服务停止后调用抛出码为 `unavailable` 的错误。
- 依赖：设置与状态根是必需的；模型服务可选。

## 输出与可观察行为

1. **存放与列表。** 会话存放在状态根，记关联的项目；`list` 缺省列出所有不归档、不是后台的会话，可按项目、归档、后台筛。
2. **调用方身份。** 经远程服务的指令与查询都以用户的身份进内核；会话之间的身份（父会话应答子会话的提问）只经同进程的 `agentKey`。
3. **校验与失败码。** 从浏览器来的输入按结构校验（用户的话、附件、提问的回答、设置补丁；只有 Profile 定义的 `payload`、`data` 是自由 JSON），不合的得通道的 `invalid-input`、不进日志。每个方法交回它在内核里会得到的业务失败码，详情按码的 schema（内核没有详情的码不带详情，打开会话的码带可选的对象）；通道自己的失败（`unavailable`、`timeout`、`unknown-outcome` 等）照通道合同，不与业务码混用。
4. **审批。** 只读的工具放行；会话处在只读模式时其余都问（只读模式优先于审批模式）；`yolo` 全放行；`allow-writes` 放行写入；其余停下等用户（`ask`）。
5. **句柄的复用。** 同一会话同时到达的打开得到同一个打开的会话，不会第二次碰会话锁；建会话完成后直接是打开的。
6. **句柄的关闭。** 没有引用、没有运行、30 秒内没有调用时关闭；关闭中到达的调用等关闭完成后重新打开。视图不挡关闭，调用方可以长期拿着它，下次调用时重新打开。
7. **订阅。** 每个 `frames` 订阅持有一个内核订阅，订阅结束时一起取消；会话打不开时订阅以失败结束（调用方的 `onEnd` 看得到），不会“订阅成功却没有帧”。流式增量在订阅内合并：同一请求、同一部分、同一工具调用的连续增量拼成一帧，100 毫秒最多推一次；任何别的帧到达前先推出攒着的增量；合并后的增量按本订阅从 1 重新编号；合并后超过 64 KiB 就切开。多个窗口订阅同一会话，各自合并、互不影响。
8. **补齐。** 调用方先订阅、再用 `log({afterSeq})` 补到 `through`，丢掉 seq 不大于它的帧；通道重连后（`onResync`）按最后收到的 seq 再补一次。补齐只看日志的 seq，不补增量。服务端换了进程时订阅以 `server-restarted` 结束，调用方重新开始。
9. **大小。** 远程结果与帧都不超过通道的单条消息上限：
   - `log` 的条目是 `{kind: "event", event}` 或 `{kind: "oversized", seq, type, bytes}`；一条事件编码后超过 256 KiB 时是后者，`frames` 里的日志帧同样；每页按条数与编码后不超过 512 KiB 两者取小，`more` 照实给；
   - `eventChunk` 把整条事件按 JSON 编码后按 256 KiB 切段，`{text, last}`，调用方按序拼起来再解析；
   - `preview` 的结果是 `{kind: "inline", preview}` 或 `{kind: "oversized", token, bytes}`，大的经 `previewChunk` 同样分段读，令牌 5 分钟有效；
   - `path` 按页读（`from` 是从根数起的下标，交回 `next`），`diagnostics` 按页读（`after` 是上一页最后一条诊断的 id，交回 `next`），按 `afterSeq`、`extension`、`level` 筛；诊断里的长文字截到 4 KiB；
   - 快照、运行结果、回退目标、兄弟节点不分页，编码后超过 512 KiB 时得 `result-too-large`。
10. **发起任务。** `startTask` 用 `task-<taskId>` 作会话 id 建会话，再以 `taskId` 作 `commandId` 发一次 `send`（空闲时同时开始运行），返回 `{sessionId, runId}`，不等运行结束；结果从 `runResult` 取，运行结束时 `frames` 里有 `runEnded`。`taskId` 是调用方生成的 UUID。
11. **任务的幂等。** 同一个 `taskId` 重发得到同一个 `{sessionId, runId}`，服务端重启后也一样；会话已建、`send` 前失败的，重发补上 `send`。会话已存在但 Profile、项目或 `background` 与这次的参数不同，或同一个 `commandId` 带了不同的输入，得 `task-conflict`。
12. **后台。** `background: true` 写进会话头，`list` 缺省不列；从它 fork 的会话是前台。
13. **模型服务不在。** 会话照常打开、能读；发出模型请求时以 `no-model` 失败。
14. **停止。** `nbook.agent` 停止时：先拒绝新的调用（远程与 `agentKey` 都得 `unavailable`，新订阅以同样的原因结束）；停 Profile 的监听，等进行中的打包结束、丢掉结果；等已接纳的打开、建会话与指令登记完，把所有打开着的会话按 `interrupted` 关闭（运行写 `interrupted`，重新打开后显示“上次运行被中断”，不自动续跑）。某个会话关闭失败写诊断，其余照常关闭。

## 状态与转换

句柄表的一条记录：

| 状态 | 事件 | 下一状态 |
|---|---|---|
| 无 | 调用到达 | 打开中 |
| 打开中 | 打开成功 | 已打开 |
| 打开中 | 打开失败 | 无（这次调用得失败码） |
| 已打开 | 引用归零、没有运行 | 已打开，开始 30 秒计时 |
| 已打开 | 计时到、复查仍无引用与运行 | 关闭中 |
| 关闭中 | 关闭完成 | 无（等着的调用重新打开） |

时序与寿命：

- 订阅从建立起收到之后写下的帧；建立之前的用 `log` 补（输出 8）。
- 指令、查询在执行期间，订阅在取消之前，`waitRun` 与 `startTask` 的 `result` 在完成之前持有引用。
- `startTask` 返回时运行已开始（或已排在缓冲区里）；返回之后会话可能因空闲被关闭，结果仍能从 `runResult` 取到。
- 停止开始后到达的调用都得 `unavailable`，不会再打开会话。

## 副作用与数据

- 会话日志与 `home/` 在 `<状态根>/agent/sessions/<会话 id>/`；删除会话不在本 Spec。
- 预览的令牌只在内存里，5 分钟后或服务停止时丢弃。

## 失败与恢复

| 码 | 含义 | 调用方怎么办 |
|---|---|---|
| `task-conflict` | `taskId` 对应的会话参数不同，或输入不同 | 换一个 `taskId` |
| `result-too-large` | 不分页的结果放不进一条消息 | 改用分页的查询（`log`、`path`）读 |
| `session-not-found`、`session-busy`、`log-broken`、`read-only` 等 | 内核与存储的码，见 [`harness/session.md`](../harness/session.md)、[`harness/runtime.md`](../harness/runtime.md) | 按各自的说明 |
| `unavailable`（通道） | 服务正在停止或没激活 | 稍后重试；写操作带同一个 `commandId` 或 `taskId` 重发 |
| `unknown-outcome`（通道） | 写请求发出后断线 | 带同一个 `commandId` 或 `taskId` 重发，得到同一个结果 |

## 边界与兼容

- 公开接口：远程合同 `nbook.agent/sessions` 版本 1、服务键 `agentKey`、会话目录的位置。
- 远程合同的输入输出与内核的类型一一对应（大小一节的投影除外），内核类型改了合同跟着改版本。
- 信任边界：浏览器是用户本人；同进程的插件经 `agentKey` 可以用任何身份。

## 验收与 Smoke

1. 窗口 A 建会话、发一条消息、在流式输出中途关掉；窗口 B 订阅并用 `log` 补齐，看到完整的回复；断开 B 的连接再连上，`onResync` 后补齐不漏不重。
2. 两个窗口同时首次打开同一个会话、同时发指令：都成功，只打开一次；都退订后 30 秒会话关闭，再来一条指令时重新打开。
3. `startTask` 写请求发出后断线得 `unknown-outcome`，带同一个 `taskId` 重发得到同一个 `{sessionId, runId}`；运行结束后 `runResult` 给出收尾工具的参数。
4. 一个工具结果超过 1 MiB：`log` 与帧里是占位，经 `eventChunk` 读回完整的事件。
5. 停止 `nbook.agent` 时一个运行在跑、一个会话正在打开：两者都按 `interrupted` 关闭，之后的调用得 `unavailable`。

Smoke：`packages/neuro-book/src/plugins/agent/` 的插件测试与 `agent.llm.test.ts`。

## 实现合同

- **公开入口**：`nbook/plugins/agent/shared/contracts`（服务键 `agentKey`、`AgentService`、`StartTaskOptions`、`taskSessionId`）、`nbook/plugins/agent/shared/remote`（远程合同 `agentSessionsContract` 与 `LogItem`、`PreviewItem`、`RemoteFrame` 投影）。
- **owner 与依赖方向**：`nbook.agent` 的服务端入口持有句柄表、远程提供方与 `agentKey`；会话日志由内核的 JSONL 存储写在 `<状态根>/agent/sessions/`。浏览器经远程合同调用，同进程的插件经 `agentKey`。
- **关键不变量**：
  - 句柄表是会话打开、关闭与引用的唯一所有者：同时到达的打开共用一次，交出的视图不持引用、每次调用时取会话，空闲关闭在同一个同步段里复查（输出 5、6，`agent.test.ts`“会话”）。
  - 停止先关门（服务的每个入口），再停用户 Profile 的打包、等在建的会话登记完，最后按 `interrupted` 关闭（输出 14，`agent.test.ts`“停止时还在建的会话”“停止时运行中的会话”）。
  - 远程结果与帧不超过一条消息：分页的按字节截断并给游标，大事件与大预览分段读，不分页的超限得 `result-too-large`（输出 9，`sessions.test.ts`、`backend/frames.test.ts`）。
  - 每个远程订阅自己的内核订阅与合并缓冲，会话打不开时订阅失败（输出 7、8，`sessions.test.ts`）。
  - 任务的幂等记录就是会话日志：会话 id 由 `taskId` 定，`send` 的 `commandId` 就是 `taskId`（输出 10、11，`tasks.test.ts`）。

## 证据

- 批准依据：w00032 t10 决定 1–8 与实施阶段的决定 9–15（[Task README](../../../.agents/works/w00032-agent-integration/tasks/t10-agent-plugin/README.md)）；t03 决定 4、5，t07 决定 7；开发者 2026-11-01 批准晋升为 `implemented`。
- 实现入口：[`backend/sessions.ts`](../../../packages/neuro-book/src/plugins/agent/backend/sessions.ts)（句柄表）、[`backend/agent.ts`](../../../packages/neuro-book/src/plugins/agent/backend/agent.ts)（装配、`agentKey`、`startTask`）、[`backend/remote.ts`](../../../packages/neuro-book/src/plugins/agent/backend/remote.ts)、[`backend/frames.ts`](../../../packages/neuro-book/src/plugins/agent/backend/frames.ts)、[`shared/remote.ts`](../../../packages/neuro-book/src/plugins/agent/shared/remote.ts)
- 合同测试：[`sessions.test.ts`](../../../packages/neuro-book/src/plugins/agent/sessions.test.ts)（真实远程链路、断线重连）、[`tasks.test.ts`](../../../packages/neuro-book/src/plugins/agent/tasks.test.ts)（`startTask` 与 `unknown-outcome` 重发）、[`agent.test.ts`](../../../packages/neuro-book/src/plugins/agent/agent.test.ts)（句柄表与停止）、[`backend/frames.test.ts`](../../../packages/neuro-book/src/plugins/agent/backend/frames.test.ts)
- Smoke：[`agent.llm.test.ts`](../../../packages/neuro-book/src/plugins/agent/agent.llm.test.ts)（`test:llm`，DeepSeek 经远程合同跑一轮）
