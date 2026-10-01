# 任务说明：内核的入口与服务级依赖（w00017 t32）

你是本任务的编码者。主 Agent（Claude）会审查你的 diff、自己重跑验证并决定验收。用简体中文写最终汇报。

## 背景

NeuroBook 正在把进程生命周期交给自己的内核，内置能力改为插件（设计：`packages/neuro-book/docs/proposals/extensible-application-platform.md` 的 P1、P3、P9、P11；行为合同：`docs/specs/runtime/plugin-manifest.md`，`planned`）。阶段 1 的完成标准是 `smoke:product-lifecycle` 的 L1–L10 全部通过（见 `.agents/works/w00017-application-runtime-architecture/tasks/t31-product-lifecycle-smoke/README.md`）。

阶段 1 分多片推进。本任务是第一片，只改内核：让依赖指向“归某个插件所有的服务”，按入口推导受阻，启动时按依赖激活，关闭时严格按依赖逆序，并输出激活与关闭的诊断。后续切片才把产品的内置服务（App 状态、Session Store、Project 等）迁成插件，届时 L2 与 L3、L4 的关闭顺序子断言会读取本任务新增的诊断。

现有内核已经实现并有合同测试（`runtime.plugins`、`runtime.services`、`runtime.lifecycle`、`runtime.application` 四份 Spec 都是 `implemented`，在 `docs/specs/runtime/`）。先读：

- `packages/neuro-book/runtime/plugins/`（`contracts.ts`、`host.ts`、`registration.ts`、`plugins.test.ts`）
- `packages/neuro-book/runtime/application/`（`contracts.ts`、`bootstrap.ts`、`application.test.ts`）
- `packages/neuro-book/runtime/services/contracts.ts`、`packages/neuro-book/runtime/lifecycle/contracts.ts`、`runtime/lifecycle/close-plan.ts`
- `docs/specs/runtime/plugin-manifest.md` 的“输出与可观察行为”第 2–9 条与“验收与 Smoke”

## 目标

### A. 服务 id 归插件所有

1. 插件入口 `provides` 中的服务键，`name` 必须是 `<插件 id>/<名称>`，名称非空；否则整个插件登记被拒绝，原因 `foreign-service-id`。名称为 `channel` 时拒绝，原因 `reserved-service-name`（`<插件 id>/channel` 留给插件通道，本任务不实现通道）。
2. 这条规则只约束插件的 `provides`；装配方的本地能力 `CapabilityProvider` 不受约束。
3. 现有内置插件按规则改名，并更新所有引用（测试、`scripts/smoke/runtime-foundation/`、产品清单）：

   | 现插件 id | 新插件 id | 现服务键 | 新服务键 |
   |---|---|---|---|
   | `runtime-diagnostics` | `nbook.diagnostics` | `runtime-diagnostics` | `nbook.diagnostics/diagnostics` |
   | `sqlite` | `nbook.sqlite` | `sqlite` | `nbook.sqlite/sqlite` |
   | `platform-files` | `nbook.platform-files` | `platform-files` | `nbook.platform-files/files` |
   | `workspace-files`（入口 `main`） | `nbook.files`（入口改为 `server`） | `workspace.files` | `nbook.files/workspace` |

   浏览器端已有的 `nbook.files`/`browser` 入口不动。smoke 与测试里的示例插件、示例服务键也按规则改名。改名前搜索旧 id 与旧键名在仓库中的全部出现位置，汇报里列出你判断“不需要改”的那些及理由（例如只是测试临时目录名）。

### B. 按入口推导受阻

在 `EntryStatus` 中增加 `blocked`，`EntryState` 增加 `blocked` 字段（受阻原因或 `null`）。原因与规则（只看必需依赖，`required: false` 的依赖永不导致受阻）：

