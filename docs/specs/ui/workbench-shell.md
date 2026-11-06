---
schema: nbook.spec/v1
kind: behavior
status: implemented
capability: ui.workbench-shell
owners:
  - nbook.workbench
---

# 工作台外壳

## 目标与非目标

**目标**：工作台页面上布局之外的部分：标题栏与状态栏的条目和菜单、活动栏底部条目、页面浮层、无项目首页与 `/workbench` 页、卡片还是平铺这层外观。面板、尺寸、拖放、布局记录、公开的布局状态是 [ui.workbench-layout](workbench-layout.md)；旧的外壳一到三（七个固定 Part、容器、半区拖放）与输出 39 已被它取代，下文的编号不重排，所以从 28 开始。

书架页（[workbench.bookshelf](../workbench/bookshelf.md)）为工作台增加无项目首页的贡献点与 `/workbench` 页（输出 36–37）；设置窗口（[settings.window](../settings/settings-window.md)）为工作台增加活动栏底部条目与页面浮层两个贡献点（输出 40–41）。

**非目标**：

- 编辑器分组与文档标签：归编辑器插件（[workbench.editor](../workbench/editor.md)）。
- 插件面向的视图合同：见 [workbench.views](../workbench/views.md)。
- 桌面窗口控制与桌面菜单接线（有桌面宿主再做）；跨窗口浮动；第三方可执行插件。
- 不读写领域数据（项目文件、会话、历史）。

## 术语与参与者

- **面板、具名面板、条、当前面板**：见 [ui.workbench-layout](workbench-layout.md)。
- **页面浮层**：插件交给页面根的组件（输出 41），首页与工作台页都挂；内容自己决定渲染到哪里（例如对话框传送到 body）。

## 输入与前置条件

- 触发：打开或刷新窗口、窗口绑定项目、容器尺寸变化、用户点标题栏与状态栏、条目贡献与公开状态变化。
- 输入：当前主题（[theme.system](../theme/system.md)）；实测的标题栏与状态栏容器宽度；窗口是否绑定项目；条目贡献。
- 前置：工作台浏览器入口已激活。
- 权限：无。外壳不读写领域数据。

## 输出与可观察行为

### 外壳四：标题栏、状态栏与条目

外壳四的输出 28–35 已实现。

28. **标题栏结构**：36px 一行，左组从左到右是品牌的横排标志（标志加字标，墨色跟随文字色）、项目切换（书本图标加显示名）、一道短分隔与应用菜单，中间是居中的命令搜索，右组是布局按钮（侧栏、面板、右栏）与条目区。左组放不进标题栏的一半时左栏按内容撑开、搜索往右让，不挤出界。
    - 命令搜索是按钮：点开命令面板，提示命令面板的快捷键，按平台写出修饰键（[workbench.commands](../workbench/commands.md) 的“快捷键的显示”）。
    - 项目切换显示当前项目的显示名，没有项目时显示“打开项目…”；点开至少有“打开项目…”（`nbook.project.open`）。作品列表随书架页的作品数据加入。
    - 布局按钮是切换按钮，按下态取输出 32 的公开键，经输出 32 的命令执行。
    - 浏览器里不画窗口控制。
