# 待确认清单

[autonomous-delivery](../../skills/autonomous-delivery/SKILL.md) 推进中照推荐做、事后请开发者追认的决定。开发者追认或改判后在“结果”列写明；改判需要的改动另建 Task 或并入下一个 Task。

| 日期 | Task | 类别 | 决定 | 理由 | 改回的代价 | 链接 | 结果 |
|---|---|---|---|---|---|---|---|
| 2026-10-10 | t09 | 审查意见“成立，但接受取舍” | JSONL `create` 写会话头失败时只做 best-effort 删除文件；已存在的文件不论内容一律 `session-exists`，没有会话头的文件按 `corrupt-session` 交人工处理，不做自动回收 | 计划审查第 13 条建议临时文件加 rename 或 reserved 状态；头只有一行、失败后紧接着就删，再加一层原子重命名的收益不大 | 小：改 `create` 为临时文件加 `link`/`rename`，几十行 | [计划审查](tasks/t09-harness-foundation-session/evidences/plan-review.txt) 第 13 条 | |
