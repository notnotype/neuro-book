# nb-site-server 包入口

本包位于 `packages/nb-site-server`，遵循仓库共享 Agent 合同 [`../../AGENTS.md`](../../AGENTS.md)。本文件除了本包的规则，还写官方站七个包共用的规则；其余六个包的 `AGENTS.md` 链接这里。

`@notnotype/nb-site-server` 是官方站的进程入口（[ADR 0059](../../docs/adr/0059-official-site-one-process-split-ready-modules.md)、[ADR 0061](../../docs/adr/0061-official-site-sqlite-file-per-module.md)）：命令行 `nb-site`，把账号与统计两个模块装进一个 Bun 进程，负责配置、每个模块的库连接与迁移、健康检查、日志、停止与备份。行为合同是 [`site/operations.md`](../../docs/specs/site/operations.md)；设计与切片见 w00037 t05 的计划。

## 七个包与依赖方向

| 包 | 职责 | 允许的工作区依赖 |
|---|---|---|
| `nb-site-identity-contract`、`nb-site-telemetry-contract` | 两个模块对外的 HTTP 合同：路径前缀与 schema | 无（运行时只许 `typebox`） |
| `nb-site-identity`、`nb-site-telemetry` | 两个模块：各自的库、迁移与 Hono 子应用 | 自己的合同包 |
| `nb-site-server` | 进程入口 | 两个模块包、两个合同包、`nb-flock`；开发依赖另许 `nb-site-web`（只给镜像构建找前端包的位置，`src/` 不导入） |
| `nb-site-contract-tests` | 黑盒合同测试，起真实进程、只经 HTTP | 运行时只许两个合同包；开发依赖另许 `nb-site-server`（只找启动命令） |
| `nb-site-web` | 前端 | 不许两个模块包与 `nb-site-server` |

各包的 devDependencies 都另许测试支持包。第三方通用包不限。前三行由本包的 `src/architecture.test.ts` 检查，合同测试包与前端包的清单由它们自己的 `boundary.test.ts` 检查；工作区里别的包要先加进检查里的白名单。模块包不导入本包：模块导出自己的迁移清单、读配置与建实例的函数，本包用适配器把它们包成进程入口认识的模块。拆成两个进程时只在本包加入口文件，模块包不动。

## 迁移

- 每个模块的迁移放在模块包的 `migrations/NNNN_<小写下划线名>.sql`：`NNNN` 是四位、模块内递增的编号，id 是去掉 `.sql` 的文件名。两个模块各自编号。
- 模块包的 `src/migrations.ts` 按编号逐个以 `with {type: "text"}` 导入；`src/migrations.test.ts` 核对清单与目录一一对应。
- 只往前（ADR 0061 决策 2）：发布过的迁移不能改，每个版本的迁移要让上一个版本照常运行，破坏性的改动拆到下一个版本。
- 纯 SQL，可以多条语句；运行器给每条迁移包一个 `BEGIN IMMEDIATE` 事务，里面再开一个守卫保存点。不能写 `PRAGMA`、`ATTACH`、`DETACH`、`VACUUM`（运行器按文字拒收）；不能结束运行器开的事务（`COMMIT`、`END`、`ROLLBACK`，之后再 `BEGIN` 也一样），执行完释放不了守卫保存点就按 `transaction_ended` 失败，但 `COMMIT` 之前的部分已经提交、撤不回；合同测试每次从空的数据目录启动，会把每条迁移执行一遍，发布前就会暴露。触发器的 `BEGIN … END`、迁移自己的保存点可以写。
- 触发器里 `RAISE` 的说明只写固定文字，不由数据拼成：迁移失败时 SQLite 的错误说明会原样进标准错误上的失败行（`dbMessage`）。
- 外键由运行器在事务外关掉、全部做完再打开，迁移里照 SQLite 文档的步骤重建表（建新表、拷数据、删旧表、改名）不会级联删掉子表；每条提交前跑 `PRAGMA foreign_key_check`，留下悬空引用的迁移被回滚。
- 库里的迁移账本是表 `site_migrations(id, checksum, applied_at)`，上一个版本的程序要读写它：三列的名字与含义不变，只许加可为空或带缺省值的列，读写一律写明列名。`applied_at` 是到毫秒的 ISO 8601 UTC；`checksum` 是去掉开头 BOM、换成 LF 之后的 SHA-256，执行的也是这份归一化之后的文字（字符串字面量里的 CRLF 落库成 LF）。
- 账本里有、清单里没有的迁移：编号比清单最大的还大，是更新的版本留下的，照常运行；不大于清单最大编号（合并后改号、只改名），拒绝运行。发布过的迁移不改号、不改名、不改内容。
- 源码与迁移里不许附加别的库（`ATTACH`），由 `src/architecture.test.ts` 检查。

