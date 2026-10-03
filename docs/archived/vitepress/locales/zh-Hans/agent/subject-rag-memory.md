# Subject RAG 记忆（历史系统）

::: danger 当前状态：未接通
这是 RP / 世界模拟时代的第一版长期记忆机制。**当前没有任何内置消费者**——数据结构、索引和三个底层工具都保留着，但内置 `simulator.actor` 只开放 `report_result`，不会自动检索或保存记忆，而 RP 入口本身也已从常规界面下线。

把它当作"可供未来 workflow / job 接入的基础能力"来读，不是现在就能用的功能。**写小说不需要读这一页**——写作模式的世界状态真相源是 [World Engine](/core/world-engine)。
:::

Subject RAG 不是整本书的搜索，也不是 lorebook 搜索；它只帮助某个 `simulator.actor` 想起"自己经历过什么"和"自己现在怎么看某些人或事"。

## 它解决什么

长线 RP 中，角色很容易失忆，或者因为看到了过多上帝视角设定而变得全知。Subject RAG 把这两个问题拆开：

- 角色经历和稳定认知写在自己的 subject 文件里。
- actor 主 run 不直接读取完整文件。
- 显式外部流程可以检索少量相关记忆，压缩成 actor-safe context，再通过 actor-facing message 注入。
- 主 run 只根据明确提供的 actor-safe 信息进行扮演。

这样角色能回忆过去，但不会自动知道 lorebook、entity 或其他 subject 中的隐藏真相。

## Subject 文件

每个重要角色、玩家主角或势力代表都应该有自己的 subject 目录：

```text
simulation/subjects/{subject-id}/
|-- subject.md
|-- soul.md
|-- events.jsonl
|-- memory.jsonl
|-- mind.md
`-- state.md
```

这些文件分工不同：

| 文件 | 用途 |
| --- | --- |
| `subject.md` | 全知秘密档，只有 `simulator.leader` 可读，含隐藏真相和调度提示，永不进 actor 主路也永不进 RAG 索引。 |
| `soul.md` | 第一人称扮演手册（无 frontmatter），直接 Import 进 actor 主 run 作为身份，只含角色自知信息，不含秘密，永不进 RAG 索引。 |
| `events.jsonl` | 经历流，每行记录一次经历、观察、听闻、误解或推理。 |
| `memory.jsonl` | 稳定认知，每行记录角色对某个 topic 的当前看法。 |
| `mind.md` | 当前心理、情绪、疑虑和短期动机。 |
| `state.md` | 当前位置、身体状态、持有物、短期目标和可见状态。 |

初始化记忆没有中转文件：创建 subject 时由 `simulator.leader` 直接把冷启动经历写进 `events.jsonl`、把冷启动稳定认知写进 `memory.jsonl`。

subject 侧 `events.md` / `knowledge.md` 是旧合同，当前运行时不再读取，也不会自动迁移。

## 两层长期记忆

`events.jsonl` 像角色的日记。它记录“当时如何经历和理解”，不要求一开始就是整理好的事实：

```jsonl
{"time":"入学第一天早晨","text":"我快迟到时，被一个粉色头发的女孩子帮了一把。我还不知道她叫什么，只觉得以后应该找机会感谢她。"}
{"time":"第一节课前","text":"老师点名时，我听到那个粉色头发的女孩子叫艾琳娜。我记住了这个名字，但还没有把她和早上帮我的女孩完全联系起来。"}
```

`memory.jsonl` 是角色当前稳定看法：

```jsonl
{"topic":"艾琳娜","aliases":["粉色头发的女孩子","早上帮过我的女孩"],"view":"我已经意识到，艾琳娜就是入学当天早晨帮过我的粉色头发女孩。她让我避免了迟到，所以我对她有明显的感激和亲近感。"}
```

`events.jsonl` 更适合追加；`memory.jsonl` 更适合更新、合并、改名和删除。

## 当前 actor 集成边界

`simulator.actor` 主 run 不直接读取完整 `events.jsonl` 或 `memory.jsonl`，但当前也没有自动流程替它检索。一次调用只会消费 `soul.md`、当前 actor-facing message，以及调用方已经显式放进消息的 actor-safe 信息。

未来的 workflow/job 应显式完成下面的链路：

1. 根据当前 actor-facing packet 构造检索 query。
2. 用 `subject_rag_search` 分别检索当前 subject 的 `events` / `memory`。
3. rerank、去重、过滤并压缩为 actor-safe context。
4. 通过 actor-facing message 注入 actor-safe context。
5. actor 返回后，再由外部流程按明确规则调用 `subject_event_append` / `subject_memory_update`。

仓库当前尚未提供这条内置自动 workflow。因此，仅配置 Embedding 或准备 JSONL 文件不会让 actor 自动获得长期记忆。

## RAG 索引

Subject RAG 使用 Project 内的可重建缓存：

```text
{project}/.nbook/subject-rag.sqlite
```

事实来源仍然是 `events.jsonl` 和 `memory.jsonl`。索引只用于加速检索，可以删除后重建；删除索引不会删除角色记忆。

检索被限制在当前 subject 内。实现上，索引按 `subject_path` 和 `source_type` 分区，避免 actor 召回其他 subject 的私有记忆。

写入记忆时，工具只标记 dirty。下一次 `subject_rag_search` 搜索前，会检查 source hash 和 dirty 状态，必要时同步重建对应索引。

如果你更换了 embedding 模型或维度，旧索引会明确报错。第一版处理方式是删除 `{project}/.nbook/subject-rag.sqlite`，让下一次检索重新建立索引。

## Embedding 设置

Subject RAG 需要独立的 embedding 服务。它不使用 Pi 的 chat / vision 模型目录。

在设置里打开 `Embedding` tab：

- Global scope 配置 OpenAI-compatible embedding 服务、API Key、Base URL、模型名和维度。
- Project scope 只能覆盖当前 Project 的模型名和维度。

RAG 调用：

```text
POST {baseURL}/embeddings
```

如果 embedding 没启用，或缺少 model、dimensions、API Key、Base URL，`subject_rag_search` 会明确失败，不会偷偷退回关键词搜索。

只有显式调用 `subject_rag_search` 时才会出现这类配置错误。当前 actor run 不会自动触发检索；没有错误也不能证明长期记忆已经生效。

## 使用边界

Subject RAG 第一版只做这些事：

- 检索当前 subject 的 `events.jsonl`。
- 检索当前 subject 的 `memory.jsonl`。
- 为显式 workflow/job 构造 actor-safe 记忆摘要提供底层能力。
- 为受控的外部记忆维护流程提供追加和整理工具。

它暂时不做：

- lorebook RAG。
- Project 全局 RAG。
- GraphRAG。
- 自动 who-knows-what 知识图。
- 旧 `events.md` / `knowledge.md` 自动迁移。

## 继续阅读

- [Agent Workflow 与 Job](./workflow.md)
- [Agent 工具](./tools.md)
- [Subject RAG Reference](https://github.com/notnotype/neuro-book/blob/master/packages/neuro-book/assets/reference/content/subject-rag-memory.md)
