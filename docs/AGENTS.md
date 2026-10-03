# 文档 Agent 指令

文档分类、真相源优先级和生命周期统一见 [`README.md`](README.md)。本文件只规定 Agent 的读取与交付动作：

- 创建或修改产品行为规范时，读取 [`specs/AGENTS.md`](specs/AGENTS.md)，并更新同一 capability 的单一 Spec 与成熟度登记。
- 整理原始需求或长期方案时，读取 [`proposals/README.md`](proposals/README.md)；Proposal 未沉淀为 Spec 前不作为产品合同。
- 修改 ADR、testing 或 standards 时，读取目标目录 README，只在其职责内写内容，并链接 Spec 而不复制行为正文。
- 活跃文档使用可解析的仓库相对链接；归档和研究材料不能成为当前合同的必要依赖。
- 新建、移动或删除文档后运行 `bun run docs:check`。
