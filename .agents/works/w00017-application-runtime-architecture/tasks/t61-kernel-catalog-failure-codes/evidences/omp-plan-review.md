# w00017 t61 实施计划只读审查

审查对象：`.agents/works/w00017-application-runtime-architecture/tasks/t61-kernel-catalog-failure-codes/plan.md` 与同目录 `README.md`。

依据工作区：`/home/notnotype/CodeRepository/neuro-book/.worktree/w00017-t61-plan-review`，计划提交 `3cd7b386`。本报告审查计划与该提交现有机制，不评价另一个 worktree 中的实施结果。

## 已核实发现

审查已完成，共 9 项：阻断 0、重要 7、建议 2。按写入结果误判、协议兼容、消费方与状态合同、切片、验收及文档影响排序。所列修订均为建议；未修改计划或仓库实现。

### 1. 重要：同实例“两值仍安全”的前提不成立，门面工厂可以同步停止入口后继续执行写方法

- **严重程度**：重要；**类别**：正确性与阶段不变量。
- **位置**：`plan.md:26`、`plan.md:28`；`packages/nb-runtime/src/remote/node.ts:584–597`、`node.ts:650–666`、`node.ts:800–810`。
- **现象**：`handleRequest` 先检查终止信号，再同步调用提供方门面工厂，然后 ACK、执行方法。门面工厂是插件代码，可以同步引发正常运行实例停止；停止信号会重入 `#localRequest.interrupt`，以未 ACK 阶段先结算 `cancelled`。门面工厂返回后没有再检查信号，仍 ACK 并执行写方法。
- **为什么是问题**：计划断言“中断时还没 ACK 的请求确定没有执行”，但这里调用方已得到确定的 `cancelled`，方法随后仍产生副作用。保留同实例两值可以成立，前提是终止信号触发后绝不开始执行；现有代码缺少保证。此问题是现有机制缺陷，也直接否定本计划将该路径排除在阶段修正之外的理由。
- **依据**：在未修改的真实内核里，提供方 `provideRemote` 工厂同步调用公共 `Application.stop()`，方法记录执行次数并忽略已触发的 signal。执行 `bun /tmp/claude-1000/-home-notnotype-CodeRepository-neuro-book/c38df555-3a36-49c9-bf4f-4027b5da6d32/scratchpad/omp-t61-plan/local-reentrant-stop.ts`（退出 0）输出：`outcome={ok:false,code:"cancelled",cause:"cancelled"}`、`executions=1`、`runSignalAborted=true`、`callerSignalAborted=true`。实验通过公开激活上下文发出同实例请求，没有伪造私有状态或同步链路回调。
- **建议改法**：在门面工厂返回之后、ACK 和方法执行之前再次检查 `signal.aborted` 与 `found.stopSignal.aborted`；已停止则不执行方法，保持确定失败。本地不必增加 `sent` 状态。把这条真实重入场景纳入 S1 的同实例验收；它比为本地增加第三个阶段更少部件。

### 2. 重要：不提升 wire 版本依赖的“新旧两端总来自同一次构建”并不覆盖浏览器

- **严重程度**：重要；**类别**：协议兼容与失败语义。
- **位置**：`plan.md:13`；`docs/specs/runtime/projects.md:133`；`packages/nb-runtime/src/remote/node.ts:531–544`；`packages/neuro-book/src/web/host/window.ts:270–280`、`packages/neuro-book/src/web/host/remote-session.ts:143–154`。
- **现象**：引用的同构建保证只约束项目子进程与服务端。浏览器初次引导只比引导协议版本、插件 id 与插件版本；这些内置插件目前版本为 `0.1.0`，没有构建标识。引导后才建立 RPC 连接，首次 hello 的 `boot` 为 null。旧外壳可以在新版后端提供相同插件版本时通过引导与 wire 3 握手；引导和 RPC 握手之间重启服务端也是该时序。`boot` 只保护已经握过手的节点，不能证明首次两端同构建。
- **为什么是问题**：wire 字段形状相同不等于结果码兼容。旧节点的 `#checkOutcome` 会把新 `not-provided` 判成未声明码并改为 `provider-error`。旧内核还按 ACK 计算取消／超时，即使连接新服务端，ACK 在途时仍会把写请求报成确定的 `cancelled`／`timeout`；本次要消除的重试风险因此不会被握手挡住。
- **依据**：真实调用与握手实验使用仓库原节点作旧调用方、仓库外临时模型仅改 `sent` 阶段及 `missing` 结果码作新版目标，双方保持 wire 3。执行 `bun /tmp/claude-1000/-home-notnotype-CodeRepository-neuro-book/c38df555-3a36-49c9-bf4f-4027b5da6d32/scratchpad/omp-t61-plan/wire-mismatch-same-version.ts`（退出 0）：`connected={ok:true}`，调用结果为 `provider-error`，诊断 `undeclared-error/not-provided`。模型只用于证明互操作，不是对尚未实现 t61 的通过验证。浏览器可放行不同构建由 `window.ts`、`remote-session.ts` 和插件版本声明静态核实。
- **建议改法**：直接提升 `WIRE_PROTOCOL_VERSION`，让旧外壳在握手被拒并按现有宿主页流程提示刷新；新增码、阶段语义和保留合同一起在版本边界切换。它复用已有门禁，比新增构建指纹及多处比对更少部件。若坚持不升版本，须明确只支持本次共同构建且首次握手真实校验这一限制，不能引用仅覆盖 IPC 的保证。

