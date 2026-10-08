---
schema: nbook.spec/v1
kind: behavior
status: implemented
capability: runtime.plugins
owners:
  - runtime
---

# 插件描述、激活与贡献

## 目标与非目标

目标是让每个内置插件入口具备稳定身份，使描述登记与执行业务分离，激活有唯一的合并语义，贡献在受控事务内发布与撤回，失败只收口本次而不影响他人，并明确普通关闭与热卸载的边界。

明确不承诺：

- 不提供第三方或不可信代码加载、市场、动态安装、签名、沙箱或跨版本兼容承诺。
- 本批不提供任意在线热卸载、代码热升级或物理卸载；只支持正常作用域销毁、部分激活失败收口与整个宿主重启。
- 不定义具体能力（命令、View/Editor、设置、Storage 状态、Agent 工具等）的贡献字段、校验规则与权限；由各能力 owner 的 Spec 拥有。
- 不定义服务依赖解析（[`runtime.services`](./services.md)）、资源所有权与关闭推进（[`runtime.lifecycle`](./lifecycle.md)）、应用清单与启动门禁（`runtime.application`）。

## 术语与参与者

- **插件定义**：随产品发布的模块描述，包含稳定 id、运行位置、入口、服务依赖与贡献声明；不是已激活实例。
- **插件描述**：插件包一级的身份 `{id, version, locations}`，写在插件目录的 `plugin.ts`；宿主按它装配各运行位置的入口、核对两端的插件集合。内核登记的是插件定义，不读插件描述；插件清单文件见 [`runtime.plugin-manifest`](./plugin-manifest.md)。
- **入口**：插件在某个运行位置的运行入口；每个入口分别装配与激活，拥有独立身份。
- **激活实例**：插件 id + 入口 + 所在运行实例的作用域 + 激活代次共同标识的一次激活；同一插件的浏览器入口与后端入口不是同一次激活。
- **贡献点**：由拥有者插件定义的扩展点，含 id、该点的贡献是否需要实现，以及可选的声明校验；id 在全部存活登记中唯一。
- **贡献**：向某个贡献点提交的声明（命令、View/Editor 描述、设置定义、工具描述等）；描述与执行实现分离。写在入口下的贡献由该入口激活时给出实现；写在插件顶层的贡献只有声明。
- **贡献接收者（receiver）**：拥有者入口激活时交出的某个贡献点的 `prepare`/`published`/`revoke` 回调，负责维护该点的目录并接受/撤回贡献；必须能区分“描述已登记、实现待激活、实现可用、激活失败、已撤回”五种结果。
- **交付**：内核把一条已可用的贡献交给同一位置上已接上的接收者，并为每个“贡献 × 贡献方代次 × 接收者连接”记一条账，撤回时逐条核销。
- **目录**：描述登记后形成的可查询集合；目录中存在描述不代表实现已激活，也不代表权限通过。静态描述独立于激活寿命：正常关闭只撤回可调用实现，描述保留并携带不可用原因（例如未激活或作用域已关闭）。
- **激活代次**：一次激活的身份；重新启用必须基于存活的新作用域并产生新代次，已关闭作用域不重新激活，旧代次与旧句柄一律失效。
- **受控贡献事务**：激活期间新增的 handler、订阅、注册先由本次激活拥有，全部必需步骤成功后才对外发布。
- **服务 id**：入口对外提供的服务键名，形如 `<插件 id>/<名称>`，归该插件所有；`<插件 id>/channel` 为保留名（原插件通道服务；2026-10-07 起插件通道由远程服务取代，名称继续保留，避免旧清单误用）。
- **受阻**：入口因必需依赖不可满足而不能激活的推导状态，不是失败，也不是用户设置。
- **按调用方提供项**：入口以 `providePerConsumer` 交出的提供项，服务装配为每个调用方生成门面（[`runtime.services`](./services.md) 输出第 12 条）。
- **代理入口**：声明了 `remoteDelegates`（可代表调用方调用的远程合同，用于 `remote.on`）的入口；只对装配方允许清单里的内置插件生效。
- **激活事件前缀**：插件以 `activationEventPrefixes` 声明自己拥有的前缀，只有拥有者能请内核触发 `<前缀>:<参数>`；内核自己保留前缀 `onRemote`。
- **远程提供项**：入口以 `remoteProvides` 静态声明（代码定义里写合同对象）、激活时以 `provideRemote` 交出的远程服务实现（[远程服务与 RPC 协议](./plugin-channel.md)）。

## 输入与前置条件

- 静态受信清单先完成描述校验：插件身份、入口身份、运行位置、服务依赖与贡献点结构；重复 id 不静默覆盖。入口提供的服务 id 必须以本插件 id 加 `/` 开头、名称非空、不占用保留名 `channel`，在同一插件同一运行位置的入口之间不重复（服务属于实例：不同位置的入口可以提供同一个 id，各自在本位置的实例里提供）；贡献点 id 非空、在本插件内不重复且未被另一个存活登记的插件定义；`receives` 只引用本插件定义的贡献点，同一插件中同一位置的两个入口不接收同一个点；贡献点 id 与贡献 id 非空。任一不满足则整个插件不登记。
- 贡献随插件描述登记，按单条校验（输出第 15 条），不要求拥有者已激活；恢复布局前必须能查询 View/Editor 等描述，此时执行实现可以尚未激活。
- 激活可由命令调用、View 打开、服务首次取用或明确启动要求触发；触发不表示授权，描述存在不代表 handler 可用。
- 激活执行前必须已有该入口的作用域与依赖解析结果（由 [`runtime.services`](./services.md) 提供）；每个入口独立声明运行位置。
- 代码定义的入口可以经 `defineEntry` 定义，在编译期核对激活产出与静态声明一致：`services` 按 `provides` 的顺序一一对应、服务类型相符，`remote` 按 `remoteProvides` 的顺序一一对应、合同形状相符，`receivers` 恰好是 `receives` 列出的点，`contributions` 恰好是本入口声明的贡献，没有声明的一类不能出现。编译期分不出服务类型相同而 id 不同的两个服务键（合同同理），声明来自宽类型的列表时也只核对到类型能表达的程度；这些由输出阶段的核对（第 16、22 条与“实现合同”）报出。运行期它原样返回入口，输出阶段的核对照常进行；不经它定义的入口（测试里的临时插件、以后由清单生成的定义）只有运行期核对。按运行位置分支的入口在整个产出上分支，编译期只核对产出符合其中一种声明，位置与产出的对应由输出阶段核对；辅助函数返回提供项时写出带合同或服务类型的类型。
- 提供服务的插件在描述登记阶段即声明其提供项（服务键、位置、作用域），使解析在提供者尚未激活时也能查询声明并按需触发激活：该提供项的实例化与可调用实现归属相应入口的激活。激活只等待该入口声明的对外依赖边，不等待自己对外声明的提供项；解析一个提供者尚未激活的服务时会触发（或加入）该入口的激活并等待结果，该等待边进入 [`runtime.services`](./services.md) 的依赖检查。

