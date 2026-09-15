# t22 Leader 增量复核

## 当前复核结果（2026-09-16）

下文保留初版问题与故障探针作为修复来源，不表示当前代码仍有同样缺陷。
主 Agent 已接续同一 t22 Tasker 合同修复并直接运行验证；omp 首轮超时没有被当作交付通过。

- Shared：去掉 Buffer 依赖；JSON 在接纳边界捕获且递归冻结，不执行 getter；默认 locality=local。
  定义只能由工厂创建，注册只接受同一实例幂等调用，分区 quota 冲突拒绝，大写与 Windows 设备名拒绝。
- 条件写：缺失删除落墓碑；代次解析失败仍释放锁；legacy 只能显式 migrate，普通覆盖拒绝。
  单句柄按实际分区串行接纳保存和维护；值、凭据与 resource 在排队前捕获。
- 文件：同句柄有限长度读取，原地改写失败不伪装缺失；诊断保留原始字节再原子替换。
  ENOSPC 回归确认修复失败后原地址仍然 corrupt；诊断份数/字节有界，崩溃临时件只按模块唯一文件名回收。
- 隔离：逐级拒绝目录联接和符号链接，包括同根跨 owner；根目录设备/文件身份在句柄签发时捕获。
  根同路径被替换后旧句柄不能重建分区。
- 回收：先提交新代次再删明确墓碑；发起句柄、冷句柄和同分区其它订阅均失效；代次安全整数边界有回归。
  每次真正副作用及重试前检查锁健康，释放/失效报告使用实际 committed 状态。
- 订阅/关闭：本进程通知与有生命周期的外部轮询共用串行队列，初始响应先于更新；首次读取失败清理。
  onUpdate/onError 均隔离；服务、句柄、订阅重复关闭共同排空，打开/订阅期间的关闭竞态有测试。

### 独立复核

1. omp 聚焦审查 `record-file/storage-address/partition-lock`，正常退出 0；仅源码审查。
   提出的根内跨 owner 联接、无界 readFile 窗口、诊断临时件残留、清理失败错误计数均已处理。
   主 Agent 用真实目录联接与字节文件测试核对，未采信“仅 stat 后 readFile 即可有界”的建议，改为同句柄有限长度读取。
2. omp 聚焦审查 `storage-service/storage-subscription`，正常退出 0；未发现其列出生命周期检查的阻断项。
   它仍发现公开 forget 可绕过服务关闭、重复捕获、订阅关闭诊断 owner/reason 不正确。
   主 Agent 将第一项按真实行为缺陷处理：删除公开 forget，使用私有收口回调；后两项也已修复。
   修后重跑受影响测试。两次 omp 均未自行运行测试，以下结果由主 Agent 直接运行。

### 实际验证

- `bun run --cwd packages/neuro-book test shared/storage server/storage`：退出 0，10 文件、86 用例通过。
  包含真实双进程争同 revision，以及新的 `storage-core-regression`、`storage-subscription`、`record-file` 回归。
- 主应用 typecheck 已显式纳入 `server/storage/index.ts`，修订后的最终检查退出 0。
  早期未纳入入口的 typecheck 仅是基线，不能证明本核心类型正确。
- `bun run docs:check`：退出 0，5595 文件，failures=[]；t22 governance:context 无 failures。

### 未覆盖项

本 Task 只交付切片 1 的本地核心增量。HTTP/身份签发、Project/退出 owner 接线、前端 adapter、
专用迁移原件预留、备份、主界面和真实浏览器验收尚未完成；Spec 继续 planned，goal 继续 active。
本机 Windows 已验；没有运行其它 OS、全量产品测试或真实用户数据迁移。

## 初版历史发现

以下为接手前的历史记录，处理状态以本文顶部和当前源码为准。

## 已复现

2026-09-16 01:41（本机），用 Bun 仅内存探针导入 shared/storage，无文件与产品数据写入：

```json
{"validatorBefore":true,"validatorAfterRegistration":false,"withoutNodeBuffer":"undefined is not an object (evaluating 'Buffer.byteLength')"}
```

1. `bounded-json.ts` 使用 `Buffer.byteLength`。去掉 Node 全局 Buffer 后普通 `{x:1}` 检查即抛异常，违背宿主无关共享合同。使用浏览器/Node 共同具备的 UTF-8 能力并补运行证据。
2. `definition.ts` 接受同 owner/key/schema/default 但 validate 不同的重新注册，并把原注册对象替换。先注册任意字符串校验、再注册仅允许 default 的校验，旧定义 resolve 后策略改变。不能把函数忽略宣称兼容；不兼容重复注册必须拒绝，既有句柄的策略稳定，HMR 使用明确生命周期快照或重建边界。

## 从初版代码推断，等待完整实现确认

