---
schema: nbook.task/v2
taskId: t31-storage-file-boundary
---

# Storage 普通文件消费与资产同步边界

## 当前收口

### 最后 CLI 收口（优先于下方已完成补修）

三项补修及t33追加review已完成，报告保留。t33 followup 最后仍列 node parse / node validate --fix-missing 未guard：
这不是可延期项，Storage明确保留未知原件，不能假定永远没有index.md；普通CLI不得读取/修复它们。
本次只改 workspace-command.ts 与同名测试：

- 在统一 resolveSingleWorkspaceTarget 完成相对目标后先做read guard，使 parse/validate 的显式Storage输入同样拒绝；保留new/state更强的mutation guard。
- validate --recursive 从普通祖先开始时不能扫描Storage：复用现有 WorkspaceContentValidateOptions / WorkspaceScanOptions 的pathPredicate，把明确target的 isWorkspaceStoragePath 传到扫描层。先核实际类型签名，不给低层注入runtime，不复制整套遍历。
- 增加真实CLI回归：Storage内放含缺字段index.md的原件，显式parse --body与validate --fix-missing拒绝；从普通祖先recursive --fix-missing处理正常节点但原件字节不变。Project内部cwd也验证，普通notes/storage继续正常。
- 8分钟内只跑workspace-command相关测试并写 `walkthroughs/cli-final.md`；不重跑大集合、不改其它并行文件、不提交。新增需求均在原Storage独占边界内，无需用户决定。

### 2026-09-16 追加收口（当前 owner：omp Tasker）

主 Agent已取得真实输出：从主应用 cwd 运行 `bun run test server/workspace-files/workspace-storage-boundary.test.ts server/workspace-files/workspace-upload.test.ts server/workspace-files/project-workspace-path-policy.test.ts server/workspace-files/workspace-files.test.ts server/workspace-files/project-file-index.test.ts server/workspace-history/tracked-workspace-files.test.ts server/api/workspace-files --maxWorkers 1`，13 文件 131 用例通过，388.27 秒；随后主应用 `bun run typecheck` exit 0。
此次由新 omp 接管最后三项补修，后面的旧接管叙述仅为过程记录。先读 t33 的 `walkthroughs/review.md`，其列为残余风险的三项均属于本 Task 已授权边界，直接闭合：

1. `workspace-command.ts` 的 node new/state 路径在拥有明确 target 的边界接入同一 Storage guard；读/改均不得绕过。补生产 CLI 测试，不向低层通用文件能力注入全局 runtime。
2. workspace-root 单段路径只在实际含 Storage 时保护其祖先，不得屏蔽所有普通目录。只读准确子路径、保留 I/O 错误与链接规则，补普通目录 rename/delete 和同名上传 skip 回归。
3. 用户资产 ZIP 排除 `storage/**`，通过显式目标策略接线；完整 Project ZIP/完整 data 备份继续保留正式记录。本增量获准编辑 `workspace-archive.ts`、同名测试及 download 路由（取代下文旧排除），t32 owner 已停编辑。补真实解包断言；普通 `notes/storage` 仍保留。

不要重新跑耗时的大型 workspace-files.test.ts（以上旧改动已通过）；跑本次直接受影响的 guard、CLI、upload、archive、download 等聚焦集。新增文件若不在 vitest include 要确认实际执行。`project-identity.test.ts` 旧 alias 锁失败由主 Agent单列归因，不扩修。
完成后写 `walkthroughs/final-validation.md`，列真实命令/结果、改动与剩余项。约 15 分钟内交可审查增量，不 sleep 或再派代理。不改 t30、两个 descriptors、Work/Spec，不提交。

首轮 omp 已退出 0，但最后 sleep 被超时中断，walkthrough 未写最终结果；不能据此认定完成。
主 Agent 以 Tasker 接管 t31 的补修、真实聚焦验证与报告。t30 仍由另一 omp 独占。
需复核 `walkthroughs/leader-findings.md`，修真正的路径检查遗漏，核验根路径由下层已保护的事实；
不把只读 guard probe 夸大为实际可删除。首轮广泛测试中的 Project identity alias 锁失败需单列复现与归因。

Work：[w00003](../../README.md)；[计划](../../storage-implementation-plan.md)切片 2。
合同：[storage.persistence](../../../../../docs/specs/storage/persistence.md)「物理落点与文件消费」。
先读 [t28 后续文件取证](../t28-project-ready-publication/walkthroughs/leader-next-evidence.md) 的后续文件与备份部分。

## 结果

