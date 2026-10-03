# Agent Profile Settings Low-Code

> Active task directory format: `NN-kebab-case-name/`. Archived tasks move to `docs/tasks/archived/<task-slug>/`.

## Relative documents refs

- [TSX Profile Workbench](../04-tsx-profile-workbench/README.md)
- [Writer Profile Input Contract](../08-writer-profile-input-contract/README.md)
- [Agent Variable System Refactor](../10-agent-variable-system/README.md)
- [Profile Variable Types](../12-profile-variable-types/README.md)
- [Agent Initial/Payload Schema](../53-agent-initial-payload-schema/README.md)
- [Writer Payload Context Tools](../54-writer-payload-context-injection/README.md)
- [Agent Profile Guide](../../../reference/agent/profile-guide.md)
- [Profile Routing](../../../reference/agent/profile-routing.md)
- [Writer profile doc](../../profile/writer.md)
- [Workspace Terms](../../../reference/workspace/TERMS.md)

## User Request / Topic

- 增强 profile 系统：用户常把 profile 当成“预设”使用，例如改文风、叙事方式、人称等。
- 现有 `InitialSchema` 是创建 session 时的稳定输入，`PayloadSchema` 是每次 invoke 的结构化载荷；二者都不适合承载 profile 默认预设。
- 新增 `ctx.settings`，用于 profile 级可配置参数。
- 设置是 profile 自定义的，第一版只做 `writer`。
- `writer` 的 settings 要能通过可视化表单调整，例如 `writingStylePreset` 应该是 select / combobox，可设置默认值和可用值。
- 动态 options、默认值和自定义校验都放在 profile 内部的 `defineLowCodeForm()` 声明中。
- 低代码表单能力需要解耦，后续项目其他地方也可能复用。
- 第一版低代码能力只做：
  - 类型校验。
  - 默认值。
  - 自定义校验，能返回校验结果。
  - 动态 options。
- UI 入口放到“Agent Profile 模型”设置界面，把它扩展为 profile 模型与预设配置。

## Goal

为 Agent Profile 增加 profile-owned settings 合同和第一版低代码表单设施，使 `writer` 可以通过设置页可视化调整文风预设、参考预设和人称，并在运行时通过 `ctx.settings` 读取合并后的配置。

成功标准：

- `defineAgentProfile()` 支持可选 `settingsForm`，并为 profile prepare/context 提供 `ctx.settings`。
- `settingsForm` 由 `defineLowCodeForm()` 定义，第一版支持 TypeBox schema、defaults、动态 field options 和 async custom validate。
- `writer` 声明自己的 settings form，不把文风、人称这类默认预设塞回 `InitialSchema` 或 `PayloadSchema`。
- Global Config 与 Project Config 能存储 `agent.profiles[profileKey].settings`；Project Workspace 可覆盖 Global。
- 设置页的 Agent Profile 模型面板扩展展示 profile settings。第一版只有 `writer` 出现 settings 区域。
- 保存 settings 时服务端执行类型校验和自定义校验；动态 options 由服务端执行 profile 内声明的函数生成。
- 修改 `writer` settings 后下一次 run 生效；已有 session 不需要重建即可在下一次 invoke 的 prepare 中读取最新 effective settings。
- 保持 `InitialSchema` / `PayloadSchema` 语义不回退。

## Current State

- `ProfilePrepareContext` 当前有 `ctx.initial`、`ctx.invocation?.payload`、`ctx.invocation?.message`、`ctx.vars`、`ctx.catalog`、`ctx.skills` 和 `ctx.runtime`，没有 `ctx.settings`。
- `InitialSchema` / `PayloadSchema` 迁移已完成：
  - `InitialSchema` 表示创建 session 时的稳定初始化数据。
  - `PayloadSchema` 表示单次 invocation 的结构化载荷。
  - 自然语言任务放在 `ctx.invocation?.message`。
- `writer` 已是长期 session：
  - `InitialSchema = {}`。
  - 每轮通过 `PayloadSchema` 传 `{path, context?}`。
  - `message` 承载写作任务。
- `writer` 当前固定使用默认 writing preset：
  - `buildWritingStyle({})` 使用 `DEFAULT_WRITING_STYLE_PRESET`。
  - `buildWritingReference({})` 使用 `DEFAULT_WRITING_REFERENCE_PRESET`。
- writing presets 已经是运行时数据资源，位于：
  - 系统层：`assets/workspace/.nbook/agent/writing-presets/{styles,references}`。
  - 用户层：`workspace/.nbook/agent/writing-presets/{styles,references}`。
  - 用户修改 preset 后不需要重新编译 writer profile，下一次 prepare 直接读取。
- Config 层已有 `agent.profiles[profileKey].model`，可按 Global / Project 合并 profile 模型参数，但没有 `settings` 字段。
- 现有 Profile Workbench 能展示 `InitialSchema` / `PayloadSchema` / `OutputSchema`，Schema Builder 第一版不写回。
- 现有变量系统更偏运行态变量和 agent 可读写状态，不适合作为 profile 默认预设的唯一入口。

## Research Notes / Impact Map

### Profile Contract and Runtime

相关文件：

- `server/agent/profiles/types.ts`
- `server/agent/profiles/define-agent-profile.ts`
- `server/agent/profiles/catalog.ts`
- `server/agent/profiles/profile-http-service.ts`
- `server/agent/harness/neuro-agent-harness.ts`

需要注意的问题：

