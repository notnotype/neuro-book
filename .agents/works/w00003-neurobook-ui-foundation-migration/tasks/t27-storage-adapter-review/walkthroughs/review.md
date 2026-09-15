# Storage 浏览器适配器独立审查

状态：完成。基线 `8b1229ea`；范围为本 worktree 相对基线的 Storage 增量，含未跟踪文件。
只读审查：未修改产品源码、Spec 或 Task；未联网、未再派代理、未提交、未操作真实用户 data。
（2026-09-16 修复后的追加复核见 [`review-followup.md`](review-followup.md)；§4.1 的失效语义两行已按其结论校正。）

## 结论

**需要修复**：前端读取路径声明的 15 秒超时在真实依赖下不生效（缺陷 1）。这是唯一发现的实现缺陷，
修复局部且不动合同形状；其余检查未发现阻断项，不要求返工。

## 1. 目标、范围与非目标核对

| 核对项 | 结果 |
|---|---|
| diff 与 Task 目标一致 | 是。改动集中在 `shared/storage`（DTO/定义/错误）、`server/storage`（池、宿主、服务、动作）、`app/utils/storage`（适配器）、新增 smoke |
| 非目标未被越界 | 是。未动 Config、Project/备份接线、UI/插件/grid、旧键迁移、命令系统；`action.post.ts` 未改（新 `bind` 分支由共享 DTO 与 `host.ts` 承接） |
| 用户既有 dirty 未被触碰 | 是。`app/utils/workbench/descriptors{,.test}.ts` 的 session→user/project 改动与 Storage 无源码依赖，按 Task 声明视为用户 dirty；其来源无法从当前工作树独立验证 |
| 旧入口与调用方切换 | 是。值动作请求类型收窄为 `StorageValueActionRequest`，`runStorageAction` / `requireStorageActionState` 不再接受 `bind`；全仓仅新适配器与 smoke 发送值动作，`scripts/smoke/storage-host-identity.ts`、`host-context-client.ts` 不发值动作，无遗留消费者 |
| 生成物/脚本接线 | `package.json` 只新增 `smoke:storage-value-adapter`；脚本进入 `scripts/tsconfig.json` 覆盖范围 |

## 2. 缺陷 1（需要修复）：所有读取请求的 15 秒超时实际不生效

**事实链**

1. `app/utils/storage/value-transport.ts` 对每次请求同时传 `timeout: 15_000` 与 `signal`。
2. `app/utils/storage/owner-handle.ts:188` 的 `sendRead` 默认参数 `signal = readAbort.signal`（永远存在），
   订阅读取传 `entry.abort.signal`；因此**每个 read 都带 signal**。写动作与 `bind` 调用 `send(action, kind)` 不带 signal。
3. ofetch 1.5.1 只在**没有 signal** 时才创建超时控制器：
   `node_modules/ofetch/dist/shared/ofetch.CWycOUEr.mjs` → `if (!context.options.signal && context.options.timeout) { ... controller.abort(...) }`。
   即：传了 signal，`timeout` 被整体忽略（不是被合并）。

**独立探针（本机 ofetch 1.5.1，HTTP 服务器接受连接但不响应）**

```text
$ node --input-type=module -e "<ofetch(url,{method:'POST',retry:false,timeout:400,signal}) vs {timeout:400}>"
signal + timeout: STILL PENDING after 2000ms
timeout only   : rejected 406ms FetchError TimeoutError

$ # 再按产品插件方式包装：$fetch.create({onResponseError})  + signal + timeout 400ms
plugin-like wrapper, signal+timeout: STILL PENDING after 1500ms
```

**影响**（触发：连接黑洞、代理挂起、后端接受连接却不答复，无 RST 的断连）

- 单次 `read()` / `refresh()` 永不 settle，调用方无错误可呈现；只有 `close()` / `release()` 的 abort 能解开。
- 订阅读取卡在串行链里 → 既不报告 `onError`，也不进入退避重试，界面静默停止反映外部提交；
  与 Task 验收“读失败退避且可见”、`implementation.md` 的“15 秒超时”不一致。
