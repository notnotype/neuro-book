# Profile Variable Types

> 2026-07-11 当前状态：变量类型生成、definition artifact、`ctx.vars` 与三个全局 Agent variable tools 继续保留；`Variable` / `VariableSchema` TSX helper、`builtin.variable` Profile 绑定和 Workbench 变量插入已暂时下线。Workbench 只读展示 schema/runtime 数据。本文其余内容保留类型系统建设历史。

> Active task directory format: `NN-kebab-case-name/`. Archived tasks move to `docs/tasks/archived/<task-slug>/`.

## User Request

- 为 Agent 变量系统设计类型自动生成方案，让 TSX Profile 编辑时能获得变量 path 补全和返回值类型提示。
- 重点覆盖已经存在的 `client/global/project/session` scope：
    - `client.*` 内建前端状态变量。
    - `global.*` Workspace Root 级自定义变量。
    - `project.*` Project Workspace 级自定义变量。
    - `session.*` profile 自定义变量。
- 评估是否借鉴 TSX Profile `.compiled` 的方式，为变量 definition 生成 `.d.ts` 或类似 `.compiled` 的类型产物。
- 明确用户可以得到什么，以及后续方向是什么。

## Goal

- 让 profile 作者在 `.profile.tsx` 中写变量 path 时有自动补全，减少字符串拼错、scope 混用和 schema 误解。
- 让 `ctx.vars.get("...")` / `ctx.vars.read("...")` 对已知变量返回更具体的 TypeScript 类型；未知动态 path 仍保留 `JsonValue | undefined` fallback。
- 让 `<Variable path="...">`、`<VariableSchema paths={[...]}>`、`watchPath="..."` 这类 DSL 属性获得同一套变量 path 类型提示。
- 保持运行时真相源不变：变量 definition、registry、storage 和 runtime schema 校验仍是真相；generated type 只是 authoring aid。
- 支持 scope-aware 类型生成：builtin/client、Workspace Root/global、Project Workspace/project、profile/session 可以分层生成和组合。

## What You Get

- **Profile 写作体验更稳**：输入 `client.`、`project.`、`session.` 时能看到已注册变量 path，避免靠记忆写字符串。
- **返回值类型更准**：`await ctx.vars.get("client.currentProjectWorkspace")` 可以推导为 `string | null | undefined`，而不是笼统的 `JsonValue | undefined`。
- **自定义变量也能提示**：`workspace/.nbook/agent/variables/definitions.ts`、`workspace/{project}/.nbook/agent/variables/definitions.ts` 和 profile 内 `variableDefinitions` 里的变量都可以进入类型索引。
- **错误更早暴露**：拼错 path、引用未注册变量、把 `project.*` 写成 `global.*` 这类问题，可以在编辑期或 profile check 阶段提前发现。
- **不牺牲动态能力**：运行时仍允许高级 profile 用动态字符串访问变量；这类访问只降级为通用类型，不阻塞编译。
- **Workbench / Profile Editor 可复用**：同一份类型索引后续可以驱动变量选择器、schema 面板、补全列表和 profile diagnostics。

## Current State

- 变量 namespace 已固定为 `client/global/project/session`。
- 变量定义入口已经存在：
    - `defineClientVariable`
    - `defineWorkspaceRootVariable`
    - `defineProjectVariable`
    - `defineSessionVariable`
- 运行时 registry 已能合并：
    - 内建 `client.*` definitions。
    - Workspace Root `.nbook/agent/variables/.compiled` 中的 `global.*` definitions。
    - 当前 Project Workspace `.nbook/agent/variables/.compiled` 中的 `project.*` definitions。
    - profile artifact 中的 `session.*` `variableDefinitions`。
- 变量 definition 已有 `.compiled` 合同：runtime 只加载 hash 匹配的 artifact，不自动编译源码。
- `ProfileVariableAccessor` 已保留字符串 fallback，并为已知变量 path 增加 typed overload：
    - `get<P extends ProfileVariablePath>(path: P): Promise<ProfileVariableValueMap[P] | undefined>`
    - `get(path: string): Promise<JsonValue | undefined>`
    - `read<P extends ProfileVariablePath>(path: P): Promise<TypedVariableReadResult<ProfileVariableValueMap[P]>>`
    - `read(path: string): Promise<VariableReadResult>`
- `client.studio` / `client.ide` 在 registry 中保留 `Record<string, Unknown>` 宽松 root，同时已按当前 `buildAgentClientState()` 快照拆出精确 leaf definitions，例如 `client.studio.selectedFilePath`。

## Design

### 1. 类型生成是派生产物

