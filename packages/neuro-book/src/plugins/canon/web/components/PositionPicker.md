---
标签: [state:inject, env:portal]
别名: ["时间点", "位置选择", "Position Picker"]
---

# PositionPicker

条目页看哪个时间点（[`canon/author-ui.md`](../../../../../../../docs/specs/canon/author-ui.md) 输出 7、8）：一个按钮写当前位置（“第 3 章末尾”），点开是下拉菜单，各位置是单选项，作品里有计划中的情节时最下面另有“算上计划中的情节”的勾选项。按钮左边一格写这一页此刻的标记。受控：选了什么发出什么，位置与开关的状态由宿主给。宿主在空作品（只有一个位置、也没有计划）里不放它。

## 布局与交互

- 从左到右：标记、触发按钮（时钟图标、当前位置、下拉箭头）。标记只占左边，出没时按钮与它右边的东西不动（容器靠右对齐时只往左长），淡入淡出（`--motion-fast`）。
- 标记一格同时只写一样，依次是：算上计划时一个能点的“算上计划 ×”（点了发 `update:planned` 为 false，悬停提示“不算计划”），选过的那一章不在了时“原来选的那一章已经不在了”（`role="status"`），所选位置上还没出场时“这时还没出场”（位置就写在旁边的按钮上，不重复）。标记与按钮都能收窄：放不下时标记先截断、整句在悬停提示里，按钮里的位置随后截断，不撑出横向滚动。
- 选一个位置发 `update:position`；点勾选项发 `update:planned`（取反）。菜单的键盘、焦点与关闭来自 `DropdownMenu`。
- `locked` 非空时按钮与标记都不可用，悬停提示是它。

## 数据

```ts
type PositionPickerProps = {
    /** 能选的位置：最初与各章的开头、末尾；必填。 */
    positions: readonly SelectOption[];
    /** 当前位置的值；必填、受控。 */
    position: string;
    /** 算上计划中的情节；缺省 false、受控。 */
    planned?: boolean;
    /** 作品里有计划中的情节：才出勾选项；缺省 false。 */
    canPlan?: boolean;
    /** 不能换的原因；缺省空串（能换）。 */
    locked?: string;
    /** 所选位置上还没出场；缺省 false。 */
    notAppeared?: boolean;
    /** 选过的那一章被删掉了；缺省 false。 */
    positionGone?: boolean;
};
type PositionPickerEmits = {
    (event: "update:position", value: string): void;
    (event: "update:planned", value: boolean): void;
};
```

没有插槽与 expose；attrs 落在根元素上。

## 隐藏通道理由

`state:inject`：经 `useCanonText()` 取宿主注入的翻译端口。`env:portal`：菜单经 `DropdownMenu` 传送到 `body`（nb-ui 的弹出层落点），宿主没有浮层落点时照 nb-ui 的缺省。