## 输出与可观察行为

外部消费者（不读取内部私有字段）可以观察到以下行为：

1. **描述先登记**：未激活状态下可查询插件描述与贡献目录（id、位置、依赖、贡献类型、对外提供的服务键）；登记不创建运行资源、不调用业务副作用、不要求服务激活；服务提供项的实例化与可调用实现仍归激活。
2. **入口独立**：同一插件在不同位置的入口分别装配、分别激活、分别失败；同一位置的两个入口也不隐式共享激活状态。
3. **激活合并**：同一激活实例的并发触发合并为一次激活；成功后同代次后续触发复用。单个触发方/等待方取消只结束自身等待，不取消共享激活、不撤其它等待者所需暂存项；共享激活仅由入口owner停止/取消或激活自身失败收口，与服务初始化规则一致。
4. **执行不合并**：消费方的每次调用是独立操作，与激活去重无关；两个消费者同时执行同一能力得到两次独立执行，而不是因共享激活只执行一次。
5. **受控发布**：激活期间新增的 handler、订阅与注册先由本次激活拥有；所有已接上接收者准备成功前，它们均不可被业务调用。全部成功才开放本激活的可调用能力；任一准备失败必须保持调用门禁关闭，并撤回本次全部暂存项，不能留下某个接收者已经可调用的半成品。不要求目录查询跨接收者取得原子快照，也不要求跨位置网络事务。对外副作用（文件写入、Provider 调用、数据库提交）不属于注册事务，已发生即不回滚。
6. **接收者五态**：接收者能区分并报告描述已登记、实现待激活、实现可用、激活失败、已撤回；不得用空 handler 或成功占位应付恢复流程。正常关闭后已发布 handler 不可调用，静态描述仍可查询并携带不可用原因。
7. **失败隔离**：激活失败保留描述与失败原因、撤回本次未完成能力；不删除其他插件的贡献；依赖它的能力明确失败；无关可选能力继续；启动必需能力失败时宿主不得进入业务接纳（门禁归 `runtime.application`）。
8. **跨位置非原子**：每个位置独立激活并各自报告结果；不对外声称一次原子激活覆盖所有位置，一处失败不阻止另一处已经可用的入口。
9. **普通关闭**：关闭 View、切换 Project 或终止应用时释放该实例的资源并停止新调用；关闭撤回本次已发布的可调用实现（handler、订阅），但不删除静态描述：描述保留在目录中并携带不可用原因。重复关闭不重复副作用。这不是热卸载：不承诺卸载代码模块、不承诺在线停用同一运行实例中的必需插件或替换实现；基础必需插件不随一个 View 退出。
10. **迟到阻断与再激活边界**：激活被取消或作用域关闭后，迟到的成功不发布 handler、View 或可用句柄；已关闭作用域不接受任何再次激活触发，不复活；重新启用必须基于存活的新作用域并产生新代次，旧代次与旧句柄失效。
11. **受阻按入口推导**：只看必需依赖。依次检查入口的必需依赖，报告第一个不满足的原因、服务 id 与依赖路径（`插件/入口` 序列）：本位置没有提供方而其它位置有为 `location-mismatch`，都没有为 `missing-service`；提供方受阻为 `provider-blocked`，提供方激活失败且未恢复为 `provider-failed`；处于依赖环上为 `dependency-cycle`（路径为环），依赖环成员的入口为 `provider-blocked`。同一位置的非插件提供者（装配方的本地能力）也满足依赖。推导只依赖当前存活登记与各入口状态，与登记顺序无关，查询不产生诊断；提供方登记或恢复后依赖方自动解除受阻。受阻入口不激活，经服务解析也不触发；同一插件中不依赖它的入口不受牵连。
12. **插件汇总与目录顺序**：目录按插件 id 的码元顺序列出，插件内入口保持定义顺序。每个插件给出本位置入口的汇总：没有受阻或失败的入口为 `available`，部分为 `partial`，全部为 `blocked`；本位置没有入口为 `available`。
13. **关闭严格按依赖逆序**：依赖者撤回贡献、释放激活产出与它登记的全部资源之后，才结束对所依赖服务的借用；提供者的服务实例在全部依赖者完成上述释放之后才释放；提供者自己的贡献、激活产出与资源在它提供的服务实例释放之后才释放。同一入口内贡献先于激活产出撤回。无依赖关系的入口可以并发关闭。
14. **激活与关闭诊断**：每次激活尝试开始记 `activation-started`，发布记 `published`；代次开始停止记 `close-started`，入口自己的资源与它提供的服务实例全部释放后记 `closed`。对依赖链 A→B→C，`published` 依次为 C、B、A，`closed` 依次为 A、B、C。受阻拒绝记 `blocked`。
15. **按单条贡献校验**：每条贡献（入口下与顶层）有校验结果，按当前存活登记推导，与登记顺序无关，查询不产生诊断。没有存活登记的插件定义该贡献点为 `pending`/`unknown-point`，定义它的插件登记后按其规则重新判定。拒绝为 `rejected` 并带原因：`invalid-declaration`（拥有者的校验返回原因或抛错，详情可查询）、`implementation-required`（点要求实现而贡献写在顶层）、`implementation-not-accepted`（点不接受实现而贡献写在入口下）、`duplicate-contribution`（同一贡献点内同一 id 出现多于一次，不区分运行位置，全部重复者都拒绝）。其余为 `accepted`。只有被拒绝的那一条不生效：入口激活时 `accepted` 与 `pending` 的入口贡献必须给出实现，`rejected` 的不要求实现，给了也不发布。
16. **接收者接上与补交**：拥有者入口激活时，激活产出的 `receivers` 必须与入口的 `receives` 完全一致。产出核对通过后、发布之前接上这些接收者，随后补交该点已可用的贡献：入口贡献按贡献方代次整批补交（同一批跨接收者先全部 `prepare`，全部成功才算交付），顶层声明逐条补交。补交在拥有者的 `activate()` 返回前完成。某一批补交失败只把这一批标为交付失败（可查询、记诊断），已准备的项按逆序以 `delivery-failed` 撤回，贡献方与拥有者的激活结果都不受影响。顶层声明交给接收者的句柄 `kind` 为 `plugin`，`implementation()` 抛 `PluginStateError`。
17. **交付与撤回**：贡献方激活时，已接上接收者的贡献按受控事务（第 5 条）交付，失败则贡献方激活失败；接收者未接上的贡献照常发布，交付状态为等待接收者。贡献方关闭时，已交付项逆序以 `scope-closed` 撤回。拥有者关闭时，接收者断开前把已交付给它的项逐一以 `receiver-closed` 撤回，这些贡献回到等待接收者，贡献方不受影响；断开先于拥有者自己的激活产出释放，撤回回调仍能使用拥有者的实现。拥有者恢复并重新激活后按第 16 条重新补交。两边同时关闭时每条交付恰好撤回一次；同一接收者上的补交、事务交付、发布通知（`published`）与撤回串行执行，不交错。
18. **贡献不构成依赖**：只经贡献点协作的两个插件之间没有依赖边；拥有者受阻、激活失败或缺席不使贡献方受阻或失败，贡献等待接收者。
19. **按调用方提供项**：入口在 `provides` 中声明的键，激活产出可以用 `provide`（共享实例）或 `providePerConsumer`（按调用方门面）交出，交付规则与第 13 条的关闭顺序不变；激活上下文的必需依赖与可选依赖解析属于同一次激活，得到同一门面，门面随这次激活的作用域释放。
20. **委托**：代理入口在处理调用方请求时以 `context.remote.on(调用方身份).use(合同)` 发出调用与订阅，目标看到的调用方是原调用方、另附代理身份：合同必须在入口的 `remoteDelegates` 里，插件必须在允许清单内，身份必须是签发给本入口门面、且签发它的门面还没释放的（[`runtime.services`](./services.md) 输出第 13 条），不满足时为 `denied`；寿命挂在签发记录下，见 [远程服务与 RPC 协议](./plugin-channel.md) 输出第 10 条。目标在同一实例时同样经远程服务的本地路径到达；没有以调用方身份取本地服务门面的接口。
21. **拥有者定义的激活事件**：入口的 `activationEvents` 可以写 `onStartup` 或 `<前缀>:<参数>`。前缀的拥有者调用 `triggerActivationEvent(事件, {requester})`，内核激活本位置声明了该事件的全部入口并逐个返回激活结果，复用第 3 条的激活合并；非拥有者触发被拒。没有插件拥有的前缀：该事件被忽略并记诊断，插件其它部分照常；两个插件声明同一前缀时两者的声明都不生效并记诊断，与登记顺序无关。前缀 `onRemote` 归内核，插件不能声明。
22. **远程提供项**：入口的 `remoteProvides` 列出合同（代码定义里写合同对象，内核按合同 id 核对）；激活产出的 `remote` 必须与之完全一致，缺少为 `missing-remote`、多出为 `undeclared-remote`，产出的合同与声明的不是同一个合同对象（例如同 id 不同版本）为 `remote-contract-mismatch`，都是输出阶段失败：提供方查询按声明回答版本与调用方种类，调用按产出的合同核对，两者必须一致。合同的提供方位置与本实例的拓扑角色不符（例如 `provider: "server"` 的合同出现在项目实例的入口里）同样是输出阶段失败 `remote-location-mismatch`；角色取自本实例远程节点的实例描述（`hub` 对应 `server`、`project` 对应 `project`、`client` 对应 `client`，`provider: "any"` 任何角色都可提供），没有远程节点的实例不做这项核对。远程调用到达时声明了该合同的入口未激活，内核按 `onRemote:<合同 id>` 激活它。远程提供项随入口停止撤回：门面作废、经它建立的订阅取消（[远程服务与 RPC 协议](./plugin-channel.md)）。
23. **查询已接受的声明**：入口的激活上下文可以按贡献点与贡献 id 查询此刻已接受的贡献声明（插件、入口、运行位置与声明），也可以列出一个贡献点的全部已接受声明；与第 15 条一样按存活登记推导、不缓存、不产生诊断。贡献点的校验函数只看这一条声明本身、查不到别的贡献：一条声明是否被接受只取决于它自己的校验与同一 id 是否重复，不随别的贡献点上的登记与撤销变化。
24. **接收者的三个回调**：`prepare(handle)` 预占或否决，抛错即本次交付失败（事务交付时贡献方激活失败，补交时这一批交付失败）；`published(handle, prepared)` 在贡献方的激活事务发布之后、或补交完成且贡献方已发布之后，每条已交付项调用一次，此后这一项的 `implementation()` 可用，接收者在这里让它生效（例如进入命令表）；`revoke(handle, prepared, reason)` 撤回，必须幂等。`prepare` 期间 `implementation()` 不可用；贡献方激活最终失败或停止时，已准备的项只收到 `revoke`、收不到 `published`。撤回之后不再调用 `published`；`published` 抛错只记 `publish` 阶段诊断 `receiver-published-threw`，不改变交付与激活结果。

