# World Engine — Schema 系统

> ⚠️ **部分过时（Task 67 / 2026-06）**：schema 已硬切到 **TypeScript + Zod**，运行时只加载 `world-engine/schema/index.ts`，**不再支持 `schema.yaml`**。本文中关于 YAML 格式、`subjectTypes/attrs/kind` 写法的章节描述的是旧格式，仅供理解 reduce/op/ref 等**底层契约**（这些语义不变）。新 schema 写法见 [`.agents/tasks/67-world-engine-zod-schema-codeact`](../../../.agents/tasks/67-world-engine-zod-schema-codeact/README.md)。本文的全面重...

> 本文讲清 World Engine 中 **schema（主体模式）** 的概念与契约：subject type / path / kind / op / reduce 语义 / ref / default。读者是需要设计或理解某个项目 schema 的 Agent 与作者。本文只教原理与契约，不教「第一步做什么」的操作步骤（那是 skill 的职责）；理解这里的概念后，你应能自己判断该怎么写 schema、怎么打 patch。

## 1. schema 的定位

World Engine 是一个事件溯源（event sourcing）系统：世界不存「当前状态」，只存**切面（slice）序列**；任意时刻的世界状态 = 该时刻之前所有切面按时间排序后 **reduce** 得来。切面里的每一条变更叫 **patch**，描述「对某个 subject 的某个 JSON Pointer path 做某种操作（op）」。

引擎本身**不预设世界观**。引擎层只认识抽象概念（subject / slice / instant / patch / op / reduce），不知道「HP」「魔力」「修为」是什么。世界观差异**全部由项目自己的 schema 表达**。引擎对项目 schema 的关系，约等于 SQLite 引擎对你的表结构：引擎提供通用机制，schema 告诉它「这个世界里某一类 subject 有哪些属性、每个属性用什么语义叠加」。

- schema 是**项目级资产**，一份 TypeScript 配置文件（使用 Zod），放在 **Project Workspace 顶层的 `world-engine/` 目录**，即 `world-engine/schema/index.ts`。
- schema **不进 SQLite**。Project SQLite 只存切面（timeline）：subject 身份、slice、patch。schema 是当前项目的"合同"，切面只引用 JSON Pointer path 与 op，不内嵌 schema。
- schema **按「类型（type）」声明**：`character` / `location` / `item` / `faction` / `world` / `quest`…。一个 **subject（主体）** 是某个 type 的实例（100 个 NPC 共享同一份 `character` schema）。subject 不限于智慧生物 —— 王国、大陆、世界本身、任务都可以是 subject，判断标准是「它有没有需要随时间追踪的独立状态」。
- `schema/index.ts` 必须导出 Zod schema 注册表（`export const WorldSchema = { character: z.object(...) }` 或等价 default）。空文件或缺文件按**空 schema** 处理（此时所有属性都是动态属性，见 §8）。
- `schema/index.ts` 是**单文件配置入口**。本地文件、绝对路径和 URL/protocol `import` / `export ... from`（例如 `./character`、`../schema-helper`、`C:/helper.ts`、`file:///...`）会被 loader 拒绝；需要 helper 时请直接 inline 到 `schema/index.ts`，或使用 `zod`、`nbook/world-engine/schema` 等包级 import 与 `node:` 内置模块。
- 第一版**不做 schema 版本化 / 自动迁移**。改 schema 不会自动重写历史 patch。若改动影响旧数据，先由作者或 Agent 显式修正。

## 2. kind：属性的「op 语义类」

每个属性声明一个 **kind**，kind 决定它**接受哪些 op、reduce 时怎么叠加**。这是 op 全集与 schema 的接缝，也是理解整个系统的核心一张表。

| kind | 接受的 op | reduce 语义 | 典型属性 |
| --- | --- | --- | --- |
| `scalar` | `replace` / `increment` / `remove` | `replace` 写绝对值；`increment` 在前值上累加（仅数值）；`remove` 删除当前 path | hp、level、location(ref)、status、mind |
| `list` | `replace` / `append` / `remove` | `replace` 整组替换；`append` 在末尾追加；当前值 = 按序应用后的有序数组 | events 经历流、quest.log |
| `collection` | `replace` / `append` / `remove` | `replace` 整组替换；`append` 按 stable JSON 值去重追加；`remove` 不带 value 删除当前 path，带 value 按 stable JSON 值删除元素 | 背包物品、附魔、宗门弟子 |
| `object` | 对子字段 / key 做 `replace` / `remove`，或整体 `replace` | 嵌套结构；有 `fields` = 固定结构，无 `fields` 只有 `itemType` = 开放 key 字典 | equipment{head,chest}（固定）、memory by topic（开放） |

