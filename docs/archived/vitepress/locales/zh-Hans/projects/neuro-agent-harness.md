# NeuroAgentHarness

`@notnotype/neuro-agent-harness` 是多宿主 Agent Harness，提供 Profile、Run Kernel、append-only Session、Invocation、approval、compaction、工具循环、事件恢复，以及可替换的 Session Store 和 Model Runtime。

## 安装

```bash
bun add @notnotype/neuro-agent-harness@0.1.0
```

Node.js 22 ESM 项目也可以使用 npm 安装。包发布 ESM、类型声明和用户文档。

## 公开入口

根导出包含 Harness、Profile、Tool、Capability、Session/Event/Model 合同、Workflow helper 与错误类型；`storage/memory`、`storage/jsonl` 和 `testing` 提供明确的子入口。Session 持久化、Provider、SSE/HTTP、文件授权和宿主产品概念仍由 Adapter 持有。

完整不变量、恢复语义与自定义 Store 要求见[项目 README](https://github.com/notnotype/neuro-book/blob/master/packages/neuro-agent-harness/README.md)。
