# 项目提案

`docs/proposals/` 保存尚未生效、需要评审的产品或工程方案。Proposal 把原始自然语言整理成问题、目标、备选方案和影响，用来决定“应该采用什么长期行为”；它不是 Spec、实现 Task、待办清单或过程日志。

当前活跃提案（链接到 `packages/neuro-book-legacy/` 的提案属于旧应用，只作参照；对应功能迁回新应用时重新评审）：

- [NeuroBook v2：并排重建应用](./neuro-book-v2-rebuild.md)：旧包改名 `neuro-book-legacy` 只作参照，在原路径新建 `neuro-book`；去掉 Nuxt，前端 Vue + Vite、后端 Bun + Hono、校验统一 TypeBox；先只有运行时底座与 workbench 底座，Files 竖切在壳子上验证；删除交付链、归档过时文档；`accepted`（2026-10-03）。
- [`../packages/neuro-book-legacy/docs/proposals/character-workbench.md`](../../packages/neuro-book-legacy/docs/proposals/character-workbench.md)：Character 导航、搜索、编辑与 Low-code Form 合同，状态为 `reviewing`。
- [`Agent Skills 项目化适配`](../../packages/neuro-book-legacy/docs/proposals/agent-skills-adaptation.md)：状态为 `accepted`；旧适配流程作为历史保留，当前专项技能与验证分工由 P-005 最新决策取代。
- [`../packages/neuro-book-legacy/docs/proposals/agent-model-execution-surfaces.md`](../../packages/neuro-book-legacy/docs/proposals/agent-model-execution-surfaces.md)：Harness Agent、completion 与 headless 三套调用面、Catalog、授权和 Workflow 重放边界，状态为 `accepted`。
- [`p-005-development-workflow-governance.md`](./p-005-development-workflow-governance.md)：`P-005`，Work 本地登记、无正式角色的 Task 当前快照、主 Agent 直接执行与按需协调、专项技能和最小充分验证，状态为 `accepted`。
- [应用运行时与内置插件架构](../../packages/neuro-book-legacy/docs/proposals/application-runtime-and-plugins.md)：基础方向 `accepted`；只维护架构、生命周期和能力地图，第一、二片已实现，Lab 状态见关联 Work。
- [应用运行时产品装配](../../packages/neuro-book-legacy/docs/proposals/application-runtime-product-integration.md)：从启动到 Project/工作台及领域接入的细化方案，`reviewing`；从总提案迁出，不新增实现授权。后端启动与 HTTP 入口部分已由下一项替代。
- [可扩展应用平台](extensible-application-platform.md)：内核拥有进程、领域能力皆为内置插件、第三方插件免构建安装、运行期热插拔、插件通道与远程形态 API 的机制设计及推进路线，`accepted`（2026-09-30）；已确认的长期决定见 [ADR 0022](../adr/0022-extensible-platform-and-plugin-trust.md)。
- [Files 与资源管理器第一版](../../packages/neuro-book-legacy/docs/proposals/files-explorer.md)：范围及 F1–F9 `accepted`，行为已原位沉淀为 `workspace.files` / `workbench.files-explorer`（`planned`）；保留设计理由、内部接缝与待验证性能依据，尚未实施。
- [Files 与资源管理器第二版](../../packages/neuro-book-legacy/docs/proposals/files-explorer-v2.md)：`draft`；快速打开与删除恢复为核心方向，全文搜索/内容整理/导入导出为候选，不扩大第一版验收。
- [项目文件底座与 Files 竖切](project-file-foundation.md)：阶段 2 Files 竖切的需求与设计——URI 方案与提供者、带来源的变更事件、普通/内容/活页夹三类文件夹（后缀识别、XML 清单）、按需加载与乐观切换、History 插件与用户资产根；`accepted`（2026-10-02），实施按切片另行授权。
- [`Agent 对话视图重做`](../../packages/neuro-book-legacy/docs/proposals/agent-conversation-view.md)：在 `app/components/agent/` 重做纯视图的 `AgentConversationView`（只读 ctx 加 action 合同、扩展点注册表、分轮折叠消息流、卡片与视觉统一、Lab 时间线回放），只做前端、只以 Lab 验收，状态为 `accepted`；已批准行为见 [ui.agent-conversation-view](../archived/specs/ui/agent-conversation-view.md) 与 [ui.component-lab.timeline](../specs/ui/component-lab-timeline.md)。
- [`Agent 会话数据层后续`](../../packages/neuro-book-legacy/docs/proposals/agent-session-data-layer.md)：记录阻塞 invoke 与 SSE 双通道、live state 无版本、重复入口等数据层与后端问题，留到 w00017 插件体系就绪后处理，状态为 `draft`。
- [`model-roles-contract.md`](./model-roles-contract.md)：模型角色的后端契约（全局配置 `roles` 段、按 role 解析模型的优先级、本地模型已由 Provider 机制覆盖的结论），状态为 `draft`，等待「未决取舍」拍板。
- [`nb-ui-surface-model.md`](./nb-ui-surface-model.md)：nb-ui 表面模型，把材质（玻璃 / 实心，整页只有一层且只有它开模糊）与层级（不透明色阶，可嵌套、按位置自动推导）拆成两条轴，材质层有可读性不透明度下限，状态为 `accepted`。
- [`workbench-view-host.md`](workbench-view-host.md)：Workbench 与 View Host（descriptor 注册表、可序列化拆分树原语、布局状态四类分层、视图跨容器与容器跨栏移动），状态为 `accepted`。
- [工作台外壳的抽象（v2）](workbench-shell-abstractions.md)：新应用 `nbook.workbench` 的对象模型（Part、ToolPart、Switcher、ActivityBar、ViewContainer、View）、插件面向的视图合同、布局记录与持久化端口、代码分层，三类容器身份与视图生命周期矩阵、公开状态键，外壳实现排在运行时拓扑 K5 之后；沿用 View Host 的分层，取代其 descriptor 字段与持久化细节，状态为 `accepted`（2026-10-07）。
- [多实例运行时拓扑](multi-instance-runtime-topology.md)：服务端、项目子进程与浏览器、TUI 客户端四类内核实例；项目由内核子实例机制与服务端宿主管理；插件间只有本地服务与内核路由的远程服务两种通信；对称 RPC 协议与内核专用端口；`nbook.http` 只做 HTTP 边缘；实施切片 K1–K6；长期决定见 [ADR 0024](../adr/0024-multi-instance-runtime-topology.md)，状态为 `accepted`（2026-10-07）。
- [插件的数据与状态](plugin-data-model.md)：插件数据的归位判据与十类数据、插件状态 store（`defineStore`）、公开状态与 `when`、Storage 的命名空间与分区归属、配置的读写规则，以工作台为例走查，状态为 `accepted`（2026-10-07）。
- [`workbench-commands.md`](./workbench-commands.md)：命令系统与单一注册表（命令单一身份、`when` 上下文求值、交互入口统一分发命令 id、命令面板与派生快捷键表），状态为 `draft`。
- [`storage-service-and-sync.md`](./storage-service-and-sync.md)：跨独立 data 在线同步的身份对齐、复制确认、冲突与删除收敛，状态为 `draft`；已批准本地行为见 [storage.persistence](../specs/storage/persistence.md)。
已完成沉淀的信息架构提案见 [`../packages/neuro-book-legacy/docs/archived/proposals/documentation-information-architecture.md`](../../packages/neuro-book-legacy/docs/archived/proposals/documentation-information-architecture.md)。
已否决的 nb-ui 浮层 portal 宿主提案见 [`../packages/neuro-book-legacy/docs/archived/proposals/nb-ui-overlay-portal-host.md`](../../packages/neuro-book-legacy/docs/archived/proposals/nb-ui-overlay-portal-host.md)，仅供重开时参考。

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

