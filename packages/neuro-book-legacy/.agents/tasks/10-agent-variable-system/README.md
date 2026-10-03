# Agent Variable System Refactor

> 2026-07-31 authoring/CLI 取代说明：Variable 作者使用 `nbook/variable-sdk`；Agent 稳定入口是 `.nbook/agent/bin/variable`。下文 repo-backed shim、项目根 `scripts/variable.ts` 与 `assets/workspace/.nbook/agent/scripts/variable.ts` 只保留为历史证据；Source checkout wrapper 现调用 Product-owned source entry，发行物通过 Task 130 的 Product Runtime Contract 解析 `variable` 逻辑命令，不保留旧路径 fallback。

> 2026-07-11 暂时收口 Profile 公开表面：全局 Agent registry 与 `variable_schema`、`variable_read`、`variable_patch` runtime/tools 继续保留；Profile DSL/JSX、`builtin.variable` 绑定、内置 Profile 提示与 Workbench 不再公开 `Variable`、`VariableSchema` 或变量插入能力。底层 storage、registry、`ctx.vars`、definition 编译和类型生成保持完整；本文后续章节保留原始设计与实现历史，不代表当前 Profile 作者界面。

## User Request

- 系统性重构 Agent 变量系统，不用临时 hack 修 ProjectReminder。
- Profile / Agent 能访问前端状态，例如 client state、编辑器字体、当前面板、选中文件等，并且能修改前端状态。
- 变量系统需要统一、易扩展，后续增加变量不应再散落修改 DTO、profile DSL、harness 和前端状态映射。
- 支持用户自定义变量，至少分为 Workspace Root 级、Project 级、Session 级。
- `invoke` 请求的业务 input 暂时不走变量系统；harness 可以直接从 invocation 接口拿到。`ctx.invocation` 可以保留为 invocation 接口参数的直接映射，即使其中部分数据也会被归入变量系统。
- 希望通过 `defineXXX` 风格定义变量 namespace；前端 state 也可以归为一个内建 namespace；用户后续可定义自己的变量，例如“好感度”。
- `ctx` 与变量系统要明确区分：`ctx` 是 harness 注入给 profile 的完整上下文容器，变量系统只是 `ctx` 可以持有的一项能力；`catalog`、`input` 等可读数据不应被强行归入变量系统。
- 提供给 profile 的变量对象应能绑定 session 或 entry，使变量读写跟随 active path 回退；同时提供 `get`、`put` 等实用方法，让 `Reminder` / `Watch` 可以基于统一变量路径实现，而不是各自写特殊逻辑。
- 持久变量第一版使用单文件 `workspace/.nbook/agent/variables.json`，暂不拆成多个 JSON 文件。
- Profile 注入变量时优先通过新增 TSX Node / Helper，让 profile 作者不用手写底层 `ctx.vars.get()`。
- Profile 可以通过 TSX Helper 显式注入变量值或变量 schema。`<Variable>` 负责把变量值渲染进上下文，`<VariableSchema>` 负责把变量系统的 overview、局部 schema 和可写能力说明渲染进上下文。Agent 后续通过专门变量工具读取变量、提交 JSON Patch、再次读取验证。
- Agent 修改变量使用 JSON Patch 工具；后续调研 LLM 友好的 JSON Patch 生成/修复库，记录候选：JSON-Whisperer（https://github.com/emnlp2025/JSON-Whisperer，https://arxiv.org/html/2510.04717v1）。
- 变量系统本次硬切，不做 legacy 兼容；不保留 `ctx.workspace` alias。
- 动态变量值和变量 schema helper 第一版只能放在 `ModelContext`；不能放入 `System`、`HistorySet`、`AppendingSet`，避免 provider system prompt、首轮历史或 session appending 被动态变量污染。
- 变量系统第一版要一次性把心智模型做好：宁愿硬切旧概念，也不要让 profile 作者同时理解多套别名、fallback 和历史兼容规则。外部 API 要少而稳定，复杂性藏在 harness / registry 内部。
- `variables.json` 使用 `{schemaVersion, variables}` 包装格式，不使用裸 JSON。
- 变量定义来源分层：system/global 变量定义由 Workspace Root `.nbook` / user-assets 注册；Project 变量定义由 Project Workspace 注册；Session 变量定义由 profile 注册。
- 变量改动新增 `variable_patch` entry；Project/global 变量真相在 `variables.json`，当前 session 仍写审计 entry；session 变量只存在 session JSONL。
- `client.*` patch 需要前端 apply 后写 ack entry；可写 client 字段统一走变量定义注册。

## Goal

- 建立一个统一变量模型，让 profile、harness、工具和前端 UI 都通过同一套 namespace / schema / storage / sync 合同读写变量，同时保留 `ctx` 作为 harness 注入上下文容器的更大边界。
- 把 `ctx.input` 从“浏览器状态临时载体”中解放出来，只保留为 profile 静态 input；一次性 invocation 业务 input 统一走 `ctx.invocation.input`。
- 让 ProjectReminder 这类“依赖当前 Project Workspace 的运行时提醒”读取本轮最新 frontend/client snapshot，而不是读取 session 创建时的旧 input。
- 为后续用户自定义变量、低代码 profile、前端状态修改、跨 session/project 状态复用留下稳定扩展点。
- 让变量访问对象统一绑定 entry anchor，默认 anchor 是当前 active leaf，确保回退、分支切换、retry 时变量视图和消息历史一致。
- 降低 profile 作者和 Agent 使用变量的心智负担：常用读变量走 `<Variable>`，常用 schema/能力注入走 `<VariableSchema>`，常用改变量走变量工具，高级 `ctx.vars` API 只作为逃生口。

## Current State

- `ProfilePrepareContext` 当前包含 `session`、`input`、`catalog`、`skills`、`runtime`。
- DSL `watchPath` 只允许 `ctx.session`、`ctx.input`、`ctx.runtime`、`ctx.workspace` 四个 root。
- `ctx.workspace` 不是 `ProfilePrepareContext` 的真实字段，而是 `profile-dsl.ts` 中手动拼出来的虚拟 root：
  - `root` 来自 `ctx.session.workspaceRoot`。
  - `currentProject` 来自 `ctx.input.studio.workspace`。
  - `novelId` 来自 `ctx.session.novelId`。
- 前端 `buildClientVariables()` 当前只在创建 session 时作为 `createSession.input` 写入 `SessionMetadata.input`。
- 后续 `invokeSession()` 请求不携带最新 client variables，所以长 session 切换 Project 后，profile 仍看到创建 session 时的旧 `ctx.input`。
- 旧 `variable_change` session entry 已从 v3 active 类型和 reducer 删除；新变量系统只使用 `variable_patch`。
- 工具执行上下文 `ToolExecutionContext` 当前只有 `sessionId`、`workspaceRoot`、`workspaceKey`、`novelId` 等，不包含统一变量读写入口。
- 当前 `profileState.${profileKey}` 是 profile runtime state，只保存 TSX DSL 内部的 `ReminderState` / `WatchState`：
  - `reminders[id].fingerprint`
  - `reminders[id].injectedAtTurn`
  - `watches[key].hasValue`
  - `watches[key].value`
  - `watches[key].fingerprint`
- 当前 session 状态主要散在 `custom` entry 中，例如 `agent.tasks`、`plot.selection`、`agent.planMode`、`ui.planMode.active`、`profileState.${profileKey}`；变量系统的新入口是独立 `variable_patch` entry。

## Variable File Format

Workspace Root 级与 Project 级变量文件都使用同一包装格式：

```json
{
  "schemaVersion": 1,
  "variables": {
    "userPreferences": {
      "editorFont": "monospace"
    },
    "affection": {
      "people1": {
        "score": 20
      }
    }
  }
}
```

规则：

- `schemaVersion` 用于后续迁移。
- `variables` 是用户主要编辑区域。
- 文件路径：
  - global: `workspace/.nbook/agent/variables.json`
  - project: `workspace/{project}/.nbook/agent/variables.json`
- session 级变量不写 `variables.json`，只写 session JSONL。

## Requirement Complexity Ranking

从低到高：

1. **本轮 frontend snapshot 注入 profile ctx**
   - 难度低到中。
   - 主要是给 invoke DTO / harness 增加 `clientState` 输入，并把 `ProjectReminder` 改到新 `client.*` root。
   - 风险是命名和 source-of-truth 要一次定好，否则会继续和 `ctx.input` 混淆。

2. **统一变量访问入口并挂到 `ctx`**
   - 难度中。
   - 需要把 DSL `readPath()`、TSX profile context、preview/workbench context 一起改成同一套变量访问对象。
   - 这是避免后续 hack 的核心。

3. **Workspace Root / Project / Session 持久变量**
   - 难度中到高。
   - 需要定义 storage location、合并优先级、schema 校验、读写 API、并发写入策略。
   - Project 级必须使用 Project Workspace 术语和路径，不再把 Project Workspace 简写成 workspace。

4. **Agent 修改前端状态**
   - 难度高。
   - 后端不能直接改浏览器内存，需要通过 session entry / SSE command / frontend apply pipeline 投递 patch。
   - 还要定义哪些 browser state 可写、写失败如何反馈、刷新页面后哪些状态持久化。

5. **用户自定义变量定义系统 `defineXXX`**
   - 难度高。
   - 不只是存 JSON，还要支持 schema、默认值、namespace、权限、UI 暴露、profile 类型提示、迁移与冲突处理。
   - 做得太早会过度设计；应该先做最小可运行 registry，再扩 UI。

6. **端到端低代码 / Workbench 可视化编辑变量**
   - 难度最高。
   - 需要把变量 registry 暴露给 Workbench 物料、Inspector、自动补全、preview 和 round-trip。
   - 本任务第一阶段只记录接口，不强行完成完整 UI。

## Proposed Design

### 1. 概念拆分

`ctx` 与变量系统分层：

- **`ctx` 是 harness 注入给 profile 的上下文容器**
  - 它可以包含 `session`、`input`、`invocation`、`catalog`、`skills`、`runtime`、`vars` 等。
  - 其中很多内容只是只读上下文，不属于变量系统，例如 `catalog`、`skills`、profile `input`。

