# t52 实施计划：K1 内核——开放运行位置、按调用方门面、远程服务与子实例

## Context

- **为什么做**：开发者 2026-10-07 认可多实例运行时拓扑（`docs/proposals/multi-instance-runtime-topology.md`，下称拓扑稿）、插件的数据与状态（`docs/proposals/plugin-data-model.md`）与 ADR 0024（`docs/adr/0024-multi-instance-runtime-topology.md`）。新应用要支持多项目（每个项目一个子进程里的内核实例）、TUI 客户端，以及 Agent 读状态、操作界面。现在的内核只认识封闭的几种运行位置，服务只能一次产出一个共享实例、看不到调用方，插件之间也没有跨实例通信。
- **K1 的产出**：在 `packages/nb-runtime` 实现拓扑稿第 11 节 K1 列出的内核机制，并先修订对应 Spec。只动内核，不接产品；真实 WebSocket 与浏览器宿主归 K2，项目子进程归 K3，Storage 归 K4，插件状态 store 归 K5。
- **开发者已确认**（2026-10-07）：K1 一个 Task、内部分片逐片提交；`runtime/plugin-channel.md` 原地改写为远程服务与 RPC 协议，保留路径与 capability；本 Task 实现通用的“拥有者定义的激活事件”机制，`onRemote` 是第一个使用者；主 Agent 编码，omp（默认模型）只读审查；内核可依赖 TypeBox。
- **必须先满足的审查条目**（`.agents/works/w00017-application-runtime-architecture/tasks/t51-runtime-topology-design/evidences/` 的 `omp-review.txt` 与 `omp-rereview.txt`）：初审 2（订阅两端寿命）、3（委托）、4（门面寿命）、5（停止先封闭接纳）、15（等待环）、16（两层版本）；复审 1（同实例调用也按消费方取门面）、2（上下文走路由帧）、3（门面内存状态不跨代次）、7（激活期超时强制）、8（帧带期望合同版本）。
- **工作方式**：在 worktree `.worktree/w00017-runtime-foundation`（分支 `refactor/w00017-runtime-foundation`）。每片自跑验证后单独提交，只暂存本片文件。测试用真实内核实例，不用 mock、spy、假计时器、固定等待；时间相关的用注入时钟。不修改 `packages/neuro-book-legacy`。

## 执行前（退出计划模式后的第一步）

1. **保存计划**：把本文件存为 `.agents/works/w00017-application-runtime-architecture/tasks/t52-kernel-instances-remote/plan.md`；Task README 改为链接它、只记录当前进展（删掉 README 里旧的切片表）。
2. **回写计划指南**（开发者 2026-10-07 要求：不在计划模式也能写出同等质量的计划；内容参照计划模式注入的工作流与计划文件要求，改写为项目通用、不绑定特定宿主）：
   - 新建 Skill `.agents/skills/implementation-planning/SKILL.md`，全文见本文末“附录：计划指南全文”；
   - `.agents/skills/README.md` 的列表加一行：`[implementation-planning](implementation-planning/SKILL.md)：实现非平凡 Task 前写实施计划（plan.md），交开发者确认后再实施。`；
   - `.agents/works/README.md`“创建与执行”一节加一句：`非平凡 Task 的实施计划按 [implementation-planning](../skills/implementation-planning/SKILL.md) 写在 Task 目录的 plan.md，开发者确认后再实施；Task README 只链接计划并记录进展。`；
   - 新增符号链接 `.claude/skills/implementation-planning -> ../../.agents/skills/implementation-planning`（与现有 7 个 Skill 的做法一致）。
3. `docs:check`、`governance:check` 后提交（计划、Task README、Skill、两个 README、符号链接）。然后从 S0 开始。

## 关键设计

### 1. 运行位置与时钟（`src/lifecycle/`）

