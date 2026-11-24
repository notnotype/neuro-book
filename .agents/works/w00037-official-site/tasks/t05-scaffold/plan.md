# w00037 t05 脚手架：实施计划

路径按 worktree `.worktree/w00037-official-site`（分支 `feat/w00037-official-site`）写；Spec、ADR、Task 记录读主工作区的。文中“本机探针”是规划时在系统临时目录用 Bun 1.4.4 跑的一次性脚本，没进仓库。计划由 Opus 子代理起草，主会话 2026-11-24 审定，审定的结论在文末。

## 1. Context

为什么做：官方站重写（[提案](../../../../../docs/proposals/official-site-rewrite.md)，已接受）的第一个实现 Task。之后的统计写入（t06）、账号核心（t07）、社交登录与对外 OAuth（t08）、前端（t10）、旧站导入（t12）、部署（t13）都建在它上面。做完时有一个能部署、只有健康检查的空服务。

依据：
- 合同：`docs/specs/site/operations.md`（`site.operations`，planned）。本 Task 做输出 1 到 4、6 到 9 与状态表、失败表；输出 5（创建管理员）在 t07（t07 README 第 14 行）。
- ADR 0059（一个进程、七个包、依赖白名单、合同测试只经 HTTP）、ADR 0061（每个模块一个 SQLite 文件、WAL、纯 SQL 只往前的迁移、在线备份、合同测试每个文件一个临时目录）、ADR 0060（账号用 Better Auth；迁移要能装下它导出的表结构）。
- Task：`.agents/works/w00037-official-site/tasks/t05-scaffold/README.md` 第 20 行的范围：七个包与登记；启动、只迁移、备份三个命令与两个健康检查；每个模块的迁移；合同测试包能起真实进程、每个测试文件一个临时目录；依赖白名单测试与合同测试的导入守卫；测试文档登记新的一类；CI 里构建镜像。不含账号与统计的任何业务接口。

开发者已定（不再讨论）：一个 Bun 进程装账号与统计两个模块，以后能拆成两个进程；七个包 `nb-site-identity-contract`、`nb-site-identity`、`nb-site-telemetry-contract`、`nb-site-telemetry`、`nb-site-server`、`nb-site-contract-tests`、`nb-site-web`；Bun、TypeScript、Hono、`bun:sqlite`（每模块一个文件、WAL）；合同测试单独成包、起真实进程、只经 HTTP、只 import 合同包；代码在本仓库，前端用 nb-ui，`nb-site-web` 本 Task 只要骨架。

工作方式：主会话或编码子代理在 worktree 里按第 5 节切片实施，每片一个提交、自跑该片的验证命令。Spec 与 Task 记录的改动由主会话在主工作区 master 上做（第 4 节列出），先于第 3 片合入 master，worktree 读主工作区的那份。审查按全局规则：进程入口、迁移、跨进程锁属于“内核时序、数据格式、跨进程”一类，按快速审查（Opus 先审，omp `@review` 后台）；`nb-site-web` 骨架另派前端审查（Sonnet）。

## 2. 技术选型

| 问题 | 选用 | 理由 | 否决 |
|---|---|---|---|
| 命令行解析 | `commander` ^14.0.2 | 应用包与 nb-story 已在用（`packages/neuro-book/package.json`、`packages/nb-story/package.json`）；子命令、未知命令与用法说明现成 | `node:util` 的 `parseArgs`：没有子命令与帮助；`cac`、`citty`、`yargs`：只在旧依赖树里出现，工作区包没有直接用 |
| 配置校验 | 手写的字段表（每个环境变量一个解析函数，返回值或问题），用平台的 `URL`、`Number` | 输入全是字符串，要转成 URL、端口、网段并核对互相之间的关系（两个地址的主机不同）；错误说明只能带变量名、不能带值，自己控制最直接；约 100 行 | TypeBox：仓库在用，但环境变量要先逐个转换类型，`Value.Errors` 的错误对象带原值，要另包一层脱敏，省不下代码 |
| 可信代理的网段 | `node:net` 的 `isIP` 与 `BlockList.addSubnet` | 平台自带；本机探针：Bun 1.4.4 里 IPv4、IPv6 网段都能加、前缀越界时抛错，t07 判断对端用同一个对象的 `check` | `ipaddr.js`：工作区里只有旧应用的 express 间接带进 1.9.1；手写 CIDR 解析：IPv6 易错；Hono `ip-restriction` 的判断函数不是公开入口 |
| HTTP | Hono ^4.12.30（nb-host 与应用同版本），`hono/request-id` 中间件 | ADR 0059 已定；`requestId()` 生成编号、写响应头 `X-Request-Id`，只接受 `[\w\-=]{1,255}` 的入站编号（`node_modules/hono/dist/middleware/request-id/request-id.js`） | 复用 `nb-host`：它建在 nb-runtime 的插件与状态根认领上、只许监听回环，官方站不用内核 |
| 日志 | 手写约 30 行：`writeSync(1, JSON.stringify(行) + "\n")` | Spec 输出 8 只要每行一个 JSON；同步写保证退出前的最后几行不丢（nb-host 的致命通道同样用 `writeSync`，`packages/nb-host/src/server/start.ts` 第 13 行） | pino：工作区没有、带工作线程；`hono/logger`：输出纯文本 |
| 迁移运行器 | 手写约 120 行，`bun:sqlite` 的 `db.transaction(...).immediate()` 加 `db.exec(多条语句)` | 规则是 Spec 自己的：库里有不认识的更新迁移时照常运行（输出 4、7）、每条迁移一个事务、成功的保留（输出 2）。本机探针确认 `db.exec` 能执行多条语句，事务里某句出错时整条迁移回滚 | Kysely 的 `Migrator`：库里有清单之外的迁移时报 corrupted、迁移写成 TS 不是纯 SQL；umzug：多一个依赖、面向 JS 迁移；drizzle-kit：要 ORM 的 schema 与日志文件 |
| 迁移文件进产物 | `import sql from "../migrations/0001_x.sql" with {type: "text"}` | 本机探针：`bun build --target bun` 把 SQL 文字内联进产物，镜像里不用找迁移目录 | 运行时读目录：产物里要另带文件、按路径解析 |
| 数据目录的单写者锁 | `@notnotype/nb-flock` 的 `tryLock` | 不判旧、进程怎样结束都由系统放锁，正合“一个数据目录同一时间一个服务进程”；零依赖（`packages/nb-flock/README.md`） | `nb-file-lock`（按过期判旧，持有者暂停太久会被接管，ADR 0052）；SQLite 自身的锁：管不到两个库文件与备份目录 |
| 备份 | `VACUUM INTO ?`，只读连接 | `bun:sqlite` 没有在线备份接口（`node_modules/bun-types/sqlite.d.ts` 只有 `serialize`）；本机探针：另一个连接持写事务时 `VACUUM INTO` 照常写出一致副本、只读连接也能执行、副本 `integrity_check` 为 ok | `serialize()` 再写文件：整库进内存；拷文件：WAL 下拷不出一致快照 |
| 打镜像 | 在构建机上 `Bun.build`（`target: "bun"`）出单个 `server.js`，Dockerfile 只 `COPY` 产物 | 只带用到的代码，镜像里不跑 `bun install`；根 `package.json` 列着旧应用的整套依赖与 `postinstall`（第 45 行），在镜像里装工作区要逐个拷各包的 `package.json`（旧应用的 `packages/neuro-book-legacy/Dockerfile` 第 18 到 32 行就这样写，已经过时） | 多阶段 Dockerfile 里 `bun install --filter`：要拷全部 `packages/*/package.json` 与补丁，`postinstall` 要另外关掉，没有实测过 |
| 前端骨架 | Vue 3、Vite、`@vitejs/plugin-vue`、Tailwind 4、nb-ui，版本照 `packages/dev-panel/package.json` | 提案 4.7；dev-panel 的 `vite.config.ts` 已有 nb-ui 要的 `cssMinify: "esbuild"` | 无 |

## 3. 关键设计

### 3.1 七个包与仓库登记

共同写法照 `packages/nb-flock/package.json` 与 `packages/nb-host/package.json`：`"version": "0.1.0"`、`"private": true`、`"license": "AGPL-3.0-only"`、`"type": "module"`、Bun 侧的包写 `"engines": {"bun": ">=1.3.14"}`；`tsconfig.json` 照 `packages/nb-flock/tsconfig.json`（`types: ["bun"]`、`strict`、`include: ["src"]`，模块包另加 `types/`）；脚本 `test: "bun test"`、`typecheck: "tsc --noEmit"`；devDependencies `@notnotype/neuro-book-test-support`、`@types/bun` ^1.3.14、`typescript` ^6.0.3。每个包都给 `exports` 加 `"./package.json": "./package.json"`，让依赖白名单测试与合同测试经包名解析到清单，不按相对路径读兄弟包。

| 包 | exports | 运行时依赖 | 其它 |
|---|---|---|---|
| `@notnotype/nb-site-identity-contract` | `.` → `src/index.ts` | 无（第一个 schema 进来时加 `typebox`） | 导出路径前缀常量 `IDENTITY_API_PREFIX = "/api/identity/v1"` |
| `@notnotype/nb-site-telemetry-contract` | `.` → `src/index.ts` | 无（同上） | `TELEMETRY_API_PREFIX = "/api/telemetry/v1"` |
| `@notnotype/nb-site-identity` | `.` → `src/index.ts` | `@notnotype/nb-site-identity-contract`、`hono` | `migrations/`（本 Task 为空）、`types/sql.d.ts`（`declare module "*.sql"`） |
| `@notnotype/nb-site-telemetry` | `.` → `src/index.ts` | `@notnotype/nb-site-telemetry-contract`、`hono` | 同上 |
| `@notnotype/nb-site-server` | 只有 `./package.json` | 两个模块包、`@notnotype/nb-flock`、`hono`、`commander` | `bin: {"nb-site": "./src/main.ts"}`；`image/`（Dockerfile 与构建、冒烟脚本）；脚本 `build:image`、`smoke:image` |
| `@notnotype/nb-site-contract-tests` | 只有 `./package.json` | 两个合同包 | devDependencies 另加 `@notnotype/nb-site-server`（只为“被测进程的启动命令”与 `test:affected` 的依赖图） |
| `@notnotype/nb-site-web` | 只有 `./package.json` | `@notnotype/nb-ui`、`vue` | devDependencies 照 dev-panel 的前端那几项；脚本 `build`（`vite build`）、`test`、`typecheck`（`vue-tsc --noEmit`） |

每个包都要有 `test` 脚本与至少一个测试：`test:affected` 对没有 `test` 脚本的包整包跳过，连 `typecheck` 也不跑（`scripts/cli/test-affected.ts` 第 139 到 145 行），CI 就不会给它做类型检查。

