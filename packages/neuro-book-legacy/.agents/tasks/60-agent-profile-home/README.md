# Agent Profile Home

## Relative documents refs

- [Profile Context Memory](../../../reference/agent/profile-context-memory.md)
- [Agent Profile Settings Low Code](../58-agent-profile-settings-low-code/README.md)
- [Workspace Terms](../../../reference/workspace/TERMS.md)

## User Request / Topic

- 增强 profile 自定义设置能力，让类似“抢话策略”“文风预设”这类设置可以使用 profile 自带指令，也允许用户新增、编辑并持久化自己的指令。
- 将现有 `agent-context/{profile-id}/` 语义演进为正式 profile home；新模板默认使用 `{Project Workspace}/agents/{profile-id}/`。
- profile home 由 profile 自己维护，生命周期上升到 `defineAgentProfile()`。
- 讨论是否需要 `defineProfileHome()`，以及 profile home 初始化、升级、重置和文件 API 设计。

## Goal

为 NeuroBook profile 系统设计并实现 profile-owned home 能力：每个 profile 在 Project Workspace 下拥有稳定的 `{Project Workspace}/agents/{profile-id}/` home；profile 可以在 `defineAgentProfile()` 中声明 home 生命周期并维护其中的文件；低代码设置可以基于 profile home 提供“程序控制可用 key / key 内容 + 用户自定义资源”的持久化选择能力。实现后应保持 profile-scoped `context.md`、`memory.md`、`generated.md` 语义，并避免普通 config snapshot 被全量 profile home 初始化拖慢。

## Current State

- `reference/agent/profile-context-memory.md`、Project template、context-access 写入和 profile prompt 已同步到 `agents/{profile}/context.md`、`memory.md`、`generated.md` 和 `.nbook/context-access/{profile}.json` 的边界。
- 旧 Project Workspace 中可能仍存在 `agent-context/`；本任务明确不自动迁移旧项目，后续如需迁移应另开确认式迁移工具。
- `defineAgentProfile()` 已支持 `home: defineProfileHome({init, upgrade, reset})`；Project session runtime、prepare preview 和 Agent Profile 模型完整 settings 面板会按需 ensure profile home。
- 低代码 settings 已支持通用 `resource-preset` 字段，profile 可通过 `defineResourcePreset()` 自定义 resolver，也可用内置 `profileHomeResource()` 读取当前 profile home 下的 Markdown 资源。
- writer settings 已接入 `writingStylePreset`、`writingReferencePreset`、`narrativePerson`；文风与参考样本使用 `resource-preset`，Project scope 下可选择、编辑、新增、重命名和删除非当前资源。

## Decisions / Discussion

- profile home 目录固定为 Project profile home root 下的 `{profile-id}/`；Project profile home root 第一版默认是 `{Project Workspace}/agents`。
- profile 不负责定义物理目录；目录解析、安全路径和 Project Workspace 边界由系统负责。
- profile 负责维护 home 内容，因此 home 能力应上升到 `defineAgentProfile()`，不是 `defineLowCodeForm()` 专属设施。
- 需要 `defineProfileHome()`，但它作为 `defineAgentProfile()` 的子能力存在，不做独立全局注册系统。
- `version` 不放在 `defineProfileHome()` 上，版本上升到 profile 级。第一版倾向使用 profile manifest/version，避免多一条版本轴。
- `upgrade` 参数使用 `(ctx, oldVersion, targetVersion)`。
- 第一版不设计 `snapshot` / `actions` 协议，先直接提供受限文件 API。
- 需要 `reset(ctx)` 生命周期，用于用户手动重置 profile home。
- 文风资源不区分 `builtin/custom` 目录。用户可以直接修改 profile 自带文风。
- 因为用户可以修改自带文风，profile 更新时默认不应无脑覆盖已有文件。内置资源写入应优先支持“仅缺失时写入”。
- 低代码暂不使用 TSX 设计。继续使用结构化低代码 form DTO，复杂 UI 由系统内置组件承载。
- profile 级 version 第一版使用 `manifest.version`，暂不新增 `manifest.homeVersion`。
- `writeText()` 默认采用保守创建语义，避免 profile 更新误覆盖用户修改；需要覆盖时显式传入 options。
- `reset()` 的具体范围由 profile 自己实现；系统只提供 `ctx.home.clear()` 等文件 API，不替 profile 判断哪些文件属于“可重置资源”。
- profile 更新时第一版采用保守策略：补齐缺失文件，不覆盖已有文件。冲突提示 / diff 机制后续再考虑。
- 低代码资源选择组件需要设计为通用组件，不限定文风场景。文风、抢话指令、输出格式模板等都应能复用同一个底层能力。
- profile home 第一版只做 Project Workspace 级，不做 Workspace Root 全局级 profile home。
- Profile home root 第一版固定为 `{Project Workspace}/agents`，不增加配置项。
- profile key 约束为安全 id：`[A-Za-z0-9._-]+`，目录名等于 profile key。
- profile home ensure 触发点第一版限定为：创建/运行该 profile session 前，以及打开该 profile 的完整设置面板时；普通 config snapshot 不触发。
- 通用资源选择组件的 settings value 第一版保存 selected key。对 `profileHomeResource()`，key 默认是 profile home 相对文件路径，例如 `"instructions/user-agency/balanced.md"`。
- 通用资源选择组件允许按 resolver 声明的能力选择、预览、新建、编辑、重命名、删除资源。对 `profileHomeResource()`，这些操作限制在字段声明目录范围内。
- 删除当前 settings 正在引用的 selected key 应被禁止，用户需要先切换到其他资源。
- 资源文件格式第一版只支持 Markdown 文本资源。
- reset 的默认建议语义是清空并重建 profile 声明的资源目录，会删除用户自定义资源；UI 需要明确提示。
- profile 更新后不删除旧资源，只补新增资源，避免误删用户正在使用的文件。
- 通用低代码资源选择组件命名采用 `resource-preset`。
- 旧 `agent-context` 不自动迁移；本任务只调整 Project Workspace template，将 `assets/workspace/.nbook/templates/project-directory-templates/agent-context` 改为新 `agents` 模板。
- `assets/workspace/.nbook/agent/writing-presets` 可删除，writer 文风资源后续应由 profile home 初始化维护。
- 资源展示名优先读取 Markdown frontmatter `title`，没有则由文件名生成。
- 新建资源支持 field 声明 `template`；未声明时创建空 Markdown。
- `resource-preset` 第一版支持编辑 Markdown 正文。
- 资源内容编辑和 profile settings 使用同一个“保存”心智：不在输入时立即写入，前端暂存资源变更，随当前设置保存动作一起提交；取消设置编辑时丢弃暂存变更。
- `resource-preset` 字段声明目录下第一版不允许创建子目录。
- profile home metadata 文件名使用 `home.json`。
- `ctx.home.writeText()` 默认 `mode: "create"`；目标文件已存在时静默跳过，并返回写入结果，例如 `{written: false}`。
- `resource-preset` 需要比“读 profile home 目录”更通用：当前选中的 key、可用 key 和 key 对应内容都应由程序控制，类似 select 的动态 options。
- 第一版允许 profile 自定义 resource resolver 函数；`profileHomeResource()` 只是内置 helper，不是唯一来源。

