# World Engine：读写合一进 CodeAct + mutation 精确编辑 + 表示法统一

> Active task。把 World Engine 的写/改/删从 RPC 工具搬进 CodeAct 沙箱，收敛成单一 `execute_world`（读写一体、deferred 事务），补上一直缺失的「精确编辑已有 mutation」能力，并统一沙箱内的时间 / 路径表示法。
> 本文是开工前的**设计契约基线**（四轮设计讨论的固化），实现报告按轮次在下方 Implementation Walkthrough 追加。

## Relative documents refs

- `docs/tasks/67-world-engine-zod-schema-codeact/README.md` —— CodeAct 查询 + Zod schema + 4-op patch 的架构来源。
- `docs/tasks/69-world-engine-tool-cleanup/README.md` —— 工具收口到 3 件套（query/write/delete）+ P0–P3；其 Follow-up「读面是否收敛为单一读语义」即本任务的起点。
- `docs/tasks/56-world-engine/agent-tools.md` —— **已严重过时**（§4 仍声称 `edit_world_slice` 等 8 工具「已接入」，与现网 3 工具不符）；本任务负责改写。
- `reference/world-engine/workflow.md`、`reference/world-engine/recording-principles.md` —— 写作模式 LOD / 录入原则，提示词侧需同步。
- 关键代码：`server/agent/tools/world-engine-tools.ts`、`server/world-engine/codeact-api.ts`、`server/world-engine/codeact-sandbox.ts`、`server/world-engine/world-engine.facade.ts`、`server/world-engine/world-engine.service.ts`、`assets/workspace/.nbook/agent/profiles/builtin/leader.default.profile.tsx`。

## User Request / Topic

- 起点：用户认为 World Engine **查询已经很强，但写 / 改很弱**。典型痛点：某条 mutation 写错（例如把 `/hp` 写成 `/HP`），现有 `write_world_slice` 改不了——它只能新增切面，`delete_world_slice` 又是整片物理删除。
- 讨论方向收敛为：**把读写都放进 CodeAct**，提供精确修改 mutation 的能力，工具统一返回 issue。
- 用户明确的几条产品判断：
  1. CodeAct 脚本**只负责返回数据**，issue 由运行时统一记录、统一返回，不靠脚本手动 return。
  2. **「Agent 改世界」不需要对用户透明**——不做审批、不做写/删动作的可视化或 audit 通道。
  3. 读写**合一**为单一工具。
  4. 可以提供 World Engine 的**日期格式化 / 解析接口**给沙箱。

## Goal

/goal 让 Agent 在单一 `execute_world` CodeAct 工具内完成 World Engine 的查 / 写 / 改 / 删，verified by：`bun test server/world-engine server/agent/tools`（含新增的读写合一、事务回滚、issue collector、editMutations、parseTime/formatTime、findRefs 批量、slices.withPatches 用例）全绿 + 重跑 `scripts/seed-world-engine-demo.ts` 端到端 E issues=0（含一条「故意写错 path 再用 editMutations 修正」演示）+ `bun run typecheck` 通过。Constraints：不改 reduce / issue 引擎语义（editMutations 复用已测 `service.editSlice`，引擎一行不动）；不回归 Workbench timeline / 全量状态视图；不破坏 writer 的 World Engine 只读边界。Boundaries：只动 `server/world-engine/**`、`server/agent/tools/world-engine-tools*`、相关 profile/reference/docs 与 seed 脚本；HTTP `server/api/projects/world-engine/**` 仅在必要时同步。Iteration policy：自底向上一层一测（service→facade→codeact-api→sandbox→tool→提示词），每步先证后写，绕道必须在本文记录。Blocked stop condition：若 deferred 事务在 libsql 下无法让纯读不持写锁、或 editMutations 复用 editSlice 时 A issue diff 出现偏差，停下报告卡点与证据。

## Current State（开工前查证的事实）

