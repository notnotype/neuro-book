# w00017 t61 实现只读审查

审查对象：`3cd7b386..5ff12a08` 的 t61 提交；排除 `4d4e3465` 的 t62 计划。

审查工作区：`/home/notnotype/CodeRepository/neuro-book/.worktree/w00017-t61-impl-review`。

依据：t61 `plan.md` 的“实施中的调整”、同目录 `evidences/omp-plan-review.md`、相关 Spec 与当前实现。计划审查已处理的 9 项不重复计数，除非实现未落实或修正引入新问题。

审查结论：重要 **4**，阻断 **0**，建议 **0**。四项均由主审通过公开 Application／插件上下文与真实运行时路径复现；下面按影响排序。未修改仓库文件。

## 已核实发现

### 1. 重要：`send` 编码期间的同步取消仍结算为确定失败，但写请求随后发出并执行

- **严重程度**：重要；**类别**：正确性、写请求阶段不变量。
- **位置**：`packages/nb-runtime/src/remote/peer.ts:135`、`peer.ts:139`–`145`；真实重入来自 `packages/nb-runtime/src/remote/json-codec.ts:28`–`30` 的业务属性读取。
- **现象**：请求安装取消监听后进入链路 `send()`，直到 `send()` 返回才从 `undispatched` 改成 `sent`。合法普通对象的输入 getter 在 JSON 编码期间触发公共 `AbortController.abort()` 时，请求先以 `{code:"cancelled",cause:"cancelled"}` 结算；链路仍完成编码并把 request 发出。目标实际写入成功。观察到的到达顺序是 `cancel`、`request`，所以目标还没登记 request 时就丢掉了取消帧。
- **为什么是问题**：这是 t61 要消除的确定失败误判：调用方可以按 `cancelled` 安全重试，但写副作用已发生。`send` 不同步投递远端回调不代表它不执行插件代码；JSON 序列化会同步运行普通对象的 getter／`toJSON`。三阶段只在发送返回之后切换，未保护发送本身的重入。本轮新增 `sent` 不能覆盖这条真实编码路径。
- **依据**：主审运行 `bun /tmp/claude-1000/-home-notnotype-CodeRepository-neuro-book/c38df555-3a36-49c9-bf4f-4027b5da6d32/scratchpad/omp-t61-impl/send-reentrant-cancel.ts`，退出 0。实验用真实 `createApplication`、节点、路由、`createLinkPair` 和公开激活上下文，无 transport 替换或内部状态注入；输入为原型正常且可 JSON 表示的 `{get text(){ controller.abort(); return "committed"; }}`。输出 `result:{ok:false,code:"cancelled",cause:"cancelled"}`、`received:["cancel","request"]`、`writes:["committed"]`。
- **建议改法**：保护整个进入 `send()` 到它返回的边界：发送期间暂存中断原因，发送返回后先处理编码失败（`invalid-input`），发送成功则先转为 `sent`，再按该阶段结算中断并发送取消帧。这样仍保留“无法编码时确定没有执行”的合同，又不会把可能已发出的写请求报为确定失败。加真实编码 getter 触发取消的用例，断言不能同时出现确定失败与目标写入。

### 2. 重要：同实例订阅在工厂停止调用方之后仍建立成功，并投递首个事件

- **严重程度**：重要；**类别**：不变量、同实例重入与订阅生命周期。
- **位置**：`packages/nb-runtime/src/remote/node.ts:618`（建立后登记在 630–637 行）、`node.ts:860`、`node.ts:1002`（`#localSubscribe`）。
- **现象**：提供方门面工厂同步关闭调用方的插件登记作用域后，普通写请求已经按本次修正返回 `cancelled` 且不执行；相同情形的同实例订阅仍返回 `{ok:true}`，调用提供方 `subscribe`，它同步推送的第一个事件到达已触发停止信号的调用方。随后作用域释放才取消订阅。
- **为什么是问题**：输出 7 要求任一入口开始停止即取消订阅并丢弃迟到事件。订阅只在进入客户端方法时检查 `caller.signal`，本地订阅的 controller 没有绑定这个信号；门面工厂后的 `signal.aborted` 检查因而看不到调用方已停止。直到 `#startSubscription` 返回后才把订阅放入 `owned`，此前的调用方停止也无法经释放回调取消它。这是本轮同实例重入修正的订阅遗漏；不是声称写方法修正没有落实。简单复现中门面最终释放一次，没有重复释放。
- **依据**：主审运行 `bun /tmp/claude-1000/-home-notnotype-CodeRepository-neuro-book/c38df555-3a36-49c9-bf4f-4027b5da6d32/scratchpad/omp-t61-impl/runtime-edges.ts`，退出 0。通过真实 `createApplication`、激活上下文 `context.remote` 与 `Scope.close()` 发起订阅；没有调用私有方法。输出 `scenario:"caller-stops-in-subscribe-factory"`、`outcome:{ok:true}`、`stoppedAtSubscribe:true`、`subscriptions:1`、`delivered:[1]`；相邻写请求场景为 `cancelled`、`writes:0`、`releases:1`。订阅的提供方 signal 在收口之后才变为 aborted。
- **建议改法**：让订阅从开始建立时就受调用方停止信号控制，不等接受后再登记生命周期；本地 controller 与 `caller.signal` 联动，并让 pending 取消也结算建立结果。`handleSubscribe` 在取门面前和工厂返回后采用与请求一致的停止检查。补“门面工厂停止调用方／订阅尚未建立时停止”的真实作用域用例，核对订阅不会执行、首个事件不会到达、资源只释放一次。