每个包一个短的 `AGENTS.md`（必须引用 `../../AGENTS.md`，`scripts/ci/agent-governance-contract.ts` 第 441 到 448 行检查）：写本包的边界与完成门禁；全站共用的规则（包的依赖方向、迁移规则、怎样起服务、怎样跑合同测试）写在 `packages/nb-site-server/AGENTS.md`，其余六个链接它。

登记（照上一次建包时实际改过的地方：nb-flock 的 `dc4279c09` 与 `51749aa57`，nb-host 的 `5dbbef4e5` 与 `cddc4584c`，nb-time 的 `66d97e39e`）：

- 根 `package.json` 的 `workspaces`（第 9 到 39 行）在 `packages/nb-models` 之后加七项；`bun install` 更新 `bun.lock`。
- `scripts/ci/test-conventions.ts` 第 20 行的 `STRICT_TEST_ROOTS` 加一项 `"packages/nb-site-"`（按前缀匹配，覆盖七个包）：新包的测试写法违反即失败，与 nb-host、nb-models 一样。
- 根 `AGENTS.md` 的仓库结构（第 110 到 113 行那一段）加一行 `nb-site-*/`，写“官方站：账号与统计两个模块及各自的合同包、进程入口、合同测试、前端（w00037）”。根 `AGENTS.md` 有 220 行上限（`agent-governance-contract.ts` 第 11 行，现在 150 行），合成一行。
- `packages/AGENTS.md` 第 4 行的包清单加“w00037 新建的官方站七个包 `nb-site-*`（都是 `private`，见 ADR 0059）”。
- `docs/modules/monorepo-boundaries.md` 的“当前布局”表加一行“官方站”，写七个包的职责、依赖方向（第 3.9 节的白名单）与验证命令所在的 `AGENTS.md`。
- `docs/standards/code/README.md` 的路由表加一行：`packages/nb-site-server/image/Dockerfile` → `common.md`（表里没有 Dockerfile，文件末尾要求先更新路由再实现）。
- 不用改的（核对过）：治理检查与 `test:affected` 都按 `packages/` 下的目录自己发现新包（`agent-governance-contract.ts` 第 408 到 425 行、`scripts/ci/workspace-graph.ts` 第 22 到 31 行、`test-affected.ts` 第 191 到 201 行）；`scripts/release/packages.ts` 的发布清单是显式列表（第 18 到 29 行），私有包不进；根 README 的“参与开发”一节不列私有包（nb-host、nb-models 都没列）；`scripts/tsconfig.json` 只管根脚本。

### 3.2 `packages/nb-site-server/src/`：模块怎样交给进程入口

文件：`module.ts`（接口）、`modules.ts`（两个模块的适配器与 `SITE_MODULES`）、`cli.ts`（`runCli(argv, modules)`）、`main.ts`（只有 `await runCli(process.argv.slice(2), SITE_MODULES)`）、`site.ts`（装配根应用）、`commands/serve.ts`、`commands/migrate.ts`、`commands/backup.ts`、`config.ts`、`log.ts`、`lock.ts`、`db/open.ts`、`db/migrate.ts`、`health.ts`、`testing/`（只给本包测试的入口与测试模块）。

接口的形状（只在 nb-site-server 里定义；模块包不 import 它，见下面“为什么由入口做适配”）：

```ts
/** 一个模块交给进程入口的全部东西。name 也是库文件名与日志里的 module。 */
export interface SiteModule<C = unknown> {
    readonly name: string;                       // ^[a-z][a-z0-9]*$，例如 "identity"
    readonly migrations: readonly Migration[];   // 按编号递增，见 3.3
    /** 读本模块的环境变量；只报变量名与问题，不带值。 */
    parseConfig(env: Readonly<Record<string, string | undefined>>): ConfigResult<C>;
    /** 迁移全部成功之后、开始监听之前调用；db 只是本模块的连接。 */
    create(context: ModuleContext<C>): ModuleInstance;
    /** 备份命令写出副本之后在副本上调用，例如清空原始上报表（t06）；随后入口对副本再 VACUUM。备份命令不调用 create，这里不能依赖 create 建的状态。 */
    prepareBackupCopy?(copy: Database): void;
}
export interface Migration { readonly id: string; readonly sql: string }
export interface ModuleContext<C> { readonly db: Database; readonly config: C; readonly site: SiteSettings; readonly log: Logger }
export interface ModuleInstance {
    /** surface 决定挂在哪个主机上：site 是站点地址，ingest 是遥测写入口地址（3.5 的分派）。 */
    readonly mounts: readonly {readonly surface: "site" | "ingest"; readonly prefix: string; readonly app: Hono}[];
    /** 库探测之外、模块自己的就绪条件；缺省只看库。 */
    ready?(): boolean;
    /** 停止时在 HTTP 排空之后、关库之前调用：停掉定时任务（t06 的聚合）。 */
    close?(): Promise<void>;
}
```

为什么由入口做适配：模块包只能依赖自己的合同包与通用包（ADR 0059 决策 2），入口又依赖模块包，模块反过来 import 入口的类型就成了环。所以模块包只导出自己的东西（`identityMigrations`、`parseIdentityConfig`、`createIdentityModule(options)`，参数是模块自己声明的选项类型），`modules.ts` 里每个模块写一个几行的适配器把它们包成 `SiteModule`，用 `satisfies` 让类型检查核对。模块之间的依赖（t07 以后的“问身份”）也由适配器作为参数传进去：一个进程时传账号模块的处理函数，拆成两个进程时新入口传一个经 HTTP 调用的版本（ADR 0059 决策 5）。

拆成两个进程只改入口包：加 `main-telemetry.ts`、`main-identity.ts`，各自 `runCli(argv, [某一个模块])`；装配、迁移、健康检查、日志、锁、备份都按传入的模块列表工作，不写死两个模块。就绪检查列的是“本进程装的模块”。

`site.ts` 的根应用（Hono）中间件顺序：请求编号（`hono/request-id`）→ 请求日志（3.5）→ `/health/live`、`/health/ready`（不看主机，反向代理与容器的健康检查用回环地址来）→ 按主机分派到 `site` 或 `ingest` 的子应用 → 各 mount 用 `app.route(prefix, mount.app)` 挂上。未匹配回 404 `{"code":"not_found"}`；未捕获的异常记一行 `level: "error"` 的日志（带请求编号、错误类型，不带请求内容），回 500 `{"code":"internal"}`。

本 Task 里两个模块的 `mounts` 都是一个没有路由的子应用（挂在合同包的前缀下），`migrations` 为空。

### 3.3 迁移：`nb-site-server/src/db/` 与各模块的 `migrations/`

格式与编号：
- 每个模块的 `migrations/NNNN_<小写下划线名>.sql`，`NNNN` 是四位、模块内递增的编号，id 就是去掉 `.sql` 的文件名（例：`0001_init`）。编号按模块各自计，两个模块互不影响。
- 模块的 `src/migrations.ts` 用 `import x from "../migrations/0001_init.sql" with {type: "text"}` 逐个列出并按编号排好，导出 `readonly {id, sql}[]`。模块包自己的 `migrations.test.ts` 核对列表与目录里的文件一一对应（防止漏列），它同时是模块包的 smoke（入口可导入）。
- SQL 文件是纯 SQL，可以多条语句；不能写事务语句（`BEGIN`、`COMMIT`、`END`、`ROLLBACK`、`SAVEPOINT`、`RELEASE`）与 `PRAGMA`、`ATTACH`、`DETACH`、`VACUUM`：运行器给每条迁移包一个事务，这几类在事务里要么报错、要么不生效。运行器在执行任何迁移之前先校验整张列表（id 格式、编号严格递增、上面这些语句按“分号或行首后跟关键字”扫一遍），不合格当作程序错误，报 `migration_failed`。
- 容得下 Better Auth 导出的表结构：库的迁移工具能编译出 SQLite 的 `create table "user" (...)`、`create index ...` 这类多条语句（t03 的第三、四轮探针用的是 `getMigrations(...).runMigrations()`，`.agents/works/w00037-official-site/tasks/t03-architecture/evidences/better-auth-spike-3.txt` 第 146 行）；t07 把编译出的 SQL 存成 `0001_*.sql`，以后库升级照 ADR 0060 后果一节“重新导出、比对、手写增量”。本机探针确认带双引号标识符与多条语句的文件经 `db.exec` 执行、出错时整条回滚。

库里的账本：每个库一张 `site_migrations(id TEXT PRIMARY KEY, checksum TEXT NOT NULL, applied_at TEXT NOT NULL)`，运行器用 `CREATE TABLE IF NOT EXISTS` 建。它的形状以后不能改：上一个版本要读它（输出 7）。表名带 `site_` 前缀，避开 Better Auth 的表名。`checksum` 是 SQL 文字把 `\r\n` 换成 `\n` 之后的 SHA-256（Windows 检出可能带 CRLF，仓库的 `.gitattributes` 没有给 `.sql` 定换行）。

执行时机：`serve` 与 `migrate` 在校验配置、拿到数据目录锁之后，按模块列表的顺序逐个模块执行；`backup` 不执行迁移。

每个模块的执行规则（`runMigrations(db, module): MigrationOutcome`）：
1. 读账本。对列表里每一条：已执行且校验和相同，跳过；已执行但校验和不同，失败（“已执行过的迁移被改过”）。
2. 未执行的：若账本里有编号比它大的条目，失败（“缺口”：较新的版本跑过更后面的迁移，本条却没执行，不能乱序补）；否则在 `db.transaction(...).immediate()` 里执行 SQL 并写账本，提交后记一行日志 `{"event":"migration.applied","module","migration"}`。
3. 某条失败时这一条回滚，之前已提交的保留（输出 2），进程写 `migration_failed`（带模块名与迁移 id，不带 SQL 与路径）并以非零码退出；后面的模块不再执行。
4. 账本里有、列表里没有、编号比列表最大的还大的条目，是更新的版本留下的：照常运行（输出 4、7），记一行 `{"event":"migration.unknown_newer","module","migration"}`（`level: "warn"`）。

就绪检查用同一份判断：本模块列表里的每一条都在账本里，就算“迁移已执行”；账本里多出来的不影响。

相邻版本可互换（输出 7）怎样验证：
- 运行器自身的规则由 `db/migrate.test.ts` 用真实 SQLite 文件测：模拟“下一个版本”多出的迁移先执行，再用本版本的列表启动，照常运行、就绪。
- 真正的“上一个版本的程序接管”由合同测试包的 `adjacent-version.test.ts` 测：设了 `NB_SITE_PREVIOUS_SERVER_COMMAND` 时，先用本版本 `migrate`，再用上一个版本 `serve`，断言就绪 200；没设时整个 describe 用 `skipIf` 跳过。本 Task 用“上一个版本就是本版本”手工跑一次证明测试本身能工作。CI 里拿什么当上一个版本见“要主会话处理的事”第 4 条。

