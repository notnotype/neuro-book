# t06 本机统计插件：实施计划

## 1. Context

- **为什么做**：用户要在本机看到自己的字数、模型用量与每天的写作情况（日历热力图）；以后的遥测插件（t07）经它的只读接口取数。开发者 2026-11-27 说“先做 t06 统计插件”，同日确认本计划第一稿。
- **依据**：Spec [`stats.local`](../../../../../docs/specs/stats/local.md)（planned）、[`runtime.diagnostics`](../../../../../docs/specs/runtime/diagnostics.md) 输出里的“本机观察（planned）”；提案 [本机统计、遥测与反馈](../../../../../docs/proposals/telemetry-stats-feedback.md) 4.4、4.8；[ADR 0062](../../../../../docs/adr/0062-telemetry-tiers-by-identifiability.md) 决策 7。
- **已定**（提案决策记录）：埋点接口由统计插件提供、遥测只读；记数在发生处、不从请求记录派生；错误码经诊断的本机观察在一处计数；统计插件从不联网（导入图检查，运行期不拦截）；第一阶段只做字数、模型用量、热力图与稳定性一类用得着的形态（提案 4.8）。
- **工作方式**：代码在 Work 分支 `feat/w00053-telemetry-feedback-stats`（worktree `.worktree/w00053-telemetry-feedback-stats`）；切片由 Opus 编码子代理实现，主会话审 diff、跑验证与变异；Spec 与本计划在主工作区 master 上改。碰内核（诊断）与跨进程记数，按高风险后端审（Opus 先审、omp `@review` 后台）；统计视图是界面，先过设计评审（第 5 节 S8）。
- **设计审查**：Opus 一轮 12 条全部成立，处理见第 10 节；本稿是按它改过的第二稿。omp 一份在后台，回来再处理。

## 2. 技术选型

| 问题 | 选用 | 理由；否决 |
|---|---|---|
| 按日存储 | 存储插件的记录（user 分区、`locality: "shared"`、`keyed: true`） | 仓库的插件数据都走它，分区库、事务与清除都现成；服务端 `open` 只是登记、读是单行查询，读一年的代价可以接受（审查核过）；否决插件自带 SQLite 文件 |
| 跨进程送数 | 内核远程服务，送数端按调用方代理（`context.remote.on(consumer)`，入口声明 `remoteDelegates`），照 storage 的浏览器入口 | 代理门面释放期间经代理的调用仍可用（`runtime/plugin-channel.md` 输出 10），所以收口时能送最后一批；服务端从内核填的身份得到插件 id，不信请求体；否决入口自己的远程访问（入口一停就以 `cancelled` 结算，审查第 1 条） |
| 本机日 | `clockKey` 取毫秒，本地日期用一个共享的 `localDate`（从 `projects/backend/shelf.ts` 挪到 `src/shared/`） | 测试换 `ManualClock`；消除项目入口对服务端文件的引用 |
| 图表 | 手写 SVG（热力图与按天的条形） | 只有两种简单的图，应用里没有图表库；否决引入 ECharts。最终由 S8 的设计评审定 |
| 导入图检查 | `src/architecture.test.ts` 里给 `plugins/stats/` 一份导入白名单，另禁网络类全局名 | 照插件平台的白名单写法（`PLATFORM_ALLOWED_PACKAGES`）；黑名单列不全第三方包 |

## 3. 关键设计

### 3.1 诊断的本机观察（`packages/nb-runtime/src/diagnostics/`）

- `DiagnosticsService` 加 `observe(observer, options?: {replay?: boolean}): () => void`。
- 交付形状 `DiagnosticObservation = {sequence, time, level, event, origin: {location, plugin, service}, code?}`：不含 `message`、`data`、`error`、`instanceId`（统计用不到的身份字段不交）。
- `code` 按顺序取第一个合格的，取值都是脱敏之后的：`data.code`；三个机制事件（`lifecycle.failure`、`services.diagnostic`、`plugins.diagnostic`）的 `data.reason`；`error.code`。合格是 1 到 64 个字母、数字或 `.`、`_`、`:`、`-`，字母或数字开头。`serializeDiagnosticError` 加保留合格的 `code`（落盘的错误对象因此多一个字段，同一条正则把关）。
- `origin.plugin` 为空时，机制事件取 `data.plugin`；都没有就不给，由统计记成 `runtime`。
- 挂在 `record()` 里、`#dispatch` 返回之后，不挂进 `#dispatch`（`attach()` 补写挂接前缓冲时也调 `#dispatch`，挂进去会重复交）。遍历观察者列表的快照；正在交付时又进入 `record()`（观察者里间接记了诊断、`console` 桥接）的那一条，照常记录与写出口，但不再交给观察者，只计数。
- 观察者抛错：计入 `status()` 的 `observerFailures`，不写诊断。`stopping`、`closed` 时不交。
- `replay: true`：登记时把有界缓冲里还在的记录按同一形状先补交一遍，再接实时的；`sequence` 让调用方能去重。缺省不补交（Spec 原文）。
- 观察者在记录调用里同步执行，应当只做常数时间的事；统计的观察者只改内存里的计数。