### 3. 重要：同一入口重复声明同一合同 id 时，同一性检查仍允许查询与调用采用不同版本

- **严重程度**：重要；**类别**：声明校验、查询与调用合同一致性。
- **位置**：`packages/nb-runtime/src/plugins/host.ts:684`、`host.ts:1072`–`1091`；登记结构校验 `packages/nb-runtime/src/plugins/registration.ts:78`–`133`；对应 `docs/specs/runtime/plugins.md:77`（输出 22）。
- **现象**：一个入口的 `remoteProvides` 为 `[v1, v2]`，两个对象 id 相同、版本不同，激活只产出 `provideRemote(v2)`。登记与激活均成功：`includes(item.contract)` 允许 v2，缺失检查只按 id，因此一项产出满足两项声明。查询却用 `find(id)` 读 v1，查询 v1 为 `provided/available`、查询 v2 为 `version-changed/version:1`；调用 v1 为 `version-changed`、调用 v2 成功。
- **为什么是问题**：新增同一性检查未保证每个 id 对应唯一的静态合同，输出 22 要求的“查询按声明、调用按产出，两者必须一致”仍可永久违反。宽类型的 `PluginDefinition` 是受支持入口；错误声明应可见地被拒，不能成功进入 `available` 后给两套互相矛盾的版本答案。这是计划审查第 6 项修正尚未封住的重复声明边界，不重报已修好的单一 v1 声明／v2 产出场景。
- **依据**：主审运行同目录 `bun contract-identity.ts`，退出 0。脚本使用公开 Application、插件定义与 `context.remote`，没有类型强转、`any` 或私有状态注入；输出 `provider.status:"available"`、`queriedV1:{ok:true,value:{status:"provided",state:"available"}}`、`queriedV2:{ok:true,value:{status:"version-changed",version:1}}`、`calledV1:{ok:false,code:"version-changed"}`、`calledV2:{ok:true,value:2}`。对该脚本执行 `./node_modules/.bin/tsc --noEmit --strict --skipLibCheck --allowImportingTsExtensions --target ESNext --module ESNext --moduleResolution bundler --types bun contract-identity.ts` 亦退出 0。
- **建议改法**：在登记阶段拒绝一个入口的 `remoteProvides` 中重复的合同 id，让后续按 id 查到的声明天然唯一；激活校验与查询都使用这份唯一声明，再比较对象身份。无需另建版本目录或在查询时激活。加同 id、不同版本／调用方清单的重复声明被拒用例，核对不发布远程提供项。

### 4. 重要：多个正在停止的提供入口被查询当成唯一提供方，版本由登记顺序决定

- **严重程度**：重要；**类别**：正确性、查询合同与候选一致性。
- **位置**：`packages/nb-runtime/src/plugins/host.ts:678`（`#describeRemote` 的 680–689 行）；对应 `docs/specs/runtime/plugin-channel.md:108`、验收 22。
- **现象**：存活候选为空后，`#describeRemote` 从正在停止的候选数组直接取第一项，没有对这个数组做冲突核对。同一合同有两个正在停止的提供入口时，查询 v1 得到 `provided/stopping`，查询 v2 得到 `version-changed/version:1`；实际调用为 `unavailable`。
- **为什么是问题**：Spec 规定多个入口声明同一合同为 `unavailable`，并不允许在停止阶段按登记顺序挑选一个。两个提供方分别声明 v1、v2 时，返回“应改用版本 1”更是没有唯一依据；交换登记顺序就会改变查询版本。静态查询与调用因此没有采用一致的冲突规则。这是新增查询实现的遗漏，不重复上轮“停止中误判 missing”。
- **依据**：主审运行 `bun /tmp/claude-1000/-home-notnotype-CodeRepository-neuro-book/c38df555-3a36-49c9-bf4f-4027b5da6d32/scratchpad/omp-t61-impl/runtime-edges.ts`，退出 0。实验使用公开 `createApplication`、插件登记／激活与 `Scope.close()`；释放 Promise 闸门保持两个登记作用域处于 `stopping`。输出 `phases:["stopping","stopping"]`、`queriedV1:{ok:true,value:{status:"provided",state:"stopping"}}`、`queriedV2:{ok:true,value:{status:"version-changed",version:1}}`、`called:{ok:false,code:"unavailable"}`，没有直接调用私有查找函数。
- **建议改法**：先取得“存活优先、没有时取停止中”的唯一候选数组，再统一处理 0／1／多项；只有 1 项时才读合同与状态。让 `#lookupRemote` 与 `#describeRemote` 共用这个候选选择，避免两个分支分别实施冲突规则。验收加两个停止中入口（版本不同）的查询仍为 `unavailable`。

