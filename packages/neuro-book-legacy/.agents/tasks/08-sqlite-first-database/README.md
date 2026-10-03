# SQLite-first Database Runtime

> Active task directory format: `NN-kebab-case-name/`. Archived tasks move to `docs/tasks/archived/<task-slug>/`.

## Current Truth / Superseded Notes

本任务早期记录了“SQLite + Postgres 双库支持”的设计讨论；这部分已经过期。当前真实状态是 SQLite-only：PostgreSQL schema、adapter、pool、部署选项和 compose override 已移除，旧 PostgreSQL 数据不提供内置迁移。

部署默认入口也已从 Docker 优先调整为“本机 + Git” `local-git`：脚本执行 git clone/pull、宿主机依赖安装、Nuxt build、SQLite migrate，生成 `.deploy/start-local-git.*` 和 `.deploy/create-admin-local-git.*`，然后打印启动命令退出。旧 `native` 参数仅作为兼容别名保留，`ghcr` / `source` 是高级 Docker 模式。

## User Request

- 考虑把本项目当前 PostgreSQL 数据库迁移到更便于分发、打包的数据库。
- 同时允许用户自由选择数据库。
- 已确认第一版方向：
    - 默认数据库使用 SQLite 文件库。
    - 第一版正式支持 SQLite + Postgres，不承诺任意数据库。
    - 旧 Postgres 数据不做自动迁移；新安装默认 fresh start。
- 本轮先把计划写入 active task walkthrough，并用 `$grill-with-docs` 继续追问关键设计问题。

## Goal

- 新安装、单机分发和打包场景默认不需要独立数据库服务。
- SQLite 数据文件应落在 Workspace Root `.nbook` 下，例如 `workspace/.nbook/neuro-book.sqlite`，便于和用户运行数据一起备份。
- Postgres 仍作为显式可选数据库，用于已有部署、服务器部署或更强并发场景。
- 数据库选择属于启动/部署期配置，不能做成设置页里随手热切换的运行时偏好。
- 保持业务代码尽量通过 Prisma / repository 调用，不把 SQLite/Postgres 方言泄漏到普通 API 和 UI。

## Current State

- 当前 `prisma/schema.prisma` 的 datasource 写死 `provider = "postgresql"`，`prisma/migrations/migration_lock.toml` 也锁定 PostgreSQL。
- 当前运行时 `server/utils/prisma.ts` 使用 `@prisma/adapter-pg` 和 `DATABASE_URL` 创建 PrismaClient。
- 当前 Agent SQL 工具使用 `pg` 连接池、Postgres `information_schema`、事务语法和 statement timeout。
- `server/utils/auth.ts` 和 `server/plot/repositories/prisma-plot-data.repository.ts` 使用 `pg_advisory_xact_lock` 做并发保护。
- `StoryThread.tags` 是 Prisma scalar list：`String[]`。Prisma 文档说明 scalar list 主要适用于 PostgreSQL/CockroachDB，因此 SQLite 路线必须改掉这个字段形状。
- Docker Compose 和部署 CLI 默认围绕 `app + postgres`，只支持内置 Postgres 或外部 Postgres。
- Config 系统已把 Boot Config、Global Config、Project Config 分开；`database.url` 当前是 Boot Config 示例字段，真正运行路径仍主要依赖 `.env` 的 `DATABASE_URL`。

## Decisions

