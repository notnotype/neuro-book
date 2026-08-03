# 参与 NeuroBook 开发

[English](CONTRIBUTING.en.md)

感谢你愿意改进 NeuroBook。本指南说明从提出问题到提交 Pull Request（PR）的完整流程。仓库仍处于快速开发阶段，清楚的范围、真实的验证结果和可追溯的设计决定，比一次提交尽可能多的改动更重要。

## 开始之前

请选择与改动规模相符的入口：

- 拼写、失效链接和不改变含义的小型文档修正可以直接提交 PR。
- 边界明确的小 Bug 应关联现有 Issue；没有对应 Issue 时，请提交“错误报告”。
- 新功能、跨模块修改、数据结构调整、运行时合同变化和高成本重构必须先提交“功能建议”。维护者将需求标记为 `status: ready` 后再开始实现。
- 优化或贡献 Profile、Skill、Workflow 和其它提示词时，请提交“提示词与内置 Agent 资产”。
- 安装或使用问题请提交“使用与安装问题”，不需要前往外部社区。
- 以上公开分类都不适用时，请使用“其它问题”结构化表单，不要借此绕过安全报告或必要的设计讨论。
- 安全漏洞不要创建公开 Issue 或 PR，请按照[安全政策](.github/SECURITY.md)使用 GitHub 私密漏洞报告。

冷门或实现成本很高的需求会先讨论能否缩小范围。Issue 被接受表示方向可以实现，不保证具体方案或完成时间。

## 本地开发

### 环境

