---
schema: nbook.spec/v1
kind: behavior
status: planned
capability: harness.profile
owners:
  - nb-harness
---

# Harness Profile：提示词布局与可注册的节点

## 目标与非目标

`nb-harness` 的 `profile` 模块让作者用 TSX 声明一类 Agent：它是谁、给模型的请求怎样排布、要用哪些数据、带哪些字段（工具、模型、审批模式等）。模块的内核只有布局、渲染与注册三件事：消息节点、内容节点、有状态节点、数据源与 Profile 字段都经同一套注册接口进入，内置的也一样。渲染是纯函数：输入 Profile、已取好的数据、会话历史与状态，输出这一次发给模型的系统提示词与消息序列，以及要写进会话的种子、追加消息与状态更新；它不调用模型、不读写会话、不做 I/O（数据源的取数由注册方实现，在渲染前完成）。

不承诺：

- 执行模型调用、写回会话、触发压缩：由 runtime 与压缩模块负责。
- 具体字段的含义（工具列表、模型偏好、审批模式、设置、压缩策略、输入输出 schema）：由注册这些字段的模块各自规定。
- 具体数据节点（技能目录、Agent 目录、共享文档导入等）：由提供数据的模块注册与规定。
- 隔离 Profile 代码：加载 Profile 就是执行它的模块代码，Profile 文件一律受信任。
- 设置表单、Profile 编辑界面、编译产物与缓存。
- 与旧应用 Profile SDK（`nbook/profile-sdk`）及旧原型 `nb-profile` 的兼容。

## 术语与参与者

- **Profile**：`defineProfile` 的结果：标识、名称、说明、版本、字段与一个返回节点树的提示词函数。
- **节点**：TSX 产生的普通数据 `{type, props, children}`；`type` 是节点类型 id。
- **节点类型**：注册给主机的一类节点：类别、props 的 schema、可以放在哪些父节点里、可以有哪些子节点、依赖的数据源与渲染函数。
- **布局节点**：`Prompt`、`System`、`History`、`Appending`、`Input`，由本模块固定，不开放注册。
- **主机**：一份节点类型、数据源与字段的注册表，加上用这份注册表渲染 Profile 的能力；每个主机互相独立，没有全局注册表。
- **数据源**：带类型的数据名，注册时给出取数函数与取数时机；节点在渲染时只读取已取好的数据。
- **Profile 字段**：注册给主机的字段 id 与 schema；Profile 在 `fields` 里按字段 id 给值。
- **种子**：`History` 的子节点渲染出的消息；新会话开始时写进会话，每次压缩后再写一次（标了 `once` 的除外）。会话中的形状见 [`harness.session`](session.md)。
- **追加消息**：`Appending` 渲染出的消息；调用开始时写进会话，之后是历史的一部分。
- **请求消息**：`History`、`Appending` 之外、直接放在 `Prompt` 下的消息，只用于本次请求，不写进会话。
- **轮**：从一条用户消息开始、到下一条用户消息之前的消息；第一条用户消息之前的消息算作第一轮。

## 输入与前置条件

### 定义 Profile

```tsx
/** @jsxImportSource @notnotype/nb-harness/profile */
import {Appending, defineProfile, History, Input, Prompt, Reminder, System, Tag, User} from "@notnotype/nb-harness/profile";
import {SkillCatalog} from "<技能模块>";        // 由技能模块注册的内容节点，示意

export default defineProfile({
    id: "writer", name: "写作助手", description: "修改小说章节", version: 1,
    fields: {"harness/tools": ["read", "edit"], "harness/model": {role: "main"}},
    prompt: (ctx) => (
        <Prompt>
            <System>你是写作助手。</System>
            <History>
                <User once>本会话的任务：{ctx.session.title ?? "未命名"}</User>
                <User><SkillCatalog /></User>
            </History>
            <User><Tag name="workspace">当前工作区：…</Tag></User>
            <Appending>
                <Input />
                <Reminder id="style" every={5}>保持第三人称。</Reminder>
            </Appending>
        </Prompt>
    ),
});
```

