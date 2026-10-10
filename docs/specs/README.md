# NeuroBook 规范编程

`docs/specs/` 是 NeuroBook 产品、模块和组件规范的唯一落点。Spec 用受约束的自然语言写出现在或下一次实现必须成立的行为：人类不必阅读全部实现，Agent 也不能只凭一句需求猜测输入、状态、副作用或失败语义。本文件只放规则、成熟度、机检项与注册表；怎么写（定位能力、先列假设、写合同、补证据）与模板见 [`writing-specs`](../../.agents/skills/writing-specs/SKILL.md)。

每项功能只有一个当前真相源。本分支按 [NeuroBook v2：并排重建应用](../proposals/neuro-book-v2-rebuild.md) 重建应用：标为“实现迁移中”的 `implemented` Spec，实现仍在旧应用 `packages/neuro-book-legacy`，迁入新应用并重新通过验收后证据改指新代码；标为“内核已迁入 `packages/nb-runtime`”的，内核部分的实现与合同测试已改指新包，宿主部分与 smoke 仍在旧应用；旧应用的其它规范与 Reference 见[旧应用的规范与 Reference](#旧应用的规范与-reference只作参照)。Monorepo / Module 的唯一正文仍在 [docs/modules/monorepo-boundaries.md](https://github.com/notnotype/neuro-book/blob/master/docs/modules/monorepo-boundaries.md)，不得另建 `docs/specs/architecture/monorepo-boundaries.md`。

## 文档分工与寿命

| 文档 | 回答什么 | 寿命 |
|---|---|---|
| 提案 | 为什么做、有哪些备选、怎么取舍 | `accepted` 后正文冻结；之后的变化写进 Spec 或新的提案、ADR，原提案只在 frontmatter 记 `superseded-by` 或在决策记录追加一行（[提案规则](../proposals/README.md)） |
| ADR | 一个难以逆转的架构决定和它的理由 | 不改，只能被新的 ADR 取代（[ADR 规则](../adr/README.md)） |
| Spec | 现在或下一次实现必须成立的行为 | 行为变化时原地改；唯一的当前合同 |
| 计划（`plan.md`） | 这一次怎么做：内部设计、切片、验收映射、验证 | 实施中随事实修订；Task 完成后留作历程 |
| Work、Task README 与证据 | 切片怎么推进、做到哪了、证据在哪 | 随工作推进，完成后冻结 |
| 代码注释、模块头、包 `AGENTS.md` | 代码里看不出来的原因与约束、目录约定 | 随代码改 |
| 测试 | Spec 条目与场景的可执行版本 | 随 Spec 改 |
| Skill | 怎么写、怎么审、怎么做 | 随方法改进 |

同一件事只在一处写正文，其它地方链接。计划的验收映射写 Spec 编号，不复述内容；计划里的内部设计在完成后仍需要知道的，进代码注释或模块头，不回写 Spec。

## 两种成熟度，一个文件

每个可独立验收的能力只有一个稳定 Spec 文件，使用 `status` 表示成熟度：

| 状态 | 含义 | 权威边界 |
|---|---|---|
| `planned` | 已批准、尚无代码完整支持的目标合同 | 规定下一次实现必须达到的行为；不能用来宣称当前产品已有该能力 |
| `implemented` | 已由代码和验证证据支持的当前合同 | 规定当前产品行为；与代码或测试冲突时视为缺陷并停止猜测，核实后修正错误的一侧 |

不创建 `*-draft.md` 与 `*-current.md` 两份正文。能力实现后，原文件从 `planned` 原地晋升为 `implemented`。

- **已实现的 Spec 加新行为**：整块新能力另起一份 Spec；在已有能力上加几条行为时，新条目末尾标“（planned）”，实现并验证后去掉标记，不写 Task 编号。
- **已实现、待晋升**：`planned` 的 Spec 实现后照常写三条证据标签（见[实现合同与证据](#实现合同与证据)）；注册表“说明”列只写一句范围并加“待晋升”，不写实施历程。晋升为 `implemented` 由开发者批准。

提案的 `draft`、`reviewing` 表示方案尚未批准；Spec 的 `planned` 表示目标行为已经批准。未批准需求不能进入 `planned` Spec。

## 共同行为合同

所有 `kind: behavior` 的 Spec，无论成熟度，都用黑盒语言写下面九节。九个名称是固定二级标题，供机器稳定提取；不适用的写一行“无”，不改名或合并章节。

1. **目标与非目标**：解决什么问题，明确不承诺什么；已知限制也写在这里。
2. **术语与参与者**：只定义本 Spec 新引入或含义不同的词；共用的词链接[术语表](#术语表)或定义它的 Spec。
3. **输入与前置条件**：触发方式、数据形状、权限、有效范围与约束。
4. **输出与可观察行为**：编号条目，每条一个可判定的行为。
5. **状态与转换**：初始状态、事件、下一状态、幂等与并发语义，以及交互合同（见下节）。
6. **副作用与数据**：持久化、文件、事件、网络、缓存和清理责任。
7. **失败与恢复**：失败码、部分失败、重试、回滚和 fail-closed 边界。
8. **边界与兼容**：只写公开接口、版本与兼容、信任边界。owner 已在 frontmatter，依赖方向写在实现合同。
9. **验收与 Smoke**：只写跨多条规则的组合场景与特殊环境（多进程、多窗口、重启、真实浏览器）；单条规则由“输出”条目本身验收。最后一行写 Smoke 入口。

`planned` Spec 把实现当作黑盒，不指定类名、函数名、算法、目录布局、框架技巧或逐文件改法。它允许约束公开接口、持久化格式和必须维持的架构边界，因为这些本身就是外部合同。

## Spec 写什么、不写什么

**必须写：**

- 对外可观察的行为：输入、输出、状态与转换、失败码与恢复。
- **交互合同**：调用方能依赖的先后与寿命——什么时候可用、什么时候作废、谁先谁后、断线或重启后会怎样。写在“状态与转换”；跨两个能力的写在提供方的 Spec，使用方链接过去。
- 对外的格式与兼容：只写兼容所需的部分（例如“库格式版本 1，不认识的版本不改写”），不写表结构。
- 编号的条目与验收场景。

**不写：**

- 实现做法：去代码与注释。
- 取舍理由与备选：去提案与 ADR。
- 历程（“随 tNN 实现”、某日改写、审查结论）：去 Task 与 git。
- 证据叙述：证据只留固定几行。

**两条判据**，逐句检查：

1. 换一种实现、行为不变，这句话要不要改？要改，就不属于 Spec。
2. 这句话能写成测试或审查判据吗？不能，就删掉或改写到能。

## 编号

输出条目、失败码与验收场景都编号。编号稳定：只在末尾追加，删除时保留空号并写“（已删除）”。测试名引用编号（例如 `Spec storage.persistence 输出 4`、`场景 7`），中间插入会让测试名对不上。

## 实现合同与证据

`implemented` 的 behavior Spec 在“验收与 Smoke”与“证据”之间加“实现合同”短节，只写三样：

- 公开入口：包入口与公开符号，不列内部文件；
- owner 与依赖方向；
- 不超过五条维护者必须知道、且有测试锁定的内部不变量。

逐函数控制流、缓存键、内部诊断原因、文件清单与实施过程属于代码注释、模块头或 Task；难以逆转且需要解释原因的内部取舍进入 ADR。这样重构内部实现时，只要行为和关键不变量不变，Spec 无需跟随文件结构改写。

“证据”一节只留固定几行：

- `批准依据：` 提案、ADR 或开发者决定的链接；
- `implemented` 另有 `实现入口：`（源码）、`合同测试：`（测试文件）、`Smoke：`（可执行脚本或测试；确实没有时写“不适用——<理由>”）三行，各链接仓库里存在的文件。

## 术语表

运行时 Spec 共用的术语收在 [运行时术语表](runtime/glossary.md)（`kind: glossary`），每个词一两句并链接定义它的 Spec。各 Spec 只定义自己新引入的词；新词被第二份 Spec 用到时移入术语表。

## architecture 与 glossary

`architecture` 只写跨能力的归属规则：哪类数据或职责归哪个能力、能力之间的依赖方向与边界。与某一个 behavior Spec 重叠的内容并入那份 Spec，architecture 只链接过去。`architecture` 和 `glossary` 可使用与内容匹配的章节，但同样必须登记成熟度、稳定 capability 和 owner。

## 文件格式

文件名和目录使用英文 kebab-case。除 `README.md` 和 `AGENTS.md` 外，每个 Markdown Spec 都必须包含：

```yaml
---
schema: nbook.spec/v1
kind: behavior
status: planned
capability: editor.html-mode
owners:
  - markdown-studio
---
```

- `kind`：`behavior`、`architecture` 或 `glossary`。
- `status`：只允许 `planned` 或 `implemented`。
- `capability`：仓库内唯一、稳定的点分标识；文件移动时不改变。
- `owners`：对行为与数据边界负责的一个或多个模块，必须使用 YAML 列表，不写临时执行人。

## 流水线

### 开发方式：规格驱动、验收先行

1. **探明**：拿不准的技术点先做小实验实测，结论进 Task 证据，不进 Spec。
2. **决定**：有长期取舍时写[提案](../proposals/README.md)，开发者接受后冻结。
3. **写合同**：按 [`writing-specs`](../../.agents/skills/writing-specs/SKILL.md) 更新 `planned` Spec。
4. **计划**：`plan.md` 写内部设计、切片与验收映射（Spec 编号 → 测试），见 [`implementation-planning`](../../.agents/skills/implementation-planning/SKILL.md)。
5. **验收先行**：每片先写这片对应条目的合同测试并看它失败，再实现到通过；交付前做变异检查。
6. **审查**：按 [`reviewing`](../../.agents/skills/reviewing/SKILL.md) 审查设计与实现。
7. **收口**：按固定标签写证据；全部有证据后，经开发者批准晋升 `implemented`。

单元层面不要求严格的 TDD；测试覆盖 Spec 条目与失败方式（[测试写法](../testing/README.md#测试写法)）。界面类改动另由 Component Lab 场景验收。Work/Task 引用提案与 Spec，记录实现、验证和交接，不复制正文。

### Bug

- 代码偏离 `implemented` Spec：Spec 保持目标不变，Task 修复代码并验证回归。
- Spec 与代码、测试和稳定用户文档共同证明的当前行为不符：这是规范事实失真；Task 修正规范并记录依据。原 Spec 已被对外承诺或测试锁定时，请开发者确认，不能由实现者单方改写。
- 现有材料能推出唯一行为、但 Spec 没写：在 Task 内补齐合同。
- 存在两个以上合理的可观察结果，或涉及跨模块、数据所有权、公开接口、安全与兼容取舍：这是产品歧义，回到提案或开发者决策，不把诊断结论伪装成当前规范。

### Code-first 与重构

Code-first 只调整已授权 Task 内的修改顺序，不绕过开发者授权、Task 范围或提案门禁。紧急修复或既有未记录行为可以先修代码，但同一 Task 完成前必须补齐或更新 `implemented` Spec；修复中出现产品歧义时先采用现有合同可推出的 fail-closed 行为，无法推出则停止请求决策。纯内部重构若不改变可观察行为，只核对现有 Spec 仍成立并在 Task 中记录行为基线；行为章节发生变化时不再属于纯重构，必须按行为变化流程处理。

## 已实现规范

| 功能域 | 当前规范 | 说明 |
|---|---|---|
| Theme | [`theme/system.md`](theme/system.md) | 主题变量和消费规则 |
| UI 设计系统与组件规范 | [nb-ui 设计与组件规范](../../packages/nb-ui/docs/README.md) | 设计语言、组件开发与滚动槽位规范、主题指南 |
| Monorepo / Module | [Monorepo 边界](https://github.com/notnotype/neuro-book/blob/master/docs/modules/monorepo-boundaries.md) | 包布局、唯一文档真相源、包级继承与覆盖、依赖方向和 worktree 根边界 |
| 测试与验收 | [`../testing/README.md`](../testing/README.md) | 测试组织、临时根、验收和证据合同 |
| 贡献与交付 | [CONTRIBUTING](https://github.com/notnotype/neuro-book/blob/master/CONTRIBUTING.md) | Issue、开发、Git、PR 与维护者交付流程 |
| Component Lab | [`ui/component-lab.md`](ui/component-lab.md) | Source Dev-only 的确定性 fixture、组件导航、检视面板、响应式容器、偏好与 Product 排除；**实现迁移中** |
| Workbench 命令系统 | [`workbench/commands.md`](workbench/commands.md) | 命令登记、`when` 求值、执行管线、暴露策略与审计；**实现迁移中** |
| Workbench 快速打开 | [`workbench/quick-open.md`](workbench/quick-open.md) | 命令搜索与行号跳转两种模式、会话 MRU、浮层键盘与焦点交接；**实现迁移中** |
| 运行时术语表 | [`runtime/glossary.md`](runtime/glossary.md) | 运行时 Spec 共用的术语，含义以出处 Spec 为准 |
| 资源生命周期 | [`runtime/lifecycle.md`](runtime/lifecycle.md) | 作用域、资源 owner、操作接纳与取消、终止、关闭尝试与显式恢复；**内核已迁入 `packages/nb-runtime`，宿主与 smoke 迁移中** |
| 显式服务装配 | [`runtime/services.md`](runtime/services.md) | 唯一提供者、依赖与寿命检查、并发初始化共享与失败稳定、调用方身份、按调用方门面与委托；**内核已迁入 `packages/nb-runtime`，宿主与 smoke 迁移中** |
| 插件描述与激活 | [`runtime/plugins.md`](runtime/plugins.md) | 描述目录、入口与代次、贡献事务、局部失败与普通关闭、按调用方提供项、委托与远程提供项，不含热卸载；**内核已迁入 `packages/nb-runtime`，宿主与 smoke 迁移中** |
| 环境适配与应用门禁 | [`runtime/application.md`](runtime/application.md) | 浏览器与后端环境适配、启动门禁、接纳、有界停止、实例身份、子实例与租约；**内核已迁入 `packages/nb-runtime`，宿主与 smoke 迁移中** |
| 运行时诊断 | [`runtime/diagnostics.md`](runtime/diagnostics.md) | 有界记录与查询、脱敏、早期缓冲补写、日志位置授予与冲突降级、关闭未完成与显式恢复；**组合 smoke 仍是旧应用的 `--services`** |
| 服务端宿主 | [`runtime/server-host.md`](runtime/server-host.md) | 内核拥有进程、启动与停止序列、停止来源汇合、退出码、开发模式重启与停止、内核 RPC 端口与项目子进程；看门狗属 `runtime.stall-watchdog` |
| 平台文件 | [`platform/files.md`](platform/files.md) | 受根约束的 I/O、授予隔离、watch 与锁、关闭门禁，不是业务文件树服务；**实现迁移中** |
| SQLite 机制 | [`platform/sqlite.md`](platform/sqlite.md) | 具名资源 owner、连接借用、单库事务、代次与关闭，不自动迁移；**实现迁移中** |
| Storage 插件记录 | [`storage/persistence.md`](storage/persistence.md) | `nbook.storage` 的记录定义、user 与 project 分区、读取分类、条件保存与订阅 |
| 配置 | [`settings/configuration.md`](settings/configuration.md) | 配置项声明、默认值与用户层、项目层的合成、外部改文件即时生效、只写自己声明的项、跨实例分发与就绪；密钥与用户编辑只定合同 |
| 项目与项目实例 | [`runtime/projects.md`](runtime/projects.md) | 项目身份与登记表、项目子进程与进程间链路、宽限期与崩溃、客户端绑定、`projectsKey` 与租约、`{project}` 访问规则 |
| 书架页 | [`workbench/bookshelf.md`](workbench/bookshelf.md) | 没有项目时的首页：继续写作、书脊与列表、新建与加入、修改信息与移出书架、新鲜度与刷新 |
| 公开状态 | [`state/public-state.md`](state/public-state.md) | 公开键的声明与校验、激活时绑定与停止时撤回、本实例内的同步读取与未就绪、响应式失效 |
| 插件状态 store | [`state/store.md`](state/store.md) | `defineStore` 的 setup 写法、只读视图与 action、持久化字段的已确认值与显示、保存队列、停止时的结算 |

## 待实现规范

以下已获批准但尚未实现的目标合同必须在代码切换前满足；实现和验证闭合后原地晋升为 `implemented`。

| 功能域 | 当前规范 | 说明 |
|---|---|---|
| 工作台外壳 | [`ui/workbench-shell.md`](ui/workbench-shell.md) | 七个 Part 的几何与面板形态、紧凑呈现、布局记录与公开状态（外壳一）；容器与视图（外壳二）；拖放（外壳三） |
| 工作台视图 | [`workbench/views.md`](workbench/views.md) | 视图贡献点、声明与实现、交付状态、加载门禁、三种失败与撤回（随外壳二） |
| Storage 架构边界 | [`storage/boundaries.md`](storage/boundaries.md) | Config、Storage、内存与领域数据的归属，插件与 grid 的消费边界 |
| 工作台与插件嵌套 grid | [`ui/nested-grid.md`](ui/nested-grid.md) | 二维原语、原子手势、共享测量与宿主、scope 仲裁与绝对指针跟随 |
| 工作区文件访问与操作 | [`workspace/files.md`](workspace/files.md) | 文件读写、目录与批量操作、无覆盖冲突、逐项失败与取消 |
| 资源寻址与文件服务 | [`workspace/resources.md`](workspace/resources.md) | `方案://路径` 寻址、提供者注册与能力声明、写入来源与变更事件、bash 的真实路径规则 |
| 文件夹类型与清单 | [`workspace/folder-kinds.md`](workspace/folder-kinds.md) | 普通、内容、活页夹三类文件夹，后缀识别、XML 清单、未列入与缺失处理、渲染贡献点 |
| 插件清单、入口与服务依赖 | [`runtime/plugin-manifest.md`](runtime/plugin-manifest.md) | 清单格式、按入口声明的服务依赖、同一运行位置解析、受阻推导与启停顺序 |
| 浏览器宿主 | [`runtime/browser-host.md`](runtime/browser-host.md) | 挂载前建立窗口运行实例、引导接口、RPC 首连与断线重连、多窗口隔离、项目绑定与可分离边界 |
| 远程服务与 RPC 协议 | [`runtime/plugin-channel.md`](runtime/plugin-channel.md) | 跨实例的远程服务合同、内核路由、请求阶段与失败码、两层版本、订阅、按需激活与等待环；末节暂留 HTTP 路由贡献，待移交 `nbook.http` 的 Spec |
| 端点收集与 API 文档 | [`runtime/api-docs.md`](runtime/api-docs.md) | 对外 HTTP 路由的收集、OpenAPI 生成与展示，不含远程服务合同 |
| 插件运行期启用与禁用 | [`runtime/plugin-hot-plug.md`](runtime/plugin-hot-plug.md) | 热插拔三档、引用账本与转发器、三步停止、在途调用结算 |
| 插件安装与热升级 | [`runtime/plugin-install.md`](runtime/plugin-install.md) | 本地文件夹安装、卸载、兼容、安全模式、热升级与回滚 |
| 插件代码的装载与回收 | [`runtime/plugin-code-loading.md`](runtime/plugin-code-loading.md) | 服务端装载与缓存回收、浏览器宿主模块表、纯度检查、插件文件端点 |
| 插件公开 API | [`runtime/plugin-api.md`](runtime/plugin-api.md) | 远程形态约束、激活上下文、错误码、worker 池、私有存储、配置与密钥 |
| 主线程卡死看门狗 | [`runtime/stall-watchdog.md`](runtime/stall-watchdog.md) | 卡死检测、报告、退出码 76、Manager 自动重启与桌面呈现、提示禁用与自动安全模式 |
| 文件资源管理器 | [`workbench/files-explorer.md`](workbench/files-explorer.md) | 双模式、F1–F9 交互、剪贴板与 dirty 策略 |
| 编辑器区 | [`workbench/editor.md`](workbench/editor.md) | 编辑组与标签、文档模型（保存、冲突、外部修改）、Markdown 与源码编辑器、资源管理器的 dirty 结算 |
| Component Lab 时间线回放 | [`ui/component-lab-timeline.md`](ui/component-lab-timeline.md) | fixture 声明时间线、虚拟时钟、可复现定位与播放控件 |

## 旧应用的规范与 Reference（只作参照）

以下是旧应用 `packages/neuro-book-legacy` 时期的规范与 Reference，不是新应用的当前合同。功能迁回新应用时，按 [提案流程](../proposals/README.md) 重新确认后写入本目录。

| 功能域 | 参照 | 说明 |
|---|---|---|
| 基础术语 | [`../packages/neuro-book/docs/specs/foundation/terminology.md`](../../packages/neuro-book-legacy/docs/specs/foundation/terminology.md) | State Root、Cache Root、Workspace、Product、Agent 与安装等稳定领域语言 |
| Agent Runtime 与 Profile | [Reference: Agent](../../packages/neuro-book-legacy/assets/reference/agent/README.md) | Session、Profile、Workflow、Skill、Job、Project Workspace 与 Agent 协作协议 |
| 内容与 Project Workspace | [Reference: Content](../../packages/neuro-book-legacy/assets/reference/content/README.md) | 内容节点、正文、素材、检索、引用与 Workspace 术语 |
| World Engine | [Reference: World Engine](../../packages/neuro-book-legacy/assets/reference/world-engine/README.md) | 时间线、slice、subject、schema、calendar 与写作协作 |
| Plot | [Reference: Plot](../../packages/neuro-book-legacy/assets/reference/plot/README.md) | Story、Thread、Scene、Writer Brief、Agent 与前端合同 |
| Character | [模块需求](https://github.com/notnotype/neuro-book/blob/master/docs/modules/character/requirements.md) | 当前需求与界面字段；尚待补齐状态和失败语义 |
| 数据迁移 | [`../packages/neuro-book/docs/migrations/README.md`](../../packages/neuro-book-legacy/docs/migrations/README.md) | 有状态升级、备份和回滚入口 |
| 归档的 Spec | [`../archived/specs/`](../archived/README.md) | Agent、媒体、Agent 相关界面、模型角色选择等不在新应用壳子范围的 Spec |

## 冻结过渡规范

以下正文由旧应用持有，描述旧应用的已有实现。对应功能迁回新应用时迁入 `docs/specs/`；在此之前保持冻结，不是新规范落点：

| 功能域 | 当前规范 | 固定目标 |
|---|---|---|
| Agent Runtime 与 Profile | [`../../packages/neuro-book/assets/reference/agent/`](../../packages/neuro-book-legacy/assets/reference/agent/) | `docs/specs/agent/` |
| Content / Project Workspace | [`../../packages/neuro-book/assets/reference/content/`](../../packages/neuro-book-legacy/assets/reference/content/) | `docs/specs/content/` |
| World Engine | [`../../packages/neuro-book/assets/reference/world-engine/`](../../packages/neuro-book-legacy/assets/reference/world-engine/) | `docs/specs/world-engine/` |
| Plot | [`../../packages/neuro-book/assets/reference/plot/`](../../packages/neuro-book-legacy/assets/reference/plot/) | `docs/specs/plot/` |

## 规范缺口

以下功能在旧应用中已有代码、测试、ADR 或提案，但缺少足以判断当前行为的 `implemented` Spec。功能迁回新应用时先按本表建立规范归属：

| 优先级 | 功能域 | 现有证据 | 缺口 |
|---|---|---|---|
| P0 | 应用运行时与功能插件接入 | [总体架构提案与能力地图](../../packages/neuro-book-legacy/docs/proposals/application-runtime-and-plugins.md#能力地图与规范归属)（基础方向 `accepted`）、[产品装配设计](../../packages/neuro-book-legacy/docs/proposals/application-runtime-product-integration.md) | 前两片七项 Spec 已 `implemented`，产品进程启动与 Project generation owner 已迁入 Application；日志器/既有数据库仍走旧入口。Files 第一版两项 `planned` 合同已实施单机链，跨机器基础操作与逐条验收未完成；第二版为独立草案。命令/Storage/Lab/Workbench 沿原能力接入；Project、配置与文档会话完整合同仍有缺口 |
| P0 | 应用状态、备份与数据迁移 | `packages/neuro-book/docs/adr/0005-*`、`0008-*`、`0012-*`，`packages/neuro-book/server/backup/`、`packages/neuro-book/server/database/` | 数据所有权、备份恢复、catalog 演进和 release activation 未形成端到端规范 |
| P0 | Project 生命周期与身份 | [ADR 0007](../../packages/neuro-book-legacy/docs/adr/0007-project-close-then-open.md)、[Project Session 产品 owner](../../packages/neuro-book-legacy/server/runtime/product-project.ts)、[Root Identity](../../packages/neuro-book-legacy/server/workspace-files/project-root-identity.ts) | Product Application 持有 Project generation；完整领域生命周期仍缺 implemented Spec。新应用的项目身份、项目代次与关闭见 [runtime.projects](runtime/projects.md)，project 分区随项目代次（[storage.persistence](storage/persistence.md)）；不因此宣称全域规范完成 |
| P0 | Agent Session 持久化与历史 | `packages/neuro-book/docs/adr/0003-*`、`0014-agent-job-*`，`packages/neuro-book/server/agent/session/`、`packages/neuro-book/server/workspace-history/` | durable event、Job 历史、附件、租约和文件历史缺少统一状态与恢复规范 |
| P1 | 配置、模型与凭据 | `packages/neuro-book/server/config/`、`packages/neuro-book/server/models/`、`packages/neuro-book/shared/dto/app-settings.dto.ts` | 配置优先级、敏感字段、provider identity、错误和 UI 行为没有单一规范 |
| P1 | Markdown Studio 与编辑工作台 | [`../../vitepress/locales/zh-Hans/core/markdown-studio.md`](../archived/vitepress/locales/zh-Hans/core/markdown-studio.md)、[历史 editor plan](../../packages/neuro-book-legacy/docs/archived/plan/06-editor-workbench.md)、`packages/neuro-book/shared/editor-workbench.ts` | 用户文档与历史 plan 存在，但需要按当前代码和测试核对后转成内部当前规范 |
| P1 | Passport 与身份 | `packages/neuro-book/server/passport/`、相关 migration 与测试 | 登录、官方 origin、凭据存储和失败语义缺少当前规范 |
| P2 | Character 与 Low-code Form | `docs/modules/character/requirements.md`、`packages/neuro-book/server/low-code-form/` | 需求存在，但状态、校验、持久化、权限和失败语义不完整 |

## Reference 迁移合同

每个待迁域必须一次性完成正文分类、Profile Import、产品投影、合同测试、文档链接、工作流与打包入口切换，然后删除旧 `reference/<domain>/`。不保留两份可独立修改的正文。Project Workspace 内的 `reference/` 是用户素材协议，不属于本迁移目标。

1. 新功能先检查本表是否已有规范归属。
2. 尚未决定的跨模块方案写入 [`../proposals/README.md`](../proposals/README.md)；小型、可逆且不改变长期合同的工作可直接更新现有规范。
3. 提案获批后，先更新或创建当前规范，再在 `.agents/works/` 创建 Work 与实现 Task。
4. 实现期间如果行为变化，规范和代码在同一变更中更新。
5. 验收以规范中的可观察行为为依据；Task 完成不能代替规范更新。
6. 旧行为退出时，更新当前规范；需要保留理由时写 ADR，需要用户升级步骤时写 migration。Task 和提案保留历史但不再作为当前行为依据。

## 完成条件

一次 Spec 改动在两组检查都通过后才算完成。

**机检**（`bun run docs:check`）：

- 失败：frontmatter 的取值、模板占位、behavior Spec 九个固定章节与实义内容、成熟度登记与 frontmatter 一致、capability 精确唯一、`implemented` 证据的「实现入口／合同测试／Smoke」三条标签行及链接类型、活跃文档的相对链接与锚点、受管组件文档缺失；提案与 ADR 的 frontmatter 规则见各自 README。
- 警告：Spec 正文（“证据”一节除外）出现 Task 引用（`tNN`、`wNNNNN`）；“证据”一节出现固定标签与批准依据之外的行；current Work/Task 快照的链接问题。警告默认只逐条列出未提交改动涉及的文件，其余合成一行计数（参数见 [测试规范](../testing/README.md#验证门禁)）。

**需人工核对**：

- 每项输入、输出、状态、副作用和失败语义之间没有冲突，与相邻 Spec 的术语和失败码一致；
- 每句话过得了两条判据，交互合同写在提供方；
- `planned` 没有泄漏实现步骤，且有真实批准依据；
- `implemented` 的代码、测试和 smoke 证据覆盖正文；
- owner 真实，没有两个近义 capability 重叠；
- Task 和 PR 链接具体 Spec，或明确说明行为合同未变。
