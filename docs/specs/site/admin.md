---
schema: nbook.spec/v1
kind: behavior
status: implemented
capability: site.admin
owners:
  - nb-site-identity
---

# 官方站：账号管理

## 目标与非目标

给管理员：查看与处置别人的账号，发放与停用注册码，查看邀请码的使用，查看管理操作的审计记录。账号自己的行为见 [`site.accounts`](accounts.md)；OAuth 客户端的登记见 [`site.oauth-provider`](oauth-provider.md)。

不承诺：

- 不能以别人的身份登录。
- 不能删除账号；封禁是唯一的停用手段。
- 审计记录不能改、不能删。

## 术语与参与者

- **管理员**：角色为 `admin` 的用户。
- **审计记录**：一次管理操作的记录：谁、何时、对谁、做了什么。

## 输入与前置条件

接口都在 `/api/identity/v1/admin/` 下，要求管理员的有效会话，并满足 [`site.accounts`](accounts.md) 的同意门槛与来源头规则。

| 接口 | 作用 |
|---|---|
| `GET users` | 分页列出账号，可按用户名、邮箱、显示名的前缀搜索（参数 `q`；用户名与邮箱不分大小写，显示名只有 ASCII 字母不分大小写；邮箱待补的账号不按邮箱匹配），可按一个筛选项筛（参数 `filter`，取值 `all`、`admin`、`banned`、`email_pending`：全部、管理员、已封禁、邮箱待补） |
| `GET users/:id` | 一个账号的资料、登录方式、会话数、注册时用的码与邀请人 |
| `POST users/:id/ban`、`POST users/:id/unban` | 封禁、解封 |
| `POST users/:id/role` | 改角色 |
| `POST users/:id/revoke-sessions` | 结束它的全部会话（连同它名下的 OAuth 令牌） |
| `POST users/:id/reset-password` | 重置密码 |
| `GET registration-codes`、`POST registration-codes`、`PATCH registration-codes/:id` | 分页列出（列表里有码本身；可按一个筛选项筛，参数 `filter`，取值 `all`、`usable`、`exhausted_or_expired`、`disabled`：全部、可用、用完或过期、已停用）、发放、改备注或停用注册码 |
| `GET invite-codes` | 分页列出全站的邀请码与使用次数 |
| `GET audit` | 分页列出审计记录，可按操作者（参数 `actorId`，数字，或 `cli` 表示命令行）、对象（参数 `targetType` 加 `targetId`；只给 `targetType` 时列出这一类对象的记录，只给 `targetId` 回 `validation_failed`：各类对象的 id 各自编号）、动作（参数 `action`）筛 |

注册码：可用次数（正整数或不限）、可选的过期时间、备注（至多 200 个字符）。

分页列表的参数与响应，四个列表相同，[`site.oauth-provider`](oauth-provider.md) 的客户端列表也用这一套：

| 参数 | 规则 |
|---|---|
| `page` | 第几页，从 1 起；缺省 1 |
| `pageSize` | 每页条数，1 到 100；缺省 20 |
| `anchor` | 翻页的基准，取自同一次翻页里上一个响应；第一次请求不带 |

响应带 `items`（这一页的条目）、`total`（符合当前搜索与筛选的总条数）、`page`、`pageSize`、`anchor`。带筛选项的列表另带 `counts`：每个筛选项在当前搜索下各有多少条，键就是筛选项的取值。

账号列表的每一条：id、用户名、显示名、邮箱（待补时为空并标明待补）、角色、是否封禁、注册时间、最近一次登录成功的时间（没有登录过时为空）。

## 输出与可观察行为

