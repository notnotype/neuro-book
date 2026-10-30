---
schema: nbook.task/v2
taskId: t19-mcp
status: done
updated: 2026-10-30
---

# MCP 插件

## 目标与范围

定 MCP 插件：连接 MCP 服务、把它的工具与资源接进工具登记与工具发现。

来源：需求 14（[报告](../t01-survey/artifacts/report/index.html)第 14 条）。

合同：本 Task 只做设计讨论，行为合同未变；定稿后在计划里写明改哪些 Spec。

## 要讨论的问题

- 连接与配置：要不要兼容 `.mcp.json`。
- 工具进公共池与工具发现（t04）；整个服务延迟加载。
- 资源接成资源方案（t08）；认证。

## 材料

- [外部参照](../../../../../docs/research/agent-runtime-references.md)第 3、4 节

## 前置

t04、t08、t10。

## 决定（开发者 2026-10-30）

全部按推荐定，MCP 插件另开 [w00036](../../../w00036-mcp/README.md)，11 条决定记在那边的“已定的事”。调研：[各家的 MCP 客户端](../../research/2026-10-30-mcp-client-survey.md)。

对本 Work 其它 Task 的影响：

- t04 决定 1：交给服务商的名字校验从 `^[a-zA-Z0-9_-]{1,128}$` 改为 64 字符上限（OpenAI 超过 64 报 400，omp 源码注释），已在 t04 追记。
- t21：MCP 工具多时经 CodeAct 按需加载，已在 t21 追记。

## 当前状态

讨论完成，转入 w00036。

## 下一步

无；实施在 w00036。
