---
schema: nbook.task/v2
taskId: t29-master-sync
---

# w00017 与 master、w00020 同步

## 目标与范围

2026-09-30 开发者选定“先同步再开始阶段 1”（方案 A），并授权派子代理解决冲突、不走 PR 直接合并。

- 在 `refactor/w00017-runtime-foundation` 上合并 `master`（基线 `6faecf81`）与 `fix/w00020-startup-exit-api-auth`（PR #245 的两个提交），解决冲突并验证。
- 合入 master 本身放在同步之后：主工作区（master）有 62 项未提交改动，其中 22 个文件与本次合并重叠，要等这些改动提交后再合，不覆盖它们。
- worktree 中开发者未提交的 `packages/neuro-book/docs/research/README.md` 保持原样，不暂存、不提交。
- 不 push，不改动主工作区。

## 当前状态

2026-09-30 子代理完成三次合并（master `6faecf81`、w00020、master `0fa8bc99`），提交 `72efd816`、`5efc5b42`、`2be161e1`；另补 `514352e2`（master 新增的 docs:check 规则要求 implemented Spec 的证据有“实现入口、合同测试、Smoke”标签行，为 w00017 的 7 份 implemented Spec 补齐，行为描述不变）与证据 `a3b09616`。主会话复核：分支已包含 master 与 w00020，未动主工作区与 `packages/neuro-book/docs/research/README.md`。

冲突解决要点：

- Component Lab 同时保留 t14（撤出全局产品宿主、场景局部命令宿主）与 w00018、w00019（分层输入、调试合同、时间线）；FilesExplorerView fixture 按分层输入迁移；component-lab Spec 中 t14 的两条验收顺延为 16、17。
- Files 批量操作以 w00017 为准；master `a5d2aa7f` 的另一份实现没有其它调用方。
- w00020 的“启动失败即有序退出”写入 w00017 基于 `runtime.application` 的启动。
- Lab 会话存储不再接受已撤出的 `commands` tab（按 t14 原意补断言）。

验证（原始输出见 [evidences](evidences/)）：`docs:check`、`governance:check`、`test:runtime-foundation` 通过。全量测试与两项 typecheck 失败，逐条对照两个基线后**合并引入 0 条**（见 [failing-tests-comparison.txt](evidences/failing-tests-comparison.txt)）：

- 两个基线都失败 17 条，只有 master 失败 8 条（含 WorkbenchShellLayoutFixture 在 Node 26 下取不到 `localStorage`）；
- **只有 w00017 失败 416 条**，是本分支原有的回归，主会话抽查的根因：t25 把 Project 代次 owner 移入 Application 后，打开 Project 的测试没有建立运行实例（“Product runtime 未就绪，不接纳 Project generation”）；config-service 的 Project 测试 owner 未关闭导致连锁失败；`product-startup` 测试写死 Windows 路径；
- `typecheck:runtime-foundation` 92 个错误为本分支原有；nuxt typecheck 7 个错误为 master 原有（Lab 场景缺 `width`）。

## 下一步

合入 master 暂停：本分支带有上述测试回归，直接合入会让 master 的全量测试多出 416 条失败。先修复分支基线，再合入。
