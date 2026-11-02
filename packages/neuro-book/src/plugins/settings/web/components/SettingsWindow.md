---
标签: [state:local, state:inject, env:portal]
别名: ["设置窗口", "Settings", "Preferences"]
---

# SettingsWindow

设置窗口（[`settings/settings-window.md`](../../../../../../../docs/specs/settings/settings-window.md)）：非模态的浮动窗口，左栏列出分区，右边一次显示一个分区；绑定作品的窗口在左栏顶上有“用户 | 本作品”两个标签。它是窗口模型（`settings-window.ts` 的 `SettingsWindow`）的呈现：开着与否、当前分区与标签、尺寸、左栏、当前分区的视图、层的说明都从模型读，用户的操作交回模型的方法。list 分区交给 [`SettingsListSection`](SettingsListSection.md)，page 分区交给 [`SettingsPageFrame`](SettingsPageFrame.md)，左栏最后固定的“设置文件”交给 [`SettingsFileView`](SettingsFileView.md)。模型由 `nbook.settings` 的窗口入口持有，组件挂在页面根上（工作台的页面浮层），每个浏览器页面一份。

## 布局

- **外框**：nb-ui `FloatingWindow`，没有标题栏（`showHeader=false`），标题“设置”只作窗口的可访问名称；关闭按钮浮在窗口右上角，没有页脚；圆角取 `--radius-window`。拖动区域是窗口的留白、左栏顶上层标签与搜索框那一块的空白、右边标题区的空白与文字（按钮与输入框上不拖）。关闭按钮只在会压到时才让位：宽窗口里内容列封顶 720px、离右上角够远时标题区不让，窗口窄到列贴近右缘或 fill 页面时标题区右侧让出按钮的位置；窄窗口里顶上那一行（层标签与搜索框）右端让位，标题区在它下面不用让。左栏顶边与标题区顶边齐平；尺寸取模型（缺省 960×640，不超过容器），可拖右、下两边与四角调整，下限 600×400；切换分区不改变尺寸；每次打开居中。
- **左栏**：宽 176px，最上面是层标签与搜索框，下面是分区，不随内容滚动（条目多时分区列表自己滚）。层标签是分段控件“用户 | 本作品”（绑定作品时才有，不绑定不画），与下面的搜索框（小尺寸、放大镜图标、可清空，名字“搜索设置”）同宽同左边缘。三组分区自上而下：应用、AI、插件，每组上方一个淡色组标题，依次是“通用”“写作助手”“扩展”（英文 General、Writing assistant、Extensions）；每个分区是一行列表项（图标加标题），没有描边：悬停一层淡底，当前项是浮层上的选中底色（`--overlay-item-active`），按下不缩放，键盘焦点是内嵌焦点线（`.nb-ui-focus-ring-inset`，只在键盘操作时出现）；当前标签下不可用的项停用（`aria-disabled`，原生停用的按钮收不到悬停），悬停用 Tooltip 显示原因，原因另经 `aria-describedby` 给读屏（当前项不可用时仍可聚焦，右边显示原因）。标题放不下时截断成省略号，悬停或聚焦时 Tooltip 显示全名（停用的项照旧显示原因）；是否截断在左栏尺寸或分区变化后重新量。左栏与右边之间一条竖分隔线。没有归入分区的设置的那一项（id 仍是 `other`）显示为“插件设置”，说明是“未提供独立分区的插件设置”。
- **右边**：顶上的标题区由 [`SettingsSectionHeading`](SettingsSectionHeading.md) 画，column 与 fill 共用：左边是标题与跟在后面的说明，右边从右往左是页面级操作（`SettingsPageActions`）与层的警告；再下面是分区内容。list 分区与 `column` 页面放在内容列里：左右内边距相同、宽度封顶约 720px，内容列整体滚动；`fill` 页面拿到标题下面的整块区域，外边距同内容列、不封顶，自己分栏、自己滚动；“设置文件”也按这种画法，文本框随窗口高度伸缩、保存栏钉在底部。当前分区在这个标签下不可用时，右边在标题下原位写原因。
- **搜索结果**：有搜索词时右边标题是“搜索结果”，下面按分区与小组分组列出命中的设置项（同 list 分区的画法）：组标题写“分区名 › 小组名”，分区名淡色、小组名正常色，没有小组时只写分区名；行的标题与说明里命中的字用 `<mark>` 标底色（[`HighlightedText`](../../../../ui/settings/HighlightedText.md)）。再下面是最后一组“页面”，列出命中的 page 分区：每条一行（标题与说明，命中同样标底色），整行是一个按钮，右端“打开 ›”；都没有时一句“没有找到设置”。左栏照旧，但不标当前项。
- **窄窗口**：窗口自己（不是屏幕）窄于 600px 时左栏变成顶上两行：第一行层标签与搜索框并排，第二行分区横排一行、可以横向滚动（不显示滚动条），不显示组标题与图标；右边在它下面，内容列不再封顶；放不下控件的行由 `SettingsRow` 把控件换到标题下面。判据是窗口根上的容器查询，窗口被拖窄或页面比窗口小都会命中。

## 交互