- 写入与 `bind` 不受影响（无 signal → 超时按预期生效），因此不是全链路失效，只在读方向。

**为什么测试没发现**：`app/utils/storage/value-transport.test.ts` 只断言 `options.timeout === 15_000`
与 `options.signal === abort.signal`（断言传参，不断言行为），带 signal 时超时是否真的生效无人验证。

**修法建议**：在传输层组合取消与超时，而不是依赖 ofetch 在两者同时存在时的行为——
自建 `AbortController` + 定时器，或 `AbortSignal.any([signal, AbortSignal.timeout(15_000)])`（需确认目标浏览器基线）；
并把上面“传参断言”换成行为断言：服务器不响应时，读请求必须在超时内以 `committed: null` 的未确认失败返回。

## 3. 建议（不阻断）

1. **后台轮询失败会逐次弹全局通知。** `createStorageHttpTransport` 默认用 `apiFetch`，
   它在 `plugins/api-fetch.client.ts` 中被 `onResponseError → notification.error(...)` 包装，传输未传 `notify: false`。
   触发：后端连续返回 5xx（例如磁盘 I/O 失败）时，订阅轮询按 0.5s→8s 退避，每分钟约 8 次全局错误通知；
   而句柄已有显式 `onError` 通道。建议传输请求固定 `notify: false`，把展示权交回 owner。
   （写入失败通知符合 Spec“保存失败使用现有通知”，本项只针对后台读轮询。）
2. **死状态**：`ReadEntry.started` 只在 `owner-handle.ts:96` 声明、`:285` 初始化、`:298` 赋值，从未被读取；建议删除。
3. **绑定的不对称校验**（观察，未构成可达缺陷）：`server/storage/storage-service.ts:307-317` 对
   `clientId === undefined` 的句柄只遍历 `shared`，因此非空 `binding.local` 被静默忽略；反向（有 clientId 却传
   `local: null`）则明确失败。HTTP 入口始终携带客户端凭证，实际不可达，仅提示两向语义不对称。

## 4. 逐项检查（Task 指定重点）

### 4.1 `owner-handle.ts`

| 关注点 | 判断 | 依据 |
|---|---|---|
| 接纳/释放排空 | 通过。`release()` 只拒绝新调用（`assertAcceptable`），随后 `readAbort.abort()`，`Promise.allSettled` 覆盖全部订阅 `closeEntry`、`reading` 快照与 `writes.values()` 快照 | 已接纳写入在 `enqueue` 内同步登记，释放时不会被漏掉 |
| 重复释放 | 通过。第二次 `release()` 返回同一 `closing` promise；用例 `release` 组已覆盖 | `handle.release()` idempotent |
| 订阅初始化竞态 | 通过。初始读取经 `enqueueRead(entry,false)` 不发布；若期间发生本进程提交，`notify` 置 `dirty`（timer 为 null 时只置 dirty），初始化后用 `schedule(entry, dirty?0:interval)` 立即补读 | 无“迟到初始快照覆盖较新值”窗口 |
| refresh/close 竞态 | 通过。`closeEntry` 先置 `closed` 再 abort，`entry.tail` 串行链上每次读取前后各判一次 `closed` | 关闭后不投递、不覆盖 |
| 串行读写 | 通过。每条记录一个 `writes` 队列按调用顺序串联；订阅每 entry 一条 `tail`；用例断言 `maxInFlight === 1` | |
| dirty 消耗 | 通过。`enqueueRead` 在链首 `dirty=false`；`notify` 只在 `key` 相同的 entry 上置位，并在 `.finally` 的 `schedule(entry, dirty?0:backoff)` 消费，避免 0ms 自旋 | |
| 退避 | 通过。失败翻倍至 `maxBackoffMs`，成功重置为 `intervalMs`；间隔/上限在网络调用前校验（可注入 `subscribe` 配置） | |
| 401/访问代次失效 | 通过。`status 401/403` 与 `TERMINAL_STORAGE_CODES`（访问、客户端凭据、代次、服务关闭）才把整个 owner 句柄置 `invalid`，之后的调用不再触达网络 | 用例覆盖 401/403 与 `STORAGE_CONTEXT_INVALID`，见 `review-followup.md` 校正说明 |
| schema 不匹配 | 通过。`STORAGE_SCHEMA_MISMATCH` 只让本次读取/动作失败，并终止受影响的那条订阅（`isTerminalFailure` 仅用于订阅链），不把整个 owner 句柄标 `invalid`；同 owner 的其它当前定义仍可继续 | `owner-handle.ts:150-157`（`invalid ??=` 只由 `isAccessFailure` 触发）、`:348-352` 订阅终止分支 |
| 输入捕获 | 通过。`captureCredential` 复制标量、`captureValue` 深拷贝并冻结为有界 JSON，均在 `enqueue` 之前；`openStorageOwnerHandle` 在首个 await 前取走 owner/间隔配置；`requestPartitionBinding` 返回冻结快照 | |
| 响应校验 | 通过。`validateSnapshot` 按 `kind` 分派：`value` 要求 `schemaVersion` 相等且过消费定义 `validate`；`legacy-value` 要求低于消费版本；不合法即拒绝，不做隐式转换 | |
| 超时 | **见缺陷 1** | |

