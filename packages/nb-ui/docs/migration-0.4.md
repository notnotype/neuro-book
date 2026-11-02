# 从 nb-ui 0.3 升级到 0.4

0.4 把公开 API 里同一件事的几种写法收成一种（规则见 [`ui-development-spec.md` 的“取值词表与文案属性”](ui-development-spec.md#46-取值词表与文案属性)）。旧名字没有保留别名：按下表一次改完。

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
