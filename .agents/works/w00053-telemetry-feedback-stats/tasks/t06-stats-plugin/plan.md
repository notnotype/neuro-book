# t06 本机统计插件：实施计划

## 1. Context

- **为什么做**：用户要在本机看到自己的字数、模型用量与每天的写作情况（日历热力图）；以后的遥测插件（t07）经它的只读接口取数。开发者 2026-11-27 说“先做 t06 统计插件”。
- **依据**：Spec [`stats.local`](../../../../../docs/specs/stats/local.md)（planned）、[`runtime.diagnostics`](../../../../../docs/specs/runtime/diagnostics.md) 输出里的“本机观察（planned）”；提案 [本机统计、遥测与反馈](../../../../../docs/proposals/telemetry-stats-feedback.md) 4.4、4.8；[ADR 0062](../../../../../docs/adr/0062-telemetry-tiers-by-identifiability.md) 决策 7。
- **已定**（提案决策记录）：埋点接口由统计插件提供、遥测只读；记数在发生处、不从请求记录派生；错误码经诊断的本机观察在一处计数；统计插件从不联网（导入图检查，运行期不拦截）；第一阶段只做字数、模型用量、热力图与稳定性一类用得着的形态（提案 4.8）。
- **工作方式**：代码在 Work 分支 `feat/w00053-telemetry-feedback-stats`（worktree `.worktree/w00053-telemetry-feedback-stats`）；切片由 Opus 编码子代理实现，主会话审 diff、跑验证与变异；Spec 与本计划在主工作区 master 上改。碰内核（诊断）与跨进程记数，按高风险后端审（Opus 先审、omp `@review` 后台）；统计视图是界面，先过设计评审（第 5 节 S8）。

## 2. 技术选型

| 问题 | 选用 | 理由；否决 |
|---|---|---|
| 按日存储 | 存储插件的记录（`defineRecord`，user 分区、`locality: "shared"`、`keyed: true`，资源 id 是本机日） | 仓库的插件数据都走它，分区库、事务与清除都现成；否决插件自带 SQLite 文件（多一份库的位置、迁移与备份约定，只为范围查询不值得） |
| 跨进程送数 | 内核远程服务（`defineRemoteService`，provider `server`） | 现成的身份、路由与失败语义；写请求中断即 `unknown-outcome`、不自动重试，正合“结果不明不重放” |
| 本机日 | `clockKey` 取毫秒，本地日期用一个共享的 `localDate`（从 `projects/backend/shelf.ts` 挪到 `src/shared/`，两处共用） | 测试换 `ManualClock`；否决各写一份 |
| 图表 | 手写 SVG（热力图与按天的条形） | 只有两种简单的图，应用里没有图表库；否决引入 ECharts（几百 KB，只为两张图）。最终由 S8 的设计评审定 |
| 导入图检查 | 在 `src/architecture.test.ts` 加一条规则，按源码文字查 | 与现有规则同处；否决运行期拦截（提案已定为已知限制） |

## 3. 关键设计

### 3.1 诊断的本机观察（`packages/nb-runtime/src/diagnostics/`）

- `DiagnosticsService` 加 `observe(observer: (entry: DiagnosticObservation) => void): () => void`，返回撤销函数。
- `DiagnosticObservation = {time: string, level, event, origin: {location, instanceId, plugin, service}, code?: string}`：不含 `message`、`data`、`error`。
- `code` 的来源：脱敏之后的 `data.code`，是字符串并且符合 `^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$` 时才给（仓库的惯例是把码放进 `data.code`；`serializeDiagnosticError` 不保留 `error.code`，这次不改它）。这条约定写进诊断 Spec。
- 交付时机：`store.record` 接受、`#retain` 之后、`#dispatch` 之后，同步逐个调用，每个包 `try/catch`；抛错的观察者计数（`status()` 里加 `observerFailures`），不写诊断（避免递归）。登记之前的不补交；撤销之后不再收到；`stopping`、`closed` 时不交。
- 不变量：记录调用的返回值与出口行为不受观察者影响；观察者在同一线程同步执行，所以“变慢”只能靠观察者自己便宜：统计插件的观察者只往内存里的计数加一。Spec 的“变慢不影响”改成“观察者应当只做常数时间的事；抛错不影响”。

