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
| 3 | `examples/steps/01…07` 渐进式脚本（真实模型）、README 快速开始改写、`examples/README.md` 阅读顺序、`docs/profile-architecture.html` 讲解页、术语表 | 无行为变化 |
| 4 | omp 审查处理 | |

非目标：改 Result 合同本身；`session.title` 的缺省；删 `next()`。

## 当前状态（2026-10-11）

- 计划见 [`plan.md`](plan.md)。
- 提交 1 `c6ab07b8`（便捷层与宿主审批）、提交 2 `c1f2b823`（Profile 一等属性与缺工具警告）、提交 3（渐进式示例、README、讲解页）。
- 与计划的出入：讲解页放在 [`packages/nb-harness/docs/profile-architecture.html`](../../../../../packages/nb-harness/docs/profile-architecture.html)，不在 `examples/docs/`——那个目录是示例装配里 `docs://` 方案的根，模型会读到，讲解页混进去会成为模型的参考文档。`06-compaction` 从“低阈值自动压缩”改为“两轮后手动 `compact()`”：真实模型每轮报告的用量含推理 token（约 4600），阈值 800 时每轮都压，一次 `soft` 压缩在服务慢时要 2 到 4 分钟，脚本跑不完。
- 验证：`bun test` 212 pass、6 skip；`typecheck`（含 `examples/steps`）；`docs:check`、`governance:check` 无失败。
- 示例脚本各跑真实模型（gpt-6-luna，2026-10-11 10:12–11:59，服务期间多次返回 `Upstream service temporarily unavailable`）：

  | 脚本 | 结果 |
  |---|---|
  | `01-minimal` | completed，给出三个书名 |
  | `02-profile-file` | completed；预览列出系统提示词、`once` 种子、输入与提醒，诊断为空 |
  | `03-tools-and-approval` | 第一次 failed（当时脚本没打印原因，之后各脚本都补了打印）；重跑 completed：回调被问一次（`edit`、`write`），文件第二行按要求改了 |
  | `04-sessions` | completed；换运行时 `openSession` 后答出“海燕号”，`listSessions` 列出带标题的会话 |
  | `05-profile-data` | 第一次上游故障；重跑 completed：系统提示词带时间、种子带工作区目录，模型据此回答 |
  | `06-compaction` | 低阈值版本超时（见上）；改版后：手动压缩写入摘要与种子，压缩后模型答出第一段的内容；第二轮撞上一次上游故障 |
  | `07-spill` | 两次在最后一次回复撞上上游故障（溢出与回读都已完成：226892 字节的结果只有 41090 字节进上下文，`read artifact://0` 回到第 2000 行）；第三次 completed，模型原样答出第 2000 行 |

- 一次排查：追踪 06 时以为第三轮写了两遍助手消息，复查是自己的命令把末尾两行打印了两次；脚本化模型复现“压缩失败后再发一轮”也没有重复条目。
- 待 omp 审查。

## 依据

- 开发者 2026-10-11：便捷入口与 `unwrap` 两者兼得；审批回调按推荐；一等属性要；缺工具改警告；`title` 保持可选；示例脚本用真实模型；讲解页做成 HTML 放进 Task。
- Spec 已 `implemented`，原地改条目。

## 下一步

实现、合同测试、示例，omp 审查后处理发现。
