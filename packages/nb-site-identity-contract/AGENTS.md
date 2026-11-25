# nb-site-identity-contract 包入口

本包位于 `packages/nb-site-identity-contract`，遵循仓库共享 Agent 合同 [`../../AGENTS.md`](../../AGENTS.md)。官方站各包共用的规则（依赖方向、迁移、起服务、跑合同测试）在 [`../nb-site-server/AGENTS.md`](../nb-site-server/AGENTS.md)，本文件只保留本包的专属规则。

`@notnotype/nb-site-identity-contract` 是官方站账号模块对外的 HTTP 合同（[ADR 0059](../../docs/adr/0059-official-site-one-process-split-ready-modules.md) 决策 2）：路径前缀 `IDENTITY_API_PREFIX` 与各接口的路径（`src/paths.ts`）、失败码与错误体（`src/errors.ts`）、字段规则（`src/fields.ts`）、时间写法（`src/time.ts`）、账号自己的接口（`src/account.ts`）与管理接口（`src/admin.ts`）的请求和响应 schema。账号模块、合同测试、官方站前端都只经它认识账号的接口；统计模块不依赖它（“问身份”的形状由统计模块自己声明，ADR 0059 决策 5）。行为合同是 [`site/accounts.md`](../../docs/specs/site/accounts.md) 与 [`site/admin.md`](../../docs/specs/site/admin.md)，两处不一致时以 Spec 为准。

## 边界

- 运行时依赖只许 `typebox`，devDependencies 里的工作区包只许测试支持包；由 `nb-site-server/src/architecture.test.ts` 检查。
- 只放合同：路径、schema、错误码、字段规则与按规则判断的几个纯函数（`parseUsernameInput`、`isWebUrl`、`codePointLength`）。不放实现（限流、哈希、事务、Spec 里的失败先后），也不放只有账号模块自己用的类型。`src/schema.ts` 是写 schema 的小工具，不从入口转出。
- 码、字段规则、路径、筛选项与审计动作名与两份 Spec 逐项一致：Spec 里没有的不加。`src/contract.test.ts` 里的期望值是照 Spec 的表手写的，Spec 改了先改那里，再改合同；不要从包里算出期望值。
- 改这里就是改对外合同：路径或形状变了，前端与合同测试要一起改，并按 Spec 判断是否破坏兼容（码与路径只追加，不改已有码的含义）。

## 长度与字段规则

- 长度按 Unicode 码点计（`site.accounts` 字段规则）。TypeBox 的 `minLength`、`maxLength` 数的是字素（1.3.6 实测：`"abcdefé"` 是 8 个码点、7 个字素，`minLength: 8` 判它不合格），所以 schema 里不用这两个关键字，长度写进 `pattern`：`codePointPattern(min, max)` 生成 `^[\s\S]{min,max}$`，TypeBox 以 `u` 标志编译 `pattern`，这时一次匹配一个码点。升级 TypeBox 时 `contract.test.ts` 里夹着组合重音与四字节字符的长度用例兜底。
- 服务端：请求先过 schema，再对头像与网站调 `isWebUrl`（能否解析 schema 表达不了），用户名用 `parseUsernameInput` 取小写的登录名（先判 ASCII 再转小写，先后不能换）。schema 通过就说明长度已按码点核过，不另数一遍。
- 前端：输入上限与字数提示用常量（`USERNAME.maxLength` 等）与 `codePointLength`，不用 `String.length`，也不能把常量直接交给 `<input maxlength>`（它数 UTF-16 单元）；提交前要判时用 `new RegExp(常量.pattern, "u")` 或同样的函数，与服务端是同一条规则。

## t08 往哪里追加

- 对外 OAuth 自家接口的失败码（`authorization_expired`、`client_not_found`、`redirect_uri_invalid`）追加在 `src/errors.ts`，状态表同样补齐；社交流程的落点码 `SOCIAL_ERROR_CODES` 已在。
- `me/identities`、`social/:provider/start` 与 `oauth/*`、`admin/oauth-clients*` 的路径追加在 `src/paths.ts`；上游身份列表项 `IdentityItem` 已在 `src/account.ts`。
- 社交发起、登录续接（`LoginRequest`、`LoginResponse` 的可选字段）的 schema 追加在 `src/account.ts`；授权确认、授权记录、OAuth 客户端的 schema 另起 `src/oauth.ts`，从入口转出。审计的三个 `oauth_client.*` 动作与 `oauth_client` 对象种类已在 `src/admin.ts`。

## 完成门禁

```text
bun run typecheck
bun test
```

改了合同，另跑 `nb-site-identity`、`nb-site-server` 与 `nb-site-contract-tests` 的 `bun test`（`test:affected` 按依赖图会选中它们）。
