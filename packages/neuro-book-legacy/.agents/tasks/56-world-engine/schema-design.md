# World Engine — Schema 设计草案

> 本文件是 [README.md](README.md) 的子文档，承载 subject schema 字段格式与完整示例。
> 状态：**第一版已落地，本文记录当前 schema 契约、示例与后续留口**。关键定论同步在 README「Decisions」中。

## 1. schema 在系统里的位置

- schema 是**项目级资产**，YAML/JSON 配置文件，放 Project Workspace（目录见 §6 待定）。
- 按**类型**声明：`character` / `quest` / `location` / `item` / `faction`…，subject 是某类型的实例。subject type 是稳定 key：schema type 名与运行时 `createSubject(type)`、`queryState(type)`、`listWorldSubjects(type)` 入参都不能为空，也不能包含空白或括号；同一组 type key 也用于 `ref(type)` 校验。
- schema attr 名不能为空，不能包含首尾空白或点号；点号只作为运行时 attr path 的段分隔符。运行时 attr path 每段必须非空且不能包含首尾空白。
- schema 中 subject type / attr 的显式 `desc` 必须是字符串；未写时省略。
- 引擎只认抽象概念（Subject / Slice / Instant / op / reduce）；schema 告诉引擎「这个世界的某类 subject 有哪些属性、每个属性用什么 op 语义叠加」。
- 运行时用 TypeBox 校验 mutation 是否合法（属性存在、op 与属性语义匹配、值类型对）。

## 2. 属性的「op 语义类」（kind）

每个属性声明一个 **kind**，kind 决定它接受哪些 op、reduce 怎么叠加、问题如何暴露。这是 op 全集与 schema 的接缝。

| kind | 接受的 op | reduce 语义 | 典型属性 |
| --- | --- | --- | --- |
| `scalar` | `set` / `add` / `unset` | set 重置为绝对值；add 在前值上累加（数值）；当前值 = 按序应用 | hp、level、location(ref)、status |
| `list` | `set` / `listAppend` | set 整组替换；listAppend 末尾追加；当前值 = 按序应用 | events 经历流、quest.log |
| `collection` | `set` / `collectionAdd` / `collectionRemove` | set 整组替换；add/remove 按 stable JSON 值增删；当前值 = 现存元素集合 | 背包物品、附魔、宗门弟子 |
| `object` | 对子字段 / key 做 `set`/`add`/`unset`，或整体 `set` | 嵌套结构；有 `fields` = 固定结构，无 `fields` 只有 `itemType` = 开放 key 字典 | equipment{head,chest}（固定）、memory by topic（开放） |

说明：
- **`object` 统一了固定结构与开放字典**（不再分 map/object 两个 kind）：声明了 `fields` 就是固定 schema 结构（装备槽位固定）；只声明 `itemType`、不声明 `fields` 就是开放 key 字典（memory 的 topic 运行时增减）。子字段 / key 都用路径 `set`/`unset`。
- **`list` / `collection` 的 `set` 是整组替换**：value 必须是数组，数组项按 `itemType` / `type` 校验。`createSubject` 的 schema default 初始化也使用这条普通合法语义写入 `set []` / `set [...]`；日常追加经历仍优先用 `listAppend`，增删集合项仍优先用 `collectionAdd` / `collectionRemove`。
- **`scalar` 同时支持 set 与 add**：
  - `set` = 绝对值（「等级升到 5」「status 改成 done」）。
  - `add` = 相对增量（「扣 20 血」「国库 +1000」），**仅对数值类型有效**。
  - `add` 的 reduce 结果必须仍是有限数，否则显形为 `broken-relative`。`int` 值必须是 JS safe integer，避免 JSON number 超出安全整数范围后丢精度；`int add` 的 reduce 结果还必须保持 safe integer；`float` 输入只要求有限数。
  - add 的价值是**架构性的、与 LLM 算力无关**：add 可交换、对「往前插切面」更稳定（前面插一个变更，后续 add 增量不变，reduce 自动正确）；而 set 是绝对值，对插入敏感，第一版通过 `base-shifted` / `masked` issues 提醒作者确认语义。当前 mutation 不存旧值字段。
  - 没有 track。「hp 随时间曲线」= 遍历所有打在 hp 上的 mutation（每条带 instant + op + 值），从切面序列直接 reduce 出轨迹。
- `object` 固定结构的更新优先打**细路径**（`equipment.head`）保留逐槽位历史；整体 `set equipment = {...}` 留给「换整套」。

### 与 JSON Patch 的关系（注脚，非合同）