- **变量系统是 `ctx` 持有的一项能力**
  - 它负责可扩展变量的定义、读取、写入、持久化、前端同步、分支回退。
  - 变量系统不应该吞掉整个 `ctx`，否则会把静态 catalog、schema input 和运行状态混成一团。

对 profile 作者的推荐心智模型只保留三句话：

1. `ctx.input` 是这个 profile 的固定输入合同。
2. `<Variable />` 把变量值放进模型上下文，通常只读。
3. `<VariableSchema />` 把变量 schema / 可写说明放进模型上下文；Agent 通过变量工具读取、patch、再读取验证。

`ctx.vars.get()`、entry anchor、namespace storage、fingerprint、frontend patch command 都是高级机制，普通 profile 不需要先理解。

变量注入分成两类，不再混在同一个 helper 里：

- **值注入**
  - 由 `<Variable />` 完成。
  - 作用是把当前变量值渲染进本轮模型上下文，方便模型理解状态。
  - 默认不意味着 Agent 能修改该变量；能否修改由变量定义、变量 schema 注入和变量工具共同决定。

- **schema / 能力注入**
  - 由 `<VariableSchema />` 完成。
  - 作用是把变量系统的 overview、局部 schema、可读/可写范围和工具用法渲染给模型。
  - 它不注册每轮 target binding；变量 path 和 schema 来自统一 registry。
  - Agent 需要先调用变量工具 `read` 查看当前值，再提交 JSON Patch，必要时再次 `read` 验证结果。
  - 这让变量编辑和文件编辑保持同一个心智模型：先读、再改、再确认。

变量相关数据分四类来源，不能再混进同一个 `ctx.input`：

- **Profile Input**
  - `ctx.input`
  - 来源：创建 profile/session 时的静态参数。
  - 用途：profile 自己定义的业务输入，例如 writer 的写作要求、chapterPaths。
  - 不承载浏览器状态。
  - 类型由 profile 的 `TInput` / `inputSchema` 决定，是 profile 的长期合同。

- **Invocation Input**
  - `ctx.invocation.input`
  - 来源：本次 invoke HTTP body。
  - 用途：用户本轮调用 harness 的一次性参数。
  - 本次先不并入变量系统。
  - 不改变 profile `TInput`，适合一次性调用参数，例如本轮 override、临时模式、外部调用 payload。
  - `ctx.invocation` 可以保留与 invocation HTTP body 接近的形状；即使 `clientState` 会被 harness 归一化进 `client.*` 变量，也允许在 `ctx.invocation.clientState` 中保留原始输入，方便高级 profile 读取本轮调用参数。

- **Variable Accessor**
  - `ctx.vars`
  - 来源：harness 根据 session、entry anchor、Workspace Root、Project Workspace 和 invocation client state 创建的变量管理器。
  - 用途：Profile / DSL / tool 读取和写入当前系统状态、用户自定义状态和前端状态。
  - 它不是一份裸 JSON snapshot；可以提供 `get`、`put`、`patch`、`delete`、`watch` 等方法，并能绑定 active path。

- **Session Context**
  - `ctx.session`
  - 来源：session JSONL reduce。
  - 用途：消息历史、profileKey、model、linkedAgents、plan mode、customState 等 session 运行事实。

### 2. `ctx` 新形态

建议把 `ProfilePrepareContext` 调整为：

```ts
type ProfilePrepareContext<TInput = JsonValue> = {
    session: NeuroSessionContext;
    input: TInput;
    invocation?: {
        input?: JsonValue;
        clientState?: ClientStateSnapshot;
    };
    vars: ProfileVariableAccessor;
    catalog: AgentCatalogSnapshot;
    skills: SkillCatalogItem[];
    runtime: {
        now: string;
        promptUserTurnCount: number;
        pendingUserMessage?: Message;
    };
};
```

`ctx.workspace` 不再保留。新 profile 必须使用 `ctx.vars`、`ctx.session` 或 TSX variable helper；本次重构硬切，不做 legacy alias。

`ctx.vars` 命名比 `ctx.variables` 更强调它是一个变量管理器，不是一份普通对象。当前先直接把可读写 `ProfileVariableAccessor` 给 profile 使用，不额外包装只读版本。若后续希望 profile 写法更直观，可以同时提供 snapshot alias：

```ts
ctx.vars.snapshot.client.currentProjectWorkspace
```

但推荐 profile 运行逻辑和 Reminder / Watch 使用方法式 API：

```ts
await ctx.vars.get("client.currentProjectWorkspace")
await ctx.vars.put("session.planMode.lastReminder", value)
```

文档和模板中默认不展示 `ctx.vars.put()`。写变量优先引导到变量工具；直接 `ctx.vars.put()` 只给高级 profile / tool 作者使用。Workbench preview、profile detail、snapshot system prompt 等非真实 invocation 场景禁止真实持久写入，应使用 dry-run `ProfileVariableAccessor` 和 in-memory overlay 模拟 `ctx.vars` 写入结果。

### 3. 变量 namespace

公开变量 namespace 固定为四个：

- `client`
  - 当前客户端/前端运行态。
  - 默认 volatile，每次 invoke 由前端传最新 snapshot。
  - 示例：theme、activePanel、editorFont、selectedFilePath、selectionVersion、currentProjectWorkspace。
  - 写入时不直接改后端文件，而是生成前端 patch，由浏览器 apply。

- `global`
  - Workspace Root 级持久变量，对用户心智表达为全局变量。
  - 存储位置：`workspace/.nbook/agent/variables.json`。
  - 示例：全局用户偏好、跨 Project 共享变量、用户自定义全局状态。

- `project`
  - Project Workspace 级持久变量。
  - 存储位置：`workspace/{project}/.nbook/agent/variables.json`。
  - 示例：当前小说/project 的自定义状态、角色好感度、项目阶段。

- `session`
  - 当前 agent session 级变量。
  - 存储位置：session JSONL entry。
  - 示例：本 session 临时偏好、当前 agent 任务状态、profile 显式声明给 Agent 使用的 session 变量。
  - 必须绑定 active path；当用户切换分支、retry 或 move tree 时，变量视图要跟随 entry 回退。

### 4. 变量定义 API

建议使用 registry + define 风格：

```ts
export const currentProjectWorkspace = defineClientVariable({
    key: "currentProjectWorkspace",
    schema: Type.String(),
    writableBy: ["frontend"],
});

export const affectionsVariable = defineProjectVariable({
    key: "affections",
    schema: Type.Record(Type.String(), Type.Number()),
    defaultValue: {},
    writableBy: ["agent", "user"],
});
```

第一版只需要 runtime registry，不强求生成完整类型文件。后续再把 registry 输出给 Workbench / LSP / profile 类型提示。
公开 namespace 固定为 `client`、`global`、`project`、`session` 四个。`defineVariableNamespace(...)` 只作为内部 registry API，不作为用户扩展第五个 namespace 的公开入口；用户定义变量应使用 `defineClientVariable(...)`、`defineWorkspaceRootVariable(...)`、`defineProjectVariable(...)`、`defineSessionVariable(...)` 这类固定 namespace helper。

变量定义来源：

- **System / global variables**
  - system 内建定义由代码注册。
  - 用户覆盖或自定义 global 定义由 Workspace Root `.nbook` / user-assets 入口管理。
  - 对应变量值存储在 `workspace/.nbook/agent/variables.json`。

- **Project variables**
  - Project 自定义定义由 Project Workspace 注册。
  - 对应变量值存储在 `workspace/{project}/.nbook/agent/variables.json`。

- **Session variables**
  - 由 profile 注册。
  - 对应变量值只写 session JSONL，跟随 entry / branch 回退。

第一版可以先让 profile TSX 注册 session 变量；Project/global definition 的 UI 与文件格式后续再细化，但语义边界先定死。

变量定义文件：

- Workspace Root / global definition 使用 TS/TSX definition，走 `.compiled` 真相源。
- 第一版不把用户手写 JSON schema 文件作为同等级入口，避免多出第二套定义语言。
- 建议路径：
  - Workspace Root/global: `workspace/.nbook/agent/variables/definitions.ts`
  - Project: `workspace/{project}/.nbook/agent/variables/definitions.ts`
  - Session/profile: profile TSX 内 `defineSessionVariable(...)`
- 值文件和定义文件分开：
  - value: `.nbook/agent/variables.json`
  - definition: `.nbook/agent/variables/definitions.ts`
- system/user-assets 提供模板和内建定义；运行时加载 Workspace Root `.nbook/agent/variables/definitions.ts`，不混读 system root 的同名 global definition。
- 内建 `client.*` 定义放系统代码里，不放 user-assets。它对应前端真实状态字段，必须和前端 snapshot builder 同步。用户可以注册 `client.custom.*`，但不能覆盖内建 client 字段。
- TS/TSX 变量定义进入 `.compiled` 真相源。runtime 只读 compiled artifact，不自动编译 definition 源码。
- 系统 assets 同步时同步变量 definition 源码和对应 compiled artifact。

#### Definition `.compiled` 合同

变量 definition 和 TSX profile 一样采用“源码负责编辑，`.compiled` 负责运行”的边界。runtime 不能因为读取变量 registry、catalog、config snapshot、profile prepare 或工具执行而自动编译 definition 源码。

建议 artifact 位置：

- Workspace Root/global definition artifact: `workspace/.nbook/agent/variables/.compiled/manifest.json` 与稳定文件名的 `workspace/.nbook/agent/variables/.compiled/*.mjs` / `*.types.d.ts`。
- Project definition artifact: `workspace/{project}/.nbook/agent/variables/.compiled/manifest.json` 与稳定文件名的 `workspace/{project}/.nbook/agent/variables/.compiled/*.mjs` / `*.types.d.ts`。
- Bundled Workspace Template 的系统 definition artifact 随 `assets/workspace/.nbook/agent/variables/.compiled/` 发布，并由 user-assets 同步到 Workspace Root `.nbook`。
- Profile 内部的 `defineSessionVariable(...)` 随 profile 自身 `.compiled` artifact 加载，不再单独生成变量 definition artifact。

`variables/.compiled/manifest.json` 至少记录：

