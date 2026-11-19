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
- 没有出站过滤；压缩方法见 [`compaction.md`](compaction.md)。
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
| `send`、`enqueue`、`edit`、`remove`、`resolve`、`start`、`abort`、`rewind`、`switchBranch`、`fork`、`compact`、`changeSettings`、`changeProfile`、`setTitle`、`archive`、`resume`、`release` | 写 | 内核的指令，各带 `sessionId` 与 `commandId` |
| `snapshot`、`log`、`rewindTargets`、`path`、`treeNodes`、`branchPoints`、`siblings`、`runResult`、`preview`、`diagnostics` | 读 | 内核的查询，各带 `sessionId` |
| `eventChunk({sessionId, seq, index})`、`previewChunk({token, index})` | 读 | 分段读回大的事件与预览 |
| `profiles()` | 读 | Profile 目录（[`agent/contributions.md`](contributions.md) 输出 7） |
| `toolCatalog()` | 读 | 工具目录（同上输出 17） |
| `createUserProfile({name, description, system})`、`deleteUserProfile({key})` | 写 | 新建、删除用户级 Profile（同上输出 18） |
| `startTask({taskId, profile, initial?, input, project?, background?})` | 写 | 发起任务 |

- 事件 `frames`，过滤 `{sessionId}`：内核的帧（`log`、`delta`、`status`、`diagnostic`、`progress`）。
- 服务键 `agentKey`（服务端同进程）：`create(options)` → 视图或失败码；`session(id, options?)` → 按调用方盖章的视图（输出 21）；`list(filter?)`；`profiles()`；`running()` → 正在运行的会话 id（不含后台会话）；（planned）`hold(sessionId)` → 持有或失败码（输出 24）；（planned）`header(sessionId)` → 会话头或失败码（输出 28）；`startTask(...)` → `{sessionId, runId, result: Promise<RunResult>}`。服务停止后调用抛出码为 `unavailable` 的错误。
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
   - `preview` 的结果是 `{kind: "inline", preview}` 或 `{kind: "oversized", token, bytes}`，大的经 `previewChunk` 同样分段读，令牌 5 分钟有效；两种都是 JSON 编码后的样子，工具声明里按参数算的 `effect`（函数）不在里面；
   - `path` 按页读（`from` 是从根数起的下标，交回 `next`），`diagnostics` 按页读（`after` 是上一页最后一条诊断的 id，交回 `next`），按 `afterSeq`、`extension`、`level` 筛；诊断里的长文字截到 4 KiB；
   - 快照、运行结果、回退目标、兄弟节点不分页，编码后超过 512 KiB 时得 `result-too-large`。
10. **发起任务。** `startTask` 用 `task-<taskId>` 作会话 id 建会话，再以 `taskId` 作 `commandId` 发一次 `send`（空闲时同时开始运行；发出者是调用方，经远程是用户，经 `agentKey` 按调用方盖章（输出 21）），返回 `{sessionId, runId}`，不等运行结束；结果从 `runResult` 取，运行结束时 `frames` 里有 `runEnded`。`taskId` 是调用方生成的 UUID。
11. **任务的幂等。** 同一个 `taskId` 重发得到同一个 `{sessionId, runId}`，服务端重启后也一样；会话已建、`send` 前失败的，重发补上 `send`。会话已存在但 Profile、项目或 `background` 与这次的参数不同，或同一个 `commandId` 带了不同的输入，得 `task-conflict`。
12. **后台。** `background: true` 写进会话头，`list` 缺省不列；从它 fork 的会话是前台。
13. **模型服务不在。** 会话照常打开、能读；发出模型请求时以 `no-model` 失败。
14. **停止。** `nbook.agent` 停止时：先拒绝新的调用（远程与 `agentKey` 都得 `unavailable`，新订阅以同样的原因结束）；停 Profile 的监听，等进行中的打包结束、丢掉结果；等已接纳的打开、建会话与指令登记完，把所有打开着的会话按 `interrupted` 关闭（运行写 `interrupted`，重新打开后显示“上次运行被中断”，不自动续跑）。某个会话关闭失败写诊断，其余照常关闭。

