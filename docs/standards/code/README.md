# 编码规范路由

按改动路径读取下表列出的文件；跨领域改动合并各行的必读文件。最近作用域 `AGENTS.md` 继续补充目录专属合同。完成标准：每个改动文件都被至少一条路径覆盖，且没有加载未涉及领域的规范。

| 改动路径 | 必读规范 |
|---|---|
| `app/**`、前端 `plugins/**`、`uno.config.ts` | [`common.md`](common.md)、[`languages/typescript.md`](languages/typescript.md)、[`frontend.md`](frontend.md)；新增或修改 `.vue` 组件时追加 [`components.md`](components.md) |
| `server/**` | [`common.md`](common.md)、[`languages/typescript.md`](languages/typescript.md)、[`server.md`](server.md)；涉及数据库时追加 [`database.md`](database.md) |
| `shared/**`、`profile-sdk/**`、`variable-sdk/**`、`world-engine/schema/**` | [`common.md`](common.md)、[`languages/typescript.md`](languages/typescript.md)、[`contracts.md`](contracts.md) |
| `packages/neuro-book/assets/workspace/.nbook/agent/**` 源码 | [`common.md`](common.md)、对应语言规范、[`agent-assets.md`](agent-assets.md)；`.compiled/`、`.staging/` 和 artifact 生成物不编辑 |
| `packages/neuro-book/assets/workspace/**` 其它分发资产 | [`common.md`](common.md)、[`workspace-assets.md`](workspace-assets.md)；按文件类型追加语言或 [`data-formats.md`](data-formats.md) |
| `desktop/electron/**/*.ts`、`desktop/electron/**/*.mjs` | [`common.md`](common.md)、[`languages/typescript.md`](languages/typescript.md)、[`desktop/electron.md`](desktop/electron.md) |
| `desktop/electron/**/*.html` | [`common.md`](common.md)、[`desktop/host-ui.md`](desktop/host-ui.md)、[`desktop/electron.md`](desktop/electron.md) |
| `desktop/tauri/**/*.rs`、`Cargo.toml`、Tauri capability/config | [`common.md`](common.md)、[`desktop/tauri.md`](desktop/tauri.md)；结构化配置追加 [`data-formats.md`](data-formats.md) |
| `desktop/tauri/frontend/**` | [`common.md`](common.md)、[`desktop/host-ui.md`](desktop/host-ui.md) |
| `desktop/shared/**`、`desktop/packaging/**` | [`common.md`](common.md)、[`languages/typescript.md`](languages/typescript.md)、[`desktop/shared.md`](desktop/shared.md) |
| `packages/**` | [`common.md`](common.md)、[`languages/typescript.md`](languages/typescript.md)、[`packages.md`](packages.md) |
| `prisma/**`、`prisma.config.ts` | [`common.md`](common.md)、[`database.md`](database.md) |
| 根 `nuxt.config.ts`、`vitest.config.ts`、`*.d.ts`、`bunfig.toml` 等工具链配置 | [`common.md`](common.md)、对应语言规范、[`tooling.md`](tooling.md) |
| `vitepress/**` 源码、主题和站点配置 | [`docs-site.md`](docs-site.md)；涉及 TypeScript/Vue/CSS 时按该文件追加前端组合 |
| `.github/**`、`packages/**/Dockerfile*`、`Dockerfile*`、`docker-compose.yml`、`packages/**/docker-compose*.yml`、`patches/**`、仓库级交付配置 | [`common.md`](common.md)、[`delivery.md`](delivery.md)；按文件类型追加 [`data-formats.md`](data-formats.md) 或 shell 规范 |
| `scripts/**/*.ts`、`scripts/**/*.mjs` | [`common.md`](common.md)、[`languages/typescript.md`](languages/typescript.md)、[`scripts/typescript.md`](scripts/typescript.md) |
| `scripts/**/*.ps1`、`scripts/**/*.cmd` | [`common.md`](common.md)、[`scripts/powershell.md`](scripts/powershell.md) |
| `scripts/**/*.sh`、容器 shell 入口 | [`common.md`](common.md)、[`scripts/bash.md`](scripts/bash.md) |
| `.agents/works/w00005-novel-understanding-spike/tasks/t02-novel-memory-model-design/schema-v6.ts` | [`common.md`](common.md)、[`languages/typescript.md`](languages/typescript.md) |
| `.agents/works/w00005-novel-understanding-spike/tasks/t02-novel-memory-model-design/viewer-v6.template.html` | [`common.md`](common.md)、[`frontend.md`](frontend.md) |
| `.agents/works/w00005-novel-understanding-spike/tasks/t02-novel-memory-model-design/scripts/**/*.ts`、`.agents/works/w00005-novel-understanding-spike/tasks/t03-extraction-pipeline-design/scripts/**/*.ts` | [`common.md`](common.md)、[`languages/typescript.md`](languages/typescript.md)、[`scripts/typescript.md`](scripts/typescript.md) |
| `.agents/works/w00005-novel-understanding-spike/tasks/t03-extraction-pipeline-design/evidences/v6/**/*.json` | [`data-formats.md`](data-formats.md) |
| `.agents/skills/**/*.md` | [`common.md`](common.md)、[`.agents/skills/README.md`](../../../.agents/skills/README.md) |
| `.json`、`.yaml`、`.yml` 配置 | 对应领域规范，再追加 [`data-formats.md`](data-formats.md) |

不在表中的源码先按所有权找到最近的 `AGENTS.md`；仍无法确定归属时，更新本路由后再实现，避免临时选择一套相似规范。
