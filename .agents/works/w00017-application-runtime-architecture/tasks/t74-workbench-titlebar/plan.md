# t74 实施计划：外壳四——标题栏、状态栏与两个条目贡献点

## Context

- **为什么做**：开发者 2026-10-10 要求完善 web 主页面的外壳，把旧应用的标题栏迁过来，迁移中可以排错、优化与调整样式。现状：
  - 标题栏只有“NeuroBook”和项目短名两段文字；
  - 状态栏只有项目名、“显示面板”与布局未保存的提示，没有让插件放条目的接口。
  - 外壳 Spec 把标题栏的菜单、搜索、窗口控制与两类条目贡献点列为非目标，留到外壳一到三之后（[`ui/workbench-shell.md`](../../../../../docs/specs/ui/workbench-shell.md)“目标与非目标”）。
- **必须回答的审查条目**：
  - t73 计划审查（[报告](../t73-lab-nb-ui-and-storage/evidences/design-review.txt)）的 P07 菜单映射、P08 贡献点合同、P09 验收，F04 能力模型、F05 排序与撤回诊断，见下面“审查条目的回答”；
  - 本计划的 omp 审查（[报告](evidences/plan-review.txt)）13 条与补充功能 3 条，处理见“计划审查的处理”。
- **参照**（只读，不改旧包）：
  - 旧标题栏 `packages/neuro-book-legacy/app/components/desktop-title-bar/`，包括品牌、菜单、命令中心、项目切换、操作与窗口控制，共约 1200 行；
  - `app/utils/workbench-chrome.ts` 的菜单能力模型（固定四组 IA、按宿主能力裁剪、禁用必有原因）与溢出预算。
- **工作方式**：
  - worktree `.worktree/w00017-runtime-foundation`；每片自跑验证后单独提交、推送备份；
  - 测试用真实内核、真实命令服务与真实 Chrome，不用 mock、spy、假计时器、固定等待；
  - 新组件带同名 `.md` 与 Lab 场景。

## 审查条目的回答

### P07 与 F04：菜单由能力模型生成，旧的 15 个 id 逐个落地

菜单保留旧的四组信息架构（文件、编辑、视图、帮助），每一项是一条 canonical 命令加固定参数，由一个纯函数按宿主能力与命令目录生成；不为凑满菜单画假入口。旧 id 的去向：

| 旧 id | 新应用 | 去向 |
|---|---|---|
| `file.open` | 没有“选一个文件打开”的无参命令；`nbook.editor.open` 要 `{address, mode}` | **不画**，留待文件快速打开 |
| `file.settings` | 没有设置页面 | **不画**，留待设置页面 |
| `file.quit` | 桌面宿主才能退出 | 浏览器**不画** |
| `edit.undo`、`edit.redo` | `nbook.edit.undo`、`nbook.edit.redo`（编辑器插件贡献，`when` 是活动编辑器且可写） | 现成命令，作用于活动编辑器（见 P1） |
| `edit.cut`、`edit.copy`、`edit.select-all` | 没有对应命令 | **不画**，用快捷键；不为它们新造命令 |
| `edit.paste` | 浏览器不允许页面代替用户读剪贴板 | 浏览器**不画** |
| `view.reload` | 宿主新增“重新载入当前文档”端口（见 P2） | **新增** `nbook.app.reload` |
| `view.zoom-in/out/reset` | 桌面宿主的缩放 | 浏览器**不画** |
| `help.documentation` | 宿主新增“在新标签页打开外部地址”端口 | **新增** `nbook.help.documentation` |
| `help.about` | 没有关于页 | **不画**，留待关于页 |

菜单的全部条目（括号里是固定参数；省略的为 `{}`）：

