---
标签: [state:local, state:inject, env:portal, env:global, env:timer]
---

# Dropdown

`Dropdown` 把一个触发器和可滚动的非模态菜单组合起来，支持普通项、分隔线、受控 radio/checkbox、任意层级级联子菜单和自定义菜单项。它把选中结果交给宿主，不替宿主修改 `checked` 或执行业务动作；与只负责打开单层菜单的原语相比，它额外提供统一浮层材质、碰撞避让、长列表滚动条和级联面板。

## 布局

组件由触发器、主菜单浮层和零个或多个级联子菜单组成。默认菜单项高为 `--control-h-sm`（约 32px），`compact` 使用紧凑密度（约 24px 高）；主菜单默认宽度至少 200px，紧凑模式至少 160px，调用方可以用 `menuClass` 改写。菜单内容在内部滚动视口中，长列表显示悬浮胶囊滚动条；视口高度默认按密度计算，普通/紧凑模式分别完整显示约 6/5 项并露出下一项的一部分，传 `menuMaxHeight` 可改为显式上限。

浮层通过 `DropdownMenuPortal` 脱离触发器所在 stacking context。`side`、`align`、`sideOffset` 控制锚点关系，默认在底部、起点对齐并留 7px 间距；碰撞时由上游定位原语按 8px 边界向视口内调整。级联菜单与父项保留 6px 间隙并在空间不足时翻到另一侧。

组件本身不换行菜单项，条目文字超出时截断；在 `390×844` 窄屏中浮层会按定位原语的碰撞规则收进视口，但触发器的宽度和菜单项的内容宽度仍由父级提供。父级应给触发器合理的可用宽度。

## 交互

- 默认插槽内容是触发器；点击或由上游菜单原语支持的键盘操作打开/关闭菜单。组件不锁定页面指针事件（`modal` 为 `false`）。
- 点击普通叶子项发出 `select`，传该项的 `value`；禁用项不发出，带 `children` 的父项只展开子菜单，不选择自己。
- `type: "radio"` 或 `"checkbox"` 的项分别使用对应 menuitem 语义并显示 `checked`；组件只读 `checked`，选择后仍由宿主更新输入数据，不在内部切换。
- 指针悬停首次展开子菜单等待 300ms；点击、键盘 ArrowRight 或已有同级面板切换立即展开。离开/关闭会清理级联状态。
- 菜单关闭时 `update:open` 报告 `false`，上游负责把焦点归还触发器；打开后的方向键、Escape、Home/End 等菜单漫游行为由 Reka UI 负责。组件声明的 `focus` 事件当前实现没有发出路径，见「已知偏差」。
- 菜单内容溢出时可滚动；拖动右侧悬浮滑块滚动，拖动手势结束或组件销毁时解除窗口监听。

## 数据

```ts
import type {DropdownItem, DropdownItemType} from "./dropdown.types";

type DropdownProps = {
    /** 顶层及级联菜单项；必填；数组顺序决定显示顺序 */
    items: DropdownItem[];
    /** 主菜单补充 class；默认 undefined */
    menuClass?: string;
    /** 菜单视口最大高度；默认 undefined；非空 CSS 字符串直接作为视口 max-height，空字符串按密度计算 */
    menuMaxHeight?: string;
    /** 触发器补充 class；默认 "" */
    rootClass?: string;
    /** 是否使用紧凑项密度；默认 false */
    compact?: boolean;
    /** 浮层相对触发器的横向对齐；默认 "start" */
    align?: "start" | "center" | "end";
    /** 浮层出现在触发器哪一侧；默认 "bottom" */
    side?: "top" | "right" | "bottom" | "left";
    /** 浮层与触发器的间距（px）；默认 7 */
    sideOffset?: number;
    /** 是否禁用触发器；默认 false */
    disabled?: boolean;
    /** 补充浮层 style；默认 undefined；当前实现未应用，见「已知偏差」 */
    popoverStyle?: Record<string, string | number>;
    /** 展开态；传入时受控，不传时由上游原语维护；默认 undefined */
    open?: boolean;
    /** 透传到主菜单浮层根节点的原生属性；默认 {} */
    contentProps?: Record<string, unknown>;
};

type DropdownEmits = {
    /** 叶子项被选择时发出；禁用项和级联父项不发出 */
    (event: "select", value: string): void;
    /** 声明的焦点事件；当前实现没有触发路径，见「已知偏差」 */
    (event: "focus", payload: FocusEvent): void;
    /** 展开态变化时发出；受控和非受控两种用法都会发出 */
    (event: "update:open", value: boolean): void;
};

type DropdownSlots = {
    /** 触发器内容；必需，否则没有可操作的触发器 */
    default?: () => unknown;
    /** 自定义条目主体；slot props 为 { item: DropdownItem } */
    item?: (props: {item: DropdownItem}) => unknown;
    /** 自定义条目右侧内容；slot props 为 { item: DropdownItem }；有 children 或 checked 时相应的箭头/勾选优先显示 */
    "item-right"?: (props: {item: DropdownItem}) => unknown;
};

interface DropdownItem {
    /** 菜单项可见文字；必填，分隔项会忽略 */
    label: string;
    /** 菜单项稳定值；必填，也用作分隔项 key */
    value: string;
    /** 是否以强调样式呈现；默认 undefined/false */
    active?: boolean;
    /** 是否禁用选择；默认 false */
    disabled?: boolean;
    /** 左侧装饰图标 class；默认不显示 */
    iconClass?: string;
    /** 右侧图标 class；默认 undefined；当前未渲染，见「已知偏差」 */
    rightIconClass?: string;
    /** 右侧快捷键提示文字；默认不显示 */
    shortcut?: string;
    /** 原生 title 提示；默认 undefined */
    title?: string;
    /** 视觉语气；默认 "default" */
    tone?: "default" | "danger";
    /** 是否显示分隔线；默认 false */
    separator?: boolean;
    /** 子菜单数据；非空时本项只展开子菜单、不发 select；默认 undefined */
    children?: readonly DropdownItem[];
    /** 菜单语义；默认省略时按普通 item 处理 */
    type?: DropdownItemType;
    /** radio/checkbox 是否勾选，由父级受控；默认 false */
    checked?: boolean;
    /** radio 的分组标识；默认 undefined；仅供缺失值诊断，不执行分组 */
    group?: string;
}

type DropdownItemType = "item" | "radio" | "checkbox";
```

