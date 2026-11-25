# w00037 t06 统计模块的写入：实施计划

路径按 worktree `.worktree/w00037-official-site`（分支 `feat/w00037-official-site`）写；Spec、ADR、Task 记录读主工作区的。起草时 worktree 的 HEAD 是 `18fdeb9cf`（t05 修正片），备份命令与测试控制入口正由另一个子代理在写（`module.ts`、`db/open.ts` 有未提交改动、`commands/backup.ts` 未跟踪），合同测试底座（t05 第 5 片）、镜像与 CI（第 7 片）还没有；本计划按 t05 计划的 3.8、“测试控制入口”一节与 3.11 写的接口规划，开工时先核对。文中“探针 N”是规划时在 `/tmp/w00037-t06-plan/lab/` 用 Bun 1.4.4（SQLite 3.53.4）跑的一次性脚本，结论与数字在第 9 节；没探过的标“推断”。

## 1. Context

为什么做：官方站里唯一已有使用方的部分是统计（应用的遥测插件，w00053 t07）。t05 建好了进程入口、迁移运行器、按主机名分派与测试控制入口，统计模块还只是一个空的子应用。本 Task 让它能收三种上报、去重、短期留原始上报、算出长期保留的聚合，做完可以先在遥测的域名上线（t13 的第一步）。

依据：
- 合同：`docs/specs/telemetry/protocol.md`（`telemetry.protocol`）、`docs/specs/site/telemetry-ingest.md`（`site.telemetry-ingest`）；`site.operations` 的输出 6（备份不含原始上报）、输出 7 与验收 2（相邻版本，从 t05 接过来）、输出 11（测试控制入口）、来源地址的取法；`site.telemetry-dashboard` 只作为聚合表要够用的约束（查询接口在 t11）。
- ADR 0059（模块只经自己的连接写自己的库、合同测试只经 HTTP）、ADR 0061（每个模块一个 SQLite 文件、原始上报表不进备份）、ADR 0062（不带持久标识、原始上报留 7 天后按日删除）。
- 提案 `telemetry-stats-feedback.md` 的 4.1、4.3、4.5、4.6。

已定的事（不再讨论）：原始上报留 7 天、聚合长期保留、不入库即聚合（ADR 0062 决策 4、开发者 2026-11-24）；合同测试拨时间、触发任务用测试控制入口；CI 用基准提交的程序当上一个版本（t05 审定第 5 条）；遥测写入口单独一个子域名。

工作方式：主会话或编码子代理在 worktree 里按第 5 节切片，每片一个提交；第 4 节的 Spec 改动由主会话先在 master 上改。本 Task 碰数据格式（第一条真实迁移、公开的收集清单）与安全边界（不留来源地址、限流、不登录的公开写入口），实现审查按高风险后端做：Opus 先审，omp `@review` 在后台审同一份说明。

## 2. 技术选型

| 问题 | 选用 | 理由 | 否决 |
|---|---|---|---|
| 请求体与清单的 schema | `typebox` ^1.3.6 的 `Type` 与 `typebox/compile`（工作区 10 个包在用这个版本） | ADR 0059 定了 TypeBox；编译后的校验 10 万次约 9 毫秒（探针 9）。按字段逐个校验（每个字段一份编译好的 schema），字段名由我们自己的字段表给出，不靠 TypeBox 的错误路径：缺字段时它的 `instancePath` 是空串（探针 9） | 整份一个 schema 加 `Errors()`：缺字段报不出字段名，联合类型一错报三条；手写校验：清单还要生成说明与官网页面，schema 要是数据 |
| 请求体上限 | `hono/body-limit` | 有 `Content-Length` 时只看头，分块传输时边读边数、超了立即停（源码与探针 6：16384 字节过、16385 字节与 20 KB 分块都 413） | `Bun.serve` 的 `maxRequestBodySize`：全进程一个值，站点以后要更大的上传；自己读完再量：分块的请求要先全读进内存 |
| 限流 | 手写，约 40 行：按对齐的 10 分钟窗口计数的 `Map` | 状态只许在内存里（输出 8），时间要经 `ModuleContext.clock`；10 万个来源约 12 MB（探针 8） | `hono-rate-limiter` 一类：不认注入的时钟，键与存储要另写适配，省不下代码 |
| 聚合 | SQL 的 `INSERT … SELECT … GROUP BY … ON CONFLICT DO UPDATE`，错误码用 `json_each` 展开 | 每批一条语句一个维度，2000 行一批 15 到 40 毫秒（探针 2）；`bun:sqlite` 自带 JSON1（探针 0、1） | 在 JS 里逐行累加：多一倍代码，慢 |
| 时间与日期 | 平台的整数运算：服务端日 = `Math.floor(ms / 86400000)`，心跳段 = `Math.floor(ms / 900000)`，对外的日期 `new Date(day * 86400000).toISOString().slice(0, 10)` | 全是 UTC，没有时区与历法问题 | `nb-time`：故事时间，用不上 |

## 3. 关键设计

### 3.1 `packages/nb-site-telemetry-contract/`：收集清单与三种上报的 schema

文件：`src/index.ts`（汇总导出，保留 `TELEMETRY_API_PREFIX`）、`src/ingest.ts`、`src/manifest/types.ts`、`src/manifest/anonymous.ts`、`src/manifest/usage.ts`、`src/manifest/index.ts`、`src/manifest.test.ts`；`package.json` 加 `"typebox": "^1.3.6"`；`AGENTS.md` 去掉“第一个 schema 进来时再加”。

`src/ingest.ts`：

```ts
export const INGEST_PATHS = {daily: "/v1/daily", heartbeat: "/v1/heartbeat", event: "/v1/event"} as const;
export const INGEST_MAX_BODY_BYTES = 16384;
export const INGEST_ERROR_CODES = ["invalid_report", "payload_too_large", "rate_limited", "unavailable"] as const;
export const DailyResponse = Type.Object({serverDay: Type.String({pattern: "^\\d{4}-\\d{2}-\\d{2}$"}), duplicate: Type.Boolean(), dropped: Type.Array(Type.String())});
export const EventResponse = DailyResponse;               // 取决于“要定的事”第 5 条
export const IngestError = Type.Object({code: Type.Union(INGEST_ERROR_CODES.map((c) => Type.Literal(c))), field: Type.Optional(Type.Union([Type.String(), Type.Null()]))});
```

清单按档、按版本组织，每个版本是一份不可变的数据：

```ts
/** 一个字段：属于哪一档、取值的 schema、中英文说明；枚举字段另带每个取值的说明。 */
export interface ManifestField { readonly tier: "anonymous" | "usage"; readonly schema: TSchema; readonly description: Bilingual; readonly values?: Readonly<Record<string, Bilingual>> }
export interface AnonymousManifest { readonly version: number; readonly daily: Readonly<Record<string, ManifestField>>; readonly heartbeat: Readonly<Record<string, ManifestField>> }
export interface UsageManifest { readonly version: number; readonly usage: Readonly<Record<string, ManifestField>>; readonly errorItem: Readonly<Record<string, ManifestField>>; readonly event: Readonly<Record<string, ManifestField>> }
export const ANONYMOUS_MANIFESTS: ReadonlyMap<number, AnonymousManifest>;   // 第一版只有 1
export const USAGE_MANIFESTS: ReadonlyMap<number, UsageManifest>;
export const COUNT_BUCKETS_V1 = ["0", "1", "2-4", "5-9", "10-49", "50+"] as const;
```

- `manifest`、`reportId` 不属于哪一档，单独写成 `ReportEnvelope` 的两个 schema（`reportId` 的字符集见第 4 节第 2 条）。
- 每个版本的字段表写成字面量，旧版本发布后不改（Spec 边界一节）：新加版本就加一个文件里的新常量，不改旧常量。`manifest.test.ts` 核对：每个字段与每个枚举取值都有中英文说明；版本号从 1 起连续；枚举取值不重复；`COUNT_BUCKETS_V1` 与使用档 1 的分档字段一致。
- 立即事件的 `kind`、`code` 放在使用档的清单里（“要定的事”第 5 条）。
- 本包不放校验的算法（丢弃、版本回退）：那是服务端的实现，放在 3.3。应用的遥测插件只读字段表与 schema 来组装上报。

### 3.2 `packages/nb-site-telemetry/migrations/0001_init.sql`：表与迁移

草稿全文在探针目录的 `sql/0001_init.sql`，已经过真实的迁移运行器（探针 1：只读导入 worktree 的 `runMigrations`，结果 `{"ok":true}`、一行 `migration.applied`）。它没有 `PRAGMA`、`ATTACH`、`DETACH`、`VACUUM`，没有外键，也没有事务语句，`db/migrate.ts` 的规则都满足；连接上要设的 `PRAGMA` 在模块的 `create()` 里设（3.4），不进迁移。

日期全用整数：`server_day` 是 UTC 1970-01-01 起的天数，`segment` 是 UTC 15 分钟段的序号。所有表 `STRICT`（类型不对报 `SQLITE_CONSTRAINT_DATATYPE`，探针 1）。

| 表 | 主键与索引 | 列 | 作用 |
|---|---|---|---|
| `telemetry_daily_raw` | `id INTEGER PRIMARY KEY AUTOINCREMENT`；`report_id` 唯一；`server_day` 索引 | `report_id`、`server_day`、`manifest_anonymous`、`manifest_usage`（可空）、`app_version`、`channel`、`form`、`os`、`os_major`、`arch`、`locale`、`region`、`days_since_last`（`first`=0、1 到 28、`more`=29）、`install_week`、`usage_enabled`（0/1）、`notice_seen`、`usage_errors`（JSON `[[owner, code, 分档], …]`，可空）、`usage_crashes`、`usage_upgrade` | 原始的每日上报；`report_id` 的唯一约束同时是重发去重 |
| `telemetry_event_raw` | 同上 | `report_id`、`server_day`、`manifest_anonymous`、`manifest_usage`、`app_version`、`form`、`kind`、`code`（省略时空串） | 原始的立即事件 |
| `telemetry_aggregate_cursor` | `source` | `source`（`daily`、`event`）、`last_id` | 聚合处理到哪一行；迁移里插入两行初值 0 |
| `telemetry_daily_count` | `(server_day, manifest, dimension, value)`，`WITHOUT ROWID` | `reports` | 每日上报按一个维度的份数：`total`（值为空串）、`app_version`、`channel`、`form`、`os`、`os_major`（值 `linux/6`）、`arch`、`locale`、`region`、`usage_enabled`、`notice_seen` |
| `telemetry_daily_cohort` | `(server_day, manifest, install_week, days_since_last)` | `reports` | 安装周与 `daysSinceLast` 的交叉；活跃、新增、留存都从它算 |
| `telemetry_usage_count` | `(server_day, manifest, app_version, dimension, value)` | `reports` | 带使用档的每日上报：`reports`（份数）、`crashes`、`upgrade` 的分布；`manifest` 是使用档版本 |
| `telemetry_usage_error` | `(server_day, manifest, app_version, owner, code, count_bucket)` | `reports` | 按错误码的份数与分档分布 |
| `telemetry_event_count` | `(server_day, manifest, app_version, form, kind, code)` | `events` | 立即事件的条数 |
| `telemetry_heartbeat` | `(segment, manifest, app_version, form)` | `beats` | 心跳段的计数，只累加，不留单条（输出 4） |

主键把日期放第一列：看板的查询都是日期范围，清单版本只有几个，按 `manifest` 分组即可。

