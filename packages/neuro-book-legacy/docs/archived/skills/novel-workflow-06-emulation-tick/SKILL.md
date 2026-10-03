---
name: novel-workflow-06-emulation-tick
description: Legacy / RP simulation tick。用于旧 simulation/ 或 RP 项目推进世界运行 tick；普通写作模式应使用 novel-workflow-08-plot-planning 查询并推进 World Engine。
when_to_use:
  - 用户明确要求旧 RP / legacy simulation 推进一个 tick
  - legacy RP 项目需要先确定角色、势力、地点或实体的当前反应
  - 写完一个 RP Tick 后，需要把已发生事实提交到 simulation/subjects 或 simulation/entities
---

# novel-workflow-06-emulation-tick：Emulation Tick

> **已归档（2026-07-26）**：本 skill 已随写作 skill 体系重组（novel-workflow → novel）移出 Bundled Workspace Template，不再进入 skill catalog。普通写作模式的剧情推演与落库见 `novel-writing`。旧 RP / simulation 项目需要时可参考本文手动执行。

> Legacy 边界：本 skill 保留给旧 simulation/ 与 RP 项目。普通写作模式下，剧情事实与状态变化走 World Engine；需要推演和落库时使用 `novel-writing`（剧情设计与拍板落库环节），不要把 `simulation/subjects` 或 `simulation/runs` 当作写作状态源。

本 skill 负责推进一个世界运行 tick。当前落地目录仍是 `simulation/`；不要新建 `emulation/` 目录，除非用户明确要求做目录迁移。新 profile 链路下，优先创建或复用 `simulator.leader` 执行世界推演和状态裁决。

## 适用边界

适合使用：

- 剧情推进和下一 tick 设计。
- 角色、势力、地点、环境、资源或制度惯性的自然反应。
- 信息差、隐藏状态、物品持有、伤势、机关、门锁、倒计时等可变事实。
- 写后状态提交。

通常跳过：

- 写简介、标题、推荐语。
- 单纯整理稳定 lorebook。
- 不改变事件结果的润色。
- 局部改句子、改文风、改排版。

## 执行顺序

1. 确认 trigger：用户指令、leader 自动判断、RP Tick，还是写后提交。
2. 确认 goal、world time before / after、地点、参与 subjects、参与 entities 和模拟范围。
3. 如果 `simulator.leader` profile 可用，把本 tick 目标、范围和允许写入的 simulation 路径交给它；由它返回 world_state_report、writer_safe_brief、director_handoff、plot_handoff 和 open_questions。
4. 读取必要 lorebook、Plot、manuscript 摘要和当前 `simulation/subjects/*` / `simulation/entities/*` state。
5. 推演 2 到 3 条与本 tick 相关的因果链。因果链来自资源、环境、势力、人物选择、制度、异常规则或随机变量。
6. 可加入少量随机扰动；重大随机结果影响主线前先让用户确认，或写入 Open Questions。
7. 裁决本 tick 已经发生的事实，区分：
   - subject 视角事件 / 知识 / 心理候选。
   - 真实 subject state。
   - 真实 entity state。
   - Plot handoff 候选。
8. 创建 `simulation/runs/ticks/{id}-{slug}/report.md`。
9. 如果本 tick 有用户可见正文、RP 正文或试写片段，创建 `simulation/runs/ticks/{id}-{slug}/prose.md`。
10. 写入已裁决的 subject `state.md` 和必要 `simulation/entities/**`。subject `events.jsonl`、`memory.jsonl`、`mind.md` 可由对应 actor sidecar 维护；没有 sidecar 时，leader 可按 report 中的 subject-facing 信息谨慎写入。
11. 更新 `simulation/runs/current.md` 和 `simulation/runs/index.md`。

## report.md 推荐结构

```md
---
type: emulation-run-report
runId: 000001-short-slug
mode: writing-design
status: draft
worldTimeBefore: ""
worldTimeAfter: ""
---

# 000001 Short Slug

## Trigger

## Goal

## Scope

## Inputs

## Prior State

## Active Subjects

## Active Entities

## Hidden Facts

## Causal Chains

## Random Disturbances

## Adjudicated Events

## Subject Updates

## Entity Updates

## Information Boundary

## Plot Consequences

## Writer-safe Brief

## Commits

## Open Questions

## Next Hooks
```

`Writer-safe Brief` 只能包含可写信息。不要把 GM scratch、隐藏真相或 actor 私密意图直接交给 writer。

## prose.md 规则

- RP Tick：保存 `rp.writer` 或 leader 输出给用户的完整正文。
- 写作设计 Tick：可保存试写片段、场景草稿或用户可读推演结果。
- 正式章节写作：章节正文仍写入 `manuscript/.../index.md`；`prose.md` 可只放摘要和目标章节链接。
- `prose.md` 不保存后台裁决、commit 说明或隐藏真相。

## 完成标准

- tick 目录名使用 `000001-short-slug` 形式。
- `report.md` 记录触发、输入、因果链、裁决、信息边界、状态提交和下一步钩子。
- 需要用户可见正文时，`prose.md` 单独保存正文。
- 已裁决状态写回 `simulation/subjects/` 或 `simulation/entities/`。
- 旧 Plot System 结果只列为 legacy handoff，并交给对应旧流程整理，不混在 prose 里。