### 3.2 统计插件（`packages/neuro-book/src/plugins/stats/`）

目录照 stickers 与 bots：`plugin.ts`（描述，locations server、project、browser）、`shared/contracts.ts`（贡献点、服务键、远程合同、指标形状、校验）、`backend/`（服务端入口）、`client/`（项目与窗口共用的送数端，各一个入口文件）、`web/`（视图，S8）、`locales/`。登记在 `src/manifest.ts`、`src/server/plugins.ts`、`src/project/plugins.ts`、`src/web/plugins.ts`。

**指标声明**：贡献点 `nbook.stats.metrics`（`implementation: "none"`，`idPrefix: "plugin"`，照 `bots/shared/contracts.ts` 的 `presetsPoint`）。指标一律写在插件描述的顶层 `contributions` 上：只有顶层声明三个位置都看得到（`plugin-platform/shared/definitions.ts` 的 `definitionAt`），写在入口上的服务端看不到；`architecture.test.ts` 拒绝入口上的 `nbook.stats.metrics`。

```ts
type MetricDeclaration = {
    kind: "counter" | "labeled" | "daily";
    title: TextRef; description: TextRef;
    labels?: readonly string[] | "open";   // labeled 与 daily 用；列表至多 50 个
    local?: true;                           // 标签是本机标识（项目 id、服务商与模型名）：以后的遥测清单不许收它
    unit?: "count" | "tokens" | "micro-usd" | "words";
};
```

“声明者被停用”在这里的意思是插件不在当前清单里（被关掉或卸载）：服务端的声明表里没有它，它的记数按“未声明”丢弃，已有数据照样可读。

**记数服务** `statsKey`（`provideServicePerConsumer`，调用方插件 id 由门面带上；同步、不抛错）：

```ts
interface StatsService {
    count(metric: string, by?: number): void;
    countLabeled(metric: string, label: string, by?: number): void;
    daily(metric: string, day: LocalDay, value: number, label?: string): void;
}
```

**校验**（门面与远程合同的 schema 两处）：`by` 是 1 到 1e9 的安全整数，缺省 1；`value` 是 0 到 `Number.MAX_SAFE_INTEGER` 的整数；`day` 合 `YYYY-MM-DD`、是真实日期、在“今天前 400 天”到“今天后 1 天”之间；标签 1 到 128 个字符。不合格的丢弃、计数，不进累加。累加封顶在 `Number.MAX_SAFE_INTEGER`。

**服务端入口**（`backend/`）：
- 攒批：内存里按“本机日、声明者、指标、标签”累加，5 秒写一次、停止时写最后一次；一个写者队列，写、清除、读都排在它上面。
- 存储：每天每个声明者一条记录 `stats.day`（keyed，资源 id `YYYY-MM-DD.<声明者 id 的短哈希>`，`maxBytes` 256 KiB），值 `{v: 1, plugin, counters: {[metric]: {[label]: n}}, daily: {[metric]: {[label]: n}}}`（不带标签的用标签 `""`）；一条 `stats.meta`（不 keyed）`{v: 1, earliest: LocalDay | null, plugins: string[], clearedAt: number | null}`，记最早的日期、写过数的声明者与上次清除的时刻。写入顺序：先 `stats.meta`（需要时），再各条日记录；读时日期范围由 `earliest` 与今天算出，逐日逐声明者读，没有的是缺测。一个声明者超限只影响它自己那一条（`too-large` 按“丢弃”计，记一条诊断）。
- 合并：日记录用 `update` 合并，计数相加、每日数值覆盖；开放标签的上限在合并时对照记录里已有的取值检查，所以重启后照样成立；超出的记到保留标签 `$overflow`，列表模式下没列出的记到 `other`，两者分开。
- 降级：存储打不开或写失败（`too-large` 除外）时进入降级，这一批丢弃，记一条诊断；下一次写成功回到可用。
- 只读服务 `statsReadKey`：`range(from, to, metrics?)`、`day(day)`、`status()`（可用或降级，加丢弃与少计的计数）；只读已落盘的。远程合同 `nbook.stats/read`（provider server、callers browser）给视图用；业务码 `metric_unknown`、`stats_unavailable`。
- 清除：`clear()` 在写者队列上丢掉内存里的批，先把 `stats.meta` 写成 `{earliest: null, plugins: [], clearedAt: <此刻毫秒>}`（中途失败可以重跑），再从原来的 `earliest` 到今天逐日删各声明者的记录。清除屏障：送数端的每一批带它开始攒的时刻 `startedAt`，服务端拒收 `startedAt` 早于 `clearedAt` 的整批（计入丢弃），服务端自己内存里的批同样处理；所以清除后不会冒出清除前的数（omp 审查第 7 条）。远程合同 `nbook.stats/admin`（callers browser）。

