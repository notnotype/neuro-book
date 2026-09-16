# 浏览器 Storage 适配器

本目录是 [storage.persistence](../../../../../docs/specs/storage/persistence.md) 的浏览器宿主适配器。
user 与 project 两个 scope 共用同一 owner 句柄、条件写与订阅实现，只有访问上下文入口与分区目标不同。
UI 消费、切换期间的未提交意图展示与旧键迁移按 Work 的后续切片接入。

## 消费顺序与资源归属

1. **先取得有效的工作面上下文，再签发 Storage 访问。** user 工作面直接调用 `openStorageUserContext`；
   Project 必须先用 Project 生命周期模块打开并等到精确 ready，再把该 ready（`{projectRoot, publicId}`）交给
   `openStorageProjectContext`。Storage 不隐式打开 Project，也不按路径重新求代次；
   Project open/presence 不依赖 Storage 成功，只有消费者需要状态值时才初始化适配器。
2. **目标在第一次 await 前固定。** `openStorageProjectContext` 在身份初始化之前复制并校验定位标量，
   调用方在等待期间切换页面不会改变本次请求地址；`publicId` 缺失、为空或超长时返回 `target-invalid` 且不发请求。
   返回的 session 冻结，包含 `scope`、`contextId`、`clientCredential`，project 另含捕获的 `projectRoot` 与 `publicId`。
3. 宿主用 `openStorageOwnerHandle({session, owner})` 绑定一次 owner 的分区代次；服务端必须预先登记该 owner 的状态定义。
   消费者使用 `defineStorageState` 产生的稳定定义；定义声明的 `scope` 必须与 session 的 scope 一致，
   否则句柄在本地以 `STORAGE_CONTEXT_INVALID` 拒绝，不下发必然无效的请求。
   请求只发逻辑地址、消费版本、值和条件凭据，注册策略由服务端拥有；user 与 project 的值动作入口由 session 固定选择。
4. `read` 返回缺失、删除、当前值、旧值、损坏或未知版本。只有当前值按客户端定义校验；默认显示不写入记录。
   保存用读取返回的条件凭据；冲突不自动换 revision 重试，旧值迁移和坏值修复须显式调用对应动作。
5. `subscribe` 返回初始快照与 refresh/close。默认从上次读取完成起每 500ms 观察，失败退避至最多 8 秒，
   每句柄至多 16 条活动订阅；中间值可以合并。调用方提供 `onError` 展示故障或请求显式重新初始化。
6. **先释放句柄，再释放访问上下文。** `await handle.release()` 停止调度，取消只读请求并等待读写收口；重复释放共同等待。
   句柄不撤销共享 session。宿主等待本工作面所有句柄释放后，再用 `closeStorageContext(session)` 释放自己那一次访问；
   释放只撤销这一份访问，不关闭 Project/presence，也不清除浏览器定位凭证。

## 失败与更换上下文

- HTTP 写入不自动重放，默认请求超时为 15 秒（`request-deadline.ts`，覆盖完整响应体）。
  上下文签发与释放同样受这一期限约束并显式关闭 `retry`/`notify`：签发不是幂等动作，后台失败不能反复触发全局通知。
  `StorageAdapterError` 保留 code、status 与 committed；`true` 表示文件副作用已经提交，`false` 表示明确拒绝，
  `null` 表示未确认。断线或无明确提交事实的 502/503 不能报告为未保存。
- 401/403、访问撤销、服务关闭、Project 关闭/删除/根替换或代次过期使句柄永久失效；
  适配器不会重新签发上下文，也不会用路径再取一次 ready；重新初始化必须由宿主显式进行，旧意图不得自动发给新目标。
- 双方消费定义版本不同返回 `STORAGE_SCHEMA_MISMATCH`，受影响订阅终止；需要更新代码中的定义后再初始化。
  这与磁盘值是否需要迁移分别判断。
- 当前显示、已确认基线与未提交意图由消费宿主分别持有；本目录不提供通用 JSON 合并，也不把订阅值直接应用到布局。
  切换工作面时的旧目标收口、失败重试/放弃与提示属于后续切片。
- 自定义 `StorageValueTransport` 应让请求最终结束并支持只读取消。释放会等待已接纳请求，不因更换 transport 放宽生命周期。

## 验证

聚焦测试：`bun run --cwd packages/neuro-book test app/utils/storage`。
`host-context-client.test.ts` 覆盖两个 scope 的入口路径与请求体、目标捕获、非法目标与身份失效不发请求、
超时不伪装成功，以及真实 adapter 的 context→bind→read/save/read→release 链路。
真实 Chrome 值链路：`bun run --cwd packages/neuro-book smoke:storage-value-adapter --browser-executable <Chrome路径>`。
smoke 使用独立浏览器上下文与系统临时 data，覆盖双标签、客户端隔离、shared、近 1 MiB 值、订阅释放与运行期重建恢复。
具体结果见 [t26](../../../../../.agents/works/w00003-neurobook-ui-foundation-migration/tasks/t26-storage-browser-adapter/walkthroughs/implementation.md)；
project 入口见 [t35](../../../../../.agents/works/w00003-neurobook-ui-foundation-migration/tasks/t35-storage-project-browser/walkthroughs/implementation.md)。
