# Subject RAG Memory

## Relative Documents Refs

- [reference/content/simulation.md](../../../reference/content/simulation.md)
- [reference/content/information-control.md](../../../reference/content/information-control.md)
- [docs/tasks/36-agent-prompt-engineering-simulation-director/README.md](../36-agent-prompt-engineering-simulation-director/README.md)
- [docs/tasks/42-simulation-rollback-mechanism/README.md](../42-simulation-rollback-mechanism/README.md)

## User Request / Topic

- 用户确认回滚机制先不继续展开，本 task 只讨论 Subject RAG。
- RAG 第一版只服务 `simulation/subjects/`，目标是让 emulator 尽量不会失忆。
- 计划使用 SQLite + sqlite-vec + embedding model 实现索引。
- 第一版先做两层 subject memory：
  - `events.jsonl`：经历流 / 日记式 episodic memory。
  - `memory.jsonl`：角色对某个主体的稳定看法、理解和态度。
- 后续才考虑把 lorebook、Project 整体、GraphRAG 或更完整信息控制接入 RAG。

## Goal

设计并逐步实现 subject-scoped RAG memory：在长线 RP / simulation 中，`simulator.actor` 能基于当前 actor-facing packet 召回自己过去经历和稳定认知，减少长上下文后的失忆，同时保持 actor-facing 信息边界，不把 god-view lorebook 或其他 subject 私有信息泄露给当前 subject。

成功标准：

- 每个 subject 拥有清晰的文件合同：稳定人设、初始化记忆、经历流、稳定认知、当前心理、当前状态分层明确。
- `events.jsonl` 支持追加经历、观察、思想和推理片段，并进入 RAG。
- `memory.jsonl` 支持更新、合并、删除，而不是无限追加，并进入 RAG 或被直接筛选注入。
- `actor.context-load` 能基于当前 actor-facing packet 检索当前 subject 自己的相关 memory，不跨 subject 泄露。
- `actor.memory-save` 或后续专用子 agent 能通过自然语言工具维护 `events.jsonl` 和 `memory.jsonl`。
- 第一版不要求 lorebook / Project 全局 RAG，不实现 GraphRAG，不设计完整 who-knows-what 边。

## Current State

- 当前 simulation reference 已硬切为以下 subject 文件合同：

```text
simulation/subjects/{subject-id}/
|-- subject.md
|-- memory-seed.md
|-- events.jsonl
|-- memory.jsonl
|-- mind.md
`-- state.md
```

- `simulator.actor` 主 run 不直接读取 subject 文件原文，且主 run 实际执行权限只允许 `report_result`；`actor.context-load` sidecar 不读 subject 原文，只使用 `subject_rag_search` 注入 actor-safe context，注入内容会作为 harness-origin user message 持久化到 actor session。
- `actor.memory-save` sidecar 维护 `events.jsonl`、`memory.jsonl` 与 `mind.md`，`state.md` 由 `simulator.leader` 裁决。
- 旧 `events.md` / `knowledge.md` 合同已 hard cut；工具层不导入、不读取、不做长期双轨同步。
- Task 42 已把 rollback 和 RAG 分离。本 task 不展开 rollback 实现，只需保证 RAG 索引可重建，且不把被回滚掉的非 active 现实当成当前记忆。

## Decisions / Discussion

### Subject File Shape

第一版目标结构：

```text
simulation/subjects/{subject-id}/
|-- subject.md
|-- memory-seed.md
|-- events.jsonl
|-- memory.jsonl
|-- mind.md
`-- state.md
```

说明：

- `subject.md`：稳定人设、人格、语气、行动原则、长期能力底色。数据量小，直接进上下文。
- `memory-seed.md`：初始化经历和初始化认知种子。用于生成第一批 `events.jsonl` / `memory.jsonl`，之后不反复当成最新记忆。
- `events.jsonl`：经历流。记录角色经历、观察、被告知、当时想法、当时误解和后来推理。它像日记，允许碎片化、遗漏、没有完成联想。
- `memory.jsonl`：稳定认知卡片。记录角色对某个主体的当前看法、理解、态度、关系判断、误解或修正。
- `mind.md`：当前短期心理、疑虑、情绪、动机冲突和当下隐秘想法。数据量小，直接进上下文。
- `state.md`：当前位置、身体状态、持有物、短期目标、场景压力和可见状态。数据量小，直接进上下文。

`init.md` 曾作为候选名，但当前建议使用 `memory-seed.md`，因为它更准确表达“初始化记忆种子”，不是运行时当前状态。

当前决策：`memory-seed.md` 确认为最终文件名。

### events.jsonl

`events.jsonl` 不是客观知识库。每条记录是 subject 当时的经历或认知片段。

第一版数据结构：

```ts
type SubjectEvent = {
    tick?: string;
    time?: string;
    text: string;
};
```

设计原则：

- 记录“当时如何经历和理解”，不要直接写抽象结论。
- 允许角色不知道名字、没有联想到、后来才认出来。
- 推理过程和推理结果也可以作为事件记录。
- 这层自带一定遗忘能力：如果旧片段没有被召回，actor 可能暂时没有完成联想。
- `tick` 是系统 tick，可选，主要用于排序、调试和后续 RAG 过滤。
- `time` 是角色能理解的故事时间，可选，例如“入学第一天早晨”。
- `text` 必须自包含；不要写“她又来了”这类脱离上下文后无法检索理解的句子。
- 初始化 seed 使用多条普通 event 表示，不需要特殊 `type`。

代表性记录：

