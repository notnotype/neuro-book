# Writer 置顶提示词与表单文案清理

## User Request

- 给 `writer` 增加「最高优先级置顶提示词」（对齐 `leader.default` 的 `customTopSystemPrompt`），插入在 Writer 系统提示词最前面，用户可放破限指令等长期置顶规则。
- 提示词优先级模型：系统提示词（置顶提示词插在最前）> 系统提示词其余部分 > AGENTS.md（AGENTS.md 只因系统提示词授权才可覆盖部分默认行为）。旧 description 声称「AGENTS.md 仍然更高」是错的，需要修正。
- 顺带清理 `enableKittenAdultStyle` 隐藏兼容字段，并优化 leader 和 writer 低代码表单的 description 和文案。

## Implementation

- `assets/workspace/.nbook/agent/profiles/builtin/writer.profile.tsx`
  - `SettingsSchema` 新增 `customTopSystemPrompt`（默认空），删除 `enableKittenAdultStyle` 与 `DEFAULT_ADULT_STYLE_PROMPT`；成人风格注入只看 `adultStylePrompt`，留空则完全不注入。
  - `buildWriterPrompt` 在 System 最前用 `<If>` 注入 `<custom_top_system_prompt>`，先于 `<writing_reference>`。
  - 表单全字段补 description；label 修正：`文风预设 -> 文风要求`、`字数控制 -> 默认字数`；成人风格 placeholder 不再声称「留空则不注入」之外的隐藏行为（隐藏 kitten 兜底已删除，文案现在是真的）。
- `assets/workspace/.nbook/agent/profiles/builtin/leader.default.profile.tsx`
  - `customTopSystemPrompt` 文案重写：label `最高优先级自定义提示词 -> 最高优先级置顶提示词`；description 去掉内部术语（leader.default、profile system prompt、AGENTS.md）并删除「AGENTS.md 仍然更高」的错误说法。
  - `NeuroBook 熟练度初值 -> NeuroBook 熟练度`（补字段 description）；radio 选项 `默认模式/保守模式 -> 默认/保守`。
- `server/low-code-form/index.ts`
  - `mergeSettings` 只保留 `defaults` 声明过的顶层 key。系统性修复：任何字段下线后，旧存档残留 key 不再触发 `additionalProperties` 校验失败（此前会导致运行时整份 settings 回退默认、保存接口 400）。
- 文档同步：`reference/agent/profile-guide.md`（示例 label、合并行为说明）、`docs/profile/writer.md`（settings 字段列表补齐至当前 8 个字段）。

## Key Decisions

- 字段名采用「最高优先级置顶提示词」：保留用户认知里的「最高优先级」，用「置顶」表达真实机制（位置在系统提示词最前）。
- 不为 `enableKittenAdultStyle` 做数据迁移：合并层过滤让残留 key 天然无害，旧配置用户丢失的只是隐藏 kitten 默认文案注入（该行为本就与表单文案矛盾）。

## Tests

- `server/low-code-form/low-code-form.test.ts`：新增「忽略 defaults 未声明的残留 key」用例。
- `server/agent/profiles/leader-assets-profile.test.ts`：
  - writer settings 用例补 `customTopSystemPrompt` 注入与置顶顺序断言（`trimStart().startsWith("<custom_top_system_prompt>")`、先于 `<writing_reference>`）。
  - 旧 `legacyAdultStyleResult` 用例改为 `retiredKeyResult`：断言下线字段残留不报错且不出现在解析值中。
  - `testWriterSettings()` 默认值补 `customTopSystemPrompt: ""`。

## Verification

- `bun test server/low-code-form/low-code-form.test.ts`：43 pass。
- `bun scripts/build/profile.ts compile builtin/writer.profile.tsx --system` 与 `compile builtin/leader.default.profile.tsx --system`：各写入 1 artifact。
- `bun scripts/build/prepare-system-assets.ts --sync-user-assets`：prepared 14 profiles，synced user assets updated profiles 2。
- `bun test ./server/agent/profiles/leader-assets-profile.test.ts`：14 pass（用 `./` 前缀避开 `product/` staged output 副本）。
