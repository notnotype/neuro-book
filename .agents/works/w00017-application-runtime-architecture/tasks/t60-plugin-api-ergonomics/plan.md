# t60 实施计划：插件写法收敛与内核精简

## Context

- **为什么做**：开发者 2026-10-08 评估内核 API，确认两组改动。
  - **写法**（“第 1、2 两个问题都优化，按照你说的进行优化”）：
    1. **声明写两遍**：静态的 `provides`、`remoteProvides`、`receives`、`contributions` 与激活产出里的实现各写一遍，漏写或多写要到第一次激活才报错；`remoteProvides`、`remoteDelegates` 写合同 id 字符串，`provides` 却写键对象。
    2. **方法写三遍**：示例 `counter`、`board` 的浏览器入口把远程合同原样包成本地服务，一个方法在合同 schema、本地服务接口、转发包装里各写一遍；包装后提供方看到的调用方是包装入口，不是真正发起调用的插件。
    3. **只想要值的调用方**每次都要判断 `.ok`。
    4. **选用规则散在三处、互相不一致**：ADR 0024 第 4 条（同实例用本地服务、跨实例用远程服务）；`examples/README.md`（插件两端用远程服务、对外一律包成本地服务）；`runtime/plugin-api.md`（planned，要求本地服务也全部返回 Promise、只传可克隆值，与已实现的 `CommandService`、`PublicStateService` 的同步接口冲突）。
  - **精简**（“三处精简都做，并进 t60 计划”）：
    5. **本地委托没人用**：`resolveFor` 与 `delegates` 在产品与示例里都没有调用方，只有内核测试；远程服务在同一实例里也能调用，远程委托 `remote.on` 已覆盖它的用途。
    6. **贡献点校验的跨点查询代价大**：`validate(descriptor, declarations)` 能查别的贡献点，内核为此有环检测、校验栈、查询缓存与“别处登记变化时重新推导接受与否”；唯一用户是命令 `when` 在登记时核对公开键，而求值时已经会核对同一件事。t56 实现审查的两条发现（列表查询指数级、环的前提）都出在这里。
    7. **接收者有两个能否决激活的回调**：`prepare` 与 `commit` 都能让激活失败，实际需要否决的只有 HTTP 路由（同一插件重复挂载），它在 `prepare` 里就能拒绝；命令表的 `prepare` 是空的，登记放在 `commit` 里，激活最终失败的入口的命令会短暂出现在命令表里（t56 给公开状态加 `published` 时修过同一类问题）。
  - **文档**（“之前我们讨论的这些，可能是文档和 spec 的薄弱点，看情况补充进去”）：
    8. 讨论中开发者问到、而文档没有直接答案的几件事：插件、入口、服务、依赖的关系与依赖归谁；一个入口能做什么、一个位置能否有多个入口；可选功能（原“联动”）有哪几种写法；远程调用从哪种实例能到哪种实例；委托是什么。答案散在 `plugins.md`、`services.md`、`plugin-channel.md`、`projects.md` 与 2026-09-30 的提案决策里。
    9. 开发者问以后加 TUI 时 `nbook.storage` 能否不改代码就用。现在不能：内核按运行位置精确匹配入口，客户端代码在浏览器目录里，依赖的宿主能力名是窗口专用的。开发者 2026-10-08 确认：设计（入口按拓扑角色匹配，例如 `role: "client"`；与浏览器无关的客户端代码放中立目录；宿主能力改用中立名字）先写进 `plugins.md`，TUI 立项时再实现。
  - **另开的后续**：内核的目录查询（本实例的插件与服务、别的实例是否提供某份合同、区分“没装”与“暂时不可用”的失败码 `not-provided`）由开发者 2026-10-08 确认在 t60 之后单开 Task，不在本计划内。
