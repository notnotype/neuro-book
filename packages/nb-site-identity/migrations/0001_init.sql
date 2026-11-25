-- 账号模块的第一条迁移（docs/specs/site/accounts.md、admin.md；导入的去向 legacy-import.md）。发布后不改：表名、列名、约束、索引
-- 的改动一律写进 0002 起的新迁移。
--
-- 贯穿全文件的约定：
-- - 前四张表归 Better Auth（ADR 0060）：照库导出的原文逐字抄，原文与导出方法在 schema/better-auth-baseline.sql。只改一处：每张表的
--   "id" integer not null primary key 换成 "id" integer primary key autoincrement。不加 AUTOINCREMENT 时 SQLite 把刚删掉的最大 id
--   发给下一行：删掉最新的会话再登录，新会话拿到旧会话的 id（t08 第六轮探针）；账号 id “一经分配不变、不重用”（site.accounts 副作用
--   一节）也要靠它。库的列名、声明类型（含 date）、索引原样保留，不加 STRICT：库的 date 类型在 STRICT 下不合法，改了以后每次升级都要
--   多一层对照。src/db/schema.test.ts 核对“只差这一处”。
-- - 库的表里时间是库写的 ISO 8601 文本，布尔是 0 与 1。
-- - 本模块自己的表名带 identity_ 前缀，一律 STRICT（类型不对报 SQLITE_CONSTRAINT_DATATYPE，不悄悄存成别的类型），主键 AUTOINCREMENT
--   （同上：id 对外可见，用作翻页的锚点，不能重用）。时间列是到毫秒的 ISO 8601 UTC 文本，取自模块的 context.clock，不是库的时钟。
-- - 指向账号的引用都指向 "user"(id)，不写 ON DELETE：账号不能删除（site.accounts、site.admin 的非目标），误删由外键拒绝。
--   库自己的 session、account 表带的 on delete cascade 原样保留。
-- - t08 要的表（对外 OAuth 的客户端、授权码、令牌，上游账号的名字）用 0002 起的迁移另建；本文件的表不引用它们。
--   库的 generateId 是 "serial"（全库的设置），库在这种设置下关掉了靠主键判重的单次使用检查；t08 要提供 private_key_jwt 或 DPoP 时，
--   先把相关的表换成字符串主键（计划设计审查处理表第 11 条）。

-- 库的账号表。id 是账号 id（对外的数字 id）；name 是显示名；email 存小写；emailVerified 本 Task 恒为 0；image 是头像；
-- username 是小写的登录名、displayUsername 存原样（只存不对外）；role 是 user 或 admin；banned 是 0 或 1，banReason、banExpires 不用。
-- 为导入留的：id 由导入显式写入，之后新账号接着往上发（site.legacy-import 去向表“用户的 id … 原样”）；createdAt 原样。
create table "user" ("id" integer primary key autoincrement, "name" text not null, "email" text not null unique, "emailVerified" integer not null, "image" text, "createdAt" date not null, "updatedAt" date not null, "username" text unique, "displayUsername" text, "role" text, "banned" integer, "banReason" text, "banExpires" date);

-- 库的会话表。库建、库读；不存来源地址（ipAddress 恒为空），userAgent 只存浏览器名与系统名的概要（site.accounts 副作用一节）。
-- 会话不导入（ADR 0060 后果：会话可以丢）。
create table "session" ("id" integer primary key autoincrement, "expiresAt" date not null, "token" text not null unique, "createdAt" date not null, "updatedAt" date not null, "ipAddress" text, "userAgent" text, "userId" integer not null references "user" ("id") on delete cascade, "impersonatedBy" text);

-- 库的登录方式表。密码账号一行 providerId = 'credential'、password 是哈希；t08 的上游身份也在这张表。
-- 为导入留的：password 可以是旧站的格式（site.legacy-import 去向表“密码哈希 原样”，site.accounts 输出 21）。
create table "account" ("id" integer primary key autoincrement, "accountId" text not null, "providerId" text not null, "userId" integer not null references "user" ("id") on delete cascade, "accessToken" text, "refreshToken" text, "idToken" text, "accessTokenExpiresAt" date, "refreshTokenExpiresAt" date, "scope" text, "password" text, "createdAt" date not null, "updatedAt" date not null);

-- 库的一次性凭据表。本 Task 不用；t08 的社交流程状态放这里，不导入。
create table "verification" ("id" integer primary key autoincrement, "identifier" text not null, "value" text not null, "expiresAt" date not null, "createdAt" date not null, "updatedAt" date not null);

create index "session_userId_idx" on "session" ("userId");

create index "account_userId_idx" on "account" ("userId");

create index "verification_identifier_idx" on "verification" ("identifier");

-- 注册码（site.admin 的发放、列表、改备注与停用；site.accounts 输出 1 到 3 的扣减）。
-- 码存原文：管理列表要显示码（site.accounts 副作用一节）。max_uses 为空是不限次数；used_count 由注册事务里的条件扣减加 1，
-- “还能不能用”在扣减的条件里判（停用、过期、用完），不做成一列。disabled_at 为空是没停用；expires_at 为空是不过期。
-- created_by 为空是命令行发的，或导入时找不到创建者。
-- 为导入留的：码、可用次数、已用次数、过期时间、是否停用、备注、创建者原样（site.legacy-import 去向表）。旧码若违反这里的约束
-- （例如 max_uses = 0），由导入的预检定规则，不在导入中途失败。
CREATE TABLE identity_registration_code (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    code TEXT NOT NULL UNIQUE,
    max_uses INTEGER CHECK (max_uses IS NULL OR max_uses > 0),
    used_count INTEGER NOT NULL DEFAULT 0 CHECK (used_count >= 0),
    expires_at TEXT,
    disabled_at TEXT,
    note TEXT,
    created_by INTEGER REFERENCES "user" (id),
    created_at TEXT NOT NULL
) STRICT;
-- 管理列表按建立时间倒序翻页。
CREATE INDEX identity_registration_code_created ON identity_registration_code (created_at, id);

