# t33 拥有者贡献点交付报告

## 1. 结论与证据

审查意见 1 的四项修改已完成，核心实现与 13 个场景、5 条补充回归保留。设计与主要实现由主会话完成；先前误委派的核心实现任务已停止，该子代理没有代码改动。

- checkout：`/home/notnotype/CodeRepository/neuro-book/.worktree/w00017-runtime-foundation`。
- branch：`refactor/w00017-runtime-foundation`。HEAD 基线：`a2836a53681eca2207dcb904bb5d4a7104174432`。
- 验证覆盖未提交的工作区修改，没有独立交付 revision；未 commit、push、stash 或切换分支。
- 唯一证据目录：`.agents/works/w00017-application-runtime-architecture/tasks/t33-owner-contribution-points/evidences/`。

| 完成标准 | 实际结果 | 完整输出 |
|---|---|---|
| 1. 专项测试 | 本轮 `bun run test:runtime-foundation`：18 个文件、217 条测试全部通过；包含 13 个场景、5 条补充回归和恢复的机制导入边界测试 | `test-runtime-foundation.txt` |
| 2. 类型检查 | 本轮 `bun run typecheck:runtime-foundation`、`bun run scripts:typecheck`、`bun run typecheck`：全部 exitCode=0，0 错误 | `typecheck.txt` |
| 3. smoke | 本轮 server、services、browser 三个模式：全部 exitCode=0、`failures=0`；browser 使用 `/usr/bin/google-chrome-stable`，实际 Chromium `151.0.7922.71` | `smoke-runtime-foundation.txt` |
| 4. 全量测试 | 按最新指示，本轮不重跑，由开发者执行。保留上一轮原始输出：10 failed / 580 passed / 3 skipped 文件；23 failed / 5018 passed / 9 skipped 测试，exitCode=1。失败文件集合与任务给定基线完全相同 | `test-full.txt`，旧证据，不代表本轮返工后的全量结果 |
| 5. 输出保存 | 以上四份完整 stdout/stderr 已落盘；第 1–3 项已覆盖为本轮结果，第 4 项保留先前实际输出 | 上述四个文件 |

额外本轮验证：`bun run test app/runtime/product-browser-runtime.test.ts`：1 个文件、2 条测试全部通过，输出追加在 `test-runtime-foundation.txt`。它验证两个窗口分别发布 Files View 与刷新命令、关闭只撤回自己的命令、pagehide 只停止本窗口的 Files 流。

上一轮全量的失败文件与条数如下，均在任务给定的基线集合中，路径相对 `packages/neuro-book`：

| 文件 | 失败条数 |
|---|---:|
| `app/component-lab/fixtures/WorkbenchShellLayoutFixture.test.ts` | 9 |
| `app/components/common/DesktopTitleBarChrome.test.ts` | 3 |
| `app/components/common/DesktopTitleBar.test.ts` | 2 |
| `app/components/workbench/WorkbenchPartHost.test.ts` | 1 |
| `app/utils/novel-ide-settings-current-project.contract.test.ts` | 1 |
| `server/agent/profiles/profile-compile-worker-preview.test.ts` | 1 |
| `server/agent/profiles/rp-profiles.test.ts` | 2 |
| `server/agent/profiles/simulation-director-profiles.test.ts` | 2 |
| `server/agent/profiles/world-engine-profile.test.ts` | 1 |
| `server/storage/storage-service.test.ts` | 1 |

上一轮全量另有 22 条未处理错误，输出为 `DOMMatrix is not defined`，来源在上述 UI 基线文件；任务没有给出未处理错误数量基线，未宣称该数量与基线一致。既有 3 个跳过文件与 9 条跳过测试没有被本任务新增或修改。

## 2. 公开合同变化

### 定义、句柄与目录

