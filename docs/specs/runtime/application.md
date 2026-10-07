---
schema: nbook.spec/v1
kind: behavior
status: implemented
capability: runtime.application
owners:
  - application-runtime
---

# 环境适配与应用运行实例

## 目标与非目标

给浏览器、后端及验证宿主提供一致的运行实例启动、接纳、停止与结果查询边界。环境适配器把宿主事件和已解析能力交给小内核；产品装配选择服务及就绪条件，不把框架 hook、端口监听或页面出现当作业务 ready。

本合同覆盖第一切片的环境适配入口及其后被内置服务消费的门禁接口。第一切片用受控装配验证真实宿主事件，不要求同时迁移完整产品清单。它不规定登录、Project、Job 的领域状态机，不新增 HTTP API、安装升级协议、桌面重写或第三方插件执行沙箱；跨实例调用见 [远程服务与 RPC 协议](plugin-channel.md)；不把 `ready` 扩展为“所有可选功能和 UI 恢复成功”。

## 术语与参与者

- **宿主**：持有浏览器生命周期、受管进程或其它运行环境的实体；只操作自己创建或明确取得管理权的对象。
- **适配入口**：把宿主输入转换为本地运行实例，把结果返回宿主；不拥有业务数据的第二份真相。
- **装配方**：提供该环境的受信插件清单、服务绑定、必需启动门禁与关闭策略。
- **运行实例**：一次环境加载/启动，身份在此次存活期间固定；重启是新实例。
- **接纳门禁**：决定能否开始新业务的结果；与诊断通道、内部清理权限分开。
- **紧急输出**：在诊断插件尚未就绪或失败时仍可报告最小错误的宿主能力。
- **子实例**：由某个运行实例（父实例）按键创建、停止并计数使用者的另一个运行实例，例如服务端为每个打开的项目创建的项目实例。子实例可以在另一个进程里；父实例只持有它的记录与宿主回调，不持有它的作用域。
- **租约**：使用者（客户端绑定、Agent 会话、后台任务）对某个子实例代次的使用登记；最后一个租约释放后子实例进入宽限期。

## 输入与前置条件

1. 输入包含运行位置与实例身份、静态受信清单、本地能力、关闭信号、紧急输出以及装配方指定的必需门禁。根定位、凭据来源及进程管理权限由环境边界先验证；内核不得自行扫描 cwd、用户目录或网络寻找替代根。
2. 相同环境中的不同应用实例必须显式隔离；不是共享一个隐式全局容器。重复启动请求指向同一实例时共享其启动结果，不能再创建一套提供者。
3. 浏览器只获得本地 UI 能力与经身份/授权的远端协议代理；不获得数据库对象、服务端路径或凭据。后端不得把某次请求的身份放入进程级默认服务。
4. 本地服务与插件按 [服务装配](services.md)、[插件运行时](plugins.md) 校验。跨位置不存在对象 DI，也不承诺一次激活事务覆盖网络。
5. 门禁输入可以包含只读检查、租约和必需服务的结果，但不能把启动隐式变成数据迁移或自动修复授权。

## 输出与可观察行为