```ts
type VariableDefinitionCompiledManifest = {
    compilerVersion: string;
    generatedAt: string;
    definitions: Array<{
        fileName: string;
        sourceSha256: string;
        sourceBytes: number;
        dependencyHash: string;
        artifactFileName: string;
        artifactSha256: string;
        artifactBytes: number;
        registeredPaths: string[];
        dependencies: string[];
    }>;
};
```

运行时加载规则：

- definition registry 只 import manifest 中 hash 匹配的 artifact。
- artifact 文件名不携带 hash，例如 `definitions.ts` 生成 `definitions.mjs` 和 `definitions.types.d.ts`；运行可信度由 manifest 中的 source/artifact/dependency hash 决定。
- 缺少 artifact 的 definition source 状态为 `not_compiled`。
- source 或依赖 hash 变化时状态为 `compile_stale`，不能加载旧 artifact。
- artifact import 失败时状态为 `compiled_load_failed`，并在 registry/catalog/API 中暴露结构化 issue。
- `not_compiled` / `compile_stale` / `compiled_load_failed` 的 definition 不参与变量注册；如果 profile 或工具访问依赖该 definition 的变量 path，应返回清晰错误，而不是 fallback 到 `unknown` 或自动编译。

编译入口：

- Workbench 或 user-assets 变量定义编辑器保存 definition 源码后，必须显式点击编译才更新 `.compiled`。
- Agent runtime CLI 提供 `variable definition compile/status/check`。当前 `assets/workspace/.nbook/agent/bin/variable` 是 repo-backed runtime shim：在开发版 user-assets 中会向上定位 neuro-book 仓库根并调用项目根 `scripts/variable.ts`；生产打包时需要把同等逻辑随 runtime 一起发布，不能依赖源码自动编译。
- `bun run dev` / `bun run build` 可以预编译系统 definition artifact，但 dev reload 不能回到 runtime API 自动编译。

同步规则：

- 系统 assets 同步时，如果用户侧 definition 未手改，复制源码和对应 `.compiled` artifact，并更新 sync state。
- 用户侧 definition 已手改或缺 sync state 时，不覆盖源码，也不覆盖 artifact；registry 返回 warning，提示用户手动编译。

变量注册机制的职责：

- 注册的是 definition，不是 value。
- definition 至少包含：
  - `path`: 完整变量路径，例如 `project.affections`。
  - `namespace`: `client` / `global` / `project` / `session`。
  - `schema`: TypeBox schema。
  - `defaultValue` 或默认值工厂。
  - `readableBy` / `writableBy`。
  - `title` / `description` / `category` 等 UI 与 prompt 摘要信息。
  - `storage`: 由 namespace 推导，也可显式标注。
- 变量 key 第一版禁止 `.` 和 `/`。完整变量 path 用 `.` 分段，JSON Patch 用 `/` 表示 pointer；动态 key 需要使用稳定 id，展示名放 value 内部。
- value 的真相源由 namespace 决定：
  - `client.*` 来自本轮 frontend snapshot。
  - `global.*` 来自 Workspace Root `.nbook/agent/variables.json`。
  - `project.*` 来自 Project Workspace `.nbook/agent/variables.json`。
  - `session.*` 来自 session JSONL reduce。

注册来源按 owner 分层，而不是按同名覆盖：

- system code 注册内建 `client.*`、必要的 `global.*` 和基础 session 变量。
- Workspace Root `.nbook` / user-assets 注册用户级 `global.*` 定义。
- Project Workspace 注册 `project.*` 定义。
- Profile 注册它自己的 `session.*` 定义。

同一完整 path 不能被多个来源重复注册。重复注册直接报 registry conflict，不做 silent override。这样可以避免 system、user-assets、Project Workspace 和 profile 同时声明 `project.affections` 时 schema、默认值、权限互相覆盖，最后 Agent 不知道哪个合同才是真的。

`defineVariable()` 的粒度是“定义一个变量根”，不是只能定义叶子字段。

例如可以定义整个对象：

```ts
defineProjectVariable({
    key: "affections",
    schema: Type.Record(Type.String(), Type.Number()),
    defaultValue: {},
    writableBy: ["agent", "user"],
});
```

它注册的完整 path 是 `project.affections`。在这个定义下：

- `project.affections` 是变量根。
- `project.affections.alice` 是变量根内的子路径。
- resolver 能从 `Type.Record(Type.String(), Type.Number())` 推导出 `alice` 的 schema 是 number。
- Agent 可以 patch 子路径，不需要每次重写完整 `affections` 对象。

如果用户希望 Agent 每次更新时重写整个对象，可以在变量定义上标注写入策略：

```ts
defineProjectVariable({
    key: "affections",
    schema: Type.Record(Type.String(), Type.Number()),
    defaultValue: {},
    writableBy: ["agent", "user"],
    writeMode: "replace",
});
```

推荐写入策略：

- `writeMode: "patch"`：默认。允许 `variable_patch` 定位到变量根或子路径，并在该 root 上应用 JSON Patch。
- `writeMode: "replace"`：字段先保留，但第一版不强制。是否每次完整重写，先由 Agent 根据变量 schema、任务和 prompt 自行决定。

因此，`affections` 和 `stage` 可以是两个 `defineVariable` 定义，也可以只有一个 `defineVariable({key:"affections"})` 定义内部动态 key。边界由用户希望的 schema、权限和写入策略决定。

为了降低使用成本，推荐提供几个内建 helper：

```ts
defineWorkspaceRootVariable(...)
defineProjectVariable(...)
defineSessionVariable(...)
defineClientVariable(...)
```

它们内部仍然调用统一的 `defineVariable()`，但 profile / app 代码不必每次手写 namespace、storage 和 writable policy。

#### Schema Resolver

变量 schema 自动推导由 `VariableRegistry` 和 `VariableSchemaResolver` 负责，不由 TSX helper 自己猜。

核心流程：

1. 所有变量定义通过 `defineVariable()` 注册到 registry，registry key 是完整变量路径，例如 `project.affections`、`client.currentProjectWorkspace`。
2. `<VariableSchema path="project.affections.people1" />`、`variable_read({namespace, path})`、`variable_patch({namespace, path})` 都先调用 resolver。
3. resolver 优先查找完全匹配的注册变量。
4. 如果没有完全匹配，就从 path 右侧逐段回退，找到最近的已注册父变量，例如 `project.affections`。
5. 找到父变量后，按剩余 path 在 TypeBox schema 内解析子 schema：
   - `Type.Object`：按 properties 进入字段；如果 `additionalProperties` 是 schema，也可以进入动态字段。
   - `Type.Record`：进入 value schema。
   - `Type.Array`：数字段进入 item schema；非数字段报错。
   - `Type.Union`：第一版只在所有分支都能解析到兼容子 schema 时通过，否则要求 profile 用更明确的 path 或变量定义。
   - 其他 primitive schema 不能继续下钻。
6. resolver 返回 `{definition, path, rootPath, relativeJsonPointer, schema, readable, writableByAgent, storage}`。

这套机制让 helper 能根据 path 自动推导 schema，包括用户自定义变量；也让工具对任意可读/可写 path 做同一套校验。无法推导时不 fallback 到 `unknown`，直接报 contract error 或 tool error。

自动类型推导第一版应该做，但只做 TypeBox 的稳定子集。它不需要成为完整 TypeScript 类型系统：

- **好做且应该支持**
  - `Type.Object` 的 `properties` / optional property。
  - `Type.Record` 的动态 key。
  - `Type.Array` 的数字 index / item schema。
  - `additionalProperties` 为 schema 的对象。
  - `Type.Literal`、`Type.String`、`Type.Number`、`Type.Boolean`、`Type.Null` 等叶子类型。
- **可以支持但要保守**
  - `Type.Union`：只有所有分支都能解析到兼容子 schema 时通过。
  - `Type.Intersect`：第一版可以合并 object properties；复杂 intersect 报错。
- **第一版不建议支持**
  - recursive/ref schema、transform、computed schema、复杂 conditional。
  - 遇到这些情况，要求变量定义额外注册更明确的子 path schema。

推荐实现：resolver 提供 `resolve(path)`；如果推导失败，错误文案提示“请为该子 path 注册独立变量定义，或在 `<VariableSchema paths={...}>` 中选择更明确的已注册路径”。这样可以覆盖 80% 常见变量，又不会把实现拖成完整 schema compiler。

### 5. 变量访问对象

提供给 profile 的变量系统不是裸对象，而是绑定当前 session/entry 的 accessor：

```ts
type ProfileVariableAccessor = {
    readonly dryRun: boolean;
    catalog(query?: VariableSchemaQuery): VariableSchemaResult;
    get(path: string): Promise<JsonValue | undefined>;
    read(path: string, options?: VariableReadOptions): Promise<VariableReadResult>;
    patch(
        namespace: VariableNamespace,
        path: string,
        operations: VariableJsonPatchOperation[],
        source?: "agent" | "profile" | "frontend" | "user",
        toolCallId?: string,
    ): Promise<VariableReadResult>;
};
```

绑定策略：

- **统一使用 Entry-bound accessor**
  - 不再设计两套 session-bound / entry-bound API。
  - 默认用于 profile prepare、tools、ingest 的 accessor 绑定当前 active leaf。
  - 读 session 变量时 reduce 到 anchor entry；如果 anchor 是当前 leaf，就等价于当前 session active path。
  - 第一版不暴露 `anchor` / `snapshot` / `put` / `delete` 公共 API，避免 profile 作者理解两套写入入口；写变量优先走 `variable_patch` 工具，高级 profile 可以直接调用 `ctx.vars.patch(...)`。
  - 写 session 变量时追加到 anchor 之后的新 leaf，因此自然参与分支和回退。
  - preview、retry、tree move 后 invoke 可以显式传入目标 entry anchor，避免再引入第二套读取语义。

- **Workspace Root / Project-bound accessor**
  - 读写持久文件，不随 session branch 回退。
  - 适合全局偏好、Project 自定义状态、用户定义长期变量。

### 6. Writable Policy

`writableBy` 用来表达变量定义允许哪些主体写入：

```ts
writableBy: ["frontend", "agent", "user"]
```

含义：

- `frontend`
  - 前端 UI 可以写入，通常用于设置面板、编辑器状态、用户交互产生的状态。
  - 示例：编辑器字体、主题、面板布局。

