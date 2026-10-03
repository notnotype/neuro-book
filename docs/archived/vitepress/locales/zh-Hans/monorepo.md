# Monorepo 布局

仓库根负责 workspace 编排、统一文档、CI、治理、安装、交付、发布和 Desktop Envelope。主应用位于 `packages/neuro-book`；各自治包独立拥有源码、测试、Task 和工程文档。

| Owner | 内容 |
| --- | --- |
| `packages/neuro-book` | NeuroBook 应用、应用脚本、应用 Task、系统运行期资料 |
| `packages/neuro-book-manager` | 安装、更新、实例和 Runtime 管理 |
| `packages/neuro-book-contracts` | 跨宿主线协议和数据合同 |
| `packages/neuro-book-test-support` | 共享测试临时根与 fixture 支持 |
| 六个自治项目 | `neuro-agent-harness`、`llmlint`、`nb-history`、`nb-workflow`、`nb-memory`、`nb-ui` |
| `desktop` | Electron、Tauri、共享宿主与 portable packaging |
| `vitepress` | 整个 monorepo 的中英文用户文档 |

在仓库根执行 `bun install --frozen-lockfile` 安装 workspace 依赖。开发主应用使用 `bun --cwd packages/neuro-book run dev`；各自治项目的命令见[项目总览](/projects/)。工程边界的唯一正文保留在仓库的 `docs/modules/monorepo-boundaries.md`，不复制到发布站点。