## 状态与转换

以“插件 id + 入口 + 作用域 + 激活代次”为单位的激活：

| 状态 | 事件 | 下一状态 | 结果 |
| --- | --- | --- | --- |
| 已登记未激活 | 必需依赖不可满足（见输出第 11 条） | 受阻 | 推导结果，不消耗代次、不调用入口 |
| 受阻 | 提供方登记或恢复，依赖重新可满足 | 已登记未激活 | 推导结果；不自动激活，按触发再激活 |
| 受阻 | 触发激活或服务解析 | 拒绝（保持受阻） | 报告受阻原因与路径并记诊断 |
| 已登记未激活 | 触发激活 | 激活中 | 并发触发合并到同一次激活 |
| 激活中 | 全部必需步骤成功、事务提交 | 可用 | 贡献发布一次；同代次后续触发复用 |
| 激活中 | 任一步失败 | 失败 | 撤回本次暂存能力并开始资源收口；描述与失败原因保留，收口结果单独可查询；不自动重试 |
| 激活中 | 入口owner取消或作用域关闭 | 停止中 | 迟到成功不发布，按生命周期门禁收口到已关闭；单个等待方取消不触发此转换 |
| 可用 | 作用域关闭或获准停止 | 停止中 | 停止新调用，已接纳消费者仍可完成清理；撤回本次可调用实现并收口资源，静态描述保留；不自动销毁共享服务 |
| 停止中 | 生命周期关闭门禁满足 | 已关闭 | 全部受管操作/获取与资源收口成功；失败或超时仍停止中，报告关闭未完成 |
| 失败 | 上次失败资源收口完成后显式恢复 | 激活中 | 允许重新激活（新代次）；不与在途 cleanup 并发；不因 UI render 自动重试 |
| 失败 | 所属作用域关闭 | 停止中 | 保留失败原因，继续或确认本次资源收口；关闭门禁满足才已关闭，不重新初始化 |
| 已关闭 | 对该作用域或其旧代次再次触发激活 | 拒绝（保持已关闭） | 已关闭作用域永不重新激活、不复活；重新启用必须基于存活的新作用域与新代次 |

