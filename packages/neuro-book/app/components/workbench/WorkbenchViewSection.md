---
标签: [state:local, state:inject]
别名: ["View 区段", "View Section"]
验证入口: WorkbenchShellLayout
---

# WorkbenchViewSection

> View 标题只是拖动 View 的手柄。方向、50% 命中和半区反馈以[规格](../../../../../docs/specs/ui/workbench-shell.md#方向命中与反馈范围)为准。

容器内部**一个 View 的一行**：Section 标题（图标 + 标题 + 折叠按钮 + 动作组）+ 内容落点，作为 Grid 叶的内容。

标题整条是 View 的拖动面，载荷交给页面会话；本组件不登记独立落点。WorkbenchViewHost 按可见叶沿目标轴前后各 50% 求插入位，中点归后半，反馈为对应半区；非法方向禁投且无反馈。同容器边缘移动只改变顺序。

尺寸由外层 Grid 决定（收起时叶的主轴占位就是标题那一份），本组件不写死自身尺寸，也不持有折叠状态：收起位从 Grid 叶的 `collapse` 读，样式与 `[data-collapsed]` 跟着它走。

三种呈现都由**容器切片**的事实给，本组件不求值、不猜：

| 切片事实 | 呈现 |
|---|---|
| `viewMode === "multiple"` | 32px 标题（图标 + 标题 + 折叠 + 动作组） |
| `viewMode === "single"` | **不渲染标题**：内容直接吃满叶；这个 View 的动作由 `WorkbenchPartHost` 投射到容器右上角 |
| 收起 + `orientation === "horizontal"` | 32px 宽的**竖条**：展开按钮 + 图标 + `sr-only` 完整名称 + 「更多」菜单（`primary` 动作折进菜单） |

## 布局

- 单根 `<section>`（`[data-section]`、`[data-view-id]`，另带 `[data-container-mode]` / `[data-section-orientation]` / `[data-strip]` 供 Lab 与冒烟定位）：标题固定 32px（`--workbench-view-section-header`，与 Grid 收起叶的 `collapsedSize` 同源），内容区吃剩余主轴空间并按 View 的 `layout` 合同滚动（`scroll`）或交给视图（`fill`）。
- 收起时内容区 `display: none`（只留标题那一份占位），内容里的实例仍在（实例由 `WorkbenchViewInstances` 独占）。
- 标题用 `flex`：折叠按钮占满标题左侧（它既是键盘入口也是拖动点），动作组靠右；竖条里两者改竖排。
- 标题与内容两个子节点各带 key：`single` 不渲染标题时，内容落点仍是**同一个 DOM 节点**（实例的 Teleport 目标与业务滚动位置不因模式变化被重建）。

## 交互

- **折叠**：点标题按钮（或 Tab + Enter/Space）回传 `toggle(viewId, next)`，`aria-expanded` 与 `aria-controls` 指向内容区。`single` 不渲染这个入口（也不注册拖动源），已有的收起意图由记录保留、由投影忽略。
- **展开**：竖条上的展开按钮回传 `toggle(viewId, false)`；名称用 `sr-only` 保持在可访问树里，完整名称同时进 `title` 提示（长标题不硬塞进 32px）。
- **拖动**：整条标题是拖动源（`[data-workbench-drag-kind="view"]`）；鼠标 / 笔移动 6px、触摸按住 200ms 起拖。激活后同一次手势末尾的 click 在标题的捕获阶段被抑制（不会顺带折叠）；Escape 取消不产生任何改变。
- **插入位**：由容器内容区统一判定；源叶参与测量且源标题保持原位与不透明度。内容中央及源叶本身不提交；边缘移动通过宿主一次原子请求接纳归属、顺序和半区尺寸。
- **动作**：View 自己的动作（`primary` 直接成按钮、`secondary` 收进「更多」）加上本组件按切片补的「移动到」子菜单（`viewMoveSubmenu`，与 `single` 在 Part 宿主上的那一份同源）；点击回传 `invoke` 的目标（菜单项回传渲染时捕获的世代）。

## 数据

```ts
type Props = {
    /** Grid 叶：`ref` 是求值后的 `WorkbenchViewEntry`，`collapse.collapsed` 是当前收起位；必填。 */
    leaf: GridLeaf<unknown>;
    /** 承载这个 View 的容器 id（落点 id 与移动请求的来源）；必填。 */
    containerId: string;
    /** 已求值的 View 标题动作，按 viewId 索引；必填。 */
    actionsByView: WorkbenchTitleActionsByView;
    /** 标题动作菜单的失效指纹（工作面 / 首 View / 代际）；**不是**会话与几何键。必填。 */
    actionsContextKey: string;
    /** 容器内部方向（来自容器切片）；必填。 */
    orientation: GridOrientation;
    /** 容器的呈现模板（来自容器切片）；必填。 */
    viewMode: ViewContainerMode;
    /** 是否允许移动 View（拖动与菜单共用）；必填。 */
    allowViewMove: boolean;
    /** 可投递的落点（容器切片给的、不含自己）；必填。 */
    moveTargets: readonly ViewMoveTarget[];
    /** 「移动到」子菜单的可达名称；必填。 */
    moveLabel: string;
    /** 动作组的无障碍名称；必填。 */
    viewActionsLabel: string;
};

type Emits = {
    /** 选中「移动到」的某个落点（追加到该容器末尾）。 */
    (e: "move-view", request: ViewMoveRequest): void;
    /** View 标题动作点击。 */
    (e: "title-action", payload: {scope: "view"; target: ViewActionTarget; actionId: string}): void;
    /** 折叠 / 展开按钮：只回传这一个 View 的收起意图。 */
    (e: "toggle", viewId: string, collapsed: boolean): void;
};
```

- **slots**：没有可用插槽（内容由实例层 Teleport 进 `[data-view]` 落点）。
- **attrs 透传**：不承诺。
- **expose**：没有。
- 另外导出 `WORKBENCH_VIEW_SECTION_HEADER_PX`（32：标题占用，也是 Grid 收起叶 `collapsedSize` 的来源）、`VIEW_MOVE_MENU_ITEM_ID`、`VIEW_MOVE_ITEM_PREFIX` 与 `viewMoveSubmenu()`：`single` 在 `WorkbenchPartHost` 上的「移动到」与这里用同一份 id 词汇与同一个回传形状。

## 状态与失败可见

- 叶的 `ref` 不是求值条目（不该发生）：不渲染，也不猜一个空壳出来。
- 不可移动（宿主没开或 `canMoveView !== true`）：不登记拖动源，「移动到」子菜单也不给。
- 动作组没有已求值动作：整组不渲染（不留空盒子）。

## 不支持

- 不做位置移动、不排序、不写存储。
- 不自己持有折叠状态（受控件来自 Grid 叶）。
- 不做 View 内滚动策略以外的排版（`layout` 合同归 descriptor）。
