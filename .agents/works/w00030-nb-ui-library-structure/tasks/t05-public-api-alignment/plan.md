# t05 实施计划：nb-ui 公开 API 一次对齐

## Context

- **为什么做**：w00029 t05 的库审查（[`lib-review.txt`](../../../w00029-nb-ui-cleanup/tasks/t05-docs-and-specs/evidences/lib-review.txt)，条目 L01 到 L24）指出同一件事在 nb-ui 里有几套写法：打开态有 `v-model`、`visible`、`open` 三种，关闭原因三个组件各一套，尺寸有 `default` 与 `md` 两个名字，语调有 `error` 与 `danger`、`default` 与 `neutral`，文案属性有 `xxxText` 与 `xxxLabel`。[t01 总计划](../t01-plan/plan.md) 的“t04：公开 API 对齐”一节定了整改内容与迁移表；t04 编号后来给了字号恢复，本 Task 接过这一节。
- **开发者已确认**：
  - 2026-10-20（t01 评审板）：不留旧名别名，调用方同一个提交里一起改；改名前先打开 Vue 的未知属性与事件检查；L11、L13、L15、L17、L19 的单例改造、L20 不做。“不做全局文案注入”已被 w00028 取代。
  - 2026-11-02（会话）：下次发版 nb-ui 升 0.4.0、应用与 SDK 升 minor，不留一个版本的别名；`Dialog` 的 `confirm` 也不再看监听器自动关闭；`AlertDialog.tone` 另一档叫 `neutral`。
- **2026-11-02 按当前 master 重新核对**：t01 计划写于 10-20，之后 nb-ui 又有 26 个提交。变化最大的三处：
  - w00028 把组件的默认文案迁进了 nb-ui 目录、缺省走翻译端口（`src/text/`、`src/locales/`），文案属性只剩“覆盖默认值”这一个用途；
  - w00032 t09 给对话框与浮动窗口加了嵌套分档（`NB_DIALOG_LAYER`、`NB_DIALOG_WINDOW_DEPTH`、`nb-ui-dialog-surface--nested`）；
  - nb-ui 已以 `@notnotype/nb-ui` 发到 npm（0.2.0、0.3.0），插件 SDK 的 `components` 入口把 nb-ui 组件交给插件作者用。公开 API 改名是一次对外不兼容版本。
- **设计审查**（2026-11-02，Sonnet 17 条、omp 8 条，处理见 [`evidences/design-review.txt`](evidences/design-review.txt)）改掉了初稿的四处：不抽 `ModalShell` 组件，改为共享层级 composable 与遮罩样式；关闭原因保留“取消”与“关闭按钮”的区分；不设强制的 `ListItemBase`；`ContextMenu`、`Menubar` 的传送目标与 `Dialog` 的最上层判定不改。
- **工作方式**：worktree `.worktree/w00030-t05-api-alignment`（分支 `refactor/w00030-t05-api-alignment`），逐片提交；Task 记录只在主工作区改。不改 `packages/neuro-book-legacy`。

## 核对结果（原 t04 条目 → 当前 master → 本 Task）

