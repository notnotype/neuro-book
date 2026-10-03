---
标签: []
别名: ["状态栏", "Status Bar"]
---

# WorkbenchStatusBar

承载工作台最底部状态信息的**外壳部件零件**：极窄的一条 Chrome，左侧承载工作空间状态（分支、同步、错误/警告计数等），右侧承载编辑器与环境摘要（编码、行号、语言、通知等）。

状态栏纯消费 nb-ui 主题角色变量：底色 `--panel-surface`、分界线 `--divider`、描边 `--panel-outline`、文字颜色 `--text-secondary`、悬停背景 `--bg-hover` 与状态色 `--status-*`。

## 与外壳拓扑的关系

- **第一版固定底部**：依据已批准提案 `workbench-view-host.md` 决策记录第 4 条，状态栏第一版固定在工作台最底部，不参与跨栏换位；
- **极窄高度契约**：使用 token 严格约束在约 22px：`calc(var(--space-7) - var(--space-1))`（24px - 2px = 22px），保证桌面 IDE 级别紧凑度；
- **分界线**：与上方的主体工作区/底部面板之间保持 1px 细线分界（`border-top: var(--border-w) solid var(--divider)`）；
- **不拥有状态**：状态栏不读 store、不直接查询 Git 或 LSP，仅作为受控插槽容器承载项级组件。

## 数据与 API

```ts
type Props = {
    /** 无障碍名称，缺省为 '状态栏' */
    ariaLabel?: string;
};

type Slots = {
    /** 状态栏左侧分组项（例如分支切换、同步按钮、错误警告计数） */
    left(): unknown;
    /** 状态栏右侧分组项（例如编码选择、行号跳转、通知入口） */
    right(): unknown;
    /** 默认插槽（直接平铺内容） */
    default(): unknown;
};
```

配套项级子组件：`WorkbenchStatusBarItem.vue`。

```ts
export type WorkbenchStatusBarItemVariant = "default" | "error" | "warning" | "info" | "success";

type ItemProps = {
    /** 项标识 */
    id?: string;
    /** 文本标签 */
    label?: string;
    /** 图标 class（如 i-lucide-git-branch） */
    icon?: string;
    /** 角标或计数值（如 44） */
    badge?: string | number;
    /** 状态色变体，对应 --status-* */
    variant?: WorkbenchStatusBarItemVariant;
    /** 是否可交互点击，为 false 时渲染为非按钮 span */
    clickable?: boolean;
    /** 是否处于激活态 */
    active?: boolean;
    /** 原生 title 悬停提示 */
    title?: string;
    /** 无障碍标签 */
    ariaLabel?: string;
};

type ItemEmits = {
    (event: "click", e: MouseEvent): void;
};
```

## 布局

- 根节点：单根 `<footer class="workbench-status-bar">`，透传 attrs，携带 `role="status"` 与 `data-workbench-status-bar`；
- 高度：`calc(var(--space-7) - var(--space-1))` 锁定 22px，`box-sizing: border-box`，`overflow: hidden`；
- 左侧分组：`flex: 1 1 auto; min-width: 0; overflow: hidden;`，子项紧凑排列，空间不足时优雅裁剪不换行；
- 右侧分组：`flex: 0 0 auto; margin-left: auto;`，保持固定在最右侧；
- 字号：全栏统一消费 `--text-2xs`（11px，角标与状态栏专用刻度），单行居中对齐。

## 不支持

- 不支持拖拽改变自身高度（高度为 22px 刚性契约）；
- 不做项排序或隐藏的本地持久化（由宿主外壳与配置层控制）；
- 不渲染业务弹窗（弹出菜单由外部 Popover/Dropdown 消费槽位提供）。

## 注意事项

- 项组件 `WorkbenchStatusBarItem` 在 `clickable` 为 true 时渲染语义化 `<button>`，键盘 Tab 键可聚焦并通过 Enter 触发；
- 状态栏内容应保持紧凑单行，不得设置破坏 22px 高度的内边距或行高。
