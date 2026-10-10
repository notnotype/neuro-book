# t74 实施计划：外壳四——标题栏、状态栏与两个条目贡献点

## Context

- **为什么做**：开发者 2026-10-10 要求完善 web 主页面的外壳，把旧应用的标题栏迁过来，迁移中可以排错、优化与调整样式。现在的标题栏只有“NeuroBook”和项目短名两段文字；状态栏只有项目名、“显示面板”与布局未保存的提示，没有让插件放条目的接口。外壳 Spec 把标题栏的菜单、搜索、窗口控制与两类条目贡献点列为非目标，留到外壳一到三之后（[`ui/workbench-shell.md`](../../../../../docs/specs/ui/workbench-shell.md)“目标与非目标”）。
- **必须回答的审查条目**（t73 计划审查，[报告](../t73-lab-nb-ui-and-storage/evidences/design-review.txt)）：P07 菜单映射、P08 贡献点合同、P09 验收，F04 能力模型、F05 排序与撤回诊断。逐条见下面“审查条目的回答”。
- **参照**：旧标题栏 `packages/neuro-book-legacy/app/components/desktop-title-bar/`（品牌、菜单、命令中心、项目切换、操作、窗口控制，共约 1200 行）与 `app/utils/workbench-chrome.ts` 的菜单能力模型（固定四组 IA、按宿主能力裁剪、禁用必有原因）。只读参照，不改旧包。
- **工作方式**：worktree `.worktree/w00017-runtime-foundation`；每片自跑验证后单独提交、推送备份；测试用真实内核、真实命令服务与真实 Chrome，不用 mock、spy、假计时器、固定等待；新组件带同名 `.md` 与 Lab 场景。

## 审查条目的回答

### P07 与 F04：菜单由能力模型生成，旧的 15 个 id 逐个落地

菜单保留旧的四组信息架构（文件、编辑、视图、帮助），每一项是一条 canonical 命令，由一个纯函数按宿主能力生成；不为凑满菜单画假入口。旧 id 的去向：

| 旧 id | 新应用 | 去向 |
|---|---|---|
| `file.open` | 没有“选一个文件打开”的无参命令；`nbook.editor.open` 要 `{address, mode}` | **不画**，留待文件快速打开（Quick Open 文件模式）出现后接上 |
| `file.settings` | 新应用的设置只有切换命令，没有设置页面 | **不画**，留待设置页面 |
| `file.quit` | 桌面宿主才能退出 | 浏览器**不画** |
| `edit.undo`、`edit.redo` | `nbook.edit.undo`、`nbook.edit.redo`（编辑器插件 `editor/web/commands.ts` 贡献，`when` 读编辑器焦点） | 现成命令，禁用时显示命令的 `when` 原因 |
| `edit.cut`、`edit.copy`、`edit.select-all` | 没有对应命令 | **不画**（浏览器里用快捷键；不为它们新造命令） |
| `edit.paste` | 浏览器不允许页面代替用户读剪贴板 | 浏览器**不画** |
| `view.reload` | 宿主有整页导航能力 | **新增** `nbook.app.reload`（无参，`effect: read`），重新载入当前页面 |
| `view.zoom-in/out/reset` | 桌面宿主的缩放 | 浏览器**不画** |
| `help.documentation` | 用户文档站地址 | **新增** `nbook.help.documentation`（无参，在新标签页打开文档站） |
| `help.about` | 没有关于页 | **不画**，留待关于页 |

新应用另有、值得放进菜单的现成命令：

- 文件：打开项目（`nbook.project.open`）、保存（`nbook.editor.save`）、全部保存（`nbook.editor.save-all`）、还原（`nbook.editor.revert`）、关闭编辑器（`nbook.editor.close`）；
- 视图：命令面板（`nbook.quick-open.open-commands`）、跳到行（`nbook.quick-open.open-line`）、侧栏、右栏与面板的显隐（见下）、面板位置（`nbook.view.set-panel-position`）、切换主题、明暗与界面语言（`nbook.settings.switch-*`）。

**能力模型**（`src/plugins/workbench/web/titlebar/menu-model.ts`，纯函数）：输入是宿主能力 `{desktop: boolean}`、命令目录（`CommandService.list()` 与 `isEnabled()` 的结果，后者不可用时带原因）与菜单定义；每个菜单项写 canonical 命令 id、可选的固定参数、`desktopOnly`。输出四组菜单，每项：标题（取命令的标题，语言跟随配置）、是否可用、禁用原因（取命令 `when` 不满足时的原因文本）、快捷键（取命令的默认键位）。规则：