描述与目录：

| 状态 | 事件 | 结果 |
| --- | --- | --- |
| 未登记 | 通过校验 | 描述进入目录并可查询 |
| 未登记 | 结构校验失败或重复插件 id | 拒绝登记且报错可见；不静默覆盖 |
| 已登记 | 单条贡献不合格或贡献点无人定义 | 只有该条为 `rejected` 或 `pending`，插件其它部分照常 |
| 已登记（实现待激活） | 激活成功 | 实现可用；可调用能力发布一次，目录标记实现可用 |
| 已登记（实现待激活） | 激活失败 | 描述保留、实现标记激活失败且可诊断 |
| 已登记（实现可用） | 正常关闭/停止 | 撤回已发布的可调用实现；静态描述保留并标记不可用原因 |
| 已登记（实现待激活或可用） | 撤回事务内未发布的贡献项 | 目录移除本次未发布项；描述保留 |

交付（同一位置上一条可用贡献对某个接收者）：

| 状态 | 事件 | 下一状态 | 结果 |
| --- | --- | --- | --- |
| 等待接收者 | 拥有者接上接收者（补交）或贡献方在接收者已接上时激活（事务交付） | 已交付 | 接收者 `prepare`；贡献方发布后（补交时贡献方已发布即随即）`published` |
| 等待接收者 | 补交批次失败 | 交付失败 | 已准备项逆序以 `delivery-failed` 撤回；两侧激活结果不变 |
| 已交付 | 拥有者关闭 | 等待接收者 | 断开前以 `receiver-closed` 撤回 |
| 已交付 | 贡献方关闭 | 已撤回 | 以 `scope-closed` 撤回 |

并发语义：激活合并只作用于激活事务；贡献撤回只作用于本次激活拥有的声明；关闭与激活并发时以关闭为准，迟到成功不得改变已结算结果。

## 副作用与数据

- 激活创建的资源（连接、订阅、View 实例、命令 handler）归激活实例的作用域，由 [`runtime.lifecycle`](./lifecycle.md) 收口。
- 激活失败撤回本次全部暂存贡献；正常关闭撤回本次已发布实现，但不删除静态描述和其它激活的贡献。领域副作用按领域恢复合同处理，不能用注册撤回来声称回滚。
- 插件实例寿命结束不删除持久记录：文件、数据库、日志、Project 数据等由各领域/数据合同拥有；定义、目录与持久记录独立于激活实例。
- 目录与激活状态是运行实例内状态，不写用户数据格式，不新增发布包或第三方 SDK。

## 失败与恢复

- **局部失败收口**：只撤回本次未完成的注册与资源；不删除其他插件的贡献，不把无关能力判为失效。
- **受阻不是失败**：受阻不重试、不告警升级，也不进入失败恢复流程；依赖恢复后自动解除。运行期依赖变化时停止已激活的依赖者属于 [`runtime.plugin-hot-plug`](./plugin-hot-plug.md)，本能力不做。
- **失败可见**：失败归属到具体插件 id + 入口 + 阶段，原因可查询且脱敏（不含凭据或 secret）。
- **迟到成功**：取消/关闭后的成功结果不发布、不复活旧代次；资源仍由 owner 收口。
- **重试**：不因下一次 UI 渲染自动无限重试；恢复需要显式策略。重试前上次失败的资源必须已收口完成，且不得与仍在 pending 的 cleanup 并发重入。跨位置失败逐处报告，客户端失联不据此宣布服务端已完成停用。
- **强制终止**：进程崩溃或强制退出不保证撤回回调执行；下次启动按清单与领域合同恢复，不假设上一次贡献已清除。
- **回滚边界**：本地注册事务可撤回，外部副作用不可撤回。跨接收者准备失败不得开放任何本次可调用实现，全部暂存项由本次owner收口；不要求目录查询一致快照或跨位置原子事务。
- **补交失败**：拥有者接上时某一批补交失败，只标记这一批并记诊断，不使拥有者或贡献方激活失败，也不自动重试；贡献方或拥有者下一个代次会重新交付。

## 边界与兼容