- `agent`
  - Agent / profile / tool 可以写入，通常通过变量 patch 工具或 `ctx.vars.patch()`。
  - 示例：任务状态、角色好感度、项目阶段、agent 自己维护的 session 变量。

- `user`
  - 用户可以直接编辑变量文件或通过 user-assets / 低代码界面修改。
  - 示例：自定义项目变量、手动设定世界观状态、全局偏好。

第一版 `writableBy` 主要用于：

- 运行时写入校验，拒绝未授权主体修改变量。
- UI 决定哪些变量可编辑、哪些只读。
- Workbench / profile editor 给出可写提示。
- 后续审计和冲突提示，例如 Agent 修改了用户可编辑变量。

它不是安全沙箱；本项目的本地 Agent 代码仍是受信任代码。它的重点是合同表达、UI 行为和避免误写。

### 7. 读写模型

读取：

- Harness 在每次 invoke 前创建 `ProfileVariableAccessor`。
- 组装顺序：
  1. 读取 Workspace Root 级 `global` 变量。
  2. 按当前 Project Workspace 读取 Project 变量。
  3. 从 session active path reduce Session 变量。
  4. 合并本次 invocation 携带的 client snapshot。
- Profile 和 DSL 通过 `ctx.vars` 读取变量；只读插值可使用 `ctx.vars.snapshot.*`。
- 已注册变量如果没有持久值，读取时 overlay `defaultValue`，并在读取结果中标注 `source: "default"`。
- 如果后续 patch 修改了默认值 overlay 出来的变量，必须立刻 materialize 到对应真相源，并记录 `sourceBefore: "default"`。
- 变量文件中未注册字段保留，不自动删除；变量工具只允许 read/patch 已注册 path。
- 注册变量的持久值如果不符合 schema，`variable_read` 返回结构化 schema error，不把脏值返回给模型。
- `project.*` 变量必须依赖本轮 `client.currentProjectWorkspace` 定位 Project Workspace；缺失或无效时直接报错，不 fallback 到 session metadata / novelId。

写入：

- 后端写持久变量时追加明确 entry 或调用变量服务：
  - `ctx.vars.put(path, value)`
  - `ctx.vars.patch(path, patch)`
  - `ctx.vars.delete(path)`
- Session 级变量写入 session JSONL。
- Workspace Root / Project 级变量写入对应 `.nbook/agent/variables` 文件，并发写入需要走同一个 service。
- Project/global `variables.json` 写入必须使用文件级写锁。每个 variables file 一个写锁，写入流程为 read-current -> validate -> patch -> atomic replace。
- Project/global 工具 read/patch 每次都通过变量服务读取当前文件，不长期缓存文件值；profile prepare 可以使用本轮 snapshot。
- Client 级变量写入不直接改文件；后端追加 `frontend_variable_patch` 或通用 `ui_command` session entry，经 SSE 投递给前端，前端 apply 后再在下一轮 invoke 回传最新 snapshot。
- Client patch ack 成功后，后端必须把本次 patch 作为当前 invocation 的 client overlay 写入 `ProfileVariableAccessor`，或要求 ack 返回 applied value 并用该值更新 overlay。否则同一轮 `variable_patch` 后的 `variable_read` 无法满足 read-after-write。
- `session.*` definition 第一版只允许由 profile 注册。工具只能读写已有 definition，不能动态注册新的 session 变量。

变量工具：

- Agent 变量工具第一版拆成 `variable_read`、`variable_patch`、`variable_schema`。
- 不提供无参数的全量 `variable_list`。schema 可能很大，Agent 不应该每轮拉完整 schema。
- Profile 通过 `<VariableSchema>` 像 `SkillCatalog` 一样预先注入 overview：有哪些变量域、哪些局部 schema 重要、如何使用变量工具。
- `variable_schema` 用于按参数读取局部 schema，例如按 `namespace`、`prefix`、`paths` 或 `writableOnly` 查询。这个名字比 `variable_list` 更准确：它读取的是变量定义/schema，而不是变量值列表。
- `variable_read` 允许读取所有已注册且对 Agent 可读的变量，通过 `namespace + path` 读取。
- `variable_patch` 用于修改已注册且允许 Agent 写入的变量，通过 `namespace + path` 直接定位变量或变量子路径。
- `variable_patch` 使用 JSON Patch（RFC 6902）作为操作格式。
- `namespace + path` 先定位一个 patch target；JSON Patch operation 的 `path` 永远相对这个 target。
- 如果 Agent 要完整重写某个变量根或子对象，可以在 patch 中使用单个 `replace` 操作，operation path 写空字符串 `""`；如果只改局部字段，则使用普通 JSON Pointer 子路径，例如 `/score`。
- Patch 前后都经过变量定义 schema 校验。
- Patch 成功后只返回简短结果、目标路径和变更数量，不返回完整 updated value；Agent 如果需要确认，必须再次调用 `variable_read`。这和文件工具的 read/edit/read 心智一致，也避免 patch 结果把无关上下文塞回模型。
- 成功后新增 `variable_patch` session entry，替代旧 `variable_change`。
- `variable_patch` entry 只记录变更事实，不保存完整 before/after value；Project/global 变量真相在 `variables.json`，session 变量真相由 session JSONL patch entry reduce 得到。
- Project/global 变量改动会写入对应 `variables.json`，同时在当前 session 写审计 entry；审计 entry 不进入模型 messages。
- Session 级变量只写 session JSONL，不写任何 `variables.json`。
- 同一轮内 `variable_patch` 写入后，后续 `variable_read` 必须能读到刚写入的值。
- Project/global patch 跨越变量文件和 session JSONL 两个 store，第一版不承诺真正原子事务。变量文件是持久变量真相源，session audit entry 是当前 session 的可观测记录；如果 audit 写入失败，必须写 lifecycle error 或返回 tool error，避免静默出现“文件已改但 session 无审计”的状态。
- 后续调研 LLM 友好的 JSON Patch 生成、约束和修复库；候选记录：
  - JSON-Whisperer: https://github.com/emnlp2025/JSON-Whisperer
  - Paper: https://arxiv.org/html/2510.04717v1

`variable_patch` entry 建议形态：

```ts
type VariablePatchEntry = {
    type: "variable_patch";
    path: "project.affections.people1" | string;
    operations: JsonPatchOperation[];
    fingerprint?: {
        before: string;
        after: string;
    };
    source: "agent" | "frontend" | "user" | "harness";
};
```

注意：

- 部分 entry 不适合合并或批量折叠。`variable_patch` 应保持独立语义，避免和普通 `custom`、`message` 或旧 `variable_change` 混用。
- 如果后续做 JSONL batch record，也要保留 entry type，不把变量 patch 降级成 opaque custom state。
- `variable_patch` entry 的核心职责是记录“谁对哪个变量做了哪些 patch”。它不是完整审计快照，不保存 before/after value；fingerprint 只用于并发检测、调试和减少误读。

#### Agent Variable Tool Schemas

第一版变量工具作为普通内置工具注册，沿用当前 TypeBox tool schema 风格：`Type.Object(..., {additionalProperties: false})`。复杂约束例如 `paths` 与 `prefix` 的组合上限，由工具 runtime 校验并返回清晰错误。

```ts
const VariableNamespaceSchema = Type.Union([
    Type.Literal("client"),
    Type.Literal("global"),
    Type.Literal("project"),
    Type.Literal("session"),
]);

const VariableSchemaQuerySchema = Type.Object({
    namespace: Type.Optional(VariableNamespaceSchema),
    prefix: Type.Optional(Type.String({
        description: "Optional variable path prefix, e.g. project.affections.",
    })),
    paths: Type.Optional(Type.Array(Type.String({
        description: "Specific registered full variable paths or subpaths, e.g. project.affections.hero.",
    }))),
    includeOverview: Type.Optional(Type.Boolean({
        description: "Default true. Include compact namespace overview.",
    })),
    detail: Type.Optional(Type.Union([
        Type.Literal("summary"),
        Type.Literal("schema"),
    ], {
        description: "Default summary. Use schema only when exact schema is needed.",
    })),
    writableOnly: Type.Optional(Type.Boolean({
        description: "Default false. When true, only list variables writable by agent.",
    })),
    maxItems: Type.Optional(Type.Integer({
        minimum: 1,
        maximum: 50,
        description: "Maximum schema entries returned. Default 20.",
    })),
}, {additionalProperties: false});

const VariableReadSchema = Type.Object({
    namespace: VariableNamespaceSchema,
    path: Type.String({
        description: "Path inside the namespace JSON, e.g. affections.people1 for namespace=project.",
    }),
    render: Type.Optional(Type.Union([
        Type.Literal("json"),
        Type.Literal("summary"),
    ], {
        description: "Default json. Use summary for large values.",
    })),
    maxBytes: Type.Optional(Type.Integer({
        minimum: 256,
        maximum: 20000,
        description: "Maximum returned text bytes. Default follows the variable tool output limit.",
    })),
}, {additionalProperties: false});
```

`variable_schema` 返回按参数裁剪后的变量 schema，不返回变量值：

```ts
type VariableSchemaResult = {
    catalog?: VariableCatalog;
    schemas: Array<{
        path: string;
        rootPath: string;
        relativePath?: string;
        namespace: "client" | "global" | "project" | "session";
        title?: string;
        description?: string;
        readable: boolean;
        writableByAgent: boolean;
        schemaSummary?: string;
        schema?: JsonValue;
    }>;
};
```

默认 `detail: "summary"` 只返回 schema 摘要；只有显式传 `detail: "schema"` 时才返回完整 schema，避免大 schema 挤爆上下文。

`variable_read` 允许读取所有已注册且可读的变量。它按 `namespace + path` 读取变量值；如果 path 指向注册变量的子路径，resolver 会从父定义推导子 schema。

```ts
type VariableReadResult = {
    namespace: "client" | "global" | "project" | "session";
    path: string;
    fullPath: string;
    rootPath: string;
    relativePath?: string;
    value: JsonValue;
    schema: string;
    source: "stored" | "default" | "client";
    truncated?: boolean;
};
```