- 返回/可查询此次运行实例的身份、启动阶段、接纳状态、必需失败与可选失败；报告到具体门禁、插件入口和作用域，不返回 secret、原始环境字典或用户内容。
- 适配入口区分“本地基础可用”“贡献目录可用”和装配方另行报告的业务/UI 恢复结果。只有声明为必需的门禁全部成功才允许新业务；可选失败不阻断无关能力。
- 门禁完成前到达的请求等待同一启动结果或被明确拒绝，不绕过启动、不另起并发初始化。失败不能被解释为成功但没有数据。
- 装配方可以指定启动必需的插件。登记完成后、执行门禁之前，并发激活启动必需插件在本位置的全部入口与声明了 `onStartup` 的本位置入口；依赖先于依赖者完成激活，不按清单顺序串行，其余入口保持懒激活。启动必需插件的入口受阻或激活失败时启动失败；非必需的 `onStartup` 入口受阻或失败只记录为可选失败。
- 停止进入后拒绝新业务与新激活，但已接纳操作以及其清理仍按精确 owner 使用存活依赖。停止结果区分完成、失败/未完成及强制终止后未知，不能把超时映射成正常 closed。
- 描述登记、同一服务重复解析和普通 UI 读取不反复添加进程信号/浏览器监听。实例释放后，适配器自己的监听和订阅不再触发该实例。
- **子实例与租约**：父实例经 `createChildInstances(parent, options)` 管理子实例，宿主回调负责真正创建与停止（例如启动子进程）。`acquire(键, 持有者)` 返回租约或拒绝原因；子实例代次单调递增、不复用。父实例开始停止时**同步**关闭接纳，之后的 `acquire` 一律以 `admission-closed` 拒绝；随后停止全部子实例并等待真实退出或到截止强制结束，最后才释放父实例自己的其余资源。子实例停止期间父实例的插件与资源仍可用（供子实例收口时调用），但 `status()` 已报 `stopping`、`admit` 拒绝新业务。父实例的截止先于子实例停完到达时，父实例停止结算为 `incomplete(deadline)`，不报 closed。强制结束记为外部观察到的终止并写诊断，不报为正常关闭；宿主报告的意外退出同样立即结束该代次、使其租约失效。
- **远程节点**：清单可以给出远程节点，插件宿主据此交出远程提供项、在激活上下文中提供 `remote`；没有远程节点时远程调用返回 `unavailable`。

## 状态与转换

| 当前阶段 | 事件 | 结果 |
|---|---|---|
| 尚未创建 | 合法宿主上下文与清单 | 创建新运行实例；业务接纳关闭 |
| 创建中 | 清单合法、基础/必需门禁成功 | 可用；按装配方合同开放接纳 |
| 创建中 | 必需失败、取消或停止 | 进入停止中，保留失败原因并收口已取得资源与未完成获取；不发布可用结果 |
| 可用 | 显式关闭获准或宿主要求停止 | 停止中；关闭业务接纳，按生命周期合同 drain |
| 停止中 | 所有受管操作、未完成获取与资源均已确认收口 | 已关闭；重复停止观察同一次结果 |
| 停止中 | 清理失败、超时或远端结果未知 | 保持停止中与失败记录；不得给新 owner 报可接管 |
| 任意存活阶段 | 宿主强制终止/页面被丢弃 | 无异步保存保证；恢复由持久化与领域 owner 负责 |

子实例，以“键 + 代次”为单位：

| 当前 | 事件 | 结果 |
|---|---|---|
| 不存在 | 首个 `acquire` | `creating`，新代次；宿主回调创建；等待中的 `acquire` 随创建结果一起结算 |
| `creating` | 创建成功 | `available`；等待者取得租约 |
| `creating` | 创建失败 | `terminated`；等待者得到 `create-failed` |
| `available` | 最后一个租约释放 | `idle-grace`，按注入时钟开始宽限计时 |
| `idle-grace` | 新 `acquire` | 取消关闭，回到 `available` 并取得租约 |
| `idle-grace` | 宽限期满 | `stopping`；宿主回调停止 |
| `stopping` | 新 `acquire` | 不复活本代次；等它进入 `terminated` 后以新代次创建（父实例已在停止则 `admission-closed`） |
| `stopping` | 子实例退出或到截止强制结束 | `terminated`；强制结束带标记与诊断 |
| `available`、`idle-grace` | 子实例意外退出 | `terminated`；全部租约失效，持有者收到失效通知 |
| 任意 | 父实例开始停止 | 同步关闭接纳；存活子实例依次进入 `stopping` |

显式用户关闭的 dirty/在途协商在真正停止前进行；否决不改变原可用状态。程序退出信号、租约失效、用户强制退出不能统一当作可无限否决的关闭请求。已关闭实例不复活；重启分配新实例身份。失败恢复遵循 [资源生命周期](lifecycle.md)，不在每次请求时自动重试。

## 副作用与数据

- 适配器拥有自己登记的宿主监听、计时与协议连接；清单内服务拥有各自资源，资源只登记一个关闭 owner。
- 本能力不定义用户持久格式。正常停止不删除配置、Project 文件、SQLite、Storage 或 Job 记录。
- 后端进程、浏览器实例各有本地所有权树。浏览器释放代理/在场关系不等于远端 Project 或后台任务终止；未收到远端确认不能报告它已 drain。
- 启动/停止结果可供诊断读取，但不得依赖完整日志、Storage 或 Agent 已成功启动才能报告最早失败。

