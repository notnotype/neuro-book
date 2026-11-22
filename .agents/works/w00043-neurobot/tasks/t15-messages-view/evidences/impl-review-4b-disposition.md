# t15 阶段 ④ 第 2 片的实现审查：处理

审查：Claude Sonnet，2026-11-22，对提交范围 `4b526813d..8e49fa75b`（应用的 agent 与 bots 浏览器一侧），报告 [impl-review-4b-sonnet.txt](impl-review-4b-sonnet.txt)，6 条（重要 2、建议 4）。

| 条 | 归类 | 处理 |
|---|---|---|
| 1 书房面板第一次打开大概率不记首屏指标（对话组件加载比打开慢，挂上时已经读完） | 成立，要改 | `watchPaint` 不再要求看到起点：带 `loaded` 的对象只要还没记过就记，耗时从宿主记的起点算；“已记”放在一张跨组件共用的表里，同一次打开只记一条。`paint-metric.test.ts` 补“挂上时已经读完”与“只记一条” |
| 2 `painting` 没有对真实宿主的测试，测试头注释不实 | 成立，要改 | `session-host.test.ts` 加“首屏计时”：开始时的起点、读完后的 `loaded.events` 等于快照 `head`、重试换新对象、借用后的重新订阅标 `reattach`；注释改正。诊断名与 `ConversationHost` 的接线不另写 dom 测试：接线只剩挂载时调一次，第 1 条改完以后挂载先后不影响结果 |
| 3 读完之后、画出之前卸载，照样记一条 | 成立，要改 | 停止时作废在途的那次；测试补这条 |
| 4 `await ownerRead` 让回调里的错误卡住打开 | 成立，要改 | 读“看到”包一层：归属插件出错时记 `agent.conversation-owner-failed`，当作没读到，这次不画线、聊天照常打开（同步与晚到两条路都覆盖，测试补一条）；`ownerRead` 另加 `.catch`，回调里别的错误按读不到会话头处理 |
| 5 进子会话再回主对话也算又一次打开，看过的线收掉 | 成立，接受取舍 | 窄场景，按会话 id 判“这次”最简单；Spec 输出 55 写成已知限制，交开发者知悉 |
| 6 书房面板调 `markOpened` 的先后没有测试 | 成立，要改 | `DeskCompanion.dom.test.ts` 断言 `borrow`、`markOpened`、取主对话依次发生；`session-host.test.ts` 补“放开满 30 秒、借用就地重新订阅后立刻 `markOpened`，线按此刻重算” |