- 标识允许大小写且 owner/key/resource 直接组成文件名：Windows 大小写不敏感会使不同逻辑键、owner 或资源碰到同一路径。物理编码应保留逻辑隔离，不靠调用方碰巧只写小写。
- `quarantineStorageRecord` 先删除旧隔离原件，再 rename 原记录；若随后写入失败/崩溃，原地址变成 missing，普通写可覆盖恢复默认。须先可靠保存诊断原件、仍由原子替换提交目标，失败保留旧目标；隔离区动态资源和原始坏文件还需要真实字节/数量界限。
- registry.resolve 按 caller 的泛型断言结果但只查 owner/key；调用方可传不同 T 的同名定义得到错误类型。运行期策略与类型 token 必须绑定，不能靠断言掩盖。
- defineStorageState 只浅冻结，limits 与 defaultValue 可通过持有者改写；校验过程读取 getter/toJSON 或可变对象时，需确保真正序列化的是已验证快照。

上述推断尚未构成最终完整服务审查。Tasker 可用实际实现与回归测试反驳，Leader 在其交接后从当前文件重新核对。

## 核心服务初版进一步发现

2026-09-16 01:43 初版静态复核；实现仍在推进，需以交接后的文件复验：

1. `partition-store.mutate` 取得锁后，ensureGeneration/assertHandleGeneration 在捕获 action 错误和 release 之前。任一步失败会泄漏持锁者，需整个取得锁后的路径都由 finally 释放。
2. remove(missing) 返回原 null revision 不写墓碑；读缺失、显式重置、拿重置前缺失凭据保存的序列仍可成功，违反删除不得被旧请求复活，也无法阻止旧值导入。
3. `repair` 先移走原记录，measurePartition 已不含它，却仍减 previousBytes/exists，可能少算容量。修复提交前保留原路径可同时解决失败恢复和计量问题。
4. 实际读写只检查 partition.directory containment，没有检查其内部 records/quarantine 的 junction；中间目录可越过分区或 alias 另一个 owner。要核对每级拥有边界，补真实 symlink/junction 测试。
5. quota 由当前 key 的 limits 决定；同 owner 的两个 key 注册不同总容量时能绕过较严边界。owner 实际分区的总限额必须唯一，注册时拒绝冲突或由 owner 定义统一提供。
6. readRecordState 只用 owner.validate，未统一校验有限有界 JSON。宽松 validator 会接受手工文件 `1e999` 为 Infinity 或超过上限的值；还需限制读文件本身体积，不能先无界 readFile 再判断。
7. legacy-value 被普通 save/remove 当可写，不保留旧原件；已声明 migrate 函数却无迁移执行入口。旧版本升级必须走显式条件迁移与原件保留，不能直接覆盖。
8. 每句柄未按提交顺序串行保存，同进程并发直接竞抢文件锁不保证顺序；输入对象/凭据还应在接纳时捕获，避免 await 期间被 caller 改写。
9. 订阅仅本 service notify，另一进程或另一 service 的提交不会持续观察（手动 refresh 不满足 Task 的自动订阅合同）。Hub.open 读取失败未移除 entry，onError 抛出可能成为未处理 rejection，refresh 与 deliver 并发可发布倒退快照。
10. close 第一次未排空时第二次即返回；openHandle 在 canonicalStorageRoot 的 await 期间与 close 竞态能产生关闭后句柄；subscribe 在 close 先清空 subscriptions 后才完成也会遗留订阅。必须有共同的 close Promise、接纳门禁和完整异步收口。
11. reclaim 将发起句柄 box 改到新代次并仅通知选定键；规范要求旧句柄全部失效及重新初始化，同分区其它订阅也需失效。元数据写与每个删除同样检查锁健康，并明确中途中断的已提交事实。

## 磁盘故障探针已复现

使用 `resolveAgentAcceptanceRoot()` 下独立临时目录，仅创建测试记录；finally 核对绝对目录仍为该临时根的直接子目录后清理。
初版服务实测结果：

```json
{"deletedMissingRevision":null,"staleMissingSave":"accepted","repairFailure":"STORAGE_IO_FAILURE","afterRepairFailure":"missing"}
```

- 读缺失 → remove(expected=缺失凭据) → save(expected=删除前缺失凭据) 被接受。
- 将测试记录写成坏 JSON，读修复凭据，再给 replace 注入 ENOSPC；repair 拒绝后 read 返回 missing，原地址失去损坏状态保护。

这两项由静态推断提升为已复现，修复需补对应回归测试。未涉及真实用户记录或运行时迁移。

## 初版聚焦测试

主 Agent 于 01:50 运行 `bun run --cwd packages/neuro-book test shared/storage server/storage`：退出 0，7 文件、59 用例通过。
它证明初版已有用例通过，但未覆盖上述已经独立复现的失败序列，不能作为本 Task 审查通过证据。
