# t36 交付汇报

## 1. 结论

1. **完成标准 1：通过。** 修复前新增的生命周期跨子树用例与插件三层依赖用例均稳定失败，结果为 `incomplete`；完整输出见 `red-before-fix.txt`。修复后，两个回归用例与真实停滞用例通过，见 `green-targeted.txt`；生命周期与插件聚焦套件共 `97 passed`，见 `runtime-focused-after-fix.txt`。
2. **完成标准 2：通过。** `test:runtime-foundation` 为 `19` 个测试文件、`222` 个测试全部通过，见 `test-runtime-foundation.txt`；`test server/runtime server/features` 为 `15` 个测试文件、`116` 个测试全部通过，见 `test-server-runtime-features.txt`。真实 server 与 services smoke 均 `failures=0`，见 `smoke-runtime-server.txt`、`smoke-runtime-services.txt`。
3. **完成标准 3：通过。** `typecheck:runtime-foundation` 与 `scripts:typecheck` 均退出码 `0`，无诊断输出，见 `typecheck-runtime-foundation.txt`、`typecheck-scripts.txt`。按任务要求未运行全量 `bun run typecheck` 与 `bun run test`，留给主 Agent。

## 2. 根因

复现证实了初步判断。`ScopeImpl.#runAttempt()` 先同步调用 `#advanceChildren()`；子作用域的 `recover()` 会在同步段立即进入自己的释放规划。提供方规划借用资源时，另一棵子树的消费者尚未建立在途尝试，`#isActiveBorrower()` 将其视为停滞借用者，提供方因此被标记为 `blocked` 并结束本次尝试。跨子树生命周期用例和 A→B→C 插件服务依赖用例在修复前都准确得到该现象。

## 3. 修复

- `#startAttempt()` 先登记 `#latestAttempt` 并保留原有 `#notifyRelated()`；它通过级联路径同步登记整棵后代子树的尝试，当前作用域的 `#runAttempt()` 保持同步启动，后代作用域的实际执行排入 `queueMicrotask()`。
- 这样提供方开始释放规划时，消费者分支已有可观察的在途尝试，不会被误判为停滞；同时保留首次 `close()` 原本在调用方让出一次 microtask 前就启动资源释放的时序。
- 没有引入自动循环重试：每个停止中的子作用域仍只在本次级联中启动一次新的尝试；同一尝试的 `attempted` 集合仍禁止失败资源重试；`releasing` 资源仍等待原清理结算，不重入；deadline 仍只结算当前尝试为 `incomplete`。
- 真实停滞保持 `blocked`：新增的始终释放失败借用者用例中，第二次恢复仍返回 `incomplete/blocked`，借用者释放恰好调用两次，提供方释放为零，且调用正常结算而非挂起。证据见 `green-targeted.txt`。
- 首次 `close()` 的现有顺序与行为由完整 runtime-foundation 套件和 services smoke 覆盖，未观察到回归。

选择该方案的原因：它只改变级联尝试的启动时序和遍历范围，不改资源依赖图、失败状态、重试次数或 deadline 合同；用最小的批量启动保证任意深度的兄弟/嵌套子树在释放规划前都可见，避免增加新的全局调度状态。

## 4. 新增与调整的测试及理由

- `runtime/lifecycle/lifecycle.test.ts`：新增跨子树借用者首次释放失败用例，锁定修复前 `incomplete`、修复后一次根 `recover()` 得到 `closed` 的真实合同。
- `runtime/lifecycle/lifecycle.test.ts`：新增借用者恢复仍失败用例，锁定真正停滞时提供方必须保持 `blocked`、不得等待或释放。
- `runtime/plugins/plugins.test.ts`：新增 A→B→C 三层服务依赖用例；C 的下游消费者资源第一次释放失败，验证插件/服务层父作用域恢复一次完成整条依赖链。
- `server/runtime/product-startup.test.ts` 目标用例：把故障排除后的循环 `application.recover()` 改为一次调用，保留 Project 未关闭不释放 Session lease、Project 释放先于 lease、各释放次数和重复停止断言。
- `server/runtime/product-startup.test.ts` 另一条旧恢复断言：原断言要求第一次恢复仍为 `incomplete`，与修复后的生命周期合同及指定集成命令冲突；该命令在修复后唯一失败点就是此旧断言，故将其最小调整为一次恢复得到 `closed`，保留首次停止不完整、独立插件已关闭、依赖资源首次未释放与最终只释放一次等断言。该额外调整见 `test-server-runtime-features-before-adjustment.txt` 与最终 `test-server-runtime-features.txt`，主 Agent 可据此审查是否接受此合同同步。

## 5. 公开行为是否变化

变化：失败原因已排除且无在途清理时，显式恢复以及父作用域级联恢复现在一次推进全部可达依赖链，直到全部关闭或遇到真实失败/停滞节点。

不变：首次 `close()` 顺序、失败资源不在同一尝试内重试、在途清理不重入、deadline 语义、真正停滞的 `blocked` 结果、重复停止幂等性。Spec 文本未修改，主 Agent 可据此更新 `lifecycle.md` 等合同说明。

