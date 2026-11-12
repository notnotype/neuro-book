---
schema: nbook.task/v2
taskId: t02-host-base
status: active
updated: 2026-11-10
---

# 把两端宿主的通用部分与模型服务抽成包

## 目标与范围

NeuroBot（[提案](../../../../../docs/proposals/neurobot.md)）是 monorepo 里第二个建在 nb-runtime 上的应用。仍在 NeuroBook 应用里、NeuroBot 也要的部分，开发者 2026-11-10 选了提案第二稿待定项 1 的 (b)：只把安全攸关、已经调好的抽成包，两边共用；其余 NeuroBot 自己写。

要抽的（行为不变）：

- 服务端宿主中与应用无关的部分（`packages/neuro-book/src/server/`，非测试代码 3,952 行，其中多少与应用无关要在计划里分清）：只许监听回环地址、`Host` 与 `Origin` 核对、数据目录（状态根）认领、内核 RPC 端口的监听与握手、启动与停止。
- 浏览器宿主中与应用无关的部分（`packages/neuro-book/src/web/`）：浏览器一侧的内核实例与 RPC 连接、断线与重连。
- HTTP 的来源核对：`packages/neuro-book/src/plugins/http/backend/` 的准入与分发（`Host` 421、`Origin` 403）。
- 模型服务：`packages/neuro-book/src/plugins/models/backend/core.ts`（按角色解析模型、服务商与模型配置、OMP 凭据库、给 harness 的模型端口）。设置页留在应用。

不抽、NeuroBot 自己写的：设置、存储、把 harness 接进应用的那层、网页对话宿主。

安全规则以 [`runtime/server-host.md`](../../../../../docs/specs/runtime/server-host.md) 为准（只监听回环、`Host` 421、`Origin` 403），抽出后两边共用一份实现，并由测试守住。

非目标：不改 NeuroBook 用户可观察的行为、配置与环境变量；不实现 NeuroBot 的任何东西；不搬 `plugin-platform`（ADR 0030 的条件按开发者 2026-11-10 的决定另写 ADR 修订）。

合同：行为合同未变；[`runtime/server-host.md`](../../../../../docs/specs/runtime/server-host.md)、[`runtime/browser-host.md`](../../../../../docs/specs/runtime/browser-host.md)、[`models/service.md`](../../../../../docs/specs/models/service.md) 的 owner 与实现合同几节随代码改。

## 与其它工作的关系

- [w00032 t32](../../../w00032-agent-integration/tasks/t32-harness-backfill/README.md) 已于 2026-11-10 合入。它的第三稿不再搬模型规则：模型角色与压缩触发点的规则、选择顺序都由本 Task 搬进 `nb-models`；t32 只在 nb-harness 的 `kit/shapes.ts` 定了压缩角色 id `MODEL_ROLES.compaction`，本 Task 的模型几片要用它。
- 抽到哪个包（nb-runtime 的新子路径，还是新包）在计划里定：nb-runtime 现在运行时依赖只有 TypeBox、前后端共用、与应用无关（[ADR 0030](../../../../../docs/adr/0030-plugin-platform-layering.md) 决策 1），服务端宿主要用 Bun 的服务与文件锁。
- 代码在 Work 分支上做（`feat/w00043-neurobot`，worktree `.worktree/w00043-neurobot`），开工时建。

## 当前状态

2026-11-10：[plan.md](plan.md) 初稿（Opus）做了计划审查（Opus 审服务端、HTTP 与模型服务 16 条，Sonnet 审浏览器宿主 12 条）与独立设计（Sonnet），报告在 `evidences/`。处理如下；三项交开发者（见“待开发者定”），定了再改第二稿。

