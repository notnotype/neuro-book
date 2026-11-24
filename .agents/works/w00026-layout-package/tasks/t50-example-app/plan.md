# t50 计划：官方示例应用，第 5 稿（标签编组、桌面、IDE 工具窗）

## Context

**为什么做**：提案 [nb-layout 做成能发到 npm 的通用布局库](../../../../../docs/proposals/nb-layout-general-library.md) 的非目标里写着“不做 dockview 那种开箱即用的停靠式标签布局”，代价是第三方自己写“两三个编组、拆分、拖动”的玩具约 440 行（t31 体验审查量过）；缓解办法是“README 与第二档的示例”。第二档第 6 项就是这个示例。Task 记录要求开工前先看还缺什么，再定做不做、做多大；开发者 2026-11-24 说“可以做”。

**现在有什么、还缺什么**（对照 README“我要做 X 用哪个导出”那张表的每一行；“可运行、只经公开入口、读者能照抄”三条都满足才算有）：

| 要做的事 | 现有的 | 还缺 |
|---|---|---|
| 建树、拆分、收起、存快照 | README 起步（= Lab `StarterScene`，`readme.test.ts` 逐字核对，发布冒烟在空 Vite 项目里跑） | 无 |
| `restore` 加按引用的策略表、读失败保留原件 | README“约定”里一段 `restore` 片段 | 没有一份跑起来的完整读写流程 |
| 关掉一块、内容缩回去再卸载（`leave: "retain"`） | Lab `GridLeavingScene`（验收夹具，带 Spec 编号与 Lab 控件） | 没有教学用的例子 |
| 拖动会话与落点反馈（`useDragSession`、`DropFeedbackOverlay`） | `drag-session.md` 的一段选项代码；Lab `DragSessionScene`、`DropFeedbackOverlayFixture`（验收夹具） | 没有一份把它接到网格上的例子 |
| 标签条、拖标签进别的编组、拖到边缘拆出新编组 | 只有工作台（nb-workbench-layout，`private`、AGPL）与 nb-story 的领域代码 | 完全没有：这正是提案说要缓解的那一块 |
| 实时布局 | `live-drag-session.md`；Lab `LivePanelsScene`（只经公开入口，但是验收夹具） | 有一份能读的形状，本次不做（见“不做”） |
| F6 在编组之间走 | 只在 Lab `scene-support.ts` | 没有教学用的例子 |

结论：空缺集中在“标签编组”这一个形状上，正好是提案的非目标留下的那块。**推荐规模**：一个示例应用，做体验审查那个玩具的官方版（三个编组加一个可收起的侧栏，标签在编组之间拖、拖到编组边缘拆分、关标签、存取、F6），落点指示一种手感；做完按体验审查的分项重数一遍行数，作为“差距缩小了多少”的证据。规模是 Task 留下的决定，记进待确认清单。

**依据**：ADR 0054（第 6 条承诺的宿主是 Vue 3 加 Vite）；Spec [`ui/nested-grid`](../../../../../docs/specs/ui/nested-grid.md)、[`ui/layout-drag`](../../../../../docs/specs/ui/layout-drag.md)（示例只用其中已实现的行为，不改 Spec）。

**约束**：

- 只经四个公开入口（根、`./vue`、`./text`、`./locales`）与 `style.css`；不用 nb-workbench-layout、nb-ui，也不搬工作台或 nb-story 的代码（许可证不同；标签条自己写，这本身就是示例要演示的）。
- 示例是 MIT：放在 nb-layout 包目录里，由包的 `LICENSE` 覆盖。
- 不进 npm 包：包的 `files` 只有 `src`、`README.md`、`LICENSE`，`examples/` 本来就不在里面；README 用 GitHub 链接指过去。
- 库的空缺不在 t50 里补：示例里就地绕过并在示例说明里写明，空缺记进 Work 的“后续”；要给库加接口就是范围变化，停下来问。
- 面向第三方的文字里不引 Spec 条目编号（`readme.test.ts` 对 README 有同样的检查）。

## 关键设计

第 2 稿按设计审查第 1 轮（[报告](evidences/design-review-r1.txt)，重要 7、建议 11，都成立）修订，括号里写条号；第 3 稿按第 2 轮（[报告](evidences/design-review-r2.txt)，重要 4、建议 6，都成立）修订，括号里写“二轮”加条号；第 4 稿按第 3 轮（[报告](evidences/design-review-r3.txt)，重要 2、建议 4，都成立）修订，括号里写“三轮”加条号。

### `packages/nb-layout/examples/tabbed-panels/`

一个独立的 Vite 项目，第三方把目录拷走、`npm install` 就能跑。不是工作区成员（根 `workspaces` 不登记）：在仓库里，它的 `@notnotype/nb-layout`、`vue`、`vite` 从根 `node_modules` 解析（`@notnotype/nb-layout` 是指到 `packages/nb-layout` 的工作区链接，读源码入口；审查在 TS 5.9.3、`skipLibCheck: false` 下实测 0 错误）。

文件（行数是预估上限，体验审查同类分项的数在括号里）：