## 模块怎样接进入口

- 模块交给入口的形状是 `src/module.ts` 的 `SiteModule`，产品的列表在 `src/modules.ts`。模块用到的入口（`site`、`ingest`）静态写在 `surfaces` 里；声明了 `ingest` 的模块装进进程时才要求 `NB_SITE_TELEMETRY_URL`。
- 模块的库连接（`ModuleContext.db`）归模块所有；入口不在上面执行语句，就绪检查另有一条不等锁的探测连接。连接上同一时刻只有一个事务，所以这条连接上的全部访问由模块自己排成一队，开跨 await 的事务的一方提交之前独占它（细节见 `ModuleContext.db` 的注释）。
- `create()` 可以是异步的；抛错或 reject 都按 `start_failed` 收口。
- 模块取时间用 `context.clock`，定时任务经 `context.jobs` 登记，不直接用 `Date.now()` 与 `setInterval`：入口在 `start()` 之后才开始调度、停止时在 `close()` 之前停掉。
- 要请求方地址时用 `context.clientAddress(c)`，不自己读 `X-Forwarded-For`；返回值不写进日志。
- 模块的子命令写在 `commands` 里，按 `access` 选 `exclusive` 或 `shared`（规则见 `SiteCommand` 的注释；`shared` 只在迁移期间拿锁）；命令名不能与 `serve`、`migrate`、`backup` 及别的模块的命令重名。会停下来等输入或跑很久的命令要看 `context.signal`，收手时 reject 为 `signal.reason`，入口报 `interrupted`。
- 日志与失败行的 `message` 用英文、`event` 与 `code` 是稳定的英文词；不放环境变量的取值、数据目录的路径、来源地址、请求头与请求体。错误只记类型。
- 备份副本里不该留的数据（统计模块的原始上报）在 `prepareBackupCopy` 里删：它拿到的是副本的连接，在备份命令的进程里调用，不经 `create()`。它是同步的，返回之前提交或回滚自己开的事务；写成 async 或留着事务时备份以 `prepare_failed` 失败。
- 只给测试用的夹具模块与入口放在 `src/testing/`，产品代码不引用（`src/architecture.test.ts` 检查）。

## 测试控制入口

合同测试与被测服务之间的约定（[`site/operations.md`](../../docs/specs/site/operations.md) 输出 11）：设了 `NB_SITE_TEST_CONTROL` 的 `serve` 多两个地址，`POST /test-control/clock` 把模块经 `context.clock` 取到的时间往前拨，`POST /test-control/jobs/run` 立即跑一次某个模块的定时任务。实现在 `src/test-control.ts`。

- 三道限制：不设口令时这两个地址根本不挂，与别的不存在的地址一样回 404；设了口令时监听地址只许本机回环（`127.0.0.0/8`、`::1`），否则配置校验以 `not_loopback` 拒绝；每个请求都要带 `Authorization: Bearer <口令>`，没带或不对同样回 404。口令是 32 到 256 个大小写字母、数字、`-` 与 `_`，放得进请求头。
- 生产环境与镜像都不设它。它只给合同测试用：合同测试起被测进程时每次生成一个随机口令。
- 口令是秘密：不进日志、失败行与响应体。拨过的偏移量属于 `serve` 的这一次运行，入口自己的时限（停止、就绪检查）按单调时钟算，不受拨动影响。
- 模块要让随时间变化的行为能被合同测试验证，就只经 `context.clock` 取时间、只经 `context.jobs` 登记定时任务；绕开它们的（例如第三方库自己读系统时间）拨不到。

