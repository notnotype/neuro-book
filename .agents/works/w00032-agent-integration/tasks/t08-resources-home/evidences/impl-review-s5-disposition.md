# t08 第 5 片前端审查的处理

审查者：Claude Sonnet 子代理，报告 [impl-review-s5-sonnet.txt](impl-review-s5-sonnet.txt)，5 条（重要 1、建议 4），审查对象为提交 `bcb57b83f`。

| # | 级别 | 归类 | 处理 |
|---|---|---|---|
| 1 | 重要 | 成立，要改 | `e2e/lab-markdown.e2e.ts` 的断言还是 `local://`：改成 `session://attachments/`，跑该 e2e 验证 |
| 2 | 建议 | 成立，但不改 | `prompt-token-action.ts` 取名字直接截前缀，不解码、不取最后一段：`local://` 时期就如此，附件名由宿主生成（无空白与括号、不分目录），触发不到；收益小 |
| 3 | 建议 | 成立，要改 | `targets.ts` 判附件改成方案名不分大小写，与同函数里的 `project`、`user` 一致；补 `SESSION://` 加百分号编码的断言 |
| 4 | 建议 | 部分成立 | 补 `session://plan.md` 判为其它的断言；`session://attachments/../x` 与空名字不改：附件地址只由宿主生成 |
| 5 | 建议 | 成立，要改 | 测试与 Lab 夹具里“会话内短地址”的旧称谓改为“会话附件” |