- **期望结果**：静态声明与激活产出不一致时编译期报错；调用远程服务只有一种写法；一条选用规则写进作者面向的 Spec 与示例；内核去掉本地委托、跨点校验查询与接收者的 `commit`。
- **不改的设计**：合同仍是值（TypeBox schema）；插件定义仍是常量（[ADR 0026](../../../../../docs/adr/0026-plugin-definitions-as-constants.md)）；远程调用仍返回结构化结果、不抛异常；回调不改成事件（开发者 2026-10-08）；内核对激活产出的运行期核对（`missing-service`、`undeclared-remote` 等）全部保留，编译期核对是它的前移；远程委托、代理允许清单与调用方身份的 `via` 不变。
- **工作方式**：worktree `.worktree/w00017-runtime-foundation`，分支 `refactor/w00017-runtime-foundation`。主 Agent 编码，逐片自跑验证后单独提交，每个提交都能通过类型检查与测试；收口后 omp（默认模型）后台只读审查。测试用真实内核实例，不用 mock、spy、假计时器与固定等待。

## 关键设计

### 1. 删除本地委托（`packages/nb-runtime/src/services/`、`src/plugins/`）

- 删去 `ActivationContext.services.resolveFor`、`PluginEntryDefinition.delegates`、服务装配里 `#resolveFor`、`#delegatedFacade`、`#releaseDelegated` 与签发记录上的 `delegated` 列表，以及登记期对 `delegates` 的核对和 `delegation-denied` 这个解析失败原因。
- 保留：签发记录本身（`issuedTo`，`remote.on` 靠它核对“这个身份是签发给本入口门面的、门面还没释放”）、`ConsumerIdentity.via`、`PluginHostOptions.delegation` 允许清单、`remoteDelegates`。
- `src/plugins/delegation.test.ts` 里本地委托的用例删除；其中核对“伪造身份被拒、门面释放后身份失效”的部分若 `src/remote/delegation.test.ts` 没有等价用例，改写成远程委托的用例保留。

### 2. 贡献点校验不再跨点查询（`src/plugins/`、`packages/neuro-book/src/plugins/commands/`）

- `ContributionPointDefinition.validate(descriptor)` 只看这一条声明本身。删去 `ValidationCycle`、`#validating`、`#validated` 与跨点推导；“已接受”由这条声明自身的校验与同 id 重复两项决定，不随别的贡献点变化。
- `ActivationContext.declarations` 保留为只读查询（公开状态在拥有者入口激活前读声明靠它）；它不再出现在校验函数里，也就不会再有环。
- 命令：`validateCommandContribution` 去掉 `when` 键的核对，只核对声明形状、运行位置等自身规则。`when` 引用的键是否存在改在求值时判断（`evaluateContextWhen` 已经先调 `validateWhen`）：未声明或不是布尔的键使命令不可用，原因写明，命令表按（命令，键）记一次诊断。命令表登记（`registry.register`）也不再查键；Lab 的本地命令表同样按求值时处理，产品与 Lab 一个口径。
- `packages/nb-runtime/src/plugins/declarations.test.ts` 删去环与跨点推导的用例，保留只读查询的用例；命令的“未声明键”用例从登记期拒绝改为求值期不可用。

### 3. 接收者去掉 `commit`（`src/plugins/host.ts`、`contracts.ts`）

- `ContributionReceiver` 只剩三个回调：`prepare`（预占或否决，抛错即本次交付失败、激活失败）、`published`（这一项已发布、`implementation()` 可用，此时生效）、`revoke`（撤回，幂等）。交付事务改为：全部 `prepare` 成功 → 贡献方发布 → 逐项 `published`；任一 `prepare` 失败则逆序 `revoke` 已准备的项。补交给已发布的贡献方时，`prepare` 成功后立即 `published`。
- 删去激活阶段 `commit`、失败原因 `receiver-commit-failed` 与交付状态 `committing`。`published` 抛错仍只记诊断。
- 接收者改法：
  - HTTP 路由表：`prepare` 预占不变，挂载从 `commit` 移到 `published`；
  - 命令表：登记从 `commit` 移到 `published`，登记被拒（与贡献校验不一致，属于缺陷）记诊断；
  - 示例 `menu`：`commit` 改为 `published`；
  - 公开状态已经用 `published`，不变。
- 实施前先通读 `#deliverPlans` 与补交路径，核对 `commit` 没有承担别的时序（例如补交与激活交错时的去重）；有的话先停下来补 Spec 再改。

