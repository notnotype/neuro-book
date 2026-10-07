# NeuroBook Agent 入口

NeuroBook 是本地优先的长篇写作工作区；作品文件、SQLite、Agent 会话和工作流都是可审查的产品数据。本文件是开发 Agent 的仓库入口。产品自身的 NeuroBook Agent Runtime 是另一套系统；人类贡献流程见 [`CONTRIBUTING.md`](CONTRIBUTING.md)

当前分支正在按 [NeuroBook v2：并排重建应用](docs/proposals/neuro-book-v2-rebuild.md) 从零重建：`packages/neuro-book` 是新应用，`packages/neuro-book-legacy` 是旧应用，只作代码与行为参照，不在其中改代码

## Core Rules

- 默认使用简体中文与用户交互
- 修复和重构应解决合同或设计问题，不用 hack 绕过类型系统或制造技术债；不能兼容时说明取舍
- 单点修改使用文件编辑工具。批量替换必须先 dry run；命中不确定或出现意外结果时改为逐处编辑，并报告实际修改的文件
- 对 AGENTS.md 也就本文件的约束保持怀疑，随着项目的演变，这个文件可能变得不是很权威，有错误。这个文件是 AGENTS.md 人类共建的，需要不断优化，工作过程中如果遇到某些地方不好的可以随时询问开发者要求优化
- 写下来的代码是给其他人类和 Agents 阅读的，所以注释、可维护性和可理解性非常重要
- 文档与注释不用罕见符号代替中文词：引用章节写小节名或锚点链接，不写 `§`、`¶`；代码、JSON、命令和记法定义本身的符号不受此限。`governance:check` 对活跃 Markdown 里的 `§`、`¶` 给出警告

## Conventions