为什么去重就用原始表的唯一约束、不另建一张表：上报编号与原始上报同进同出（都不进备份、都按日删除），同一张表少一次写入；去重窗口因此等于“直到这一天被删除”，至少保留天数整天。保留天数的下限定为 2（第 4 节第 13 条），所以窗口总不短于协议要求的 48 小时：第 D 天最后一刻记入的上报在第 D+3 天 0 点被删，活了 48 小时多一点。

为什么 `AUTOINCREMENT`：备份的副本清空原始表之后，`sqlite_sequence` 留在副本里，用副本恢复后新行的编号接着往上（探针 1：副本里新行的 id 是 4，序列是 3），聚合游标不会落在新行之后。不用它时空表的下一个 id 回到 1，游标比它大，新行永远不进聚合。`ON CONFLICT DO NOTHING` 也会消耗编号（探针 1），只是留空号，不影响。

看板的每个查询读什么（t11 写查询，这里只保证列够用）：

| 查询 | 读的表与列 |
|---|---|
| `overview` 活跃数与新增 | `telemetry_daily_cohort` 的 `server_day`、`manifest`、`days_since_last`、`reports`（对安装周求和）；新增是 `days_since_last = 0` |
| `overview` 开启比例 | `telemetry_daily_count` 的 `usage_enabled` 与 `total` 两个维度 |
| `series/active` | 同 `overview` 的活跃数，逐日；第 k 天的条件“`first`、`more` 或数值不小于 k”在编码下是 `days_since_last = 0 OR days_since_last >= k`（`more` 记 29，k 至多 28） |
| `series/retention` | `telemetry_daily_cohort` 按 `install_week` 筛（`older` 不进）：当周新增是 `days_since_last = 0`，之后第 1、2、4、8 周的 7 日活跃在那一周的最后一天按上一行的算法算 |
| `series/online` | `telemetry_heartbeat` 的 `segment`、`beats`，另按 `form` 分 |
| `breakdown` | `telemetry_daily_count` 的一个维度；“系统”可以只看 `os`，或看 `os_major`（看板 Spec 没说，交 t11） |
| `errors` | `telemetry_usage_error`（按 `code` 的份数与分档）、`telemetry_usage_count` 的 `crashes`、`upgrade`；按应用版本筛用 `app_version` |
| 版本分段、没有数据与零 | 每张表都带 `manifest`；某天没有行就是没有上报，有 `total` 而某个取值没有行时是 0 |

立即事件聚合进 `telemetry_event_count`，但看板 Spec 里没有读它的查询（第 4 节第 17 条）。

存储量：Spec 与提案里没搜到安装数或上报量的假设（搜过 `规模`、`安装数`、`日活`、`同时访问` 等，只有“2 核 2 GB、100 同时访问”），下面按三档假设算，数字来自探针 2、4：

| 每天的每日上报 | 原始表常驻（8 天） | 聚合与心跳一年 |
|---|---|---|
| 1 千 | 约 8 千行，约 1.6 MB（按探针 2 的每行约 205 字节推算） | 与上报量无关，看取值个数：活跃版本 5 个时约 17 MB；20 个时约 55 MB（心跳 140 万行 38 MB、错误码 22 万行 13 MB、交叉表 14 万行 3.4 MB、维度表 4.4 万行 1.2 MB） |
| 1 万 | 8 万行，16.4 MB（实测） | 同上 |
| 10 万 | 80 万行，163 MB（实测） | 同上 |

心跳行数 = 每年 35040 个段 × 同时在线的版本数 × 运行形态数，是聚合里最大的一块。伪造的上报可以造出任意多个 `appVersion`，让聚合表变大（第 8 节风险）。

### 3.3 `packages/nb-site-telemetry/src/validate.ts`：按清单校验与归一

```ts
export type Normalized<R> = {readonly ok: true; readonly report: R; readonly dropped: readonly string[]} | {readonly ok: false; readonly field: string | null};
export function normalizeDaily(body: unknown): Normalized<DailyRecord>;
export function normalizeEvent(body: unknown): Normalized<EventRecord>;
export function normalizeHeartbeat(body: unknown): Normalized<HeartbeatRecord>;
```

每个字段用 3.1 字段表里那一份编译好的 schema 单独校验（模块加载时编译一次）。顺序固定，先到先判（写进 Spec，第 4 节第 7 条）：

1. 不是 JSON 对象：`field: null`。
2. `manifest`：对象，`anonymous` 是不小于 1 的整数；有 `usage` 时同样。不认识的更旧版本（例如 0，或中间缺的号）拒收，`field: "manifest.anonymous"`。
3. 定生效版本：匿名档取 `min(声明的, 服务端认识的最新)`（输出 5）；使用档声明的比最新的新时记下“整段丢弃”。
4. 带了 `usage` 而 `usageEnabled` 不是 `true`：拒收，`field: "usage"`（输出 6；先于第 5 步，所以使用档版本更新时同样拒收）。带了 `usage` 而 `manifest.usage` 没给：拒收，`field: "manifest.usage"`。
5. 使用档整段丢弃时 `dropped` 里加 `usage`，不再看它的内容。
6. 生效版本的字段表里每个字段：缺了或取值不合格就拒收，`field` 是字段名（嵌套的写点分路径，例如 `usage.errors.3.code`）。`usage.errors` 里同一个 `(owner, code)` 出现两次拒收（第 4 节第 8 条）。
7. 字段表里没有的键进 `dropped`：顶层的写名字，嵌套的写点分路径（`manifest.x`、`usage.x`、`usage.errors.x`，数组里的不带下标、去重）。`dropped` 照收到的键原样列出：它们来自请求方，只进响应，不进日志与库。
8. 归一：`daysSinceLast` 编成整数，`usage.errors` 编成 `[[owner, code, 分档], …]`，记录里只留字段表里的字段。

同一个 `reportId` 再到达时，内容与第一次不同也按重发处理，记入的仍是第一次（第 4 节第 7 条）。

### 3.4 `packages/nb-site-telemetry/src/`：模块的装配、写入口与连接上的时序

文件：`index.ts`（公开入口）、`config.ts`、`days.ts`、`store.ts`、`ingest.ts`、`rate-limit.ts`、`aggregate.ts`、`purge.ts`、`backup.ts`，各带同名测试；`scripts/measure-ingest.ts`（测量脚本，不是测试）。

`index.ts` 的选项由本包自己声明，`nb-site-server/src/modules.ts` 的适配器从 `ModuleContext` 取来传入：

```ts
export interface TelemetryModuleOptions {
    readonly db: Database; readonly config: TelemetryConfig; readonly log: TelemetryLog;
    readonly clock: {now(): number};
    readonly jobs: {register(job: {name: string; intervalMs: number; initialDelayMs?: number; run(): void | Promise<void>}): void};
    /** 入口按 `site.operations` 的取法给的来源地址；只在 `ingest.ts` 里交给限流器，不写日志、不进库。 */
    readonly clientAddress: (c: Context) => string | null;
}
export interface TelemetryModule { readonly site: Hono; readonly ingest: Hono }
export function createTelemetryModule(options: TelemetryModuleOptions): TelemetryModule;
export function prepareTelemetryBackupCopy(copy: Database): void;   // 3.6
export {parseTelemetryConfig, telemetryMigrations};
```

`create` 时在业务连接上设两条连接参数（连接归模块所有，`module.ts` 的 `ModuleContext.db` 注释）：
- `PRAGMA busy_timeout = 0`。入口给所有模块设的 250 毫秒，对统计是错的：库被进程外占着写时（验收 4 正是这样），每个写入请求让整个进程停 251 毫秒（探针 7 实测 251.4），被刷的时候登录也跟着停，违反输出 10“账号模块的接口不受影响”。设成 0 后同样情况 0.1 毫秒就得到 `SQLITE_BUSY` 回 503。进程内不会有别的写者与它争锁：就绪检查的探测连接与它都在同一个线程上同步执行，不会交错；另一个进程反复做只读 `VACUUM INTO`（备份）期间写了 52886 次，没有一次 `SQLITE_BUSY`（探针 7）。
- `PRAGMA secure_delete = ON`。原始上报删除之后，内容不再留在库文件的空闲空间里（探针 3：关着时删掉的上报编号在截断检查点之后仍在库文件里；开着时被抹掉）。ADR 0062 的“短期保留”靠它才在文件层面成立，合同测试也靠它从外面验证删除（3.8）。代价：删 1 万行 25.7 毫秒，关着时 17.5（探针 2）。

写入口（`ingest.ts`）是一个 Hono 子应用，适配器把它挂在 `ingest` 入口的前缀 `/v1` 下，路由 `POST /daily`、`POST /heartbeat`、`POST /event`；别的方法、别的路径与 `OPTIONS` 照入口的缺省回 404，不回跨域头（提案 4.6“写入口不开跨域”）。三个路由共用一串中间件，顺序与每步的回应：

1. 取来源地址；取不到回 503 `unavailable`（第 4 节第 11 条），记一行 `telemetry.client_address_missing`（warn，不带任何地址与转发头）。
2. 限流（3.5）；超额回 429 `rate_limited`，带 `Retry-After`。
3. `Content-Encoding` 有值且不是 `identity`：400 `invalid_report`（Bun 不替请求体解压，压缩的请求体会被当成坏的 JSON，探针 6）；`Content-Type` 不是 `application/json`（可带参数，不分大小写）：400 `invalid_report`（第 4 节第 5 条）。
4. `bodyLimit({maxSize: INGEST_MAX_BODY_BYTES})`：超过回 413 `payload_too_large`。
5. `await c.req.text()` 再 `JSON.parse`，失败 400 `invalid_report`，`field: null`。**这是整条处理里唯一的 `await`。**
6. 3.3 的归一；不合格 400 `invalid_report` 与 `field`。
7. 写库，一个同步事务（`store.ts`，`db.transaction(fn).immediate()`）：每日上报与立即事件是 `INSERT … ON CONFLICT (report_id) DO NOTHING RETURNING id`，没返回行就在同一个事务里 `SELECT server_day … WHERE report_id = ?` 当作重发（探针 1）；心跳是一条 `INSERT … ON CONFLICT DO UPDATE SET beats = beats + 1`（探针 1：三次之后是 3、一行）。`SQLiteError` 一律回 503 `unavailable`，记一行 `telemetry.db_unavailable`（带 `dbCode`，同一种码每分钟至多一行，免得被刷屏）；别的异常照常抛给入口的 `onError`（500 `internal`）。
8. 回应：每日上报 200 `{serverDay, duplicate, dropped}`；心跳 204 没有响应体；立即事件 202（响应体按“要定的事”第 5 条）。

`serverDay` 与心跳段都由第 7 步开始时的 `clock.now()` 算出，不用请求里的任何日期（输出 2）。

连接上的时序（模块只有一条业务连接，`bun:sqlite` 同步）：
- 会用到这条连接的只有三处：写入口的第 7 步、聚合任务、删除任务。以后 t11 的看板查询是第四处，只读。
- 写入口的事务里没有 `await`，前面唯一的 `await` 在读请求体；同步代码执行期间别的回调不会插进来，所以任何事务都不跨 `await`，也不会有两方的语句落进同一个事务。
- 两个任务每批是一个同步事务，批与批之间 `await new Promise((r) => setImmediate(r))` 让出一次，请求在批之间处理。任务之间由调度器保证不叠着跑（`jobs.ts`：一个任务跑完才排下一次）；聚合与删除两个任务之间可能交错，但每批都是独立的同步事务，删除只删整天（3.6），互不影响结果。
- 事件循环最长停多久（探针 2，8 核机器）：聚合一批 2000 行 15 到 40 毫秒；删除一批 2000 行 5 到 49 毫秒；截断检查点 1 到 3 毫秒。都远在 Spec 的“写入不被阻塞超过 1 秒”之内。一批定为 2000 行。
- 看板读到的永远是批与批之间的状态：一批里所有维度一起更新，同一天的各维度互相对得上（看板 Spec 的“不读到算了一半的一天”）。