`db/open.ts`：`openModuleDb(dataDir, name)` 打开 `<数据目录>/<name>.db`，依次设 `PRAGMA journal_mode = WAL`、`synchronous = NORMAL`、`foreign_keys = ON`、`busy_timeout = 250`。250 毫秒的理由写进注释：`bun:sqlite` 是同步调用，等锁期间整个事件循环停着；进程内所有写入天然排成一队，会等锁的只有进程外的连接（备份的只读事务不挡写入，t07 的创建管理员命令、测试里的故障注入），等太久不如让就绪检查回 503。

### 3.4 配置：`nb-site-server/src/config.ts`

只来自环境变量（Spec 的输入一节）。Bun 会自动读当前目录的 `.env`，这与“只来自环境变量”冲突，所以所有启动方式都带 `--no-env-file`：`bin` 的首行 `#!/usr/bin/env -S bun --no-env-file`、镜像的 `ENTRYPOINT`、合同测试起进程的参数。

| 变量 | 必填 | 校验 | 缺省 |
|---|---|---|---|
| `NB_SITE_URL` | 是 | `https:`，没有路径（只能是 `/`）、查询串与片段 | — |
| `NB_SITE_TELEMETRY_URL` | 是 | 同上；主机与 `NB_SITE_URL` 不同（写入口单独一个域名，提案 4.4；入口按主机分派，3.5） | — |
| `NB_SITE_DATA_DIR` | 是 | 绝对路径、已存在、是目录、可写（`access(W_OK)`）；不自动建，免得拼错的路径悄悄变成一个空站 | — |
| `NB_SITE_SESSION_SECRET` | 是 | 至少 32 个字符 | — |
| `NB_SITE_HOST` | 否 | `isIP` 认得的地址 | `127.0.0.1` |
| `NB_SITE_PORT` | 否 | 0 到 65535 的整数；0 表示由系统挑一个空闲端口，实际端口见监听日志（3.5），合同测试用它 | `8080` |
| `NB_SITE_TRUSTED_PROXIES` | 否 | 逗号分隔的 IPv4、IPv6 网段，逐个 `BlockList.addSubnet` | 空 |
| `NB_SITE_BACKUP_KEEP` | 否 | 正整数 | `7` |
| `NB_SITE_SHUTDOWN_TIMEOUT_MS` | 否 | 正整数；停止时等在途请求的上限（输出 9 的 10 秒），测试配短 | `10000` |

模块自己的变量（`NB_SITE_<模块>_*`）由各模块的 `parseConfig` 读，入口把基础配置与各模块的问题合在一起报。

失败时：在读任何文件、建任何文件之前，向标准错误写一行 JSON `{"level":"error","code":"config_invalid","problems":[{"name":"NB_SITE_SESSION_SECRET","problem":"missing"}],"message":"..."}`，以非零码退出。`problem` 取固定的几个词（`missing`、`not_https`、`has_path`、`same_host`、`not_absolute`、`not_directory`、`not_writable`、`too_short`、`not_integer`、`out_of_range`、`bad_subnet`），合同测试按它断言，不按说明文字。说明与问题里只出现变量名，不出现取值：所有校验函数只返回问题词，拼说明的代码拿不到值。

`SiteSettings`（交给模块的那部分）：`siteUrl`、`telemetryUrl`、`sessionSecret`、`trustedProxies`（`BlockList`）。

数据目录的布局：

```text
<NB_SITE_DATA_DIR>/
├── site.lock                 # serve 与 migrate 持有的独占锁（nb-flock），建好不删
├── identity.db               # 账号模块的库（WAL，另有 -wal、-shm）
├── telemetry.db              # 统计模块的库
└── backups/
    ├── backup.lock           # 同一时间只有一个备份在写
    └── 20261124T031500123Z/  # 一次完整的备份：identity.db、telemetry.db
```

文件名就是模块名加 `.db`。它们写进 Spec（第 4 节），因为合同测试要在这一层做故障注入（3.8）、部署的人要知道备份在哪。

### 3.5 三个命令、健康检查、日志、停止：`nb-site-server/src/commands/`、`health.ts`、`log.ts`、`lock.ts`

命令名：`nb-site serve`、`nb-site migrate`、`nb-site backup`（t07 加 `create-admin`，t12 加导入）。没有选项，配置全走环境变量。commander 的用法错误照它的缺省以 1 退出。

所有失败都以退出码 1 结束，向标准错误写一行 JSON，`code` 取 Spec 失败表里的码；退出码在 `cli.ts` 一处由结果算出（参照 `packages/nb-host/src/server/start.ts` 的写法）。

`serve` 的步骤，标明每步在收口的 `try` 之内还是之外、在受理请求之前还是之后：

1. 解析配置（之外；失败写 `config_invalid` 退出，没有建任何文件）。
2. `tryLock(<数据目录>/site.lock)`（之外；返回 null 写 `data_dir_busy` 退出，不打开库、不执行迁移）。从这一步起进 `try`，`finally` 里放锁。
3. 按模块顺序 `openModuleDb`、`runMigrations`（`try` 之内、受理之前；失败写 `migration_failed`，`finally` 关掉已打开的库）。端口在这一步之后才监听，所以迁移没做完时端口不可连（状态表的时序一节）。
4. 各模块 `create`，装出根应用（`try` 之内、受理之前）。
5. `Bun.serve({hostname, port, fetch})`；绑不上端口时写 `listen_failed`（Spec 里还没有，见第 4 节）。监听成功后写一行 `{"event":"site.listening","url":"http://127.0.0.1:43127/"}`：端口为 0 时这是唯一能知道实际端口的地方，合同测试读它。
6. 等 `SIGTERM` 或 `SIGINT`。信号处理在第 1 步之前就挂上：迁移期间收到信号，迁移照常做完（`bun:sqlite` 是同步的，信号在两条迁移之间才被处理），之后不监听、以 0 退出。
7. 停止：`server.stop()`（不再接新连接、在途请求继续）与 `NB_SITE_SHUTDOWN_TIMEOUT_MS` 赛跑，超时则 `server.stop(true)` 断开剩下的；然后各模块 `close()`，关库，放锁，写 `{"event":"site.stopped"}`，以 0 退出。本机探针确认 Bun 1.4.4 的 `server.stop()` 之后新请求被拒、在途请求照常完成、返回的 Promise 在它完成时 resolve。

`migrate`：第 1 到 3 步，然后关库、放锁、以 0 退出。服务在跑时它拿不到锁，得 `data_dir_busy`。

`backup`（`commands/backup.ts`）：
1. 解析配置（与 serve 同一套，失败写 `config_invalid`）。不拿 `site.lock`：备份要在服务运行期间可以执行（输出 6）。
2. `tryLock(<数据目录>/backups/backup.lock)`，拿不到写 `backup_failed`（另一个备份在写）。
3. 新建 `backups/<UTC 时间，到毫秒>.partial/`（`mkdir` 不带 `recursive`，已存在就失败），对每个模块：以只读方式打开它的库（不存在就失败：没启动过的数据目录没有可备份的东西），`VACUUM INTO ?`（路径用绑定参数）写出副本；有 `prepareBackupCopy` 的模块再以读写方式打开副本调用它、随后 `VACUUM`；副本 `PRAGMA quick_check` 必须是 ok。
4. 全部成功后把目录改名去掉 `.partial`；再按名字排序删掉超过 `NB_SITE_BACKUP_KEEP` 份的旧目录，并删掉所有残留的 `*.partial`（拿着 `backup.lock`，不会删到别人正在写的）。
5. 标准输出一行 `{"event":"backup.done","name":"20261124T031500123Z","modules":["identity","telemetry"]}`。任一步失败写 `backup_failed` 退出，留下的 `.partial` 由下一次清掉。

`backup` 要拿到模块列表才知道有哪些库，所以它也在 `runCli(argv, modules)` 里；只是不调用 `create`，只用 `name` 与 `prepareBackupCopy`。所以 `prepareBackupCopy` 放在 `SiteModule` 上，不在 `ModuleInstance` 上。

健康检查（`health.ts`）：
- `GET /health/live`：200 `{"status":"live"}`，不碰库（输出 3）。
- `GET /health/ready`：对每个模块在它自己的连接上 `BEGIN IMMEDIATE` → 读账本、核对本版本的迁移都在 → `ROLLBACK`，再看模块的 `ready()`。全部通过回 200 `{"status":"ready","modules":{"identity":"ready","telemetry":"ready"}}`；否则 503 `{"status":"not_ready","code":"not_ready","modules":{"identity":"ready","telemetry":"not_ready"}}`。异常只记日志（模块名、错误类型），不进响应体（输出 4、边界一节）。每次请求现查，不缓存，所以库恢复后下一次就回 200、不用重启。`BEGIN IMMEDIATE` 证明拿得到写锁；它证明不了磁盘还有空间，写进第 8 节。本机探针：另一个连接持 `BEGIN EXCLUSIVE` 时它在 `busy_timeout` 后报 `database is locked`，放掉后立刻恢复。

按主机分派：请求的 `Host` 与 `NB_SITE_TELEMETRY_URL` 的主机相同时交给 `ingest` 的 mount，其余都交给 `site` 的 mount（包括用回环地址来的请求）。健康检查在分派之前，两种主机上都能用。

请求日志（`log.ts` 与 `site.ts` 的中间件，输出 8）：每个请求一行 `{"time","level":"info","event":"http.request","requestId","module","method","path","status","durationMs"}`。`path` 取 `URL.pathname`，没有查询串；不记任何请求头、请求体、来源地址与凭据（统计 Spec 输出 8 也要求不留来源地址）。`module` 由命中的 mount 决定，健康检查与未命中的记 `site`。响应头 `X-Request-Id` 与日志里的 `requestId` 相同。所有日志行都是英文的 `message` 加稳定的 `event`（`docs/standards/code/common.md` 的文字语言一节）。

### 3.6 模块包与合同包：`nb-site-identity/`、`nb-site-telemetry/`、两个 `*-contract/`

模块包（两个同形，以 identity 为例）：
- `src/index.ts` 导出 `identityMigrations`（来自 `src/migrations.ts`）、`parseIdentityConfig(env)`（本 Task 没有变量，返回空配置）、`createIdentityModule(options: {db; config; log})`，返回 `{site: Hono}`：挂在 `IDENTITY_API_PREFIX` 下、没有路由的子应用。选项与返回值的类型由模块自己声明，`nb-site-server/src/modules.ts` 的适配器把它们包成 `SiteModule`。
- `src/migrations.test.ts`：列表与 `migrations/` 目录一致（目录不存在时列表为空）。
- telemetry 的 `site` 子应用挂在 `TELEMETRY_API_PREFIX` 下；`ingest` 的 mount 本 Task 不给（t06 加 `/v1/daily` 等三个写入口）。

合同包：`src/index.ts` 只有路径前缀常量，`src/index.test.ts` 是 smoke（前缀以 `/api/` 开头、以 `/v1` 结尾、两个不同）。第一个 schema 进来的 Task（t06、t07）再加 `typebox`。

### 3.7 `nb-site-server` 自己的测试