- `AgentProfileDefinition` 和 `AgentProfile` 目前只泛型化 `InitialSchema`、`PayloadSchema`、`OutputSchema`，新增 `settingsForm` 后要继续保证 profile 文件内 `ctx.settings` 有类型推导。
- `AgentProfileCatalog.snapshot()` 当前只把 schema / tools / source 信息放进 catalog；settings form 不一定要进入 catalog，但 `editor-snapshot` 需要能拿到 loaded runtime profile 来 resolve form。
- `profile-http-service.previewAgentProfilePrepare()` 会直接手工构造 `ProfilePrepareContext`；需要注入默认 settings，否则 Profile Workbench 预览 writer 会缺字段。
- `NeuroAgentHarness.prepare()` 是正常 invoke 的主要 prepare 入口，需要按 session metadata 的 `workspaceRoot` / `projectPath` 读取 effective settings。
- `NeuroAgentHarness.reinjectHistorySetAfterCompaction()` 会在 compact 后重新调用 `profile.prepare()`，也要注入 settings；否则 compact 后 HistorySet 使用旧默认值。

### Config Layer

相关文件：

- `server/config/types.ts`
- `server/config/normalizer.ts`
- `server/config/config-service.ts`
- `shared/dto/config.dto.ts`
- `server/api/config/editor-snapshot.get.ts`
- `server/api/config/global.put.ts`
- `server/api/config/project.put.ts`

需要注意的问题：

- Config 当前只有 `agent.profiles[profileKey].model`，新增 settings 后要同时扩展 Stored / Effective / DTO 三种形态。
- `normalizeAgentProfiles()` 现在只保留 `model`，如果直接保存含 settings 的配置会被丢弃。
- `resolveEffectiveConfig()` 当前合并 profile model patch；settings 需要独立做 profile defaults + Global patch + Project patch 合并。
- `ConfigAgentProfileMapDtoSchema` 当前只允许 `{model}`；保存接口需要允许 `{model, settings}`，且 settings 只能是 JSON object。
- `readConfigEditorSnapshot()` 目前用 catalog profile 列表构造 `agentProfileSettings`，后续需要为带 settings form 的 profile 附带 resolved form、effective value、global/project patch 信息。
- `server/api/config/*.ts` 的 OpenAPI meta 是生成产物，DTO 改完后应通过 `bun scripts/build/generate-openapi-meta.ts` 或对应脚本同步，不要手写大段 route meta。

### Writer Profile

相关文件：

- `assets/workspace/.nbook/agent/profiles/builtin/writer.profile.tsx`
- `server/agent/profiles/writer-writing-style.ts`
- `server/agent/profiles/writer-writing-reference.ts`
- `server/agent/profiles/builtin-contracts.ts`

需要注意的问题：

- `writer.profile.tsx` 当前 `buildWritingStyle({})` 和 `buildWritingReference({})` 都使用默认 preset；应改为读取 `ctx.settings.writingStylePreset` 和 `ctx.settings.writingReferencePreset`。
- `writer.profile.tsx` 当前 `<narrative_person>` 硬编码“默认人称：第三人称”；应根据 `ctx.settings.narrativePerson` 渲染默认人称说明。
- `WriterInitialSchema` 与 `WriterPayloadSchema` 不应该新增文风、人称字段，避免回退到旧的 payload/initial 语义。
- writing preset 的动态 options 可以直接复用 `loadWritingStylePresets()` / `loadWritingReferencePresets()`，这些函数已经按系统层 + 用户层合并，并且用户覆盖同名文件。

### Frontend Settings UI

相关文件：

- `app/components/novel-ide/settings/NovelIdeAgentProfileModelSettingsPanel.vue`
- `app/components/common/form/FormInput.vue`
- `app/components/common/form/FormTextarea.vue`
- `app/components/common/form/FormSelect.vue`
- `app/components/common/form/FormCheckbox.vue`
- `app/components/common/form/Combobox.vue`
- `app/i18n/locales/zh-CN.ts`
- `app/i18n/locales/en-US.ts`
- `app/utils/api-error.ts`

需要注意的问题：

- 现有基础控件已经覆盖第一版大部分低代码字段，但 `Combobox.vue` 当前允许自由输入；低代码 `combobox` 第一版要求只能选择 options，可能需要新增受限版本或给现有组件加参数。
- 现有 Agent Profile 模型面板在保存时重建 `agent.profiles`，如果不保留 settings，后续保存模型参数可能清掉 profile settings。
- Project scope 已经存在类似 inherit 交互，settings 需要字段级 `继承 / 覆盖` segmented control：继承时展示上层 effective value 并禁用输入，覆盖时启用输入并写 Project patch。
- 业务组件里应使用 `resolveApiErrorMessage(error, fallback)`，不要继续直接读 `error.message`。
- 新低代码组件放在 `app/components/common/low-code-form/`，避免和 Agent Profile 设置页强绑定。

### Tests and Generated Assets

相关文件：

- `server/config/config-service.test.ts`
- `server/agent/profiles/profile-dsl.test.ts`
- `server/agent/profiles/catalog.test.ts`
- `server/agent/profiles/leader-assets-profile.test.ts`
- `server/agent/harness/neuro-agent-harness.test.ts`
- `scripts/build/profile.ts`
- `scripts/build/prepare-system-assets.ts`

需要注意的问题：

- 低代码 form 核心值得单独加 focused test，覆盖 defaults、TypeBox 校验、custom validate、动态 options。
- Config 合并测试应覆盖 Global settings、Project settings patch、Project 继承字段删除、非法 settings 保存拒绝。
- writer 相关测试可复用 `leader-assets-profile.test.ts`，检查 settings 能改变 preset 和默认人称。
- 改 builtin writer profile 后，需要重新 check / compile profile artifact，并按项目流程同步 system assets / user assets。

## Decisions / Discussion

