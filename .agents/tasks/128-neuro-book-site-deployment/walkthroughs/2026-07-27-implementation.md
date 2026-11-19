# Task 128 实施记录（2026-07-27）

## 当前状态

正在执行 Phase 4 客户端确认。DNS、证书和 Nginx stream 443 已接入，站点与现有 TLS 代理服务端探测通过；80 根路径仍保持 404，等待用户确认全部既有 TLS 代理客户端后再启用 HTTPS 跳转。

## 批次 1：合同、改名与依赖基线

- sibling 目录已从 `nb-workshop` 硬切为 `neuro-book-site`。
- 官方站 package、meta platform、主题 storage key、页面品牌与活动文档已同步改名。
- Passport / Backup wire spec 已硬切到 `keyId`、密文 sha256、`.nbbackup` 和 `application/vnd.neurobook.backup`。
- `@notnotype/nb-ui` 已固定到公开 commit `e57c6b6a303a9cd981d761d089ccf7dfcafb1cba`；`bun install` 已重建 lockfile，不再依赖 Bun link。

## 批次 2：NeuroBook 加密与密钥生命周期

- Runtime Paths 新增 `secretsRoot` 与 `backupKeyringPath`。
- keyring 使用 `pending / active / historical` 三态、同目录临时文件原子替换、目录 `0700` 与文件 `0600`；不提供历史密钥删除。
- 恢复码固定为 `NBK1-<43 字符 base64url>-<8 字符 checksum>`；`keyId` 取 SHA-256 前 8 字节。
- 归档格式硬切 v2，压缩输出直接进入 AES-256-GCM，不再落完整明文 zip；`secrets/` 不进入归档。
- SQLite `VACUUM INTO` 失败时整次备份终止，不再退化为原文件拷贝。
- 恢复先下载并校验密文 sha256，再第一遍完整验证 GCM，验证成功后第二遍流式解密解包；staging 写入本次恢复密钥。
- 应用日志与任务错误的敏感字段规则已覆盖 `recoveryCode`、`backupKey`、keyring 和裸 `NBK1` 恢复码。

## 批次 3：恢复码前端闭环

- 新增独立恢复码 Dialog；完整恢复码不进入备份列表、任务状态或全局通知。
- 第一次备份必须先准备 pending key。复制或下载至少一项成功后，用户才能勾选“已保存在本实例之外”，两项同时满足才可确认并上传。
- 取消 Dialog 不确认、不上传；服务端保留同一 pending key，下一次打开复用。
- 缺少备份 `keyId` 时先导入恢复码；导入后仍要求用户再次确认恢复。
- 设置页显示 active / historical / pending keyId，支持主动轮换，以及本地鉴权启用时经当前账号密码复验重新导出。

## 验证

- `bun run test -- ...`：加密、keyring、归档、恢复、Runtime Paths、日志脱敏与前端合同共 7 个文件、30 项测试通过。
- 两次 `bun run typecheck` 均未发现 Task 128 新增类型错误；全量命令仍失败于已有 `server/agent/skills/llmlint.test.ts` 夹具缺少 `ignoreTerms` 及一个旧 source 类型断言。本任务未修改该无关在途链路。
- 按项目约束未自动执行浏览器验证。

## 与计划的出入

- 无密码学合同降级。
- 前端行为验证沿仓库既有 Node-only Vitest 方式使用源码合同测试；真实浏览器交互仍留在用户授权后的验收阶段。

## 批次 4：公开仓库、GHCR 与生产主机上的 loopback

- sibling 仓已硬切为 `neuro-book-site`，公开仓库为 `https://github.com/notnotype/neuro-book-site`，无 LICENSE；GHCR 匿名拉取 SHA tag 成功。
- Run `30248630556`（提交 `57711d2`）和 Run `30253386014`（提交 `7966bf1`）的 verify/container 均成功；生产主机匿名拉取两个 digest 均成功。
- 生产主机已安装 Docker 与 Compose；`/srv/neuro-book-site` 使用 UID/GID `10001` 数据目录 `0700`、root-only `.env` `0600`，Compose 只发布 `127.0.0.1:3100`。
- 空卷 migration/ready、stdin 管理员初始化、Secure Cookie、owner-only 注册/OAuth 门禁、Workshop ZIP、`.nbbackup` 上传下载、容器强制重建和主机重启后的摘要持久性均通过。
- 生产主机主机重启后 Docker、Nginx、现有 TLS 代理均 active；同盘冷快照满足“数据体积 + 4 GiB”门禁，整体恢复后数据库摘要、文件数和 readiness 一致。
- 实际演练新 digest → 旧 digest → 新 digest，三次均 readiness 通过且数据库/文件摘要一致；最终保持新 digest。生产主机整盘损坏仍会同时丢失站点数据和同盘快照，这是已锁定的私有内测风险。