### 4. 声明写合同对象（`src/plugins/`）

- `PluginEntryDefinition.remoteProvides` 与 `remoteDelegates` 的元素由合同 id 字符串改为 `RemoteContract` 对象，与 `provides` 写键对象一致；内核在 `registration.ts`、`host.ts` 里取 `.id`，前缀、重复、代理允许清单的核对规则不变。
- 目录与诊断仍给 id；插件清单的 JSON 仍写 id，清单装载时换成合同对象的事留给清单实现。

### 5. `defineEntry`：编译期核对激活产出（新文件 `src/plugins/define.ts`，从 `./plugins` 导出）

```ts
export function defineEntry<
    const Provides extends ReadonlyArray<ServiceKey<any>> = readonly [],
    const Remote extends ReadonlyArray<RemoteContract> = readonly [],
    const Receives extends ReadonlyArray<string> = readonly [],
    const Contributions extends ReadonlyArray<ContributionDeclaration> = readonly [],
>(entry: TypedEntryDefinition<Provides, Remote, Receives, Contributions>): PluginEntryDefinition;
```

- `TypedEntryDefinition` 与 `PluginEntryDefinition` 字段相同，只是 `activate` 的返回值按声明收窄（用 `NoInfer`，防止从产出反推声明使核对落空）：
  - `services`：与 `provides` 按顺序一一对应的元组，第 i 项必须是 `ProvidedService<第 i 个键的服务类型>`；
  - `remote`：与 `remoteProvides` 按顺序一一对应，第 i 项必须是该合同的 `RemoteProvision`；
  - `receivers`：键恰好是 `receives` 列出的贡献点；
  - `contributions`：每个贡献点下的键恰好是本入口声明的贡献 id；
  - 没有声明的那一类不能在产出里出现。
- 运行期是恒等函数；`entries` 仍接受不经 `defineEntry` 的普通对象（测试里的临时插件、以后由清单生成的定义）。
- `ProvidedService<T = unknown>`、`RemoteProvision<Contract = RemoteContract>` 加只在类型上存在的参数，`provide`、`providePerConsumer`、`provideRemote` 返回带参数的类型。
- 按运行位置分支的入口（`nbook.commands` 只有浏览器入口提供远程服务）照常写条件表达式，类型是两种元组的并集；对不上时由运行期核对兜底。
- 已在草稿里验证：漏写、多写、类型不符的服务，漏写、多写的远程提供项，漏写的接收者与贡献实现都报错；多写的接收者要加“未声明时为 `undefined`”的分支才能报出。

### 6. 远程结果取值（新文件 `src/remote/result.ts`，从 `./remote` 导出）

```ts
export class RemoteCallError extends Error {
    readonly failure: RemoteFailure<string>;
    get code(): string;
}
/** 成功给值；失败抛 RemoteCallError，失败码、原因与详情原样放在 failure 里。 */
export function orThrow<T, Code extends string>(result: RemoteResult<T, Code>): T;
```

- 失败放在 `failure` 字段而不是 `cause`：`Error.cause` 是标准字段，含义是“引起它的错误”，与远程失败的 `cause`（`timeout`、`disconnected` 等）重名会混淆。
- 客户端方法的返回值不变，`orThrow` 由调用方选用；Spec 写明写请求的 `unknown-outcome` 被抛出后，调用方仍要按它的含义处理（不能当作确定失败重试）。

### 7. 选用规则与示例（`packages/nb-runtime/examples/`、`docs/specs/runtime/plugin-api.md`）

规则（取代三处现有说法，写进 `plugin-api.md` 与示例 README）：

1. **接口只传数据、调用方可能在别的实例**：定义远程服务合同。所有调用方都直接 `context.remote.use(合同)`，同一实例里的调用方也一样（走本地路径，不序列化，身份与代次照样核对）。
2. **接口只在同一实例里用**：本地服务（`provide`、`providePerConsumer`）。给第三方插件的本地服务仍按 [ADR 0022](../../../../../docs/adr/0022-extensible-platform-and-plugin-trust.md) 第 3 条的数据面约束写（异步、可序列化）；要同步调用或传响应式值、对象引用的接口只限内置插件之间，或属于宿主适配的对象（回调与句柄、`signal`、交给贡献点拥有者的组件与实现）。
3. **许多插件各交“声明 + 实现”、由一个拥有者统一管理**（命令、页面、公开状态键）：贡献点。
4. **在远程服务之上加东西**（同步的响应式视图、缓存、按分区选路、代调用方身份访问）：本地服务包装远程服务，包装处的注释写明加了什么。只原样转发的包装不写。

