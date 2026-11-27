# t45 实施计划

## Context

开发者 2026-11-27 试用 t43 合入后的条目页，提了四条（[README](README.md) 的“开发者的四条”），四道选择题的答复记在 README 的“决定”。本 Task 做决定 1 到 3：

- 加设定组改成对话框，能一次勾几组；种类登记几种有名字的预设，点一个就勾上它的几组；新建条目对话框用同一个勾选列表。
- 三种看法改名“用户视图 | AI视图 | 原始视图”，从内容上方的一行挪到选中的设定组分页上（“人物 ▾”）。
- 成段文字的编辑卡从“浮在原文上面”改成“原文下方的浮层”。

依据：[`canon/author-ui.md`](../../../../../docs/specs/canon/author-ui.md) 输入一节的 `canon.entry-kinds`、输出 4、9、38、51、54；nb-ui [`Tabs.md`](../../../../../packages/nb-ui/src/components/controls/Tabs.md)、[`ContextMenu.md`](../../../../../packages/nb-ui/src/components/popup/ContextMenu.md)。决定 4（人物分页用富文本改）归 w00055，不在这里。

工作方式：分支 `feat/w00039-t45-entry-page-polish-3`，在 `.worktree/w00039-novel-writing-plugins` 里从 master 开；主会话写代码与测试（中等大小，不拆 e2e 子代理）；计划审查与实现审查各派一个 Sonnet（前端为主；预设的登记格式是简单的声明扩展，不碰内核时序与数据格式，不开 omp）。计划审查第 1 轮 13 条，处理见 [evidences/design-review.txt](evidences/design-review.txt)，本稿已按它改。

## 技术选型

- 对话框：nb-ui `Dialog`（`default` 尺寸），390 宽左右各留 16 像素；不另做底部抽屉。
- 勾选列表：canon 自己的组件，沿用“添加一组设定”浮层现有的写法：焦点一直在搜索框里（`combobox`），列表是 `listbox`（`aria-multiselectable`），高亮靠 `aria-activedescendant`；行用 nb-ui 弹出列表的行样式（`.nb-ui-menu-item` 与勾选列）。不用 `CheckboxGroup`（不分组、不带图标、没有高亮），也不用“方向键把焦点移进行上”的做法（中文输入法下在行上打字接不住）。
- 分页上的看法菜单：nb-ui `ContextMenu`（条目页右键菜单在用），按分页的矩形定位；本 Task 给它补 `radio` 项与 `anchor`（见下）。不用 `DropdownMenu`：它要把分页本身交给 Reka 当触发器，会改写分页的角色与点击。
- 成段文字的浮层：nb-ui `Popover` 锚在原文按钮上，与短项同一个组件。

## 关键设计

### `packages/nb-ui/src/components/popup/ContextMenu.vue`（含 `ContextMenuPanel.vue`、`context-menu.types.ts`、`ContextMenu.md`）

- `ContextMenuItem.type` 加 `"radio"` 与 `group`，照 `DropdownMenu` 的写法：`role="menuitemradio"`、`aria-checked`，勾画在左列，`checked` 由宿主受控。
- 新属性 `anchor?: Element | null`：在它上面按下与点击不算“点外面”（同 `Popover` 的“锚在外部元素上”），宿主自己的点击处理决定开关。没有它时，菜单开着再点锚元素会先被当成点外面关掉、紧接着锚的点击又把它打开。

### `packages/nb-ui/src/components/controls/Tabs.vue`、`Tabs.md`

`TabsItem` 加两项：

```ts
/** 这个标签带一个菜单：标题后留一格向下的箭头（选中时显出，未选中时透明但占位，换选中项时别的标签不挪），标签带 aria-haspopup="menu" 与 aria-expanded。 */
menu?: {open: boolean};
/** 标题后的附注（例如“AI视图”），弱一号的颜色；出现、消失与换字时宽度有过渡，不进标题字符串，截断时先截标题。 */
note?: string;
```

已经选中、带 `menu` 的标签：点它（含 Enter、Space 触发的原生 click，不另挂 keydown）或按 ArrowDown 发 `menu(value, element)`；没选中时点它照旧只发 `update:modelValue`（第一次点是选中，第二次点才是菜单）。不改别的标签、roving tabindex 与方向键。测量层（`adapt`）把箭头格与附注一起量。附注的宽度过渡用 `grid-template-columns: 0fr → 1fr`（时长取令牌），读屏名里带上附注（“人物，AI视图”）。`Tabs.md` 的“不支持”改写：标签上的菜单只发事件，菜单由消费方画。`ui-development-spec.md` 4.2 加一句：一组去处里每个去处另有几种看法时，看法挂在选中的标签上（`menu`），不另放分段按钮。

