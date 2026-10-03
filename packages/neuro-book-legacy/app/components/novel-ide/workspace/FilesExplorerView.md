---
标签: [state:local]
---

# FilesExplorerView

双模式受控文件资源管理器视图：把一份真实文件树呈现成「普通模式」（真实文件名，`index.md` 是普通文件项）或「内容模式」（隐藏全部 `index.md` —— 含根 index，目录承载正文入口），并在树之上提供搜索框、模式切换与内容模式的根入口行。它是同一份 `WorkspaceFileNode[]` 的**呈现投影**：选择、展开、打开、移动、右键等意图全部原样转交给宿主，组件自己不持有文件数据、不发起请求、不写任何存储——磁盘与文档的真实变化都发生在宿主（产品面板或 Lab fixture）一侧。

与 `WorkspaceFilePanel` 的区别：本组件不做 store 访问、不做领域明细/模板/右键菜单，也不持久化文件数据。树本体复用现有 `WorkspaceFileTree` 的拖动、右键、展开及基础行显示，模式由投影函数决定。

Lab 的 `FilesExplorerView` 场景只注入局部文件节点、选择、展开、模式和事件回显；普通、内容、读取中、错误、空目录均不接产品 Store/HTTP/Storage。拖放与粘贴只展示受控意图，不模拟磁盘成功；磁盘及正文验收仍由主页面承担。

## 数据

```ts
const props = defineProps<{
    /** 真实文件树（扁平节点列表）；组件只投影呈现，不改写它。 */
    nodes: WorkspaceFileNode[];
    /** 受控：当前呈现模式（`workbench.files`/`view-mode` 的值），组件只发事件、从不自行修改。 */
    mode: WorkspaceFilesViewMode; // "ordinary" | "content"
    /** 受控：当前选中路径（真实路径，非展示标题）。 */
    selectedPath: string;
    /** 受控资源多选；目录使用真实目录路径，不是 index.md 正文路径。 */
    selectedPaths?: string[];
    /** 受控：树展开路径（真实目录路径）；持久化归宿主，组件只回传整份意图。 */
    expandedPaths: string[];
    /** 树读取中：呈现加载态，树与根入口都不挂载。 */
    loading: boolean;
    /** 树读取失败信息：非空时呈现错误态（优先于树）；默认 null。 */
    error?: string | null;
}>();

const emit = defineEmits<{
    /** 用户切换模式；宿主负责持久化到 `workbench.files`/`view-mode` 并回传新 mode。 */
    (e: "update:mode", mode: WorkspaceFilesViewMode): void;
    /** 树展开意图（整份数组）；树侧 sanitize 看护，宿主负责提交记录。 */
    (e: "update:expandedPaths", paths: string[]): void;
    (e: "update:selectedPaths", paths: string[]): void;
    (e: "clipboard-intent", intent: WorkspaceFileClipboardIntent): void;
    /** 单击选中（树节点或根入口）；单击不打开。 */
    (e: "select", node: WorkspaceFileNode): void;
    /** 双击 / Enter 常驻打开（树节点或根入口）。 */
    (e: "open", node: WorkspaceFileNode): void;
    /** 拖拽移动意图；选中行冻结整份选中路径到 sourcePaths，未选中行只带自己；宿主决定协商与落盘。 */
    (e: "move", payload: WorkspaceFileMovePayload): void;
    /** 节点右键（含坐标事件）；宿主呈现菜单。 */
    (e: "node-contextmenu", node: WorkspaceFileNode, event: MouseEvent): void;
    /** 树空白区或根行右键；宿主呈现根级动作。 */
    (e: "root-contextmenu", event: MouseEvent): void;
    /** 内容模式下根 index.md 缺失时，用户点击「创建内容」；只发意图，组件不写盘、不假装成功。 */
    (e: "create-root-content"): void;
    /** 错误态的「重试」；宿主负责重新读取。 */
    (e: "retry"): void;
}>();
```

**Slots：没有。expose：没有。attrs：单根组件，透传到根元素。**

隐藏通道：**没有**。不读写 store、不访问浏览器存储、不发请求、无定时器/全局监听/剪贴板/teleport；frontmatter 标签只有 `state:local`（搜索词、根展开箭头的展开态），耦合度 0，Lab 可直接喂确定性内存数据挂载。

## 布局

纵向 flex 列、`h-full min-h-0`，**必须放在确定高度的父级里**。自上而下：

- **头部**（固定）：搜索框（吸收横向余量）+ nb-ui `SegmentedControl`（`xs`，普通/内容两项，带图标）。
- **根入口行**（固定；仅内容模式且非加载中显示）：展开箭头 + 图标 + 标题 + 尾部（`index.md` 角标，或缺失时的「创建内容」按钮）。展开箭头与正文打开区域是两个独立控件。
- **树容器**（吸满余量、自己滚）：加载 / 错误 / 空·无命中 / 树，四态互斥。内容模式下树收在根行下并整体缩进一个层级（18px，与树行缩进常量一致）。

