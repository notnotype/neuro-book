# w00017 t60 实施计划只读审查

审查对象：`.agents/works/w00017-application-runtime-architecture/tasks/t60-plugin-api-ergonomics/plan.md` 与同目录 `README.md`，固定提交 `8aa26b09`。审查根为 `/home/notnotype/CodeRepository/neuro-book/.worktree/w00017-t60-plan-review`；完整仓库相对路径以该根解析，省略包前缀的源码引用承接同段的包。只读取此 worktree，实验与报告仅写入指定 scratch；除安装依赖外，未修改仓库源码、计划或规范文件，未提交或操作其他工作树。

结论：已批准的精简方向可以保留；计划需要补齐签发收口、整批补交屏障、接收者删除面、类型保证边界、命令诊断与作者文档，才能按字面实施和验收。发现按影响排序：设计与遗漏在前、写法与验收建议在后。阻断 0 条、重要 8 条、建议 4 条，共 12 条；重要表示实施前需要修订的具体合同或步骤，未把尚未存在的实现判为故障。

## 发现：删除本地委托时仍须迁移签发记录的共享收口

- **严重程度**：重要；**类别**：不变量 / 实施遗漏。
- **位置**：`plan.md:27–28`；`packages/nb-runtime/src/services/composition.ts:596–610,656–669`；`src/services/contracts.ts:74–84,267–273`。
- **现象**：计划明确删除 `#releaseDelegated`，却只说保留签发记录和 `issuedTo`，没有说明共享收口迁往哪里。该函数同时负责远程委托的 `closed = true`、`closing.abort()` 和逆序执行 `attached`；它不是纯本地委托代码。
- **为什么是问题**：按字面删除整个函数及调用后，已释放门面的身份仍会通过 `#admitIssued`，远程访问挂上的释放步骤不会执行。调用方停止后的在途调用、订阅与服务端门面收口均依赖这段路径。只留下 `issuedTo` 的查询与挂载不能保留原不变量。
- **依据**：`composition.ts:334–340` 返回 `issue.closing.signal` 并追加 `issue.attached`；`#admitIssued` 在 374 行只靠 `issue.closed` 拒绝释放后身份；`host.ts:609–624` 用同一记录进行每次准入、取消及远程释放。远程测试 `src/remote/delegation.test.ts:213–265` 已有对应真实实例场景。这里是从现行代码核实的计划遗漏，不宣称实施者已写错代码。
- **建议改法**：删除 `delegated` 数组与本地分支，保留一个签发记录收口函数（可改名 `#closeIssued`）：在提供者的门面释放回调结束后设置 `closed`、触发 `closing`、逆序尝试全部 `attached`，并保留错误传播。把 `ServiceAccess.resolveFor` 与 `ServiceCreateContext.services` 的低层暴露也明确列入删除面；`IssuedConsumer.attach` 的文档去掉本地委托语义。S1 直接用既有远程委托寿命测试验收。

## 发现：补交的“prepare 成功立即 published”漏掉整批屏障与失败隔离

- **严重程度**：重要；**类别**：交付事务 / 验收遗漏。
- **位置**：`plan.md:40,152`；`docs/specs/runtime/plugins.md:70,138,174`；`packages/nb-runtime/src/plugins/host.ts:1261–1295,1427–1476`。
- **现象**：计划与验收把补交写成 `prepare` 成功后立即 `published`，未限定为“同一贡献方代次的整批 prepare 全部成功后”；同时把 `prepare` 抛错一概描述为激活失败，没保留补交失败只标记该批、两侧激活结果不变的区别。
- **为什么是问题**：贡献方已经发布时，若按单项 `prepare → published` 循环，第一项已进命令/路由表、可触发外部副作用，第二项 `prepare` 再失败就已经破坏整批交付门禁。补交发生在拥有者发布前，不能因此让拥有者激活失败。删除 `commit` 可以成立，删除整批屏障不成立。
- **依据**：现行交付先整批准备，再设置交付可用并通知；真实 host 的 `real-delivery.ts` 第二场景用已发布贡献方的 a、b 两项补交，b 的 `prepare` 拒绝，事件只有 `prepare:a`、`prepare:b`、`revoke:a:delivery-failed`，没有 `published:a`，两侧仍 available。现有 owner-contribution-points 测试场景 7 也锁定整批补交与失败隔离，但其失败点在将被删除的 commit，需要迁往第二项 prepare。
- **建议改法**：明确两种路径共用“整批 prepare → 完成后的存活检查 → 整批交付就绪”的屏障；激活路径等贡献方发布再逐项通知，补交路径在整批成功后同步通知。补交准备失败逆序撤回已准备项，记录 delivery-failed/backfill-failed，两侧仍成功。保留每连接账本、排序锁、准备完成标记和撤回前置标志；去掉 commit 循环即可，不新增第二套事务。

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

