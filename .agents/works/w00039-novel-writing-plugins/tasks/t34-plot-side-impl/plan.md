# t34 实施计划：剧情侧的实现

## Context

开发者 2026-11-05 批准了剧情侧的 12 份 Spec（t33，分支 `feat/w00039-t29-canon-kernel` 的 ad3d802c1，`status: planned`）。计划审查又补了几处 Spec（1c11c6529，见“Spec 与文档改动”）。本 Task 把它们实现到内核 nb-canon、canon 插件与一个新的剧情插件里。

依据：
- 提案：`docs/proposals/world-engine-plot-side.md`（已接受）。
- ADR：0041（内核只加通用机制）、0042（世界线是每条线一份线性视图）、0043（两种先后与时间）。
- Spec：
  - `docs/specs/canon/`：model、components、revisions、project、worldlines、time；
  - `docs/specs/plot/`：knowledge、foreshadowing、goals、decisions、brief、checks。
- 原型（t32）：`prototype/worldline/lines.ts` 的按值比对更新；时间约束网络见 `evidences/time-examples.txt`。

已定的约束：
- 代码与 Spec 都在内核分支上，开发者允许前不合并进 master，不 push。
- nb-canon 只依赖 TypeBox 与 MDX 解析库，前后端共用（11-02 定）。
- 剧情插件照 canon 插件做成应用里的内置插件（11-05 定）。
- 按本计划自主推进，主会话写代码（11-05 定）。

工作方式：
- 分 6 个阶段，按提案的实施先后排。本计划把阶段 A 写到能照着实施，B 到 F 只写范围与依赖，开工前在本文件里补细、再审一次计划。
- 第一版计划经快速审查：P1（Claude Opus，17 条）已处理，P2（omp）在后台，回来后单独处理。见 `evidences/plan-review-*`。

## 技术选型

| 问题 | 选用 | 理由；否决了什么 |
|---|---|---|
| 标注载荷的 JSON Schema 校验 | TypeBox 1.x 的 `typebox/schema`（`Check`、`Errors`） | nb-canon 已依赖 TypeBox 1.3.6，它能直接校验标准 JSON Schema；校验前去掉载荷的 `kind`、`version` 两个键。否决 ajv：多一个依赖，TypeBox 已经够用 |
| 摘要（SHA-256） | 宿主注入的 `digest` 端口（`service.ts:35`） | 同步；只在项目进程里算（世界服务，由 Bun 提供），读取输入的摘要随结果与游标带出，作者授权的 `binds` 由宿主在服务端签发时算；浏览器只转交，不算摘要（P2 第 7 条）。否决 Web Crypto：只有异步接口，读取会全改成异步 |
| 规范的 JSON（RFC 8785） | 新写 `canonicalJson`（`src/core/stable-json.ts`） | 对象的键按 UTF-16 码元排序、数用 ECMAScript 的写法，与现有的 `stableStringify` 相同；另外遇到非有限数、孤立代理项、非普通对象就抛错。稳定键、作者授权、读取输入都用它，`stableStringify` 继续用于请求摘要与深比较。RFC 8785 附录的向量（连同错误项）作测试 |
| 时间约束网络、历法 | `nb-time` 自写（阶段 C） | 提案定为无依赖的包；自定义历法没有现成的库（Temporal、date-fns 都只有公历）；最短路与负环检测用 Bellman-Ford |
| 剧情插件的纯计算放哪 | 插件目录里的纯 TS 模块（`packages/neuro-book/src/plugins/plot/core/`），不新建包 | 只有这一个使用方；模块不引应用代码，以后要拆是机械的。否决新包 `nb-plot`：多一套发布与边界登记，眼下没有收益 |

## 关键设计（阶段 A：内核的基础机制）

### `packages/nb-canon/src/core/`：格式 2 的形状与修订路径

- `schema.ts`：
  - 讲述 `TellingSchema` 改成 model 输入的形状：`id`、`source`、`chapter?`、`quote?`、`nth?`、`anchor?`、`marks?`；按来源的必填项由 `validate` 查（`invalid-telling`），与 schema 改动同一片落地。
  - 剧情变更加 `nature?`、`cast?`、`marks?`。`when?`、`fork?`、安放与读取位置的 `line` 在阶段 C、D 加，只加可选字段，日志格式仍是 2。
  - `QuestionSchema` 换成 `DecisionSchema`（model 的决策表）。对象种类 `question` 改名 `decision`，id 前缀从 `q` 改成 `d`（`ids.ts:8`）。
  - 写入请求加 `authorizations?`；修订加 `authorizations?`、`refs?`。
  - 修订的 `what` 在日志行里仍是文字（`schema.ts:221`，旧读者显示“其它”）。
- id 前缀：讲述 `t`；世界线预留 `l`（阶段 D 用，避开修订的 `r`）。Spec 例子里的 `r1`、`k12` 只是示意。
- `paths.ts` 的 `diffValues`：现在凡是元素都带 `id` 的数组都按 `[id]` 拆成叶子。改成按路径声明：只有主 MDX 的块、列表字段的元素、实例字段声明、讲述按 id 拆（revisions 输入的清单），其余数组整体是一个叶子。这条要在写出第一行格式 2 的日志之前定，不然决策 `about`、稳定键的 `objects` 这类带 `id` 的数组重放后会丢元素。`tests/core.test.ts` 补“about 有重复 id”“objects 有重复”的往返用例。
- 日志 `format: 2`：`src/node/log.ts:4、134、156`。格式 1 的行按“不认识的格式”只读（project 输出 2、4）。`tests/node-log.test.ts` 里 5 处 `format: 1` 的断言改成 2，第 105 行的“不认识的格式”用例反过来写。

### 正文快照：由宿主推，不再按需拉

- 服务持有每章 `{text, digest}`：打开时全量读一次；`textChanged(chapter)` 时只重读、重算这一章；正文快照的摘要随之增量维护（model 输出 36）。
- 写入校验（原句、排序键、数的依据）与读取（讲述定位）都读这份快照，不再每次调 `chapterText` 列目录、读文件（`PL/backend/binder.ts:79–88`）。
- canon 插件的 `world-host.ts` 在章节文件变化时调 `textChanged`；已有的目录监视（`reloadBinder` 那条路径）顺带看正文文件。

### 读取输入与游标（提前到讲述之前）

- 服务按读取时的输入算读取输入的摘要（model 输出 36 的对象形状），每个读取结果都带它。
- 游标改成“摘要加偏移”；读取输入一变，旧游标得到 `cursor-stale`（project 输出 19）。
- 先做这一层，后面各片加的列表方法（`tellings`、`presence`、`decisions`、`pending`）直接用它，不再各写一遍“版本:偏移”。

### `packages/nb-canon/src/world/references.ts`（新）：引用与替换

- 一次遍历给出两份清单：
  - 引用位置：components 输出 18 的五类表，写入校验（`ref-invalid`）、依赖、改动记录筛选共用；
  - 替换位置：引用位置，加上对象自己的 id、`fork.line`、稳定键里的对象、地址路径与 `listRemove` 里以引用为键的元素 id（`know.知情[tmp:k]`）。
  - 不变量：替换位置包含全部引用位置。
- 输入是写入后的整份对象，加上条目的有效字段声明与当时的标注种类登记；只在发布时算。
- 这次修订新写或改过的引用存进修订的 `refs`（revisions 输入）。依赖（`dependsOn`，`world.ts:458–497`）与改动记录筛选只读存下的 `refs`，不按当前登记重算：插件停用以后，还原“新建知识点”的修订仍能看到它被标注引用。
- 取代 `world.ts:545–594` 按键名的三张表（`ID_KEYS`、`ID_LIST_KEYS`、`REFERENCE_KEYS`）与 `referencedIds`。

### `packages/nb-canon/src/components/`：引用种类、以引用为键的列表、标注种类与诊断的登记

- `registry.ts`：字段种类加 `ref`；字段声明加 `targets`、`keyedBy`、`carry`；列表元素的子字段允许 `precision: semantic`（components 输出 18 到 20）。
- `src/model/apply.ts` 的 `listAdd`（第 271 行）：以引用为键的列表，元素 id 就是条目 id。`label` 不存，读取时取被引用条目的名字（`engine/views.ts`）。
- 新文件 `marks.ts`：标注种类的登记，白名单关键字、`refs` 的路径与 `kind`、前缀与重复两步判定（components 输出 17）。
- 新文件 `diagnostics-registry.ts`：诊断的登记（model 输入的表），同样的前缀与重复两步判定，`diagnostic-declaration-invalid`。
- 三张登记各有自己的版本表。Component 的 `digest`（`registry.ts:105`）仍只管引擎的整本重建；标注种类、诊断的登记变了，只让讲述与标注的校验、诊断结果的缓存失效。读取输入摘要里的 `registry` 由三张 `[[id, version]]` 表算。

### `packages/nb-canon/src/world/tellings.ts`（新）：讲述的发生点与生效

- `locate(chapterText, quote, nth)` 按 model 输出 24 切段、找原句、数第几处，给出发生点或失联的原因。offset 按 UTF-16 码元（JS 字符串下标）。
- 结果按章缓存，`textChanged` 时清这一章。
- 读过的讲述（model 输出 27）按活页夹章序、段、偏移、讲述 id 排。
- 失联与重复原句是提示（输出 26、34），提示组的排序在“诊断与待处理”一片统一做；这一片先把提示作为读取结果的一部分给出。
- 讲述 id 全局分配，不复用：重放、读进别的进程写的行（`#absorb`）、发布时，都要扫 ops 里嵌套的讲述 id（create 的 `after`、modify 的 `told[<id>]` 路径、delete 的 `before`），交给 `IdAllocator.observe`。
- 修订路径改成 `told[id]`（revisions 输入）。

### `packages/nb-canon/src/world/world.ts`：写入路径的新校验

- `validate`（`world.ts:637–786`）按 revisions 输出 3 加：讲述的形状、标注、引用、参与者、叙述、决策挂的对象、决策的转换。
- 参与者的 `who` 写成马甲的，存成本体加 `as`（model 输出 29），在 `fillDefaults` 里做。
- `not-deletable` 扩到决策（`world.ts:264`，revisions 输出 20）。
- 决策的状态表与转换做成一张数据表（`src/world/decisions.ts`），`validate` 与授权的检查共用，不在两处各写一份条件。
- 挂在诊断上的决策，`about.key` 按诊断登记查（model 输出 33）；诊断登记在“标注种类与诊断的登记”那一片就有。

### `packages/nb-canon/src/world/authorization.ts`（新）：作者授权

- 导出 `authorizationBinds(project, requestOrRevert, decision, transition)`：宿主签发时用它，内核校验时也用它。
  - `request` 摘要：写入请求去掉 `authorizations`、`baseVersion`；还原请求是 `{revert, withDependents, requestId, by, title}`。
  - `fields` 摘要：受限字段的固定集合；还原时按补偿后的值算。
  - 都用 `canonicalJson` 再取摘要。
- 校验分两步：内核先逐字比来源里的 `binds` 与自己算出的，不一致就拒收；一致再把来源交给宿主注入的同步端口 `verifyAuthorSource(source)`，它只验签名。没有端口时一律不通过。
- 项目标识作为 `WorldOptions` 的一项，由宿主给。
- 普通写入：请求里改了决策的 `source` 得到 `source-not-writable`；接受一项授权时，内核把 `source` 写成那项的来源。
- 还原：
  - `World.revert` 先算补偿，再找出与改前不同的决策（字段、状态，或被补偿真正删掉），每条一项 `{decision, transition: "revert", fields}`；
  - 这份清单供 `preview`（收还原请求）与 `author-source-required` 的详情用；
  - 补偿修订另走一条授权检查：只查有没有、对不对，不做 `source-not-writable`，也不写 `source`（补偿现在不跑 `validate`，`world.ts:309`）。
- 测试端口按合同签名（HMAC，固定测试密钥）。另加一条测试：端口对任何签名都答“通过”时，把授权挪到另一条决策照样被拒，用来证明 `binds` 是内核比的。

### 诊断与待处理

- **两个引擎**：`Engine.pending(position, mode)`，参照实现（`engine/reference.ts`）与增量引擎（`engine/incremental.ts`）都改；差分测试对两种模式都比。待处理排序表 `PENDING_KIND_ORDER` 现在两份（`reference.ts:41`、`incremental.ts:93`），收成一处，加上世界线、时间的种类与提示组。
- **诊断的只读世界**：先定一个 `CanonReadView` 接口，按同一份读取输入提供 entry、changes、tellings、presence、decisions（线、时间在阶段 C、D 再加）。它是阶段 B 起插件诊断的公开合同，World 与服务都据此实现，诊断只拿它。
- **计算放在服务层**：读待处理时，对每个启用、已登记计算的诊断同步调用 `compute(view, at, mode)`，然后：
  1. 去重；
  2. 截到 1000 条；
  3. 按挂在诊断上的已定决策分出已处理；
  4. 与内核自己的待处理一起按全序排（model 输出 16、34、35）。
- **缓存**：同一读取输入摘要加同一位置与模式，诊断结果缓存一份；翻页与三组总数都读缓存，读取输入一变就作废。
- **四种情况分开**：插件停用（看贡献点撤销）只另列；启用了但没登记计算、计算抛错，都是 `diagnostic-unavailable` 并标不完整；重复键给 `diagnostic-duplicate-key`；声明不合规是登记诊断。
- **项目内接口**：`registerDiagnostics(pluginId, {compute, dataVersion})`、`reportDataVersion(pluginId, version)`。canon 插件把它作为项目内服务给别的插件。
- 计算的耗时记进 `status`（project 输出 26），不进读取结果。
- 带来的变化（`computeImpact`）只含内核自己的待处理，按实际模式（revisions 输出 6）。
- `pending` 的结果带待定决策与未处理正文建议的条数；`component-version-unsupported`、`component-unknown` 进提示组（model 输出 16）。

### 服务、视图与 canon 插件

- 新方法：
  - `tellings`、`presence`、`decisions`（取代 `questions`）；
  - `changes` 加性质、计划进展的筛选（model 输出 30）；安放范围 `{after?, through?}` 的两头是分叉的切口与触发处（worldlines 输出 5），随阶段 D 做（A6 实施时定）；
  - `pending` 加模式、组与游标；
  - `openView`、`closeView`、`viewAudit`；
  - `preview` 收还原请求。
- 视图令牌按 project 输出 24 的方法表限制。远程调用方的令牌随调用方实例失效（与独占租约同一条释放路径，`PL/backend/plugin.ts:61–67`）；进程内调用方的令牌随它的插件入口停止失效。
- 阶段 D 之前，安放与读取位置只接受主线：写别的线得到 `ref-invalid`（原因 `line-not-found`）。
- canon 插件（`packages/neuro-book/src/plugins/canon/`）：
  - `shared/contracts.ts` 加这些方法与 `textChanged` 事件，`questions` 的枚举（第 66 行）跟着改；
  - 新增贡献点 `canon.marks`、`canon.diagnostics` 的声明，写法同 `shared/components.ts`；
  - `backend/world-host.ts` 接上正文快照与 `textChanged`、项目标识、`verifyAuthorSource`（宿主给；没有时不注入）。
  - 补一条真实应用的集成测试：经文件服务保存章节，讲述按新正文重新定位、世界版本不变、读取输入摘要变了。评估改订阅文件服务的变更事件，代替 canon 自己再监视一遍活页夹目录（计划审查 P2 第 8 条；目录监视收得到原子替换的改名，已实验核实）。

## 阶段 B 到 F（开工前在这里补细）

- **B 剧情插件：知情、伏笔与目标的数据**（plot/knowledge、foreshadowing；goals 的 Component）
  - 插件骨架 `packages/neuro-book/src/plugins/plot/`：描述符，登记 Component、标注种类、诊断；
  - 剧情 Spec 里标注种类与诊断的 id 写成 `plot.reveal` 这样，登记规则要求前缀是插件 id（components 输出 17、model 的诊断登记），插件 id 是 `nbook.plot` 时应写 `nbook.plot.reveal`：细计划时连同 Spec 一起改（A5 实施时发现）；
  - 纯计算在 `core/`：有效知情（含隐秘目标持有者的推出行）、读者的知情、经历、伏笔阶段；
  - 按视角过滤的视图建在内核的 `openView` 上。
  - 目标的 Component 提到这里，因为隐秘目标的知识点与遮挡在知情与视图里就要用。
  - 这一阶段只在主线上算。
  - 依赖阶段 A。
