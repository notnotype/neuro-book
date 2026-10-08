# t61 实施计划：远程提供方查询与失败码收敛

## Context

- **为什么做**：开发者 2026-10-08 在 t60 的讨论与决定里提出四件事（Task README 记录了原话来源）：
  1. **分不清“没装”和“暂时不可用”**：远程调用的目标实例上没有任何入口声明这份合同时，结果是 `unavailable`，与“提供入口受阻、激活失败、正在停止”同一个码，区别只在说明文字里，而规则不允许按文字分支。调用方因此没法写出“没装就隐藏这个功能、暂时不可用就提示稍后再试”。另外，想在调用前知道对方在不在（例如决定显示不显示一个按钮），现在只能真的调一次，而调用会按需激活提供方。
  2. **结果未知的写请求被报成确定失败**（t56 汇报时提出，开发者同意并入本 Task）：写请求的帧已经发出、目标的 ACK 还没回到调用方时链路断开、超时或被取消，现在报 `unavailable`、`timeout` 或 `cancelled`，都是“确定没执行”。但目标可能已经 ACK 并执行了，只是 ACK 在路上丢了。store 把它当确定失败，`retry` 就可能把同一次修改做两次。
  3. **作者 API 的取服务写法与内核不一致**：[`runtime/plugin-api.md`](../../../../../docs/specs/runtime/plugin-api.md) 写 `ctx.services.require(id)`（字符串 id、返回转发器、未声明返回 `undeclared-service` 失败值），内核是 `context.services.require(键)`（提供方 `shared/contracts.ts` 里的键对象，返回服务本身，未声明抛错）。
  4. **同步服务只限内置插件**：`CommandService` 的 `get`、`list`、`isEnabled` 与 `PublicStateService` 的 `read`、`declaration` 是同步的，按选用规则只限内置插件之间使用，代码与 Spec 都没写明。
- **期望结果**：远程调用多一个确定失败码 `not-provided`；新增不激活提供方的查询 `context.remote.lookup`；写请求从帧发出起被中断一律 `unknown-outcome`；作者文档与内核一致。
- **范围调整**：Task README 原记的范围还有“本实例有哪些插件与服务”的查询，本计划不做，理由见“开发者已确认”第 1 项。
- **依据**：[远程服务与 RPC 协议](../../../../../docs/specs/runtime/plugin-channel.md)（planned）；[多实例运行时拓扑](../../../../../docs/proposals/multi-instance-runtime-topology.md)（`accepted`）第 5 节“请求的阶段与结果”；[ADR 0024](../../../../../docs/adr/0024-multi-instance-runtime-topology.md)；[可扩展应用平台设计](../../../../../docs/proposals/extensible-application-platform.md) 2026-09-30 的决定：内核不提供“先检测对方在不在、再持有它的引用”。本计划的查询只返回此刻的信息、不返回引用，查到“在”之后调用照样可能失败。
- **不改的设计**：远程调用返回结构化结果、不抛异常；读请求的阶段规则不变；帧的形状不变（`not-provided` 是结果帧里的新字符串码，查询走普通请求帧），所以不提升 wire 协议版本；新旧两端总来自同一次构建（[`runtime.projects`](../../../../../docs/specs/runtime/projects.md) 边界与兼容）。
- **工作方式**：worktree `.worktree/w00017-runtime-foundation`，分支 `refactor/w00017-runtime-foundation`。主 Agent 编码，逐片自跑验证后单独提交；计划确认后交 omp（默认模型）只读审查计划，收口后再审查实现。测试用真实内核实例与进程内链路，不用 mock、spy、假计时器与固定等待，时间由注入时钟推进。

## 关键设计

### 1. 结果未知的写请求（`packages/nb-runtime/src/remote/protocol.ts`、`peer.ts`、`testing/in-process.ts`）

- **阶段**：`failureFor(phase, effect, cause)` 的 `phase` 由两值改为三值：
  - `undispatched`：请求帧还没交给链路（链路已断、发出前已取消、参数无法编码），或目标在 ACK 之前明确回了失败（这类失败经结果帧到达，不走 `failureFor`）；
  - `sent`：帧已交给链路，还没收到 ACK；
  - `acked`：收到 ACK，还没收到结果。
