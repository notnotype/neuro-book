# t43 实施计划：设定页体验第二轮

## Context

开发者 2026-11-26 试用星瑕的设定页，提了九条（[README](README.md)“开发者的九条”），定了六条（同一文件“开发者定的”）；Gemini 顾问看了 8 张截图，采纳的几处也在 README。依据：[`canon/author-ui.md`](../../../../../docs/specs/canon/author-ui.md) 输出 2、5、9、16、51、53，[`canon/project.md`](../../../../../docs/specs/canon/project.md) 方法表的 `changes`，nb-ui 界面开发规范“几何、排版与动效”第 4 条与“滚动条”一节。

第 3 条（Lab 与组件目录的整理、场景规则、场景登记按插件拆开）横跨所有插件的 Lab 登记，另建 t44 做，不进本计划。

工作方式：主会话写代码与测试；前端审查派 Sonnet，内核那一处读取的筛选简单，也派 Sonnet；不 push，合入 master 自动做。

## 技术选型

- 分页切换的过渡：Vue `Transition`（`mode="out-in"`）加 CSS 位移与透明度，时长与缓动取 nb-ui 的动效令牌。否决 View Transitions（`element.startViewTransition` 只有 Chrome 147 以上有，且整页快照会盖住浮层，modern-web-guidance 的 `scoped-component-transitions`）。
- 滚动条：编辑区的页面宿主挂 nb-ui `OverlayScrollbar`（同工作台视图），原生滚动条不画、不占宽度。实施中改的：原定 `scrollbar-gutter: stable`，S2 的 e2e 里剧情的“谁知道什么”在 1440 宽、两侧栏都开时掉成窄版（编辑区 643 像素，预留的滚动条位置让它小于表格要的 640），预留宽度会让每个页面一直少十来像素。
- 原始数据的显示：应用已有的 `JsonViewer`（`packages/neuro-book/src/ui/`，折叠、等宽、只读）。
- 添加设定组的浮层：nb-ui `Popover` 加 `Input` 与列表，照“弹出列表的共同合同”；不加拼音搜索的依赖。

## 关键设计

### nb-ui `Tree`（`packages/nb-ui/src/components/navigation/Tree.vue`）

- 新属性 `toggleOn?: "row" | "arrow"`，缺省 `"row"`（现有调用方不变）。`"arrow"` 时：点行只选中、不切换展开；点箭头只切换展开、不选中；键盘照旧（左右键展开收起，Enter 与空格选中）。
- 做法：reka 的 `TreeItem` 一次点击先发 `select` 再发 `toggle`，两者都可以 `preventDefault`（`node_modules/reka-ui/dist/Tree/TreeItem.js`）。`"arrow"` 时，`toggle` 的原始事件是点击、且落点不在箭头（`[data-tree-toggle]`）里就 `preventDefault`；`select` 的原始事件落在箭头里就 `preventDefault`、也不往外发 `select`。
- 箭头加大点击区：`"arrow"` 时箭头那一格 20×20、带悬停底色，图标仍是 12 像素；缩进不变。
- `Tree.md` 写进新属性与两种行为。

### 条目树（`canon/web/components/EntryTree.vue`）

- 用 `toggle-on="arrow"`。分组行（`folder:`）不可打开，点行仍是展开收起：在 `select` 里对分组行改发 `update:expanded`。
- `EntryTree.md` 改“单击条目行”一条；Spec 输出 5 同步。

### 编辑卡（`canon/web/components/ConfirmBar.vue` 与 `EntryPageHost.vue` 的 `FieldEditor`）