- **C `nb-time` 与时间说法**（canon/time）：
  - 新包 `packages/nb-time`：历法、说法、网络、查询；
  - 内核加 `when`、`time` 方法与时间的待处理。
  - 依赖阶段 A，与 B 互不依赖。
- **D 世界线**（canon/worldlines）：
  - 内核：线层（线视图、带过去的值、计划跨线、按值比对的更新、常驻与淘汰、计划线、活页夹章讲的线），安放与读取位置的 `line` 与分叉；`changes` 的安放范围 `{after?, through?}`（worldlines 输出 5）；
  - 时间网络按线算；
  - 剧情插件按线视图改造：知情、经历、伏笔、视图、诊断的 `line`，回溯带过去的有效知情（knowledge 输出 4）。
  - 依赖阶段 A、B、C。
- **E 目标的检查、决策的守卫、写作指示、写手的上下文**（plot/goals 的检查、decisions、brief）。依赖阶段 B、D。
- **F 写完以后的检查**（plot/checks）：
  - 窄问题、试读、检查记录、自陈与写作指示的存处（插件的项目记录）；
  - 模型调用经应用的模型角色（[模型角色的后端契约](../../../../../docs/proposals/model-roles-contract.md)），测试用对过合同的替身，真实模型只在 `*.llm.test.ts`。
  - 依赖阶段 E。

## 阶段 B 细计划：剧情插件的知情、伏笔与目标的数据（第二版，2026-11-05）

第一版经快速审查 P3 的 Opus 一份（19 条，全部成立，处理见 [`evidences/plan-review-P3-resolution.txt`](evidences/plan-review-P3-resolution.txt)）改成这一版；omp 那一份等阶段 A 的实现审查跑完再发。

依据：[`plot.knowledge`](../../../../../docs/specs/plot/knowledge.md)、[`plot.foreshadowing`](../../../../../docs/specs/plot/foreshadowing.md)、[`plot.goals`](../../../../../docs/specs/plot/goals.md) 的 Component 与隐秘目标部分。线做成参数（`view.line`，阶段 B 恒为 `main`），诊断稳定键的 `line` 取它；回溯带过去的知情（knowledge 输出 4）与伏笔按线视图取的那一半随阶段 D；目标的三项检查与目标表随阶段 E；“本章涉及的知识点”（knowledge 输出 10）随阶段 E 的简报；`objectTouchedInText` 要窄问题，随阶段 F。每一片只声明这一片同时给出计算的诊断：声明了却没登记计算的诊断会让每次读待处理都标“不完整”。

### B0 内核要补的（nb-canon 与 canon 插件）

- **视图不漏上限之后的值**（P3 第 5 条，阶段 A 视图的问题）：带令牌的 `entry`、`render` 去掉 `upcoming`（之后才启用的命名空间连同值）。补进 `views.test.ts`。
- **项目内的快照**：`canonDiagnosticsKey` 扩成 `canonProjectKey`（按调用方）。`snapshot()` 返回 `{view: CanonReadView, viewed(token), stamp}` 或失败（`world-locked`、`stopping`）：三样都建在同一份世界与同一份冻结的正文快照上（讲述定位器按当时的正文与章序复制），之后的发布与改稿不影响它；调用方在一次读取里用完就丢，不跨调用复用。`openView`、`closeView` 与诊断的登记也在这个接口上；门面记下调用方开的视图，`release` 时逐个关掉。内核令牌只在项目进程里流转，不交给剧情插件的远程调用方（否则拿它直接调 canon 就绕过了过滤）。
- **`CanonReadView` 补齐**：`line`；`stamp`（读取输入的摘要，插件的缓存键）；`origins(address, position, mode)`；`outcome(change)`；`progress(plan, position)`；`eventKey(change, mode)` 与 `placementKey(placement, mode)`（与引擎的事件先后相同：按计划模式时已写章上的计划按“章序加 0.5”；同一安放上出场排在变更之前），`compareKeys(a, b)`；`fields(namespace)` 与 `markType(kind)`（登记的只读部分：字段的种类与 `targets`、标注种类的 `refs`，视图过滤找引用位置用）。差分测试加一项：两个引擎给每条变更的排序键相同。
- **审计改上游**（P3 第 15 条）：内核视图审计的条目加可选的 `kind: "denied" | "placeholder"` 与 `blocked`（被挡的对象）；`canonProjectKey.audit(token, entry)` 让剧情插件把占位写进同一份最近 500 条；`viewAudit` 加按看的人筛；它的游标改成按单调的序号，不绑读取输入（审计不是读取输入）。project 输出 24 的审计形状补一句（待确认清单记一行）。
- **公开的辅助**：`@notnotype/nb-canon/node` 导出由 `World` 与正文表建 `CanonReadView` 的函数（测试与别的宿主用）和按“读取输入摘要、查询参数、列表”分页的函数（canon 与剧情共用一套游标）。

### 插件的形状：`packages/neuro-book/src/plugins/plot/`

- 内置插件 `nbook.plot`，只有项目入口；登记进 `manifest.ts` 的 `productPlugins`。
- `core/`：纯 TS，只引 `@notnotype/nb-canon/schema` 的类型与 `CanonReadView`；每个计算是 `(view, …) => 结果`。一次视图上的索引（每人在场与 `presentLearns` 的变更、每人 `know.知情` 的逐行历史、伏笔的节点）按视图对象加模式与位置缓存，知情、传话链、视图、伏笔都查索引（P3 第 11 条）。B2 实施时定：不按 `view.stamp.inputDigest` 跨视图缓存，摘要里只有世界的版本、不认是哪一份世界，同一进程里两份世界版本相同时会串用（测试里撞上了）；跨读取的缓存到 B5 量过再说。
- 跨插件的运行时导入只能指向对方的 `shared/contracts.ts`（应用的架构测试）：canon 的项目内接口 `canonProjectKey` 与贡献点的名字都放在 canon 的 `shared/contracts.ts`。
- `shared/declarations.ts`：Component、标注种类与诊断的顶层声明。
- `backend/plugin.ts`：项目入口，经 `canonProjectKey` 登记诊断的计算、取快照；提供远程合同 `nbook.plot/world`。
- **id 改成带插件前缀**：按一份精确的清单改（五个 Component、三种标注、十四个诊断：`plot.point` → `nbook.plot.point` 这样；capability id 如 `plot.knowledge` 与 Spec 之间的链接不动），不用前缀批量替换；改完跑 `docs:check` 与 `governance:check`（P3 第 16 条）。

### `core/knowledge.ts`：知情（含隐秘目标）

- **逐行历史**：对一个人只取一次 `origins({entry: 人, path: "know.知情"})`，按相邻两步的列表比较每一行：这一行前后不同才算这一行的一次变化（加、去、子字段改、整段替换都这样判；整段替换写出相同的行不算变化）。这样同一列表里别的行的增删不会混进来（P3 第 1 条）。
- **有效知情** `effectiveKnowing(index, 人, 知识点, at)`：`at` 是读取位置或 `{before: 变更 id}`（后者用于传话链）。候选事件三种：这一行的显式变化（键是那条变更的 `eventKey`）、在场的 `presentLearns`（`cast` 里 `role: present`、记了 `who`；模式与套上同 `presence`；`degree` 缺省 `knows`，`怎么知道` 是 `witnessed`）、隐秘目标（目标条目带 `隐秘` 指向这个知识点、持有者是目标当前的父条目；键是目标出场的 `placementKey`，没有出场就是初值；`怎么知道` 记 `other`）。取键最大的一个；同一条变更里显式的优先；显式去掉一行回到“没有行”。条目树不随位置变，挪父条目以后按新的持有者算（Spec 没有写，在测试里写明）。
- **两项诊断**（B2 声明并登记）：`relayBroken`：读取位置上的每一行有效知情，`怎么知道` 是 `told`、`谁告诉的` 是 T（马甲按 `sameAs` 归本体），取“这一行所在的变更”（最近一次让 `程度`、`怎么知道` 或 `谁告诉的` 变化的那条）之前 T 的有效知情；只查读取位置上的有效行，不查被覆盖的历史行。`knowingIncomplete`：输出 2 的三种。诊断按传入的模式算。
- **读者** `readerKnowing(view, 知识点, P)` 与 `firstReveal(view, 知识点)`：按 `tellings({until: P, mark: reveal})`。

### `core/viewpoint.ts`：按视角过滤的视图（含经历与隐秘目标）

- 剧情插件为看的人 V 经 `canonProjectKey.openView` 开一张内核视图，返回自己的句柄给远程调用方；按调用方记下，调用方释放时关掉（P3 第 8 条）。一次远程调用取一份快照，过滤只用这一份。
- **读一个条目**：内核带令牌的读取结果去掉 `know`（V 自己的除外）与 `upcoming`，加 `children`（上限之前已出场、V 读得到的子条目，不列保密以上的知识点）；字段与标注里指向 V 读不到的知识点的引用换占位（引用位置按 `view.fields` 与 `view.markType` 找）。
- **读一个知识点**：按保密档与 V 的有效知情给内容、占位或 V 以为的那句；隐秘目标随它的知识点处理（读不到时目标也是占位、按名字找不到、读持有者时不列）。
- **按名字找**：去掉 V 读不到的知识点与隐秘目标。
- **经历**：在场的变更（只给 id、安放、描述、同场的人、这条让 V 的知情起的变化；同场者用了马甲而 V 不知道揭穿它的知识点时只给马甲），带 `uncast`。
- **知情**：`viewpoint.knowing(谁)`：问 V 自己给全部有效知情；问别人只给 V 自己也 `knows`、`suspects` 的、`common` 或 `trade` 的那几行（P3 第 12 条）。
- 占位与拒绝经 `canonProjectKey.audit` 写进内核的审计（`kind`、`blocked`）。

### `core/foreshadowing.ts`：伏笔

- 节点：生效的正文讲述上的 `node`；悬念答案上的 `reveal`（`hint` 算呼应、`explicit` 算回收）。计划的节点：讲述所在对象是计划、讲述不是正文的（细纲等）；按计划安放的章计。别的非正文讲述上的节点忽略。
- 继承：兑现计划的已写变更**自己的讲述上没有同一伏笔的节点时**，继承计划的节点，位置是它第一处生效的正文讲述；没有就不算数并给 `nodeWithoutTelling`（P3 第 13 条）。
- 阶段按读过的节点取最高一级；意图为放弃时另显示。
- 诊断（B4 声明并登记）：输出 6、7 除 `objectTouchedInText` 外各项。`objectTouched`：按章比较，安放在最早的埋下节点所在章之后（同章不算）、最后一次回收所在章之前的生效、套上（`outcome`）的变更，补丁改了物件条目的状态。`plannedNodeMissing` 用 `progress(计划, 第 N 章末尾)`。
- 账本：每个伏笔的阶段、节点、计划的节点、最后一次被提到的章、物件与最近一次被改的变更，可筛。

### `core/goals.ts`

- 两个 Component 的声明；冲突的对称读取（goals 输出 2）。隐秘目标在 B2、B3 里处理。

### 远程合同 `nbook.plot/world`（读，项目实例提供）

- `knowing`（人、知识点或全部、位置、模式）、`reader`（知识点、讲述位置）、`experience`（人、位置）、`ledger`（筛选）、`conflicts`（目标）；`openViewpoint`（看的人、上限、用途；线恒为主线）、`viewpoint.entry`、`viewpoint.lookup`、`viewpoint.experience`、`viewpoint.knowing`、`closeViewpoint`。审计用 canon 的 `viewAudit`。失败通道同 canon（`canon` 业务失败码带详情）；列表用 B0 的分页辅助。

### 切片（阶段 B）

0. **B0 内核的补充**：上面一节；nb-canon 测试、差分测试、canon 插件测试。
1. **B1 插件骨架与声明**：改剧情 Spec 的 id（精确清单）；插件目录、描述符、Component 与标注种类的声明（诊断随 B2、B4）；项目入口能激活、能取快照。
2. **B2 知情与读者**：逐行历史与索引、有效知情（含隐秘目标）、读者、两项诊断，`knowing`、`reader` 两个读取。
3. **B3 经历与按视角的视图**：经历、视图的方法表与过滤（含隐秘目标）、审计、句柄的寿命；远程用例一条（含调用方断开后句柄失效、内核里不留视图）。
4. **B4 伏笔**：节点、继承、阶段、诊断、账本；远程用例一条。
5. **B5 冲突的对称读取**，与规模测量：规模脚本加一组剧情形状（200 人、500 个知识点、每章 3 条带 `presentLearns` 的在场变更、每章 1 条 `told` 的行、20 个伏笔），量“读待处理时剧情插件全部诊断的耗时”（预算 200 毫秒，超过时 `status` 本来就会标）与“视图读一个挂了 20 个保密知识点的条目”（20 毫秒）。

测试分两层（P3 第 9 条）：`core/` 的纯计算用 B0 导出的“由 `World` 与正文表建视图”的函数；视图、审计、诊断管线与缓存键用进程内的 `WorldService`（nb-canon node 入口）经 `canonProjectKey` 的同一套实现测；子进程只留远程合同与断开释放。

### 验收映射（阶段 B）

| Spec 条目 | 测试 | 切片 |
|---|---|---|
| project 输出 24（视图不漏上限之后的值、审计的种类与被挡的对象） | `nb-canon/tests/views.test.ts` | B0 |
| knowledge 输出 1、2、3、5、6、7，场景 1（前半）、3、4、5、7；goals 术语里的隐秘目标与 knowledge 输出 3 的推出行 | `plot/core/knowledge.test.ts`（含“中间给别的知识点加行”“整段替换写出相同的行”“挪父条目”） | B2 |
| knowledge 输出 8、9，场景 1（视图与经历）、2；隐秘目标在视图里 | `plot/core/viewpoint.test.ts`；远程用例一条 | B3 |
| foreshadowing 输出 1 到 4、6、7（除 `objectTouchedInText`）、8，场景 1 到 4 | `plot/core/foreshadowing.test.ts`；远程用例一条 | B4 |
| goals 输出 1、2，场景 3 | `plot/core/goals.test.ts` | B5 |

### 阶段 B 的风险

- 排序键要与两个引擎完全一致：差分测试比对。
- 剧情的诊断都在一次读待处理里同步算：按索引算，B5 量剧情形状的规模；超预算时先缓存索引（按读取输入摘要），再找开发者。

## Spec 与文档改动

- 计划审查 P1 推过来、已改在分支上（1c11c6529）：
  - 作者授权：`binds` 由内核先逐字比、宿主只验签名；还原的 `request` 摘要的对象与 `revert` 转换；补偿不受 `source-not-writable` 限制；
  - 修订存 `refs`；
  - 带来的变化不含插件的诊断；
  - 视图按方法的限制；
  - `pending` 带计数；
  - Component 的提示进提示组。
- 实现时再发现 Spec 写不通的，先改 Spec（在分支上）再改代码，并在 Task 里记一行。
- `packages/nb-canon/README.md`、`AGENTS.md`：模块表加 references、tellings、marks、diagnostics-registry、authorization、decisions。

## 切片（阶段 A）

每片一个提交。提交前：
- nb-canon 包目录跑 `bun test` 与 `bun run typecheck`；
- 应用包跑 `bun test src/plugins/canon/` 与 `bun run typecheck`；
- 差分测试（`tests/differential.test.ts`）每片都要过；
- 改了形状的片顺带跑 `bun scripts/scale.ts`（nb-canon，只构造不测时也要能编译）。

1. **A1 格式 2 与决策改名**：
   - schema（含讲述的新形状与 `invalid-telling`）、ids、log 的格式；
   - `diffValues` 按路径声明拆数组；
   - `question` 改成 `decision`（形状、名字、`not-deletable`），状态表留到 A7；
   - 样本转换与回放、node-log 测试、`scripts/scale.ts` 跟着改。
