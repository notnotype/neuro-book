# Round 111: Profile Architecture Spec V2

## Scope

本轮把 Task 78 最新探索压成 profile architecture spec v2。它继承 Round 30，但吸收 Round 96-109 的 service/read model/tool binding/discovery/compiled runtime 结论。没有改业务代码、没有运行测试。

## Architecture

名称仍是：

```text
Director + Brief Compiler
```

核心原则：

- Agent 易用性来自深 Module，而不是扩大 profile 工具面。
- `ChapterWriterBriefService` 隐藏 Scene 查询、World Context 聚合、status/warnings 和 markdown renderer。
- `get_chapter_writer_brief` 是 Agent tool adapter，默认 text 输出 writer-safe `suggestedBriefMarkdown`。
- profile 之间只传稳定 handoff，不传 raw Plot/World Engine internals。

## Profile Interfaces

### `leader.default`

Interface：

- 用户协作入口。
- canon 与 Lorebook 取舍。
- World Engine readwrite。
- 调度 `director`、`writer`、`retrieval`、`researcher`、`world.engine`。
- 写后 reconciliation：正文产生新事实时回补 World Engine，再让 director 更新 Scene / Thread summary。

不负责：

- 不持有 Plot write tools。
- 第一阶段不持有 `get_chapter_writer_brief`。
- 不把 Plot 当动态状态真相源。

必须修改的旧语言：

- `leader-default.md` 和 `profile-routing.md` 不能再说普通写作“不路由 director / Plot”。
- 应改为：涉及 Scene/Chapter/brief 时路由 director；动态世界状态仍由 leader 通过 World Engine 负责。

### `director`

Interface：

- Plot Thread / Scene read/write。
- Chapter Scene order。
- Scene World Anchor。
- `get_chapter_writer_brief`。
- 输出 writer handoff、open questions、World Engine requests。

不负责：

- 不写 World Engine。
- 不写正文。
- 不调用旧 simulator 作为普通写作 gate。

OutputSchema v2：

```ts
{
    summary: string;
    status: "completed" | "needs_user" | "blocked";
    plot_updates: Array<{
        kind: "thread" | "scene";
        action: "created" | "updated" | "read" | "skipped";
        id?: string;
        title?: string;
        summary: string;
    }>;
    chapter_plan: string;
    writer_handoff: string;
    world_engine_requests: string[];
    open_questions: string[];
}
```

Strictness:

- root `additionalProperties: false`。
- `plot_updates[]` item `additionalProperties: false`。
- 不保留 `simulator_requests`。
- 不保留 `kind: "plot"`。

### `writer`

Interface：

- 写入或修改 `invoke_agent.input.path` 指定的唯一 Markdown 文件。
- 消费 `invoke_agent.message` 中完整 brief。
- 使用 readonly `execute_world` 自查状态。

不负责：

- 不持有 Plot tools。
- 不持有 `get_chapter_writer_brief`。
- 不通过 `threadIds/sceneIds/plotIds` 自行读取 Plot。
- 不写 World Engine。

旧 payload 字段 `threadIds/sceneIds/plotIds` 保留为兼容字段，但 prompt 和 renderer 不应把它们作为普通写作路径。

### `world.engine`

Interface：

- World Engine schema/calendar/subject/slice 维护。
- 复杂状态修复和验证。
- readwrite `execute_world`。

不负责：

- 不持有 Plot/brief tools。
- 不生成 writer handoff。
- 不成为剧情导演。

## Module Interfaces

### `ChapterWriterBriefService`

Input：

```ts
{ projectPath: string; chapterPath: string }
```

Output：

- `chapterPath`
- `status`
- `warnings`
- `scenes`
- `suggestedBriefMarkdown`

Status precedence：

```text
path error -> throw
needs_plot -> needs_world_anchor -> needs_world_context -> ready
```

Implementation locality：

- 调 `findChapterScenesForBrief()`。
- 调 Scene entity-level World Context helper。
- 聚合 warnings/status。
- 渲染 `suggestedBriefMarkdown`。

不负责：

- 不写 Plot。
- 不写 World Engine。
- 不读写 `plot.selection`。
- 不决定 writer output path。
- 不伪造 Task 80 的 `ChapterOverride`。

### `get_chapter_writer_brief` tool

Input：

```ts
{ projectPath: string; chapterPath: string }
```

Result：

```ts
{
    content: [{type: "text", text: suggestedBriefMarkdown}],
    details: ChapterWriterBriefDto
}
```

Tool adapter 只负责 result shape 和 runtime context，不承载业务判断。

## Tool Matrix

| Profile | Plot read/write | Brief tool | World read | World write | Writer file write |
| --- | --- | --- | --- | --- | --- |
| `leader.default` | No | No in v1 | Yes | Yes | No |
| `director` | Yes | Yes | Via Scene World Context | No | No |
| `writer` | No | No | Yes | No | Yes |
| `world.engine` | No | No | Yes | Yes | No |

## Acceptance

实现完成必须同时证明：

- profile source：system 和 active user root 都更新，或明确消除 user shadow。
- schema strict：`Value.Check()` 拒绝旧 `simulator_requests`、旧 `plot` kind、root extra、item extra。
- OpenAPI：world-context 与 chapter-writer-brief 都有独立 explicit path。
- brief Module：fixture 覆盖 `needs_plot / needs_world_anchor / needs_world_context / ready`。
- tool binding：runtime tool、global registry、typed binding、director toolset、discovery result 和 compiled artifact 全部成立。
- writer isolation：writer 无 Plot/brief tools，但可消费上游 Scene / World Context brief。

## Conclusion

Profile architecture spec v2 已足够指导实现。后续除非真实使用反馈推翻工具矩阵，不再重新比较 leader full Plot、writer self-serve Plot 或 world.engine brief owner。

