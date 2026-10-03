# Round 85: Plot Selection Side Effect Contract

## Scope

本轮检查 `plot.selection` 对 `get_chapter_writer_brief` 的影响。结论是：brief tool 必须是 selection-free read adapter，不读也不写 `plot.selection`。

## Current Evidence

- `server/agent/session/custom-state-keys.ts`
  - `PLOT_SELECTION_STATE_KEY = "plot.selection"`。
- `server/agent/tools/plot-tools.ts`
  - `get_story_thread` 读取 thread 后写 selection。
  - `get_story_scene_context` 读取 scene 后写 selection。
  - `get_scene_world_context` 读取 Scene World Context 后写 selection。
  - `create_story_thread` / `update_story_thread` / `create_story_scene` / `update_story_scene` 都写 selection。
  - `get_chapter_plot` 是少数不写 selection 的章节读取工具。
  - `resolveThreadId()` / `resolveSceneId()` 允许参数缺省时使用 selection。
- `server/agent/tools/plot-tools.test.ts`
  - 已覆盖跨 Project 复用 selection 会报错。
  - 已覆盖 `get_scene_world_context` 返回上下文后会写 `plot.selection`。

## Interface Problem

`plot.selection` 是交互式 Plot 操作的 convenience state，不适合作为 writer brief 的隐式输入。brief 的目标是将 Chapter scenes、Scene World Context、warnings 和 `suggestedBriefMarkdown` 聚合成可交给 writer 的材料；它必须可重复、可审计、可通过 `{projectPath, chapterPath}` 单独重放。

如果 `get_chapter_writer_brief` 读取 selection：

- 相同参数可能因 session state 不同而返回不同结果。
- Director 在多 Project 或多章切换时更容易被旧 selection 污染。
- 测试需要搭建 session custom state 才能覆盖业务规则。

如果 `get_chapter_writer_brief` 写 selection：

- 只读 brief 查询会意外改变后续 `update_story_scene` / `get_scene_world_context` 的默认目标。
- “读取 brief” 会变成有状态操作，降低 Interface Depth。

## Target Contract

`get_chapter_writer_brief` 的 Agent tool contract：

- 输入必须显式包含 `projectPath`。
- 输入必须显式包含 `chapterPath`。
- 不接受 `threadId` / `sceneId` 作为默认目标。
- 不读取 `plot.selection`。
- 不写 `plot.selection`。
- 错误信息只围绕 `{projectPath, chapterPath}` 和 Plot/World Context 状态，不提“先读取/创建 Scene 建立 selection”。

## Acceptance

后续 `server/agent/tools/plot-tools.test.ts` 应增加：

- 调用 `get_chapter_writer_brief` 时，即使 session custom state 有其它 Project 的 `plot.selection`，也不读取它。
- 调用后 `appendCustomState` 没有收到 `PLOT_SELECTION_STATE_KEY`。
- tool parameters 只接受 `{projectPath, chapterPath}`。
- details 是 `ChapterWriterBriefDto`，不包含 selection state。

## Benefits

- **Leverage**：director 可以在任意 session state 下稳定生成同一章节 brief。
- **Locality**：selection 逻辑继续局限于交互式 Plot tools，brief 状态聚合局限于 `ChapterWriterBriefService`。
- **Deletion test**：如果取消 selection-free contract，复杂度会回流到每次 director 调用和每个测试 fixture。

## Conclusion

brief tool 的正确形态是 stateless read adapter。`plot.selection` 仍适合 Thread/Scene 编辑工具，但不应进入 writer brief Module。