## 失败与恢复

- 缺宿主能力、清单冲突、依赖失败和门禁失败都必须有结构化分类、来源和阶段；人类文案不是程序分支依据。静态预校验拒绝的入口不开始业务；运行期失败可能发生在初始化副作用之后，须阻断接纳/发布并收口，不能宣称先前副作用未发生。
- 取消/停止期间的迟到初始化只能完成资源登记与收口，不能重新开放接纳或发布旧代次句柄。
- 连接断开不证明远端操作取消。适配层不得自动重放非幂等写入；操作结果未知交还原领域恢复。
- 一个监听/诊断输出异常不能跳过其余独立清理；错误聚合且有宿主最小输出兜底。依赖仍在被使用时不能为尽快退出而按成功路径提前释放排他租约。
- 浏览器卸载不能等待任意 Promise；已确认持久数据由服务保证，页面退出仅 best effort。受管进程的有界终止由真正拥有进程的宿主执行，不杀任意 PID。

## 边界与兼容

1. 环境适配器可以依赖框架/OS，机制不得反向依赖 Vue、Nuxt、Nitro、文件驱动、Project 或 Agent。Source 与 Product 采用相同语义，允许不同能力来源。
2. 第一切片的受控装配和正式产品是不同入口，不允许同时管理同一产品资源。后续每条真实链切换时，所有调用方迁入新 owner，旧启动/关闭路径同时退出；不是长期保留两套 singleton。
3. 正式产品接入时保留现有迁移检查先于 Session Store 租约、租约失效/退出码、请求 drain 和权限策略。Session Store advisory lease 的详细合同仍归 [agent.session-store-lease](../../archived/specs/agent/session-store-lease.md)，不升级为全 State Root 强互斥。
4. State Root 完整性检查当前只读并告警，不因接入本合同自动变成拒绝启动或自动合并/删除数据。所有真实数据格式/迁移策略变化单独决策。
5. Nuxt/Nitro hook 只连接一个明确的应用装配入口。Component Lab 不成为该入口的底层依赖；后续 Lab 清单与产品清单分开，浏览器是否访问产品服务取决于明确装配，而不是路由名称的隐式豁免。
6. 第一切片交付 B/S 所需的浏览器与后端环境入口，另有受控测试宿主用于故障验证；Desktop/Worker 仅保留可适配边界，尚无该环境实测时不得宣称支持。
7. 产品启动链迁入内核的目标合同（`planned`）见 [`runtime.server-host`](server-host.md)、[`runtime.browser-host`](browser-host.md) 与 [`runtime.stall-watchdog`](stall-watchdog.md)。

## 验收与 Smoke

- **双宿主贯通**：同一机制分别由真实后端进程和真实浏览器环境适配器启动；使用受控内存能力登记一个提供者和消费者，观察启动、一次解析/调用、停止、旧句柄拒绝。浏览器模块不加载服务端驱动，后端不需要 DOM/Nuxt 页面。测试能力是验收输入，不是产品功能假实现。
- **门禁故障**：必需初始化失败时业务不接纳，紧急诊断可见；只失败一个可选入口时无关消费者仍可使用。多个并发请求观察同一启动结果。
- **启动与关闭竞态**：初始化未完成时停止，迟到完成没有重开接纳；已得到的资源释放一次。消费者关闭时仍能完成依赖清理；依赖关闭失败则不报整实例 closed。
- **真实宿主事件**：后端合作停止信号和浏览器显式销毁都走同一生命周期合同；移除适配器后重复事件不能调用旧实例。浏览器强制卸载只报告无法保证，不以测试中的异步回调成功假定真实卸载可靠。
- **隔离与伸缩**：两个浏览器实例、两个本地子作用域的提供者不串实例；一个窗口释放不发送共享后端全局关闭。更换受控装配的能力集合不修改机制实现。
- **子实例与租约**：状态表每个转换各一例（宽限期用注入时钟）；宽限期内新租约取消关闭；`stopping` 中的新租约得到新代次；父实例停止后新租约被拒、子实例先于父实例其余资源停止；强制结束记为外部终止；子实例代次不复用。
- 上述五组由 `bun run smoke:runtime-foundation -- --host server|browser` 在真实后端子进程与真实 Chromium 上运行，另由内核与两个适配器的合同测试在进程内覆盖竞态与拒绝分支。运行数据遵守 [测试与临时根合同](../../testing/README.md)；第一切片不初始化产品数据库、不调用 Provider，不以 Component Lab fixture 替代宿主验证。

