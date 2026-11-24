# t50 计划：官方示例应用（标签编组）

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

### `packages/nb-layout/examples/tabbed-panels/`

一个独立的 Vite 项目，第三方把目录拷走、`npm install` 就能跑。不是工作区成员（根 `workspaces` 不登记，不加包要登记的那串位置）：在仓库里，它的 `@notnotype/nb-layout`、`vue`、`vite` 从根 `node_modules` 解析（`@notnotype/nb-layout` 是指到 `packages/nb-layout` 的工作区链接，读源码入口）。

文件（行数是预估上限，体验审查同类分项的数在括号里）：

- `package.json`：`private`，依赖 `@notnotype/nb-layout: "^<当前版本>"`、`vue`，开发依赖 `vite`、`@vitejs/plugin-vue`、`vue-tsc`、`typescript`（版本与发布冒烟的空宿主一致）；脚本 `dev`、`build`、`typecheck`。
- `tsconfig.json`、`vite.config.ts`、`index.html`：同发布冒烟的空宿主（`strict`、`skipLibCheck: false`）。
- `README.md`：目录、概念与阅读顺序（先 `model.ts`，再 `drop.ts`，再 `App.vue`），怎么跑；写明它绕过的库空缺（见下）。不贴代码片段。
- `src/main.ts`：导入 `style.css`，挂载。界面文字用英文，不注入文字（库缺省就是英文，示例展示“不接文字也能用”；接文字的写法 README 已有）。
- `src/model.ts`（约 120，体验审查 120 + 存取 30）：编组与标签的模型。
  - 状态：`groups: Map<groupId, {tabs: string[], active: string}>`，加一棵 `Grid<string>`（叶的 `ref` 是编组 id，侧栏叶的 `ref` 是 `"explorer"`）。
  - 操作，每个返回是否成功、成功后由调用方 `host.invalidate()` 与保存：`activate`、`closeTab`（编组空了就 `removeLeaf`）、`moveTab(tab, toGroup, index)`、`splitWithTab(tab, targetGroup, side)`（`splitLeaf` 出新编组；被拒，例如 `limit-exceeded`，就什么都不改）。来源编组空了，删叶与挪标签在同一个同步段里做。
  - 存取：`save()` 写 `localStorage` 一个键（网格快照、编组表、侧栏收起状态，带格式版本）；`load()` 用 `createGrid(null, {sashSize})` 加 `restore(快照, 解析)`，解析函数按 `ref` 查策略表（侧栏的 `sizing`、`minimumSize`、`collapse`）；版本不认识、结构坏、`restore` 失败或 `dropped` 非空时，原件另存到备份键、用缺省布局，不覆盖原件（README“约定”推荐的做法的完整版）。
- `src/drop.ts`（约 50，体验审查 37 + 指示几何 55 的一部分）：落点规则，纯函数。
  - 标签条上：`resolveListInsertion` 判插在哪两个标签之间；
  - 编组正文上：`resolveGridEdgeDrop` 判四边，中央是“移进这个编组”；
  - 自己那组只有这一个标签时，拆到自己的边与移进自己都不是落点；拖到自己标签条上是重排。
  - 落点形状 `{kind: "insert", group, index} | {kind: "split", group, side} | {kind: "into", group}`，加 `actionKey`。
- `src/TabBar.vue`（约 40，体验审查 28）：一个编组的标签条：按钮、选中、关闭按钮（关闭按钮不起拖：`sourceAt` 排除它）；带 `data-tab`、`data-group` 供会话认来源与落点。
- `src/App.vue`（约 150，体验审查 143 + 拖动适配 65）：
  - `useGridHost({grid, contextKey, onApplied: save})` 绑到 `NestedGrid`；叶插槽按 `ref` 画侧栏或编组（标签条加正文）。
  - 内容项标 `leave: "retain"`：关掉最后一个标签时编组缩回去再卸载（经 `NestedGrid` 的内容层，不只用叶插槽）。
  - `useDragSession(网格外框, …)`：`sourceAt` 认标签；`activate` 冻结这一场的几何（各标签条、各编组正文的视口矩形）；`resolve` 调 `drop.ts`；`commit` 调 `model.ts` 的操作，然后 `invalidate` 与保存；`onActiveChange` 写拖动中的光标。
  - 落点反馈：`DropFeedbackOverlay`，预览矩形由落点算（插入是一条竖线，拆分是那半边，移进是整块正文），文字英文。
  - 侧栏收起按钮走 `host.setCollapsed`，收起状态从网格读（同 README 起步）。
  - F6、Shift+F6 调 `moveGridFocus`，返回真才 `preventDefault`。
  - 主题：在根上设几个 `--nb-layout-*` 变量，演示换外观（名单来自 `NB_LAYOUT_THEME_VARS`，示例只设几个，注释里说其余用缺省）。