### 3. 重要：计划漏掉 `openProject`，它会把结果未知的写请求折为确定的 `unavailable`

- **严重程度**：重要；**类别**：消费方遗漏与错误码收敛。
- **位置**：`plan.md:36`、`plan.md:135–136`；`packages/neuro-book/src/plugins/projects/web/open-project.ts:44–61`；`packages/neuro-book/src/plugins/commands/shared/contracts.ts:25–36`、`packages/neuro-book/src/plugins/commands/shared/registry.ts:83–93`、`registry.ts:346–347`。
- **现象**：真实产品“打开项目”命令调用 `projectsRemoteContract.list` 与写方法 `register`。除 `register-failed` 业务错误外，RPC 的任意失败都改为命令结果 `unavailable`，原码仅写在 `reason` 文本中。命令失败联合和运行期白名单均不包含 `unknown-outcome`。新增 `not-provided` 也在该路径丢失区别；计划声称只有 Storage 折算受影响，遗漏此消费方。
- **为什么是问题**：登记会创建项目身份文件并写登记表；结果在途丢失时命令仍声称“登记没有完成”、返回 `unavailable`，调用方不能按码辨别已经执行的可能性。本次扩大为 ACK 前中断也返回 `unknown-outcome`，但该生产边界随即把它降回确定失败。仅往 `CommandFailureCode` 加码而不改白名单，还会再次变成 `execution-error`。`commandsRemoteContract.execute` 自身确实原样返回外层 RPC 失败，不能代表所有命令内部调用都这样处理。
- **依据**：scout 定位后主 Agent 核实合同、登记副作用及折码，并运行真实项目登记表（文件均在 scratch 内）、`openProject` 与命令 registry，链路使用阶段模型。在 scratch 根执行 `bun project-command-outcome.ts`（退出 0）：已登记列表实际包含 `book`，RPC 返回 `{code:"unknown-outcome",cause:"disconnected"}`，`openProject` 及命令 registry 都返回 `{code:"unavailable",reason:"登记没有完成：unknown-outcome"}`，未导航；断言通过。此实验采用真实领域实现与正常请求，不是固定失败值替身。
- **建议改法**：把项目命令纳入 S1 的消费边界，未知登记结果返回命令侧 `unknown-outcome`，提示用户核对登记列表；同步更新命令类型与白名单，不按 `reason` 文本分支。对读查询的 `not-provided` 可以明确采用领域 `unavailable` 的折算，但不能再声称新增码仅影响 Storage；若要保留“功能未提供”，需同时给命令失败合同一个可分支的码。

### 4. 重要：现有 `missing` 会包含正在停止的插件，直接换码会把暂时不可用报成没有提供方

