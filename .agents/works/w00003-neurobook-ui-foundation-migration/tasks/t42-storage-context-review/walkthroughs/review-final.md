# 工作台 Storage 消费上下文最终追加复核

Task：[t42](../README.md)；被审实现：[t40](../../t40-workbench-storage-context/README.md)；首轮报告：[review.md](review.md)。
复核日期 2026-09-16，只读被审源码，未修改实现、测试、Spec 或 Work。探针运行后已用单文件移动移回本 Task `evidences/`。

## 结论

**建议合并**：原 2 项确定缺陷已闭合（P1 Project 释放失败跳过 user 清理、P2 已借用 facade 在切换后仍接纳写入），
Leader 指定的 6 项追加复核点全部通过，t40 声明的聚焦集 6 文件 94 用例复跑一致，本轮 9 个独立探针全部通过。
未发现新的阻断缺陷；下面 5 条为非阻断观察，其中观察 1、2、3 建议随提交在 `app/utils/storage/README.md` 补一句说明，不需要改代码。

## 被审 revision

复核开始与结束时各核一次哈希，两次一致（命令与 cwd 见证据文件）：

| 文件 | sha256 |
|---|---|
| `packages/neuro-book/app/utils/workbench/storage-context.ts` | `bea8a5e2fbc9bef123ae6a41754449a46d9ab835dfb4c643834f0dd1a55e7b8a` |
| `packages/neuro-book/app/utils/workbench/storage-plugin-sample.ts` | `de242a75a7e6f0159ab6f99d33df8db84db282294baedfd1a8cb848ac3947040` |
| `packages/neuro-book/app/utils/storage/README.md` | `dbd132bf5ff260b7a0d8f6ef9510c6db2b335c03d45a1e625a319dba34472194` |

Hash 与首轮 `review.md` 记录不同，符合 t40 第二轮返工预期；与两轮 t40 Leader 复核期间的文件无并发改动。

## 指定复核点与结论

| 复核点 | 结论 | 证据 |
|---|---|---|
| 两 scope `allSettled` 清理：Project 释放失败不跳过 user | 闭合。Project 句柄释放抛错时，user 句柄 `release()` 与 `closeContext(user)` 都被调用；`release()` 以 `AggregateError("释放工作台 Storage 资源失败")` 明确拒绝 | 探针1；t40 用例「Project 清理失败仍会释放 user，重复 release 共同等待同一结果」 |
| facade 同步失效（切换/abort/release 同步入口） | 闭合。门禁在 `project === null` / `accepting === false` 的同步改写处生效，新写入在委派前被拒绝，transport 未收到第二次 `save`；此前已接纳 `save` 正常排空 | 探针2、探针3、探针8；t40 用例「Project 切换同步封锁已借用 facade…」「workbench release 同步封锁 user facade」 |
| `releaseScope` 同时启动已有 `raw.release()` 并等待 `opening` | 闭合。已被另一个 owner 在途打开卡住的 project 作用域下，已打开句柄的订阅在 gate 未放行时即已关闭（`Storage 订阅已关闭`）；迟到的 gated 句柄自身被 `release()` 回收一次；`enterUserSurface` 仍按合同等待在途打开收口（观察 1） | 探针2；`storage-context.ts` `releaseScope` → `access.handles` 同步 `map(({raw}) => raw.release())` |
| 重复 `release()` 共同等待 | 闭合。`context.release() === first`，两侧清理共同结算，结果一致 | 探针1；t40 用例 |
| 样例保留未知字段、损坏/高版本不当缺失覆盖 | 闭合。保存由样例 owner 合入 `{...projection.value, 已知字段}`，调用方只传 `{compact}` / `{pinned}`；记录回读仍含 `future`；`corrupt` / `unsupported-version` 抛错且未发出任何写动作 | 探针6；t40 用例「保存已知字段时保留投影中的未知字段」；`storage-plugin-sample.ts` `projectReadable` |
| 内存订阅监听器异常隔离 | 闭合。抛异常监听器不影响同 `selection` 的其它消费者，`set` 返回已提交值 | t40 用例「选择订阅者异常不会中断其它消费者」；`storage-context.ts` `set` 内 `try/catch` + 注释 |

## 独立探针（9 项，全部实测通过）

命令：`bun run test app/utils/workbench/t42-final-probe.test.ts`
cwd ：`.../w00003-neurobook-ui-foundation-migration/packages/neuro-book`，退出码 0（Test Files 1 passed，Tests 9 passed）。
源码 `evidences/t42-final-probe.test.ts`，原始输出 `evidences/t42-final-probe-output.txt`。等待点只用微任务轮转与 `setImmediate`，不绑定真实时长。

