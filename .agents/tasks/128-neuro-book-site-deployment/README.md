# NeuroBook 官方站部署与关联闭环

> 状态：**Implementing / Phase 4 与 Phase 6 客户端确认（2026-07-28）**。改名、NeuroBook 端到端加密和恢复码闭环、公开仓库/GHCR、生产主机上的 loopback、主机重启、冷快照整体恢复、新旧镜像回滚、DNS、证书、非 443 预演和 Nginx stream 443 切换均已执行；官网 `deploy:server` 已通过真实 push、Actions、两轮固定 digest 升级和幂等重跑。Passport 凭据提交补偿与统一迁移门禁仍只在 NeuroBook 本地实现。剩余门禁是既有 TLS 代理客户端确认、真实 State Root 升到 Application State catalog 2，以及浏览器关联/备份验收；NeuroBook 补强尚未发布公开 Product。

## Relative documents refs

- [../../../PROJECT-STATUS.md](../../../PROJECT-STATUS.md)：NeuroBook 仓库级状态。
- [../88-workshop-platform/README.md](../88-workshop-platform/README.md)：Workshop 资产、API 与原始部署边界。
- [../112-passport-official-site/README.md](../112-passport-official-site/README.md)：Passport、设备码关联与云备份合同。
- [../119-workshop-account-admin/README.md](../119-workshop-account-admin/README.md)：账号、GitHub OAuth、后台管理与限流。
- [../85-fullstack-template-ui-library/README.md](../85-fullstack-template-ui-library/README.md)：`nb-ui` sibling 依赖背景。
- [../../../../neuro-book-site/PROJECT-STATUS.md](../../../../neuro-book-site/PROJECT-STATUS.md)：当前官方站实现状态。
- [../../../../neuro-book-site/reference/passport/api-v1.md](../../../../neuro-book-site/reference/passport/api-v1.md)：官方站 Passport / Backup wire 契约真相源。

## User Request / Topic

- 部署 sibling 仓 `nb-workshop`，让 NeuroBook 关联、Workshop 发布和云备份等既有能力形成真实公网闭环。
- 评估 `nb-workshop` 是否应随职责扩大而改名。
- 在 `测试主机`（局域网）、`备案受限主机`（阿里云）和 `生产主机`（公网 VPS）三台现有服务器中选择部署角色。
- 使用 Docker 部署并处理 HTTPS / 反向代理；比较 Nginx Proxy Manager、Caddy、1Panel、Coolify、Dokploy、Dockge 等方案，避免为单服务引入过重平台。
- 在 `nb.notnotype.com`、`nbook.notnotype.com`、`neuro-book.notnotype.com` 中确定正式域名。

## Goal

将当前 `nb-workshop` 硬切为可重复构建、可升级、可在部署失败后本机回滚的 NeuroBook 官方站单机部署，并通过正式 HTTPS 域名让 NeuroBook 默认完成设备码关联、Workshop Bearer API 发布和端到端加密的实例备份/恢复闭环。

本任务交付的是 **owner-only 私有内测**，不是可向外发放注册码/邀请码的正式公测。公开注册必须通过独立的 Public Invite Gate；在该 Gate 前，只有站点所有者账号可以写入 Workshop 和云备份。

完成状态必须由以下证据共同证明：

1. 干净 checkout 可以构建固定版本的 OCI 镜像，不依赖开发机 Bun link 或未记录的 sibling 状态。
2. 生产主机上由 Docker Compose 运行单实例应用；数据库、Workshop 包和实例备份全部落在显式持久卷，容器重建后数据仍在。
3. 公网 liveness 与内部 readiness 分工明确；readiness 实际检查数据库、migration 和持久目录，TLS 证书有效，登录 Cookie 在反代后保持 Secure，真实客户端 IP 和协议头口径正确。
4. 生产主机上现有 TLS 代理的域名、端口和客户端连接在 443 改造前后均可用；失败时有经过演练的配置与端口回滚路径。
5. 真实 NeuroBook 实例无需手填官方站地址即可发起设备码关联；测试脚本使用实例 Bearer token 发布一个测试包；客户端完成本地加密、上传、下载、密钥恢复和隔离目录恢复。
6. 服务重启、主机重启、镜像回滚和部署前本机数据快照回滚均有实际证据，不只验证首次启动。

实施时必须保持以下约束：