| 字段 | 规则 |
|---|---|
| `id` | 1–64 个字符，`[a-z0-9]` 开头，其余为 `[a-z0-9._-]` |
| `name`、`description` | 非空字符串 |
| `version` | 正整数 |
| `fields` | 键是已注册的字段 id，值符合该字段的 schema |
| `prompt` | `(ctx: PromptContext) => 节点`，返回的根必须是 `Prompt` |

```ts
type PromptContext = {
    session: {id: string; title?: string; createdAt: string};
    turn: number;                 // 本次调用是会话的第几轮，从 1 起
    now: Date;
    fields: Readonly<Record<string, JsonValue>>;   // 已校验的字段值
};
```

提示词函数只能读 `ctx`；需要外部数据时用读数据源的节点。

### 节点与父子关系

| 节点 | 类别 | 可以放在 | 可以有的子节点与属性 |
|---|---|---|---|
| `Prompt` | 布局（根） | 只能是根 | `System`、`History`（布局形式）、`Appending`、消息节点、`Fragment` |
| `System` | 布局 | `Prompt` | 文本、内容节点；只能是文字 |
| `History`（布局形式） | 布局 | `Prompt`；可以有多个，也可以没有 | 种子：消息节点（可带 `once`）；属性 `last?: number`（只取最后几轮）。最多一个 `History` 有子节点 |
| `History`（文本形式，`as="text"`） | 内容 | 消息节点内 | 无子节点；属性 `last?: number`；把历史渲染成一段文字 |
| `Appending` | 布局 | `Prompt`，最多一个 | 消息节点、`Reminder`、`Input`；`Input` 至多一个 |
| `Input` | 布局 | 只能在 `Appending` | 无 |
| `User`、`Assistant`、`Developer` | 消息 | `Prompt`、`History`（种子）、`Appending` | 文本、内容节点；`Image` 只能放在 `User` 里 |
| `Reminder` | 有状态 | 只能在 `Appending` | 文本、内容节点；属性 `id`（必填，Profile 内唯一）、`when?: boolean`、`every?: number`、`watch?: JsonValue`、`once?: boolean` |
| `Tag` | 内容（块级） | 消息节点、`System`、`Reminder` | 文本、内容节点；属性 `name`（`[a-z][a-z0-9-]*`） |
| `Image` | 内容 | `User` | 无；属性为图片数据（MIME 类型与 base64）或读取图片的数据源 |
| `Fragment` | 结构 | 任意位置 | 与它所在的父节点相同 |
| 已注册的消息、内容、有状态节点 | 按注册 | 按注册时声明 | 按注册时声明 |

条件与循环用 TSX 表达式（`{cond && <X/>}`、`items.map(…)`），没有专门的条件节点；`null`、`undefined`、`false` 与空数组不产生内容。

### 注册

