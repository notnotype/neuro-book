# NeuroBook Agent 入口

NeuroBook 是本地优先的长篇写作工作区；作品文件、SQLite、Agent 会话和工作流都是可审查的产品数据。本文件是开发 Agent 的仓库入口。产品自身的 NeuroBook Agent Runtime 是另一套系统；人类贡献流程见 [`CONTRIBUTING.md`](CONTRIBUTING.md)。

## Core Rules

- 默认使用简体中文与用户交互。
- 修复和重构应解决合同或设计问题，不用 hack 绕过类型系统或制造技术债；不能兼容时说明取舍
- 单点修改使用文件编辑工具。批量替换必须先 dry run；命中不确定或出现意外结果时改为逐处编辑，并报告实际修改的文件
- A comment states the non-obvious reason at the owning boundary. Include a constraint or invalidation condition only when a maintainer needs it to know when the rationale or code stops being valid. Do not restate the operation, preserve intermediate attempts, or list speculative future work.
- 对 AGENTS.md 也就本文件的约束保持怀疑，随着项目的演变，这个文件可能变得不是很权威，有错误。这个文件是 AGENTS.md 人类共建的，需要不断优化，工作过程中如果遇到某些地方不好的可以随时询问开发者要求优化
- 写下来的代码是给其他人类和 Agents 阅读的，所以注释、可维护性和可理解性非常重要

## Conventions