```jsonl
{"tick":"000000","time":"故事开始前","text":"我知道自己是王都学院的新生，今天要去报到。我期待新的生活，但也担心第一天就迟到或出丑。"}
{"tick":"000000","time":"故事开始前","text":"我刚来到王都，对学院附近的路还不熟。虽然提前打听过路线，但真正走在街上时还是容易紧张。"}
{"tick":"000000","time":"故事开始前","text":"我希望自己能在王都学院站稳脚跟，不想一直依赖别人，也不想被同学看成没用的人。"}
{"tick":"000001","time":"入学第一天早晨","text":"我快迟到时，被一个粉色头发的女孩子帮了一把。幸亏有她，不然我一定会迟到。我还不知道她叫什么，只觉得以后应该找机会感谢她。"}
{"tick":"000001","time":"入学第一天早晨","text":"那个粉色头发的女孩子帮我时动作很自然，好像只是顺手做了一件小事。我有点感激，也有点不好意思，因为自己显得太慌张了。"}
{"tick":"000002","time":"第一节课前","text":"班里来了一个粉色头发的女孩子。她很显眼，但我还没有确认她是不是早上帮过我的那个人。"}
{"tick":"000002","time":"第一节课前","text":"老师点名时，我听到那个粉色头发的女孩子叫艾琳娜。我记住了这个名字，但还没有把她和早上帮我的女孩完全联系起来。"}
{"tick":"000003","time":"课间","text":"艾琳娜经过我座位旁边时，我注意到她的发色、声音和早上那个帮助我的女孩都很像。我开始怀疑她们可能是同一个人。"}
{"tick":"000003","time":"课间","text":"我突然意识到，艾琳娜很可能就是早上帮我避免迟到的粉色头发女孩。这个发现让我更想向她道谢，但我又担心直接开口会显得唐突。"}
{"tick":"000004","time":"午休前","text":"我向艾琳娜确认了早上的事，她承认是她帮了我。她没有把这件事看得很重，但我心里更确定自己欠她一个人情。"}
{"tick":"000005","time":"午休","text":"我听同学提到世界之心，据说它和世界规则、高阶力量有关。但他们说得很含糊，我现在只知道这是一个重要又危险的概念。"}
{"tick":"000006","time":"放学后","text":"我一开始以为贵族学生都很难接近，但今天有几个人主动给新生指路。也许我之前的判断太武断了，不过我还是会保持谨慎。"}
{"tick":"000007","time":"傍晚","text":"我在学院附近又走错了路，这让我确认自己对王都路线真的不熟。以后重要行程必须提前出发，不能只靠临时问路。"}
{"tick":"000008","time":"夜里","text":"回想今天的事，我觉得艾琳娜比我想象中更容易相处。我还不算了解她，但我愿意先相信她是个善良的人。"}
{"time":"后来某次谈话后","text":"艾琳娜主动问起我是否适应学院生活。我没有完全说出自己的不安，但她的关心让我觉得我们也许能成为朋友。"}
```

### memory.jsonl

`memory.jsonl` 强调“角色对某个主体的当前看法、理解”。它不是 append-only 日志，而是当前记忆状态集。

第一版数据结构：

```ts
type SubjectMemory = {
    topic: string;
    aliases?: string[];
    view: string;
};
```

字段语义：

- `topic`：主键。使用角色当前认定的主体称呼，例如 `艾琳娜`、`粉色头发的女孩子`、`世界之心`。
- `aliases`：旧称、模糊称呼或可合并称呼。角色完成认知合并后，旧 topic 可以进入 aliases。
- `view`：角色对该 topic 的当前看法、理解、态度、关系判断、误解或修正。可以很长，允许千字级自然语言。

第一版故意不保留：

- `id`：与 `topic` 重复。改名、合并和删除由 `subject_memory_update` 工具处理。
- `kind`：暂不需要；`topic + view` 足够表达人、地点、概念、物品或组织。
- `salience` / `confidence` / `evidenceEventIds`：第一版会增加 AI 维护负担，暂不加入。

示例：

```jsonl
{"topic":"粉色头发的女孩子","aliases":["早上帮过我的女孩"],"view":"我记得入学当天早晨有个粉色头发的女孩子帮过我。她让我没有迟到，我对她很感激，但当时还不知道她叫什么，也不知道以后还能不能再见到她。"}
{"topic":"艾琳娜","view":"艾琳娜是班里新来的同学。她有粉色头发，看起来很显眼。我现在还没有确认她和早上帮过我的女孩是不是同一个人。"}
```

如果角色推理出二者相同，`subject_memory_update` 应合并为：

```jsonl
{"topic":"艾琳娜","aliases":["粉色头发的女孩子","早上帮过我的女孩"],"view":"我已经意识到，艾琳娜就是入学当天早晨帮过我的粉色头发女孩。她让我避免了迟到，所以我对她有明显的感激和亲近感。我们现在是同班同学，我想找机会正式道谢，也更愿意相信她。"}
```

如果后来关系变化，继续更新同一条：

```jsonl
{"topic":"艾琳娜","aliases":["粉色头发的女孩子","早上帮过我的女孩"],"view":"艾琳娜是我的同班同学，也是入学当天早晨帮过我的粉色头发女孩。我们后来变成了关系很好的朋友。我信任她，愿意和她分享困扰，也会在她遇到麻烦时主动帮忙。"}
```

### What Belongs In memory.jsonl

可以进入 `memory.jsonl` 的内容：

- 对某个人的认知和态度。
- 对某个组织、地点、物品、概念的理解。
- 对某段长期关系的判断，但应合并到对应人 / 组织 topic 中。
- 对自己稳定能力、限制或处境的理解，例如 `我自己` 或 `王都路线`。
- 对长期目标的稳定理解，但短期打算应优先放 `mind.md`。
- 误解和修正。修正后可以写成“我曾经以为……但后来意识到……”。

不应独立进入 `memory.jsonl` 的内容：

- 纯短期念头，例如“想向艾琳娜道谢”。它可以写进 `艾琳娜.view` 或 `mind.md`。
- 短期情绪波动。它应进入 `mind.md`，除非沉淀成稳定态度。
- 与某人的关系单独开 topic，例如 `与艾琳娜的关系`。关系是 `艾琳娜.view` 的一部分。
- god-view truth、幕后真相或 simulator 裁决。所有内容必须是 subject-facing。