## 未发现问题的方面

- **通常的三阶段与路由两跳结算已落实。** 新增 ACK 丢失用例逐一覆盖直连、转发第一跳、转发第二跳，既断言写方法确已执行，也断言被切那一跳收到的 ACK 为 0；读请求的断开码按 ACK 前后区分。`phase-boundaries.ts` 另经真实 Application 核对：路由／目标在 ACK 前回复的 `not-provided`、`version-changed`、`denied`、`target-gone` 与已取消输入仍是确定失败；链路关闭／切断而关闭通知尚未到达时，写请求为 `unknown-outcome/disconnected`，读请求为 `unavailable/disconnected`，收到通知后的新请求为 `unavailable`。这些通过不覆盖第 1 项的发送期间重入。
- **普通同实例写请求的门面工厂重入修正有效。** 工厂同步停止调用方时返回 `cancelled`、写方法不执行；停止提供方时为 `unavailable`、新门面立即释放。`facade-cleanup.ts` 补测两端停止的两个先后顺序，均无写执行且返回的门面释放一次；工厂停一端后抛错，均记录 `facade-failed`，没有吞掉异常；提供方在订阅工厂停止时没有建立订阅或投递事件。第 2 项只指出调用方停止的订阅缺口，没有观察到永久泄漏或重复释放。
- **查询的正常寻址、状态与权限规则一致。** 既有合同测试覆盖服务端、绑定项目、另一客户端与同实例；查询不触发提供入口激活、不创建远程门面。`catalog-states.ts` 补测 `blocked`、`activating`、存活候选优先于停止中候选、没有远程节点，以及调用方种类拒绝先于版本回答。`phase-boundaries.ts` 验证停止接纳拒绝客户端的新查询，而项目成员仍可查询服务端；`{project}` 访问拒绝由既有路由测试覆盖。未记联系目标、未登记查询释放项从 `access()`／`#lookupProvider` 的代码确认。
- **唯一静态声明的合同对象同一性检查有效。** 既有新增用例拒绝同 id、不同版本的产出并返回输出阶段 `remote-contract-mismatch`。应用的 commands、Storage 等提供项复用其静态合同对象，未发现被新检查误拒；错误优先级为未声明／重复产出 `undeclared-remote`，随后对象不一致 `remote-contract-mismatch`，最后提供方位置不符 `remote-location-mismatch`。第 3 项是重复静态声明仍能绕过一致性保证的边界。
- **wire 4 升级与应用消费者没有另见错误。** 真实 Bun WebSocket 监听中，wire 3 hello 得到 `reject/wire-version`，正常关闭且未登记成员；wire 4 hello 得到 `welcome/wire:4`。应用与夹具从公开入口取版本，没有发现写死 3。浏览器将拒绝映射为 `incompatible`、停止重连并显示刷新操作，从代码确认；本次未运行浏览器。
- **应用的失败折算符合已接受的调整。** Storage 保留 `unknown-outcome`，`not-provided` 按领域折为 `unavailable`；store 的真实 Storage 链路测试覆盖结果未知后的重试与冲突处理。项目登记结果未知按计划仍折成命令 `unavailable`，文案如实说明结果未知；没有把此接受的取舍重新报成问题。项目登记按目录幂等由现有 `registry.test.ts` 断言支持，本次未单独运行该文件。
- **改动写法与范围检查。** 未发现本轮按错误文案分支、静默吞错、为通过测试放宽断言、产品中的测试专用分支、范围外源码删除、丢失原有清理语句或跨包深导入。进程内链路的 `cut()` 明确只用于测试入口，生产传输未加入测试条件。既有异常路径按错误类型生成诊断或按结构化失败码处理；诊断文案未参与程序分支。

## 本次验证

以下结果由主审实际执行；不把计划或旧证据的通过当作本次通过。四项问题的 scratch 脚本用于复现当前缺陷，退出 0 表示复现断言成立，不表示实现已修复。

仓库命令均从 `/home/notnotype/CodeRepository/neuro-book/.worktree/w00017-t61-impl-review` 执行；下表标出不同工作目录的命令。

