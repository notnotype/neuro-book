# Global Profile Home Resource Preset

> Active task directory format: `NN-kebab-case-name/`. Archived tasks move to `docs/tasks/archived/<task-slug>/`.

## Relative documents refs

- [Agent Profile Settings Low-Code](../58-agent-profile-settings-low-code/README.md)
- [Agent Profile Home](../60-agent-profile-home/README.md)
- [Workspace Terms](../../../reference/workspace/TERMS.md)
- [Profile Routing](../../../reference/agent/profile-routing.md)
- [Writer profile doc](../../profile/writer.md)

## User Request / Topic

- `WriterSettingsForm` / `LeaderDefaultSettingsForm` 这类低代码 profile settings 已经能在 Project scope 中编辑 resource-preset，但 Global scope 下 resource-preset 仍是禁用的。
- Global Config 与 Project Config 的真实目标是：全局配置作为用户个人默认库，Project 配置和 Project 资源作为可打包分享的项目依赖。
- Config patch 本身容易做 Global -> Project 覆盖；难点是 Markdown resource 文件如何处理全局库、项目覆盖和项目分享。
- 本任务同时处理几个配置/UI收敛问题：
  - Project 默认模型、Project Embedding 覆盖、Agent Web 工具这三个 Project 配置入口先从 Project 设置中移除。
  - `LowCodeResourcePresetField.vue` 内部资源编辑 textarea 的 focus 样式与通用低代码 textarea 不一致，需要统一。
  - 低代码表单需要更好地展示 option-level `description`，例如 Leader 提问策略的三个选项需要解释。
  - `LowCodeResourcePresetField` 需要按 Global/Profile Home 与 Project 可分享需求升级。

## Goal

实现 Global Profile Home + resource-preset，使 Workspace Root `.nbook` 可以维护全局 profile 资源库，Global profile settings 能选择、创建、编辑、重命名和删除资源；Project profile settings 仍以 Project Profile Home 作为可分享依赖边界，避免 Project Config 显式依赖只存在于全局的资源。

成功标准：

- Global Config 的 Agent Profile 预设区域能完整编辑 `resource-preset` 字段，例如 writer 文风/参考和 leader 人设。
- Global Profile Home 位于 Workspace Root `.nbook` 下，作为用户个人默认资源库；Project Profile Home 仍位于 Project Workspace 内，作为可打包分享的项目依赖。
- Project scope 下如果用户要把全局资源变成项目配置依赖，必须能显式“复制到项目并选中”；保存 Project 覆盖时不允许留下 global-only resource key。
- Project 设置页不再显示 Project 默认模型、Project Embedding 覆盖、Agent Web 工具入口。
- 低代码 option description 能在需要时显示；ResourcePreset 内部 textarea 样式与通用低代码 textarea 对齐。

## Current State

- `profileHomeResource()` 当前在 `ctx.scope !== "project"` 时返回禁用 DTO；Global scope 下没有 resource list/read/update/remove 能力。
- `saveGlobalConfig()` 当前通过 `assertNoGlobalResourceMutations()` 明确拒绝 Global resource mutations。
- `lowCodeFormContext()` 只有 Project scope 会创建 profile home；Global scope 不传 `ctx.home`。
- Project Profile Home 根目录当前是 `Project Workspace/agents/{profileKey}`；这符合 Project 可分享目标，因为它位于 Project Workspace 内。
- Workspace Terms 已定义 Workspace Root `.nbook` 保存 Global Config、用户 assets、全局 Agent 资源覆盖层和后续全局运行状态。
- `LowCodeFieldShell` 已展示 field-level `description`；`LowCodeSelectField` 会把 option description 传给 `FormSelect`；`LowCodeRadioField` 仍使用紧凑 `SegmentedControl`，不会展示 option description。
- `NovelIdeSettingsDialog.vue` 当前 Project Config sections 包含 `models`、`embedding`、`web-tools`、`agent-profile-models`。
- `NovelIdeWebSettingsPanel.vue` 实际只读写 Global `web`，但当前可从 Project Config 设置入口进入。

## Decisions / Discussion