判断标准：

```text
这件事会不会影响角色以后如何识别、评价、选择或回避某个对象？
```

会，就考虑更新 `memory.jsonl`。不会，就只写 `events.jsonl` 或 `mind.md`。

### subject_memory_update Tool Direction

用户计划提供 `subject_memory_update` 工具，让 agent 用自然语言操作记忆。`memory.jsonl` 交给子 agent / sidecar 维护。

最新决策：调用方不负责处理具体更新逻辑。调用方只报告 subject-facing facts 数组；`subject_memory_update` 工具内部创建 / 调用一个通用 `memory.curator` profile，由该 profile 读取当前 `memory.jsonl` 后产出 JSON Patch，最后由工具应用 patch、校验并写回文件。

工具外部输入：

```ts
type SubjectMemoryUpdateInput = {
    subjectPath: string;
    facts: string[];
};
```

其中 `facts` 只写本轮角色经历、确认、误解修正、关系变化或稳定认知变化，不写“合并 A 到 B”“删除某条”等具体文件操作。

`memory.curator` profile 输入：

```ts
type MemoryCuratorInput = {
    subjectPath: string;
    facts: string[];
    currentMemories: Array<{
        topic: string;
        aliases?: string[];
        view: string;
    }>;
};
```

`memory.curator` profile 输出：

```ts
type MemoryCuratorOutput = {
    patch: JsonPatchOperation[];
};
```

`MemoryCuratorOutput` 和每个 patch operation 都不允许额外字段；`reason` / `summary` 不再放入 `report_result.data`，人类可读摘要统一写在 `report_result.result`。

工具应用 JSON Patch 后必须校验：

- `topic` 非空。
- `view` 非空。
- `aliases` 如果存在必须是字符串数组。
- 同一个 `topic` 不能重复。
- patch 结果必须仍是 `SubjectMemory[]`。

第一版允许 profile 通过 JSON Patch 自由完成：

- 更新某个 topic 的 view。
- 新增一个 topic。
- 合并两个 topic，例如把 `粉色头发的女孩子` 合并到 `艾琳娜`。
- 拆分一个 topic。
- 删除重复、过时或被合并吸收的 topic。
- 改名并保留旧名为 aliases。

不建议第一版给 `memory.curator` 直接开放 `bash` / `jq`。JSON Patch 已经能表达重写、合并、删除和改名，同时工具层更容易做校验、失败回滚和重复 topic 防护。

`events.jsonl` 继续更像追加日志；`memory.jsonl` 不是追加日志，而是可编辑的当前认知集合。

### RAG Tool Surface

第一版只给 sidecar 使用 RAG / memory 工具，主路 `simulator.actor` 不直接使用。

`simulator.actor` 的 profile 最大工具集合仍包含 sidecar 需要的 `subject_rag_search`、`subject_event_append`、`subject_memory_update`、`read`、`edit`、`report_result` 和 `report_sidecar_result`，用于 provider-visible schema 和 sidecar 子集校验；但 profile 通过 `mainRunToolKeys: ["report_result"]` 把主 run 执行权限硬收窄为只允许 `report_result`。`leader.default` 不直接拥有 subject memory / RAG 工具。

`actor.context-load` 工具：

- `subject_rag_search`
- `report_sidecar_result`

`actor.memory-save` 工具：

- `subject_event_append`
- `subject_memory_update`
- `read`
- `edit`
- `report_sidecar_result`

`subject_rag_search` 只做粗召回，不直接生成最终 actor context。`actor.context-load` 承担一部分 rerank 职责：它根据当前 actor-facing packet 过滤候选、合并重复内容、选择真正会影响角色反应的记忆，再通过 `report_sidecar_result.result` 返回纯文本，并用 `data: { "actor.context-load": {} }` 闭合旁路结果，最终由 `merge()` 压缩注入 `<actor-sidecar-context>`。

```ts
type SubjectRagSearchInput = {
    subjectPath: string;
    query: string;
    sources: ["events"] | ["memory"];
    limit?: number;
};
```

`limit` 是第一版唯一暴露给 Agent 的常用 RAG 查询参数。工具内部自行处理相似度阈值，防止明显不相关的候选进入结果；不向 Agent 暴露 `score`、`minScore`、`maxCharsPerItem`、时间范围或 tick 范围。工具结果以模型可直接阅读的文本渲染，不用 JSON 包裹候选。

`subject_event_append` 负责追加 `events.jsonl` 并校验 JSONL，不让模型手写文件格式：

```ts
type SubjectEventAppendInput = {
    subjectPath: string;
    events: Array<{
        tick?: string;
        time?: string;
        text: string;
    }>;
};
```

### RAG Boundary

第一版 RAG 只检索当前 subject 的：

- `events.jsonl`
- `memory.jsonl`

直接注入当前上下文的文件：

- `subject.md`
- `mind.md`
- `state.md`

`memory-seed.md` 只用于初始化，不应在每轮当作最新记忆重复注入。

RAG 索引原则：

