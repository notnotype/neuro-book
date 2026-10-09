---
标签: []
别名: ["资源管理器的行", "Explorer Row"]
---

# ExplorerRow

资源管理器树里的一行（[`workbench/files-explorer.md`](../../../../../../../docs/specs/workbench/files-explorer.md)）：根、资源或状态（加载中、读取失败、空目录、清单错误）。资源行按文件夹类型呈现：内容文件夹里显示展示名，真实名字不同时作副标题；节点行的展开箭头与打开区分开；缺失、未列入、无正文、需要剧情插件以短标记标出。行本身不处理键盘，键盘焦点在树上，焦点行以 `active` 画焦点框（`aria-activedescendant` 模式）。

## 布局

单行，高度由 `height` 给定（与虚拟列表的行高同一个值）：缩进、展开箭头（16px，没有子项时占位）、图标、标签（可收缩、截断）、副标题（更弱、先截断）、标记（不收缩）。完整路径经 `title` 提示与 `aria-description` 取得。`390×844` 下标签先截断，标记保持可见。

## 数据

```ts
type Props = {
    /** 行数据：`web/tree/rows.ts` 的投影结果。 */
    row: Row;
    locale: DisplayLocale;
    /** DOM id：树用它作 `aria-activedescendant` 的目标。 */
    domId: string;
    selected: boolean;
    /** 键盘焦点所在且树拥有焦点：画焦点框。 */
    active: boolean;
    /** 行高（px）。 */
    height: number;
};

type Emits = {
    /** 按下行：`part` 是展开箭头或行本身；修饰键由事件带出。 */
    (event: "press", mouse: MouseEvent, part: "twisty" | "row"): void;
    /** 双击：以常驻方式打开。 */
    (event: "activate"): void;
    (event: "context", mouse: MouseEvent): void;
    /** 读取失败的状态行点了“重试”。 */
    (event: "retry"): void;
};
```

- 资源行与根行是 `role="treeitem"`，带 `aria-level`、`aria-setsize`、`aria-posinset`、`aria-selected`，可展开的带 `aria-expanded`；状态行是 `role="none"`，只有说明文字，不进选择。
- 没有 slots、expose；attrs 落在根元素上。

## 不支持

不处理键盘与焦点（归树）；不画剪切标记与拖动反馈（随后续切片）；不显示清单里的自定义图标。