示例按规则改：

- `counter`：删去浏览器入口、`CounterService` 与 `counterKey`，插件只剩服务端入口；场景 4 的面板探针直接 `context.remote.use(counterContract)` 调用与订阅，并核对提供方看到的调用方是面板插件本身；用 `orThrow` 演示只想要值的写法。
- `board`：同样删去浏览器入口、`BoardService` 与 `boardKey`；场景 6 的探针直接调用，`.at()` 省略即本窗口绑定的项目。
- `cloud-notes` 保留：它以调用方身份代理（规则 4），是 `nbook.storage` 的同款结构。
- `menu`：接收者的 `commit` 改为 `published`（第 3 节）。
- `probes.ts` 新增 `remoteProbe(id, location)`：把探针入口的 `context.remote` 交给场景。
- 全部示例入口改用 `defineEntry`，`remoteProvides`、`remoteDelegates` 写合同对象。README 的“几个概念”与“典型结构”改为上面的规则，插件表里 `counter`、`board`、`menu` 三行同步。

### 8. 产品插件（`packages/neuro-book/src/`）

- 全部插件入口改用 `defineEntry`，`remoteProvides`、`remoteDelegates` 写合同对象。涉及：`plugins/commands/shared/plugin.ts`、`plugins/projects/`、`plugins/storage/`、`plugins/state/shared/plugin.ts`、`plugins/workbench/web/plugin.ts`、`plugins/lab/web/plugin.ts`、`plugins/diagnostics/`、`plugins/http/`，以及 `server/testing/`、`project/testing/`、`web/testing/` 的测试插件。
- 产品里没有只转发的包装：`projects` 浏览器入口已经直接调合同；`storage` 浏览器入口按分区选路、代调用方身份访问（规则 4），保留。

## Spec 与文档改动（S0）

| 文档 | 改什么 |
|---|---|
| `docs/specs/runtime/glossary.md` | “插件与服务”一节补：插件、服务（服务 id 与服务对象的区别）、依赖（属于入口，指向服务 id，只在入口所在的实例里解析；远程调用与贡献都不是依赖）、贡献点与贡献、激活事件、宿主能力、可选功能；“委托”按删去本地委托改写 |
| `docs/specs/runtime/services.md` | 删去本地委托（输出第 13 条及对应验收）；签发记录只服务远程委托 |
| `docs/specs/runtime/plugins.md` | 删去 `delegates` 与 `resolveFor`（输出第 20 条）；校验函数只看单条声明，`declarations` 只在激活上下文里（输出第 23 条）；接收者三个回调与新的交付事务（术语、状态与转换、输出第 15–18、24 条、验收）；`remoteProvides`、`remoteDelegates` 在代码定义里写合同对象；`defineEntry` 的编译期核对；“边界与兼容”记下按拓扑角色匹配入口的设计（Context 第 9 条），标明未实现、随 TUI 实现 |
| `docs/specs/runtime/plugin-channel.md` | `orThrow` 与 `RemoteCallError`；同实例的调用方同样直接用合同；新增“调用方 → 目标”可达表，把输出第 1 条的目标规则与 [`runtime.projects`](../../../../../docs/specs/runtime/projects.md) 输出第 9 条的项目访问规则合成一张表（窗口不能到别的项目、项目实例之间不能互调等） |
| `docs/specs/runtime/plugin-api.md`（planned） | 在“远程形态约束”之前加第 7 节的选用规则，保留 ADR 0022 第 3 条的三类划分（数据面、宿主适配的对象、内置插件之间的内部服务），远程合同归入数据面并由内核按 schema 强制；结构化结果的形状改为现行的 `{ok: false, code, cause?, detail?}`；`defineEntry` 的字段名与内核一致（`dependencies`、`contributions`），删去 `requires`、`contributes`。新增“可选功能”一节：单独的入口加依赖、可选依赖加 `resolve`（同实例里按 `missing-provider` 判断没装）、向别人的贡献点贡献、远程调用失败即不在、公开状态加 `when`，各写适用场合；引 2026-09-30 “不提供检测后持有引用”的决定说明为什么没有“先查再拿” |
| `docs/specs/runtime/plugin-manifest.md` | 删去清单字段 `delegates` 及其无效规则；“现状”一句：代码定义写合同对象，清单 JSON 写 id |
| `docs/specs/workbench/commands.md` | `when` 引用未声明或非布尔的键：由登记期拒绝改为求值时不可用、原因写明、记一次诊断（产品与 Lab 同口径） |
| `packages/nb-runtime/examples/README.md` | 第 7 节的规则与示例变化；“几个概念”补一张插件、入口、服务、依赖的关系图，“入口能做什么”清单（静态声明、激活时能用的、激活产出、内核替它做的），并写明一个运行位置可以有多个入口、各自激活与受阻 |