### 4.2 `value-transport.ts`

- 请求在发送前按 `StorageActionRequestSchema` 校验，非法请求以 `committed: false` 在任何网络调用前拒绝（用例覆盖）。
- 响应按 `StorageActionResponseSchema` 校验并要求 `kind` 与请求一致，避免把半截/异类响应交给句柄。
- `committed` 只从服务端公开字段读取：`error.data.committed`（经 `data` 链最多 3 层）与 `response._data.committed`，
  缺失时按未确认处理；确定被拒的 400/401/403/409/413/422 才推断为 `false`。与 `server/storage/http-error.ts`
  的 `data: {code, message, reason?, committed?}` 形状一致，`resolveApiErrorCode` 的两层收窄也匹配（用例覆盖嵌套与 502/503 未确认）。
- `retry: false` 确实生效：ofetch 1.5.1 `onError` 首行 `if (context.options.retry !== false && !isAbort)`，
  且 POST 默认 0 retry；产品 `plugins/api-fetch.client.ts` 只加 `onResponseError` 通知，不引入重放。
- 超时与取消：见缺陷 1。

### 4.3 服务端 diff

| 关注点 | 判断 | 依据 |
|---|---|---|
| 绑定在第一 await 前捕获 | 通过。`StorageService.openHandle` 先 `capturePartitionBinding(input.binding)`（标量复制 + 正安全整数校验）再进入异步 `createHandle` | |
| 绑定在核心接纳边界失败关闭 | 通过。`StorageHandle.initialize` 先把 `bound` 写进 `box.value`，再由 `StoragePartitionStore.bindGeneration → assertHandleGeneration` 与磁盘当前代次比较；不匹配抛 `STORAGE_CREDENTIAL_STALE`（409），不存在“先读当前代次再让浏览器事后比较”的窗口 | 尚未读过的键同样失效（代次在句柄打开时捕获，与是否读过记录无关） |
| 池的绑定键 | 通过。`poolKey = contextId \0 owner \0 local \0 shared`，代次进入复用身份；同上下文不同绑定各自打开，不互相借用 | 用例“代次绑定是复用身份”“同上下文不同绑定并发”覆盖 |
| `bind` 独立打开 | 通过。`acquireDetached` 用唯一键独占条目，因此拿到的是分区**当前**代次，而不是别的请求早先捕获的那一个 | HTTP 用例“bind 不复用池内旧句柄”用分区锁闸门构造了“旧句柄仍在使用中”的真实竞态 |
| 有界排空 | 通过。独占条目同样计入 `assertCapacity` 与 `close()` 的 opening/releases 收敛循环；释放后删除，不残留 | |
| 旧客户端 schemaVersion 核对时机 | 通过。`requireStorageActionState` 在 `resolveAddress` 之后、取得句柄之前比较 `schemaVersion`，不等即 `STORAGE_SCHEMA_MISMATCH`（HTTP 409，公开固定文案）；`bind` 只解析 owner，不受影响 | 用例对 read/save/remove/migrate/repair/reclaim 六种动作逐一断言 409 且记录文件字节不变 |
| 未破坏根身份与授权 guard | 通过。动作顺序仍为：核验访问声明（`resolveContextLease`）→ 版本核对 → `assertActive` → 取得句柄（含 `expectedRootIdentity` 与 guard）→ `assertLive` → `assertLeaseRootIdentity` → 执行；`createError` 的公开文案白名单与 reason 白名单未放宽 | `http-error.ts` 仅新增 `STORAGE_SCHEMA_MISMATCH` 一条 |
| 逐 kind 响应联合 | 通过。`StorageActionResponse` 改为显式逐 kind 成员（写动作经 mapped type 展开），`Extract<..., {kind: K}>` 不再退化为 never；wire 形状未变（写动作仍是 `{kind, credential}`） | 未使用 `any` |
| HMR ready 接纳顺序 | 通过。新增用例在旧宿主 `pending` 未收口时，新 owner 的请求不进入核验（400 而非提前失败），补上 t25 的提示 | |
| 响应 schema 与服务端投影一致 | 通过。`partition-store.projectReadResult` 的六种分类只产出 `{kind, credential}` / `{kind, value, schemaVersion, credential}` / `{kind, diagnosis, repair}` / `{kind, wrapperVersion, schemaVersion, diagnosis, repair}`，字段与客户端 `.strict()` 的 `StorageReadResultSchema` 逐一对应，无多余字段导致整类读取被判为“响应与本合同不一致” | `partition-store.ts:654-691` |

