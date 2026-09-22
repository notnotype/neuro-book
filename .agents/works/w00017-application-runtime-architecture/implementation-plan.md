# 应用运行时：从地基到真实功能的实施路径

## 目标、状态与授权

2026-09-20 开发者批准分段推进：环境适配入口与小内核 → 内置服务插件 → 从外部插件作者视角实现功能；实际功能顺序 Lab → Files → Settings → World/Plot。前两片先落目标 Spec，再规划实施。本文是 [Work](README.md) 的工程路径，不是第二份行为合同；行为唯一正文见 [Spec 注册表](../../../docs/specs/README.md)。

当前只有治理与规范交付，没有产品代码、服务运行、数据迁移、提交或 worktree 创建。下面新增的目录、符号方向和 smoke 命令均为实施目标，不能直接当作已存在工具。本轮不会执行它们。

## 分段原则

1. 首片做到地基可运行即止：不以“还没有 Files”掩盖内核无法独立启动/停止，也不为验证地基先启动整个 Agent/Project。
2. 第二片是最小真实基础服务集合（诊断、文件、SQLite），不是先水平搬完所有应用服务。身份、配置、Session、Project、Storage、命令、View Host 在 Files 等首次真实消费时接入。第二片最终交付真实 I/O，不以 mock/空 handler 通过。
3. Lab 先从产品宿主退回组件展示，再切产品路径。每条功能链迁移所有消费方和关闭责任，旧 owner 随该链退出，不保留双写/双清理。
4. Spec 规定可观察合同；本文规定文件、顺序和验证。`planned` 不等于当前实现，不靠先写一个泛化大框架证明“灵活”。

## 切片与模块清单

| 切片 | 交付模块 | 结束时必须能观察什么 | 明确不做 |
|---|---|---|---|
| 一：环境与小内核 | application-bootstrap；runtime-lifecycle；service-composition；plugin-runtime | 浏览器和后端适配器启动受控清单，登记/激活/调用/停止；并发、缺依赖、取消、失败和迟到完成都有明确结果 | 真实产品服务接线、Files/UI、全局单例兼容层、Desktop/Worker 全适配、热卸载 |
| 二：真实基础服务 | runtime-diagnostics；platform-files；sqlite | 经同一插件机制真实写文件/事务提交回滚/关闭重开，资源无残留；失败不假 ready/closed | Project/Agent 全量迁移、跨库事务、自动迁移、网络模型、日志平台 |
| 三：Lab 边界 | Lab 独立清单；场景局部命令/依赖宿主 | 无默认产品 registry/Project/Storage；组件、元素检查器、数据/事件检视仍可用 | 新建“插件 Lab”；删除真实组件样板 |
| 四：Files 纵向链 | 进程装配 + identity-access/configuration 核心/session-persistence/project-directory；Project/database/history/file-index；workspace-files/storage；command-system/workbench-host/files-view | URL→身份→配置/列表→打开/ready→Grid/View→真实文件树/刷新/状态恢复→释放绑定；第二窗口与后台不被顺带关闭 | 先搬完 World/Plot；对原 API 空实现；未登记的第二数据库 owner |
| 五：Settings 纵向链 | configuration 定义/有效值/受控写入；用户/Project 适配；settings-ui；theme-presentation；需要时独立 Profile Catalog | 用户设置在切 Project 后保留，项目设置精确绑定；设置定义无需领域激活，秘密字段不泄漏 | 把通用设置塞 Storage；把整个 Harness 作为基础配置前置 |
| 六：World/Plot 纵向链 | world-engine；plotbench→world-engine；artifact-compiler；agent-tool-catalog；可选 embedding/subject-memory-rag 适配 | 配置/View/命令/tool 仅经公开合同接入；UI与工具消费同一领域服务，无需改内核或页面总编排 | 第三方安装市场；Plot 缺 World 仍假成功；真实模型默认调用；改领域表/数据格式 |

后续 Agent UI、角色、桌面和维护模块不是本轮三个基础层的完工条件，按已有 Proposal 路线另以真实消费者触发。

## 规范清单与唯一归属

