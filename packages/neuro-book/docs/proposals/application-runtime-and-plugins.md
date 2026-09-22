# 应用运行时、生命周期与内置插件架构

## 状态

- 状态：`accepted`（基础架构与分段推进方向）；本次修订：2026-09-20。后续任意热卸载/升级机制仍仅为评估，不在接受范围。
- 本轮产物：总体架构提案、能力地图、生命周期划分、模块代码布局、B/S Tracer Bullet（贯通真实使用链路的设计）及内置插件划分。集中维护，不另设重复正文。
- **已确认方向**：Lab 只承担组件展示；生命周期按运行位置与资源作用域设计；允许重构现有前后端。这些方向继续有效，不等于批准全部具体机制。
- **三项已批准取舍**：A1，必需服务也以插件提供，首批随产品发布且不做任意热卸载；A2，显式关闭先处理 dirty/在途操作，强制退出不保证保存，窗口离开不自动关闭后台共享资源；A3，先收回 Lab 产品宿主，再验证 Files、Settings 两条真实链路。
- **本轮接受与授权**：开发者明确第一实现切片止于环境适配入口和小内核，第二以内置服务插件验证，再按外部插件作者视角推进 Lab → Files → Settings → World/Plot；授权先落前两片 Spec、整体实施路径、Work 与 Task。代码布局是实施规划，不是对外包承诺；本轮不执行产品实现、worktree 创建、提交或远端操作。
- 本文不是当前行为 Spec。前两片目标已分别沉淀为七项 `planned` 合同，见[规范注册表](../../../../docs/specs/README.md)；已有 `implemented` 合同在各条真实链完成切换前继续有效。未做的 Desktop/Worker 适配、领域迁移细节与热卸载扩展不冒称已实现或已完整批准。

## 问题

产品需要回答“某项能力来自哪里、依赖什么、何时可用、由谁释放”，目前这些答案分散在页面装配、框架插件、单例和领域生命周期中。继续往页面或 LabShell 增加注册与清理，会使功能隐式依赖特定组件树，并让页面退出、Project 关闭、后台任务结束和后端停机互相混淆。

本次不是把所有文件改名为 Plugin，也不是只加一个依赖注入容器。目标是建立能承载内置功能的共同装配机制：同一能力有明确提供者；每个资源有明确 owner；用户操作有可观察的就绪、失败和结束结果。

## 目标与非目标

### 目标

1. 用小内核与显式服务依赖装配不同运行环境；命令、配置、Storage、Project 和工作台等尽可能由内置插件提供。
2. 分开描述运行位置、资源作用域、激活条件、界面实例和持久数据；统一管理机制，不强行统一所有领域状态机。
3. 使新增内置功能通过受控清单、依赖和贡献接入，不要求编辑主页面的初始化与清理流程。
4. 明确多窗口、Project 换代、部分初始化失败、断线、崩溃和关闭的边界；不能把后台任务或数据寿命绑定到某个面板。
5. Component Lab 不再默认注入产品命令、Storage 或插件运行时；组件展示与产品集成验收分开。
6. 让未来 Spec 有独立验收边界和唯一 owner，设计可据以评审，而不是依赖口头补充。

### 非目标

- 本轮不修改产品、Lab fixture、持久化格式、CI、依赖或安装链；不实施数据迁移。
- 不提供第三方不可信代码加载、市场、动态安装、签名、恶意代码沙箱或公开 SDK 兼容承诺。
- 不替换 Vue、Nuxt、Nitro、桌面 Envelope 或 Manager；先将它们视为环境适配边界。是否替换属于另一个决定。
- 不把普通组件、工具函数、每个数据库对象都改成插件；不把 Profile、Skill、Workflow 资产自动等同于可执行应用插件。
- 不以“可以重构”为由更改未保存内容、身份授权、Provider 副作用、数据删除或任务恢复策略。

## 当前行为与证据

### 证据分层

本文依据源码阅读，不声称本轮运行过应用或故障实验。文档写入主工作区 `master`；其调查基线 HEAD 为 `45906272915ff43e83318653af62afa9ce668206`。另参考 w00003 共享实现树：`refactor/w00003-nb-ui-adoption`，HEAD 为 `26479d48604d3882b8d42b9f4447c6e3f4ac69c4` **加未提交改动**，不是一个可独立复现的提交版本。

| 证据范围 | 已从源码确认的事实 | 对设计的意义 |
|---|---|---|
| 主树：[启动门禁](../../server/runtime/product-startup.ts)、[请求门禁](../../server/middleware/00-product-startup.ts) | 后端请求等待共享启动结果；迁移与 Session Store 租约有先后要求 | 新装配不能把“端口已监听”当“业务已经可用” |
| 主树：[关闭编排](../../server/runtime/shutdown/product-shutdown.ts)、[关闭控制器](../../server/runtime/shutdown/product-shutdown-controller.ts) | 已有 HTTP drain、幂等关闭和错误聚合 | 可以替换实现，但新设计必须明确在途操作与依赖释放顺序 |
| 主树：[Project 前端控制器](../../app/composables/useProjectSession.ts) | 标签页释放 presence 不等于全局关闭 Project | 使用关系不是所有权；前后端不能共享一个生命周期开关 |
| w00003树中的w00016交付：`app/component-lab/LabShell.vue`、`app/composables/useWorkbenchCommands.ts` | LabShell provide 同一命令宿主给后代，常驻面板与 window 快捷键；局部 fixture 注册编辑器命令 | 这是w00016命令底座与Lab闭环的已验收批次；A3要求在后续Lab切片明确替代全局宿主，不把它当无主遗留 |
| w00003：`app/pages/index.vue`、`app/utils/workbench/product-catalog.ts`、`view-factories.ts` | 主页面已装配命令和第一方 View，不再只有 Lab 消费命令 | 不能用早期“尚无 View/命令注册表”的研究结论描述当前共享树 |
| w00003：`server/workspace-files/project-module.ts`、`server/storage/project-storage-module.ts` | 已有 required/lazy Project Module、代次快照与 ready/close；Storage 按精确代次撤销访问 | 是现存的生命周期实现，不是零基础；允许按新合同重构，而非必须保留原类 |
| w00003：`server/storage/product-definitions.ts`、`app/utils/workbench/storage-context.ts` | 已有 Storage 定义与上下文；配置仍为独立领域服务 | 集成不应复制第二套状态真相源，也不能声称配置已是开放 schema Registry |

w00003 表中的路径均相对该树的 `packages/neuro-book/`，不是主树实现声明；本文不使用临时 checkout 的相对超链接作为长期产品文档入口。实现阶段必须重新定位合入后的 canonical 文件。

### 既有研究如何使用

[VS Code 启动与 DI](../research/vscode/01-modules-bootstrap-di.md)、[运行位置](../research/vscode/02-hosts-web-remote-server.md)、[扩展登记与激活](../research/vscode/07-extension-system-deep-dive.md)支持借鉴“声明先登记、能力按需激活、依赖与关闭受管理”的机制；其 NeuroBook 映射是研究快照，不是当前产品事实或批准依据。

[扩展控制面研究](../research/vscode/13-extension-control-plane-refactor.md)主张领域 Catalog 保留所有权。本文比只读联邦快照更进一步，建议管理应用模块装配，但不把 Profile 编译、Workflow 执行、Job durable truth 合并成一份插件状态。也不沿用混义的 L1/L2/L3 数字来表示插件开放度、命令层级和验证层次。

## 方案、备选方案和取舍

### 总体方案

```text
环境适配入口（浏览器 / 后端 / 桌面 / 受管 Worker）
    ↓ 选择产品装配清单、建立运行实例
小内核（作用域、依赖解析、激活与资源归属）
    ↓ 创建明确的服务提供者与贡献接收者
内置服务插件（命令、Storage、配置、Project、UI 宿主等）
    ↓ 提供窄能力接口
内置功能插件（文件、编辑支持、角色、情节、Agent 界面等）
    ↓ 创建具体 View / Editor / 请求 / 任务运行实例
```

箭头表示装配层次，不表示前端可直接取得后端内存对象。功能只消费声明的服务合同；组件通过 props、事件或明确的宿主接口工作，不取得全局万能容器。

