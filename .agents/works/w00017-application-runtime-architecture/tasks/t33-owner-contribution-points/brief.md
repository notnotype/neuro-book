# 任务说明：贡献点由拥有者插件定义（w00017 t33）

你是本任务的编码者。主 Agent（Claude）会审查你的 diff、自己重跑验证并决定验收。用简体中文写最终汇报。

## 背景

上一个 Task（t32，提交 `a2836a53`）让内核按入口推导受阻、按依赖图启停。本任务改贡献点：现在接收者由宿主在创建插件宿主时传入（`PluginHostOptions.receivers`、`ApplicationManifest.receivers`），贡献校验失败会拒绝整个插件。设计要求改为：

- 贡献点由拥有者插件定义，校验规则与“是否需要实现”都来自拥有者；登记时按单条贡献校验，不需要拥有者已激活；
- 拥有者入口激活时才接上接收者；接上时内核把已经可用的贡献补交给它，之后的变化由内核推送，拥有者不轮询；
- 贡献不构成依赖、不导致受阻；拥有者缺席时贡献挂起，拥有者回来后重新生效。

依据：`packages/neuro-book/docs/proposals/extensible-application-platform.md` 的 P1 第 2、4 项与 P3（“贡献点”一行、“只经贡献点或命令协作不构成依赖”、加载与卸载规则第 1、2 条）；`docs/specs/runtime/plugin-manifest.md` 输出第 10 条与验收场景 10；现有行为合同 `docs/specs/runtime/plugins.md`（接收者五态、受控贡献事务、场景 6 与 11 必须继续成立）。

先读：`packages/neuro-book/runtime/plugins/`（`contracts.ts`、`registration.ts`、`host.ts`、`blocked.ts` 与测试）、`runtime/application/bootstrap.ts`、`app/runtime/product-browser-runtime.ts` 及其测试、`scripts/smoke/runtime-foundation/controlled-manifest.ts`。

## 目标合同

### A. 定义

```ts
/** 由拥有者插件定义的贡献点。 */
export interface ContributionPointDefinition<Declaration = unknown> {
    /** 在全部存活登记中唯一，例如 "workbench.view"。 */
    readonly id: string;
    /** required：贡献写在入口下，由该入口激活时给出实现；none：只有声明，写在插件顶层。 */
    readonly implementation: "required" | "none";
    /** 纯函数，返回拒绝原因或 null；不得有副作用（阶段 3 改为清单中的 schema）。 */
    validate?(descriptor: ContributionDescriptor<Declaration>): string | null;
}
```

- `PluginDefinition` 增加 `contributionPoints?` 与顶层 `contributions?`（只有声明的贡献）；入口上的 `contributions` 继续表示需要实现的贡献。
- `PluginEntryDefinition` 增加 `receives?: ReadonlyArray<string>`：本入口为本插件的哪些贡献点提供接收者；`ActivationOutput` 增加 `receivers?: Readonly<Record<string, ContributionReceiver>>`，键为贡献点 id。
- `ContributionReceiver` 去掉 `capability` 与 `validate`（移到贡献点），保留 `prepare`、`commit`、`revoke`。
- 删除 `PluginHostOptions.receivers` 与 `ApplicationManifest.receivers`，不保留第二条路径。
- 顶层声明式贡献交给接收者的句柄，`implementation()` 抛 `PluginStateError`（它没有实现）；需要区分时在句柄上加只读的种类字段。

### B. 登记时的整体拒绝（整个插件不登记）

只限结构错误：贡献点 id 为空或在本插件内重复；贡献点 id 已被另一个存活登记的插件定义（`duplicate-contribution-point`）；`receives` 引用了本插件没有定义的贡献点；同一插件中同一运行位置的两个入口接收同一个贡献点；贡献 id 为空。现有的 `unknown-receiver`、`invalid-declaration`、`duplicate-contribution` 不再拒绝整个插件，改为下面的单条结果；不再使用的原因码删除。

### C. 单条贡献的校验结果