2026-11-10：按下表与“开发者定的”三项改出第二稿（Opus，424 行）：新包三个（`nb-file-lock`、`nb-host`、`nb-models`）；切片重排为 0 ADR（主 Agent 在主工作区写）、1 `nb-file-lock`、2 到 6 `nb-host`、7 与 8 `nb-models`（t32 合入、变基之后）、9 文档与合入前清单，第 1 到 6 片可在 t32 合入前先合。表外顺带改的：补丁校验脚本加“只有 `nb-file-lock` 声明 `proper-lockfile` 且版本 4.1.2”；第 4 片用过渡导出 `createHostPlugins`、第 5 片删去；`runtime/diagnostics.md` 进 Spec 改动表；B4 的“锁失效只报诊断、进程不崩”用例放在 `nb-file-lock`。主 Agent 核对：引用 `locked-replace` 的非测试文件 19 个、提到它的测试 9 份（`locked-replace.test.ts` 随包搬走、`architecture.test.ts` 另改，要改导入的正是计划写的 7 份）；直接导入 `proper-lockfile` 的应用文件 4 个（`locked-replace.ts`、`jsonl-exporter.ts`、`layer-file.ts`、`plugin-platform/backend/startup.ts`），计划都给了去处。剩三项交开发者（计划“需要开发者确认”）。

### 实施进度

代码在 `.worktree/w00043-neurobot`（分支 `feat/w00043-neurobot`），主会话写。

