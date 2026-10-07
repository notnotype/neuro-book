---
schema: nbook.task/v2
taskId: t55-plugin-storage
---

# NeuroBook v2 第 5 步 K4：`nbook.storage`（插件记录、分区归实例、客户端代理）

## 目标与范围

按 [多实例运行时拓扑](../../../../../docs/proposals/multi-instance-runtime-topology.md)（2026-10-07 `accepted`）第 11 节的 K4 与 [插件的数据与状态](../../../../../docs/proposals/plugin-data-model.md) 第 5 节：插件按记录声明要持久化的数据；user 分区在服务端实例、project 分区在项目实例、浏览器经代理访问；按插件划分命名空间、`local` 按客户端分区；读取分类、条件保存、订阅；客户端代理经内核签发的消费上下文转发。

实施计划：[plan.md](plan.md)（2026-10-07 开发者确认；omp 设计审查见 [evidences/omp-design-review.txt](evidences/omp-design-review.txt)，12 条已并入计划）。

行为合同（本 Task 修订）：[`storage/persistence.md`](../../../../../docs/specs/storage/persistence.md)、[`storage/boundaries.md`](../../../../../docs/specs/storage/boundaries.md)、[`runtime/services.md`](../../../../../docs/specs/runtime/services.md)、[`runtime/plugin-channel.md`](../../../../../docs/specs/runtime/plugin-channel.md)、[`runtime/plugins.md`](../../../../../docs/specs/runtime/plugins.md)、[`runtime/plugin-api.md`](../../../../../docs/specs/runtime/plugin-api.md)。

## 前置

K1 [t52](../t52-kernel-instances-remote/README.md)（按调用方门面、委托、远程服务）、K2 [t53](../t53-rpc-port-browser-connection/README.md)（客户端身份）、K3 [t54](../t54-project-child-process/README.md)（项目实例与绑定）。

## 当前状态

2026-10-07 计划确认，“待确认”11 项均按计划的建议确认；从 S0 开始实施。

