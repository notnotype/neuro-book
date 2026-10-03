# 应用运行时的产品装配与贯通验证

## 状态与归属

- **2026-09-28 部分替代**：后端启动（S0）与 HTTP 入口改由[可扩展应用平台设计](extensible-application-platform.md#p6-服务端宿主内核拥有进程)的“内核拥有进程”方案承担；其余阶段待按该设计复核后再更新本文。决定依据见 [ADR 0022](../adr/0022-extensible-platform-and-plugin-trust.md)。
- 状态：`reviewing`（产品装配细化）；基础方向及 Lab → Files → Settings → World/Plot 顺序已在[总提案](application-runtime-and-plugins.md)接受，本文不扩大实现授权。
- 2026-09-26 从总提案拆出 B/S Tracer Bullet 专题；保留 2026-09-20 调查基线及未实现目标，不把拆分当作重新验收。文中的“主树／w00003”均指当时证据，当前执行快照见 [w00017](../../../../.agents/works/w00017-application-runtime-architecture/README.md)。
- 本文只拥有跨进程启动、Project ready、工作面构造与领域贡献的接入设计；资源机制见[总提案生命周期矩阵](application-runtime-and-plugins.md#生命周期矩阵)，第一版 Files 产品策略见[独立设计](files-explorer.md)，行为合同见[规范注册表](../../../../docs/specs/README.md)。
- 不改变持久数据、迁移政策、鉴权或真实 Provider 授权；本文的验证项是未来门禁，不是已经运行的结果。总体数据/安全/迁移与回滚影响见[总提案](application-runtime-and-plugins.md#数据接口安全迁移发布与回滚影响)。

## 问题、目标与非目标

问题是产品入口仍自行编排服务与资源，局部运行时验证不等于真实页面已完成切换。目标是用一条真实路径验证启动、身份、Project、View、文件及关闭的所有权，再推广到 Settings 与领域入口；不先迁完所有应用服务，不改变框架、用户数据格式或引入外部插件市场。

选择纵向贯通而不是先横向迁移全部服务：前者能尽早暴露真实消费者缺口；只给现有页面加 Plugin 包装则保留隐式依赖和双 owner，不能证明装配替换。阶段和反例见下文；详细工程任务仍归 Work，不在此预建任务链。

## B/S Tracer Bullet：从进程启动到领域工具

Tracer Bullet 指**用一条真实、最薄的端到端路径检验架构**，不是把全部框架写完才接页面。本节是该路径的设计，还没有运行新装配。基线为浏览器访问已启动的长期后端，前端维持现有客户端渲染；首次裸 `/` 进入项目选择，带明确 Project 意图的深链跳过选择，但经过同一身份/打开/绑定门禁。本文 `plotbench` 是现有 `server/plot` 与 Plot 工作面的候选插件 id，不宣称仓库已有同名目录。

### 现状锚点与目标差异

| 范围 | 源码证据 | 目标切口 |
|---|---|---|
| 主树后端 | [product-startup.ts](../../server/runtime/product-startup.ts) 先作 State Root 只读完整性检查/告警，再检查迁移并取得 Store 租约；[项目列表](../../server/api/projects/index.get.ts) 只读轻量目录快照 | 分出进程启动与目录服务，列表不激活 Project；检查与必需门禁均保留，不在 HTTP 首次调用中另起第二 owner |
| w00003 前端 | `app/plugins/storage-migration.client.ts` 先保护旧桶；`pages/index.vue:2228` 打开 Project 后恢复编辑记录；`:2777` 在 mounted 发起引导 | 页面拥有的启动、命令、会话、订阅编排移入浏览器 composition root；UI 只表达路由意图与呈现状态 |
| w00003 Grid/View | `WorkbenchShellLayout.vue` 测量 → projectShell → createShellGrid → GridRenderer；`WorkbenchViewInstances.vue` 在容器外持有实例并 Teleport | 保留布局算法与实例/落点分离，替换贡献来源，不把布局引擎改成插件加载器 |
| 主树领域 | [server/plot/index.ts](../../server/plot/index.ts) 的 lazy `plot-world` 同时创建 World/Plot，Plot 构造注入 World，关闭先 Plot 后 World | 分离为两个领域入口与单向依赖，替换所有 HTTP/tool/UI 调用方，不保留旧复合模块和新入口双 owner |
| 主树数据库与工具 | [Project 数据布局](../../server/workspace-files/project-workspace.ts) 同库；[World 工具](../../server/agent/tools/world-engine-tools.ts) 与 [Plot 工具](../../server/agent/tools/plot-tools.ts) 通过同一模块取服务 | 数据库文件不拆；工具改为贡献与调用时激活，既有 Profile 策略不被 DI 绕过 |

Nuxt 框架阶段依[官方客户端生命周期](https://nuxt.com/docs/4.x/guide/concepts/nuxt-lifecycle#client-lifecycle)：app plugins → 路由校验/middleware → Vue mount（根/页面 setup）→ mounted。框架 hook 不是新的产品生命周期真相源；注册表已存在，但尚未形成本文的统一产品装配。

### 一条链的阶段、组件与就绪条件

| 阶段 | 谁负责初始化什么 | 本阶段输出 / 允许行为 | 尚未启动什么 |
|---|---|---|---|
| S0 启动后端 | 启动适配器解析 image/State/Cache 根与安全启动配置，创建后端 scope；校验静态清单；platform-files / sqlite 提供只读检查能力，保留 State Root 完整性检查/告警，再完成迁移门禁，初始化身份、configuration 核心、project-directory、session-persistence 等必需服务 | Store 租约有效、必需服务就绪才开放业务接纳；HTTP adapter 共享同一 ready 结果，诊断从最早阶段可用 | 无任何 Project 代次、World/Plot 实例或 View；不自动迁移用户数据、不调用模型 |
| S1 输入 URL | 浏览器取 HTML/JS；Nuxt client plugin 建浏览器 scope 和客户端清单，初始化本地主题/语言/错误呈现与协议客户端；沿既有合同先保护旧本地数据 | 可呈现启动/错误壳；app middleware 通过身份代理完成登录判定，根组件挂载 | 不访问真实 Project 数据；只装配本窗口能力，不创建服务器对象 |
| S2 项目选择 | 身份确定后，bootstrap 并行请求用户级 config 与项目目录；分别由 configuration / project-directory 处理；页面订阅结果 | 项目列表可选；主题/语言应用有效值；一项失败不隐藏另一项成功，未成功列表不显示“没有项目” | 不开 Project DB、不扫描作品全文、不激活 World/Plot、不启动 Agent Job |
| S3 用户打开项目 | 工作台控制器建立一次带意图代次的打开操作；后端 project-runtime 校验访问、根与占用、建立 Project scope，启动该清单必需的 Project 资源；前端接匹配的 ready/presence | 获取精确 Project 代次的本地代理与访问绑定，才开放数据操作；旧意图迟到只释放自己的绑定 | 不因 Project ready 就激活全部领域插件或打开所有 View |
| S4 恢复工作面 | workbench-host 取得适用的 View/Editor/命令目录、Project 配置及布局/编辑状态；解析存储的 id，构造 Grid 拓扑并挂载容器 | Grid 尺寸和落点可用；恢复计划中的可见 View/编辑器可请求工厂；未知/失败贡献单独呈现 | 未显示且无其它消费者的 World/Plot 不激活；不把持久布局数据当可执行模块路径 |
| S5 Files 首条链 | files-view 激活浏览器入口，取得 workspace-files 代理、刷新命令与 Storage 句柄；后端文件入口绑定同一 Project，提供列表和事件 | 真实文件树显示、刷新走同一命令、展开状态可恢复；释放窗口绑定不关其它窗口的文件服务 | 不需 World/Plot；Files View 销毁只释放自己的订阅和贡献 |
| S6 World/Plot 按需 | 用户打开对应工作面，或 Agent 调用其领域工具；各自入口按下面贡献表激活，取得 Project 资源 | 工厂/处理器在成功提交后可用；同一 Project 内并发首次消费共享激活；各窗口 View 独立 | Agent 消费不启动 Vue；View 打开不启动 Agent Job；基础读取不要求 Provider |
| S7 切换/退出 | 切换先协商 dirty/在途工作，释放窗口工作面、订阅和 presence；显式关闭 Project 由后端 owner 处理所有借用者；停机撤接纳并 drain | 旧代次不可使用；无关窗口与后台任务继续按其 owner 生命周期运行；终止失败可诊断 | 浏览器断开不等于关闭共享后端；强制退出不伪报保存成功 |

S0 的 sqlite ready 表示“资源提供者可申请”，不等于所有连接已打开；身份若需要应用库，只开应用库。迁移门禁为检查，不把初始化插件当未经批准的数据迁移入口。框架可以先监听端口，但业务请求必须经过接纳门禁；启动失败与静态页面是否可返回是两件事。

State Root 完整性检查不是本文新发明的拒绝门禁：当前 `product-startup.ts:40-52` 对影子 Workspace/检查错误只 `appLogger.warn`，随后继续迁移检查；没有在该分支 throw/return。目标保留只读检查与可见告警，不自动合并/删除数据，也不借架构重构把现有告警擅自升级为禁止启动。若要改变这一数据安全策略，需要单独取舍。

S1 的内置主题/语言能在网络配置前显示，S2 的服务端快照才是用户设置权威。新 bootstrap 不再由多个主题/编辑器组件各自重复发全量请求：同一身份/配置目标共享一次读取，身份变更撤销旧结果；不是永久缓存所有 Project 配置。当前 w00003 的主题 Nuxt plugin 在路由鉴权前请求 config 是待调整接线，本文目标要求受保护快照在身份确定后读取，不能依赖“插件先执行”绕过服务端授权。

### 项目选择页究竟依赖什么

| 请求 / 能力 | 当前入口与目标服务 | 最小资源依赖 | 明确不依赖 |
|---|---|---|---|
| 身份 | `/api/auth/me` → identity-access | 固定启动安全策略、身份持久数据；请求身份 | 可扩展用户设置、打开 Project、View |
| 用户启动配置 | `/api/config/bootstrap?workspaceKind=user-assets` → configuration | 已登记设置定义、用户资产配置文件、身份授权；返回裁剪后的安全快照 | Project ready、世界日历、领域插件激活、真实模型调用 |
| 项目列表 | `/api/projects` → project-directory | Workspace 目录及 manifest 轻量索引、访问过滤 | Project DB、完整文件树、Agent Session、World/Plot |
| 打开 / presence | `/api/projects/open`、`/api/projects/presence` → project-runtime | 目录定位、授权、占用、该代必需资源；presence 只建立使用关系 | 已恢复的布局、已渲染的 Grid、领域 View |
| 项目设置 | configuration 的 Project 入口 | 用户设置 + 已授权的精确 Project 绑定及其配置文件 | 先启动所有声明设置的领域服务 |

`config/bootstrap` 在主树和共享树均已存在，响应细节以各树的 Config 合同为准；不新建聚合 `/api/bootstrap` 或平行 Config API。Config 定义随插件纯描述登记，即使设置页是第一次消费，也不必启动 World 数据库。设置的 scope、默认值、schema、是否秘密、何时生效/是否需重启由该定义声明；本轮不发明尚无需求的新设置键。

#### S3 的必需资源与防循环约束

当前主树 required 顺序是 `database → history → file-index`，lazy 为 `plot-world` / `agent-sql`；共享树另有 lazy Storage。目标首条链保留这三个必需资源的结果门禁，但不要求保留现有 `globalThis` 注册表或硬编码名称数组。

Project owner 先取得占用与已校验根，建立 **opening 上下文**（精确代次、受限根、取消信号、资源登记入口），再创建数据库/历史/索引资源。工厂在接触 I/O 前交出可收口资源，必需资源 ready 后才发布 Project ready 与外部 workspace-files/Storage 数据面。历史和索引的内部资源准备不调用对外的“必须 ready”接口；它们也不能从 opening 上下文伪造可交给普通调用者的 ready 句柄。

Config 需切开真实的源码环：目前 `config-service → project-session → project-history → config-service`。目标将配置合并/受限文件读取留在 configuration 核心（不依赖 Project），Project owner 授予的 opening 上下文可读取本次根的配置快照供 history 初始化；Config HTTP 的 Project 目标解析另放适配层，仍要求已授权的 ready 代次。这样 `Project → 历史资源 → 配置核心` 不再返回 Project，也不复制第二套合并规则或移除外部授权门禁。

还需切开 Agent 方向：现有 `config-service` 静态导入 `agent/http`，若干 Profile 设置入口用 `useAgentHarness().profiles` 作默认参数；反向的 model-resolver/Harness 又读配置，部分用动态 import 回避静态环。当前 `readConfigBootstrap` 并不调用这些 Profile 默认参数，不能把所有 bootstrap 读取都说成已启动 Harness；但目标也不能保留这条隐式依赖。配置核心只保留纯定义、合并与受限文件读取；Profile 设置适配显式接收独立 Catalog 入口，Catalog 可以消费配置核心/编译能力，但不能反向消费该设置适配或构造 Harness。模型配置纯数据由 Agent 消费，`agent-runtime → configuration 核心` 明列依赖；S0/S2 基础配置不解析完整 Profile 目录。沿用既有 Config API，迁移现有默认参数调用点，不复制第二套 Profile 设置规则。

这里的“必需资源”包括现有 Project DB 的初始化检查与历史/文件索引，不包含 World/Plot 的领域激活。同一数据库中存在 World 表不代表 World 插件已激活；第一批不改现有建表与兼容策略。变更持久格式、自动迁移策略或现有 grace 数值都不由这次装配重构默许。

内部工厂的服务边也进入依赖图：数据库资源工厂消费 sqlite；历史资源工厂消费 sqlite、platform-files、configuration 核心；文件索引工厂消费 platform-files 与历史记录能力；三者在 opening scope 构造。`workspace-files` 的对外访问入口则消费已发布的 Project 绑定和该索引，不反向参与 ready 等待。工厂可由相应插件描述登记，但登记不实例化、不等待 Project，避免用“工厂”名字隐藏真实依赖。

### Grid 与 View 的实际构造顺序

1. 浏览器清单登记受信 View/Editor 描述（id、标题、容器偏好、when/authority、工厂引用）；描述可登记但实现未激活。服务端能力可用性与客户端声明取交集，不把前端包里存在代码当后端已安装；发布按同一产品清单构建，客户端旧清单产生的调用由服务端再次拒绝。
2. workbench-host 在绑定后读取布局/编辑记录，按描述目录验证 id、位置与可用性；缺失贡献保留可诊断引用，不能执行存储里的任意 import。项目选择期可以先显示空壳，不等 Project 才允许渲染所有 Chrome。
3. 既有 `projectShell/createShellGrid` 计算拓扑与尺寸，`GridRenderer` 建标题栏、活动栏、侧栏、编辑区、面板、状态栏容器。Grid 负责几何；插件贡献 View，不直接改 Grid 节点或接管整个页面。
4. View Host 按恢复/用户意图激活需要的浏览器入口，再调用其工厂创建 View 实例；实例由 Host 持有，在容器外管理并 Teleport 到可用落点。移动容器不重建领域服务，也不把 factory 的 import 成功当组件 ready。
5. Editor Host 取得文档模型并等待句柄 ready；布局完成、View ready、文档恢复是独立结果。World 专用对话工作面仍可走有 owner 的工作面工厂，不强行塞入侧栏；Plot 的面板按实际 UI 合同贡献。

### WorldEngine 与 Plotbench 如何成为真正的插件

下表固定提供/消费的**设计边界**，不是已经存在的 manifest API。插件有同一个分发 id，但浏览器入口、后端 Project 入口、操作级适配分别激活。每个入口只能获得声明的服务与目标 scope；不能用插件 id 随意取得任意根或数据库。

| 贡献 / 资源 | WorldEngine | Plotbench | 接收者与时机 |
|---|---|---|---|
| 设置定义 | 声明自身有实际需求的设置；已有 embedding 使用共用定义，不复制一套凭据；项目 `schema/index.ts` 与 `calendar.ts` 是领域文件而非通用设置 | 目前主要读取 Project manifest；可贡献未来有明确需求的设置，不为“插件必须有配置”造空配置 | configuration 在描述登记期接收 schema/default/scope/秘密标记/生效条件；激活时取有效值 |
| UI | World 工作面工厂、打开命令、必要的面板贡献 | Plot 面板/工作面、命令与 World 跳转 | workbench-host / command-system 收描述；打开才激活浏览器入口，UI 通过 HTTP 代理取数据 |
| 领域工具 | 既有 `execute_world` 描述、schema 与上下文处理器 | 既有 Plot 读写工具组及对应领域处理器 | agent-tool-catalog 收纯描述与 owner/激活入口；Agent 执行时按 Profile 权限、目标代次与写入政策过滤，再激活后端入口 |
| SQLite | WorldSubject / WorldSlice / WorldPatch 的领域 repository 与迁移定义 | Story 等 Plot 表的 repository 与迁移定义 | 仍映射 `.nbook/project.sqlite`；Project 代次内唯一 database 资源 owner 经 sqlite 申请并登记全部连接、协调迁移；领域只归还自己的借用 |
| 文件与编译 | `world-engine/schema/index.ts`、`world-engine/calendar.ts` 及编译缓存；声明所需路径范围和读写权限 | 作品文件索引、正文关联及历史写入 | workspace-files 提供领域文件能力；artifact-compiler 使用显式 Source/Product 身份；不把任意项目脚本直接 import 到客户端 |
| 其它服务 | 语义搜索操作按需取 embedding，未启用时该操作不可用；基础查询不被拖死 | 明确消费 World 的身份/时间/状态查询，以及 history-trace 的记录入口 | 跨插件取服务合同，不 import 另一个插件的入口；若必要依赖缺失，只阻断相关闭包 |

**一次真实领域工具调用的目标路径：**Agent 选 `execute_world` → 既有工具执行政策验证 Profile/参数/读写模式 → 固定精确 Project 与操作身份 → 工具目录激活 World 后端入口 → 取得受管数据库、领域文件、配置/编译能力 → 执行同一领域服务 → 结果回到原工具通道 → 结束此次操作借用。UI 的 HTTP 调用经过请求鉴权后汇入同一领域服务；不绕道前端命令注册表，更不依赖打开 World View。写入已发生但连接断开时仍按原领域结果未知/恢复规则处理。

**无插件时工具不能只是隐藏按钮（目标要求）：**安装清单不提供 World/Plot，就不向可选工具集合公布它们；Profile 显式要求缺失工具时，给出能力诊断并拒绝该 Profile 的执行，不能偷偷缩减合同。当前 `neuro-agent-harness.ts` 的 `toolOverrides()` 对解析不到的工具直接跳过，尚无本文要求的调用前拒绝机制；接入 agent-tool-catalog 时必须一并迁移，而非只改菜单。已运行任务的工具快照与借用持续有效到正常终止；首批不在运行中改变清单。能力发现与最终执行都检查后端权威状态，浏览器提供的插件 id 不构成授权。

当前 World schema 缺失可返回空 schema，calendar 缺失对需要它的操作报错；Plot 的部分时间展示已有降级。拆入口时保留这些具体领域语义，不统一改成“整个插件成功/失败”。当前 World/Plot 共用 lazy 模块、分别持有 libsql/Prisma 连接是现状，不是单一连接池；目标是先明确物理资源 owner，不以插件化名义拆库或重建表。

World 工作面的 subject RAG 是另一个真实依赖：现有 subject-memory/RAG 工具链拥有 `.nbook/subject-rag.sqlite` 与 subjects 文件，不归 plot-world 的表。目标由 `subject-memory-rag` 入口适配既有 owner，World 的 RAG 面板声明可选消费：缺失时仅该面板明确不可用，World 核心仍能运行；不静默转用另一个库，也不把整个 Agent Runtime 变成 World 基础查询前置。

### 最小贯通验证与反例

在已接受的 Lab → Files → Settings 顺序内，先交付 S0–S5：启动 → 选择项目 → 打开 → 真实 Files/View/刷新/Storage → 关闭绑定；再在同一运行时打开用户级 Settings、切换 Project 后确认设置服务与值未重建丢失。World/Plot 的 S6 是第三条领域验证，不越过前两条抢先搭通用插件市场。

- 无 World/Plot 清单仍可完成 S0–S5；只给 Plot 不给 World 能定位缺依赖，不导致基础 Files 消失。
- 两浏览器打开同一 Project，共享后端领域激活而各有 View；一方退出不关闭另一方或 Job 所借用的服务。
- 并发 World HTTP/tool 首次消费只激活一次；编译/数据库失败撤回本次资源，不制造半个可调用 handler；Files 仍可用。
- 恢复记录中有缺失插件 View，Grid 可用且明确说明该 View 不可用；不删正文/领域表，不因错误 import 执行未登记代码。
- dirty 否决切换保持原工作面；打开新 Project 的迟到回调不能发布到旧/新错误代次；服务器在写入完成后断线，不由通用代理重放。
- S0 任一必需门禁失败不接纳业务；S2 config/list 单独失败可见且可重试；S3 必需 Project 资源失败撤回本次打开、释放可释放的占用，失败资源保持诊断；S4/S6 的可选贡献失败不倒逼其它 Project/功能退出。

## 对 Spec 的预期改动

基础运行时七项 Spec 不因拆文档重写。Files 行为只进入现有 [workspace.files](../../../../docs/specs/workspace/files.md) 与 [workbench.files-explorer](../../../../docs/specs/workbench/files-explorer.md)；命令、Storage、Workbench 和 Lab 继续原位修订。Project、配置、文档会话及领域完整合同仍需在首次接入时明确，本文不能替代它们或将其整体标为已实现。

## 决策记录

| 日期 | 决策者与结论 |
|---|---|
| 2026-09-20 | 开发者要求补 B/S 启动示踪链及 World/Plot 插件接入设计；接受基础切片后按 Lab → Files → Settings → World/Plot 推进。产品装配细化保留评审边界，未一次授权全部实现。 |
| 2026-09-26 | 开发者要求拆分膨胀的总提案并治理相关文档；本专题从原文迁出，原调查依据和未验证状态不变，无新增产品行为或实现授权。 |