## 批次 5：DNS 前置与 443 runbook

- 已备份 `/etc/nginx`、`现有 TLS 代理配置目录` 和现有 TLS 代理 systemd unit 到 `/srv/neuro-book-site/ops/backups/task128-20260727T092738Z/`，并保存 root-only `.env` 镜像回滚副本。
- Nginx 80 端口已添加 ACME webroot vhost；challenge 回读通过，根路径保持 404。现有生产主机 443 用本机 TLS 1.3 握手验证通过，现有 TLS 代理配置和 443 归属未改。
- sibling 仓新增 `docs/https-443-runbook.md`，记录 DNS、ACME、非 443 SNI/PROXY protocol 预演、上传限制、443 dry run、配置备份和原 TLS 代理 443 回滚命令。
- DNS 服务商 当前没有登录态，浏览器停在登录页；本机没有 DNS 服务商/Tencent CLI 或现成 API 授权。因此 `nbook.notnotype.com A <公网 IP> TTL 300`、证书签发、非 443 TLS 预演和 443 切换保持 pending，未绕过登录门禁。

## 当前验证结论

- 代码与容器生产化、生产主机内部部署和本机回滚证据已完成；`DEFAULT_PASSPORT_SITE_URL` 尚未改，NeuroBook canary 尚未发布。
- 按项目约束未自动执行浏览器产品验收；真实设备码关联、Bearer Workshop、首次恢复码保存、密文恢复和 staging 恢复仍等 HTTPS 稳定后并经用户授权执行。

## 批次 6：DNS、证书、443 与管理员密码恢复工具

- `nbook.notnotype.com` 已解析到 `<公网 IP>`；Let's Encrypt 证书已签发并安装，证书续期 timer 已启用。
- 非 443 预演验证了站点 SNI、现有 TLS 代理默认 SNI、PROXY protocol、Secure Cookie、可信代理、上传边界与私有模式门禁。
- 443 维护窗口备份位于 `/srv/neuro-book-site/ops/backups/task128-cutover-20260727T105410Z/`。首次切换因现有 TLS 代理重启后的监听检查过早触发自动回滚；确认是启动时序竞态后改为有界等待，第二次切换成功。
- 当前公网 443 由 Nginx stream 独占：`nbook.notnotype.com` 转发到 `127.0.0.1:<站点端口>`，默认 SNI 转发到现有 TLS 代理 `127.0.0.1:<代理端口>`。公网 live/ready、两个域名 TLS、未知 SNI、真实客户端 IP、注册 403 与 OAuth 404 均通过。
- 切换后现有 TLS 代理日志已观察到TLS 代理入口与 VLESS TCP 流量经新入口成功，但按维护合同仍等待用户逐一确认既有客户端；确认前不启用 80 → HTTPS 跳转。
- 新增 `bun run db:admin -- create|reset`：显式区分新建与重置，密码只从 stdin 读取。reset 仅接受现有 admin，递增 `sessionVersion` 注销旧会话，不会隐式覆盖、提升或启用账号。
- 生产构建新增 `/app/dist/admin-password.mjs`，生产主机可通过 `docker compose exec -T site node /app/dist/admin-password.mjs reset` 执行，无需在宿主安装 Bun。
- 站点提交 `402dc08` 的 Actions Run `30261576764` 完成 typecheck、全量 build/test 和 `linux/amd64` 容器发布；生产主机匿名拉取固定 digest `sha256:8f4dcd22aba78185636f0902c6cdd0bd28080729a50ef5712a2e5ba88fbb7214`。
- 升级前冷快照为 `/srv/neuro-book-site/snapshot-task128-admin-cli-20260727T112640Z.tar`，旧配置为 `/srv/neuro-book-site/.env.task128-before-admin-cli-20260727T112640Z`。新容器 healthy，内部/公网 readiness、工具存在性、443 监听和现有 TLS 代理 TLS 均通过；管理员密码尚未重置，等待用户明确执行。

### 验证

