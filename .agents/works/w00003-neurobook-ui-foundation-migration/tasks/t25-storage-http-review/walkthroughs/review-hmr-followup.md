# t25 追加复核：HMR 换代关闭旧 owner

结论：**建议合并**（无阻断缺陷）。

范围（本轮唯一）：`packages/neuro-book/server/storage/host.ts` 的 HMR 换代改动，与
`packages/neuro-book/server/storage/storage-host-hmr.test.ts` 的追加用例。
其余 t24 增量沿用本 Task [`review.md`](review.md) 已给结论，本轮不重做。未修改任何源码、测试或 Task 合同。

被复核的差异（相对 `3b8d87fb`，逐行核对 `git diff -- host.ts` 与全文）：

1. `StorageHostState` 新增 `ready: Promise<void>`；`PreviousStorageHostState` 保留 `registry` / `pending` / `closing`。
2. `createState(null, previous)`：`previous.closing ??= Promise.allSettled([previous.registry.close(), ...previous.pending])`，并把 `ready` 指向它。
3. `operate` 从 `owner.ready.then(...)` 起跑（原 `Promise.resolve().then(...)`）。
4. `closeState` 把 `owner.ready` 一并纳入排空。

## 逐项判定

### 1. 旧 owner 是否还能继续接纳

不能。三条独立门禁，且都不依赖时序运气：

- `previous.closing ??= …` 在**新模块求值时同步**写入旧 owner 的 `closing` 字段（`host.ts` 模块顶层 `??=`）。
  旧模块的 `operate` 首行是 `if (owner.closing !== null) return Promise.reject(new StorageServiceClosedError())`，
  旧模块的 `state()` 返回的正是同一个对象（`__nbookStorageHostV2`，新模块未删除该槽），所以写入立即对旧入口生效。
- 已经越过首行检查、正在 `await` 的旧操作，会在下一次 `assertActive()`（`owner.closing` 复检）抛出
  `STORAGE_SERVICE_CLOSED`，包括 `resolveClaims` 里 `ensureStorageIdentityDomain` 前后的两次检查。
- 旧 owner 的访问上下文 registry 已被 `registry.close()` 置为 closing，`issue` / `resolve` / `assertLive` 全部
  抛 `STORAGE_SERVICE_CLOSED`（本轮实跑用例已断言）。

### 2. 是否漏排空在途身份初始化

不漏。`operate` 在返回前**同步**把 `result` 加入 `owner.pending`，而 `operate` 的首行检查与入列之间没有 `await`，
所以「通过首行检查」与「进入 `pending`」是同一同步片段；`...previous.pending` 的快照与 `previous.closing` 的赋值也在
同一同步片段。JS 单线程下不存在「已接纳但不在快照里」的操作。已接纳的旧 `issueStorageUserContext`
（`initialize=true`）会走完 `ensureStorageIdentityDomain` 的 mkdir/加锁/写身份文件，再在后置 `assertActive()` 处失败——
这正是「排空在途身份初始化」的语义，且写入发生在新 owner 开始之前（见第 4 点），不产生并发写。

### 3. 是否引入关闭死锁

没有。旧 owner 的 `closing` 只聚合 `registry.close()` 与旧 `pending`：

- `StorageAccessContextRegistry.close()` 是 `this.closing = Promise.resolve()`，立即决议，不可能挂住（已读 `access-context.ts:187-193`）。
- `Promise.allSettled` 不因拒绝而卡住。
- 旧 V2 owner 的 `pending` 只包含 `resolveClaims` 链（鉴权导入、`ensureStorageIdentityDomain`、`stat/realpath`），
  不含句柄池与值操作，因此不会等待锁竞争窗口之外的新 owner 行为；新 owner 已接纳的操作只依赖 `owner.ready`，
  而 `ready` 不反向依赖新 owner 的 `pending`。
- `closeState(newOwner)` 的 `Promise.allSettled([owner.ready, contextsClosed, poolClosed, serviceClosed, ...owner.pending])`
  无自环：`ready` 与 `pending` 互不依赖。

### 4. 顺序是否成立（新 owner 待旧 owner 排空后才开始）

