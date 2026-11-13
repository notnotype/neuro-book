---
schema: nbook.task/v2
taskId: t12-flock-into-file-lock
status: active
updated: 2026-11-13
---

# 不判旧的文件锁单独成包 nb-flock 并随 nb-story 发布

目录名保留建 Task 时的 `t12-flock-into-file-lock`；方向在计划审查后改了，见“来源与决定”。

## 目标与范围

工作区里现在有两份几乎相同的“不判旧”的系统文件锁 `tryLock`：经 `bun:ffi` 调 `flock`（Linux、macOS）或 `LockFileEx`（Windows），进程怎样结束锁都由系统放掉。

- nb-harness 的 `src/kernel/log/flock.ts`：会话日志的锁（`kernel/log/files.ts`）；w00032 t15 把它开成公开子路径 `@notnotype/nb-harness/file-lock`，应用的 Skill 安装用它（`plugins/agent/backend/skills/install.ts`）。
- nb-story 的 `src/platform/flock.ts`：书库、导入与问答配置的锁（`server/registry.ts`、`ingest/store.ts`、`qa/config.ts`），nb-harness 那份是照它写的（[ADR 0031](../../../../../docs/adr/0031-nb-story-supports-windows.md)）。

把它合成一份，单独做成零依赖的小包 `@notnotype/nb-flock`，nb-harness、nb-story 与应用都改从那里取，删掉两份副本和 nb-harness 的 `./file-lock`；nb-flock 加进随 nb-story 发布的工作区包。nb-file-lock 不动（仍是 private、只有 `.`）。

合同：用户可观察的行为不变（锁的语义与失败照旧）。要改的是包的边界与发布：新公开包按 `packages/AGENTS.md` 先记跨 Module 决策（新 ADR 0052，补充 [ADR 0029](../../../../../docs/adr/0029-workspace-packages-publish-source-to-npm.md) 的发布清单）；[`monorepo-boundaries.md`](../../../../../docs/modules/monorepo-boundaries.md)、包目录规则、发布流程文档与根 README 的包表随之改。用到这把锁的行为合同在 [`agent/skills.md`](../../../../../docs/specs/agent/skills.md)（初始化的锁）与 nb-story 的 Spec 里，不改。

## 来源与决定

- w00032 t15 收口的后端实现审查第 10 条（[处理](../../../w00032-agent-integration/tasks/t15-skills/evidences/impl-review-handling.txt)）：跨进程锁从 nb-harness 的内部日志模块开了公开子路径，与 nb-file-lock 职责重叠。
- 开发者 2026-11-13 问 nb-file-lock 为什么是 private：ADR 0045 决策 4 只写了不发 npm、要发布时另行决定，没有记录别的理由；`private: true` 当时是 t02 计划的待确认项，开发者没有单独作答，按“待确认默认追认”定下（w00043 README 的 2026-11-10 记录）。推断当时只是用不着发：只有仓库里的两个应用用它。同日在三个候选里先定 A：放进 nb-file-lock 的单独子路径并随 nb-story 发布（B 是留在 nb-harness、只让 nb-story 改用它；C 是维持两份副本）。不把 nb-file-lock 并进 nb-harness：它的主要使用者（设置、Files、插件平台、nb-host 的状态根认领）与 Agent 无关。
- 开发者 2026-11-13 指定计划审查用两位 Sonnet，一位从整体看方向（[细节](evidences/design-review-detail.txt)、[整体](evidences/design-review-overview.txt)、[处理](evidences/design-review-handling.txt)）。整体审查指出 A 要把 nb-file-lock 整包公开：17 个导出、`proper-lockfile` 与它的 3 个依赖随 nb-story 装到用户那里却用不到，`.` 入口在 npm 上缺仓库补丁；并提出候选 E。开发者同日改定 **E**（“按推荐”）：单独成零依赖的小包，包名 `nb-flock`；审查的其余处理照推荐。三个待确认项照推荐：直接去掉 `./file-lock` 不留转发（从没发布过）；nb-story 的锁报错改成中性英文；这次不改版本号、不发布。
- 下次发布必须同时提 nb-harness 与 nb-story 的版本号：`release:publish` 跳过同号的已发布版本，只提 nb-flock 会发出一个没人依赖的孤包。

## 当前状态

2026-11-13 完成，已合入 master（合并提交里分支的三个提交：新包与发布登记、改用新包并删两份副本、实现审查的修正），文档在 master 上单独提交。

- 新包 `packages/nb-flock`：代码以 nb-story 那份为底，只换了三处报错文字，Windows 段与实测版一致；零运行时依赖，加进以源码发布的清单（10 个，冒烟 12 个包）。
- nb-harness、nb-story 与应用改从 `@notnotype/nb-flock` 取锁；删掉 nb-story 的 `src/platform/flock.ts`、nb-harness 的 `src/kernel/log/flock.ts` 与 `./file-lock` 子路径。
- 文档：[ADR 0052](../../../../../docs/adr/0052-non-stale-file-lock-package.md)（补充 ADR 0029 的发布清单、两种锁怎么选、下次发布的约束）、边界文档、`packages/AGENTS.md`、发布流程的包数、两份根 README、根 `AGENTS.md` 结构图、[`agent/skills.md`](../../../../../docs/specs/agent/skills.md) 实现合同；w00046 t11 记了包数变 12 与 nb-flock 首发要手工。
- 审查：计划审查两位 Sonnet（细节阻断 0、重要 4、建议 4 加 1；整体阻断 0、重要 3、建议 3，引出方案 E）；实现审查 Opus（阻断 0、重要 1、建议 5，改 5 条、1 条不改），证据与处理在 [`evidences/`](evidences/)。

验证：nb-flock `bun test`（4 例）与 `typecheck`；nb-harness `src/kernel/log` 与 `src/kernel/architecture.test.ts`（37 例）与 `typecheck`；nb-story `bun test`（669 例）与 `typecheck`；应用 `install.test.ts` 与 `architecture.test.ts`（16 例）；`scripts/release/packages.test.ts` 与 `scripts/ci/test-conventions.test.ts`（13 例）；`release:check`；`prox bun run release:smoke` 通过（从 tarball 装上 nb-story 与 nb-flock，`nbstory serve` 起停正常）；`docs:check` 没有新的失败。没验证的边界：Windows 上的 `LockFileEx` 路径这次没有实测，代码与 nb-story 实测过的那份相同（只差报错文字）。

## 下一步

无。下次发布时：nb-flock 首发由开发者在本机手工完成（npm 要包已存在才能配信任发布），并同时提 nb-harness 与 nb-story 的版本号（见 ADR 0052 的后果）。
