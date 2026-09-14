---
标签: []
---

# WorkbenchPanelSurface

承载工作台底部面板的**外壳卡片零件**：顶部标签条（多项、当前项高亮、角标数字）+ 右侧动作区，加一块内容区（支持 `fill` / `scroll` 两种呈现合同）。

卡片只画面：面 / 描边 / 圆角 / 阴影 / 分隔线全部取 nb-ui 的主题角色变量（`--panel-surface` / `--panel-outline` / `--radius-panel` / `--elevation-raised` / `--divider` / `--panel-p`），与左右侧栏容器卡片、活动栏卡片完全保持同一套材质语言，换主题只换变量，组件内零字面颜色。

## 与外壳拓扑的关系

职责边界（严格遵循提案「三种拖动，三个 owner」与外壳结构契约）：

- **部件不拥有拖拽手势**：面板与上方编辑器/内容之间的 1px 分界线及高度拖拽手势归外壳与 nb-ui `Splitter` 承担，尺寸夹取与常量定义归 `app/utils/workbench/layout.ts`，部件本身只提供结构，不监听指针拖拽；
- **部件不拥有持久化键**：高度状态与收起态的持久化（`workbench.layout`）归外壳宿主，部件不读写 `localStorage` 或 store；
- **部件不装 descriptor**：标签与视图的注册表解耦在宿主层，部件通过 props（`activeTab`、`tabs`）与插槽（`#tabs`、`#actions`、`#content`）实现极简受控。

## 数据与 API

```ts
export type WorkbenchPanelTabItem = {
    id: string;
    label: string;
    icon?: string;
    badge?: string | number;
    closable?: boolean;
    disabled?: boolean;
};

type Props = {
    /** 当前激活的标签 id */
    activeTab?: string;
    /** 面板是否已收起（收起时仅保留标签头，内容区隐藏；高度由外壳/Splitter控制） */
    collapsed?: boolean;
    /** 内容区呈现合同；缺省 'fill'（由视图自己管理内部滚动，如 Terminal / Output） */
    layout?: "scroll" | "fill";
    /** 可选标题或无障碍名称，用于根节点的 aria-label */
    title?: string;
    /** 声明式标签列表（若不使用 #tabs 插槽自定义，可直接传入数据） */
    tabs?: WorkbenchPanelTabItem[];
};

type Emits = {
    (event: "update:activeTab", tabId: string): void;
    (event: "update:collapsed", collapsed: boolean): void;
    (event: "tab-click", tabId: string): void;
    (event: "tab-close", tabId: string): void;
    (event: "toggle-collapse"): void;
};

type Slots = {
    /** 覆盖或填充标签条区（缺省渲染由 tabs prop 驱动的 WorkbenchPanelTab 列表） */
    tabs(): unknown;
    /** 头部右侧动作区（收起、清空、关闭等宿主按钮） */
    actions(): unknown;
    /** 内容区 */
    content(): unknown;
    /** 默认插槽（content 未提供时渲染它） */
    default(): unknown;
};
```

配套项级子组件：`WorkbenchPanelTab.vue`（提供 `id`, `label`, `icon`, `badge`, `active`, `closable`, `disabled` 属性及 `click`/`close` 事件）。

## 布局

- 根节点：单根 `<section class="workbench-panel-surface">`，透传 attrs，携带 `data-panel-collapsed`、`data-panel-layout`、`data-panel-active-tab` 与 `aria-label`；
- 头部：高度 32px（`--space-8`），底边分隔线 `--divider`；左侧标签条 `overflow-x: auto` 横向平铺且不露原生滚动条，窄屏下自动缩略；右侧动作区 `flex: 0 0 auto` 居右；
- 内容区：占满剩余高度，`layout="fill"` 时 `overflow: hidden` 由视图自管；`layout="scroll"` 时给出 `padding: var(--panel-p)` 并开启垂直滚动；
- 收起态：`collapsed === true` 时，内容区通过 `v-show` 隐藏，根节点添加 `.workbench-panel-surface--collapsed` 标记，高度坍缩为头部自适应。

## 不支持

- 不拥有拖拽手势、sash handle 或尺寸监听（由外壳加 `Splitter` 负责）；
- 不做持久化存储，不读 store；
- 不直接解析 i18n key 或 descriptor（由宿主解析后注入）；
- 不提供业务视图（终端、问题列表等均以插槽注入）。

## 注意事项

- 在 Lab 中验证「从底边线拖出/收起」时，fixture 用 nb-ui `Splitter` 模拟外壳环境，拖拽归外壳；
- 标签项的角标必须使用确定性内存数据；
- 窄屏容器下，标签条会缩略自适应，动作区保持不换行。