- **Database Kind**：第一版只定义 `sqlite` 与 `postgres`。
- **Default**：缺省为 `sqlite`，数据库文件默认在 `workspace/.nbook/neuro-book.sqlite`。
- **Compatibility**：Postgres 继续保留，但用户必须显式选择；已有部署不被自动迁到 SQLite。
- **Migration**：不提供 Postgres -> SQLite 自动导入脚本；需要时后续另立任务。
- **Runtime Switching**：数据库选择需要重启服务并跑对应 migrate/generate，不做热切换。
- **SQLite Data File**：SQLite 文件固定放在 Workspace Root `.nbook`，默认路径为 `workspace/.nbook/neuro-book.sqlite`。
- **Postgres Support**：Postgres 作为长期一等支持保留，不只是迁移期兼容；但默认分发体验以 SQLite 为准。
- **Deployment Migration Notice**：部署 CLI 在选择 SQLite 且发现旧 Postgres 配置痕迹时，只提示“不会自动迁移旧数据”，不执行导入流程。
- **Agent SQL Tool**：`execute_sql` 支持 SQLite 与 Postgres 双数据库 adapter；工具 description、schema summary 和错误提示必须根据当前 Database Kind 动态生成。
- **SQLite SQL Writes**：SQLite 下 `execute_sql` 也允许受限写入，与 Postgres 一样只允许 `SELECT` / `WITH` / `INSERT` / `UPDATE` / `DELETE`，禁止 DDL、事务控制、session control 和多语句。
- **Portable Field Shape**：`StoryThread.tags` 从 Postgres-only `String[]` 改为数据库 `String` 字段，内容为 JSON array 文本；repository 对外继续映射为 DTO 使用的 `string[]`。
- **Prisma Organization**：接受 dual schema + generated facade。SQLite 与 Postgres 分别维护 schema/migrations/generated client，业务代码通过统一 database facade 导入 Prisma 类型和 client。
- **Database Config Source**：`.env` / 进程环境是实际执行真值源，`config.yaml` 是 Boot Config 镜像与说明层，不覆盖 `.env`。
- **Boot Config Env Template**：`config.yaml` 允许用现有 `${NAME}` / `${NAME:-default}` 语法引用环境变量，便于展示当前部署意图；展开结果只用于诊断和文档化，不改变 Prisma migrate 或 app runtime 使用的 env。
- **Dev Default**：本地开发在没有 `.env` 时也默认 SQLite，保持开发体验和分发体验一致。
- **Config Guard**：database kind 与 URL 不匹配、Postgres 缺 URL 等配置错误必须 hard stop，不做静默猜测。

## Implementation Plan

1. 新增数据库配置解析层
    - 新增 `server/database/config.ts`，解析 `DATABASE_KIND` / `DATABASE_URL`，并读取 Boot Config 作为诊断镜像。
    - 缺省返回 SQLite：`file:./workspace/.nbook/neuro-book.sqlite`。
    - 无 `.env` 的本地开发也走 SQLite 默认值。
    - `config.yaml` 的 `database.kind` / `database.url` 可使用 `${DATABASE_KIND:-sqlite}` / `${DATABASE_URL:-file:...}` 这类环境变量模板，但不覆盖进程 env。
    - 启动前确保 `workspace/.nbook/` 存在。
    - 非法组合直接 hard stop，例如 `DATABASE_KIND=sqlite` 但 URL 是 `postgresql://...`。

2. 拆分 Prisma schema 与生成入口
    - 新增 `prisma/schema.sqlite.prisma` 和 `prisma/schema.postgres.prisma`。
    - 分别维护 SQLite 与 Postgres migrations，避免单 schema 动态改 provider。
    - 保留统一 Prisma Client 导入 facade，避免业务代码到处判断当前数据库。
    - 业务层导入收敛到类似 `nbook/server/database/prisma` 的统一入口，不直接导入具体 generated client。
    - SQLite schema 移除 Postgres-only scalar list；Postgres schema 保持等价业务模型。
    - 迁移脚本按 `DATABASE_KIND` 选择 schema 执行。

3. 改造 Prisma client 工厂
    - `sqlite` 使用 `@prisma/adapter-libsql` + `@libsql/client`，以避开 Bun/Windows 下 better-sqlite3 原生安装风险。
    - `postgres` 继续使用 `@prisma/adapter-pg` + `pg`。
    - 开发和生产都使用进程级单例，避免每次调用创建新 client。
    - 错误信息从 `DATABASE_URL 未配置` 调整为带 database kind 的诊断信息。

4. 消除 Postgres 专有调用泄漏
    - 新增 `server/database/locks.ts`，提供 `runWithDatabaseLock()` 或等价接口。
    - Postgres adapter 内部使用 `pg_advisory_xact_lock`。
    - SQLite adapter 依赖事务写入串行化；必要时把剧情排序写入集中在 transaction 内。
    - 认证最后管理员保护和 Plot sortOrder bucket 保护都改走这个接口。

5. 处理 `StoryThread.tags`
    - DTO 和前端继续使用 `string[]`。
    - persistence 字段改为 JSON array 文本，不新增 `StoryThreadTag` join table。
    - repository 负责读写时归一化、过滤非字符串值，并保持现有 Plot UI 行为不变。

