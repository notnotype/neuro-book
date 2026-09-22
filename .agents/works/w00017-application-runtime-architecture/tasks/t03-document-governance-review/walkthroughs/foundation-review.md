# 文档治理与读者审查（第三轮：两片规范、实施路径与 Task 合同）

审查对象：w00017 本轮纯文档交付——[Work README](../../../README.md)、[implementation-plan.md](../../../implementation-plan.md)、[t04](../../t04-foundation-spec-plan/README.md)/[t05](../../t05-runtime-lifecycle/README.md) 任务合同、根 [Proposal 索引](../../../../../../docs/proposals/README.md) 与 [Spec 注册表](../../../../../../docs/specs/README.md) 的本轮改动、[总体提案](../../../../../../packages/neuro-book/docs/proposals/application-runtime-and-plugins.md) 的状态/能力地图/推进/决策节，以及七项新 `planned` Spec（`runtime.lifecycle`、`runtime.services`、`runtime.plugins`、`runtime.application`、`runtime.diagnostics`、`platform.files`、`platform.sqlite`）。目标读者是不读全部源码但要理解并执行分段计划的维护者。只写本报告，未编辑任何被审文件。

## 一、读取基线

- 主工作区 `master`，HEAD `45906272915ff43e83318653af62afa9ce668206`；本 Work 全部文档与七项 Spec 均未提交（`?? .agents/works/w00017-application-runtime-architecture/`、`?? docs/specs/runtime/`、`?? docs/specs/platform/`、`?? packages/neuro-book/docs/proposals/application-runtime-and-plugins.md`；两处索引为 modified）。
- 读取时指纹（sha256 前 16 位）：lifecycle `2a7beea2f4904f35`、services `a6810a5d774f9e0a`、plugins `170ab74a4492e683`、application `9768b9e7dc80327c`、diagnostics `1265cc16fc3700a6`、files `0f19073a5efb4941`、sqlite `432e2f78e7bc8d13`；提案 `cdcd7de505e9e006`；Work README `1e749e9d60d48653`；implementation-plan `3855ad761480d885`；t04 `099edfe256e96d82`；t05 `eaa739a41c8ab8ae`；Spec 注册表 `c173171ad4237550`；Proposal 索引 `232677f24ab77d4c`。
- 审查期间 Main 在并发集成（t02 的边界精度项已落进 diagnostics/files/sqlite/plugins 与实施路径）。上述指纹是行号基线；若正文再改，以引文定位，不重跑行号。

## 二、结论

未发现阻断本轮文档交付或阻断批准的问题。切片顺序与用户要求一致，首片/第二片闭包可运行且不以 mock 冒充，未来命令与现有命令区分清楚，t05 可执行且不会误晋升其它 Spec，"等 w00003 合并 master 再创建 worktree" 全链一致、无自动远端授权。三项 P3 级精度项（跨 Work 归属、状态表闭合、批准依据措辞）建议随集成修正，均不改变本轮交付边界或 `planned` 登记。

## 三、发现

### 1.（P3，建议集成时修正）Lab 边界切片未登记命令/Lab 面板基线的实际归属与交接

- 位置：`implementation-plan.md:109、111`；提案 `:48、:162`；对照 `.agents/works/w00016-workbench-commands/README.md:23–24、:38`。
- 原文：plan 111"…撤全局registry/palette/confirmation/命令tab；命令fixture创建并释放局部host…"；plan 109"入口条件：前两片真实验证已完成，且w00003组件/命令/Storage基线已在当前实现checkout"；提案 48 意义列"展示 Lab 意外承担产品能力装配；新目标需要明确替代这条合同"。
- 问题：被撤回的常驻命令宿主、`WorkbenchCommandPalette` 与右栏只读"命令"tab，是并行 Work w00016（i192「命令底座与 Lab 闭环」）的交付边界 5/6 与 Task 验收对象：该批直接改写 `docs/specs/workbench/commands.md`、`quick-open.md` 与 `ui.component-lab`（四→五 tab），实现落在 w00003 树（本轮已核实 `LabShell.vue` 有 `provideWorkbenchCommands`/`WorkbenchCommandPalette`）。w00017 当前文档把这些统一记为"w00003 未提交工作"，未记录 w00016 是 owner，也未记录该切片执行前需与之交接（谁的 Spec/Task 随之原位收窄、由谁确认这不是回退已验收能力）；同时 Lab 切片的入口条件只点名 w00003 基线，若 w00016 批次未随该树一并合入，"命令基线已就绪"的前提会落空。
- 影响：跨 Work 协同与基线核对缺项。执行者按字面会把它当作无主遗留直接撤除，或与 w00016 的验收发生无记录冲突。不阻断本轮文档交付。
- 最小修正：在 plan 109 的入口条件补归属与交接一句（命令/Lab 面板基线由并行的 w00016 批次在同一树交付；撤回其全局宿主前先在该 Work 记录交接与 `workbench.commands`/`workbench.quick-open`/`ui.component-lab` 的原位收窄），并把提案 48"意外承担"改为"当前由该批次引入、按 A3 需明确替代"。

