---
标签: [state:local]
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
    title: string;
    description?: string;
    status?: "ready" | "busy" | "warning";
    count?: number;
    active?: boolean;
    disabled?: boolean;
}

export type FixtureExampleEmits = {
    (e: "toggle", active: boolean): void;
    (e: "action", actionId: string): void;
};
```

## 状态

- **默认态**：`status: "ready"`，绿色徽标；
- **激活态**：`active: true`，强调色环外发光与反色开关；
- **忙碌态**：`status: "busy"`，强调色脉冲呼吸；
- **警告态**：`status: "warning"`，琥珀色警告徽标；
- **禁用态**：`disabled: true`，半透明虚化且指针事件静默。
