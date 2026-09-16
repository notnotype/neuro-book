---
schema: nbook.task/v2
taskId: t44-plugin-grid-storage-host
role: tasker
---

# 插件 grid 持久化宿主（原件合成与冲突隔离）

**状态：待实现。** 这是 [实施计划](../../storage-implementation-plan.md) 切片 3 的最后一块：t37 已收口几何/快照、t38 已收口 Splitter 手势、t40 已收口工作台 Storage 上下文与内存样例，缺的是把 grid 接到 Storage 落盘的宿主。
闭合后进入检查点 A（独立审查公共类型、身份、生命周期与插件消费），再开始切片 4 的主工作台接线。

Work：[w00003](../../README.md)。依赖已提交 `70c7168d`（浏览器适配）、`7a5d04de`（工作台上下文）与 `da4c5aca`（grid 手势/几何）。
合同：[ui.nested-grid](../../../../../docs/specs/ui/nested-grid.md)、[storage.persistence](../../../../../docs/specs/storage/persistence.md)、[storage.boundaries](../../../../../docs/specs/storage/boundaries.md)、
[grid API](../../../../../packages/nb-ui/src/components/layout/grid.md)、[Splitter](../../../../../packages/nb-ui/src/components/layout/Splitter.md)。
消费者接线入口见 [source map](../../storage-consumer-source-map.md)。样例消费方式见 [t40](../t40-workbench-storage-context/README.md) 与 `app/utils/storage/README.md`。

## 结果

一个工作台可以持有多个 grid 的**持久化宿主**：把 nb-ui grid 原语与工作台 Storage 上下文接起来，实现快照 v2 的恢复、**原件合成保存**、订阅投影与 CAS 冲突收口。
同一插件的两个 grid 用不同稳定资源标识互不影响；两个窗口显式共享同一恢复地址时共享记录、各自拥有当前显示与释放权。
宿主是纯模块（无 Vue、无 Pinia、不读文件），主工作台后续直接复用它，不再另起一套 Storage 接线。

## 范围

- 新增 `packages/neuro-book/app/utils/workbench/storage-grid-host.ts` 与同名测试；必要的纯 helper 保持同目录清晰归属。
- 可在 `storage-plugin-sample.ts` 增加 grid 布局消费样例（不改既有导出语义），或新增同目录样例文件；grid 定义工厂是宿主公开边界的一部分。
- 只读 `packages/nb-ui/src/components/layout/**`（t37/t38 已收口）与 `app/utils/storage/**`；发现原语/适配器缺陷只留复现报告，不在本 Task 修改它们。
- 可以同步 `app/utils/storage/README.md` 的消费说明；不改服务端与 `shared/storage` 合同。

## 排除

- 主页面接线、旧键迁移、浏览器标题栏（切片 4/5）；Lab fixture 与真实浏览器验收（单独 Task）。
- 不新增 Storage scope（不引入 session/window），不实现命令系统，不改 Work/Spec/治理文件。
- 不触碰两个用户 dirty `app/utils/workbench/descriptors{,.test}.ts`。
- 不开代理、不联网、不提交/push；不访问 3001；不启动产品宿主或服务；测试不写真实用户数据。

## 实现要求

1. **持久化边界**
   - 提供 grid 布局状态定义工厂（供插件与后续主工作台共用）：生成 `DefinedStorageState`，值类型为布局记录（含快照 `version` 与 `root`），支持 `records: "single" | "identified"` 直通 `defineStorageState`，不自造新的 scope/locality 概念。
   - 宿主消费 t40 的 `WorkbenchStorageOwnerHandle`（`read`/`save`/`subscribe`），`resource` 只作稳定恢复地址；宿主不自己开 session、不绕过工作台上下文。
2. **恢复与原件保留**
   - `missing` → 产品默认布局，**不写默认值记录**；`value` → 通过原语校验后**一次发布**，不留下半棵树。
   - `legacy-value`/`unsupported-version`/`corrupt` → 不抛未处理异常、不半更新，禁止普通保存覆盖原件，给出可区分诊断与可用状态。
   - 未知引用：呈现层过滤，但**原件保留**；未知引用重新出现时能恢复；部分过滤与整体非法分别报告。
3. **原件合成**
   - 保存时把已知修改**合成到读取时保留的原始记录**上（含未知字段、未知引用），不得用过滤后的渲染树 `serialize()` 整树覆盖。
4. **手势提交**
   - 一次用户手势只提交一次，携带主动改变的节点/字段（消费 Splitter 的 `gesture-end.active`/`sizes`，不用整份 sizes 覆盖偏好）。
   - 程序布局、挂载、测量、视口夹取、临时显隐不产生保存；取消/失败手势不提交新意图。
5. **外来确认隔离**
   - 订阅只更新**已确认基线**（含 credential），不重挂当前布局、不强制改变本窗口呈现；拖动期间外来确认不打断当前手势。
6. **CAS 冲突与失败收口**
   - 冲突后重读，只重放本次主动修改的字段，再条件提交一次；二次冲突或其它失败保留当前显示与未保存意图，停止该意图的自动重试，暴露重试/放弃入口。
   - 放弃采用当前已确认值，不清空其它记录；失败状态与原工作面绑定，不静默吞掉。
7. **实例与生命周期**
   - 两个 resource 不同 → 记录独立、同名叶不串记录；同 resource 共享地址 → 各自显示与释放权，一方提交后另一方按订阅更新基线。
   - 释放先停止接纳新提交，再等待在途请求收口；上下文失效/Project 换代后旧引用不复活，不向失效句柄补写。

## 验证与交付

- 单测覆盖：缺失默认不落盘、value 恢复一次发布、legacy/高版本/损坏禁止覆盖、未知引用过滤与保留、原件合成保存（未知字段/未知引用不丢）、手势单次提交与取消不提交、程序布局不保存、订阅只更新基线（拖动期间不改几何）、CAS 冲突重放与二次冲突停重试、放弃不清其它记录、两 resource 隔离、同地址共享与释放、释放/失效后旧引用拒绝。
- 至少一条用真实 owner adapter + 注入传输（沿用 t40 测试的适配器注入模式）贯穿 read → 手势保存 → 重新恢复 → 原件合成 的往返，不只验证 stub 调用次数。
- 允许构造畸形/高版本记录 fixture 验证禁止覆盖；不得用真实用户数据。
- 按 `packages/neuro-book/package.json` 跑聚焦测试并记录用例数/退出码；全包 typecheck 由 Leader 统一执行。
- 先写 `walkthroughs/implementation.md` 进行中，完成后列真实命令、退出码、文件与用例数、公开 API 用法、未运行项与偏差。
- 最终回复具体结果，不返回空文本或句点。

## 继续条件

检查点 A 由独立 Reviewer 复核（公共类型、身份/寻址、生命周期、原件合成与冲突边界），Leader 复跑聚焦测试与 typecheck。
Lab fixture 与四主题/桌面/390×844 浏览器验收由后续 Task 承接，本 Task 不声明切片 3 整体完成。