- `contracts.ts`：`RuntimeLocation` 改为 `string`（宿主声明，内核不列举）；保留类型名，调用方不用改。装配逻辑不变：`plugins/registration.ts`、`application/bootstrap.ts` 仍只比较相等。
- 新增 `clock.ts`，从 `./lifecycle` 导出：`RuntimeClock {now(): number; schedule(callback: () => void, ms: number): () => void}` 与 `systemClock`。参照 `packages/neuro-book/src/plugins/http/server/admission.ts` 的 `DrainClock` 形状；远程调用超时与子实例宽限期用它。

### 2. 调用方身份与按调用方门面（`src/services/`、`src/plugins/`）

- **调用方身份**（`services/contracts.ts`）：`ConsumerIdentity {instanceId, location, plugin: string | null, entry: string | null, generation: number | null, via: {plugin, entry, generation} | null}`。`ConsumerDeclaration` 增加可选 `identity: {plugin, entry}`；`ServiceAccess` 由 `access(entryId, scope?, {generation?})` 建立，激活代次从这里带入。非插件消费者（宿主能力、门禁）的 `plugin` 为 `null`。
- **插件侧 API**（`plugins/plugins.ts`）：保留 `provide(key, instance, release?)`（共享实例，语义不变）；新增 `providePerConsumer(key, (consumer: ConsumerIdentity) => facade, {release?(facade, consumer)})`。它返回带内核品牌的提供项，经现有 `#provide`（`plugins/host.ts`）交付给服务装配，`adopted` 规则不变。
- **绑定**（`services/composition.ts` 的 `#bind`）：发现交付的是按调用方提供项时，不返回共享值，而是取门面：
  - 缓存键：提供者本次尝试（`Attempt`）+ 消费方 `entryId` + 激活代次；同步工厂，天然 single-flight。
  - 门面资源登记在该次激活的作用域上（插件入口为 `plugin:<id>#<代次>` 作用域；`host.ts` 里必需依赖用激活作用域、可选依赖用其子作用域 `entry-work`，两者共用同一门面），`dependsOn` 指向借用；消费方作用域关闭时调用插件的 `release` 并作废门面。
  - 提供者尝试作用域离开 `available`（`stopSignal`）时作废它的全部门面。
  - 作废：内核返回的是自建 `Proxy` 包装，作废后任何属性访问都抛 `ServiceRevokedError`（带服务键与调用方，替代 `Proxy.revocable` 的无信息 `TypeError`）。门面应是由函数组成的普通对象；需要导出响应式对象的接口仍用 `provide`。
  - 门面里的内存状态随门面释放；底层持久数据归 Storage、配置等拥有者，不归门面。
- 不变量：现有 `services.test.ts`、`plugins/*.test.ts` 全部不改即通过（普通共享服务语义不变）。

### 3. 委托（`src/plugins/`）

- 声明：`PluginEntryDefinition.delegates?: ReadonlyArray<ServiceKey<unknown>>`（本入口可代表消费方解析的键）；`PluginHostOptions.delegation?: (pluginId: string) => boolean`，由装配方给出允许的内置插件，第一版第三方一律不允许。
- 凭据：内核传给按调用方工厂的 `ConsumerIdentity` 是冻结对象，登记在内核内部的 `WeakMap`（身份 → 签发记录：消费方、所属门面的子作用域）。
- 使用：代理插件在门面方法里调用 `context.services.resolveFor(consumer, key)`。内核核对：`consumer` 是内核签发的、签发给本入口的门面、本入口 `delegates` 含 `key`、插件在允许清单内；通过后以原消费方身份（`via` 填代理）取目标门面，登记在签发记录的子作用域上，随代理给该消费方的门面一起释放。
- 远程情况下，消费上下文由路由帧携带（见第 5 节），不进入业务参数。

### 4. 激活事件（`src/plugins/`、`src/application/bootstrap.ts`）

- `ActivationEvent` 改为 `string`：`onStartup`，或 `<前缀>:<参数>`。
- `PluginDefinition.activationEventPrefixes?: ReadonlyArray<string>`：本插件拥有的前缀。内核保留前缀 `onRemote`。登记时入口声明了无人拥有的前缀：按 `runtime/plugin-manifest.md` 忽略该事件并记诊断，不拒绝插件。
- `PluginHost.triggerActivationEvent(event, {requester, signal?}) → Promise<ReadonlyArray<ActivationResult>>`：只有前缀拥有者（`onRemote` 为内核路由）能触发；激活本位置所有声明了该事件的入口，复用现有 `activate()`（`host.ts`）的共享激活与等待语义。
- `bootstrap.ts` 的 `onStartup` 选择逻辑不变。