1. **权限。** 不是管理员的会话调这些接口回 `forbidden`；没有会话回 `unauthenticated`。处置在生效的那一刻再确认一次操作者：那时操作者的会话已经结束、已不是管理员或已被封禁，回 `unauthenticated`，处置不生效、不写审计。
2. **封禁。** 封禁后该账号不能登录、已有会话全部失效（[`site.accounts`](accounts.md) 输出 6）。它名下已发出的 OAuth 访问令牌与没用掉的授权码全部失效（[`site.oauth-provider`](oauth-provider.md) 输出 8）。解封后可以重新登录，不恢复旧会话与旧令牌。
3. **改角色。** 角色改变后该账号的已有会话全部失效，它名下已发出的 OAuth 访问令牌与没用掉的授权码随之失效。
4. **重置密码。** 响应里给出一个新密码，只出现这一次；该账号的旧密码不能再登录，已有会话全部失效，已发出的 OAuth 访问令牌与没用掉的授权码全部失效。新密码不进审计记录与日志。
5. **不能处置自己。** 管理员对自己的账号封禁、改角色回 `self_forbidden`；结束自己的全部会话、重置自己的密码不受此限。
6. **最后一个管理员。** 处置在生效的那一刻仍要求操作者是未封禁的管理员（输出 1），又不能封禁或降级自己（输出 5），所以改角色与封禁不会让站里没有未封禁的管理员。
7. **注册码。** 发放时生成一个不可猜的码；停用后不能再用于注册，已经用它注册的账号不受影响；列表里有每个码的已用次数、是否还能用。
8. **审计。** 封禁、解封、改角色、结束会话、重置密码、发放与停用注册码、登记与改动 OAuth 客户端、命令行创建或重置管理员（[`site.operations`](operations.md) 输出 5，操作者记为命令行），每成功一次写一条审计记录；操作失败不写。只改注册码的备注不写审计。没有变化的处置（封禁已被封禁的账号、把角色改成原来的角色）照样成功、照样写。动作名是 `user.ban`、`user.unban`、`user.role`、`user.revoke_sessions`、`user.reset_password`、`registration_code.create`、`registration_code.disable`、`admin.cli_upsert`，以及 `oauth_client.create`、`oauth_client.update`、`oauth_client.rotate_secret`。动作的参数：改角色记旧角色与新角色，结束会话记结束的条数，发放注册码记可用次数与过期时间，命令行创建或重置管理员记是不是新建的，登记客户端记种类与是否免确认，改动客户端记改了哪些属性（`properties`：请求里带了的属性名，逗号分隔）；不记码、备注与客户端密钥。审计记录与它记的操作同时生效：不存在“操作生效了却没有记录”的情况。
9. **列表稳定。** 分页列表按创建时间倒序、再按 id 倒序。带着 `anchor` 的请求只看基准那一刻已经存在的条目：之后新增的不进 `items`，也不计入 `total` 与 `counts`，所以同一次翻页过程中不因新增数据而重复出现同一条、页数也不变。不带 `anchor` 的请求以当时为基准并把它放进响应。条目的状态在翻页期间变了（例如被封禁后不再符合筛选项，或改了以后开始符合）时，后面的页按新状态算，可能少看到一条或重复看到一条。
10. **页码越界。** `page` 超过最后一页时 `items` 为空、`total` 照常给出，不算错误。`page`、`pageSize` 不合规则或 `anchor` 的写法不对、或指向比现有条目都新的基准时回 `validation_failed`；列表是空的时给出的 `anchor` 也可以带回来翻页。

## 状态与转换

无自己的状态；它改的是账号与注册码的状态。

时序与寿命：

- 封禁、改角色、重置密码的响应返回时，输出 2 到 4 说的失效已经生效。
- 两个管理员同时处置同一个账号时，各自的操作都生效并各有一条审计记录，最终状态是后完成的那次。

## 副作用与数据

- 审计记录落在账号模块的库里，长期保留，含操作者 id（命令行为空）、对象 id、动作、时间与动作的参数；不含密码。

## 失败与恢复

| 码 | HTTP | 含义 | 调用方怎么办 |
|---|---|---|---|
| `forbidden` | 403 | 不是管理员 | 无 |
| `not_found` | 404 | 没有这个账号或码 | 无 |
| `self_forbidden` | 409 | 不能这样处置自己 | 请另一位管理员做 |
| `validation_failed` | 400 | 参数不合规则 | 按 `fields` 改 |

其余码同 [`site.accounts`](accounts.md)。

## 边界与兼容

- 公开接口是上表的路径与失败码；只追加。
- 管理员确认“来要求重置密码的是不是本人”不在本合同里，由管理员自己判断；系统只保证这次重置留有审计记录。

## 验收与 Smoke

1. 普通用户调任一管理接口得 `forbidden`，审计里没有记录。
2. 管理员重置某账号的密码：旧密码登录失败、新密码登录成功、该账号原有的 Cookie 失效、审计里有一条不含密码的记录。
3. 站里只有一个管理员时把自己降级或封禁：被拒。
4. 账号多于一页：取第 1 页，再注册一个新账号，带着第 1 页给的 `anchor` 取第 2 页。第 2 页的第一条不是第 1 页的最后一条，两次的 `total` 相同；不带 `anchor` 重新取第 1 页时新账号排在最前、`total` 多 1。

Smoke：合同测试包里的封禁与重置密码用例。

## 实现合同

- 公开入口：账号子应用 `admin/` 下的路由，随 `@notnotype/nb-site-identity` 的 `createIdentityModule` 装配；schema、筛选项与审计动作名在 `@notnotype/nb-site-identity-contract`。
- owner 是 `nb-site-identity`，与 [`site.accounts`](accounts.md) 同一个模块、同一个库。
- 每个处置经同一个写入函数：第一步复核操作者（会话还在、是管理员、没被封），再查对象与“不能处置自己”，改字段、经结束全部会话的那一个函数删会话、写审计，全在一个写事务里。
- 分页列表的基准（`anchor` 是当时最大的 id）、`total`、`counts` 与这一页在同一个读事务里读；四个列表共用同一套分页。

## 证据

- 批准依据：[官方站重写](../../proposals/official-site-rewrite.md)、[ADR 0060](../../adr/0060-official-site-identity-on-better-auth.md)、[ADR 0063](../../adr/0063-official-site-identity-own-routes-library-sessions.md)
- 实现入口：[`packages/nb-site-identity/src/admin/users.ts`](../../../packages/nb-site-identity/src/admin/users.ts)
- 合同测试：[`admin.test.ts`](../../../packages/nb-site-contract-tests/src/admin.test.ts)、[`oauth-invalidation.test.ts`](../../../packages/nb-site-contract-tests/src/oauth-invalidation.test.ts)
- Smoke：[`admin.test.ts`](../../../packages/nb-site-contract-tests/src/admin.test.ts)
