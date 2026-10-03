# Subject RAG Memory

Subject RAG Memory 是 `simulation/subjects/` 的第一版长期记忆机制。它只服务当前 subject，不检索完整 Project、不检索 lorebook，也不实现 GraphRAG。

目标是支持 `simulator.actor` 在长线 world simulation / RP 中召回自己过去经历和稳定认知，同时保持 actor-facing 信息边界：actor 只能使用自己合理知道的内容，不能因为 lorebook、entity 或其他 subject 中存在真相就变成全知。

它是可供 runtime 流程使用的数据、索引和工具能力，不是作者手工整理素材的通用搜索入口。作者仍应把稳定真相写进 `lorebook/`，把有状态实例写进 `simulation/entities/`，把 subject-facing 认知写进当前 subject 文件。

> **Current integration status.** 数据文件、RAG 索引和 Subject memory 工具仍保留，但当前没有内置自动消费者。`simulator.actor` 主 run 只暴露 `report_result`，不会自动检索或维护记忆；后续应由显式 workflow/job 重建这条流程。

## Scope

第一版 RAG 只覆盖当前 subject 的两个事实源文件：

```text
simulation/subjects/{subject-id}/events.jsonl
simulation/subjects/{subject-id}/memory.jsonl
```

这两个文件可以由授权调用方通过 `subject_rag_search` 检索召回。检索工具只处理索引源，不读取 `subject.md`、`soul.md`、`mind.md` 或 `state.md`；把候选整理成 actor-safe context 是外部 workflow/job 的职责，而不是工具或 `simulator.actor` 的自动行为。

角色人设由 `soul.md` 提供（第一人称扮演手册，已被 actor 主路直接 Import）；隐藏真相由全知档 `subject.md` 保管（仅 simulator.leader 可读）。这两个文件都不进 RAG 索引。

初始化记忆没有中转文件：创建 subject 时，由 simulator.leader 直接把冷启动经历写进 `events.jsonl`、把冷启动稳定认知写进 `memory.jsonl`。

## Subject Memory Files

`events.jsonl` 是经历流。每行是一条 subject 当时的经历或认知片段：

```ts
type SubjectEvent = {
    tick?: string;
    time?: string;
    text: string;
};
```

它记录 subject 当时经历了什么、观察到什么、被告知什么、怎么想、产生了什么误解、后来又完成了什么推理。它不是客观知识库，也不要求每条记录都已经完成联想。

`memory.jsonl` 是稳定认知集合。每行是 subject 对某个 topic 的当前看法：

```ts
type SubjectMemory = {
    topic: string;
    aliases?: string[];
    view: string;
};
```

它不是 append-only 日志。重要记忆可以被更新、合并、改名或删除。例如 subject 先记住“粉色头发的女孩子”，之后认识“艾琳娜”，再推理出二者相同；此时 `memory.jsonl` 应把旧 topic 合并到 `艾琳娜`，旧称放入 `aliases`。

## Tools

Subject memory 工具保留给显式授权的调用方，例如未来的记忆 workflow/job。它们不绑定到 `simulator.actor` 根工具集；actor 主 run 不读取完整 subject 文件，也不直接维护文件，实际执行权限只允许 `report_result`。工具入参中的 `subjectPath` 相对当前 Project Workspace File Scope，通常形如 `simulation/subjects/{subject-id}`。

`subject_event_append`：

- 追加 `events.jsonl`。
- 校验每条 event 的 `text` 非空，`tick` / `time` 若存在必须是字符串。
- 标记该 subject 的 `events` source dirty。
- 避免 agent 直接手写 JSONL 格式。

`subject_memory_update`：

- 调用方只报告 subject-facing facts 数组，不指定“合并 A 到 B”或 JSON Patch 操作。
- 工具读取当前 `memory.jsonl`。
- 调用真实 `memory.curator` profile 产出 JSON Patch。
- 工具应用 patch 后校验 `topic`、`view`、`aliases` 和重复 topic。
- patch 失败最多重试一次；仍失败则返回 `needs_review`，不写坏文件。
- 成功写入后标记该 subject 的 `memory` source dirty。

`subject_rag_search`：

- 输入当前 `subjectPath`、`query`、`sources` 和 `limit`。
- `sources` 必须显式指定单一 source：`["events"]` 或 `["memory"]`。工具不提供默认双搜，也不允许一次同时搜索两层；需要两层记忆时由调用方分两次调用。
- `limit` 是第一版唯一暴露的查询调参；相关性阈值由工具内部设置。
- 搜索前检查 source hash 和 dirty 状态，必要时同步重建索引。
- 使用 configured embedding service 生成 query embedding。
- 只在当前 subject 和指定 source 内召回候选。
- 返回文本渲染的候选，不返回 score，也不用 JSON 包裹候选；工具不直接生成最终 actor context。