| 切片 | capability | 正文 |
|---|---|---|
| 一 | runtime.lifecycle | [资源生命周期](../../../docs/specs/runtime/lifecycle.md) |
| 一 | runtime.services | [服务装配](../../../docs/specs/runtime/services.md) |
| 一 | runtime.plugins | [插件运行时](../../../docs/specs/runtime/plugins.md) |
| 一 | runtime.application | [环境适配](../../../docs/specs/runtime/application.md) |
| 二 | runtime.diagnostics | [诊断](../../../docs/specs/runtime/diagnostics.md) |
| 二 | platform.files | [平台文件](../../../docs/specs/platform/files.md) |
| 二 | platform.sqlite | [SQLite](../../../docs/specs/platform/sqlite.md) |

后续 `ui.component-lab`、`workbench.commands`、`workbench.quick-open`、`storage.boundaries`、`storage.persistence`、工作台/编辑器沿原 capability 修订。后四项及部分 UI 实现在 w00003 未提交工作中，master 不包含同样状态；不在 master 为它们新建“插件专用版”。Config/Project 等原有缺口在该链实施前补齐恰当独立能力，不用 `runtime.plugins` 取代业务合同。

## 模块落点、接口与依赖

以下相对 `packages/neuro-book/`，为规划，沿 [Module 合同](../../../docs/modules/monorepo-boundaries.md)；不新增 npm 包、公开 exports 或依赖框架。

| 模块 / 规划落点 | 对外接口方向 | 允许依赖 | 不允许 |
|---|---|---|---|
| runtime/lifecycle/ | 创建作用域、登记资源/未完成获取、接纳操作、结束与只读状态；统一 owner/代次/result | 纯 TS/标准异步原语 | OS/Vue/Nitro、Project、数据库驱动、日志服务 |
| runtime/services/ | 类型化服务 token、提供/消费声明、按scope解析、必需闭包诊断 | lifecycle | 任意字符串万能 locator、自动扫描、隐式“当前 Project” |
| runtime/plugins/ | 纯描述目录、环境entry、声明依赖、按需激活、贡献事务与撤回 | services/lifecycle | Files/Config/命令业务实现，import 时 I/O |
| app/runtime/ | 创建浏览器实例与静态清单；把本地能力/远端代理交给运行时；停止监听 | 机制、客户端平台合同 | server/features、数据库对象、在页面创建第二容器 |
| server/runtime/ | 后端环境入口与受控/正式清单选择；接纳/停止适配 | 机制与明确能力工厂；整合现有 product-startup/shutdown | 各服务各建一套进程信号/退出流程 |
| app/features/、server/features/ | 薄 entry：提供/消费/贡献；原领域服务仍为算法 owner | 声明的合同与自身实现 | 深导入其它 entry、通用容器传给纯组件 |
| shared/features/ | 必要的纯描述/DTO/schema | 纯合同 | secret、I/O、驱动、可执行服务实例 |

首片不必给每行建 barrel/index/types/factory 四件套。公开接口包含返回值、错误类别、owner、并发和失效条件；命名在实现 Task 内按实际类型统一，不用 Spec 固定类图。无装饰器/反射容器，优先闭包和显式构造；`strict`、穷尽联合、未知边界立即收窄，遵循 [TypeScript 规范](../../../docs/standards/code/languages/typescript.md)。

### 内核与适配入口的具体关系

- 机制构建顺序：lifecycle → services → plugins。环境输入合同可以先定义；可运行适配器在机制完成后集成，不能把“适配最根本”误解为必须先写依赖未就绪的框架外壳。
- 宿主上下文只提供实例/位置、根能力、取消/停止来源、最小输出。服务解析只交给声明的消费者，不给任意组件传 container。
- 后端适配器负责一个明确实例；进程信号映射使用受管验收进程，正式产品切换前不重复挂接现有 shutdown controller。
- 浏览器适配器独立于 Vue 页面；真实浏览器 smoke 载入同一模块，显式启动/销毁测试实例。第一片不挂主 `app.vue` 或 LabShell，不读取认证/config API。
- 受控插件仅证明公共机制，没有产品含义；第二片完全替换为真实服务提供者后复用同一调用与关闭边界。

## 切片一实施单元与验收

这些是工程顺序，不是提前创建的 Task 队列。当前只登记 [t05 资源生命周期](tasks/t05-runtime-lifecycle/README.md)；完成后按其真实接口与证据创建下一个 Task。每单元聚焦一个可判定结果，通常 3–5 个实质文件，涉及配置的机械接线明确计入。