- **Global Profile Home 是个人默认库**：放在 Workspace Root `.nbook` 下，推荐路径为 `workspace/.nbook/agents/{profileKey}/`。它不随单个 Project 分享。
- **Project Profile Home 是项目依赖包**：继续放在 Project Workspace 内的 `agents/{profileKey}/`，随 Project 下载/上传/打包移动。
- **Project 显式配置必须可分享**：Project Config 中保存的 resource-preset key 必须能在 Project Profile Home 中解析。若用户选择来自 Global Profile Home 的资源，需要先复制到 Project。
- **继承全局配置不等于项目依赖**：Project 没有显式覆盖时，可以继续继承本机 Global settings；这只是本机默认体验，不承诺打包后复现。
- **本任务先不做打包器自动固化**：先在设置 UI 和服务端校验层避免新的 Project 显式 global-only resource 依赖。后续可在 Project 下载前做依赖审计/一键固化。
- **Project 设置入口收敛**：本轮从 Project scope 隐藏 `models`、`embedding`、`web-tools` 三个 section；保留 Global scope 对这些配置的管理。
- **用户确认的本轮决策**：
  - Global Profile Home 使用 `workspace/.nbook/agents/{profileKey}/`。
  - Project Profile Home 使用 `workspace/{project}/agents/{profileKey}/`。
  - Project 同 key resource 覆盖 Global 同 key resource。
  - Project scope 展示 Global resource，但标记“全局，只读”，并提供“复制到项目并选中”。
  - 禁止删除当前选中的 Global / Project resource；本轮不追踪“被哪些 Project 继承使用”。
  - 本任务不做打包前自动复制全局资源；打包依赖审计 / 固化留后续任务。

## Proposed Architecture

### Profile Home Scope

- 扩展 profile home helper，支持两种 home root：
  - Global：`Workspace Root .nbook/agents/{profileKey}`。
  - Project：`Project Workspace/agents/{profileKey}`。
- 新增或调整 helper：
  - `resolveGlobalRootForProfileHome(workspaceRoot?)`
  - `ensureGlobalProfileHome({workspaceRoot, profileKey, profileVersion, definition})`
  - `ensureProjectProfileHome(...)` 或保留现有 `ensureProfileHome()` 作为 Project alias。
- `ProfileHomeContext` 增加 `scope: "global" | "project"`，让 profile home 初始化逻辑必要时能区分全局/项目；现有 profile 可忽略该字段。
- 运行时 Project session 仍向 profile 提供 Project home。Global settings 引用的 resource 若要在 Project 运行中读取，必须通过下面的 layered read 或 settings 校验策略处理。

### Resource Preset Scope

- `profileHomeResource()` 不再用 `ctx.scope !== "project"` 禁用能力，而是以 `ctx.home` 是否存在决定 resource 能力。
- Global scope 的 `resolveLowCodeForm()` 应能列出 global home 中的资源，并允许 create/update/rename/remove mutations。
- Project scope 的 resource-preset DTO 需要携带资源来源信息：
  - `origin: "project" | "global"`。
  - Project-origin 可编辑/可删除。
  - Global-origin 在 Project scope 下只读，不可直接改名/删除。
- Project scope 下 `list/read` 可以展示 Global inherited resource，方便用户理解当前继承值；但保存 Project 显式覆盖时，selected key 必须是 Project-origin。
- 新增“复制到项目并选中”操作：
  - 当当前 selected/inherited resource 是 Global-origin，用户点击后创建 Project resource mutation。
  - 新资源默认保持同 label/content，slug 冲突时自动加后缀。
  - 复制完成后 Project settings value 改为 Project-origin key。

### Config Save Flow

- `saveGlobalConfig()`：
  - 移除 `assertNoGlobalResourceMutations()` 对 Global mutations 的拒绝。
  - 保存 settings 前按 Global home 执行 resource mutations。
  - 用 mutation final key view 校验 Global selected key。
- `saveProjectConfig()`：
  - 继续只把 resource mutations 写入 Project home。
  - 增加校验：Project settings patch 中显式保存的 resource-preset key 必须存在于 Project home 或本轮 Project mutations final keys。
  - 如果 Project patch 试图保存 global-only key，返回 400，并提示“请先复制资源到项目”。
- `buildConfigAgentProfileSettingsDto()`：
  - Global scope 完整模式返回 Global resource form/content/mutations capability。
  - Project scope 完整模式返回 Project resource + inherited/global readonly resource 信息，用于 UI 展示和复制。

### Frontend / Low-Code Form

