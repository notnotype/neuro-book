---
标签: [state:local, state:shared-read, state:shared-write, io:read, io:mutate, persist:local, env:clipboard]
---

# WorkspaceFilePanel

工作台左叶的文件树视图：把 Project 工作区的文件树画出来，并把选择、打开、新建、重命名、移动、删除这些意图交给领域 store 执行。它是 `nbook.tools` 容器里 `nbook.files` 这一叶的实现（`factoryKey: "nbook.view.files"`），容器卡片、叶宽与显隐都不归它。

它和「一棵文件树」的区别有两条。**展开项不是它自己的状态**：`workbench.files`/`expanded-paths`（user/local 记录）由它唯一提交，旧裸键 `nbook.workspaceFilePanel.expandedPaths` 由会话一次性迁入，组件里没有一处 `localStorage`。**关键结果都有可见呈现**：读取中与空树各有自己的话，记录没读到分类、提交未确认、不可写、旧键没迁完都会变成一条诊断条——提交未确认与旧键没迁完可重试（条上带「重试 / 放弃」），记录读不到分类（损坏、版本不支持）不可重试（与壳层同一约定，只能修记录本身）；打开成功而正文无处呈现也如实报出；目前还没有专门呈现的是树读取失败与重命名失败（见「状态」一节）。

## 职责边界

- **数据与请求归 store**：树、选中、问题列表都从 `useNovelIdeStore()` 读，读写都调它的动作；请求（`/api/workspace-files/*`）在 store 里发出。本组件不 fetch，也不复制一份树数据。
- **展开项归记录**：`expandedPaths` 是一个 computed——读走记录会话的当前显示（未确认意图 > 已确认值 > 默认不展开），写走 `commit`。首读门禁是**两层**：读取完成前树根本不挂载（渲染加载态，调整控件因此不可用），会话层的 `commit` 也拒绝未就绪的提交并给出诊断——**不排队重放**，因为那种提交基于产品默认值，重放会覆盖已确认的展开项。就绪后的提交是「树当次显示的整份数组」（已确认值 + 本次路径）。旧键迁移「读旧键 → 记录缺失时条件初始化 → 回读一致 → 删旧键」；记录已有值时不被旧键覆盖，只做一次性收尾。
- **明细面板是分派**：选中节点是角色条目 → 角色明细；其它世界书条目 → 世界书明细；其余（含未选中）→ 文件明细。三块面板的 `close` / `refresh` / `create-index` / `convert-file-to-directory` 意图由本组件接回 store 与自己的动作。
- **打开链路**：单击 = 预览（`preview`），双击 = 保留标签（`permanent`）。编辑器叶（Markdown Studio）还没迁入，所以「打开」当前只把这次打开如实报出来（提示条），正文呈现与标签仍由 store 的编辑器恢复态承载。

## 数据

没有 props、没有 emits、没有 slots、没有 `expose`；`attrs` 透传到根元素（宿主 `WorkbenchViewHost` 渲染它时不传 props 也不加监听，透传因此作用不大，但它确实在根 `div` 上）。这就是它的全部明面通道——输入只有 store 与两个会话，因此调用方没有可替换的口子，也拿不到内部状态。

可核对的事实属性：`data-file-panel-record-notice`（展开记录诊断条）、`data-file-panel-open-notice`（打开提示条）。

## 布局

根是纵向 flex 列、`height: 100%`、`min-height: 0` 一路传下去，**必须待在确定高度的父级里**（容器面按 `fill` 合同给它一整个内容区）。自上而下五块：

- **头部**（固定）：搜索框（唯一吸收横向余量的块）+ 刷新按钮；一条底边线，底色取 `--bg-panel`。
- **记录诊断条**（按需）：`role="status"`、`aria-live="polite"`，可重试时带「重试 / 放弃」两个下划线按钮。
- **打开提示条**（按需）：同样的角色与礼貌播报，路径可换行，右侧「关闭提示」。
- **树容器**（吸满余量、自己滚，`custom-scrollbar`）：加载态、空态、树三者之一；两种文案态都是最小高度 180px 的虚线框。
- **明细面板 + 浮层**（右键菜单、新建弹窗）：面板始终有一块（`file` 分支是兜底，未选中也渲染），高度受控（初值 260，拖动时面板回传 `update:height`）；浮层不占树的高度。

搜索只会改树容器的内容，不动头部与明细面板：`390 × 844` 下头部仍是「搜索 + 刷新」一行，明细面板照常占底部一块。

## 交互

