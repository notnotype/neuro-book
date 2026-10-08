# w00017 t60 实现只读审查

审查对象：`8aa26b09..3b01a401`，共 8 个提交。审查 checkout：`/home/notnotype/CodeRepository/neuro-book/.worktree/w00017-t60-impl-review`。

依据：t60 的 `plan.md`（包含实施中的调整）、`evidences/omp-plan-review.md`、受影响 Spec、实现与测试。既有计划审查已处理的问题不重复报告，只有调整未落实时才重新列出。

已核实 2 条问题，按影响排序：1 条重要、1 条建议。优先把接收者的生效通知纳入现有串行边界，再修补数值对象键的静态核对；没有发现需要另加状态表、锁或兼容入口的理由。

| 严重程度 | 数量 |
|---|---:|
| 阻断 | 0 |
| 重要 | 1 |
| 建议 | 1 |
| 合计 | 2 |

## 1. 激活路径的 published 绕过接收者串行锁，新生效回调与另一批 prepare 交错

- **严重程度**：重要；**类别**：不变量 / 测试。
- **位置**：`packages/nb-runtime/src/plugins/host.ts:1154`、`:1389`、`:1415`；`packages/nb-runtime/src/plugins/owner-contribution-points.test.ts:344`。
- **现象**：同一接收者服务两个并发激活的贡献方 A、B，B 的异步 `prepare` 尚未完成时，A 的 `published` 已进入该接收者。删除 `commit` 后，命令登记、路由挂载、页面挂载都迁入这个不受串行锁保护的回调。
- **为什么是问题**：`runtime.plugins` 输出第 17 条、验收 20 与实现合同明确承诺同一接收者的补交、事务交付与撤回回调不交错。`#deliverPlans` 在锁内完成准备后释放锁，激活路径的通知随后由 `#run` 直接调用；下一批已经占有该锁并挂起时，上一批仍可修改接收者业务表。这破坏接收者可以依赖的事务串行边界。迁移后的场景 11 把 `published` 移入另一个数组、最后排序比较，只验证 `prepare` 顺序，原有“整批回调不交错”的断言被缩窄，掩盖了缺口。
- **与基线的关系**：锁外调用 `published` 的位置在 `8aa26b09` 已存在；本次删除锁内的 `commit` 后，把命令、HTTP 和页面的实际生效操作移到了该通知，因此原有通知的串行缺口现在直接覆盖业务表修改。报告针对本次收敛未兑现的回调合同，不把锁外调用本身描述成新引入代码。
- **依据**：真实 `createRuntimeInstance` + `createServiceAssembly` + `createPluginHost` 实验，无私有方法调用或伪造句柄。执行 `bun /tmp/claude-1000/-home-notnotype-CodeRepository-neuro-book/c38df555-3a36-49c9-bf4f-4027b5da6d32/scratchpad/omp-t60-impl/delivery-smoke.ts`，退出码 0；B 准备门闩未放行时事件为 `prepare:start:a.item`、`prepare:end:a.item`、`prepare:start:b.item`、`published:a.item`，检测结果为 `a.item published during b.item prepare`。A 已返回 `activated`，B 仍在 `prepare`；放行后两者正常关闭。补交通知在 `#deliverPlans` 锁内，激活通知在 `#run` 锁外，代码与观察一致。
- **建议改法**：统一把接收者的 `published` 通知也纳入现有连接锁，保留贡献方发布前的存活检查与新接收者补交检查；不要增加第二套锁或恢复 `commit`。在现有场景 11 的同一个事件数组记录三类回调，增加“第二批 `prepare` 挂起时第一批 `published` 不得插入”的真实运行时场景。

## 2. defineEntry 把数值属性排除在多余键核对之外

- **严重程度**：建议；**类别**：类型合同 / 覆盖缺口。
- **位置**：`packages/nb-runtime/src/plugins/define.ts:56`、`:59`、`:60`；`packages/nb-runtime/src/plugins/define.test.ts:94`。
- **现象**：有合法非空声明时，`receivers: {[point]: receiver, 2: receiver}`、`contributions: {[point]: {one: 1, 2: 2}}`、`contributions: {[point]: {one: 1}, 2: {extra: 2}}` 三种字面量都通过 TypeScript 6.0.3 的 `strict` 检查，不需要类型断言、宽类型辅助函数或条件分支。第一种直到真实激活时才以 `output / undeclared-receiver` 失败；另两种多余项在运行时被忽略，激活成功。
- **为什么是问题**：`ExtraKeys` 显式排除了 `number`，贡献点又只遍历 `keyof Actual & string`。JavaScript 的数值对象属性在运行时是字符串键，内核 `Object.keys(receivers)` 也把 `2` 看作未声明的接收者。`runtime.plugins` 验收 28 和实施调整承诺非空声明下多写的接收者、贡献实现与贡献点都是类型错误，此处属于类型本来能够区分的字面量键，不在已说明的同形 id、宽类型与运行位置相关性限制内。数值键不常见，所以按建议级处理。
- **依据**：`packages/nb-runtime/node_modules/typescript/bin/tsc --noEmit -p /tmp/claude-1000/-home-notnotype-CodeRepository-neuro-book/c38df555-3a36-49c9-bf4f-4027b5da6d32/scratchpad/omp-t60-impl/tsconfig-types.json` 退出码 0。随后执行 `bun /tmp/claude-1000/-home-notnotype-CodeRepository-neuro-book/c38df555-3a36-49c9-bf4f-4027b5da6d32/scratchpad/omp-t60-impl/type-numeric.ts`，三个入口均经真实宿主登记，输出依次为 `extra-receiver {"status":"failed","reason":"undeclared-receiver"}`、`extra-implementation {"status":"activated"}`、`extra-point {"status":"activated"}`；每个实例都正常关闭。
- **建议改法**：沿用现有 `ExtraKeys`，把参与核对的 `string | number` 属性统一投影为运行时字符串键，只排除 `symbol`；让多余接收者、贡献 id 与贡献点共用这个键转换规则。在现有类型反例里补数值键，避免新增另一套运行时校验。

