# t70 实施计划：Files 竖切三：资源管理器视图

## Context

- **为什么做**：第 6 步 Files 竖切的第三片（[t68 计划的“第 6 步分解”](../t68-files-resource-layer/plan.md#第-6-步分解)）。t68、t69 交付了 `nbook.files` 的列出、读取、保存、事件与文件操作，主页面还没有任何界面用它们。本 Task 交付侧栏的资源管理器视图，按 [`workbench/files-explorer.md`](../../../../../docs/specs/workbench/files-explorer.md) 的呈现与操作部分（验收 1–8、10、11；验收 9 的 dirty 结算随 t71，验收 12 的性能随 t72，验收 13 的 Lab 部分见第 8 节）。
- **已有的底座**：
  - 浏览器文件客户端 `filesKey`（`src/plugins/files/web/client.ts`）：`list`、`read`、`write`、`watch`、`identify`、单项操作与批量句柄 `{result, cancel()}`。
  - 视图贡献点 `workbench.views`（`src/plugins/workbench/shared/views.ts`，样例 `src/web/testing/sample-views.ts`）：视图首次可见才建实例，停放不重建，渲染重试换代（`WorkbenchViewInstances.vue`）。
  - 命令贡献点 `COMMANDS_POINT` 与命令服务；命令域白名单 `COMMAND_DOMAINS`（`src/plugins/commands/shared/registry.ts`，与 commands.md 的域词表同步）；命令找当前界面实例的槽位写法（`workbench/web/commands/open-commands.ts` 的 `PaletteSlot`）；公开布尔键 `definePublicState`（例 `workbench/web/state/public-state.ts`）。
  - store 与持久化字段（`src/shared/store/persisted.ts`：首读、队列暂停、`retry`/`discard`/`discardAll`/`reopen`），Storage 记录 `scope: user | project`、`locality: local | shared`。
  - 窗口的项目绑定 `windowProjectKey`、显示语言与文案写法（`localize`，例 `workbench/web/commands/palette-messages.ts`）。
  - nb-ui：`AlertDialog`、`Dialog`、`FormInput`、`IconButton`、`Toolbar`、`EmptyState`、`Spinner`、`DropFeedbackOverlay`（目录高亮、插入线与礼貌播报）、`ContextMenu`（只有 ArrowRight 与 Escape，不管焦点）、`Tree` 与 `FileTree`（见第 3 节的复用表）、`useLayoutExtent`。
  - 外壳拖动会话 `workbench/web/views/drag-session.ts`：冻结源、放下时重判且只提交与最后显示相同的动作、`pointercancel`/失焦/隐藏/销毁取消。资源管理器的拖动照这套做法写自己的会话，不进外壳会话。
- **参照**：旧应用 `packages/neuro-book-legacy/app/components/novel-ide/workspace/`（`WorkspaceFilePanel`、`WorkspaceFileTree`、`workspace-file-tree.ts`、冲突与新建对话框）只作行为参照，不搬代码。旧面板在结果未知时禁止复制、剪切、粘贴，核对后明确放弃才清旧意图，本计划沿用（第 5 节）。
- **推进方式**：同 t68、t69（autonomous-delivery：计划交三个 omp 审查、逐片提交并 push、三个 omp 实现审查）。计划审查（[证据](evidences/)）的 28 条发现已并入本稿。UI 改动遵守 [ui-development](../../../../skills/ui-development/SKILL.md)：新组件先写同名 `.md`；四主题 × 明暗、390 px 窄屏截图作证据，外观意见不阻塞推进（待确认清单 2026-10-08）。

## 关键设计

### 1. 插件、命令与公开状态（新插件 `nbook.explorer`，`src/plugins/explorer/`）

- 只有浏览器入口，`onStartup` 激活。依赖 `filesKey`、命令服务、Storage、`windowProjectKey`、显示语言。资源管理器是 Files 的消费者，单独成插件，`nbook.files` 不知道界面。
- 贡献视图 `nbook.explorer`：标题“资源管理器 / Explorer”，图标 `i-lucide-files`，`location: "sidebar"`，`order: 0`，`layout: "fill"`（视图自己滚动）。
- **命令**：资源管理器的具名动作都是命令，按钮、右键菜单、树内快捷键只引用命令 id（commands.md：具名动作单一身份与执行入口）。树内的焦点移动、展开收起、范围选择是高频交互，不进命令（commands.md 非目标）。
  - 域 `files` 加进 commands.md 的域词表与 `COMMAND_DOMAINS`，同一提交。
  - 刷新沿用目录里已有的 `nbook.view.refresh-files {viewId, generation}`：视图内工具栏的刷新按钮带本实例的视图 id 与代次调用它；代次不符为 `stale-target`。视图标题动作这一触发面推迟，命令身份不变。
  - 其余命令，参数一律 `{}`，作用于本窗口资源管理器的私有选择（命令可以读同插件的私有状态，不需要公开选择的表示）；`effect` 照实写，Agent 暴露一律 `never`：

    | 命令 | effect | 默认键位 | `when.requires` |
    |---|---|---|---|
    | `nbook.files.new-file`、`nbook.files.new-folder` | write | — | `nbook.explorer/ready` |
    | `nbook.files.collapse-all` | read | — | `nbook.explorer/ready` |
    | `nbook.files.toggle-manifests` | write（偏好记录） | — | `nbook.explorer/ready` |
    | `nbook.files.rename` | write | F2 | `nbook.explorer/treeFocused`（键位）；面板里 `nbook.explorer/hasSelection` |
    | `nbook.files.delete` | write，`destructive` | Delete | 同上 |
    | `nbook.files.copy`、`nbook.files.cut` | read | Ctrl/Meta+C、X | 同上；结果未知门禁见第 5 节 |
    | `nbook.files.paste` | write | Ctrl/Meta+V | `nbook.explorer/canPaste` |
    | `nbook.files.move-up`、`nbook.files.move-down` | write | Alt+↑、Alt+↓ | `nbook.explorer/canReorder` |
    | `nbook.files.create-content`、`nbook.files.convert`、`nbook.files.set-display`、`nbook.files.include`、`nbook.files.drop-entry`、`nbook.files.clear-cut` | write（`clear-cut` 为 read） | `clear-cut`：Escape | 按选择的布尔键 |

  - 键位的 `when` 都带 `nbook.explorer/treeFocused`：只有树的列表元素本身拥有焦点时为真，内联输入、对话框与编辑器有焦点时为假，宿主不拦截。`when` 只用布尔键，具体动作在执行时再按选择核对，不合格时返回 `unavailable` 与原因。
- **公开状态** `nbook.explorer`：`ready`（控制器已建、首读完成）、`treeFocused`、`hasSelection`、`canPaste`、`canReorder` 以及创建内容、转换、清单修正各一个布尔键。只发布命令 `when` 需要的布尔键，不发布选择本身。
- **命令找控制器**：入口持有一个槽位（`PaletteSlot` 写法），控制器创建时登记；没有控制器时命令返回 `unavailable`（“资源管理器尚未打开”），不静默成功。需要界面输入的命令（新建、改名、展示名、带碰撞的粘贴、删除确认）还要求视图实例已挂上且可见，否则 `unavailable`（“资源管理器未显示”）。确认框与内联输入记下发起时的视图代次，代次变了的迟到回调按 `stale-target` 丢弃。
- **右键菜单**：资源管理器自己的固定动作，菜单项执行上表的命令。开放的 `explorer/context` 贡献点随第一个要往里加动作的插件。

### 2. 控制器的寿命与视图的关系（`web/controller.ts`）

- 入口激活后、视图第一次挂上时创建一个 `ExplorerController`，它活到入口停止；视图停放、移动、渲染重试换代都只是解绑再绑定同一个控制器，树、选择、剪贴板与进行中的操作都在控制器里，不随视图实例消失。入口停止时控制器释放订阅、取消未提交的意图、清掉槽位。
- 视图只拿当前代次的 `ViewContext` 与呈现资源（滚动容器、焦点元素）；组件经控制器取数据、执行命令，不持有文件客户端或网络协议。

### 3. 树模型（`web/tree/`，纯 TypeScript，`@vue/reactivity`）

- **目录槽**：键是资源地址；每个槽保存最后一份快照（`Listing` 或错误码与说明）、当前请求（请求序号与 `AbortController`）和脏标记。一个槽同一时刻至多一个列出在途；事件既能标脏已加载的槽，也能标脏加载中的槽；请求结束时只有槽仍拥有这个请求序号才应用结果，仍脏就再列一次。目录被删除、改名或转换类型时作废它和子树的槽与在途请求，迟到的旧结果丢弃。不跨项目代次（切换项目整页重新加载）。
- **根与当前根**：窗口绑定了项目时有 `project://` 与 `user://` 两个根；没绑定时项目根位置只有“尚未打开项目”的说明，`user://` 照常可用。用户资产根默认折叠。根行不能改名、移动、删除。**当前根**取焦点行的方案（焦点在根行上时取该根）；新建、空白处菜单与无选择粘贴的目标都是当前根，不写死项目根；没有当前根时这些动作不可用。
- **展开**：展开集合按根存；展开一个目录才列出它。打开视图时逐层列出根与记录里仍展开的目录（祖先先列，只列可见的，不预取）。记录里的路径在父目录列出、确认不存在时才删；没加载到的保留。某一层读取失败时保留它的展开意图，原位给“重试”。
- **失效规则**（`invalidate.ts`，集中一处，动作不手工刷新）。一批事件算出要标脏的槽，合并后各重列一次：
  - 普通变化：事件路径的父目录；`renamed` 取新旧父目录。
  - 清单 `content.xml` 的任何事件：所有 `contentRoot` 等于该内容根的已加载与加载中槽（嵌套层的标题、顺序、缺失与未列入都来自同一份清单）。
  - 节点正文 `index.md` 的增删与替换：节点目录本身，以及列出该节点项的上一层（`body` 在父层算出）。
  - 目录的 `renamed`/`deleted`：按段边界作废子树的槽；`renamed` 把展开集合、选择与焦点按前缀改写到新地址，`deleted` 从中移除。剪贴板与已冻结的操作意图不改写（第 5 节）。
  - `resync` 重列全部已加载与加载中的槽；`ended` 把该根标为“已停止同步”，原位显示原因与“重新连接”。外部事件与经文件服务的精确事件同样处理。
- **呈现投影**（`rows.ts`，`computed`）：深度优先展开已加载目录，得到 `Row[]`。每行带稳定 id（根加地址）、深度、同层位置与同层总数（按完整的逻辑同层集合算，不按当前渲染的窗口）。
  - 按内容文件夹呈现的条件是该层 `contentRoot !== null` 且 `manifest.status === "ok"`，不只看 `folder` 一个字段（内容树里的子目录返回 `folder: plain`）。满足时：标签取 `title`，缺省真实名字，真实名字与标签不同时副标题给真实名字；节点的 `index.md`（`role: body`）不单列，节点行的打开区打开它；`role: manifest` 的清单文件默认隐藏，“显示清单文件”打开时出现；`kind: missing` 灰显并标“缺失”；`listed: false` 标“未列入”。
  - 清单不是 `ok`：该层按普通目录显示真实名字、`index.md` 照常成行、点击目录只展开，层下方一行清单错误（`absent` 不提示，`unreadable`/`invalid` 给说明）。外部修好清单后按失效规则自动恢复。
  - 活页夹（`folder: binder`）：本 Task 按普通目录显示，标签旁说明“需要剧情插件”；`binder.xml` 没有 `role`，按普通文件显示，不按文件名全局隐藏。
  - 普通目录不读正文：投影只用列出结果。
  - 每个展开目录下方按状态补一行：加载中、读取失败（码与“重试”）、空目录。读取失败与空目录分开；状态行不是资源行，不进选择。
- **选择与焦点**（`selection.ts`，纯函数）：选择是行 id 的有序集合，另有焦点与范围锚点。单击选中并聚焦；Ctrl/Meta 切换；Shift 选锚点到当前行的可见范围；修饰选择不打开；Ctrl/Meta+A 选全部可见资源行（不含状态行、缺失条目与隐藏的正文）；右键已选行保留选择，未选行先单选。焦点行被折叠、删除或隐藏时，焦点回到最近的存活祖先，没有时到邻近的可见行。
- **树内按键**（`keys.ts`，纯函数：按键 + 状态 → 新状态，或要执行的命令 id）：上下、Home/End、PageUp/PageDown 移动焦点；右键展开或进入第一个子项，左键收起或回到父目录；Space 切换选择；Shift+上下扩展范围；Enter 打开（permanent）；Shift+F10 与 ContextMenu 键在焦点行打开右键菜单。F2、Delete、复制剪切粘贴、Alt+上下与 Escape 走命令键位（第 1 节），不在这里重复。

### 4. 视图组件（`web/components/`，每个组件先写同名 `.md`）

- **复用表**：nb-ui 的 `FileTree` 单选、行高 32 px、没有虚拟化；`Tree` 支持多选但没有行插槽与虚拟化。本 Task 要多选、节点“打开区与展开箭头分开”、几千项的虚拟列表，所以写资源管理器私有的虚拟树；沿用 nb-ui 的焦点环、选中与悬停的状态 token 与箭头图标，不另写近似样式。拖动反馈组合 `DropFeedbackOverlay`。不往 nb-ui 加通用树。
- `FilesExplorerView.vue`：视图根，三段网格——工具栏固定、树 `minmax(0, 1fr)`、结果区限高可收起并独立滚动。工具栏：新建文件、新建文件夹、刷新、全部收起、显示清单文件（切换），按钮执行第 1 节的命令。
- `ExplorerTree.vue`：虚拟列表。
  - 行高取主题的 `--control-h-sm`（26–28 px，能装下 `FormInput` 的 `sm` 与焦点环）：CSS 与计算窗口的 JS 读同一个解析值，主题或字号变了重算。不支持变高行。
  - 渲染集合是视口加上下各 10 行余量，再加上焦点行与正在编辑的行（它们滚出视口也保持挂载）。视口尺寸用 `useLayoutExtent` 取，尺寸变化与重新可见时重算；停放时的零尺寸不覆盖记住的滚动位置；用首个可见行的地址与行内偏移作滚动锚点，前方插入删除、折叠后夹到合法区间。滚动容器是本组件自己的原生元素，用现有细滚动条样式与 `scrollbar-gutter: stable`，不套 `ScrollArea`。
  - 无障碍：列表 `role="tree"`、`aria-multiselectable`、`aria-label`；行 `role="treeitem"`、`aria-level`、`aria-setsize`、`aria-posinset`、`aria-expanded`、`aria-selected`，id 稳定；焦点用 `aria-activedescendant`，键盘移动先把目标滚入视口并确认挂载，再更新它。状态行不冒充资源（`role="none"` 加说明文字）。
- `ExplorerRow.vue`：缩进、展开箭头（与打开区分开）、图标（按类型与文件夹类型）、单行的标签与副标题（完整路径经提示与可访问描述取得）、状态标记（缺失、未列入、无正文、剪切中、需要剧情插件）、内联输入（新建与改名，`FormInput` 的 `sm`）。名字错误用不占行布局的关联提示（`aria-invalid`、`aria-describedby`），编辑行不变高。
- `ExplorerFeedback.vue`：结果区。一次操作有失败、跳过、未执行、取消、结果未知或清单没改成时列出逐项结果（源、目标、原因；目录复制的残留范围与“已省略”标记；`truncated` 显示“结果已省略，请重新列出核对”）；全部成功不打扰。长路径折行，区域限高内滚。
- **对话框**（nb-ui `AlertDialog`、`Dialog`，尺寸按视口限定，只有受影响项清单内部滚动，按钮始终可见）：删除确认（列出最外层的受影响项与数量，说明不可恢复，默认焦点在取消）；碰撞（同名时改名并预填候选名、跳过、取消剩余；“对其余同名项都这样”；显示真实源与目标）；展示名与图标（内容文件夹）。
- **焦点去向**：控制器记逻辑焦点地址，不记 DOM 元素。对话框在 `closed` 之后处理：取消回原焦点行；删除成功到下一个存活的同层项，没有则上一个，再没有则父目录或根。内联编辑 Enter 提交、Escape 取消且不冒泡、中文输入法组字中的 Enter 不提交；完成或取消后焦点回树并校正 `aria-activedescendant`。对话框期间视图被隐藏时不抢回焦点。
- **右键菜单的键盘**：补齐 nb-ui `ContextMenu` 的键盘与焦点合同（打开时聚焦首个可用项，上下、Home/End、Enter/Space、ArrowLeft 收起子菜单、Escape 关闭并发出 `close`；焦点归还仍由宿主做），同步它的 `.md`、测试与 Lab 场景。菜单关闭后再开始内联编辑或对话框，不让两层同时争焦点。
- 文案中英两份写在一起（`messages.ts`），按显示语言取。

### 5. 动作与操作意图（`web/actions/`）

- **打开**：执行 `nbook.editor.open {address, mode: "preview" | "permanent"}`（单击 preview，双击与 Enter permanent）；选中与焦点在调用之前同步切换。命令未登记（编辑器区随 t71）时结果区显示“编辑器尚未接入”，不伪装成功。节点行的打开区打开它的 `index.md`；无正文的节点只选中。
- **新建**：目标目录是选中的目录、选中文件的父目录，无选择时当前根；在目标下插入一行内联输入，确认后 `create`；内容文件夹里新项插到选中项之前（`before`）。名字为空、含 `/` 或冲突在输入框原位提示，不关闭输入。
- **改名**：内联输入；开始改名时 `identify` 冻结令牌，提交带 `expected`。内容文件夹里“改名”改真实名字，“修改展示名”只改清单。
- **删除**：执行命令时冻结选择（父子只留最外层）并 `identify`，确认后批量 `delete` 带令牌。
- **创建内容、转换、清单修正、排序**：节点无正文时“创建内容”（`createContent`，排他创建空白正文，已有不覆盖）；目录有“转为内容文件夹 / 转为普通文件夹”；未列入项“加入清单”，缺失条目“从清单移除”；内容文件夹里“上移 / 下移”（首末项不可用）与拖动排序共用同一个纯变换（`reorder-plan.ts`）与 `reorder` 调用。多选的上移下移保持选中项的相对顺序整体移动一位。
- **操作意图**（`intent.ts`）：粘贴、拖动与删除都先变成一份冻结的意图——操作 id、逐项的源地址与令牌、实际目标、预判的碰撞处理——再提交批量。批量结果按意图里的下标对应源与目标，之后的选择、刷新和地址改写都不影响结算。
- **剪贴板**（`clipboard.ts`）：本窗口内一份 `{mode: copy | cut, items: [{id, address, token}], project}`，不存字节、不碰系统剪贴板。复制与剪切时 `identify` 冻结身份；剪切的源在树里标出，`clear-cut`（Escape）清除。
  - 源被改名或移走时**不**改写剪贴板里的地址：令牌在改名后不变，改写地址会让旧意图投到新位置。对应项在树里不再有剪切标记；粘贴时服务端判为 `source-changed`，结果区说明“源已被替换或移走，请重新选择”。
  - 粘贴目标：右键的目录，选中文件的父目录，无选择时当前根；多个选中目录时不猜，要求先选一个。确认界面显示实际源与目标，之后焦点变化不改投。跨方案的项拒绝并说明（不跨根搬运）。
  - 粘贴前用目标目录的列出结果预判同名，逐个问改名、跳过或取消；提交仍由服务端排他重验（预判之后被占用照样是该项冲突）。
  - 剪切粘贴按意图里的项 id 逐项结算：成功的从剪贴板移除，失败与跳过的保留；剪贴板在此期间被换成新内容时，迟到的结果不动新剪贴板。复制可重复粘贴。
- **拖动**（`drag.ts`，照外壳拖动会话的做法）：激活门槛与外壳一致（鼠标与笔 6 px、触摸按住 200 ms，超过容差先让给滚动）。激活时冻结源（拖未选行时只拖它）并 `identify`，令牌未齐不能提交；落点按地址与同层前后项表达，不按行索引。落在目录行为移入（批量 `move` 带 `expected`，碰撞同粘贴）；内容文件夹里同一父目录的两行之间为调整顺序；落在自己或后代上不可放。放下时重新判定，只提交与最后显示相同的动作。以下情况取消且零写入：Escape、`pointercancel`、失去指针捕获、窗口失焦、页面隐藏、视图卸载、切换“显示清单文件”、源或落点在拖动中失效。拖动结束吞掉随后的 click。已提交的批量不因这些变化改目标。
- **执行与反馈**：一次只有一个批量在途，结果区显示“进行中”与“取消”（句柄的 `cancel`，结算以 `result` 为准，不以 `cancel()` 的返回为准）。逐项结果、`manifests` 表与 `truncated` 原样呈现。
- **结果未知的门禁**：批量得到 `unknown-outcome` 时操作进入“结果未知”状态，保留它的意图。在用户点“放弃”之前，复制、剪切、粘贴、拖动与删除都不可用（`canPaste` 等键为假，命令返回 `unavailable` 与原因），单项的新建与改名照常。结果区给“重新列出”（只核对，不解除门禁）与“放弃”（说明不会取消仍可能在后台执行的操作）；放弃后清掉这份意图与它的剪贴板。
- **dirty 文档**：复制、移动、删除前要问文档拥有者（复制选“先保存 / 复制磁盘版本 / 取消”，移动结算输入并等在途保存，删除列出 dirty 文档）。编辑器区随 t71，本 Task 在控制器里留一个 `DocumentCoordinator` 端口，缺省实现直接放行；t71 接上文档模型。

### 6. 持久化（`web/preferences.ts`）

- 记录归 `nbook.explorer`（Storage 的 owner 是调用插件）。新应用未发布，旧应用的 `workbench.files` 记录不迁移（[插件的数据与状态](../../../../../docs/proposals/plugin-data-model.md) 已定），S0 按此改 files-explorer.md 里保留旧 owner 与 key 的文字和验收。
- “显示清单文件”：`explorer.preferences`，`scope: user`、`locality: local`，值 `{showManifests: boolean}`，缺失时为 `false`。
- 项目树的展开：`explorer.expanded`，`scope: project`、`locality: local`，值 `{paths: string[]}`。用户资产树的展开：`explorer.user-expanded`，`scope: user`、`locality: local`，同形；没打开项目时也保存（用户资产跨项目）。
- 上限每份 2000 条，按分支淘汰：淘汰一个目录时连同它记录里的后代一起去掉，不留下祖先已失的后代。
- 经持久化字段读写；首读完成前不挂树（`ready` 为假），不让缺省值覆盖记录。首读失败时树照常浏览（展开只在内存），给“重新读取”；`corrupt` 与不认识的版本不自动覆盖。保存暂停（确定失败、结果未知、订阅终止）时视图顶部给一条可访问的“展开与显示偏好未保存”，带“重试”（`retry`；打开失败与订阅终止先 `reopen`）与“放弃”（`discardAll`，显示回落到已保存的值）。暂停期间同一记录的新意图合并为最后一份。

### 7. 窗口与项目

- 没有绑定项目：项目根位置显示“尚未打开项目”与“打开项目”按钮（执行 `nbook.project.open`），不发文件写入；`user://` 照常可用。
- 项目代次结束（订阅 `ended`、请求 `target-gone`）：树标为已失效，不再发起写入、写命令不可用，显示原因；未提交的意图取消，迟到的旧结果丢弃；切换项目整页重新加载。

### 8. Lab

- Lab 场景 `explorer-scene`（S2 登记，之后各片补场景）：挂真实的 `FilesExplorerView`、控制器与树模型，文件客户端换成 Lab 的内存适配器。适配器实现控制器实际调用的全部方法——列出、监视、`identify`、单项操作、三种批量与取消——操作真正改变场景数据并发出同形事件；没用到的方法返回 `unavailable`，不假报成功。场景数据：三类文件夹、清单错误、读取失败、空目录、大目录，以及部分失败、清单没改成、结果未知、取消的批量。不发产品 API 请求，切场景时释放订阅与意图。

## Spec 与文档改动（S0）

| 文档 | 改什么 |
|---|---|
| `docs/specs/workbench/files-explorer.md` | 插件与视图（`nbook.explorer`、位置、`layout`）；命令表、公开键与键位的 `when`；当前根；右键菜单固定、`explorer/context` 与视图标题动作推迟；清单投影条件与活页夹提示；失效规则；结果区与“结果未知”门禁；内联新建与改名；剪贴板不跟随改名；粘贴目标、碰撞对话框；拖动的冻结、落点与取消表；焦点去向；持久化记录（owner、两份展开记录、不迁移旧记录、保存暂停的呈现）；打开命令的参数；dirty 结算随 t71；验收按下文“验收映射”的子判据改写 |
| `docs/specs/workbench/commands.md` | 域词表加 `files`；命令目录（资源管理器）一节；`refresh-files` 的触发面先是视图内工具栏 |
| `packages/nb-ui/src/components/feedback/ContextMenu.md` | 键盘与焦点合同（S3 随实现） |

## 切片

三层测试分工：Bun 的 `*.test.ts` 用真实内核的 `filesScene` 与真实磁盘测树模型、控制器与动作；Node 的 `*.dom.test.ts` 测受控组件（行数据由真实投影给出，点击、按键、输入、ARIA 与对话框交接）；Playwright 的 `e2e/files-explorer.e2e.ts` 测产品装配、Storage 重载恢复、虚拟滚动几何与指针拖动。`filesScene` 加载 `bun:ffi`，不进 Node 的 DOM 测试。

| 片 | 对应设计 | 提交边界 | 自跑验证 |
|---|---|---|---|
| S0 | Spec 表 | Spec 修订 | `docs:check`、`governance:check` |
| S1 | 第 2、3 节，第 5 节的打开 | 树模型（槽、失效规则、投影、选择与按键纯函数）、控制器的浏览部分；`filesScene` 增加经真实链路的帧记录与结果交付闸门 | Bun：列出与展开、三类文件夹投影、嵌套清单一次改动更新所有已展开层、正文增删更新父行、展开目录改名、列出在途时外部变化与改名删除重建、`resync`、`ended`、未绑定项目；选择与按键纯函数表；打开发出的命令与模式 |
| S2 | 第 1、4、6、7 节（浏览部分），第 8 节起步 | 插件、视图、命令（新建除外的浏览类）、公开键、虚拟树、工具栏、持久化、未打开项目与失效、Lab 场景 | DOM：行与 ARIA、焦点保持挂载、内联输入不被树快捷键拦截；Bun：持久化分支淘汰；e2e：真实侧栏滚动的可见行与 `aria-activedescendant` 目标存在、重载后展开与显示偏好恢复、首读错误与保存失败的呈现、未打开项目；`typecheck` |
| S3 | 第 4 节（菜单与对话框）、第 5 节（单项、删除、排序、反馈） | 右键菜单与 nb-ui `ContextMenu` 键盘、内联新建与改名、删除确认与批量、创建内容、转换、展示名、清单修正、上移下移、结果区、焦点去向 | Bun：每个动作的磁盘与清单结果、零写入判据；DOM：确认框默认取消与关闭后焦点、内联编辑键与输入法组字、菜单键盘；e2e：只用键盘创建内容、改展示名、修正清单 |
| S4 | 第 5 节（意图、剪贴板、拖动、门禁） | 操作意图、剪贴板、粘贴目标、碰撞对话框、拖动移动与排序、结果未知门禁 | Bun（锁屏障）：首项事件先于批量结果、在途刷新与换剪贴板、源改名后旧意图拒绝、同路径换成同字节资源拒绝、两窗口隔离、未知后再粘贴不发第二批；DOM：碰撞对话框各按钮；e2e：拖动移入与排序、拖动中切换显示与滚动后释放零写入 |
| S5 | 收口 | Lab 场景补齐、截图证据、Spec 标注、三个 omp 实现审查与修正 | 全量 e2e、`smoke:server`、`test:affected --since`、`typecheck`、`docs:check`、`governance:check` |

## 验收映射

每行是一个可单独失败的子判据，自跑时各配一个让它失败的变异。“零写入 / 不读正文”的判据看经真实链路记录的 Files 方法帧：先等动作结算，再在同一根写一个屏障文件、等到它的事件，然后断言期间没有对应的方法帧；磁盘字节不变只作补充（同字节保存会换 inode、发事件）。取消等 `result` 结算，对话框等 `closed`，不按毫秒等待。

| files-explorer 验收 | 子判据 → 入口与完成条件 | 层 | 片 |
|---|---|---|---|
| 1 | 普通目录真实名、`index.md` 成行，展开期间没有 `read` 帧 | Bun、e2e | S1、S2 |
| 1 | 内容文件夹标签、顺序、副标题；外部改根清单后嵌套层标题更新 | Bun、DOM | S1、S2 |
| 1 | 节点正文不单列、节点行打开区打开其 `index.md`；清单不合法时退回普通显示且 `index.md` 可见 | Bun、DOM | S1、S2 |
| 1 | 活页夹按普通目录并提示；`binder.xml` 按普通文件显示 | Bun | S1 |
| 1 | 根行没有改名、移动、删除；用户资产根首次折叠 | DOM、e2e | S2、S3 |
| 1 | 只列根与可见的恢复路径；远处行滚入视口、焦点目标存在 | Bun、e2e | S1、S2 |
| 2 | 点普通目录只展开；箭头与节点打开区分开；无正文节点只选中 | DOM、e2e | S2 |
| 2 | 创建内容：零字节正文、已有不覆盖、失败后节点仍为无正文 | Bun | S3 |
| 2 | 浏览、展开、切换显示不发 Files 写帧 | Bun | S1、S2 |
| 3 | 方向键、Space、Ctrl/Meta、Shift、A、右键选择规则 | 纯函数表、DOM | S1、S2 |
| 3 | 单击 preview、双击与 Enter permanent；修饰点击不打开 | DOM | S2 |
| 3 | 内联输入与编辑元素里按 Delete、F2、复制剪切粘贴不被树拦截 | DOM、e2e | S2、S3 |
| 4 | 显示偏好缺省隐藏、重载后同一记录恢复；切换时选择与展开不变 | e2e | S2 |
| 4 | 切换显示取消未提交的菜单与拖动，已提交的批量按原目标结算 | Bun、e2e | S4 |
| 4 | 排序（拖动、上移下移）与展示名只改清单，正文与附件路径和字节不变 | Bun、e2e | S3、S4 |
| 5 | 复制可重复粘贴；剪切按意图逐项清除、失败保留；Escape 清标记 | Bun、DOM | S4 |
| 5 | 源改名、同路径换成同字节资源后旧意图为 `source-changed`；项目结束后旧意图不发写 | Bun | S4 |
| 5 | 另一窗口不能粘贴本窗口的意图；输入框里的复制粘贴不改文件意图 | Bun、DOM | S4 |
| 6 | 三类粘贴目标在 project 与 user 两根各一次；多目录不猜；跨根拒绝且两端不变 | Bun、DOM | S4 |
| 6 | 父子与重复源只做一次；整目录复制带正文与附件 | Bun | S4 |
| 6 | 自身后代拒绝；同目标移动无操作且屏障后无业务事件 | Bun | S4 |
| 7 | 碰撞改名、跳过、取消剩余、“对其余同名项”；同目录复制保留源 | Bun、DOM | S4 |
| 7 | 对话框开着时外部占用目标，确认后仍为冲突；拖动与粘贴同一流程 | Bun、e2e | S4 |
| 8 | 复制残留范围可见；普通失败后独立项继续；提供方停止后余项未执行 | Bun、DOM | S3、S4 |
| 8 | 取消不回滚已完成项；结果未知后再粘贴不发第二批，放弃后才可用；`truncated` 显式提示 | Bun、DOM | S4 |
| 10 | 未绑定、加载中（交付闸门）、空目录、读取失败、权限与失效各自呈现；失效后写命令不可用、旧结果丢弃 | Bun、DOM、e2e | S1、S2 |
| 11 | 只装 Files 与资源管理器的产品装配里浏览、展开、切换，领域文件零写帧且字节不变 | e2e | S5 |
| 13（Lab 部分） | 同一视图与控制器在 Lab 里删除与剪切粘贴改变场景数据；切出再回不保留旧订阅与意图；没有产品 Files 请求 | Lab e2e | S2、S5 |
| 9、12、13（跨机器） | 9 随 t71；12 随 t72；跨机器不在本 Task | — | — |

## 验证

- 每片：上表的自跑验证与变异检查。测试用真实内核、真实磁盘与真实浏览器，不用 mock、spy、假计时器与固定等待；竞态用真实锁与结果交付闸门制造（闸门只推迟真实结果的交付，不改结果）。
- 收口：全量 e2e、`smoke:server`、`test:affected --since`、typecheck、`docs:check`、`governance:check`；产品页截图（四主题 × 明暗、390 px，含长路径、大批量失败与删除确认）作证据。
- 未验证边界：读屏软件的实际朗读（只验 ARIA 结构与 Chromium）；跨机器的基础操作；性能标准（t72）；dirty 文档的结算（t71）。

## 不做与风险

- 不做：编辑器区与打开后的文档（t71）；性能测量与修正（t72）；`explorer/context` 开放贡献点与视图标题动作；活页夹的专用呈现（剧情插件）；旧应用记录的迁移；系统剪贴板互通；跨根复制与移动；nb-ui 的通用虚拟树。
- 风险：资源管理器的拖动与外壳的拖动会话是两套指针处理；两者都在指针按下时判断归属，树内按下不进外壳会话。
- 风险：命令数量多（17 条），菜单、工具栏、键位都只引用 id；如果命令执行管线的开销在大量选择时可见，t72 测量后再定。