- 新运行时字段命名为 `ctx.settings`。
- 第一版只给 `writer` 做 settings，底层合同支持所有 profile 声明自己的 settings form。
- UI 入口放在“Agent Profile 模型”设置界面，扩展该界面，而不是放到 TSX Profile Workbench 第一屏。
- 数据 schema 与低代码表单定义放在同一个 `defineLowCodeForm()` 中声明，但语义分开：
  - `schema` 负责值的类型与结构校验。
  - `defaults` 负责 profile 默认值。
  - `fields` 负责低代码渲染。
  - `validate(value, ctx)` 负责自定义校验。
- 动态 options 不做全局 option registry；字段直接在 profile 的 low-code form 中声明 `options(ctx)`。
- “服务端 resolver”在本任务中改称为 field `options(ctx)`：它是 profile 内定义的后端函数，服务端执行后返回前端渲染所需 options。
- 动态 options 的典型场景：`writer.writingStylePreset` 读取系统层和用户层 writing preset 目录，返回 combobox 选项。
- 第一版低代码设施只需要基本能力：
  - TypeBox 类型校验。
  - 默认值。
  - 自定义校验返回 issues。
  - 动态 options。
- 第一版低代码组件先覆盖常见数据类型：
  - `text`：短文本输入，对应 `string`。
  - `textarea`：长文本输入，对应 `string`。
  - `number`：数字输入，对应 `number`，支持 `min` / `max` / `step` / `integer`。
  - `switch`：单个布尔开关，对应 `boolean`。
  - `select`：单选下拉，对应 `string | number | boolean`。
  - `combobox`：可搜索单选，对应 `string | number`，主要用于动态 options。
  - `radio`：平铺单选，对应 `string | number | boolean`。
  - `checkbox`：多选复选框组，对应 `Array<string | number>`；之前讨论中的 `multi-select` 统一改名为 `checkbox`。
- 暂不做：
  - 字段间依赖刷新。
  - 复杂条件显隐。
  - schema-aware JSON Patch builder。
  - 通用 Profile Schema Builder 写回。
  - session 级 settings 覆盖。
- settings 生效策略：保存后下一次 run / prepare 生效，属于 `next-run`。
- Config API 第一版直接扩展 `editor-snapshot`，不拆 profile settings 专用 API。
- Project settings 保存为 patch，只保存用户显式调整的字段。
- Project UI 第一版展示“继承 / 覆盖”概念；每个字段可以继承上层 effective value，也可以保存 Project 覆盖值。
- `checkbox` 的 option value 第一版只支持 `string | number`。
- `combobox` 第一版不允许自由输入，只能选择服务端返回的 options。
- 保存时严格拒绝非法 settings；运行时如果读到已损坏或过期的 stored settings，则回退 defaults 并记录 warning，避免 profile 不可用。
- 第一版不加入分组布局能力，不提供 `section` / layout DSL。
- writer 第一版不提供 `extraStyleInstruction` 字段，只保留文风预设、文风参考预设和默认人称。
- writer 人称优先级：本轮 message 明确要求 > profile settings > writer 默认值。
- 低代码目录决策：
  - 服务端 runtime 放 `server/low-code-form`。
  - 共享 DTO 放 `shared/dto/low-code-form.dto.ts`。
  - 前端渲染组件放 `app/components/common/low-code-form/`。
- Config 存储建议：

```json
{
  "agent": {
    "profiles": {
      "writer": {
        "model": {},
        "settings": {
          "writingStylePreset": "xxx",
          "writingReferencePreset": "yyy",
          "narrativePerson": "third"
        }
      }
    }
  }
}
```

### Proposed Low-Code Form Shape

```ts
export const WriterSettingsForm = defineLowCodeForm({
    schema: Type.Object({
        writingStylePreset: Type.Optional(Type.String()),
        writingReferencePreset: Type.Optional(Type.String()),
        narrativePerson: Type.Optional(Type.Union([
            Type.Literal("first"),
            Type.Literal("second"),
            Type.Literal("third"),
        ])),
    }, {additionalProperties: false}),

    defaults: {
        writingStylePreset: DEFAULT_WRITING_STYLE_PRESET,
        writingReferencePreset: DEFAULT_WRITING_REFERENCE_PRESET,
        narrativePerson: "third",
    },

    fields: [
        {
            path: "writingStylePreset",
            component: "combobox",
            label: "文风预设",
            placeholder: "选择默认文风",
            async options() {
                const styles = await loadWritingStylePresets();
                return styles.map((style) => ({
                    value: style.key,
                    label: style.label,
                    description: style.sourceFile,
                }));
            },
        },
        {
            path: "writingReferencePreset",
            component: "combobox",
            label: "文风参考",
            placeholder: "选择默认参考样本",
            async options() {
                const references = await loadWritingReferencePresets();
                return references.map((reference) => ({
                    value: reference.key,
                    label: reference.label,
                    description: reference.sourceFile,
                }));
            },
        },
        {
            path: "narrativePerson",
            component: "radio",
            label: "默认人称",
            options: [
                {value: "third", label: "第三人称"},
                {value: "first", label: "第一人称"},
                {value: "second", label: "第二人称"},
            ],
        },
    ],

    async validate(value) {
        const issues = [];
        const styles = await loadWritingStylePresets();
        if (value.writingStylePreset && !styles.some((item) => item.key === value.writingStylePreset)) {
            issues.push({
                path: "writingStylePreset",
                severity: "error",
                message: "选择的文风预设不存在。",
            });
        }
        return issues;
    },
});
```

Profile 使用：

```ts
export default defineAgentProfile({
    manifest,
    initialSchema: InitialSchema,
    payloadSchema: PayloadSchema,
    settingsForm: WriterSettingsForm,
    async context(ctx) {
        const writingStyle = await buildWritingStyle({
            preset: ctx.settings.writingStylePreset,
        });
        return buildPrompt(writingStyle);
    },
});
```

