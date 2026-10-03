---
name: tsx-profile-editing
description: 编辑 Neuro Book TSX Agent Profile，包括 builtin 覆盖、自定义 agent、TypeBox schema contract、ProfilePrompt DSL、编译检查和预览。
---

# TSX Profile Editing

用于创建、修改、诊断 `workspace/.nbook/agent/profiles/**/*.profile.tsx` 或系统 `assets/workspace/.nbook/agent/profiles/**/*.profile.tsx`。普通修改优先写用户覆盖层；只有用户明确要求维护系统内置资源时才改 `assets/workspace/.nbook/...`。

## 模块契约

Profile 文件应显式导出：

- `profileManifest`：包含 `key`、`name`、可选 `description`、可选 `version`（正整数，递增触发 profile home upgrade）。
- `InitialSchema`：TypeBox 创建期初始化 schema。普通 agent 可用 `Type.Object({})`。
- `PayloadSchema`：可选。TypeBox 单次 invocation payload schema；只有需要 `invoke_agent.input` 时声明。
- `OutputSchema`：TypeBox 输出 schema。空对象 schema 表示没有额外结构化字段。
- `SettingsSchema` 与设置表单：可选。声明 `settingsForm` 时通常同时导出 `SettingsSchema` 和 `defineLowCodeForm(...)` 的表单对象，运行时通过 `ctx.settings` 读合并值。
- `Initial` / `Payload` / `Output` / `Settings`：用 `Static<typeof ...Schema>` 推导的类型别名。
- `default`：`defineAgentProfile({...})` 返回值。

推荐新文件使用 `defineAgentProfile`：

```tsx
import {builtin, toolset} from "nbook/server/agent/profiles/profile-tools";

export default defineAgentProfile({
    manifest: profileManifest,
    initialSchema: InitialSchema,
    outputSchema: OutputSchema,
    tools: toolset(
        builtin.file.read,
    ),
    context(ctx) {
        return <ProfilePrompt>...</ProfilePrompt>;
    },
});
```

可选成员（按需声明）：

```tsx
import {defineLowCodeForm, profileHomeResource} from "nbook/server/low-code-form";
import {defineProfileHome} from "nbook/server/agent/profiles/profile-home";

export default defineAgentProfile({
    // ...同上...
    // 低代码设置表单：字段定义在源码，值存 config.json 的 agent.profiles.<key>.settings，
    // 运行时 ctx.settings 是 defaults -> Global -> Project 的合并结果。
    settingsForm: defineLowCodeForm({
        schema: SettingsSchema,
        defaults: {customTopSystemPrompt: ""},
        fields: [{path: "customTopSystemPrompt", component: "textarea", label: "置顶提示词"}],
    }),
    // profile home：默认资源目录（全局 workspace/.nbook/agents/{key}/，项目 {project}/agents/{key}/）。
    // manifest.version 递增触发 upgrade；writeText 用 mode: "create" 只补新增不覆盖用户文件。
    home: defineProfileHome({
        async init(ctx) { await ctx.home.writeText("personas/default.md", "...", {mode: "create"}); },
        async upgrade(ctx) { /* 同 init，补齐新增默认资源 */ },
        async reset(ctx) { await ctx.home.clear(); /* 再执行 init 逻辑 */ },
    }),
    // skill catalog 可见性白名单：prepare 时 ctx.skills 只保留列表内 key，SkillCatalog 随之收窄。
    // 只是可见性过滤，不是文件级权限隔离。
    skills: {include: ["profile-system-guide"]},
});
```

`tools` 里可以展开预定义的工具捆绑（bundle），例如 Plot 读写组：`toolset(builtin.file.read, ...plotReadBindings, ...plotWriteBindings)`；bundle 从 `nbook/server/agent/profiles/profile-tools` 导入。

## Builtin 限制

覆盖 `leader.default`、`leader.assets`、`writer`、`retrieval` 时，不允许修改 `key`、`InitialSchema`、`PayloadSchema`、`OutputSchema`。可以修改 prompt、helper function、根 `tools` 绑定和主路 `toolKeys`。

系统 builtin 和用户覆盖必须共用同一个 schema contract。遇到 `builtin_schema_locked` 时，解释为“可以改行为和提示词，但不能把创建参数或输出协议换成另一种形状”。

## 常用节点

- `ProfilePrompt`：profile 根节点。
- `System`：provider 级系统提示，不显示为普通聊天消息。
- `HistorySet`：稳定历史前缀。
- `ModelContext`：本轮模型可见但不写入 session 的上下文。
- `AppendingSet`：追加到当前轮附近的上下文。
- `Message`：模型消息。
- `Reminder`、`Watch`：运行时提醒与状态观察。
- `AgentCatalog`：可创建/调用的 agent profile 索引和 schema 摘要。
- `SkillCatalog`、`ActivatedSkills`：skill 目录与显式提到 skill 的提醒。当前没有独立 skill 工具，需要按 catalog location 用 `read` 打开 `SKILL.md`。
- `If`：条件渲染。

`ctx.initial` 是 profile 创建输入，`ctx.invocation.payload` 是本轮结构化 payload；浏览器状态由需要它的 runtime reminder 直接读取 `ctx.invocation.clientState`。

自动摘要与单文件 diff 上限是所有 Profile 共用的运行设置，不属于 `settingsForm`。`summarizer` 顶层声明只定义执行策略；`<FileChangeNotice>` 只声明 `mode`，不要传 `diffMaxChars`。

## 工作流

1. 读取目标 `.profile.tsx`。
2. 做最小 TSX 修改，不把当前对话临时要求硬编码成长期提示词。
3. 保存文件。
4. 修改单个 profile 后优先让用户在 Workbench 编译/预览，或用 Agent runtime `profile` CLI 验证；项目根 `scripts/` 是开发者脚本，不作为 Agent runtime 合同。
5. 用 `profile check` 做契约检查，`profile preview` 查看 prepare 后的 context，`profile compile` 写入 `.compiled` runtime artifact。
6. 需要 Project Workspace 上下文时，给 `profile check/compile/preview` 传 `--project <projectPath>`。
7. 修改 `settingsForm` 字段定义或 `home` 生命周期后同样需要编译；之后在设置界面的 Agent Profile 面板确认表单渲染，或用首次 prepare / 设置面板验证 home init/upgrade 生效。
8. 调坏 builtin 覆盖时，用工作台恢复系统版本。

保存成功不代表 profile 可运行。`.profile.tsx` 是源码真相源，`.compiled` 是 runtime 真相源；runtime catalog、创建 session 和 invoke 不会自动编译源码。

## 安全边界

动态 profile 是可信本地代码，不做 sandbox。不要直接运行陌生来源 profile；如果用户要导入第三方 profile，先审查源码、工具权限、schema contract 和提示词行为。

不要把当前对话里的临时偏好、一次性路径或个人要求写进长期 profile / skill，除非用户明确要求长期保存。
