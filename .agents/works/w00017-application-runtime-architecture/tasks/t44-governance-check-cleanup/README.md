---
schema: nbook.task/v2
taskId: t44-governance-check-cleanup
---

# 治理与文档检查瘦身、测试按改动选包

## 目标与范围

[t43](../t43-repository-reorganization/README.md) 之后、第 2 步（内核包）开始前的一次治理整理。开发者 2026-10-03 批准以下改动：

**A. 警告只报本次改动**

`docs:check` 与 `governance:check` 的失败照旧检查全仓；警告只逐条列出本次改动涉及的文件，其余合成一行计数。默认的改动范围是未提交的改动（含未跟踪文件），`--since <rev>` 再加上从 `<rev>` 与 `HEAD` 的分叉点到现在的提交，`--all` 逐条列出全部警告。

**B. 删除核对冻结历史的规则**

- 删除：v1 旧 Task 的字段、工作流、design/research diff 校验；旧应用 Task 文件的 sha256 账本校验；sibling 同步证据的固定 hash 校验；旧根应用路径与根命令的复活守卫；迁移标记校验；两条一次性迁移命令 `governance:migrate-tasks`、`governance:migrate-task-ownership` 及其脚本和测试。
- 保留：旧 Task 目录（根与包级 `.agents/tasks/`）拒收 `nbook.task/v2`。`.agents/tasks/ownership.json`、`legacy-index.json`、`.migration-complete` 作为历史数据留在原处，不再被检查读取。
- 开发者已知并接受：此后“历史 Task 文件未被改动”不再有机器保证，只靠 git 历史与 review。

**C. 修正指向已删除路径的规则**

- 组件同名文档检查暂时只查 nb-ui 导出的组件；新应用的组件目录在第 4 步确定后加入。
- 应用脚本边界（只放行已删除的 `scripts/cli/source-dev.ts`）改为：除旧应用外，任何包都不导入根 `#scripts/*`。
- 包依赖禁止项加入 `@notnotype/neuro-book-legacy`。
- 删除 `docs/manual-eval/`、`docs/standards/code.md`、根 `reference/` 与旧治理入口路径的复活守卫。
- “Task 必须链接 Spec 或写明行为合同未变”保留，随 A 只对改动到的 Task 报。

**D. 测试按改动选包**

新增根命令 `bun run test:affected`：按改动文件选出所在的包及依赖它的包，运行它们的 `test` 脚本；根 `scripts/` 有改动时运行根脚本测试。改动范围与 A 相同（默认未提交改动，`--since <rev>`）；`--typecheck` 同时运行类型检查；`--dry-run` 只列出选中的包和原因。依赖闭包与 CI 的 `workspace-package-matrix.ts` 共用一套实现。包内按文件缩小范围的做法写进测试规范。

行为合同未变：本 Task 只改仓库治理脚本与开发文档，不涉及产品行为。

## 验收

1. `docs:check`、`governance:check` 的失败为 0；默认运行时警告只含本次改动涉及的文件，`--all` 时与改动前的全量警告一致（扣除 B、C 删除的规则）。
2. 根脚本测试与脚本类型检查通过。
3. `test:affected --dry-run` 在以下改动上选包正确：只改文档（不选包）、改某个包（该包及其消费者）、改 `bun.lock`（全部）、改根 `package.json` 或 `scripts/`（根脚本测试）。实现中把根 `package.json` 由“全部”改为“根脚本测试”，理由见下方实际改动 D。
4. 文档里对两条迁移命令、已删除检查的描述同步删除或改写。

## 当前状态

2026-10-03 完成，由主 Agent 直接执行。

**实际改动：**

- **A**：新增 `scripts/ci/change-scope.ts`，三个命令共用：参数解析（未知参数与缺值参数以退出码 2 拒绝，避免拼错的 `--since` 悄悄退回默认范围）、改动文件集合、警告按范围拆分。警告带上所属文件与固定类别名，范围外的按类别合成一行 `stockWarnings`。
- **B**：`scripts/ci/agent-governance-contract.ts` 由 2025 行减为 540 行，`agent-governance.test.ts` 由 2412 行减为约 600 行；删除 `scripts/maintenance/` 下两条迁移命令、它们的测试与根 `package.json` 入口。旧 Task 目录只保留“拒收 v2”的检查（`verifyLegacyTaskRoots`）。`.agents/tasks/README.md`、`AGENTS.md` 相应改写。
- **C**：组件同名文档检查只查 nb-ui（`components.md` 同步）；`verifyPackageScriptBoundary` 取代只放行 `source-dev.ts` 的旧边界；包依赖禁止项加入旧应用；删除 `docs/manual-eval/`、`docs/standards/code.md`、根 `reference/` 与旧治理入口路径的守卫，以及临时根扫描里已不存在的 `docs/tasks/` 前缀（同时跳过旧应用，`governance:check` 由约 0.82 s 降到约 0.27 s）。
- **D**：新增 `scripts/cli/test-affected.ts` 与根命令 `test:affected`；`workspace-package-matrix.ts` 导出依赖图与闭包供它复用。根 `package.json` 只算根脚本的输入：依赖变化总会带来 `bun.lock` 变化，按 `bun.lock` 判全量即可，改根 scripts 不必跑全部包。
- 顺带：`scripts/tsconfig.json` 补上原先没被类型检查的 `check-documentation.ts`、`workspace-package-matrix.ts`、`create-agent-worktree.ts`；CI 的 `code-baseline` 改为运行全部根脚本测试（原先只跑两个文件，`check-documentation` 的测试没有在 CI 运行）；`scripts/AGENTS.md` 的导入前缀由过时的 `nbook/*` 改为 `#scripts/*`；`docs/testing/README.md` 的验证门禁写入三个命令的用法。

**验收：**

1. `docs:check`、`governance:check` 的失败为 0。默认运行时 `warnings` 为空，存量合成一行（文档 137 条、罕见符号 68 个文件）；`--all` 时文档检查的 137 条与改动前逐条相同，罕见符号 68 个文件与改动前一致。
2. 根脚本测试 6 个文件 83 个用例通过，脚本类型检查 0 错误。
3. 选包规则由 `scripts/cli/test-affected.test.ts` 覆盖（只改文档、包内改动及消费者、旧应用不参加、无 test 脚本跳过、依赖锁与补丁全量、根 package.json/scripts/workflow 只选根脚本、`--typecheck`）；实际运行两次：只有脚本改动时选中根脚本测试；在 `packages/nb-history` 放临时文件时选中 nb-history 与根脚本测试，均通过。
4. 活跃文档中对迁移命令与已删除检查的描述已改写；`git diff --check` 通过。

证据见 [evidences/](evidences/)。

**后续事项：**

- 文档检查约 1.9 s 未变，耗时主要在全仓链接解析；目前不是瓶颈，未优化。
- CI 的 `workspace-packages.yml` 仍按原规则把根 `package.json` 视为全量输入，与本地 `test:affected` 不同；CI 宁可多跑，暂不改。

## 下一步

第 2 步：内核抽成 `nb-runtime` 包（主 Agent 编码，omp 审查）。