## 部署

- 两个健康检查（`/health/live`、`/health/ready`）在任何主机名上都可用；反向代理只把它们开放给本机回环，不转发外部的请求。
- 停止的时间：`NB_SITE_SHUTDOWN_TIMEOUT_MS` 只管排空在途的 HTTP 请求；之后停定时任务至多 2 秒，再给每个模块的 `close()` 各至多 2 秒，最后关库、放锁（`src/commands/serve.ts` 的 `MODULE_CLEANUP_MS`）。容器的停止宽限（`docker stop -t`、Compose 的 `stop_grace_period`）因此至少是停止时限加 2 秒乘（模块数加 1），再留 1 秒余量；现在两个模块，就是比停止时限多 7 秒。宽限先到时容器会被 SIGKILL。缺省时限 10 秒与 `docker stop` 缺省的 10 秒相同，部署时要改其中一个。
- `NB_SITE_TRUSTED_PROXIES` 只写真正会转发请求的那一层代理的地址；写宽了，外面的人就能用伪造的 `X-Forwarded-For` 冒充来源地址。
- 网页（`site.operations` 输出 12）的 HSTS 与压缩由终结 TLS 的反向代理做：进程不发 `Strict-Transport-Security`，不压缩响应，也不发 `ETag`、`Last-Modified`。
- `NB_SITE_WEB_DIR` 的符号链接只在启动时解开一次：用一个链接指向某次发布、换指向来切换版本时，要重启进程。

### 镜像

`bun run build:image` 在构建机上把 `src/main.ts` 打成单个 `dist/image/server.js`（迁移的 SQL 已内联），再跑前端包的构建、用 `--outDir` 直接写进 `dist/image/web/`（不碰前端包自己的 `dist/`，与前端的 e2e 同时跑也不互相覆盖），连同 `image/Dockerfile` 以 `dist/image/` 为构建上下文打成 `nb-site:local`（`--tag` 改名，`--no-docker` 只出产物）；镜像里不装依赖。`bun run smoke:image` 对这个镜像起真容器核对下面几条，CI 的 `site-image` 作业每次都跑它，并对着产物再跑一遍合同测试。不推送镜像；按摘要固定基础镜像、推送与 Compose 在部署的 Task（t13）做。

- **环境变量的缺省**：镜像设了 `NB_SITE_HOST=0.0.0.0`（容器里只有监听 0.0.0.0 端口映射才通）、`NB_SITE_PORT=8080`、`NB_SITE_DATA_DIR=/data`、`NB_SITE_WEB_DIR=/app/web`（镜像里的前端产物，属主 root、对 `bun` 用户只读）；部署时只需给 `NB_SITE_URL`、`NB_SITE_TELEMETRY_URL`、`NB_SITE_SESSION_SECRET`、`NB_SITE_IDENTITY_TERMS_VERSION`。对外只开放给本机还是反向代理，由端口映射与 Compose 决定。
- **数据卷的属主**：进程以镜像里的 `bun` 用户（uid 1000、gid 1000）运行，`/data` 属于它。挂新的命名卷时 Docker 按这个属主初始化卷，直接能写；挂宿主目录时要让目录对 uid 1000 可写，或用 `--user <uid>:<gid>` 以目录属主的身份跑。数据目录不可写时启动以 `config_invalid`（`not_writable`）退出。
- **停止宽限**：按上面的公式，缺省时限 10 秒时容器的停止宽限至少 17 秒（`docker stop -t 17`、Compose 的 `stop_grace_period: 17s`）。bun 是容器的 1 号进程，自己处理 `SIGTERM`，不需要 `--init`；`smoke:image` 核对 `docker stop` 之后退出码 0、日志里有 `site.stopped`。
- **网页**：`smoke:image` 核对 `/` 回镜像里的 `index.html` 并带内容安全策略。产物在镜像里属于 root，`bun` 用户要读得到：构建机的 umask 把产物写成只有属主可读时，这些文件在容器里回 404，日志里有 `web.file_unreadable`（带错误码）。
- **不设测试控制口令**：镜像与生产环境都不设 `NB_SITE_TEST_CONTROL`。容器监听 0.0.0.0，设了它进程会以 `config_invalid`（`NB_SITE_HOST` 的 `not_loopback`）拒绝启动；`smoke:image` 核对这一条。

