# t45 实施计划

## Context

开发者 2026-11-27 试用 t43 合入后的条目页，提了四条（[README](README.md) 的“开发者的四条”），四道选择题的答复记在 README 的“决定”。本 Task 做决定 1 到 3：

- 加设定组改成对话框，能一次勾几组；种类登记几种有名字的预设，点一个就勾上它的几组；新建条目对话框用同一个勾选列表。
- 三种看法改名“用户视图 | AI视图 | 原始视图”，从内容上方的一行挪到选中的设定组分页上（“人物 ▾”）。
- 成段文字的编辑卡从“浮在原文上面”改成“原文下方的浮层”。

依据：[`canon/author-ui.md`](../../../../../docs/specs/canon/author-ui.md) 输入一节的 `canon.entry-kinds`、输出 4、9、38、51、54；nb-ui [`Tabs.md`](../../../../../packages/nb-ui/src/components/controls/Tabs.md)。决定 4（人物分页用富文本改）归 w00055，不在这里。

工作方式：分支 `feat/w00039-t45-entry-page-polish-3`，在 `.worktree/w00039-novel-writing-plugins` 里从 master 开；主会话写代码与测试（中等大小，不拆 e2e 子代理）；计划审查与实现审查各派一个 Sonnet（前端为主；预设的登记格式是简单的声明扩展，不碰内核时序与数据格式，不开 omp）。

## 技术选型

- 对话框：nb-ui `Dialog`（`default` 尺寸），390 宽左右各留 16 像素；不另做底部抽屉。
- 勾选列表：canon 自己的组件，行用 nb-ui `Checkbox` 加图标；不用 `CheckboxGroup`（它不分组、不带图标、没有高亮与键盘走行）。
- 分页上的看法菜单：nb-ui `ContextMenu`（条目页的右键菜单已经在用），按分页的矩形定位；不用 `DropdownMenu`（要把分页本身交给 Reka 当触发器，会改写分页的 `role` 与点击）。
- 成段文字的浮层：nb-ui `Popover` 锚在原文按钮上，与短项同一个组件。

## 关键设计

### `packages/nb-ui/src/components/controls/Tabs.vue`、`Tabs.md`

`TabsItem` 加 `menu?: {open: boolean}`：给了它的标签在标题后画一个小的向下箭头（`i-lucide-chevron-down`，随 `open` 转半圈），标签带 `aria-haspopup="menu"` 与 `aria-expanded`。已经选中的这个标签再被点、或焦点在它上面按 Enter、Space、ArrowDown 时发 `menu(value, element)`；没选中时点它照旧只发 `update:modelValue`（第一次点是选中，第二次点才是菜单）。不改别的标签的行为、不改 roving tabindex。`Tabs.md` 的“不支持”里删掉“溢出菜单”那一句里与此冲突的部分，写明“标签上的菜单只是发事件，菜单由消费方画”；“同类零件的分工”（`ui-development-spec.md` 4.2）加一句：一组去处里每个去处另有几种看法时，看法挂在选中的标签上，不另放分段按钮。

### `packages/neuro-book/src/plugins/canon/web/components/EntryPage.vue`、`EntryPageNav.vue`（各自的 `.md`）

- `EntryPage` 新增属性 `looks?: readonly {value; label}[]`（空时不出菜单）与 `look?: string`，事件 `update:look`。分页项里当前选中的那个设定组分页（`data:` 开头）带 `menu`，标题在不是第一个看法时写成“人物 · AI视图”。`menu` 事件按分页的矩形开 `ContextMenu`（x 取左缘，y 取下缘加 4），项是三个 `radio`，选了发 `update:look`；按 Escape 或选了以后焦点回到分页。
- 竖排的 `EntryPageNav`：选中的设定组那一行行尾画同一个箭头，点选中的那一行开同一个菜单（EntryPage 把开菜单的函数交给它，事件形状同上）。
- 分页右键菜单（已有）在设定组分页上加同样三项（一组 `radio`，放在“去掉这组设定”之前，中间一条分隔线）。
- 换看法沿用 t43 的过渡（内容淡出淡入）；分页标题的变长变短由 `Tabs` 的指示线跟随。

### `packages/neuro-book/src/plugins/canon/web/components/EntryPageHost.vue`

