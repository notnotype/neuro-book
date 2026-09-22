# 运行时合同独立审查（t02）第二轮：B/S 链路、阶段门禁与热停用

## 审查对象与基线

- 被审文件：`packages/neuro-book/docs/proposals/application-runtime-and-plugins.md`（status `reviewing`）。落盘基线为修订版 sha256 `30d5c133e24d4320c44eb9897df8cb64e9026e8e11f7efdd7c86ce7a7bb02415`，537 行；以下行号对应这份内容。首轮读取快照为 `8518ecab…`（535 行），本轮四项发现的锚点在该修订中逐字未变，仅整体后移 1 行（尾部章节另增 1 行），已按下表复核。
- 提案在主工作区未提交（`git status` 为 `??`），首轮报告记录的 331/342 行基线已被本轮新增章节取代，因此本报告一律以内容引用为准并给出当前行号；不重开已闭合的 F1–F3。
- 主工作区 `master`，HEAD `45906272`；提案自述调查基线 `45906272915ff43e83318653af62afa9ce668206`。引用 w00003 树 `.worktree/w00003-neurobook-ui-foundation-migration`（`refactor/w00003-nb-ui-adoption`）仅用于核对提案自述的现状锚点，该树代码不是本轮审查对象。
- 审查范围（本轮新增部分）：生命周期分层与阶段门禁（239–267）、候选模块与代码布局（269–296）、插件划分表与 File/SQLite 分层（298–354）、热卸载扩展边界（356–374）、B/S Tracer Bullet S0–S7 与 WorldEngine/Plotbench 接入（376–470）。D5 Lab 边界、文档治理与读者可理解性仍归 t03。

## 检查边界（只读记录）

已读并核对：`server/runtime/product-startup.ts`（mkdir → `inspectStateRootIntegrity` 40 → `stateRootIntegrityFailed` 44 → `assertProductMigrationsReady()` → `startAgentSessionStoreRuntime` → 租约失效有序退出）、`server/runtime/state-root-integrity.ts`、`server/runtime/product-migration-gate.ts`、`server/middleware/00-product-startup.ts`、`server/workspace-files/project-module.ts`、`project-database-module.ts`、`project-session.ts`（44/45 行副作用 import；169/196 行 ready 门禁）、`project-open-guard.ts`、`server/plot/index.ts`、`server/plot/facade/plot.facade.ts:789-810`、`server/world-engine/world-engine.facade.ts:261-282`、`server/agent/tools/agent-sql-project-module.ts`、`prisma/project.schema.prisma:378-414`、`server/workspace-history/project-history.ts`、`server/agent/tools/subject-rag-index.ts`、`server/config/config-service.ts`（5/80/147/350 行）、`server/agent/http.ts:48`、`server/agent/harness/model-resolver.ts`、`server/agent/harness/neuro-agent-harness.ts`（`toolOverrides` 静默跳过、5860/6099、8505）、`profile-sdk/contracts.ts:209`、`server/world-engine/schema-loader.ts`、`server/world-engine/calendar.ts`；w00003 的 `app/plugins/theme-colorway.client.ts`、`app/plugins/storage-migration.client.ts`、`app/pages/index.vue`、`app/components/workbench/WorkbenchShellLayout.vue`、`app/components/workbench/WorkbenchViewInstances.vue`、`server/storage/project-storage-module.ts`。

未执行：formatter、lint、build、测试、docs/governance 门禁、浏览器、真实模型、提交与远端写入。本报告是静态合同审查，不构成运行验证，也不代表提案 accepted 或授权实施。

## 修订锚点复核（revision 30d5c133）

| 发现 | 快照行（8518ecab） | 当前行（30d5c133） | 复核方式 |
|---|---|---|---|
| F1 配置断环段 | 426 | 427 | `Config 需切开真实的源码环` 逐字一致 |
| F1 插件表 `configuration` | 314 | 315 | 行文逐字一致 |
| F1 插件表 `agent-runtime` | 331 | 332 | 行文逐字一致 |
| F2 无插件时工具段 | 455 | 456 | 行文逐字一致 |
| F3 物理数据库资源 owner | 353 | 354 | 行文逐字一致 |
| F3 World/Plot SQLite 行 | 449 | 450 | 行文逐字一致 |
| F4 后端运行实例门禁行 | 214 | 215 | 行文逐字一致 |
| F4 S0 行 | 395 | 396 | 行文逐字一致 |

