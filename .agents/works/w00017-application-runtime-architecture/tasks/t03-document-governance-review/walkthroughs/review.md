# 文档治理与读者审查

审查对象：w00017 的四项交付（总体提案、能力地图、生命周期矩阵、内置插件划分表）、两处根索引改动、以及本 Work 与三份 Task 合同。目标读者是**不读实现源码、但需要决定是否批准该架构**的维护者。本报告按 2026-09-20 修订（提案 342 行）复核收口。

## 一、已读材料与事实基线

- [总体提案](../../../../../../packages/neuro-book/docs/proposals/application-runtime-and-plugins.md)（342 行，`reviewing`，含平台资源与 Session 持久化的定向修订）。
- 根 [Proposal 索引](../../../../../../docs/proposals/README.md) 与 [Spec 注册表](../../../../../../docs/specs/README.md) 的本轮改动（各新增一行：索引第 11 行、注册表第 134 行）。
- 本 Work [README](../../../README.md)（第 11、13–15 行），以及 [t01 架构提案与规范归属](../../t01-architecture-proposal/README.md)、[t02 运行时合同独立审查](../../t02-runtime-contract-review/README.md) 与本 Task 合同。
- 为核对证据归属而对照的树内材料（只读）：主树 `server/runtime/product-startup.ts`、`server/runtime/shutdown/product-shutdown.ts`、`server/runtime/shutdown/product-shutdown-controller.ts`、`app/composables/useProjectSession.ts`、`docs/specs/ui/component-lab.md`、`docs/specs/agent/session-store-lease.md`、`docs/specs/README.md`；w00003 共享实现树（`refactor/w00003-nb-ui-adoption`，HEAD `26479d48604d3882b8d42b9f4447c6e3f4ac69c4`）的 `app/component-lab/LabShell.vue`、`app/pages/index.vue`、`app/utils/workbench/product-catalog.ts`、`app/composables/useWorkbenchCommands.ts`、`server/workspace-files/project-module.ts`、`server/storage/project-storage-module.ts`、`docs/specs/ui/component-lab.md`、`docs/specs/README.md`。

为审查而确认的三条对照事实（本轮未修改任何被审文件）：

1. 主树 `docs/specs/ui/component-lab.md`：`status: planned`（第 4 行）；正文第 13 行写明「Lab 的导航、检视面板、组件索引形状、场景交互与失败呈现**刻意不在此定义**」；第 111 行「本规范尚未实现。」；主树注册表第 114 行仍把 Component Lab 列在「待实现规范」。
2. w00003 树同路径文件：`status: implemented`（第 4 行）；第 13 行「它提供组件导航、场景、画布、检查器和文档/事件/数据面板」；第 62 行「右侧检视面板固定提供五个 tab：`文档`、`元素`、`事件`、`数据`、`命令`」；该树注册表第 107 行把它列在「已实现规范」，第 108–109 行同时把 `workbench.commands`/`workbench.quick-open` 列为已实现。这些修订只存在于该分支，不在 master。
3. 证据可核对性（抽样）：主树三行证据与源码一致（共享启动 Promise 与迁移/租约顺序；http-drain、共享幂等关闭 Promise、失败聚合；`createProjectSessionController` 注释「只拥有本标签页的 open/presence 所有权；它从不调用全局 Project close」）。w00003 行引用的文件全部存在，LabShell 确有 `provideWorkbenchCommands`、常驻 `WorkbenchCommandPalette` 与 window 捕获监听；`app/pages/index.vue` 确在装配命令与 View 工厂；`project-module.ts` 确有 required/lazy、generation 句柄与 ready/close；`project-storage-module.ts` 按 generation 撤销 Storage 访问。提案新增的租约表述与既有 `agent.session-store-lease`（`planned`，注册表第 115 行）一致，未把该合同升级为强排他或 fencing。

## 二、发现

### 1. 一般（建议本轮修正）：D5 要「原位修订」的 Lab 第五个 tab 合同在主树定位不到，同表链接指向不含该合同的文件

位置：提案第 160 行（D5 第 4 条）与第 183 行（「对既有 Spec 的预期改动」`ui.component-lab` 行）。

原文（160）：「全局第五个“命令”tab 的当前合同需要原位修订；命令专属检查转入对应场景，不借此新增一个通用插件 Lab。主题、文档、事件、数据等展示能力继续保留。」
原文（183）：「| `ui.component-lab` | 更新`[既有文件](../../../../docs/specs/ui/component-lab.md)`，不复制宿主规范 | …」