## 发现：命令求值只返回首个错误文案，不能直接兑现按（命令，键）诊断

- **严重程度**：重要；**类别**：求值接口 / 验收遗漏。
- **位置**：`plan.md:35,151,169`；`packages/neuro-book/src/plugins/commands/shared/context-keys.ts:18,35–53`；`registry.ts:181–185`；`workbench/web/components/WorkbenchCommandPalette.vue:48`。
- **现象**：计划以“evaluateContextWhen 已调 validateWhen”为依据，把坏键核对从登记移到求值，并要求按（命令，键）各记一次。现行 helper 遇第一条坏键即返回 `{ok: false, reason}`，没有结构化键，也不访问后续坏键；命令表的 availability 直接转交这个结果，未记诊断。现行面板又会过滤所有不可用命令，因此计划风险里的“面板里显示不可用”也不成立。
- **为什么是问题**：只去掉登记期核对并在 availability 的失败分支记日志，无法稳定按键去重，只能依赖解析文案；同命令多个坏键会只暴露首项，其余永远未查，面板隐藏又使用户难以发现拼错。通过一个未声明键的测试不足以证明计划的诊断保证。
- **依据**：真实 `evaluateContextWhen` 的 scratch 调用传入两个未声明键，实际只访问 a，返回 reason 文案且无 key 字段。源码确认命令面板、键位、isEnabled、执行和远程 list 都共用 registry 可用性求值。公开状态 declaration() 先读响应式 bindings.get(key)，后来绑定使 computed 失效的链路已具备，不需要另加事件总线。
- **建议改法**：在命令表求值边界逐键取得 `problem(key)`，以现成的 key 和命令 id 去重并诊断，再求值合法键；或让纯求值结果携带结构化坏键集合。不要解析文案、重复核对或给每个界面另加诊断。补两个坏键、同键被两条命令引用、反复从列表/执行求值不重复、键后来声明且绑定后恢复的测试；保持现行面板过滤，把风险文案改为“面板隐藏，诊断与 isEnabled/远程 list 原因可查”。

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
- **依据**：逐处读取上述活跃文档；ADR 0024 仍为 accepted，S0/S7 的文档列表只有 7 份 Spec 与示例 README。新方案明确合同仍为 TypeBox 值、声明也直接写合同对象，类型导入不会在运行时留下对象。`require` 现行参数为服务键对象，未声明键抛 TypeError，与旧 SDK 字符串/结构化失败表述不同。
- **建议改法**：S0 加一条对 ADR 0024 第 4 条的补充决策或明确修订引用，保留历史批准依据；明确“可导入无副作用的公开合同/键值，不导入提供方实现、宿主内部模块”，并给类型与值各一例。把 plugin-api 的上下文、命令用法、错误与对应验收同步到本地 require/resolve 的现行合同；plugin-channel 的远程委托核对直接引用保留的签发记录规则。清单 JSON 的 requires/contributes 可按其 planned 映射保留，不把源码与 JSON 字段混成一套。

## 发现：逐片提交后，S7 的默认 `test:affected` 不会运行本 Task 的测试

- **严重程度**：重要；**类别**：验收。
- **位置**：`plan.md:21,130,141,161`；`scripts/cli/test-affected.ts:100–123,226–227`；`scripts/ci/change-scope.ts:74–89`。
- **现象**：计划每片验证后单独提交，收口却执行未给基准的 `bun run test:affected --typecheck`。该命令默认只按未提交改动选包；S1–S6 全部提交后，S7 剩余 Task/Spec 证据文件不选中内核与应用，命令可成功退出且没有运行任何 typecheck 或测试。
- **为什么是问题**：收口证据会把空选集当作完成检验；示例与产品整合后的测试并没有由这条命令覆盖。每片的有效验证可以保留，但不能把这条命令当最终整合门禁。
- **依据**：在固定计划提交的干净审查 worktree 实际执行 `bun run test:affected --typecheck --dry-run`，输出 `改动文件 0 个（未提交的改动）。没有要运行的测试。`，退出码 0。实现按 `changedFiles(repoRoot, since?)` 取范围，缺 `since` 不看已提交改动。
- **建议改法**：S7 显式写 `bun run test:affected --typecheck --since 8aa26b09`，或指定 `--package nb-runtime --with-consumers`；docs/governance 若要逐条展示本 Task 的已提交警告，也用同一 `--since` 基准。显式选包的 dry-run 已实测选中 nb-runtime 的 typecheck/test 与 neuro-book 的 typecheck/test:bun/test:vitest；未运行这些全量命令。