- 第 1 片（`nb-file-lock`）已提交：包与两条真实子进程用例（并发替换 40 次不丢、暂停到过期后被接管只报诊断不崩）、应用 26 个文件改导入、`startup.ts` 改用 `lockHeld`、补丁校验加“只有 nb-file-lock 直接声明”、应用架构测试加运行位置表。验证：包的 `typecheck` 与 `bun test`（5 条）；应用 `bun run typecheck`（三份配置都过，证实入口的 `/// <reference>` 把 `proper-lockfile` 的声明带给使用方）；应用 `src/backend`、`files`、`settings`、`canon`、`plugin-platform`、`server/projects`、`server/instance.test.ts`、`explorer`、`diagnostics`、`projects` 与架构测试 761 条，1 条负载下超时、单独重跑通过；`validate-proper-lockfile-patch.ts` 通过，把 nb-time 临时改成直接声明时它报错；脚本的类型检查与 `scripts/ci` 测试；`governance:check`、`docs:check`；`test:affected` 选得到新包。
- 第 1 片漏改一处：应用依赖多了 nb-file-lock，开发监督进程的监视目录随之多一项，`src/server/dev/watch.test.ts` 的期望没改（第 1 片的验证没跑 `src/server/dev`），已单独提交修正。
- 第 2 片（nb-host 骨架、`./socket`、`./testing`）已提交：nb-host 的两份类型检查与边界测试；应用类型检查、`src/server`、`src/web/host`、`files/transport.test.ts`、`canon`、架构测试，3 条项目子进程用例负载下超时、单独重跑通过；`build:web`；`build:sdk` 的产物里没有 nb-host 与 nb-file-lock；开发模式页面加载（书架页，报告无问题）。第 1、2 片之后应用整套 `test:bun` 2754 条通过，6 条子进程用例负载下超时，单独重跑 44 条全过。
- 第 3 片（`./server`：回环与来源、端口顺延、状态根认领）已提交：认领档案改成 `defineClaimProfile` 建出（核对字段不与基础字段重名、建好整个应答的 schema），发布时核对应用字段，各加一条用例；应用 `instance.ts` 是 NeuroBook 的档案加 `claimNeuroBook`、`queryNeuroBook`（版本只在测试里换）。验证：nb-host 24 条；应用类型检查；`src/server`、`src/cli`、架构测试、`window.test.ts` 206 条，`server-projects.test.ts` 的项目停止用例在负载 16 到 20 下超时，放宽到 30 秒全过（每条约 5 秒）。
- 第 4 片（HTTP 进 nb-host，路由合同 `./http/contracts`）已提交：准入拒绝的产品名由宿主传入（应用传 `NEUROBOOK_PROFILE.productName`，文字不变），HTTP 插件的 id 由宿主传入，`Host` 核对改用 `LOOPBACK_URL_HOSTS`；应用 17 个文件改导入（计划写 12 个，另有 `browser-bootstrap.ts`、`plugin-files.ts` 用 `HostRoute`，`window.test.ts` 用 `errorResponse`，`server.test.ts`、`theme-asset-route.test.ts` 用准入与分发层）。验证：nb-host 53 条；应用类型检查；`src/server`、`files`、`projects`、`theme-editor.test.ts`、架构测试、`window.test.ts`、`agent/attachments.test.ts` 555 条，`files/project-child.test.ts` 一条“没有外部回声”在负载下多收 7 条变更，单独跑两次都过。分支上 `docs:check` 报 `runtime/server-host.md` 证据里 4 条指向 `plugins/http/backend/` 的链接，合入后改。
- 与计划的偏差（第 4 片）：没有做过渡的 `createHostPlugins` 包装，直接从 `./server` 过渡导出 `createHttpPlugin`、`HttpAdmission`、`HttpAdmissionRejected`、`HTTP_DRAIN_LIMIT_MS`，第 5 片删去；产品名只给准入，没有再给 HTTP 插件（插件里没有带产品名的文字）。`HostRoute` 类型从 `./server` 长期导出（应用给宿主接口）。
- 第 5 片分两次提交。前半（5a）已提交：服务端诊断出口与浏览器诊断出口、宿主适配器 `startServerHost`（平台档案必填、放在清单之后）、内核 RPC 监听（503 文字的产品名由宿主传入、监听前核对回环）搬进 nb-host，浏览器诊断为 `./web`；应用约 40 个文件改导入。验证：nb-host 70 条与两份类型检查；应用类型检查；应用整套 `test:bun` 2698 条通过，4 条子进程用例负载下 5 秒超时，单独重跑 67 条全过。期间一次失误：全套测试运行中删了 `./server` 的过渡导出，那一轮作废、恢复后重跑。应用名扫描的 `nbot` 原来会匹配 `drainBoth` 这类单词内部，已收紧（nb-file-lock 一并改）。
- 第 5 片后半（5b）：`startHostServer` 在 nb-host，应用 `src/server/start.ts` 改成装配者（产品名、平台档案、插件表、能力表、宿主接口、项目管理器与开发任务两个扩展），`server/plugins.ts` 删去 `serverHostPlugins`，两个宿主插件经上下文交来。应用 `src/server`、`src/project`、`src/cli`、`src/web/host` 与架构测试 244 条通过；nb-host 新增同进程用例 9 条（宿主插件核对三种、回环、扩展钩子时序三条、启动失败 503、`Host` 421 与 `Origin` 403 且 RPC 升级同一份判定）。
- 与计划的偏差（第 5 片）：`http.hostRoutes` 与 `capabilities` 改成函数（引导接口要实际 RPC 端口，插件文件接口与插件清单要诊断存储，都在宿主里才有）；宿主句柄加只读的 `activeRequests`（已接纳或在等就绪的请求数），两条“启动失败时等待中的请求得到 503”的用例改等它，应用拿不到准入对象；进程级用例（信号、标准输入、未处理异常、在途请求、关闭失败）没有搬进 nb-host，仍在应用 `server.test.ts` 经产品装配跑同一份 nb-host 代码，nb-host 只加同进程用例与来源用例；`server.test.ts` 没有按用例逐条拆，同进程组照旧留在应用。新写的三条开发诊断用英文，搬来的中文消息不改。
- 第 6 片（浏览器宿主 `./web`）已提交：浏览器适配器（平台档案必填，加一条“清单里带的档案覆盖不了”的用例，把合并顺序反过来时它失败）、远程会话（`openRemote` 与 `refreshEndpoint` 注入，`close()` 中止在途的重取，去掉这一句时用例失败）、`openRpcSocket` 与 `rpcSocketUrl`、`ConnectionError`、`readClientIdentity(key, storage)`；应用新增 `web/host/endpoint-refresh.ts`（协议版本与引导结构，经真实 `fetch` 的 5 条用例）、`window.test.ts`“重连时引导的协议版本变了”。验证：nb-host 98 条与两份类型检查；应用类型检查、`src/web` 与架构测试的 `bun test` 82 条、`test:vitest src/web` 60 条、`build:web`；开发模式页面加载（书房页，报告无问题）。
- 与计划的偏差（第 6 片）：应用的 `Connection` 保留 `openRemote`（实现改成调 `openRpcSocket`），窗口把它交给远程会话，`mount.dom.test.ts` 的进程内链路替身因此不用改；`bootstrap` 多一个可选的 `signal`，重取端点经它中止。nb-host 的 `client-identity.test.ts` 另加两条（键由应用给、写不进存储）。分支上 `docs:check` 预期多报 `runtime/browser-host.md` 证据里指向 `web/host/remote-session.ts`、`remote-session.test.ts`、`client-identity.dom.test.ts`、`browser-host.test.ts` 的链接。