- 不影响 NeuroBook 离线写作；官方站不可达只能影响在线能力。
- 不把 SQLite 扩成多副本数据库；首版保持单应用实例和单本地数据库写者。
- 不用宿主源码目录或本机 `node_modules` 充当生产运行时。
- 不把 `.env`、Session 密钥、管理员密码、OAuth secret、现有 TLS 代理凭据或用户备份写入镜像、Git、日志或 walkthrough。
- 不让运维面板、Docker socket、数据库或应用源端口直接暴露公网。
- 不在未验证实际备份体积和磁盘余量前开放大量邀请码。
- 不把云备份主密钥、恢复码或解密后的临时归档发送到官方站、日志、trace 或错误响应。
- 每个会影响现有 TLS 代理、DNS 或生产数据的阶段必须先给出 dry run、备份点和回滚命令，再等待用户确认执行窗口。

若干净构建、443 无损共存、端到端加密恢复或全局容量拒写任一项没有可辩护路径，停止上线并记录已尝试方案、失败证据、当前阻塞和解锁所需输入；不得用临时公网端口、关闭 TLS 校验或远程挂载 SQLite 绕过。

## Current State

### 产品与代码边界

- `nb-workshop` 已不只是 Workshop：现有代码包含完整 Web 页面、Passport Account、GitHub OAuth、设备码授权、实例授权管理和云备份。Task 112 已将其定位为官方站，Workshop 只是站内模块；仓库改名此前刻意后置。
- `nb-workshop` 当前没有 Dockerfile、Compose、`.dockerignore` 或远端 Git 仓库；GitHub 上也不存在 `notnotype/nb-workshop`。
- `nb-workshop/package.json` 使用 `"@notnotype/nb-ui": "link:@notnotype/nb-ui"`。`nb-ui` 虽有公开 GitHub 仓库，但包本身 `private: true`，因此干净构建机无法按当前合同安装依赖。
- 官方站使用 Prisma/libSQL SQLite；Workshop zip、实例备份均落本地文件系统。生产部署必须同时持久化数据库、`WORKSHOP_FILES_DIR` 和 `NB_BACKUP_DIR`。
- 云备份默认单份 1 GiB、每账号 4 GiB、20 份，Workshop 文件没有全站容量边界。默认值与生产主机的可用磁盘不匹配，内测前必须增加跨 Workshop / Backup 的全局硬限制与文件系统保留空间门禁。
- 当前云备份归档包含 `.env` / `config.yaml`，并标记 `encryption: "none"`；Task 128 将在任何真实上传前硬切到客户端 AES-256-GCM 加密，不上传兼容旧明文归档。
- NeuroBook 的 `OFFICIAL_PASSPORT_SITE_URL` 已固定为 `https://nbook.notnotype.com`；客户端不再接受用户提交的 Passport 上游地址。

### 服务器只读盘点（2026-07-27）

| 主机 | 当前资源与服务 | 初步角色 |
| --- | --- | --- |
| `测试主机` | Arch Linux；Docker / Compose 已安装，已有 Nginx Proxy Manager；SSH 地址是局域网 `<局域网 IP>` | 测试环境与隔离演练环境；本任务不接收生产主机上的生产站点备份 |
| `备案受限主机` | Ubuntu 24.04；已有 Docker / Nginx Proxy Manager、FRP 和现有 NeuroBook 服务 | 按用户给定的备案约束，不承载正式 HTTPS 官方站 |
| `生产主机` | Ubuntu 24.04；Docker / Compose 已安装；公网 IP `<公网 IP>` | 唯一生产应用主机；应用已 loopback 运行，443 仍由现有 TLS 代理占用 |

### 生产主机入口现状

- `443` 当前由现有 TLS 代理的 TLS inbound 占用，证书域名是 `<生产主机域名>`，并有既有 fallback。
- 现有TLS 代理入口经本机回环端口转入；宿主 Nginx 监听若干回环端口。
- 宿主 Nginx 已编译 `stream`、`stream_ssl_preread` 与 HTTP SSL 模块，具备用 SNI 在 L4 分流的技术基础。
- 防火墙已有 80/443 规则；80 已新增 `nbook.notnotype.com` ACME webroot vhost，根路径暂时 404；不能据此跳过云厂商安全组和公网探测。
- 直接启动 Caddy、Nginx Proxy Manager、Traefik 或面板让其绑定 443 都会与现有 TLS 代理冲突。