- **严重程度**：重要；**类别**：状态判定与失败语义。
- **位置**：`plan.md:33–34`、`plan.md:56`、`plan.md:66`、`plan.md:76`；`packages/nb-runtime/src/plugins/host.ts:77`、`host.ts:638–652`、`host.ts:1598–1626`。
- **现象**：计划用现有 `ProviderLookup.status === "missing"` 直接判定 `not-provided`，同时承诺“正在停止”仍为 `unavailable`，查询可以返回 `state: "stopping"`。实际候选集先按 `isAlive(plugin.scope)` 过滤；`isAlive` 只含 `creating`、`available`，插件登记作用域一进入 `stopping` 就被排除，尚未释放完的远程入口也变成 `missing`。
- **为什么是问题**：常规插件禁用／作用域收口路径下，调用和订阅都会被新规则改报 `not-provided`。查询若复用候选集也无法报告这个提供方的 `stopping`；若另写不同候选集，则查询与调用对“是否提供”的判定分裂。功能显示与“稍后再试”会按错误分类分支，正好破坏本 Task 要建立的区分。别的运行位置与已关闭登记排除是合理的，问题是把停止中也一起排除了。
- **依据**：运行真实 `createRuntimeInstance`、`createPluginHost`、`createRemoteNode` 和路由，通过公共 `pluginScope.close()` 开始停止，资源释放用 Promise 闸门保持在途；未直接调用私有函数。执行 `bun /tmp/claude-1000/-home-notnotype-CodeRepository-neuro-book/c38df555-3a36-49c9-bf4f-4027b5da6d32/scratchpad/omp-t61-plan/stopping-provider.ts`（退出 0）输出：`pluginScope: stopping`、`entryState: stopping`、宿主实际接入节点的 source 返回 `{status:"missing"}`，读调用与订阅现均为 `unavailable`，说明为“本实例没有提供 review.provider/value”。最后两项现有结果来自 `missing` 分支，按计划换码后会成为 `not-provided`（从代码推断）。
- **建议改法**：让激活查找与纯查询共用一个静态候选选择：本运行位置、声明合同、登记作用域尚未 `closed`；唯一候选处于 `stopping` 时，调用／订阅直接 `unavailable`，查询返回 `provided/stopping`；登记关闭后才是 `not-provided`。补一个真实作用域停止、释放未完成的用例，同时核对调用、订阅和查询，避免三处各写候选规则。

### 5. 重要：查询绕过被查询合同的调用方种类校验，`describe` 也没有提供校验所需信息

- **严重程度**：重要；**类别**：接口与访问规则。
- **位置**：`plan.md:61`、`plan.md:65`、`plan.md:66`、`plan.md:113`；依据源码 `packages/nb-runtime/src/remote/node.ts:636`、`packages/nb-runtime/src/remote/router.ts:434`。
- **现象**：计划承诺查询与调用使用同样的访问规则，但 `runtime/catalog` 的特殊处理在进入被查询合同的查找与激活前直接回答；`describe(contractId)` 只写明返回版本和入口状态，线上输入也只有 id 与版本。路由只核对成员身份、目标与项目访问，不核对合同的 `callers`。验收清单只有 `{project}` 的 `denied`，没有合同禁止当前运行位置的查询。
- **为什么是问题**：现有调用与订阅都在目标节点拿到提供方合同后检查 `contract.callers.includes(frame.$nbConsumer.location)`。改走保留合同不会自动继承该检查。照计划的明确步骤实现，浏览器能查询仅允许 TUI 的合同，返回状态或版本，而正常调用应为 `denied`；与“访问规则和调用相同”的合同冲突。仅凭调用方传来的合同对象核对也不够，目标声明才是权威。
- **依据**：静态追踪已确认：`router.ts:434–459` 负责实例身份、停止准入及目标解析；`node.ts:623–638` 的目标声明查找和 `callers` 校验正是查询将绕过的部分；`node.ts:704–710` 订阅重复执行同一规则。现有 `routing.test.ts:48–49` 已有 `callers: ["tui"]` 的 `restricted` 合同，`routing.test.ts:490–505` 已证实普通请求按路由认定的真实运行位置拒绝调用。
- **建议改法**：让宿主的纯查询直接返回静态 `RemoteContract` 与当前状态，不另复制一份版本／权限元数据；目标节点先按该合同的 `callers` 和真实 `$nbConsumer.location` 判定 `denied`，再核对版本并回答。新增一例“不允许的运行位置查询 restricted 合同为 denied，提供方未激活”，并覆盖自报运行位置由路由覆盖。

### 6. 重要：从静态声明查询版本之前，缺少声明与激活产出一致的保证