2. **A2 正文快照与读取输入**：服务持有正文快照、`textChanged`、读取输入的摘要、游标改成“摘要加偏移”、`canonicalJson`。
3. **A3 引用与替换**：`references.ts` 的引用位置、修订的 `refs`、依赖与改动记录读 `refs`、`ref`、`keyedBy`；替换掉三张键表。临时 id 只在引用位置上换：引用位置的遍历同时供“列出引用”与“替换”用，替换另加对象自己的 id、地址路径段、以地址为键的 `retold` 与 `initBasis`、诊断稳定键里的对象；不在这些位置上的 `tmp:` 文字原样存下（components 输出 18）。A3 起初按“与临时 id 完全相同的字符串都换”实现，与 Spec 不符，计划审查 P2 第 4 条指出后改正。
3b. **A3b 列表元素的语义档**（从 A3 拆出）：两个引擎的语义档事件与归纳按元素子字段的地址记，视图按同样的规则给值。
4. **A4 讲述**：发生点、失联、读过的讲述、`tellings` 方法。（讲述 id 的分配与 observe 在 A1 做了：它和 `told[id]` 的修订路径是同一件事。）
5. **A5 标注种类与诊断的登记**：`canon.marks`、`canon.diagnostics` 的声明与校验，三张版本表；标注挂在讲述、剧情变更、决策上，载荷校验与只读规则。
6. **A6 参与者、在场、叙述**：`cast`、`presence`、`nature: narration`、本章涉及的条目、`changes` 的新筛选。
7. **A7 决策与作者授权**：状态表、转换与字段去留、建议、挂的对象（含诊断键）、授权与校验、还原的授权与预览。
8. **A8 诊断与待处理**：
   - `Engine.pending(position, mode)`；
   - `CanonReadView`、服务层的诊断计算与缓存、截断与已处理、全序与提示组、`pending` 的组与分页、计数、`status` 的耗时。
9. **A9 视图与插件接线**：`openView` 与方法表、远程合同与浏览器客户端、canon 插件的两个新贡献点、正文快照与授权端口的接线，规模测量重跑。

A9 之后做一次实现审查（后端，按 reviewing Skill：omp 默认模型；不等它，进入阶段 B 的计划），报告回来后处理，修正单独提交。

## 验收映射（阶段 A）

| Spec 条目 | 测试 | 切片 |
|---|---|---|
| revisions 输入的路径与修订形状 | `tests/core.test.ts` 补往返用例 | A1 |
| project 输出 2（格式 2、格式 1 只读） | `tests/node-log.test.ts` | A1 |
| revisions 输出 20（决策不可删） | `tests/revisions.test.ts` | A1 |
| model 输出 36、project 输出 19、25 | `tests/service.test.ts` 补用例 | A2 |
| components 输出 18、19、场景 5；revisions 输出 12、14 | `tests/references.test.ts`（新）与 `tests/revisions.test.ts` 补用例 | A3 |
| components 输出 20（元素的语义档子字段） | `tests/references.test.ts` 的“输出 20”一组；`tests/differential.test.ts` 加元素子字段的事件、去掉再加回 | A3b |
| model 输出 24 到 27 | `tests/tellings.test.ts`（新） | A4 |
| model 场景 7（含提示组） | `tests/tellings.test.ts` | A8 补齐 |
| model 输出 28、components 输出 17、场景 6；诊断的登记 | `tests/marks.test.ts`（新） | A5 |
| model 输出 20、29、30、场景 8 | `tests/cast.test.ts`（新；在场要经世界服务读） | A6 |
| model 输出 31 到 33、状态表、场景 9；revisions 输出 21、场景 7 | `tests/decisions.test.ts`（新） | A7 |
| model 输出 16、34、35、场景 10；revisions 输出 6 | `tests/diagnostics.test.ts`（新） | A8 |
| project 输出 24、26、27、场景 8、9 | `tests/service.test.ts` 补用例；`canon.test.ts` 补视图的远程用例 | A9 |
| 不变量：增量与参照一致（两种模式） | `tests/differential.test.ts`：随机序列加讲述、标注、参与者与决策的修改 | 每片 |

测试名照现有写法引用编号（`canon.model 场景 4：…`、`（输出 7、8）`）。

## 验证

- 每片：见“切片”开头的命令。
- A9 之后：
  - `bun run test:affected --typecheck`；
  - 样本回放（`tests/sample.test.ts`）；
  - 规模测量：在应用包目录跑 `bun scripts/perf/canon-scale.ts`，按 project 输出 14 对照。正文快照与讲述定位要量“改一章后第一次读”与“随机读”两项。
  - 测量前看 `uptime`，不与 omp 审查同时跑。
- 不跑 e2e：阶段 A 不改界面。

## 不做与风险

- 不做：界面（t16、t31）；Agent 工具（t20）；写作流程（t19）；合并进 master。
- **讲述定位与正文快照的开销**：A4 写一个三百万字规模的基准；超出 project 输出 14 的预算时，记进 Task，再找开发者。
- **诊断同步计算阻塞**：Spec 已接受没有 CPU 上限。A8 的测试用一个故意慢的诊断，验证耗时进 `status`、读取照常返回。
- **作者来源的签发方还没有**：宿主侧的签发属于 Agent 工具（t20）。阶段 A 只做内核的比对与校验端口，导出 `authorizationBinds` 供签发方用。
- **决策改名的牵连**：A1 先用 `rg` 列出 `question` 的全部用处（内核、插件、样本、`scripts/scale.ts`），一次改完。

## 阶段 C 细计划：`nb-time` 与时间说法（第二版，2026-11-05）

依据：[`canon.time`](../../../../../docs/specs/canon/time.md)（输出 1 到 5、7 到 13；输出 6 回溯分叉的时间随阶段 D），[`canon.model`](../../../../../docs/specs/canon/model.md) 输入表的 `when`、输出 2、16、25、36，[`canon.project`](../../../../../docs/specs/canon/project.md) 方法表的 `time`、输入的历法与模糊词表、输出 14、18、24，[`canon.revisions`](../../../../../docs/specs/canon/revisions.md) 输出 3、6、18；ADR 0043。第一版对照了只拿到目标的 Sonnet 独立设计（[`evidences/time-independent-design.txt`](evidences/time-independent-design.txt)），经计划审查 P4 的 Opus 一份（27 条：重要 17、建议 10，[`evidences/plan-review-P4-opus.txt`](evidences/plan-review-P4-opus.txt)，处理见 [`evidences/plan-review-P4-resolution.txt`](evidences/plan-review-P4-resolution.txt)）改成这一版；omp 那一份等 I2 跑完再发（同一时间只跑一个 omp），快速审查：不等它开工。依赖阶段 A，与阶段 B 互不依赖。

### 技术选型

- 时间约束网络：自己写。没有能给出“依据”与“打架的环”的成熟库；算法是标准的差分约束（STN）。否决图论库（给不出依据路径与环，nb-time 又要求没有运行时依赖）。
- 日期运算：自己写。Temporal 与日期库只有公历一类；内置公历用 JS `Date.UTC` 对拍。
- 优先队列：nb-time 里写一个二叉堆。

### `packages/nb-time`（新包，无运行时依赖，前后端共用）

- `calendar.ts`：`validateCalendar(raw)`（输出 13，另加：闰年周期即各 `every` 的最小公倍数乘月数不超过 200 万；一年最长的 tick 数乘 (10^7 + 1) 小于 2^53，纪内年份换成绝对年份后也在 ±10^7 之内）；`compileCalendar`：周期表与前缀和，`daysBefore(year)` 常数时间，`L_min`、`L_max` 用周期内循环窗口的最小、最大和，按余数缓存；`dateRange(compiled, date)` 给闭区间 tick（年起连续给到哪一级；不给纪时年是绝对年份；时段 `to` 不含、`to < from` 跨夜、相等整整一天；`approx` 按给到的最细一级两侧对称放宽，分钟与时段用小时那一级）；`GREGORIAN`（天文纪年，月 `m1` 到 `m12`，纪 `ad` 起于 1，时段为空）。
- `fuzzy.ts`：`validateFuzzy(raw, calendar)`（不合法的项作废、诊断 `fuzzy-word-invalid`）；`DEFAULT_FUZZY`（内置词表与 `approx` 的缺省放宽量：几天 2 到 9 天、几个月 2 到 11 个月、几年 2 到 9 年、不久 0 到 7 天、多年 5 年以上；`approx` 年 1、月 1、日 1、时 1；作品设置给了的项覆盖它）；`resolveGap`。
- `statements.ts`：说法的 TS 类型（与 nb-canon 的 TypeBox schema 同形，类型断言测试守住）；`validateStatements(statements, calendar)`：只看说法自己的规则（日期各级连续、单位不比历法细、`min ≤ max`、`of` 不是自己），nb-canon 的写入校验与 nb-story 共用（Spec 的公开接口“说法的校验”）；`lowerStatement(statement, compiled, fuzzy)` → 约束模板（端点写成 `{event: 自己 | of 的 id | 出生(who), edge}`）或 `invalid`（原因：月、纪、时段不在，日子超出，单位比历法细，词不在）。降约束只看说法本身、历法与词表：结果按（说法的规范 JSON、历法摘要、词表摘要）缓存；端点在组网时才解析，所以出生事件、`of` 指向的变更变了不会用到旧结果（P4 第 2 条）。
- `network.ts`：`solveNetwork({events, constraints, extra?})`。`events` 每项 `{id, birthOf?}`；组网时解析端点：`of` 不在事件集里的（撤销、待定、叙述、实际模式下的计划、上限之后的、所在章已删）这条说法不进网络、不报（那件事这时不算发生）；`of` 指向的变更不存在了（还原以后）报 `time-invalid`（原因 `target-missing`）；`who` 写成马甲的按 `sameAs` 归到本体（P4 第 25 条）；一个人在事件集里有几件出生事件，关于他的 `age` 说法不进网络、报 `time-invalid`（原因 `birth-ambiguous`），没有出生事件的不进网络、不报（输出 12）。节点：每件事的起点、有 `lasts` 时另有终点，与每个分量自己的元年副本；`extra` 留给阶段 D 的回溯点与常量约束。**分量只按事件之间的说法划**（日期说法是单个事件对元年的常量约束，不把分量连起来）。每个分量：队列版 Bellman-Ford 求可行与势，负环检测按“每做 V 次松弛沿前驱指针查一次环”；有环就取出环、标掉环上的说法再求，每个分量最多取 20 个环（最多重跑 21 次，只在有环的分量上）；有环的分量里事件都“不可确定”（输出 2 字面）。无环的分量按需求范围：重赋权后从元年（没有锚的分量用分量里安放最早的事件作原点，范围是相对的、结果带 `relativeTo`）正反两次 Dijkstra；依据在拿到距离后走紧边（`d(u) + w = d(v)`，按跳数、约束序优先），最多 20 条、另给总数。`between(a, b)`：同分量按需一次 Dijkstra；不同分量、两边都有锚时由两边的范围相减；否则“没有关系”。
- `mismatch.ts`：输出 5，**每件“安放得比时间晚”的事 B 一项**：在 B 之前安放、按时间一定比 B 晚的事 A，有一件就成一项；项里列 B、代表性的 A（最早时间最大的那件）、各自的范围与依据，与这样的 A 共几件。两类判据：(a) 字面的范围判据 `B 的最晚 < A 的最早`（无穷端照常参与：`[2000, +∞)` 对 `(-∞, 1990]` 成立）；(b) 说法直接给出的先后：`after`（任一端，`lo > 0`）说 E 晚于 X 的起点，`before`（只认 `edge: start`，`lo > 0`）说 E 早于 X 的起点，与安放相反。按安放排序扫一遍，前缀最早时间的最大值给代表，按最早时间排的树状数组数件数，O(N log N)。项的键是 B 的 id（稳定）。多跳的非严格先后不查。有环分量里的事不参与；没有锚的分量各自一个坐标系。
- `queries.ts`：事件；一章（安放在这一章的事件合起来：有锚的合成一个绝对范围，没有锚的另给件数）；一段时间里一定与可能发生的（分页由 nb-canon 做）；两件事相差多久；年龄（输出 12，加 `atLeast`（上界无穷）与 `birth-ambiguous`）；按纪年月日逐级浏览（每级最多 200 个子单位，叶子的事件列表分页）；`calendar`（历法简表与词表）。
- `format.ts`：按精度格式化，同时返回结构化的 `parts`。

### `packages/nb-canon` 的接入

- `core/schema.ts`：剧情变更加 `when?: Statement[]`；`basis` 存成 `{kind: "telling", id} | {kind: "author"} | {kind: "inferred", note?}`，写入时还可以写 `{kind: "telling", told: 下标}` 指这条变更在这次请求里的 `told` 的第几条，`fillDefaults` 发完讲述 id 以后换成 id（P4 第 3 条：同一请求里新写的讲述还没有 id）；`lasts` 写成 `{kind: "lasts", lasts: 间隔}`；写入草稿里前史的 `order` 可以不给。`./schema` 子路径仍只依赖 TypeBox。
- `world/references.ts`：`when[].of`、`when[].who` 进引用位置（还原依赖与改动记录按引用成立），标 `checked: false`，存在性由时间的校验报 `invalid-time`。
- 写入校验（输出 9，只查新写或改过的说法，原样留着的不查）：`validateStatements`；`of` 指向存在、不是叙述的剧情变更，`who` 指向存在的条目；`basis` 的讲述在这条变更的 `told` 里；叙述不能有说法。**不再在写入时拒“一个人几件出生事件”**：撤销后重写、计划与兑现它的已写变更都带 `birth` 是正常流程，按事件集算，几件时报 `birth-ambiguous`（P4 第 12 条，改 Spec）。
- 前史的先后（输出 7，P4 第 7 条）：先把整份请求套上（没给 `order` 的前史变更暂记在前史最后），在新数据上组一次时间网络（降约束容得下没过校验的说法：不成立的就不进网络），再补 `order`：插在按 `order` 排的前史里、最后一件“有绝对的最早时间且不晚于它”的前史变更之后；它自己没有绝对的最早时间，或前面没有可比的，放在前史最后；`order` 取相邻两个（含前史的核对点与出场的安放）的中数，算出的中数不严格落在两者之间（浮点数用尽）时拒收，要求显式给 `order`。补完再建引擎。
- `time/`（内核的时间层）：`timeNetwork(data, time, mode)`：事件集（实际模式：生效、不是叙述的已写变更；按计划模式再加全书末尾进展为“未兑现”的生效计划，含未排章的，P4 第 18 条）→ 降约束（按说法内容缓存）→ `solveNetwork`。网络按 `WorldData` 对象缓存（发布时为新数据建的网，新世界直接用；`withOptions` 不换数据就不作废，P4 第 15 条），键加历法、词表摘要与模式；对不上（要章序）与待处理的截取每次读时从网络算（O(N log N)）。
- `WorldOptions.time?: {calendar, fuzzy, calendarDigest, fuzzyDigest}`；`setTime` 像 `setRegistries` 一样换一份世界、加输入代次；读取输入的摘要带两个摘要（model 输出 36 改成内容摘要，P4 第 11 条）。**最近一次合法的历法持久化**在 `.nbook/world/calendar.json`（世界宿主写；设置不合法时用它，从来没有合法的才用公历；P4 第 8 条，记待确认清单）。
- 待处理：`time-conflict`（每个环一项，键是环上说法的有序列表）、`time-invalid`（每条说法一项，键是变更 id、说法的规范 JSON 与原因）、`time-placement-mismatch`（每件 B 一项，键是 B 的 id）进 `World.pending` 这一层，不进两个引擎；说法的键按内容不按下标，所以在前面插一条说法不会让别的项“消失又出现”（P4 第 16 条）。排序位置按 model 输出 16，种类在“世界线”之后、“插件的诊断”之前。读待处理时**随读取位置截取**：所涉事件都安放在读取位置之前的才列（网络整条线算一次，只筛项）。发布“带来的变化”里时间几种的增减按整条线算、不截取（这样在前面章写的说法引起的、牵涉后面章的问题也进回执，P4 第 20 条）。为新数据建网的条件（P4 第 4 条）：这次的操作碰到“与时间相关的对象”——改前或改后带 `when` 的变更、被某条说法的 `of` 指到的变更、被 `who` 指到的条目——或这是一次章序调整（`reorder`）；不碰的直接沿用旧网络的结果。
- 诊断：`calendar-invalid`（写明用的是哪一份：上一个合法的或公历）、`fuzzy-word-invalid` 由 `setTime` 整份重算，设置修好以后消失（P4 第 23 条）。
- 服务的 `time(query, line, mode, cursor?, limit?)`：列表结果按 project 输出 18 分页（`pageOf`），依据最多 20 条另给总数（P4 第 17 条）；带令牌时网络只用安放在上限之前的事件，按（模式、上限）缓存最多 8 份、不同令牌同一上限共用；查询点名上限之后的事件或位置得到 `view-denied` 并记审计（P4 第 19 条）。`CanonReadView` 加同步的 `time(query, mode)`。

