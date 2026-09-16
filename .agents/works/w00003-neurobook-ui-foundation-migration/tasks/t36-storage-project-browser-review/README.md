---
schema: nbook.task/v2
taskId: t36-storage-project-browser-review
role: reviewer
---

# 浏览器 Project Storage 适配独立审查

Work：[w00003](../../README.md)；实现 [t35](../t35-storage-project-browser/README.md)。
合同：[storage.persistence](../../../../../docs/specs/storage/persistence.md)。

只审相对 `0d66064b` 的 `packages/neuro-book/app/utils/storage` 改动：host-context-client、value-transport、owner-handle、
新 request-deadline helper、相关测试与README。t35 已完成代码和76用例，当前只写报告；服务端 t30仍在补修，排除。
主 Agent已从 omp 原始 tool output 核实：4文件76通过；移除目标捕获后的负向用例失败，还原后76通过。
不要编辑被审源码/Spec/Work，仅写本 Task `walkthroughs/review.md`。可实跑直接受影响前端测试；不跑全库/typecheck（主Agent统一）。
不联网、不再派代理、不提交/push，不操作真实data。约8分钟，早写发现，空final不算审查。

## 核对重点

- project 目标第一次 await 前捕获；一次 session 的 scope/标识/凭证不随外部输入变；现有 ProjectSessionReady 可直接供其消费。
- HTTP 地址按固定scope派生，user/project无fallback；未知scope/无效target是否可诊断，而非静默user。
- 共用owner句柄/订阅，scope定义前端拒绝，服务端错误终止该句柄，无自动重新签发/路径重开。
- 初始化与release禁自动重试、背景toast；抽取超时helper不丢原有AbortSignal/完整body期限语义。
- release收口顺序与README一致，不关闭Project/presence/其他标签；超时不能假装成功。
- 测试用注入request可核目标/消息而不是绕开adapter，避免scope串线；程序仍不把Storage变成Project open必需门禁。
- 新类型改名相关引用有无遗漏（含仓库脚本和验收fixture；不能只搜app）。

结论 `建议合并` / `需要修复` / `未完成验证` / `无法判断`；指出触发、影响、具体位置与证据。
本Task不要求实现UI/旧键迁移/插件，浏览器真实Project恢复会在后续消费验收补齐。