### `packages/neuro-book/src/plugins/canon/web/components/EntryPage.vue`、`EntryPageNav.vue`、`entry-tabs.ts`（各自的 `.md`）

- `EntryTab` 加 `looks?: boolean`（这一页能换看法，宿主给设定组分页），骨架不按 `data:` 前缀猜。
- `EntryPage` 新增属性 `looks?: readonly {value; label}[]` 与 `look?: string`，事件 `update:look`。分页项里带 `looks` 的都给 `menu`（只有选中的显出箭头），选中的那一页在不是第一个看法时 `note` 写看法名。
- 看法菜单独占一个状态（`lookMenu`：锚元素与开关），不与右键菜单的 `context` 共用；开一个时关另一个。`menu` 事件：菜单开着就关，关着就按分页的矩形开（x 取左缘，y 取下缘加 4，`anchor` 给分页元素），项是三个 `radio`。关闭的原因：`select`、`escape`、`tab` 时焦点回到选中的分页；`outside` 不动焦点。换选中的分页、横排竖排切换时关掉。
- 竖排的 `EntryPageNav`：带 `looks` 的行行尾留箭头格（选中时显出），看法名是行内单独的附注（`shrink-0`，标题先截），点选中的那一行发同样的 `menu(value, element)`。
- 分页右键菜单（已有）在带 `looks` 的分页上加同样三项（一组 `radio`，在“去掉这组设定”之前，中间一条分隔线）。
- “添加一组设定”的入口（“＋”与竖排的那一行）不再自己开浮层，发 `add-open`；对话框归 `EntryPageHost`（见下），所以 `pickerAnchor` 与 `[rail, canAdd]` 变化时关浮层的逻辑去掉，`canAdd` 变假时宿主关对话框。
- 换看法沿用 t43 的过渡（内容淡出淡入）；分页上附注的出现与消失有宽度过渡。

### `packages/neuro-book/src/plugins/canon/web/components/EntryPageHost.vue`

- 删掉内容上方那一行 `SegmentedControl`，`dataLook` 交给 `EntryPage` 的 `look`；换分页回到用户视图（已有）。
- 文案：`entry.views.card/agent/raw` 改成“用户视图”“AI视图”“原始视图”，英文 “User view”“AI view”“Raw view”；`entry.views.label` 用作菜单的读屏名。
- 成段文字（`fieldEditorOf` 的 `layout: "block"`）：不再画绝对定位的编辑卡，改成与短项同一个 `Popover`，`side: "bottom"`、`align: "start"`，宽度取原文按钮的宽（加浮层内边距与边框 26），不窄于 22rem、不越出条目页；`collisionBoundary` 同短项。下方放不下时由避让翻到原文上方（与短项相同），不与原文重叠；内容区高度封顶在 `--reka-popper-available-height`，超出在里面滚，保存按钮总在窗口里。成段文字的 `update:open(false)` 整个忽略：点外面不收起；Escape 由 `ConfirmBar` 自己接（它在组字中不接、已 `preventDefault` 时 Reka 不再发关闭），焦点不在编辑卡里时 Escape 不起作用（旧做法同样如此，写进 Spec）。去掉旧的 `reveal`（对传送到页面外的浮层不起作用），打开时把原文按钮滚进可见范围（`block: "nearest"`）。
- 成段文字开着时再点它的原文按钮：只把焦点放回输入框，不重开（`edit.open` 会重置草稿）。点别的字段照旧换成那一项（同短项，草稿不留）。
- “现在的状态”这一格的编辑从细节里的“改起点”开始，锚在这一行（不是切换细节的按钮），实施时按 `CharacterView` 的现有流程接。
- `CharacterCard.vue`、`LookCard.vue`：去掉 `data-editing-in-place` 时藏原文的样式与 `relative` 那一格；`passage-editor` 插槽改成给 `{id, anchor}`，`CharacterView`、`LookView` 把 `anchor` 传给 `context.FieldEditor`。`component-views.ts` 的注释同步。
- 加设定组（见下面对话框一节）：`addComponents(types, from)` 一个入口，对话框用 `from: "dialog"`（打开时 `openDialog()` 记基线版本，失败写进对话框、对话框不关、勾选保留），右键子菜单的单加一组用 `from: "menu"`。

### `packages/neuro-book/src/plugins/canon/shared/entry-kinds.ts`