| 命令 | 实际结果 |
|---|---|
| `bun install --frozen-lockfile --ignore-scripts` | 成功安装 1559 packages；3.17 秒；未运行 postinstall／build |
| `bun run --cwd packages/nb-runtime test` | **305 pass，0 fail**；2533 次断言，30 个文件 |
| `bun run --cwd packages/nb-runtime typecheck` | 退出 0；包括 browser 类型检查 |
| `bun run --cwd packages/neuro-book typecheck` | 退出 0；包括 web 与 browser-test 的 Vue 类型检查 |
| 在 `packages/neuro-book` 执行 `bun test ./src/plugins/commands/shared/remote.test.ts ./src/plugins/storage/storage.test.ts ./src/plugins/projects/projects.test.ts ./src/shared/store/store.test.ts` | **42 pass，0 fail**；352 次断言，4 个文件 |
| `bun /tmp/claude-1000/-home-notnotype-CodeRepository-neuro-book/c38df555-3a36-49c9-bf4f-4027b5da6d32/scratchpad/omp-t61-impl/runtime-edges.ts` | 退出 0；复现报告第 2、4 项，同时确认普通写请求修正有效 |
| `bun /tmp/claude-1000/-home-notnotype-CodeRepository-neuro-book/c38df555-3a36-49c9-bf4f-4027b5da6d32/scratchpad/omp-t61-impl/send-reentrant-cancel.ts` | 退出 0；复现报告第 1 项：确定 `cancelled` 后仍发送并写入 |
| 在 scratch 目录执行 `bun contract-identity.ts` | 退出 0；复现报告第 3 项：可用入口查询与调用采用不同版本 |
| 在 scratch 目录执行 `./node_modules/.bin/tsc --noEmit --strict --skipLibCheck --allowImportingTsExtensions --target ESNext --module ESNext --moduleResolution bundler --types bun contract-identity.ts` | 退出 0；重复声明实验没有类型强转或类型错误 |
| `bun /tmp/claude-1000/-home-notnotype-CodeRepository-neuro-book/c38df555-3a36-49c9-bf4f-4027b5da6d32/scratchpad/omp-t61-impl/phase-boundaries.ts` | 退出 0；确定拒绝、停止接纳／项目例外、关闭通知到达前后的读写结算符合合同 |
| `bun /tmp/claude-1000/-home-notnotype-CodeRepository-neuro-book/c38df555-3a36-49c9-bf4f-4027b5da6d32/scratchpad/omp-t61-impl/catalog-states.ts` | 退出 0；受阻／激活中、存活优先、权限优先、无远程节点符合合同 |
| 在 scratch 目录执行 `bun facade-cleanup.ts` | 退出 0；五个工厂停止／抛错／双方先后停止场景收口正常 |
| 在 scratch 目录执行 `bun wire-handshake.ts` | 退出 0；真实 WebSocket 拒绝 wire 3，接纳 wire 4 |
| `/usr/bin/git status --short --untracked-files=normal` | 无输出；审查 worktree 没有被跟踪文件改动或普通未跟踪文件 |

scratch 工作目录为 `/tmp/claude-1000/-home-notnotype-CodeRepository-neuro-book/c38df555-3a36-49c9-bf4f-4027b5da6d32/scratchpad/omp-t61-impl/`，脚本全部保留在该目录便于复现，未进入仓库。运行中修正过 scratch 夹具：换服务端 boot 后改用新客户端；不直接关闭借用着依赖的激活工作作用域；WebSocket 拓扑从 router 查询；诊断按 `reason` 字段核对。这些初次实验失败／超时未计为产品发现。

只读专项复核由 `ApplicationWire` 与 `SpecConsistency` 完成；它们未运行检查，发现仅在主审核实后计数。重复结论已合并。两个应用覆盖候选（项目结果未知分支、合成兼容拒绝帧）未单列为问题：前者未观察到行为缺陷，后者已补真实 wire 3／4 smoke。

## 未运行与证据边界

按任务限制，未运行 e2e、开发服务、真实浏览器旅程、真实 Provider／Model、全应用测试、lint、文档治理或生产构建；没有修改实现，所以也没有修复后验证或变异修改。真实 WebSocket smoke 使用独立的瞬时 RPC 监听，不启动应用开发服务。Spec 中引用的既有 Chrome／项目子进程证据仅审查其映射，不能视作本次重跑结果。查询 `closed` 状态未独立做成功 smoke；没有据此作正确性结论。

## 各级数量

阻断 **0**，重要 **4**，建议 **0**，合计 **4**。实施调整已落实的旧问题不重复报告；旧第 6 项的一致性修正仍有第 3 项的重复声明缺口。审查结果要求修正上述四项，再针对各自真实路径回归。

