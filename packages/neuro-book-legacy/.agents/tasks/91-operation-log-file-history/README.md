# 操作日志系统 / 文件历史（Operation Log & File History）

> 2026-07-31 CLI 路径取代说明：本任务关于 `workspace node` 绕过 server、由 watcher 归因 `external` 的行为判断仍有效，但实现不再位于 `assets/workspace/.nbook/agent/scripts/workspace.ts`。当前稳定入口为 `.nbook/agent/bin/workspace`，发行物经 Task 130 的 Product Runtime Contract 调用 Product-owned Workspace CLI；历史路径仅作证据。

## Relative documents refs

- [GOAL.md](GOAL.md)：**派发给实现 agent 的自包含任务书**（独立模块 `nb-history` spike：完整数据模型、API、语义规则 R1–R13、验收 T1–T12）。
- [reference/workspace/TERMS.md](../../../reference/workspace/TERMS.md)：Project Workspace / Workspace Root 术语。
- [Task 87 Plot 两棵树](../87-plot-two-trees-and-writer-modes/README.md)：本任务的需求源头（先写后补模式讨论）。
- [Task 86 Pi Request Observability](../86-pi-request-observability/README.md)：隐私红线先例（traces 含正文，禁入可分享日志包）。
- [Task 72 Error Report Logs](../72-error-report-logs/README.md)：可分享日志包——本任务的 history.sqlite 必须被排除在外。
- [Task 21 Project Workspace Index Watcher](../21-project-workspace-index-watcher/README.md)：集成期喂 `reconcile` 的 watcher 基础。
- [Task 20 Shared Diff Workbench](../20-shared-diff-workbench/README.md)：集成期收件箱 / 时间线 UI 可复用的 Monaco diff 面。

## User Request / Topic

需求经历三级演化，每级都是用户显式升级：

1. **起点：「先写后补」模式**——现有工作流都是设定先行（World Engine + Plot → 正文），用户想要"先写正文、后补设定"的模式（也为将来整书导入铺路）。
2. **第一次收敛：人机变更互知**——讨论中用户砍掉了我提出的 Plot 同步水位线状态机（"不要这么复杂"）：核心问题只是**人需要知道 agent 改了什么文件，agent 也需要知道人改了什么文件**；Plot / World Engine 与正文的语义同步交给 Agent 自己处理（提示词 / skill 层），机制层不做。
3. **第二次升级：操作日志系统一次做到位**——用户把功能定位提升为完整的操作日志系统：记录所有主体（n 用户、n 会话、外部操作）的操作、可回溯、将来可扩展到 UI 状态 / 设置等日志；v1 只做文件；要有 IDEA Local History 式的单文件历史，误删文件也能找回；并明确问了"要不要用 git"。

最终派发指令：不直接改 NeuroBook，**模块化 + spike 先行**验证可行性，之后 NeuroBook 集成该模块；由本任务产出 goal 文档派发给其他 agent 实现，代码不由本会话实现。

## Goal

产出一份定稿设计 + 自包含派发任务书（GOAL.md），让一个零上下文的实现 agent 能独立建成 `nb-history` 模块并以场景测试 T1–T12 + 性能 smoke + Windows 句柄实测自证；NeuroBook 侧本轮**零代码变更**。spike 通过后再单列 NeuroBook 集成任务。

## Current State

- 设计全部定稿（决策 D1–D12，见下表），无遗留开放问题。
- **spike 已实现并通过验收**：sibling 仓 `../nb-history`（`@notnotype/nb-history`，bun + TS strict + @libsql/client 手写 SQL，零 NeuroBook 依赖，已 `git init` 未 commit）。GOAL 的场景验收 T1–T12 全绿（**31 tests**，多轮连跑 0 fail，含审查轮新增 2 个回归）、`tsc --noEmit` 全绿、性能 smoke P1–P3 达标（一处最坏情况偏差如实记录，见 Verification）、`bun run demo` 四段走查（时间线→收件箱 accept/revert→多会话互知→误删找回）输出可读。已完成一轮**审查/优化/结构收拾**（时间线出生边界 bug、读写分离双连接、N+1 与全表扫描消除，见 Implementation Walkthrough）。
- NeuroBook 代码零变更。

## Decisions / Discussion