| 类型或字段 | 变化 |
|---|---|
| `ContributionPointDefinition<Declaration>` | 新增 `id`、`implementation: "required" \| "none"`、纯校验函数 `validate(descriptor): string \| null`；贡献点属于拥有者插件 |
| `PluginDefinition.contributionPoints?` | 新增拥有者定义的贡献点列表 |
| `PluginDefinition.contributions?` | 新增插件顶层的声明式贡献，不携带入口实现 |
| `PluginEntryDefinition.receives?` | 新增本入口接收的本插件贡献点列表，同一运行位置不能重复接收 |
| `ActivationOutput.receivers?` | 新增按贡献点 id 索引的接收者；键与入口 `receives` 完全一致 |
| `ContributionReceiver` | 删除 `capability`、`validate`，保留 `prepare`、`commit`、`revoke` |
| `PluginHostOptions`、`ApplicationManifest` | 删除 `receivers`，无兼容别名或第二条宿主注入路径 |
| `ContributionDeclaration.capability` | 字段名保留，含义为贡献点 id；重复贡献的判定从原来“同一能力内、同一运行位置上唯一”变为同一 host 的当前存活登记内按贡献点/id 判定，跨入口运行位置 |
| `ContributionDescriptor.entry` | 从 `string` 变为 `string \| null`，顶层声明为 null |
| `ContributionHandle` | `entry` 可为 null；新增 `kind: "entry" \| "plugin"`；顶层句柄 generation 为 0，`implementation()` 始终抛 `PluginStateError` |
| `ContributionHandle.published` | 只有整批交付成功且贡献方已发布、两侧仍存活时为 true；prepare/commit 期间与任一侧停止后为 false；旧交付句柄不会随新连接复活 |
| `ContributionState` | 保留声明、激活中、可用、激活失败、已撤回五态，新增 `kind`、`validation`、`delivery`；`entry` 可为 null。被拒绝或顶层的声明可保持 declared，同时独立查询校验与交付结果 |
| `ContributionPointDescription` | 新增目录类型，含 `id`、`implementation` |
| `PluginDescription` | 新增 `contributionPoints` 与顶层 `contributions` |
| `EntryDescription` | 新增 `receives`；入口贡献目录逐条包含校验与交付结果 |
| `PluginHost.contribution(capability, id)` | 从单条或 null 改为只读数组；保留全部当前登记的同身份声明，按插件/入口/kind 稳定排序，无匹配时为空数组；外位置声明也可查询 |
| `PluginStateError` 构造输入 | `entry` 接受 null；错误对象的 entry 与消息使用 `<plugin>` 表示顶层身份 |

`requiredPlugins` 的既有合同不变：激活必需插件在本位置的全部入口。`nbook.workbench/browser`、smoke 的 `command-owner/main`、启动测试的 `command-owner/main` 均不再声明 `onStartup`；浏览器产品删除 `workbench-browser` activate 门禁，只通过 `requiredPlugins` 选中拥有者，再执行 Files 门禁。

### 校验、原因码与诊断

- 新增 `ContributionValidation`：`accepted`；`pending/unknown-point`；`rejected` 加 `detail`，原因包括 `invalid-declaration`、`implementation-required`、`implementation-not-accepted`、`duplicate-contribution`。
- 查询与激活按当前存活登记重新推导校验，查询不追加诊断。重复声明全部拒绝，不按登记顺序选胜者。`validate` 抛错时，其摘要进入 `invalid-declaration.detail`，不在纯查询里写诊断。
- `accepted` 与 `pending` 的入口贡献仍必须产出实现，缺失为 `missing-implementation`；`rejected` 的贡献不要求实现，给了也不交付。
- 新增 `ContributionDelivery`：`waiting-receiver`；`delivered`，包含接收者 plugin/entry/generation；`delivery-failed`，包含相同接收者身份与错误摘要。
- 整插件登记拒绝原因新增 `unknown-contribution-point`、`duplicate-receiver`、`duplicate-contribution-point`；删除旧的 `unknown-receiver`、`invalid-declaration`、`duplicate-contribution` 登记原因。已有插件/入口/服务键/作用域结构拒绝规则保留。
- 贡献相关结构拒绝覆盖贡献点空 id、重复或被未关闭登记占用，receives 引用未定义点、同位置重复接收，以及空贡献 id；实现还拒绝空 contribution.capability。
- 激活失败原因新增 `missing-receiver`、`undeclared-receiver`，均在 output 阶段；既有 `receiver-prepare-failed`、`receiver-commit-failed` 保留。
- `RevokeReason` 新增 `receiver-closed` 与 `delivery-failed`，保留 `activation-failed`、`activation-stopped`、`scope-closed`。
- 新诊断：`publish/receiver-connected`、`revoke/receiver-closed`、`publish/backfill-failed`、`publish/delivery-failed`。诊断字段仍只有 sequence、运行身份、plugin/entry/generation、stage/reason、capability/contribution、错误 name/message 摘要；不携带声明或实现。