- **搜索**：纯客户端过滤（`path` / `title` / `summary` / `entryType` / `status`，大小写不敏感）；有搜索词时命中节点的祖先**强制展开**，清空搜索词回到记录的展开集。
- **刷新按钮**：调 `store.loadWorkspaceTree()`；只有用户点了才拉。
- **单击 / 双击节点**：预览 / 保留标签打开；打开成功显示提示条（可关闭）。
- **拖拽移动**：按落点算出目标目录；目标等于原名、或落进自身子树里就**不移动**（不弹框）；目标路径已被占用时弹输入框（给 `-1` / `-2`… 建议名），取消或填了非法/已占用路径同样不移动；成功后按新路径重选。
- **节点右键**：打开（内容目录节点是「打开 index」）、展开/收起、新建（子项与兄弟项；世界书 scope 下各多一条「新建世界书条目」）、复制（相对路径 / 绝对路径 / 相对引用 / 绝对引用，走系统剪贴板）、重命名（输入框，无改动即返回）、删除（确认框；目录删除失败后再确认一次递归删除）、条件项「转为目录节点（index.md）」（目录且内容 scope 且还没有 index）与「文件转同名目录」（内容 scope 下的可编辑文件，且自身不是 `index.md`）。
- **空白区右键**：新建（文件 / 目录 / 世界书条目）+ 刷新。
- **新建世界书条目**：路径归一化到 `<目录>/index.md`，写入条目模板 frontmatter（`title` / `type` / `status` / `summary` 等）；目标不在世界书 scope 内时报错，不静默改成别处。
- **键盘**：本组件不注册快捷键，也不接管焦点；树内导航、右键菜单遍历与弹窗焦点归 `WorkspaceFileTree` / `ContextMenu` / `WorkspaceCreateFileDialog`。

## 状态

- **加载中**（记录还没读到分类，或 store 在拉且树为空）：虚线框里一行「加载中」文案；读取记录期间树不挂载，展开手势在这段窗口里不可用（首读门禁的界面一半）；若真有调用在这段窗口里提交，条上会出现一条不可重试的诊断（会话层拒绝，不排队重放）。
- **空**（过滤后没有节点）：虚线框空态文案；这一块**可以右键**，所以空树不是死路。
- **有树**：渲染 `WorkspaceFileTree`；展开项来自记录，`forced-expanded-paths` 来自搜索。
- **不能访问工作区**（没打开 Project 等）：组件不主动拉树——挂载与 `canAccessWorkspace` 变化都以「能访问且树为空」为条件；这种状态下它等同于空态。
- **展开记录有问题**：诊断条一条（文案来自 Storage 层的中文诊断），可重试时给「重试 / 放弃」；放弃即回到已确认值。
- **打开成功但没有正文**：提示条 + 「关闭提示」，不静默。
- **创建 / 转换 / 移动失败**：系统通知（标题按种类区分：新建文件 / 目录 / 世界书条目、转换为目录、移动），树按 store 的真实结果呈现（移动是乐观改路径，失败不改）。
- **重命名失败、删除失败后用户拒绝递归确认**：错误从动作里冒出来（`void renameNode(...)`、`throw error`），组件不接——没有通知也没有提示条。这是当前实现的缺口，登记给后续视图迁移批次。
- **树读取 / 选中 / 打开失败**：调用点同样不接错误，也不会显示提示条或通知；`loadingWorkspaceTree` 在 store 的 `finally` 里复位，树按上一次的快照呈现（多半是空态框）。
- **递归删除**：第一次（非递归）失败后再确认，只有用户同意才递归删。

## 不支持

- 不做编辑器正文与标签条：双击只能打开，正文呈现等 Markdown Studio 迁入。
- 不直连网络：组件里没有 HTTP 客户端，请求走 store 动作与记录会话的默认适配器（见「隐藏通道理由」的两条 `io:`）。
- 不做服务端搜索：没有搜索路由，过滤只在内存里做。
- 不做跨容器移动与隐藏：`canToggleVisibility` / `canMoveView` 都声明为 `false`，拖拽只在树内改路径。
- 不判权限：能不能用由 store 的 `canAccessWorkspace` 决定，本组件只按它决定拉不拉树。
- 不持有持久化：展开项归记录，选中、活动文件与标签归 store（编辑器恢复态）；组件自己只有临时状态。
- 不直接读写浏览器存储：唯一的 `localStorage` 访问在会话的旧键迁移路径里（见下）。

## 隐藏通道理由