- `package.json`：`private`、`"license": "MIT"`，依赖只有 `@notnotype/nb-layout: "^<当前版本>"`、`vue`，开发依赖只有 `vite`、`@vitejs/plugin-vue`、`vue-tsc`、`typescript`；脚本 `dev`、`build`、`typecheck`。**它是这几个版本的唯一出处**：发布冒烟的空宿主也从这里读依赖版本，不再另写一份（12）。
- `LICENSE`：MIT 全文（目录被拷走后包的 `LICENSE` 就不在旁边了，13）。
- `tsconfig.json`：`strict`、`skipLibCheck: false`、`types: ["vite/client"]`（`types: []` 在 TS 6 下对 `import "…/style.css"` 报 TS2882，审查实测；包的对等依赖接 TS 6，1）。`vite.config.ts`、`index.html` 照常。
- `README.md`：目录、概念与阅读顺序（先 `model.ts`，再 `drop.ts`，再 `App.vue`），怎么跑；它跟着仓库 master 上的 nb-layout，可能用到还没发布的名字，照已发布版本抄的读者看对应版本的标签（12）；写明它绕过的库空缺与已知限制（见下）。不贴代码片段。
- `src/main.ts`：导入 `style.css`；开发构建里在挂载前调 `setLayoutDevChecks(import.meta.env.DEV)`（库不读构建环境，开不开由宿主定，18）；挂载。界面文字用英文，不注入文字（库缺省就是英文，示例展示“不接文字也能用”；接文字的写法 README 已有）。
- `src/model.ts`（约 150，体验审查模型 120 + 存取 30）：编组与标签的模型。
  - 状态：`groups: Map<groupId, {tabs: string[], active: string}>` 加一棵 `Grid<string>`。约定叶的 id 就是它的 `ref`：编组叶的 id 与 `ref` 都是编组 id，侧栏叶都是 `"explorer"`（二轮 6）。模型对象放在 `shallowRef` 里，每个操作成功后由调用方 `host.invalidate()`（树变了）并让编组表的响应式更新（编组表用 `reactive` 的 `Map`），再保存（8）。
  - **缺省布局与数值**（三轮 1）：侧栏保留像素 240、最小 160、可收起；右边三个编组 A、B、C 并排等分，A 有 4 个标签、B 与 C 各 2 个。`sashSize` 4。编组最小 160 宽、120 高。e2e 的视口 1440×900，每个编组约 396 宽。
  - **编组的策略只有一个出处**：`groupPolicy()` 给上面的 `minimumSize`；建缺省布局、`splitLeaf` 建新编组、载入时的解析函数都用它，载入前后同一个编组的约束相同（9）。侧栏的策略（`sizing: "fixed"`、`minimumSize`、`collapse`）同样一处。
  - **id**：新编组 `group-<n>`、新分支 `split-<n>`，`n` 取模型里现有同类 id 的最大序号加一（每次现算，不用模块里的计数器：重新载入后计数器从头数，会撞 id，`splitLeaf` 回 `duplicate-id`，3）。
  - 操作，每个返回 `{ok: true} | GridFailure`（示例自己的拒绝也用这个形状、自己的码）：`activate`、`closeTab`、`moveTab(tab, toGroup, index)`、`splitWithTab(tab, targetGroup, side)`。
    - **先做会被拒的那步**（二轮 2）：`splitWithTab` 先 `splitLeaf` 出新编组，成功了才把标签挪进去、来源编组空了再 `removeLeaf`；`splitLeaf` 被拒时模型一点没动。`moveTab` 不改树，只有来源空了才 `removeLeaf`（删叶不会被拒：叶总在树里）。都在同一个同步段里做完。
    - **选中标签的规则**（每个操作之后 `active ∈ tabs` 都成立，否则下次载入会把自己的存档判坏，二轮 2）：挪进或拆进来的标签成为目标编组的选中；来源编组被拿走的恰是选中时，选它右边的，没有就选左边的；关掉的是选中时同样。
    - **最后一个编组的最后一个标签不能关**：模型的 `closeTab` 自己拒绝（码 `last-tab`），界面也不画它的关闭按钮；`load()` 把“没有编组叶”判为存档坏（根只剩侧栏时它会被展平成占满全宽的单叶、`fixed` 失效、存档之后永远回不来，审查实测，2）。把它拖进别的编组不受限：拖走之后至少还有目标编组。
    - 提交时拆分仍被拒（试拆之后不该发生，作为兜底）时模型不变，失败交回调用方，界面在状态行里显示 `message`。
    - **放不下或会被拒的拆分在落点上就挡：试拆**（二轮 1、三轮 1）：库在拆到放不下时不拒绝、只按约束压缩（审查实测，第 4 个编组起 `over-constrained`，`splitLeaf` 一直 `ok`）；只看目标编组自己尺寸的近似太保守（第 3 轮实测：最小 190 时只放行一次，库还能再拆两三次）。`model.ts` 给 `canSplit(tab, group, side, extent)`：用 `serialize` 加 `createGrid(null)` 加 `restore`（同一个解析函数）复制出一棵临时树，在它上面照 `splitWithTab` 的步骤做（含来源编组空了删叶），再 `layout(extent)`；`splitLeaf` 被拒（深度、节点数）或布局里有 `over-constrained` 就不能拆，交回原因。`resolve` 判出拆分落点时调它，按“标签、编组、方向”缓存在这一场拖动里（拖动中树不变；尺寸变了 `structure` 会取消整场），审查实测每次 0.3 到 3 毫秒。不能拆时给 `armed: false` 的预览、`actionKey` 为 `null`（只显示不提交），反馈文字写原因（“Not enough room”“Too deeply nested”）。窗口缩小导致的放不下照库的行为压缩，写进已知限制。这也是示例里“没有 `grid.clone()` 时怎么复制一棵树”的演示。
  - 存取：
    - `save()` 写 `localStorage` 一个键：`{version: 1, grid: 快照, groups, explorerCollapsed}`。收起状态不在快照里，单独存（README“约定”的做法）。`onApplied`、结构操作之后、`host.setCollapsed` 之后都调（`setCollapsed` 不触发 `onApplied`，5）。
    - `load()`：读出、解析、`validate`，通过才 `createGrid(null, {sashSize})` 加 `restore(快照, 解析)`；解析函数按 `ref` 给侧栏或编组的策略，存档里收起状态放进侧栏的 `collapse`。
    - **存档坏的判据**（`validate` 与 `restore` 的结果合起来，10）：读 `localStorage` 抛错；JSON 解析失败；`version` 不认识；字段形状不对；`restore` 失败或 `dropped` 非空；侧栏叶不是恰好一个（二轮 6）；树里没有编组叶；编组表与树里的编组叶不是一一对应；同一个标签出现在两个编组；某编组 `tabs` 为空或 `active` 不在 `tabs` 里。
    - 坏了：原件原样另存到备份键（写备份抛错时不覆盖原键），用缺省布局，状态行说明“读档失败，原件留在备份里”；之后的保存写主键。
    - `save()` 抛错（存储满、隐私模式）时不让它冒进 `onApplied`：捕获后写进状态行并 `console.warn`，布局照常（10）。
