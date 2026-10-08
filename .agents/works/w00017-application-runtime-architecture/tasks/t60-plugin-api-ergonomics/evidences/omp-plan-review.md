# w00017 t60 实施计划只读审查

审查对象：`.agents/works/w00017-application-runtime-architecture/tasks/t60-plugin-api-ergonomics/plan.md` 与同目录 `README.md`，固定提交 `8aa26b09`。只读取本审查 worktree；实验与报告写入指定 scratch 目录。

本报告随核实追加；收尾时按影响排序并补齐未发现问题的方面与数量。

## 发现：删除本地委托时仍须迁移签发记录的共享收口

- **严重程度**：重要；**类别**：不变量 / 实施遗漏。
- **位置**：`plan.md:27–28`；`packages/nb-runtime/src/services/composition.ts:596–610,656–669`；`src/services/contracts.ts:74–84,267–273`。
- **现象**：计划明确删除 `#releaseDelegated`，却只说保留签发记录和 `issuedTo`，没有说明共享收口迁往哪里。该函数同时负责远程委托的 `closed = true`、`closing.abort()` 和逆序执行 `attached`；它不是纯本地委托代码。
- **为什么是问题**：按字面删除整个函数及调用后，已释放门面的身份仍会通过 `#admitIssued`，远程访问挂上的释放步骤不会执行。调用方停止后的在途调用、订阅与服务端门面收口均依赖这段路径。只留下 `issuedTo` 的查询与挂载不能保留原不变量。
- **依据**：`composition.ts:334–340` 返回 `issue.closing.signal` 并追加 `issue.attached`；`#admitIssued` 在 374 行只靠 `issue.closed` 拒绝释放后身份；`host.ts:609–624` 用同一记录进行每次准入、取消及远程释放。远程测试 `src/remote/delegation.test.ts:213–265` 已有对应真实实例场景。这里是从现行代码核实的计划遗漏，不宣称实施者已写错代码。
- **建议改法**：删除 `delegated` 数组与本地分支，保留一个签发记录收口函数（可改名 `#closeIssued`）：在提供者的门面释放回调结束后设置 `closed`、触发 `closing`、逆序尝试全部 `attached`，并保留错误传播。把 `ServiceAccess.resolveFor` 与 `ServiceCreateContext.services` 的低层暴露也明确列入删除面；`IssuedConsumer.attach` 的文档去掉本地委托语义。S1 直接用既有远程委托寿命测试验收。

## 发现：S3 漏迁移工作台页面接收者

- **严重程度**：重要；**类别**：实施遗漏 / 切片可执行性。
- **位置**：`plan.md:42–46,137`；`packages/neuro-book/src/plugins/workbench/web/pages.ts:46–54`。
- **现象**：接收者改动表只列 HTTP、命令、menu 和公开状态，漏了 `PageTable.receiver()`；它仍在 `commit` 中把页面句柄加入挂载表。
- **为什么是问题**：删除 `ContributionReceiver.commit` 后，应用类型检查会直接失败；若机械移除回调而未改为 `published`，贡献页面（包括 `/lab`）不会进入页面表。推迟到 S6 才修改不能满足“每片可独立通过类型检查与测试”。
- **依据**：读取 `pages.ts`，其 48–50 行是实际的 `commit` 使用者；字面盘点 `packages/neuro-book/src` 与 `packages/nb-runtime/examples` 的接收者 commit 只有 HTTP、命令、PageTable、menu 四处，存储的 `commit(change)` 是另一个接口，不在删除面。
- **建议改法**：在 S3 加入 `PageTable.receiver()` 的 `commit → published` 迁移以及页面表/浏览器宿主既有测试；其 Map 写入同步且无否决条件，直接迁移即可，不加 `prepare` 或第二张暂存表。

## 发现：`defineEntry` 的四个声明泛型不能兑现非空对象的“键恰好一致”