不留来源地址怎样守住：来源地址只在 `ingest.ts` 第 1 步取，交给限流器后不再出现；模块的日志字段里只放事件名、码、计数。包内的源码守卫（`architecture.test.ts`，读 `src/**/*.ts`）核对 `clientAddress` 只在 `ingest.ts` 里被调用。行为上由合同测试从外面验：带一个特征明显的转发地址触发各种拒绝之后，进程的输出与数据目录里每个文件都找不到它（3.8 的 C13）。

### 3.5 `rate-limit.ts`：限流

```ts
export function createRateLimiter(options: {limit: number; windowMs: 600000; maxSources: number; now: () => number}): {take(source: string): {ok: true} | {ok: false; retryAfterSeconds: number}};
```

- 键：IPv4 是地址本身；IPv6 取前 64 位（`2001:db8:1:2::/64` 的写法）。理由：一个家庭或一台 VPS 通常分到整个 /64，按单个地址计时，攻击者换地址就换额度（第 4 节第 11 条，“要定的事”第 3 条）。
- 窗口：按 `now()` 对齐的 10 分钟窗口，`Math.floor(now / 600000)`；窗口一变整张表清空，状态随时间窗过期（输出 8）。“每 10 分钟至多 600 个”读作“每个对齐的 10 分钟窗口”：跨窗口边界的 10 分钟里最多可以到 1200 个（第 4 节第 11 条写明）。`Retry-After` 是到窗口结束的秒数向上取整，至少 1。
- 三个写入口合计；第 2 步之后的每个请求都计入，包括后来被判 400、413 的（不让坏请求白刷）。被限流的请求不记入（第 3 步之前就回了）。
- 来源数上限 `maxSources` 定为 10 万（约 12 MB，探针 8）：满了之后窗口内新出现的来源一律 429，已有的不受影响。只在被大量地址刷的时候发生，宁可错拒，不让内存无限长。
- 时间取自 `clock.now()`，合同测试拨时间就能跨窗口。进程重启后计数清零，这是“只在内存里”的直接后果，写进模块注释。

### 3.6 `aggregate.ts`、`purge.ts`、`backup.ts`：两个定时任务与备份

两个任务经 `jobs.register` 登记，名字写进 Spec 给测试控制入口用（第 4 节第 14 条）：

- **`aggregate`**，间隔取配置（缺省 10 分钟），`initialDelayMs: 0`（启动后立即跑一次）。每次：从游标往后取至多 2000 行，在一个同步事务里对每个维度跑一条 `INSERT … SELECT … WHERE id > $from AND id <= $to GROUP BY … ON CONFLICT DO UPDATE SET reports = reports + excluded.reports`（`json_each` 展开错误码），再把游标推到 `$to`；让出一次；直到追平或这一次已处理 25 批（5 万行，约 0.5 到 1 秒，留在停止时“任务至多 2 秒”之内）。草稿实现在探针目录的 `aggregate.ts`。再跑一次没有新行时什么都不变（探针 2 的“rerun processes: 0”），满足输出 5 的“重复计算，结果相同”。
- **`purge`**，间隔固定 10 分钟、`initialDelayMs: 0`，不做成配置（Spec 只要求“每天至少一次”；查一次“有没有要删的”是一条走索引的查询）。每次：今天 = `serverDay(clock.now())`，截止 = 今天 − 保留天数；先把截止之前的行都聚合完（循环 `aggregate` 的一批，直到游标不小于这些行里最大的 id）；再按 2000 行一批删 `server_day < 截止` 的原始上报（两张原始表），每批一个事务、批间让出；最后 `PRAGMA wal_checkpoint(TRUNCATE)`，把带着旧内容的 WAL 帧截掉（探针 3：不截断时 WAL 里还有）。聚合在这一步出错时照样删除，记一行 `telemetry.purge_unaggregated`（error，带行数）：保留期是隐私承诺，先于聚合的完整。
- **为什么要 `initialDelayMs`**：`jobs.ts` 现在第一次也等一个间隔。服务每次重启都把计时清零，重启比间隔频繁时任务永远不跑，“记入后至多一个聚合间隔出现在聚合里”“删除每天至少一次”都会失守。给 `JobDefinition` 加可选的 `initialDelayMs`（缺省等于 `intervalMs`，已有的行为不变），是本 Task 对入口的唯一一处行为改动（3.7）。

按哪个时间算“满 7 天”：按记入时的服务端日，不按到达时刻。第 D 天记入的上报在服务端日到 D+8 的那天被删（D < D+8−7），所以留 7 到 8 天加至多一个删除间隔；把时钟拨 7 天时还在，拨 8 天时没了（验收 1 的“8 天后”，也是 3.8 C15 的边界）。

备份（`prepareTelemetryBackupCopy(copy)`，适配器挂到 `SiteModule.prepareBackupCopy`）：在副本上先把还没聚合的行聚合完（同一套 SQL，同步），再删两张原始表的全部行。入口随后对副本 `VACUUM`、`quick_check`（`module.ts` 的注释）。副本因此带着截至备份那一刻的完整聚合，没有上报编号与原始字段（输出 6、`site.telemetry-ingest` 的副作用一节）。它不读配置、不依赖 `create()`。游标与 `sqlite_sequence` 留在副本里，用副本恢复后新行接着进聚合（探针 1）。

用副本恢复的已知后果：备份那一刻之后的上报丢失（主机层面的事，与本 Task 无关）；恢复后新到的、与副本里重复的上报编号不再被认成重发（编号没进副本），最多多算几份。写进模块注释。

### 3.7 `packages/nb-site-server/`：适配器与入口的小改动

- `src/modules.ts`：去掉第 24 行的“写入口上的 mount 由 t06 加”，改成说明统计模块在两个入口上各有一个 mount；适配器把 `clock`、`jobs`、`clientAddress` 传进 `createTelemetryModule`，`mounts` 加 `{surface: "ingest", prefix: "/v1", app: module.ingest}`，`prepareBackupCopy: prepareTelemetryBackupCopy`。同时更新 `nb-site-telemetry/src/index.ts` 第 39 行与 `nb-site-telemetry/AGENTS.md` 里“以后另有写入口”的说法。
- `src/module.ts` 与 `src/jobs.ts`：`JobDefinition` 加 `initialDelayMs?: number`（非负整数，缺省 `intervalMs`）；`#schedule` 第一次用它。补 `jobs` 的用例：`initialDelayMs: 0` 时开始调度后立即跑一次；缺省时照旧。测试控制入口的“立即跑一次”（另一个子代理正在写）与它共用“不叠着跑”，开工时先读那一版再改。
- 依赖白名单（`architecture.test.ts`）不用改：合同包新加的是第三方的 `typebox`。

### 3.8 合同测试：`packages/nb-site-contract-tests/`

新文件 `src/telemetry-ingest.test.ts`；辅助 `src/testing/telemetry.ts`（按合同包的清单造合格的上报，不含断言）与 `src/testing/files.ts`（`dataFilesContaining(dataDir, needle): string[]`，用 `node:fs` 读数据目录里每个文件的字节，Spec 写明了布局，导入守卫放行 `node:`）。只 import 两个合同包与允许清单里的东西。

每个用例在本文件的沙箱里起进程；所有请求都来自 127.0.0.1，同一个进程上的用例共用一份限流额度，所以除限流用例外都给 `NB_SITE_TELEMETRY_RATE_LIMIT=100000`，限流用例单独起一个进程给 5。写入口的请求带 `Host: telemetry.test`（沙箱的 `NB_SITE_TELEMETRY_URL`）。

| 编号 | 用例 | 用到 |
|---|---|---|
| C1 | 合格的每日上报：200，`serverDay` 是当前 UTC 日期，`duplicate` 假，`dropped` 空；拨 1 天后另一份的 `serverDay` 跟着走 | `advanceClock` |
| C2 | 同一份发两次：都是 200，第二次 `duplicate` 真；拨 1 天后再发，`serverDay` 仍是第一次的 | `advanceClock` |
| C3 | 顶层与嵌套的不认识字段：200，`dropped` 照第 4 节第 6 条列出 | |
| C4 | 按清单逐个字段造不合格的值（枚举外、整数越界、缺字段、格式不对）：400 `invalid_report` 与对应的 `field` | 合同包的字段表 |
| C5 | 匿名档版本比服务端新：200；使用档版本比服务端新：200、`dropped` 有 `usage` | |
| C6 | `usageEnabled` 为假却带 `usage`：400 | |
| C7 | 心跳：204，响应体为空 | |
| C8 | 立即事件：202；重发 `duplicate` 真 | |
| C9 | 带特征明显的 Cookie 与 `Authorization`：照常 200；标准输出、标准错误与数据目录的文件里都没有它 | `files.ts` |
| C10 | 限流 5：第 6 个回 429 与 `Retry-After`（三个写入口合计）；被限流的那份在窗口过后重发得到 `duplicate` 假（说明当时没记入）；拨到窗口结束后恢复 | `advanceClock` |
| C11 | 恰好 16384 字节不是 413；16385 字节与分块传输的大请求 413 | |
| C12 | `Content-Type: text/plain`、`Content-Encoding: gzip`：400 | |
| C13 | 可信代理设 127.0.0.1/32，带 `X-Forwarded-For: 203.0.113.77`：触发限流、413、400 之后，输出与数据目录里找不到这个地址；可信代理不给转发头时 503 `unavailable` | `files.ts` |
| C14 | `holdWriteLock(telemetry)`：写入口 503 `unavailable` 且在 200 毫秒内回应；同时 `/health/live` 200、站点入口的请求照常回应；放锁后写入口 200，进程没重启 | `holdWriteLock` |
| C15 | 记入一份（上报编号 R）；拨 7 天、跑 `purge`：数据目录里还找得到 R，重发 `duplicate` 真；再拨 1 天、跑 `purge`：找不到 R，重发 `duplicate` 假 | `advanceClock`、`runJob`、`files.ts` |
| C16 | 记入一份（上报编号 R、应用版本 V，两个都特征明显）后跑 `backup`：副本里没有 R、有 V（聚合进了副本，原始上报没有）；用副本起服务、就绪 200 | t05 的备份辅助 |
| C17 | 记入一份，停进程、再起：重发 `duplicate` 真 | |
| C18 | 写入口路径的 `GET`、`OPTIONS` 404；写入口路径发到站点主机 404；站点路径发到写入口主机 404 | |
| C19 | 相邻版本（3.9） | `NB_SITE_PREVIOUS_SERVER_COMMAND` |

只能在包内测的（`nb-site-telemetry` 的 `*.test.ts`，真 SQLite 文件、注入的时钟），以及理由：
- 聚合的数对不对、去重“只算一份”、重跑结果相同、同一天各维度一致、版本分开存、删除之后那一天的聚合不变：聚合的存放形状不是公开合同，第一版也没有读聚合的接口（t11 才有）。t11 的合同测试再从看板接口把这几条补成黑盒（第 4 节第 16 条）。
- 心跳“库里没有 3 条可分辨的记录”：同上，只能看库。
- 限流的 IPv6 /64、来源数上限：合同测试只能从 127.0.0.1 发请求。
- 校验规则的全表（每个字段、每种失败）：合同测试 C4 按字段表各取一种，全表在 `validate.test.ts`。
- 恢复副本后新行进聚合（`AUTOINCREMENT`）、删除前先聚合、`secure_delete` 之后文件里没有残留的全量造数：要直接造库的状态。
- 连接上的时序（事务不跨 `await`、批间让出）：用测量脚本给数字，不写成计时断言。