- **映射**：写请求在 `sent`、`acked` 被断开、超时或取消，一律 `unknown-outcome` 并附 `cause`。读请求不变：`sent` 与原来的“未派发”同码（断开为 `unavailable`、超时为 `timeout`、取消为 `cancelled`），`acked` 与原来的“已派发”同码（断开为 `target-gone`）。
- **`Peer`**：`request` 把帧交给链路成功后，阶段记为 `sent`，收到 `ack` 改为 `acked`；`#interrupt` 与 `#onClose` 按记下的阶段结算。经路由转发的一跳（`router.ts` 用 `Peer.request` 转发并把 ACK 传回）不另改，两跳各自按同一规则结算。
- **同实例调用**（`node.ts` 的 `#localRequest`）保持两值：不经链路，ACK 与开始执行在同一个同步段里，中断时还没 ACK 的请求确定没有执行。
- **测试链路**：`createLinkPair()` 增加 `cut()`：模拟网络中断，已发出但还没送达的帧丢弃，随后两端收到关闭。现有的 `close()` 先送完再关，复现不了“ACK 在途时断开”。真实 WebSocket 在网络中断时同样会丢掉在途的帧，模块头写明两种关闭各自模拟什么。
- **不变量**：写请求只要帧离开了本端，就不能报成确定失败；ACK 的作用只剩区分读请求的断开码。

### 2. 失败码 `not-provided`（`protocol.ts`、`node.ts`、`contract.ts`）

- `REMOTE_FAILURE_CODES` 加 `not-provided`，合同因此不能把它声明为业务失败码（`defineRemoteService` 已按这张表拒绝）。
- `node.ts` 的 `handleRequest`、`handleSubscribe`：提供方查找为 `missing`（目标实例上没有存活登记的、本运行位置的入口在 `remoteProvides` 里声明这份合同）时，结果为 `not-provided`，原来是 `unavailable`。它属于未派发阶段，是确定失败。
- 插件宿主的 `#lookupRemote`：存活插件里没有候选时，再看正在停止的插件（作用域处于 `stopping`）有没有声明这份合同的入口，有则为 `unavailable`（插件正在停止，可能是热重载）；插件已停用、卸载（作用域 `closed`）才是 `missing`。（实施时补：原计划没区分插件正在停止。）
- 仍为 `unavailable` 的情形不变：提供入口受阻、激活失败、正在停止、多个入口声明同一合同、等待环、实例没有插件宿主、本端没连上服务端、服务端正在停止。
- **内核保留的合同 id**：`runtime/` 开头的合同 id 留给内核自带的查询（现有的实例查询 `runtime/instances`，以及第 3 节的 `runtime/catalog`）；`defineRemoteService` 拒绝这类 id，在模块加载时失败。
- **应用里的消费方**：Storage 的 `fromRemote`（`packages/neuro-book/src/plugins/storage/shared/remote-route.ts`）把其余码折算为 Storage 的 `unavailable`，`not-provided` 落在这一支，行为不变，只更新注释。

### 3. 远程提供方查询（`node.ts`、`contract.ts`、`packages/nb-runtime/src/plugins/host.ts`、`contracts.ts`）

- **接口**（`RemoteAccess`，插件经 `context.remote` 使用）：

  ```ts
  lookup<Contract extends RemoteContract>(contract: Contract, ...target: LookupTarget<Contract>): Promise<RemoteResult<RemoteProviderInfo>>;

  // 目标写法与 use(合同).at(目标) 相同：server、project 的合同可以省略，client、any 的必须写。
  type LookupTarget<C extends RemoteContract> = C["provider"] extends "server" | "project"
      ? [target?: RemoteTargetFor<C["provider"]>]
      : [target: RemoteTargetFor<C["provider"]>];

  type RemoteProviderInfo =
      | {readonly status: "provided"; readonly state: RemoteProviderState}
      | {readonly status: "not-provided"}
      | {readonly status: "version-changed"; readonly version: number};

  /** 提供入口此刻的状态；名字与插件目录的 EntryStatus 相同。registered 表示已登记、还没激活，调用时会按需激活。 */
  type RemoteProviderState = "registered" | "activating" | "available" | "blocked" | "failed" | "stopping" | "closed";
  ```