- `NovelIdeAgentProfileModelSettingsPanel.vue`：
  - Global scope 也请求 `includeAgentProfileSettings: true`，使 Writer/Leader 的 resource-preset 可在全局配置中编辑。
  - Global scope 下显示 profile settings 区域，不再只在 Project scope 显示。
  - Project scope 下 ResourcePreset 支持显示资源来源和“复制到项目”。
- `LowCodeResourcePresetField.vue` 升级：
  - option 列表显示来源 badge：项目 / 全局。
  - Project scope 下 Global-origin 资源只读，显示“复制到项目并选中”按钮。
  - 内部 textarea 改为复用 `FormTextarea` 或至少使用 `FormTextarea` 相同 focus/ring class：`focus:border-[var(--accent-main)] focus:ring-1 focus:ring-[var(--accent-main)]/20`。
  - 管理按钮文案根据 scope 区分“管理全局资源” / “管理项目资源”。
  - 删除保护继续保留：不能删除当前选中资源。
- option description：
  - `LowCodeRadioField` 若任一 option 有 description，改用卡片式单选列表，展示 label + description；无 description 时继续用紧凑 segmented control。
  - `LowCodeCheckboxField` 和 `LowCodeComboboxField` 审查并补齐 option description 展示，确保 DTO 中的 description 不丢失。
- `LeaderDefaultSettingsForm` 的提问策略/协作模式等 option description 应在 UI 中可见。

### Project Settings Cleanup

- `NovelIdeSettingsDialog.vue`：
  - `projectConfigSections` 从 `["models", "embedding", "web-tools", "agent-profile-models"]` 收敛为 `["agent-profile-models"]`，或后续产品需要时再加入真正项目级配置。
  - Project scope 不再进入 `NovelIdeModelSettingsPanel`、`NovelIdeEmbeddingSettingsPanel`、`NovelIdeWebSettingsPanel`。
- `NovelIdeModelSettingsPanel.vue` / `NovelIdeEmbeddingSettingsPanel.vue`：
  - 删除或保留但不再暴露 Project scope 代码路径；若删除，注意同步类型和 i18n 文案。
- `NovelIdeWebSettingsPanel.vue`：
  - 保持 Global-only，不再接受 Project 设置入口。
- 后端 normalizer/DTO 暂时保留对旧 Project `models.default`、`embedding` 字段的读取兼容，不在本任务中强制迁移用户旧 config；UI 不再生成这些字段。

## Implementation Plan

### Phase 1 - Scope Model and Tests

- 在 `profile-home.ts` 中引入 Global/Profile Home scope 概念。
- 为 Global home 增加 focused tests：
  - Global home root 位于 Workspace Root `.nbook/agents/{profileKey}`。
  - `init/upgrade/reset` 可以用于 Global scope。
  - Global 与 Project 同 profile 同 key 资源互不覆盖。

### Phase 2 - Resource Preset Runtime

- 修改 `profileHomeResource()`：
  - Global scope 有 `ctx.home` 时启用 list/read/create/update/rename/remove。
  - Project scope 支持 Project-origin 与 Global-origin 的展示语义。
- 扩展 `LowCodeResourcePresetDto` / option DTO，增加 `origin` 或等价字段；保持旧客户端未读取该字段时不破坏。
- 增加 low-code-form tests：
  - Global scope resource-preset 能列出、创建、编辑、重命名、删除。
  - Project scope 显式保存 global-only key 被拒绝。
  - Project mutation 新建后 selected key 可通过校验。

### Phase 3 - Config Service Integration

- `lowCodeFormContext()` 在 Global scope 下创建 Global Profile Home。
- `saveGlobalConfig()` 支持 resource mutations，并在写 config 前应用到 Global home。
- `saveProjectConfig()` 保持 Project-only mutations，并增加 global-only selected key 拒绝逻辑。
- `readConfigEditorSnapshot()` 完整 settings 模式下为 Global 和 Project 分别返回正确 resource DTO。
- 调整或新增 `config-service.test.ts`：
  - Global 保存 Writer resource-preset settings + resource mutations。
  - Project 继承 Global settings 时 UI 能看到 inherited resource。
  - Project 显式 override global-only resource 被拒绝。
  - Project “复制到项目” mutation 后保存通过。

### Phase 4 - Low-Code UI Upgrade