- **owner 与依赖方向**：owner 为 runtime；依赖 [`runtime.services`](./services.md) 与 [`runtime.lifecycle`](./lifecycle.md)；不得 import 产品领域实现、框架 hook 或数据库驱动。能力适配通过各自 Spec 的贡献合同接入，本能力不内置命令、Storage、Config、View 的领域语义。
- **资源与数据 owner**：基础设施插件提供机制，不自动成为物理资源的 owner；只有有 owner 的资源才登记，例如文件句柄与数据库连接。SQLite 提供连接、事务与迁移执行机制，而具体数据库物理资源的 owner 是相应资源作用域——Project 数据库属于该 Project 代次——不是进程级插件 id。
- **权限与安全**：仅装配受信内置代码；不接收网络请求任意登记提供者；描述、目录与可调用性都不构成授权；不提供恶意代码沙箱。
- **跨实例**：不做网络原子激活、不传对象引用、不自动重试写操作；跨实例调用经 [远程服务与 RPC 协议](./plugin-channel.md)，不构成依赖边。
- **兼容与迁移**：允许 clean cutover（迁移全部调用方并删除旧入口）；本批不提供热卸载、不承诺第三方 SDK 兼容、不新增发布包、不改变数据格式或迁移策略。首批验收只要求底座与最小内置服务插件集合（diagnostics、platform-files、sqlite）真实可用，不要求全部业务插件迁移。
- **相邻合同**：服务声明与解析（含提供声明到激活的协作、对外依赖边与运行时等待环）见 [`runtime.services`](./services.md)；资源所有权与关闭见 [`runtime.lifecycle`](./lifecycle.md)；应用清单、启动门禁与跨位置装配见 `runtime.application`。
- **按拓扑角色匹配入口（设计，未实现）**：入口现在按运行位置字符串精确匹配实例。以后加 TUI 这类新客户端时，与界面无关的客户端代码（例如 `nbook.storage`、`nbook.commands`、`nbook.state` 的浏览器入口）应能不改代码就在新客户端里激活。设计：入口可以写 `role: "client"`（与 `location` 二选一），匹配拓扑角色为 `client` 的全部实例，插件宿主从实例描述取角色；这类入口的代码放在与浏览器无关的目录，依赖的宿主能力用中立的名字（例如以 `nbook/client-project` 取代 `nbook/window-project`），由每种客户端宿主提供。随 TUI 实现；它只新增可选字段，现有写法不变。
- **已知限制**：命令、View、设置等贡献点的领域字段与校验由各能力 Spec 在首次消费时补齐。声明层在运行期的出现与消失归 [`runtime.plugin-hot-plug`](./plugin-hot-plug.md)：拥有者已接上之后才登记的插件，其顶层声明要等下次接上才补交；之后登记的重复贡献使已交付的那条变为 `rejected`，但不撤回已有交付。
- **已批准的后续目标**（`planned`，实现后本文随之修订非目标）：插件清单见 [`runtime.plugin-manifest`](./plugin-manifest.md)，其中按入口的服务依赖、受阻推导、汇总状态、启停顺序（输出第 11–14 条），以及贡献点由拥有者定义、按单条贡献校验与交付（输出第 15–18 条），已对代码定义的插件实现；清单文件、版本范围与插件通道仍为 `planned`；运行期启用、禁用与引用撤回见 [`runtime.plugin-hot-plug`](./plugin-hot-plug.md)；第三方安装与热升级见 [`runtime.plugin-install`](./plugin-install.md)；代码装载与回收见 [`runtime.plugin-code-loading`](./plugin-code-loading.md)。

## 验收与 Smoke

以下场景在隔离运行实例中以目录查询、激活结果与贡献可见性等外部可观察结果判定。

1. **描述先于实现**：实现未激活时查询目录可列出 View/命令/设置描述与服务提供声明；查询过程不创建资源、不触发业务副作用；解析尚未激活提供者的服务触发一次激活（不重复），激活中的入口不等待自身提供项、只等待对外依赖边。
2. **激活一次、执行两次**：两个消费者经不同协议入口并发首次触发同一入口；激活只发生一次、贡献只发布一次，两次调用各自独立执行一次。
   单个等待方在共享激活期间取消时，只撤销该次业务调用的等待/后续执行；其它等待方正常取得能力并独立执行，入口激活仍只发生一次。
3. **入口独立**：同一插件在两个位置的入口分别激活；一处失败、另一处成功，结果分别报告，不共享激活状态。
4. **失败不撤他人**：插件 A 激活中途失败时，插件 B 已发布的贡献仍在且能力继续可用；A 的描述保留、原因可查询。
5. **迟到发布阻断与再激活边界**：激活等待期间作用域关闭；迟到的成功不发布 handler/View/句柄，已登记资源被收口；对该已关闭作用域或其旧代次再次触发激活被拒绝，已关闭实例不复活；重新启用基于存活的新作用域与新代次。
6. **接收者五态**：以描述已登记、实现待激活、实现可用、激活失败、已撤回五种结果驱动恢复流程；五种结果可区分且不产生空 handler；正常关闭后静态描述仍可查询并携带不可用原因。
7. **普通关闭闭环**：关闭 View、切换 Project、终止应用时释放实例资源、停止新调用并撤回已发布的可调用实现；静态描述仍在目录中且带不可用原因；重复关闭不重复副作用；基础必需插件不因一个 View 退出而停止；关闭不产生“代码模块已卸载”或在线替换的报告。
8. **跨位置非网络原子**：浏览器入口与后端入口在同一清单下独立激活；一处失败不阻止另一处可用，也不产生“全网一次原子激活”的报告。
9. **两种作用域 × 两个 host 复用**：同一描述登记与激活机制在实例级与操作级两种作用域、浏览器与后端两个 host 上复用；机制实现不含产品领域 import，一个 host 的失败不影响另一个 host 已可用的能力。
10. **重试前置收口**：激活失败后资源收口完成前不允许重试；收口完成后按显式策略重试产生新代次并成功，且不与在途 cleanup 并发。
11. **多接收者事务**：一次激活向多个接收者提交贡献，在第二个接收者的准备处注入失败；通过第一个接收者尝试调用也必须失败，全部本次暂存项撤回，其它插件仍可调用。成功路径只有全部接收者完成后才可调用；不要求网络原子性。