- `tests/admin-password-cli.integration.test.ts`：1 项通过，使用真实 migration/SQLite 覆盖创建、拒绝覆盖、重置、旧密码失效、会话失效、短密码、缺失账号与普通账号保护。
- `tests/production-gates.integration.test.ts`：5 项通过，实际使用 Node 执行编译后的 reset 工具，再以新密码完成生产登录与 Secure Cookie 验证。
- `bun run build:runtime-tools`：通过，生成 `admin-password.mjs` 及原有两个运维产物。

### 与计划的出入

- 原计划只要求 stdin 管理员初始化，没有定义遗失密码后的正式恢复入口。实际部署发现一次性初始化密码不可查询，因此补充显式、可审计的 create/reset 工具，避免在生产中使用临时 SQL 或把密码放入 argv/env。

## 批次 7：注册码与邀请码能力（未开放生产注册）

- 管理员注册准入凭据硬切为 `RegistrationCode`：支持不限次数、有限次数、过期时间、备注和停用/启用；旧一次性邀请码迁为不限次数注册码并保留已有注册归属。
- 新建用户所有的 `InviteCode`：仅记录可选邀请归属，不能绕过注册码；普通用户只能创建和修改自己的邀请码。
- 密码注册与 OAuth 补全注册共用原子消费服务。注册码必填、邀请码可选，两类码与用户创建在同一事务内提交；有限次数用 CAS 防并发穿透，上限修改也使用条件更新避免与注册竞态。
- `/register` 支持 `registrationCode` 与 `inviteCode` 两个 query 参数；管理员可复制注册码注册链接，用户可复制邀请码链接并选择附带注册码。
- 生产私有模式没有改变：注册与 GitHub OAuth 仍由服务端关闭，Public Invite Gate 仍未通过，本批次不会让公网出现新注册入口。

### 验证

- `bun run typecheck`、`bun run build` 通过；新构建产物上的全量测试为 15 个文件、123 项全绿。
- 聚焦测试覆盖迁移、DTO、注册码不限次数复用、单次码并发门禁、过期/停用、上限下调拒绝、用户邀请码归属/越权及生产门禁。
- 独立旧库迁移演练确认：已使用/未使用旧码迁为 `usedCount=1/0` 的不限次数注册码，已有用户归属保留，新邀请码表为空。
- 按项目约束未自动执行浏览器验收。

### 生产部署

- 站点提交 `bed9eac` 的 Actions Run `30265489713` 中 verify/container 均成功；生产主机匿名拉取 SHA tag 后取得固定 digest `sha256:77f922014080e810e9852dc49ef0e71c40ed755eb8b817a934b76e6c2d394c19`。
- 升级前数据 196937 字节、可用空间 10219343872 字节，通过“数据 + 4 GiB”门禁。冷快照为 `/srv/neuro-book-site/snapshot-task128-access-codes-20260727T122751Z.tar`，SHA-256 `8080a836e5da0765edbd5a9ceb3a76fe9699edf23c4ad655c1547162385d351e`，权限 `0600`；旧配置备份为同目录 `.env.task128-before-access-codes-20260727T122751Z`。
- 生产旧库有 100 个未使用管理员邀请码。migration 后为 100 个不限次数注册码、总使用次数 0；新邀请码表为空，用户归属为空，`PRAGMA foreign_key_check` 无错误。
- 新容器 healthy；loopback/公网 readiness 全部 ok，公网注册 403、OAuth 404，Nginx/现有 TLS 代理/Docker active，`nbook.notnotype.com` 与 `<生产主机域名>` TLS 1.3 验证通过；HTTP 80 根路径继续保持 404。
- 验收时一条 `docker inspect --format` 引号错误导致容器环境被写入执行日志，其中包含 Session secret。随即在生产主机重新生成 48 字节随机 secret，并同步更新当前与回滚配置后强制重建容器；旧会话因此全部失效，管理员密码未改变。后续验证不再读取容器环境。

## 批次 8：Pino 日志与 Passport 网络错误治理

### 官方站实现

- 使用 `pino@10.3.1` 建立单例日志器；固定 ISO time、字符串 level、`service=neuro-book-site`，同一 JSONL 同时写 stdout 与 `NB_LOG_FILE`。
- 最早加载的 Nitro 插件为每个请求生成 UUID `requestId`，响应写 `X-Request-ID`。response `finish` 是唯一完成日志出口，Nitro error hook 另写诊断事件；成功 live/ready 不写 info。
- 请求只记录 method、脱敏 path、statusCode、durationMs 和可信 clientIp。动态设备码路径段、URL query、敏感键及错误自由文本经过分层清理，不读取 header 或 body。
- 生产启动拒绝非法 `NB_LOG_LEVEL`、缺失/相对 `NB_LOG_FILE` 和不可写日志路径；文件预创建并收紧为 `0600`。运行中文件 destination 报错后停止写该流，stdout 继续工作，stderr 告警每分钟最多一次。
- Compose 增加 `./logs:/logs`，仍保留 Docker `json-file` 10 MiB x 3。仓库增加 20 MiB x 14、压缩、`copytruncate` 的 logrotate 配置及小时级 systemd timer。

