# llmlint Standalone Development Repository

## User Request / Topic

用户决定把 `llmlint` 从 NeuroBook 内嵌 skill 的复杂形态中独立出来：规则、CLI、评测 harness 后续还会继续膨胀，未来可能增加 web，因此需要一个真正的 sibling 开发仓，而 NeuroBook 只保留可运行的 bundled snapshot。

## Goal

- `C:\Users\<user>\Documents\CodeRepository\GithubProjects\llmlint` 成为 llmlint 真相源。
- llmlint 仓库根是开发工作区；真正可安装 / 可同步的 Agent Skill package 固定为 `skill/`。
- NeuroBook `assets/workspace/.nbook/agent/skills/llmlint/` 只作为 `../llmlint/skill` 的 vendored runtime snapshot。
- `evals/` 进入 llmlint 仓 git，作为评测 harness 与基线语料；不进入 `skill/`，不随 user-assets 同步到用户 runtime。

## Decisions

- 本轮不做 monorepo / workspace；根目录先承载 `skill/`、`evals/`、`tests/`、开发脚本和根 `package.json`，未来出现 web 再升级。
- 不保留 assets 下嵌套 `.git`。所有 llmlint git 操作都在 sibling 仓执行。
- NeuroBook 通过 `scripts/cli/sync-llmlint-skill.ts` 从 sibling `skill/` 镜像 snapshot，并排除 `.git/`、`node_modules/`、`.bun/`、`.agent/`、`evals/`、`tests/`、coverage/report 临时产物。
- `workspace/.nbook/agent/skills/llmlint/` 是 runtime-only 副本；user-assets 同步硬切清理旧 `.git`、`node_modules`、`evals` 和旧 `.gitignore`。

## Implementation Walkthrough

### 2026-07-01 迁移实现

已完成：

- 从 `assets/workspace/.nbook/agent/skills/llmlint` 复制当前嵌套仓到 sibling `../llmlint`，保留未提交源码改动和原 ignored `evals/`。
- 将 runtime package 下沉到 `../llmlint/skill/`；根目录新增开发 `package.json`、`tsconfig.json`、README / README.en。
- `evals/` 留在仓库根并更新说明：它现在进入 llmlint 仓 git，但不属于可安装 skill。
- `tests/llmlint.test.ts` 从 NeuroBook 测试迁出，改为直接 import `skill/src/*`；旧 `旧中文规则样本目录` 依赖改成最小 fixture。
- 新增 NeuroBook 同步脚本 `scripts/cli/sync-llmlint-skill.ts`，从 sibling `skill/` 镜像到 bundled snapshot。
- 执行同步脚本后，NeuroBook assets 中的旧嵌套 `.git`、`node_modules`、`evals` 和 `.gitignore` 已不再存在。
- 扩展 user-assets 硬切清理，真实 `workspace/.nbook/agent/skills/llmlint/` 也已清到 runtime-only。

计划出入：

- 计划中只写“evals 可以进 git”，实现时进一步明确为：`evals/` 进 sibling llmlint 仓 git，但不会放进 `skill/`，也不会进 NeuroBook user runtime。
- 旧 `旧中文规则样本目录` 已不存在；独立仓测试改用 fixture 覆盖导入器行为，而不是继续依赖已消失的 scratch 目录。
- 计划草案中使用的编号已被项目列表性能任务占用；本任务实际编号为 Task 84。
- 早期验收曾写 CLI 只含 `check` / `show-llm-rules`；当前 llmlint 已落地 `fix` 命令，硬切验收改为无旧导入入口、保留当前 `check <files...>` / `fix <files...>` / `show-llm-rules`。
- 独立仓验证时发现 `runCli()` 作为模块 API 连续调用会继承上一轮 `process.exitCode`。已在 sibling `skill/src/cli.ts` 入口显式重置为 `0`，并同步回 NeuroBook assets 与 user runtime。

## Verification

通过：