| # | 决策 |
|---|---|
| D1 | **机制与语义分层**：机制层只记录"谁在何时把哪个文件从什么改成什么"；Plot / World Engine 与正文的语义同步（何时补设定、补哪些）交给 Agent 的提示词 / skill 层。「先写后补」最终只是 leader profile 里的一段 instruction，无额外机制。 |
| D2 | **不用 git**。JetBrains Local History / VS Code Timeline 先例都是自建存储；git 只能替快照层，归因 / 游标 / 接受位点仍需 SQLite → 双存储一致性问题；Portable 用户无系统 git；isomorphic-git 依赖重且无内置文本 diff。留后门：将来可做单向 git 导出器。 |
| D3 | **事件溯源**：append-only `OperationLog` 信封 + `file.*` 判别联合 + 内容寻址 `FileSnapshot`（sha256 去重）；一份日志投影四个视图——单文件时间线、删除找回、用户收件箱、会话未见变更。 |
| D4 | **OperationActor 四类**：`user(userId)` / `agent(sessionId)` / `system(source)` / `external`。system 现在就要——模板同步、bootstrap 回写等平台写入若无此类，watcher 会把它们误归因为 external。 |
| D5 | **revert 与 restore 是两个一等事件**：`file.revert`（收件箱撤销 agent 修改，带 `revertedEntryIds`）/ `file.restore`（恢复任意历史版本 / 删除找回，带 `sourceEntryId`）。两者都走提醒通道——agent 能得知用户拒绝了它的修改（用户点名要求）。 |
| D6 | **会话感知 = 每 session 标量游标**（`last_seen_entry_id`）：unseen = `id > 游标` 且非本会话；每 path 的 diff 基准 = 第一条未见条目的 before 态，数学上恰好等于"该会话最后见过的状态"——结构性解决「重开老会话要补课」。**用户审查 = 每 (userId, path) 接受位点**，天然支持 n 用户 × n 会话（当前按 1×n 使用）。 |
| D7 | **提醒注入分层**（集成期，不在 spike 内）：机制在 harness——回合开始批量注入 + 回合中每次工具调用后检查（Claude Code 风格），注入与游标推进原子；策略在 profile——`fileChangeAwareness: off / minimal / full (+instruction)`，未声明默认 minimal，leader.default 用 full + 先写后补 instruction，inline editor 用 off。 |
| D8 | **独立 `.nbook/history.sqlite`**，不并入 project.sqlite（主库保持小、GC / VACUUM 隔离、损坏隔离）。**隐私红线：内含全文快照，严禁进入 task 72 可分享日志包与任何导出诊断流程**（同 Task 86 traces 规则）。 |
| D9 | **保留策略分层稀疏**：默认 90 天全量 → 之后每文件每日末版；快照引用计数 GC；未接受收件箱段 / 活跃游标之后 / 每 path 末条永不删。**参数必须配置文件可配**（用户点名）。 |
| D10 | **v1 边界**：只做文件操作（信封为 settings / UI 操作留位）；文本快照上限 ~2MB，二进制只记事件不存快照；范围 = Project Workspace 内容文件（`.nbook/` 排除；Workspace Root 层将来同 schema 扩展）；rename 一等事件、时间线跟随 rename 链。 |
| D11 | **写入路径收口**（集成期）：宿主写入统一走带 actor 的 recorded 写服务；watcher 兜底把未登记变更归因 external（对账按 hash 去回声）。write 工具补 hash-since-read 新鲜度检查（edit 工具的 exact-match 预检已天然半防护）。 |
| D12 | **落地路线（用户最终指令）**：不直接改 NeuroBook——独立模块 `nb-history`（bun + TS + @libsql/client 手写 SQL，零 NeuroBook import）spike 先行，GOAL.md 派发给其他 agent 实现；验证通过后 NeuroBook 再集成。 |

**被否决的中间方案**（防回潮）：
- Plot-sync 水位线四态状态机——过度设计，核心只是文件变更互知；
- `UNIQUE(path, audience)` 的 pending 账本——被多会话需求击穿（不同会话需要不同 diff 基准），换成事件日志 + 快照 + 每会话游标；
- 只记"变了"不记内容（只能看到变化、看不到 diff）——被用户升级为完整日志系统时否决。

## Verification / Test

- spike 按 [GOAL.md](GOAL.md) 验收标准执行，结果：
  - **T1–T12 全绿**（`../nb-history` 下 `bun test`，31 tests，多轮全套件连跑 0 fail）：时间线 + rename 链（含历代同名不混入、rename 环）、删除找回、收件箱交错编辑归因、revert 全链（agent 会话经 unseen 收到被拒通知）、多会话重开（T6 场景逐字复现）、对账回声抑制、崩溃模拟自愈、超限/二进制降级、保留策略三条保护规则、Windows 句柄双测。
  - **性能实测**（Windows 11 + bun 1.3.14）：P1 单次 30KB 写入 8.5–12ms（线 20ms）；P2 unseen(5000 条积压) best 18–35ms、inbox 代表性状态(已审 90/100) best ≈ 11ms、timeline ≈ 1ms（线均 50ms）；P3 单文件 100 版 × 30KB = 3.00MB（原文 2.86MB，开销 ~5%，内容寻址去重生效）。
  - **【偏差·如实上报】** inbox 最坏情况（用户零接受、全库 1 万条扫描）best 32–67ms 随机器负载浮动，不稳达 GOAL 的 50ms 线——断言按代表性状态（接受随写作推进），最坏情况以报告项每轮打印；结构性修复（增量分组/分页）超出 spike 边界，缓解 = 宿主 auto-accept 策略。详见 `../nb-history/NOTES.md` 第 12 条。
  - **T12 句柄结论（spike 核心问题之一）**：裸 `client.close()` 后库文件在 bun/Windows 上**不可删**（EBUSY，重试不解）；`close()` 后**强制 GC + 1~2 个事件循环拍**即释放（实测 ≈100ms）——模块 `close()` 已内建 8 拍 GC 协助（~200ms 预算），「close 后直删库文件」严格测试稳定通过；对照组 `bun:sqlite` close 即释放零等待。按 GOAL 未擅自换驱动，证据留给集成决策。
