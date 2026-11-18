# t27 编辑器字号：Markdown 正文设置与桌面里的 Ctrl+滚轮调字号 计划

## Context

开发者 2026-11-18 提出：设置里只有代码编辑器有字体、字号、行高，Markdown 正文没有；编辑器里要支持 Ctrl+滚轮调字号。同日在讨论中定了三件事（AskUserQuestion）：

1. **范围**：Markdown 正文做“字体、字号、行距”三项，只管 Markdown 编辑器的纸面；对话里的 Markdown 不动。
2. **滚轮改的是设置值**：像 VS Code 的 `editor.mouseWheelZoom`，防抖后写进用户层，所有同类编辑器一起变；代码编辑器改 `code.fontSize`，Markdown 编辑器改 `markdown.fontSize`。
3. **只在桌面里接管**：桌面里 Ctrl+滚轮只在编辑器上有效（改字号）；编辑器之外按 Ctrl+滚轮什么也不发生，界面缩放只走键盘（Ctrl 加加减号、Ctrl+0）与命令面板；浏览器里完全不接管（Ctrl+滚轮仍是浏览器自己的页面缩放，编辑器上也一样）。

“界面框架默认不可选中文字”不在本 Task，另建 w00046 t22。

依据：[`workbench.editor`](../../../../docs/specs/workbench/editor.md) 输出 32（纸面）与输出 52（设置）；[`runtime.desktop-shell`](../../../../docs/specs/runtime/desktop-shell.md) 输出 26 与场景 16。

## 技术选型

无通用问题。Ctrl+滚轮的“累积满一档才换”已有实现（`createWheelAccumulator`，桌面缩放用它），移到共用位置复用，不另写；防抖写回的做法照 `createZoomController`（目标值在防抖期间先于设置里的值生效），抽成可复用的函数，不复制一份。

## 关键设计

### `src/shared/wheel-steps.ts`（新）
- 把 `createWheelAccumulator` 与 `WHEEL_STEP` 从 `plugins/desktop/web/zoom.ts` 移到这里，`zoom.ts` 改为从这里导入（行为不变，测试随之移动）。
- 新增 `createSteppedSetting`：给定 `SettingsService`、一个整数设置、范围、防抖时长与 `schedule`，提供 `current()`（防抖期间是目标值，否则是设置里的值）、`step(delta)`、`flush()`、`dispose()`；写回用 `settings.update(setting, value, {layer: "user"})`，等于缺省值时写 `undefined`（删键，同缩放）；失败时回到设置里的值并交 `failed` 回调。`createZoomController` 不改用它（档位表不同，改动面大于收益）。

### `src/plugins/editor/shared/settings.ts`
- 分区组增加 `{id: "markdown"}`（排在“代码编辑器”之前）；设置项 `markdown.fontFamily`（字符串，空串用主题的 `--font-prose`）、`markdown.fontSize`（整数 8 到 40，缺省 17）、`markdown.lineHeight`（数，1 到 4，缺省 1.95，是字号的倍数）。说明文字加进 `shared/text.ts` 与两份 `locales`（`locales.test.ts` 检查）。

### `src/plugins/editor/web/markdown-options.ts`（新）
- 与 `code/options.ts` 同形：`MarkdownEditorOptions`、缺省值、注入键 `markdownEditorOptionsKey`；`plugin.ts` 里与 `codeOptions` 并列算一份 `computed` 并提供；字号取 `createSteppedSetting.current()`。