## 3. 交付账本与收口

- `ContributionRecord` 保存声明身份、所属插件/可选入口、运行位置和历史 `DeliveryRecord[]`；独立递增 key 与长度前缀的贡献身份编码避免分隔符碰撞。
- `Attempt` 保存源句柄 `handlesByContribution`、该代次交付集合 `deliveries`、拥有者连接列表 `connections`、工作作用域与已交给 services 的服务作用域。
- `ReceiverConnection` 保存 point、拥有者入口/代次、receiver、按贡献记录 key 与源 generation 索引的交付 Map、Promise tail 串行锁和共享 closeout Promise。
- `DeliveryRecord` 保存贡献、独立接收者句柄、源代次、连接、暂存值、`preparedSuccessfully`、preparing/committing/delivered/failed/revoked 状态、revoked 标志和错误摘要。
- 拥有者产出核对通过后，在该代次的 `entry-work` 子作用域登记 `contribution-receiver` 资源，其 `dependsOn` 指向激活产出资源；释放调用共享的断开 Promise，确保撤回完成后才释放激活产出。services 已接管实例时，`#releaseProvided` 同样等待连接断开，避免服务先释放接收者仍在使用的实例。
- 连接在补交前进入 `#connections`，并发贡献方在发布前循环收集新交付计划，不漏掉激活期间接上的连接。
- 补交按贡献方 `Attempt` 分组，跨刚接上的贡献点整批 prepare 后整批 commit；顶层声明各自成批。某一补交批次失败只标记该批交付失败、逆序撤回成功暂存项，不改变两侧激活结果。拥有者 activate 返回前补交完成。
- 已接上时的贡献方激活使用同一批事务；prepare 或 commit 失败导致贡献方激活失败，逆序撤回成功暂存项。无接收者时只发布源句柄，保持 waiting-receiver。
- 回调覆盖整个批次的连接锁；多连接按连接 id 排序获取，finally 逆序释放，补交、激活交付与撤回不在同一连接上交错。
- 撤回在调用 receiver.revoke 前设置 revoked，只处理 `preparedSuccessfully` 的交付；共享断开 Promise 与该标志保证两侧同时关闭也每条交付恰好撤回一次。revoke 抛错记录 `receiver-revoke-threw`，不重复调用该交付。
- 交付句柄引用源句柄但独立拥有发布门禁；拥有者关闭使旧句柄不可调用，源贡献仍可用。新拥有者连接补交得到新句柄，旧句柄不复活。
- 贡献方发布资源 `contribution-publication` 同样登记在 `entry-work`，依赖激活产出；贡献方关闭逆序撤回，顶层声明由登记作用域上的 `top-level-contributions` 资源撤回。
- 贡献关系没有进入 services 依赖图。原有代次/work/服务租约/必需借用的收口顺序保留，closed 诊断只在工作与服务作用域完成关闭后记录。

## 4. 已有测试的改写与理由

### `runtime/plugins/plugins.test.ts`

接收者夹具改由真实拥有者插件 `receivers` 定义贡献点并在激活产出里提供。需要接收者的用例等待拥有者激活；纯登记用例不激活拥有者。查询断言由单对象迁移到数组，不改被验证的状态或次数；新增拥有者使 services 注册序号变化的断言对应更新。根关闭顺序测试使用显式的夹具服务依赖 `receivers/lifetime` 保留原来“贡献先关闭、接收者仍可撤回”的前提，这不是内核为贡献添加依赖。