29. **应用菜单**：四组（文件、编辑、视图、帮助）的标题与顺序由工作台定，条目来自贡献点 `workbench.titlebar-menu`：各插件给自己的命令贡献菜单项、声明所属的组；条目的显示、可用、标题、快捷键、勾选、排序与分隔线按 [`workbench.menus`](../workbench/menus.md)，执行一律经命令服务。
    - 一组里没有显示的条目时不画这一组。
    - 菜单的编辑项（撤销、重做）与命令面板一样作用于活动编辑器，不按焦点区分；焦点在原生输入框时菜单不代替它撤销。
    - 产品里的条目与贡献方（节之间是分隔线）：

      | 组 | 条目（命令与固定参数） | 贡献方 |
      |---|---|---|
      | 文件 | 打开项目（`nbook.project.open`）｜保存、全部保存、还原为磁盘版本（`nbook.editor.save`、`save-all`、`revert`）｜关闭编辑器、关闭其它编辑器（`nbook.editor.close`、`close-others`） | 作品、编辑器 |
      | 编辑 | 撤销、重做（`nbook.edit.undo`、`redo`） | 编辑器 |
      | 视图 | 命令面板（`nbook.quick-open.open-commands`）｜侧栏、右栏、活动栏、面板（`nbook.view.set-part-hidden {part}`，勾选）、最大化面板（`toggle-panel-maximized`）｜向右拆分、向下拆分、用其它编辑器重新打开（`nbook.editor.split-right`、`split-down`、`reopen-with`）、显示编辑器工具栏（`nbook.view.toggle-editor-toolbar`，勾选）｜切换主题、明暗、界面语言（`nbook.settings.switch-theme`、`switch-appearance`、`switch-locale`）｜重新载入（`nbook.app.reload`） | 工作台、编辑器、设置 |
      | 帮助 | 欢迎（`nbook.help.welcome`）、文档（`nbook.help.documentation`） | 作品、工作台 |

    - 节名：文件 `1_open`、`2_save`、`3_close`；编辑 `1_undo`；视图 `1_palette`、`2_layout`、`3_editor`、`4_appearance`、`5_reload`；帮助 `1_help`（上表里以“｜”分开的就是这些节）。别的插件的条目写同样的节名就排进同一节，写别的名字就按名字另起一节。
    - 旧桌面菜单的 15 个 id 的去向见 [workbench.commands](../workbench/commands.md) 的“兼容与安全”。
30. **逐级让位**：按标题栏容器的实测宽度（不是窗口宽度）与各部件此刻的实测宽度，放不下就收下一项，不写死宽度边界，语言、项目名长短不同时切换点跟着变：
    - 依次是：横排标志换成单独的图形标志；菜单栏收成 ≡ 图标按钮，点开是“文件、编辑、视图、帮助”四行，悬停或方向键展开各自的子菜单；收起搜索里的快捷键提示；布局按钮收进 ≡ 的“视图”组（视图组本来就有对应的勾选项）；项目切换只留书本图标（悬停与读屏仍是全名）。
    - 搜索取中间剩下的宽度，最宽 560px、最窄 120px，到最后仍是一条带文字的长条。条目区照旧按第 34 条收进它自己的“更多”。
    - 往回展开要多出 40px，窗口宽在切换点附近来回拖时不跳。
    - 任何宽度下菜单入口都在；关键按钮不被遮挡、不被裁切。
31. **菜单键盘与焦点**：
    - Alt 或 F10 聚焦菜单入口（完整时是第一组，紧凑时是“菜单”按钮）；
    - 左右键在组之间移动，上下键在项之间移动并跳过分隔线，Home、End 到两端；禁用项可以停留，不能执行；
    - Enter 或空格执行；Escape 关闭菜单，焦点回到打开菜单之前的位置；
    - 菜单关闭后焦点不留在已卸载的元素上。
32. **显隐与切换**：侧栏、右栏、活动栏“可见”指未隐藏且未拖到零。
    - 命令 `nbook.view.set-part-hidden {part?, hidden?}`：`part` 省略时经选择服务选择区域，取消无副作用；`hidden` 省略时按可见切换；“显示”同时清掉隐藏与拖到零，按记忆尺寸回来，写布局文档（[ui.workbench-layout](workbench-layout.md) 输出 11）。
    - 公开状态增加下表三个键，未就绪时为 `false`：

      | 键 | 类型 | 未就绪时 | 含义 |
      |---|---|---|---|
      | `nbook.workbench/sidebarVisible` | 布尔 | `false` | 侧栏可见 |
      | `nbook.workbench/auxiliaryBarVisible` | 布尔 | `false` | 右栏可见 |
      | `nbook.workbench/activityBarVisible` | 布尔 | `false` | 活动栏可见 |