### `src/plugins/editor/web/wheel-zoom.ts`（新）
- `attachWheelZoom(element, {enabled, step})`：在元素上挂 `wheel`（`passive: false`），`ctrlKey` 为真且 `enabled()` 时 `preventDefault`，经累积器换成 ±1 交给 `step`。`enabled` 来自 `windowDesktopKey` 的 `available`（浏览器里为 false，什么都不做）；输入法组字中的滚轮不算特殊处理（滚轮与组字无关）。
- 代码编辑器：`MonacoControl.vue` 把它挂在编辑器根上，步进 `code.fontSize`；Monaco 自己的 `mouseWheelZoom` 保持关（它改的是实例字号，不写设置，与设置值分叉）。
- Markdown 编辑器：`MarkdownControl.vue` 挂在滚动容器上，步进 `markdown.fontSize`；纸面的 `.markdown-control-root` 用注入的选项写 `--markdown-font-size`、`--markdown-line-height`，字体写 `--font-prose`（空串不写，走主题）。样式块里原来的 17px 与 1.95 保留作兜底（没有注入时，Lab）。

### `src/plugins/desktop/web/plugin.ts`
- 全局 `wheel` 监听：别人已处理的（图片查看器、编辑器）仍不接管；其余 Ctrl+滚轮不再换界面缩放，只 `preventDefault`（避免 WebView2 自己缩放）。删掉不再用的累积器引用。

## Spec 与文档改动

- `workbench/editor.md` 输出 52：加“Markdown 正文”小组三项；新增输出 N：桌面里 Ctrl+滚轮在源码编辑器与 Markdown 编辑器上改对应的字号设置（防抖写回用户层、复位用设置窗口，范围与缺省值、浏览器里不接管）；输出 32（纸面）改成“缺省值，可由设置改”。验收场景增一条。
- `runtime/desktop-shell.md` 输出 26：Ctrl+滚轮不再改界面缩放，界面缩放只走键盘与命令面板；“页面自己处理了 Ctrl+滚轮的地方”增列编辑器，但其实已无滚轮缩放，改写为“Ctrl+滚轮在桌面里只用于图片查看器的图片缩放与编辑器的字号”；场景 16 同步；`settings` 里桌面缩放说明里若提到滚轮一并改。
- 组件说明 `MarkdownControl.md`、`MonacoControl.md`（如有）。

## 切片

1. 共用：`wheel-steps.ts`（移动累积器、`createSteppedSetting`）与单元测试；桌面缩放改引用，原测试仍过。
2. 设置：三项声明、文字、两份语言、`locales.test.ts`；Markdown 选项注入与纸面样式；`MarkdownControl` 的 dom 测试。
3. 滚轮：`attachWheelZoom` 单元测试；接到两个编辑器；桌面全局监听改为只拦截；e2e。
4. Spec 与组件说明；`docs:check`。

每片自跑：`bun test`/`vitest` 受影响文件、`bun run typecheck`；片 3 后跑 e2e：`desktop-settings`、编辑器的 Markdown 与 Monaco 相关文件（实施时按改动定，不超过 8 个）。

## 验收映射

- 设置三项的范围与缺省 → `locales.test.ts`、`settings.test.ts` 与 Markdown 编辑器 dom 测试（改设置纸面的计算样式跟着变，字体空串走主题）。
- 滚轮：累积与防抖写回 → 单元测试（含复位删键、写失败回到设置值）；浏览器里不接管 → e2e（无桌面桥时 Ctrl+滚轮不被 `preventDefault`）；桌面里（桥桩）编辑器上字号变、编辑器外页面缩放不变 → e2e。
- 桌面缩放不再受滚轮影响 → 改写 `desktop-settings` e2e 里原有的 Ctrl+滚轮用例。

## 验证与未验证

- 浏览器里 Playwright 加桥桩即可，不需要 Windows 实机；触控板捏合在 Windows 上的手感没有验证。
- 命令面板里“放大/缩小编辑器字号”不做，需要时另建。

## 不做与风险

- 不做对话里 Markdown 的字号设置、阅读预览、主题编辑器里的字号；不做 Ctrl 加加减号改编辑器字号（它已是界面缩放）。
- 风险：滚轮写设置每档防抖 300ms，连续滚动期间设置窗口里的值与目标不同步，写回后才一致；与桌面缩放同一做法，已接受。