改到哪份 Spec，就把那份正文里的 Task 引用清掉，只在“证据”一节保留批准依据、实现入口、合同测试与 Smoke。

## 切片

每片连同受影响的示例与产品代码一起改，保证每个提交都能通过类型检查与测试。

| 片 | 对应设计 | 提交边界 | 自跑验证 |
|---|---|---|---|
| S0 | Spec 与文档改动表 | 7 份 Spec 与示例 README 的概念部分 | `bun run docs:check`、`bun run governance:check` |
| S1 | 第 1 节 | 删除本地委托 | 内核两条、应用两条（见下） |
| S2 | 第 2 节 | 校验不再跨点查询；命令 `when` 改为求值时判断 | 同 S1 |
| S3 | 第 3 节 | 接收者去掉 `commit`；HTTP、命令表、示例 `menu` 改用 `published` | 同 S1 |
| S4 | 第 4–6 节 | 合同对象声明、`defineEntry`、带参数的提供项类型、`orThrow`；各处 `remoteProvides`、`remoteDelegates` 机械改成合同对象 | 同 S1 |
| S5 | 第 7 节 | 示例改用 `defineEntry`、删去只转发的包装、场景、`probes.ts`、示例 README | 内核两条 |
| S6 | 第 8 节 | 产品插件与测试插件改用 `defineEntry` | 应用两条 |
| S7 | — | Task 证据、omp 实现审查与修正、Spec 证据行 | `bun run test:affected --typecheck --since 8aa26b09`、`bun run --cwd packages/neuro-book test:e2e`、`bun run --cwd packages/neuro-book smoke:server`、`docs:check`、`governance:check` |

内核两条：`bun run --cwd packages/nb-runtime typecheck`、`bun run --cwd packages/nb-runtime test`。应用两条：`bun run --cwd packages/neuro-book typecheck`、`bun run --cwd packages/neuro-book test`。

## 验收映射

