-- 账号模块的第三条迁移：社交登录、注册与关联（docs/specs/site/accounts.md 输出 11 到 16、23、24）自家的两张表。
-- 发布后不改（发布之前，t08 第 10 片之后的审查定稿前可改）。genericOAuth 不加库的表：上游身份在库的 account 表，
-- 库的 state 在 verification 表（0001）。
--
-- 沿用 0001 文件头的约定：表名带 identity_ 前缀、STRICT、主键 AUTOINCREMENT；时间列是模块时钟的到毫秒的 ISO 8601 UTC 文本；
-- 指向账号的外键不写 ON DELETE（账号不能删除，误删由外键拒绝）。

-- 上游账号的名字与关联时间（site.accounts 输出 24：只给本人认出关联的是哪个账号，之后不随上游更新）。和库的 account 行按
-- (providerId, accountId) = (provider, upstream_account_id) 对上；不往库的 account 表加列（t07 定）。
-- 两个 UNIQUE 是“一个账号在一个上游至多一个身份”“一个上游身份只属于一个账号”的判据（src/social/upstream-name.ts）：库的 account
-- 行在关联钩子提交之后才插，两个并发的关联都看不到对方的 account 行，只有这张表在钩子的写事务里看得到。
-- name 至多 200 个字符，写入前截断。
-- 每个上游身份（库的 account 行）都要有这里的一行：身份列表遇到没有名字的身份当作程序错误（src/social/identities.ts）。导入旧站的
-- GitHub 身份时一并写它：name 取旧站的 GitHub 用户名，linked_at 取导入时刻（docs/specs/site/legacy-import.md 的去向表“GitHub 身份”一行）。
CREATE TABLE identity_upstream_name (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES "user" (id),
    provider TEXT NOT NULL CHECK (provider IN ('google', 'github')),
    upstream_account_id TEXT NOT NULL,
    name TEXT NOT NULL,
    linked_at TEXT NOT NULL,
    CONSTRAINT identity_upstream_name_identity UNIQUE (provider, upstream_account_id),
    CONSTRAINT identity_upstream_name_one_per_provider UNIQUE (user_id, provider)
) STRICT;

-- 一次社交流程（site.accounts 时序一节：10 分钟、只能用一次）。state 是库给的 state，回调按它认领：认领是一条带条件的 UPDATE，
-- 并发的回调至多一个改得到（src/social/flow.ts）。payload 是 JSON（继续地址、注册的内容），不含密码。
-- session_id 是关联意图发起时的会话，回调与关联钩子按它复核会话；不写外键：会话会被结束、删掉，流程行照样留到清理。
-- used_at 为空是还没被回调认领。
CREATE TABLE identity_social_flow (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    state TEXT NOT NULL UNIQUE,
    intent TEXT NOT NULL CHECK (intent IN ('login', 'register', 'link')),
    provider TEXT NOT NULL CHECK (provider IN ('google', 'github')),
    payload TEXT NOT NULL,
    session_id INTEGER,
    created_at TEXT NOT NULL,
    used_at TEXT
) STRICT;
-- 清理任务删 10 分钟之前的流程（计划 3.11）。
CREATE INDEX identity_social_flow_created ON identity_social_flow (created_at);
