# t28 实现中与后续接线取证

## 05:21 追加状态

首轮 omp 已退出；前端问题已由主 Agent 按 Task 分工补修，见 [frontend-followup](frontend-followup.md)。
该修订的前端/路由测试实际为 3 文件 33 用例，主应用 typecheck exit 0。
服务端 HMR / presence terminal 追加修复仍在进行，前述类型检查不能作为其最终结果。

下一 Project Storage 增量应沿用以下已查明边界：

- `StorageAccessContextRegistry` 当前 claims 只有 scope/root/身份域/主体/session/client，
  需要把 Project 精确 ready 的有效性纳入访问，不能只给 scope 改成 project。
- `server/storage/host.ts` 已集中 auth-on/off、登录撤销、在途核验与容量；Project 身份不能复制另一套鉴权语义。
  公共定义 registry 与 Project 的 lazy service/pool 分开组织，避免 module→host→Project facade 的初始化环。
- `project-module.ts` 同时有显式 ModuleName 与 lazy 顺序，新增 storage 要登记两处；
  `project-session.ts` 是生产 composition root，测试必须证明默认 Project open 不提前启动 storage。
- `startProjectOperation/runProjectOperation` 先登记 completion，再执行回调；close 先 abort 后等待所有 dataOperations，
  再关 Module 和 Occupancy。Storage 须明确选择已接纳写的收口行为，并对占用锁失效、根替换与授权撤销保持副作用前保护。
  不能在 lazy Module close 中等待一个由自身 close 才能结束的 operation，形成循环等待。
- 浏览器 `host-context-client.ts` 与 `value-transport.ts` 当前固定 user 路由；Project adapter 应保留冻结目标，
  不让后续读取当前页面的 Project 路径改变既有请求。Project open 本身不依赖该 adapter 初始化。
- 首次建立 Project Storage 根也是写入：`StorageService.openHandle` 未传 `expectedRootIdentity` 时会递归创建根。
  Project adapter 必须在精确 ready / Occupancy / 物理目录有效性下初始化，后续动作固定 expected root；
  已失效请求不得重建被删除的 Project。`ensureStorageIdentityDomain` 仅用于 data 的 user 根，不在 Project 根签发新身份域。
- `ResolvedProjectWorkspace` 本身只携带路径与进程 Symbol，物理 fingerprint 保存在 Lifecycle 的 RootIdentity owner。
  不能把该 Symbol 序列化或当作物理目录证明；若初始化需要额外 revalidation，应由既有 Project owner 提供，
  不让插件按路径新建另一份“当前项目”。

2026-09-16；主 Agent 只读取证，Tasker 仍独占源码。以下必须按最终源码核对，不把中间实现判断当已交付缺陷。

## 当前 HMR 待核对

接口选择称沿用 `globalThis.__nbookProjectSessionV2`、复用同一 Service 即保留标识。
须区分“新版模块重载”与“本次升级前的旧 V2 实例”：旧 Service/Runtime 对象没有 publicId 与新增解析方法，
旧 acquireUserPresence(ref) 也不消费新的 publicId 参数。只保留 global 槽不会自动更新旧对象的 class prototype。
最终应有真实旧形状对象的确定性 HMR 用例，证明安全换代/排空、拒绝旧身份，或兼容接管明确受支持的旧对象。
不能只测试全新新版实例重复 import，就宣称跨升级 HMR 完成。

## 当前前端与 presence 待核对

- 05:07 中间代码仅 type 导入 ProjectOpenResponseDto/ProjectPresenceEventDto；真实 `$fetch` 与 `readSseStream<T>` 都不执行 schema 校验。
  新页面遇到旧后端时，open 与 presence 都缺 publicId，`undefined === undefined` 会通过配对并发布 ready。
  应在实际网络/控制器边界核验必填非空标识；单纯声明 TypeScript 字段必填不能消除运行期缺字段。
- beginOpen 为避免 ready 占位而改成 `let current!: Opening; current={promise:(async()=>...)()}`。
  若 transport.open 在返回 Promise 前同步抛错，catch 发生在 current 赋值之前，会误判 superseded，
  可能留下 opening 状态。应由一次真实异步调度后启动，或使用明确 deferred，不靠断言跳过初始化。
