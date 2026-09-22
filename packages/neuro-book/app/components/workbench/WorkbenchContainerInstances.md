---
标签: [state:local, env:portal]
别名: ["容器实例层", "Container Instances"]
验证入口: WorkbenchShellLayout
---

# WorkbenchContainerInstances

容器实例层：**每个容器恰好一个 `WorkbenchViewHost`**，靠 Teleport 在 Part 之间搬 DOM，搬不动时停在常驻 parking。

它解决的是「一个 Part 只显示一个活动容器」带来的重挂问题：活动容器一换，另一个容器的宿主如果挂在 Part 里就会跟着销毁——容器自己的 Grid 尺寸意图、折叠状态与手势基线都会丢。所以宿主活在这一层，只把那一段 DOM 搬进 Part 的挂载目标。

它是 `WorkbenchViewInstances` 在容器层上的同构物（那一层管 View 实例，这一层管容器宿主），两层 parking 都不重复挂业务实例。

## 布局

- 根模板只有两样东西：每个容器一个 `<Teleport>`，以及一块常驻的 parking（`[data-container-parking]`，`hidden inert aria-hidden`，不占尺寸、不进键盘与可访问树），里面每个 containerId 一个稳定的 `[data-container-parking-target]` 元素；再加一个默认插槽。
- 宿主渲染在默认插槽里（三个 Part 宿主都在它的子树里），挂载目标登记走 provide 的通道；`390×844` 下结构与上面相同（本层不参与布局）。

## 交互

- 没有可以直接操作的元素：它只做「把实例搬到目标」这一件事。容器选择、拖动、折叠都在 Part 宿主与 View 宿主里。
- 目标消失（活动容器被换走、Part 卸载）时实例先停到 parking，不销毁、也不留在已经断开的旧元素里；新目标登记后再搬回去。

## 数据

```ts
type Props = {
    /**
     * **常驻**容器的求值切片（`presentation.residentContainers`）：每个容器一个 ViewHost；必填。
     *
     * 传入全部可落位且实际有成员的容器；隐藏成员仍计入，未活动容器停在 parking。
     * 实际成员归零后容器退出 resident；View 实例由上层保持，本层不自行过滤。
     */
    containers: readonly ContainerViewPresentation[];
    /** 全部 View 的两轴尺寸意图与收起位（原样转交给每个 ViewHost）；缺省空。 */
    viewSizes?: Readonly<Record<string, {readonly width?: number; readonly height?: number; readonly collapsed?: boolean}>>;
    /** 会话与几何键（原样转交）；缺省空串。 */
    contextKey?: string;
    /** 标题动作菜单的失效指纹（原样转交，与 `contextKey` 分开）；缺省空串。 */
    actionsContextKey?: string;
    /** 已求值的 View 标题动作（原样转交）；缺省空。 */
    actionsByView?: WorkbenchTitleActionsByView;
    /** 是否允许移动 View（原样转交）；缺省 false。 */
    allowViewMove?: boolean;
    /** 「移动到」子菜单的可达名称（原样转交）；缺省空。 */
    moveLabel?: string;
    /** View 动作组的无障碍名称（原样转交）；缺省空。 */
    viewActionsLabel?: string;
};

type Emits = {
    /** 由内部 ViewHost 转发的 View 移动意图。 */
    (e: "move-view", request: ViewMoveRequest): void;
    /** 由内部 ViewHost 转发的一批尺寸/折叠意图（含发起时容器的生效落位）。 */
    (e: "view-sizes", payload: WorkbenchViewSizesEvent): void;
    /** 由内部 ViewHost 转发的 View 标题动作点击。 */
    (e: "title-action", payload: WorkbenchViewTitleActionEvent): void;
};
```

- 另外 **provide** 一份 `CONTAINER_TARGET_REGISTRY`（`register` / `unregister`，按元素身份反登记），供 `WorkbenchPartHost` 登记挂载目标。
- **slots**：默认插槽（Part 宿主渲染在这里，否则实例没有地方可搬）。
- **attrs 透传**：不承诺。
- **expose**：没有。

## 状态与失败可见

- 容器从求值结果里消失才释放实例与目标；目标暂时缺失走 parking（实例保留其 Grid 状态、尺寸意图与手势基线）。
- 容器只要有切片就有宿主（未活动、Part 被隐藏、被导航过滤时停在 parking）：这是「实例活过重排」的前提，不做懒承载。
- 每个容器的宿主以 `containerId` 为 key：模式（`empty` / `single` / `multiple`）与方向变化不重建实例。

## 不支持

- 不自己求值容器切片、不读存储、不认识命令。
- 不做容器选择与显隐（归外壳与 Part 宿主）。
- 不复制 View 实例与业务工厂机制（那是 `WorkbenchViewInstances` 的职责，本层只承载容器宿主）。

## 注意事项

- **Teleport 目标发布**：Part 登记挂载目标时立即切换到仍连接文档的元素，反登记时立即切到 parking；`nextTick` 只负责合并渲染后的最终目标。目标 `isConnected` 为 false 时，即使旧 Element 仍可被 JS 引用，也应使用 parking。
- 反登记按**元素身份**比对：旧宿主清理时不能删掉新宿主刚登记的同 id 目标。目标暂时缺失时，业务宿主仍保留在常驻 parking，不出现无目标 Teleport 窗口。测试挂载根连接至 `document.body`，使 jsdom 测到与浏览器相同的连接性合同。

## 隐藏通道理由

- `env:portal`（Teleport）：目标位置是 Part 宿主登记的挂载元素；目标不存在（例如 Part 被环境隐藏、活动容器被换走）时发布 parking 目标，实例留在 parking 里不销毁。之所以必须由本层做，是因为「实例要活过 Part 重排」这件事只能在 Part 之外成立，而页面无法自己维护 containerId → Element 的表（三处 Part 各建一份就会分裂实例）。
