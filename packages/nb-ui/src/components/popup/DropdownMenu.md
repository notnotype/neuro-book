---
标签: [state:local, state:inject, env:portal, env:timer]
---

# DropdownMenu

`DropdownMenu` 把一个触发器和可滚动的非模态菜单组合起来，支持普通项、分隔线、受控 radio/checkbox、任意层级级联子菜单和自定义菜单项。它把选中结果交给宿主，不替宿主修改 `checked` 或执行业务动作；与只负责打开单层菜单的原语相比，它额外提供统一浮层材质、碰撞避让、长列表滚动条和级联面板。

## 布局

组件由触发器、主菜单浮层和零个或多个级联子菜单组成。条目是弹出列表共用的一行（`.nb-ui-menu-item`）：高 `--menu-item-h`、字 `--menu-item-font`（缺省取 `--text-sm`），圆角由外框圆角减内边距推出；勾与图标共用左侧一列：`checked` 的项画勾（替代它的图标），其它项画 `iconClass`，同一级有 radio/checkbox 或有一项带图标时每行都留出这一列，名称左边对齐；勾选项与带图标的项通常不放在同一级。快捷键照常显示在右侧。主菜单默认宽度至少 160px，调用方可以用 `menuClass` 改写。菜单内容在内部滚动视口中：项超过 8 个时视口截在第 9 项的中间、露出半项提示还能滚（按真实盒子量，分隔线与换行项照实计入），不超过 8 个时取自然高度；外框按可用空间夹紧，空间不够时视口跟着收矮。可滚动时显示悬浮胶囊滑块，视口右侧给它让出 6px。级联子菜单每一级同样截断与滚动。

浮层通过 `DropdownMenuPortal` 脱离触发器所在 stacking context。`side`、`align`、`sideOffset` 控制锚点关系，默认在底部、起点对齐并留 7px 间距；碰撞时由上游定位原语按 8px 边界向视口内调整。级联菜单与父项保留 6px 间隙并在空间不足时翻到另一侧。

组件本身不换行菜单项，条目文字超出时截断；在 `390×844` 窄屏中浮层会按定位原语的碰撞规则收进视口，但触发器的宽度和菜单项的内容宽度仍由父级提供。父级应给触发器合理的可用宽度。

## 交互

- 默认插槽内容是触发器；点击或由上游菜单原语支持的键盘操作打开/关闭菜单。组件不锁定页面指针事件（`modal` 为 `false`）。
- 点击普通叶子项发出 `select`，传该项的 `value`；禁用项不发出，带 `children` 的父项只展开子菜单，不选择自己。
- `type: "radio"` 或 `"checkbox"` 的项分别使用对应 menuitem 语义并显示 `checked`；组件只读 `checked`，选择后仍由宿主更新输入数据，不在内部切换。
- 指针悬停首次展开子菜单等待 300ms；点击、键盘 ArrowRight（以及父项上的 Enter、空格）或已有同级面板切换立即展开。离开/关闭会清理级联状态。
- 级联面板的键盘：键盘展开时焦点进新一级的第一项；上下键、Home、End 在本级可用项之间移动（跳过分隔线与禁用项）；ArrowRight、Enter、空格在父项上展开下一级；ArrowLeft 收起本级、焦点回到展开它的那一项；Escape 关掉整个菜单、焦点还给触发器。
- 级联面板在上游菜单内容之外：面板里的指针按下与焦点不算“点了外部”，菜单不关；在面板里选中一项后整个菜单收起（非受控时由组件自己关，受控时经 `update:open` 报 `false`）。
- 菜单关闭时 `update:open` 报告 `false`，上游负责把焦点归还触发器；打开后的方向键、Escape、Home/End 等菜单漫游行为由 Reka UI 负责。组件声明的 `focus` 事件当前实现没有发出路径，见「已知偏差」。
- 菜单内容溢出时可滚动；拖动右侧悬浮滑块滚动（指针捕获在滑块上，按下不夺焦点、不关菜单）。键盘移到看不见的项时：级联子菜单只滚动这一级的视口、滚最少的距离并让开渐隐；主菜单的项由 reka 聚焦，浏览器按聚焦的规则把它滚进视口（可能滚到中间）。
- 某一级滚动时（滚轮或拖滑块），它展开的更深层级收起；焦点在被收起的层级里时回到展开它的那一项。

## 数据

