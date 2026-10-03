# 编码规范路由

按改动路径读取下表列出的文件；跨领域改动合并各行的必读文件。最近作用域 `AGENTS.md` 继续补充目录专属合同。完成标准：每个改动文件都被至少一条路径覆盖，且没有加载未涉及领域的规范。

| 改动路径 | 必读规范 |
|---|---|
| `packages/neuro-book/src/web/**`、`packages/neuro-book/src/plugins/*/web/**`、`uno.config.ts` | [`common.md`](common.md)、[`languages/typescript.md`](languages/typescript.md)、[`frontend.md`](frontend.md)；新增或修改 `.vue` 组件时追加 [`components.md`](components.md) |
| `packages/neuro-book/src/server/**`、`packages/neuro-book/src/plugins/*/server/**` | [`common.md`](common.md)、[`languages/typescript.md`](languages/typescript.md)；后端专属规范在应用骨架阶段补充（旧应用的 Nitro 后端规范已归档） |
| `packages/neuro-book/src/plugins/*/shared/**`、`packages/neuro-book/src/manifest.ts` | [`common.md`](common.md)、[`languages/typescript.md`](languages/typescript.md)、[`contracts.md`](contracts.md) |
| `packages/**`（应用之外的包） | [`common.md`](common.md)、[`languages/typescript.md`](languages/typescript.md)、[`packages.md`](packages.md) |
| `vite.config.ts`、`vitest.config.ts`、`*.d.ts`、`bunfig.toml` 等工具链配置 | [`common.md`](common.md)、对应语言规范 |
| `.github/**`、`patches/**`、仓库级 CI 配置 | [`common.md`](common.md)；按文件类型追加 [`data-formats.md`](data-formats.md) 或 shell 规范 |
| `scripts/**/*.ts`、`scripts/**/*.mjs` | [`common.md`](common.md)、[`languages/typescript.md`](languages/typescript.md)、[`scripts/typescript.md`](scripts/typescript.md) |
| `scripts/**/*.ps1`、`scripts/**/*.cmd` | [`common.md`](common.md)、[`scripts/powershell.md`](scripts/powershell.md) |
| `scripts/**/*.sh`、容器 shell 入口 | [`common.md`](common.md)、[`scripts/bash.md`](scripts/bash.md) |
| `.agents/works/w00005-novel-understanding-spike/tasks/t02-novel-memory-model-design/schema-v6.ts` | [`common.md`](common.md)、[`languages/typescript.md`](languages/typescript.md) |
| `.agents/works/w00005-novel-understanding-spike/tasks/t02-novel-memory-model-design/viewer-v6.template.html` | [`common.md`](common.md)、[`frontend.md`](frontend.md) |
| `.agents/works/w00005-novel-understanding-spike/tasks/t02-novel-memory-model-design/scripts/**/*.ts`、`.agents/works/w00005-novel-understanding-spike/tasks/t03-extraction-pipeline-design/scripts/**/*.ts` | [`common.md`](common.md)、[`languages/typescript.md`](languages/typescript.md)、[`scripts/typescript.md`](scripts/typescript.md) |
| `.agents/works/w00005-novel-understanding-spike/tasks/t03-extraction-pipeline-design/evidences/v6/**/*.json` | [`data-formats.md`](data-formats.md) |
| `.agents/skills/**/*.md` | [`common.md`](common.md)、[`.agents/skills/README.md`](../../../.agents/skills/README.md) |
| `.json`、`.yaml`、`.yml` 配置 | 对应领域规范，再追加 [`data-formats.md`](data-formats.md) |

旧应用 `packages/neuro-book-legacy/**` 只读，不在本路由范围内。不在表中的源码先按所有权找到最近的 `AGENTS.md`；仍无法确定归属时，更新本路由后再实现，避免临时选择一套相似规范。