每条贡献（入口下与顶层）有校验结果，在查询与激活时按当前存活登记推导（与 t32 的受阻推导相同的原则：与登记顺序无关、重复计算结果相同、查询不产生诊断）：

- `pending`，原因 `unknown-point`：没有存活登记的插件定义该贡献点。定义它的插件登记后，按其规则重新判定。
- `rejected`，原因与详情：`invalid-declaration`（`validate` 返回原因）、`implementation-required`（点要求实现但贡献写在顶层）、`implementation-not-accepted`（点不接受实现但贡献写在入口下）、`duplicate-contribution`（同一贡献点内同一 id 出现多于一次，所有重复者都拒绝，与顺序无关）。
- `accepted`。

只有被拒绝的那一条不生效，插件其它部分照常。入口激活时，`accepted` 与 `pending` 的入口贡献必须给出实现（否则仍是 `missing-implementation`）；`rejected` 的贡献不要求实现，给了也不发布。目录与按身份的查询要能看到每条贡献的校验结果；同一身份出现多条时查询接口如何表达由你设计，在汇报中说明。

### D. 交付账本

贡献“可用”（贡献方入口已发布）之后，内核负责把它交给同一运行位置上该贡献点已接上的接收者，并逐项记账。规则：

1. **接上接收者**：拥有者入口激活成功、在发布之前接上它声明的接收者；随后内核把该贡献点已经可用的贡献补交给它：入口贡献按贡献方代次整批补交（同一批先全部 `prepare`，再全部 `commit`），顶层声明式贡献逐条补交。补交在拥有者的 `activate()` 结果返回之前完成。某一批补交失败只让这一批标为交付失败（可查询、记诊断），已准备的项按逆序 `revoke`，贡献方与拥有者的激活都不受影响。
2. **贡献方后激活**：贡献方激活时，接收者已接上的贡献按现有受控事务交付（全部 `prepare` 成功后全部 `commit`，任一失败则贡献方激活失败、逆序撤回全部暂存项，`plugins.md` 场景 11 继续成立）；接收者未接上的贡献只发布到账本，状态为等待接收者，不让贡献方失败。
3. **贡献方关闭**：已交付的项向对应接收者 `revoke`（原因 `scope-closed`），逆序、每项只撤回一次。
4. **拥有者关闭**：接收者断开前，已交付给它的项逐一 `revoke`（新原因 `receiver-closed`），这些贡献回到等待接收者；贡献方不受影响。断开发生在拥有者自己的激活产出释放之前（接收者的 `revoke` 还能用拥有者的实现）。拥有者恢复并重新激活后，按第 1 条重新补交。
5. **两边同时关闭**：每个交付记录恰好撤回一次。
6. **同一接收者的回调串行执行**：补交、事务交付与撤回不会在同一个接收者上交错。
7. 只经贡献点协作不构成依赖：拥有者受阻、失败或缺席不使贡献方受阻或失败。

贡献的可查询状态在现有“声明 / 激活中 / 可用 / 激活失败 / 已撤回”之上，增加校验结果与交付状态（等待接收者、已交付给哪个入口的哪一代、交付失败）。接收者五态仍可区分。

诊断新增（只含身份、阶段、原因与错误摘要）：接收者接上与断开、补交失败、交付失败。具体阶段与原因名由你定，在汇报中列出。

### E. 产品与 smoke 迁移

- `app/runtime/product-browser-runtime.ts`：增加一个过渡的浏览器插件 `nbook.workbench`（入口 `browser`），定义贡献点 `workbench.view`（required）与 `workbench.command`（required），`validate` 沿用现在两个接收者的校验，接收者由它激活时交出，逻辑沿用现在的 `prepare`/`commit`/`revoke`。`nbook.workbench` 列入 `requiredPlugins`，保证 Files 激活时接收者已接上；Files 的贡献与现有行为保持一致（视图发布、命令注册与撤回）。该文件的现有测试保持通过，行为不变。
- `scripts/smoke/runtime-foundation/controlled-manifest.ts` 等：命令接收者改由一个拥有 `commands` 贡献点的受控插件提供；`smoke:runtime-foundation` 三种模式照常通过。
- `server/runtime/product-startup.ts`、各测试中的 `receivers: []` 随字段删除而移除。