15. 远程 `activity` 与事件 `activityChanged`：快照与事件，列出运行中与等用户的前台会话（`{id, state: "running" | "waiting"}`），只看打开着的句柄；先订阅后取快照，`onResync` 重取。异步提问不在内。空闲的前台会话里有只有用户能放行的留着的话（`heldBy` 是用户，或用户自己的话留着，[`harness/runtime.md`](../harness/runtime.md) 输出 105）时也列出，`state: "held"`。
16. 远程 `approvalPreview`，见 [`builtin-tools.md`](builtin-tools.md)。
17. 事件 `profileCatalogChanged`，没有过滤、没有载荷：只说目录变了（[`contributions.md`](contributions.md) 输出 16）。先订阅后取 `profiles`、`toolCatalog`，`onResync` 重取。
15. **附件。** 存在 `sessions://<会话 id>/home/attachments/<SHA-256>.<扩展名>`，写全局地址：`fork` 只复制日志，不用复制文件；原会话被删后按缺失处理。扩展名按 MIME 白名单定，图片按文件头认，声明是图片、文件头不是的（包括 SVG）按普通文件存。上传 `POST /api/nbook.agent/sessions/<id>/attachments`，体是文件字节，原名按百分号编码放 `X-Attachment-Name`；别的网页发起的拒绝；会话不存在 404；单个 25 MB，边读边数，超了 413，不信 `Content-Length`；同一内容已有算成功；交回 `{uri, kind, name, mime, bytes, width?, height?}`。读取 `GET`、`HEAD` 同前缀加文件名，文件名只接受哈希加扩展名；别的网页发起的拒绝；会话不存在 404（归档的还读得到）；所有响应带 `Content-Security-Policy: sandbox` 与 `nosniff`，位图内联，别的下载，`ETag` 用哈希。不做缩略图。发给模型前由内核的读取端口缩放（最长边 1,568，目标 500 KB，同 `read` 工具），原图不动；解不了的（损坏、格式不支持、像素超限）换一行字，不发原图。