- `src/drop.ts`（约 60，体验审查落点 37 + 指示几何的一部分）：落点规则，纯函数，输入是这一刻量到的矩形。
  - 标签条上：`resolveListInsertion` 判插在哪两个标签之间；插入位等于来源原位（自己前后两条缝）时不是落点。
  - 编组正文上：`resolveGridEdgeDrop` 判四边，中央是“移进这个编组”。
  - 自己那组只有这一个标签时，拆到自己的边与移进自己都不是落点；移进自己所在的编组不是落点。
  - 侧栏、分隔线、网格外面都不是落点。
  - 落点形状 `{kind: "insert", group, index} | {kind: "split", group, side} | {kind: "into", group}`，加 `actionKey`。
- `src/TabBar.vue`（约 70，体验审查 28）：一个编组的标签条。**数据经属性传进来**（这一刻的 `tabs`、`active` 的副本与可不可关），不按编组 id 去查编组表：编组被删、它的叶留着缩回去的那几帧，面板头里的组件还会按响应式依赖更新，按 id 查会读到 `undefined`（二轮 3）。
  - `role="tablist"`，标签是 `role="tab"`、`aria-selected`；漫游 `tabindex`，左右键在标签之间走，Delete 关掉当前标签（15、二轮 5）。
  - 关闭按钮与标签按钮并排、包在一个 `role="presentation"` 的格子里，不放进 `role="tab"` 里面（放在里面读屏读不到它，二轮 5）；带 `data-tab-close`，`aria-label` 写 “Close <标签名>”。
  - 标签放不下时一起变窄、文字省略号截断（每个标签有最小宽），标签条不滚动：滚动时库把滚出去的标签跳过，指针过了最后一个可见标签判成“追加”，线画在可见边缘、实际插到隐藏标签之后（三轮 3）。标签多到最小宽也放不下时溢出裁掉，写进已知限制。
  - 带 `data-tab`、`data-group` 供会话认来源与落点；高度是一个常数，同时给标签条的样式与内容项的 `insetTop`（7）。
- `src/TabPanel.vue`（约 20）：一个标签的正文：一个 `textarea`（叶里有能聚焦的东西，F6 才进得去；换标签、挪编组后打的字还在，演示内容项换叶不重建）。**数据经属性传进来**，不按 key 去查编组表：关掉最后一个标签那一帧，留住的内容是冻结的插槽调用，查已删的数据会抛错（`NestedGrid.md` 内容层的推荐写法，7）。
- `src/App.vue`（约 170，体验审查应用层 143 + 拖动适配 65 的一部分）：
  - `useGridHost({grid, contextKey, onApplied: save})` 绑到 `NestedGrid`；叶插槽按 `ref` 画侧栏或编组的标签条；正文经内容层，内容项 `{key: tab, leaf: group, insetTop, active, leave: "retain"}`：关掉最后一个标签时编组缩回去再卸载。`paneLabel` 给编组的显示名（“Group 2”），读屏不念生成的 id（18）。
  - **切换与关闭之后的焦点由 `App.vue` 自己给**（二轮 3、三轮 4）：操作之前记下受影响的编组，以及它在树序上前一个（没有就后一个）编组；操作成功后等下一次渲染，焦点原来在这个编组里（标签条或正文）的，给它新选中的标签，编组没了给记下的那个编组选中的标签。不接 `content-parked`：它交出的是刚去掉的那一项的 key，示例不按它查数据；正文被停放时焦点由这条规则接走。
  - `useDragSession(网格外框, …)`（8、4、6）：
    - `sourceAt` 认 `[data-tab]`，排除 `[data-tab-close]`；
    - `activate` 里先调 `NestedGrid` 的 `settleMotion()`：刚关掉、刚拆分时还有过渡在走，起拖那一刻量到的会是中间值（二轮 6）；
    - 不冻结几何：`resolve` 每次现量（标签条与标签的矩形、编组正文按 `[data-content-leaf]` 取叶外框上的正文区域），落点指示手感下布局整场不变，也跟得上标签条滚动与窗口缩放。`resolve` 一次移动可能调几次，现量只是读，不改东西；
    - `structure` 给 `host.revision`：拖动中窗口缩放、布局重发时整场取消，不拿旧的落点提交（二轮 6）；
    - `NestedGrid` 绑 `:dragging="state !== null"`；
    - `commit` 调 `model.ts` 的操作，成功后 `invalidate` 与保存，失败写状态行；
    - `onActiveChange` 写拖动中的光标。
  - 落点反馈：`DropFeedbackOverlay`，带 `data-drag-feedback`（同 nb-story，会话判落点时跳过它，二轮 10），预览矩形由落点算（插入是一条竖线，拆分是那半边，移进是整块正文），文字英文；放不下的拆分是 `armed: false`。拖动中在外框上写 `data-drop`：这一刻的完整动作，与 `actionKey` 同一个值（`insert:<编组>:<序位>`、`into:<编组>`、`split:<编组>:<方向>`；不能拆的写 `blocked:<编组>:<方向>`；没有落点写 `none`），e2e 据此断言（只写种类时会读到路径上别的落点的旧帧，三轮 2）。
  - 侧栏收起按钮走 `host.setCollapsed`，之后保存；收起状态从网格读（同 README 起步）。
  - F6、Shift+F6 调 `moveGridFocus`，返回真才 `preventDefault`。
  - 状态行：读档失败、保存失败、拆分被拒的原因；平时空着，高度固定，放在网格盒外面（文字变了不改网格的尺寸，不会让 `revision` 变而取消拖动，三轮“未发现问题”一节的提醒）。
  - 主题：在根上设几个 `--nb-layout-*` 变量演示换外观（名单来自 `NB_LAYOUT_THEME_VARS`，示例只设几个，注释说其余用缺省）。

