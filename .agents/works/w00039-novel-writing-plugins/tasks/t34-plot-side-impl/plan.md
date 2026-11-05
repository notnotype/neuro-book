# t34 实施计划：剧情侧的实现

## Context

开发者 2026-11-05 批准了剧情侧的 12 份 Spec（t33，分支 `feat/w00039-t29-canon-kernel` 的 ad3d802c1，`status: planned`）。本 Task 把它们实现到内核 nb-canon、canon 插件与一个新的剧情插件里。

依据：
- 提案：`docs/proposals/world-engine-plot-side.md`（已接受）；
- ADR：0041（内核只加通用机制）、0042（世界线是每条线一份线性视图）、0043（两种先后与时间）；
- Spec：`docs/specs/canon/` 的 model、components、revisions、project、worldlines、time，`docs/specs/plot/` 的 knowledge、foreshadowing、goals、decisions、brief、checks；
- 原型：t32 的 `prototype/worldline/lines.ts`（按值比对的更新）、时间约束网络的原型（`evidences/time-examples.txt`）。

已定的约束：
- 代码与 Spec 都在内核分支上，开发者允许前不合并进 master，不 push；
- nb-canon 只依赖 TypeBox 与 MDX 解析库，前后端共用（11-02 定）；
- 剧情插件照 canon 插件做成应用里的内置插件（11-05 定）。

工作方式：分 6 个阶段，按提案的实施先后排。本计划把阶段 A 写到能照着实施，B 到 F 只写范围与依赖，每个阶段开工前在本文件里补细，再审一次计划。

## 技术选型

| 问题 | 选用 | 理由；否决了什么 |
|---|---|---|
| 标注载荷的 JSON Schema 校验 | TypeBox 1.x 的 `typebox/schema`（`Check`、`Errors`） | nb-canon 已依赖 TypeBox 1.3.6，它能直接校验标准 JSON Schema；否决 ajv：新依赖，而且靠 `new Function` 生成代码，浏览器在严格 CSP 下不能用 |
| 摘要（SHA-256） | 内核现有的、宿主注入的 `digest` 端口 | 同步，前后端都能用；否决 Web Crypto：只有异步接口，会把读取全改成异步 |
| 规范的 JSON（RFC 8785） | 现有的 `stableStringify`（`src/core/stable-json.ts`） | 键按 UTF-16 码元排序、数用 `JSON.stringify` 的写法，与 RFC 8785 一致；在它的模块头写明这一条，加 RFC 8785 附录的几个向量作测试 |
| 时间约束网络、历法 | `nb-time` 自写（阶段 C） | 提案定为无依赖的包；自定义历法没有现成的库（Temporal、date-fns 都只有公历）；最短路与负环检测是几十行的 Bellman-Ford |
| 剧情插件的纯计算放哪 | 插件目录里的纯 TS 模块（`packages/neuro-book/src/plugins/plot/core/`），不新建包 | 现在只有这一个使用方；模块不引应用代码，以后要拆包是机械的；否决新包 `nb-plot`：多一套发布与边界登记，眼下没有收益 |

## 关键设计（阶段 A：内核的基础机制）

### `packages/nb-canon/src/core/schema.ts`：格式 2 的形状

- 讲述 `TellingSchema` 改成 model 输入的形状：`id`、`source`、`chapter?`、`quote?`、`nth?`、`anchor?`、`marks?`。按来源的必填项由 `validate` 查（`invalid-telling`），schema 只管形状。
- 剧情变更加 `nature?`、`cast?`、`marks?`；`when?`、`fork?` 与安放的 `line` 在各自的阶段（C、D）加，到时只加可选字段，日志格式仍是 2。
- `QuestionSchema` 换成 `DecisionSchema`（model 的决策表）；对象种类 `question` 改名 `decision`，id 前缀从 `q` 改成 `d`（`src/core/ids.ts:8`）。
- 写入请求加 `authorizations?`；修订加 `authorizations?`。
- 修订的 `what` 在日志行里仍是文字（旧读者显示“其它”，revisions 边界与兼容）。
- 日志 `format: 2`：`src/node/log.ts:134、156`。格式 1 的行按“不认识的格式”只读（project 输出 2、4）。样本回放的转换脚本 `tests/sample/convert.ts` 跟着改。