## Proposed API Shape

```ts
export default defineAgentProfile({
    manifest: {
        key: "writer",
        version: 3,
    },

    home: defineProfileHome({
        async init(ctx) {
            await ctx.home.writeText("styles/light-novel.md", LightNovelStyle, {mode: "create"});
            await ctx.home.writeText("styles/cinematic.md", CinematicStyle, {mode: "create"});
        },

        async upgrade(ctx, oldVersion, targetVersion) {
            if (oldVersion < 3 && targetVersion >= 3) {
                await ctx.home.writeText("styles/new-style.md", NewStyle, {mode: "create"});
            }
        },

        async reset(ctx) {
            await ctx.home.clear();
            await ctx.home.writeText("styles/light-novel.md", LightNovelStyle);
            await ctx.home.writeText("styles/cinematic.md", CinematicStyle);
        },
    }),
});
```

文件 API 第一版倾向：

- `readText(path)`
- `writeText(path, content, options?)`
- `readJson(path, schema?)`
- `writeJson(path, value, options?)`
- `exists(path)`
- `list(path)`
- `move(fromPath, toPath, options?)`
- `remove(path)`
- `clear()`

Project profile home root 默认目录：

- 第一版使用 `{Project Workspace}/agents`。
- 旧 `agent-context` 不自动迁移。
- 本任务实现时更新 Project Workspace template：将 `assets/workspace/.nbook/templates/project-directory-templates/agent-context` 改为 `agents`。

`resource-preset` 第一版用法示例一：使用内置 profile home 文件资源 helper。

```ts
defineLowCodeForm({
    fields: [
        {
            path: "userAgencyPreset",
            component: "resource-preset",
            label: "抢话策略",
            resource: profileHomeResource({
                directory: "instructions/user-agency",
                extension: ".md",
                template: "禁止代替用户做关键决定；可以补充环境和其他角色反应。",
            }),
        },
    ],
});
```

`resource-preset` 第一版用法示例二：profile 自定义 resource resolver。

