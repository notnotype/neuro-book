---
标签: [state:inject, env:portal]
别名: ["条目条", "Item Strip"]
---

# WorkbenchItemStrip

状态栏与标题栏里一侧的条目（[`ui/workbench-shell.md`](../../../../../../../docs/specs/ui/workbench-shell.md) 外壳四输出 33、34、42、43）：把贡献方给出的条目排成一行，放不下时按优先级收进“更多”。条目来自 `ItemRegistry.shown()`，组件只渲染、只发事件，不执行命令、不读领域状态。

## 布局

- 一行，条目之间间距 4px；高度与字号随宿主（状态栏 20px、标题栏 28px，由 `itemHeight` 给出）。
- 有命令的条目是 ghost 按钮，没有命令的是纯文字（`role="status"`）。按钮与“更多”填满条的高度，焦点画成按钮里面的一圈内嵌焦点线。单个条目最宽 320px，超出时省略，提示里有全文。
- `state` 为 `warning`、`error` 时文字与图标取 `--status-warning`、`--status-danger`。
- 图标（`icon`）画在文字前，12px，与文字间距 4px；`spin` 时匀速旋转，系统设了减少动画时不转；`muted` 时取 `--text-muted`，条目是警告或出错时以状态色为准。文字为空时只画图标。
- 悬停内容（`hover`）：按钮可用时用 nb-ui 的 `Tooltip` 在条目上方显示（右侧条目右对齐、左侧条目左对齐），里面是 `WorkbenchItemHover`，取代 `tooltip` 的文字；按钮禁用时照旧以原因作提示。收进“更多”的条目不显示悬停内容。
- 放不下时：按 `layoutStrip`（[`items/item-strip.ts`](../items/item-strip.ts)）先为“更多”留位、再按优先级放，相邻两项之间的间距按实际摆出来的项数算（“更多”也算一项）；收起的条目进“更多”下拉菜单（最宽 320px，长文字换行显示全文），有命令的可点，纯文字是禁用的一行（标题与文字），提示照常。
- 宽度用一份不可见的测量层量：与显示同一种元素（有命令的是 `Button`、没有的是文字）、同一组类与图标，收起的条目也量；文字、图标、语言、条目集合或容器宽度变化后重算；测量层不进读屏与 Tab 顺序。

## 交互

- 读屏名称：有命令的条目文字就是名字或文字为空时只读名字，否则读“名字：文字”；没有命令的条目同样，文字为空时只读名字。有悬停内容的条目没有原生提示，`tooltip` 的文字作它的可访问描述（`aria-description`）。
- “更多”里一项的文字：有命令的同读屏名称；没有命令的是名字与文字连成的一句，文字为空时只写名字。

## 数据

```ts
// ShownItem 里与渲染有关的字段：title、text、tooltip、state、command，
// icon: {name, spin, muted} | null，hover: HoverSource | null（加载与诊断归注册表，见 WorkbenchItemHover）。
type StripEntry = ShownItem & {
    /** 有命令且命令此刻不可用时的原因；按钮禁用并以它作提示。 */
    disabledReason: string | null;
};
type Props = {
    entries: StripEntry[];
    /** 条目按钮的高度（px）。 */
    itemHeight: number;
    /** 条目靠哪一侧排：start 从左往右，end 贴右。 */
    align: "start" | "end";
};
type Emits = {
    /** 点了有命令的条目（摆出来的或“更多”里的）。 */
    run: [itemId: string];
};
```

## 状态

- 没有条目时什么都不画（不占宽度）。
- 全部收起时只剩“更多”按钮。

## 隐藏通道理由

- `state:inject`：经 `useText()` 取宿主注入的翻译端口，“更多”按钮的名称、条目名与文字连成的一句（读屏名称与“更多”里纯文字的一行，中间的标点随语言）在本插件的目录（命名空间 `nbook.workbench`，`../../locales/`）；语言随端口响应式切换，切换后重量条目宽度，组件没有语言属性。没有宿主注入时得到 nb-ui 的缺省端口，那里没有本插件的目录，只显示键名，所以测试与 Lab 场景要注入登记了本插件目录的宿主引擎端口。