## 本次实际验证

测试临时数据全部指向指定 scratch 内的 `test-tmp/`。以下 Bash 块从审查 worktree 根执行可原样重跑：

```bash
export TMPDIR=/tmp/claude-1000/-home-notnotype-CodeRepository-neuro-book/c38df555-3a36-49c9-bf4f-4027b5da6d32/scratchpad/omp-t60-impl/test-tmp
export NBOOK_HOST_SYSTEM_TEMP_ROOT="$TMPDIR"
export NBOOK_AGENT_TEMP_ROOT="$TMPDIR"
bun run --cwd packages/nb-runtime test
bun run --cwd packages/nb-runtime typecheck
bun run --cwd packages/neuro-book typecheck
```

| 实际执行 | 结果 | 覆盖 |
|---|---|---|
| `prox bun install --frozen-lockfile --ignore-scripts` | 退出码 0；Bun `1.4.2`，安装 `1559` 个包 | 只安装忽略的依赖；未运行根 `postinstall` |
| `bun run --cwd packages/nb-runtime test`，带上述环境 | `292 pass / 0 fail`，`30` 文件，`2344` 次断言 | 内核与全部示例场景，含声明查询、准备失败逆序撤回、贡献方停止、两侧关闭、远程委托寿命及 `orThrow` |
| `bun run --cwd packages/nb-runtime typecheck` | 退出码 0，无诊断 | 普通与浏览器配置；普通配置包含 `src/plugins/define.test.ts` 的编译期反例 |
| `bun run --cwd packages/neuro-book typecheck` | 退出码 0，无诊断 | `tsc --noEmit`、`vue-tsc --noEmit -p tsconfig.web.json`、`vue-tsc --noEmit -p tsconfig.browser-test.json` |
| 下列应用指定测试，带上述环境，在 `packages/neuro-book` 执行 | `59 pass / 0 fail`，`6` 文件，`346` 次断言 | 命令求值、登记与远程调用，公开状态，HTTP 分发 |

应用指定测试的完整命令：

```bash
bun test src/plugins/commands/shared/context-keys.test.ts src/plugins/commands/shared/registry.test.ts src/plugins/commands/shared/plugin.test.ts src/plugins/commands/shared/remote.test.ts src/plugins/state/state.test.ts src/plugins/http/backend/dispatch.test.ts
```

真实运行时实验：

```bash
bun /tmp/claude-1000/-home-notnotype-CodeRepository-neuro-book/c38df555-3a36-49c9-bf4f-4027b5da6d32/scratchpad/omp-t60-impl/delivery-smoke.ts
bun /tmp/claude-1000/-home-notnotype-CodeRepository-neuro-book/c38df555-3a36-49c9-bf4f-4027b5da6d32/scratchpad/omp-t60-impl/routes-smoke.ts
bun --tsconfig-override /home/notnotype/CodeRepository/neuro-book/.worktree/w00017-t60-impl-review/packages/neuro-book/tsconfig.json /tmp/claude-1000/-home-notnotype-CodeRepository-neuro-book/c38df555-3a36-49c9-bf4f-4027b5da6d32/scratchpad/omp-t60-impl/commands-smoke.ts
packages/nb-runtime/node_modules/typescript/bin/tsc --noEmit -p /tmp/claude-1000/-home-notnotype-CodeRepository-neuro-book/c38df555-3a36-49c9-bf4f-4027b5da6d32/scratchpad/omp-t60-impl/tsconfig-types.json
bun /tmp/claude-1000/-home-notnotype-CodeRepository-neuro-book/c38df555-3a36-49c9-bf4f-4027b5da6d32/scratchpad/omp-t60-impl/type-numeric.ts
```

