---
schema: nbook.task/v2
taskId: t47-legacy-state-migration
---

# 旧状态迁移门禁与原件保护

**状态：已实现，待独立审查。** Leader 已复跑聚焦测试（4 文件 49 例 exit 0）、相关测试域（12 文件 139 例 exit 0）与主应用 `bun run typecheck`（exit 0，含 Leader 修正的一处测试类型断言）。
实现记录见 [`walkthroughs/implementation.md`](walkthroughs/implementation.md)。[实施计划](../../storage-implementation-plan.md) 切片 4 的第一增量：把 `novel.ide.local` 的三个源字段按迁移合同导入新 Storage，并保证原件先于任何重写被固化。
本 Task 只做迁移门禁与原件保护；三个字段的消费入口切换、旧 `pick` 移除与主工作台接线是紧随其后的 t48（依赖本 Task 的公开接口）。

Work：[w00003](../../README.md)。合同：[迁移合同](../../../../../packages/neuro-book/docs/migrations/storage-state.md)（逐条为验收依据）、[storage.persistence](../../../../../docs/specs/storage/persistence.md)、[storage.boundaries](../../../../../docs/specs/storage/boundaries.md)。
已收口依赖：t35 浏览器 Project 适配（`70c7168d`）、t40 工作台 Storage 上下文（`7a5d04de`）、t44 grid 持久化宿主（`5fcdf8b8` + `1f1942c3`）。
入口取证见 [source map](../../storage-consumer-source-map.md)。

## 结果

应用启动时按固定顺序完成旧值保护与导入：**先**把完整旧桶原始字符串固化到浏览器专用暂存并核验，**再**允许旧 writer 继续写未迁字段；
客户端身份可持久恢复时，把原始字符串与迁移元数据保存为 data 内只读迁移备份，并按字段条件导入到新 Storage 目标记录；
全程可中断可续跑，已有记录、墓碑与未知高版本不被覆盖，非法字段只记诊断并保留原件。

## 范围

- 新增 `packages/neuro-book/app/utils/workbench/storage-migration.ts`（+ 必要的同目录纯 helper 与同名测试）；暂存与门禁的浏览器侧实现可拆同目录文件。
- 新增或修改启动接线（Nuxt 客户端插件，例如 `app/plugins/storage-migration.client.ts`）：保证暂存发生在旧持久化可能重写 `novel.ide.local` 之前，并与 `pinia-plugin-persistedstate/nuxt` 的真实启动顺序核对。
- `packages/neuro-book/app/stores/novel-ide.ts`：只做与「迁移期固定三个源字段 / 不接收这三个字段的新写入」直接相关的最小改动；**不**在本 Task 移除 `pick` 条目、不改消费者赋值路径。
- 受信 `workbench.migration` owner 的定义与状态（user/local、专用备份边界、原件 8 MiB + 进度/完成 64 KiB）放在本模块内，供 t48 复用。

## 排除

- 不改三个字段的读取/提交入口、不改 `WorkbenchShell.vue`/`app/pages/index.vue`/`ProjectPickerScreen.vue`（t48）。
- 不从 `novel.ide.local` 的 `pick` 移除字段（t48 在全部目标处理后做）。
- 不迁移 `novel.ide.session`、正文、撤销栈、Agent Session、草稿；不建 user→project 运行期继承；不新增 Storage scope。
- 不改 `app/utils/storage/**` 生产适配器与 `shared/storage/**` 合同（可只读复用）；不改 nb-ui。
- 不触碰两个用户 dirty `app/utils/workbench/descriptors{,.test}.ts`；不开代理、不联网、不提交/push；不访问 3001；不操作真实用户数据。

## 实现要求（对齐迁移合同）

1. **暂存早于旧 writer**：捕获 `novel.ide.local` 的完整原始字符串（未解析），写入专用浏览器暂存并**回读核验**；
   暂存带版本、来源与摘要，原始值上限 8 MiB；原件已存在时不得用后续旧桶覆盖；多标签创建暂存与转换旧 writer 共享初始化互斥。
   启动顺序按实际 Nuxt/Pinia 插件时序核对并留下证据（不能只按文件名字排序推断）。
2. **迁移期冻结**：暂存核验成功后，未迁字段继续由原 owner 持久化；serializer 只把三个源字段固定为捕获值（原本缺失的保持缺失），
   不接受新尺寸或书架意图回写源字段；完整旧 JSON 损坏时仍保留原始暂存，其它字段用各自默认并允许正常保存。
   仅当无法先保留原件时才冻结整桶，并提供明确提示与重试；后端不可达不得扩大为整桶不可持久化。
3. **data 原件备份**：客户端身份可持久恢复后，把原始字符串、迁移版本与来源信息保存为 data 内只读迁移备份并核验；
   身份不可恢复时不开始导入、不清源、不登记完成；data 暂不可达时保留暂存与源字段并报告未完成，不阻断未迁字段 writer。
   原件不进入普通文件树/内容索引；不因读取坏值而被解析重写；每个身份域/主体/客户端的本次迁移仅保留一份原件。
4. **逐项条件导入**：逐字段校验源值（非法只记诊断并保留原件）；先读目标，仅对**从未创建且无删除标记**的记录做条件初始化；
   已有记录、用户重置形成的墓碑、未知高版本一律不被旧值覆盖；重置（墓碑）后不再重新导入。
5. **进度与完成标记**：每个目标确认写入后登记迁移进度；失败保留源与已完成进度，下次启动续跑未完成项，不重复导入、不回滚已有目标；
   完成标记独立于目标记录与墓碑保留，多标签读取同一标记，读取失败不得当作未迁移；其它客户端或源版本不能改写完成标记。
6. **状态可观察**：对外暴露迁移状态（未开始/进行中/已完成/被阻断及原因、逐字段结果、可重试入口），供 t48 的加载与「未保存」反馈消费；
   失败分类不得把「后端不可达」「身份不可恢复」「原件暂存失败」混为一谈。

## 验证与交付

- 单测覆盖（隔离 fixture，真实 owner adapter + 注入传输，不写真实用户数据）：正常旧值、缺失字段、非法 JSON/非法字段、已有目标、墓碑目标、未知高版本目标；
  在原件保存、目标写入、进度登记处中断后重启续跑；两标签并发迁移的目标不被覆盖；身份不可持久恢复时刷新两次不产生导入、恢复稳定身份后只导入一次、墓碑回收后不重新导入。
- 至少一条覆盖「暂存回读核验失败」与「data 原件备份失败」的路径，验证保留暂存与源字段、可重试、不误判完成。
- 启动顺序证据：给出插件时序的实际核对方式与结果（允许用隔离测试或最小浏览器证据），说明为何暂存一定早于旧 writer。
- 按 `packages/neuro-book/package.json` 跑聚焦测试并记录命令/退出码/用例数；全包 typecheck 由 Leader 统一执行。
- 先写 `walkthroughs/implementation.md` 进行中；完成后列实际命令、cwd、退出码、文件与用例数、对外接口与 t48 的接线约定、未运行项与偏差。
- 最终回复具体结果，不返回空文本或句点。

## 继续条件

检查点：Leader 复核聚焦测试与 typecheck 后，创建 t48 完成三字段消费入口切换、旧 `pick` 移除与主工作台接线。
`ui.workbench-shell` 与 `storage.persistence` 保持 planned，本 Task 不晋升任何 capability。
