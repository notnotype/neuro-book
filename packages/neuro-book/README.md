# NeuroBook

NeuroBook v2 的应用包：在原路径从零重建，先只有运行时底座与 workbench 底座。方案、技术选型与推进顺序见 [NeuroBook v2：并排重建应用](../../docs/proposals/neuro-book-v2-rebuild.md) 与 [ADR 0023](../../docs/adr/0023-v2-frontend-backend-stack.md)。

旧应用在 [`../neuro-book-legacy/`](../neuro-book-legacy/AGENTS.md)，只作代码与行为参照，不再修改。

当前是应用骨架：后端宿主、`nbook.http`、`nbook.diagnostics`、开发监督进程与浏览器宿主，打开后是空工作台；开发模式下 `/lab` 是 Component Lab（只在开发模式加载，生产构建不含）。工作台外壳、命令与布局随第 4 步后续 Task 加入。`bun run dev` 启动开发模式，目录约定与其它命令见 [`AGENTS.md`](AGENTS.md)。
