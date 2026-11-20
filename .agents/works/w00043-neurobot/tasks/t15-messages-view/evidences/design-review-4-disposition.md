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

## 第二轮（草稿 2 → 草稿 3）

审查者：Claude Sonnet（子代理），报告 [design-review-5-sonnet.txt](design-review-5-sonnet.txt)。11 条：重要 4、建议 7，全部成立，都改进计划。

| 条 | 处理 |
|---|---|
| 1 书房自带标题行时 `--nb-window-frame-offset` 是 0，“关闭”压在窗口按钮下；nb-ui 不该读应用变量 | 核实 `web/styles.css` 与 `desktop-frame.ts`。`SidePanel` 只认自己的 `--nb-side-panel-inset-top`，neuro-book 在桌面外框下设成 `--nb-window-frame-height`；验收改成矩形不相交。 |
| 2 取消 `open-auto-focus` 后第一次打开与盖层期间焦点没着落 | 不取消缺省；第一次满足“没有盖层、输入框已挂上”且焦点没被用户挪走时再放进输入框；盖层时下面的对话加 `inert`（消息视图同改）。 |
| 3 组字时 Reka 照样关；焦点在书架上 Esc 也关并抢焦点 | 复用 `dialog-close.ts` 的判断；只在焦点在面板里或触发器上时关；关闭前焦点在面板里才还焦点。 |
| 4 层级没定，面板里的菜单靠 DOM 顺序 | `z-index.ts` 加 `sidePanel` 一档，面板向内容提供 `popover` 档；e2e 用 `elementFromPoint` 验。 |
| 5 Tab 在面板里循环 | 接受，写进 `SidePanel.md` 与待确认 3。 |
| 6 首次打开时会话可能在没人借用的宿主上一直订阅 | 面板开着期间 `DeskCompanion` 自己借用宿主。 |
| 7 换组件时猫重挂 | 猫始终由 `ShelfDesk` 画，贡献叠在同一格上，经 `update:mood` 改心情。 |
| 8 气泡定位没定；720 是案头容器宽 | 气泡绝对定位在格子下方、不可点；判据写成案头容器宽，截图加 780 宽。 |
| 9 `SidePanel` 根不是元素；角标与气泡放哪 | 写明调用方自己包一层；角标与气泡是按钮的兄弟；最后一句话不进读屏名；宽窗口里再点看板娘也关。 |
| 10 传送目标、尺寸单位、退场帧、读屏描述 | 照 Drawer 用 `useTeleportTarget`，`top`/`bottom` 定高、`min(…, 90cqw)` 定宽；退场带 `forwards`；`aria-describedby` 置空；复用 `close-handoff`。 |
| 11 e2e 的写法与判据 | 书房单独一组、面板按 `role=dialog` 定位、起点读未读；加正向“看到”、Esc、层级、窗口按钮不相交；拖选只留“选区非空”；联系人消失放到 dom 测试。 |