- Git
- [Bun](https://bun.sh/)
- 能运行当前源码所需的操作系统工具；特定部署改动可能还需要 Docker、Podman 或对应平台设备

安装依赖并启动开发服务：

```bash
bun install
bun run dev
```

常用验证命令：

```bash
# 运行与改动最相关的测试
bun run test -- path/to/relevant.test.ts

# TypeScript 类型检查
bun run typecheck

# 全量测试
bun run test

# 构建中英文文档站
bun run docs:build

# 应用构建
bun run build
```

提交 PR 时，请列出实际执行的完整命令和结果。没有执行的检查必须写“未运行”；聚焦测试通过不能写成全量测试通过。

### 依赖与本地数据

- 统一使用 Bun。安装新依赖前先确认现有依赖是否已经能解决问题；确需新增时使用 Bun 安装当前最新版本。
- 不提交 `.env`、`config.yaml`、Project Workspace、小说正文、API Key、Session、Trace、日志、数据库、构建缓存或本机生成的基准原始结果。
- 不运行发布命令，不自行修改版本号，不创建 `chore(release)` 提交。
- 不提交第三方小说、提示词、文风样本或其它无权再分发的内容。

## 阅读项目上下文

开始修改前，按需阅读以下来源：

| 文档 | 用途 |
| --- | --- |
| [`AGENTS.md`](AGENTS.md) | 开发 Agent 和工程实现必须遵守的详细规则 |
| [`PROJECT-STATUS.md`](PROJECT-STATUS.md) | 当前模块状态、风险和长期 TODO |
| [`docs/tasks/`](docs/tasks/README.md) | 重大任务的目标、决策、过程、证据和偏差 |
| [`reference/`](reference/README.md) | 已经稳定的实现合同和领域术语 |
| [`docs/adr/`](docs/adr/) | 需要长期保留的架构决策 |
| [`RELEASE.md`](RELEASE.md) | 当前版本的用户可见变化，由维护者在发布流程中维护 |

请先搜索相关实现、测试、Task 和 Reference。不要只依据 Issue 标题或局部代码推断完整合同。

## 开发规范

以下是外部贡献最常遇到的稳定规则。更具体的 Vue、主题、通知、日志、Workspace 路径、Agent Runtime 和发布规则以 [`AGENTS.md`](AGENTS.md) 为准。

### TypeScript 与设计

- 使用严格类型和 `nbook/*` 绝对导入，不使用跨项目相对路径导入。
- 避免 `any`、`unknown` 和 `Record<string, unknown>`。外部未知输入确实需要 `unknown` 时，应在边界处校验并说明原因；使用 `any` 通常意味着设计需要重新讨论。
- JS/TS 使用 4 空格缩进。公开接口、类和函数应说明用途；复杂代码只添加能解释原因或约束的注释。
- 后端领域逻辑优先使用 class；前端优先使用函数、composable 和已有组件。
- 先复用现有库、组件和接口，不为单次调用制造抽象，也不通过 hack、类型绕过或临时兼容层掩盖设计问题。
- 项目处于快速开发阶段。不要为了未提出的旧数据或旧接口保留兼容代码。

### Vue 与用户体验

- 前端颜色使用现有主题变量，不新增 Tailwind 调色板类或 `dark:` 变体。
- API 错误、全局通知和可调整面板分别复用 `resolveApiErrorMessage()`、`useNotification()` 和 `useResizablePanel()`。
- 优先修改现有组件；组件接近 800 行或已经混合多个职责时，再按清晰边界拆分。
- 用户可见文案面向第一次使用 NeuroBook 的普通作者，不出现内部类名、文件名、Task 或 Phase 编号。
- 前端改动应说明桌面和窄屏影响，并在可运行时提供截图、录屏或浏览器验收结果。

### 日志、隐私与安全

- 使用结构化日志，不记录 API Key、Token、设备码、小说正文、完整提示词、Session 内容或未经脱敏的请求体。
- Issue 和 PR 都是公开页面。上传日志、截图和测试数据前必须脱敏。
- 文件和 Project Workspace 操作必须经过现有授权、路径归一化和 containment 边界，不要直接拼接用户路径绕过它们。

## 使用开发 Agent

本节中的“开发 Agent”指 Codex、Claude、Copilot 等协助开发本仓库的工具；“NeuroBook Agent”指产品自身的 Agent Runtime。两者不是同一个系统。

- 开发 Agent 开始前必须读取 `AGENTS.md`，以及相关 Issue、Task、Reference 和现有测试。
- 处理 Bug、报错或性能回归时，先复现、缩小范围并建立证据，再提出或实施修复。不要让 Agent 根据猜测直接修改业务代码。
- 多个 Agent 只能并行处理独立调研、审查、测试，或明确互不重叠的文件；必须有一个集成负责人统一处理跨模块合同、冲突、文档和最终验证。
- 不允许 Agent 覆盖工作区已有改动、绕过类型系统、伪造测试结果，或把当前对话里的临时要求直接写入产品提示词。
- 使用者必须理解、审查并承担 Agent 生成的全部改动。是否披露使用了哪种 AI 工具是自愿的，但责任不能转交给工具。
- Agent 的结论和 PR 描述应能追溯到代码、日志、Trace、请求或测试证据。未运行的验证要明确披露。

## Issue、Task 与架构记录

Issue 负责公开问题和需求分流；Task walkthrough 负责重大实现的持续上下文。Task 不是 Issue 的副本。TODO 与跟进事项的真相源是 Issue，不记录在 `PROJECT-STATUS.md`。

### 维护者分流

五个 Issue Form 会自动添加一个 `type:*` 和 `status: needs-triage`；提示词表单还会添加 `area: agent`。维护者分流时遵守以下状态合同：

- 每个开放 Issue 恰好保留一个 `type:*` 和一个 `status:*`；`area:*`、`platform:*` 可以按实际影响添加多个或不添加。
- `status: needs-triage` 表示等待首次确认。信息不足时转为 `status: needs-info`；报告者补充后重新分流。
- 方向、范围或合同未确定时使用 `status: needs-design`，此时不要开始实现。范围明确并得到维护者接受后转为 `status: ready`。
- 外部依赖或前置任务阻止继续时使用 `status: blocked`；阻塞解除后回到最符合当前情况的状态。
- `help wanted` 和 `good first issue` 只用于 `status: ready` 的 Issue。后者还必须范围小、上下文完整，并有可独立验证的验收条件。

`.github/labels.yml` 是标签清单真相源。维护者使用 `bun run github:labels -- check` 只读检查远端；使用 `bun run github:labels -- apply --yes` 创建或更新标签。清单外标签默认只报告，确认删除时才使用 `--delete-extra --yes`。标签改名必须先在 GitHub 原地重命名以保留历史关联，不要用“新建后删除旧标签”代替。

| 改动类型 | Issue | Task walkthrough | `PROJECT-STATUS.md` |
| --- | --- | --- | --- |
| 拼写或小型文档修正 | 可选 | 不需要 | 不需要 |
| 单点 Bug 或小功能 | 需要 | 通常不新建；已有相关 Task 时更新 | 模块状态未变化时不需要 |
| 中型功能或跨组件修改 | 需要且已接受 | 由维护者决定复用或创建 | 模块状态改变时更新 |
| 跨模块、架构或长期任务 | 必须 | 必须 | 必须 |
| 发布、安装、迁移或数据生命周期 | 必须 | 必须复用相关 Task | 必须 |

- 外部贡献者默认不要自行创建 Task 编号。需要新建时由维护者先检查 `docs/tasks/` 并确认下一个编号，避免并发撞号。
- 同一功能的后续调整继续更新原 Task，不建立碎片化 Task。
- Task 至少记录目标、当前状态、关键决定、验证、实现过程、实际偏差和后续事项。
- 稳定合同进入 `reference/`；需要长期保留的重要架构决定进入 ADR；探索过程和实现证据留在 Task。
- 外部贡献者默认不修改 `RELEASE.md`。维护者会在发布时把已合并改动整理成面向用户的说明。

## Git 与提交

维护者（含开发 Agent）多线并行开发的分支命名、worktree 与 squash 合并约定见 [`AGENTS.md`](AGENTS.md) 的「Git 工作流」；本节约束外部贡献者的主题分支 PR。

- 从最新 `master` 创建主题分支。不要 force push 维护者分支或重写他人的提交。
- 一个 PR 只解决一个连贯问题；不要顺手夹带其它修复、格式化、依赖升级、上游合并或无关 Task 文档。
- 保持提交可审查。建议使用 Conventional Commit 类型：`feat`、`fix`、`docs`、`refactor`、`test`、`build`、`ci`、`chore`。
- 不要为了更新分支把 `master` 合并提交、版本提交或生成产物带进 PR。必要时在自己的分支上 rebase，并自行解决冲突。

示例：

```text
fix(agent): preserve session attachment ordering
docs(contributing): clarify task ownership
```

## Pull Request 要求

PR 应使用仓库模板，并完整说明：

- 按本指南要求先建 Issue 的改动应关联编号；允许直接提交的轻量文档修正写“无 / None”。
- 范围内和明确不在范围内的内容。
- 用户可见结果、技术实现和可能受影响的合同。
- 实际执行的验证命令和结果。
- 未运行的验证、已知限制和后续事项。
- 数据结构、配置、安装方式、安全或隐私边界是否变化。
- 前端改动的截图、录屏或未做浏览器验证的明确说明。
- 需要更新的用户文档、Task、Reference、ADR 或 `PROJECT-STATUS.md`。

维护者可能要求先缩小 PR、补充证据或重新讨论接口。CI 通过表示自动检查完成，不表示改动一定会合并。

## Review 与合并

- 请直接回应 Review 指出的行为、风险和测试缺口；技术意见应以合同和证据为依据。
- 维护者负责最终范围判断、Task 编号、发布说明和合并方式。
- PR 可能因方向变化、长期无人跟进、范围过大或无法验证而关闭。关闭不代表否定贡献者，可以基于新的清晰范围重新提交。

## 许可证

提交代码、文档或其它内容即表示你有权提交这些内容，并同意它们按照仓库的 [GNU Affero General Public License v3.0 only](LICENSE) 发布。项目不要求 CLA 或 DCO。