### canon 插件

- 设置：声明两个配置项（键名按仓库配置项的约定，例如 `nbook.canon/calendar`、`nbook.canon/fuzzyWords`），**只允许项目层**（历法是一部作品的，P4 第 10 条）；schema 放宽为对象，合法性由 nb-time 查。canon 的项目入口依赖 `settingsKey`，打开世界时把当前值作为初值传入；打开期间到达的设置变化按 I1b 第 16 条的做法在打开后比对补上（P4 第 9 条）。
- 远程合同加 `time`（查询的种类联合，带视图令牌与游标）。

### Spec 与文档改动（在分支上，“补充已批准的 Spec”，各记待确认清单）

- time.md：输入表定 `basis`（含写入时的 `told` 下标）、`lasts` 的形状，日期各级连续、不给纪时是绝对年份、时段 `to` 不含、`approx` 两侧对称、内置词表与放宽量；输出 1 按计划模式加的是全书末尾未兑现的计划（含未排章）；输出 2 分量只按事件之间的说法划；输出 5 写清“每件安放得太晚的事一项”、判据 (b)、多跳的不查；输出 8 加 `calendar`、分页与依据上限；输出 9 改成不在写入时拒几件出生事件、加 `of` 不是自己与 `basis` 的讲述在 `told` 里；输出 12 加 `atLeast` 与 `birth-ambiguous`；输出 13 加两条上限；**验收 4 改成“把第 5 章那件挪进前史后消失”**（原文挪第 3 章那件，按输出 5 不会消失，P4 第 13 条）；“状态与转换”的缓存键改成内容摘要；新增：时间的待处理随读取位置截取而带来的变化不截取、带令牌的时间查询只用上限之前的事件、最近一次合法的历法持久化。
- model.md 输出 36 的读取输入摘要改成历法与词表的内容摘要；输出 25 补写入时讲述可以按 `told` 下标被说法引用。
- project.md 输出 24 补带令牌的 `time`；revisions.md 输入写明前史的 `order` 可以不给与插入规则。
- `docs/modules/monorepo-boundaries.md`、根 `AGENTS.md` 的包地图登记 `nb-time`；nb-canon 的运行时依赖加 `@notnotype/nb-time`（time.md 已批准“nb-canon 用它”）；nb-canon 的架构测试允许它（`./schema` 子路径仍只依赖 TypeBox）。

### 切片（阶段 C）

0. **C0 Spec 补充**：上面一节。`docs:check`、`governance:check`。
1. **C1 历法**：`calendar.ts` 与 `format.ts` 的拆分部分；包骨架与登记。测试：输出 13 每一项；公历日序号与 `Date.UTC` 在 -4000 到 4000 年随机对拍；`L_min`、`L_max` 与按周期暴力枚举对拍；验收 1 的自定义历法。
2. **C2 词表与说法**：`fuzzy.ts`、`statements.ts`。测试：每种说法的约束模板、每种不成立的原因、验收 1 的改名照常与删月后不成立、内置词表被设置覆盖。
3. **C3 网络**：`network.ts`。测试：小网络与 Floyd-Warshall 参照对拍（随机种子，范围与可行逐字相同）；验收 3；环的确定性；端点解析的几种（不是事件、不存在、马甲、几件出生事件）；压力：反向次序的长链与带环的长链（超过 300 毫秒就换算法，接口不变）。
4. **C4 查询、对不上与格式化**：`queries.ts`、`mismatch.ts`、`format.ts`。测试：验收 2、6；输出 5 的两类判据、无穷端、每件一项与件数；验收 4（改过的）。
5. **C5 内核的数据与校验**：schema、引用、写入校验、`told` 下标换成讲述 id、前史的先后。测试：`nb-canon/tests/time.test.ts`、`revisions.test.ts`。
6. **C6 内核的时间层与待处理**：`time/`、`WorldOptions.time`、待处理三种的键与截取、带来的变化与建网条件（含章序调整、删光说法）。测试：`time.test.ts`。
7. **C7 服务、远程合同、设置与规模**：服务与带令牌的 `time`、分页、`CanonReadView.time`、历法的持久化、canon 插件的设置与远程合同。规模脚本 `canon-scale.ts` 加说法：三成的已写变更带一到两条，形状按 5 成日期（到日）、3 成“在前一件之后一到三天”、1 成 `lasts`、1 成年龄；**分开量**发布一次记账（预算 100 毫秒，含为新数据建网）与之后第一次时间查询（预算 1 秒），再量同一版本上的查询（20 毫秒）。测试：canon 插件真实项目子进程里改作品设置后范围变；视图里不漏上限之后的说法。

### 验收映射（阶段 C）

| Spec 条目 | 测试 | 切片 |
|---|---|---|
| time 输出 13，验收 1 的历法部分 | `nb-time/tests/calendar.test.ts` | C1 |
| time 输入表、输出 3、4、验收 1 的说法部分 | `nb-time/tests/statements.test.ts` | C2 |
| time 输出 1、2、10，验收 3 | `nb-time/tests/network.test.ts`（含参照实现对拍） | C3 |
| time 输出 5、8、12，验收 2、4、6 | `nb-time/tests/queries.test.ts` | C4 |
| time 输出 7、9；revisions 输出 3、12 的时间部分；model 输出 25 的 `told` 下标 | `nb-canon/tests/time.test.ts`、`revisions.test.ts` | C5 |
| model 输出 16 的时间几种、排序与截取；revisions 输出 6 | `nb-canon/tests/time.test.ts` | C6 |
| time 输出 11；project 输出 18、24 的 `time`；作品设置与持久化的历法 | 规模脚本；`nb-canon/tests/views.test.ts`；`canon.test.ts` | C7 |

### 阶段 C 的风险

- 带说法的发布多建一次网，可能越过发布 100 毫秒：C7 分开实测；降约束已按内容缓存，超了就找开发者（“只重算被碰到的分量”要新的增量求解，不是现成的后备，P4 omp 第 14 条）。
- Bellman-Ford 最坏 O(VE)：压力测试兜底。
- 年龄与以年、月为单位的间隔用不看起点的全局上下界，范围比按具体日期推算宽（Spec 的取舍，验收 2 就是这样）。
- 截取、判据 (b)、每件一项、计划模式的事件集、出生事件不在写入时拒、历法持久化都写进 Spec 并记待确认清单；开发者改判时只动 nb-time 或时间层的一两处与 Spec。

## 阶段 D 细计划：世界线（第二版，2026-11-05）

依据：[`canon.worldlines`](../../../../../docs/specs/canon/worldlines.md) 全文（在内核分支上）；`canon.time` 输出 6 与验收 5；`plot.knowledge` 输出 4、8 与验收 6；`canon.project` 方法表（`changes`、`lines`）与输出 14、24、26；`canon.model` 输出 2、16、20、22；`canon.revisions` 输出 4、5、6、8、9、11、12；`canon.components` 输出 18 的引用位置与字段的 `carry`；ADR 0042。依赖阶段 A、B、C。

第一版对照了只拿到目标的 Sonnet 独立设计（[`evidences/worldlines-independent-design.txt`](evidences/worldlines-independent-design.txt)）。经计划审查 P5 的 Opus 一份（24 条：阻断 1、重要 14、建议 9，[`evidences/plan-review-P5-opus.txt`](evidences/plan-review-P5-opus.txt)，处理见 [`evidences/plan-review-P5-resolution.txt`](evidences/plan-review-P5-resolution.txt)）改成这一版。omp 那一份在后台，快速审查，不等它开工。

从独立设计采纳的：
- 线层是“数据到引擎输入”的纯投影，作者的记录与“记录加合成事件”分开；
- 先做零行为变化的接缝；
- 日志不升格式，主线的 `line` 省略；
- 另写一份参照投影做差分，并经真实发布路径与重放对比。

没采纳的：
- 保温线惰性追平：根因与预览要求发布时就算出受影响的线；
- 新的 `carry-failed` 待处理：并进“带过去的值不完整”。

### Spec 的补充与解读（DS 片，在分支上，各记待确认清单）

1. **带过去的值只按实际模式取**（输出 6 原文是“读取的模式与这次读取相同”）。
   - 理由：按计划模式带过去，每建一条子线都要在父线上多算一次按计划模式的覆盖层（约 1 秒），第一版不做。
   - 后果：按计划模式读子线时，带过去的值仍是实际模式的值；父线上切口与触发处之间的计划不带过去（按计划模式读子线时，回溯者不知道那些计划里会知道的事）。
   - 以后要支持：`carry` 补丁带上两个模式的值，由折叠时的模式选，不需要两份输入。
2. **先后按安放的全序**（model 输出 2：键，再写入版本，再 id）。
   - 继承父线引擎输入（记录加合成事件）里全序不晚于切口的；
   - 子线自己的记录要键严格大于切口的键（同一位置也不行）；
   - 父线上与切口同键、写得更晚的记录不进子线；
   - 合成事件排在切口的键上，版本取一个固定的大数（2^40），所以孙线的切口与子线的切口同键时，子线带过去的值不进孙线；孙线的切口是子线自己的记录时，子线带过去的值进孙线。
3. **分叉的切口与触发处是已写的剧情变更**（已写分叉与计划分叉都是）。
4. **分叉“不可建”。**下面任一条成立时，线是“存在、不可建”：
   - 切口或触发处没有安放键（未排章、所在章不在章序里）；
   - 切口或触发处不在父线视图里；
   - 触发处在全序上不晚于切口；
   - 回溯的分叉早于触发处；
   - 父线链有环。

   写入造成这些的拒收（`invalid-fork`，与 `endAt` 的规定同一做法）；章序调整、删章与日志里本来就有的情形，线标为“不可建”并带原因：读取得到 `line-not-found` 带原因，线上记录各成一条 `line-missing`，详情写原因，`lines` 方法给出这一状态。切口、触发处的状态（撤销、待定）不影响线。状态表加这一行。
5. **常驻与淘汰。**当前线与它的全部祖先线常驻，祖先线不占“最多 3 条”的名额。不变量：已建的线的祖先线都已建。淘汰从叶子起：一条线的“最近使用”按它与后代里最近的一次算，淘汰时连同它已建的后代一起丢。
6. **`changes`、`tellings` 的线。**
   - 结果里的“这次套没套上”与按进展筛选，按参数 `worldline` 指的线算（缺省是当前线）；不在这条线视图里的记录，套没套上是 null。每条另给 `placedOn`（安放在哪条线）。
   - 筛选 `placedOn`：只列安放在这条线上的记录。筛选 `inView`：只列这条线视图里的。带视图令牌时 `worldline` 固定为令牌的线、`inView` 固定为真（project 输出 24）。
   - 范围 `{after?, through?}` 是变更 id，按全序比，`after` 不含、`through` 含。
   - 被抹掉的那段 = `{placedOn: 父线, after: 切口, through: 触发处}`。
   - `line` 仍是剧情线。
7. **带过去的值按档。**
   - 精确档按值设；
   - 语义档设成父线在触发处的起点，再带上起点之后的事件；
   - 列表按元素带：元素的语义档子字段同样带起点与事件；
   - 子线上的归纳输入因此与父线在触发处相同，归纳缓存可以共用。
   - 父线上不完整、或在子线上套不上（元素或条目不在、类型不对、超出约束）时，这个地址从这里起不完整，原因“带过去的值不完整”。这条事件不失败、不成“套不上”的待处理，也不让别的地址不完整。
   - 一条线的全部带过去的值是一个内部事件，它的身份（id）就是定义这条线的分叉（输出 6）。嫌疑记录、不完整的原因、来历与套没套上里出现的都是这个分叉的 id。它不算“涉及”的章（model 输出 20 只看作者的记录）。
8. **还原依赖。**输出 11 末句的“按地址规则”就是现有的两条：改同一对象的字段；改它新建的列表元素与条目。验收 8 的“伞”是第 3 章那次记账新建的对象或元素。线上每条修订，依赖它写下时定义这条线的那条分叉的新建修订。
9. **`plan-not-visible` 的通则：**`links` 里指向计划的（兑现、替换、拆分）都必须在写入者所在线的视图里。
10. **活页夹清单。**
    - `<chapter id="8" line="l1">` 表示一整章讲一条线，缺省主线；分段写成子元素 `<segment from="30" line="l2"/>`：第一段用 `chapter` 的 `line`，`from` 是段号，从 1 数、严格递增；
    - 段号随改稿漂移，这是取舍；
    - 写清单的一方要原样保留 `line` 与 `<segment>`；
    - 合入 master 时，folder-kinds 的清单一节补一句并链接 worldlines。
11. **发布要更新、要算根因的线。**
    - 发布要更新、要算“这次让哪些记录套不上”的线，是这次写入可能改变其实际结果的线，按“依赖范围”从线表算出，与缓存状态无关（见下文“受影响的线”）。没建的当场建。
    - 输出 15 的发布要求限定为：记账落在当前线上、不在任何子线的依赖范围里、没改条目的初值。
    - 改条目的初值或墓碑、调整章序，以及写在被继承或被带过去的区间里，每条受影响、没建的线多约两次整线构建（改前、改后），耗时随线数增加。
    - 状态表里“存在、未建：它没建好时不重算”改成“不受影响时不重算”。project 输出 14 的改初值注明同样的话。
12. **分叉是一条没有补丁的剧情变更：**可以有时间说法、参与者与讲述，像事件一样进父线的时间网络与在场。`fork.who` 是随分叉带东西过去的人，与 `cast` 各写各的。
13. **来历里带过去的那一步**写成 `{kind: "carried", fork, line: 父线, change: 触发处或切口, value, key}`：`key` 是这个内部事件的排序键。想接着看父线上的来历：在父线视图上调 `originsAfter(地址, 触发处或切口)`（P5 omp 第 5 条：章末的来历带着章末的归纳，截不出触发处那一刻）。
14. **线在一个模式下存在**，当且仅当它的定义在这个模式下有效、且父线在这个模式下存在。读子线的初值，读到的是共同的初值。
15. **日志格式不升**：format 2 已含分叉与线；`nature` 多一个枚举值 `fork`。存下来时 `line` 为主线的一律省略，只有主线的作品日志逐字节不变。修订“带来的变化”加可选的 `brokenOn: [{line, change}]`，放子线上这次让套不上的；`broken` 仍只放主线上的。
16. **status 列出更新了的线**，各带全部适用的原因：
    - `records`：视图里的记录变了；
    - `carry`：带过去的值变了；
    - `entries`：条目的初值变了；
    - `structural`：分叉的定义、章序或登记变了，从头建；
    - `built`：为这次发布当场建的。
17. **子线上的就地改**（revisions 输出 8、9）。
    - 新建的变更写读取位置的线，章内的键只看这条线视图里的记录，且大于切口的键；
    - 来历最后一步是“带过去的”地址，创作修改拒收，新码 `carried-value`（“这是带过去的值，请记一条剧情变化”）；剧情变化照常在子线上新建一条变更。

### `packages/nb-canon/src/core/schema.ts`、`world/references.ts` 与 id

