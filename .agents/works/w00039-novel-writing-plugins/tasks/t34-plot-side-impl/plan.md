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
| 摘要（SHA-256） | 宿主注入的 `digest` 端口（`service.ts:35`） | 同步；服务端由 Bun 提供。浏览器侧要用时同样由宿主注入同步实现，nb-canon 不自带。否决 Web Crypto：只有异步接口，读取会全改成异步 |
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
3. **A3 引用与替换**：`references.ts` 的引用位置、修订的 `refs`、依赖与改动记录读 `refs`、`ref`、`keyedBy`；替换掉三张键表。实施时改了一处：临时 id 的替换不另列清单，按保留写法替换（与这次发出的某个临时 id 完全相同的字符串，加上地址路径里的 `[临时 id]` 段），天然包含全部引用位置。
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
| components 输出 18 到 20、场景 5；revisions 输出 12、14 | `tests/references.test.ts`（新）与 `tests/revisions.test.ts` 补用例 | A3 |
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
