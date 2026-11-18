# t27 编辑器字号：Markdown 正文设置与桌面里的 Ctrl+滚轮调字号 计划

## Context

开发者 2026-11-18 提出：设置里只有代码编辑器有字体、字号、行高，Markdown 正文没有；编辑器里要支持 Ctrl+滚轮调字号。同日在讨论中定了三件事（AskUserQuestion）：

1. **范围**：Markdown 正文做“字体、字号、行距”三项，只管 Markdown 编辑器的纸面；对话里的 Markdown 不动。
2. **滚轮改的是设置值**：像 VS Code 的 `editor.mouseWheelZoom`，防抖后写进用户层，所有同类编辑器一起变；代码编辑器改 `code.fontSize`，Markdown 编辑器改 `markdown.fontSize`。
3. **只在桌面里接管**：桌面里 Ctrl+滚轮只在编辑器上有效（改字号）；页面自己的内容上、编辑器之外按 Ctrl+滚轮什么也不改，界面缩放只走键盘（Ctrl 加加减号、Ctrl+0）与命令面板；浏览器里完全不接管（不改设置值；Markdown 上仍是浏览器自己的页面缩放，Monaco 本来就吃掉 Ctrl+滚轮，保持原样）。

“界面框架默认不可选中文字”不在本 Task，另建 w00046 t22。

依据：[`workbench.editor`](../../../../docs/specs/workbench/editor.md) 输出 32（纸面）与输出 52（设置）；[`runtime.desktop-shell`](../../../../docs/specs/runtime/desktop-shell.md) 输出 26 与场景 16。

## 设计审查

第 1 轮（Sonnet，前端，15 条：阻塞 3、重要 4、一般 8，报告 [review-plan-r1.txt](evidences/review-plan-r1.txt)）全部成立，本版（r2）已吸收，处理见各节。要点：监听改为捕获阶段且由 editor 插件在编辑组上持有一处（Monaco 内部会吃掉 Ctrl+滚轮、markdown 插件不能运行时导入 editor/web）；防抖目标用响应式；字号两项只允许用户层；行距改整数百分比；补依赖、flush、文档位置、已知限制。

## 技术选型

无通用问题。累积器（`createWheelAccumulator`）与防抖写回（`createZoomController` 的做法）已有实现：累积器移到共用位置复用，防抖写回抽成可复用函数（目标值用响应式）。

## 关键设计

### `src/shared/wheel-steps.ts`（新）
- 从 `plugins/desktop/web/zoom.ts` 移入 `createWheelAccumulator`、`WHEEL_STEP`（注释保留并改成两用），`zoom.ts` 改为导入，行为不变，测试随之移动。
- `createSteppedSetting(options)`：给定 `SettingsService`、一个整数设置、取值范围、防抖时长、`schedule`、`failed` 回调；目标值放在 `shallowRef`，`current()` 读它（防抖期间是目标值，否则是设置里的值；放进 `computed` 里读会随目标变而重算，字号立即变）；`step(delta)` 一律从 `current()` 起算，夹在范围内；写回 `settings.update(setting, value, {layer: "user"})`，值等于缺省时写 `undefined`（删键）；不带 `expect`，最后写者赢（同缩放）；成功后清目标（`update` 成功时配置服务已同步应用，不回跳），失败时清目标、调 `failed`；`flush()`（立即写）与 `dispose()`（先 flush 再取消）。

