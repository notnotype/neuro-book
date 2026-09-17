---
标签: []
---

# WorkbenchContainerSection

工作台容器区段部件：承载容器内的一个独立 Section。对应 VS Code 侧栏的多 Section 结构（如文件树、大纲、时间线、引用）。

## 设计原则

- **平铺不套娃**：Section 是容器卡片内的平铺分区，**绝不嵌套卡片圆角与外部阴影**。卡片语言（圆角、投影、外描边）全部由外层 `WorkbenchContainerSurface` 统一拥有。
- **1px 细线节律**：相邻区段之间由容器通过 `var(--border-w) solid var(--divider)`（1px）分隔。
- **高密度紧凑头部**：行高约 22-24px（消费 `--control-h-sm`），字号小（`--text-xs`），折叠指示器紧凑（14px chevron），可选上下文标签（`--text-2xs`）与行内动作区。
- **两档排版合同**：`scroll` 档（内容自带留白与滚动，适合长列表）与 `fill` 档（吸收高度并由视图管理内部滚动）。
- **空态感知**：支持 `empty` 标记与 `emptyText` 文案，当内容为空或显式标记为空时呈现标准轻量空态。

## 接口

```ts
type Props = {
    /** 区段标识 */
    id?: string;
    /** 区段标题 */
    title: string;
    /** 可选上下文标签（如当前文件名或条目统计，居右小字展示） */
    contextLabel?: string;
    /** 是否可折叠；缺省为 true */
    collapsible?: boolean;
    /** 受控折叠态；缺省由内部 state 维护 */
    collapsed?: boolean;
    /** 排版合同：scroll 拥有内部滚动与边距；fill 吸收高度由视图管理滚动 */
    layout?: "scroll" | "fill";
    /** 是否强制标记为空态 */
    empty?: boolean;
    /** 空态说明文案 */
    emptyText?: string;
};

type Emits = {
    (e: "update:collapsed", value: boolean): void;
    (e: "toggle", value: boolean): void;
};

type Slots = {
    /** 默认插槽：区段内容 */
    default(): unknown;
    /** 具名内容插槽：同 default */
    content(): unknown;
    /** 上下文标签自定义插槽 */
    context(): unknown;
    /** 区段右侧动作区（点选不触发折叠） */
    actions(): unknown;
    /** 自定义空态展示 */
    empty(): unknown;
};
```

## 单根契约

单根 `<section class="workbench-container-section">`，属性带 `data-section`、`data-collapsed`、`data-layout`。
折叠由头部内 `<button class="workbench-container-section__toggle">` 触发，支持键盘 Accessible 操作（`aria-expanded`、`aria-controls`）；头部本身是布局容器，`actions` 槽与其同级，点选不触发折叠。`collapsible: false` 时头部不渲染按钮，只留静态标题行。