- **文件**：打开项目（`nbook.project.open`）｜保存、全部保存、还原为磁盘版本（`nbook.editor.save`、`save-all`、`revert`）｜关闭编辑器、关闭其它编辑器（`close`、`close-others`）。
- **编辑**：撤销、重做。
- **视图**：
  - 命令面板（`nbook.quick-open.open-commands`）；
  - 侧栏、右栏、活动栏（`nbook.view.set-part-hidden {part}`）、面板（`nbook.view.set-panel-hidden`）：勾选项，勾选状态取公开状态（见 P6）；
  - 面板位置（`set-panel-position`，省参时选择）、最大化面板（`toggle-panel-maximized`）；
  - 向右拆分、向下拆分、用其它编辑器重新打开（`nbook.editor.split-right`、`split-down`、`reopen-with`，F2）；
  - 切换主题、明暗与界面语言（`nbook.settings.switch-*`）；
  - 重新载入（`nbook.app.reload`）。
- **帮助**：文档（`nbook.help.documentation`）。

**能力模型**（`src/plugins/workbench/web/titlebar/menu-model.ts`，纯函数）：

- 输入：
  - 宿主能力 `{desktop: boolean}`；
  - 命令目录：`CommandService.list()` 与 `isEnabled()` 的结果，后者不可用时带原因；
  - 公开状态的读取函数（勾选项用）；
  - 菜单定义：每项 canonical 命令 id、固定参数、`desktopOnly`、可选的勾选键。
- 输出四组菜单，每项包括：
  - 标题：取命令的标题，语言跟随配置；
  - 是否可用，以及不可用的原因：取 `isEnabled()` 给的原因；
  - 快捷键：取命令声明的 `keybinding`，按平台格式化（P13）；
  - 勾选状态。
- 规则：
  - 命令不在目录里（贡献方没加载）：不画；
  - `desktopOnly` 而宿主不是桌面：不画；
  - 命令在、不可用：画成禁用，悬停与读屏给出原因；
  - 分隔线两侧有一侧为空时去掉；一组全被裁掉时这一组不画。
- 执行一律经命令服务 `execute(id, 固定参数)`，菜单不另写实现。

### P08 与 F05：两个条目贡献点的合同

在外壳 Spec 增加“外壳四”，定义 `workbench.statusbar-items` 与 `workbench.titlebar-items`，写法与 `workbench.views` 相同：

- **声明**（静态数据，登记时校验）：`{title, alignment: "left" | "right", order, priority, command?: {id, args?}, when?}`。
  - `title` 是条目的名字（进“更多”菜单与读屏）。
  - 标题栏条目只接受 `alignment: "right"`：品牌与菜单在左、搜索居中，条目放在右侧操作区。
- **实现**（浏览器入口激活时交出）：`{text(): string, tooltip?(): string, state?(): "normal" | "warning" | "error"}`，都是响应式读取。
  - 数据由贡献方从自己的状态算出，外壳只渲染，不读任何领域状态；
  - 显示条件只靠声明里的 `when`（公开状态的布尔键），`text()` 不承担隐藏。
- **排序**：按 `alignment` 分两侧；同侧按 `order` 升序，再按条目 id。
- **可见**：`when` 走命令目录同一套上下文键与公开状态，不满足时不渲染。
- **溢出**（P11）：见“关键设计”第 5 节的预算规则。
- **冲突与撤回**：
  - 同 id 的两条贡献一起拒绝并记诊断，与命令相同；
  - 贡献方入口停止开始时条目立即消失（以交付句柄的 `published` 为准，不等撤回回调），每次求值都经 `handle.implementation()`，打开中的“更多”菜单也不再调用旧实现；
  - 实现抛错的条目原位显示为不可用并记诊断，不影响别的条目。
- **点击**：
  - 有 `command` 的条目是按钮，经命令服务执行，命令不可用时禁用并以原因作提示；
  - 没有 `command` 的是纯文字（`role="status"`），在“更多”菜单里也是不可执行的一行文字。

第一批使用者，都由编辑器插件贡献、放在状态栏右侧，只放真实数据：

| id | 文字 | `when` | 点击 | order、priority |
|---|---|---|---|---|
| `nbook.editor.unsaved` | 未保存 N 个（N 按文档去重，同一文件分组显示只算一个） | `nbook.editor/hasUnsavedDocuments` | 全部保存 | 10、30 |
| `nbook.editor.word-count` | 活动文档的字数（“1,234 字”） | `nbook.editor/active` | 无 | 20、20 |
| `nbook.editor.cursor` | 第 L 行，第 C 列 | `nbook.editor/hasCursorPosition` | 无（P9） | 30、10 |

