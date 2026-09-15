---
schema: nbook.task/v2
taskId: t23-storage-host-identity
role: tasker
---

# 浏览器客户端身份与 user 访问上下文

## 当前交付与历史分工

主 Agent 已完成宿主上下文、登录/退出撤销、物理目录绑定、关闭排空和 smoke 隔离；
浏览器身份续修已由 omp 交付，核心测试的类型收窄由另一轮 omp 交付。
主 Agent 已复跑 19 文件、149 用例和普通 HTTP Chrome smoke（findings=[]）；主应用 typecheck 通过，
最终只读 omp 复核“不阻断”。完整证据、既有脚本全集错误和下一增量约束见 [交付复核](walkthroughs/leader-review.md)。
服务端 helper 已移出 API 扫描目录。值读写 HTTP、订阅与句柄撤销属于下一增量，未接入主应用启动。

以下保留首轮分工背景，不是当前文件独占声明；最终证据与边界见本 Task walkthrough。

### 首轮续修分工（2026-09-16 02:54，已结束）

首轮 omp 15 分钟期限退出，未给报告；实现和测试已落盘但未交付。主 Agent 接续同一 Tasker 合同，
修 `access-context`、宿主 HTTP/生命周期和 smoke；不会与续修 omp 同时改浏览器身份模块。

**当前派发的 omp 只负责** `app/utils/storage/client-identity.ts` 及同目录该模块测试，
阅读 [Leader 已复现问题](walkthroughs/leader-progress-review.md) 第 5 项，修复 IndexedDB 连接的归属和失败收口。
不修改 shared、server、smoke、package.json、其它前端文件或本 Task 身份；不派更多代理、不联网、不提交。
现有 `loadOrCreateStorageClientIdentity/clearStorageClientIdentity` API 与结果形状保持兼容。
可以取消连接缓存、按操作打开并在 finally 关闭连接；身份操作低频，不需要为缓存承担泄漏和失效复杂度。
onblocked 返回失败后迟到成功需关连接；版本变化后的新调用能重新打开；异常/事务中止要真正收口。
JSON 记录保护、同事务读写、HTTP 下 getRandomValues 与身份不可恢复语义保持。
主 Agent 拥有真实浏览器 smoke 和最后复验，续修 omp 不运行仍在改动的全套 smoke。
期限内必须写 `walkthroughs/browser-identity-repair.md` 简短交接（实际修改、验证、未验证），再给最终答复。
优先只读取这两个模块、相关失败报告与 Tasker 合同，避免再次把整轮时间花在广泛调查。

## 目标

接续已提交的本地核心 `dfc5df82`，完成 [实施计划](../../storage-implementation-plan.md) 切片 1 的宿主身份增量。
让浏览器获得可恢复的客户端身份，并由服务端核验当前主体、data 身份域和运行期后签发可撤销的 user 访问上下文。
这是后续 HTTP 状态读写/订阅 adapter 的前置，不宣称整个切片 1 完成。

行为合同：[storage.persistence](../../../../../docs/specs/storage/persistence.md)「身份与访问上下文」；
取舍：[ADR 0021](../../../../../packages/neuro-book/docs/adr/0021-local-storage-persistence.md)。
核心入口见 `packages/neuro-book/server/storage/README.md`，后续接线地图见 [t22 baseline](../t22-storage-core/walkthroughs/000-leader-baseline.md)。

## 范围和授权

- worktree/branch 延续当前 Work；主工作区和原有 `descriptors.ts` / `descriptors.test.ts` dirty 修改保持不动。
- 实现主应用 `shared/storage/` 的宿主 DTO、`server/storage/` 的身份/上下文服务、
  `server/api/storage/` 的最小初始化/释放接线、`app/utils/storage/` 的纯浏览器身份提供者和所需 adapter。
- 允许接入 `server/runtime/shutdown/product-shutdown.ts` 的 user 身份/上下文收口；
  新模块必须参加 typecheck。不要修改鉴权策略、Config 产品行为、包依赖或 Spec 的 scope/locality。
