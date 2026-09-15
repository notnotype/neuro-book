# 浏览器客户端身份连接归属修复

范围：仅 `packages/neuro-book/app/utils/storage/client-identity.ts` 与同目录 `client-identity.test.ts`。
闭合 [leader-progress-review](leader-progress-review.md) 第 5 项；不改写 shared、server、auth、smoke、package.json 或本 Task 身份。
API 与结果形状（`loadOrCreateStorageClientIdentity` / `clearStorageClientIdentity`、`ready|cleared|unrecoverable` + 六个 reason）保持兼容。

## 实际修改

`client-identity.ts`

- 删除模块级 `cachedDatabase` 连接缓存。新增 `withIdentityDatabase(factory, operation)`：每次调用打开连接，
  `finally` 关闭，打开失败也归一化成 `{failure}` 返回。身份操作低频，不再为缓存承担失效判断与泄漏风险。
- `openStorageIdentityDatabase` 用 `settled` 收口：`onblocked` 返回不可恢复后，迟到的 `onsuccess`
  交付的连接没有任何 owner，直接 `opened.close()`；`onversionchange` 仍在连接存活期内 `close()`，
  不把已关闭连接留给下一次调用。缓存没了，`onerror`/`onblocked` 也不再需要清缓存分支。
- 事务仍在一个 `readwrite` 事务内完成读与可能的写，且只在 `transaction.oncomplete` 后返回 `ready`；
  中止/失败分别落到 `aborted`/`write-failed`，语义未改。

`client-identity.test.ts`

- 替身 IndexedDB 记录每次 `open` 交付的连接及其 `closed` 状态；连接被关闭后 `transaction()` 抛错
  （对应真实 `InvalidStateError`）。新增 `lateConnectionAfterBlocked` 与 `lateDelivery` 完成信号，
  测试等真实信号，不用墙钟 sleep。
- 新增 3 例：每次调用打开独立连接且结束后关闭（三次调用 → 三个连接全部关闭，缓存实现只会有一个）、
  事务失败路径同样不留打开连接、`onblocked` 之后迟到的成功连接被关闭。原有 9 例失败分类与身份语义用例保留。

## 验证

```
bun run --cwd packages/neuro-book test app/utils/storage
→ Test Files 2 passed (2) / Tests 17 passed (17)；其中 client-identity.test.ts 12 passed
```

```
bun run --cwd packages/neuro-book typecheck   # nuxt typecheck --dotenv .env.typecheck --logLevel silent
→ 输出中已无 app/utils/storage/client-identity* 报错；仍有的报错全部位于 server/storage/*
  （claims 的 rootIdentity、StorageReadResult.credential 等），属主 Agent 正在改的并发范围，本轮未动。
```

`git diff --check`（三个路径）退出码 0。

## 未验证 / 后续

- 真实浏览器复验（双标签收敛、`deleteDatabase` 后重新初始化、版本升级）由主 Agent 用重建后的 bundle
  在隔离 Chrome/HTTP origin 执行；本模块证据只到替身事务与失败分类，不能替代真实 IndexedDB 结论。
- 未提交、未 push；未运行整套 smoke（主 Agent 正在改 server/smoke）。
- 旧键迁移、HTTP adapter 接线与 `t24` 接纳/排空入口不在本轮范围。