照“依赖用真的”：真 SQLite 文件、真子进程、真端口。临时目录一律 `createTestTmpRoot(name, purpose)`（`packages/neuro-book-test-support/src/tmp.ts` 第 61 行），`afterEach` 删；等状态用 `waitUntil`（`src/wait.ts` 第 16 行）。

- `src/db/migrate.test.ts`（进程内）：从空库执行、再执行不重复；某条失败时它回滚、之前的保留；已执行的改了内容被拒；缺口被拒；账本里有更新的迁移时照常、就绪判断为真；列表不合格（id 格式、编号不递增、含事务语句或 `ATTACH`）在执行任何一条之前被拒；CRLF 与 LF 校验和相同。
- `src/config.test.ts`（进程内）：每个变量的缺失与不合格各得到对应的问题词；输出的整段文字里不含任何取值（造一个特征明显的密钥值去搜）；缺省值。
- `src/serve.test.ts`（真子进程）：经 `src/testing/fixture-main.ts` 起服务。它调用同一个 `runCli`，模块列表按环境变量 `NB_SITE_FIXTURE` 从 `src/testing/modules.ts` 选：`failing`（第二条迁移是坏 SQL）、`slow`（一个等测试放行才回应的路由）、`ingest`（一个 `ingest` mount）、`backup-prune`（有一张要在副本里清空的表）。这些只在 `testing/` 里，产品代码不引用（测试文档的“测试文件组织”）。用例：迁移失败时非零退出、标准输出没有 `site.listening`、库里第一条迁移的账本还在；`SIGTERM` 时在途的慢请求完成、进程以 0 退出；慢请求超过 `NB_SITE_SHUTDOWN_TIMEOUT_MS`（测试设 300）时进程照样在上限后退出；按主机分派到 `ingest` 与 `site`；就绪检查在模块 `ready()` 为假时 503 并点名该模块；测试先占住一个端口再起服务，得 `listen_failed`、非零退出、锁被放掉（随后能再起一个）。
- `src/backup.test.ts`（真子进程）：保留份数、残留 `.partial` 被清、`prepareBackupCopy` 在副本上生效而原库不变、库文件不存在时 `backup_failed`、两个备份同时跑时后到的 `backup_failed`。
- `src/architecture.test.ts`：第 3.9 节的依赖白名单与 `ATTACH` 守卫。

这些测试在 `nb-site-server` 包内，换语言重写时不保留；能经 HTTP 与命令行从外面看到的，都另在合同测试包里测（3.8）。

### 3.8 合同测试包：`packages/nb-site-contract-tests/`

目录：`src/testing/site.ts`（起进程与收口）、`src/testing/fault.ts`（故障注入，见下面与“要开发者定的事”第 1 条）、`src/operations.test.ts`、`src/adjacent-version.test.ts`、`src/boundary.test.ts`、`AGENTS.md`。

被测进程的命令：环境变量 `NB_SITE_SERVER_COMMAND`（JSON 数组形式的 argv，例如 `["/usr/bin/bun","--no-env-file","/abs/server.js"]`）设了就用它，换语言重写后指向新程序即可；没设时用 `[process.execPath, "--no-env-file", <nb-site-server 的 bin>]`，bin 的路径由 `import.meta.resolve("@notnotype/nb-site-server/package.json")` 找到包目录再读 `bin` 字段得出。这是解析路径，不是导入代码，导入守卫（3.9）不拦它，也不该拦。

`src/testing/site.ts` 的接口：

```ts
/** 在当前测试文件里登记 beforeAll 与 afterAll：建本文件的临时根，结束时停掉本文件起的所有进程再删根。 */
export function useSiteSandbox(): SiteSandbox;
export interface SiteSandbox {
    /** 本文件临时根下新建一个空的数据目录。 */
    dataDir(): Promise<string>;
    /** 起 serve，等到 site.listening 那一行，返回实际地址；超过 timeoutMs（缺省 10 秒）抛错并带上已收到的标准错误。 */
    start(options?: {dataDir?: string; env?: Record<string, string | undefined>}): Promise<SiteProcess>;
    /** 跑一个会自己退出的命令（migrate、backup），返回退出码与输出。 */
    run(command: string, options?: {dataDir?: string; env?: Record<string, string | undefined>; stdin?: string}): Promise<CommandResult>;
}
export interface SiteProcess {
    readonly url: string;
    readonly dataDir: string;
    /** 到目前为止标准输出的 JSON 行。 */
    logs(): readonly Record<string, unknown>[];
    stderr(): string;
    /** 发 SIGTERM，等它退出（超时后 SIGKILL 并报错），返回退出码。 */
    stop(): Promise<number>;
}
```

要点：
- 每个测试文件一个临时根：`beforeAll` 里 `createTestTmpRoot("nb-site-contract", <文件名>)`，各用例在根下建自己的数据目录；`afterAll` 先停进程再删根（删目录不等于关了里面的文件，测试文档“测试起的资源要收口”）。
- 端口：传 `NB_SITE_PORT=0`，从 `site.listening` 读实际地址，没有“先探一个空端口再交给子进程”的竞争。就绪判定：读到这一行之后再请求 `/health/ready` 等到 200（`waitUntil`）。
- 环境只给明确列出的几项：`PATH`、`HOME`、`TMPDIR=<临时根>/tmp`，加一套合格的 `NB_SITE_*`（`https://site.test`、`https://telemetry.test`、48 个字符的随机会话密钥、`127.0.0.1`、端口 0），用例的 `env` 覆盖或删掉其中几项。不继承测试进程的整个环境，免得开发机上的变量混进来。
- 收口：每个起过的进程登记在沙箱里；`afterEach` 停掉本用例没停的（用例失败时也停）；另在 `process.on("exit")` 里对还活着的 `SIGKILL`，覆盖测试进程正常退出与未捕获异常。测试进程被 `SIGKILL` 时子进程会留下，这是已知限制（第 8 节）。
- 进程在 `beforeAll` 或用例里起：本机探针确认 Bun 的 junit 报告不把 `beforeAll` 的耗时算进用例，单个用例仍可守 200 毫秒的预算；每条都要起新进程的用例（配置校验那几条）也在预算内：本机探针里 Bun 起一个载入 Hono 与 `bun:sqlite`、监听端口再退出的进程约 15 毫秒。

故障注入 `src/testing/fault.ts`：`holdWriteLock(dataDir, module)` 用 `bun:sqlite` 打开 `<数据目录>/<模块>.db`、`BEGIN EXCLUSIVE`，返回放锁的函数。只做这一件事，不读不写表。它依赖 Spec 写明的数据目录布局（3.4），t06 的“统计库不可写时写入口回 503”（`site.telemetry-ingest` 验收 4）也用它。

`src/operations.test.ts` 的用例（对应第 6 节）：
- 从空数据目录启动：就绪 200、存活 200；第二次启动的标准输出里没有 `migration.applied`。本 Task 两个模块都没有迁移，“第一次启动执行了迁移”由 3.7 的进程内测试覆盖，t06、t07 加了迁移后这条自然覆盖到。
- 配置：每个必填项分别去掉一次，非零退出、标准错误那一行的 `code` 是 `config_invalid`、`problems` 点名该变量、数据目录仍是空的（没有 `site.lock`）、事先选好的端口连不上；会话密钥给一个特征明显但太短的值，标准错误里找不到它（验收 4）。
- 两个 `serve` 先后对同一个数据目录：后到的非零退出、`code` 是 `data_dir_busy`、标准输出没有 `migration.applied`；服务在跑时 `migrate` 同样得 `data_dir_busy`。
- 就绪检查：`holdWriteLock` 持锁期间 `/health/ready` 回 503、`code` 是 `not_ready`、`modules` 点名被锁的模块、响应体里没有数据目录的路径；放锁后下一次回 200，进程没重启。存活检查在持锁期间仍是 200。
- 日志：请求 `GET /health/live?token=abc` 后，标准输出有一行 `http.request`，字段齐全、`path` 是 `/health/live`、整段标准输出里没有 `abc`；响应头 `X-Request-Id` 等于这一行的 `requestId`。
- 停止：`SIGTERM` 后以 0 退出，端口随后连不上。
- 备份：服务运行时跑 `backup`，以 0 退出，`backups/` 下多一个目录、里面两个库都能以只读打开且 `quick_check` 为 ok（用 `bun:sqlite` 只读打开，同样只在 `src/testing/` 的辅助函数里）；把副本拷进新的数据目录单独起一个服务，就绪 200（验收 3 的前半；“账号能登录”由 t07、“原始上报表是空的”由 t06 加进同一个用例）；设 `NB_SITE_BACKUP_KEEP=2` 连跑三次，只剩最新的两个。

`src/adjacent-version.test.ts`：见 3.3。

### 3.9 守卫

依赖白名单（`nb-site-server/src/architecture.test.ts`）：经 `import.meta.resolve("<包名>/package.json")` 读各包清单，核对 `dependencies` 与 `devDependencies` 里指向工作区包的条目（版本以 `workspace:` 开头，与 `scripts/ci/workspace-graph.ts` 同一判定）：

| 包 | 允许的工作区依赖 |
|---|---|
| 两个合同包 | 无（只许第三方的 `typebox`；devDependencies 只许测试支持包） |
| `nb-site-identity` | `nb-site-identity-contract`，以及“要主会话处理的事”第 2 条定下来的范围 |
| `nb-site-telemetry` | `nb-site-telemetry-contract`，同上 |
| `nb-site-server` | 两个模块包、两个合同包、`nb-flock`；不许 `nb-site-contract-tests`、`nb-site-web`（t10 发静态文件时再按需要放开 web） |

第三方包不限（hono、typebox、以后的 better-auth 都是“通用包”）；工作区里别的包一律要先加进这张表，防止模块悄悄依赖上别的工作区实现。这条测试放在 nb-site-server：模块包与合同包都是它的依赖，改了它们，`test:affected` 会顺着依赖图选中它。

`ATTACH` 守卫（同一个文件，ADR 0061 决策 1）：两个模块包的 `src/**/*.ts` 与 `migrations/*.sql`、以及 `nb-site-server/src/**/*.ts`（不含测试）里，去掉注释后不许出现 `\bATTACH\b`（不分大小写）。Task README 的范围里没列这一条，它便宜、又是 ADR 写明要有的，放在本 Task；运行器对迁移的校验（3.3）是同一条规则在运行期的第二道。

合同测试只 import 合同包（`nb-site-contract-tests/src/boundary.test.ts`）：用测试支持包的 `scanImports`（`packages/neuro-book-test-support/src/import-boundary.ts` 第 13 到 62 行，nb-form、nb-agent-ui 在用），规则：