## 发现：入口辅助函数的宽类型会挡住 S6，需加入正例与迁移步骤

- **严重程度**：建议；**类别**：写法 / 类型验收。
- **位置**：`plan.md:65–74,110,140,153`；`packages/neuro-book/src/plugins/commands/shared/plugin.ts:105,133–153`；`src/plugins/diagnostics/backend/plugin.ts:31–44,79–95`。
- **现象**：现有 `remoteCommands()` 显式返回未带合同参数的 `RemoteProvision`；后端诊断插件从 `PluginDefinition.entries` 取宽类型的 `baseEntry`，并经返回 `ActivationOutput` 的辅助函数改写服务。计划只写“全部入口改用 defineEntry”，没有迁移这些擦除后的返回类型。
- **为什么是问题**：一旦提供项保留类型参数，宽 `RemoteProvision` 无法赋给具体合同元组；宽 `ActivationOutput` 的任意数组也无法保证固定提供项与禁用类别。只在入口外套 `defineEntry` 会误报合法现有入口；为了通过而加断言又会撤销静态保证。
- **依据**：scratch 小样中，`remoteHelper(): RemoteProvision` 的旧注解导致 TS2322，改为 `RemoteProvision<typeof remote>` 后消失。加入“未声明类别禁用、非空类别必需”后，条件类型令同步/async 字面量数组丢失元组上下文；最终以显式 `as const` 和对远程声明元组并集的非分配条件隔离了问题，正例仅剩预期反例的 TS2578。最初的全 optional 版本能直接推导数组，但不满足缺项保证，不能作为完成的设计证明。真实 `partitionEntry` 的两份合同形状不同；小样只验证了简化的分支结构。
- **建议改法**：保留推导或给辅助函数精确的合同参数；诊断插件在内核工厂边界保留精确入口/产出类型，使桥接只装饰释放回调而不擦除元组。加入不靠类型断言的同步字面量、async、真实 `commandsEntry(location)`、真实 `partitionEntry`、包装已有入口的编译成功正例；核对禁用类别的条件类型与声明元组并集是否保留元组上下文。必要的 `as const` 要在作者写法里明确，不能只用全 optional 小样声称普通写法成立。不要复制多个入口或用 `as ActivationOutput` 绕过。

## 发现：类型上的提供项参数只保服务形状，不能核对服务与合同的 id

- **严重程度**：建议；**类别**：类型合同边界。
- **位置**：`plan.md:19,66–72,163`；`packages/nb-runtime/src/services/contracts.ts:18–20`；`src/remote/contract.ts:60–73,82–93`。
- **现象**：`ServiceKey<T>` 的 `name` 与 `RemoteContract` 的 `id` 都是 `string`。两个不同 id 若具有相同服务类型或相同合同形状，类型层无法区分。按顺序元组与 `ProvidedService<T>` / `RemoteProvision<Contract>` 仍会接受“声明 A、产出同形 B”。
- **为什么是问题**：计划以“静态声明与激活产出不一致时编译期报错”作为期望，风险只提错误文案与条件入口，却没有列这项必然的静态边界；作者会以为恒等函数已经前移全部 runtime 核对。现行 `missing-service`、`undeclared-remote` 等运行期核对仍必不可少。
- **依据**：最终 scratch 小样中，同服务类型不同 id、同合同方法形状不同 id 的两个反例同样得到 TS2578，合法正例没有其它诊断。类型定义公开暴露 string id，因此无需以品牌断言推测。
- **建议改法**：最少部件的做法是保留当前键与合同设计，在合同和计划里准确写静态保证为“项数、服务类型/合同形状、可静态推导的声明键”，注明身份仍由 runtime 按 id 核对；不要声称全部不一致都前移。若要连 id 也保证，需要另行让键和合同保留字面量 id 泛型，属于更大的接口改动，不应暗中加入 S4。

