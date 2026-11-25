-- 统计模块的第一条迁移（docs/specs/site/telemetry-ingest.md；协议 docs/specs/telemetry/protocol.md）。
--
-- 贯穿全文件的约定：
-- - 日期都是整数：server_day 是 UTC 1970-01-01 起的天数（服务端日），segment 是 UTC 15 分钟段的序号（心跳段），
--   都由服务端的时钟算出（site.telemetry-ingest 输出 2）。
-- - 所有表 STRICT：类型不对报 SQLITE_CONSTRAINT_DATATYPE，不会悄悄存成别的类型。
-- - 清单版本：原始表存两个版本，发送方声明的（*_declared）与服务端实际按它校验、记入的（生效的，协议输出 5）。
--   聚合只按生效的版本分开存（site.telemetry-ingest 输出 6），列名写明是哪一档的版本。
-- - 原始上报（两张 *_raw 表）不进备份、记入满保留天数后按 server_day 整天删除（输出 3、副作用一节）；
--   聚合与心跳长期保留（输出 7）。删除与聚合的写法在模块的源码里，这里只定形状。
-- - 聚合表的 app_version 可以是 other：每个服务端日（心跳是每个心跳段）至多 64 个不同的应用版本，之后新出现的记成
--   other（输出 11）。语义化版本的写法里不会出现 other，所以不会和真实的版本混在一起。

-- 原始的每日上报（协议 POST /v1/daily）。
-- id 用 AUTOINCREMENT：备份副本清空本表之后 sqlite_sequence 还在，用副本恢复后新行的编号接着往上，聚合游标不会落在
-- 新行之后。INSERT … ON CONFLICT DO NOTHING 被冲突挡下的那次也消耗编号，所以编号有空号，读的一方不能假定编号连续。
-- report_id 的唯一约束就是重发去重（协议输出 2）：去重窗口因此持续到这一行被删除，保留天数不小于 2 时总长于 48 小时。
-- 与立即事件的编号各自去重，互不相干（协议 POST /v1/event）。
-- days_since_last：first 记 0，1 到 28 记原值，more 记 29（清单第 1 版的取值，协议字段表）。
-- usage_enabled：0 或 1。
-- 使用段（usage_*）：只有服务端真的记下了这一份的使用段时才有，与 manifest_usage（使用档的生效版本）同在同不在，
-- 由下面的 CHECK 约束守住。没带使用段、或使用档版本比服务端新而整段被丢弃（协议输出 5）时四列都为空，
-- manifest_usage_declared 照记发送方声明的版本。usage_errors 是 JSON 数组 [[owner, code, 次数分档], …]，可以是空数组。
CREATE TABLE telemetry_daily_raw (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    report_id TEXT NOT NULL UNIQUE,
    server_day INTEGER NOT NULL,
    manifest_anonymous_declared INTEGER NOT NULL,
    manifest_anonymous INTEGER NOT NULL,
    manifest_usage_declared INTEGER,
    manifest_usage INTEGER,
    app_version TEXT NOT NULL,
    channel TEXT NOT NULL,
    form TEXT NOT NULL,
    os_version TEXT NOT NULL,
    arch TEXT NOT NULL,
    locale TEXT NOT NULL,
    region TEXT NOT NULL,
    days_since_last INTEGER NOT NULL,
    install_week TEXT NOT NULL,
    usage_enabled INTEGER NOT NULL CHECK (usage_enabled IN (0, 1)),
    notice_seen TEXT NOT NULL,
    usage_errors TEXT,
    usage_crashes TEXT,
    usage_upgrade TEXT,
    CHECK (
        (manifest_usage IS NULL) = (usage_errors IS NULL)
        AND (manifest_usage IS NULL) = (usage_crashes IS NULL)
        AND (manifest_usage IS NULL) = (usage_upgrade IS NULL)
    )
) STRICT;
CREATE INDEX telemetry_daily_raw_server_day ON telemetry_daily_raw (server_day);

-- 原始的立即事件（协议 POST /v1/event）。立即事件属于使用档：manifest_usage 必有，种类与码按它校验；使用档版本比服务端
-- 新时按服务端认识的最新版本记入，不丢弃整条，所以生效版本不为空。code 可省，省略时为空（NULL）。
-- id、report_id 的约定同 telemetry_daily_raw。
CREATE TABLE telemetry_event_raw (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    report_id TEXT NOT NULL UNIQUE,
    server_day INTEGER NOT NULL,
    manifest_anonymous_declared INTEGER NOT NULL,
    manifest_anonymous INTEGER NOT NULL,
    manifest_usage_declared INTEGER NOT NULL,
    manifest_usage INTEGER NOT NULL,
    app_version TEXT NOT NULL,
    form TEXT NOT NULL,
    kind TEXT NOT NULL,
    code TEXT
) STRICT;
CREATE INDEX telemetry_event_raw_server_day ON telemetry_event_raw (server_day);

