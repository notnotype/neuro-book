---
schema: nbook.task/v2
taskId: t17-harness-kernel-edges
---

# nb-harness 第二轮优化（一）：内核边界、用量估算与预览

## 目标

t16 的审查者声明未核实的四个边界，加上推迟的预览接口（2026-10-11 开发者确认“这些都可以做”，计划经批准）：

| 项 | 问题 | 改法 | Spec |
|---|---|---|---|
| 3 | `status` 每次回放整份日志算 `pending` 与用量 | 按条目数组引用缓存（每次 append 换新数组）；用量没有服务方报告时用 OMP `Tokenizer` 估算，`context.source` 标明来源 | [`harness.runtime`](../../../../../docs/specs/harness/runtime.md) 输入、输出 5 |
| 4 | `next()` 每次订阅，等待期间反复调用会累积 | 等待点尚未到来时共用同一次等待 | runtime 输出 6 |
| 5 | 目录用“有 `replace` 函数”判断存储 | `createModelCatalog({config} \| {store})` 显式区分 | [`harness.models`](../../../../../docs/specs/harness/models.md) 输入、输出 10 |
| 6 | `:memory:` 关掉重开是空库，文档没说 | Spec 与 README 各加一句（合同测试已有） | models 输出 5 |
| 1 | 看不到模型会收到什么 | `session.preview(input?, options?)`：走受理检查（不要凭据）、准备 Profile、渲染种子、追加消息、系统提示词与请求消息，不写条目、不发请求、不改状态 | runtime 输入、输出 1、17；[`harness.profile`](../../../../../docs/specs/harness/profile.md) 失败表 |

非目标：资源寻址、artifact 溢出与 OMP 升级（[t18](../t18-harness-resources-artifacts/README.md)）。

## 当前状态（2026-10-11）

- 计划见 [`plan.md`](plan.md)。
- 实现中。

## 依据

- 开发者 2026-10-11：“可以，这些都可以做”，并在计划里确认预览放会话级、不要凭据。
- Spec 已 `implemented`，按 [`docs/specs/README.md`](../../../../../docs/specs/README.md) 原地改条目。

## 下一步

实现、合同测试、示例，omp 审查后处理发现。
