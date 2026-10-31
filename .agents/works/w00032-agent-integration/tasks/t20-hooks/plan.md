# t20 实施计划（第二版）：harness 事件模型内核

第一版（提交 04d13a262）经六位审查者审查（omp、Claude Opus、四个 Claude Sonnet：接口形状、开发体验、代码组织、拉远看），108 条（阻断 8、重要 70、建议 30），报告在 `evidences/plan-review-r1-*.txt`，逐条处理见 [`evidences/plan-review-r1-disposition.md`](evidences/plan-review-r1-disposition.md)。第二版按处理结果重写。第二轮快速审查（Claude Opus 19 条：重要 13、建议 6，`evidences/plan-review-r2-opus.txt`）的处理已并入本版，逐条见处理表第二节；omp 的第二轮报告（13 条：阻断 3、重要 9、建议 1，`evidences/plan-review-r2-omp.txt`）也已并入，见处理表第三节。

## 1. Context

**为什么做**：w00032 接入 Agent 的各个 Task（t03 会话、t05 Profile、t06 审批、t07 运行控制、t09 模型、t10 插件、t11 压缩、t14 多 Agent）都建在 harness 内核上。t20 讨论定了内核的形状：一台由日志驱动的异步状态机（[提案第五稿](../../../../../docs/proposals/agent-harness-event-model.md)），开发者 2026-10-29 认可，实施时排在最前。

**期望结果**：`@notnotype/nb-harness` 里有一个能用的新内核：指令进、帧出；日志是唯一真相源；扩展与 Profile 用同一套接口；回退、重启、压缩由日志归约自动正确；插件作者能用真内核写测试；nb-story 现在依赖的语义（收尾工具、运行结果、`complete()`、错误归类、密钥遮盖、停服收尾）在新内核里都有对应，紧接的迁移 Task 不必改内核。

**依据**：提案第五稿；接口原型 [`spike/v5/`](spike/v5/api.ts)（第 1 片按本计划改成定稿类型）；能跑的参照是第三稿 spike（`spike/kernel.ts`、`core.ts`、`template.ts`、`check.ts`）。相关决定：t02 决定 1–7；t03 决定 1–6；t04 决定 1–7（名字上限 64）；t06 决定与 2026-10-30 改判；t07 决定 1–7；t09 决定 4–7；t11 决定 1–9；t14 决定 10、17、20、23–33。现行合同 [`agent/harness.md`](../../../../../docs/specs/agent/harness.md)（输出 10–21 是 nb-story 依赖的语义）。

**开发者已确认的决定**：

2026-10-30 第一轮：

1. 新内核作为 `nb-harness` 的新实现，以第三稿 spike 为起点按定稿类型重写；分支 `feat/w00002-harness-kernel` 只取 JSONL 存储的写入与截断代码、工具参数校验的调用方式（实际可复用约一成，审查 Z10）。开发期间旧的 `createHarness` 留着只为让 nb-story、nb-agent-ui 的测试照跑；t20 完成后紧接迁移 Task：nb-story 改用新内核（顺带用上 rewind 等它没用到的功能），nb-agent-ui 的适配器按新日志重写，`SessionMirror` 在那里照浏览器的真实用法写，删旧实现与 `agent/harness.md`，`nb-session`、`nb-profile` 停更。
2. 范围只做包内内核（第 8 节“不做”）。
3. 提案待定项：叫“扩展”；Profile 在拦截链最里层；拦截加 `layer`；上限反应链 3 层、`continue` 每轮 3 次、处理函数 30 秒；请求录制缺省关；工具拦截附加的说明进日志；流式增量不给扩展；一次逻辑请求一条 `modelStarted`；`input` 保持；加 `<Slot drop>` 与 `ctx.status`。
4. 审查：计划走快速审查；实现做一次深入审查，开审前报计划与预算。

2026-10-30 第二轮（第一轮审查之后，全部按推荐）：

5. 服务重启时有运行在等审批或回答：一律收口为“中断”，等待中的事项结算为 `interrupted`；被中断的提问在重开后由界面提示重新问（不从日志续跑）。审批等待中的调用还没执行，结算为 `denied`（码 `interrupted-before-approval`），不是“结果未知”。
6. 用户输入的脱敏：输入拦截链在指令受理时（入队、改）就跑，`inputQueued`、`inputEdited` 存拦截后的文字，`redacted` 时原文只记哈希；取走时不再拦截。改提案第 9 节“输入拦截读取走这条输入时的叶子”为“读受理时的叶子”。
7. `commit` 只拿这一轮与渲染工具，是纯函数；`turn` 仍能读视图。改提案第 7、20 节。
8. nb-story 依赖的语义放进 t20：收尾工具（t14 的 `yield` 是按会话动态生成的收尾工具）、运行结果、`complete()`、停止原因（含 `length`）、错误归类（含 `rate_limit`）、密钥遮盖、进程中断与停服收尾、相邻 user 消息合并、只用指定的密钥环境变量。
9. 性能预算：典型 2 万条事件（约 1,500 轮）打开 1 秒内、算一次请求 50 毫秒内，打开后常驻内存不超过 200 MB；10 万条只作压力测试、报数不验收。第一版不做检查点快照。超过 16 KB 的字符串从第一版起另存为会话目录里按内容寻址的文件，日志里只记哈希与长度（落盘格式现在定；第一版加载时全量读回，按需读取以后做，不改格式）。
10. 挪到主线之后的可选片：预览过去请求的“重建”与请求录制、`ctx.status`、拦截的 `layer`；`SessionMirror` 并入迁移 Task。

主 Agent 照审查意见订正与补定（开发者知悉）：

11. 扩展 id 两条规则：插件贡献的扩展 id 是“所属插件 id”或“所属插件 id.一段名字”（宿主传入所属插件，内核校验前缀）；Profile 的 id 是 t05 的 key `<来源>.<名字>`（`builtin.writer`、`story.qa`、`user.x`），与所有扩展 id 不重复。日志的 `source` 与扩展事件前缀都按这个 id。第一版计划把两条并成一句是概括错误。
12. 会话互斥：打开会话时在会话目录取锁，第二个进程（或同进程第二次打开）得 `session-busy`。
13. 提案待定项 7（主动接口）定最小形状：压缩方法与审批钩子经 `ctx.model(request, {purpose, role?})` 调模型，内核写 `modelStarted`、过模型拦截链、计用量、接中止；`RequestPurpose` 加 `approval`。待定项 8 见第 9 条。待定项 11 在第 1 片的定稿类型里定（请求带完整工具声明、内容块含思考签名与图片）。待定项 13 定最小形状：宿主可给一个出站过滤（日志查询与帧推出前调用），nb-story 的防剧透用它。

**工作方式**：Work 分支 `feat/w00032-agent-integration`，worktree `.worktree/w00032-agent-integration`；主会话自己写；Spec、提案、ADR 与 Task 记录在主工作区 master 上改、路径限定提交。

## 2. 技术选型