| 单元 | 文件与修改方向 | 验收 / 停止点 |
|---|---|---|
| 资源生命周期 | 新 runtime/lifecycle 模块与相邻合同测试；建立无产品setup的机制测试/类型检查入口 | 单独调用方跑创建→使用→关闭；消费者flush、取消竞态、失败资源保留、显式恢复可证；不是只导出类型 |
| 服务装配 | runtime/services 的token/声明/解析与测试；消费已完成生命周期入口 | 同scope单次初始化、不同scope隔离；重复provider/缺依赖/静态与动态环可定位；禁止短寿命捕获与旧代次重投 |
| 插件与贡献事务 | runtime/plugins 描述/激活/receiver合同及测试；使用真实服务装配 | 登记不激活；并发消费只共享激活而不合并两次业务调用；中途失败撤回本次贡献、late success不能发布 |
| 后端环境适配 | server/runtime 下明确适配模块；scripts/smoke/runtime-foundation.ts 的后端模式 | 启动结果共享；合作停止真实进程；机制不依赖Nuxt/Project，停止不杀非自有进程 |
| 浏览器环境适配 | app/runtime 下独立适配模块；同一 smoke 的浏览器模式/临时页面 | 真实browser启动/调用/显式销毁；双窗口不共享对象；不加载server bundle；不假定unload会await |
| 首片集成复核 | 合并公共API、最小消费示例与同一smoke入口；移除纯实验脚本 | 四项合同全部有证据才报首片完成；全部required问题消解，产品行为仍未切换 |

测试配置现状已核实：应用 `vitest.config.ts` 默认加载 Agent setup，且 include 不含新 `runtime/**`；应用 tsconfig include 也未直接覆盖新机制目录。因此第一单元必须提供/接入显式 `root`、统一 Temp setup 且无 Agent setup 的机制验证配置，不能只写测试文件然后误以为它会被运行。建议新 `vitest.runtime-foundation.config.ts` + `tsconfig.runtime-foundation.json`，保留应用原配置用于后续集成；不要修改全仓配置来孤立绕过失败。

### 第一片拟新增命令（尚未存在）

在应用包 cwd，由实施单元随入口一起新增：

- `bun run test:runtime-foundation`：运行上述专用 Vitest 配置，覆盖 runtime、环境适配与基础服务相邻测试；测试支持 Temp setup 第一项，不加载产品/Agent 初始化。
- `bun run typecheck:runtime-foundation`：`tsc --noEmit -p tsconfig.runtime-foundation.json`，strict；验证机制、适配器和最小消费者，显式区分 DOM/后端能力，不依赖 `.nuxt` 生成态。
- `bun run smoke:runtime-foundation -- --host server`、`bun run smoke:runtime-foundation -- --host browser`：同一CLI按宿主模式运行公共入口；浏览器模式使用隔离自动化tab和临时页面，不借Component Lab。已有进程/浏览器工具按各自授权/管理合同使用，不新增发布路由。

同一 CLI 的 host 模式是验证选择，不是自动模拟环境；browser 模式未真实运行只能记未验证。后端真实进程在 hub 启动/监督，等实际就绪后再触发停止；仅进程创建成功不计成功。

## 切片二实施单元与验收

| 单元 | 文件与复用边界 | 实际 smoke |
|---|---|---|
| 诊断插件 | server/features/runtime-diagnostics entry、环境专用出口与测试；浏览器console+本实例缓冲，后端复用已授予日志位置的文件输出/轮转 | provider失败仍可见；敏感值不入快照；同日志位置授予冲突降级、不抢写；sink错误不破坏业务/独立清理 |
| 文件插件 | server/features/platform-files entry与root-bound service/测试；复用既有路径/锁工具的合法边界，不把 workspace-files 搬进底层 | 受控Temp内真实读写/重读、越界和reparse约束、watch释放与协作锁竞争；关闭不删除数据文件 |
| SQLite 插件 | server/features/sqlite entry、resource-owner/driver适配与测试；使用现有libsql/Prisma资源工具，驱动差异留在adapter | 同具名DB事务提交后读回、失败rollback、关闭重开持久值；借用者不能关owner、在途获取和关闭竞态、不同资源隔离 |
| 组合验收 | 同一smoke CLI加 `--services` 模式，必须消费真实三插件 | 登记→激活→文件写入→SQLite记录→关闭→重开读取；故障中无半可用句柄/越界副作用，清理失败不假closed |

