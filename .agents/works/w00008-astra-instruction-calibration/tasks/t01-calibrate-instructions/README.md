---
schema: nbook.task/v2
taskId: t01-calibrate-instructions
---

# 指令校准

## 目标与授权

用户授权原文：“可以，允许优化，提交修改推送”。随后批准实施计划。Leader 在独立 worktree 修改、验证并提交推送 docs/w00008-astra-instruction-calibration；不创建 PR、合并或发布。产品行为合同未变，不修改产品 Spec、全局 Skill 或产品运行时资产。

## 修改白名单

- `AGENTS.md`
- `.omp/RULES.md`
- `.agents/AGENTS.md`
- `.agents/works/README.md`
- `.agents/works/AGENTS.md`
- `.agents/roles/leader/AGENTS.md`
- `.agents/roles/tasker/AGENTS.md`
- `.agents/skills/load_role/SKILL.md`
- `docs/testing/README.md`
- `docs/standards/repository-workflow.md`
- `.agents/skills/report/SKILL.md`
- `.agents/skills/doc-review/SKILL.md`
- `.agents/skills/diagnosing-bugs/SKILL.md`
- `.agents/skills/writing-for-agents/SKILL.md`
- `.agents/skills/writing-for-agents/SKILL-MECHANICS.md`
- `.agents/skills/README.md`

另新增本 Work、Task 和 walkthrough。保留主工作区用户文件。

### 后续授权补充

用户先要求恢复代码地图，随后明确“可以给项目补充这个规则”：Work 编号由主工作区唯一分配者串行登记，执行记录跟随实现分支，并定义撞号处理。范围追加 `.agents/works/README.md`、`.agents/works/AGENTS.md` 和 Leader 入口；不实现分配工具、不修改 schema、不迁移现有编号。沿用本任务提交与推送授权，不包含 PR 或合并。

本轮验证：`bun run docs:check` 通过（5396 个文件）；`bun run governance:check` 仅报告此前已核实的 w00003/t14 缺少 README 既有失败，warnings 为空。语义核对覆盖并行取号、跨机器协调、实现记录单一维护和撞号修正；本轮只补规则，不宣称已有自动锁或序号唯一性检查。

## 实施与验收

精简重复读取、提问、委派和固定测试步骤；保留真实授权边界。运行 docs:check、governance:check、governance:context 和暂存 diff 检查；走查只读、错字修改、bug 修复、检查完成、受限动作、推送状态六个场景。不运行产品测试或模型实验。

## 来源

- [OpenAI 模型指导](https://developers.openai.com/api/docs/guides/latest-model)
- [Eric Provencher 原文](https://x.com/pvncher/status/2095991462416490862)

实际交付证据写入 walkthrough。