## Proposed Architecture

### Shared Low-Code Form

新增一个通用低代码表单定义层：

- 服务端 runtime 放 `server/low-code-form`。
- 共享 DTO 放 `shared/dto/low-code-form.dto.ts`。
- 前端渲染组件放 `app/components/common/low-code-form/`。

核心 DTO：

- `LowCodeFormDto`
- `LowCodeFieldDto`
- `LowCodeFieldOptionDto`
- `LowCodeFormIssueDto`
- `LowCodeFieldComponent`

第一版组件类型：

- `text`
- `textarea`
- `number`
- `switch`
- `select`
- `combobox`
- `radio`
- `checkbox`

组件语义：

- `switch` 只表示单个 boolean 开关。
- `checkbox` 表示多选复选框组，不表示单个 boolean；它的值必须是数组。
- `select`、`combobox` 和 `radio` 都是单值选择，区别只在前端呈现方式。
- `combobox` 用于 options 较多或需要搜索的场景，例如 writing preset。

后续可扩展：

- `tag-input`
- `json`
- `reference-picker`
- `color`
- `file-path`

### Server Low-Code Runtime

新增服务端 helper：

- `defineLowCodeForm(definition)`：profile 源码内使用，返回带类型的 form definition。
- `resolveLowCodeForm(form, ctx)`：执行动态 options，返回前端 DTO。
- `parseLowCodeFormValue(form, value)`：使用 TypeBox schema 合并 defaults 并校验。
- `validateLowCodeFormValue(form, value, ctx)`：执行 schema 校验与 custom validate，返回 issues。

`ctx` 第一版只需要包含：

- `profileKey`
- `scope: "global" | "project"`
- `projectPath?: string`
- `workspaceRoot`

### Profile Runtime

扩展：

- `AgentProfileDefinition` 增加 `settingsForm?: LowCodeFormDefinition<TSettingsSchema>`。
- `ProfilePrepareContext` 增加 `settings: Static<TSettingsSchema>`。
- Harness prepare 阶段根据 session metadata 的 `workspaceRoot/projectPath` 读取 effective config，取 `agent.profiles[profileKey].settings`，合并 profile defaults，再校验。
- 如果 profile 没有 settings form，`ctx.settings` 默认为 `{}`。

### Config Layer

扩展：

- `AgentProfileConfig` 增加 `settings: JsonObject` 或等价 JSON 类型。
- `StoredAgentProfileConfig` 增加 `settings?: Record<string, JsonValue>`。
- `normalizeAgentProfiles()` 同时规范化 `model` 和 `settings`。
- `resolveEffectiveConfig()` 合并 Global / Project settings。
- DTO 增加 profile settings 编辑快照。

决定只存 patch：

- Global 保存不同于 profile defaults 的值。
- Project 只保存用户显式调整的字段。
- 读取时由 Config 层合并 profile defaults、Global 和 Project patch。
- Project UI 展示字段级“继承 / 覆盖”状态；选择继承时从 Project patch 中删除该字段，选择覆盖时写入该字段。

### HTTP API

决定第一版并入 config editor snapshot。

- `GET /api/config/editor-snapshot` 返回 `agentProfileSettings` 时附带 profile settings form DTO 和当前值。
- `PUT /api/config/global` / `PUT /api/config/project` 接收 `agent.profiles[profileKey].settings`。

当前用户决策是放到“Agent Profile 模型”界面，所以第一版复用 Config API。实现时要注意不要让 `editor-snapshot` 太重；如果动态 options 后续很多，可以再拆专用接口。

### Frontend Low-Code Components

新增通用组件，避免只服务 Agent Profile：

- `app/components/common/low-code-form/LowCodeForm.vue`
- `app/components/common/low-code-form/LowCodeFieldShell.vue`
- `app/components/common/low-code-form/LowCodeTextField.vue`
- `app/components/common/low-code-form/LowCodeTextareaField.vue`
- `app/components/common/low-code-form/LowCodeNumberField.vue`
- `app/components/common/low-code-form/LowCodeSwitchField.vue`
- `app/components/common/low-code-form/LowCodeSelectField.vue`
- `app/components/common/low-code-form/LowCodeComboboxField.vue`
- `app/components/common/low-code-form/LowCodeRadioField.vue`
- `app/components/common/low-code-form/LowCodeCheckboxField.vue`

组件职责：

- 只渲染 DTO，不执行 profile 代码。
- 展示 label、description、placeholder、required、default、error。
- 支持 `modelValue` 更新。
- Project scope 下展示字段级继承/覆盖交互。
- 选择继承时展示上层 effective value，并把字段从 Project patch 移除。
- 选择覆盖时启用当前字段编辑，并保存到 Project patch。
- 当前值不在 options 内时显示“当前值不可用”，不静默清空。

## Writer Settings Draft

第一版 writer settings 字段：

- `writingStylePreset`
  - component: `combobox`
  - options: `loadWritingStylePresets()`
  - default: `DEFAULT_WRITING_STYLE_PRESET`
  - validate: 选择的 key 必须存在。
- `writingReferencePreset`
  - component: `combobox`
  - options: `loadWritingReferencePresets()`
  - default: `DEFAULT_WRITING_REFERENCE_PRESET`
  - validate: 选择的 key 必须存在。
- `narrativePerson`
  - component: `radio`
  - options: 第一人称 / 第二人称 / 第三人称。
  - default: `third`
  - prompt: 替换 writer prompt 中硬编码的“默认人称：第三人称”。

注意：

- `PayloadSchema` 中不新增 style 字段。
- 本轮 message 明确要求的人称 / 文风优先于 profile default settings；profile settings 优先于 writer 内置默认值。
- settings 是默认预设，不是任务本身。