- 允许：`@notnotype/nb-site-identity-contract`、`@notnotype/nb-site-telemetry-contract`、`bun:test`、`node:` 内置模块、`@notnotype/neuro-book-test-support/tmp` 与 `/wait`；`bun:sqlite` 只许出现在 `src/testing/fault.ts` 与备份核对的辅助文件里（按文件给第二条规则）。范围以“要主会话处理的事”第 1 条为准。
- 相对导入必须落在本包的 `src/` 里。
- `sourceFiles` 缺省跳过 `*.test.ts`，这里要连测试文件一起扫：自己列文件，不用它的缺省。
- 同一个文件再核对本包清单：运行时依赖只有两个合同包，devDependencies 里的工作区包只有 `nb-site-server` 与测试支持包。这条放在本包：改它的清单时 nb-site-server 的测试选不中。

### 3.10 前端骨架：`packages/nb-site-web/`

照 `packages/dev-panel` 的前端写法：`vite.config.ts`（根是 `src`、产物进 `dist/`、照抄 `cssMinify: "esbuild"` 与它的注释理由）、`tsconfig.json`（照 `packages/dev-panel/tsconfig.web.json`）、`src/index.html`、`src/main.ts`、`src/app.css`（先 `@import "tailwindcss"` 再 `@import "@notnotype/nb-ui/tailwind.css"`，照 dev-panel 的 `src/web/app.css`）、`src/App.vue`（只放站名，用 nb-ui 的排版与主题）。不加路由、不加消息目录、不调接口：页面的样子在 t09 定。

测试：`tests/build.test.ts` 照 `packages/dev-panel/tests/web-build.test.ts`，在临时目录里真跑一次 `vite build`，断言退出码 0、标准错误为空、产物里有 `index.html` 与一个 CSS 文件。它超过 200 毫秒的预算，在文件头写明原因（要真构建一次才知道 nb-ui 与 Tailwind 的接法没坏）。`tests/boundary.test.ts`：清单与源码都不许出现两个模块包与 `nb-site-server`。

开工前读 `.agents/skills/ui-development/SKILL.md` 与 `packages/nb-ui/docs/ui-development-spec.md`（AGENTS.md 的“动手前读什么”）。

### 3.11 镜像与 CI：`packages/nb-site-server/image/`、`.github/workflows/ci.yml`

`image/build.ts`（包脚本 `build:image`）：
1. `Bun.build({entrypoints: ["src/main.ts"], target: "bun", outdir: "dist/image", sourcemap: "linked"})`，出 `server.js`；迁移的 SQL 已内联在里面（3.3）。`bun:sqlite`、`bun:ffi`（nb-flock）是内置模块，不进产物。
2. 把 `image/Dockerfile` 拷进 `dist/image/`。t10 起再把 `nb-site-web` 的构建产物放进 `dist/image/web/`。
3. 不带 `--no-docker` 时 `docker build -t nb-site:local dist/image`。构建上下文只有 `dist/image`，仓库根的 `.dockerignore`（为旧应用写的）不参与。
   参数用 `node:util` 的 `parseArgs` 读（只有 `--no-docker` 与 `--tag`）。`dist/` 已被 `.gitignore` 第 17 行忽略。

`image/Dockerfile`：

```dockerfile
# 产物由 image/build.ts 在构建机上打好；这里只拷贝，不安装依赖。
FROM oven/bun:1.4.4-slim
WORKDIR /app
COPY server.js server.js.map ./
ENV NB_SITE_HOST=0.0.0.0 NB_SITE_PORT=8080 NB_SITE_DATA_DIR=/data BUN_RUNTIME_TRANSPILER_CACHE_PATH=0
USER bun
EXPOSE 8080
ENTRYPOINT ["bun", "--no-env-file", "/app/server.js"]
CMD ["serve"]
```

- 基础镜像要 glibc：nb-flock 在 Linux 上按 `libc.so.6` 加载 `flock`（`packages/nb-flock/src/index.ts` 第 52 行附近），不能用 alpine。版本与 CI、本机的 Bun 对齐；标签名以 Docker Hub 上实际存在的为准（没有核实，见交回里的假设），t13 再改成按摘要固定。
- 容器里监听 `0.0.0.0`（否则端口映射不通）；对外是否只绑本机回环由 t13 的 Compose 决定。Spec 的缺省（只监听回环）对直接运行程序仍成立。
- `BUN_RUNTIME_TRANSPILER_CACHE_PATH=0` 关掉 Bun 对大文件的转译缓存（缺省写到家目录下），守 Spec 的“不往数据目录之外写文件”。`target: "bun"` 打出的产物带 `// @bun` 头、可能本来就不进缓存，没核实，关掉不花代价。
- 不写 `VOLUME` 与 `HEALTHCHECK`：数据卷与健康检查的写法在 t13 的 Compose 里定。`/data` 要对 uid 1000（镜像里的 `bun` 用户）可写，写进 `nb-site-server/AGENTS.md` 的部署一节给 t13。

`image/smoke.ts`（包脚本 `smoke:image`）：建临时数据目录，`docker run -d --user "$(id -u):$(id -g)"` 挂上它与合格的环境变量（用宿主的 uid 跑，容器写出的文件宿主删得掉；CI 的 runner 不是 uid 1000）、`-p 127.0.0.1:0:8080`，`docker port` 取映射的端口，等 `/health/ready` 为 200，`docker stop`（缺省 10 秒宽限）后核对容器退出码是 0，`finally` 里 `docker rm -f` 与删目录。临时目录走测试支持包的 `resolveAgentScratchPath`（脚本的临时数据规则，测试文档“临时目录与环境键”第 5 条）。

CI（`ci.yml`）：现有两个作业，`check`（治理、文档、`test:affected --typecheck`，最近两次成功的运行约 27 分钟）与 `app-package`（约 1 分钟，含一次完整的 `bun install`）；数字取自 `gh run view` 的 45352607883 与 45148257722。加一个与它们并列的作业 `site-image`，不塞进 `check`（它已经是关键路径）：

```yaml
  site-image:
    name: 官方站的产物与镜像能打出来，产物过合同测试，镜像能起来并通过就绪检查（不推送）
    runs-on: ubuntu-latest
    timeout-minutes: 20
    steps:
      - uses: actions/checkout@v5
      - uses: oven-sh/setup-bun@v2
      - run: bun install --frozen-lockfile
      - run: bun run build:image
        working-directory: packages/nb-site-server
      # 打出来的单文件产物与源码行为一致：同一套合同测试对着产物再跑一遍。
      - run: bun test
        working-directory: packages/nb-site-contract-tests
        env:
          NB_SITE_SERVER_COMMAND: '["bun","--no-env-file","${{ github.workspace }}/packages/nb-site-server/dist/image/server.js"]'
      - run: bun run smoke:image
        working-directory: packages/nb-site-server
```

- 每次推送与 PR 都跑，不加路径过滤：工作流开头写明“这里不维护路径表”（`ci.yml` 第 1 到 2 行）。预计几分钟（安装约 1 分钟，另加拉基础镜像），与 `check` 并行，不拉长总时长。被 `release.yml` 经 `workflow_call` 调用时也会跑，不影响发布（只构建不推送）。
- 合同测试在 `check` 作业里已经按源码跑过（`test:affected` 经依赖图选中它）；这里对着产物再跑，抓打包丢东西（漏内联的 SQL、动态导入）。
- 改完跑 `actionlint .github/workflows/*.yml`（测试文档“平台与 CI”）。

### 3.12 测试文档：`docs/testing/README.md`

- “测试分类与运行”的表加一行：“服务进程｜每个测试文件起一个被测服务进程，只经 HTTP 与命令行；真端口、真 SQLite 文件｜`test`｜同快速类，按受影响范围；CI 的 `check` 作业经依赖图选中，`site-image` 作业对着打好的产物再跑一遍”。它用包脚本 `test`，`test:affected` 不用改：合同测试包依赖 `nb-site-server`，改了入口、模块或合同都会选中它（`test-affected.ts` 第 129 到 167 行、`workspace-graph.ts`）。
- 在同一节后加一小节“服务进程测试”：起进程放 `beforeAll` 或用例里，单个用例守 200 毫秒预算（Bun 的 junit 不计 `beforeAll`）；每个测试文件一个 `createTestTmpRoot`；端口给 0、从监听日志读实际地址；就绪按 `/health/ready`；停止发 `SIGTERM` 并核对退出码，`afterEach` 停掉没停的，`process.on("exit")` 兜底；只给子进程明确列出的环境变量，Bun 进程带 `--no-env-file`；`--files` 选不到经路径启动的入口，改入口时去掉 `--files` 再跑一次（该节已有的提醒，这里点名）。
- “临时目录与环境键”的表加两个键：`NB_SITE_SERVER_COMMAND`、`NB_SITE_PREVIOUS_SERVER_COMMAND`，Owner 写 `nb-site-contract-tests`（它们是被测程序的命令，不是测试支持包的路径定位）。

## 4. Spec 与文档改动

主会话在主工作区 master 上改（Spec 的状态仍是 `planned`：输出 5 在 t07，整份实现完再改 `implemented`）：

- `docs/specs/site/operations.md`
  - 输入一节的命令表：写上命令名 `nb-site serve`、`nb-site migrate`、`nb-site create-admin`（t07）、`nb-site backup`。
  - 配置表：写上变量名（3.4 的表），并补三项可选配置：端口为 0 的含义、`NB_SITE_BACKUP_KEEP`（缺省 7）、`NB_SITE_SHUTDOWN_TIMEOUT_MS`（缺省 10000，输出 9 的“至多 10 秒”改为“至多这个时限”）。补两条校验：数据目录必须已存在、可写；遥测写入口地址的主机与站点地址不同、两者都不带路径。
  - 副作用与数据一节：写出数据目录的布局（3.4 的树），文件名是合同。
  - 输出 1：说明那一行是一个 JSON 对象、带 `code` 与 `problems`（变量名与问题词）。
  - 输出 2：每执行一条迁移，标准输出一行 `migration.applied`（模块与迁移 id）；开始监听时一行 `site.listening`（实际地址）。
  - 输出 3、4：写出两种响应体的形状（3.5）。
  - 输出 9：`SIGINT` 与 `SIGTERM` 同样处理；迁移期间收到时做完迁移、不监听、以 0 退出。
  - 失败表：加 `backup_failed`（库文件不存在或打不开、副本校验不过、另一个备份正在写）与 `listen_failed`（端口绑不上）。
  - 证据一节：实现后补实现合同（包与入口的位置、`site_migrations` 账本的形状不能改）。
- `.agents/works/w00037-official-site/tasks/t05-scaffold/README.md`：链接 `plan.md`，范围里补“`ATTACH` 守卫”（3.9）。
- `.agents/works/w00037-official-site/tasks/t06-telemetry-ingest/README.md`：范围里补“CI 里用基准提交的程序跑相邻版本测试”（“要主会话处理的事”第 4 条定了之后）。

实现分支里改（随代码一起合入）：