## 实现合同

- **实现 owner 与入口**：
  - 内核（runtime）：`packages/nb-runtime/src/application/application.ts`（包入口 `@notnotype/nb-runtime/application`；`createApplication(host, manifest)`、`createChildInstances(parent, options)`、`createInstanceTable()`、`stopTimeout(ms)`、`export type *`）；`contracts.ts` 是类型合同，`bootstrap.ts` 是实现，`children.ts` 是子实例与租约，`instances.ts` 是宿主实例表。
  - 后端适配器（server）：`packages/neuro-book/src/server/host.ts`（`startServerHost({instanceId, manifest, emergency, onFatal, process?, signals?, stopInput?, beforeStop?}) → ServerHost {application, requestStop(source), stopSource, stopped, beforeStopError, detached}`），行为见 [`runtime.server-host`](server-host.md)。
  - 浏览器适配器（web）：`packages/neuro-book/src/web/host/browser-host.ts`（`BrowserRuntimeHost.start({instanceId, manifest, page, emergency}) → BrowserHost {application, destroy(), stopSource, detached}`；`page` 是结构化的页面事件目标，不依赖 DOM 类型与 Vue），窗口的启动与状态见 [`runtime.browser-host`](browser-host.md)。
- **依赖方向**：内核只允许同目录相对导入与 lifecycle / services / plugins 三个入口，源码不引用 `process.`/`window.`/`document.`，由内核包的合同测试守住；新应用的前端代码（含浏览器适配器）不引用后端代码与 Node、Bun 模块，由 `packages/neuro-book/src/architecture.test.ts` 守住。
- **公开接口**：
  - `HostContext {identity, stopSignal, stopDeadline?, emergency(report)}`：宿主只提供实例身份、停止来源、首次停止的截止与最小紧急输出。`stopDeadline` 是函数，内核在首次停止开始时调用一次取得截止信号；宿主需要有界停止时用 `stopTimeout(ms)` 构造，只接受 1..2^31-1 的整数毫秒（超出定时器范围的值会被运行时缩成立即触发），其余抛 TypeError。
  - `ApplicationManifest {keys, capabilities?, plugins, requiredPlugins?, gates, observers?, remote?, delegation?}`：`remote` 是本实例的远程节点、`delegation` 是代理允许清单，都原样交给插件宿主；静态受信清单；贡献接收者不在清单中，由定义贡献点的插件在激活时交出（见 [`runtime.plugins`](plugins.md) 输出第 16 条）。`requiredPlugins` 是启动必需的插件 id，登记后激活它们在本位置的全部入口；其它入口以 `activationEvents: ["onStartup"]` 声明启动激活。`CapabilityProvider` 是根作用域 owner 的本地服务提供者；`StartupGate` 三种：`activate {entry}`、`resolve {key}`、`check {dependencies?, check(ctx)}`（`ctx.services` 只能解析该门禁声明的键）；`required` 缺省 true；`observers` 把三个机制的诊断观察者在创建实例前接上。
  - `Application {identity, root, assembly, plugins, startup, stopped, closed, status(), admit(spec), stop(request?), recover(request?)}`：`startup` 共享；`admit` 等启动结果后经根作用域 `accept`，未开放时 `rejected`：启动失败报 `startup-failed`，启动前被宿主停止或已进入停止按根作用域阶段报 `stopping | closed`；`stop` 幂等，宿主截止与调用方截止同时约束首次停止；`recover` 另起一次关闭尝试（只用调用方截止，加入在途尝试时观察同一结果）；`stopped` 是首次停止的结算；`closed` 在首次停止或之后某次恢复结算为 closed 时兑现。停止与恢复只经这两个方法：`root` 用于观察与创建子作用域，直接关闭根作用域会绕过宿主截止与两个通知。
  - `createChildInstances<Handle>(parent, {create(key, generation), stop(handle, {signal}), graceMs, stopDeadlineMs, clock?}) → ChildInstances {acquire(key, holder), state(key), list(), holds(key, generation, holder), exited(key, generation), diagnostics()}`：`acquire` 返回 `acquired {lease: {key, generation, holder, revoked, release()}}` 或 `rejected {reason: admission-closed | create-failed, detail}`；`ChildStatus` 带 `abnormal: forced | exited | stop-failed | null`（`stop-failed` 是宿主停止回调抛错、不知道子实例是否已退出）。`parent` 必须是 `createApplication` 创建的实例。
  - `StartupResult = available | failed{stop} | stopped{stop}` 带 `gates: GateOutcome[]`（`passed | failed{reason,error} | skipped`）与 `failures: StartupFailure[]`（`category: manifest | activation | gate | stopped`，`stage: register | activate | gate`；activation 失败的 `source` 为 `插件/入口`，`reason` 为 `blocked:<受阻原因>`、`<失败阶段>/<原因>` 或 `rejected:<原因>`）；`StopResult = closed | incomplete{reason, report}`。
