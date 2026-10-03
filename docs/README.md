# NeuroBook 项目文档

根 `docs/` 保存 monorepo 级治理：Spec 注册表、架构决策、工程标准、测试合同、边界正文、提案与调研。维护者或 Agent 应从 [`specs/`](specs/) 定位相关 capability 及其 `planned` / `implemented` 成熟度，再按任务触发读取其它资料。

本分支正在按 [NeuroBook v2：并排重建应用](proposals/neuro-book-v2-rebuild.md) 从零重建应用。旧应用 [`../packages/neuro-book-legacy/`](../packages/neuro-book-legacy/AGENTS.md) 的包内文档（ADR 0001–0021、数据迁移、runbook、术语与旧提案）只作参照；旧应用时期的 Spec、规范与用户文档站归档在 [`archived/`](archived/README.md)。current 一次实现的 Work、Task、过程和证据位于 [`../.agents/works/`](../.agents/works/)，legacy Task 记录位于 [`../.agents/tasks/`](../.agents/tasks/)，二者都不代替当前规范。

## 真相源优先级

1. [`specs/`](specs/)：已批准的 `planned` 目标合同与代码支持的 `implemented` 当前合同；功能行为、状态、数据、接口、失败语义和验收依据只在这里维护。
2. [`adr/`](adr/README.md)：已接受架构决策及理由；ADR 不复制完整功能行为。
3. [`standards/`](standards/) 与 [`testing/`](testing/)：编码、仓库流程、测试、临时根和证据合同。
4. [`proposals/`](proposals/)：尚未生效的方案；accepted 只授权更新规范与创建 Work/Task。
5. [`../.agents/works/`](../.agents/works/)：current 一次实现的范围、授权、快照和证据；[`../.agents/tasks/`](../.agents/tasks/) 只保存 legacy provenance。
6. [`research/`](research/README.md) 与 [`archived/`](archived/README.md)：非规范资料，不用于判断当前行为。

同一 capability 只维护一个 Spec 文件；成熟度在原文件中从 `planned` 晋升为 `implemented`。其它入口只写摘要和链接；判断当前产品已有行为时只使用 `implemented` Spec 或注册的冻结过渡规范。

## 目录分工

```text
docs/
├── specs/       capability 登记与产品行为合同
├── adr/         架构决策记录（0022 起；更早的在旧应用包内）
├── proposals/   提案索引与仓库级提案
├── research/    调研资料，非规范
├── modules/     已登记的模块边界正文
├── standards/   编码规范与仓库协作流程
├── testing/     测试、临时根和验收证据合同
└── archived/    旧应用时期的 Spec、规范、人工评测与用户文档站
```

`docs/modules/` 仅保留已登记的现有模块正文；Monorepo / Module 边界的唯一正文是 [`modules/monorepo-boundaries.md`](modules/monorepo-boundaries.md)。其它当前规范进入 `specs/`，未批准需求进入 `proposals/`，过时内容进入 `archived/`。

## 仓库其它文档

- 根目录大写 Markdown 是人类、Agent 或机器消费的入口；正文下沉到对应真相源。
- [`../.agents/works/`](../.agents/works/) 保存 current 一次实现的范围、授权、walkthrough 和证据；[`../.agents/tasks/`](../.agents/tasks/) 保存 legacy 记录。Task 完成不改变当前规范的优先级。

## 当前入口

- [规范编程与注册表](specs/README.md)：Spec 成熟度、格式、流水线与 capability 归属。
- [编码与仓库标准](standards/README.md)：按语言触发的编码规范和维护者仓库流程。
- [Proposal 规则](proposals/README.md)：原始需求如何结构化、评审、批准并沉淀为 `planned` Spec。
- [ADR 索引](adr/README.md)：长期架构决策。
- [测试与验收](testing/README.md)：自动测试、临时根和证据合同。
- [人类贡献指南](../CONTRIBUTING.md)：Issue、开发和 Pull Request 快速流程。
- [项目状态](../PROJECT-STATUS.md)：仓库现状与推进顺序。

## 生命周期与维护

1. 行为变化先在 [`specs/README.md`](specs/README.md) 定位 capability 和成熟度；同一能力只更新一个稳定文件。
2. 新功能和仍有产品歧义的 bug 先写 Proposal；accepted 后形成 `planned` Spec，并在根 `.agents/works/` 创建或复用 Work 与 Task。Task 不设正式角色；Proposal 本身不成为合同或执行授权。
3. Spec-first、Work/Task-first 或紧急 code-first 都必须在同一交付中让代码、测试和 Spec 收敛；证据闭合后才把原 Spec 晋升为 `implemented`。
4. 纯内部重构核对行为合同仍成立，不把文件布局写入 Spec。旧行为退出时更新原 Spec；长期理由进入 ADR；考古正文进入 `archived/`。
5. 已完成沉淀的 Proposal 归档；活跃入口不得依赖 `archived/` 内容才能解释行为。

入口使用触发式指针说明“何时读取”和“目标是什么”，不复制目标正文。活跃文档的相对链接必须解析到仓库内现存目标，带 `#锚点` 时还必须对应目标文件中现存的标题或 HTML `id`（按 GitHub 规则计算标题锚点）。历史 Task 与 `archived/` 中的旧路径可作为 provenance 保留，但不得被当前规范当作活跃依赖。

新建、移动或删除文档后运行 `bun run docs:check`。
