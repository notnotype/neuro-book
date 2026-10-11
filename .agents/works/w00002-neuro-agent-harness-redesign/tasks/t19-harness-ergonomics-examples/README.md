---
schema: nbook.task/v2
taskId: t19-harness-ergonomics-examples
---

# nb-harness 易用性与渐进式示例

## 目标

开发者 2026-10-11 看完 README 快速开始后的判断：骨架难用（每步手工解包 `{ok, value}`；审批等待暴露成 `for (;;) { next() }`；`createRuntime` 四项必填），Profile 的 `fields["harness/tools"]` 像配置文件，请求了没装的工具静默跳过；示例缺 OMP `examples/sdk/` 那种“01 最小、02 加一样”的梯度。计划经批准，三个实现提交加一个审查处理提交：

| 提交 | 内容 | Spec |
|---|---|---|
| 1 | 便捷层 `unwrap`/`HarnessError`；`createRuntime` 缺省值（内存存储、数组 Profile、`HarnessConfig`）与异步便捷入口 `openRuntime`；宿主审批回调 `approve`（模型 → 宿主 → 用户） | [`harness.runtime`](../../../../../docs/specs/harness/runtime.md) 输入、输出 6、新输出 18、场景 2、3、10；[`harness.session`](../../../../../docs/specs/harness/session.md) 输入（`decidedBy: "host"`） |
| 2 | `defineProfile` 的一等属性 `tools`/`model`/`compaction`/`approval`（映射到 `fields["harness/*"]`）；请求了没装的工具给 `unknown-tool` 警告 | [`harness.profile`](../../../../../docs/specs/harness/profile.md) 输入、输出 13；[`harness.tools`](../../../../../docs/specs/harness/tools.md) 输出 3；runtime 输出 2、3、17 |
| 3 | `examples/steps/01…07` 渐进式脚本（真实模型）、README 快速开始改写、`examples/README.md` 阅读顺序、`examples/docs/profile-architecture.html` 讲解页、术语表 | 无行为变化 |
| 4 | omp 审查处理 | |

非目标：改 Result 合同本身；`session.title` 的缺省；删 `next()`。

## 当前状态（2026-10-11）

- 计划见 [`plan.md`](plan.md)。
- 实现中。

## 依据

- 开发者 2026-10-11：便捷入口与 `unwrap` 两者兼得；审批回调按推荐；一等属性要；缺工具改警告；`title` 保持可选；示例脚本用真实模型；讲解页做成 HTML 放进 Task。
- Spec 已 `implemented`，原地改条目。

## 下一步

实现、合同测试、示例，omp 审查后处理发现。
