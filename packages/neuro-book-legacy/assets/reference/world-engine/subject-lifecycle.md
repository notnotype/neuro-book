# World Engine — Subject 生命周期

本文讲清 **subject（主体）** 在 World Engine（世界引擎）里的生命周期：什么是 subject、如何注册、init slice 怎么落、状态如何随切面演化、reduce 如何把切面序列算成任意时刻的状态。读者是需要在世界引擎里管理主体状态的 Agent。本文只讲原理与契约，不讲"第一步、第二步"的操作流程；理解契约后如何操作由 skill 层指引。

> 边界提示：World Engine 第一版**不接旧 simulation workflow，也不依赖 Plot 系统**。本文涉及的状态记录全部走世界引擎工具，不要把 subject 状态写进 `simulation/` 文件或 plot 工具。

## 1. 什么是 subject

**subject 是参与世界模拟、能独立演变状态的主体。** 它不限于人物——王国、大陆、物品、任务、阵营都可以是 subject。

判断一个东西要不要建 subject，标准只有一条：**它有没有"独立的、需要随时间追踪的状态"。**

- 主角艾莉娜会移动、受伤、改变心理 → 是 subject。
- 凤凰王国有国库、有都城、会立国会衰亡 → 是 subject。
- 一个任务有 status / progress / log，会从 active 走到 done → 任务本身就是 subject。
- 一把会附魔、会损坏、有持有人差异的剑 → 是 subject。
- 三瓶普通血药、一根火把、十枚金币 → **不是** subject，它们只是某个角色 `inventory` collection 里的元素。

口诀沿用 simulation entity 规则：**三瓶普通血药是 inventory 计数；一瓶被下毒的血药才是 subject。** 关系（"在哪""属于哪个阵营""被谁装备"）不是独立的第三种东西，而是某个 subject 上一个值为 `ref` 的属性，随切面演化，不需要单独建模。

subject 的类型由项目 schema（`world-engine/schema/index.ts`）按"类型"声明：`character` / `quest` / `location` / `item` / `faction` / `world`…。一个类型是一份模板，100 个 NPC 共享一份 `character` schema。引擎本身不预设世界观，只认识抽象概念（subject / slice / instant / patch / op / reduce）；"hp""国库"是什么，全部由项目 schema 表达。

## 2. subject 创建：首次写入自动创建

subject 不需要单独注册。**首次对某个 subject 写入切面时，World Engine 会自动创建该 subject**。这意味着"注册身份"和"写入首条状态"合并成一个操作：

```typescript
// 首次写入 erina 时自动创建 subject：在某条 patch 上声明 type（必填）+ name（可选）
await world.slice.write({
    time: world.time.parse("公元2020年4月12日 18:00"),
    title: "艾莉娜转生到祭坛",
    patches: [
        { subjectId: "erina", type: "character", name: "艾莉娜", path: "/hp", op: "replace", value: 100 },
        { subjectId: "erina", path: "/location", op: "replace", value: "subject://altar-01" },
    ],
})
```

关键契约：

- **`subjectId` 全局唯一，不能为空白。** 首次出现某个 subjectId 时会创建 subject。重复 id 会复用已有 subject（不会创建第二个）。
- **`type` 必须是 schema 已声明的类型。** 首次写入时必须在该 subject 的某条 patch 上明确指定 `type` 字段（如 `{ subjectId: "erina", type: "character", ... }`），可选附 `name`。subject 已存在后再写时 type/name 被忽略，可省略。
- **Agent 脚本里 `time` 用 instant bigint。** 先用 `world.time.parse("项目日历字符串")` 转换；给用户展示时再用 `world.time.format(instant)`。
- **schema default 会自动应用。** 如果 schema 为该 type 声明了非空 default，创建 subject 时会自动生成初始值（作为 init patch 写入）。

**与旧 `create_world_subject` 的差异**：

- 旧版需要先调用 `create_world_subject` 注册，再用旧写入工具写入状态。
- 新版合并为一步：首次 `world.slice.write` 时自动创建 subject。
- 好处：减少一次 API 调用，避免"忘记注册导致 dangling-ref"的错误。

## 3. 切面是状态变更，不是快照

subject 注册后，它的状态变化全部由**切面（slice / 切面）**承载。一个 slice = **一个时间点 + 一组 patch**：