要点：

- **`list` 与 `collection` 必须分开**。`list` 是**只增的有序流**（经历流、日志，逆操作 = 砍末尾），顺序就是叙事顺序，故意**不支持中间插入**，也不支持 `remove + value`。要往「过去」补一条经历，正确做法是**在更早的 instant 插一个切面**，而不是在现有 list 中间插元素 —— 否则会破坏「events 顺序 = 切面 instant 顺序」这条不变量。`collection` 是**可增删的无序集合**（背包、弟子名册，逆操作 = 反向增删），按 stable JSON 值去重，也可按 stable JSON 值删除。
- **`list` / `collection` 的 `replace` 是整组替换**：value 必须是数组，数组项按 `itemType` 校验。日常追加经历或集合项优先用 `append`；`replace` 留给「整组重置」（subject 创建时的 default 初始化也走这条普通合法语义）。
- **`object` 统一了固定结构与开放字典**（不再分 map / object 两个 kind），详见 §4。

## 3. op 全集与语义

op 是 patch 的动词。全集如下，所有 op 都受属性 kind 约束（§2 表已列出每个 kind 接受哪些 op）：

| op | 作用 | reduce 语义 |
| --- | --- | --- |
| `replace` | 设绝对值（含覆盖、含嵌套路径） | 后写覆盖前值 |
| `increment` | 数值相对增量（数值 scalar 专用） | 基于当前数值累加；缺基准返回 `broken-relative` |
| `remove` | 删除一个属性 / key / 数组 index；collection 可带 value 删除元素 | 不带 value 时删除当前路径，路径不存在时幂等；collection 带 value 时按 stable JSON 值删除匹配元素，找不到时幂等；list 带 value 会被拒绝 |
| `append` | 数组追加 | 基于当前数组追加；collection/unique 数组按 stable JSON 去重；缺基准返回 `broken-relative` |

### replace vs increment：为什么要区分

`scalar` 数值属性**同时支持 replace 与 increment**，两者语义不同，选择哪个有架构后果：

- **`replace` = 绝对值**：「等级升到 5」「status 改成 done」。后写覆盖前值，与历史无关。
- **`increment` = 相对增量**：「扣 20 血」「国库 +1000」。基于 reduce 出的当前数值累加，**仅对数值类型有效**。

`increment` 的价值是**架构性的，与 LLM 算力无关**：

- `increment` **可交换、对「往前插切面」稳定**。如果你在某条 `increment` 之前再插入一个变更切面，后续 `increment` 的增量不变，reduce 会自动得到正确结果。
- `replace` 是绝对值，**对插入敏感**。在一条 `replace /hp = 50` 之前插一个改 hp 的切面，那条 `replace` 仍然把 hp 钉死在 50，可能不是作者想要的。
- 因此：**记录连续变化（伤害、收入、消耗）优先用 `increment`**；只有「这一刻就是这个绝对值」才用 `replace`。

第一版的边界（务必记住）：

- **patch 不存旧值字段**，后端**不自动改写后续切面**。声明式的 patch 序列是唯一真相源。
- 在过去插入 / 修改绝对值时，引擎用 **A issues** 提醒作者确认语义，而不是自动修复。A issues 是**一次性提醒**，不落库，确认语义即可；完整 code 表见 [issues.md](issues.md)。
- **没有 track、没有专门的「历史曲线」存储**。「hp 随时间的曲线」= 遍历所有打在 `/hp` 上的 patch（每条都带 instant + op + 值），从切面序列直接 reduce 出轨迹。reduce 出「当前值」和 reduce 出「历史轨迹」用的是同一批数据，只是聚合方式不同。

### increment 的数值约束

`increment` 的 reduce 结果必须仍是**有限数（finite number）**，否则显形为 E issue（持久数据错误，必须修）。`int` 值必须是 JS safe integer，`int increment` 的累加结果也必须保持 safe integer（避免 JSON number 超出安全整数范围后丢精度）；`float` 输入只要求有限数。Issue 解释和处理方式见 [issues.md](issues.md)。

### 与 JSON Patch 的关系（注脚，非合同）