- 删掉内容上方那一行 `SegmentedControl`，`dataLook` 交给 `EntryPage` 的 `look`；换分页回到用户视图（已有）。
- 文案：`entry.views.card/agent/raw` 改成“用户视图”“AI视图”“原始视图”，英文 “User view”“AI view”“Raw view”；`entry.views.label` 用作菜单的读屏名。
- 成段文字（`fieldEditorOf` 的 `layout: "block"`）：不再画绝对定位的编辑卡，改成与短项同一个 `Popover`，`side: "bottom"`、`align: "start"`，宽度取原文按钮的宽（加浮层内边距与边框 26），不窄于 22rem、不越出条目页；`collisionBoundary` 同短项。成段文字的 `update:open(false)`（点外面）不收起，Escape 与“取消”照旧经 `dismiss`（实施时核对 `ConfirmBar` 的 Escape 是自己处理还是靠浮层的 `update:open`，靠浮层的就在 `Popover` 外包一层 keydown 区分）。打开后滚进可见范围的处理保留（浮层靠下时翻到上面由 `Popover` 的避让做）。
- `CharacterCard.vue`、`LookCard.vue`：去掉 `data-editing-in-place` 时藏原文的样式与 `relative` 那一格；`passage-editor` 插槽改成给 `{id, anchor}`（原文按钮），`CharacterView`、`LookView` 把 `anchor` 传给 `context.FieldEditor`。`component-views.ts` 的注释同步。

### `packages/neuro-book/src/plugins/canon/shared/entry-kinds.ts`

`EntryKindDeclarationSchema` 加：

```ts
presets?: {
    /** 同一个种类里唯一；别的插件写同一个 id 是往这个预设里追加设定组。 */
    id: string;
    /** 显示名；几条登记都写了时取第一条（内置在前）。 */
    label?: string;
    components: string[];
}[];
```

`mergeEntryKinds` 照默认组的并法并预设：同一个种类、同一个预设 id 的设定组并起来、去重，内置的在前；预设的先后按第一次出现。`EntryKind` 加 `presets: readonly {id; label; components}[]`。新函数 `kindPresets(kinds, kind, available)`：写到不可用类型的那几组当作没写；并完以后没有显示名、或一组可用的也没有的预设不给。

内置（`canon/shared/components.ts` 的 `BUILTIN_ENTRY_KINDS`）给人物两种：`basic`“基本”（人物、形象），`main`“主要角色”（人物、形象、数值）；剧情插件（`plot/plugin.ts`）加一条 `canon.entry-kinds` 登记，只往人物的 `main` 里追加知情、态度。别的种类先不给预设。缺了显示名的预设与写到没登记类型的预设，诊断沿用 `missingDefaults` 的写法（项目入口在登记变化时写一条）。

### `packages/neuro-book/src/plugins/canon/web/components/ComponentChecklist.vue`（新，带 `.md`、`component-checklist.ts`）

勾选列表，两处共用（加设定组对话框、新建条目对话框）。受控：

```ts
type ComponentChecklistProps = {
    items: readonly AddComponentItem[];          // 沿用 add-component-picker.ts 的形状
    kind?: string;                               // “适用于<种类>”一组
    presets?: readonly {id: string; label: string; components: readonly string[]}[];
    modelValue: readonly string[];               // 勾着的类型 id（不含已添加的）
    searchable?: boolean;                        // 缺省 true
};
emits: update:modelValue(ids), submit(current: string | null)   // Enter；current 是高亮或聚焦的那一行，由对话框决定做什么
```

- 顶上搜索框（焦点进它）；下面一排预设按钮（有预设时），点了把它里面还没添加、没勾的几组勾上，不取消别的；全都已添加或已勾时按钮不可用。
- 列表按组：“适用于<种类>”、“设定”、“剧情”、“插件”，空的组不出；每行勾选框、图标、名字；已添加的勾着、不可用、行尾写“已添加”；去掉过的写“恢复‘某某’”。打了字只按名字筛、不分组。
- 键盘：焦点在搜索框时，Space 照常打字，列表的第一行是高亮行；ArrowDown 把焦点移进列表（落在行的勾选框上，在列表里上下键走行）。焦点在行上时 Space 勾或取消这一行，打字（可打印字符）把焦点送回搜索框接着打，ArrowUp 走过第一行回到搜索框。Enter 在两处都发 `submit(高亮或聚焦的那一行)`。列表在自己里面滚，走到看不见的行时滚到露出它。
- 列表封顶高度（对话框里约 22rem），超出在里面滚（nb-ui 的滚动条）。

### `packages/neuro-book/src/plugins/canon/web/components/AddComponentDialog.vue`（新，取代 `AddComponentPicker`）

- nb-ui `Dialog`，标题“添加设定组”，内容是 `ComponentChecklist`，页脚“取消”与主按钮：勾了 N 组时写“添加 N 组”，没勾时写“添加”且不可用。
- Enter：勾了就提交；一组也没勾时加高亮的那一行（快速加一组）；高亮的是已添加的那一组时切到它的分页（沿用 `show`）。
- 发 `add(types: string[])`、`show(type)`、`update:open(false)`；关上后焦点回到“＋”。
- `EntryPageHost` 的写入：一次 `runEntries`，几条 `{op: "component", action: "add"}`，成功提示“加上了 N 组设定”（一组时照旧“加上了‘某某’”），切到第一组新加的分页（沿用 `pendingTab`）。
- 删掉 `AddComponentPicker.vue`、`.md`、`.dom.test.ts`；`add-component-picker.ts` 的类型与分组规则留给 `ComponentChecklist` 用（文件改名 `component-checklist.ts`）。
- 分页右键菜单的“添加一组设定”子菜单保留（单加一组的快路）。