- **语义**：
  - 只读，不激活提供方、不生成门面、不建立订阅；
  - 寻址、路由与访问规则和调用相同，按读请求结算：目标不在为 `target-gone`，`{project}` 无权访问为 `denied`，本端没连上为 `unavailable`；
  - 结果只是此刻的信息，查到 `provided` 之后的调用照样可能得到 `not-provided` 或 `unavailable`，调用方照常处理失败；
  - 版本按调用时的同一规则核对（整数精确匹配），不一致返回提供方的版本；
  - 多个入口声明同一合同时，与调用一样为 `unavailable`；声明它的插件正在停止时为 `provided` 与 `stopping`（实施时改：omp 计划审查第 2 条，查询与调用共用候选规则，调用为 `unavailable`）；
  - 调用方种类不在合同的 `callers` 内为 `denied`，与调用相同。
  - 状态补上 `closed`：插件仍存活、入口这一代已结束且不复活时调用为 `unavailable`（实施时补）。
- **线上**：查询是发往目标实例的普通请求帧，合同 `runtime/catalog`、方法 `lookup`、`effect: "read"`，输入 `{contract, version}`。目标节点的 `handleRequest` 先认出这个合同：校验输入，ACK 后直接回答，不走提供方查找与激活。经服务端路由转发时与普通请求相同；目标是服务端时由服务端节点自己回答。节点不把查询的目标记进“联系过的目标”，调用方入口停止时不为它发释放帧。
- **插件宿主一侧**：`RemoteProviderSource` 增加 `describe(contractId): ProviderDescription`。插件宿主从静态声明 `remoteProvides` 里的合同对象取版本，从入口状态取 `state`，不调用 `activate`。远程模块只依赖 TypeBox 与 lifecycle、services 入口，状态的字面量在远程模块里定义，不引用插件宿主的类型；`remote.test.ts` 的源码守卫照旧。
- **没有远程节点的实例**：插件宿主的 `refusedRemote` 补上 `lookup`，与调用一样得到 `unavailable`。委托入口 `remote.on(调用方)` 只代调用、订阅，不加查询。

### 4. 作者文档与同步服务说明（`docs/specs/runtime/plugin-api.md`、两个服务的合同模块）

- `plugin-api.md` 的激活上下文表：`ctx.services.require(id)` 一行改为内核的写法：
  - 参数是提供方 `shared/contracts.ts` 里定义的服务键（[ADR 0026](../../../../../docs/adr/0026-plugin-definitions-as-constants.md)）；
  - 只取必需依赖，返回服务本身；未声明或可选的键抛错；
  - 可选依赖用 `ctx.services.resolve(键)`。
- 同一张表的 `ctx.remote` 一行补 `lookup`。“错误码”一节去掉 `undeclared-service`：取服务不再返回失败值。
- `plugin-api.md` 的“可选功能”表里远程调用一行改为：`not-provided` 表示目标实例没装（或没启用）提供这份合同的插件，`unavailable` 表示装了但此刻不可用；想在调用前知道、又不想激活提供方时用 `ctx.remote.lookup`。同一实例里的“试探”仍是可选依赖加 `resolve`（原因 `missing-provider` 即没有提供方），不另加查询。
- `CommandService`（`packages/neuro-book/src/plugins/commands/shared/contracts.ts`）与 `PublicStateService`（`packages/neuro-book/src/plugins/state/shared/contracts.ts`）的接口注释写明：
  - 读取是同步的，只限内置插件之间使用（选用规则）；
  - 第三方插件贡献命令与公开键不受影响；
  - 第三方读取的异步写法随第三方插件 API 设计。

## Spec 与文档改动（S0）

