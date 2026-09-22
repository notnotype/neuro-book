---
标签: []
---

# EditorTabBar

编辑器工作区标签栏受控展示组件：固定标签组与普通标签组连续并排，支持滚轮与触摸水平滚动、标题截断与悬停全路径、未保存脏标记（圆点/叉号切换）、Git 状态语义色同步、预览状态斜体呈现、无障碍 Roving Tabindex 键盘漫游以及集成完整右键上下文菜单。拖放只登记真实落点，由宿主的编辑拖动会话求值。

组件纯消费 nb-ui 主题角色变量：`--bg-panel`、`--panel-surface`、`--bg-hover`、`--divider`、`--border-color`、`--text-main`、`--text-secondary`、`--text-muted`、`--accent-main`、`--status-warning`、`--status-success`、`--radius-control`、`--motion-fast`。严禁硬编码颜色。

## 与外壳拓扑的关系

- **受控无状态**：纯由 `props.tabs` 与 `props.activePath` 驱动，不读写 Pinia store，不持久化状态，仅向外发送用户意图事件；
- **单行/多行排布**：默认多行，固定区独立在普通区上方，两区各自换行，以透明背景、细分隔和留白区分，不铺灰色块。显式 `wrap=false` 为单行横向滚动，固定区不接受拖入。活动标签滚动可见；多行最多180px，EditorGroup还限制顶部不超过组高50%，纵向溢出不挤没正文。
- **尾部扩展槽位**：标签行尾部预留 `#trailing` 插槽，供 `EditorWorkbench` 嵌入状态指示与操作工具栏；
- **不认识落点**：标签栏不画指示线、不算命中、不提交拖动、没有原生 `DragEvent` 处理器；拖动中的反馈（插入线、区域与文字提示）由公共 `DropFeedbackOverlay` 按会话求值结果绘制。

## 数据与 API

```ts
type Props = {
    /** 标签只读展示投影列表 */
    tabs: readonly EditorTabPresentation[];
    /** 当前选中的活动标签路径 */
    activePath: string;
    /** 所属编辑组：落点登记与拖动载荷的组身份，默认 primary */
    groupId?: string;
    /** 多行标签；默认 true，false 时单行横向滚动 */
    wrap?: boolean;
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
    /** 菜单/键盘命令的组内移动排序（拖动提交由会话发 move-tab/transfer-tab，不经过这里） */
    (e: "move-tab", path: string, targetPath: string | null, targetPinned: boolean, position: EditorTabDropPosition): void;
    /** 当最后一个标签关闭时发出，用于通知外壳聚焦欢迎区 */
    (e: "empty-focus"): void;
};

type Slots = {
    /** 标签行右侧尾部插槽（如工具栏和保存状态） */
    trailing(): unknown;
};
```

## 落点登记（拖动会话）

- **真实落点登记**：普通区始终登记 `{kind: 'tabs', groupId, pinned:false, wrap, element, tabs}`；已有固定区仅多行时登记 `pinned:true`。会话在每个分区内按指针纵坐标选择可见行，再复用共享列表几何。登记随ref、groupId、wrap变化重建；不再用混合分区或拖动时新增24px空落区。固定区为空时通过菜单固定第一项；普通区的最小空间常驻，不因起拖变化。
- **单行普通组覆盖内部间隙**：普通组整组全宽（`flex-1`，同时保留 `min-width: max-content` 让实际标签宽度参与外层滚动行的 scrollWidth），标签之间的空白也是落点；落在哪个插入位由会话按真实条目几何求值，组件不参与。
- **唯一滚动宿主**：外层整排是唯一scroll container；单行滚轮统一转横向scrollLeft，普通组以max-content撑开真实落点；多行不转换滚轮，保留原生纵向滚动，单项宽度不超过可用宽度。工具栏在顶部固定可见。
- **键位让给库**：会话进行中标签栏跳过自己的方向键漫游（拖动中的方向键属于拖放库的键盘拖动）；`Ctrl+Space` 是键盘拖动的启动键，不当成"选中"。没有拖动时 `Space` / `Enter` 仍是激活标签。
- **拖动源与载荷**：单个标签的拖动源由 `EditorTabItem` 登记（`{kind: 'editor-tab', groupId, path}`），标签栏只负责它所在的组落点。

## 无障碍与交互契约

1. **Tablist 与 Roving Tabindex**：
   - 固定区与普通区各有真实布局盒和 `role="tablist"` / `aria-label`，不再使用 `display: contents` 混合排列。
   - 标签选择器主体具有 `role="tab"` 与 `aria-selected`；
   - DOM ID 严格遵循 `:id="editor-tab-${encodeURIComponent(path)}"`；
   - ARIA 对应主内容区 `:aria-controls="editor-tabpanel-${encodeURIComponent(path)}"`；
   - 键盘左右方向键严格根据界面呈现顺序（`[...pinnedTabs, ...regularTabs]`）流转漫游，Home/End 键直达首末项，Enter/Space 激活标签；
   - 多行上下键在相邻实际行内寻找与当前横坐标最近的标签，首末行不回绕；固定标签稍矮不被误判为另一行。切换模式不重挂标签、不丢当前焦点；菜单关闭后仍由现有菜单组件归还焦点。
2. **类型化句柄与聚焦稳定性**：
   - 消费 `EditorTabItemHandle` 显式句柄，禁止 DOM 探查；
   - 标签固定或取消固定（跨组移动）后，在 `nextTick` 自动重新定位并聚焦被操作的标签 DOM，防止焦点丢失至 `body`；
3. **按钮不嵌套契约**：
   - 标签选择按钮（`role="tab"`）与标签关闭按钮（`<button class="editor-tab-close">`）在 DOM 结构上并列同级，彻底避免 HTML 交互元素非法嵌套；关闭按钮设 `tabindex="-1"`，保证 Tablist 漫游节奏连贯；
4. **状态可访问性**：
   - 未保存标记圆点附带 `aria-label` 与 `title`（如“未保存”）；
   - 预览标签采用 `italic` 斜体样式呈现，可通过双击常驻或通过菜单保留；
   - Git 状态色采用主题语义变量 `--status-success` 与 `--status-warning`，保证深浅色对比度 ≥ 4.5:1；
5. **右键上下文菜单**：
   - 鼠标右键或 `Shift+F10` 快捷键唤出集成 `ContextMenu`，提供“固定/取消固定”、“保留预览”、“向前移动”、“向后移动”与“关闭”操作；
   - 上下方向键可在菜单项间导航，Enter 触发动作，Escape 退出并自动将焦点安全归还至触发标签；
   - 菜单的 window keydown 监听挂在**冒泡阶段**并尊重 `defaultPrevented`：贴着焦点的浮层（例如 S4 命令面板）先消费 Escape / 方向键，菜单不会抢在它们前面动作，也不会被它们已消费的按键二次触发；
6. **最后一个标签关闭引导**：
   - 当最后一个标签被关闭时，发出 `empty-focus` 事件，外壳据此将焦点自动引导至空态欢迎页的首选操作。

## Component Lab 验证

- 独立场景 `EditorTabBar`（`app/component-lab/fixtures/EditorTabBarFixture.vue`）：默认多行，标签栏右侧有始终可见的「多行标签」切换按钮，菜单同步相同状态；真实Provider覆盖拖动，夹具应用固定/取消固定和排序到本地列表，不写Store。
- 联合场景 `EditorWorkbench`（`app/component-lab/fixtures/EditorWorkbenchFixture.vue`）：每组默认多行，右侧同样有直接切换按钮；可验证分组换行、固定取消、跨组标签移动与正文整区/四边反馈。