## 6. 改动的文件列表

- `packages/neuro-book/runtime/lifecycle/scope.ts`
- `packages/neuro-book/runtime/lifecycle/lifecycle.test.ts`
- `packages/neuro-book/runtime/plugins/plugins.test.ts`
- `packages/neuro-book/server/runtime/product-startup.test.ts`
- `.agents/works/w00017-application-runtime-architecture/tasks/t36-lifecycle-recover-cascade/evidences/` 下本 Task 的验证输出与本文件

未修改 `docs/**`、配置、`package.json`、`tsconfig*.json`、`vitest*.config.ts`。`packages/neuro-book/docs/research/README.md` 的已有开发者改动保持不变。

## 7. 禁止清单逐条自查

1. **按错误类型/状态分支：通过。** 产品代码没有按错误文案分支；本次没有新增静默 `catch`。测试中的抛错仅用于构造释放失败，不参与产品分支。
2. **不掩盖问题：通过。** 未跳过测试、未放宽断言、未添加测试专用产品分支；失败输出与最终通过输出均保留。
3. **不改任务外代码：通过。** 只修改允许列表中的生命周期实现、内核/插件测试和产品运行时测试；未改配置、无关注释或其它产品代码。额外旧恢复断言的调整已在第 4 节逐项说明。
4. **保留清理收口：通过。** 保留 `#notifyRelated()`、失败资源状态收口、pending 清理等待与 deadline 收口；没有新增第二条释放路径或不可达代码。
5. **不跨包深导入：通过。** 新测试只使用已有公开 runtime 入口与同目录测试工具，没有跨包深导入。
6. **不确定先查自然做法：通过。** 先复现并读取 lifecycle、close-plan、plugins、services 的现有依赖/恢复路径，再按现有尝试模型完成修复。

## 8. 后续需要注意的问题

1. 产品测试中原先用于记录旧逐层恢复行为的断言已与新合同冲突；主 Agent 应确认该最小断言调整并同步 Spec。
2. 全量 `bun run typecheck` 与全量 `bun run test` 未运行，按任务约定由主 Agent 验证。
3. 本次调度依赖 microtask 批量登记级联尝试；若未来把关闭 API 改为同步可观察 API，需要重新评估该时序边界。
4. 本 Task smoke 创建的系统 Temp scratch 已由 smoke 自身删除；未在仓库、worktree 或用户数据目录写入测试临时数据。

## 反思回写建议

| 编号 | 类别 | 依据 | 建议修改 | 目标位置 |
| --- | --- | --- | --- | --- |
| 1 | 踩坑 | 在包目录作为工作目录执行相对路径证据重定向时，证据误写入 `packages/neuro-book/.agents`，清理时误删包内 legacy `.agents`；已从 HEAD 原样恢复。 | 在需要写入仓库根治理/证据路径时，命令固定从仓库根执行并使用仓库根相对路径；包内验证命令只负责运行，不混用根路径写入。 | `AGENTS.md` 的后台/证据路径约定，或 `docs/testing/README.md` 的证据保存说明 |

## 返工 1

### 触发原因

完整 harness 回归首次出现 `2 failed`：两个未修改的 harness 用例在 `closeProjectForTest()` 后只让出一次 `Promise.resolve()` 时仍观察到 `projectOccupancy()` 为 open。根因是上一版把当前作用域的 `#runAttempt()` 也排入 microtask；资源释放回调内部还要等待已完成的 opening Promise，因此其 terminal gate 晚于调用方续体建立。

### 修复决策

- `close()` 与 `recover()` 继续在当前同步段启动本作用域的释放规划，恢复原有可观察时序。
- `#startAttempt()` 在启动本作用域规划前，同步递归登记整棵后代子树的 close/recover attempt；子作用域的实际 `#runAttempt()` 排入 microtask。
- 新增 `AttemptExecution` 与级联专用的 `#closeFromCascade()`、`#recoverFromCascade()`，避免通过公开入口重新触发不同的启动时序。
- 这样 provider/consumer 的所有在途 attempt 在任一释放规划前都已可见；没有新增自动重试，失败资源、真实停滞、在途清理和 deadline 语义不变。

### 返工验证

以下命令均从 worktree 根目录执行；仓库根 `package.json` 没有同名 `test`/`test:runtime-foundation` 脚本，因此通过 `bun run --cwd packages/neuro-book ...` 调用实际 package script，完整输出保存在本目录 `rework-1-*.txt`：

- `bun run --cwd packages/neuro-book test -- server/agent/harness/neuro-agent-harness.test.ts`：`1` 个文件、`195 passed`，退出码 `0`。
- `bun run --cwd packages/neuro-book test:runtime-foundation`：`19` 个文件、`222 passed`，退出码 `0`。
- `bun run --cwd packages/neuro-book test -- server/runtime server/features`：`15` 个文件、`116 passed`，退出码 `0`。
- `bun run --cwd packages/neuro-book typecheck:runtime-foundation`：退出码 `0`。

未修改 harness 测试；临时 timing probe 已移除。工作区现存的 `packages/neuro-book/docs/research/README.md` 修改仍为开发者原有改动。