| 文档 | 改什么 |
|---|---|
| `docs/specs/runtime/plugin-channel.md` | 术语补“内核保留的合同 id”；输出 4 的阶段表按第 1 节改写，补一句“没收到 ACK 不证明没有执行”；输出 5 改为没有入口声明合同时为 `not-provided`；新增输出 11“查询提供方”；状态表的请求一行改为“未派发 → 已发出 → 已确认 → 已结算”；失败与恢复补 `not-provided` 与查询；验收 4 补“ACK 在途时断开或超时”，新增验收 21（`not-provided`）、22（查询）；实现合同补新符号 |
| `docs/specs/runtime/plugin-api.md` | 第 4 节的三处 |
| `docs/specs/workbench/commands.md` | 失败与恢复里“断线未派发为 `unavailable`，`execute` 派发后断线为 `unknown-outcome`”改为“帧发出后断线、超时或取消为 `unknown-outcome`”；边界与兼容补命令服务的读取只限内置插件 |
| `docs/specs/state/public-state.md` | 边界与兼容补读取服务只限内置插件 |
| `docs/specs/storage/persistence.md` | 两处“写请求派发后断线”改为“帧发出后断线” |
| `docs/proposals/multi-instance-runtime-topology.md` | 只在决策记录追加一行：未派发阶段新增 `not-provided`；写请求从帧发出起中断即 `unknown-outcome`（正文写“已派发到目标实例”，原 Spec 把“派发”落在 ACK 上，ACK 可能丢失）；新增不激活的提供方查询。正文不改 |

改到的 Spec 按规则清理正文里的 Task 引用；`plugin-channel.md` 保持 `planned`。

## 切片

| 片 | 对应设计 | 提交边界 | 自跑验证 |
|---|---|---|---|
| S0 | Spec 与文档改动表、第 4 节 | 5 份 Spec、提案决策记录、两个服务合同的注释、Task README 链接本计划 | `bun run docs:check`、`bun run governance:check`、`bun run --cwd packages/neuro-book typecheck` |
| S1 | 第 1 节 | `protocol.ts`、`peer.ts`、`testing/in-process.ts`、Storage 注释与测试 | `bun run --cwd packages/nb-runtime typecheck`、`bun run --cwd packages/nb-runtime test`、`bun run test:affected --typecheck --package nb-runtime --with-consumers` |
| S2 | 第 2 节 | `protocol.ts`、`node.ts`、`contract.ts` 与测试 | 同 S1 |
| S3 | 第 3 节 | `node.ts`、`contract.ts`、插件宿主与测试 | 同 S1 |
| S4 | — | Spec 证据与实现合同、Task 证据、omp 实现审查与修正 | `bun run test:affected --typecheck --since <计划提交>`、`bun run --cwd packages/neuro-book test:e2e`、`bun run --cwd packages/neuro-book smoke:server`、`docs:check`、`governance:check` |

每片交付前做变异检查：回退该片的核心改动，确认新用例失败。

## 验收映射

| Spec 编号 | 测试 |
|---|---|
| `runtime.plugin-channel` 输出 4、验收 4（ACK 在途时断开、超时、取消：写请求为 `unknown-outcome`，读请求码不变；单跳与经路由两跳） | `packages/nb-runtime/src/remote/routing.test.ts` 的“输出 4”组新增一例：项目入口的写方法执行时以 `cut()` 切断链路，或推进注入时钟越过调用方超时 |
| `runtime.plugin-channel` 输出 5、验收 21（没有入口声明为 `not-provided`；受阻、激活失败仍为 `unavailable`；订阅同样） | `routing.test.ts` 的“输出 1–3、5”组；`activation.test.ts` 现有的激活失败用例保持 `unavailable` |
| `runtime.plugin-channel` 输出 11、验收 22（查询：`provided` 带状态且不激活、`not-provided`、`version-changed`、经路由到项目与另一客户端、`{project}` 无权为 `denied`、没连上为 `unavailable`、同实例） | `routing.test.ts` 新增“输出 11”组 |
| `runtime.plugin-channel` 术语“内核保留的合同 id” | `packages/nb-runtime/src/remote/protocol.test.ts`（`defineRemoteService` 的现有校验组） |
| `runtime.plugin-channel` 验收 20（`orThrow`） | `packages/nb-runtime/src/remote/result.test.ts`，没有提供方的例子改用 `not-provided` |
| `state.store` 输出 13–14 | `packages/neuro-book/src/shared/store/store.test.ts` 现有用例，不改：store 已按 `unknown-outcome` 保留原值重发 |

