# 开发 Agent Skills

这里保存开发 Agent 的仓库内 Skill 适配层，不是产品运行时资产。

current Work/Task 以 [工作入口](../works/AGENTS.md) 为准，legacy provenance 以 [历史入口](../tasks/AGENTS.md) 为准。按当前问题选择能补足缺失知识的最具体 Skill；已加载未变化的材料不重读，检查按目的去重，验证统一见 [测试规范](../../docs/testing/README.md#验证门禁)。

- [doc-review](doc-review/SKILL.md)：目标读者视角的可理解性、歧义与链接审查，按需独立复核。
- [diagnosing-bugs](diagnosing-bugs/SKILL.md)：复杂故障或性能回退诊断。
- [ui-development](ui-development/SKILL.md)：UI 界面与组件开发的真相源路由、组件复用决策、UI 专属检查与回写位置。
- [design-review](design-review/SKILL.md)：新界面或界面大改要开发者拍板时的注意力排序、草稿 worktree 里的静态稿、本机 HTML 评审板与决定记录。
- [implementation-planning](implementation-planning/SKILL.md)：实现非平凡 Task 前写实施计划（plan.md），交开发者确认后再实施。
- [reviewing](reviewing/SKILL.md)：审查设计稿或一段实现；默认请另一个模型独立审查，可交叉审查，逐条核实后再修改。
- [autonomous-delivery](autonomous-delivery/SKILL.md)：只在开发者显式指定时用：开发者不在场时按“计划 → 设计审查 → 实施 → 实现审查（不阻塞）→ 下一步”自主推进 Work，待确认的点记账事后追认。
- [writing-specs](writing-specs/SKILL.md)：新建或修改 Spec：能力边界、先列假设、黑盒合同与交互时序、编号验收、实现合同与证据。

新增或修改 Skill 时：`name` 保持稳定；`description` 简述用途与触发条件，供宿主发现，不罗列同义触发词抢占其它 Skill；参数型入口用 `argument-hint` 说明参数。`disable-model-invocation: true` 只关闭模型自动调用，不限制文件读取。只有独立触发用途值得长期维护时才新建 Skill，共享参考能放进已有文件就复用。

通用 Skill 在宿主允许范围内服务当前请求，服从根规则、当前合同和授权，不另立审批或完成门禁。项目不依赖特定 Code Agent 宿主。

## 反思回写

回写的通用做法在用户级 Skill `task-reflection`（`~/.agents/skills/task-reflection/`）。没装它的宿主照本节和根 `AGENTS.md` 的约定，直接写入并在交付末尾列出写了什么，不等开发者批准（开发者 2026-11-17 定；这条盖过用户级 Skill 里“经批准再写”的写法）。本仓库的回写位置：

| 内容 | 写到 |
|---|---|
| UI 与组件的知识 | 按 [UI 开发](ui-development/SKILL.md#反思回写) 的分工 |
| 规范、合同、架构取舍 | 根 [`AGENTS.md`](../../AGENTS.md) “文档真相源”指向的位置，不新建平行文档 |
| 要开发的工作流改进 | 经 `nbdev task new` 建 planned Task，或写进对应 Work 的后续清单（例如 w00022 的 `followups.md`） |
| 仓库内 Skill 的经验 | 对应的 `.agents/skills/<名>/`，按上面“新增或修改 Skill”的规则改 |
| 只对 Agent 自己有用的踩坑 | Agent 自己的记忆，不建 `.agents/memory` |

写入后按 [验证门禁](../../docs/testing/README.md#验证门禁) 检查链接与结构。

产品 Skill 属于产品资产，不要把开发治理混入其中。旧应用的产品 Skill 位于 `packages/neuro-book-legacy/assets/workspace/.nbook/agent/skills/`，只作参照；新应用的产品资产位置随 Agent 插件迁回时确定。