33. **条目贡献点**：`workbench.statusbar-items` 与 `workbench.titlebar-items`，写法与 `workbench.views` 相同。
    - 声明（静态数据，登记时校验）：`{title, alignment: "left" | "right", order, priority, command?: {id, args?}, when?}`。`title` 是条目的名字，用于“更多”菜单与读屏，是界面文字值（[ui.i18n](i18n.md)）；不写时登记时补成贡献方插件目录里的键：状态栏条目 `statusItems.<本地 id>.title`，标题栏条目 `titlebarItems.<本地 id>.title`（本地 id 是条目 id 去掉开头的 `<插件 id>.`，规则见 [ui.i18n](i18n.md) 的“约定键”）。标题栏条目只接受 `alignment: "right"`。
    - 实现（浏览器入口激活时交出）：`{text(): Text, tooltip?(): Text, state?(): "normal" | "warning" | "error"}`，响应式读取。数据由贡献方从自己的状态算出，外壳只渲染、不读领域状态。`text()` 与 `tooltip()` 返回文字值，外壳渲染时按窗口当前语言翻译：返回同一个文字引用时，切换语言后条目照样换文字。运行期的文字不经登记，引用要自己带命名空间（插件 SDK 的 `pluginText`，[runtime.plugin-api](../runtime/plugin-api.md)）。
    - 可见：只由 `when`（公开状态的布尔键，规则同命令）决定，不满足时不渲染；`text()` 不承担隐藏。
    - 排序：按 `alignment` 分两侧，同侧按 `order` 升序，再按条目 id。
    - 点击：有 `command` 的条目是按钮，经命令服务执行，命令不可用时禁用并以原因作提示；没有的是纯文字（`role="status"`）。
    - 冲突与撤回：同 id 的两条贡献一起拒绝并记诊断；贡献方入口开始停止时条目立即消失，之后不再调用它的实现（含打开着的“更多”菜单）；实现抛错的条目原位显示为不可用并记诊断，不影响别的条目。
34. **条目的溢出**：放不下时按优先级收进“更多”按钮，不让条目互相遮挡、不出现横向滚动。
    - 固定区先占：状态栏左侧的项目名与布局问题、右侧的“显示面板”；标题栏的品牌、菜单入口、搜索与布局按钮。
    - 全部放得下就全部显示。否则先为“更多”留出完整按钮位，再按 `priority` 降序、`order` 升序、id 依次放入，第一个放不下的和它之后的都收起：优先级高的总在优先级低的之前显示。被收起的条目按原来的显示顺序列在“更多”里；纯文字条目在那里也是不可执行的一行文字。
    - 条目文字、显示语言、可见性或容器宽度变化后重算。单个条目最宽 320px，超出时省略并以全文作提示；在“更多”里换行显示全文。
35. **状态栏**：左侧是项目名或“未打开项目”与布局问题（[ui.workbench-layout](workbench-layout.md) 的“失败与恢复”），之后是 `alignment: "left"` 的条目；右侧是 `alignment: "right"` 的条目，最右是“显示面板”。条目只显示贡献方给出的真实数据；编辑器提供的第一批条目见 [workbench.editor](../workbench/editor.md) 的“状态栏条目”。

### 无项目首页与第二页

随书架页实现。

36. **首页贡献点 `workbench.home`**：没有绑定项目的窗口打开 `/` 时，外壳换成首页贡献的内容；文档根（主题、语言）、命令宿主与通知视口（[workbench.notifications](../workbench/notifications.md)）照常挂着。
    - 声明 `{title}`（界面文字值，不写时补成约定键 `home.<本地 id>.title`，见 [ui.i18n](i18n.md) 的“约定键”），实现 `{load(): Promise<Component>}`，只接受浏览器入口的贡献。
    - 裁决按已接受的声明数量：0 个显示空工作台；1 个采用；多个全部不采用、按 id 排序记诊断。与登记顺序无关。
    - 每次渲染经当前句柄取实现；贡献撤回、入口停止或加载失败时退回空工作台并记诊断，入口恢复后再次采用。首页不占用布局（不取布局 store），直接打开首页的窗口不读产品布局记录。
    - 绑定了项目的窗口不受影响。