**注释**：示例是给第一次接入的人读的，按教学材料写：逐步讲这一步做什么、为什么、不这样会怎样；不引 Spec 条目编号，要讲的规则直接写出来；讲解随 e2e 一起改。注释的语言跟包的说明走（现在是中文；提案“公开入口”一节说包内说明的语言随第二档另定，到时一起改，17）。

**绕过的库空缺与已知限制**（写进示例 README；实施中撞到新的照实补，记进 Work“后续”，不在 t50 里加接口）：

- 没有 `grid.clone()`：试拆要一棵临时树，示例用 `serialize` 加 `restore` 复制（三轮 1）。
- 没有方向焦点：F6 只有前后两向，示例照用。
- `NestedGrid` 不是泛型组件：叶插槽里 `node.ref` 是 `unknown`，示例收窄一次。
- 会话没有缺省的“交互元素不起拖”过滤与拖影：`sourceAt` 自己排除关闭按钮；不画拖影。
- 没有 `restoreOrKeep`：`model.ts` 的 `load` 就是它的完整写法。
- 同向拆分造出同向嵌套的分支，连续拆越来越深，到 16 层被拒；删叶会把只剩一个孩子的分支展平，分支自己的约束会丢，所以示例只给叶挂策略（9）。
- 放不下与会被拒的拆分靠试拆在落点上挡（见 `model.ts`）；窗口缩小导致的放不下照库的行为压缩。
- 标签多到每个都缩到最小宽也放不下时溢出裁掉；拖动不接边缘自动滚动（标签条不滚动，三轮 3）。
- 拖动只能用指针，没有键盘替代（会话支持键盘拖动，示例不接，二轮 5）。

### `packages/nb-layout`（脚本与测试）

- `package.json`：
  - `typecheck` 末尾加 `vue-tsc --noEmit -p examples/tabbed-panels/tsconfig.json` 与 `tsc --noEmit -p e2e/tsconfig.json`：CI 的 `test:affected --typecheck` 按包跑 `typecheck`，两次发布之间库的类型变了、示例跟不上时 CI 就挂。
  - 新增 `test:e2e`：先 `vite build` 示例，再 `playwright test -c e2e/playwright.config.ts`。
  - 开发依赖加 `@playwright/test`（与 nb-story 同范围）与 `@types/node`；`bun.lock` 随之改，这次提交会让 CI 的 `test:affected` 选中全部包，只此一次（11）。
- `e2e/playwright.config.ts`、`e2e/tsconfig.json` 照 nb-story 的写（本机 Chrome、Node 运行、输出目录按检出分开）。被测的静态服务由用例自己起停：`node:http` 读示例的 `dist`，端口 0，按扩展名给 `Content-Type`（模块脚本要 `text/javascript`，18）。
- `src/examples.test.ts`（bun test，13）：
  - 示例 `package.json`：`license` 是 MIT，依赖与开发依赖正好是上面列的那几个，`@notnotype/nb-layout` 的范围接得住包的当前版本（提版时示例跟着改）。
  - 示例里每条导入只能指向：示例目录里的文件；`vue`；`@notnotype/nb-layout` 与 `/vue`、`/text`、`/locales`、`/style.css`；`vite`、`@vitejs/plugin-vue`（`vite.config.ts` 用）。复用 `boundary.test.ts` 在用的 test-support `scanImports`、`sourceFiles`（跳过 `node_modules`、`dist`），它是文字扫描，含 `.vue`、`import type`、`export … from`、动态 `import()`，宁可误报：教学注释里不写完整的导入语句（写“从 `./vue` 入口导入 X”）；`new URL(…)`、`import.meta.glob` 不覆盖。示例经工作区链接读包源码，`../../src` 的相对路径照样能编译，这条测试是挡深导入的唯一一道（二轮 8）。
  - 示例的文件里没有 Spec 条目编号（同 `readme.test.ts` 的写法）。
