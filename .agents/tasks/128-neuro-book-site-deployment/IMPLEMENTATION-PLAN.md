# Task 128 Implementation Plan

> 状态：Planning。本文只记录执行顺序、验证门和回滚合同；目标与架构决策见 [README.md](README.md)。

## Gate 0：方案决策已确认

已确认：

- [x] 仓库/服务名使用 `neuro-book-site`，不保留 `nb-workshop` 兼容层。
- [x] 唯一正式域名使用 `nbook.notnotype.com`。
- [x] 第一里程碑是 owner-only 私有内测，不向外发邀请码。
- [x] Workshop 发布只做 Bearer API smoke，不新增 NeuroBook 客户端发布界面。
- [x] `nb-ui` 首轮锁定 Git commit，不把 npm 发包加入关键路径。
- [x] 云备份必须在 NeuroBook 本地端到端加密后上传。
- [x] 官方站增加跨 Workshop / Backup 的全局容量硬限制。
- [x] 本任务不做生产主机官方站数据到测试主机的异地备份。
- [x] `neuro-book-site` GitHub 仓库与 GHCR 镜像均公开；生产主机匿名拉取固定 digest，不保存 GitHub pull token。
- [x] owner-only 私有内测不启用 GitHub OAuth，隐藏登录入口，只使用账号密码。
- [x] 认可 443 维护流程；必须先完成非 443 预演，实际切换时间在 Phase 4 前再次确认。

这三项不是产品需求，而是外部系统操作授权；含义与已确认结论如下：

| 授权项 | 实际会做什么 | 为什么需要用户确认 | 已确认结论 |
| --- | --- | --- | --- |
| 生产主机维护窗口 | 修改现有 TLS 代理 443 listener 与宿主 Nginx stream，重载/重启入口服务；失败时立即按 runbook 回滚 | 切换期间现有 TLS 代理连接可能短暂中断，必须由用户决定时间 | 完成非 443 预演后，再单独确认一次具体执行窗口；现在无需提前授权 |
| 仓库 / GHCR 权限 | 创建 `neuro-book-site` GitHub 仓库，由 Actions 构建镜像并推送 GHCR；生产主机拉取固定 digest | 需要决定源码和镜像是否公开，以及生产主机是否必须保存 GitHub pull token | **已确认公开仓库 + 公开 GHCR**；镜像不含 secret，生产主机匿名 pull，不保存长期 GitHub token |
| GitHub OAuth | 创建 GitHub OAuth App，把 client ID/secret 配到站点，回调固定为 `https://nbook.notnotype.com/auth/github` | 会新增第三方登录入口和一份生产 secret；owner-only 内测并不需要 | **已确认本轮不启用**；隐藏 GitHub 登录按钮，只用账号密码，公开邀请前再决定 |

对应的执行门：

- [x] 维护流程已授权：允许在完成非 443 预演后调整生产主机的现有 TLS 代理 443 监听和宿主 Nginx stream；具体执行时间仍需 Phase 4 前确认。
- [x] 生产仓库与 GHCR 均公开；Actions 使用仓库 `GITHUB_TOKEN` 推送，生产主机匿名 pull。
- [x] 私有内测不启用 GitHub OAuth，隐藏入口，只保留账号密码路径。

Gate 0 的方案决策已完成。唯一仍需临场确认的是 Phase 4 的具体维护时间；在非 443 预演、dry run、配置备份和回滚命令齐备前，不得把本次方案认可解释为立即修改生产主机的授权。

## Phase 1：合同与代码生产化

