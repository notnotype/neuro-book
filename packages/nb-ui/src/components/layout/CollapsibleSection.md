---
标签: []
---

# CollapsibleSection

`CollapsibleSection` 是带标题触发器的受控折叠区段：标题行由图标、标题、可选 meta 内容和展开箭头组成，正文可折叠。它适合表达设置分组等有名称的区段；只需要自定义触发器时使用 `Collapsible`。

## 布局与交互

标题行是一个宽度铺满、最小高度 32px 的原生 button。标题过长时截断；`iconClass` 为空时不渲染图标，meta 插槽位于标题与箭头之间。展开箭头跟随 `open` 旋转。正文由折叠容器在标题行下方显示，并对高度与透明度做过渡；没有内置滚动或最大高度约束，内容尺寸由调用方布局决定。窄屏保持同一纵向结构。

点击标题按钮切换展开状态并发出 `update:open`；禁用时按钮不可操作。按钮支持原生键盘激活与可见焦点环。折叠组件不接管焦点；关闭区段时焦点去向由浏览器和宿主决定。

## 数据

```ts
type CollapsibleSectionProps = {
    /** 受控展开态；默认 false。点击只发事件，不在本组件内更新。 */
    open?: boolean;
    /** 禁止触发；默认 false。 */
    disabled?: boolean;
    /** 标题前图标的 CSS class；默认空字符串，不渲染图标。 */
    iconClass?: string;
    /** 标题文字；TS 声明为必填，运行时默认空字符串。 */
    label: string;
};

type CollapsibleSectionEmits = {
    /** 用户激活标题按钮后，请求切换到的新展开态。 */
    (event: "update:open", value: boolean): void;
};

type CollapsibleSectionSlots = {
    /** 折叠正文。 */
    default(): unknown;
    /** 标题行中、标题与展开箭头之间的补充内容。 */
    meta(): unknown;
};
```

组件不 expose 方法或状态。未声明 attrs 没有显式转发合同，不应依赖其在内部 Reka 节点上的落点。除 `default` 与 `meta` 外没有插槽。

## 状态与边界

- 默认关闭；`open` 是受控值，父组件须响应 `update:open` 并更新 prop，箭头和正文才会保持同步变化。
- 禁用时标题按钮不可操作，视觉透明度降低。
- 空正文仍保留触发器；组件不解释正文数据，也没有加载、错误或空态。
- 组件不提供非受控默认展开状态、焦点管理或内容滚动策略。

## 上游边界

折叠状态变化、触发器语义与内容显示由 `Collapsible`（Reka UI Collapsible）承载；本组件承诺标题按钮、插槽位置及受控 `open`/事件映射。上游未声明的焦点与动画细节不作为额外合同。
