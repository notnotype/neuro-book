---
schema: nbook.task/v2
taskId: t02-kernel-tags
status: planned
updated: 2026-11-26
---

# 写法与内核：标签写法、共用解析器、给 Agent 的带值只给看

## 目标与范围

条目主文字改用标签写法（取值、计算、条件、条目引用、图片、插件登记的标签），内核改用与章节编辑器相同的 marked 解析器，给 Agent 的渲染带值只给看、交回时去掉值；已有数据换写法。为后面的富文本编辑器与标签登记表打底。

合同：[`canon/rendering.md`](../../../../../docs/specs/canon/rendering.md) 重写（写法、白名单、带值写法、去掉回写）；[`canon/agent-tools.md`](../../../../../docs/specs/canon/agent-tools.md)、[`canon/author-ui.md`](../../../../../docs/specs/canon/author-ui.md)、[`workspace/markdown-syntaxes.md`](../../../../../docs/specs/workspace/markdown-syntaxes.md) 跟着改；新 ADR 部分取代 [ADR 0038](../../../../../docs/adr/0038-world-engine-entry-text-is-whitelisted-mdx.md)。具体见[实施计划](plan.md)。

## 当前状态

2026-11-26 经 nbdev 新建（开发者“可以，开工”，要写实施计划）。

[实施计划](plan.md)第 2 稿已写，等开发者确认“要开发者定的”六条。依据：[独立设计](evidences/independent-design.txt)（Opus，带实验：先遮罩再分词拿到标签的准确位置，约 9000 份随机文档没有标签丢失；不遮罩时表格里的标签被 `|` 切开、内容静默丢掉）、[调研摘要](evidences/survey.txt)、[编解码器对照](evidences/codec-probe.txt)。第 1 稿交顾问看过，按意见改了三处：内核走与编辑器同一段预处理（frontmatter、LF），白名单放行编辑器会写出的 `<br>` 等；编辑器侧的条目语法模块与内核的对照提前到本 Task；转换器先做，换内核与数据迁移合成一个提交范围。

开发者 2026-11-26：“全部同意”。计划里“要开发者定的”六条按推荐定：

1. 只迁样本与测试，不做打开作品时的整体转换。主会话查过本机：只有一部作品带世界数据目录，日志是空的；开发样例不进 Git，按新写法重新生成。
2. Agent 在文字里改了值：照常写入、值不改，回话提示改值用 `set`。
3. 条件只在一段之内，跨段的拒收。
4. 删掉 `{地址 = 值}` 注记与 `writeBack`。
5. 给 Agent 的条件每个判断带 `value="true|false|null"`。
6. 登记标签的描述用条目文字模板，做 t04 时出演示对齐。

## 下一步

1. 开 Work 分支，先做 S0（旧实现的快照）与 S1（Spec 与 ADR），S1 交快速审查（Opus 先审，omp `@review` 在后台）。
2. 之后按计划的切片往下做。
