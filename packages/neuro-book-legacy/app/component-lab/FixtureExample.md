---
标签: []
---

# FixtureExample

Component Lab 规范指南中的典型受控零件，展示标准设计变量消费、受控事件流与双端响应式布局。

## 布局

- 卡片采用纵向 flex 编排，圆角采用 `var(--radius-panel)`，边框消费 `var(--border-color)`，卡片底色为 `var(--bg-panel)`；
- 头部包含状态指示圆点、单行截断标题与右侧附加插槽；
- 中部为描述文本段落，支持自适应双行截断；
- 底部为操作区，包含 `role="switch"` 切换开关与扩展操作按钮；
- 最小宽度 240px，最大宽度 720px，在 390px 窄屏容器下自动折行或截断，无水平溢出。

## 交互

- 点击开关触发 `toggle` 事件，上报最新布尔状态；
- 点击操作按钮触发 `action` 事件，携带对应动作标识符；
- 键盘支持 Tab 导航、Enter/Space 激活开关与按钮；
- 禁用态下阻断鼠标与键盘事件。

## 数据

```ts
export interface FixtureExampleProps {
    /** 标题，单行截断。必填。 */
    title: string;
    /** 描述正文，最多两行。默认 ""，为空时不渲染这一段。 */
    description?: string;
    /** 状态徽标。默认 "ready"。 */
    status?: "ready" | "busy" | "warning";
    /** 计数徽标，0 时不显示。默认 0。 */
    count?: number;
    /** 是否激活。父组件持有，组件自身不修改；点开关只发 toggle。默认 false。 */
    active?: boolean;
    /** 禁用后开关与按钮都不响应。默认 false。 */
    disabled?: boolean;
}

export type FixtureExampleEmits = {
    /** 点开关时发出，携带期望的新状态；`active` 不会自己变，由父组件决定是否采纳。 */
    (e: "toggle", active: boolean): void;
    /** 点「检视」「刷新」时发出，携带动作标识 "inspect" / "refresh"。 */
    (e: "action", actionId: string): void;
};

export type FixtureExampleSlots = {
    /** 标题行右侧、计数徽标之后的附加内容。 */
    extra?: () => unknown;
};
```

`active` 是普通受控 prop，不是 v-model：事件叫 `toggle` 而不是 `update:active`，写 `v-model:active` 不会生效。不 expose 任何方法或属性；未声明的 attribute、`class` 与 `style` 按 Vue 默认行为落到根节点。

## 状态

- **默认态**：`status: "ready"`，绿色徽标；
- **激活态**：`active: true`，强调色环外发光与反色开关；
- **忙碌态**：`status: "busy"`，强调色脉冲呼吸；
- **警告态**：`status: "warning"`，琥珀色警告徽标；
- **禁用态**：`disabled: true`，半透明虚化且指针事件静默。