- **严重程度**：重要；**类别**：查询与调用合同不一致。
- **位置**：`plan.md:63`、`plan.md:66`；`packages/nb-runtime/src/plugins/host.ts:1038–1054`；`packages/nb-runtime/src/remote/contract.ts:60–73`；`packages/nb-runtime/src/remote/node.ts:631–638`。
- **现象**：查询计划从 `remoteProvides` 的静态合同取版本；正常调用从激活产出的 `RemoteProvision.contract` 取版本和调用权限。当前激活核对只检查 id、重复提供项、拓扑位置及缺失，不检查两份合同版本或 `callers`。`defineEntry` 也无法拦住同形状、同 id、不同版本的合同。
- **为什么是问题**：合法类型代码可以声明版本 1、交出版本 2，并成功激活。查询会对版本 1 返回 `provided/available`，实际调用却稳定返回 `version-changed`；查询版本 2 还会告诉调用方应改用版本 1。这不属于“查到之后状态改变”的正常竞争，而是可用状态下两个 API 的依据永久不同；权限也有同样风险。
- **依据**：真实未修改内核实验 `static-provider-version.ts` 经 `defineEntry` 声明 v1、用 `provideRemote(v2)` 产出：入口为 `available`，v1 调用为 `version-changed`，v2 调用成功返回 2。执行该脚本及对其执行 `tsc --noEmit --strict --skipLibCheck --allowImportingTsExtensions --target ESNext --module ESNext --moduleResolution bundler --types bun` 均退出 0，完整命令见下方验证表。它没有 `any`、类型强转或私有状态注入；尚未实现的查询结果按计划推断。
- **建议改法**：把声明与产出的合同一致性纳入 S3 的激活产出核对，版本、提供方位置及 `callers` 以同一声明为依据；产出不匹配拒绝激活。继续纯查询声明，不用为查询激活提供方或建立另一份元数据表。增加同 id、同形状但不同版本的产出被拒场景，并核对查询与调用采用同一版本和权限规则。

### 7. 重要：S1 漏迁移共享阶段函数的现有调用方，不能按表独立通过类型检查

- **严重程度**：重要；**类别**：切片依赖与验收可执行性。
- **位置**：`plan.md:20–26`、`plan.md:100–102`；`packages/nb-runtime/src/remote/node.ts:574–597`；`packages/nb-runtime/src/remote/protocol.test.ts:35–38`。
- **现象**：S1 把 `failureFor` 参数改为 `"undispatched" | "sent" | "acked"`，提交边界只有 `protocol.ts`、`peer.ts`、测试链路及 Storage 注释与测试。同实例 `node.ts` 仍把包含 `"dispatched"` 的旧阶段传进去，`protocol.test.ts` 也直接传 `"dispatched"`。`node.ts` 到 S2 才列入提交范围。
- **为什么是问题**：这是同一个共享函数的类型切换，不存在一个只改协议与 Peer、仍能独立 typecheck 的 S1。把修正藏到 S2 会让 S1 的“自跑通过后单独提交”无法成立；保留旧 `dispatched` 兼容别名则增加一套阶段词汇。现有 protocol 测试也应分别核对 `sent` 与 `acked` 的读写规则。
- **依据**：静态核实所有旧阶段调用方及包 `tsconfig.json:13`（包含 `src`、含这些测试文件）。阶段实验模型为了运行，已必须把本地调用映射为 `phase === "dispatched" ? "acked" : "undispatched"`；这项是原 S1 边界之外的真实依赖，不是新增功能。
- **建议改法**：把 `node.ts` 的本地阶段命名迁移、门面工厂后的停止检查及 `protocol.test.ts` 纳入 S1。同实例仍只使用 `undispatched/acked`，省掉本地的旧词及转换；S2 再专门处理 `not-provided`。按实际直接受影响文件更新切片边界，不加兼容别名。

### 8. 建议：验收映射的一例“cut 或超时”不足以证明三种中断与两个链路阶段均已覆盖

