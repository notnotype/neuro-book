---
schema: nbook.task/v2
taskId: t30-project-storage-host
---

# Project Storage lazy module 与宿主接口

## 当前唯一剩余补修：关停排空与最终锁检查

前一omp（project-storage-host-t30-final）已于10:16退出1；代码与测试产物保留，原始工具输出确认 28文件351 passed /1 skipped，源码已从负向探针还原，最终报告没写成。
物理data根复核、Project异步revalidator、V4 Facade HMR已有实现；不要重做它们。
本轮首先读 `walkthroughs/leader-shutdown-findings.md`：主 Agent独立临时测试已复现真实 `PROJECT_NOT_OPEN`。
只修两项并留最终证据：

1. Project整体shutdown的已接纳写不能再要求Service/Lifecycle为running。同步`projectTargetGuard`保留entry/ready/targetInvalid/Occupancy，去掉接纳状态误判；Lifecycle提供给该能力的物理复核不能被assertRunning阻止。新操作继续由已有入口gate拒绝。补Service已有操作→closeAll→继续guard/revalidate→成功，以及真实Lifecycle关闭后仍可只读复核原workspace的测试，别只靠stub。
2. `assertMutationHealthy`最后一次await guard之后再同步assertHealthy，覆盖最后异步复核期间锁compromised；可控异步guard测试证明没有新的记录提交，旧值字节不变。

同时修正project-session.ts的V3注释：基线Service已有requireReadyProjectByPublicId，旧Facade未导出；真正缺失的是本轮新增revalidate/target capability与lazy snapshot，不能写错历史形状。
先落 `walkthroughs/final-validation.md` 写已完成事实与本轮进行中，然后完成后更新命令/结果。只跑影响集（Storage+Project相关以及新增测试），主 Agent统一typecheck。不要负向修改生产源码做探针，不重复已通过的无关测试。8分钟内结束，不sleep，不再派代理，不提交。其它Task文件已稳定，不触碰。

## 最终收口：物理复核与 Project Facade 热更新

首轮及四项 followup 已完成，t34 独立实跑 347 passed / 1 skipped、typecheck exit 0，报告见 t34/walkthroughs/review.md。
本次只补下面两类真实合同缺口，优先于下文历史派发说明：

1. W-1 与 data 根等锁窗口：project action 在入场时捕获 data 根，但 `performLeasedAction` 的同步 guard 仅看内存标记，等锁期间替换 data 根后仍可能保存到旧域 Project。Project 物理根也应在副作用边界重新核验，不能以 watcher 尚未观察为理由弱化 Spec。允许 `StorageMutationGuard` 扩展为 void/Promise<void>，逐处 await，保持同步撤销检查在异步复核之后再执行。Project operation 可增加可异步复核的 capability，普通 closing 要允许已接纳操作排空，不要用要求 open 的旧 `revalidateReadyProject` 破坏这一点。核心不导入 Project/HTTP。物理检查属宿主；保留分区锁与 Storage 根的既有检查。测试确定性等锁后重建真实 data 根（复制同 identity），请求失败且原 Project 值字节不变；Project 根可用受控 Lifecycle rootIdentity 检查证明 watcher 回调前也拒绝，别只手动 close(root-replaced)。最后 I/O 本身与 stat 之间的不可消除本机竞争不要求沙箱化。
2. W-2 不只是 lazy snapshot：旧 V3 Project Service 实例还缺新增 revalidate/target guard 方法。`project-session.ts` 必须安全升级 Facade 槽到新版，排空旧 Service 再开新 owner，并继承未完成的 previousClose 链。按 `git show 0d66064b:...` 真实 V3 形状做测试；旧排空失败仍阻止新接纳，同版 HMR 复用。

本轮获准编辑 t30 范围内 `partition-store/storage-service` guard 接缝与 Project HMR 测试；t31 文件边界、t35 前端适配器独立进行，不交叉编辑。无需改 shared HTTP DTO。新增聚焦回归后跑受影响 Storage/Project 集即可，不重复无关测试；主 Agent最后统一 typecheck。15 分钟内交可审增量，写 `walkthroughs/final-validation.md` 真实结果，不 sleep、再派代理或提交。不修改 Spec 来降低保证。

## 本轮追加修复（首轮已退出，优先处理）

第一步先读 [leader-findings](walkthroughs/leader-findings.md)。主 Agent已独立复现真实 V3 HMR TypeError，
首轮绿色测试用了错误的旧对象形状，不能证明升级安全。请修四项并写 `walkthroughs/followup.md`。
对已接纳 Project 操作，提供属于同一生命周期 owner 的有效性检查能力：普通关闭可排空，锁失效/根替换必须停写；
检查要进入核心真实副作用前的 guard。可在 Project operation callback 增加能力或合理扩展 owner 接缝，
避免 Storage 自行解析 signal.reason 文本、路径重开或用全局“当前项目”兜底。
初始化在鉴权/身份域等 await 后、mkdir 前也要重新核验；Project claims 须绑定 data 物理根。
顺手补 `releaseStorageUserContext` 拒绝 project scope 混用（目前 release 只比主体/client）。
只改 t30 既有范围；t31/t32 正并行，不跨文件编辑。不要再跑完整 Workspace 业务全集；新增确定性门控测试、受影响 Storage/Project 聚焦与 typecheck 足够。
前 2 分钟写进行中 followup；约 18 分钟内留下真实结果，未完成项直说。已有五个 project happy-path 用例不能代替这些竞争窗口。