## Implementation Plan

### Phase 0 - Contract Shape Lock

- 固定低代码 DTO：
  - `LowCodeFormDto`
  - `LowCodeFieldDto`
  - `LowCodeFieldOptionDto`
  - `LowCodeFormIssueDto`
  - `LowCodeFieldComponent`
- 固定运行时定义：
  - `defineLowCodeForm(definition)`
  - `resolveLowCodeForm(form, ctx)`
  - `parseLowCodeFormValue(form, rawValue)`
  - `validateLowCodeFormValue(form, rawValue, ctx)`
- 明确 DTO 只包含可序列化数据；profile 内的 `options(ctx)` 和 `validate(value, ctx)` 不透传到前端。

### Phase 1 - Low-Code Form Core

- 新增 `shared/dto/low-code-form.dto.ts`，定义字段、选项、issue、value JSON 合同。
- 新增 `server/low-code-form`，实现：
  - TypeBox defaults 合并与类型校验。
  - 第一版组件类型校验：`text`、`textarea`、`number`、`switch`、`select`、`combobox`、`radio`、`checkbox`。
  - `select` / `combobox` / `radio` 单值 option 校验。
  - `checkbox` 数组值 option 校验。
  - async dynamic options resolution。
  - async custom validate。
- 新增 focused tests，覆盖：
  - defaults 合并。
  - TypeBox 校验失败转成 issue。
  - 动态 options 成功返回 DTO。
  - 自定义 validate 返回字段级 issue。
  - `combobox` 拒绝 options 外值。
  - `checkbox` 拒绝 options 外数组项。

### Phase 2 - Profile Settings Contract

- 扩展 `AgentProfileDefinition` / `AgentProfile`，新增 `settingsForm?: LowCodeFormDefinition<TSettingsSchema>`。
- 扩展 `ProfilePrepareContext`，新增 `settings`；没有 settings form 的 profile 使用 `{}`。
- 调整 `defineAgentProfile()` 类型参数，保证 profile 源码内 `ctx.settings` 能从 `settingsForm.schema` 推导。
- 给 `AgentProfileCatalog` 保留 runtime profile 上的 `settingsForm`，必要时在 detail/editor snapshot 侧读取 loaded profile，而不是把函数放进 catalog DTO。
- 在以下 prepare 调用点注入 settings：
  - `NeuroAgentHarness.prepare()` 正常 invoke。
  - `NeuroAgentHarness.reinjectHistorySetAfterCompaction()` compact 后 HistorySet 重注入。
  - `profile-http-service.previewAgentProfilePrepare()` Profile Workbench 预览。
- 对运行时读到损坏 settings 的情况做 fallback：记录 warning，使用 defaults，避免 profile 不可用。

### Phase 3 - Config Types, Merge and API

- 扩展 `server/config/types.ts`：
  - `AgentProfileConfig.settings`
  - `StoredAgentProfileConfig.settings`
  - settings 使用 JSON object 类型。
- 扩展 `server/config/normalizer.ts`：
  - `normalizeAgentProfiles()` 保留 settings patch。
  - `resolveEffectiveConfig()` 合并 Global / Project settings patch。
  - `normalizeCompleteAgentProfiles()` 同时补齐 model 与 settings。
- 扩展 `shared/dto/config.dto.ts`：
  - `ConfigAgentProfileMapDtoSchema` 允许 `{model, settings}`。
  - `ConfigAgentProfileSettingsDtoSchema.agentProfiles[]` 增加 settings form/value/patch/issue 信息。
- 扩展 `server/config/config-service.ts`：
  - `readConfigEditorSnapshot()` resolve 每个 loaded profile 的 settings form。
  - 只对声明 settings form 的 profile 返回 settings DTO；第一版 UI 只展示 writer。
  - 保存 Global / Project 时执行 server-side settings 校验，错误返回 400。
  - 保存模型参数时保留现有 settings；保存 settings 时保留现有 model。
- 同步或生成 OpenAPI meta，避免手写 `server/api/config/*.ts` 中的大段生成内容。
- 增加 config-service tests，覆盖：
  - Global settings 保存和 effective settings。
  - Project settings patch 覆盖 Global。
  - Project 字段切回继承后从 patch 删除。
  - 非法 settings 保存被拒绝。
  - 模型参数保存不会清掉 settings。

### Phase 4 - Writer Settings

- 在 `writer.profile.tsx` 声明 `WriterSettingsForm`：
  - `writingStylePreset`: `combobox`
  - `writingReferencePreset`: `combobox`
  - `narrativePerson`: `radio`
- 复用 `loadWritingStylePresets()` 和 `loadWritingReferencePresets()` 提供动态 options。
- 自定义 validate 校验 preset key 存在。
- 修改 `buildWriterPrompt(ctx)`：
  - `buildWritingStyle({preset: ctx.settings.writingStylePreset})`
  - `buildWritingReference({preset: ctx.settings.writingReferencePreset})`
  - `<narrative_person>` 根据 `ctx.settings.narrativePerson` 渲染。
- 不修改 `WriterInitialSchema` / `WriterPayloadSchema`。
- 更新 writer tests：
  - 默认 settings 保持现有 prompt 行为。
  - settings 可切换 writing style/reference preset。
  - settings 可切换默认人称。

### Phase 5 - Frontend Low-Code Form

- 新增 `app/components/common/low-code-form/` 组件族：
  - `LowCodeForm.vue`
  - `LowCodeFieldShell.vue`
  - `LowCodeTextField.vue`
  - `LowCodeTextareaField.vue`
  - `LowCodeNumberField.vue`
  - `LowCodeSwitchField.vue`
  - `LowCodeSelectField.vue`
  - `LowCodeComboboxField.vue`
  - `LowCodeRadioField.vue`
  - `LowCodeCheckboxField.vue`