| 方案 | 后果与代价 | 判断 |
|---|---|---|
| 仅增加 DI，保留页面手写注册与清理 | 解决构造依赖，但贡献、激活、退出仍散落，Lab 与页面继续承担装配 | 不足以满足目标 |
| 小内核 + 显式 DI + 受信内置插件 | 能把资源与贡献归属统一；须定义依赖寿命、失败和关闭语义 | **推荐** |
| 直接建设通用第三方元框架 | 同时背负安装、兼容、权限、隔离与分发成本 | 本批不采用；内部接口不冒称未来外部 API 可原样复用 |

### 术语

| 术语 | 本文含义 | 不等于 |
|---|---|---|
| 运行位置 | 执行代码的浏览器 JS 环境、后端进程、桌面进程或 Worker | Project、Job 或持久化分区 |
| 运行实例 | 某次启动的具体环境实例，拥有自己的内核与服务集合 | 安装包身份、一个全局 `ready` |
| 资源作用域 | 拥有运行资源的边界及其唯一关闭责任 | 引用资源的组件、存储 scope |
| 服务合同 | 提供者与消费者之间的窄能力及错误/寿命约束 | 任意字符串 `get()` 得到的全局对象 |
| 插件定义 | 随产品发布的模块描述、依赖、运行入口和贡献声明 | 已激活实例、npm 包、第三方权限凭证 |
| 插件激活实例 | 插件 id + 入口 + 所在运行实例的作用域 + 激活代次所标识的一次激活；入口声明运行位置 | 同插件的其它入口、窗口或后端实例 |
| 贡献 | 向指定能力注册的声明，如命令、View、设置、状态定义 | 实际执行 handler、任意 HTML/模块路径 |
| 装配清单 | 环境选择的插件集合、服务实现与必需门禁 | 用户可随意上传执行的 manifest |
| 代次 | 资源关闭重开后可区分的新身份 | 路径、UI 计数、Catalog 版本或认证 token |

### D1：内核边界与显式依赖注入

**推荐：**内核只拥有作用域、服务解析、插件激活与资源追踪机制。命令、Storage、Config、Project、日志实现、授权实现和 UI 宿主均可作为服务插件；内置插件可以是产品启动必需项，并非必须允许用户关闭。

- 宿主在执行任何业务插件前提供最小可信启动上下文：运行位置与实例身份、已经解析的根能力、关闭信号、紧急失败输出。它不是配置/日志/授权服务的第二套实现。
- 明确声明“提供什么、需要什么、在哪个作用域提供、是否启动必需”；不依赖 import 顺序执行注册副作用。
- 同一服务键与解析作用域只有一个选定提供者。身份或服务键有冲突时隔离全部冲突声明，不按顺序挑一个；静态预校验中的缺少必需依赖或环拒绝相关绑定及必需消费者，入口不开始业务。运行中发现等待环时可能已有初始化副作用，须阻断发布并收口，不能声称副作用未发生。受影响消费者闭包包含启动必需能力时，所属应用不能 ready；健康上游提供者和无关可选能力不被连带隔离。确需多个贡献的能力由专用注册表管理。
- 可选依赖缺失要显式报告能力不存在；不能悄悄创建第二个默认提供者。装配绑定在运行实例内固定，不承诺任意热替换。
- 同一服务作用域中的并发首次解析共享一次初始化结果；必需依赖未 ready 不交出可调用实例。初始化失败不发布半成品；自动重试不是默认行为。
- 长寿命服务不能捕获短寿命实例。它可接收工厂或作用域绑定能力，在操作期间取得精确目标；不得靠“读取当前 Project”把旧请求改投新目标。
- 依赖获取与资源所有权分开：消费共享服务不取得关闭它的权力；临时资源必须立即登记到其 owner，使初始化中途失败也能收口。
- DI 仅在同一运行位置内解析；跨进程由显式服务代理经过协议、身份和授权，不透传对象引用或全局容器。

不提前选择装饰器、反射或第三方 DI 库；优先显式声明和可检查依赖图。静态依赖与运行时激活等待共同成图，不能用惰性解析隐藏依赖环。

表中的服务依赖、底层适配器、运行期绑定必须区分。底层适配器仍是有 owner 的显式服务提供者，不因名为 adapter 就绕过依赖检查；运行期绑定表示使用某个精确资源代次，不表示反向激活资源消费者。若绑定回调又解析服务或等待激活，该边也进入运行时等待图。先登记模块描述/工厂不要求先激活其实现，避免 Project 打开与 Project 模块激活相互等待。

### D2：插件登记、激活与贡献事务

**推荐：**静态受信清单先完成描述校验，再按启动门禁或真实消费激活；不把“所有插件已激活”作为应用可用条件。

1. 清单校验插件身份、入口身份、运行位置、服务依赖与贡献 owner；重复 id 不静默覆盖。每个入口分别装配和激活，即使位于同一运行位置也不隐式共享激活；跨位置更不假装一次原子激活覆盖全网。
2. 核心服务就绪后，贡献接收者校验全部适用声明，形成可查询目录。恢复布局前必须知道 View/Editor 描述，执行实现可以尚未激活。
3. 命令调用、View 打开、服务首次取用或明确的启动要求可触发激活。并发激活合并；同一调用只在激活成功后执行一次。声明存在不表示权限通过，也不表示 handler 可用。
4. 激活期间新增的 handler、订阅等先由此次激活拥有，全部必需步骤成功后才发布可调用能力。对外副作用不属于注册事务：写文件或调用 Provider 已发生就不能假装回滚，须走领域恢复合同。
5. 激活失败保留描述和失败原因，撤回本次未完成能力；不删除其他插件贡献。依赖它的能力明确失败，无关可选功能继续工作；启动必需能力失败则所属应用不能报告 ready。
6. 若激活取消或作用域关闭，迟到的成功不能再发布。清理失败保留失败资源与 owner 身份，不能声称停用完成。
7. 声明接收者需区分描述登记、实现待激活、可用、激活失败和已撤回/关闭；静态描述与可调用实现分开查询。正常关闭撤已发布实现并保留不可用原因，不用空 handler 或成功占位应付恢复流程。

当前命令 descriptor 将 metadata 与 run 一起登记，不假定它已经支持上述两段式目录。接入时须更新原命令合同及所有调用方；不平行建设“插件命令总线”。Storage 定义则先于消费者绑定登记，前端声明不能直接注册后端 owner。

### D3：关闭、取消与失败

**推荐：**显式用户关闭可进行领域检查；一旦进入真正关闭便拒绝新业务，按依赖关系收口。运行实例意外消失不保证回调执行。

- 用户请求关闭窗口、文档或 Project 时，先由相关领域处理未保存内容和在途事务；取消关闭仍保持原作用域可用。不是所有插件都能无限否决退出。
- 关闭获准后进入 stopping：禁止新激活和新业务操作；已接纳操作按领域合同取消或等待。内部清理仍可使用尚未关闭的依赖，不得被业务拒绝门禁一起封死。
- 先收口消费者和其在途操作，再关闭提供者；同时释放没有依赖关系的资源可以并行。重复关闭不重复副作用，返回同一次关闭的结果。
- 超时与异常不伪装 closed；独立清理继续、失败聚合。仍被未终止操作使用的依赖或租约不能按正常成功路径提前释放，让新 owner 接管。必要时由拥有该进程的监督者执行有界终止，并由领域恢复处理未知结果。
- 未完成资源获取也先登记；取消等待不代表执行已终止。所有受管操作/获取确认结算并收口前保持 stopping，迟到资源不能复活已关闭实例。显式恢复可重试已结算的失败清理，不得重入仍 pending 的回调或重做成功清理。
- 用户强制关闭、进程信号、崩溃、租约丢失和浏览器卸载必须区分；强制关闭不承诺 dirty flush、Provider 取消或事务回滚成功。
- 浏览器 `unload` 不保证等待异步清理。持续保存已确认状态、断线检测、租约与恢复由对应服务保证；不能把持久性建立在 `onBeforeUnmount` 返回的 Promise 上。
- 插件实例寿命结束不删除其持久记录；未保存正文、Config、Storage、Project 文件和 Job 日志分别按自己的数据合同处理。