- **关键不变量**：
  - 清单登记只登记描述（能力提供者向 services 声明，插件向 plugins 登记），不实例化；插件登记顺序没有语义。登记后并发执行启动激活，全部结算后门禁按声明顺序执行；宿主停止后不再发起启动激活，余下门禁 `skipped`。
  - 启动激活期间宿主要求停止：结果为 `stopped`，因停止得到的 `cancelled`/`stopped` 激活结果不记为 activation 失败，迟到产出照常收口。
  - 插件登记被拒绝只记一条 `manifest` 失败（插件在 `requiredPlugins` 中或被必需 `activate` 门禁引用时 `required: true`），其入口不进入启动激活；`requiredPlugins` 中不在清单里的插件同样记 `manifest` 失败（`plugin:unknown-plugin`）。
  - 必需门禁失败 → 紧急输出 → `stop()` 收口已取得资源 → `failed`；不发布可用结果，`admit` 稳定 `startup-failed`。
  - 停止的结算不映射：`CloseIncomplete` 原样进入 `StopResult.incomplete`，并向紧急输出报告计数，每次关闭尝试只报告一次；能力释放失败时根因未关闭子作用域报 `blocked`。
  - 有界停止：宿主截止触发后首次停止结算为 `incomplete(deadline)`，根作用域保持停止中，挂起的释放继续运行、不被撤销也不重入；适配器随 `stopped` 结算移除监听，进程是否退出由宿主决定。
  - 适配器各自拥有自己的监听，每个实例挂接一次，等 `application.stopped` 结算后移除；`requestStop` / `destroy` / `pagehide` 只有第一次生效并记录来源；`pagehide` 不等待任何 Promise。
  - 停止阶段：首次 `stop()` 的同步段先触发内部的“停止已开始”信号（子实例据此关闭接纳；`status()` 报 `stopping`、`admission: closed`，`admit` 拒绝 `stopping`；启动中的激活与门禁等待立即取消），再跑完登记的停止阶段，最后才关闭根作用域。没有停止阶段时根作用域在同步段里开始关闭，时序与以前相同。停止阶段受首次停止的截止约束；子实例管理另在根作用域登记一项等仍在停止的子实例的资源，截止先到时首次停止结算为 `incomplete(deadline)`。
  - 子实例代次：同一键的代次单调递增、不复用；`stopping` 的代次不复活，新 `acquire` 等它 `terminated` 后创建新代次；宽限期内的 `acquire` 取消关闭计时。宿主报告的退出只对当前代次生效，过期代次的报告被忽略。
  - 实例身份：适配器用内核 `createInstanceTable` 持有实例。同一 instanceId 存活（含停止未完成）期间共享同一实例与监听；`application.closed` 兑现时立即退役该 id（包括恢复后才关闭的实例），再次启动抛 TypeError（重启须分配新身份），表不再持有已关闭实例。内核不维护进程级全局表。