### 计划第一稿的处理

后端审查（B）、前端审查（F）、独立设计（D）：

| 来源 | 结论 | 第二稿怎么改 |
|---|---|---|
| B1 扩展的 `attach` 拿不到路由与诊断存储 | 成立 | `attach` 收宿主上下文 `{application, router, store, instanceId}`，写明调用时它们已就绪 |
| B2 选择顺序已归本 Task，服务里写死三个角色 id | 成立 | 选择顺序与内置角色 id 由本 Task 搬，角色 id 导出为常量，宿主的角色表必须包含；纯函数加测试与变异检查 |
| B3、D 设置存储接口只有签名、没写语义 | 成立 | 写进接口合同（自己写入也通知、写后立即可读、冲突重试等通知、`expect` 的比较）；导出一组一致性测试，内存实现与 NeuroBook 的设置适配器各跑一遍 |
| B4 认领锁的精简版丢了两道保护与诊断事件名 | 成立 | 视“待开发者定”第 2 项：抽出加锁替换就直接用它；不抽则私有模块保住 `onCompromised`、放锁前的身份核对与事件名，并加“锁失效只报诊断、进程不崩”的用例 |
| B5、D HTTP 插件的安全接线仍由各应用手接 | 成立 | `startHostServer` 自己装 HTTP 插件，应用只给插件 id、路由与静态目录；来源判定函数由包算出，应用换不掉 |
| B6 认领档案的扩展字段与 `readyInfo` 没有类型关联 | 成立 | 同一个类型参数贯穿；发布时在包里校验，不合就抛错 |
| B7 扩展钩子的时序没写 | 成立 | 接口注释写死三条（停止开始后不调 `ready`、`stopping` 失败计退出码 1、`ready` 在放行与发布之后），各配一条同进程用例 |
| B8 分支上的 `docs:check` 必然报指向旧文件的链接 | 成立 | 写明分支上预期只报这几条链接（列清单）；合入后紧接着在主工作区提交文档 |
| B9 退出码 75 现在没有实现 | 成立 | 改写为“现在只有 0 和 1”，75 以后从哪进来写进不做 |
| B10 第二道回环校验没在任何监听之前 | 成立 | `startHostServer` 第一步核 host 与来源，失败走装配失败路径（写致命诊断、放认领）；端口试探也核一次 |
| B11 回环集合有两份、RPC 的 503 文字带产品名 | 成立 | 分发层用同一份常量；RPC 监听收产品名 |
| B12、D 诊断日志出口不在划分表里 | 成立 | 见“待开发者定”第 3 项 |
| B13、D 远程合同的失败码与服务结果没有类型关联 | 成立 | 视“待开发者定”第 1 项：放进新包时合同的定义对象与失败码表随服务一起进包 |
| B14、D 加锁替换留在应用，NeuroBot 会抄第三份 | 质疑已定范围 | 交开发者（“待开发者定”第 2 项） |
| B15 两个应用误用同一状态根，挡不挡得住取决于路径长短 | 成立，窄场景 | 记为已知限制：不支持两个应用共用状态根，写进 nb-host 的 README |
| B16 拆 `server.test.ts` 时三条用例两边都没列 | 成立 | 验收映射按用例名逐条列去向，这三条进 nb-host |
| F1 重连的不兼容终态不带原因 | 成立 | `refreshEndpoint` 交回 `{incompatible: string}`，原因由应用拼；不得抛错 |
| F2 应用的“前端不引后端”测试对 nb-host 子路径失效 | 成立 | 应用的架构测试加 nb-host 子路径的运行位置表，第 1 片就加 |
| F3 浏览器身份的 DOM 测试在新包里没有归宿 | 成立 | 改写成 `bun test`（存储替身加抛 `SecurityError` 的取存储函数），真实存储由已有 e2e 代表 |
| F4 浏览器从第 1 片起就经 Vite 用 nb-host | 成立 | 第 1 片验证加 `build:web` 与开发模式页面加载，第 5 片再跑一次 |
| F5 必填的 `platform` 可被清单覆盖 | 成立 | 清单类型去掉 `platform`，档案放后面；只有宿主文件能调内核的 `createApplication` |
| F6 应用名扫描不认 NeuroBot | 成立 | 正则加 `neurobot`、`nbot`，各带反例 |
| F7 浏览器侧的第三方依赖要白名单 | 成立 | 分层测试改成白名单，失败信息指向应用的 `optimizeDeps.include` |
| F8 三段浏览器代码缺直接测试 | 成立 | 加 `openRpcSocket` 的真实 WebSocket 测试与地址拼接的纯函数测试；应用侧给 `refreshEndpoint` 加直接测试与重连时版本变化的用例 |
| F9 NeuroBot 的重启后自动重连 | 部分成立 | 写明终态后由应用重建窗口实例；`refreshEndpoint` 收 `AbortSignal`、关闭时中止；退避表做成选项不做（没有使用者） |
| F10 `ConnectionError` 放在套接字文件里 | 成立 | 单独成文件，列出要改导入的文件 |
| F11 浏览器类型检查没覆盖 `./http/contracts`、要排除测试 | 成立 | 挪到 `src/shared/` 或加进 include；写明 `exclude` |
| F12 插件 SDK 的类型打包不认识 nb-host | B 已核实 SDK 不经这些入口 | 第 1 片验证加 `build:sdk`，确认产物不出现 nb-host |
| D 模型服务放进新包 nb-models（合同定义对象随服务进包） | 与初稿不同 | 交开发者（“待开发者定”第 1 项） |
| D `definitionAt` 交回新对象，按对象身份核对插件会误判 | 成立 | 按 id 加入口身份核对 |
| D 范围外：nb-story 与开发者面板的本地服务可能没有 `Host`、`Origin` 核对 | 不成立（读代码判断） | nb-story 有一次性口令登录加会话 Cookie（`packages/nb-story/src/server/auth.ts`），重绑定的页面拿不到 Cookie；不处理 |