### 3.9 相邻版本：CI 与本机

新脚本 `packages/nb-site-server/image/build-previous.ts`（包脚本 `build:previous`）：

1. 参数 `--base <提交> --out <目录>`；`--base` 为空、全是 0、或不是祖先提交时只在标准错误写一行“没有上一个版本”、以 0 退出、标准输出不写命令。
2. `git clone --shared --no-checkout <本仓库> <out>/tree`，`git -C <out>/tree checkout --detach <base>`：共用对象、不在主仓库登记 worktree，删目录即清理。
3. 那棵树里没有 `packages/nb-site-server/image/build.ts` 时同第 1 步（基准提交早于镜像构建）。
4. 在那棵树里 `bun install --frozen-lockfile`，`bun run --cwd packages/nb-site-server build:image --no-docker`。不能复用当前的 `node_modules`：工作区包的链接指回当前树，打出来的会是当前的代码。
5. 标准输出一行 `command=["bun","--no-env-file","<out>/tree/packages/nb-site-server/dist/image/server.js"]`，直接追加进 `$GITHUB_OUTPUT`。

CI 的 `site-image` 作业（t05 第 7 片建）在“对着产物跑合同测试”之后加两步：

```yaml
      - name: 上一个版本的程序（基准提交）
        id: previous
        env: {EVENT: "${{ github.event_name }}", PR_BASE: "${{ github.event.pull_request.base.sha }}", BEFORE: "${{ github.event.before }}"}
        run: |
          case "$EVENT" in pull_request) base="$PR_BASE" ;; push) base="$BEFORE" ;; *) base="" ;; esac
          bun run --cwd packages/nb-site-server build:previous --base "$base" --out "$RUNNER_TEMP/previous" >> "$GITHUB_OUTPUT"
      - name: 上一个版本接管本版本迁移过的数据目录
        if: steps.previous.outputs.command != ''
        run: bun test src/adjacent-version.test.ts
        working-directory: packages/nb-site-contract-tests
        env:
          NB_SITE_SERVER_COMMAND: '["bun","--no-env-file","${{ github.workspace }}/packages/nb-site-server/dist/image/server.js"]'
          NB_SITE_PREVIOUS_SERVER_COMMAND: ${{ steps.previous.outputs.command }}
```

- `checkout` 改成 `fetch-depth: 0`（与 `check` 作业相同），基准提交才在本地。被 `release.yml` 经 `workflow_call` 调用时没有基准，跳过；发布时拿哪个版本比，t13 定。
- 耗时（推断，没在 CI 上跑过）：克隆与检出约 5 到 10 秒（检出的树约 340 MB，按 `git archive HEAD` 的大小）；同一作业里第二次 `bun install` 命中第一次填好的缓存，约 10 到 30 秒，加 `postinstall` 构建 `neuro-agent-harness`；`build:image --no-docker` 几秒；测试几秒。合计约 1 到 2 分钟，与 `check` 并行，不拉长总时长。
- `adjacent-version.test.ts`（t05 已有的那条之上）：本版本 `migrate` → 本版本 `serve`、记入一份每日上报（编号 R）后停 → 上一个版本 `serve`：就绪 200；上一个版本的 `POST /v1/daily` 回 404 时（基准提交还没有写入口，t06 合入的那一次就是这样）只断言就绪并在测试输出里注明，否则断言新的一份 200、重发 R 得到 `duplicate` 真（`site.operations` 验收 2 的“每日上报可用”）。

本机跑同一条（在主工作区或干净克隆里，测试文档“打包与 CI 相关的验证不在 worktree 里跑”）：

```text
base=$(git merge-base master HEAD)
out=<系统临时目录>/nb-site-previous
bun run --cwd packages/nb-site-server build:previous --base "$base" --out "$out"     # 打印 command=...
bun run --cwd packages/nb-site-server build:image --no-docker
NB_SITE_SERVER_COMMAND='["bun","--no-env-file","<绝对路径>/packages/nb-site-server/dist/image/server.js"]' \
NB_SITE_PREVIOUS_SERVER_COMMAND='<上面打印的数组>' bun run --cwd packages/nb-site-contract-tests test src/adjacent-version.test.ts
rm -r "$out"
```

`bun install` 直连慢时加 `prox`。

## 4. Spec 与文档改动

主会话在 master 上改，先于第 1 片；Spec 状态仍是 `planned`。带“要定”的条目等第 10 节的结论。

`docs/specs/telemetry/protocol.md`：
1. 输出 1：`serverDay` 写成 `YYYY-MM-DD`（UTC）。
2. 输入表的 `reportId`：“22 到 64 个字符的随机串”改成“22 到 64 个字符，只含 `A-Z a-z 0-9 _ -`”。
3. 失败表与输出 4、10、11：写出响应体 `{"code": 码}`，`invalid_report` 另带 `field`（点分路径，读不出 JSON 时为 null）；`Retry-After` 是整数秒。
4. 输出 8：立即事件 202 的响应体（要定，第 10 节第 5 条）。
5. 输入一节加：请求的 `Content-Type` 是 `application/json`、不带 `Content-Encoding`（或为 `identity`），否则 400 `invalid_report`；写入口不回应跨域预检（要定，第 10 节第 6 条）。
6. 输出 3：嵌套的不认识字段在 `dropped` 里写点分路径（`manifest.x`、`usage.x`、`usage.errors.x`）。
7. 输出 4 到 6 之后加一条“校验的先后”（3.3 的八步），并写明：带了 `usage` 而 `manifest.usage` 没给时拒收；`manifest` 的版本比服务端认识的最旧还旧、或是不存在的版本时拒收；重发的内容与第一次不同时仍按重发处理、记入的是第一次。
8. `usage` 表的 `errors`：同一个 `(owner, code)` 不重复出现，重复时拒收。
9. 收集清单第 1 版里“清单里列出的取值”还没有列出来：`osMajor`、`locale`、`region` 的八个大区、`owner` 的内置插件 id（要定，第 10 节第 1 条）。
10. 立即事件属于哪一档、按哪一档的版本校验与聚合（要定，第 10 节第 5 条）。
11. 输出 2 加一句：48 小时之后再到达的同一编号，在原始上报删除之前仍可能被当作重发（服务端实际的去重持续到删除，3.2）。

`docs/specs/site/telemetry-ingest.md`：
12. 输出 9：限流按对齐的 10 分钟窗口计、跨边界的 10 分钟里可能到两倍；IPv6 按 /64 计（要定，第 10 节第 3 条）；来源数满 10 万时窗口内新来的来源一律 429；取不到来源地址时回什么（要定，第 10 节第 2 条）。
13. 输入一节的配置写出变量名与范围：`NB_SITE_TELEMETRY_RETENTION_DAYS`（2 到 7，缺省 7；要定，第 10 节第 7 条）、`NB_SITE_TELEMETRY_RATE_LIMIT`（每个来源每个窗口的请求数，1 到 1000000，缺省 600）、`NB_SITE_TELEMETRY_AGGREGATE_INTERVAL_SECONDS`（60 到 86400，缺省 600）。问题词沿用 `not_integer`、`out_of_range`。
14. 新加一小节“定时任务”：`aggregate`（按聚合间隔，启动后立即一次）、`purge`（每 10 分钟，启动后立即一次；先聚合要删的行再删除）。`site.operations` 输出 11 说“任务名见各模块的 Spec”，指的就是这里。
15. 输出 5：维度列表里“安装所在周”“`daysSinceLast`”改成“二者的交叉”（留存要它，看板 Spec 输出 3），“系统”写明含系统大版本；加“立即事件按服务端日、应用版本、运行形态、种类与错误码的条数”。
16. 验收 1 与 Smoke：第一版没有读聚合的接口，“那一天的聚合数不变”与“记入后在聚合里看到”的黑盒版在 t11 补；t06 的合同测试用“副本里有这份上报的应用版本、没有它的编号”验证进了聚合（3.8 C16），写进证据一节，不改验收原文。
17. 输出 3：删除之后内容不留在库文件里（`secure_delete` 与截断检查点，3.4、3.6）。
18. 输出 10 加：库被进程外占着写时立即回 503，不等锁。
19. 时序一节：“至多一个聚合间隔后出现在聚合里”在重启之后同样成立（启动后立即聚合一次）。
20. 证据一节（实现后）：表的位置、`AUTOINCREMENT` 与游标的约定、两个任务名。

`docs/specs/site/operations.md`：
21. 验收 2：写明“上一个版本”在 CI 里是基准提交的程序；上一个版本还没有某个接口时，那一项只断言就绪。
22. 验收 3 与输出 6：“原始上报表是空的”改成可以从外面验的说法：“副本里找不到原始上报的内容（例如它的上报编号）”。

Task 与文档：
- `.agents/works/w00037-official-site/tasks/t06-telemetry-ingest/README.md`：链接 `plan.md`。
- `.agents/works/w00037-official-site/tasks/t11-dashboard/README.md`：记下 3.2 的“看板查询读什么”表、“系统”含不含大版本、立即事件没有查询、活跃数 400 天的查询在探针 4 里约 50 毫秒（在事件循环上），以及第 16 条要补的黑盒用例。
- 实现分支里：三个包的 `AGENTS.md`（合同包去掉“第一个 schema 进来时”；模块包写连接参数、任务名、来源地址只在 `ingest.ts`）。

## 5. 切片

每片一个提交，先看验证命令自己的退出码再提交；`git diff --cached --check` 单独一步。下文 `<统计>` 指 `--package nb-site-telemetry-contract --package nb-site-telemetry --with-consumers`（会带上 `nb-site-server` 与 `nb-site-contract-tests`）。变异检查一律先提交，用 `git show HEAD:<文件> > <文件>` 恢复。

| 片 | 内容（关键设计） | 自跑验证与变异 |
|---|---|---|
| 1 合同包：清单与 schema | 3.1。前置：第 4 节第 1 到 11 条与第 10 节第 1、5 条已定 | `bun run test:affected <统计> --typecheck`；`bun run governance:check`。变异：删掉一个取值的英文说明、让版本号跳号，`manifest.test.ts` 各自失败 |
| 2 迁移、校验与存储 | 3.2；3.3；3.4 的 `config.ts`、`days.ts`、`store.ts`（还不接 HTTP） | 同上，另 `bun run --cwd packages/nb-site-telemetry test`。变异：`first` 编成 1；去掉 `ON CONFLICT DO NOTHING`；去掉“使用档更新时整段丢弃”；把第 4 步挪到第 6 步之后，各自让 `validate.test.ts`、`store.test.ts` 的对应用例失败 |
| 3 写入口 | 3.4 的 `ingest.ts`、连接参数；3.5；3.7 的适配器与说明；3.8 的 C1 到 C14、C17、C18 与两个辅助文件。前置：t05 第 5 片（合同测试底座）已合入分支 | `bun run test:affected <统计> --typecheck`；`bun packages/nb-site-telemetry/scripts/measure-ingest.ts`（记下吞吐与分位数）；手工：起 `serve`，`curl` 三个写入口各一次，看日志每行都没有地址。变异：`busy_timeout` 改回 250（C14 的 200 毫秒失败）；日志里加上来源地址（C13 失败）；`maxSize` 改成 16385（C11 失败）；413 不计入限流（`rate-limit.test.ts` 失败）；去掉 `Content-Type` 检查（C12 失败） |
| 4 任务与备份 | 3.6；3.7 的 `initialDelayMs`；3.8 的 C15、C16 | 同第 3 片，另 `bun run --cwd packages/nb-site-server test src/jobs`。变异：删除条件 `<` 改成 `<=`（C15 的 7 天边界失败）；关掉 `secure_delete`（C15 与 `purge.test.ts` 的残留用例失败）；去掉 `AUTOINCREMENT`（`backup.test.ts` 的恢复用例失败）；游标不在同一个事务里推进（`aggregate.test.ts` 的重跑用例失败）；`prepareTelemetryBackupCopy` 不删原始表（C16 失败）；去掉 `initialDelayMs`（`jobs` 用例失败） |
| 5 相邻版本 | 3.9：`build-previous.ts`、CI 两步、`adjacent-version.test.ts` 的扩展；第 4 节第 21 条已在 master | 按 3.9 的本机命令跑一次，基准取第 4 片之前的提交（有写入口与没有写入口的两种基准各一次）；`actionlint .github/workflows/*.yml`。变异：在临时提交里加一条把 `telemetry_daily_raw` 改名的迁移，相邻版本用例失败（上一个版本写不进去），撤掉临时提交 |