- 3.1 列的登记：根 `package.json`、`bun.lock`、`scripts/ci/test-conventions.ts`、`packages/AGENTS.md`、`docs/modules/monorepo-boundaries.md`、`docs/standards/code/README.md`。根 `AGENTS.md` 仓库结构的那一行按“要主会话处理的事”第 6 条，由主会话在合入时改在 master 上。
- 3.12 的 `docs/testing/README.md`。
- 七个包各自的 `AGENTS.md`；`nb-site-server/AGENTS.md` 写全站共用的规则、验证命令与给 t13 的部署说明（数据卷的属主、镜像的环境变量缺省）。

## 5. 切片

每片一个提交，提交前先看验证命令自己的退出码；`git diff --cached --check` 单独一步。下面的 `<七个包>` 指 `--package nb-site-identity-contract --package nb-site-telemetry-contract --package nb-site-identity --package nb-site-telemetry --package nb-site-server --package nb-site-contract-tests --package nb-site-web`（每个包各写一次 `--package`，测试文档“测试分类与运行”）。新包改了 `bun.lock`，不带 `--package` 的 `test:affected` 会选中全部，不这样跑。

| 片 | 内容（关键设计） | 自跑验证 |
|---|---|---|
| 1 包骨架、登记与守卫 | 3.1（根 `AGENTS.md` 除外）；3.6；3.9 的依赖白名单、`ATTACH` 守卫、合同测试包的 `boundary.test.ts`；`nb-site-server` 只有一个打印用法的 `main.ts`；`nb-site-web` 先只有清单与 `tests/boundary.test.ts`（前端内容在第 6 片） | `bun install`（慢时 `prox bun install`），`git status` 里 `bun.lock` 有变化；`bun run test:affected <七个包> --package scripts --typecheck`；`bun run governance:check`；`bun run docs:check`；变异：给 `nb-site-identity` 的清单加 `"@notnotype/nb-site-telemetry": "workspace:*"`、在合同测试包里加一行 `import "@notnotype/nb-site-server"`，各自让对应测试失败后恢复（先提交再变异，用 `git show HEAD:<文件> > <文件>` 恢复） |
| 2 迁移运行器与库连接 | 3.3；3.7 的 `db/migrate.test.ts` | `bun run --cwd packages/nb-site-server test src/db`；`bun run --cwd packages/nb-site-server typecheck`；变异：去掉“缺口”判断、去掉 CRLF 归一，各自让对应用例失败 |
| 3 配置、日志、`serve` 与 `migrate`、健康检查、停止、锁、主机分派 | 3.2；3.4；3.5（备份之外）；3.7 的 `config.test.ts`、`serve.test.ts` 与 `testing/` | 前置：第 4 节的 Spec 改动已在 master。`bun run test:affected --package nb-site-server --typecheck`；手工：`NB_SITE_URL=… NB_SITE_DATA_DIR=<临时目录> … bun --no-env-file packages/nb-site-server/src/main.ts serve`，`curl` 两个健康检查，`kill -TERM` 后看退出码；变异：把监听挪到迁移之前、去掉日志里去查询串的那一步、关掉停止时限，各自让对应用例失败 |
| 4 备份 | 3.5 的 `backup`；3.7 的 `backup.test.ts` | `bun run --cwd packages/nb-site-server test src/backup.test.ts`；`bun run --cwd packages/nb-site-server typecheck`；变异：去掉 `prepareBackupCopy` 的调用、去掉保留份数的删除 |
| 5 合同测试底座与运行用例、测试文档 | 3.8；3.12 | `bun run test:affected --package nb-site-contract-tests --typecheck`；`bun run governance:check`；用本版本当上一个版本跑一次：`NB_SITE_PREVIOUS_SERVER_COMMAND='["bun","--no-env-file","<worktree 绝对路径>/packages/nb-site-server/src/main.ts"]' bun run --cwd packages/nb-site-contract-tests test src/adjacent-version.test.ts`；变异：让就绪检查不看库（永远 200）、让 `serve` 不拿锁，合同测试各自失败 |
| 6 前端骨架 | 3.10 | `bun run test:affected --package nb-site-web --typecheck`；`bun run --cwd packages/nb-site-web build`；`vite preview` 起本地预览，截一张亮色截图交前端审查，只看骨架能显示、nb-ui 的主题变量生效（`nbdev shot --url` 能不能截非应用的页面没核实，不行就用 `playwright-cli`） |
| 7 镜像与 CI | 3.11 | `bun run --cwd packages/nb-site-server build:image`；`NB_SITE_SERVER_COMMAND='["bun","--no-env-file","<绝对路径>/packages/nb-site-server/dist/image/server.js"]' bun run --cwd packages/nb-site-contract-tests test`；`bun run --cwd packages/nb-site-server smoke:image`；`actionlint .github/workflows/*.yml`；最后在一个干净克隆里（`git clone` 本分支到临时目录、`bun install`）再跑一次 `build:image` 与 `smoke:image`：测试文档要求打包与 CI 相关的验证不在 worktree 里跑，免得相对路径碰巧落到主工作区 |

第 3 片之后与第 7 片之后各交一次审查，第 6 片另交前端审查（见第 7 节）。

## 6. 验收映射

`site.operations`（编号以第 4 节改过之后的 Spec 为准）：

| Spec 条目 | 覆盖 |
|---|---|
| 输出 1 配置校验 | 合同 `operations.test.ts` 的配置用例（四个必填项各缺一次、密钥值不出现、数据目录没被改、端口不可连）；`nb-site-server` 的 `config.test.ts`（每个问题词） |
| 输出 2 迁移先于服务 | `db/migrate.test.ts`（失败回滚、之前的保留、重跑不重复）；`serve.test.ts` 的 `failing` 夹具（非零退出、没有 `site.listening`、第一条的账本还在）；合同“第二次启动没有 `migration.applied`” |
| 输出 3 存活检查 | 合同：启动后 200；持写锁期间仍 200 |
| 输出 4 就绪检查 | 合同：启动后 200；`holdWriteLock` 期间 503 点名模块、不含路径；放锁后 200 不重启。`db/migrate.test.ts`：账本里有更新的迁移仍算就绪。`serve.test.ts`：模块 `ready()` 为假时 503 |
| 输出 5 创建管理员 | 不在本 Task（t07） |
| 输出 6 备份 | 合同：服务运行时备份成功、副本可打开且 `quick_check` 为 ok、副本能单独起服务并就绪、保留份数；`backup.test.ts`：`prepareBackupCopy` 生效（“原始上报不在副本里”的机制，表本身在 t06）、`.partial` 清理、并发备份 |
| 输出 7 相邻版本可互换 | 机制：`db/migrate.test.ts` 的“更新的迁移照常运行”；真实接管：合同 `adjacent-version.test.ts`，本 Task 只用本版本自测一次，CI 接入见“要主会话处理的事”第 4 条 |
| 输出 8 日志 | 合同的日志用例（字段齐全、没有查询串、请求头与日志的请求编号相同）；`serve.test.ts`（`module` 按 mount 记） |
| 输出 9 停止 | 合同：`SIGTERM` 后 0 退出、端口不可连；`serve.test.ts` 的 `slow` 夹具：在途请求完成后才退出、超过时限也退出 |
| 状态与时序：端口在迁移成功前不可连 | `serve.test.ts` 的 `failing` 夹具；变异检查“把监听挪到迁移之前” |
| 状态与时序：两个启动命令同时执行 | 合同的 `data_dir_busy` 用例（两个 `serve`；`serve` 在跑时 `migrate`） |
| 失败码 `config_invalid`、`migration_failed`、`data_dir_busy`、`not_ready` | 同上各行；`backup_failed`、`listen_failed`（第 4 节新加）：`backup.test.ts`；`listen_failed` 由 `serve.test.ts` 先占住一个端口再起服务 |
| 验收 1 | 合同“从空的数据目录启动”与“第二次启动” |
| 验收 2 | 本 Task 覆盖不到（还没有上一个版本），见“要主会话处理的事”第 4 条 |
| 验收 3 | 合同的备份用例，前半在本 Task；“账号能登录”t07、“原始上报表是空的”t06 加进同一个用例 |
| 验收 4 | 合同的配置用例 |
| Smoke | 合同 `operations.test.ts` 的启动与健康检查用例；CI 的 `site-image` 作业对着产物再跑一遍，另起镜像过就绪检查 |

ADR 里要求有测试守住、本 Task 落地的三条：ADR 0059 决策 2 → `nb-site-server/src/architecture.test.ts` 的依赖白名单；决策 6 → `nb-site-contract-tests/src/boundary.test.ts`；ADR 0061 决策 1 → `architecture.test.ts` 的 `ATTACH` 守卫。

## 7. 验证

端到端：
- 真实进程：合同测试包对源码跑一次（`bun run test:affected --package nb-site-contract-tests --typecheck`），对打好的 `server.js` 再跑一次（第 7 片的命令）。
- 真实镜像：`smoke:image` 在本机 Docker（本机 29.9.2）上起容器、过就绪检查、`docker stop` 后退出码 0。
- 手工看一遍日志：起一次 `serve`，看标准输出每行都是 JSON、请求行字段齐全，`SIGTERM` 后有 `site.stopped`。
- 收口前跑：`bun run test:affected <七个包> --package scripts --typecheck`、`bun run governance:check --since master`、`bun run docs:check --since master`、`actionlint .github/workflows/*.yml`。长验证前看 `cat /proc/loadavg`。
- 变异检查：第 5 节每片列出的几项，按测试文档“变异检查”先提交再改坏。

e2e：没有浏览器 e2e（本 Task 没有页面行为；前端骨架只有构建测试与一张截图）。合入前不跑 `packages/neuro-book` 的 e2e：本 Task 不碰应用包。

审查：
- 第 3 片之后（入口的时序、锁、迁移、停止都已成形），把第 1 到 3 片的提交范围交快速审查：Opus 审查者先审，同时 omp `@review` 在后台审同一份说明；第 4 到 7 片做完，剩下的范围照样先交 Opus、同时 omp 在后台（全局规则允许相邻的高风险切片合并成一个提交范围）。
- 第 6 片交前端审查者（Sonnet）。
- 审查说明里点名要看的：3.5 每一步在 `try` 内外、受理前后；锁与库的收口顺序；日志与错误输出里有没有可能带出取值或路径；`NB_SITE_SERVER_COMMAND` 的解析。

明确留下的未验证边界：
- 上一个版本接管（验收 2）：本 Task 没有上一个版本。
- 磁盘写满、文件系统变成只读时的就绪检查（第 8 节）。
- 测试进程被 `SIGKILL` 时留下的子进程（第 8 节）。
- Windows：官方站只在 Linux 容器里跑，测试与镜像都不覆盖 Windows；`nb-flock` 的 Windows 段不涉及。
- 镜像基础标签与 CI 上 Bun 的版本是否一致（`oven-sh/setup-bun@v2` 没写 `bun-version`，取最新版；见第 8 节）。

## 8. 不做与风险

