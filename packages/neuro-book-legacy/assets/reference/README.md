# NeuroBook Reference Bookshelf

本目录是 NeuroBook 随版本发布的 Reference Seed Source。Profile 仍使用逻辑路径 `reference/**`；Source 从应用源码 `assets/reference/` 读取，Product 构建将其投影到 `server/assets/reference/`，均不依赖仓库根路径。显式 Runtime 下的物理 Reference 根由当前 Runtime asset adapter 解析，调用方不得从 cwd 或 checkout 根 `reference/` 推断路径。

## Modules

- [Agent Runtime](agent/README.md)：Profile、Session、Workflow、Skill、Job 与协作协议。
- [Content / Project Workspace](content/README.md)：内容节点、Workspace、Lorebook、Manuscript 与检索协议。
- [Plot](plot/README.md)：Story、Thread、Scene、Writer Brief 与 Agent 协作协议。
- [World Engine](world-engine/README.md)：时间线、Subject、Schema、Calendar 与写作协作协议。