- “未保存”的 tooltip 列出至多 5 个文件；有文档正在保存时说明“正在保存”，有保存失败时状态为 `error` 并列出失败的文件与原因（F1）。
- 字数用新的共享函数 `countWords`（`src/shared/word-count.ts`），t75 的书架统计用同一个。

### P09：验收

外壳 Spec 的“外壳四”验收覆盖：

- **高度**：标题栏 36px、状态栏 22px 不变。
- **宽度模式**：按标题栏容器的实测宽度：
  - 至少 960px：完整菜单栏；
  - 600 到 959px：四组收进一个“菜单”按钮；
  - 不足 600px：搜索只留图标，项目名截断，布局按钮收进菜单的视图组。
  - 任何宽度下菜单入口都在。
- **无项目**：
  - 没有活动文档时，保存类条目按命令的可用性禁用；
  - 打开了 `user://` 文件时可以照常保存（P4）；
  - 项目切换显示“打开项目…”。
- **编辑项**：作用于活动编辑器。
  - 点开“编辑”菜单执行“撤销”，活动编辑器的正文回退；
  - Alt 或 F10 打开菜单后执行，结果相同；
  - 没有活动编辑器时禁用，原因可见。
- **菜单键盘**：
  - Alt 或 F10 聚焦菜单栏（紧凑时聚焦“菜单”按钮）；
  - 左右键在组之间移动，上下键在项之间移动并跳过分隔线，禁用项可停留但不能执行；
  - Enter 执行；Escape 关闭并把焦点还给打开菜单前的位置。
- **未实现的项不渲染**：表里标“不画”的那些。
- **条目贡献点**：
  - 激活后出现，同 id 被拒，入口停止后消失；
  - 按 order 排序，窄时按 priority 收进“更多”；
  - 点击走命令；
  - 两个窗口各自显示自己的数据。

## 计划审查的处理

