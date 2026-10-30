# t20 实施计划：harness 事件模型内核

## 1. Context

**为什么做**：w00032 接入 Agent 的各个 Task（t03 会话、t05 Profile、t06 审批、t07 运行控制、t09 模型、t10 插件、t11 压缩、t14 多 Agent）都建在 harness 内核上。t20 讨论定了内核的形状：一台由日志驱动的异步状态机（[提案第五稿](../../../../../docs/proposals/agent-harness-event-model.md)），开发者 2026-10-29 认可，定为实施时排在最前。

**期望结果**：`@notnotype/nb-harness` 里有一个能用的新内核：指令进、帧出；日志是唯一真相源；扩展与 Profile 用同一套接口；回退、重启、压缩、预览由日志归约自动正确；插件作者能用真内核写测试。

**依据**：

- 提案第五稿（第 1–16 节、待定项）；接口以 [`spike/v5/`](spike/v5/api.ts) 为准（`api.ts`、`host.ts`、`testing.ts`），能跑的参照是第三稿 spike（`spike/kernel.ts`、`core.ts`、`template.ts`，53 个场景 `check.ts`）。
- t02 决定 1–7（包与分工、OMP 升级、Spec 随代码搬来；运行时层按语义参照、不照搬分支）；t03 决定 1–6；t04 决定 1–7；t06 决定与 2026-10-30 改判；t07；t11；t14 决定 10、17、24–27 与提案末尾 2026-10-30 的三处内核修正。

**开发者已确认的决定（2026-10-30）**：

1. 起点与落点：新内核作为 `nb-harness` 的新实现，以第三稿 spike 为起点按第五稿重写；分支 `feat/w00002-harness-kernel` 的 JSONL 存储、工具声明与校验、模型目录与凭据、压缩触发估算照 t02 搬来。开发期间旧的 `createHarness` 留着只为让 nb-story、nb-agent-ui 的测试照跑；t20 完成后紧接着开迁移 Task：nb-story 改用新内核（顺带用上 rewind 等 nb-story 没用到的功能来验证内核），nb-agent-ui 的 transcript 适配器按新日志重写，删旧实现，`nb-session`、`nb-profile` 停更。
2. 范围只做包内内核（见第 8 节“不做”）。
3. 提案待定项按推荐定：叫“扩展”；Profile 在拦截链最里层；拦截加 `layer: "outer" | "inner"`（缺省 inner，脱敏与审计用 outer）；上限反应链 3 层、`continue` 每轮 3 次、处理函数 30 秒；快照存在压缩点加稀疏检查点（按第 12 片的测量决定是否要检查点）；请求录制缺省关；工具拦截附加的说明进日志；流式增量不给扩展；一次逻辑请求一条 `modelStarted`；扩展 id 为“插件 id”或“插件 id.名字”；`input` 保持；加 `<Slot drop>` 与只推界面的 `ctx.status`；性能预算 10 万条事件打开 1 秒内、算一次请求 50 毫秒内。待定项 7（反应的主动接口）、8（大块内容另存）、11（请求完整形状）、13（导出过滤）在实现中定，定了写进 Spec 与本计划。
4. 审查：本计划走快速审查（omp 会话加 Claude Opus 同开，Opus 的结论处理完就开工，omp 的报告回来再处理）；实现做一次深入审查，开审前报计划与预算。

**工作方式**：Work 分支 `feat/w00032-agent-integration`，worktree `.worktree/w00032-agent-integration`（从本地 master 建）；主会话自己写（线性推进，上下文在主会话里）；Spec、提案、ADR 与 Task 记录在主工作区 master 上改、路径限定提交。

## 2. 技术选型