| 通用问题 | 选用 | 理由 | 否决 |
|---|---|---|---|
| 日志存储 | JSONL，会话一个目录 `<根>/<会话 id>/session.jsonl`；写入与截断代码取自分支 `session/jsonl/jsonl.ts` | t03 定会话为文件、可读可拷；t14 定 `sessions://<id>/` 映射整个会话目录 | SQLite：会话目录要可读可拷 |
| 写入批 | 每行带 `batch: {id, n, of}`；一批一次 `write` 后 `fsync`；**文件里完整的批就是已提交的批**；写或同步失败对调用方是“结果不确定”：句柄进“损坏”状态、进程内不重试；重开时截到最后一个完整批的末尾（截下的尾部另存一份供查看），以文件为准。指令的重发靠 `commandAccepted` 去重；反应与外部事实不重试（重开时不跑反应），扩展要去重就用 `emit` 的幂等键 | 单写者下只有文件尾可能不完整；“结果不确定”由重开时的截断与指令幂等（3.2）共同收口 | 提交标记行：多一行、仍要处理写失败 |
| 会话互斥 | 操作系统的独占文件锁：Linux、macOS 用 libc `flock(LOCK_EX | LOCK_NB)`，Windows 用 `LockFileEx`，经 `bun:ffi`（照 nb-story `platform/flock.ts`，ADR 0031）；锁文件建好不删；持有者另记在 `session.owner`，供 `session-busy` 显示（Windows 的锁字节别的句柄读不了） | 进程怎么结束锁都由操作系统放掉，没有“判旧再回收”的竞争（第 2 片开工时改：原写的“Bun 没有跨平台的 flock”不成立） | 进程号加令牌的锁文件与陈旧回收：两个进程同时回收有竞争窗口；只靠“一个状态根一个服务端”的部署假设：内核也给 nb-story 这类独立程序用 |
| 大块内容 | 超过 16 KB 的字符串写成 `blobs/<sha256>`，事件里记 `{$blob, size}` | 日志小、扫描与校验快；脱敏的哈希走同一条路 | 全部内联：10 万条每条 5,000 字解析要 651 毫秒、读进 525 MB（审查 Z7 实测） |
| schema 与校验 | TypeBox | 仓库与平台合同已全是 TypeBox | — |
| 工具参数校验 | OMP 的 JSON Schema 校验器 | 与服务商侧同一实现（分支 `tools/adapter.ts` 的理由） | TypeBox 校验器（pattern 的 `u` 标志语义不同） |
| 提示词模板 | 自带的 JSX 自动运行时，`jsxImportSource: "@notnotype/nb-harness/prompt"`，导出 `jsx`、`jsxs`、`Fragment` 与空 `IntrinsicElements` | 与仓库其它包（nb-profile、nb-story）一致；子路径名与 `kernel` 无关，迁移后不用改作者的 tsconfig | 经典运行时 `h`：第一版计划自相矛盾处 |
| 不可变状态 | 片整片替换，开发模式递归冻结 | 补丁按片给 | immer |
| 时钟与超时 | 注入的时钟接口 | 提案第 9 节；测试规则禁止假计时器 | 假计时器 |
| 请求哈希 | 每块 SHA-256，按块链式累加；已提交前缀的累加值按节点缓存 | 跨进程稳定；回退换叶时前缀可复用 | 整段一个摘要：不能续算 |
| 与服务商通信 | OMP `streamSimple`（升到 18.14.0） | 开发者 2026-10-29 定 | — |
| 错误归类 | 搬 master `run-result.ts` 的 `classifyProviderError`（按状态码与 OMP 错误标记，不看文字） | nb-story 在用，已有测试 | — |

## 3. 关键设计

### 3.0 分层与依赖

新代码在 `packages/nb-harness/src/kernel/`，只用相对导入、不引用 `kernel/` 之外的旧文件（删旧实现后整体上移一层不改导入）；包 `AGENTS.md` 写明“`kernel/` 是 harness 的新实现，不是 `nb-runtime` 的内核”。

| 目录 | 职责 | 可依赖 |
|---|---|---|
| `api/` | 全部公开类型、事件表、码表（命令、工具、存储、诊断）；没有运行时代码 | 无 |
| `log/` | 存储、写入批、锁、大块内容、校验、修复 | `api`；唯一用 `node:fs` 的地方 |
| `state/` | 归约、片的持久化、`core.history`、内核自己的片（缓冲区、设置、待处理事项、批准记忆、告知过的工具集） | `api` |
| `extension/` | `define*`、Profile、装配、各档 `ctx` 的唯一构造点、`emit`/`set` 收集器 | `api`、`state` |
| `view/` | JSX 运行时与模板、布局、`format`、请求的计算与校验、`outline`、槽 | `api`、`state`、`extension` |
| `dispatch/` | 单写者队列、反应、`mount` | 以上 |
| `run/` | 指令、循环、工具与收尾、通用拦截链 `runChain`、审批、等用户、中止、恢复、回退与分支 | 以上（经 `SessionCore` 的窄接口） |
| `compaction/` | 触发估算、切点、公共流程 | 以上（用 `run/` 的 `runChain`；`run/` 的循环经 `SessionCore` 上注入的回调触发压缩，不反向依赖 `compaction/`，由 `session/` 接线） |
| `model/` | 模型端口与 OMP 适配器、错误归类、遮盖 | `api`；唯一用 OMP 运行时包的地方 |
| `session/` | `SessionEnv`、`openSession`/`createSession`/`closeSession`、`AgentHost` 与扩展接收者、帧、预览、诊断、运行结果、`complete()`、进程收尾 | 以上 |
| `helpers/` | `reminder`、`opening`、`standardLayout`、`finalOnly`、`withoutEvents`、`deriveProfile` | `api`、`extension`、`view` |
| `testing/` | `createTestSession`、假模型、假工具、时钟 | 全部；产品代码不引用它 |

会话的共享对象 `SessionCore` 定义在 `dispatch/`，持有日志句柄、状态、队列与装配结果；`run/`、`view/`、`compaction/` 只拿它的窄接口，反应里的 `continue`、`abort` 经它上面的回调注入（`dispatch` 不引用 `run`）。第 1 片带 `kernel/architecture.test.ts`（照分支那份改模块表），守住上表的依赖方向、`node:fs` 与 OMP 的使用范围、`testing/` 不被产品引用。

子路径导出：`./kernel`（运行时）、`./kernel/contracts`（`api/` 的类型与 `define*`、`slice`、`conv`、`ext`，不拖实现，契约放插件的 shared 模块时用它）、`./kernel/testing`、`./prompt`（模板节点与 JSX 运行时，`./prompt/jsx-runtime`、`./prompt/jsx-dev-runtime`）。旧的 `.`、`./testing` 不动；`./transport`（master 的 SSE 序列化，t02 决定 3）在迁移 Task 里从根导出挪出。

每个目录的模块头注释写该目录的时序与不变量（仓库注释规范“最难懂的地方先写”），至少：`dispatch/queue.ts` 的排队粒度与哪些调用不经队列；`dispatch/reactions.ts` 的同事件并发与整批丢弃；`extension/ctx.ts` 每个入口读哪一刻的状态（搬 spike 头部那张表）；`log/jsonl-store.ts` 的批完整性判定与它依赖的单写者假设；`run/loop.ts` 的边界顺序。行为规则链接 Spec，不复述。