- 复用现有 `common/form` 控件；`combobox` 需要支持“不允许自由输入”的模式。
- 支持 Project 字段级继承/覆盖：
  - 右侧 segmented control：`继承` / `覆盖`。
  - 继承时禁用输入，展示上层 effective value。
  - 覆盖时启用输入并写入 Project patch。
- 字段值不在 options 内时显示“当前值不可用”，不静默清空。
- 业务错误统一使用 `resolveApiErrorMessage(error, fallback)`。

### Phase 6 - Agent Profile Settings Panel Integration

- 扩展 `NovelIdeAgentProfileModelSettingsPanel.vue`：
  - 保留当前模型参数 UI。
  - 对有 settings form 的 profile 增加“Profile 预设”区域。
  - 第一版只展示 writer settings。
  - build/save payload 时同时保留 model 与 settings。
  - dirty check 同时覆盖 model 和 settings patch。
- 增加 zh-CN / en-US 文案。
- 避免把低代码渲染逻辑写死在 settings panel 内，确保后续其他地方能复用 LowCodeForm。

### Phase 7 - Docs, Build Artifacts and Verification

- 更新：
  - `reference/agent/profile-guide.md`
  - `docs/profile/writer.md`
  - `PROJECT-STATUS.md`
  - 本任务 walkthrough
- 重新 check / compile builtin writer profile。
- 同步系统 profile artifact 与 user-assets 需要的产物。

## Verification / Test

计划验证：

- `bun test server/agent/profiles/profile-dsl.test.ts server/agent/profiles/catalog.test.ts`
- `bun test server/config/config-service.test.ts`
- `bun test server/agent/profiles/leader-assets-profile.test.ts`
- `bun test server/agent/harness/neuro-agent-harness.test.ts -t settings`
- `bun scripts/build/profile.ts check builtin/writer.profile.tsx --system`
- `bun scripts/build/profile.ts compile builtin/writer.profile.tsx --system`
- `bun scripts/build/prepare-system-assets.ts --sync-user-assets`
- `bun scripts/build/generate-openapi-meta.ts`

如果前端改动较大，再按范围运行：

- `bun run typecheck`

已知注意事项：

- 全仓 typecheck 之前存在若干非本任务 strict 类型债务，最终验证时需区分是否为本任务引入。
- 相对路径测试可能命中 `product/` staged output；必要时使用源码绝对路径。

## Implementation Audit

2026-06-18 最终实现审查：

- 低代码 form runtime / DTO 已落地：
  - `shared/dto/low-code-form.dto.ts`
  - `server/low-code-form/index.ts`
  - `server/low-code-form/low-code-form.test.ts`
- Profile 合同已接入：
  - `AgentProfileDefinition.settingsForm`
  - `ProfilePrepareContext.settings`
  - `defineAgentProfile()` 手工 prepare 默认 settings fallback
  - 正常 invoke、compact 后 HistorySet 重注入、Profile Workbench prepare preview 都会注入 settings。
- Config 层已贯穿：
  - Stored / Effective / DTO 都支持 `agent.profiles[profileKey].settings`。
  - `editor-snapshot` 返回 form、value、inheritedValue、effectivePatch、globalPatch、projectPatch、issues。
  - 保存 Global / Project 时执行 schema、options、自定义 validate 校验。
  - Project patch 字段继承时从 Project patch 删除。
- 前端低代码组件已落地在 `app/components/common/low-code-form/`，覆盖 `text`、`textarea`、`number`、`switch`、`select`、`combobox`、`radio`、`checkbox`。
- `NovelIdeAgentProfileModelSettingsPanel.vue` 已扩展为模型参数 + Profile 预设配置，Project scope 展示字段级“继承 / 覆盖”。
- `writer.profile.tsx` 已声明 `WriterSettingsForm`，并通过 `ctx.settings` 控制文风预设、文风参考预设和默认人称。

最终收敛的边界：

- 第一版 `field.path` 只支持 settings 对象顶层字段，不支持 dot path nested merge。
- `checkbox` 表示多选复选框组，值是数组；option value 只支持 `string | number`。
- `switch` 表示单个 boolean。
- `combobox` 只允许选择 options 内的值，不允许自由输入。
- `writer` 不提供 `extraStyleInstruction`。
- writer 人称优先级：本轮 message 明确要求 > profile settings > writer 默认值。

已知非本任务问题：

- `bun scripts/build/generate-openapi-meta.ts` 的 route map 仍包含 24 个已不存在的旧 Plot route，因此会打印 `File not found`。脚本退出码为 0，且本任务相关 Config route meta 已刷新出 `settings` / `inheritedValue`。
- `bun test server/config/config-service.test.ts` 会同时命中 `product/server/config/config-service.test.ts` staged output；本任务相关源码用例已通过，product 旧测试也通过。

## Final Implementation Plan

- Backend contract：
  - 新增低代码 form DTO/runtime。
  - 扩展 profile `settingsForm` 与 `ctx.settings`。
  - 扩展 Config stored/effective/editor snapshot/save validation。
  - 让 writer 使用 settings，不回退污染 `InitialSchema` / `PayloadSchema`。
- Frontend：
  - 新增可复用低代码组件族。
  - Agent Profile 模型面板展示 profile settings。
  - Project scope 展示“继承 / 覆盖”。
- Generated assets and docs：
  - 编译 writer profile artifact。
  - 同步 system assets / user-assets。
  - 生成 OpenAPI meta。
  - 更新 reference、writer 文档、PROJECT-STATUS 和 task walkthrough。

