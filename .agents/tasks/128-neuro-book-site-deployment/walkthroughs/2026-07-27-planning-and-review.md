# 2026-07-27：立项、只读盘点与计划审查

## 实际完成

- 读取 Task 88、112、119、两仓 Project Status、官方站实现和 Passport / Backup wire spec。
- 通过 SSH 只读确认三台服务器的资源、Docker、容器、端口、Nginx/现有 TLS 代理与公网入口。
- 通过公共 DNS 查询确认三个候选域名均未配置，根域使用 DNS 服务商。
- 确认官方站没有 Dockerfile、Compose、`.dockerignore` 或远端仓库，`nb-ui` Bun link 阻塞干净构建。
- 确认生产主机 443 由现有 TLS 代理 VLESS/TLS 占用，宿主 Nginx具备 stream SNI 分流能力。
- 确认生产主机当前可用磁盘，默认账号配额与无限 Workshop 版本不能形成主机容量边界。
- 确认 Workshop 上传使用 `readMultipartFormData` + `unzipSync`，不是流式有界路径；Task 88 的公网 Gate A 尚未完成。
- 确认 `/api/health` 只是静态 liveness，不能证明数据库、migration 或持久目录可用。
- 确认 NeuroBook 当前只有 Workshop publish scope，没有客户端发布界面或发布 API wrapper。
- 确认云备份包含 `.env` / `config.yaml`，当前归档为 `encryption: "none"`，官方站主存储可读取用户密钥。
- 确认官方站上传事务采用数据库行与文件落盘分阶段补偿，在线分别复制 SQLite 和文件目录不能形成同一时点快照。
- 确认生产 init 缺少环境变量时仍会创建 `admin/admin123456`。

## 服务器增量证据

- 生产主机的 `tailscaled` systemd 单元为 active，但 Tailscale prefs 是 `WantRunning=false`，CLI 返回 backend stopped；当前不能通过 Tailnet 到达测试主机。
- 测试主机的 Tailscale 地址和 SSH listener 存在，但生产主机侧链路未运行。
- 原设想的站点异地备份路径是生产主机经 Tailscale / SSH 把 Restic 加密仓库写到测试主机，而不是 SSHFS/NFS 远程挂载生产目录。
- 用户决定本任务暂不实施站点异地备份，因此没有启动 Tailscale、没有创建账号/目录，也没有修改任何网络配置。
- 现有 TLS 代理当前直接监听公网 443，443 inbound 未接收 PROXY protocol；前置 Nginx stream 后必须同时修改现有 TLS 代理和站点 TLS vhost 的接收合同。

## 用户拍板

- 仓库/服务硬切为 `neuro-book-site`，正式域名使用 `nbook.notnotype.com`。
- 第一里程碑是 owner-only 私有内测，不向外发邀请码；公开邀请另设 Gate。
- Workshop 发布验收降级为 Bearer API smoke，不把 scope 存在误写成客户端发布能力。
- `nb-ui` 首轮锁定 Git commit，不在部署关键路径引入 npm 发包或 CI 隐式 link。
- 云备份必须在 NeuroBook 本地加密后上传；官方站只保存密文。
- 使用随机 256 位 Backup Master Key + 用户自行保管的版本化恢复码，不从 Passport/实例密码派生，也不提供服务端找回。
- 前端第一次备份必须阻塞提醒用户保存恢复码；复制或下载成功并显式确认前不得上传，取消后继续使用同一未确认 key。
- 官方站增加跨 Workshop / Backup 的全局逻辑容量上限与物理磁盘保留空间门禁。
- 本任务不做生产主机官方站数据到测试主机的异地备份；接受生产主机整盘/整机丢失时站点数据不可恢复。
- `neuro-book-site` GitHub 仓库与 GHCR 镜像均公开；生产主机匿名拉取固定 digest，不保存 GitHub pull token。
- owner-only 私有内测不启用 GitHub OAuth，隐藏入口，只使用账号密码登录。
- 用户认可 443 维护流程；实际切换仍需先完成非 443 预演，并在 Phase 4 前确认具体维护时间。
- 其余审查结论全部纳入计划：Workshop Gate A、readiness、生产 init fail-closed、PROXY protocol、任务文档拆分与不存在的 Gate 2 修正。

## 与最初计划的出入

1. `nb-workshop` 已是 Passport / Workshop / Backup 三模块官方站，部署对象不再按单纯 Workshop API 描述。
2. 生产主机不是空白 Docker 主机；443 改造和现有 TLS 代理回归比选择运维面板更关键。
3. 当前源码无法在干净环境复现构建，必须先处理 `nb-ui` 与镜像发布链。
4. 部署服务不会自动闭合 NeuroBook 入口，还需要回填默认站点 URL 并发布客户端版本。
5. 原计划的“Workshop 流式上传”与实现不符，必须先完成有界解析和安全门禁。
6. 原计划只加密生产主机 → 测试主机副本，无法保护生产主机主存储；现改为 NeuroBook 客户端端到端加密。
7. 原计划用账号配额和告警保护主机磁盘，不能阻止多账号或 Workshop 写满；现增加全局硬限制。
8. 原计划要求站点异地恢复，用户本轮明确取消；Task 不再宣称灾难恢复能力。
9. README 原有 300 余行混合计划和流水记录；现把执行计划与本轮证据分别拆入独立文件。

本轮只修改规划文档，没有修改业务代码、服务器、DNS、GitHub OAuth、远端仓库或浏览器状态。