### 域名现状

- `notnotype.com` 的 DNS 托管在外部服务商。
- `nb.notnotype.com`、`nbook.notnotype.com`、`neuro-book.notnotype.com` 当前均为 NXDOMAIN；添加 `nbook.notnotype.com A <公网 IP> TTL 300` 是当前外部权限门禁。
- GitHub OAuth 生产回调尚未配置；正式回调必须是 `https://<正式域名>/auth/github`。

## ADR / Decisions / Discussion

### D1. 官方站职责与改名

推荐把仓库和部署服务从 `nb-workshop` 硬切为 `neuro-book-site`：

- 用户可见品牌保持 **NeuroBook**。
- Workshop / Passport / Backup 是站内模块，不再用其中一个模块命名整个服务。
- API 继续使用现有 `/api/v1`，不因仓库改名制造新的路径层级。
- 当前尚无生产部署和远端仓库，不保留旧仓库名、旧包名或旧 platform identity 兼容层；相关代码、测试、文档和部署名一次性同步。

2026-07-27 用户已确认采用 `neuro-book-site`，实施时一次性硬切，不建立旧仓库名、旧 package 名或旧 platform identity 的兼容层。

### D2. 正式域名

正式域名确定为 `nbook.notnotype.com`：比 `nb` 更可识别，比 `neuro-book` 更短，且能长期承载账号、工坊和备份。

- `nb.notnotype.com` 保留，不在首轮额外维护跳转与第二张证书。
- `neuro-book.notnotype.com` 不作为并行主域名，避免 OAuth、Cookie、CORS 和文档出现多 origin。
- 正式域名只在生产主机的 loopback、非 443 TLS 预演和 443 回滚演练通过后写 DNS；当前 DNS 尚未写入。

### D3. 服务器职责

- **生产主机**：唯一生产应用写者与公网入口。
- **测试主机**：测试环境与隔离演练环境，不承载本轮生产依赖。
- **备案受限主机**：保留现状，不引入官方站生产依赖。

不采用“应用和 SQLite 在生产主机、zip 目录通过 SSHFS/NFS 挂到测试主机”的拆分。远程文件系统会把局域网、Tailscale 和家用服务器可用性引入上传事务，复杂度高于当前收益。

原计划的生产主机 → 测试主机站点备份链路是 `生产主机 -> Tailscale -> SSH/SFTP -> 测试主机上的 Restic repository`：Restic 在生产主机侧先加密，测试主机只保存密文。只读核验发现生产主机的 Tailscale 当前 `WantRunning=false`、backend stopped，链路尚不可用。用户决定本任务先不做 NeuroBook 官方站自身的异地备份，因此不启动 Tailscale、不创建测试主机备份账号，也不把这条链路作为上线阻塞；以后恢复时另立任务处理连通性、Restic 密钥、保留周期、RPO/RTO 和恢复演练。

### D4. 部署与运维工具

首版使用 **Docker Compose + 宿主 Nginx**，不安装完整面板：

- Compose 是应用、volume、环境变量、健康检查和重启策略的部署真相源。
- 宿主 Nginx 负责已有 443 SNI 分流、TLS、上传限制和反代头。
- 应用容器只发布到 `127.0.0.1`，不直接监听公网。
- 不使用 Watchtower 或 `latest` 自动更新；部署固定镜像 tag/digest，更新由显式命令触发。

工具取舍：

| 工具 | 本任务结论 |
| --- | --- |
| Nginx Proxy Manager | `测试主机`上可继续使用；生产主机上不能消除 443 冲突，且会增加一层配置所有者 |
| Caddy | 干净 VPS 的首选之一；当前生产主机仍需先做 L4 分流，不能单独解决问题 |
| Dockge | 若后续确实需要 Compose UI，可仅通过 Tailscale 暴露；不作为上线依赖 |
| 1Panel / 宝塔 | 会扩大宿主配置所有权和公网管理面，容易与现有 TLS 代理/Nginx 冲突，不采用 |
| Coolify / Dokploy / Komodo | 更适合多应用 PaaS 或多主机管理；低内存单服务场景收益不足，不采用 |

### D5. 443 共存

推荐让宿主 Nginx stream 成为 443 的唯一监听者，按 TLS SNI 透传：

