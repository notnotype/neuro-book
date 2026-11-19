# t42 nb-layout 的 README 起步与短文档：实施计划（第 1 稿）

只改文档与一个 Lab 场景，不改库的行为：按 reviewing 的“按任务大小降级”不做设计审查，实现审查（Claude Sonnet，按文档的可读性与准确性审）兜底。

## Context

- 依据：[提案](../../../../../docs/proposals/nb-layout-general-library.md)“库里补的小东西”的“README 是复制粘贴能跑的起步”一条（体验审查第 1、2、7 到 10、13、14、18 条）；开发者 2026-11-18 对 t31“都按推荐”。2026-11-19 从 t39 拆出，排在 t39 到 t41 的形状定了之后（[待确认清单](../../pending-confirmations.md)）。
- 提案要的几件：
  - README 第一句写定位，以及“不是现成的标签停靠布局”。
  - 复制就能跑的最小例子，做五件事：建树、量容器、算布局、接纳手势提交、结构变了通知。`NestedGrid.md` 的“接入”整段搬上来。
  - 一张“我要做 X 用哪个导出”的表。
  - 写明几条目前只在源码里的约定（下文“约定”一节逐条列）。
  - 说明文档里不引“输出 N”，第三方要的规则直接写进包里；语言第一档仍是中文。
  - `useGridLayout`、`useLayoutExtent`、`createDragSession` 各补一份短 `.md`。t39 之后 `useGridLayout` 是内部模块，对外的是 `useGridHost`，这一份改写 `useGridHost`；`createDragSession` 那份连同 `useDragSession` 一起写。
  - 链接用 npm 上不会断的写法。
- 现状：
  - README 51 行，只有入口、主题、文字三节，没有例子。
  - 包内文档引“输出 N”的：`NestedGrid.md` 41 处、`grid.md` 5 处，其余没有。
  - 包发布 `src` 下的 `.md` 与 `README.md`（`package.json` 的 `files`），里面指向 `docs/specs/` 的相对链接在 npm 上都会断。

## 技术选型

无。

## 关键设计

### README 的起步例子与 Lab 场景是同一份：`packages/neuro-book/src/plugins/lab/web/fixtures/nb-layout/StarterScene.vue`（新增）

- 新的 Lab 场景 `NestedGrid` / `starter`，内容就是 README 里的例子：
  - `createGrid` 建两列一行；
  - `useGridHost` 加 `<NestedGrid v-bind>`；
  - `onApplied` 里存快照；
  - 一个按钮拆分（`splitLeaf` 加 `invalidate()`）；
  - 一个按钮收起左栏（`host.setCollapsed`）。
- `packages/nb-layout/src/readme.test.ts`（新增）读 README 里标了 `starter` 的那段 `vue` 代码，断言它和这个场景文件一字不差。
  - 例子因此一定能编译（应用的类型检查）、能在 Lab 里跑，改了库的接口而忘了改 README 会红。
  - 场景文件不写注释，让两边能逐字相等。
- e2e：`lab-grid-structure.e2e.ts` 旁加一条最小的，打开 `starter`，拖一次、点拆分、点收起，各看一个可见结果。

### README：`packages/nb-layout/README.md`

节的顺序：

1. 定位（第一句）。
2. 安装与入口：现有的三行导入，加 `./locales`。
3. 起步（上面的例子），后面一段说清五件事各是哪一行，以及 `NestedGrid.md` 里接线的要点（尺寸只来自组件、只经 `useGridHost` 的选项给 `contextKey` 等）。
4. “我要做 X 用哪个导出”：表，一行一件事。覆盖：
   - 建树与改结构；
   - 接组件；
   - 收起与展开；
   - 保存与恢复；
   - 键盘在叶之间走；
   - 拖动会话（`useDragSession`、`createDragSession`）与落点；
   - 独立分栏 `Splitter`；
   - 可排序列表；
   - 主题变量清单；
   - 文字注入；
   - 开发检查。
5. 约定（下一节）。
6. 主题、文字（现有两节，不动内容）。

### 约定：写进 README 的“约定”一节

逐条对照源码核实后再写，每条一两句：

- `restore` 可以对 `createGrid(null)` 用：先建空网格，再从快照恢复（体验 7）。
- 读快照失败时保留原件、不拿缺省布局覆盖存档；`restore` 返回的 `dropped` 非空也算读失败（体验 8）。
- 树最多 16 层：拖动拆分在快到上限时会被拒（体验 9）。
- 窗口太窄时库按约束压缩并给诊断（`layout().issues`），不报错。想知道放不放得下，读根节点的 `constraints`（体验 10）。
- 键盘：叶里要有可聚焦的元素，F6 才停得下；标签条里的左右键与漫游 `tabindex` 是宿主的事（体验 13）。
- 矩形有两种：布局结果是相对网格根的 CSS px；拖动与落点用的是视口坐标（`clientX`、`clientY`）（体验 14）。
- 自己画的拖动反馈元素要带 `data-drag-feedback`，否则会挡住落点判定；`sourceAt` 里要自己排除可交互元素（按钮、输入框）（体验 18）。

### 三份短文档：`packages/nb-layout/src/vue/`（新增）

每份：做什么、签名、时序与寿命、一个小例子；不引“输出 N”。

- `useGridHost.md`：
  - 选项、交回的东西、`bindings` 整包绑定；
  - 尺寸从哪来；
  - 诊断一个出口；
  - `setCollapsed`、`onApplied` 的 `before`；
  - 开发检查里与它有关的两条。
  - `NestedGrid.md` 的“接入”改成链到它与 README。
- `useLayoutExtent.md`：量布局盒；`null` 与 0 两种状态；什么时候用它而不是 `NestedGrid` 的 `extent`。
- `drag-session.md`：`createDragSession` 的选项与寿命，`useDragSession` 何时建、何时销毁，选项只读一次。

### 包内文档不引“输出 N”：`NestedGrid.md`、`grid.md`

- 逐处处理 46 处：
  - 句子本身已经说了规则的，删掉“（输出 N）”；
  - 只写了“见输出 N”的，把那条规则写成一两句放在原处。
- 指向 Spec 的链接改成 GitHub 上的绝对地址（`https://github.com/notnotype/neuro-book/blob/master/docs/specs/ui/nested-grid.md`），只在每份文档开头留一处“完整合同见……”。

## Spec 与文档改动

- Spec 不改：只改文档与 Lab 场景，行为合同未变。
- [`ui/nested-grid`](../../../../../docs/specs/ui/nested-grid.md) 的实现合同里“签名见 NestedGrid 与 grid API”后面加上 README 与三份短文档。

## 切片

1. README 与起步场景：`StarterScene.vue` 及其 Lab 登记、`readme.test.ts`、README、e2e 一条。
2. 三份短文档，`NestedGrid.md` 的“接入”改成链接。
3. `NestedGrid.md`、`grid.md` 去掉“输出 N”、链接改绝对地址。

自跑：`readme.test.ts`、nb-layout 的 `bun test`、应用 `bun run typecheck`（场景能编译）、`bun run docs:check`（链接）、第 1 片的 e2e。

## 验收

- README 的例子与 Lab 场景逐字相等（`readme.test.ts`），场景能编译、e2e 能拖能拆能收。
- 包内 `.md` 里没有“输出 [0-9]”（`readme.test.ts` 里加一条扫描）。
- “约定”每条都对照过源码（在 Task README 里记下每条对照的文件与行）。

## 不做与风险

- 不做英文版：提案定第一档仍是中文。
- 不动主题与文字两节的内容。
- 风险：GitHub 地址在仓库公开之前点不开。只影响 npm 上的读者，链接本身不错。