-- 聚合处理到了哪一行：source 是 daily 或 event，last_id 是这一张原始表里已经算进聚合的最后一行的 id。
-- 只记“最后一行”，不记一批的大小：编号有空号，一批的上界取实际选出的最后一行。迁移时两行都从 0 起。
CREATE TABLE telemetry_aggregate_cursor (
    source TEXT PRIMARY KEY,
    last_id INTEGER NOT NULL
) STRICT, WITHOUT ROWID;
INSERT INTO telemetry_aggregate_cursor (source, last_id) VALUES ('daily', 0), ('event', 0);

-- 以下是长期保留的聚合（site.telemetry-ingest 输出 5、6、7）。主键把日期放第一列：读的一方都按日期范围查。

-- 每日上报按单个维度的份数（输出 5 的“按服务端日的份数，以及与版本、渠道……各自交叉的份数”）。
-- dimension 是 total（value 为空串）、app_version、channel、form、os_version、arch、locale、region、usage_enabled、
-- notice_seen；value 是这一维的取值的文字形式。某天有 total 而某个取值没有行时，这个取值的份数是 0。
CREATE TABLE telemetry_daily_count (
    server_day INTEGER NOT NULL,
    manifest_anonymous INTEGER NOT NULL,
    dimension TEXT NOT NULL,
    value TEXT NOT NULL,
    reports INTEGER NOT NULL,
    PRIMARY KEY (server_day, manifest_anonymous, dimension, value)
) STRICT, WITHOUT ROWID;

-- 按 daysSinceLast 的份数（输出 5 的“活跃数与新增用”），不带安装周。days_since_last 的编码同 telemetry_daily_raw。
CREATE TABLE telemetry_daily_activity (
    server_day INTEGER NOT NULL,
    manifest_anonymous INTEGER NOT NULL,
    days_since_last INTEGER NOT NULL,
    reports INTEGER NOT NULL,
    PRIMARY KEY (server_day, manifest_anonymous, days_since_last)
) STRICT, WITHOUT ROWID;

-- 安装周与 daysSinceLast 的交叉（输出 5 的“留存用”）。这里的 days_since_last 只有九档：first 记 0，1 到 7 记原值，
-- 其余（8 到 28 与 more）合成一档记 8。按天长期保留的交叉若带着确切的天数，就能按安装周把同一个安装的上报日
-- 一天天连起来；留存只用到 7 天之内的天数（输出 5）。这一条与清单版本无关，所以写成约束。
CREATE TABLE telemetry_daily_cohort (
    server_day INTEGER NOT NULL,
    manifest_anonymous INTEGER NOT NULL,
    install_week TEXT NOT NULL,
    days_since_last INTEGER NOT NULL CHECK (days_since_last BETWEEN 0 AND 8),
    reports INTEGER NOT NULL,
    PRIMARY KEY (server_day, manifest_anonymous, install_week, days_since_last)
) STRICT, WITHOUT ROWID;

-- 带使用段的每日上报（输出 5 的“使用档按服务端日、应用版本……的份数与分档分布”）：dimension 是 reports（value 为空串，
-- 带使用段的份数）、crashes、upgrade；manifest_usage 是使用档的生效版本。
CREATE TABLE telemetry_usage_count (
    server_day INTEGER NOT NULL,
    manifest_usage INTEGER NOT NULL,
    app_version TEXT NOT NULL,
    dimension TEXT NOT NULL,
    value TEXT NOT NULL,
    reports INTEGER NOT NULL,
    PRIMARY KEY (server_day, manifest_usage, app_version, dimension, value)
) STRICT, WITHOUT ROWID;

-- 使用段里按错误的份数与次数分档：一格是 owner 与 code 一对加一个分档（协议的 usage 表：同一对在一份里至多出现一次，
-- 所以 reports 就是份数）。
CREATE TABLE telemetry_usage_error (
    server_day INTEGER NOT NULL,
    manifest_usage INTEGER NOT NULL,
    app_version TEXT NOT NULL,
    owner TEXT NOT NULL,
    code TEXT NOT NULL,
    count_bucket TEXT NOT NULL,
    reports INTEGER NOT NULL,
    PRIMARY KEY (server_day, manifest_usage, app_version, owner, code, count_bucket)
) STRICT, WITHOUT ROWID;

-- 立即事件的条数（输出 5 的“立即事件按服务端日、应用版本、运行形态、种类与错误码的条数”）。主键的列不能为空，
-- 所以省略了 code 的事件在这里记空串（原始表里是 NULL）。
CREATE TABLE telemetry_event_count (
    server_day INTEGER NOT NULL,
    manifest_usage INTEGER NOT NULL,
    app_version TEXT NOT NULL,
    form TEXT NOT NULL,
    kind TEXT NOT NULL,
    code TEXT NOT NULL,
    events INTEGER NOT NULL,
    PRIMARY KEY (server_day, manifest_usage, app_version, form, kind, code)
) STRICT, WITHOUT ROWID;

-- 心跳只累加，不留单条（输出 4）：一次心跳让它所在的段、清单版本、应用版本与运行形态这一格加一。
CREATE TABLE telemetry_heartbeat (
    segment INTEGER NOT NULL,
    manifest_anonymous INTEGER NOT NULL,
    app_version TEXT NOT NULL,
    form TEXT NOT NULL,
    beats INTEGER NOT NULL,
    PRIMARY KEY (segment, manifest_anonymous, app_version, form)
) STRICT, WITHOUT ROWID;