op 集合受 JSON Patch (RFC 6902) 启发但**不严格对齐**。粗略对应关系：

| 我们的 op | JSON Patch 类似物 |
| --- | --- |
| `set` | `replace` / `add`（对单值 path） |
| `unset` | `remove` |
| `listAppend` | `add` 到 array `path/-`（只支持末尾） |
| `collectionAdd` / `collectionRemove` | 集合按值 add / remove（不是按 index） |
| `add`（数值） | **JSON Patch 无对应**（我们的扩展） |

**为何不直接采用 JSON Patch 命名**：
- JSON Patch 的 `add` 重载严重（对 object 是设字段、对 array 是插入、对 `/-` 是追加），一个名字三种语义靠 path 末尾形态决定。我们当前按属性 kind 决定语义、op 名字一眼定义，可读性更好。
- list 故意**不支持中间插入** —— events 是时间序列，要往「过去」插一条经历的正确做法是**往更早 instant 插一个切面**，不是在现有 list 中间插元素，否则破坏「events 顺序 = 切面 instant 顺序」的不变量。
- `add`（数值）是 JSON Patch 没有的扩展，必然超出 RFC 6902 范畴。

## 3. 属性字段格式（schema 怎么写一个属性）

```yaml
# 一个属性的完整可选字段
<attrName>:
  kind:    scalar | list | collection | object         # 必填，决定 op 语义
  type:    int | float | text | bool | enum | ref(<type>)   # 值类型（scalar / 元素类型）
  enum:    [...]            # kind=scalar 且 type=enum 时的取值集合
  ref:     <subjectType>    # type=ref 时指向的 subject 类型（用于校验与反查）
  fields:  { ... }          # kind=object 且为固定结构时的子字段（递归同结构）
  itemType: <type>          # kind=list / collection 的元素类型；kind=object 无 fields 时的 value 类型（开放字典）
  default: <value>          # subject 创建时写入「初始化切面」的初值（见 §7）
  desc:    "..."            # 给作者/Agent 看的说明
```

`enum` 候选必须是非空 JSON array，且按 stable JSON 后不能重复；对象 enum 的 key 顺序不构成不同候选。`default` 在 schema 加载期按当前属性声明做形状 / 类型校验：`int` 必须是整数，`float` 必须是 finite number，`enum` 必须命中取值，`list` / `collection` default 必须是数组，固定 `object.fields` 不允许多余 key，开放 `object itemType` 会逐 key 校验。JSON object 必须是普通对象或 null prototype 对象，`Date` 等非普通对象不属于 JSON 值。`ref(type)` default 会先校验 `subject://<id>` 形状；目标 subject 是否真实存在、type 是否匹配仍在创建 subject 写入 init mutation 时校验，因为这依赖 Project SQLite 当前数据。

**校验严格度（定论：宽松）**：mutation 打在 schema **未声明**的属性上是**允许**的（动态属性）。schema 是「建议结构 + 已知属性的 op 语义」，不是强约束。已知属性按声明的 kind 校验 op 是否合法、值类型是否对；未知属性默认按 `scalar` 处理。这样 Agent 不必先改 schema 才能记一个新属性。

## 4. ref 引用格式（定论：`subject://<id>` 纯 id）

- subject 引用统一用 **`subject://<id>`**（纯 id，不编码 type），对齐项目 `{kind}://{targetId}` 惯例（同构于 `thread://22`）。
- **单一 scheme 覆盖所有 subject 类型**：character / item / location / faction 都是 subject，只是 `type` 不同；type 从 `WorldSubject` 表查，不进 URI。
- id 全局唯一（`WorldSubject.id` 主键），不能为空或带首尾空白；写入 ref 时 `subject://<id>` 内部 id 也遵守同一规则。反查「谁引用了某 subject」= 匹配 `value = "subject://<id>"`。
- 未来可加进 `shared/reference-core.ts` 的 kinds，让正文 `@subject://erina` 自然提及一个角色。
- schema 里属性写 `type: ref(<subjectType>)`，`<subjectType>` 必须是同一 schema 已声明的 subject type，用于**校验目标 subject 的 type 是否匹配**与编辑期提示，不改变存储的 ref 串（存储恒为 `subject://<id>`）。

## 4. 完整魔幻世界 schema 示例