| 通用问题 | 选用 | 理由 | 否决 |
|---|---|---|---|
| 日志存储 | 分支的 JSONL 存储（`session/jsonl/jsonl.ts`），加写入批 | t03 定会话为文件、可读、与 omp 兼容；分支已有按字节截断中断尾与 `repair` | SQLite：事务现成，但会话目录要可读可拷，且 nb-history 之外再引一份库文件不划算 |
| 写入批的原子性 | 一批的全部行一次 `write` 后 `fsync`；每行带 `batch: {id, n, of}`，加载时末尾不完整的批丢弃 | 单写者下只有文件尾可能不完整，不需要提交标记行 | 每批另写提交标记行：多一行、读时要两遍扫描 |
| schema 与校验 | TypeBox（设置、`initial`、`payload`、事件数据） | 仓库与平台合同已全是 TypeBox；nb-form 能照它画设置 | 另写 `setting.*` 辅助函数（提案第 20 节不采纳） |
| 工具参数校验 | OMP 的 JSON Schema 校验器（分支 `tools/adapter.ts` 的理由：与服务商侧同一实现） | 直接调用与经模型调用结果一致 | TypeBox 校验器（pattern 的 `u` 标志语义不同） |
| 提示词模板 | 自带的最小 JSX 运行时（spike `template.ts`，经典 JSX，`jsxImportSource` 指向包子路径） | 只有九个节点，不需要组件库 | React 或 prompt-tsx：依赖重、语义不同 |
| 不可变状态 | 片按整片替换（补丁是浅层的），开发模式递归 `Object.freeze` | 补丁按片给，不需要结构化共享的库 | immer：多一层代理，冻结与快照语义要再对 |
| 时钟与超时 | 注入的时钟接口（`now`、`setTimeout`），测试用手动推进的实现 | 提案第 9 节要求；仓库测试规则禁止假计时器 | `bun:test` 的假计时器 |
| 请求哈希 | `node:crypto` 的 SHA-256，按块的来源与文字逐块累加 | 跨进程稳定，`Bun.hash` 不保证跨版本一致 | — |
| id | `crypto.randomUUID()`；顺序靠 `seq` | 与分支一致 | ULID：顺序已由 `seq` 给出 |
| 与服务商通信 | OMP `@oh-my-pi/pi-ai` 的 `streamSimple`（升到 18.14.0） | 开发者 2026-10-29 定；不再用 `pi-agent-core` 的 `Agent` | — |
| token 估算 | 分支 `compaction/trigger.ts` 的估算（上一次用量加之后新增的内容） | 已按 t11 写过 | — |

## 3. 关键设计

新代码放 `packages/nb-harness/src/kernel/`，子路径导出 `./kernel`、`./kernel/testing`、`./kernel/jsx-runtime`、`./kernel/jsx-dev-runtime`；旧的 `.`、`./testing` 不动。迁移 Task 删旧实现时再决定新内核是否升为根导出。

### 3.1 `kernel/log/`：事件、写入批与存储

- `events.ts`：`Event`、`KernelEvents`（v5 `api.ts` 的表，等用户改为 `interactionRequested`、`interactionResolved`，提案第 11 节）、`Scope`、`kind`、位置章 `place: {kind: "attachment", turnId} | {kind: "after-step", turnId, step} | {kind: "next-turn"}`（只在 `conv` 上）。
- `store.ts`：`LogStore` 接口 `{create(header), load(id), append(batch), repair(id)}`；`memory-store.ts`；`jsonl-store.ts` 由分支 `session/jsonl/jsonl.ts` 改来：行加 `batch` 字段，`load` 丢弃末尾不完整的批并报告。
- `validate.ts`：打开时校验（id 唯一、seq 递增、父节点在前、类别与作用域合法、类型是内核事件或带扩展前缀、幂等键不重复、批完整），不过就拒绝打开，失败码 `log-corrupt`。
- 幂等：`(source, key)` 索引；命中返回第一次的结果，不跑反应。
- 不变量：已写的行不改；单写者（3.4）保证同一会话只有一个写入顺序。

### 3.2 `kernel/extension/`：接口、契约与装配

