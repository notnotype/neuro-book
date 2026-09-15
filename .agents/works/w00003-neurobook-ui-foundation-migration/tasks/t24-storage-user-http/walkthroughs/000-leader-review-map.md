# t24 复核地图与后续传输取证

基线 `3b8d87fb`，主 Agent 2026-09-16 03:31 只读源码取证，不证明 t24 增量已实现。

## t24 需要直接核对的副作用

- `partition-store.ts` 的普通 commitRecord 通过 beforeWrite 回到 assertMutationHealthy；
  修复/迁移的诊断原件、分区代次 writeGeneration、reclaimRecord 的物理删除和临时文件回收也会写盘。
  授权 guard 不能只包 save 的最终 rename；需核对每个 owning boundary。
- mutate 原骨架只在 StorageLockUnavailableError 时携带 context.committed。
  回收已提交新代次后发生其它失败，也不能把这次已发生的提交伪装成 false 或缺失；
  HTTP error projection 需要保留实际语义，而不是从返回类型或异常类猜测提交。
- StorageService.openHandle 会 canonicalize/mkdir 并捕获当时的真实根；host 核验得到的 rootIdentity
  若仅复制数据后重新 open，在两个 await 之间替换目录可能让新句柄绑定到新根。需重新核验原访问身份。
- Host 当前 operate 的寿命只覆盖身份签发/解析；HTTP action 若在 resolve 返回之后另开异步工作，
  不能假定 t23 的 authChecks 或 pending 仍持有这次真实磁盘操作。
- Snapshot 的 corrupt/unsupported diagnosis 和 reclaim 的 io-failure diagnosis 是内部诊断，
  其中可能带物理路径；不能因为它们是成功 HTTP 里的字段就绕过公开错误投影。

## 后续浏览器与订阅的现有入口

- `app/utils/http/read-sse.ts` 可复用流解析、取消和 body cleanup，但当前硬绑定 Agent 的
  `PUBLIC_EVENT_MAX_BYTES=128 KiB`。Storage 定义最高允许 1 MiB，不能直接复用后让大合法状态读不回来。
  后续应明确选择传输预算参数或只发小型失效通知再 GET；这是待实现细节，不改当前 Spec。
- `server/api/projects/presence.get.ts` 展示 H3 背压事实：先 send 才能 await 首帧 push，
  否则没有 reader 时会死锁。订阅需要断连 owner、心跳与身份失效处理，不能空建无人清理的流。
- `app/composables/useProjectSession.ts` 的 controller 已有 opening/active 的明确 token、取消与 release，
  普通离开只释放本标签页 presence，不发送全局 close。Storage 前端可以沿用生命周期思想，但不能拿其
  本地 revision 代替服务端精确 ready generation。
- `server/workspace-files/project-session.ts` 暴露 requireReadyProject / runReadyProjectOperation 等精确 ready 接口；
  required/lazy module registry 在 `project-module.ts`，不是一个另名的 project-module-registry.ts。
  Project 接线必须在其 occupancy 释放前收口 Storage，留给切片 2。

## 验证基线

t23：149 用例、主应用 typecheck、普通 HTTP Chrome smoke 通过；只剩原有两个 descriptors dirty 修改。
脚本全集既有主题 fixture 错误详见 t23 最终报告。新实现不应增加该基线错误。

## 切片 2 已定位的路径消费事实

- `project-workspace-path-policy.ts` 当前只有 content/recovery/rebuildable-runtime/lifecycle-temp，
  尚无 Storage 类别。其 consumer 是 file-index/history/archive，不能只新增一个共用布尔“忽略”值。
- File Index 额外 `.nbook` 排除在 `project-file-index.ts`，相关测试名为 project-file-index-path-policy.test.ts；
  并不存在同名独立生产文件。user-assets 的树与普通写入口还须分别核对，不能拿 File Index 排除作全部证明。
- `workspace-archive.ts` 已支持 archive 的 preserve 判据；即使用户忽略 `.nbook`，仍专门向下寻找 recovery。
  Storage 正式记录需要进入同一保留合同；当前 addFile 把活路径交给 yazl 延迟读取，需检查单记录一致性。
- `backup/backup-archive-rules.ts` 当前按后缀排除 .lock/.tmp/-wal/-shm，State Root 备份遍历 workspace 全量；
  Storage 位于 workspace 内，所以正式记录默认可入包，但锁目录、临时文件、移动/原子替换期间的读取仍需解包实证。
- Storage 是持久化状态，不应为了隐藏文件树把它伪装成 runtime-generated-path 的可重建缓存；
  后者会同时让 Archive 排除，导致备份丢状态。
