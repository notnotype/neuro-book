---
标签: [state:local, state:inject]
别名: ["Part 宿主", "Part Host", "容器选择器"]
验证入口: WorkbenchShellLayout
---

# WorkbenchPartHost

> 拖放行为真相源见[Workbench 拖拽行为表](../../../../../docs/specs/ui/workbench-shell.md#workbench-拖拽行为表)。空内容区与 Switcher 条目带均接收 View／容器；标题与工具按钮区禁投。

一个 Part 的宿主：**容器选择器**（Panel / 右栏的标签带，或主侧栏的可拖标题）+ **容器落点** + **活动容器的挂载目标** + **`single` 的 View 动作上提**。

它把「一个 Part 只显示一个活动容器」这条规则落成界面：Panel 与右栏用标签带（只有一个容器也保留——容器标签本身还是拖动源与落点），主侧栏（`left`）**不画**第二套标签带（那里由 Activity Bar 的主入口组选容器）。主侧栏在 `single` 时显示当前容器名，这一行除动作区外可拖走容器；`multiple` 时不渲染容器标题行，各 View 保留自己的标题，容器只留不可见拖动源。活动容器的挂载目标登记给 `WorkbenchContainerInstances`，由它把容器的 `WorkbenchViewHost` 搬进来，未活动容器停在那一层的 parking。容器整体也可以从这里拖走或从菜单移到别的落位。

容器里只有一个**可见** View 时（`mode === "single"`），那个 View 的 Section 不渲染标题（见 `WorkbenchViewSection`），它的贡献动作与「移动到」入口在这里投射到容器右上角：一组标记为 `[data-title-actions="view"]` 的动作（`data-action-view-id` / `data-action-generation`），排列是 View 贡献 → 容器管理 → Part 框架。动作仍是 **View** 的命令：回传同一个 `{scope:"view", target:{viewId,generation}}`，沿用既有执行闸门，不复制 handler。

组件不做容器选择求值、不读存储、不认识命令：切片由 `resolveViewPresentation().part(partId)` 给定，动作点击经 emits 回传。

## 布局

- 头部（`[data-shell-focus-target="panel-title"]`，Panel 用）：左边是选择器（Panel / 右栏为 `role="tablist"` 的标签带，主侧栏为图标 + 标题），右边是动作区（上提的 View 动作、框架动作、容器动作、Panel 的 32px 收起按钮）。动作区是确定的盒子（`flex: 1 1 0`），不随自身内容变化。
- 内容区：活动容器有一个挂载目标（`[data-container-mount]`），ViewHost 被 Teleport 到这里；没有容器时保留 `[data-workbench-part-empty]` 整区落点。
- Part 包装带 `[data-workbench-part="left|right|panel"]`；头部固定高度，内容吃满剩余。
- 头部宽度不足时标签带横向滚动、动作区先折按钮（`WorkbenchTitleActions` 的折叠），不换行、不溢出。

## 交互

- **选择**：点标签（或键盘 Tab + Enter）回传 `select-container`；重复点当前项由页面决定（活动栏重开、不切换成 null 一类规则不在组件里）。
- **拖动容器**：标签 / 标题整块是可拖面（`[data-workbench-drag-kind="container"]`），鼠标 / 笔 6px、触摸按住 200ms 起拖；拖动激活后同一次手势末尾的 click 被抑制，所以拖完不会顺带选中。
- **落点**：Panel/right 的 selector 条目和带空白接收插入，空 selector 仍保留可见尺寸；left 头部始终只作为拖动源，插入入口在 Activity Bar。空 Part 按 `presentation.containers.length === 0` 求值，正文整区与 Switcher 分别接收两类源。View 投这两处均自动创建容器，容器投这两处整体搬入；动作区不接收。
- **菜单**：容器动作组里，本组件按切片的 `containerMoveTargets` 补一条「移动到」子菜单（选中回传 `move-container`）；其余容器动作（恢复默认位置一类）由页面以已求值项传入（经 `title-action` 回传容器 target）。`single` 时上提的 View 动作组同样按切片的 `moveTargets` 补一条「移动到」（选中回传 `move-view`）。
- **Panel 收起**：`[data-panel-collapse-toggle]` 回传 `panel-collapse` 的反值（32px 标题头；高度轴上的拖收起由尺寸记录那条路走）。

## 数据

```ts
type Props = {
    /** 本 Part 的容器切片（容器清单 + 活动容器 + 诊断）；必填。 */
    presentation: PartContainerPresentation;
    /** Panel 的 32px 标题头收起偏好（只有 Panel Part 用）；缺省 false。 */
    panelCollapsed?: boolean;
    /** 会话与几何键（随移动作交给会话）；缺省空串。 */
    /** 标题动作菜单的失效指纹（面板状态 / 首 View / 模板 / 代际），缺省空串。 */
    actionsContextKey?: string;
    /** 已求值的 View 标题动作（按 viewId 索引）：`single` 时上提那唯一 View 的动作；缺省空。 */
    actionsByView?: WorkbenchTitleActionsByView;
    /** 上提的 View 动作组的无障碍名称；缺省空。 */
    viewActionsLabel?: string;
    /** 上提的「移动到」子菜单的可达名称；缺省「移动到」。 */
    moveViewLabel?: string;
    /** 已求值的框架层标题动作（位置 / 对齐 / 收起 / 最大化 / 隐藏）；缺省空。 */
    panelActions?: WorkbenchTitleActionItems;
    /** 框架动作的无障碍名称；缺省空。 */
    panelActionsLabel?: string;
    /** Panel 收起按钮的可达名称；缺省空。 */
    panelCollapseLabel?: string;
    /** 已求值的容器动作（恢复默认位置一类）；缺省空。 */
    containerActions?: WorkbenchTitleActionItems;
    /** 容器动作的无障碍名称；缺省空。 */
    containerActionsLabel?: string;
    /** 「移动到」子菜单的可达名称；缺省空。 */
    moveContainerLabel?: string;
    /** 是否允许移动容器（拖动源与落点共用）；缺省 false。 */
    allowContainerMove?: boolean;
    /** 是否允许移动 View（Switcher 自动建容器／空正文接收／上提移动菜单）；缺省 false。 */
    allowViewMove?: boolean;
    /** 没有任何容器时的空态说明；有缺省中文文案。 */
    emptyText?: string;
};

type Emits = {
    /** 选中某个容器（标签点击）。 */
    (e: "select-container", containerId: string): void;
    /** 容器移动到别的落位；参数形状就是 `ContainerMoveRequest`（菜单来源不含 `beforeContainerId`）。 */
    (e: "move-container", request: ContainerMoveRequest): void;
    /** View 移动到别的容器：上提动作里的「移动到」子菜单（`single`）发出的就是它。 */
    (e: "move-view", request: ViewMoveRequest): void;
    /** 标题动作点击：框架动作是 `{scope:"panel"}`，容器动作是 `{scope:"container", target:{containerId}}`，上提的 View 动作是 `{scope:"view", target:{viewId,generation}}`。 */
    (e: "title-action", payload: WorkbenchTitleActionEvent): void;
    /** Panel 的 32px 标题头收起偏好取反。 */
    (e: "panel-collapse", payload: {collapsed: boolean}): void;
};
```

- **slots**：没有可用插槽。
- **attrs 透传**：不承诺。
- **expose**：没有。

## 状态与失败可见

- 切片里的 `problems` 按行显示在头部下方（不静默）。
- 一个容器都没有：正文显示“将视图拖动到此处显示”并登记 `workbench-part-empty-target`，接收 View 或容器；Panel/right 空标签带与 left 空活动栏主入口组保留第二个插入入口。
- 最后一个实际成员离开后容器退出导航和常驻宿主；隐藏或条件暂不可见的成员仍计入归属，不能误判为空。
- 活动容器 id 在切片里求不出（记录里的选择无效）：切片已经回落到第一项，组件按切片渲染。
- `single` 但该 View 既没有已求值动作、又不可移动：上提的动作组整组不渲染（不留空盒子）。
- 菜单失效指纹一变（切换工作面 / 容器 / 首 View / 模板 / 代际）就关掉已打开的菜单，不让残留项继续指向旧状态。

## 不支持

- 不自己解析记录、不写存储、不执行命令。
- 不做容器显隐（`hiddenSidebars` 归外壳的环境遮罩与命令）、不做面板位置/对齐（框架动作由页面求值）。

## 注意事项

- `containerMoveTargets` 给的是**落位**（位置 + 落位所属 Part + 标题），不是「某个容器」；菜单项回传时按 id 反查切片里的落点，不猜字面量。
- 上提的「移动到」子菜单用 `WorkbenchViewSection` 导出的同一份 id 词汇与构造器（`viewMoveSubmenu` / `VIEW_MOVE_ITEM_PREFIX`）：`multiple` 在 Section 标题上、`single` 在容器右上角，两处回传的都是 `move-view`，移动的语义不因入口不同而变。
- 当前标题按 `activeContainer.containerId` 设置 key，与标签列表保持相同身份边界；切换容器时重建标题的 dnd-kit 实体，避免实体 id 变化后注册键仍指向旧容器。标题不接收任何源，这个 key 只服务**拖动**实体身份（切换后整块新标题就是新活动容器的拖动面）。只重建标题，业务 View 实例仍由实例层保留。