### `packages/nb-canon/src/world/references.ts`（新）：引用位置统一处理

- 取代 `world.ts:545–594` 按键名的三张表（`ID_KEYS`、`ID_LIST_KEYS`、`REFERENCE_KEYS`）与 `referencedIds`。
- 一个函数列出对象里的全部引用位置：`referencesOf(object, kind, registry, marks) => {path, target: entry | change | line | decision | check, value}[]`，按 components 输出 18 的五类表；字段与列表的引用从 Component 登记取，标注的从标注种类登记取。地址里的条目单列，只做临时 id 替换。
- 用到它的地方：临时 id 替换（`#publish` 第 3 步）、写入校验（`ref-invalid`）、依赖（`dependsOn`）、改动记录按条目筛（`service.ts` 的 `revisions`）。
- 不变量：替换与依赖用同一份位置清单，避免两边漏的不一样（第一轮审查 S1 第 3 条的教训）。

### `packages/nb-canon/src/components/`：引用种类、以引用为键的列表、标注种类

- `registry.ts`：
  - 字段种类加 `ref`；字段声明加 `targets`、`keyedBy`、`carry`；列表元素的子字段允许 `precision: semantic`（components 输出 18 到 20）。
  - 字段声明的检查沿用 `fieldsProblem`。
- `apply.ts` 的 `listAdd`：以引用为键的列表，元素 id 就是条目 id，`label` 不存、读取时取被引用条目的名字（`engine/views.ts`）。
- 新文件 `marks.ts`：标注种类的登记 `buildMarkRegistry(declarations)`：
  - 白名单关键字、`refs` 的路径与 `kind`、前缀与重复两步判定（components 输出 17）；
  - 校验载荷用 `typebox/schema` 的 `Check`、`Errors`。
- 登记集合的摘要（`registry.ts:105` 的 `digest`）扩成三项：Component、标注种类、诊断。引擎据它判断要不要整本重建。

### `packages/nb-canon/src/world/tellings.ts`（新）：讲述的发生点与生效

- `locate(chapterText, quote, nth)`：按 model 输出 24 切段、找原句、数第几处，给出发生点或失联的原因；结果按章正文的摘要缓存。
- 读者读过的讲述（model 输出 27）按活页夹章序、段、偏移、讲述 id 排。
- 正文从现有的 `WorldOptions.chapterText` 取。宿主改正文时调新加的 `textChanged(chapter)`，清掉这一章的缓存，世界版本不变（project 输出 25）。
- 失联与重复原句是提示，不进待处理（输出 26、34）。
- 讲述 id 前缀 `t`，在讲述所在的列表里全局分配，不复用；修订路径改成 `told[id]`（revisions 输入）。

### `packages/nb-canon/src/world/world.ts`：写入路径的新校验

- `validate`（`world.ts:637–786`）按 revisions 输出 3 加：讲述的形状、标注、引用、参与者、叙述、决策挂的对象、决策的转换。
- 参与者：`who` 写成马甲的，存成本体加 `as`（model 输出 29），在 `fillDefaults` 里做。
- 决策：状态表与转换做成一张数据表（`src/world/decisions.ts`），`validate` 与授权的检查共用，不在两处各写一份条件。

### `packages/nb-canon/src/world/authorization.ts`（新）：作者授权

- `bindsOf(request, decisionRef, transition)`：
  - `request` 摘要：请求去掉 `authorizations` 与 `baseVersion`；
  - `fields` 摘要：受限字段的固定集合；
  - 都在临时 id 替换之前、按请求原样算（revisions 输出 21）。
