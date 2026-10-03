# Writer Profile Custom Settings

## User Request

- 给 builtin `writer` profile 增加可视化 settings 表单字段：
  - `paragraph_rhythm` 用户可自定义，默认偏网络小说短段分行。
  - 字数控制提取为用户设置，默认 `2000-2600 字`，表单使用 text input。
  - `polishing_workflow` 用户可自定义，默认只提示使用 `.nbook/agent/skills/stop-slop/SKILL.md`。
  - `ENABLE_KITTEN_ADULT_STYLE` 改为用户可开关设置。

## Implementation

- `assets/workspace/.nbook/agent/profiles/builtin/writer.profile.tsx`
  - `SettingsSchema` 新增 `paragraphRhythm`、`wordCountControl`、`polishingWorkflow`、`adultStylePrompt`。
  - `WriterSettingsForm` 新增 textarea/text 字段，并保留隐藏旧字段兼容已保存 settings。
  - prompt 新增 `<word_count_control>`，并用 settings 渲染 `<paragraph_rhythm>` 与 `<polishing_workflow>`。
  - 成人风格注入改为读取 `ctx.settings.adultStylePrompt`；旧 `enableKittenAdultStyle` 仅作为隐藏兼容字段。
  - hard rules 补充本轮 message 明确约束优先于 profile settings。
- `server/agent/profiles/leader-assets-profile.test.ts`
  - 手工 prepare 的默认 writer settings 补齐新增字段。
  - writer settings 测试覆盖段落节奏、字数控制、润色工作流和成人风格开关。
  - stop-slop 断言改为检查默认 workflow 提到 skill 路径，不再期待全文导入。

## Verification

- `bun test server/agent/profiles/leader-assets-profile.test.ts -t "writer settings|writer payload|writer 无 payload"`：8 pass。
- `bun scripts/build/profile.ts check builtin/writer.profile.tsx --system`：首次通过并提示 `compile_stale`，编译同步后复跑通过。
- `bun scripts/build/profile.ts compile builtin/writer.profile.tsx --system`：写入 `.compiled/builtin__writer.mjs` 和 `.compiled/builtin__writer.types.d.ts`。
- `bun scripts/build/prepare-system-assets.ts --sync-user-assets`：通过；prepared system profiles 14，synced user assets updated profiles 1。

## Plan Differences

- 实现与计划一致。
- 额外补了一条通用优先级规则：本轮 message 明确指定段落、字数、人称、润色流程或风格约束时，优先于 profile settings。
- 代码审查后将默认 stop-slop 路径从系统 assets 源码路径改为 Workspace Root 可读的 `.nbook/agent/skills/stop-slop/SKILL.md`。
- 未更新 `PROJECT-STATUS.md`，因为本轮是 writer settings 的局部后续调节，没有改变长期模块状态或新增长期 TODO。

## Follow-up: Text Inputs and Collapsed UI

- 2026-06-27 追加调节：
  - `polishingWorkflow` 低代码字段从 `textarea` 改为 `text`。
  - 成人风格从 `enableKittenAdultStyle` switch 改为 `adultStylePrompt` text；留空不注入，填写后注入 `<adult_style>`。
  - `enableKittenAdultStyle` 保留为隐藏 optional 字段，兼容已经保存旧开关为 true 的配置；这种旧配置会继续注入原默认成人风格文本。
  - `NovelIdeAgentProfileModelSettingsPanel.vue` 的 profile 自定义低代码设置默认收起，点击标题行展开。
  - 代码审查后恢复 writer prompt 原有 `<avoid_words>` 块，避免 settings 改造意外移除既有文风禁用约束。
  - 修复后复跑 focused 测试、profile check、profile compile 和 system assets sync，均通过。