- 仅问答、审查、诊断默认只读；用户明确要求修复或修改后，完成授权范围内的改动与验证。缺少运行证据时标明“从代码推断”或“未验证”
- 主 Agent 对当前目标负责，可直接调查、实现和验证；只有独立且值得委派的切片才交给子代理。高风险变更按需独立审查，不设正式角色或强制交接
- 按当前问题选择能补足缺失知识的最具体 Skill；已加载且未变化的材料不重读，多技能检查按目的去重。验证与停止条件统一见 [`docs/testing/README.md#验证门禁`](docs/testing/README.md#验证门禁)，不叠加通用生命周期门禁
- 任务中出现意外失败或绕路、用户纠正做法或提出新规范、发现规范缺失或矛盾时，按 [`task-reflection`](.agents/skills/task-reflection/SKILL.md) 在交付时分类列出回写建议，经开发者批准后再写入

## 注释

细则见 [`docs/standards/code/common.md`](docs/standards/code/common.md#注释)

- 写代码里看不出来的东西：为什么这样做、调用方要遵守的约束、时序与所有权、让这条理由失效的条件；不复述代码在做什么，不保留中间尝试，不写推测的后续计划
- 最难懂的地方先写：读者要推演几个回调的先后才能看懂的代码，先试着改结构消除它，改不掉就写清楚先后
- 行为规则链接 Spec，不在注释里复述
- 用平常的中文和代码里的英文标识符；Promise 的状态写 resolve、reject、settle 或“完成”“失败”，不另造译名；一句只说一件事

## 测试

正文见 [`docs/testing/README.md`](docs/testing/README.md#测试写法)，写法规则由 `governance:check` 机检

- 测行为，不测实现：断言调用方或用户能观察到的结果；行为不变的重构让测试失败，说明测试写错了
- 先列验收场景与失败方式，再写实现；bug 修复补在暴露出缺口的那条行为的测试里，不另加只针对这个 bug 的测试
- 依赖能用真的就用真的，替身要与真实实现对过契约；等可观察的状态或注入时钟，不按固定时长等待
- 按受影响范围运行 `bun run test:affected`，不默认跑全量；真实模型测试放在 `*.llm.test.ts`，只用 `--tier llm` 或包脚本 `test:llm` 显式运行
- 低风险、可逆的小改动不为“有测试”而新增测试；核心逻辑、边界或没有把握时补测试

## 真实模型调用与样本数据

- **小说数据**：小说、章节正文、小说相关提示词、摘要和研究产物不属于敏感数据，可按 Task 允许文件进入 Git；密钥、个人数据、商业秘密和用户明确要求保密的内容仍按敏感数据处理。第三方素材保持只读，来源与归一化版本按 Task 登记

## 仓库结构与文件路由

下面是职责与数据边界地图，不是完整文件清单。包边界正文见 [`docs/modules/monorepo-boundaries.md`](docs/modules/monorepo-boundaries.md)

```text
neuro-book/
├── packages/                       # Bun workspace；共同规则 packages/AGENTS.md
│   ├── neuro-book/                 # 新应用（v2）：运行时底座 + workbench 底座，从零重建
│   ├── neuro-book-legacy/          # 旧应用（Nuxt），只作参照；依赖照装，不检查不修改
│   ├── nb-runtime/                 # 内核：生命周期、服务装配、插件、应用门禁、诊断；零依赖，前后端共用
│   ├── neuro-agent-harness/        # 已冻结，只服务 llmlint；待由 nb-harness 取代后退役
│   ├── nb-harness/                 # NeuroBook Agent harness 重构（w00002），将作为内置插件的基础
│   ├── nb-profile/                 # Profile 加载与 JSX 渲染（w00002）
│   ├── nb-session/                 # 会话日志（w00002）
│   ├── neuro-book-contracts/       # 跨包类型与合同（旧包依赖，交付链出口不再维护）
│   ├── nb-memory/                  # episode、facts 与主体注册表
│   ├── nb-history/                 # 操作日志、事件溯源与内容寻址快照
│   ├── nb-workflow/                # 可重放的脚本化 Workflow Kernel
│   ├── nb-ui/                      # 共享 Vue UI 基础组件
│   ├── llmlint/skill/              # llmlint Skill 单一源
│   ├── owned-process/              # 受管子进程托管
│   ├── file-snapshot-cache/        # 文件快照缓存
│   └── neuro-book-test-support/    # 系统临时根与 fixture 支持
├── scripts/                        # 仓库治理与自动化
├── docs/                           # monorepo 级文档治理
│   ├── specs/                     # capability 登记与产品行为合同
│   ├── proposals/                 # 尚未生效或已接受的设计提案
│   ├── adr/                       # 架构决策记录（0022 起；更早的在旧包）
│   ├── research/                  # 调研资料，非规范
│   ├── modules/                   # 已登记模块边界
│   ├── standards/                 # 编码规范与仓库协作流程
│   ├── testing/                   # 测试、临时根和验收证据合同
│   └── archived/                  # 旧应用时期的 Spec、规范与用户文档站，只作参照
├── .agents/                        # 开发 Agent 治理，区别于产品 Agent Runtime
│   ├── works/                     # current Work 及其直接 Task
│   ├── tasks/                     # legacy Task archive 与历史 provenance
│   └── skills/                    # 开发 Agent Skill，非产品运行时资产
├── .omp/RULES.md                   # 宿主加载的项目核心规则摘要
├── .worktree/                      # 分支实现 checkout，不放业务临时数据
└── .local/                         # 用户管理的本地草稿、数据集与下载缓存
```

首次处理任务、范围变化或恢复缺失上下文时，按下表读取所需部分；同一会话已加载且未变化的规则不重复读取。修改目标前仍读取目标文件

| 任务范围 | 追加读取 |
|---|---|
| 创建、推进或恢复 current 工作 | [`.agents/works/AGENTS.md`](.agents/works/AGENTS.md)、具体 Work 与 Task；修复历史 provenance 时追加读 [`.agents/tasks/AGENTS.md`](.agents/tasks/AGENTS.md)；只读问答不新建 Work |
| 测试、fixture、验收、缓存、临时数据 | [`docs/testing/README.md`](docs/testing/README.md) |
| 新功能、bug 期望不明确或长期行为变化 | [`docs/proposals/README.md`](docs/proposals/README.md)、[`docs/specs/AGENTS.md`](docs/specs/AGENTS.md)、相关 Spec 与 ADR |
| 源码、脚本、schema 或 migration | [`docs/standards/code/README.md`](docs/standards/code/README.md)；按改动路径只读取表中列出的领域与语言规范 |
| Git 分支、worktree、提交、PR、合并或发布操作 | [`.agents/skills/repository-workflow/SKILL.md`](.agents/skills/repository-workflow/SKILL.md)；Issue 元数据维护读 [`docs/standards/repository-workflow.md`](docs/standards/repository-workflow.md)，公开贡献再读 [`CONTRIBUTING.md`](CONTRIBUTING.md) |
| 前端、UI 界面、组件、样式或主题修改 | [`.agents/skills/ui-development/SKILL.md`](.agents/skills/ui-development/SKILL.md)、[`docs/standards/code/components.md`](docs/standards/code/components.md)、[`packages/nb-ui/docs/ui-development-spec.md`](packages/nb-ui/docs/ui-development-spec.md)；查改组件必读并列同名 `.md` |
| 新应用、脚本、包 | [`packages/neuro-book/AGENTS.md`](packages/neuro-book/AGENTS.md)、[`scripts/AGENTS.md`](scripts/AGENTS.md)、[`packages/AGENTS.md`](packages/AGENTS.md) 中匹配的最近入口 |
| 查旧应用的实现或行为 | [`packages/neuro-book-legacy/AGENTS.md`](packages/neuro-book-legacy/AGENTS.md)；只读，不在旧包里修改 |
| 新增或修改开发 Agent Skill | [`.agents/skills/README.md`](.agents/skills/README.md) |

## Git 注意事项

- Git 完整流程见 [`docs/standards/repository-workflow.md`](docs/standards/repository-workflow.md)。主工作区保持 `master`，保护用户已有改动和未跟踪文件
- 代码改动在 worktree 完成；治理文档和用户明确指定的主工作区改动可以直接在当前工作区完成。只暂存 Task 范围文件，不使用 `git add -A`
- 远端只读访问（Issue、PR、CI 状态、仓库元数据与日志）不需要单独授权，按最小必要字段与最新结果读取；远端写入、push、合并、Issue/Project 状态变更仍需明确授权
- 统一评审通过后，获对应远端元数据授权的执行者才能把 Issue 项目条目标为 Done
- 命令从相应 `package.json` 查询。Bun 的 `--cwd` 必须放在 `run` 之后；`bun --cwd <dir> run <script>` 可能只打印用法并以 0 退出

## 文档真相源

行为、状态、数据、接口、失败语义和验收依据以 [`docs/specs/`](docs/specs/) 为准；架构取舍以 [`docs/adr/`](docs/adr/README.md) 为准；测试、临时根和证据以 [`docs/testing/`](docs/testing/) 为准；一次实现的 current 范围、授权与快照以 [`.agents/works/`](.agents/works/) 为准，历史 provenance 以 [`.agents/tasks/`](.agents/tasks/) 为准。入口文件只写职责、触发条件和链接，不复制下级正文

当前仓库状态以 [`PROJECT-STATUS.md`](PROJECT-STATUS.md) 为准。`WATCHDOG.md` 是审查入口，不属于普通产品规范

`CLAUDE.md` 仅兼容指向本文件。`WATCHDOG.md` 是 advisor 复核清单，不进入主 Agent 普通上下文