### 3.1 定稿类型（第 1 片交付）

把 `spike/v5/` 改成 `kernel/api/`，附“第五稿 → 定稿”差异表进提案决策记录。要补或改的：

- **事件**：
  - 输入：拦截在受理时跑（决定 6），删 `inputConsumed.rejected` 与 `runEnded.reason` 的 `input-rejected`；`inputQueued`、`inputEdited` 加 `original?`、`originalHash?`，`input`、`steer` 只引用缓冲区的 id、不再带原文字段。
  - 等用户：`interactionRequested{id, callId, kind: "approval" | "question", request, async}`、`interactionResolved{id, decision, by, code?, data?, note?}`，取代四个占位；`decision` 取 `allow`、`allow-session`、`deny`、`answer`、`interrupted`、`aborted`、`unavailable`，系统结算带 `code`（`aborted`、`interrupted-before-approval`、`tool-unavailable`）。`allow-session` 时同批写一条 session 事件 `approvalRemembered{tool, scope, by}`，批准记忆只从它归约（session 片只归约 session 事件）。
  - 会话级（session 作用域、不移动叶子）：`titleChanged`、`archived`、`toolsAnnounced`（path 作用域：告诉过模型的工具集，t04 决定 6）、`commandAccepted{commandId, name, value}`（session）。
  - `assistant` 加 `stopReason`（`stop`、`length`、`tool`、`error`、`aborted`）、`usage`（OMP `Usage` 的全部计数：`input`、`output`、`cacheRead`、`cacheWrite`、`cost | null`、`complete`）、`model`、`effort`。
  - `runEnded.reason` 加 `finished`，带 `result?: {via: "tool" | "text", tool?, value, valid, errors?}`（强制结构化以最后一条回复作结果时 `via: "text"`、`valid: false`）。
  - 非对话的模型请求（`purpose` 为 `approval`、`compaction`、`background`）成功时写 `ctrl` 事件 `modelEnded{request, purpose, stopReason, usage, model}`，与 `modelStarted`、`modelFailed` 成对；运行结果的用量按本次运行的 `assistant` 与 `modelEnded` 求和。
  - `modelFailed.kind` 改为 master 的 `network | rate_limit | auth | quota | context_overflow | provider | local`，另加 `aborted`（用户中止）与 `interrupted`（进程中断后恢复时写）。
  - `toolStarted` 记审批之后、实际执行的参数与 `approval?: {by}`（放行的判定来源）；`toolResult` 加 `code?`（内核造的失败结果都有码）。
  - Profile 与扩展的定义加 `version`（Profile 哈希与扩展事件版本用）。
- **类型改名**（避开 DOM 全局与一名两用）：`Event` → `LogEvent`，模板 `Node` → `PromptNode`，对话的 `Turn` 类型 → `ConversationTurn`（模板组件仍叫 `<Turn />`）。
- **请求与回复**（第 1 片写成类型，第 2 片按 OMP 18.14.0 的公开类型与事件流逐字段写合同测试）：
  - 内容块 `ContentBlock`：`{kind: "text", text}`、`{kind: "thinking", text, signature?, redacted?, provider?}`（`provider` 原样保存服务商要求带回的元数据）、`{kind: "image", blob, mime, width?, height?}`（图片一律是大块内容）。请求里的块另带 `origin`。
  - `ModelRequest`：`purpose`（加 `approval`）、`model`、`effort`、`params`、`headers`、`system`、`messages`、`tools`（完整工具声明）、`toolChoice?: "auto" | "none" | {tool: id}`、`providerOptions?`（适配器专用、原样透传）。
  - `ModelResponse`：`content`、`toolCalls`、`stopReason`、`usage`、`responseId?`；失败时带 `partial?` 与错误类别。
  - 适配器不支持的内容（例如某服务商不收图片）在发请求前失败，码 `unsupported-content`，不悄悄丢掉。回复里的图片块收下，存为 `image` 块。
- **工具**：以 master 的 `ToolDeclaration` 为底（`id`、`description`、`parameters`、`provider`、`version`、`finish`、`concurrency`、`strict`、`customFormat?`），加 `effect: "read" | "write" | "exec"` 或按参数求值的函数；`name` 改为可选的 `providerName?`（t04 决定 1 允许显式覆盖交给服务商的名字，按服务商规范校验；不写时适配器按 t04 换算）；日志、`ToolCall.tool`（第 1 片把字段名 `name` 改为 `tool`，与 `toolStarted.tool` 一致）、Profile 与审批一律用 id。`ToolInfo`（给扩展看的）是声明去掉实现相关字段。`ToolContext{signal, callId, sessionId, initial, ask?, report?}`；`ToolResult{text, status?, code?, details?, redacted?}`。
- **审批钩子**：`approve(call, info, ctx) → Promise<{verdict: "allow", by} | {verdict: "deny", rejection, by} | {verdict: "ask", reason}>`，`info` 有工具声明、按参数求得的 `effect`、核心设置（审批模式、只读模式）、批准记忆；`ctx` 有 `signal` 与 `ctx.model`。
- **宿主**：`SessionEnv`（3.10）；`RunStatus` 加 `waiting{pending: InteractionSummary[]}` 与 `broken`；`rewind` 去掉 `abort` 选项（运行中先 `abort` 再 `rewind`，进差异表）；`resolve` 进指令表；`switchBranch`、`fork`、`setTitle`、`archive` 进指令表；`path`、`siblings`、`runResult` 进查询；命令成功值里带 `seq` 与 `replayed`（对上 nb-runtime 远程服务的 `ok(value)`）、失败的 `detail` 按码给 schema。
- **压缩**：`CompactionResult{method, firstKeptEntryId, replacement, omitted, tokensBefore, tokensAfter, details}`（t11 决定 8 加 `omitted`），方法失败以 `{failed: code}` 交回；放回的内容由内核的公共流程写，不归方法。
- **码表**：`api/codes.ts` 一处，按拥有者分组：指令、工具失败、存储（`log-corrupt`、`needs-migration`、`session-busy`、`log-broken`）、诊断（含 `emit-after-settle`、`setting-missing-default`、`turn-node-count`、`mount-timeout`）。计划与 Spec 里用到的码都在这里登记。
- **类型体验**：`implement` 的契约没有导出时不必写 `exports: {}`；`MountCtx` 加 `initial`；作用域写错、`optional` 依赖读取等最难懂的几处报错加自定义的提示类型（审查 D12、A15）。
- `spike/v5/typetest.ts` 的 29 处写错随类型搬到 `tests/kernel/typetest.tsx`（要写 JSX 用例，不进发布面），每片新增的写错补进来。

### 3.2 `kernel/log/`：会话目录、写入批与存储