| 条目 | 当前状态 | 本 Task |
|---|---|---|
| 未知属性、事件检查 | 各宿主 tsconfig 都没开 | 做（S0），另列动态绑定清单人工核对 |
| 打开态统一 `open` | `Dialog` 是 `modelValue`，`ContextMenu` 是 `visible`；其余已是 `open` | 做 |
| 关闭原因与事件 | 三套原因类型；`close` 与 `request-close` 两种请求事件名 | 做，见第 5 节事件表 |
| `ModalShell` | 没有 | 改为第 5 节的 `useOverlayLayer` 与 `.nb-ui-overlay` |
| `FloatingWindow` 拆分 | 没拆；几何在 `useFloatingWindow.ts` | 做 |
| `Dialog` 看监听器决定关不关 | `request-close`、`confirm` 两处 | 做 |
| 最上层判定改用叠放序号 | 读 reka 可关闭层 | **不做**：序号回答不了“上面有没有下拉”，`Dialog.test.ts` 已锁定现有行为 |
| 尺寸词表 | `Input`、`NumberInput` 有 `"default"` | 做 |
| 语调 | `Notification`、`Banner` 用 `error`；菜单项、`SegmentedControl` 用 `default` | 做 |
| `placement` → `side` | `Tooltip`、`InfoTip`、`SuggestionMenu` | 做；`SuggestionMenu` 保留 `auto` |
| `AlertDialog.tone` 收窄 | 三档 | 做 |
| `DropdownMenu.popoverStyle`、`contentProps` | 仍在 | 开工时逐处看：没有调用方就删，有就迁移 |
| 文案属性 `xxxLabel` | `AlertDialog` 是 `confirmText`、`cancelText`；`Drawer` 关闭按钮无名称 | 做 |
| 列表数据形状 | 菜单 `value`、`shortcut`、`iconClass`；`Select` 的 `indicatorClass` | 做，按组件逐个定，见第 4 节 |
| L07 第 2 点（提示压过菜单） | 对话框外已分档（70 对 60）；对话框内同为 9010 | **不做**，见“不做与风险” |
| L07 第 4 点（传送目标缺省） | `ContextMenu`、`Menubar` 写死 `body`，`SuggestionMenu` 缺省 `body` | **不做**（S4 做了 `SuggestionMenu`，S5 整套 e2e 发现它在 Lab 里越出舞台、被顶栏盖住，撤回） |
| L14 第 4、5 点（入口） | `./grid` 与 `./layout` 并存 | 做 |
| L19（`NotificationTone` 重复） | 已只有一份 | 不用做 |

## 关键设计

### 1. 前置：未知属性与事件检查（各宿主 `tsconfig`）

- 给 neuro-book、nb-story、dev-panel、nb-form、nb-agent-ui、nb-markdown 与 nb-ui playground 的 `vueCompilerOptions` 打开 `checkUnknownProps`、`checkUnknownEvents`（工作区的 vue-tsc 3.3.7 与 nb-ui 自己的 2.2.12 都支持）。先单独一个提交清掉现有报错，只修报错不改名。有意透传的 `data-*`、ARIA、class、style 不算误报；若某组件的透传产生成批报错，在该组件声明透传而不是关掉检查。
- 静态检查管不到动态绑定。S0 同时列出动态绑定清单：`v-bind="对象"` 传给 nb-ui 组件的地方（例如 Lab 的 `ContextMenuFixture.vue` 的 `subject.bindings`）与 `<component :is>` 渲染 nb-ui 组件的地方（例如 `nb-form/src/vue/NodeField.vue` 的 `controlProps`）。每一片改名时逐处核对这些对象的键。
- 每一片的完成判据是“旧名零命中”加“动态绑定清单逐处核对”，不是调用方总数。迁移表每行附可重跑的 `rg` 命令。

### 2. 共享词表（`packages/nb-ui/src/components/shared-types.ts`，从 `./components` 导出）

- `ControlSize = "2xs" | "xs" | "sm" | "md" | "lg"`（`IconButton` 有 `2xs`）。各组件声明子集（`type InputSize = Extract<ControlSize, "sm" | "md">`）。`Input`、`NumberInput`、`Select`、`SearchSelect` 的 `"default"` 删掉，缺省 `md`（它们只区分 `sm`，`default` 与 `md` 同尺寸）。`DialogSize` 的 `default` 是一档真实宽度（420px，在 sm 与 md 之间），是面板宽度刻度，不并入 `ControlSize`，不改（S1 实施时补）。
- `Tone = "neutral" | "accent" | "info" | "success" | "warning" | "danger"`，各组件声明能渲染的子集，不渲染的档不进类型。逐组件映射：
  - `Notification`、`Banner`：`error` → `danger`。应用里把 `"error"` 存进 `BannerTone` 的边界（`EditorGroup.vue`）一并改。
  - 菜单项（`DropdownMenuItemData`、`ContextMenuItem`、`Menubar` 项、`MenuNodes` 的泛型约束）：`tone: "default" | "danger"` → `"neutral" | "danger"`。
  - `SegmentedControl`：`tone` 与选项的 `tone` 从未渲染（它的 `.md` 已列为已知偏差），按“不渲染的档不进类型”整个删掉（S1 实施时改）。
  - `NotificationTone` 在 `Notification.vue` 与 `composables/useNotification.ts` 各有一份，L19 并没有做完；收成 `useNotification.ts` 一份。工作台通知服务（`docs/specs/workbench/notifications.md`）的色调仍是 `error`，属于应用合同，不在本 Task 改，在交给 nb-ui 队列时映射成 `danger`（S1 实施时补）。
  - `AlertDialog`：`"danger" | "neutral"`；现有 `tone="warning"` 的 3 处（与 `neutral` 外观相同）改 `neutral`。
  - 不改：`CollapsibleRow`、`CollapsibleCard` 的 `status: "error"` 是运行状态，nb-form 的问题严重度是另一个域。
