---
schema: nbook.proposal/v1
status: draft
created: 2026-11-18
decided: null
supersedes: []
superseded-by: null
specs:
  - docs/specs/ui/nested-grid.md
  - docs/specs/ui/layout-drag.md
  - docs/specs/ui/workbench-layout.md
adrs: []
---

# nb-layout 做成能发到 npm 的通用布局库

## 问题

[ADR 0044](../adr/0044-workbench-single-layout-tree.md) 第 6 条把布局工具收进 `@notnotype/nb-layout`，当时的理由是“统一用一套库、Splitter 不留两份”，没有写要给别的项目用。开发者 2026-11-16 定：nb-layout 应该是可以复用的通用布局工具，后面可以发到 npm，别的项目依赖它。

w00026 t26 让一个审查者以第三方身份，只用公开入口写了一份接入草稿（[`deep-review-api.txt`](../../.agents/works/w00026-layout-package/tasks/t26-layout-deep-review/evidences/deep-review-api.txt)，14 条）。现在第三方会碰到这些门槛：

- **包里一半是工作台的领域模型**：
  - 布局文档、投影、落点规则（`layout-doc.ts`、`layout-project.ts`、`layout-drop.ts`、`presented-ids.ts`，约 2300 行）硬要求活动栏与状态栏、三个区域名、视图容器与入口条；
  - 第三方用不上，又跟着它们一起升版本。
- **拖动控制器在应用里**：`layout-drag.ts`、`live-drag.ts`、`entry-drop.ts` 合计约 1800 行。库只给落点几何与拖动会话，第三方要自己写这一层。
- **错误不统一**：
  - 网格层与文档层是两种失败形状，各叫 `reason`、`detail`；
  - 3 个码覆盖 45 处 `rejected`，文案是中文；
  - `issues` 事件发的是累计列表。
- **入口太宽**：两个入口约 132 个运行时导出，62 个没有任何使用方，多是求解器内部件；没有机器检查守住公开面。
- **样式靠 nb-ui**：
  - Vue 层从 nb-ui 取文案端口、层级常数、菜单组件；
  - scoped CSS 读约 45 个 CSS 变量，一半是 nb-ui 的通用 token；
  - 不装 nb-ui 的样式，过渡与分隔线就不对。
- **发布物是源码**（[ADR 0029](../adr/0029-workspace-packages-publish-source-to-npm.md)）：`.vue` 与 `.ts` 要使用者的构建工具来转译，使用者的类型检查还会去查 `node_modules` 里的 `.ts`。
- **许可证是 AGPL-3.0-only**（nb-layout 与 nb-ui 都是）：第三方要依赖它，先得接受 AGPL。

## 目标与非目标

目标：

- 第三方只用公开入口，就能在 Vue 3 里搭出 VS Code 手感的嵌套网格与分隔条：
  - 按矩形摆放，不搬 DOM；
  - 两轴约束求解，收起与吸附；
  - 拖动会话与落点几何，过渡与交换；
  - 键盘可达。

  这是库的定位，README 第一句就写清。
- 工作台的行为不变，已存的布局记录格式不变。
- 公开面有机器检查：
  - 导出名清单；
  - 由类型声明汇出的 API 报告；
  - 层与层之间的依赖规则。
- nb-story、开发者面板与工作台共用同一套 Splitter：[t14](../../.agents/works/w00026-layout-package/tasks/t14-splitter-migration/README.md) 删掉 nb-ui 里冻结的那份。

非目标：

- 不做 dockview 那种开箱即用的停靠式标签布局，即通用的布局文档，加上现成的“标签拖到边缘拆分”的适配层。至少等到出现第二个使用方，看过两个形状再抽。手感引擎进库，适配层要使用者自己写。
- 不做 React 等别的框架的包装。
- 发布时机与许可证由开发者决定，本提案只给推荐。

## 当前行为与证据