- 不新增第二套变量真相源。
- 类型生成从现有 definition registry / compiled artifact / profile `variableDefinitions` 派生。
- 生成物可以删除并重新生成；runtime 不依赖 generated `.d.ts`。
- `profile check` / `profile compile` 可以在必要时读取 generated types，但不能因为 type 文件缺失而改变 runtime registry 语义。

### 2. 生成 Path -> Value Map

推荐核心类型形态：

```ts
export interface ProfileVariableValueMap {
    "client.currentProjectWorkspace": string | null;
    "client.studio.selectedFilePath": string | null;
    "project.affections": Record<string, number>;
    "session.draftGoal": string;
}

export type ProfileVariablePath = keyof ProfileVariableValueMap & string;
```

然后让 `ProfileVariableAccessor` 支持 overload：

```ts
get<P extends ProfileVariablePath>(path: P): Promise<ProfileVariableValueMap[P] | undefined>;
get(path: string): Promise<JsonValue | undefined>;
```

`read()` 第一版可以只把 `value` 字段类型化：

```ts
read<P extends ProfileVariablePath>(path: P): Promise<TypedVariableReadResult<ProfileVariableValueMap[P]>>;
read(path: string): Promise<VariableReadResult>;
```

### 3. 分层生成

- **Builtin/client types**
    - 从 `builtinVariableDefinitions()` 和前端 `ClientStateSnapshotDto` / `NovelIdeClientVariablesInput` 生成或手动维护第一版。
    - 建议先把常用 leaf 显式注册为内建变量，避免 `client.studio` 的 `Record<string, Unknown>` 吞掉具体类型。
- **Workspace Root/global types**
    - 从 `workspace/.nbook/agent/variables/.compiled/manifest.json` 与 artifact 导出的 definitions 生成。
    - 产物位于 `workspace/.nbook/agent/variables/.compiled/*.types.d.ts`，文件名随 artifact hash 变化。
- **Project Workspace/project types**
    - 从 `workspace/{project}/.nbook/agent/variables/.compiled/manifest.json` 与 artifact 生成。
    - 产物位于 `workspace/{project}/.nbook/agent/variables/.compiled/*.types.d.ts`，文件名随 artifact hash 变化。
    - 只有在编辑某个 Project Workspace 绑定的 profile 或执行 project-aware check 时注入。
- **Profile/session types**
    - 从 profile artifact 的 `variableDefinitions` 生成。
    - 产物可以随 profile compiled artifact 放在 profile `.compiled` 下，也可以在 profile check 时临时生成。

### 4. TSX Profile 编译注入

- `profile check` / `profile compile` 在构造 TypeScript Program 前准备一个 generated type entry。
- 对 builtin profile：注入 builtin/client + profile/session 类型，默认不注入某个 Project Workspace 的 project types。
- 对 Project Workspace 里的编辑场景：可以额外注入当前 Project Workspace 的 project types。
- 对 user-assets profile：注入 Workspace Root/global + profile/session；除非有明确 current project，否则不注入 project types。

### 5. DSL 属性也复用 path 类型

- 为 `Variable`、`VariableSchema`、`Reminder.watchPath` 等声明泛型或 typed prop：
    - `path?: ProfileVariablePath | string`
    - `paths?: readonly ProfileVariablePath[] | readonly string[]`
- 第一版以补全为主，不强制禁止动态字符串。
- 后续可在 `profile check --strict-variables` 中把 literal path 未注册提升为 error。

## Implementation Plan

### Phase 1. 类型基础设施

- 新增 `server/agent/variables/generated-types.ts` 或同等模块：
    - 将 `VariableDefinition[]` 转成 `ProfileVariableValueMap` 文本。
    - 支持 TypeBox 常用子集到 TypeScript type 的转换。
    - 对无法稳定转换的 schema 降级为 `JsonValue` 或 `unknown`，并在 diagnostics 中提示。
- 为 `ProfileVariableAccessor` 增加可扩展 map 类型和 overload。
- 增加测试覆盖：
    - `Type.String()` -> `string`
    - `Type.Union([Type.String(), Type.Null()])` -> `string | null`
    - `Type.Record(Type.String(), Type.Number())` -> `Record<string, number>`
    - object / array / literal / boolean / number 的基础转换。

### Phase 2. 变量 definition 类型产物

- 扩展 variable definition compile 流程：
    - 在 `.compiled/manifest.json` 旁生成 `types.d.ts`。
    - manifest 记录 type artifact hash / bytes，便于 stale 检查。
- 更新 `scripts/variable.ts definition compile`：
    - 编译 runtime artifact。
    - 同步生成 type artifact。
    - `status` 输出 type artifact 是否缺失或过期。
- Workspace Root/global 与 Project/project definition 共用同一套生成器。

### Phase 3. Profile session types

