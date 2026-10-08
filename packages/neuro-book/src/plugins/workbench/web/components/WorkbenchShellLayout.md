---
标签: [state:local, env:portal]
别名: ["工作台骨架", "外壳布局", "Workbench Shell", "Shell Layout"]
---

# WorkbenchShellLayout

工作台外壳的纯布局：测量承载盒、按位置与对齐建网格、渲染七个 Part、把一次有效的拖动结算成尺寸补丁，并发布呈现事实。产品外壳 `WorkbenchShell` 与 Lab 场景用的是同一个组件，几何、Part 内容的寿命、焦点策略与手势只有这一份实现。行为合同见 [`ui/workbench-shell.md`](../../../../../../../docs/specs/ui/workbench-shell.md) 外壳一。

它不读 store、不读 Storage，也不执行命令：尺寸与面板状态从 props 进来，用户的调整以事件交出去，由宿主决定保存。

## 布局

七个 Part：标题栏在顶（36px），状态栏在底（22px），ActivityBar 是主体左侧的通高列（60px：卡片 48px 加两侧 6px 留白，留白由本组件加在叶上），主体里的侧栏、右栏、编辑器与面板按面板的位置与对齐排布（树形见 `shell/layout.ts` 开头的表）。编辑器吸收余量；装不下时按 Spec 输出 5 降级。外壳容器宽 < 800 时为紧凑呈现：ActivityBar 仍在左侧，其余 Part 在它右侧纵向排布，没有可拖边界。

承载盒是组件根本身：父级要给它确定的宽高，根上不加 padding、border（测量按布局盒，混进去会少算）。

## 交互

- 拖动边界：边界在流内占 1px，命中区更宽；拖过最小或最大值停在边界。松手一次落账，组件按这次提交发出一个 `resize`；从拖到零的边界拉回时跟随指针。
- 键盘：边界可聚焦，方向键 10px、Shift 1px、Home/End 到端点、Enter 收起或恢复相邻可拖到零的 Part。Escape、pointercancel、失焦、容器尺寸或 `contextKey` 变化取消整场手势，不发 `resize`。
- 焦点与滚动：结构变化（换位置、对齐、隐藏、最大化、紧凑往返）时，Part 内容在落点之间搬动，搬完后还原 Part 内容里所有元素的滚动位置，并恢复原焦点；焦点所在内容被停放时，隐藏面板把焦点交给 `data-shell-focus-target="panel-toggle"`，最大化交给 `data-shell-focus-target="panel-title"`（这两个标记由插槽内容提供，找不到时落到组件根）。焦点已在外壳之外（菜单、对话框）时不动。
- `disabled` 为 true 时边界不能拖动、键盘不能调整，进行中的手势取消。

## 数据

```ts
type Props = {
    /** 四个尺寸偏好（侧栏宽、右栏宽、面板高、面板宽，CSS px）。受控。 */
    sizes: ShellSizePreferences;
    /** 面板保存的位置、对齐、隐藏、收起，加上只在内存的最大化。受控。 */
    panel: PanelState;
    /** 手势所属的上下文；变化时取消进行中的手势，`resize` 带回它，宿主据此丢弃过期的补丁。 */
    contextKey: string;
    /** 隐藏的 Part（titlebar、activitybar、sidebar、auxiliarybar），默认无。 */
    hiddenParts?: ReadonlyArray<ShellHideablePart>;
    /** 拖到零的 Part（sidebar、auxiliarybar、panel），默认无。 */
    dragCollapsedParts?: ShellDragCollapseMap;
    /** 禁止调整尺寸，默认 false；宿主在布局记录读完之前给 true。 */
    disabled?: boolean;
};

type Emits = {
    /** 一次有效手势落账后发一次；补丁只含真正变化的可保存叶，拖到零只写布尔位，不写 0。 */
    (event: "resize", payload: {contextKey: string; patch: ShellSizePatch}): void;
    /** 呈现事实变化时发出（测得容器尺寸之后）：模式、生效的面板状态与降级诊断。不是保存意图。 */
    (event: "layout", facts: ShellLayoutFacts): void;
};

type Slots = {
    titlebar(props: PartSlotProps): unknown;
    activitybar(props: PartSlotProps): unknown;
    sidebar(props: PartSlotProps): unknown;
    editor(props: PartSlotProps): unknown;
    auxiliarybar(props: PartSlotProps): unknown;
    panel(props: PartSlotProps): unknown;
    statusbar(props: PartSlotProps): unknown;
};

type PartSlotProps = {
    /** 只有 panel 槽会是 true：面板此刻呈现为 32px 标题头（保存的收起，或高度不足时的降级）。 */
    collapsed: boolean;
    effectivePanel: ShellEffectivePanel;
    mode: "split" | "compact";
};
```

- 不 expose。attrs 落在组件根上；根带 `data-workbench-shell`、`data-shell-layout="split|compact"` 与 `data-layout-diagnostics`（最近几条降级与手势诊断）。
- 手势结算：落账前整批核对（含不产生保存的分支则整场拒绝），经 nb-ui `useGridLayout` 一次 `resizeBranches`；落账后从这批提交算出补丁。交汇处的两根轴属于同一场手势，补丁里可能同时有侧栏宽度与面板高度。

## 状态

- 测得容器尺寸之前（未挂载）：按 0×0 投影、不发 `layout`，边界不可拖。
- 紧凑：没有可拖边界；面板按底部两端对齐呈现；保存的偏好不变。
- 隐藏的 Part 与最大化时被挤走的 Part：内容在本组件内的停放区（`hidden inert aria-hidden`），不卸载。

## 不支持

- 不保存任何东西，不读写 store 与 Storage；不知道 Part 里放的是什么。
- 不提供面板框架按钮、状态栏条目与标题栏内容：都由插槽给。
- 视图容器、Switcher 与拖放（外壳二、三）。

## 隐藏通道理由

- `env:portal`：七个 Part 的内容由组件根下的稳定宿主各渲染一次，再用 Teleport 搬到当前网格里同名 Part 的叶落点（`[data-leaf="<part>"]`）；落点不存在（Part 被隐藏、最大化挤走、刚换了树还没渲染）时内容留在组件内的停放区。这样换位置、对齐、隐藏、紧凑往返都不卸载编辑器与工具内容，这是外壳的核心承诺，所以由本组件拥有，不交给父级。落点都在本组件自己的子树里，不碰外部节点。
- `state:local`：测得的容器尺寸、当前网格与落点表、手势诊断与焦点记忆，只活在本实例里。
