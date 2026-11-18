# t22 桌面壳里界面框架默认不可选中文字，内容区显式可选 计划

## Context

开发者 2026-11-18（w00025 t27 的讨论）提出：现在很多界面文字都能选中，像网页不像应用。定了：

1. 桌面壳里加全局规则：`<html data-desktop-frame>` 下默认 `user-select: none`（书架首页、宿主页、启动页都算），内容区显式可选；
2. 浏览器里不加全局规则，个别地方手动指定：界面框架的控件写不可选，内容写可选。

依据：[`runtime.browser-host`](../../../../../docs/specs/runtime/browser-host.md) 输出 12“窗口外框”（本 Task 在其中加一条）。分法与 VS Code 桌面版一致：`body` 全局 `none`，对话框正文、悬停、设置项说明、通知消息等按区域放开（通知一项按开发者已定的不放开）。

清点（2026-11-18，worktree 上的临时探针：生产构建、浏览器模式，工作台打开一篇 Markdown、设置窗口、命令面板、书架，逐个文本节点算有效的 `user-select`；探针不提交）：

- 已经不可选：标题栏、状态栏、面板头、资源管理器、区域条、命令面板条目、通知、按钮、菜单、徽标、对话欢迎页、设置里的选择控件与分区标题；`AlertDialog` 与 `Popover` 的面板整体不可选（两种模式都是，本 Task 不改）。
- 浏览器里仍可选、属于框架的：编辑器标签（`EditorTabBar`）、面包屑（`EditorBreadcrumbs`）、Markdown 工具栏、编辑组标题动作、会话面板的范围切换、对话输入框旁的模型选择、设置窗口左侧导航与小组标题、对话框标题、书架页（标题、计数、卡片、统计）。
- 已经显式可选的内容：`CodeBlock`、`DetailDialog` 正文（后台任务的详情走它）、nb-form 的 `ViewValue`、设置行的值、提示词编辑器里粘贴块的原文；Monaco 的悬停与诊断小部件自己写了 `text`。
- 内容但没声明（全局规则一加就选不了），见下文“内容根”。

Chromium 实测（无头 Chrome，草稿页；审查者另做了一组，结论相同）：祖先 `none` 时后代写 `text` 能双击、拖选起选区；输入框与 `contenteditable` 照常能选能编辑（但 `getComputedStyle` 对它们报 `none`）；可编辑根里的 `contenteditable=false` 节点继承 `none`、选不了，根上写 `text` 才恢复；焦点在页面上按 Ctrl+A、从内容拖过框架，选区只含可选文字；`Selection.toString()` 排除 `none` 的文字，`Range.toString()` 不排除；`draggable` 元素写了 `text` 也选不出字（仓库里布局拖放用指针事件，不受影响）。

## 技术选型

无通用问题。沿用现有写法：容器写 `none`，内容在自己的根上写 `user-select: text`（模板里用原子类 `select-text`，样式块里写属性）。不另加公共类或属性：`user-select: text` 与 `select-text` 两个词已能 grep 出全部声明点。

## 关键设计

### 规则（写进 nb-ui 的开发规范，组件各自遵守）
- 框架控件（标签、导航、工具栏、标题、按钮、菜单、徽标、状态）在自己的根上写 `select-none`；内容（正文、代码、原文、路径、错误与诊断信息、命令输出、表单读出的值）在自己的根上写 `user-select: text`，包内组件不依赖宿主有没有全局规则。
- 可编辑元素（输入框、文本域、`contenteditable`）里的可编辑文字不用写；可编辑根里有不可编辑节点（ProseMirror 的节点视图）时，根上要写 `text`。
- 通知保持不可选（`Notification.md` 已定：复制原文去详情对话框）；确认对话框与气泡面板整体不可选不变。

### `packages/neuro-book/src/web/styles.css`
- “窗口外框”一节加：`html[data-desktop-frame] { user-select: none; }`，注释链接 browser-host 输出 12 与 nb-ui 规范一节。HTML 预览的 iframe 是另一份文档，不受影响。
- 宿主页 `.nb-host-page` 写 `user-select: text`（失败原因、抢救出的正文要能复制）。

### nb-ui
- `src/styles.css`：`[role="alert"] { user-select: text; }`。它经 `tailwind.css` 进 components 层，所以 utilities 层的 `select-none` 与不分层的组件样式照样盖得过它（注释写这个理由，不写成特异性）。
- `DialogSurface` 页脚状态行（`aria-live`，出错时是服务端的错误文字）写 `text`；标题写 `none`。

### 内容根写 `user-select: text`
- nb-markdown `display/markdown.css`：`.nb-markdown, .nb-markdown-display`（纸面、展示器与它的后备渲染；里面已写 `none` 的小部件照旧）。
- nb-agent-ui：对话流根 `.acv-stream`；向导正文（`AgentWizardFrame` 的正文区：审批的命令、diff、参数，停靠态在消息流之外）；上下文检查器根；请求详情根 `.ard`。会话树的条目是可点的列表行，算框架，不写。
- 应用：设置行的文字列 `.settings-row__text`（标题与说明都可选，便于复制设置名去搜索，同 VS Code）；Markdown 批注卡片的意见 `.markdown-comment-card__body`；插件页的说明、原因、路径；模型服务商页的提示与错误；技能设置页的输出值；作品设置页的作品库路径；`SkillInitDialog` 的输出。