1. **“发生了什么”一行预留位置**：`inline` 时，只要意图里有“从第 N 章起”（`intents` 含 `story`）且宿主给了 `note`，这一行一直在；选“从最初起”时用 `visibility: hidden` 加 `inert` 藏起来，透明度过渡（令牌时长）。卡片高度两种意图一样。页顶的 `bar` 档照旧（它不在浮层里，开发者没提）。
2. **切换意图后焦点回输入框**：意图那一组上记一次 `pointerdown`，随后的 `update:intent` 之后 `nextTick` 把焦点给值的输入框；键盘在意图组里用方向键切换时焦点不动。
3. **值没变时“保存”不可用**：`ConfirmBar` 加属性 `pristine`（宿主算：填的值与打开时的值相同）；`pristine` 时保存不可用、回车与 Ctrl+回车不保存。宿主在 `in-place-edit.ts` 里记打开时的值。页顶的确认条同样受益。
4. **短项浮层的位置**：宽度取“值的左缘到条目页内容区右缘”的距离，夹在 16rem 与 22rem 之间；左缘对齐值的起点，只有放不下 16rem 时才往左让。打开时量一次（`anchor.getBoundingClientRect()` 与 `[data-entry-page]` 内容列）。
5. **成段的文字浮在原处**：编辑层改成相对原文所在的格绝对定位（`position: absolute; inset-inline: -0.75rem; top: -0.75rem`），向下长、盖在后面的内容上；原文改成 `visibility: hidden`（占位不变），不再 `display: none`。`CharacterCard.vue`、`LookCard.vue` 的 `__in-place` 格加 `position: relative`。输入框字号与行高跟原文一样（`inherit`），高度随内容长、封顶 8 行后在框里滚。打开时整个滚进可见范围照旧。
6. Spec 输出 51 改：成段的“浮在原处、盖住后面的内容，原来那一段的占位不变”；输出 16 补“值没变时保存不可用”“发生了什么一行预留位置”。

### 分页切换（`canon/web/components/EntryPage.vue`）

- `tabpanel` 里的内容包一层 `Transition`（`mode="out-in"`，键是分页值）。方向按新旧分页在列表里的先后：往后切新内容从后方 12 像素处进来，往前切从前方；分页横排时沿横轴、竖排（`rail`）时沿纵轴。退场只淡出（`--motion-fast`），进场位移加淡入（`--motion-base`，`--ease-layout`）。不补间高度。减弱动效时没有位移，只淡入淡出。
- 换分页时，滚动容器已经滚过分页条（内容的顶在吸顶的页头下面）就把内容的顶滚回页头下沿；没滚过就不动。
- Spec 输出 9 补一句切换有过渡。

### 编辑区的滚动容器（`editor/web/components/EditorGroup.vue`）

- 页面宿主（`[data-editor-page]`）外面包一层定位的容器，旁边挂 `OverlayScrollbar`（实施中由预留滚动条位置改来，见技术选型）。所有页面标签共用这一层，宽度不再随滚动条出现与否变。`EditorGroup.md` 记一句。
- 顺带修的 nb-ui `Tooltip`：提示本身不接指针，但 reka 在外面包的定位层照样接，盖住底下能点的东西，指针停在上面还让提示一直开着（S3 的 e2e 里活动栏“设定”的提示盖住了树第一行的箭头）。`styles.css` 给包着提示的那一层也写 `pointer-events: none`。

### 面板分页（`canon/web/components/PanelView.vue`、`PanelDataView.vue`）

- 流水：去掉表头，每笔两行：首行位置、变化、结果与“改这一笔”，次行发生了什么（与估计）；窄时也不折列。
- 左边的数值卡等宽：“改”收进卡片里（行尾），不在卡片外占一列。
- “记一笔”的占位改成不写例子的通用说法。
- 显示名“面板”改“数值”（清单第九节第 2 条）：`canon/shared/components.ts` 的 label 与两份语言文件；搜 e2e 与测试里的“面板”一起改。
- 面板的整套重做（直接设值、按钮写落点）不在本 Task，归设定组第二期。

### 添加一组设定（新组件 `canon/web/components/AddComponentPicker.vue`，先写同名 `.md`）

