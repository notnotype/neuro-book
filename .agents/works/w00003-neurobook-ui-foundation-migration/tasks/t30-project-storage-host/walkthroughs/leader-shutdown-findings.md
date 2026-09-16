# 最后一轮主 Agent 检查：关停排空与异步锁核验

2026-09-16，检查 t30 final 补修尚在进行的工作树。首轮绿色不能覆盖这两点。

## 已复现：整体 shutdown 误拒绝已接纳操作

系统 Temp `neuro-book/acceptance/storage-adapter-t26/project-shutdown-guard.vitest.mjs` 用 Vitest pre-load
在既有 `project-session-service.test.ts` 末尾临时附加一个用例，工作树测试文件未改：
开 ready → `runReadyProjectOperation` 等门 → `service.closeAll()` → 放门 → operation 调
`revalidateTarget(); assertTarget();` → 期望 saved。

真实结果：1 failed / 22 skipped，实际 `{ok:false, code:'PROJECT_NOT_OPEN'}`，期望 `{ok:true,value:'saved'}`。
根因：`projectTargetGuard()` 仍拒绝 `this.state !== running`；关闭已建立接纳 gate，不应让这条既有能力再次要求 open。
此外真实 `ProjectLifecycle.revalidateWorkspace()` 的 `assertRunning()` 在 lifecycle close 后也会拒绝；
以上轻量 stub 未复现第二层，修复时应对真实 Lifecycle 保留只读物理复核能力，不能用 stub 绿掩盖。
Service/Runtime 的精确 entry、ready、targetInvalid、Occupancy 核验仍须保留。关闭后的新操作继续被原接纳 gate 拒绝。

## 静态发现：异步 guard 之后须再查锁健康

`StoragePartitionStore.assertMutationHealthy()` 现为 await guard → await containment → lock.assertHealthy → await guard。
最后一次 guard 新增异步磁盘复核；等它期间锁可能已 compromised，返回后目前直接允许副作用。
末尾需要同步 `context.lock.assertHealthy()`，并有可控 guard Promise 的回归，证实锁在最后复核 await 期间失效仍停写。

这两点是现有合同内的实现补修，不降低 Spec，也不扩大功能。
