# ADR 0020：Config 与 Storage 的职责及两层作用域

- 状态：Accepted（职责与作用域保持有效；本期持久化和消费者分配由 [ADR 0021](0021-local-storage-persistence.md) 补充）
- 日期：2026-09-15
- 决策来源：开发者在 storage 设计讨论中确认 Global/Project Config、user/project Storage，不引入 session/window Storage scope
- 关联提案：[Workbench 与 View Host](../proposals/workbench-view-host.md)
- 架构合同：[storage.boundaries](../../../../docs/specs/storage/boundaries.md)（planned）
- 行为合同：[storage.persistence](../../../../docs/specs/storage/persistence.md)（planned）；跨 data 在线同步仍为 [draft 提案](../../../../docs/proposals/storage-service-and-sync.md)
- 概念与同步取舍：[Storage 设计讨论稿](../../../../.agents/works/w00003-neurobook-ui-foundation-migration/research/2026-09-15-storage-concepts-and-sync.md)

## 背景

主 Workbench、World Engine 和其它内置插件需要保存自己的状态，也需要在运行时共享一部分不持久化的状态。
原文档按 Pinia、localStorage 和 sessionStorage 分类，混淆了状态归属、保存期限和实现介质。

VS Code 可借鉴的是 Configuration、Storage Service、Memento 和运行时服务各有职责。
它的更多 scope 来自多 Profile、Workspace 等需求；NeuroBook 第一版不照搬全部枚举。

## 已确定的决策

1. **Config 表达设置与策略，Storage 保存模块运行后留下的状态。**
   Config 只有 Global Config 与 Project Config；Storage 只有 user 与 project scope。
   内置系统、前端和插件都可能消费 Storage。是否被服务端读取、是否有默认值、schema 或迁移，不能单独用来判断 Config。
   小说正文、Agent Session、草稿和历史记录继续由各自领域模块负责；两种通用 Storage scope 不替代这些数据合同。
2. **Config 沿用现有解析和覆盖机制。**
   Global Config 路径为 `Workspace Root/.nbook/config.json`（通常为 `State Root/workspace/.nbook/config.json`）；
   Project Config 路径为 `Project Workspace Root/.nbook/config.json`。
   支持项目覆盖的字段按现有合并规则生成 effective config；global-only 字段仍拒绝项目覆盖。
3. **Config 采用统一的配置同步语义。**
   开发者要求机器 A 的配置变更同步到机器 B，不做逐配置项的同步选择，也不增加按机器排除配置项的策略。
   这是目标行为；本 ADR 不声称实时同步通道已经实现，也不改变各配置项现有的 hot / next-run 生效时机。
4. **Storage scope 表示归属。**
   `user` 表示同一用户跨 Project 使用的一份状态；`project` 表示按 Project 身份分开的状态。
   切 Project 应切换读取的分区，不能删除上个 Project 的记忆；Project Storage 不自动继承 User Storage 的同名键。
   逻辑 scope 不决定物理文件位置，也不自动决定是否跨设备同步。
5. **不提供 session/window Storage scope。**
   不需要持久化的共享状态使用模块服务、非持久化 store 或受控 context；仍可随窗口、组件或任务结束而释放。
   现有 `novel.ide.session` 是待拆分的 sessionStorage 实现，不能通过直接更名或清空整桶完成迁移。
   Agent Session 仍是领域实体，不因取消 Storage 的 session scope 而消失。

## 实现影响

- descriptor 的持久化作用域收敛为 `user | project`，现有 Agent Session authority 独立保留。
- 宿主按模块或插件身份提供命名空间；消费者使用自己的逻辑键，具体介质交由存储适配层处理。
- Pinia 是前端状态管理工具；它可以承接 Storage 的内存投影，不作为跨前后端、插件通用接口。
- grid 原语负责布局与快照序列化；宿主决定 scope、同步与保存时机。允许同一 owner 保存布局快照；
  不同 owner 或不同同步策略的状态要有明确边界。
- 本次未迁移 `novel.ide.session` 或 `novel.ide.local` 数据，未实现新的 Storage service 或同步通道。

## 2026-09-15 时的未决项

本节保留当时的决策范围；2026-09-16 的本地阶段、尺寸归属、物理落点与身份决定以 [ADR 0021](0021-local-storage-persistence.md) 为准。

- **Storage 同步策略**：是否区分跨设备共享与设备本地状态。开发者提出“是否一些应该同步、一些不应该同步”，仍在讨论；方案见设计讨论稿。
- **具体消费者分配**：World Engine 的尺寸是否跨 Project 通用、哪些视图状态需要恢复，不能只从组件所属功能推导。
  一个插件可同时拥有 user 状态、project 状态和内存状态。
- **物理落点与一致性合同**：服务端文件或数据库布局、项目和设备身份、并发写入与冲突处理、格式迁移以及写入成功的含义。

## 2026-09-15 审查沉淀

开发者追加授权“先审查设计，符合目前需求且具有扩展性后落 Spec”。本轮将已确定架构及防串数据的边界
沉淀为上面的 `storage.boundaries`；[审查记录](../../../../.agents/works/w00003-neurobook-ui-foundation-migration/tasks/t21-storage-design-review/walkthroughs/001-storage-review.md)
列明源码依据、独立复核和限制。同步协议、使用主体/设备身份映射、World Engine 具体恢复归属仍由 draft 提案继续设计，
没有把独立 Reviewer 的建议当作开发者批准，也没有宣称完整服务设计已通过。后续批准与规范收敛见 ADR 0021。