### NeuroBook 实现

- 新增固定官网 transport，设备码、token、吊销和 Backup 的 list/upload/meta/download/delete 全部经此出口。控制面与下载响应头使用 10 秒门限，下载 body 取得后不中断。
- 网络、DNS、连接、TLS 或超时统一转换为 `502 passport_site_unreachable`；上游 5xx 转换为 `502 passport_site_unavailable`；有响应的 OAuth/配额 4xx 保持原语义。
- 失败事件写入既有 App JSONL 日志 `passport.officialSite.requestFailed`，只有 operation、endpoint、failure、causeCode、upstreamStatus 和 durationMs。请求参数、token、body 和完整异常不进入该事件。
- 文档补充 Node 24 环境代理合同：`NODE_USE_ENV_PROXY=1`、`HTTPS_PROXY`、`NO_PROXY=localhost,127.0.0.1,::1` 必须在进程启动前设置，修改后重启 NeuroBook；不增加硬编码 IP、DoH fallback 或全局 dispatcher。

### 本地验证

- 官方站 `bun run typecheck`、`bun run build` 通过；全量为 16 个测试文件、131 项通过。
- 真实 Nitro 生产集成测试通过，覆盖 requestId、stdout/持久 JSONL、404、请求解析异常、query/header/body 敏感信息、私有模式和 fail-closed。Pino destination 接入 Nitro close 后测试进程由约 40 秒降到 4.43 秒退出。
- NeuroBook 聚焦测试为 4 个文件、25 项通过，覆盖 ENOTFOUND、ECONNREFUSED、TLS、超时、上游 5xx、业务 4xx、unlink best-effort、流式下载和全部调用点统一 transport。
- NeuroBook 全仓 typecheck 被当前工作区其他任务的 `workspaceKey/workspaceRoot` 与 llmlint 类型迁移错误阻断，本轮 Passport/Backup 文件未出现在错误列表；未修改这些无关在途改动。
- 本机没有 Docker CLI，未在 Windows 本机重复执行 `linux/amd64` 构建；该门禁由 GitHub Actions 和生产主机实机承接。按项目约束未自动执行浏览器验证。

### 与计划的出入

- 大文件备份上传不使用 `$fetch` 的 10 秒整请求 timeout。该参数不是连接专用门限，若强行统一会让大文件上传必然失败；控制面和下载取得响应头前仍使用 10 秒。
- 第一次 Actions Run `30284673653` 在 Linux 测试失败：有效配置夹具误用 Windows 专用 `C:/logs/site.jsonl`，Linux 正确判定它不是绝对路径。生产实现未变，夹具改为容器真实路径 `/logs/site.jsonl` 后，提交 `bcfe047` 的 Run `30284828626` 完整通过。

### 生产发布与验收

- Actions Run `30284828626` 完成 frozen install、typecheck、build、131 项测试和 `linux/amd64` 容器发布。生产主机匿名拉取 SHA tag，固定 digest 为 `sha256:6ec29b03a086920e9259f18a4ed8403b7c188002c8d57d1f037a7fbad118c726`。
- 升级前数据 237897 字节、可用空间 10201931776 字节，通过“数据 + 4 GiB”门禁。冷快照 `/srv/neuro-book-site/snapshot-task128-pino-20260727T163249Z.tar` 权限 `0600`，SHA-256 为 `d12907d211a6ab3bf16acd55bc0c7916f185a57a0692ad107ad7dda8128dfc6f`。
- `/srv/neuro-book-site/logs` 为 `0700`、UID/GID `10001`；`site.jsonl` 为 `0600`。logrotate dry run 通过，小时级 timer active；两次强制轮转后 `site.jsonl.2.gz` 通过 `gzip --test` 并可检索旧 requestId。
- 公网 `POST /api/v1/passport/device/code` 返回 200，requestId `adfb880a-ca14-4b5a-b5a5-d4a170a1f554` 同时出现在 `docker compose logs` 与持久 JSONL。合成 query、Authorization 和 Cookie 敏感值扫描为 CLEAN；成功 ready 健康检查记录数为 0。
- 本机 Node `v24.13.0` 未启用环境代理时请求官网复现 `UND_ERR_CONNECT_TIMEOUT`；只在子进程设置 `NODE_USE_ENV_PROXY=1` 与本地 `NO_PROXY` 后，health 和设备码 POST 均返回 200。设备码 requestId `a079b651-aad9-4687-a115-cb62ada2a3f6` 再次完成 stdout/文件对账，证明最初关联故障需要重启 NeuroBook 并让 Node 使用现有代理环境。
- 强制重建容器后旧 requestId 仍在日志卷。随后实际执行新 digest → 旧 digest `77f922...` → 新 digest，三次均 healthy，日志卷和压缩文件未删除；最终保持新 digest。
- 最终 loopback/公网 readiness 正常，注册仍为 403、OAuth 仍为 404，容器 UID/GID `10001`、只读根和 768 MiB 上限未变；Docker、Nginx、现有 TLS 代理与 logrotate timer 均 active。本轮没有修改 DNS、443、Nginx SNI 或现有 TLS 代理。

