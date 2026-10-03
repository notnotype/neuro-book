# 仓库现状

截至 2026-10-03（分支 `refactor/w00017-runtime-foundation`）。本文只记录仓库级现状；具体 TODO 以 GitHub Issue 为准，实现过程与证据以对应 Work/Task 为准。旧应用时期的现状记录见 [`docs/archived/project-status-2026-08-17.md`](docs/archived/project-status-2026-08-17.md)。

## 当前方向

本分支按 [NeuroBook v2：并排重建应用](docs/proposals/neuro-book-v2-rebuild.md)（2026-10-03 `accepted`）从零重建应用，技术选型见 [ADR 0023](docs/adr/0023-v2-frontend-backend-stack.md)：去掉 Nuxt，前端 Vue + Vite，后端 Bun + Hono，校验统一 TypeBox。分支是长期分支，暂不合入 master；master 上的现有版本不受影响。

| 位置 | 状态 |
|---|---|
| `packages/neuro-book` | 新应用，当前只有包描述与目录约定；先建运行时底座与 workbench 底座，Files 竖切在这个壳子上验证 |
| `packages/neuro-book-legacy` | 旧应用（Nuxt），只作代码与行为参照；含 w00017 阶段 1 的内核、三类宿主与内置插件实现 |
| `docs/archived/` | 旧应用时期的 Spec、代码规范、人工评测与用户文档站 |
| 交付链 | Manager、桌面版、打包、发布、安装与部署脚本已在本分支删除；新应用的交付另行设计 |

## 推进顺序

当前 Work 为 [w00017](.agents/works/w00017-application-runtime-architecture/README.md)，推进顺序见其[整体实施路径](.agents/works/w00017-application-runtime-architecture/implementation-plan.md#2026-10-03-暂停改为并排新建应用)：

1. 仓库整理（[t43](.agents/works/w00017-application-runtime-architecture/tasks/t43-repository-reorganization/README.md)）；
2. 内核抽成 `nb-runtime` 包；
3. 应用骨架：后端宿主、`nbook.http`、`nbook.diagnostics`、开发监督进程、Vite 前端与浏览器宿主；
4. workbench 底座与 Lab 插件；
5. Files 竖切：资源层、文件资源管理器视图、编辑器打开与切换。

## 已知问题

- Storage 多窗口 `STORAGE_CONTEXT_INVALID`：[#246](https://github.com/notnotype/neuro-book/issues/246)，Storage 将重新设计；新应用在此之前不使用服务端 Storage。
- `neuro-agent-harness` 已冻结，只服务 `llmlint`，待由 `nb-harness` 取代后退役。
