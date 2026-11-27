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
| [0029](0029-workspace-packages-publish-source-to-npm.md) | nb-story 与它依赖的 8 个工作区包以源码发布到 npm，只承诺 Bun，内部依赖 `workspace:^`，版本手工管理（nb-story 的平台限制已被 0031 取代；发布清单加 `nb-flock` 见 0052；发布阶段与变更记录见 0053） |
| [0030](0030-plugin-platform-layering.md) | 内核与应用无关（应用名由平台档案传入），第三方插件的通用管理暂留应用的 `src/plugin-platform/` 并按目录机检，作者材料留在应用包的 `plugin-sdk/`（其中 `plugin-platform` 的搬包条件已被 0045 取代） |
| [0031](0031-nb-story-supports-windows.md) | nb-story 支持 Windows：书库锁用 `LockFileEx`，去掉 `os` 限制（Bun 对 `os` 不匹配的包静默跳过安装） |
| [0032](0032-nb-story-keys-from-startup-env.md) | nb-story 的密钥只认进程启动时的环境（shell 导出与 Bun 加载的当前目录 `.env`），OMP 导入时读进来的家目录 `.env` 不算，各命令结论一致 |
| [0033](0033-app-delivered-as-built-npm-package.md) | 新应用发构建产物的 npm 包 `@notnotype/neuro-book`，带前台的 `nbook` 命令；状态根缺省是平台数据目录；一个状态根一个实例，用本地套接字认领；不恢复 Manager，目录包、桌面壳、后台运行与服务器部署另行设计（其中的“包没有依赖”已被 0036 取代，“桌面壳在三者里实测后选”已被 0051 取代） |
| [0034](0034-language-policy.md) | 界面文字与给用户看的失败说明经按插件、按包分的消息目录本地化（i18next）；开发诊断用英文、不本地化；界面按“拥有者命名空间 + 码”取失败文案；给模型的文字：领域提示词中文，新写的基础设施提示词中文，现有英文说明与 OMP 原生错误文本保持原样 |
| [0035](0035-harness-log-driven-kernel.md) | Agent harness 以会话日志为唯一真相源（JSONL、写入批、单写者），循环由内核自写、与服务商通信只用 OMP `streamSimple`，Profile 与插件都是只做归约、反应、视图、拦截的扩展 |
| [0036](0036-app-package-installs-omp.md) | 应用包把 OMP 作为依赖安装、不打进 bundle；服务端入口先拍启动环境、接管 OMP 的进程级处理，再以代码分割加载本体（接管是上游修复前的临时做法） |
| [0037](0037-world-engine-story-change-log.md) | 作者视角的世界引擎以剧情变更日志与修订为真相（计划是没写的变更，修订带版本、可还原），条目由主 MDX 加按 Component 分块的状态组成；随剧情变化的文字整段替换，记账默认生效（其中“包括直接改文件后被读进来的内容”已被 0039 取代，“以后加世界线时换掉位置模块、日志形状不变”已被 0042 取代） |
| [0038](0038-world-engine-entry-text-is-whitelisted-mdx.md) | 世界引擎条目的主文字用 MDX、不复用项目 Markdown 方言，按白名单解释语法树、不执行代码；给 Agent 的渲染用带值写法；作者的编辑界面另找办法（决策 1 与 3 已被 0064 取代） |
| [0039](0039-world-engine-segmented-revision-log.md) | 世界引擎的真相源是 `.nbook/world/log/` 下按 256 KiB 分段的只追加修订日志，打开时在内存里重放、按章留折叠的中间结果，不用数据库；条目不做成文件，第一版不开放经文件改设定；日志不进 nb-history |
| [0040](0040-file-writes-staged-and-committed-by-root-owner.md) | 文件服务不劫持读，写只有一个入口：写入方暂存、拥有根的进程在锁里提交并记账；外部改动由监视与对账发现，History 经文件服务定义的记账槽接入（部分取代项目文件底座提案的“读写都经文件服务”） |
| [0041](0041-world-engine-kernel-mechanisms-plot-plugin-semantics.md) | 世界引擎的内核只加通用机制（条目引用、讲述发生点与标注、在场、时间说法、世界线、决策存储、标注与诊断两个贡献点），知情、伏笔、目标、决策的语义与检查放进剧情插件 |
| [0042](0042-world-engine-worldlines-as-per-line-views.md) | 世界线是每条线一份线性视图、复用现有引擎，日志加线与分叉；计划按写下的先后跨线，哪些线要更新在更新时按值比对（部分取代 0037 的“换掉位置模块”） |
| [0043](0043-world-engine-placement-and-telling-orders.md) | 故事里的事实按安放折叠，读者看到的按当前正文里的讲述算；时间是约束网络算出的范围，不决定折叠 |
| [0044](0044-workbench-single-layout-tree.md) | 工作台除标题栏外是一棵布局树，内容按矩形摆放，工作台拥有摆放、插件拥有内容，布局工具自写并全部收进 `nb-layout`（其中的“取消 ViewContainer”已被 0046 取代） |
| [0045](0045-shared-host-packages-for-second-app.md) | 第二个应用要的宿主底座抽成三个不发布的包：`nb-host`（两端宿主、HTTP 的来源核对、诊断出口，应用名由应用传入）、`nb-models`（模型服务，内置角色与选择顺序共用）、`nb-file-lock`（跨进程锁与加锁替换）；`plugin-platform` 改为出现第二个需要第三方插件的应用时再搬（部分取代 0030 决策 2） |
| [0046](0046-workbench-view-containers.md) | 工作台加回视图容器：三片具名面板当区域的锚，容器归属记在分节自己的记录上、不放在树的分支上，可见只有一个判定，拖动预览不切换容器（部分取代 0044 决策 3）；其中“锚永远不进呈现树”已被 0050 取代 |
| [0047](0047-image-prompt-items-with-numeric-weights.md) | 图像提示词存成每项带数值权重的项序列，不是括号树；一节自成一段、写出一律闭合；展开结果与后端写法分开，由后端适配器写成各自的写法 |
| [0048](0048-image-recipe-sections-and-preset-diffs.md) | 配方按节组织，节的种类由系统定、同种可以有几个；预设挂在节上，是引用加按项的差异，更新预设不改配方文件；风格组合是一组引用；每批存内容快照 |
| [0049](0049-image-store-owns-generated-batches.md) | 生成的图存进本机的应用级仓库 `user://images/`，它是批次的唯一主人；书里存副本、快照、缩略图与 `.image` 插图，靠对账进书；仓库平铺由程序管理，作者在书的目录与收藏夹里整理；上限缺省 40 GB、到上限自动清 |
| [0050](0050-workbench-empty-region-anchor.md) | 空区域由它的锚来画：区域显示着又没有分节时锚进呈现树，整块是落点；被拖空才自动隐藏，这条由布局库在结构操作里保证；区域没有当前容器时落进去的容器就是当前容器（部分取代 0046 决策 1 的“锚永远不进呈现树”） |
| [0051](0051-desktop-shell-electrobun-tag-release.md) | 桌面版用 Electrobun 壳托管随包的 Bun 与服务端，载荷由同一个 npm 应用包组装，状态根与 `nbook` 共用；先做 Windows 的无界面安装包与便携包、不签名；更新只靠 HTTPS、只升不降、下次启动换上；打产品版本标签由 CI 验证后全自动发布 npm 与 GitHub Release（部分取代 0033 决定 6 的三选一实测；发布阶段与 Release 说明见 0053） |
| [0052](0052-non-stale-file-lock-package.md) | 不判旧的文件锁（`flock`、`LockFileEx`，进程退出即放）合成一份，单独成零依赖的包 `nb-flock` 随 nb-story 发布；`nb-file-lock` 仍不发布；按场景选判旧的 `holdLock` 或不判旧的 `tryLock`（补充 0029 决策 6 的发布清单） |
| [0053](0053-release-stages-and-changelog.md) | 发布分 canary、preview、stable 三个阶段，阶段写在 `PRODUCT_STAGE`、不进版本号；第一个稳定版之前只有一条更新线、npm 只发 `latest`；变更记录按发布单元写、不进 npm 包，Release 说明由应用的变更记录在门禁里生成；第一个稳定版时照 omp 改成支线（补充 0029 决定 5、0051 决定 7） |
| [0054](0054-nb-layout-general-library.md) | nb-layout 做成通用布局库：工作台层拆进不发布的 `nb-workbench-layout`，nb-layout 不依赖 nb-ui、失败一种形状、发 MIT 与编译产物；分两档做，手感编排进库与发布排在第二档，第一个外部使用方是 nb-story（部分取代 0044 第 6 条，补充 0029） |
| [0055](0055-input-buffer-entry-states.md) | 输入缓冲区的每条话带状态（就绪、留着），状态由会话级事件归约，回到空闲时剩下的留着、与收口同批写，取与放行只在内核；发出者按调用方盖章（补充 0035 决策 1） |
| [0056](0056-background-work-providers-and-session-notices.md) | 后台工作的清单（`nbook.tasks`）只汇总、状态归各自的提供方；会话的缓冲区收提示（与插话同处取走、排在前面、不进输入的状态机）；唤起的门挂在会话上（补充 0055） |
| [0057](0057-models-ux-sources-identity-egress.md) | 服务商只有一种模板化实例；模型清单由设置、来源缓存与 OMP 元数据合成，发现与缓存自己做；发送前核对实例身份（`origin` 写进日志）；网络出口只选路、不做中继与重定向；角色的默认思考档是一次解析的属性；其中发送前核对的“比源”、部署身份不含凭据与中性身份的名字已被 0058 取代 |
| [0058](0058-models-wire-identity-full-url-and-uid.md) | 发送前核对比完整线地址（路径与查询按协议列白名单），部署身份认实例永不复用的 `uid`，签名型协议另带凭据的 HMAC 身份，中性身份叫 `generic-endpoint`（部分取代 0057 决策 4） |
| [0059](0059-official-site-one-process-split-ready-modules.md) | 官方站第一版一个进程，账号与统计两个模块按能拆成服务的边界写：模块包的依赖白名单、各写各的库、HTTP 合同、“问身份”是 HTTP 端点、黑盒合同测试单独成包 |
| [0060](0060-official-site-identity-on-better-auth.md) | 官方站的账号建在 Better Auth 上；对外合同只有自家路由、标准 OAuth 端点与社交回调，库的端点用精确白名单、私有协议不进合同；账号要邮箱；收紧库的四处默认行为（其中决策 5 第二条已被 0063 取代，决策 1、4 的做法由 0063 细化） |
| [0061](0061-official-site-sqlite-file-per-module.md) | 官方站每个模块一个 SQLite 文件，迁移向后兼容一个版本，合同测试不起数据库容器；需要多副本同时写的模块再单独换 |
| [0062](0062-telemetry-tiers-by-identifiability.md) | 遥测按能不能认出人分五档、不带持久标识、每天一份汇总，开发期原始上报留 7 天；埋点接口由不联网的本机统计插件提供，遥测只读；告知与向导分开，收集清单按档分版本 |
| [0063](0063-official-site-identity-own-routes-library-sessions.md) | 账号的登录、注册、改密码、资料与管理操作由账号模块自己做，Better Auth 只管发会话、认 Cookie 与 t08 的协议部分；自己改密码保留当前会话；库的版本钉死（细化 0060 决策 1、4，部分取代决策 5 第二条） |
| [0064](0064-entry-text-uses-tags-and-the-chapter-parser.md) | 条目的主文字改用标签写法（`<V>`、`<If>`），与章节共用 marked 与同一份 Markdown 配置；给 Agent 的值只给看、交回时去掉；给作者的渲染是源文加值表 |