- **会话目录**：`<根>/<会话 id>/` 下内核拥有 `session.jsonl`、`blobs/`、`session.lock`、`index.json`（列表用的小索引：项目、标题、归档、最后活动时间、轮数与 `throughSeq`；临时文件加 `rename` 写；打开时与日志末条比，不一致就重建；`list` 只读索引，崩溃后到下次打开之前可能略旧）；其余文件（t08 的 `home/` 等）归宿主，内核不碰也不删。
- **会话头**（第一行）：`{format: 1, id, createdAt, profile, project?, origin?: {session, entry}, caller?: {kind: "session" | "workflow", id, callId}, questions: "caller" | "user", result?: {mode: "optional" | "required", schema}}`。`result` 由建会话时传入（Profile 声明的也在建会话时抄进来），重开只读头，动态 `yield` 由它生成（3.6）。`format` 不认识时打开得 `needs-migration`，与 `log-corrupt` 分开（t03 决定 6）；迁移脚本归迁移 Task。
- **`LogStore`**：`create(header)`、`open(id) → handle`（取锁、修复、校验、读回）、`append(handle, batch)`、`list({project?, archived?})`（读索引）、`fork(from: {session, leaf}, newHeader)`（复制当前路径、头记来源）、`close(handle)`。`memory-store` 每次读写都做 JSON 往返，`Date`、`Map`、`undefined` 这类只在 JSONL 里坏的写法在内存测试里也会坏（审查 D5）。
- **锁**：对 `session.lock` 取操作系统的独占锁（技术选型“会话互斥”）；锁跟着打开的文件走，同一进程第二次打开也拿不到。拿到后把进程号与时刻写进 `session.owner`，`session-busy` 的 `detail` 带它们。锁文件不删（锁的是文件本身，删了再建是另一把锁）。
- **大块内容**：阈值按 UTF-8 字节 16 KB；写入批之前先写 blob（临时名、`fsync`、`rename`、`fsync` 目录），blob 写失败与日志写失败同样进 `log-broken`；打开时引用的 blob 缺失是 `log-corrupt`；`fork` 复制路径上引用的 blob（同一文件系统用硬链接）。脱敏只记原文的 SHA-256，不产生 blob 文件。
- **打开顺序**（存储这一层）：取锁 → 若尾部有不完整的批，截到最后一个完整批的末尾、截下的字节另存为 `session.jsonl.tail-<时刻>` 并写诊断 → 校验 → 读回大块内容（校验哈希与长度，缺失或不符是 `log-corrupt`）。修复失败拒绝打开。之后的装配与归约见 3.10。
- **校验**：id 唯一、seq 递增、父节点在前、类别与作用域合法、类型是内核事件或带合法前缀、批完整（只有文件尾可能不完整，中间的不完整批是 `log-corrupt`）。
- **写失败**：写或 `fsync` 抛错时句柄进 `log-broken`：这一批不归约、不推帧（顺序固定为“先落盘、再归约、再推帧”）；之后的写入都得 `log-broken`。内核立即在内存里把运行标为结束（不写日志），`waitRun` 以 `{reason: "error", kind: "local", code: "log-broken"}` 完成，`RunStatus` 进 `broken` 并推一条 `status` 帧；`closeSession` 在句柄已坏时跳过收口、只做清理与释放锁，同进程可立即重开，收口交给重开时的恢复。
- **扩展事件的版本**：只归约声明过的版本；更高版本的事件写诊断并跳过归约（插件降级后打开新日志）。

### 3.3 `kernel/extension/`：定义、Profile 与装配

- `define.ts`：`defineExtension`、`implement`、`defineContract`、`optional`、`shape`、`slice`、`conv`、`ext`。
- `profile.ts`：`defineProfile`、`deriveProfile`（必须给新 id；`render`、`tools`、`extensions` 逐项合并；派生的 id 是自己的设置命名空间，不继承基础 Profile 的用户设置；Spec 写清三处审查 A14 指出的语义）。
- `assemble.ts`：按第 1 节决定 11 校验 id；`dependsOn` 拓扑排序、同层按 id，得到**装配序**（决定反应写入、槽拼接、`mount` 的顺序）；**拦截序**是装配序，再接 Profile 的 `extensions`、Profile 自己、审批（`layer` 在第 12 片）。所属插件随每个扩展传入（`{extension, plugin: string | null}`，`null` 只给内核与测试），按它校验 id 前缀。装配时检查：设置每项都有 `default`、`on`/`reduce`/`render` 的键是已知事件（按 `dependsOn` 里的契约算，`optional` 的不误报）、`contribute` 的槽名合法、`reminder()` 至少给了 `every` 或 `watch`；摆放类的槽诊断在渲染时报。装配失败返回带每条来源、`message` 与 `hint` 的列表，`createTestSession` 遇到时抛出带全部条目的错误。
- **Profile 哈希**：`hash(id, version, 代码哈希, 装配序里每个扩展的 id 与版本)`；工具声明不进哈希，工具只由 `toolsAnnounced` 管（t04 决定 6 的两档）。代码哈希：用户 Profile 取 t05 的打包哈希；内置 Profile 取加载时对模块源码算的哈希，做不到时 Spec 写“内置 Profile 改提示词要升 `version`”，并加一条检查测试（源文件变了而 `version` 没变时失败），第 3 片定用哪种。打开会话时与路径上最后一条 `profileChanged` 比，不同就在受理任何指令前写 `profileChanged{reason: "code-updated", from, to, manifest}`（旧、新哈希与装配清单）；提交缓存的键带 Profile 哈希，哈希变了按提案第 7 节全部重新渲染（审查 O8）。
- `ctx.ts`：各档 `ctx`（视图、反应、`assistant` 的反应、`mount`、拦截）的唯一构造点：状态取哪一刻、深只读、`read` 只放 `dependsOn` 与 `core.history`，三条规则一份实现。`emit`/`set` 的收集器（完成时整批写、抛错整批丢、完成后调用报 `emit-after-settle`、同片取最后一次）在同一文件。

### 3.4 `kernel/state/`：归约与对话形状

- 片按作用域分两组；path 片沿树持久化（每个节点存相对父节点的变化，参照 spike `core.ts`），回退与切分支只换叶子；归约出错写诊断、这次补丁不用；`resetOnCompaction` 的片在 `compaction` 上回到初值。
- `core.history`：按位置章归约出 `ConversationTurn` 与已提交的轮。`commit` 是纯函数 `(turn, format) => 消息[]`（第 1 节决定 7），提交结果按节点缓存；重开或回退时用同一个纯函数重算，结果确定。`commit` 出错时的 `extensionFailed` 只在运行中提交那一次写；重开、回退与严格模式的重算出错只发诊断、用缺省提交，不写日志。
- 内核自己的片：缓冲区（session）、核心设置（session：模型、推理档、审批模式、只读模式，t09 决定 5、t06 决定 7）、待处理事项（path）、批准记忆（session，从 `approvalRemembered` 归约，t06 决定 1、4）、告知过的工具集（path）、标题与归档（session）。

### 3.5 `kernel/dispatch/`：单写者队列、反应与装上

