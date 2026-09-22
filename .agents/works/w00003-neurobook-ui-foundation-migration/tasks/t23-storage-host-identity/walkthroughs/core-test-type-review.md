# 核心 Storage 测试类型收窄修复（storage-service / storage-lock-process）

范围：仅 `packages/neuro-book/server/storage/storage-service.test.ts` 与 `storage-lock-process.test.ts` 的 TypeScript 类型收窄。
授权边界：不改生产文件、不改 tsconfig、不排除测试、不提交、不联网；主 Agent 并发的 auth/host/browser 改动未被触碰。
测试语义保持不变，34 例全部通过。

## 起始错误（typecheck 实测）

`bun run --cwd packages/neuro-book typecheck`（即 `nuxt typecheck --dotenv .env.typecheck --logLevel silent`）改动前对这两个文件报 20 条：

- `storage-service.test.ts` 17 处 TS2339：`credential` 不存在于 `StorageReadResult<T>`。
  `kind: "unsupported-version" | "corrupt"` 两个联合成员只有 `repair`；`expect(...).toMatchObject` 不做类型收窄，所以“缺失读取必然带凭据”的现场前提对类型系统不成立。
- `storage-service.test.ts(881)` TS2349：`openGate?.()` 被推断为 `never`。
  `let openGate: (() => void) | null = null` 只在 `new Promise` 的 executor 闭包内被赋值，外层控制流看不到该赋值，收窄停留在 `null`，可选调用因此没有可调用签名。
- `storage-lock-process.test.ts(103)` 同一 `credential` 问题；`(163)` TS2339：`expect(racing.ok).toBe(false)` 不收窄 `{ok: true; value} | {ok: false; error}`，`racing.error` 在成功分支上不存在。

## 实际修改

`storage-service.test.ts`

- 新增泛型断言 helper `missingCredential<T>(result: StorageReadResult<T>): StorageCredential`：
  分类不是 `missing` 时立即抛错，否则返回 `credential`。它与既有 `valueCredential` 成对，属读取侧断言，不用 `any`/`as`。
- 17 处未收窄的凭据访问改为 `missingCredential(...)`（15 处 `missing`，另加 `initial`、`sharedInitial`）。
  这些读取的现场前提都是“新分区或已知缺失”；断言失败即测试前提被破坏，分类断言是加强而不是放宽。
- 已由真实判别分支收窄的凭据访问（`if (x.kind !== ...)` 分支内，以及 `legacy` / `gridA` / `note` / `current` 用例）保持 `.credential` 原样，不叠加重复断言。
- 用例“释放句柄时拒绝新操作并等待已接纳请求收口”：
  `let gate: Promise<void> | null` + `let openGate` 换成 `const gate = Promise.withResolvers<void>()`，
  锁 adapter 改 `await gate.promise`，放行点改 `gate.resolve()`。闸门语义不变（保存仍停在已接纳状态直到放行），
  同时消除闭包赋值导致的 never 收窄。`Promise.withResolvers` 是仓库既有用法（`server/agent/harness/neuro-agent-harness.test.ts`、
  `server/storage/host.test.ts`、`app/utils/storage/client-identity.test.ts`）。

`storage-lock-process.test.ts`

- 父进程初始读取加真实判别分支 `if (missing.kind !== "missing") throw ...`，随后沿用 `.credential`。
- 竞争结果改用分支收窄：`if (racing.ok) throw new Error("父进程竞争写入不应成功")` 取代 `expect(racing.ok).toBe(false)`；
  成功时仍然失败，失败分支的 `racing.error` 收窄为 `unknown` 后进入原 matcher。

## 验证

```
bun run --cwd packages/neuro-book test server/storage/storage-service.test.ts server/storage/storage-lock-process.test.ts
→ Test Files 2 passed (2) / Tests 34 passed (34)；Duration 5.58s
```

```
bun run --cwd packages/neuro-book typecheck
→ 输出只有命令行本身，无任何 error TS；两个文件与整个主应用（含并发的 auth/host/browser 改动）当前均通过。
```

`git diff --check`（两个文件）退出码 0。`git ls-files --eol` 显示 `i/lf w/lf`，未引入行尾变化
（`git diff` 的 “LF will be replaced by CRLF” 警告对未触碰文件同样出现，属仓库 git 配置既有现象）。

## 未验证 / 边界

- 未运行整套 storage 聚焦套件、smoke 与浏览器验收；86 例基线和真实界面证据由主 Agent 复验。
- 未提交、未 push；本轮未触碰生产代码、tsconfig、鉴权与浏览器身份模块。