首批**不提供任意在线热卸载/升级**已获开发者接受；支持正常作用域销毁、部分激活失败收口与整个宿主重启。必需插件不允许普通界面随意关闭。后文单列热卸载设计与成本，区分释放实例、在线停用、代码更新和物理卸载。

### D4：跨位置、身份与权限

**推荐：**位置、所有权、认证身份与授权能力分别建模。跨位置协议显式携带必要的资源身份、代次与调用关联，不直接序列化本地服务对象。

- 浏览器可发现一个命令不表示服务端已授权；服务端在真实副作用边界重新校验身份、权限和目标代次。
- Project 是业务资源，不是执行位置；Job 是工作记录与运行尝试，不是一个独立进程。需要 Worker 时再声明实际运行位置。
- 断线使远端代理不可用或需要重连，不自动销毁远端共享资源；重连读取权威状态并重新绑定代次，不能仅凭路径复活旧句柄。
- 非幂等远端动作断线后可能 outcome unknown；禁止通用 RPC 层自动重试写操作。是否重放由拥有该操作的领域合同决定。
- 请求/认证会话不泄漏到进程单例：登录变化时撤销相关访问与订阅，清除相应敏感缓存；具体多用户共享策略由身份与数据规范定义。
- 根目录与 secret 通过最小能力注入；描述快照、错误和审查输出不携带凭据。内置同进程代码仍是受信代码，DI 与 namespace 都不是恶意代码沙箱。

### D5：Component Lab 边界

**推荐：**LabShell 只保留导航、场景、画布、主题、文档、元素/检查器、通用事件/数据检视和 Lab 自身偏好，不创建产品插件宿主或产品级注册表。

- 普通 fixture 不隐式获得工作台命令、Project、Storage 或配置服务；组件依赖通过局部显式适配满足。
- QuickInput 用静态 items 展示；命令面板等组合组件可有专门的局部内存环境。它由该场景拥有，切场景或卸载后失效，不能注册到其他场景。
- 从 LabShell 移出常驻产品命令面板、确认编排和产品快捷键。Lab 自己的检视快捷键可保留；样板需要的快捷键只能在该样板活动范围内生效。
- 全局第五个“命令”tab 的合同目前位于 w00003 树 `docs/specs/ui/component-lab.md`，合入后须沿同一 capability 原位修订；主树同名 `planned` 文件尚未定义检视面板。命令专属检查转入对应场景，不新增通用插件 Lab；主题、文档、元素/检查器、事件、数据等展示能力继续保留。
- Lab 不读取真实凭据、Project/Session 或 Provider，不假装已执行真实业务；需要进程与 I/O 的验证使用隔离运行时宿主和正式产品入口。
- 局部展示环境可调用真实纯核心机制，但不决定最终插件格式；未来产品运行时不得依赖 LabShell、fixture 或 Lab 注入键。

## 能力地图与规范归属

以下 module id 为基础切片的稳定身份；owners 是逻辑职责，不宣称已有独立包。核心只依赖机制，产品装配依赖插件集合，功能依赖服务合同；不得形成反向依赖。用户已批准前两片落 Spec，后续功能能力沿既有正文接入，不建“插件版”副本。

| 模块 id | 职责与 owner | 依赖 | 规范归属与独立验收 |
|---|---|---|---|
| `runtime-lifecycle` | 运行实例、作用域、资源所有权、取消与结束；owner：runtime | 无产品能力依赖 | [runtime.lifecycle](../../../../docs/specs/runtime/lifecycle.md)，`planned`；关闭与迟到发布 |
| `service-composition` | 服务绑定、依赖图、实例寿命和解析失败；owner：runtime | runtime-lifecycle | [runtime.services](../../../../docs/specs/runtime/services.md)，`planned`；缺依赖、环、并发初始化、越域捕获 |
| `plugin-runtime` | 插件描述、贡献所有权、激活与失败收口；owner：runtime | service-composition | [runtime.plugins](../../../../docs/specs/runtime/plugins.md)，`planned`；描述先登记、激活一次、局部失败 |
| `application-bootstrap` | 环境适配、装配选择与启动/停止门禁；owner：application-runtime | plugin-runtime；按清单选择服务插件 | [runtime.application](../../../../docs/specs/runtime/application.md)，`planned`；首片验证浏览器/后端宿主，不宣称完整产品/桌面已迁移 |
| `capability-adapters` | 命令、Storage、Config、View 等各自贡献入口；owner：各能力 owner | plugin-runtime 的扩展合同，不依赖具体页面 | 沿用能力自身 Spec；文件与设置两条纵向链路 |
| `component-lab` | 纯组件展示及局部样板依赖；owner：ui | 组件与显式局部依赖，不依赖产品装配 | 原位修订 `ui.component-lab`；切场景无共享产品状态 |
| `runtime-diagnostics` | 生命周期诊断服务；owner：runtime-diagnostics | 内核事件与宿主紧急输出 | [runtime.diagnostics](../../../../docs/specs/runtime/diagnostics.md)，`planned`；早期失败可见、脱敏、输出异常不阻断收口 |
| `platform-files` | 有 owner 的受限根文件能力；owner：platform-files | 宿主文件系统与资源作用域 | [platform.files](../../../../docs/specs/platform/files.md)，`planned`；真实文件读写、拒绝越界、监听/锁释放 |
| `sqlite` | 具名数据库借用、事务与连接机制；owner：sqlite | 宿主驱动与精确数据库资源 owner | [platform.sqlite](../../../../docs/specs/platform/sqlite.md)，`planned`；真实事务、关闭重开与失败保留 |

机制构建依赖为 `runtime-lifecycle → service-composition → plugin-runtime`；产品装配与能力适配据此连接。插件运行时不反向 import Files、Storage 或 Config 实现；相应插件向机制提交描述并消费声明的合同。

### 对既有 Spec 的预期改动

| 能力 | 处理方式 | 需要补充的输入、状态、失败与验收 |
|---|---|---|
| `ui.component-lab` | [主树同名文件](../../../../docs/specs/ui/component-lab.md)仍为 `planned` 且不定义检视面板；五个 tab 的合同在 w00003 同路径 `implemented` 文件，合入后沿同一 capability 原位修订，不建副本 | 输入为场景局部依赖；无默认产品 host；保留元素/检查器等组件展示能力；离开场景释放，无跨场景命令与快捷键泄漏 |
| `workbench.commands` / `workbench.quick-open` | w00003 已有 `docs/specs/workbench/commands.md` / `quick-open.md`；合入后沿同一 capability 原位修订，不在主树另建同名副本 | 插件来源/owner、描述与 handler 接入、未激活/失败结果、释放身份与面板消费 |
| `storage.boundaries` / `storage.persistence` | w00003 已有 `docs/specs/storage/`；保留状态定义和数据 owner，调整装配接入 | 服务生命周期不等于记录寿命；先登记定义再绑定；Project 代次失效；关闭不删数据 |
| Config | 主树注册表已有“配置、模型与凭据”缺口；基于原服务确定一个能力归属 | 设置贡献校验、scope/target、有效值、秘密字段、重启要求；不能用任意 Storage 写入代替 |
| Workbench / Editor | 与既有 shell、View 和编辑工作台 owner 协调，沿已存在 capability 更新 | 插件提供工厂，实例由对应宿主拥有；位置变化不等于销毁；dirty/save/recovery 仍归文档域 |
| Project / Agent Session / Job | 不把其领域合同复制进 runtime.lifecycle | 明确就绪、代次、在场、关闭、durable truth 与运行尝试；领域状态不能被插件 active 代替 |
| Desktop、安装与 Product Runtime | 拟将业务启动门禁、运行实例停机与跨位置装配语义归 `runtime.application`；安装状态机、UAC、升级、卸载、发布资产仍归 Desktop/安装 owner | Manager/Envelope 的进程创建、监督与终止入口消费运行时合同，不复制其业务 ready/drain 状态机；现有发布/安装合同本轮不改 |
| 平台文件 / SQLite / WorldEngine / Plotbench | 平台资源 API 归各自提供者，领域数据与操作留在原领域 owner；不全部塞入 `runtime.plugins` | 文件根/数据库借用、schema 迁移与关闭；World/Plot 的配置、View、工具及缺席行为分别验收，插件机制只管装配与实例 |
| 基础术语、Monorepo、安装与发布 | 保持[术语](../specs/foundation/terminology.md)与[模块边界](../../../../docs/modules/monorepo-boundaries.md)唯一正文 | 新词批准后增补；包/exports 与产品镜像变更单独评估，不在提案中制造现有包声明 |