`variable_read` 读到大对象时默认截断并返回 `truncated: true`，不直接报错。Agent 应继续用更细的 `path` 下钻读取子对象。

如果注册变量的持久值不符合 schema，`variable_read` 返回结构化 schema error，不返回脏值。未注册字段仍保留在 `variables.json` 中，但不能通过变量工具读写。

JSON Patch operation 使用 RFC 6902：

```ts
const JsonPatchOperationSchema = Type.Union([
    Type.Object({
        op: Type.Literal("add"),
        path: Type.String({description: "JSON Pointer path relative to the exposed variable root."}),
        value: Type.Unknown(),
    }, {additionalProperties: false}),
    Type.Object({
        op: Type.Literal("remove"),
        path: Type.String({description: "JSON Pointer path relative to the exposed variable root."}),
    }, {additionalProperties: false}),
    Type.Object({
        op: Type.Literal("replace"),
        path: Type.String({description: "JSON Pointer path relative to the exposed variable root."}),
        value: Type.Unknown(),
    }, {additionalProperties: false}),
    Type.Object({
        op: Type.Literal("move"),
        from: Type.String({description: "JSON Pointer source path relative to the exposed variable root."}),
        path: Type.String({description: "JSON Pointer destination path relative to the exposed variable root."}),
    }, {additionalProperties: false}),
    Type.Object({
        op: Type.Literal("copy"),
        from: Type.String({description: "JSON Pointer source path relative to the exposed variable root."}),
        path: Type.String({description: "JSON Pointer destination path relative to the exposed variable root."}),
    }, {additionalProperties: false}),
    Type.Object({
        op: Type.Literal("test"),
        path: Type.String({description: "JSON Pointer path relative to the exposed variable root."}),
        value: Type.Unknown(),
    }, {additionalProperties: false}),
]);

const VariablePatchSchema = Type.Object({
    namespace: VariableNamespaceSchema,
    path: Type.String({
        description: "Path inside the namespace JSON, e.g. affections.people1 for namespace=project.",
    }),
    patch: Type.Array(JsonPatchOperationSchema, {
        minItems: 1,
        description: "RFC 6902 JSON Patch operations relative to the namespace path root.",
    }),
    note: Type.Optional(Type.String({
        description: "Short reason for audit UI. Keep it factual.",
    })),
}, {additionalProperties: false});
```

`variable_patch` 返回 patch 摘要，不返回完整变量值：

```ts
type VariablePatchResult = {
    namespace: "client" | "global" | "project" | "session";
    path: string;
    fullPath: string;
    applied: boolean;
    operationCount: number;
    status: "applied" | "client_acknowledged";
    sourceBefore?: "stored" | "default" | "client";
    message: string;
};
```

规则：

- `variable_patch` 只能修改已注册且允许 Agent 写入的变量 path。
- `variable_patch` 入参采用 `namespace + path + patch`，其中 `path` 是 namespace 小 JSON 内的路径。服务端会组合成完整路径，例如 `namespace=project` + `path=affections.people1` -> `project.affections.people1`。
- `namespace + path` 是 patch target；每个 JSON Patch operation 的 `path` 相对这个 target。完整替换 target 时，operation path 必须是空字符串 `""`。
- 一次 `variable_patch` 只能修改一个 namespace。跨 namespace 更新必须多次调用，不伪装成事务。
- `variable_patch` 不允许 patch namespace root，`path` 不能为空，且必须 resolve 到某个 `defineVariable` 变量根或它的子路径。
- `writeMode: "patch"` 是默认心智；Agent 可以选择局部 patch，也可以用单个 `replace` 操作完整重写变量根。
- `writeMode: "replace"` 字段先保留，但第一版不强制；是否完整重写先由 Agent 根据变量 schema、任务和 prompt 决定。
- `variable_patch` 不要求目标 path 曾被 `<VariableSchema>` 注入过；权限和 schema 以 registry 为准，`<VariableSchema>` 只是模型提示辅助。
- 如果 path 指向注册变量的子路径，resolver 尝试从父 schema 推导子 schema；无法推导时报 profile contract error。
- `<VariableSchema>` 可以只注入局部 schema。复杂变量不需要整个 schema 进 prompt，profile 作者应按任务裁剪 schema。
- Patch 成功后，Agent 要用 `variable_read` 验证重要结果。

Client patch：

- `client.*` patch 不直接写后端变量文件。
- 后端写 pending frontend command，并通过 SSE 发给前端。
- pending command 对应的 ack entry 形态：

```ts
type ClientPatchAckEntry = {
    type: "client_patch_ack";
    commandId: string;
    clientConnectionId?: string;
    namespace: "client";
    path: string;
    status: "applied" | "failed";
    error?: string;
    appliedValue?: JsonValue;
    appliedAt: number;
};
```

- 工具执行必须阻塞等待 `client_patch_ack`，第一版超时 10 秒。
- 前端 apply 成功后写 `client_patch_ack` session entry，工具再返回 `client_acknowledged`。
- ack 可以携带 `appliedValue`；如果不携带，后端使用原 patch 在本轮 client overlay 上计算新值。无论采用哪种方式，同一 invocation 后续 `variable_read` 必须读到已确认的 client 变更。
- 如果前端 apply 失败，也写失败 ack 或 lifecycle error，避免后端误以为 UI 已更新。
- 如果 10 秒内没有 ack，工具返回 error，并写 lifecycle error 或 tool error；不能写成功的 `variable_patch`。
- 可写 client 字段统一通过变量定义注册；未注册字段不允许 Agent patch。
- `client.*` patch 必须绑定本次 invocation 的前端连接，例如 `clientConnectionId` 或 `clientState.sourceId`。没有活跃前端连接时，工具直接返回“client state is not writable in this invocation”这类清晰错误，不创建 pending command。

### 8. Reminder / Watch 与变量系统

`Reminder` / `Watch` 应改为建立在 `ctx.vars` 的通用 path resolver 上。

目标：

- `Watch` 可以监听几乎所有可读变量路径，例如：
  - `client.currentProjectWorkspace`
  - `client.selectedFilePath`
  - `session.planMode.active`
  - `project.affections.hero`
  - `global.userPreferences.editorFont`
- `Reminder` 可以用同一套 `ctx.vars.get()` 计算 fingerprint，不再单独理解 `ctx.input`、`ctx.workspace` 等特殊来源。
- 需要读非变量上下文时，仍可显式使用 `ctx.session.*`、`ctx.input.*`、`ctx.runtime.*`，但这是 ctx path，不是 variable path。

为了降低心智负担，字符串 `watchPath` 只接受变量路径：

- `client.*`
- `global.*`
- `project.*`
- `session.*`

如果确实需要监听 `ctx.input`、`ctx.runtime` 或其他非变量上下文，使用函数形式：

```tsx
<Watch watch={(ctx) => ctx.input.foo} />
```

这样普通 profile 作者只需要学习一种字符串路径。

### 9. Profile 注入变量的 TSX Node / Helper

Profile 作者不应该必须手写底层 `ctx.vars.get()` 才能把变量放进 prompt，也不应该把完整变量 schema 每轮全量塞进模型。第一版新增 TSX Node / Helper：

```tsx
<Variable path="client.currentProjectWorkspace" />
<Variable path="project.affections.hero" fallback="unknown" />
<Variable title="Project variables" paths={["project.affections", "project.stage"]} render="block" />
<VariableSchema namespace="project" prefix="affections" maxItems={12} />
<VariableSchema paths={["project.affections.people1", "project.stage"]} includeToolGuide />
```

建议能力：

- `Variable`：读取一个或多个变量值；单个变量默认渲染为 string，多变量或 `render="block"` 时渲染为稳定 JSON / Markdown block。它通常是只读上下文。
- `VariableSchema`：注入变量系统 overview、局部 schema、可读/可写能力和变量工具使用方式。它不注册 per-turn binding，所有读写仍由变量 registry 和变量工具按 path 校验。
- `VariableWatch` 或扩展现有 `Watch`：监听变量路径变化。
- `VariableReminder` 或扩展现有 `Reminder`：基于变量 fingerprint 触发提醒。

底层仍然使用 `ctx.vars.get()`；TSX Node 只负责让 profile 书写更直观。

第一版对普通 profile 推荐只使用两个节点：

- `Variable`：读一个或一组变量。
- `VariableSchema`：给 Agent 局部 schema 和工具说明，让 Agent 知道能读写哪些变量。

`VariableWatch` / `VariableReminder` 可以先作为 `Watch` / `Reminder` 的变量 path 能力存在，不急着增加新的节点名，避免节点数量膨胀。

放置规则：

- `Variable` 第一版只允许放在 `ModelContext`，属于本轮模型上下文，不写 session。
- `VariableSchema` 第一版只允许放在 `ModelContext`；它和 `SkillCatalog` 类似，属于本轮模型上下文，不写 session。
- 不允许把变量 helper 放入 `System` / `HistorySet` / `AppendingSet`。如果 profile 作者确实要把稳定变量值写进这些区域，应在源码中显式读取并渲染普通字符串，不使用变量 helper。
- `VariableCatalog` 不自动注入所有 profile。Profile 需要通过 `<VariableSchema />` 显式注入。`leader.default` 可以默认放一个短 catalog。

`VariableSchema` 设计：

```tsx
<VariableSchema
    namespace="project"
    prefix="affections"
    maxItems={12}
    includeOverview
    includeToolGuide
/>
```

渲染时做三件事：

1. 输出变量系统 overview，例如当前可用 namespace、常见 path、读写工具名。
2. 根据 `namespace` / `prefix` / `paths` 输出局部 schema 摘要，避免把完整变量 schema 塞进 prompt。
3. 标注哪些变量可读、哪些变量允许 Agent patch。

`<VariableSchema>` 可以不传 `namespace`。此时只输出很短的全局 overview 和推荐查询方式，不输出具体 schema 条目。需要具体 schema 时，profile 应传 `namespace` / `prefix` / `paths`，或让 Agent 调用 `variable_schema` 查询。

Agent 感知到的 overview 推荐渲染为稳定 Markdown，而不是裸 JSON：

