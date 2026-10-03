---
标签: [state:inject]
别名: ["容器标签", "Container Tab"]
验证入口: WorkbenchShellLayout
---

# WorkbenchContainerTab

> 拖放行为真相源见[Workbench 拖拽行为表](../../../../../docs/specs/ui/workbench-shell.md#workbench-拖拽行为表)：View 投 Switcher 插入位创建容器，容器源整体移动；目标只画插入线。

容器的**选择单元**：Panel / 右栏的标签带里的一项（`WorkbenchPanelTab` 的视觉，只有一个容器也保留），或主侧栏（`left`）头部的可拖标题（图标 + 标题）。两种形态的选择归 `WorkbenchPartHost`：他按 Part 决定用哪一种，本组件只按 `variant` 渲染。

两种形态共用拖动通道，选择只回传 id。仅标签形态是落点；主侧栏标题只保留拖动，接收归 Activity Bar 和空正文。组件不读存储、不执行命令、不自行排序，标题与图标取已求值切片。

## 布局

- 单根 `<div>`（`[data-container-tab]`、`[data-workbench-drag-kind="container"]`）：标签形态里包一个 `WorkbenchPanelTab`，标题形态里是图标 + 标题文本（`title` 提示优先用调用方给的 `label`，没给就回落到切片标题，长名字因此仍然可读）。
- 宽度由选择器那一行决定（标签条里不换行、不撑宽），超出由父级滚动。

## 交互

- **选择**：标签形态点击回传 `select`；标题形态没有第二个可选项，不做选择动作。
- **拖动**：整块是可拖面，携带容器全部成员；鼠标 / 笔移动 6px、触摸按住 200ms 起拖，拖动激活后同一次手势末尾的 click 被抑制（拖完不会顺带选中）。
- **切换器落点**（仅标签形态）：View 与容器都投到同一个插入位。View 创建只含自身的新容器，不追加到悬停容器；容器源整体移动。锚点与插入线都来自共享的 `resolveListInsertion({edgeGap: 4})`——前一条目的后半、条目之间的间隙、后一条目的前半归到同一个插入位与同一条线；越过末条是追加。原位（锚点就是自己、或去掉自己后序位不变）照样画原位线，但释放不提交。标题形态两个落点都没有——它连候选都不是，因此不会「按住有反馈但落不下去」。

## 数据

```ts
type Props = {
    /** 容器的求值切片（标题、图标、生效落位、所属 Part 都在里面）；必填。 */
    container: ContainerViewPresentation;
    /** `tab` = 标签条里的一项（拖动 + 落点）；`title` = Part 头上的单容器标题（只拖动）。缺省 `tab`。 */
    variant?: "tab" | "title";
    /** 标签形态的选中态。缺省 false。 */
    active?: boolean;
    /** 是否允许移动容器（拖动源）；缺省 false（明确不可移动的容器不提供入口）。 */
    allowContainerMove?: boolean;
    /** 是否允许把 View 落到本容器；只在标签形态生效。缺省 false。 */
    allowViewMove?: boolean;
    /** 标题形态的 title 属性文案（可达名称由标签部件自己给）；缺省空。 */
    label?: string;
};

type Emits = {
    /** 标签形态被点选。 */
    (e: "select", containerId: string): void;
};
```

- **slots**：没有。
- **attrs 透传**：不承诺。
- **expose**：没有。

- 拖动中源条目**保持原位与不透明度**：不隐藏、不改矩形、也不生成 placeholder，跟指针走的是页面唯一的 `WorkbenchDragOverlay`（本组件自己不挂任何降透明度/位移样式）；不可移动时不登记拖动源，不出现「按住有反馈但落不下去」。
- 落点分别按来源类型声明权限，且只在标签形态声明：标题形态的 `accept` 是空数组，候选过滤直接落空。外部菜单或其它面板遮挡时拒绝；目标自己的后代仍属于目标，`data-no-drag` 不是投递禁区。非空 left 的 header 空白与标题都不接收（band 的 `accept` 为空、标题 `accept` 为空，`left:head` 几何读法给 `null`），那里只有 Activity Bar 条目接容器换序。

## 不支持

- 不执行选择/移动命令、不写存储、不排序。
- 不做关闭按钮与角标（标签形态按容器的标题与图标渲染；面板标签部件保留的那些能力在这里不用）。

## 注意事项

- 拖动源 id 由 `useWorkbenchDrag` 用 `useId()` 生成，不能用 containerId 拼（dnd-kit 的注册表按注册时的 id 建 key）。
- 标签条目登记 `workbench-switcher-target:<partId>:<kind>#<containerId>`，载荷带 `partId/location/switcherScope/viewContainerId`。两种来源统一由 `resolveWorkbenchDrop` 调用 `resolveListInsertion({edgeGap: 4})` 求插入位，View 创建容器、容器整体移动；组件不解析 id 文本。
- PartHost 按容器 id 设置 key。标题不接收投递；Switcher 目标只显示一条插入线，不加条目高亮或底部横线。容器原位插入线仍可见但释放不提交；Activity 条目和 Tab 使用同一份图标文字 DragOverlay。
- 来源 Part 的最后一个容器被搬走时，位置合成会清除旧的 `activeContainerByPart`；Part 由同一份呈现切片显示空态，目标容器的 Teleport 只在目标挂载点出现。