- **严重程度**：重要；**类别**：类型合同 / 验收遗漏。
- **位置**：`plan.md:57–74,153`。
- **现象**：计划要求 `receivers` 和 `contributions` 的键恰好等于声明，但只描述按声明映射出期望返回类型。TypeScript 的返回值结构赋值允许额外属性：声明接收 `point` 却返回 `{point, extra}`，或声明 `point/one` 却返回 `point/{one, extra}`，均能通过此设计。把未声明那一类设为 `undefined` 只能拦住“完全没有声明却返回该类”，拦不住非空声明里的多写。
- **为什么是问题**：静态核对承诺与实际类型能力不符。多写接收者仍到首次激活才得到 `undeclared-receiver`；多写贡献实现更弱，现行运行期只遍历静态贡献查缺失，不检查额外的实现键（`host.ts:1121–1144`）。计划的验收表只列漏写贡献实现，没有多写反例。
- **依据**：在指定 scratch 下按计划公开形状构造 `entry-types.ts`，使用本 worktree 的 TypeScript `6.0.3`。最终小样让未声明类别为 `undefined`、非空类别必需，声明元组并集使用非分配条件；给数组显式 `as const` 后，同步、异步、条件入口与简化分区入口没有诊断。非空接收者/贡献的多写反例的 `@ts-expect-error` 均报告 TS2578（未使用）。这是对计划形状的可重跑实验，不是对尚未实现的 `define.ts` 的判定。
- **建议改法**：若保留“键恰好一致”，需要捕获激活函数实际返回类型，再对 `Awaited<ReturnType<...>>` 的接收者键、贡献点键及点内贡献 id 做额外键检查，而不只把它赋给映射类型。补上非空声明下的多写、从变量/辅助函数返回对象的反例。若不值得增加这部分类型复杂度，明确缩小静态保证为“必需项齐全 + 类型相容”，准确说明哪些由运行期核对；同时把额外贡献实现的现行行为说清，不能声称运行期全兜底。

## 发现：入口辅助函数的宽类型会挡住 S6，需加入正例与迁移步骤

- **严重程度**：建议；**类别**：写法 / 类型验收。
- **位置**：`plan.md:65–74,110,140,153`；`packages/neuro-book/src/plugins/commands/shared/plugin.ts:105,133–153`；`src/plugins/diagnostics/backend/plugin.ts:31–44,79–95`。
- **现象**：现有 `remoteCommands()` 显式返回未带合同参数的 `RemoteProvision`；后端诊断插件从 `PluginDefinition.entries` 取宽类型的 `baseEntry`，并经返回 `ActivationOutput` 的辅助函数改写服务。计划只写“全部入口改用 defineEntry”，没有迁移这些擦除后的返回类型。
- **为什么是问题**：一旦提供项保留类型参数，宽 `RemoteProvision` 无法赋给具体合同元组；宽 `ActivationOutput` 的任意数组也无法保证固定提供项与禁用类别。只在入口外套 `defineEntry` 会误报合法现有入口；为了通过而加断言又会撤销静态保证。
- **依据**：scratch 小样中，`remoteHelper(): RemoteProvision` 的旧注解导致 TS2322，改为 `RemoteProvision<typeof remote>` 后消失。加入“未声明类别禁用、非空类别必需”后，条件类型令同步/async 字面量数组丢失元组上下文；最终以显式 `as const` 和对远程声明元组并集的非分配条件隔离了问题，正例仅剩预期反例的 TS2578。最初的全 optional 版本能直接推导数组，但不满足缺项保证，不能作为完成的设计证明。真实 `partitionEntry` 的两份合同形状不同；小样只验证了简化的分支结构。
- **建议改法**：保留推导或给辅助函数精确的合同参数；诊断插件在内核工厂边界保留精确入口/产出类型，使桥接只装饰释放回调而不擦除元组。加入不靠类型断言的同步字面量、async、真实 `commandsEntry(location)`、真实 `partitionEntry`、包装已有入口的编译成功正例；核对禁用类别的条件类型与声明元组并集是否保留元组上下文。必要的 `as const` 要在作者写法里明确，不能只用全 optional 小样声称普通写法成立。不要复制多个入口或用 `as ActivationOutput` 绕过。

## 发现：逐片提交后，S7 的默认 `test:affected` 不会运行本 Task 的测试

- **严重程度**：重要；**类别**：验收。
- **位置**：`plan.md:21,130,141,161`；`scripts/ci/test-affected.ts:100–123,226–227`；`scripts/ci/change-scope.ts:74–89`。
- **现象**：计划每片验证后单独提交，收口却执行未给基准的 `bun run test:affected --typecheck`。该命令默认只按未提交改动选包；S1–S6 全部提交后，S7 剩余 Task/Spec 证据文件不选中内核与应用，命令可成功退出且没有运行任何 typecheck 或测试。
- **为什么是问题**：收口证据会把空选集当作完成检验；示例与产品整合后的测试并没有由这条命令覆盖。每片的有效验证可以保留，但不能把这条命令当最终整合门禁。
- **依据**：在固定计划提交的干净审查 worktree 实际执行 `bun run test:affected --typecheck --dry-run`，输出 `改动文件 0 个（未提交的改动）。没有要运行的测试。`，退出码 0。实现按 `changedFiles(repoRoot, since?)` 取范围，缺 `since` 不看已提交改动。
- **建议改法**：S7 显式写 `bun run test:affected --typecheck --since 8aa26b09`，或指定 `--package nb-runtime --with-consumers`；docs/governance 若要逐条展示本 Task 的已提交警告，也用同一 `--since` 基准。每片不必扩大验证，最终核对实际选中项。