18. 列表带父会话：`list` 的条目有 `parent?`，是会话头 `caller` 的会话 id（只在调用方是会话时）（[`harness/session.md`](../harness/session.md) 输出 22）；没有调用方的会话没有这一项。
19. 子代理与任务的远程：查询 `tree({sessionId})` 与事件 `treeChanged`（[`subagents.md`](subagents.md) 输出 21、22）、`ancestors({sessionId})`（同上输出 25）；`activity` 的条目加 `root`（根会话 id）；查询 `jobs({sessionId})`、`jobTail({sessionId, jobId, lines?})`、`jobStatuses({sessionId, jobIds})`、事件 `jobsChanged`、指令 `killJob({sessionId, jobId})`（[`jobs.md`](jobs.md) 输出 9–11）。都以用户的身份；这几项不为取数打开会话（读关系表、会话索引与任务中心），不存在的会话交回空（`tree`、`ancestors`、`jobs` 是空列表，`jobStatuses` 全是 null，`jobTail`、`killJob` 得 `job-unknown`）。`activity` 的 `waiting` 只算停在等用户的事项上（审批、交给用户的提问、模式切换请求，同 [`subagents.md`](subagents.md) 输出 21 的 `waiting`）；子会话停在交给派它的 Agent 的提问上算 `running`。
20. （planned）在跑的工作：`nbook.agent` 向宿主的 `runningWorkKey` 登记（[`runtime.server-host`](../runtime/server-host.md) 的“在跑的工作”），报出停止服务会中断的：有运行在跑或在等用户的会话，后台会话（`background: true`）也算，每个根会话一项“Agent 会话「<标题>」正在运行”或“…在等你处理”；任务中心里在跑的任务（[`jobs.md`](jobs.md)，含会话已空闲时还在跑的后台命令与子代理运行），每件一项，写命令或子代理名。
21. **按调用方盖章。** `agentKey` 按调用方门面提供（[`runtime/services.md`](../runtime/services.md) 输出 12）：插件拿到的会话视图（`session(id, options?)` 与 `create` 交回的）缺省的发出者是宿主 `{kind: "host", source: {plugin: 调用方插件, label, ref?, at?}}`，`plugin` 由门面填，`label`、`ref`、`at` 由调用方给，门面不接受调用方自填的插件身份；插件可以明说代替用户发（`{asUser: true}`），这时发出者是用户。门面随调用方停止或 `nbook.agent` 的服务实例释放而作废，之后的访问抛 `ServiceRevokedError`（[`runtime/services.md`](../runtime/services.md) 输出 12）；（planned）门面还在、服务正在停止时得 `unavailable`（输出 14）。会话的身份只给 `nbook.agent` 自己（子代理在内部按会话身份取句柄，不经 `agentKey`）：插件拿到的视图上 `as(issuer)` 同样经门面盖章，换成用户照准，换成宿主时 `plugin` 仍是调用方，换成会话身份抛错；插件建会话时给 `caller` 是会话的得 `not-allowed`。经远程合同来的都是用户。内核按发出者定权限（[`harness/runtime.md`](../harness/runtime.md) 输出 108），以这条为前提。
22. **缓冲区条目。** 快照与远程合同里缓冲区的每条带 `state`（`ready`、`held`），不是用户发的带 `by`（用户的不带），留着的带 `cause`、因停止留着的另带 `heldBy`，以及 `edits` 与完整的输入（含附件），按 [`harness/runtime.md`](../harness/runtime.md) 输出 103；`send` 的成功值带去向 `placement`（同上输出 110），`send` 的 `replaces` 与 `release` 选项、`resume`、`release` 照内核原样暴露，失败码 `not-allowed`、`nothing-to-resume`、`held-by-user`、`nothing-to-release`、`input-stale` 照输出 3 交回。
23. （planned）**归属。** `agentKey` 的 `create` 收可选的 `owner: {id}`，会话头的 `owner` 写成 `{plugin: 调用方插件, id}`（[`harness/session.md`](../harness/session.md) 输出 25）：`plugin` 由门面按调用方盖章，调用方只给 `id`，所以一个插件建不出归属别的插件的会话。`owner.id` 照会话头的规则校验，不合得 `invalid-owner`、不建会话。远程的 `create` 不收 `owner`（多出的字段得 `invalid-input`）。`fork` 出来的会话与子会话没有归属。门面盖章的发出者与交出的会话头是不能改的值，改了也不影响会话。
24. （planned）**持有。** `hold(sessionId)` 打开会话并持有一份引用，交回 `{ok: true, value: {release(), opened}}`，`opened` 是这次实际打开会话时的打开耗时（毫秒），复用已开的会话时为 null；打开失败时交回打开的码（`session-not-found`、`session-busy`、`log-broken`、`log-corrupt`、`needs-migration`、`storage-failed`、`open-failed`），调用方据此重试或报告，不只写诊断。持有期间会话不因空闲关闭（输出 6），`release()` 之后照常；同一个调用方可以持有几次，各自释放。门面作废时（调用方停止，输出 21）它的持有一并放掉，经它取得的会话视图（含 `as` 派生的）之后的调用抛 `ServiceRevokedError`，经这些视图建立的订阅一并取消；作废之后才交回的持有与订阅立即放掉。`nbook.agent` 停止时会话照输出 14 关闭，之后 `release()` 什么都不做。Profile 解析不到时会话以只读打开，持有照样成功（快照里看得到只读）。持有中日志写失败（`log-broken`）的会话，要等全部引用放掉、重新打开才能恢复（已知限制）。
25. （planned）**列表不列有归属的。** `list` 的结果不含有归属的会话，也不含它们的后代（按会话索引里的 `caller` 链，子会话、孙会话都算），远程与 `agentKey` 一样；有归属的根与父链取自同一次读到的全部会话索引（含后台与归档的），不受这次列表的筛选条件影响。中间的祖先没有索引时，断开处以下的会话照常列出（已知限制）。在跑的工作（输出 20）、活动（输出 15）与 `running()` 照样算它们。按 id 仍然读得到。
26. （planned）**有归属的会话不改写历史。** 对有归属的会话，`rewind`（含编辑重发、重试与 swipe）、`switchBranch`、`archive` 得 `owned-session`，不进内核、不写日志，没打开的会话也不先打开（按会话头判断）；读会话头失败时交回那个码，不打开、不执行；远程与 `agentKey` 的视图（含归属插件自己的）都一样。子会话不受这条限制。
27. （planned）**发话一并结算。** 远程与 `agentKey` 视图的 `send` 收 `settlePending: "deny"`，照内核原样（[`harness/runtime.md`](../harness/runtime.md) 输出 111）。
28. （planned）**读会话头。** `agentKey` 的 `header(sessionId)` 只读会话头、不打开会话（[`harness/session.md`](../harness/session.md) 输出 26）：会话不在得 `session-not-found`，读不懂得 `log-corrupt` 或 `needs-migration`。远程合同同样有只读方法 `header({sessionId})`，码相同（浏览器打开会话之前据此看归属，[`conversation.md`](conversation.md) 输出 53）。
29. **提醒与门。** 远程合同 `nbook.agent/sessions` 升到版本 2（旧版本的窗口连上得 `version-changed`）：快照带待发提醒的摘要 `notices: [{id, by, key?, wake, queuedAt, summary, bytes}]`（`summary` 是正文的开头、至多 200 个字符，`bytes` 是正文的 UTF-8 字节数；全文在取走之后经日志读）与门 `wakeGate`；写方法 `removeNotice({sessionId, noticeId})` 以用户的身份取消一条；发提醒的 `notice` 不在远程合同里。插件经 `agentKey` 拿到的会话视图有 `notice` 与 `removeNotice`，发出者照输出 21 按调用方盖章（行为见 [`harness/runtime.md`](../harness/runtime.md) 输出 112–118）。

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
| `owned-session` | （planned）会话有归属，不能改写历史或归档（输出 26） | 不做；有归属的会话只能往后写 |
| `invalid-owner` | （planned）建会话时 `owner.id` 不合（输出 23） | 改正后再建 |
| `session-not-found`、`session-busy`、`log-broken`、`read-only` 等 | 内核与存储的码，见 [`harness/session.md`](../harness/session.md)、[`harness/runtime.md`](../harness/runtime.md) | 按各自的说明 |
| `unavailable`（通道） | 服务正在停止或没激活 | 稍后重试；写操作带同一个 `commandId` 或 `taskId` 重发 |
| `unknown-outcome`（通道） | 写请求发出后断线 | 带同一个 `commandId` 或 `taskId` 重发，得到同一个结果 |