### 3.2 统计插件（`packages/neuro-book/src/plugins/stats/`）

目录照 stickers 与 bots：`plugin.ts`（描述，locations server、project、browser）、`shared/contracts.ts`（贡献点、服务键、远程合同、指标形状）、`backend/`（服务端入口）、`client/`（项目与窗口共用的送数端，浏览器与项目各一个入口文件）、`web/`（视图，S8）、`locales/`。登记在 `src/manifest.ts`、`src/server/plugins.ts`、`src/project/plugins.ts`、`src/web/plugins.ts`。

**指标声明**：贡献点 `nbook.stats.metrics`（`implementation: "none"`，`idPrefix: "plugin"`，照 `bots/shared/contracts.ts` 的 `presetsPoint`）。声明 `{kind: "counter" | "labeled" | "daily", title: TextRef, description: TextRef, labels?: string[] | "open"}`。`labels` 是列表时至多 50 个；`"open"` 表示取值事先不知道（模型名、“拥有者:错误码”、项目），每个本机日每个指标至多 50 个不同取值，之后的记到 `other`。耗时分布与里程碑第一阶段不做（Spec 输出 5、6 标 planned）。

**记数服务** `statsKey`（每个调用方一个门面，`provideServicePerConsumer`，调用方插件 id 由门面带上）：

```ts
interface StatsService {
    count(metric: string, by?: number): void;
    countLabeled(metric: string, label: string, by?: number): void;
    daily(metric: string, day: LocalDay, value: number, label?: string): void; // 同一天同一指标同一标签留最后一次
    status(): "ok" | "degraded";
}
```

所有调用同步返回、不抛错。日期在调用处用本地时钟算（`daily` 由调用方给出），随数一起送。

**服务端入口**（`backend/`）：
- 攒批：内存里按“本机日、指标、标签”累加，5 秒写一次、停止时写最后一次；一个写者队列，写、清除、读都排在它上面。
- 存储：记录 `stats.day`（keyed，资源 id 为 `YYYY-MM-DD`，`maxBytes` 256 KiB），值是 `{v: 1, counters: {[metric]: {[label]: number}}, daily: {[metric]: {[label]: number}}}`（不带标签的计数用标签 `""`）；记录 `stats.days`（不 keyed），有数据的日期的有序列表，给范围读与清除用。
- 校验：按声明丢弃未声明的、不是声明者记的；列表标签外的记到 `other`；开放标签按日计数上限。被丢弃的只计一个内存计数，在 `status` 的详情里给出，不写诊断（一次误用会刷屏）。
- 降级：存储打不开或写失败时进入降级，内存里的这一批丢弃（不无限攒），记一条诊断；下一次写成功回到可用。
- 只读服务 `statsReadKey`：`range(from, to, metrics?)`、`day(day)`、`status()`；只读已落盘的。远程合同 `nbook.stats/read`（provider server、callers browser）给视图用；`metric_unknown`、`stats_unavailable` 两个业务码。
- 清除：`clear()` 在写者队列上丢掉内存里的批、删每个日期的记录与 `stats.days`。远程合同 `nbook.stats/admin`（callers browser）。

**送数端**（项目与窗口的入口，`client/`）：同样的 `statsKey` 门面，本地攒批，5 秒或 200 条一送，经远程合同 `nbook.stats/record`（provider server、callers project、browser，方法 `push`，`effect: "write"`），每条带插件 id、指标、日期、标签、增量或值。送数失败（含 `unknown-outcome`、`unavailable`）就丢掉这一批，计入本地的少计，不重试。入口停止时先送最后一批（等它完成或失败），再收口。

**依赖方向**：内置插件对 `statsKey` 用可选依赖（`required: false`）；统计插件不在或受阻时，它们拿不到服务就不记，业务照常。统计插件只依赖存储、时钟、诊断与远程。

### 3.3 错误码计数（统计插件三个入口）

每个入口激活时 `diagnostics.observe`：级别为 `error` 或 `fatal`、带 `code` 的，`countLabeled("nbook.stats.error-codes", "<拥有者>:<code>")`，拥有者取 `origin.plugin`，没有就是 `runtime`。指标由统计插件自己声明（开放标签）。撤销在入口收口时。

