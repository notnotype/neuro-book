# 阶段 ③ 设计审查第一轮的处理（plan-3 草稿 1 → 草稿 2）

审查者：Claude Sonnet（子代理），报告 [design-review-4-sonnet.txt](design-review-4-sonnet.txt)。14 条：阻断 1、重要 6、建议 7。报告文件里第 12 条 d 与第 14 条有追加的更正段，以更正后的为准。

| 条 | 归类 | 处理 |
|---|---|---|
| 1 截住冒泡关不掉 Reka 的滑动，还挡掉别的浮层的“点外面” | 成立，要改 | 实验输出与 `useSwipeDismiss.js`、`DismissableLayer` 的源码一致。不在 Drawer 上叠截停，改用新组件（第 2 条）。 |
| 2 Reka Drawer 不是这件事的原语，nb-ui Drawer 也没有滑入动画 | 成立，要改（改上游） | 新增 nb-ui `SidePanel`，建在 Reka 非模态 Dialog 上，自带入退场关键帧；不动现有 Drawer。 |
| 3 读屏名、无面板头、正文内边距、上沿偏移在 Drawer 上做不到 | 成立，要改 | `SidePanel` 的 `label`、无内边距正文、自己读 `--nb-window-frame-offset`、`width`。 |
| 4 面板盖住看板娘；关闭后焦点没有机制 | 成立，要改 | 看板娘做 `SidePanel` 的触发器（焦点归还与 `aria-expanded` 由 Reka 给）；关闭靠“关闭”与 Esc，验收不再写“再点看板娘关上”；打开时焦点放进输入框。写进待确认 3。 |
| 5 面板里没有会话时露出第一屏，能建出无归属会话 | 成立，要改 | 没有会话时一律盖层；联系人消失时关面板。 |
| 6 借用重开会把 `opened` 加一，作废刚点的联系人 | 成立，要改 | `session-host.ts` 第 1053 行与 `borrow()` 核实。`opened` 改为借用重开同一个会话不加；关面板时 `opener.cancel()`。 |
| 7 同步的 `{component}` 让所有窗口加载对话界面；`hasModel` 要等 `ensureStarted` | 成立，要改 | 贡献实现改为 `{load}`；面板的对话部分异步加载；点开时调 `ensureStarted()`；组件单根。 |
| 8 气泡位置、尖角、焦点环与圆角、角标计数复用 | 成立，要改 | 尖角按格宽算；窄于 720px 不画气泡（待确认 4）；按钮 `border-radius: inherit`；`entryCountText` 移到 `workbench/shared/` 共用。 |
| 9 “看到”的条件在书房里没有来源，窗口焦点会抄一份 | 成立，要改 | 抽 `useWindowFocus()`，书房的“可见”就是面板开着。 |
| 10 第一个联系人的次序、空联系人、`unread` 为 null、读不到 | 部分成立 | 改成“第一个有联系人的归属插件”，`unread` 为 null 按 0，读不到时按钮提示原因；第三方排在 bots 前面记为已知限制（第一版只有 bots），不为它加机制。 |
| 11 e2e 的触发条件缺一步，几条判据测不出来 | 成立，要改 | 验收写清：先打开面板，模拟失焦后发话再关；拖选判据改成“面板仍开着、选区非空”；加带附件的话与 `@` 菜单；不测触摸。 |
| 12 a 位置类型各写一份 | 成立 | 提成 `ConversationPosition`，书房不记最近用过的位置。 |
| 12 b 属性对象第三处复制 | 成立 | 抽 `conversationProps(position, host)`。 |
| 12 c `head-end` 与 `head-trailing` 同义 | 成立 | 改成 `closable` 与 `close` 事件，不加插槽。 |
| 12 e `sessionList` 不必要 | 部分成立 | 不放 `#sessions` 就不开下拉，但 `ownList` 与标题弹出状态的写回要跟着改，保留一个 `sessions` 属性统一控制。 |
| 12 f 子会话里怎么回主对话 | 成立 | 写明头里的路径是回主对话的路。 |
| 13 输入框里 Esc 关不掉 | 成立，要改 | `PromptEditor` 在组字与菜单之后才发 `escape`（核实 468–491 行），经输入框与对话视图往上发，书房面板接它关面板。 |
| 14 与已定决定的对照 | 成立 | 心情只让“等你处理”换（在跑不换，免得反复播切换动画）；写明本阶段头没有第二行。 |
