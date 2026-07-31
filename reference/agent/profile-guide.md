# Agent Profile Guide

本文档说明 active Agent Profile 的职责边界、TSX Profile DSL 写法和新增 profile 时的检查点。

相关文档：

- [harness.md](harness.md)
- [context.md](context.md)
- [profile-import.md](profile-import.md)
- [project-workspace-guide.md](project-workspace-guide.md)

## Profile Definition

当前推荐使用 `defineAgentProfile()` 定义 profile。Profile 至少声明：

- `manifest.key`
- `manifest.name`
- `initialSchema`
- `tools`
- `context(ctx)`

需要每轮结构化调用载荷时声明 `payloadSchema`。需要结构化结果时声明 `outputSchema`。需要 profile 自定义默认预设时声明 `settingsForm`，运行时通过 `ctx.settings` 读取合并后的设置；settings 不属于创建期 initial，也不属于单次 invocation payload。存在 `outputSchema` 时，`report_result.data` 是主路结构化输出的 runtime 校验依据；provider-visible schema 中该字段保持 optional，方便任务失败或只返回可读错误说明时仍能结束主 run。旁路结构化结果不要复用 `report_result`，必须通过 `report_sidecar_result.data` 返回。

`tools` 是 profile 的根工具绑定对象，决定模型可见工具 schema 和 profile 最大执行权限。推荐用 `toolset(builtin...)` 显式声明工具集合；需要定制 `report_result.data` schema 时使用 `builtin.result.main({ dataSchema: OutputSchema })`。如果 profile 有 sidecar，root `tools` 需要同时声明 `builtin.result.sidecar()`；其 `data` schema 会由当前 profile 全部 `sidecarDataSchema` 汇总成 sidecar-name keyed 的 profile-stable union。sidecar 调用时必须传 `data: { "<sidecar-name>": payload }`，payload 才按该 sidecar 的 `sidecarDataSchema` 校验。主 run 需要收窄执行权限时声明顶层 `toolKeys`，sidecar 需要收窄执行权限时声明 `sidecar.toolKeys`，二者都只能引用根 `tools` 中已有的 key。

所有模型可见工具的 `parameters` 必须是根级 `type: "object"`。多操作工具不能直接把根级 `Type.Union` 暴露给 Provider；应使用顶层对象作为模型可见参数，并把按 `op` 区分的严格联合放在 `validationSchema`，由执行入口校验。工具注册表会在 Provider 投影前拒绝缺少 object 根类型的 schema，避免把无效请求发送到模型服务。

`tools` 支持三种来源：

- `builtin.file.read` / `builtin.file.write` 等：引用内置全局工具。
- `defineProfileTool({...})`：定义并内联 profile 自带工具，该工具只在当前 profile run 内可见。
- `pluginTool("plugin_tool")`：引用运行时已注册但没有 typed API 的插件工具；不要用它内联自带工具。

内置 profile 位于 `assets/workspace/.nbook/agent/profiles/builtin/`，例如：

- `leader.default.profile.tsx`
- `writer.profile.tsx`
- `retrieval.profile.tsx`
- `simulator.leader.profile.tsx`
- `simulator.actor.profile.tsx`
- `rp.writer.profile.tsx`

## Prepare Lifecycle

1. Harness 校验 profile initial 和本轮 payload，并构造 `ProfilePrepareContext`。
2. Profile `context(ctx)` 返回 `<ProfilePrompt>`。
3. `server/agent/profiles/profile-dsl.ts` 编译 TSX tree，生成 `ProfileTurnPlan`。
4. Harness 根据 plan 组合 provider prompt、历史写入和 profile runtime state。
5. Assistant / tool result 进入 runtime transcript，并按当前 runtime hooks 写回。

常用 `ctx` 字段：

- `ctx.initial`：通过 `initialSchema` 校验后的 profile 创建期初始化数据。
- `ctx.invocation?.payload`：通过 `payloadSchema` 校验后的本轮结构化载荷。未声明 `payloadSchema` 的 profile 不接受 payload。
- `ctx.invocation?.message`：本轮自然语言 message；它不属于 `PayloadSchema`。
- `ctx.settings`：Profile 通用运行设置与 `settingsForm` 自定义设置的合并视图。通用项包含 `fileChangeDiffMaxChars`；自定义项由 defaults、Global Config 与 Project Config patch 合并并校验。
- `ctx.session`：当前 session facade，包含 workspaceRoot、messages、customState、linkedAgents 等。
- `ctx.vars`：底层变量访问器，仅用于需要显式编程访问的 profile；不提供公开 TSX helper 或 Agent variable tools。
- `ctx.catalog`：当前可见 agent profiles 和 profile issues。
- `ctx.skills`：当前可见 skills。
- `ctx.runtime`：本轮时间、用户 turn 计数等 runtime 信息。