37. **`/workbench`**：工作台的第二个内置页面，不打开作品、直接进入空工作台（用户资产、命令面板与状态栏照常）。绑定由 `?project=` 决定、不看路径，所以 `/workbench?project=x` 与 `/?project=x` 相同。书架页不放它的入口，直接输入地址进入。

### 工作台打磨

打开作品之后那一页的外观与缺省显隐。

38. **卡片还是平铺由主题决定**：外壳读主题变量 `--shell-gap`、`--shell-ground`、`--shell-card-radius`、`--shell-card-shadow`、`--shell-chrome-surface`、`--shell-chrome-line`、`--shell-seam`、`--shell-join-divider`、`--shell-pane-divider`、`--shell-pane-divider-inset`（[`theme/system.md`](../theme/system.md)），缺省即平铺。
    - **卡片**（nbook）：活动栏与每块面板各是窗体底（`--bg-main`）上的一张圆角卡片（12px，不带外框，浅色一层淡投影、深色一圈淡外框）。贴着窗体、标题栏或状态栏的一边留整缝（4px），挨着别的部件的一边留半缝并扣掉两者之间边界占的一半，两张卡片之间合起来也是 4px；活动栏与通高的侧栏合成一张卡片，相接处不留缝、两角不圆，中间一条两端离顶底各 10px 的短线（侧栏隐藏、拖到零时不相连；相连与否按拖动中的宽度算：从零往外拉、往零拖时都不等松手）。标题栏与状态栏落在窗体底上、不画线；网格接缝不画，边界仍可拖。同一列工具面板之间仍画 1px 的 `--shell-pane-divider` 线，沿长轴两端各缩进 10px，不碰到卡片边（开放式分割线）。
    - **平铺**（macos）：部件贴着窗体，没有外框、圆角与外边距，外壳与各部件是同一块面板底色（`--panel-surface`）；可见的线只有标题栏底线、状态栏顶线与面板之间的 1px 接缝（默认布局里只有侧栏与编辑区之间一条竖线，显示右栏或面板时各多一条）。
    - 两种都一样：部件自己不画外框与圆角；面板头与编辑器标签栏都不画底线；面板的当前标签用加粗的正文色区分，编辑器标签栏的当前标签是与正文同色的一块（[`workbench/editor.md`](../workbench/editor.md) 输出 53）。工作台页占满视口、自己不滚动，页面根不预留滚动条位置。
### 活动栏底部条目与页面浮层

输出 40、41 已实现，随设置窗口（[settings.window](../settings/settings-window.md)）：工作台活动栏的设置齿轮与设置窗口本身经这两个贡献点接进工作台（书架右上角的齿轮是书架自己画的，见 [workbench.bookshelf](../workbench/bookshelf.md) 输出 1）。

40. **活动栏底部条目 `workbench.activitybar-items`**：底段的全局项（账号、设置这类）由插件贡献，写法与输出 33 的条目贡献点相同。
    - 声明（静态数据，登记时校验）：`{title, icon, order, command?: {id, args?}, when?, toggled?}`。`title` 是悬停提示与可访问名称，是界面文字值，不写时补成约定键 `activityItems.<本地 id>.title`（见 [ui.i18n](i18n.md) 的“约定键”）；`toggled` 是公开状态的布尔键。条目只有声明、没有实现，但只接受浏览器入口的贡献，随贡献方入口出现与消失：入口交空对象（内核要求入口贡献都给出实现）。id 规则同输出 33。
    - 排列：按 `order` 从上往下排在活动栏底部，同值按条目 id；上段放不下时收进“更多”，底段不动。
    - 可见：只由 `when` 决定（规则同输出 33），不满足时不渲染。
    - 样子与点击：有 `command` 的条目是与上段条目同样的图标按钮，经命令服务执行，命令不可用时禁用并以原因作提示；`toggled` 的键已就绪且为真时画成按下：灰底、图标正文色，不用强调色（强调色留给上段的当前视图）。没有 `command` 的条目不可点，是圆形、淡色的占位（同书架右上角的头像位），以 `title` 作提示。
    - 冲突与撤回：同 id 的两条贡献一起拒绝并记诊断；贡献方入口开始停止时条目消失。
    - 现有条目：`nbook.workbench` 贡献头像占位（`order: 900`，没有命令，提示“个人资料尚未开放”；账户插件迁回时由它贡献真正的头像并删去占位）；`nbook.settings` 贡献设置齿轮（`order: 1000`，命令 `nbook.settings.toggle`，`toggled: nbook.settings/windowOpen`），在最下面。