```typescript
interface Slice {
    id: string;
    instant: string;       // BigInt 时间戳（唯一时间真相源，持久化为 string）
    kind?: string;         // timeline 分类标签，默认 event，不参与 reduce
    title: string;
    summary?: string;
    patches: Patch[];      // 这一刻发生的所有变更
}

// 一条 patch：对某 subject 的某个 JSON Pointer path 做某 op
interface Patch {
    subjectId: string;     // 改谁
    path: string;          // JSON Pointer，如 /hp、/equipment/weapon
    op: string;            // replace / increment / remove / append
    value?: unknown;       // 普通 remove 省略；collection remove 可提供 value 按 stable JSON 值删除元素
    summary?: string;      // 人类可读摘要
}
```

关键性质：

- **切面是增量（delta），不是全量快照。** 世界不存"当前状态"，只存切面序列。这个选择是被需求锁定的：核心诉求是"往前插切面补历史/补设定"。全量快照在往前插时会让所有后续快照失效；增量模型则让后续变更自然叠加，对补历史天然友好。
- **同一 instant 只能有一个 slice。** 同一刻发生的多 subject / 多 path 变化，必须放进同一个 slice 的 `patches` 数组。`world.slice.write` 遇到目标 instant 已存在会报错；要补同一时刻的内容，先用 `world.slice.list({withPatches:true})` 或 `world.slice.get(sliceId)` 读出已有切面，再用 `world.slice.editPatches()` 精确添加 patch。
- **补过去与写当前是同一个工具。** 给 `world.slice.write` 传一个比当前最新切面更早的 `time`，timeline 自动按底层时间戳归位。这就是"溯源"——为角色补一段早年经历，就是在更早的 instant 上插一条切面。

**精确编辑已有 patch（Agent `world.slice.editPatches`）**：先读取完整切面拿到 `patchId`，再按 patchId 修改、删除或新增 patch：

```typescript
const slice = await world.slice.get(sliceId);
const wrong = slice.patches.find((patch) => patch.path === "/HP");
await world.slice.editPatches(sliceId, [
    {patchId: wrong.patchId, set: {path: "/hp", summary: "修正 HP 路径大小写"}},
]);
```

`world.slice.editPatches` 内部复用 `editSlice` 整块替换该切面的 patch 行，因此编辑后原有 `patchId` 全部失效；连续编辑同一切面必须重新 `world.slice.get`。新增 patch 可用 `{add:{...}}`，但 `add` 不负责首写创建 subject，建新 subject 仍走 `world.slice.write`。

## 4. reduce 语义

**任意时刻的世界状态 = 该时刻前所有切面，按 `instant` 升序、同一 slice 内按 patch 顺序 reduce 出来的结果。** 这是经典 event sourcing。

- **截断时间 `at`**：reduce 只叠加 instant ≤ `at` 的切面，更晚的切面不参与。倒叙、回忆 = 把 `at` 设到更早的时间点。
- 例：主角的出生切面在复兴历 470 年。查询 `at = 复兴历 200 年` 时，出生切面被截断，主角**尚不存在有效状态**——"倒叙看 200 年时主角还没出生"天然成立。
- **reduce 永远只算单个 subject，引用不自动展开。** `reduce(艾莉娜).equipment.weapon` 返回 `subject://sword-01` 这个 ref 值本身，**不**把剑的状态嵌进来。要剑的状态，调用方自己再 reduce 一次 sword-01。原因是自动解引用会引发递归、循环引用、"解到哪层停"的难题。谁要关联视图，谁自己组合多个 reduce 结果。

同一批切面，传不同 `at` 就 reduce 出不同时代的世界；reduce 出"当前值"和 reduce 出"历史轨迹"用的是同一批数据，只是聚合方式不同。这是模型的核心价值。

## 5. 状态演化的典型形态

每个属性在 schema 里绑定一个 **kind**，kind 决定它接受哪些 op、reduce 怎么叠加。属性的演化形态因此分三类：

**scalar（标量）——用 `replace` / `increment` / `remove`。**
- `replace` 是绝对值："等级升到 5""status 改成 done""hp 设为 80"，后写覆盖前值。
- `increment` 是相对增量（仅数值有效）："扣 30 血"写 `/hp increment -30`，在当前值上累加。
- `increment` 的价值是**架构性的**：它可交换，对"往前插切面"稳定——前面再插一条扣血切面，本条 `increment -30` 不用改，reduce 自动正确。`replace` 是绝对值、对插入敏感。所以日常数值变化优先考虑 `increment`。

**list（有序流）——用 `append`（也支持整组 `replace`）。**
- `append` 是**只增的有序流**追加，语义对齐经历流（events）、任务日志（quest.log）。
- list **故意不支持中间插入**：要往"过去"补一条经历，正确做法是**往更早 instant 插一个切面**，而不是在现有 list 中间塞元素，否则破坏"events 顺序 = 切面 instant 顺序"的不变量。