审查：第 3 片之后把第 1 到 3 片交快速审查（Opus 先审，omp `@review` 后台）；第 4、5 片做完把这两片合成一个范围再交一次（同样 Opus 先、omp 后台）。审查说明里点名：3.3 的先后与 `dropped` 是否只进响应；3.4 的连接参数与“事务不跨 await”；不留来源地址的每条路径（日志、错误、库、副本）；3.6 的删除边界与“删除前先聚合”；3.9 拿的是不是真的上一个版本的代码。

## 6. 验收映射

`telemetry.protocol`：

| 条目 | 覆盖 |
|---|---|
| 输出 1 | C1；`store.test.ts` |
| 输出 2 | C2、C8、C17；`store.test.ts` |
| 输出 3 | C3；`validate.test.ts` |
| 输出 4 | C4；`validate.test.ts` 的全表 |
| 输出 5 | C5；`validate.test.ts`；`aggregate.test.ts`（按生效版本记入） |
| 输出 6 | C6 |
| 输出 7 | C7 |
| 输出 8 | C8 |
| 输出 9 | C9 |
| 输出 10 | C10；`rate-limit.test.ts` |
| 输出 11 | C11 |
| 验收 1 | C2（两次 200、第二次重发）；“聚合里只算一份”：`aggregate.test.ts`，t11 补黑盒 |
| 验收 2 | C3；“其余字段被记入”：`store.test.ts` |
| 验收 3 | C6 |
| 验收 4 | C5 |
| Smoke | C1、C7、C8 |

`site.telemetry-ingest`：

| 条目 | 覆盖 |
|---|---|
| 输出 1 | 同上表 |
| 输出 2 | C1（拨时间后 `serverDay` 跟着走）；`store.test.ts` 的心跳段 |
| 输出 3 | C15；`purge.test.ts`（改小保留天数后下一次删除清掉、残留） |
| 输出 4 | C7；`store.test.ts`（3 次后计数 3、只有一行） |
| 输出 5、6 | `aggregate.test.ts`；C16（进了聚合） |
| 输出 7 | `purge.test.ts`（删除前后聚合不变） |
| 输出 8 | C9、C13；包内源码守卫 |
| 输出 9 | C10、C13（取不到地址）；`rate-limit.test.ts` |
| 输出 10 | C14 |
| 时序：至多一个聚合间隔 | `aggregate.test.ts`；`jobs` 的 `initialDelayMs` 用例 |
| 时序：写入不被阻塞超过 1 秒 | `measure-ingest.ts` 的数字（第 9 节），每次改到写入或聚合的那一片重跑 |
| 时序：重启不丢、去重仍有效 | C17 |
| 副作用：不进备份 | C16；`backup.test.ts` |
| 验收 1 | C15；“聚合数不变”：`purge.test.ts`，t11 补黑盒 |
| 验收 2 | `store.test.ts`；C7 |
| 验收 3 | C13 |
| 验收 4 | C14；“登录正常”t07 加进同一个用例 |
| Smoke | C16（弱的黑盒），t11 补 |

`site.operations`：输出 6 与验收 3 的“原始上报不在副本里”→ C16；输出 7 与验收 2 → C19（3.9）；输出 11 的任务名 → C15、C16 经 `runJob`。

## 7. 验证

- 真实进程：合同测试包对源码跑（`test:affected` 选中），第 5 片之后 CI 的 `site-image` 作业对打好的产物再跑一遍，并跑相邻版本。
- 测量：`packages/nb-site-telemetry/scripts/measure-ingest.ts` 照探针 5 的写法（服务端钉在两个核上、另一个进程 100 并发压每日上报与心跳、可选同时跑聚合），第 3 片起每片改到写入、校验或聚合时重跑，数字写进 Task 记录。造的上报要带使用档与错误码（走到 `json_each` 那条路径），不只是最小上报。
- 手工：起一次 `serve`，三个写入口各发一份、拨时间跑 `purge`，看日志每行是 JSON、没有地址。
- 收口前：`bun run test:affected <统计> --typecheck`、`bun run governance:check --since master`、`bun run docs:check --since master`、`actionlint .github/workflows/*.yml`；长验证前看 `cat /proc/loadavg`。
- e2e：没有浏览器 e2e，不碰应用包。

明确留下的未验证边界：
- 在真实的 2 核 2 GB VPS 上的吞吐：探针是 8 核桌面机上钉两个核，单核速度比常见 VPS 快（推断 VPS 慢两到三倍，结论不变）。
- 断电：`synchronous = NORMAL` 时 WAL 模式不在每次提交时同步磁盘，进程崩溃不丢，主机断电可能丢最后几次提交（不损坏库）。Spec 只承诺“重启服务不丢”，不改。
- CI 上 `build:previous` 的实际耗时。

## 8. 不做与风险

不做：
- 看板的查询接口（t11）；按新的办法重算 7 天内的聚合（提案 4.6 说可以，没有使用者，原始上报留着，以后加一个命令即可）；入库即聚合（ADR 0062 定了大规模上线前再定）；反向代理的限流与日志配置（t13）。
- 发布时（`workflow_call`）的相邻版本：没有基准提交，t13 定拿哪个版本。

风险与兜底：
- 伪造的上报能造出任意多个 `appVersion`（只要合语义化版本的写法），让聚合与心跳表变大；限流只挡单个来源。兜底：每个来源每窗口 600 个；表的增长看磁盘告警（t13）。以后要更严，就只聚合已发布过的版本、其余记 `other`（要清单之外的一张版本表，现在不做）。
- 业务连接 `busy_timeout = 0` 依赖“进程内没有别的写者、进程外只有偶发的写者”。以后统计模块加了 `shared` 命令或别的进程要写这个库时要重新考虑：写在连接参数旁的注释里。兜底测试：C14（被占时立即 503）与探针 7 的结论（备份期间写入不撞锁）。
- 故障注入的连接被回收时锁会悄悄放掉：探针 7 起初把持锁的连接放在块作用域里，没有引用，写入在 2 毫秒内就成功了，“被占着写”的用例形同虚设。t05 的 `holdWriteLock` 把放锁函数闭包在连接上，没有这个问题；C14 断言 503 的同时要断言放锁之前持续是 503（至少两次请求）。
- 删除依赖截断检查点清掉 WAL 里的旧帧；备份正读着库时截断做不完，那一轮留到下一次删除。C15 在没有备份并发时验证。
- 相邻版本只比“基准提交”，不比“上一个发布版本”。在发布前的几次合入里分两步做的结构改动（先加后删），逐次比基准时同样会被拦下，比按发布比更严，不会更松（推断）。
- 第 3 片依赖 t05 第 5 片的合同测试底座、第 5 片依赖 t05 第 7 片的 `site-image` 作业与 `build:image --no-docker`；它们的接口以合入后的代码为准，开工前读一遍。

## 9. 探针

脚本与输出都在 `/tmp/w00037-t06-plan/lab/`（`node_modules` 链到 worktree 的）。

| 探针 | 脚本与输出 | 结论与关键数字 |
|---|---|---|
| 0 | `p0-version.ts` | Bun 1.4.4 带 SQLite 3.53.4，JSON1 可用（`RETURNING`、`->>` 都在 3.35 以后） |
| 1 | `p1-migration-dedup.ts`、`.out`、`sql/0001_init.sql` | 草稿迁移过真实运行器 `{"ok":true}`；`ON CONFLICT DO NOTHING RETURNING id` 首次返回 `{id:1}`、重发返回 null、`changes` 为 0；不加时报 `SQLITE_CONSTRAINT_UNIQUE`；`STRICT` 类型错报 `SQLITE_CONSTRAINT_DATATYPE`；心跳 upsert 三次得一行 3；带 `WHERE` 的 `INSERT … SELECT … ON CONFLICT` 不用另加 `WHERE true`；`json_each` 展开错误码；`VACUUM INTO` 加清空加 `VACUUM` 之后 `sqlite_sequence` 还在、新行 id 接着往上、游标保留；`VACUUM INTO` 的副本日志模式是 `delete`（入口打开时会设回 WAL） |
| 2 | `p2-aggregate-purge.ts`、`aggregate.ts`、`gen.ts`、`.out` | 聚合每批（同步事务）：500 行 4 到 9 毫秒，2000 行 14 到 27 毫秒（全量跑时单批最大 31），5000 行 41 到 72 毫秒；再跑一次处理 0 行；删除 2000 行一批最大 7.7 毫秒（每天 1 万）、48.7 毫秒（每天 10 万），一次删 10 万行 229 毫秒；截断检查点 1 到 3 毫秒；8 天原始上报：每天 1 万 16.4 MB、10 万 163.4 MB；`secure_delete` 让删除慢约一半（1 万行 25.7 对 17.5 毫秒）。这个脚本里的残留检查没有先确认标记在删除之前确实在文件里（三种设置下都报“找不到”，与探针 3 矛盾），结果不可信，以探针 3 为准 |
| 3 | `p3-secure-delete.ts`、`.out` | `secure_delete` 关：删除并截断检查点之后，被删的上报编号仍在库文件里；开或 `fast`：检查点之后库文件与 WAL 里都没有。WAL 里留着插入时的帧，截断检查点才清掉 |
| 4 | `p4-size.ts`、`.out` | 一年的聚合：20 个版本 55.3 MB（心跳 140 万行 37.8 MB），5 个版本 17.2 MB；14 天在线查询 1.4 到 4.7 毫秒；400 天活跃数的源数据查询约 50 毫秒（给 t11） |
| 5 | `p5-server.ts`、`p5-load.ts`、`p5-run.sh`、`p5-throughput.out` | 服务端钉 2 个核（每个请求校验、一次同步事务、一行 `writeSync` 日志）：每日上报 100 并发 7771 次每秒，p50 11.9、p99 23.1、最大 57.2 毫秒；10 并发 7559 次每秒，p50 0.9、p99 6.6 毫秒；心跳 100 并发 13276 次每秒，p99 15.3 毫秒；100 并发时每秒跑一批 2000 行聚合：p99 30.8、最大 88.7 毫秒，聚合单批最大 39 毫秒；一批 5000 行时 p99 48.1。进程常驻约 75 MB。结论：逐请求一个事务足够，不攒批，没有丢失窗口 |
| 6 | `p6-body-limit.ts`、`.out` | `bodyLimit` 16384 字节过、16385 与 20 KB 413、分块的 20 KB 413、分块的小请求过；`text/plain` 照收（要自己拦）；Bun 不替请求体解压，`gzip` 的请求体读出来不是 JSON |
| 7 | `p7-busy.ts`、`p7-child.ts`、`.out` | 另一个进程持 `BEGIN EXCLUSIVE`：`busy_timeout = 250` 时写入 251.4 毫秒后 `SQLITE_BUSY`（事件循环停这么久），`= 0` 时 0.1 毫秒；另一个进程 4 秒里做了 135 次只读 `VACUUM INTO`，期间 `busy_timeout = 0` 的写入 52886 次没有一次失败。持锁的连接没有引用时会被回收、锁随之放掉（见第 8 节） |
| 8 | `p8-limiter-memory.ts`、`.out` | `Map` 每个来源约 105 到 117 字节：1 万 1.2 MB、10 万 11.7 MB、50 万 51.7 MB；`clear()` 不到 0.1 毫秒 |
| 9 | `p9-typebox.ts`、`.out` | `Type.Object` 缺省放行多出来的字段（嵌套的也放行），`Clean` 能去掉；缺字段时错误的 `instancePath` 是空串、联合类型一错报三条，所以按字段逐个校验；`1.0` 算整数；`__proto__` 作为普通的键放行；编译后的校验 10 万次 9 毫秒 |