### 5. 远程服务（新目录 `src/remote/`，导出 `./remote` 与 `./remote/testing`）

- **依赖**：`package.json` 加 `typebox`（与新应用相同 `^1.3.6`），校验用 `typebox/value` 的 `Value.Check`，与 `packages/neuro-book/src/plugins/commands/shared/contracts.ts` 同一用法。
- **`contract.ts`**：`defineRemoteService({id, version, callers, methods, events})`。方法：`{input, output, effect: "read" | "write", errors?: Record<码, TSchema>}`；事件：`{filter, payload}`；`callers` 为允许的实例种类。合同版本第一版按整数精确匹配，兼容范围以后再加（Spec 写明）。
- **`protocol.ts`**（纯模块）：
  - `WIRE_PROTOCOL_VERSION`；帧类型：`hello`、`request`、`ack`、`result`、`error`、`cancel`、`subscribe`、`event`、`unsubscribe`、`resync`。
  - 帧字段：请求 id、目标、合同 id 与期望合同版本、方法、参数，以及只由内核填写的 `consumer`（调用方与激活代次，含 `via`）、`activationChain`。业务参数里出现这些保留字段名一律 `invalid-input`。
  - 请求状态机：未派发 → 已派发（收到 ACK）→ 已回复。失败码：未派发阶段 `invalid-input | denied | target-gone | unavailable | version-changed`；已派发后读请求按原因报告，写请求一律 `unknown-outcome` 附 `cause: target-gone | timeout | cancelled | disconnected`；回复阶段为成功、合同声明的业务码或 `provider-error`。ACK 不证明无副作用。
- **`node.ts`**：每个内核实例一个 `RemoteNode`。
  - 本地提供者登记：合同 id → 提供项（由 `provideRemote(contract, factory)` 交出，工厂与第 2 节同一个按调用方机制）。
  - 出站：`use(contract).at(target)` 返回客户端；目标在本实例时走本地路径：同样按消费方取门面、不序列化；`validateLocalCalls` 为 true（宿主在开发模式打开）时按合同校验输入输出，拒绝不可序列化值。
  - 入站：校验合同版本与 `callers`、按 `consumer` 取门面、执行、按合同校验输出；目标入口未激活时经第 4 节触发 `onRemote:<合同 id>`。
- **`router.ts`**（服务端实例使用）：实例登记表 `{instanceId, kind, project: {id, generation} | null, connectionGeneration, link}`；目标解析（`project` 按调用方绑定、`server`、`{project}`、`{client}`）；转发帧；按连接记录在途请求，连接结束按第 5 节阶段规则结算；`instances()` 查询。`{project}` 目标的租约核对在 S9（第 8 节）接入。
- **`transport.ts`**：`RemoteLink {send(frame), onFrame(listener), onClose(listener), close()}`。`testing/in-process.ts`：`createLinkPair()`，测试与 K3 之前的组合测试使用；产品代码没有测试分支。
- **插件接线**（`plugins/contracts.ts`、`host.ts`）：`PluginEntryDefinition.remoteProvides?: ReadonlyArray<string>`（合同 id，静态，供 `onRemote` 与目录查询）；`ActivationOutput.remote?: ReadonlyArray<RemoteProvision>`；`ActivationContext.remote.use(contract)`。`PluginHostOptions.remote?: RemoteNode`；`ApplicationManifest` 透传，没有配置远程节点时 `context.remote` 的调用返回 `unavailable`。

### 6. 订阅（`src/remote/`）

