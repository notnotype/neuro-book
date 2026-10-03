# 2026-06-30 Round 21 - Delegation Protocol

## Scope

本轮把 profile 架构转成 leader / director / writer 的实际调用协议。重点是 `create_agent` / `invoke_agent` 的 initial、message、input 如何组织，避免 Agent 在工具调用时把 brief、Plot id、Project path 放错位置。

本轮不修改业务代码。

## Current Evidence

当前 collaboration tools 合同：

- `create_agent.initial` 必须是 JSON object，匹配目标 profile `InitialSchema`。
- `invoke_agent.input` 必须是 JSON object，匹配目标 profile `PayloadSchema`。
- `invoke_agent.message` 是 plain text。
- `get_agent_profile(profileKey)` 是结构化 create/invoke 前的必查步骤。

当前 profile 合同：

- `director.initial`：
  - `projectPath`
  - optional `mode`
  - optional `defaultChapterPath`
- `writer.initial`：空对象。
- `writer.payload`：
  - `path`
  - optional `context.lorebookEntries`
  - optional `context.readablePaths`
  - 历史兼容 `threadIds/sceneIds/plotIds`，普通写作 writer 会忽略。

## Leader To Director

### Create Director

leader 创建 director 时：

```ts
create_agent({
    profileKey: "director",
    initial: {
        projectPath: "workspace/<project>",
        mode: "writing",
        defaultChapterPath: "manuscript/<volume>/<chapter>/"
    },
    title: "剧情导演 - <chapter title>"
})
```

规则：

- `projectPath` 用 Plot 工具需要的 `workspace/<project>`。
- `defaultChapterPath` 用 Project Workspace 相对值，例如 `manuscript/001-volume/001-chapter/`。
- 不把完整剧情 brief 放进 `initial`。
- 长期同一章节或同一 Plot 任务可以复用已有 director session。

### Invoke Director

leader 调 director 时，优先把本轮任务放进 `message`：

```text
请为 manuscript/001-volume/001-chapter/ 编排本章 Scene。

目标：
- ...

已确认的 World Engine 事实：
- ...

需要你做：
- 读取当前 Plot tree / chapter plot。
- 创建或更新 Thread / Scene。
- 为每个 Scene 设置尽可能准确的 worldAnchor。
- 如果需要未裁决世界事实，放进 world_engine_requests，不要自行裁决。
- 返回 writer_handoff。
```

`invoke_agent.input` 当前不需要，因为 director 没有 PayloadSchema；结构化上下文放 message 即可。

## Director To Leader

director 必须通过 `report_result.data` 返回结构化结果。

目标 schema 应调整为：

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

规则：

- `world_engine_requests` 是给 leader 的待处理事项，不是给 world.engine 或 simulator 的直接调用。
- `writer_handoff` 可以先由 director 手写；brief tool 落地后应优先来自 `get_chapter_writer_brief`。
- `open_questions` 面向用户或 leader；不能混入已裁决事实。

## Leader To World Engine

如果 director 返回 `world_engine_requests`：

1. leader 判断是否需要问用户。
2. 对已确认事实，leader 用 `execute_world(readwrite)` 写入或修正 World Engine。
3. leader 再 invoke director 更新 Scene World Anchor / Thread summary。

不要让 director 自己使用 World Engine 写工具。

## Director To Brief Tool

brief tool 落地后，director 在章节 handoff 前调用：

```ts
get_chapter_writer_brief({
    projectPath: "workspace/<project>",
    chapterPath: "manuscript/<volume>/<chapter>/"
})
```

使用规则：

- 如果 status 是 `ready`，把 `suggestedBriefMarkdown` 作为 writer_handoff 基础。
- 如果 status 是 `needs_world_anchor`，先更新 Scene worldAnchor。
- 如果 status 是 `needs_world_context`，把 unresolved 或 context failure 放给 leader 处理。
- 如果 status 是 `needs_plot`，先补 Scene / summary。

## Leader To Writer

writer 创建：

```ts
create_agent({
    profileKey: "writer",
    initial: {},
    title: "正文写作 - <chapter title>"
})
```

writer 调用：

```ts
invoke_agent({
    sessionId,
    message: "<完整 writer brief>",
    input: {
        path: "<project>/manuscript/<volume>/<chapter>/index.md",
        context: {
            lorebookEntries: [
                "<project>/lorebook/character/hero/"
            ],
            readablePaths: [
                "<project>/manuscript/000-prologue/index.md"
            ]
        }
    }
})
```

规则：

- `path` 必须是 Agent cwd-relative Project Markdown 路径，形如 `<project>/manuscript/.../index.md`。
- 不用 `threadIds/sceneIds/plotIds` 给 writer 传 Plot 上下文。
- message 必须是完整 brief，不要只写“按 scene 写这一章”。
- 如果 writer 提问，leader 修改/扩展完整 brief 后再次 invoke 同一个 writer session。

## Handoff Failure Handling

| Failure | Owner | Response |
| --- | --- | --- |
| director 缺 World Engine 事实 | leader | 用 `world_engine_requests` 处理，不让 director 裁决。 |
| brief status `needs_plot` | director | 补 Scene / summary / chapter order。 |
| brief status `needs_world_anchor` | director + leader | director 补 anchor；若时间/subject 未裁决则回 leader。 |
| brief status `needs_world_context` | leader | 处理 unresolved subject 或 World Engine 查询问题。 |
| writer 认为材料不足 | leader | 扩展完整 brief，再 invoke writer。 |
| writer 写出新事实 | leader | 回到 World Engine 写入，再让 director 更新 Plot 摘要。 |

## Result

这个 delegation protocol 固化了三条边界：

- `initial` 存稳定创建语义，不放任务正文。
- `message` 放本轮自然语言任务或完整 brief。
- `input` 只放目标 profile 的结构化 payload。

后续 prompt 修改应把这套协议写进 `leader.default`、`director` 和 writing workflow reference。