- 本仓（NeuroBook）零代码变更，无需回归。

## Implementation Walkthrough

- 设计轮产出：`GOAL.md`（派发任务书）+ 本 walkthrough + PROJECT-STATUS 任务行。
- 设计讨论中核实过的 NeuroBook 侧支撑事实（集成期直接可用）：`diff@^8.0.3` 已在 package.json；Monaco diff UI 已有（Task 20/89）；`WorkspaceFileNode` 已含 `mtimeMs` / frontmatter（watcher 与 summary 约定在）；agent 写入层 `apply-patch.ts` 在内存中同时持有 original / updated——天然的 registerWrite 挂点；编辑器写入口 `writeWorkspaceTextFile` 是另一个收口点。
- **spike 实现轮**（`../nb-history`，里程碑 M1–M7 一次通过）：
  - 结构：`src/types.ts`（判别联合契约 + before/after 态函数）、`rows.ts`（行↔类型双向映射，非法行抛错）、`db.ts`（四表 DDL + WAL + 部分索引）、`views.ts`（rename 链回溯时间线 / 名字末态分类 / 现名归组）、`prune.ts`（三保护规则 + 按日稀疏 + 快照引用计数 GC）、`workspace-history.ts`（主类：写入面/还原面/对账/查询/维护 + 写互斥）；`tests/` 9 文件 29 用例；`scripts/demo.ts` + `handle-probe.ts`。
  - 实现关键决定（全录于 `../nb-history/NOTES.md`，13 条）：**写路径内建对账**（所有写入口记账前比对磁盘与账面末态，不一致自动补 external 条目 → beforeHash 链恒精确，崩溃丢账下次写入即自愈，R9/R10 的推广）；revert 基线取「位点后第一条的 before 态」（与位点条目 after 态恒等且免疫其被稀疏）；rename 的 contentHash 同写 before/after 两列统一末态查询；`unseenChanges` 对未初始化游标抛错（防漏接 initCursor 的洪水注入）；textDiff 的 binary 理由靠 `byte_size ≤ 上限却无 body` 推断。
  - 测试炸出并修复 1 个真 bug：prune 的「当日末条」最初按剔除保护后的候选集计算，当日真末条恰好被保护时会多保一条次末条——改为按全体窗口外条目先算日末条集合再删。
  - 性能整改三轮：acceptance 每组一查 → 每用户一次预取；rename 扫描加部分索引；**接受位点 SQL 预过滤**（LEFT JOIN，rename 迁移语义在 JS 精确重算，预过滤只多含不漏）→ inbox 代表性状态 8–11ms，扫描量随审查进度收敛。
- **审查轮（同日第二轮：审查 / 优化增强 / 结构收拾，`../nb-history/NOTES.md` 发现 14）**：
  - **【bug·已修】时间线出生边界**：原来只把 rename 当分段边界——旧文件改名占用过的名字死亡后被**全新 create** 同名复用时，回溯会把旧化身错误缝进新文件时间线。修：rename 与 create 都是「出生」，create 终止回溯（delete→restore 延续语义保持）。补 2 个回归测试（历代同名分界、a→b→a 改名环）。
  - **【一致性】读写分离双连接**：原查询与写共用连接且不带事务，多 SELECT 视图可能被中途提交撕裂（单连接包读事务又会与写事务嵌套 BEGIN 互撞）。改为 WAL 标准形态：独立读连接 + 读互斥 + `transaction("read")` 快照。
  - **【性能】** `deletedFiles` N+1 → 批量 IN；`revert`/`accept` 全账本扫描 → 按历史名字定向查询；接受位点语义三处重复 → 统一纯函数 `acceptancePositionFor`；`close()` 幂等 + 排空队列；P1 断言改中位数（负载尖刺鲁棒）。整改后 31 tests 六轮连跑 0 fail（一次负载瞬态失败未复现）。