## 发现：类型上的提供项参数只保服务形状，不能核对服务与合同的 id

- **严重程度**：建议；**类别**：类型合同边界。
- **位置**：`plan.md:19,66–72,163`；`packages/nb-runtime/src/services/contracts.ts:18–20`；`src/remote/contract.ts:60–73,82–93`。
- **现象**：`ServiceKey<T>` 的 `name` 与 `RemoteContract` 的 `id` 都是 `string`。两个不同 id 若具有相同服务类型或相同合同形状，类型层无法区分。按顺序元组与 `ProvidedService<T>` / `RemoteProvision<Contract>` 仍会接受“声明 A、产出同形 B”。
- **为什么是问题**：计划以“静态声明与激活产出不一致时编译期报错”作为期望，风险只提错误文案与条件入口，却没有列这项必然的静态边界；作者会以为恒等函数已经前移全部 runtime 核对。现行 `missing-service`、`undeclared-remote` 等运行期核对仍必不可少。
- **依据**：最终 scratch 小样中，同服务类型不同 id、同合同方法形状不同 id 的两个反例同样得到 TS2578，合法正例没有其它诊断。类型定义公开暴露 string id，因此无需以品牌断言推测。
- **建议改法**：最少部件的做法是保留当前键与合同设计，在合同和计划里准确写静态保证为“项数、服务类型/合同形状、可静态推导的声明键”，注明身份仍由 runtime 按 id 核对；不要声称全部不一致都前移。若要连 id 也保证，需要另行让键和合同保留字面量 id 泛型，属于更大的接口改动，不应暗中加入 S4。

## 发现：补交的“prepare 成功立即 published”漏掉整批屏障与失败隔离

- **严重程度**：重要；**类别**：交付事务 / 验收遗漏。
- **位置**：`plan.md:40,152`；`docs/specs/runtime/plugins.md:70,138,174`；`packages/nb-runtime/src/plugins/host.ts:1261–1295,1427–1476`。
- **现象**：计划与验收把补交写成 `prepare` 成功后立即 `published`，未限定为“同一贡献方代次的整批 prepare 全部成功后”；同时把 `prepare` 抛错一概描述为激活失败，没保留补交失败只标记该批、两侧激活结果不变的区别。
- **为什么是问题**：贡献方已经发布时，若按单项 `prepare → published` 循环，第一项已进命令/路由表、可触发外部副作用，第二项 `prepare` 再失败就已经破坏整批交付门禁。补交发生在拥有者发布前，不能因此让拥有者激活失败。删除 `commit` 可以成立，删除整批屏障不成立。
- **依据**：现行交付先整批准备，再设置交付可用并通知；真实 host 的 `real-delivery.ts` 第二场景用已发布贡献方的 a、b 两项补交，b 的 `prepare` 拒绝，事件只有 `prepare:a`、`prepare:b`、`revoke:a:delivery-failed`，没有 `published:a`，两侧仍 available。现有 owner-contribution-points 测试场景 7 也锁定整批补交与失败隔离，但其失败点在将被删除的 commit，需要迁往第二项 prepare。
- **建议改法**：明确两种路径共用“整批 prepare → 完成后的存活检查 → 整批交付就绪”的屏障；激活路径等贡献方发布再逐项通知，补交路径在整批成功后同步通知。补交准备失败逆序撤回已准备项，记录 delivery-failed/backfill-failed，两侧仍成功。保留每连接账本、排序锁、准备完成标记和撤回前置标志；去掉 commit 循环即可，不新增第二套事务。

## 发现：HTTP“同一插件第二次挂载被 prepare 拒绝”不是完整内核可产生的验收场景