- **现网只有 3 个 World 工具**：`execute_world_query`（只读 CodeAct）、`write_world_slice`、`delete_world_slice`（`server/agent/tools/world-engine-tools.ts:161-223`）。
- **service / facade 早就有编辑能力，但没接出来**：`WorldEngineService.editSlice`（`world-engine.service.ts:167`，整块替换 + 重算 + 精确 A issue）、`WorldEngineFacade.editSlice`（`world-engine.facade.ts:54`）、`facade.getSlice`（`:64`）都在，Agent 工具层没有对应工具。`docs/tasks/56-world-engine/agent-tools.md:141` 还误称 `edit_world_slice`「已接入」。
- **编辑前「先读」做不到**：CodeAct 的 `world.slices()` 调 `listSlices` 时**没传** `withPatches`（`codeact-api.ts:176-182`），而 service 仅在 `withPatches` 时返回 patch 明细（`world-engine.service.ts:291`）。所以 Agent 看得到切面标题/时间，**看不到每条 mutation 的 path/op/value**。
- **两套时间表示打架**：沙箱内 `now()` 返回 bigint（`codeact-api.ts:189`）、`slices/searchText` 收 bigint，但 RPC 写工具强制日历字符串、禁 raw instant。读写合一后 `writeSlice({time})` 的类型会卡在中间。
- **两套路径语法混用**：写侧 `patch.path` 用 JSON Pointer（`/hp`），但 `searchText`/`findRefs` 返回的 `attr` 用点路径（`hp`、`memory.师门`）。
- **findRefs 是 N+1**：列出所有 subject 后**逐个** `queryState`（`codeact-api.ts:117-152`），几百 subject = 几百次串行 reduce。
- **执行路径分裂**：只读 CodeAct 走 `runWithModule`（非事务，`facade.ts:153-161`），写走 `runInTransaction`（write 事务，`:128-151`）。
- **沙箱信任模型**（67 Decision A）：CodeAct 不做真隔离（`checkAccess` 定义后从未调用），安全边界在 Agent 层。Agent 通过旧 `write_world_slice` 本就有等价**写权限**，故写进沙箱不新增「权限面」；但「写 + 事务在掐不死的沙箱里跑」是**新增的执行模式风险**（超时与 rollback 竞争），见 D14 / D15。

## Decisions / Discussion（四轮讨论已与用户确认）