12. **按入口受阻**：缺服务、位置不匹配、提供方受阻、提供方失败与依赖环各自给出原因与路径；同一插件不依赖它的入口照常激活，汇总为 `partial`；受阻入口的 `activate()` 与服务解析都不调用入口、不消耗代次；提供方恢复后依赖方可激活。
13. **登记顺序无关**：同一组插件按不同顺序登记，目录、受阻结果与汇总相同；先登记的依赖方在提供方登记后不再受阻。
14. **服务 id 归属**：服务 id 不带本插件前缀、名称为 `channel`、在同一插件同一运行位置的入口之间重复，各自使整个插件不登记，且不向 services 留下部分声明；同一份定义在两个位置的入口提供同一 id 时照常登记，每个实例只解析到本位置入口的实例，另一侧入口是 `foreign-location`。
15. **关闭顺序**：A→B→C 依赖链在应用停止后满足输出第 13 条的全部先后关系，`published` 与 `closed` 诊断顺序符合输出第 14 条。
16. **单条校验**：拥有者已登记时，一条 `invalid-declaration` 只拒绝该条，原因与详情可查询，同一插件其它贡献与入口照常激活；顶层贡献投向需要实现的点为 `implementation-required`，入口贡献投向不接受实现的点为 `implementation-not-accepted`；两个插件向同一点提交同一 id 时两条都 `duplicate-contribution`，与登记顺序无关；`rejected` 的入口贡献不要求实现，`accepted` 与 `pending` 缺实现仍是 `missing-implementation`。
17. **拥有者缺席与登记顺序**：贡献点无人定义时贡献为 `pending`/`unknown-point`；定义它的插件随后登记，合格的变为 `accepted`、不合格的变为 `rejected`；三种登记顺序得到相同目录。
18. **补交**：贡献方先激活时贡献等待接收者；拥有者激活后补交，`activate()` 返回时接收者已收到 `published`；跨两个接收者按贡献方代次整批补交，一批失败只标记该批，拥有者与其它批不受影响；顶层声明逐条补交，句柄的 `implementation()` 抛 `PluginStateError`。
19. **断开与撤回**：拥有者单独关闭时已交付项收到 `receiver-closed` 撤回，断开先于拥有者产出释放，贡献回到等待接收者，贡献方仍可用；拥有者在新作用域重新登记并激活后重新补交，旧句柄不复活。贡献方关闭时已交付项各撤回一次；两边同时关闭时每条交付恰好撤回一次。
20. **回调串行**：两个贡献方并发激活与一次挂起的补交交错时，同一接收者观察到的回调不交错；一个贡献方发布时另一个贡献方在同一接收者上的 `prepare` 还没结束，`published` 等它结束后才调用。
21. **结构拒绝**：`receives` 引用未定义的点、同位置两个入口接收同一个点、贡献点 id 在本插件内重复或被另一插件定义，各自使整个插件不登记；激活产出缺少声明的接收者为 `missing-receiver`、给出未声明的接收者为 `undeclared-receiver`，都是输出阶段失败。
22. **贡献不构成依赖**：拥有者入口受阻或激活失败时，贡献方照常激活，贡献等待接收者。
23. **按调用方提供项与签发身份**：见 [`runtime.services`](./services.md) 场景 10、11，插件侧另验证必需与可选依赖共用同一门面、`providePerConsumer` 交出的实例只交付一次；经代理的调用见 [远程服务与 RPC 协议](./plugin-channel.md) 场景 19。
24. **激活事件前缀**：拥有者触发前缀事件激活声明它的入口并得到结果；非拥有者触发被拒；无人拥有的前缀被忽略并记诊断；两个插件声明同一前缀时两者都不生效；插件声明 `onRemote` 前缀被拒。
25. **远程提供项**：`remote` 与 `remoteProvides` 不一致分别为 `missing-remote`、`undeclared-remote`，同 id 不同合同对象为 `remote-contract-mismatch`；合同的提供方位置与实例角色不符为 `remote-location-mismatch`；首次远程调用按 `onRemote:<合同 id>` 激活懒入口；入口停止后它的远程门面作废、订阅取消。
26. **声明查询**：激活上下文只列出已接受的声明，被拒与待定的不列；一条声明的接受与否不随别的贡献点上的登记与撤销变化；查询不记诊断。
27. **失败的激活不发布**：贡献方激活在接收者 `prepare` 之后失败（另一个接收者 `prepare` 抛错，或贡献方停止）时，已准备的接收者只收到 `revoke`、收不到 `published`；成功时 `published` 在贡献方发布之后才到；补交给已发布的贡献方时，这一批全部 `prepare` 成功之后随即 `published`，其中一项 `prepare` 失败则整批逆序撤回、都收不到 `published`，两侧激活结果不变。
28. **编译期核对**：经 `defineEntry` 定义的入口，`services` 漏写、多写或类型不符，`remote` 漏写、多写或合同形状不符，`receivers` 漏写或多写，`contributions` 漏写或多写（含多写的贡献点），各自是类型错误；字面量产出不需要 `as const`，异步激活、在整个产出上按运行位置分支同样核对。运行期 `defineEntry` 原样返回入口；服务类型相同而 id 不同的服务键编译期不报，激活时为 `undeclared-service`。

Smoke 以目录查询、激活结果与贡献可见性为准。场景 1–11 与 16–22 由下节合同测试逐条覆盖，其中场景 11 的接收者由拥有者插件提供；场景 12–15 由合同测试覆盖，在产品内置服务迁成插件后由 `smoke:product-lifecycle` 的 L2 与 L3、L4 读取同一组诊断在真实进程上核对；场景 8、9 的真实浏览器半边由 `smoke:runtime-foundation` 在真实 Chromium 上运行同一份受控清单验证（启动必需的 `command-owner` 插件定义 `commands` 贡献点并交出接收者，greeter 插件在两个窗口各自激活并向它贡献一条命令，可选 flaky 插件在浏览器与后端分别失败且不影响 greeter）。

## 实现合同