### 2.（P3）plugins 激活状态表："收口中"无出边，且"失败并收口"与"失败"两名一态

- 位置：`docs/specs/runtime/plugins.md:65、66、69`。
- 原文：66"| 激活中 | 入口owner取消或作用域关闭 | 收口中 | 迟到的成功不发布；已登记资源收口。单个等待方取消不触发此转换，其它等待方继续共享激活 |"；65"| 激活中 | 任一步失败 | 失败并收口 |…"；69"| 失败 | 上次失败资源收口完成后显式恢复 | 激活中 |…"。
- 问题："收口中"只作为转入目标出现，没有出边，也没有说明它与"停止中/已关闭"的关系（生命周期关闭门禁满足时该激活落到哪个状态）；同一状态在转入侧叫"失败并收口"（提案 238/254 行也用该名），当前态列又写"失败"。实现者写状态机与该单元的转换验收时只能自行选择，plugins 单元与后续集成可能各自解读。
- 最小修正：统一失败态名称（沿用"失败并收口"或统一为"失败"），并为"收口中"补一条出边，或注明"收口中属于所属作用域停止中的内部收口阶段，结算归 `runtime.lifecycle`"。

### 3.（P3）三份首片 Spec 的批准依据引用了提案中不存在的接受对象

- 位置：`docs/specs/runtime/lifecycle.md:138`、`services.md:128`、`plugins.md:131`（对照提案 `:215、:541–544`）。
- 原文（三处同句）："…2026-09-20 开发者接受 D1–D4 基础方向与生命周期矩阵（不含热卸载扩展），并明确要求把第一实现切片（环境适配入口与小内核）与第二切片（以内置服务插件检验底座）沉淀为 Spec。"
- 对照：提案 541 行把 D1–D5 记为"先前推荐…仅下列明确接受项已获批准"，其后只列 A1–A3（542–544）；215 行称"下表为 D1–D4 的推荐合同"；提案可核对的接受表述是 9 行"本轮接受与授权"、245 行"基础机制已获准沉淀目标 Spec"、7 行"已确认方向"（含"生命周期按运行位置与资源作用域设计"）。
- 问题：三处批准来源指向提案里不存在的"接受 D1–D4/生命周期矩阵"，而同批的 diagnostics/files/sqlite/application 用的是可核对措辞（"明确接受总体推进方向…并要求把两片沉淀为 `planned` Spec"）。按 t04 验收 1"真实批准来源"审计时会读到"接受 D1–D4/矩阵"与"仅 A1–A3 已批准"并存。这不影响 `planned` 成立（提案 9/245 行的授权足够沉淀目标 Spec），只是来源描述需一致。
- 最小修正：三处替换为与 diagnostics/files/sqlite 相同的措辞，或写"接受基础架构与分段推进方向；D1–D4 基础机制已获准沉淀目标 Spec（决策记录仅把 A1–A3 列为明确接受项）"。

## 四、按本轮分配清单的逐项结论