- 扩展 profile artifact compiler：
    - 读取 profile 导出的 `variableDefinitions`。
    - 为当前 profile 生成 session variable type map。
- `defineAgentProfile` 类型不强制用户手写复杂泛型，优先让 compiler 从实际导出对象提取 definitions。
- `profile check` 对同一 profile 源码注入它自己的 session variable types。

### Phase 4. Profile authoring 接入

- 更新 profile check / compile CLI 的 TypeScript Program root：
    - 加入 generated variable `.d.ts`。
    - 加入 workspace/global type artifact。
    - 在 project-aware 模式加入 project type artifact。
- 更新 DSL public types：
    - `Variable`
    - `VariableSchema`
    - `Reminder.watchPath`
    - `ProfileVariableAccessor`
- 首版不接入 Workbench UI；Workbench 变量选择器和 Inspector path 补全进入后续方向。

### Phase 5. Strict diagnostics

- 增加可选 strict mode：
    - literal path 未注册时报错。
    - `project.*` 在无 current Project Workspace 的 check 场景中提示不可解析。
    - `client.studio.*` 这类落在 `Unknown` record 下的 leaf path 提示类型不精确。
- 默认模式保持温和：提供补全和 warning，不破坏动态 profile。

## TypeBox Mapping Policy

- 稳定支持：
    - `String` -> `string`
    - `Number` / `Integer` -> `number`
    - `Boolean` -> `boolean`
    - `Null` -> `null`
    - `Literal` -> literal type
    - `Array<T>` -> `Array<T>`
    - `Object` -> object literal type
    - `Record<string, T>` -> `Record<string, T>`
    - `Union` -> `A | B`
    - `Intersect` -> `A & B`，仅限简单 object / record
- 保守降级：
    - recursive schema
    - conditional schema
    - complex `$ref`
    - unsupported patternProperties
    - transform / custom keywords
- 降级时仍注册 path，但 value type 使用 `JsonValue` 或 `unknown`，并把原因写入 type generation diagnostics。

## Decisions

- 类型补全不改变变量系统运行时真相源。
- 不把 generated `.d.ts` 当成 runtime 依赖；runtime 仍只读 registry 和 `.compiled` runtime artifact。
- 第一版保留动态字符串 fallback，不强制所有变量访问都必须是 literal path。
- `project.*` 类型是 Project Workspace 相关的；通用 profile 默认不绑定具体 project type。
- `session.*` 类型来自 profile 自己的 `variableDefinitions`，最适合优先实现。
- `client.*` 要补全到 leaf path，需要把内建 client definition 变细，或额外注册常用 leaf variable。

## Resolved Decisions

- `client.ide` / `client.studio` 保留宽松 root，同时按当前 frontend snapshot 全量注册 leaf definitions。
- Project-aware profile check/compile 通过 CLI `--project <projectPath>` 注入 Project Workspace 的 project variable type artifact；未传 `--project` 时不绑定具体 Project Workspace。
- `ctx.vars.read()` 第一版只类型化 `value`；`path`、`fingerprint`、`issue` 等结构保持现有 `VariableReadResult` 语义。
- Strict diagnostics 默认不开；普通 check/compile 对未注册 literal path 只输出 warning，`--strict-variables` 才升级为 error。

## Future Direction

- **变量选择器**：Workbench 中不再手写 path，而是从 registry/catalog 中选择变量。
- **schema-aware patch builder**：根据变量类型辅助生成 JSON Patch，减少 Agent 写错 patch path 或 value 类型。
- **profile diagnostics 增强**：在保存时提示变量 definition stale、project type 缺失、literal path 未注册。
- **client state 精细化**：把 `client.ide` / `client.studio` 从宽松 record 逐步拆成稳定 leaf definitions。
- **project package 自描述**：Project Workspace 打包时携带 project variable definitions、runtime artifact 和 type artifact，迁移后仍能补全。
- **Agent prompt 精简**：Leader profile 不必注入大段变量 schema，更多依赖工具查询和编辑期补全。

## Files Changed

- `docs/tasks/12-profile-variable-types/README.md`
- `server/agent/variables/generated-types.ts`
- `server/agent/variables/types.ts`
- `server/agent/variables/registry.ts`
- `server/agent/variables/definition-artifact.ts`
- `server/agent/variables/ide-types.ts`
- `server/agent/variables/generated-profile-variable-types.d.ts`
- `server/agent/profiles/profile-artifact-compiler.ts`
- `server/agent/profiles/profile-dsl.ts`
- `scripts/profile.ts`
- `scripts/variable.ts`
- 系统 profile / variable `.compiled` manifest 与 type artifacts

## Verification