- `cd ../llmlint/skill && bun install --frozen-lockfile --ignore-scripts --no-progress`：安装 runtime 依赖成功，未进入 NeuroBook runtime snapshot。
- `cd ../llmlint && bun install --frozen-lockfile --ignore-scripts --no-progress`：根开发依赖已可稳定校验，`Checked 139 installs across 169 packages (no changes)`。
- `cd ../llmlint && bun run typecheck`：通过。
- `cd ../llmlint && bun run verify`：通过（typecheck + test + version + `show-llm-rules --format json`）。
- `cd ../llmlint && bun test`：55 pass / 0 fail。
- `bun skill/bin/llmlint.ts --version`：`2.0.0`。
- `bun skill/bin/llmlint.ts show-llm-rules --format json`：输出 `kind: "llm-rules"`，默认 registry 为 `builtin/default`。
- `bun evals/score.ts --corpus evals/fixtures/corpus --out .agent/evals/fixture-report --min-support 1`：通过，fixture 报告写入 `../llmlint/.agent/evals/fixture-report/report.md`。
- `bun scripts/cli/sync-llmlint-skill.ts`：同步 sibling `skill/` 到 NeuroBook assets，最后一轮 `copied=1, unchanged=93, removed=0`。
- `bun scripts/cli/sync-user-assets.ts`：同步 user runtime，最后一轮 `updatedAssets=1`。
- `bun vitest run server/agent/skills/llmlint.test.ts server/agent/skills/skill-catalog.test.ts`：2 files / 53 tests passed。
- `bun vitest run server/workspace-files/workspace-files.test.ts -t "旧 llmlint"`：1 targeted test passed。
- `bun vitest run server/workspace-files/workspace-files.test.ts -t "同步系统 assets 会管理 Agent skills、模板和 CLI 辅助文件"`：1 targeted test passed。
- `bun run typecheck`（NeuroBook）：通过。
- `bun workspace/.nbook/agent/skills/llmlint/bin/llmlint.ts --help`：可运行，公开当前 `check` / `fix` / `show-llm-rules`。
- `bun workspace/.nbook/agent/skills/llmlint/bin/llmlint.ts show-llm-rules --format json`：可运行。
- `bun workspace/.nbook/agent/skills/llmlint/bin/llmlint.ts check workspace/ming-ding-zhi-shi-2/manuscript/001-volume/001-chapter/index.md --min-level medium`：可运行，输出紧凑 `line:start-end match:` 格式。
- 残留检查：`assets/.../llmlint` 与 `workspace/.nbook/.../llmlint` 均无 `.git`、`node_modules`、`evals`；文档当前口径不再推荐旧嵌套仓或旧 scratch 规则目录。

### 2026-07-26 Skill package contract follow-up

- llmlint 升级至 `2.0.1`；Skill 版本真相源收敛到 `skill/package.json.version`。
- `SKILL.md` / `references` 不再假定 `.nbook` 安装位置，统一从 SkillCatalog `location` 推导 `<skill-root>`。
- NeuroBook user-assets 同步不再把 `node_modules` 当已删除官方资产；仅依赖安装合同或 lockfile 发布时失效本地依赖。
- 完整设计与验证记录见 [Task 120](../120-agent-skill-package-contract/README.md)。

历史阻塞复查：

- 早先 `cd ../llmlint && bun install` 曾卡在 `Resolving dependencies`，根 `typecheck` 因开发依赖未安装而失败。2026-07-01 链路复查时，根 `bun.lock` / `node_modules` 已生成，`bun install --frozen-lockfile`、`bun run typecheck` 和 `bun run verify` 均通过；该阻塞已关闭。
- `bun vitest run server/workspace-files/workspace-files.test.ts` 全量运行超过 3 分钟无进度输出，本轮改跑与 llmlint 拆分直接相关的两个定向用例；没有把全量 workspace-files 作为通过项。

## References

- llmlint sibling source: `../llmlint/`
- llmlint skill package: `../llmlint/skill/`
- NeuroBook bundled snapshot: `assets/workspace/.nbook/agent/skills/llmlint/`
- Runtime user copy: `workspace/.nbook/agent/skills/llmlint/`
- Rule registry history: [Task 77](../77-llmlint-rule-registry/README.md)
- Eval harness history: [Task 82](../82-llmlint-eval-harness/README.md)