## 发现：HTTP“同一插件第二次挂载被 prepare 拒绝”不是完整内核可产生的验收场景

- **严重程度**：建议；**类别**：验收模型 / 可简化之处。
- **位置**：`plan.md:14,43,152`；`packages/neuro-book/src/plugins/http/backend/dispatch.ts:23–26,41–47`；`dispatch.test.ts:23–50,104–108`。
- **现象**：现有路由表测试直接构造句柄并调用接收者，确实能打到重复挂载的 prepare；但合法 `http.routes` 贡献 id 必须等于插件 id，同一插件两个入口提交同 id 会先被内核判为 `duplicate-contribution`，不会进入接收者。
- **为什么是问题**：计划把这个防御性分支当作唯一需要否决激活的真实产品场景，验收又要求使用真实内核依赖；照此安排的集成测试到不了声明的 prepare 拒绝路径。删 commit 的方向仍成立，只是这条证明选错了层级。
- **依据**：`real-delivery.ts` 第一个真实 host 场景登记 RouteTable 接收者与同插件两个路由入口；实际输出为两条 `duplicate-contribution`、两个入口 activated、prepare 调用 0 次、没有挂载。`validateRouteContribution` 排除了用两个不同合法贡献 id 绕过该冲突；整个定义第二次登记又会先被 `duplicate-plugin` 拒绝。
- **建议改法**：真实内核验收应写“两条重复路由都不挂载”；prepare 否决与逆序撤回由自定义贡献点的真实内核场景验证。若保留 RouteTable 的重复预占保护，明确它是单独边界防御测试；若只考虑当前完全受内核管理的入口，可以评估删除 HTTP 的 pending Set 与 prepare，直接在 published 挂载、revoke 摘下，少一张状态表。该精简是建议，不要求超出批准范围实施。

## 发现：S5 的直连示例需保留调用方入口拥有订阅的说明

- **严重程度**：建议；**类别**：示例教学 / 生命周期验收。
- **位置**：`plan.md:99–106,156`；`packages/nb-runtime/examples/plugins/counter/web/plugin.ts:2–5`；`examples/scenarios/04-remote-service.test.ts:27–33`、`06-project-instance.test.ts:46–59`。
- **现象**：删掉浏览器包装后，订阅从包装入口迁给探针入口；当前场景 4 演示收到事件，场景 6 演示提供方项目停止，但计划的示例验收只点名直调与身份，没有保留“订阅随发起调用的入口代次结束”的说明或验收依据。
- **为什么是问题**：直接把 context.remote 交给场景后，作者容易误认为寿命属于场景函数或提供方。原包装注释明确过调用方停止时收口，删除它需要迁移这条教学语义。当前内核行为已有合同测试，不是新的运行时缺陷，因此列为建议。
- **依据**：`host.ts:568–585` 把 remote access 的停止信号与释放登记绑定到发起入口；`src/remote/routing.test.ts:523–568` 已分别覆盖主动 release 的 abort/迟到事件丢弃、提供方停止、订阅方入口停止后的 abort 与门面释放。现有场景 6 的 provider-stopped 不等价于调用方停止。
- **建议改法**：S5 的探针与 README 明确订阅随探针入口代次结束，并引用现有 routing 合同测试；若需示例本身证明，再加停止调用方后观察提供方 abort、事件不再送达的场景。调用方主动 release 不触发 onEnd，不把它误当判据。无需再建本地服务包装。

## 未发现问题的方面