```ts
const UserAgencyResource = defineResourcePreset({
    contentType: "markdown",
    createKeyPrefix: "instructions/user-agency/",
    createKeySuffix: ".md",

    async list(ctx) {
        const items = await ctx.home.list("instructions/user-agency");
        return items
            .filter((item) => item.kind === "file" && item.name.endsWith(".md"))
            .map((item) => ({
                key: `instructions/user-agency/${item.name}`,
                label: item.title ?? item.name.replace(/\.md$/, ""),
                editable: true,
                deletable: true,
            }));
    },

    async read(ctx, key) {
        return {
            key,
            contentType: "markdown",
            content: await ctx.home.readText(key),
        };
    },

    async create(ctx, input) {
        const key = `instructions/user-agency/${input.slug}.md`;
        await ctx.home.writeText(key, input.content ?? "", {mode: "create"});
        return {
            key,
            label: input.label,
            contentType: "markdown",
            content: input.content ?? "",
        };
    },

    createKey(_ctx, input) {
        return `instructions/user-agency/${input.slug}.md`;
    },

    async update(ctx, key, patch) {
        if (patch.content !== undefined) {
            await ctx.home.writeText(key, patch.content, {mode: "overwrite"});
        }
        if (patch.label !== undefined) {
            const current = await ctx.home.readText(key);
            // updateMarkdownTitle 是 profile 自己实现的 Markdown frontmatter helper。
            await ctx.home.writeText(key, updateMarkdownTitle(current, patch.label), {mode: "overwrite"});
        }
    },

    async rename(ctx, key, input) {
        const nextKey = `instructions/user-agency/${input.slug}.md`;
        await ctx.home.move(key, nextKey, {mode: "create"});
        return {
            key: nextKey,
            label: input.label,
        };
    },

    renameKey(_ctx, _key, input) {
        return `instructions/user-agency/${input.slug}.md`;
    },

    async remove(ctx, key) {
        await ctx.home.remove(key);
    },
});

defineLowCodeForm({
    fields: [
        {
            path: "userAgencyPreset",
            component: "resource-preset",
            label: "抢话策略",
            resource: UserAgencyResource,
        },
    ],
});
```

自定义 resolver 操作定义：

- `list(ctx)`：必需，返回可选择的资源 key 列表，类似 select options。
- `read(ctx, key)`：必需，读取指定 key 的正文，用于预览和编辑。
- `create(ctx, input)`：新建资源，返回新资源 key；如果未定义则 UI 不显示新建入口。
- `createKey(ctx, input)`：新建前解析目标 key。第一版 create 写能力必须同时提供 `createKeyPrefix`、`createKeySuffix` 和 `createKey()`，让前端能用同一套可序列化 key 模板展示暂存资源。
- `update(ctx, key, patch)`：更新资源 label/content；如果未定义则 UI 只读。
- `rename(ctx, key, input)`：修改资源 key 或 label；如果未定义则 UI 不显示重命名入口。
- `renameKey(ctx, key, input)`：重命名前解析目标 key。第一版 rename 写能力必须同时提供 `createKeyPrefix`、`createKeySuffix` 和 `renameKey()`，且结果应与 `createKeyPrefix + slug + createKeySuffix` 一致。
- `remove(ctx, key)`：删除资源；如果未定义则 UI 不显示删除入口。
- `validateKey(ctx, key)`：可选，保存 settings 前校验当前 key；默认可通过 `list()` 检查 key 是否存在。

resolver 输入输出草案：

```ts
type ResourcePresetCreateInput = {
    label: string;
    slug: string;
    content?: string;
};

type ResourcePresetUpdatePatch = {
    label?: string;
    content?: string;
};

type ResourcePresetRenameInput = {
    label: string;
    slug: string;
};
```

settings value 保存当前选中的 key。对于 profile home 文件资源，key 默认就是 profile home 相对文件路径：

```json
{
    "userAgencyPreset": "instructions/user-agency/balanced.md"
}
```

组件行为：

- 打开时通过服务端 resolver 获取当前字段的 `selectedKey`、可用 `options` 和当前 key 对应内容。
- 对 profile home 文件资源，resolver 读取字段声明目录下的 `.md` 文件，以下拉 / combobox 展示。
- 资源展示名优先读取 Markdown frontmatter `title`，否则由文件名生成。
- 选择资源后显示 Markdown 内容预览，并允许编辑正文。
- 新建资源时要求输入名称，并在字段声明目录内创建 `.md` 文件。
- 重命名资源时只允许在字段声明目录内移动文件。
- 第一版不允许在字段声明目录下创建子目录。
- 删除资源时如果该文件正被当前 settings 引用，则禁止删除并提示先切换。
- 保存 profile settings 时只保存 selected key；资源内容的新建、编辑、重命名、删除随当前设置保存动作一起提交给服务端 resolver。
- 服务端校验时确认 selected key 在 resolver 返回的可用 key 中；对于 profile home 文件资源，还要确认路径位于字段声明目录内、扩展名符合声明、文件存在。
- 服务端保存 Project settings 时会先模拟整批 resource mutations 的最终 key 集，再校验 selected key；rename/remove 后的旧 key 不能被写入 config。
- `resource-preset` 的底层协议不绑定文件路径。profile 可以像 select options 一样用程序控制 key 列表和 key 内容；profile home 文件资源只是第一版内置 resolver。
- 第一版自定义 resolver 的 create/rename UI 只支持可序列化 key 模板。缺少 `createKeyPrefix/createKeySuffix` 时，服务端不向前端暴露 create/rename 能力，后端也拒绝对应 mutation。

通用 resource resolver 概念草案：

```ts
type ResourcePresetOption = {
    key: string;
    label: string;
    description?: string;
    editable: boolean;
    deletable: boolean;
};

type ResourcePresetContent = {
    key: string;
    content: string;
    contentType: "markdown";
    updatedAt?: string;
};
```

组件不直接假设 key 是文件路径，只通过 resolver 做：