6. 调整 Agent SQL 工具
    - 当前实现依赖 `pg` pool、Postgres `information_schema`、Postgres transaction timeout 和大小写提示。
    - 新增 database-aware SQL adapter，至少包含 Postgres adapter 与 SQLite adapter。
    - 两个 adapter 共享安全边界：单条语句；只允许 `SELECT` / `WITH` / `INSERT` / `UPDATE` / `DELETE`；禁止 DDL、事务控制、session control 和多语句；保留查询行数上限。
    - Postgres adapter 继续使用 `pg` pool、`information_schema`、Postgres timeout、Postgres 错误码和双引号大小写提示。
    - SQLite adapter 使用 SQLite 连接、SQLite schema introspection、SQLite 事务/超时策略和 SQLite 错误提示，并允许同等安全边界内的受限写入。
    - `execute_sql` 的 tool description 必须按当前 Database Kind 动态生成，明确当前方言、引用规则、schema 摘要来源、限制和文件内容仍应使用 `read` / `write` / `edit` / `apply_patch`。
    - leader profile / SQL schema summary 注入必须跟随当前 Database Kind，避免默认 SQLite 安装继续携带 Postgres-only 心智。

7. 更新部署与启动
    - `docker-compose.yml` 默认只启动 app，并挂载 `workspace/`。
    - 新增或调整 Postgres override，例如 `docker-compose.postgres.yml`。
    - `scripts/docker-entrypoint.sh` 按 database kind 执行对应 migrate deploy。
    - 当时的旧部署 CLI 数据库选择改成：SQLite 文件库、内置 Postgres、外部 Postgres；默认 SQLite。
    - 部署 CLI 写 `.env` 作为实际运行配置，同时写 `config.yaml` 使用 `${DATABASE_KIND}` / `${DATABASE_URL}` 引用，避免两份文件出现独立真值。
    - `.env.docker.example` / `.env.example` / `config.example.yaml` 同步改成 SQLite-first。

8. 同步文档
    - 更新 `README.md`、`docs/operator-bridge.md`、`PROJECT-STATUS.md`。
    - 本文件持续记录执行过程、偏离计划的原因、验证结果和后续 TODO。

## Grill Focus

- 下一轮继续确认是否需要为本次数据库技术选择新增 ADR。

## Test Plan

- Database config resolver：
    - 缺省配置解析为 SQLite。
    - 显式 Postgres URL 解析为 Postgres。
    - kind/url 不匹配会 hard stop。
    - SQLite 相对路径解析到预期位置。
- Prisma/schema：
    - SQLite schema 可以 generate + migrate deploy。
    - Postgres schema 可以 generate + migrate deploy。
    - `StoryThread.tags` roundtrip 后 DTO 仍是 `string[]`。
- Core API：
    - SQLite fresh database 下可创建管理员、登录、创建小说、读取小说列表。
    - SQLite 下可创建/更新 Plot story、thread、scene、plot。
    - Postgres 下保留同一批核心 API 验证。
- Agent：
    - SQLite 下不初始化 `pg` pool。
    - SQLite 下 `execute_sql` 使用 SQLite adapter，description 不包含 Postgres-only 双引号提示。
    - Postgres 下 `execute_sql` 使用 Postgres adapter，description 保留现有 Postgres camelCase 双引号提示。
    - Postgres 下 SQL schema summary 和 `execute_sql` 现有安全边界继续通过。
- Deployment scripts：
    - 旧部署脚本语法检查（历史验证，入口已删除）
    - `node --check scripts/deploy.mjs`
    - SQLite 默认部署生成的 `.env` 不包含 Postgres 密码。
    - SQLite 默认部署生成的 `config.yaml` 通过 `${DATABASE_KIND}` / `${DATABASE_URL}` 引用 `.env`，不写第二份独立值。
    - Postgres 部署仍生成正确 compose 文件组合。

## Implementation Notes