- `src/examples.model.test.ts`（bun test，三轮 6）：直接测示例的 `model.ts`（同一个包里的相对导入，测试不放进示例目录：第三方拷走的目录里不带测试，示例的导入白名单也不放行 `bun:test`）。覆盖：选中标签的规则（拿走选中的选右邻、没有右邻选左邻、挪进的成为选中）；`closeTab` 拒绝最后一个标签（码 `last-tab`）；拆分被拒时模型不变；`canSplit` 在放不下与深度超限时判不能拆、与实际 `splitWithTab` 之后的布局一致；存档坏的九项判据各一例；载入之后新编组的 id 不撞。
- `README.md`：在“起步”之后加一节“示例应用”，一句话说它演示什么，GitHub 链接到示例目录；“我要做 X”表里“一组可拖的东西”“拖到边缘、插到两项之间的落点几何”“落点反馈”三行加一句“示例见 tabbed-panels”。

接受的代价（11）：`test-affected.ts` 按包目录取受影响的包，示例目录的改动算 nb-layout 有改动，经依赖闭包带上 nb-workbench-layout、dev-panel、nb-story、neuro-book 的测试。改一行示例注释也跑这些。不为它在 `test-affected.ts` 里加子路径例外：示例改动少，加例外是一条只服务它的特例。

### `scripts/release/pack-smoke.ts`

- 空宿主与示例共用一份依赖版本：`smokeLayoutHost` 的依赖行改成读示例 `package.json` 的依赖与开发依赖、只把 `@notnotype/nb-layout` 换成这次的包来源；空宿主的 `tsconfig` 也改成 `types: ["vite/client"]`（1、12）。
- 新增 `smokeLayoutExample`：从示例目录只拷 `package.json`、`LICENSE`、`tsconfig.json`、`vite.config.ts`、`index.html`、`src/`（不带 `node_modules`、`dist`，12）进冒烟临时根，把 `@notnotype/nb-layout` 换成 `from.spec`、加 `from.overrides`，`bun install`、`vue-tsc`（不跳过库检查）、`vite build`。证明示例照第三方的装法能对着发布出去的类型与产物编译、打包。浏览器里的行为由仓库内的 e2e 覆盖：两者跑的是同一份示例源码，产物与源码在运行期的差别由起步例子的浏览器检查覆盖。nb-layout 还是 `private` 时同样跳过。

## Spec 与文档改动

- Spec 不改：示例不引入新行为。
- `docs/standards/code/common.md` 注释一节：现有“例外：示例插件”不动，另加一条“例外：nb-layout 的示例”：读者是第三方开发者，可以逐步讲解，但不引 Spec 条目编号，要讲的规则直接写出来；讲解随示例的 e2e 改；示例 README 只做目录、概念与阅读顺序（17）。根 `AGENTS.md` 注释一节的摘要加半句指到它（根 `AGENTS.md` 有别的会话未提交的改动：用 `git update-index --cacheinfo` 只提交自己这一行）。
- `packages/nb-layout/AGENTS.md`：“许可与发布”加一条：`examples/` 是 MIT、不随包发布、只经公开入口（`examples.test.ts` 核对），与包同样不从 AGPL 的代码搬内容。
- `packages/nb-layout/CHANGELOG.md`：不写（示例不在包里，用户装到的东西没变）。
- `docs/standards/releasing.md`：“源码包先各自提版”一步加半句“nb-layout 提版时同改 `examples/tabbed-panels/package.json` 的版本范围”（三轮 5）。冒烟多的一步不写进手册：手册写的是命令，不列步骤。

## 切片

1. **示例本体**：`examples/tabbed-panels/` 全部文件。自跑：示例目录 `vue-tsc --noEmit`、`vite build`，`bun run dev` 起来手动拖一遍（开发服务经 `run_in_background`，结束停掉）。不在示例目录里 `npm install`（会留一份 `node_modules` 盖住根的 Vue，12）。
2. **仓库里的检查**：`typecheck` 接上示例与 e2e、`examples.test.ts`、`test:e2e` 与 e2e 用例、README 一节、注释例外与 nb-layout `AGENTS.md`。自跑：`bun run --cwd packages/nb-layout typecheck`、`bun run --cwd packages/nb-layout test`（含 `examples.test.ts`、`readme.test.ts`）、`bun run --cwd packages/nb-layout test:e2e`、`bun run docs:check`、`bun run governance:check`。
3. **发布冒烟**：空宿主读示例的依赖、`smokeLayoutExample`。自跑：`prox bun run release:smoke`（本机来源，工作树干净时）。

一片一个提交；都写在 worktree `.worktree/w00026-t50-example`（分支 `w00026/t50-example`），全部做完再合入。切片 2 后派一次实现审查（前端，Sonnet，后台不阻塞），切片 3 后收口。

## 验收映射

示例不新增 Spec 条目；e2e 按示例的行为写（`packages/nb-layout/e2e/tabbed-panels.e2e.ts`）。