| 检查项 | 结论 | 依据 |
|---|---|---|
| 模块分工/切片顺序符合用户要求 | 通过 | Work 11–16 与 plan 12–33、t04 11、提案 9 与迁移顺序表一致：机制 lifecycle→services→plugins 单向、application 装配；第二片是诊断/文件/SQLite 最小真实集合，明确不先搬所有应用服务；功能顺序 Lab→Files→Settings→World/Plot |
| 首片/第二片有可运行闭环 | 通过 | plan 切片一 6 单元各有"验收/停止点"，"四项合同全部有证据才报首片完成"；切片二每单元有"实际 smoke"与通过条件（真实写文件、事务提交回滚、关闭重开）；七 Spec 验收段要求真实宿主/真实临时根，并声明"不把尚未存在的脚本列为证据" |
| 未来命令与现有命令区分 | 通过 | plan 82–91 标题即"第一片拟新增命令（尚未存在）"，7 行声明"不能直接当作已存在工具"；已核实应用包现无 `test:runtime-foundation`/`typecheck:runtime-foundation`/`smoke:runtime-foundation`（现有 `runtime:typecheck` 指向 `server/runtime/tsconfig.json`，是另一命令） |
| 文件边界规范 | 通过 | plan 43–56 模块落点表逐行给出"对外接口方向/允许依赖/不允许"；t05 21–30 精确到文件；"不新增 npm 包、公开 exports、依赖框架"、"不建 barrel/index/types/factory 四件套"、"不修改全量配置屏蔽失败" |
| t05 可执行 | 通过 | 进入条件含 w00003 合并与 `governance:context` 命令；已核实无同名文件冲突（无 `runtime/`、无同名 vitest/tsconfig），`@notnotype/neuro-book-test-support` 提供 `./vitest` 且已是应用包 devDependency；验证命令明确"须由本Task建立后执行"；临时 smoke 与"通过后移除"写清 |
| 不误晋升全部 Spec | 通过 | t05 明文"保留 `planned` 至首片集成证据覆盖全文，不凭单个单元或测试宿主晋升；其它runtime Spec同理"；其余六项 Spec 均声明尚未实现；注册表保持 `planned`，只在证据覆盖全文时原位更新 |
| worktree 进入条件全链一致 | 通过 | Work 16/46、plan 137–148、t04 11/37、t05 17、提案决策记录末行与收尾、注册表缺口行一致；"共享树/检查点分叉"仅出现在否定句 |
| 未自动授权远端 | 通过 | Work 55/46、plan 144/148、t04 13/37、t05 19 均要求提交/push/合并/迁移另获授权；无任何"已授权/已完成"的远端或 worktree 表述 |
| 独立 capability/body | 通过 | 七项 capability 全仓唯一、一 capability 一文件；未建"插件版"副本，提案预期改动表给既有能力指明"沿原 capability 修订" |
| planned 黑盒边界 | 通过 | 抽查七 Spec 未发现类名/函数名/算法/目录布局/框架技巧/逐文件改法；出现的均是既有公开入口（如 `NEURO_BOOK_LOG_DIR`、`.nbook/project.sqlite`）或依赖方向边界；脚本名不预设 |
| 术语与近义冲突 | 基本通过 | 四阶段"创建中/可用/停止中/已关闭"、"关闭未完成不是第五阶段"、"收口≠回滚"、"唯一 owner 与借用者"在七份 Spec 一致；"解析作用域/提供者作用域"已文内显式等同；唯一缺口见发现 2 |
| 链接与证据 | 通过 | 四份新文档、提案与两索引的全部相对链接解析成功（含 `../README.md#编号分配与记录位置`、`#能力地图与规范归属` 锚点）；关键事实与 master 一致（见第五节）；`governance:check` 两项既有失败仍在，文档未重复运行、未冒称通过 |
| 历史任务上下文 | 见发现 1 | t01 历史范围注记已在（t01 README 9 行），本 Work 声明"旧报告不为新 Spec 背书"；命令/Lab 基线归属缺项是唯一缺口 |

## 五、本轮只读核实的源码/治理事实

- `packages/neuro-book/vitest.config.ts`：默认加载 Agent `setupFiles`/`globalSetup`，`include` 不含新 `runtime/**`；`tsconfig.json` 的 `include` 为 `app/**`、`server/agent/**`、`shared/**` 等，不含 `runtime/**`——plan 80 行"测试配置现状已核实"成立。
- `packages/neuro-book-test-support/package.json`：`exports` 含 `./vitest`、`./paths`、`./tmp`；其 `vitest.ts` 同时充当 setup 与 globalSetup（每 run 根、24h 兜底回收），t05 的配置要求可满足。
- `packages/neuro-book/package.json`：现无三项拟新增命令；`server/runtime/tsconfig.json` 与 `runtime:typecheck` 已存在（不同对象）。
- `server/app-logs/logger.ts`：`AppLogEntry` 字段为 `timestamp/level/event/message/data/error`；`NEURO_BOOK_LOG_DIR` 解析、单文件上限轮转、文件数/总字节/时限预算均存在——diagnostics 的"兼容基线"描述可核对。
- `server/runtime/app-sqlite-location.ts`：`DEFAULT_APP_SQLITE_URL = file:./workspace/.nbook/neuro-book.sqlite`；`.nbook/project.sqlite` 由 `project-database-module` 使用——sqlite 的库位置描述与 master 一致。
- `server/runtime/paths/file-path.ts`：词法包含 + `assertRealPathContained`/父目录校验——files 的"既有包含校验（目标与父目录分别处理）"描述一致。
- w00003 树（只读）：`LabShell.vue` 有 `provideWorkbenchCommands`/`WorkbenchCommandPalette`；`app/composables/useWorkbenchCommands.ts`、`server/storage/project-storage-module.ts`、`app/utils/workbench/storage-context.ts`、`server/storage/product-definitions.ts` 均存在；`docs/specs/ui/component-lab.md` 为 `implemented` 且五 tab 含"命令"——提案证据行与 D5 引用的现状成立。
- `HEAD 4590627…` 与 w00003 `HEAD 26479d48…` 与文档一致；w00003 status 计数在本轮持续变化（staged 7 未变，unstaged/untracked 由文档记录的 196/166 漂移到审查时的 206/178）——该行已声明为调查快照，不判缺陷，但集成时不应把具体计数当基线。
- `governance:check` 两项既有失败仍在：`w00003/t14-*` 目录只有 `evidences/` 无 README；根 `AGENTS.md` 四个固定标记缺三（"统一评审通过后"存在）。
- t04 `evidences/context-checks.txt`：t04/t05/t02/t03 四次 `governance:context` exit 0，与 Work 59 行"统一运行"说明一致；`docs:check` 记录尚未落盘（预期 Leader 收尾运行）。