- [ ] 把 sibling 仓目录、package、meta platform、文档和部署标识硬切为 `neuro-book-site`，同步两仓引用。
- [ ] 创建远端仓库，设置默认分支、保护规则和最小 deploy 权限。
- [ ] 把 `@notnotype/nb-ui` 改为锁定 commit 的 Git 依赖，验证没有 Bun link 注册时仍可安装。
- [ ] 先更新官方站 Passport / Backup wire spec：备份文件改为加密 envelope，DTO 增加 `keyId`，sha256 定义为密文字节摘要，删除 `encryption: "none"` 合同。
- [ ] 在 NeuroBook 增加 `State Root/secrets/backup-keyring.json` 本地 secret store；Runtime Paths 提供稳定路径，不在业务层拼接路径。
- [ ] 实现 Backup Master Key 生成、恢复码编码/校验、active + historical keyring、导入/导出和严禁日志输出的错误边界。
- [ ] 第一次备份增加阻塞式恢复码保存步骤：明确“官方站无法找回”；提供复制和下载；至少一项成功后才允许确认并上传；取消后复用同一未确认 key，不静默轮换。
- [ ] 设置页增加恢复码重新导出与 keyId 管理入口；成功通知、任务进度和备份列表只显示 keyId，不显示完整恢复码。
- [ ] 用 Node 标准库实现流式 AES-256-GCM envelope；压缩输出直接进入 cipher，不落完整明文 zip。
- [ ] 恢复链改为密文 sha256 → GCM tag/AAD → 内层 manifest 三重验证；失败清理 staging，成功后才写入恢复完成状态。
- [ ] 官方站存储密文 `.nbbackup`，数据库保存 `keyId` 与密文 fileSize/sha256；不解析、不解密用户归档。
- [ ] 更新备份界面与隐私说明，逐项列出服务端仍可见的账号、实例名、时间、密文大小、应用版本、类型、备注和 keyId；不把备注误称为加密内容。
- [ ] 增加共享 `StorageCapacityService`：聚合 Workshop / Backup 已提交字节，检查 `NB_STORAGE_MAX_BYTES` 与 `NB_STORAGE_RESERVED_BYTES`，管理单实例上传 reservation。
- [ ] 全局容量不足统一返回 507 `storage_capacity_exceeded`；账号备份配额不足继续使用 413 `quota_exceeded`。
- [ ] Workshop multipart 改为有界路径：压缩包 20 MiB、解压总量 100 MiB、500 条目，并补上传 / 评论频率限制。
- [ ] 增加 liveness 与 readiness：readiness 检查数据库查询、migration 和持久目录可读写；容量耗尽只标记 degraded 并拒绝写入，不阻断读取/删除。
- [ ] 生产 init fail-closed：缺管理员密码、Session secret 或仍为示例值时拒绝初始化；开发 seed 与生产 init 分离，普通重启不携带管理员明文密码。
- [ ] 增加 `.dockerignore`、多阶段 Dockerfile 和生产 Compose；构建上下文排除 secret、数据库、上传、备份、`.agent` 与缓存。
- [ ] Compose 固定单实例、loopback 端口、readiness healthcheck、restart policy、日志轮转、显式 volume、非 root 用户和资源上限。

## Phase 2：镜像与隔离验证

- [ ] 在无 Bun link 的干净 Linux runner 完成 install、typecheck、test、build 和 OCI image build。
- [ ] 从空 volume 显式执行 init / migrate / serve；验证默认管理员和短 Session secret 均不能进入生产。
- [ ] 注入数据库不可用、migration 未完成、文件目录只读，证明 readiness 失败；普通进程存活仍由 liveness 单独报告。
- [ ] 重建容器后验证账号、条目、Workshop zip、备份密文和 keyId 元数据均保留。
- [ ] 验证 Workshop 超压缩包、超解压量、超条目数、zip bomb、上传频率和评论频率均被稳定拒绝。
- [ ] 验证 1 GiB 级云备份从压缩、加密、上传、下载到解密都不整读；临时目录中不出现完整明文归档。
- [ ] 覆盖正确恢复码、错误恢复码、错误 checksum、未知 keyId、密文篡改、header/AAD 篡改、截断文件和 GCM tag 错误。
- [ ] 验证恢复码、主密钥和解密内容不进入 HTTP 请求、官方站数据库、日志、trace、job error 或测试 snapshot。
- [ ] 覆盖首次备份未复制/下载不可继续、复制失败仍可下载、取消后不上传且 key 不变化、确认后才上传、再次导出需要本地认证。
- [ ] 在缩小容量阈值的测试环境覆盖 Workshop / Backup 共同计量、并发上传、删除后释放、tmp 清理、物理余量不足和 507 响应。
- [ ] 用反代头模拟 HTTPS，验证 Secure Cookie、Host、`X-Forwarded-Proto` 和可信真实 IP；伪造 forwarded header 不能越过 loopback trust。
- [ ] 建立 GHCR workflow 产出 SHA tag；在生产主机之外完成一次 pull + compose smoke。

## Phase 3：生产主机基础部署

- [ ] 重新只读采集系统、端口、防火墙、现有 TLS 代理、Nginx 和磁盘基线，记录到新一轮 walkthrough。
- [ ] 备份现有 TLS 代理、Nginx 和 systemd 配置，并在隔离位置验证配置可恢复。
- [ ] 安装 Docker Engine 与 Compose plugin，固定系统级更新策略。
- [ ] 创建 `/srv/neuro-book-site/`、部署用户、持久目录和权限；真实 `.env` 仅部署用户可读。
- [ ] 配置 `NB_STORAGE_MAX_BYTES=6442450944`（6 GiB）、`NB_STORAGE_RESERVED_BYTES=4294967296`（4 GiB）、单账号 2 GiB / 5 份；真实 State Root 实测后可下调。
- [ ] 拉取固定镜像，在 loopback 端口启动应用，不改 DNS、不接公网。
- [ ] 在生产主机本机完成 liveness、readiness、登录、数据库、Workshop、加密备份和重启持久性 smoke。
- [ ] 记录 CPU、RSS、磁盘、启动时间和大文件临时空间，确认 2 GiB 内存可承载。