### 3.4 字数（`packages/neuro-book/src/plugins/projects/project/`）

- `stats-tracker.ts` 的 `rollover()` 换日时，把刚结束那一天的 `{date, added: words - baseline, total: words}` 交给一个新的回调 `onDayClosed`；项目入口停止时（`plugin.ts` 的 release，`stop()` 拿到最终快照之后）交当天到此刻为止的值。扫描没完成（`final` 为 null）不交，与现在不写最后一次一样。
- 项目入口可选依赖 `statsKey`，回调里 `daily("nbook.projects.words-added", date, added, projectLabel)` 与 `daily("nbook.projects.words-total", …)`。`projectLabel` 用项目的内部 id；实施时先核对它不由项目名派生，是派生的就改用它的短哈希（Spec：不存项目名）。
- 视图按日把各项目的 `words-added` 相加；“总字数”取每个项目截至那天最后一次交的总数之和。

### 3.5 模型用量（`packages/neuro-book/src/plugins/agent/backend/agent.ts`）

在装配模型端口处（现在 `traceModelPort(options.models.port(...), requests)` 那一行）外面再包一层 `countModelPort(port, stats)`，`call` 与 `complete` 都包：返回后读 `response.usage` 与 `stopReason`，异常或 `error`、`aborted` 记失败。指标（Agent 插件声明，标签开放、取值是 `response.model`，即“提供方/模型”）：`model-requests`、`model-failures`、`input-tokens`、`output-tokens`、`cache-read-tokens`、`cache-write-tokens`、`cost-micro-usd`（费用乘一百万取整，`cost` 为 null 时不加、另记 `unpriced-requests`）。不依赖请求记录的开关；分叉不重新调用模型，所以不重复。Spec 输出 9 的“提供方类别”标签第一阶段不单列（模型的标签已带提供方），等遥测要 Agent 用量时再加。

### 3.6 不联网（`packages/neuro-book/src/architecture.test.ts`）

`plugins/stats/` 下的源码（不含测试）不许导入 `node:net`、`node:http`、`node:https`、`node:tls`、`node:dgram`、`node:dns`、`undici` 与带网络的第三方包，不许出现 `fetch(`、`WebSocket`、`XMLHttpRequest`、`EventSource`、`sendBeacon`。导入别的插件只许 `shared/contracts.ts`（已有规则）。

### 3.7 统计视图（`plugins/stats/web/`，S8）

字数（每天净增与总字数）、按模型的请求数与 token 与费用、日历热力图（缺测与零用不同样子），时间范围近 30 天、近一年、全部；“清除全部统计数据”的入口。放在哪（工作台视图还是编辑区的标签页）、样子与清除的确认，在设计评审里定：先在 Lab 草稿区出静态稿、上评审板给开发者看，定稿后再写进本节。

## 4. Spec 与文档改动（主工作区，S0 先改）

- `docs/specs/stats/local.md`：
  - 输入：声明加 `labels: "open"` 与按日 50 个取值的上限；`daily` 带可选标签，输出 7 改成“同一天同一指标同一标签留最后一次”；
  - 输出 5、6（耗时分布、里程碑）标“（planned）”；输出 9 的“提供方类别”标“（planned）”；输出 8 写明按项目分标签、视图按日相加；输出 14 的清除写明在统计视图里（若设计评审放到设置页再改）；
  - 状态与转换：降级时丢弃内存里的批；送数端停止时先送最后一批。
- `docs/specs/runtime/diagnostics.md`：“本机观察”一条写成 3.1 的形状（交付字段、`code` 的来源、同步调用与失败计数），实现后去掉 planned。
- 插件说明：`plugins/stats/README.md` 或包内说明（照相邻插件的做法），写指标怎样声明与记。
- 计划与 Task README：开工时建 Work 分支，README 记进展。

## 5. 切片