- **安放与读取位置带线。**`PlacementSchema` 的三种与 `ReadPositionSchema` 的两种各加可选 `line: Id`；条目的 `appears` 带 `line` 时拒收（`type-mismatch`）。写入时 `line: "main"` 去掉（`fillDefaults`）。
- **分叉的形状。**`StoryChangeSchema.nature` 加 `fork`，再加可选 `fork: {line, name, parent, cut, trigger?, back?: GapSpec, type, who?, carry?: Address[], end?, endAt?}`。`nature` 为 `fork`、`fork` 字段在、`patches` 为空，三者缺一即 `invalid-fork`。
- **修订**：`ImpactSchema` 加可选 `brokenOn`（DS 15）。
- **引用位置**（components 输出 18 已列）：
  - `at.line`、`place.line`、`fork.parent` 是线；
  - `fork.cut`、`trigger`、`endAt` 是变更；
  - `fork.who`、`fork.carry[].entry` 是条目。

  `referenceProblem` 的线分支改查线表（调用方传进 `exists.line`）；已写的记录落在计划线上另报 `line-planned`。
- **临时线 id。**
  - `fork.line` 以 `tmp:` 开头时，`#publish` 发一个 `l` 号进同一份 `ids`；`replaceRequestTempIds` 沿引用位置换。
  - `observeIds` 把存下的 `fork.line` 报给分配器，id 不复用。
  - 不带 `tmp:` 的只许兑现计划分叉，且同 `line` 同 `parent`；其余报 `line-taken`（id 已有）或 `invalid-fork`。

### `packages/nb-canon/src/lines/`（新）：线表、线视图、带过去的值、线集

- **`table.ts`。**`lineTable(data, order)` 按数据对象与章序缓存，只看变更对象，不看引擎。给出：
  - 每条线的定义：已写分叉优先，否则用生效的计划分叉，被生效计划替代的不算；
  - 两个模式下各自存不存在（DS 14）；
  - “不可建”与原因（DS 4）；
  - 父子、深度、祖先、定义它的分叉；
  - 每条线在每个祖先上的**依赖范围**（下文“受影响的线”）。

  按数据对象重算（扫一遍变更，P5 omp 第 4 条：切口、触发处是普通的变更，挪它们也会改线表）；要省这一遍时再按反向引用做有针对性的失效，先有差分兜底。
- **`view.ts`。**`projectLine` 给出线视图的记录（`WorldData` 形状：变更与核对点按线取，条目、决策、建议与世界共用）与越界的记录。规则照输出 2、3 与 DS 2：
  - 继承父线引擎输入里全序不晚于切口的（父线的合成事件也按这一条进来）；
  - 再继承父线里、在定义这条线的分叉写下之前就有的计划，包括未排章的，未排章的在子线上同样未排章、只读；
  - 本线记录键大于切口键的进视图，其余进越界（未排章的计划照收）；
  - `at.line` 指向不存在或不可建的线的记录不进任何视图。

  主线没有任何分叉、也没有记录带线时，记录就是 `world.data` 本身（D0 另用纯函数测试证明不走这条捷径时结果相同）。“线 → 变更 id”的索引每份数据建一次，之后按 id 增量改。
- **`carry.ts`：合成事件。**
  - 每条线一条，id 是定义这条线的分叉的 id（DS 7），安放取切口的安放（去掉线），`createdAt` 取常量 `CARRY_VERSION = 2^40`。
  - 每个地址一个 `carry` 补丁 `{op: "carry", at, value, events?, incomplete?}`。值来自父线引擎的 `slotAfter(cut 或 trigger, at)`（下文“引擎”）：原始的值、它下面语义档的起点与事件、是否不完整。
  - 合成事件只进引擎输入，不进记录投影。
- **`set.ts`：线集。**
  - `LineSet` 每个 `World` 一份：结果不可变，备忘可变。按线存记录、越界、合成事件、引擎与带过去的值的规范 JSON。
  - `get(line)` 没建就建（父线先建）。
  - 推进到新数据有两个入口：
    - `advance(next, changed, {structural})`：给发布、还原、章序调整、`absorb`、`withOptions` 五个构造点用。
    - `build(line)`：给受影响、没建的线用。
  - `advance` 按线树从父到子决定每条已建的线怎么处理：
    - 定义变了（`parent`、`cut` 与它的键、`trigger` 与它的键、`carry`；`back` 只动时间）或有结构性变化：从头建它与后代；
    - 改到的变更或核对点（改前或改后）在它的视图里，或带过去的值按规范 JSON 变了（只有落在依赖范围里时才重取），或条目有任何改动：`engine.update`，传改到的 id，合成事件的值变了时另加它的 id（P5 omp 第 1、3 条：依赖范围只决定要不要重取带过去的值，不直接算“更新”；条目的任何改动都要换上新输入）；
    - 都不是：沿用旧对象。

    `name`、`who`、`type`、`end`、`endAt` 变了只更新线表。返回更新了的线与原因（DS 16）。
  - 常驻与淘汰照 DS 5。“最近使用”是跨版本共用的小对象，只决定留谁，不影响结果。服务按线缓存的视图对象跟着淘汰一起丢：视图只拉住 `LineSet` 与线 id，每次调用再取引擎。

### 受影响的线（DS 11；P5 第 1 条）

- **依赖范围。**线 L 在父线 P 上的依赖范围是 P 的引擎输入里全序不晚于 `max(切口, 触发处)` 的部分：继承到切口，带过去的值读到触发处。往上一层：L 在 P 上的范围越过了 P 自己的合成事件（也就是 L 的切口或触发处是 P 自己的记录）时，L 在 P 的父线 G 上的范围是 P 在 G 上的范围；否则与 L 在 P 上的范围相同。范围只从线表与安放算，不要引擎。
- **一次写入可能改变 L 的实际结果，当且仅当下面任一条成立**（改前、改后各判一次）：
  - 改到的已写记录或核对点安放在 L 上；
  - 安放在 L 的某个祖先上、且在 L 在那个祖先上的依赖范围里；
  - 改了条目的 `init` 或墓碑（新建条目、改文件夹、次序、`appears`、`sameAs` 不改变实际结果，不让没建的线当场建；已建的线照样换上新输入）；
  - 改了 L 或它祖先的分叉定义；
  - 章序或登记变了。

  只改计划的写入不改变实际结果，不在其内。
- **当场建。**
  - 受影响、没建的线，先在旧世界上建（结果留在旧世界的备忘里，预览与随后的发布共用），再用 `engine.update` 推进到新数据，逐条比 `outcome` 得出 `brokenOn`。
  - `impact.where` 与 `values` 按请求所写的线：`request.chapter` 那一章讲的线，或第一条记录所在的线。
- **测试**：线层差分对每一步断言“这个集合包含参照从头算出实际结果真变了的线”（第 15 条的参照）。

### 引擎（`engine/types.ts`、`reference.ts`、`incremental.ts`、`model/apply.ts`）

- **`originsAfter(change, at)`**：同一个全序点上的来历（含那一刻的归纳步），带过去那一步的“接着看”与剧情插件在触发处的知情都用它；两个引擎都实现，差分比它（P5 omp 第 5 条）。
- **`slotAfter(change, at)`**：只按实际模式，读全序不晚于这条变更的那一刻（键、`createdAt`、id，含它自己，与这条变更在不在序列里无关）这个地址的原始状态。给出：
  - 值（语义档是起点，不是拼起来的文字）；
  - 这个地址下面每个语义档路径的事件；
  - 是否不完整。

  参照引擎与增量引擎都用已有的 `inclusive` 点实现，差分的 `compareAll` 加它。
- **`carry` 补丁**（只出现在合成事件里，`PatchSchema` 不收）：`applyChange` 对它照值设、照事件设语义档的事件。父线不完整、或这一步套不上、或套完以后约束不满足的，只给这个地址记不完整，原因 `carried-incomplete`；不走 `fail`，这条事件仍算套上，也不给别的地址标不完整。
- `IncompleteMark.reason` 的类型加 `carried-incomplete`；`chapterEntries` 不算只有 `carry` 补丁的事件。`Sim` 偶尔放带这种补丁的合成变更，两个引擎对拍。

### `world/` 的写入路径

- **D0 接缝。**
  - `World` 只能经 `LineSet` 构造：五个构造点（`replay`、`#publish`、`reorder`、`absorb`、`withOptions`）各自调 `LineSet.from` 或 `advance`。
  - 读引擎的 38 处与读记录的约 51 处（`world.data` 一类：`service.ts`、`reads.ts`、`world.ts`、`pending-groups.ts`、`edits.ts`、`time/`）改成经 `world.line(id)` 的 `engine` 与 `records`。
  - 没有线时行为与输出逐字不变。
- **校验按记录所在的线取线视图。**
  - 已有的校验照旧：套得上、依据、说法的 `of` 在这条线的记录里。
  - 新文件 `world/forks.ts` 管输出 14 与 DS 3、4、9；`world/line-rules.ts` 管越界、结束、计划线、`plan-not-visible`，以及让已有分叉不可建的改动。
  - 缺省 `carry`（输出 7）像前史补位一样，在整份请求套上以后补，改写对象与操作，再校验。
- **就地改与回写按线**（DS 17）：`world/edits.ts` 的 `keyAt` 与新建变更取读取位置的线；创作修改遇到 `carried` 一步时拒收（`carried-value`）。
- **还原依赖**（输出 11、DS 8）。`dependsOn` 加一条：线上的修订依赖它写下时定义这条线的分叉的新建修订。重放时维护三张表，都不进日志：修订碰了哪些线、修订新建了哪些线、对象此刻在哪条线。计划线被兑现以后，“分叉之前”与依赖取当时定义这条线的那条分叉；换了定义它的分叉算结构性变化。

### 待处理、读取与服务（`service/`）

- 线的三种待处理（`line-out-of-bounds`、`line-missing`、`line-planned`）像时间的几种一样接进 `World.pending` 与排序。model 输出 16 里与线有关的几句都按那里写的做：越界的进它所在的线；`line-missing` 在每条线都列；计划线上的记录在实际模式下不算 `line-missing`。
- `CanonReadView` 加 `lines()` 与 `onLine(line, mode?)`：
  - 返回同一世界、同一输入代次上那条线的冻结视图，或 `{code: "line-not-found", reason?}`；
  - 计划线只在 `mode` 为 `planned` 时给视图；
  - 没被淘汰期间，同一条线给同一个对象。
- 视图上的来历把合成事件的那一步换成 `carried`（DS 13）。
- `resolveLine(position)`：位置带线就用；否则用活页夹里那一章讲的线，D6 之前一律主线。
- 插件诊断：`#groups` 先 `resolveLine`，用那条线的视图调诊断，缓存键加上线。
- `openView` 按 `grant.line` 取线视图；`#boundedTime` 按线。
- `changes`、`tellings` 加 `worldline`、`placedOn`、`inView`、`after`、`through`（DS 6）；加方法 `lines`。
- `status` 的诊断加“最近一次发布更新了哪些线、各自的原因，各线是否已建与常驻”。

### 时间（`time/`、nb-time）

- `World.time(line, mode)`：线视图的记录进 `timeInputOf`，缓存的身份用线视图的记录对象。
- 回溯的 R 点（time 输出 6）：
  - nb-time 的 `assembleNetwork` 接受额外的事件与常量约束；
  - 子线的网络里加 R 与三类约束，父线（同一模式）的网络先算，子线的缓存键带父线状态对象；
  - `fork-time-mismatch` 进时间的待处理。

### canon 插件（`packages/neuro-book/src/plugins/canon/`）

- `binder.ts` 解析 `line` 与 `<segment>`（DS 10），交出 `{ids, lines}`。
- 世界宿主把章讲的线交给服务（`WorldOptions.chapterLines`）：不放进 `ChapterOrder`，也不算结构性变化；读取输入摘要的 `chapters` 项带上线。
- 提示与诊断：`binder-line-unknown`、`binder-line-planned`、`binder-line-ended`、`telling-line-mismatch`（输出 12、13、16）。
- 远程合同：读取位置带 `line`；加 `lines` 方法；`changes`、`tellings` 加新筛选；`openView` 带线。

### 剧情插件（`packages/neuro-book/src/plugins/plot/`）

- `withView` 按 `position.line` 取 `view.onLine(...)`，缺省按活页夹；`openViewpoint` 收线。剧情的算法不需要知道线：索引按视图对象缓存，各线自然分开。
- 知情（knowledge 输出 4）：`#explicitOf` 显式处理 `carried` 一步，以它的 `key` 为键。行取父线视图在触发处的有效知情（显式加推出：父线视图上建知情索引，按 `{after: 触发处}` 取，`KnowingAt` 加这一种）。
- 经历（输出 8）：回溯者在子线上的经历另带父线上切口之后、不晚于触发处、他在场的变更。
- 诊断稳定键的 `line` 取 `view.line`，现在已经这样写。

### 切片（阶段 D）

| 片 | 内容 | 验证 |
|---|---|---|
| DS | Spec 补充：worldlines（含状态表与失败码 `carried-value`）、time、project、model、revisions，按上文 1 到 17 | 各记待确认清单；`bun run docs:check` |
| D0 | 接缝：`LineSet` 只有主线，覆盖五个构造点与记录的读取 | nb-canon 334 个测试不改一行全过；纯函数测试证明 `projectLine` 不走捷径时与 `world.data` 逐条相同；`scripts/scale.ts` 前后各量 3 次，读与发布的中位数各自慢不超过 10%（超了查原因）；应用包 canon、plot 测试 |
| D1 | schema（含 `brokenOn`）、引用、临时线 id、线表（含不可建与依赖范围）、分叉校验、引擎的 `slotAfter` 与差分、缺省 `carry` | 只有主线的作品日志逐字节不变；差分 40 个种子；失败码 `invalid-fork`、`line-taken`、`ref-invalid` 的 `line-not-found` 各一条 |
| D2 | 线视图从头建、合成事件与 `carry` 补丁、按线读（`onLine`、`resolveLine`、`openView`、`carried` 步）、诊断按线 | 验收 1、验收 2 与 3 的读取部分（含孙线的切口取子线自己的记录与取继承来的切口两例）；线层差分固定种子；读取结果里不出现合成事件以外的假 id |
| D3 | 写入规则与待处理、受影响的线与当场建、`brokenOn`、还原依赖、撤销父线记录的预览、子线上的就地改 | 验收 3、7、8；model 输出 16 的线规则；revisions 输出 8、9 在子线上各一例；project 输出 24 的按线令牌 |
| D4 | 按值比对的增量更新、常驻与淘汰（从叶子起）、status | 验收 4、5；线层随机差分；经发布路径与重放逐字对比（四种淘汰参数：常驻 3 条、1 条、全部淘汰、每次发布前全部淘汰）；`brokenOn` 与参照逐字相同；改分叉名字不重建 |
| D5 | 时间按线与 R 点 | time 验收 5；时间进线层差分 |
| D6 | 活页夹章讲的线与几种提示 | 验收 6 |
| D7 | 计划线、预览的波及面（输出 10）、变更筛选与被抹掉的那段 | 验收 9、验收 2 的预览部分、输出 5 |
| D8 | 剧情插件按线 | knowledge 验收 6；在子线上按视角读；剧情现有测试不改 |
| D9 | 规模与收口：`canon-scale.ts --fork`，第 500 章回溯、子线 500 章 | 量输出 15 三项与内存；改初值；写在继承区间、子线没建时的预览加发布 |

每片都跑受影响包的 `bun test` 与类型检查；涉及应用包的另跑 `bun test src/plugins/canon src/plugins/plot`。

### 验收映射（阶段 D）

| Spec 条目 | 片 |
|---|---|
| worldlines 输出 1 | D1（线表）、D7（计划线） |
| 输出 2 | D2 |
| 输出 3 | D3（写入）、D2（读取） |
| 输出 4 | D2、D3 |
| 输出 5 | D7 |
| 输出 6、7 | D1（缺省）、D2 |
| 输出 8 | D4 |
| 输出 9 | D4 |
| 输出 10 | D7 |
| 输出 11 | D3 |
| 输出 12、13、16 | D6 |
| 输出 14 | D1 |
| 输出 15 | D9 |
| 验收 1 | D2 |
| 验收 2 | D2（预览部分 D7） |
| 验收 3 | D2、D3 |
| 验收 4、5 | D4 |
| 验收 6 | D6 |
| 验收 7、8 | D3 |
| 验收 9 | D7 |
| time 输出 6、验收 5 | D5 |
| knowledge 输出 4、8、验收 6 | D8 |
| project 的 `lines`、`changes` 筛选、输出 24、26 | D2、D3、D4、D7 |
| model 输出 16 的线规则 | D3 |
| revisions 输出 8、9 在子线上 | D3 |

