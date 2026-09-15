---
schema: nbook.task/v2
taskId: t26-storage-browser-adapter
role: tasker
---

# 浏览器值适配器、分区绑定与状态订阅

## 当前续修分工（2026-09-16 04:32）

第一轮已退出（exit 0 但没有完成报告），只算中间代码。主 Agent 已独立复现问题，见
`walkthroughs/leader-progress-review.md`，本轮不要重做整体设计。

**此次 omp 独占 server/storage、server/api/storage、shared/storage 的源码与测试；不得修改 app、scripts、package.json。
主 Agent 以同一 Task 的 tasker 身份独占 app/utils/storage、smoke 脚本与必要 package 命令，修前端缺陷。**
本节优先于下文原始的整 Task 独占说明；不覆盖对方文件。中间 typecheck 可能因共享 DTO 更新暂时失败。

服务端本轮必须闭合：

1. openHandle 在第一次 await 前复制并校验 binding；参考主 Agent 已复现的“调用后修改 binding 会改写未完成 open”问题。
2. 同 context/owner 的并发绑定检查有确定性用例；既不让旧绑定借新句柄，也不声称数值绑定是签名授权 token。
3. **旧浏览器代码与新后端定义的版本检查。** 所有非 bind 的 HTTP 值动作新增必填 `schemaVersion`（正安全整数），
   表示调用方实际消费定义的版本；服务端从注册表取回定义后、任何记录动作前核对必须相等。
   不相等报新增 `STORAGE_SCHEMA_MISMATCH`，HTTP 409、固定公开文案；旧请求不能把后端当前 value(v2) 当 v1 消费或保存。
   这与磁盘记录 legacy/unsupported 分类独立：双方定义同 v2、磁盘 v1 仍可显式 migrate；双方定义同 v2、磁盘 v3 仍受未知版本保护。
   主 Agent 会同步让前端所有值请求发送 definition.schemaVersion，并对 value 响应按定义验证。
4. 当前 `StorageActionResponse` 把 save/remove/migrate/repair 写成一个 kind 联合，导致前端 `Extract<...,{kind:K}>` 得到 never。
   用真正的逐 kind 判别联合（显式或 mapped type）表达，保持 wire payload 不变；不要用 any 绕过。
5. 修完受影响的服务端测试类型收窄；跑 server/shared 聚焦测试，记录结果。
   `storage-actions.test.ts` 当前把 parse 结果（可能 bind）直接传 requireStorageActionState，需要真实收窄。
6. 用真实 HTTP 测试覆盖前后端 schema 不匹配时 read/save/migrate/repair 均拒绝、原件不变；
   继续覆盖回收未读键失效、unsupported-version 公开诊断和 HMR ready 接纳顺序。

交接写 `walkthroughs/server-followup.md`（先写进行中，再逐项追加），不修改主 Agent 的 review 文件。
不要运行主应用完整 typecheck 或浏览器 smoke，它们在双方完成后由主 Agent 统一跑。

Work：[w00003](../../README.md)；当前[计划](../../storage-implementation-plan.md)的切片 1。
前置实现：[t24](../t24-storage-user-http/walkthroughs/implementation.md)；独立审查：[t25](../t25-storage-http-review/README.md)。
行为以 [storage.persistence](../../../../../docs/specs/storage/persistence.md) 为准。
先读[接续边界](../t24-storage-user-http/walkthroughs/adapter-next-boundaries.md)，复用已有实现，不重做核心或宿主身份。

## 结果与非目标

在同一个隔离真实 HTTP 宿主里，浏览器通过纯 TypeScript 适配器取得一个 user owner 句柄，
保存、读取和订阅 user/local 状态；服务端重启后显式重建访问能够恢复，旧访问与回收前的旧句柄明确失效。
消费者不需要知道 H3、磁盘或 IndexedDB 的实现，也不能通过临时字段改变注册策略。

- 可修改 `shared/storage/`、`server/storage/`、`server/api/storage/`、`app/utils/storage/`，必要脚本/包命令与对应测试。
  只为远程代次绑定补核心拥有的能力，不复制分区算法。
- 不挂主应用启动、不改 Config、Project/文件备份、UI/插件/grid/迁移、命令系统；这些按后续切片接入。
- 保护两个 descriptors 既有 dirty；不修改主工作区、不联网、再派代理、提交/push/PR/部署或操作真实用户 data。
- 测试支持包分配系统 Temp。脚本使用 Node；t23 已有普通 HTTP Chrome smoke，可复用运行方式和隔离配置。
- 本 Task 源码由 omp Tasker 独占，主 Agent 只读复核与编排。请及时写 walkthrough，不能把超时或空 final 算成完成。