- `LowCodeResourcePresetField.vue`：
  - 来源 badge、只读 global resource、复制到项目操作。
  - textarea 样式统一到 `FormTextarea`。
  - 文案统一使用 i18n。
- `LowCodeRadioField.vue`：
  - 支持 option description 卡片显示。
  - 保留无 description 的 segmented 视觉。
- 审查 `LowCodeCheckboxField.vue` / `LowCodeComboboxField.vue` / `FormSelect.vue` 对 option description 的显示。

### Phase 5 - Settings UI Cleanup

- Project settings sidebar 移除 `models`、`embedding`、`web-tools`。
- Global settings 仍保留 Models、Embedding、Cost、Web Tools、Agent Profile 模型/预设。
- Agent Profile 模型/预设面板在 Global scope 下也显示 LowCodeForm。
- 清理无用 Project-scope save payload 和 i18n 文案，或明确注释保留为旧 config 读取兼容。

### Phase 6 - Docs and Product Notes

- 更新本任务 walkthrough。
- 更新 `PROJECT-STATUS.md`，记录 Global Profile Home 与 Project 可分享资源边界。
- 如公共文档有 profile settings/resource-preset 说明，补充：
  - Global 是个人库。
  - Project 是分享依赖。
  - 需要固定文风/人设时复制资源到项目。

## Verification / Test

计划执行：

- `bun test server/agent/profiles/profile-home.test.ts`
- `bun test server/low-code-form/low-code-form.test.ts`
- `bun test server/config/config-service.test.ts -t "Agent Profile settings"`
- `bun test server/agent/profiles/leader-assets-profile.test.ts -t "leader.default settings|writer settings"`
- `bun run typecheck`

已知注意：

- 当前全仓 `bun run typecheck` 可能仍命中既有 `server/agent/tools/control-tools.test.ts` 类型债务。若未在本任务中处理该文件，最终报告需要明确区分。
- 不自动做浏览器验证；实现后建议用户指定是否进行设置页浏览器验收。

## Implementation Walkthrough

- 2026-06-26：创建任务。用户确认任务目标是 Global Profile Home + resource-preset，并说明 Global Config / Project Config 的核心目的在于 Project 可打包分享。
- 2026-06-26：只读调研确认：
  - Global scope resource-preset 当前被禁用。
  - Global Config 当前拒绝 resource mutations。
  - Project 设置页当前仍暴露 Models / Embedding / Web Tools。
  - 低代码 field description 已支持，但 radio option description 未展示。
  - ResourcePreset 内部 textarea 样式未复用通用 textarea focus 样式。
- 2026-06-26：实现 Global Profile Home 与 resource-preset 后端接线：
  - `profile-home.ts` 增加 `global/project` scope、Global home root、Global ensure/reset helper，以及 Project 优先 / Global 兜底读取的 layered home facade。
  - 低代码 DTO 为 resource option/content 增加 `origin: "global" | "project"`。
  - `resolveLowCodeForm()` 在 Global scope 有 home 时启用 resource-preset；Project scope 合并 Project 与 Global resource，Project 同 key 覆盖 Global，同步返回只读来源信息。
  - `saveGlobalConfig()` 支持 Global resource mutations；`saveProjectConfig()` 保持 Project-only mutations，并拒绝 Project 显式保存 global-only resource key。
  - Agent runtime / profile preview 在解析 resource-preset settings 时带上 profile home，Project session 读取 Project 优先、Global 兜底。
- 2026-06-26：实现前端低代码与设置入口升级：
  - Global Agent Profile 设置也请求并展示 LowCodeForm。
  - `LowCodeResourcePresetField` 显示资源来源 badge；Project scope 下 Global resource 只读，并支持“复制到项目并选中”。
  - ResourcePreset 内部 textarea focus 样式统一为低代码 textarea 的 accent focus/ring。
  - `LowCodeRadioField` 在 option 有 description 时切换为卡片式单选，展示选项说明；无 description 时继续使用紧凑 segmented control。
  - Project 设置侧栏移除 Models / Embedding / Web Tools，仅保留 Agent Profile 设置入口；后端旧字段读取兼容保留。
- 2026-06-26：补充测试：
  - `profile-home.test.ts` 覆盖 Global home root 与 layered home 读取。
  - `low-code-form.test.ts` 覆盖 Global resource-preset、Project 展示 Global 只读资源、`allowGlobalResourceKeys` 校验语义。
  - `config-service.test.ts` 覆盖 Global resource mutations、Project global-only key 拒绝、复制到项目后保存通过。