| 片 | 状态 |
|---|---|
| S0 Spec 与文档 | 完成：`storage/persistence.md` 按多实例拓扑原地改写（`planned`），`storage/boundaries.md`、`runtime/plugin-api.md` 去掉旧应用的身份域、访问上下文、Workspace Root 与 `ctx.storage`；`runtime/services.md`、`plugin-channel.md`、`plugins.md`、`plugin-manifest.md`、`application.md` 增补客户端身份、路由覆盖、wire 3、`remote.on` 与 `remoteDelegates`；拓扑稿与配套稿的决策记录与“精确项目代次”的承接方式同步。计划之外补一个失败码 `originals-full`（原件区满时拒绝重置） |
| S1 调用方的客户端身份 | 完成：运行实例身份可带 `client`（窗口传入），装配与插件宿主据此填 `ConsumerIdentity.client`；帧上调用方带 `client`、`consumerKey` 同步；路由对成员发来的请求、订阅、释放把 `location` 与 `client` 置为登记的成员描述；wire 升为 3。内核 266 例、应用相关测试通过；去掉覆盖的变异被新用例抓住 |
| S2 跨实例委托 | 完成：入口字段 `remoteDelegates`、激活上下文 `remote.on(调用方)`；装配加 `issuedTo`（核对签发身份、把释放步骤挂在签发记录上，代理门面的 release 之后逆序运行）；拒绝一律 `denied` 并记诊断。`remote/delegation.test.ts` 3 例（真实服务端应用与路由、浏览器运行实例）；去掉挂载与 `remoteDelegates` 核对的两处变异各被抓住；内核 269 例通过 |
| S3 记录定义与分区库 | 完成：`src/shared/storage.ts`（`defineRecord` 加载时校验、逐层排序的指纹、资源 id 规则、公开接口类型）；`src/plugins/storage/server/partition.ts`（`bun:sqlite`、WAL、`BEGIN IMMEDIATE` 的条件写入、删除标记、读取分类、单条上限、原件区、内存里的描述登记、进程内变更通知；不是 SQLite 或格式版本不认识时 `io-error` 且不改写库）；内核 `json-codec` 加 `encodeJsonValue`。`partition.test.ts` 13 例（两个 Bun 子进程在第三个进程放开写锁后争用同一个库、`busy`）连跑 5 次通过；`BEGIN IMMEDIATE` 换成 `BEGIN` 的变异按时序被抓住（第二个写入方得到 `SQLITE_BUSY_SNAPSHOT`），`SQLITE_BUSY*` 一族都映射为 `busy` |
| S4 三端入口与代理 | 完成：服务端入口拥有 user 分区、项目入口拥有 project 分区，按调用方提供 Storage 服务，以 `nbook.storage/user`、`nbook.storage/project` 把分区交给别的实例；浏览器入口以调用方的身份经 `remote.on` 转给拥有者；`open` 异步并在同一处报告 `definition-conflict`、`no-client`、`no-project`、`invalid-resource`；拥有者一侧的失败经业务码 `storage-failed` 带回（Storage 的 `denied`、`unavailable`、`unknown-outcome` 与路由层失败码同名）。远程路线要在调用时才取：门面工厂运行时调用方身份还没签发完。`storage.test.ts` 11 例（真实内核实例与进程内链路）；owner 与客户端分区的两处变异各被抓住 |
| S5 宿主接线与 e2e | 完成：`nbook.storage` 进产品清单，三个宿主登记工厂并按清单的 `delegatingPlugins` 给代理允许清单；测试探针经 Storage 读写三条示例记录；`project-child.test.ts`（真实项目子进程：两窗口共用、退出时关库、下一代读回）；`e2e/storage.e2e.ts` 3 例在本机 Chrome 上通过 |
| S6 收口 | 进行中：Spec 补实现进展与实现合同，README 注册表同步；`persistence.md` 保持 `planned`，晋升待开发者审批。全量 e2e 时 Lab 偶发停在启动中：开发模式没有预构建 typebox，每次整页加载逐个请求约 450 个模块文件，Chrome 以 `ERR_INSUFFICIENT_RESOURCES` 拒绝其中一些；加进 `optimizeDeps.include` 后 Lab e2e 连跑 3 次通过。`smoke:server` 加 S8（打包产物里的 user 分区：保存、读回、停止关库、重启读到同一个值）。omp 实现审查第一轮（[impl-review.txt](evidences/impl-review.txt)）：重要 7、建议 2，全部成立并已修正——内核三条（路由转发订阅丢首个事件、整个实例停止时经代理的调用被提前取消、已用过的签发身份释放后跳过准入复查）在 `42142ef5`；Storage 五条（监听里再写时通知倒序、`open` 不核对库、无格式标记的 SQLite 被改写、`onEnd` 抛错中断其余订阅收口、测试写死 revision）在 `87c815db`；服务端与项目探针补上 Storage 用法、e2e 三端交叉核对（S5 漏交的一项）在 `0877950b`。每条修正的新测试都做了变异检查。第二轮（[impl-review-2.txt](evidences/impl-review-2.txt)，复核修正与代码质量）：第一轮 8 条确认修好，第 9 条还差先前取得的访问对象与客户端；连同它共 6 条，重要 3、建议 3，全部成立并已修正——内核两条（先前取得的经代理客户端在签发身份失效后报 `cancelled` 而不是 `denied`、本地委托与经代理访问的身份核对写了两份）在 `8b496f8b`；Storage 四条（派发途中被停掉的监听仍收到这一次通知、早于建立返回就结束的订阅被门面再结束一次、`storage.test.ts` 的测试世界不收口而留下 19 个 SQLite 文件句柄、探针的 Storage 结果没有 schema 而 e2e 另写一套弱类型）在 `c9e6f90b`，新测试同样做了变异检查。收口验证（第二轮修正之后）：[test-affected-typecheck.txt](evidences/test-affected-typecheck.txt)（`--since 2369b724`：内核 273、应用 276 与 57 例、scripts 98 例）、[test-e2e.txt](evidences/test-e2e.txt)（45 例）、[smoke-server.txt](evidences/smoke-server.txt)（S1–S8） |