不做：
- 账号与统计的任何业务接口、表与迁移（t06、t07）；创建管理员命令（t07）；前端页面、路由与发静态文件（t09、t10）；Compose、反向代理、每晚定时备份、按摘要升级与推送镜像（t13）。
- 迁移的静态检查（拦 `DROP`、改名这类破坏上一个版本的语句）：本 Task 与 t06、t07 的迁移都是新建；第一条改已有表的迁移出现之前，靠相邻版本测试兜底，那时再定要不要加。
- 测试进程被 `SIGKILL` 时自动收掉子进程：要么给 `serve` 加“标准输入关闭就退出”的开关（产品接口多一个只为测试的入口），要么在被测程序里认父进程；都不做，记为已知限制。本机开发中真遇到了，按进程号结束即可。

风险与兜底：
- 就绪检查只证明“能拿到写锁、账本可读”，证明不了磁盘还有空间：磁盘写满时就绪仍是 200、业务写入失败。兜底是 t06 的“库不可写时写入口回 503”（`site.telemetry-ingest` 输出 10）按真实写入判断；部署侧由 t13 的磁盘告警负责。要更严，可以在就绪检查里真写一次（例如写一次 `PRAGMA user_version` 的原值），代价是每次健康检查往 WAL 写一页，现在不做。
- `busy_timeout = 250` 让进程外的写锁最多卡住事件循环 250 毫秒（`bun:sqlite` 同步）。只在进程外有写者时发生（t07 的创建管理员、测试的故障注入）；合同测试的就绪用例因此会超过 200 毫秒的预算，在用例旁写明。
- 迁移里需要 `PRAGMA foreign_keys = OFF` 的重建表（SQLite 改列的标准做法要在事务外关外键）本运行器不支持：运行器拒绝 `PRAGMA`。第一次遇到时给运行器加一个按文件声明的开关，同时补测试；这类改动通常也是破坏上一个版本的，要拆成两个版本。
- 打包风险在 t07：Better Auth 与它的插件里有按条件的动态导入，`Bun.build` 打成单文件可能丢东西。`site-image` 作业对着产物跑合同测试，t07 加了库之后会第一时间暴露；真不行时改成产物旁边带一个 `bun install --production` 出来的 `node_modules`。
- 故障注入依赖数据目录里的文件名：模块将来换数据库（ADR 0061 决策 5），这一处辅助函数要跟着换，合同用例本身不变。
- 容器里 `bun` 是 1 号进程：1 号进程对没装处理函数的信号不做默认处理，本设计显式处理 `SIGTERM`、`SIGINT`，`smoke:image` 的 `docker stop` 后核对退出码 0 证明这一点。
- CI 上的 Bun 版本浮动（`setup-bun` 取最新），镜像里的 Bun 固定：产物在新版 Bun 上构建、旧版 Bun 上运行，理论上可能不兼容。`site-image` 作业在构建机上用同一个产物跑合同测试，但那是构建机的 Bun；要彻底一致，`setup-bun` 写死版本或 Dockerfile 里再构建一次。先记风险，t13 推镜像时一并定。
- 根 `AGENTS.md` 在主工作区有别人未提交的改动（开工时 `git status` 看到 ` M AGENTS.md`），第 1 片改它的仓库结构一节，合入时可能冲突：见“要主会话处理的事”第 6 条。

## 主会话的审定（2026-11-24）

起草时列出的待定事项，逐条的结论：

1. **合同测试的故障注入**：用 3.8 的做法，合同测试包里一个只持写锁的辅助函数，不读不写任何表。数据目录的布局因此写进了 `site.operations` 的“副作用与数据”。产品里不加模拟故障的开关。待开发者追认。
2. **ADR 0059 决策 6 的读法**：“合同包之外的任何包”指被测系统的工作区包（两个模块、进程入口、前端）与它们带进来的第三方依赖。运行器（`bun:test`）、平台内置模块、测试支持包的临时目录与等待工具不在其内；`bun:sqlite` 只许出现在故障注入与备份核对的辅助文件里。允许清单写进 `nb-site-contract-tests/AGENTS.md`，由 3.9 的守卫照清单检查。ADR 正文不改。
3. **ADR 0059 决策 2 与看板**：本 Task 照字面，模块包只许依赖自己的合同包。统计模块怎样拿到“问身份”的回答类型留到 t11 定（已记在 t11）。
4. **Spec**：第 4 节列的 `site.operations` 改动已在 master 上改完。就绪检查的口径改成“能取得写锁并读到迁移记录”，磁盘写满列进“不承诺”。
5. **验收 2 的落点**：记进 t06 的范围，CI 用基准提交的程序当上一个版本。
6. **根 `AGENTS.md`**：分支里不碰；仓库结构那一行由主会话在合入时改在 master 上。
7. **独立设计**：不另出一版。包的划分、数据库、合同测试的形态都已在提案与三份 ADR 里审过；本计划的选型只剩几处自己写的小工具。改为请一位审查者审计划，与第 1、2 片同时进行，结论在第 3 片之前处理。

实施时注意的两点：

- 迁移校验拒收事务语句，带 `BEGIN … END` 的触发器因此写不进迁移；第一次需要时再放开，现在记为已知限制并写进运行器的注释。
- 3.11 里没核实的假设（基础镜像的标签、打成单文件后 nb-flock 能不能用、容器里的信号处理）在第 7 片开头先核实，对不上就改计划再做。

## 设计审查后的修订（2026-11-24）

审查者：一个 Opus 子代理，只读，审的是本计划定稿时的副本；报告 [`evidences/design-review.txt`](evidences/design-review.txt)，20 条有效发现（阻断 1、重要 11、建议 8），每条有 Bun 1.4.4 上的实验。下面是逐条的处理；**与前文冲突的地方以本节为准**。第 1、2 片已按前文做完（提交 `1d7b822ef`、`3df92e909`），本节涉及迁移运行器的几条在第 3 片之前返工。

| 条 | 发现 | 处理 |
|---|---|---|
| 1 | 就绪检查在模块的业务连接上开事务，会回滚身份库正在进行的事务（实验里注册码没扣、账号却建成了） | 成立，改。入口为每个库另开一条**探测连接**（`busy_timeout = 0`），就绪检查只在它上面做；`ModuleContext.db` 归模块所有，入口在启动之后不在它上面开事务，写进接口的注释 |
| 2 | 迁移期间的信号要等监听之后才被处理 | 成立，改。运行器每提交一条迁移后让出一次宏任务并查“已收到停止”，置位就不执行下一条；`serve` 在监听之前再查一次。补一条真子进程的用例 |
| 3 | 迁移在外键打开的事务里执行，重建表会静默级联删掉子表 | 成立，改。运行器在事务外关外键，每条迁移提交前跑 `PRAGMA foreign_key_check`、有结果就回滚并失败，全部做完再打开。补“重建父表后子表行数不变”“留下悬空外键被拒”两条用例。第 8 节那条“不支持重建表”的风险作废 |
| 4 | 账本里有、列表里没有、编号不大于列表最大编号的条目没有规则 | 成立。第 2 片实现时已经加了这条规则（按 `out_of_order` 失败），予以确认；补“合并后改号”“只改名”两条用例 |
| 5 | 模块没有“开始”这一步；失败路径不调 `close()`；`close()` 没有时限 | 成立，改。`ModuleInstance` 加 `start?()`，在 `site.listening` 之后调；凡 `create` 成功的实例在任何退出路径上按相反顺序 `close()`；`close()` 与剩余的停止时限赛跑，超时记一行 `warn` 后继续关库 |
| 6 | 数据目录一把锁、会话密钥是所有进程的必填项，拆成两个进程时要改公开合同 | 成立，改。锁按模块拿：`<数据目录>/<模块>.lock`，`serve` 与 `migrate` 按模块列表逐个取，任一个取不到就 `data_dir_busy` 并放掉已取的。会话密钥改由账号模块的 `parseConfig` 读（变量名不变）。模块静态声明自己用到的入口（`surfaces`），入口只在有模块用到写入口时才要求 `NB_SITE_TELEMETRY_URL` 并做主机名不同的校验 |
| 7 | 模块没有提供命令的位置；命令与锁、迁移的关系没定；运行器在事务外读账本 | 成立，改。`SiteModule` 加 `commands?`，每个命令写明名字、占用方式与 `run(context)`；`cli.ts` 按模块列表登记子命令。占用方式两种：`exclusive`（取本模块的锁、先执行迁移，取不到就 `data_dir_busy`；导入用）与 `shared`（先试锁，取到就执行迁移；取不到说明服务在跑，核对迁移记录完整后直接做，不完整报 `not_ready`；创建管理员用）。运行器在每条迁移的 `immediate` 事务里重读这一条的记录，已存在就跳过。本 Task 没有真实命令，用 `testing/` 里的夹具模块各测一条 |
| 8 | 合同测试没有拨时间、触发定时任务的通道 | 部分接受。`ModuleContext` 加 `clock: {now(): number}`，模块的定时任务经入口提供的 `jobs` 登记（名字、间隔、函数），由入口在 `start` 之后调度、停止时收口；模块里不直接用 `Date.now()` 与 `setInterval`。测试怎样从进程外拨时间、立即跑一次任务，是对外多一个入口的决定，交开发者定（见 Task README），定下之前本 Task 不做；`accounts` 验收 7 那种“停在请求中间”的时序留到 t07 定是不是改成包内测试 |
| 9 | 库被进程外占着写时，每次就绪检查让事件循环停 250 毫秒，并发时累加 | 成立，改（与第 1 条同一处）。探测连接不等锁；同一时刻只跑一次检查，1 秒内的结果复用。业务连接的 250 毫秒不变，注释里写清代价是“每个撞锁的请求让全站停 250 毫秒” |
| 10 | 按主机分派没写比较规则，大小写、`:443`、末尾的点都会分错 | 成立，改。取 `new URL(req.url).hostname`、去掉末尾的点后比较，不看端口；`same_host` 的校验用同一个函数。补三种 `Host` 的用例 |
| 11 | 入站的 `X-Request-Id` 被原样写进日志 | 成立，改。不用 `hono/request-id`，自己生成编号，不读请求头。合同用例加“带着入站编号请求，日志与响应头里都不是它” |
| 12 | 合同测试依赖的字段名与问题词不在 Spec 里；底座没处理早退 | 成立，改。字段名与问题词表已写进 `site.operations`。`start` 同时等子进程退出，先到先判；起子进程时工作目录给临时根、`HOME` 给临时根下的空目录 |
| 13 | 备份：`backups/` 没人建；清理会误删或误留手工放的目录；时钟回拨会删掉刚写出的备份 | 成立，改。取锁前 `mkdir(backups, {recursive: true})`；清理只看名字合 `^\d{8}T\d{9}Z$` 的目录；本次写出的那一份不参与删除。补两条用例 |
| 14 | `migration_failed` 不带原因；模块初始化失败没有码；请求之外的未捕获异常打出非 JSON | 成立，改。`migration_failed` 那一行带 `reason` 与数据库的错误码、错误说明（迁移的 SQL 在仓库里，说明里只有标识符）；加 `start_failed`；`cli.ts` 装未捕获异常与未处理拒绝的处理：写一行 JSON 后按停止的步骤收口、以 1 退出 |
| 15 | 停止时限缺省 10 秒与 `docker stop` 的宽限相同 | 接受取舍：缺省不改，`nb-site-server/AGENTS.md` 的部署一节写明容器的停止宽限要比停止时限至少多 5 秒，交 t13。停止期间的第二个信号：立即断开在途请求并收口，已写进 Spec |
| 16 | 靠扫文字拒收事务语句，有误拒也有漏过 | 成立，改。事务语句不再扫文字：执行之后、写记录之前查 `db.inTransaction`，不在事务里就按 `migration_failed` 失败并说明“迁移结束了事务”。漏过时前半条已经提交，这一点接受：每条迁移都会在测试里从空库执行一遍，发布前就会暴露。`PRAGMA`、`ATTACH`、`DETACH`、`VACUUM` 仍按文字拒收。触发器因此可以写，前文“实施时注意的两点”第一条作废 |
| 17 | 依赖白名单没写测试支持包与前端包 | 成立。第 1 片实现时已自行处理；返工时核对：五个 Bun 侧的包的 `devDependencies` 都许测试支持包，`nb-site-web` 许 `nb-ui`、不许两个模块包与入口包，并加一条变异（给模块包的 `devDependencies` 加别的工作区包应当失败） |
| 18 | “账本形状不能改”定得过死，又没有保证兼容的读写约定 | 成立，改。约定是：`id`、`checksum`、`applied_at` 三列的名字与含义不变，只许加可为空或带缺省值的列，运行器读写一律写明列名。`applied_at` 是到毫秒的 ISO 8601 UTC；算校验和之前同时去掉开头的 BOM。补“账本多一列时照常运行”的用例 |
| 19 | 按可信代理取来源地址没有归属，`Bun.serve` 的 `fetch` 没把 `server` 传给 Hono | 成立，改。`ModuleContext` 加 `clientAddress(c): string \| null`，由入口实现：取对端地址，在可信网段内才读 `X-Forwarded-For`，从右往左跳过可信的代理，取第一个不可信的地址，格式不合法返回 `null`。`fetch` 写成把 `server` 传下去。夹具路由回显它，覆盖可信与不可信的对端、多跳、垃圾值 |
| 20 | 镜像里没有属于 `bun` 用户的 `/data` | 成立，改。Dockerfile 加一行建目录并改属主；`smoke:image` 再跑一次不带 `--user`、用命名卷的容器 |