## 六、非缺陷观察（可推知或可选改写）

- plan 41 行"后四项及部分 UI 实现在 w00003 未提交工作中"：按"`workbench.commands`/`quick-open`/`storage.boundaries`/`storage.persistence` 在 w00003 树独有，`ui.component-lab` 主树已有 `planned` 版本但状态不同"读可自洽，且 Lab 切片与提案 162 行已写明 component-lab 的整合；若要更稳可写成"后四项在 w00003 树独有；`ui.component-lab` 主树为 `planned`、实现态在 w00003"。
- plan 82–91 的 `smoke:runtime-foundation` 归属：按切片一单元表属后端/浏览器适配与切片二 `--services`，t05 只建 test/typecheck 与临时 smoke，与"由实施单元随入口一起新增"相容；若担心被读成首片首个单元即须建全部命令，可在清单注明各自归属单元。
- t05 58 行"脚本放测试支持包分配的系统Temp"：与 [测试规范](../../../../../../docs/testing/README.md) 规则 5（脚本临时数据用该出口）应指同一件事，写"临时数据"更稳。
- 提案决策记录前两行用"本轮对话"而非日期（首轮已记录为刻意选择），本轮仍不判缺陷。

## 七、未运行与未核实

- 未运行 `bun run docs:check`、`governance:check`、`governance:context` 与任何产品测试/typecheck/build/浏览器/迁移/Provider（按 Task 合同由 Leader 统一执行）。
- 未审 t02 的合同语义范围（取消/关闭竞态、出口能力、文件权限、SQLite 借用与唯一 owner 等），该批已由 Main 处理并定向复核；本报告只在术语/状态表层面补充发现 2。
- 未复核提案能力地图以外的历史段落行号，未逐条验证 w00003 未提交改动，未验证任何外部 URL；w00003 树在本轮持续变化。
- 本报告不构成人类批准提案，也不授权实施、worktree 创建、提交、push、合并、迁移、真实模型或浏览器验收；审查通过不等于实现通过。

## 八、修订后定向复核（Main 集成后，只核发现 1–3）

- 发现 1（Lab/w00016 归属）：`implementation-plan.md` Lab 切片新增段落"其中命令底座、常驻palette/confirmation与第五命令tab实际由 [w00016] 在w00003树交付；不能因checkout名称把该批当无主遗留。合并基线须包含此批实现/Spec；Lab切片执行前由本Work Leader记录与w00016交付owner的交接，在合并后的 `workbench.commands`、`workbench.quick-open`、`ui.component-lab` 原位调整宿主边界…历史w00016验收保留，不倒改成当时失败；新边界以w00017证据替代"；提案 48 行同步为"w00003树中的w00016交付…这是w00016命令底座与Lab闭环的已验收批次；A3要求在后续Lab切片明确替代全局宿主，不把它当无主遗留"。已闭合。
- 发现 2（plugins 状态表）：激活表 65 行统一为"失败"，66 行改为"停止中"（"按生命周期门禁收口到已关闭；单个等待方取消不触发此转换"），并新增"失败 | 所属作用域关闭 | 停止中"一行；全文已无"收口中"（grep 为空）。已闭合。
- 发现 3（批准依据）：`lifecycle.md:138`、`services.md:128`、`plugins.md:132` 三处统一为"2026-09-20 开发者接受基础架构与分段推进方向，并明确要求把第一实现切片…与第二切片…沉淀为 Spec；不包含任意热卸载扩展"，不再声称逐项批准 D1–D4/生命周期矩阵；提案 541 行标为"先前推荐（历史阶段）…当时仅A1–A3明确批准；后续基础架构与两切片规范规划的批准见下文"。已闭合。
- 本轮复核只读取上述位置，未重跑 `docs:check`/`governance:*` 或任何产品验证；第一节指纹为集成前行号基线，本节以引文为准。"等待 w00003 合并 master" 的进入条件不变，本次修订不打开该条件。