- 弹出位置：`Side = "top" | "right" | "bottom" | "left"`、`Align = "start" | "center" | "end"`。`Tooltip`、`InfoTip` 的 `placement` 改 `side`，加 `align`；`SuggestionMenu` 的 `placement` 改 `side`，类型是自己的 `SuggestionSide = "auto" | "top" | "bottom"`（`auto` 是它自己的选边算法），`align` 不开放。各组件的 `align` 缺省保持现值。`nb-agent-ui/src/registry.ts` 的 `placement` 是工具栏按钮位置，与此无关，不改。
- `OverlayCloseReason`，见第 5 节。

### 3. 文案属性（`feedback/`、`form/`、`navigation/`、`layout/`）

- 按钮与可访问名称一律 `xxxLabel`，说明文字一律 `xxxText`。`AlertDialog` 的 `confirmText`、`cancelText` 改为 `confirmLabel`、`cancelLabel`。
- 属性只用来覆盖；缺省值走 w00028 的目录（`text("…")`，键加在 `src/locales/` 各语言目录，四个共享包目录的一致性测试查漏）。
- `Drawer`：关闭按钮补 `closeLabel`（缺省 `text("drawer.close")`）；没有 `title` 时补一个只给读屏的标题（缺省 `text("drawer.untitled")`），与 `Dialog`、`QuickPick` 一致。
- 读屏名称的覆盖属性只补 `Breadcrumb` 的 `ariaLabel`（同一页可能有多条，要各自的名字）；`Slider` 已有；`ColorPickerPanel`、`Splitter` 的名称按内部结构生成并已走翻译端口，逐个实例覆盖的需求很小，不加（S1 实施时定）。

### 4. 列表数据形状（`popup/*.types.ts`、`popup/Select.vue`）

开发者 2026-11-02 定（S2 开工前核对现状后）：`iconClass` 与菜单的 `shortcut` 都不改名。

- `iconClass` 是 nb-ui 通行的名字（26 处：`Button`、`IconButton`、`Badge` 等的属性与各列表、`Tabs`、`Tree` 的字段，宿主模板约 173 处）；只改列表项会造成“按钮写 `iconClass`、菜单项写 `icon`”两套写法，全改则改动面翻几倍而收益只是名字更短。`iconClass` 也更准确：它是 CSS 类名，不是图标组件。
- 菜单项的 `shortcut` 装的就是快捷键，`QuickPick` 也叫 `shortcut`；`SuggestionMenu` 的 `hint` 装路径或说明，含义不同。改成 `hint` 会让“快捷键”有两个名字。

照做的部分：

- `DropdownMenu`、`Menubar` 的项 `value` 改 `id`（项的身份，与 `QuickPick`、`SuggestionMenu` 一致）；`Select`、`SearchSelect` 选项的 `value` 是提交值，不改。
- `Menubar` 项的 `type: "default"` 改 `"item"`（`DropdownMenu` 已经是 `"item"`）。
- `Select` 的 `indicatorClass` 改 `tone`（`Tone` 全六档，色点用 `--text-muted`、`--accent-main`、`--status-*`）；生产调用方 0 处，Lab 夹具与 `form-controls.contract.test.ts` 按设计改。
- 不设强制的公共列表接口：六种列表的身份、提交值与动作语义不同。
- 同一片修掉 master 上原有的 6 条弹出列表 e2e 失败：5 条行高断言按 t04 的 30px 改；`suggestion-menu.spec.ts` 那条是分组标题的行高带小数（12px × 1.3 = 15.6px，t04 改字号后出现），整列内容高出零点几像素，而滚动容器的 `scrollHeight` 是取整的，最后一项差 0.19px 滚不进视口；分组标题行高向下取整到像素（实测定位：项的下沿 508.19、视口下沿 508、已滚到底）。

