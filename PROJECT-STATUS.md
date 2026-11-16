# 仓库现状

截至 2026-10-27（master）。本文只记录仓库级现状；具体 TODO 以 GitHub Issue 为准，实现过程与证据以对应 Work/Task 为准。旧应用时期的现状记录见 [`docs/archived/project-status-2026-08-17.md`](docs/archived/project-status-2026-08-17.md)。

## 当前方向

按 [NeuroBook v2：并排重建应用](docs/proposals/neuro-book-v2-rebuild.md)（2026-10-03 `accepted`）从零重建应用，技术选型见 [ADR 0023](docs/adr/0023-v2-frontend-backend-stack.md)：前端 Vue + Vite，后端 Bun，校验统一 TypeBox。v2 已在 master 上，第一个预览版是 0.11.0（w00027 t15）。

| 位置 | 状态 |
|---|---|
| `packages/neuro-book` | 新应用：书架、工作台外壳、文件资源管理器、Markdown 与源码编辑器、图片与 HTML 预览、设置窗口、插件平台与插件页、命令行 `nbook`、插件 SDK 与作者命令 `nbooke`。已实现的行为见 [`docs/specs/README.md`](docs/specs/README.md) 的“已实现规范” |
| `packages/nb-runtime` | 内核：生命周期、服务装配、插件、运行实例与门禁、诊断、远程服务；前后端宿主共用 |
| `packages/neuro-book-legacy` | 旧应用（Nuxt），只作代码与行为参照 |
| `docs/archived/` | 旧应用时期的 Spec、代码规范、人工评测与用户文档站 |
| 交付 | npm：应用 `@notnotype/neuro-book` 与 SDK `@notnotype/nb-plugin-sdk` 发构建产物（[ADR 0033](docs/adr/0033-app-delivered-as-built-npm-package.md)），nb-story 与它依赖的 8 个包发源码（[ADR 0029](docs/adr/0029-workspace-packages-publish-source-to-npm.md)）；发布步骤见 [发布手册](docs/standards/releasing.md)（打标签发布，本机发布作备用；阶段与变更记录见 [ADR 0053](docs/adr/0053-release-stages-and-changelog.md)）。桌面版、后台运行与服务器部署还没有，见 w00027 的后续事项 |
| CI | `.github/workflows/ci.yml`：推 master 与 PR 都跑本地的验证门禁（治理、文档、`test:affected --typecheck`）与应用包、SDK 的打包；e2e 在本地跑 |

## 进行中的工作

current Work 见 [`.agents/works/`](.agents/works/README.md)。插件平台与发行在 [w00027](.agents/works/w00027-plugin-platform/README.md)；Agent 相关的重建在 w00002（harness）、w00019（对话视图）；剧情图谱在 w00024。

## 已知问题

- 新应用在 Windows 与 macOS 上整体未验证；实例认领在 Windows 上用命名管道，Bun 上有失败的报告（ADR 0033 的后果）。
- `neuro-agent-harness` 已冻结，只服务 `llmlint`；`llmlint` 准备退役，`test:affected` 与 CI 不再测它。
- 仓库体积（2026-10-24 查）：`.git` 257 MB，打包后的历史 224 MB，其中图片约 135 MB（官网插画、nb-ui playground 壁纸与 w00017 的评审截图）。暂不改写历史（会让 Task 记录里的提交号失效）；要瘦身时再定是删当前副本还是用 filter-repo。