- **队列粒度**：队列的一项是“一个写入批连同它引出的反应”。指令受理（校验加写事件）、`mount` 写的外部事实、反应的输出、运行循环的每一次写入都是独立的项。运行循环是队列之外的协程：它每次要写日志时把写入交给队列并等它完成；模型流、工具执行、等用户都在队列之外等待。所以运行中的插话、改、删、应答、中止都不必等运行结束（审查 P1、O4）；指令受理的等待上限是队列里当前那一项的反应时限。输入拦截链在指令的队列项里跑、读这一刻的叶子，时限缺省 5 秒（会让队列项变长的唯一指令，写进 `queue.ts` 的头注释）。
- **中止**：不经队列先生效：标记当前运行的代次并触发它的信号，`RunStatus` 进 `aborting`；收口（3.6）作为队列里的一项写入。代次在写入交给队列时检查一次，交出去的写入一定写下；之后到达的 Promise 只写诊断。由这次运行的写入引出的反应，处理函数的 `ctx.signal` 同时挂在运行的中止上；中止时队列不再等它们，输出整批丢弃并写 `extensionFailed{code: "aborted"}`。
- **反应**：事件落盘并归约后派发；同一事件的处理函数看同一份状态、可并发、输出按装配序写；深度上限 3 写 `reactionLimit`；超时中止处理函数自己的信号。
- **`mount`**：时限缺省 30 秒；超时或抛错写 `extensionFailed{entry: "mount"}`、这个扩展标为失败（不再派发给它），会话照常打开（审查 P26）。清理函数在摘下或关闭时调用并等待（同样有时限）；`ctx.callback` 包外部回调，摘下后不再调用。

### 3.6 `kernel/run/`：指令、循环、工具、拦截与运行控制

- **指令与幂等**：每条被受理的指令在受理时写一条 `commandAccepted{commandId, name, value}`，与它立即写的事件同批；运行中到边界才生效的指令（`compact`、`changeSettings`）只写这一条，到边界写的事件带 `cause` 指回它。重发同一 `commandId` 查 `commandAccepted`，返回第一次的 `value` 与 `replayed: true`；校验失败不写、重发重新校验（审查 P5、A6）。`value` 里引用的每个 id 都必须在同一批里写出：空闲时会开始运行的 `send`、`start`、`compact`、`rewind{resend}`，受理批就包含 `runStarted`（`send` 再加取走这条输入的 `inputConsumed`、`turnStarted`、`input`），受理后、循环开始前崩溃时，恢复照常把这次运行结算为 `interrupted`。输入拦截拒绝时指令失败 `input-rejected{code, params, by}`、不写日志，拒绝署名进诊断；异步提问的回答经 `resolve` 进缓冲区前同样过输入链。指令：`send`、`enqueue`、`edit`、`remove`、`resolve`、`start`、`abort`、`rewind`、`switchBranch`、`fork`、`compact`、`changeSettings`（核心设置组 `core` 加各扩展组）、`changeProfile`、`setTitle`、`archive`。
- **发出者**：`resolve` 等指令的发出者由宿主注入：`session.as(issuer)` 返回带发出者的视图（用户或父会话），界面拿不到改发出者的入口（审查 A5）。
- **循环**：照提案第 1 节的运行图。边界顺序：外部事实与设置 → 工具集比对（与路径上最后一条 `toolsAnnounced` 不同就同批写新记录与一条给模型的提醒；必需工具缺失时运行以 `error` 收口、码 `tools-missing`，会话进只读，同 3.10 重新装配失败）；动态 `yield` 固定在声明里、不参与比对→ steer 全部取走 → 估算与压缩 → 视图、模型拦截链、`modelStarted`。
- **缓冲区规则**（t07 决定 1、3、5）：一轮以 `completed` 结束才取 followup；出错或中止时不取；中止缺省清空缓冲区（每条写 `inputRemoved{reason: "aborted"}`），`abort({keepQueue: true})` 保留；`start` 在末尾是完整回复时失败 `nothing-to-continue`；重启后缓冲区还在、不自动发出。
- **工具**：执行前写 `toolStarted`（审批之后，记实际执行的参数）；按声明的 `concurrency` 切段（`shared` 连续并发、按调用顺序启动；`exclusive` 单独）；结果按调用顺序作为一个写入批写入，整批写完再派发反应。工具执行上下文见 3.1。名字换算与校验在 `api/tool-name.ts`（`.` → `__`、id 里禁 `__`、上限 64），请求校验与适配器共用。
- **收尾工具**：照 `agent/harness.md` 输出 13–16：一条回复里只调用了一个收尾工具、参数通过校验且执行成功，结果写入即以 `runEnded{reason: "finished", result}` 收口、不再请求模型；执行返回错误按普通工具出错；与别的工具混在一批或有两个时，收尾工具都不执行、各得 `finish-not-alone`；以写下结果为准，在新 Spec 里改写成适配宽限期的一句：宽限期内写下的收尾结果，运行以 `finished` 结束；宽限期之后到达的只写诊断。t14 的 `yield` 由内核按会话头的 `result` 动态生成为收尾工具；会话有 `result` 时内核在第一轮开头写一条固定提醒（`conv`，“完成后调用 `yield` 交回结果”，t18 决定 6）；可选档停下时以最后一条回复作结果（`via: "text"`）；强制档停下时没调用就催一次（写一条 `continued`），仍没有就以最后一条回复作结果、`valid: false`、运行以 `error` 结束。
- **拦截链**：一个泛型的 `runChain<I, O>({layers, terminal, onFailure, record})`，负责取层（拦截序）、每层的 `ctx` 与 `invocation`、中止赛跑、超时、失败按提案第 9 节的表、写 `extensionFailed`；四条链各自只剩取字段、失败策略与改动记录三项小配置。输入链在指令受理时跑（第 1 节决定 6）。
- **审批**：工具链的最里层，判定对象是全部拦截之后的调用（这之后不再改参数），钩子签名见 3.1；判定为 `ask` 时写 `interactionRequested` 进等用户（3.7）。“全部放行”只是 `createTestSession` 的一种显式策略，不是产品缺省；测试里另写一个非平凡的钩子（规则拒绝、规则放行、`ask`、“本会话都批准”后第二次放行、回退后批准记忆仍在），t06 的规则表不在本 Task。
- **中止**：触发后 `RunStatus.aborting`，在注入的时钟上等宽限期（缺省 2 秒，常量写进 Spec，t07 决定 2）；期内完成的照常写结果与用量；过期的模型请求写 `modelFailed{kind: "aborted"}`、工具写 `status: "unknown"`、等待中的事项写拒绝（码 `aborted`），以 `aborted` 收口；迟到结果只写诊断。异步提问不随运行中止结算（它跨运行存在），只在所在分支被回退掉或工具被卸载时结算（审查 P32）。
- **恢复**：打开时结算半截运行：没结果的工具调用 `unknown`；等审批的调用 `denied`（`interrupted-before-approval`）；让运行停下等待的提问 `interrupted`（异步提问不属于运行，不结算）；发出没回复的模型请求 `modelFailed`；最后 `turnEnded`、`runEnded{interrupted}`（第 1 节决定 5）。停服时（3.10 的进程收尾）走同一条收口，原因同为 `interrupted`。
- **回退与分支**（t03 决定 2、t07 决定 6）：运行中得 `running`，界面先 `abort` 再回退。`rewind(to)`：目标是轮或步的边界（`rewindTargets()`，与压缩切点同一条规则）；`resend` 回退后入队并开始（编辑重发）。重试与 swipe 是回退到回复之前再 `start`，得到同一条用户消息下的助手兄弟节点。`switchBranch(node)` 落到那条分支最近写入的末端。都写 `leafChanged`。查询 `path(leaf)`、`siblings(node)` 从完整日志算。

