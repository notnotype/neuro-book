# nb-site-contract-tests 包入口

本包位于 `packages/nb-site-contract-tests`，遵循仓库共享 Agent 合同 [`../../AGENTS.md`](../../AGENTS.md)。官方站各包共用的规则（依赖方向、迁移、起服务、跑合同测试）在 [`../nb-site-server/AGENTS.md`](../nb-site-server/AGENTS.md)，本文件只保留本包的专属规则。

`@notnotype/nb-site-contract-tests` 是官方站的黑盒合同测试（[ADR 0059](../../docs/adr/0059-official-site-one-process-split-ready-modules.md) 决策 6、[ADR 0061](../../docs/adr/0061-official-site-sqlite-file-per-module.md) 决策 4）：起真实的服务进程，只经 HTTP 与命令行说话。被测程序换语言重写之后，这里的测试照样能跑，所以测试里不能用到被测系统的任何实现。

## 导入的允许清单

ADR 0059 决策 6 的“合同包之外的任何包”指被测系统的工作区包（两个模块、进程入口、前端）与它们带进来的第三方依赖。下面这些不在其内，可以导入：

| 导入 | 在哪里 | 理由 |
|---|---|---|
| `@notnotype/nb-site-identity-contract`、`@notnotype/nb-site-telemetry-contract` | 任何文件 | 合同本身 |
| `typebox`、`typebox/value` | 任何文件 | 合同包的 schema 本身就是 TypeBox 的值；用 `Value.Check(合同包的 schema, 响应体)` 核对响应形状，比逐字段手写断言少漏字段。它不是被测系统的实现：被测程序换语言重写，合同包与这里的检查都不变 |
| `bun:test`、`node:` 内置模块 | 任何文件 | 测试运行器与平台 |
| `@notnotype/neuro-book-test-support/tmp`、`/wait` | 任何文件 | 临时目录与等待工具，与被测系统无关 |
| `@notnotype/neuro-book-test-support/oauth-upstream` | 任何文件 | 仿真的社交上游（Google 与 GitHub）：替的是第三方，不是被测系统的实现；被测程序换语言重写，它照样是站点要接的上游 |
| `bun:sqlite` | 只在 `src/testing/fault.ts` 与备份核对的辅助文件 `src/testing/backup.ts` | 按 Spec 写明的数据目录布局直接碰库文件：持写锁做故障注入、只读打开备份副本核对；不读写被测模块的表 |
| `bun:sqlite` | 只在 `src/testing/aggregate.ts` | 例外：只读打开统计的库、读每日上报按应用版本的聚合份数，给相邻版本测试核“上一个版本在本版本写过的聚合上接着加”。第一版没有读聚合的接口，份数从文件字节看不出来；有了看板接口（t11）后改经接口读，删掉这一行 |
| `@notnotype/neuro-book-test-support/import-boundary` | 只在 `src/boundary.test.ts` | 做这项检查的工具 |

相对导入只许落在本包的 `src/` 里。清单的运行时依赖只有两个合同包与 `typebox`；devDependencies 里的工作区包只有 `nb-site-server`（只用来找到被测程序的启动命令，并让 `test:affected` 改了入口、模块或合同时选中本包）与测试支持包。这些都由 `src/boundary.test.ts` 检查；要放开一项，先改这张表并写明理由，再改检查。

## 写法

- 每个测试文件在顶层调用一次 `useSiteSandbox(<文件名>)`：一个文件一个临时根（ADR 0061 决策 4），各用例在根下用 `dataDir()` 建自己的数据目录。例外是测底座自己收口的 `src/sandbox.test.ts`：它从外面取消一个按路径运行的测试入口（`src/testing/cancel-entry.ts`），服务由那个入口经沙箱起。
- 起进程、跑命令放在 `describe` 的 `beforeAll` 里，用例只发请求、读结果，单个用例守 200 毫秒的预算（测试文档的“服务进程测试”）；超出的在用例旁写明原因。
- 断言只用 [`site/operations.md`](../../docs/specs/site/operations.md) 与模块 Spec 写明的字段名、码、问题词与 `reason`；Spec 没写的输出（日志的 `message`）不断言。被测程序与 Spec 对不上时，不改用例去迁就它，报给 Task。
- 随时间变化的行为用测试控制入口（`advanceClock`、`runJob`），不按真实时间等。故障注入只用 `src/testing/fault.ts` 那种只碰 Spec 写明的文件布局、不读写表的做法。

## 底座的接口（`src/testing/`）