- 校验交给宿主注入的 `verifyAuthorSource(source, binds)` 端口，没有端口时一律不通过。
- 出处 `source` 只由内核写；请求里改了它得到 `source-not-writable`。
- 还原：`World.revert` 先算补偿，再从补偿里找出需要授权的决策转换，给出 `{decision, transition, fields}`，供 `preview` 与 `author-source-required` 的详情用。

### `packages/nb-canon/src/world/diagnostics.ts`（新）：诊断贡献点与待处理

- 诊断的登记表（model 输入）与项目内接口：`registerDiagnostics(pluginId, {compute, dataVersion})`、`reportDataVersion(pluginId, version)`。canon 插件把这个接口作为项目内服务提供给别的插件。
- 读待处理时（带模式），对每个启用的诊断同步调用 `compute(world, at, mode)`，然后：
  1. 去重；
  2. 截到 1000 条；
  3. 按挂在诊断上的已定决策分出已处理；
  4. 与内核自己的待处理一起按全序排（model 输出 16、34、35）。
- 计算的耗时记进 `status`（project 输出 26），不进读取结果。
- 待处理排序表 `PENDING_KIND_ORDER` 现在三处各写一份（`reference.ts:41`、`incremental.ts:93`、`world.ts` 的分组）。收成一处，并加上提示组与排序 id。

### `packages/nb-canon/src/service/service.ts` 与 canon 插件：读取输入、游标、视图、新方法

- 读取输入的摘要（model 输出 36）由服务按读取时的输入算，所有读取结果都带它；游标绑定它（project 输出 19）。
- 新方法：
  - `tellings`、`presence`、`decisions`（取代 `questions`）；
  - `pending` 加模式、组与游标；
  - `openView`、`closeView`、`viewAudit`；
  - `preview` 收还原请求。
- 视图令牌的寿命跟调用方实例走，与现有的独占租约同一套释放路径（`PL/backend/plugin.ts:61–67`）。
- canon 插件（`packages/neuro-book/src/plugins/canon/`）：
  - `shared/contracts.ts` 加这些方法与 `textChanged` 事件；
  - 新增贡献点 `canon.marks`、`canon.diagnostics` 的声明（与 `shared/components.ts` 同一种写法）；
  - `backend/world-host.ts` 在正文文件变化时调 `textChanged`，接上 `verifyAuthorSource`：由宿主给，没有时不注入。

## 阶段 B 到 F（开工前在这里补细）

- **B 剧情插件：知情与伏笔**（plot/knowledge、foreshadowing）
  - 插件骨架 `packages/neuro-book/src/plugins/plot/`：描述符，登记 Component、标注种类、诊断；
  - 纯计算在 `core/`：有效知情、读者的知情、经历、伏笔阶段；
  - 按视角过滤的视图建在内核的 `openView` 上。
  - 依赖阶段 A。
- **C `nb-time` 与时间说法**（canon/time）：
  - 新包 `packages/nb-time`：历法、说法、网络、查询；
  - 内核加 `when`、`time` 方法与时间的待处理。
  - 依赖阶段 A，与 B 互不依赖。
- **D 世界线**（canon/worldlines）：
  - 线层：线视图、带过去的值、计划跨线、按值比对的更新、常驻与淘汰、计划线、活页夹章讲的线；
  - 内核加安放与读取位置的 `line` 与分叉；
  - 时间网络按线算；剧情插件的回溯知情（knowledge 输出 4）。
  - 依赖阶段 A、C。
- **E 目标、决策的守卫、写作指示、写手的上下文**（plot/goals、decisions、brief）。依赖阶段 B、D。
- **F 写完以后的检查**（plot/checks）：
  - 窄问题、试读、检查记录（插件的项目记录）、自陈与写作指示的存处；
  - 模型调用经应用的模型角色（[模型角色的后端契约](../../../../../docs/proposals/model-roles-contract.md)）。
  - 依赖阶段 E。

## Spec 与文档改动

- 实现时发现 Spec 写不通的地方，先改 Spec（在分支上）再改代码，并在 Task 里记一行。
- `packages/nb-canon/README.md`、`AGENTS.md`：模块表加 references、tellings、marks、authorization、diagnostics。
- canon 插件的 `docs/`（如有）同步方法表。