| 部分 | 文件 | 规模 | 与领域有关吗 | 使用方 |
|---|---|---|---|---|
| 网格、求解、快照、过渡与交换、分隔线拖动与命中、拖动手势状态机、落点几何、排序、实时布局的候选判定 | `src/grid*.ts`、`sash-*.ts`、`drag-gesture.ts`、`grid-drop.ts`、`sortable.ts`、`live-drop.ts` | 约 4500 行（不含测试） | 无 | 工作台、Lab |
| Vue 适配与组件：`NestedGrid`、`Splitter`、`SashHandle`、组合函数、拖动会话、落点登记、`SortableList`、浮动窗手柄、落点反馈 | `src/vue/` | 58 个文件 | 无，`TabStrip` 用 nb-ui 的菜单 | 工作台、Lab |
| 布局文档、投影、落点规则 | `layout-doc.ts`、`layout-project.ts`、`layout-drop.ts`、`presented-ids.ts` | 约 2300 行 | 工作台的条、区域、容器、入口条 | 工作台、编辑器插件、SDK 类型 |
| 拖动控制器 | 应用的 `layout-drag.ts`、`live-drag.ts`、`entry-drop.ts`、`drag-presentation.ts` | 约 1800 行 | 一半：`live-drag.ts` 的手感编排几乎不耦合，`layout-drag.ts` 与入口条耦合工作台 | 工作台 |

另有一份独立设计（只拿到目标、没看主会话的方案）：[`independent-design.txt`](../../.agents/works/w00026-layout-package/tasks/t31-general-layout-library/evidences/independent-design.txt)。它的结论与本稿的推荐一致。本稿的备选 A 是主会话在看它之前写下的要点：[`main-outline.txt`](../../.agents/works/w00026-layout-package/tasks/t31-general-layout-library/evidences/main-outline.txt)。

## 方案

### 推荐：工作台层拆出去，通用层收窄、去掉 nb-ui、发编译产物

**分三层，依赖只能向下**：

- **L0 `@notnotype/nb-layout`**：纯 TS，不依赖 Vue 与 DOM。即上表的第一行。
- **L1 `@notnotype/nb-layout/vue`**：Vue 适配与组件，即上表第二行除 `TabStrip` 以外的部分。
- **L2 `@notnotype/nb-workbench-layout`**：新的工作区包，`private`，不发布。
  - 内容：布局文档、投影、落点规则、`presented-ids`、夹具、`TabStrip`，以及拖动控制器的工作台适配层（见下）。
  - 为什么另起一个包、不放进应用的工作台插件：编辑器插件、共享合同与 SDK 都用这些类型，需要一个纯 TS、在 Bun 里能测、各插件都能依赖的位置。
  - 分界判据写进包说明：文件里出现活动栏、状态栏、区域名、容器、编辑组这些词的，属于 L2。
  - `boundary.test.ts` 守住依赖规则：L0 只导入 L0；L1 只导入 `vue`、`tabbable` 与 L0；L2 只经公开入口导入 L0、L1。

**布局文档搬出，不做成参数**：

- 理由：
  - 要参数化的是条、区域、“必须有编辑组”、容器与入口条，这些概念近两周还在加；
  - 只有一个使用方，抽出来的形状没有第二个例子校验，发布之后又受版本承诺约束，改不动。
- 退出条件：出现第二个真实使用方、形状不同时，再从两个形状里抽公共部分，看哪些提回 L0、哪些做成参数（即备选 A）。
- L2 用到的 L0 名字，就是 L0 的扩展面：`GridSnapshot`、`createGrid`、`placeGrid`、上限常数等。逐个核对它们在公开入口里。

**拖动控制器拆成两半：手感引擎进库，工作台适配层留在 L2**：

- 两种拖动手感，即落点指示与实时布局，要靠两部分配合：
  - 机械部分与动画已经在库里：邻居让位、交换平移、卡片落地、浮动窗飞出飞回都在 `NestedGrid` 的过渡里；此外还有起拖门槛、指针捕获、边缘滚动、键盘拖动，落点几何，以及“候选稳定才换预览”的小状态机（`live-drop.ts`）。
  - 编排部分在应用的控制器里：卡片怎么缩小、怎么追到指针下，撕下标签，标签条里排序跟手，来源收起后按收起后的布局重判、指针不动不重判，空位粘住，两种手感之间的切换，浮动窗整窗拖动。