### 5. 浮层合同（`feedback/`、`popup/`、`composables/`）

**打开态**：一律 `open` 加 `update:open`。

- `Dialog`、`FloatingWindow`、`QuickPick`、`ContextMenu` 是受控的：`open` 必填、普通属性，不用 `defineModel`。组件只发请求，不自己翻转；宿主没接 `update:open` 时保持打开，不会出现“子组件看着关了、宿主以为开着”的分叉。
- `AlertDialog`、`Drawer`、`Popover`、`DropdownMenu` 已经支持不受控（带触发器），保持现状。

**事件**：

| 事件 | 含义 | 谁有 |
|---|---|---|
| `request-close(reason)` | 请求关闭，宿主可拒绝 | `Dialog`、`FloatingWindow`、`QuickPick`、`ContextMenu`（后两者的 `close` 改名为它） |
| `update:open(value)` | 打开态变化 | 全部 |
| `closed` | 退场完成 | 全部（`Dialog`、`Drawer`、`ContextMenu` 补上） |
| `confirm` | 页脚确认按钮 | `Dialog`、`AlertDialog` |

- S3 拆成两次提交：S3a 打开态、事件与关闭原因；S3b `FloatingWindow`、`useOverlayLayer` 与遮罩样式。
- `Dialog` 的 `cancel` 事件删掉，取消按钮走 `request-close("cancel")`。`AlertDialog` 的 `cancel` 保留（reka 的取消按钮直接关闭，不经请求）。
- `Dialog`、`FloatingWindow`：先发 `request-close(reason)`，`closeOnRequest`（缺省 `true`）时随即发 `update:open(false)`；宿主要拦（脏表单、守卫）时传 `:close-on-request="false"` 并自己处理。`confirm` 只发事件，不关闭。两条都不再看有没有监听器。
- `AlertDialog`、`Drawer` 由 reka 直接关闭，不提供可拒绝的请求；`AlertDialog` 的确认与取消照旧自动关闭（reka 的 Action、Cancel），这与 `Dialog` 不同，写进两者的 `.md`。

**关闭原因** `OverlayCloseReason = "escape" | "outside" | "close-button" | "cancel" | "select" | "tab"`，各组件声明子集：

| 组件 | 原因 |
|---|---|
| `Dialog`、`FloatingWindow` | `escape`、`outside`（旧 `overlay`，窗口没有）、`close-button`、`cancel` |
| `QuickPick` | `escape`、`outside` |
| `ContextMenu` | `escape`、`outside`、`select`、`tab` |
| `AlertDialog`、`Drawer` | 不发原因：由 reka 直接关闭，只发 `update:open`；`Drawer` 的滑动关闭同样只发 `update:open` |

旧值 `esc` → `escape`，`overlay` → `outside`，其余同名。`DialogCloseReason`、`ContextMenuCloseReason`、`QuickPickCloseReason` 保留为 `OverlayCloseReason` 的子集：宿主的处理函数需要精确的类型（S3 实施时改，原计划是删掉）。

**层级与遮罩：不抽外壳组件。** 四个浮层的遮罩与传送必须用各自 reka 原语族的 `*Overlay`、`*Portal`（`AlertDialogContent` 的 `role="alertdialog"`、焦点落取消、外部不关，`DrawerOverlay` 的滚动锁与滑动变量都挂在原语上），共用的只是层级逻辑与外观：

- 新增 `composables/useOverlayLayer.ts`：`useOverlayLayer({kind: "modal" | "window", open})` 返回 `{zIndex, nested, popoverZIndex}`，负责 `NB_DIALOG_LAYER` 与 `NB_DIALOG_WINDOW_DEPTH` 的读取与下传、`useModalLayer` 叠放、`provide` 浮层层级。只在“持有面的组件”（`Dialog`、`AlertDialog`、`FloatingWindow`）的 setup 里调用一次；模态照旧把窗口深度原样下传。`Drawer` 用它的叠放与浮层层级，但不读写嵌套层数、不加 nested 类；`QuickPick` 不用它，层级保持 `NB_Z_INDEX.commandPalette`（9200）。
- 遮罩只共用入退场：`.nb-ui-overlay` 的一对淡入淡出关键帧，写在 `styles.css`，各浮层把类挂在自己的 `*Overlay` 上。底色与模糊各浮层保留自己的（`Dialog` 的 `overlayType`、`AlertDialog`、`Drawer` 的 4px 模糊），外观不变；`AlertDialog`、`Drawer` 遮罩上产物里不存在的 `animate-in`、`fade-in-0` 一类删掉，它们原来实际上没有动画。内容区的入退场不在本 Task（S3b 实施时改：原计划的 `data-overlay` 变体会改变某一方的外观）。
- `Dialog` 的最上层判定（`onTop`，读 reka 可关闭层）保持不变。

