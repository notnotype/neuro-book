# t50 计划：官方示例应用（标签编组），第 3 稿

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

第 2 稿按设计审查第 1 轮（[报告](evidences/design-review-r1.txt)，重要 7、建议 11，都成立）修订，括号里写条号；第 3 稿按第 2 轮（[报告](evidences/design-review-r2.txt)，重要 4、建议 6，都成立）修订，括号里写“二轮”加条号。

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
  - **编组的策略只有一个出处**：`groupPolicy()` 给 `minimumSize`（标签条放得下两个标签的宽、标签条加一行正文的高）；建缺省布局、`splitLeaf` 建新编组、载入时的解析函数都用它，载入前后同一个编组的约束相同（9）。侧栏的策略（`sizing: "fixed"`、`minimumSize`、`collapse`）同样一处。
  - **id**：新编组 `group-<n>`、新分支 `split-<n>`，`n` 取模型里现有同类 id 的最大序号加一（每次现算，不用模块里的计数器：重新载入后计数器从头数，会撞 id，`splitLeaf` 回 `duplicate-id`，3）。
  - 操作，每个返回 `{ok: true} | GridFailure`（示例自己的拒绝也用这个形状、自己的码）：`activate`、`closeTab`、`moveTab(tab, toGroup, index)`、`splitWithTab(tab, targetGroup, side)`。
    - **先做会被拒的那步**（二轮 2）：`splitWithTab` 先 `splitLeaf` 出新编组，成功了才把标签挪进去、来源编组空了再 `removeLeaf`；`splitLeaf` 被拒时模型一点没动。`moveTab` 不改树，只有来源空了才 `removeLeaf`（删叶不会被拒：叶总在树里）。都在同一个同步段里做完。
    - **选中标签的规则**（每个操作之后 `active ∈ tabs` 都成立，否则下次载入会把自己的存档判坏，二轮 2）：挪进或拆进来的标签成为目标编组的选中；来源编组被拿走的恰是选中时，选它右边的，没有就选左边的；关掉的是选中时同样。
    - **最后一个编组的最后一个标签不能关**：模型的 `closeTab` 自己拒绝（码 `last-tab`），界面也不画它的关闭按钮；`load()` 把“没有编组叶”判为存档坏（根只剩侧栏时它会被展平成占满全宽的单叶、`fixed` 失效、存档之后永远回不来，审查实测，2）。把它拖进别的编组不受限：拖走之后至少还有目标编组。
    - 拆分被拒（`limit-exceeded`、`duplicate-id`）时模型不变，失败交回调用方，界面在状态行里显示 `message`（落点上看不出会被拒，只在拒绝之后说明原因；不在判落点时复算库的深度口径，14）。
    - **放不下时不让拆**（二轮 1）：库在拆到放不下时不拒绝、只按约束压缩（审查实测，第 4 个编组起 `over-constrained`，`splitLeaf` 一直 `ok`）。示例在判落点时就挡：目标编组这一刻量到的宽（左右拆）或高（上下拆）不到“两份 `groupPolicy()` 的最小尺寸加一条分隔线”，这个拆分落点给 `armed: false` 的预览，`actionKey` 为 `null`（只显示不提交），反馈文字写 “Not enough room”。这是只看目标编组自己的近似：兄弟能让出来的空间不算，宁可少拆；窗口缩小导致放不下时照库的行为压缩，写进已知限制。
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
  - 标签不压缩，放不下时标签条横向滚动（`overflow-x: auto`）；插入位按标签真实的矩形判，指针在可见的部分里，线就画在可见的位置（二轮 1）。
  - 带 `data-tab`、`data-group` 供会话认来源与落点；高度是一个常数，同时给标签条的样式与内容项的 `insetTop`（7）。