| 编号 | 结论 | 处理 |
|---|---|---|
| P1 编辑菜单的焦点条件不存在（阻断） | 成立 | 菜单与命令面板一致，作用于活动编辑器，不按焦点区分；不承诺对原生输入框撤销（浏览器自己的 Ctrl+Z 照常）。P09 改为“从菜单执行撤销，活动编辑器回退”，点击与 Alt/F10 两条路径各验一次 |
| P2 导航服务不能刷新与开新标签 | 成立 | `WindowNavigation` 增加 `reloadDocument()` 与 `openExternal(href): "opened" \| "blocked"`。刷新只确认请求已发出，离开保护沿用编辑器已有的 `beforeunload`；两条新命令 `agent: never`，理由同“打开项目”（打断或离开 Agent 所在窗口）。验收“有未保存正文时取消刷新，正文还在”“刷新后地址的项目参数不变”“文档在新标签打开，原页面正文仍在” |
| P3 Menubar 没有禁用原因的接口 | 成立 | nb-ui 菜单项增加 `description`：渲染为 `title` 与 `aria-description`，禁用项同样带上；`Menubar.md`、`Dropdown.md` 与 Lab 场景同步。验收实际 DOM 里的原因 |
| P4 无项目不等于不可保存 | 成立 | 去掉“需要项目”的统一禁用，按命令自身的可用性；验收分“无项目无活动文档”和“无项目编辑 `user://` 文件可保存” |
| P5 `set-part-hidden` 的 `part` 必填，面板里执行不了 | 成立 | `part` 也可省略：省略时经选择服务选区域，取消无副作用，与 `set-panel-position` 同一写法；菜单与按钮给固定 `{part}`。S2 先验证命令面板的 `{}` 能执行 |
| P6 拖到零的侧栏“显示”后仍是 0px，没有可见性公开键 | 成立 | “可见”定义为未隐藏且未拖到零；“显示”清掉这两位并恢复记忆的尺寸（复用面板已有的恢复写法）；省参切换以可见为准。新增公开键 `sidebarVisible`、`auxiliaryBarVisible`、`activityBarVisible`。验收隐藏、拖到零、紧凑往返后按钮的按下态、菜单勾选与实际可见一致 |
| P7 Menubar 叶子没接入 reka 的导航 | 成立 | 新增 S1（nb-ui）：`MenuNodes` 的叶子与级联触发项改用所在根的 reka 菜单项原语（Menubar、Dropdown、ContextMenu 三处共用），上下键、Home、End、首字母跳转、禁用项与 Escape 还焦点由 reka 负责；标题栏菜单不用级联（紧凑的“菜单”按钮以组标题分节，不嵌套）。手工级联面板的键盘仍有限，`Menubar.md` 按实测写明（R1） |
| P8 条目的显示条件没有公开键 | 成立 | 编辑器新增公开键 `hasUnsavedDocuments`、`hasCursorPosition`；三个条目的 id、order、priority、`when` 见上表。条目文字由编辑器自己的实现给出（贡献方的状态），外壳不读领域状态；验收“非活动文档 dirty 也计数”“同一文件两组只算一个”“切换有无光标位置的控件”“两个窗口各自显示”“停止后消失” |
| P9 跳到行不是产品里的命令 | 成立 | 本 Task 不接跳到行：光标条目是纯文字，菜单里不画（命令不在目录里，模型自然不画）。产品的行号跳转（命令面板 `:N` 与编辑器目标端口）另立后续 |
| P10 最窄档会拿掉菜单入口 | 成立 | 三档按标题栏容器实测宽度（960、600 两个边界），任何宽度都保留菜单入口；先收品牌文字与搜索文案。验收 959/960、599/600 两侧、390、长项目名、中英文与条目共存，检查关键按钮的可见矩形可点击 |
| P11 溢出规则不确定 | 成立 | 见“关键设计”第 5 节：固定区先占预算，按 priority 降序、order 升序、id 依次放入，放不下时先给“更多”留位；纯文字在“更多”里不可执行；文字、语言、可见性变化后重算。S4 覆盖恰好装下、差一个“更多”的位、同优先级、全收起、长文字、“更多”打开时撤回 |
| P12 Markdown 的行列没有坐标定义 | 成立 | Markdown 控件不提供光标位置（返回 null），条目只在源码编辑器显示；坐标定义为 Monaco 选区活动端的 1 起行号与列号（列按 Monaco 的列，制表符计 1）。另加“字数”条目，两种控件都有 |
| P13 快捷键提示与 macOS 不符 | 成立 | 新增 `formatKeybinding(binding, platform)`（`keymap.ts`），命令面板、菜单与搜索按钮共用；只显示命令声明的键位，编辑器区的局部键位不冒充全局键 |
| F1 未保存条目说明保存中与失败 | 采纳 | 放在 S6，见上表说明 |
| F2 拆分、切换编辑器、关闭其它进菜单 | 采纳 | 已列入菜单条目 |
| F3 项目列表的“在新标签打开” | 转给 t75 | t75 书架的扉页已有“在新窗口打开”，用本 Task 的 `openExternal` |

## 关键设计

### 1. 宿主端口与命令（`src/shared/host.ts`、`src/web/host/`、`src/plugins/workbench/`）

- `WindowNavigation` 增加 `reloadDocument(): void` 与 `openExternal(href: string): "opened" | "blocked"`；浏览器宿主用 `location.reload()` 与 `window.open(href, "_blank", "noopener")`。
- 新命令由工作台浏览器入口贡献：
  - `nbook.app.reload`：无参，`effect: read`，`agent: never`；
  - `nbook.help.documentation`：无参，`effect: read`，`agent: never`；文档站地址是工作台常量，Spec 写明；新标签被拦截时命令以 `unavailable` 结束并说明。
- `nbook.view.set-part-hidden {part?, hidden?}`：
  - `part` 取 `sidebar`、`auxiliarybar`、`activitybar`，省略时经选择服务选择；
  - `hidden` 省略时按可见性切换；
  - 写同一份用户定制记录。
- 布局 store 的“显示”同时清掉拖到零的位并恢复记忆尺寸。
- 公开状态新增 `sidebarVisible`、`auxiliaryBarVisible`、`activityBarVisible`。
- `keymap.ts` 新增 `formatKeybinding`，命令面板改用它显示快捷键。

