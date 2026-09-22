---
schema: nbook.task/v2
taskId: t27-storage-adapter-review
---

# Storage 浏览器适配器独立审查

## 当前追加复核（只看此项，不重做全审）

首轮 `walkthroughs/review.md` 已完成，结论需要修复。主 Agent 已修：

- value-transport 不再依赖 ofetch timeout；每请求独占 AbortController+15 秒计时器，链接外部取消，finally 清理。
  计时器覆盖完整 request Promise，包括返回响应头后未结束的响应体。notify 固定 false，由 owner/onError 展示错误。
- 删除 ReadEntry.started 死字段；修正 pool 顶部对复用范围的旧注释。
- 新测试用真实 createFetch 注入不答复与响应体卡住两种场景，同时带外部 signal；14,999ms 不完成、15,000ms committed=null、只请求一次、计时器无残留。
  `test app/utils/storage`：4 文件、59 用例通过；主应用 typecheck 与 Chrome 值 smoke 由主 Agent 重跑。

请仅复核这次修复与用例，必要时小探针；写 `walkthroughs/review-followup.md` 给正式结论，不修改代码。
顺便校正首轮表格的表述：schema mismatch 只终止受影响订阅，不把整个 owner handle 标 invalid；401/403/访问代次才失效整个句柄。
这个分离是设计选择，避免一个旧定义阻断同 owner 的其它当前定义。2 分钟内优先留下真实结论。

Work：[w00003](../../README.md)；实现：[t26](../t26-storage-browser-adapter/README.md)。
审查当前 worktree 相对于 `8b1229ea` 的 Storage 增量（含未跟踪的新前端与 smoke 文件）。
两个 descriptors 是用户既有 dirty，不在范围内。不修改产品源码、Spec 或 Task；仅写本 Task walkthroughs/review.md。
不联网、不再派代理、不提交、无真实用户 data 操作。

先写“审查进行中”报告，3 分钟内追加已查范围/发现，再完成剩余检查。不要把写报告留到期限最后。
主 Agent 已跑完整聚焦测试 26 文件 244 用例、主应用 typecheck 和真实 Chrome 值 smoke，通过；证据在
[implementation](../t26-storage-browser-adapter/walkthroughs/implementation.md)。无需重复大命令，必要时可运行小范围独立探针。
脚本全集 typecheck 的唯一错误是已登记的无关旧文件缺主题字段，不能声称全绿也不扩大修复。

重点按当前代码独立判断：

1. owner-handle.ts：接纳/释放排空、重复释放、订阅初始化和 refresh/close 竞态、串行读写、dirty 消耗、退避、401/schema 失效、输入捕获与响应校验。
2. value-transport.ts：实际 ofetch/H3 错误嵌套、committed=true 与未知结果、timeout/signal、禁自动写重放。
3. 服务端 diff：绑定第一 await 前捕获；池的绑定键、bind 独立打开和有界排空；旧客户端 schemaVersion 核对必须在读写前，不能破坏根身份与授权 guard。
4. 最小真实浏览器 smoke 是否真正消费产品适配器；区分 runtime 重建与进程重启，避免夸大证据。

合同是 docs/specs/storage/persistence.md 与 boundaries.md；分区绑定是条件信息，不是签名授权 token。
仅报告有具体触发和影响的真实缺陷，区分阻断、建议、缺证据；按 Reviewer 合同给正式结论。
Project/备份/UI/迁移是后续切片，不把已声明非目标列缺陷。