## 验证

- 每片：上表的内核类型检查与测试；内核接口改动影响应用时，跑应用的类型检查与测试（`--package nb-runtime --with-consumers`）。
- 收口：`test:affected --typecheck --since <计划提交>`；应用 e2e；`smoke:server`；文档与治理检查。
- 未验证的边界：
  - 真实 WebSocket 在 ACK 在途时中断的时序没法稳定制造，由进程内链路的 `cut()` 按同一语义覆盖；
  - 真实浏览器里查询与 `not-provided` 的界面用法要等 t62 的示例与产品插件来用。

## 不做与风险

- **不做**：
  - 本实例的插件与服务目录（见“开发者已确认”第 1 项）；
  - `plugin-api.md` 的“错误码”一节与远程失败码的整体对齐，`plugin-unavailable`、`interrupted` 是旧通道的码，随第三方插件 SDK 设计；
  - `ctx.config`、`ctx.secrets` 随 K6；
  - 合同版本的兼容范围；
  - 自动重试。
- **风险**：
  - 写请求得到 `unknown-outcome` 的情形变多。例如目标正在按需激活时超时，原来是确定的 `timeout`，现在是 `unknown-outcome`。调用方要按领域核对结果；store 已经这样处理，命令的跨实例执行把结果原样交给调用方。
  - 原来把 `unavailable` 当作“没装”的调用方现在会收到 `not-provided`。仓库里只有 Storage 的折算受影响，它落在默认分支，行为不变。

## 实施中的调整

- 2026-10-08 实现 S2 时补：原计划没区分声明合同的插件正在停止。存活插件里没有候选时，再看正在停止的插件，有则调用为 `unavailable`（可能是热重载或实例停止），插件停用、卸载之后才是 `not-provided`。
- 2026-10-08 omp 计划审查（[报告](evidences/omp-plan-review.md)，0 阻断、7 重要、2 建议）全部成立，按报告的编号处理如下：
  1. 同实例调用的门面工厂可以同步停止调用方，调用方得到确定的 `cancelled`，方法照样执行。门面工厂返回后再核对一次终止信号；工厂停止了提供方自己时，立即释放刚生成的门面。先写的两条用例在修正前分别失败（`a7aaca55`）。
  2. 不提升 wire 版本的理由不覆盖浏览器：浏览器首次握手前只核对引导协议与插件版本，旧页面可以连上新服务端，把 `not-provided` 当成未声明的码、仍按 ACK 结算写请求。改为提升到 wire 4，旧页面在握手时被拒、按现有流程提示刷新；“Context”里“不提升 wire 协议版本”一句作废（`1fdf31ef`）。
  3. 漏掉“打开项目”命令：它把 `register` 的 `unknown-outcome` 折成命令的 `unavailable`，“风险”一节“只有 Storage 的折算受影响”不对。但 `register` 按目录幂等（`src/server/projects/registry.test.ts` 已覆盖“同一目录再登记返回同一项、不改动”），结果未知时让用户再试是安全的，不给命令系统另加失败码；只在折算处写明理由，结果未知时原因不再写“登记没有完成”（`26e940a9`）。`list` 的 `not-provided` 按领域折成 `unavailable`。
  4. 正在停止的插件被当成没有提供方：按上面 S2 的补充处理；查询对正在停止的插件返回 `provided` 与 `stopping`，Spec 输出 11 与验收 22 随之修正。入口状态另补 `closed`。
  5. 查询绕过合同的 `callers`：`describe` 返回提供入口静态声明的合同，目标节点按它核对调用方种类，先于版本核对；补“不允许的种类查询为 denied、提供方未激活”（`e25aa86c`）。
  6. 静态声明与激活产出的合同可以不一致，查询与调用的依据永久不同：激活产出核对补一条，产出的合同必须就是 `remoteProvides` 里声明的那个合同对象，否则输出阶段失败 `remote-contract-mismatch`；`runtime/plugins.md` 输出 22、验收 25 随之补写（`b9506967`）。
  7. S1 的提交边界漏了 `node.ts` 与 `protocol.test.ts`：实施时 S1 已一并改了这两个文件（`038abd76`），同实例阶段直接用 `undispatched`、`acked`，没有兼容别名。
  8. ACK 丢失的用例没有逐跳覆盖：改为三种切法（两跳切第二跳、两跳切第一跳、直连），每种都断言方法执行了一次、被切那一跳上收到的 ACK 为 0；超时与取消各有一例。让 `cut()` 不丢在途帧的变异使它失败（`3ab9df51`）。
  9. S0 漏改两处旧失败合同：`plugin-api.md` 验收 2 已在 S0 改为抛错（`b620d521`）；`runtime/plugins.md` 的实现合同改为插件正在停止为 `unavailable`、否则为 `missing`（节点回 `not-provided`），并写明 `describe` 的候选规则（`b9506967`）。
