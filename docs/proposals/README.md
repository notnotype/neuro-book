# 项目提案

`docs/proposals/` 保存需要评审、决定长期取舍的产品或工程方案。提案把原始需求整理成问题、目标、备选方案和取舍，回答“为什么做、怎么取舍”；它不是 Spec、实施计划、待办清单或过程日志。各类文档管什么、何时冻结见 [文档分工与寿命](../specs/README.md#文档分工与寿命)。

## 活跃提案

状态以各文件的 frontmatter 为准，这里只写标题与一句话。

- [NeuroBook v2：并排重建应用](neuro-book-v2-rebuild.md)：旧包改名 `neuro-book-legacy` 只作参照，在原路径从零重建去掉 Nuxt 的新应用。
- [开发流程与角色治理（P-005）](p-005-development-workflow-governance.md)：Work 本地登记、无正式角色的 Task 当前快照、主 Agent 直接执行与按需协调、专项技能和最小充分验证。
- [可扩展应用平台](extensible-application-platform.md)：内核拥有进程、领域能力皆为内置插件、第三方插件免构建安装与运行期热插拔的机制设计。
- [项目文件底座与 Files 竖切](project-file-foundation.md)：URI 方案与提供者、带来源的变更事件、三类文件夹、按需加载与乐观切换、History 插件与用户资产根。
- [模型角色的后端契约](model-roles-contract.md)：全局配置的 `roles` 段与按角色解析模型的规则。
- [nb-ui 表面模型](nb-ui-surface-model.md)：把表面拆成材质与层级两条轴，材质层只有一层、只有它开模糊并有可读性下限。
- [Workbench 与 View Host](workbench-view-host.md)：descriptor 注册表、可序列化拆分树原语、布局状态分层、视图跨容器与容器跨栏移动。
- [Workbench 命令系统](workbench-commands.md)：命令单一身份与注册表、`when` 上下文求值、交互入口统一分发命令 id、命令面板与派生快捷键表。
- [工作台外壳的抽象（v2）](workbench-shell-abstractions.md)：新应用 `nbook.workbench` 的对象模型、插件面向的视图合同、布局记录与公开状态键。
- [多实例运行时拓扑](multi-instance-runtime-topology.md)：服务端、项目子进程与客户端四类内核实例，内核路由的远程服务与专用 RPC 端口。
- [插件的数据与状态](plugin-data-model.md)：插件数据的归位判据、插件状态 store、公开状态与 `when`、Storage 与配置的归属与读写规则。
- [规格驱动开发：文档分工与 Spec 写法](spec-and-docs-governance.md)：各类文档的分工与寿命、Spec 写什么不写什么、提案与 ADR 的 frontmatter 与机检、规格驱动与验收先行的开发方式。
- [Storage 跨设备同步](storage-service-and-sync.md)：跨独立 data 在线同步的身份对齐、复制确认、冲突与删除收敛。

### 旧应用的提案（只作参照）

以下提案在 `packages/neuro-book-legacy/` 中，没有 frontmatter，状态写在各自正文里；对应功能迁回新应用时重新评审。

- [Character 工作台](../../packages/neuro-book-legacy/docs/proposals/character-workbench.md)：Character 导航、搜索、编辑与 Low-code Form 合同。
- [Agent Skills 项目化适配](../../packages/neuro-book-legacy/docs/proposals/agent-skills-adaptation.md)：旧的技能适配流程，当前专项技能与验证分工以 P-005 为准。
- [Agent 模型执行面](../../packages/neuro-book-legacy/docs/proposals/agent-model-execution-surfaces.md)：Harness Agent、completion 与 headless 三套调用面、Catalog、授权和 Workflow 重放边界。
- [应用运行时与内置插件架构](../../packages/neuro-book-legacy/docs/proposals/application-runtime-and-plugins.md)：旧应用的运行时架构、生命周期和能力地图。
- [应用运行时产品装配](../../packages/neuro-book-legacy/docs/proposals/application-runtime-product-integration.md)：从启动到 Project、工作台及领域接入的细化方案；后端启动与 HTTP 入口部分已由可扩展应用平台替代。
- [Files 与资源管理器第一版](../../packages/neuro-book-legacy/docs/proposals/files-explorer.md)：范围及 F1–F9，行为已沉淀为 [`workspace/files.md`](../specs/workspace/files.md) 与 [`workbench/files-explorer.md`](../specs/workbench/files-explorer.md)。
- [Files 与资源管理器第二版](../../packages/neuro-book-legacy/docs/proposals/files-explorer-v2.md)：快速打开与删除恢复为核心方向，全文搜索、内容整理、导入导出为候选。
- [Agent 对话视图重做](../../packages/neuro-book-legacy/docs/proposals/agent-conversation-view.md)：纯视图的 `AgentConversationView`，已批准行为见 [归档的 Spec](../archived/specs/ui/agent-conversation-view.md) 与 [`ui/component-lab-timeline.md`](../specs/ui/component-lab-timeline.md)。
- [Agent 会话数据层后续](../../packages/neuro-book-legacy/docs/proposals/agent-session-data-layer.md)：阻塞 invoke 与 SSE 双通道、live state 无版本、重复入口等问题，留到插件体系就绪后处理。

已完成沉淀的 [信息架构提案](../../packages/neuro-book-legacy/docs/archived/proposals/documentation-information-architecture.md) 与已否决的 [nb-ui 浮层 portal 宿主提案](../../packages/neuro-book-legacy/docs/archived/proposals/nb-ui-overlay-portal-host.md) 在旧包的归档目录，仅供参照。

## 何时需要提案

满足任一条件时创建提案：

- 新增产品功能或改变用户可观察行为；
- 跨越多个模块、数据所有权或进程边界；
- 改变持久化格式、公开接口、权限、安全、安装、发布或兼容承诺；
- 存在两个以上长期方案，需要记录取舍和放弃原因。

局部修复、机械迁移和现有 `implemented` Spec 内的实现不单独创建提案；它们直接进入根 `.agents/works/` 的 Work/Task，并在需要时同步 Spec。期望行为仍有歧义的 bug 先进入提案，不能由实现者猜测。

## frontmatter

每份提案以 frontmatter 开头，状态只写在这里，正文不再写“状态”一节：

```yaml
---
schema: nbook.proposal/v1
status: draft            # draft | reviewing | accepted | rejected | superseded
created: 2026-10-07
decided: null            # accepted、rejected 时的日期
supersedes: []           # 被本稿取代的提案
superseded-by: null      # 本稿被取代时，取代它的提案
specs: []                # 本稿接受后改动或新建的 Spec
adrs: []                 # 本稿产生的 ADR
---
```

`supersedes`、`superseded-by`、`specs`、`adrs` 写仓库根相对路径。`bun run docs:check` 核对：`schema` 与 `status` 的取值；`accepted`、`rejected` 必须有 `decided`；`superseded` 必须有 `superseded-by`；`draft`、`reviewing`、`accepted` 的提案必须登记在本页的活跃提案里，`rejected`、`superseded` 的不得留在本目录。

## 最小结构

文件名用英文 kebab-case，正文依次包含：

1. **问题**：用户或系统面对的可观察问题；
2. **目标与非目标**；
3. **当前行为与证据**；
4. **方案**：含备选方案与取舍；
5. **影响**：数据、接口、安全、迁移、发布与回滚；
6. **对 Spec 的预期改动**：目标 capability、输入、输出、状态、副作用、失败与验收；
7. **待定项**：需要开发者决定的问题，每项给出推荐选项；没有时写“无”；
8. **决策记录**：日期、决策者与结论。

走查、切片与推进不进提案：切片写在 Work README，推进写在 Task。

## 专题拆分与阅读入口

当总提案混合多个可独立决策的专题或不同批准状态时，按问题与决策边界拆分，不按任意行数切文件。总提案只保留跨专题架构与阅读导航；专题保留其证据、取舍、影响和决策来源，批准行为仍只在对应 Spec 维护。

版本草案可以独立表达新增目标，但不创建版本化 Spec 副本，不重述上一版全部合同。移动正文时同步迁移所有活跃链接与章节锚点，索引和 Work/Task 只留摘要指针；历史证据、指纹与当时状态不倒改。

## 生效规则

- `draft` 和 `reviewing` 只供讨论，不能被代码、测试或 Agent 当作当前行为依据。
- `accepted` 表示长期取舍已决定，可更新 `planned` Spec，并按当前已知结果创建或复用 `.agents/works/` 的 Work 与 Task；提案本身不自动成为规范或执行授权。只有开发者明确接受的决定可进入 `planned` 合同。
- **决策记录只记开发者的决定。** Agent 按审查意见所做的修订记在 Task 证据，不进决策记录。
- **接受即冻结。** 接受时把关键的长期决定写成 ADR、把行为写进 Spec；提案正文此后不改。之后的变化写进 Spec 或新的提案、ADR，原提案只在 frontmatter 记 `superseded-by`，或在决策记录追加一行。
- **归档。** `rejected`、`superseded` 的提案，以及行为与长期决定都已落到 Spec 与 ADR 的提案，移入 [`../archived/`](../archived/README.md) 下的 `proposals/`（旧应用时期已归档的仍在 `packages/neuro-book-legacy/docs/archived/`）；当前规范不依赖归档内容才能被理解。