### 3.7 `kernel/run/interaction.ts`：等用户

- 同一批工具的几个事项可同时待处理、任意顺序应答，全部处理完回到运行；`RunStatus.waiting` 列出待处理事项。
- `resolve` 的裁决：单写者里先到的赢，后到的 `already-answered`；审批只收用户的应答；提问在会话头 `questions: "caller"` 时也收父会话的应答；被回退掉的分支上的事项得 `unknown-interaction`。
- 异步提问的结算矩阵：用户中止、正常关闭会话、停服、崩溃后重开都不结算，重开后照样能 `resolve`；所在分支被回退掉时结算为 `unavailable`、之后的应答得 `unknown-interaction`。会让运行停下的提问按 3.6 的中止与恢复结算。
- 异步提问（`async: true`）：工具立即返回；`resolve` 在同一批里写 `interactionResolved` 并把回答作为输入放进缓冲区（运行中当插话，空闲时开新一轮）。
- t07 决定 4 的“等审批时打字等于拒绝并附言”由界面转成 `resolve{decision: "deny", note}`；内核的 `send` 在 `waiting` 时照常入队。

### 3.8 `kernel/compaction/`：触发、切点与公共流程

- **触发估算**：最后一次回复的 `input + cacheRead + cacheWrite + output`（`totalTokens` 有值时用它）加之后新增块的估算，与模型窗口和触发点比（模型信息来自 `SessionEnv.models`，t11 决定 1）；溢出时按溢出顺序压缩后同一请求再发一次，最多一次；`compact(要求)`。
- **切点**：半开区间，只能是轮的 `turnStarted` 或进行中这一轮某一步的 `assistant`；`omitted` 带占位；`core.history` 按提案第 10 节归约。
- **公共流程**：`opening()` 的片在压缩上重读；`core.compaction` 把放回的内容写成 `conv` 事件与压缩同批、盖位置章；重试同一请求时不重复写。
- **方法接口**：`CompactionJob{method, request, require, signal, model}`，`model` 即 `ctx.model`（第 1 节决定 13）；结果见 3.1。内核按 Profile 的两套顺序（阈值、溢出，t11 决定 2）依次调用，方法失败或结果不合格就换下一个，全部失败时这次压缩失败、不写事件。t20 带两个测试方法：一个总是失败、一个经 `ctx.model` 调假模型得摘要；`shake`、`inplace`、`summary` 在 t11。

### 3.9 `kernel/model/`：模型端口与 OMP 适配器

- **端口**：`ModelPort.resolve(核心设置, purpose, role?) → {info: ModelInfo(窗口、能力、触发点、可选推理档), call(request, signal, onDelta) → Promise<ModelResponse>}`。模型目录与凭据由宿主实现端口（Agent 插件经 `nbook.models`，t09；nb-story 用它现有的模型解析），内核不搬分支的 `models/` 与 `config/`（审查 O9、Z10）。
- **OMP 适配器**（本包提供的端口实现之一）：照提案第 9 节的表与第 1 片的定稿类型：请求的块、思考签名、图片、完整工具声明（名字按 t04 换算）、推理档按模型夹取（t09 决定 6）、相邻 user 消息合成一条（`agent/harness.md` 输出 21）；逐个处理 OMP 的 `text_*`、`thinking_*`、`toolcall_*`、`done`、`error` 事件与 `stream.result()` 的终态，只认一个终态；`try/finally` 收口流。
- **错误归类**：搬 master `classifyProviderError`（`quota` 优先，`rate_limit` 单列）。
- **重试的审计**：只记可观察的服务商响应与最终回复；OMP 内部看不见的重试不单独审计，用量的 `complete` 为 `false` 表示可能漏计（审查 O7，沿用 `agent/harness.md` 输出 11）。
- **密钥遮盖**：单一出口：写日志与推帧之前，把服务商错误正文里回显的密钥换成固定遮盖文字（搬 master `redact.ts`）；只用宿主给的密钥环境变量名，缺失时在发请求前以 `auth` 失败（输出 18）。
- **t04 的复测**：第 2 片在 OpenAI 与 Anthropic 官方接口上复测 t04“下一步”列的四种请求（历史里有已卸载工具的调用、工具名 64 与 65 字符），有凭据才跑、没有记“未验证”。

### 3.10 `kernel/session/`：宿主面

- **`SessionEnv`**（宿主注入，测试工具给内存或脚本化的实现）：`store`、`profiles.resolve(key)`、`models: ModelPort`、`tools: {declarations(sessionContext), create(id, sessionContext) → {execute, dispose?}}`（声明每个边界取一次，t04 决定 4、6；实现按 t04 决定 2 每个会话每个工具建一次、懒建，关闭会话或工具被卸载时 `dispose`）、`resources`、`sessions.get(id, issuer)`（返回本进程已打开的会话、没开则由宿主打开并登记，带发出者的视图；t14 决定 25 的“交给目标会话的写入队列”经它）、`clock`、`approve`（必填，没有缺省：产品的判定由 t06 提供，测试工具给显式的策略）、`outbound?`（出站过滤，第 1 节决定 13）。
- **会话**：`createSession(env, {profile, initial, header})`、`openSession(env, id)`（取锁 → 修复与校验 → 按会话头的 `profile` 经 `env.profiles` 解析 Profile 并装配扩展（解析不到时会话只读、码 `unknown-profile`）→ 归约（要用扩展的 `reduce`，所以在装配之后）→ Profile 哈希比对 → 恢复 → `mount`）、`closeSession`（拒绝新指令 → 中止并等收口 → 等全部 `mount` 清理 → 释放订阅与工具句柄 → 关闭日志与锁；关闭后迟到的回调只写诊断）。
- **`AgentHost` 与扩展接收者**（进程内）：`prepare`/`published`/`revoke`；运行中撤回：这次运行里调它的入口得 `extension-revoked` 诊断并跳过、归约照常，空闲时自动重新装配并写 `profileChanged{reason: "plugin-removed"}`；重新装配失败（例如依赖缺失）时会话进只读、报 `dependency-missing`；`pendingReassembly` 进快照。平台贡献点的描述与激活事务在 t10（审查 P16）。
- **帧与查询**：`log`、`delta`、`status`、`diagnostic`、`reset`；`log(afterSeq, limit)` 分页、`snapshot`、`rewindTargets`、`path`、`siblings`、`diagnostics`；出站过滤在推帧与日志查询之前调用。
- **预览**：只做下一次请求（`fidelity: "next"`）：跑一遍视图与模型拦截链（`phase: "preview"`），最里层截下；过去请求的重建在可选片。
- **运行结果与单次调用**：`runResult(runId)` 给出 `TurnResult` 的等价物（停止原因、最后一条回复的文字、收尾值、错误、用量、条目范围）；`send` 与 `start` 返回 `runId`，宿主可 `await session.waitRun(runId)`。`complete(env, {profile, input})`：只接受不声明工具的 Profile，否则 `profile-has-tools`；`purpose: "background"`，不读写会话日志（输出 17）。
- **进程收尾**：`onProcessInterrupt`、`onProcessTermination`（搬 master `interrupt.ts`，输出 19、20），宿主登记后把在跑的会话按 `interrupted` 收口再退出。
- **诊断**：码表在 `api/codes.ts`；英文 `message` 与 `hint`；按（码、扩展、入口、事件类型）合并计数；改变结果的另写 `extensionFailed`。