```text
Internet :443
    |
    +-- SNI <生产主机域名>  -> 现有 TLS 代理 loopback TLS port
    |
    `-- SNI nbook.notnotype.com -> Nginx local HTTPS vhost
                                      |
                                      `-> 127.0.0.1:<app-port>
```

实施约束：

- 先冻结并备份 `现有 TLS 代理配置目录`、现有 TLS 代理 systemd unit、Nginx 主配置和证书目录。
- 先在额外本地端口验证现有 TLS 代理修改后的监听和官方站 HTTPS upstream，再切换 443 所有者。
- Nginx stream 向两个 loopback upstream 发送 PROXY protocol；现有 TLS 代理 443 inbound 与站点 HTTPS vhost 分别显式接收，只信任 loopback 来源。否则现有 TLS 代理、应用日志和限流键只能看到 `127.0.0.1`。
- 未匹配的 SNI 默认走现有 TLS 代理，避免遗漏既有客户端域名。
- 确认现有 TLS 代理的更新/重建行为；若它会覆盖手工配置，把自定义 stream 配置放在明确的外部 include，并记录重建后的恢复步骤。
- 维护窗口必须保留第二条 SSH 会话；任何现有 TLS 代理客户端回归立即恢复原端口与配置。

Cloudflare Tunnel 仅作备选：它能绕开本地 443，但会引入 DNS 迁移、第三方入口和上传大小限制，不作为当前 DNS 服务商域名的默认方案。

### D6. 构建与发布

- 生产镜像已由干净 Linux runner 构建并推送公开 GHCR；生产主机只 pull 和运行，不承担 Nuxt 构建。当前线上基线为 `sha256:c32043c9bd1f6820ea3b9aa1380e057addbe17a41c7254d62ea62b449f8a793c`，上一基线为 `sha256:6fa3ed4c9d0aa1e45c31b148230e3e6a019083c7455f2d5c86fd71001f5d0474`。
- `neuro-book-site` GitHub 仓库与 GHCR 镜像均公开。GitHub Actions 使用仓库 `GITHUB_TOKEN` 推送镜像；生产主机匿名拉取固定 digest，不保存长期 GitHub pull token。
- `nb-ui` 首轮使用锁定 Git commit 的依赖，`bun.lock` 固定解析结果；不使用 CI 隐式 checkout + Bun link，也不把 npm 发包加入本次部署关键路径。以后是否发布版本化包另行决定。
- 镜像采用 Bun 构建阶段和最小运行阶段，复制 Nitro `.output` 与运行所需文件；是否使用 Node 或 Bun 运行，以 Linux 容器集成测试为准。
- 镜像以提交 SHA 和语义版本双 tag 标识；Compose 固定不可变版本，保留上一版本以便回滚。
- 数据库迁移作为显式 deploy step。迁移前生成数据库一致快照；不依赖向下 migration，需回滚不兼容 schema 时恢复整份部署前快照。

### D7. 数据与容量

- 生产持久目录统一放在生产主机的 `/srv/<service>/data/`，数据库、Workshop 包和实例备份使用不同子目录。
- 首轮仍使用本地文件系统，不在本任务引入 S3 抽象或对象存储迁移。
- 私有内测起点：单份云备份 1 GiB、每账号 2 GiB、最多 5 份；先测一个真实 State Root 再下调或上调单份值。
- 新增 `NB_STORAGE_MAX_BYTES`，统计所有已提交的 Workshop zip 与云备份**密文**字节；生产主机初始值设为 6 GiB。达到上限时，所有新增文件写入返回 HTTP 507 与稳定错误码 `storage_capacity_exceeded`，读取和删除继续可用。
- 新增 `NB_STORAGE_RESERVED_BYTES`，按持久卷所在文件系统的实际可用空间保留 4 GiB。逻辑总量尚未超限但物理余量不足时，同样拒绝新写入。
- Workshop 与 Backup 共用一个容量准入服务和进程内上传 reservation。首版单实例允许串行化大文件写入，以较低吞吐换取并发请求不会共同穿透容量上限。
- 准入同时检查请求声明大小、流中实际大小、数据库内两类文件总量与 `statfs`；临时文件失败后必须清理。进程启动时清理过期 tmp，并检查数据库记录与文件缺失，但不自动删除无法判断归属的文件。
- 容量耗尽不让 readiness 失败，否则管理员无法登录删除内容；readiness 只判断数据库和目录是否可用，容量阈值走拒写、监控和外部告警。
- 本任务只保留每次 migration / 升级前的同盘冷快照，用于部署失败回滚。生产主机磁盘或整机丢失时，账号、Workshop 包和用户云备份都会丢失；这是私有内测阶段明确接受的剩余风险，不得把当前部署描述为异地容灾或可灾难恢复。