### 浏览器里补 `select-none` 的框架
清点里第二类逐个加在组件根上：`EditorTabBar`、`EditorBreadcrumbs`、Markdown 工具栏、编辑组标题动作、会话面板范围切换、`AgentModelPicker` 触发器、设置窗口导航与小组标题、`DialogSurface` 的标题、书架页（页面根写 `none`，列表视图里的作品路径写 `text`）。

## Spec 与文档改动

- `docs/specs/runtime/browser-host.md` 输出 12 加一条“文字选择”：外框开着时界面框架的文字不能选中，内容区（列举类别）可选、可复制，可编辑元素照常；没有能力标记时不加这条规则，组件自己声明的照旧。验收场景补一条。
- `packages/nb-ui/docs/ui-development-spec.md` 加“文字能否选中”一节（上面的规则）。
- 改到的组件同名 `.md` 补一句（实际改到的）。

## 切片

1. 规则与内容：全局规则、宿主页、`role="alert"`、各内容根写 `text`；e2e 桌面部分。
2. 浏览器里的框架补 `select-none`：先写浏览器部分的 e2e、在没改的代码上跑出红，再改到绿。
3. Spec、nb-ui 规范、组件说明；删掉探针；`docs:check`。

每片跑受影响的 vitest/bun 文件与 `bun run typecheck`；改 CSS 后 `bun run build` 与 `bun run build:e2e` 都重建再跑 e2e。

## 验收映射

判法：在一个区域根上 `getSelection().selectAllChildren(根)`，读 `getSelection().toString()`，断言含内容文案、不含框架文案（清点里的真实字符串）。同一次读数里内容文案出现就是正向对照，不依赖指针落点。另留两条真实指针的用例（双击内容里的词得到该词，落点取文字的 `getClientRects()[0]` 内部；拖选），覆盖起选区本身。

新增 `e2e/text-selection.e2e.ts`（生产构建）：
- 桌面（`installFrame` 同 `desktop-frame.e2e.ts`）：工作台整页读数含 Markdown 正文、不含编辑器标签、面板头、状态栏、会话面板空态文字；Markdown 正文里一个不可编辑节点（提示块之外的节点视图，实施时选稳定的一个）的文字在读数里；设置窗口读数含设置行标题与说明、不含导航；“页面不存在”宿主页读数含正文；设置搜索框能输入、全选；双击正文选中词；焦点在框架上按 Ctrl+A，选区不含框架文字。
- 浏览器：编辑器标签、面包屑、设置导航、书架卡片不在读数里（本 Task 补的，先红后绿）；会话面板空态文字在读数里（证明全局规则只在桌面）。
- `role="alert"`：选一个能稳定造出、且没有别的 `text` 声明的入口（候选：设置页加载失败、编辑器 danger 横幅），实施时定；造不出就在报告里写明只由代码审查覆盖。

`e2e/lab-agent-ui.e2e.ts` 加一条（Lab 场景，`<html>` 上设 `data-desktop-frame`）：有消息的场景里对话流读数含消息文字；审批向导场景（停靠态）读数含命令或 diff 文字。

变异（实施时做，结果写进 Task README）：去掉全局规则 → 桌面里框架文字那几条变红；去掉 `.nb-markdown` 的 `text` → 不可编辑节点那条变红；去掉 `.acv-stream`、向导的 `text` → Lab 那条变红；去掉 `.nb-host-page` 的 `text` → 宿主页那条变红；浏览器部分在没改的代码上先红。

## 验证

- 合入前 e2e：`text-selection`、`lab-agent-ui`（只跑新加的那条与对话流相关几条）、`desktop-frame`（拖动区域没受影响）、`markdown-editing`（`.nb-markdown` 改了样式）、`settings`、`bookshelf`（浏览器里补了 `none` 最多的两处）。六个文件。
- 实施中只重跑 `text-selection` 与新加的 Lab 用例。
- 受影响的 vitest：改到的组件的 dom 测试（实施时按文件列）。
- 未验证：WebView2 实机里的拖动选择、IME 输入、双击标题栏（Chromium 同核，从 Playwright 推断）；没清点到的内容区（插件自己画的视图）会变得选不了，发现一处补一处。

## 不做与风险

- 不改通知、确认对话框与气泡面板（保持不可选）；不改 Monaco 内部样式（正文选区它自己画，悬停自己写了 `text`）。
- 风险：漏掉的内容区在桌面里选不了。兜底是规则写进规范、`role="alert"` 一条覆盖错误提示，以及上面 e2e 列出的几处；其余靠发现后补。
- 设计审查第 1 轮（Sonnet，16 条：重要 6、一般 10，[review-plan-r1.txt](evidences/review-plan-r1.txt)）已吸收：补对话框正文、批注、向导、后备渲染、技能与作品设置页；删掉与代码不符的后台任务视图一项；e2e 改用全选读数、加变异与先红后绿；`:where` 的理由改成层序；验证清单加 `settings`、`bookshelf`。没采纳：公共的“可选”类（grep 已够）、dom 测试里的机检（happy-dom 不算 `user-select` 的继承与选区）。