- `list()`：返回可用 key / label。
- `read(key)`：返回 key 对应内容。
- `create(input)`：创建新 key 和内容。
- `update(key, patch)`：更新 label 或内容。
- `rename(key, nextKey)`：修改 key。
- `remove(key)`：删除 key。

第一版需要把 resource resolver 底层暴露给 profile。`profileHomeResource()` 只是系统内置 helper，profile 也可以自定义 resolver 函数。

自定义 resolver 必须经过服务端执行；前端只拿 DTO 和发起动作，不能执行 profile 函数。

`writeTextIfMissing()` 不单独设计，合并到 `writeText()` 的 options 中，例如：

```ts
await ctx.home.writeText("styles/light-novel.md", text, {mode: "create"});
await ctx.home.writeText("styles/light-novel.md", text, {mode: "overwrite"});
```

`mode` 第一版倾向：

- `mode: "create"`：默认值，仅创建缺失文件；如果文件已存在则保留用户内容。
- `mode: "overwrite"`：显式覆盖，用于 reset 或 profile 作者确认需要强制刷新时。

## Open Questions

- 用户修改自带资源后，profile 更新提供新默认内容时，后续是否需要冲突提示或 diff 机制？第一版先不做。

## Verification / Test

- 已在后端与配置服务 focused tests 中覆盖：
  - 首次 ensure profile home 会调用 `init()` 并写 `home.json`。
  - profile version 提升会调用 `upgrade(ctx, oldVersion, targetVersion)`。
  - reset 会执行 `reset(ctx)` 并刷新 metadata。
  - 文件 API 不能逃逸 `{Project profile home root}/{profile-id}/`。
  - 普通 config snapshot 不触发所有 profile home 初始化。
  - Project settings 保存会先模拟 resource mutations 最终 key，再校验 selected key 和执行资源写入。
  - Global settings 不允许写入 profile home 资源。

## Implementation Walkthrough

- 2026-06-20：创建 task。调研确认现有 `agent-context/{profile}/` 已承担 profile-scoped context/memory/generated recommendation 职责，本任务将其正式提升为 profile home。
- 2026-06-20：用户决策：
  - profile home 由 profile 自己维护，上升到 `defineAgentProfile()`。
  - `defineProfileHome()` 不单独持有 version，version 上升到 profile 级。
  - `upgrade` 接收 `oldVersion` 和 `targetVersion`。
  - 第一版不做 `snapshot/actions`，先提供文件 API，并支持 `reset`。
  - styles 不区分 builtin/custom，用户可以修改自带文风。
  - 低代码暂不使用 TSX 设计。
  - `writeTextIfMissing()` 这类 API 应并入更优雅的 `writeText()` options。
- 2026-06-20：用户继续决策：
  - profile 级 version 使用 `manifest.version`。
  - `writeText()` 默认保守创建，避免覆盖用户修改。
  - `reset()` 由 profile 自己实现具体范围。
  - profile 更新时只补缺失文件，不覆盖已有文件。
  - 低代码资源选择组件必须通用，不限定文风；不仅文风，抢话指令等场景也要复用。
  - 第一版不做完整 profile home 文件管理器，只服务具体低代码资源选择组件。
- 2026-06-20：用户继续决策：
  - profile home 第一版只做 Project Workspace 级。
  - NeuroBook 需要 Project profile home root 设置项，默认目录改为 `{Project Workspace}/agents`。
  - profile key 使用安全 id，目录名等于 profile key。
  - profile home 只在创建/运行该 profile session 前、打开该 profile 完整设置面板时 ensure，普通 config snapshot 不触发。
  - `resource-preset` settings value 保存 selected key；对 `profileHomeResource()`，key 默认是 profile home 相对文件路径。
  - `resource-preset` 允许在字段声明目录内选择、预览、新建、重命名、删除资源。
  - 禁止删除当前 settings 正在引用的资源。
  - 第一版资源格式只支持 Markdown。
  - reset 可删除用户自定义资源，UI 必须明确提示。
  - profile 更新不删除旧资源，只补新增资源。
  - 通用资源选择组件命名采用 `resource-preset`，并需要明确组件行为和用法。
- 2026-06-20：用户继续决策：
  - Project profile home root 默认改为 `{Project Workspace}/agents`。
  - 旧 `agent-context` 不迁移；只调整 `assets/workspace/.nbook/templates/project-directory-templates/agent-context` 模板为新目录。
  - `assets/workspace/.nbook/agent/writing-presets` 可以删除，文风资源改由 profile home 初始化维护。
  - resource 展示名优先 frontmatter `title`，否则使用文件名。
  - 新建资源支持 field `template`。
  - `resource-preset` 支持编辑 Markdown 正文。
  - 资源内容随 profile settings 保存动作一起保存，不做输入时立即持久化。
  - 资源目录第一版不允许子目录。
  - profile home metadata 文件名使用 `home.json`。
  - `writeText()` 默认 create，文件已存在时静默跳过并返回 `{written: false}`。
  - `resource-preset` 应进一步通用化：当前选中的 key、可用 key 和 key 内容都应能由程序控制，类似 select 的动态 options；profile home 文件资源只是第一版内置 resolver。
