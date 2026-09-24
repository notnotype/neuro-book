# NeuroBook 项目文档

根 `docs/` 保存 monorepo 级治理：Spec 注册表、工程标准、测试合同、边界正文和提案流程。主应用专属文档（ADR、数据迁移、runbook、调研、归档、产品提案与术语）位于 [`../packages/neuro-book/docs/`](../packages/neuro-book/docs/)；维护者或 Agent 应从 [`specs/`](specs/) 定位相关 capability 及其 `planned` / `implemented` 成熟度，再按任务触发读取其它资料。

VitePress 源码位于 [`../vitepress/`](../vitepress/)，面向用户发布，不是内部规范真相源；current 一次实现的 Work、Task、过程和证据位于 [`../.agents/works/`](../.agents/works/)，legacy Task 记录位于 [`../.agents/tasks/`](../.agents/tasks/)，二者都不代替当前规范。

## 真相源优先级
1. [`specs/`](specs/)：已批准的 `planned` 目标合同与代码支持的 `implemented` 当前合同；功能行为、状态、数据、接口、失败语义和验收依据只在这里维护。
2. [`../packages/neuro-book/docs/adr/`](../packages/neuro-book/docs/adr/)：已接受架构决策及理由；ADR 不复制完整功能行为。
3. [`../packages/neuro-book/docs/migrations/`](../packages/neuro-book/docs/migrations/)：有状态升级、备份与回滚步骤。
4. [`standards/`](standards/) 与 [`testing/`](testing/)：编码、仓库流程、测试、临时根和证据合同。
5. [`../packages/neuro-book/docs/runbooks/`](../packages/neuro-book/docs/runbooks/)：基于已批准合同执行的开发、诊断和运维步骤。
6. [`proposals/`](proposals/)：尚未生效的方案；accepted 只授权更新规范与创建 Work/Task。
7. [`../.agents/works/`](../.agents/works/)：current 一次实现的范围、role、交接和证据；[`../.agents/tasks/`](../.agents/tasks/) 只保存 legacy provenance。
8. [`../packages/neuro-book/docs/research/`](../packages/neuro-book/docs/research/) 与 [`../packages/neuro-book/docs/archived/`](../packages/neuro-book/docs/archived/)：非规范资料，不用于判断当前行为。

同一 capability 只维护一个 Spec 文件；成熟度在原文件中从 `planned` 晋升为 `implemented`。其它入口只写摘要和链接；判断当前产品已有行为时只使用 `implemented` Spec 或注册的冻结过渡规范。

## 目录分工

```text
docs/                          根文档治理：README、AGENTS、specs 注册表、standards、
                               testing、modules、proposals 索引
packages/neuro-book/docs/      主应用专属文档：术语与 capability Spec、adr、
                               migrations、runbooks、research、proposals、archived
```

`docs/modules/` 仅保留已登记的现有模块正文；Monorepo / Module 边界的唯一正文是 [`modules/monorepo-boundaries.md`](modules/monorepo-boundaries.md)。其它当前规范进入 `specs/`，未批准需求进入 `proposals/`，过时模型进入包内 `archived/`。运行期 Reference 正文由 [`../packages/neuro-book/assets/reference/`](../packages/neuro-book/assets/reference/) 持有。


## 仓库其它文档

- 根目录大写 Markdown 是产品、人类、Agent 或机器消费的入口；正文下沉到对应真相源。`RELEASE.md` 等被程序直接读取的文件可以保留完整机器载荷。
- [`../.agents/works/`](../.agents/works/) 保存 current 一次实现的范围、role、walkthrough 和证据；[`../.agents/tasks/`](../.agents/tasks/) 保存 legacy 记录。Task 完成不改变当前规范的优先级。
- [`../vitepress/`](../vitepress/) 保存用户文档站投影；它描述稳定用户流程，不承担内部工程合同。
- [`../packages/neuro-book/assets/reference/`](../packages/neuro-book/assets/reference/) 是运行期 Reference 资产根；它不是新规范的落点。

## 当前入口

- [规范编程与注册表](specs/README.md)：Spec 成熟度、格式、流水线、capability 归属和 Reference 迁移状态。
- [编码与仓库标准](standards/README.md)：按语言触发的编码规范和维护者仓库流程。
- [Proposal 规则](proposals/README.md)：原始需求如何结构化、评审、批准并沉淀为 `planned` Spec。
- [ADR 索引](../packages/neuro-book/docs/adr/README.md)：长期架构决策。
- [测试与验收](testing/README.md)：自动测试、人工评测、临时根和证据合同；[人工评测体系](testing/manual-eval/README.md)定义用户旅程、判定口径与执行手册。
- [迁移入口](../packages/neuro-book/docs/migrations/README.md)：数据升级、备份与回滚。
- [操作手册](../packages/neuro-book/docs/runbooks/README.md)：基于既有合同执行的当前操作步骤。
- [Reference Bookshelf](../packages/neuro-book/assets/reference/README.md)：运行期 Reference 的应用资产入口。
- [人类贡献指南](../CONTRIBUTING.md)：Issue、开发和 Pull Request 快速流程。
- [项目状态](../PROJECT-STATUS.md)：仓库现状与验收缺口。

## 生命周期与维护

1. 行为变化先在 [`specs/README.md`](specs/README.md) 定位 capability 和成熟度；同一能力只更新一个稳定文件。
2. 新功能和仍有产品歧义的 bug 先写 Proposal；accepted 后形成 `planned` Spec，并在根 `.agents/works/` 创建或复用 Work 与带 canonical role 的 Task。Proposal 本身不成为合同。
3. Spec-first、Work/Task-first 或紧急 code-first 都必须在同一交付中让代码、测试和 Spec 收敛；证据闭合后才把原 Spec 晋升为 `implemented`。
4. 纯内部重构核对行为合同仍成立，不把文件布局写入 Spec。旧行为退出时更新原 Spec；长期理由进入 ADR；有状态升级、备份和回滚进入 migration；操作步骤进入 runbook；考古正文进入 archived。
5. 已完成沉淀的 Proposal 归档；活跃入口不得依赖 archived 内容才能解释行为。
6. VitePress 只投影稳定内容；修改导航、构建根或部署路径时同步 `package.json`、工作流和站点配置。

入口使用触发式指针说明“何时读取”和“目标是什么”，不复制目标正文。活跃文档的相对链接必须解析到仓库内现存目标，带 `#锚点` 时还必须对应目标文件中现存的标题或 HTML `id`：仓库文档按 GitHub 规则计算标题锚点，VitePress 页面按站点规则计算（支持 `{#自定义-id}`）。历史 Task 与 archive 中的旧路径可作为 provenance 保留，但不得被当前规范当作活跃依赖。

## Reference 迁移

迁移状态和固定目标由 [`specs/README.md`](specs/README.md) 登记。冻结期只修正当前实现错误，不新增顶层功能域或长期正文。每个域迁移时必须同时切换 Profile Import、产品投影、合同测试、VitePress、CI 和打包入口，随后删除旧目录；不得复制后让两份正文独立演进。

新建、移动或删除文档后运行 `bun run docs:check`；修改 VitePress 投影时再运行 `bun run docs:build`。