- **严重程度**：建议；**类别**：验收覆盖与变异检查。
- **位置**：`plan.md:105`、`plan.md:111`；`packages/nb-runtime/src/remote/routing.test.ts:325–347`。
- **现象**：映射声称覆盖 ACK 在途时“断开、超时、取消；单跳、两跳”，实际只约定新增一例“项目入口写方法执行时 cut 或推进时钟”，没有取消的触发方式，也没列调用方到 hub、hub 到目标两段各自的丢帧场景。现有断线与超时用例先 `drain()`，只能保护 ACK 已回来的路径。
- **为什么是问题**：`#onClose` 和 `#interrupt` 是不同结算入口；第一跳与第二跳也分别有一个 `Peer`。只验证其中一条路径后回退全部 S1，能让“核心变异”失败，却不能发现另一条路径仍按旧 ACK 边界结算。将字段形状与最终码测对，也不证明该场景真的没收到 ACK。
- **依据**：阶段模型分别运行单跳 ACK 丢失、两跳第一跳 ACK 丢失、两跳第二跳 ACK 丢失、ACK 前超时、ACK 前取消，以及第二跳结果在途丢失；公开 `onFrame` 观察证实前三类 ACK 交付数为 0，读码保持原样。实验不改 `send`、不直接注入帧或调用私有结算函数，说明这些场景可用现有 seam 确定地制造；计划的单例约定不完整。
- **建议改法**：把上述触发点写成一个小型参数表，逐项用公开调用、`cut()`、注入时钟及 `AbortController` 触发，断言读写结果、实际 ACK 是否送达及方法是否执行。分别回退“发送后记 sent”和第二跳使用该阶段的关键点，确认各自场景失败；不需要 mock、固定等待或另造路由状态机。

### 9. 建议：S0 漏改两处仍写旧失败合同的规范正文与验收

- **严重程度**：建议；**类别**：文档真相源遗漏。
- **位置**：`plan.md:71–76`、`plan.md:82–93`、`plan.md:99`；`docs/specs/runtime/plugins.md:211`；`docs/specs/runtime/plugin-api.md:158`；Task `README.md:17`。
- **现象**：S0 文档表没有 `runtime/plugins.md`，其实现合同仍写“没有为 `unavailable`”；Task 已把它列为可能涉及的行为合同。计划只改作者 API 表和错误码正文，漏掉 `plugin-api.md` 验收 2：“取未在 dependencies 中声明的 id，得到 undeclared-service”。
- **为什么是问题**：实施后提供方缺失的规则与新的 `plugin-channel.md` 冲突；作者 API 同一文档还会要求一个正文刚删除的失败值，验收与实际抛错行为相反。文档检查只能验证结构与链接，不能自动发现这些语义冲突。
- **依据**：主 Agent 核实两个 Spec 原文与 S0 表；`host.ts:990–994` 已按服务键取必需依赖，未解析的键抛 `TypeError`。`plugin-manifest.md:77` 的“`unavailable` 等结构化失败”与 `:135` 的受阻提供方为 `unavailable` 均不冲突，未误报为必须换码。
- **建议改法**：S0 增加 `runtime/plugins.md`，写清缺少未关闭登记与停止中的区别；`plugin-api.md` 验收 2 改为“必需服务键返回服务本身，未声明或可选键抛错，可选服务经 resolve 取得结构化结果”。同步修订 S0 的“5 份 Spec”计数；不必改受阻入口仍为 `unavailable` 的验收。

## 未发现问题的方面