### 2. nb-ui 菜单（`packages/nb-ui/src/components/controls/`）

- `MenuNodes` 接收所在根的菜单项原语（Menubar、Dropdown、ContextMenu 各自传入 reka 的 `*Item`），叶子与级联触发项都成为 reka 的集合项。
  - 选择经 reka 的 `select` 事件；级联触发项阻止默认关闭并打开级联；
  - 现有手工级联面板、悬停延迟与切换动画不变。
- 菜单项数据增加 `description?: string`：渲染为 `title` 与 `aria-description`。
- `Menubar` 增加 `variant: "floating" | "flat"`：`flat` 不画外框与模糊，供标题栏用。
- `Menubar.md`、`Dropdown.md`、`ContextMenu` 文档写明顶层与级联各自的键盘保证；Lab 场景补禁用原因与键盘。

### 3. 标题栏（`src/plugins/workbench/web/titlebar/`）

- `menu-model.ts`：能力模型，纯函数，Bun 测试。
- `WorkbenchTitleBar.vue`：
  - 品牌；
  - 菜单栏（nb-ui `Menubar`，`variant="flat"`）或紧凑的“菜单”按钮（nb-ui `Dropdown`，组标题分节）；
  - 居中的命令搜索按钮：点开命令面板，提示按平台格式化的快捷键；
  - 项目切换：当前项目短名，点开列出“打开项目…”；作品列表随 t75；
  - 布局按钮：侧栏、面板、右栏三个切换，按下态取公开状态；
  - 右侧条目区。
- 替换 `WorkbenchShell.vue` 里现在的标题栏两段文字。
- 宽度模式由标题栏根元素的 ResizeObserver 决定；Alt 或 F10 聚焦菜单入口，Escape 把焦点还给之前的位置。
- 浏览器里不画窗口控制。

### 4. 状态栏（`WorkbenchStatusBar.vue`）

- 左侧仍是项目名与布局问题（固定区）；右侧依次是条目区与“显示面板”（固定区）。
- 条目来自 `workbench.statusbar-items`。

### 5. 条目贡献点与溢出（`src/plugins/workbench/web/items/`）

- `registry.ts`：登记校验、交付句柄、撤回作废，照 `views/registry.ts` 的写法；两个贡献点共用，各自一个实例。
- `item-strip.ts`：溢出预算，纯函数，输入是可用宽度、固定区宽度、“更多”按钮宽度与每个可见条目的实测宽度：
  - 按 priority 降序、order 升序、id 依次放入；
  - 放不下时，先为“更多”留出完整按钮位再放；
  - 被收起的条目按原来的显示顺序进“更多”菜单。
- `WorkbenchItemStrip.vue`：渲染条目与“更多”。
  - 量宽用一份隐藏的测量层，收起的条目不丢尺寸；
  - 文字、语言、可见性与容器宽度变化时重算；
  - 单个条目最宽 320px，超出时省略，tooltip 给全文；在“更多”里换行显示全文。

### 6. 编辑器的条目（`src/plugins/editor/web/`、`src/shared/word-count.ts`）

- 公开状态新增：
  - `hasUnsavedDocuments`：任一打开的文档 dirty，按文档去重；
  - `hasCursorPosition`：活动控件提供光标位置。
- `EditorControlHandle` 新增可选的 `position: Readonly<Ref<{line, column} | null>>`：
  - 只有 Monaco 实现，取选区活动端；
  - Markdown 不实现；
  - 控件换文档与卸载时随句柄撤回。
- 三个条目的声明与实现在编辑器浏览器入口；字数由 `countWords(活动文档正文)` 计算，正文变化后在下一帧更新。
- `countWords`：汉字、假名、谚文每字计 1；连续的拉丁字母与数字计 1 个词；开头的 YAML frontmatter 不计。

## Spec 与文档改动（S0）

