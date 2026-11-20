# 阶段 ③ 实现审查的处理

审查者：Claude Sonnet（子代理），提交范围 `9c4b40b9b..525a51ae9`，报告 [impl-review-3-sonnet.txt](impl-review-3-sonnet.txt)。10 条：重要 2、建议 8。

| 条 | 归类 | 处理 |
|---|---|---|
| 盖层盖住对话的头，四种盖层状态下鼠标没有关闭入口；对话异步加载慢或失败时同样 | 成立，要改 | 盖层（`ContactCover`）加 `closable`，书房面板里右上角有“关闭”；dom 测试点它关面板、交还借用。对话异步加载期间（没有盖层时）的空白只有一瞬，Esc 可关，不另加。 |
| `SidePanel` 的“内层已处理的 Esc 不算”没有测试 | 成立，要改 | 补用例（面板里的控件 `preventDefault` 了 Esc，面板不关），变异删掉这一支时失败；e2e 第二组在 `@` 菜单开着时按 Esc，断言菜单收起、面板还在。 |
| e2e 的 `elementFromPoint(...)?.closest(...) !== null` 在元素为 null 时空过；窄于 720px 的合同没有测试 | 成立，要改 | 改成 `?? null`；第一组在有未读时把视口缩到 700，断言气泡隐藏、角标还在，放回 1440 后气泡回来。 |
| 输入框的延后聚焦没有失效条件 | 成立，要改 | 等的期间用户在页面上按键或点鼠标就作罢，卸载时摘掉监听；补用例，变异过。 |
| `DeskCompanion` 把 `document.body` 当作“用户没挪走焦点” | 成立，要改 | 先改成只认面板里与看板娘上，e2e 随即失败：盖层出现时下面的对话变成 inert，原来在里面的焦点被挤回 body。改为按用户有没有动作判断：面板打开后用户在页面上按过键或点过鼠标就不放。 |
| 作者说“联系人消失时关面板”的变异活下来、是 Reka 卸载时自己发关闭，这个解释不成立 | 成立 | 重做变异：测试失败（借用数断言）。先前的结论有误，Task README 已改正。 |
| `SidePanel` 对页面别处的 Esc 也 `preventDefault` | 成立，接受取舍 | Reka 的 Esc 只能靠取消默认来不关；写进 `SidePanel.md` 的状态与边界。 |
| PromptEditor 的 `focus("keep")` 在排队时当成 `end`；方法清单手写；排队与直调的顺序空档 | 不改 | 编辑器还没建时没有可保留的光标，按末尾是唯一合理的取法；清单只有 PromptEditor 一处，四个方法；顺序空档只在加载的那一刻、调用方都是一次性的聚焦与插入，收益小。 |
| `plugin.ts` 里旧注释写“两个位置”、`deskConversation` 重复了注册表的计算、位置参数是 `string` | 成立，要改 | 注释改成各位置；注册表的计算抽成 `positionRegistry`；`initAt`、`openRecent`、`hostDeps` 用 `ConversationPosition`。 |
| 对照 r7 的图：气泡文字、头的状态行与子代理计数 | 不改 | 气泡文字是决定 8；头的状态行等后端活动摘要（决定 6）；子代理入口照常在头上。 |
| `MessagesHost` 外加 inert 包裹改了 flex 链，要跑消息视图 e2e | 已验证 | 收口时 `bots-chat`、`agent-conversation` 都过。 |

另：改 e2e 时发现第二组的“`@` 菜单压在面板上”原来按 `getByRole("listbox").first()` 取到的是书架卡片的列表框，判断空过；改用 `[data-suggestion-menu]` 并先断言菜单在面板的范围里，把侧面板层级临时调到下拉之上做变异，这条失败。收口：`bots-chat`、`agent-conversation` 31 条全过（修正提交 `6dc7e0d8f`）。
