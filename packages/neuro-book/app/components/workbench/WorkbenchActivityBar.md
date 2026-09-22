---
标签: []
别名: ["活动栏", "Activity Bar"]
---

# WorkbenchActivityBar

工作台左侧的**通用活动栏**：上段主入口、中段次要入口（放不下从尾部进 More）、底部入口贴底。它只认识「图标 + 文案 + 状态」，不认识任何产品概念——点击只发 `invoke(id)`，谁执行、执行什么全归宿主。

它是 `NovelIdeActivityBar`（产品活动栏）的通用底件：产品的图标表、译文表、账户菜单与事件路由都在那一层适配，这里只负责几何、溢出与卡片材质。宽度与间距沿用产品活动栏的既有口径——**每项 40px、步距 44px**；卡片的面 / 描边 / 圆角 / 阴影取 nb-ui 主题角色变量（`--panel-surface` / `--panel-outline` / `--border-w` / `--radius-control` / `--elevation-raised` / `--divider`），四周留白归外壳加在叶上，组件自己不写宽度也不写 margin。

## 数据与接口

```ts
export type ActivityItem = Readonly<{
    id: string;
    label: string;
    icon: string;
    active?: boolean;
    disabled?: boolean;
    /** 禁用原因：进 tooltip 与 aria-label，溢出菜单里作为右侧提示 */
    reason?: string;
    badge?: string | number;
}>;

type Props = {
    primary: readonly ActivityItem[];   // 上段
    secondary: readonly ActivityItem[]; // 中段（溢出进 More）
    footer: readonly ActivityItem[];    // 底部
    label: string;                      // 整条活动栏的无障碍名称
    moreLabel: string;                  // 溢出菜单触发器名称与菜单标题
};

type Emits = {
    (e: "invoke", id: string): void;
};

type Slots = {
    /** 按项替换：插槽名是 `item-<id>`（参数：{item}）。没提供的项走默认渲染。 */
    [key: `item-${string}`]: (props: {item: ActivityItem}) => unknown;
};
```

**单根契约**：单根 `<aside class="workbench-activity-bar">`，带 `aria-label`；attrs 透传落在它上面（fixture 用 `data-lab-subject` 标主体）。没有 expose。

默认渲染是 nb-ui `IconButton`：`aria-label` 用条目标题、`aria-pressed` 用 `active`、禁用走原生 `disabled`，外面套 nb-ui `Tooltip`（`placement="right"`）。`badge` 是贴在图标右下角的角标（不占 40px 盒模型）。

## 布局

- 上段与底部各放在自己的滚动容器里，内层是自然高度的组；`footer` 组带 `margin-top: auto`，所以有空余时它贴底，中段紧接上段。
- 中段是「可见次要入口 + More 触发器」：溢出判定沿用 `app/utils/workbench-chrome.ts` 的 `resolveActivityBarSecondaryItems`，`fixedHeight` = 容器纵向内边距 + 上段自然高度 + 底部自然高度。**只要存在溢出就先给 More 留一个完整按钮位**。
- 组的高度变化经由 `ResizeObserver` 重新分配可见项；可见数取「最近一次实测」的上限，容器变大等实测回来再补，避免来回抖。
- 极短高度时上段与底部组被压扁并各自滚动，中段的 More 始终可达；卡片整体 `overflow: hidden`，不会越过 Part 边界。

## 交互

- 点击未禁用项 → `invoke(id)`；禁用项不执行（按钮原生 `disabled`，组件里再判一次，插槽内容也不会误发）。
- 溢出菜单用 nb-ui `Dropdown`（`side="right"`），键盘合同与原语一致：`ArrowDown/Up` 漫游、`Home/End`、`Enter/Space` 选择、`Escape` 关闭并把焦点还给触发器。
- 溢出菜单里保留 `active` 视觉与禁用态；禁用项的 `reason` 作为菜单项右侧提示显示，不是只藏在 tooltip 里。
- 用 `item-<id>` 插槽替换单项时，那一项的渲染完全交给宿主（产品账户按钮就是用它挂自己的浮层菜单）；其余项不受影响。

## 不支持

- 不 import 账户、Project、`NovelIdeTab` 等产品类型；不读 store、不做持久化、不发请求。
- 不拥有宽度与留白：活动栏逻辑宽（卡片 48 + 两侧留白 6）由外壳的布局定义，这里只吃叶给的内接盒。
- 不提供展开/收起、拖拽排序、换边：入口集合与顺序是宿主的 props 顺序。
- 不做第二套键盘实现：溢出菜单的键盘行为全部来自 Reka 原语。

## 注意事项

- **必须有确定高度**：`h-full` 只有在叶（或画布）给出确定高度后才成立；放进自动高度的容器里，溢出判定会把次要入口全部塞进 More。
- 文案由宿主给：`label` 与每个条目的 `label` / `reason` 都是**已解析**的字符串，组件不做翻译。
- 禁用原因要写全：`reason` 会拼成 `标签 · 原因`，既要读得通也要能被屏幕阅读器读出来。
- Lab 场景见 `app/component-lab/fixtures/WorkbenchActivityBarFixture.vue`：`default` / `overflow` / `disabled` / `short`。