- 提供方实现 `subscribe(filter, sink, {signal})`；订阅方拿到可释放句柄，登记在其激活作用域上。
- 订阅记录绑定：订阅方实例 + 入口激活代次、提供方实例 + 入口激活代次、所经连接代次。任一入口开始停止、提供项撤回、实例失效、连接结束都取消，`signal` 触发，迟到的 `event` 帧丢弃。
- 同一项目代次内重连：只重建仍有效的订阅并发 `resync`；旧代次订阅不复活。同实例订阅用同样的作用域规则。

### 7. 激活期远程调用与等待环（`src/remote/node.ts`、`src/plugins/host.ts`）

- 激活期间 `context.remote` 发出的调用：超时取 `min(作者给的超时, maxActivationCallMs)`，默认上限 10 秒，宿主可配置，作者只能更短。
- `activationChain`：入站请求触发入口 E 的 `onRemote` 激活时，E 激活期间发出的调用帧携带“入站链 + E”；节点发现要激活或等待的入口已在链中，立即返回 `unavailable`（`cause: activation-cycle`）并记诊断，不挂起。

### 8. 子实例与租约（新文件 `src/application/children.ts`，从 `./application` 导出）

- `createChildInstances(parent: Application, options)`：`options` 含宿主回调 `create(key, generation) → Promise<ChildHandle>`、`stop(handle, {signal}) → Promise<"closed" | "forced">`，以及 `graceMs`、`stopDeadlineMs`、`clock`。父实例只持子实例记录，实际进程由宿主提供（K3）。
- `acquire(key, holder) → Promise<{status: "acquired", lease: {key, generation, release()}} | {status: "rejected", reason}>`；`state(key)`；`list()`。
- 状态：`creating → available → idle-grace → stopping → terminated`。新租约在 `creating` 等创建结果；`idle-grace` 中取消关闭回到 `available`；`stopping` 不复活，等退出后以新代次创建；子实例代次单调、不复用。`stop` 返回 `"forced"` 时记为外部观察到的终止并写诊断，不报为正常关闭。
- 父实例停止：监听 `parent.root.stopSignal` **同步**关闭接纳（之后 `acquire` 返回 `admission-closed`），再由登记在根作用域上的资源依次停止子实例、等真实退出或超时强制结束。
- 第 5 节路由的 `{project}` 目标在这里接入：调用方必须持有该代次的租约。

## Spec 与文档改动（S0）

| 文档 | 改什么 |
|---|---|
| `docs/specs/runtime/lifecycle.md` | 运行位置由宿主声明；`RuntimeClock` |
| `docs/specs/runtime/services.md` | 调用方身份含激活代次；按调用方门面的寿命、作废与 `ServiceRevokedError`；委托（签发、核对、`via`）；新增验收场景 |
| `docs/specs/runtime/plugins.md` | `providePerConsumer`、`delegates`、`remoteProvides`、`ActivationOutput.remote`；激活事件前缀与 `triggerActivationEvent`；门面与订阅随入口停止撤回 |
| `docs/specs/runtime/application.md` | 子实例、租约状态表、父实例停止先封闭接纳；远程节点透传 |
| `docs/specs/runtime/plugin-manifest.md` | 运行位置开放（场景 13 改为未装配本位置的入口是 `foreign-location`）；`remoteProvides` 与代理能力的清单字段；`onRemote` 为内核保留前缀 |
| `docs/specs/runtime/plugin-channel.md` | 原地改写为“远程服务与 RPC 协议”：合同、寻址、请求阶段与失败码、两层版本、保留帧字段、订阅、按需激活、等待环、传输接口；WebSocket、端口与 `Origin` 留给 K2 时补；HTTP 路由贡献一节标注移交 `nbook.http` 相关 Spec；README 注册表同步标题 |
| `docs/specs/runtime/plugin-hot-plug.md` | 入口停止时远程门面与订阅的撤回 |

已 `implemented` 的 Spec 在原文上增补，新增条目标明“随 t52 实现”；`planned` 的按拓扑稿改写。修改记法时在 `docs/` 中搜索旧写法一并改（`docs/specs/AGENTS.md` 第 3 条）。

## 切片