**`Dialog` 拆分**：

- `Dialog` 只做模态；新增公开组件 `FloatingWindow`（`resizable`、`minWidth`、`minHeight`、`update:width`、`update:height`、`initialFocus`，几何用现有 `useFloatingWindow.ts`）。`modal` 属性删掉。`Dialog.teleportTarget` 保留 `string | false`：nb-agent-ui 的图片预览把自己的 `false` 原样传给模态 `Dialog`，旧组件的模态用法也支持（S3b 实施时改，原计划是收窄成 `string`）。
- 内部外框 `DialogSurface.vue`（不导出，有同名 `.md`）：单根、透传 attrs，`defineExpose({panel, body})`；属性是外观子集（尺寸、标题、页头页脚开关、`nested`），不含关闭逻辑；窗口专属的拖动区与缩放手柄由 `FloatingWindow` 经插槽放入。`nested` 由调用方从 `useOverlayLayer` 传入，`DialogSurface` 自己不 inject。
- 保持不变的合同（测试与宿主样式在读）：`data-dialog-surface`、`data-dialog-window`、`data-dialog-overlay`、`data-dialog-drag`、`data-dialog-resize`、`data-dialog-body`、`data-dialog-status`、`.nb-dialog__header`、`--nb-dialog-close-room`。
- `FloatingWindow.md` 写明使用约束：窗口层级带（8990 起）在模态之下，不要在模态里打开窗口；兄弟窗口不互相置顶；深度上限 5 层，`useOverlayLayer` 钳制并给开发诊断。

### 6. 其余（`popup/SuggestionMenu.vue`、`package.json`）

- 传送目标缺省（L07 第 4 点）不做：`SuggestionMenu` 改读宿主目标后，在 Lab 画布里越出舞台、被 Lab 顶栏盖住（S5 整套 e2e 的 `lab-markdown` 两条与 `lab-scenes`），撤回；`ContextMenu`、`Menubar` 按视口坐标手算 fixed 位置，Lab 的目标带 `contain: layout`，同样不行。理由写在 `useTeleportTarget.ts` 头注释。
- 入口：`./grid` **不并进** `./layout`（S4 实施时改）：`layout/index.ts` 的头注释写明 `./grid` 给不能带上 Vue 与 DOM 的消费者（插件激活时建的模型、Bun 里的测试），`./layout` 含 `NestedGrid` 等组件，合并会把 Vue 带进无 DOM 的编译组；编辑器的 `groups.ts` 就是有意从 `./grid` 导入。README 已写明组件只从 `./components` 取，根入口 `.` 不加组件重导出。

### 7. 对外：SDK、迁移说明与发版清单