- `bunx tsc --noEmit --pretty false`
- `bunx vitest run server/agent/variables/variables.test.ts server/agent/profiles/profile-dsl.test.ts server/agent/profiles/leader-assets-profile.test.ts server/agent/profiles/catalog.test.ts`
- `bun scripts/variable.ts definition check --global --workspace-root assets/workspace`
- `bun scripts/profile.ts check builtin/leader.default.profile.tsx --system`
- `bun scripts/profile.ts check builtin/leader.default.profile.tsx --system --strict-variables`
- `bun scripts/profile.ts check --all --system --strict-variables`
- `bun scripts/profile.ts status builtin/leader.default.profile.tsx --system`
- `bun scripts/profile.ts status writer --system`
- `bunx vitest run server/agent/variables/variables.test.ts server/agent/profiles/catalog.test.ts`
- `bunx vitest run server/workspace-files/workspace-files.test.ts -t "同步系统 assets 会补齐默认 leader profile 覆盖文件"`

## TODO / Follow-ups

- Workbench 变量选择器尚未接入；当前只完成 CLI / TSX authoring 底层类型能力。
- `client.*` leaf definitions 已按当前 frontend snapshot 拆细；后续新增 client state 字段时需要同步 registry 和测试。
- 复杂 TypeBox schema 仍会降级为 `JsonValue`；后续可按真实需求逐步扩展映射器。

## Implementation Walkthrough

### 2026-05-25

- 新增变量类型生成器：
    - 从 `VariableDefinition[]` 生成 module augmentation 形式的 `ProfileVariableValueMap`。
    - 支持 TypeBox 常用子集；不支持或空泛 schema 保守降级为 `JsonValue` 并输出 warning。
- `ProfileVariableAccessor` 增加 typed overload：
    - 已知 path 返回 `ProfileVariableValueMap[P] | undefined`。
    - 未知或动态 string 继续返回 `JsonValue | undefined`。
    - `read()` 第一版只类型化 `value` 字段。
- DSL path props 接入同一类型：
    - `<Variable path>`
    - `<VariableSchema paths>`
    - `<Reminder watchPath>`
- 内建 `client.*` definitions 拆细：
    - 保留 `client.ide` / `client.studio` 宽松 root。
    - 额外注册当前 frontend snapshot 的 leaf path，例如 `client.ide.activePanel`、`client.ide.theme`、`client.studio.selectedFilePath`、`client.studio.selectionVersion`、`client.studio.workspaceKind` 等。
- Variable definition compiler 扩展：
    - 编译 `.compiled/*.mjs` 时同步生成 `.compiled/*.types.d.ts`。
    - manifest 记录 `typeFileName`、hash、bytes、diagnostics。
    - `scripts/variable.ts definition status/compile` 展示 type artifact。
    - Runtime loader 仍不依赖 type artifact。
- Profile artifact compiler 扩展：
    - 编译 profile 后从 `profile.variableDefinitions` 生成 session variable type artifact。
    - manifest 记录 `registeredVariablePaths` 和 type artifact 元数据。
    - 系统 artifact 同步场景需要同时复制 type artifact；runtime freshness 不依赖 type artifact，避免补全产物缺失导致 profile 不可运行。
- Profile CLI 接入：
    - `profile check/compile` typecheck 时注入 builtin client types、Workspace Root/global type artifact、当前 profile/session type artifact。
    - 新增 `--project <projectPath>`，用于额外注入 Project Workspace 的 project variable types。
    - 新增 `--strict-variables`，把 literal path 未注册从 warning 升级为 error。
    - 对当前源码的 session variables 会先在临时目录编译提取类型，不写真实 `.compiled`。

### 2026-05-25 Review Fixes

- Runtime artifact freshness 重新收窄到源码、依赖和 `.mjs` artifact；`.types.d.ts` 只作为 authoring aid，不会阻断 profile 或 variable definition 加载。
- user-assets 同步系统 profile / variable definition artifact 时会同步复制对应 `.types.d.ts`，保证用户覆盖层的 CLI 补全和 status 信息完整。
- `profile check/compile --all --strict-variables` 不再静默跳过变量 path 诊断；改为一次性 typecheck 全部 profile 源码，避免逐文件创建 TypeScript Program 造成 CLI 过慢。

### 2026-05-26 IDE Type Entry

- 新增固定路径 `server/agent/variables/generated-profile-variable-types.d.ts`，由 `scripts/prepare-system-profile-metadata.ts` 生成。
- 该文件汇总 builtin client types、system variable definition type artifacts 和 system profile/session type artifacts，让 WebStorm / 普通 `tsconfig.json` TS Program 能自动加载 `ProfileVariableValueMap` augmentation。
- Hash 型 `.compiled/*.types.d.ts` 继续作为 artifact 层产物；IDE 固定入口只做 authoring 汇总，不参与 runtime 加载。