41. **页面浮层 `workbench.overlays`**：插件交一个组件，工作台在页面根上挂一份。书架是首页贡献、与工作台页用同一个页面根，所以首页、`/` 与 `/workbench` 都挂，每个浏览器页面一份，随页面卸载。
    - 声明 `{order?}`（挂载的先后，同值按 id），实现 `{load(): Promise<Component>}`，组件不收属性，要的数据由贡献方在 `load()` 里绑好；只接受浏览器入口的贡献，id 规则同视图。
    - 页面根挂上时就加载；贡献撤回、贡献方入口停止或工作台入口停止时卸下；同一个浮层重新交付时重新加载；加载结果回来时浮层已卸下就丢弃，不挂、也不记为失败。
    - `load()` 失败或组件渲染出错只让这一个浮层不显示并记诊断，别的浮层与页面照常；浮层不在页面里占位，没有原位呈现。
    - 现有浮层：`nbook.settings` 的设置窗口。

## 状态与转换

本 Spec 没有自己的持久状态：布局状态见 [ui.workbench-layout](workbench-layout.md) 的“状态与转换”，条目的可见与按下来自公开状态。

## 副作用与数据

不写记录。标题栏的显隐按钮、状态栏“显示面板”只经命令执行，写入归布局。

## 失败与恢复

- 布局未保存的提示在状态栏（输出 35），原因与重试、放弃见 [ui.workbench-layout](workbench-layout.md) 的“失败与恢复”。
- 活动栏底部条目、页面浮层的声明不合规则（输出 40、41）：声明被拒，内核诊断写明原因，条目或浮层不出现。
- 页面浮层的 `load()` 失败或组件渲染出错（输出 41）：这一个浮层不显示，诊断 `workbench.overlays` 写明浮层 id 与原因；页面与别的浮层照常，刷新页面重新加载。

## 边界与兼容

- 归属：`nbook.workbench`。
- 主题与浮层：沿用 [theme.system](../theme/system.md) 与 nb-ui 现有 portal，不新增第二套。外壳与浮层颜色来自主题 token，四主题 × 双配色下不出现 `:root` 兜底底色。
- 公开合同：贡献点 `workbench.statusbar-items`、`workbench.titlebar-items`、`workbench.activitybar-items`、`workbench.overlays` 与 `workbench.home` 是对插件的合同；`workbench.editor-area` 见 [ui.workbench-layout](workbench-layout.md) 的“边界与兼容”。
- 窄屏：`390 × 844` 无页面级横向滚动。
- Lab：外壳的 Lab 场景用局部状态，不读写产品布局记录；直接打开 Lab 的窗口不打开、不订阅产品布局记录（[ui.component-lab](component-lab.md)）。

## 验收与 Smoke

### 外壳四