- **写请求三阶段映射可行**：`sent/acked` 的中断都保守返回 `unknown-outcome`，不需要改变帧结构。发送前已取消和编码失败仍为确定的 `cancelled/invalid-input`；目标明确回来的 `denied` 等失败不能因本端已经 `sent` 就变为未知。阶段边界实验已确认三类结果。
- **两跳可共用 Peer 结算**：路由的第二跳已经用 `Peer.request`，结果回程原样透传。模型实测第一跳与第二跳 ACK 丢失都能保留未知写结果，读码不变；第二跳 ACK 已送达、方法执行完成但结果未送达时也不会被路由降回确定失败。无需另加路由阶段表。
- **`cut()` 与 `close()` 可以并存**：独立的丢帧标志与现有关闭通知足够。排队投递时检查该标志，正常关闭仍送完先前排队帧；实验分别观测到 `[frame, closed]` 和 `[closed]`，没有伪造同步传输回调。真实 WebSocket 的异常断开一致性仍需实施验收核对，模型本身不能证明真实传输合同。
- **查询不必持有提供方引用**：普通 `runtime/catalog` 读请求、目标节点静态描述、无门面／订阅／目标释放记录的分层合理；可复用现有请求的调用方信号及路由准入，无需增加租约或能力缓存。信息只是快照，与“不先查询再持有引用”的已定设计一致。查询尚未实现，这里是设计与源码推断，不是通过验证。
- **寻址写法与既有合同相容**：`server/project` 可省略目标，`client/any` 必须指定，与现有 `RemoteUse`、`providerAccepts` 和 `defaultTarget` 的规则一致；`lookup` 放在 `RemoteAccess` 避免与业务方法名冲突。委托访问暂不新增查询，没有扩大已批准的代调用能力。
- **Storage 与 store 的未知结果处理可保留**：`remote-route.ts:61–68` 已保留 `unknown-outcome`，其它 RPC 失败按领域折为 `unavailable`；`persisted.ts:373–384,395–411` 在未知结果下保留实际写值与原 `expect`，重试前核对快照，未再执行一次 change 函数。此结论为源码核实，未重跑 store 测试。
- **指定的其它消费路径未见新增折码问题**：`commandsRemoteContract.execute` 将领域命令结果放在 RPC 成功值里，外层传输失败由内核返回；公开状态同步读取与 HTTP 分发本身没有 RPC 失败码映射。项目命令内部调用的遗漏另见第 3 项，不能由此推广为全部命令都原样透传。
- **保留 id 与文档寿命处理合理**：`runtime/` 留给内核，按既有失败码表拒绝同名业务失败码，以及只给 accepted 拓扑提案追加决策记录，均可沿用既有机制。`plugin-manifest.md` 的受阻入口仍为 `unavailable`、实例没有 remote 时仍为 `unavailable`，没有理由一并改码。
- **作者取服务与同步服务的改法正确**：必需服务键 `require` 返回服务本身，未解析的必需依赖抛错，可选依赖用 `resolve`；同步命令与公开状态读取仅限内置插件符合选用规则。需补旧验收清理，见第 9 项。

## 已确认决定与待决事项

计划末尾三项均已获开发者确认，没有新的待确认项：不新增本实例目录、采用 `context.remote.lookup(合同, 目标?)`、写请求边界提前到发帧，均按既定决定审查。wire 版本建议源于浏览器首次连接的兼容缺口，不改变这三项目标；主实施方应修订对应设计与验收。审查报告不代替开发者批准，也没有执行修复。

## 实际验证与边界

主 Agent 执行下列命令；两个 scout 只读定位应用消费与文档／切片，未运行 build、lint、测试或 typecheck。实验文件及实际项目登记数据都位于指定 scratch 根。远程阶段模型是仓库外的设计实验，不是 t61 实现，不得把下列结果当作另一 worktree 的实现验收。