- SQLite + sqlite-vec 是索引缓存，不是事实来源。
- source truth 是 subject 文件。
- embedding provider / model / dimensions 必须可配置，并记录在索引元数据中；模型或维度变化后应能重建索引。
- NeuroBook 不适配 Pi 的 embedding model。`models.*` 只管理 Pi chat / vision 模型；RAG 只读取顶层 `embedding` 配置。
- 检索必须限定 subject scope，不能跨 subject 泄露。
- RAG 返回给 actor 时必须保留 `topic` 或事件来源，避免 chunk 切开后失去主体。
- `subject_rag_search` 必须显式指定单一 source：`["events"]` 或 `["memory"]`。工具层不提供默认双搜，也不允许一次同时搜两层；需要两层记忆时由 sidecar 分别调用两次后自行合并。
- `subject_rag_search` 只暴露 `limit` 一个查询调参；相关性阈值由工具内部设置，不返回 score，也不要求 Agent 判断 score 标准。
- 第一版建议使用独立缓存库 `{project}/.nbook/subject-rag.sqlite`，不要混入 Project SQLite `.nbook/project.sqlite`。Project SQLite 是 Plot / Story durable 结构库；subject RAG 是可重建索引缓存，并依赖 sqlite-vec 虚表。
- Runtime 内 `subject_rag_search` 必须兼容 Node / Bun 两种 SQLite 运行环境：Node server/product 使用 `node:sqlite` 加载 sqlite-vec，Bun smoke 可继续使用 Bun runtime。
- embedding 未配置时，`subject_rag_search` 直接返回明确错误，不做关键词 fallback，避免误以为 RAG 已经生效。
- 写入工具只标记 dirty；`subject_rag_search` 在搜索前同步重建 dirty source。第一版不做后台索引队列。
- `actor.context-load` 注入 RAG 时必须有硬预算：最多 6 条 events + 4 条 memory，并限制最终注入文本长度，避免长线后再次撑爆上下文。

### RAG Database Draft

```sql
CREATE TABLE subject_rag_meta (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
);
```

存储 `schemaVersion`、`embedding.provider`、`embedding.model`、`embedding.dimensions`、`embedding.version` 等索引元信息。embedding 模型或维度变化时，整库可以重建。

```sql
CREATE TABLE subject_rag_sources (
    id INTEGER PRIMARY KEY,
    subject_id TEXT NOT NULL,
    subject_path TEXT NOT NULL,
    source_type TEXT NOT NULL CHECK (source_type IN ('events', 'memory')),
    source_path TEXT NOT NULL,
    source_hash TEXT NOT NULL,
    record_count INTEGER NOT NULL DEFAULT 0,
    dirty INTEGER NOT NULL DEFAULT 1,
    indexed_at TEXT,
    last_error TEXT,
    UNIQUE(subject_path, source_type)
);
```

`subject_rag_sources` 记录每个 subject 的 `events.jsonl` / `memory.jsonl` 是否需要重建索引。

```sql
CREATE TABLE subject_rag_chunks (
    id INTEGER PRIMARY KEY,
    source_id INTEGER NOT NULL REFERENCES subject_rag_sources(id) ON DELETE CASCADE,
    subject_id TEXT NOT NULL,
    subject_path TEXT NOT NULL,
    source_type TEXT NOT NULL CHECK (source_type IN ('events', 'memory')),
    source_key TEXT NOT NULL,
    chunk_index INTEGER NOT NULL DEFAULT 0,
    topic TEXT,
    tick TEXT,
    time TEXT,
    text TEXT NOT NULL,
    content_hash TEXT NOT NULL,
    created_at TEXT NOT NULL,
    UNIQUE(source_id, source_key, chunk_index)
);

CREATE INDEX idx_subject_rag_chunks_subject ON subject_rag_chunks(subject_id, source_type);
CREATE INDEX idx_subject_rag_chunks_topic ON subject_rag_chunks(subject_id, topic);
```

`source_key` 约定：

- `events`：行号或该 event 的内容 hash。
- `memory`：`topic`。

sqlite-vec 虚表示意：

```sql
CREATE VIRTUAL TABLE subject_rag_vec USING vec0(
    embedding float[DIM],
    subject_path TEXT partition key,
    source_type TEXT partition key
);
```

`subject_rag_vec.rowid` 对应 `subject_rag_chunks.id`。`subject_path` 和 `source_type` 必须作为 sqlite-vec partition 参与 KNN，避免先取全局 top-k 后再过滤导致当前 subject 召回饥饿。`subject_rag_search` 内部先检查 source hash / dirty 状态，必要时重建对应 source 的 chunks 和 vec rows，再按 source 分别召回、合并排序。不要暴露单独的 `subject_rag_index` 给 Agent。

### Embedding Service Settings

嵌入模型不复用 Agent chat model 配置，也不适配 Pi registry。第一版采用 NeuroBook 自己的 OpenAI-compatible embedding service adapter：

1. `models.*` 只保留 chat / vision 模型管理，`ModelInputKind` 维持 `text | image`。
2. Global Config 新增顶层 `embedding`，保存 `enabled`、`provider`、`model`、`dimensions`、`apiKey`、`baseURL`、`timeoutMs` 和 `requestOptions`。
3. Project Config 顶层 `embedding` 只允许覆盖 `model` 与 `dimensions`。
4. 设置界面新增独立 Embedding tab；模型设置页不再出现 embedding input / embedding model selector / embedding dimensions。
5. RAG 只读取 effective `embedding` 配置，并调用 `POST {baseURL}/embeddings`。
6. RAG index 元数据必须记录实际 provider、model、dimensions 和 schema version；这些值变化时，`subject-rag.sqlite` 应重建或明确报错。
7. `timeoutMs` 默认为 `30000`，即使旧配置文件里是 `null`，effective config 也必须回退到 30s，避免 provider 长时间不返回时 tool 永久卡在执行中。

### sqlite-vec Smoke

正式实现前必须先做 sqlite-vec 最小 smoke，覆盖 dev / Windows portable / Docker 需要的加载路径：

- 能创建 `vec0` 虚表。
- 能插入至少一条向量。
- 能用 query vector 查回结果。
- smoke 失败时先解决依赖加载和打包问题，不继续接入 subject RAG。

## Initial Implementation Plan

目标：跑通 subject RAG 流程，让 `simulation/subjects/` 拥有本 task 约定的记忆文件，并让 `simulator.actor` 通过 sidecar context 使用 RAG，主路继续专注角色扮演。

### 1. Subject Memory Contract