```md
## Variable System

Variables are typed JSON values. Use variables for application state, user-defined project state, and session-local state.

Namespaces:
- client.*: current frontend state. Writable client variables require frontend acknowledgement before the tool returns.
- global.*: Workspace Root variables stored in Workspace Root .nbook/agent/variables.json.
- project.*: Project Workspace variables stored in Project Workspace .nbook/agent/variables.json.
- session.*: current session variables stored in session history.

Tools:
- variable_schema: inspect focused variable schemas. Use namespace/prefix/paths; do not request everything.
- variable_read: read a registered variable path by namespace + path. For large objects, read smaller subpaths.
- variable_patch: update a writable registered variable path by namespace + path with RFC 6902 JSON Patch. After important changes, read again to verify.

Profile-selected schemas:
- project.affections.*: character affection values. Writable by agent.
- project.stage: current project stage. Read-only.
```

变量系统的正式心智模型采用 **namespace + 小 JSON**，而不是“一个可直接 patch 的全局大 JSON”。

原因：

- `client`、`global`、`project`、`session` 的存储、生命周期和写入副作用完全不同。
- `client.*` patch 需要前端 ack；`project.*` patch 写 Project Workspace 文件；`session.*` patch 写 session JSONL。
- 如果把所有变量伪装成一个可直接 patch 的大 JSON，会让 Agent 和 profile 作者误以为一次 patch 可以跨 namespace 原子修改。
- namespace 让变量权限、schema、默认值、并发和审计都能按边界处理，心智负担反而更低。

所以，profile 作者和 Agent 应该理解为：

```ts
clientVariables: JsonObject
globalVariables: JsonObject
projectVariables: JsonObject
sessionVariables: JsonObject
```

对外路径仍写成 `project.affections.people1` 这种完整变量路径；但工具执行和 storage 内部会先解析 namespace，再在对应的小 JSON 上应用 patch。

统一大 JSON 只作为调试/文档投影视图：

```json
{
  "client": {},
  "global": {},
  "project": {},
  "session": {}
}
```

它不是 patch 工具的原子写入对象，也不是持久化格式。

`VariableCatalog` 是 Agent 和 profile 作者感知变量结构的主要入口。它不是完整变量值，也不是完整 schema dump，而是“注册变量根目录”，用于回答三件事：

1. 当前有哪些 namespace。
2. 每个 namespace 里注册了哪些变量根。
3. 每个变量根的 schema 引用是什么，需要时应该用哪个 path 去查局部 schema 或读取值。

`VariableCatalog` 推荐按 namespace 分成小 JSON：

```json
{
  "clientVariables": {},
  "globalVariables": {},
  "projectVariables": {},
  "sessionVariables": {
    "affections": {
      "$ref": "#/sessionVariables/affections",
      "summary": "Affection values by character name.",
      "readable": true,
      "writableByAgent": true
    }
  }
}
```

这里的 `affections` 是注册变量根，不是当前变量值。`$ref` 借用 JSON Schema 直觉表达“这里有 schema 引用”；它指向 catalog/schema registry 中的变量根 schema。需要具体 schema 时用 `variable_schema` 查询，需要当前值时用 `variable_read` 查询。

内部结构建议是：

```ts
type VariableCatalog = {
    summary: string;
    clientVariables: Record<string, VariableRootCatalogItem>;
    globalVariables: Record<string, VariableRootCatalogItem>;
    projectVariables: Record<string, VariableRootCatalogItem>;
    sessionVariables: Record<string, VariableRootCatalogItem>;
};

type VariableRootCatalogItem = {
    $ref: string;
    title?: string;
    summary?: string;
    readable: boolean;
    writableByAgent: boolean;
};
```

`$ref` 使用 JSON Schema 风格的本地引用，例如 `#/sessionVariables/affections`，不使用自定义 URI。它指向 `VariableCatalog` 内部位置，也表达“这是 schema 引用，不是当前值”。

如果 `<VariableSchema>` 选择了局部 schema，可以额外附加 schema 摘要：

```ts
type SelectedVariableSchema = {
    path: string;
    rootPath: string;
    relativePath?: string;
    $ref: string;
    title?: string;
    description?: string;
    readable: boolean;
    writableByAgent: boolean;
    schemaSummary: string;
};
```

`VariableCatalog` 和局部 schema 可以由 `<VariableSchema>` 渲染成 Markdown，也可以由 `variable_schema` 工具返回给 Agent。重点是给 Agent 一个“注册变量根目录”和“下一步该查什么”的入口，而不是全量 schema dump。

`variable_schema` 的 `paths` 参数使用 full path，例如 `project.affections.alice`；批量查询也可使用 `namespace + prefix`。`variable_read` / `variable_patch` 的运行读写入口则使用 `namespace + path`。

Agent 如果需要查看当前值，应调用变量读取工具：

```json
{
  "namespace": "project",
  "path": "affections.people1"
}
```

变量工具返回当前 JSON value 和 schema 摘要。Agent 再提交 patch：

```json
{
  "namespace": "project",
  "path": "affections.people1",
  "patch": [
    {"op": "replace", "path": "/score", "value": 42}
  ],
  "note": "increase score after the user confirmed the relationship improved"
}
```

Patch 成功后，工具结果只返回简短成功摘要、目标路径、变更数量和 fingerprint，不返回完整 updated value。Agent 如果要确认，必须再次调用 `variable_read`。这让变量修改流程和文件工具的“read -> patch/edit -> read verify”心智一致，同时避免 patch 结果把无关上下文塞回模型。

这样 profile 作者能控制哪些变量暴露给 Agent 更新，也能在同一个 profile 中放多个 helper。规则：

- `VariableSchema` 只暴露 schema 和能力，不注册 target id。
- 同一轮可以有多个 `VariableSchema`，用于向模型展示不同局部 schema。
- 工具执行时必须校验变量已注册、可读/可写权限满足、变量定义允许 `writableBy: ["agent"]`。
- Patch 前后都要跑 schema 校验；失败时返回 tool error，不写变量。
- fingerprint / revision 由工具内部维护和返回；不要求 Agent 手写 `baseFingerprint`。如果当前值已变化，工具返回“变量已变化，请重新读取后再修改”。

优化点：

- `<VariableSchema>` 不应成为变量真相源；它只是“把 registry 中的局部 schema 和工具指南暴露给模型”。真相仍在 registry、`ctx.vars` 和变量 storage。
- 工具写入目标使用 `namespace + path`。Agent 能读全部已注册可读变量，但写入必须通过 registry 的 `writableBy` 和 schema 校验。
- 复杂对象和数组建议 profile 作者通过 `${}` / `ctx.vars` 写自定义值渲染，schema 也通过 `paths` / `prefix` 裁剪，不强行用低代码 helper 覆盖所有情况。
- 对 client 变量的 `writable` 要更谨慎：工具 patch 后应产出 frontend patch command，由前端 apply，而不是后端假装已改成功。
- `VariableSchema` 的运行输出是 string，不把复杂对象直接塞进 provider 特殊通道。

### 10. Frontend State 同步

前端需要有一个统一的 snapshot builder：

```ts
buildAgentClientState(): ClientStateSnapshot
```

它不再叫 profile input，也不直接塞进 `ctx.input`。invoke 请求增加：

```ts
{
    mode: "prompt",
    message: {text},
    clientState: buildAgentClientState()
}
```

`continue`、tool approval、user input resolution、tree next invoke 也必须携带同样的 `clientState`，否则 prepare 看到的仍可能是旧 UI 状态。

### 11. DSL Path

字符串 `watchPath` 只支持变量路径：

- `client.*`
- `global.*`
- `project.*`
- `session.*`

非变量上下文不进入字符串 path 语法。如果确实需要监听 `ctx.session`、`ctx.input`、`ctx.invocation`、`ctx.runtime` 或其他上下文，使用函数形式：

```tsx
<Watch watch={(ctx) => ctx.input.foo} />
```

不保留 `ctx.workspace.*` alias。需要 Project Workspace 时使用变量系统：

- `client.currentProjectWorkspace`
- `ctx.vars.get("client.currentProjectWorkspace")`

### 12. ProjectReminder 修复目标

`ProjectReminder` 不应继续读 `ctx.input.studio.workspace`。

目标改为：

```ts
watchPath: "client.currentProjectWorkspace"
```

不提供 `ctx.workspace.currentProject` legacy fallback。

## Implementation Plan

1. 建立变量术语和类型
   - 新增 `VariableNamespace`、`VariableDefinition`、`VariableSnapshot`、`ProfileVariableAccessor`、`ClientStateSnapshot`。
   - 明确 `ctx.input`、`ctx.invocation`、`ctx.vars` 的职责边界。
   - Accessor 统一为 entry-bound，默认 anchor 当前 active leaf。
   - 同步 profile 作者心智模型：固定输入用 `ctx.input`，读变量用 `<Variable>`，看 schema 用 `<VariableSchema>`，写变量用变量工具。

2. 改 invocation DTO 与前端同步
   - `AgentInvokeRequestDto` 增加 `clientState`。
   - `NovelAgentDrawer` 所有 invoke 入口传最新 `buildAgentClientState()`。
   - 先不把业务 input 并入变量系统。

3. 改 harness prepare context
   - 每轮 invoke 前创建绑定当前 session active path 的 `ProfileVariableAccessor`。
   - `ProfilePrepareContext` 增加 `vars` 和 `invocation`。
   - snapshot system prompt / detail / preview 若没有显式 `clientState`，则使用 dry-run accessor；`project.*` 标记为 unavailable，不使用最后已知 Project Workspace，避免重新引入 stale Project Workspace。

4. 改 DSL path resolver
   - `watchPath` 字符串只支持变量路径：`client.*`、`global.*`、`project.*`、`session.*`。
   - 非变量上下文只支持函数形式 `watch={(ctx) => ...}`；删除 `ctx.workspace.*` 支持。
   - `ProjectReminder` 迁到新 path。
   - 新增 `Variable` TSX Node Helper，支持单变量和多变量 block 渲染。
   - 新增 `VariableSchema`，`Variable` / `VariableSchema` 第一版只允许在 `ModelContext`。

