---
标签: [state:local, state:inject, env:portal, env:timer]
---

# Menubar

`Menubar` 把一组顶层菜单组织成应用式水平菜单栏，支持分隔线、快捷键提示、复选/单选项和任意层级级联子菜单。它负责菜单的展示、键盘交互与动作上报，不执行菜单项代表的业务操作；与 `Dropdown` 不同，它由多个并列的顶层菜单触发器组成。

## 布局

`variant="floating"`（默认）时菜单栏是一条自带面板底色、边框、模糊与内边距的紧凑水平带；`variant="flat"` 不画这些，用在标题栏这类已经有面的位置。`sm` 高 30px，`md` 高 36px；菜单触发器依次排列，宽度随标签伸缩。激活触发器时菜单内容通过 Portal 渲染，子菜单再按级联层级定位。内容不折行或自带滚动容器；在 `390×844` 下菜单栏过宽时由父级处理可用宽度，菜单浮层自身遵循上游 Popper 的视口碰撞定位。

若菜单栏位于 `DialogWindow` 内，菜单浮层层级会跟随窗口上下文；其它位置使用普通 popover 层级。

## 交互

- 点击顶层标签打开对应菜单；再次切换菜单或关闭时清除级联子菜单状态。一个菜单关闭后还在退场动画里时打开另一组，那一组照常打开：退场中的菜单不再因外部点击或焦点移出关闭菜单栏，按在组标签上也不算“点在外面”。
- 选择普通叶子项后发出 `select` 并携带完整菜单项对象；级联父项仅展开子菜单，不作为选择结果。
- `modelValue` 是当前打开的顶层菜单的 `id`，没有打开时为空串；顶层菜单开合时发出 `update:modelValue`。不传 `modelValue` 时开合由组件自管。
- 禁用菜单、禁用条目和分隔线不执行选择。勾选项的 `checked` 由父组件传入，组件展示勾选态但不自行切换。
- 首次指针悬停展开子菜单等待 300ms；点击、键盘 ArrowRight 或已有同级子菜单切换立即展开。一级菜单的键盘见「上游边界」。
- 菜单项具有子项时，右侧显示展开指示；普通项可显示 `shortcut` 文本，危险项使用危险色。

## 数据

```ts
export interface MenubarItemData {
    /** 菜单项文字；必填，分隔项忽略 */
    label: string;
    /** 选择事件携带的值；必填 */
    value: string;
    /** 右侧快捷键提示；默认不显示 */
    shortcut?: string;
    /** 左侧装饰图标 class；默认不显示 */
    iconClass?: string;
    /** 禁用该项；默认 false */
    disabled?: boolean;
    /** 原生提示与读屏描述，例如禁用原因；默认不显示 */
    title?: string;
    /** 视觉语气；默认 "default" */
    tone?: "default" | "danger";
    /** 是否渲染分隔线；默认 false */
    separator?: boolean;
    /** radio/checkbox 勾选显示态，由父组件提供；默认 false */
    checked?: boolean;
    /** 菜单项语义；默认 "default" */
    type?: "default" | "checkbox" | "radio";
    /** 子菜单；存在且非空时本项展开子菜单而不发选择事件；默认 undefined */
    children?: MenubarItemData[];
}

export interface MenubarMenuData {
    /** 菜单稳定标识；必填 */
    id: string;
    /** 顶层触发器文字；必填 */
    label: string;
    /** 禁用该顶层菜单；默认 false */
    disabled?: boolean;
    /** 此菜单的条目；必填，可为空数组 */
    items: MenubarItemData[];
}

type MenubarProps = {
    /** 顶层菜单数组；默认空数组 */
    menus?: MenubarMenuData[];
    /** 菜单栏密度；默认 "md" */
    size?: "sm" | "md";
    /** 当前打开的顶层菜单 id，空串为都没打开；默认 undefined（开合由组件自管） */
    modelValue?: string;
    /** floating：自带外框与模糊的独立菜单条；flat：嵌进标题栏这类已有面的位置，不画外框与模糊；默认 "floating" */
    variant?: "floating" | "flat";
};

type MenubarEmits = {
    /** 选择启用的叶子菜单项时发出完整项对象 */
    (event: "select", item: MenubarItemData): void;
    /** 顶层菜单打开或关闭时发出当前打开的菜单 id，都关闭时为空串 */
    (event: "update:modelValue", value: string): void;
};

type MenubarSlots = {};
```

组件没有 slot 或 `expose` API。根节点是 Reka 的 `MenubarRoot`；未声明的 attribute、`class` 与 `style` 按 Vue 默认规则传给该根组件，实际 DOM 落点由 Reka 决定。菜单项的 `title`（例如禁用原因）渲染为原生提示与 `aria-description`，禁用项同样带上。

## 状态

- 默认：`menus` 为空数组时只显示空菜单栏外壳；顶层菜单禁用时触发器不可操作。
- 禁用：菜单及菜单项的 `disabled` 分别禁用对应入口；禁用叶子项不会发出 `select`，键盘漫游跳过它，悬停仍显示它的 `title`。
- radio/checkbox：`checked` 是外部输入状态；组件不维护或回写勾选态。
- 只读、加载、错误、空数据：组件没有统一只读、加载或错误态；空数组正常呈现空栏。

## 不支持

- 不支持菜单项请求、命令执行、业务状态变更或异步加载；宿主接收事件后处理。
- 不支持自定义 Portal 目标，也不提供菜单项 slot。
- 不支持独立控制每个子菜单的展开状态。

## 上游边界

Reka UI 负责 Menubar 角色、开合生命周期、Portal 与焦点管理，以及一级菜单里的键盘：组标题之间左右键切换；一级菜单的条目是 Reka 的菜单项，上下键、Home、End、首字母跳转、跳过禁用项、Enter 与空格选择、Escape 关闭并把焦点还给最初打开菜单的组标题（用左右键换过组也一样）都由它负责（真实 Chrome 验收见新应用的 `e2e/lab-nb-ui.e2e.ts`）。级联面板是本组件手工维护的，不在 Reka 的菜单内容里：只支持 ArrowRight 从父项展开，面板里没有上下键漫游与 ArrowLeft 返回。未由本组件明确约束的上游行为及升级变化不属于稳定合同。

## 隐藏通道理由

- `state:inject`：从 `NB_POPOVER_Z_INDEX` 读取所在 `DialogWindow` 的层级，让菜单浮层保持在所属窗口之上；缺少提供方时回退到普通页面 popover 层级。层级来自宿主窗口，不应由每个菜单调用方自行猜测。
- `env:portal`：菜单内容通过 Reka `MenubarPortal` 渲染到组件树外，以避开菜单栏祖先的局部 stacking context；该包装器未提供目标配置。目标位置和目标不可用时的具体表现由上游原语决定，本地源码未核实。
- `env:timer`：级联子菜单首次悬停等待 300ms，减少指针扫过时的误展开；切换或重置时取消待执行定时器。

## 已知偏差

- 级联面板的键盘有限（见「上游边界」）；需要完整键盘的菜单不要用级联，改用分隔线分组。