## 专题拆分与阅读入口

当总提案混合多个可独立决策的专题或不同批准状态时，按问题与决策边界拆分，不按任意行数切文件。总提案只保留跨专题架构、简短状态与阅读导航；专题保留其证据、取舍、影响和决策来源，批准行为仍只在对应 Spec 维护。

版本草案可以独立表达新增目标，但不创建版本化 Spec 副本，不重述上一版全部合同。移动正文时同步迁移所有活跃链接与章节锚点，索引和 Work/Task 只留摘要指针；历史证据、指纹与当时状态不倒改。实现和决策尚未闭合的设计不因拆分而提前归档，完成沉淀后按下述生命周期退出活跃入口。


## 生效规则

- `draft`和`reviewing`只供讨论，不能被代码、测试或Agent当作当前行为依据。
- `accepted` 表示长期取舍已决定，可更新 `planned` Spec，并按当前已知结果创建或复用根 `.agents/works/` 的 Work 与 Task；Proposal 本身不自动成为规范或执行授权。
- 实施前把已批准行为写入[`../specs/README.md`](../specs/README.md)注册的当前规范。Task可引用Proposal并协作准备指定Spec，但只有开发者明确接受的决定可进入`planned`合同。
- `.agents/works/` 记录 current 一次设计或实现的范围、授权、当前快照和证据链接；Work/Task 引用 Proposal 与 Spec，不复制正文。`.agents/tasks/` 只保存 legacy provenance。
`rejected`、`superseded` 和已经完成沉淀的 Proposal 移入 [`../archived/`](../archived/README.md) 下的 proposals 分类（旧应用时期已归档的仍在 `packages/neuro-book-legacy/docs/archived/`）；当前规范不依赖归档内容才能被理解。