- `src/TabPanel.vue`（约 20）：一个标签的正文：一个 `textarea`（叶里有能聚焦的东西，F6 才进得去；换标签、挪编组后打的字还在，演示内容项换叶不重建）。**数据经属性传进来**，不按 key 去查编组表：关掉最后一个标签那一帧，留住的内容是冻结的插槽调用，查已删的数据会抛错（`NestedGrid.md` 内容层的推荐写法，7）。
- `src/App.vue`（约 170，体验审查应用层 143 + 拖动适配 65 的一部分）：
  - `useGridHost({grid, contextKey, onApplied: save})` 绑到 `NestedGrid`；叶插槽按 `ref` 画侧栏或编组的标签条；正文经内容层，内容项 `{key: tab, leaf: group, insetTop, active, leave: "retain"}`：关掉最后一个标签时编组缩回去再卸载。`paneLabel` 给编组的显示名（“Group 2”），读屏不念生成的 id（18）。
  - `content-parked`：焦点在被停放的正文里时，交给那个编组选中的标签（15）。
  - **关标签之后的焦点由 `App.vue` 自己给**（`content-parked` 只在焦点在内容里时发，关闭按钮在面板头里，二轮 3）：关闭成功后等下一次渲染，焦点给这个编组新选中的标签；编组没了就给树序上它前面的编组（没有就后面的）选中的标签。
  - `useDragSession(网格外框, …)`（8、4、6）：
    - `sourceAt` 认 `[data-tab]`，排除 `[data-tab-close]`；
    - `activate` 里先调 `NestedGrid` 的 `settleMotion()`：刚关掉、刚拆分时还有过渡在走，起拖那一刻量到的会是中间值（二轮 6）；
    - 不冻结几何：`resolve` 每次现量（标签条与标签的矩形、编组正文按 `[data-content-leaf]` 取叶外框上的正文区域），落点指示手感下布局整场不变，也跟得上标签条滚动与窗口缩放。`resolve` 一次移动可能调几次，现量只是读，不改东西；
    - `structure` 给 `host.revision`：拖动中窗口缩放、布局重发时整场取消，不拿旧的落点提交（二轮 6）；
    - `NestedGrid` 绑 `:dragging="state !== null"`；
    - `commit` 调 `model.ts` 的操作，成功后 `invalidate` 与保存，失败写状态行；
    - `onActiveChange` 写拖动中的光标。
  - 落点反馈：`DropFeedbackOverlay`，带 `data-drag-feedback`（同 nb-story，会话判落点时跳过它，二轮 10），预览矩形由落点算（插入是一条竖线，拆分是那半边，移进是整块正文），文字英文；放不下的拆分是 `armed: false`。拖动中在外框上写 `data-drop`（这一刻的落点种类，没有落点时 `none`），e2e 据此断言。
  - 侧栏收起按钮走 `host.setCollapsed`，之后保存；收起状态从网格读（同 README 起步）。
  - F6、Shift+F6 调 `moveGridFocus`，返回真才 `preventDefault`。
  - 状态行：读档失败、保存失败、拆分被拒的原因；平时空着。
  - 主题：在根上设几个 `--nb-layout-*` 变量演示换外观（名单来自 `NB_LAYOUT_THEME_VARS`，示例只设几个，注释说其余用缺省）。

**注释**：示例是给第一次接入的人读的，按教学材料写：逐步讲这一步做什么、为什么、不这样会怎样；不引 Spec 条目编号，要讲的规则直接写出来；讲解随 e2e 一起改。注释的语言跟包的说明走（现在是中文；提案“公开入口”一节说包内说明的语言随第二档另定，到时一起改，17）。

**绕过的库空缺与已知限制**（写进示例 README；实施中撞到新的照实补，记进 Work“后续”，不在 t50 里加接口）：

- 没有 `grid.clone()`：落点指示手感不改布局，示例撞不到；写一句“实时布局要克隆时用 serialize 加 restore”。
- 没有方向焦点：F6 只有前后两向，示例照用。
- `NestedGrid` 不是泛型组件：叶插槽里 `node.ref` 是 `unknown`，示例收窄一次。
- 会话没有缺省的“交互元素不起拖”过滤与拖影：`sourceAt` 自己排除关闭按钮；不画拖影。
- 没有 `restoreOrKeep`：`model.ts` 的 `load` 就是它的完整写法。
- 同向拆分造出同向嵌套的分支，连续拆越来越深，到 16 层被拒；删叶会把只剩一个孩子的分支展平，分支自己的约束会丢，所以示例只给叶挂策略（9）。
- 落点上看不出拆分会被深度或节点数的上限拒绝，拒了才在状态行说（14）；放不下的在落点上就挡（只看目标编组自己，见 `model.ts`），窗口缩小导致的放不下照库的行为压缩（二轮 1）。
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
- 发版手册不改：冒烟多一步，手册写的是命令，不列步骤。

## 切片

1. **示例本体**：`examples/tabbed-panels/` 全部文件。自跑：示例目录 `vue-tsc --noEmit`、`vite build`，`bun run dev` 起来手动拖一遍（开发服务经 `run_in_background`，结束停掉）。不在示例目录里 `npm install`（会留一份 `node_modules` 盖住根的 Vue，12）。
2. **仓库里的检查**：`typecheck` 接上示例与 e2e、`examples.test.ts`、`test:e2e` 与 e2e 用例、README 一节、注释例外与 nb-layout `AGENTS.md`。自跑：`bun run --cwd packages/nb-layout typecheck`、`bun run --cwd packages/nb-layout test`（含 `examples.test.ts`、`readme.test.ts`）、`bun run --cwd packages/nb-layout test:e2e`、`bun run docs:check`、`bun run governance:check`。
3. **发布冒烟**：空宿主读示例的依赖、`smokeLayoutExample`。自跑：`prox bun run release:smoke`（本机来源，工作树干净时）。