第二片继续复用 `test:runtime-foundation`/`typecheck:runtime-foundation`，不新建平行测试体系。组合 smoke 不声称跨文件/SQLite 原子事务；任一失败按各资源结果报告，不自动重放或删掉成功的数据假装回滚。测试数据库 schema 是本次隔离验收资源，不执行用户产品 migration。临时根按测试规范打印/校验，在 finally 清理自身资源；数据删除/迁移等受限动作按当次 Task 取得精确授权。

**第二片通过条件**：移除任一必需提供者会明确失败；只增加一个独立受信消费者无需改内核；全部资源有owner；同scope实例共享与两scope隔离都被测；至少一条真实I/O路径完整运行并留下可恢复证据。不以“日志显示started”作为全部标准。

## 功能切片的进入与退出条件

### Lab

入口条件：前两片真实验证已完成，且w00003组件/命令/Storage基线已在当前实现checkout。原位修订该树 `ui.component-lab` 合同；本树 planned/共享树 implemented 的差异先整合，不能复制第二份Spec。

其中命令底座、常驻palette/confirmation与第五命令tab实际由 [w00016](../w00016-workbench-commands/README.md) 在w00003树交付；不能因checkout名称把该批当无主遗留。合并基线须包含此批实现/Spec；Lab切片执行前由本Work Leader记录与w00016交付owner的交接，在合并后的 `workbench.commands`、`workbench.quick-open`、`ui.component-lab` 原位调整宿主边界，保留命令底座能力与局部真实样板。历史w00016验收保留，不倒改成当时失败；新边界以w00017证据替代。

修改主要落 `app/component-lab/LabShell.vue`、命令专门fixture、场景注入与相关bootstrap。撤全局registry/palette/confirmation/命令tab；命令fixture创建并释放局部host，不依赖LabShell隐式产品注入。保留主题、场景、文档、元素检查器、事件/数据、Lab自有偏好。验收含切场景监听不残留、真实Monaco样板仍可用、无默认产品配置/Project请求；浏览器证据另按授权运行。

### Files

入口条件：Lab边界已验收；补齐身份/配置/Project最小规范缺口并沿既有Storage/命令合同迁移。按后端进程服务→Project内部opening资源→外部ready文件入口→浏览器Host/View推进，允许在本切片内再拆多个已知Task，但最终必须贯通真实URL到文件树。

主要迁移源：`server/runtime/product-startup.ts` 与 shutdown、`server/config/config-service.ts`、`server/workspace-files/project-session.ts`及模块工厂、`server/storage/`、`app/pages/index.vue`、`useProjectSession`、WorkbenchShell/Layout/ViewInstances、view-factories、commands。每个owner移交在同一子任务改所有调用者；Project↔Config/History与Config↔Harness环按提案断开，不能用dynamic import隐藏。

退出证据：多窗口同Project、关闭重开同路径、切换时迟到请求、刷新命令、状态恢复、绑定释放、停止失败；不启动World/Plot/真实模型。Grid算法不重写，描述先于恢复、实例独立于落点。

### Settings

入口条件：Files已证明Project寿命；规范明确设置定义/有效值/秘密字段/写入生效语义，Profile专用设置与配置核心分开。

目标迁移源：`server/config/`、`shared/dto/config.dto.ts`、`app/plugins/theme-colorway.client.ts`、Settings入口/组件。Config公共路由保持，用户级服务跟随身份/应用，Project设置绑定精确代次。验收跨Project保留用户设置、旧身份结果失效、未装领域仍能解释设置定义、写入失败不显示成功。Settings不能反向要求启动Harness或打开全部Project。

### World/Plot

入口条件：公开服务/贡献合同已有Files与Settings两个不同scope的真实消费者；World/Plot与工具缺席策略先在领域/Agent原Spec落合同。

主要迁移源：`server/plot/index.ts` 复合模块、World/Plot facades、对应HTTP routes、`server/agent/tools/world-engine-tools.ts`/`plot-tools.ts`、工具目录、领域工作面。拆独立entry而不是复制算法；一次切换所有HTTP/tool/UI消费，删除旧复合注册。Plot明确依赖World；数据库/历史/RAG owner不混同，编译用显式Source/Product身份，embedding不默认调用。