```ts
import type {DropdownMenuItemData, DropdownMenuItemType} from "./dropdown-menu.types";

type DropdownMenuProps = {
    /** 顶层及级联菜单项；必填；数组顺序决定显示顺序 */
    items: DropdownMenuItemData[];
    /** 主菜单补充 class；默认 undefined */
    menuClass?: string;
    /** 触发器补充 class；默认 "" */
    rootClass?: string;
    /** 浮层相对触发器的横向对齐；默认 "start" */
    align?: "start" | "center" | "end";
    /** 浮层出现在触发器哪一侧；默认 "bottom" */
    side?: "top" | "right" | "bottom" | "left";
    /** 浮层与触发器的间距（px）；默认 7 */
    sideOffset?: number;
    /** 是否禁用触发器；默认 false */
    disabled?: boolean;
    /** 补充浮层 style，与组件给的层级（`zIndex`）合并到主菜单浮层上；默认 undefined */
    popoverStyle?: Record<string, string | number>;
    /** 展开态；传入时受控，不传时由上游原语维护；默认 undefined */
    open?: boolean;
    /** 透传到主菜单浮层根节点的原生属性；默认 {} */
    contentProps?: Record<string, unknown>;
    /** 条目文字允许换行：菜单最宽 320px，长文字完整显示（例如状态栏收进“更多”的条目）；默认 false，单行截断 */
    wrap?: boolean;
};

type DropdownMenuEmits = {
    /** 叶子项被选择时发出；禁用项和级联父项不发出 */
    (event: "select", value: string): void;
    /** 声明的焦点事件；当前实现没有触发路径，见「已知偏差」 */
    (event: "focus", payload: FocusEvent): void;
    /** 展开态变化时发出；受控和非受控两种用法都会发出 */
    (event: "update:open", value: boolean): void;
};

type DropdownMenuSlots = {
    /** 触发器内容；必需，否则没有可操作的触发器 */
    default?: () => unknown;
    /** 自定义条目主体；slot props 为 { item: DropdownMenuItemData } */
    item?: (props: {item: DropdownMenuItemData}) => unknown;
    /** 自定义条目右侧内容；slot props 为 { item: DropdownMenuItemData }；有 children 时显示箭头，不渲染这个插槽 */
    "item-right"?: (props: {item: DropdownMenuItemData}) => unknown;
};

interface DropdownMenuItemData {
    /** 菜单项可见文字；必填，分隔项会忽略 */
    label: string;
    /** 菜单项稳定值；必填，也用作分隔项 key */
    value: string;
    /** 是否禁用选择；默认 false */
    disabled?: boolean;
    /** 左侧装饰图标 class；默认不显示 */
    iconClass?: string;
    /** 右侧图标 class；默认 undefined；当前未渲染，见「已知偏差」 */
    rightIconClass?: string;
    /** 快捷键提示文字：靠右对齐、正文字体的小一号弱化色；默认不显示 */
    shortcut?: string;
    /** 原生提示与读屏描述（`aria-description`），例如禁用原因；禁用项同样带上；默认 undefined */
    title?: string;
    /** 视觉语气；"danger" 只换文字与图标的颜色，高亮底色与其它项相同；默认 "default" */
    tone?: "neutral" | "danger";
    /** 是否显示分隔线；默认 false */
    separator?: boolean;
    /** 子菜单数据；非空时本项只展开子菜单、不发 select；默认 undefined */
    children?: readonly DropdownMenuItemData[];
    /** 菜单语义；默认省略时按普通 item 处理 */
    type?: DropdownMenuItemType;
    /** radio/checkbox 是否勾选，由父级受控；默认 false */
    checked?: boolean;
    /** radio 的分组标识；默认 undefined；仅供缺失值诊断，不执行分组 */
    group?: string;
}

type DropdownMenuItemType = "item" | "radio" | "checkbox";
```

省略 `open` 时由上游维护展开状态；传入时由父组件回写 `update:open` 才能改变显示，两种模式都上报更新。radio `group` 缺失会输出开发诊断，但当前菜单节点不执行分组或互斥，勾选仍完全由 `checked` 控制。

组件没有 `expose` API。未声明的 attribute、`class` 与 `style` 按 Vue 默认规则落到根菜单原语；Portal 中的菜单属性使用 `contentProps` 指定，不应依赖根节点透传。没有业务请求、store 或持久化能力。

## 状态

- 默认：触发器可用、菜单关闭；打开时按 `items` 渲染。
- 高亮：悬停项与键盘当前项是同一项，底色为中性叠色 `--overlay-item-active`；展开了子菜单的父项保持高亮。
- 禁用：`disabled` 禁用触发器；条目的 `disabled` 阻止选择并降低不透明度，级联仍由其它可用项控制。
- 受控展开：`open=false` 时内容不渲染，但会发出打开请求；`open=true` 时按输入显示菜单。
- 空数据：`items=[]` 时仍可打开空菜单，不会产生选择事件。
- 只读、加载、错误：组件无统一状态；父级用禁用项或外部内容表达业务状态。

## 不支持

- 不支持替宿主切换 radio/checkbox 的 `checked`，也不执行 `value` 对应的业务命令。
- 不支持内置搜索、分页、异步加载或多选结果汇总；长列表只有滚动能力。
- 不支持自定义 Portal 目标；目标位置及目标不可用时的具体表现由 Reka `DropdownMenuPortal` 决定，本地源码未核实。

## 上游边界

Reka UI 负责菜单角色、Escape/outside dismiss、焦点归还、受控展开生命周期、Portal 与 Popper 碰撞定位，以及一级菜单的键盘：一级菜单的条目是 Reka 的菜单项，上下键、Home、End、首字母跳转、跳过禁用项、Enter 与空格选择都由它负责（真实 Chrome 验收见新应用的 `e2e/lab-nb-ui.e2e.ts`）。级联面板是本组件手工维护的（接不到上游的菜单上下文）：面板里的键盘漫游、展开与收起由本组件经 `useMenuCascade` 处理（三个菜单入口共用一份），见“交互”。本组件承诺菜单项映射、选择事件、级联面板、滚动视口和浮层样式；未由本组件明确约束的上游行为不属于稳定合同。

## 隐藏通道理由

- `state:inject`：从 `NB_POPOVER_Z_INDEX` 读取所属 `Dialog` 的浮层层级，避免菜单被窗口表面遮挡；没有提供方时回退到普通 popover 层级。
- `env:portal`：菜单必须脱离触发器祖先的局部 stacking context 才能覆盖页面内容；渲染位置由 Reka Portal 决定，组件不提供目标配置。目标位置及不可用表现本地源码未核实。
- `env:timer`：首次悬停级联菜单使用 300ms 延迟以减少误展开；关闭或切换时取消待执行任务。

## 已知偏差

- `focus` 事件在 `defineEmits` 中声明，但组件没有调用 `emit("focus", ...)` 的路径；使用方不能依赖它报告焦点。
- `DropdownMenuItemData.rightIconClass` 有类型定义但 `MenuNodes` 未渲染；右侧自定义内容使用 `item-right` slot。