影响：该链接解析到主树文件，而主树文件是 `planned`，第 13 行明确「检视面板…刻意不在此定义」、第 111 行声明尚未实现，正文没有任何 tab 清单；承载「第五个 `命令` tab」的现行合同只在 w00003 树（`implemented`，第 62 行五个 tab）。相邻两行（`workbench.commands`/`storage.*`）都用「w00003 已有 …；合入后沿同一 capability 原位修订，不在主树另建同名副本」标注了归属，本行没有。结果是：只读 master 的批准者无法找到 D5 要求修订的正文；实现者若照链接动手，会在一个刻意推迟检视面板定义的文件上「修订」，或另建第二份 `ui.component-lab`——正是相邻行要防的结果。

最小修正：本行按相邻行体例补归属，例如「主树同名文件仍为 `planned` 且不定义检视面板；第五个 `命令` tab 等现行 Lab 面板合同目前只在 w00003 树 `docs/specs/ui/component-lab.md`（`implemented`），合入后沿同一 capability 原位修订」。

### 2. 一般（建议本轮修正）：D5 的「只保留」清单漏掉现行 Lab 合同中的「检查器 / 元素」检视

位置：提案第 155 行（D5 推荐行），并见第 160 行。

原文（155）：「**推荐：**LabShell 只保留导航、场景、画布、主题、文档、通用事件/数据检视和 Lab 自身偏好，不创建产品插件宿主或产品级注册表。」
原文（160）：「…主题、文档、事件、数据等展示能力继续保留。」

影响：D5 引用的现行 Lab 合同（w00003 树第 13、31、42、62 行）把「检查器」列为 Lab 提供的组成部分，并有专门的「元素」tab 与检查模式验收；D5 的保留清单没有列它，而该句又是「只保留…」的穷尽式表述。两种读法都成立：按字面读，元素检视被移除；按上下文读，这只是简写。批准者与实现者无法据此判断该能力保留还是移除，字面执行还可能以「符合 D5」为由删掉现行合同要求的能力。

最小修正：把「元素/检查器」写进保留清单，或把穷尽式表述改为非穷尽式，例如「保留除产品宿主与产品快捷键以外的现有组件展示与检视能力（导航、场景、画布、元素/事件/数据检视、主题与偏好）」。

### 3. 一般建议：新增 P0 行与相邻「Desktop、安装与 Product Runtime」行都主张产品启动/关闭

位置：`docs/specs/README.md` 第 134 行（本轮新增）与第 135 行（既有）；相关提案第 173 行。

原文（134）：「…运行位置、作用域、DI、插件激活及产品启动缺少统一合同…」
原文（135）：「| P0 | Desktop、安装与 Product Runtime | … | 安装状态机、UAC、启动/关闭、升级、卸载和失败恢复未汇成当前规范 |」
原文（173）：「| `application-bootstrap` | 环境适配、产品清单、启动门禁与跨位置协作 … | `runtime.application`，候选 `docs/specs/runtime/application.md`；Web/桌面启动、部分可用、真实停机 |」

影响：两行相邻且都涵盖「产品启动/关闭」；提案把「启动门禁与跨位置协作…Web/桌面启动、部分可用、真实停机」判给候选 `docs/specs/runtime/application.md`，而「对既有 Spec 的预期改动」表没有 Desktop/安装行来裁定边界。提案获批后，两行都可能开出各自的生产启动/关闭 Spec，与注册表「每项功能只有一个当前真相源」的要求冲突，批准者也无法从索引判断该能力是否已由运行时提案接管。

最小修正：在新增行或提案预期改动表中写明切分，例如「启动门禁、停机与跨位置装配语义归 `runtime.application`；安装状态机、UAC、升级、卸载与发布资产仍归 Desktop/安装 owner」。

## 三、复核期间已由 Leader 集成修正的一项

- Work 此前只登记「当前任务：t01」，未列出已创建的 t02/t03 审查 Task；现 Work README 第 14–15 行已分别链接 t01（leader）与 t02/t03（reviewer），并注明「只写各自报告，提案由 Leader 集成」。该问题在本报告复核时已不再存在。
- 提案加入 `platform-resources`、`session-persistence` 后，模块 id 仍保持「提议的稳定身份、未登记 Spec」的声明；租约归属显式让位既有 `planned` 规范，未制造第二个真相源。未发现该修订在我的审查维度内引入新缺陷。

## 四、逐维结论

