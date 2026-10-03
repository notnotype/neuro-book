# Round 139: Agent Tool Binding Implementation

## Scope

本轮完成 Slice 4 `Agent Tool Binding`。目标是把 Slice 3 已完成的 `ChapterWriterBriefService` 暴露给 Agent profile：director 可以直接调用 `get_chapter_writer_brief` 编译章节 writer brief，writer 仍不持有 Plot tools。

本轮实际补齐了 runtime tool、global registry、typed profile binding、system/user director profile exposure、writer isolation 断言、profile artifact 编译和当前 artifact 内容审计。

## Files Changed

- `server/agent/tools/plot-tools.ts`
  - 新增 `get_chapter_writer_brief` runtime tool。
  - 参数为 `{ projectPath, chapterPath }`。
  - 调用 `plotFacade.getChapterWriterBrief(projectPath, chapterPath)`。
  - `content[0].text` 返回 `suggestedBriefMarkdown`。
  - `details` 返回完整 `ChapterWriterBriefDto`。
  - 不读取、不写入 `plot.selection`。

- `server/agent/tools/index.ts`
  - 注册 `getChapterWriterBrief`。

- `server/agent/profiles/profile-tools.ts`
  - 新增 typed binding `builtin.plot.getChapterWriterBrief`。

- `assets/workspace/.nbook/agent/profiles/builtin/director.profile.tsx`
- `workspace/.nbook/agent/profiles/builtin/director.profile.tsx`
  - director toolset 增加 `builtin.plot.getChapterWriterBrief`。
  - prompt 增加 `get_chapter_writer_brief` 和 `suggestedBriefMarkdown` 使用说明。

- `server/agent/tools/plot-tools.test.ts`
  - 新增 tool adapter 测试：text/details contract 与 selection-free 行为。

- `server/agent/profiles/simulation-director-profiles.test.ts`
  - 新增 director toolset/prompt 断言。

- `server/agent/profiles/leader-assets-profile.test.ts`
  - 补齐 server 侧 writer isolation 断言，确保 writer 不包含 `get_plot_tree`、`get_chapter_plot`、`get_chapter_writer_brief`、`create_story_scene`。

- `assets/workspace/.nbook/agent/profiles/builtin/writer.profile.test.ts`
  - assets 侧也记录了 writer 不含 Plot/brief tools；该文件当前不在本次 Vitest include 范围内，最终证据以 server 侧 `leader-assets-profile.test.ts` 和 compiled artifact 为准。

## Verification

### Focused Agent Tool / Profile Tests

命令：

```powershell
bun vitest run server/agent/tools/plot-tools.test.ts server/agent/profiles/simulation-director-profiles.test.ts server/agent/profiles/leader-assets-profile.test.ts
```

结果：

- 3 test files passed。
- 22 tests passed。

### Builtin Tools Smoke

命令：

```powershell
bun vitest run server/agent/tools/builtin-tools-smoke.test.ts
```

结果：

- 1 test file passed。
- 2 tests passed。

### Profile Artifact Build / Check

命令：

```powershell
bun run system-assets:prepare
bun scripts/build/profile.ts compile --all
bun scripts/build/profile.ts status director
bun scripts/build/profile.ts status writer
bun scripts/build/profile.ts status director --system
bun scripts/build/profile.ts status writer --system
bun scripts/build/profile.ts check director
bun scripts/build/profile.ts check writer
```

结果：

- `system-assets:prepare`：prepared system profiles 14 profile(s)，compiled 14 stale profile(s)。
- `compile --all`：profile compile wrote 14 artifact(s)。
- user director loaded：`artifacts/71935aa4eaf6bc467178b23059bcc08e707edd526a7758734cc5fa25db44367a.mjs`。
- user writer loaded：`artifacts/d6e827c87766c5a9a3a24547fbbb8ad9be23329d48b140021bb80796bc8b1a96.mjs`。
- system director loaded：`artifacts/6853f7e4321130a6c469c757b4e19615eba1dc5a9a71d7231d34a945fc1a874a.mjs`。
- system writer loaded：`artifacts/1c77b1ffb2a5aaba77382ebee1ed3d4d43e10d3510abcb699c6864e9534f85ff.mjs`。
- `check director` passed。
- `check writer` passed。

### Current Artifact Content Audit

- user/system director artifact 均包含 `get_chapter_writer_brief` 和 `suggestedBriefMarkdown`。
- 当前 user/system director artifact 均未命中旧 `simulator_requests` / `Simulation gate`。
- user/system writer artifact 的 `rootToolKeys` 均为：

```json
["read","write","edit","bash","execute_world","report_result"]
```

- user/system director artifact 的 `rootToolKeys` 均包含：

```json
["read","create_agent","invoke_agent","get_agent","get_agent_profile","get_session","get_plot_tree","get_story_thread","get_story_scene_context","get_scene_world_context","get_chapter_plot","get_chapter_writer_brief","create_story_thread","update_story_thread","create_story_scene","update_story_scene","report_result"]
```

`get_agent_profile` 的实现已由既有测试证明会返回 profile `rootToolKeys`；本轮 director profile 和 compiled artifact 均证明 `get_chapter_writer_brief` 已在 toolKeys 中可发现。tool description 不由 `get_agent_profile` 返回，仍以 runtime tool definition 和 director prompt 为 Agent-facing 说明来源。

## Actual Result / Plan Delta

计划是完成 runtime tool、registry、typed binding、director exposure、writer isolation、discovery 和 compiled artifact 证据。实际结果符合计划。

与计划的出入：

- 没有新增真实 Agent 模型 smoke；本轮完成的是静态合同、tool adapter、profile source、compiled artifact 和 discovery path 的强证据。
- assets 侧 writer profile test 虽已补断言，但本轮 Vitest include 没有执行该文件；因此 server 侧 `leader-assets-profile.test.ts` 的 writer isolation 和 compiled writer artifact 是主要证据。

## Remaining Work

Task 78 的四个实现切片已经完成：Profile Contract Cleanup、OpenAPI Explicit Path、Chapter Writer Brief Module、Agent Tool Binding。

剩余不是新的代码切片，而是验证层级差异：

1. 真实 Agent 模型行为尚未 smoke，不能声称模型在真实会话中一定会主动选择最优 profile 路由。
2. ChapterOverride 不属于 Task 78 已实现能力，后续继续在 Task 80 扩展 POV、tone、信息控制、章节收尾等 writer-facing 指令。