- **SDK 白名单**（S4 实施时另补了原来漏掉的 `FieldContext` 与 `Splitter`、`NestedGrid` 手势类型）：`packages/neuro-book/src/sdk/components.ts` 是手写的值与类型白名单。加入 `FloatingWindow`、`ControlSize`、`Tone`、`Side`、`Align`、`OverlayCloseReason`；`DialogCloseReason`、`ContextMenuCloseReason`、`QuickPickCloseReason` 保留，是 `OverlayCloseReason` 的子集（与第 5 节一致，S3 实施时改），另加 `FloatingWindowCloseReason`。`sdk.test.ts` 加一条：nb-ui `./components` 导出的公共类型都在 SDK 类型白名单里或在排除表里（值导出已有同类断言）。`pack.ts` 生成的 `docs/components.md` 从白名单读，核对一次。
- **迁移说明** `packages/nb-ui/docs/migration-0.4.md`（S1 起每片完成时追加本片的行）：旧写法 → 新写法的完整表，每行一个前后对照；写明插件缺省 `engines.neurobook` 为 `^<构建时 SDK 版本>`，0.x 下 minor 变化会拒装旧插件，自己写了 `>=` 范围的插件不受保护。nb-ui README 与 SDK README 的组件一节链接它。
- **发版清单**（本 Task 不改版本号，写进迁移说明的末尾与 Task README，发版时照做）：
  - 四个内置主题 `themes/*/manifest.ts` 的 `hostVersion` 改 `^0.4.0`，`src/version.ts` 的 `NB_UI_VERSION` 同步；否则主题装载器按 `^0.3.0` 拒绝全部内置主题。
  - 依赖 nb-ui 的已发布包（nb-form、nb-agent-ui、nb-markdown、nb-story）一起升版本并发布，`workspace:^` 发布后变成 `^0.4.0`；只发 nb-ui 会让旧版共享包把 0.3 装成第二份。
  - 应用与 SDK 升 0.13.0。

## Spec 与文档改动

| 文件 | 改什么 |
|---|---|
| `packages/nb-ui/docs/ui-development-spec.md` | 浮层合同（打开态、事件表、关闭原因）、尺寸与语调词表、文案属性命名、列表字段命名 |
| 各组件同名 `.md` | 属性、事件、类型名；新增 `FloatingWindow.md`、`DialogSurface.md`；`AlertDialog.md` 写保留的 reka 行为 |
| `packages/nb-ui/docs/migration-0.4.md` | 新增，见第 7 节 |
| `packages/nb-ui/README.md`、`packages/neuro-book/plugin-sdk/README.md` | 链接迁移说明；入口说明 |
| `docs/specs/` | 产品行为不变，不改 Spec |

## 切片

| 片 | 关键设计 | 提交边界 | 自跑验证 |
|---|---|---|---|
| S0 | 第 1 节 | 各宿主 tsconfig 与报错处；动态绑定清单写进 Task README | 各宿主 typecheck；一处故意写错的属性确认会报错（不提交） |
| S1 | 第 2、3 节 | nb-ui、调用方、SDK 白名单 | `test:affected --since master --typecheck --with-consumers`；nb-ui e2e |
| S2 | 第 4 节 | nb-ui、调用方、Lab 夹具 | 同上；弹出列表两份 e2e |
| S3 | 第 5 节 | nb-ui、调用方、Lab 夹具与 e2e 入口、SDK 白名单 | 同上；`dialog-surfaces.spec.ts`；新增关闭测试 |
| S4 | 第 6、7 节 | nb-ui、入口调用方、SDK、文档 | 同上；`docs:check` |
| S5 | — | 收口：全量 e2e、Lab 截图对照、实现审查修正 | 见“验证” |

- S1、S2 的规则已在上面逐组件写死，可派 `coder`（Haiku），说明里附迁移表与 `rg` 命令；主会话审 diff、自己跑验证。S0、S3、S4 由主会话做。
- S3 的调用方迁移清单（开工时用 `rg` 重列，下面是 11-02 的核对）：挂了 `@request-close` 的 12 处里，`ProjectInfoDialog`（脏表单点遮罩不关）、`AddProviderDialog`（`cancel` 退回列表）、dev-panel 的 `DeveloperMessageDialog`（`replaced` 时不关）是守卫，用 `v-model:open` 时必须加 `:close-on-request="false"`；其余只传 `:open` 的不受影响。nb-story 的 `ModeNotice` 靠 `@cancel` 得知任何方式的关闭，改为 `@update:open`。没挂 `@confirm` 的只有 Lab 夹具 2 处，补关闭。

## 验收映射