**注释**：示例是给第一次接入的人读的，按教学材料写：逐步讲这一步做什么、为什么、不这样会怎样；不引 Spec 条目编号，要讲的规则直接写出来。这需要把“教学注释”的例外从 `plugin-sdk/examples/` 扩到 `packages/nb-layout/examples/`（`docs/standards/code/common.md` 的注释一节与根 `AGENTS.md` 的摘要各改一句）；记进待确认清单。

**绕过的库空缺**（实施中撞到的照实补，记进 Work“后续”，不在 t50 里加接口）：

- 没有 `grid.clone()`：示例不需要预览树（落点指示手感不改布局），撞不到；写一句“实时布局要克隆时用 serialize 加 restore”。
- 没有方向焦点：F6 只有前后两向，示例照用。
- `NestedGrid` 不是泛型组件：叶插槽里 `node.ref` 是 `unknown`，示例收窄一次。
- 会话没有缺省的“交互元素不起拖”过滤与拖影：`sourceAt` 自己排除关闭按钮；不画拖影。
- 没有 `restoreOrKeep`：`model.ts` 的 `load` 就是它的完整写法。

### `packages/nb-layout`（脚本与测试）

- `package.json` 的 `typecheck` 末尾加 `vue-tsc --noEmit -p examples/tabbed-panels/tsconfig.json`：CI 的 `test:affected --typecheck` 按包跑 `typecheck`，示例里的改动算 nb-layout 受影响，两次发布之间库的类型变了、示例跟不上时 CI 就挂。
- 新增 `test:e2e`：先 `vite build` 示例，再 `playwright test -c e2e/playwright.config.ts`。`e2e/playwright.config.ts` 照 nb-story 的写（本机 Chrome、Node 运行、输出目录按检出分开）；被测的静态服务由用例自己起停（`node:http` 读示例的 `dist`，端口 0）；`e2e/tsconfig.json` 照 nb-story 的写，`typecheck` 一并检查它。
- `src/examples.test.ts`（bun test）：示例 `package.json` 里 `@notnotype/nb-layout` 的范围要接得住包的当前版本（提版时示例跟着改）；示例只从四个公开入口与 `style.css` 导入 `@notnotype/nb-layout`（扫 `src/` 里的导入语句，深导入就失败）。
- `README.md`：在“起步”之后加一节“示例应用”，一句话说它演示什么，GitHub 链接到示例目录；“我要做 X”表里“一组可拖的东西”“拖到边缘、插到两项之间的落点几何”“落点反馈”三行加一句“示例见 tabbed-panels”。

### `scripts/release/pack-smoke.ts`

`smokeLayoutHost` 之后加 `smokeLayoutExample`：把 `packages/nb-layout/examples/tabbed-panels/` 拷进冒烟临时根，依赖改成这次的包来源（`from.spec`、`from.overrides`，同空宿主），`bun install`、`vue-tsc`（不跳过库检查）、`vite build`。证明示例照第三方的装法能对着发布出去的类型与产物编译、打包；浏览器里的行为由仓库内的 e2e 覆盖（两者跑的是同一份示例源码，产物与源码在运行期的差别由起步例子的浏览器检查覆盖）。nb-layout 还是 `private` 时同样跳过。

## Spec 与文档改动

- Spec 不改：示例不引入新行为。
- `docs/standards/code/common.md` 注释一节的“例外：示例插件”扩成两处示例目录；根 `AGENTS.md` 注释一节的摘要同步一句（根 `AGENTS.md` 有别的会话未提交的改动，只暂存这一行）。
- `packages/nb-layout/AGENTS.md`：“许可与发布”加一条：`examples/` 是 MIT、不随包发布、只经公开入口，与包同样不从 AGPL 的代码搬内容。
- `packages/nb-layout/CHANGELOG.md`：不写（示例不在包里，用户装到的东西没变）。
- 发版手册不改：冒烟多一步，手册写的是命令，不列步骤。