1. 依次检查入口的必需依赖，报告**第一个**不满足的依赖的原因、服务键名与依赖路径（路径由 `插件/入口` 组成，从本入口开始）。
2. 本位置上的提供方：本位置某个入口的 `provides` 含该键，或同一 `ServiceAssembly` 中的非插件提供者（例如装配方的本地能力）。
3. 本位置没有提供方时：若有其它运行位置的入口提供该键，原因为 `location-mismatch`；否则为 `missing-service`。
4. 提供方入口受阻：`provider-blocked`，路径接上提供方的路径。提供方入口激活失败且未恢复：`provider-failed`。提供方经 `recover()` 重置后，依赖方不再因此受阻。
5. 处于依赖环上的入口：`dependency-cycle`，路径为环。依赖环成员的入口：`provider-blocked`。
6. 推导在查询与激活时按需进行，只依赖当前全部存活的登记与各入口状态：与登记顺序无关（先登记依赖方、后登记提供方，依赖方不受阻），重复计算结果相同，不写持久数据，不因查询产生诊断。
7. 受阻入口不激活：`activate()` 返回 `rejected`，`reason: "blocked"`，并带上受阻原因；不消耗代次、不调用入口的 `activate`；每次这样的拒绝记一条插件诊断。经 `runtime.services` 解析受阻提供方的服务也不得触发激活（写测试确认）。
8. 状态优先级：入口已有当前尝试（激活中、可用、失败、停止中、已关闭）时，状态仍按尝试推导；没有当前尝试且登记作用域存活时，受阻优先于 `registered`。
9. `catalog().plugins` 按插件 id 排序输出，插件内入口保持定义顺序。

推导逻辑请写成 `runtime/plugins/` 下独立的纯函数模块（输入是入口、位置、提供与依赖、各入口状态的快照，输出每个入口的受阻结果），在宿主中调用；纯函数单独测试。

### C. 插件汇总状态

`PluginDescription` 增加 `summary`：只统计本位置的入口；状态为 `blocked` 或 `failed` 的入口记为“不可用”。全部可用为 `available`，部分不可用为 `partial`，全部不可用为 `blocked`；本位置没有入口的插件为 `available`。

### D. 启动时按依赖激活

1. 入口定义增加 `activationEvents?: ReadonlyArray<ActivationEvent>`，本任务只定义 `type ActivationEvent = "onStartup"`（后续切片再加 `onCommand`、`onView`、`onChannel`）。
2. `ApplicationManifest` 增加 `requiredPlugins?: ReadonlyArray<string>`：启动必需的插件 id，由装配方决定（同一插件定义在产品中必需、在 Lab 中可以不必需）。
3. 登记完成后、执行门禁之前，并发激活：启动必需插件在本位置的全部入口，以及声明了 `onStartup` 的本位置入口。依赖先于依赖者由激活时先解析必需依赖自然保证，不按清单顺序串行。不在这个集合里的入口保持懒激活。
4. 启动必需插件登记被拒绝，或其本位置入口受阻、激活失败、激活被停止：记一条 `StartupFailure`（新增类别 `activation` 与阶段 `activate`；`source` 为 `插件/入口`；`reason` 区分受阻原因与激活失败的阶段和原因），`required: true`，启动结果为 `failed` 并有序停止。非必需的 `onStartup` 入口受阻或失败：同样记录，`required: false`，启动继续。
5. 现有门禁（包括 `activate` 门禁）的行为不变。

### E. 关闭严格按依赖逆序

以 A 依赖 B 的服务、B 依赖 C 的服务为例，应用停止（或登记作用域关闭）时必须满足：

1. A 撤回贡献、释放激活产出以及 A 在 `context.scope` 上登记的全部资源之后，A 对 B 服务的借用才结束；
2. B 的服务实例（`provide(key, instance, release)` 的 `release`）在第 1 步完成之后才释放；
3. B 撤回贡献、释放激活产出与 B 在 `context.scope` 上登记的资源，在 B 提供的服务实例释放之后才开始；
4. C 同理在 B 之后。
5. 同一入口内：贡献撤回在激活产出释放之前。

没有依赖关系的入口可以并发关闭。

我读代码的判断（请自己核实，不要照搬）：`plugin-activation` 资源没有对必需依赖的借用声明 `dependsOn`；入口在 `context.scope` 上登记的资源与借用之间没有先后；提供方自己的资源与它的 `provided-service` 租约之间没有先后；贡献发布资源与激活产出之间也没有先后。可用的现有机制：父作用域要等子作用域全部关闭后才释放自己的资源（包括借用）；资源的 `dependsOn` 可以指向先登记的资源句柄或借用句柄；解析结果的 `binding.dependency` 就是借用句柄。

代次身份保持为激活作用域 `plugin:<id>/<entry>#<n>`（`EntryState.scopeId`、`ActivationResult.scopeId`）。如果为了顺序引入内层作用域作为 `context.scope`，在 `host.ts` 文件头注释里说明各层作用域持有什么、为什么。不改 `runtime/lifecycle` 与 `runtime/services`；如果你确认不改它们就做不到，停下来，在汇报里给出证据和你建议的改法，不要自己改。