- `define.ts`：`defineExtension`、`implement`、`defineContract`、`optional`、`shape`、`slice`、`conv`、`ext`，类型照 v5 `api.ts`（含 `NoInfer` 护栏、`NoKernelNames`），运行时只是带品牌的普通对象。
- `profile.ts`：`defineProfile`、`deriveProfile`（必须给新 id；`render`、`tools`、`extensions` 逐项合并）。
- `assemble.ts`：输入 Profile、宿主给的插件扩展（按 `pluginExtensions` 排除）、内置扩展（`core.history`、`core.compaction`）；输出有序的扩展表与清单哈希。规则：id 全局唯一（含 Profile），格式“插件 id”或“插件 id.名字”；`dependsOn` 拓扑排序、同层按 id；缺依赖、成环、重复拒绝并列出来源；装配时检查设置的每项都有 `default`、处理函数与 `render` 的键都是已知事件、槽名。拦截顺序：`layer: "outer"` 的插件扩展、`inner` 的插件扩展、Profile 的 `extensions`、Profile 自己、审批（内核）。

### 3.3 `kernel/state/`：归约与 `core.history`

- `reduce.ts`：每个扩展的片按作用域分两组；path 片随叶子走，session 片在树外；归约按“事件名 → 同作用域片的补丁”；出错写诊断、这次补丁不用、叶子照样前进；`resetOnCompaction` 的片在 `compaction` 上回到初值。
- 状态的存放：path 片沿树做持久化（每个节点存相对父节点的变化，参照 spike `core.ts` 的持久链表），回退只换叶子。
- `core-history.ts`：从位置章归约出 `Turn`（`input`、`attachments`、`steps{reply, results, after}`、`status`）与已提交的轮；导出 `input`、`current`、`turns`、`runs`。
- 快照与检查点：第 12 片按测量决定；接口先留 `snapshotAt(node)`。

### 3.4 `kernel/dispatch/`：单写者、反应与装上

- `queue.ts`：每个会话一条写入队列；指令、`mount` 里的外部事实、反应输出都排进来；前一项连同它引出的全部反应做完，后一项才开始。
- `react.ts`：`on` 在事件写入并归约后调用；同一事件的处理函数看同一份状态、可并发、输出按扩展顺序写；`emit`、`set` 先收集、完成时作为一个写入批写入；抛错、超时整批丢弃并写 `extensionFailed{dropped}`；完成后再调用报 `emit-after-settle`；深度上限 3 写 `reactionLimit`；超时中止处理函数自己的 `ctx.signal`。
- `mount.ts`：装上时调用、内核等它完成才受理指令；返回的清理函数在摘下时调用；`ctx.callback` 包外部回调。运行中写入的外部事实留到下一个边界。
- `ctx.status(文字)`：只推 `status` 帧，不进日志。

### 3.5 `kernel/view/`：模板、请求与提交

- `jsx-runtime.ts`、`template.ts`：节点 `<System>`、`<User>`、`<Assistant>`、`<P>`、`<Tag>`、`<If tool>`、`<History last?>`、`<Turn />`、`<Slot name stable|volatile|drop|shared>`；容器每个子节点一段、段间空一行；`<Turn />` 恰好一个。
- `layout.ts`：`standardLayout({volatile, history})`。
- `format.ts`：`Format`（`user`、`assistant`、`assistantText`、`tool`、`step`、`steps`、`turn`、`withRender`），块带 `Origin`；`finalOnly`、`withoutEvents`。
- `request.ts`：由视图算 `ModelRequest`（三段：已提交的前缀、进行中的这一轮、会变的后缀，各存增量哈希）；提交在 `turnEnded` 时用 `commit` 渲染一次并校验（工具调用与结果成对、角色顺序），不合格用缺省并写 `extensionFailed`；提交绑定 Profile 内容哈希，`profileChanged` 后全部重新渲染。开发模式检查相邻两次渲染的前缀与“提交等于最后一次渲染”。
- 槽：`contribute` 按扩展顺序成块；撞名未写 `shared` 报 `slot-collision`；没摆的报 `slot-unplaced`（`drop` 的不报）；会变的槽在系统提示词里报 `slot-volatile-in-system`。

### 3.6 `kernel/run/`：指令、循环与拦截

