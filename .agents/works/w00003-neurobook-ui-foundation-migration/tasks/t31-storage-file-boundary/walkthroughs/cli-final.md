# t31 CLI 最终收口：node parse/validate 的 Storage 边界

状态：实现与真实 CLI 回归完成，未提交。cwd：`packages/neuro-book`。
本增量只改 `server/workspace-files/workspace-command.ts` 与同名测试，未触碰 `server/storage`、
`server/api/storage`、`shared/storage`、Project lifecycle/session/module、`workspace-archive.ts`、
`server/backup`、两个 workbench descriptors、Work/Spec 与他人 Task 文档。

## 收口的需求

t33 追加复核的残余 1：`node parse` 与 `node validate --fix-missing`（含 `--recursive`）未接 Storage guard。
Storage 明确保留未知原件，因此不能假定 Storage 目录内永远没有 `index.md`；普通 CLI 不得读取或修复它们。

## 改动

### 1. 统一读 guard（覆盖 parse / validate）

`resolveSingleWorkspaceTarget` 解析出相对目标后，在返回前调用
`assertWorkspaceStorageBoundary(workspaceTargetForContentRoot(root), relativePath, "read")`。

- 所有 node 命令（`new` / `state` / `parse` / `validate`）都经此解析，显式 Storage 输入（`.nbook/storage/**`、
  `proj/.nbook/storage/**`）统一被拒；Project 内容根下的 `.nbook/storage/**` 同理。
- `new` / `state` 保留原 `"mutation"` 判定：它是 `read` 的超集，额外覆盖 Storage 根祖先，位置不变。
- `.`（内容根本身）在 `read` 语义下按既有合同放行，`new .` 继续由 mutation guard 拒绝。

### 2. `validate --recursive` 不进入 Storage

`node validate` 传入 `pathPredicate: ({relativePath}) => !isWorkspaceStoragePath(contentTarget, relativePath)`，
复用 `WorkspaceContentValidateOptions` / `WorkspaceScanOptions` 既有谓词，不复制遍历、不给低层注入 runtime。
递归扫描在进入 `.nbook/storage` 前整棵剪枝，普通祖先（Workspace Root 或 Project 内容根）仍能处理正常内容节点。

### 3. 附带收紧

`assertSingleWorkspaceRoot` 返回类型由 `string` 改为 `AbsoluteFsPath`，与 `ResolvedWorkspaceTarget.root` 一致，
使 `workspaceTargetForContentRoot(root)` 无需断言即可调用。

## 真实命令与结果

全部 cwd `packages/neuro-book`，`--maxWorkers 1`。

| 命令 | 结果 |
|---|---|
| `bun run test server/workspace-files/workspace-command.test.ts --maxWorkers 1` | 1 文件 9 用例通过（9.05s） |

新增用例 `node parse/validate 拒绝 Storage 输入，递归校验不进入 Storage`（`workspace-command.test.ts`）：

- Workspace Root cwd：`.nbook/storage/records/index.md` 放含缺字段原件（仅 `title`），
  `node parse .nbook/storage/records --json --body` 与 `node validate .nbook/storage/records --fix-missing` 均 exit 1，
  stderr 含「Storage 数据由 Storage 服务独占」。
- 从 Workspace Root 跑 `node validate . --recursive --fix-missing --json`：`fixedPaths` 只含正常节点
  `lorebook/character/hero/index.md`，Storage 原件字节逐字不变。
- 普通 `notes/storage/ok` 仍可 `node parse`（exit 0）。
- Project 内部 cwd（`proj` 含 `project.yaml`）：显式 `.nbook/storage/records` 被拒；
  `node validate . --recursive --fix-missing` 退出 0 且 Project Storage 原件字节不变。

### 回归有效性（回退探针，只在本轮临时验证，已还原）

- 去掉统一读 guard（保留 mutation guard）：`-t "拒绝 Storage 输入"` 在 `explicitParse.code` 处失败，
  实际 exit 0（说明该断言确实由本改动带来）。
- 只去掉 `validate` 的 `pathPredicate`（保留读 guard，变更已还原）：同一用例在 `fixedPaths` 处失败，
  实际多出 `.nbook/storage/records/index.md`（说明递归剪枝断言确实由本改动带来）。
- 探针后已恢复最终源码；`git diff server/workspace-files/workspace-command.ts` 与本报告描述一致。

## 未运行与剩余项

- 未跑主应用 `typecheck`：按 Task 分工由主 Agent 统一执行；本轮涉及 `resolveSingleWorkspaceTarget` 的返回结构、
  `assertSingleWorkspaceRoot` 返回类型收紧与新增 `pathPredicate`。
- 未重跑大型 `workspace-files.test.ts` 及 t31/t32 其它聚焦集（按 Task 约定，只跑直接受影响的 CLI 测试）。
- 未改 t30 文件、两个 workbench descriptors、Work/Spec 与他人 Task 文档；未提交、未 push/PR/部署。