- 更新 simulation reference 和模板合同，把 `events.md` / `knowledge.md` 硬切为 `events.jsonl` / `memory.jsonl`。
- 明确 `memory-seed.md` 初始化语义。
- 更新 `simulator.actor` input mapping 和 sidecar 文案。
- 更新 profile contract / tests 中的字段命名，保留 subject 文件只由 sidecar 读取/维护的边界。
- 旧 `events.md` / `knowledge.md` 合同第一版 hard cut，不长期双轨，不在运行时做导入兼容。

### 2. JSONL Validation / Utilities

- 为 `events.jsonl` 和 `memory.jsonl` 提供轻量 parser / validator。
- `events.jsonl` 校验最小字段：`text` 非空，`tick` / `time` 如果存在必须是字符串。
- `memory.jsonl` 校验最小字段：`topic` 非空，`view` 非空，`aliases` 如果存在必须是字符串数组。
- 第一版不强制 `view` 长度，不强制 topic 类型。

### 3. Subject RAG Storage / Index

- 新增 subject RAG SQLite 缓存库 `{project}/.nbook/subject-rag.sqlite`。
- 初始化 `subject_rag_meta`、`subject_rag_sources`、`subject_rag_chunks` 和 sqlite-vec 虚表。
- 实现 source hash / dirty 检测。
- `events.jsonl` 按记录切 chunk。
- `memory.jsonl` 按 topic 形成基础 chunk；如果 `view` 很长，索引层可以按段落进一步切 chunk，但必须保留 `topic`。
- 索引更新策略：写入时标 dirty，搜索时同步 rebuild dirty source。第一版不做后台队列。

### 3.5 Embedding Model Config / Frontend

- 不适配 Pi embedding model；Pi 模型目录继续只用于 chat / vision 模型。
- 扩展 config 存储，增加顶层 Embedding 服务配置入口。
- 前端设置增加独立 Embedding tab。
- RAG 服务读取 effective embedding 配置；如果未配置或未启用，`subject_rag_search` 返回明确错误，不偷偷使用 chat 默认模型。
- Global embedding 保存 provider、model、dimensions、API Key、baseURL、timeout 和 requestOptions；Project-level 只保存当前 Project 的 model 与 dimensions 覆盖。

### 3.6 sqlite-vec Dependency Smoke

- 增加最小 sqlite-vec smoke test / script，确认当前运行环境能加载扩展、创建 vec0 表并执行查询。
- smoke 通过后再实现 subject RAG index。
- Windows portable 与 Docker 打包必须包含 sqlite-vec 运行依赖；如果依赖加载失败，RAG 功能应明确报错。

### 4. subject_rag_search Tool

- 输入 `{ subjectPath, query, sources, limit? }`，其中 `sources` 必须是 `["events"]` 或 `["memory"]`；`limit` 是唯一查询调参。
- 检查并按需重建当前 subject 的 dirty source。
- 使用 embedding model 生成 query embedding，并通过 sqlite-vec 召回候选。
- 工具内部应用相关性阈值，过滤明显无关候选。
- 返回模型可直接阅读的文本候选，不直接生成最终 context；不返回 score 或 JSON 包裹的候选结构。
- 检索必须限定当前 subject scope。

### 5. subject_event_append Tool

- 输入 `{ subjectPath, events }`。
- 校验并 append `events.jsonl`。
- 标记该 subject 的 `events` source dirty，或执行增量索引。
- 不允许 Agent 直接手写 JSONL 格式。

### 6. memory.curator Profile + subject_memory_update Tool

- 新增 `memory.curator` profile，只负责根据 facts 和 currentMemories 生成 JSON Patch。该 profile 命名保持通用，第一版用于 subject memory，后续可复用到其他可编辑记忆集合。
- `subject_memory_update` 工具每次都调用真实 `memory.curator` profile，读取当前 `memory.jsonl`，应用 profile 返回的 patch，校验结果并写回文件。
- patch 成功后标记该 subject 的 `memory` source dirty，或执行增量索引。
- 调用方只报告 subject-facing facts，不指定具体 JSON Patch 或 topic 操作。
- JSON Patch 应用或校验失败时，最多自动重试一次；仍失败则不写 `memory.jsonl`，返回 `needs_review`。本轮已追加的 `events.jsonl` 经历保留，不回滚。

### 7. actor.context-load Integration

- `actor.context-load` 根据当前 actor-facing packet 生成检索 query。
- 调用 `subject_rag_search` 分别检索当前 subject 的 events 与 memory；如果两层都需要，必须分两次调用。
- 由 `actor.context-load` 对候选做 rerank：过滤无关候选、合并重复信息、优先保留当前情境会影响角色反应的记忆。
- 将少量相关经历和稳定认知注入 `<actor-sidecar-context>`；该注入使用 sidecar `persistedMessages`，会进入 actor session active path、后续 run 和 compaction。
- 注入文案必须区分“当前状态”“当前心理”“相关过往经历”“相关稳定认知”。
- 注入预算：最多 6 条 events + 4 条 memory，并限制最终注入文本长度。超出时由 `actor.context-load` 选择更相关的候选，而不是全部塞入主路。

### 8. actor.memory-save Integration

- 主 run 后由 memory-save sidecar 调用 `subject_event_append` 追加 `events.jsonl`。
- 如果本轮造成稳定认知变化，调用 `subject_memory_update`，只报告 facts 数组，不处理具体合并/删除/更新逻辑。
- 短期情绪和当下动机仍更新 `mind.md`。
- `state.md` 继续由 `simulator.leader` 裁决。

### 9. Subject Initialization / Migration

- 创建新 subject 时，`memory-seed.md` 只作为初始化种子，由初始化工具 / 模板转换成第一批 `events.jsonl` 和 `memory.jsonl`。
- 运行时不反复读取 `memory-seed.md`。
- 旧 `events.md` / `knowledge.md` 合同 hard cut。运行时工具不读取旧文件，也不自动转换；旧项目必须先手动改到新 JSONL 合同再运行。

