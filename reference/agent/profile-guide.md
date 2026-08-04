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

需要每轮结构化调用载荷时声明 `payloadSchema`。需要结构化结果时声明 `outputSchema`。需要 profile 自定义默认预设时声明 `settingsForm`，运行时通过 `ctx.settings` 读取合并后的设置；settings 不属于创建期 initial，也不属于单次 invocation payload。静态 profile 存在 `outputSchema` 时，`report_result.data` 是结构化输出的 runtime 校验依据，provider-visible schema 中该字段保持 optional，方便任务失败或只返回可读错误说明时仍能结束 run。`adhoc` profile 的 `initial.outputSchema` 是 session 级调用方合同，声明后 provider-visible schema 中的 `data` 必填，缺失会由 `report_result` 执行层拒绝。

`tools` 是 profile 的根工具绑定对象，决定模型可见工具 schema 和 profile 最大执行权限。推荐用 `toolset(builtin...)` 显式声明工具集合；需要定制 `report_result.data` schema 时使用 `builtin.result.main({ dataSchema: OutputSchema })`。需要收窄执行权限时声明顶层 `toolKeys`，它只能引用根 `tools` 中已有的 key。

检索、反思、维护等独立工作应由普通 agent invocation、Agent Workflow 和后台 Job 显式编排。

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

### Authoring imports

Profile 的基础公开入口是 `nbook/profile-sdk`。需要读取文风/参考预设或构造对应提示词时，显式从正式子入口 `nbook/profile-sdk/writing` 导入；不需要 writing 能力的 Profile 不应导入它，以免把 Zod/YAML 等 writing host graph 重复打入每个 artifact。

```ts
import {Type, defineAgentProfile} from "nbook/profile-sdk";
import {buildWritingStyle, DEFAULT_WRITING_STYLE_PRESET} from "nbook/profile-sdk/writing";
```

除该精确子入口、Profile root 内相对模块和 Runtime builtin 外，不允许导入其他 SDK subpath、`server/**` 或任意第三方 npm package。`typebox` 是 SDK implementation，不是作者 Interface。

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
import {Type, defineLowCodeForm} from "nbook/profile-sdk";

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
- 合并 stored patch 时忽略 `defaults` 未声明的顶层 key：字段下线后，旧存档残留不会导致校验失败或整份 settings 回退默认。
- 组件：`text`、`textarea`、`number`、`switch`、`select`、`combobox`、`radio`、`checkbox`。

第一版限制：

- `field.path` 只支持 settings 对象的顶层字段，不支持 dot path nested merge。
- `checkbox` 表示多选复选框组，值必须是数组，option value 只支持 `string | number`。
- `switch` 表示单个 boolean。
- `combobox` 只能选择 options 中的值，不允许自由输入。

Config 层保存 `agent.profiles[profileKey].settings` patch。Global patch 覆盖 profile defaults；Project patch 覆盖 Global，并在 Project UI 中展示字段级“继承 / 覆盖”。保存时服务端会执行 schema、options 和自定义校验；运行时如果读到损坏 settings，会回退 defaults 并记录 warning，避免 profile 不可用。

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
                <WorkspaceFocusReminder />
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
- `If`
- `Fragment`

非空文本必须放在支持 string 的节点内，例如 `System` 或 `Message`。不要在 `ProfilePrompt` 顶层放裸文本。

压缩（compaction）与摘要策略不是 TSX 节点，写在 `defineAgentProfile({runtimeDefaults: {...}})` 里。

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

V1 只允许 `AGENTS.md`、`reference/**` 和 `docs/**`。不要用 `Import` 读取 Project Workspace 文件；项目内容应通过 agent 文件工具、workflow/job 或其他显式 runtime 注入读取。

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

- `WorkspaceFocusReminder`
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
/** @jsxImportSource nbook/profile-sdk */
/** @jsxRuntime automatic */
import {
    AppendingSet,
    HistorySet,
    Import,
    Message,
    ModelContext,
    ProfilePrompt,
    SkillCatalog,
    System,
    Type,
    WorkspaceFocusReminder,
    builtin,
    defineAgentProfile,
    toolset,
} from "nbook/profile-sdk";

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
                    <WorkspaceFocusReminder />
                </AppendingSet>
            </ProfilePrompt>
        );
    },
});
```

## Profile-Owned Tool

profile 可以用 `defineProfileTool()` 定义自带工具，并把 definition 本身放进根 `tools`。自带工具的 key 只在当前 profile run 内解析，不会注册进全局 registry。

```ts
import {Type, builtin, defineProfileTool, toolset} from "nbook/profile-sdk";

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
- `tools` 是否是 profile 最大工具集合；顶层 `toolKeys` 是否只是它的子集。
- 独立工作是否由普通 agent invocation、workflow 或后台 Job 显式编排。
- `System` 是否只放 profile 身份、职责和长期行为边界。
- `HistorySet` 是否只放稳定前缀。
- 共享规范是否用 `Import` 引用，而不是复制长 prompt。
- `ModelContext` 是否只放本轮模型可见、不需要持久化的上下文。
- `AppendingSet` 是否贴近当前输入，Reminder 顺序是否合理。
- 动态焦点是否通过明确的 runtime reminder 或 `ctx.invocation.clientState` 表达。
- 新 TSX 节点是否有定向测试覆盖。
- profile 是否可通过 `profile check <file> --system` 或对应用户 Profile check。