- 控制器的两个文件耦合程度不同：
  - `live-drag.ts`（381 行）是实时布局手感的核心，已经隔在一个 17 个回调的宿主接口后面。它对应用只有三处依赖：工作台的落点类型、“这是不是标签条”的判断、预览用的布局文档类型。
  - `layout-drag.ts`（1130 行）真耦合：导入布局文档的操作、活动栏与入口条、编辑器标签、视图容器、浮动窗尺寸常数、视图目录，配置项 22 个。它回答的是工作台的问题：什么能拖、能落在哪、放下怎么写进文档。
- 做法：
  - **手感引擎进 L1**：`live-drag.ts` 把落点、来源、预览换成类型参数，标签条的判断与落点的键换成宿主回调；`layout-drag.ts` 里与领域无关的编排一起抽出来进库，即冻结几何、来源收起与展开之后按新布局重判、指针不动不重判、空位粘住、三态反馈。先标 `@experimental`：它还在改，例如按住不动时停下帧循环是 2026-11-18 才做的。
  - **工作台适配层留在 L2**：什么能拖、落点怎么判、预览文档怎么算、放下怎么提交、活动栏与入口条、编辑器标签。
  - 别的项目接入时写自己的适配层，即给出落点、预览与提交，手感直接用库里的。
- 库里另补两样小的，消掉今天第三方要手写的接线：
  - `useDragSession(root, options)`：根出现时建会话，换根或作用域结束时销毁，返回稳定的引用。
  - `useGridHost(options)`：把 `node`、`layout`、`revision`、`contextKey`、`onGestureCommit`、`disabled` 打成一包给 `NestedGrid`。`NestedGrid` 自己量容器交给宿主，宿主不再另量一遍（t26 api-11）。
- 手势落账后、结构操作之前的意图回写（t26 api-03，今天宿主要手写的约 20 行），在 L2 提供 `applyGestureCommit`、`rebaseForOperation`。
- 适配层与引擎的分界按 t26 的 design-09、10 来：每场拖动的状态收进一个对象，判定拆成纯函数，补单元测试。

**错误与诊断一种形状**：

- 失败：`{ok: false, code, message, params?}`。`message` 是库内的英文，只给日志看，不进程序分支；宿主按码写自己的界面文字。
- 码按层定义，各是字符串字面量的联合：
  - L0 约八个：`not-found`、`stale-context`、`stale-revision`、`invalid-baseline`、`out-of-bounds`、`limit-exceeded`、`handler-missing`、`handler-threw`；
  - L2 把 45 处 `rejected` 归并成几个能区分原因的码。具体划分读完那 45 处再定。
- `issues` 事件只发新增的；最近 N 条留在一个查询接口里。
- 开发模式下的配置错误各报一次，例如 `sashSize` 为 0、没接 `onGestureCommit`。

**公开入口**：

- 两个入口改成显式清单，不用 `export *`。
- 每个入口一个测试，拿导出名与提交进仓库的清单比对，新增导出必须改清单，评审时看得见。
- 求解器内部件留在文件里，测试用相对路径导入。
- 改名：
  - 描述 `NestedGrid` 手势的 `Splitter*` 类型改成 `GridGesture*`；
  - `gesture-start` 的载荷起名并导出；
  - `DropFeedbackPreview.entryRect` 是活动栏的概念，随组件挪进 L2，或者改成可选。
- 子路径：`.`、`./vue`、`./locales`、`./style.css`。`./lab-sources` 不进发布包。
- 每个公开符号标 `@stable` 或 `@experimental`，按对应 Spec 的成熟度。

**去掉 nb-ui 依赖**：

- CSS 变量改成 `--nb-layout-*` 命名空间，每处带回退值，库内不再读 nb-ui 的变量名。桥接样式把它们映射到 nb-ui 的 token，放在 L2 或应用里：nb-ui 不能依赖 nb-layout。
- 层级常数改成 CSS 变量，并保留 `z-index.test.ts` 里的相对次序断言。
- 文案从 nb-ui 的文字端口换成库自己注入的一组标签，默认英文，另带中文；工作台用一个适配器接上 nb-ui 的端口。
- `TabStrip` 进 L2。
- 结果：
  - `dependencies` 只剩 `tabbable`，`peerDependencies` 只剩 `vue`；
  - 不装 nb-ui 时默认外观可用，有一条测试扫描 Vue 层所有 `var(--`，要求是 `--nb-layout-*` 且带回退。