### D8. 云备份端到端加密与密钥生命周期

云备份采用“客户端压缩后、本地加密、再上传”的硬合同。官方站只接收密文、密文 sha256 和非机密元数据，永远拿不到主密钥或恢复码。

端到端加密只隐藏归档内容。官方站仍可见账号、`instanceLabel`、备份时间、密文大小、`appVersion`、`kind`、用户备注和 `keyId`，客户端界面与隐私说明必须列出这组服务端可见元数据；用户备注不得被描述为加密字段。

密钥方案：

- 第一次创建云备份时，NeuroBook 用系统 CSPRNG 生成 32 字节随机 **Backup Master Key**，不从 Passport 密码、实例密码、用户名或 OAuth 身份派生。随机密钥避免口令强度和改密/多登录方式耦合。
- 用户恢复码格式固定为 `NBK1-<base64url(32-byte-key)>-<checksum>`；checksum 取 key 的 SHA-256 前 4 字节，只用于发现复制错误，不参与密钥派生。
- `keyId` 取 key 的 SHA-256 前 8 字节 hex，只用于在备份列表中识别应使用哪个密钥，不具备解密能力。官方站可保存 `keyId`，不能保存恢复码。
- 主密钥保存在 `State Root/secrets/backup-keyring.json`，权限限制为当前实例用户可读；Runtime Paths 提供稳定路径，业务层不手拼。`secrets/` 不进入云备份明文清单。创建恢复 staging 目录时，只有用户成功导入恢复码后才把同一密钥写入 staging 的 secret store，保证换目录后仍能继续使用。
- 第一次备份必须先进入阻塞式“保存恢复码”步骤，不能生成密钥后直接上传。界面显著说明“官方站无法找回恢复码；实例和恢复码同时丢失时，所有云备份永久不可恢复”，并提供“复制恢复码”和“下载恢复码文件”两个明确动作。
- 至少一次复制或下载成功后，才允许勾选“我已把恢复码保存在其他安全位置”并继续备份。用户取消时不上传、不生成第二把 key；下次备份继续展示同一把尚未确认的恢复码。
- 设置页允许经本地实例认证后再次导出，并显示 active / historical keyId；普通成功通知、备份列表和任务详情都不能回显完整恢复码。
- 恢复到另一实例时由用户粘贴恢复码，除解析后写入本地 secret store 外只在当前请求内存中使用，不写日志、trace、job error 或官方站请求。
- 首版不做服务器托管恢复、不用账号密码包裹密钥，也不提供“忘记恢复码”后门。实例和恢复码同时丢失时，云端密文永久不可恢复，界面必须明确说明。
- 轮换采用 keyring：一个 active key 负责新备份，历史 key 只负责恢复旧备份。删除历史 key 前必须证明对应 `keyId` 已无云端备份；服务端不会自动迁移或重加密旧备份。

归档与密码学合同：

- 使用 Node 标准库流式 `AES-256-GCM`，每份备份生成独立随机 12 字节 nonce；禁止同一 key 重用 nonce。
- zip 压缩输出直接进入 cipher，最终只把加密临时文件落盘，不产生完整明文 zip 临时文件。上传 sha256 针对密文字节计算。
- 外层 envelope 包含 magic、formatVersion、algorithm、keyId、nonce 和 16 字节 authentication tag；header 作为 AAD 认证。内层 `nb-backup.json` 随其他 State Root 内容一起加密。
- 恢复时先流式下载并校验密文 sha256，再流式解密到隔离 staging；GCM tag 验证和内部 manifest 校验全部通过后才标记可恢复。任一失败必须删除半成品，不能把未认证明文交给用户替换 State Root。
- 当前 `encryption: "none"` 合同直接硬切，不兼容上传或恢复旧明文云备份；正式站首次部署前清空开发测试备份，并先更新 Passport / Backup wire spec。