## 批次 9：Passport 凭据提交补偿与统一迁移门禁（2026-07-28）

### Passport 服务端

- `PassportLinkPollDto` 新增 `credential_persist_failed` 与 `exchange_invalid` 终态。设备码仍保持一次性消费，不引入 grant 重放或跨进程明文 token 暂存。
- 首次兑换成功后先写 App SQLite，成功才返回 `linked` 并更新 access-token cache。upsert 失败会删除内存会话、用新 refresh token best-effort revoke，并只返回远端清理结果 `revoked | unknown`。
- refresh 轮换采用相同提交顺序。新 refresh token 落库失败后吊销新 token、删除旧凭据、清空 cache，并用进程内闩锁阻止旧 token 重放；调用面统一回到 `PassportUnlinkedError`。
- `invalid_grant` 会终止当前关联会话并返回 `exchange_invalid`。日志只保留阶段、账号 ID、清理结果和脱敏错误；`deviceCode`、grant、token、Cookie 与 Authorization 均不得进入日志。

### 前端关联状态机

- 新增 `usePassportLink` composable，统一拥有设备码计时、轮询、终态和清理。Profile 面板只消费状态与命令。
- 只有 `pending` 自动安排下一次轮询。网络或未知 HTTP 错误进入 `retryable_error`，保留设备码但停止静默重试，用户可“重新检查”或“重新发起”。
- 404 会先读取本地 `/api/passport/status`：凭据已保存则恢复成功，否则显示已失效。`credential_persist_failed` 会提示“官网已批准，但本机未能保存授权”；远端清理为 `unknown` 时提供官网 `/me?tab=instances` 入口。
- 中英文文案已同步；界面与通知不显示 Prisma 错误或任何 token。

### Application State 统一门禁

- Task 118 在途工作已经建立 Application State catalog / runner，本轮把 App SQLite 纳入 catalog version 2，顺序为 `app-sqlite → agent-attachment-v1 → agent-session-v2`。没有新增 Passport 专用 migration registry，也没有继续扩展 Attachment 特例。
- App SQLite plan 只读 migration 目录和 `_prisma_migrations`；数据库不存在时只报告 pending。apply 用 `bun:sqlite` 或 Node 24 的 `node:sqlite`，每条 SQL 与 migration 记录同事务提交；旧 `sqlite-migrate.mjs` 委托该实现。
- Manager install/update/start 在候选 Product 启动前统一 plan。App SQLite 有 pending 时，先将 `sqlite-backup` planned effect 写入 Operation Journal，完成 WAL checkpoint/copy 后标记 applied，最后执行 Product migration；容器 Profile 通过一次性容器运行。
- `bun run dev` 前置 `migration:check`；Product launcher 和 Nitro 最早插件再次只读检查，阻止绕过 package script。无 pending 时不会写 App SQLite、创建备份或更新 migration 记录。

### 验证