## 结论

未发现 P0。B/S 链按文档自身声明的边可以实现，**未发现"基础服务 → Project 内部必需资源 → 对外 ready"的等待环**：`宿主 → platform-files/sqlite → identity-access → project-directory/configuration/project-runtime`（304），Project 内部 required 工厂在 opening scope 内闭合（database←sqlite；history←sqlite/platform-files/配置核心；file-index←platform-files/history，431），`workspace-files` 只在 ready 后绑定且不参与 ready 等待（431）。四项待闭合，均为"按现状实现会走不通或与现状不符"的可逐条修正项：

- F1（P2）阶段门禁/配置断环只记录了 Project 环，漏记 configuration ↔ Agent 的双向边，S0 的 configuration 早启动按现状不成立。
- F2（P2）缺席协议把"缺工具给出 Profile 能力诊断并拒绝执行"写成现状，与源码静默跳过不符。
- F3（P3）同一 Project DB 的连接 owner 出现两个候选，多驱动连接的登记/关闭归属未落地（含 `agent-sql` 现状）。
- F4（P2）启动门禁枚举漏掉 State Root 完整性检查（影子 Workspace），它是现状中先于迁移的 fail-closed 门禁。

## F1（P2）阶段门禁漏记 configuration 与 Agent 的双向边，S0 的 configuration 早启动按现状不成立

位置：427 行；关联 315 / 332 / 396 行。

原文 427：`Config 需切开真实的源码环：目前 config-service → project-session → project-history → config-service。目标将配置合并/受限文件读取留在 configuration 核心（不依赖 Project），…`

问题：该句把"真实源码环"收窄为 Project 环，源码里同一模块还有第二条与 Project 无关的双向边：

- `server/config/config-service.ts:5` 静态 `import {useAgentHarness} from "nbook/server/agent/http"`，并在 147/175/223/263/298 行以默认参数取值 `profiles: AgentProfileCatalog = useAgentHarness().profiles`；`server/agent/http.ts:48` 的 `useAgentHarness()` 需要 ready Session Store 并构造 `NeuroAgentHarness`。
- 反方向：`server/agent/harness/model-resolver.ts:4/45/72` 静态读取 `loadGlobalEffectiveConfigSync()`；`server/agent/harness/neuro-agent-harness.ts:8505` 只能用 `await import("nbook/server/config/config-service")` 绕开静态环，正属 D1 禁止的"用惰性解析隐藏依赖环"。

影响：`configuration`（315）只声明 `identity-access、platform-files`，`agent-runtime`（332）不声明 `configuration`，两条边都不在声明图上；而 396 行 S0 要求"再初始化身份、configuration、project-directory、session-persistence 等必需服务"。按现状实现，configuration 一旦被 profile/模型设置路径消费就把整个 Agent Harness（含 Session Store 消费者）拉进启动必需闭包，声明图与实际闭包不一致；`runtime.services` 的"缺依赖、环"验收也看不到这条真实边。

违反场景：实现 S0 时按 315/332 建图 → 图合法 → 启动期 configuration 解析触发 harness 构造（要求 Session Store 已 ready 且会注册 profile watch）→ 启动闭包多出一个未声明的必需依赖，或与 S0 的就绪声明不符。

最小修正（427 行追加，并在表内补边）：

```text
另有一条与 Project 无关的双向边需一并切开：`config-service` 顶部 import `agent/http` 并以 `useAgentHarness().profiles` 作为 profile 设置默认值，而 `agent/harness/model-resolver` 与 Harness 又读取本模块（Harness 现用动态 import 绕开静态环，属 D1 禁止的隐藏环）。configuration 核心必须同时拆出 agent profile/模型设置（作为纯数据合同供 `agent-runtime` 消费），核心不得 import Agent 运行入口。
```

表内：`agent-runtime`（332）消费列补 `configuration`；`configuration`（315）的"不依赖"说明补"不依赖 Agent 运行入口/Harness"。

## F2（P2）"缺工具给出 Profile 能力诊断并拒绝执行"与现状不符，实际是静默跳过

位置：456 行。

原文：`**无插件时工具不能只是隐藏按钮：**… 现有 Profile 显式要求缺失工具时给出 Profile 能力诊断并拒绝该 Profile 的执行，不能偷偷缩减它的合同。`

