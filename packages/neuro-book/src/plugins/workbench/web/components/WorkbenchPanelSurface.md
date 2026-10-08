---
标签: []
别名: ["面板", "面板外观", "Panel"]
---

# WorkbenchPanelSurface

工作台面板的外观：32px 标题头（标题与框架按钮）加一块内容区。框架按钮是面板位置、对齐、收起、最大化、隐藏这几件外壳自己的事（[`ui/workbench-shell.md`](../../../../../../../docs/specs/ui/workbench-shell.md) 外壳一输出 11）；按钮由宿主给出，点了只发 `action`，宿主去执行对应的命令，所以组件不知道命令系统，可用与否也由宿主按命令的可用性算好传进来。

外壳二之前面板里没有视图：内容区由宿主放空状态说明。

## 布局

标题头固定 32px：左边标题（可编程聚焦的落点 `data-shell-focus-target="panel-title"`，外壳在最大化时把焦点交给它），右边框架按钮横排、不换行，放不下时标题先截断。`collapsed` 为 true 时只剩标题头（外壳把面板叶压到 32px）。内容区占满剩余高度，滚动由内容自己管。面与分隔线消费主题 token（`--panel-surface`、`--divider`），没有自己的圆角与阴影：面板叶贴着编辑器，边界由外壳的 1px 边界画。

## 数据

```ts
type PanelFrameAction = {
    /** 宿主的动作 id（产品里是命令 id），`action` 事件原样带回。 */
    id: string;
    /** 可访问名称与悬停提示，已按当前语言取好。 */
    label: string;
    /** nb-ui 图标 class。 */
    icon: string;
    /** 不可用时为 true：按钮禁用。 */
    disabled: boolean;
    /** 不可用的原因（已按当前语言取好），不可用时作为悬停提示；可访问名称仍是 `label`。可用时不给。 */
    reason?: string;
    /** 切换类按钮当前是否处于开启（收起、最大化），给 `aria-pressed`；不是切换类时不给。 */
    pressed?: boolean;
};

type Props = {
    /** 标题与区域的可访问名称。 */
    title: string;
    /** 面板此刻呈现为 32px 标题头；默认 false。 */
    collapsed?: boolean;
    /** 框架按钮，按给定顺序排；默认无。 */
    actions?: ReadonlyArray<PanelFrameAction>;
};

type Emits = {
    /** 点了一个可用的框架按钮。 */
    (event: "action", id: string): void;
};

type Slots = {
    /** 内容区；收起时不渲染（保留在 DOM 里但隐藏，不卸载）。 */
    default?(): unknown;
};
```

没有 expose；attrs 落在根 `<section>` 上。

## 不支持

不画标签条（外壳二随容器加入），不处理拖动与尺寸，不读写任何状态。
