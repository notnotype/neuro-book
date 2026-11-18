---
schema: nbook.task/v2
taskId: t22-desktop-user-select
status: done
updated: 2026-11-18
---

# 桌面壳里界面框架默认不可选中文字，内容区显式可选

## 目标与范围

桌面壳里界面框架（标题栏、活动栏、标签、菜单、按钮、状态栏）默认 user-select: none，像原生应用；内容区（编辑器、对话正文、输入框、设置里的路径与错误信息、诊断信息）显式可选。浏览器里不加全局规则，只在个别地方手动指定不可选或可选。

合同：[`runtime.browser-host`](../../../../../docs/specs/runtime/browser-host.md) 输出 12“窗口外框”加一条“文字选择”（本 Task 写）。

## 背景与已定决定

开发者 2026-11-18 在 w00025 t27 讨论时提出：现在很多界面文字都能选中，是不是加一条默认 `user-select: none` 的全局样式。决定：只在桌面壳里加全局规则（以 `<html data-desktop-frame>` 为范围，书架首页与启动页也算）；浏览器里不加，只在个别地方手动指定“不可选”（例如按钮、标签、纯图标）或“可选”（例如路径、错误信息、诊断）。

开工时要先做的事：清点哪些区域算“内容”要显式可选（编辑器正文、Monaco、对话正文与代码块、输入框与文本域、设置窗口里的值与说明、诊断与错误文字、关于与版本信息、通知正文）；确认拖动区域（`app-region: drag`）与不可选配合时双击不选中文字；`user-select` 对拖动选择文本与 Ctrl+A 的影响；浏览器里要手动指定的几处单列。

## 当前状态

2026-11-18 完成：分支 `feat/w00046-t22-desktop-user-select` 合入 master（4d07ba077，没有 push）。计划 [plan.md](plan.md) 第 2 稿。

做了什么：
- 桌面壳里 `html[data-desktop-frame]` 默认不可选（`src/web/styles.css`）；内容在各自组件的根上声明可选：Markdown 正文与展示器、对话流、审批向导正文与详情、上下文检查器、请求详情、设置项的名字与说明、批注意见、插件页与模型页的原因与路径、技能与作品设置页的值与路径、技能初始化输出、资源管理器的失败报告、权限规则、宿主页、对话框的出错行；nb-ui 公共样式里 `role="alert"` 一律可选、按钮类元素（`button`、`summary`、`role="button"`、`role="tab"`）一律不可选。
- 浏览器里给编辑器标签条（nb-layout `TabStrip`）、面包屑、Markdown 工具栏、编辑组标题动作、会话面板的范围切换、模型选择、设置导航与小组标题、对话框标题、书架页补了不可选。
- 合同：[`runtime.browser-host`](../../../../../docs/specs/runtime/browser-host.md) 输出 12“文字选择”与场景 17；nb-ui 开发规范“4.7 文字能否选中”；改到的组件说明各补一句。

验证：
- e2e：新增 `e2e/text-selection.e2e.ts`（桌面 4 条、浏览器 1 条）；`lab-agent-ui.e2e.ts` 加“桌面壳里的文字选择”2 条；`lab-markdown.e2e.ts` 加展示器 1 条。判法是把含某段文案的文本节点整个选中、读 `Selection.toString()`，先等文字出现。合入前跑过 `text-selection`、`desktop-frame`、`markdown-editing`、`settings`、`bookshelf` 与 Lab 的相关用例，结果见下文。
- 变异（都按预期变红后还原）：去掉桌面全局规则 → 会话面板空态那条红；去掉 `.nb-markdown`、`[role=alert]`、`.nb-host-page`、`.settings-row__text` 的声明 → 设置行、错误提示、宿主页三条红，lab-markdown 展示器那条红；删掉对话流与向导的声明 → Lab 两条红；浏览器那条在补不可选之前是红的。
- 单测：改到组件的 dom 测试 242 条通过；`neuro-book` 类型检查、`docs:check` 通过。`test:affected` 因 nb-ui 公共样式改动几乎选中全量，跑了半小时被我停掉，已跑部分里唯一的失败是 SDK 导出面（master 上同样失败）。

实测得到的事实（写进了 e2e 注释与 nb-ui 规范）：根上不可选时对整块区域 `selectAllChildren` 读选区不可靠（Chromium 挪端点）；显式写 `user-select: auto` 在不可选的祖先下会重新可选，所以变异要删声明；ProseMirror 编辑器里的不可编辑原子节点不靠 `.nb-markdown` 那条也能选（原因没查清），那条声明真正起作用的是展示器。

审查：
- 设计审查第 1 轮（Sonnet，16 条：重要 6、一般 10，[review-plan-r1.txt](evidences/review-plan-r1.txt)），处理见计划末尾。
- 实现审查第 1 轮（Sonnet，11 条：重要 1、一般 10，[review-impl-r1.txt](evidences/review-impl-r1.txt)）：
  - 1（重要，内容根里的原生按钮、`summary`、标签页按钮继承成可选）：nb-ui 公共样式加一条按钮类元素不可选，Lab 用例补“消息流里的折叠标题不可选”“向导标题不可选”。
  - 2、3：向导标题行与消息流空态写不可选，说明随之改。
  - 4（`role=alert` 一刀切）：里面的原生按钮由第 1 条的规则覆盖；确认条的说明文字随之可选，接受。
  - 5：资源管理器的失败报告与提示、权限规则行补可选；Tooltip 里的说明与后台任务行标题保持现状。
  - 6：只作提示，不改（设置页分区标题、各页左栏浏览器里仍可选）。
  - 7：向导用例改判正文里的改动与详情两处，并断言标题不可选。
  - 8：编辑器里加了不可拖的行内原样节点；变异证明编辑器不靠这条声明，改正了 markdown.css 注释与规范的说法，Spec 的行为描述成立不改。
  - 9：读选区前先等文字出现，面板头按文案定位。
  - 10（拖选、Ctrl+A 没测）：接受取舍：Ctrl+A 与整块选区一样受端点挪动影响，读数不可靠；拖选由宿主页双击这条真实指针用例代表起选区。
  - 11：补了详情的注释与规范里输入框的读法；Spec 那条长句不拆。

未验证：WebView2 实机里的拖动选择、IME 输入、双击标题栏（Chromium 同核，从 Playwright 推断）；没清点到的内容区（插件自己画的视图）在桌面里会选不了，发现一处补一处。

## 下一步

无。待确认清单里本 Task 的几行等开发者追认。