### 开发者定的（2026-11-10，答“可以”，三项都按推荐）

1. 模型服务放进新包 `nb-models`（依赖 nb-runtime 与 nb-harness），远程合同的定义对象与失败码表随服务进包，两个应用只填各自的 id。原来 w00032 t32 要搬进 nb-harness 的 `models/shared/rules.ts`、`compaction.ts` 改由本 Task 搬进 `nb-models`。
2. 加锁替换（`packages/neuro-book/src/backend/locked-replace.ts`）抽成一个与应用无关的小包；nb-host 的数据目录认领、NeuroBook 的设置与 Files、以后 NeuroBot 的记忆与设置都用它，锁的参数只有一份。
3. 诊断日志的输出插件（`runtime.diagnostics`）进 nb-host。

### 第二稿的确认项（2026-11-10 按“待确认默认追认”算定）

开发者同意 Work 的 Task 规划（答“可以”）时，计划“需要开发者确认”的三项还列着、没有单独作答，按推荐算定，有异议再改：

1. 小包叫 `@notnotype/nb-file-lock`（`packages/nb-file-lock`）；`staged-commit.ts` 留在应用。
2. 三个包的 exports 按计划所列，都设 `private: true`、不发 npm；写进第 0 片的 ADR。
3. 五个内置角色与选择顺序归 `nb-models`，两个应用共用；名字与说明各应用自己写。

代码由谁写没有答复，按开发者的全局规则由主会话写。

## 下一步

第 0 片已做（2026-11-10）：[ADR 0045](../../../../../docs/adr/0045-shared-host-packages-for-second-app.md) 记三个新包与 ADR 0030 决策 2 的修订，索引已补注。2026-11-10 开发者听过三个包与对 nb-harness、`nbook.agent` 的影响后答“可以”，开工：worktree `.worktree/w00043-neurobot`（分支 `feat/w00043-neurobot`），代码由主会话写，从第 1 片做起。