```ts
// 公开入口 @notnotype/nb-harness/profile
createProfileHost(): ProfileHost;                  // 已注册内置的消息、内容与有状态节点
interface ProfileHost {
    registerNodeType(definition: NodeTypeDefinition): Result<{dispose(): void}>;
    registerSource(definition: SourceDefinition): Result<{dispose(): void}>;
    registerField(definition: FieldDefinition): Result<{dispose(): void}>;
    prepare(profile: Profile, input: {context: PromptContext; signal?: AbortSignal}): Promise<Result<PreparedProfile>>;
    renderSeeds(prepared: PreparedProfile, occasion: "new-session" | "after-compaction"): SeedOutput;
    renderAppending(prepared: PreparedProfile, input: {input: UserInput; state: ProfileState}): AppendingOutput;
    renderRequest(prepared: PreparedProfile, input: {history: readonly Message[]}): RequestOutput;
    renderSystem(prepared: PreparedProfile): {systemPrompt: string[]};
}
type NodeTypeDefinition = {
    id: string;                                     // <命名空间>/<名称>
    category: "message" | "content" | "stateful";
    props: TSchema;
    parents: readonly string[];                     // 可以放在哪些节点类型里
    children: "none" | "content" | readonly string[];
    sources?: readonly string[];                    // 依赖的数据源 id
    render: (node, context) => 节点或消息或文本;     // 形状按类别，纯函数
};
type SourceDefinition = {id: string; schema: TSchema; phase: "invocation" | "model-call"; resolve(request, signal): Promise<unknown>};
type FieldDefinition = {id: string; schema: TSchema};
type SeedOutput = {messages: {message: Message; once: boolean}[]; diagnostics: Diagnostic[]};
type AppendingOutput = {messages: AppendedMessage[]; state: ProfileState; diagnostics: Diagnostic[]};
type AppendedMessage = {kind: "input" | "message" | "reminder"; message: Message};
type RequestOutput = {systemPrompt: string[]; messages: Message[]; diagnostics: Diagnostic[]};
type Diagnostic = {severity: "error" | "warning"; code: ProfileIssue; path: string; detail: string};

// 子入口 @notnotype/nb-harness/profile/loader（会执行模块代码）
loadProfile(path: string): Promise<Result<Profile>>;
profileFromModule(module: unknown, label?: string): Result<Profile>;

// 目录
createProfileCatalog(groups: readonly {source: string; profiles: readonly Profile[]}[]): ProfileCatalog;
interface ProfileCatalog { list(): Profile[]; get(id: string): Profile | undefined; readonly issues: Diagnostic[] }
```

`Message`、`TextContent`、`ImageContent` 是 `@oh-my-pi/pi-ai` 的类型；`Result` 与 `JsonValue` 的写法同 [`harness.session`](session.md)；`ProfileState` 是可 JSON 表示的值，调用方原样保存、原样传回。

## 输出与可观察行为

