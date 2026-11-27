---
标签: [state:local, state:inject]
别名: ["设置行", "Settings Row"]
---

# SettingsRow

设置窗口里一项配置的一行（[`settings/settings-window.md`](../../../../../docs/specs/settings/settings-window.md) 输出 9–13、18）：左边标题与说明，右边放调用方给的控件。“这一层写没写过”“本作品有没有单独设置”“这一层能不能保存”这些规则都由它按配置项的声明、配置服务与当前标签自己算，页面只管控件本身。设置窗口的通用列表与插件自己画的 page 分区用的是同一个组件，两边看起来一样、规则一样。

它不认识具体的控件：开关、单选组、输入框都放在插槽里，它把这一层该显示的值与是否停用交给插槽。它自己只做两种写入：“恢复默认”（删掉这一层的键）与“移除本作品的设置”（删掉本作品层的键），都经传入的配置服务；控件改值由调用方自己写到当前标签那一层，所以本作品标签下沿用的行一改就成了本作品单独设置的。

## 布局

行是可换行的弹性布局：标题与说明在左（最小宽 200px），控件靠右。放不下时（窗口窄于 600px、控件又宽）控件换到标题下面，仍靠右。控件右边固定一格（24px，IconButton `xs` 的边长）放“恢复默认”、本作品标签下的“移除本作品的设置”或只读的锁；没改过的行也留着这一格，所以各行控件的右缘对齐。两种排法由 `wide` 决定：

- **标题加控件**（缺省）：开关、横排单选组、下拉、数字与单行输入用这一种。控件的宽度由控件自己定（`SettingsListSection` 按类型给定宽，单行输入随行宽收窄）。
- **宽排法**（`wide`）：标题与说明在左上，最右那一格在标题那一行的右端（和上一种排法的那一格对齐），控件另起一行、占满这一行的宽度。多行文本、竖排单选组、复选组、列表、对象与 JSON 这类宽控件用这一种。本作品标签沿用时同样把控件画在下面、可用，显示沿用的值。

标题后面依次是：已修改的小圆点（强调色，悬停提示“已修改”）、状态原因的图标、沿用标签“来自用户设置”（描边不填色）、`applies` 标注（填色的小标签）。两枚标签同字号、同外高，靠描边与填色分开。圆点与图标各占 14px 见方、在标题行里居中，出现与消失不改变行高。整数行高：标题 20px、说明 18px、两者间距 2px，文字块是 40px 的偶数高，34px 高的控件在它旁边居中时不落在半像素上；改这几个数时保持文字块是偶数高。

本作品覆盖的提示在整行下面另起一行，信息色、带图标。调用方的 `below` 插槽（行下信息，例如网络页“现在用的代理”）再往下另起一行，小字号、任意处折行，色调与图标由调用方画；不给时没有这一行。这一行不吃行的间距：内容自己留上边距（例如 `padding-top: var(--space-3)`），这样它能收起到高度为 0（网络页用 `Collapsible` 做出现与消失）。整行不设 `overflow`，控件的焦点环不被裁。排在行里的 CSS 变量 `--settings-row-slot`、`--settings-row-text-min`、`--settings-row-gap-x`、`--settings-row-cell-gap` 由行定义，放在行里的控件可以继承它们（`SettingsListSection` 用它们算单行输入的宽度）。

## 交互

