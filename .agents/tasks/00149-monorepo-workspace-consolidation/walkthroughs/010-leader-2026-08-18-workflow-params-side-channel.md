---
schema: nbook.walkthrough/v1
taskId: 00149-monorepo-workspace-consolidation
sequence: 010
role: leader
status: blocked
createdAt: 2026-08-18T11:05:00Z
---

# Leader：Workflow 0.2.0 params 观测侧道

## 问题

0.2.0 的 `ActivityRecord.fingerprint` 已是 `sha256:<hex>` 摘要；应用旧观察器直接 `JSON.parse(record.fingerprint)` 会在真实运行记录上抛 `Unexpected token`。同时，canonical 参数可能包含 prompt 或正文，不能直接暴露到 RunView 与事件 API。

## 决定

- `fingerprint` 永远只保存 SHA-256 摘要。
- 内核在同一次 canonicalization 后生成可选 `params` canonical JSON 侧道；`params` 不参与 Activity identity。
- 新记录优先读取 `params`；没有 `params` 的旧记录才允许读取 inline JSON fingerprint；SHA-256 fingerprint 不可逆。
- NeuroBook `projectActivityRecord()` 移除 `params`，`projectWorkflowEvent()` 移除 `activity_started.params`；invocation result 仍只移除 usage.cost，用户自定义 result.cost 保留。
- workflow 观察器统一通过 `parseActivityParamsObject` 读取参数；Activity result 统一按 `WorkflowValue` 的 inline/ref 形状读取。

## 修改

- `packages/nb-workflow/src/fingerprint.ts`
- `packages/nb-workflow/src/runtime.ts`
- `packages/nb-workflow/src/types.ts`
- `packages/nb-workflow/src/runtime-events.ts`
- `packages/neuro-book/server/agent/workflow/workflow-demo-service.ts`
- `packages/neuro-book/server/agent/workflow/workflow-run-vm.ts`
- `packages/neuro-book/server/agent/workflow/workflow-session-port.ts`
- 应用 workflow 测试 fixture 与 bundled workflow 类型合同
- `reference/agent/workflow/README.md`、`authoring.md`

## 已验证

- `packages/nb-workflow`: 实际命令 `bun test`，103 pass / 0 fail；`bunx tsc --noEmit` 通过。
- `packages/neuro-book`: 实际命令 `bun run --cwd packages/neuro-book typecheck` 通过；workflow 聚焦命令 `bun run --cwd packages/neuro-book test -- server/agent/workflow/workflow-demo-service.test.ts server/agent/workflow/workflow-run-vm.test.ts server/agent/workflow/workflow-session-port.test.ts` 为 3 files / 18 passed。
- 主应用全量实际命令为 `bun --cwd packages/neuro-book test -- --retry=3`；原始 Vitest 结果为 `Test Files 1 failed | 414 passed | 1 skipped (417)`、`Tests 1 failed | 3074 passed | 3 skipped (3086)`，另有 `Errors 1`。失败文件是 `server/agent/profiles/profile-sdk-contract.test.ts`，`director.profile.tsx` 的依赖包含 `server/utils/frontmatter-document.ts`；同时存在未处理的 `[vitest-pool] Worker forks emitted error` / `Worker exited unexpectedly`，因此该全量结果不通过。
- 根 `package.json` 没有 `test` script；`bun run test -- --retry=3` 没有执行根全量测试，不作为通过证据。
- 端到端 smoke 观察到 `fingerprint=sha256:<64 lowercase hex>`，ActivityRecord 与 `activity_started` 均含 canonical `params`。
- 公共投影回归证明 journal/event 不含 `params`，invocation usage.cost 被移除，用户自定义 result.cost 保留。
- `bun run governance:check` 首次在主应用全量测试后因生成的未跟踪运行态目录 `packages/neuro-book/.agent` 失败；删除该目录后重新运行同命令，结果为 `failures=[]`、`warnings=[]`。
- `bun run test:desktop-contract` 实际为 11 files / 37 tests passed；此前记录的 4 个 ENOENT 属于路径修复前结果，已不再列为当前失败。

## 未通过或未验收

- `package:windows-portable` 未完成：release source 要求 clean checkout，当前迁移 worktree 按计划保持 dirty。
- 真实 Docker smoke、Windows runner、浏览器/人工验收、真实 Provider/Model、私有 corpus、远端部署和签名/公开发布未授权或未运行。
- sibling resync 仍受 manifest allowlist 对账阻塞；nb-workflow 当前 `unresolved=22`、`mismatch=39`，不得复制源包或宣称同步完成。
- 用户已选择“批准并继续”：允许承认已发生的 `0fdec90bac0456b67045185c99cb8b829e75bd6c` 计划外源仓提交，并仅使用其等价内容作为迁移输入；不允许新的原仓写操作。