- **`state:shared-read`**：读 `workspaceTree`、`loadingWorkspaceTree`、`selectedFileNode`、`selectedFilePath`、`workspaceIssues`、`canAccessWorkspace`。这些是工作区领域的当前事实，别的叶与明细面板看的是同一份；由父组件逐条传入只会造成第二份真相源，而且变化正是本组件的动作引起的。
- **`state:shared-write`**：`loadWorkspaceTree`、`openWorkspaceNode`、`selectWorkspacePath`、`clearActiveFile`、`createWorkspaceFile`、`createWorkspaceDirectory`、`renameWorkspacePath`、`optimisticRenameWorkspacePath`、`deleteWorkspacePath`、`convertWorkspaceFileToDirectory` 都是 store 动作。工作区文件是领域的写入口，同一组动作还有别的消费者（角色面板、页面）；这些动作不由父组件传入，所以本组件是这条写路径上的一个发起者——组件规范把它记成配方偏离（档位 A 的那条），下一步迁移应把这些动作上移到宿主、经 props/emits 进出。
- **`io:read` / `io:mutate`**：组件里没有 `fetch`，但两条默认链路会真的发请求——① store 动作读改 `/api/workspace-files/*`（挂载或从书架进 Project 时，若可访问且树为空会触发一次读）；② `useWorkbenchFileTreeExpandedPaths()` 的默认适配器是 Storage 宿主客户端（`/api/storage/user/context` + 记录读写），展开项提交即触发写。请求入口当前**不可由外部替换**（store 是单例，会话适配器只在会话工厂一层可注入，组件没有暴露），这是「声明 `io:` 但入口不可替换」的现实状态。
- **`persist:local`**：会话的旧键访问器（`createBrowserLegacyValueStore("nbook.workspaceFilePanel.expandedPaths")`）直接 `getItem` / `removeItem`。这条路径只在旧键迁移时走到：迁完就不再有写入，迁移失败则保留旧键并留下诊断；产品代码里没有第二处 `localStorage`。
- **`env:clipboard`**：右键的四种复制直接写系统剪贴板（`navigator.clipboard.writeText`）；非客户端环境直接返回，没有剪贴板能力时也没有回落路径。
- **`state:local`**：搜索词、打开提示的路径、明细面板高度、右键菜单的坐标与项、新建弹窗的开关与参数、正在创建标记。

## Lab 与确定性验证

标签含 `io:` / `state:shared-write` / `persist:`，按能力标签推导是 `mountable: false`——Lab 导航里它在，中栏显示「不能在 Lab 验证」的原因（原文：`会真的读写产品数据（state:shared-write、io:read、io:mutate），只能在正式界面验证`），不为它造替代场景（Lab 规范不允许给阻断条目挂 fixture）。原因是实打实的：它没有一条能由 fixture 喂饱的明面通道，树、选中、问题列表都在 store 里，展开项在记录里，请求在 store 与 Storage 宿主里。

替代验证：

- `WorkspaceFilePanel.test.ts`（store 与记录替身、子组件 stub）：读取中就绪前不渲染树、展开项来自记录、挂载零浏览器存储读写、选中/打开、三种明细分派、诊断条与重试/放弃。
- `files-view-session.test.ts` + `legacy-record-migration.test.ts` + `product-catalog.test.ts` + `WorkbenchViewHost.test.ts`：记录会话与旧键迁移（含保留分支）、`nbook.files` 的可见性求值与宿主渲染。
- 真实界面：t55 在隔离宿主上验证过展开落记录、两种旧键迁移情形、打开提示条与书架态不渲染；本 Task 另外对运行中的开发服务只读跑了 Lab smoke。

## 注意事项

- **必须待在确定高度里**：根是 `h-full`，放进自动高度的父级会让树容器与明细面板都塌掉。
- **明细面板总有一块**：未选中时是空的文件明细面板，不要以为这块只在选中后才存在。
- **空白区右键是唯一的工具栏替代**：新建与刷新没有常驻按钮，空树同样要吃右键。
- **刷新按钮与搜索框当前没有可访问名称**（图标按钮无 `aria-label`，搜索框只有 placeholder）：这是已登记的缺口，等视图迁移批次收口，不在本 Task 顺手改。
- **提示条不是可选项**：记录诊断、打开提示都承载「操作有结果」的语义，后续改动不要把它们并进通知或删掉。
- **拉树的判据是 `canAccessWorkspace && workspaceTree.length === 0`**：切 Project、从书架进 Project 由 `watch` 补一次读，不能假设父组件会替它拉。