| 已有用例 | 修改与保留的验证 |
|---|---|
| 机制源码只使用同目录相对导入与 lifecycle/services 入口，不 import 框架、驱动或产品领域 | 按 HEAD 原样恢复完整用例、5 个辅助符号及 moduleDir，不改变断言 |
| 宿主绑定同一运行实例的装配；同一能力不能登记两个接收者 | 保留装配身份拒绝，改为新宿主参数；重复接收者转到新场景 12 验证 owner 的 receives 结构拒绝 |
| 校验失败或重复 id 整体拒绝、报错可见、不静默覆盖，也不向 services 留下部分声明 | 保留全部结构错误与无部分登记断言；旧未知接收者/无效声明/重复贡献整体拒绝改为场景 1、3、4 的单条结果 |
| 登记不创建资源、不调用 activate；目录列出依赖、提供项与贡献描述；其它位置的入口只进描述 | 不预激活夹具；资源与服务未初始化断言保留，外位置查询按新合同返回声明数组 |
| 解析尚未激活提供者的服务触发一次激活；两个并发解析与一次直接触发共享同一次激活，入口不等待自身提供项 | 真实拥有者先接上；更新查询数组和注册序号，single-flight 与同实例断言保留 |
| 两个消费者并发首次触发只激活一次、贡献只发布一次，两次调用各自独立执行 | 改接收者装配和数组查询，激活/prepare/commit 各一次、两次业务执行保持 |
| 单个等待方取消只结束自身等待；其它等待方正常取得能力，激活仍只发生一次 | 只改夹具初始化，取消隔离与 single-flight 断言保留 |
| 同一定义在 server 与 browser 宿主分别激活；一处失败不阻止另一处可用，结果分别报告 | 两侧各激活自己的拥有者，数组查询；位置与失败隔离断言保留 |
| 同一位置的两个入口不共享激活状态 | 改夹具与数组查询，未调用另一入口与 declared 状态断言保留 |
| 插件 A 中途失败时插件 B 已发布的贡献仍可用；A 的描述与失败原因保留，本次暂存项撤回，失败原因脱敏 | 使用插件接收者，目录增加 receivers；回滚、其它贡献可调用、稳定失败及错误摘要断言保留 |
| 关闭操作级作用域撤回该实例已发布的实现并释放资源；描述保留并带不可用原因；重复关闭不重复副作用；根上的必需插件不受影响 | 目录增加 receivers，查询数组；恰好一次撤回/释放、旧句柄失效与其它贡献仍可调用保持 |
| 激活等待期间作用域关闭：迟到的成功不发布、已登记资源收口；已关闭作用域拒绝再触发；重新启用基于新作用域产生新代次 | 更新夹具与目录选择；迟到不 prepare、资源释放一次、generation 递增与新 scopeId 保持 |
| 已登记但从未激活的入口在作用域关闭后拒绝触发 | 查询改数组，其余拒绝与 declared/scope-closed 断言保持 |
| 描述已登记、实现待激活、实现可用、激活失败、已撤回五种结果可区分；缺失实现即失败，不产生空 handler | 查询改数组，全部五态与 missing-implementation 保持 |
| server/root、server/operation、browser/root、browser/operation 四个参数化用例 | 根级用例显式依赖夹具寿命服务；原有两次调用、single-flight、scope-closed 撤回一次保持，未改撤回原因以绕过失败 |
| 失败后资源收口完成前 recover 不结算；收口完成后显式恢复产生新代次并成功 | 改夹具初始化，关闭等待、显式恢复与新代次可调用保持 |
| 经服务解析触发的失败也稳定；recover 同时重置提供者，之后解析得到新代次实例 | 更新拥有者导致的服务注册序号；稳定失败、unresolved 重置与新实例值保持 |
| 第二个接收者准备失败：第一个接收者的暂存项撤回且不可调用，其它插件仍可调用；成功路径全部接收者完成后才可调用 | 两接收者改由 owner 激活交出；完整事件顺序、逆序回滚、commit 中句柄不可用保持 |
| 必需依赖缺失时入口受阻且不消耗代次，依赖可用后经 require 取得，实例与借用随激活作用域 | 改夹具初始化，服务受阻与借用释放保持 |
| 提供项实例交付给 services 后随本代次关闭，只释放一次；旧绑定 stale；产出未声明的键即失败 | 改夹具初始化，释放一次、stale 与 undeclared-service 保持 |
| 提供项释放失败不被标记为已释放：交付给 services 与未交付两条路径都在显式恢复时重试，成功后不再重复 | 改夹具初始化，adopted/unadopted 各失败一次、恢复各重试一次的精确计数保持 |
| 观察者异常不影响机制；接收者 revoke 抛错只记诊断 | 显式登记/激活拥有者；关闭成功、receiver-revoke-threw 与 revoked 查询保持 |