### `src/plugins/editor/shared/settings.ts`
- 分区组增加 `{id: "markdown"}`（排在“代码编辑器”之前）。新增 `markdown.fontFamily`（字符串，最长 200，空串）、`markdown.fontSize`（整数 8 到 40，缺省 17，`layers: ["user"]`）、`markdown.lineHeight`（整数百分比 120 到 300，缺省 195，单位“%”）。`code.fontSize` 也加 `layers: ["user"]`：滚轮写用户层，项目层有值时有效值不变会先变后弹回；字号是个人偏好，与界面缩放同理（改变已有行为，见待确认）。
- 文字与语言目录：`settingsSections.nbook.editor.groups.markdown.title`、`settings.markdown.fontFamily.title/description`、`settings.markdown.fontSize.title/unit`、`settings.markdown.lineHeight.title/unit` 加进 `shared/text.ts`、两份语言文件与 `locales.test.ts` 的新增键表（RUNTIME 表，放图片设置附近）；分区说明 `settingsSections.nbook.editor.description`（“标签栏与面包屑”）改成也提到排版。字体说明写明：留空时跟随皮肤的正文字体，皮肤没有时用界面字体，填了就盖过皮肤。

### `src/plugins/editor/shared/contracts.ts`
- 新增注入键 `markdownEditorOptionsKey`（`Ref<{fontFamily: string; fontSize: number; lineHeight: number}>`，`lineHeight` 已换成倍数）与缺省值；放 shared，markdown 插件按规则只运行时导入它。`editor/web/plugin.ts` 与 `codeOptions` 并列提供，字号读 stepper 的 `current()`。

### `src/plugins/editor/web/wheel-zoom.ts`（新）与编辑组
- 一处监听，由 editor 插件持有，挂在编辑组的内容区根（`EditorGroup`，含面包屑行里的工具栏），`{capture: true, passive: false}`：捕获阶段才先于 Monaco 内部的滚动监听（它不看 ctrlKey、一律吃掉事件）。条件：`enabled()`（桌面）且 `ctrlKey`：`preventDefault`，经累积器换成 ±1。改哪一项：事件目标的 `closest("[data-editor-control]")` 的值（`code` 或 `markdown`，两个控件根上已有）；落在工具栏等没有该属性处，用该组活动标签的控件种类；两者都没有（空组、图片等别的控件）不改，只 `preventDefault`。
- `enabled` 来自 `windowDesktopKey`：editor 入口依赖里加 `{key: windowDesktopKey, required: false}`，`resolve` 不到按非桌面处理。stepper 在 `scope.register` 里释放（释放先 flush），并监听 `pagehide` 调 `flush`。写失败记诊断（`warn`），不另弹通知。
- `MonacoControl.vue`、`MarkdownControl.vue` 都不挂滚轮；Monaco 自己的 `mouseWheelZoom` 保持关。`MarkdownControl.vue` 注入选项后在 `.markdown-control-root` 上写 `--markdown-font-size`、`--markdown-line-height`，字体写在新变量 `--markdown-user-font`（空串不写），`.markdown-control__prose` 的 `font-family` 改为 `var(--markdown-user-font, var(--font-prose, inherit))`，不动公共令牌 `--font-prose`；样式块里原来的 17px 与 1.95 保留作没有注入时（Lab）的兜底。字号变后：先用 e2e 在长文档上量滚动位置是否漂移，漂移则在 `MarkdownControl` 里保持视野（记下视野顶部的块，生效后恢复）；`MarkdownBlockGutter` 的悬停按钮位置在字号变后可能陈旧到下一次指针移动，量过再定修或记已知限制。

### `src/plugins/desktop/web/plugin.ts`
- 全局 `wheel` 监听简化为：`ctrlKey` 就 `preventDefault`（不再换缩放档、不再看 `defaultPrevented`，也去掉累积器引用）；注释与头注释同步（第 8 行、95 到 105 行）。已知限制：沙箱 iframe（HTML 预览）里的 Ctrl+滚轮事件到不了顶层文档，WebView2 自带缩放仍会触发，改动之前就如此，写进 Spec；真实 WebView2 里 `preventDefault` 能否拦住自带缩放与触控板捏合需 Windows 实机（原场景 16 同）。

## Spec 与文档改动

