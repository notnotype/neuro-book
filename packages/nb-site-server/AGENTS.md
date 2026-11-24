# nb-site-server 包入口

本包位于 `packages/nb-site-server`，遵循仓库共享 Agent 合同 [`../../AGENTS.md`](../../AGENTS.md)。本文件除了本包的规则，还写官方站七个包共用的规则；其余六个包的 `AGENTS.md` 链接这里。

`@notnotype/nb-site-server` 是官方站的进程入口（[ADR 0059](../../docs/adr/0059-official-site-one-process-split-ready-modules.md)、[ADR 0061](../../docs/adr/0061-official-site-sqlite-file-per-module.md)）：命令行 `nb-site`，把账号与统计两个模块装进一个 Bun 进程，负责配置、每个模块的库连接与迁移、健康检查、日志与停止。行为合同是 [`site/operations.md`](../../docs/specs/site/operations.md)；设计与切片见 w00037 t05 的计划。

## 七个包与依赖方向

| 包 | 职责 | 允许的工作区依赖 |
|---|---|---|
| `nb-site-identity-contract`、`nb-site-telemetry-contract` | 两个模块对外的 HTTP 合同：路径前缀与 schema | 无（运行时只许 `typebox`） |
| `nb-site-identity`、`nb-site-telemetry` | 两个模块：各自的库、迁移与 Hono 子应用 | 自己的合同包 |
| `nb-site-server` | 进程入口 | 两个模块包、两个合同包、`nb-flock` |
| `nb-site-contract-tests` | 黑盒合同测试，起真实进程、只经 HTTP | 运行时只许两个合同包；开发依赖另许 `nb-site-server`（只找启动命令） |
| `nb-site-web` | 前端 | 不许两个模块包与 `nb-site-server` |

各包的 devDependencies 都另许测试支持包。第三方通用包不限。前三行由本包的 `src/architecture.test.ts` 检查，合同测试包与前端包的清单由它们自己的 `boundary.test.ts` 检查；工作区里别的包要先加进检查里的白名单。模块包不导入本包：模块导出自己的迁移清单、读配置与建实例的函数，本包用适配器把它们包成进程入口认识的模块。拆成两个进程时只在本包加入口文件，模块包不动。

## 迁移

- 每个模块的迁移放在模块包的 `migrations/NNNN_<小写下划线名>.sql`：`NNNN` 是四位、模块内递增的编号，id 是去掉 `.sql` 的文件名。两个模块各自编号。
- 模块包的 `src/migrations.ts` 按编号逐个以 `with {type: "text"}` 导入；`src/migrations.test.ts` 核对清单与目录一一对应。
- 只往前（ADR 0061 决策 2）：发布过的迁移不能改，每个版本的迁移要让上一个版本照常运行，破坏性的改动拆到下一个版本。
- 纯 SQL，可以多条语句；运行器给每条迁移包一个 `BEGIN IMMEDIATE` 事务。不能写 `PRAGMA`、`ATTACH`、`DETACH`、`VACUUM`（运行器按文字拒收）；不能结束运行器开的事务（`COMMIT`、`END`、`ROLLBACK`），执行后查出来就失败，但 `COMMIT` 之前的部分已经提交；合同测试每次从空的数据目录启动，会把每条迁移执行一遍，发布前就会暴露。触发器的 `BEGIN … END` 可以写。
- 外键由运行器在事务外关掉、全部做完再打开，迁移里照 SQLite 文档的步骤重建表（建新表、拷数据、删旧表、改名）不会级联删掉子表；每条提交前跑 `PRAGMA foreign_key_check`，留下悬空引用的迁移被回滚。
- 库里的迁移账本是表 `site_migrations(id, checksum, applied_at)`，上一个版本的程序要读写它：三列的名字与含义不变，只许加可为空或带缺省值的列，读写一律写明列名。`applied_at` 是到毫秒的 ISO 8601 UTC；`checksum` 是去掉开头 BOM、换成 LF 之后的 SHA-256。
- 账本里有、清单里没有的迁移：编号比清单最大的还大，是更新的版本留下的，照常运行；不大于清单最大编号（合并后改号、只改名），拒绝运行。发布过的迁移不改号、不改名、不改内容。
- 源码与迁移里不许附加别的库（`ATTACH`），由 `src/architecture.test.ts` 检查。

## 完成门禁

```text
bun run typecheck
bun test
```

改了官方站任一包，按受影响范围跑：`bun run test:affected --package <包> --with-consumers --typecheck`（每个包各写一次 `--package`）。改了依赖白名单或清单，七个包都跑一次。