- 2026-06-20：用户决策：允许 profile 自定义 `resource-preset` resolver 函数，第一版需要把底层能力暴露出来；`profileHomeResource()` 只是内置 helper。
- 2026-06-20：整体审查 task 后收敛：
  - `resource-preset` settings value 统一表述为 selected key；`profileHomeResource()` 的 key 才默认是 profile home 相对文件路径。
  - `list/read` 是 resolver 必需方法，写操作按 resolver 能力可选。
  - 资源变更与 settings 保存使用同一提交动作；前端需要暂存资源变更，取消时丢弃。
  - 移除重复的自定义 resolver 草案，统一使用 `defineResourcePreset()` 示例。
- 2026-06-20：完成第一版实现：
  - 新增 `server/agent/profiles/profile-home.ts`，提供 `defineProfileHome()`、`ctx.home` 受限文件 API、`ensureProfileHome()`、`resetProfileHome()` 和 `home.json` metadata。
  - `AgentProfileManifest.version` 上升为 profile 级版本；runtime prepare、compaction reinject、profile prepare preview 和 Agent Profile 模型完整设置面板会在 Project scope 下 ensure home。
  - 新增 `defineResourcePreset()` 与 `profileHomeResource()`，`resource-preset` DTO 支持 options、当前内容、全量 contents、template 和 create/update/rename/remove 能力声明。
  - LowCodeForm 增加 `LowCodeResourcePresetField.vue`，Project scope 下可选择、预览、编辑、新建、重命名和删除非当前资源；Global scope 禁用资源编辑。
  - Project settings 保存会提交 resource mutations，并校验 selected key；`resourceMutations` 不写入 `.nbook/config.json`；Global settings 保存拒绝 resource mutations。
  - writer profile manifest version 升到 2，文风与参考样本改为 `resource-preset`，默认资源从 `assets/workspace/.nbook/agent/writing-presets` 迁到 `assets/workspace/.nbook/agent/profiles/builtin/writer.home/{styles,references}`，初始化时写入 Project `agents/writer/`。
  - Project template 目录从 `agent-context` 改为 `agents`，profile prompt、context-access 写入和稳定 reference 文档同步到 `agents/{profile}/`。
  - 已运行 `bun run system-assets:prepare`，系统 profile artifacts 重新编译了 5 个 stale profile。
- 2026-06-20：审查后修复 resource-preset 保存边界：
  - `profileHomeResource()` 新建或重命名到已存在 key 时返回字段错误，不再把 `writeText/move` 的 `{written:false}` 当成功，也不会改写目标资源 frontmatter。
  - Project settings 保存改为先用 pending resource key 视图做 settings 校验，校验通过后才真正执行 resource mutations，避免保存失败但 profile home 已落盘。
  - Project scope 下低代码字段切回“继承”时，会同步清除该字段暂存的 resource mutations。
- 2026-06-20：二次审查后继续收紧保存语义：
  - `editor-snapshot` query 增加 `agentProfileSettingsScope=global|project`，前端 Agent Profile 模型面板按当前 tab 显式传入 scope。
  - `saveGlobalConfig()` 固定以 `global` scope 校验/返回 profile settings，不再因为当前目标是 novel Project 而初始化或依赖 Project `agents/{profile}/`。
  - `saveProjectConfig()` 固定以 `project` scope 校验/返回 profile settings。
  - `applyLowCodeResourceMutations()` 增加整批预校验，先模拟 create/update/rename/remove 的 key 变化；若后续 mutation 会失败，前面的 mutation 不会先落盘。
- 2026-06-20：三次审查后对齐 resource resolver 预校验与实际执行：
  - `ResourcePresetDefinition` 增加 `createKey(ctx, input)` / `renameKey(ctx, key, input)`，用于服务端在落盘前解析并校验目标 key。
  - `profileHomeResource()` 的 `create/rename` 与预校验共用同一套 slug sanitize 和 key 生成逻辑，非法 slug 会在预校验阶段返回字段错误。
  - 自定义 resolver 如果缺少对应 key hook，则不会向前端暴露 create/rename 能力，后端也会拒绝对应 mutation，避免无法安全预校验的半成功保存。
- 2026-06-20：四次审查后完成 reset 与最终 key 一致性修复：
  - Project settings 保存改为用 resource mutations 模拟后的最终 key 视图校验 selected key；create 后 rename、rename 旧 key、remove 当前 key 都不会把最终不存在的 key 写入 config。
  - `resource-preset` v1 收紧为：create/rename 写能力需要 `createKeyPrefix/createKeySuffix` 可序列化 key 模板；缺少模板的自定义 resolver 不暴露 create/rename，后端也拒绝 mutation。
  - `agentProfileSettings.agentProfiles[]` 增加 `canResetHome`，前端 Project scope 只在 profile 真声明 `home.reset()` 时展示“重置 Home”按钮。
  - 新增 Project profile home reset API 与 Agent Profile 模型面板入口。重置前弹窗确认，执行 profile 自己的 `reset(ctx)`，然后刷新完整 Project Agent Profile settings snapshot。