1. **注册**：注册成功返回可撤销的句柄；`dispose` 后该节点类型、数据源或字段不再可用，已经 `prepare` 的结果不受影响。同一主机内 id 重复为 `duplicate-registration`；注册布局节点或 `Fragment` 的 id 为 `reserved-node`；定义本身不合规则（id 格式、schema 不是对象等）为 `invalid-definition`。
2. **准备**：`prepare` 调用提示词函数得到节点树，校验每个节点：类型已注册、props 符合 schema、所在父节点与子节点符合上表和注册声明、`Reminder` 的 `id` 不重复、最多一个 `History` 有子节点、最多一个 `Appending`、`Image` 只在 `User` 里、`System` 里只有文字。任一项不合规则，`prepare` 返回 `invalid-prompt`，诊断逐条给出代码与节点路径（例如 `Prompt>Appending>Reminder[0]`）。
3. **字段**：`fields` 里未注册的字段 id 产生 `unknown-field` 警告并被忽略；已注册字段的值不符合 schema 为 `invalid-prompt`（诊断 `invalid-field`）。
4. **数据源**：`prepare` 收集节点树中所有节点声明的数据源，对时机为 `invocation` 的数据源各调用一次取数函数，取数结果按 schema 校验；时机为 `model-call` 的数据源在每次 `renderRequest` 前由调用方重新 `prepare` 取得。数据源未注册为 `unknown-source`，取数失败或结果不合 schema 为 `source-failed`，都使 `prepare` 返回 `invalid-prompt`。`signal` 中止时为 `cancelled`。
5. **文本**：节点的文本由子节点按顺序拼接：相邻的字符串与行内节点直接相连；块级节点（`Tag`、注册为块级的内容节点）与前后内容之间空一行；整段首尾空白去掉，连续三个以上换行折叠为两个。`Tag name="x"` 的内容渲染为 `<x>\n内容\n</x>`。
6. **系统提示词**：`renderSystem` 与 `renderRequest` 的 `systemPrompt` 按文档顺序给出每个 `System` 的文本，空文本不列出。
7. **请求消息序列**：`renderRequest` 按 `Prompt` 子节点的文档顺序排出消息：布局形式的 `History` 换成调用方给的 `history`（有 `last` 时只取最后几轮）；直接放在 `Prompt` 下的消息节点渲染为请求消息；`Appending` 与 `Input` 在这里不产生内容（追加消息已在调用方给的历史里）；种子不在这里产生。
8. **种子**：`renderSeeds` 渲染那个有子节点的 `History` 的子节点：`new-session` 时全部渲染，`after-compaction` 时跳过 `once` 的；没有带子节点的 `History` 时返回空。
9. **追加消息**：`renderAppending` 按文档顺序渲染 `Appending`：`Input` 的位置放本次用户输入（`kind: "input"`）；消息节点产生 `kind: "message"`；`Reminder` 满足触发条件时产生一条用户消息，内容用 `<system-reminder>\n…\n</system-reminder>` 包起来（`kind: "reminder"`）。`Appending` 里没有 `Input` 时，用户输入放在最后；Profile 没有 `Appending` 时只追加用户输入。
10. **提醒的触发**：`Reminder` 的各个条件同时成立才出现：`when` 为真；`every` 时距离它上次出现已满 `every` 轮（从未出现过算满足）；`watch` 时其值与上次出现时不同（按 JSON 比较，第一次算不同）；`once` 时从未出现过。没有给任何条件时每次都出现。返回的 `state` 记录每个提醒最后出现的轮次与 `watch` 值；调用方保存后在下次调用时传回。
11. **只读视图形式的 History**：`History as="text"` 把调用方给的历史渲染为文字：每条消息一段，以角色名开头，工具调用与结果写出工具名与文本内容，图片写成占位说明。
12. **加载**：`loadProfile` 导入模块并取默认导出，默认导出必须是 `defineProfile` 的结果；模块执行失败为 `module-load-failed`，默认导出不对为 `invalid-profile`；`profileFromModule` 对已导入的模块做同样的检查。
13. **目录**：`createProfileCatalog` 按 `groups` 的顺序合并，同 id 的 Profile 后面的组覆盖前面的组；同一组内 id 重复时两者都不收录，并在 `issues` 里报告。
14. **纯函数**：`renderSeeds`、`renderAppending`、`renderRequest`、`renderSystem` 对同样的输入总得到同样的输出，不调用数据源的取数函数，不修改输入。
15. **缓存提示**：请求消息出现在第一个布局形式的 `History` 之前时，`prepare` 给出 `cache-unfriendly` 警告：这类消息每次变化都会使后面整段历史的提示词缓存失效。

## 状态与转换

本模块不保存状态。有状态节点的状态由调用方保存在会话里（[`harness.session`](session.md) 的 `harness/profile-state` 条目），每次 `renderAppending` 传入、返回新值。

主机的注册表随注册与 `dispose` 变化；`prepare` 使用调用时刻的注册表，返回的 `PreparedProfile` 不随之后的注册变化。

**时序与寿命**（调用方按此使用，runtime 的完整合同见以后的 `harness.runtime`）：

- 新会话开始时：`prepare` → `renderSeeds("new-session")` → 写入种子。
- 每次调用开始时：`prepare` → `renderAppending` → 写入追加消息与新状态。
- 每次模型调用前：（有 `model-call` 数据源时重新 `prepare`）→ 以当前历史 `renderRequest`。
- 每次压缩之后：`renderSeeds("after-compaction")` → 写入种子。

## 副作用与数据

渲染函数没有副作用。`prepare` 的副作用只有调用数据源的取数函数；`loadProfile` 执行 Profile 模块的代码。本模块不写会话、不写文件。

## 失败与恢复

| 失败码或诊断码 | 含义 | 调用方怎么办 |
|---|---|---|
| `duplicate-registration` | 同一主机内 id 已注册 | 换 id，或先 `dispose` 旧的 |
| `reserved-node` | 试图注册布局节点或 `Fragment` | 不注册这些 id |
| `invalid-definition` | 节点类型、数据源或字段的定义不合规则 | 修正定义 |
| `invalid-prompt` | 节点树不合规则、字段值不合 schema、数据源未注册或取数失败；诊断逐条给出原因与路径 | 修正 Profile 或注册所需的节点与数据源；预览界面直接展示诊断 |
| `cancelled` | `prepare` 时 `signal` 已中止 | 不需要处理 |
| `module-load-failed` | Profile 模块执行或导入失败 | 修正 Profile 文件 |
| `invalid-profile` | 默认导出不是 Profile，或 Profile 本身的字段不合规则 | 修正 Profile 文件 |

