# Content Reference

本目录保存 NeuroBook 内容结构、内容节点、lorebook / simulation 信息分层、Markdown 扩展和 retrieval 的稳定参考。它是 Agent 处理 Project Workspace 内容时的主要入口。

## Entry Points

- [project-structure.md](project-structure.md)：Project Workspace 目录结构总览，说明常用目录、前两层结构和目录归属边界。
- [lorebook.md](lorebook.md)：`lorebook/` 目录、默认类型、扩展类型和边界。
- [manual.md](manual.md)：`manual/` 说明书目录、玩家手册、RP 主持手册、规则/系统/速查入口和边界。
- [manuscript.md](manuscript.md)：`manuscript/` 正文目录、卷章节点和草稿边界。
- [simulation.md](simulation.md)：`simulation/`、subjects、entities、runs 和 simulation profile 合同。
- [subject-rag-memory.md](subject-rag-memory.md)：Subject 级 RAG memory 数据、索引与工具契约，说明当前无内置自动消费者，以及未来 workflow/job 的显式接入边界。
- [content-references.md](content-references.md)：内容节点引用、inline Markdown links、structured refs 和校验规则。
- [directory-protocol.md](directory-protocol.md)：旧综合入口的兼容索引，指向上面拆分后的目录规范。
- [information-control.md](information-control.md)：Prototype / Entity / Subject 信息控制模型，说明 subject knowledge、entity state 和 lorebook canon 的边界。
- [markdown-dialect.md](markdown-dialect.md)：NeuroBook Markdown 扩展格式。
- [retrieval.md](retrieval.md)：内容节点 `retrieval` frontmatter 以及 retrieval profile 到 writer 的 handoff 合同。
- [../agent/profile-context-memory.md](../agent/profile-context-memory.md)：profile-scoped context memory、generated recommendations 和 `.nbook/context-access` 边界。
- [state.md](state.md)：内容节点同级 `state.md` 当前状态兼容规范。
- [middleware.md](middleware.md)：内容校验、引用规范化和领域前置校验入口。
- [旧信息控制入口（已归档）](../../../docs/archived/reference/content/lorebook-information-control.md)：旧文件名兼容入口的历史记录。

## Reading Rules

- 创建、移动、校验 lorebook / manuscript 内容节点时，先参考 [../agent/project-workspace-guide.md](../agent/project-workspace-guide.md) 的短指南。
- 设计目录结构、实体状态、RP 说明书、SillyTavern worldbook 迁移或 Project 模板时，先读 [project-structure.md](project-structure.md)，再读对应细分文档。
- 设计角色可知信息、subject knowledge、entity hidden state 或显式记忆检索/注入流程时，读 [information-control.md](information-control.md) 和 [subject-rag-memory.md](subject-rag-memory.md)。
- 修改 Markdown 正文、批注和富文本兼容格式时，读 [markdown-dialect.md](markdown-dialect.md)。
- 为 writer 选择设定上下文时，读 [retrieval.md](retrieval.md) 和 [../agent/profile-context-memory.md](../agent/profile-context-memory.md)；不要把 retrieval 的 `reason` / `use` / `risk` 直接传给 writer。