省略 `open` 时由上游维护展开状态；传入时由父组件回写 `update:open` 才能改变显示，两种模式都上报更新。`menuMaxHeight` 非空时直接作为 CSS 最大高度；省略或空字符串时按密度计算。radio `group` 缺失会输出开发诊断，但当前菜单节点不执行分组或互斥，勾选仍完全由 `checked` 控制。

组件没有 `expose` API。未声明的 attribute、`class` 与 `style` 按 Vue 默认规则落到根菜单原语；Portal 中的菜单属性使用 `contentProps` 指定，不应依赖根节点透传。没有业务请求、store 或持久化能力。

## 状态

- 默认：触发器可用、菜单关闭；打开时按 `items` 渲染，`active` 项使用强调样式。
- 禁用：`disabled` 禁用触发器；条目的 `disabled` 阻止选择并降低不透明度，级联仍由其它可用项控制。
- 受控展开：`open=false` 时内容不渲染，但会发出打开请求；`open=true` 时按输入显示菜单。
- 空数据：`items=[]` 时仍可打开空菜单，不会产生选择事件。
- 只读、加载、错误：组件无统一状态；父级用禁用项或外部内容表达业务状态。

## 不支持

- 不支持替宿主切换 radio/checkbox 的 `checked`，也不执行 `value` 对应的业务命令。
- 不支持内置搜索、分页、异步加载或多选结果汇总；长列表只有滚动能力。
- 不支持自定义 Portal 目标；目标位置及目标不可用时的具体表现由 Reka `DropdownMenuPortal` 决定，本地源码未核实。

## 上游边界

Reka UI 负责菜单角色、键盘漫游、Escape/outside dismiss、焦点归还、受控展开生命周期、Portal 与 Popper 碰撞定位。本组件承诺菜单项映射、选择事件、级联面板、滚动视口和浮层样式；未由本组件明确约束的上游行为不属于稳定合同。

## 隐藏通道理由

- `state:inject`：从 `NB_POPOVER_Z_INDEX` 读取所属 `DialogWindow` 的浮层层级，避免菜单被窗口表面遮挡；没有提供方时回退到普通 popover 层级。
- `env:portal`：菜单必须脱离触发器祖先的局部 stacking context 才能覆盖页面内容；渲染位置由 Reka Portal 决定，组件不提供目标配置。目标位置及不可用表现本地源码未核实。
- `env:timer`：首次悬停级联菜单使用 300ms 延迟以减少误展开；关闭或切换时取消待执行任务。
- `env:global`：滚动条拖动期间在 `window` 监听 `mousemove` / `mouseup`，以支持指针离开滑块后的连续拖动；手势结束或卸载时解除监听。

## 已知偏差

- `focus` 事件在 `defineEmits` 中声明，但组件没有调用 `emit("focus", ...)` 的路径；使用方不能依赖它报告焦点。
- `DropdownItem.rightIconClass` 有类型定义但 `MenuNodes` 未渲染；右侧自定义内容使用 `item-right` slot。
- `popoverStyle` 被传入浮层 composable，但模板未绑定其返回的浮层样式；该 prop 当前不改变显示样式，可通过 `contentProps` 传原生浮层属性。
