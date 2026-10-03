# Content Node Retrieval

内容节点进入 Agent 上下文不再使用内容节点级 `inject`。当前模型分成两层：

- `retrieval`：内容节点声明自己是否可以进入任务相关召回候选。
- [../agent/profile-context-memory.md](../agent/profile-context-memory.md)：profile 自己维护哪些 Project 上下文需要优先读取、可能读取或避免读取。

## Frontmatter

标准内容节点 `index.md` frontmatter 包含：

```yaml
retrieval:
  enabled: true
  trigger: null
```

字段语义：

- `retrieval.enabled`：是否允许该节点进入 AI 自动检索候选。
- `retrieval.trigger`：自然语言触发条件。为空表示不需要额外触发判断。

长期稳定的 profile-scoped 上下文选择不写在内容节点 frontmatter 中。它由 `agents/{profile}/context.md` 和 `agents/{profile}/generated.md` 管理。

## Retrieval Profile

`retrieval` 是专门的内容节点召回 profile。它允许使用 shell 搜索能力，例如 `rg`，也可以读取候选文件，但不编辑文件。它的输出面向 Leader，用于判断哪些内容节点值得传给 `writer`。

输入结构：

```ts
{
    prompt: string;
}
```

`prompt` 承载完整检索请求：任务目标、要找什么、给谁用、章节/正文上下文、排除项和数量偏好。

输出必须通过 `report_result` 工具提交完成结果。`report_result.data` 是给 Leader 使用的候选判断对象：

```ts
{
    entries: Array<{
        path: string;
        reason: string;
        use?: string;
        risk?: string;
    }>;
    note?: string;
}
```

其中 `path` 是唯一会传给 writer payload `context.lorebookEntries` 的字段；`reason` / `use` / `risk` / `note` 只给 Leader 判断，不直接传给 writer。

## Writer Flow

推荐流程：

1. Leader 或系统入口先创建并调用 `retrieval`。
2. Retrieval profile 根据自然语言 prompt 召回内容节点，调用 `report_result` 返回 `data: { entries, note? }`。
3. Leader 或系统入口阅读 `reason` / `use` / `risk` 后，把选中的 `entries[].path` 映射为 `invoke_agent.input.context.lorebookEntries`。
4. Writer 根据本轮 `message` 判断是否用 `read` 主动读取内容节点的 `index.md` 与同级可选 `state.md`。

这种设计让 retriever 专注路径选择，让 writer 获得明确建议上下文，同时避免在 prepare 阶段无差别注入大量文件正文。
