# 工作台 Storage 消费上下文独立复核

Task：[t42](../README.md)；被审实现：[t40](../../t40-workbench-storage-context/README.md)。
复核日期 2026-09-16，只读被审源码，未修改实现、测试、Spec 或 Work。探针运行后已移出仓库（见下文证据）。

## 结论

**需要修复**：2 项确定缺陷，均以真实探针复现（非读码推断）；其余 6 项优先复核点经实测无阻断。

## 被审 revision

| 文件 | sha256 |
|---|---|
| `packages/neuro-book/app/utils/workbench/storage-context.ts` | `bf5bdc2f86467f9faa0862bcfb368ac1a3bb04d959687daf227f68d66d990dbd` |
| `packages/neuro-book/app/utils/workbench/storage-plugin-sample.ts` | `99fe4e0ccb71ffd028bfea2ff346fc33cd61fc1bc6405d8307778d4f4f2415e4` |
| `packages/neuro-book/app/utils/storage/README.md` | `834f7fd56c7383f6ccc2f4a69286d31e43e7d16ee7455f16a4c15bbc41d1cc12` |

复核开始与结束各核一次，三个文件 hash 一致（`storage-context.test.ts`、`storage-plugin-sample.test.ts` 为未跟踪新增，未参与 hash 比对）。t40 收口期间若再次改动，本结论需要按新 hash 追加复核。

## 确定缺陷

### P1 `release()` 遇到 Project 释放失败时跳过 user 句柄与 session 清理，且无法重试

位置：`storage-context.ts` `createWorkbenchStorageContext` 的 `release` 实现。

```ts
releasePromise = queueProjectRelease(previous).then(() => releaseScope(user, adapters));
```

`releaseProject` 在句柄排空或 `closeContext` 失败时 reject（`releaseScope` 抛 `AggregateError`），整条 `.then` 链因此拒绝，`releaseScope(user, …)` 永不执行。Project 自身的 session 仍会在同一次 `releaseScope` 内关闭，被跳过的是 user 一侧的全部清理。

真实复现（探针1，文件 `evidences/t42-review-probe.test.ts`）：

```
命令：bun run test app/utils/workbench/t42-review-probe.test.ts
cwd ：<worktree>/packages/neuro-book
退出：0（8 个探针全通过，即被断言的缺陷行为成立）
```

实测结果：Project 句柄释放抛错后

| 观察点 | 实测 |
|---|---|
| `closeContext(project)` | 已调用 |
| user 句柄 `release()` | **未调用** |
| `closeContext(user)` | **未调用** |
| `release()` 再次调用 | 返回同一 rejection，`closeContext` 总调用次数仍为 1 |

影响：user 分区句柄与访问上下文在应用关闭流程中不排空，与 [storage.persistence](../../../../../docs/specs/storage/persistence.md)「关闭 Project / 应用时拒绝接纳新操作……user 分区也参加应用关闭」冲突；user 句柄上已建立的订阅（`owner-handle.ts` 默认 500ms 串行观察）在释放失败后继续存活，浏览器端没有 `unref` 兜底。

建议方向：两段清理分别捕获错误后再合并成一个 `AggregateError`，不要用 `.then` 串接；同时让重复 `release()` 保持共同等待（现状已满足共同等待，缺的是第二次清理机会）。

### P2 切换目标后，已借用的 owner facade 仍接纳新写入

位置：`ownerFacade()`（只做绑定，不带任何生命周期门禁）与 `releaseScope()` 的清理顺序（先 `await` 全部在途 `handleOpenings`，再逐个 `raw.release()`）。

工作台层面的门禁只覆盖"再次借用"（`project.owner()` 返回 `project-invalidated`、`memory` 立即不可用），对**已经返回给消费者的 facade**没有拦截：它直连底层 `StorageOwnerHandle`，只有 `raw.release()` 真正被调用后才以 `STORAGE_HANDLE_CLOSED` 拒绝。而 `raw.release()` 被推迟到在途打开收口之后，窗口可以覆盖整个在途 bind 请求（README 声明受 15s 请求期限约束）。

真实复现（探针3，真实 `openStorageOwnerHandle` + 注入 `StorageValueTransport`，注入一个被 gate 卡住的第二个 owner 打开）：

```
命令：bun run test app/utils/workbench/t42-review-probe.test.ts
cwd ：<worktree>/packages/neuro-book
退出：0
```

实测结果：`context.target === {kind:"user-assets"}`、`project.available === false` 之后

- 已借用的 facade `save()` **成功**，注入 transport 收到 `t42.first/probe` 的 save 并返回 credential；
- gate 放行、在途打开被回收后，同一个 facade 再次 `save()` 才以 `STORAGE_HANDLE_CLOSED` 拒绝；
- 同一窗口内的迟到打开本身被正确回收（`lateRelease` 调用 1 次）。

与 [storage.boundaries](../../../../../docs/specs/storage/boundaries.md)「生命周期撤销上下文后，拒绝接纳以该上下文发起的新操作；已接纳操作如何完成、取消或排空沿用 Project owner 的生命周期边界」不一致：被接纳排空的范围被扩大成了"窗口内新发起的写入"。写入落在旧 Project 自己的分区，不造成跨 Project 污染，故不列数据危险，但"旧借用接口立刻失效"不成立。