### D9. 私有内测与公开邀请边界

- 本任务只交付 owner-only 私有内测；服务端关闭注册，注册码/邀请码不向外发放，不启用 GitHub OAuth，界面隐藏注册与 GitHub 登录入口，只保留现有账号的密码登录。
- Workshop 公网写入前仍必须补 multipart 压缩包上限（初值 20 MiB）、解压总量上限（100 MiB）、条目数上限（500）以及上传 / 评论频率限制。服务端不能只依赖 Nginx body limit。
- `readMultipartFormData` + `unzipSync` 的整包路径必须替换为有界解析；在生产主机的有限内存下，压缩包上传和解析不能同时保留多份完整 buffer。
- 对外发放第一个注册码或邀请码前，另行完成 ToS、隐私说明、备份保留/删除口径、公开注册容量评估与安全验证。owner-only 验收通过不自动开放该 Gate。

### D10. 单实例边界

- SQLite、本地文件落盘和进程内限流决定首版只能运行一个应用实例。
- 不配置多副本、滚动更新或负载均衡。更新接受短暂停机，优先换取事务和文件所有权清晰。
- 后续若需要多副本，必须先迁移数据库、对象存储、限流和后台任务所有权，不在 Compose 层伪装高可用。

### D11. 浏览器验收边界

- 自动化 HTTP、容器和 CLI 验证属于实施阶段必做项。
- 浏览器验收不自动执行；部署稳定后由用户明确要求 Agent 执行，或由用户按验收清单完成。
- 在浏览器证据完成前，Task 112 仍保持 “Browser acceptance pending”。

### D12. 结构化日志与官方站网络错误

- 官方站使用 Pino 生成结构化 JSONL，请求只记录固定安全字段并返回 `X-Request-ID`。URL query、header/body、User-Agent 和全部凭据字段不进入日志；错误 message/stack 再经过自由文本清理。
- stdout 保留 Compose `json-file` 10 MiB x 3；`/logs/site.jsonl` 使用独立持久卷和小时级 logrotate，20 MiB x 14，旧文件压缩。日志不进入站点冷快照，不计入用户容量配额，也不扩展到测试主机或外部日志服务。
- NeuroBook 本体继续使用既有 JSONL 日志器。Passport/Backup 的官网调用统一经过固定 transport，将网络/超时、上游 5xx 和业务 4xx 分开；不得用硬编码 IP 或 DoH fallback 掩盖本机 DNS/代理故障。
- Node 24 需要代理时，`NODE_USE_ENV_PROXY=1`、`HTTPS_PROXY` 与本地 `NO_PROXY` 必须在进程启动前由 shell/服务环境提供并重启 NeuroBook。本任务只记录配置方法，不自动改变整个进程的网络出口。

## Scope

### 本任务包含

- 官方站仓库/服务改名及跨仓引用同步。
- 可复现依赖、Docker 镜像、Compose、GHCR 构建与部署脚本。
- 生产主机应用部署、443 SNI 分流、TLS 和 DNS；私有内测隐藏 GitHub OAuth 入口，不配置生产 OAuth secret。
- Workshop 公网写入安全债回补、readiness、生产 secret fail-closed。
- 持久卷、账号配额、跨 Workshop / Backup 的全局容量硬限制、监控和本机回滚 runbook。
- NeuroBook 云备份在客户端生成/保管恢复码、流式加密与解密恢复；官方站只存密文。
- NeuroBook 默认官方站 URL 回填与对应发布。
- 设备码关联、Bearer API 发布、加密备份/恢复的真实闭环验收。
- 部署与用户文档、Task walkthrough、`PROJECT-STATUS.md` 和需要时的 `RELEASE.md` 同步。

### 本任务不包含

- Kubernetes、多节点高可用、PostgreSQL 迁移或多区域容灾。
- 邮箱注册、找回密码、公开无邀请注册。
- GitHub OAuth 生产配置；公开邀请前再决定是否启用。
- Workshop 客户端资产安装器的全新产品实现；这里只验证已有 Bearer API 发布与站点下载。
- NeuroBook 客户端内的 Workshop 发布界面；本任务只用脚本调用 Bearer API smoke。
- 生产主机官方站数据到 `测试主机` 或其他地点的异地备份、站点灾难恢复和 RPO/RTO 承诺。
- 对象存储抽象；容量达到本地盘边界时另立任务。
- 自动部署任意 master 提交、Watchtower、无人值守数据库 migration。
- 用面板接管生产主机全部系统服务。