### 4.4 最小真实浏览器 smoke

- **真正消费产品适配器**：页面导入 `openStorageOwnerHandle` 与 `openStorageUserContext`，通过 `globalThis.$fetch = ofetch.$fetch`
  让 `apiFetch → $fetch` 链生效；esbuild 从工作树 `node_modules` 解析真实 ofetch，无手写替身、无适配器逻辑复制。
  服务端跑真实 `performStorageUserAction` + `readStorageActionRequest`（h3 最小宿主，只替掉 Nuxt 自动装配）。
- **场景真实度**：双标签共享客户端凭证与 binding、独立浏览器上下文 local 隔离、shared 共享、近 1 MiB 往返与超限本地拒绝、
  订阅初始快照 + 跨句柄外部提交、释放后无新请求/无新快照（以 apiCalls 计数断言而非计时猜测）、
  回收后旧句柄与**未读键**均 409、损坏诊断不含原件且原件字节不变、重建后恢复确认值。
- **证据边界披露准确**：`implementation.md` 明确“同一 HTTP 宿主内销毁再创建生产 Storage runtime”，
  未声称整机断电或 Nuxt 进程崩溃验收；Project/备份/迁移/UI 列为后续切片。**未夸大**。
- 未覆盖：读取超时（缺陷 1 所在），smoke 不构造“服务器不答复”的场景。

## 5. 验证实际执行情况

| 项目 | 状态 |
|---|---|
| 独立重跑 `bun run --cwd packages/neuro-book test app/utils/storage` | 执行。4 文件 57 用例通过（当前 revision） |
| Task 记录的 26 文件 244 用例、主应用 typecheck、Chrome 值 smoke、`scripts:typecheck` | 未重跑（Task 明确不要求）。除 `app/utils/storage` 外的数字未经我独立核对 |
| `scripts:typecheck` 唯一错误为已登记旧文件的声明 | 未独立核对（缺证据，但不影响本轮结论） |
| 缺陷 1 的 ofetch 行为探针 | 执行。见 §2；仅在 ofetch 层与本机 HTTP 探针复现，未在浏览器 smoke 复现 |
| 跨进程真实重启 | 未验证；Task 已声明为后续切片，不算缺口 |

## 6. 建议的下一步

1. 修缺陷 1（传输层组合取消与超时 + 行为级回归用例），再重跑 `app/utils/storage` 聚焦用例与一次 Chrome 值 smoke。
2. 顺手处理 §3 的建议 1、2（后台轮询通知、死字段），可与缺陷 1 同批提交。
3. 修复后本切片按 `storage.persistence` 与实施计划切片 1 核对闭合；Project 生命周期与文件/备份接线仍属后续切片。