## Implementation Walkthrough

- 2026-06-18：创建 task。调研确认 `InitialSchema` / `PayloadSchema` 不适合承载用户预设；现有 Config 只有 profile 模型参数，没有业务 settings；writer 目前硬编码默认 writing presets 和默认第三人称。
- 2026-06-18：用户决策：
  - 运行时命名使用 `ctx.settings`。
  - 第一版只做 `writer`。
  - UI 放到 Agent Profile 模型设置界面。
  - settings 是 profile 自定义的。
  - 低代码能力使用 `defineLowCodeForm()` 在 profile 内声明。
  - 第一版只做类型校验、默认值、自定义校验和动态 options。
  - 动态 options 不做全局 resolver registry，直接由 profile 内 field `options(ctx)` 提供。
- 2026-06-18：低代码组件范围细化：
  - 第一版覆盖 `text`、`textarea`、`number`、`switch`、`select`、`combobox`、`radio`、`checkbox`。
  - `checkbox` 用于多选复选框组，对应数组值；之前讨论中的 `multi-select` 不作为组件名。
  - 单个 boolean 使用 `switch`。
- 2026-06-18：低代码实现边界继续收敛：
  - Config API 第一版扩展 `editor-snapshot`。
  - Project settings 保存为 patch。
  - Project UI 展示字段级继承/覆盖交互。
  - `checkbox` option value 只支持 `string | number`。
  - `combobox` 不允许自由输入，只能选择已有 options。
  - 保存时严格拒绝非法 settings；运行时读到损坏 settings 时回退 defaults 并记录 warning。
  - 第一版不加入分组布局能力。
- 2026-06-18：writer settings 范围继续收敛：
  - writer 第一版不提供 `extraStyleInstruction`。
  - writer 人称优先级为：本轮 message 明确要求 > profile settings > writer 默认值。
  - 低代码目录固定为 `server/low-code-form`、`shared/dto/low-code-form.dto.ts`、`app/components/common/low-code-form/`。
- 2026-06-18：调研相关文件并重审实现计划：
  - profile runtime 需要同时覆盖正常 invoke、Profile Workbench prepare 预览、compact 后 HistorySet 重注入三个 prepare 入口。
  - Config 当前只保留 `agent.profiles[profileKey].model`，新增 settings 需要贯穿 Stored / Effective / DTO，并修复保存模型参数时可能清掉 settings 的风险。
  - writer 当前硬编码默认 writing presets 和第三人称，settings 只接入这三处，不修改 InitialSchema / PayloadSchema。
  - 前端已有基础表单控件，但低代码 `combobox` 需要禁止自由输入；Project scope 需要字段级“继承 / 覆盖”交互。
  - API route meta 是生成产物，DTO 改动后应运行 OpenAPI meta 生成脚本同步。
- 2026-06-18：完成后端低代码 form runtime 与 tests：
  - defaults 合并与 TypeBox 校验。
  - 动态 options。
  - 自定义 validate。
  - combobox / checkbox option 校验。
  - 顶层 field path 与 checkbox option value 边界。
- 2026-06-18：完成 profile runtime settings 接入：
  - `settingsForm` 类型推导。
  - `ctx.settings` 注入。
  - 运行时损坏 settings 回退 defaults。
- 2026-06-18：完成 Config 支持：
  - Global / Project settings patch 保存与合并。
  - `inheritedValue` DTO。
  - 保存时服务端校验非法 option 与自定义 validate 错误。
- 2026-06-18：完成 writer settings：
  - `writingStylePreset`
  - `writingReferencePreset`
  - `narrativePerson`
  - prompt 根据 settings 渲染文风、参考样本和默认人称。
- 2026-06-18：完成前端低代码组件与 Agent Profile 模型面板集成。
- 2026-06-18：刷新生成产物：
  - `bun scripts/build/profile.ts compile builtin/writer.profile.tsx --system`
  - `bun scripts/build/prepare-system-assets.ts --sync-user-assets`
  - `bun scripts/build/generate-openapi-meta.ts`
- 2026-06-18：根据代码审查修复三个收敛问题：
  - Project settings 保存校验改为先合并 Global 继承值与 Project patch，再执行低代码 schema/options/custom validate，避免保存后运行时 effective settings 才失败并回退 defaults。
  - 前端低代码 form 改为区分字段缺失与显式 `null`，nullable 字段不再被默认值吞掉。
  - Profile Workbench prepare preview 改为读取 session/workspace 对应的 effective profile settings，减少预览与真实运行不一致。
- 2026-06-19：低代码表单 UI 细节修正：
  - `LowCodeComboboxField` 抽出内部 `useLowCodeComboboxDropdown()`，复用 `useFloatingPanelLayout()` 支持浮层自动向上/向下展开。
  - `LowCodeRadioField` 改为 segmented control 视觉，减弱选中态色块，保留原有值类型和保存语义。
- 2026-06-19：提高 `FormSelect` 与 low-code combobox 下拉 option 浮层层级，减少在 Dialog 内被相邻容器遮盖的问题。
- 2026-06-19：修复 Config editor snapshot 被 profile settings 构造拖慢的问题：
  - `editor-snapshot`、`global.put`、`project.put` 增加 `includeAgentProfileSettings` query，默认只返回轻量 `agentProfileSettings`。
  - 只有 Agent Profile 模型设置面板请求完整 settings form / value / issues，其他设置面板不触发低代码 options 与自定义校验解析。
  - `AgentProfileCatalog.snapshot()` 增加 `hasSettingsForm`，完整模式也只对带 settings form 的 profile 执行 runtime `profiles.get()`。