- 已修改（当前标签这一层写了这个键）：标题后一个小圆点；点最右一格的“恢复默认”（图标按钮，悬停提示同名）经 `settings.update(setting, undefined, {layer})` 删掉这一层的键，控件回到下一层的值。
- 本作品标签、项目层没写（沿用）：照常画控件，显示此刻生效的值（用户层的值，用户层没写时是默认值），标题后一枚描边标签“来自用户设置”（英文 “From your settings”），经 `describedby` 念给控件，不进控件的名字。改控件由调用方写进本作品层，之后标签消失、出现小圆点。只能写在本作品层的项没写时显示的是默认值，不标。
- 本作品标签、项目层写了：标题后有小圆点，最右一格是“移除本作品的设置”（与“恢复默认”同一个图标按钮，提示文字不同），点了删掉项目层的键，回到沿用。
- 用户标签、本作品层写了：行下一行提示“《书名》已单独设为X，此处的更改在该作品中不生效”（没有书名时写“本作品已单独设为X，…”）。
- 只读（schema 的 `readOnly`）：不画控件，只写当前值（正文色、等宽字、可以选中复制），最右一格放锁形图标，悬停提示“只读”；没有已修改圆点与“恢复默认”；本作品标签下沿用时同样标“来自用户设置”。
- 状态原因（`reasons`）：标题后一个图标，色调取最重的（出错危险色 `i-lucide-circle-alert` > 警告 `i-lucide-triangle-alert` > 淡色 `i-lucide-info`，画法同 nb-form 的字段外壳），悬停图标或焦点在行里的控件上时用 `Tooltip` 逐条列出全部原因。最右一格的按钮拿到焦点不算。
- 这一层文件无效、连不上或本窗口没有这一层：插槽拿到 `disabled: true`，“恢复默认”“移除本作品的设置”停用（沿用的行同样停用控件，标签照旧）；层恢复后自动解除。
- 一次写入在进行中时，同一个按钮停用，不发起第二次。写入没有成功（含结果未知）时发 `write-failed`，界面上的值以配置服务里这一层的实际值为准。

文字选择：设置名、说明与值可选（可复制去搜），控件按各自的规则（见 nb-ui 开发规范的“文字能否选中”）。

## 数据

```ts
import type {SettingDefinition, SettingLayer, SettingsFailure, SettingsService} from "nbook/shared/settings";

type Props = {
    /** 配置服务：读这一项（`inspect`，响应式），写三种动作。页面传自己插件的；设置窗口的通用列表传自己的用户编辑路径。必填。 */
    settings: SettingsService;
    /** 这一项的定义。必填。 */
    setting: SettingDefinition<unknown>;
    /** 当前标签，即编辑哪一层。必填、受控。 */
    layer: SettingLayer;
    /** 窗口绑定的作品的书名；覆盖提示里用它，缺省 null 时写“本作品”。 */
    projectTitle?: string | null;
    /** 宽排法；缺省 false。 */
    wide?: boolean;
    /**
     * 标题后面状态图标的原因，缺省没有。出错、选项拿不到、“已不存在”之类控件里的状态由调用方给：行不认识控件。只画一个
     * 图标，色调取最重的（error > warning > muted），提示按传入的顺序逐条列出。
     */
    reasons?: ReadonlyArray<{tone: "error" | "warning" | "muted"; text: string; announced?: boolean}>;   // announced：控件已经念过这条，行只画图标
    /** 搜索结果里要标出的词（小写）；标题与说明里命中的字用 `<mark>` 标底色（`HighlightedText`），文字本身不变；缺省不标。 */
    highlight?: ReadonlyArray<string>;
};

type Emits = {
    /** 行自己发起的写入没有成功（含 `unknown-outcome`）；调用方决定怎么告诉用户（设置窗口发工作台通知）。 */
    (event: "write-failed", failure: {action: "reset" | "remove"; code: SettingsFailure; detail: string}): void;
};

type Slots = {
    /**
     * 控件。`value` 是这一层显示的值：这一层写了取这一层（层无效时是上一份有效内容里的），没写取下一层；`disabled` 为真时控件
     * 应停用；`id` 给能与标签关联的控件（输入框、下拉的触发器、开关）作 id，行的 `<label for>` 指向它；组合控件（单选组、
     * 复选组）拿不到 `<label for>` 的名字，用 `labelId`（行标题的 id）作 `aria-labelledby`，或用 `label` 文字作
     * `aria-label`；`describedby` 是行里沿用标签、生效时机标注、说明与状态原因的 id（都没有时为 undefined），接进控件的 `aria-describedby`；两枚标签不在 `<label>` 里，不进控件的名字。状态原因的读屏文字是行里一段隐藏的文字（带 `data-settings-row-reasons`），不覆盖调用方控件自己的说明。
     * 不允许这一层与只读时不渲染；沿用时照常渲染，`value` 是沿用的值，`disabled` 只看层能不能写。
     */
    default(props: {value: unknown; disabled: boolean; id: string; label: string; labelId: string; describedby: string | undefined}): unknown;
    /** 行下信息，排在本作品覆盖的提示之后；`value` 同默认插槽。不给时不画这一行。 */
    below?(props: {value: unknown}): unknown;
};
```

