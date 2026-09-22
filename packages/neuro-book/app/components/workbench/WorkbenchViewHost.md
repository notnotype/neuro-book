---
标签: [state:local, state:inject]
别名: ["容器内部宿主", "View Host"]
验证入口: WorkbenchShellLayout
---

# WorkbenchViewHost

> 半区分配及来源比例以[规格](../../../../../docs/specs/ui/workbench-shell.md#半区分配与来源比例)为准。展开窗格前后各 50%，中点归后半；全部收起时剩余区域接收。

容器的**内部**宿主：把一份**已求值**的容器切片渲染成一条**单轴** Grid——每个可见 View 一个 Section，Section 之间用与外壳、编辑器同一套 Grid/Splitter 拖动分界。

内部方向由容器切片的 `orientation` 给：左侧栏 / 右侧栏是 `vertical`（上下排、按 `height` 分），Panel 是 `horizontal`（左右排、按 `width` 分，与 Panel 外壳停靠在顶部还是底部无关）。容器**换 Part 就换轴**，但保存的两轴意图不换算数值。

呈现模板由切片的 `mode` 给（按**可见**成员数求值）：

| `mode` | 呈现 |
|---|---|
| `empty` | 空态（说明来自 `hidden` 的 `when` 原因），不建树 |
| `single` | 一个叶填满内容区、不装收起策略；Section **不渲染标题**，该 View 的动作由 `WorkbenchPartHost` 投射到容器右上角 |
| `multiple` | 每个 View 一条 32px 标题（多条时才有缝）；横向容器里收起是 32px 宽的竖条，纵向仍是横标题 |

它替代了旧的「Panel 标签页 / 侧栏 Section」两套模板：位置无关，左栏、右栏、底部都由它渲染；容器自己的标题、选择与框架动作归 `WorkbenchPartHost`。视图实例不在这里——落点登记给 `WorkbenchViewInstances`，业务实例由那一层 Teleport 进来。

组件**不做**位置求值、不读存储、不认识命令：尺寸与折叠意图只经 emits 交回页面（唯一写者是位置会话），页面把补丁交给 `setViewSizes`。

## 分工：谁求值、谁解析、谁实例化

| 角色 | 归属 |
|---|---|
| 容器落位、View 位置、可见性、动作可用性、落点清单、内部方向与模板 | 页面调用 `resolveViewPresentation`，把 `ContainerViewPresentation` 传进来 |
| 单轴树（叶 id、主轴意图与约束、收起策略） | 纯投影 `view-container-layout.ts`（`viewContainerGridInput`） |
| View 标题解析（i18n） | 页面（切片里的 `title` 已解析） |
| 承载盒测量与布局/版本发布 | nb-ui `useLayoutExtent` + `useGridLayout`（本组件只装配） |
| 尺寸与折叠意图 | 本组件按切片建树；意图存 `viewSizes`（页面传入，两轴独立），改动经 `view-sizes` 回传 |
| 标题动作 | 页面求值（`useWorkbenchViewActions().actionsByView`）后传入；点击经 `title-action` 回传 |
| 内容组件实例 | `WorkbenchViewInstances`（本组件只画 `[data-view]` 落点） |
| 容器挂载位置 | `WorkbenchPartHost` + `WorkbenchContainerInstances`（本组件被 Teleport 进去） |

## 布局

- 根元素 `[data-container-id]` 是容器内容区：诊断行（`problems`、实例通道缺失）在上，Grid 吃满剩余高度。整个内容区统一登记一个落点，插入位由可见叶几何求得。根元素带 `[data-container-mode]` 与 `[data-container-orientation]`（都来自切片，供 Lab 与冒烟定位）。
- 每个 Grid 叶是一条 `WorkbenchViewSection`：`multiple` 时是 32px 标题（图标 + 标题 + 折叠按钮 + 动作组），`single` 时**没有标题**、内容直接吃满叶；内容区按 View 的 `layout` 合同滚动或留白。
- 叶与分支 id 带前缀：叶 `view:<viewId>`、分支 `container:<containerId>`，与外壳的七个叶 id 不混用；叶包装同时带 `[data-leaf="view:<viewId>"]`。
- 容器内**全部可见 View 同屏排列**（左/右栏上下排、Panel 左右排），没有「单活动 View」的替代页签模式；容器里没有可见 View 时显示空态（原因来自 `when` 的求值）。
- 尺寸由外层 Part 决定；本组件不设最小宽度，`390×844` 下由外壳切紧凑呈现。内容自己的最小/最大尺寸由 descriptor 的 `minimumSize` / `maximumSize` 声明，主轴有效下限是 `max(33, 声明值 ?? 64)`。

## 交互

- **折叠**：点标题上的折叠按钮（`aria-expanded` 跟着受控收起位）→ 一条 `view-sizes` 补丁（只改这一个 View 的收起位，主轴尺寸意图不动，展开回到上次尺寸）。键盘 Tab 到按钮 + Enter/Space 即可。`single` 没有折叠入口：已有的 `collapsed` 意图保留在记录里但不应用，呈现为展开；回到 `multiple` 才再次生效。
- **横向竖条**：`horizontal` 且收起时标题是一条 32px 宽的竖条（展开按钮 + 图标 + `sr-only` 的完整名称 + 「更多」菜单），`primary` 动作折进菜单；点展开按钮回传 `{collapsed: false}`。
- **拖动**：整条标题是 View 的拖动面（`[data-workbench-drag-kind="view"]`），鼠标 / 笔移动 6px、触摸按住 200ms 起拖；拖动激活后同一次手势末尾的 click 被抑制，所以拖动不会顺带折叠。Escape 取消拖动不产生任何改变。`single` 不注册这个拖动源（没有标题，也避免一个元素注册两个源）。拖动中标题保持原位与不透明度：跟指针走的是页面唯一的 `WorkbenchDragOverlay`，源不隐藏、不改矩形，也不生成 placeholder。
- **键盘拖动**：聚焦可拖标题外层，Space 起拖、方向键移动、Escape 取消。逐源复用宿主传感器，不覆盖宿主的 KeyboardSensor；标题内部折叠按钮保留自己的 Space/Enter 行为。
- **拖动分界**：Section 之间的 1px 分界线属于本组件的 Grid 会话；一次手势（含收吸附）只结算一批，收吸附只改收起位、不把 0 / 32 写进尺寸记录。
- **移动**：`multiple` 的 View 标题提供移动菜单和拖动手柄，`single` 的菜单上提到 Part 宿主。拖到内容边缘会并入容器并分配命中叶半区；拖到 Switcher 插入位会创建容器。Section 不登记独立落点。

## 数据

```ts
type Props = {
    /** 本容器的求值切片（位置 + 可见性 + 动作可用性 + 落点 + 方向 + 模板）；必填。 */
    presentation: ContainerViewPresentation;
    /**
     * 全部 View 的尺寸与收起意图（user/local 共用，按 viewId 索引）；缺省空。
     *
     * 两轴独立：只写当前主轴（左/右栏是 `height`，Panel 是 `width`），另一轴与未知字段原样保留。
     */
    viewSizes?: Readonly<Record<string, {readonly width?: number; readonly height?: number; readonly collapsed?: boolean}>>;
    /** 会话与几何键：手势跨代不结算，随补丁交给位置会话；缺省空串。 */
    contextKey?: string;
    /** 标题动作菜单的失效指纹（面板状态 / 首 View / 代际）；与 `contextKey` 分开传，缺省空串。 */
    actionsContextKey?: string;
    /** 已求值的 View 标题动作，按 viewId 索引；缺省空。 */
    actionsByView?: WorkbenchTitleActionsByView;
    /** 是否允许移动 View（拖动与菜单共用）；缺省 false。 */
    allowViewMove?: boolean;
    /** 「移动到」子菜单的可达名称；缺省空。 */
    moveLabel?: string;
    /** View 动作组的无障碍名称；缺省空。 */
    viewActionsLabel?: string;
};

type Emits = {
    /** 选中「移动到」的某个落点；参数形状就是 `ViewMoveRequest`（不含 `beforeViewId`，追加到末尾）。 */
    (e: "move-view", request: ViewMoveRequest): void;
    /**
     * 一批尺寸/折叠意图；与位置会话的 `setViewSizes` 入参同形，可原样转发。
     *
     * `payload` 就是本组件导出的 `WorkbenchViewSizesEvent`：容器 id + **发起时容器的生效落位**
     * （容器换 Part 会换轴，迟到的批整批拒绝）+ 会话键 `contextKey` + 只带本次真正变化字段的补丁。
     * 一次手势只发一次；没有任何主动变化时不发。
     */
    (e: "view-sizes", payload: WorkbenchViewSizesEvent): void;
    /** View 标题动作点击；`target` 是渲染时捕获的世代。 */
    (e: "title-action", payload: {scope: "view"; target: ViewActionTarget; actionId: string}): void;
};
```

- **slots**：没有可用插槽（内容由实例层 Teleport 进落点）。
- **attrs 透传**：不承诺（内层结构由 Grid 决定）。
- **expose**：没有。

## 状态与失败可见

- `presentation.problems` 与手势/落点诊断（`issues`）按行显示在容器内，不静默。
- 容器里没有可见 View：显示 `when` 的求值原因（去重后以「；」连接）；没有任何原因时说明「还没有可见的视图」。
- 页面忘了把本组件放进 `WorkbenchViewInstances` 的子树：显示 `[data-view-instance-channel="missing"]` 诊断（容器照画，只是没有实例来接）。
- 手势提交被拒绝（结构失效、工作面已切换、跨代）：就地回滚到受控布局，并把原因显示出来。
- 宿主接纳了手势却没有发布匹配布局：Grid 在下一个 tick 回到受控布局并给出诊断（原语合同）。

## 不支持

- 不做位置/可见性求值、不读存储、不执行命令。
- 空 Part 的接收由 `WorkbenchPartHost` 提供，不在本组件制造容器。
- 不支持递归容器（容器里只有 View，没有子容器）。
- 不渲染容器标题与容器级框架动作（归 Part 宿主）。

## 注意事项

- `viewSizes[viewId]` 是**意图**（px，当前主轴参与分配），不是降级后的实际尺寸；窗口太小导致的夹取只影响呈现，不写回意图。补丁只带**主动改变且真正变化**的字段：被补偿出来的邻居、降级夹取与 `single` 填满宿主的测量值都不写。
- 树按切片重建：结构、模式或轴一变就换一棵 Grid 并显式 `invalidate()`，进行中的手势随即失效。承载盒测量走 `clientWidth/clientHeight`（`useLayoutExtent`），不吃祖先 `transform`；命中仍用 client 坐标 rect。
- 拖动源 id 由 `useId()` 生成，**不能**拿 `viewId` 拼：dnd-kit 的注册表按注册时的 id 建 key、卸载时按当前 id 反注册，id 一变就会留下指向旧实例的死条目，`dragstart` 会报出别处的源（见 `WorkbenchViewSection.md`）。
- 每个容器登记一个 `workbench-container-content-target:<containerId>`，几何为内容盒与可见叶 client rect。展开窗格前后各 50% 都可接收，中点归后半；预览覆盖对应半区。可见成员全部收成细条时，细条不再提供半区，预览覆盖细条后的剩余内容区，拖入成员按自己的展开尺寸进入。非法方向无反馈无提交。同容器边缘移动只换序、不改尺寸。源叶不剔除，保持真实屏幕布局；隐藏、零尺寸、裁剪和遮挡由共享 DOM reader 校验。收起细条故意留下的未吸收空间不显示为容器故障。
- `WorkbenchDropOverlay` 复用 nb-ui `DropFeedbackOverlay`，区域内缩 `min(6, size/4)`，不叠插线；Switcher 只有插入线，长轴两端内缩 `min(2, span/4)`、短轴 2px。原位容器插入可带 render-only 线，非空内容中央不显示保持布局提示。
- 文字提示独立 fixed 定位：有合法反馈且文案非空就显示图标药丸，空间不足时放到锚点外并夹紧到视口，视觉截断不影响独立 live region 的完整文案。坐标变化复用尺寸缓存，文字、字体或视口变化由观察器重测，反馈消失后解除观察。
- 身份不用 `mode` / `orientation` 作 key：模式与轴变化不重建宿主，`WorkbenchViewSection` 的拖动面与业务实例都不重挂（模式只改标题与树）。

## 上游边界

内容区的拖动/命中/会话来自 nb-ui 的 Grid 原语（`@notnotype/nb-ui/layout`），承载盒测量与宿主装配来自 `@notnotype/nb-ui/composables`：`GridRenderer` 独占一份手势会话，本组件只提供树（`useGridLayout` 发布 node / layout / revision）与同步接纳回调。一次手势的原子提交、`revision` / `contextKey` / 承载盒尺寸的三重校验与 `onIssues` 收口都在 `useGridLayout` 里，本组件只在 `onApplied` 里折补丁。阈值的默认值（`SASH_COLLAPSE_THRESHOLD`）与收起吸附行为以该原语为准，升级可能变化。