5. 落 session 级变量写入
   - 新增 `variable_patch` entry，替代旧 `variable_change`。
   - reduce 后进入 `ctx.vars.snapshot.session`，不再只藏在 `customState["variable:<key>"]`。
   - Reminder / Watch 的 `profileState.${profileKey}` 第一版不并入 session variables；后续单独评估。

6. 落 Workspace Root / Project 持久变量服务
   - 新增变量文件读写 service。
   - 支持 schema 校验和默认值。
   - Workspace Root 级变量第一版写入 `workspace/.nbook/agent/variables.json`。
   - Project 级变量第一版写入 `workspace/{project}/.nbook/agent/variables.json`。
   - 暂不做复杂 UI。

7. 前端状态写回
   - 新增后端到前端的 UI patch/session entry。
   - 前端 apply 后更新本地 store，并写 `client_patch_ack` entry。
   - 下一轮 invoke 回传最新 client state。

8. Agent 变量 patch 工具
   - 新增变量工具：`variable_schema`、`variable_read`、`variable_patch`。
   - `variable_schema` 按参数读取局部 schema，不提供无参数全量 schema dump。
   - `variable_read` 按 `namespace + path` 读取已注册可读变量。
   - `variable_patch` 按 `namespace + path` 修改已注册且允许 Agent 写入的变量。
   - `namespace + path` 定位 patch target，JSON Patch operation path 相对 target；完整替换 target 时 operation path 使用空字符串 `""`。
   - Patch 前后执行 schema 校验。
   - 工具内部维护和返回 fingerprint / revision，防止 stale patch；不要求 Agent 手写 `baseFingerprint`。
   - Project/global patch 写 `variables.json`，并尽力写当前 session 审计 entry；变量文件是真相源，审计失败必须显式报错。
   - 记录 JSON-Whisperer 等 LLM JSON Patch 相关资料，后续决定是否引入。

9. 落变量 definition `.compiled` 合同
   - 新增 definition compiler / manifest，运行时只加载 hash 匹配的 `.compiled` artifact。
   - Workspace Root/global definition 使用 `workspace/.nbook/agent/variables/.compiled/manifest.json`。
   - Project definition 使用 `workspace/{project}/.nbook/agent/variables/.compiled/manifest.json`。
   - profile 内 `defineSessionVariable(...)` 随 profile `.compiled` artifact 注册。
   - 缺少、过期或加载失败的 definition 不参与 registry，并返回 `not_compiled` / `compile_stale` / `compiled_load_failed` issue。

10. 文档和测试
   - 更新 harness/profile 文档。
   - 增加 ProjectReminder 跨 Project 触发测试。
   - 增加 invoke clientState 传递测试。

## Decisions

- `ctx.input` 不再承载浏览器状态。
- `invoke` 的业务 input 本次先不进入变量系统。
- `client` state 是变量系统的一个内建 volatile namespace。
- `ctx` 与变量系统不等价；`ctx` 是 harness 注入容器，变量系统以 `ctx.vars` 的形式被持有。
- 提供给 profile 的变量系统统一为 entry-bound accessor，而不是裸 JSON snapshot。
- `TInput` 是 profile 的长期输入合同；`invocation.input` 是本次 invoke 的一次性输入，不应混用。
- Workspace Root 级持久变量第一版使用单文件 `workspace/.nbook/agent/variables.json`。
- Project 级持久变量第一版使用单文件 `workspace/{project}/.nbook/agent/variables.json`。
- `variables.json` 使用 `{schemaVersion, variables}` 包装格式。
- 对外变量根使用 `global.*` 表达 Workspace Root 级变量，降低用户心智负担；存储位置仍是 Workspace Root `.nbook`。
- 变量定义来源分层：system/global 由 Workspace Root `.nbook` / user-assets 管理，Project 由 Project Workspace 管理，Session 由 profile 注册。
- 变量写权限用 `writableBy` 表达，第一版用于合同、UI 和运行时写入校验，不作为安全沙箱。
- Profile 注入变量通过新增 TSX Node / Helper 提供易用入口，底层仍使用 `ctx.vars`。
- 变量读取 helper 只保留 `Variable`；`VariableBlock` 合并为 `Variable render="block"` / `paths` 模式。
- `Variable` 注入变量值，默认作为只读上下文使用；这类直接注入的变量通常不提供 Agent 修改入口。
- `VariableSchema` helper 注入变量系统 overview、局部 schema、可读/可写能力和变量工具指南。
- 变量系统正式心智模型是 `client/global/project/session` namespace + 小 JSON；统一大 JSON 只作为调试/文档投影视图，不作为 patch 工具的原子写入对象。
- Agent 感知到的 `VariableCatalog` 是按 namespace 分组的注册变量根目录，不是完整变量值，也不是完整 schema dump。
- `VariableCatalog` 去掉 `namespaces` 包装，顶层直接包含 `clientVariables`、`globalVariables`、`projectVariables`、`sessionVariables`；`$ref` 使用 JSON Schema 风格本地引用，例如 `#/sessionVariables/affections`，不使用自定义 URI。
- `VariableCatalog` 同时展示 `readable` 和 `writableByAgent`。
- `VariableSchema` 渲染结果是 string；不注册 per-turn target binding。
- `VariableSchema` 的 schema 由变量 registry 按 `namespace` / `prefix` / `paths` 自动推导，包括用户自定义变量。
- schema 自动推导第一版支持 TypeBox 的稳定子集；复杂 ref/recursive/conditional schema 要求注册更明确的子 path definition。
- `Variable` / `VariableSchema` 第一版只允许放在 `ModelContext`，不允许放在 `System`、`HistorySet`、`AppendingSet`。
- Agent 变量工具第一版为 `variable_schema`、`variable_read`、`variable_patch`。
- `variable_schema` 按参数返回局部 schema，不提供全量变量 schema dump。
- `variable_schema.paths` 使用 full path；`namespace + prefix` 用于批量查询。
- `variable_read` 允许读取所有已注册且可读的变量，按 `namespace + path` 读取。
- `variable_patch` 允许按 `namespace + path` 修改已注册且允许 Agent 写入的变量。
- 同一轮内变量 patch 后，后续 read 必须看到刚写入的值。
- 已注册变量缺少持久值时，读取 overlay 默认值；第一次 patch 会 materialize 到对应真相源。
- 未注册字段保留但不能通过变量工具读写。
- schema 不匹配的持久值不返回给模型，`variable_read` 返回结构化 schema error。
- schema 变更后的 repair/migrate 本次不做自动迁移。后续再设计 `variable_repair` 或 UI 修复。
- `project.*` 必须由本轮 `client.currentProjectWorkspace` 定位，不 fallback 到 session metadata / novelId。
- `session.*` definition 第一版只允许 profile 注册，工具不能动态注册。
- Project/global patch 不承诺跨文件和 JSONL 的真正原子事务；变量文件是真相源，session audit entry 是可观测记录，audit 失败时必须记录 lifecycle error 或返回 tool error。
- `variable_patch` 成功结果不返回完整 updated value；Agent 需要用 `variable_read` 验证重要结果。
- `variable_patch` 第一版强制同一 invocation 内 read-before-patch：Agent 必须先调用 `variable_read`，后端记录该 path 的 fingerprint；patch 时校验当前 fingerprint，读后被其它写入改变则返回 stale error。
- Agent 修改变量通过 RFC 6902 JSON Patch 工具完成。
- 新增 `variable_patch` entry；旧 `variable_change` 不作为新系统入口继续扩展。
- `variable_patch` entry 只记录变更事实，不保存完整 before/after value；Project/global 变量 patch 会写当前 session 审计 entry，但不进入模型 messages。
- `session.*` 变量只存在 session JSONL，不写变量文件。
- `client.*` patch 需要前端 ack entry；可写 client 字段统一通过变量定义注册。
- `client.*` patch 必须绑定本次 invocation 的前端连接；没有活跃前端连接时不创建 pending command，直接返回不可写错误。
- Workbench preview 禁止真实变量写入，只允许 in-memory overlay 模拟。
- snapshot system prompt、profile detail、Workbench preview 等非真实 invocation 场景也禁止真实变量写入；没有显式 `clientState` 时不解析 `project.*`，而是返回 unavailable issue。
- TS/TSX 变量定义必须走 `.compiled` 运行真相源，runtime 不自动编译定义文件。
- 变量定义 `.compiled` artifact 进入系统 assets 同步链路。
- Workspace Root/global definition artifact 位于 `workspace/.nbook/agent/variables/.compiled/`，Project definition artifact 位于 `workspace/{project}/.nbook/agent/variables/.compiled/`；profile 内 session definition 随 profile `.compiled` 加载。
- 变量工具默认进入 `leader.default` allowed tools；主提示词只写简短 read/patch/read 验证流程，不展开 storage 细节。
- Project Workspace 相关变量必须使用 Project Workspace 术语，不把它简写成 workspace。
- Agent 修改前端状态必须通过显式 patch/event 管线，不能在后端假装直接修改浏览器内存。
- 不保留 `ctx.workspace` legacy alias；本次变量系统重构硬切。
- `profileState.${profileKey}` 当前只保存 Reminder / Watch 内部 runtime state；第一版不迁入 session variables。
- 对外心智模型要一次性收紧：不保留 legacy alias，不推荐直接 patch 任意 path，不让普通 profile 作者理解 runtime state。

## Files Changed

- `docs/tasks/10-agent-variable-system/README.md`
- `shared/dto/agent-session.dto.ts`
- `app/components/novel-ide/NovelAgentDrawer.vue`
- `app/components/novel-ide/agent/client-variables.ts`
- `app/components/profile-template-editor/profile-template-tree-utils.ts`
- `server/agent/harness/neuro-agent-harness.ts`
- `server/agent/harness/types.ts`
- `server/agent/http.ts`
- `server/agent/profiles/types.ts`
- `server/agent/profiles/profile-dsl.ts`
- `server/agent/profiles/profile-dsl/jsx-runtime.ts`
- `server/agent/profiles/profile-http-service.ts`
- `server/agent/session/types.ts`
- `server/agent/session/session-repo.ts`
- `server/agent/tools/types.ts`
- `server/agent/tools/builtin-tools.ts`
- `server/agent/variables/*`
- `assets/workspace/.nbook/agent/profiles/builtin/leader.default.profile.tsx`
- `assets/workspace/.nbook/agent/profiles/builtin/leader.assets.profile.tsx`
- `assets/workspace/.nbook/agent/profiles/builtin/writer.profile.tsx`
- `assets/workspace/.nbook/agent/profiles/.compiled/*`
- `workspace/.nbook/agent/profiles/.compiled/*`
- `server/agent/profiles/profile-dsl.test.ts`
- `server/agent/profiles/catalog.test.ts`
- `server/agent/profiles/leader-assets-profile.test.ts`
- `server/agent/harness/neuro-agent-harness.test.ts`
- `server/agent/variables/variables.test.ts`
- `server/agent/variables/test-utils.ts`