## Execution Documents

- [IMPLEMENTATION-PLAN.md](IMPLEMENTATION-PLAN.md)：剩余 Gate、Phase、验证矩阵、风险和回滚合同。
- [walkthroughs/2026-07-27-planning-and-review.md](walkthroughs/2026-07-27-planning-and-review.md)：立项、服务器证据、计划审查、用户拍板和与原计划的出入。
- [walkthroughs/2026-07-27-implementation.md](walkthroughs/2026-07-27-implementation.md)：分批实施、代码变更、验证结果与实际偏差。

## TODO / Follow-ups

- [x] [Gate 0](IMPLEMENTATION-PLAN.md) 方案决策已完成：公开仓库/GHCR、私有内测关闭 OAuth、443 先预演后在具体维护时间再次确认。
- [x] Phase 1：合同与代码生产化。
- [x] Phase 2：镜像与隔离验证。
- [x] Phase 3：生产主机基础部署。
- [ ] Phase 4：443、TLS 与 DNS（已切换，等待既有 TLS 代理客户端确认与 80 → HTTPS 跳转）。
- [x] Phase 5：容量、监控与本机回滚（容量门禁、冷快照和 digest 回滚已演练）。
- [ ] Phase 6：NeuroBook 私有内测闭环。
- [ ] Phase 7：发布与收尾。
- [ ] Public Invite Gate 另行审查；本 Task 完成后仍保持注册关闭，不对外发放注册码或邀请码。

## 2026-07-27：NeuroBook 个人中心与固定官网合同

- 顶栏头像菜单新增独立“个人中心”；技术设置 Dialog 不再承载 Passport 或小说数据 section。本地实例退出仍只退出本地登录，不等于取消官网账号关联。
- 未关联时个人中心展示官网设备码登录；关联后展示账号、授权范围、关联时间、云备份/恢复和取消关联。“编辑账号资料”跳转 `https://nbook.notnotype.com/me?tab=account`，本轮不扩展 Bearer scope，也不在客户端直接编辑官网资料。
- Passport 唯一可信上游固定为 `https://nbook.notnotype.com`。关联启动不再接收 `siteBaseUrl`，状态 DTO 不再暴露地址；设备码、轮询、刷新、吊销和备份链统一使用官方常量。
- `PassportCredential.siteBaseUrl` 已从两份 schema 和生成客户端删除；前向迁移只保留地址严格等于官网的旧凭据，丢弃旧自定义站点凭据。官网凭据升级后继续有效，自定义站点升级后需要重新关联。
- IDE 顶栏与无 Project 的选择页复用同一账户菜单；Profile 状态加载具有 loading/error/loaded 三态，失败时保留错误详情和重试入口，不伪装成未关联。
- 服务层回归锁定设备码、refresh single-flight、吊销、备份列表/上传/元数据/下载/删除只能访问官网；隔离 SQLite 迁移测试确认官网凭据保留、自定义凭据删除和地址列消失。自动浏览器验收未执行；设备码登录与云备份浏览器闭环仍待用户授权。

## 2026-07-28：关联批准后的本地提交补偿与迁移门禁

- 首次设备码兑换新增本地提交不变量：只有 `PassportCredential` upsert 成功才返回 `linked` 并缓存 access token。写入失败会终止内存会话、best-effort 吊销新 grant，并返回 `credential_persist_failed` 与 `revoked | unknown`；`invalid_grant` 转换为终态 `exchange_invalid`，不再把上游 400 泄漏给界面。
- refresh 轮换也改为“落库后更新 cache”。新 token 落库失败时吊销新 token、删除旧凭据、清空 cache 并阻止旧 token 重放，要求用户重新关联。日志和错误不会保存 deviceCode、access/refresh token、Cookie、Authorization 或完整 grant。
- 前端关联逻辑收口到 `usePassportLink`：仅 `pending` 自动轮询；普通网络错误暂停并保留设备码，支持手动重新检查或重新发起；404 会先读取本地关联状态对账；凭据提交失败会停止 timer 并给出重新关联及必要的官网授权管理入口。
- App SQLite migration 已接入 Task 118 在途建立的统一 Application State runner，catalog version 2 的执行顺序为 `app-sqlite → agent-attachment-v1 → agent-session-v2`。Manager 负责计划、SQLite 冷备份和 Operation Journal，Product runner 负责事务化 schema apply；直接 dev、Product launcher 与 Nitro 入口都有只读启动门禁。
- 自动化结果：Passport/前端/日志/迁移聚焦 32 项通过，App SQLite 旧库与统一 runner 8 项通过，Manager 聚焦 17 项通过，完整 suite 164 项通过、2 项按平台跳过；Manager typecheck、`nuxt:build` 与 Product runtime 产物断言通过。
- 根仓 typecheck 本轮文件零新增错误，完整命令仍被 `server/agent/skills/llmlint.test.ts` 的 26 项既有类型错误阻断。真实 State Root 的 App SQLite 无 pending，但 Application State sentinel 仍是 catalog 1；本轮未执行真实迁移、浏览器验收、公开 Product 发布或生产主机升级。