- **严重程度**：建议；**类别**：验收模型 / 可简化之处。
- **位置**：`plan.md:14,43,152`；`packages/neuro-book/src/plugins/http/backend/dispatch.ts:23–26,41–47`；`dispatch.test.ts:23–50,104–108`。
- **现象**：现有路由表测试直接构造句柄并调用接收者，确实能打到重复挂载的 prepare；但合法 `http.routes` 贡献 id 必须等于插件 id，同一插件两个入口提交同 id 会先被内核判为 `duplicate-contribution`，不会进入接收者。
- **为什么是问题**：计划把这个防御性分支当作唯一需要否决激活的真实产品场景，验收又要求使用真实内核依赖；照此安排的集成测试到不了声明的 prepare 拒绝路径。删 commit 的方向仍成立，只是这条证明选错了层级。
- **依据**：`real-delivery.ts` 第一个真实 host 场景登记 RouteTable 接收者与同插件两个路由入口；实际输出为两条 `duplicate-contribution`、两个入口 activated、prepare 调用 0 次、没有挂载。`validateRouteContribution` 排除了用两个不同合法贡献 id 绕过该冲突；整个定义第二次登记又会先被 `duplicate-plugin` 拒绝。
- **建议改法**：真实内核验收应写“两条重复路由都不挂载”；prepare 否决与逆序撤回由自定义贡献点的真实内核场景验证。若保留 RouteTable 的重复预占保护，明确它是单独边界防御测试；若只考虑当前完全受内核管理的入口，可以评估删除 HTTP 的 pending Set 与 prepare，直接在 published 挂载、revoke 摘下，少一张状态表。该精简是建议，不要求超出批准范围实施。

## 发现：可选功能的“远程调用失败即不在”会错误解释协议失败

- **严重程度**：重要；**类别**：作者规则 / 失败语义。
- **位置**：`plan.md:88,121,167`；`docs/specs/runtime/plugin-channel.md:70–78,142–146`；`packages/nb-runtime/src/remote/protocol.ts:21–55`。
- **现象**：拟补的可选功能章节把远程服务写成“远程调用失败即不在”。现行远程失败不只有没有提供者，还包括输入错误、被拒、版本不符、提供方错误，以及已派发写请求结果不确定的 `unknown-outcome`。
- **为什么是问题**：按这条规则写出的插件会把真实缺陷和拒绝静默降级成“未安装功能”；已派发写请求甚至可能已经成功，不能据此宣称目标不在或触发另一条写路径。这与第 6 节明确保留 `unknown-outcome` 的含义矛盾，也会提前声称后续 `not-provided` 尚未实现的能力。
- **依据**：协议分别定义上述失败码，`failureFor("dispatched", "write", cause)` 始终给 `unknown-outcome`；已接受的 Spec 明确 ACK 不能证明没有副作用、失败不自动重放。`orThrow` 小样也原样保留 `{code: "unknown-outcome", cause: "timeout"}`，取值工具不会改变分类。
- **建议改法**：改成“远程可选功能直接尝试调用；不可达或暂不可用时按领域降级，当前不能精确判断未安装；其它失败按各自合同处理，unknown-outcome 交给写入方核对”。不新增目录、探测 API 或失败码，保留已批准的后续边界。

## 发现：S0 的改动表不足以收敛作者规则，遗漏 ADR 与运行时合同值的导入规则

- **严重程度**：重要；**类别**：文档覆盖 / 公开 API 合同。
- **位置**：`plan.md:10,92,113–134`；`docs/adr/0024-multi-instance-runtime-topology.md:35–37`；`docs/specs/runtime/plugin-api.md:33–35,65,77,124,132`；`docs/specs/runtime/plugin-channel.md:84–86`。
- **现象**：目标说取代三处互相不一致的选用规则，S0 却没列 ADR 0024；按表实施后它仍要求“同一实例内用本地服务”。作者 API 还要求其它插件的接口只用 `import type`、构建后不留运行时引用，这不能提供 `context.remote.use(合同)` 所需的合同值。表中只点名改 defineEntry 的字段名，未覆盖上下文/命令用法与验收里残留的 `requires` 和字符串服务 id；远程委托段仍把核对规则指向将删除的 services 输出第 13 条。
- **为什么是问题**：这是该任务要解决的写法冲突本身，不能靠文档检查发现：链接合法、字段仍是可读文本，但作者照另一份规范就会继续包本地服务、只发布类型或写旧入口。planned 状态并不取消这些已接受的接口规则。
- **依据**：逐处读取上述活跃文档；ADR 0024 仍为 accepted，S0/S7 的文档列表只有 7 份 Spec 与示例 README。新方案明确合同仍为 TypeBox 值、声明也直接写合同对象，类型导入不会在运行时留下对象。`require` 现行参数为服务键对象，未声明键抛 PluginStateError，与旧 SDK 字符串/结构化失败表述不同。
- **建议改法**：S0 加一条对 ADR 0024 第 4 条的补充决策或明确修订引用，保留历史批准依据；明确“可导入无副作用的公开合同/键值，不导入提供方实现、宿主内部模块”，并给类型与值各一例。把 plugin-api 的上下文、命令用法、错误与对应验收同步到本地 require/resolve 的现行合同；plugin-channel 的远程委托核对直接引用保留的签发记录规则。清单 JSON 的 requires/contributes 可按其 planned 映射保留，不把源码与 JSON 字段混成一套。
