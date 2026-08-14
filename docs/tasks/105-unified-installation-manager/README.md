# 105 - 统一安装目录与 NeuroBook Manager

> 当前状态：实现中，Canary A公开索引已完成。`v0.8.19`的五平台Product、原生双架构OCI/manifest merge、Windows/Linux候选、公开payload、Windows完整`0.8.6 data/`复用、Docker x64/ARM64与rootless Podman链全部通过，最终`release-manifest.json`和`SHA256SUMS`已发布；它是最新已确认完整canary。当前工作树协议为Installation Manifest v5、Release Manifest v5、Operation Journal v5 和 Product-owned Application State catalog v3。2026-08-03 已实现外置 heartbeat lease、锁内 Manifest 重读、Product切换恢复、Windows外置自卸载Host与Draft Candidate激活协议，并使用公开Manager `.49`完成clean Windows归档、仓库外Product/Manager运行与两种自卸载终态验收。公开Canary A→B、跨Profile和五平台Candidate仍需Actions完成，不能把本地Windows证据写成公开生命周期已验证。Apple Silicon Docker Desktop/rootless Podman实机门禁继续豁免，但不得标记为已验证。

## 2026-08-14：Issue #109 Podman Compose 迁移与 provider 选择修复

- 根因已复现并固定为两个 Manager 合同缺口：`compose run` 的 Podman provider 会在迁移 JSON 前输出裸容器 ID，而迁移解析器直接对完整 stdout 执行 `JSON.parse()`；同时 Podman provider 环境变量无条件写成 `podman-compose`，阻断仅提供 `podman compose` 委托能力的机器。
- `packages/neuro-book-manager/src/app-commands.ts` 现在从首个以 `{` 开始的输出行解析迁移报告，保留报告 schema、runId、step 唯一性和状态门禁；`packages/neuro-book-manager/src/docker.ts` 先用 `commandAvailable("podman-compose")` 探测独立 provider，存在时固定 `PODMAN_COMPOSE_PROVIDER=podman-compose`，不存在时不新增变量并保留用户已有值。
- 回归覆盖前置 64 位 hex ID、独立 provider 存在、独立 provider 缺失且用户已设置 provider、独立 provider 缺失且用户未设置 provider，以及 `podman compose` 委托探测路径。相关调用点已改为等待异步 Compose 选项，Docker provider 行为保持不变。
- 验证：`bun run test -- src/docker.test.ts src/app-commands.test.ts` 为 2 个文件、59 项测试通过；`bun run test` 为 41 个文件通过、1 个跳过，336 项测试通过、3 项跳过；`bun run typecheck` 通过。
- 本机没有 `podman` 或 `podman-compose` 命令，未执行 macOS / Podman machine 真实安装、更新、迁移和健康检查；上述委托分支由隔离命令探测模拟覆盖，真实双路径仍需 Linux/macOS 容器 runner 复验。

## 2026-08-02：Installation Mutation、自卸载与发行候选治理

- 所有 mutating command 进入用户级外置 `proper-lockfile` lease。Installed v1固定 `%LOCALAPPDATA%/Programs/NeuroBook` 与单一 `installed-v1` lease；Portable/Source以canonical Installation Root SHA-256隔离。lease不受Manager配置路径影响，也不会随卸载删除。
- 锁内顺序固定为：检查pending uninstall、恢复Operation、重读磁盘Manifest、验证固定Installed布局，再交给业务命令。调用前Manifest只用于定位；Manifest缺失时不创建目录或复活实例。ZIP/Gzip改为异步fflate，业务错误与lease释放错误都保留。
- Operation migration新增`applying`；`planned`恢复不调用Product，`applying`允许runner返回`not_started`，`applied`严格拒绝。Native Product双rename使用operation-owned immutable migration root；rollback cleanup error留在Journal并由下一次mutation重试，全部清理成功后才删除Journal。
- Source adoption worktree进入`.deploy/staging/<operation-id>`。start、migration、admin、reset和uninstall统一从`VerifiedApplicationExecution`取得Source Dev、Native Product或Container Product身份；status仍保留轻量控制面。
- Windows Portable/Installed从受管Bun执行卸载时，Manager写入带token和SHA-256的durable intent并启动Installation Root外的PowerShell Host。Host等待精确父PID退出后重新验证owner roots：默认删除程序、cache、desktop和logs并保留State Root；`--delete-data`才删除全部。intent篡改时零删除并写外置失败结果，pending intent阻断其他mutation。
- Release Manifest硬切v5并增加统一build ID。Source/Product/Portable/Installation由最终Verifier重新连成同一代；CLI只创建Draft并显式dispatch release ID、tag、revision、prerelease。候选OCI只使用`candidate-<release-id>`，全部正确性gate后才公开Release，再由独立可重跑job激活版本tag和stable `latest`。
- 当前验证：Authoring 9 files / 114 tests；Windows uninstall 3 files / 18 tests及真实PowerShell Host三种路径；Manager 37 passed files / 1 skipped、248 passed / 3 skipped，typecheck与pack通过；Release focused 8 files / 56 tests。clean Windows Portable 进一步完成31项doctor、完整Product Contract、Manager HTTP登录和两种真实外置Host卸载；本节仍不等于公开Candidate结果。

## 2026-08-01：发行前只读审计与下一阶段阻断

- Windows Installed 当前允许不同 Installation Root 共用同一组 Local App Data roots，却按 Installation Root 分裂锁；v1 将固定唯一 `%LOCALAPPDATA%/Programs/NeuroBook`，并把 mutating operation lease 移到 Installation Root 外。Portable/Source 继续按 canonical root 隔离。
- start、admin、migration 与已有 Container 执行尚未统一消费完整 Product Runtime Image / Compose / OCI identity 验证；`doctor` 通过不代表执行入口已经 fail closed。
- Operation Journal 的 migration 只有 `planned/applied/rolled_back`，无法表达 apply 已开始但尚未记账；Product rename 中断、committed journal 绝对 root、卸载未先恢复 Operation 和锁内旧 Manifest fallback 仍需系统收口。
- Source Dev adoption 把 staged worktree 放在 `%TEMP%`，却又要求 `migrationRoot` 位于 Installation Root 内，当前链路按自身 schema 无法完成。
- 现有 `install.lock` 不能从强杀可靠恢复；改用 heartbeat lease 时必须同步移除锁内 ZIP/Gzip 同步解压，否则活 owner 可能被误判 stale。
- 本节只修正文档完成度；实现留在整版 checkpoint 之后，避免把审计修复混入已有跨 Task 变更。

## 2026-08-01：Verified Application Execution checkpoint

- start、admin 与 Application State migration/recovery 已统一通过 `VerifiedApplicationExecution`。Source Dev 使用显式开发 Adapter；Native Product 在 spawn 前完整复核 Runtime Image、Application Bun 与受管工具；Container Product 复核 Compose、OCI digest、Engine image ID、Container image/config identity、版本和健康状态。
- Product bootstrap 在解析命令前再次完整自验，并清除 `NODE_PATH`；非入口 payload、ready marker、Compose、tag/digest 或 Container image identity 被篡改时都在执行前失败。
- 当前仍未完成的 Manager 阻断没有被这次执行入口修复掩盖：外置 heartbeat lease、锁内 Manifest 重读、Operation `applying` checkpoint、卸载前恢复、committed journal 清理、异步解压与 Source adoption staging 仍需由 `InstallationMutation` 收口。
- 验证为 Manager 34 passed files / 1 skipped、220 passed tests / 2 skipped，release contract 1/1，Manager typecheck 与 pack 通过；本机没有 Docker/Podman，真实 Container 仍只由 CI runner 验收。

## 2026-07-28：Catalog v3 与健康启动提交点

- Application State catalog v3 固定为 `app-sqlite → agent-attachment-v1 → agent-session-v2 → agent-session-v2-review-repair`。migration-only registry 可解析 v1/v2/v3 sentinel 与 journal；complete 旧 catalog 创建新 v3 run，incomplete 旧 run 只能 resume/rollback，future catalog 与损坏/checksum 冲突 fail closed。
- v3 journal 保存进入 run 前 sentinel 的原始 bytes、存在性和 SHA-256；rollback 逐字节恢复。apply/resume/rollback 在顶层 Application State lease 内完成状态复核和提交，手工 CLI 与 Manager/另一个 CLI 不再能并发修改同一 State Root。
- Manager Operation Journal 升级为 v5，正式记录 `action: "start"`；v3/v4 只在读取边界转换。候选 Product plan 发生在停服务、备份、切换和状态修改前，runId 先进入 Journal。
- native、Windows Portable 与 container 共用 `ApplicationLaunch`。migration apply 后必须通过目标 `/api/app/version` 与健康检查才提交 Operation；ready 前失败先精确终止本次候选，再回滚 Product migration、外层数据库备份和组件。容器终止使用本次 `startDocker()` 发布的精确 container id，不重新查询 Compose 当前容器。
- 容器 identity 现已从内存 handle 提升为 Operation Journal v5 的 `candidate-container` effect。Compose 进入可能创建候选前先写 planned 屏障，读取精确 id 后、HTTP 健康检查前写 applied；install/update/start 都使用同一异步 lifecycle callback。崩溃恢复第一步按 id 停止并 durable 标记 `stopped: true`，然后才允许 migration/database/Product rollback；只有屏障没有 id 时保留 Journal 并 fail closed。
- Native 崩溃恢复不使用 PID 文件。Windows 继续由 Job Object 监督器收口；POSIX Owned Process 改为轻量 supervisor 持有独立 process group，Manager IPC 断开时执行同一 TERM→KILL 有界清理。这样 Manager 在候选健康检查期间异常退出，不会让 POSIX Product 脱离本次 ApplicationLaunch 所有权。
- 删除了零调用的旧 `startApplication()` 直启旁路；Manager start 的唯一执行入口保持 `startInstallationApplication()`，因此不能绕过 plan、Operation Journal、候选 ownership 和健康提交点。
- 最终失败链审查发现两个恢复漏洞：Source Dev install 会先删除 staging worktree 再调用 Product rollback，update 则在 rollback 失败后仍删除 worktree；多个入口还会吞掉候选终止或自动恢复错误。现统一为“确认候选终止 → 恢复 Journal → 恢复成功后才清理 staging”，终止失败时禁止状态回滚，恢复失败时保留 Journal、staging 与 backup，并同时报告原始错误和恢复错误。
- install/update 现在由外层事务持有验证 launch 直到 Operation commit。健康后、Manifest/wrapper/git 提交前发生错误时仍能按精确 handle 终止候选；container update/adopt 恢复操作前的 running/stopped 状态，Fresh container install 保持启动后的既有行为。Docker `ready` 失败的派生 `completion` 由 Manager 内部观察，避免未等待 completion 时产生进程级 unhandled rejection。
- Windows Portable `--no-health-check` 现在只允许 migration plan 为 `already_current`；存在状态升级时必须完成健康检查。ready 后的正常退出只返回进程结果，不回滚已提交 migration。
- planner 不再把 complete v3 sentinel 直接等同于 `already_current`。`applied` step 可永久投影完成，动态或曾 `skipped` 的 step 必须重新 preflight；Session v2 自有 sentinel 与 review repair dry-run 会共同决定是否建立同 catalog 的新 run。
- install/adopt/update/start 现在共用 migration transaction 顺序。同版本 update 仍运行当前 Product plan；若报告 `planned`，执行 migration-only update、外层 SQLite 备份、健康验证和提交，而不是提前返回 unchanged。
- 原生 runner 检查改为按 Profile 检查真实 bootstrap：Source Dev 检查 `scripts/db/migrate-application-state.ts`，Product/Portable 检查 Product command bootstrap，Container 不读取宿主文件。此前把命令数组 `args[0]` 当文件路径会让 Product Bun、Source Product 和 Portable 在 plan 前误报 runner 不存在。
- Container start 明确区分操作前 `running/stopped/missing`。已有 running deployment 只验证健康，不发布 candidate；stopped/missing 才把新启动的精确 container id 交给 launch ownership。存在迁移时 running deployment 会先停止，失败恢复回到原运行状态。
- Docker Product entrypoint 已删除独立数据库迁移。非 Manager 直接启动只经过 Application State readiness gate，不会在 Nitro 启动旁路修改 SQLite；Manager 的 one-off runner 仍执行完整 catalog。
- 最终 Manager suite 为 33 files passed / 1 skipped、209 tests passed / 2 skipped；typecheck、build、pack 与临时安装 smoke 均通过。Docker/Release 入口合同 17 项通过。Source runner 在隔离空 State Root 实跑 `plan → apply → already_current`；Product Runtime Image 后处理仍被 Task 130 的 `profile-compile-worker.mjs` 绝对路径、`.bun` 路径与未登记 `node-fetch` package island 阻断，因此没有把 staging command 记作 Product bundle smoke。正式 Source/Product/Container/Portable 跨版本公开矩阵仍是发布门禁。
- 当前 Windows 主机没有可用 POSIX Bun/Node 或 Docker，所以 POSIX 宿主断连与真实容器运行状态恢复只完成类型、bundle 和跨平台测试接线，必须由现有 Linux/macOS/container runner 执行后才能记为实机通过。

## 2026-07-28：App SQLite 接入统一 Application State 迁移事务

- Task 118 建立统一 Application State catalog / runner。本段记录当时的 catalog v2 checkpoint；现行 v3 合同见上一节与 [ADR 0008](../../adr/0008-application-state-catalog-evolution.md)。
- Manager 的 install/update/start 共用候选 Product migration interface。只要 plan 报告 App SQLite 有待应用 migration，Manager 就先在 Operation Journal 写入 planned `sqlite-backup` effect，完成 WAL checkpoint 与冷备份后标记 applied，再让候选 Product 执行统一 migration；容器 Profile 仍通过一次性应用容器执行同一入口。
- 删除了 catalog 外的重复 `migrateDatabase()` 调用。Product runner 按 migration 目录与 `_prisma_migrations` 只读规划，每条 SQL 与对应 migration 记录在同一 SQLite 事务提交；Product step 自己保存 backup/checkpoint 以 resume 或 rollback，Manager 保存外层数据库快照和 Operation Journal 以恢复整个安装事务。
- 直接 `bun run dev` 现在先执行 `migration:check`。Product launcher 和 Nitro 最早插件还会各自只读复核，防止直接运行 `nuxt dev` 或 `.output/server/index.mjs` 绕过；无 pending 时不得创建数据库、备份或 migration 记录。
- 验证：Manager 迁移聚焦 17 项通过，完整 suite 为 164 项通过、2 项按平台跳过，Manager typecheck 通过；Product build 与 runtime vendor/产物断言通过。旧 App SQLite 的 `siteBaseUrl NOT NULL` 夹具会准确列出 `20260727210000_fix_official_passport_origin`，apply 后 schema 与记录正确，再次 check 保持文件大小、mtime 和目录内容不变。
- 当时验证的真实 State Root 是 complete catalog v2 与 Session schema v2；本轮只在隔离复制数据上演练 v3 与 repair，没有再次改写真实 State Root。自动升级不依赖应用版本号；Manager-managed install/update/start 运行 catalog，非 Manager 启动只提示显式运行 `bun run migrate:application-state -- --apply`。

## 2026-07-25：Windows Portable无健康检查临时启动参数