**发编译产物**：

- 形式：
  - L0、L1 用 Vite 的库模式出 ESM；
  - `vue-tsc` 出类型声明；
  - 组件样式出一份 `style.css`。没引样式时界面明显是坏的，不是静默出错。
- API 报告：由类型声明汇出，提交进仓库，CI 比对差异。这是版本承诺唯一能由机器检查的做法。
- 源码包仍 `private`、`exports` 仍指向 `src`，仓库内的使用不变；打包脚本生成发布目录，照新应用与 SDK 发生成目录的先例（[ADR 0033](../adr/0033-app-delivered-as-built-npm-package.md)）。
- 承诺的宿主是 Vue 3 加 Vite；Nuxt、webpack 没有实测，不承诺。
- 这一条部分取代 ADR 0029 对本包发源码的决定：那里选源码的前提是“只承诺 Bun”，目标变成“别的项目用”之后这个前提不在了。

**版本**：

- 手工管理，独立于产品版本，先发 `0.x`。
- 补丁版本不破坏；次版本可以破坏，但必须在变更记录里单列。
- 承诺范围：
  - 标 `@stable` 的符号；
  - README 的 CSS 变量表与 `data-*` 表；
  - 快照格式：`GridSnapshot` 带版本号，1.0 起新版本必须读得了旧版本。

### 备选 A：布局文档做成通用的停靠模型，控制器一起进库

内容：

- 新入口 `./dock`：一份通用的停靠文档，含面板、标签、树、浮动窗、最大化、结构操作与落点规则。
- 骨架约束由宿主经策略对象给：固定的叶，例如今天的活动栏、状态栏；接受矩阵；哪些边能分；新 id 怎么给。
- 面板记录带宿主扩展字段（类型参数），操作原样复制、保存：工作台的 `container`、`entries`、`activeContainer` 放在这里，持久化的 JSON 形状不变。
- 在推荐方案的手感引擎之外，适配层也进 `./vue`：拿起、落点判定、提交都按通用停靠文档写好，宿主钩子接入口条这类额外落点。

好处：第三方拿到的接近 dockview 的整套能力。

不推荐：

- 只有一个使用方，扩展字段与钩子的形状没有第二个例子校验；
- 工作量是推荐方案的数倍；
- 发布后每次给工作台加概念，要么破坏，要么继续加参数。

出现第二个形状不同的使用方时，可以从推荐方案的 L2 往这条路走。

### 备选 B：单包加 `./workbench` 子路径，照旧发源码

内容：

- 不新建包。`.`、`./vue` 只导出 L0、L1，`./workbench` 导出布局文档，并标“只给工作台，不承诺版本兼容”。
- 照 ADR 0029 发源码。
- 去 nb-ui 依赖仍要做。

好处：最省事，测试、文档与导入路径几乎不动。

不推荐：

- 发布包仍带着约 2300 行与第三方无关的代码，版本号被它推着走；
- “不承诺的子路径”只靠约定守住，一次深导入就破；
- 源码发布的门槛没有解决。

开发者觉得新建包太重时，可以先走这条：之后搬进独立包仍是机械的。

### 备选 C：换成现成的布局库

- ADR 0044 第 5 条拒绝 dockview 等库的理由，对工作台仍成立：停靠时搬 DOM，多行标签、固定标签、键盘导航是付费档；另外有入口条、实时布局、卡片形状与交换过渡这些要求。
- 对第三方，本库要回答的是“为什么不选 dockview”，所以定位写成上面那一句，不和它比停靠能力。
- 外部库的现状（渲染选项、付费档、Vue 支持）凭记忆，没有重新核实。

## 影响

- **数据**：布局记录的格式不变：布局文档搬家不改 JSON。`GridSnapshot` 的版本规则见“版本”。
- **接口**：
  - 工作台、编辑器插件与 SDK 的导入路径改到 L2 包，约 40 个文件，机械改；
  - SDK 导出的名字搬前搬后各导出一份清单，要求一致；
  - 错误码与文案的迁移把测试里的中文断言改成码，规则写死，有测试兜底。