## Verification / Test

第一版建议验证面：

- parser test：`memory.jsonl` 支持长 `view`，拒绝空 `topic` / 空 `view`。
- parser test：`events.jsonl` 支持 `{ tick?, time?, text }`，拒绝空 `text`。
- subject_memory_update test：更新同 topic 不新增重复行。
- subject_memory_update test：合并 `粉色头发的女孩子` 到 `艾琳娜` 后，旧 topic 删除或进入 aliases。
- subject_memory_update test：`memory.curator` 返回 JSON Patch 后，工具应用 patch 并拒绝空 topic / 空 view / 重复 topic。
- subject_event_append test：追加多条 event 后文件仍是合法 JSONL，并标记 events source dirty。
- sqlite-vec smoke test：能创建 vec0 表、插入向量并查询成功。
- RAG search test：embedding 未配置时返回明确错误，不做关键词 fallback。
- RAG index test：`events.jsonl` 每行进入独立 chunk，`memory.jsonl` chunk 保留 topic。
- RAG index test：embedding model / dimensions 变化后能触发重建或明确报错。
- RAG index test：写入后 source 标 dirty，搜索前同步 rebuild dirty source。
- settings test：embedding model 配置能被 DTO 校验、保存和读取。
- RAG search test：同一 query 只返回当前 subject 的结果，不返回其他 subject 记忆。
- actor context-load test：`subject_rag_search` 返回候选后，sidecar 能 rerank 并区分“相关过往经历 / 相关稳定认知”注入。
- actor context-load test：注入最多 6 条 events + 4 条 memory，且超出候选会被 rerank 截断。
- actor context-load test：长线事件后仍能召回早期相关经历。
- sidecar boundary test：`simulator.actor` 主 run 不直接读取/写入完整 subject files，仍由 sidecar 注入和维护。

## Walkthrough