## Profile Settings

`settingsForm` 用来表达 profile 自己拥有的可视化设置，例如 writer 的文风要求、文风参考和默认人称。它适合放“长期默认偏好”，不适合放本轮任务、目标文件、临时上下文或用户自然语言要求。

settings 使用 `defineLowCodeForm()` 定义：

```ts
import {Type} from "typebox";
import {defineLowCodeForm} from "nbook/server/low-code-form";

export const SettingsSchema = Type.Object({
    writingStylePreset: Type.String(),
}, {additionalProperties: false});

export const WriterSettingsForm = defineLowCodeForm({
    schema: SettingsSchema,
    defaults: {
        writingStylePreset: "default",
    },
    fields: [{
        path: "writingStylePreset",
        component: "combobox",
        label: "文风要求",
        placeholder: "选择默认文风要求",
        async options() {
            return [
                {value: "default", label: "默认文风"},
            ];
        },
    }],
});
```

第一版低代码 form 支持：

- TypeBox schema 类型校验。
- `defaults` 默认值。
- 字段级动态 `options(ctx)`。
- async `validate(value, ctx)` 自定义校验，返回字段级 issue。
- 字段级 `section: {key, label, description?}` 显示分区；分区随表单 DTO 返回，只控制 UI，不写入 settings patch。
- 合并 stored patch 时忽略 `defaults` 未声明的顶层 key：字段下线后，旧存档残留不会导致校验失败或整份 settings 回退默认。
- 组件：`text`、`textarea`、`number`、`switch`、`select`、`combobox`、`radio`、`checkbox`。

第一版限制：

- `field.path` 只支持 settings 对象的顶层字段，不支持 dot path nested merge。
- `checkbox` 表示多选复选框组，值必须是数组，option value 只支持 `string | number`。
- `switch` 表示单个 boolean。
- `combobox` 只能选择 options 中的值，不允许自由输入。

Config 层保存 `agent.profiles[profileKey].settings` patch。Global patch 覆盖 profile defaults；Project patch 覆盖 Global，并在 Project UI 中展示字段级“继承 / 覆盖”。保存时服务端会执行 schema、options 和自定义校验；运行时如果读到损坏 settings，会回退 defaults 并记录 warning，避免 profile 不可用。

同一职责存在多个 Profile 变体时，schema、form fields 和动态 Prompt renderer 必须抽为共享契约，变体只覆盖默认值或追加自身固定合同。例如 `writer` / `rp.writer` 共享 Writer 设置，`rp.actor` / `simulator.actor` 共享 Actor 设置。这样新增职责字段时，类型和测试会同时约束所有变体，避免只更新基础 Profile。内置 Profile 使用 `profileFeatureFormFields()` 把职责字段统一标记为“特色设置”；`promptCustomizationFormFields()` 生成的 `personaPreset` 与 `promptEntries` 统一属于“提示词系统”。

内置 Profile 统一通过 `promptCustomizationSchemaFields` 暴露安全的提示词自定义槽位：

- `personaPreset` 是 Profile Home `prompts/*.md` 中的人设/策略正文预设。
- `promptEntries` 是有序条目数组；每项可新增、删除、启停、排序，并用 `position: "before" | "after"` 指定进入固定 Profile 结构之前或之后。缺省 `position` 等价于 `before`，保证既有配置继续位于前置槽。`enabled=false` 的条目保留在配置和预设中，但渲染时必须过滤；UI 使用明确的“已启用 / 已禁用”状态，不能只依赖无标签图标或颜色。
- `profilePresets` / `activeProfilePresetId` 保存整套 Profile settings 快照。快照自动排除预设存储字段本身，包含提示词条目和 Writer、Leader、RP 等特色设置，不包含模型参数或通用运行策略。配置中心中的创建、更新和应用预设都先修改页面草稿，必须再执行页面级“保存设定”才会持久化。

提示词自定义不能覆盖身份、工具权限、输出 schema、结构化交接合同，也不能跨 `HistorySet` / `ModelContext` / `AppendingSet` 分区重排。Profile 作者应把这些锁定合同继续写在 TSX 中，并按以下稳定顺序显式渲染两个开放槽：

1. `renderPromptEntries(settings, "before")`
2. 固定 Profile 结构：人设、特色设置、身份/工具协议、输出合同
3. `renderPromptEntries(settings, "after")`

配置中心会把这三段显示成“前置提示词 → 固定 Profile 结构 → 末尾补充提示词”。上下排序只在当前槽内生效；切换 `position` 才能跨槽移动。固定结构始终锁定，不能被条目排序穿越。