## 实现约束

### 1. 远程 owner 句柄不能随请求换代

t24 当前每请求借用句柄，最后使用者结束即释放。前端的长期句柄必须增加明确的绑定动作：
服务端从受信定义/有效 user 上下文打开 owner，捕获其 local/shared 分区代次，返回有界的公开绑定信息。
普通动作带固定绑定，在核心接纳/读取边界检查它；不能先读取新代次再只让浏览器事后比较。

建议使用“分区代次绑定 + 临时句柄”的轻量方案，保留每请求排空模式；确需别的实现时先记录原因，
不要引入无界的长期句柄 Map。绑定不返回主体、根或路径，也不是绕过身份核验的授权 token。
初始绑定必须包含尚未读过的记录所属分区，回收后未读键同样失效；不同实际分区的正常数据不得被清空。
如果 DTO 需要扩展，变更共享合同及所有本 Task fixture/消费者；生产只保留一条受管 authority。

### 2. 纯适配器保留核心结果语义

- 异步取得、read/save/remove/migrate/repair/reclaim、subscribe、排空/release 与服务端语义对应。
  公共输入类型放 shared，只在真正复用时提取；前端不从 server 导入类型。
- 值和条件凭据在调用接纳时捕获，不让调用方后续改对象改变已提交请求。网络 DTO 在边界校验。
  读到缺失可呈现默认但不保存；损坏、旧版本、高版本、I/O 分开，不做自动修复或通用 JSON 合并。
- 同一句柄中每条记录的 mutation 按调用顺序发送；失败不永久堵塞队列，但不得自动换 revision 重试。
  HTTP 请求显式禁止自动重放 mutation。超时/断线是未确认，保留 code/status/committed，不能谎报未写入。
- Context 由宿主拥有，owner 句柄只释放自己的资源；释放一个句柄或标签不撤销同身份的另一个访问。
  关闭拒绝新调用，停止订阅并排空已接纳请求。永久失效后不能自动重签发并继续旧意图。

### 3. 有界串行观察当前状态

优先用串行轮询复用已有 HTTP 读协议；Spec 允许合并中间值，不要求审计重放每次提交。
订阅先返回初始快照，再按修订报告更新；不能产生交叉读取或迟到快照覆盖更新。
同进程提交可触发刷新，外部提交由定期观察发现。读取网络故障退避且可见，访问/分区失效终止相应订阅。
监听器抛错不影响已提交事实。限制活动订阅/在途读取，释放后不残留定时器或网络重连任务。
保留未来替换传输的清楚边界，不引入 SSE 事件总线；现有 Agent SSE parser 的 128 KiB 上限不能拿来限制合法 Storage 值。

## 验证

先用真实 HTTP 的“保存→另一个句柄观察→显式重建后恢复”跑通主路径，再补边界：

- 首次快照与并发保存；同身份双标签 user/local 共享；独立浏览器 local 隔离、shared 在相同主体共享。
- 回收后旧前端句柄、旧条件和未读键均不能自动进入新代次；显式新句柄可恢复当前记录。
- 同旧 revision 并发只有一个成功；保存顺序、调用后改入参、释放中迟到结果；网络结果不明不自动重放。
- 401/context 失效、后端重启、读失败退避、取消/释放、监听器异常、容量边界；近 1 MiB 合法记录。
- corrupt 和 unsupported-version 的 HTTP 公开诊断不暴露原始内容，原件仍保留。
- 宿主 HMR 旧 pending 未收口时，新 owner 的请求不能开始；加强 t25 提示的 ready 接纳顺序用例。
- 真实 Chrome 验收适配器本身（普通 HTTP、隔离 profile 和 data），不能只重跑身份 smoke 代替值订阅。

运行 Storage 聚焦测试及主应用 typecheck；脚本新增入口进入 scripts typecheck。
该检查存在已登记的单个既有错误 `scripts/deploy/product-agent-state-root-smoke.ts:318` 缺主题字段，
不扩大修复、也不掩盖本轮新增错误。末尾记录具体文件、实际命令结果与未完成项。

完成本 Task 并经独立复核后，切片 1 才能按合同核对闭合；下一步是 Project 生命周期与文件/备份接线。