- 仅问答、审查、诊断默认只读；用户明确要求修复或修改后，完成授权范围内的改动与验证。缺少运行证据时标明“从代码推断”或“未验证”。
- 不为可逆、影响小的改动强制写测试；涉及核心逻辑、边界或无把握时仍应补充测试。
- 主 Agent 对当前目标负责，可直接调查、实现和验证；只有独立且值得委派的切片才交给子代理。高风险变更按需独立审查，不设正式角色或强制交接。
- 按当前问题选择能补足缺失知识的最具体 Skill；已加载且未变化的材料不重读，多技能检查按目的去重。验证与停止条件统一见 [`docs/testing/README.md#验证门禁`](docs/testing/README.md#验证门禁)，不叠加通用生命周期门禁。

## 了解开发者

- 使用中文、结论先行，以可观察行为和影响解释判断；长任务必要时简短回顾目标。
- 不用罕见符号代替中文词；代码、JSON、命令和记法定义本身的符号不受此限。
- 从请求和既有上下文判断意图，可查事实自行查明。只把改变产品结果、范围、权限或不可逆后果的问题交给开发者，并说明背景和取舍；低风险细节沿用现有模式，重大假设简短说明。
- 关于 advisor：advisor 不是我，是 omp 中监督你工作的另一个 agent。敢于质疑 advisor。可以参考它的建议，但最终决定权在你自己，他的回复不代表开发者的回复，不要把回复他当做最终回复，也不要因为他的回复而扩大你的任务范围
- 回复中的文件引用使用绝对路径或者相对于当前工作目录的相对路径

## 真实模型调用与样本数据

- **小说数据**：小说、章节正文、小说相关提示词、摘要和研究产物不属于敏感数据，可按 Task 允许文件进入 Git；密钥、个人数据、商业秘密和用户明确要求保密的内容仍按敏感数据处理。第三方素材保持只读，来源与归一化版本按 Task 登记。

## 仓库结构与文件路由

下面是职责与数据边界地图，不是完整文件清单。包边界正文见 [`docs/modules/monorepo-boundaries.md`](docs/modules/monorepo-boundaries.md)。

```text
neuro-book/
├── packages/                       # Bun workspace；共同规则 packages/AGENTS.md
│   ├── neuro-book/                 # Nuxt 主应用、Prisma、Agent Runtime、Project Workspace 与应用测试
│   │   ├── docs/                   # 主应用专属文档
│   │   ├── assets/reference/       # 运行期 Reference 的 canonical 源
│   │   └── assets/workspace/       # 内置 workspace 资产与产品 Skill 的 canonical 源
│   ├── neuro-book-manager/         # 安装、运行、工具链与升级
│   ├── neuro-agent-harness/        # 会话、Profile、工具与事件恢复
│   ├── neuro-book-contracts/       # 跨包类型与合同
│   ├── nb-memory/                  # episode、facts 与主体注册表
│   ├── nb-history/                 # 操作日志、事件溯源与内容寻址快照
│   ├── nb-workflow/                # 可重放的脚本化 Workflow Kernel
│   ├── nb-ui/                      # 共享 Vue/Nuxt UI 基础组件
│   ├── llmlint/skill/              # llmlint Skill 单一源；产品投影由此生成
│   ├── owned-process/             # 受管子进程托管
│   ├── file-snapshot-cache/        # 文件快照缓存
│   └── neuro-book-test-support/    # 系统临时根与 fixture 支持
├── desktop/                        # Electron、Tauri、共享桥与打包入口
├── scripts/                        # 仓库自动化；release/ 有独立发布合同
├── docs/                           # monorepo 级文档治理
│   ├── specs/                     # capability 登记与产品行为合同
│   ├── proposals/                 # 尚未生效的待决策提案
│   ├── modules/                   # 已登记模块边界
│   ├── standards/                 # 编码规范与仓库协作流程
│   └── testing/                   # 测试、临时根和验收证据合同
├── vitepress/                      # 用户文档站投影与 changelog，非内部真相源
├── .agents/                        # 开发 Agent 治理，区别于产品 Agent Runtime
│   ├── works/                     # current Work 及其直接 Task
│   ├── tasks/                     # legacy Task archive 与历史 provenance
│   └── skills/                    # 开发 Agent Skill，非产品运行时资产
├── .omp/RULES.md                   # 宿主加载的项目核心规则摘要
├── .worktree/                      # 分支实现 checkout，不放业务临时数据
├── server/                         # 以仓库根运行产品时的本机生成态，非 canonical 源码
├── assets/workspace/               # 本机 State Root 资产，非内置资产源
├── workspace/                      # 用户作品数据，不入库
├── logs/                           # 本机运行日志
└── .local/                         # 用户管理的本地草稿、数据集与下载缓存
```

首次处理任务、范围变化或恢复缺失上下文时，按下表读取所需部分；同一会话已加载且未变化的规则不重复读取。修改目标前仍读取目标文件。

| 任务范围 | 追加读取 |
|---|---|
| 创建、推进或恢复 current 工作 | [`.agents/works/AGENTS.md`](.agents/works/AGENTS.md)、具体 Work 与 Task；修复历史 provenance 时追加读 [`.agents/tasks/AGENTS.md`](.agents/tasks/AGENTS.md)；只读问答不新建 Work |
| 测试、fixture、验收、缓存、临时数据 | [`docs/testing/README.md`](docs/testing/README.md) |
| 新功能、bug 期望不明确或长期行为变化 | [`docs/proposals/README.md`](docs/proposals/README.md)、[`docs/specs/AGENTS.md`](docs/specs/AGENTS.md)、相关 Spec 与 ADR |
| 源码、脚本、schema 或 migration | [`docs/standards/code/README.md`](docs/standards/code/README.md)；按改动路径只读取表中列出的领域与语言规范 |
| Git 分支、worktree、提交、PR、合并或发布操作 | [`.agents/skills/repository-workflow/SKILL.md`](.agents/skills/repository-workflow/SKILL.md)；Issue 元数据维护读 [`docs/standards/repository-workflow.md`](docs/standards/repository-workflow.md)，公开贡献再读 [`CONTRIBUTING.md`](CONTRIBUTING.md) |
| 前端、服务端、桌面、数据库、脚本、发布、包 | [`packages/neuro-book/AGENTS.md`](packages/neuro-book/AGENTS.md)、[`packages/neuro-book/server/AGENTS.md`](packages/neuro-book/server/AGENTS.md)、[`packages/neuro-book/prisma/AGENTS.md`](packages/neuro-book/prisma/AGENTS.md)、[`desktop/AGENTS.md`](desktop/AGENTS.md)、[`scripts/AGENTS.md`](scripts/AGENTS.md)、[`scripts/release/AGENTS.md`](scripts/release/AGENTS.md)、[`packages/AGENTS.md`](packages/AGENTS.md) 中匹配的最近入口 |
| Agent 消费的规则、Skill、AGENTS.md 或 CLAUDE.md | [`.agents/skills/writing-for-agents/SKILL.md`](.agents/skills/writing-for-agents/SKILL.md)；修改 Skill 时再读同目录 `SKILL-MECHANICS.md` |

## Git 注意事项

- Git 完整流程见 [`docs/standards/repository-workflow.md`](docs/standards/repository-workflow.md)。主工作区保持 `master`，保护用户已有改动和未跟踪文件。
- 代码改动在 worktree 完成；治理文档和用户明确指定的主工作区改动可以直接在当前工作区完成。只暂存 Task 范围文件，不使用 `git add -A`。
- 远端只读访问（Issue、PR、CI 状态、仓库元数据与日志）不需要单独授权，按最小必要字段与最新结果读取；远端写入、push、合并、Issue/Project 状态变更仍需明确授权。
- 统一评审通过后，获对应远端元数据授权的执行者才能把 Issue 项目条目标为 Done。
- 命令从相应 `package.json` 查询。Bun 的 `--cwd` 必须放在 `run` 之后；`bun --cwd <dir> run <script>` 可能只打印用法并以 0 退出。

## 文档真相源

行为、状态、数据、接口、失败语义和验收依据以 [`docs/specs/`](docs/specs/) 为准；架构取舍以 ADR 为准；迁移步骤以 `packages/neuro-book/docs/migrations/` 为准；测试、临时根和证据以 [`docs/testing/`](docs/testing/) 为准；一次实现的 current 范围、授权与快照以 [`.agents/works/`](.agents/works/) 为准，历史 provenance 以 [`.agents/tasks/`](.agents/tasks/) 为准。入口文件只写职责、触发条件和链接，不复制下级正文。

当前仓库状态以 [`PROJECT-STATUS.md`](PROJECT-STATUS.md) 为准；运行期 Reference 以 [`packages/neuro-book/assets/reference/`](packages/neuro-book/assets/reference/) 为准。`RELEASE.md` 和 `WATCHDOG.md` 是机器与审查入口，不属于普通产品规范。

`CLAUDE.md` 仅兼容指向本文件。`WATCHDOG.md` 是 advisor 复核清单，不进入主 Agent 普通上下文。`RELEASE.md` 是发布程序消费的当前版本载荷；完整发布规则见 [`scripts/release/AGENTS.md`](scripts/release/AGENTS.md)。