1. Project 句柄释放失败时 user 句柄与两个 session 都被清理，重复 `release()` 同一 Promise。
2. 切换时已打开句柄立即停止（订阅在 gate 未放行前即关闭），迟到 gated 句柄被回收一次，且切换 PROMISE 仍在等在途打开。
3. 切换同步入口立即封锁 project facade 且未发出 `project:save`；同一切换期间 user facade 仍可真实读取。
4. `project.invalidate()` 尚在途时调用 `release()`，`release()` 不会提前结算（等待在途 Project 释放）。
5. 旧 Project 释放失败后 `enterProject` 明确 reject，后续 `enterProject` 正常发布且不被污染。
6. 样例遇到 `corrupt` 与 `unsupported-version` 抛诊断错误，写动作数组为空。
7. AbortSignal 失效 + 释放失败路径无未处理拒绝（阳性对照 `evidences/t42-final-unhandled-control-output.txt` 输出 `CONTROL-CAUGHT: control-rejection`），失败经 `project.released` 可观察。
8. 工作台释放时 user 已接纳写入仍排空，`save` 完成后才 `closeContext(user)`。
9. 释放期间失败的 owner 打开被计入 `release()` 失败；借用方只看到 `workbench-released`（观察 2）。

基线复跑：`bun run test app/utils/workbench/storage-context.test.ts app/utils/workbench/storage-plugin-sample.test.ts app/utils/storage`
→ 6 文件 94 用例通过，exit 0，与 t40 报告一致（`evidences/t42-final-focused-suite-output.txt`）。

## 非阻断观察

1. **`enterUserSurface` / `enterProject` 的等待范围未写进文档**（实测，建议补一行）：二者返回的 Promise 会等到旧 Project 的
   在途 owner 打开收口，因此在途 `bind` 受 15s 请求期限约束时，切换到 user 工作面最多等待同样时长；句柄本身不等它
   （探针2 证明订阅已停）。`app/utils/storage/README.md` 现只写了 `release()` 等待已接纳初始化。
2. **`release()` 会把在途 owner 打开的失败计入清理失败**（实测）：非 `storageContextUnavailable` 的打开失败被 push 进
   `AggregateError`，而借用方此时只拿到 `workbench-released`（探针9）。这是「合并明确错误」的一种取舍，但同一失败不算资源泄漏；
   若后续要区分，`releaseScope` 可只聚合句柄与 session 清理错误。不阻断当前提交。
3. **旧 Project 释放失败后 `target` 已指向新 ready，而 `projectOwner` 返回 `project-unavailable`**（实测，探针5）：
   `target` 表达本次明确目标，不保证已发布；消费 UI 必须同时看 `project.available` / `projectOwner()`，不能只用 `target.kind` 判定可用。
   文档目前未说明这层区别。
4. **失效后的 `selection.subscribe` 静默返回 no-op 取消器**（读码）：`get`/`set` 返回 `unavailable`，`subscribe` 只返回空函数，
   与「旧引用拒绝读写」的显式风格不一致；当前合同未覆盖订阅，是否统一由后续消费者接线决定。
5. **首轮次要观察仍在**（读码，未改）：`ensureSession` 的 `access.session.scope === "user" ? A : A` 两支相同（判别收窄需要，建议加注释）；
   `borrowOwner` 迟到分支释放 raw 句柄后仍保留 `access.handles` 条目（依赖 `StorageOwnerHandle.release` 幂等与作用域拒借兜底）。

## 未运行项

- 全包 `typecheck` / build / 全量测试：按 Task 规则由 Leader 统一验证，本复核不并行写生成物。
- 产品宿主、浏览器人工验收、服务端与 3001：被审实现不接线主页面，本 Task 不做。
- 未验证 t40 报告的 typecheck 结论（其 6 个诊断归属并行 t37），不在本 Task 范围。

## 残余风险

- 观察 1–3 属文档/语义边界，未改代码；需要消费 UI 接线（切片3后续）时按实际用法收口。
- 本复核只覆盖被审两个模块的公开行为与真实适配器链路；grid 与 Splitter 并行任务按其自身 Task 复核。

## 证据文件

- `evidences/t42-final-probe.test.ts`（9 个探针源码）、`evidences/t42-final-probe-output.txt`
- `evidences/t42-final-focused-suite-output.txt`、`evidences/t42-final-unhandled-control-output.txt`
- 首轮文件（`t42-review-probe.test.ts` 等）保留不动。