- 不做 Project ready 接线、状态读写 HTTP 全套、SSE、Pinia 旧键迁移、插件/grid、标题栏或命令系统。
- 不联网、不派更多子代理、不提交/push/PR、不操作真实用户数据或启动默认产品环境。
  使用隔离临时根测试；真实浏览器验收只使用隔离测试宿主与浏览器上下文，避免现有登录态。

## 必须闭合的行为

1. 客户端身份只定位 local 分区，不承载状态值，不代替用户鉴权。身份定位凭证不可猜测且有界；
   服务端从宿主凭证得到 clientId，业务状态请求不得自由指定 subject、clientId、identityDomain 或磁盘路径。
   不为小标识引入一套通用密码/账号系统；已有宿主 session 可复用，但不能依赖 HTTPS-only API 才支持现有 HTTP 部署。
2. 同一浏览器存储上下文首次双标签并发初始化必须在开放可恢复访问前收敛为同一个身份。
   普通 localStorage get/set 与单次 Set-Cookie 不能作为跨标签互斥证据；优先评估 IndexedDB 原子事务。
   两个独立存储上下文隔离；重开可恢复；清除标识后的新初始化获得新身份。
   浏览器存储读取/写入失败、事务中止或拒绝持久保存时明确返回不可恢复状态，不落 shared/公共桶、不启动旧键导入。
   本增量不自动挂到主应用启动，以免提前启动消费者和旧数据行为。
3. user 上下文由服务端核验当前主体、客户端凭证、身份域与运行期后签发。
   auth-on 复用 `getCurrentUser/requireCurrentUser` 的 active/sessionVersion 检查；auth-off 使用独立本地主体。
   客户端身份凭证与一次访问上下文分开：后端重启撤销旧访问，但保留的浏览器身份能重新定位原 local 分区。
   不在日志/错误响应里泄露定位凭证、内部路径或未来签名秘密。
4. 上下文 registry/owner 必须有明确生命周期和容量边界；释放与服务关闭幂等排空，关闭后不再签发。
   换账号、失效 session、修改 credential、跨运行期和释放后的上下文不能继续解析为可写访问。
   核验当前请求身份不等于只在签发时信任它；为后续每次请求与长连接撤销提供实际可调用的校验边界。
   无需空建 SSE/事件总线。若本次仅完成请求级核验，明确长连接接线仍在后续。
5. 复用明确的 WorkspaceRoot 路径服务与 t22 身份域初始化。隔离测试通过参数注入根、当前主体与生命周期；
   测试不能偷偷落到机器默认 data，也不能用任意 body 里的 root 生产化。

接口和具体文件名由代码取证后选择，写清 owner 和失效条件；不要堆未消费的抽象。
发生 API 取舍时按以上已批准行为做最小实现，不重复向开发者询问已决定的 scope、同步或权限边界。

## 验证与交接

- 先读本 Task、Tasker 合同、相关 frontend/server/contracts/typescript 与测试规则。
- 聚焦测试：同源首次双标签竞争、独立客户端、重开/清标识、存储故障；
  已验证主体隔离、auth-off 分区、重启后身份恢复且旧上下文失效、篡改/跨主体/释放/关闭并发。
- 浏览器 API 可用可注入 adapter 建立确定性测试，但不能用两个普通 Map 冒充真实 IndexedDB 事务。
  优先使用仓库已有真实 Chromium 测试设施或最小隔离宿主；若工具/运行证据不足，明确列待验，不写成验收通过。
- 查询 package.json 后运行 `bun run --cwd packages/neuro-book test <目标>`、主应用 typecheck、`git diff --check`。
  继续保持 t22 86 个聚焦用例绿色；原基线错误单列，新失败修复。
- 将实际接口、文件、命令、结果、未运行项和下一 HTTP adapter 接线依赖写到本 Task walkthrough。
  交接前读取并闭合 [Leader 实现中复核](walkthroughs/leader-progress-review.md)，以当前代码与回归测试为准。
  请保留时间写最终交接；期限不足时给可恢复的实际进展，不以 yield null 代替报告。