没有 expose；attrs 落在根上。根带稳定名 `settings.row` 加设置键（`data-nb-target`、`data-nb-key`，[`agent/page-agent.md`](../../../../../docs/specs/agent/page-agent.md) 输出 6；Agent 的引导按它找这一行，不改名）、`data-settings-row`（键）、`data-settings-row-state`（`edit`、`inherit` 或 `not-allowed`），已修改时带 `data-settings-row-modified`，停用时带 `data-settings-row-blocked`；宽排法里控件那一行带 `data-settings-row-wide`、行下信息带 `data-settings-row-below`、标题行右端的一块带 `data-settings-row-head`。内部标记：已修改圆点 `data-settings-row-dot`，沿用标签 `data-settings-row-inherited`，最右一格 `data-settings-row-cell`，只读的值与锁 `data-settings-row-value`、`data-settings-row-lock`，状态图标 `data-settings-row-reason`（`data-tone` 是色调），提示里的一行 `data-settings-row-reason-line`。

## 状态

- **可编辑**：标题、说明、控件；已修改时小圆点与最右一格的“恢复默认”（本作品标签是“移除本作品的设置”）。
- **沿用**：本作品标签、项目层没写，见“交互”。层不可用时控件停用，同可编辑。
- **只读**：见“交互”。
- **不允许这一层**：声明不允许当前标签的层时不画控件，写“仅可在用户设置中修改”或“仅可在本作品中设置”。设置窗口的通用列表不列这样的项，页面作者让分区的 `layers` 与页面里的项一致时也不会出现。
- **停用**：见“交互”最后两条。
- 加载、空数据：没有；配置服务的读取是同步的。

## 不支持

- 不选控件：控件由调用方放进插槽，通用列表的选法在设置窗口里。
- 不发通知、不弹确认：写入失败交给调用方。
- 不显示层无效的原因与文件路径：那是设置窗口在分区顶部的一行说明。

## 注意事项

- 状态原因的图标与提示和 nb-form 的字段外壳（`ui.forms` 输出 14）是同一套画法；`SettingsListSection` 把字段经 `field-state` 交出的警告与状态、自己算的“未保存”合成 `reasons` 传进来，页面自己画控件时按同样的办法传。
- 写入经 `settings` 发出，`settings` 是调用方经属性传入、可替换的入口，不是组件自己伸出去的通道；页面传自己插件的配置服务时，它只能写自己插件声明的项（[`settings.configuration`](../../../../../docs/specs/settings/configuration.md) 输出 11）。
- 控件改值后要写进与 `layer` 相同的层（`update(setting, value, {layer})`），否则“已修改”与控件显示的值对不上。

## 隐藏通道理由

- `state:local`：控件是否有焦点只用来决定状态原因的提示显不显示，不保存业务状态；值与层的状态都读配置服务。
- `state:inject`：经 `useText()` 取宿主注入的翻译端口，固定文字在 `nbook.settings` 的目录里（`plugins/settings/locales/`；键表见 `ui/settings/text.ts`）；语言随端口切换，不重新挂载，组件没有语言属性。设置窗口里的页面与 SDK 交给第三方插件的设置页都在宿主窗口里，宿主总会登记这份目录。没有宿主注入时得到 nb-ui 的缺省端口，那里没有这份目录，只显示键名，所以测试与 Lab 场景要注入登记了它的宿主引擎端口。