Spec 登记遵循[成熟度合同](../../../../docs/specs/README.md)：本轮明确批准的基础切片进入 `planned`，不是当前实现证据；旧 `implemented` 合同在切换前仍描述真实旧行为。后续能力按首个消费者需求原位细化，不在同一 Spec 里混称新旧均已实现。

## 生命周期矩阵

### 运行位置

| 位置 | 谁启动并拥有 | 可以直接持有什么 | 跨位置边界 |
|---|---|---|---|
| 浏览器标签页 / 桌面 renderer | 浏览器或桌面窗口适配器 | UI、该窗口服务、远端能力代理 | HTTP/事件流/桌面桥；不持有服务端对象 |
| Product 后端进程 | 开发启动器、Manager 或容器监督者 | 服务端插件、请求、数据访问与领域 runtime | 多个窗口共享服务，但每次访问独立授权 |
| Desktop Envelope 主进程 | 桌面启动器 | 原生窗口与设备本地能力 | 白名单桥；不复制 Product 业务真相 |
| 受管 Worker / 子进程 | 明确的创建者 | 被分配的计算与受控能力 | 消息/IPC 与进程终止；不是恶意代码安全沙箱 |

Source Dev 与产品产物应使用相同生命周期语义，但允许不同适配器。SSR 不是当前产品启动必需条件；若未来启用，请求作用域不得变成跨用户的全局单例。

### 资源作用域与终止责任

下表为 D1–D4 的推荐合同，不是新增所有 scope 的强制类型清单。只有真实资源需要独立寿命时才建立对应作用域。

| 作用域 | 身份与 owner | 创建 / ready 条件 | 结束与在途处理 | 保留什么 / 禁止混同 |
|---|---|---|---|---|
| 后端运行实例 | 本次进程实例；启动适配器 | 迁移门禁、运行实例级必需租约与必需服务成功，才接纳业务；Session Store 租约由下表 `session-persistence` 持有 | 拒绝新请求，收口消费者，再释放提供者；租约最后在其写入消费者结束后释放，失效进入领域停机合同 | 用户数据保留；Session Store 租约不是整个 State Root 的强互斥锁，也不随窗口或 Project 退出释放 |
| 前端应用实例 | 每标签页/renderer 一次加载；前端适配器 | 最小服务可用后可呈现壳；恢复状态另有结果 | 导航/刷新/窗口关闭释放本地资源；强制卸载仅 best effort | 不全局关闭后端 Project/Job |
| 工作台实例 | 一次进入工作台；前端应用 | 命令/View 描述可用，恢复可分别完成或失败 | 离开工作台撤回入口与实例，取消本地待执行选择 | 不等于退出登录或停止后端 |
| 认证访问 | 登录身份及访问代次；身份服务 | 验证成功且权限有效 | 注销/撤销阻止新动作、撤销访问与敏感订阅 | 不是 user Storage 的持久身份；具体后台任务授权按领域合同 |
| Project 就绪代次 | 精确 Project 身份与本次代次；Project 服务 | 领域必需模块、占用与校验成功才 ready | 明确关闭/失效/回收时拒绝新操作，收口已接纳操作后释放占用 | 路径重用不是同代；数据目录仍保留 |
| 窗口到 Project 的绑定 | 窗口身份 + 精确 Project 代次；该窗口工作台 | 打开与 presence/访问绑定成功 | 切换或断线释放该连接、句柄与投影 | 不拥有共享 Project 的全局关闭权；后台引用可能继续 |
| 插件激活实例 | 插件 id + 入口 + 所在运行实例的作用域 + 激活代次；插件运行时 | 必需依赖 ready，激活事务提交 | 停止新调用，收口实例资源与贡献；不自动销毁共享服务 | 定义、目录与持久记录独立；必需插件不随一个 View 退出 |
| View / Editor 实例 | 宿主签发的实例与代次；View/Editor Host | 工厂成功、必要资源绑定、句柄 ready | 真正销毁才释放；移动/隐藏按各自 UI 合同处理；dirty 先协商 | UI 隐藏不表示业务停机；Editor 与文档模型寿命也可不同 |
| 请求 / 用户操作 | 调用关联与目标代次；操作接纳方 | 参数、身份、目标与依赖校验后接纳 | 完成或取消进入领域终态；调用方断线不证明远端已终止 | 不自动重试非幂等动作；outcome unknown 由领域恢复 |
| 后台任务运行尝试 | durable Job id + 尝试身份；任务服务 | 任务授权与资源绑定成立 | 到终态或停机策略收口；恢复是否重跑由 Job 合同决定 | 不归某个面板/连接拥有；durable 记录不是内存 scope |
| Worker / 子进程 | 创建者分配的实例/lease | 握手与必要能力 ready | 先合作取消，再由 owner 有界终止；结果未知保留 | 不能任意终止用户进程；跨进程句柄失效需传播 |

前端窗口引用多个后端资源，因此整体是“所有权树 + 使用依赖图”，不是一棵跨进程父子组件树。每个资源只有一个关闭 owner，借用者只释放自己的借用关系。

运行实例级租约明确归 `session-persistence`：保护同一 Workspace Root 上 Agent Session Store 的协作写入，其寿命覆盖使用该 Store 的消费者。获取失败不允许 Product 接纳业务；失效停止相关写入并进入停机，不允许继续发布原租约可用。Project 占用是另一个领域资源。现有 [agent.session-store-lease](../../../../docs/specs/agent/session-store-lease.md) 是 `planned` 合同，已明确 advisory lock 的 stale 接管窗口；本提案不把它升级成 fencing 或全 State Root 强排他保证，也不改变现有退出码和恢复语义。

### 状态与就绪的共同规则

- 作用域的管理阶段：创建中 → 可用 → 停止中 → 已关闭；创建失败先收口，不能直接假装已关闭。清理失败保持可诊断的失败记录与禁止发布状态。
- 插件描述可已登记但尚未激活；激活中 → 可用，或失败并收口。失败后的重试需显式策略，不能因下一个 UI render 无限重试。
- 应用至少分别报告“核心服务可用”“贡献目录可用”“工作面恢复完成/失败”；恢复失败不必把全部核心服务判为失效，必需能力失败也不能用局部 UI 出现掩盖。
- Project ready、插件 active、View visible、Job running、持久数据已提交是五个不同事实；事件要携带相应 owner/身份，不能合并成通用 `ready=true`。
- 初次恢复可能需要激活编辑插件，因此不能规定所有插件都等到 UI restored 后才允许激活。

### 生命周期分层与阶段门禁

前面的矩阵回答“谁拥有资源”，本节回答“何时能开始下一件事”。基础机制已获准沉淀目标 Spec；下面业务阶段是后续装配设计，不是现有类型或首片完成声明。不能给所有对象统一套一个 `activate/dispose`，也不把启动阶段当作 DI scope。

