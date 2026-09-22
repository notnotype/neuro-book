# Storage 浏览器适配器独立审查 — 追加复核

状态：完成。范围只限本次修复（`value-transport.ts` 超时/通知、`owner-handle.ts` 死字段、新增回归用例）与首轮表格表述校正。
基线 `8b1229ea`；未修改产品源码、Spec 或 Task；未联网、未再派代理、未提交、未操作真实用户 data。
首轮结论见 [`review.md`](review.md)（缺陷 1 为“需要修复”）。

## 结论

**建议合并**。首轮唯一阻断项（前端读取超时在真实依赖下不生效）已按“传输层自持取消与期限”修复，
并用真实 `ofetch` + 卡住 fetch 的行为级用例锁住；未发现新阻断项，不要求返工。
两条残留项不阻断，但需在后续切片验收（见 §5）。

## 1. 缺陷 1 修复核对（`value-transport.ts`）

| 修复点 | 判断 | 依据 |
|---|---|---|
| 不再依赖 ofetch 的 `timeout` | 通过。请求选项已无 `timeout`；只剩 `retry:false`、`signal`、`notify:false` 与业务字段 | `value-transport.ts:107-116` |
| 每请求独占 `AbortController` + 15 秒计时器 | 通过。`createRequestCancellation` 自建 controller，`setTimeout(..., 15_000)` 用 `DOMException("…","TimeoutError")` 中止；外部 `signal` 经 `addEventListener("abort", …, {once:true})` 链接，已中止则立即闭合并发 | `value-transport.ts:137-142` |
| 计时器覆盖完整请求 Promise（含已返回响应头、未结束的响应体） | 通过。计时器在发起请求前启动，`finally` 才 `dispose()`；中止的是整次 fetch，响应体读取随之失败 | `value-transport.ts:105-121`；用例 `pending-body` 模式 |
| `finally` 清理，无监听器/计时器残留 | 通过。`dispose()` 清超时并 `removeEventListener` | `value-transport.ts:145-148`；用例断言 `vi.getTimerCount() === 0` |
| `notify` 固定 `false` | 通过。产品 `plugins/api-fetch.client.ts:15` 在 `notify === false` 时直接返回，不再触发全局通知；展示权交回 owner/`onError` | `value-transport.ts:114-115` |
| 超时结果的 `committed` 语义 | 通过。中止产生的错误没有服务端提交字段 → `committed: null`（未确认），不谎报未写入 | 用例断言 `committed: null`；`projectStorageAdapterFailure` |

## 2. 回归用例核对（`value-transport.test.ts`）

新增 `it.each(["no-headers","pending-body"])`：用真实 `createFetch`，自定义 `fetch` 分别构造“接受连接但不应答”与“已返回响应头但响应体不结束”两种场景，且**同时**带外部 `signal`。
断言链完整：14,999ms 未 settle → 15,000ms 以 `committed: null` 拒绝 → `requests === 1`（无重放）→ 外部 `abort.signal.aborted === false`（超时不越权取消调用方信号）→ 无残留计时器。
方向正确：原缺陷只在“有 signal”时触发，用例显式带上 signal，因此能在旧实现下暴露问题。

**独立探针（本机，真实 `ofetch`）**验证旧参数组合确实不生效、新参数组合生效：

```text
$ node <probe：createFetch 的 fetch 接受连接但不应答>
old(timeout:400 + signal) after 1200ms: STILL PENDING
new(自持 AbortSignal)               : rejected:FetchError/TimeoutError
```

即旧代码在同一测试路径下会长期 pending、无法进入 `await rejected`，用例会以测试超时失败——是真实回归护栏，不是“断言传参”。

## 3. 死字段与注释

- `ReadEntry.started` 已删除：`owner-handle.ts` 中不再出现该字段（声明、初始化、赋值一并移除）。
- `handle-pool.ts` 顶部注释已与实现一致：复用身份包含绑定，“复用范围必须包含绑定，否则一个请求会拿到别的请求按另一个代次打开的句柄”，与 `poolKey`（`contextId\0owner\0local\0shared`）相符。

## 4. 首轮表格表述校正（已写入 `review.md` §4.1）

校正内容：`STORAGE_SCHEMA_MISMATCH` **不**把整个 owner 句柄标 `invalid`。

- 句柄级 `invalid` 只由 401/403 与 `TERMINAL_STORAGE_CODES`（访问、客户端凭据、代次、服务关闭）触发
  （`owner-handle.ts:36-40`、`:155` 的 `invalid ??= failure` 只在 `isAccessFailure` 为真时执行）。
- schema 不匹配只让本次读取/动作失败；在订阅链上由 `isTerminalFailure` 终止**该条**订阅
  （`owner-handle.ts:349-352`，仅在 `schedule` 的读取回调内使用），同 owner 的其它当前定义不受影响。
- 设计意图：一个过期/错版本的消费定义不应阻断同 owner 的其它当前定义；此为有意分离，非缺陷。

## 5. 残留项（不阻断，需后续切片验收）

1. **写入失败通知的职责转移。** 修复把 `notify` 固定为 `false` 作用于**所有**请求（含 save/remove/migrate/repair），
   不再由传输触发全局通知。但 [storage.persistence](../../../../../../docs/specs/storage/persistence.md) 要求
   “布局保存失败使用现有通知与可恢复入口反馈”（:116）与“前端沿用统一 API 错误映射与通知”（:192）。
   当前切片无产品 UI 消费者（Task 已声明 UI 接线为后续切片），失败仅以 `StorageAdapterError`（含 code/message/committed）向调用方返回。
   该要求在 owner/消费层切片必须显式满足；本切片不能声称已闭合该条验收，也不因此阻断。
2. 首轮的 §3 观察 3（绑定两向语义不对称）仍成立且不可达，未处理。

## 6. 本轮实际执行的验证

| 项目 | 状态 |
|---|---|
| `bun run --cwd packages/neuro-book test app/utils/storage` | 执行。4 文件 59 用例通过（含新增超时行为用例） |
| ofetch 行为独立探针（旧 vs 新参数） | 执行。见 §2 |
| 主应用 typecheck、Chrome 值 smoke、26 文件 244 用例 | 未重跑（Task 明确不要求，主 Agent 已跑） |

## 7. 下一步

1. 本切片（值适配器/分区绑定/订阅）在追加复核后按 `storage.persistence` 与实施计划切片 1 视为闭合；
   §5.1 的通知职责在 owner/消费层切片验收。
2. Project 生命周期、文件/备份接线、旧键迁移、UI 接线仍属后续切片，不在本 Task 声明完成。