**collection（无序集合）——用 `append` / `remove`（也支持整组 `replace`）。**
- 集合元素可增可删、无序、按 stable JSON 值去重，语义对齐背包物品、附魔列表、宗门弟子。
- `append` 按值去重追加；`remove` 不带 value 时删除指定 path，带 value 时只对 collection 有效，按 stable JSON 值删除匹配元素，找不到时幂等。list 不支持按值删。

**object（嵌套结构）——对子路径做 `replace` / `remove`，或整体 `replace`。**
- 有 `fields` 是固定结构（如 `equipment.head` / `equipment.weapon`），无 `fields` 只有 `itemType` 是开放字典（如 `memory.师门`，key 运行时增减）。
- 日常优先打**细路径**（`replace /equipment/weapon`）保留逐槽位历史；整体 `replace /equipment = {...}` 留给"换一整套装备"这类真整体操作。

**历史轨迹不需要专门存储。** "hp 随时间的曲线"= 遍历所有打在 `/hp` 上的 patch（每条带 instant + op + 值），从切面序列直接得出。不存在"track 旧值"的机制，也不需要为成长史单独建表。

## 6. 回退能力

删除切面可通过 Agent `world.slice.delete`、Workbench 或 HTTP `deleteSlice` 完成：

```typescript
await world.slice.delete(sliceId) -> { issues: WorldIssue[] }
deleteSlice(projectPath, sliceId) -> { issues: WorldIssue[] } // HTTP / Workbench
```

- **物理删除，不可恢复。** 删除某条切面后重新 reduce。没有旧值字段做 O(1) 逆操作，也没有可恢复的撤销。
- **第一版没有通用 rollback / revert slice。** 也不自动补写、不自动改写后续切面。
- 删除会返回受影响 subject 重新 reduce 后的 E issues。如果删掉的是某个相对 op 的基准切面，下游的 `increment` / `append` 可能因缺基显形 `broken-relative`（见 §7）。
- 删除切面**不会**自动删除 subject 身份。例如删掉"捡到剑"那条切面，`sword-01` 这个 subject 仍然存在，只是不再被任何切面引用。

subject 身份是稳定登记，不是由当前 patch 数量推导出的缓存。即使删除了它的唯一切面，`WorldSubject` 行仍保留，因此同一 id 后续继续写入时会复用原 type/name，也不会重新应用 schema default。列表中出现 0 patch 的 subject 是这一契约的直接结果，不是 reduce 数据损坏。

第一版不提供通用 `world.subject.delete()`。持久层的 `WorldPatch.subjectId` 外键使用级联删除；直接删除一个非空 subject 会跨全部历史切面物理抹掉它的 patches，并可能让 Plot anchor 或其它 subject 的 `subject://id` 引用失效。若自动化验收产生了不需要保留的空身份，应让 smoke 在隔离的临时 Project 中运行并整体清理 Project；已有 Project 的异常空身份只能通过受控维护脚本处理，且必须先确认它没有自身 patch、没有 WorldPatch ref、没有 Plot anchor。不能把这种维护动作包装成普通生产 API。

## 7. issues 反馈通道

写入、编辑、删除、查询都会通过 `issues` 暴露需要处理或确认的问题。完整 code 表、`WorldIssue` wire shape 和用户展示规则见 [issues.md](issues.md)；本文只讲它们在生命周期中何时出现。

**E issues（持久数据错误，读时现算，必须修）** 来自 reduce 或读时扫描。例如相对 op 缺少基准、旧数据里有坏路径、ref 目标失效。E issues 是数据里的真实错误，`execute_world` 查询时也会返回相关的 E issues，必须处理。

**A issues（一次性提醒，写/编辑时返回，确认语义即可）** 来自"补过去"或"编辑旧切面"。它们不落库，也不要求自动改数据；它们只是在提醒你确认本次修改是否有意改变下游语义。

Agent 和 UI 向用户解释时应使用后端返回的 `title`、`message`、`explanation`，不要自行按 code 生成文案，也不要把 `broken-relative` 这类 code 直接抛给用户。

## 8. 查询契约：`execute_world`

查询与写入世界状态都使用 `execute_world`，在 CodeAct 沙盒中执行 JavaScript 代码。沙盒提供 `world` API：

