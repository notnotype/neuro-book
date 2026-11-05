---
schema: nbook.task/v2
taskId: t34-plot-side-impl
status: active
updated: 2026-11-05
---

# 剧情侧的实现

## 目标与范围

按开发者 2026-11-05 批准的剧情侧 Spec（[t33](../t33-plot-side-spec/README.md)）实现内核的新机制与剧情插件，在内核分支 `feat/w00039-t29-canon-kernel` 上，开发者允许前不合并进 master。先写实施计划（`plan.md`），开发者确认后分阶段交付。阶段的先后按[剧情侧提案](../../../../../docs/proposals/world-engine-plot-side.md)的待定项 2：条目引用、讲述的位置与标注、在场（后面都依赖）→ 知情与伏笔 → `nb-time` 与时间说法 → 世界线 → 目标与态度、决策与守卫 → 诊断与窄问题的完整一套。

合同：要实现的 Spec（都在分支上，`status: planned`）：

- 内核：`docs/specs/canon/model.md`、`components.md`、`revisions.md`、`project.md` 的新条目，新建的 `worldlines.md`、`time.md`；
- 剧情插件：`docs/specs/plot/knowledge.md`、`foreshadowing.md`、`goals.md`、`decisions.md`、`brief.md`、`checks.md`。

依据：ADR 0041（`docs/adr/0041-world-engine-kernel-mechanisms-plot-plugin-semantics.md`）、0042、0043；t33 的三轮审查证据。

## 已定

| 日期 | 决定 |
|---|---|
| 2026-11-05 | 开发者看过计划要点（“可以，使用 /autonomous-delivery 推进”）：照 [`plan.md`](plan.md) 推进；阶段 A 的 8 片与实现审查一路做完，本该开发者确认的点记进 Work 的[待确认清单](../../pending-confirmations.md)；后续阶段开工前补细计划并审查；主会话写代码；审查在 omp 额度恢复前派 Claude Opus 子代理；在内核分支上，不合并、不 push |
| 2026-11-05 | 开发者：omp 有回退链，可以继续用；本次计划审查用快速审查：Claude Opus 的结论处理完就开工，omp 在后台继续，它的报告回来后单独处理 |

## 当前状态