外部作者验收：由不掌握内核实现的执行者，仅凭已发布合同与一个最小真实示例，声明entry/依赖/设置/View/命令/tool，取得准确scope服务并完成关闭。只允许新增自身模块与产品清单登记，不应修改内核、`index.vue`初始化/清理总编排；如果必须改，先判断合同缺口而不是给内置插件开后门。配置schema、错误/取消/权限/依赖缺席有文档；不提供任意文件路径、裸全局DB或万能容器。此验收检验接口易用性，不承诺npm SDK、marketplace或不可信代码sandbox。

## 工作树决策与基线交接

**开发者已决定：等待 w00003 完成并合并到 master，再考虑从 master 创建 w00017 独立 worktree。**不继续在 w00003 开发，不从其中途检查点或脏工作树分叉，也不提前实施纯内核来绕过这一等待条件。当前只完成 Spec 与治理文档。

本轮只读观察：w00003 HEAD 为 `26479d48604d3882b8d42b9f4447c6e3f4ac69c4`，status 为 staged 7、unstaged 196、untracked 166；这是调查快照，不是未来实现基线。后续以实际合并后的 master 为准，不搬运这些未提交文件，不接管 w00003 的提交/合并。

进入实施的顺序：

1. w00003 的 owner 完成交付与获授权的合并；Leader 核实 master 确实包含所需 UI/Storage/命令实现与同一 capability 的 Spec，记录完整合并/基线 OID 和相关验证，不复用旧370测试结果为最新绿灯。
2. w00017 登记按 [Work编号合同](../README.md#编号分配与记录位置) 经单独授权进入远端 master，成为实现分支共同祖先；本 Work 尚未提交，不因已写文档跳过。
3. 在两项前提都满足后再落实 worktree 创建。目标默认 `.worktree/w00017-application-runtime-architecture` / `refactor/w00017-runtime-foundation`，起点为包含两项结果的 master；冲突即报告，不覆盖、不自动改名。主工作区保持 master，不因同步强行丢弃未提交文档。
4. 对照合并后源码复核本计划文件/接口与测试入口，沿新事实修正机械路径，不重建已经存在的能力。此后 Work/Task 进度随实现分支维护，不在主树复制另一份。

等待基线只阻止产品实现/worktree 创建，不阻止当前规范规划。没有授权本轮提交、push、合并或帮助完成 w00003；不得自动轮询/推进他人工作。

## 风险与停止条件

| 风险 | 处理与停止条件 |
|---|---|
| scope/close API无法覆盖失败资源 | 在第一片故障场景暴露；改合同需回到Spec/开发者，不补成功fallback |
| 配置/Project/Agent隐式环 | 首次接入前列真实边，分离core/adapter；不靠lazy名称掩盖等待环 |
| 真实资源重复owner | 移交时迁全部创建/使用/释放者；没迁完不启用正式清单 |
| 文件路径/SQLite副作用超出授权 | smoke只使用本次Temp；用户数据/迁移/删数据/真实模型分别授权 |
| 只为“灵活”堆抽象 | 要求双宿主、双scope、三个真实服务和外部作者验证；不提前建RPC/跨版本热升级 |
| 合并后master与调查快照不同 | 首次实现前重新核对公共入口与Spec；以合并OID为准，不能复制旧脏树补缺口 |

## 当前 Task 与下一步生成规则

- [t04](tasks/t04-foundation-spec-plan/README.md)：本次Spec、整体方案、治理与审查集成。
- [t05](tasks/t05-runtime-lifecycle/README.md)：已知的首个实现单元，准备好checkout后实施资源生命周期及独立验证入口；不是整个第一片完成。
- [t02](tasks/t02-runtime-contract-review/README.md)、[t03](tasks/t03-document-governance-review/README.md)：复用独立审查职责，新报告区分每轮。

t05验收后Leader按实际API/证据创建服务装配Task，再依次推进插件、环境适配与首片集成；第二片诊断/文件/SQLite可在公共合同稳定且文件owner独立后并行。后续任务编号当时从Work最大值连续分配。每Task必须列引用Spec、准确文件、旧入口退出、定向测试/实际smoke和受限参与点；不把本文的未来单元表当作已派发任务。
