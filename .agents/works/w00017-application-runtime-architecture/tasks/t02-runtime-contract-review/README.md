---
schema: nbook.task/v2
taskId: t02-runtime-contract-review
---

# 运行时合同独立审查

## 目标与范围

按[所属 Work](../../README.md)审查[总体提案](../../../../../packages/neuro-book/docs/proposals/application-runtime-and-plugins.md)、前两切片七项planned Spec与[实施路径](../../implementation-plan.md)。只写本Task审查报告，不编辑Spec、提案、索引、产品或其它Task。首轮 `walkthroughs/review.md`、B/S追加 `walkthroughs/tracer-review.md` 保留，本轮写 `walkthroughs/foundation-review.md`。

## 审查合同

用户已接受基础方向并要求“环境适配入口/小内核 → 真实服务插件 → 外部作者视角功能切片”的Spec与计划；当前产品实现等待w00003完成合并master。重点反证生命周期取消/关闭竞态与owner、服务依赖闭包/动态等待/初始化、插件贡献事务、真实文件/SQLite可实施性、诊断与宿主边界。不能把已接受方向重提为待批准，不把第三方热加载或所有领域迁移强塞前两片。

报告具体位置、原文、严重性、违反场景与最小修正；没有阻断问题也要说明检查边界。不得把旧研究现状或主树缺少的 w00003 代码当本文错误；本文明确区分两个 checkout。

## 验收与执行边界

跳过 formatter、lint、build、tests 和 docs/governance 检查，由 Leader 最后统一运行。只审查，不调用真实模型或浏览器，不提交/push。审查结论不等于人类批准提案或授权实施。报告必须能支持逐条处理，不做笼统背书。