op 集合受 JSON Patch (RFC 6902) 启发但**不严格对齐**。`replace`、`remove` 接近 JSON Patch 同名语义；`append` 是对数组容器追加；`increment` 是数值相对变化扩展。公开写入字段统一为 `patches`，每条 patch 使用 JSON Pointer `path`，例如 `/equipment/head`、`/memory/师门`。

## 4. object：固定结构与开放字典

`object` 一个 kind 覆盖两种形态，区别只在「有没有声明 `fields`」：

- **有 `fields`：固定 schema 结构**。子字段是预先声明的固定 key（如装备槽位 head / chest / weapon），每个子字段有自己的类型。
- **只有 `itemType`、没有 `fields`：开放 key 字典**。key 在运行时增减（如 `memory` 按 topic 存看法），所有 value 共享同一个 `itemType`。

两种形态都用 JSON Pointer **path** 做 `replace` / `remove`：

- 固定结构：`/equipment/head` replace 一个 ref(item)，只影响 head 槽位，保留逐槽位历史；整体 `replace /equipment = {...}` 留给「换一整套装备」。
- 开放字典：`/memory/师门` replace 一段文本，新增 / 改写「师门」这个 topic 下的看法；`remove /memory/师门` 删掉这个 topic。

**日常优先打细路径**（`/equipment/head`、`/memory/师门`），保留逐 key 的演化历史；整体 `replace` 只用于真正的整体替换。

## 5. ref 引用规则

subject 之间的关系不是独立的第三种东西，**就是一个值为「引用」的普通属性**（kind 通常是 scalar，op 是 replace）。

- 引用串统一写成 **`subject://<id>`**，纯 id，**不编码 type**，对齐项目 `{kind}://{targetId}` 惯例（同构于 `thread://22`）。
- **单一 scheme 覆盖所有 subject 类型**：character / item / location / faction 都是 subject，只是 type 不同；type 从 `WorldSubject` 表查，不进 URI。
- schema 里属性写 `type: ref(<subjectType>)`，`<subjectType>` 必须是同一份 schema 已声明的 subject type，用于**校验目标 subject 的 type 是否匹配**与编辑期提示，但**不改变存储的 ref 串**（存储恒为 `subject://<id>`）。

两条核心规则：

1. **不双向冗余存**。关系只在一边存。人物身上存 `equipment.weapon = subject://sword-01`，物品身上**不**再存 `equippedBy`。「这把剑被谁装备」靠**反查**（遍历找哪个 character 的 `equipment.*` 等于这把剑）。同理阵营不存 `members`，「凤凰阵营有谁」靠反查 `character.faction == subject://phoenix`。双向冗余在切面回退时极易不一致，所以禁止。
2. **reduce 不自动解引用（惰性显式解）**。`reduce(艾莉娜, t).equipment.weapon` 返回引用值 `subject://sword-01` **本身**，不会把剑的状态嵌进来。要剑的状态，调用方自己再 `reduce(sword-01, t)`。原因：自动解引用会引发递归、循环引用、「解到哪一层停」难题。**reduce 永远只算单个 subject，指针不自动跟进去**；谁要关联视图，谁自己组合多个 reduce 结果。

ref id 全局唯一（`WorldSubject.id` 主键），不能为空，不能带首尾空白；写入 `subject://<id>` 时内部的 `<id>` 也遵守同一规则。

## 6. JSON Pointer path 规则

写入 patch 使用 `path` 字段，格式是 **JSON Pointer**，必须以 `/` 开头，天然支持深入嵌套结构（`/equipment/head`、`/memory/师门`、`/stats/hp`）。

由此推出两条命名约束：

- **schema 属性名不能含点号、不能含首尾空白、不能为空**。schema loader 会把属性投影成 JSON Pointer path；属性名里出现点号会产生不可寻址歧义。
- **运行时 path 每段必须非空、不能含首尾空白**；`~` 与 `/` 按 JSON Pointer 规则转义。

**开放 object 的 key 可以用中文等稳定段名**（如 `memory.师门`、`memory.家乡`）。约束的是「段名形状」（非空、无首尾空白、无点号），不限制语言。

## 7. default 与初始化

schema 属性可声明 `default`，它决定 subject **创建时**要不要写一个「初始化切面」：

