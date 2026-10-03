---
标签: []
别名: ["工作台骨架", "Workbench", "Shell"]
---

# WorkbenchShellLayout

工作台外壳的**纯布局**：测量、Grid 构建、渲染、gutter 与手势结算。主页面与 Component Lab 的骨架 fixture 用的是**同一个**组件——几何、插槽生命周期、焦点策略与手势口径只有这一份实现。

它不读 Store、不读 Storage、不碰 Nuxt 页面状态，也不创建任何业务会话。它只回答两个问题：这七个 Part 现在各自落在树的哪个叶上，以及一次有效拖拽把哪一个轴改成了多少。

Editor 与工具区域的容器层级、拖拽行为表统一见 [Workbench 外壳 Spec](../../../../../docs/specs/ui/workbench-shell.md#editor-与-workbench-的容器层级)。Tab／View 移动由宿主组织，不改变本组件的纯布局职责；Lab 拖拽演示也不表示布局组件拥有业务状态。

## 与 `WorkbenchShell` 的分工

| | `WorkbenchShellLayout`（本组件） | `WorkbenchShell` |
|---|---|---|
| 它是什么 | 纯布局与手势结算 | 产品接线 |
| 读什么 | 受控 props（尺寸偏好、Panel 状态、上下文键） | Storage（`workbench.layout/*`、`workbench.views/customizations`）、工作面事实、通知 |
| 写什么 | 只发事件，不写任何持久化 | 经会话提交补丁、失败重试 / 放弃、迁移状态 |
| 谁用 | 主页面、Component Lab 的 `WorkbenchShellLayoutFixture` | 主页面 |

结论：**要验证几何与手势，挂本组件**；`WorkbenchShell` 不可直接挂载（原因见其同名文档）。Lab 里对应的是无业务骨架 fixture——真实 Grid、真实 sash、真实命令，只把内容换成空白演示 View。

## 受控合同

```ts
type Props = {
    /** 四个绝对尺寸偏好：左 / 右栏宽、Panel 高、Panel 宽。 */
    sizes: ShellSizePreferences;
    /** 保存的 Panel 状态 + 宿主内存里的瞬时最大化。 */
    panel: WorkbenchPanelState;   // {position, alignment, hidden, collapsed, maximized}
    /** 工作面或 fixture 场景代际：手势跨代不结算，宿主也据此丢弃过期回执。 */
    contextKey: string;
    /** 只接受 titlebar / activity / left / right；Panel 显隐走 `panel.hidden`。 */
    hiddenParts?: readonly string[];
    /** 禁用交互（拖动、键盘调整都不落账）。 */
    disabled?: boolean;
};

type Emits = {
    /** **只在有效用户手势结束时发一次**，补丁只含真正变化的轴。 */
    (event: "resize", payload: {contextKey: string; patch: ShellSizePatch}): void;
    /** 呈现事实：容器尺寸、模式、**生效的** Panel 状态与诊断（不是保存意图）。 */
    (event: "layout", payload: ShellLayoutFacts): void;
    /** 可观察的手势取消（Escape、上下文变化、被禁用）：不写盘，宿主要丢基线。 */
    (event: "gesture-cancel", payload: {reason: string}): void;
};
```

- **slots**：`titlebar` / `activity` / `left` / `editor` / `right` / `panel` / `statusbar`，与七个 Part 一一对应；每个槽收到 `{collapsed, effectivePanel, mode}`，其中 `collapsed` 只在 `panel` 槽为 `true`。
- **attrs**：单根透传。壳根带 `data-workbench-shell`、`data-shell-layout="split|compact"` 与 `data-layout-diagnostics`。
- **不 expose 可变 Grid 或内部偏好**：宿主要么给 props，要么听事件。

## 槽位为什么稳定

七个槽的内容由组件根下的稳定宿主**各创建一次**，再用 Teleport 搬进当前渲染树的叶落点；隐藏或最大化的 Part 落到同一壳内的 `hidden inert aria-hidden` 停放区。于是换位置、换对齐、显隐、收起、进出紧凑呈现**都不会卸载编辑区，也不会重挂工具 View**——文件树的搜索词、展开节点、局部滚动与实例内的内存状态都留得住（Lab 的 `lifetime` 场景用输入值、滚动位置、焦点与挂载计数把这条钉死）。

配套的两条实现规则：

1. 结构变化前记录原焦点节点与滚动位置；原 Part 仍可见且用户没有把焦点挪到别处时，搬完 DOM 后 `focus({preventScroll:true})` 再恢复滚动；
2. 焦点落点由**槽**提供：状态栏的「显示面板」标 `data-shell-focus-target="panel-toggle"`、Panel 标题的可聚焦节点标 `data-shell-focus-target="panel-title"`——隐藏时焦点去前者，最大化时去后者，槽没提供就落到壳根（`tabindex="-1"`）。

## 手势：只提交真正变化的轴

拖动和键盘调整走同一条路径。手势开始时捕获分支、轴向、上下文键、结构签名与容器尺寸；结束时用同一套 `gridBranchGesture` + `resizeBranch` 校验总量与基线，然后**只把直接参与、且真的变了的轴**映射成 `resize` 补丁：

- 侧栏只有直接相邻的 sash 才产生 `leftPanelWidth` / `agentPanelWidth`；嵌套分支与编辑区只是余量，从不写回偏好；
- Panel 按当前轴向写 `panelHeight`（水平位置）或 `panelWidth`（左右位置），高度与宽度互不覆盖；
- 外层分支变宽只让编辑区吸收变化，不会按比例缩放进内部侧栏的偏好；
- **交汇处的两条分界线可能被同一次按下同时激活**（Reka 在交叉点把两条手柄都记进同一次会话，两轴一起调整、各自结束）：
  两条轴各记一份基线、各自结算并各发一次 `resize`，不合并成跨记录事务，也不会因为后开始的那条丢掉先结束的那条；
- 尺寸、上下文、位置、可见性或约束一变，进行中的手势基线立即作废；Escape 与被禁用走 `gesture-cancel`；
- 同值不发保存，测量 / 恢复 / 短容器退化 / 紧凑切换**都不产生保存**。

## 紧凑与短容器

- **紧凑呈现按实际容器宽判断（`< 800`，不是 window 宽）**，因此 Lab 缩小画布就能验证：活动栏仍是主体左侧的通高列，其余主体叶纵向排布，Panel 强制底部两端对齐且没有可拖边界；返回宽屏按保存的偏好恢复。
- **高度**装不下编辑区最小值 + Panel 最小值时，先把水平 Panel 退成 32px 标题头；仍不足时编辑区取非负余量并给出诊断。
- **宽度**装不下侧栏最小值 + Panel 240 + 编辑区 120 时，左右位置临时按底部居中呈现（不写回偏好）；更窄则进入紧凑呈现。
- 所有几何保持非负且在容器内；诊断可在 `data-layout-diagnostics` 与 `layout` 事件的 `issues` 上读到。

## 相关合同

- 几何与树的形状、尺寸限值：[`app/utils/workbench/layout.ts`](../../utils/workbench/layout.ts) 与 `layout.test.ts`。
- Panel 状态取值域与最大化 / 对齐适用规则：`app/utils/workbench/panel-state.ts`。
- 产品接线与持久化边界：同目录 `WorkbenchShell.md`；拓扑与状态归属见 [`docs/specs/ui/workbench-shell.md`](../../../../docs/specs/ui/workbench-shell.md)。
- 可操作的无业务演示：Component Lab 的 `WorkbenchShellLayout` 条目（11 个场景，全部是内存状态）。