- **合同测试**：内核的 `packages/nb-runtime/src/application/application.test.ts`（14 例）、`application-startup.test.ts`（启动激活的选择、失败分类与停止竞态，以及依赖链的启动顺序、关闭顺序与诊断）、`children.test.ts`（子实例状态表、父实例停止与 `{project}` 目标的租约核对，12 例，注入时钟），在 `packages/nb-runtime` 经 `bun run test` 与 `bun run typecheck` 运行；后端适配器由新应用的 `packages/neuro-book/src/server/server.test.ts` 以真实子进程覆盖；浏览器适配器由 `packages/neuro-book/src/web/host/browser-host.test.ts`（真实内核，EventTarget 充当页面）覆盖。
- **实际 smoke**：新应用的后端宿主 `bun run smoke:server`（打包产物上的真实子进程）；浏览器宿主 `bun run test:e2e` 的 `e2e/browser-host.e2e.ts`（本机 Chrome：两个窗口、关闭一个不影响另一个、引导失败不挂载）。新应用的宿主不设停止截止，有界停止（`stopTimeout`）只由内核合同测试覆盖。

## 证据

- 实现入口：[`application.ts`](../../../packages/nb-runtime/src/application/application.ts)
- 合同测试：[`application.test.ts`](../../../packages/nb-runtime/src/application/application.test.ts)、[`application-startup.test.ts`](../../../packages/nb-runtime/src/application/application-startup.test.ts)、[`children.test.ts`](../../../packages/nb-runtime/src/application/children.test.ts)
- Smoke：[`smoke-server.ts`](../../../packages/neuro-book/scripts/smoke-server.ts)（`bun run smoke:server`）、[`browser-host.e2e.ts`](../../../packages/neuro-book/e2e/browser-host.e2e.ts)（`bun run test:e2e`）。旧应用的双宿主 smoke 见 [w00017 t08](../../../.agents/works/w00017-application-runtime-architecture/tasks/t08-runtime-application/README.md)。
- 2026-09-20 开发者明确要求以“环境适配入口、小内核”为第一切片并落 Spec，再以内置服务插件验证。批准方向与非目标见 [总体提案决策记录](../../../packages/neuro-book-legacy/docs/proposals/application-runtime-and-plugins.md#决策记录与下一步)。
- 实现与验证：[w00017 t08](../../../.agents/works/w00017-application-runtime-architecture/tasks/t08-runtime-application/README.md)（内核、适配器、双宿主 smoke）、[t09 首片集成复核](../../../.agents/works/w00017-application-runtime-architecture/tasks/t09-foundation-integration-review/README.md)（对照本文逐条核对、公开面收紧并晋升）。
- 启动必需插件与 `onStartup` 启动激活：依据 [可扩展应用平台设计](../../proposals/extensible-application-platform.md) P11 与 [`runtime.plugin-manifest`](plugin-manifest.md) 第 7、8 条，实现与验证见 [w00017 t32](../../../.agents/works/w00017-application-runtime-architecture/tasks/t32-kernel-entry-dependencies/README.md)。
- 清单删除 `receivers`：接收者改由拥有者插件提供，见 [w00017 t33](../../../.agents/works/w00017-application-runtime-architecture/tasks/t33-owner-contribution-points/README.md)。
- 子实例、租约与远程节点：依据 [多实例运行时拓扑](../../proposals/multi-instance-runtime-topology.md) 第 2 节与 [ADR 0024](../../adr/0024-multi-instance-runtime-topology.md)（2026-10-07 `accepted`），实现与验证见 [w00017 t52](../../../.agents/works/w00017-application-runtime-architecture/tasks/t52-kernel-instances-remote/README.md)；真实子进程宿主、项目管理与服务端停止顺序的其余步骤（封闭新握手、排空）随后续 K3。
- 已知限制：本规范描述第一切片的受控装配入口；产品的进程级服务已迁为启动必需的内置插件（[t34](../../../.agents/works/w00017-application-runtime-architecture/tasks/t34-builtin-service-plugins/README.md)），生产进程由自有宿主入口经 `ServerRuntimeHost` 建立实例并处理信号与停止通道，开发模式与 CLI 共用同一启动函数（[t37](../../../.agents/works/w00017-application-runtime-architecture/tasks/t37-server-host-entry/README.md)，行为见 [`runtime.server-host`](server-host.md)）。POSIX 信号路径未在本机（Windows）实测：Windows 上外部进程无法合作发送信号，smoke 走 stdin `stop` 通道，适配器的信号翻译由合同测试的进程替身覆盖。显式关闭的 dirty/在途协商由调用方在调用 `stop()` 之前完成，第一切片没有 dirty 参与者，内核不提供否决接口。强制终止后的「未知」由外部观察者（持久化与领域 owner）判断，不属于实例自身可报告的结果。Desktop/Worker 无实测。
