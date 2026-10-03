# Round 93: Brief Tool Binding Stack

## Scope

本轮复查 `get_chapter_writer_brief` 后续作为 Agent tool 时需要接入的真实绑定层。没有修改业务代码。

## Evidence

- `server/agent/tools/plot-tools.ts` 是 Plot tools 的 runtime 定义入口；现有 `get_scene_world_context` / `get_chapter_plot` 都在 `createPlotTools()` 中定义。
- `server/agent/tools/index.ts` 会调用 `createPlotTools()`，再用 `requireDefinition(plotTools, "...")` 映射为全局内置工具 definition。新 tool 如果只加在 `plot-tools.ts`，但不加在这里，`createBuiltinTools()` 不会暴露它。
- `server/agent/profiles/profile-tools.ts` 的 `builtin.plot` 是 profile 作者可用的 typed binding 列表。新 tool 如果不加在这里，builtin profile 不能用 `builtin.plot.xxx` 声明它。
- `assets/workspace/.nbook/agent/profiles/builtin/director.profile.tsx` 当前显式 `toolset(...)`：
  - 已包含 `get_plot_tree/get_story_thread/get_story_scene_context/get_scene_world_context/get_chapter_plot`；
  - 还没有 `get_chapter_writer_brief`；
  - profile 的 `rootToolKeys` 来自这个 toolset。

## Binding Contract

`get_chapter_writer_brief` 的 Agent 可用性不是一个文件补丁，至少需要四层同时成立：

1. `server/agent/tools/plot-tools.ts`
   - 定义 tool key、description、TypeBox parameters、execute adapter。
2. `server/agent/tools/index.ts`
   - 从 `createPlotTools()` 中取出 definition，并纳入 `createBuiltinTools()`。
3. `server/agent/profiles/profile-tools.ts`
   - 在 `builtin.plot` 中增加 typed binding，例如 `getChapterWriterBrief: registeredTool("get_chapter_writer_brief")`。
4. `assets/workspace/.nbook/agent/profiles/builtin/director.profile.tsx`
   - director `toolset(...)` 显式加入该 binding。

之后还要通过 profile compile/sync 进入 system/user compiled artifact。

## Test Implication

Slice 4 `Agent Tool Binding` 的测试需要分层证明：

- `createPlotTools().map(t => t.key)` 包含 `get_chapter_writer_brief`。
- `createBuiltinTools().map(t => t.key)` 包含 `get_chapter_writer_brief`。
- `directorProfile.rootToolKeys` 包含 `get_chapter_writer_brief`。
- `get_agent_profile({profileKey:"director"})` 返回的 `toolKeys` 包含该 key。
- compiled director artifact 中也能搜到该 key。

## Conclusion

单独实现 service 或 HTTP route 不等于 Agent 可用。brief tool 必须穿过 runtime registry、global builtin tools、profile typed binding、director profile toolset、compiled artifact 五个证明面。
