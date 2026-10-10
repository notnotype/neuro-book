---
标签: [env:portal]
别名: ["条目条", "Item Strip"]
---

# WorkbenchItemStrip

状态栏与标题栏里一侧的条目（[`ui/workbench-shell.md`](../../../../../../../docs/specs/ui/workbench-shell.md) 外壳四输出 33、34）：把贡献方给出的条目排成一行，放不下时按优先级收进“更多”。条目来自 `ItemRegistry.shown()`，组件只渲染、只发事件，不执行命令、不读领域状态。

## 布局

- 一行，条目之间间距 4px；高度与字号随宿主（状态栏 20px、标题栏 28px，由 `itemHeight` 给出）。
- 有命令的条目是 ghost 按钮，没有命令的是纯文字（`role="status"`）。单个条目最宽 320px，超出时省略，提示里有全文。
- `state` 为 `warning`、`error` 时文字取 `--status-warning`、`--status-danger`。
- 放不下时：按 `layoutStrip`（[`items/item-strip.ts`](../items/item-strip.ts)）先为“更多”留位、再按优先级放；收起的条目进“更多”下拉菜单，有命令的可点，纯文字是禁用的一行（标题与文字），提示照常。
- 宽度用一份不可见的测量层量：收起的条目也量，文字、语言、条目集合或容器宽度变化后重算；测量层不进读屏与 Tab 顺序。

## 数据

```ts
type StripEntry = ShownItem & {
    /** 有命令且命令此刻不可用时的原因；按钮禁用并以它作提示。 */
    disabledReason: string | null;
};
type Props = {
    locale: DisplayLocale;
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