## 切片（阶段 A）

每片一个提交，提交前在 nb-canon 包目录跑 `bun test`，在应用包跑 canon 插件的两个测试；差分测试（`tests/differential.test.ts`）每片都要过。

1. **A1 格式 2 与决策改名**：schema、ids、log 的格式，`question` 改成 `decision`（只换形状与名字，状态表留到 A6），样本转换与回放跟着改。
2. **A2 引用位置**：`references.ts`；`ref`、`keyedBy`、元素语义档；替换掉三张键表。
3. **A3 讲述**：id、发生点、失联、读过的讲述、`tellings` 方法、`textChanged`。
4. **A4 标注种类**：`canon.marks` 登记、载荷校验、只读规则；标注挂在讲述、剧情变更、决策上。
5. **A5 参与者、在场、叙述**：`cast`、`presence`、`nature: narration`、本章涉及的条目。
6. **A6 决策与作者授权**：状态表、转换与字段去留、建议、挂的对象、授权与校验端口、还原的授权与预览。
7. **A7 诊断贡献点与待处理**：登记、项目内接口、计算与截断、已处理、全序、提示组、`pending` 的模式与分页。
8. **A8 读取输入、游标、视图与插件接线**：读取输入的摘要、游标、`openView`、远程合同与浏览器客户端、规模测量重跑。

A8 之后做一次实现审查（后端，按 reviewing Skill；omp 额度恢复前派 Claude Opus 子代理），处理完再进阶段 B。

## 验收映射（阶段 A）

| Spec 条目 | 测试 |
|---|---|
| model 输出 24 到 27、场景 7 | `tests/tellings.test.ts`（新） |
| model 输出 28、components 输出 17、场景 6 | `tests/marks.test.ts`（新） |
| model 输出 29、30、场景 8 | `tests/model.test.ts` 新增一组 |
| model 输出 31 到 33、状态表、场景 9；revisions 输出 21、场景 7 | `tests/decisions.test.ts`（新） |
| model 输出 16、34、35、36、场景 10 | `tests/diagnostics.test.ts`（新） |
| components 输出 18 到 20、场景 5；revisions 输出 12、14 | `tests/references.test.ts`（新）与 `tests/revisions.test.ts` 补用例 |
| project 输出 2、19、24、25、26、27、场景 8、9 | `tests/service.test.ts` 补用例；`canon.test.ts` 补视图的远程用例 |
| 不变量：增量与参照一致 | `tests/differential.test.ts`：随机序列加讲述、标注、参与者与决策的修改 |

测试名照现有写法引用编号（“Spec canon.model 输出 24”）。

## 验证

- 每片：nb-canon `bun test`；应用包 `bun test src/plugins/canon/`。
- A8 之后：`bun run test:affected`；样本回放（`tests/sample.test.ts`）；规模测量 `bun scripts/perf/canon-scale.ts`。按 project 输出 14 对照：讲述定位在读取时算，会不会拖慢随机读与发布，要量出来。
- 不跑 e2e：阶段 A 不改界面。

## 不做与风险

- 不做：界面（t16、t31）；Agent 工具（t20）；写作流程（t19）；合并进 master。
- **讲述定位的开销**：每次读取都按正文定位。按章正文的摘要缓存，A3 写一个三百万字规模的基准；超出 project 输出 14 的预算时，先在 Task 里记下，再找开发者。
- **诊断同步计算阻塞**：Spec 已接受没有 CPU 上限。A7 的测试用一个故意慢的诊断，验证耗时进 `status`、读取照常返回。
- **作者来源的签发方还没有**：宿主侧的签发属于 Agent 工具（t20）。阶段 A 只做内核的校验端口；测试用一个按合同签名的测试端口（同一密钥签、同一函数验），与将来宿主的实现对齐合同。
- **决策改名牵动的范围**：A1 先用 `rg` 列出 `question` 的全部用处（内核、插件、样本、界面原型），一次改完。