`EntryKindDeclarationSchema` 加（预设项 `additionalProperties: false`）：

```ts
presets?: {                 // maxItems 20
    /** 同一个种类里唯一（去掉首尾空白比），minLength 1、pattern \S；别的插件写同一个 id 是往这个预设里追加设定组。 */
    id: string;
    /** 显示名，minLength 1、pattern \S；几条登记都写了时取第一条（内置在前），写了不同的名字记一条诊断。 */
    label?: string;
    /** minItems 1，元素 minLength 1。 */
    components: string[];
}[];
```

`mergeEntryKinds` 照默认组的并法并预设：同一个种类、同一个预设 id 的设定组并起来、去重，内置的在前；预设的先后按第一次出现（内置的在前，别的插件按贡献 id），没有另外的排序出口，写进 Spec。`EntryKind` 加 `presets: readonly {id; label?; components}[]`。新函数 `kindPresets(kinds, kind, available)`：写到不可用类型的那几组当作没写；并完以后没有显示名、或一组可用的也没有的预设不给。

内置（`canon/shared/components.ts` 的 `BUILTIN_ENTRY_KINDS`）给人物两种：`basic`“基本”（人物、形象），`main`“主要角色”（人物、形象、数值）；剧情插件（`plot/plugin.ts`）加一条 `canon.entry-kinds` 登记，只往人物的 `main` 里追加知情、态度（canon 不在时这条登记按 `unknown-point` 搁着，已核实）。

诊断（`canon/backend/plugin.ts`）另起事件 `canon.entry-kinds.preset-problem`，键带预设 id，数据 `{kind, preset, problem: "missing-component" | "no-label" | "label-conflict", type?}`，文字各一句；不复用 `missingDefaults` 的键与话。

### `packages/neuro-book/src/plugins/canon/web/components/ComponentChecklist.vue`（新，带 `.md`；`add-component-picker.ts` 改名 `component-checklist.ts`）

勾选列表，两处共用（加设定组对话框、新建条目对话框）。受控：

```ts
interface ChecklistItem {
    readonly value: string;
    readonly label: string;
    readonly iconClass: string;
    readonly group: "canon" | "plot" | "other";
    /** 类型适用的种类（类型声明的 kinds）；列表按 kind 属性自己判“适用于”。 */
    readonly kinds: readonly string[];
    /** 条目上已经有：勾着、不能取消，行尾写“已添加”。新建时恒为假。 */
    readonly present: boolean;
    /** 去掉过：写“恢复‘某某’”。 */
    readonly restore: boolean;
}
type ComponentChecklistProps = {
    items: readonly ChecklistItem[];
    /** 选定的种类；空串时没有“适用于”一组。新建对话框只在种类选定以后传。 */
    kind?: string;
    presets?: readonly {id: string; label: string; components: readonly string[]}[];
    /** 勾着的类型 id（不含已添加的）。 */
    modelValue: readonly string[];
    /** 列表封顶高度（加设定组对话框给，新建对话框不给、由对话框正文统一滚）。 */
    maxHeight?: string;
};
emits: update:modelValue(ids), "update:preset"(id)（点了预设，新建对话框据此不算“动过勾选”）, present(type)（在已添加的那一行上按 Enter 或点它）, submit()（Ctrl 或 ⌘ 加 Enter）
```

- 顶上搜索框（打开时焦点进它，焦点一直留在这里）；下面一排预设按钮（有预设时，`role="group"` 带读屏名），点了把它里面还没添加、没勾的几组勾上，不取消别的；全都已添加或已勾时按钮不可用。
- 列表按组（`role="group"` 加组名）：“适用于<种类>”、“设定”、“剧情”、“插件”，空的组不出；每行左列是勾（勾着时画勾）、图标、名字；已添加的勾着、`aria-disabled`、行尾写“已添加”；去掉过的写“恢复‘某某’”。打了字只按名字筛（不分大小写、不管空格）、不分组；被筛掉的勾选照旧算数。
- 键盘：上下键移高亮（到头绕回）；Enter 勾或取消高亮的那一行（已添加的那一行发 `present`）；Ctrl 或 ⌘ 加 Enter 发 `submit`；组字中的按键不处理。点一行同 Enter。高亮走到看不见的行时列表滚到露出它。
- 勾与取消有过渡（勾的出现、行的选中色）。

### `packages/neuro-book/src/plugins/canon/web/components/AddComponentDialog.vue`（新，取代 `AddComponentPicker`）