- **实现 owner 与入口**：runtime；唯一公开入口 `packages/nb-runtime/src/plugins/plugins.ts`（包入口 `@notnotype/nb-runtime/plugins`；`createPluginHost(instance, assembly, {observer?, delegation?, remote?})`、`defineEntry(entry)`、`provide(key, instance, release?)`、`providePerConsumer(key, (consumer) => facade, {release?})`、`PluginStateError`、`KERNEL_ACTIVATION_PREFIXES`、`export type *`）。`contracts.ts` 是类型合同，`registration.ts`（登记纯结构校验）与 `host.ts`（目录、单条校验推导、激活事务、交付账本、恢复）是实现。
- **依赖方向**：只允许同目录相对导入与 `../lifecycle/lifecycle`、`../services/services`；`../remote/remote` 只允许类型导入：远程节点在运行期调用插件宿主交给它的 `RemoteHostBinding`，插件机制反过来只引用远程模块的类型，两者不形成运行期环。合同测试用源码守卫锁定（区分类型导入与值导入）。不内置命令/View/设置的领域语义：贡献点、校验与接收者由拥有者插件提供。
- **定义与查询**：`PluginDefinition` 有 `contributionPoints?: ContributionPointDefinition[]`（`{id, implementation: "required" | "none", validate?(descriptor)}`）与只有声明的顶层 `contributions?`；入口有 `receives?`，激活产出有 `receivers?`（贡献点 id → `ContributionReceiver`，含可选的 `prepare`、`published`、`revoke`）。`contribution(point, id)` 返回该身份的全部声明（按插件、入口、种类稳定排序），未登记为空数组；`ContributionState` 在五态之上带 `validation` 与 `delivery`（`waiting-receiver`、`delivered` 及接收者入口与代次、`delivery-failed` 及错误摘要）；目录的插件描述列出 `contributionPoints` 与顶层贡献，入口描述列出 `receives`。
- **关键不变量**：
  - 登记整体判定：任一入口/服务键/服务 id/贡献点结构校验失败（含 `foreign-service-id`、`reserved-service-name`、`duplicate-service`、`duplicate-contribution-point`、`unknown-contribution-point`、`duplicate-receiver`、空 id），整个定义不登记且不向 services 留下部分声明。单条贡献的问题不在登记时拒绝，由宿主在查询与激活时按存活登记推导，不缓存。登记不调用 `activate`、不创建资源。
  - 交付账本：接收者连接是拥有者 `entry-work` 上的 `contribution-receiver` 资源，`dependsOn` 激活产出，因此断开先于产出释放；已交给 services 的提供项实例释放前也先等待断开。连接在补交前登记，使并发激活中的贡献方在下一轮交付时看到它。每个连接有串行锁，补交、事务交付、发布通知与撤回都在锁内执行，跨多个连接时按连接 id 排序加锁。每条交付记录在调用 `revoke` 前置撤回标志，只撤回 `prepare` 成功的项。顶层声明的撤回资源登记在插件的登记作用域上。`RevokeReason` 为 `activation-failed | activation-stopped | scope-closed | receiver-closed | delivery-failed`。
  - 受阻推导在 `blocked.ts` 中是纯函数：输入存活登记的入口快照与同一装配中非插件提供者的服务 id，提供与依赖都按服务 id 匹配；宿主在查询与激活时调用，不缓存。`EntryStatus` 含 `blocked`，`EntryState.blocked` 为 `{reason, key, path}` 或 `null`；`activate()` 对受阻入口返回 `rejected`/`blocked` 并携带受阻结果；已有当前尝试的入口状态仍按尝试推导。
  - 代次 = 一次激活新建的 lifecycle 子作用域 `plugin:<id>/<entry>#<n>`，持有必需依赖借用与一条 `plugin-closeout` 收口资源（依赖这些借用，释放时记 `closed`）；其子作用域 `entry-work` 即 `context.scope`，承载入口登记的资源、可选依赖的借用、激活产出、贡献发布记录与服务租约。父作用域等子作用域关闭后才释放自己的资源，因此依赖者的全部资源先于其必需借用结束。`entry-work` 上有一个受管操作，在代次开始停止后等待本代次已交付的服务作用域关闭，提供者自己的资源因此晚于其服务实例释放。发布记录 `dependsOn` 激活产出，贡献先撤回；失败整体收口，正常关闭由 lifecycle 级联，发布记录资源的释放即撤回贡献（逆序、幂等）。
  - 提供项协作：登记阶段向 services 声明提供者，其 `create` 触发或加入入口激活并等待结果；成功且代次仍可用时实例交给服务作用域，并在 `entry-work` 挂一条「关闭服务作用域」租约使两者同寿命，代次开始停止后不再交付；实例只释放一次。激活产出的释放按实际产出逆序进行，未交付、未通过校验与迟到的实例都释放且只释放一次。入口不等待自己的提供项。
  - 贡献事务：`prepare`（按声明顺序）全部成功 → 贡献方发布 → 逐项 `published`；任一 `prepare` 失败逆序 `revoke` 全部已准备项。`ContributionHandle.implementation()` 是唯一取实现路径，发布前/撤回后/关闭后抛 `PluginStateError`。补交时 `prepare` 成功后，贡献方已发布即随即 `published`，否则等它发布；`published` 抛错记 `publish` 阶段的 `receiver-published-threw`。
  - 声明查询（`ActivationContext.declarations`）与单条校验同一推导；校验函数拿不到查询，推导不会递归，也就没有环。
  - 已结算且实例已离开可用的代次再触发一律 `rejected: scope-closed`，不返回旧结果、不复活；`recover(ref)` 等待上次激活作用域收口，同时重置该入口在 services 的提供者，不自动重新激活。
  - 缺失实现、缺失提供项、产出未声明的键、缺少声明的接收者（`missing-receiver`）、给出未声明的接收者（`undeclared-receiver`）都是 `output` 阶段失败；不接受空 handler 或占位。
  - 诊断只含 `{sequence, instanceId, location, plugin, entry, generation, stage, reason, capability, contribution, error{name,message}}`；`stage` 为 `register | activate | publish | revoke | recover | close`。交付相关的原因：`receiver-connected`（`publish`）、`receiver-closed`（`revoke`）、`backfill-failed` 与 `delivery-failed`（`publish`）、`receiver-revoke-threw`（`revoke`）。
  - 目录按插件 id 码元比较排序，`PluginDescription.summary` 按输出第 12 条计算。
  - 按调用方提供项：`providePerConsumer` 产出带服务装配品牌的提供项，经与 `provide` 相同的交付路径交给服务装配；门面规则见 [`runtime.services`](./services.md#实现合同)。激活代次随 `access(entryId, scope, {generation})` 带入，必需依赖（激活作用域）与可选依赖（`entry-work`）因此得到同一门面。
  - 激活事件：`<前缀>:<参数>` 两段都不能为空；`activationEventPrefixes` 里空串、含 `:` 或重复的前缀以 `invalid-activation-prefix`，`onStartup` 与 `KERNEL_ACTIVATION_PREFIXES`（目前只有 `onRemote`）以 `reserved-activation-prefix`，在登记时整体拒绝插件。入口里格式不对或此刻没有存活拥有者的事件只记 `register` 诊断 `invalid-activation-event`、`unknown-activation-event`，不拒绝插件；拥有者之后登记时事件照常生效，触发时才核对拥有者。`triggerActivationEvent(event, {requester, signal?})` 返回 `triggered {results}`（逐个入口的激活结果）或 `rejected {reason: invalid-event | reserved-prefix | not-prefix-owner | prefix-conflict}`，前缀冲突另记 `activate` 诊断 `activation-prefix-conflict`。激活事件的诊断以 `capability: "activationEvents"`、`contribution: <事件>` 标出事件。
  - 远程提供项的位置：输出核对时按 `RemoteHostBinding.instance.role` 得出本实例的提供方位置（`hub` 为 `server`），与合同的 `provider` 比较；插件模块只类型导入远程模块，这个对应关系在插件宿主里写一次。
  - 经代理的远程调用：激活上下文的 `remote` 另有 `on(调用方身份)`。插件不在 `delegation` 允许清单内，或装配的 `issuedTo` 核对不过（不是签发给本入口门面的身份、签发它的门面已释放），返回一律以 `denied` 结算的访问；否则以“原调用方 + `via` 为本入口这一代”的身份向节点要一个访问，同一身份只建一次。`use(合同)` 时合同 id 不在入口的 `remoteDelegates` 里同样为 `denied`。节点的释放回调同时挂在签发记录（`issuedTo` 的 `attach`）与本入口这一代的工作作用域上，先到的一个生效；在途调用的取消信号是签发记录开始释放与本入口这一代停止中先到的一个。拒绝都记 `activate` 诊断 `delegation-denied`。
  - 远程提供项：宿主把自己作为提供项来源接入远程节点。远程调用到达时按合同 id 在本位置存活登记里找声明了它的入口：没有时，声明它的插件正在停止（登记作用域处于 `stopping`）为 `unavailable`，否则为 `missing`，节点据此回 `not-provided`；两个以上记 `remote-provider-conflict` 并为 `unavailable`；入口未激活时以 `onRemote:<合同 id>` 激活。每次尝试记下触发它的激活链，这一代激活结算前从它发出的远程调用携带“触发链 + 本入口”；要等待的入口仍在激活中且已在链中时立即 `unavailable`（`cause: activation-cycle`），已结算的入口不算环，并记 `activate` 诊断 `activation-cycle`（`capability: "remoteProvides"`、`contribution: <合同 id>`）。提供方查询走 `RemoteProviderSource.describe`：候选规则相同，但不激活、不记诊断，返回声明里的合同对象与入口此刻的状态（声明它的插件正在停止时为 `stopping`）。
- **合同测试**：`packages/nb-runtime/src/plugins/plugins.test.ts`（含提供项释放失败重试的回归）、`blocked.test.ts`（纯推导）、`entry-dependencies.test.ts`（场景 12–14）、`review-regressions.test.ts`（产出释放、停止后交付、目录排序与重复服务 id；两个位置提供同一 id 在 `plugins.test.ts`）、`owner-contribution-points.test.ts`（场景 16–22 与交付交错回归）、`per-consumer.test.ts`（场景 23；经代理的调用在 `packages/nb-runtime/src/remote/delegation.test.ts`）、`activation-events.test.ts`（场景 24）、`declarations.test.ts`（输出 23、场景 26）、`define.test.ts`（场景 28，随 `tsc --noEmit` 检查），接收者的三个回调（输出 24、场景 27）在 `owner-contribution-points.test.ts`，远程提供项（场景 25，含 `remote-location-mismatch`）在 `packages/nb-runtime/src/remote/routing.test.ts` 与 `activation.test.ts`，关闭顺序与启动激活在 `packages/nb-runtime/src/application/application-startup.test.ts`（场景 15）；在 `packages/nb-runtime` 经 `bun run test` 与 `bun run typecheck` 运行。
- **实际 smoke**：`bun run smoke:runtime-foundation -- --host server|browser`，见 [`runtime.application`](./application.md#实现合同)。

## 证据

- 实现入口：[`plugins.ts`](../../../packages/nb-runtime/src/plugins/plugins.ts)
- 合同测试：[`plugins.test.ts`](../../../packages/nb-runtime/src/plugins/plugins.test.ts)、[`entry-dependencies.test.ts`](../../../packages/nb-runtime/src/plugins/entry-dependencies.test.ts)、[`blocked.test.ts`](../../../packages/nb-runtime/src/plugins/blocked.test.ts)、[`review-regressions.test.ts`](../../../packages/nb-runtime/src/plugins/review-regressions.test.ts)、[`owner-contribution-points.test.ts`](../../../packages/nb-runtime/src/plugins/owner-contribution-points.test.ts)、[`per-consumer.test.ts`](../../../packages/nb-runtime/src/plugins/per-consumer.test.ts)、[`activation-events.test.ts`](../../../packages/nb-runtime/src/plugins/activation-events.test.ts)、[`declarations.test.ts`](../../../packages/nb-runtime/src/plugins/declarations.test.ts)、[`define.test.ts`](../../../packages/nb-runtime/src/plugins/define.test.ts)（验收 28，反例由类型检查执行）
- Smoke：[`runtime-foundation.ts`](../../../packages/neuro-book-legacy/scripts/smoke/runtime-foundation.ts)（`bun run smoke:runtime-foundation`）。这是旧应用宿主上的 smoke，运行的是旧应用里的内核副本；新应用宿主的 smoke 随应用骨架建立。
- 批准依据：[应用运行时、生命周期与内置插件架构](../../../packages/neuro-book-legacy/docs/proposals/application-runtime-and-plugins.md)（2026-09-20 开发者接受基础架构与分段推进方向）；[可扩展应用平台设计](../../proposals/extensible-application-platform.md) P1 第 2、4 项、P3、P11（2026-09-30 `accepted`）与 [`runtime.plugin-manifest`](./plugin-manifest.md) 第 2–10 条；[多实例运行时拓扑](../../proposals/multi-instance-runtime-topology.md) 第 4 节与 [ADR 0024](../../adr/0024-multi-instance-runtime-topology.md)（2026-10-07 `accepted`）；远程提供项的提供方位置、跨实例的 `remote.on` 与 `remoteDelegates` 由开发者 2026-10-07 在 [t54 实施计划](../../../.agents/works/w00017-application-runtime-architecture/tasks/t54-project-child-process/plan.md)、[t55 实施计划](../../../.agents/works/w00017-application-runtime-architecture/tasks/t55-plugin-storage/plan.md) 中确认；插件描述的类型移进内核由开发者 2026-10-08 选定（[t57](../../../.agents/works/w00017-application-runtime-architecture/tasks/t57-runtime-examples/README.md)）；不同位置的入口可以提供同一服务 id 依据 [ADR 0026](../../adr/0026-plugin-definitions-as-constants.md)（2026-10-08）；激活上下文可查已接受的声明由开发者 2026-10-08 在 [t56 实施计划](../../../.agents/works/w00017-application-runtime-architecture/tasks/t56-plugin-state/plan.md) 中确认（公开状态做成贡献点）；删去本地委托、校验函数不再查询别的贡献、接收者去掉 `commit`、`defineEntry` 与合同对象声明由开发者 2026-10-08 在 [t60 实施计划](../../../.agents/works/w00017-application-runtime-architecture/tasks/t60-plugin-api-ergonomics/plan.md) 中确认。
