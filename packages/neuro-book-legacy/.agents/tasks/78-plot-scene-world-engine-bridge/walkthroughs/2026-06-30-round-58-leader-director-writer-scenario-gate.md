# 2026-06-30 Round 58 - Leader Director Writer Scenario Gate

## Scope

本轮把 `leader.default -> director -> writer` 的端到端场景验收写成可检查 gate。目标是在不运行真实模型的情况下，明确哪些静态证据足够证明架构合同成立，哪些结论必须等真实 Agent smoke 才能说。

本轮不修改业务代码。

## Target Scenario

用户要求“规划并写一章”时，第一阶段目标链路应是：

1. `leader.default` 与用户确认剧情方向、canon 和 World Engine 事实推进责任。
2. 需要 Plot 结构变更时，leader 调用 `director`，而不是自己直接写 Plot，也不是创建 `simulator.leader`。
3. `director` 读取 Plot tree / chapter plot / scene world context，创建或更新 Thread / Scene / chapter scene order。
4. 若缺少已裁决世界状态，director 返回 `world_engine_requests`，而不是 `simulator_requests`。
5. leader 根据请求用 readwrite `execute_world` 推进 World Engine。
6. director 使用 `get_chapter_writer_brief({projectPath, chapterPath})` 生成 scene/world-only brief，并返回或交给 leader 审阅。
7. leader 调用 `writer`，把完整 `suggestedBriefMarkdown` 放入 `invoke_agent.message`，把正文目标放入 `invoke_agent.input.path`。
8. writer 只写正文，用 readonly `execute_world` 自查状态；不写 Plot，不写 World Engine。
9. writer 写作产生新事实时，leader 负责 post-write reconciliation：先回补 World Engine，再让 director 更新 Scene / Thread summary。

## Static Gates

不运行真实模型时，可以用以下证据证明“合同可执行”：

| Gate | 证据 |
| --- | --- |
| Routing gate | `reference/agent/profile-routing.md` / `leader-default.md` / `novel-writing-workflow.md` 不再把 director 排除在普通写作主链外。 |
| Director output gate | `DirectorOutputSchema` root strict；`plot_updates` item strict；字段包含 `world_engine_requests`；拒绝 `simulator_requests` 和旧 `plot` kind。 |
| Director prompt gate | `director.profile.tsx` 没有 simulator gate；报告字段与 schema 一致；明确 director 不写 World Engine、不调用 writer。 |
| Brief tool gate | `get_chapter_writer_brief` 进入 `plot-tools.ts` runtime、`tools/index.ts` registry、`profile-tools.ts` typed binding 和 director toolset。 |
| Brief service gate | `ChapterWriterBriefService` 返回 `suggestedBriefMarkdown`、status、warnings、ordered scenes、thread summaries，并复用 Scene World Context / unresolved subject 语义。 |
| OpenAPI gate | generated spec 同时有 `/api/projects/plot/scenes/{sceneId}/world-context` 和 `/api/projects/plot/chapter-writer-brief`，不存在 `/api/projects/plot/{...segments}` 暴露。 |
| Writer gate | writer prompt / payload 继续要求 `input.path` 是唯一写入目标，并删除“写作模式不使用 Plot 系统”的误导注释，改为“不直接使用 Plot tools，消费上游 brief”。 |
| Compiled gate | 当前 `.compiled/manifest.json` 指向的 director artifact 与 source 一致，不含旧 simulator gate，含新 output/tool exposure。 |

## Dynamic Gates

这些结论不能只靠静态测试证明：

- leader 是否会在模糊用户请求下稳定调用 director。
- director 是否会在缺 world anchor 时稳定返回 `world_engine_requests`，而不是继续规划。
- writer 是否会严格按 brief 写作且不自行扩大范围。
- post-write reconciliation 是否在真实长对话里自然发生。

要证明这些，需要至少一次真实 Agent smoke 或可回放 harness 场景。用户已允许浏览器验证，但项目规则要求不要自动浏览器验证；进入实现后应先建议用户确认是否要跑浏览器/真实 Agent 验证。

## Result

后续 completion audit 应把“静态合同成立”和“真实 Agent 行为已验证”分开：

- 四个实现切片全部完成，并通过 schema/tool/service/OpenAPI/compiled gate 后，可以说“leader-director-writer 调用链的静态合同成立”。
- 只有执行真实 Agent smoke 或等价回放，并观察 leader 调 director、director 产 brief、writer 消费 brief 后，才能说“真实 Agent 可用性已验证”。

