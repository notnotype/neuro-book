---
schema: nbook.work/v1
workId: w00018-pre-nb-ui-baseline
issueId: null
---

# nb-ui 底座迁移前基线运行验证

在 `refactor/w00003-nb-ui-adoption` 合入 `master`（`bb688931`，2026-09-22 17:51）之前的最后一个 master revision `67f809e9` 上创建隔离 checkout，启动 Source Dev 主应用，确认该基线可运行并记录可观察状态。

选点依据：`bb688931` 是本仓库唯一一次 `refactor/w00003-nb-ui-adoption` 合并（nb-ui 主应用 UI 底座迁移，i191）；其第一父 `67f809e9` 即迁移前的 master 状态。该点也是 CI `Product Platform Checks` 最后一次通过附近的位置（`bb688931` 之后的非文档提交起转为失败）。

## 交付边界

- worktree `.worktree/w00018-pre-nb-ui-baseline`，分支 `chore/w00018-pre-nb-ui-baseline`，基线 revision `67f809e9`。
- 只启动与观察：安装该 revision 自带 `bun.lock` 的依赖，运行 Source Dev，记录可访问性与界面状态。
- 不修改代码、不提交、不 push、不合并、不调用真实 Provider/Model。

## 非目标

- 不修复该基线上发现的问题（如需修复另立项）。
- 不将该基线合入 `master`，也不作为其它 Work 的实现基线。
- 不清理其它 Work 的 worktree 或分支。

## 进展

- 2026-09-28：worktree 与分支已创建，依赖安装、App SQLite 与 Application State 迁移完成；Source Dev 以 `0.0.0.0:3010` 启动，局域网 `http://192.168.1.18:3010/` 可访问，界面实测渲染正常。详见 [t01 快照](tasks/t01-baseline-startup/README.md)。
- 2026-09-28：按用户要求接上原有作品——默认 State Root 复制为基线专属副本（651 M / 10 个 workspace），书架显示 7 部作品；原 root 未被改动。
- 2026-09-28：经用户授权清理 3000–3004 上 5 个无父进程的遗留 dev 实例（4 个在 w00017 worktree、1 个在主工作区），load 由 4.09 降至 1.25。

- 2026-09-28：经开发者调整，本基线改为常驻 **3000** 端口并接真实 State Root（`~/.local/share/NeuroBook/data`），作为日常可用的重构前版本；3001 交给 w00017 开发版（用本 Work 的隔离副本数据）。改动前已把真实 root 完整备份到 `~/.local/share/NeuroBook-backup-20260928-pre-w00018`（655 M）。两侧 migration 集合完全相同，无 schema 漂移。

## 环境注意（本 Work 之外仍需处理）

在 omp 会话里用裸 `git worktree add` 会被接管成「复制工作区」的实现；当目标路径位于工作区内时产生自我递归复制（533 万文件 / 3.7 GB，永不结束）。`/usr/bin/git worktree add` 才走真实 git（同参数 0.93s 完成）。详见交付汇报的回写建议。