共享事件循环辅助等待改为 setImmediate 检查点，避免以定时等待表达机制结算；用例仍通过显式 gate 控制激活与释放。

### `runtime/application/application-startup.test.ts`

| 已有用例 | 修改与理由 |
|---|---|
| 验收 12：清单 A B C 并发启动按依赖先调用 C B A，published 诊断顺序相同 | 将宿主命令接收者迁为 requiredPlugins 里的 command-owner；保留 C→B→A 激活与发布顺序 |
| 验收 13：A 全部资源与贡献先于 B 服务释放，提供者服务先于其自身资源，入口按 A B C 关闭 | A/B/C 显式依赖夹具 command-owner/lifetime，保证该测试的 owner 寿命前提；贡献查询改数组，原有全部先后顺序与恰好一次断言保留 |
| 验收 14：每个激活代次各有一次 close-started 和 closed，懒入口没有关闭诊断 | 使用同一 migrated dependencyChain，保持各入口关闭诊断的原有次数与懒入口无诊断 |

本轮 command-owner 移除冗余 onStartup，只靠 requiredPlugins 选中。其余启动测试仅共享基础 manifest 删除空 receivers，不改用例体或断言。

### 机械合同迁移

以下只移除已经不存在的空 receivers 参数，不改变行为断言：

| 文件与现有用例 | 修改 |
|---|---|
| `runtime/plugins/entry-dependencies.test.ts`：全部 11 条；其中“外来、空名称及保留服务名拒绝整个插件，本地能力无需插件前缀”另有独立 host | 共享 setup 与独立 host 都使用新参数 |
| `runtime/plugins/review-regressions.test.ts`：“同入口/跨入口/同名不同键重复提供服务 id”；“目录按码元排序”；“undeclared-service 中途失败”；“未校验产出释放失败恢复”；“迟到产出逆序释放”；“停止后未提交的服务交付拒绝” | 六处 host 参数迁移，参数化后仍为 8 条 |
| `runtime/application/application.test.ts`：启动、接纳、关闭竞态、实例表及 check 门禁的共享 manifest 用例 | 删除共享 manifest 的空 receivers，无断言修改 |
| `runtime/diagnostics/diagnostics.test.ts`：“消费者清理记录先于出口关闭”；“必需门禁失败”；“诊断出口关闭失败显式恢复” | 共享 manifestWith 删除空 receivers，其余诊断断言保持 |
| `app/runtime/browser-host.test.ts`：“同窗口多实例隔离”；“pagehide”；“必需失败”；“stopTimeoutMs 有界销毁”及无 window 的共享清单 | 两处清单删除空 receivers，隔离、监听、截止断言保持 |
| `server/runtime/foundation/server-host.test.ts`：进程信号、requestStop、启动失败、有界关闭的共享清单 | 删除空 receivers，适配器行为不变 |
| `server/features/platform-files/platform-files.test.ts`：共享 startHarness 的现有 I/O、权限、订阅、锁、取消、关闭与替换用例；独立的“多个授予键共享一个服务实例” | 两处 host 参数删除空 receivers，所有 I/O 与收口断言保持 |
| `server/features/sqlite/sqlite.test.ts`：共享 startHarness 的全部 9 条 | host 参数删除空 receivers，事务、资源权限与关闭断言保持 |

`app/runtime/product-browser-runtime.test.ts` 的两个现有用例没有改动：未断言 workbench-browser 门禁 id，本轮已通过实际 Files 行为验证 requiredPlugins 的效果。

新增 `owner-contribution-points.test.ts`，包含场景 1–13 与 5 条补充回归：发布前连接不漏交、拥有者关闭与 prepare 交错、贡献方在补交中关闭、身份分隔符碰撞、services 已接管的拥有者产出仍先撤回后释放。没有把新场景替换进旧测试文件。

## 5. 修改文件

以下路径相对本 worktree 的 `packages/neuro-book/`。共 19 个已有源码/测试文件修改，新增 1 个测试文件：