Work：[w00003](../../README.md)；[计划](../../storage-implementation-plan.md)切片 2。
基线 `0d66064b`：t28 已发布精确 ready/publicId，并经 t29 独立审查。
先读 [t28 接线取证](../t28-project-ready-publication/walkthroughs/leader-next-evidence.md) 的 Storage 与 lifecycle 部分。
行为合同为 [storage.boundaries](../../../../../docs/specs/storage/boundaries.md)、
[storage.persistence](../../../../../docs/specs/storage/persistence.md)。

## 本轮结果

Project Storage 按需激活，并提供与 user 对称的 context 签发/释放与 action HTTP 入口。
访问绑定精确 ready、data 身份域、主体、session、客户端及实际根；旧代次不会写入重开的 Project。
普通 Project open 不依赖 Storage 初始化，也不解析状态记录。关闭在释放 Occupancy 前收口已接纳动作。

## 范围与协作

omp Tasker 独占本轮源码和测试，主 Agent 只读检查并维护 Work/Task 文档。
允许修改 `server/storage`、`server/api/storage`、`shared/storage`、必要的 Project owner 与 module 接缝、测试和类型入口。
允许机械更新受影响测试 fixture、Vitest 登记。既有 user 行为保持兼容。
两个 `app/utils/workbench/descriptors{,.test}.ts` 是用户既有 dirty，完全排除。
本轮不改浏览器适配器、文件/备份、grid、迁移、UI 或命令系统；不晋升整个 capability。
不联网、再派代理、提交、push、PR、部署或操作真实用户 data；隔离数据使用测试支持包的系统 Temp。
用户已授权计划内实现与验证，无需等待例行确认。

## 实现边界

1. 复用 `host.ts` 的 auth-on/off、在途核验、session 撤销、容量和关闭协议，不复制一套鉴权。
   data 身份域只来自 `WorkspaceRoot/.nbook/storage/identity.json`；Project 根不签发 identity.json。
   shared 仍有身份域/主体，只省略客户端。复制原记录不能自动改归当前主体。
2. Project 参数由严格 DTO 校验：`projectRoot + publicId`，使用既有 Service 的精确 ready 解析；
   publicId 只是定位，不是授权。请求不能自由声明 scope/locality/主体/实际根。
   签发后每次 action/release 均核验当前 data 身份、主体/client 与最初绑定；拒绝 user/project 混用。
3. `project-module.ts` 的类型与 lazy 顺序登记 storage；production composition root 在 Project facade。
   Module 同步 start 返回 handle，异步 I/O 在操作内进行。公共 registry 与 per-Project service/pool 分开，
   避免 module→host→facade 初始化环；不建立脱离 Project 生命周期的永久 ready Map。
4. 用 `activateReadyProjectModule` 和 `runReadyProjectOperation` 登记已接纳动作。
   对有效目标的已接纳保存，普通关闭允许收口；锁失效、根替换、授权撤销必须在副作用前失败。
   不用无条件忽略 AbortSignal 实现排空，也不能 Module close 等待一个只有它自己 close 才结束的操作。
5. 首次创建 `.nbook/storage` 也是副作用。先核验精确 ready、Occupancy 与原物理 Project，
   按需在既有 Lifecycle owner 提供 revalidate 能力，不按路径重新造“当前项目”。
   关闭、删除或目录替换后的旧初始化不能递归 mkdir 重建 Project；后续句柄固定 expectedRootIdentity。
6. 错误沿现有 typed error/HTTP 投影，已提交后的领域失败保留 committed 事实。
   Project context 终止须主动失效并释放容量；普通单标签 release 只释放自己的 context。
   HMR 须识别旧形状 owner，明确保留或安全排空，不能默默复用不懂 Project 的旧实例。

## 验证与交接

第一步创建 `walkthroughs/implementation.md` 写进行中、基线与接口选择，边做边更新；不要空返回。
约 18 分钟预算，优先完成可核对的最小增量；遇到未闭合项即时记录，不靠 sleep 等待。

- 至少一个真实 H3 HTTP roundtrip：Project context→bind→缺失读取→CAS save→重读→release；另一个 Project 隔离。
- 未 open、缺标识、同根旧 publicId、close/reopen、root replacement、跨 user/project context 均拒绝。
- 普通 open 不激活 storage；Project 上下文结束释放容量；已接纳保存与 close 排空顺序。
- 等锁后撤销授权/根替换、首次初始化在 close/delete 之后不会重建目录。
- auth-on/off 与 data 身份共享逻辑有直接覆盖；保留 user host/action 回归。
- 跑相关 Storage、Project Module/Service/Runtime 聚焦测试与主应用 typecheck，避免无关全库测试。
- 最终报告记录具体文件、真实命令及结果、未运行项、残余问题。退出 0 或空 final 不是交付证据。

本轮不重复运行 `scripts:typecheck` 的已知无关主题 fixture 错误；新增公共类型不能引入新的调用方断裂。
