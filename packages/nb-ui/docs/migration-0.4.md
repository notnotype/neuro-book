# 从 nb-ui 0.3 升级到 0.4

0.4 把公开 API 里同一件事的几种写法收成一种（规则见 [`ui-development-spec.md` 的“取值词表与文案属性”](ui-development-spec.md#43-取值词表与文案属性)）。旧名字没有保留别名：按下表一次改完。

插件 SDK 生成的插件缺省写 `engines.neurobook: "^<构建时的 SDK 版本>"`，NeuroBook 是 0.x 时 minor 号变化就不再匹配，按旧 API 写的插件会被拒绝安装，不会装上后静默失效。自己把范围写成 `>=` 的插件不受这层保护，升级前按下表检查。

宿主打开 vue-tsc 的 `checkUnknownProps`、`checkUnknownEvents` 后，写错或漏改的属性与事件名会在类型检查时报错（nb-ui 的仓库内宿主都已打开）。

## 尺寸与语调

| 组件 | 旧 | 新 |
|---|---|---|
| `Input`、`NumberInput`、`Select`、`SearchSelect` | `size="default"` | `size="md"`（缺省就是它，可以不写） |
| `Banner`、`Notification`、`useNotification` | `tone: "error"` | `tone: "danger"`；`notifications.error(…)` 这个动作名不变，发出的色调是 `danger` |
| `DropdownMenu`、`ContextMenu`、`Menubar` 的菜单项 | `tone: "default"` | `tone: "neutral"` |
| `AlertDialog` | `tone="warning"`、`tone="accent"` | `tone="neutral"`（外观与原来相同：确认按钮用主按钮样式） |
| `SegmentedControl` | `tone` 属性与选项的 `tone` | 删掉：从来没有渲染过 |

新增共用类型 `ControlSize`、`Tone`、`Side`、`Align`、`Orientation`，各组件的尺寸、语调类型是它们的子集。

## 弹出位置

| 组件 | 旧 | 新 |
|---|---|---|
| `Tooltip`、`InfoTip` | `placement` | `side`，另有 `align`（缺省 `center`） |
| `SuggestionMenu` | `placement` | `side`（取值不变：`auto`、`top`、`bottom`） |

类型 `TooltipPlacement`、`InfoTipPlacement` 删掉，用 `Side`；`SuggestionMenuPlacement` 改名 `SuggestionSide`。

## 文案属性

| 组件 | 旧 | 新 |
|---|---|---|
| `AlertDialog` | `confirmText`、`cancelText` | `confirmLabel`、`cancelLabel` |
| `Drawer` | — | 新增 `closeLabel`；没有 `title` 时自带一个只给读屏的标题 |
| `Breadcrumb` | — | 新增 `ariaLabel` |

## 列表数据

| 组件 | 旧 | 新 |
|---|---|---|
| `DropdownMenu` 的项（`DropdownMenuItemData`） | `value` | `id`；`select` 事件发出的仍是这个字符串 |
| `Menubar` 的项（`MenubarItemData`） | `value`、`type: "default"` | `id`、`type: "item"`；`select` 事件发出整项，读 `item.id` |
| `Select` 的选项 | `indicatorClass`（调用方传色类） | `tone`：组件按语调取主题的状态色画色点 |

不变：`Select`、`SearchSelect` 选项的 `value`（表单提交值）；菜单与 `QuickPick` 的 `shortcut`；各组件的 `iconClass`。

## 浮层的打开态与关闭

| 组件 | 旧 | 新 |
|---|---|---|
| `Dialog` | `v-model`（`modelValue`、`update:modelValue`） | `v-model:open`（`open`、`update:open`） |
| `Dialog` | 挂了 `@request-close` 就不自动关、没挂就自动关；`@confirm` 同理 | 一律先发 `request-close(reason)`，`closeOnRequest`（缺省 `true`）时随即发 `update:open(false)`；要自己决定关不关时传 `:close-on-request="false"`。`confirm` 只发事件，不关闭 |
| `Dialog` | `cancel` 事件（任何方式关闭都发） | 删掉：取消按钮发 `request-close("cancel")`；要知道任何方式的关闭就听 `request-close` |
| `Dialog` 的关闭原因 | `esc`、`overlay` | `escape`、`outside`（`cancel`、`close-button` 不变） |
| `ContextMenu` | `visible`、`@close(reason)` | `v-model:open`、`@request-close(reason)` |
| `QuickPick` | `@close(reason)`，在 `update:open(false)` 之后发 | `@request-close(reason)`，在 `update:open(false)` 之前发（与其它浮层一致） |
| `Dialog`、`FloatingWindow`、`Drawer`、`ContextMenu` | — | 新增 `closed`：关闭完成、内容卸载并释放焦点后发出（`AlertDialog`、`QuickPick` 原来就有）；要在关闭之后再打开下一层或执行命令时听它，不要用固定时长等待 |
| `Dialog` 的 `modal=false`（浮动窗口） | `<Dialog :modal="false">` | `<FloatingWindow>`：属性与 `Dialog` 相同，另有 `resizable`、`minWidth`、`minHeight`、`update:width`、`update:height`；没有遮罩相关的 `closeOnOverlay`、`overlayType` |
| `Dialog` | `modal`、`resizable`、`minWidth`、`minHeight`、`update:width`、`update:height` | 删掉，`Dialog` 只做模态 |

新增共用类型 `OverlayCloseReason`；`DialogCloseReason`、`ContextMenuCloseReason`、`QuickPickCloseReason` 保留，是它的子集；新增 `FloatingWindowCloseReason`。

## 其它

| 组件 | 变化 |
|---|---|
| 插件 SDK `/components` | 补上原来漏掉的类型：`FieldContext`、`Splitter` 与 `NestedGrid` 的手势类型 |

不变：`@notnotype/nb-ui/grid` 仍是单独的入口，给不能带上 Vue 与 DOM 的消费者（插件激活时建的模型、Bun 里的测试）；`./layout` 含组件。

## 发版时一起改

- 四个内置主题 `themes/*/manifest.ts` 的 `hostVersion` 改成 `^0.4.0`，`src/version.ts` 的 `NB_UI_VERSION` 同步；否则主题装载器按 `^0.3.0` 拒绝全部内置主题。
- 依赖 nb-ui 的已发布包（nb-form、nb-agent-ui、nb-markdown、nb-story）一起升版本并发布；只发 nb-ui 会让旧版共享包把 0.3 装成第二份。
- 应用与插件 SDK 升 minor。