- Issue #13显示服务可正常使用，但Manager在120秒后仍报告`/api/app/version`未通过并终止Product。当前缺少用户机器日志，不能把探测失败的具体原因写成已确认根因。
- Manager `start`新增`--no-health-check`，仅允许`windows-portable`使用。它保留中断Operation恢复、数据库与Attachment迁移、State Root检查和前台Product等待，只跳过HTTP轮询、超时终止与自动打开浏览器；默认启动合同不变。
- 参数通过正式Manager入口传递到`startInstallationApplication()`和`startApplication()`，不会修改Portable launcher模板。现有`0.8.19`压缩包可用公开Manager `.30`临时运行，无需重新发布应用或Portable资产。
- 回归覆盖无HTTP/浏览器调用、迁移后选项传递、非Portable迁移前拒绝；packed CLI审计要求`start --help`包含新参数。
- 本地验证：Runtime与Manager typecheck通过；Manager完整suite为29文件154项通过，另1文件/2项按平台跳过；pack审计生成5文件、约0.38 MiB tarball，并在临时目录真实安装后确认新参数存在。
- Manager `.30`发布workflow [`30152514456`](https://github.com/notnotype/neuro-book/actions/runs/30152514456)全绿；npm精确版本、`canary` dist-tag与`gitHead`一致，全新Bun缓存中的公开包返回`.30`且`start --help`包含`--no-health-check`。本轮没有创建应用Release或重新打包Windows Portable。

## 2026-07-20：`0.8.18` 不可变容器镜像身份

- Release workflow [`29736480814`](https://github.com/notnotype/neuro-book/actions/runs/29736480814)证明Podman `ps --quiet`与唯一容器ID Adapter生效；安装、migration、启动、管理员创建、登录和running doctor的容器查询均已越过。
- doctor读取到Manifest/Compose期望`ghcr.io/notnotype/neuro-book:tag@sha256:...`，Podman实际返回`ghcr.io/notnotype/neuro-book@sha256:...`。repository与digest完全一致，只有可变tag别名被provider规范化移除；旧整字符串比较因此误报degraded。
- Installation Health新增严格不可变身份比较：双方带digest时要求规范化repository与SHA256都一致，忽略tag；任一无digest时继续精确字符串比较。该规则同时用于Compose与运行容器，不影响Source Docker本地revision image。
- 新增Podman省略tag成功、相同digest但不同repository拒绝、既有错误镜像拒绝回归。Manager bundle变化进入`.29`，下一应用patch为`0.8.19`。

### 验证与计划差异

- 这一失败不是第四个Compose provider命令差异，而是两个OCI客户端对同一不可变引用的合法显示差异。修复位于Installation Health身份层，不修改Manifest、Compose或Podman Adapter。
- 容器身份与Adapter聚焦19项、Release合同8项、Manager typecheck与5文件pack审计通过；完整Manager suite最终为29文件152项通过，另1文件/2项按平台跳过。首次完整suite的既有PowerShell参数转发夹具一次退出66，隔离连续两轮及随后完整suite均通过，未修改该无关用例掩盖抖动。
- Manager `.29` workflow [`29738493614`](https://github.com/notnotype/neuro-book/actions/runs/29738493614)全绿，npm精确版本、`canary` dist-tag、gitHead和全新缓存bunx一致。
- 应用workflow [`29738619452`](https://github.com/notnotype/neuro-book/actions/runs/29738619452)最终全绿：rootless Podman完整通过running doctor、原生stop后容器保留、stopped doctor warning、restart、登录和planned Operation恢复；Docker双架构与Windows完整`data/`复用同时通过，`publish-index`成功。
- 公开Release共12个资产；`release-manifest.json`固定Manager `.29`、source revision和GHCR digest，`SHA256SUMS`包含其余11个公开资产。Canary A因此完成，但A→B事务update尚未执行，Task 105保持实现中。
- 原生OCI实测amd64 8.0分钟、ARM64 7.2分钟、merge 0.2分钟，Windows Product/Portable 9.3分钟，完整workflow 27.4分钟；旧单runner QEMU容器job约47分钟。首阶段关键路径已回到Windows Product，暂不继续改缓存或Dockerfile。

## 2026-07-20：`0.8.17` Podman唯一容器查询Adapter

- Release workflow [`29734199679`](https://github.com/notnotype/neuro-book/actions/runs/29734199679)再次通过原生双架构OCI、manifest merge、五平台Product、Windows/Linux候选、公开payload与Docker x64/ARM64链；rootless Podman越过`config --images`后，失败于`podman-compose 1.0.6 ps --all --quiet app`。
- 对1.0.6源码的能力审计确认：`ps`只声明`-q/--quiet`，其实现内部固定调用`podman ps -a`并用`io.podman.compose.project`过滤；`pull/up/run/down`当前使用参数均受支持。
- `docker.ts`新增唯一容器ID读取Adapter：Docker保留`--all --quiet app`，Podman使用`--quiet`；两边统一解析0/1个合法ID。inspect与stop复用该Adapter，不再各自复制Compose参数。
- generated Compose schema同步收紧为仅允许`services.app`，使Podman project级`ps --quiet`的“唯一容器”假设由配置类型合同证明；额外service不会被静默纳入状态或停止操作。
- 公开GHCR脚本同步改用Podman `ps --quiet`并保留ID门禁。下一Manager为`.28`，应用为`0.8.18`；失败的`0.8.17`不发布最终索引。

### 验证与计划差异

- 本轮在第三次provider差异后从单命令修复升级为完整Compose调用面审计，避免继续逐个等待公开链暴露；没有替换Podman provider、放宽doctor或增加版本fallback。
- 自动化已覆盖Podman命令不含`--all/app`、非法/多ID拒绝、Docker参数保持和脚本合同：聚焦17项、Release合同8项、Manager完整29文件150项通过，另1文件/2项按平台跳过；Manager typecheck、5文件pack审计与GHCR脚本`bash -n`通过。真实停止/重启仍以新公开workflow为最终证据。

## 2026-07-20：`0.8.16` Podman Compose镜像读取合同

- Release workflow [`29731981264`](https://github.com/notnotype/neuro-book/actions/runs/29731981264)证明上一轮两项改动均生效：Podman已越过Docker Health字段；amd64/ARM64原生OCI job并行完成，多架构manifest merge成功。
- 实际OCI时间从旧单job约47分钟降到两个原生job均约7分钟，merge约20秒。五平台Product与Windows Portable、Windows/Linux候选、公开payload也全部通过，Actions关键路径已回到Windows Product/Portable。
- rootless Podman安装、镜像拉取、migration、启动、管理员创建和HTTP登录成功；运行态doctor随后失败于`podman-compose 1.0.6 config --images`。该provider只实现`config`，不接受Docker Compose的`--images`扩展。
- generated Compose本来就是Manager写入、schema验证并由Installation Manifest约束的配置真相。`inspectDockerApplication()`现复用`readDockerComposeImage()`读取固定app镜像，再让Container Engine查询真实容器状态；不增加Podman命令特判、fallback或宽松解析。
- Manager bundle变化要求发布精确`.27`；`0.8.16`继续保留为无最终索引的审计prerelease，下一应用patch为`0.8.17`。

### 验证与计划差异

- Podman回归必须证明状态探测既不调用Health模板，也不调用Compose `config`；Docker/Podman的实际镜像仍与generated Compose固定镜像比较。
- Podman/Docker健康聚焦17项通过；Manager完整suite为29文件150项通过，另1文件/2项按平台跳过；Manager typecheck、5文件pack审计与Release合同8项通过。
- 原计划只预期修复Health字段；增强诊断后暴露第二个provider能力差异。修复收口到已有Compose读取Module，没有在doctor或脚本中加入provider版本分支。

## 2026-07-20：`0.8.15` Podman运行态探测与OCI构建关键路径

- Release workflow [`29725087505`](https://github.com/notnotype/neuro-book/actions/runs/29725087505)通过五平台Product、Windows候选与完整`0.8.6 data/`复用、Docker x64/ARM64公开GHCR用户链；rootless Podman在运行态doctor失败，因此`publish-index`按设计跳过。
- 日志确认Podman Compose provider、Product SIGTERM和原生Podman stop均已生效。本轮失败发生得更早：`inspectDockerApplication()`无条件读取Docker模板`{{if .State.Health}}...`，Podman 4.9没有同一字段合同。Adapter现只对Docker读取Health；Podman仍通过status、exit code与HTTP版本探针完成健康判断，不放宽doctor。
- 公开GHCR脚本在运行态doctor失败时同步输出service与全部fail checks，避免下一次平台差异只留下退出码1。Manager bundle变化，下一精确版本为`.26`，不能覆盖`.25`。
- Actions步骤时间证明旧`build-and-push`的主瓶颈是x64 runner经QEMU执行ARM64 Nuxt：ARM64 `nuxt:build`约30分47秒、amd64约2分51秒、`mode=max`缓存导出约8分8秒；Windows Product完整job约10分钟、Linux x64 Product约3分钟。
- OCI构建改为两个原生runner矩阵：amd64使用`ubuntu-latest`，ARM64使用`ubuntu-24.04-arm`；两端分别按digest推送runtime/app，轻量merge job验证恰好两个digest并创建release tag的多架构manifest。`assemble`及GHCR验证统一消费merge输出，五平台Product继续只依赖preflight/source，不等待OCI。
- 本轮没有把ARM64或amd64从Release Manifest移除，也没有让它们绕过最终索引门禁；“Product优先”通过消除QEMU关键路径实现，而不是发布不完整Manifest。后续以首次真实原生runner数据决定是否继续调整缓存，不先重写Dockerfile或引入第二套Product/OCI组装协议。

### 验证与计划差异

- Podman状态探测与Docker健康回归聚焦17项通过；Manager完整suite为29文件150项通过，另1文件/2项按平台跳过；Manager typecheck与5文件pack审计通过；根typecheck及Release资产/checksum合同2文件8项通过，GHCR脚本`bash -n`通过。
- 原生runner与manifest merge仍需下一次公开Release workflow取得真实耗时和digest证据，不能把本地YAML合同测试写成Actions已通过。
- 与此前“Container Packaging直接消费原生Linux Product Artifact”的设想相比，本轮选择更小且边界清晰的原生BuildKit拆分：不改变OCI镜像内容来源，只替换执行架构和发布manifest的编排方式。

## 2026-07-20：`0.8.14` rootless Podman停止语义

- Release workflow [`29720984170`](https://github.com/notnotype/neuro-book/actions/runs/29720984170)的Linux preflight真实父子进程SIGTERM测试通过；首次OCI因ARM64 QEMU下载`effect` tarball解压失败，原地rerun后越过同点并完成构建，未创建无意义新版本。
- Docker x64与ARM64公开GHCR链完整通过，证明Product launcher能在默认10秒窗口内停止，停机doctor、restart、登录和Operation恢复合同成立。
- rootless Podman在0.6秒内完成SIGTERM停止，但`podman-compose 1.0.6 stop app`随后执行`podman rm`。这不是Product信号问题，而是provider命令语义与Manager所需“停止但保留容器”不一致。
- Container Engine Adapter现明确分流：Docker使用Compose stop；Podman使用Compose `ps --all --quiet app`解析唯一容器ID，再执行原生`podman stop --time 10`。非法或多ID输出拒绝，空ID保持幂等。
- 公开GHCR脚本同步使用同一Adapter语义并增加合同断言。Manager bundle发生变化，必须先发布`.25`，应用patch再精确引用；不能复用`.24`同版本覆盖。
- 与原计划差异：SIGTERM修复已由Docker双架构公开链验证，但Canary A仍因Podman失败没有最终Manifest/SHA256SUMS，Task 105继续保持实现中。

## 2026-07-20：`0.8.13` Product容器SIGTERM链路

- Release workflow [`29716399007`](https://github.com/notnotype/neuro-book/actions/runs/29716399007)再次通过五平台Product、多架构OCI、候选/公开payload和Windows `0.8.6`完整`data/`复用；最终索引因三条GHCR链失败而跳过。
- `.24`的Podman修复已由日志证实：Manager安装、migration、start与admin全部明确委托`podman-compose 1.0.6`，不再调用Docker plugin。因此第一轮provider根因已关闭。
- Docker x64/ARM64和Podman均在`stop`等待10秒后强制SIGKILL。根因不在doctor：Dockerfile的shell ENTRYPOINT已经exec，但`product-start.mjs`又spawn Nitro server且没有转发PID 1收到的SIGTERM。
- Product launcher现统一转发SIGINT/SIGTERM并等待Nitro退出。新增POSIX真实父子进程回归，Release preflight在昂贵fan-out前要求子进程收到SIGTERM且launcher 5秒内退出；Windows本地按平台跳过信号测试。
- rootless Podman安装步骤也固定`PODMAN_COMPOSE_PROVIDER=podman-compose`执行版本预检，使runner预检与Manager运行时使用同一provider合同。
- 与上一轮计划差异：把137加入doctor正常退出集合会掩盖真实的信号转发缺陷，已明确否决；修复位于Product进程生命周期层，Manager bundle未变化，因此不发布新的Manager版本。

## 2026-07-20：`0.8.12`公开GHCR停机与Podman provider回归

- Release workflow [`29711720389`](https://github.com/notnotype/neuro-book/actions/runs/29711720389)完成五平台Product、双架构OCI、Windows/Linux候选、公开payload和Windows `0.8.6`完整`data/`复用；`publish-index`因三条GHCR用户链失败而跳过。
- Linux x64与ARM64 Docker链已完成安装、管理员创建、登录和运行态doctor，失败发生在`compose stop`后的doctor。真实容器由SIGTERM退出为143，旧状态映射只接受0，错误报告为degraded。现在143归入受控停止，退出码1仍是异常。
- rootless Podman链在Attachment migration阶段失败。Ubuntu runner同时存在Docker Compose plugin时，Podman 4.9会把`podman compose`委托给Docker plugin并连接错误daemon。Container Engine Adapter现在为所有Podman Compose调用固定`PODMAN_COMPOSE_PROVIDER=podman-compose`；公开脚本也使用相同合同。
- 新增Podman provider、SIGTERM正常停止与异常退出回归；Manager完整suite为29文件通过、1文件按平台跳过，147项通过、2项跳过。Manager typecheck与Release资产合同通过。
- 与原计划差异：Windows完整`data/`复用已经取得公开资产证据，但Canary A仍不能视为完成，因为最终Manifest/SHA256SUMS没有发布；下一patch必须重新执行三条GHCR链并成功发布最终索引。

## 2026-07-19：Operation Journal v3与资产ownership收口

- Journal硬切v3并引入严格`InstallationRelativePath`；拒绝空值、`.`、绝对路径、盘符、UNC、空segment与`..`。未完成v1/v2不自动恢复，已提交旧记录仅作审计。
- Journal删除通用`createdPaths/retiredPaths/cleanupPaths`和布尔式switch表，改为严格`OperationEffect[]`。Path create/retire、Source/Product、wrapper、Manifest、Git、Docker image、Compose与App SQLite都记录`kind/state/owner`及恢复字段。
- 所有持久化动作先写`planned`，完成后写`applied`；App SQLite备份在打开数据库前通过intent回调记录`configuredUrl/stateRoot/hostPath/backupPath`，完成checkpoint/copy后补真实结果。
- rollback只清理本次PathCreate ownership并保留旧资产；success只执行PathRetire与Operation staging/backup清理。清理失败落在具体effect并由下一次mutating command幂等重试，不反向回滚已成功安装。
- Managed Asset Repository在staging目录和不可变代次rename前后分别推进PathCreate effect；Manager bundle仍保持同版本checksum不一致直接失败。
- updater、start与Runtime/Tool维护在lock内先恢复，再重新读取真实Manifest，禁止继续使用调用前旧快照。
- App SQLite Location新增真实路径containment：相对URL通过junction/symlink逃出State Root会被拒绝；Runtime、Prisma、Manager与Docker继续消费同一Location结果。
- Manager Effect Ledger聚焦回归与typecheck通过；完整Manager suite、pack和Product build结果记录在本轮最终验证。未发布Manager或应用，也未完成公开A→B、GHCR ARM64与设备证据。

### 2026-07-19：执行前崩溃窗口与入口复核

- wrapper切换不再用“planned但未知旧状态”的Effect。统一助手先记录`previousState`和确定的backup path，再把旧`.runtime/bin`复制到临时目录并原子rename；恢复时备份尚未完成会保留当前wrapper，备份已完成才执行恢复，原本不存在wrapper时才删除本次部分写入。
- Source Docker本地镜像不再复用纯revision tag。镜像名包含Operation ID的SHA-256代次，Journal schema校验新镜像属于当前Operation；失败只删除本次镜像，成功后只退役`previousManifest`明确证明的旧镜像，并记录幂等清理结果。
- `update --dry-run`与正式update共用同一个Release/Git目标Resolver，Git目标只fetch一次；dry-run额外输出Effect Ledger身份计划，真实路径、checkpoint和运行结果仍只在物理动作前写入Journal，不使用占位路径伪装真实Effect。
- 无参数发现候选与blessed TUI接管现在都消费统一Adoption Preflight并允许选择三种Source Profile；TUI接管成功后刷新实例列表，不提前销毁界面。
- 本节修复来自最终ownership审查，补充并取代早期`createdPaths/retiredPaths`口径。当前仍只完成源码与测试收口，没有发布Manager或应用版本。
- 最终Manager全量为28个文件通过、1个按平台跳过，141项通过、2项跳过；Manager typecheck与pack审计通过。根typecheck、Nuxt client/SSR/Nitro/Product后处理构建及`git diff --check`通过；未执行浏览器或公开Release验证。

> 2026-07-17发布状态：`manager-v0.1.0-canary.15`、应用`0.8.1`与`0.8.3`保留为失败审计记录；Manager `.19`和应用`0.8.6`已按顺序公开，Manifest最低Manager版本、source revision与GHCR digest均已交叉验证。

## Relative documents refs

- `PROJECT-STATUS.md`
- `docs/deployment.md`
- `docs/operator-bridge.md`
- `reference/workspace/TERMS.md`
- `docs/tasks/26-windows-portable-packaging/README.md`
- `docs/tasks/100-deployment-auth-and-source-carry/README.md`
- `packages/neuro-book-manager/`
- `server/runtime/installation-paths.ts`
- `scripts/deploy/windows-portable-manager.ts`
- `scripts/release/release-assets.ts`
- `.github/workflows/release-container.yml`

## User Request / Topic

- 将当时的一次性部署脚本升级为统一安装、更新、运行时和工具链管理器。
- 使用方案 A：发布独立轻量 npm 包。
- npm 包暂定 `@notnotype/neuro-book-manager`，用户命令使用 `neuro-book`。
- Git 仓库根是所有安装形式的目录底座；Product、Runtime、工具链和部署状态作为可组合组件叠加到仓库根，不再以额外 `source/` 目录包裹源码。
- 所有交付形式携带完整源码；Product 形式额外携带预构建 `.output`，但正式运行不能依赖源码根 `node_modules`。
- Windows Portable 在 Product Bun 基础上增加内置 Bun Runtime、平台 Launcher 和可选托管工具。
- GHCR 是 OCI 交付外壳与分发渠道，镜像内部仍由 Source、Product、Runtime 和 Toolchain 组件组成。
- 不同平台提供各自 Stage 0，Stage 0 只负责确保 Bun 可用，之后统一调用 NeuroBook Manager。
- Manager 后续负责 Bun、ripgrep、Git 等组件的检测、下载、版本记录和更新。
- 将Linux AArch64、macOS x64/ARM64和多架构OCI纳入正式平台合同；不能再用“Manager主动拒绝平台”代替真实能力检测与Profile级门禁。
- macOS第一阶段至少支持Source Dev、Source Docker和GHCR；原生Source Product/Product Bun必须在native dependencies、Product构建与运行验收完成后再开放。

## Goal

建立一个以 NeuroBook 仓库根为统一 Installation Root 的组件化安装体系，并实现独立发布的 `@notnotype/neuro-book-manager`：

- Git clone、Source build、Product Bun、Windows Portable、Source Docker 和 GHCR 在逻辑上使用同一目录与组件所有权协议。
- `neuro-book` 命令统一管理安装、更新、启动、状态、诊断、Runtime 和 Toolchain。
- Source、Product、Runtime、Toolchain、Deployment State 与 User State 有明确边界，更新只能替换对应组件拥有的文件。
- Stage 0、Manager、应用 Release 和 GHCR 镜像之间有明确、可校验的版本兼容协议。
- Product 更新使用 staging、checksum、安装锁和失败回滚，不能破坏用户数据或已有可运行 Product。
- Git worktree 有未提交修改时，源码更新必须停止并报告，不能自动 restore、reset 或覆盖用户改动。
- 用组件解析测试、目录所有权测试、更新/回滚测试、npm pack 依赖审计和跨平台 dry-run 证明安装协议成立。
- 用Windows x64、Linux x64 glibc、Linux AArch64 glibc和macOS x64/ARM64的真实运行证据约束平台支持声明；OCI同时验证`linux/amd64`与`linux/arm64`。

如果某个平台无法在不引入特殊目录分叉的前提下满足相同合同，应先记录实际平台限制、逻辑映射和用户可见差异，再由用户决定是否接受该差异；不得用隐式 fallback 或路径 hack 绕过。

## Current State

### 现有部署模式

- 旧部署 CLI 曾是仓库根 `package.json` 的 bin，默认选择 `local-git`。
- `local-git` 会 clone/pull、`bun install --frozen-lockfile`、Nuxt prepare/generate/build 和 SQLite migration，再生成本机启动脚本。
- `source` 是“宿主机 Bun 安装和构建 + Docker runtime 容器运行”的混合模式，不是完全容器内源码构建。
- `ghcr` 使用预构建 Product 镜像，运行机不执行 `bun install` 或 Nuxt build，但现有安装器仍会 clone 完整仓库。
- `Product Bun` 已有 `product:stage` / `product:start` 实现，但 Release workflow 尚未发布通用 Product Bun 压缩包。
- Windows Product Portable 当前结构为 `app/` Product Root、`data/` 用户状态、`runtime/bun/`、`launcher/`，并在 `app/source/` 再携带一份完整源码快照。

### 现有包与发布边界

- 根 `package.json` 同时承担完整应用依赖和部署 CLI bin。
- 旧 GitHub 包部署入口通常不会安装目标包的普通 `devDependencies`，但会解析根包声明的全部 `dependencies`；当时根依赖包含 Nuxt、Vue、Prisma、编辑器等完整应用依赖树，远超部署 CLI 所需。
- 根 `files` 能约束 pack 产物，但不能作为 GitHub Git dependency 一定只获取这些文件的长期合同。
- 当前 Release workflow 发布 Windows portable zip 和 GHCR 镜像，没有独立 Manager npm 包和通用 Product Bun artifact。

### 已有目录基础

- `.gitignore` 已忽略 `.output`、`.runtime`、`.deploy`、`workspace`、`.env`、`config.yaml` 和 `product/`，适合作为组件化根目录的基础。
- 当前 `.runtime` 仅有 ignore 约定，正式产品仍使用 `runtime/bun/`。
- 当前 Product staging 会复制 Git tracked 文件到 `product/source/`，与“仓库根即源码底座”的新方向冲突。
- `CONTEXT.md` 和 `reference/workspace/TERMS.md` 仍包含旧版 Windows Source Binding、Node runtime、首次 clone 到 `app/` 等过期术语；部分内容已经和当前 Bun Product Launcher 实现不一致。

### macOS与ARM64当前缺口

- 当前公开Manager仍为`0.1.0-canary.19`，公开应用仍为`0.8.6`；它们不包含本次Manifest v4、五平台Product与Podman持久化能力。
- 主线源码已提供Windows x64、Linux x64/AArch64 glibc、macOS x64/ARM64平台映射，Release Manifest消费端使用穷举资产名，Release workflow构建五平台Product并发布linux/amd64与linux/arm64 OCI。
- 集成分支[Product Platform Checks 29643196339](https://github.com/notnotype/neuro-book/actions/runs/29643196339)已在真实runner通过Linux ARM64 glibc、macOS x64和macOS ARM64原生Product门禁。该结果不等于公开资产证据；未来精确npm Manager、应用候选与多架构OCI仍是发布前验收步骤。Apple Silicon双engine实机链本次只豁免阻断，不视为完成。

## Decisions / Discussion

### D1：仓库根是统一 Installation Root

推荐目标结构：

```text
neuro-book/
├─ .git/                    # Git 安装存在；Release 安装可不存在
├─ app/
├─ server/
├─ shared/
├─ scripts/
├─ assets/
├─ package.json
├─ bun.lock
├─ .output/                 # Product 组件
├─ .runtime/                # Manager 托管的 Bun / tools
├─ .deploy/                 # Manager 状态、锁、staging、生成入口
├─ workspace/               # Workspace Root
├─ config.yaml              # Boot Config
└─ .env
```

逻辑上所有安装形式使用这些路径。容器可以把系统 Runtime 映射为 `provider: container`，不强制为了路径表面一致而复制 Docker 基础镜像中的 Bun、Git 或 Python。

### D2：组件所有权

| 组件 | 主要内容 | 更新权限 |
| --- | --- | --- |
| Source | Git tracked 源码或同版本 Release 源码快照 | Git 或 Release Source installer |
| Product | `.output/` 及 Product 运行 manifest | Product installer |
| Runtime | `.runtime/bun/**` | Runtime manager |
| Toolchain | `.runtime/tools/**`、`.runtime/bin/**` | Tool manager |
| Deployment State | `.deploy/**` | NeuroBook Manager |
| User State | `workspace/**`、`.env`、`config.yaml`、日志 | 用户与应用；Release 更新不得覆盖 |

Product 可以携带完整源码，但必须通过隔离测试证明服务和产品脚本不依赖源码根 `node_modules`。

### D3：独立 npm 包与命令名

- npm package：`@notnotype/neuro-book-manager`。
- executable：`neuro-book`。
- 标准入口：`bunx --bun @notnotype/neuro-book-manager <command>`。
- 安装后由 `.runtime/bin/neuro-book(.cmd)` 提供稳定入口。
- 不保留旧部署 CLI 作为长期兼容层；实施时直接同步 README、部署文档、operator bridge、release 文档和脚本入口。
- Manager package 必须独立声明最小依赖，不能依赖 NeuroBook 应用根包。

### D4：Manager 版本与应用版本解耦

- Manager 使用自己的 semver 和 npm dist-tag：`latest`、`canary`。
- NeuroBook Release manifest 声明 `minManagerVersion`，必要时声明 `maxManagerVersion` 或 manifest schema version。
- 应用版本、Manager 版本、GHCR tag 和 Bun 版本不得假定相同。
- 安装记录必须分别保存这些版本。
- 新增`ProductPlatform`、改变资产命名或扩展Release Manifest严格枚举都属于Manager协议变化：必须先提升Manager版本、发布并验证npm精确版本，再允许应用Release引用该`minManagerVersion`。
- Release workflow不能只比较本地与npm的版本字符串；候选manifest必须由npm已公开的精确Manager版本完成严格解析、全部资产URL校验和本机平台选择，防止“版本号存在，但公开包仍是旧代码”。
- Release Manifest应先读取稳定envelope（至少`schemaVersion`、`minManagerVersion`），确认当前Manager满足最低版本后再严格解析平台payload；不允许旧Manager因未知平台先抛泛化schema错误而绕过升级提示。
- 快速开发阶段可以硬切协议，但必须显式发布新Manager、更新Stage 0/RELEASE升级说明，并把旧Manager无法读取新manifest记录为用户可见断点；不能继续声明旧版本兼容。

### D5：Stage 0

Stage 0 只负责：

1. 检测可用 Bun。
2. 缺失时下载匹配平台/架构的 Bun。
3. 校验 checksum。
4. 调用固定版本或固定 dist-tag 的 Manager。

计划入口：

- Windows PowerShell / CMD 或小型独立启动程序。
- Linux/macOS POSIX shell。
- 已有 Bun：直接使用 `bunx`。
- Windows Portable：包内 Launcher 调用同一个 Manager core，不复制第二套安装逻辑。

Stage 0目标矩阵：

| 宿主 | Bun资产 | 额外门禁 |
| --- | --- | --- |
| Windows x64 | `bun-windows-x64.zip` | PowerShell/CMD参数与普通用户权限 |
| Linux x64 glibc | `bun-linux-x64.zip` | `glibc`、`curl`、`unzip`、`sha256sum` |
| Linux AArch64 glibc | `bun-linux-aarch64.zip` | 同Linux x64，并验证真实ARM64 executable |
| macOS x64 | `bun-darwin-x64.zip` | POSIX shell、Darwin识别与缓存权限 |
| macOS ARM64 | `bun-darwin-aarch64.zip` | 同macOS x64，并验证Apple Silicon原生executable |

- 每个资产同时固定archive与Bun executable SHA256；缓存复用必须同时校验版本和executable checksum。
- POSIX Stage 0必须按`uname -s`先区分Linux/Darwin；`glibc`检查只属于Linux，不能套用到macOS。
- 用户可见架构统一称ARM64；ProductPlatform与Bun官方资产使用`aarch64`，Node/Bun的`process.arch`和OCI platform保留外部合同要求的`arm64`，转换只允许集中在平台适配层。

### D6：Stage 0 与 Git clone 的非空目录冲突

如果 Stage 0 先把 Bun 写入目标根 `.runtime/`，普通 `git clone <repo> <target>` 会因为目标目录非空失败。这是统一目录设计的第一项实现门禁。

候选方案：

1. Stage 0 先把 Bun 放在系统临时目录或用户级 Manager cache，Source 物化完成后再迁入 Installation Root。
2. Manager 在非空目标根执行 `git init`、设置 remote、fetch 和 checkout，而不是调用 `git clone <target>`。
3. clone 到 sibling staging 目录，再原子迁移 `.git` 和 tracked 文件到 Installation Root。

当前建议采用方案 1 + 2：Stage 0 Runtime 先位于用户级 cache；Installation Root 确定后，Manager 使用可审计的 repository materialize 流程，并按 Profile 决定是否复制为托管 Runtime。最终方案由实现 spike 验证 Windows 文件占用和 Unix rename 行为后确认。

### D7：安装 Profile 是组件来源组合

| Profile | Source | Product | Runtime | Toolchain | Envelope |
| --- | --- | --- | --- | --- | --- |
| source-dev | Git | 无或本地 build | external/managed | system/managed | directory |
| source-product | Git | local build | external/managed | system/managed | directory |
| product-bun | Release | Release | external | optional | archive |
| windows-portable | Release | Release | managed | managed/optional | Windows zip |
| source-docker | Git | local/container build | container | container | directory + OCI runtime |
| ghcr | image 内源码 | image 内 Product | container | container | OCI image |

Profile 只声明需求与来源，下载、校验、安装和状态记录复用统一 component installer。

宿主平台/Profile目标矩阵：

| 宿主平台 | source-dev | source-product | product-bun | source-docker | ghcr | windows-portable |
| --- | --- | --- | --- | --- | --- | --- |
| Windows x64 | 支持 | 支持 | 支持 | 有Container Engine时支持 | 有Container Engine时支持 | 推荐 |
| Linux x64 glibc | 支持 | 支持 | 支持 | 支持 | 推荐 | 不支持 |
| Linux AArch64 glibc | 支持 | 支持 | 支持 | 支持 | 推荐 | 不支持 |
| macOS x64/ARM64 | 支持 | 支持 | 支持 | 支持 | 推荐 | 不支持 |

- 平台门禁必须使用正向、穷举的支持矩阵；不得用“只有macOS列出不支持项，其他平台默认全部放行”的负向列表。
- Windows ARM64、Linux musl与其他架构不在本轮支持矩阵；检测到时必须明确拒绝，不能回退到x64资产或依赖系统仿真。

### D8：Product 是平台/架构相关组件

`.output/server/node_modules` 可能包含 `@libsql`、esbuild、sqlite 扩展等 native optional package。Product artifact 不能默认宣称完全跨平台，应至少按以下维度发布和解析：

- OS：Windows、Linux、macOS。
- architecture：x64、ARM64。
- libc：Linux glibc；如支持 Alpine/musl，需要独立 artifact 或明确不支持。

ProductPlatform标准值与阶段：

| ProductPlatform | 资产名 | 阶段 |
| --- | --- | --- |
| `windows-x64` | `neuro-book-product-windows-x64.zip` | 已支持 |
| `linux-x64-glibc` | `neuro-book-product-linux-x64-glibc.tar.gz` | 已支持 |
| `linux-aarch64-glibc` | `neuro-book-product-linux-aarch64-glibc.tar.gz` | 已实现，待主仓runner证据 |
| `darwin-x64` | `neuro-book-product-darwin-x64.tar.gz` | 已实现，待主仓runner证据 |
| `darwin-aarch64` | `neuro-book-product-darwin-aarch64.tar.gz` | 已实现，待主仓runner证据 |

- Windows Product必须在Windows x64 runner构建；Linux Product必须在对应x64/AArch64 Linux runner原生构建；macOS Product必须在对应macOS runner构建。
- GHCR只发布Linux容器平台，目标为`linux/amd64`与`linux/arm64`；macOS通过Docker Desktop或Podman machine运行Linux容器，不把OCI镜像误称为Darwin Product。
- Release生产端、TypeBox schema、TypeScript类型、资产校验、Release resolver和本机平台选择必须共用穷举映射。新增ProductPlatform时，`satisfies Record<ProductPlatform, AssetName>`一类类型约束应迫使所有消费者同步修改，禁止`非Windows => Linux x64`默认分支。
- 每个平台Product都要验证native optional packages、无根`node_modules`启动、migration、HTTP版本、Agent State Root与真实浏览器；只检查tar条目不能证明Product可运行。

### D9：Runtime 与 Toolchain Provider

每个 Runtime/Tool 记录来源：

- `system`：来自宿主 PATH。
- `managed`：由 Manager 下载到 `.runtime`。
- `container`：由 OCI 镜像提供。

第一阶段托管范围建议：

- Bun：必须支持 managed。
- ripgrep：支持Windows x64、Linux x64/AArch64 glibc与macOS x64/ARM64 managed。
- Git：Windows 优先评估 MinGit；Linux/macOS 优先系统包管理器。
- bash：Windows 可随 MinGit 提供，Linux/macOS 使用 system/container。
- Python：第一阶段只检测与给出安装建议，不承诺全平台 managed Python；Windows embeddable Python、pip/venv 和 Linux libc 差异单独评估。

所有第三方 Runtime/Tool 下载必须记录上游 URL、版本、SHA256、许可证和再分发边界。

Container Engine同样属于部署provider合同：

- 统一类型为`docker | podman`，Fresh Install或Adoption时选择并持久化到Installation Manifest；Operation Journal记录事务实际使用的engine。
- 自动选择必须验证CLI、`compose version`和engine `info`，不能只以`docker --version`存在就压过可用的Podman。
- `NEURO_BOOK_CONTAINER_ENGINE`可作为安装时显式选择或诊断覆盖，但不能要求用户在每次`start/update/create-admin/recover`时重复设置。
- 后续生命周期、失败回滚和进程中断恢复必须使用持久化engine；不得在新进程中重新探测后静默切换到另一套镜像、容器和网络状态。
- rootless Podman由容器root映射到宿主用户，不重复注入宿主UID/GID；Docker与非rootless Podman继续使用显式用户映射，并由真实State Root写入测试约束权限。

### D10：统一安装记录

`.deploy/installation.json` 至少记录：

```json
{
    "schemaVersion": 4,
    "profile": "product-bun",
    "containerEngine": null,
    "managerVersion": "1.0.0",
    "appVersion": "0.8.0",
    "channel": "stable",
    "components": {
        "source": {"provider": "release", "version": "0.8.0"},
        "product": {"provider": "release", "version": "0.8.0", "platform": "windows-x64"},
        "managerRuntime": {"provider": "system", "version": "1.x"},
        "applicationRuntime": {"provider": "system", "version": "1.x"},
        "tools": {}
    }
}
```

具体 schema 在实现前使用 TypeBox 或 Zod 建立严格类型，不能使用 `Record<string, unknown>` 作为组件状态模型。

### D11：事务更新与回滚

Manager 更新必须：

1. 获取 Installation Root 级安装锁。
2. 下载到 `.deploy/staging/<operation-id>`。
3. 校验 manifest、platform、version 和 checksum。
4. 检查 Git dirty state 和运行进程。
5. 只备份本次组件拥有的路径。
6. 切换组件。
7. 执行 migration 和最小启动检查。
8. 成功后提交 installation state；失败则恢复旧组件。

Windows 下不能覆盖正在执行的 Bun 或 Manager 文件。Runtime/Manager 使用版本目录 + 稳定 wrapper，更新只切换 current 指针或下次启动目标。

### D12：Workspace Root 与 Portable 物理数据目录

仓库根底座要求应用可见路径继续是根 `workspace/`、`.env` 和 `config.yaml`。Windows Portable 当前真实状态位于 `data/`，再把 `app/workspace` 映射到 `data/workspace`。

需要在实现前拍板：

- 方案 A：Windows Portable 也把真实用户状态直接放在根 `workspace/`、`.env`、`config.yaml`，通过组件所有权保护更新。
- 方案 B：保留 `data/` 作为物理持久层，根路径通过 junction/wrapper 映射，并在安装 manifest 中声明 physical state root。

当前建议方案 B：保留明确的可备份 `data/` 物理边界，但把它定义为平台存储映射，不改变应用看到的统一逻辑路径。这样升级安全性更高，但目录并非物理完全一致；最终由用户决定。

### D13：Git Source 更新边界

- Manager 不允许对 dirty worktree 自动执行 `git restore`、`reset` 或 stash。
- Git 更新默认使用 `fetch` + fast-forward 检查，确认可前进后再更新。
- `.output`、`.runtime`、`.deploy`、Workspace Root 和本机配置不参与 Git dirty 判断。
- Source update 和 Product update 是两个独立组件操作；源码更新成功但 Product build 失败时，旧 Product 应继续可运行。

### D14：命令范围

第一阶段命令：

```text
neuro-book install
neuro-book update
neuro-book start
neuro-book status
neuro-book doctor
neuro-book runtime list|install|update
neuro-book tools list|install|update|path
```

后续再评估：

```text
stop / restart
rebuild
rollback
admin
self update
uninstall
```

`stop/restart` 必须等进程所有权模型确定后实现，不能假设 Manager 总是拥有用户通过 systemd、Docker、终端或 Windows Launcher 启动的进程。

## Overall Review

### 审查结论

方向成立，而且比继续扩展旧部署 CLI 的 mode 分支更系统。仓库当前 `.gitignore`、Bun-only 产品运行方向和 Product-first 构建已经提供了大部分基础，但不能直接重命名现有 CLI 后继续堆功能；必须先建立组件所有权、Release manifest、版本兼容和事务更新协议。

### 主要风险

1. **Stage 0 非空目录**：先写 `.runtime` 会破坏普通 clone 流程，必须先做 repository materialize spike。
2. **Windows 目录迁移**：现有 `app/data/runtime/launcher` 与新仓库根底座不同，Launcher 更新和 junction 逻辑需要重写，不能局部改路径。
3. **Product 构建平台**：native dependency 使通用 Product Bun artifact 必须按平台/架构发布。
4. **Manager 自更新**：Windows 不能替换当前正在执行的 Bun/Manager，需要版本目录和延迟切换。
5. **版本耦合**：Manager、应用、manifest schema 和 GHCR tag 必须分开记录和验证。
6. **Git 用户改动**：现有部署入口会 restore 某些 generated artifact；新 Manager 必须停止自动修复 tracked 文件，避免覆盖用户修改。
7. **工具再分发**：MinGit、ripgrep、Bun、Python 的许可证、checksum、上游更新和平台差异需要进入组件 metadata。
8. **逻辑统一与物理统一**：Docker system tools、Windows `data/` 和宿主 system Bun 不应为了目录外观一致而重复复制；应统一逻辑合同并显式记录 provider。
9. **现有术语漂移**：`CONTEXT.md`、`reference/workspace/TERMS.md` 和 Task 26 历史段落混合旧 Source Bootstrap 与新 Product Launcher，需要在实施时明确历史记录与当前合同。
10. **平台枚举扩展漏改消费者**：新增ProductPlatform若只修改schema与生产端，Release resolver可能拒绝整个新Release；资产名映射必须穷举并由类型约束。
11. **Manager发布顺序**：应用Release引用未公开的新Manager能力，或沿用已发布版本号承载不同代码，都会让Stage 0与既有安装无法解析新manifest。
12. **Container Engine漂移**：每个CLI进程重新自动选择Docker/Podman，会让启动、更新与Operation Journal恢复落到不同engine。
13. **构建成功不等于平台支持**：多架构镜像或AArch64 tarball能够构建，只证明产物存在；native runtime、migration、State Root、更新回滚和浏览器链路仍需分别验收。

### 推荐实施顺序

1. 冻结 Installation Root、component ownership、installation manifest 和 release manifest schema。
2. 新建独立 Manager package，只实现 `status`、`doctor`、root discovery 和 dry-run component resolver。
3. 完成 npm pack / publish canary，验证不会安装 NeuroBook 完整应用依赖树。
4. 实现 Stage 0 + repository materialize spike，覆盖空目录、非空 `.runtime`、已有 Git checkout 和 dirty worktree。
5. 实现 Source + local Product build，先替换 `local-git`。
6. 发布平台化 Product Bun artifact，并接入 Product install/update/rollback。
7. 把 Windows Portable Launcher 改为 Manager frontend，迁移 Runtime 和数据映射。
8. 收敛 Source Docker / GHCR，消除 GHCR 安装时无意义的完整 checkout，或明确 checkout 是用户选择的 Source 组件。
9. 扩展Linux AArch64与macOS Stage 0/Profile矩阵，先发布包含协议变化的Manager，再发布对应应用Release。
10. 在native runner完成Linux AArch64 Product与`linux/arm64` GHCR运行门禁，再开放公开安装入口。
11. 完成macOS Phase 1 Source Dev、Source Docker、GHCR与Docker/Podman验收；原生Product通过后再推进Phase 2。
12. 更新稳定文档、标准术语、PROJECT-STATUS 和 Release 流程，删除旧部署入口。

## Verification / Test

已完成：

- `bun run manager:typecheck` 通过。
- `bun run typecheck` 完整应用类型检查通过。
- `bun run manager:test` 通过：8 个测试文件、23 项测试，新增覆盖 Manifest v2、Stage 0 checksum/接管、Operation Journal 恢复、损坏 journal 拒绝和 Release resolver 跳过未装配版本。
- `bun run manager:pack` 通过：npm 包只有 5 个文件，约 249 KB；在空临时目录安装 tarball 后可执行 `neuro-book --version`，依赖声明不包含 Nuxt、Vue、Prisma、TipTap。
- `bun run typecheck` 与 `bun run manager:typecheck` 通过。
- Source archive smoke 通过：只打包当前存在的 Git tracked 文件，不含 `.git`、`node_modules`、`.output` 和用户状态。
- Windows Portable 使用本轮新 `.output` 完成真实组装：Manifest v2、managed Bun、rg、PortableGit、bash 和 Manager wrapper 均通过版本执行检查，生成 `dist/neuro-book-windows-x64.zip`。
- Portable 打包会显式跳过“已从 worktree 删除但仍在索引中”的文件，避免 dirty 重构期间重新混入旧部署实现。
- Release workflow YAML解析通过；`release-assets.ts`与Portable packager bundle通过。候选Source/Product/Portable/Manifest先作为Actions artifact进入verify，只有Linux/Windows验证成功后才由最终publish job上传正式Manifest和SHA256；失败或取消的Release不会被Resolver当作完整版本。
- 全新 `bun run nuxt:build` 通过。无根 `node_modules` 的 Product 隔离 smoke 已覆盖 migration、管理员、system profile、variable CLI、workspace project create、State Root 映射与 HTTP 版本接口。
- Product system profiles 改为 Nitro vendor 完成后以 Product 模式重新编译，避免源码环境 artifact 在无根 `node_modules` 下出现 `compile_stale`。
- Task 105 收口聚焦回归通过：`workspace-assets-product-root`、Profile Catalog、Profile CLI path 与 installation paths 共 4 个测试文件、51 项测试。期间发现 Profile Catalog 测试仍写死 compiler version 6；实现实际已使用公开常量 version 7，现已让测试直接消费 `PROFILE_ARTIFACT_COMPILER_VERSION`，避免后续 compiler contract 升级再次产生同类假失败。
- 首次 Manager canary CI 暴露 `paths.test.ts` 写死 Windows 盘符，Linux runner 会把它解析为相对路径；测试已改用当前平台的 `resolve/join` 表达同一目录合同，本地 Manager 23 项测试复跑通过。
- 第二次 Manager canary CI 的验证已全绿，但 `bun publish` 未消费 `actions/setup-node` 生成的 npm 认证配置；workflow 已切换到标准 `npm publish --workspace`，继续复用 `NODE_AUTH_TOKEN` 和 npm registry 配置。
- 第三次 Manager canary CI 已进入 npm publish，registry 因 token 未启用 bypass 2FA 返回 403；同时 npm 严格校验会移除带 `./` 前缀的 bin 路径，包元数据已改为 `dist/neuro-book.mjs`。继续发布前需要更新具备 package write 权限且允许绕过 2FA 的 granular token。
- Manager `0.1.0-canary.5` 已公开发布并可从npm `canary`安装；typecheck、8个测试文件/23项测试和空目录pack审计通过。npm首次发布遗留的`latest → 0.1.0-canary.4`仍需带OTP删除；canary文档继续使用`@canary`，stable发布前不推荐`@latest`。
- 应用 canary run `29185683743` 的 GHCR 与 Source job 成功，但 Windows/Linux Product 都因源码直接导入却未声明 `h3` 而失败，assemble/verify 随后跳过。根依赖已补 `h3 ^1.15.5`，Product CI 明确统一 hoisted linker；Nitro vendor 复制会解引用 Bun package symlink，并补齐 Product 动态源码所需的 `proper-lockfile`、`pinyin-pro` seeds。
- SSH Arch 实机验证通过：Bun 1.3.14 hoisted 干净安装与 Linux Product build、移走根 `node_modules` 后 migration/start/HTTP、Source Docker 容器内 build/start、公开 GHCR digest pull/revision label/migration/HTTP。Prisma CLI 相对 SQLite URL 曾错误落到 Application Root，现已规范化为 State Root 绝对 URL并增加聚焦测试。
- Manager `0.1.0-canary.5`的Stage 0实机安装使用managed Bun 1.3.14完成Source Dev依赖安装和Nuxt启动；Source Docker也从公开Manager完成容器内frozen install、Product build和容器启动。
- 应用`0.7.4`的Arch验证发现服务器默认鉴权会使Manager版本探针收到HTTP 401，因此主动取消 [workflow 29192059375](https://github.com/notnotype/neuro-book/actions/runs/29192059375)。该Release保持零资产、没有正式Manifest，Resolver会安全跳过。`/api/app/version`现作为只读公共部署探针，其他日志、配置和业务接口仍受鉴权；聚焦middleware测试和完整typecheck通过。修复进入`0.7.5`，仍需公开资产复验。

当前未完成的环境级验收：

- 提升并公开包含Manifest v4、Release v3、五平台与Podman合同的新Manager版本；当前`.19`不得以同版本不同bundle复用。
- 将已通过的Linux ARM64 glibc、macOS x64和macOS ARM64原生Product门禁带入未来正式Release workflow，并用公开候选资产复验；集成分支run `29643196339`已覆盖native package、Stage 0、migration、无根`node_modules`启动、HTTP和浏览器smoke。
- 未来应用候选以精确npm Manager消费五平台Manifest，完成公开Payload、linux/amd64+linux/arm64 GHCR、Windows`0.8.6 → candidate`更新和最终索引后发布。
- Windows Portable仍需交互式start → create-admin → restart → update → data保留终验；本轮不自动执行人工浏览器操作。
- Apple Silicon Docker Desktop与rootless Podman machine的Source Docker/GHCR、UID映射、create-admin、A→B更新和Operation恢复被豁免本次合并阻断，但继续保留为未验证证据。
- Windows ARM64、Linux musl与其他平台保持明确拒绝测试，避免错误下载x64或glibc资产。

## Implementation Walkthrough

### 2026-07-12：任务建立与第一轮整体审查

- 用户确认独立 npm 包方案，并将 CLI 职责扩展为安装、更新、Runtime 和工具链管理。
- 初步建议的 `app/source` 分层被否决，改为 Git 仓库根作为统一安装底座；这一调整符合直接 `git clone` 的安装路径和 Nuxt 默认 `.output` 构建位置。
- 复查现有实现后，补充 Stage 0 非空目录冲突、Manager/应用版本解耦、native Product 平台矩阵、Windows 运行文件替换、Tool 许可证和 Portable 物理数据目录等门禁。
- 实际结果与最初讨论计划的出入：任务范围从“拆出轻量部署 CLI”扩大为“统一 Installation Root、组件协议、Release manifest、Stage 0、事务更新和现有部署迁移”；这是系统性重构，不适合只对现有 `scripts/deploy` 做增量改名。

### 2026-07-12：Manager、State Root 与发布协议实现

- 在同仓新增独立 workspace package `packages/neuro-book-manager`，包名 `@notnotype/neuro-book-manager`，bin 为 `neuro-book`；实现 install/update/start/status/doctor、Runtime、Tool 和 admin 命令。
- 建立严格 Installation/Release Manifest schema、Profile resolver、平台选择、Release 下载与 SHA256、Git materialize、安装锁、staging、Source/Product 备份和回滚。
- Manager bundle 安装到 `.runtime/manager/<version>`，稳定 wrapper 使用相对 Installation Root；managed Bun/rg/MinGit 使用不可变版本目录，只刷新 `.runtime/bin` wrapper，不修改系统 PATH。
- managed 组件状态补充官方 Source URL、SPDX license 和再分发说明。
- 新增应用 runtime path resolver，`NEURO_BOOK_STATE_ROOT` 统一 Workspace Root、Boot Config、Product Env、SQLite 相对路径和日志；Windows Portable 使用 `data/`，不再使用 `app/workspace` junction。
- Nuxt build 支持 `NEURO_BOOK_OUTPUT_DIR` staging；`product:stage` 不再生成 `product/source`。
- Source Docker 改为完整 Dockerfile 容器内 install/build；GHCR Compose 使用 digest 固定镜像且不要求宿主 Source checkout。
- 新增 Windows/POSIX Stage 0、Manager 独立 release helper/workflow、Source/Product/Portable/manifest 资产脚本和统一应用 Release assemble workflow。
- 删除旧部署 bin、旧 mode 模块、Source runtime Dockerfile、旧 Windows Launcher 更新实现和旧 Product source snapshot。

### 2026-07-12：Portable、事务边界与文档收口

- 修复 Portable 在 dirty index 中复制已删除 tracked 文件导致打包失败的问题；结构 smoke 成功生成 `neuro-book-windows-x64.zip`。
- 修复 Product 首次安装后 migration/健康检查失败时没有旧备份而遗留新 `.output` 的回滚缺口，并增加有/无旧 Product 两类测试。
- 修复 managed Runtime/Tool 同版本更新先删除当前目录的问题，避免网络失败破坏可用 Bun/rg/MinGit，也符合 Windows 不覆盖运行文件的约束。
- 修复 PowerShell Stage 0 的位置参数绑定，确保 `--profile/--dir` 透传给 Manager，而不会被误当作 Manager tag。
- Docker State Root 增加 `logs/` 初始化与持久化挂载。
- 同步 README 中英文、快速开始、部署文档、operator bridge、CONTEXT、Workspace 标准术语、PROJECT-STATUS、RELEASE 和营销草案。

### 实际结果与计划差异

- Manager core、目录合同、State Root 和发布资产已有实现基础；六个 Profile、Stage 0 与发布闭环仍在 Manifest v2 收口中，未达到可发布状态。
- 事务实现已覆盖 Release Source/Product 与不可变 Runtime/Tool 版本目录；通用运行进程探测、完整故障注入矩阵和所有安装阶段的统一 undo journal 尚未达到原计划的完整度，应在应用级 smoke 后继续加固。
- Windows Portable smoke 当前使用仓库已有的旧 `.output` 验证包结构，不能替代停服后用本轮代码新构建 Product 的运行验收。
- 当时macOS、arm64、musl、systemd/pm2和托管Python仍按计划留在v1范围外；2026-07-16的跨平台决策已将macOS与ARM64提升为Task 105正式目标，musl、systemd/pm2和托管Python仍不在本轮范围。

### 2026-07-12：Manifest v2、事务状态机与发布门禁收口

- 将 Installation Manifest 硬切 schema v2，组件固定为 `source/product/manager/managerRuntime/applicationRuntime/tools`，并补齐 Profile/provider、SemVer、revision、平台、路径越界和 managed 资产审计校验。
- Operation Journal 也接入严格 TypeBox schema；恢复前会验证嵌套 Installation Manifest、Git revision、受管相对路径和 Git commit point 必需的 next manifest，避免损坏账本直接驱动回滚或提交。
- Manager Host Runtime 与 Application Runtime 分离。Stage 0 把 Bun 路径、版本、来源和 SHA256 传给 Manager，Manager 复验后复制到版本目录；所有 mutating Manager 命令会接管当前 bundle并刷新稳定 wrapper。
- 安装和更新统一接入持久化 Operation Journal。Release Source、Product 和 Compose 明确拆成 stage/validate/switch，Source Product 使用 detached worktree，Git fast-forward 位于 migration/health 之后；原生更新增加端口检查、SQLite WAL checkpoint/备份与 HTTP 版本健康检查。
- Windows Portable 切到 PortableGit，真实执行 Bun/rg/Git/bash 版本门禁；创建管理员后启用 `data/config.yaml` 鉴权并提示重启，启动入口在服务健康后打开浏览器且保持前台窗口。
- Release resolver 会跳过未装配的新 Release，并交叉验证 tag/channel/asset URL/revision/GHCR digest。首次公开 canary 已产生 npm Manager、Source和GHCR，但Product失败导致Release未装配；不能把部分资产发布记录成完整发布通过。
- 实际计划差异：本地 Windows 没有 Docker，但本轮改用 SSH Arch完成Linux Product Bun、Source Docker和公开GHCR runtime smoke；GHCR rollback与最终公开资产verify仍必须等待修复后的完整Release。Bun 1.3.14 在Windows workspace `bun add` 后两次留下不完整hoisted链接，本轮通过完整 frozen hoisted重装恢复，未用显式添加缺失包掩盖问题。

### 2026-07-12：首次应用 Release CI 与 Arch Linux 实机修复

- 首次应用 canary 的 GHCR 和 Source 发布成功，Windows/Linux Product 在 `prepare-system-assets` 阶段同时报告缺少 `h3`。确认应用源码直接消费 `h3`，不能依赖 Nuxt/Nitro 的传递依赖，因此补为根直接依赖。
- Product vendor 原先在 Linux 保留 Bun package symlink，生成的 `.output/server/node_modules` 会指回构建机；现改为复制实体文件，保证移走根 `node_modules` 后 Product 仍独立运行。
- Product runtime 后处理明确以 hoisted linker 为构建合同。Dockerfile、Source Product Manager 路径和 Windows/Linux Product CI 使用同一 linker；不为 isolated linker 重建完整嵌套包管理器布局。
- Arch 实机暴露 Prisma migration 仍按 cwd 解释相对 SQLite URL。`preparePrismaEnv` 现在把相对 `file:` URL 基于 State Root 转为绝对路径后再交给 Prisma，数据库不再错误写入 Application Root。
- 实际结果与计划差异：Linux Product Bun、Source Docker 和公开 GHCR runtime smoke 已提前通过 SSH Arch 实机完成；完整 Release assemble、公开 Product/Portable 资产和 Manager GHCR rollback 仍需新的 canary workflow 终验。

### 2026-07-12：紧急 Patch 发布安全收口

- 审查发现 Product update catch 先直接恢复 Product，随后 Operation Journal 再次恢复，第二次会删除刚恢复的旧 `.output`；现删除调用方重复回滚，Product/Source/SQLite/Compose恢复只由journal负责。
- Source Dev不再硬编码系统`bun`；启动使用Application Runtime。Git fast-forward后在主checkout执行frozen hoisted install，失败会保留journal，下次mutating command先重试依赖安装，不自动reset Git。
- Release assemble只上传候选Actions artifact。Linux/Windows verify成功后，最终publish job才上传正式Manifest、SHA256和应用资产；Resolver仍以正式Manifest作为完整Release标志。
- Windows/POSIX Stage 0固定Bun 1.3.14官方archive与executable checksum，每次复用缓存时同时校验checksum和版本，损坏缓存会整版本重建。
- npm入口文档明确禁止`bunx run @notnotype/neuro-book-manager`，标准形式保持`bunx --bun @notnotype/neuro-book-manager@<tag> <command>`；该错误发生在Manager启动前，只能通过正确入口和发布smoke防止复发。
- 发布后Arch Source Docker实机build/start成功，但默认启用鉴权使Manager访问`/api/app/version`得到401并误判失败。版本接口现作为只读公共部署探针，其他App/日志/配置接口仍受鉴权；新增middleware聚焦测试约束该边界。
- 有缺陷的`0.7.4` workflow在正式Manifest发布前主动取消，GitHub Release保持零资产；随后发布`0.7.5`承载健康探针修复。实际计划差异是紧急patch从一次应用发布扩展为两次canary，目的是保证Resolver永远看不到已知不可用的完整Release。

### 2026-07-12：首次安装引导与多实例 Manager

- `bunx --bun @notnotype/neuro-book-manager@<tag>`无参数入口硬切为Clack安装向导，不再只显示Commander帮助或静默选择Profile。向导解释部署方式，并依次收集Installation Root、实例名称、channel、端口和鉴权，最后展示摘要和下一步命令。
- 新增用户级`~/.neuro-book-manager/config.json`严格schema，只保存安装偏好、实例名称、绝对Installation Root和默认实例。应用版本、组件provider、checksum、Runtime和更新状态不复制到用户配置，仍由每个实例的`.deploy/installation.json`唯一负责。
- 新增`neuro-book manage` blessed TUI以及`instances list/add/forget/default/config`命令。TUI覆盖实例状态、doctor、start、update、新安装、注册、默认选择和忘记索引；忘记操作不会删除Installation Root或用户数据。
- `update/start/status/doctor/runtime/tools/admin`新增全局`--root`与`--instance`选择。未显式指定时先解析当前目录实例，再回退用户配置的默认实例，Manager由此真正具备跨目录管理多个NeuroBook实例的能力。
- blessed顶层入口会动态require全部widgets，Bun表面构建成功但单文件bundle运行时缺失`./widgets/node`。实现没有复制node_modules或外置运行时依赖，而是增加静态widget适配层，只打包TUI真实使用的Screen/Box/List/Question/Prompt，保持`.runtime/manager/<version>/neuro-book.mjs`单文件运行合同。
- 验证结果：Manager typecheck通过；9个测试文件/25项测试通过；npm pack audit生成5文件、约0.33MB压缩包，并在空目录真实安装后运行`--version`、`status --help`、用户配置路径和GHCR安装dry-run。直接执行打包后的CLI也已验证非TTY环境会明确拒绝TUI且不会挂起。
- 实际结果与计划差异：最初只计划增加无参数引导和一个TUI入口；实现审查后补齐了实例索引严格schema、命令级实例选择和配置恢复命令，否则TUI会成为无法被普通CLI复用的第二套实例状态。没有实现后台进程管理、自动发现全盘实例或把installation manifest镜像到用户配置，避免扩大v1范围。

### 2026-07-12：npm Trusted Publisher 实测准备

- 用户已在npm为Manager配置GitHub Trusted Publisher。Manager workflow从`NPM_TOKEN`硬切到GitHub OIDC：job增加`id-token: write`，固定使用支持Trusted Publishing的npm 11.5.1，并通过`npm publish --provenance`发布。
- canary publish job不再尝试删除错误的`latest` dist-tag。Trusted Publisher负责包发布，dist-tag修正属于独立registry管理操作；把两者串在同一job会造成包已成功发布但workflow最终失败的假象。
- 本轮将发布新的Manager canary patch验证OIDC链。成功标准是GitHub Actions无需`NPM_TOKEN`即可发布、npm `canary`指向新版本且包带provenance；历史`latest → 0.1.0-canary.4`仍单独处理，不用它判断Trusted Publisher是否成功。
- `0.1.0-canary.6`首次实测中，OIDC权限、验证和provenance签名均成功，但registry返回隐藏授权失败的404。日志中的临时npmrc和占位`NODE_AUTH_TOKEN`一度被怀疑覆盖OIDC，因此下一canary先移除registry-url以分离变量。
- `0.1.0-canary.7`移除registry-url后变为明确`ENEEDAUTH`。对照npm官方Trusted Publisher故障排查后确认独立Manager package缺少必需的`repository.url`，npm无法把GitHub OIDC身份绑定到`notnotype/neuro-book`。现补齐精确repository URL和workspace directory，并恢复官方推荐的setup-node registry配置；下一canary验证包身份绑定。
- `0.1.0-canary.8`补齐repository后仍返回授权404。用户提供的npm配置截图确认Trusted Publisher额外绑定Environment `npm`，而workflow job没有声明Environment；该字段属于OIDC subject的一部分，必须精确匹配。publish job现增加`environment: npm`，并把repository URL写成npm实际规范化的`git+https`形式，下一canary验证完整身份四元组。
- `0.1.0-canary.9`Trusted Publisher实测成功：[workflow 29197120842](https://github.com/notnotype/neuro-book/actions/runs/29197120842)全绿，无`NPM_TOKEN`完成publish并由npm自动生成provenance。registry侧`canary`已指向`0.1.0-canary.9`，package repository/gitHead/integrity与发布提交一致；公开npm真实执行`--version`和`instances config`通过。
- 实际结论：Trusted Publisher配置必须同时匹配`notnotype / neuro-book / release-manager.yml / environment npm / allow npm publish`，Manager package还必须声明精确repository URL。历史错误`latest → 0.1.0-canary.4`不属于OIDC publish能力，仍按独立dist-tag操作处理。

### 2026-07-13：Installation Manifest v3与Windows发布压缩收口

- Installation Manifest硬切schema v3：Release Source/Product记录`archiveSha256`，Manager记录`bundleSha256`，managed Bun/rg同时记录archive与executable SHA256，PortableGit分别记录archive、Git和Bash SHA256。v2实例明确拒绝，Windows Portable只允许完整复用`data/`后重新安装。
- Fresh Install、应用update、Runtime和Tool维护统一进入Operation Journal。managed组件先在不可变版本目录完成下载、解压、版本与checksum校验，再备份并切换`.runtime/bin`；失败按磁盘journal恢复旧wrapper、manifest并清理本次新建目录。容器Profile会在下载前拒绝宿主管理应用工具。
- `doctor --json`改为稳定的`healthy/checks/paths/service/components/operations`结构，check带category、pass/warn/fail与remediation；Manager、Runtime、Tool使用真实文件checksum验证，Source/Product revision和未完成operation会参与最终healthy。TUI消费结构化结果并显示用户可读列表，不再倾倒整块JSON。
- Windows zip统一使用yazl`addFile`惰性打开文件与Node`pipeline`写入，处理backpressure、close和error，并输出文件计数进度。3500文件回归与真实43,777文件、约367MB Windows Product压缩均正常结束；此前`0.7.5`零资产workflow已取消。
- Windows Portable装配改为显式消费Actions中的Source/Product archive，并把两个公开归档的真实SHA256写入v3 manifest。Windows Product job依赖Source artifact并设置45分钟超时。
- 当前验证：Manager typecheck、9个测试文件/25项测试、npm tarball空目录安装审计通过；真实Source archive（2586文件）与Windows Product archive压缩通过。尚未完成公开Manager canary、应用canary A/B、Arch六Profile和Windows Portable A→B终验，因此Task 105继续保持实现中。

### 实际结果与计划差异

- 本轮没有为尚未正式发布的v2增加迁移层，按计划硬切；Release Manifest仍保持schema v2，因为它与Installation Manifest是不同协议，没有为了版本号表面对齐而制造无意义变更。
- doctor已先收口最关键的本地checksum、revision、wrapper路径和operation健康语义；Docker实际digest/HTTP、Git remote/branch/dirty的完整check仍需在公开A/B资产实机链路中继续补齐和验证，不能提前标记完成。

### 2026-07-13：已有实例发现、接管与上下文入口

- 新增统一只读实例检测Module，识别Manifest v3实例、无Manifest Git checkout、可复用Portable `data/`和普通目录；Git检查覆盖package identity、origin、branch、upstream、revision和dirty，损坏Manifest不会退化成普通checkout。
- 新增有限发现和搜索根配置：默认最多扫描3层，跳过`.git/node_modules/.output/.runtime/.deploy`等目录，Windows按规范化真实路径去重，权限错误转成warning而不是中断全部扫描。
- CLI增加`instances inspect/discover/import/roots`和`adopt`。无参数TTY入口按当前上下文进入管理、接管或部署菜单；非TTY只输出检测结果和推荐命令，没有隐式写入。
- `adopt`只支持source-dev/source-product/source-docker。dirty、未知remote、非法branch/upstream和未知Manager-owned目录会阻断；历史无metadata `.output`不进入Manifest，source-product复用现有安装事务在staged build健康后切换，失败恢复旧Product。
- TUI在无已注册实例时展示有限搜索发现的待接管候选；实际导入或接管仍要求用户明确确认，不自动修改候选目录。
- 验证结果：Manager typecheck通过；10个测试文件/29项测试通过；真实当前dirty checkout正确报告阻断和不可信Product；独立干净Git clone的source-product adopt dry-run无写入；Windows与SSH Arch Source Dev实际接管均完成，Manifest v3、wrapper、实例索引和doctor healthy通过，测试目录已清理。

### 实际结果与计划差异

- 没有增加全盘或HOME无限递归扫描；搜索根和深度保持有限，避免Windows性能、权限和符号链接风险。
- Product可信metadata目前只来自有效Installation Manifest；历史`.output`没有独立revision metadata，因此严格按计划视为不可信，不增加宽松导入或长期warning状态。

### 2026-07-13：实例发现与接管系统性收口

- 将原先同时承担扫描、身份和环境检测的实现拆为Candidate Discovery、Offline Inspection、Instance Import和Source Adoption。Discovery只做廉价身份筛选，其他JavaScript Git仓库不再误报；损坏Manifest稳定返回`invalid-installation`，不会进入部署菜单。
- `discoveryRoots: []`现在明确关闭自动发现。TUI把registered/discovered建模为联合列表并缓存本轮扫描，候选可直接import或以Source Dev adopt，invalid候选只展示remediation。
- Import离线门禁覆盖Manifest、Manager/Runtime/Tool checksum和版本、稳定wrapper目标、Product revision、Compose、State Root与未完成Operation；服务或容器停机只产生warning，`--yes`不能绕过blocker。`instances add`和`instances import`共用同一实现。
- Fresh Install不再接受已有Git checkout；Source Adoption使用独立入口。POSIX继续使用短路径detached worktree；Windows改为从固定revision导出tracked source snapshot，避免Bun linked-worktree误判和复制完整Git对象库。Source Dev先验证staged frozen install再安装主checkout；Source Product在staged source构建并备份SQLite；Source Docker以staged source为context并清理失败镜像。
- Windows实测发现深层worktree加node_modules会触发Filename too long，已改为系统临时目录短路径。Arch实测发现State Root `logs/`会触发提交前dirty门禁，现只在adoption提交点允许明确的Manager-owned untracked路径，并把根`logs/`加入gitignore；tracked修改仍始终阻断。
- SSH Arch实际通过Source Dev、Source Product和Source Docker接管；Product完成migration和HTTP健康，Docker完成容器内build/start/HTTP。Compose在POSIX使用当前UID/GID，避免容器把State Root写成root-owned。测试容器和镜像已清理。

### 实际结果与计划差异

- Windows真实验收推翻了“只需缩短linked worktree路径”的早期判断：Bun 1.3.14在linked worktree首次frozen install不可靠，而`clone --no-hardlinks`会复制本仓库数百MB Git对象。最终Windows adapter改为`git archive`固定revision snapshot，依赖安装继续保持`--frozen-lockfile --no-save --linker hoisted`，不使用retry或非frozen降级。
- 失败重试还暴露Operation已回滚但`.deploy/operations`审计记录和空`.runtime`父目录会被误判为未知状态。Inspection现在只在所有journal均为`committed/rolled-back`且没有未知文件时允许重试；任意损坏、未完成或额外文件仍阻断。
- `bun.lock`已按当前根包和Manager workspace manifests完整重建为hoisted解析图。重建使Nuxt、Prisma、Vitest等按现有semver范围前进；因此补齐`vue-tsc`直接devDependency、把Prisma adapter/client/CLI统一到7.8.0，并通过完整应用typecheck和Product build验证，而不是只接受锁文件生成成功。
- Product vendor审查发现新`tsx`已不再依赖`get-tsconfig`，旧required seed会错误阻断Product；该过期seed已删除，实际Nitro external closure仍由产物扫描补齐。
- Windows Bun 1.3.14还存在稳定复现的嵌套执行缺陷：Bun进程直接spawn `bun install --frozen-lockfile`会误报lock变化，同一命令经PowerShell宿主启动则成功。Manager新增Windows Bun子进程适配器，以环境变量JSON传递参数，避免命令字符串和路径转义；POSIX继续直接执行。新增参数转发和非零退出测试。
- Windows Source Dev真实接管最终通过：staged snapshot和主checkout均完成frozen/no-save/hoisted安装，HEAD保持不变，Git无用户改动，Manifest v3提交，`doctor.healthy=true`。当前门禁为应用typecheck、完整Nuxt/Product build、Manager typecheck、13个测试文件/39项测试和npm tarball空目录审计全绿。
- Windows Source Product随后完成真实接管：staged snapshot内安装和构建、SQLite migration、临时HTTP版本健康检查、Source/Product revision一致性及`doctor.healthy=true`均通过，主checkout HEAD保持不变。该Profile按设计不在根生成`node_modules`。
- 无根`node_modules`前台启动首次暴露Nitro把Windows staged长路径序列化为8.3短路径的情况；旧后处理只匹配当前cwd长路径，因此错误报告“patched 0”并留下`file://C:/Users/NAME~1/.../node_modules`。现改为拒绝并替换所有Windows长/短路径及POSIX绝对node_modules file URL，新增4项跨平台回归；修复后133个文件完成替换，Product无根依赖启动并通过`/api/app/version`。
- 公开发布检查确认`0.7.5`没有形成GitHub Release。失败run `29215886890`的Source、Linux Product、Windows Product/Portable和GHCR job实际均成功，assemble因无筛选下载把Buildx自动`.dockerbuild` artifacts一起合并而失败。workflow现按名称分别下载`source`、`product-linux`和`product-windows`，但仍需新canary发布才能验证最终assemble/verify/publish和A→B。
- TUI接管候选当前默认使用Source Dev；完整Profile选择仍由`neuro-book adopt`的Clack入口承担，避免在blessed中复制第二套复杂安装向导。

### 2026-07-13：部署入口、Portable Launcher与Release verify收口

- 公开用户路径重新分流：Windows普通用户明确下载`neuro-book-windows-x64.zip`，高级用户通过PowerShell Stage 0或bunx进入Manager；Linux不再单列“服务器/Docker”入口，所有部署统一进入Manager，并完整解释六种Profile。
- `install.ps1`、`install.cmd`和`install.sh`成为独立Release候选与正式资产，统一进入`SHA256SUMS`。Release verifier严格拒绝Stage 0脚本缺失、额外checksum条目或文件被篡改，Release Manifest schema保持不变。
- 历史实现（2026-07-13）：Portable的CMD/PowerShell Start、Update和Create Admin入口迁入Manager唯一Launcher Module。六个脚本只显式传递`--root`并调用Manager命令，安装器与Portable打包器不再复制模板；退出码由CMD/PowerShell完整透传。
- Task 145 后续已将合同收口为绑定自身 Installation Root 的稳定 wrapper；当前 launcher 本身不包含 `--root`，只传递业务子命令。
- Release run `29229409817`确认Windows Product、Portable和四个托管可执行程序均正常。失败根因是verify job从Portable外部目录直接调用wrapper且未传`--root`，Manager按当前目录查找实例后输出Clack ANSI错误，随后被`ConvertFrom-Json`误判。CI现先检查退出码，再解析JSON，并以外部cwd加显式root验证跨目录合同。
- 首次尝试发布Manager `.12`时，Windows高负载让包含两个真实Git fixture的Discovery集成测试偶发超过Vitest默认5秒，超时中断又导致临时仓库清理EBUSY。隔离复跑2.46秒通过，确认不是Discovery回归；该复杂I/O用例现与其他集成测试一样声明20秒门限，发布脚本未留下commit或tag后再安全重试。
- Manager `0.1.0-canary.12`重试后workflow全绿，npm `canary`已更新且真实`bunx --bun ...@canary --version`返回`.12`。随后创建应用`0.7.7` patch canary并按发布规则使用`--no-watch`返回；新Release workflow在后台运行，不提前把候选资产视为公开完成。

### 2026-07-13：Portable空目录归档与Windows verify修复

- Release run `29236572553`除Windows verify外的Source、Windows/Linux Product、Portable、GHCR和assemble均成功。Windows四个托管程序与Manager命令退出码正常，唯一失败check是`state.logs`：构建stage中的`data/logs/`为空，原ZIP writer只登记普通文件，解压后该目录消失。
- 统一ZIP接口改为严格file/directory联合类型，文件使用`addFile`，目录使用`addEmptyDirectory`；Portable显式归档`data/logs/`，没有用`.gitkeep`污染用户状态，也没有放宽doctor或让只读诊断隐式修复目录。
- Windows verify在`doctor.healthy=false`时会输出全部fail check的id、message和remediation，避免以后只得到笼统的“Portable doctor未通过”。根Vitest配置同时纳入既有Release测试，防止发布门禁测试长期不执行。
- 本机使用现有Source/Product资产重新组装57,738条目的Portable并完整解压。从实例目录外运行wrapper后，Bun 1.3.14、rg 15.1.0、Git 2.55.0、Bash 5.3.15均可执行，`data/logs/`存在，Manager `0.1.0-canary.12`报告`doctor.healthy=true`且0个fail check。

### Portable空目录阶段的实际结果与计划差异

- 原计划只要求新增ZIP空目录回归；实施时发现既有`scripts/release/release-checksums.test.ts`不在根Vitest include内，常规测试不会执行。现只补入既有Release测试目录，没有扩大到新的发布协议或doctor长期能力。
- Manager bundle、Manifest schema和npm接口均未变化，因此没有发布新Manager canary；应用`v0.7.8-canary.20260713.100743Z.f36a8440`继续复用公开的`.12`并已按`--no-watch`启动后台Release链。

### 部署入口阶段的实际结果与计划差异

- 没有把Stage 0脚本加入Release Manifest。它们是用户引导资产，不是Manager需要解析或更新的应用组件；只进入GitHub Release与`SHA256SUMS`可以保持协议边界清晰。
- 没有修改Manager的当前目录发现规则来迎合CI。跨目录调用本来就应使用公开`--root`接口，修复验证命令比让wrapper隐式改变cwd更符合多实例合同。

### 2026-07-13：旧部署入口彻底清理

- 根应用包和运行脚本此前已经删除旧bin；本轮继续清理历史Task、部署契约、Release说明和官网静态包中的旧命令与脚本名，避免用户或Agent从搜索结果复制已失效入口。
- 官网服务器部署卡片改为当前`bunx --bun @notnotype/neuro-book-manager@canary`入口。历史Task继续保留当时的设计与验证结论，但统一以“旧部署CLI（已删除）”表述，不再保留可执行命令。
- 新增Git受管文本回归门禁，扫描文档、脚本、配置和官网静态JavaScript；旧命令名、旧GitHub包地址或同名文件重新进入仓库时测试会失败。

### 2026-07-13：0.7.8 Windows Portable CMD闪退修复

- 公开`0.7.8` Portable的checksum、Manifest v3、Manager、Bun、rg、Git、Bash和doctor均正常；真实双击等价复现确认CMD入口只打印Manager顶层帮助并以0退出，尚未进入migration或Product。
- 根因是`%~dp0`自带尾反斜杠，旧模板把它直接作为带引号的`--root`值传给Bun原生进程，Windows argv解析把后续`start`吞入同一参数。去掉尾分隔符后Manager识别正常；绕过Launcher后migration、Product启动和`/api/app/version`均通过。
- CMD模板现先通过`%~dp0.`解析无尾分隔符的绝对Installation Root，再调用Manager。非零退出时保存原退出码、打印错误并等待用户确认，避免真正的启动错误再次闪退。
- 新增真实`cmd.exe`回归：Start、Update和Create Admin必须分别传递完整子命令，Root不得携带尾分隔符；Manager返回23时Launcher必须显示错误、等待输入并继续返回23。Windows Release verify也会用stub wrapper实际执行三个CMD入口，不再只检查脚本文本。
- 实际结果与原计划一致：没有改变Manager参数协议或把业务逻辑放回Launcher；修复仅收口Windows参数边界和错误可见性。当前按用户要求暂不提交，也未发布新patch。

### 2026-07-13：0.7.8生产白屏与浏览器发布门禁

- 公开Portable的migration、Product进程和`/api/app/version`均正常，但真实Chromium稳定复现空DOM与`ReferenceError: Cannot access 'Jt' before initialization`。交叉检查两个生产Chunk确认它们相互import，根因是`nuxt.config.ts`按包路径强制分组Tiptap/ProseMirror与Studio widgets，破坏了Rollup真实依赖顺序。
- 生产构建已删除全部自定义`manualChunks`，不使用更复杂的包名列表补洞。全新Product构建后，Chromium已看到`.novel-ide-page`，无page error或console error，版本接口与包版本一致。
- 诊断Portable时另发现，安装路径位于名为`workspace`的祖先目录中会让Workspace Root猜测覆盖Manager传入的State Root。现固定“测试Context → 显式运行时Root → 无运行时合同时才推断cwd”的优先级，Project Path仍为`workspace/<project>`，物理目录正确落在`data/workspace`。
- 新增项目自有的`playwright-core`生产Smoke，通过Node+tsx运行（Playwright Node API不交给Bun宿主）。它验证IDE根容器、HTML/JS/CSS资源、page error、应用console error和版本契约；业务API的独立状态码仍由各专项测试负责。
- Windows verify对真实Portable运行migration、Product和Chrome/Edge Smoke；Linux verify用Source archive + Product overlay组装Product Bun并运行同一Smoke。失败时上传服务日志与截图，两个平台通过前不再公开Release资产。

### 白屏阶段的实际结果与计划差异

- 最初计划让Smoke对所有HTTP 4xx/5xx失败。本地真实首启发现Project Session打开期间可出现由业务界面自行恢复的409，它不阻止Vue挂载。最终门禁严格阻断HTML/JS/CSS、page error、应用console error和版本失配，不把生产挂载Smoke扩张成全量业务E2E。
- Playwright Node API在Bun 1.3.14宿主下会稳定挂起，同一脚本由Node 24 + tsx运行正常。因此CI明确使用Node执行，Product应用运行时仍然是Bun，没有改变部署合同。
- 本地完整验证为：应用/Manager typecheck、Manager 14文件42测试、Release/路径聚焦5文件8测试、全新Nuxt Product build、57,787条目Windows Portable组装、Portable doctor和真实Chrome首页挂载均通过。安装根特意放在名为`workspace`的祖先目录下，日志无State Root越界和ESM初始化异常。
- Manager `0.1.0-canary.13`发布workflow `29252645123`全绿，npm与公开bunx均返回`.13`。随后创建应用`v0.7.9-canary.20260713.131204Z.3b064b83`；按发布约定不等待Release Actions，公开资产仍需后续验证。

### 2026-07-13：Docker事务与公开资产最后提交协议

- `0.7.9` Release workflow `29252852294`最终全绿，Source、Windows/Linux Product、Portable、三个Stage 0、Manifest与SHA256SUMS共九个资产已公开；Windows/Linux生产浏览器Smoke均通过，删除“后台构建中”的过期状态。
- Docker更新把Compose切换、容器生命周期、App SQLite备份和Source Docker本地镜像纳入同一Operation Journal。失败与进程中断共用同一回滚实现：停止失败容器、恢复SQLite/WAL、恢复或删除Compose、重启旧digest，并清理未提交镜像。
- Windows Release门禁保留Launcher参数stub测试，同时直接从Portable目录外执行真实`Start Neuro Book.cmd`，由Manager承担migration、前台Product进程和健康启动，再运行Chromium页面Smoke。
- Release发布拆成`publish-payload → verify-public-payload → publish-index`。Source/Product/Portable/Stage 0先公开并从GitHub公开URL重新下载校验；正式Manifest与SHA256SUMS最后上传，因此任一公开Payload损坏都不会形成Manager可安装Release。
- Stage 0文档统一为“可审计的联网引导脚本”：固定Bun资产并运行Manager `@canary`，应用版本由Manager选择最新完整Release；不再承诺离线安装或固定应用Release。
- 实际计划差异：Docker镜像必须在build成功后立即写入Journal，不能等`prepareUpdate()`整体返回，否则后续Manager/Compose准备失败会留下孤儿镜像；实现因此把Journal更新推进到build完成点，并让catch统一重新读取持久化Journal恢复。
- Manager `0.1.0-canary.14` release workflow `29258344967`全绿，npm `canary`与真实`bunx --bun ...@canary --version`均返回`.14`。

### 2026-07-18：Release Candidate、Profile Update Planner与Operation Journal v2

- 审查确认下一次Release存在确定性循环：Payload公开后，公开GHCR安装仍使用默认Resolver寻找尚未发布的最终`release-manifest.json`，因此验证job必然失败，`publish-index`永远无法运行。Manager现在支持`install/update --release-manifest <local-path|https-url>`，默认用户路径仍只选择已完整装配的正式Release；候选CI使用本地Manifest和已公开Payload完成验证。
- Release workflow不再使用浮动`@canary`或只比较版本字符串。Assemble会下载Manifest记录的精确npm Manager tarball，逐字节比较本地`neuro-book.mjs/schema.mjs`、npm包与Portable内嵌Manager；公开GHCR和Windows`0.8.6 → candidate`更新也使用该精确版本。两个公开门禁完成后才发布最终Manifest与SHA256SUMS。
- `neuro-book update --component`已删除。新的`update-planner.ts`按Profile固定原子范围：Source Dev更新Source；Source Product更新Source+Product；Source Docker更新Source+image+Compose；Product Bun/Portable更新Release Source+Product；GHCR更新container Source+digest Product+Compose。Runtime与Tool只保留独立维护命令。
- Update预检在Operation前完成Release解析或Git fetch、Manager方向与无操作判断。应用/Manager/channel均一致时无持久化副作用；Manager只允许严格升级，同版本bundle checksum不同或执行版本低于Manifest时直接失败，不覆盖不可变版本目录。
- Git staged checkout现在不仅用于build，也用于Source Dev frozen install与目标revision migration。主checkout只在migration/健康完成后fast-forward；恢复读取真实HEAD：target+healthy完成Manifest提交，previous执行回滚，第三种HEAD或未到healthy的target停止人工处理。
- Operation Journal硬切v2，记录真实SQLite逻辑URL/物理路径/backup/checkpoint、Git revision、Docker原运行状态/stop状态/Compose/镜像、Manager wrapper和即时创建路径。已提交v1作为审计记录跳过，未完成v1拒绝自动恢复。Docker原来停止或不存在时，目标健康验证后保持非运行状态；回滚不再无条件启动旧实例。
- App SQLite备份不再硬编码`workspace/.nbook/neuro-book.sqlite`。Manager读取State Root `.env/config.yaml`，验证`busy=0 && checkpointed=log`后复制真实文件；Docker外部数据库在Compose生成前拒绝，Portable外部数据库由doctor警告可移动性风险。
- Windows Portable正式启动与更新健康窗口统一为120秒并定期输出等待阶段；子进程提前退出仍立即失败。

#### 本轮验证与计划差异

- Manager串行完整回归为22文件87项通过；Profile planner、候选Manifest、Journal v2、SQLite backup、Git/Docker恢复和不可变Manager聚焦40项通过。Manager/Runtime/根typecheck、Manager build、Release workflow YAML解析均通过。
- SQLite/Prisma/Login聚焦4文件20项通过；登录测试已改为mock当前Boot Config入口，并恢复真实Prisma查询分支，不再误走鉴权关闭路径。
- 公开`0.8.6`基线Release与Portable资产已通过GitHub CLI确认存在，workflow已把它固定为未来Windows A→B门禁输入。
- SSH Arch使用干净clone叠加本轮源码验证了clean-checkout边界。首次Manager测试暴露SQLite Location位于`server/database`时会回退读取根Nuxt tsconfig；实现改为复用已有`server/runtime`独立编译边界后，远端Manager相关20文件80项、Runtime typecheck及SQLite/Prisma/Login 20项通过。
- 同一Arch环境完成真实47阶段Docker build，frozen workspace install保持lockfile不变；镜像以分离挂载State Root启动，创建管理员后真实`POST /api/auth/login`与`/api/auth/me`均返回admin session，SQLite只位于挂载Root。首次login失败仅因测试夹具session password不足32字符，改用合法长度后通过；这没有引入产品兼容分支。
- 远端容器、镜像、clone与State Root最终均已清理。容器root写入导致普通用户首次删除失败，最终使用一次性root容器删除明确测试目录，并再次断言无残留。
- 与原计划不同：本轮尚未发布预计Manager `.20`或应用patch，也没有公开候选Manifest可供完整Windows/Arch A→B实跑。因此Task 105继续保持Implementing；npm/Portable/GHCR公开验证仍是发布前阻断，不把本地源码门禁写成已发布完成。

## TODO / Follow-ups

- [x] Windows Portable 使用 `data/` State Root，不使用 junction。
- [x] Manager 同仓独立 package、独立版本和 npm 发布。
- [x] Installation/Release Manifest 严格 schema。
- [x] Stage 0 用户 cache Bun、Manager Host Runtime 接管与空目录 Git materialize实现及聚焦测试通过。
- [x] Windows PortableGit/rg/Bun 托管、bash、checksum、wrapper、许可证与再分发记录完成本地组装验证。
- [x] Host Platform Module统一原生/进程架构、Product平台与Profile门禁；install/import/doctor/start/update/Runtime/Tool不再各自判断平台。
- [x] Managed Asset Repository统一Bun、Stage 0 Bun、ripgrep与PortableGit的可信复用、staging验证、不可变代次提交和失败清理；Fresh Install不从磁盘现状反向认证资产，同版本损坏资产也不会原地覆盖。
- [x] Install Preflight统一Clack、`--yes`和`--dry-run --json`的宿主、命令、端口、目标目录、Release与组件来源门禁。
- [x] Windows/Linux Product artifact 与 Windows Portable 结构。
- [x] 修复PR #11暴露的Release Manifest消费端AArch64资产名映射，并用穷举类型映射约束五个ProductPlatform。
- [ ] 提升并先发布包含Linux AArch64、macOS平台门禁与Podman合同的新Manager版本；应用Release引用新的`minManagerVersion`，并由公开Manager精确版本消费候选manifest。
- [x] Linux POSIX Stage 0支持x64/AArch64 glibc；macOS POSIX Stage 0支持x64/ARM64，并分别使用sha256sum/shasum与独立平台门禁。
- [ ] Linux AArch64原生Product runner已通过；完成`linux/arm64`公开GHCR runtime门禁并将公开资产证据记录回本任务。
- [ ] 完成macOS Phase 1：Source Dev、Source Docker、GHCR、Docker Desktop与Podman machine真实验收。
- [x] 完成macOS x64/ARM64原生Source Product/Product Bun runner验收；公开npm与Release资产证据仍由发布TODO跟踪。
- [x] 将Container Engine写入Installation Manifest v4与Operation Journal v2，覆盖自动选择、显式选择、daemon不可用、rootless Podman与恢复固定engine。
- [x] 用正向宿主平台/Profile矩阵替代负向unsupported列表，锁定POSIX不显示Windows Portable、Windows ARM64/Linux musl不回退x64。
- [x] 删除旧部署入口并同步当前部署文档。
- [x] 停止现有服务后重建根 `node_modules`，完成全新 Product build和无根 `node_modules` Product 隔离运行。
- [ ] 使用本轮新 `.output` 完成 Windows Portable start/create-admin/update/data 保留 smoke。
- [ ] Linux Product Bun、Source Docker容器内build和既有公开GHCR runtime smoke已在SSH Arch通过；仍需应用A首次Manifest v4公开、应用A→B事务更新和公开数据保留/回滚验收。
- [ ] 增加下载中断、checksum、manifest mismatch、migration、文件占用和健康检查失败的完整故障注入矩阵。
- [x] 将Attachment hard cut纳入Operation Journal：dry-run记录受影响session与hash，原生/Docker统一apply，失败或崩溃时先恢复session再回滚Product/SQLite/Compose。
- [x] 实现统一 installation Operation Journal，覆盖 Product、Release Source、Compose、数据库、created paths 与 Git commit point 恢复。
- [x] 公开发布Manager `0.1.0-canary.5`并触发应用`0.7.5` canary；Release资产闭环仍由上方未完成项跟踪。
- [x] 实现无参数Clack安装向导、用户级实例索引、`--root`/`--instance`选择和blessed多实例TUI；仍需随下一Manager版本公开后做真实bunx交互smoke。

### 2026-07-15：Agent Workspace Root逻辑引用与物理路径收口

- 根因确认：session中的`workspaceRoot`是可迁移逻辑引用，但Harness此前直接把它作为文件系统cwd。Windows Portable因此会访问Installation Root下的`workspace/`，而不是真实State Root中的`data/workspace/`。
- 新增深的Agent Workspace Location Module，Interface只负责两件事：严格规范化逻辑引用，以及按当前State Root解析绝对物理根。managed引用只允许`workspace`和`workspace/.nbook`；外部绝对Project Workspace继续支持，任意其他相对路径直接拒绝。
- RunFrame与ToolExecutionContext硬切为`workspaceRootRef`和`workspaceFsRoot`。read/write/edit/apply_patch/bash、Plan Mode、World Engine临时代码、Subject Memory/RAG文件定位、context access和Agent文件历史使用物理根；子Agent、Effective Config、Profile Home、变量、DTO与session摘要继续使用逻辑引用。
- Plan Mode持久化的`workDirectory`也改为逻辑工具路径，避免通过custom state重新写入Portable旧盘符。每次invocation重新解析物理根，因此移动完整`data/`后旧session会命中新位置，不需要JSONL迁移或路径fallback。
- Manager新增共享State Integrity Module。State Root与Installation Root不同时，根`workspace/`若和真实Workspace Root分叉，doctor产生`state.shadow-workspace` fail，status加入人工处理步骤，start打印警告但允许继续；同目标junction/symlink不误报，Manager永不自动复制、合并、删除或重命名用户数据。
- Release Windows/Linux Product job增加Agent State Root聚焦门禁。本地验证：应用与Manager typecheck通过；Manager 16文件50项通过；Agent Location、真实Harness write/apply_patch/bash、user-assets、文件工具、Subject Memory、World Engine、Plan Mode和RunFrame组合9文件113项通过；Manager npm pack审计仍只有5个文件，空目录安装与命令执行正常。
- 更宽的Harness回归已把本任务引起的Plan Mode期望更新为逻辑路径；当前仍有一个Task 108图片附件fixture因声明MIME与内容不一致而失败，未在Task 105中修改该并行功能。
- 与计划差异：本轮没有执行浏览器验收；核心门禁是Harness、CLI和文件系统路径。公开Manager/Application canary尚未发布，因为当前工作区同时包含未提交的Task 108改动，不能在不混入无关变更的前提下安全创建发布提交。

### 2026-07-16：Task 109 Product Runtime路径门禁深化

- State Root完整性判断已抽到应用与Manager共用的Runtime Module；Nitro bootstrap固定先创建真实Workspace Root再检查，Docker通过容器内同一bootstrap覆盖，不在shell entrypoint复制算法。
- Workspace API、Profile Home与Variable Storage已统一复用Generic File Path realpath containment；读取/写入跟随目标，rename/remove只验证目录项父级，因此既阻止symlink/junction逃逸，也能安全清理恶意链接。
- Product staging现在支持隔离`NEURO_BOOK_OUTPUT_DIR`与`NEURO_BOOK_PRODUCT_STAGE_DIR`。本地全新Product在无根`node_modules`、独立State Root下真实执行Agent read/write/edit/apply_patch/bash；完整移动State Root后旧session由新RuntimePaths继续运行，Application Root始终没有生成影子`workspace/`。
- 同一Product完成SQLite deploy migration与HTTP版本接口smoke。该证据来自当前源码和对应本机构建overlay，不替代公开Release Product Bun、Windows Portable或SSH Arch验收；Task 105继续保持实现中。
- Release verify已接入同一Agent State Root smoke：Linux对候选Source+Product overlay组装物执行；Windows使用Portable managed Runtime/Tool对真实`data/`执行、移动并恢复，再继续Launcher与browser smoke。当前仅静态语法和本地Windows脚本行为通过，仍需下一次公开workflow实跑证明。
- State Root integrity已完成真实权限错误平台smoke：Windows隔离目录ACL deny返回`inspection-error(realpath-checked, EPERM)`；SSH Arch隔离`/tmp`目录在`chmod 000`后返回`inspection-error(lstat, EACCES)`。两者都没有把检查失败误判为clean，也没有触碰用户数据；远端旧checkout未作为当前代码证据。

### 2026-07-16：macOS/ARM64目标扩展与PR #11审查

- 用户要求完善Task 105，使统一安装体系正式覆盖macOS、ARM64等平台，并评估是否直接修改贡献者分支以及如何回复PR。
- [Issue #10](https://github.com/notnotype/neuro-book/issues/10)的直接原因是Manager此前按宿主OS/架构整体拒绝Darwin与ARM64；macOS上`bun dev`能够运行，说明Source能力存在，但正式Manager、Stage 0、Product、更新和回滚合同没有跟上。
- PR #11新增Linux AArch64 Product、`linux/amd64 + linux/arm64` GHCR、Linux AArch64 Stage 0、macOS的Source Dev/Docker入口、Docker/Podman选择与rootless Podman用户映射。fork首次Release因owner含大写字母导致OCI引用验证失败，改为小写后第二次workflow全绿。
- 审查确认fork全绿只证明构建、装配与现有x64验证链通过，不能证明用户安装闭环。最小复现显示Release resolver仍把所有非Windows Product映射为Linux x64资产名，新增AArch64条目会使整个Release被Manager拒绝；影响不局限于ARM64宿主。
- PR内Manager代码改变但package version仍为已公开的`0.1.0-canary.14`，Release workflow只比较版本字符串。npm旧`.14`会在读取`minManagerVersion`升级提示前因未知ProductPlatform拒绝manifest，Stage 0最终也会运行旧Manager。
- Podman选择当前只做进程内自动探测，没有进入Installation Manifest或Operation Journal；双engine共存、显式环境变量安装或中断后恢复时可能切换到另一套容器状态。Linux平台的负向unsupported列表还会错误放行Windows Portable。
- 决策：PR当前不应直接合并。先由贡献者按明确验收项修复是默认协作路径；维护者不应在未沟通时直接向作者分支推送跨协议修改。若作者明确同意维护者协作，再从隔离checkout向其分支推送小而可审查的补充commit，不能从当前包含其他未提交任务的工作区直接操作。
- 本轮只更新Task 105的目标、平台矩阵、发布协议、验收门禁和TODO；没有修改PR业务代码、没有向GitHub发表评论或推送、没有执行macOS/ARM64真实运行与浏览器验收。原计划中的“支持macOS/ARM64”因此仍是待实现合同，不是已交付状态。

### 2026-07-16：Attachment hard cut发布事务遗漏

- Task 108最终发布链审查确认：Product已打包Attachment migration脚本，但Manager的`migrateApplication()`只执行Prisma migration，Docker Profile还会跳过该函数。当前已手工迁移的开发Workspace不代表其他安装实例会自动迁移。
- 新runtime会对旧raw image返回`migration_required`，所以这不是可延后的可选维护命令。包含旧图片session的实例在更新后可能通过基础HTTP健康检查，但读取历史session时失败。
- 不能在Product切换后直接顺手运行`--apply`：若后续健康检查失败，当前Operation Journal会恢复旧Product/SQLite/Compose，却不会恢复已改写的session JSONL；旧Product无法读取新Attachment引用格式，事务回滚因此不完整。
- 推荐实现将Attachment data migration作为Operation Journal的一等组件：新Product先dry-run并返回受影响文件与hash，Manager只备份实际变化的session；apply与runId进入journal；失败或崩溃恢复时先恢复session，再恢复Product/SQLite/Compose。原生与Docker Profile共用同一状态机。
- 当前实现已完成该门禁：migration提供rollback；Operation Journal在apply前保存runId与受影响session的source/target hash，apply后补backup path；恢复时先停止新Docker部署释放runtime lease，再撤销session格式，之后恢复Product/SQLite/Compose。
- `start`也改为maintenance journal，不再存在无journal hard cut；`applied`状态拒绝`not_started`伪成功，Product缺脚本时fail closed。Manager 63项、根typecheck与真实Product migration smoke通过。
- SSH Arch当前源码Source Product/Source Docker已通过migration、Agent同根/分离根和HTTP；公开Product Bun、GHCR、Windows Portable与workflow仍待新Manager canary和应用canary发布后验证。
- 当时的发布计划是让业务提交继续保持已公开的`0.1.0-canary.14` package/lock一致，再由Manager release helper一次性bump并提交`.15`，避免同版本不同bundle。`.15`随后按计划创建tag，但clean-checkout验证失败；实际处置与新的`.16`顺序记录在下一节。

### 2026-07-17：Manager clean-checkout编译边界修复

- `manager-v0.1.0-canary.15`本地release helper的typecheck、63项测试与pack审计均通过，但GitHub clean checkout没有`.nuxt/tsconfig.json`。Manager Vitest导入共享`server/runtime/state-root-integrity.ts`后，Vite/OXC按源文件目录向上加载根`tsconfig.json`，最终因根配置继承不存在的`.nuxt/tsconfig.json`而使4个suite在transform阶段失败；npm publish因此未执行。
- `server/runtime`现在有独立、无Nuxt依赖的tsconfig，明确它是Task 109路径核心与State Root完整性检测的共享编译边界。新增`runtime:typecheck`，本地Manager release helper和`release-manager.yml`都会在Manager package验证前执行，避免开发机残留`.nuxt`再次掩盖clean-checkout故障。
- 隔离clone没有`.nuxt`，只共享已安装依赖；修复前稳定得到`4 failed / 14 passed`，修复后为`18 files / 63 tests passed`。共享Runtime typecheck、Manager typecheck和5文件、约0.35 MiB的pack空目录审计均通过。
- 实际结果与原发布计划不同：`.15` tag与release commit不会移动、删除或复用；下一个可发布版本改为`0.1.0-canary.16`。在npm `canary`真实返回`.16`前，不创建引用新Manager能力的应用canary。
- `0.1.0-canary.16`最终由workflow `29556688067`在38秒内完成clean-checkout验证与Trusted Publisher发布。npm `canary`返回`.16`，全新`BUN_INSTALL_CACHE_DIR`中的`bunx --bun @notnotype/neuro-book-manager@0.1.0-canary.16 --version`同样返回`.16`；应用canary发布门禁已解除。

### 2026-07-17：0.8.1 Product预检clean-checkout修复

- 应用`v0.8.1-canary.20260717.053159Z.81da7a43` workflow `29557566537`中，Source archive与GHCR镜像构建成功，但Windows/Linux Product都在`Verify Agent State Root paths`阶段失败，assemble及所有公开验证随即跳过；Release保持零资产，没有形成可被Manager选择的半成品Manifest。
- 根因不是Task 109路径行为失败，而是Product job在clean checkout中先运行根Vitest、后运行`nuxt:build`。根`tsconfig.json`合法继承`.nuxt/tsconfig.json`，但测试执行前尚未运行`nuxt prepare`，Vite/OXC因此在转换`server/agent/test/setup.ts`时报告`Tsconfig not found`。本机残留`.nuxt`曾掩盖该顺序漏洞。
- 新增统一`test:agent-state-root`脚本，固定执行`nuxt prepare`后再运行两组State Root测试；Windows/Linux Product job只调用该入口，不为整个`server/agent`复制第二套tsconfig，也不改变应用根tsconfig合同。
- 审计同时发现旧workflow列出的`agent-workspace-location.test.ts`已经不存在，Vitest会静默忽略该路径。新脚本改为真实的`workspace-root-ref.test.ts`与Harness State Root测试；无`.nuxt`隔离clone中原命令稳定复现transform错误，新脚本自行生成`.nuxt`后完成`2 files / 7 tests passed`。失败的`0.8.1` tag保留审计记录，修复后发布新的`0.8.2`。

### 2026-07-17：Manager子命令版本参数路由修复

- 公开Manager `.16`实测`neuro-book install --version <app-version>`时只打印Manager版本并以0退出。根因是Commander顶层`.version()`与install、update、runtime install的子命令`--version`重名，父命令选项会跨过子命令截获参数；因此原CLI文档中的显式应用版本选择实际上不可用。
- 使用Commander官方`enablePositionalOptions()`硬切参数位置：`neuro-book --version`继续输出Manager版本，全局`--root/--instance`必须位于子命令前，子命令后的`--version`归install/update/runtime自身。现有Portable Launcher和文档本来就使用`--root <path> <command>`顺序，无需兼容两套协议。
- npm pack审计现在从真实tgz安装bundle，分别断言顶层Manager版本输出与`install --version ... --dry-run`确实进入install JSON计划。Manager typecheck、18 files / 63 tests和5文件约0.35 MiB pack均通过；修复将使用新的`.17`发布，不复用`.16`。
### 2026-07-17 GHCR非root安装与只读Product Root收口

- 公开Manager `.17`从空目录安装GHCR时，容器先因`/app/.env`不可写失败。根因是Compose只挂载`workspace/`、`config.yaml`和`logs/`，遗漏State Root `.env`；Manager现对GHCR与Source Docker统一增加`../.env:/app/.env`，并由Compose合同测试固定。
- 补齐`.env`后，启动继续在`compileVariableDefinitions()`创建`/app/.agent/workspace/...`时失败。进一步审计发现Profile/Variable编译、Profile同步、worker fan-in、预览和runtime artifact import cache均残留cwd写入。这不是容器权限配置问题，不能通过root用户或`chmod /app`规避。
- 编译staging现在按显式源码root定位到同级`agent/.staging`：系统源码构建仍位于Application Root，用户Profile/Variable与运行cache自然位于State Root。Product运行时对内置system assets使用`writePolicy=forbid`；全新时零写入，过期时提示重新构建/安装匹配Product。
- runtime artifact import带cache key时必须显式传`cacheRoot`，类型系统阻止未来再次从cwd猜测。系统Profile catalog使用用户Agent `.staging/runtime-artifact-import-cache`，Variable与World Engine分别使用各自可写领域根。
- Docker runner在最终Product tsconfig写入后执行`prepare-system-assets --force --product-build`，让Variable/Profile manifest绑定最终镜像路径。`--product-build`只属于组装阶段，普通运行和HTTP同步不能借此写只读system assets。
- SSH Arch以宿主普通UID/GID构建当前源码镜像并挂载独立State Root。SQLite、HTTP版本、14个Profile catalog、Agent read/write/edit/apply_patch/bash、Config/Profile/Variable、外部Project图片与Attachment均通过；`/app/.agent`不存在，runtime cache只出现在`workspace/.nbook/agent/.staging`。
- Product Agent smoke原先把外部Project建在`${stateRoot}-external-project-*`，同根容器会得到`/app-external-project-*`并错误假设根目录可写。runner现使用系统临时目录表达真正的外部绝对Project，不改变生产路径能力。
- 实际计划差异：原先只预期修复Compose `.env`挂载；真实链路继续暴露了Product artifact freshness和动态import cache两层问题。本轮选择完成系统性只读合同，而不是逐个EACCES打补丁。下一步发布Manager `.18`与应用`0.8.3`，再用公开npm/GHCR执行空目录安装、doctor与HTTP复验。

### 2026-07-17 0.8.3 Release Product freshness失败

- Manager `0.1.0-canary.18`已由workflow `29569085799`成功发布，npm `canary`与全新Bun cache精确bunx均返回`.18`。Manager本轮不需要再次发布。
- 应用`0.8.3` workflow `29569283513`完成Source、GHCR image build、Windows/Linux Product与assemble，但Windows/Linux正式启动预检都因内置Profile `dependency_changed`失败，最终publish步骤跳过，Release保持零资产。
- 候选manifest把158个`@earendil-works/pi-*`文件记录为根`node_modules`依赖；Installation Root合同明确没有根`node_modules`，因此Product overlay与Source archive组合后必然失效。第二层问题是构建manifest使用`.output/server/assets/...`物理root label，与运行时逻辑label不同。
- Product Profile/Variable现共享`.output/server`自包含编译上下文；Nitro后处理和Release归档前使用同一个只读合同验证依赖边界、manifest root与freshness。没有修改Release Manifest或Installation Manifest schema，也没有让Manager在运行时修复Product。
- 本机Source ZIP + Windows Product ZIP隔离组装、0 stale system assets预检与Agent State Root smoke通过。下一应用patch为`0.8.4`；仍需公开workflow重新验证Product Bun、Windows Portable、GHCR、Stage 0与最终payload。

### 2026-07-17 0.8.4公开闭环与空State Root安装阻断

- `0.8.4` workflow `29576999784`已全绿：Windows/Linux Product、Portable、GHCR、Stage 0、两端Agent State Root、Portable shadow workspace、真实启动、公开payload checksum与GHCR digest均通过；Release最终公开9个资产和完整Manifest。
- 公开Manifest严格对齐应用版本、`c61360c7b147ed16d7c4421c8644f558d352eb18` source revision、Manager最低版本`.18`、两个Product平台与固定GHCR digest。npm公开Manager `.18`的顶层/子命令参数合同也已再次确认。
- SSH Arch使用独立HOME、空Installation Root和公开资产安装Product Bun时，SQLite migration成功，随后Attachment dry-run因`workspace/.nbook/agent`不存在而失败。该链路证明候选Product门禁不能替代Manager首次安装事务。
- 失败操作已按合同恢复：operation journal为`committed / rolled-back`，安装根不残留Product、Source文件、Manifest、State Root文件、Manager wrapper或Runtime版本目录；仅保留审计journal和空目录骨架。
- 根因是Attachment migration preflight已得到0个session计划后仍无条件检查Agent Root写权限。修复位于migration领域Module：空计划直接返回且dry-run零写入；不让Fresh Install伪造Agent数据目录，也不放宽任何非空session的权限/checksum门禁。
- 新增空Workspace Root回归并先红后绿；Attachment migration完整22项、Manager迁移/Operation 3 files / 19 tests和根typecheck通过。Manager bundle未变化，下一应用patch使用`0.8.5`；公开Product Bun与GHCR需在新资产发布后重新验收。

### 2026-07-17 0.8.5 Product Bun通过与GHCR one-off ENTRYPOINT阻断

- `0.8.5` workflow `29579336942`九资产与Windows/Linux verify全绿，公开payload checksum、GHCR digest和最终索引均通过。
- SSH Arch公开Product Bun首次安装成功：Manifest v3与revision正确，doctor healthy，安装operation为`committed/success`且0-session时不创建Attachment plan；公开Product完成Attachment rollback、分离State Root五工具/Config/Profile/Variable、完整移动恢复、无根`node_modules`启动与HTTP精确版本验证。
- GHCR空目录安装在`planAttachmentMigration()`挂起。容器inspect确认Config.Cmd是预期`bun migrate-agent-attachments --dry-run`，但Product ENTRYPOINT忽略参数，执行Prisma migration后启动长期Web服务；one-off容器无宿主端口映射，Manager永远等不到命令输出。
- 修复所有权位于Manager Docker Adapter：`runDockerApplicationCommand()`显式把命令首项传给Compose `--entrypoint`，其余argv放在service之后；空命令立即拒绝。没有修改Product ENTRYPOINT、没有增加超时掩盖、没有把maintenance命令改成宿主执行。
- 中断公开失败安装后，Operation为`committed/rolled-back`，Compose、网络、容器、Manifest和wrapper均无残留。Manager完整18 files / 65 tests、typecheck和pack审计通过。
- 该修复需要先发布Manager`.19`，再发布minManagerVersion引用`.19`的应用`0.8.6`；公开GHCR最终用户链通过前Task 105继续实现中。

### 2026-07-17 0.8.6 GHCR公开终验

- Manager `0.1.0-canary.19` workflow `29582201585`全绿并通过npm Trusted Publisher；本机与SSH Arch精确`bunx`均返回`.19`。应用`0.8.6` workflow `29582562773`完成Windows/Linux Product、Portable、GHCR、真实启动、公开payload复验与最终索引，Release公开9个资产。
- Manifest记录source revision `00fd4fceebb18b08abd3324d19d0ea0f91e31261`、最低Manager `.19`与GHCR digest `sha256:c3e4dc5ae531e3316a61525e936b5dfaacffc10b2c76a514d2bc27a4a48bff64`；容器ref、digest和revision一致。
- SSH Arch从空目录使用公开Manager安装GHCR成功。Attachment one-off migration真实退出，Operation为`committed / success`，Manifest和wrapper提交完成且没有残留one-off容器；这与`.18`阻断时的`rolled-back`证据形成完整修复对照。
- doctor healthy；容器内Attachment rollback和同根State Root Agent smoke通过；`/app/.agent`不存在。停止Compose后，Manager `start`按固定digest重新启动，HTTP返回精确版本，State Root标记保持不变。
- 测试实例、隔离HOME、容器、网络和本轮镜像引用均已清理。Task 108/109因此完成；Task 105继续跟踪其尚未完成的平台扩展、Portable用户链与故障注入，不把本次GHCR终验扩大解释为整个Task 105归档。

### 2026-07-18 Windows Portable SQLite与Update事务回归

- 公开`0.8.6` Portable在鉴权开启后稳定复现登录500。数据库配置层已经计算State Root下的绝对`sqliteFilePath`，但Prisma仍消费原始相对URL，最终相对Product进程cwd打开错误文件；临时改为现有数据库的绝对`file:C:/...`后登录链恢复，证明不是用户数据库损坏。
- App数据库新增唯一SQLite Location解析接口。`.env`与Boot Config继续保存逻辑相对URL，运行时URL和物理path统一从当前State Root计算；Prisma Runtime与Prisma CLI准备流程复用同一算法，不修改用户配置、不增加旧路径fallback。
- Update的`bad parameter or other API misuse`来自`bun:sqlite`以`{create:false}`覆盖默认flags。备份现在显式使用`{readwrite:true, create:false}`，并把open、checkpoint、close和copy错误统一标注为“App SQLite备份”及目标路径；不存在的数据库不会被创建。
- Release Profile在创建Operation、backup和staging前完成版本与checksum差异规划。应用、channel和Manager均一致时返回`already-current`且无文件系统副作用；仅Manager较新时只接管Manager、wrapper和Manifest。审查中额外修复GHCR仅Manager更新仍生成Compose的问题。
- CLI、Clack上下文菜单和TUI统一消费`UpdateResult`，不再各自猜测更新是否发生。显式Runtime/Tool维护命令保持独立，不把同版本Update扩展为隐式repair。
- Release Windows verify新增真实鉴权链：创建管理员、确认SQLite只位于`data/workspace/.nbook`、从Portable目录外启动、POST登录并验证管理员/session cookie，同时拒绝Installation Root影子`workspace/`。该门禁将在下一次发布时运行，本轮按决策不发布版本。
- 聚焦结果：SQLite Location/Database Config/Prisma env共12项通过；Manager SQLite备份与Update预检共8项通过；Manager typecheck、workflow YAML与新增PowerShell步骤语法通过。
- 真实Windows链使用公开`0.8.6` Portable ZIP解压全新实例，只把隔离副本的`.output`替换为当前源码Product build，并通过本地Manager创建管理员。随后从Portable目录外直接启动Product，真实`POST /api/auth/login`返回200、`authEnabled=true`、admin身份和session cookie；数据库只位于`data/workspace/.nbook/neuro-book.sqlite`，Installation Root没有影子`workspace/`。
- 同一实例使用本地Manager执行同版本Update，输出“已是最新版本”；Operation文件数保持1、backup/staging保持0、数据库SHA256逐字节不变。SQLite checkpoint/open失败的事务边界由聚焦Manager测试覆盖，没有为故障注入破坏这份真实用户数据库。
- 混合测试overlay首次经Manager `start`时在30秒健康窗口内未就绪；相同Product随后直接通过正式`product-start.mjs`启动并完成HTTP/登录链。该现象可能来自“公开Source/State + 当前未发布Product overlay”的首次资产准备差异，本轮不据此修改启动超时；未来完整候选Portable仍由Release launcher门禁判定。
- 实际计划差异：Update预检实现后发现GHCR的Compose生成不受差异集合约束，已在同一事务切片中修正；真实Portable验证使用“公开0.8.6完整布局 + 当前Product overlay”，而不是不存在的未来公开资产。没有迁移、移动或重写用户数据库，也没有发布npm或应用patch。

### 2026-07-18 Installation Health与公开GHCR门禁

- Manager新增`installation-health`深层Module，正式区分Offline Integrity与Runtime Service。`instances import`只消费离线门禁；`status`执行轻量探测；`doctor`执行checksum、版本、wrapper真实内容、Source/Product revision、State Root、Compose和Operation完整检查。
- 容器状态按用户语义分类：未创建或退出码0的停止容器为warning且`healthy=true`；Docker/Compose不可用、Compose镜像与Manifest不符、实际容器镜像错误、异常退出、health失败、HTTP不可达或版本错误为fail。原生服务同样把正常停机与错误端口/版本区分开。
- Docker `start`在`compose up -d`后等待`/api/app/version`返回精确版本。安装、更新、Operation恢复和普通start均传入Manifest应用版本，不再把Compose命令成功当作应用健康。
- stable Manager/Runtime/Tool wrapper模板提取为纯render函数；写入侧与doctor比较侧使用同一来源，wrapper存在但指向旧组件会明确失败。TUI删除`object`手工断言，直接消费`InstallationStatus`和`DoctorReport`。
- Release workflow新增公开GHCR安装门禁：公开Manager空目录安装、running doctor、停止容器后的healthy+warning、再次start和HTTP验证全部通过后才发布最终Release index。
- 本机Manager 22 files / 78 tests、typecheck、build和pack审计通过；根Harness 169/169、black-box+payload 25/25、路径/Attachment聚焦回归全绿。SSH Arch确认Bun 1.3.13、Docker 29.4.2和Compose 5.1.3可用，但新Manager尚未公开，因此本轮没有发布canary，也没有把CI设计写成已执行的公开证据。

### 2026-07-18：PR #11跨平台能力整合

- 采用merge commit保留贡献者历史，并以当前主线Profile Update Planner、App SQLite Location、Release Candidate Resolver和Operation Journal v2为底稿整合PR，而不是选择任一侧整文件覆盖。
- Installation Manifest硬切v4，容器Profile持久化`docker | podman`，原生Profile固定`null`；Release Manifest硬切v3并要求Windows x64、Linux x64/AArch64 glibc、macOS x64/ARM64五个Product完整唯一。v3 Installation明确重新安装，不增加迁移层。
- Docker Adapter现在负责新安装engine选择与验证；Manifest/Journal随后固定engine贯穿start、status/doctor、admin、migration one-off、update、rollback和镜像清理。rootless Podman不重复注入宿主UID；`create-admin`删除Podman不兼容的`ps --status`探测，直接使用共同支持的`compose exec`。
- Managed Bun与ripgrep资产使用ProductPlatform穷举映射。POSIX Bun在缓存复用和新下载提交前恢复执行位并执行`bun --version`；Stage 0覆盖Linux x64/AArch64 glibc和macOS x64/ARM64，分别使用`sha256sum`与`shasum -a 256`。
- Release资产与workflow保留“公开payload、验证公开GHCR/Windows A→B、最后发布Manifest/SHA256SUMS”的主线顺序，并加入前置公开Manager bundle门禁、五平台native Product、linux/amd64+linux/arm64 OCI、Linux ARM64 Playwright与macOS双架构Product smoke。所有Product继续执行system artifact与runtime test-source边界检查。
- 本地已通过应用与Manager typecheck、Manifest/Operation/Docker/Podman/Runtime/Stage 0/Release聚焦回归、5文件Manager pack审计和完整Nuxt/Product build。Manager串行完整回归为23文件109项通过，另有1文件/2项按平台跳过；Windows Product归档成功写入44,998个文件条目。完整并行suite在Windows出现Git临时目录与5秒默认超时竞争，三个失败文件隔离重跑全部通过，属于既有并行测试抖动，不作为功能失败掩盖。
- 当前尚未发布新Manager或应用版本。`0.1.0-canary.19`代码与当前本地bundle已不同，因此未来Release前置公开Manager门禁会按设计失败，必须先提升并发布新Manager版本，不能复用`.19`。
- 与原计划差异：Apple Silicon Docker Desktop/rootless Podman双engine实机门禁由用户明确豁免本次合并阻断；该证据继续保留TODO且不能写成已验证。Linux ARM64与macOS原生runner门禁已在集成分支完成，结果见下条记录。
- 集成分支merge commit `a4ecec1be018adc8df313076564cc3b8b2d95de7`触发的[Product Platform Checks 29643196339](https://github.com/notnotype/neuro-book/actions/runs/29643196339)全绿：Linux ARM64 glibc 3分32秒、macOS ARM64 4分06秒、macOS x64 4分51秒。三个job均通过POSIX Stage 0、Manager平台合同、Nuxt build、Source archive、对应原生Product构建与native Product smoke；Linux ARM64额外通过Chromium smoke。
- 实际验收边界：本次runner结果关闭了原计划中的原生Linux ARM64/macOS Product合并门禁，但没有执行Apple Silicon上的Docker Desktop或rootless Podman machine，也没有产生公开npm、GHCR、Portable或最终Release索引。因此Task 105继续保持实现中，后续发布与双engine证据不被本次合并结果替代。

### 2026-07-19：发布入口、平台身份与托管资产系统性收口

- 新增Host Platform深Module，唯一Interface输出宿主OS、原生架构、当前Bun进程架构、ProductPlatform与libc。平台Schema继续保持宿主无关；真正运行实例时统一拒绝Windows ARM64、Linux musl、Rosetta和其他原生/进程架构不一致环境。Installation Product平台不匹配时，import/doctor报告`manifest.host` blocker，start/update/Runtime/Tool在加锁或创建Operation前直接失败。
- Doctor遇到不兼容实例后不会继续执行其managed Runtime或Tool，避免为了收集诊断而启动错误架构二进制；Manager bundle、Source/Product、State Root和Operation等安全的离线检查仍继续返回。
- 新增Managed Asset Repository深Module，负责受管归档下载、staging、解压、全部executable定位、checksum、执行位/真实版本验证和不可变版本目录原子提交。Bun、Stage 0 Bun、ripgrep与PortableGit只提供资产描述和版本验证Adapter；稳定wrapper仍由事务调用方在全部资产成功后统一刷新。
- 既有版本目录只有在当前有效Installation Manifest同时证明archive checksum、source URL及全部executable checksum时才可复用。Fresh Install、Portable组装或身份不完整目录会在新代次完成验证后切换；损坏Bun/rg/Git/Bash在事务提交前始终保留，不能读取当前文件checksum再把它写回Manifest完成“自认证”。
- 新增Install Preflight深Module。Clack、非交互`install --yes`和`install --dry-run --json`共用一次宿主、Git、Docker/Podman、Compose、daemon、端口、Installation Root身份、Release与组件来源检查；执行入口复用同一Release Manifest和Container Engine选择，拒绝过期或参数不匹配的报告。blocker不能被`--yes`绕过，dry-run保持零目录写入。
- Container Engine选择Interface同步加深：一次探测保留CLI版本、Compose版本与daemon/machine状态，`resolveContainerEngine()`只负责把结构化失败收敛为执行错误。Linux/macOS推荐策略因此能基于真实engine选择GHCR，无engine时推荐Product Bun；Windows保持Portable优先。
- POSIX Stage 0在任何下载前处理交互合同：无参数且能打开`/dev/tty`时把Manager stdin重新连接TTY进入Clack；无TTY时明确要求`sh -s -- --profile ... --yes`。Windows Stage 0改用原生OSArchitecture拒绝ARM64，缓存与首次解压均执行Bun executable checksum和版本门禁；`install.ps1`明确保存为UTF-8 BOM，保证`install.cmd`调用Windows PowerShell 5时能解析中文脚本，CMD继续透传退出码。
- Release首次Manifest v4门禁不再执行必然失败的`0.8.6 v3 → candidate v4 update`。新链路用`0.8.6`内嵌旧Manager创建管理员和数据标记，将候选Portable解压到新Installation Root，只替换完整`data/`，随后验证v4 Manifest、migration、登录、session、SQLite和无影子Workspace；旧`.deploy/.runtime/.output/wrapper`不会复制。
- 公开GHCR门禁拆为Linux x64 Docker、Linux ARM64 Docker与Linux x64 rootless Podman三个job，共用同一用户链脚本，覆盖公开精确npm Manager、候选Manifest、migration、非交互管理员、登录、stop/restart、running/stopped doctor和planned Operation真实恢复。容器`admin create`因此补齐共同支持的`compose exec -T -e AUTH_ADMIN_PASSWORD=...`路径，不再假定宿主环境变量自动进入容器。
- `publish-index`现在必须同时等待三条GHCR链和Windows完整`data/`复用。Canary A发布完成后需要删除一次性v3复用runner，并将Windows门禁切换为A→B Manifest v4事务更新；本轮尚未执行workflow或发布版本，不能把这些门禁写成公开通过。
- 最终审查发现初版Repository在可信同版本目录损坏时，会在新下载和验证前删除当前目录，重新引入Task 105早期已记录的事务缺陷。实现现改为不可变资产代次：默认目录被占用时提交到新代次，Operation Journal v2以可选`retiredPaths`记录提交后清理；失败回滚只删除`createdPaths`并保留旧代次。Windows运行文件占用导致的清理失败不会回滚已提交更新，journal会保留失败路径供下一次mutating command幂等重试。

#### 验证与计划差异

- Host/Preflight/Managed Asset/Container Admin聚焦5文件30项通过；Release workflow合同5项、Stage 0 Windows静态/Parser 8项通过，POSIX行为9项在Windows按平台跳过；GHCR与POSIX脚本`bash -n`通过。
- 最终Manager完整suite为26文件127项通过，另有1文件/2项按平台跳过；新增覆盖损坏旧代次保留、新代次提交、Journal记账失败清理、`retiredPaths`安全校验及提交后恢复清理。Manager pack审计为5个文件、约0.37 MiB；Manager与根typecheck、Nuxt build及Product后处理通过。
- 与原计划相比，新增修复了两个执行前审查才暴露的真实入口问题：Windows PowerShell 5对UTF-8无BOM中文脚本的解析失败，以及容器管理员非交互密码没有传入容器。两者均通过平台/容器共同Interface解决，没有为CI增加测试专用业务fallback。
- Manager `.21`已经公开；应用A推进到`0.8.9`。Windows公开Portable、Linux双架构公开GHCR与rootless Podman结果尚未确认。应用B的A→B事务更新和Apple Silicon Docker Desktop/rootless Podman设备验收仍保留未完成状态。

### 2026-07-19：Manager `.20` Linux发布门禁失败与跨平台夹具修复

- `manager-v0.1.0-canary.20`已创建提交与tag，但workflow `29690301774`在`Verify package`阶段失败，npm publish没有执行，因此`.20`不是可安装的公开版本。
- 生产Host Platform与Operation路径校验按设计拒绝错误宿主；失败来自测试夹具把可运行Product固定为`windows-x64`，并把Journal根固定为`C:/neuro-book`。这些夹具在Windows本地全绿，却在Linux runner被正确识别为跨平台Product和非POSIX绝对路径。
- 修复不放宽任何生产校验：需要运行实例的测试Manifest改用`currentProductPlatform()`，Journal/backup/SQLite/Compose/wrapper/migration路径改用当前操作系统的`tmpdir()`与`path.join()`。Release Product URL继续从平台资产映射生成。
- Windows Manager全量仍为28个文件通过、1个按平台跳过，141项通过、2项跳过。下一公开Manager版本改为`.21`；应用`0.8.7`的最低Manager版本同步提升为`.21`。
- `.21` workflow `29690567507`随后全绿并完成npm Trusted Publisher。registry精确版本、`canary` dist-tag和全新Bun cache的真实bunx均返回`.21`；历史`latest`继续保持`.4`。
- 应用发布预检继续发现本地Windows `Bun.build()`与npm中Linux Trusted Publisher bundle字节不同。差异来自依赖物理路径、平台条件与符号排序，不是源码漂移；要求不同宿主重新构建出相同bundle会让合法发布永久阻断。
- Release现把npm tarball作为Manager可执行bundle唯一发布来源：Portable直接安装公开`neuro-book.mjs`，assemble逐字节比较Portable与npm；公开schema再次解析候选Release Manifest。预检使用npm registry `gitHead`并比较Manager源码、Manager package/build脚本、共享`server/runtime`和`bun.lock`，有任何构建输入漂移都要求先发布新Manager；应用自身版本号变化不会伪装成Manager漂移。
- 应用`v0.8.7-canary.20260719.142942Z.9081e659` workflow `29690944232`在`verify-manager`立即失败，没有构建或上传资产。GitHub Actions默认checkout只有当前Release提交，npm provenance的`d42ab2fa...`不在浅克隆对象库中；生产校验本身没有失败。
- 预检现先执行按SHA、depth=1的只读fetch，再比较Manager构建输入。失败的`0.8.7`继续保留为审计记录，不复用tag；下一patch `0.8.8`承担Canary A。
- `v0.8.8-canary.20260719.143648Z.93ce3b3f` workflow `29691194281`的Manager provenance与Source通过，但Linux x64/ARM64和macOS x64/ARM64都在`Verify POSIX Stage 0 behavior`失败。共同失败是“缺少curl”测试未传参数，先命中了正确的非TTY拒绝；不是Stage 0下载或平台选择回归。
- 测试现显式传`--profile product-bun --yes`后再移除`curl`，精确验证依赖缺失发生在缓存/临时目录创建前。已取消`0.8.8`剩余构建，失败Release继续保留，下一patch `0.8.9`承担Canary A。
- `v0.8.9-canary.20260719.144929Z.399cb2f9`已创建并推送，workflow `29691602413`按`--no-watch`约定交由Actions后台执行。本轮只确认Release与workflow入口存在，不把未完成的Portable、GHCR或最终索引门禁写成已通过。

### 2026-07-19：`0.8.9` Windows Portable归档失败与Actions收口

- workflow `29691602413`的Windows Product本体已经构建完成，失败发生在随后`package:windows-portable`组装内置Managed Bun：Bun官方ZIP包含合法目录条目`bun-windows-x64/`，Archive Extraction Adapter把尾部斜杠直接传给`InstallationRelativePath`，严格路径Module因此把空segment正确拒绝。
- 修复保持路径核心合同不变：ZIP Adapter先识别目录身份并移除唯一的尾部分隔符，再执行相同的Installation Root containment。新增回归同时证明目录和文件能够解压，`../outside.txt`仍被拒绝；真实Bun `1.3.14` Windows ZIP已成功物化为`.runtime/bun/1.3.14/bun-windows-x64/bun.exe`。
- `build-and-push`在Windows失败后继续运行是Actions DAG语义，不是发布绕过：二者都是preflight后的并行兄弟job，没有`needs`关系；下游`assemble`仍同时依赖它们，因此Windows失败时最终索引不可能发布。本次已取消剩余run，避免ARM64 QEMU继续消耗资源。
- workflow新增统一Release preflight，把公开Manager provenance、Stage 0、Manager和Release资产合同放到昂贵fan-out之前。领域测试只在Linux执行一次，但macOS x64与Windows保留原生Adapter门禁，不能用Ubuntu模拟测试冒充平台证据。
- Windows依赖缓存绑定OS、架构、精确Bun版本和lockfile；命中后仍执行frozen install完成完整性收口。新prerelease会取消仍运行的旧prerelease，stable按tag隔离。
- 当前最大剩余耗时是amd64 runner通过QEMU重新编译ARM64 Nuxt Product：本次取消前超过18分钟，而原生ARM64 runner同类Nuxt build约94秒。后续优化应让Container Packaging Adapter直接消费原生Linux Product Artifact并只做OCI封装/manifest merge；本轮不仓促改变镜像字节来源和发布事务。
- 验证：Archive Adapter 2项、Manager完整29文件/143项（另1文件/2项按平台跳过）、Release资产/checksum 2文件/8项通过。下一发布顺序固定为Manager `.22`公开后再创建应用`0.8.10` patch canary；不复用失败tag，不等待应用Release workflow。
- 实际发布：Manager `.22` workflow `29693189437`全绿，npm精确版本、`canary`和真实bunx均返回`.22`；应用`v0.8.10-canary.20260719.153805Z.13c85b2c`随后创建，workflow `29693247437`按`--no-watch`约定在后台运行。本轮没有把尚未完成的Product/GHCR/最终索引门禁写成通过。

### 2026-07-22：Windows Portable 前台 Product 生命周期接入 Owned Process

- `runPortableForeground()`不再只持有一个直接ChildProcess；它通过`@notnotype/owned-process`启动Product，健康检查失败使用`startup-failure`终止完整Job，CMD/Manager宿主断连由监督IPC与`KILL_ON_JOB_CLOSE`收口全部后代。
- 健康检查前退出码0现在明确属于启动失败；健康前非零退出继续保留真实Product退出码，避免“服务从未就绪但Manager成功返回”的假成功。
- Manager仍拥有Installation/Profile/健康检查状态；Owned Process只提供本次前台invocation的OS进程树lease，没有扩展成跨Manager invocation的stop/restart协议。
- Manager package将私有workspace package作为build-time devDependency，Bun build把实现内联进公开单文件产物；pack审计通过，发布包没有私有production dependency。
- Windows Release在Product构建阶段运行Owned Process与Agent Bash smoke，候选zip阶段再用包内Bun + PortableGit运行自包含Owned Process smoke。Launcher参数转交单独验证；浏览器、鉴权和完整data复用链直接从候选Manifest启动实际Manager Runtime + 版本化bundle，只终止该Manager PID，随后要求IPC断连收口Product Job且端口在10秒内可重绑。这样门禁不再依赖外层CMD/wrapper或已否定的PID子树扫描。
- Manager本地验证为typecheck与pack审计通过；完整suite默认并行与串行均为153项通过、2项按平台跳过。真实Bun Stage 0大文件复制/校验在并行高I/O下曾超过30秒，测试预算调整为60秒后默认并行重跑通过；候选Release workflow仍待执行。

### 2026-07-20：`0.8.10`原生Manager门禁失败

- Windows失败于`process.test.ts`：真实PowerShell/Bun冷启动在并行runner负载下超过Vitest默认5秒。macOS x64失败于`instance-import.test.ts`：`runCapture()`监听`exit`后立即返回，而该事件不保证stdout已经关闭，短命令`bun --version`因此读到空字符串。
- 两者不是Portable归档修复回归。Linux preflight、Linux x64/ARM64 Product和macOS ARM64 Product均已通过；workflow在最终索引前被阻断并取消，剩余OCI构建也随之停止。
- 生产修复将捕获完成点改为`close`，保证stdout/stderr完整；测试基础设施统一20秒预算覆盖真实Git、PowerShell和子进程冷启动，job级硬超时继续负责识别真正挂死。
- 本地Manager typecheck通过，完整29文件/144项连续两轮通过（另1文件/2项按平台跳过），Release资产/checksum 8项通过。下一版本为Manager `.23`和应用`0.8.11`，不复用`.22/.10`的bundle或tag。

### 2026-07-20：`0.8.11`候选Product Agent smoke失败

- workflow `29694596325`的Release preflight、五平台Product、Windows Portable和多架构OCI均通过；Linux与Windows在执行同一个`product-agent-state-root-smoke.ts`时失败，后续最终索引按设计全部跳过。
- Task 104已要求Session只持久化`{providerConfigId, modelId}`。smoke仍返回没有`providerConfigId`的Faux Pi Model；初步补字段后，运行时又正确要求Effective Config中存在该Provider，移动后重复写Provider则触发`sourceIndex`身份门禁。
- 最终修复让smoke首次阶段通过正式Config Service写入最小Provider/Model配置，Faux runtime model携带相同本地ID；移动阶段复用随完整State Root一起移动的Config，不重建Provider。
- 同一脚本的源码入口和Nuxt Product `.output`副本均在隔离Application/State Root完成五工具、Attachment、State Root移动和旧Session恢复。Release preflight新增约5秒的同链门禁，避免再次在40分钟OCI后才发现Session合同漂移。
- 本地根typecheck、Session model 4项、Release合同8项、完整Nuxt/Product build通过。Manager bundle未变化，下一应用patch`0.8.12`继续使用公开`.23`。

### 2026-07-31：Manager `.31` clean-checkout Runtime 类型门禁失败

- `manager-v0.1.0-canary.31` 已保留 release commit 与 tag，但 workflow `30612238085` 在 `Verify package` 阶段失败，npm publish 未执行，因此 `.31` 不是公开可安装版本。
- 干净检出稳定复现 `server/generated/prisma/client` 缺失：`runtime:typecheck` 依赖被 `.gitignore` 排除的既有 Prisma client，本地 release 被工作区残留生成物掩盖。GitHub Linux runner 还暴露 `mdast` 类型缺失；根源码直接导入 `mdast`，却只通过 Markdown utility 的传递依赖和本机偶然 hoist 获得 `@types/mdast`。
- 修复没有给 workflow 增加特例：共享 `runtime:typecheck` 先执行 canonical `bun run generate` 再运行独立 tsconfig，保证本地 helper、GitHub workflow和其它调用方使用相同准备合同；Prisma 输出父目录新增不继承 Nuxt 的专用 tsconfig，避免生成器在 clean checkout 解析不存在的 `.nuxt/tsconfig.json`。根 package 直接持有 `@types/mdast@4.0.4`，不改 Runtime tsconfig types、不切 hoisted linker、不增加 ambient 声明。
- 新增 Manager release clean-checkout 合同测试，固定 Prisma 自准备、生成目录 tsconfig 与类型依赖所有权，并并入 `manager:test`，保证本地打 tag 和 GitHub workflow 都会执行。隔离 clone 在修复前先稳定得到三处 Prisma TS2307，串接生成后又暴露缺少 `.nuxt/tsconfig.json`；最终从 `generated-before=False` 开始完整生成 App/Project 两套 client 并通过 Runtime typecheck。合同测试先红后绿。
- `.32` workflow `30613276952` 已证明 Prisma generate、Runtime typecheck 与 Manager typecheck 在 Ubuntu clean checkout 通过，但 Manager Vitest 有 21 个 suite 在 transform 阶段失败：Manager 新增的 Product Runtime Image 集成直接导入 `scripts/**` 和 `shared/**`，Vite/OXC 再次回退到根 Nuxt tsconfig，并因 `.nuxt/tsconfig.json` 不存在而拒绝转换。
- 修复继续保持边界显式：`scripts/tsconfig.json` 与 `shared/tsconfig.json` 提供不继承 Nuxt 的源码编译配置，现有 `server/runtime/tsconfig.json` 继续覆盖 Runtime 边界；不为 Manager tests 执行完整 `nuxt prepare`。无 `.nuxt` 的隔离 clone 修复前稳定复现 21 failed / 12 passed / 1 skipped，加入两份边界配置后恢复 211 passed / 2 skipped。
- `.33` workflow `30613898542` 已通过全部 clean-checkout 生成、类型与转换门禁；最终仅 `app-commands.test.ts` 的 6 个真实运行测试失败。共同原因是该文件新建的 `productManifest()` 把平台固定为 `windows-x64`，Linux runner 按生产合同正确拒绝跨平台启动；其余 205 项通过，另 4 项按平台跳过。
- 只修改测试夹具：需要真实启动 Product 的 manifest 使用 `currentProductPlatform()`，专门验证平台映射/拒绝语义的固定平台夹具保持不变。生产 `assertInstallationHostCompatible()` 没有放宽。
- `.31`、`.32` 与 `.33` tag 都不移动、不删除、不复用；下一公开候选固定为 `0.1.0-canary.34`，npm 精确版本和 provenance 验证通过前不启动应用 minor release。

### 2026-08-02：Manager `.34` clean-checkout shared tsconfig 门禁失败

- `manager-v0.1.0-canary.34` 已保留 release commit 与 tag；workflow `30719955828` 在 `Verify package` 阶段以 `TSCONFIG_ERROR` 失败，npm publish 未执行，因此 `.34` 不是公开可安装版本。
- 根因是新抽出的 `shared/product-runtime-image-verifier.ts` 没有进入 `shared/tsconfig.json` 的显式 `include`。Windows本地现有Nuxt开发状态掩盖了缺口，Ubuntu clean checkout的Vite/OXC按独立shared边界正确拒绝转换。
- 修复把Verifier加入shared tsconfig，并扩展Manager release clean-checkout合同测试，确保后续共享Product执行依赖必须登记在独立编译边界。Manager全量回归随之增加为239 passed / 2 skipped。
- `.31`至`.34` tag都不移动、不删除、不复用；下一公开候选固定为`0.1.0-canary.35`。只有npm精确版本、provenance、tarball、真实全新缓存`bunx`与公开验证全部通过后，才继续应用minor release。

### 2026-08-02：Manager `.35` clean-checkout Runtime Image fixture 门禁失败

- `manager-v0.1.0-canary.35` 已保留release commit与tag；workflow `30720239948` 在`Verify package`阶段运行Manager测试时失败，npm publish仍未执行。
- 根因是Runtime Image测试fixture按`currentProductPlatform()`调用生产Builder。Windows已有canonical owner policy所以本地239项全绿；Ubuntu正确映射为`linux-x64-glibc`，而该平台尚未完成真实A/B测量和人工登记，生产Builder按设计拒绝构造镜像。不能用Windows数字伪造Linux正式baseline，也不能给Verifier增加测试后门。
- 修复按测试真实依赖拆分：与宿主无关的Verifier、归档下载和执行句柄测试固定使用已审查的`windows-x64` fixture；只有必须表达“当前宿主可运行原生Product”的安装健康、离线导入与Source Product build测试，才根据canonical policy登记状态决定是否运行。Linux/macOS未来登记正式policy后会自动启用，不需再改测试。
- Windows受影响6 files / 18 tests、Manager全量239 passed / 2 skipped、typecheck与release contract均通过。`.31`至`.35` tag继续保留且不复用；下一公开候选固定为`0.1.0-canary.36`。

### 2026-08-02：Manager `.36` clean-checkout contract 隔离失败

- `manager-v0.1.0-canary.36` 已保留release commit与tag；workflow `30720535140` 中Manager本体已通过32 files / 5 skipped files、224 passed / 17 skipped，证明未登记Linux policy不再导致fixture失败。npm publish仍未执行。
- 随后的单条release contract错误复用了根`vitest.config.ts`。即使只过滤`manager-release-contract.test.ts`，Vitest仍先加载Agent global setup；clean checkout没有`.nuxt/tsconfig.json`，因此在`server/agent/test/global-setup.ts`转换阶段失败。本地Developer Build State再次掩盖了这个隐式前置。
- 修复为该单条合同新增最小独立Vitest配置，不加载Nuxt、Agent setup或system assets snapshot；配置自身进入`scripts/tsconfig.json`，合同同时固定package命令和tsconfig登记。不是在workflow中补`nuxt prepare`，因此Manager发布仍只消费自己的真实前置。
- Windows Manager全量239 passed / 2 skipped、独立release contract 1/1、Manager与scripts独立typecheck通过。`.31`至`.36` tag继续保留且不复用；下一公开候选固定为`0.1.0-canary.37`。

### 2026-08-02：Manager `.37` clean-checkout contract tsconfig 归属失败

- `manager-v0.1.0-canary.37` 已保留release commit与tag；workflow `30720704794` 中Manager本体再次通过224 passed / 17 skipped，独立Vitest配置也已生效。npm publish仍未执行。
- OXC随后只拒绝`manager-release-contract.test.ts`本身：上一轮把独立Vitest配置加入了`scripts/tsconfig.json`，但漏掉实际被转换的合同测试文件。Windows仍从Developer Build State找到根Nuxt tsconfig，clean Linux按独立边界正确失败。
- 修复把合同测试与其Vitest配置同时纳入scripts TypeScript project，并由合同固定两个include。scripts独立typecheck、Windows Manager 239 passed / 2 skipped和release contract 1/1通过。`.31`至`.37` tag继续保留且不复用；下一公开候选固定为`0.1.0-canary.38`。

### 2026-08-02：Installation Mutation 与可恢复卸载收口

- 所有写操作统一经外置 heartbeat lease、Operation 恢复和锁内 Manifest 重读；调用前 Manifest 只用于定位，不能复活已删除或已变更的实例。Windows Installed v1 固定为用户级唯一程序根，Portable/Source 以 canonical Installation Root 摘要隔离 lease。
- update journal 增加 migration `applying` checkpoint、operation-owned migration root、Product 双 rename 恢复和 cleanup retry。卸载自身不再接受任意 stop callback；Windows 受管 Bun 由 Installation Root 外的 Host 按摘要锁定 intent，等待 Manager 退出后删除精确 owner。
- 原生卸载和 Desktop reset 不要求损坏的 Product payload 仍能通过执行验证，只要求严格 Manifest/owner 布局和服务停止；容器删除仍先验证 Compose 与 OCI identity。回归证明 Product payload 损坏时仍可卸载，运行、迁移与管理员命令的 fail-closed 门禁不变。

### 2026-08-02：Manager `.38` 公开与 Portable 自卸载调度补漏

- `@notnotype/neuro-book-manager@0.1.0-canary.38` 已由 workflow `30720825090` 成功公开；npm `gitHead=060f719c6b1f21965642ab90363f75d7f08f7c9c`，tarball shasum 为 `0d60bb060a47677f6d1b35f1bc464cd6b44b1857`，签名、provenance、全新 Bun cache 的真实 `bunx` 与 `manager:verify-public` 均通过。`.34` 至 `.37` 继续保留为未发布失败审计记录。
- clean Source/Product 归档组装首次暴露 PortableGit SFX 长路径失败：相同 `2.55.0.windows.3` 资产与 SHA-256 在 30 字符输出根成功，在 248 字符输出根退出 1；`\\?\` 仍返回失败，junction 又会跳过 post-install，均不能作为修复。Portable 组装 operation 改到 OS 临时目录下的短根，并在任何下载前验证 170 字符 SFX 输出预算；真实 16,322-entry Portable ZIP 已成功生成。
- `.38` Portable 的 doctor、完整 Product Runtime Contract、Owned Process、Manager 管理员创建、前台启动、HTTP 登录均通过；但默认自卸载实测只写入 intent 和“已安排”提示，30 秒后程序仍在。最小夹具确认 Bun 1.3.14 的 `spawn(..., detached: true).unref()` Host 不会实际运行，现有测试只同步执行 PowerShell 脚本，因此漏掉了真实调度边界。
- 修复保留原 SHA-256 intent 与外置 Host，不增加第二套事务：Manager 同步等待一个短命 PowerShell launcher 通过 `Start-Process` 创建 Host，所有路径经私有环境 JSON 传递，Host 仍等待 Manager PID 退出后执行精确删除。新增真实调度测试先红后绿；Windows Manager 全量现为 240 passed / 2 skipped，pack 5 files / 0.42 MiB，Manager/scripts typecheck 与发行合同通过。因为公开 `.38` 不含该修复，下一公开候选必须是 `.39`，不能把 `.38` 写进最终 0.9 Candidate。
- `manager-v0.1.0-canary.39` 已由 workflow `30722599876` 全绿并公开。npm `gitHead=143fafea7fb51ef26dbbab4e25fe7e8224cd9c9e`，公开 tarball shasum 为 `92c522f63e63faee5aa88e25e0ada873dd7c0273`；38 个包签名、2 个 provenance attestation、全新 Bun cache 的真实 `bunx` 与 `manager:verify-public` 均通过。最终0.9 Candidate只能消费`.39`或后续版本，不能沿用`.38`归档；对应clean Portable终验见下一节。

### 2026-08-02：Manager `.39` clean Portable终验

- clean提交`0a3cc7fd84f52b1b5478745053a20cfbf0171a25`生成统一build ID `sha256:1d6ad6cfd7687132156b91bad64067530f3c53a52a8cb2a72a344b1622ed641c`。新Portable为16,322 entries / 297,242,174 bytes，SHA-256 `76F52EF5AE0026EE1091F8C433F6D0EA61909DDECBA4B89EFB2884FD3760BA9C`，包内Manager明确为`0.1.0-canary.39`。
- 仓库外验收通过31项doctor、Portable Bun/rg/Git/Bash真实版本、Owned Process、完整Product Contract、管理员创建、前台启动、HTTP版本与登录cookie，且未生成Installation Root影子`workspace/`。
- 默认卸载的外置Host写入`ok: true` durable result，程序、Source、Runtime、cache和logs全部删除后安装根只剩`data/`，测试数据仍在；全量卸载的独立新解压实例同样写入成功result并删除整个Installation Root。验收同时发现Candidate workflow只等待`.output`消失会过早结束，现改为等待Host结果并检查完整终态。
- 本地没有五平台资产、GHCR digest或Candidate `release-manifest.json`，因此没有伪造最终Portable Verifier结果；公开A→B、跨Profile、真实Docker/rootless Podman和最终索引仍由0.9 Candidate Actions负责。
- 第一次0.9发布命令已推送版本提交并创建Draft release ID `363661503`，但Coordinator在`gh release create`返回后立即查询列表，撞到GitHub短暂最终一致性窗口并误报`count=0`，因此没有dispatch workflow。该Draft保留为失败候选审计，不删除、不复用；Coordinator现只对零匹配执行12次、每次1秒的有界发现重试，多匹配或identity漂移仍立即fail closed。
