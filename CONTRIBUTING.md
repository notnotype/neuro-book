# 参与 NeuroBook 开发

[English](CONTRIBUTING.en.md)

本指南面向人类贡献者，说明从报告问题到提交 Pull Request（PR）的公开流程。开发 Agent 读取根 [`AGENTS.md`](AGENTS.md) 与 [`.omp/RULES.md`](.omp/RULES.md)；完整编码和维护者流程位于 [`docs/standards/`](docs/standards/)。

## 开始之前

请选择与改动规模相符的入口：

- 拼写、失效链接和不改变含义的小型文档修正可以直接提交 PR。
- 边界明确的小 Bug 应关联现有 Issue；没有时提交“错误报告”。
- 新功能、跨模块修改、数据结构或运行时合同变化先提交“功能建议”，维护者标记 `status: ready` 后再实现。
- Profile、Skill、Workflow 和其它提示词使用“提示词与内置 Agent 资产”。
- 安装或使用问题使用“使用与安装问题”。
- 其它公开分类不适用时使用“其它问题”，不要借此绕过安全报告或必要设计讨论。
- 安全漏洞不要创建公开 Issue 或 PR；按[安全政策](.github/SECURITY.md)使用 GitHub 私密漏洞报告。

Issue 被接受表示方向可以推进，不保证具体实现或完成时间。在表单中声明愿意实现时，等待维护者添加 `status: claimed` 后再开始，避免重复工作。

## 本地开发

需要 Git、[Bun](https://bun.sh/) 和改动目标平台所需工具。根目录只保留治理、文档和发布编排命令；应用命令在主应用包内执行。安装依赖并启动：

```bash
bun install
bun run --cwd packages/neuro-book dev
```

按改动选择验证：

```bash
bun run --cwd packages/neuro-book test -- path/to/relevant.test.ts
bun run --cwd packages/neuro-book typecheck
bun run --cwd packages/neuro-book build
bun run docs:check
bun run docs:build
```

其它包的命令见各自 `package.json`。

PR 列出实际命令和结果；没有执行的检查写“未运行”。聚焦测试、全量测试、构建、浏览器和真实 Provider 验收不能互相替代。

统一使用 Bun。安装依赖前先确认现有依赖；不提交 `.env`、`config.yaml`、Project Workspace、小说正文、API Key、Session、trace、数据库、缓存或未脱敏日志。不运行发布命令，不自行改版本，不创建 `chore(release)` 提交，也不提交无权再分发的内容。

## 找到正确规范

修改前从以下入口确认当前合同：

| 入口 | 用途 |
|---|---|
| [`docs/specs/README.md`](docs/specs/README.md) | 产品行为、数据、接口、失败和验收的当前规范注册表 |
| [`packages/neuro-book/docs/specs/foundation/terminology.md`](packages/neuro-book/docs/specs/foundation/terminology.md) | Workspace、运行时、存储与 Agent 标准术语 |
| [`docs/standards/code/README.md`](docs/standards/code/README.md) | 按改动路径选择前端、服务端、桌面、脚本、数据库或包规范 |
| [`docs/testing/README.md`](docs/testing/README.md) | 测试、临时根、环境、验收和证据 |
| [`packages/neuro-book/docs/adr/`](packages/neuro-book/docs/adr/) | 已接受架构决策的理由 |
| [`.agents/works/`](.agents/works/README.md) | 当前 Work/Task：重大实现的范围、过程和证据；`.agents/tasks/` 只保留历史记录 |
| [`PROJECT-STATUS.md`](PROJECT-STATUS.md) | 仓库现状与当前验收缺口 |
| [`RELEASE.md`](RELEASE.md) | 发布程序消费的当前版本说明 |

`packages/neuro-book/assets/reference/` 是产品 Agent/Profile Reference 的应用 Seed Source；Profile 的逻辑路径仍为 `reference/**`，显式 Runtime 的物理根由 Runtime Asset Adapter 解析。其迁移状态由规范注册表登记。不要只依据 Issue 标题、单个代码路径、Proposal 或 Task 推断完整当前合同。

## Issue 与实现授权

五个 Issue Form 自动添加一个 `type:*` 与 `status: needs-triage`；提示词表单还会添加 `area: agent`。每个开放 Issue 恰好保留一个 `type:*` 和一个 `status:*`：

- `status: needs-triage`：等待首次确认。
- `status: needs-info`：缺少信息，报告者补充后重新分流。
- `status: needs-design`：方向或合同未确定，不能开始实现。
- `status: ready`：范围已接受，可以认领。
- `status: claimed`：已授权指定实现者，其它贡献者不要并行实现。
- `status: blocked`：外部条件阻塞，解除后回到准确状态。

`help wanted` 和 `good first issue` 只用于 `status: ready`；后者还必须范围小、上下文完整且有独立可验证的验收条件。外部贡献者默认不创建 Task 编号，维护者按需要分配。

## 准备变更

- 从最新 `master` 创建主题分支，不 force push 维护者分支或重写他人提交。
- 一个 PR 只解决一个连贯问题，不夹带格式化、依赖升级、上游合并或无关修复。
- 使用现有组件、类型、错误和测试模式；产品行为变化同步当前 spec。
- 测试行为、边界、失败和状态转移；上传日志、截图和数据前脱敏。
- 文件与 Project Workspace 操作通过既有授权、路径归一化和 containment，不直接拼接用户路径绕过边界。
- 建议使用 `feat`、`fix`、`docs`、`refactor`、`test`、`build`、`ci`、`chore` 等 Conventional Commit 类型。

维护者的 Issue、Task、worktree、sibling、vendor 和合并流程见 [`docs/standards/repository-workflow.md`](docs/standards/repository-workflow.md)。

## Pull Request

使用仓库 PR 模板并说明：关联 Issue；范围内与不在范围内的内容；用户可见结果和受影响合同；精确验证命令与结果；未运行项和已知限制；数据、配置、安装、安全和隐私影响；前端截图/录屏或“未运行浏览器验收”。

开始前确认 Issue 未被 `status: claimed` 或分配给他人。允许直接提交的小型文档修正可写“无 / None”；其它改动按指南关联 Issue。绿色 CI 只表示自动检查完成，不表示合并获批。

## Review 与合并

直接回应 Review 指出的行为、风险和测试缺口，以当前合同和证据为依据。维护者可以要求缩小范围、补充证据或重新讨论接口，并负责最终范围、Task 编号、发布说明与合并方式。

贡献者不自行合并、关闭 Issue、部署或发布，除非维护者明确授权。PR 可能因方向变化、长期无人跟进、范围过大或无法验证而关闭；可以基于更小、更清晰的范围重新提交。

## 许可证

提交代码、文档或其它内容即表示你有权提交，并同意其按仓库的 [GNU Affero General Public License v3.0 only](LICENSE) 发布。项目不要求 CLA 或 DCO。