- nb-ui `Dialog`，标题“添加设定组”，内容是 `ComponentChecklist`（`maxHeight` 约 22rem），页脚“取消”与主按钮：勾了 N 组时写“添加 N 组”，没勾时写“添加”且不可用；主按钮带快捷键提示（同确认条的保存，读屏名不含提示）。
- 属性 `open`、`items`、`kind`、`presets`、`busy`、`error`；事件 `add(types)`、`show(type)`、`update:open`。`submit` 与主按钮发 `add(勾着的)`；`present` 发 `show(type)` 并关上。写入在途时按钮不可用、对话框不关；失败原因写在页脚左侧的状态行（`Dialog` 的 `status`），勾选保留。关上后焦点回到打开它的入口（横排的“＋”或竖排的那一行，按 `data-add-component` 现找）。
- 宿主 `addComponents`：一次 `runEntries`，几条 `{op: "component", action: "add"}`；成功提示一组时照旧“加上了‘某某’”，几组时“加上了 N 组设定”；失败时按 `problems[].path` 的下标指名（“‘某某’已经加上了”，并重读后把它显示成已添加）；成功后切到第一个有命名空间的新加类型（沿用 `pendingTab`）。
- 删掉 `AddComponentPicker.vue`、`.md`、`.dom.test.ts` 与 Lab 的 `AddComponentPickerFixture.vue` 及其场景注册。
- 分页右键菜单的“添加一组设定”子菜单保留（单加一组的快路），走同一个 `addComponents`。

### `packages/neuro-book/src/plugins/canon/web/components/NewEntryDialog.vue`、`entries-view.ts`、`new-entry.ts`

“启用哪些数据”换成 `ComponentChecklist`（不封顶，对话框正文统一滚），`kind` 只在种类选定（点种类按钮或输入框失焦）以后传，`presets` 取选定种类的预设。种类的默认勾选规则不变（作者没手动勾过时整组换成默认，`typesTouched`）；点预设不算手动勾过：换种类时预设勾上的几组随默认一起换掉。Ctrl+Enter（`submit`）在这里不做事，不触发新建。`entries-view.ts` 从 `entryKinds` 算每个种类的预设交给对话框；`types` 换成 `ChecklistItem`。

## Spec 与文档改动

- `author-ui.md`：
  - 输入一节 `canon.entry-kinds` 加 `presets`、并法、先后与诊断（planned）。
  - 输出 4：启用哪些数据是分组、带图标、可搜的勾选列表，上面有选定种类的预设；点预设不算动过勾选（planned）。
  - 输出 9：带看法的分页上的箭头与附注、选中再点开看法菜单（planned）。
  - 输出 38：浮层改成对话框：勾选、预设、“添加 N 组”、Enter 与 Ctrl+Enter、已添加的那一行、失败时不关（planned）。
  - 输出 51：成段文字改成原文下方的浮层（放不下时在上方），原文不动、不重叠；点外面不收起；焦点在编辑卡里按 Escape 放弃；再点原文回到输入框（planned）。
  - 输出 54：名字改成“用户视图、AI视图、原始视图”，位置改到分页上（planned）。
- nb-ui `Tabs.md`、`ContextMenu.md`、`ui-development-spec.md` 4.2：见上。
- 组件的同名 `.md`：`EntryPage`、`EntryPageNav`、`EntryPageHost`、`CharacterCard`、`LookCard`、`CharacterView`、`LookView`、`NewEntryDialog`，新建 `ComponentChecklist`、`AddComponentDialog`。
- 文案（zh-CN、en-US 两份）：看法三项改名；对话框标题、“添加 N 组”、“添加”、“已添加”、预设一排的读屏名、搜索框、空态、几组的成功提示、指名的失败提示、看法菜单的读屏名。

## 切片