对“主会话的审定”的修正：第 1 条里“产品里不加模拟故障的开关”仍然成立，但它不回答“测试怎样拨时间”，那件事按上表第 8 条另定。第 7 条“只剩几处自己写的小工具”低估了迁移运行器与进程的生命周期，这两块在第 3 片之前按本节改完。

切片的调整：在第 3 片之前插一片“2b 迁移运行器按审查返工”（上表第 2、3、4、16、18 条里属于运行器的部分，与第 7 条的“事务里重读记录”）；第 3 片按本节实现入口。第 3 片做完后的实现审查照原计划（Opus 先审，omp 在后台）。

## 实现审查（前三片）的处理

审查对象是 `3c4dc0466..49ab37bab`。Opus 的报告 15 条（重要 3、建议 12）在 [`evidences/impl-review-opus.txt`](evidences/impl-review-opus.txt)；omp 因上游的安全过滤中途退出，只写了 3 条，在 [`evidences/impl-review-omp.txt`](evidences/impl-review-omp.txt)，其中两条与 Opus 的第 1、8 条是同一件事。主会话逐条核实后的处理如下，“改”的都在修正片里做，Spec 已先改好（[`site.operations`](../../../../../docs/specs/site/operations.md)）。

| 条 | 问题 | 处理 |
|---|---|---|
| 1（omp 1） | 迁移里写 `COMMIT; BEGIN;` 能骗过 `inTransaction` 检查 | 改。`BEGIN IMMEDIATE` 之后开一个守卫保存点，迁移执行完 `RELEASE` 它；`RELEASE` 报错按 `transaction_ended` 失败。主会话用真实的 bun:sqlite 探过：`COMMIT`、`COMMIT; BEGIN`、`ROLLBACK; BEGIN`、`END; BEGIN IMMEDIATE`、迁移自己 `RELEASE` 守卫都被认出；迁移自己的保存点、触发器里的 `BEGIN…END` 照常通过。认得出、撤不回（提交掉的前半段留在库里），注释照实写。原有的 `inTransaction` 检查留作兜底 |
| 2 | `X-Forwarded-For` 里任何一跳不合法就整条取不到，请求方能让自己取不到地址 | 改。合法性判断并进从右往左的循环，左边没走到的跳不解析；带端口的写法不认，写进注释（Spec 已写） |
| 3 | 停止时限大于 2147483647 时计时器变成 1 毫秒 | 改。上界收到 2147483647 |
| 4、12 | 模块命令收不到停止请求；运行前被拦下时以 0 退出 | 改。`CommandContext` 加 `signal: AbortSignal`；入口让 `run()` 与强制停止赛跑；被打断的命令以 `interrupted` 失败（Spec 已加这个码） |
| 5 | 就绪结果的复用与停止时限按墙钟算 | 改。改用单调时钟 |
| 6 | `ModuleContext.db` 的注释没写“同一条连接上别的访问会被卷进跨 await 的事务” | 改注释 |
| 7 | 锁文件打不开、库不是 WAL 时标准错误没有失败行 | 改。新码 `data_dir_unusable`（带 `module`、`errorCode`）；入口兜底的 catch 往标准错误补一行 `internal`（Spec 输出 10） |
| 8（omp 3） | 校验和按归一化后的文字算，执行的却是原文 | 改。归一化一次，校验和与执行用同一份文字 |
| 9 | 没有 `Host` 或 `Host` 不合语法的请求回 500 | 改。回 400 `bad_request`，不记 error 级日志（Spec 已写） |
| 10 | “迁移期间收到 SIGTERM”的用例靠一条慢迁移接信号 | 改。进程级的用例只证明“信号让后面的迁移不执行、不监听、以 0 退出”，写法不依赖两个进程的相对速度；“做完正在执行的那一条再停”由运行器的包内用例证明 |
| 11 | “立即 503”的判据余量小 | 改。放宽到 200，注释写明它由 `busy_timeout` 250 推出 |
| 13 | 监听前那次停止检查前面没有让出事件循环 | 改。检查前让出一次；进入每个模块的迁移前同样让出 |
| 14 | 业务连接在事务里就不探写锁，会把卡住的事务一直报成就绪 | 改。探测照常试 `BEGIN IMMEDIATE`；撞上忙并且业务连接在事务里时算就绪，同一个模块连续 30 秒都是这样时回 503、`transaction_stuck`（Spec 输出 4）。分不出“同一个事务”与“每次都碰上新的短事务”，按窄场景接受 |
| 15 | `clientAddress` 只收 Hono 的 `Context`；`create()` 只能同步 | 部分改。`create()` 允许返回 Promise；`clientAddress` 的形状留到 t07 探 Better Auth 的钩子拿得到什么之后再定 |
| omp 2 | 迁移失败行的 `dbMessage` 原样带 SQLite 的说明，`RAISE` 的说明若由数据拼成会带出库里的值 | 接受取舍，不去掉 `dbMessage`：约束类错误的说明只有标识符，带数据的唯一路径是我们自己在迁移里写“说明由数据拼成”的 `RAISE`。在入口包的 AGENTS.md 与运行器注释里写明迁移的 `RAISE` 说明只写固定文字 |

实现者自报的 16 处读法：第 1、3、4、5、8、10、14、15 条照实现写进了 Spec；第 6 条给模块的收尾单独 2 秒（Spec 输出 9），代码照改；第 13 条创建管理员只在迁移期间占着库（Spec 时序一节），代码照改；第 3 条里 `listen_failed` 的 `errorCode` 只放系统给的码，拿不到时省略；第 7、9、16 条保留。

## 测试控制入口（开发者 2026-11-24 定）

“设计审查后的修订”第 8 条留给开发者的那件事定了：做测试控制入口，合同见 [`site.operations`](../../../../../docs/specs/site/operations.md) 输出 11。与前文冲突的地方以本节为准。

实现放在 `nb-site-server`，排在第 4 片之后、第 5 片之前，单独一个提交：

- **配置**：`NB_SITE_TEST_CONTROL` 由入口这一层读（至少 32 个字符，按码点计，问题词 `too_short`）；设了它而监听地址不是回环时，在监听地址上报 `not_loopback`。回环指 `127.0.0.0/8` 与 `::1`。
- **时钟**：`serve` 给模块的 `clock.now()` 是墙钟加一个只增的偏移量，偏移量只由控制入口改。没设口令时就是墙钟，不多一层判断之外的东西。模块命令的 `clock` 不变（命令是另一个进程，拨不到）。入口自己的时限（停止、就绪结果的复用、卡住的期限）仍用单调时钟，不受拨动影响。
- **定时任务**：`JobScheduler` 加“立即跑一次”：按模块名与任务名找；这个任务正在跑时等那一次 settle 再跑；与按间隔排的那一次共用“不叠着跑”的保证；停止开始之后不再受理。经它跑的任务出错时照常记 `job.failed`，并让调用方知道出了错。
- **路由**：在按主机分派之前挂上，与健康检查同一层；只有设了口令才挂。口令比较先各自取 SHA-256 再用 `timingSafeEqual`，不直接比字符串。没带或不对回 404，响应体与别的不存在的地址相同。启动时记一行 warn `site.test_control_enabled`。
- **包内用例**（`serve.test.ts` 与夹具模块）：夹具模块登记一个定时任务并有一个回显 `clock.now()` 的路由。没设口令 404；带错口令 404；拨时间后回显的时间往前走了、两次累加；`advanceMs` 为 0、负数、小数、缺失时 400；跑任务后看得到任务的效果；任务抛错得 `job_failed` 且日志有 `job.failed`；不存在的模块或任务 404 `not_found`；设了口令而监听 `0.0.0.0` 时 `config_invalid`、`not_loopback`；日志与标准错误里搜不到口令。
- **变异**：去掉口令比较（任何请求都放行）；去掉 `not_loopback` 的校验；让“立即跑一次”不等正在跑的那一次。

第 5 片的底座随之多两样：沙箱起进程时缺省带一个随机口令；`SiteProcess` 加 `advanceClock(ms)` 与 `runJob(module, job)`。本 Task 两个真实模块都没有定时任务，合同用例只测验收 5 那几条；“原始上报到期删除”“限流的时间窗”在 t06、t07 用它写。

留给 t07 的一点：Better Auth 自己读系统时间（会话到期、令牌到期），不经 `ModuleContext.clock`，控制入口拨不到它。t07 写计划前探清它有没有注入时间的口子；没有的话，这几条到期行为在包内测或把时长做成配置，写计划时定。
