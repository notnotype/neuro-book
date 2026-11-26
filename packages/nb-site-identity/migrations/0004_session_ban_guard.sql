-- 账号模块的第四条迁移：被封禁的账号插不进会话（docs/specs/site/admin.md 输出 2：封禁后已有会话全部失效、解封后要重新登录）。
-- 发布后不改。
--
-- 为什么在库表上加触发器：社交回调里会话由库自己建，库的 admin 插件先查一次 banned、再插会话，两步是两次独立的取锁。封禁的写事务
-- （改 banned、删光会话）能落在两步之间，之后插进来的会话就留到解封、那枚 Cookie 解封后直接生效（omp 实现审查第 1 条）。触发器
-- 与插入是同一条语句：封禁提交在前，插入被拒；插入提交在前，封禁把它删掉，任何先后下封禁提交之后都没有这个账号的会话。密码登录、
-- 密码注册在模块自己的写事务里复核再发会话，本来就排在封禁前后，这里对它们是第二道。
--
-- 封禁的条件与管理接口、admin 插件、登录复核相同：只看 banned = 1。banExpires 恒为空（0001 的约定，src/admin/users.ts 文件头），
-- 不看它：触发器拿不到模块的时钟，按它判到期只能用 SQLite 的系统时间。
--
-- 被拒时 SQLite 报 SQLITE_CONSTRAINT_TRIGGER，模块按这个扩展码认（src/db/connection.ts 的 isBannedSessionInsert），不看说明文字；
-- 所以 session 表上只能有这一个触发器（src/db/schema.test.ts 核对）。0003 还没发布、本可以改，另起一条是因为它守的是所有建会话
-- 的路，不只社交的两张表。
CREATE TRIGGER identity_session_not_banned BEFORE INSERT ON "session"
WHEN EXISTS (SELECT 1 FROM "user" WHERE "id" = NEW."userId" AND "banned" = 1)
BEGIN SELECT RAISE(ABORT, 'session for a banned account'); END;