成立。`operate` → `owner.ready.then(() => {assertActive(); …})`，且 `closeState` 也把 `ready` 纳入。
未改 `registerStorageStateDefinitions`（同步、只写内存 registry）与 `revokeStorageAuthSession`（同步内存操作），
两者不产生文件副作用，不破坏该顺序。

### 5. 追加用例是否打到接缝

是，且确定性：

- 用例 2 直接断言 `previous.closing` 由换代置为非 `null`（这正是旧 `operate` 读取的字段），并在 `gate` 未决议期间
  断言 `closed === false`、决议后 `closed === true`，覆盖「换代设置关闭标记 + 排空在途初始化 + `ready` 参与关闭」。
  它在修复前的实现上会失败（旧版不写 `previous.closing`），不是靠时间碰巧通过。
- 用例 1 覆盖旧槽不原地复用（旧 registry 的 `resolve` / `issue` 按 `STORAGE_SERVICE_CLOSED` 失败，新 owner 建立）。
- 用例 3 覆盖同槽版本重载复用同一 owner。
- `afterEach` 删除两个槽并 `vi.resetModules()`，用例间不互相污染。

## 独立复跑

```
bun run --cwd packages/neuro-book test server/storage/storage-host-hmr.test.ts
→ Test Files 1 passed (1)；Tests 3 passed (3)；Duration 2.05s
```

未复跑主 Agent 已实跑的 HMR+host+action lifecycle 31/31、190 项聚焦回归、主应用 typecheck 与 Chrome smoke
（Task 明确要求不重复占用时间）。

## 非阻断建议

1. **`operate` 从 `ready` 起跑这一条缺少直接断言。** 用例 2 只通过 `disposeStorageHost()`（`closeState` 路径）证明
   `ready` 被等待；若将来有人把 `operate` 改回 `Promise.resolve().then(...)`，三个用例仍会全绿，而「新 owner 在旧
   在途身份初始化排空前不得开始值操作」会静默退化。触发条件：下一增量新增宿主级用例时。
   影响：仅覆盖缺口。建议在能构造 `H3Event` 的宿主用例（如 `storage-action-lifecycle.test.ts` 的 fixture）里补一条
   「旧 `pending` 未决议时，新 owner 的 action 请求不 resolve」。
2. **`PreviousStorageHostState.registry: {close(): Promise<void>}` 只对 V2 成立。** `StorageStateRegistry` 没有 `close()`
   （已核对 `shared/storage/definition.ts:129` 起）。若将来槽名升级到 V4 并直接复用该类型，`previous.registry.close()`
   会在 `createState` 内同步抛 `TypeError`，导致新模块顶层 `??=` 抛错、宿主整体加载失败。
   触发条件：下一次宿主状态形状变化。影响：当前无缺陷，但届时必须为新旧形状对显式定义换代动作，而不是复用 V2 形状。
3. **换代窗口内的 auth 撤销不作用于旧 owner 的在途操作。** 新模块接管后，退出登录触发的 `revokeStorageAuthSession`
   落在新 owner 的 `authChecks`/`accessContexts` 上；旧 owner 已接纳且正停在 `ensureStorageIdentityDomain` 内的操作
   只能靠 `closing` 在其后的 `assertActive()` 处终止，可能完成一次身份元数据创建（幂等，缺失时才写）。
   触发条件：HMR 换代窗口与同一 session 的退出重叠。影响：旧 V2 无值操作与句柄池，写面仅限同一存储根的身份域
   元数据，且发生在新 owner 开始之前，不产生数据竞争；不构成本增量缺陷。

## 未验证项

- 未在真实 Vite/Nuxt dev HMR 下观察换代（用例以手工构造的 V2 槽模拟）；未验证旧 chunk 在 V3 建立后才被重新求值的
  极端加载顺序（该顺序下 `__nbookStorageHostV3 ??=` 短路，V2 不会被排空）。从代码推断该顺序需要旧模块在 V3 之后重新
  求值，正常 HMR 图替换不会发生；无法在本轮构造证据。
- 未验证 Windows 以外的锁行为与跨进程竞争窗口。
