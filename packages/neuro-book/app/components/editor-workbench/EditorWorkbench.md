---
标签: []
---

# EditorWorkbench

编辑器工作区外壳受控组合件：承载中央 Editor Part，负责将标签栏（`EditorTabBar`）、菜单工具栏（`EditorToolbar`）、编辑视图插槽（`default` slot）、欢迎页面插槽（`empty` slot）与保存/状态反馈插槽（`status` slot）组织为高内聚、低耦合的通用 IDE 编辑界面。

组件纯消费 nb-ui 主题角色变量：`--panel-surface`、`--bg-panel`、`--divider`、`--border-color`、`--border-strong`、`--accent-main`、`--accent-text`、`--status-warning`、`--status-warning-bg`、`--status-warning-border`、`--radius-control`、`--radius-panel`。严禁硬编码颜色。

## 与外壳拓扑的关系

- **Editor Part 专用**：挂载于 `WorkbenchShell` 的 `#editor` 主编辑区，非侧栏 View Container，不装 descriptor、不拥有持久化键、不读 store、不直接发起 I/O 请求；
- **几何与自适应**：外壳与内容区均满足 `min-width: 0; min-height: 0; overflow: hidden;`，无 640px 限制，在 1440px 桌面与 390×844 窄屏下均完整可用；
- **单根结构契约**：单根 `<section class="editor-workbench ...">`，所有外层 attrs 原生透传，无 expose。

## 数据与 API

```ts
type Props = {
    /** 标签只读展示投影列表 */
    tabs?: readonly EditorTabPresentation[];
    /** 当前活动文档路径 */
    activePath?: string;
    /** 菜单栏数据列表（文件/打开方式/当前视图操作） */
    menus?: MenubarMenuData[];
    /** 是否处于文档切换/读取中的忙碌状态（不阻塞已有正文输入） */
    busy?: boolean;
    /** 打开方式诊断信息或错误 */
    diagnosis?: string | null;
};

type Emits = {
    (e: "select-tab", path: string): void;
    (e: "close-tab", path: string): void;
    (e: "set-pin", path: string, pinned: boolean): void;
    (e: "keep-tab", path: string): void;
    (e: "move-tab", path: string, targetPath: string | null, targetPinned: boolean, position: EditorTabDropPosition): void;
    (e: "select-menu", item: MenubarItemData): void;
    (e: "retry"): void;
    (e: "open-as-code"): void;
};

type Slots = {
    /** 编辑视图主插槽（如 EditorViewHost） */
    default(): unknown;
    /** 欢迎页插槽（如 EditorWelcome） */
    empty(): unknown;
    /** 保存进度/状态插槽（如 保存中.../已保存） */
    status(): unknown;
};
```

## 无障碍与交互契约

1. **Tabpanel 与 Aria 匹配**：
   - 主内容区绑定 `role="tabpanel"`；
   - panel DOM ID 为 `editor-tabpanel-${encodeURIComponent(activePath)}`（无活动路径时为 `editor-tabpanel-empty`）；
   - 与 `EditorTabBar` 中对应标签的 `aria-controls` 精确对齐；
   - 附带 `:aria-labelledby="editor-tab-${encodeURIComponent(activePath)}"`；
2. **忙碌遮罩状态**：
   - 当 `busy` 为 true 时，内容区标记 `:aria-busy="true"`；
   - 浮层使用 `role="status"` 与 `aria-live="polite"` 提示加载状态；
   - 限制用户指针点击，但绝不卸载当前视图实例，未提交正文完整保留；
3. **错误提示条**：
   - 当 `diagnosis` 存在时，通过 `role="alert"` 呈现警告横幅；
   - 提供“重试”与“以源码打开”操作；
   - 下层视图与正文完整保留，保证未保存内容绝不丢失；
4. **空状态引导**：
   - 无标签时渲染 `empty` 插槽（`EditorWelcome`）；
   - 接收到标签栏的 `empty-focus` 信号后自动引导焦点至欢迎操作区首个可聚焦元素。

## Component Lab 场景登记

在 `app/component-lab/fixtures/EditorWorkbenchFixture.vue` 登记以下受控场景，所有数据均支持在 Lab 数据面板动态调整：

| 场景 ID | 场景标签 | 验证重点 |
| :--- | :--- | :--- |
| `empty` | 空工作区 / 欢迎页 | 无标签时的轻量标题与菜单栏，欢迎页动作引导与焦点落点 |
| `mixed` | 固定、普通、预览与脏标记标签 | 多状态标签集合、活动高亮、未保存状态圆点及保存反馈 |
| `long-titles` | 超长路径与横向截断滚动 | 深度嵌套长文件名单行截断、全路径 title tooltip、横向平滑滚动 |
| `loading` | 加载中 / 忙碌遮罩态 | `busy: true` 下的半透明模糊遮罩与加载动画，正文实例保持挂载 |
| `diagnosis` | 诊断警告 / 未知打开方式 | 警告横幅可见性、重试与以源码打开按钮回调、下层视图无损 |
| `closing-cancel` | 未保存关闭保护与取消决策 | 脏文件点击关闭弹出安全确认卡片，点击取消不关闭标签 |
| `keyboard-menu` | 菜单栏集合与键盘无障碍漫游 | 左右键切换菜单、上下键展开/选择、快捷键展示、禁用态与分割线 |
| `multi-view` | 真实 Registry / 第三视图切换 | 真实 `createEditorRegistry` + `EditorViewHost`，源码/富文本/test.preview 共享同一正文 |