- 2026-06-20：继续推进用户侧文档与 resource-preset 暂存体验：
  - 同步 `docs/profile/writer.md`、`docs/profile/leader.md` 和 RP 教程，把旧 `agent-context/`、`agent/writing-presets` 的用户入口改为 `agents/{profile}/` 与 `agents/writer/{styles,references}`。
  - `LowCodeResourcePresetField` 修复本地暂存展示：新建后再重命名不再显示旧临时 key；新建/重命名生成 slug 时会避开当前可见 key，中文标题连续新建不会互相覆盖成同一个 `resource.md`。
- 2026-06-20：继续审计后同步仓库级状态：
  - 修正 `PROJECT-STATUS.md` 中 Project settings 保存顺序描述：当前实现是先模拟整批 resource mutations 的最终 key 并完成校验，通过后才执行资源写入和配置保存。
  - 移除已解决的 Open Question：自定义 resolver action 错误已通过低代码表单 issue / settings 保存 400 映射到字段局部错误。
- 2026-06-20：继续审计 resource-preset mutation 状态机：
  - 补充 `create -> update -> rename` 回归测试，覆盖用户新建资源、编辑正文、再重命名时最终只保留新 key 且正文不丢失的链路。
- 2026-06-20：继续收紧 resource-preset 连续操作：
  - `LowCodeResourcePresetField` 的可见资源列表改为按 mutations 顺序折叠最终状态，避免连续重命名时保留中间 key 的幽灵选项，并保留源资源的 editable/deletable 能力。
  - 补充连续 `rename -> rename -> update` 回归测试，确认服务端最终只保留最终 key，且最终正文按最后 update 落盘。
- 2026-06-20：继续审计资产、模板和 OpenAPI：
  - 确认旧 `assets/workspace/.nbook/agent/writing-presets` 目录已不存在，Project template 已使用 `templates/project-directory-templates/agents/**`。
  - 确认 OpenAPI meta 已包含 `config/profile-home/reset.post.ts`、`canResetHome`、`resource-preset`、`createKeyPrefix/createKeySuffix`。
  - 修正 `server/config/config-service.test.ts` 中过时的测试名，避免继续暗示 Project settings 保存会先落盘 resource mutations。
- 2026-06-20：继续审计活跃 profile / skill 口径：
  - `leader.assets` 的 profile manifest 与 system prompt 从“writing presets”改为“writer 默认 home 资源”，避免用户资产助手继续把旧目录当成当前维护对象。
  - `PROJECT-STATUS.md` 的 user-assets sync 范围同步为 `agent/profiles/builtin/writer.home/**` 默认资源。
  - 已运行 `bun run system-assets:prepare`，刷新内置 profile compiled artifacts。
- 2026-06-20：收口 reset UI/API 与当前文档口径：
  - 复查 Project profile home reset route、DTO、config service、前端 API 与 Agent Profile 模型面板入口，确认 reset 只在 Project scope 且 profile 声明 `home.reset()` 时开放，执行后刷新完整 Project Agent Profile settings snapshot。
  - 修正 `server/agent/profiles/profile-dsl.ts`、`docs/profile/leader.md`、`docs/profile/other-profiles.md`、`reference/agent/profile-routing.md` 的当前说明，把旧 writing presets 口径改为 profile 默认 home 资源。
- 2026-06-20：修复设置页交互与 writer settings Global 校验：
  - 设置中心切换配置目标、设置分区、Project target 或关闭弹窗时不再因为 dirty 草稿弹出“请先保存设定”；loading/saving 中仍阻止切换。
  - writer settings Global/no-home 校验同时接受 legacy preset key 与 profile home key，修复全局配置中已有旧 key 时显示“选择的文风预设不存在”的问题。
  - Agent Profile 模型面板将“Profile 预设”改为“Profile 设置”，删除说明行，并给低代码设置区和 `resource-preset` Markdown 文本域增加紧凑高度限制。
- 2026-06-20：继续修正 `resource-preset` 可用性与高度：
  - Global Config 下不再展示 Profile 设置，避免 resource-preset 在无 Project profile home 时显示空 select / textarea；保存 Global 模型配置时保留已有 profile settings，不因隐藏 UI 清空旧配置。
  - Project Config 下 `LowCodeResourcePresetField` 改为默认折叠：顶部只显示资源选择、摘要、“新建”和“编辑/收起”；Markdown textarea 只在展开后显示。
  - 新建自定义资源入口放在 select 旁按钮中，点击后展开创建表单；创建后自动选中新资源并展开编辑区。
  - 前端显示层兼容 legacy selected key，例如把 `darkside-kitten.beileng-special` 映射到 `styles/darkside-kitten.beileng-special.md` 展示，不改变存储协议。
- 2026-06-20：继续优化 `resource-preset` 布局与 legacy 校验：
  - 低代码服务端 `resource-preset` 校验会把无目录的 legacy key 作为候选资源 key 校验，例如 `plain` 同时尝试 `styles/plain.md`，修复 Project 继承旧 Global key 时报“资源不存在”的问题。
  - `LowCodeResourcePresetField` 的摘要行改为原地展开：折叠时显示一行摘要，点击“编辑”后同一块区域变成 Markdown textarea。
  - 删除 Project scope 字段下方的“当前继承值”提示，减少重复信息和视觉噪音。