0. **S0 测试的分页辅助函数**：e2e 与 dom 测试里“点分页”的写法改成“已选中就不点”（`aria-selected`），先于 S2 提交，跑一遍受影响的 dom 测试（e2e 在 S6 一起跑）。e2e 共 35 处（canon-author 16、canon-write 9、canon-character 5、plot-author 5），优先改辅助函数，逐处确认。
1. **S1 成段文字的浮层**（EntryPageHost 的成段文字、两张卡片、`CharacterView` 与 `LookView`）：`entry-page.dom.test.ts` 与卡片的 dom 测试、Lab；提交。
2. **S2 看法挪到分页上**（nb-ui `ContextMenu` 的 radio 与 `anchor`、`Tabs` 的 `menu` 与 `note`，`EntryPage`、`EntryPageNav`、`entry-tabs.ts`、`EntryPageHost` 的看法、文案）：nb-ui 的两组测试、`EntryPage.dom.test.ts`、`EntryPageNav.dom.test.ts`、`entry-page.dom.test.ts` 里 `data-look-*` 的迁移、Lab（含英文与竖排）；提交。
3. **S3 种类的预设**（`entry-kinds.ts`、内置与剧情的登记、诊断）：`canon/entry-kinds.dom.test.ts`、后端诊断的测试；提交。
4. **S4 勾选列表与加设定组对话框**（`ComponentChecklist`、`AddComponentDialog`、`addComponents`、删浮层与它的 Lab 场景）：新组件的 dom 测试、`EntryPage.dom.test.ts` 里 `[data-add-component]` 的迁移、Lab（含 30 多项与英文）；提交。
5. **S5 新建条目对话框**：`NewEntryDialog` 与 `entries-view.dom.test.ts` 的迁移（`checked()` 读法）、Lab；提交。
6. **S6 收口**：e2e（`canon-character.e2e.ts:258` 那一条整条按新界面重写）、开发服务与生产构建走查、实现审查、合入。

每片自跑：包内类型检查、受影响的 vitest（`bun run test:affected --since master`），nb-ui 改动另跑 nb-ui 组件测试，canon 的 vitest 跑整个插件目录。

## 验收映射

| Spec | 覆盖 |
|---|---|
| 输入 `canon.entry-kinds` 的 `presets` | `canon/entry-kinds.dom.test.ts`（并法、内置在前、不可用的去掉、空预设与无名预设不给）；后端诊断三种 |
| 输出 4 | `NewEntryDialog.dom.test.ts`（预设勾上、点预设后换种类随默认一起换、Ctrl+Enter 不新建）；e2e `canon-author` 新建人物 |
| 输出 9、54 | nb-ui `Tabs` 测试（选中再点、Enter 只发一次 `menu`、ArrowDown、未选中的点只选中、箭头占位不挪、附注进读屏名）；nb-ui `ContextMenu` 测试（radio、在 `anchor` 上点不算外面）；`EntryPage.dom.test.ts`（菜单三项、选了发 `update:look`、再点同一页关上、四种关闭原因的焦点、换分页关上、附注）；e2e `canon-character` 三种看法 |
| 输出 38 | `ComponentChecklist.dom.test.ts`（勾、预设、已添加不可取消、Enter 与 Ctrl+Enter、组字不处理、筛掉的勾选照旧算）、`AddComponentDialog.dom.test.ts`（添加 N 组、`present`、在途不关、失败写状态行且勾选保留、焦点回入口）；`entry-page.dom.test.ts`（几组一次写入、指名的失败、切到第一个有命名空间的）；e2e `canon-character` 一次加两组 |
| 输出 51 | `entry-page.dom.test.ts`（浮层不盖原文、点外面不收起、Escape 放弃、再点原文焦点回输入框且草稿还在）；e2e `canon-character` 外貌编辑浮层与原文不重叠、1440 下在下方 |

## 验证

- 受影响的 vitest 与 bun 测试；e2e `canon-character`、`canon-author`、`canon-write`、`plot-author`（S0 改过点分页的写法；先 `bun run build && bun run build:e2e`）。
- 生产构建走查 1440、1920（竖排）、390：外貌与性格的浮层位置（含滚到页底的最后一段），看法菜单（含竖排与英文），加设定组对话框（中英文），新建人物；收页面报错。
- 开发服务上看一遍换看法、附注的宽度过渡与对话框开合，交付前重启开发服务并请开发者刷新。
- 变异检查：预设并法按 id 合并改成不合并、已添加的可以取消、选中再点不发 `menu`、ContextMenu 的 `anchor` 不排除、成段文字点外面收起、再点原文重开。

## 不做与风险

- 不做：人物分页的富文本编辑（决定 4，归 w00055）；“看得出能点”的提示；组织、地点、物品的预设；拼音搜索；成段文字浮层输入框的字与原文左对齐（与短项一样左缘对齐值的起点）。
- 接受取舍：焦点不在编辑卡里时 Escape 不放弃成段文字（旧做法同样如此；要补需要 nb-ui `Popover` 发关闭原因）。
- 风险：`Tabs` 的“选中再点出菜单”会让习惯性地再点一下选中分页的人看到菜单；再点一次、Escape、点外面都能关，由测试固定行为。
- 风险：成段文字改成浮层后，原文与输入框里的字同时出现两份（开发者选这个时知悉）。