**送数端**（项目与窗口的入口，`client/`）：
- 每个调用方一个门面，本地攒批；5 秒或 200 条由计时器送出（不在记数调用的栈里同步发起远程请求）。送经 `context.remote.on(consumer).use(recordContract)`，入口声明 `remoteDelegates: [recordContract]`；服务端从 `consumer.plugin` 得到插件 id 并核对 `via` 是 `nbook.stats`，请求体里不带插件 id。
- 门面的释放函数里送出这个调用方的最后一批并等它结算。送数失败（含 `unknown-outcome`、`unavailable`、`not-provided`）丢掉这一批，计入本地少计，不重试。
- 服务端整体退出时，项目子实例是否先于服务端撤回提供项收口：S3 先用真实进程探针确认；先撤回时最后一批计入少计，Spec 的“正常退出前写入”对项目子进程改成尽力。
- 客户端的门面没有 `status`；可用状态只在服务端的只读服务上查（Spec 输出 11 写明）。

**依赖方向**：内置插件对 `statsKey` 用可选依赖（`required: false`）；统计插件不在或受阻时拿不到服务就不记，业务照常。

### 3.3 错误码计数（统计插件三个入口）

每个入口激活时 `diagnostics.observe(…, {replay: true})`，按 `sequence` 去重；级别为 `error` 或 `fatal`、带 `code` 的，`countLabeled("nbook.stats.error-codes", "<拥有者>:<code>")`，拥有者是 `origin.plugin`，没有就是 `runtime`。指标由统计插件自己声明（开放标签）。撤销在入口收口时。

### 3.4 字数（`packages/neuro-book/src/plugins/projects/project/`）

- `stats-tracker.ts` 加回调 `onDayClosed({date, added, total})`：
  - `rollover()` 换日时交刚结束那一天，值用 rollover 里的 `current`（首扫完成前是 `initial.words`），不用 `total`；跨过不止一个午夜（休眠）时，中间各天交 `added: 0` 与当时的总数（项目那几天开着）。
  - 项目入口激活读到 `initial` 时，若 `initial.today.date` 不是今天，先交那一天 `initial.words - initial.today.baseline` 与 `initial.words`：兜住前一次关闭时最后一批没送出、崩溃与跨日重开（留最后一次，重复交无害）。
  - 项目入口停止时（`plugin.ts` 的 release，`stop()` 拿到最终快照之后）交当天到此刻为止的值；扫描没完成（`final` 为 null）不交。
- 项目入口可选依赖 `statsKey`，指标 `nbook.projects.words-added`、`nbook.projects.words-total`（`daily`，开放标签，`local: true`），标签是项目的内部 id（`randomUUID()`，不由项目名派生，审查核过）。
- 视图：每天的净增是当天交过数的各项目相加；总字数同样只按当天交过数的项目相加，不往后带；没有项目交数的日子是缺测。

### 3.5 模型用量（`packages/neuro-book/src/plugins/models/`）