- **D1 读写合一 + 工厂读写模式**：leader 合一为单一读写 `execute_world`（建议名，可调），走 `transaction("deferred")`——纯读不持写锁、遇写升级、脚本正常结束 commit、throw 全回滚。**不砍只读能力**：工具工厂新增 `mode: "readwrite" | "readonly"`（或更细的 allowedMethods）；leader 绑 readwrite，**writer 绑 readonly**——只读模式下沙箱不注入 writeSlice/editMutations/deleteSlice，且 description 隐藏写接口（writer 只读边界靠「沙箱不注入 + 提示词不提」双保险）。附带红利：脚本内多次读 = 同一致性快照；「补写到已存在切面」可在脚本里 `slices(from,to)` 判断后分支表达。单写者本地 SQLite 下 deferred 升级写锁基本不撞 BUSY。（审查修正：原「砍只读工具、只留一个读写工具」与 writer 只读边界冲突，改为工厂读写模式。）
- **D2 issue 三重保障（脚本可见 + collector 兜底 + 提示词约定）**：写方法**返回** `{sliceId, issues}`（deleteSlice 返回 `{issues}`），脚本里可见、可据此自查决定要不要 `throw` 回滚；同时运行时持有 issue collector，每个写方法把本次 issues 自动 push 进去，工具结果 = `{ data: <脚本 return>, issues: [<collector 累积>] }`——**issue 不依赖脚本 return**，漏不掉、也不受 10KB 截断影响。提示词加一句「不要把 issue 自己 return 出去」（collector 会统一附加，重复 return 既冗余又占结果体积）。（审查修正：原「写方法不返 issue」会堵死脚本内自查回滚，按用户意见改为可返回 + 提示词约束。）
- **D3 editMutations 薄封装 editSlice**：`world.editMutations(sliceId, edits, meta?)` 内部 = 读该 slice 全部 patch → 按 `patchId` 应用 edits 得到新数组 → 调 `service.editSlice` 整块替换。**引擎不动**，A issue 计算照常正确（editSlice 的 diff 基于 DB previousPatches vs 传入 next，改一条 diff 就一条）。`service.getSlice` 投影补 `patchId`（`WorldPatchRow.id` 已是 UUID，`types.ts:500`）。edits 形状：`{patchId, set:{path?/op?/value?/summary?}}` 改 / `{patchId, remove:true}` 删 / `{add:{subjectId,path,op,value,summary?}}` 增；`meta?:{time?,title?,summary?,kind?}` 顺带挪时间 / 改切面元数据。
- **D4 时间统一 instant(bigint) 为沙箱一等公民**：`writeSlice/editMutations` 收 instant；暴露 `world.parseTime(calendarStr)→bigint`、`world.formatTime(instant)→string`（复用 facade 已有的 calendar parse/format）。沙箱内用 instant 比较 / 算术，给人看时 formatTime。这与 RPC 层「对不写代码的调用只暴露字符串」的护栏原则不冲突。
- **D5 路径统一 JSON Pointer**：沙箱内读写两侧都用 JSON Pointer；`searchText`/`findRefs` 返回的 `attr` 也转成 `/...` 形态。
- **D6 findRefs 批量化**：逐个 `queryState` 改为一次 `queryState({subjectIds: allIds})`（service 内部 `Promise.all` 并发 reduce），把「串行 N 次」压成「一次并发」。彻底解（反向引用索引 / reduce 物化）属引擎级改造，留 follow-up。
- **D7 slices 暴露 withPatches**：`world.slices({from?,to?,limit?,withPatches?})`，避免逐个 getSlice。
- **D8 editMutations.add 不继承 C1**：writeSlice 的「首写 patch 带 type 自动建 subject」不下放到 editMutations；建新 subject 一律走 writeSlice，editMutations 专注「修已有切面」。
- **D9 写异常穿透 + 禁吞异常**：写校验错误（subject 不存在 / op 非法 / instant 冲突）清晰穿透沙箱；脚本 throw → 事务 rollback。**禁止 Agent 在写脚本里 try-catch 吞掉写错误后继续**（否则 commit 半成品）——提示词约束。
- **D10 改世界不对用户透明**：不做审批 / 不做写删动作可视化 / 不做 audit 通道。与既有「技术细节对用户透明，用户只看时间线+当前状态摘要」一致。
- **D11 return 契约**：脚本 return string → 原样作为 Agent 可见文本（鼓励写人读摘要）；return 对象/数组/数字/bool → JSON 序列化；空 / 不 return → 默认「执行完成」提示。无论哪种，issues 永远由运行时独立附加（D2）。这也顺手修了现状 `worldResult` 无脑 JSON.stringify 的小毛病。
- **D12 明确不做**：`now()` 保持同步快照（写操作 time 由 Agent 显式传、不依赖 now 实时刷新，改 async 反而破坏现有同步用法）；`get(id)` 保持摊平 attrs 的便利访问，不改成 `{id,type,name,attrs}`；不引入真沙箱隔离（沿用 67 信任模型）。
- **D13 工具 description 组织范式**：schema 只描述形状（参数级一句话 description）；长文档由 `buildExecuteWorldDescription()` 生成并挂 **tool.description**（对齐 `server/agent/tools/sql-tool.ts:185,201`，单处 builder 不算过度抽函数）；多行 `world.*` 签名 / 代码示例用 `profileText`（`server/agent/profiles/profile-text.ts`）dedent 排版，拆命名常量块（intro / API 参考 / 约束 / 示例）拼装；**不在 `Type.Object` 第二参塞巨型模板字符串**。落地前确认 harness 取 tool.description 还是 schema 第二参 description 作为主文档，对齐时别丢喂给模型的内容。现状问题见 `world-engine-tools.ts:20-92`（长文挂在 schema 第二参、与 `tool()` 的短 description 并存、三工具各一坨内联模板）。
- **D14 超时 × 写事务安全（开工第一步先证）**：现沙箱超时是 `Promise.race`，超时只 reject、**掐不死后台 JS**（`codeact-sandbox.ts:101-106`）；写进事务后，超时 reject → 外层 rollback，可此时后台还在 `writeSlice`，与 rollback 抢同一事务。**落地第一步先写测试验证 libsql「事务 rollback/关闭后继续 execute」的行为**：若抛错（大概率），采用 fail-safe——超时即 rollback + 关连接，后台写撞到已关事务自行抛错被丢弃，DB 保持回滚态；再配写脚本放宽超时 + patch 总量上限降低触发率。**别假设安全，先证再定策略**。此项与第 2 步 facade 事务改造一起做，不留到第 4 步。
- **D15 沙箱信任面扩大（已知接受）**：`checkAccess` 定义后从未调用（`codeact-sandbox.ts:74-79`），沙箱无真隔离（67 Decision A）。把**写 + 事务**塞进这个不隔离、掐不死的沙箱，风险敞口比只读时大。沿用 67 信任模型（安全边界在 Agent 层，Agent 本就有 facade 等价写权限），本任务不做真隔离；缓解靠 patch 上限 + 写超时 + 超时 rollback 兜底（D14）。
- **D16 已知边界（写进提示词 / reference）**：① editMutations 走 editSlice→replaceSlice（删 patch 行重插），会**清空该切面 events/memory 的已落库向量**，靠 searchText 惰性即时 embed 兜底（功能不破、性能要重算）；② replaceSlice 新 patch 是新 UUID，**editMutations 后 patchId 全失效**，连续编辑同切面必须重新 getSlice；③ editSlice 校验切面**全部** patch（含没改的），若有历史 patch 在当前 schema 下已不合法，编辑会被整体拒；④ `writeSlice` 收 instant 后须内部校验该 instant 可被项目 calendar format（`assertSqliteInstant` 只查 64 位范围、不查 calendar 可表示性），否则 timeline UI 会 format 异常。