| 行为 | 覆盖 | 层 |
|---|---|---|
| 改了名的旧属性、旧事件在调用方报类型错误 | S0 后各宿主 typecheck；动态绑定清单人工核对 | 类型检查 |
| 每个浮层 × 每种关闭方式发对的 `request-close(reason)` 或 `update:open`；表里不适用的格子显式写出（`AlertDialog` 无 `outside`，`ContextMenu` 无遮罩，`tab` 只有 `ContextMenu`） | 新增 `feedback/overlay-close.test.ts`，表驱动（happy-dom 能真触发 Escape 与外部按下） | 单测 |
| `Dialog` 的关闭不随监听器变化；`closeOnRequest: false` 时只发请求；`confirm` 不关闭 | 同上 | 单测 |
| 受控浮层在宿主不接 `update:open` 时保持打开 | 同上 | 单测 |
| 对话框里开着下拉时点遮罩只关下拉 | 现有 `Dialog.test.ts` 用例原样通过 | 单测 |
| 嵌套分档：一级不带 nested，对话框里的对话框、窗口里的窗口与对话框带；`Drawer` 不参与 | `e2e/dialog-surfaces.spec.ts`，夹具改用 `FloatingWindow`（入口改、断言不动），补“对话框里开 Drawer”“窗口里开 AlertDialog”两个场景 | e2e |
| 浮动窗口拖动与缩放不变 | `lab-nb-ui.e2e.ts`、`settings.e2e.ts` 的现有用例，只改场景 id（`c=Dialog&s=window-resizable` 迁到 `FloatingWindow`） | e2e |
| `closed` 在真实退场后触发；`Drawer`、`AlertDialog` 遮罩关键帧生效 | Lab 里读 `closed` 时机与遮罩动画名，e2e 一条 | e2e |
| 命令面板层级不变（9200，压过通知与右键菜单） | 现有 `QuickPick.test.ts` 加一条层级断言 | 单测 |
| SDK 公共类型白名单完整 | `sdk.test.ts` 新断言 | 单测 |
| `Select` 的 `tone` 色点颜色正确 | Lab 截图对照；色点计算样式等于对应 token | e2e |
| 弹出列表键盘与外观不变 | `popup-lists.spec.ts`、`popup-scroll.spec.ts`、`lab-nb-ui.e2e.ts` | e2e |

需要改入口的测试与夹具（断言内容不动，改动在提交说明里单独列出）：`lab/web/fixtures/nb-ui/feedback.ts`、`DialogFixture.vue`、`ContextMenuFixture.vue`、`lab-nb-ui.e2e.ts`、`playground/app/acceptance/DialogSurfacesFixture.vue`、`components.test.ts`、`SettingsWindow.dom.test.ts`。

## 验证

- 每片按上表自跑；收口跑 nb-ui typecheck、单测与 e2e，`test:affected --since master --typecheck --with-consumers`，neuro-book 整套 e2e。e2e 前停掉多余的开发服务。
- 视觉：遮罩关键帧、`Select` 色点、`FloatingWindow` 拆分、`Drawer` 读屏标题在 Lab 截两主题明暗，改前改后对照。
- 审查：实现审查派 Sonnet（前端）；SDK 白名单与迁移说明派 omp。
- 未验证边界：仓库外已有的第三方插件不检查；版本号与发布不在本 Task；旧应用不检查。

## 不做与风险

- **不做**：
  - L11、L13、L15、L17、L20；应用自己数据类型里的 `iconClass`；版本号与发布。
  - `Dialog` 最上层判定改用叠放序号：序号只登记模态，回答不了“上面开着下拉”，改了会让点遮罩把下拉和对话框一起关掉。
  - L07 第 2 点（提示压过菜单）：对话框外已经分档（70 对 60）；对话框与窗口里两者同档，靠后挂载的提示碰巧在上。真要分档得把窗口与模态的层级步长从 2 改 3，牵动层级带与 `FloatingWindow` 的深度上限，收益不抵。
  - `ContextMenu`、`Menubar` 的传送目标缺省（理由见第 6 节）。
  - 浮层内容区的入退场动画统一。
- **风险**：
  - **守卫式调用方漏加 `:close-on-request="false"`**：类型检查查不出。S3 按上面的清单逐处改，并在 `ProjectInfoDialog`、`AddProviderDialog` 已有的测试里覆盖守卫；没有测试的 `DeveloperMessageDialog` 补一条。
  - **`useOverlayLayer` 的 inject 与 provide 顺序**：放错位置会让每个对话框都判成 nested；由 `dialog-surfaces.spec.ts` 与新增的两个场景兜住。
  - **改动面大**：迁移表每项列出“按设计变化”的断言，不放宽断言；派出去的机械迁移由主会话逐文件审 diff。
