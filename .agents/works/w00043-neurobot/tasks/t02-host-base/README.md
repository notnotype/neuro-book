---
schema: nbook.task/v2
taskId: t02-host-base
status: planned
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

- [w00032 t32](../../../w00032-agent-integration/tasks/t32-harness-backfill/README.md) 把模型角色与压缩触发点的规则搬进 nb-harness 的 `./models/rules`；本 Task 的模型服务部分建在它之上，排在 t32 合入之后。两端宿主与 HTTP 的部分不碰 t32 的文件，可以先做。
- 抽到哪个包（nb-runtime 的新子路径，还是新包）在计划里定：nb-runtime 现在运行时依赖只有 TypeBox、前后端共用、与应用无关（[ADR 0030](../../../../../docs/adr/0030-plugin-platform-layering.md) 决策 1），服务端宿主要用 Bun 的服务与文件锁。
- 代码在 Work 分支上做（`feat/w00043-neurobot`，worktree `.worktree/w00043-neurobot`），开工时建。

## 当前状态

2026-11-10：[plan.md](plan.md) 初稿（Opus）做了计划审查（Opus 审服务端、HTTP 与模型服务 16 条，Sonnet 审浏览器宿主 12 条）与独立设计（Sonnet），报告在 `evidences/`。处理如下；三项交开发者（见“待开发者定”），定了再改第二稿。

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

## 下一步

派 Opus 按上表与上面三项改第二稿；第二稿交开发者确认后，主 Agent 在主工作区写 ADR（新包 nb-host、nb-models、加锁替换的小包，ADR 0030 决策 2 的修订），再开工。