- 锚在“+”上的浮层：上面是搜索框（打开即聚焦），下面是列表，每项“图标 + 名字”；分组：最前面“适用于人物”（类型的 `kinds` 含条目种类），其余按登记它的插件分组（设定、剧情、其它插件各一组，组名用插件的显示名）；去掉过的写“恢复‘某某’”。打了字就只按名字筛、不分组。已经有的组平时不列；搜到时列出、标“已添加”，点了切到那一页。上下键在列表里走、Enter 选、Esc 关。
- 图标取类型的界面登记（`views.entries()` 的 `declaration.icon`），没有的用 `GROUP_ICON`。
- 组件类型的读取带上登记它的插件 id（`canon/shared/contracts.ts` 的 `components` 读取，后端从贡献点的归属取），前端用插件注册表的显示名。
- 横排的“+”与竖排的“添加一组设定”都换成它；右键菜单里的“添加一组设定”下一级保持菜单（菜单里放不下搜索）。
- “+”的位置：开发者同意挪到最后一个设定组后面，但那样“+”会落在分页条（`tablist`）里面，分页条里只能有分页（ARIA；modern-web-guidance `tabs`：“A tablist may only contain tabs”），读屏与方向键都会出错。所以留在分页条外，横排时不再推到最右端，紧跟在分页条后面，悬停提示与浮层标题写“添加一组设定”。这一处要开发者知悉。
- Spec 输出 38（加一组设定）的入口描述改写。

### 三种视图（`EntryPageHost.vue` 的设定组分页，新组件 `ComponentRawView.vue`、`ComponentAgentView.vue`）

- 设定组分页（`data:` 开头的）内容右上角一个 `SegmentedControl`：“卡片 | 给 AI 看 | 原始数据”，缺省卡片；换分页回到卡片。文字、经历、情节分页不出。
- **给 AI 看**：把 `canon/backend/agent-text.ts` 里不碰世界的几个函数（`fieldsText`、`kindText`、`valueText`）挪到 `canon/shared/agent-text.ts`，`fieldsText` 加按命名空间只出一节的参数；后端 `canon_read` 改从 shared 导入（输出不变，`agent-tools.test.ts` 兜底）。前端拿条目页已读到的条目视图与声明调用它，显示成等宽的只读文字，头一行写“在看 第 3 章末尾”。这样两边是同一个函数，不会写出两种样子。
- **原始数据**：只读，不跟“在看”走，头一行写明“存下来的初值与各章的变更”。两部分：初值（`object({kind:"entry"})` 里这个命名空间的数据与字段声明）；变更（`changes` 筛这个条目、这个命名空间，按安放从旧到新，每页 20 条，“再显示”；每条只留落在这个命名空间下的那几处改动）。都用 `JsonViewer` 显示。实施中改的：`changes` 的每项本来就带存下来的变更原样，不再逐条用 `object` 取；头一行的说明不写（界面不靠说明文字解释自己），两节的标题“初值”“剧情变更（N 条）”就讲清了。
- 内核：`ChangeFilter` 加 `namespace`（只与 `entry` 同用）：只列在这个条目上改了这个命名空间下的路径的变更（`nb-canon/src/service/reads.ts` 的 `listChanges`，在 `changesOfEntry` 的候选上多筛一层）。没给 `entry` 时给了 `namespace` 得到参数错误。`canon/project.md` 方法表与输出 31 补一句；`project.test` 补用例。实施中改的：失败码表里没有通用的参数错误，为这一处加一个不值得；改成不给 `entry` 时算任何条目上落在这个命名空间下的改动，没有失败的情形。用例在 `nb-canon/tests/author-reads.test.ts`。
- Spec 新增 author-ui 输出 54“三种视图”（planned）。

## Spec 与文档改动

- `docs/specs/canon/author-ui.md`：输出 5（树的点击）、9（切换过渡）、16（保存不可用、预留一行）、38（添加的浮层）、51（成段浮在原处）；新增输出 54（三种视图）；验收 17 的“下一节往下让”改成“下一节不动”。
- `docs/specs/canon/project.md`：方法表 `changes` 的筛选加 `namespace`。
- nb-ui：`Tree.md`；canon：`EntryTree.md`、`ConfirmBar.md`、`EntryPage.md`、`PanelView.md`、`PanelDataView.md`、`CharacterCard.md`、`LookCard.md`，新组件三份 `.md`；editor：`EditorGroup.md`。

## 切片