## 证据纠正

2026-08-18：在继续子项目同步前，复核 `git status --porcelain=v1 --untracked-files=all`、`git diff --check`、`git diff --cached --check` 和 `bun run governance:check`。本次只把 S6 evidence 的 `checkpoint.workingTree` 改为实际 clean 状态并移除无法写入自身的 pending checkpoint commit 字段；S6 仍为 `blocked`，既有失败、未验收边界、T02 批准例外和历史非最终 tag 均保持不变。
- 原仓 T02 immutability gate 不宣称 clean-green，作为用户批准的计划外例外保留；S6 当前因 sibling resync、根外 worktree 与未授权 runtime/platform 门禁保持 `blocked`，不创建最终 tag、不宣称绿色验收。

## 包级治理与 worktree 根门禁

2026-08-18：按已批准治理合同更新 `packages/AGENTS.md`、根 `AGENTS.md`、`packages/neuro-book/AGENTS.md`、`.gitignore` 和治理实现。所有 `packages/*` 默认继承根规则；包级 `AGENTS.md`、`docs/`、`.agents/tasks/`、`PROJECT-STATUS.md` 是可选覆盖资产，六个自治包继续强制具备四类资产；`.agent/.local` 只要求 ignored 且未被 Git 跟踪，`.worktree` 在 checkpoint 门禁中要求清理。跨包 workspace 依赖必须解析到本地 manifest，非主应用包不得依赖 `@notnotype/neuro-book`。

Monorepo 边界唯一正文继续是 [`docs/modules/monorepo-boundaries.md`](../../../../docs/modules/monorepo-boundaries.md)，`docs/specs/README.md` 已登记该路径并明确不创建 `docs/specs/architecture/monorepo-boundaries.md` 副本。

实际验证：`bun x vitest run --config scripts/vitest.config.ts scripts/ci/agent-governance.test.ts` 为 `1 file / 8 tests passed`；`bun x tsc --noEmit -p scripts/tsconfig.json` 退出 0；`bun run governance:check` 返回 `failures=[]`、`warnings=[]`；`bun run governance:worktree` 按合同返回退出码 1，并报告 `C:/t145-wt-cdb48aa930bf4b4bba2f542c965907c1`、`C:/Users/<user>/.codex/worktrees/7076/neuro-book` 和 `C:/Users/<user>/Documents/CodeRepository/GithubProjects/neuro-book/.agent/workspace/wt/session-recovery-gaps` 三个 canonical 根外 registered worktree。未执行 worktree prune/remove；位置违规保留为当前环境阻塞证据。

## S7：Docker、CI、部署与发布入口

2026-08-19：按批准的 S7 范围完成主应用 workflow cwd 收敛、六包 `workspace-packages.yml` matrix、llmlint Web island 合并、`.dockerignore` 包级输出与数据排除、Git-less Product source 的包级 `data.db`/`data.db-*`/Prisma 生成物排除、community validator 迁移和 docs canonical link 修复。Desktop Windows Product 步骤使用现有 Vitest CLI 执行两个 suite：`bun x vitest run --config scripts/vitest.config.ts scripts/build/product-runtime-bundle.test.ts scripts/build/product-build-environment.test.ts`，未把 `.test.ts` 直接交给 Bun。

实际验证：`bun scripts/ci/validate-community-files.ts` 报告 31 个标签、5 个 Issue Form、16 个 YAML；9 个 workflow YAML 可解析；九 workflow 结构合同为 1 file / 7 passed；Product/Docker/Git-less 合同为 4 files / 28 passed，包含 package `data.db`、`data.db-journal`、`data.db-wal`、`data.db-shm` 与 `server/generated/prisma` 的 Docker/context 和 sourceDigest 行为断言；Manager release 合同为 1 file / 1 passed；release assets 合同为 4 files / 32 passed；Desktop 合同为 11 files / 37 passed；`bun x tsc --noEmit -p scripts/tsconfig.json`、`bun run governance:check` 和 `git diff --check` 通过；`bun run docs:build` 完成，仅保留既有 chunk size warning。S7 仍不等同于远端 CI、真实 Docker、Windows runner、浏览器人工验收或发布通过。