| 片 | 内容 | 依赖 | 自跑验证 |
|---|---|---|---|
| S0 | Spec 改动（第 4 节），Work 分支与 worktree | 开发者确认本计划 | `bun run docs:check` |
| S1 | 诊断的本机观察（3.1） | S0 | `bun run test:affected --package nb-runtime --with-consumers --typecheck` |
| S2 | 统计插件的服务端：贡献点与声明校验、攒批、记录、只读服务与远程读、清除、降级（3.2 服务端） | S0 | `bun run test:affected --package neuro-book --typecheck` |
| S3 | 送数端：项目与窗口入口、远程 `push`、停止时送最后一批（3.2 送数端） | S2 | 同上，加真实项目子进程的用例 |
| S4 | 错误码计数（3.3） | S1、S3 | 同上 |
| S5 | 字数（3.4） | S3 | 同上，加 projects 的既有测试 |
| S6 | 模型用量（3.5） | S2 | 同上，加 agent 的既有测试 |
| S7 | 不联网的导入图规则（3.6） | S2 | `bun test packages/neuro-book/src/architecture.test.ts` |
| S8 | 设计评审 → 统计视图与清除（3.7） | S2；开发者定稿 | vitest dom、Lab 场景、e2e |

每片一个提交，切片编码派 Opus 子代理，主会话审 diff、跑验证与变异。S1、S3 做完各派一次实现审查（Opus 先审，omp `@review` 后台批量审 S1 到 S6）；S8 前端审查派 Sonnet。

## 6. 验收映射

| Spec | 覆盖 |
|---|---|
| `stats.local` 输出 1、2、4、7、16，失败码 `metric_unknown` | S2 服务端单测（真实存储插件、临时状态根） |
| 输出 3、验收 1 | S3：`ManualClock` 在 23:59 记、过了 00:00 才送达，读到在前一天（真实项目子进程） |
| 输出 8、验收 3 | S5：项目跨过午夜交出前一天；某天不开项目，那天缺测、前后不变 |
| 输出 9、验收 2 | S6：关掉 `requestTrace` 后发请求，用量照常增加；分叉后不重复 |
| 输出 10 | S4：三个运行位置各记一条带码的错误，读到“拥有者:码”的计数；不带码与非错误级的不计 |
| 输出 11、验收 4，失败码 `stats_unavailable` | S2：存储写失败时记数照常返回、状态降级、只读报 `stats_unavailable` |
| 输出 12 | S3：远程 `push` 结果不明时不重发（拦下回应、看服务端只收到一次） |
| 输出 13、14 | S8：dom 测试与 e2e |
| 输出 15、验收 5 | S7：导入图规则；验收 5 的“禁止出网的环境”由导入图规则代替，运行期不另测（已知限制） |
| 时序：两个窗口与一个项目子进程同时记 | S3：两个送数端加一个项目子进程，和等于三者之和 |
| `runtime.diagnostics` 本机观察 | S1：nb-runtime 单测（登记前不补交、撤销后不收、抛错不影响记录与出口、只交约定的字段） |
| Smoke | S2：应用的合同测试里“记数后在只读接口读到” |

## 7. 验证

- 每片：表里的命令；收口：`bun run test:affected --package nb-runtime --package neuro-book --with-consumers --typecheck --since master`、`bun run governance:check`。
- e2e：只在 S8 跑统计视图自己的文件与 Lab 场景；开工前在起点上先跑一遍基线。
- 真实进程：S3、S5 用真实的项目子进程（照 projects 现有的进程测试），不用替身。
- 未验证的边界：浏览器窗口被直接关掉时最后 5 秒的数（Spec 已允许少计）；“禁止出网的环境”只靠导入图规则。

## 8. 测试分工

本 Task 的 e2e 只在 S8，量不大，由主会话派的编码子代理连同视图一起写；S1 到 S7 是后端与纯逻辑，用例随实现写。

## 9. 不做与风险

- 不做：耗时分布、里程碑、提供方类别标签、遥测与上报、第三方插件的自定义卡片。
- 风险：项目入口停止时，字数的最后一次交数要在统计送数端收口之前完成。依赖可选依赖的收口顺序（依赖方先收口），S3 先跑真实探针确认顺序，再写 S5。
- 风险：开放标签的上限按日计，长期不开项目的人数据量很小；但错误码可能刷出很多不同取值，上限与 `other` 兜住。
- 风险：`declarations.list` 在服务端能看到项目与浏览器入口声明的贡献，S2 开工先用探针确认；看不到时把指标声明一律写在插件描述上（描述级贡献）。