## 不做

- 清单文件、JSON schema 校验、`contributionPoints` 的声明式 schema（阶段 3）；
- 运行期启用与禁用、声明层的出现与消失通知（热插拔，阶段 3）；
- 激活事件 `onCommand`、`onView` 等（后续切片）；
- 跨插件调用包装、`plugin-unavailable` 错误；
- `index.vue` 与工作台的其它迁移（浏览器宿主切片）。

## 验收场景（写成合同测试，每个场景一个用例，用例名写清场景）

1. 拥有者已登记：合格贡献 `accepted`；一条 `invalid-declaration` 只拒绝该条，原因与详情可查询，同一插件其它贡献与入口照常激活。
2. 顶层贡献投向 required 点为 `implementation-required`；入口贡献投向 none 点为 `implementation-not-accepted`。
3. 贡献点无人定义时为 `pending`/`unknown-point`；定义它的插件随后登记，合格的变为 `accepted`、不合格的变为 `rejected`；三种登记顺序得到相同目录。
4. 两个插件向同一贡献点提交同一 id：两条都 `rejected`/`duplicate-contribution`，与登记顺序无关；两个插件的其它部分照常。
5. `rejected` 的入口贡献不要求实现；`accepted` 与 `pending` 缺实现仍是 `missing-implementation`。
6. 拥有者先激活：贡献方激活时按事务交付；第二个接收者 `prepare` 失败时贡献方激活失败，第一个接收者上的暂存项被撤回且不可调用（`plugins.md` 场景 11 在拥有者提供接收者的条件下重写）。
7. 贡献方先激活：贡献等待接收者；拥有者激活后补交，`activate()` 返回时接收者已 `commit`；一批补交失败只标记该批，拥有者与其它批不受影响。
8. 顶层声明式贡献在接上时补交，句柄的 `implementation()` 抛 `PluginStateError`。
9. 拥有者关闭（其登记作用域单独关闭）：已交付项收到 `receiver-closed` 撤回，贡献回到等待接收者，贡献方仍可用；拥有者在新作用域重新登记并激活后重新补交。
10. 贡献方关闭：已交付项各撤回一次；两边同时关闭时每个交付记录恰好撤回一次。
11. 同一接收者上回调串行：两个贡献方并发激活与一次补交交错时，接收者观察到的调用不交错（用会挂起的 `prepare` 构造）。
12. 结构拒绝：`receives` 引用未定义的点、两个同位置入口接收同一个点、贡献点 id 在本插件内重复或被另一插件定义，各自使整个插件不登记；激活产出缺少声明的接收者为 `missing-receiver`、给出未声明的接收者为 `undeclared-receiver`（输出阶段失败）。
13. 贡献不构成依赖：拥有者入口受阻或激活失败时，贡献方照常激活，贡献等待接收者。

已有合同测试保持通过；因接收者改由插件提供而必须改写的已有用例，保持原有断言的意图与强度，在汇报中逐个列出改写了哪些。

## 允许改动的文件

- `packages/neuro-book/runtime/plugins/**`、`packages/neuro-book/runtime/application/**`
- `packages/neuro-book/app/runtime/product-browser-runtime.ts` 及其测试、`packages/neuro-book/app/runtime/browser-host.test.ts`
- `packages/neuro-book/server/runtime/product-startup.ts`（只删 `receivers` 字段）、`packages/neuro-book/server/runtime/foundation/server-host.test.ts`
- `packages/neuro-book/scripts/smoke/runtime-foundation.ts` 与 `scripts/smoke/runtime-foundation/**`
- 只因删除 `receivers` 字段需要修改的测试文件（例如 `runtime/diagnostics/diagnostics.test.ts`、`server/features/{platform-files,sqlite}/*.test.ts`）
- 本 Task 的证据目录 `.agents/works/w00017-application-runtime-architecture/tasks/t33-owner-contribution-points/evidences/`