- 2026-06-26：验证：
  - `bun test server/agent/profiles/profile-home.test.ts server/low-code-form/low-code-form.test.ts server/config/config-service.test.ts -t "profile home|low-code form|Agent Profile settings|resource"` 通过。Bun 同时发现并运行了 `product/server/...` 中的旧打包副本同名测试，全部通过。
  - `bun test server/agent/profiles/leader-assets-profile.test.ts -t "leader.default settings|writer settings"` 通过。
  - `bun run typecheck` 仍失败在既有 `server/agent/tools/builtin-tools-smoke.test.ts` 的 `bun:test` types，以及 `server/agent/tools/control-tools.test.ts` 的异步表单 / 消息内容类型债务；过滤本任务相关文件名无输出。
- 2026-06-26：completion audit 补充：
  - 修复 `LowCodeResourcePresetField.vue` 中 `||` 与 `??` 混用导致 Vue SFC 编译失败的问题，并将“复制到项目”改为严格复制当前 Global resource 内容，避免空内容被模板替换。
  - Project 显式 resource key 校验改为按低代码点路径读取 settings，和低代码表单读写语义保持一致。
  - 使用源码绝对路径复验：
    - `bun test "$root/server/agent/profiles/profile-home.test.ts" "$root/server/low-code-form/low-code-form.test.ts" "$root/server/config/config-service.test.ts" -t "profile home|low-code form|Agent Profile settings|resource"` 通过，41 pass。
    - `bun test "$root/server/agent/profiles/leader-assets-profile.test.ts" -t "leader.default settings|writer settings"` 通过，3 pass。
  - `@vue/compiler-sfc` 直接解析 `LowCodeResourcePresetField.vue`、`LowCodeRadioField.vue`、`LowCodeForm.vue`、`NovelIdeAgentProfileModelSettingsPanel.vue`、`NovelIdeSettingsDialog.vue` 通过。
  - `bun run typecheck` 仍只失败在既有 `server/agent/tools/builtin-tools-smoke.test.ts` / `server/agent/tools/control-tools.test.ts` 类型债务；过滤本任务相关文件名无输出。
- 2026-06-26：review fix：
  - Project Agent Profile low-code settings 恢复为显式覆盖语义：Project 草稿只保存 `projectPatch`，未覆盖字段只显示继承值，Project reset 会清空显式 settings patch，不再因为 Global resource-preset 继承值而阻塞无关 Project 保存。
  - Resource mutation final key view 同时供 low-code `resource-preset` 校验与 Project-only resource key 校验使用，修复无 `validateKey` 的自定义 resolver 在“新建并选中”时误报资源不存在的问题。
  - `LowCodeResourcePresetField` 在 disabled 状态下增加函数级 guard，避免管理抽屉绕过只读态切换选中资源或提交 mutation。
  - 新增 `config-service.test.ts` 用例覆盖无 `validateKey` resolver 的 mutation final key 保存路径。
  - 验证：
    - `bun test "$root/server/config/config-service.test.ts" -t "Project 保存按 resource mutations 最终 key 校验没有 validateKey|Project 显式保存 global-only|Project 复制 global resource"` 通过，3 pass。
    - `bun test "$root/server/config/config-service.test.ts" "$root/server/low-code-form/low-code-form.test.ts" -t "Agent Profile settings|resource"` 通过，25 pass。
    - `@vue/compiler-sfc` 直接解析 `LowCodeResourcePresetField.vue`、`NovelIdeAgentProfileModelSettingsPanel.vue` 通过。
    - `bun run typecheck 2>&1 | rg "NovelIdeAgentProfileModelSettingsPanel|LowCodeResourcePresetField|config-service\\.ts|low-code-form/index\\.ts|config-service\\.test"` 无输出。

## TODO / Follow-ups

- 后续可以在 Project 下载/打包流程中增加 profile resource 依赖审计，发现 Project 未固化的全局资源依赖时提示或一键复制。
- 后续可以考虑更通用的 resource overlay UI，例如 diff Global 与 Project 同名资源。
- 后续可补浏览器验收，覆盖 Global Agent Profile settings 的 resource 新建/编辑/删除、Project 复制全局资源、Project 设置入口收敛。