## 目标 World API 形态（沙箱内 `world.*`）

```ts
// 时间转换（新）
world.parseTime(calendarStr): bigint     // 日历字符串 → instant
world.formatTime(instant): string        // instant → 日历字符串（给人看）
world.now(): bigint                       // 最新时间，脚本开始快照

// 读
world.get(id, {deref?, derefDepth?})      // -> attrs | null（摊平，保留便利访问）
world.gets(ids)                           // -> (attrs|null)[]，按输入顺序返回，不存在为 null
world.getMany(ids)                        // -> gets 的旧别名，兼容历史脚本
world.list(type?)                         // -> {id,name}[]
world.findRefs(targetId, sourceType?)     // -> {subjectId, attr}[]，attr=JSON Pointer；内部一次批量 queryState
world.searchText(query, opts)             // -> {subjectId, attr, text, score}[]，attr=JSON Pointer
world.slices({from?, to?, limit?, withPatches?})
world.getSlice(id)                        // -> {id,instant,title,summary,kind, patches:[{patchId,subjectId,path,op,value?,summary?}]}

// 写（readonly 模式不注入；返回值含 issues 供脚本自查，collector 仍自动兜底统一返回）
world.writeSlice({time, title?, summary?, kind?, patches})  // -> {sliceId, issues}；patch 仍支持首写 type/name 建 subject(C1)
world.editMutations(sliceId, edits, meta?)                  // -> {sliceId, issues}；薄封装 service.editSlice
world.deleteSlice(sliceId)                                  // -> {issues}
```

## Verification / Test

1. `bun test <abs>/server/world-engine`：读写合一新套件 + 现有引擎单测全绿（service editSlice/issue 单测不应改动）。
2. `bun test <abs>/server/agent/tools`：`execute_world` 工具 contract（合一、`{data,issues}`、string 回传、写后查、editMutations、事务回滚）。
3. `bun scripts/seed-world-engine-demo.ts <project>`：端到端 E issues=0，含「故意写错 `/HP` → editMutations 修正为 `/hp`」演示。
4. `bun run typecheck`：通过。
5. 验收边界：相对路径测试可能被 `product/` staged 镜像污染，按源码绝对路径验收（沿用 69 经验）。
6. **前置（D14）**：开工第一步先写 libsql「事务 rollback/关闭后 execute」行为测试，据结果定超时回滚策略，再动 facade 事务改造。

## Implementation Walkthrough

> 状态：**实现已落地，验证收口中**。以下保留开工分解，并在后方追加本轮实现报告；绕道与验证结果以报告为准。

**开工分解**