## RAG Index

RAG 索引库位于 Project Workspace：

```text
{project}/.nbook/subject-rag.sqlite
```

它是可重建缓存，不是事实来源。事实来源始终是 `events.jsonl` 和 `memory.jsonl`。删除该 SQLite 文件不会删除角色记忆，只会要求下一次检索重新建立索引。

核心表：

- `subject_rag_meta`：schema version、embedding provider、embedding model 和 dimensions。
- `subject_rag_sources`：每个 subject 的 `events` / `memory` source hash、dirty 状态和索引时间。
- `subject_rag_chunks`：切分后的文本 chunk，保留 source、topic、tick、time 和 source path。
- `subject_rag_vec`：sqlite-vec 向量表。

`subject_rag_vec` 使用 `subject_path` 和 `source_type` 作为 partition key。检索时先限定当前 subject 和 source，再做 KNN。这避免两个问题：

- 当前 actor 召回到其他 subject 的私有记忆。
- 全局 top-k 先截断，导致当前 subject 的相关记忆被其他 subject 或其他 source 挤掉。

如果 embedding provider、model 或 dimensions 与索引元数据不一致，第一版会明确报错，要求删除 `.nbook/subject-rag.sqlite` 后重建。这样可以避免不同维度或不同模型的向量混在同一个缓存库里。

## Embedding Config

Subject RAG 不使用 Pi model registry。Pi 模型配置只管理 chat / vision 模型。

NeuroBook 顶层 Config 提供独立 embedding 配置。Global Config 保存服务级信息：

```ts
embedding: {
    enabled: boolean;
    provider: "openai-compatible";
    model: string | null;
    dimensions: number | null;
    apiKey: string;
    baseURL: string;
    timeoutMs: number | null;
    requestOptions: Record<string, JsonValue>;
};
```

Project Config 只能覆盖当前 Project 的 embedding model 和 dimensions：

```ts
embedding: {
    model?: string | null;
    dimensions?: number | null;
};
```

`subject_rag_search` 读取 effective `embedding` 配置，并调用：

```text
POST {baseURL}/embeddings
```

未启用 embedding、缺少 model、缺少 dimensions、缺少 API Key 或缺少 API Base 时，工具会明确失败，不做关键词 fallback。

Agent runtime 读取配置时必须使用 `workspaceRoot + projectPath` 合并 Project Config。普通 Project session 的 `workspaceRoot` 通常是容器 `workspace`，Project 覆盖由 `projectPath` 表达；外部 Project Workspace session 则以绝对 `projectPath` 读取该 Project 的 `.nbook/config.json`。

## Runtime Integration

当前内置合同：

- `simulator.actor` 直接 Import `soul.md`，消费当前 actor-facing packet，并只通过 `report_result` 返回角色反应。
- 调用 actor 不会隐式触发 `subject_rag_search`、`subject_event_append` 或 `subject_memory_update`，也不会自动更新 `mind.md`。

未来以 workflow/job 重建时，建议保持显式步骤：

1. 授权流程基于 actor-facing packet 生成检索 query。
2. 对需要的 source 分别调用 `subject_rag_search`；如果同时需要 events 和 memory，分别传 `["events"]`、`["memory"]`，除 `limit` 外不增加模型侧查询调参。
3. 流程自行 rerank、去重、过滤、压缩，并把 actor-safe 文本随本次 actor invocation 显式传入。
4. actor 返回后，授权流程再根据真实结果显式调用 `subject_event_append`、`subject_memory_update`，并在确有权限和需要时维护 `mind.md`。
5. 外部流程必须继续遵守 subject 隔离、信息控制、注入预算和写入证据边界；不得让 `simulator.actor` 获得文件或记忆工具权限。

## Boundaries

- Subject RAG 第一版不检索 lorebook。
- Subject RAG 第一版不检索完整 Project。
- Subject RAG 第一版不实现 who-knows-what GraphRAG。
- 当前没有内置自动检索或自动记忆维护流程；保留工具不等于 `simulator.actor` 会自动消费它们。
- subject 侧 `events.md` / `knowledge.md` 已 hard cut，运行时工具不读取、不导入、不自动迁移。
- lorebook 和 entity 可以保存真相；subject 是否知道这些真相，只由自己的 `events.jsonl`、`memory.jsonl`、`state.md` 和 simulator 过滤输入决定。

## Related References

- [simulation.md](simulation.md)
- [information-control.md](information-control.md)
- [../agent/workflow/README.md](../agent/workflow/README.md)