建议方向：facade 方法在委派前同步检查所属 `ScopeAccess` 的接纳状态（同步入口不影响已接纳请求排空），或提供带代次门禁的 lease；把门禁落在工作台而不是依赖底层句柄的释放时机。

## 复核通过项（实测，非推断）

| 优先复核点 | 实测结论 | 证据 |
|---|---|---|
| AbortSignal 触发的失效链是否全部被观察 | 无未处理拒绝。`project.released` 全程不附加外部 handler，abort 后推进一个宏任务边界仍无 `unhandledRejection` | 探针2；阳性对照 `node -e "process.on('unhandledRejection', …); Promise.reject(new Error('control-rejection'))"` 输出 `CONTROL-CAUGHT: control-rejection`，证明探针能检出未处理拒绝 |
| A 释放等待中进入 B，再切 user-assets / release / abort，B 是否迟到复活 | 三种路径均不复活：B 返回 `project-invalidated` 或 `workbench-released` | t40 用例 + 探针7（`release()` 期间） |
| 打开/释放交错是否漏清理 | 迟到的 owner 打开会在释放收口前被回收，句柄释放先于 session 关闭 | t40 用例 `release 等待迟到句柄完成自身排空后才关闭 session` + 探针3 |
| 旧错误是否被新切换吞掉 | 不吞：拒绝发起切换的那次调用；旧 Project 已不在位后，后续切换正常继续 | 探针6 |
| 样例是否保留未知字段、损坏/未知版本是否被当缺失 | 保留：`{pinned:false,"x-unknown":"keep"}` 读回后按 `{...value, pinned:true}` 保存，未知字段仍在；`corrupt` 与 `unsupported-version` 均按 `diagnosis` 抛错，记录不被创建 | 探针5 |
| 真实适配器覆盖 | `storage-plugin-sample.test.ts` 只用真实 `openStorageOwnerHandle` + 注入传输贯穿 read/save/reopen，符合"不以自写 stub 代替真实适配器" | 读码 + 复跑 |

基线复跑（t40 报告声称的聚焦集）：

```
命令：bun run test app/utils/workbench/storage-context.test.ts app/utils/workbench/storage-plugin-sample.test.ts app/utils/storage
cwd ：<worktree>/packages/neuro-book
退出：0；Test Files 6 passed，Tests 89 passed
```

`app/utils/storage/README.md`「验证」里记录的 `bun run --cwd packages/neuro-book test app/utils/storage` 单独复跑也成立（4 文件 / 76 用例，exit 0），命令顺序符合根 `AGENTS.md` 的 `--cwd` 位置要求。

## 次要观察（不阻断，未计入缺陷）

1. **内存订阅隔离**：`ProjectSelectionMemory.set` 直接顺序调用 listener，任一 listener 抛异常会中断同 `selection` 的其它消费者，并让 `set()` 对调用方抛错（探针4：第二个消费者列表为 `[]`，值已更新为 `scene-1`）。`owner-handle.ts` 的 `emit`/`report` 已采用"观察者异常不破坏其它消费者"的做法，此处不一致。当前合同未直接规定内存投影的观察者隔离，建议按同一模式收口并在 README 说明。
2. **`enterUserSurface` 的返回语义**：它同步改写 `target`，但返回的 Promise 要等在途旧 Project 释放完成。t40 `evidences/leader-storage-context-probe.test.ts` 的原文 `await context.enterUserSurface("user-assets")` 在这版实现下会自锁（gate 只在 await 之后放行），复跑得到 5s 超时、exit 1（见 `evidences/t42-leader-probe-verbatim-output.txt`）；把 gate 放行移到 await 之前后，原文断言全部通过（`evidences/t42-leader-probe.test.ts`）。所以 P1 已修，但**该证据文件记录的"复制回同目录复跑"指令当前不可执行**，建议 Leader 更新该文件的调用顺序，并在 README 明确 `enterUserSurface` 返回 Promise 的等待范围。
3. **`ensureSession` 的重复三元分支**（`access.session.scope === "user" ? {…} : {…}` 两支相同）靠判别收窄满足类型；语义正确但读起来像笔误，建议加一行说明或抽出收窄 helper。
4. `borrowOwner` 在迟到判定后释放 raw 句柄，但同一条目仍留在 `access.handles`，依赖 `release()` 幂等与后续借用被拒来兜底；行为无害，`delete(owner)` 会更干净。

## 未运行项

- 全包 `typecheck` / build / 全量测试：按 Task 规则由 Leader 统一验证，本复核不并行写生成物。
- 产品宿主、浏览器人工验收：本 Task 无 UI，被审实现不接线主页面。
- 服务端注册、磁盘分区与 HTTP 动作入口的真实行为：本复核只读前端消费宿主，不启动后端、不访问 3001。
- 未验证 t40 报告的 typecheck 结果（6 个诊断归属并行 t37），该结论不在本 Task 范围内。

## 证据文件

- `evidences/t42-review-probe.test.ts`：8 个探针（探针1–7 + Leader P1 修正版）源码，复制回 `packages/neuro-book/app/utils/workbench/` 即可复跑。
- `evidences/t42-leader-probe-verbatim.test.ts`：t40 Leader 证据原文，未改动，用于核对复跑指令。
- `evidences/t42-probe-output.txt`、`evidences/t42-leader-probe-verbatim-output.txt`、`evidences/t42-focused-suite-output.txt`：原始命令输出。