1. `runtime/plugins/contracts.ts`
2. `runtime/plugins/registration.ts`
3. `runtime/plugins/host.ts`
4. `runtime/plugins/plugins.test.ts`
5. `runtime/plugins/entry-dependencies.test.ts`
6. `runtime/plugins/review-regressions.test.ts`
7. `runtime/plugins/owner-contribution-points.test.ts`（新增）
8. `runtime/application/contracts.ts`
9. `runtime/application/bootstrap.ts`
10. `runtime/application/application.test.ts`
11. `runtime/application/application-startup.test.ts`
12. `app/runtime/product-browser-runtime.ts`
13. `app/runtime/browser-host.test.ts`
14. `runtime/diagnostics/diagnostics.test.ts`
15. `server/features/platform-files/platform-files.test.ts`
16. `server/features/sqlite/sqlite.test.ts`
17. `server/runtime/foundation/server-host.test.ts`
18. `server/runtime/product-startup.ts`（只删除 receivers 字段）
19. `scripts/smoke/runtime-foundation/controlled-manifest.ts`
20. `scripts/smoke/runtime-foundation/services-manifest.ts`

证据目录写入 `test-runtime-foundation.txt`、`typecheck.txt`、`smoke-runtime-foundation.txt`、`test-full.txt` 与本报告 `delivery.md`。任务既有 brief、README、review 文件没有修改；`packages/neuro-book/docs/research/README.md` 是已有无关改动，未触碰。`runtime/lifecycle/**`、`runtime/services/**`、Spec、Work/Task 正文、package/tsconfig/vitest 配置未修改。

## 6. 禁止清单逐条自查

| 禁止项 | 实际结果 |
|---|---|
| 不按错误文案分支；不静默吞错 | 无按错误文案分支。交付与撤回异常记录诊断；校验异常返回 invalid-declaration.detail，纯查询不追加诊断。HEAD 原有的观察者异常隔离 catch 与共享等待拒绝映射行为未改动，未宣称本任务消除了所有既有异常隔离路径 |
| 不掩盖检查失败，不跳过测试，不放宽断言，不重标失败，无测试专用产品分支 | 无新增 skip、only 或测试专用分支；新合同导致的断言结构迁移已逐个列明；原有源码边界测试已按 HEAD 恢复。上一轮全量 exitCode=1、22 条未处理错误如实保留 |
| 不删除或替换范围外代码/配置/注释 | 无范围外修改；有效的宿主原有注释按 HEAD 恢复，语义变化处按账本改写；controlled-manifest 的 provide 导入原顺序恢复；已有研究 README 未触碰 |
| 保留清理收口，无多余第二路径或不可达代码 | 激活失败、实际产出逆序释放、services 已接管实例收口与显式恢复保留；用回归验证断开先于释放。宿主注入 receivers 路径已删除；拥有者无重复 onStartup/workbench-browser 启动路径 |
| 不跨包深导入源码 | 无新增跨包深导入；机制导入边界测试恢复且通过 |
| 不确定时先找现有自然做法 | 沿用生命周期资源 dependsOn、services 租约、requiredPlugins 与 Promise gate；没有把可实现项直接标成无法做到 |

补充：设计与主要编码未交由子代理完成；未 commit/push/stash/切分支或改 Git 配置；未设置 http_proxy、修改时区或 locale；smoke 临时目录位于系统临时根并已删除；新增/恢复注释为中文，说明边界上的时序与所有权。

## 7. 后续切片注意事项

1. 声明层出现与消失留给阶段 3 热插拔：拥有者已接上后才登记插件，其顶层声明式贡献本切片不会立即推送，等下次接上时补交。
2. 同属阶段 3：之后登记的重复贡献使先前已交付声明的 validation 变为 rejected，但本切片不主动撤回既有交付；不能把动态校验变化当成交付已经同步撤回。
3. 重复判定现在跨入口运行位置。后续 manifest/schema 与 Spec 必须使用该规则，不沿用旧“同运行位置唯一”的表述；交付仍只在相同运行位置发生。
4. 后续接收者业务调用须保留句柄调用时门禁，不缓存 implementation 绕过 owner/source 停止；顶层 kind=plugin 无实现，跨插件不可用错误包装不属于本切片。
5. 后续对拥有者生命周期的调整需保留 services 已接管实例路径的“先撤回、后释放”和连接批次串行化，不能只看激活产出资源上的 dependsOn。

本轮用户纠正涉及的测试保留、注释保留、范围与主要编码归属已有任务/仓库规则覆盖，不追加重复规则；未修改任何治理真相源。