失败码表里每个码，在对应片的测试里各有一条。

### 测试做法

- **引擎差分**：只加 `slotAfter` 与 `carry` 补丁，改 `differential.test.ts` 的 `compareAll` 与 `Sim`。
- **线层差分**（`tests/lines-differential.test.ts`）：
  - 被测是生产的 `LineSet`（增量、淘汰、当场建）；参照是另写的 `tests/oracle/lines.ts` 加参照引擎，按 Spec 输出 2、3、6 直译，递归、不缓存、不共用生产里的函数。
  - 参照还要直译“这次让哪些记录套不上”：每一步在改前、改后两份数据上，对每条存在的线从头算 `outcome`，逐线比，与存下的 `broken`、`brokenOn` 逐字比；并断言受影响的线集合包含实际结果变了的线。
  - 随机生成：线树最多 4 条、深度 3；分叉与带过去的地址（含列表、语义档、有跨字段约束的）；越界的记录；结构性操作（挪切口与触发处、改 `carry` 与父线、撤销分叉、记录换线、记录挪过切口与触发处、章序调整）；条目的 `init` 改动；计划跨线。
  - 断言各类情形在随机序列里出现的比例，防止走不到。
- **经真实发布路径**：在 `World` 上随机写入，每步与 `World.replay(revisions)` 逐条线比读取结果；同一序列在四种淘汰参数下结果与日志都相同。
- **通用断言**：读取结果里出现的变更 id 都是真实存在的变更（合成事件的 id 就是分叉的 id）。
- **固定场景**：验收 1 到 9 各一个测试。

### 阶段 D 的风险

- **条目初值、章序调整与写在依赖范围里的发布**，要建每条受影响、没建的线两次：线多时发布慢。DS 11 写进 Spec，D9 量。线数多到不能接受时，另开 Task 做线的持久快照或更细的依赖。
- **按值比对漏更新**：由线层差分、`broken` 的独立参照与重放对比兜底。验收 4 的两步写成固定断言，防止退化成全部更新：改 c2 的金额时 r1、r2 不更新；只改 r2 时只更新 r2。
- **发布路径多一层线**：当前线上最新一章的记账 D9 再量。阶段 C 已超 100 毫秒，见待确认清单。
- **计划线与按值比对的组合最复杂**：D7 放在 D4 之后，差分里加计划分叉、兑现与撤销。

## 阶段 E 细计划：目标的检查、决策的守卫、写作指示、写手的上下文（第二版，2026-11-06）

第一版的计划审查 P6 的 Opus 一份 23 条（阻断 4、重要 11、建议 8），第二版据此重写：第一版把几样“已有”的东西当成了已有，本阶段因此要先补一小段内核与 canon 插件的读取能力（EP 片），这改变了第一版“全是纯读、不改内核”的前提。omp 那一份在后台审第一版，回来后单独处理。

依据 Spec：[`plot/goals.md`](../../../../../docs/specs/plot/goals.md)、[`plot/decisions.md`](../../../../../docs/specs/plot/decisions.md)、[`plot/brief.md`](../../../../../docs/specs/plot/brief.md)、[`plot/knowledge.md`](../../../../../docs/specs/plot/knowledge.md) 输出 6、10（在内核分支上的那份）。阶段 B、D 已完成：知情、伏笔、视角、目标的读取与冲突、按线的视图都在 `packages/neuro-book/src/plugins/plot/`。

### 核对过的事实（P6 在代码上实验确认）

- 诊断的计算 `DiagnosticCompute = (view, at, mode) => Finding[]`，`view` 是读取位置那条线的读取视图；`Finding.params` 只能放字符串和数；诊断的级别按诊断 id 登记，同一诊断的发现全部进待处理；**声明了诊断而没登记计算会让每次读待处理标“不完整”**（`shared/declarations.ts` 头部的约定，`plot.test.ts` 有断言）。所以诊断随给出计算的那一片声明。
- `CanonProject`（`canon/shared/contracts.ts`）有 `register`、`reportDataVersion`、`snapshot`、`openView`、`closeView`、`audit`、`deny`，**没有 `render`**；`CanonReadView` 也没有。内核的渲染（`renderEntryForAgent`）只出条目的主文字块，不含 Component 的值。
- `chapterEntries` 只算已写的剧情变更，计划不算（`engine/incremental.ts`）。
- `OriginStep` 没有完整性标记，来历第一步总是 `init`，还有 `check`、`reduce` 两种没有值的步；带过去的候选与隐秘目标推出的候选没有变更 id。
- 读取位置只有初值与章首、章末；内核没有“读某处安放”。
- `CanonReadView.tellings` 对剧情变更的讲述按线过滤：回溯段（子线上的变更）里的揭示在主线视图里看不到，所以 B 的 `readerKnowing`、`firstReveal`、远程方法 `reader` 在回溯章上算少了（实验：子线上第 9 章的 `explicit` 揭示，主线视图读者是 `unaware`，子线视图是 `knows`）。
- `nbook.plot.reveal` 的 `attachTo` 只有 `telling`；简报里“计划要暗示或揭示”读的是计划 `told` 里讲述上的 `reveal`，不是 `change.marks`。
- knowledge 输出 10“写之前的集合”阶段 B 没有实现（B 计划把它推到了本阶段）。
- `ChangeFilter.entry` 走 `concerns`（`involves`、`cast`、补丁地址），**不看 `change.lines`**；剧情线用 `changes({line})`。
- 合同 `nbook.plot/world` 的方法现在全是 `effect: "read"`、调用方含 `browser`；插件的项目实例按调用方各一份，共用状态要放在 `activate` 闭包里。
- 远程单条消息上限 1 MiB（`CANON_BUDGET_BYTES` = 它减 64 KiB）。

### EP：本阶段要先补的读取能力（内核与 canon 插件；各记待确认清单）

1. `CanonReadView.chapterEntries(chapter, mode = "actual")`：按计划模式并上本章计划的 `involves`、`cast.who/as`、补丁地址的条目（Spec canon.model 输出 20 只定义了已写章；未写章的“涉及本章”按这个算，是 Spec 的补充）。引擎侧 `Engine.chapterEntries` 加 `mode` 参数，两个引擎一起改，差分覆盖。
2. `CanonReadView.chapterLines(chapter)`：这一章活页夹分的段 `[{line, from}]`（没有分段时是 `[{line: 章开头那条线, from: 1}]`）。读者读过的讲述据此取。
3. `CanonReadView.render(entry, position, mode)`：同步，返回内核对 Agent 的渲染（主文字块的带值写法）。`CanonProject` 不另加方法，插件经快照的读取视图用。Component 的值不在渲染里：简报里“涉及条目的样子”由剧情插件按 `view.entry()` 的字段写成字段形式（去掉 `know` 命名空间），主文字用 `render`，保密以上知识点的遮挡走 B 的 `Viewpoint` 同一套规则（函数 `shielded(view, id)`，EP 片里抽出来共用）。
4. 数据版本：`PLOT_DATA_VERSION` 取 `"1+" + sha256(规范 JSON(按章 id 排好的写作指示快照表))`，用 `canon.reportDataVersion` 报告（不重登记）；内容没变不报。
5. `setInstructions({chapter, snapshot | null, base?})`：`effect: "write"`，合同里单独一个服务 `nbook.plot/instructions`（`callers: ["server"]`，写作任务推快照；浏览器不能调）；按章替换，带 `base`（当前表的数据版本）时比较后替换，对不上回 plot 失败码 `instructions-conflict`；输入按 `encodedBytes` 校验，超了 `too-large`；表放在 `activate` 闭包里，所有调用方与诊断计算共用，不用模块级状态。重启后表是空的：写作指示的三项检查在表为空时返回没有发现（实现时改了：抛 `diagnostic-unavailable` 会让没用写作指示的项目每次读待处理都标“不完整”；代价是重启后提示消失，记待确认）；`brief` 读不到本章快照时“写作指示”段写“无”、记录里 `instruction` 为 null。写作指示只有这一个来源：`brief` 不收写作指示参数。（存盘随阶段 F。）
6. 读者的知情（B 的缺口，修在 EP）：`readerKnowing`、`firstReveal` 改为读“读者读过的讲述”：对每一章按 `chapterLines` 的分段，取每段那条线的视图里发生点落在这一段（段首到下一段首之前）的讲述，合起来按发生点排序；不分线地得到与当前线无关的结果。补“回溯段里的揭示让读者知情变了”的测试，远程方法 `reader` 随之修好。

### E0：声明与输入通道骨架（`shared/declarations.ts`、`shared/contracts.ts`、`backend/plugin.ts`）

- 标注种类先声明三个：`nbook.plot.guard.address`、`nbook.plot.guard.reader`（挂在决策上）、`nbook.plot.scene`（挂在计划上）；它们不是诊断，没有“不完整”的问题。`reveal` 不动（挂在讲述上）。
- 写作指示快照的形状（`shared/instructions.ts`，TypeBox；`chapter`、`version` 必有，其余可选）与 EP 5 的闭包内存表、`nbook.plot/instructions` 服务。
- 诊断**不在这里声明**。`constraintViolated`、`decidedInText` 留到阶段 F 与窄问题一起声明与计算（同伏笔的 `objectTouchedInText` 的先例），记待确认。合同加方法的骨架：新方法在计算接上之前不出现在合同里（不做返回 `not-implemented` 的空壳）。
- 测试：声明登记通过内核的登记校验；`setInstructions` 同内容两次数据版本不变、游标仍有效；换内容后旧游标 `cursor-stale`；新建插件实例同内容得到同一数据版本；`base` 对不上回 `instructions-conflict`；超大输入 `too-large`；表为空时写作指示检查是 `diagnostic-unavailable`（E2b 接上后测）。

### E1：目标的检查与目标表（`core/knowledge.ts` 小改、`core/goals.ts`、`core/goal-checks.ts`）

- `KnowingIndex` 给候选补 `change`：显式候选记变更；`carried` 记触发处 id 并另存合成事件的键（先后一律按 `key` 比，触发处 id 只进稳定键）；隐秘目标推出的候选 `change = null`。新增 `changesOf(person, point)`：按 `key` 先后列出有效知情的变化 `{key, change, before, after}`（程度或 `他以为的` 不同才算；`怎么知道/谁告诉的/备注` 不算）。测试对现有 `effective` 在每个变化点前后逐一比较。
- `premiseChanged`：进行或受挫的目标 G（持有者 H，`基于` 里的知识点 K）：H 对 K 的有效知情有变化时，取 `key` 最晚的一次且 `change` 不为 null；之后（按 `key` 严格晚于，**同一条变更也改了 G 的 `goal` 命名空间算“已跟着改”**）没有改过 G 的 `goal` 命名空间的变更则报，稳定键 `[G, K, 那条变更]`、`line`。隐秘目标推出的变化（`change = null`）不报。只报最后一次是降噪的取舍（作者挂在旧键上的“有意为之”决策会在新变化出现后失效），记待确认。
- `stalled`、`overdue` 都按**读取位置所在章**算（读最新一章末尾时即 Spec 的“最新一章”），不按章序末尾；起点是最后一次改 G 的变更所在章，从没改过取 `appears` 所在章（前史取第一章）。常量 `STALLED_AFTER_CHAPTERS = 30`。口径记待确认。
- `skippedStep`：`origins({entry: G, path: "goal.状态"})` 里状态从 `active` 到 `achieved` 的相邻两步（`init`/出场算 `active` 的起点），两步的键之间、`changes({entry: G})` 列出的变更里除这两条以外还有没有；没有则报；同一条变更里先后改两次、或初值直接 `achieved` 不报。
- 目标表（输出 5）：主要角色 = 在这个位置上至少有一个已出场目标的持有者（不论轻重、状态，筛选再收窄）；态度表是这些人的 `att.态度`（对象、态度、起因），不是所有有 `att` 的条目；归纳的“未归纳”写法照 Spec 验收 2 读到什么给什么。
- 诊断 `premiseChanged`、`stalled`、`skippedStep` 在这一片声明与登记。
- 测试：goals 验收 1 到 3，`skippedStep`、`stalled`、同一变更既改知情又改目标的固定场景；变异检查（`基于` 换一个知识点；“之后改过”去掉；`key` 比较换成触发处的键）。

### E2a：决策取数、到期与悬空（`core/decisions.ts`）

- 涉及本章（`about` 六种）：`entry` 参与求交；`address` 取 `at.entry` 参与求交；`change` 取它的安放章；`chapter` 看是不是本章；`decision`、`diagnostic` 不参与；`scope` 只给 `from` 或 `to` 时按章序比；求交用 EP 1 的 `chapterEntries(chapter, mode)`（开写前与简报用计划模式）。挂在剧情线条目上的已定决策对**这条线上有剧情变更**的章算涉及：`view.changes({line: 剧情线条目, chapter})`（不是 `entry` 筛选）。函数里世界线一律叫 `worldline`，剧情线条目叫 `plotLine`。
- 悬空：`about` 不为空且每一项都是已删除的条目、已撤销的剧情变更、被取代或放弃的决策，或 `address` 的条目已删、`chapter` 不在章序里；空 `about` 不算悬空；`diagnostic` 项不参与。
- 到期没定：待定决策 `due` 章不晚于读取位置所在章；与 `stalled` 同口径。诊断 `overdue`、`dangling` 在这一片声明与登记。
- 涉及本章的决策视图（输出 7）：已定在前，按挂的对象排；每条带结论、理由（没给时“作者没说理由”）、约束与守卫标注。输出 7 后半句：写作指示三项诊断的 `Finding.objects` 追加相关已定决策的引用（`{kind: "decision", id}`）；泄底、穿帮类的诊断属于阶段 B 的知情与阶段 F，那里再附。
- 测试：decisions 验收 3（到期没定）、悬空的固定场景（含空 `about`、六种 `about`）、剧情线上的决策、未写章只有计划时求交非空；变异检查。

### E2b：守卫与写作指示的检查（`core/guards.ts`、`core/instruction-checks.ts`）

- 地址守卫：对已定决策的每个 `guard.address`，在 `lines`（缺省所有存在且可建的线）的每条线上用那条线的视图，实际与计划两种模式各算；诊断计算在“当前线”视图里只报当前线上的违反，每条线各自报。取值：范围起点值与完整性用 `entry(at.entry, 章首/初值, mode)` 的 `fields[path]`（`incomplete`），范围内每一步用 `patch`/`carried` 步的 `result`，`check`、`reduce` 步跳过，每步之后再用 `entry` 查完整性（或接受“只看起点与最后一步的完整性”，实现时选一种写进注释）；值不完整不判。“无法检查”不进待处理（Spec 要“记”），只出现在决策视图的守卫结果里（`unchecked: true`），不另登诊断；记待确认。稳定键 `[决策, 违反它的那条变更（范围开头就违反时没有）]`、`line`、`detail`（载荷规范 JSON 的 SHA-256）。
- 读者守卫：`until` 之前的每个讲述位置，用 EP 6 的读者知情（程度超过 `atMost` 就违反），第一处让它超过的讲述记在键里；不分线，只在一个视图上算一次（结果与当前线无关），诊断挂在当前线的计算里时对所有线给同一结果即可（稳定键不带 `line`）。
- 写作指示检查：`povAbsent` 用 `view.presence(pov, {from: N, to: N, mode})`（只算这条线，不含回溯者“记得的”父线变更）；本章没有任何变更、或有没记参与者的变更（`uncast > 0`）时不报。`flashbackMismatch`：补叙的安放与本章安放的剧情变更不在附近（同一章，或前史里它的前后各一条，用 `placementKey` 排序；安放在章内时“附近”只指同一章）。`repeated`：`avoid` 的每一项、`other` 整段文字相等才算同一句；连续章指快照里相邻的章（中间没有快照即断开）；读取位置之后的章不算；同一句在不连续的两段区间各报一条。三项都只在第 N 章**讲的那条线**（`positionLine`）的视图上报。表为空抛“还没有写作指示快照”。
- 开写前的视图 `beforeWriting(chapter)`：只在本章讲的线（分段的取各段的线）上算：`due` 不晚于本章的待定决策、涉及本章的 `premiseChanged`（定义：G 的持有者在本章计划里在场或被提到，或 G 在本章涉及的条目里）、本章计划按计划模式触发的地址守卫违反（`objects` 含本章计划的变更）。拦不拦、“照写”怎么记不在这里。`decisionsFor(chapter, worldlines?)` 缺省同样只取本章的线。
- 诊断 `addressGuardViolated`、`readerGuardViolated`、`povAbsent`、`flashbackMismatch`、`repeated` 在这一片声明与登记。
- 测试：decisions 验收 1、2、4；多线（回溯线上才违反）、两种模式；回溯段里的揭示让读者守卫违反；`repeated` 的断开与不连续区间；变异检查。

