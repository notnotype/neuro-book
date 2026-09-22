---
标签: []
---

# EditorWorkbench

编辑器工作区外壳受控组合件：承载中央 Editor Part，负责将标签栏（`EditorTabBar`）、菜单工具栏（`EditorToolbar`）、编辑视图插槽（`default` slot）、欢迎页面插槽（`empty` slot）与保存/状态反馈插槽（`status` slot）组织为高内聚、低耦合的通用 IDE 编辑界面。

EditorGroup、文档 Tab 与 Workbench 的 ViewContainer、Switcher Tab 的统一定义及两套拖拽行为表，见 [Workbench 外壳 Spec](../../../../../docs/specs/ui/workbench-shell.md#editor-与-workbench-的容器层级)。本组件保留正文中央“保持当前布局”、四边创建编辑组、标签栏移入现有组的语义；本次 Workbench 工具容器的新规则不改变 Editor 行为。

组件纯消费 nb-ui 主题角色变量：`--panel-surface`、`--bg-panel`、`--divider`、`--border-color`、`--border-strong`、`--accent-main`、`--accent-text`、`--status-warning`、`--status-warning-bg`、`--status-warning-border`、`--radius-control`、`--radius-panel`。严禁硬编码颜色。

## 与外壳拓扑的关系

- **Editor Part 专用**：挂载于 `WorkbenchShell` 的 `#editor` 主编辑区，非侧栏 View Container，不装 descriptor、不拥有持久化键、不读 store、不直接发起 I/O 请求；
- **几何与自适应**：外壳与内容区均满足 `min-width: 0; min-height: 0; overflow: hidden;`，无 640px 限制，在 1440px 桌面与 390×844 窄屏下均完整可用；
- **单根结构契约**：单根 `<section class="editor-workbench ...">`，所有外层 attrs 原生透传，无 expose。

## 数据与 API

```ts
type Props = {
    /** 编辑组：树上叶的 id 就是组 id，组自带标签、活动路径与外壳状态 */
    groups: readonly EditorGroupState[];
    /** 布局树（nb-ui `Grid<string>` 的根）：单组是一个叶，分屏后是分支 */
    tree: GridNode<string> | null;
    /** 与 `tree` 同源的呈现；宿主按内容区实测尺寸计算 */
    layout: GridLayoutResult;
    /** 当前活动组（焦点与命令归属由宿主唯一持有） */
    activeGroupId: string;
    /** 是否提供分屏入口（工具栏与拖拽分屏）；默认关闭 */
    allowSplit?: boolean;
    /** 手势上下文（工作面 / fixture 场景代际）：与 `revision` 一起在有进行中手势时作废手势；缺省 `""` */
    contextKey?: string;
    /** 外部版本：树、约束或容器变化时递增；进行中的手势据此失效；缺省 `0` */
    revision?: number;
    /** 同步接纳一场手势的提交（整批分支变化一次落账）；返回 `{ok:false, reason}` 即回滚预览并诊断，缺席时这次调整不落账 */
    onGestureCommit?: (commit: GridGestureCommit) => {ok: true} | {ok: false; reason: string};
};

type Emits = {
    (e: "select-tab", groupId: string, path: string): void;
    (e: "close-tab", groupId: string, path: string): void;
    (e: "set-pin", groupId: string, path: string, pinned: boolean): void;
    (e: "keep-tab", groupId: string, path: string): void;
    (e: "move-tab", groupId: string, path: string, targetPath: string | null, targetPinned: boolean, position: EditorTabDropPosition): void;
    (e: "transfer-tab", payload: TabTransferPayload): void;
    (e: "select-menu", groupId: string, item: MenubarItemData): void;
    (e: "toolbar-action", groupId: string, actionId: string): void;
    (e: "retry", groupId: string): void;
    (e: "open-as-code", groupId: string): void;
    (e: "split-tab", payload: EditorSplitPayload): void;
    (e: "navigate-breadcrumb", groupId: string, item: BreadcrumbItem): void;
    (e: "empty-focus", groupId: string): void;
    (e: "focus-group", groupId: string): void;
    /** 内容区实测尺寸（程序布局，不产生保存意图） */
    (e: "container-extent", extent: GridExtent): void;
    /** 手势开始：一个会话 id + 冻结的外部事实（工作面、来源、修订、命中的分隔线） */
    (e: "gesture-start", info: EditorWorkbenchGestureStart): void;
    /** 手势中的几何预览：布局与树是渲染层正在显示的即时几何（叶内容随父盒实时变化） */
    (e: "gesture-update", preview: GridGesturePreview<unknown>): void;
    /** 已结束的手势提交（**观察事件**）：落账只走 `onGestureCommit` 的同步回执 */
    (e: "gesture-end", commit: GridGestureCommit): void;
    /** 可观察的取消（Escape / 外部事实变化 / 卸载）：没有落账，尺寸回到开始前那份 */
    (e: "gesture-cancel", info: EditorWorkbenchGestureCancel): void;
    /** 会话诊断：容量不足、提交被拒绝、宿主没有提供接纳回调 */
    (e: "issues", issues: readonly string[]): void;
};

type Slots = {
    /** 编辑视图主插槽（如 EditorViewHost）；作用域给 `{group, groupId, activePath}` */
    content(props: {group: EditorGroupState; groupId: string; activePath: string}): unknown;
    /** 欢迎页插槽（如 EditorWelcome） */
    empty(props: {group?: EditorGroupState; groupId: string}): unknown;
    /** 保存进度/状态插槽（如 保存中.../已保存） */
    status(): unknown;
    /** 面包屑右侧尾部插槽（如 VS Code 风格编辑器类型切换按钮） */
    breadcrumbsTrailing?(): unknown;
};
```

## 受控边界

- **树与组都属于宿主**：外壳不复制第二份权威状态、不自己保存布局。分屏由宿主调 `splitEditorGroup`（`app/utils/editor-workbench/editor-groups.ts`）先做结构操作，
  成功后才发布新组与候选布局——失败不留空组，也不会先把标签从源组移走。空组塌陷同样由宿主在关闭/转移时收口。
- **尺寸**：外壳用 `ResizeObserver` 把内容区实测尺寸回报给宿主（`container-extent`），宿主据此 `grid.layout(extent)` 并把结果写回 `layout`。
  拖拽 sash 时几何全部是 CSS px：渲染层自己做整场手势的会话与预览，结束时把一份 `GridGestureCommit`（`changes` 按分支给出全部直接子节点的基线/目标）交给宿主的 `onGestureCommit`；
  宿主的落账入口是 `applyEditorGesture`（`app/utils/editor-workbench/editor-groups.ts`）——一次 `grid.resizeBranches(commit.changes)` 应用交汇处的**全部**变化，失败整批不落账并回滚预览，成功只推进**一次**会话修订。
  `gesture-end` 只是观察事件：宿主不在事件路径上写树，避免同一场手势落账两次。
- **渲染**：内部使用 nb-ui `GridRenderer`——每个分支一个 `Splitter`、叶渲染一个 `EditorGroup`，尺寸经受控 px 同步而非重挂，
  因此拖拽中与容器变化时叶内容不会被卸载；手势期间叶内容与嵌套分支的盒子随父盒**实时**变化（没有松手才更新的旁路）。
- **单组与多组同一条路径**：主页接入多组——工具栏"向右分屏"给同一正文开第二个视图（`mode: 'copy'`，来源组保留标签），
  把标签拖到组边缘产生新组（`mode:'move'`，来源组为空时塌陷），拖到目标标签栏为跨组移动；正文中央显示整区drop indicator与「保持当前布局」提示，但释放不提交任何移动/分屏，包括跨组中央。
  意图由 `EditorSplitPayload`（来源/目标/方向/模式）显式给出，宿主据此执行，不从全局拖拽状态猜操作。
  组与标签的事务在 Store（`editor-session`），几何在 nb-ui Grid，恢复由编辑会话记录负责。
- **标签拖动是 dnd-kit 会话，不是原生拖放**：宿主在编辑组之上提供编辑拖动会话（`EditorDragProvider` / `EditorWorkbench` 的 `useEditorTabDrag`）。
  `EditorTabItem`登记拖动源（`{kind:'editor-tab',groupId,path}`），`EditorTabBar`登记普通分区以及多行时已有的固定分区；`EditorGroup`登记正文的真实rect。
  子组件只交真实 refs 与标记，不算命中、不提交拖动、不画反馈。拖动用指针事件与变换实现，**不产生原生拖放事件**，正文里的真实视图（ProseMirror、Monaco）因此不需要任何命中屏障：
  原先那层 `data-role="editor-drop-layer"` 捕获层已经删除，外部拖入文件或文本的行为不变。
- **落点承诺跟随宿主能力**：`allowSplit`关闭时正文不接收标签；打开时四边可分屏，中央返回整区预览与 `action:null`（可见但不可提交），不伪造noop事务。标签栏排序与跨组转移不受开关影响。
  正文不需要"吞掉 drop"兜底，因为内部拖动不会以原生拖放的形式落进视图。
- **共享拖放反馈**：插入线、区域与文字提示统一由公共 `DropFeedbackOverlay` 按会话求值结果绘制；编辑组、标签栏与标签条目只提供 `data-role` / `data-editor-tab-path` 等真实标记。
  跟随反馈是Provider的Custom DragOverlay（`DropIndicatorLabel`标题，`dropAnimation:null`），源Tab保持可见且布局不动，不隐藏、不clone、不插placeholder；几何读取始终看到原始布局。区域与提示首次淡入，连续换区保留单节点并平滑改变位置/尺寸，文案立即更新；插线即时定位，取消立即清除，减少动效时不做过渡。视觉过渡不延迟命中或提交。
- **组内落点语义**：单行固定区不接受任何标签拖入，普通区登记全宽真实落点；多行固定区在普通区上方独立换行，两区各自求值。行内仍用共享列表算法，上一行尾部与下一行首项之前统一标在下一行首项前；行尾不会误追加到分区末尾。不根据起拖状态生成空分区，固定区为空时可用标签菜单固定第一项。
  标签前后换序与跨组转移沿用 `move-tab` / `transfer-tab` 意图合同。原位前后落点也显示插入线，但返回 `action:null`，释放不提交移动；切换单双行只改变呈现和落点登记，不更改标签列表。
- **正文布局不受拖动影响**：拖动中 `EditorGroup` 只在正文外壳上加 `select-none`（无关正文不被选中），不再铺全屏指针屏障；拖动会话的生命周期（激活、取消、清理）由 dnd-kit 会话持有。
- **多行标签模式**：每组默认多行，标签栏右侧始终可见的「多行标签」按钮（aria-pressed）与更多菜单复选项共享同一状态，随时切回单行。固定区在上、普通区在下，均可换行。状态仅本组挂载期间有效，不写Store，重新挂载恢复多行。上下键按实际行找最近项，左右/Home/End按展示序漫游；Ctrl+Space不被导航抢占。

## 无障碍与交互契约

1. **Tabpanel 与 Aria 匹配**：
   - 主内容区绑定 `role="tabpanel"`；
   - panel DOM ID 为 `editor-tabpanel-${encodeURIComponent(activePath)}`（无活动路径时为 `editor-tabpanel-empty`）；
   - 与 `EditorTabBar` 中对应标签的 `aria-controls` 精确对齐；
   - 附带 `:aria-labelledby="editor-tab-${encodeURIComponent(activePath)}"`；
2. **顶栏与 VS Code 面包屑对齐**：
   - 顶栏默认多行Tab与22px面包屑，切回单行时标签栏36px高；固定区透明背景/细分隔，图钉可悬停及取消固定。
   - 工具栏折叠为“更多操作”图标按钮，使用 `reka-ui` DropdownMenu 体系完整承接树状多层子菜单（如导出作品展开 EPUB/PDF）、分组分割线、项自身分割线与危险操作高亮；
   - 面包屑支持在 390px 视口下横向滚动防挤压，尾部视图切换按钮支持键盘聚焦与回车触发；
3. **忙碌遮罩状态**：
   - 当 `busy` 为 true 时，内容区标记 `:aria-busy="true"`；
   - 浮层使用 `role="status"` 与 `aria-live="polite"` 提示加载状态；
   - 限制用户指针点击，但绝不卸载当前视图实例，未提交正文完整保留；
4. **错误提示条**：
   - 当 `diagnosis` 存在时，通过 `role="alert"` 呈现警告横幅；
   - 提供“重试”与“以源码打开”操作；
   - 下层视图与正文完整保留，保证未保存内容绝不丢失；
5. **空状态引导**：
   - 无标签时渲染 `empty` 插槽（`EditorWelcome`）；
   - 接收到标签栏的 `empty-focus` 信号后自动引导焦点至欢迎操作区首个可聚焦元素。

## Component Lab 场景登记

在 `app/component-lab/fixtures/EditorWorkbenchFixture.vue` 登记以下受控场景，所有数据均支持在 Lab 数据面板动态调整：

| 场景 ID | 场景标签 | 验证重点 |
| :--- | :--- | :--- |
| `empty` | 空工作区 / 欢迎页 | 无打开文件时的空态布局，欢迎页动作引导与焦点落点 |
| `mixed` | 固定、普通、预览与脏标记标签 | 多状态标签集合、活动高亮、未保存状态圆点及保存反馈 |
| `long-titles` | 超长路径与横向截断滚动 | 深度嵌套长文件名单行截断、面包屑 390px 防挤压横向滑动 |
| `loading` | 加载中 / 忙碌遮罩态 | `busy: true` 下的半透明模糊遮罩与加载动画，正文实例保持挂载 |
| `diagnosis` | 诊断警告 / 未知打开方式 | 警告横幅可见性、重试与以源码打开按钮回调、下层视图无损 |
| `closing-cancel` | 未保存关闭保护与取消决策 | 脏文件点击关闭弹出安全确认卡片，点击取消不关闭标签 |
| `keyboard-menu` | 菜单栏集合与键盘无障碍漫游 | 树状子菜单递归展开、快捷键展示、禁用态、分割线与危险样式 |
| `multi-view` | 真实 Registry / 第三视图切换 | 真实 `createEditorRegistry` + `EditorViewHost`，源码/富文本/test.preview 共享同一正文 |