一片一个提交；都写在 worktree `.worktree/w00026-t50-example`（分支 `w00026/t50-example`），全部做完再合入。切片 2 后派一次实现审查（前端，Sonnet，后台不阻塞），切片 3 后收口。

## 验收映射

示例不新增 Spec 条目；e2e 按示例的行为写（`packages/nb-layout/e2e/tabbed-panels.e2e.ts`）。

拖动统一经一个辅助函数：起拖前等网格上没有进行中的过渡（`[data-moving]` 消失，4）；起拖、移动到目标、**等外框的 `data-drop` 变成期望的落点**、松手（会话只在最后显示过的动作与松手时相同时提交，反馈没出就松手是 `no-action`，5）。

**“没有落点”这类否定断言要先看到状态变化**（会话在下一帧才发布落点，移动后立刻断言“没有反馈”会在发布之前空过，二轮 4）：先移到一个确实是落点的地方，等 `data-drop` 变成那个落点，再移到要测的地方，等 `data-drop` 变回 `none`，再松手、断言不变。

| 行为 | 用例 |
|---|---|
| 打开是缺省布局：侧栏加三个编组，各有标签，点标签切换正文；方向键在标签之间走 | 缺省布局 |
| 把标签拖到别的编组标签条的两个标签之间，插在那里、成为选中；来源编组选中它右边的标签；正文里打的字跟着走 | 拖进别的标签条 |
| 同一条标签条里换位置；拖回自己原来的位置 `data-drop` 回到 `none`，松手不变 | 同组重排 |
| 拖到编组正文中央，移进那个编组、排在最后、成为选中 | 拖进编组正文 |
| 把一个编组的最后一个标签拖到另一个编组的右边缘，右边拆出新编组，来源编组消失；拖到下边缘，下面拆出新编组 | 拖到边缘拆分 |
| 一直往同一个编组的右边拆，到放不下时落点是 “Not enough room”、不可提交，松手不变 | 放不下 |
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
- 去掉放不下的判断，“放不下”失败；
- 去掉“收起之后保存”，“存取”的收起一步失败；
- 去掉 `closeTab` 对最后一个标签的拒绝（只留界面上不画按钮），“关闭标签”的 Delete 一步失败。

取消的逻辑在库里、示例里没有可变异的代码，用同路径的正对照代替（16）。

## 验证

- 仓库内：上面切片 2 的命令；e2e 前看负载。
- 发布冒烟：切片 3 的本机冒烟。registry 来源的冒烟在下次发 nb-layout 时跑，本 Task 不发版。
- 行数证据：按体验审查的“落点指示版”口径（模型、落点、标签条、拖动适配的指示版 65、指示几何 55、应用层）数示例的行数，写进 t50 README，并写明实时布局的适配层示例没有覆盖。
- 未验证边界：Vite 以外的打包器；触摸拖动（会话支持，e2e 只测指针）；键盘拖动（示例不接）；拆分被拒的状态行（要 16 层或 256 个节点才触发，e2e 不种这样的存档，从代码看它与另两种失败走同一条显示路径）；TS 6 下的示例类型检查（仓库与冒烟都装 5.9，审查实测过 `vite/client` 那一处，其余未验证）。

## 不做与风险

- **不做实时布局的手感**：示例只做落点指示一种，所以它不是“手感编排进库”要的那种第二个宿主（那一条已由 Lab 的卡片互拖场景与 nb-story 满足，二轮 7）。实时布局要克隆树、冻结几何、做卡片，形状已有 `live-drag-session.md` 与 Lab 的卡片互拖场景；两种都放进一个示例会让它翻倍、读者分不清哪些是必需的。要做时另开一个示例。记进待确认清单。
- **不接键盘拖动**：会话支持，但要给区域与停点，示例会再长约 50 行。标签条的键盘与语义做了（`tablist`、方向键、关闭后的焦点）。记进待确认清单。
- 不做新建标签与编组：最后一个标签不让关就够了；新建要一个“新标签”的来源与命名，与布局库无关。
- 不做浮动窗、`SortableList`、`Splitter` 的示例：README 的表已指到它们的说明。
- 风险：示例不是工作区成员，靠根 `node_modules` 的提升解析依赖；哪天依赖不再提升到根，示例的类型检查会在 CI 报找不到模块，而不是静默通过。
- 风险：示例跟着 master，可能用到 npm 上还没有的名字；冒烟用的是这次打的包，看不出这种偏差。示例 README 写明（12）。
- 提 nb-layout 版本时示例 `package.json` 的范围要跟着改：`examples.test.ts` 在范围接不住新版本时失败，发版时 `release:check` 会跑到它，不另写进发版手册（二轮 9）。
