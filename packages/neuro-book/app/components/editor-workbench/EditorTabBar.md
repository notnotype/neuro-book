---
标签: []
---

# EditorTabBar

编辑器工作区标签栏受控展示组件：承载固定标签行与普通标签行，支持水平滚动、标题截断与悬停全路径、未保存脏标记、预览状态斜体呈现、拖拽排序与跨组固定、无障碍 Roving Tabindex 键盘漫游以及集成完整右键上下文菜单。

组件纯消费 nb-ui 主题角色变量：`--bg-panel`、`--panel-surface`、`--bg-hover`、`--divider`、`--border-color`、`--text-main`、`--text-secondary`、`--text-muted`、`--accent-main`、`--status-warning`、`--radius-control`。严禁硬编码颜色。

## 与外壳拓扑的关系

- **受控无状态**：纯由 `props.tabs` 与 `props.activePath` 驱动，不读写 Pinia store，不持久化状态，仅向外发送用户意图事件；
- **分行与自适应**：固定标签与普通标签各自拥有独立水平滚动容器（隐藏系统滚动条），当无固定标签时固定行自动收起，窄屏下活动标签通过 `scrollIntoView` 自动居中可见；
- **尾部扩展槽位**：普通标签行尾部预留 `#trailing` 插槽，供 `EditorWorkbench` 嵌入状态栏与菜单工具栏。

## 数据与 API

```ts
type Props = {
    /** 标签只读展示投影列表 */
    tabs: readonly EditorTabPresentation[];
    /** 当前选中的活动标签路径 */
    activePath: string;
};

type Emits = {
    /** 点击或键盘激活标签 */
    (e: "select-tab", path: string): void;
    /** 点击关闭按钮或按 Delete 键请求关闭标签 */
    (e: "close-tab", path: string): void;
    /** 切换固定状态 */
    (e: "set-pin", path: string, pinned: boolean): void;
    /** 双击或菜单保留预览标签 */
    (e: "keep-tab", path: string): void;
    /** 拖拽或菜单移动排序 */
    (e: "move-tab", path: string, targetPath: string | null, targetPinned: boolean, position: EditorTabDropPosition): void;
    /** 当最后一个标签关闭时发出，用于通知外壳聚焦欢迎区 */
    (e: "empty-focus"): void;
};

type Slots = {
    /** 标签行右侧尾部插槽（如工具栏和保存状态） */
    trailing(): unknown;
};
```

## 无障碍与交互契约

1. **Tablist 与 Roving Tabindex**：
   - 固定组与普通组分别具有 `role="tablist"` 与对应的 `aria-label`；
   - 标签选择器主体具有 `role="tab"` 与 `aria-selected`；
   - DOM ID 严格遵循 `:id="editor-tab-${encodeURIComponent(path)}"`；
   - ARIA 对应主内容区 `:aria-controls="editor-tabpanel-${encodeURIComponent(path)}"`；
   - 键盘左右方向键在标签间漫游，Home/End 键直达首末项，Enter/Space 激活标签；
2. **按钮不嵌套契约**：
   - 标签选择按钮（`role="tab"`）与标签关闭按钮（`<button class="editor-tab-close">`）在 DOM 结构上并列同级，彻底避免 HTML 交互元素非法嵌套；关闭按钮设 `tabindex="-1"`，保证 Tablist 漫游节奏连贯；
3. **状态可访问性**：
   - 未保存标记圆点附带 `aria-label` 与 `title`（如“未保存”）；
   - 预览标签采用 `italic` 斜体样式呈现，可通过双击常驻或通过菜单保留；
4. **右键上下文菜单**：
   - 鼠标右键或 `Shift+F10` 快捷键唤出集成 `ContextMenu`，提供“固定/取消固定”、“保留预览”、“向前移动”、“向后移动”与“关闭”操作；
   - 上下方向键可在菜单项间导航，Enter 触发动作，Escape 退出并自动将焦点安全归还至触发标签；
5. **最后一个标签关闭引导**：
   - 当最后一个标签被关闭时，发出 `empty-focus` 事件，外壳据此将焦点自动引导至空态欢迎页的首选操作。

## Component Lab 验证

通过 `app/component-lab/fixtures/EditorWorkbenchFixture.vue` 联合验证：
- 在 `mixed` 场景中验证固定标签与普通标签的分组展示、脏状态小圆点、预览斜体与切换；
- 在 `long-titles` 场景中验证超长路径单行截断与横向滚动；
- 在 `closing-cancel` 场景中验证关闭事件拦截及取消保留；
- 在 1440px 桌面与 390×844 窄屏下均表现出稳定可用的视觉与手势效果。
