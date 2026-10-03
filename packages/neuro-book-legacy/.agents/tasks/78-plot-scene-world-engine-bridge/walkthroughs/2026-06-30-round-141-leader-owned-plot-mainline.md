# Round 141 Leader-Owned Plot Mainline

## Goal

按用户新决策调整普通写作主链：先把 `director` 从主链拿掉，由 `leader.default` 直接负责剧情设计、World Engine 推进、Plot / Scene 更新、writer brief 编译和 writer 调度。

目标流程：

```text
剧情初步设计 -> 推进 World Engine -> 剧情设计 -> 更新 Plot -> 调用 writer
```

## Changes

- `assets/workspace/.nbook/agent/profiles/builtin/leader.default.profile.tsx`
  - `leader.default` 新增 Plot 全套读写和 brief 工具：
    - `get_plot_tree`
    - `get_story_thread`
    - `get_story_scene_context`
    - `get_scene_world_context`
    - `get_chapter_plot`
    - `get_chapter_writer_brief`
    - `create_story_thread`
    - `update_story_thread`
    - `create_story_scene`
    - `update_story_scene`
  - System prompt 新增 `Plot / Scene（剧情结构）` 段，明确普通写作主链由 leader 直接负责。
  - World Engine 段删除“leader 不直接持有 Plot write tools / 创建或复用 director”的普通主链说法。
  - HistorySet 增加 `reference/plot/system.md` 与 `reference/plot/agent-spec.md`，让 leader 直接使用 Plot tools 时能看到 Scene / World Anchor 规则。
- `workspace/.nbook/agent/profiles/builtin/leader.default.profile.tsx`
  - 同步 system profile 改动，避免 active user profile 覆盖导致运行时仍加载旧主链。
- `reference/agent/leader-default.md`
  - Writer collaboration 和 Writing Mode World State 改为 leader 直接更新 Plot 并调用 `get_chapter_writer_brief`。
- `server/agent/profiles/leader-assets-profile.test.ts`
  - 更新 `leader.default.rootToolKeys` 断言，要求包含 Plot 全套读写和 brief 工具。
  - 删除 leader 不含 `get_plot_tree` / `create_story_scene` 的旧断言。
  - 新增普通写作主链文案断言，删除“创建或复用 director / director 返回 world_engine_requests”的旧主链断言。
- `PROJECT-STATUS.md` 与本任务 README
  - 当前状态改为 Leader-owned Plot / Scene 主链。
  - 历史 Round 记录保留为当时设计过程，不重写。

## Actual Result vs Plan

与计划一致：

- `leader.default` 已开放全套 Plot 读写和 `get_chapter_writer_brief`。
- `director` profile、schema、tool binding 未删除、未重构。
- `writer` 仍无 Plot tools，只消费 message 中的 Scene / World Context brief。
- system profile 与 active user profile 都已同步。

计划外但必要：

- `leader.default` HistorySet 增加了 Plot reference 导入。原因是 leader 现在直接持有 Plot tools，如果不注入 `reference/plot/system.md` 和 `reference/plot/agent-spec.md`，会出现“有工具但缺少 Scene / World Anchor 写法”的提示词缺口。
- 更新了 `PROJECT-STATUS.md` 和 Task README 当前状态，避免仓库级状态继续描述为 Director + Brief Compiler 主链。

## Verification

已执行：

- `bun scripts/build/profile.ts compile builtin/leader.default.profile.tsx --system`
  - 刷新 system artifact：`assets/workspace/.nbook/agent/profiles/.compiled/artifacts/55c64865fedf728f4bbf3af3e6068b07ddc6de1b1ef8b9b9fba7166ad1d41e90.mjs`
- `bun scripts/build/profile.ts compile builtin/leader.default.profile.tsx`
  - 刷新 active user artifact：`workspace/.nbook/agent/profiles/.compiled/artifacts/281de5c53b6783ecc40b03bcc77e7b8ff694799f02b8e9d6d89b143088620294.mjs`
- `bunx vitest run server/agent/profiles/leader-assets-profile.test.ts server/agent/profiles/simulation-director-profiles.test.ts assets/workspace/.nbook/agent/profiles/builtin/writer.profile.test.ts --reporter=dot`
  - 结果：2 个测试文件、17 个测试通过。
  - 注意：命令包含 writer profile 测试路径，但 Vitest 本轮实际收集结果显示为 2 个测试文件。
- 对 system/user 两份 compiled artifact 静态搜索：
  - 已确认包含 `get_chapter_writer_brief`、`create_story_scene`。
  - 已确认包含新主链文案：`剧情初步设计 -> 推进 World Engine -> 剧情设计 -> 更新 Plot -> 调用 writer`。
  - 未在两份 leader artifact 中命中旧普通写作转 director 规则：`Thread / Scene / Chapter Plot / writer brief 编译转 \`director\``、`创建或复用 \`director\``、`director 返回 world_engine_requests`。

补充修正：

- 聚焦测试暴露 `reference/agent/profile-routing.md` 仍把 `leader.default` 描述为不适合直接使用 Plot write tools，并要求 Thread / Scene / Chapter Plot / writer brief 编译转 `director`。
- 已同步更新 `profile-routing.md`：普通写作主链由 `leader.default` 直接处理；`director` 保留为高级或手动剧情导演 profile，不再是普通写作必经节点。