```javascript
// 时间转换
const time = world.time.parse("公元2020年4月12日 18:00");
const display = world.time.format(time);

// 查询单个 subject（本质是 reduce）
const erina = await world.subject.get("erina");

// 查询并自动解引用
const erina = await world.subject.get("erina", { deref: true, derefDepth: 1 });

// 批量查询
const states = await world.subject.gets(["erina", "phoenix-faction"]);

// 列出某类型的所有 subject
const characters = await world.subject.list("character");

// 反向查找引用
const refs = await world.subject.findRefs("phoenix-faction", "character");

// 向量搜索
const results = await world.search.text("遗迹封印", { k: 5, attrs: ["events"] });

// 查询时间轴切面
const slices = await world.slice.list({ limit: 10, withPatches: true });
const erinaSlices = await world.slice.list({ subjectIds: ["erina"], withPatches: true });

// 写入 / 编辑 / 删除（writer profile 下不可用）
const written = await world.slice.write({time, title: "状态更新", patches: [{subjectId: "erina", type: "character", name: "艾莉娜", path: "/hp", op: "replace", value: 90}]});
await world.slice.editPatches(written.sliceId, [{add: {subjectId: "erina", path: "/events", op: "append", value: {text: "状态更新完成"}}}]);
await world.slice.delete(written.sliceId);
```

防全量倾倒是硬契约——成熟世界有几百 subject、每个几十属性：

- Agent 的 CodeAct API 不提供裸 `queryState({})` 入口；使用 `world.subject.get` / `world.subject.gets` / `world.subject.list(type)` / `world.slice.list()` 等收窄方法查询。HTTP `POST /state/query` 公开入口同样必须传 `subjectIds` 或 `type` 至少其一；都省略会报错要求收窄。完整世界状态导出只走 UI / debug 专用的 `GET /state`，内部复用 `queryState({at})`，不暴露给 Agent。
- `world.slice.get(sliceId)` 只读取单个切面，不接受 `subjectId`。按 subject 查相关切面用 `world.slice.list({ subjectIds: ["erina"], subjectMode: "any", withPatches: true })`；需要同时包含多个 subject 的切面时用 `subjectMode: "all"`。
- `subjectIds` 若传，必须是非空数组且每项唯一；空数组或重复 id 返回 400。
- `attrs` 若传，必须是非空数组且每项唯一；用它**投影**只取关心的属性，省下无关字段。
- `type` 若传，必须是 schema 已声明的类型，拼错会被拒绝。
- `at` 在 CodeAct 里使用 instant bigint；省略取最新。
- `listLimit` 控制 list / collection 属性最多返回多少条，避免长 events 流把上下文撑爆。
- `world.search.text` 的 `types` 过滤 subject type（如 `character` / `location`），不是 slice kind；要搜经历流文本，用 `attrs: ["events"]`。
- `world.search.text` 的 `k`（默认 10）必须是正整数；`threshold` 必须是 `[-1, 1]` 内的有限数值。空 query 会在完成这些参数和 schema 范围校验后返回空数组，不会发起 embedding 请求。
- 返回的 `issues` 是当前 reduce 显形的 E 问题；如果传了 `attrs`，issues 也跟随投影范围收窄（查 `hp` 不会带回 `location` 的 `dangling-ref` 噪音）。

典型用法：

- 「主角现在什么状态」→ `{ subjectIds: ["erina"] }`
- 「主角的血量和位置」→ `{ subjectIds: ["erina"], attrs: ["hp","location"] }`
- 「所有角色现在在哪」→ `{ type: "character", attrs: ["location"] }`
- 「倒叙：主角 200 年时」（HTTP `POST /state/query`）→ `{ subjectIds: ["erina"], at: "复兴历200年1月1日 00:00" }`

## 9. writer 的只读边界

writer 角色拥有 World Engine **只读** `execute_world`，用于读取世界状态辅助写作，**不能写入**。readonly 模式不会注入 `world.slice.write`、`world.slice.editPatches`、`world.slice.delete`；需要改变世界状态时，由具备写入能力的角色承担。

## 相关文档

- [README.md](README.md)：World Engine reference 书架入口。
- [schema-system.md](schema-system.md)：schema、kind、op、ref、default 契约（决定 subject 有哪些属性、怎么叠加）。
- [recording-principles.md](recording-principles.md)：记录什么、记录到什么粒度（最少支持当前叙事）。
- [issues.md](issues.md)：issue taxonomy、catalog 与展示规则。
- [calendar-system.md](calendar-system.md)：时间真相源与时间入参边界。
- [workflow.md](workflow.md)：写作模式整体工作流与 leader/writer 协作。
