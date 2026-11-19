---
schema: nbook.task/v2
taskId: t15-qa-reasoning-and-mentions
status: active
updated: 2026-10-23
---

# 问答的思考摘要（Responses 接口）与输入框的 @ 引用

## 目标与范围

配置可选 Responses 接口，让 GPT 系列回思考摘要；问答页输入框支持 @ 引用人物、对象与章节、段落，模型看到带 id 的引用。来自开发者试用 [t13](../t13-qa-web/README.md) 后的反馈。计划见 [plan.md](plan.md)。

合同：改 [`story/qa.md`](../../../../../docs/specs/story/qa.md)（配置的接口、问答规则里的引用）与 [`story/viewer.md`](../../../../../docs/specs/story/viewer.md)（问答页的 `@` 菜单与引用的打开）。

## 决定

开发者 2026-10-23 在会话里定：

1. 问答模型的配置可以选走 Responses 接口，让 GPT 系列回思考摘要；之后用真实模型冒烟一次（中转渠道余额恢复后）。
2. `@` 引用人物与对象、章节与段落两样都要；模型看到的是带 id 的引用。
3. 章节引用点开后打开这一章开头的原文。
4. 输入 `@` 还没打字时，列出提及最多的几个人物与当前这一章。
5. 不做设计审查，直接实施；做完做一次实现审查（前端 Sonnet，后端 omp）。

## 当前状态

- 2026-10-23 计划经开发者确认，开工。
- 切片 1（分支 `feat/w00024-t15-qa-reasoning-mentions`，42dc7f50a）：配置 `model.api` 可选 `responses`，走 OMP 的 `openai-responses`，思考摘要进会话日志并在过程里显示。测试端点按 `/responses` 路径回 Responses 流式事件（含思考摘要），对话补全回 `reasoning_content`。只用本地假端点验证，真实服务还没冒烟。
- 切片 2（91d363ac6）：问答页输入框 `@` 菜单（人物与对象按阅读位置查、章节与段落按数字或章标题），插入 `entity://`、`paragraph://`、`chapter://` 引用；问题里的小块点开在抽屉里，列表与页头只显示名称；问答规则加“问题里的引用”，Profile 版本 2 → 3。
- 版本升级的后果：t15 之前开始的对话仍能查看，续问时提示开新对话（qa.md 输出 37）。
- 验证：nb-story 单测通过、typecheck 无错；nb-story 全量 e2e 28/28 通过。
- 实现审查：前端 Sonnet 8 条（重要 1、建议 7），后端 omp 3 条（重要 1、建议 2），处理见 [impl-review-web.txt](evidences/impl-review-web.txt)、[impl-review-backend.txt](evidences/impl-review-backend.txt)；修正 f58097cf8、8cbf24c0f，Spec 7b95d3e05、d6107ffcb。要点：`@` 菜单按章标题找只筛读到的章（原先会透露后面章的标题）；Responses 只在写了推理档时要思考摘要（OMP 的限制，`config show` 写明）；`model.api` 写错是用法错误。修正后 nb-story 单测 417 通过、typecheck 无错、问答 e2e 8/8 通过。

## 下一步

1. 中转渠道余额恢复后用真实模型冒烟 Responses 接口（要开发者批准）。