- `workbench/editor.md`：输出 32（纸面）改为“缺省值，可由设置改；留空字体跟随皮肤”；输出 52 补“图片”与“Markdown 正文”小组（原文落后一项）；新增输出：桌面里编辑器上 Ctrl+滚轮改对应字号设置（捕获阶段、累积一档才换、写用户层、复位用设置窗口、浏览器里不改设置值、HTML 预览 iframe 里是已知限制）；验收场景增一条。
- `runtime/desktop-shell.md` 输出 26 与场景 16：滚轮不再换界面缩放，界面缩放只走键盘与命令面板；Ctrl+滚轮在桌面里只用于图片查看器（图片缩放）与编辑器（字号）。
- 文字与注释：`plugins/desktop/shared/contracts.ts` 第 17 行注释与第 39 行设置说明（“或按住 Ctrl 滚动鼠标”，字面双语直接改）；`zoom.ts` 头注释；`e2e/desktop-settings.e2e.ts` 第 90 到 97 行滚轮用例与标题；`zoom.test.ts` 的累积器用例随之移到 `wheel-steps` 的测试；`MarkdownControl.md`（写明变量只写在 `.markdown-control-root` 上，不提到更外层，否则影响对话里的 Markdown）。

## 切片

1. 共用：`wheel-steps.ts`（移动累积器、`createSteppedSetting`）与单元测试（含项目层有值、写失败、写成功无回跳、`computed` 同步重算，用真实 `SettingsService`）；桌面缩放改引用，原测试仍过。
2. 设置：三项声明与 `code.fontSize` 的层、文字、两份语言、`locales.test.ts`；注入键与纸面变量；`MarkdownControl.dom.test.ts` 的注入用例。
3. 滚轮：编辑组上的监听与接线；桌面全局监听简化；e2e（见验收映射），顺带量滚动漂移与悬停按钮。
4. Spec、注释与组件说明；`docs:check`。

每片自跑受影响的 bun/vitest 文件与 `bun run typecheck`；片 3 后跑 e2e：`desktop-settings`、新增 `editor-markdown-settings`、`editor-code-settings`、涉及滚轮的新用例（不超过 8 个文件）。

## 验收映射

- 设置三项的范围、缺省与纸面样式跟着设置变（`font-size`、`line-height`、`font-family` 的计算值；字体留空走皮肤）→ 新增 `e2e/editor-markdown-settings.e2e.ts`（同 `editor-code-settings.e2e.ts` 的做法，改用户层文件）与 `MarkdownControl.dom.test.ts`；`locales.test.ts` 管文字键。
- 滚轮累积、防抖写回、复位删键、项目层、写失败、无回跳 → `wheel-steps` 单元测试。
- 桌面（桥桩）：Markdown 与 Monaco 上 Ctrl+滚轮改对应设置、用户层文件内容变、Monaco 的计算字号同步变；指针在 Markdown 工具栏上也改；编辑器外页面缩放不变 → e2e。浏览器（无桥）：用户层文件与字号都不变；Markdown 上事件不被 `preventDefault`；Monaco 上只断言字号没变，不断言页面缩放。
- 桌面缩放不再受滚轮影响 → 改写 `desktop-settings` e2e 里原有的滚轮用例。
- 批注页边开着时字号变后卡片仍与批注对齐 → 同一 e2e 顺带断言。

## 验证与未验证

- 浏览器里 Playwright 加桥桩；触控板捏合、真实 WebView2 里 `preventDefault` 拦不拦得住自带缩放，要 Windows 实机（未验证，沿用场景 16）。
- 命令面板里“放大/缩小编辑器字号”不做。

## 不做与风险

- 不做对话里 Markdown 的字号设置、阅读预览、主题编辑器里的字号；不做 Ctrl 加加减号改编辑器字号。
- 写回防抖 300ms，连续滚动期间设置窗口里的值与目标不同步，写回后才一致；防抖内别处改了同一项，写回覆盖（最后写者赢），同缩放，已接受。
- `code.fontSize` 改为只允许用户层：已有的项目层值不再生效，记入待确认。