32. Given 1440×900 的产品页，When 读标题栏，Then 横排标志、项目切换、四组菜单依次在左，搜索居中，三个布局按钮与条目区在右，36px 一行里互不遮挡；状态栏仍为 22px。
33. Given 应用菜单，When 逐组打开，Then 只出现命令目录里有的项；不可用的项禁用且悬停与可访问描述里是原因；“打开文件”“设置”“退出”“剪切、复制、粘贴、全选”“缩放”“关于”都不出现；勾选项与公开状态一致。
34. Given 活动编辑器里改过正文，When 点开“编辑”执行“撤销”，Then 正文回退；When 用 Alt（或 F10）、方向键与 Enter 执行同一项，Then 结果相同，Escape 后焦点回到菜单打开前的位置；没有活动编辑器时撤销禁用并给出原因。
35. Given 中文界面与项目名，When 窗口从 1440 每次收窄 10px 到 390，Then 档位只增不减、依次收起横排标志、菜单栏、快捷键提示、布局按钮与项目名，搜索不窄于 120px，任何宽度都有可点的菜单入口；收成 ≡ 后点开是四组、悬停展开子菜单；从切换点往回放宽 30px 不变、60px 才展开；长项目名、英文界面与条目共存时关键按钮的可见矩形完整、互不重叠。
36. Given 侧栏分别处于隐藏、拖到零与紧凑往返之后，When 点标题栏的侧栏按钮、视图菜单的侧栏项与命令面板的“切换区域显隐”，Then 侧栏回到记忆尺寸，按钮的按下态、菜单勾选与实际可见一致；命令面板省略参数时先选区域，取消不写入。
37. Given 有未保存正文的窗口，When 执行“重新载入”并在离开确认里取消，Then 正文仍在；When 确认，Then 页面重新加载、地址的项目参数不变。When 执行“文档”，Then 文档站在新标签打开，原页面与正文仍在；新标签被拦截时命令说明原因。
38. Given 测试插件贡献的状态栏与标题栏条目，When 入口激活、同 id 的第二条贡献、入口停止，Then 条目出现、两条同 id 都被拒并诊断、停止开始时条目消失；When 收窄容器，Then 按 priority 收进“更多”（恰好装下、差一个“更多”的位、同优先级、全部收起、长文字各一例），点开“更多”能执行有命令的条目、纯文字不可执行；“更多”打开时入口停止，菜单里的该条消失。
39. Given 两个窗口，When 各自编辑不同的文档，Then 各自的状态栏条目只反映本窗口的数据。

### 无项目首页

40. Given 没有项目的窗口与书架插件，When 打开 `/`，Then 看到书架页而不是外壳，主题 token 与命令面板照常；When 打开 `/workbench`，Then 是空工作台；When 两个插件都贡献首页，Then 都不采用、回到空工作台并有诊断；When 贡献方入口停止，Then 页面退回空工作台，恢复后再次采用。

### 工作台打磨

41. Given 1440×900 的产品页（默认布局），When 读计算样式与截图（nbook、macos 各明暗两态），Then 活动栏、面板、面板头自己都没有边框与圆角，外壳根底色等于 `--shell-ground`，页面右缘没有空出的滚动条位置；nbook：活动栏卡片离窗体左缘与标题栏各 4px，活动栏与侧栏相连（相接两角为 0、之间是 `--divider` 的短线），侧栏与编辑区两张卡片之间 4px，卡片圆角 12px，标题栏底线与网格接缝透明；macos：部件贴着窗体，侧栏与编辑区之间只有 1px 接缝，标题栏底线与接缝是 `--divider`，没有短线。

### 活动栏底部条目与页面浮层

43. Given 测试插件贡献的活动栏底部条目（有命令、没有命令、带 `toggled`、带 `when`），When 入口激活、公开状态变化、命令变得不可用、同 id 的第二条贡献、入口停止，Then 条目按 `order` 排在底部，`when` 不满足时不显示，`toggled` 为真时按下，没有命令的不可点，命令不可用时禁用并以原因作提示，同 id 的两条都被拒并诊断，停止开始时条目消失。Given 产品页，Then 活动栏最下面头像占位在上、设置齿轮在下，设置窗口开着时齿轮按下。
44. Given 几个浮层贡献，其中一个 `load()` 失败、一个渲染出错，When 打开首页与工作台页，Then 两种页面都挂着浮层；失败的浮层不显示并记诊断，别的浮层与页面照常；When 贡献撤回，Then 浮层卸下，迟到的加载结果不挂、不记失败。
45. Given 测试插件贡献一个不写 `title` 的状态栏条目，实现的 `text()` 每次返回同一个文字引用，插件目录里有这两个键；When 入口激活、再切换界面语言；Then 条目的名字取约定键 `statusItems.<本地 id>.title`、显示文字取 `text()` 交回的引用，都是当前语言的文字；切换语言后两者都换成新语言的文字，插件不用重新交文字。