## Verification

- `bunx tsc --noEmit --pretty false`
- `bunx vitest run server/agent/variables/variables.test.ts server/agent/profiles/profile-dsl.test.ts`
- `bunx vitest run server/agent/profiles/leader-assets-profile.test.ts server/agent/profiles/catalog.test.ts`
- `bunx vitest run server/agent/harness/neuro-agent-harness.test.ts`
- `bun scripts/prepare-system-profile-metadata.ts`
- 代码搜索确认 active 代码中不再保留 `ctx.workspace` / `ctx.input.studio` 旧入口。

## Implementation Walkthrough

### 2026-05-25

- 新增 `server/agent/variables` 核心模块：
  - 固定 namespace：`client`、`global`、`project`、`session`。
  - `VariableRegistry` / `VariableSchemaResolver` / `VariableFileStorage` / `ProfileVariableAccessor`。
  - `VariableCatalog` 顶层直接暴露 `clientVariables`、`globalVariables`、`projectVariables`、`sessionVariables`，不再使用 `namespaces` 包装。
  - TypeBox resolver 第一版支持 Object、Record / `patternProperties`、Array、保守 Union / Intersect。
  - `VariableRegistry.query({paths})` 支持注册根下的子路径 schema 推导，例如 `project.affections.alice` 可解析为 number schema。
  - JSON Patch 支持 `add` / `replace` / `remove` / `test`，operation path 相对 `namespace + path` target，空字符串 `""` 表示完整 target。
- `AgentInvokeRequestDto` 与 harness `InvokeAgentInput` 增加 `clientState`。
  - Novel Agent Drawer 的 prompt、continue、tool/user-input resolution、tree + invoke 路径都会传 `buildAgentClientState()`。
  - create session 不再把浏览器状态写入 profile `input`，默认传 `{}`。
  - `ctx.input` 回到 profile 静态输入；本轮浏览器状态进入 `ctx.invocation.clientState` 和 `ctx.vars.client.*`。
- `ProfilePrepareContext` 增加 `vars` 和 `invocation`。
  - `prepare`、`ingest`、snapshot system prompt、profile preview 都使用 dry-run 或 runtime accessor。
  - snapshot/detail/preview 不做真实变量写入。
  - profile 内 `variableDefinitions` 支持注册 `session.*` 变量定义，并随 profile `.compiled` artifact 进入 harness/tool runtime。
- 新增 session entry：
  - `variable_patch`
  - `client_variable_patch_ack`
  - session 级变量通过 active path replay `variable_patch`，能跟随分支回退。
- `client.*` patch 在真实 invocation 中通过 SSE 投递 `client_variable_patch_requested`，前端 ack 后写入 `client_variable_patch_ack`，成功时更新本轮 client overlay，失败/超时返回 tool error。
- 新增 Agent 工具：
  - `variable_schema`
  - `variable_read`
  - `variable_patch`
  - 工具进入 builtin registry；`leader.default` allowed tools 已加入这三个工具。
  - `variable_read` / `variable_patch` 会按注册 schema 做 TypeBox `Value.Check`；`variable_read` 保持返回结构化 issue，`variable_patch` 遇到不可写、schema mismatch、unavailable、not registered 等问题会抛错，由 harness 生成 error tool result。
  - `variable_schema` 按 `paths` 或 `namespace + prefix` 查询时默认返回对应 `schemas`；`detail` 只控制附加字段完整度，不再决定是否返回 schema。
  - `project.*` 缺少本轮 `client.currentProjectWorkspace` 时返回 `unavailable`，不 fallback 到 session metadata / novelId。
- DSL 变更：
  - 字符串 `watchPath` 只接受变量路径：`client.*`、`global.*`、`project.*`、`session.*`。
  - 非变量上下文改用函数 `watch={(ctx) => ...}`。
  - 删除 active runtime 对 `ctx.workspace` / `ctx.input.studio` 的依赖。
  - 新增 `<Variable>` 和 `<VariableSchema>`，第一版只允许作为 `<ModelContext>` 直接子节点。
  - 硬删除 `ProjectReminder` / `PlotFocusReminder` 简单 helper；`leader.default` 改用普通 `Reminder` 内联 Project Workspace 和 Plot Focus 提醒。
  - `LinkedAgentsReminder`、`TaskReminder`、`PlanModeReminder` 改为函数 watch，不再使用旧 `ctx.session.*` 字符串路径。
- Profile 迁移：
  - `leader.default` 只注入聚焦的 `client.currentProjectWorkspace` variable schema 和简短变量工具工作流。
  - `leader.assets` 移除 `ctx.workspace.root` watchPath。
  - 系统 profile `.compiled` 已重新生成。
  - 当前用户 profile 覆盖 `.compiled` 也已手动重新编译，避免 compiled-only catalog 被 stale 用户覆盖遮蔽。
- 本轮补完：
  - 新增 `createVariableRegistryForProfile()` / `createVariableRegistryForSession()`，harness、Workbench preview、profile detail 统一使用内建变量 + profile `session.*` definitions；真实 invocation 有 `clientState` 时额外加载 Workspace Root / Project Workspace 编译后的 definition artifact。
  - `storage_error` 与 `not_registered` 已分开：registry resolve 失败才是 `not_registered`；`variables.json` 读取、JSON parse、格式非法、IO 错误归为 `storage_error`。
  - `ClientStateSnapshotDto` 支持 `ide`、`studio` 和额外 top-level JSON 字段，并保留 `studio.workspace -> client.currentProjectWorkspace` 派生。
  - `client.*` 前端 ack 管线已落地：后端 pending command + SSE event + ack API + ack entry + 同轮 overlay 更新。当前真实 store 写回只开放低风险字段 `client.ide.activePanel` 和 `client.ide.theme`；其他字段可计算 appliedValue 并 ack，但不直接改复杂 UI store。
  - 新增 Workspace Root / Project variable definition `.compiled` 第一版：`server/agent/variables/definition-artifact.ts` 编译/加载 `definitions.ts|tsx|js|mjs`，runtime 只加载 hash 匹配 artifact，缺失/过期/加载失败暴露 `not_compiled` / `compile_stale` / `compiled_load_failed` issue。
  - 系统 assets 增加 `assets/workspace/.nbook/agent/variables/definitions.ts`，`scripts/prepare-system-profile-metadata.ts` 会预编译系统 variable definition artifact；user-assets sync 在未手改时同步源码和 `.compiled` artifact，手改或缺 sync state 时保留用户文件并提示 warning。
  - Workbench 变量面板展示 `client/global/project/session` registry catalog，路径使用 `client.ide` / `session.foo` 这类真实变量路径。

## Plan Deviations

- `client.*` 前端 ack 管线已实现，但真实 UI store 写回只先开放 `client.ide.activePanel` 和 `client.ide.theme`。打开文件、切换 Project、编辑器字体等复杂状态后续需要逐字段接入现有 store action，避免绕开保存冲突和 workspace 切换流程。
- 变量 definition `.compiled` 已有 compiler、manifest、runtime 加载、user-assets 同步第一版和 `variable definition` CLI；尚未提供 Workbench 可视化编辑。
- 持久变量文件写入已实现 atomic replace、文件级 promise lock、注册 path read/patch 的 TypeBox value 校验；尚未对 `variables.json` 文件内未注册字段做全文件级清理或迁移。
- `variable_change` 旧 entry 已从 v3 active 类型和 reducer 硬删除，不再做 legacy 兼容。旧 session 如仍含该 entry，需要按新任务单独做迁移或删除。
- `variable_patch` 已加入同一 invocation 的 read-before-patch fingerprint 防护：未先 read 会返回 `stale_read_required`，读后目标被其它写入改变会返回 `stale_fingerprint`。
- `client.*` ack 后的 overlay 已提升到 invocation 级共享 state；同一 invocation 后续新建 accessor 也能 read-after-write。
- Project/global patch 如果 `variables.json` 已写入但 session audit entry 失败，工具会返回明确半提交错误，提示先 `variable_read` 确认当前值，避免重复 patch。
- 新增 Agent runtime 变量 CLI：
  - 稳定入口为 `.nbook/agent/bin/variable` 与 `.nbook/agent/bin/variable.cmd`；Source checkout wrapper 调用 Product-owned source entry，发行物通过 Product Runtime Contract 的 `variable` 逻辑命令解析。
  - 支持 `variable definition status/check/compile --global` 与 `variable definition status/check/compile --project <projectWorkspace>`。
  - 下方早期记录中的 repo-backed shim、`scripts/variable.ts` 与 `assets/workspace/.nbook/agent/scripts/variable.ts` 只保留为历史证据；不恢复旧路径 fallback。
- `variable_schema` 现在返回与查询相关的 definition issue；无关 namespace 的 stale definition 不会阻塞当前 namespace schema 查询。

## TODO / Follow-ups

- 扩展 `client.*` 前端真实写回字段：编辑器字体、选中文件、Project 切换等需要逐字段绑定现有安全 store action。
- 增加变量 definition 与 `variables.json` 的管理 UI，并决定是否需要全文件级校验与迁移命令。
- 根据本文档继续 grill frontend writable state 权限。
- 调研 JSON Patch 与 LLM 结构化编辑库，包含 JSON-Whisperer。
- 后续评估是否把 `profileState.${profileKey}` 迁入 `session.profileState.*`。

## Validation

- `bun scripts/prepare-system-profile-metadata.ts`
- `bunx tsc --noEmit --pretty false`
- `bunx vitest run server/agent/variables/variables.test.ts`
- `bun scripts/variable.ts definition status --global`