- `delivery-smoke.ts`：退出码 0，复现发现 1 的交错；实例正常关闭。这里退出码 0 表示实验完成，不表示串行合同通过。
- `routes-smoke.ts`：退出码 0。观察到准备阶段不挂载、另一项准备失败释放路由预占、显式恢复挂载、接收者关闭摘下路由、新接收者补交且旧句柄不复活、贡献方撤回及同 id 新代次挂载。
- `commands-smoke.ts`：退出码 0。真实服务端与浏览器应用经进程内链路互调；两个坏键原因齐全，诊断按（命令，键）恰好 3 条，反复查询、执行与远程 `list` 不增加；后来声明并绑定后直接调用及响应式 `computed` 恢复，值变化与停止均使结果更新。
- 数值键静态检查与 `type-numeric.ts`：均退出码 0，结果见发现 2。

验证限制：未运行应用全量测试、Vitest 组件测试、e2e、开发服务、`smoke:server`、`test:affected`、docs/governance 检查或变异实验。Lab 原因呈现路径只做源码核对，未做浏览器视觉验证；`publicState` 仅登记但未绑定时内核目录不使已求值的 `computed` 自动失效，这是源码已有明确边界，本次验证的是声明并绑定之后恢复。命令实验成功运行时 Bun 同时输出 `Internal error: directory mismatch for directory ".../packages/neuro-book/tsconfig.json", fd 3. You don't need to do anything, but this indicates a bug.`；业务断言均完成，作为 Bun 配置读取诊断保留，不列为本次实现问题。初版命令实验缺少远程访问上下文的 `onRelease`，已改为通过真实服务端插件入口取得 `context.remote` 后再验证；该实验错误没有计入发现。

## 未发现问题的方面

- **已运行验证**：本地委托入口与相关独立测试已删除，签发记录的远程收口保留为 `#releaseIssued`；远程委托测试及示例场景 5 通过，覆盖伪造身份、错误接收入口、释放后身份、未声明合同、允许清单和门面／订阅释放次序。
- **已运行验证**：贡献校验收敛成单参数，跨点递归和环推导删除；声明查询仍按存活登记只读推导。相关真实内核测试通过，别的贡献点登记与撤销不改变这条声明的单条校验结果。
- **已运行验证**：除了发现 1 的通知串行缺口，整批准备屏障、准备失败逆序撤回、贡献方停止后的迟到阻断、接收者与贡献方同时关闭的单次撤回均有通过的真实内核测试；真实 HTTP 实验又验证了预占撤回与重新登记后的补交。未发现本次删除 `commit` 遗漏工作台页面表的迁移。
- **已运行验证**：命令坏键不再妨碍登记，求值返回所有坏键，诊断按结构化的（命令，键）去重，没有解析错误文案；后来声明并绑定能恢复。`isEnabled`、执行与远程 `list` 共用同一套判定，真实跨实例实验及指定测试通过。
- **已运行验证**：除发现 2 的数值键边界，现有 `defineEntry` 漏写、多写和形状错误反例均随 `tsc` 检查；同步字面量、异步激活、整个产出的条件分支与带参数的辅助函数通过。运行时按 id 核对仍保留。同形 id、宽类型和运行位置相关性的静态限制已写明，与计划接受的调整一致。
- **已运行验证**：`orThrow` 成功返回值，失败保留原始 `failure` 并抛 `RemoteCallError`；路由失败、业务失败及带 `cause` 的 `unknown-outcome` 测试通过，没有重试或重分类。
- **源码核对与示例运行**：`counter`／`board` 的只转发本地包装及相应键、接口删除，场景改为真实插件直接调用合同；示例全部随内核测试通过。选用规则、可选功能降级和合同值导入说明落实计划调整，没有把任意远程失败解释为“未安装”。
- **源码核对，未做视觉验证**：Lab 检视器仍从求值结果显示 `evaluation.reason`，远程 `list` 则输出可用性与原因。面板隐藏不可用项的既有行为与实施调整一致。
- **差异审查**：未发现新增按错误文案分支、产品测试专用分支、跳过测试、跨包源码深导入或范围外删除。观察者异常隔离为基线行为；本次交付失败、通知失败和撤回失败均保留诊断。命令 `published` 的登记失败分支有诊断；正常产品服务不公开登记／别名接口，且贡献校验与命令表共用校验、id 唯一由内核保证，本次未发现合法真实时序可让该分支吞掉一个应失败的激活。

## 只读与规则处理

`git status --short --branch` 的实际结果为 `## HEAD (no branch)`，没有已跟踪或未跟踪的仓库文件改动。审查过程未 commit、push、stash 或切换分支；主动写入只在指定 scratch，依赖只安装到忽略的 `node_modules`。

临时命令实验已按类型规则改用 `ActivationContext`、`CommandService` 和固定键的 `Record`；保留的实验源码中没有宽类型逃逸。规则本身已明确，不提出重复的规范回写，也没有修改仓库规则。

独立类型审查与规范／示例审查均复核了数值键静态缺口，没有提出其它可独立成立的问题；条件分支联合输出和 `provide` 对象字面量疑点未形成已核实发现，不计入问题数量。报告的严重程度、位置与运行结果以主会话实验为准：多余贡献实现及贡献点在运行时被忽略，不能写成内核会拒绝所有多余产出。
