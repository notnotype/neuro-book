---
schema: nbook.task/v2
taskId: t12-flock-into-file-lock
status: planned
updated: 2026-11-13
---

# 不判旧的文件锁并入 nb-file-lock 并随 nb-story 发布

## 目标与范围

工作区里现在有两份几乎相同的“不判旧”的系统文件锁 `tryLock`：经 `bun:ffi` 调 `flock`（Linux、macOS）或 `LockFileEx`（Windows），进程怎样结束锁都由系统放掉。

- nb-harness 的 `src/kernel/log/flock.ts`：会话日志的锁（`kernel/log/files.ts`）；w00032 t15 把它开成公开子路径 `@notnotype/nb-harness/file-lock`，应用的 Skill 安装用它（`plugins/agent/backend/skills/install.ts`）。
- nb-story 的 `src/platform/flock.ts`：书库、导入与问答配置的锁（`server/registry.ts`、`ingest/store.ts`、`qa/config.ts`），nb-harness 那份是照它写的（[ADR 0031](../../../../../docs/adr/0031-nb-story-supports-windows.md)）。

把它合成一份，放进 nb-file-lock 的单独子路径（暂名 `./flock`，不引 `proper-lockfile`），nb-harness 与 nb-story 都改从那里取，删掉两份副本；nb-file-lock 加进随 nb-story 发布的工作区包。

合同：用户可观察的行为不变（锁的语义与失败照旧）。要改的是包的边界与发布：[ADR 0045](../../../../../docs/adr/0045-shared-host-packages-for-second-app.md) 决策 4（三个新包不发 npm）对 nb-file-lock 改为随 nb-story 发布，按规则追加决策记录；[ADR 0029](../../../../../docs/adr/0029-workspace-packages-publish-source-to-npm.md) 的发布清单、[`monorepo-boundaries.md`](../../../../../docs/modules/monorepo-boundaries.md) 的 nb-file-lock 与 nb-harness 两行、根 README 的包表随之改。用到这把锁的行为合同在 [`agent/skills.md`](../../../../../docs/specs/agent/skills.md)（初始化的锁）与 nb-story 的 Spec 里，不改。

## 来源与决定

- w00032 t15 收口的后端实现审查第 10 条（[处理](../../../w00032-agent-integration/tasks/t15-skills/evidences/impl-review-handling.txt)）：跨进程锁从 nb-harness 的内部日志模块开了公开子路径，与 nb-file-lock 职责重叠。
- 开发者 2026-11-13 问 nb-file-lock 为什么是 private：ADR 0045 决策 4 只写了不发 npm、要发布时另行决定，没有记录别的理由；`private: true` 当时是 t02 计划的待确认项，开发者没有单独作答，按“待确认默认追认”定下（w00043 README 的 2026-11-10 记录）。推断当时只是用不着发：只有仓库里的两个应用用它。同日在三个候选里定 A：放进 nb-file-lock 的单独子路径并随 nb-story 发布（B 是留在 nb-harness、只让 nb-story 改用它；C 是维持两份副本）。不把 nb-file-lock 并进 nb-harness：它的主要使用者（设置、Files、插件平台、nb-host 的状态根认领）与 Agent 无关。

## 要在计划里查清的

- nb-file-lock 的主入口 `.`（`holdLock`、加锁替换）建在 `proper-lockfile` 上，靠仓库根的补丁（`patches/proper-lockfile@4.1.2.patch`，租约精度）；`patchedDependencies` 只在本仓库生效，从 npm 装的人拿到的是没打补丁的版本。nb-harness 与 nb-story 只引 `./flock`，不执行它，但 npm 包仍会声明并装上 `proper-lockfile`。计划里定：在包的说明里写明，还是另有做法。
- 发布链：`scripts/release/packages.ts` 的清单按依赖顺序，nb-file-lock 要排在 nb-harness 之前；`release:check` 对发布文件的检查（`files` 白名单、源码导入）；应用包 `@notnotype/neuro-book` 现在怎样带上 private 的 nb-file-lock，改成公开包之后要不要变。
- 两份副本的差异只在注释，逐行核对后再合；nb-story 的 Windows 实现（ADR 0031）与测试一起搬。
- 验证：nb-file-lock、nb-harness（会话日志的锁）、nb-story（书库与导入的锁、跨进程用例）、应用的 Skill 安装测试，加 `release:check` 与打包检查。

## 当前状态

2026-11-13 经 nbdev 新建，尚未开工。

## 下一步

按 implementation-planning 写 `plan.md`，交开发者确认后再动代码。