-- 邀请码（site.accounts 输出 18；注册时的邀请归属，输出 1 与 3）。列的含义同注册码。
-- 新生成的码 max_uses、expires_at 都为空（不限次数、不过期），owner_id 由生成的代码保证非空。
-- 为导入留的：owner_id 可空（旧码可能没有主人）、note 可空（旧码可能有备注），其余同注册码（site.legacy-import 去向表）。
CREATE TABLE identity_invite_code (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    code TEXT NOT NULL UNIQUE,
    owner_id INTEGER REFERENCES "user" (id),
    max_uses INTEGER CHECK (max_uses IS NULL OR max_uses > 0),
    used_count INTEGER NOT NULL DEFAULT 0 CHECK (used_count >= 0),
    expires_at TEXT,
    disabled_at TEXT,
    note TEXT,
    created_at TEXT NOT NULL
) STRICT;
-- 用户看自己的码、数“同时有效的至多 10 个”。
CREATE INDEX identity_invite_code_owner ON identity_invite_code (owner_id, id);
-- 管理员看邀请码的使用（site.admin）。
CREATE INDEX identity_invite_code_created ON identity_invite_code (created_at, id);

-- 账号的补充资料，每个账号一行，与 "user" 同一个事务写。网站与签名不放进库的 user 表：用库的 additionalFields 会让库的结构检查与
-- 类型都跟着变。email_pending 是“邮箱待补”（占位邮箱的账号，site.accounts 输出 4、8）。last_login_at 是最近一次登录成功的时间
-- （site.admin 的账号列表）。三个来源列记“用哪个码注册、谁邀请的”（site.accounts 输出 1）。
-- 为导入留的：email_pending 由导入置 1；last_login_at 原样；三个来源列原样（site.legacy-import 去向表“最后登录时间”“用户用了哪个
-- 注册码、是谁邀请的”）。
CREATE TABLE identity_profile (
    user_id INTEGER PRIMARY KEY REFERENCES "user" (id),
    website TEXT,
    bio TEXT,
    email_pending INTEGER NOT NULL DEFAULT 0 CHECK (email_pending IN (0, 1)),
    last_login_at TEXT,
    registration_code_id INTEGER REFERENCES identity_registration_code (id),
    invite_code_id INTEGER REFERENCES identity_invite_code (id),
    inviter_id INTEGER REFERENCES "user" (id)
) STRICT;

-- 同意记录（site.accounts 输出 1 与 10）。只追加：账号当前的同意是同一 user_id 下 id 最大的一行。terms_version 形如 2026-11-20
-- （是不是真实存在的日期由配置校验与请求校验管，这里只挡住形状不对的写入）。导入的账号没有同意记录，受同意门槛约束
-- （site.legacy-import 输出 4）。
CREATE TABLE identity_consent (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES "user" (id),
    terms_version TEXT NOT NULL CHECK (terms_version GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
    overseas_storage INTEGER NOT NULL CHECK (overseas_storage IN (0, 1)),
    created_at TEXT NOT NULL
) STRICT;
CREATE INDEX identity_consent_user ON identity_consent (user_id, id);

-- 管理操作的审计（site.admin 输出 8、副作用一节）。actor_id 为空是命令行；action 是 site.admin 列出的动作名，target_type 是对象的种类
-- （user、registration_code，t08 加 oauth_client）。两者不在这里用 CHECK 列举：加动作要改表，取值由合同包的枚举与写入函数守。
-- params 是动作的参数，一个 JSON 对象；不放密码、哈希、码与备注（site.admin 输出 8）。
-- 不能改、不能删（site.admin 目标一节）：两个触发器拒绝 UPDATE 与 DELETE。RAISE 的说明是固定文字（迁移运行器的规则）。
CREATE TABLE identity_audit (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    created_at TEXT NOT NULL,
    actor_id INTEGER REFERENCES "user" (id),
    action TEXT NOT NULL,
    target_type TEXT NOT NULL,
    target_id INTEGER NOT NULL,
    params TEXT NOT NULL DEFAULT '{}' CHECK (CASE WHEN json_valid(params) THEN json_type(params) = 'object' ELSE 0 END)
) STRICT;
-- 审计列表的三种筛选（site.admin 的 GET audit：按操作者、按对象、按动作），各自按 id 翻页。
CREATE INDEX identity_audit_actor ON identity_audit (actor_id, id);
CREATE INDEX identity_audit_target ON identity_audit (target_type, target_id, id);
CREATE INDEX identity_audit_action ON identity_audit (action, id);
CREATE TRIGGER identity_audit_no_update BEFORE UPDATE ON identity_audit BEGIN SELECT RAISE(ABORT, 'identity_audit is append-only'); END;
CREATE TRIGGER identity_audit_no_delete BEFORE DELETE ON identity_audit BEGIN SELECT RAISE(ABORT, 'identity_audit is append-only'); END;