| 生命周期 | 阶段 / 转换 | 进入条件与可做的事 | 失败 / 终止 | Spec 承接 |
|---|---|---|---|---|
| 后端进程 | 创建 → 描述已校验 → 必需服务就绪 → 业务接纳 → 停止中 → 已关闭 | 先取得宿主能力，再登记描述，按依赖初始化必需服务；业务接纳前完成迁移、身份与 Store 租约门禁 | 启动失败不接纳业务；先撤接纳再 drain，失败清理留下诊断，不能假报已关闭 | `runtime.application`；通用资源收口归 `runtime.lifecycle` |
| 浏览器应用 | 创建 → 本地基础就绪 → 身份已确定 → 启动数据已加载 → 项目选择可用 | 本地基础包括错误显示、语言、内置主题、客户端装配；鉴权完成后才加载受保护的设置和项目目录 | 未登录进入登录页；配置/列表分别显示失败与可重试状态，不把失败伪装为空列表；刷新产生新应用实例 | `runtime.application`；身份领域合同 |
| 工作台实例 | 未进入 → 绑定中 → 目录与布局已准备 → Grid 已挂载 → 目标实例恢复已结算 → 停止中 → 已关闭 | 精确 Project 绑定可用，贡献目录先于布局解释；Grid 只创建容器，View 工厂随后创建实例 | 恢复失败与工作面可交互分开；失败 View 可重试，不阻断无关 Files；离开先协商 dirty，再撤回入口与实例 | `runtime.application` + 既有 Workbench/Editor Spec |
| 后端 Project | 不存在 → 打开中 → 就绪代次 → 关闭中 → 已关闭 | 校验身份、路径、占用与该 Project 的必需模块；可选领域模块可尚未激活 | 打开失败收口本次资源；显式关闭需处理所有借用者，不能由单窗口释放直接触发 | Project 领域 Spec；runtime 仅管 owner 与等待关系 |
| 窗口 Project 绑定 | 未绑定 → 打开/连接中 → 精确代次已绑定 → 断线/释放 | HTTP 打开结果和权威 presence 就绪匹配，才向 UI 交出 Project 能力 | 断线使代理不可用；重连重新确认代次；晚到的旧请求不能提交到新绑定 | Project 连接合同 |
| 插件激活实例 | 已登记未激活 → 激活中 → 可用，或失败并收口 | 单位为插件 id + 入口 + 所在运行实例的作用域 + 激活代次；同插件的浏览器与后端不是同一次激活 | 关闭/取消后禁止迟到发布；首批失败后不自动循环重试，作用域退出释放 | `runtime.plugins` |
| 请求 / 后台运行尝试 | 接纳 → 执行 → 成功 / 失败 / 已取消 / 结果未知 | 记录调用身份、精确资源与取消信号；运行时追踪使用关系 | abort 请求不等于服务器事务回滚；后台尝试由 Job owner 结束，不由 View 结束 | 对应操作 / Job Spec |

“项目选择可用”“工作面可交互”“恢复已结算”是不同门禁。已结算包含成功、缺失贡献和明确失败，不要求所有可选插件成功；激活可由恢复触发，不能等恢复结束后才允许激活。后台 idle 工作不得成为上述关键路径的隐式前置。

所有权按运行位置分别建立，不做远程父子 scope：

```text
后端进程 scope
  ├─ 进程服务（目录、配置、Session Store）
  ├─ Project 代次 scope → 领域服务 / 数据库借用 / 文件订阅
  └─ 后台运行尝试 scope ──借用──> 精确 Project 与领域能力
浏览器应用 scope
  ├─ 身份访问 scope → 配置/目录代理与订阅
  └─ 工作台 scope → Project 绑定 scope → View / Editor 实例
```

项目选择页不需要创建 Project scope。Settings 的用户级配置跟随应用/身份，不随 Project 切换销毁；项目级配置另需精确 Project 绑定。View 移动不改实例 owner，隐藏策略由 UI Spec 决定。服务 scope 与用户持久化 scope 不能同名就当作同一寿命。

### 候选模块与代码布局

以下为**候选布局，尚未实施**，相对 `packages/neuro-book/`；`server/runtime/` 与 `shared/` 已存在，图中新增子边界和入口仍是规划。先在应用包内建立逻辑边界，不为每个插件创建 npm 包；沿用[Monorepo Module 合同](../../../../docs/modules/monorepo-boundaries.md)，不改变既有公开 exports。

```text
runtime/                         # 不依赖 Vue、Nitro 或产品领域的机制
  lifecycle/                     # scope、资源所有权、关闭与取消
  services/                      # 显式依赖、绑定、初始化结果
  plugins/                       # 入口描述、激活、贡献提交/撤回
app/runtime/                     # 浏览器装配入口、清单与远端代理接线
app/features/<plugin-id>/        # 浏览器入口：描述、View 工厂、客户端适配
server/runtime/                  # 后端装配与现有启动/关闭入口的整合
server/features/<plugin-id>/     # 后端入口：服务工厂、领域工具、资源声明
shared/features/<plugin-id>/     # 可跨位置共享的纯描述/DTO/schema，不含 secret/I/O
```

| 模块边界 | 具体职责与入口 | 允许依赖 / 禁止依赖 | 现有代码如何接入 |
|---|---|---|---|
| `runtime-lifecycle` / `service-composition` / `plugin-runtime` | 上述 `runtime/` 三目录，各自提供机制入口 | 机制单向依赖；禁止 import app/server 领域、Nuxt hook、数据库驱动 | 不是把现有各域状态机复制成通用类 |
| `application-bootstrap` | `app/runtime/`、`server/runtime/` 各一套环境清单与启动编排 | 可选择入口与适配器；不能被领域服务反向 import | Nuxt client plugin 与 Nitro/启动 middleware 只适配框架；不得让每个业务模块各自添加全局启动 hook |
| 插件入口 | `app/features/` 和 `server/features/` 中的具名入口 | 只声明提供/消费和贡献、创建实例、把资源交给 scope | 现有 `server/world-engine/`、`server/plot/` 等保留领域算法 owner；入口不是第二份实现 |
| 纯合同 | `shared/` 中既有 DTO，新增必要的纯贡献描述 | 不导出可执行服务对象，不从浏览器导入服务器入口 | 配置 schema、View id 等可共享；服务器工具处理器和数据库资源声明留在服务端 |
| UI 宿主与组件 | Workbench Host 消费 View/Editor 目录；Grid/纯组件只渲染模型 | 页面消费 bootstrap 返回的窄能力；组件不取万能 DI 容器 | 从 `index.vue` 提取装配；现有 Grid、实例管理与组件不因插件化重写算法 |
| HTTP/Agent 适配 | `server/api/` 与 Agent 工具目录消费领域服务 | 负责输入、身份、目标代次、错误映射；不拥有全局数据库 | 保留现有路由外形；内部调用改走所声明的服务，不创建平行 HTTP API |

每个插件至少有“纯描述 + 环境入口工厂 + 领域实现”边界；并不要求三个新文件。浏览器/后端清单静态引用各自受信入口，描述登记不执行实现。Nuxt 的 `app/plugins/`、Nitro 的 `server/plugins/` 是框架 hook 目录，不与产品插件概念混同；目标入口放 `features/`，防止框架自动扫描把所有产品插件提前激活。

同一纵向链切换时迁移它的注册调用与释放 owner，删除被替代入口；既有领域代码可由新入口直接消费，不增加兼容 singleton 或新旧双写层。是否移动领域目录由真实边界收益决定，不为了树形整齐全量搬家。

## 内置插件划分表

表中 id 是候选插件身份，不承诺独立 npm 包；同一个分发插件可以有多个运行入口，但每个入口分别声明位置、作用域与依赖。下列“提供”是合同边界，不是要求新建相同名字的服务类。

消费列使用候选插件 id 表示服务提供者依赖；`绑定：`表示已取得资源的精确代次，`宿主：`表示启动适配器提供的原始能力。跨位置消费指本地代理及其明确协议，不能直接 DI 到另一进程。依赖的检查规则见 D1。功能组行是领域拆分范围，不是可直接装配的最终 manifest；转 Spec 前须把组内入口、提供者与依赖逐一确定，禁止将“各自真实依赖”当作可执行配置。

这里将先前笼统的 `platform-resources` **细分**为 `platform-files`、`sqlite`、`managed-processes`；它不再是另一个可注入的大服务。箭头表示提供者先于消费者：宿主 → `platform-files` / `sqlite` → `identity-access` → `project-directory` / `configuration` / `project-runtime`；Project 就绪后再绑定 `workspace-files` / Project Storage / 领域入口。`session-persistence` 独立提供 Product 必需租约门禁。前端由身份与各自协议代理 → `command-system` / `workbench-host` → 功能 View。

