---
schema: nbook.task/v2
taskId: t24-storage-user-http
---

# user Storage 受管句柄与 HTTP 读写

## 立即执行范围

### 续修 2026-09-16 03:44

前一轮因 deadline 退出，无 walkthrough，不算交付。已有代码/测试保留，继续本 Task，禁止重新铺设计。
先读 `walkthroughs/leader-progress-review.md`：其中六项在退出后的源码仍存在，逐项修复并补确定性回归。
额外核对：慢 open 后 read 也须检查访问仍 live；关闭中打开的句柄必须排空释放，不能 users 双减；
全局宿主 V2 槽的形状已经变化，明确 HMR 兼容/换代策略。类型检查可能存在新增错误，必须实际跑。
先修 owning boundary 再运行 tests/typecheck，末尾至少预留一分钟写 walkthrough，写明未完成项。
主 Agent 本轮仍只读源码，不会与你并发修改。

接续 `3b8d87fb`（t23 宿主身份已交付）与 `dfc5df82`（t22 核心），完成切片 1 的服务端值读写增量。
优先读取本 Task、`server/storage/{host,access-context,storage-service,http-error}.ts` 与 shared Storage 合同，
先做一个有真实磁盘结果的 user/local 保存与恢复回归，再补生命周期边界；不要重新广泛调研已冻结设计。
所有包内路径以 `packages/neuro-book/` 为根。末尾留出时间写 walkthrough 和最终交接，超时不算完成。

Work：[w00003](../../README.md)；当前 [实施计划](../../storage-implementation-plan.md)。
行为：[storage.persistence](../../../../../docs/specs/storage/persistence.md)，取舍：[ADR 0021](../../../../../packages/neuro-book/docs/adr/0021-local-storage-persistence.md)。
前置证据：[t23 最终复核](../t23-storage-host-identity/walkthroughs/leader-review.md)。

## 授权与非目标

- 延续本 Work worktree 与分支；保护两个 descriptors dirty 文件；不修改主工作区。
- 允许改 `shared/storage/`、`server/storage/`、`server/api/storage/` 及必要 shutdown/auth 接线和对应测试。
  可以修改 t22 的 owning boundary 来保证授权失效停写，必须补真实副作用前的竞态回归，不绕过核心类型。
- 不挂主应用启动、不改 Config、Project/文件备份、UI/插件/grid/旧键/命令系统，不建立在线同步。
- 本 Task 不实现浏览器值适配器与网络订阅；它们在服务端访问生命周期明确后继续。不要为尚未消费的传输造事件总线。
- 不联网、不再派代理、不提交/push/PR/部署、不操作真实用户数据。测试根使用测试支持包的隔离 Temp。
  当前仅主 Agent 做只读核对，不并行修改本 Task 源码。

## 结果与合同

1. **注册定义是唯一策略来源。** 宿主拥有明确的 `StorageStateRegistry`/`StorageService` 运行期与关闭边界。
   生产只能由受信模块注册定义，测试可注入隔离 registry/service；请求不能注册 schema 或改变 locality。
   HTTP 输入只提供合法 owner/key、可选 resource 和该操作的值/条件凭据；主体、客户端、根、scope 来自 t23。
   不为验收把一个永久 demo 状态注册进生产；测试通过同一受信注册入口装载 fixture 定义。
2. **HTTP 结果闭合核心能力。** 提供读取、条件保存、删除、显式迁移/修复与选定墓碑回收；
   可复用一个 action DTO 与薄路由，具体路径由 owning boundary 的可理解性决定，不复制核心算法。
   外部输入使用严格有界解析；禁止按客户端提交的 scope/root/subject/clientId 改变目标；
   丢失、删除、旧 schema、高版本、损坏和 I/O 失败区分保留。默认显示不创建记录。
   无需为了 REST 形式把一次原子 mutation 拆成多个路由调用。
3. **访问标识与实际句柄同生命周期。** 有界地拥有正在打开的句柄、已打开的 owner 句柄和已接纳操作，
   同上下文同 owner 并发打开收敛且不能泄漏。释放上下文、session 撤销、空闲到期与产品关闭使实际句柄停止接纳并排空。
   自然到期不能只在下一次请求 lookup 才关闭资源；若每请求句柄策略更清楚，也可不保留空闲句柄。
   释放/重启的旧上下文不能拿来重新打开当前 root 的新句柄；根在核验与打开之间被替换也要拒绝。
4. **授权失效与提交分界。** 在已接纳 mutation 等锁、替换重试或修复原件时发生撤销，必须在真实文件副作用前重新检查。
   不把 `resolveStorageAccessContext` 返回的一次快照当无限期授权；不要只在入口检查后继续旧异步写。
   正常关闭可排空有效已接纳操作；授权失效/根替换/锁失效必须停止无效副作用。已实际提交的事实不能被后续失败伪装成未提交。
   保持核心宿主无关：用受信边界的生命周期 guard/lease 注入，不在文件层导入 H3/auth。
5. **公开错误与重试。** HTTP 不公开内部路径、原始凭证或用户信息；按稳定 code 分派，
   传递 core 已知 committed 标记，网络结果不明不能声称未保存或自动重放 mutation。
   释放已撤销上下文幂等；退出后 401 由调用方当作访问已失效，不制造重试循环。

## 验证与交付

- 聚焦真实 HTTP+隔离磁盘：未注册拒绝、伪造身份/路径拒绝、不同主体/客户端隔离；保存→重读→新运行期恢复；
  同旧 revision 并发只有一个成功、缺失删除墓碑、损坏不可普通覆盖、显式修复/迁移、回收后旧条件与句柄失效。
- 生命周期：并发打开与释放、打开中关闭、等锁/副作用前撤销、相同物理路径替换、故障/超时 committed 事实；
  各用例 afterEach 排空服务并清理本用例根，不读写机器默认 data。
- 查 package.json 后运行 `bun run --cwd packages/neuro-book test shared/storage server/storage server/api/storage`、
  主应用 `typecheck` 与 `git diff --check`。t23 149 用例基线应保持。
- `scripts:typecheck` 已知既有错误仅 `scripts/deploy/product-agent-state-root-smoke.ts:318` 缺两个主题字段，
  不扩大修该文件、不用这个基线错误遮盖本轮新增错误。
- walkthrough 记录实际 API、入口/撤销/关闭 owner、验证命令和结果、未运行项、前端订阅接线条件。
  期限不足给真实进展与剩余缺口，不写无证据的通过；主 Agent 会读源码并独立验证后再提交。