- 2026-06-08：用户确认第一版 subject RAG 只做两层记忆：`events.jsonl` 作为经历流，`memory.jsonl` 作为对主体的稳定看法；`subject.md`、`mind.md`、`state.md` 直接进上下文；`memory-seed.md` 作为初始化记忆种子。讨论中收敛 `memory.jsonl` schema 为 `{ topic, aliases?, view }`，删除 `id`、`kind`、`salience`、`confidence`、`evidenceEventIds`，并确认 `memory.jsonl` 支持更新、合并和删除，计划由自然语言 memory 工具维护。
- 2026-06-08：确认 `events.jsonl` 第一版 schema 为 `{ tick?, time?, text }`，删除 `type` 字段；初始化 seed 通过多条普通 event 表示，`text` 必须自包含，推理和误解修正通过追加新 event 表达。
- 2026-06-08：确认 RAG 工程落地目标是先跑通 subject RAG 流程；`actor.context-load` 使用 `subject_rag_search` 做粗召回并承担 rerank / 压缩注入职责；memory update 工具改为“调用方报告 facts，内部调用 `memory.curator` profile 产出 JSON Patch，工具校验并写回 memory.jsonl”；RAG SQLite 第一版确定独立放在 `{project}/.nbook/subject-rag.sqlite`。
- 2026-06-08：用户确认 `memory-seed.md`、独立 `subject-rag.sqlite`、旧 `events.md` / `knowledge.md` hard cut；memory update 工具每次都调用真实 curator profile；嵌入模型配置先独立于 Pi 模型设置设计。
- 2026-06-08：用户确认剩余实现边界：embedding 未配置时报错不 fallback；Provider/API Key 走全局设置，Project-level 只选 embedding model + dimensions；实现前做 sqlite-vec smoke；写入标 dirty、搜索时同步 rebuild；memory.curator patch 失败最多重试一次，仍失败则保留 events 并返回 needs_review；RAG 注入最多 6 条 events + 4 条 memory；`memory-seed.md` 只在初始化时转换；旧 `events.md` / `knowledge.md` 硬切，不在运行时做导入兼容。
- 2026-06-08：已落地 subject memory 合同：模板和 reference 切到 `subject.md` / `memory-seed.md` / `events.jsonl` / `memory.jsonl` / `mind.md` / `state.md`；新增 JSONL parser / validator / JSON Patch 应用；`subject_event_append` 会追加合法 events 并标记 RAG dirty。
- 2026-06-08：已新增 `memory.curator` profile 和真实 memory update 工具。调用方只报告 facts；工具读取当前 `memory.jsonl`，调用 curator 生成 JSON Patch，应用后校验 topic/view/aliases/重复 topic，失败重试一次，仍失败返回 `needs_review` 且不写文件。
- 2026-06-08：已新增 SQLite + sqlite-vec subject RAG 索引缓存 `{project}/.nbook/subject-rag.sqlite`，表包括 `subject_rag_meta`、`subject_rag_sources`、`subject_rag_chunks`、`subject_rag_vec`。JSONL 文件仍是事实源；写入只标 dirty，`subject_rag_search` 搜索前按 source hash / dirty 同步重建；events 每行一个 chunk，memory 按 topic/view 切 chunk并保留 topic；`subject_path` 与 `source_type` 进入 sqlite-vec partition，KNN 在当前 subject/source 内发生，避免被其他 subject 或其他 source 的全局近邻挤掉。
- 2026-06-08：已扩展配置与前端设置，增加独立 Embedding 服务配置。RAG 使用 OpenAI-compatible `/embeddings` adapter 读取 effective embedding provider/model/API Key/baseURL/dimensions；未启用 embedding、缺少 model、缺少 dimensions、缺少 API Key 或缺少 API Base 时明确报错，不做关键词 fallback。
- 2026-06-08：已接入 `simulator.actor` sidecar：`actor.context-load` 可用 `subject_rag_search` 召回当前 subject 的 events/memory 并 rerank 注入；`actor.memory-save` 可用 `subject_event_append` 和 memory update 工具维护记忆。主 actor run 继续只消费 sidecar 持久化注入的 actor-safe context，不直接读写 subject 文件。
- 2026-06-08：Harness sidecar merge 新增 `persistedMessages`。`actor.context-load` 的 `<actor-sidecar-context>` 已从 runtime-only 注入改为持久化注入，写入 actor session active path，后续 actor run 可见，并能进入 compaction summary；注入后若 provider-visible context 超出模型窗口，父 invocation 直接失败，已写入的 context 不回滚。
- 2026-06-10：`actor.context-load` sidecarData 合同收敛为纯文本 string，不再返回 `{ actor_safe_context, sources, withheld, confidence }` 等对象；sidecar 自身 transcript 改为持久化在 session tree 旁路 leaf 上，完成后恢复父 run active leaf，主路只消费 `<actor-sidecar-context>` merge 结果。
- 2026-06-14：旁路结果工具改为 `report_sidecar_result.data`；`actor.context-load` 仍返回纯文本 string，但不再通过 `report_result.sidecar_data` 旁路字段承载。
- 2026-06-15：旁路结果协议改为 sidecar-name keyed data：`actor.context-load` 的纯文本正文改写到 `report_sidecar_result.result`，`data` 只传 `{ "actor.context-load": {} }`；`actor.memory-save` 同样只用 keyed 空对象，业务摘要写在 `result`。
- 2026-06-08：验证结果：`bun scripts/smoke/subject-rag-smoke.ts` 通过；`bunx vitest run server/agent/tools/subject-memory-tools.test.ts server/agent/tools/sqlite-vec-smoke.test.ts --reporter=dot` 通过；`bunx vitest run shared/dto/app-settings.dto.test.ts server/config/config-service.test.ts server/utils/app-config.test.ts server/utils/model-settings.test.ts --reporter=dot` 通过；`bunx vitest run server/agent/harness/model-resolver.test.ts --reporter=dot` 通过；`simulator.actor 会通过 context-load` 窄测和 `rp-profiles.test.ts` 通过。`bunx tsc --noEmit --pretty false` 仍有既有无关红灯，当前不含本 task 新增的 subject RAG / embedding 类型错误。
- 2026-06-08：根据用户最新决策删除旧 subject 文件导入兼容。`subject_event_append`、`subject_rag_search` 和 memory update 工具只处理 `events.jsonl` / `memory.jsonl`；旧 `events.md` / `knowledge.md` 即使存在也不会被工具读取或转换。新增测试覆盖旧 md 存在时仍按 JSONL 硬切行为执行。
- 2026-06-08：补齐 sqlite-vec 产品打包保障。`scripts/build/patch-nitro-runtime-deps.mjs` 已把 `sqlite-vec` 纳入 Nitro runtime package seed，复制其当前平台 native optional package；`product:stage` 新增 `assertProductSqliteVecVendor()`，从 product 的 `.output/server/index.mjs` 解析 `sqlite-vec` 并确认 `load()` 与 native optional package 存在。当前本机验证 `.output/server/node_modules/sqlite-vec` 与 `sqlite-vec-windows-x64/vec0.dll` 存在，并能从 `.output/server/index.mjs` 解析到 `vec0.dll`；`bun run product:stage` 已通过，且 product 内可解析到 `product/.output/server/node_modules/sqlite-vec-windows-x64/vec0.dll`。
- 2026-06-08：修复 review 发现的两个落地问题：`subject_rag_vec` 升级到 `subject-rag-v2`，使用 `subject_path` / `source_type` partition key 并按 source 分别召回，避免 sqlite-vec 全局 top-k 先截断后过滤导致当前 subject 失忆；`assertProductSqliteVecVendor()` 改为调用 product vendor 内的 `sqliteVec.getLoadablePath()`，断言当前平台实际 native 扩展路径存在且位于 product `.output/server/node_modules`。
- 2026-06-08：用户明确 NeuroBook 不适配 Pi 的 embedding model，本轮完成硬切：`shared/dto/app-settings.dto.ts` 的 model input 只保留 `text | image`，模型设置页删除 embedding selector / dimensions；Global / Project Config 新增顶层 `embedding`，设置中心新增独立 Embedding tab，Global 配置 OpenAI-compatible embedding 服务，Project 只覆盖 model 和 dimensions。RAG 继续读取 effective `embedding`，调用 `/embeddings` adapter。
- 2026-06-08：验证更新：`bun scripts/smoke/subject-rag-smoke.ts` 通过；`bunx vitest run server/agent/tools/subject-memory-tools.test.ts server/agent/tools/sqlite-vec-smoke.test.ts --reporter=dot` 通过；`bunx vitest run server/config/config-service.test.ts server/agent/harness/model-resolver.test.ts server/utils/model-settings.test.ts server/utils/app-config.test.ts shared/dto/app-settings.dto.test.ts --reporter=dot` 通过；`bunx tsc --noEmit --pretty false` 和 `bun run typecheck` 仍失败在既有无关类型红灯，未出现本轮 Embedding / Subject RAG 新错误。
- 2026-06-08：修复 `subject_rag_search` 在普通 Project agent session 中忽略 Project embedding 覆盖的问题。RAG 现在通过 `loadEffectiveConfigForAgentRuntime({workspaceRoot, projectPath})` 读取配置；`workspaceRoot` 为容器 `workspace` 时会继续合并 `projectPath` 对应 Project Config，`projectPath` 为外部 Project Workspace 绝对根目录时会读取该目录的 `.nbook/config.json`。新增/更新验证覆盖 Project embedding 覆盖：`bun scripts/smoke/subject-rag-smoke.ts` 通过；`bunx vitest run server/agent/tools/subject-memory-tools.test.ts --reporter=dot` 通过；`bunx vitest run server/config/config-service.test.ts --reporter=dot` 通过。
- 2026-06-08：修复复审发现的外部 Project Workspace 配置读取断点。`loadEffectiveConfigForAgentRuntime()` 现在优先识别绝对 `projectPath`，把它视为外部 Project Workspace 根读取 Project Config；`NeuroAgentHarness` 内部模型解析、settleRun sidecar、context usage 与 compaction 也统一走该 helper，避免主 run 仍按 `workspace/<slug>` 解析绝对路径。新增验证：`bunx vitest run server/config/config-service.test.ts -t "Agent runtime 配置读取" --reporter=dot` 通过；`bunx vitest run server/agent/harness/neuro-agent-harness.test.ts -t "外部 Project Workspace session" --reporter=dot` 通过。
- 2026-06-08：修复任务审查发现的收尾问题：确认 `subject_rag_search` 会读取并消费 `.nbook/subject-rag-dirty.json` 中 hash 匹配的 dirty source；Project embedding 覆盖已由 smoke mock 断言实际请求使用 `project-embed` / 3 dimensions；同步更新 active task / tutorial / public docs 中仍会误导当前合同的 subject 旧 `events.md` / `knowledge.md` 口径。复验：`bun scripts/smoke/subject-rag-smoke.ts` 通过；`bunx vitest run server/config/config-service.test.ts server/agent/tools/subject-memory-tools.test.ts server/agent/tools/sqlite-vec-smoke.test.ts server/agent/profiles/rp-profiles.test.ts server/agent/harness/model-resolver.test.ts --reporter=dot` 通过。
- 2026-06-08：修复 `subject_rag_search` 在 Node/Nitro runtime 下动态 import `bun:sqlite` 导致的 ESM loader 报错。RAG 索引现在按运行环境创建 SQLite adapter：Node 使用 `node:sqlite` + sqlite-vec，Bun smoke 继续使用 `bun:sqlite`；新增 `subject_event_append` 后立刻 `subject_rag_search` 的回归测试，确认 search 会同步重建 dirty events 并消费 dirty 标记。Global Embedding 设置启用但模型/维度留空时会写入默认 `text-embedding-3-small` / `1536`，Project 空值仍表示继承 Global。复验：`bun scripts/smoke/subject-rag-smoke.ts` 通过；`bunx vitest run server/agent/tools/subject-memory-tools.test.ts --reporter=dot` 通过；`bunx vitest run server/config/config-service.test.ts --reporter=dot` 通过。
- 2026-06-08：排查 SiliconFlow embedding 卡住问题。官方文档确认 `POST /v1/embeddings` 的 `model` / `input` / Qwen3 `dimensions` 请求形状符合合同；本地探针显示 `/v1/models` 260ms 返回，`BAAI/bge-m3`、`Qwen/Qwen3-Embedding-0.6B` 和 `Qwen/Qwen3-Embedding-4B` 的 embedding 请求 100-250ms 返回，但当前配置的 `Qwen/Qwen3-Embedding-8B` 在 10-20s 内不返回。修复：effective embedding timeout 默认改为 30000ms，前端空 timeout 写入 30000，`subject_rag_search` 捕获 AbortError 并返回明确 `embedding 请求超时`，避免工具无限挂起。复验：`bunx vitest run server/agent/tools/subject-memory-tools.test.ts server/config/config-service.test.ts --reporter=dot` 通过；`bun scripts/smoke/subject-rag-smoke.ts` 通过。
- 2026-06-08：修复 `subject_rag_search` source 合同漂移。工具不再默认同时搜索 events 和 memory，也不允许一次传两个 source；调用方必须显式传 `["events"]` 或 `["memory"]`，`actor.context-load` 如需两层记忆必须分别调用两次后自行 rerank/合并。新增回归测试覆盖缺失 sources 和双 source 都会失败。
- 2026-06-08：收窄 `subject_rag_search` 查询接口。第一版只暴露 `limit`；`minScore`、`maxCharsPerItem`、tick/time 范围暂不提供。索引层改为归一化 embedding 后用内部距离阈值过滤明显无关候选；工具结果继续只渲染文本，不向 Agent 返回 score 或 JSON candidates。
- 2026-06-08：修复 profile 权限边界。`leader.default` 不再暴露 `subject_event_append`、`subject_rag_search` 和 memory update 工具；新增 `mainRunAllowedToolKeys` profile 合同和 harness 执行层接入，`simulator.actor` 主 run 只允许执行 `report_result`，RAG / memory 工具只在 `actor.context-load` 与 `actor.memory-save` sidecar 执行子集中可用。
- 2026-06-09：根据最新命名决策硬切 memory update 工具名：`memory_bio` 改为 `subject_memory_update`，与 `subject_event_append`、`subject_rag_search` 形成同一命名族；不保留旧 alias。`subject_memory_update.facts` 改为 `string[]`；`memory.curator` 的 `report_result.data` 收窄为 `{ patch }`，人类可读摘要统一放在 `report_result.result`。
- 2026-06-12：subject 文件结构在「Subject Soul 拆分」任务中调整，本文上方目录图里的 `memory-seed.md` 已废弃。当前 subject 目录为 `subject.md`（全知秘密档，仅 simulator.leader 可读）+ `soul.md`（第一人称扮演手册，直接 Import 进 actor 主路）+ `events.jsonl` / `memory.jsonl` / `mind.md` / `state.md`。冷启动初始记忆由 simulator.leader 直接落进 `events.jsonl` / `memory.jsonl`，不再经过 `memory-seed.md` 中转。`subject.md` 和 `soul.md` 永不进 RAG 索引；RAG 仍只索引 `events.jsonl` / `memory.jsonl`，本任务的 RAG 检索/索引合同不变。

## TODO / Follow-ups

- 前端 embedding 设置入口尚未做浏览器交互验收；当前只做了类型和配置层窄测。