- `commands.ts`：`send`、`enqueue`、`edit`、`remove`、`resolve`、`start`、`abort`、`rewind`、`compact`、`changeSettings`、`changeProfile`，每个带 `commandId`（幂等键），失败码照 v5 `host.ts` 的 `commandErrors` 加 `resolve` 的三个；成功带 `seq`。
- `loop.ts`：照提案第 1 节的运行图与边界顺序（外部事实与设置 → steer 全部取走 → 估算与压缩 → 视图与模型拦截链，最里层先写 `modelStarted`）；取走输入与 `inputConsumed`、`turnStarted`、`input` 同批；`turnEnded` 之前到达的 steer 算这一轮；followup 一条一轮；`continue` 按“这一轮、这个扩展”计数。
- `tools.ts`：执行前写 `toolStarted`；按声明的 `concurrency` 切段（`shared` 连续并发、按调用顺序启动，`exclusive` 单独），结果按调用顺序作为一个写入批；整批写完再派发反应。工具声明与参数校验搬分支 `tools/define.ts`（名字换算改为 t04 的 `.` → `__`、上限 64）。
- `intercept.ts`：四条包裹式拦截链（输入、模型、工具、压缩）；块按引用比出改动，`modelStarted.modifiedBy` 记录；脱敏 `redacted` 只记哈希；失败按提案第 9 节的表；审批是工具链最里层的宿主钩子 `approve(call, info) → allow | deny | ask`，t20 只给“全部放行”的缺省实现与 `ask` 走等用户通道的接线，规则在 t06。
- `abort.ts`：`ctx.signal` 贯穿；内核等的每个 Promise 与中止赛跑；模型请求写 `modelFailed{kind: "aborted"}`，没完成的工具写 `status: "unknown"`，以 `aborted` 收口；迟到结果只写诊断。
- `recover.ts`：打开时结算半截运行（提案第 2 节“打开与恢复”）。
- `rewind.ts`：`rewindTargets()` 与压缩切点同一条规则（轮或步的边界）；运行中要 `abort: true`；`resend` 回退后入队并开始。

### 3.7 `kernel/interaction/`：等用户

- 事件 `interactionRequested{id, callId, kind, request}`、`interactionResolved{id, decision, by, data?}`；运行状态 `waiting`；同一批工具的几个事项可同时待处理、任意顺序应答，全部处理完回到运行。
- `resolve` 的发出者由宿主注入（用户或父会话）；单写者裁决并发应答（`already-answered`）。
- 异步提问：问题照写 `interactionRequested`、工具立即返回；`resolve` 在同一批里写 `interactionResolved` 并把回答作为输入放进缓冲区；被回退掉的分支上的事项应答得 `unknown-interaction`。
- 结算：中止写拒绝并注明 `aborted`；工具被卸载按 `tool-unavailable`。

### 3.8 `kernel/compaction/`：切点与公共流程

- 触发：边界第 3 步估算（搬分支 `compaction/trigger.ts`）；服务商报溢出时按溢出顺序压缩后同一请求再发一次，最多一次；`compact(要求)`。
- 切点半开区间，只能是轮的 `turnStarted` 或进行中这一轮某一步的 `assistant`；`omitted` 带占位；`core.history` 按提案第 10 节归约。
- 公共流程：`opening()` 的片在压缩上重读；`core.compaction` 把放回的内容写成 `conv` 事件与压缩同批、盖位置章；重试同一请求时不重复写。
- 方法接口 `CompactionMethod`，t20 只带一个测试用方法（按切点直接截断），`shake`、`inplace`、`summary` 在 t11。

### 3.9 `kernel/model/`：OMP 适配器

- `omp-adapter.ts`：照提案第 9 节“模型适配器”表：`ModelRequest` → `streamSimple` 参数；事件流 → `delta` 帧（带请求序号与连续编号）；`done` → `assistant`（内容块含思考与签名、工具调用、用量、停止原因）；`error`、中止 → 错误类别与部分内容。OMP 内部重试算一次逻辑请求、每次尝试记进诊断。
- 模型与凭据：搬分支 `models/`（目录、角色选择链、能力检查、凭据）。`nbook.models` 插件（t09）以后包一层，本包不依赖 NeuroBook。

### 3.10 `kernel/host/`：会话 API、帧、预览、诊断、镜像