### 相邻版本

`site.operations` 输出 7 与验收 2：本版本迁移过、写过的数据目录，上一个版本的程序仍能启动、就绪并正常读写。CI 的 `site-image` 作业拿基准提交（PR 的 base、推送前的 master）当上一个版本：`bun run build:previous`（`image/build-previous.ts`）把基准提交克隆到 `--out` 下一棵独立的树里、装依赖、照那个提交自己的 `build:image --no-docker` 打出 `server.js`，再把命令与“上一个版本缺哪些接口”写进 `--command-out`（追加 `command=`、`without_ingest=`、`without_telemetry_jobs=` 三行）；合同测试的 `src/adjacent-version.test.ts` 用它们跑。没有基准（发布流水线调用、手动触发、基准不是祖先、基准早于 `image/build.ts`）时脚本只在标准错误写原因，不写命令，那一步跳过。

本机跑同一条：打包相关的验证在主工作区或干净克隆里跑（`docs/testing/README.md` 的验证门禁），不在 `.worktree/` 里。`--out` 放系统临时目录下，用完删掉；`bun install` 直连慢时在 `build:previous` 前加 `prox`。

```bash
base=$(git merge-base master HEAD)        # 或任一个带 image/build.ts 的祖先提交
out=$(mktemp -d)/nb-site-previous
bun run --cwd packages/nb-site-server build:previous --base "$base" --out "$out" --command-out "$out.env"
bun run --cwd packages/nb-site-server build:image --no-docker
cat "$out.env"                            # command=…、without_ingest=0|1、without_telemetry_jobs=0|1
NB_SITE_SERVER_COMMAND="[\"bun\",\"--no-env-file\",\"$PWD/packages/nb-site-server/dist/image/server.js\"]" \
NB_SITE_PREVIOUS_SERVER_COMMAND="$(sed -n 's/^command=//p' "$out.env")" \
NB_SITE_PREVIOUS_WITHOUT_INGEST="$(sed -n 's/^without_ingest=//p' "$out.env")" \
NB_SITE_PREVIOUS_WITHOUT_TELEMETRY_JOBS="$(sed -n 's/^without_telemetry_jobs=//p' "$out.env")" \
bun run --cwd packages/nb-site-contract-tests test src/adjacent-version.test.ts
rm -r "$(dirname "$out")"
```

上一个版本缺哪些接口由脚本按提交历史定：基准提交包含引入写入口的提交就算有写入口，包含引入两个定时任务的提交就算有任务（`git merge-base --is-ancestor`，两个提交号是脚本里的常量）；不看文件路径，文件改名或挪目录时不会把之后的基准都判成“没有”。用例不按上一个版本回的 404 自己判断。以后加了上一个版本可能还没有的接口、又要在相邻版本里测它时，照这个办法在脚本里加一项、在用例里加一个开关；t06 合入 master 之后，每个基准都有写入口与两个任务。

## 完成门禁

```text
bun run typecheck
bun test
```

改了官方站任一包，按受影响范围跑：`bun run test:affected --package <包> --with-consumers --typecheck`（每个包各写一次 `--package`）。改了依赖白名单或清单，七个包都跑一次。
