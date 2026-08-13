# 文档索引

本目录保存项目文档资产。稳定参考和实现契约放在 `reference/`，仓库级状态放在根目录 `PROJECT-STATUS.md`。

## 目录分工

- `docs/modules/`：模块说明、需求整理和面向开发者的参考资料。
- `docs/adr/`：已经接受、需要长期保留的架构与协议决策。
- `docs/migrations/`：有状态发布的自动或人工升级说明、备份位置和回滚步骤。
- `docs/tutorials/`：面向普通作者用户的产品教程和上手路径。
- `docs/research/`：第三方库、外部资料和方案调研。
- `docs/drafts/`：未定稿草案。
- `docs/tasks/`：重大任务的持续 walkthrough；active task 使用 `{order}-{slug}`，已归档任务放入 `docs/tasks/archived/`。
- `docs/testing/`：测试规范——临时目录与生命周期、测试组织、平台门禁和验收脚本路径约定。
- `docs/changelog/`：历史版本的更新说明，按发布线分文件；英文镜像在 `docs/en/changelog/`。当前版本的更新说明在根目录 `RELEASE.md`，不放这里。
- `docs/archived/`：过期但仍有参考价值的文档。

## 关键入口

- [../CONTRIBUTING.md](../CONTRIBUTING.md)：参与贡献的主入口，说明 Issue、开发规范、Agent 协作、Task 与 PR 流程；英文镜像见 [../CONTRIBUTING.en.md](../CONTRIBUTING.en.md)。
- [English README](https://github.com/notnotype/neuro-book/blob/master/README.en.md)：英文项目入口。
- [../PROJECT-STATUS.md](../PROJECT-STATUS.md)：仓库现状和近期任务。
- [migrations/](migrations/)：Application State 迁移说明；直接启动源码或 Product 前先阅读。
- [operator-bridge.md](operator-bridge.md)：交付与运维桥梁，面向用户和用户 Agent，说明部署、更新、排障和关键文档索引。
- [tutorials/](tutorials/)：基础教程，从第一本书到前三章。
- [core/](core/)：站点内核心能力说明——World Engine、Plot 剧情工坊、Markdown Studio、llmlint。
- [agent/](agent/)：站点内 Agent 心智模型、工具、Workflow 与 Job、三种模式和 Harness 导读。
- [profile/](profile/)：站点内 profile 说明，覆盖 leader、writer 和其他内置 profile。
- [profile-tsx/](profile-tsx/)：站点内 Profile TSX DSL 导读、编写指南、节点说明和示例。
- [operations.md](operations.md)：运行、停止、数据位置、备份与隐私边界。
- [../reference/README.md](../reference/README.md)：NeuroBook Reference Bookshelf。
- [../reference/agent/README.md](../reference/agent/README.md)：Agent 稳定参考入口，处理 profile、prompt、工具协作和 Project Workspace 文件语义时优先阅读。
- [../reference/content/README.md](../reference/content/README.md)：内容结构、lorebook / simulation、Markdown 扩展、retrieval 和 profile context memory 稳定参考入口。
- [../reference/plot/README.md](../reference/plot/README.md)：剧情系统和前端工作区参考。
- [../reference/world-engine/README.md](../reference/world-engine/README.md)：World Engine 参考入口。
- [../reference/workspace/TERMS.md](../reference/workspace/TERMS.md)：Workspace / Project Workspace / user-assets 标准术语，涉及 workspace 覆盖时必须优先引用。
- [../reference/theme/system.md](../reference/theme/system.md)：主题系统参考。
- [modules/README.md](modules/README.md)：模块文档索引。
- [tasks/README.md](tasks/README.md)：任务 walkthrough 规则。
- [tasks/02-pi-agent-harness-migration/README.md](tasks/02-pi-agent-harness-migration/README.md)：当前 Agent 主路径迁移记录。
- [tasks/04-tsx-profile-workbench/README.md](tasks/04-tsx-profile-workbench/README.md)：TSX Profile Workbench 当前实现边界。
- [tasks/06-leader-default-prompt-parity/README.md](tasks/06-leader-default-prompt-parity/README.md)：leader.default prompt、工具和 skill 迁移记录。

## 维护规则

- 新文档先判断是否稳定：稳定参考进入 `reference/<module>/`，未稳定内容进入 `docs/drafts/`。
- 外部资料和技术选型调研进入 `docs/research/`，不要混入稳定参考。
- 重大任务完成后更新 `PROJECT-STATUS.md` 和对应 active `docs/tasks/<order>-<task-slug>/README.md` 或 archived `docs/tasks/archived/<task-slug>/README.md`。
- 同一功能的后续调整继续更新原任务 walkthrough，除非目标已经明显独立。