## Phase 4：443、TLS 与 DNS

- [ ] 写出 Nginx stream 与现有 TLS 代理端口迁移 dry run，列出 listener、SNI、PROXY protocol、证书所有者和逐条回滚命令。
- [ ] 先在非 443 端口验证现有 TLS 代理、站点 TLS vhost 和应用 upstream。
- [ ] 配置 stream 向两个 upstream 发送 PROXY protocol；现有 TLS 代理 inbound 与站点 TLS vhost 只信任 loopback 并正确还原客户端 IP。
- [ ] 在维护窗口让 Nginx stream 接管 443：`<生产主机域名>` 透传现有 TLS 代理，`nbook.notnotype.com` 进入站点 TLS vhost，未知 SNI 默认走原 TLS 代理。
- [ ] 从独立网络验证全部既有 TLS 代理入口；任何失败立即回滚，不继续 DNS。
- [ ] 在 DNS 服务商 添加 `nbook.notnotype.com` A 记录并使用低 TTL。
- [ ] 签发并验证 TLS，执行证书续期 dry run，确保续期无需抢占现有 TLS 代理的 443。
- [ ] 配置显式 body limit、超时、request buffering、连接/请求限速和安全响应头。
- [ ] 从公网验证 liveness、readiness 运维探测、登录 Cookie、OAuth 回调和有界大文件上传。

## Phase 5：容量、监控与本机回滚

- [ ] 测量真实 State Root 压缩和加密后体积、峰值内存与上传耗时，复核单份 1 GiB / 账号 2 GiB / 5 份配置。
- [ ] 验证逻辑全局容量与 4 GiB 物理保留空间都能在阈值前拒写，读取和删除仍可用。
- [ ] 配置容器健康、重启次数、磁盘、容量阈值、TLS 到期和 HTTP 可达性监控；告警不得只留在生产主机本机。
- [ ] 每次 migration / 升级前停应用，复制整个持久目录形成同盘冷快照；升级成功并观察后按保留策略删除。
- [ ] 实际执行一次兼容镜像回滚和一次不兼容 schema 的冷快照恢复。
- [ ] 编写升级、migration、容量耗尽、证书失败、现有 TLS 代理回归和恢复码丢失 runbook。
- [ ] 在运维文档显著写明：当前没有站点异地备份，生产主机磁盘或主机丢失会丢失全部官方站数据。

## Phase 6：NeuroBook 私有内测闭环

- [x] 官方站稳定后，把 `OFFICIAL_PASSPORT_SITE_URL` 固定为 `https://nbook.notnotype.com`，补类型与单测。
- [x] 私有内测隐藏 GitHub OAuth 入口，不配置 OAuth App 或 client secret，只保留账号密码登录。
- [ ] 用真实 NeuroBook 实例完成设备码申请、网页登录批准和 token 兑换，确认无需手填站点地址。
- [ ] 用独立 smoke 脚本取得实例 token，调用 Bearer API 创建条目、上传测试包并匿名下载校验；不把它描述成客户端发布功能。
- [ ] 首次备份生成恢复码，确认保存后完成本地加密、上传、列表和下载；官方站侧抽查文件无法识别 zip 内容。
- [ ] 在无原本地 key 的隔离实例导入恢复码，完成下载、解密、staging 恢复和内容校验。
- [ ] 覆盖另一实例不导入 key 时无法恢复、导入正确 key 后可恢复、轮换后旧备份仍由历史 key 恢复。
- [ ] 取消关联后验证本地凭据清除但 backup keyring 不被误删，离线写作不受影响。
- [ ] 重启官方站与 NeuroBook 后复验关联状态、refresh token 轮换、备份列表和 active key。
- [ ] 用户明确授权后完成浏览器验收；在此之前 Task 112 保持 Browser acceptance pending。

## Phase 7：发布与收尾

- [ ] 更新两仓 README、接口 reference、部署文档、账号/备份用户文档和正式域名，清理旧仓库名与开发地址残留。
- [ ] 更新 Task 88 / 112 / 119 的被接管 TODO 和最终状态。
- [ ] 更新本 Task 每轮 walkthrough、实施偏差、验证证据和剩余风险。
- [ ] 同步 `PROJECT-STATUS.md`；如产生用户可见版本，按发布规范更新 `RELEASE.md` 与 changelog。
- [ ] 发布包含默认官方站地址和端到端加密备份的 NeuroBook 版本，记录版本/tag。
- [ ] 恢复 DNS 正常 TTL，保留上一镜像和最近部署前同盘快照一个观察周期。
- [ ] 保持邀请码关闭；Public Invite Gate 另行审查，不因私有内测验收自动开放。