推断、没探过的：CI 上的耗时（3.9）；VPS 上的吞吐；`nb-site-server` 里测试控制入口的“立即跑一次”与 `initialDelayMs` 的配合（那一版还没写完）。

## 10. 要主会话或开发者定的事

1. **收集清单第 1 版的取值表。** 背景：协议里 `osMajor`、`locale` 写“清单里列出的取值，其余 `other`”，`region` 是“八个大区之一”，`owner` 是“清单里列出的内置插件 id”，但哪几个值在 Spec、提案与 w00053 的记录里都没搜到（搜过 `osMajor`、`大区`、`region`、`owner`）。它们是公开合同，服务端按它拒收，应用的插件按它分档，官网按它生成说明。候选：A 现在定一版保守的表；B 先只收 `other`。推荐 A：`osMajor` 取 Windows `10`、`11`，macOS `13` 到 `15`，Linux 只发 `other`（内核版本没意义）；`locale` 取应用已有的界面语言（`zh-CN`、`en`）；`region` 取 `east-asia`、`southeast-asia`、`south-asia`、`europe`、`north-america`、`latin-america`、`middle-east-africa`、`oceania`；`owner` 取 w00053 t06 定下的内置插件 id。具体名单要开发者或 w00053 的负责人点头。不定会卡住第 1 片。
2. **取不到来源地址时回什么。** 背景：输出 9 只说“被拒”，没给码。取不到多半是部署配错了（可信代理没转发头），不是发送方的错。候选：503 `unavailable`（发送方退避重发）；400 `invalid_report`（发送方丢弃这一份）；429。推荐 503：问题在服务端，修好部署之后发送方重发的还能进来；进程记一行不带地址的 warn 方便发现。卡住第 3 片。
3. **限流的口径。** 背景：输出 9 写“每个来源每 10 分钟至多 600 个”。推荐：按对齐的窗口计（实现最简单、合同测试能拨时间验证，代价是跨边界的 10 分钟里可以到 1200 个）；IPv6 按 /64 计（否则一个 /64 能换出无数个地址、各拿一份额度）；来源数满 10 万时新来源一律 429（宁可错拒，不让内存无限长）。候选：滑动窗口（要存每个请求的时刻，内存翻几百倍）、IPv6 按完整地址。卡住第 3 片。
4. **比服务端新的匿名档版本记在哪个版本下。** 背景：协议输出 5 让服务端“照认识的最新版本处理”，输出 6 与 `site.telemetry-ingest` 输出 6 要求“分档表不同的两个版本不合并”。新版本若改了分档表、而某份上报的取值碰巧在旧表里也合法，就会被并进旧版本的序列。只加取值的新版本，用到新取值的上报会被旧服务端整份拒收。推荐：照协议输出 5，按生效（服务端认识的）版本记，Spec 里写明这个后果，并约定“先部署服务端、再发应用”（这是发版顺序，不是代码）。候选：按声明的版本记（看板上会出现服务端不认识的版本段）。卡住第 2 片。
5. **立即事件的档与回应。** 背景：协议没标立即事件属于哪一档；应用一侧只在使用统计开着时发（`telemetry.client` 输出 12），所以它其实是使用档；202 的响应体也没写。推荐：属于使用档，`manifest.usage` 必填，`kind`、`code` 按使用档的版本校验（版本比服务端新时照最新的处理，不整条丢弃，否则什么都不剩），聚合按使用档版本存；202 的响应体与每日上报同形 `{serverDay, duplicate, dropped}`，方便发送方共用一套处理。卡住第 1 片。
6. **只收 `application/json`、不收压缩。** 背景：协议只说“请求体是 JSON”。不拦 `Content-Type` 时，任何网页都能让访客的浏览器用 `text/plain` 往写入口发伪造的上报，不触发跨域预检、每个访客一个来源地址，限流挡不住（探针 6 确认 `text/plain` 会被照收）。推荐：别的类型与带压缩的都回 400 `invalid_report`（不新加码；应用自己的发送方本来就发 JSON）。候选：回 415（要在协议的失败表里加一个码、发送方加一个分支）。卡住第 3 片。
7. **保留天数的范围。** 背景：Spec 把保留天数做成配置、缺省 7；条款与 ADR 0062 写的是 7 天。去重靠原始表（3.2），保留少于 2 天会让去重窗口短于协议的 48 小时。推荐：只许 2 到 7：能调小、不能调大，调大要改条款。卡住第 2 片。
8. **第一版没有读聚合的接口，几条验收的黑盒部分推到 t11。** 背景：`site.telemetry-ingest` 验收 1 的“聚合数不变”、协议验收 1 的“聚合里只算一份”、Smoke 的“记入后在聚合里看到”，都要能从外面读聚合；第一版只有 t11 的看板接口能读，而它要管理员登录（t07）。推荐：t06 在包内测这几条，合同测试用备份副本的字节做弱的黑盒（3.8 C16），t11 再补黑盒；不为此给测试控制入口加“读聚合”（那等于把聚合的存放形状变成测试合同）。不定不卡哪一片，但影响 t06 能不能按 Spec 的验收标成完成。

Spec、ADR 与提案之间对不上的地方：
- 提案 4.5 说“服务端对不认识的字段丢弃并计数”，协议输出 3 只说丢弃并列在 `dropped` 里，没有计数。按 Spec 做，不计数；要计数时再加一个聚合维度。
- 协议输出 5 与两份 Spec 的输出 6，见上面第 4 条。
- 提案 4.6 说“7 天之内可以改聚合的办法重算”，`site.telemetry-ingest` 没有对应的输出；本计划不做重算，原始上报留着，以后能补（第 8 节）。
- ADR 0059 后果一节把限流与请求体上限放在反向代理，`site.telemetry-ingest` 输出 9 与协议输出 11 放在进程里。两层都要，不冲突；t13 的反向代理配置照 ADR 再加一层。

## 没来得及核实的地方

- t05 第 5 片（合同测试底座）与测试控制入口的最终接口：本计划按 t05 计划写的 `advanceClock`、`runJob`、`holdWriteLock` 与 `SiteSandbox` 规划，没有对照代码（还没写完）。
- t05 第 7 片的 `site-image` 作业与 `build:image --no-docker` 的实际写法；CI 上第二次 `bun install` 与检出的耗时。
- `prepareBackupCopy` 在副本上跑聚合的耗时上限：按探针 2 推断，积压至多一个聚合间隔的上报时是几十毫秒。
- 2 核 2 GB VPS 上的数字（探针在桌面机上钉核）。

## 主会话的审定（2026-11-24）

计划由一个 Opus 子代理起草（只读，探针在仓库外跑）。主会话读过第 1 到 5、8、10 节，结论如下；**与前文冲突的地方以本节为准**。第 4 节列的 Spec 改动已在 master 上改完（`telemetry.protocol`、`site.telemetry-ingest`、`site.operations`），第 20 条（证据）留到实现之后。

第 10 节的八件事，开发者 2026-11-24 说过“都按照你推荐就行”，这里按推荐定，并在汇报里告知开发者：

1. **取值表**：定了，已写进 `telemetry.protocol`。`osMajor`：Windows `10`、`11`，macOS `13`、`14`、`15`、`26`、`27`，其余 `other`；`locale`：`zh-CN`、`en-US`、`other`（应用的界面语言表 `host-locales.ts` 是这两个，不是草稿里写的 `en`）；`region`：八个大区加 `other`（时区换算不出时）。`owner` 的名单不进 Spec 正文，放合同包的清单里：第 1 片的实现者从应用实际随发行构建带的插件里列出来（只在开发时用的不列），名单写进汇报由主会话核对。
2. **取不到来源地址**：503 `unavailable`，记一行不带地址的 warn。
3. **限流**：对齐的 10 分钟窗口；IPv6 按前 64 位；来源数满 10 万时新来源一律 429。
4. **比服务端新的匿名档版本**：按服务端认识的最新版本记入；“先部署服务端、再发应用”写进了协议的边界一节。
5. **立即事件**：属于使用档，`manifest.usage` 必填；202 的响应体与每日上报同形。
6. **内容类型**：只收 `application/json`、不收压缩，否则 400 `invalid_report`，不加新码。
7. **保留天数**：只许 2 到 7。
8. **读聚合的黑盒验收**：t06 在包内测，合同测试用备份副本做弱的黑盒检查，完整的黑盒在 t11 补；不给测试控制入口加“读聚合”。

对入口的两处改动，同意：

- 统计的业务连接 `busy_timeout = 0`。补一条要求：`purge` 最后的截断检查点每次都做（哪怕这一次没有要删的行），并看它返回的“忙”那一列；备份正读着库时截断做不完，记一行 warn，下一次再做。这样“删除之后内容不留在库文件里”至多晚一个删除间隔。
- `JobDefinition` 加 `initialDelayMs`。开工时先读 t05 已合入的 `jobs.ts`：它现在按任务排队（测试控制入口的“立即跑一次”与按间隔的那一次共用一条队列），新参数要接在这套排队上。

主会话另加的三点：

- 聚合的一批里，读游标、算这一批、推进游标必须在同一个同步事务里：`aggregate` 任务与 `purge` 里“删除前先聚合”会在批与批之间交错，各自拿着旧游标就会把同一批算两遍。补一条包内用例：两边交替各跑一批，结果与只跑一边相同。
- 伪造的 `appVersion` 让聚合表变大这一条（第 8 节）先按计划记为风险，不加机制；交设计审查看要不要一个每天的取值个数上限。
- 合同测试底座、测试控制入口与备份的接口以 t05 合入分支的代码为准（起草时它们还没写完）：`SiteProcess.advanceClock`、`runJob`，`prepareBackupCopy(copy)`，测试控制入口在定时任务还没开始调度时回 503 `not_ready`。

下一步：计划交设计审查（数据格式与安全边界，按高风险后端：Opus 先审，omp 在后台），处理完再开第 1 片；第 3 片要等 t05 的第 5 片合入分支。

## 设计审查的处理（2026-11-24）

审查者：一个 Opus 子代理，只读，审的是计划定稿时的副本；报告 [`evidences/design-review-opus.txt`](evidences/design-review-opus.txt)，14 条有效发现（重要 5、建议 9，没有阻断），多数带真实 bun:sqlite 上的实验。omp（`@review`）同时在后台审同一份说明，它的报告回来后另行处理。**与前文（含“主会话的审定”）冲突的地方以本节为准**；涉及的 Spec 已在 master 上改完。