- presence 当前只拿 release 闭包，未持有该 ready 的终止 signal。要核对终止/根替换发生在 acquire 与首帧之间，
  以及已建立流之后的行为；不能持续向已关闭 ready 发心跳或让旧首帧被当成可消费上下文。
  精确引用解决跨代取错目标，但不会自动把 HTTP 长连接纳入 lifecycle。

05:09 主 Agent 用 Node+tsx 直接导入当前 `createProjectSessionController` 的独立探针已证实前两项：

```json
{"probe":"missing-id","state":{"status":"ready","ready":{"projectRoot":"alpha","revision":1}}}
{"probe":"sync-throw","error":"ProjectSessionSupersededError","state":{"status":"opening","phase":"opening-project","projectRoot":"alpha","ready":null}}
```

前者 open/presence 均故意模拟旧后端、不含 publicId；后者 transport.open 在返回 Promise 前同步抛错。
finally 均 `await controller.release()`，没有挂住连接、定时器或写入文件。最终需补相应用例并转绿。

## 后续 Storage 身份与 lifecycle

- 现有 Storage data 身份域元数据在 user 根 `WorkspaceRoot/.nbook/storage/identity.json`。
  Project Storage 应消费当前 data 的身份域和已核验主体，同时以 ProjectRoot/.nbook/storage 作为记录根；
  不能为每个 Project 新建另一个 data 身份域，或把从别的 data 复制来的 Project 原记录自动改归当前主体。
- `StorageAccessContextRegistry` 目前 claims 没有 ready 引用；需要由拥有者关联精确 ready，不能只改 scope 字段。
- user Storage 的 shutdown 已接入 product-shutdown；Project Storage 必须作为 lazy module 在 occupancy 释放前排空，
  对根替换/授权失效仍按副作用前 guard 失败，不用忽略 AbortSignal 强行写盘。

## 后续文件与备份路径（从代码推断，尚未跑新验收）

| 入口 | 当前事实 | 需要核对的结果 |
|---|---|---|
| project-workspace-path-policy.ts | 三消费者 file-index/history/archive；目前只分类 recovery/runtime/temp | `.nbook/storage` 的正式记录/墓碑/原件 preserve；锁/临时 ignore |
| project-file-index.ts | watcher 私有排除 `.nbook/.git/.agent`；Project 扫描另接统一 policy | Storage 写入不出现在树/内容事件/history；普通 `notes/storage` 正常 |
| workspace-files.ts | 通用 scan 只按 ignore/runtime 过滤；读写核心主要拿物理 root | 用户资产根内部 `storage/` 不能成为普通文件读写入口，不能只靠 tree 隐藏 |
| WorkspaceFileTarget | 已有 project-workspace/user-assets/workspace-root 判别归属 | 在持有该类型的边界判保护路径，不能从 basename 猜 root 类别 |
| workspace-archive.ts | 根 `.nbook` 被 ignore 时会向下寻找 preserve 子项；目前只有 recovery | 项目 ZIP 强制纳入 Storage 正式内容；单记录一致，不承诺跨键整体快照 |
| backup-archive-rules.ts | 只按 `.lock/.tmp/-wal/-shm` 后缀排除 | Storage `.locks` 与模块独有临时名必须实际解包验证，身份域必须保留 |
| novel-workspace.ts | user-assets 根为 WorkspaceRoot/.nbook；isManagedAssetBlacklisted 控制同步源 | 同步源/已有 sync state 清理均不能安装、覆盖或清理 storage 根 |

Storage 临时文件后缀来自 record-codec，原件在 quarantine（`.corrupt`），不能把这两类混为缓存。
完整 data 备份使用 fflate 逐文件 createReadStream；项目 ZIP 使用 yazl.addFile 延迟打开源，
需要用真实替换/导出场景验证单条记录与 metadata，不仅测试字符串路径谓词。

普通文件 mutation 保护还要覆盖祖先目录的 rename/delete、从普通路径移入受管路径、指向 Storage 的内部链接，
以及 workspace-root 模式从上层访问 `<project>/.nbook/storage`。只禁显式 user-assets/storage 的单文件写入不足以封住通用 API。
具体取舍由后续路径 Task 沿已有受管目录合同实现，不能把普通内容目录名 storage 变成保留词。