拖动统一经一个辅助函数：起拖前等网格上没有进行中的过渡（`[data-moving]` 消失，4）；起拖、移动到目标、**等外框的 `data-drop` 变成期望的完整动作**（例如 `split:group-c:right`）、松手（会话只在最后显示过的动作与松手时相同时提交，反馈没出就松手是 `no-action`，5）。

**“没有落点”这类否定断言要先看到状态变化**（会话在下一帧才发布落点，移动后立刻断言“没有反馈”会在发布之前空过，二轮 4）：先移到一个确实是落点的地方，等 `data-drop` 变成那个动作，再**一步跳到**要测的地方（`steps: 1`，路径上不经过别的位置，三轮 2），等 `data-drop` 变成 `none`，再松手、断言不变。

| 行为 | 用例 |
|---|---|
| 打开是缺省布局：侧栏加三个编组，各有标签，点标签切换正文；方向键在标签之间走 | 缺省布局 |
| 把标签拖到别的编组标签条的两个标签之间，插在那里、成为选中；来源编组选中它右边的标签；正文里打的字跟着走 | 拖进别的标签条 |
| 同一条标签条里换位置；拖回自己原来的位置 `data-drop` 回到 `none`，松手不变 | 同组重排 |
| 拖到编组正文中央，移进那个编组、排在最后、成为选中 | 拖进编组正文 |
| 把一个编组的最后一个标签拖到另一个编组的右边缘，右边拆出新编组，来源编组消失；拖到下边缘，下面拆出新编组 | 拖到边缘拆分 |
| 一次拖一个标签到最右边编组的右边缘，来源总取自还有两个以上标签的编组（拖走后来源不消失、总宽不变；先 A 后 B、C）；按缺省数值至少成功拆两次，实际步数实施时按试拆的结果写进用例；再拖时 `data-drop` 是 `blocked:…`、反馈写 “Not enough room”，松手不变；被挡的那一刻库确实放不下由 `examples.model.test.ts` 核对 | 放不下 |
| 单标签编组的标签拖到自己的边、自己的正文中央、侧栏、分隔线：每处都按上面的先正后否，松手不变 | 不是落点的地方（四处各一步） |
| 拖到目标、等反馈出现、按 Escape：反馈消失、松手后布局与标签同起点；同一条路径不按 Escape 松手，布局变了（正对照放在后面，二轮 4） | 取消 |
| 在关闭按钮上按下拖动不起拖（外框上没有 `data-drop`） | 关闭按钮不起拖 |
| 关掉编组的最后一个标签，编组缩回去后从页面上消失，焦点落在前一个编组选中的标签上；在标签上按 Delete 也能关；只剩一个编组一个标签时没有关闭按钮、Delete 不关 | 关闭标签 |
| 拖宽侧栏、收起侧栏、重新载入：宽度与收起状态都还原（收起之后不做别的操作，5）；拆分之后重新载入，标签与布局还原；载入之后再拆分成功 | 存取 |
| 存档坏的三种（JSON 坏、编组表缺一个编组、同一标签在两个编组）各载一次：用缺省布局、状态行说明、原件原样在备份键里 | 读失败保留原件 |
| F6、Shift+F6 在侧栏与编组之间移动焦点 | F6 |

否定断言先做变异检查再算数，每个独立的排除各变异一次：
- 去掉 `sourceAt` 对关闭按钮的排除，“关闭按钮不起拖”失败；
- `drop.ts` 里原位、单标签拆自己的边、移进自己所在的编组、侧栏、分隔线这五处排除各去掉一次，对应的那一步失败；
- 让 `canSplit` 一律返回能拆，“放不下”失败；
- 去掉“收起之后保存”，“存取”的收起一步失败；
- 去掉 `closeTab` 对最后一个标签的拒绝（只留界面上不画按钮），“关闭标签”的 Delete 一步失败。

取消的逻辑在库里、示例里没有可变异的代码，用同路径的正对照代替（16）。

## 验证

- 仓库内：上面切片 2 的命令；e2e 前看负载。
- 发布冒烟：切片 3 的本机冒烟。registry 来源的冒烟在下次发 nb-layout 时跑，本 Task 不发版。
- 行数证据：按体验审查的“落点指示版”口径（模型、落点、标签条、拖动适配的指示版 65、指示几何 55、应用层）数示例的行数，写进 t50 README，并写明实时布局的适配层示例没有覆盖。
- 未验证边界：Vite 以外的打包器；触摸拖动（会话支持，e2e 只测指针）；键盘拖动（示例不接）；深度超限的 “Too deeply nested”（e2e 不种 16 层的存档，`examples.model.test.ts` 测 `canSplit` 的判断）；TS 6 下的示例类型检查（仓库与冒烟都装 5.9，审查实测过 `vite/client` 那一处，其余未验证）。

## 不做与风险