| 行为 | 测试 |
|---|---|
| 远程委托不受影响：伪造身份、门面释放后的身份、不在 `remoteDelegates` 的合同、不在允许清单的插件都被拒 | `src/remote/delegation.test.ts`、示例场景 5 |
| 校验函数只看单条声明：一条声明的接受与否不随别的贡献点的登记、撤销变化；`declarations` 只读查询照常 | `src/plugins/declarations.test.ts` |
| 命令 `when` 引用未声明或非布尔的键：命令登记成功、不可用、原因写明、诊断只记一次；键之后被声明并就绪时变为可用 | `packages/neuro-book/src/plugins/commands/` 的命令表与贡献点测试 |
| 接收者：`prepare` 抛错使激活失败并逆序撤回已准备的项；激活最终失败时 `published` 不被调用；补交时 `prepare` 后立即 `published`；HTTP 同一插件重复挂载仍被拒；激活失败的入口的命令不出现在命令表里 | `src/plugins/owner-contribution-points.test.ts`、`plugins.test.ts`；应用包 HTTP 与命令测试 |
| 漏写、多写、类型不符的服务；漏写、多写的远程提供项；漏写、多写的接收者；漏写的贡献实现：各一条编译期反例（`@ts-expect-error`） | `src/plugins/define.test.ts`（随 `tsc --noEmit` 检查），另有一例运行期：`defineEntry` 返回原对象、登记与激活照常 |
| `remoteProvides` 写合同对象：前缀不符、重复、产出与声明不一致的运行期核对不变 | 现有 `src/remote/*.test.ts`、`src/plugins/*.test.ts` 改写法后通过 |
| `orThrow`：成功给值；路由层失败、带 `cause` 的 `unknown-outcome`、合同声明的业务失败都抛 `RemoteCallError`，`failure` 原样 | `src/remote/result.test.ts` |
| 窗口里的插件直接调服务端与项目的合同；提供方看到的调用方是面板插件本身 | `examples/scenarios/04-remote-service.test.ts`、`06-project-instance.test.ts` |
| 产品行为不变 | 应用包全部测试、e2e、`smoke:server` |

## 验证

- 每片按切片表自跑；收口跑 `bun run test:affected --typecheck --since 8aa26b09`（不给基准时只看未提交改动，逐片提交后选不中任何包）、应用包 e2e 全量与 `smoke:server`。
- 变异核对：编译期核对逐项放宽（例如把 `services` 放宽成任意数组），对应的 `@ts-expect-error` 变成“未使用”而让类型检查失败；接收者把 `published` 提前到贡献方发布之前，“激活失败时 `published` 不被调用”的用例失败；命令表恢复登记期查键，“未声明键时登记成功”的用例失败。
- 未验证的边界：`defineEntry` 的报错文案取决于 TypeScript 版本，只核对“报错”，不核对文案。

## 不做与风险

- 不做：插件清单 JSON 的装载（id 换合同对象）；`CommandService` 的监听随调用方入口自动释放；回调改事件；改远程客户端的返回形状；按拓扑角色匹配入口的实现（只写设计）；目录查询与 `not-provided`（另开 Task）。
- 风险：第 3 节改已 `implemented` 的交付事务。缓解：先通读现有交付与补交路径，现有用例改写前后逐条对照；发现 `commit` 承担别的时序就停下来补 Spec。
- 风险：第 2 节让 `when` 写错的键晚一点暴露（面板里显示不可用，而不是登记时拒绝）。缓解：原因写明“未声明的键”，诊断记一次。
- 风险：`defineEntry` 的类型错误信息较长。缓解：`define.ts` 注释与 `plugins.md` 写明“按 `provides` 的顺序给出”，反例测试固定下来。
- 风险：规则 1 让远程合同成为插件对外的公开接口，改合同要按版本处理。这是选用规则本身的代价，写进 `plugin-api.md`。

## 实施中的调整