- **声明了非空 `default`**：创建 subject 时（首次 `world.slice.write` 在 patch 上声明 `type` 自动触发），会在该 subject 的起始 instant 生成或追加一组 `kind=init` 的 `replace` patch，把初值写进切面。这样 reduce 从切面序列即可拿到已声明的初值，**切面序列自包含**，不需要「reduce 时回查 schema 兜底」的特殊逻辑。
- **没有 default**：只注册 subject 身份，**不创建空切面**（保持「切面 = 状态变更」这条约束，不存在没有 patch 的切面）。

初始化追加的边界：自动追加**只允许落到同 instant 已有的 `kind=init` 切面**。如果该时刻已经有 `event` / `backstory` 等非 init 切面，引擎会拒绝自动追加（返回 409），要求调用方换一个初始化时间，或先读出已有切面的 `sliceId` / `patchId` 后用 `world.slice.editPatches` 显式合并。引擎不会在创建 subject 时悄悄改写普通事件切面。

**default 在 schema 加载期校验形状 / 类型**：`int` 必须是整数（且是 safe integer），`float` 必须是有限数，`enum` 必须命中取值集合，`list` / `collection` default 必须是数组，固定 `object.fields` default 不允许多余 key，开放 `object` default 会逐 key 校验。`ref(type)` default 先校验 `subject://<id>` 形状；目标 subject 是否真实存在、type 是否匹配，则在创建 subject 写入 init patch 时校验（这依赖 Project SQLite 当前数据）。

## 8. 校验宽松度（定论：宽松）

schema **不是强约束，而是「建议结构 + 已知属性的 op 语义」**：

- patch 打在 schema **未声明**的属性上是**允许**的（动态属性）。**未知属性默认按 `scalar` 处理。**
- 已知属性按声明的 kind 校验 op 是否合法、value 类型是否对。
- 这样 Agent 不必「先改 schema 才能记一个新属性」—— 想给角色记一个 schema 里没写的临时属性，直接打 patch 即可。

宽松的是「属性是否声明」，**严格的是值的合法性**：patch value 必须是严格 JSON 值，`NaN` / `Infinity` / `Date` 等非普通对象 / 嵌套 `undefined` 都会被拒绝；已声明属性的 op-kind 组合不合法也会被拒绝。

## 9. 稳定 key 约束（汇总）

schema 与运行时入参里的「key」必须可稳定引用，相关命名约束汇总如下：

- **subject type 名**：不能为空，不能含空白，不能含括号。这套规则同时用于 schema type 声明、运行时 `world.slice.write` 首写时 patch 上的 `type` 字段（触发自动创建）、`execute_world` 中 `world.subject.list(type)` 查询，以及 `ref(<type>)` 校验。`ref(<type>)` 必须指向同一 schema 已声明的 subject type，悬空 ref 在 schema 加载阶段就报错。
- **schema 属性名**：不能为空，不能含首尾空白，不能含点号（运行时写入使用 JSON Pointer path，见 §6）。
- **subject id**：不能为空，不能含首尾空白；`subject://<id>` 内部的 id 同样。
- **slice kind 标签**：`WorldSlice.kind` 是 timeline / UI / 日志的过滤标签，**不参与 reduce**；允许项目自定义，省略时默认 `event`，但显式传入时不能为空、不能含首尾空白。

补充：schema 中显式的 `desc` 必须是字符串；`enum` 候选必须是非空数组且按 stable JSON 唯一（对象 enum 的 key 顺序不构成不同候选）。

## 10. Zod schema 与典型写入示例

当前项目 schema 写在 `<project>/world-engine/schema/index.ts`，使用 Zod 表达 subject type。Zod 类型会被 loader 投影成前文描述的 kind / op 语义：

- `z.number()` / `z.string()` 等标量默认按 scalar 处理。
- `z.array(...)` 默认按 list 处理。
- `z.array(...).unique()` 标记为 collection。
- `z.object({...})` 是固定 object；`z.record(...)` 是开放 object。
- `Ref("location")` 这类 helper 用 `describe("ref:location")` 标记引用目标。
- Project 本地 helper 不要拆成 `./xxx.ts`、绝对路径或 `file://` URL 再 import；loader 只支持单文件配置入口。公共 helper 可以从包级模块导入，Node 内置模块请使用 `node:` 前缀。

一个简化奇幻 schema 示例：