## 边界与兼容

- 公开接口：远程合同 `nbook.agent/sessions` 版本 1、服务键 `agentKey`、会话目录的位置。
- 远程合同的输入输出与内核的类型一一对应（大小一节的投影除外），内核类型改了合同跟着改版本。
- 信任边界：浏览器是用户本人；同进程的插件经 `agentKey` 缺省以自己插件的宿主身份发话，可以明说代替用户，门面不接受自填的插件或会话身份（输出 21）。

## 验收与 Smoke

1. 窗口 A 建会话、发一条消息、在流式输出中途关掉；窗口 B 订阅并用 `log` 补齐，看到完整的回复；断开 B 的连接再连上，`onResync` 后补齐不漏不重。
2. 两个窗口同时首次打开同一个会话、同时发指令：都成功，只打开一次；都退订后 30 秒会话关闭，再来一条指令时重新打开。
3. `startTask` 写请求发出后断线得 `unknown-outcome`，带同一个 `taskId` 重发得到同一个 `{sessionId, runId}`；运行结束后 `runResult` 给出收尾工具的参数。
4. 一个工具结果超过 1 MiB：`log` 与帧里是占位，经 `eventChunk` 读回完整的事件。
5. 停止 `nbook.agent` 时一个运行在跑、一个会话正在打开：两者都按 `interrupted` 关闭，之后的调用得 `unavailable`。
6. （planned）一个插件建有归属的会话并持有：`list` 不列它和它派的子会话，空闲 30 秒后它仍开着；远程的 `rewind`、`archive` 与归属插件自己视图上的 `switchBranch` 都得 `owned-session`、日志不变；插件停止后会话照常空闲关闭；远程 `create` 带 `owner` 得 `invalid-input`。

Smoke：`packages/neuro-book/src/plugins/agent/` 的插件测试与 `agent.llm.test.ts`。

## 实现合同