## Verification Matrix

| 验证面 | 最低通过证据 |
| --- | --- |
| 可复现构建 | 无 Bun link 的干净 Linux runner 完成 install/typecheck/test/build/image build |
| 健康语义 | liveness 与 readiness 分离；数据库、migration、目录故障可使 readiness 失败 |
| 容器持久化 | 重建后数据库、Workshop zip、备份密文与 keyId 仍可读 |
| Workshop 安全 | 20 MiB / 100 MiB / 500 条目和频率门禁有拒绝用例，zip bomb 不进入完整解压 |
| 全局容量 | 两类文件共同计量；逻辑上限、物理余量、并发和删除释放均有测试 |
| 端到端加密 | 首次上传前强制保存恢复码；官方站无密钥；篡改必失败；正确恢复码可在新实例恢复；无完整明文临时 zip |
| 反代合同 | Cookie Secure；Host/proto/IP 正确；伪造头无效；现有 TLS 代理客户端 IP 与连接不回归 |
| Passport | device pending/approve/poll/token/refresh/revoke 全链通过 |
| Workshop | Bearer API smoke 发布，匿名下载 sha256 一致，不宣称客户端发布 UI |
| Backup | 密文上传/下载 sha256 一致，恢复码导入后隔离恢复可打开 |
| 故障回滚 | 应用镜像、443 配置和部署前同盘数据快照各实际回滚一次 |
| 运维 | 主机重启恢复；磁盘、容量、TLS、readiness 告警可从外部收到 |
| 浏览器 | 仅在用户明确授权后执行并记录；未执行时如实标 pending |

## Risk Register

| 风险 | 影响 | 控制或接受方式 |
| --- | --- | --- |
| 443 切换破坏现有 TLS 代理 | 现有代理中断 | 非 443 预演、配置快照、第二 SSH 会话、真实客户端 smoke、原端口回滚 |
| PROXY protocol 配错 | 现有 TLS 代理/应用只见 loopback 或连接失败 | 两个 upstream 显式接收，限制可信来源，独立网络验证真实 IP |
| Workshop zip bomb / 大 body | OOM、事件循环阻塞、磁盘耗尽 | multipart/解压/条目硬上限、有界解析、频率限制、全局容量门禁 |
| 恢复码丢失 | 云备份永久不可恢复 | 首次确认保存、可认证导出、明确无服务端找回、真实新实例恢复演练 |
| 主密钥或明文泄漏 | 所有相关备份失去机密性 | 本地 secret store、日志红线、流式密文临时文件、官方站只收密文 |
| nonce 重用或 envelope 实现错误 | AES-GCM 安全性失效 | CSPRNG nonce、固定格式、AAD、篡改/截断测试，不自制密码算法 |
| 全局配额并发穿透 | 生产主机根盘写满 | 单实例 reservation、数据库聚合、statfs 余量、流中实测和 507 |
| SQLite 与文件在线备份不一致 | 恢复缺文件或孤儿 | 本任务不做在线站点备份；升级回滚只用停应用后的整目录冷快照 |
| 生产主机磁盘或主机丢失 | 全部站点数据永久丢失 | 私有内测阶段明确接受；不宣称灾备，公开邀请前重新立项异地备份 |
| `nb-ui` 隐式本地依赖 | CI 无法构建 | 锁 Git commit + lockfile，干净 runner 门禁 |
| 生产默认 secret | 管理员账号或 Session 被接管 | 生产 init fail-closed，示例值拒绝，init 与 serve 分离 |

## Rollback Contract

### 应用与数据

1. 停止新写入，记录当前镜像、migration 和冷快照 ID。
2. schema 兼容时切回上一固定镜像；不兼容时停止应用并恢复部署前整个持久目录。
3. 启动后依次验证 readiness、登录、条目下载、授权状态和一份备份密文下载。
4. 同盘快照不能应对生产主机磁盘或主机丢失；发生该事故时本任务没有恢复路径。

### 443

1. 停止 Nginx stream 的 443 listener。
2. 恢复现有 TLS 代理原配置和 443 listener。
3. 恢复原 Nginx 配置并验证 `<生产主机域名>` 与全部既有入口。
4. 官方站 DNS 可暂时保留但必须返回明确不可用，不降级到 HTTP 或临时公网端口。

### DNS

1. 删除或回退 `nbook.notnotype.com` A 记录。
2. 不把 NeuroBook 默认 URL 临时改到 IP、非标准端口或 HTTP。
3. 若默认 URL 已发布，通过恢复官方站或发布新客户端版本修正，不静默改本地凭据。