问题：现状不是"诊断 + 拒绝"，而是静默跳过：`server/agent/harness/neuro-agent-harness.ts` 的 `toolOverrides()` 对每个 toolKey 取 `resolveProfileTool(profile, toolKey)`，取不到即 `continue`（无诊断、不拒绝执行）；`resolveProfileTool` 对无绑定/无宿主实现同样返回 `undefined`；`profile-sdk/contracts.ts:209` 的 `AgentProfileIssueCode` 没有"缺失工具/能力不可用"取值；`define-agent-profile.ts` 的校验只检查 profile 内部自洽（binding.key 一致、toolKeys ⊆ tools），不校验宿主是否提供该工具。唯一相邻错误是运行期 `Tool ${toolCall.name} not found`（5860/6099），即模型已调用工具后的失败，不是"拒绝该 Profile"。

影响：该句被用作"隐藏按钮不够"的论据，读者会以为门禁已存在（或已在既有 Harness 边界内有对应机制），实现时只做清单接线；实际结果是"缺工具 → 工具从模型可见集合中消失"，正是该句禁止的"偷偷缩减合同"。

最小修正（456 行改写）：

```text
目标要求：清单缺少某工具时，不向可选工具集合公布该工具；Profile 显式要求缺失工具时，工具目录给出能力诊断并拒绝该 Profile 的执行，不得静默缩减其工具合同。现状 `toolOverrides` 对无法解析的绑定直接跳过（`neuro-agent-harness.ts`），需在改造 agent-tool-catalog 时一并替换为显式诊断与拒绝。
```

## F3（P3）同一 Project DB 的连接 owner 有两个候选，多驱动连接的登记与关闭未落地

位置：450 行与 354 行。

原文 450：`物理数据库资源仍映射既有 .nbook/project.sqlite；sqlite owner 统一管理连接/迁移协调，领域关闭只释放自己的借用`。
原文 354：`既有共享 Project DB 保持一个物理数据库资源 owner，该 owner 可管理多个驱动连接；领域拿受限 repository/事务能力，不各自关闭别人的连接或另建一份数据库。`

问题：同一个"连接"的管理责任被同时交给两个不同 owner：`sqlite` 插件（450）与"物理数据库资源 owner"（354，即 Project 代次侧的 database 资源）；文档未给出二者关系，也未给出 D1 要求的登记机制（"临时资源必须立即登记到其 owner"）。现状是三方各自开连接、各自关闭：`project-database-module.ts` 明确"本handle不持有长生命周期数据库连接"，只发布 `databasePath`；`world-engine.facade.ts:261-282` 每次操作新建 libsql client 并当场关闭；`plot.facade.ts:789-810` 按路径缓存 Prisma client 至 facade 关闭；lazy `agent-sql`（`agent/tools/agent-sql-project-module.ts`）持有自己的 libsql client 并执行写 SQL，文档只在 423 行提到它的名字，未说明目标模型中的归属。

影响：`runtime.application` 与 SQLite/Storage 的 Spec 必须二选一。若按 450 把连接生命周期交给 `sqlite` 插件，Project 关闭时"先消费者后提供者"（131/134）无法成立（插件级 owner 不随 Project 代次结束）；若按 354 交给 Project 资源 owner，文档未说明领域连接如何登记，`agent-sql` 这类写连接可能落在关闭序列之外——正是热卸载段（356–374）自述要避免的"隐式 singleton/裸连接"。

最小修正（354 行句内明确一个 owner 与登记规则）：

```text
既有共享 Project DB 保持一个物理数据库资源 owner（Project 代次作用域）：该 owner 通过 `sqlite` 插件申请连接并登记本代次内的全部驱动连接，领域只借用受限 repository/事务能力并在代次关闭时统一归还；不各自关闭别人的连接或另建一份数据库。`agent-sql` 等现有写连接在迁移时改为从该 owner 借用。
```

## F4（P2）启动门禁枚举漏掉 State Root 完整性检查

位置：215 行与 396 行；关联 405 行。

原文 215：`迁移门禁、运行实例级必需租约与必需服务成功，才接纳业务；Session Store 租约由下表 session-persistence 持有`。
原文 396：`…校验静态清单；platform-files / sqlite 提供只读检查能力，先完成迁移门禁，再初始化身份、configuration、project-directory、session-persistence 等必需服务`。