| 条 | 发现 | 处理 |
|---|---|---|
| 1 | 伪造的取值让长期保留的聚合无限变大：每份上报能带 50 个不同的 `code`，加新的 `appVersion`、`installWeek`；实测单个来源按缺省额度每天让聚合长约 500 MB | 成立，四处都改。`code` 回到已接受的提案的写法（4.4、4.5：错误码是清单里的码表，表外的记“其他”）：使用档清单按 `owner` 列码表，服务端拒收表外的码，`owner` 为 `other` 时 `code` 只能是 `other`；立即事件的 `code` 同样按 `kind` 列码表。`installWeek` 只收服务端日所在周往前 13 周到往后 1 周之间的周。应用版本每个服务端日至多 64 个不同的取值进聚合（按游标顺序先到先占，重跑结果相同），心跳每段同样（写入时查这一段已有几个版本），之后的记 `other`。3.2 的存储量表在第 2 片按最坏情况重算，写进 Task 记录 |
| 2 | 备份在副本写出之后失败或被杀，`.partial` 里留着带全部原始上报的副本，删除任务管不到 | 成立，改。`prepareTelemetryBackupCopy` 先在副本上聚合、再清空两张原始表；聚合出错时照样清空，再抛错让这次备份失败。`nb-site-server` 的 `backup.ts`：任何失败与被打断的返回之前删掉这一份 `.partial`（删不掉记一行带 `errorCode` 的 warn）；残留的 `.partial` 改在每次备份**开始时**（取到 `backup.lock` 之后）清，不等成功之后。这一处是 t05 的代码，随 t05 第 4 到 7 片的审查修正一起做，不等本 Task。补用例：让 `prepareBackupCopy` 失败，备份目录里找不到上报编号 |
| 3 | 上报少的日子聚合就是原始上报；安装周与 `daysSinceLast` 的交叉按天长期保留，能把同一个安装的上报日一天天连起来 | 成立。交叉表里的 `daysSinceLast` 封顶：`first`、1 到 7、“超过 7 天”一档（留存只用到窗口内第 1 到 7 天）；28 日活跃与新增另用一张不带安装周的表（`telemetry_daily_activity`：服务端日、清单版本、`days_since_last`）。“只有一份上报的那一天，聚合等于那一份的全部字段”去不掉：写进了 `site.telemetry-ingest` 的“不承诺”，并在汇报里告知开发者；要不要在删除原始上报时把小于某个数的格子并掉，等上线规模定了再议（那要改“删除之后那一天的聚合不再变化”） |
| 4 | 相邻版本测试不跑上一个版本的 `aggregate` 与 `purge` | 成立，改。上一个版本起服务时保留测试控制口令，用例拨时间后跑它的两个任务并断言都回 200；造上报用清单第 1 版。“聚合失败照样删除”不变（保留期是隐私承诺） |
| 5 | `osMajor` 的取值依赖 `os`，逐字段校验表达不了；3.2 的 `linux/6` 与协议矛盾 | 成立，改协议：两个字段合成一个 `osVersion`（`windows-10`、`windows-11`、`windows`、`macos-13` 到 `macos-27` 五个、`macos`、`linux`、`other`），清单里没有跨字段的规则。聚合里只有 `os_version` 一个维度，看板的“系统”按前缀合计，交 t11 |
| 6 | 来源数满 10 万时新来源一律 429，一个 IPv6 的 /48 就能在每个窗口开头把正常用户全挡掉 | 成立，改。IPv6 另按前 48 位合计一次，额度是单个来源的 16 倍，先判它再建 /64 的条目；一个 /48 因此至多占 9600 个条目。满了之后新来源一律 429 的规则留着 |
| 7 | `Content-Type` 要按媒体类型本身精确比较 | 成立，改；补用例 `text/plain;application/json` 被拒 |
| 8 | 换回上一个版本的服务端会绕开“先部署服务端、再发应用” | 成立。原始表两列都存：声明的版本与生效的版本，聚合按生效的；协议的边界一节写了回退时同样会混 |
| 9 | `build-previous` 的子进程输出会混进 `$GITHUB_OUTPUT`；“上一个版本回 404 就只断言就绪”是按运行结果分支 | 成立，改。脚本把命令写进 `--command-out <文件>`，不走标准输出；上一个版本有没有写入口由脚本看基准提交的树里有没有 `packages/nb-site-telemetry/src/ingest.ts` 定，经环境变量 `NB_SITE_PREVIOUS_WITHOUT_INGEST=1` 告诉用例，用例不按 404 自己分支 |
| 10、13 | `purge` 的循环没有上限、任务拿不到停止信号；聚合间隔配大时每次 25 批的上限追不平积压 | 成立，合在一起改。两个任务都不设批数上限，跑到追平为止；模块的 `close()` 置一个“正在关闭”的标志，任务每批之前查它、置位就收手。每批至多几十毫秒，落在 `close()` 的 2 秒之内 |
| 11 | 写库时 `SQLiteError` 一律回 503 | 成立，改。只有忙、读写错误、磁盘满这几类回 503 `unavailable`；约束类的错误是程序错误，照常抛给入口（500） |
| 12 | C14 的“200 毫秒内回应”用测试进程计时，负载高时误报 | 成立，改成看服务端日志里那一行的 `durationMs`（t05 的做法） |
| 14 | 立即事件缺 `manifest.usage` 时报哪个字段、编号空间 | 成立，已写进协议：按 `manifest` 不合格拒收、`field` 是 `manifest.usage`；每日上报与立即事件的编号各自去重 |

审查者对“主会话的审定”的补充，照做：截断检查点放在事务外做；聚合一批的上界与游标在同一个事务里取。

第 1 片因此多一件事：使用档第 1 版的码表从哪里来。开工时先查应用里的错误码能不能从一处列全（ADR 0034 的“拥有者命名空间加码”、各插件的文字目录、`scripts/ci/message-catalogs.ts` 的 `closedCodes`、诊断的声明）。列得全就生成码表放进合同包，并写明两边怎样保持一致（合同包不能依赖应用，校验放在应用一侧或 CI 脚本里）；列不全就停下，把查到的情况写进汇报，由主会话定第一版的码表收多少。

## omp 设计审查的处理（2026-11-24）

omp（`@review`）审的是与 Opus 同一份计划副本，报告 [`evidences/design-review-omp.txt`](evidences/design-review-omp.txt)：34 条（阻断 6、重要 25、建议 3），部分带真实 bun:sqlite 上的实验。它审的是“设计审查的处理”之前的版本，所以先按当前的计划与 Spec 重判了一遍。**与前文冲突的地方以本节为准**；涉及的 Spec 已在 master 上改完。

已经被上一节改掉、不用再动的：第 8 条（任务拿不到停止信号）、第 10、16 条的取值基数（码表、每天 64 个版本、安装周的范围）、第 23 条（`osVersion` 合成一个字段）、第 32 条（`build-previous` 的输出走文件）、第 15 条的编号范围（每日上报与立即事件各自去重）、第 33 条与第 27 条（`.partial` 当场删、最后一个模块之后的停止检查，都在 t05 的修正片里）。

这次新改的：

| 条 | 发现 | 处理 |
|---|---|---|
| 3 | 下一轮聚合从上一轮结束起算，“至多一个聚合间隔”照字面不成立 | 批数上限上一节已去掉。Spec 的时序改成“在下一次聚合任务跑完时出现在聚合里：两次聚合的开始相隔一个聚合间隔加上一次的用时” |
| 4 | 按生效版本记入，回退或发布顺序反了时会把含义不同的同名取值并进一个序列 | 从清单的规则上堵：协议的边界一节加“已有的取值与分档名字的含义在以后的版本里不变，要改含义就换新名字”。这样旧服务端收到新版本的上报时，用到新名字的整份拒收，只用到旧名字的含义不变，数不会错。合同包的 `AGENTS.md` 写上这条规则（第 1 片的核对项） |
| 5 | 聚合一时拿不到锁与聚合永久坏了，都落到“照样删除” | 改。聚合因为库忙失败时这一轮不删，下一轮再来；别的失败照样删，记一行 error，并让这一次 `purge` 以失败结束（经测试控制入口跑时回 `job_failed`）。`site.telemetry-ingest` 输出 3 已写。包内用例各一条 |
| 6 | 批与批之间看板能读到只算了一部分的一天 | 看板 Spec 的时序改成：同一次读到的各维度出自同一批算完的上报、彼此对得上，保留期内的日子最近记入的可能还没算进去。不为此加“按天发布”的机制：保留期内的日子本来就还会来新上报 |
| 9 | 聚合按编号的差推进，重发会留下空号（`ON CONFLICT DO NOTHING` 也消耗编号），空号吃掉一批的额度 | 改。一批的上界取 `id > 游标 ORDER BY id LIMIT n` 实际选出的最后一行；补一条库里有大段空号的用例 |
| 12 | 相邻版本用例只在空目录上先跑新迁移，没有旧程序先写下的数据；“比发布门禁更严”的推断不对 | 改第 5 片：上一个版本有写入口时，先由它记入一份，再由本版本迁移并记入一份，再换回上一个版本，断言两份重发都是 `duplicate`。第 8 节那句“比按发布比更严”作废：逐次比基准与比已部署的版本各有抓不到的情况，后者在 t13 做 |
| 13 | 用备份恢复之后，恢复前记入的上报再重发会被重复计入，协议没写这个例外 | Spec 写明（`site.telemetry-ingest` 的副作用一节，协议输出 2 指过去）。另补保留 2 天时的边界用例：某天最后一刻记入的，48 小时内重发仍是 `duplicate` |
| 14 | “到达时”没定义是哪一刻；时钟回拨会重开已经删过原始上报的日期 | Spec 写明：按记入那一刻（读完请求体、写库时）；保证以时钟不大幅回拨为前提（边界一节）。不加防回拨的机制 |
| 16 | 每份带 50 个错误码时，2000 行一批实测 330 到 400 毫秒，远高于计划估的 15 到 40 | 改。批的大小不写死 2000：第 4 片用“每份 50 个错误码”的最坏输入量过再定，目标是单批不超过 100 毫秒；数字写进 Task 记录 |
| 17 | 限流表只在有请求时才清，服务空闲时上一个窗口的地址一直留在内存；取不到来源地址的 warn 每个请求一行 | 改。限流器加按时间清空的入口，由一个 10 分钟的定时调用（与 `purge` 同一个任务里顺带做，不另起任务名）；那条 warn 每个窗口至多一行。来源数满了错拒新来源的取舍不变（上一节第 6 条） |
| 18 | 内容类型不对的请求先占了额度，网页能用它耗掉访客自己的额度；几种失败同时出现时先报哪个没定 | 改。内容类型与编码的检查挪到计入限流之前（它不读请求体，成本与回 429 一样）。先后写进协议输出 13：内容类型与编码、取不到来源、限流、过大、不是 JSON 对象，再往后照旧。合同用例加“过大且类型不对”回 400 |
| 20 | 来源地址没按值规范化：IPv4 映射地址的十六进制写法会落进 IPv6 的桶 | 改在入口（t05 的修正片）：来源地址写成一种写法，`site.operations` 已写。限流器拿到的已经是规范写法，IPv6 的前 64、48 位按解析出的值取，不按字符串截 |
| 21 | 失败响应的 schema 没按码分；`Type.Optional` 单独校验 `undefined` 为假 | 第 1 片核对：失败体按 `code` 分支，`invalid_report` 的 `field` 必有。后一点告诉第 2 片的实现者：可省的字段先看在不在，再校验 |
| 22 | 待发的一份隔天才送达时 `daysSinceLast` 不重算，活跃数少计 | 接受为口径的近似，协议的时序一节写明。应用一侧不为它重算（重算要改已经定好的正文） |
| 24 | 看板说“按错误码”，聚合存的是 `owner` 加 `code` 一对；按单独的 `code` 数份数算不出来 | 看板 Spec 的 `errors` 改成按 `owner` 与 `code` 一对。交 t11 |
| 26 | 同意了使用统计但这一份没有使用段（被整段丢弃、或应用没给）是合法的；聚合靠“使用档版本非空”判有没有段，两者可能对不上 | 改第 2 片：原始表里使用档的版本与使用段的三项同在同不在，用 `CHECK` 约束；整段被丢弃时两者都不存。用例三种：同意了没带段、版本太新被丢、带了段而 `errors` 为空 |
| 28 | 备份的验收只看副本里的字节 | 第 4 片的包内备份用例加强：副本里两张原始表为空、聚合的数对、游标不是 0，用副本恢复后新行接着进聚合。C7 的 204 用原始的 `fetch` 断言空响应体。C14 的“登录正常”仍在 t07 加 |