配置中心“完整提示词预览”通过服务端真实 `profile.prepare()` 生成，不在前端近似拼接。当前草稿会把 `settingsOverride` 与未保存资源 mutation 应用到内存 Profile Home 覆盖层，读取行为与真实 Home 一致但不会写盘；“已保存生效”不带草稿覆盖。若 Profile 的 `initialSchema` 需要角色或任务初始化数据，预览返回 `initial_context_required` 并要求选择同 Profile 的真实 Session；服务端复用该 Session 的 durable `initial` 与 Project 上下文，禁止用自动填空字符串伪造角色档案或文件路径。

Profile settings 和 Profile 模型配置都采用 next-invocation 语义：Harness 在同一个 Session 的每次 invocation 开始时重新解析 effective config，并冻结为该次 invocation 的快照。因此修改提示词条目、特色设置、`temperature` 或 `realtimeOutput` 后无需重开 Session，会从下一次调用生效；正在执行的调用不会中途变化。`ctx.vars` 是运行态变量访问器，不是用户配置真相源，不要用它模拟设置热更新。

Profile settings 引用的内置 Profile Home 资源必须对既有 Home 可迁移。若新增默认 `prompts/*.md`、`personas/*.md` 等资源，必须同步提升 `manifest.version` 并在 `home.upgrade()` 中以 create-only 语义补齐；只修改 `home.initialize()` 不会更新已有 Home，缺失资源会在配置保存校验阶段阻断整份请求。

配置中心的 Profile 模型参数只保留有真实运行时消费者的字段：模型选择、`temperature`、推理强度和 `realtimeOutput`。Provider 内部始终使用流式接口；`realtimeOutput=false` 仅抑制公开的增量事件，完成后仍发送最终消息。`topK` 没有 Pi 通用合同，已删除。Compaction Prompt 与摘要前缀是 Harness 内部常量，不属于普通 Profile 配置；用户可配置的 Compaction 运行策略只包含启停、触发、预留 token 和保留近期上下文。

## TSX Contract

Profile `context()` 应返回 `<ProfilePrompt>` 根节点：

```tsx
context() {
    return (
        <ProfilePrompt>
            <System>{SYSTEM_PROMPT}</System>
            <HistorySet>
                <Message>
                    <AgentCatalog />
                </Message>
                <Message>
                    <SkillCatalog />
                </Message>
                <Message>
                    <Import path="reference/agent/project-workspace-guide.md" />
                </Message>
            </HistorySet>
            <AppendingSet>
                <WorkdirReminder />
                <ProjectWorkspaceReminder />
                <ModeReminder />
            </AppendingSet>
        </ProfilePrompt>
    );
}
```

顶层允许：

- `System`
- `HistorySet`
- `ModelContext`
- `AppendingSet`
- `Compaction`
- `If`
- `Fragment`

非空文本必须放在支持 string 的节点内，例如 `System` 或 `Message`。不要在 `ProfilePrompt` 顶层放裸文本。

## System

`System` 是 profile 的身份、职责、工具边界和长期行为规则。它只接受 string-like children。

适合放：

- profile 是谁。
- profile 的任务边界。
- 工具使用原则。
- 与其他 agent 的协作原则。
- 必须长期遵守的输出规则。

不适合放：

- 本轮临时状态。
- 当前 Project Workspace。
- 变量值。
- 大段可共享的项目协议。共享协议优先放到 `reference/`，再用 `Import` 显式导入。

## HistorySet

`HistorySet` 是稳定历史前缀。缺少历史前缀时，它会写入 session 历史根部；已经存在稳定前缀时，不会每轮重复写入。

适合放：

- 可用 agent catalog。
- 可用 skill catalog。
- 共享规范导入，例如 `<Import path="reference/agent/project-workspace-guide.md" />`。
- 需要首轮持久化、后续不频繁变化的上下文。

规则：

- `SkillCatalog`、`AgentCatalog`、`Import` 都是 string fragment，必须包在 `Message` 或 `System` 这种 string 容器内。
- 不要放 `Reminder` 或 `Watch`。
- 不要放当前变量值、当前 selected file、当前任务状态等运行期内容。

## Import

`Import` 显式导入共享文本文件，避免复制长 prompt。

推荐用法：

```tsx
<HistorySet>
    <Message>
        <Import path="reference/agent/project-workspace-guide.md" />
    </Message>
</HistorySet>
```

支持：

- `path`
- `heading`
- `maxBytes`
- `required`
- `label`
- `as`，V1 只支持 `text`

V1 只允许 `AGENTS.md`、`reference/**` 和 `docs/**`。不要用 `Import` 读取 Project Workspace 文件；项目内容应通过 agent 文件工具、sidecar 或 runtime 注入读取。

详见 [profile-import.md](profile-import.md)。

## ModelContext

`ModelContext` 是本轮只给模型看的上下文，不写入产品历史。

适合放：

- SQL schema summary
- 当前运行期只读摘要
- 不应持久化到历史里的 `Reminder` / `Watch`

规则：

