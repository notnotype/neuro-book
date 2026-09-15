# 浏览器 Storage 适配器

本目录是 [storage.persistence](../../../../../docs/specs/storage/persistence.md) 的浏览器宿主适配器。
当前仅接 user 入口；Project 生命周期与 UI 消费按 Work 的后续切片接入。

## 消费顺序与资源归属

1. 宿主用 `openStorageUserContext` 取得访问上下文。客户端定位凭证保存于 IndexedDB，状态值保存在后端 data。
   身份初始化不成功时不给持久化句柄；调用方按初始化结果展示降级状态。
2. `openStorageOwnerHandle({session, owner})` 绑定一次 owner 的分区代次；服务端必须预先登记该 owner 的状态定义。
   消费者使用 `defineStorageState` 产生的稳定定义。请求只发逻辑地址、消费版本、值和条件凭据，注册策略由服务端拥有。
3. `read` 返回缺失、删除、当前值、旧值、损坏或未知版本。只有当前值按客户端定义校验；默认显示不写入记录。
   保存用读取返回的条件凭据；冲突不自动换 revision 重试，旧值迁移和坏值修复须显式调用对应动作。
4. `subscribe` 返回初始快照与 refresh/close。默认从上次读取完成起每 500ms 观察，失败退避至最多 8 秒，
   每句柄至多 16 条活动订阅；中间值可以合并。调用方提供 `onError` 展示故障或请求显式重新初始化。
5. `await handle.release()` 停止调度，取消只读请求并等待读写收口；重复释放共同等待。句柄不撤销共享 session。
   宿主等待所有句柄释放后，再用 `releaseStorageUserContext` 释放它自己拥有的访问。

## 失败与更换上下文

- HTTP 写入不自动重放，默认请求超时为 15 秒。`StorageAdapterError` 保留 code、status 与 committed；
  `true` 表示文件副作用已经提交，`false` 表示明确拒绝，`null` 表示未确认。断线或无明确提交事实的 502/503 不能报告为未保存。
- 401/403、访问撤销、服务关闭或代次过期使句柄永久失效；重新初始化必须由宿主显式进行，旧意图不得自动发给新目标。
- 双方消费定义版本不同返回 `STORAGE_SCHEMA_MISMATCH`，受影响订阅终止；需要更新代码中的定义后再初始化。
  这与磁盘值是否需要迁移分别判断。
- 当前显示、已确认基线与未提交意图由消费宿主分别持有；本目录不提供通用 JSON 合并，也不把订阅值直接应用到布局。
- 自定义 `StorageValueTransport` 应让请求最终结束并支持只读取消。释放会等待已接纳请求，不因更换 transport 放宽生命周期。

## 验证

聚焦测试：`bun run --cwd packages/neuro-book test app/utils/storage`。
真实 Chrome 值链路：`bun run --cwd packages/neuro-book smoke:storage-value-adapter --browser-executable <Chrome路径>`。
smoke 使用独立浏览器上下文与系统临时 data，覆盖双标签、客户端隔离、shared、近 1 MiB 值、订阅释放与运行期重建恢复。
具体结果见 [t26](../../../../../.agents/works/w00003-neurobook-ui-foundation-migration/tasks/t26-storage-browser-adapter/walkthroughs/implementation.md)。