## TODO / Follow-ups

- **[已完成 2026-07-07]** `GOAL.md` 派发 + `nb-history` spike 建成并验收（T6 多会话、T10 保留策略、T12 Windows 句柄、P3 体积报告全部复核通过）。
- **[spike 通过后·单列集成任务 → 已建 [Task 95](../95-nb-history-integration/README.md)]** NeuroBook 集成：写入面收口（`writeWorkspaceTextFile` / `apply-patch` / bootstrap `writeProsePointers` 等全部写入点接 recorded 写服务）；`ProjectWorkspaceIndex` watcher 喂 `reconcile`；harness 提醒注入机制 + profile `fileChangeAwareness` 策略（D7）；retention 参数接配置系统（D9）；收件箱 / 时间线 / 删除找回 UI（复用 Monaco diff）；task 72 日志包排除清单加 `history.sqlite`；session 生命周期接 `initCursor` / `advanceCursor`。
- **[集成前置·2026-07-07 可行性分析核实]（挂点全部存在且形状吻合，无架构性障碍）**：
  1. **watcher 必须先排除 `.nbook/`**：`project-workspace-index.ts` 的 `isIgnoredWorkspaceWatchPath` 目前只滤 `.git`——不排除的话 history.sqlite 每次写入（含 advanceCursor 高频小写）都会触发 watcher 事件 → 防抖全量索引重建；且 project.sqlite 也在 `.nbook/` 下，这个抖动今天就存在，排除是独立受益修复。
  2. **`workspace node` CLI 是归因盲区**：CLI（Bundled Template `assets/workspace/.nbook/agent/scripts/workspace.ts`，经 `.nbook/agent/bin` 注入 bash PATH）是独立 bun 进程直接 `fs.writeFile`，完全绕过 server——agent 经 bash 跑 CLI 的写入只能靠 watcher → reconcile 归因 `external`，且会出现在该 agent 自己的 unseen 里（回声噪音）。v1 建议接受现状；红线：**CLI 永远不要自己打开 history.sqlite**（R11 单进程单写者）。
  3. **生命周期挂点（2026-07-09 更新：Task 94 已升级为显式模型并落地）**：原 Task 92 隐式注册表 `project-resources.ts` 已被 [Task 94](../94-project-lifecycle-model/README.md) 演进更名为 `server/workspace-files/project-session.ts`（显式 ProjectSession：open 预热 / presence 在场 / close 级联释放，旧文件已删）。集成挂点相应变为：`WorkspaceHistory` 作为**会话资源**在 `openProject()` 预热开库、session close 时 `history.close()`——Task 94 D7/D11 已把「history 双连接」列入会话资源与 open 预热清单，Task 95 D13 已吸收。
  4. 其余挂点核实：agent 工具 `ToolExecutionContext.sessionId` 可归因；`apply-patch.ts` 内存持有 original/updated；提醒注入照抄 `prepare-next-turn.ts` 的 report_result reminder 形状；profile settings 加 `fileChangeAwareness` 枚举顺手（Task 87 contextMode 先例）；retention 参数进 `CONFIG_REGISTRY`（global-workspace scope）；task 72 日志包是白名单制（只收 `logs/`），history.sqlite 物理隔离天然排除。
- **[集成期决策点]（spike 证据已备,见 `../nb-history/NOTES.md`）**：
  1. **驱动——建议定案留 `@libsql/client`**：宿主已全线 libsql（App 库 Prisma adapter-libsql + project.sqlite 直连），`bun:sqlite` 只在 seed/smoke 脚本；部署矩阵中 Docker 形态可能跑 node（`bun:sqlite` 不存在），换驱动反而制造运行时锁定。句柄惯性只影响"运行中删库文件"与 dev 重启，模块 close() 已内建 GC 协助且非 bun 运行时有守卫降级。
  2. **auto-accept 策略**：未接受收件箱段永不 prune + 零接受时 inbox 退化全扫（1 万条 best 32–67ms，超 50ms 线的已知偏差）——宿主需要「N 天未审自动接受」类兜底，两个问题同源同解。
  3. **写入节流**：快照无 delta 压缩（100 版 × 30KB ≈ 3MB），编辑器自动保存应在调用侧节流合并；前端实际保存频率集成时确认。
  4. **userId**：宿主有 auth 体系但 agent 链路无 userId 流转——v1 用固定 `"local"`（或登录用户 id），模块天然 n 用户，以后升级零迁移。
- **[集成后]** 先写后补 = leader.default instruction + 回补设定 skill；整书导入依赖此机制（PROJECT-STATUS Known Follow-ups 已记 TODO）。
- `StoryScene.threadId` 可空化决策仍挂起（回补流实现时再定，见 Task 87）。