- `Reminder` / `Watch` 在 `ModelContext` 中生成的消息进入本轮 provider prompt，不写入产品历史。
- 不要把长期共享说明放在这里；稳定说明优先放 `HistorySet`。

## AppendingSet

`AppendingSet` 是贴近当前输入的上下文区域。它产出的非空消息会写入当前历史光标，并在模型上下文中位于当前用户消息之前。

适合放：

- `WorkdirReminder`
- `ProjectWorkspaceReminder`
- `ModeAvailabilityReminder`
- `ModeReminder`
- `LinkedAgentsReminder`
- `TaskReminder`
- `MentionedSkillsReminder`
- 需要靠近当前输入的运行期提醒

规则：

- `Reminder` 根据 `when`、变量 watch、函数 watch 和 `repeatEveryTurns` 控制注入频率。
- `Watch` 适合把重要外部状态变化写入历史。
- `ActivatedSkills` / `MentionedSkillsReminder` 必须包在 `Message` 内。
- 不接受非空裸文本。

## Minimal Skeleton

```tsx
/** @jsxImportSource nbook/server/agent/profiles/profile-dsl */
/** @jsxRuntime automatic */
import {Type} from "typebox";
import {defineAgentProfile} from "nbook/server/agent/profiles/define-agent-profile";
import {builtin, toolset} from "nbook/server/agent/profiles/profile-tools";
import {
    AppendingSet,
    HistorySet,
    Import,
    Message,
    ModelContext,
    ProfilePrompt,
    ProjectWorkspaceReminder,
    SkillCatalog,
    System,
    WorkdirReminder,
} from "nbook/server/agent/profiles/profile-dsl";

export const profileManifest = {
    key: "some.profile",
    name: "Some Profile",
    description: "Example profile.",
} as const;

export const InitialSchema = Type.Object({
    prompt: Type.String(),
});

export const PayloadSchema = Type.Object({
    plotId: Type.Optional(Type.String()),
});

export default defineAgentProfile({
    manifest: profileManifest,
    initialSchema: InitialSchema,
    payloadSchema: PayloadSchema,
    tools: toolset(
        builtin.file.read,
        builtin.file.write,
        builtin.file.edit,
    ),
    context() {
        return (
            <ProfilePrompt>
                <System>
                    你是 Some Profile。只处理输入中明确要求的任务。
                </System>
                <HistorySet>
                    <Message>
                        <SkillCatalog />
                    </Message>
                    <Message>
                        <Import path="reference/agent/project-workspace-guide.md" />
                    </Message>
                </HistorySet>
                <AppendingSet>
                    <WorkdirReminder />
                    <ProjectWorkspaceReminder />
                </AppendingSet>
            </ProfilePrompt>
        );
    },
});
```

## Profile-Owned Tool

profile 可以用 `defineProfileTool()` 定义自带工具，并把 definition 本身放进根 `tools`。自带工具的 key 只在当前 profile run 内解析，不会注册进全局 registry。

```ts
import {Type} from "typebox";
import {builtin, defineProfileTool, toolset} from "nbook/server/agent/profiles/profile-tools";

const roll_dice = defineProfileTool({
    key: "roll_dice",
    description: "Roll one six-sided dice.",
    parameters: Type.Object({}),
    async execute() {
        const value = Math.floor(Math.random() * 6) + 1;
        return {
            content: [{type: "text", text: `rolled ${value}`}],
            details: {value},
        };
    },
});

const profileTools = toolset(
    roll_dice,
    builtin.result.main(),
);
```

## Checklist

新增或修改 profile 后检查：

- `key`、`kind`、`name` 和 `description` 是否准确。
- `initialSchema` 是否只包含创建期初始化数据，不混入每轮动态状态。
- `payloadSchema` 是否只包含单次 invocation 的结构化载荷；自然语言 message 不要塞进 payload。
- 需要结构化结果时是否声明 `outputSchema`。
- `tools` 是否是 profile 最大工具集合；顶层 `toolKeys` / `sidecar.toolKeys` 是否只是它的子集。
- sidecar 是否使用 `report_sidecar_result` 而不是 `report_result` 返回旁路结果；是否声明了对应 `sidecarDataSchema`。
- `System` 是否只放 profile 身份、职责和长期行为边界。
- `HistorySet` 是否只放稳定前缀。
- 共享规范是否用 `Import` 引用，而不是复制长 prompt。
- `ModelContext` 是否只放本轮模型可见、不需要持久化的上下文。
- `AppendingSet` 是否贴近当前输入，Reminder 顺序是否合理。
- 动态焦点是否通过明确的 runtime reminder 或 `ctx.invocation.clientState` 表达。
- 新 TSX 节点是否有定向测试覆盖。
- profile 是否可通过 `bun scripts/build/profile.ts check <file> --system` 或对应用户 assets check。