Storage 正式数据由 Storage 服务拥有；普通文件树、内容索引/事件、History 和通用文件修改不能消费或破坏它。
user-assets 下的 `storage/` 不作为内置资产安装、同步覆盖或旧 sync state 清理对象。
普通 `notes/storage` 仍可正常使用，Storage 目录不能变成所有同名目录的保留词。

## 并行边界

t30 正由另一 omp 修改 `server/storage`、`server/api/storage`、`shared/storage`、Project lifecycle/session/module 文件，
两边完全不交叉编辑。本 Task 独占路径策略、普通 Workspace 文件消费/HTTP、History、novel-workspace 资产同步与相关测试。
允许新增 `server/workspace-files` 内职责单一的路径保护 helper；不要编辑 t30 文件。
`vitest.config.ts` 本轮由 t30 使用，你只在报告列出需要登记的测试，主 Agent 收口时机械合并。
不修改 `workspace-archive.ts` 或 `server/backup`，归档将在后续增量落实；可以在纯路径策略中增加 archive preserve 分类，
但不能据此声称真实 ZIP/完整 data 备份通过。
两个 workbench descriptors 文件是用户既有 dirty，排除。不要改 Work/Spec 或他人 Task 文档。
不联网、再派代理、提交、push/PR/部署或操作真实用户 data；测试根使用测试支持包系统 Temp。
用户已授权计划内实现和测试，无需等待例行确认。

## 需要闭合的路径

1. 已有 `WorkspaceFileTarget` 区分 project-workspace、user-assets、workspace-root。
   用显式目标种类决定 `.nbook/storage`、`storage`、`.nbook/storage` 与 `<Project>/.nbook/storage` 的归属，
   不从绝对路径 basename 推断类型，不为普通低层文件能力引入运行期全局路径。
2. 通用编辑、新建/上传、改名、删除、文件转目录等 mutation 不能写 Storage，不能通过祖先改名/递归删除搬走它。
   从普通位置移入受管位置、从 workspace-root 上层进入 Project/user Storage 也必须保护。
   检查不能只在 UI 或树过滤；在拥有 target 的生产边界实际调用。HTTP typed 错误可解释，不变成任意 500。
3. 内部 symlink/junction 别名不能绕过保护。复用实际路径 containment helper，覆盖已有目标和缺失目标的最近已有父级；
   不做“捕获所有 I/O 错误当路径不存在”的 fail-open。Windows 大小写与斜线语义应一致。
   不扩大为任意进程/恶意本机文件竞争的沙箱，也不引入全目录扫描到每次读写。
4. Project file-index/history 复用统一 `projectWorkspacePathPolicy`；plain/user-assets 的扫描、搜索/事件同样排除真实 Storage 根。
   Storage 保存不生成内容事件或 History 记录。直接查询内部记录的普通文件读取/统计入口不得借树隐藏绕过身份隔离。
5. `novel-workspace.ts:isManagedAssetBlacklisted` 只控制源枚举还不足够：检查旧 sync state 和删除过期受管资产的清理路径。
   即使旧 manifest/state 声称 storage 文件受管，也保留磁盘记录，停止在 Storage 根产生安装、覆盖或删除。
6. `projectWorkspacePathPolicy` 可新增 Storage 正式与临时类别：正式记录/墓碑/原件在 archive 为 preserve，
   file-index/history 为 ignore；`.locks` 与本模块实际临时文件在 archive 也 ignore。
   从 record-codec/partition-lock 读取实际命名；quarantine 原件不是缓存。归档实际解包另做。

## 验证和交接

第一步写 `walkthroughs/implementation.md` 标进行中与基线 `0d66064b`，约 18 分钟内交可审查增量，边做边更新报告。
测试重点是生产入口与真实文件结果，不仅字符串谓词：

- user/project/workspace-root 的明确 Storage 路径与祖先 mutation 被拒，原始文件字节不变。
- 内部链接、目标不存在的移入、Windows 大小写路径；`notes/storage` 正常可读写。
- 文件树/索引/History 不出现 Storage，保存事件不进内容事件流。
- 旧 sync state 指向 Storage 时实际同步不会覆盖/删除；普通受管资产回归继续通过。
- 跑直接相关的聚焦测试；新增测试若未登记先显式测试配置/临时配置验证并在报告列出准确路径，勿偷偷跑零测试。
- 两个并行 Task 都稳定后由主 Agent统一 typecheck；你先记录真实已运行命令和剩余验证。

实现难点或剩余项写入报告，不空返回，不用 sleep 等待。主 Agent按代码和实际验证收取结果。