- **不做实时布局的手感**：示例只做落点指示一种，所以它不是“手感编排进库”要的那种第二个宿主（那一条已由 Lab 的卡片互拖场景与 nb-story 满足，二轮 7）。实时布局要克隆树、冻结几何、做卡片，形状已有 `live-drag-session.md` 与 Lab 的卡片互拖场景；两种都放进一个示例会让它翻倍、读者分不清哪些是必需的。要做时另开一个示例。记进待确认清单。
- **不接键盘拖动**：会话支持，但要给区域与停点，示例会再长约 50 行。标签条的键盘与语义做了（`tablist`、方向键、关闭后的焦点）。记进待确认清单。
- 不做新建标签与编组：最后一个标签不让关就够了；新建要一个“新标签”的来源与命名，与布局库无关。
- 不做浮动窗、`SortableList`、`Splitter` 的示例：README 的表已指到它们的说明。
- 风险：示例不是工作区成员，靠根 `node_modules` 的提升解析依赖；哪天依赖不再提升到根，示例的类型检查会在 CI 报找不到模块，而不是静默通过。
- 风险：示例跟着 master，可能用到 npm 上还没有的名字；冒烟用的是这次打的包，看不出这种偏差。示例 README 写明（12）。
- 提 nb-layout 版本时示例 `package.json` 的范围要跟着改：`examples.test.ts` 在范围接不住新版本时失败，但 `release:check` 不跑测试，红灯要等提版提交进 CI 才亮；所以发版手册的“源码包先各自提版”一步加半句（二轮 9、三轮 5）。

## 第 5 稿：再加两个示例（开发者 2026-11-24）

开发者看完第 4 稿与审查发现的库的缺口后定：先把示例做出来，一个不够，多做几个（举例“模拟 Mac 桌面”“JetBrains IDE”）；做的时候把不好用的地方记下来，后续单独优化。上面标签编组的设计不变（第 4 稿，三轮审查已过），这一节只加两个示例与随之通用化的检查。

两个新示例都是布局形状的演示，外观、图标与命名用自己的，不照搬任何产品的品牌与视觉。

### `examples/desktop/`：浮动窗口的桌面

演示浮动窗（`floats`、`FloatWindowHandles`、`placeFloat`）、窗与树之间来回（贴边平铺）、层叠次序。

- 树：竖向 `[桌面, 底栏]`，底栏保留像素 56、不可拖（`sashDisabled`）。窗不在树里，是 `floats`；贴边的窗变成桌面那一行里的叶：`[窗, 桌面]` 或 `[桌面, 窗]`，叶 id 就是窗 id（同一个 id 从浮动窗回到树里时外框从窗的位置飞回去，反过来飞出来）。
- 窗：四个，各有标题栏（标题、最小化、最大化、关闭）与正文（`textarea`，进出平铺打的字还在）。
  - 移动：在标题栏上按下拖动。示例自己接指针（`pointerdown` 捕获、`pointermove` 调 `placeFloat(id, 偏移)`、松手写新矩形并 `placeFloat(id, null)`），拖动中 `floats` 里这扇窗带 `gesture: "move"`。为什么不用拖动会话：只有一个来源、没有落点集合，会话的落点判定用不上（这本身记进摩擦记录：整窗移动没有现成的组合函数）。
  - 缩放：`FloatWindowHandles` 放在 `float-chrome` 插槽，`preview` 时更新显示矩形（`gesture: "resize"`），`commit` 写回，`null` 回到原矩形。最小 240×160，最大是桌面的大小。
  - 层叠：按下窗的任何地方把它挪到 `floats` 末尾（库只改层级，不搬节点）。
  - 最大化：双击标题栏或按最大化，矩形设成桌面那块叶的矩形，记下原矩形；再按恢复。浮动窗的最大化就是改矩形，不用 `maximized`（它管树里的叶）。
  - 最小化：从 `floats` 去掉，底栏上留它的按钮；点按钮回到原矩形。关闭同样从 `floats` 去掉、底栏不留。
  - 贴边平铺：拖标题栏时指针到桌面的左边缘或右边缘（20px 以内）显示半屏的落点反馈（`DropFeedbackOverlay`），松手后窗变成树里的叶、占那一半（`splitLeaf` 桌面叶），已平铺的窗拖标题栏离开那一侧就回到浮动窗（`removeLeaf`，矩形取拖动时的位置）。每一侧最多平铺一扇，另一扇贴到同一侧时两扇换位。
- 存取：窗的矩形、层叠次序、最小化与平铺状态、树的快照，一个 `localStorage` 键；读失败的判据与保留原件的做法同标签编组（窗 id 不认识、矩形不是有限数等）。
- 窗口缩小：浮动窗的矩形按桌面夹取后再画（库按给的矩形画，夹取是宿主的事，记进摩擦记录）。

### `examples/ide/`：IDE 式的工具窗

演示停靠区的收起与恢复（`setCollapsed`、`restoreSize`）、条上按钮的排序与跨条移动（`useDragSession` 加 `resolveListInsertion`）、编辑区最大化（`maximized`）。

- 树：横向 `[左条, 左区, 中列, 右区, 右条]`，中列竖向 `[编辑区, 下区]`。三个停靠区保留像素、可收起（收起到 0）；左条、右条保留像素 28、不可拖；下条是中列下面再一行保留像素 24（或放在网格外，实施时选一种并写理由）。
- 工具窗：六个（例如 Project、Structure、Bookmarks、Terminal、Problems、Outline），每个属于一个区、在那条上有一个按钮。点按钮：它所在的区收着就展开并显示它；区开着显示别的工具窗就换成它；已经显示它就收起这个区。区里一次只显示一个工具窗（内容项按 `active` 停放，不卸载）。
- 拖条上的按钮：在同一条里排序，拖到另一条就把工具窗移到那个区（落点用 `resolveListInsertion` 判，反馈画插入线）。拖走的是那个区正在显示的，区换显示同条的下一个，没有就收起。
- 编辑区：一组标签加一个正文（不做拆分：标签编组示例已演示）。按 Ctrl+Shift+M（或标题栏的按钮）最大化编辑区：`maximized: {leaf: "editor", exclude: [三条]}`，再按恢复；最大化只在内存。
- 快捷键：Alt+1 到 Alt+6 开关对应的工具窗；Escape 焦点在工具窗里时回到编辑区。键位只在示例的根上听，F6 照标签编组。
- 存取：树的快照（含各区收起前的宽度）、每个区显示哪个工具窗、各条上按钮的次序与归属、各区收起状态；判据同上（工具窗 id 不认识、一个工具窗出现在两条上、条上没有按钮的区不能是展开的）。