- 命令不在命令目录里（贡献方没加载）：不画；
- `desktopOnly` 而宿主不是桌面：不画；
- 命令在、`when` 不满足：画成禁用，悬停与读屏给出原因；
- 一组全被裁掉时这一组不画。

执行一律经命令服务 `execute(id, args)`，菜单不另写实现。

**布局显隐命令**：外壳的 Part 显隐（输出 9）已经在布局状态里，但没有命令。新增 `nbook.view.set-part-hidden {part, hidden?}`，`part` 取 `sidebar`、`auxiliarybar`、`activitybar`，省略 `hidden` 时切换；写同一份用户定制记录。标题栏的布局按钮、视图菜单与命令面板走这一条。

### P08 与 F05：两个条目贡献点的合同

在外壳 Spec 增加“外壳四”，定义 `workbench.statusbar-items` 与 `workbench.titlebar-items`，写法与 `workbench.views` 相同：

- **声明**（静态数据，登记时校验）：`{title, icon?, alignment: "left" | "right", order, priority, command?: {id, args?}, when?}`。标题栏条目只有 `alignment: "right"`（放在操作区，品牌与菜单在左、搜索居中）。
- **实现**（浏览器入口激活时交出）：`{text(): LocalizedText | string, tooltip?(): string, state?(): "normal" | "warning" | "error"}`，都是响应式读取。数据由贡献方从自己的状态算出；外壳只渲染，不读任何领域状态。
- **排序**：按 `alignment` 分两侧，同侧按 `order` 升序，再按条目 id；
- **可见**：`when` 走命令目录同一套上下文键与公开状态，不满足时不渲染；
- **窄屏**：空间不够时按 `priority` 从低到高收进一个“更多”按钮（菜单里列出被收起的条目，可点执行），不截断条目文字；
- **冲突与撤回**：同 id 的两条贡献一起拒绝并记诊断（与命令相同）；贡献方入口停止时条目撤回、立即消失；实现抛错的条目原位显示为不可用并记诊断，不影响别的条目；
- **点击**：有 `command` 的条目是按钮，经命令服务执行；没有的是纯文字（`role="status"`）。

第一批使用者只放真实数据：

- 状态栏右侧：编辑器插件贡献“未保存 N 个文档”（N 为 0 时不显示，点击执行全部保存）；
- 状态栏右侧：编辑器插件贡献活动编辑器的光标位置“第 L 行，第 C 列”（只在活动编辑器提供位置时显示，点击执行跳到行）。需要编辑器控件句柄新增可选的光标位置读数，Monaco 与 Markdown 各自实现，不提供时条目不显示。

### P09：验收

外壳 Spec 的“外壳四”验收覆盖：

- 标题栏 36px、状态栏 22px 不变；菜单在宽度不足（阈值写进 Spec：标题栏可用宽度小于 720px）时收成一个“菜单”按钮，再窄时只留品牌、搜索与布局按钮；
- 没有打开项目：文件组里需要项目的项（保存等）禁用并说明原因，项目切换显示“打开项目…”；
- 编辑项的禁用原因随焦点：焦点在编辑器、在原生输入框、在别处，三种情况分别验证；
- 菜单键盘：Alt 或 F10 聚焦菜单栏，方向键在组与项之间移动，Enter 执行，Escape 关闭并把焦点还给打开前的位置；
- 未实现的项不渲染（表里标“不画”的那些）；
- 条目贡献点：激活后出现、同 id 被拒、入口停止后消失、窄屏按优先级收起、点击走命令。

## 关键设计

### 1. 命令（`src/plugins/workbench/`、`src/plugins/editor/`、新的 `nbook.app` 与 `nbook.help` 命令）

- `nbook.view.set-part-hidden`：工作台浏览器入口贡献，`when.requires` 读 `nbook.workbench/layoutReady`；参数严格校验。写法照 `set-panel-hidden`。
- `nbook.app.reload`、`nbook.help.documentation`：由工作台浏览器入口贡献（宿主的整页导航能力 `windowNavigationKey`；文档站地址放在工作台常量里，Spec 写明）。

### 2. 标题栏（`src/plugins/workbench/web/titlebar/`）

