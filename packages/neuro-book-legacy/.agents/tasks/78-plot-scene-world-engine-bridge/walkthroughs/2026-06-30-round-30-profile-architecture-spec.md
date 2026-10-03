# 2026-06-30 Round 30 - Profile Architecture Spec

## Scope

本轮把前面多轮探索压缩成一份可执行的 profile architecture spec。它不是新方案，而是把已经收敛的 Director + Brief Compiler 作为第一阶段规范写清楚，便于后续实现时对照。

本轮不修改业务代码。

## Architecture Name

**Director + Brief Compiler**

核心判断：Agent 易用性不通过扩大 `leader.default` 或 `writer` 的工具面实现，而通过加深 `director` 和 `ChapterWriterBriefService` 的 Interface 实现。

## Profile Responsibilities

### `leader.default`

**Owns**

- 用户协作入口。
- canon 决策。
- World Engine readwrite。
- writer / director / retrieval / world.engine 调度。
- post-write reconciliation：正文产生新事实后回补 World Engine，再让 director 更新 Scene / Thread summary。

**Does not own**

- Plot write tools。
- Thread / Scene / Chapter Scene order 的直接维护。
- `get_chapter_writer_brief` 第一阶段不持有。

**Allowed later**

- 如果真实使用证明 director 往返成本过高，只加只读 `get_chapter_writer_brief`，不加 create/update Plot tools。

### `director`

**Owns**

- Plot Thread / Scene 结构。
- Chapter Scene order。
- Scene World Anchor。
- writer handoff。
- `get_chapter_writer_brief` 第一持有者。

**Does not own**

- World Engine 写入。
- 正文写作。
- 旧 simulation/RP 裁决。

**Reports**

- `plot_updates`
- `chapter_plan`
- `writer_handoff`
- `world_engine_requests`
- `open_questions`

### `writer`

**Owns**

- 指定 Markdown 文件的正文写作、续写、润色。
- readonly `execute_world` 自查一致性。

**Does not own**

- Plot tools。
- World Engine 写入。
- 章节剧情结构设计。
- 通过 `threadIds/sceneIds/plotIds` 自行读取 Plot。

writer 的上下文来自 `invoke_agent.message` 中完整 brief，`input.path` 只负责唯一写入目标。

### `world.engine`

**Owns**

- World Engine schema/calendar/subject/slice 数据维护。
- 复杂状态修复和验证。

**Does not own**

- Plot 结构。
- writer handoff。
- 正文。

## Module Interfaces

### Director Contract

第一阶段目标 schema：

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

删除旧 Interface：

- `kind: "plot"`
- `simulator_requests`

### Chapter Writer Brief

第一阶段目标：

- 输入：`projectPath + chapterPath`
- 输出：`status + warnings + worldQueryHints + suggestedBriefMarkdown + structured details`
- 状态：`ready | needs_plot | needs_world_anchor | needs_world_context`

该 Module 不写 Plot，不写 World Engine，不生成 ChapterOverride。

### OpenAPI Route Metadata

第一阶段目标：

- `RouteMetaEntry.path?: string`
- catch-all route 的多语义 endpoint 必须写显式 path。

## First-Stage Tool Matrix

| Profile | Plot read | Plot write | Brief | World read | World write |
| --- | --- | --- | --- | --- | --- |
| `leader.default` | No | No | No | Yes | Yes |
| `director` | Yes | Yes | Yes | Via Scene World Context only | No |
| `writer` | No | No | No | Yes | No |
| `world.engine` | No | No | No | Yes | Yes |

## Non-Goals

- 不恢复 `StoryPlot / Plot Beat`。
- 不让 Plot 保存动态世界状态。
- 不在 Task 78 实现 ChapterOverride。
- 不把 writer 变成 Plot reader。
- 不把 world.engine 变成剧情导演。

## Result

本轮形成第一阶段 profile architecture spec。后续实现不应再比较 Leader Monolith 或 Writer self-serve Plot，除非真实使用反馈推翻当前工具矩阵。