- **公开入口**：`nbook/plugins/agent/shared/contracts`（服务键 `agentKey`、`AgentService`、`StartTaskOptions`、`taskSessionId`）、`nbook/plugins/agent/shared/remote`（远程合同 `agentSessionsContract` 与 `LogItem`、`PreviewItem`、`RemoteFrame` 投影）。
- **owner 与依赖方向**：`nbook.agent` 的服务端入口持有句柄表、远程提供方与 `agentKey`；句柄表的实现是 nb-harness 宿主套件的 `SessionTable`（`@notnotype/nb-harness/kit/sessions`），实例与计时口由 `nbook.agent` 给，“等用户”里总要用户答的提问（模式切换请求，输出 19）经它的 `userOnly` 给；会话日志由内核的 JSONL 存储写在 `<状态根>/agent/sessions/`。浏览器经远程合同调用，同进程的插件经 `agentKey`。
- **关键不变量**：
  - 句柄表是会话打开、关闭与引用的唯一所有者：同时到达的打开共用一次，交出的视图不持引用、每次调用时取会话，空闲关闭在同一个同步段里复查（输出 5、6，`agent.test.ts`“会话”，nb-harness 的 `kit/sessions/table.test.ts`）。
  - 停止先关门（服务的每个入口），再停用户 Profile 的打包、等在建的会话登记完，最后按 `interrupted` 关闭（输出 14，`agent.test.ts`“停止时还在建的会话”“停止时运行中的会话”）。
  - 远程结果与帧不超过一条消息：分页的按字节截断并给游标，大事件与大预览分段读，不分页的超限得 `result-too-large`（输出 9，`sessions.test.ts`、`backend/frames.test.ts`）。
  - 每个远程订阅自己的内核订阅与合并缓冲，会话打不开时订阅失败（输出 7、8，`sessions.test.ts`）。
  - 任务的幂等记录就是会话日志：会话 id 由 `taskId` 定，`send` 的 `commandId` 就是 `taskId`（输出 10、11，`tasks.test.ts`）。

## 证据

- 批准依据：w00032 t10 决定 1–8 与实施阶段的决定 9–15（[Task README](../../../.agents/works/w00032-agent-integration/tasks/t10-agent-plugin/README.md)）；t03 决定 4、5，t07 决定 7；开发者 2026-11-01 批准晋升为 `implemented`；缓冲区条目的就绪与留着、放行、继续与停止的两个选项（本 Task 加的条目）依据 [提案：输入缓冲区](../../proposals/agent-input-buffer-states.md)（2026-11-18 接受）与 [w00043 t14](../../../.agents/works/w00043-neurobot/tasks/t14-input-buffer-states/README.md)，逐句核对后晋升（[核对处理](../../../.agents/works/w00043-neurobot/tasks/t14-input-buffer-states/evidences/promotion-check-disposition.md)）。
- 实现入口：nb-harness 的 [`kit/sessions/table.ts`](../../../packages/nb-harness/src/kit/sessions/table.ts)（句柄表）、[`backend/agent.ts`](../../../packages/neuro-book/src/plugins/agent/backend/agent.ts)（装配、`agentKey`、`startTask`）、[`backend/remote.ts`](../../../packages/neuro-book/src/plugins/agent/backend/remote.ts)、[`backend/frames.ts`](../../../packages/neuro-book/src/plugins/agent/backend/frames.ts)、[`shared/remote.ts`](../../../packages/neuro-book/src/plugins/agent/shared/remote.ts)
- 合同测试：[`sessions.test.ts`](../../../packages/neuro-book/src/plugins/agent/sessions.test.ts)（真实远程链路、断线重连）、[`tasks.test.ts`](../../../packages/neuro-book/src/plugins/agent/tasks.test.ts)（`startTask` 与 `unknown-outcome` 重发）、[`agent.test.ts`](../../../packages/neuro-book/src/plugins/agent/agent.test.ts)（句柄表与停止）、nb-harness 的 [`kit/sessions/table.test.ts`](../../../packages/nb-harness/src/kit/sessions/table.test.ts)（空闲关闭的时序）、[`backend/frames.test.ts`](../../../packages/neuro-book/src/plugins/agent/backend/frames.test.ts)；输出 15、21、22：`sessions.test.ts`（“缓冲区条目经远程”）、`tasks.test.ts`（“按调用方盖章”）
- Smoke：[`agent.llm.test.ts`](../../../packages/neuro-book/src/plugins/agent/agent.llm.test.ts)（`test:llm`，DeepSeek 经远程合同跑一轮）
