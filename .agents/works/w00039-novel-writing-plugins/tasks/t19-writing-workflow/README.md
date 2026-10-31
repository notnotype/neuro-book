---
schema: nbook.task/v2
taskId: t19-writing-workflow
status: planned
updated: 2026-10-31
---

# 写作流程与内置 Profile

## 目标与范围

定从构思到成章的整体流程、各环节由人还是哪个 Agent 做，以及由此得出的内置 Profile 与 Skill。Profile 清单就是流程里的角色分工，一起定。

合同：讨论 Task，只定设计，行为合同未变；定稿后的 Spec 改动在实施时另定。

前置：t02、t06。

## 要讨论的问题

### 写作流程

1. 环节：构思与设定 → 大纲与剧情线 → 场景分章 → 章级 brief → 写正文 → 抽取 → 对齐与修订。旧版“设计、确认、写 World、更新 Plot、写作”四阶段（`assets/reference/world-engine/workflow.md`）哪些留。
2. 作者不按流程走时（直接写正文、事后补设定）各功能是否还能用；最小可用路径是什么。
3. 正文写完后，状态变动、知情这些作者层记录由谁维护：作者手填、Agent 从正文提议、直接用抽取结果。
4. 人在环节之间的确认点：哪些写入要审批（接 w00032 t06 默认写入要审批）。

### 小说创作的内置 Profile 与 Skill（原 t23）

1. Profile 清单与各自的工具、权限；插件贡献 Profile 的方式（w00032 t05 三层）。
2. 旧版 leader、writer 两个 Profile 与其记忆文件的去留。
3. Skill：nb-story 的 Skill 已有；设定、剧情工坊要不要 Skill；第一版 Skill 只由用户 `$` 触发（w00032 t15）。
4. 提示词按 `docs/standards/prompts.md`（w00032 t18 定）写；评测接 t26。

材料：[调研：三节](../../research/2026-10-31-repo-survey.md)；w00032 t05、t15、t18。

## 当前状态

2026-10-31 由 t01 问题发现建为草稿；同日按开发者要求并入 t23（一次讨论能一起定下来）。尚未讨论。

## 下一步

按 Work README 的讨论顺序轮到时讨论；讨论定的事写进本 README 的“当前状态”。
