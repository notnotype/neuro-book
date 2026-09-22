# Project 接线前的只读取证

2026-09-16；t26 正在实现 user 浏览器 adapter。本记录不代表 Project 已开始接线，也不追加 Task 范围。

## 关键身份缺口

- `app/composables/useProjectSession.ts` 的 `ProjectSessionReady.revision` 是前端 `++readyRevision`，
  只代表当前控制器的一次 ready 发布，**不是服务端 Project generation**。
- 服务端 `ReadyProjectSessionRef` 包含精确 workspace 对象与 generation；
  `project-session-service.ts:ProjectControlOpenResult` 已有 `{ready, publication}`，
  但 `server/api/projects/open.post.ts` 当前只返回 `opened.publication`。
- `server/api/projects/presence.get.ts` 当前 `presence_ready` 只发布 projectRoot，
  `acquireUserPresence(ref)` 只返回释放函数。浏览器现在拿不到精确服务端 ready 引用的访问标识。

因此不能把 UI revision 或路径当 Storage Project 访问凭据。下一增量须扩展控制面/presence 的发布，
在持有精确 ready 引用的服务端边界绑定主体、客户端和运行期；普通 Storage 请求不能拿旧路径重新查当前 generation。
open 到 presence 之间 close/reopen 也需测试，不能把两个独立时刻的“同路径”视为同一代次。

## 生命周期 owner

- `project-session.ts` 已有 `requireReadyProject`、`activateReadyProjectModule(ready, token)`、
  `runReadyProjectOperation(ready, operation)` 与 `startReadyProjectOperation`，均要求精确 ready 引用。
- `project-module.ts` 的 required 顺序为 database/history/file-index；lazy 为 plot-world/agent-sql。
  新 Storage 应登记 lazy module，且同步返回拥有部分初始化资源的 handle（ready Promise、幂等 close），
  不能把全部 Storage 记录加载变成 Project 的 required ready 门禁。
- `useProjectSession` 已独占取消、latest-wins、active presence 和 reconnect；其普通 release 不关闭全局 Project。
  新接线应跟随这些拥有者，不另起一个“当前 Project”全局单例。

## 文件与备份 owner

- `project-workspace-path-policy.ts` 当前消费者为 file-index/history/archive；已有 recovery preserve 分类。
- `project-file-index.ts` 自己排除 `.git/.nbook/.agent`，但其它文件消费者仍需共同策略覆盖。
- `workspace-archive.ts` 能穿过被忽略的根 `.nbook` 去寻找 preserve 子项，目前注释只写 recovery；
  Storage 正式文件应加入 preserve，锁和临时文件排除，不能把所有普通目录名 storage 都屏蔽。
- `backup-archive-rules.ts` 有锁、临时文件与 SQLite sidecar 排除，仍需实际解包验证 Storage 正式记录、墓碑和原件。

下一 Task 创建前须结合 t26 最终 API 再固定接口；上述只列精确消费缺口，未在本轮修改这些源文件。

## 下一增量的接口边界

适合先闭合 open/presence 的精确 ready 发布，再接 Project Storage 的 lazy module；两者不能用路径查当前代次来糊合。

- 浏览器用的服务端 ready 标识应绑定一个运行期的精确 ready 对象，close/reopen 和换运行期都不能复活；
  服务端解析后仍传播该对象，不再沿调用链凭 projectRoot 求当前实例。
- open 返回标识，presence 必须引用且回报同一标识；前端确认匹配后才发布 ready，保留本地 revision 作为 UI 更新计数。
- 这个标识只是代次定位信息，不替代 auth 或 Storage 主体/客户端核验。Project 打开不能被 IndexedDB 可用性卡住；
  Storage 的客户端初始化失败只使持久恢复不可用，不阻断领域内容消费。
- 保留已有 publication 的 manifest 恢复提示；presence send-before-push、latest-wins、普通 release 不全局 close 都须回归。
- 只读证据：当前 runtime 的 `acquireUserPresence(session)` 已按精确 ready 对象登记；路径串代发生在 service/facade 的旧入口，
  该入口先 `requireReadyProject(ref)` 再 acquire。下一增量应在已有 owner 扩展精确引用入口，避免新增平行的全局当前项目。
