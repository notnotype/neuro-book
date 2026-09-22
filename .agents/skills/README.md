# 开发 Agent Skills

这里保存开发 Agent 的仓库内 Skill 适配层，不是产品运行时资产。

current Work/Task 以 [工作入口](../works/AGENTS.md) 为准，legacy provenance 以 [历史入口](../tasks/AGENTS.md) 为准。按当前问题选择能补足缺失知识的最具体 Skill；已加载未变化的材料不重读，检查按目的去重，验证统一见 [测试规范](../../docs/testing/README.md#验证门禁)。

- [report](report/SKILL.md)：长任务交接、阻塞或当前交付证据。
- [leader](leader/SKILL.md)：用户要求统筹、长任务恢复或值得并行的独立切片；主 Agent 仍可直接实现。
- [repository-workflow](repository-workflow/SKILL.md)：Git 分支、worktree、提交、PR、合并与发布操作；普通编码不触发。
- [doc-review](doc-review/SKILL.md)：目标读者视角的可理解性、歧义与链接审查，按需独立复核。
- [diagnosing-bugs](diagnosing-bugs/SKILL.md)：复杂故障或性能回退诊断。
- [writing-for-agents](writing-for-agents/SKILL.md)：规则与 Skill 写作；Skill 调用说明见 [SKILL-MECHANICS.md](writing-for-agents/SKILL-MECHANICS.md)。

通用 Skill 在宿主允许范围内服务当前请求，服从根规则、当前合同和授权，不另立审批或完成门禁。项目不依赖特定 Code Agent 宿主。

产品 Skill 的 canonical 路径为 `packages/neuro-book/assets/workspace/.nbook/agent/skills/`，不要把开发治理混入产品资产。