| 片 | 对应设计 | 提交边界 | 自跑验证 |
|---|---|---|---|
| S0 | Spec 改动表 | 7 份 Spec 与 README 注册表 | `bun run docs:check`、`bun run governance:check` |
| S1 | 第 1 节 | 运行位置、时钟 | `bun run --cwd packages/nb-runtime typecheck`、`bun run --cwd packages/nb-runtime test`、`bun run --cwd packages/neuro-book typecheck` |
| S2 | 第 2 节 | 调用方身份、按调用方门面 | 同 S1 |
| S3 | 第 3 节 | 委托 | 同 S1 |
| S4 | 第 4 节 | 激活事件 | 同 S1 |
| S5 | 第 5 节 `contract.ts`、`protocol.ts` | 合同与协议纯模块、TypeBox 依赖 | 同 S1；`bun install` 后确认锁文件只多 `typebox` |
| S6 | 第 5 节其余 | 节点、路由、传输、插件接线 | 同 S1 |
| S7 | 第 6 节 | 订阅 | 同 S1 |
| S8 | 第 7 节 | 激活期超时与等待环 | 同 S1 |
| S9 | 第 8 节 | 子实例与租约，接入 `{project}` 租约核对 | 同 S1 |
| S10 | — | Spec 实现合同与证据、Task 证据、omp 审查与修正 | `bun run test:affected --typecheck`、`docs:check`、`governance:check` |

## 验收映射

| 行为 | 测试 |
|---|---|
| `tui` 位置的入口在 `tui` 实例激活；在其它实例为 `foreign-location` | `src/plugins/plugins.test.ts` 增补 |
| 两个插件拿到各自门面并看到自己的身份；同一激活重复解析同一门面；重激活后旧门面抛 `ServiceRevokedError`、新门面可用；提供方停止后门面作废；`release` 失败可诊断；普通共享服务不变 | `src/services/per-consumer.test.ts`，现有测试不改 |
| A 经代理 P 访问 S，S 看到 A（`via` 为 P）；未声明 `delegates` 或不在允许清单的插件被拒；伪造的身份对象被拒；A 直接访问与经 P 访问得到同一命名空间 | `src/plugins/delegation.test.ts` |
| 拥有者触发前缀事件激活对应入口；非拥有者触发被拒；无人拥有的前缀被忽略并记诊断 | `src/plugins/activation-events.test.ts` |
| 每个请求阶段的失败码；写请求派发后断开得到 `unknown-outcome` 附原因；wire 版本不兼容在业务帧前拒绝；合同版本不兼容；业务参数含保留字段被拒 | `src/remote/protocol.test.ts` |
| 三个真实内核实例（服务端、客户端、另一客户端或“项目”）经进程内链路互调；客户端到客户端经服务端转发；同实例调用与跨实例调用结果一致；开发模式本地调用传不可序列化值被拒；提供方看到的调用方不可伪造；首次远程调用按 `onRemote` 激活懒入口 | `src/remote/routing.test.ts` |
| 订阅四种取消条件各一例；迟到事件丢弃；同代次重连后 `resync`；旧代次订阅不复活 | `src/remote/subscriptions.test.ts` |
| 两个入口激活期间互相远程调用：双方得到 `unavailable`（`activation-cycle`）而不是挂起；激活期超时上限生效 | `src/remote/activation.test.ts`（注入时钟） |
| 租约状态表每个转换；宽限期内新租约取消关闭；`stopping` 不复活；代次不复用；父实例停止后新租约被拒、子实例先停；强制结束记为外部终止；`{project}` 目标无租约被拒 | `src/application/children.test.ts`（注入时钟） |

## 验证

- 每片：上表的 nb-runtime `typecheck` 与 `test`；类型改动影响新应用时跑 neuro-book `typecheck`。
- 收口：`bun run test:affected --typecheck`（覆盖 nb-runtime 与依赖它的 neuro-book），`docs:check`、`governance:check`。
- 端到端（本 Task 范围内）：`routing.test.ts` 用三个真实 `Application` 实例、真实插件定义与进程内链路，走完“客户端调用 → 服务端路由 → 目标实例按需激活 → 按调用方门面执行 → 结果返回”和订阅推送全链。
- 未验证的边界（明确留给后续）：真实 WebSocket、断线与浏览器刷新（K2）；真实子进程、进程间通信与强制结束（K3）；TypeBox 进入浏览器构建后的体积（K2 测量）。

