# t22 桌面壳里界面框架默认不可选中文字，内容区显式可选 计划

## Context

开发者 2026-11-18（w00025 t27 的讨论）提出：现在很多界面文字都能选中，像网页不像应用。定了：

1. 桌面壳里加全局规则：`<html data-desktop-frame>` 下默认 `user-select: none`（书架首页、宿主页、启动页都算），内容区显式可选；
2. 浏览器里不加全局规则，个别地方手动指定：界面框架的控件写不可选，内容写可选。

依据：[`runtime.browser-host`](../../../../../docs/specs/runtime/browser-host.md) 输出 12“窗口外框”（本 Task 在其中加一条）。

清点（2026-11-18，worktree 上的临时探针：生产构建、浏览器模式，工作台打开一篇 Markdown、设置窗口、命令面板、书架，逐个文本节点算有效的 `user-select`）：

- 已经不可选：标题栏、状态栏、面板头、资源管理器、区域条、命令面板条目、通知、按钮、菜单、徽标、对话欢迎页、设置里的选择控件与分区标题。
- 浏览器里仍可选、属于框架的：编辑器标签（`EditorTabBar`）、面包屑（`EditorBreadcrumbs`）、Markdown 工具栏、编辑组标题动作、会话面板的范围切换、对话输入框旁的模型选择、设置窗口左侧导航与小组标题、对话框标题、书架页（标题、计数、卡片、统计）。
- 已经显式可选的内容：`CodeBlock`、`DetailDialog` 正文、nb-form 的 `ViewValue`、设置行的值（`.settings-row__value`）、提示词编辑器里粘贴块的原文。
- 内容但没声明（全局规则一加就选不了）：Markdown 正文（编辑器纸面与展示器都挂 `.nb-markdown`，可编辑时自动可选，只读时不行）、对话流（用户消息、助手正文、工具输出、提示）、请求追踪、设置行的说明、宿主页（失败原因）、插件页的原因与路径、模型服务商页的错误、各处的错误提示（`role="alert"`）。

## 技术选型

无通用问题。沿用现有写法：容器写 `none`，内容在自己的根上写 `user-select: text`（`CodeBlock.vue` 已是这样，注释写明外层可能是 `select-none`）。

## 关键设计

### 规则（写进 nb-ui 的开发规范，组件各自遵守）
- 框架控件（标签、导航、工具栏、标题、按钮、菜单、徽标、状态）在自己的根上写 `select-none`；内容（正文、代码、原文、路径、错误与诊断信息、表单读出的值）在自己的根上写 `user-select: text`，包内组件不依赖宿主有没有全局规则。
- 可编辑元素（输入框、文本域、`contenteditable`）不用写：`auto` 在可编辑元素上算作 `contain`，祖先是 `none` 也能选、能编辑。
- 通知保持不可选（`Notification.md` 已定：复制原文去详情对话框）。

### `packages/neuro-book/src/web/styles.css`
- 在“窗口外框”一节加：`html[data-desktop-frame] { user-select: none; }`，注释链接 browser-host 输出 12 与 nb-ui 规范一节。HTML 预览的 iframe 是另一份文档，不受影响。
- 宿主页 `.nb-host-page` 写 `user-select: text`（失败原因、版本、抢救出的正文都要能复制；按钮本身点不出选区）。

### nb-ui `src/styles.css`
- `:where([role="alert"]) { user-select: text; }`：错误提示各处都用 `role="alert"`，一条规则代替逐个组件；`:where` 不抬优先级，组件自己写了 `none` 的照旧。

### 内容根写 `user-select: text`
- nb-markdown `display/markdown.css` 的 `.nb-markdown`（纸面与展示器共用；里面已写 `none` 的小部件，如提示块标签、复制按钮，照旧）。
- nb-agent-ui：对话流根 `.acv-stream`（`AgentConversationView.vue`；欢迎页、消息动作按钮已是 `none`），请求详情根 `.ard`（行号已是 `none`）。
- 应用：设置行说明 `.settings-row__description` 与原因行；插件页的说明、原因、路径；模型服务商页的提示与错误；后台任务视图里的错误与输出（实施时读 `TasksView.vue` 定具体元素）。