- 2026-06-20：Profile 设置去继承化与 resource-preset UI 收口：
  - `LowCodeForm` 增加 `inheritanceMode="always-override"`，Agent Profile 模型面板的 Project Profile 设置不再展示“继承/覆盖”，字段默认可编辑并按项目级完整 settings 保存。
  - Project scope 克隆服务端 effective `settings.value` 作为编辑草稿，保存时写入 form fields 的完整当前值；Profile 模型参数自身的继承/默认模型逻辑不变。
  - `LowCodeResourcePresetField` 的资源选择和删除目标选择改用 common `FormSelect`，继续支持选择内置资源、新建自定义资源、重命名、删除非当前资源和随 settings 保存提交 mutations。
  - resource-preset 折叠预览只隐藏 Markdown frontmatter；展开编辑区仍编辑完整原始 Markdown，避免隐式丢失 metadata。
- 2026-06-21：继续压缩 Project Profile 设置布局：
  - Agent Profile 模型面板移除 Profile 设置区域外层 `max-height` 与内部滚动条；resource-preset 已可折叠，不再需要双层滚动。
  - `LowCodeResourcePresetField` 将“编辑”按钮改为“展开/收起”，并移动到资源摘要块右侧；select 行只保留资源选择与新建入口。
- 2026-06-21：resource-preset 改为轻量资源管理器：
  - 顶部选择行只保留当前资源选择和“管理”入口，避免新建、重命名、删除散落在编辑器周围。
  - “管理”展开后显示资源列表、当前资源标记、新建与重命名当前资源入口；删除动作放到资源行右侧，并继续禁止删除当前 selected key。
  - 新建和重命名改为 `Dialog` 表单，不再在组件原位置插入 input，创建成功后自动选中新资源并展开 Markdown 编辑区。
- 2026-06-21：resource-preset 进一步整合为完整资源管理器：
  - 移除外部“管理”开关，把资源选择、资源列表、当前资源摘要、展开式 Markdown 编辑区都放进同一个管理器面板。
  - 管理器顶部负责新建和重命名当前资源，资源列表负责切换与删除，右侧编辑区负责当前资源内容预览/编辑，减少三段式布局割裂。
- 2026-06-21：resource-preset 管理器改为紧凑可收起：
  - 默认只显示一行资源选择、关键动作和“管理”展开按钮，避免设置页初始状态占用过高。
  - 展开后才显示资源列表与当前资源编辑区；资源列表高度压缩到 190px，Markdown 编辑器默认高度压缩到 150px。
- 2026-06-21：resource-preset 管理器继续收紧操作层级：
  - 收起态只保留资源选择与“管理/收起”，新建和重命名当前资源移入展开后的管理区。
  - 管理区展开后直接显示当前资源编辑器，移除编辑区内部的二级“展开/收起”按钮。
  - 管理器外层从 `overflow-hidden` 改为 `overflow-visible`，避免收起态 `FormSelect` 下拉层被管理器边界裁切。
- 2026-06-21：resource-preset 管理器移除右侧摘要行：
  - 删除当前资源编辑区上方的正文摘要展示，展开管理区后直接显示 Markdown 文本域。
  - 同步移除 `selectedSummary` 与 frontmatter 摘要剥离逻辑，减少组件内只服务展示摘要的状态。
- 2026-06-21：resource-preset 编辑区高度对齐：
  - 管理器展开后左右两列使用同高布局，右侧 Markdown textarea 填满当前编辑区高度，避免文本域底部和外层盒子高度不匹配。
- 2026-06-21：resource-preset 资源列表高度对齐：
  - 管理器展开区设置最小高度，左侧资源列表改为填满同高网格并在内部滚动，避免列表栏底部和右侧编辑区/外层盒子高度不一致。

## Validation

