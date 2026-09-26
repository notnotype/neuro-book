---
标签: [state:local]
---

# FileTree

`FileTree` 是受控的文件与目录导航树：它根据 `nodes` 和 `expandedIds` 呈现可见层级，把选择、激活、移动和上下文菜单请求以事件交给宿主处理。它有文件/目录图标、单选行、键盘树导航及可选 HTML 拖放；业务数据的重排和持久化不在组件内完成。

## 布局

根节点是带 `role="tree"` 与 `aria-label` 的纵向区域。每个可见节点是一行高 32px 的 `button[role=treeitem]`；深度缩进为 `8 + depth × indent` px，默认每层 18px。目录有独立的展开箭头按钮区域；叶子保留相同图标槽宽以对齐。节点图标优先使用 `iconClass`，否则目录按展开态使用文件夹图标、文件使用文件图标。长名称截断，node/trailing 插槽可以增加自定义内容。无可见节点时显示 empty 插槽或默认文案。

## 交互

点击可用节点发出 `select`，双击发出 `activate`；点击目录箭头仅切换展开并请求新的 `expandedIds`。键盘方向键按当前可见顺序移动焦点，Home / End 移到首尾；右方向键展开目录或移入展开目录的下一项，左方向键收起目录或返回父节点。Enter 发出激活，空格发出选择。焦点使用 roving tabindex，只让当前焦点行进入 Tab 顺序；节点、可见节点集合或 `selectedId` 变化时，组件把焦点目标校正到仍可见的节点，但不主动抢浏览器焦点。

启用 `draggable` 后，可用节点以 HTML Drag and Drop 开始拖动，拖动数据的 text/plain 为节点 id。目录中间 50% 是 `inside` 落点，上/下部分分别为 `before`/`after`；非目录按行中点分前后。拖到树空白区域发出 `root` 落点。组件拒绝拖入自身或目录后代，并在拖放结束时清理临时目标。右键节点与树根空白分别发出 `contextmenu`、`root-contextmenu`，浏览器默认菜单被阻止。

## 数据

```ts
type FileTreeNode = {
    id: string;
    label: string;
    kind: "file" | "directory";
    children?: FileTreeNode[];
    disabled?: boolean;
    iconClass?: string;
};

type FileTreeMove = {
    sourceId: string;
    targetId: string | null;
    position: "before" | "after" | "inside" | "root";
};

type FileTreeVisibleNode = {
    node: FileTreeNode;
    depth: number;
    parentId: string | null;
};

type FileTreeProps = {
    /** 文件树数据；必填。 */
    nodes: FileTreeNode[];
    /** 单选节点 id；默认 null。只用于显示选择与初始化焦点，不在点击时自行改写。 */
    selectedId?: string | null;
    /** 展开的目录 id 列表；必填、受控。 */
    expandedIds: string[];
    /** tree 的可访问名称；默认 "文件树"。 */
    ariaLabel?: string;
    /** 是否启用节点拖动；默认 false。 */
    draggable?: boolean;
    /** 每层缩进 px；默认 18。 */
    indent?: number;
};

type FileTreeEmits = {
    /** 用户点击目录箭头后，请求的新展开目录列表。 */
    (event: "update:expandedIds", value: string[]): void;
    /** 点击或空格选择可用节点时发出；节点 disabled 时不发。 */
    (event: "select", node: FileTreeNode): void;
    /** 双击或按 Enter 激活节点。 */
    (event: "activate", node: FileTreeNode): void;
    /** 可用拖动完成后的语义落点；不在组件内修改 nodes。 */
    (event: "move", payload: FileTreeMove): void;
    /** 节点上右键时发出节点和原生事件。 */
    (event: "contextmenu", node: FileTreeNode, event: MouseEvent): void;
    /** 树区域非节点位置右键时发出原生事件。 */
    (event: "root-contextmenu", event: MouseEvent): void;
};

type FileTreeSlots = {
    /** 空树内容；缺省显示“暂无文件”。 */
    empty(): unknown;
    /** 节点名称内容。作用域含节点、深度、目录展开态和选中态。 */
    node(props: {node: FileTreeNode; depth: number; expanded: boolean; selected: boolean}): unknown;
    /** 节点行右侧补充内容。作用域含节点和选中态。 */
    trailing(props: {node: FileTreeNode; selected: boolean}): unknown;
};
```

`move.position="root"` 时 `targetId` 为 `null`；其余落点的 `targetId` 是节点 id。组件无 expose API。attrs 按 Vue 默认单根行为落到树根 div，不转发到各行。

## 状态与边界

- `selectedId` 与 `expandedIds` 由宿主提供；组件不发 `update:selectedId`，选择后以 `select` 通知宿主，展开后以 `update:expandedIds` 请求更新。
- 单节点 `disabled` 阻止选择、目录切换和拖动；全局没有禁用 prop。
- `nodes` 是文件系统语义输入：只有 `kind="directory"` 的节点递归展开；文件节点的 children 不呈现。组件不校验重复 id、环或非法树结构。
- 空树或全部不可见节点呈现 `empty` 内容。数据加载与错误状态由宿主通过内容和插槽表达。
- 拖动仅产生 `move` 请求，不在本地重排，也不校验目标业务权限；宿主必须自行接纳、拒绝或更新节点树。

## 不支持

- 不提供多选、搜索、虚拟滚动、文件打开、移动确认或存储。
- 不处理从树外部拖入的 payload；`move` 仅描述本组件已开始的节点拖动。
