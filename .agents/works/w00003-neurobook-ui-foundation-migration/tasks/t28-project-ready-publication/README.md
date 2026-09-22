---
schema: nbook.task/v2
taskId: t28-project-ready-publication
---

# Project 精确 ready 发布与 presence 配对

## 实现中复核（必须在交付前核对）

主 Agent 的 [leader-next-evidence](walkthroughs/leader-next-evidence.md) 已记录两个独立探针确认的前端问题：
open/presence 都缺 publicId 时 undefined===undefined 仍发布 ready；transport.open 同步抛错时误判 superseded 并留下 opening。
另外核对旧 V2 Service 对象的 HMR（它不懂 publicId，旧 acquireUserPresence 会忽略新增参数），以及 presence 在 Project terminal 后的关闭。
不要只用新版实例重复 import 来证明升级 HMR；最终报告需要明确这些项是否已修复、如何验证。

Work：[w00003](../../README.md)；当前[实施计划](../../storage-implementation-plan.md)切片 2 的第一个增量。
切片 1 已提交 `42d65b7c`，t27 追加独立复核建议合并；不能重新设计已落地的 user Storage。
先读 [Project 接线取证](../t26-storage-browser-adapter/walkthroughs/project-next-evidence.md)。
行为依据 [storage.persistence](../../../../../docs/specs/storage/persistence.md) 的精确 Project 代次与
[storage.boundaries](../../../../../docs/specs/storage/boundaries.md) 的 open/presence 匹配。

## 结果

浏览器 open 得到服务端精确 ready 的公开标识，presence 必须接到并回报同一个标识，
只有两者匹配才发布前端 ready。Project 关闭重开、同路径新建或换服务端运行期后，旧标识都不能接到新实例。
后续 Project Storage 可以用这个标识取得原 ready 对象，不需要再按路径寻找当前 generation。

## 范围与分工

追加 omp 已退出（exit 1，没有 server-followup 报告或验证闭合）。主 Agent 现在以 Tasker 接管剩余 server/shared 修复及统一验证，
结束并行编辑。独立 Reviewer 会在源码稳定后重新审查。
HMR 连续验证定位到 `sqlite-handle-release.ts` 的存量重载失效：进程 GC 标记保留、模块 collector 缓存丢失。
本 Task 追加该 owning helper 的最小修复与直接回归，避免用延长目录删除超时掩盖真实 native 句柄清理问题。

首轮 omp 已退出。追加修复分工：主 Agent 切换 Tasker，独占 `app/composables/useProjectSession.ts` 与同名测试，
修运行期响应校验及同步抛错；追加 omp Tasker 独占 server/shared 与对应测试，修旧 V2 实例 HMR 和 presence terminal。
双方不得交叉编辑；omp 将结果追加到 `walkthroughs/server-followup.md`，不覆盖主 Agent 文档。
主 Agent 同时补登记 Vitest 遗漏的两份相关路由测试；该配置由主 Agent 独占。
omp 本轮必须先读 `walkthroughs/leader-next-evidence.md`，不能把首轮自述当闭合证据。
允许修改 `server/workspace-files/project-session*`、必要的精确 ready 入口、`server/api/projects` 的 open/presence/校验入口、
`shared/dto/project.dto.ts` 或合理的 shared Project 会话合同、`app/composables/useProjectSession*` 与受影响的直接调用方/测试。
可追加实现入口文档与本 Task walkthrough；必要脚本 fixture 同步 DTO。
不要改两个既有 dirty descriptors 文件，它们不属于本 Task。不要修改 Work/Task 身份。

本轮不接 Storage Project 值动作、lazy Storage module、文件/备份策略、UI 布局、迁移、标题栏或命令系统。
这些只在当前结果闭合后继续拆。不能让领域 Project 打开依赖 IndexedDB 或客户端 Storage 凭证可用性。
不联网、再派代理、提交/push/PR/部署，不操作真实用户 data。隔离测试根使用测试支持包系统 Temp。
用户已授权整个计划的实现与本地验证，本轮无需等待用户批准例行实现细节。

## 设计约束

1. 标识属于已有 ProjectSession owner，唯一对应其捕获的精确 ready 对象与运行期。
   服务端查出后仍传播该对象；禁止仅把 projectRoot 再查成当前 generation，或把前端 revision 当服务端代次。
   不新增无界的全局当前项目或与 Project 生命周期脱离的永久 Map。
2. 标识是代次定位信息，不替代用户鉴权/Storage 主体与客户端核验，不公开绝对路径、物理 root identity 或锁信息。
   新 runtime 即使 generation 数字从 1 开始也不能认旧标识；HMR 策略必须明确保留同一 owner 或安全失效。
3. open HTTP 发布追加这个标识，同时保留现有 Project publication 和 manifest 修复提示。
   presence 请求带预期标识，服务端精确取得该代次的 presence；旧 open 到新 presence 之间的 close/reopen 必须拒绝。
   前端在 presence_ready 同时检查 root 和标识，再发布 ready，ready 包含该标识供后续消费者使用。
   本地 revision 可保留，但注释明确其仅是 UI 发布计数。
4. 保留 latest-wins、取消、single-flight、断线重连、send-before-push 和 release 只释放本标签 presence 的语义。
   旧 presence 迟到 release 不扣新代次；终止/根替换后不发布仍可消费的 ready。
   SSR 不得伪造一份可写 ready 标识。所有受影响 fixture/调用方在同一增量完成切换，不留静默降级到路径的兼容入口。
5. 新能力应便于下一增量以精确 ready 调用 `activateReadyProjectModule` 与 `runReadyProjectOperation`；
   不提前激活所有 Storage 记录或提高 required ready 门禁。

## 验证与交接

先创建 `walkthroughs/implementation.md` 写进行中、基线和关键接口选择，随后边做边追加，不把报告留到最后。
请在前 4 分钟形成接口和最小测试，在预算内优先交付一个可核对的完整增量。

- 确定性覆盖 open A→A close/reopen→旧标识 presence 拒绝；新标识成功且只影响对应 presence。
- 同路径新建、不同 runtime 同 generation 数字、另一个 Project、根替换与 terminal gate，均不能把旧标识解析成新 ready。
- 浏览器控制器覆盖 root 相同标识不同、旧请求迟到、release、EOF/reconnect、manifest 恢复提示不丢失。
- 保留至少一个真实 H3 open/presence 合同验证，不能只有手写相同字符串的前端桩。
- 跑相关 ProjectSession、DTO、HTTP 与控制器聚焦测试、主应用 typecheck；不跑无关业务全集。
- 最后记录具体变动、实际命令/结果、未验证项与需要 Leader 接续的问题。退出 0 或空 final 不等于完成。

全局 `scripts:typecheck` 既有单个错误在 `scripts/deploy/product-agent-state-root-smoke.ts:318` 缺主题字段，
不扩大修复、不掩盖本轮 DTO 引起的新错误。