1. **service**：`getSlice` 投影补 `patchId`（小改，引擎不动）。
2. **facade**：新增 deferred 事务版执行入口（替代 / 并存于 `executeCodeActQuery` 的 runWithModule 路径）；把 issue collector 接进 `createWorldApi`，返回 `{data, issues}`。**同步落地 D14 超时×事务安全**（先证 libsql 回滚行为，再定「超时即 rollback + 关连接」的 fail-safe）。
3. **codeact-api**：注入 parseTime/formatTime；写方法 writeSlice/editMutations/deleteSlice（返回 `{sliceId, issues}` 供脚本自查，issues 同时入 collector 兜底）；getSlice（带 patchId）；slices.withPatches；findRefs 批量化；searchText/findRefs 路径转 JSON Pointer；editMutations 翻译逻辑（inline，仅此一处复用）。
4. **codeact-sandbox**：WorldApi 类型扩展；return 契约（string 支持 + issue 独立附加）；写脚本超时放宽（embedding 慢）、patch 总量上限；写异常穿透。
5. **world-engine-tools.ts**：3 工具收敛为 `execute_world`，工厂带 `mode`（D1）——leader readwrite、writer readonly（只读模式不注入写方法 + description 隐藏写接口）；description 按 **D13** 范式重写（schema 留形状 + builder 挂 tool.description + `profileText` 分块；内容含 instant + JSON Pointer + 写方法 + issue 通道）。同步改 `writer.profile.tsx` 工具绑定与提示词（仍只读）。
6. **提示词 + reference**：`leader.default.profile.tsx` 与 `reference/world-engine/workflow.md`——工具名 / instant+JSON Pointer 指引 / 三条写规则（脚本只 return 数据、不吞写异常、改错用 editMutations 别 delete 重写）；delete 文案改为只作整条作废。
7. **文档**：改写 `docs/tasks/56-world-engine/agent-tools.md`（去掉过时的 8 工具描述）；本文追加实现报告；`PROJECT-STATUS.md` 同步。

**测试影响矩阵**

| 测试 | 影响 |
|------|------|
| `server/world-engine` 引擎单测（editSlice/issue/reduce） | 不动（引擎不变） |
| `getSlice` 相关断言 | 加 `patchId` |
| `codeact*.test.ts` | 从只读扩到读写：事务回滚、issue collector、editMutations、parseTime/formatTime、路径统一、findRefs 批量、slices.withPatches |
| `world-engine-tools.test.ts` | 3→1 工具，重写 contract |
| profile 测试 | 工具名 / 绑定更新，profile TSX 编译需过 |
| writer 只读边界 | readonly 模式下沙箱无写方法、description 无写接口 |
| 超时 × 写事务（D14） | libsql 回滚行为 + 超时 fail-safe rollback，DB 保持一致 |
| 只读返回结构 | `execute_world` 统一 `{data, issues}`，现有只读查询调用/断言需更新 |
| editMutations 副作用 | 编辑后向量失效（searchText 兜底）、patchId 失效需重读 |

## TODO / Follow-ups

- [x] 确认工具命名 `execute_world`。
- [x] 按开工分解 1→7 落地。
- [x] seed demo 改为 `execute_world`，并加入 `/HP` → `/hp` 的 `editMutations` 演示。
- [x] `PROJECT-STATUS.md`、`docs/tasks/56-world-engine/agent-tools.md` 与 `reference/world-engine/` 当前协议同步。
- [x] 重编译 stale system profile artifacts 并跑 profile 测试。
- [x] 跑最终验证：`bun test <abs>/server/world-engine`、`bunx vitest run <abs>/server/agent/tools`、`bun scripts/seed-world-engine-demo.ts`、`bun run typecheck`。
- [ ] follow-up（按需，本任务不做）：findRefs 反向引用索引 / reduce 物化、自动批量向量化、`world.vectorize` 在写上下文暴露、`world.list()` 无 type 全量便利。
- [ ] 通知后续：69 遗留的前端 `WorldEngine*Mutation*` 组件改名与本任务无强耦合，仍单独一轮。

### Implementation Report

**底层与 CodeAct**

- `PatchInput` 增加只读投影字段 `patchId`；`getSlice` / `listSlices({withPatches:true})` 返回每条 patch 的 UUID，供 Agent 精确编辑。
- `WorldEngineService` 写入时间改为 `assertWritableInstant()`：既检查 SQLite int64 范围，也调用项目 calendar `format()` 确认 timeline 可展示。
- `executeCodeActWorld()` 新增 readwrite / readonly 模式，统一走 deferred transaction，返回 `{data, issues}`；旧 `executeCodeActQuery()` 保留为 readonly 兼容包装。
- `createWorldApi()` 注入 `parseTime` / `formatTime`，新增 `writeSlice` / `editMutations` / `deleteSlice`；写方法 issues 既返回给脚本，也进入 collector。
- `editMutations` 薄封装 `service.editSlice`：先读完整 slice，按 `patchId` 应用 set/remove/add，再整块替换；编辑后 patchId 重建。
- `findRefs` 改为一次批量 `queryState({subjectIds})`，`findRefs` / `searchText` 返回 attr 统一为 JSON Pointer。
- `world.slices()` 支持 `withPatches`，`world.getSlice()` 暴露完整切面。

