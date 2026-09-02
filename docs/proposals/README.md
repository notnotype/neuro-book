# 项目提案

`docs/proposals/` 保存尚未生效、需要评审的产品或工程方案。Proposal 把原始自然语言整理成问题、目标、备选方案和影响，用来决定“应该采用什么长期行为”；它不是 Spec、实现 Task、待办清单或过程日志。

当前活跃提案：

- [`../packages/neuro-book/docs/proposals/character-workbench.md`](../../packages/neuro-book/docs/proposals/character-workbench.md)：Character 导航、搜索、编辑与 Low-code Form 合同，状态为 `reviewing`。
- [`../packages/neuro-book/docs/proposals/agent-skills-adaptation.md`](../../packages/neuro-book/docs/proposals/agent-skills-adaptation.md)：Agent Skills 项目化适配，状态为 `accepted`。
- [`../packages/neuro-book/docs/proposals/agent-model-execution-surfaces.md`](../../packages/neuro-book/docs/proposals/agent-model-execution-surfaces.md)：Harness Agent、completion 与 headless 三套调用面、Catalog、授权和 Workflow 重放边界，状态为 `accepted`。
- [`p-005-development-workflow-governance.md`](./p-005-development-workflow-governance.md)：`P-005`，current Work 是 Task 的强制容器，Task 指定唯一 canonical role；Issue 由 Work 可选引用，Proposal 独立且可被多个 Work 引用，Agent主导执行，开发者在明示节点参与，PM/Reviewer按需，状态为`accepted`。
- [`nb-ui-surface-boxes.md`](./nb-ui-surface-boxes.md)：nb-ui 表面盒子规范，按「这块面装什么」分成内容盒/器械盒/浮层盒加「不给面」，每档打包成一个类，并给器械盒定可读性不透明度下限，状态为 `draft`。

已完成沉淀的信息架构提案见 [`../packages/neuro-book/docs/archived/proposals/documentation-information-architecture.md`](../../packages/neuro-book/docs/archived/proposals/documentation-information-architecture.md)。

## 何时需要 Proposal

满足任一条件时创建 Proposal：

- 新增产品功能或改变用户可观察行为；
- 跨越多个模块、数据所有权或进程边界；
- 改变持久化格式、公开接口、权限、安全、安装、发布或兼容承诺；
- 存在两个以上长期方案，需要记录取舍和放弃原因。

局部修复、机械迁移和现有 `implemented` Spec 内的实现不单独创建 Proposal；它们直接进入根 `.agents/works/` 的 Work/Task，并在需要时同步 Spec。期望行为仍有歧义的 bug 先进入 Proposal，不能由实现者猜测。

## 最小结构

每个 Proposal 使用英文 kebab-case 文件名，并包含：

1. `状态`：draft、reviewing、accepted、rejected 或 superseded；
2. `问题`：用户或系统面对的可观察问题；
3. `目标与非目标`；
4. `当前行为与证据`；
5. `方案、备选方案和取舍`；
6. `数据、接口、安全、迁移、发布与回滚影响`；
7. `对 Spec 的预期改动`：目标 capability、输入、输出、状态、副作用、失败与验收；
8. `决策记录`：日期、决策者和结论。

## 生效规则

- `draft`和`reviewing`只供讨论，不能被代码、测试或Agent当作当前行为依据。
- `accepted`表示长期取舍已决定，允许Leader更新`planned` Spec，并按当前已知结果创建或复用根 `.agents/works/` 的 Work，再创建指定唯一 canonical role 的 Task；Proposal本身不自动成为规范或执行授权。
- 实施前把已批准行为写入[`../specs/README.md`](../specs/README.md)注册的当前规范。Task可引用Proposal并协作准备指定Spec，但只有开发者明确接受的决定可进入`planned`合同。
- `.agents/works/`记录current一次设计或实现的范围、role、交接和证据；Work/Task引用Proposal与Spec，不复制正文。`.agents/tasks/`只保存legacy provenance。
`rejected`、`superseded` 和已经完成沉淀的 Proposal 移入 [`../packages/neuro-book/docs/archived/`](../../packages/neuro-book/docs/archived/) 下的 proposals 分类；当前规范不依赖归档内容才能被理解。