| 文件 | 改什么 |
|---|---|
| `docs/specs/ui/workbench-shell.md` | 非目标删去“状态栏与标题栏条目的贡献点”；新增“外壳四”：标题栏结构、菜单能力模型与条目表、宽度三档、两个贡献点的声明、实现、排序、可见、溢出、冲突与撤回；新公开键；验收与证据 |
| `docs/specs/workbench/commands.md` | 第二批加 `set-part-hidden`；新增 `nbook.app.reload`、`nbook.help.documentation`；“兼容与安全”里 15 个桌面 id 改为本计划的去向表；快捷键的显示按平台格式化 |
| `docs/specs/workbench/editor.md` | 控件句柄的可选光标位置与坐标定义；两个新公开键；三个状态栏条目 |
| `docs/specs/runtime/browser-host.md` | `WindowNavigation` 的两个新端口 |

## 切片

| 片 | 内容 | 自跑验证 |
|---|---|---|
| S0 | 上表四份 Spec | `docs:check`、`governance:check` |
| S1 | nb-ui 菜单：叶子接入 reka 菜单项、`description`、`Menubar` 的 `flat` | nb-ui Vitest；`lab-nb-ui.e2e.ts` 补菜单键盘与禁用原因 |
| S2 | 宿主端口、三条命令、`set-part-hidden`、Part 可见公开键与“显示”恢复、`formatKeybinding` | 命令与布局的 Bun 测试；typecheck；命令面板执行 `{}` |
| S3 | 菜单能力模型 | Bun：裁剪、禁用原因、分隔线、空组、宿主能力、勾选 |
| S4 | 两个贡献点的登记与撤回、溢出预算、`WorkbenchItemStrip` | Bun（真实内核）与 Vitest；溢出场景 |
| S5 | 标题栏组件、外壳接线、状态栏改造 | Vitest；Lab 场景；`lab:shot`；`workbench-shell.e2e.ts` 补外壳四验收 |
| S6 | 编辑器的三个条目、两个公开键、光标位置、`countWords` | 编辑器 Bun 与 Vitest；`editor-area.e2e.ts` 补条目 |
| S7 | 证据、omp 实现审查与修正、全量 e2e | `test:affected --typecheck`、全量 e2e、`docs:check`、`governance:check` |

## 验收映射

| 行为 | 覆盖 |
|---|---|
| 菜单按能力裁剪、禁用带原因、未实现不画、勾选取公开状态 | `menu-model.test.ts` |
| nb-ui 菜单的上下键、Home、End、禁用项、Escape 还焦点、禁用原因的 DOM | nb-ui Vitest、`lab-nb-ui.e2e.ts` |
| 从菜单执行撤销（点击与 Alt/F10 两条路径） | e2e |
| 宽度三档的边界、菜单入口始终在、关键按钮可点 | e2e：959/960、599/600、390 |
| 刷新取消保留正文、刷新后项目参数不变、文档在新标签打开 | e2e |
| Part 隐藏、拖到零、紧凑往返后按钮、勾选与可见一致 | 布局 Bun 测试与 e2e |
| 贡献点：出现、同 id 拒绝、撤回、排序、溢出各分支、点击执行 | Bun（真实内核）、Vitest 与 e2e |
| 未保存数（去重、非活动文档）、字数、光标位置（只在源码编辑器） | 编辑器测试与 `editor-area.e2e.ts` |
| 无项目时保存 `user://` 文件 | e2e |
| 标题栏 36px、状态栏 22px、无页面横向滚动 | `workbench-shell.e2e.ts` |

## 不做

- 桌面窗口控制与桌面菜单接线（有桌面宿主再做）。
- 作品列表与项目切换列表（随 t75）。
- 新造剪切、复制、全选命令；设置页面；关于页；文件快速打开。
- 产品的行号跳转（命令面板 `:N` 与编辑器目标端口）。
- 菜单级联面板的完整键盘（标题栏菜单不用级联）。

## 风险

- S1 改的是三个组件共用的 `MenuNodes`：Dropdown 与 ContextMenu 的现有测试与 Lab 场景要原样通过；不通过时先补齐再继续。
- 溢出的测量依赖真实字体与布局：Vitest 只测预算函数与渲染分支，宽度结果以真实 Chrome 为准。