### 与原计划的出入

- 原计划等待 Task 118 的 runner interface 落地后再接线；实施时该在途 Module 已经存在，因此本轮直接扩充 `app-sqlite` 步骤，没有修改成第二套 registry 或 Passport 专用 migration。
- 为防止用户绕过 package script，除 `bun run dev` 前置检查外，Product launcher 和 Nitro 入口也执行同一只读兼容性检查；无 pending 时不会写数据库或 migration 状态。
- 真实批准闭环原计划在聚焦验证后执行，但按仓库规则未自动进行浏览器操作；当前只具备自动化与构建证据，不能宣称用户可见闭环已经验收。

## 2026-07-28：官网一键 push 与生产主机升级编排

- sibling `neuro-book-site` 新增 `bun run deploy:server`。命令只接受已提交且干净的 `master` 与固定 GitHub origin；不会自动 commit、不会 force push，也不会把当前 NeuroBook 主仓变更误部署为官网容器。
- 本地编排执行 `git push origin HEAD:master`，等待该 commit 的 Actions verify/container 成功，再从公开 GHCR `sha-<commit>` tag 解析不可变 digest。Actions 失败或超时发生在任何生产主机写入之前。
- 远端通过 root-only `flock` 串行升级：拉镜像后重新检查“data + 4 GiB”余量，停站制作冷快照，原子替换 `.env` 唯一 `NB_SITE_IMAGE`，验证 loopback/public readiness 与容器实际镜像。
- 新容器启动、migration、镜像身份或 readiness 任一失败时，脚本保留日志与失败数据目录，恢复旧 `.env` 和整份 `data` 冷快照，再启动旧镜像。每次尝试写入 `/srv/neuro-book-site/ops/deployments/<UTC timestamp>/`；不修改 DNS、证书、Nginx、443 或现有 TLS 代理。
- 首次真实执行先推送 `fe0f241`，随后因本机 `gh run list` 不支持 `--commit` 在生产主机写入前 fail closed。修复提交 `311bfd0` 改为列出 `master + workflow + push event` 的近期 runs，再用完整 `headSha` 精确筛选，没有放宽提交身份门禁。
- `311bfd0` 的 Actions Run `30323712154` 全绿，digest `sha256:8261351c...` 从 `sha256:6ec29b03...` 完成升级，冷快照为 `/srv/neuro-book-site/ops/deployments/20260728T024146Z/data.before.tar`；同一命令重跑识别目标 digest 并幂等退出，没有停站或第二份快照。
- 收尾文档提交 `17dc3ba` 又经同一路径完成 Actions Run `30324053579` 和第二次升级。当前线上 digest 为 `sha256:154a6bf450be8bc0528073526a33f7e9d1644293a6ba38b9682d3448be24665d`，上一 digest 为 `sha256:8261351c...`，最终回滚点为 `/srv/neuro-book-site/ops/deployments/20260728T024935Z/data.before.tar`。
- 最终独立核对：容器 `running/healthy`、只读根和 768 MiB 上限保持；loopback/public readiness 的数据库、migration、数据库/Workshop/Backup 存储和容量全部 `ok`；Docker、Nginx、现有 TLS 代理均 active；最终 `.env` 备份、可列目录的冷快照和 deployment receipt 均为 `0600 root:root`。未故障注入自动回滚分支，避免为测试主动破坏生产数据；该分支仍保留为剩余演练风险。