```yaml
# 文件示意：<project>/<world-engine-dir>/schema.yaml
subjectTypes:

  # —— 人物（玩家与 NPC 共用）——
  character:
    desc: 有主观知识、会行动、会隐藏信息的角色
    attrs:
      # 数值属性：scalar，靠切面序列 reduce 出当前值与历史曲线
      hp:        { kind: scalar, type: int,  default: 100, desc: 当前生命值 }
      maxHp:     { kind: scalar, type: int,  default: 100 }
      mp:        { kind: scalar, type: int,  default: 0 }
      level:     { kind: scalar, type: int,  default: 1 }
      age:       { kind: scalar, type: int }

      # 当前所在地：scalar + ref（关系即引用属性，单向存）
      location:  { kind: scalar, type: ref(location) }

      # 当前心理 / 状态文本：scalar text，后盖前
      mind:      { kind: scalar, type: text }

      # 装备栏：object，子字段是固定槽位，每槽位是 ref(item)
      equipment:
        kind: object
        fields:
          head:   { type: ref(item) }
          chest:  { type: ref(item) }
          weapon: { type: ref(item) }

      # 背包：collection，物品可增删（不是 list，因为会取走）
      inventory: { kind: collection, itemType: ref(item) }

      # 认知记忆：object 开放字典（无 fields，只有 itemType），key=topic 运行时增减改
      memory:    { kind: object, itemType: text, desc: "key=角色当前认定的称呼，value=看法" }

      # 经历流：list，只增有序（语义对齐旧 events.jsonl，但不再存文件）
      events:    { kind: list, itemType: text }

      # 关系：指向阵营。单向存，「阵营有哪些成员」靠反查
      faction:   { kind: scalar, type: ref(faction) }

  # —— 任务：本身是 subject（能独立演变状态）——
  quest:
    desc: 有独立状态、随时间演变的任务
    attrs:
      status:   { kind: scalar, type: enum, enum: [unstarted, active, done, failed], default: unstarted }
      progress: { kind: scalar, type: float, default: 0 }
      log:      { kind: list, itemType: text }
      giver:    { kind: scalar, type: ref(character) }

  # —— 装备 / 物品：有独立状态才作为 subject ——
  item:
    desc: 需要独立追踪状态的物品（普通物品可只作为 character.inventory 的元素，不必建 subject）
    attrs:
      durability: { kind: scalar, type: int }
      # 附魔：collection，可增删多个附魔
      enchants:   { kind: collection, itemType: text }
      # 注意：不存 equippedBy。「被谁装备」靠反查 character.equipment.* == 本 item

  # —— 地点 ——
  location:
    attrs:
      name:    { kind: scalar, type: text }
      control: { kind: scalar, type: ref(faction), desc: 当前控制方 }

  # —— 阵营 / 王国（非智慧生物也是 subject）——
  faction:
    attrs:
      name:     { kind: scalar, type: text }
      treasury: { kind: scalar, type: int, desc: 国库 }
      # 不存 members 列表（避免双向）。成员靠反查 character.faction == 本 faction
```

## 5. 用示例跑几条 mutation（验证 op + deleteSlice + reduce）

```jsonc
// 切面 X @ instant=...：艾莉娜受伤、捡到剑、装上、对师门改观
{
  "instant": "1234567890",
  "title": "城北遭遇战",
  "mutations": [
    // scalar set：绝对值，后写覆盖前值
    { "subjectId": "erina", "attr": "hp",            "op": "set", "value": 50 },
    // scalar add：也可写成相对增量（扣 30 血）
    // { "subjectId": "erina", "attr": "hp",         "op": "add", "value": -30 },
    // collection 加：捡到一把剑进背包
    { "subjectId": "erina", "attr": "inventory",     "op": "collectionAdd", "value": "subject://sword-01" },
    // object 细路径 set：把剑装到武器槽
    { "subjectId": "erina", "attr": "equipment.weapon", "op": "set", "value": "subject://sword-01" },
    // object 开放字典 by key：对「师门」的看法改了
    { "subjectId": "erina", "attr": "memory.师门",   "op": "set", "value": "怀疑" },
    // list 追加：写一条经历（逆=砍末尾）
    { "subjectId": "erina", "attr": "events",        "op": "listAppend", "value": "在城北被伏击，捡到一把旧剑" }
  ]
}
```

- **reduce(erina, t≥X)**：hp=50、inventory 含 `subject://sword-01`、equipment.weapon=`subject://sword-01`、memory.师门="怀疑"、events 末尾多一条。
- **删除切面 X**：`deleteSlice` 物理删除该切面后重新 reduce；如果删除导致下游相对 op 缺少基准，会通过 `broken-relative` issue 暴露。
- **「这把 sword-01 被谁装备」**：反查所有 character 的 `equipment.*` 中等于 `subject://sword-01` 的 → erina。装备自己不存 equippedBy。
- **「凤凰阵营有哪些成员」**：反查 character.faction == `subject://phoenix`。阵营不存 members。
- **「erina 的 hp 曲线」**：取所有 subjectId=erina & attr=hp 的 mutation，按 instant 排 → (…,80→50,…) 时间序列。