### E3：写手的上下文（`core/brief/`，纯函数，`index.ts` 对外 `composeBrief`）

输入：`{view, chapter, outline, targetWords, pluginVersion}`（写作指示从闭包表读，上一章末尾一段由插件从正文快照取：`CanonReadView` 的章正文读取目前没有，见下，E3 开工时若仍没有就作为内核补充 EP 7：`chapterText(chapter)`，只读，戳已含正文摘要）。输出：`{sections, text, hints, record}`。

- `chapter-points.ts`（knowledge 输出 10 的“写之前的集合”，E3a 第一项，阶段 F 的“写完以后的集合”在它上面加）：`pointsBeforeWriting(view, chapter)`：本章计划的补丁与标注、伏笔节点所指伏笔的答案、细纲讲述上的标注、参与者与涉及条目名下的保密以上知识点、参与者进行或受挫目标的 `隐秘`；“计划要暗示或揭示”= 本章计划 `told` 讲述上带指向 K 的 `nbook.plot.reveal`（`hint` 对应“只能写到：暗示”，`explicit` 对应“明说”，两者都有取 `explicit`）。
- `read.ts`：读哪个位置（输出 2、14）：本章开头、本章讲的线（`positionLine`）。补叙 `timeMode.flashback`：**近似读那处安放所在章的章首**（前史安放读初值，前史里取事件序不晚于它的部分用 `KnowingIndex` 的 `{after: 那处之前最后一条变更}` 判知情），因为读取位置没有“读某处安放”；这是 Spec 没写清的近似，记待确认，要精确得给内核读取位置加“按安放读”（改上游）。分段讲两条线的章按 `chapterLines` 每段一份，标“回溯前”“回溯后”，共同部分只写一次。本章计划 = 按计划模式在本章、本线看得到的生效计划；状态变化写成字段形式“对象的字段：旧 → 新”。
- `compose.ts`（输出 1、3）：段与顺序、空段写“无”、通则整份只出现一次；`scene.ts`（输出 6）：照抄计划上 `nbook.plot.scene` 的各行，按计划模式的 `eventKey` 先后。
- `secrets.ts`（输出 4）、`people.ts`（输出 5）、`address.ts`（输出 7）、`foreshadow.ts`（输出 8）、`decisions.ts`（输出 9）、`reader.ts`（输出 10，用 EP 6）、`allowed.ts`（输出 11）、`appearance.ts`（输出 13，用 EP 3）、`fixed.ts`（所有固定句集中一个文件，改固定句是行为变化）。
- 提示 `noPresentation`、`noSceneConditions`、`payoffWithheld`：只在拼简报时产出，放在结果的 `hints` 里，**不登记成内核诊断**（它们依赖“要写哪一章”，按章登记会对所有老章出提示、拖慢读待处理）；记待确认。
- `budget.ts`（输出 12）：只按段各自的上限裁，从后往前裁项；段间的裁剪顺序在 Spec 没有总上限时不起作用，记待确认（有总上限再用）；字数按码点数（`[...text].length`），不含段标题；这一场的秘密不裁到真相那句；裁掉的在末尾写“已省略：……”。上限表是常量、调用方可覆盖。
- `record.ts`（输出 15）：记读取输入摘要、写作指示快照的 `version`（无则 null）、细纲的 SHA-256、目标字数、**上一章末尾的 SHA-256**（Spec 的记录列表里没有它，补进 Spec 输出 15，记待确认）、插件版本（取 `descriptor` 的 `version` 字段）、裁掉的项。
- 测试：brief 验收 1 到 7 与输出 1 到 15 逐条（映射表见下）；确定性用“两份独立建出的世界（发布先后不同、内容相同）各拼一次，逐字相同”，再加“只改细纲/目标字数/上一章末尾，记录不同”的反例；每个固定句一条断言；变异检查（删掉绝密“不暗示也不揭示”分支、去掉“真相那句不裁”的保护、`reveal` 改读 `change.marks` 各应让一条测试失败）。

### P6 omp 份带来的补充（第二版追加，2026-11-06）

omp 的 21 条里 17 条与 Opus 份重合、第二版已覆盖（诊断个数、`params`、`changesOf` 的触发处、`origins` 完整性、读者知情按线、剧情线筛选、回溯分段与补叙、渲染、`setInstructions` 的并发与重启、身份字段必有、`previousTail` 记录、`dangling`、`povAbsent` 的不确定性、数据版本报告、性能量法、简报总组装）。新增的 4 条：

- `composeBrief` 的输入加摘要端口 `digest(text)`（同步，由宿主注入，与读取输入的摘要同算法），`core/` 不导入 Node API；插件版本不由调用方给，后端用 `descriptor.version` 注入，远程 `brief` 的输入里没有这个字段；纯函数测试用夹具传入。
- 地址守卫的候选线：每个模式下取 `exists[mode] && unbuildable === null` 的线；决策显式写的 `lines` 里指向不可用线的跳过，并在决策视图的守卫结果里标 `unchecked`（不另出诊断）；“当前线”限定计算前先验这条线的状态。
- 验收映射补测试矩阵：`stalled` 的 30 与 31 章边界、没有出场位置；`skippedStep` 的同一变更多补丁与中间变更；守卫范围端点（`from`/`to` 含不含）、初值就违反、显式线失效；`noPresentation`、`noSceneConditions`、`payoffWithheld`；至少一个真实 `WorldService`/远程合同场景覆盖每个公开失败码（`too-large`、`instructions-conflict`、`view-denied`、`line-not-found`）。
- 变异检查不替代场景测试。

### 切片（阶段 E）

1. **EP1**：内核：`Engine.chapterEntries(…, mode)`、`CanonReadView.chapterEntries/chapterLines/render`；差分与测试；Spec 补充（canon.model 输出 20、project 的读取视图）与待确认清单。
2. **EP2**：数据版本、`setInstructions` 服务与闭包内存表、E0 的声明与形状；读者知情（EP 6）修在 `core/knowledge.ts`，补回溯段测试。
3. **E1**、4. **E2a**、5. **E2b**：各自声明并登记自己的诊断，每片测试与变异检查。
6. **E3a**：`chapter-points`、`read`、`compose`、`scene`、`secrets`、`people`（验收 1 到 3、7）。
7. **E3b**：`address`、`foreshadow`、`decisions`、`reader`、`allowed`、`appearance`、`budget`、`record`、`fixed`（验收 4 到 6、brief 验收 5、确定性、体积）。
8. **E4**：远程方法（`goals`、`decisionsFor`、`beforeWriting`、`brief`）与 `nbook.plot/instructions` 接上，应用包 `plot.test.ts` 端到端；扩 `scripts/perf/plot-scale.ts`（每人 0 到 3 个目标、主要角色 30 人、`基于` 各 2 个知识点；200 条决策，50 条已定带地址守卫、20 条带读者守卫、30 条待定带 `due`；3 条分叉线；登记全部新计算），预算按全部剧情诊断合计不超过 200 ms 判，另记每个新诊断各自耗时；类型检查、变异检查汇总。
每片自跑 `bun test src/plugins/plot`、`bunx tsc --noEmit -p .`（应用包）；EP1 与改了内核的片另跑 `bun test`（nb-canon）。

### 验收映射（阶段 E）

| 来源 | 切片 | 测试 |
|---|---|---|
| goals 验收 1 到 3、输出 3 到 5 | E1 | 固定场景 + 变异检查 |
| decisions 输出 1 到 7、9、验收 3 | E2a | 固定场景（含六种 `about`、空 `about`、剧情线、未写章） |
| decisions 输出 2、3、6、8、验收 1、2、4 | E2b | 多线、两模式、回溯段读者守卫、三项检查的边界 |
| decisions 输出 10（快照版本） | EP2、E3 | 数据版本测试；记录比对 |
| brief 输出 1、3、6 | E3a | `compose`、`scene` 的固定场景 |
| brief 输出 2、4、5、验收 1 到 3、7 | E3a | 秘密、在场的人、读位置（含补叙近似） |
| brief 输出 7、8、9、10、11、13、验收 5、6 | E3b | 称谓、伏笔、决策归属、读者已知、固定句、渲染、回溯章两份、一条决策挂两个秘密 |
| brief 输出 12、验收 4 | E3b | 缺省上限与调小上限两组；裁剪 |
| brief 输出 14、15 | E3b | 回溯章两份；独立建出的两份世界逐字相同；输入改一项记录就变 |
| knowledge 输出 6、10 | EP2、E3a | 回溯段读者知情；`pointsBeforeWriting` 的四个来源 |

### 验证与未验证边界

- 每片同上；E4 收口量读待处理（预算 200 ms，合计）。
- 未验证：真实模型下写手用简报的效果（Spec 说由真实模型评测，不在本 Task）；补叙章的精确读法（近似，待开发者定是否改内核）。

### 不做与风险

- 不做：窄问题的 `constraintViolated`、`decidedInText`（阶段 F）；写作指示快照与细纲的文件和存盘（F）；“照写”的交互；简报各段上限的最终数字；泄底、穿帮诊断附决策（B 的知情诊断与 F）。
- 风险：(1) 地址守卫按线按模式乘开，只对已定且带守卫的决策算，线数大于常驻名额时每条线要建一次，量法里有分叉与决策的数量；(2) 简报固定句多，措辞一改就是行为变化，集中在 `fixed.ts`；(3) EP 片改内核读取，有差分覆盖，且读取视图的新方法只加不改；(4) 补叙章近似读章首，可能让作者在补叙章拿到不准的简报，提示里写“补叙按所在章章首读”；(5) 本阶段的 Spec 补充多，全部先记待确认清单。

## 阶段 F 细计划：写完以后的检查（第一版，2026-11-06）

开发者 11-06：“模型调用好像实现并合并到 master 了，agent 插件应该是依赖他的。可以继续阶段 F”。核实：`nbook.models` 已实现，内核分支上也有。上面“阶段 B 到 F”一节写的模型角色合同就是它。依据：`docs/specs/plot/checks.md`（全部）、`plot/decisions.md` 输出 4、`plot/foreshadowing.md` 输出 7 的 `objectTouchedInText`、`plot/knowledge.md` 输出 10 的写完以后的集合、`plot/brief.md` 输出 11、14、15。

### 核对过的事实

- `modelsKey`（`plugins/models/shared/contracts.ts`）是服务端进程的进程内服务，`port().resolve({settings, purpose, profile, role})` 给出 `call(request, signal, onDelta)`。剧情插件在项目子进程（`docs/specs/runtime/glossary.md` 项目实例），依赖不到它，只能走远程服务。现有 `callers` 含 `project` 的合同只有配置与存储。
- 请求支持工具与 `toolChoice: {tool}`（`nb-harness` 的 `ModelRequest`）；回复的 `toolCalls` 是结构化答案的通道。失败不抛错，`stopReason: "error"` 带 `error.kind`、`retryable`。`maxHttpAttempts` 固定为 1（models 输出 16）。
- 远程调用不写 `timeout` 就不限时（`nb-runtime/src/remote/node.ts`），激活期间才有 10 秒上限；单条消息上限 1 MiB。
- 正文快照在 `WorldService.#texts`（带摘要），世界的 `options.chapterText` 读它；`CanonReadView` 没有正文的读取。段的切法是 `world/tellings.ts` 的 `paragraphsOf`（去掉首尾空白仍不为空的行），未从包入口导出。
- `storage.persistence`：`keyed: true` 的记录按资源 id 寻址，资源 id 只能 `[a-z0-9][a-z0-9._-]*`（最长 128），`maxBytes` 上限 1 MiB；**没有列举接口**；状态是 `corrupt`、`unsupported-version` 时 `save` 得 `protected`，要用 `reset`。项目分区由项目实例提供，进程内调用。
- 诊断的计算是同步的（`DiagnosticCompute`），所以检查记录、写作指示、自陈要全放在内存里，存储只是落盘。
- `composeBrief` 在 1000 章最后一章第一次读要 211 ms（`evidences/scale-e4.txt`），`new KnowingIndex` 每个位置要重建 `#derivedOf`（扫全部计入的变更）。按输出 7 对每条记录都重拼，1000 章全跑过检查时要几分钟，一定要先比依赖的摘要。
- `pointsBeforeWriting` 在 `core/brief/context.ts`；`secrecyOf` 没判 `appeared`，还没出场的知识点也算进去，F2 一并修（否则“本章之后的世界变了”会让候选变）。

### 技术选型

- 结构化答案：强制调用一个 `answer` 工具（`toolChoice: {tool: "answer"}`），参数用 TypeBox schema 声明并用 `Value.Check` 校验（仓库已有）。否决：让模型写 JSON 再解析（没有 schema 约束，多一层容错）；服务商的 `response_format`（适配器没开放）。
- 并发：自己写一个不到十行的上限为 4 的循环（`models` 的 `checkAll` 同样做法）。没有引库的必要。

### FS：Spec 的补充与解读（在分支上，各记待确认清单）

1. `plot/checks.md` 输入：写手的自陈存成 `{report: {names, unsure, deviations}, outline, targetWords}`。细纲与目标字数要存：固定调用的材料是那一段的写手上下文，要能重拼。没有自陈的章（作者自己写的）照跑：细纲为空串、目标字数 0，自陈写“没有”。
2. `plot/checks.md` 输出 11 解读：写手上下文只给固定的一次调用。窄问题的材料是那一段的正文加题面里写明的事实，不带上下文（20 个问题各带一份上下文，每章多十万字的输入，看不到好处）。
3. `plot/checks.md` 输出 2 解读：有效知情按第 N 章**章末**、段所在的线读（本章里得知的人不算候选）。在场的人取已写变更的 `cast` 里 `present`，只有 `label` 没有条目的也算（没有知情行）；没记 `cast` 的变更不提供候选。变更归哪一段：讲述的发生点落在哪段归哪段；本章没有发生点的归这条线的每一段。
4. `plot/checks.md` 失败表加 `plot-check-busy`（这一章的检查正在跑）；输出 5 补问：`run` 带 `followUps` 时，输入摘要相同的调用沿用上一条记录的答案，不重新花钱；不带时全部重问。
5. `plot/checks.md` 边界：远程合同 `nbook.plot/checks`；模型的角色是记账 `main`、试读 `fast`（Spec 说用哪个模型随实现，写在实现合同里，不进条目）。
6. `plot/brief.md` 输出 15 的记录：上一章末尾改由插件从正文快照取（撤回阶段 E 的“由调用方给”，待确认清单改判那一行）。
7. `canon/model.md` 补 `CanonReadView.chapterText`、`chapterTextDigest`，`stamp.declarationsDigest`（读取输入里登记与历法那一部分）。

### F0：内核的读取（`packages/nb-canon`）与上一章末尾

- `reads.ts`：`chapterText(chapter): string | undefined`、`chapterTextDigest(chapter): string | null`，读 `#texts`，经 `createReadView` 的参数传入；随输入代次作废（`#guarded` 已有）。
- `schema.ts` 导出 `paragraphsOf`。`ReadStamp` 加 `declarationsDigest`（`#stampOf` 里算输入摘要时已有这一部分）。
- 剧情插件：`composeBrief` 不再收 `previousTail`，从 `view.chapterText(上一章)` 取；远程 `brief` 去掉这个参数，`previous-tail-not-allowed` 这个码一并去掉。

