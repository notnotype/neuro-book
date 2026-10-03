# 归档文档

`docs/archived/` 保存旧应用（[`packages/neuro-book-legacy`](../../packages/neuro-book-legacy/AGENTS.md)）时期的 Spec、代码规范、人工评测与用户文档站。它们**不是当前合同**，代码、测试与 Agent 不得把这里的内容当作现行行为依据；功能迁回新应用时，把仍然适用的部分重新确认后写入 [`../specs/`](../specs/README.md) 或 [`../standards/`](../standards/README.md)。

归档依据见 [NeuroBook v2：并排重建应用](../proposals/neuro-book-v2-rebuild.md) 方案第 1 节（2026-10-03）。目录保留归档前的相对结构：

| 目录 | 内容 |
|---|---|
| `specs/` | 不在新应用壳子范围的 Spec：Agent、媒体、Agent 相关界面、模型角色选择 |
| `standards/code/` | 针对旧应用与交付链的代码规范：Agent 资产、数据库、交付、桌面、文档站、后端（Nitro）、工作区资产、Nuxt 构建配置 |
| `testing/manual-eval/` | 旧产品的人工评测 |
| `vitepress/` | 旧产品的用户文档站 |

归档文件中的相对链接指向归档前的位置，可能失效；需要原文时以 git 历史为准。