| 候选插件 / 分类 | 提供或贡献 | 消费能力与运行位置 / 作用域 | 必需性与激活建议 |
|---|---|---|---|
| `runtime-diagnostics` / 服务 | 日志实现、结构化生命周期诊断与查询（即 D1 的日志/诊断服务） | 宿主：最小启动输出；各运行实例 | 早期必需；完整日志失败仍有最小输出，不能递归依赖 Storage 才报启动错误 |
| `platform-files` / 基础设施 | 受根约束的文件读写、watch、锁与资源释放能力 | 宿主：经启动校验的根能力与 OS I/O；后端/受管 Worker | 默认产品必需；不依赖 Project、Config、身份数据库或工作台；只接可信入口签发的资源约束，不直接服务任意 HTTP 路径 |
| `sqlite` / 基础设施 | 受管 SQLite 连接、事务、迁移执行与关闭 | 宿主：数据库驱动与已解析的数据库资源定位；后端/Worker | 当前 SQLite 产品清单必需；提供者不拥有领域 schema，也不自动打开所有 Project DB；其它数据库后端若保留，需由清单显式选择对应实现 |
| `managed-processes` / 基础设施 | Worker/子进程托管、握手、取消与有界终止 | 宿主：进程/Worker API；后端/桌面 | 仅相应消费者需要；不是每个 B/S 页面都启动 Worker |
| `identity-access` / 服务 | 身份、授权、访问撤销 | 宿主：启动安全上下文；platform-files / sqlite 的身份持久访问；后端进程/请求，前端代理 | 受保护能力前必需；不依赖可扩展用户设置或 UI；认证关闭也必须有显式受限策略 |
| `session-persistence` / 服务 | Session Store、实例级租约、迁移就绪与失效信号 | platform-files；后端运行实例 | Product 业务 ready 前必需；Store 写入消费者结束后释放租约，不随 Agent UI 或 Project 停用 |
| `project-directory` / 服务 | 可访问项目列表、目录元数据与定位 | identity-access、platform-files；后端进程/请求 | 项目选择必需；当前列表来自轻量 manifest 快照，不读 Project DB/文件树/Agent Session；不依赖 project-runtime 的 ready |
| `configuration` / 服务 | 设置定义、有效值与受控写入 | 核心：identity-access、platform-files；Project HTTP 适配另消费 project-runtime 的绑定；Profile 设置适配另消费 agent-runtime 组内独立 Catalog 入口；前端代理 | 核心不依赖 Project ready 或 Agent/Harness 运行入口；打开阶段凭 owner 授予的受限上下文读配置，外部请求仍须 ready；定义先登记，不等领域激活 |
| `storage` / 服务 | 状态定义、owner 句柄与访问上下文 | identity-access、platform-files、sqlite；Project 入口另消费 project-runtime；前端协议代理 | 用户状态不需 Project；Project 状态必须精确代次绑定；不能反向依赖工作台 |
| `project-runtime` / 服务 | 打开、精确代次、占用、在场与关闭 | identity-access、project-directory、platform-files、sqlite；后端进程管理 Project scope | 不依赖 workspace-files、storage、WorldEngine 或工作台才能 ready；模块工厂先登记，接受 Project 打开上下文而不反向等待 ready |
| `workspace-files` / 服务 | 项目/用户资产文件访问、变更订阅与索引 | identity-access、platform-files；Project 入口消费 project-runtime 的精确绑定 | 首次文件消费；Project 自身开库/根定位不用此高层服务；领域写入边界独立于 Files View |
| `command-system` / 服务 | 命令目录、执行策略、上下文与键位接入 | runtime-lifecycle、identity-access 的必要本地接口/代理；前端工作台，服务端能力另经协议 | 工作台必需；不持有具体编辑器实现，不形成全进程跨窗口命令单例 |
| `workbench-host` / 服务 | View/Editor 宿主、布局与实例管理 | command-system、storage、configuration 的前端入口/代理；前端工作台 | 工作台必需；工厂来自受信贡献，不读取任意模块路径 |
| `document-session` / 服务 | 文档模型、dirty/save/recovery | workspace-files、project-runtime、storage 的前端入口/代理；绑定：文档/工作面 | 编辑功能必需；不是每个 Editor 组件都各自拥有一份保存真相 |
| `files-view` / 功能 | 文件树、刷新命令、展开状态定义 | workspace-files、workbench-host、command-system、storage 的前端入口/代理 | 打开 View 时激活；首条迁移链 |
| `editor-support` / 功能组 | Markdown、代码、只读编辑工厂与编辑命令 | document-session、workbench-host、configuration；前端插件与具体编辑器实例 | 按文档类型激活；是否拆分三个插件由依赖图决定，不能为表格整齐拆包 |
| `settings-ui` / 功能 | 设置页面与打开命令 | configuration、command-system、workbench-host；前端工作台 | 首次打开；跨 Project 的第二条验证链 |
| `theme-presentation` / 服务与声明贡献 | 主题应用、内置主题/配色数据 | configuration 的前端快照；宿主：UI 挂载能力；前端应用 | 首帧所需部分早期可用；主题数据可以纯声明，不要求执行激活代码 |
| `characters` / 功能组 | 角色领域服务、View、编辑入口与设置 | 领域：Project 绑定、sqlite / workspace-files；UI：领域代理、workbench-host | 组内入口独立依赖；角色数据不属于 View 私有 memento |
| `world-engine` / 可选领域 | World 领域服务、配置、View/专用工作面、Agent 工具描述与处理器 | 后端：Project 绑定、sqlite、workspace-files、configuration、artifact-compiler；语义搜索另取 embedding 能力；工具声明送 agent-tool-catalog；UI：领域代理、workbench-host | 按 World API/View/tool 消费激活；基本文件写作不依赖它；不把模型调用作为默认初始化副作用 |
| `plotbench` / 可选领域 | Plot 领域服务、配置、情节工作面与 Agent 工具 | 后端：Project 绑定、sqlite、workspace-files、history-trace 的记录入口、world-engine；设置声明送 configuration；工具声明送 agent-tool-catalog；UI：领域代理、workbench-host | 首批保留真实 World 依赖；可不装 Plot，但只装 Plot 不装 World 不成立；核心写作不反向依赖它 |
| `artifact-compiler` / 服务 | 项目内 TS 配置的受控编译与缓存 | 宿主：Source 或已验证 Product 的 authoring 身份；platform-files、必要的 managed-processes | 被 World schema/calendar 与其它真实作者能力消费；不能靠 cwd 猜依赖，不改变项目代码执行的既有信任策略 |
| `embedding` / 模型服务入口 | 受控嵌入调用与结果校验 | configuration、identity-access、宿主网络能力；服务端 | 操作级按需取得；不开启即报告功能不可用，不让 World 基础查询依赖真实模型成功；secret 不进前端声明 |
| `agent-tool-catalog` / 贡献接收者 | 工具描述、提供者引用、激活入口与执行接线 | plugin-runtime 的贡献合同、identity-access；服务端 | 描述登记不启动 Agent 或领域服务；不是第二个工具执行器，复用/改造既有 Harness 工具接入边界 |
| `agent-runtime` / 服务组 | Harness、Session/Job、资产 Catalog、模型执行适配 | Harness：identity-access、project-runtime、session-persistence、agent-tool-catalog、artifact-compiler、configuration 核心；底层按需消费 platform-files / sqlite / managed-processes；Catalog 入口独立消费文件/编译与配置核心，不消费 Harness | Store 租约不归 Harness 惰性实例；Catalog 查询不启动 Session/Job；工具调用按描述激活领域提供者，领域服务不得反向依赖 Agent 才能启动 |
| `agent-ui` / 功能 | 会话/聊天视图与操作入口 | agent-runtime 协议代理、workbench-host；前端投影 | 隐藏/销毁面板不停止 Job |
| `history-trace` / 功能组 | History/Trace 记录服务与查询展示 | 记录入口：platform-files / sqlite、configuration 核心；绑定：Project owner 授予的打开上下文或就绪代次；展示：identity-access、记录代理、workbench-host | Project 打开时可准备历史资源，不反向等 Project ready；外部查询仍要求 ready；记录写入不依赖诊断 UI |
| `subject-memory-rag` / 相邻领域服务 | subject 文件、记忆/事件工具与 RAG 查询 | Project 绑定、workspace-files、sqlite、configuration；向量操作按需消费 embedding | 保留既有 subject-memory 工具链的数据 owner；World RAG 面板消费协议，不让 World 核心反向依赖整个 Agent Runtime |
| `desktop-integration` / 环境能力 | 原生窗口/菜单/设备能力 | 宿主：白名单桌面桥；renderer 消费 command-system；Envelope 消费 managed-processes | 两个入口分别装配；Web 不伪造桌面成功结果 |
| `maintenance-services` / 服务组 | 备份、媒体计算与编译 Worker 适配 | platform-files / sqlite / managed-processes 及相应领域服务 | 按实际资源拆分；实例有 owner，不靠进程退出隐式回收 |