### F. 激活与关闭诊断

1. 每次激活尝试开始时记插件诊断：阶段 `activate`，原因 `activation-started`，带代次。现有的 `publish`/`published` 继续作为激活完成的标志。
2. 新增诊断阶段 `close`：入口的激活作用域开始停止时记 `close-started`；入口自己的资源与它提供的服务实例全部释放后记 `closed`。
3. 对 A→B→C 的链，诊断序号满足：C 的 `published` < B 的 `published` < A 的 `published`；A 的 `closed` < B 的 `closed` < C 的 `closed`。
4. 诊断仍只含身份、阶段、原因与错误摘要，不含实现或声明附加字段。

## 不做

- 清单文件（`package.json` 中的 `entries`、`contributionPoints` 等）的读取与校验、第三方插件 id 规则、`pluginVersions` 与 `version-mismatch`、不支持的运行位置（如 `tui`）；
- 插件通道（`channel: true` 入口与 `<id>/channel` 依赖），本任务只保留名称；
- 贡献点由拥有者插件定义、按单条贡献校验（下一个 Task）；`receivers` 仍由宿主传入，现有贡献校验行为不变；
- 运行期因依赖变化而停止或重新激活已激活的入口（热插拔，阶段 3）；
- 移除 `ServiceDependency.required: false`（可选依赖）或 `activate` 门禁；
- 产品内置服务迁成插件、服务端宿主、浏览器宿主（后续切片）。

## 验收场景（写成合同测试）

放在 `runtime/plugins/` 与 `runtime/application/` 的测试中（纯函数模块单独一个测试文件）。每个场景一个用例，用例名写清场景：

1. 两端入口：服务端入口依赖服务端提供的服务，浏览器入口依赖只在浏览器提供的服务；在服务端宿主上，服务端入口为 `registered`，浏览器入口为 `foreign-location`，都不受阻，插件汇总为 `available`。
2. `missing-service`：入口依赖登记表中有、但没有任何插件提供的键；该入口受阻并报告键名与路径；同一插件不依赖它的另一入口可以激活；汇总为 `partial`。
3. 本位置全部入口受阻或失败时汇总为 `blocked`；本位置没有入口的插件汇总为 `available`。
4. `location-mismatch`：服务端入口依赖另一插件浏览器入口提供的键。
5. `provider-blocked`：A→B→C 中 C 缺依赖，B 与 A 都受阻，A 的路径为 A、B、C。
6. `provider-failed`：提供方激活失败后依赖方受阻；提供方 `recover()` 重置后依赖方不再受阻并可激活。
7. `dependency-cycle`：两个入口互相依赖，二者都受阻并给出环路径；依赖环成员的第三个入口为 `provider-blocked`；无关入口不受影响。
8. 登记顺序无关：同一组插件按三种不同顺序登记，`catalog()`（含受阻结果与汇总）完全相同；先登记的依赖方在提供方登记后不再受阻。
9. 服务 id：`provides` 键名不以插件 id 加 `/` 开头时整个插件被拒绝（`foreign-service-id`）；`<插件 id>/channel` 被拒绝（`reserved-service-name`）；装配方本地能力的键不受约束。
10. 受阻入口 `activate()` 返回 `rejected`/`blocked`，入口的 `activate` 未被调用，之后状态不变、未消耗代次；经 `runtime.services` 解析受阻提供方的服务返回不可用且不触发激活。
11. 启动：必需插件的入口受阻时启动失败（`activation` 类别、`required: true`），其它入口未被激活的不强行激活；非必需 `onStartup` 入口失败时启动可用且失败被记录为 `required: false`；既不必需也没有 `onStartup` 的入口启动后仍为 `registered`。
12. 启动顺序：清单按 A、B、C 顺序列出（A 依赖 B，B 依赖 C，三者都 `onStartup`）；入口 `activate` 的调用顺序为 C、B、A，`published` 诊断顺序相同。
13. 关闭顺序：A→B→C 各自在 `context.scope` 上登记会记录释放顺序的资源，B、C 提供带 `release` 的服务，A 有已发布的贡献；应用停止后观察到的顺序满足目标 E 的 1–5 条，`closed` 诊断顺序为 A、B、C；另有一个无依赖入口，不对它的位置做断言。
14. 关闭诊断：每个已激活入口各有一条 `close-started` 与一条 `closed`；未激活的入口没有。

