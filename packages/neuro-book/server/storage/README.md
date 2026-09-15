# Storage 本地服务核心

本目录实现 [storage.persistence](../../../../docs/specs/storage/persistence.md) 的宿主无关服务核心。
公开入口为 `nbook/server/storage`；浏览器可消费的定义、DTO、状态投影与错误码在 `nbook/shared/storage`。
数据选址与生命周期以 [storage.boundaries](../../../../docs/specs/storage/boundaries.md) 为准。

## 消费顺序

1. owner 用 `defineStorageState` 声明 key、scope、locality、寻址方式、schemaVersion、默认值、校验与可选迁移函数。
   默认 locality 为 local；逻辑标识使用小写安全单段。定义和默认 JSON 深冻结，同一实例可重复注册。
2. 将定义登记到 `StorageStateRegistry`，创建有宿主生命周期的 `StorageService`。
   同一 owner/scope/locality 共用分区容量；冲突定义拒绝注册。修改定义时重建 registry/service。
3. 宿主核验主体、客户端与 user/Project 上下文后调用 `openHandle({owner, context})`。
   `context.storageRoot` 必须显式来自 Workspace/Project 路径服务；HTTP body、页面状态不能直接构造受信上下文。
4. `read` 或 `subscribe` 返回分类快照。只有缺失/删除可使用默认显示并继续条件写；默认显示不产生值文件。
   `save/remove` 使用读到的凭据；旧版本使用 `migrate`，损坏或高版本的显式重置使用 `repair`。
5. 组件停止消费时关闭订阅；owner 上下文结束时 `await handle.release()`，宿主结束时 `await service.close()`。
   重复关闭共同等待已接纳操作收口。只有完成的保存才是磁盘确认，内存中的未提交意图由前端适配器拥有。

取得句柄会捕获根目录身份与可访问分区代次，但不创建默认记录。回收墓碑后所有旧句柄和凭据失效，
包括尚未读取记录的句柄与发起回收的句柄；需要重新打开。回收请求一次最多列出该分区容量上限数量的明确资源。
本地命名空间隔离不是任意可执行插件代码的安全沙箱。

## 内部职责

| 模块 | 职责 |
| --- | --- |
| `storage-service.ts` | 受信上下文、定义解析、接纳顺序、句柄和服务收口 |
| `storage-subscription.ts` | 有生命周期的连续观察、初始快照顺序、读取串行与错误隔离 |
| `partition-store.ts` | 分区代次、条件提交、容量、迁移/修复/回收 |
| `storage-address.ts` | 逻辑寻址、真实目录身份、拒绝符号链接和目录联接 |
| `partition-lock.ts` | 实际分区的跨进程锁、心跳失效与释放结果 |
| `record-file.ts` / `record-codec.ts` | 有界读取、文件格式、原子替换、诊断原件和临时文件 |
| `identity-domain.ts` | data 身份域的受锁初始化 |

订阅对本服务提交立即调度观察，同时以默认 500ms 间隔观察外部提交；每个订阅读取串行，
实际轮询间隔从上次读取完成起算。它可以合并中间值，不能用作审计事件流。
监听器应提供 `onError`，由宿主展示读取故障或重新建立失效上下文。

记录文件使用同目录唯一临时文件、文件同步与原子替换；替换占用重试有界，每次副作用前检查锁和目标归属。
读取使用同一个文件句柄和有限长度；原地改写检测为读取失败，不能伪装缺失。
诊断区保留原始字节，独立上限为 1024 份、16 MiB；单份不超过 1 MiB 加 4 KiB 封装预算。
超限或无法可靠保存原件时拒绝修复，保留原地址的保护状态；不会清理旧诊断原件换空间。
持锁维护只回收可识别的本模块临时文件，不删任意同后缀文件。

## 当前边界与验证

本增量没有接入 HTTP 鉴权、客户端身份签发、Project ready/关闭、产品停机、备份或 UI。
它接受已核验的宿主上下文；后续宿主适配器必须在每次请求与长连接期间维护真实授权。
专用旧桶迁移原件预留、在线同步与领域数据 Store 不属于普通记录实现。

聚焦验证命令：`bun run --cwd packages/neuro-book test shared/storage server/storage`。
服务入口已纳入主应用 typecheck；测试包含真实跨进程 revision 竞争、Windows 目录联接和注入的磁盘/锁故障。
本轮证据记录在 [t22 walkthrough](../../../../.agents/works/w00003-neurobook-ui-foundation-migration/tasks/t22-storage-core/walkthroughs/leader-review.md)。
