---
schema: nbook.task/v2
taskId: t25-storage-http-review
---

# user Storage HTTP 增量独立审查

## 恢复审查

### 当前追加复核（仅此项）

`walkthroughs/review.md` 已给无阻断结论，前一轮已完成。此次不要重做全审。
主 Agent 发现原 HMR 结论“旧 owner 无法继续写盘”对身份初始化过强：旧 t23 `resolveClaims(initialize=true)`
会创建身份元数据，仅关闭 registry 未设置旧 owner.closing 仍可接纳这段过程。
现在只改 `host.ts`：旧状态类型保留 pending/closing，换代设置 closing 并排空旧 pending；新 owner.ready 等待它，
operate 从 ready 开始，closeState 也等 ready。`storage-host-hmr.test.ts` 追加确定性 gate 关闭等待用例。
主 Agent 已跑 HMR+host+action lifecycle 31/31，通过。typecheck 在跑。
请只复核这两个文件与上面描述的差异，确认没有关闭死锁/漏排空或旧 owner 继续接纳的路径；
写 `walkthroughs/review-hmr-followup.md`，给正式结论，不修改源码。2 分钟内应能完成，不重复读取整套 spec/测试。

前一轮 6 分钟超时且未留下报告，不能计为已审查。本轮先创建 `walkthroughs/review.md` 写明“审查进行中”，
发现一项立即追加证据；最后改成 reviewer 的正式结论。不要把全部写报告工作留到期限尾部。
主 Agent 已完成 190 项聚焦回归、主应用 typecheck、普通 HTTP Chrome 身份 smoke 与 docs:check，均 exit 0。
只需独立检查下面的源代码路径与实际缺陷，不重复运行这些大命令，也不再遍历已冻结设计全文。
优先 `host.ts`、`handle-pool.ts`、`partition-store.ts` 的当前 diff，必要时才追相关 owning boundary。
HTTP 请求和公开诊断由 `storage-actions.ts` 与对应路由测试补充。先在 3 分钟内给出已查范围和任何 findings，
再扩展剩余审查。此轮允许写报告，不允许改任何源码、测试或 Task 合同。

Work：[w00003](../../README.md)；被审查实现：[t24](../t24-storage-user-http/README.md)。

## 范围与边界

审查当前 worktree 相对于 `3b8d87fb` 的 Storage 增量。仅读源码/测试与运行隔离验证，不修改产品源码、Spec 或 Task。
报告写本 Task `walkthroughs/review.md`；不提交、联网、再派代理、操作真实 data。
两个 descriptors 文件是用户原有 dirty，完全不属于本次审查或改动。

t24 第一轮超时、第二轮正常退出但没有报告。主 Agent 已直接核对并补修：
句柄池释放排空/容量、guard 前后检查、慢 open 撤销、HTTP 公共诊断、committed 事实，
以及“根被移走不得 mkdir 重建”“在途释放也占用容量”。后两项有独立探针失败与测试转绿。
最近 `test server/storage/storage-action-lifecycle.test.ts server/storage/handle-pool.test.ts` 是 21/21 通过。
主 Agent 正在运行包含 t23 基线的全 Storage 聚焦回归与 typecheck，不要为这些命令重复占用时间。

## 审查重点

1. 注册定义是唯一策略、请求不能提交主体/根/locality；有界 HTTP body 与公开错误/成功诊断不泄漏内部细节。
2. Pool 的打开/最后释放/关闭/容量和失败路径；host pending 与 service 的 shutdown 排空，不把异步资源遗忘。
3. 上下文撤销/到期、根替换、等锁、替换重试、repair 原件与 reclaim 新代次后的 committed。
4. HMR V2→V3 策略是否会留下可继续写入的旧 owner；普通模块重载是否复用正确状态。
5. 新增测试确实打到故障接缝，不按时间碰巧通过；接口便于随后浏览器和 Project 消费。

只报告可复现或有明确代码路径的实际缺陷；区分阻断项、建议与未验证项。
当前只交付每请求受管句柄与 user HTTP 值操作，前端长期句柄/网络订阅明确在下一增量：
[接续边界](../t24-storage-user-http/walkthroughs/adapter-next-boundaries.md)。不要把这项已声明的非目标列为缺陷。
按 reviewer 合同输出结论、路径、具体触发及影响。若期限不足先留下真实报告；不能用空 final 或 yield null 代替证据。