- `bun test server/agent/profiles/profile-home.test.ts`：通过。
- `bun test server/low-code-form/low-code-form.test.ts`：通过。
- `bun test server/agent/context-access/profile-context-access.test.ts`：通过。
- `bun test server/config/config-service.test.ts -t "Agent Profile settings|resource mutations|Global 保存拒绝 resource"`：通过。
- `bun test server/low-code-form/low-code-form.test.ts server/config/config-service.test.ts -t "resource mutations|settings 校验失败"`：通过，覆盖 source 与 `product/server/...` 镜像测试。
- `bun test server/config/query.test.ts server/low-code-form/low-code-form.test.ts server/config/config-service.test.ts -t "Agent Profile settings scope|Agent Profile settings|resource mutations|settings 校验失败|Global 保存完整|includeAgentProfileSettings|scope"`：通过，覆盖 source 与 `product/server/...` 镜像测试。
- `bun test server/low-code-form/low-code-form.test.ts server/config/config-service.test.ts -t "resource mutations|自定义 resolver|settings 校验失败|Global 保存完整"`：通过，覆盖 source 与 `product/server/...` 镜像测试。
- `bun test server/low-code-form/low-code-form.test.ts -t "连续重命名|新建后编辑再重命名|resource mutations"`：通过，覆盖 resource-preset 新建、编辑、重命名与连续重命名组合链路。
- `bun test server/low-code-form/low-code-form.test.ts server/config/config-service.test.ts -t "resource mutations|key 模板|最终 key|重置 profile home|Global 保存完整"`：通过；继续审计后再次运行仍通过，覆盖 source 与 `product/server/...` 镜像测试。
- `bun run system-assets:prepare`：通过，刷新系统变量定义和系统 profile artifacts。
- `bun test server/agent/profiles/leader-assets-profile.test.ts -t "leader.assets|profile-system-guide|writer settings" --timeout 30000`：通过。
- `bun test server/agent/profiles/leader-assets-profile.test.ts -t "leader.assets 从 assets|writer settings" --timeout 30000`：通过。
- `bun test server/agent/profiles/rp-profiles.test.ts -t "rp.leader|rp.writer" --timeout 30000`：通过。
- 上述 focused tests 均覆盖对应 `product/server/...` 镜像测试副本。
- `bun run generate:openapi`：命令返回成功并刷新 39 个 route meta；脚本仍报告 24 个既有 plot route 文件缺失。
- `bun test server/config/config-service.test.ts -t "resource mutations|重置 profile home|includeAgentProfileSettings|Global 保存完整"`：通过，覆盖 reset API service、resource mutations 与 Global/Project 边界。
- `bun test server/agent/profiles/leader-assets-profile.test.ts -t "writer settings" --timeout 30000`：通过；新增覆盖 writer settings Global scope 下 legacy key 和 profile home key 均可通过校验。
- `bun run system-assets:prepare`：通过；刷新系统变量定义并编译 1 个 stale writer profile artifact。
- `bun test server/low-code-form/low-code-form.test.ts -t "resource-preset|resource mutations"`：通过；确认前端折叠改造未改变 resource-preset DTO 与服务端 mutation 语义。
- `bun test server/low-code-form/low-code-form.test.ts -t "resource-preset|resource mutations"`：通过；新增覆盖 legacy key 可映射到 `createKeyPrefix/createKeySuffix` 资源 key。
- `bun run typecheck`：通过；验证 Global 隐藏 Profile 设置、resource-preset 折叠 UI 与保存 payload 类型正确。
- `bun run typecheck`：通过；验证 Vue resource-preset 暂存逻辑、reset UI/API 类型和状态文档同步未引入类型问题。
- `bun run typecheck`：未通过，失败集中在未触及的 `app/components/novel-ide/world-engine/workbench-preview/WorldEngineWorkbenchPreviewMutationEditor.vue`，缺少 `issueBehaviorDescription`、`mutationContextBeforeValue`、`mutationContextAfterValue` 等属性；本轮改动相关 focused tests 已通过。
- `bun test server/low-code-form/low-code-form.test.ts -t "resource-preset|resource mutations"`：通过；确认 resource-preset UI 调整未改变资源 resolver / mutation 服务端语义。
- `bun test server/config/config-service.test.ts -t "Agent Profile settings|resource mutations|includeAgentProfileSettings"`：通过；确认 Agent Profile settings DTO、resource mutations 与按需加载相关服务端行为仍正常。
- `bun run typecheck`：通过；验证 `LowCodeForm` always-override 模式、Agent Profile Project settings 完整保存形态和 `FormSelect` 接入类型正确。
- `bun run typecheck`：最终复跑未通过，失败集中在未触及的 `server/api/novels/index.post.ts:120`，报 `Cannot find name 'pinyin'`；本轮 focused tests 仍通过。
- `bun run typecheck`：通过；验证 Profile 设置区移除外层滚动和 resource-preset 展开按钮移动未引入类型问题。
- `bun run typecheck`：通过；验证 resource-preset 资源管理器布局、Dialog 新建/重命名/删除确认和列表操作未引入类型问题。
- `bun run typecheck`：通过；验证 resource-preset 完整资源管理器整合后类型正确。
- `bun run typecheck`：通过；验证 resource-preset 紧凑折叠布局未引入类型问题。
- `bun run typecheck`：通过；验证新建/重命名合并进管理区、移除编辑区二级展开和 select 裁切修正未引入类型问题。
- `bun run typecheck`：通过；验证移除 resource-preset 摘要行和相关逻辑未引入类型问题。
- `bun run typecheck`：通过；验证 resource-preset 编辑区高度对齐样式未引入类型问题。
- `bun run typecheck`：通过；验证 resource-preset 左侧资源列表高度对齐样式未引入类型问题。

## TODO / Follow-ups

- 资源冲突提示 / diff 机制第一版暂不做，后续如果多个设置窗口并发编辑再补。
- 后续如需删除当前 selected key，需要先设计“切换 selected key + 删除旧 key”的更完整 UI 流程；当前前端只允许删除非当前资源。
- 旧项目的 `agent-context` 不自动迁移；如需要批量迁移，另开任务设计用户确认式迁移工具。
