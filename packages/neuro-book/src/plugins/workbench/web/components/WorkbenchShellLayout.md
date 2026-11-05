---
标签: [state:local, env:portal]
别名: ["工作台骨架", "外壳布局", "Workbench Shell", "Shell Layout"]
---

# WorkbenchShellLayout

工作台外壳的纯布局：测量承载盒、按位置与对齐建网格、渲染七个 Part、把一次有效的拖动结算成尺寸补丁，并发布呈现事实。产品外壳 `WorkbenchShell` 与 Lab 场景用的是同一个组件，几何、Part 内容的寿命、焦点策略与手势只有这一份实现。行为合同见 [`ui/workbench-shell.md`](../../../../../../../docs/specs/ui/workbench-shell.md) 外壳一。

它不读 store、不读 Storage，也不执行命令：尺寸与面板状态从 props 进来，用户的调整以事件交出去，由宿主决定保存。

## 布局

七个 Part：标题栏在顶（36px），状态栏在底（22px），ActivityBar 是主体左侧的通高列（48px），主体里的侧栏、右栏、编辑器与面板按面板的位置与对齐排布（树形见 `shell/layout.ts` 开头的表）。编辑器吸收余量；装不下时按 Spec 输出 5 降级。外壳容器宽 < 800 时为紧凑呈现：ActivityBar 仍在左侧，其余 Part 在它右侧纵向排布，没有可拖边界。

承载盒是组件根本身：父级要给它确定的宽高，根上不加 padding、border（测量按布局盒，混进去会少算）。

卡片还是平铺由主题变量决定（Spec 输出 38），缺省是平铺。活动栏、侧栏、编辑器、右栏与面板的内容各包在一层卡片包装（`data-shell-card`）里，包装承担圆角（`--shell-card-radius`）、裁切与投影（`--shell-card-shadow`）；包装外的插槽按 `shell/cards.ts` 算出的四边留内边距：贴着窗体、标题栏或状态栏的一边 `--shell-gap`，挨着别的部件的一边半缝减去两者之间边界占用的一半，与活动栏相连的侧栏那一边 0。活动栏与通高的侧栏相连时两张卡片相接的角为 0（`data-shell-join="start"`、`"end"`），中间画一条两端离顶底 10px 的短线（`--shell-join-divider`）。网格接缝的颜色经 nb-layout `Splitter` 的 `--nb-splitter-seam` 取 `--shell-seam`。标题栏与状态栏没有卡片包装。

## 交互

- 拖动边界：边界在流内占 1px，命中区更宽；拖过最小或最大值停在边界。松手一次落账，组件按这次提交发出一个 `resize`；从拖到零的边界拉回时跟随指针。面板与编辑器之间的边界能一直拖到编辑器的最小尺寸，再往前越过 24px 编辑器就被拖到零，即最大化，补丁里是 `panelMaximized`；最大化时这条边界仍是 1px，往回拖就还原。
- 拖动中的停放：从拖到零（或最大化下的编辑器）往外拉时，手势预览一给出尺寸，内容就从停放区搬回落点，拖的过程中看得到，同时发 `preview`；按着拖回零、取消或提交被拒时回到停放区。搬动与投影变化同一套滚动与焦点记忆。往零拖时不提前停放，等落账。卡片的相连跟着预览走：拉出的部件按有尺寸算、拖到零的按零算，松手前活动栏就与侧栏相连或分开。
- 键盘：边界可聚焦，方向键 10px、Shift 1px、Home/End 到端点、Enter 收起或恢复相邻可拖到零的 Part（编辑器的拖到零只经指针，Enter 不会因此最大化）。Escape、pointercancel、失焦、容器尺寸或 `contextKey` 变化取消整场手势，不发 `resize`。
- 焦点与滚动：结构变化（换位置、对齐、隐藏、最大化、紧凑往返）时，Part 内容在落点之间搬动，搬完后按 `memory` 还原外壳里所有可见元素的滚动位置，并恢复原焦点；焦点所在内容被停放时，隐藏面板把焦点交给 `data-shell-focus-target="panel-toggle"`，最大化交给 `data-shell-focus-target="panel-title"`（这两个标记由插槽内容提供，找不到时落到组件根）。焦点已在外壳之外（菜单、对话框）时不动。
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
    /**
     * 滚动与焦点记忆（`shell/teleport-memory.ts`）：外壳的三层 Teleport（Part、容器、视图）共用一份，任何一层搬动时
     * 都按它记录与还原。不给时自建一份；一生不换。
     */
    memory?: TeleportMemory;
};

type Emits = {
    /** 一次有效手势落账后发一次；补丁只含真正变化的可保存叶，拖到零只写布尔位，不写 0。 */
    (event: "resize", payload: {contextKey: string; patch: ShellSizePatch}): void;
    /** 呈现事实变化时发出（测得容器尺寸之后）：模式、生效的面板状态与降级诊断。不是保存意图。 */
    (event: "layout", facts: ShellLayoutFacts): void;
    /**
     * 手势预览里已经拉出来、投影里还收着的部件（拖到零的 Part、最大化下的编辑器）变化时发出；手势结束或预览撤回时发空数组。
     * 宿主据此让视图的首次加载与“可见”跟着预览走，不是保存意图。
     */
    (event: "preview", parts: ReadonlyArray<ShellPartId>): void;
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

- expose `revealZoneRects(): Array<{part: "sidebar" | "auxiliarybar" | "panel"; rect: {left, top, right, bottom}}>`：此刻没显示的侧栏、右栏、面板显示出来会在的矩形（视口坐标），拖动会话拿起时取一次当预备区（外壳三输出 20）；紧凑呈现时为空。attrs 落在组件根上；根带 `data-workbench-shell`、`data-shell-layout="split|compact"` 与 `data-layout-diagnostics`（最近几条降级与手势诊断）。
- 手势结算：落账前整批核对（含不产生保存的分支则整场拒绝），经 nb-layout `useGridLayout` 一次 `resizeBranches`；落账后从这批提交算出补丁。交汇处的两根轴属于同一场手势，补丁里可能同时有侧栏宽度与面板高度。

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