- `menu-model.ts`：上一节的能力模型，纯函数，Bun 测试。
- `WorkbenchTitleBar.vue`：品牌、菜单栏（nb-ui `Menubar`）、居中的命令搜索按钮（点开命令面板，显示 `Ctrl+Shift+P`）、项目切换、布局按钮（侧栏、面板、右栏三个切换，状态取工作台公开状态）、右侧条目贡献区。替换 `WorkbenchShell.vue` 里现在的标题栏两段文字。
- 项目切换：显示当前项目短名（与状态栏同一来源，即窗口绑定结果），点开列出“打开项目…”（执行 `nbook.project.open`）。作品列表与书架页共用一份数据，那份数据随 t75 定（P14），本 Task 只放“打开项目…”这一项，不预先做列表。
- 浏览器里不画窗口控制。

### 3. 状态栏条目（`src/plugins/workbench/web/statusbar/`、`WorkbenchStatusBar.vue`）

- 贡献点登记与撤回照 `views/registry.ts` 的写法：登记校验、交付句柄、撤回作废；
- `WorkbenchStatusBar.vue` 左侧仍是项目名与布局问题，右侧依次渲染条目与“显示面板”；
- 窄屏收起：量出可用宽度，按优先级把放不下的条目移进“更多”菜单。

### 4. 编辑器的两个条目（`src/plugins/editor/web/`）

- 编辑器插件的浏览器入口声明并交出两个状态栏条目；数据来自编辑器自己的区域状态（脏文档数、活动句柄的光标位置）。
- 控件句柄 `EditorControlHandle` 新增可选的 `position: Readonly<Ref<{line, column} | null>>`；Monaco 与 Markdown 控件各自实现；文档写进各自的 `.md` 与编辑器 Spec。

## Spec 与文档改动（S0）

| 文件 | 改什么 |
|---|---|
| `docs/specs/ui/workbench-shell.md` | 非目标删去“状态栏与标题栏条目的贡献点”；新增“外壳四”：标题栏结构、菜单能力模型、宽度阈值、两个贡献点的声明、实现、排序、可见、窄屏收起、冲突与撤回；验收与证据 |
| `docs/specs/workbench/commands.md` | 第二批加 `set-part-hidden`；新增 `nbook.app.reload`、`nbook.help.documentation`；“兼容与安全”里 15 个桌面 id 改为本计划的去向表，别名只接现成且语义一致的（`edit.undo`、`edit.redo`），其余写明不接 |
| `docs/specs/workbench/editor.md` | 控件句柄的可选光标位置；两个状态栏条目 |

## 切片

| 片 | 内容 | 自跑验证 |
|---|---|---|
| S0 | 上表三份 Spec | `docs:check`、`governance:check` |
| S1 | 三条新命令 + `set-part-hidden` | 命令的 Bun 合同测试；typecheck |
| S2 | 菜单能力模型（纯函数） | Bun 测试：裁剪、禁用原因、空组、宿主能力 |
| S3 | 两个贡献点的登记、撤回、排序、窄屏收起 | Bun 测试（真实内核与插件）；Vitest 组件测试 |
| S4 | 标题栏组件与外壳接线，状态栏改造 | Vitest；Lab 场景；`lab:shot` 抽查；`workbench-shell.e2e.ts` 补外壳四验收 |
| S5 | 编辑器的两个条目与光标位置 | 编辑器 Bun 与 Vitest；`editor-area.e2e.ts` 补条目 |
| S6 | 证据、omp 实现审查与修正、全量 e2e | `test:affected --typecheck`、全量 e2e、`docs:check`、`governance:check` |

## 验收映射

| 行为 | 覆盖 |
|---|---|
| 菜单按能力裁剪、禁用带原因、未实现不画 | `menu-model.test.ts` |
| 编辑项随焦点禁用 | e2e：焦点在编辑器、原生输入框、别处 |
| 菜单键盘与焦点还原 | e2e |
| 宽度阈值与紧凑菜单 | e2e：1440、900、390 三档 |
| 贡献点：出现、同 id 拒绝、撤回、排序、收起、点击执行 | Bun（真实内核）与 e2e |
| 未保存数与光标位置 | `editor-area.e2e.ts` |
| 标题栏 36px、状态栏 22px、无页面横向滚动 | `workbench-shell.e2e.ts` |

## 不做

- 桌面窗口控制与桌面菜单接线（有桌面宿主再做）；
- 作品列表与项目切换列表（随 t75 的作品名与列表数据）；
- 新造剪切、复制、全选命令；设置页面；关于页；文件快速打开。

## 风险

- Menubar 的键盘行为依赖 nb-ui 的 `Menubar`（reka）；若与“Alt/F10 聚焦菜单栏”冲突，先在 nb-ui 层补齐并写进组件文档。
- 光标位置需要两个编辑器控件各自实现；Markdown 编辑器若拿不到稳定的行列，就只在 Monaco 显示，并在 Spec 写明。