- 计数放在模型服务的唯一出口：`nbook.models` 的 `port()` 给出的端口，在 `resolve` 的结果上包 `call`（端口上只有这一个调用方法，`complete` 也经它）。Agent 与 plot 都经这里，以后的消费者自动算到。指标由 models 插件声明（开放标签、`local: true`，取值是 `response.model`，即“提供方/模型”）。
- 口径：每次 `call` 记一次请求（内核的重试各算一次，与服务商的账单一致）；`call` 抛错或 `stopReason` 为 `error`、`aborted` 记一次失败；token 与费用照 `response.usage` 加；`usage.complete` 为假的另记 `incomplete-usage-requests`；`cost` 为 null 的另记 `unpriced-requests`，费用乘一百万取整记 `cost-micro-usd`。
- 指标：`model-requests`、`model-failures`、`input-tokens`、`output-tokens`、`cache-read-tokens`、`cache-write-tokens`、`cost-micro-usd`、`unpriced-requests`、`incomplete-usage-requests`。
- 不依赖请求记录的开关（记录包在更外层的 Agent 里）；分叉不重新调用模型，所以不重复。Spec 输出 9 的主语从“Agent 插件”改成“模型服务”；“提供方类别”标签第一阶段不单列。

### 3.6 不联网（`packages/neuro-book/src/architecture.test.ts`）

`plugins/stats/` 下的源码（不含测试）只许导入 `@notnotype/nb-runtime/*`、`typebox`、`vue`、`@notnotype/nb-ui*`、`nbook/shared/*`、别的插件的 `shared/contracts.ts` 与本插件的相对路径；不许出现 `fetch`、`WebSocket`、`XMLHttpRequest`、`EventSource`、`sendBeacon`、`Bun.connect`、`Bun.listen` 与动态 `import(`。每条规则配一个能被拦下的反例（照该文件现有写法）。另一条：`nbook.stats.metrics` 只许出现在插件描述的顶层 `contributions`。

### 3.7 统计视图（`plugins/stats/web/`，S8）

字数（每天净增与总字数）、按模型的请求数与 token 与费用、日历热力图（缺测与零用不同样子），时间范围近 30 天、近一年、全部；“清除全部统计数据”的入口。放在哪、样子与清除的确认在设计评审里定：先在 Lab 草稿区出静态稿、上评审板给开发者看，定稿后写进本节。

## 4. Spec 与文档改动（主工作区）

第一稿的改动已在 `c8ebde9d0`。按审查再改（S0b，开工 S1 之前）：

- `docs/specs/stats/local.md`：
  - 输入：声明只写在插件描述的顶层；声明可带 `local`（标签是本机标识，不进上报）；记数的取值范围（见 3.2 校验）。
  - 输出 2：开放标签超出上限记到 `$overflow`，与列表模式的 `other` 分开；取值不合格的记数被丢弃。
  - 输出 8：激活时补交前一次打开那天；跨多日时中间各天净增为零；总字数只按当天交过数的项目相加。
  - 输出 9：主语改为模型服务；请求数按每次调用（重试各算一次）；用量不全、单价未知另计。
  - 输出 11：可用状态在只读接口上查。
  - 状态与转换：“声明者被停用”的意思；清除前在途的一小批可能留下；服务端整体退出时项目子进程的最后一批按 S3 的探针结果写成“写入”或“尽力”。
- `docs/specs/runtime/diagnostics.md` 本机观察：错误码的三个来源、`replay` 与 `sequence`、重入不交付、不交 `instanceId`。
- 插件说明：`plugins/stats/` 下的说明文件，写指标怎样声明与记。

## 5. 切片

| 片 | 内容 | 依赖 | 自跑验证 |
|---|---|---|---|
| S0b | Spec 按审查再改（第 4 节） | 本稿 | `bun run docs:check` |
| S1 | 诊断的本机观察与 `error.code` 的保留（3.1） | S0b | `bun run test:affected --package nb-runtime --with-consumers --typecheck` |
| S2 | 统计插件的服务端：贡献点与声明、校验、攒批、记录、只读服务与远程读、清除、降级（3.2 服务端） | S0b | `bun run test:affected --package neuro-book --typecheck` |
| S3 | 送数端：项目与窗口入口、代理送数、收口时送最后一批；先跑“服务端整体退出”的探针（3.2 送数端） | S2 | 同上，加真实项目子进程的用例 |
| S4 | 错误码计数（3.3） | S1、S3 | 同上 |
| S5 | 字数（3.4） | S3 | 同上，加 projects 的既有测试 |
| S6 | 模型用量（3.5） | S2 | 同上，加 models、agent、plot 的既有测试 |
| S7 | 导入白名单与声明位置的规则（3.6） | S2 | `bun test packages/neuro-book/src/architecture.test.ts` |
| S8 | 设计评审 → 统计视图与清除（3.7） | S2；开发者定稿 | vitest dom、Lab 场景、e2e |