## 不做

- WebSocket、`Origin` 校验、握手与浏览器宿主接线（K2）；项目子进程、项目登记表与锁（K3）；Storage、配置、store、公开状态（K4–K6）。
- 现有插件（`nbook.commands`、`nbook.workbench` 等）改用远程服务。
- 第三方插件的代理能力；合同版本的兼容范围。

## 风险

- S2 改已 `implemented` 的服务合同：先让现有全部测试原样通过，再加新路径；若 `#bind` 的改动影响借用与收口顺序，停下来先补 Spec 再改。
- `Proxy` 门面不适合导出响应式对象：Spec 写明门面应为函数组成的普通对象。
- 进程内链路证明不了真实断线时序：这类验收明确移交 K2，不用假时序冒充。

---

## 附录：计划指南全文（`.agents/skills/implementation-planning/SKILL.md`）

```markdown
---
name: implementation-planning
description: 实现非平凡的 Task 前写实施计划：新功能、改变已有行为或结构、跨多个文件、存在多个可行做法或需求要先读代码才清楚时使用。产出 Task 目录下的 plan.md，开发者确认后再实施。
---

# 实施计划

计划回答“为什么做、具体改哪里、按什么顺序、怎么证明做对了”。它让开发者在动代码前确认方向，也让实施者不用再发明设计。

## 何时写

- 写：新功能；改变已有行为或结构；跨两三个以上文件；存在多个可行做法；需求要先读代码才清楚。
- 不写：单点修复、措辞修改，或开发者已给出具体改法的小改动。

## 流程

1. **理解**：读请求与相关代码。主动找可复用的现有函数、工具与模式，不另写已有的实现。只把会改变结果、范围或不可逆后果的问题交给开发者。范围不明或涉及多个区域时，宿主支持的话可派只读探索子代理，给每个子代理一个明确的搜索范围。
2. **设计**：形成推荐方案。复杂取舍可请独立的规划子代理设计一版，对照后取舍。
3. **复核**：回读计划依赖的关键文件，核对方案与开发者原意一致；剩余问题在定稿前问清。
4. **写计划**：按下面的结构写 `plan.md`。
5. **交开发者确认**：回复中给出要点与需要确认的项。确认前不改产品代码、不提交实现。

## plan.md 的结构

1. **Context**：为什么做——要解决的问题、由什么引起（开发者要求、审查结论、上一个 Task 的结果）、期望结果；依据的 Spec、Proposal、ADR 链接；开发者已确认的决定；工作方式与约束。
2. **关键设计**：按模块或目录分节，节标题写路径。每节写：要改或新增的文件；新增接口的签名或形状；要复用的现有函数与工具（带路径）；要守住的不变量与理由。
3. **Spec 与文档改动**：文件 → 改什么。
4. **切片**：顺序、每片对应哪几节关键设计、提交边界、自跑验证命令。
5. **验收映射**：Spec 验收场景或计划里的行为 → 由哪个测试、smoke 或 e2e 覆盖。
6. **验证**：端到端怎么验证（运行哪些命令，真实浏览器或真实进程怎样观察），以及明确留下的未验证边界。
7. **不做与风险**。

## 写法

- 只写推荐方案，不罗列备选；被否决但有长期价值的备选写进 Proposal。
- 短到能快速扫完，细到能直接照着实施。
- 同一模式在多个文件重复时，只描述一次并列出几个代表路径，不逐个枚举文件或行号。
- 表格单元格只放短语与引用；设计写在“关键设计”的正文里。
- 不写时间估计。

## 与 Task 的关系

- `plan.md` 放在 Task 目录；Task README 只链接它并记录当前进展。
- 实施中计划失效（发现新事实、开发者改了方向）时，先改 `plan.md` 再继续，不让代码与计划分叉。
- Task 完成后计划保留作历程，不再更新；当前状态以 Task README 为准。
```