- 关闭：关闭按钮与 `Esc` 经 `request-close` 交给模型的 `close()`；焦点回到打开窗口之前的元素（FloatingWindow 归还）。
- 搜索：输入即搜（模型的 `search`），结果数（“N 个设置、M 个页面”）经隐藏的状态行播报；焦点在窗口面板里时 `Mod+F` 聚焦搜索框（监听挂在 FloatingWindow 面板上；按平台与物理键判断；输入法组字时、焦点在设置文件的文本框里时不拦）；框里有字时 `Esc` 只清空、窗口不关（先 `preventDefault`，FloatingWindow 见到已处理就不关）；点清除按钮后焦点回到输入框。“打开”切到那个分区并把焦点放到左栏的当前项。
- 未保存保护：模型的 `leaving` 不为空时弹 nb-ui `AlertDialog`“放弃未保存的更改？”，正文““分区标题”有未保存的更改。离开此页面后，这些更改将会丢失。”（“放弃”“继续编辑”，`neutral` 色调）。确认框里按 `Esc` 等于“继续编辑”（它是受控的，`update:open(false)` 交回 `cancelLeave()`）。“继续编辑”关闭完成（`closed`）后焦点回到弹出之前的元素；“放弃”交回 `confirmLeave()`，窗口还开着时焦点按动作去：从搜索框起手的回搜索框，切标签的回标签，点层警告打开设置文件的进文本框（视图已按出错位置放好光标时不动），其余到左栏的当前项。
- 打开时焦点在左栏的当前项；窗口已开着时再执行打开命令（模型的 `focusRequest` 加一），焦点回到左栏的当前项。
- 左栏：点一项切换分区；焦点在左栏时上下键（窄窗口横排时左右键同义，两种排法都认）切到上一个、下一个可用分区，Home、End 到首尾，焦点跟着走；左栏是一个 Tab 停靠点（当前项）。
- 标签：点“用户”“本作品”切换编辑哪一层；page 页面不重建，只拿到新的层。
- 拖动调整尺寸：松开时把新的宽、高交给模型记住。
- 层的警告：当前标签那一层文件无效时，标题区右侧是按钮“设置文件格式有误 打开 →”，悬停写位置、原因、“修复前，这一层的设置无法保存”与文件路径（层快照带路径时）；点它交给模型的 `openFile(layer, position)`：先过未保存确认，确认后切到设置文件视图并把光标放到出错处（没有位置时只打开）。在设置文件视图里警告改写成文字“第 N 行第 M 列：原因，改好后保存”；视图保存被拒时经窗口通道（`page-chrome.ts` 的 `claimNote`）登记“未保存：第 N 行第 M 列：原因”，盖过前一句，改了文本就撤掉。连不上时是不可点的文字“暂时无法连接，无法保存”。层恢复后自动消失。
- 标题区通道：窗口 `provide` 一份通道（`ui/settings/page-chrome.ts`，不是公开接口）：右侧操作挂载点、当前这一层能不能写、标题替换。页面里的 `SettingsPageActions` 把操作 Teleport 到挂载点，层不能写时整体停用；页面登记了标题替换时（`SettingsPageList` 打开一项），标题区换成“‹ 分区标题”与页面给的标题，点“‹ 分区标题”交给页面登记的返回动作。页面卸载（离开分区、开始搜索、关窗口、重试、重新加载）时撤销登记，切标签页面不重建、标题替换保留。

## 数据

```ts
import type {SettingsWindow} from "../settings-window";

type Props = {
    /** 窗口模型；必填。 */
    window: SettingsWindow;
};
```

没有 emits、slots、expose；attrs 落在 FloatingWindow 的面板上。正文根带 `data-settings-window`，左栏条目带 `data-settings-nav`（分区 id），当前项另带 `data-settings-nav-current`，标题被截断（悬停有全名提示）的另带 `data-settings-nav-truncated`，每组的组标题带 `data-settings-nav-label`（`app`、`ai` 或 `plugins`），搜索框带 `data-settings-search`，搜索结果里的页面一组带 `data-settings-page-hits`、每条（整行是按钮）带 `data-settings-page-hit`（分区 id），搜索结果里命中的字带 `data-settings-hit`，没有命中的一句带 `data-settings-no-results`，层警告的按钮带 `data-settings-open-file`，标签分段带 `data-settings-tabs`，层的警告带 `data-settings-layer-notice`（`invalid`、`unavailable` 或 `fixing`），标题区带 `data-settings-heading`、右侧操作的挂载点带 `data-settings-heading-actions`、“‹ 分区标题”带 `data-settings-heading-back`，右边的区域带 `data-settings-section`（分区 id），分区在当前标签下不可用的原因带 `data-settings-unavailable`。

## 状态

- 关闭：不渲染面板（Dialog 关着）；模型的尺寸记录在第一次打开时才读。
- 没有任何分区：右边一句“没有可以显示的设置”。
- 加载、失败：page 分区的交付与加载见 `SettingsPageFrame`；list 分区总是可用。

## 隐藏通道理由

- `env:portal`：Dialog 把面板传送到 `body`（产品）或宿主提供的传送目标（Lab 的画布），脱离页面根的裁剪与层叠；目标找不到时 Dialog 回退到 `body`。
- `state:inject`：窗口 `provide` 标题区通道给页面里的 `SettingsPageActions` 与 `SettingsPageList`；页面不该为标题区的挂载点与“这一层能不能写”各接一条线。
- `state:inject`（续）：经 `useText()` 取宿主注入的翻译端口，窗口自己的固定文字在 `nbook.settings` 的目录里（`window.*` 键）；组件没有语言属性。没有宿主注入时只显示键名，所以测试与 Lab 场景要注入登记了这份目录的宿主引擎端口（Lab 的局部宿主给 `host.text`）。
- `state:local`：只有左栏的焦点移动、面板根元素的引用与确认框弹出前的焦点，窗口的状态都在模型里。