| 实际命令 | 工作目录 | 结果与覆盖 |
|---|---|---|
| `bun install --frozen-lockfile --ignore-scripts` | 审查 worktree 根 | 退出 0；Bun 1.4.2；安装 1559 packages。跳过会触发构建的 postinstall，只安装依赖 |
| `bun run --cwd packages/nb-runtime typecheck` | 审查 worktree 根 | 退出 0；执行 `tsc --noEmit && tsc --noEmit -p tsconfig.browser.json`。这是原始内核的类型基线 |
| `bun /tmp/claude-1000/-home-notnotype-CodeRepository-neuro-book/c38df555-3a36-49c9-bf4f-4027b5da6d32/scratchpad/omp-t61-plan/stopping-provider.ts` | 审查 worktree 根 | 退出 0；真实停止中入口被 source 归为 missing；读调用与订阅均经过真实节点／路由 |
| `bun /tmp/claude-1000/-home-notnotype-CodeRepository-neuro-book/c38df555-3a36-49c9-bf4f-4027b5da6d32/scratchpad/omp-t61-plan/local-reentrant-stop.ts` | 审查 worktree 根 | 退出 0；真实门面工厂同步触发 Application.stop，调用先 cancelled 后方法仍执行 1 次 |
| `bun /tmp/claude-1000/-home-notnotype-CodeRepository-neuro-book/c38df555-3a36-49c9-bf4f-4027b5da6d32/scratchpad/omp-t61-plan/phase-scenarios.ts` | 审查 worktree 根 | 退出 0；6 个时序 × read/write × 原实现/模型 = 24 次。最新版本只用公开观察器与 cut／时钟／取消，不替换 send；模型写中断为 unknown-outcome，读结果与原实现相同 |
| `bun /tmp/claude-1000/-home-notnotype-CodeRepository-neuro-book/c38df555-3a36-49c9-bf4f-4027b5da6d32/scratchpad/omp-t61-plan/phase-boundaries.ts` | 审查 worktree 根 | 退出 0；发送前取消、编码失败、目标明确拒绝仍确定；close 送完排队帧、cut 丢弃排队帧 |
| `bun /tmp/claude-1000/-home-notnotype-CodeRepository-neuro-book/c38df555-3a36-49c9-bf4f-4027b5da6d32/scratchpad/omp-t61-plan/wire-mismatch-same-version.ts` | 审查 worktree 根 | 退出 0；原节点与模型保持 wire 3 仍连接成功，但 not-provided 被旧端改成 provider-error |
| `bun project-command-outcome.ts` | 指定 scratch 根 | 退出 0；真实项目登记成功，结果丢失返回 unknown-outcome，openProject 与命令 registry 都折成 unavailable |
| `bun /tmp/claude-1000/-home-notnotype-CodeRepository-neuro-book/c38df555-3a36-49c9-bf4f-4027b5da6d32/scratchpad/omp-t61-plan/static-provider-version.ts` | 审查 worktree 根 | 退出 0；静态 v1、产出 v2 仍成功激活；v1 调用 version-changed，v2 调用成功 |
| `node_modules/.bin/tsc --noEmit --strict --skipLibCheck --allowImportingTsExtensions --target ESNext --module ESNext --moduleResolution bundler --types bun /tmp/claude-1000/-home-notnotype-CodeRepository-neuro-book/c38df555-3a36-49c9-bf4f-4027b5da6d32/scratchpad/omp-t61-plan/static-provider-version.ts` | 审查 worktree 根 | 退出 0；不同版本产出的实验也通过类型检查 |
| `git status --short --branch`；`git rev-parse --short=8 HEAD` | 审查 worktree 根 | 分别仅输出 `## HEAD (no branch)` 与 `3cd7b386`，无仓库文件改动 |

运行绕路已区分：初次实验类型检查缺少 `--allowImportingTsExtensions`，报 TS5097，补全后通过；项目命令实验初次使用 `--tsconfig-override` 时 Bun 在断言成功后报 `Internal error: directory mismatch ... tsconfig.json`，改从 scratch 根自动读取同一 tsconfig 后干净退出。未将这两个中间结果当作通过证据。

**未运行**：内核或应用全套测试、应用 typecheck、docs:check、governance:check、e2e、开发服务、smoke:server、真实 WebSocket／IPC 异常断开对照。未对尚未存在的 t61 实现做变异测试；原实现与阶段模型对照只证明设计场景和风险可观察。lookup 的目标权限和返回值是计划静态推断，未声称已有实现或运行结果。

## 规范缺陷回写建议

仅建议修改现有真相源，未落盘到仓库；第 2、4、5、6、9 项已有具体依据和改法，不另加治理入口。

| 编号 | 类别 | 依据 | 建议修改 | 目标位置 |
|---|---|---|---|---|
| 1 | 规范缺陷 | 浏览器缺少首次连接的同构建保证，wire 3 的旧端把新码改为 provider-error | 改写：“失败码集合或写请求结算语义不兼容时提升 wire 版本，在业务帧前拒绝旧端。” | `docs/specs/runtime/plugin-channel.md` 的“边界与兼容”及 t61 计划 |
| 2 | 规范缺陷 | 查询从声明读版本／权限，现有激活产出可与声明不同；停止中还被候选集过滤 | 改写：“查询与调用采用同一静态合同和候选判定；停止中仍提供，激活产出合同不符则拒绝发布。” | `docs/specs/runtime/plugins.md` 的“远程提供项”及 `plugin-channel.md` 的查询合同 |
| 3 | 规范缺陷 | 作者 API 正文删除 undeclared-service，验收 2 仍要求返回该码 | 改写：“require 以必需服务键取已解析服务，未声明或可选键抛错；可选服务经 resolve 查询。” | `docs/specs/runtime/plugin-api.md` 的验收 2 |

## 严重程度数量

阻断 **0**，重要 **7**，建议 **2**，合计 **9**。文档遗漏的两处合并为第 9 项；没有把 scout 的重复发现再次计数。
