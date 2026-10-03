# Workspace Template 资产规范

适用：`packages/neuro-book/assets/workspace/**` 中除 `.nbook/agent/**` 外的分发模板、schema 和系统资产源码。

- `packages/neuro-book/assets/workspace` 是新 Project 的分发输入；修改前确认目标是模板源码、用户可编辑初始内容还是生成投影。
- 路径、默认值和 schema 必须与 Project Workspace 当前规范、安装投影和升级策略一致；不能依赖开发仓库绝对路径或本机状态。
- 模板保持最小、可重放和确定性；用户创建 Project 后拥有其副本，后续同步不能覆盖用户内容。
- TypeScript schema 同时读取 [`common.md`](common.md)、[`languages/typescript.md`](languages/typescript.md) 和 [`contracts.md`](contracts.md)。结构化配置追加 [`data-formats.md`](data-formats.md)。
- 修改后运行 system asset projection、Project 创建和模板消费的聚焦测试；生成目录由正式命令更新。

完成标准：干净 Project 可从模板创建，分发资产不含本机路径或秘密，用户所有文件不会被后续投影覆盖。