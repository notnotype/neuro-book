# t28 设计审查的处理

后端 omp 14 条（阻断 5、重要 8、建议 1）：[报告](design-review-backend.txt)。前端 Sonnet 16 条（阻断 1、重要 10、建议 5）：[报告](design-review-frontend.txt)。都是读代码得出，核实方式见报告；主会话抽查了关键几条，属实。修订进 [plan.md](../plan.md)。

| 来源与编号 | 处理 |
|---|---|
| omp 1 | 不成立：计划里那一节只是指向 t06，没有把模式算进本 Task 的范围。 |
| omp 2 | 成立：解析入口严格拆 `role:<id>`，未知角色与未绑定分两个码。 |
| omp 3、Sonnet 2 | 成立：`setModel` 只改一个字段，代次防晚到；`settingsChanged` 这条路径也接上。 |
| omp 4、Sonnet 6、7 | 成立：转录器记锚点，三种操作的目标写明；`canMutateHistory` 定义。没加内核查询，`after-step` 的 id 就是 `modelStarted.parent`。 |
| omp 5、Sonnet 5 | 成立：新结构查询 `treeNodes`、`branchPoints`，不从 `log` 算，不逐条调 `siblings`；不用 nb-ui `Tree`。 |
| omp 6 | 成立，换了改法：附件写全局地址 `sessions://…`，`fork` 不用复制（t14 已定任何会话能读任何会话）。 |
| omp 7、8、Sonnet 9 | 成立：内核加附件读取端口，三处共用；规则对齐工具结果的图片；发送形状定了。批 5 开工前再单独写设计、审一次。 |
| omp 9、12 | 成立：上传与读取路由的合同写进计划。缩略图不做。 |
| omp 10、Sonnet 8 | 成立：`nbook.files` 加 `find`，异步菜单照 nb-story。 |
| omp 11、Sonnet 14 | 成立：`/model` 由输入框自己处理，四个命令列表；`/fork` 用同一 `commandId` 重发。 |
| omp 13、Sonnet 16 | 成立：列出必测场景；编号映射每批开工时写。 |
| omp 14 | 成立：过滤留三种加全部，“带标签”不做（没有标签）。 |
| Sonnet 1 | 成立：面板宿主、就地编辑态都要新写，计划与切片表已改。 |
| Sonnet 3 | 成立：解析失败时选择器不禁用。 |
| Sonnet 4 | 成立：草稿用 `nbook.storage`，按会话，防晚到。 |
| Sonnet 10 | 成立：分母加 `cacheWrite`，没有缓存数据时不显示。 |
| Sonnet 11 | 成立：选择器尺寸与保留项写明。 |
| Sonnet 12 | 成立：状态栏两区、`canInspectContext`、320 宽静态稿。 |
| Sonnet 13 | 成立：数据形状写明，系统提示词走 `systemPrompt.load`。 |
| Sonnet 15 | 成立：历史的定义与取舍写明。`acceptSubmission` 的“受理后放进 recall”语义与取自日志不同，按取自日志。 |