### `packages/neuro-book/src/plugins/canon/web/components/NewEntryDialog.vue`、`entries-view.ts`、`new-entry.ts`

“启用哪些数据”换成 `ComponentChecklist`（`searchable` 在类型多于 8 个时开），`kind` 跟着对话框里的种类，`presets` 取这个种类的预设。种类的默认勾选规则不变（作者没动过勾选时整组换成默认，`typesTouched`）；点预设算动过勾选。`entries-view.ts` 从 `entryKinds` 算每个种类的预设交给对话框；`types` 换成带图标与分组的 `AddComponentItem`（`present` 恒为假）。

## Spec 与文档改动

- `author-ui.md`：
  - 输入一节 `canon.entry-kinds` 加 `presets` 与并法（planned）。
  - 输出 4：启用哪些数据是分组、带图标、可搜的勾选列表，上面有这个种类的预设（planned）。
  - 输出 9：选中的设定组分页上的看法菜单（planned）。
  - 输出 38：浮层改成对话框，勾选、预设、“添加 N 组”、Enter 的规则（planned）。
  - 输出 51：成段文字改成原文下方的浮层，原文不动（planned）。
  - 输出 54：名字改成“用户视图、AI视图、原始视图”，位置改到分页上（planned）。
- nb-ui `Tabs.md`、`ui-development-spec.md` 4.2：见上。
- 组件的同名 `.md`：`EntryPage`、`EntryPageNav`、`EntryPageHost`、`CharacterCard`、`LookCard`、`CharacterView`、`LookView`、`NewEntryDialog`，新建 `ComponentChecklist`、`AddComponentDialog`。

## 切片

1. **S1 成段文字的浮层**（关键设计 EntryPageHost 的成段文字、两张卡片）：dom 测试、Lab；提交。
2. **S2 看法挪到分页上**（nb-ui `Tabs`、`EntryPage`、`EntryPageNav`、`EntryPageHost` 的看法、文案）：nb-ui 的 Tabs 测试、条目页 dom 测试、Lab；提交。
3. **S3 种类的预设**（`entry-kinds.ts`、内置与剧情的登记、诊断）：bun 测试；提交。
4. **S4 勾选列表与加设定组对话框**（`ComponentChecklist`、`AddComponentDialog`、多组写入）：dom 测试、Lab；提交。
5. **S5 新建条目对话框**：dom 测试、Lab；提交。
6. **S6 收口**：e2e、开发服务与生产构建走查、实现审查、合入。

每片自跑：`bun run typecheck`（包内）、受影响的 vitest（`bun run test:affected --since master`），nb-ui 改动另跑 nb-ui 组件测试。

## 验收映射

| Spec | 覆盖 |
|---|---|
| 输入 `canon.entry-kinds` 的 `presets` | `canon/entry-kinds.dom.test.ts`（并法、内置在前、不可用的去掉、空预设不给） |
| 输出 4 | `NewEntryDialog.dom.test.ts`（预设勾上、种类默认规则不变）；e2e `canon-author` 新建人物 |
| 输出 9、54 | nb-ui `Tabs` 测试（选中再点发 `menu`、Enter、ArrowDown、`aria-haspopup`）；`EntryPage.dom.test.ts`（菜单三项、选了发 `update:look`、标题写看法、焦点回分页）；e2e `canon-character` 三种看法 |
| 输出 38 | `ComponentChecklist.dom.test.ts`、`AddComponentDialog.dom.test.ts`（勾、预设、已添加不可取消、Enter 两种、Escape）；e2e `canon-character` 一次加两组、切到第一组 |
| 输出 51 | `entry-page.dom.test.ts`（成段文字的浮层在原文下方、原文还在、点外面不收起、Escape 放弃）；e2e `canon-character` 外貌编辑浮层的上缘不高于原文下缘 |

## 验证

- 受影响的 vitest 与 bun 测试；e2e `canon-character`、`canon-author`（先 `bun run build && bun run build:e2e`）。
- 生产构建走查 1440、1920（竖排）、390：外貌与性格的浮层位置，看法菜单，加设定组对话框（中英文），新建人物；收页面报错。
- 开发服务上看一遍换看法与对话框开合的过渡，交付前重启开发服务并请开发者刷新。
- 变异检查：预设并法按 id 合并改成不合并、已添加的可以取消、选中再点不发 `menu`、成段文字点外面收起。

## 不做与风险

- 不做：人物分页的富文本编辑（决定 4，归 w00055）；“看得出能点”的提示；组织、地点、物品的预设；拼音搜索。
- 风险：`Tabs` 的“选中再点出菜单”会让习惯性地再点一下选中分页的人看到菜单；Escape 与点外面都能关，代价小，由 `Tabs` 的测试固定行为。
- 风险：成段文字改成浮层后，原文与输入框里的字同时出现两份（开发者选这个时知悉）。