不改的，与理由：

| 条 | 发现 | 理由 |
|---|---|---|
| 1 | 副本先带着原始上报落盘、再清；进程被强行结束时 `.partial` 里留着原文 | 失败与被打断时当场删、残留在下一次备份开始时清（t05 修正片）。剩下的只有“写副本的几秒里被强行结束、此后再也不跑备份”：记为已知限制，写进了 `site.telemetry-ingest` 的副作用一节。要彻底避免得不经 `VACUUM INTO`、自己逐表写副本，不值 |
| 2、31 | 换回 t05 的程序后，它的备份会带出原始上报，也没有删除任务 | t05 的程序不会被部署：第一次部署在整个 Work 做完之后（t13），那个版本已经带着删除任务与备份时的清空。写成约束：能换回去的版本都带这两样，以后的版本不能去掉（`site.telemetry-ingest` 的边界一节） |
| 7 | 有读者一直拿着旧快照时，截断检查点一直做不完，被删的内容还在文件里 | 进程内的读都是同步的短查询，进程外的读者只有备份（几秒）。每次 `purge` 都做检查点、做不完记 warn（“主会话的审定”）已经够 |
| 11 | 基准提交有服务、没有打包脚本时相邻版本测试静默跳过 | 这种基准只出现在 Work 分支内部没推送的提交上；合入 master 之后每个基准都有打包脚本。脚本加一处：把解析出的基准提交与跳过的原因写到标准错误，方便看日志 |
| 19 | 没接住的请求的路径会进日志，路径里可以写着一个地址 | “不留来源地址”说的是不从连接与转发头里取出来存；请求方自己写进路径或字段里的内容不在这个保证里 |
| 25 | 同一个安装升级后，新增与后续活跃落在不同的清单版本段里，按段算的留存没有意义 | 现在只有第 1 版。记给 t11：出第 2 版时按“名字含义不变”的规则定跨版本怎样合计 |
| 29 | 各条路径遇到库忙时的结果没有统一写出来 | 第 5 条改完后，会遇到库忙的路径只有写入（503）、两个任务（这一轮不做）与就绪检查（503）；别的进程不写这个库 |
| 30 | 用新程序给还没迁移的旧库做备份会在清空那一步失败 | 失败是对的（`prepare_failed`，不会带出原文）。记给 t13：升级前的备份用正在运行的那个版本做 |
| 34 | 对“主会话的审定”八项的逐项判断 | 没有新的发现，涉及的已在上面各条处理 |

切片因此的变动：第 1 片的核对加两项（失败体按码分支、`AGENTS.md` 写“名字含义不变”）；第 2 片加 `CHECK` 约束与可省字段的校验写法；第 3 片的校验先后照协议输出 13 的新顺序，限流键按解析出的地址值取；第 4 片加库忙与别的失败的区分、按实际行取上界、批大小按最坏输入定、限流器的定时清空、备份用例加强；第 5 片的用例先由上一个版本写数据。

## 实现审查（第 1 到 3 片）的处理（2026-11-24）

审查的是 `8565561bb`、`e5de7dd59`、`29f2c05f1`。Opus 子代理先审：6 条，都是建议级，没有阻断与重要；报告 [`evidences/impl1-review-opus.txt`](evidences/impl1-review-opus.txt)。它另做了随机输入（30 万份改坏的 JSON 没有一次让校验抛错，校验通过的 15.9 万份写库没有一次约束错误）、用另一种算法核对安装周的范围、5 个变异（4 个被用例抓到）。omp（`@review`）在后台审同一份说明，报告回来后另行处理。

| 条 | 发现 | 处理 |
|---|---|---|
| 1 | 发送方上传到一半断开时，读请求体抛的错没接住，记成 error 级的未处理错误、请求日志 500 | 改。读请求体时对端断开按“请求体读不成”处理（400，`field` 为 null），不记 error |
| 2 | 合同用例只看回应、不看“其余字段被记入”：让清单版本比服务端新的上报不写库、照回 200，用例全过 | 改。C3、C5 各补一次同编号重发，断言 `duplicate` 为真；另补一条不超过 16 KiB 的合格分块请求回 200 |
| 3 | “库一时用不了”里算进了 `SQLITE_LOCKED`：它只在同一条连接上的冲突里出现，是程序错误 | 改。去掉它（照常抛、成 500） |
| 4 | 来源地址的源码守卫只认一种调用写法 | 不改。真正的防线是合同用例 C13（输出与数据目录里找不到地址）；守卫只是提醒，在它旁边写明这一点 |
| 5 | 清单里三处说明不合“给用户看”的规则：安装周的说明写进了服务端的拒收范围；一个插件的中英文意思不一致；一个插件的中文只写了英文词 | 改。第 1 版还没发布，现在改不用提版本。安装周的范围只留在协议里（这一句是主会话在第 1 片的说明里要求写的，要求错了） |
| 6 | 测量脚本写死了入口文件的相对路径 | 改。缺省仍是那个路径，另认 `NB_SITE_SERVER_COMMAND`（与合同测试同一个环境键） |

这六条的修正随第 4 片一起派，单独一个提交，排在第 4 片之前。

## omp 实现审查（第 1 到 3 片）的处理（2026-11-25）

omp（`@review`）审同一范围，7 条：重要 1、建议 6；报告 [`evidences/impl1-review-omp.txt`](evidences/impl1-review-omp.txt)。和 Opus 那轮没有重叠；Opus 那轮的修正（`a917f9757`）不碰这几处，所以按原提交的结论处理。

| 条 | 发现 | 处理 |
|---|---|---|
| 1 | 安装周取在下限那一周的上报，第一次在周日记入，周一用同一个编号重发时按新的一周判、被 400 拒，拿不到 `duplicate` 与第一次的服务端日 | 改，选简单的一种：下限按“服务端日往前两天那一天”所在的周算，协议只保证 48 小时内的重发（协议输出 2），这样覆盖全部；新编号的上报在每周开头两天多收一周，范围只是防伪造的粗过滤，不影响。不改成“先查编号再按第一次的日期判”：要把查库挪到校验中间。协议的字段表已改。补用例：跨周的重发回 `duplicate`，新编号带同一周在第三天被拒 |
| 2 | `Content-Type` 有两个、或一个值里用逗号拼了两个，第一个带参数时被收下 | 改。值里在引号外出现逗号时按内容类型不对拒（400，`field` 为 null），不计额度。C12 补重复头、逗号拼接、带引号参数三种 |
| 3 | 声明的请求体超过 Bun 的传输层上限（128 MiB）时，进程在进入模块前回不带响应体的 413 | 不改实现。协议的“失败与恢复”写明输出 12、13 只约束进入写入口处理的请求，这种 413 发送方照 `payload_too_large` 处理 |
| 4 | 失败响应的 schema 没拒多余的键，`{code:"unavailable",field:"channel"}` 也算合格 | 改。两个分支都拒收多余的键，补断言 |
| 5 | 不带使用段的发送方 schema 不验 `manifest.usage`，`0`、`"1"` 都算合格，而服务端会拒 | 改。这个分支也从清单取 `manifest.usage` 的可省 schema，补四个对照值 |
| 6 | C1 护不住“读完请求体才取时间”：把取时间挪到读请求体之前，用例全过 | 不改。要在合同测试里让请求停在请求体中途、确认已进入处理再拨钟，写法复杂；退化的后果是跨午夜的慢请求记到前一天，影响是个别份数。取时间的那一行旁边写明为什么在读完之后 |
| 7 | 心跳的版本上限用例从实现导入常量，把 64 改成 65 用例照过 | 改。用例里写字面的 64，断言第 65 个计入的是 `other` |

这几条单独一个提交，等第 4 片交回后派（同一个 worktree）。

## 实现审查（第 4、5 片）的处理（2026-11-25）

范围 `29f2c05f1..a783c96bf`。Opus 子代理先审：7 条，都是建议级；报告 [`evidences/impl2-review-opus.txt`](evidences/impl2-review-opus.txt)。它实测了 2 万行规模的删除之后库文件、WAL 与空闲页里都找不到被删的编号，备份成功路径没有残留，停止先后改回去时用例会失败。omp（`@review`）同时在后台审同一范围，回来后另行处理。七条都改，一个修正提交：

| 条 | 发现 | 处理 |
|---|---|---|
| 1 | 备份副本的连接没开 `secure_delete`，准备副本出错时清空只是逻辑删除，`.partial` 里还找得到上报编号（实测 4135 处；入口会当场删掉 `.partial`，残留只在删之前） | 改。准备副本一开始就对副本连接开 `secure_delete`。包内用例：让聚合出错，准备完之后副本文件里找不到编号 |
| 2 | `purge` 的“先聚合”循环先读库、后查“正在关闭”，第二次信号强制停止时会读已关的库，在 `site.stopped` 之后多一行 `job.failed` | 改。与 `aggregate` 一样先查再读 |
| 3 | `purge` 对 `close()` 的响应没有用例：删掉两处“正在关闭就收手”，用例全过 | 改。补用例：积压很多时置“正在关闭”，`purge` 在下一批之前收手、不再删 |
| 4 | “每日上报与立即事件各自 64 个版本”没有用例守着；用例里的 64 不是字面数 | 改。补用例：两种上报用不同的版本组，各自第 65 个才记 `other`；用例里写字面的 64 |
| 5 | `build-previous` 的两个开关按固定的文件路径判断，以后改名或挪目录时 C19 会一直静默跳过 | 改。按提交判断：基准提交包含引入写入口的提交（`29f2c05f1`）就算有写入口，包含引入两个任务的提交（`1cfe66478`）就算有任务（`git merge-base --is-ancestor`）；这两个提交随合并进入 master，哈希不变 |
| 6 | C19 第一组交给上一个版本的数据目录里没有本版本写过的聚合，上一个版本从没在别人写的聚合行上累加 | 改。本版本记入一份之后先经测试控制入口跑一次 `aggregate`，再交给上一个版本；上一个版本记入、聚合之后断言同一维度的计数是两份相加 |
| 7 | `aggregate` 任务里每日上报那一批一直出错时，立即事件也跟着停算 | 改。照 `purge` 的写法，两张表各自聚合、各自记错，一张出错不挡另一张，最后抛出记下的错误 |