| 片 | 内容 | 提交边界与自跑验证 |
|---|---|---|
| S1 | 编辑卡五处（预留一行、焦点、`pristine`、短项浮层位置、成段浮在原处）与 Spec 输出 16、51 | `ConfirmBar.dom.test`、`entry-page.dom.test`、`CharacterCard`／`LookCard` 的 dom 测试；e2e `canon-character`、`canon-author` |
| S2 | 分页切换过渡与滚动收回、编辑区滚动条预留 | `EntryPage.dom.test`、`EditorGroup` 的 dom 测试；e2e `canon-author`（390 宽那条） |
| S3 | `Tree` 的 `toggleOn`、条目树 | nb-ui `Tree` 的 dom 测试、`EntryTree.dom.test`；e2e `canon-author` 的树 |
| S4 | 面板分页的流水、卡片、占位，改名“数值” | `PanelView.dom.test`；e2e 里“面板”改名后的几份 |
| S5 | 添加一组设定的浮层、组件类型读取带插件 | 新组件 dom 测试、`entry-page.dom.test`；Lab 场景 |
| S6 | 内核 `changes` 的 `namespace` 筛选；agent-text 挪到 shared；三种视图 | `bun test` nb-canon 的 project 与 reads、canon 的 `agent-tools.test`；新组件 dom 测试；e2e `canon-character` 加一段 |
| S7 | 收口：真实页面走查（开发服务，不减弱动效，1440 与 1920、390）、Lab 场景、前端与后端各一个 Sonnet 审查、合入 | 受影响的 vitest 与 bun test、`typecheck`、e2e `canon-character`、`canon-author`、`canon-write`、`plot-author` |

## 验收映射

- author-ui 输出 5 → `EntryTree.dom.test`“点行只打开、点箭头只展开”；e2e `canon-author` 验收 1 里点星瑕后 `aria-expanded` 不变。
- 输出 16、51 → `ConfirmBar.dom.test`（两种意图高度相同：量“发生了什么”一行在两种意图下都在、可见性不同；`pristine` 时保存不可用）；e2e `canon-character`（切意图前后编辑卡高度相等；改外貌时“现在穿的”位置不变；短项浮层左缘不在值的左缘之左）。
- 输出 9 → e2e `canon-author` 切分页时 `tabpanel` 有进行中的过渡（不减弱动效的那一条）；减弱动效时没有。
- 输出 38 → 新组件 dom 测试（适用的在前、按插件分组、搜索、已添加跳页、键盘）。
- 输出 54 → 新组件 dom 测试；e2e `canon-character` 切到“给 AI 看”看到“魔力 = 3,110”这类行，切到“原始数据”看到初值与第 1 章那条变更。
- project 方法表 `changes` 的 `namespace` → nb-canon 的 project 测试。

## 验证

- 每片跑表里的命令；S7 跑全部受影响的 vitest（canon 插件整个目录，见记忆“canon 的 vitest 跑整个插件目录”）、nb-ui 的 Tree、editor 的 EditorGroup、`bun test` nb-canon 与 canon、`typecheck`，e2e 四份。
- 真实页面：开发服务上不减弱动效走一遍（滚动条预留要在有经典滚动条的浏览器上看，无头 Chrome 的滚动条不占宽度，量不出来，汇报里写明）。
- 变异检查：预留一行（去掉预留）、`pristine`、树的 `toggleOn`、成段浮在原处（改回推开）、`namespace` 筛选，各变一处看对应用例挂。

## 不做与风险

- 不做：面板的整套重做（第二期）；文字分页里“第 X 章改过”插在值中间（交给 w00055）；“给 AI 看”的复制按钮；原始数据的编辑；拼音搜索。
- 风险：成段编辑层浮起来以后，盖住的下一项在编辑时点不到（开发者已知）；编辑层在页面底部时向下长会超出内容，靠打开时滚进可见范围与滚动容器的可滚范围兜住，e2e 量“贴着底边打开时保存在窗口内”那条已有。
- 风险：分页过渡用 `out-in`，切换时有一个退场时长的空白；令牌是 `--motion-fast`，连续快点时 Vue 会打断旧的过渡。