- `session.ts`：`createSession`、`openSession`（`load` → `recover` → 装配 → `mount`），返回 v5 `SessionApi`（指令、查询、`subscribe`）。
- 帧：`log`、`delta`、`status`、`diagnostic`、`reset`；`log(afterSeq, limit)` 分页。
- `preview.ts`：`next` 跑一遍视图与模型拦截链（`phase: "preview"`），最里层截下；过去的请求由日志重建并用 `modelStarted.hash` 比对（`reconstructed`），录制打开时 `exact`。
- `diagnostics.ts`：码表照 v5 `diagnosticCodes`，英文 `message` 与 `hint`，按（码、扩展、入口、事件类型）合并计数；改变结果的另写 `extensionFailed`。
- `mirror.ts`：`createSessionMirror()`，纯函数，浏览器与 nb-story 共用。

### 3.11 `kernel/testing/` 与 helper

- `createTestSession`：真内核、内存存储；只假模型（脚本化）、工具、时钟、资源；`say`、`mark`、`rewind`、`state(扩展)`、`eventsOf`、`requests[n].outline()`、`clock.advance`、手动模式；严格模式在关闭时检查没被认领的 error 诊断，并从头归约一遍与现场比对。
- helper：`reminder()`、`opening()`、`standardLayout()`、`finalOnly()`、`withoutEvents()`、`format.withRender()`、`deriveProfile()`，只用公开接口写成。

## 4. Spec 与文档改动

在主工作区 master 上做，第 1 片：

- 提案 `docs/proposals/agent-harness-event-model.md`：`status: accepted`、`decided`，决策记录追加本计划第 1 节的决定 3。
- 新 ADR（下一个编号）：harness 以日志为唯一真相源、内核自写循环、扩展四件事。
- 把分支的 `docs/specs/harness/*.md`（session、profile、runtime、tools、models、compaction、config、glossary、builtin-tools）搬到 master，按提案“对 Spec 的预期改动”改写 `session`、`profile`、`runtime`，新写 `extensions`；`tools`、`models`、`compaction`、`config` 只改与本内核相关的条目；都标 `planned`。`docs/specs/agent/harness.md` 独有的条目并进对应那份后删除（t02 决定 5）。
- `packages/nb-harness/AGENTS.md`、`README.md`、`docs/omp-capabilities.md`：新内核的入口、OMP 18.14.0 的版本表、完成门禁加新内核的测试。

## 5. 切片

每片单独提交，自跑 `bun run --cwd packages/nb-harness typecheck` 与 `bun test`（新内核的测试在 `src/kernel/**`）。

| 片 | 内容（关键设计） | 自跑验证 |
|---|---|---|
| 0 | 建 worktree；OMP 全部 `@oh-my-pi/*` 升到 18.14.0（先读 18.2.5 起的 changelog），改 `omp-capabilities.md` 版本表 | nb-harness 现有测试、`bun run test:affected`（含 nb-story、nb-agent-ui） |
| 1 | 第 4 节的提案、ADR 与 Spec（主工作区） | `bun run docs:check`、`governance:check` |
| 2 | 3.1 日志与存储 | 存储场景：截断尾、不完整批、校验失败、幂等；子进程写到一半被 `kill -9` 后重开 |
| 3 | 3.2 装配、3.3 归约与 `core.history` | 装配错误表、作用域、回退后片的值、深只读 |
| 4 | 3.4 单写者、反应、`mount` | 写入批、超时中止、`emit-after-settle`、深度上限、外部事实到边界 |
| 5 | 3.5 视图 | 模板与布局、槽诊断、提交校验、前缀稳定检查、`outline()` |
| 6 | 3.6 指令、循环、工具与拦截、中止、恢复、回退 | spike 场景按组搬成测试（运行、插话、followup、continue、并发工具、拦截失败表、中止、恢复、回退） |
| 7 | 3.11 测试工具与 helper；spike 其余场景与 v5 `typetest.ts` 的 29 处写错搬进来 | 严格模式；`tsc` 对写错报出预期的错误 |
| 8 | 3.7 等用户 | 同批多事项、并发应答、异步提问进缓冲区、回退后应答、中止结算、重启后接着等 |
| 9 | 3.8 压缩 | 切点规则、`omitted`、放回内容同批、溢出重试一次、回退到压缩前 |
| 10 | 3.9 模型适配器 | 本机 OpenAI 兼容端点（同现有 `provider.test.ts`）；`kernel.llm.test.ts` 真实模型 smoke（luna 或 DeepSeek，按 `llmTestConfig`） |
| 11 | 3.10 宿主面：帧、快照与分页、预览、诊断、镜像 | 重连补帧、预览保真度、诊断合并、镜像的“需要注意” |
| 12 | 性能：提案第 19 节六项（打开与恢复、单条事件归约、提交渲染、预览、普通请求、换 Profile 与压缩后的重渲染）；超预算时加检查点快照 | `bench/kernel.ts`，结果写进 Task 证据 |