### 不插件化的对象

- 纯组件与通用算法仍是库；它们可以被插件使用，不自行参与激活。
- 已有通用包仍由自己的稳定合同管理；应用插件是其宿主适配，不把包实现复制进应用框架。
- Profile、Skill、Workflow 是领域资产，其 Catalog/编译/覆盖/安装仍有独立 owner；可由应用插件提供使用入口，但不因“插件化”改变资产执行信任边界。
- 生命周期内核不能依赖 Config、Storage 或完整日志插件才能完成最小装配失败报告；这些服务也不能循环依赖各自的用户界面。

### File、SQLite 与业务插件的分层

**建议采用用户提出的分层，但把“文件能力”分成两层。** `platform-files` 处理受管 I/O，`workspace-files` 处理作品路径、事件与业务访问。Project 打开、配置和租约使用前者；WorldEngine 等业务通过后者访问作品文件。否则 Project 等文件插件 ready、文件插件又等 Project ready，会形成启动环。

- 内核只管机制，不内置 SQLite 和 World 业务。基础设施插件提供文件/数据库；应用服务插件提供身份、目录、配置、Project、Storage；领域插件提供 WorldEngine/Plotbench；UI 插件提供工作面。底层不得反向 import 高层。
- “内置”“必需”“预激活”分别是分发方式、产品门禁、激活时机。必需 SQLite 提供者可以先 ready，但连接按需创建；可选 World 随产品发布也不必开机激活。“可不装”指产品装配清单能排除它，不是本轮交付运行时安装管理器。
- 基础产品清单没有 WorldEngine/Plotbench 时，项目选择、Files、基础编辑和 Settings 仍能用；对应菜单/View/tool 不提供，旧布局记录的缺失贡献可诊断但不删除其领域数据。若选择 Plotbench，其必需 WorldEngine 必须一同提供；不能用空实现让依赖检查通过。
- SQLite 插件不是 Storage 插件：前者管连接/事务，后者管状态定义、scope、owner 和读写政策；Config 又管用户设置的合并与有效值。三者不互相替代。
- 领域请求的是具名资源（数据 owner、数据域、已有 schema/迁移、读写模式、scope/代次），不是随意的绝对路径或全局连接。领域拥有表/schema/迁移含义与恢复；平台提供者校验映射并执行连接/事务机制。目标由 **Project 代次作用域内的 database 资源 owner** 唯一管理 `.nbook/project.sqlite` 的物理资源和全部驱动连接，不由进程级 sqlite 插件另建生命周期 owner。该 owner 经 sqlite 创建连接，在交给消费者前登记可关闭句柄与未完成获取；World 的操作级 libsql、Plot 的长寿命 Prisma、`agent-sql` 写连接均从它借用。操作结束或领域关闭只归还借用，由 owner 决定及时关闭或复用；Project 关闭先拒绝新借用并收口消费者，再关闭登记连接，失败保留 owner 与占用。迁移协调也经该 owner，仍遵守既有检查/授权策略。应用库、历史库与 RAG 库各有独立 owner，不合并成一个数据库。这个边界对受信代码防误用，不宣称隔离恶意 SQL。

### 热卸载的扩展边界与成本

**结论：现在建立正确 owner 和调用边界，以后增加“可选功能在线停用”可控；“任意插件热替换”仍是高成本能力，不能承诺补一个 `deactivate()` 就行。** 以下为设计复杂度判断，不是工时估算或已验证能力。

| 所谓卸载 | 含义 | 难度与首批选择 |
|---|---|---|
| 正常释放实例 | 关闭 View、切 Project、终止应用时释放所属资源 | 首批必须完成；也是以后停用的基础，不是热卸载 |
| 可选 UI 在线停用 | 撤入口、处理 dirty、销毁该插件的 View/订阅 | 中等；状态较局部，但仍须阻止新调用与旧异步回调 |
| 领域插件在线停用 | 多客户端、工具调用、Job、事务、依赖消费者共同 drain | 高；必须停止接纳并证明所有使用者结束；World 停用同时影响 Plot |
| File/SQLite 在线替换 | 所有依赖者移交打开文件、连接、事务及授权能力 | 很高；影响整个后端，默认要求重启而非强行保持在线 |
| 代码热升级 / 物理卸载 | 换模块版本、迁移内存状态、协议与持久格式、从分发包移除代码 | 独立工程；ESM 没有通用卸载缓存 API，不能把停用实例当作释放全部模块代码；必要时用可重启 Worker/进程边界 |

首批值得做、且正常关闭本身就需要的约束：资源/贡献归 owner，所有入口都能停止接纳，调用期间有可追踪使用关系，异步发布检查激活/Project 代次，模块顶层不创建全局资源，领域任务有真实取消/结束结果。**不提前实现**用户启停管理器、动态清单、跨版本状态搬运、万能 RPC 或每次调用都走重型代理。

未来停用协议候选：请求停用 → 计算必需消费者闭包与真实借用者 → dirty/Job 策略预检（可取消，尚未撤能力）→ 冻结该闭包新激活/新操作 → 等待/取消已接纳操作 → 先消费者后提供者释放 → 撤可调用贡献并发布停用结果。跨位置停止必须逐处确认；客户端失联不能据此宣布服务端 drained。后端权威门禁仍拦旧客户端，拒绝新工作不等于取消已接纳工作。超时/失败保持“停止未完成”、不允许新 owner 接管资源；已经执行的外部副作用不回滚，只有预检阶段可以无损取消。

重新启用产生新的激活代次；旧 handle 一律失效，不能复活。World 有运行中任务或 Plot 消费者时，不能只撤 World 的菜单。基础必需插件的停用请求首批直接要求重启，不尝试把运行系统降成半成品。由此未来主要新增的是**启停政策、依赖闭包协调和多客户端协议**，不用重写每个插件的资源所有权；若现在保留隐式 singleton/裸连接/无人管理 timer，未来成本会显著增加。

