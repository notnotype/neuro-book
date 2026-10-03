---
标签: [state:local]
别名: ["标题操作", "Title Actions"]
---

# WorkbenchTitleActions

标题条右侧的**动作组零件**：几个直接成按钮的动作 + 一个「更多」下拉菜单。

它是**纯受控**零件：不认识命令、不执行命令、不读 store。每一项只带渲染需要的事实，点击回传 `id`——对应哪个命令由宿主决定。因此活动 View 的动作（`useWorkbenchViewActions`）与框架动作（`workbench-shell-commands.ts` 的 Panel 菜单）可以共用同一个部件，而不把「谁执行」塞进标题条。

## 数据

```ts
type Props = {
    /** 直接渲染成按钮的项；放不下的自动折进「更多」。 */
    primary?: readonly WorkbenchTitleActionItem[];
    /** 「更多」菜单里的项（含一层子菜单）。 */
    secondary?: readonly WorkbenchTitleActionItem[];
    /** 上下文指纹：一变就关掉已经打开的菜单（切换活动 View / 实例代际时不让旧菜单继续指向旧状态）。 */
    contextKey?: string;
    /** 无障碍名称（i18n 归宿主）；同时是「更多」按钮标题的前缀。 */
    label?: string;
    /** 这个实例的用途：框架操作用 `panel`，活动 View 操作用 `view`（数据属性供冒烟定位）。 */
    scope?: "view" | "container" | "panel";
    /** 「更多」触发器的位置：框架操作要求它排在固定按钮之前（更多 → 最大化/还原 → 隐藏）。 */
    moreFirst?: boolean;
};

type WorkbenchTitleActionItem = {
    id: string;            // 点击回传的就是它；不许携带 commandId / run
    label: string;
    icon?: string;
    disabled?: boolean;
    reason?: string;       // 禁用原因：按钮进 title / aria-label，菜单项接在标签后
    busy?: boolean;
    checked?: boolean;     // 只给 View 自有的切换动作（受控：组件不自己改）
    type?: "item" | "radio" | "checkbox";
    group?: string;        // radio 的同层同组标识
    children?: readonly WorkbenchTitleActionItem[]; // 一层子菜单；父项自己不执行
};
```

- **没有 emit 之外的输出**：`invoke(id)` 一条；没有 slots、没有 expose，`attrs` 透传到根元素。
- **没有内部状态机**：`checked` / `disabled` / `label` 全部由宿主给，组件只画。
- 组件自己只持有三样临时状态（`state:local`）：测量到的宽度、折叠个数、菜单是否打开。

## 溢出折叠

- 判定按**父容器的可用宽度**，不按自身宽度：自身宽度会跟着内容变，用它做判据会自激（折一点 → 变宽 → 再展开 → 抖）。
- 拿不到正数宽度（未挂载、被隐藏、jsdom 里没有布局）时**不折叠**：量不到就不该把按钮藏起来。
- 折掉的项按顺序进「更多」，**「更多」触发器永远保留**——它是那些项唯一的入口。
- 展开时留一个按钮的余量（迟滞），临界宽度不会来回抖。
- 宿主必须给它一个宽度由布局决定的盒子（例如 `flex: 0 1 auto; min-width: 0` 的动作区），否则它拿到的永远是内容宽度。

## 菜单与键盘

「更多」用 nb-ui `Dropdown`，因此键盘与焦点行为全部由 Reka 菜单原语承担，组件不排焦点：

- `Up` / `Down` 在项间移动，`Home` / `End` 到首尾，`Right` 展开子菜单、`Left` 收起；
- `Enter` / `Space` 选中当前项，`Escape` 关闭并把焦点还给触发器，点击外部同样关闭；
- radio / checkbox 用菜单原语渲染勾选态（`DropdownMenuItemIndicator`），互斥由宿主的 `checked` 决定；
- `disabled` 项可聚焦但不可执行（点击不发 `select`）；子菜单父项只展开、自己不执行；
- `contextKey` 变化时组件关闭已经打开的菜单（受控 `open`），旧菜单不会继续指向旧状态。

## 核对点（数据属性）

- 根：`data-title-actions="view|panel"`（这个实例的用途）；
- 每个按钮：`data-title-action="<item.id>"`；更多触发器：`data-title-action="more"`；
- 禁用项**仍然渲染**：`disabled` + `aria-disabled="true"`，`title` / `aria-label` 为「标签（原因）」；
- 菜单项渲染在原语浮层里（跟在 `document.body` 下的 portal），不在组件子树内。

## 不支持

- 不做 i18n（`label` 与每一项的 `label` 都由宿主解析）；
- 不执行命令、不查可用性：`disabled` 与 `reason` 是已经求值好的结果；
- 不做按钮排序 / 隐藏的用户配置（本轮明确不做工具栏自定义）；
- 不认业务语义：`primary` / `secondary` 只是「直接渲染」与「进更多」。