- Passport、composable、日志脱敏与迁移门禁聚焦批次共 32 项通过；App SQLite 旧库与统一 runner 8 项通过；Manager 迁移聚焦 17 项通过。
- Manager 完整 suite 为 164 项通过、2 项按平台跳过，Manager typecheck 通过。
- `bun run nuxt:build`、Product runtime vendor 与产物断言通过，门禁代码已进入 `.output`。
- 旧 App SQLite 隔离夹具只应用到 `20260722012218_passport_and_backup`，保留 `siteBaseUrl NOT NULL`；只读 gate 准确列出 `20260727210000_fix_official_passport_origin`。apply 后地址列删除、migration 记录完成，再次 check 不改变数据库 size、mtime 或目录内容。
- 根仓完整 typecheck 仍有 26 项既有错误，全部位于 `server/agent/skills/llmlint.test.ts`；本轮文件没有新增类型错误。
- 真实工作区执行只读 `bun run migration:check` 显示 App SQLite 无 pending，但 Application State sentinel 仍为 catalog 1。本轮没有执行 `bun run migrate:application-state -- --apply`，避免未经明确操作改写真实用户数据。

### 与计划的出入

- 原计划是等待 Task 118 runner interface 落地后接线；实施时统一 Module 已由在途改动建立，本轮直接扩充其 catalog 和 Product interface，没有产生第二套 runner、journal 或恢复顺序。
- 为覆盖用户直接运行 `.output/server/index.mjs` 的路径，启动门禁比 package script 前置检查多了一层 Nitro 复核。这是同一只读检查的重复防线，不是另一套迁移实现。
- 真实新设备码批准、凭据落库、一次 access-token 使用和浏览器状态机验收尚未执行；补强代码也尚未发布或部署到生产主机。

## 批次 10：官网 push 与生产主机升级脚本（2026-07-28）

- sibling 仓新增本地 Bun 编排 `scripts/deploy/push-and-upgrade.ts` 与远端 Bash 执行器 `scripts/deploy/upgrade-server.sh`，package 入口为 `bun run deploy:server`。
- 本地门禁要求干净 `master`、正确 origin、GitHub CLI 登录和可解析的 SSH alias；push 固定为 `HEAD:master` 且不允许 force。随后按 commit 查找/等待 `container.yml`，只在 verify/container 成功后解析公开 GHCR digest。
- 远端执行 root-only 互斥、镜像预拉取、空间门禁、冷快照、`.env` 原子切换、loopback/public readiness 和运行镜像身份校验。migration 后失败会保留失败数据并整份恢复快照，不能只换回镜像继续使用新 schema。
- 运维产物统一进入 `/srv/neuro-book-site/ops/deployments/<UTC timestamp>/`，不会触碰 443 共存配置。`--dry-run` 不 push、不 SSH；`--yes` 只跳过人工输入，不跳过任何验证或回滚门禁。
- 第一次真实运行将 `fe0f241` 推到 master 并成功触发 Actions，但本机 GitHub CLI 不支持 `gh run list --commit`。脚本在 Actions 查询阶段失败，生产主机尚未写入；随后改为按 master/workflow/push event 列出近期 run，再用完整 `headSha` 精确匹配，兼容修复提交为 `311bfd0`。
- `311bfd0` 对应 Actions Run `30323712154` 全绿，解析 digest `sha256:8261351c2e26e2f62d3fea386a5301cccf79bd62acb1d161a62558b371f24ea0`，从 `sha256:6ec29b03...` 完成冷快照升级。回执目录为 `/srv/neuro-book-site/ops/deployments/20260728T024146Z/`；同命令立即重跑正确报告“已经运行目标镜像”，没有停容器或创建新目录。
- 为让仓库状态不继续写“尚未执行”，提交 `17dc3ba` 后再次使用同一脚本。Actions Run `30324053579` 全绿，当前线上 digest 为 `sha256:154a6bf450be8bc0528073526a33f7e9d1644293a6ba38b9682d3448be24665d`，上一 digest 为 `sha256:8261351c...`，最终冷快照与回执在 `/srv/neuro-book-site/ops/deployments/20260728T024935Z/`。
- 最终独立验证确认：容器 `running healthy`、只读根 `true`、内存 `805306368`；loopback 与公网 readiness 全部检查 `ok`；Docker/Nginx/现有 TLS 代理全部 active；最终 `env.before`、`data.before.tar`、`deployment.txt` 都是 `0600 root:root`，tar 可读取完整 data 目录。站点 typecheck、Bash 语法、dry-run、真实升级与同 digest 幂等路径均有证据。
- 与计划的出入：没有故障注入自动回滚分支。该测试会主动让生产在 migration 后失败并移动 data，风险高于本轮“快速推送与升级”所需证据；现有回滚实现经过语法/代码审查，整站冷快照恢复此前也独立演练过，但脚本 trap 的真实失败路径仍需未来维护窗口专门验证。
