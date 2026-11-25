# nb-site-telemetry 包入口

本包位于 `packages/nb-site-telemetry`，遵循仓库共享 Agent 合同 [`../../AGENTS.md`](../../AGENTS.md)。官方站各包共用的规则（依赖方向、迁移、起服务、跑合同测试）在 [`../nb-site-server/AGENTS.md`](../nb-site-server/AGENTS.md)，本文件只保留本包的专属规则。

`@notnotype/nb-site-telemetry` 是官方站的统计模块（[ADR 0059](../../docs/adr/0059-official-site-one-process-split-ready-modules.md)、[ADR 0061](../../docs/adr/0061-official-site-sqlite-file-per-module.md)）：自己的 SQLite 库 `telemetry.db` 与它的迁移、挂在 `TELEMETRY_API_PREFIX` 下的 Hono 子应用、挂在写入口主机 `TELEMETRY_INGEST_PREFIX` 下的三个写入口，以及聚合与到期删除两个定时任务。行为合同是 [`site/telemetry-ingest.md`](../../docs/specs/site/telemetry-ingest.md)。

## 边界

- 工作区依赖只许自己的合同包 `nb-site-telemetry-contract`（devDependencies 另许测试支持包）；第三方通用包不限。由 `nb-site-server/src/architecture.test.ts` 检查。不依赖账号模块：要问身份时由入口的适配器把处理函数作为参数传进来。
- 不导入 `nb-site-server`：公开入口 `src/index.ts` 导出迁移清单、`parseTelemetryConfig` 与 `createTelemetryModule`，选项与返回值的类型由本包声明，进程入口的适配器对上形状。
- 只经交进来的连接读写自己的库，不附加别的库文件（`ATTACH`），由同一个架构测试检查源码与迁移。
- 迁移放 `migrations/NNNN_<小写下划线名>.sql`，在 `src/migrations.ts` 里按编号逐个导入；写法见入口包的“迁移”一节。

## 源码分工

- `src/validate.ts` 按合同包的收集清单校验请求体、归一成记录；判的先后照协议输出 13，不拿整份 schema 判。`src/store.ts` 把记录写进库，每次写是一个同步事务；数据库错误按结果码分类，不看文字。`src/days.ts` 是服务端日、心跳段与 ISO 周的换算，时间都由调用方传入。
- `src/ingest.ts` 是三个写入口：请求按协议输出 13 的先后走，每一步在哪个文件见它的文件头。来源地址只在这里取、只交给限流器，不进日志、错误与库；`src/architecture.test.ts` 核对 `clientAddress` 只在这个文件里被调用。`src/rate-limit.ts` 是限流，状态只在内存里，进程重启清零。
- `src/index.ts` 的 `createTelemetryModule` 把交进来的连接改成 `busy_timeout = 0`、`secure_delete = ON`，理由与成立的前提写在那里；改连接参数先看那段注释。它还登记两个定时任务、提供 `close()`（置“正在关闭”标志、等任务收手）。
- 定时任务的名字是 `aggregate` 与 `purge`（写在 Spec 的输入一节，测试控制入口按名字找）。`src/aggregate.ts` 是聚合：一批是一个读游标、算、推游标的同步事务，两个任务交错也不会重算；批的大小按最坏输入量过，改聚合语句或表之后用 `scripts/measure-ingest.ts --batches` 重量。`src/purge.ts` 是到期删除：先聚合、再按批删、最后截断检查点；聚合出错时怎样分两种写在文件头。`src/backup.ts` 的 `prepareTelemetryBackupCopy` 是备份时在副本上先聚合、再清空原始表，入口的适配器挂到 `prepareBackupCopy`。
- 包内测试的造数与模块实例在 `src/testing/reports.ts`、`src/testing/module.ts`（任务不进调度器，由测试直接调 `run()`）。
- 包内测试用 `src/testing/db.ts` 建真的库：本包不能依赖入口，它只照入口运行器的做法执行迁移；经真实运行器建库由合同测试覆盖。

## 完成门禁

```text
bun run typecheck
bun test
```

改了本包，另跑 `nb-site-server` 与 `nb-site-contract-tests` 的 `bun test`（`test:affected` 按依赖图会选中它们）。