2026-11-05：
- 计划第二版（处理计划审查 P1 的 17 条，[`evidences/plan-review-P1-resolution.txt`](evidences/plan-review-P1-resolution.txt)）；P2（omp，快速审查里后台跑的那一份）8 条，到 2 小时上限截停，处理见 [`evidences/plan-review-P2-resolution.txt`](evidences/plan-review-P2-resolution.txt)：第 2、4 条改了代码，第 5、7 条改计划，第 8 条在 A9 补集成测试并评估改订阅文件服务的变更事件，第 3、6 条不成立，第 1 条是审查 worktree 取错了提交。
- 阶段 A：
  - A1 已提交（分支 26e40e341）：日志格式 2；未决问题改成决策（样本里答过的问题是 Agent 答的，记成带建议的待定决策，答案在建议里，读取时标“作者未确认”）；讲述的 id（程序发、全局不复用）与按来源的形状校验，只查新写或改过的讲述；修订里按路径声明哪些数组按 id 拆；列表末尾的追加互不依赖。nb-canon 248 个测试、canon 插件 8 个测试通过，两个包类型检查通过。
  - A2 已提交（e2bb03c3e）：服务持有正文快照（打开时读一次，`textChanged` 只重读那一章，canon 插件在章节文件变化时调它）；读取结果带世界版本、正文快照与读取输入的摘要，游标绑定读取输入；`canonicalJson`（RFC 8785，遇到非法值抛错）。nb-canon 257 个测试、canon 插件 8 个测试通过。章节文件的监视在 A9 补一条插件层的测试。
  - A3 已提交（7651345e8）：`ref` 字段、以引用为键的列表（元素名读取时取被引用条目在这个位置的名字）、修订存这次新写的引用 `refs`（依赖与改动记录按条目筛只读它，插件停用后不变）、`ref-invalid`；临时 id 按保留写法替换。差分测试加了以引用为键的列表与改名。nb-canon 262 个测试通过。
  - A3b 已提交（e21059746）：列表元素的语义档子字段（事件与归纳按 `命名空间.字段[元素].子字段` 记，元素加去或整个换掉时清空，语义档的核对点在元素上也是新的起点）；`fieldOf` 改成取地址指到的叶子（元素子字段上的数值核对点从此会比较，Spec 本来就这样要求）。差分测试加了元素子字段的事件。nb-canon 264 个测试通过。

  - A4 已提交（70670350c）：讲述在读取时按正文快照定位（段、段内偏移，按章与正文缓存），失联带原因，`tellings` 按读的先后排、可按讲述位置截取“读过的”、按章范围、条目、是否生效筛；`telling-lost`、`duplicate-quote` 先作为每条的提示给出，A8 并进提示组。写入时数原句出现次数改用与定位相同的切段（原先按整章数，原句首尾带空白时两边会不一致）。canon 插件的规模脚本加了讲述的测量；1000 章的正式测量等 P2 结束、负载降下来再跑（20 章试跑：不带筛选的第一页 1.5 毫秒）。nb-canon 271 个测试通过。

  - A5 已提交（51f242cca）：标注种类与诊断的登记（前缀、重复两步判定共用 `components/declarations.ts`；标注的 schema 白名单关键字、`refs` 路径只经过 `properties` 与 `items`），载荷用 TypeBox 的 JSON Schema 校验器；新加或改过的标注按登记查（同一位置逐字相同的算原样留着），载荷里的引用并进统一的引用校验与修订的 `refs`；只读的标注在 `object` 与 `tellings` 的结果里带 `mark-kind-unknown`、`mark-version-unsupported`；读取输入摘要带三张版本表；服务的 `setRegistry` 换成 `setRegistries`。插件侧的贡献点与接收在 A9 接。发现剧情 Spec 的标注种类 id 写成 `plot.*`，按登记规则要带插件 id 前缀，记进计划阶段 B。nb-canon 280 个测试通过。
  - A6 已提交（2b95f94ae）：参与者 `cast`（马甲写成本体加 `as`，`invalid-cast`）、叙述 `nature: narration`（`narration-with-patches`、`narration-without-telling`）、`presence`（实际模式与按计划模式，另给没记参与者的条数）、本章涉及的条目算上参与者、`changes` 加性质与计划进展的筛选；引擎两边加 `plannedAt`（按计划模式在一个位置计入的计划），差分测试比对。涉及的条目与参与者按 Spec 也查“已出场”（原先只查补丁的条目）。顺带修了 t29 的老问题：没有补丁的已写变更在增量更新里不记套用结果，兑现不了计划；差分测试的模拟器加了没有补丁的变更（20 个种子、每个 100 步一致）。安放范围 `{after, through}` 的两头是分叉的切口与触发处，挪到阶段 D（计划已改）。nb-canon 285 个测试通过。

  - A7 已提交（6979e523c）：决策的状态表做成一张表（`world/decisions.ts`），写入校验与授权检查共用；作者授权（`world/authorization.ts`）：宿主与内核共用 `authorizationBinds`，内核先逐字比 `binds` 再交宿主验签名；出处只由内核写（`source-not-writable`）；缺来源排在校验之后报（`author-source-required` 带需要的清单）；还原拆成“算补偿与需要的授权”与“核对后发布”，`preview` 收还原请求；修订存请求原样的授权（换过临时 id 的签名验不过，有变异检查）。`decisions` 读取带说明：作者未确认、作者没说理由、重新打开前定下的、挂的条目已删。样本里“放弃”的问题改记成待定（放弃要作者来源）。nb-canon 294 个测试通过。应用的远程合同只跟着改了 `decisions` 的形状，`revert` 带授权、`preview` 收还原请求在 A9 接。

  - 计划审查 P2 的第 2、4 条已改（0ea52acab）：游标绑定读取参数；临时 id 只在引用位置上换（A3 原先把与临时 id 相同的任何字符串都换掉，不合 components 输出 18）。
  - A8 拆成两片（内容多，拆开各自验证）：A8a 已提交（759254a32），引擎两边的待处理按模式算（按计划模式时核对点、套不上与嫌疑区间都算上计入的计划），排序表收成 `engine/pending.ts` 一处，差分测试两种模式都比（20 个种子、每个 100 步一致）。nb-canon 298 个测试通过。

  - A8b 已提交（62441257e）：插件诊断的项目内接口（`registerDiagnostics` 返回停止函数、`reportDataVersion`，数据版本进读取输入的摘要）；一次计算的处理按 Spec 的顺序（校验稳定键、去重并提示、截到 1000 条、按作者的已定决策分出已处理、版本不同的旧决策照常报出并带它的 id）；抛错、没登记计算、键不合声明都是 `diagnostic-unavailable` 并标不完整；停用插件的诊断另列，不标不完整；`pending` 改成按组（待处理、提示、已处理）分页，三组与内核自己的提示（讲述失联、原句重复、只读的标注、类型不在的 Component）按 model 输出 16 的全序排，按读取输入缓存；`status` 带最近的计算耗时。列表的计算挪进 `service/reads.ts`，同一份代码给 `CanonReadView`。nb-canon 305 个测试通过。

  - A9 拆两片。A9a 已提交（72d9d692a）：服务的 `openView`、`closeView`、`viewAudit` 与带令牌的读取 `viewed(token)`（`entry`、`render`、`lookup` 的位置不写时夹到上限，写了晚于上限的拒；`presence`、`changes`、`tellings` 只返回上限之前的；别的方法带令牌拒），每次被拒记一条审计（最近 500 条）。A9b 已提交（5318a94bd）：远程合同加 `tellings`、`presence`、`openView`、`closeView`、`viewAudit`，`pending` 带模式、组与游标，`preview` 收还原请求，`revert` 带授权，`changes` 加性质与计划进展，各方法收视图令牌，`textChanged` 事件；canon 插件的 `canon.marks`、`canon.diagnostics` 贡献点与诊断的项目内接口（按调用方，登记随调用方入口停止失效）；调用方实例失效时关掉它打开的视图。集成测试（真实项目子进程）：原子替换保存章节后讲述失联、版本不变、读取输入的摘要变了、收到 `textChanged`（P2 第 8 条）；视图的场景 8；探针插件 `test.canon-probe` 经两个贡献点登记标注种类与诊断、经项目内接口登记计算。canon 插件 11 个测试通过。视图令牌的寿命按调用方实例算（只断链路不失效），记进待确认清单。