### F1：`packages/neuro-book/src/plugins/plot/backend/store.ts`（新）：落盘的三张表

- 三条记录定义：`plot-instruction`、`plot-self-report`、`plot-check`，都是 `scope: "project"`、`locality: "shared"`、`keyed: true`，`maxBytes` 分别 64 KiB、256 KiB、1 MiB。资源 id 取章 id 的 SHA-256 前 40 位（章 id 不一定合资源 id 的规则），值里自带 `chapter`。
- 另有一条不按键的 `plot-chapters`（`{chapters: string[]}`）：有记录的章的清单，补存储没有列举接口。写入顺序是先清单后记录：中途崩溃时清单里多一章，读出来 `missing`，无害。
- `ChapterTable<T>`：`load()`、`get(chapter)`、`all()`、`put(chapter, value | null)`。内存里存值、revision 与值的摘要。写入：当前是 `corrupt` 或 `unsupported-version` 时用 `reset`，否则带 revision 的 `save`；成功后才改内存。`load` 读到坏记录写一条诊断、按没有算（checks “检查记录的形状变了时升版本；旧版本的记录不读”）。
- 数据版本：三张表各章摘要合起来的摘要（`1+<hex>`），空是 `1`。替代 `InstructionTable` 的全表重算：记录大、改一条不重算全部。重启后同内容同版本。
- `InstructionTable` 的接口（`put(chapter, snapshot, base)`、`dataVersion`、`empty`、`all`）改成建在 `ChapterTable` 上，`put` 变异步，`base` 语义不变；`nbook.plot/instructions` 跟着改。
- 入口激活：`await` 读完（存储在本进程，读清单里的章）。之前先 `register` 不含这几项的计算，读完再 `register` 全部：窗口期里这些诊断是“不完整”，不是“查过没有发现”。这样就改掉阶段 E 记的“重启后提示消失”。

### F2：`core/checks/segments.ts`、`points.ts`、`candidates.ts`（新，纯计算）

- `segmentsOf(view, chapter)`：`chapterLines` 加段落范围与这段正文、段的身份 `main#2`（这条线在本章第几次出现）、起始段号；`inSegment(segment, quote)`。
- `pointsAfterWriting(frame, chapter, text)`（knowledge 输出 10）：`pointsBeforeWriting` 加第 N 章已写变更的补丁与标注（`patchPoints`、`marksOf` 从 `context.ts` 导出）加正文里出现主体或 `揭穿` 马甲的名字、别名的。
- `candidates(input)`：
  - 在场层、叙述层按输出 2，读 `knowingIndex(view, "actual", 最新一章末尾).effective(person, point, 章末)`（同一份索引查不同位置，不为每章重建）；
  - 伏笔物件层：`foreshadowIndex` 取已埋未回收的伏笔的 `物件`，本章已写变更涉及或正文里出现名字的；每个物件一问，题面合并各伏笔；
  - 时间层：每段一问；
  - 候选的 id 稳定：`presence:<段>:<知识点>:<人>`、`narration:<段>:<知识点>`、`object:<段>:<物件>`、`time:<段>`。
- `budgeted(candidates, followUps)`：按输出 5 排，取前 20，加补问清单里仍是候选的；其余记 `unasked`。

### F3：`core/checks/questions.ts`、`trial.ts`、`plan.ts`（新，纯计算）

- `planCheck(input): CheckPlan`：`input` 是 `{view, chapter, instruction, selfReport, followUps, pluginVersion, digest}`，同步、不碰存储与模型。给出段、窄问题、固定调用、试读、`unasked`、提示。**运行与校验有效性共用它**，这是输出 7 “重拼”的依据。
- 每次调用 `{id, layer, role: "ledger" | "reader", question, request: {system, user, answer: 哪个 schema}, digest}`。`digest` 是 `canonicalJson({system, user, answer})` 的 SHA-256。`user` 里材料在前、题面在后（服务商的前缀缓存能吃到同一段正文）。`question` 只是题面，进记录；材料不进记录（输出“副作用”：输入输出不另存）。
- 固定调用的规则项：`pov:<段>`（有视角人物且方式是第一人称或有限视角）、`ending`、`avoid:<文字的摘要>`、`constraint:<决策>:<下标>`、`pending:<决策>`。决策用 `involvedDecisions(view, chapter, "actual", points)`。写作指示写在题面，材料是 `composeBrief` 按段拼的文字、自陈、标明段的整章正文。
- 试读（输出 4）：条件读 `readerKnowing`（上一章末尾）与本章之后的明说揭示（新写 `revealTable(view)`，每个视图扫一次，得每个知识点最晚的明说揭示所在章，计划与已写都算）。材料按悬念的 `nodesRead` 取段（`paragraphsOf`）加上一章与本章全文；题面不含命题、id、伏笔名。缺读者问题或读者问题含命题：`noReaderQuestion`，不做。没悬念：`noSuspense`，材料标 `twoChapters`。按输出 5 取前 3。
- 判一致的调用不在 `planCheck` 里（输入含试读的答案）：`judgeCall(point, truth, trialAnswer)`，校验有效性时用记录里的答案重算摘要。

### F4：`core/checks/run.ts`、`shared/checks.ts`、`record.ts`（新）

- 端口 `CheckModels`：`available(): Promise<code | null>`、`ask(role, request, signal): Promise<{ok, answer, usage} | {ok: false, code}>`。`ask` 把 `answer` 的名字换成 schema，核对后交回。
- `runCheck(plan, models, previous, signal)`：先 `available`，不可用回 `plot-check-unavailable`，不花钱。并发上限 4 跑完窄问题、固定调用与试读，再跑判一致。单次调用失败或结构不对时重试一次（`maxHttpAttempts` 是 1，中转站的偶发错误不该让前面二十几次都白花）；重试后仍失败就是 `plot-check-failed`，不存记录。
- 答案的校验（输出 6）：引文按切段后的原文核对（段内、试读在给它的材料内）。对不上的答案改成“看不出”并计 `badQuote`。试读改成“看不出”以后不判一致。固定调用：缺的规则项记 `incomplete`；新事实超过 30 条记 `unlisted`。新事实按第一处引文归段；带 `name` 的 `invention` 按那段线的 `lookup` 写法查世界，查到就不算（这一步在开始时的快照上算好表，`await` 之后不再碰视图）。
- 快照只在同步段用：`planCheck` 与新事实要的名字表都在第一次 `await` 之前算完（canon 项目内接口的约束）。
- 记录形状见 `shared/checks.ts`（版本 1，TypeBox）：`chapter`、开始时的世界版本与正文摘要、插件版本、段、补问清单、调用（`id, layer, role, question, digest, answer, usage`）、试读的材料清单、`unasked`、`unlisted`、`incomplete`、`badQuotes`、提示、用量。
- 远程合同 `nbook.plot/checks`（项目提供，调用方 browser、tui、server）：`run({chapter, followUps?})`（`effect: "write"`，调用方自己给 `timeout`）、`record({chapter})` 给 `{status: "none" | "valid" | "stale", record}`、`putSelfReport({chapter, value})`。正在跑的章放在进程内的一个集合里，重复回 `plot-check-busy`。

### F5：`plot/backend/server.ts`（新）：经 `nbook.models` 调模型

- 描述符 `locations` 加 `server`，`server/plugins.ts` 登记。入口 `location: "server"`、`dependencies: [{key: modelsKey, required: false}]`，提供远程合同 `nbook.plot/model`（`provider: "server"`、`callers: ["project"]`、`effect: "read"`）：`available({roles})`、`ask({role, system, user, schema, maxTokens})`。
- `ask`：`modelsKey.port().resolve({settings: {model: null, effort: null, approvalMode: "ask", readOnly: true}, purpose: "background", profile: "nbook.plot.check", role})`，组 `ModelRequest`（工具 `answer`、`toolChoice`），`call` 后取工具参数，连用量交回。解析失败的码（`role-unbound`、`no-credentials`、`unknown-model`、`no-model`）给 `available`；调用失败给 `{kind, code, retryable}`。**没有密钥经过这条通道**。
- 为什么放在剧情插件而不是给 `nbook.models` 加通用远程合同：现在只有这一个调用方；`nbook.models` 在 master 上还在改（分支落后 556 个提交）。第二个项目侧的调用方出现时再上移，代价是一个合同换位置，记待确认清单。
- 项目侧 `RemoteCheckModels` 实现 `CheckModels`：调不到（`not-provided`、`denied`、服务端入口没有）算 `plot-check-unavailable`。

### F6：`core/checks/diagnostics.ts`、`validity.ts`（新）

- `validity(view, record, tables)`：`planCheck` 重拼，比调用集合与每个摘要；判一致用记录里的试读答案。
- 诊断（输出 8）：记录有效才报，过期只报 `stale`。逐段的（`possibleSlip`、`forkSuspected`、新事实两项）在段的线的视图上报，只按章的（`earlyReveal`、`instructionViolated`、决策两项、提示）在这一章第一段的线的视图上报；都不晚于读取位置所在章。键按 Spec 的表；`Finding.params` 只放字符串和数。
- 声明随计算一起加：`check.*`、`decision.constraintViolated`、`decision.decidedInText`、`fs.objectTouchedInText`。`objectTouchedInText`：物件层答“动了”，且本章没有改这个物件的已写变更。`earlyReveal` 的对象追加挂在 K 上的读者守卫与决策。

### F7：`core/checks/ledgers.ts`（新）

`secretLedger`（保密以上，在给定线与位置上谁知道、误信、怀疑；读者从哪一段起）、`readerKnown`（最新一章末尾不是 `unaware` 的）、`revealDependencies(point)`（带指向 K 的揭示的计划、答案是 K 的悬念连节点、挂在 K 上的决策、写作指示文字含 K 的名字的章）。经 `nbook.plot/checks` 分页给出（`pagedList` 复用）。

### F8：`core/checks/fingerprint.ts`（新）：先比依赖的摘要

- 输出 7 允许“先比各项依赖的摘要、不同时才重拼”。摘要**只能多算不能漏**：依赖没变就直接用上次的结论；变了才 `planCheck`。
- 依赖：
  - 正文：第 N 章、上一章、记录的试读材料列到的章（`chapterTextDigest`）；
  - 写作指示、自陈的摘要，补问清单，插件版本，`stamp.declarationsDigest`，章序与各章讲的线；
  - 世界的前缀：段的线的视图上，最早的章（安放与各讲述的章取最早）不晚于 N 的变更；未排章的算全局。每条变更的摘要按对象缓存（世界不可变，`WeakMap`），按章滚动：`h(n) = sha(h(n-1), 第 n 章的摘要)`，一份视图算一次；
  - 条目：出场不晚于 N 的条目（没写出场的算全局），同样按对象缓存、按章滚动；
  - 决策：全部决策的摘要（决策要过 `involves` 才知道相关，写决策不频繁，多算可以接受）；
  - 后面的揭示：`revealTable` 里最晚的明说揭示在 N 之后的知识点集合；
  - 子线：祖先线的全部记录（带过去的值读父线切口到触发处，不在子线视图里）。
- `Verdicts`：章到 `{fingerprint, valid}`，只在内存里。诊断的计算先比，不同才 `planCheck`。
- **差分测试**（`core/checks/fingerprint.test.ts`）：随机改动序列（加变更、改初值、加条目、改决策、改正文、加后面的揭示、加分叉），每步比“走摘要的结论”与“总是重拼的结论”，相同。这条测试兜“只能多算不能漏”。
- `plot-scale.ts` 加载荷：1000 章都有记录。量两件事：(a) 在最新一章发布一次以后读待处理；(b) 改一个常出场条目的初值以后读待处理。预算：(a) 不让读待处理多过 20 ms；(b) 记下数字。(b) 全部重拼预计要几十秒，**(b) 超过 1 秒时**加分片校验：一次读只重拼 150 ms 以内，其余这次按过期报（参数 `verifying: 1`），后台接着校验，做完报新的数据版本（`reportDataVersion`），这之后的读取得到准确结论。Spec 输出 7 补这个过渡态。先量再定，不提前写。

### F9：真实模型与收口

- `plugins/plot/plot.llm.test.ts`：验收 1（卫兵认出勇者，改正文后消失）、验收 2（试读与泄底）用真实模型。用 `NBOOK_LLM_*`（gpt-6-luna，开发者 10-27 全面授权）配成自定义服务商，绑 `main` 与 `fast`。只验证“问得到、答得上、结构对、能落成诊断”，不断言模型一定判对（模型判错的情况记进证据，交 t26）。
- 实现审查：Opus 加 omp（快速审查）。

### 切片（阶段 F）

| 片 | 内容 | 提交边界与验证 |
|---|---|---|
| FS | Spec 补充 | `bun run docs:check` |
| F0 | 内核读取、上一章末尾改从正文取 | `test:affected`（nb-canon、plot），差分测试不变 |
| F1 | 三张表落盘、激活时读回 | `plot.test.ts` 真实项目子进程：写入、停掉重开、诊断仍在、数据版本相同 |
| F2 | 候选与预算 | `core/checks/*.test.ts`，验收 3 |
| F3 | 问题、试读、`planCheck` | 同上；总断言：试读的请求里没有命题、id、伏笔名 |
| F4 | 运行、记录、校验、`nbook.plot/checks` | 端口替身跑验收 1、4、5 的流程；失败路径（结构不对、重试、不可用、busy） |
| F5 | 服务端入口与模型通道 | `plot.test.ts`：项目子进程 → 服务端 → `nbook.models` → OMP 适配器 → 本机假端点（`Bun.serve`，同 `models.test.ts`），不用 mock；未绑角色时 `plot-check-unavailable` 且假端点收到 0 个请求 |
| F6 | 诊断与有效性 | 验收 1 到 5 的完整断言，含改正文变 `stale`、本章之后的世界变了仍有效 |
| F7 | 账本视图 | `core/checks/ledgers.test.ts` |
| F8 | 摘要、差分测试、规模 | 差分测试；`plot-scale.ts` 低负载量，证据 `scale-f8.txt` |
| F9 | 真实模型一遍 | `NBOOK_LLM_TESTS=1 bun run test --tier llm`，证据 `llm-f9.txt` |

每片做变异检查（改候选条件、引文核对、摘要字段、诊断的线），记进提交说明或证据。

### 验收映射（阶段 F）

| Spec | 测试 |
|---|---|
| checks 输出 1、knowledge 输出 10 | `points.test.ts` |
| checks 输出 2、5、11 | `candidates.test.ts`，验收 3 |
| checks 输出 3、6 | `run.test.ts`，验收 4、5 |
| checks 输出 4 | `trial.test.ts`、`run.test.ts`，验收 2 |
| checks 输出 7 | `validity.test.ts`、`fingerprint.test.ts`，验收 1 |
| checks 输出 8、decisions 输出 4、foreshadowing 输出 7 | `diagnostics.test.ts` |
| checks 输出 9 | `ledgers.test.ts` |
| checks 输出 10 | `run.test.ts` |
| 失败码 `plot-check-unavailable`、`plot-check-failed`、`plot-check-busy` | `plot.test.ts`、`run.test.ts` |
| 插件存储（输入；边界“旧版本的记录不读”） | `plot.test.ts`（重开）、`store.test.ts` |

### 不做与风险

- 不做：检查在写作流程里什么时候跑（t19、t20）、界面（t16）、提示词的校准（t26）。
- 模型判得准不准只在 F9 看一眼，真正的评估在 t26。提示词随实现改，所以输入摘要会随插件升级变，升级后的旧记录按过期报，这是 Spec 的结论。
- 摘要漏算依赖是最大的风险：有效性判错时作者看到过时的结论。差分测试用真实的 `planCheck`，覆盖 F8 列的每一类依赖。
- 校验有效性里全书重拼太慢，F8 量过再定分片校验。
- 记录超过 1 MiB 的上限（30 条新事实、23 次调用，每条引文上限 500 字）算不上现实风险；真超了 `save` 失败，按 `plot-check-failed` 报。
- `main` 角色 25 次调用的费用没量过。F9 记下一章的用量，交开发者看。