ESM 限制依据：[MDN 动态 import 的模块缓存说明](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Operators/import#module_namespace_object)：不能手动清除模块 namespace 缓存，反复加查询参数导入可能泄漏；本方案不使用该做法模拟热卸载。

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

## 数据、接口、安全、迁移、发布与回滚影响

### 数据与接口

第一批推荐不改变用户持久格式，只改变资源和能力装配。插件 owner 与持久数据 owner 建立显式映射，不能简单把插件 id 当存储目录；停用与卸载数据是两个不同动作。Config 用户策略、Storage 模块记忆、领域文件/数据库和瞬时 UI 状态仍各有真相源。

内部注册接口允许 clean cutover，必须迁移所有调用方；现有对外 Product Runtime Contract、HTTP/桌面桥、Profile SDK、资产格式和用户数据不能因为本提案允许重构而默认为可破坏。若必须改变，先列版本、迁移、备份和回滚影响再单独批准。

### 安全与隔离

内置清单是受信代码装配，不接收网络请求任意登记提供者。命令可见性与 DI 可解析性都不是授权。场景数据、插件描述中的用户字段和远端响应仍在各自边界校验；没有第三方沙箱承诺，也不让 secret、文件系统根和数据库连接成为通用插件默认能力。

### 迁移顺序与旧入口退出

| 切片 | 交付与替换范围 | 不允许的半成品结果 |
|---|---|---|
| 合同准备 | 前两片七项目标 Spec 已登记；整体路线与首个实现 Task 在 w00017 维护 | 将 planned 当作实现通过，或越过 checkout/受限动作授权 |
| 底座切片一 | 环境适配入口 + lifecycle/services/plugins 小内核；真实宿主中的受控装配可启动、调用、停止 | 只有类型/空接口；要求先装完整产品才能验证机制 |
| 服务切片二 | 最小真实服务插件 runtime-diagnostics/platform-files/sqlite；先跑真实文件与数据库 smoke | 提前搬完所有应用服务；用 mock echo 冒充真实资源路径 |
| Lab 边界 | 移出全局产品宿主，保留组件展示与命令专门场景 | 为了纯展示删掉真实组件验收，或建立第二套产品插件 Lab |
| Files 纵向链 | 从启动清单到 Project、文件服务、View、命令、Storage 和关闭 | 只创建 Plugin 类型，真实页面仍走旧装配 |
| Settings 纵向链 | 跨 Project 配置与前端设置入口 | 所有服务 scope 被 Files 样板写死成 Project |
| World/Plot 领域链 | 从外部插件作者视角贡献设置、View、命令、工具，借用 Project 资源；随后再迁角色、Agent、桌面等其它能力 | 为新功能改内核或主页面编排；一次停用 UI 顺手停止后台；域数据被通用存储接管 |
| 退出旧入口 | 每条链路通过后删除其旧页面注册/单例入口/释放路径 | 两个可独立写入或关闭同资源的 owner 长期共存 |

环境与机制、最小服务先各自形成可运行交付，然后按 Lab → Files → Settings → World/Plot 逐条替换。身份、配置、Session、Project、Storage、命令、View Host 等随首次真实消费接入，不要求切片二先迁完所有服务。每条链只有一条生效装配路径；不存在以“后续清理”为由长期保留的双 owner。

代码级回退只适用于持久格式兼容且旧运行实例已停止的情况；不能同时启动新旧 owner 访问同一有排他要求的数据根。发生数据格式变更时，回退依赖经验证的迁移/恢复方案，不承诺简单 revert 即安全。Product Image、Manager 与桌面发布门禁仍由既有 owner 管理。

## 项目质量与验收地图

这是未来实现的质量合同建议，不是本轮通过报告。运行时语义用隔离测试宿主与正式产品路径验证；Component Lab 只提供视觉与局部交互证据。所有运行数据遵守[测试与临时根合同](../../../../docs/testing/README.md)，不接真实用户根或默认调用 Provider。

| 场景 | 必须能观察到的结果 | 验证层面 |
|---|---|---|
| 服务缺失、重复提供或依赖环 | 静态预校验拒绝的入口无业务副作用；运行期环阻断发布并收口已发生初始化。失败定位到相关绑定和必需消费者，不误伤健康上游；涉及启动必需能力才阻止 ready | 内核合同与产品门禁 |
| 两个调用并发首次使用同服务/插件 | 一次初始化，同一作用域内一致结果；不同窗口/作用域不串实例 | 内核与宿主集成 |
| 依赖初始化中抛错或被取消 | 已取得资源收口，不发布半成品，依赖消费者明确失败 | 故障注入 |
| 激活失败后无关功能继续使用 | 可选失败隔离；启动必需失败不假 ready | 产品门禁 |
| 作用域关闭期间迟到初始化完成 | 不重新发布 handler、View 或可用句柄 | 并发合同 |
| 两窗口共享 Project，一窗口退出 | 仅该窗口访问释放，另一窗口继续工作 | 隔离后端与多客户端 |
| 同路径 Project 关闭重开 | 旧命令、订阅和异步写请求不能改投新代次 | Project/服务集成 |
| 隐藏 Agent View 后后台任务继续 | UI 状态不改变任务授权与终态；显式取消另走任务合同 | 真实产品路径，无模型调用亦可验证生命周期 |
| 关闭消费者时仍需依赖 flush | flush 有效，消费者终止后提供者才关闭；新业务被拒绝 | 关闭顺序与故障注入 |
| cleanup 抛错、挂起或进程被终止 | 错误可定位、不假报 closed、不提前释放排他租约；重启按领域合同恢复 | 真实进程/受管资源 |
| 必需 Session Store 租约获取失败或运行中失效 | 获取失败不接纳业务；失效停止受影响写入并进入领域停机，不能随 UI 关闭提前释放，也不声称具备强 fencing | 持久化门禁与真实进程 |
| 远端写入后断线 | 不自动重放非幂等写；能区分失败与结果未知 | 协议与领域恢复 |
| 登录身份改变 | 旧访问不能复用，敏感订阅/缓存按合同失效 | 授权边界 |
| 切换 Lab fixture | 没有残留产品命令/快捷键/共享实例，组件仍能展示 | 局部运行与浏览器 |
| 配置/Storage 消费 | 定义先于绑定，scope/owner 错误被拒绝；实例关闭后数据按合同保留 | 能力接入 |
| 新增内置功能 | 只接清单/贡献与服务合同，不改主页面的初始化清理编排 | 结构审查与真实消费路径 |

质量还必须检查：依赖图和 owner 清单能被查询；诊断只含插件/作用域/阶段/原因，不泄漏 secret；启动不预先实例化全部可选功能；普通输入、滚动等高频路径不重复解析完整依赖图；关闭没有遗留监听器、timer、Worker 或不明所有者的访问句柄。性能门槛需在实际实现基线上测量，本文不捏造延迟数字。

## 决策记录与下一步

| 日期 | 决策者 / 状态 | 记录 |
|---|---|---|
| 本轮对话 | 开发者已确认 | Lab 暂只做组件展示；生命周期同时考虑运行位置与资源作用域；现有前后端设计可推翻重构；能成为插件的模块尽量成为内置插件 |
| 本轮对话 | 开发者授权交付 | 总体架构提案、能力地图、生命周期矩阵、内置插件划分表及文档/项目质量检查；没有产品实施或受限动作授权 |
| 2026-09-20 | 先前推荐（历史阶段） | D1 小内核与显式 DI；D2 声明登记与激活分离；D3 有序关闭；D4 跨位置协议与授权分离；D5 Lab 全局产品宿主退出。当时仅A1–A3明确批准；后续基础架构与两切片规范规划的批准见下文，热卸载扩展仍未纳入 |
| 2026-09-20 | 开发者接受 A1 | 必需服务也以插件提供；首批随产品发布且不任意热卸载，同时要求评估后续热卸载机制与扩展难度 |
| 2026-09-20 | 开发者接受 A2 | 显式关闭先处理 dirty/在途操作；强制退出不承诺保存成功；窗口离开不自动关闭后台共享资源 |
| 2026-09-20 | 开发者接受 A3 | 先收回 Lab 产品宿主，再以 Files 与 Settings 两条真实链路验证装配 |
| 2026-09-20 | 开发者要求继续设计 | 补生命周期划分、代码模块规划、B/S 启动示踪链、WorldEngine/Plotbench 的配置/View/Agent 工具/资源接入；评估 File/SQLite 基础插件与可选领域插件分层 |
| 2026-09-20 | 开发者接受并要求规范规划 | 第一实现切片止于环境适配入口与小内核，要求可验证、规范、灵活；第二以内置服务插件验证；之后从外部插件作者角度推进功能。先落前两片 Spec、Work、整体实施方案与 Task，不立即实施 |
| 2026-09-20 | 开发者决定实施基线 | 等 w00003 完成并合并到 master，再考虑从 master 创建 w00017 worktree；不在 w00003 继续开发，不从其中途检查点分叉。当前继续规范与治理文档，不提前实施 |

前两片行为真相源现为注册表的七项 `planned` Spec；实施路线和具体任务由 w00017 拥有。下一步等待 w00003 合并 master 并满足治理登记基线，再落实从 master 创建 worktree 后执行首个实现 Task。后续功能按真实结果细化原有 Spec；第三方 SDK、热卸载扩展、数据迁移或公开协议变化仍需独立取舍。规划批准不代表已有实现、验收或远端授权。