- 已新增 `server/database/config.ts`、`server/database/prisma.ts`、`server/database/locks.ts`。
- 已新增 `prisma/schema.sqlite.prisma`、`prisma/schema.postgres.prisma`，原 Postgres migrations 移到 `prisma/migrations/postgres/`，SQLite fresh migrations 位于 `prisma/migrations/sqlite/`。
- 当前 Prisma 7.3 在本机 Windows 环境下执行 SQLite `migrate deploy` / `db push` 会出现无细节 `Schema engine error`，最小 SQLite schema 也可复现。因此 SQLite deploy 由 `scripts/sqlite-migrate.mjs` 使用 `@libsql/client` 执行受控 migrations；Postgres 仍使用 Prisma migrate。
- SQLite 和 Postgres 的 generated client 都输出到 `server/generated/prisma`，由 `DATABASE_KIND` + `DATABASE_URL` 在 `prisma.config.ts` 中选择 schema。生成物不进 Git。
- `execute_sql` 主路径 `server/agent/tools/sql-tool.ts` 已改为 SQLite/Postgres 双 adapter；v2 归档路径未纳入本轮改造。
- Review 修复：`server/database/config.ts`、`scripts/prisma-env.mjs`、`prisma.config.ts` 和 `server/utils/agent-sql-pool.ts` 已统一为 env first、Boot Config fallback、缺省 SQLite 的解析规则；`config.yaml` 中自定义 SQLite file URL 不再被默认路径覆盖。
- Review 修复：SQLite 锁不再是 no-op，新增内部 `DatabaseLock` 表；SQLite 下在事务内写入锁表来取得数据库写锁，保护 Plot sortOrder 和管理员状态检查这类 read-before-write 窗口。
- Review 修复：`scripts/prisma-env.mjs` 显式加载 `.env`，避免已有本地 Postgres dev 配置在 `bun run generate` / `bun run migrate:*` 时被误判为缺省 SQLite。

## References

- Prisma SQLite connector: https://www.prisma.io/docs/concepts/database-connectors/sqlite
- Prisma scalar lists: https://www.prisma.io/docs/orm/prisma-client/special-fields-and-types/working-with-scalar-lists-arrays
- Prisma database features matrix: https://www.prisma.io/docs/orm/reference/database-features

## Verification

- 已完成 SQLite/Postgres 双库运行时实现。
- 已确认：SQLite 文件固定放在 Workspace Root `.nbook`。
- 已确认：Postgres 作为长期一等支持保留。
- 已确认：部署 CLI 只提示旧 Postgres 数据不会自动迁移，不做导入流程。
- 已确认：`StoryThread.tags` 持久化改为 JSON array 文本，repository 映射为 `string[]`。
- 已确认：`execute_sql` 支持 SQLite 与 Postgres 双 adapter，description 跟随 Database Kind 动态变化。
- 已确认：SQLite 下 `execute_sql` 允许受限写入，不降级为只读工具。
- 已确认：接受 dual schema + generated facade 组织方式。
- 已确认：`.env` / 进程环境是数据库执行真值源，`config.yaml` 通过 `${}` 引用环境变量作为 Boot Config 镜像，不覆盖 `.env`。
- 已确认：本地开发无 `.env` 时默认 SQLite。
- 已确认：数据库 kind / URL 不匹配等配置错误 hard stop。
- 已验证：`bun test server/database/config.test.ts server/database/locks.test.ts server/utils/agent-sql-pool.test.ts server/agent/tools/sql-tool.test.ts server/plot/services/plot.service.test.ts server/utils/auth.test.ts` 通过，覆盖 Boot Config 自定义 SQLite URL、env 覆盖、SQLite/Postgres lock、SQL pool 和相关 Plot/auth 行为。
- 已验证：`node --check scripts/prisma-env.mjs`、`node --check prisma.config.ts`、`node --check scripts/prisma-generate.mjs`、`node --check scripts/prisma-migrate.mjs`、`node --check scripts/sqlite-migrate.mjs`、旧部署脚本和`node --check scripts/deploy.mjs`通过；旧部署入口现已删除。
- 已验证：临时 SQLite URL `file:./.agent/sqlite-review-fix/neuro-book.sqlite` 下 `bun run generate` 与 `bun run migrate:deploy` 通过，并应用 `20260524120000_init`、`20260524121000_add_database_locks`。
- 已验证：默认 `bun run generate` 会读取本地 `.env` 并继续使用当前 dev Postgres schema，未把现有 dev 配置切到 SQLite。
- 当前 `bunx tsc --noEmit --pretty false` 仍被无关 agent/profile 类型错误阻塞；本轮数据库相关文件未出现新的 typecheck 错误。

## TODO / Follow-ups

- 继续确认是否需要新增 ADR 记录 SQLite-first + dual schema 决策。
- Postgres 实库 migrate deploy 未在本机验证；需要可用 Postgres 后执行。