## 6. 存储 / 边界定论

- **schema = 项目级配置文件**（YAML/JSON），放 Project Workspace 顶层 **`world-engine/`** 目录（如 `world-engine/schema.yaml`）。schema **不进 SQLite**。显式存在的 `schema.yaml` 根配置必须是 object；空文件 / 缺文件使用空 schema。
- **Project SQLite 只存切片（timeline）**。切片只是 op + 值，不内嵌 schema；同一 instant 只允许一个切面。第一版没有自动合并同 instant 的写入流程：目标 instant 已有切面时，`writeSlice` 报错，修改已有时间点走 `editSlice`。
- **第一版不做 schema 版本化 / 自动迁移**。schema 是当前项目合同；改 schema 不会自动重写历史 mutation，也不保证旧 mutation 语义自动迁移。若 schema 修改影响旧数据，先由作者 / Agent 显式修正。
- **default 进切面**：subject 创建时如果 schema 声明了 `default`，会在该 subject 起始 instant 生成或追加一组 kind=init 的 `set` mutation。default 的纯 schema 形状 / 类型错误在 schema 加载期暴露；ref default 的目标存在性仍在创建 subject 时校验。自动追加只允许落到同 instant 已有的 `kind=init` 切面；若该时刻已有非 init 切面，需要用 `editSlice` 显式合并或选择其他初始化时间。没有 default 时只注册 subject 身份，不创建空切面。这样 reduce 从切面序列即可拿到已声明的初值，**切面序列自包含**，不需要「reduce 时回查 schema 兜底」的特殊逻辑。

## 7. 与现有 simulation / RAG 的关系（边界，非本任务实现）

- **与 `simulation/` 目录**：世界引擎是**全新独立系统，当前与 simulation 无关**。`simulation/` 目录及其 subject 文件（subject.md / soul.md / events.jsonl / memory.jsonl / mind.md / state.md）**暂不删除、暂不迁移**，后续再慢慢迁移。世界引擎的世界状态完全由切面 reduce 得来，不读写 simulation 文件。
- **目标终态（后续，非现在）**：世界状态不再依赖 subject 文件，只有世界引擎 reduce 出来的状态。届时再设计 simulation → 世界引擎的迁移路径。
- **RAG（先不深入设计，只定边界）**：RAG **单独成系统**，是世界引擎的**下游消费者**，不跟随 schema 定义。
  - 理由：世界引擎 reduce 出的是结构化当前状态（hp=50、memory.师门="怀疑"）；RAG 要的是可语义检索的文本片段（events 流、memory view 文本）。两者数据形态、更新时机、索引方式不同，绑在一起会耦死。
  - 接缝：世界引擎是事实源（切面 / reduce），RAG 单独定义「订阅哪些属性的变更并建索引」（如订阅 events list 追加、memory view 文本）。RAG 索引可重建（从切面 reduce + 重新 embed），切面才是真相。与现有「subject-rag.sqlite 是可重建缓存、JSONL 是真相」思路一致，只是真相源换成切面。
  - 第一版不实现 RAG，但 kind 设计已天然支持后续订阅。

## 8. 本文件遗留待定

- subject 身份当前落在 `WorldSubject` 表；后续只需讨论 type / name 之外是否增加更多身份元数据。
- `world-engine/` 内配置文件的最终命名与格式细节（schema.yaml 字段、calendar.yaml）。
- 校验严格度细节：宽松允许未声明属性已定；`schema.yaml` 显式存在时根配置必须是 object；schema 中显式 `desc` 必须是字符串；schema 中 `ref(type)` 的 type 必须已声明；enum 候选按 stable JSON 唯一；schema default 的纯形状 / 类型错误在加载期暴露；mutation value 必须是严格 JSON 值，非有限数、`Date` 等非普通对象、嵌套 `undefined` 都会被拒绝；`int` default / mutation 必须是 JS safe integer；`add` reduce 结果非有限数或 `int add` 结果溢出会通过 `broken-relative` 暴露；正常写入时 ref 目标缺失或 type 不匹配是 error，读时发现旧数据 / 手工损坏会通过 `dangling-ref` E issue 暴露。