- **四项产物完整性**：总体方案、能力地图、生命周期矩阵、内置插件划分表均有正文，质量与迁移策略、决策记录齐备；根 Proposal 索引要求的最小结构八项可逐一对应，未发现以四套重复正文代替一体维护的情况。
- **成熟度与授权边界**：提案 `reviewing`（第 5 行）、两处索引标注 `reviewing`；正文区分「开发者已确认的方向」（第 7 行）与「本次提出、尚待评审的合同」（第 8 行），D1–D5 均标「推荐」；未提前发布 `planned` Spec，未改写旧 `implemented` 合同；「批准前不登记为 `planned`」在提案、Work 与注册表中一致。唯一例外是发现 1 的 Lab 合同位置。
- **主树 / w00003 / 源码推断的区分**：第 40 行声明调查基线 HEAD 与 w00003 为「HEAD 加未提交改动、不可独立复现」，第 52 行声明不使用临时 checkout 链接、合入后需重新定位 canonical 文件；证据表逐行标注「主树 / w00003」，并明确「本文依据源码阅读，不声称运行过应用或故障实验」。抽查的主树与 w00003 声明均与源码相符。未混淆；仅「对既有 Spec 的预期改动」表内 `ui.component-lab` 行缺同等归属标注（发现 1）。
- **D5 是否落实 Lab 纯展示**：方向与授权一致（普通 fixture 不获得产品服务、命令面板等组合组件由场景局部拥有、Lab 不读真实凭据/Project/Provider、需要进程与 I/O 的验证移到隔离宿主与正式入口），与既有 Lab 规范的能力标签边界相容；精度缺口见发现 1、2。
- **Spec 归属、锚点与链接**：提案 15 个相对链接（含新增 `agent/session-store-lease.md`）全部解析成功；两处索引新增链接可解析，`#能力地图与规范归属` 与提案 `## 能力地图与规范归属`（第 164 行）一致；提议的 `runtime.*` capability 与已登记 capability 无重名，且未提前登记；归属重叠见发现 3。不含跨文件 anchor 的全仓校验。
- **质量与迁移可判断性**：验收地图（第 307–324 行）每行给出可观察结果与验证层面，并声明「不是本轮通过报告」；新增的租约门禁场景（第 319 行）可观察、可否定；迁移表（第 290–297 行）逐切片给出替换范围与「不允许的半成品结果」，回退条件（持久格式兼容且旧实例已停止）明确；不捏造性能数字。可据以评审，未见必须补全的缺失项。

## 五、检查边界与不判为缺陷的观察

- 按 Task 合同跳过 formatter、lint、build、tests 与 docs/governance 检查；`docs:check`、`governance:check`、`governance:context` 由 Leader 统一运行（t01 已记录初次结果，`governance:check` 的两项既有失败与本轮路径无关；本次修订后需重跑）。未运行产品测试、typecheck、构建、浏览器、迁移或真实模型；无提交、push 或远端操作。
- 未评审 D1–D4 的运行时语义自洽性（t02 合同范围）；本报告只覆盖治理成熟度、可理解性、证据归属、D5、Spec 归属与质量/迁移可判断性。
- 链接检查限于提案自身链接、两处索引改动与上述锚点；未做全仓 Markdown anchor 验证，也未验证指向仓库外部的链接。
- 证据核对为抽样：主树三行证据与 w00003 主要代码声明已按当前 worktree 状态复核；未逐条验证 w00003 全部未提交改动，也未复核该树在本轮期间是否继续变化。
- 「宿主」在提案中至少两种指代：插件表的 `宿主：` 依赖类别已由第 240 行图例定义为「启动适配器提供的原始能力」，D1 第 101 行同指；「View/Editor 宿主」是另一含义但均带限定词。结合上下文可推知，未判为缺陷。
- 决策记录（第 332–333 行）前两行在「日期」列使用「本轮对话」而非具体日期，与根 Proposal 索引「日期、决策者和结论」的最小结构略有出入；这是为避免猜测时间的刻意选择，且状态行（第 5 行）已记录本次修订日期 2026-09-20。未判为缺陷，若索引要求严格可在两侧统一该表述。

## 六、结论

未发现阻断交付或阻断批准的问题；四项设计对不读源码的维护者可读、可判断，成熟度与授权边界基本自洽。建议先处理发现 1、2（D5 与 `ui.component-lab` 归属精确性），发现 3 可随集成一并修正。审查通过不等于提案 accepted，也不代表已授权实施；修正后需重跑 `docs:check` 并复核受影响链接。