不改：`runtime/lifecycle/**`、`runtime/services/**`、`docs/**`（Spec 由主 Agent 更新）、任何 `README.md` 与 Work/Task 文档、`package.json`、`tsconfig*.json`、`vitest*.config.ts`，以及上面没有列出的产品代码。确实需要改列表外的文件时，先在汇报中说明原因，不要自己改。

## 验证命令与完成标准

在 `packages/neuro-book` 下：

1. `bun run test:runtime-foundation`：全部通过，包含上面 13 个新场景。
2. `bun run typecheck:runtime-foundation`、`bun run scripts:typecheck`、`bun run typecheck`：0 错误。
3. `bun run smoke:runtime-foundation -- --host server`、`-- --services`、`-- --host browser --browser-executable /usr/bin/google-chrome-stable`：全部通过（本机没有 Playwright 自带浏览器）。
4. `bun run test`（全量，约 6 分钟）：除下面这些 master 基线就失败的文件外不新增失败（基线为 10 个文件、23 条失败）：`app/component-lab/fixtures/WorkbenchShellLayoutFixture.test.ts`、`app/components/common/DesktopTitleBarChrome.test.ts`、`app/components/common/DesktopTitleBar.test.ts`、`app/components/workbench/WorkbenchPartHost.test.ts`、`app/utils/novel-ide-settings-current-project.contract.test.ts`、`server/agent/profiles/profile-compile-worker-preview.test.ts`、`server/agent/profiles/rp-profiles.test.ts`、`server/agent/profiles/simulation-director-profiles.test.ts`、`server/agent/profiles/world-engine-profile.test.ts`、`server/storage/storage-service.test.ts`。
5. 把第 1–4 步的完整输出保存到本 Task 的 `evidences/`（`test-runtime-foundation.txt`、`typecheck.txt`、`smoke-runtime-foundation.txt`、`test-full.txt`）。

## 禁止清单（汇报前逐条自查，在汇报中逐条写明结果）

- 不按错误文案做程序分支，用错误类型或错误码；不用静默的 `catch` 吞掉错误，至少写一条诊断；
- 不为让测试或检查通过而掩盖问题：不跳过测试、不放宽断言、不把一种失败改报成另一种，不在产品代码里加测试专用分支；
- 不删除或替换任务之外的已有代码行、配置项和注释，也不顺手改写无关注释；
- 重构时保留原有的清理与收口语句（例如失败分支里的资源释放），不留下多余的第二条路径或不可达的代码；
- 不跨包深导入其它包的源码，跨包只经包名与公开入口；
- 不确定能否检查或实现时，先找现有的自然做法，不要直接标成“无法做到”。

设计与主要编码由你自己完成，不交给子代理；子代理只用于调研、审查或批量机械改动这类独立、简单而工作量大的活。

另外：不 `git commit`、`git push`、`git stash`、切分支，不改 git 配置；不设置 http_proxy，不改时区与 locale；测试产生的临时数据放在系统临时目录并清理；注释用中文，只写边界上不明显的原因，不复述代码。仓库规则见 worktree 根目录的 `AGENTS.md`，TypeScript 规范见 `docs/standards/code/`。

## 最终汇报

1. 结论：完成标准 1–5 各自的结果（附证据文件名）；
2. 公开合同的变化：新增、删除或改变的类型、字段、原因码、诊断，逐项列出（主 Agent 据此更新 Spec）；
3. 交付账本的实现方式：数据结构、接上与断开放在哪个作用域的什么资源上、如何保证每个交付记录只撤回一次与接收者回调串行；
4. 改写了哪些已有测试及理由；
5. 改动的文件列表；
6. 禁止清单逐条自查结果；
7. 后续切片需要注意的问题（不超过 5 条）。