`390×844`：头部仍是「搜索框 + 紧凑切换」一行，切换 `xs` 尺寸不换行；根入口行单行截断；树容器照常滚动。错误文案可换行。

## 交互

- **搜索**：纯客户端内存过滤，按真实 `path` 与投影后展示 `title` 包含命中（大小写不敏感），命中节点的祖先一起保留并**强制展开**；真实树数据不变，清空回到记录的展开集。无命中显示专门文案，根入口行仍在。
- **模式切换**：`update:mode` 交给宿主；组件在 `mode` 变化时只是换投影（`projectWorkspaceFileNodes`），不重读、不重建数据、不动展开记录与选中。
- **根入口行**（内容模式）：根从 `props.nodes` 里找 `index.md`（真实节点，不虚构）。**有根 index**：单击预览（`select`）、双击/Enter 常驻（`open`）；**缺失**：尾部「创建内容」按钮发 `create-root-content`，不自动写盘。展开箭头独立展开/收起根内容，左右键同样只动展开；根本身不可在本面板重命名/移动/删除。根行右键与树空白区右键同样发 `root-contextmenu`。
- **树内**：全部委托 `WorkspaceFileTree`——单击预览、双击/Enter 常驻、原生可拖动节点的鼠标拖拽移动、节点/空白右键、展开动画；本组件不拦截不转发二次处理。拖动已选中行冻结整个选集，未选中行只拖自身；目录中心区域为目录内落点。
- **键盘**：根行 `tabindex=0`（Enter=打开、Space=预览、左右=展开收起）；树内键盘归 `WorkspaceFileTree`。搜索框聚焦时按键不被树劫持。

## 状态

- **加载中**（`loading`）：树容器整体显示「正在加载文件树...」虚线框；树与根入口都不挂载（与 `WorkspaceFilePanel` 的首读门禁同理：读取中不该让展开手势操作记录值）。
- **错误**（`error` 非空，优先于树）：`role="alert"` 错误框，信息原文展示，带「重试」按钮（只发 `retry`）；不伪造成功，也不把错误吞成空态。
- **空**：树为空且无搜索词——虚线框「没有可显示的文件」，空白区可右键（根动作）；不是死路。
- **无命中**：有搜索词但过滤后为空——「没有匹配「…」的文件」；与空态区分。
- **内容模式 · 根无 index**：根行图标回落为文件夹，尾部常驻「创建内容」；缺失不是读取错误，不弹通知。
- **内容模式 · 根有 index**：根行标题取该节点 frontmatter `title`（空则回落「根目录」），尾部显示 `index.md` 角标；选中态跟随 `selectedPath === 'index.md'`。

## 不支持

- 不访问 store / 不发请求 / 不读写浏览器存储：树数据、持久化（模式、展开记录）、失败反馈全部归宿主。
- 不提供右键菜单与新建/重命名/删除弹窗：只发 `node-contextmenu` / `root-contextmenu` / `create-root-content` 意图。
- 多选支持 Ctrl/Meta 追加、Shift 可见范围、Space 选择和 Ctrl/Meta+A 选择可见行；选中即时发布，普通单击预览延迟以区分双击。右键已选中项保留集合，拖动已选中行冻结整份选中路径、未选中行仅拖该行。复制/剪切/粘贴只发意图，窗口剪贴板与逐项结果归产品宿主；不访问系统剪贴板。
- 不做服务端搜索或排序切换，不渲染领域明细面板。
- 不自动写盘：任何情况下（含创建内容按钮）组件自身不产生文件副作用，也绝不把失败呈现为成功。

## 注意事项

- **必须待在确定高度里**：根是 `h-full`，放进自动高度的父级会让树容器塌掉。
- **受控值不可由组件单方面改**：`mode` / `selectedPath` / `expandedPaths` 都以父组件回传为准；父组件若不回传 `update:mode`，切换看起来「无效」是宿主漏接，不是组件问题。
- **根展开态是本地呈现状态**，有意不进 `expandedPaths`：树侧 sanitize 只保留真实可展开目录，根路径放进去会被剥掉；宿主不需要持久化它。
- **内容模式树的强制缩进**只是视觉层级（18px 与树缩进常量一致），树内节点自身缩进不受影响。
- 文案当前直接显示中文，与此组件接入现有 i18n 的工作仍需同步处理。

## Lab 与确定性验证

标签只有 `state:local`，无 `io:` / `persist:` / `state:shared-write`；Lab 已登记普通、内容、读取中、错误及空目录五个局部场景，fixture 注入内存 `WorkspaceFileNode[]` 与受控选择/展开/模式，拖动和粘贴只报告意图，不写盘、不访问产品 Store。

真实产品验收（持久化恢复、与编辑器打开链、盘上字节）不归本组件：组件对磁盘不可见，由产品面板宿主批次覆盖。