诊断码：`unknown-node`、`invalid-props`、`invalid-parent`、`invalid-child`、`duplicate-reminder-id`、`multiple-seeded-history`、`multiple-appending`、`multiple-input`、`image-not-allowed`、`unknown-field`（警告）、`invalid-field`、`unknown-source`、`source-failed`、`cache-unfriendly`（警告）。

## 边界与兼容

- **公开接口**：`@notnotype/nb-harness/profile`（含 JSX 运行时子路径 `jsx-runtime`、`jsx-dev-runtime`）与 `@notnotype/nb-harness/profile/loader` 中“注册”一节列出的符号；内置节点的名称与属性。
- **依赖**：本模块不依赖 `nb-harness` 的其它模块与插件系统；插件阶段由 `nbook.agent` 把贡献点收到的节点、数据源与字段转交给主机注册。
- **信任**：Profile 模块代码与注册方受信任，不做隔离。
- **兼容**：节点 id、内置节点的属性与渲染规则是公开合同；改变渲染结果属于行为变化，按 Spec 流程处理。

## 验收与 Smoke

1. 示例 Profile（“定义 Profile”一节）：`renderSeeds("new-session")` 得到两条种子，`after-compaction` 只得到技能目录那条；`renderAppending` 在第 1 轮得到用户输入与提醒，第 2–5 轮只有用户输入，第 6 轮又有提醒；`renderRequest` 依次为历史、带 `<workspace>` 的请求消息。
2. 两个布局形式的 `History`（一个 `last={2}`）与一个 `User><History as="text" /></User>`：请求中先后出现完整历史、最后两轮与一段历史文字；两个 `History` 都有子节点时 `prepare` 为 `invalid-prompt`（`multiple-seeded-history`）。
3. 位置校验：`Reminder` 放在 `Prompt` 下、`Input` 放在 `History` 里、`Image` 放在 `System` 或 `Assistant` 里、两个 `Appending`，各自得到对应诊断码与节点路径。
4. 文本拼接：`<User>回答使用{"简体中文"}。<Tag name="rules">一</Tag>结尾</User>` 渲染为“回答使用简体中文。”、空行、`<rules>` 块、空行、“结尾”。
5. 注册：插件注册一个内容节点与它依赖的数据源，Profile 使用它；取数函数返回不合 schema 的值时 `prepare` 为 `invalid-prompt`（`source-failed`）；`dispose` 后再 `prepare` 为 `unknown-node`；注册 `History` 为 `reserved-node`。
6. 字段：未注册字段只得到警告；注册后值不合 schema 为 `invalid-field`。
7. 只取系统提示词：`renderSystem` 只返回各 `System` 的文字，不需要历史与用户输入。
8. 目录：内置、用户、项目三组各有同 id 的 Profile 时取项目组的；同一组内重复时都不收录并报告。
9. 加载：从临时目录加载一个 `.profile.tsx`，得到与直接导入相同的 Profile；没有默认导出为 `invalid-profile`。

Smoke：`packages/nb-harness` 的 `bun test src/profile`（含从真实文件加载 `.profile.tsx`）。

## 证据

- 批准依据：[Agent harness 内核](../../proposals/agent-harness-kernel.md) 的“Profile”一节与决策记录（开发者 2026-10-10 决定：节点、数据源与字段全部走注册；分区为 `System`、`History`、`Appending`，去掉 `ModelContext`；`History` 是会话条目回放的结果，可以有多个或没有，子节点是种子并可标“只在新会话写入”；`Appending` 放即将进入历史的消息且不合并；提醒用 `<system-reminder>`；去掉条件节点与按角色拆分消息节点；Profile 文件全部信任）。
