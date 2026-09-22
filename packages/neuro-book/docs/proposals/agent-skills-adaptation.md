# Agent Skills 项目化适配提案

状态：accepted

> 2026-09-21 当前适配已由 [P-005 最新决策](../../../../docs/proposals/p-005-development-workflow-governance.md#2026-09-21-当前决策)、[Work 入口](../../../../.agents/works/README.md)、[技能索引](../../../../.agents/skills/README.md) 和 [测试规范](../../../../docs/testing/README.md#验证门禁) 取代。以下旧生命周期、角色、字段和当时验证结果仅保留为历史，不再作为当前合同或机器门禁；当前入口不依赖缺失的通用 DoD。

## 问题

NeuroBook 已有 PM、Leader、Tasker、Reviewer、Proposal、Spec、Task、walkthrough、evidence 和治理命令。通用 Agent Skills 可以补充需求澄清、增量实现、测试驱动、诊断、浏览器验收和代码审查等执行方法，但它的默认文件落点、完成定义和授权假设与本项目不完全一致。

如果直接照搬，可能同时产生第二套 Spec、Task、计划和完成定义；如果完全不适配，技能选择继续依赖 Agent 临场判断，Bug 反馈回路、浏览器 runtime 验收和高风险审查容易漏项。本提案只讨论开发 Agent 治理适配，不改变 NeuroBook 产品运行时的 Skill 资产协议。

## 当前证据与边界

当前项目的真相源分工是：

- 根 `AGENTS.md` 与 `.omp/RULES.md`：授权、范围、协作、安全和报告边界。
- `docs/specs/`：已批准目标合同与当前行为合同。
- `docs/proposals/`：尚未生效、需要评审的长期方案。
- GitHub Issue / Project：公开需求、实现授权、优先级和交付状态。
- `.agents/tasks/`：一次实现的上下文、步骤、状态、walkthrough 和正式证据。
- `docs/testing/README.md`：测试、临时根、验收和证据规则。
- `scripts/ci/agent-governance.ts` 与 `scripts/ci/check-documentation.ts`：结构性治理检查。

现有治理检查已验证通过：`bun run governance:check` 返回 `failures: []`、`warnings: []`；`bun run docs:check` 返回 `failures: []`。这些检查证明目录、链接、Task owner 和文档结构约束有效，但不判断任务是否选择了合适的执行 Skill。

通用 `using-agent-skills` 的完成门槛指向 `../../references/definition-of-done.md`。当前 `C:/Users/notnotype/.claude/references/` 与仓库内均不存在该文件，因此它不是可执行的项目完成定义。本项目不得把该缺失路径当作依据，也不得由本提案创建第二份独立 DoD；完成门槛必须映射到上述现有规则、测试规范、Task 合同、角色合同和治理命令。

本提案不授权远端写入、发布、部署、数据库迁移、真实 Provider/Model、浏览器人工验收或数据删除。产品运行时的 `assets/workspace/.nbook/agent/skills/` 与开发治理 `.agents/skills/` 继续是两个不同边界。

## 目标与非目标

目标：

1. 让 Agent 能按任务类型选择最小充分的通用 Skill 组合，而不是默认执行完整生命周期。
2. 把 Spec-first、增量切片、Bug 的可变红反馈回路、独立审查和风险匹配验证接入现有 Task 流程。
3. 让 Task 记录 required / not-run 验证画像，实际命令、结果、revision、环境和产物仍归 walkthrough / evidence。
4. 用治理测试保护 Proposal 生效闸门、Task 验证画像结构和 `.agents/skills/**/*.md` 的文档路由。
5. 明确项目现有完成门槛与通用 Skill 的对应关系，避免任何人误以为存在第二个可用 DoD。

非目标：

- 不替换 PM / Leader / Tasker / Reviewer。
- 不创建 `SPEC-*.md`、`tasks/plan.md`、`tasks/todo.md` 或新的 Task/DoD 真相源。
- 不批量改写历史 Task，不把 Issue、Project 的优先级、模块或标签复制进 Task。
- 不强制每个任务经过完整的 interview、Spec、TDD、浏览器、发布链。
- 不改变产品运行时 Skill、Workflow、Profile 的安装、加载和投影行为。

## 方案、备选方案和取舍

### 方案 A：项目化适配层（建议）

保留项目规则和真相源，把通用 Skill 作为按任务类型触发的执行手册。新增一个开发治理路由 Skill，给现有 Task 合同增加可选验证画像，并把关键结构约束加入治理测试。新任务和重新打开的任务使用画像，历史任务保持兼容。

收益是减少 Agent 选择方差，同时避免双重记账。代价是需要维护一张路由矩阵，并让 Reviewer 核对画像是否与实际改动一致。

### 方案 B：全量照搬通用 Agent Skills 生命周期

每个任务都强制经过完整的访谈、方案、Spec、计划、任务、增量实现、TDD、审查和发布阶段。

这种方式会把低风险文档、机械迁移和局部重构过度流程化，并与项目的授权边界、风险匹配测试和现有文档真相源冲突。不采用。

### 方案 C：维持现状

不增加路由或验证画像，只继续依赖角色合同和 Agent 自行判断。

这种方式没有迁移成本，但不能稳定捕获任务类型与验证方式的错配。不采用。

## 预期流程

### 路由

- 需求不清或存在产品取舍：使用 `interview-me` / `idea-refine`，随后回到 Proposal。
- 新功能或长期可观察行为变化：使用 `spec-driven-development`、`planning-and-task-breakdown`、`incremental-implementation`、`test-driven-development` 和 `code-review-and-quality`。
- Bug、失败、回归或性能异常：使用 `debugging-and-error-recovery`；先建立针对确切症状可变红的回路，再写回归测试和修复。
- 前端或浏览器行为：使用 `frontend-ui-engineering`；只有获得授权时才执行 `browser-testing-with-devtools`，并单独记录浏览器证据。
- API、DTO、模块边界或公开接口：追加 `api-and-interface-design`，必要时使用 `source-driven-development`。
- 安全、凭据、权限或外部输入：追加 `security-and-hardening`。
- 性能目标或回归：追加 `performance-optimization`，先做基线测量。
- 纯内部重构：使用 `incremental-implementation`、`code-simplification` 和 `code-review-and-quality`，先证明可观察行为不变。
- Skill、`AGENTS.md`、CLAUDE 兼容入口或其他 Agent 文档：使用 `writing-for-agents`。
- Git、CI/CD、迁移、发布和上线：只在现有授权边界内追加对应专项 Skill。

纯文档、机械迁移和无行为变化的局部重构使用精简路径，但仍遵守已有 Task、文档、diff 和审查门禁。

### 完成门槛映射

- 目标、范围、批准和破坏性动作：根 `AGENTS.md`、`.omp/RULES.md`、PM / Leader / Tasker / Reviewer 合同。
- 当前行为和长期合同：`docs/specs/README.md` 登记的同一 capability Spec。
- 测试、fixture、临时数据、浏览器验收和证据脱敏：`docs/testing/README.md`。
- Task 状态、上下文、walkthrough、evidence、未运行项和交接：`.agents/tasks/README.md`、`.agents/tasks/AGENTS.md`。
- 文档结构与相对链接：`bun run docs:check`。
- 治理入口、owner、迁移和边界：`bun run governance:check`。
- 语义是否满足合同：Reviewer 独立复核。

通用 Skill 中的 `../../references/definition-of-done.md` 不属于上述映射，不读取、不引用、不作为通过条件。

## 对 Spec 的预期改动

本提案本身不改变产品可观察行为，不创建新的产品 capability，也不创建 `planned` Spec。若后续实现证明开发治理适配会改变产品行为、数据、公开接口、安全边界或发布承诺，必须另行回到 Proposal / Spec 流程，不能由本提案隐式授权。

## 对 Task 与治理流程的预期改动

Proposal 被人类接受后，当前 `nbook.task/v1` Task README frontmatter 使用 `agentWorkflow` 对象：

```yaml
agentWorkflow:
  profile: nbook.agent-skills/v1
  kind: bug
  routes:
    - diagnosing-bugs
    - test-driven-development
    - code-review-and-quality
  verification:
    required:
      - regression-test
      - focused-test
      - diff-check
    notRun: []
```

`kind`限定为`feedback`、`design`、`research`、`bug`、`feature`、`refactor`、`docs`、`release`、`migration`。所有活动Task都必须声明Agent工作、开发者参与、任务产物、修改计划、完成门禁、Leader继续条件和允许文件；Agent主导执行，开发者只在明示节点完成设计、实际观察/验证、产品判断、风险接受或受限动作授权。

`research`追加研究问题、研究产物和决策范围；声明allowlist与本Task研究产物集合一致，active research首次进入HEAD后固定kind、状态和研究产物，并检查owner scope当前staged、unstaged、untracked实际路径，Task README/context只作为Leader实际diff例外。`design`追加明确单行设计类型、唯一Proposal/Spec设计产物、决策范围和允许文件，context记录唯一`基线 revision`；首次提交的活跃Design合同密封执行身份、Git基线、产物和allowlist，后续不能扩大或关闭真实diff门禁。

`verification.required`记录必须真实执行或报告不可执行的检查；`verification.notRun`只表示不适用且必须有具体原因。`actionIssueId`显式为正整数或`null`，由Task是否属于重大Issue交付范围决定，不按root或owner分叉。

治理代码检查Proposal状态、两个Skill入口、Task画像、人机协作章节、自治包当前v1 Task、历史迁移身份、`actionIssueId`、research/design专属合同、active research owner-scope当前工作树、Design真实diff、required/notRun冲突，以及Leader派发后停止和按结果创建下一Task的反向语义。历史Task不批量回填当前章节。

## 数据、接口、安全、迁移、发布与回滚影响

本提案不改变产品数据、数据库 schema、网络接口、运行时资产、用户 Workspace 或发布资产。新增内容属于仓库内 Markdown、Task frontmatter 约定和治理检查输入。

路由 Skill 不得授权浏览器、真实 Provider/Model、远端写入、发布、部署、迁移或数据删除；这些动作仍由根规则和现有角色合同控制。通用 Skill 与项目规则冲突时保留项目规则，不执行 `git reset --hard` 等破坏性回退，不使用静默 fallback 掩盖边界，不把 focused test、静态分析、浏览器或真实 Provider 验收相互替代。

Proposal 若被接受后仍可在实现前撤回：删除或标记为 `rejected` / `superseded` 时，路由、画像和治理适配不得继续生效。实现完成后若要撤回，必须通过新的治理变更说明移除唯一入口和对应检查，不保留兼容 alias 或第二套路径。

## 决策记录

- 2026-08-21：创建本提案并经人类接受，状态为 `accepted`。
- 2026-08-21：接受项目化适配方案；路由 Skill、Task 画像、角色合同和治理门禁按本提案落地。
- 2026-08-26：审查修复收紧Task owner、notRun和Design密封真实diff合同，不新增第二套Task schema。
- 2026-08-27：Task协作合同改为Agent主导，增加`research` kind和八个活动Task章节；删除`issueRequired`与Task `draft`状态，统一使用可空`actionIssueId`，并将自治包当前v1 Task纳入同一治理门禁。