- 2026-10-08 写 S0 时发现：本计划第 7 节原写“本地服务可以同步、可以传任意值”，与已 `accepted` 的 [ADR 0022](../../../../../docs/adr/0022-extensible-platform-and-plugin-trust.md) 第 3 条（给第三方的公开 API 全部异步、可序列化）冲突。改为在 ADR 0022 的三类划分之内写选用规则，不改该决定；第 7 节规则 2 与 Spec 改动表 `plugin-api.md` 一行随之修改。
- 2026-10-08 omp 计划审查（[报告](evidences/omp-plan-review.md)）的处理：
  - 删本地委托时签发记录的收口（`#releaseDelegated`）同时服务远程委托：S1 保留它，改名 `#releaseIssued`。
  - S3 补上工作台页面表 `PageTable.receiver()` 的 `commit` → `published`。
  - `defineEntry` 按第 5 节的写法拦不住非空声明下多写的接收者与贡献实现，omp 的小样还要求产出写 `as const`。S4 改为把激活产出单独推导成 `const` 类型参数、以声明要求的产出为约束，多写的键从实际产出里另行找出，报错写成“缺少属性 多写的接收者：x”；字面量不再需要 `as const`。第一版把产出与核对写在同一个返回类型里，TypeScript 6.0.3 在推导时崩溃（`Debug Failure`），因此分成约束与参数上的额外属性两处。
  - 编译期分不出服务类型相同而 id 不同的两个服务键、形状相同的两个合同；按运行位置分支时只能在整个产出上分支；辅助函数返回宽类型会擦掉要核对的参数。三者写进 `define.ts` 与 `runtime.plugins` 输入一节，不扩大接口；S6 迁移时给辅助函数写出带参数的返回类型。
  - S7 的 `test:affected` 加 `--since 8aa26b09`。
  - 第 3 节“补交时 `prepare` 成功后立即 `published`”漏了整批屏障：实现保留整批 `prepare` 后才交付（只删 `commit` 循环），`runtime.plugins` 验收 27 改写为“这一批全部 `prepare` 成功之后”，场景 7 的测试把失败点从 `commit` 移到第三项 `prepare`。
  - 可选功能表里“远程调用失败即当作没有这项功能”会把拒绝、提供方错误与 `unknown-outcome` 误当成未安装：改为 `unavailable` 时按领域降级、其它失败码按各自含义处理。
  - omp 认为规则 1（同一实例的调用方也直接用远程合同）与 ADR 0024 第 4 条“同一实例内用本地服务”冲突。核实：已接受的[多实例运行时拓扑](../../../../../docs/proposals/multi-instance-runtime-topology.md)第 4 节写明本地与远程共用一个提供者登记、同一实例的调用方同样按消费方取门面，只在本地提供、含不可序列化内容的接口另登记为本地服务；ADR 第 4 条是它的概括，规则 1 不改变决定。`plugin-api.md` 的规则 1 引用这一节为依据，不改 ADR。
  - `plugin-api.md` 原写“其它插件的接口只以 `import type` 使用、构建后不留运行时引用”，拿不到 `ctx.remote.use(合同)` 要的合同值，也与 [ADR 0026](../../../../../docs/adr/0026-plugin-definitions-as-constants.md) 第 2 条不符：改为可以导入合同模块里的服务键与合同，不导入提供方实现。`plugin-channel.md` 远程委托的核对改为直接引用签发记录（不再说“与同一实例内的委托相同”）。
  - 未采纳：omp 指出 HTTP 路由表的重复预占在完整内核下走不到（同一插件的两条路由先被判为 `duplicate-contribution`），建议可删去 `prepare` 与待挂载表。计划已定“`prepare` 预占不变”，这里保留作边界防御，是否精简交开发者决定。`plugin-api.md` 的 `ctx.services.require(id)` 返回 `undeclared-service` 属于 t28 选定的第三方 SDK 形状，与内核 `require(键)` 抛错不同，不在本 Task 范围。
- 2026-10-08 S6：`nbook.diagnostics` 的后端包装（`createServerDiagnosticsPlugin`）装饰内核工厂产出的入口，入口的声明在包装处是宽类型，套 `defineEntry` 核对不到东西，保留原写法；内核工厂里的入口改用 `defineEntry`。`nbook.http` 的工厂内部是普通入口，照常改用。按运行位置分支的入口（命令、Storage）用条件展开 `...(browser ? {remote: [...]} : {})`，编译期只核对产出符合其中一种声明，写进 `define.ts` 与 `runtime.plugins`。
- 2026-10-08 omp 报告补充一条（命令求值遇到第一个坏键即返回、只有文案）：S2 按原因文案去重，一条命令有两个坏键时第二个要等第一个修好才报出。改为 `validateWhen` 逐个核对、结果带结构化的 `invalid`（键与原因），命令表按（命令，键）去重记诊断；面板照旧隐藏不可用命令，坏键经诊断与 `isEnabled`、远程 `list` 的原因可查（第 2 节风险里“面板里显示不可用”不准确，以此为准）。
- 2026-10-08 omp 报告补充一条建议（删掉浏览器包装后，示例不再说明订阅归发起调用的入口）：场景 4 加一例，面板插件装在窗口的子作用域里，关掉后它的订阅结束、之后的变化不再送到它，同窗口的另一插件照常收到；`remoteProbe` 的注释写明订阅归探针入口这一代。