### 3.11 `kernel/testing/` 与 helper

- **`createTestSession`**（第 2 片出最小版，之后每片的测试都经它写）：真内核；存储缺省是做 JSON 往返的内存存储，同一组场景另以 JSONL 存储在临时根上跑一遍；假的只有模型（脚本化，形状与适配器同一份定稿类型，有一条对照测试证明同形）、工具、时钟、资源。入口：`say`、`mark`、`rewind`、`switchBranch`、`resolve`、审批策略（全部放行、按工具给 `allow`/`deny`/`ask`）、`pending()`、`state(扩展)`、`eventsOf`、`requests[n].outline()`（`outline` 本身在 `view/`，测试工具转出）、`clock.advance`、手动模式（停住模型与工具，测运行中插话与中止）。缺省 Profile 声明传入的工具、用 `standardLayout()`（收全部槽）。
- **严格模式**（关闭时）：没有被认领的 error 诊断；从头归约一遍，状态与现场一致；从头重算全部已提交的轮，与现场逐块一致。中止产生的诊断由测试显式认领，不误报。
- **helper** 在 `helpers/`，每个一个文件，只用公开接口写成；`reminder()` 要求 `every` 或 `watch` 至少一个（类型与装配期都查），“每轮一次”写 `every: 1`。每个 helper 的“用核心字段手写的展开版”写成测试，与 helper 行为对照（提案“影响”一节的两级文档以它们为例子）。
- **例子**：`spike/v5/plugins.ts`、`profiles.tsx` 改写成 `tests/kernel/examples/*.test.ts(x)`，作为一级、二级文档的例子，会跑。

## 4. Spec 与文档改动

每片开工前先写这一片的 Spec 条目，再把“Spec 编号 → 测试”填进第 6 节；条目只在末尾追加。

- 第 1 片（主工作区）：提案 `status: accepted`，决策记录追加第 1 节第 5–13 条与第 3.1 节的差异表，正文按它们改第 2、3、7、9、11、20 节；新 ADR：harness 以日志为唯一真相源、内核自写循环、扩展四件事；新建 `docs/specs/harness/session.md`（日志格式、会话目录、写入批、校验、修复、锁、大块内容、恢复、幂等）与 `harness/extensions.md` 的骨架（按提案第 4–6 节列编号输出）。分支的 `harness/session.md` 作参照，不整份搬。
- 随片新建：`harness/profile.md`（第 4 片）、`harness/runtime.md`（第 2、5、6、7 片逐步加）、`harness/models.md` 的适配器与端口条目（第 2 片）。
- 不搬：分支的 `tools`、`compaction`、`config`、`builtin-tools`、`models` 的其余部分，到 t04、t09、t11、t12 实施时再搬或重写。
- 同步 Task 记录：t06 README 决定 6（“重启后回答提问”改为第 1 节决定 5）、t14 README 决定 33（失败码表移交 t14 实施计划）。
- `agent/harness.md` 留到迁移 Task 删旧实现时再删；它的输出 10–21 在新 Spec 里有对应条目后，在它的“证据”里注明去处。
- `packages/nb-harness/AGENTS.md`、`README.md`、`docs/omp-capabilities.md`：新实现的入口与分层、OMP 18.14.0 的版本表、完成门禁同时列旧测试（`tests/`）与新内核测试（`src/kernel/**`、`tests/kernel/`）的命令。

## 5. 切片

每片单独提交；自跑 `bun run --cwd packages/nb-harness typecheck`、`bun test`（含 `architecture.test.ts`）。

| 片 | 内容 | 出口条件 |
|---|---|---|
| 0 | 建 worktree；OMP 全部 `@oh-my-pi/*` 升到 18.14.0（先读 18.2.5 起的 changelog，记 `streamSimple` 事件、思考签名、错误标记的变化）；改 `omp-capabilities.md` | 旧测试、`test:affected`（含 nb-story、nb-agent-ui）、旧实现的 `test:llm` 两条 smoke |
| 1 | 第 4 节第 1 片的文档；3.1 定稿类型与 `typetest`；3.0 的目录、子路径导出、`tsconfig` 的 JSX 设置、`architecture.test.ts` | `docs:check`、`governance:check`、`tsc`、`typetest` 报出预期错误 |
| 2 | **纵切**：3.2 存储（会话目录、批、锁、修复、大块内容、头与版本）；最小的装配、归约与 `core.history`；3.5 的队列；不带工具的循环；最小视图（缺省 `standardLayout()`、缺省 `turn`/`commit`、请求计算）；3.9 的端口与 OMP 适配器（文字、思考签名、用量、停止原因、错误归类、遮盖）；最小的 `createTestSession`；终端演示脚本 `tests/kernel/chat.ts`（JSONL 加真适配器，一轮对话后重开接着聊） | 逐字节截断测试；写失败（注入会失败的文件句柄端口）；两个真实进程抢锁、持有者被 `kill -9` 后另一个进程立即能打开；写失败后关闭成功、重开看到 `runEnded{interrupted}`；`kernel.llm.test.ts` 跑一轮、重开、再一轮；t04 四种请求复测；存储读写与校验的测量 |
| 3 | 扩展完整面：3.3 定义、装配（两套顺序、诊断与提示）、Profile 哈希、`ctx` 构造点；3.5 反应、`mount`（时限）、外部事实到边界；3.4 内核的片；`reminder()`、`opening()` | 装配错误表；作用域与回退后片的值；写入批与整批丢弃；`emit-after-settle`；深度上限；`mount` 超时；2 万条合成事件的打开与归约测量（超预算当片改结构） |
| 4 | 视图：JSX 运行时与模板（含 `<ToolName id>`、`<Slot drop>`）、`standardLayout`、`format`、`turn` 与纯函数 `commit`、槽、请求计算与校验、`outline`、前缀稳定检查；`finalOnly`、`withoutEvents` | 请求的块与来源；提交确定性（重开后逐块一致）；2 万条会话算一次请求的测量 |
| 5 | 工具与拦截：工具声明与名字换算、工具实现的建与释放、段并发、`runChain` 四条链、输入链在受理时跑与脱敏、审批钩子的放行与拒绝（`ask` 在第 7 片）、`toolsAnnounced`、收尾工具与动态 `yield` | 收尾工具输出 13–16 的四种情形与宽限期内外完成；规则与改参的组合；脱敏后会话目录全文（含 `blobs/`）搜不到原文；受理时拒绝不写日志 |
| 6 | 运行控制：除 `resolve` 外的全部指令与 `commandAccepted` 幂等、发出者、缓冲区规则、steer 与 followup、`continue` 计数、中止与宽限期、恢复、回退、重试与 swipe、切分支、fork、标题与归档、`changeSettings`（核心组）、`changeProfile` | spike 对应场景（编号写进测试名）；重发同一 `commandId` 只生效一次（含运行中的 `compact`、`changeSettings`）；受理后、循环前崩溃再重发；宽限期内外；反应卡住时中止与插话的返回时间；回退后重启批准记忆仍在 |
| 7 | 等用户：3.7 全部，加审批的 `ask`、`resolve` 指令，并在第 6 片的恢复里补上等待事项的结算 | 同批多事项、并发应答、异步提问进缓冲区、回退后应答、中止结算、重启后中断与 `interrupted-before-approval` |
| 8 | 压缩：3.8 全部 | 第一个方法失败换下一个、全部失败不写事件；有缓存读的用量能触发阈值；切点规则；`omitted`；放回内容同批；溢出重试一次；压缩请求经拦截链且 `purpose` 正确；中止不写压缩事件；回退到压缩前 |
| 9 | 宿主面：3.10 全部（`SessionEnv` 补全、`AgentHost` 与撤回、关闭顺序、帧与分页、预览、诊断、出站过滤、运行结果、`complete()`、进程收尾）；`kernel.llm.test.ts` 补带工具调用、中止、回退重发 | 运行中撤回；关闭与 `mount` 清理、迟到事件交错；出站过滤生效于帧与日志查询；`complete()` 的 `profile-has-tools` |
| 10 | **nb-story 验收门**：在 nb-story 包里（`packages/nb-story/tests/kernel-acceptance/`，只加测试、不改 nb-story 的产品代码）经 `@notnotype/nb-harness/kernel` 与 `/kernel/testing` 用新内核写一遍 `story.qa` Profile 与 `answer` 收尾工具（用 nb-story 内部的账本、校验与防剧透，依赖方向不变），跑“两轮、收尾、校验失败再交、中止、出站过滤防剧透” | 五个场景通过，并逐项核对第 1 节决定 8 每一项的测试（`complete()`、运行结果、错误归类、密钥遮盖、进程收尾、相邻 user 合并由第 2、9 片的测试覆盖，这里列出对应测试名）。这是门：任一失败就停下，不进第 11 片与收口；缺口先回写 Spec 与本计划再修，修完重跑受影响切片的测试与这五个场景 |
| 11 | 性能：提案第 19 节六项（打开与恢复、单条事件归约、提交渲染、预览、普通请求、换 Profile 与压缩后的重渲染），2 万条验收、10 万条报数 | 第 1 节决定 9 的预算；结果写进 `evidences/` |
| 12（可选） | 主线之后按需：预览过去请求的重建与请求录制、`ctx.status`、拦截的 `layer`（加了以后拦截序变化按 `profileChanged{code-updated}` 处理） | 不改日志格式 |