每片一个提交，切片编码派 Opus 子代理，主会话审 diff、跑验证与变异。S1、S3 做完各派一次 Opus 实现审查；S1 到 S6 做完合成一个提交范围交 omp `@review` 后台审；S8 前端审查派 Sonnet。

## 6. 验收映射

| Spec | 覆盖 |
|---|---|
| `stats.local` 输出 1、2、4、7、16，失败码 `metric_unknown` | S2 服务端单测（真实存储插件、临时状态根）；含两种 `other`、开放标签重启后仍封顶 |
| 取值校验（输入） | S2：NaN、Infinity、负数、小数、`2026-13-40`、远未来日期都被丢弃，当天别的数照常落盘 |
| 输出 3、验收 1 | 拆成两条：S3 用进程内真实的远程节点（`nb-runtime` 的 remote 测试底座）与 `ManualClock`，23:59 记、拦到 00:00 之后送达，读到在前一天；真实项目子进程里只测“带来的日期原样落到那一天”（子进程的时钟是系统时钟，不加测试接缝） |
| 输出 8、验收 3 | S5：跨午夜交前一天；激活时补交；跨两个午夜中间那天净增为零；某天不开项目，那天缺测、前后不变 |
| 输出 9、验收 2 | S6：关掉 `requestTrace` 后经 Agent 发请求，用量照常增加；plot 的请求也计入；重试各算一次；用量不全另计；分叉后不重复 |
| 输出 10 | S4：让一个插件激活失败，读到 `runtime:activation-threw` 一类的计数（真实运行时）；带 `data.code`、带 `error.code` 的各一条；不带码与非错误级的不计；没有来源的记作 `runtime`；统计入口激活前的记录经补交计到 |
| 输出 11、验收 4，失败码 `stats_unavailable` | S2：用只拦 `nbook.stats` 的存储包装（替身与真实实现对过契约）让统计写失败，同一运行实例里真实的项目保存与模型请求（测试端口）都成功，统计状态降级，只读报 `stats_unavailable` |
| 输出 12 | S3：送数的回应被拦下（`unknown-outcome`），服务端只收到一次 |
| 输出 13、14 | S8：dom 测试与 e2e |
| 清除屏障（状态与转换） | S2：服务端内存里清除前的批被丢弃；S3：送数端清除前开始攒、清除后才送到的批被拒收 |
| 输出 15、验收 5 | S7：导入白名单与全局名规则（每条带反例）；验收 5 的“禁止出网的环境”由它代替，运行期不另测（已知限制） |
| 时序：登记前的记数丢弃；声明者停用后不收、数据可读 | S2 |
| 时序：正常退出前写入 | S2：服务端停止时写最后一批；S3：项目与窗口的门面释放时送最后一批（真实子进程） |
| 时序：两个窗口与一个项目子进程同时记 | S3：两个送数端加一个项目子进程，和等于三者之和 |
| `runtime.diagnostics` 本机观察 | S1：nb-runtime 单测（登记前不补交、`replay` 补交且 `sequence` 可去重、`attach` 补写不触发、重入不交付、撤销后不收、抛错不影响记录与出口、只交约定的字段、三种错误码来源） |
| Smoke | S2：应用的合同测试里“记数后在只读接口读到” |

## 7. 验证

- 每片：表里的命令；收口：`bun run test:affected --package nb-runtime --package neuro-book --with-consumers --typecheck --since master`、`bun run governance:check`。
- e2e：只在 S8 跑统计视图自己的文件与 Lab 场景；开工前在起点上先跑一遍基线。
- 真实进程：S3、S5 用真实的项目子进程（照 projects 现有的进程测试），不用替身。
- 未验证的边界：浏览器窗口被直接关掉时最后 5 秒的数（Spec 已允许少计）；“禁止出网的环境”只靠导入规则。

## 8. 测试分工

本 Task 的 e2e 只在 S8，量不大，由编码子代理连同视图一起写；S1 到 S7 是后端与纯逻辑，用例随实现写。

## 9. 不做与风险

