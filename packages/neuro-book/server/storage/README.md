# Storage 本地服务与宿主身份

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
| `access-context.ts` | 独立访问标识、绑定声明、空闲到期、容量与 session 撤销 |
| `host.ts` / `http-error.ts` | 浏览器请求身份核验、初始化排空与公开错误投影 |

订阅对本服务提交立即调度观察，同时以默认 500ms 间隔观察外部提交；每个订阅读取串行，
实际轮询间隔从上次读取完成起算。它可以合并中间值，不能用作审计事件流。
监听器应提供 `onError`，由宿主展示读取故障或重新建立失效上下文。

记录文件使用同目录唯一临时文件、文件同步与原子替换；替换占用重试有界，每次副作用前检查锁和目标归属。
读取使用同一个文件句柄和有限长度；原地改写检测为读取失败，不能伪装缺失。
诊断区保留原始字节，独立上限为 1024 份、16 MiB；单份不超过 1 MiB 加 4 KiB 封装预算。
超限或无法可靠保存原件时拒绝修复，保留原地址的保护状态；不会清理旧诊断原件换空间。
持锁维护只回收可识别的本模块临时文件，不删任意同后缀文件。

## 当前边界与验证

user 身份入口为 `POST/DELETE /api/storage/user/context`，请求头使用 shared 的 host 合同。
浏览器用同一 IndexedDB readwrite 事务持久保存随机定位凭证；同源标签页共享凭证但各自签发独立访问。
auth-on 先核验 active/sessionVersion，访问绑定 session 标识；成功登录与退出撤销旧 session 的访问。
auth-off 使用跟随 data 身份域的本地主体。签发还绑定真实目录身份，复制身份文件不能恢复旧访问。
上下文全宿主默认最多 256 个，每个主体与客户端最多 32 个，30 分钟未核验即到期；满额只回收已到期项，仍满则拒绝新签发。
后续 adapter 须在失效后重新初始化；不能因重签发丢弃当前界面的未提交意图。
关闭会拒绝新身份操作并排空在途初始化；当前尚未接入值读写 HTTP、长连接撤销、Project ready/关闭、备份或 UI。
这些消费者仍须在每次请求与长连接期间维护真实授权，并让实际 Storage 句柄在授权撤销时停止接纳并排空。
专用旧桶迁移原件预留、在线同步与领域数据 Store 不属于普通记录实现。

聚焦验证命令：`bun run --cwd packages/neuro-book test shared/storage server/storage`。
服务入口已纳入主应用 typecheck；测试包含真实跨进程 revision 竞争、Windows 目录联接和注入的磁盘/锁故障。
核心证据见 [t22 walkthrough](../../../../.agents/works/w00003-neurobook-ui-foundation-migration/tasks/t22-storage-core/walkthroughs/leader-review.md)，
宿主身份增量见 [t23](../../../../.agents/works/w00003-neurobook-ui-foundation-migration/tasks/t23-storage-host-identity/README.md)。