收口：nb-harness 全量、`test:affected`、`test:llm`；对第 6 节每条映射做变异检查（改坏实现，确认对应测试失败）；Task README 写完成状态与证据；按第 1 节决定 4 报深入审查的计划与预算。

## 6. 验收映射

每片开工前写好 Spec 条目后，在这里加“Spec 编号 → 测试”的行。第 1 片之前先列各片的映射对象：

| 片 | Spec 条目（第 1 片起逐片填编号） | 测试 |
|---|---|---|
| 2 | `harness.session`（格式、批、修复、锁、大块内容、版本）；`harness.runtime` 的最小循环；`harness.models` 的适配器 | `log/*.test.ts`、`model/*.test.ts`、`kernel.llm.test.ts` |
| 3 | `harness.extensions`（定义、装配、`ctx`、反应、`mount`） | `extension/*.test.ts`、`dispatch/*.test.ts` |
| 4 | `harness.profile`（模板、布局、`turn`、`commit`、槽） | `view/*.test.ts` |
| 5–8 | `harness.runtime`（工具、收尾、拦截、审批、指令、运行控制、等用户、压缩） | `run/*.test.ts`、`compaction/*.test.ts` |
| 9 | `harness.runtime` 的宿主面、`harness.extensions` 的撤回 | `session/*.test.ts` |
| 10 | `agent/harness.md` 输出 10–21 在新 Spec 里的对应条目 | `packages/nb-story/tests/kernel-acceptance/*.test.ts` |

## 7. 验证

- 测试用真内核；存储用做 JSON 往返的内存存储，关键场景另以 JSONL 在临时根（`createTestTmpRoot`）上跑；不用 mock、spy、假计时器，时钟注入。
- 存储：真实写出一段日志后，对最后一批的每个字节偏移各截一份，逐份打开，断言丢弃量、修复后的文件、再追加后能正常打开；写与 `fsync` 失败经注入的文件句柄端口（产品代码用 `node:fs` 的实现，没有测试专用分支）；两个真实子进程抢同一会话的锁。
- 进程崩溃：子进程跑运行，停在一个手动工具里，经标准输出报“工具已开始”，父进程收到后 `kill -9`；重开断言恢复的收口与缓冲区。不断言杀在批中途。
- 真实模型：第 2、9 片的 `kernel.llm.test.ts`（luna 已全面授权；DeepSeek 按 `llmTestConfig` 有凭据才跑）。
- 旧实现不动：nb-story、nb-agent-ui 的测试照跑。
- 未验证边界：浏览器侧的帧消费与 `SessionMirror`（迁移 Task）；真实压缩方法（t11）；t06 的规则表；平台贡献点接线（t10）；按需读取大块内容（第一版全量读回）。

## 8. 不做与风险

**不做**：Agent 插件与贡献点接线（t10）；界面（t17）；t06 的规则表与 `ask` 工具；压缩方法（t11）；会话存放位置与 `home/`、地址方案（t08、Agent 插件）；模型目录与凭据的实现（t09；本包只有端口与 OMP 适配器）；工具结果过长的溢出（t12 的文件工具与 t08 的 `session://artifacts/`）；迁移脚本与 nb-story、nb-agent-ui 的迁移（迁移 Task）；后台任务（t22）；eval（t21）；提案第 18 节推迟的功能；子代理工具的失败码表（t14 的工具在 Agent 插件里，表在 t14 的实施计划；t14 决定 33 随之改注）。

**风险**（按返工量排）：

1. 状态机的核心（缓冲区与队列交织、写入批、位置章、`commandAccepted`、等用户、`mount`）在第三稿 spike 里没跑过（审查 Z9）：第 2 片的纵切先用真实存储与真实适配器跑通最小循环，第 6、7 片拆细；每片发现提案说不通时先改 Spec 与本计划。
2. 日志格式晚改要迁移：事件名、`source` 规则、会话头、`commandAccepted`、大块内容、批字段都在第 1、2 片定，第 10 片的 nb-story 验收门是第一次真实使用方检验。
3. OMP 从 18.2.5 跨到 18.14.0：第 0 片单独做，带真实模型 smoke。
4. 性能：第 2、4 片各有出口测量，超预算当片改结构，不拖到第 11 片。
5. 定稿类型只过 tsc：第 3–5 片按它实现时撞上的推断问题，解决办法写进 Spec 与提案决策记录。