- 不做：耗时分布、里程碑、提供方类别标签、遥测与上报、第三方插件的自定义卡片。
- 风险：服务端整体退出时项目子进程的最后一批，S3 先跑探针。
- 风险：错误码的覆盖取决于各处记录带不带码；这次只做三个来源，没带码的错误记录不计（不在各处补码，那是各插件自己的事）。拥有者是记录自报的来源，诊断不核实（Spec 输出 10 写明）。
- 风险：一个声明者一天的数超过 256 KiB 时，它那一天写不进去（`too-large`），别的声明者不受影响；第一阶段的指标量远小于这个数，不再细分。

## 10. 设计审查的处理（Opus 第一轮，2026-11-27）

报告：`/tmp/review-w00053-t06-design/report-opus.txt`（存为 `evidences/design-review-opus.txt`）。12 条全部成立，均按“成立，要改”处理：

| 条 | 处理 |
|---|---|
| 1 收口时送最后一批必然 `cancelled` | 核实属实（`host.ts` 入口远程访问绑本作用域停止信号）。改走代理（3.2 送数端）；服务端整体退出的顺序 S3 先探 |
| 2 错误码几乎数不到 | 三个来源、`replay` 与 `sequence`、拥有者回退（3.1、3.3）；S4 用真实的激活失败测 |
| 3 模型用量漏 plot、口径未定 | 核实 plot 直接调端口。计数挪到 models 的端口（3.5），口径写定；Spec 输出 9 主语随之改 |
| 4 子进程里换不了时钟 | 归日拆成进程内真实远程节点的用例加子进程端到端（第 6 节） |
| 5 入口上的声明服务端看不到 | 核实属实（`definitionAt`）。指标一律写顶层，规则拦入口上的（3.2、3.6） |
| 6 字数的缺口 | 激活补交、跨多日补零、用 `current`、总字数不往后带（3.4） |
| 7 两条记录非原子、单日共用上限、上限重启失效 | 去掉日期列表改 `earliest`，先写 meta；按声明者分记录；上限在合并时对照记录（3.2） |
| 8 观察者挂接点、重入、同步送数 | 挂在 `record()`、快照遍历、重入不交、计时器送数、去掉 `instanceId`（3.1、3.2） |
| 9 清除与在途、请求体插件 id、客户端 status | Spec 写明在途一小批会留下；插件 id 取内核身份；客户端门面不给 `status`（3.2） |
| 10 两种 `other`、本机标识标签 | `$overflow` 与 `other` 分开；声明加 `local`（3.2） |
| 11 验收映射的缺口、故障注入、黑名单 | 补映射；只拦统计的存储包装；导入改白名单（第 6 节、3.6） |
| 12 输入不校验 | 门面与合同两处校验、封顶（3.2） |

## 11. omp 设计审查的处理（审的是第一稿，2026-11-27）

报告：`evidences/design-review-omp.txt`。13 条按第二稿核对：

| 条 | 处理 |
|---|---|
| 1 到 6、8、10、11 | 与 Opus 第 1 到 7 条重合，第二稿已处理（日期列表已去掉，第 8 条不再适用） |
| 7 清除后旧批重现 | 成立，改：清除屏障（`clearedAt` 与每批的 `startedAt`），Spec 状态一节改成拒收（3.2） |
| 9 单日记录总量 | 第二稿已按声明者分记录；剩下“一个声明者自己超限”记为风险（第 9 节） |
| 12 来源自报 | 成立，Spec 输出 10 写明是记录声明的来源；S4 补一条缺来源与一条机制事件的用例 |
| 13 声明可见性 | 证实第二稿的做法，不是问题 |

## 12. S1 实现审查的处理（Opus，2026-11-27）

报告：`evidences/impl-s1-review-opus.txt`。7 条（重要 3、建议 4）：

| 条 | 处理 |
|---|---|
| 1 `lifecycle.failure` 取不到码 | 改：`summarizeFailure` 保留合格的 `code` |
| 2 `data.plugin` 回退对真实记录不生效 | 改：`services.diagnostic` 从 `data.key` 的插件前缀取 |
| 3 六个变异存活 | 改：逐个补用例 |
| 4 async 观察者的拒绝逃出 | 改：thenable 的失败也计入 `observerFailures` |
| 5 登记不随调用方收口 | 不改：统计插件收口时自己撤销；按调用方给门面是改上游，收益小 |
| 6 紧急记录不带码 | 有现成的种类就带上，没有记为 Spec 的已知限制 |
| 7 空串插件 | 改：空串当没有 |