已有的合同测试全部保持通过；因改名需要修改的已有断言只改名称，不放宽断言。

## 允许改动的文件

- `packages/neuro-book/runtime/plugins/**`（含新增的纯函数模块与测试）
- `packages/neuro-book/runtime/application/**`
- 改名涉及的文件：`packages/neuro-book/runtime/diagnostics/plugin.ts` 及其测试、`packages/neuro-book/server/features/{sqlite,platform-files,workspace-files}/` 中定义插件 id 与服务键的文件及其测试、`packages/neuro-book/server/runtime/product-startup.ts`（只改对上述 id 与键的引用）、`packages/neuro-book/scripts/smoke/runtime-foundation/**`，以及其它只是引用旧 id 或旧键名的测试文件
- 本 Task 的证据目录 `.agents/works/w00017-application-runtime-architecture/tasks/t32-kernel-entry-dependencies/evidences/`

不改：`runtime/lifecycle/**`、`runtime/services/**`、`docs/**`（Spec 由主 Agent 更新）、任何 `README.md` 与 Work/Task 文档、`package.json`、`tsconfig*.json`、`vitest*.config.ts`，以及上面没有列出的产品代码。确实需要改列表外的文件时，先在汇报中说明原因，不要自己改。

## 验证命令与完成标准

在 `packages/neuro-book` 下：

1. `bun run test:runtime-foundation`：全部通过，包含上面 14 个新场景。
2. `bun run typecheck:runtime-foundation`、`bun run scripts:typecheck`、`bun run typecheck`：0 错误。
3. `bun run smoke:runtime-foundation`：通过。
4. `bun run test`（全量，约 6 分钟）：除下面这些 master 基线就失败的文件外不新增失败（基线为 10 个文件、23 条失败）：`app/component-lab/fixtures/WorkbenchShellLayoutFixture.test.ts`、`app/components/common/DesktopTitleBarChrome.test.ts`、`app/components/common/DesktopTitleBar.test.ts`、`app/components/workbench/WorkbenchPartHost.test.ts`、`app/utils/novel-ide-settings-current-project.contract.test.ts`、`server/agent/profiles/profile-compile-worker-preview.test.ts`、`server/agent/profiles/rp-profiles.test.ts`、`server/agent/profiles/simulation-director-profiles.test.ts`、`server/agent/profiles/world-engine-profile.test.ts`、`server/storage/storage-service.test.ts`。
5. 把第 1–4 步的完整输出分别保存到本 Task 的 `evidences/`（`test-runtime-foundation.txt`、`typecheck.txt`、`smoke-runtime-foundation.txt`、`test-full.txt`）。

## 禁止清单（汇报前逐条自查，在汇报中逐条写明结果）

- 不按错误文案做程序分支，用错误类型或错误码；不用静默的 `catch` 吞掉错误，至少写一条诊断；
- 不为让测试或检查通过而掩盖问题：不跳过测试、不放宽断言、不把一种失败改报成另一种，不在产品代码里加测试专用分支；
- 不删除或替换任务之外的已有代码行、配置项和注释，也不顺手改写无关注释；
- 重构时保留原有的清理与收口语句（例如失败分支里的资源释放），不留下多余的第二条路径或不可达的代码；
- 不跨包深导入其它包的源码，跨包只经包名与公开入口；
- 不确定能否检查或实现时，先找现有的自然做法，不要直接标成“无法做到”。

另外：不 `git commit`、`git push`、`git stash`、切分支，不改 git 配置；不设置 http_proxy，不改时区与 locale；测试产生的临时数据放在系统临时目录并清理；注释只写边界上不明显的原因，不复述代码。仓库规则见 worktree 根目录的 `AGENTS.md`，TypeScript 规范见 `docs/standards/code/`。

## 最终汇报

1. 结论：完成标准 1–5 各自的结果（附证据文件名）；
2. 公开合同的变化：新增或改变的类型、字段、原因码、诊断，逐项列出（主 Agent 据此更新 Spec）；
3. 关闭顺序的实现方式：作用域与资源的结构，以及为什么它满足目标 E；
4. 改名：改了哪些、哪些旧名出现位置没改及理由；
5. 改动的文件列表；
6. 禁止清单逐条自查结果；
7. 你认为后续切片需要注意的问题（不超过 5 条）。
