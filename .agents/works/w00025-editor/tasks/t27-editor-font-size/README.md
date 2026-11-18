---
schema: nbook.task/v2
taskId: t27-editor-font-size
status: done
updated: 2026-11-18
---

# 编辑器字号：Markdown 正文字体设置与 Ctrl+滚轮调字号

## 目标与范围

开发者 2026-11-18 提出：设置里只有代码编辑器有字体、字号、行高（editor.code.*），Markdown 正文没有；要给 Markdown 正文加同类设置，并让代码编辑器与 Markdown 编辑器都支持 Ctrl+滚轮调字号。未开工，开工时按当时的结果修订。

## 背景

- 现状（2026-11-18 从代码与 Spec 查得，未逐页点开确认）：设置里只有代码编辑器有字体、字号、行高（`editor.code.fontFamily`、`editor.code.fontSize`、`editor.code.lineHeight`，声明在 `packages/neuro-book/src/plugins/editor/shared/settings.ts`）；Markdown 正文没有对应设置；主题编辑器只能改字体栈、不能改字号。桌面版另有界面缩放（`nbook.desktop`，50% 到 200% 共 11 档），那是整个界面等比放大，不等于改字号。
- 开发者要的：Markdown 正文的字体、字号等设置也能改；代码编辑器与 Markdown 编辑器里按 Ctrl+滚轮调字号。
- 与桌面界面缩放的关系：[desktop-shell 输出 26](../../../../docs/specs/runtime/desktop-shell.md) 写了“页面自己处理了 Ctrl+滚轮的地方（图片查看器）不接管”。编辑器处理 Ctrl+滚轮后，桌面里在编辑器上按 Ctrl+滚轮改的是字号、不再是界面缩放；这条要写进输出 26 与场景 16（图片查看器之外再列编辑器），并想好光标在编辑器之外时仍是界面缩放。

- 参照 VS Code（开发者 2026-11-18 提到，凭记忆、开工时再查文档核对）：界面缩放 `window.zoomLevel` 与字号 `editor.fontSize`、`markdown.preview.fontSize` 是两套设置；`editor.mouseWheelZoom` 默认关，开了以后 Ctrl+滚轮在编辑器里改的是编辑器字号，界面缩放只走快捷键。

## 已定的决定（开发者 2026-11-18）

- Markdown 正文做字体、字号、行距三项，只管 Markdown 编辑器的纸面，对话里的 Markdown 不动。
- Ctrl+滚轮改的是设置值（防抖写进用户层，所有同类编辑器一起变）。
- 只在桌面里接管：桌面里编辑器上的 Ctrl+滚轮改字号、编辑器外不再用滚轮缩放界面（界面缩放只走键盘与命令面板）；浏览器里完全不接管。
- 顺带提出的“界面默认不可选中文字”拆成 w00046 t22。

合同：[`workbench.editor`](../../../../docs/specs/workbench/editor.md) 输出 32、52，[`runtime.desktop-shell`](../../../../docs/specs/runtime/desktop-shell.md) 输出 26 与场景 16（计划里写了要改的地方）。计划见 [plan.md](plan.md)。

## 当前状态

2026-11-18：已合入 master（b611b2ca4，没有 push），状态 done。

- 实现：Markdown 正文三项设置（字体、字号、行距，只允许用户层）；桌面里编辑器上的 Ctrl+滚轮改字号设置（编辑组根上捕获阶段一处监听，Monaco 与 Markdown 都命中，工具栏也算；累积满 50 像素换一档并清零，一格普通滚轮在任何页面缩放下换一档）；桌面里编辑器与图片查看器之外的 Ctrl+滚轮只拦下、不再换界面缩放；浏览器里不接管；改字号后 Markdown 的滚动位置按视野补回。共用的 `createWheelAccumulator` 与 `createSteppedSetting` 在 `src/shared/wheel-steps.ts`。
- 设计审查 r1（Sonnet，15 条，全部成立并吸收，[review-plan-r1.txt](evidences/review-plan-r1.txt)）：Monaco 会吃掉 Ctrl+滚轮所以监听改为捕获阶段且由 editor 插件持有一处；跨插件注入键放 `editor/shared/contracts.ts`；防抖目标用响应式；字号两项只允许用户层；行距改整数百分比；补 `windowDesktopKey` 依赖与 pagehide、dispose 时 flush；全局监听简化；文档与注释位置补全。
- 实现审查 r1（Sonnet，10 条：重要 3、一般 7，[review-impl-r1.txt](evidences/review-impl-r1.txt)）处理：Monaco 滚动断言是空断言（改成长文件、第一条可见行号，并做变异：去掉 `preventDefault` 后红，已还原）；`WHEEL_STEP` 在页面缩放不是 100% 时一格不满 100（改为 50 并清零，Spec 同步）；滚动位置补回缺变异证据（去掉补回后红，漂 8 段，已还原）；浏览器里“不被拦”的断言可能为空（补 `seen.length > 0` 与先于页面监听登记的记录方式，补 Monaco 上字号不变）；桌面全局拦截没有断言（标题栏上滚，断言被拦且缩放不变）；`wheel-steps` 补“写在途时又走一档”；`zoom.test.ts` 头注释过期（已改）；项目层迁移与写失败不提示写进 Spec；两份防抖写回不合并，在两处注释里写明理由（缩放档位表不等距且要交给壳）。
- 验证：`wheel-steps`、`desktop`、`editor` 的 bun 测试，`MarkdownControl` 与编辑器的 vitest，类型检查，`docs:check`，e2e `editor-font-size`（5 条）、`desktop-settings`（3 条）、`editor-code-settings`（2 条）通过；`test:affected` 里 10 个失败在 master 上同样失败（SDK 导出面、stickers 与服务端宿主，与本 Task 无关）。
- 待确认（默认追认）：`code.fontSize` 改为只允许用户层，作品项目层里已有的这个键不再生效（按配置合同丢弃并记一条诊断），没有迁移；换回项目层要在滚轮写回时按有效值来源选层，代价是多一个分支。块手柄的悬停位置在字号变后可能停在旧处到下一次指针移动，已写为已知限制，没修。
- 未验证（要 Windows 实机）：真实 WebView2 里 `preventDefault` 能否拦住自带缩放与触控板捏合；界面缩放 125% 以上时一格滚轮是否确实换一档（从 Chromium 行为推断）；沙箱 iframe（HTML 预览）里 Ctrl+滚轮仍触发 WebView2 自带缩放（已知限制，改动之前就如此）。

## 下一步

没有。
