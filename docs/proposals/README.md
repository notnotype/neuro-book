# 项目提案

`docs/proposals/` 保存尚未生效、需要评审的产品或工程方案。Proposal 把原始自然语言整理成问题、目标、备选方案和影响，用来决定“应该采用什么长期行为”；它不是 Spec、实现 Task、待办清单或过程日志。

当前活跃提案：

- [`../packages/neuro-book/docs/proposals/character-workbench.md`](../../packages/neuro-book/docs/proposals/character-workbench.md)：Character 导航、搜索、编辑与 Low-code Form 合同，状态为 `reviewing`。
- [`Agent Skills 项目化适配`](../../packages/neuro-book/docs/proposals/agent-skills-adaptation.md)：状态为 `accepted`；旧适配流程作为历史保留，当前专项技能与验证分工由 P-005 最新决策取代。
- [`../packages/neuro-book/docs/proposals/agent-model-execution-surfaces.md`](../../packages/neuro-book/docs/proposals/agent-model-execution-surfaces.md)：Harness Agent、completion 与 headless 三套调用面、Catalog、授权和 Workflow 重放边界，状态为 `accepted`。
- [`p-005-development-workflow-governance.md`](./p-005-development-workflow-governance.md)：`P-005`，Work 本地登记、无正式角色的 Task 当前快照、主 Agent 直接执行与按需协调、专项技能和最小充分验证，状态为 `accepted`。
- [`应用运行时与内置插件架构`](../../packages/neuro-book/docs/proposals/application-runtime-and-plugins.md)：状态为 `accepted`，接受基础架构及“环境/小内核 → 最小服务插件 → Lab → Files → Settings → World/Plot”分段方向；前两片七项 `planned` Spec 已登记。本轮交付规范与实施规划，未实施产品；任意热卸载/升级仍仅为后续评估。
- [`model-roles-contract.md`](./model-roles-contract.md)：模型角色的后端契约（全局配置 `roles` 段、按 role 解析模型的优先级、本地模型已由 Provider 机制覆盖的结论），状态为 `draft`，等待「未决取舍」拍板。
- [`nb-ui-surface-model.md`](./nb-ui-surface-model.md)：nb-ui 表面模型，把材质（玻璃 / 实心，整页只有一层且只有它开模糊）与层级（不透明色阶，可嵌套、按位置自动推导）拆成两条轴，材质层有可读性不透明度下限，状态为 `accepted`。
- [`../packages/neuro-book/docs/proposals/workbench-view-host.md`](../../packages/neuro-book/docs/proposals/workbench-view-host.md)：Workbench 与 View Host（descriptor 注册表、可序列化拆分树原语、布局状态四类分层、视图跨容器与容器跨栏移动），状态为 `accepted`。
- [`nb-ui-overlay-portal-host.md`](../../packages/neuro-book/docs/archived/proposals/nb-ui-overlay-portal-host.md)：nb-ui 浮层的 portal 宿主默认值（默认 `body`、组件缺宿主通道的现状与三种长期选项），状态为 `rejected`（2026-09-14 收尾：问题前提已由主题上移到 `<html>` 消解，不立项；保留两条残留与重开条件）。
- [`workbench-commands.md`](./workbench-commands.md)：命令系统与单一注册表（命令单一身份、`when` 上下文求值、交互入口统一分发命令 id、命令面板与派生快捷键表），状态为 `draft`。
- [`storage-service-and-sync.md`](./storage-service-and-sync.md)：跨独立 data 在线同步的身份对齐、复制确认、冲突与删除收敛，状态为 `draft`；已批准本地行为见 [storage.persistence](../specs/storage/persistence.md)。
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
- `accepted` 表示长期取舍已决定，可更新 `planned` Spec，并按当前已知结果创建或复用根 `.agents/works/` 的 Work 与 Task；Proposal 本身不自动成为规范或执行授权。
- 实施前把已批准行为写入[`../specs/README.md`](../specs/README.md)注册的当前规范。Task可引用Proposal并协作准备指定Spec，但只有开发者明确接受的决定可进入`planned`合同。
- `.agents/works/` 记录 current 一次设计或实现的范围、授权、当前快照和证据链接；Work/Task 引用 Proposal 与 Spec，不复制正文。`.agents/tasks/` 只保存 legacy provenance。
`rejected`、`superseded` 和已经完成沉淀的 Proposal 移入 [`../packages/neuro-book/docs/archived/`](../../packages/neuro-book/docs/archived/) 下的 proposals 分类；当前规范不依赖归档内容才能被理解。
