# 架构决策记录

`docs/adr/` 保存已接受且需要长期解释的架构、协议、所有权和安全决策。ADR 解释“为什么”，完整可观察行为仍由 [`../specs/README.md`](../specs/README.md) 登记的当前规范定义。

文件名使用 `NNNN-kebab-case.md`；编号唯一，一级标题中的编号必须与文件名一致。新决策使用下一个空闲编号，不复用已归档或已撤销编号。ADR 接受后正文不改，只能被新的 ADR 取代；被取代的 ADR 保留原文件，在 frontmatter 记录状态与取代者。只取代旧 ADR 的一部分时，旧 ADR 保持 `accepted`、正文不改；新 ADR 头部写“部分取代：<旧 ADR> <哪一项>；其余决定不变”，索引里旧 ADR 那一行补注“其中的 X 已被 NNNN 取代”（先例：0028、0031）。

每份 ADR 以 frontmatter 开头，状态只写在这里，正文不写“状态”行：

```yaml
---
schema: nbook.adr/v1
status: accepted         # accepted | superseded
decided: 2026-10-07      # 开发者作出决定的日期
superseded-by: null      # superseded 时填取代它的 ADR，写仓库根相对路径
---
```

`bun run docs:check` 核对 `schema` 与 `status` 的取值、`decided` 必填，以及 `superseded` 必须有 `superseded-by`。

ADR 0001–0021 是旧应用的决策，随旧包留在 [`../../packages/neuro-book-legacy/docs/adr/`](../../packages/neuro-book-legacy/docs/adr/README.md)，只作参照；编号从 0022 起在本目录延续。

| 编号 | 决策 |
|---|---|
| [0022](0022-extensible-platform-and-plugin-trust.md) | 可扩展应用平台与第一版插件信任模型 |
| [0023](0023-v2-frontend-backend-stack.md) | NeuroBook v2 去掉 Nuxt，前端 Vue + Vite，后端 Bun + Hono，校验统一 TypeBox（其中的 UnoCSS 已被 0028 取代，vue-i18n 已被 0034 取代） |
| [0024](0024-multi-instance-runtime-topology.md) | 多实例运行时拓扑：项目子进程、内核路由的远程服务与专用 RPC 端口 |
| [0025](0025-service-keys-by-id.md) | 服务键按服务 id 识别，插件之间可引用对方的合同模块（已被 0026 取代） |
| [0026](0026-plugin-definitions-as-constants.md) | 插件定义是常量，宿主的东西走宿主能力服务；沿用 0025 的服务 id 与合同模块约定 |
| [0027](0027-builtin-and-third-party-plugins-are-equal.md) | 内置插件与第三方插件能力相同，信任所有插件：删除代理允许清单，内部服务对所有插件开放 |
| [0028](0028-tailwind-only-host-compiles-nb-ui.md) | 全仓只用 Tailwind v4 一套原子 CSS 引擎，nb-ui 不发预编译产物，宿主编译 nb-ui 源码并按 Tailwind 标准分层 |
| [0029](0029-workspace-packages-publish-source-to-npm.md) | nb-story 与它依赖的 8 个工作区包以源码发布到 npm，只承诺 Bun，内部依赖 `workspace:^`，版本手工管理（nb-story 的平台限制已被 0031 取代） |
| [0030](0030-plugin-platform-layering.md) | 内核与应用无关（应用名由平台档案传入），第三方插件的通用管理暂留应用的 `src/plugin-platform/` 并按目录机检，作者材料留在应用包的 `plugin-sdk/` |
| [0031](0031-nb-story-supports-windows.md) | nb-story 支持 Windows：书库锁用 `LockFileEx`，去掉 `os` 限制（Bun 对 `os` 不匹配的包静默跳过安装） |
| [0032](0032-nb-story-keys-from-startup-env.md) | nb-story 的密钥只认进程启动时的环境（shell 导出与 Bun 加载的当前目录 `.env`），OMP 导入时读进来的家目录 `.env` 不算，各命令结论一致 |
| [0033](0033-app-delivered-as-built-npm-package.md) | 新应用发构建产物的 npm 包 `@notnotype/neuro-book`，带前台的 `nbook` 命令；状态根缺省是平台数据目录；一个状态根一个实例，用本地套接字认领；不恢复 Manager，目录包、桌面壳、后台运行与服务器部署另行设计 |
| [0034](0034-language-policy.md) | 界面文字与给用户看的失败说明经按插件、按包分的消息目录本地化（i18next）；开发诊断用英文、不本地化；界面按“拥有者命名空间 + 码”取失败文案；给模型的文字：领域提示词中文，新写的基础设施提示词中文，现有英文说明与 OMP 原生错误文本保持原样 |
| [0035](0035-harness-log-driven-kernel.md) | Agent harness 以会话日志为唯一真相源（JSONL、写入批、单写者），循环由内核自写、与服务商通信只用 OMP `streamSimple`，Profile 与插件都是只做归约、反应、视图、拦截的扩展 |