- Spec 输出 11 删去“不为查询发释放帧”一句：调用方观察不到，属于实现细节。
- 2026-10-08 omp 实现审查（[报告](evidences/omp-impl-review.md)，0 阻断、4 重要、0 建议）全部成立，按报告的编号处理如下：
  1. 参数编码期间的同步取消：JSON 编码会运行业务值的 getter，其中触发的取消让写请求得到确定的 `cancelled`，帧却随后发出并执行。`Peer` 登记请求时就记为 `sent`，等待表里不再有 `undispatched`；编码失败仍为 `invalid-input`（`0fe5ad99`）。
  2. 同实例订阅在门面工厂停止调用方后仍建立并送达首个事件：订阅带上订阅方的停止信号，同实例订阅把它接到本地终止信号上，建立中途停止以 `cancelled` 结算、不调用提供方的 `subscribe`；跨实例订阅建立后发现订阅方已开始停止即退订；订阅方开始停止后到达的事件按迟到事件丢弃。Spec 输出 7 随之补写（`0fe5ad99`）。
  3. 同一入口重复声明同一合同 id 时同一性检查仍能被绕过：登记阶段以 `duplicate-remote-contract` 拒绝，`runtime/plugins.md` 输出 22、验收 25 与登记规则补写（`98ddabe4`）。
  4. 多个正在停止的提供入口被查询当成唯一提供方：调用与查询改用同一处 `#remoteCandidates` 选候选（存活优先，没有时取正在停止的），再按数量判冲突（`12e0011a`）。

## 开发者已确认

开发者 2026-10-08 确认以下三项。

1. **不做本实例的插件与服务目录**（Task README 原记的范围）。同一实例里判断一项功能在不在，已有可选依赖加 `resolve`，`missing-provider` 就是“没装”，[`runtime.plugin-api`](../../../../../docs/specs/runtime/plugin-api.md) 的“可选功能”已写明。再加一个不声明依赖就能查的目录，会绕开依赖图（激活顺序、受阻推导都靠静态依赖），也接近 2026-09-30 否决的“先检测再持有”。插件列表现在没有使用者；以后的插件管理界面属于宿主，经宿主能力给内置插件，不放在每个插件的 `context` 上。Task README 的范围随之修订。
2. **查询的写法**：`context.remote.lookup(合同, 目标?)`，目标写法与 `use(合同).at(目标)` 相同，可省略的情形也相同。没有沿用 `.at()` 链式写法：合同里可能有名为 `lookup` 的方法，挂在 `use(合同)` 上会冲突；单独的 `lookup(合同)` 又无法在省略目标时直接 `await`。
3. **写请求的阶段边界从 ACK 提前到帧发出**：读请求的码保持原样，只有写请求更保守。这改变 `plugin-channel.md` 输出 4 已实现的行为，并在已接受的拓扑稿决策记录里追加一行。
