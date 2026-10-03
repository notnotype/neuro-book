# 其他 Profile

除了 leader 和 writer，NeuroBook 还有一组专用 profile。它们的共同目标是缩小职责边界，让每个 agent 只处理自己擅长的任务。

## retrieval

`retrieval` 是内容节点召回和候选判断 agent。它接收自然语言 prompt，搜索 `lorebook/`、`manuscript/` 等内容节点，并通过结构化结果返回候选条目。

leader 会读取 `entries[].path`、`reason`、`use` 和 `risk`，再决定哪些路径交给 writer。不要把 retrieval 的完整分析原样塞给 writer。

## researcher

`researcher` 用于联网研究。`leader.default` 本身不直接拥有联网搜索能力；需要最新资料、价格、政策、版本、新闻或来源核验时，应交给 researcher。

researcher 通常返回普通 Markdown 结果和来源链接，不使用 `report_result`。

## summarizer

`summarizer` 是后台 profile，用于生成 session title 和 summary。它不保存自身 assistant/tool transcript 到主历史，而是通过 runtime-only 方式读取 source dialogue 并写回 source session 元数据。

## leader.assets

`leader.assets` 帮助用户维护 `workspace/.nbook` 下的 profile、Skill、模板、profile 默认 home 资源和配置覆盖层。它适合解释 user-assets 机制、创建 profile 模板、检查 profile 编译状态。

## world.engine

`world.engine` 负责复杂 World Engine 的维护与校验，使用 readwrite 模式的 `execute_world`。日常写作不需要它——`leader.default` 自己就能推进世界状态；只有 schema 设计、批量修正或疑难 issue 排查才需要它。

## inline.editor

`inline.editor` 是 Markdown Studio 里 Inline AI 的 profile。它跑在独立后台会话上，不占用主 Agent 会话，也不会自动弹开 Agent 面板。

## memory.curator

`memory.curator` 为 `subject_memory_update` 工具生成记忆补丁，由工具层调用，不由用户直接创建。

## Simulation profiles（入口已下线）

::: warning
`simulator.leader`、`simulator.actor`、`rp.writer` 属于 RP / 世界模拟体系，**已从新建 Agent 菜单隐藏**，正在按写作模式的标准重新设计。profile 文件和历史会话保留。

`simulator.actor` 当前只开放 `report_result`，不会自动检索或保存记忆。Subject RAG 的数据与工具仍保留但**没有内置消费者**，见 [Subject RAG 记忆](/agent/subject-rag-memory)。
:::

## 继续阅读

- [Agent Reference](https://github.com/notnotype/neuro-book/blob/master/packages/neuro-book/assets/reference/agent/README.md)
- [Agent Workflow 与 Job](/agent/workflow)