问题：现状启动门禁是四项而非三项：`server/runtime/product-startup.ts` 在 `assertProductMigrationsReady()` 之前先执行 `inspectStateRootIntegrity()`（40）并以 `stateRootIntegrityFailed()`（44）中止启动；`state-root-integrity.ts` 的失败类型为 `ShadowWorkspaceIntegrity | StateRootInspectionError`，注释明确"只读取文件系统，不创建、复制、合并、删除或重命名用户数据"。提案全文未出现影子 Workspace/State Root 完整性门禁（检索"影子/完整性"仅命中 215/229 的租约排他说明，与门禁无关）。

影响：`runtime.application` 的验收与新启动适配器会按 215/396 的三项门禁实现；一旦迁移与租约通过而完整性检查失败（Installation Root 下存在分叉数据目录），弱化后的门禁可能接纳业务并在错误的根上工作，正是现状 fail-closed 要防的数据风险。

最小修正：

```text
215 改为：State Root 完整性检查（影子 Workspace / 检查错误即中止启动）、迁移门禁、运行实例级必需租约与必需服务成功，才接纳业务；…
396 的"先完成迁移门禁"改为"先完成 State Root 完整性检查与迁移门禁"。
```

## 已检查、未发现问题的部分（本轮）

- 依赖方向与无环：把 431 的内部工厂边与 304 的箭头方向合并重算，S0–S5 首条链为 DAG；`workspace-files` 对外入口不参与 ready 等待；opening 上下文读配置的方向与现状 `loadProjectModuleConfig({workspaceRoot, projectWorkspace})`（351 行注释"generation 尚未 ready"）一致，S3 断环方案可实现。
- 关闭与后台共享：D3 的"先消费者后提供者 / 超时不伪装 closed / 租约最后释放"与 354/450 的"领域关闭只释放自己的借用"、229 行的 `session-persistence` 归属一致，未发现提前释放排他租约或窗口退出关闭共享资源的允许项。
- World/Plot 拆入口：387 行"分离为两个领域入口与单向依赖，替换所有 HTTP/tool/UI 调用方"与现状（`server/plot/index.ts` 复合 lazy 模块、World/Plot 工具都经 `PROJECT_PLOT_WORLD_MODULE_TOKEN` 取服务）一致；"只装 Plot 不装 World 不成立"与 `PlotFacade` 注入 `world` 的真实依赖一致；454 行的工具路径（描述贡献 + 执行期按 Profile/目标代次过滤）与既有工具通道一致。
- 领域语义保留：458 行的空 schema、calendar 缺失报错、多驱动现状描述与源码一致；460 行 RAG 库归属与"不把 Agent Runtime 变成 World 基础查询前置"一致。
- 缺席与失败隔离：S4/S6 的"缺失贡献可诊断、不删领域数据"、468 行的失败反例（可选贡献失败不倒逼其它功能退出）与 D2.5 互相一致。
- 热停用协议：停用顺序、跨位置逐处确认、客户端失联不算 drained、重新启用新代次、基础必需插件要求重启——与 356–374 的难度表一致，本轮未发现内部矛盾（该协议已显式标注为未来候选，未按当前批次口径追改）。

## 未决取舍（提案已标注，不作为缺陷）

- A1–A3（必需服务插件化且首批不任意热卸载；关闭前 dirty/在途协商、窗口离开不关共享后台；Lab → Files → Settings 顺序）已由开发者确认（8–9、532–534 行），本轮不重开。
- 模块/插件粒度、候选代码布局、热卸载政策细节、World/Plot 是否拆成两个分发插件——文档已标注"尚待评审/转 Spec 前逐一确定"，本报告只指出上述四处缺边/缺口。

## 处理提示

- F1 的修正会改变 315/332 的依赖输入与 S0 就绪声明；F2/F3/F4 的修正文本可直接替换 456 / 354 / 215+396 的对应句子。
- 本轮未运行任何门禁，未修改提案、索引、产品代码或他人文件，无提交与远端操作；本报告不等于人类批准提案，也不授权实施。

## 定向复核与收口（revision #D4E0）

- 复核基线：提案修订版 sha256 `32ce39ea62810801893434d798df9d12b9ee906e41f4bcbcfcf81cf296f12270`，541 行。以下以该版本内容为准；前文按 `30d5c133`（537 行）记录的行号在该修订中会再位移，引用时以内容锚点为准。

### F1（配置断环）：闭合，附现状收窄更正

