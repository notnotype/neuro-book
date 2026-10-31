# w00032 待确认清单

自主推进时照推荐做了、本该由开发者决定的点（[autonomous-delivery](../../skills/autonomous-delivery/SKILL.md#待确认清单)）。开发者追认或改判后在“结果”一栏写明；改判需要的改动另建 Task 或并入下一个 Task。

| 日期 | Task | 类别 | 决定 | 理由 | 改回的代价 | 结果 |
|---|---|---|---|---|---|---|
| 2026-10-31 | t20 | 偏离提案（补定类型） | `CompactionJob` 加 `reason`、`cuts`（合法切点，各带保留的 token 估算）、`tokens`；`SessionEnv` 加 `compaction{methods, restore}`；放回的内容写成 `notice{code: "restored"}`（[`harness/runtime.md`](../../../docs/specs/harness/runtime.md) 输出 46–52） | 方法只拿请求时找不到能切的 `turnStarted` id；方法与放回内容由插件与 Agent 插件提供，内核需要一个注入口；提案没给放回内容的事件名 | 小：改字段名或事件名只动内核与测试，还没有使用方 | 待追认 |
| 2026-10-31 | t20 | 产品取舍 | 运行中受理的 `compact` 的要求只在内存里，到下一个边界做；进程中断就丢（重发得到第一次受理的值） | 写进日志要另一种待生效记录与恢复时的补做，收益小 | 中：加一种 session 事件与恢复逻辑 | 待追认 |
| 2026-10-31 | t20 | 产品取舍 | 压缩的 token 估算按 UTF-8 字节每 3 字节一个 token（中文略高估，宁可早压缩）；`<History last>` 只要最近几轮时不放压缩摘要 | 没有本地分词器；只要最近几轮的模板本来就不要旧内容 | 小：改一个函数与一个条件 | 待追认 |