**Agent 工具与 profile**

- `server/agent/tools/world-engine-tools.ts` 收敛为单一 `execute_world`，工具 description 由 `buildExecuteWorldDescription(mode)` 生成。
- readonly 模式不注入写方法，description 也不展示写 API；当前 writer profile 绑定 readonly，leader.default / world.engine 绑定 readwrite。
- `server/agent/tools/index.ts` 与 `server/agent/profiles/profile-tools.ts` 改为 `builtin.world.execute`。
- `leader.default.profile.tsx`、`world.engine.profile.tsx`、`writer.profile.tsx` 的提示词已同步单工具、instant、JSON Pointer、issues collector、writer 只读边界。
- profile artifact compiler 修复 `require.resolve()` 返回裸 specifier 时的 external 标记问题，避免 `node-fetch` 这类依赖导致 esbuild 插件报非绝对路径。

**Seed 与文档**

- `scripts/seed-world-engine-demo.ts` 改为全程通过 `execute_world` 写入、查询、校验。
- seed demo 在“遗迹余波”切面故意写入 `/HP`，随后用 `world.getSlice()` 取 `patchId` 并通过 `world.editMutations()` 修正为 `/hp`；最终 E issues=0。
- 额外迁移 `scripts/write-chapter-01-slices.ts` 与 `scripts/seed-heroes-story.ts`，避免可执行脚本继续查找旧三工具。
- `docs/tasks/56-world-engine/agent-tools.md` 已从旧固定工具说明改写为当前 `execute_world` 契约。
- `PROJECT-STATUS.md` 与 `reference/world-engine/README.md`、`quick-reference.md`、`subject-lifecycle.md`、`recording-principles.md`、`workflow.md`、`schema-system.md`、`calendar-system.md`、`api-migration-zod.md` 已同步当前协议；旧工具名仅保留在历史 / migration 对照语境。

**验证记录**

- 已通过：`bun test C:/Users/notnotype/Documents/CodeRepository/GithubProjects/neuro-book/server/world-engine`，119 pass。
- 已通过：`bunx vitest run C:/Users/notnotype/Documents/CodeRepository/GithubProjects/neuro-book/server/agent/tools`，111 pass。
- 已通过：`bunx vitest run C:/Users/notnotype/Documents/CodeRepository/GithubProjects/neuro-book/server/agent/profiles/world-engine-profile.test.ts C:/Users/notnotype/Documents/CodeRepository/GithubProjects/neuro-book/server/agent/profiles/leader-assets-profile.test.ts C:/Users/notnotype/Documents/CodeRepository/GithubProjects/neuro-book/assets/workspace/.nbook/agent/profiles/builtin/writer.profile.test.ts`，16 pass。
- 已通过：`bun scripts/seed-world-engine-demo.ts`，11 个切面写入成功，`/HP -> /hp` 修正成功，E issues=0，全部断言通过。
- 已通过：`bun run typecheck`。
- D14 竞争测试证明：`execute_world` 超时后事务关闭，后台定时器再尝试写入不会落库。

**与原计划出入**

- D14 原计划要求“先证 libsql rollback/close 后后台 execute 行为”。实现未改成可杀死 JS 沙箱，仍沿用 `Promise.race`，但新增竞争测试直接覆盖超时后后台继续写入的危险窗口；当前证据显示事务关闭后后台写入不会落库。
- 为了让 profile 编译通过，额外修复了 profile artifact compiler 对裸 package specifier 的处理；这是 Task 71 profile artifact 生成的必要绕道。
- 为了让 `server/agent/tools` 全目录验证稳定通过，额外修复了 `execute_sql` 切换 Project 时未 await 关闭旧 libsql client 的句柄释放问题，并放宽两个 Windows / harness 慢测的测试清理与超时窗口；不改变工具用户可见行为。