- **本地委托删除的方向**：产品与示例未找到本地 `resolveFor`、`delegates` 的直接或间接消费者；`cloud-notes` 与产品 Storage 消费的是保留的 `remote.on`、`remoteDelegates`。签发收口迁移明确后，可以删除本地专属数组、解析路径与测试，不需要兼容层。
- **跨点校验的精简方向**：除命令登记期查公开键外，HTTP、页面、公开状态的校验只看自身。保留 `ActivationContext.declarations` 足够服务公开状态的 accepted + location 查询；删除校验栈与跨点查询不需要建立第二套索引或事件机制。
- **公开状态与命令恢复**：`state.declaration()` 先读响应式 Map，`published` 的绑定与 `revoke` 的删除能使已有 computed 重新求值。仅向非响应式内核目录登记声明不承诺自动刷新；计划要求“后来声明并就绪”时恢复，绑定路径与该要求相容。此结论从代码推断，本审查没有执行未来 S2 的动态登记场景。
- **命令的共同边界**：产品面板、键位分发、isEnabled、执行与远程 list/execute 都经同一 registry 可用性路径；Lab 的注册/执行同样如此，检视器另外直接求值用于展示。诊断放在命令表边界即可统一，不必把报告副作用塞进公开状态服务。
- **去掉 commit 的方向**：挂载/登记改到同步 published 能避免最终激活失败的入口短暂对外出现；当前锁、交付账本、完成标记、存活检查、逆序撤回与通知去重不依赖保留 commit 回调。必须保留上文列出的整批屏障和寿命边界。published 异常只诊断、不否决的旧合同无需改变。
- **合同对象声明**：内核最终仍按合同 id 核对前缀、重复与提供项一致性；目录和诊断继续给 id，清单 JSON 装载继续另开。代码对象与 JSON id 的区分成立。
- **orThrow / RemoteCallError**：新工具可在成功时返回原值、失败时保留原 RemoteFailure 引用，独立覆盖路由失败、带 cause 的 unknown-outcome 与业务失败。failure 字段避免与 Error.cause 的语义冲突；客户端返回合同无需改变。scratch 形状烟测与类型检查通过，尚未验证未来包导出的实现。
- **示例与规则代价**：counter/board 直调合同能去掉重复接口和原样转发，并使身份归实际发起入口；场景 6 已有项目隔离、无绑定失败、provider-stopped、target-gone 与 project-gone 演示。cloud-notes/Storage 的选路和身份代理不是原样包装，保留合理。远程合同公开、需处理版本变化的代价已在计划第 171 行列出，无需重新议价。
- **范围与切片**：S1–S3 精简、S4 API 类型与取值工具、S5 示例、S6 产品迁移的顺序有真实依赖；每片同时迁移受影响消费者可以独立编译。已明确把目录/not-provided 放后续、角色匹配只写设计，不需要提前实现 TUI。README 的目标与边界和计划一致，未另发现 Task 元数据问题。

## 已执行验证与限制

所有命令从审查根执行；以下基线通过只证明 `8aa26b09` 的当前行为，不证明拟议改动已通过。

| 实际命令 | 结果与覆盖 |
|---|---|
| `prox bun install --frozen-lockfile --ignore-scripts` | 退出 0，安装 1559 packages；不执行 postinstall 构建。 |
| `packages/nb-runtime/node_modules/.bin/tsc --version` | `Version 6.0.3`，类型小样使用此版本。 |
| `bun run --cwd packages/nb-runtime typecheck` | 退出 0；执行 `tsc --noEmit && tsc --noEmit -p tsconfig.browser.json`。 |
| `bun run --cwd packages/nb-runtime test src/remote/delegation.test.ts src/plugins/owner-contribution-points.test.ts src/plugins/declarations.test.ts` | 31 pass，0 fail，247 expect() calls；远程身份与寿命、贡献事务/补交、声明查询基线。 |
| `bun run --cwd packages/neuro-book test:bun src/plugins/commands/shared/context-keys.test.ts src/plugins/commands/shared/registry.test.ts src/plugins/commands/shared/plugin.test.ts src/plugins/commands/shared/remote.test.ts src/plugins/http/backend/dispatch.test.ts` | 50 pass，0 fail，261 expect() calls；命令各边界与 HTTP 分发基线。 |
| `bun run --cwd packages/nb-runtime test examples/scenarios/04-remote-service.test.ts examples/scenarios/05-delegating-proxy.test.ts examples/scenarios/06-project-instance.test.ts` | 6 pass，0 fail，44 expect() calls；远程服务、代理身份、项目绑定与结束基线。 |
| `bun run test:affected --typecheck --dry-run` | 退出 0，`改动文件 0 个（未提交的改动）。没有要运行的测试。` |
| `bun run test:affected --typecheck --package nb-runtime --with-consumers --dry-run` | 退出 0，实际选中 nb-runtime 与 neuro-book 两项，包含内核 typecheck/test 与应用 typecheck/test:bun/test:vitest；只核对选择，没有运行全量。 |

临时实验保留在本报告同目录。以下为可原样重跑的命令：