- 2026-06-20：配置中心 UI 收敛：
  - `useFloatingPanelLayout()` 改为按 viewport 与最近 overflow 裁剪祖先的交集计算上下展开空间，修复 Dialog / 滚动容器内 select 方向误判。
  - 配置中心默认打开全局配置，并将 `Global Config` / `Project Config` / `Browser State` 等中文 UI 文案本地化。
  - “默认 Agent Profile”合并进 Agent Profile 模型面板顶部，独立左侧入口和旧面板组件移除。
  - 模型设置页删除默认模型卡片与新增 Provider 卡片的两段说明文字。
- 2026-06-26：`leader.default` 接入低代码 settings 模板：
  - 新增 `LeaderDefaultSettingsForm`，字段包括协作主动程度、NeuroBook 熟练度、提问策略、Leader 人设资源和最高优先级自定义插入槽位。
  - 新增 `leader.default` profile home 初始化，默认写入 `personas/default.md` 精简彩绘人设；该人设只影响对话气质，不引入 RP 小屋、万华镜、第三人称动作回复或思维劫持。
  - `leader.default` system prompt 改为按 `customTopSystemPrompt -> leaderPersona -> leader_settings -> 原始系统提示词` 顺序组装。
  - 保守协作模式会提醒 Leader 更主动核查现实知识 / 外部事实，并在需要联网资料时通过现有 `researcher` profile 调研。

## Verification

已执行：

- `bun test server/low-code-form/low-code-form.test.ts`：8 pass。
- `bun test server/config/config-service.test.ts`：34 pass。
- `bun scripts/build/profile.ts check builtin/writer.profile.tsx --system`：通过。
- `bun scripts/build/profile.ts status builtin/writer.profile.tsx --system`：`loaded`。
- `bun scripts/build/profile.ts compile builtin/writer.profile.tsx --system`：写入 `builtin__writer.mjs` 与 types。
- `bun scripts/build/prepare-system-assets.ts --sync-user-assets`：updated profiles 1。
- `bun scripts/build/generate-openapi-meta.ts`：Config route meta 已包含 `settings` / `inheritedValue`；旧 Plot route map 有已知缺失文件提示。
- `bun test server/agent/profiles/leader-assets-profile.test.ts -t "writer 输入合同|writer payload|writer 无 payload|writer settings"`：源码 writer 4 pass；同命令命中 product 旧 staged writer 合同 1 pass。
- `bun test server/agent/harness/neuro-agent-harness.test.ts -t "profile settings"`：1 pass，证明同一 session 下一次 prepare 会读取最新 effective settings。
- `bun test server/agent/harness/model-resolver.test.ts server/agent/profiles/profile-dsl.test.ts`：68 pass。
- `bun run typecheck`：通过。
- 审查修复后追加验证：
  - `bun test server/config/config-service.test.ts -t "Agent Profile settings"`：4 pass。
  - `bun test server/low-code-form/low-code-form.test.ts`：8 pass。
  - `bun run typecheck`：通过。
- 低代码表单 UI 修正后追加验证：
  - `bun run typecheck`：通过。
- 下拉浮层层级调整后追加验证：
  - `bun run typecheck`：通过。
- Config editor snapshot 按需加载修正后追加验证：
  - `bun test server/config/query.test.ts server/config/config-service.test.ts`：39 pass。
  - `bun run generate:openapi`：Config route meta 已刷新；仍有既有 24 个旧 Plot route 缺失提示，脚本退出成功。
  - `bun run typecheck`：通过。
- 配置中心 UI 收敛后追加验证：
  - `bun run typecheck`：通过。
- `leader.default` settings 模板追加验证：
  - `bun scripts/build/profile.ts check builtin/leader.default.profile.tsx --system`：通过，提示 source 已修改需重新编译。
  - `bun scripts/build/profile.ts compile builtin/leader.default.profile.tsx --system`：写入 `builtin__leader.default.mjs` 与 types。
  - `bun scripts/build/prepare-system-assets.ts --sync-user-assets`：通过；prepared system profiles 14，compiled 13 stale profile(s)，synced user assets updated profiles 3。
  - `bun test server/agent/profiles/leader-assets-profile.test.ts -t "Project home 初始化默认人设"`：1 pass，证明默认 persona resource 可初始化、校验并注入 prompt。
  - `bun test server/agent/profiles/leader-assets-profile.test.ts -t "leader.default settings"`：1 pass，证明 catalog 标记 `hasSettingsForm`、默认 settings 校验、自定义插入槽位顺序和行为偏好渲染正常。
  - `bun test server/agent/profiles/leader-assets-profile.test.ts -t "leader.default settings|Project home 初始化默认人设"`：2 pass，system assets 同步后复跑通过。
  - `bun test server/config/config-service.test.ts server/low-code-form/low-code-form.test.ts`：92 pass，覆盖低代码 form、resource-preset、Config profile settings 基础通道。
  - `bun run typecheck`：未通过；错误全部位于既有 `server/agent/tools/control-tools.test.ts`，与 `PROJECT-STATUS.md` 已记录的 pendingApprovals / control-tools 类型漂移一致，本轮 leader settings 未出现相关类型错误。

未作为本任务验收门的命令：

- `bun test server/agent/harness/neuro-agent-harness.test.ts` 全量当前会命中既有 harness/product staged output 问题，包括 usage shape 旧断言、部分长等待超时，以及 product `leader.default` compiled artifact 缺失；这些失败与本任务 settings focused 用例无关。

## TODO / Follow-ups

- 后续如果要支持 nested settings，需要明确 deep merge / patch builder / schema-aware path 语义后再放开 dot path。
- 后续可以把 OpenAPI route map 中已删除的旧 Plot routes 清掉，避免生成脚本继续打印缺失文件。
