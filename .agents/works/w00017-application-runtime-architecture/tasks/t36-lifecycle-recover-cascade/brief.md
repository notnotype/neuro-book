# 任务说明：内核显式恢复一次完成整条依赖链（w00017 t36）

你是本任务的编码者。主 Agent（Claude）会审查你的 diff、自己重跑验证并决定验收。用简体中文写最终汇报。

## 背景

t34（提交 `5808b507`）把产品服务迁成多层依赖的插件后暴露出一个内核缺陷：关闭时一处释放失败，故障排除后，每调用一次 `application.recover()` 只能往下推进一层依赖。第 1 次关闭 Agent、Project、Files，第 2 次关闭 Session Store 与 Storage，第 3 次才关闭 App State。证据见 `.agents/works/w00017-application-runtime-architecture/tasks/t34-builtin-service-plugins/evidences/source-recovery-proof.txt`。

`docs/specs/runtime/lifecycle.md` 状态表规定：显式恢复对失败且无在途清理的资源发起新的关闭尝试，成功即到“已关闭”。所以一次恢复就应完成整条依赖链，现状违反合同。t34 因此把 `packages/neuro-book/server/runtime/product-startup.test.ts` 中“Project child释放失败时保留Session lease，显式恢复完成后才释放”这条用例临时改成循环调用 `recover()`，每次断言有进展。

主 Agent 的初步判断（从代码推断，未验证，请你先复现确认）：`runtime/lifecycle/scope.ts` 的 `#runAttempt` 先调用 `#advanceChildren`，对停止中的子作用域同步调用 `child.recover()`。每个子作用域的 `#runAttempt` 在同步段内就做 `computeReleasePlan`，而判断借用者是否“活跃”的 `#isActiveBorrower()` 只看借用者自己有没有在途尝试。级联是深度优先、同步进行的，提供方评估时，另一棵子树里的消费者往往还没被级联到、没有在途尝试，于是被当作“已停滞的借用者”，提供方的资源判为 `blocked`，本次尝试就此结算。

## 目标

1. 先写一个内核层的失败测试复现该现象：在 `runtime/lifecycle` 层构造“提供方作用域的资源被另一棵子树中的消费者作用域借用，消费者的资源第一次释放失败”的结构。故障排除后一次 `recover()` 应得到 `closed`，修复前它得到 `incomplete`。用 `runtime/plugins` 或 `runtime/application` 层的多层依赖链（例如 A→B→C 三层服务依赖、最下游消费者释放失败一次）再补一个同样的用例。
2. 修复内核，使一次显式恢复（以及父作用域级联的恢复）在失败原因已排除时推进整条依赖链，直到全部关闭或遇到真正失败或停滞的节点为止。修复方案由你设计，在汇报中说明为什么选它。约束：
   - 不改变 `lifecycle.md` 的其它语义：不自动循环重试，同一尝试内释放失败的资源不重试；在途清理不重入；超时只记本次尝试为未完成；
   - 借用者真的停滞时（它的尝试已结算且仍未释放借用），提供方仍须判为 `blocked`，不能因为改动而无限等待或死锁；为此加一个测试；
   - 首次 `close()` 的行为不变（现在它已能按依赖顺序推进）。
3. 把 `server/runtime/product-startup.test.ts` 中那条用例恢复为“故障排除后一次 `application.recover()` 得到 `{status: "closed"}`”，其余断言（Project 未关闭不释放租约、Project 先于租约释放、各释放只发生一次、重复停止无第二次副作用）保留。

## 不做

- 自有服务端入口、`nbook.http`、停止来源汇合（后续 Task）；
- `lifecycle.md`、`plugins.md` 等 Spec 文本（由主 Agent 更新）；
- 其它内核行为的重构。

## 允许改动的文件

- `packages/neuro-book/runtime/lifecycle/**`（含测试）
- `packages/neuro-book/runtime/plugins/**`、`packages/neuro-book/runtime/application/**` 的测试文件（只加用例或因修复必须调整的断言，调整须在汇报中逐个说明理由）
- `packages/neuro-book/server/runtime/product-startup.test.ts`（只改目标 3 那条用例）
- 本 Task 的证据目录 `.agents/works/w00017-application-runtime-architecture/tasks/t36-lifecycle-recover-cascade/evidences/`

不改：其它产品代码、`docs/**`、任何 `README.md` 与 Work/Task 文档、`package.json`、`tsconfig*.json`、`vitest*.config.ts`。确实需要改列表外的文件时，先在汇报中说明原因，不要自己改。

## 验证命令与完成标准

在 `packages/neuro-book` 下：

1. 新增的失败测试：修复前失败、修复后通过，两次输出都保存。
2. `bun run test:runtime-foundation` 与 `bun run test server/runtime server/features`：全部通过。
3. `bun run typecheck:runtime-foundation`、`bun run scripts:typecheck`：0 错误。`bun run typecheck` 与全量 `bun run test` 由主 Agent 跑，你不用跑。
4. 把第 1–3 步的完整输出保存到证据目录。

本机内存有限，一次只跑一个重任务。

## 禁止清单（汇报前逐条自查，在汇报中逐条写明结果）

- 不按错误文案做程序分支，用错误类型或错误码；不用静默的 `catch` 吞掉错误，至少写一条诊断；
- 不为让测试或检查通过而掩盖问题：不跳过测试、不放宽断言、不把一种失败改报成另一种，不在产品代码里加测试专用分支；
- 不删除或替换任务之外的已有代码行、配置项和注释，也不顺手改写无关注释；
- 重构时保留原有的清理与收口语句（例如失败分支里的资源释放），不留下多余的第二条路径或不可达的代码；
- 不跨包深导入其它包的源码，跨包只经包名与公开入口；
- 不确定能否检查或实现时，先找现有的自然做法，不要直接标成“无法做到”。

设计与主要编码由你自己完成，不交给子代理；子代理只用于调研、审查或批量机械改动这类独立、简单而工作量大的活。

另外：不 `git commit`、`git push`、`git stash`、切分支，不改 git 配置；不设置 http_proxy，不改时区与 locale；测试产生的临时数据放在系统临时目录并清理；注释用中文，只写边界上不明显的原因，不复述代码。仓库规则见 worktree 根目录的 `AGENTS.md`，TypeScript 规范见 `docs/standards/code/`（测试不匹配源码字符串）。不要触碰 `packages/neuro-book/docs/research/README.md`（开发者自己的改动）。

## 最终汇报

先写入证据目录的 `delivery.md`，再输出同样内容：

1. 结论：完成标准 1–3 各自的结果（附证据文件名）；
2. 根因：复现结果是否证实初步判断，若不同写出实际原因；
3. 修复：方案、为什么选它、如何保证“借用者真停滞时仍判 blocked、不死锁”；
4. 新增与调整的测试及理由；
5. 公开行为是否变化（主 Agent 据此更新 Spec）；
6. 改动的文件列表；
7. 禁止清单逐条自查结果；
8. 后续需要注意的问题（不超过 5 条）。