- **安全**：无。
- **迁移**：t14 把 nb-story、开发者面板换成 nb-layout 的 Splitter，排在去掉 nb-ui 依赖之后：迁过去的 Splitter 已经不依赖 nb-ui。
- **发布与回滚**：
  - 拆分、收窄、去 nb-ui、错误形状、打包都在仓库里做，每一步工作台行为不变、各自能回退；
  - 发到 npm 是外部、不可逆的动作，npm 只给 72 小时撤回，由开发者执行；
  - 发布前加一条外部接入的冒烟：用打好的包在一个空的 Vite 项目里只用公开入口写一个最小宿主，类型检查通过，浏览器里拖一次分隔线。
- **ADR**：接受后写一份新 ADR，部分取代 ADR 0044 第 6 条（工作台层拆出 nb-layout）与 ADR 0029（本包发编译产物、nb-layout 进发布清单）。

## 对 Spec 的预期改动

- [`ui/layout-drag`](../specs/ui/layout-drag.md)：接住手感引擎的行为，从 workbench-layout 输出 38 里搬出与工作台无关的部分：两种手感、候选稳定才换预览、卡片缩小与追赶、撕下来源、来源收起后按收起后的布局重判、指针不动不重判、空位粘住、标签条里排序跟手、按住不动时不排帧。workbench-layout 输出 38 只留工作台的部分，例如活动栏与入口条上的落点、来源是容器唯一视图时的原处，其余链接过去。
- [`ui/nested-grid`](../specs/ui/nested-grid.md)、[`ui/layout-drag`](../specs/ui/layout-drag.md)：
  - 已有的行为不变；
  - “失败与恢复”改成按码列出失败；
  - “边界与兼容”写公开入口、`@stable` 的范围、CSS 变量与 `data-*` 表的位置；
  - 实现合同里的公开入口跟着改。
- [`ui/workbench-layout`](../specs/ui/workbench-layout.md)：实现合同的公开入口改成 L2 包与 nb-layout 的公开入口；文档层失败码的写法跟着改。
- 不新建 Spec：推荐方案不做通用停靠模型。选备选 A 时要新建一份停靠布局的 Spec，把 workbench-layout 里与工作台无关的落点规则、结构操作搬过去。

## 待定项

1. **布局文档放哪**：
   - 推荐搬进不发布的工作区包 `nb-workbench-layout`；
   - 也可以先走备选 B 的子路径，或者走备选 A 做成通用停靠模型。
2. **拖动控制器**：已定（2026-11-18），手感引擎进库，工作台适配层留在 L2；库里另补 `useDragSession`、`useGridHost`。
3. **发布物**：已定（2026-11-18），发编译产物加 API 报告，部分取代 ADR 0029。
4. **许可证**：已定（2026-11-18），nb-layout 发 MIT。发布前 nb-layout 不再依赖 AGPL 的 nb-ui（“去掉 nb-ui 依赖”一节）；包里带一份 MIT 的 `LICENSE`，新 ADR 写明这个包和仓库的许可证不同。
5. **发布时机**：
   - 推荐先把仓库里的几步做完，到“可以发布”的状态，t14 迁完、有第二个使用方以后再发；
   - 另一个选项是做完就发。
6. **和 t14 的先后**：推荐 t14 排在去掉 nb-ui 依赖之后。

## 决策记录

- 2026-11-16 开发者：“nb-layout 应该是可以复用的通用布局工具，后面可以发到 npm，其他项目依赖他”。即 t26 里问的三个定位（甲：工作台专用；乙：工作台层挪到子路径；丙：通用库）里选丙。
- 2026-11-18 开发者看草稿的待定项：
  - 第 1 项同意推荐：布局文档搬进不发布的工作区包。
  - 第 4 项：nb-layout “可以发 MIT”。
  - 第 5、6 项同意推荐：先在仓库里做到能发布，t14 迁完、有第二个使用方再发；t14 排在去掉 nb-ui 依赖之后。
  - 第 2 项：开发者指出拖动控制器是调得最久、两种手感都靠它的地方，问它是否耦合应用、库的布局模型是什么。主会话答：手感的编排一半已经隔在接口后面，可以进库。推荐改成“手感引擎进库，工作台适配层留在 L2”，开发者同意。
  - 第 3 项同意推荐：发编译产物。
  - 开发者要求设计审查加拉远看与实际体验。