- 315 行 `configuration` 现声明"核心不依赖 Project ready 或 Agent/Harness 运行入口"，并新增有向边"Profile 设置适配另消费 agent-runtime 组内独立 Catalog 入口"；332 行 `agent-runtime` 明列 `configuration 核心` 依赖，且"Catalog 入口独立消费文件/编译与配置核心，不消费 Harness"；431 行明记双向边并给出处置：配置核心只保留纯定义/合并/受限文件读取，Profile 设置适配显式接收独立 Catalog 入口，Catalog 不得反向消费设置适配或构造 Harness。
- 现状判断按 Main 的指正收窄并已核实：`readConfigBootstrap`（`server/config/config-service.ts:192-215`）只走 `resolveConfigTarget`/`runConfigTargetOperation`/`readConfigFiles`/`resolveEffectiveConfig`/`buildConfigModelSettingsDto`/`listRawEnabledModels`/`resolveDefaultProfileKeyFromConfig`，**不触发** `useAgentHarness()` 默认参数；带 `profiles: AgentProfileCatalog = useAgentHarness().profiles` 默认值的入口是 `readConfigAgentProfileSettings`(145)、`readConfigAgentProfileBuildStatus`(174)、`saveGlobalConfig`(220)、`saveProjectConfig`(260)、`resetProjectProfileHome`(295)。前文"启动期 configuration 解析触发 Harness 构造"应更正为"上述 Profile 设置读写入口会隐式拉起 Harness"；S2 的 bootstrap 读取本身不受影响，此项不是启动链缺口，而是必须切开的隐式依赖。

### F2（缺工具诊断）：闭合

- 460 行现为"**无插件时工具不能只是隐藏按钮（目标要求）：**… Profile 显式要求缺失工具时，给出能力诊断并拒绝该 Profile 的执行，不能偷偷缩减合同。当前 `neuro-agent-harness.ts` 的 `toolOverrides()` 对解析不到的工具直接跳过，尚无本文要求的调用前拒绝机制；接入 agent-tool-catalog 时必须一并迁移，而非只改菜单。"——目标属性与现状静默跳过均已点名，前文"与现状不符"的表述不再适用。

### F3（Project DB 连接 owner）：闭合

- 354 行现为"目标由 **Project 代次作用域内的 database 资源 owner** 唯一管理 `.nbook/project.sqlite` 的物理资源和全部驱动连接，不由进程级 sqlite 插件另建生命周期 owner。该 owner 经 sqlite 创建连接，在交给消费者前登记可关闭句柄与未完成获取；World 的操作级 libsql、Plot 的长寿命 Prisma、`agent-sql` 写连接均从它借用。操作结束或领域关闭只归还借用，由 owner 决定及时关闭或复用；Project 关闭先拒绝新借用并收口消费者，再…"；454 行 SQLite 行同步为"Project 代次内唯一 database 资源 owner 经 sqlite 申请并登记全部连接、协调迁移；领域只归还自己的借用"。单 owner、登记时点（交给消费者前）、未完成获取与"消费者先收口/连接后关/失败保留占用"均已明确，涵盖 `agent-sql`。

### F4（State Root 完整性检查）：前提更正，闭合

- 更正：该检查**不是** fail-closed 门禁。已核实 `server/runtime/product-startup.ts:36-52`：`if (stateRootIntegrityFailed(stateIntegrity)) { void appLogger.warn("runtime.stateRoot.integrityFailed", …) }`，随后继续 `await assertProductMigrationsReady()`，该分支无 throw/return/exit；`state-root-integrity.ts:110-114` 注释为"判断完整性结果是否需要doctor失败或启动警告"，唯一调用点在 `product-startup.ts:44`。前文"fail-closed/中止启动"的表述作废。
- 384 行现状锚点、396 行 S0、407 行说明现已保留"State Root 只读完整性检查/告警"，并明确"目标保留只读检查与可见告警，不自动合并/删除数据，也不借架构重构把现有告警擅自升级为禁止启动；若要改变这一数据安全策略，需要单独取舍"。该处置与现状一致，不再要求新增拒绝行为。

### 收口

- F1–F4 全部闭合（F1/F3 属设计缺口，已按 315/332/431 与 354/454 修正；F2 已改写为"目标要求 + 点名 toolOverrides 跳过"；F4 已更正前提并保留现有检查/告警策略）。
- 本轮未运行门禁，未修改提案、索引、产品代码或他人文件，无提交与远端操作；本报告不等于人类批准提案，也不授权实施。
