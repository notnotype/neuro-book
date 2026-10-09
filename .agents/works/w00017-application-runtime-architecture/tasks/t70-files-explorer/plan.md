# t70 实施计划：Files 竖切三：资源管理器视图

## Context

- **为什么做**：第 6 步 Files 竖切的第三片（[t68 计划的“第 6 步分解”](../t68-files-resource-layer/plan.md#第-6-步分解)）。t68、t69 交付了 `nbook.files` 的列出、读取、保存、事件与文件操作，主页面还没有任何界面用它们。本 Task 交付侧栏的资源管理器视图，按 [`workbench/files-explorer.md`](../../../../../docs/specs/workbench/files-explorer.md) 的呈现与操作部分（验收 1–8、10、11；验收 9 的 dirty 结算随 t71，验收 12 的性能随 t72，验收 13 的 Lab 部分见第 7 节）。
- **已有的底座**：
  - 浏览器文件客户端 `filesKey`（`src/plugins/files/web/client.ts`）：`list`、`read`、`write`、`watch`、`identify`、单项操作与批量句柄。
  - 视图贡献点 `workbench.views`（`src/plugins/workbench/shared/views.ts`，样例 `src/web/testing/sample-views.ts`）。
  - 命令贡献点 `COMMANDS_POINT`（`src/plugins/commands/shared/contracts.ts`）。
  - store 与持久化字段（`src/shared/store/`，Storage 记录 `scope: user | project`、`locality: local | shared`）。
  - 窗口的项目绑定 `windowProjectKey`、显示语言与文案写法（`localize`，例 `workbench/web/commands/palette-messages.ts`）。
  - nb-ui 的 `ContextMenu`、`AlertDialog`、`Dialog`、`FormInput`、`IconButton`、`Toolbar`、`EmptyState`、`Spinner`、`DropIndicator`。nb-ui 没有树与虚拟列表。
- **参照**：旧应用 `packages/neuro-book-legacy/app/components/novel-ide/workspace/`（`WorkspaceFilePanel`、`WorkspaceFileTree`、`workspace-file-tree.ts`、冲突与新建对话框）只作行为参照，不搬代码。
- **推进方式**：同 t68、t69（autonomous-delivery：计划交三个 omp 审查、逐片提交并 push、三个 omp 实现审查）。UI 改动遵守 [ui-development](../../../../skills/ui-development/SKILL.md)：新组件先写同名 `.md`；四主题 × 明暗、390 px 窄屏截图作证据，外观意见不阻塞推进（待确认清单 2026-10-08）。

## 关键设计

### 1. 插件与贡献（新插件 `nbook.explorer`，`src/plugins/explorer/`）

- 只有浏览器入口，`onStartup` 激活（视图的按需激活不在 `workbench.views` 第一版）。依赖 `filesKey`、命令服务、Storage、`windowProjectKey`、显示语言。资源管理器是 Files 的消费者：单独成插件，依赖方向是“资源管理器 → 文件客户端”，`nbook.files` 不知道界面。
- 贡献视图 `nbook.explorer`：标题“资源管理器 / Explorer”，图标 `i-lucide-files`，`location: "sidebar"`，`order: 0`，`layout: "fill"`（视图自己滚动，虚拟列表要控制滚动容器）。
- 贡献命令（域 `files`，Agent 一律 `never`，都作用于本窗口的资源管理器）：`nbook.files.new-file`、`nbook.files.new-folder`、`nbook.files.refresh`、`nbook.files.collapse-all`、`nbook.files.toggle-manifests`。依赖选择的动作（改名、删除、复制、剪切、粘贴、创建内容、转换、展示名、清单修正）只经右键菜单、工具栏与树内按键，不进命令表：它们的参数是“当前选择”，命令化要先定选择的公开表示，随第一个需要它的消费者（Agent 操作界面）。
- 菜单：右键菜单是资源管理器自己的固定动作；开放的 `explorer/context` 菜单贡献点随第一个要往里加动作的插件。视图标题动作（工作台的标题栏按钮）同样随第一个消费者：工具栏放在视图内容的顶部。`nbook.view.refresh-files`（commands.md 第二批，依赖视图标题动作）不在本 Task。

### 2. 树模型（`web/tree/`，纯 TypeScript，`@vue/reactivity`）

- **目录缓存**：键是资源地址，状态 `unloaded | loading | loaded(Listing) | error(code, detail)`；一个目录同一时刻至多一个列出在途，在途期间又被标脏的，结束后再列一次。不跨项目代次（切换项目整页重新加载）。
- **根**：窗口绑定了项目时有 `project://` 与 `user://` 两个根；没绑定时只有“尚未打开项目”的说明与 `user://`。用户资产根默认折叠。
- **展开**：展开集合按根存；展开一个目录才列出它。打开视图时列出根与记录里仍展开、且祖先都展开的目录（只列可见的，不预取）。
- **增量刷新**：每个根一条 `watch`（客户端已按方案共享订阅）。一批事件按路径找出受影响的已加载目录（事件路径的父目录；`renamed` 的新旧父目录），合并后各重列一次；`renamed` 与 `deleted` 按段边界前缀改写展开集合、选择、焦点与剪贴板里的地址（`deleted` 移除）；`resync` 重列全部已加载目录；`ended` 标记该根“已停止同步”，原位显示原因与“重新连接”。外部事件与经文件服务的精确事件同样处理：精确事件只是让重列更早、更少。
- **呈现投影**（`rows.ts`，可见行的计算，`computed`）：深度优先展开已加载目录，得到 `Row[]`：
  - 普通文件夹：真实名字；目录在前（顺序由列出结果给定，客户端不重排）。
  - 内容文件夹：标签取清单 `title`，缺省真实名字，并带上可辨认路径的副标题（真实名字与标签不同时）；节点的 `index.md`（`role: body`）不单列；清单文件（`role: manifest`）默认隐藏，“显示清单文件”打开时出现；缺失条目（`kind: missing`）灰显并标“缺失”；未列入项标“未列入”；清单不合法或读不出时该文件夹按普通文件夹显示，并在文件夹下方显示一行清单错误。
  - 每个展开目录下方按状态补一行：加载中、读取失败（码与“重试”）、空目录。读取失败与空目录分开，不显示假空树。
- **选择与焦点**（`selection.ts`，纯函数）：选择是可见行地址的有序集合，另有焦点与范围锚点。单击选中并聚焦；Ctrl/Meta 切换；Shift 选锚点到当前行的可见范围；修饰选择不打开；Ctrl/Meta+A 选全部可见资源行（不含状态行、缺失条目与隐藏的正文）；右键已选行保留选择，未选行先单选。刷新后不在可见行里的地址从选择中去掉。
- **键盘**（`keys.ts`，纯函数：按键 + 状态 → 新状态与要执行的动作）：上下移动焦点；右键展开或进入第一个子项，左键收起或回到父目录；Space 切换选择；Enter 打开（permanent）；F2 改名；Delete 删除；Ctrl/Meta+C/X/V 复制、剪切、粘贴；Escape 清除剪切标记与进行中的拖动。只在树的列表元素拥有焦点时处理，输入框与编辑器有焦点时不拦截。

### 3. 视图组件（`web/components/`，每个组件先写同名 `.md`）

- `FilesExplorerView.vue`：视图根，接 `ViewContext`，只经注入的 `ExplorerController`（第 4 节）取数据与发动作，组件不持有文件客户端或网络协议。工具栏：新建文件、新建文件夹、刷新、全部收起、显示清单文件（切换）。
- `ExplorerTree.vue`：虚拟列表。固定行高（22 px，按密度 token），只渲染视口内的行与上下各 10 行余量；滚动容器是本组件自己的元素（视图 `layout: "fill"`）。行的 `role="treeitem"`、`aria-level`、`aria-expanded`、`aria-selected`，列表 `role="tree"`、`aria-multiselectable`，焦点用 `aria-activedescendant`（滚出视口的焦点行仍可读）。
- `ExplorerRow.vue`：缩进、展开箭头（与打开区域分开）、图标（按类型与文件夹类型）、标签与副标题、状态标记（缺失、未列入、无正文、剪切中）、内联输入（新建与改名，nb-ui `FormInput`）。
- `ExplorerFeedback.vue`：视图底部的结果区。一次操作有失败、跳过、未执行、取消、结果未知或清单没改成时列出逐项结果（源、目标、原因；目录复制的残留范围与“已省略”标记）；全部成功不打扰。结果未知的项给“重新列出”与“放弃”，不提供重试按钮。
- 对话框（nb-ui `AlertDialog`、`Dialog`）：删除确认（列出最外层的受影响项与数量，说明不可恢复，默认焦点在取消）；碰撞（同名时改名并预填候选名、跳过、取消剩余；“对其余同名项都这样”）；展示名与图标（内容文件夹）。
- 文案中英两份写在一起（`messages.ts`），按显示语言取。

### 4. 控制器与动作（`web/controller.ts`、`web/actions/`）

- `ExplorerController`：每个视图实例一个，持有树模型、选择、剪贴板引用、进行中的操作与结果。组件经它发动作；它经 `filesKey` 调用、经命令服务打开文件。
- **打开**：执行 `nbook.editor.open`，参数 `{address, mode: "preview" | "permanent"}`；选中与焦点在调用之前同步切换。命令未登记（编辑器区随 t71）时结果区显示“编辑器尚未接入”，不伪装成功。节点行的打开区域打开它的 `index.md`。
- **新建**：在目标目录（选中的目录；选中文件的父目录；无选择时项目根）下插入一行内联输入，确认后 `create`；内容文件夹里新项插到选中项之前（`before`）。名字为空、含 `/` 或冲突在输入框原位提示，不关闭输入。
- **改名**：内联输入；开始改名时 `identify` 冻结令牌，提交带 `expected`。内容文件夹里“改名”改真实名字，“修改展示名”只改清单。
- **删除**：确认时冻结选择（父子只留最外层）并 `identify`，确认后批量 `delete` 带令牌；结果进结果区。
- **创建内容、转换、清单修正**：节点无正文时菜单有“创建内容”；目录有“转为内容文件夹 / 转为普通文件夹”；内容文件夹里未列入项有“加入清单”，缺失条目有“从清单移除”。
- **剪贴板**（`clipboard.ts`）：本窗口内的一份 `{mode: copy | cut, sources: [{address, token}], project}`，不存字节、不碰系统剪贴板。复制与剪切时 `identify` 冻结身份；剪切的源在树里标出，Escape 清除。粘贴目标：右键的目录，选中文件的父目录，无选择时项目根；多个选中目录时不猜，要求先选一个目标。粘贴前用目标目录的列出结果预判同名，逐个问改名、跳过或取消；提交仍由服务端排他重验（预判之后被占用照样是该项冲突，结果区显示）。剪切粘贴每成功一项从剪贴板移除该源，失败与跳过的保留；复制可重复粘贴。源身份变了的项为 `source-changed`，结果区说明“源已被替换或移走”。剪贴板跨方案的项按方案分开发出（不跨根搬运，跨根时拒绝并说明）。
- **拖动**（`drag.ts`）：树内指针拖动，激活门槛与外壳一致（鼠标与笔 6 px、触摸按住 200 ms）。落在目录行为移入该目录（批量 `move`，碰撞同粘贴）；在内容文件夹里同一父目录的两行之间为调整顺序（`reorder`，只改清单）；落在自己或自己的后代上无反馈不可放。拖动中 Escape 取消。拖动的源是当时的选择（拖未选行时只拖它）。
- **操作的执行与反馈**：一次只有一个批量在途时，结果区显示“进行中”与“取消”（句柄的 `cancel`）。批量返回的逐项结果、`manifests` 表与 `truncated` 原样呈现；`unknown-outcome` 显示为结果未知，并重列相关目录（只核对，不重试）。
- **dirty 文档**：复制、移动、删除前要问文档拥有者（复制选“先保存 / 复制磁盘版本 / 取消”，移动结算输入并等在途保存，删除列出 dirty 文档）。编辑器区随 t71，本 Task 在控制器里留一个 `DocumentCoordinator` 端口，缺省实现直接放行；t71 接上文档模型。

### 5. 持久化（`web/preferences.ts`）

- “显示清单文件”：Storage 记录 `explorer.preferences`，`scope: user`、`locality: local`，值 `{showManifests: boolean}`，缺失时为 `false`。
- 展开集合：Storage 记录 `explorer.expanded`，`scope: project`、`locality: local`，值 `{project: string[], user: string[]}`（地址的路径部分，上限 2000 条，超出时丢最早的）；没有绑定项目时 `user://` 的展开只在内存。
- 经 `src/shared/store/persisted.ts` 的持久化字段读写；首读完成前不挂树，不让缺省值覆盖记录。记录写失败只在视图里提示一次，不阻塞浏览。
- 旧应用的 `workbench.files` 记录不迁移：新应用是并排重建，旧记录随项目迁移脚本另议（记入待确认）。

### 6. 窗口与项目

- 没有绑定项目：项目根位置显示“尚未打开项目”与“打开项目”按钮（执行 `nbook.project.open`），不发文件写入。
- 项目代次结束（订阅 `ended`、请求 `target-gone`）：树标为已失效，不再发起写入，显示原因；切换项目整页重新加载，旧树与剪贴板随页面消失。

### 7. Lab

- Lab 场景 `explorer-scene`：挂真实的 `FilesExplorerView`、控制器与树模型，文件客户端换成 Lab 提供的内存实现（只实现 `list`、`watch`、`identify` 与单项操作的成功与失败，三类文件夹、清单错误、读取失败、空目录、大目录的固定数据）；不发产品 API 请求，切场景时释放。内存实现的形状与 `FilesService` 同一接口，由类型检查保证；它只服务 Lab，不进测试。

## Spec 与文档改动（S0）

| 文档 | 改什么 |
|---|---|
| `docs/specs/workbench/files-explorer.md` | 插件与视图（`nbook.explorer`、视图 id、位置）；命令表与依赖选择的动作只走菜单；右键菜单固定、`explorer/context` 与视图标题动作推迟；结果区；内联新建与改名；粘贴目标、碰撞对话框与“对其余同名项”；拖动的落点规则；持久化记录；打开命令的参数；dirty 结算随 t71；“实现合同”在 t71 一并写 |
| `docs/specs/workbench/commands.md` | 域词表加 `files`；命令目录（资源管理器）五条 |

## 切片

| 片 | 对应设计 | 提交边界 | 自跑验证 |
|---|---|---|---|
| S0 | Spec 表 | Spec 修订 | `docs:check`、`governance:check` |
| S1 | 第 2 节 | 树模型、可见行投影、选择与键盘纯函数 | `web/tree/*.test.ts`：真实内核的 `filesScene` 窗口（列出、展开、增量刷新：外部新建与删除、经文件服务的改名前缀改写、`resync`、`ended`）；三类文件夹的行投影；选择与键盘的纯函数表 |
| S2 | 第 1、3、5、6 节 | 插件、视图注册、视图组件、虚拟列表、工具栏、持久化、空项目状态 | `*.dom.test.ts`（组件挂真实控制器与真实内核窗口）：可见行与 ARIA、虚拟列表只渲染视口、展开与收起、显示清单文件的切换与记录、未打开项目、读取失败与空目录；`typecheck` |
| S3 | 第 4 节（单项与删除） | 右键菜单、内联新建与改名、删除确认与批量、创建内容、转换、展示名、清单修正、结果区 | DOM 测试经真实内核窗口与真实磁盘：每个动作的磁盘结果与反馈；冲突在输入框原位；删除确认默认取消 |
| S4 | 第 4 节（剪贴板与拖动） | 剪贴板、粘贴目标、碰撞对话框、拖动移动与排序、树内按键 | DOM 测试：复制可重复、剪切逐项清除、源被替换后拒绝、粘贴目标三种、碰撞改名与跳过、拖动移入与内容文件夹排序、Escape 清除 |
| S5 | 第 7 节 | Lab 场景、产品页 e2e、截图证据、Spec 标注、三个 omp 实现审查与修正 | `e2e/files-explorer.e2e.ts`（真实后端与项目）；全量 e2e、`smoke:server`、`test:affected --since`、`docs:check`、`governance:check` |

## 验收映射

| files-explorer 验收 | 入口与可观察完成条件 | 片 |
|---|---|---|
| 1 三类文件夹呈现、根不可改名、用户资产默认折叠 | 行投影测试；产品页 e2e 看标签、隐藏正文、清单文件默认隐藏 | S1、S2、S5 |
| 2 普通目录单击展开、节点行展开与打开分开、创建内容 | DOM 测试与 e2e：点击区域与磁盘 | S2、S3、S5 |
| 3 键盘与修饰选择、输入框聚焦时不拦截 | 键盘纯函数表；DOM 测试真实按键事件 | S1、S4 |
| 4 显示清单文件的记录与恢复、切换时选择保留、拖动排序与展示名只改清单 | DOM 测试经真实 Storage 记录；磁盘字节 | S2、S3、S4 |
| 5 剪贴板复制重复粘贴、剪切逐项清除、Escape、源身份变化拒绝 | DOM 测试经真实窗口与磁盘 | S4 |
| 6 粘贴目标三种、多目录不猜、父子与重复源、自身后代拒绝、同目标移动无操作 | DOM 测试 | S4 |
| 7 碰撞改名、跳过、取消；预检后占用仍冲突；菜单与拖动同义 | DOM 测试；占用在预判之后、提交之前用外部写入制造 | S4 |
| 8 残留范围可见、独立项继续、取消不回滚、结果未知先核对 | DOM 测试经真实批量结果（权限与锁屏障同 t69） | S3、S4 |
| 10 未开项目、加载、空目录、读取错误、只读与失效分开 | DOM 测试 | S2 |
| 11 不依赖领域服务、不改写领域文件 | e2e 浏览前后磁盘字节不变 | S5 |
| 9、12、13 | 9 随 t71；12 随 t72；13 的 Lab 部分在 S5，跨机器不在本 Task | — |

## 验证

- 每片：上表的自跑验证与变异检查（每条判据各一个变异）。DOM 测试挂真实控制器、真实内核窗口与真实磁盘，不用 mock、spy、假计时器；拖动用真实指针事件序列。
- 收口：全量 e2e、`smoke:server`、`test:affected --since`、typecheck、`docs:check`、`governance:check`；产品页截图（四主题 × 明暗、390 px）作证据。
- 未验证边界：跨机器的基础操作；性能标准（t72）；dirty 文档的结算（t71）。

## 不做与风险

- 不做：编辑器区与打开后的文档（t71）；性能测量与修正（t72）；`explorer/context` 开放贡献点、视图标题动作、依赖选择的命令；活页夹呈现（剧情插件）；旧应用记录的迁移；系统剪贴板互通；跨根复制与移动。
- 风险：虚拟列表与 `aria-activedescendant` 的读屏兼容只在 Chromium 上验；固定行高在大字号下由密度 token 换算，不支持变高行。
- 风险：拖动与外壳的拖动会话是两套指针处理（外壳的会话只认视图与容器的落点标记）；两者都在指针按下时判断归属，树内按下不进外壳会话。