```sh
bun /tmp/claude-1000/-home-notnotype-CodeRepository-neuro-book/c38df555-3a36-49c9-bf4f-4027b5da6d32/scratchpad/omp-t60-plan/real-delivery.ts
bun /tmp/claude-1000/-home-notnotype-CodeRepository-neuro-book/c38df555-3a36-49c9-bf4f-4027b5da6d32/scratchpad/omp-t60-plan/when-issues.ts
bun /tmp/claude-1000/-home-notnotype-CodeRepository-neuro-book/c38df555-3a36-49c9-bf4f-4027b5da6d32/scratchpad/omp-t60-plan/result-shape.ts
packages/nb-runtime/node_modules/.bin/tsc --noEmit --strict --skipLibCheck --target ES2022 --module ESNext --moduleResolution bundler --typeRoots /home/notnotype/CodeRepository/neuro-book/.worktree/w00017-t60-plan-review/node_modules/@types --types bun /tmp/claude-1000/-home-notnotype-CodeRepository-neuro-book/c38df555-3a36-49c9-bf4f-4027b5da6d32/scratchpad/omp-t60-plan/entry-types.ts
packages/nb-runtime/node_modules/.bin/tsc --noEmit --strict --skipLibCheck --target ES2022 --module ESNext --moduleResolution bundler --typeRoots /home/notnotype/CodeRepository/neuro-book/.worktree/w00017-t60-plan-review/node_modules/@types --types bun /tmp/claude-1000/-home-notnotype-CodeRepository-neuro-book/c38df555-3a36-49c9-bf4f-4027b5da6d32/scratchpad/omp-t60-plan/result-shape.ts
```

- `real-delivery.ts` 退出 0。三个真实宿主场景分别证明：重复 HTTP 贡献在准备前被拒；补交第二项 prepare 失败时仅撤回第一项、双方仍 available、无 published；挂起 prepare 时关闭贡献方，迟到完成只撤回，事件为 `prepare:start, prepare:end, revoke:activation-stopped`，激活结果 stopped，无 published。
- `when-issues.ts` 退出 0。真实 helper 对 a、b 两个坏键仅访问 a，返回 `{ok:false, reason}`，没有结构化 key。
- `result-shape.ts` 运行与 tsc 均退出 0。成功值保持同一引用；denied、unknown-outcome/timeout、conflict/detail 三个失败保留原 failure 引用，均为 Error 和 RemoteCallError。
- `entry-types.ts` 最终 tsc 退出 2，仅四条 `TS2578: Unused '@ts-expect-error' directive.`，位置 56、61、66、71：同形服务不同 id、非空接收者多写、非空贡献实现多写、同形远程合同不同 id。合法正例没有其它诊断；这是揭示计划形状能力边界的预期失败，不是仓库类型检查失败。数组用 as const，Storage 分支为简化模型，不冒充真实 S6 已迁移。

未运行：应用全量 typecheck/test、e2e、smoke:server、开发服务、docs:check/governance:check；没有修改仓库实现，故没有在仓库中执行变异。变异的落点与断言已静态核对：类型反例必须配合法正例；失败 prepare 场景的接收者必须真的装 published 并记录通知，否则“没通知”可能只是没有回调；提前通知的变异必须破坏真实门禁，单独搬动 #notifyPublished 调用仍可能被 handle.published 拦住。未来 S3 应保留挂起准备、第二项失败、补交整批失败、关闭与新增接收者交错的旧判据，将 commit 失败点迁往 prepare，而不是删除这些时序测试。

## 回写建议与数量

本次的规范缺陷对应上述重要发现：建议直接修订 t60 计划、既有 runtime Spec 与 ADR 的指定小节，不新建通用规则或并列真相源。测试规范已有变异、真实依赖和显式改动基准要求，无需再添加同义规则；本审查只提出建议，未回写仓库。

| 类别 | 依据 | 建议修改 | 目标位置 |
|---|---|---|---|
| 规范缺陷 | 映射返回类型允许额外对象键，同形 id 在结构类型中不可区分 | 明确静态保证与 runtime 身份核对的边界；要保证键恰好一致时捕获实际产出键并增加反例 | t60 `plan.md` 第 5 节；`docs/specs/runtime/plugins.md` 的 defineEntry 合同 |
| 规范缺陷 | “远程失败即不在”合并了 denied、版本不符与已派发写请求结果未知 | 改写：“直接尝试远程调用；不可达或暂不可用时按领域降级，当前不能精确判断未安装；其它失败按各自合同处理，unknown-outcome 交给写入方核对。” | t60 `plan.md:121`；`docs/specs/runtime/plugin-api.md` 的可选功能小节 |

最终数量：**阻断 0 条，重要 8 条，建议 4 条，共 12 条。**