收口：全部片提交后跑 nb-harness 全量、`test:affected`、`test:llm`；Task README 写完成状态与证据；按第 1 节决定 4 报深入审查的计划与预算。

## 6. 验收映射

Spec 在第 1 片写成后，按条目编号回填本表；现在按提案节与 spike 场景对应：

| 依据 | 覆盖 |
|---|---|
| 提案第 2 节（作用域、写入批、位置章、单写者、打开与恢复） | 第 2、4、6 片的测试；`kill -9` 重开（真实进程与文件） |
| 第 3 节（缓冲区、指令、取走规则、`commandId`） | 第 6 片；重发同一 `commandId` 得到第一次的结果 |
| 第 4–6 节（扩展形状、归约、处理函数、`mount`、`continue`） | 第 3、4、7 片；v5 `typetest.ts` 29 处 |
| 第 7–8 节（对话形状、视图、提交、槽、缓存检查） | 第 5 片 |
| 第 9 节（拦截、审批钩子、失败表、中止、适配器） | 第 6、10 片 |
| 第 10 节（压缩） | 第 9 片 |
| 第 11 节（等用户） | 第 8 片 |
| 第 12、14 节（诊断、宿主接口、预览、镜像） | 第 11 片 |
| 第 15 节（测试工具） | 第 7 片 |
| 第 19 节（性能） | 第 12 片 |
| spike 53 个场景 | 第 6、7 片逐个搬成测试，场景编号写在测试名里 |

## 7. 验证

- 单测与场景测试用真内核与真实存储（临时根 `createTestTmpRoot`）；不用 mock、spy、假计时器，时钟注入。
- 崩溃：子进程跑一次运行，在写入批中途 `kill -9`，父进程重开，断言不完整的批被丢弃、`recover()` 收口为 `interrupted`、缓冲区里没取走的输入还在。
- 真实模型：`kernel.llm.test.ts` 跑一次带工具调用的运行、一次中止、一次续跑（回退后重发），断言日志结构；运行前按测试规则取得授权（luna 已全面授权）。
- 旧实现不动：nb-story、nb-agent-ui 的测试照跑通过。
- 未验证边界：浏览器侧的帧消费（迁移 Task）；真实压缩方法（t11）；审批规则（t06）；插件撤回与重新装配只测内核侧的 `changeProfile`，平台的贡献点接线在 t10。

## 8. 不做与风险

**不做**：Agent 插件与贡献点接线（t10）；界面（t17）；审批规则、`ask` 工具（t06）；压缩方法（t11）；nb-story 与 nb-agent-ui 的迁移（紧接的迁移 Task）；后台任务（t22）；eval（t21）；`sample`、请求原样复现、一般的缓存比对（提案第 18 节推迟）。

**风险**：

- 体量是本 Work 最大的一块：十二片，每片都有可运行的测试兜底；某片发现提案说不通时先改 Spec 与本计划再继续。
- OMP 从 18.2.5 跨到 18.14.0：第 0 片单独做、先读 changelog，旧实现的测试与 nb-story 的测试都要过。
- JSONL 写入批靠“一次 write 加 fsync”：多行一次写入在崩溃时仍可能只落一部分，所以加载时按 `batch.of` 判完整，不依赖写入的原子性。
- 10 万条事件打开 1 秒内：spike 第三版 1.68 万条 70–240 毫秒，线性外推接近上限，第 12 片测出来超了就加检查点。
- 第五稿接口只过了 tsc、没跑过：第 3–7 片按它实现时可能撞上类型推断的问题，解决办法写进 Spec 与提案的决策记录。