Smoke 入口：生产构建下打开 `/` 与 `/?project=…`（桌面与 `390 × 844` 各一次）；Lab 外壳场景（`lab:shot` 截图）；`e2e/workbench-shell.e2e.ts`、`e2e/workbench-views.e2e.ts`；`bun run --cwd packages/nb-ui test` 复核布局原语。

## 实现合同

- **浮层挂在页面根、不占位**：`createWorkbenchPages` 的两页都渲染浮层宿主（`overlays.ts` 的 `createOverlayHost`）；宿主不包外层元素，页面根仍是外壳的承载盒。每个浮层一个框，各自加载、用 Vue 的错误边界各自接住渲染错误。
- **首页只换外壳**：`createHomePage` 在没有项目且有首页贡献时渲染贡献的组件，文档根与命令宿主不变；`/workbench` 与 `/` 共用同一页面组件，区别只是是否采用首页贡献。首页贡献点的声明与校验在 `shared/home.ts`。
- **页面自己加载首屏、自己标画出**：文档根的设置与外壳由 `createWorkbenchPages` 自己加载（`WorkbenchPageParts` 的 `document`、`shell` 给加载函数与渲染时取的属性），不经 `defineAsyncComponent` 包装，两页共用加载结果；文档根的设置与此刻的主体（外壳或首页贡献）都挂上之后，页面根才带 `data-page-rendered`（页面合同见 [PageOutlet](../../../packages/neuro-book/src/web/PageOutlet.md)），主体换了等新主体挂上再带。外壳或文档根加载失败记 `workbench.page` 诊断、页面根不带这个标记，再挂载页面时重新加载。编辑器槽的提供者组件加载期间，槽里是一句给读屏的“正在加载编辑器”（`role="status"`，这个容器带 `aria-busy="true"` 与 `data-workbench-editor-loading`），加载失败时换成失败原因（`role="alert"`），不再带 `aria-busy`（`editor-area.ts` 的 `editorAreaComponent`）。

## 证据

- 实现入口：标题栏与状态栏 [`web/components/WorkbenchShell.vue`](../../../packages/neuro-book/src/plugins/workbench/web/components/WorkbenchShell.vue)、[`web/items/`](../../../packages/neuro-book/src/plugins/workbench/web/items/activity-items.ts)；活动栏底部条目与页面浮层 [`shared/items.ts`](../../../packages/neuro-book/src/plugins/workbench/shared/items.ts)、[`shared/overlays.ts`](../../../packages/neuro-book/src/plugins/workbench/shared/overlays.ts)；首页 [`web/home-page.ts`](../../../packages/neuro-book/src/plugins/workbench/web/home-page.ts)。
- 合同测试：[`activity-items.test.ts`](../../../packages/neuro-book/src/plugins/workbench/activity-items.test.ts)、[`web/overlays.test.ts`](../../../packages/neuro-book/src/plugins/workbench/web/overlays.test.ts)、[`web/home-slot.test.ts`](../../../packages/neuro-book/src/plugins/workbench/web/home-slot.test.ts)。
- Smoke：[`settings.e2e.ts`](../../../packages/neuro-book/e2e/settings.e2e.ts)、[`workbench-titlebar.e2e.ts`](../../../packages/neuro-book/e2e/workbench-titlebar.e2e.ts)、[`workbench-shell.e2e.ts`](../../../packages/neuro-book/e2e/workbench-shell.e2e.ts)。
- 批准依据：活动栏底部条目与页面浮层（输出 40、41）为 t80 计划（`.agents/works/w00017-application-runtime-architecture/tasks/t80-settings-ui/plan.md`）第 5 节，开发者 2026-10-12 批准；外壳一到三被 [布局提案](../../proposals/workbench-single-tree-layout.md) 取代；外壳四以前的原文见 Git 历史。