## 下一步

1. 阶段 A 已收口（2026-11-05）：`test:affected --typecheck --since 1c11c6529` 全过（nb-canon 308、应用包 bun 1732、vitest 410，两包类型检查）；规模测量重跑，与 A4 时一致（[`evidences/scale-a4.txt`](evidences/scale-a4.txt)）。阶段 A 的实现审查 I1（omp 默认模型，审 `1c11c6529..5318a94bd`）在后台跑，**实现审查待处理**：报告回来后照 reviewing 的“处理结果”归类，修正单独提交。
2. 阶段 B：B0 已提交（fc97991ee）：带令牌的条目读取与渲染不给 `upcoming`（阶段 A 视图会把上限之后才启用的值漏出，P3 第 5 条）；视图审计加种类（拒绝、占位）、被挡的对象与序号游标，可按看的人筛；项目内接口 `canonProjectKey`（诊断登记、快照、开关视图、记占位，门面释放时关掉调用方开的视图）；快照的视图、带令牌的读取与戳建在同一份世界上，正文或插件数据变了以后再用就抛错；`CanonReadView` 加 `stamp`、`line`、`origins`、`outcome`、`progress`、`eventKey`、`placementKey`、`compareKeys`、`fields`、`markType`（排序键两个引擎各实现，差分测试比对）；读取输入摘要的算法收成 `readStampOf`，`createWorldReadView` 与 `pageOf` 公开导出；project 输出 24 补了审计与 `upcoming` 两句。nb-canon 313、canon 插件 11 个测试通过。下一步 B1。
   B1、B2 已提交（4f0a1bef3，两片改动交织在同几个文件里，合成一次）：剧情 Spec 的 146 处 id 按精确清单加了 `nbook.` 前缀（capability id 不动）；`nbook.plot` 插件（描述符、五个 Component、三种标注种类、两项知情诊断的声明，项目入口经 `canonProjectKey` 登记计算，远程合同 `nbook.plot/world` 的 `knowing`、`reader`）；`core/knowledge.ts`（逐行历史按相邻两步比较、有效知情取排序键最大的候选、在场推出与隐秘目标推出、读者的知情与第一次揭示）、`core/knowledge-checks.ts`（传话链、知情行不完整）；`CanonReadView` 加 `positionKey`、`plannedAt`。顺带：跨插件的运行时导入只能指向 `shared/contracts.ts`，`canonProjectKey` 与贡献点的名字并进 canon 的 contracts；canon 测试的固定等待换成 `waitUntil`（t29 留下的，`governance:check` 原先不过）；起项目子进程与窗口的测试工具挪到 `canon/testing/harness.ts`；插件页的名称表加了剧情插件（文案记进待确认清单）。知情索引按视图对象缓存，不按读取输入摘要（摘要不认是哪一份世界，计划已改）。剧情插件 10 个测试（纯计算 8、项目子进程 2）通过；应用包 bun 1743、vitest 410，nb-canon 313。
   B3 已提交（fcb54e716）：`core/viewpoint.ts`（看的人对知识点读得到内容、只读得到他以为的那句或只给占位；读条目时去掉别人的知情命名空间、挂在下面读不到的知识点不列、字段与以引用为键的列表里指向它们的换占位，隐秘目标随它的知识点挡；按名字找去掉读不到的；经历只给 id、安放、描述、同场的人与知情的变化，马甲按揭穿规则；问别人的知情只给常识与行内档里自己也知道的；每次占位记进内核审计）。读不到内容按“看的人读不到”挡而不是 Spec 字面的“保密以上一律”：看的人自己知道的保密知识点在别处照常显示（直接读也读得到）。远程合同加 `openViewpoint`、`closeViewpoint`、`viewpoint*`：句柄按调用方记、内核令牌不出项目进程、调用方实例失效时关掉内核视图。视图测试跑在进程内真实的 `WorldService` 上（`testing/service.ts`）。剧情插件 15 个测试通过；全量那轮服务端停止的 3 条用例在负载 9 时超时，单独重跑通过。
   B4 已提交（ac4466c93）：`core/foreshadowing.ts`（节点：生效正文讲述上的节点标注、悬念答案上的揭示；计划的节点在计划的非正文讲述上；继承按已写变更自己的全部讲述判断——作者标过的节点因改稿失联时不拿计划的节点顶上，这样 Spec 场景 1 的“删掉那句阶段退回、待处理回来”才成立；阶段取读过的最高一级；十一项检查（`objectTouchedInText` 随阶段 F）；账本）。远程合同加 `ledger`。剧情插件 20 个测试通过；全量那轮插件 SDK 示例的一条 DOM 测试在负载 10.6 时失败，单独重跑通过。
   B5 分两次提交。5326540ca：`core/goals.ts`（某人在一个位置上的目标：挂在他下面、已出场、进行或受挫；冲突的对称读取：自己写的加上写了它的，两边都只列这个位置上在的目标）；远程合同补上计划里列了、B3 漏掉的 `experience`（作者视角的经历：在场的变更整条、按故事先后，没记参与者的条数，有效知情），以及 `conflicts`（目标不在时 `not-found`，沿用 canon 的码）；按视角的经历改成按故事先后排（原先按变更的写入先后，按计划模式时计划排在最后）。ffd2db1f1：剧情形状的规模脚本 `scripts/perf/plot-scale.ts` 与按剖析做的三处优化（同一份读取输入上快照与诊断共用一个视图对象、剧情的索引与在场的变更按视图缓存、按安放排序时排序键只算一次）。1000 章：读待处理中位 142 ms（预算 200）；按视角读一个挂了 20 个保密知识点的条目，发布后第一次中位 14–17 ms、最大 26（预算 20，偶尔超），同一份输入上再读不到 1 ms（[`evidences/scale-b5.txt`](evidences/scale-b5.txt)）。剧情插件 23 个测试通过。
   **阶段 A 的实现审查 I1 已处理**：omp 审到一半额度用完（报告被它自己覆盖过一次，1 到 7 条从会话日志取回），8 条（阻断 1、重要 7）里 7 条成立、1 条部分成立，全部修正在 cb4aa74c5（[`evidences/impl-review-I1-omp.txt`](evidences/impl-review-I1-omp.txt)、[处理](evidences/impl-review-I1-resolution.txt)）：世界表与读取视图交出的对象深冻结；初值依据的核对点、马甲指向墓碑；改已有变更加的列表元素与兑现组进还原依赖（兑现组按 model 输出 13 的定义，记进待确认清单）；视图按讲述位置比上限、按上限算计划进展与按计划的在场；稳定键只认合同里的字段。第 2 到 5 条是 t29 就有的。nb-canon 319 个测试通过，每条修正都做了变异检查。没审到的四处（作者授权、两个引擎、canon 插件、性能）改派 Claude Opus（I1b）：10 条（重要 3、建议 7），8 条成立已改、2 条接受取舍，修正在 882387376（[`evidences/impl-review-I1b-opus.txt`](evidences/impl-review-I1b-opus.txt)、[处理](evidences/impl-review-I1b-resolution.txt)）：新建的待定决策不能带结论等字段；还原重发按还原请求的摘要判；修订的请求摘要与授权的 `binds.request` 同一算法；转换不合法时不报授权用不上；没给项目标识时不验来源；世界打开期间到达的登记变化补上；修订的 `refs` 按 Spec 的形状存；差分测试补三条分支。阶段 A 的实现审查到此处理完。
   **阶段 B 已收口**（2026-11-05）：`test:affected --typecheck --since 5318a94bd` 两包类型检查通过，nb-canon 319、应用包 bun 1756 通过；vitest 410 条里 3 条 DOM 测试（命令面板、Lab 目录、Markdown 编辑器，与本 Task 无关）在负载 17.7 时 5 秒超时，单独重跑通过。收口的规模重量推迟：别的会话在跑 Playwright 与类型检查，负载 10 到 17，量不准；等 I2 跑完、机器空下来以后量 `canon-scale.ts` 与 `plot-scale.ts` 各一次，补进 [`evidences/scale-b5.txt`](evidences/scale-b5.txt)。阶段 B 的实现审查 I2（omp 默认模型，审 `5318a94bd..cb4aa74c5`，含 I1 的修正，并进 P3 计划审查的 omp 份）：16 条（阻断 1、重要 15）全部成立、全部修正（a4b7d5d68 内核、0a6028673 剧情；[`evidences/impl-review-I2-omp.txt`](evidences/impl-review-I2-omp.txt)、[处理](evidences/impl-review-I2-resolution.txt)），阻断的是可预测的视图令牌能绕过剧情的视角过滤：远程门面改成只认调用方自己开的令牌、令牌改成随机串。omp 审到第 16 条时额度用完，没写汇总，五处重点都已覆盖，不再续跑。阶段 C 的细计划第一版写进 [`plan.md`](plan.md) 的“阶段 C 细计划”（对照了只拿到目标的 Sonnet 独立设计，采纳了它的分量划法、紧边依据、按祸首合并与历法周期表；没采纳打架后局部降级与历法改了以后合并“不成立”），计划审查 P4 的 Opus 一份 27 条已处理，计划改成第二版（ee970c7a4）；omp 那一份等额度恢复后照常新开会话发。
   阶段 C：C0 已提交（85d74e4e6，P4 推过来的口径补进 time、model、revisions、project 四份 Spec，各记待确认清单）；C1 已提交（66d97e39e：`packages/nb-time` 包与登记、历法的校验与两条上限、周期表、连续 n 年（月）的最短最长、日期到绝对范围、拆回各级；12 个测试，公历与 `Date` 随机对拍两千个日期，L_min、L_max 与逐个起点暴力枚举对拍）。顺带发现：公历连续 15 年最短是 5477 天（跨过不闰的世纪年时只有 2 个闰年），独立设计写的 5475 不对；验收 2 的“2012 年 2 月底起”按 5477 成立。C2 已提交（c62827a0b：内置缺省词表与作品设置的覆盖、间隔、说法的校验与降成约束；time.md 写明词表在设置里的形状 `{words, approx}`）。C3 已提交（826fe7ee6：组网时的端点解析、按事件之间的约束分量、负环取出与逐个排除、按势重赋权求范围、紧边依据、两件事的差；60 个随机种子与 Floyd-Warshall 对拍，两千件事的反向长链在负载 14 时 50 到 77 毫秒）。C4 已提交（e57d35b1f：对不上的两类判据与每件一项带件数、年龄、一章的范围、一段时间里的事、逐级浏览、历法简表、按精度格式化）。按 Spec 的全局上下界，“在 b 之后至少 20 年”的人答“至少 19 岁”（连续 20 年最长比最短多一天），是 Spec 的取舍。nb-time 36 个测试通过。
   C5 已提交（397b18670）：剧情变更的 `when`（TypeBox schema 在 nb-canon、nb-time 是同形的 TS 类型，`./schema` 子路径仍只依赖 TypeBox）；`of`、`who` 进引用位置（还原依赖经引用成立）；写入校验只查新写或改过的说法；依据按 `told` 下标写的换成讲述 id；没给 `order` 的前史整份请求套上以后按时间补 `order`（比可比的都早的排到最前，revisions 输出 18 的措辞一并改正）。C6 已提交（abd17d1d3）：时间的三种待处理进 `World.pending`（按数据、设置、模式与章序缓存），随读取位置截取，排在内核几种之后；带来的变化里按整条线记，只在碰到与时间相关的对象或调整章序时为新数据建网；读取输入的摘要带历法与词表的内容摘要；服务的 `setTime` 与 `calendar-invalid`、`fuzzy-word-invalid` 诊断（整份重算）。C7 分三次提交：e86a02ff3 内核的时间查询（事件、一章、一段时间、两件事的差、年龄、逐级浏览、历法简表；带令牌时只用上限之前的事建网、点名上限之后的事被拒并记审计；`CanonReadView.time`）；63a04b760 canon 插件的两个配置项（只允许项目层，文案记进待确认清单）、项目入口把设置交给世界宿主、宿主把最近一次合法的历法存进 `.nbook/world/calendar.json`、远程合同加 `time`，真实项目子进程里的集成测试（设置里的自定义历法生效、存下、改坏以后照样用它）；296656fb0 规模脚本加时间说法（30 章冒烟：135 条带说法的变更，打开后第一次查询 31 ms，年龄答“20 岁”）。1000 章的正式测量等机器空下来再量。
   **阶段 C 已收口**（2026-11-05）：`test:affected --typecheck --since 0a6028673` 选了 20 来个包（根 package.json 与锁文件变了），类型检查都过；失败的都与本 Task 无关或是负载 20 下的超时，单独重跑都过（vitest 4 个文件、nb-story 一条），dev-panel 两条真实 herdr 的用例并行时相撞（已知）；顺带修了开发服务监视列表的测试（应用包现在依赖 nb-time，090453dae）。计划审查 P4 的 omp 份回来（12 条有效：阻断 2、重要 9、建议 1），10 条成立已改或已在实现里、2 条接受取舍，修正在 6ed78b986、550ebccb2（[`evidences/plan-review-P4-omp.txt`](evidences/plan-review-P4-omp.txt)、[处理](evidences/plan-review-P4-omp-resolution.txt)）。阶段 B、C 的规模已重量（负载 1.3 到 2.5）。先按剖析做了四处优化：84ba1b9d8 时间层（对不上只求上下界、没有约束的分量不求解、分桶追加、说法的键按变更对象缓存），f5fc26c34 读条目只求被读地址的核对点，30f2ec74c 伏笔按章序下标表查章、读视图的排序键不再深冻结。canon：除“最新一章发布一次记账”中位 155 ms（预算 100）外都在预算内：冷建网 66 ms，随机读 0.05 ms。发布在阶段 B 收口前已是 115 ms，时间层另加 30 到 40 ms，再压要新设计，记进待确认清单，阶段 D 收口时再量（[`evidences/scale-c7.txt`](evidences/scale-c7.txt)）。剧情：读待处理中位 150 到 156 ms（预算 200）；按视角第一次读中位 15 到 16 ms（预算 20），都在预算内（[`evidences/scale-b5.txt`](evidences/scale-b5.txt) 第五节）。阶段 D 的独立设计（Sonnet，只给目标）已回来（[`evidences/worldlines-independent-design.txt`](evidences/worldlines-independent-design.txt)）。下一步：阶段 C 的实现审查 I3（omp，审到 30f2ec74c）；阶段 D 的细计划。
3. 阶段 B 的细计划第二版（[`plan.md`](plan.md) 的“阶段 B 细计划”）：P3 的 Opus 一份 19 条全部成立、已改进计划（[`evidences/plan-review-P3-resolution.txt`](evidences/plan-review-P3-resolution.txt)），新加一片 B0 补内核（视图不漏上限之后的值、项目内的快照、`CanonReadView` 补齐、审计改上游、公开的辅助）。omp 那一份不再单独发，并进阶段 B 的实现审查（待确认清单）。
4. A4 的 1000 章测量已跑（[`evidences/scale-a4.txt`](evidences/scale-a4.txt)）：都在预算内；打开到可以读 1508 ms（t29 时 1065），日志 22.0 MB（t29 时 13.5），主要是修订存下的 `refs`，交实现审查一并看。