| 名字 | 用途 |
|---|---|
| `useSiteSandbox(purpose)` | 登记 `beforeAll`（建临时根）、`afterEach`（停掉本用例起的、还没停的进程）、`afterAll`（停掉其余的，再删根）；返回沙箱 |
| `sandbox.dataDir()` | 临时根下一个新的空数据目录 |
| `sandbox.start({dataDir, env, command, timeoutMs})` | 起 `serve`，等到 `site.listening`；进程先退出或超时都立即失败，错误里带已收到的输出。缺省带一个随机的测试控制口令，`env: {NB_SITE_TEST_CONTROL: undefined}` 去掉它 |
| `sandbox.run(command, {dataDir, env, command, args, stdin, timeoutMs})` | 跑一个会自己退出的命令，返回退出码、两路输出、日志行与标准错误上的失败行；`args` 接在子命令之后（`create-admin` 的用户名与邮箱） |
| `sandbox.spawnWithOpenStdin(command, {dataDir, env, command, args})` | 起一个标准输入开着的命令，立即返回 `OpenStdinProcess`：`write(text)`、`closeStdin()`、`kill(signal)`、`waitForStderr(what, match)`（等标准错误里出现某一行，进程先退出或超时都抛错）、`result()`（等退出，结果同 `run`）。收口与 `start`、`run` 同一套；收口时只要求它在 SIGTERM 后停下，不要求以 0 退出（被打断的命令本来就报 `interrupted`） |
| `SiteProcess` | `url`、`pid`、`logs()`、`stdout()`、`stderr()`、`exitCode`、`ready()`（等就绪 200）、`stop()`（SIGTERM 并返回退出码）、`advanceClock(ms)`（返回拨过之后的 `now`，不是 200 就抛错）、`runJob(module, job)`（返回状态码与响应体，不按状态码抛错：404、500、503 都是合同里的结果） |
| `identityRequest(url, path, init)`、`cookieJar()`、`login(url, 登录名, 密码, init)`（`init.continue` 带续接令牌）、`createAdmin(sandbox, dataDir, args, 密码)`（`identity.ts`） | 请求一个账号接口：补站点的 `Host`、`Origin`、`X-Forwarded-For`，有请求体时补 `Content-Type`；Cookie 罐存与回送 `Set-Cookie`、按名字覆盖，`last(name)` 取最近一条给断言属性用。账号的进程用 `IDENTITY_SITE_ENV` 起（信任回环上的代理），每个用例给自己的来源地址。`createAdmin` 在 `beforeAll` 里跑 `create-admin` 造登录态，返回账号 id，非零退出时抛错 |
| `siteFetch(url, 站点地址或路径, init)`、`registerOAuthClient`、`authorizationRequest`、`step(url, jar, 授权地址, client)`、`exchangeCode`、`fetchUserInfo`、`revokeToken`、`verifyIdToken(url, idToken, jwksUri)`（`oauth-client.ts`） | 扮演接入的第三方应用：`siteFetch` 把站点地址换成进程地址、补站点的 `Host`，不跟随跳转、正文读成文字；经管理接口登记客户端；带 PKCE、`state`、`nonce` 的授权地址；`step` 发一次请求（缺省 GET；给了表单就以客户端页面的 `Origin` POST 到授权端点）、按 `Location` 归成登录页、站点同意页、确认页、错误页、跳回客户端五类，别的跳转抛错；换码（机密客户端 `client_secret_basic`，公开客户端表单里带 `client_id`）、用户信息、撤销回原始的响应；`verifyIdToken` 按公钥地址用 `node:crypto` 验 RS256，验过才回头与载荷 |
| `followSocial(url, jar, 发起的响应)`、`upstreamCallback(上游地址)`、`openSocialCallback(url, jar, 回调地址)`、`socialStartUrl`（`oauth-client.ts`） | 扮演浏览器走社交流程：请求仿真上游的授权地址（它自动同意、跳回站点的回调），带 `jar` 里的 state Cookie 打开回调，回落点（跳转目标与 `social_error`）；拆开的几步给“另一个浏览器打开回调”“回调之前插入别的操作”的用例用 |
| `startFakeUpstream()`、`upstreamEnv(up)`（`@notnotype/neuro-book-test-support/oauth-upstream`） | 在回环上起仿真的 Google 与 GitHub：`setUser` 设上游登录着的人，`cancelNext`、`failToken` 让下一次授权取消、换令牌出错，`holdToken` 挡住换令牌；`upstreamEnv` 给起站点进程要的七个变量。`afterAll` 里 `close()` |
| `holdWriteLock(dataDir, module)`（`fault.ts`） | 从进程外占住一个模块的库的写锁，返回放锁的函数 |
| `sendReport(url, kind, report, request)`（`telemetry.ts`） | 往写入口发一份上报，带沙箱遥测地址的 `Host` 与 JSON 内容类型；`request` 可换请求体、方法与头（值为 null 的去掉）。`dailyReport`、`heartbeatReport`、`eventReport`、`usageSegment` 按合同包最新的清单造合格的样例 |
| `dataFilesContaining(dataDir, needle)`（`files.ts`） | 数据目录下字节里含有某个串的文件，给“某样东西不进库”的断言用 |
| `listBackups`、`quickCheck`（`backup.ts`） | 列出名字是备份时间的目录；只读打开副本跑 `quick_check` |
| `aggregatedDailyReports(dataDir, appVersion)`（`aggregate.ts`） | 统计的库里某个应用版本的每日上报算进聚合的份数；只给相邻版本测试用，见上面允许清单的例外 |
| `reservePort`、`isListening`、`rawHttp`、`requestJson`、`testControlRequest` | 预留端口与检查有没有人监听；原始套接字请求（测读不出主机名）；按 JSON 读响应。都带截止时刻（缺省 10 秒），到点中断连接并报错 |

子进程的环境只有 `PATH`、指向临时根下空目录的 `HOME` 与 `TMPDIR`，加一套合格的 `NB_SITE_*`；工作目录是临时根。不继承测试进程的环境。

## 对着别的实现跑

- `NB_SITE_SERVER_COMMAND`：被测程序的 argv，JSON 数组，例如 `["bun","--no-env-file","/abs/dist/image/server.js"]`。没设时用本仓库 `nb-site-server` 清单里 `bin` 的源码入口；设得不对时测试报错，不退回缺省。
- `NB_SITE_PREVIOUS_SERVER_COMMAND`：上一个发布版本的程序，形式同上，只给 `src/adjacent-version.test.ts` 用；没设时那一组跳过，组名里写明原因。用本版本自测一次：`NB_SITE_PREVIOUS_SERVER_COMMAND='["bun","--no-env-file","<仓库绝对路径>/packages/nb-site-server/src/main.ts"]' bun run test src/adjacent-version.test.ts`。

## 完成门禁

```text
bun run typecheck
bun test
```