## 切片

1. **示例本体**：`examples/tabbed-panels/` 全部文件。自跑：示例目录 `vue-tsc --noEmit`、`vite build`，`bun run dev` 起来手动拖一遍（开发服务经 `run_in_background`，结束停掉）。
2. **仓库里的检查**：`typecheck` 接上示例、`examples.test.ts`、`test:e2e` 与 e2e 用例、README 一节与注释例外。自跑：`bun run --cwd packages/nb-layout typecheck`、`bun test src/examples.test.ts`、`bun run --cwd packages/nb-layout test:e2e`、`bun run --cwd packages/nb-layout test`（`readme.test.ts`）、`bun run docs:check`、`bun run governance:check`。
3. **发布冒烟**：`smokeLayoutExample`。自跑：`prox bun run release:smoke`（本机来源，工作树干净时）。

一片一个提交；切片 1 与 2 写在同一个 worktree（`.worktree/w00026-t50-example`，分支 `w00026/t50-example`），全部做完再合入。切片 1 后派一次实现审查（前端，Sonnet，后台不阻塞），切片 3 后收口。

## 验收映射

示例不新增 Spec 条目；e2e 按示例的行为写，每条对应一个用例（`packages/nb-layout/e2e/tabbed-panels.e2e.ts`）：

| 行为 | 用例 |
|---|---|
| 打开是缺省布局：侧栏加三个编组，各有标签，点标签切换正文 | 缺省布局 |
| 把标签拖到别的编组标签条的两个标签之间，插在那里；来源编组的其余标签还在 | 拖进别的标签条 |
| 拖到编组正文中央，移进那个编组、排在最后、成为选中 | 拖进编组正文 |
| 把一个编组的最后一个标签拖到另一个编组的右边缘，右边拆出新编组，来源编组消失 | 拖到边缘拆分 |
| 拖动中出现落点反馈，按 Escape 取消，布局与标签都不变 | 取消 |
| 在关闭按钮上按下拖动不起拖 | 关闭按钮不起拖 |
| 关掉编组的最后一个标签，编组缩回去后从页面上消失 | 关闭最后一个标签 |
| 拖宽侧栏、收起侧栏、拆分之后重新载入，布局、标签与收起状态都还原 | 存取 |
| 存档被改坏后载入：用缺省布局，原件留在备份键里 | 读失败保留原件 |
| F6、Shift+F6 在侧栏与编组之间移动焦点 | F6 |

否定断言（“不起拖”“不变”）先做变异检查再算数：例如去掉 `sourceAt` 里对关闭按钮的排除，“关闭按钮不起拖”要失败。

## 验证

- 仓库内：上面切片 2 的命令；e2e 前看负载。
- 发布冒烟：切片 3 的本机冒烟。registry 来源的冒烟在下次发 nb-layout 时跑，本 Task 不发版。
- 行数证据：按体验审查的分项（模型、落点、标签条、拖动适配、指示几何、应用层）数示例的行数，写进 t50 README。
- 未验证边界：示例在 Vite 以外的打包器；触摸拖动（会话支持，示例的 e2e 只测指针）；键盘拖动（示例不接，见“不做”）。

## 不做与风险

- **不做实时布局的手感**：示例只做落点指示一种。实时布局要克隆树、冻结几何、做卡片，形状已有 `live-drag-session.md` 与 Lab 的卡片互拖场景；两种都放进一个示例会让它翻倍、读者分不清哪些是必需的。要做时另开一个示例。记进待确认清单。
- **不接键盘拖动**：会话支持，但要给区域与停点，示例会再长约 50 行。记进待确认清单。
- 不做浮动窗、`SortableList`、`Splitter` 的示例：README 的表已指到它们的说明。
- 风险：示例不是工作区成员，靠根 `node_modules` 的提升解析依赖；哪天依赖不再提升到根，示例的类型检查会在 CI 报找不到模块，而不是静默通过。
- 风险：示例的依赖版本（`vite`、`vue-tsc`）与仓库实际装的不同，第三方装到的与 CI 检的不一样；`examples.test.ts` 只核 nb-layout 的范围，其余靠发布冒烟按第三方的装法装一次。