### 三个示例共用的检查

- 目录：`examples/tabbed-panels/`、`examples/desktop/`、`examples/ide/`，各自独立（第三方拷走一个目录就能跑），不互相导入；三者都有的小件（例如存取的读失败处理）各写一份，不抽共用包：抽出来第三方就拷不走一个目录。
- `examples.test.ts` 对 `examples/*/` 每个目录做同样的检查（`package.json`、导入白名单、Spec 编号）；`examples.model.test.ts` 改名 `examples-model.test.ts`，覆盖三个示例的模型层（桌面：平铺与浮动来回、夹取、读失败；IDE：按钮点击的三种结果、跨条移动后的显示规则、读失败）。
- `typecheck` 对每个示例跑一次 `vue-tsc`（一个小脚本 `scripts/examples.ts typecheck` 遍历 `examples/*/tsconfig.json`，另有 `build` 子命令给 e2e 用）。
- e2e 每个示例一份 `e2e/<示例>.e2e.ts`，共用 `e2e/serve.ts`（静态服务）与拖动辅助函数；`test:e2e` 先构建三个示例。
- 发布冒烟的 `smokeLayoutExample` 对三个示例各装一次、类型检查、构建（三个示例的依赖版本相同，`examples.test.ts` 核对三份 `package.json` 一致；空宿主读 `tabbed-panels` 的那份）。
- nb-layout README 的“示例应用”一节列三个，各一句话说演示什么。

### 摩擦记录

`friction.md`（本 Task 目录，主工作区）：做示例时遇到的不好用之处，每条写示例、现象、示例里怎么绕、改库的候选、影响（示例多写了多少行或要遵守什么不显然的约束）。开头先记规划与三轮审查已发现的九条。只记录，不在 t50 里改库；t50 完成时按影响排序，交开发者定后续 Task。

### 两个新示例的验收

desktop（`e2e/desktop.e2e.ts`）：

| 行为 | 用例 |
|---|---|
| 拖标题栏移动、松手后位置不变；按下后面的窗它到最上面 | 移动与层叠 |
| 拖右下角手柄缩放，到最小尺寸停住；Escape 取消回到原尺寸 | 缩放 |
| 最大化铺满桌面、再按恢复原矩形；最小化后底栏有按钮、点回原处；关闭后底栏没有 | 最大化与最小化 |
| 拖到左边缘出现半屏反馈，松手后窗占左半、正文里的字还在；再拖离左边回到浮动窗；另一扇贴到左边时两扇换位 | 贴边平铺 |
| 移动、平铺、最小化之后重新载入，都还原；存档坏时用缺省布局、原件在备份键 | 存取 |
| 视口缩小后浮动窗都还在桌面里 | 夹取 |

ide（`e2e/ide.e2e.ts`）：

| 行为 | 用例 |
|---|---|
| 点左条的按钮：区收着时展开显示它；显示别的时换成它；已显示它时收起；收起再展开回到收起前的宽度 | 开关工具窗 |
| 拖左区分隔线改宽，收起再展开回到拖后的宽度 | 恢复宽度 |
| 条上拖按钮排序；拖到右条后工具窗在右区显示；拖走正在显示的，左区换下一个，没有就收起 | 排序与跨条 |
| 最大化编辑区盖住三个区、条还在；再按恢复 | 最大化 |
| Alt+数字开关工具窗；Escape 回编辑区 | 快捷键 |
| 改宽、排序、跨条、收起之后重新载入都还原；存档坏时用缺省布局、原件在备份键 | 存取 |

否定断言同标签编组：先看到状态变化再断言没有，每个排除各变异一次。

### 切片（替换上面的“切片”）

1. 标签编组本体（主会话写）。
2. 仓库里的检查按“三个示例共用的检查”通用化，接上标签编组的 e2e 与模型测试（主会话写）。
3. desktop、ide 两个示例（各派一个 Sonnet 编码子代理，各自的 worktree，从切片 2 的提交开分支；说明给本计划与标签编组作参照；它们在报告里列出遇到的不好用之处，主会话核实后并进摩擦记录）。两片的实现审查各派一次（前端，Sonnet，后台不阻塞）。
4. 发布冒烟三个示例都装一次；本机冒烟。
5. 收口：行数证据、摩擦记录按影响排序、README 与文档。

### 风险（补充）

- 浮动窗在树与浮动之间来回的过渡、`placeFloat` 在宿主自己接指针时的用法，Lab 与工作台都只经工作台的控制器用过；示例是第一次只经公开入口用它们，可能撞到没写进说明的约束（照实记进摩擦记录，示例里绕不过去就停下来问）。
- IDE 示例的条与区在同一棵树里：条上按钮被拖动时布局不变（落点指示），不影响分隔线的手势；条与区的收起都靠保留像素，展开时库按 `restoreSize` 还原。