### 浏览器里补 `select-none` 的框架
清点里第二类逐个加在组件根上：`EditorTabBar`、`EditorBreadcrumbs`、Markdown 工具栏、编辑组标题动作、会话面板范围切换、`AgentModelPicker` 触发器、设置窗口导航与小组标题、`DialogSurface` 的标题、书架页（页面根写 `none`，列表视图里的作品路径写 `text`）。

## Spec 与文档改动

- `docs/specs/runtime/browser-host.md` 输出 12 加一条“文字选择”：外框开着时界面框架的文字不能选中，内容区（列举类别）可选、可复制，可编辑元素照常；没有能力标记时不加这条规则，组件自己声明的照旧。验收场景补一条。
- `packages/nb-ui/docs/ui-development-spec.md` 加“文字能否选中”一节（上面的规则）。
- 改到的组件同名 `.md` 补一句（`AgentConversationView`、`MarkdownDisplay`、`SettingsRow`、`DialogSurface` 等实际改到的）。

## 切片

1. 规则与内容：全局规则、宿主页、`role="alert"`、各内容根写 `text`；e2e（桌面模式）。
2. 浏览器里的框架补 `select-none`；e2e（浏览器模式）。
3. Spec、nb-ui 规范、组件说明；`docs:check`。

每片跑受影响的 vitest/bun 文件与 `bun run typecheck`；改 CSS 后 `bun run build` 与 `bun run build:e2e` 都要重建再跑 e2e。

## 验收映射

新增 `e2e/text-selection.e2e.ts`（选区按行为判：双击或拖选后 `getSelection().toString()`，不只读计算样式）：

- 桌面（`installFrame` 同 `desktop-frame.e2e.ts`）：双击编辑器标签、面板头、状态栏、设置导航、会话面板空态文字，选区为空；双击 Markdown 正文、设置行说明、宿主页（“页面不存在”）的文字，选中了词；Monaco 里双击选中词（看 Monaco 的选区）；设置搜索框能输入、全选；焦点在框架上按 Ctrl+A，选区不含框架文字。
- 浏览器：同样双击编辑器标签、设置导航，选区为空（本 Task 补的）；会话面板空态文字可选（证明全局规则只在桌面）；Markdown 正文可选。
- 对话流与请求详情：在工作台里没有消息可点，断言 `.acv-stream` 的计算值为 `text`（声明点）；行为由 Markdown 正文那条代表（对话正文就是 `.nb-markdown`）。
- 变异：去掉全局规则，桌面里会话面板空态那条变红；去掉 `.nb-markdown` 的 `text`，桌面里只读 Markdown（若有入口）或展示器那条变红，没有就记为只由计算值覆盖。

## 验证

- 合入前 e2e：`text-selection`、`desktop-frame`（同在外框下，确认拖动区域没受影响）、`editor-font-size`、`markdown-editing`（正文选区与输入，浏览器模式不受全局规则影响，跑它只为 `.nb-markdown` 改了样式）。四个文件。
- 实施中只重跑 `text-selection`。
- 未验证：WebView2 实机里双击标题栏、拖动选择、IME 输入在全局 `none` 下的表现（Chromium 同核，从 Playwright 推断）；没清点到的内容区（插件自己画的视图）会变得选不了，发现一处补一处。

## 不做与风险

- 不改通知（保持不可选）、不改 Monaco 内部样式（它自己管选区）。
- 风险：漏掉的内容区在桌面里选不了。兜底是规则写进规范、`role="alert"` 一条覆盖错误提示，以及本 e2e 列出的几处；其余靠发现后补。
