---
标签: [state:local]
别名: ["移动到", "Move View Menu"]
---

# WorkbenchMoveViewMenu

视图的“移动到”菜单：一个图标按钮，打开后一层平铺地按 Part 分段列出可以移入的已有容器（每项右侧注明所在 Part，段间有分隔线），每段末尾是“新建容器（在 X）”，视图不在默认位置时末尾多一项“重置位置”（[`ui/workbench-shell.md`](../../../../../../../docs/specs/ui/workbench-shell.md) 输出 24）。它和普通下拉菜单的不同在于**菜单目标身份**：打开时记下视图与来源容器，`identity` 一变（视图被别处移走、容器切了模式、视图换了代际）就立即关闭；选择发出的始终是打开时记下的来源，所以过期的点击由命令按来源核对后拒绝，不会把视图从新位置盲搬走。

multiple 时放在视图标题的动作区，single 时由宿主上提到容器标题行或标签带旁；两处是同一个组件。

## 交互

- 点按钮打开菜单；每个目标容器一项（图标、标题，右侧是所在 Part），每段末尾一项“新建容器（在 X）”。不用级联子菜单：子菜单浮层对菜单原语是“外部”，真实浏览器里指针点进去会先关掉整个菜单。没有任何目标且不能重置时按钮禁用。
- 选一个容器发带 `targetContainerId` 的 `move`，选“新建容器（在 X）”发带 `newContainerIn` 的 `move`，选“重置位置”发 `reset`；菜单随即关闭，焦点回到按钮（nb-ui Dropdown 的行为）。Escape 与点外关闭同样把焦点还给按钮。
- 菜单开着时 `identity` 变化：菜单关闭，不发任何事件。

## 数据

```ts
type MoveTarget = {
    /** 目标容器 id。 */
    id: string;
    /** 容器标题（已按当前语言取好）。 */
    label: string;
    icon: string;
};

type MoveTargetGroup = {
    /** 这一段对应的 Part id；“新建容器”一项原样放进 `newContainerIn`。 */
    part: string;
    /** Part 的名称（已按当前语言取好），显示在这一段每一项的右侧。 */
    label: string;
    /** 可以为空：这一段只剩“新建容器”。 */
    targets: ReadonlyArray<MoveTarget>;
    /** “新建容器（在 X）”的文字（已按当前语言取好）。 */
    createLabel: string;
};

type Props = {
    /** 按钮的可访问名称与悬停提示，例如“移动到”。 */
    label: string;
    viewId: string;
    /** 视图此刻所在的容器；打开菜单时记下，`move` 原样带回。 */
    sourceContainerId: string;
    /** 受控。 */
    groups: ReadonlyArray<MoveTargetGroup>;
    /** “重置位置”的文字；视图已在默认位置时为 null，不显示这一项。 */
    resetLabel: string | null;
    /** 菜单目标身份；变化即关闭已打开的菜单。宿主用视图、来源容器、容器模式、交付状态与视图代际拼出它。 */
    identity: string;
};

type Emits = {
    (event: "move", payload: {viewId: string; sourceContainerId: string} & ({targetContainerId: string} | {newContainerIn: string})): void;
    (event: "reset", viewId: string): void;
};
```

没有 slot、没有 expose；attrs 落在触发按钮外的 Dropdown 根上。

## 状态

- 内部只记“菜单开着”与打开时的视图、来源容器，组件销毁即丢。
- 没有任何段也不能重置：按钮禁用。

## 不支持

不执行命令、不读写状态；新建容器的身份由命令生成，菜单不生成。