```typescript
import {z} from "zod";

declare module "zod" {
    interface ZodArray<T extends z.ZodTypeAny, Cardinality extends z.ArrayCardinality = "many"> {
        unique(): this;
    }
}

z.ZodArray.prototype.unique = function() {
    (this as any)._def.unique = true;
    return this;
};

function Ref(targetType: string) {
    return z.string()
        .regex(/^subject:\/\/[\w-]+$/)
        .describe(`ref:${targetType}`);
}

function EmbeddingText() {
    return z.object({
        text: z.string(),
        vector: z.array(z.number()).optional(),
        model: z.string().optional(),
    });
}

const Character = z.object({
    hp: z.number().int().default(100),
    maxHp: z.number().int().default(100),
    location: Ref("location").optional(),
    mind: z.string().optional(),
    equipment: z.object({
        weapon: Ref("item").optional(),
    }).optional(),
    inventory: z.array(z.string()).unique().default([]),
    memory: z.record(z.string(), EmbeddingText()).optional(),
    events: z.array(EmbeddingText()).default([]),
    faction: Ref("faction").optional(),
});

export const WorldSchema = {
    character: Character,
    location: z.object({
        name: z.string().optional(),
        control: Ref("faction").optional(),
    }),
    item: z.object({
        durability: z.number().int().default(100),
        enchants: z.array(z.string()).unique().default([]),
    }),
    faction: z.object({
        name: z.string().optional(),
        treasury: z.number().int().default(0),
    }),
    world: z.object({
        events: z.array(EmbeddingText()).default([]),
    }),
} as const;
```

`EmbeddingText.vector` / `EmbeddingText.model` 是系统维护字段。Agent 或 HTTP 写入真实文本时只提供 `{text: "..."}`；向量化链路会把 `text`、`vector`、`model` 同步到 `WorldPatch` 的检索列。手写 `vector` / `model` 会被拒绝，也不要通过 `/events/0`、`/memory/某项/vector` 之类的内部路径改写 EmbeddingText；修正历史文本应使用 `world.slice.editPatches` 修改原 patch。

跑几条 patch 验证 op + reduce（时间一律用项目日历字符串，Agent 工具 / HTTP 公开入参禁止 raw `instant:<number>`）。默认模板的 `events` 是 `EmbeddingText[]`，所以 `/events` 追加一条经历时 value 写成 `{text: "..."}`：

```jsonc
// 切面 @ "公元2020年4月12日 18:00"：艾莉娜受伤、捡到剑、装上、对师门改观
{
    "time": "公元2020年4月12日 18:00",
    "title": "城北遭遇战",
    "patches": [
        // scalar increment：相对增量更稳健（扣 30 血）
        { "subjectId": "erina", "type": "character", "name": "艾莉娜", "path": "/hp", "op": "increment", "value": -30, "summary": "受伤失去体力" },
        // collection 追加：捡到一把剑进背包，collection/unique 数组会按值去重
        { "subjectId": "erina", "path": "/inventory", "op": "append", "value": "subject://sword-01", "summary": "获得旧剑" },
        // object 细路径 replace：把剑装到武器槽
        { "subjectId": "erina", "path": "/equipment/weapon", "op": "replace", "value": "subject://sword-01", "summary": "装备旧剑" },
        // object 开放字典 by key：对「师门」的看法改了
        { "subjectId": "erina", "path": "/memory/师门", "op": "replace", "value": {"text": "怀疑"}, "summary": "更新师门看法" },
        // list 追加：写一条经历
        { "subjectId": "erina", "path": "/events", "op": "append", "value": {"text": "在城北被伏击，捡到一把旧剑"}, "summary": "记录经历" }
    ]
}
```

reduce 出的状态：hp 在前值上减 30、inventory 含 `subject://sword-01`、equipment.weapon = `subject://sword-01`、memory.师门.text = "怀疑"、events 末尾多一条。

后续若交出旧剑，对 collection 使用 `remove + value`：`{ "subjectId": "erina", "path": "/inventory", "op": "remove", "value": "subject://sword-01" }`。这会按 stable JSON 值删除匹配元素；若 `inventory` 是 list 而不是 collection，同样写法会被拒绝。

## 相关文档

- [README.md](README.md)：World Engine reference 书架入口。
- [subject-lifecycle.md](subject-lifecycle.md)：subject 注册、init slice、切面演化、reduce、查询契约。
- [recording-principles.md](recording-principles.md)：记录什么、记录到什么粒度。
- [calendar-system.md](calendar-system.md)：时间真相源与时间入参边界。
- [`.agents/tasks/56-world-engine/schema-design.md`](../../../.agents/tasks/56-world-engine/schema-design.md)：schema 字段格式、kind/op 语义、ref 规则与完整示例（底层契约真相源）。
