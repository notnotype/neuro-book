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
- **历史**：调用方从会话条目回放出的 `Message[]`，包括本次调用已经写入的追加消息与 ReAct 循环中的助手消息、工具结果。循环中的消息由 runtime 直接写进会话，不经过 `Appending`。
- **本次调用的消息**：历史中从本次调用的第一条追加消息起到末尾的部分，调用方以下标 `invocationStart` 指明。
- **用户发出的消息**：`role: "user"`、`attribution` 不是 `"agent"`、`synthetic` 不为真的消息。种子、提醒与压缩摘要回放后都带 `attribution: "agent"`（见 [`harness.session`](session.md) 输出 12），不算用户发出的消息。
- **轮**：从一条用户发出的消息开始、到下一条用户发出的消息之前的消息；第一条之前的消息算作第一轮。与 `harness.session` 的“轮”划分相同。

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
| `History`（文本形式，`as="text"`） | 内容 | 只能在请求消息（直接放在 `Prompt` 下的消息节点）内 | 无子节点；属性 `last?: number`；把本次调用之前的历史渲染成一段文字 |
| `Appending` | 布局 | `Prompt`，最多一个 | 消息节点、有状态节点、`Input`；`Input` 至多一个 |
| `Input` | 布局 | 只能在 `Appending` | 无 |
| `User`、`Developer` | 消息 | `Prompt`、`History`（种子）、`Appending` | 文本、内容节点；`Image` 只能放在 `User` 里 |
| `Assistant` | 消息 | `Prompt`、`Appending` | 文本、内容节点 |
| `Reminder` | 有状态 | 只能在 `Appending` | 文本、内容节点；属性 `id`（必填）、`when?: boolean`、`every?: number`、`watch?: JsonValue`、`once?: boolean` |
| `Tag` | 内容（块级） | 消息节点、`System`、`Reminder` | 文本、内容节点；属性 `name`（`[a-z][a-z0-9-]*`） |
| `Image` | 内容 | `User` | 无；属性 `mimeType` 与 `data`（base64）。要从数据源取图片时，由注册方的内容节点读数据源后产生 `Image` |
| `Fragment` | 结构 | 任意位置 | 与它所在的父节点相同 |
| 已注册的消息、内容、有状态节点 | 按注册 | 按注册时声明 | 按注册时声明 |

条件与循环用 TSX 表达式（`{cond && <X/>}`、`items.map(…)`），没有专门的条件节点；`null`、`undefined`、`false` 与空数组不产生内容。

### 注册

```ts
// 公开入口 @notnotype/nb-harness/profile
createProfileHost(): ProfileHost;                  // 已注册内置的消息、内容与有状态节点
interface ProfileHost {
    registerNodeType(definition: NodeTypeDefinition): ProfileResult<{dispose(): void}>;
    registerSource(definition: SourceDefinition): ProfileResult<{dispose(): void}>;
    registerField(definition: FieldDefinition): ProfileResult<{dispose(): void}>;
    prepare(profile: Profile, input: {context: PromptContext; signal?: AbortSignal}): Promise<ProfileResult<PreparedProfile>>;
    refresh(prepared: PreparedProfile, input: {signal?: AbortSignal}): Promise<ProfileResult<PreparedProfile>>;
    renderSeeds(prepared: PreparedProfile, occasion: "new-session" | "after-compaction"): SeedOutput;
    renderAppending(prepared: PreparedProfile, input: {input: UserInput; state: ProfileState}): AppendingOutput;
    renderRequest(prepared: PreparedProfile, input: {history: readonly Message[]; invocationStart: number}): RequestOutput;
    renderSystem(prepared: PreparedProfile): {systemPrompt: string[]; diagnostics: Diagnostic[]};
}
type ProfileNode = {type: string; props: Readonly<Record<string, unknown>>; children: readonly ProfileChild[]};
type ProfileChild = ProfileNode | string | null;
type RenderContext = {prompt: PromptContext; sources: Readonly<Record<string, unknown>>};   // 只含本节点声明的数据源
type NodeTypeDefinition = {
    id: string;                                     // <命名空间>/<名称>
    props: TSchema;
    parents: readonly string[];                     // 可以放在哪些节点类型里
    children: "none" | "content" | readonly string[];
    sources?: readonly string[];                    // 依赖的数据源 id
} & (
    | {category: "message"; role: "user" | "developer" | "assistant"}                           // 内容是子节点渲染出的文字与图片
    | {category: "content"; layout?: "inline" | "block";                                        // 缺省 inline
       render(node: ProfileNode, context: RenderContext): ProfileChild}
    | {category: "stateful";                                                                    // props 必须含 id: string
       render(node: ProfileNode, context: RenderContext & {state: JsonValue | undefined}): {content: ProfileChild; state: JsonValue}}
);
type SourceDefinition = {id: string; schema: TSchema; phase: "invocation" | "model-call";
    resolve(request: {prompt: PromptContext}, signal: AbortSignal): Promise<unknown>};
type FieldDefinition = {id: string; schema: TSchema};
type ProfileState = {[statefulNodeId: string]: JsonValue};
type SeedOutput = {messages: {message: Message; once: boolean}[]; diagnostics: Diagnostic[]};
type AppendingOutput = {messages: AppendedMessage[]; state: ProfileState; diagnostics: Diagnostic[]};
type AppendedMessage = {kind: "input" | "message" | "reminder"; message: Message};
type RequestOutput = {systemPrompt: string[]; messages: Message[]; diagnostics: Diagnostic[]};
type Diagnostic = {severity: "error" | "warning"; code: ProfileIssue; path: string; detail: string};
type ProfileResult<T> = {ok: true; value: T} | {ok: false; code: ProfileFailure; detail: string; diagnostics: Diagnostic[]};
type ProfileFailure = "duplicate-registration" | "reserved-node" | "invalid-definition" | "invalid-prompt" | "cancelled"
    | "module-load-failed" | "invalid-profile";
type ProfileIssue = "unknown-node" | "invalid-props" | "invalid-parent" | "invalid-child" | "duplicate-state-id"
    | "multiple-seeded-history" | "multiple-appending" | "multiple-input" | "image-not-allowed" | "unknown-field"
    | "invalid-field" | "unknown-source" | "source-failed" | "cache-unfriendly" | "invalid-invocation-start" | "duplicate-profile" | "prompt-threw";

// 子入口 @notnotype/nb-harness/profile/loader（会执行模块代码）
loadProfile(path: string): Promise<ProfileResult<Profile>>;
profileFromModule(module: unknown, label?: string): ProfileResult<Profile>;

// 目录
createProfileCatalog(groups: readonly {source: string; profiles: readonly Profile[]}[]): ProfileCatalog;
interface ProfileCatalog { list(): Profile[]; get(id: string): Profile | undefined; readonly issues: Diagnostic[] }
```

```ts
defineProfile(definition: {id: string; name: string; description: string; version: number; fields?: Record<string, JsonValue>; prompt: (ctx: PromptContext) => ProfileNode}): Profile;
type Profile = Readonly<定义的字段> & {readonly [profileMarker]: true};   // 由 defineProfile 打标记，profileFromModule 据此识别
type UserInput = {content: string | (TextContent | ImageContent)[]};
type PreparedProfile = object;   // 不透明：只用于传回同一主机的渲染方法
```

内置节点的类型 id：`harness/prompt`、`harness/system`、`harness/history`、`harness/appending`、`harness/input`、`harness/user`、`harness/developer`、`harness/assistant`、`harness/reminder`、`harness/tag`、`harness/image`、`harness/fragment`；注册方的节点用自己的命名空间。

`Message`、`TextContent`、`ImageContent` 是 `@oh-my-pi/pi-ai` 的类型；`JsonValue` 与 [`harness.session`](session.md) 的定义相同，本模块自己声明，不从 `session` 导入。`ProfileState` 按有状态节点的 `id` 记录各自的状态，调用方原样保存、原样传回；不认识的键原样保留。失败的 `diagnostics` 在 `invalid-prompt` 时逐条给出原因，其它失败码可以为空。

## 输出与可观察行为

1. **注册**：注册成功返回可撤销的句柄；`dispose` 后该节点类型、数据源或字段不再可用，已经 `prepare` 的结果不受影响。同一主机内 id 重复为 `duplicate-registration`；注册布局节点或 `Fragment` 的 id 为 `reserved-node`；定义本身不合规则（id 格式、节点的 `props` 不是对象 schema、数据源或字段的 `schema` 不是 TypeBox schema、类别对应的字段缺失等）为 `invalid-definition`。数据源与字段的 schema 可以是任何 TypeBox schema（数组、字符串、布尔都行），只有节点的 `props` 必须是对象 schema。
2. **准备**：`prepare` 调用提示词函数得到节点树（函数抛错或返回的根不是 `Prompt` 为 `invalid-prompt`，诊断 `prompt-threw`），校验每个节点：类型已注册、props 符合 schema、所在父节点与子节点符合上表和注册声明、有状态节点只在 `Appending` 的子树里且 `id` 互不重复、种子只是 `User` 或 `Developer`、`History as="text"` 只在请求消息里、最多一个 `History` 有子节点、最多一个 `Appending`、`Image` 只在 `User` 里、`System` 里只有文字。任一项不合规则，`prepare` 返回 `invalid-prompt`，诊断逐条给出代码与节点路径（例如 `Prompt>Appending>Reminder[0]`）。
3. **字段**：`fields` 里未注册的字段 id 产生 `unknown-field` 警告并被忽略；已注册字段的值不符合 schema 为 `invalid-prompt`（诊断 `invalid-field`）。
4. **数据源**：`prepare` 收集节点树中所有节点声明的数据源，各调用一次取数函数，取数结果按 schema 校验。`refresh` 只对时机为 `model-call` 的数据源重新取数，返回新的准备结果：节点树与 `invocation` 数据源的结果与传入的相同；没有 `model-call` 数据源时原样返回。数据源未注册为 `unknown-source`，取数失败或结果不合 schema 为 `source-failed`，都使 `prepare` 或 `refresh` 返回 `invalid-prompt`。`signal` 中止时为 `cancelled`。
5. **文本**：节点的文本由子节点按顺序拼接：相邻的字符串与行内节点直接相连；块级节点（`Tag`、注册时 `layout: "block"` 的内容节点）与前后内容之间空一行；整段首尾空白去掉，连续三个以上换行折叠为两个。`Tag name="x"` 的内容渲染为 `<x>\n内容\n</x>`。
6. **系统提示词**：`renderSystem` 与 `renderRequest` 的 `systemPrompt` 按文档顺序给出每个 `System` 的文本，空文本不列出。
    **渲染期的校验**：内容节点与有状态节点的 `render` 返回的节点不在准备时校验过的树里，渲染时按同样的规则再查：未注册（`unknown-node`）、props 不合（`invalid-props`）、不能放在当前位置（`invalid-parent`）、消息节点出现在内容里（`invalid-child`）、图片不在 `User` 里（`image-not-allowed`）的节点被丢弃，各在该次渲染输出的 `diagnostics` 里给一条警告（路径从渲染位置起）。
7. **请求消息序列**：`renderRequest` 按 `Prompt` 子节点的文档顺序排出消息：布局形式的 `History` 换成调用方给的 `history`（有 `last` 时只取最后几轮）；直接放在 `Prompt` 下的消息节点渲染为请求消息；`Appending`、`Input` 与种子在这里不产生内容（它们已经写进会话，在 `history` 里）。Profile 没有布局形式的 `History` 时，请求的最后接上本次调用的消息（`history` 从 `invocationStart` 起的部分），所以不带历史的 Profile 仍能看到本次输入与本次调用中的工具往来。`invocationStart` 不在 `0` 到 `history.length` 之间时按 `history.length` 处理并给出 `invalid-invocation-start` 诊断。
8. **种子**：`renderSeeds` 渲染那个有子节点的 `History` 的子节点：`new-session` 时全部渲染，`after-compaction` 时跳过 `once` 的；没有带子节点的 `History` 时返回空。种子的角色是节点的角色（`User` 或 `Developer`）。
9. **消息的形状**：消息节点渲染出的消息是 OMP `Message`：`User`、`Developer` 带 `timestamp`（取 `PromptContext.now`）；`Assistant` 是 Profile 作者写的示例，不来自任何模型，`content` 一律是块数组，OMP 必填的元数据填占位值——`api`、`provider`、`model` 都是 `"profile"`，`usage` 全零，`stopReason` 为 `"stop"`。这些消息能原样写进 [`harness.session`](session.md)。
10. **追加消息**：`renderAppending` 按文档顺序渲染 `Appending`：`Input` 的位置放本次用户输入（`kind: "input"`）；消息节点产生 `kind: "message"`；`Reminder` 满足触发条件时产生一条用户消息，内容用 `<system-reminder>\n…\n</system-reminder>` 包起来（`kind: "reminder"`）；注册的有状态节点直接放在 `Appending` 下时，内容非空就产生一条用户消息（`kind: "message"`），放在消息节点里时是那条消息内容的一部分。`Appending` 里没有 `Input` 时，用户输入放在最后；Profile 没有 `Appending` 时只追加用户输入。
11. **有状态节点与提醒的触发**：有状态节点的 `render` 收到 `state[id]`（没有记录时为 `undefined`），返回的新状态写进输出 `state` 的同一键；本次没有渲染到的节点，其旧状态原样保留。`Reminder` 的各个条件同时成立才出现：`when` 为真；`every` 时距离它上次出现已满 `every` 轮（从未出现过算满足）；`watch` 时其值与上次出现时不同（按 JSON 比较，第一次算不同）；`once` 时从未出现过。没有给任何条件时每次都出现。它的状态记录最后出现的轮次（`PromptContext.turn`）与 `watch` 值。
12. **文本形式的 History**：`History as="text"` 把本次调用之前的历史（`history` 在 `invocationStart` 之前的部分）渲染为文字：每条消息一段，以角色名开头，工具调用与结果写出工具名与文本内容，图片写成占位说明。
13. **加载**：`loadProfile` 导入模块并取默认导出，默认导出必须是 `defineProfile` 的结果；模块执行失败为 `module-load-failed`，默认导出不对为 `invalid-profile`；`profileFromModule` 对已导入的模块做同样的检查。Profile 文件可以放在任何目录：它里面对 `@notnotype/nb-harness/profile` 及其子路径的导入（含 `@jsxImportSource`）由加载器解析到本包，不要求文件旁边有 `node_modules`；其它导入按文件所在位置的常规规则解析。
14. **目录**：`createProfileCatalog` 按 `groups` 的顺序合并，同 id 的 Profile 后面的组覆盖前面的组；同一组内 id 重复时两者都不收录，并在 `issues` 里报告（诊断 `duplicate-profile`，`path` 为 `<组>:<id>`）。
15. **纯函数**：`renderSeeds`、`renderAppending`、`renderRequest`、`renderSystem` 对同样的输入总得到同样的输出，不调用数据源的取数函数，不修改输入。数据只来自 `prepare` 与 `refresh` 的结果。
16. **缓存提示**：请求消息出现在第一个布局形式的 `History` 之前时，`prepare` 给出 `cache-unfriendly` 警告：这类消息每次变化都会使后面整段历史的提示词缓存失效。

## 状态与转换

本模块不保存状态。有状态节点的状态由调用方保存在会话里（[`harness.session`](session.md) 的 `harness/profile-state` 条目），每次 `renderAppending` 传入、返回新值。

主机的注册表随注册与 `dispose` 变化；`prepare` 使用调用时刻的注册表，返回的 `PreparedProfile` 不随之后的注册变化。

**时序与寿命**（调用方按此使用，runtime 的完整合同见以后的 `harness.runtime`）：

- 每次调用开始时：`prepare`（新会话时接着 `renderSeeds("new-session")` 并写入种子）→ `renderAppending` → 写入追加消息与新状态。
- ReAct 循环中：助手消息与工具结果由 runtime 直接写进会话，不经过本模块。
- 本次调用的第一次模型调用前：以当前历史与本次调用的起点 `renderRequest`。
- 之后每次模型调用前：（有 `model-call` 数据源时 `refresh`）→ 以当前历史 `renderRequest`。
- 每次压缩之后：用本次调用的准备结果 `renderSeeds("after-compaction")` → 写入种子。

同一次调用里只 `prepare` 一次，`invocation` 数据源的值在整次调用中不变。

## 副作用与数据

渲染函数没有副作用。`prepare` 的副作用只有调用数据源的取数函数；`loadProfile` 执行 Profile 模块的代码。本模块不写会话、不写文件。

## 失败与恢复

| 失败码或诊断码 | 含义 | 调用方怎么办 |
|---|---|---|
| `duplicate-registration` | 同一主机内 id 已注册 | 换 id，或先 `dispose` 旧的 |
| `reserved-node` | 试图注册布局节点或 `Fragment` | 不注册这些 id |
| `invalid-definition` | 节点类型、数据源或字段的定义不合规则 | 修正定义 |
| `invalid-prompt` | 节点树不合规则、字段值不合 schema、数据源未注册或取数失败；诊断逐条给出原因与路径 | 修正 Profile 或注册所需的节点与数据源；预览界面直接展示诊断 |
| `cancelled` | `prepare` 或 `refresh` 时 `signal` 已中止 | 不需要处理 |
| `module-load-failed` | Profile 模块执行或导入失败 | 修正 Profile 文件 |
| `invalid-profile` | 默认导出不是 Profile，或 Profile 本身的字段不合规则 | 修正 Profile 文件 |

诊断码（`ProfileIssue`）：`unknown-node`、`invalid-props`、`invalid-parent`（含种子不是 `User`、`Developer`，`History as="text"` 不在请求消息里，有状态节点不在 `Appending` 子树里）、`invalid-child`、`duplicate-state-id`、`multiple-seeded-history`、`multiple-appending`、`multiple-input`、`image-not-allowed`、`unknown-field`（警告）、`invalid-field`、`unknown-source`、`source-failed`、`cache-unfriendly`（警告）、`invalid-invocation-start`（`renderRequest` 的警告）。除警告外，诊断都使 `prepare` 返回 `invalid-prompt`。

## 边界与兼容

- **公开接口**：`@notnotype/nb-harness/profile`（含 JSX 运行时子路径 `jsx-runtime`、`jsx-dev-runtime`）与 `@notnotype/nb-harness/profile/loader` 中“注册”一节列出的符号；内置节点的名称与属性。
- **依赖**：本模块不依赖 `nb-harness` 的其它模块与插件系统；插件阶段由 `nbook.agent` 把贡献点收到的节点、数据源与字段转交给主机注册。
- **信任**：Profile 模块代码与注册方受信任，不做隔离。
- **兼容**：节点 id、内置节点的属性与渲染规则是公开合同；改变渲染结果属于行为变化，按 Spec 流程处理。

## 验收与 Smoke

1. 示例 Profile（“定义 Profile”一节）：`renderSeeds("new-session")` 得到两条种子，`after-compaction` 只得到技能目录那条；`renderAppending` 在第 1 轮得到用户输入与提醒，第 2–5 轮只有用户输入，第 6 轮又有提醒；`renderRequest` 依次为历史、带 `<workspace>` 的请求消息。
2. 两个布局形式的 `History`（一个 `last={2}`）与一个 `<User><History as="text" /></User>` 请求消息：请求中先后出现完整历史、最后两轮与一段本次调用之前的历史文字；两个 `History` 都有子节点时 `prepare` 为 `invalid-prompt`（`multiple-seeded-history`）；`History as="text"` 放进种子或 `Appending` 的消息里为 `invalid-parent`。
3. 位置校验：`Reminder` 放在 `Prompt` 下、`Input` 放在 `History` 里、`Image` 放在 `System` 或 `Assistant` 里、`Assistant` 作种子、两个 `Appending`、两个 `id` 相同的 `Reminder`，各自得到对应诊断码与节点路径。
4. 文本拼接：`<User>回答使用{"简体中文"}。<Tag name="rules">一</Tag>结尾</User>` 渲染为“回答使用简体中文。”、空行、`<rules>` 块、空行、“结尾”；注册为 `layout: "block"` 的内容节点同样前后空一行。
5. 注册：插件注册一个内容节点与它依赖的数据源，Profile 使用它；取数函数返回不合 schema 的值时 `prepare` 为 `invalid-prompt`（`source-failed`）；`dispose` 后再 `prepare` 为 `unknown-node`；注册 `History` 为 `reserved-node`。
6. 字段：未注册字段只得到警告；注册后值不合 schema 为 `invalid-field`。
7. 只取系统提示词：`renderSystem` 只返回各 `System` 的文字，不需要历史与用户输入。
8. 目录：内置、用户、项目三组各有同 id 的 Profile 时取项目组的；同一组内重复时都不收录并报告。
9. 加载：从临时目录加载一个 `.profile.tsx`，得到与直接导入相同的 Profile；没有默认导出为 `invalid-profile`。
10. 没有 `History` 的 Profile（`<Prompt><System>…</System><Appending><Input /></Appending></Prompt>`）：历史有三轮之前的对话，加本次调用的输入、助手的工具调用与工具结果时，`renderRequest` 只给出本次调用的这三条消息。
11. 种子的角色：`<History><Developer>规则</Developer><User>任务</User></History>` 得到一条 `developer`、一条 `user` 种子。
12. 轮与提醒：历史为用户输入“修改第三章”、带 `attribution: "agent"` 的提醒、助手回复，再一轮用户输入与回复；`<History last={1} />` 只取第二轮，`last={2}` 取到“修改第三章”。
13. 数据源时机：一个 `invocation` 数据源与一个 `model-call` 数据源，记录取数次数：`prepare` 后各 1 次；两次 `refresh` 后 `invocation` 仍为 1 次、`model-call` 为 3 次，`refresh` 结果中 `invocation` 数据不变。
14. 有状态节点：注册一个有状态节点，第一次 `render` 收到 `undefined`、返回状态 `1`；把输出的 `state` 传回后下一次收到 `1`；`state` 里另一个节点的键原样保留。

Smoke：`packages/nb-harness` 的 `bun test src/profile`（含从真实文件加载 `.profile.tsx`）。

## 实现合同

- 公开入口：`@notnotype/nb-harness/profile`（`createProfileHost`、`defineProfile`、`createProfileCatalog`、内置节点组件、`nodeComponent` 与“注册”一节的类型）、`@notnotype/nb-harness/profile/jsx-runtime`、`@notnotype/nb-harness/profile/jsx-dev-runtime`、`@notnotype/nb-harness/profile/loader`（`loadProfile`、`profileFromModule`）。
- owner：`nb-harness` 的 `profile` 模块；只依赖 TypeBox 与 OMP 的类型（`import type`），不依赖本包其它模块；`loader` 子目录另用 Node 内置模块与动态导入。
- 内部不变量（都有测试锁定）：
  1. 节点一律冻结；JSX 只接受组件函数，字符串元素名报错。
  2. 内置的消息、内容、有状态节点经同一个注册接口登记；布局节点与 `Fragment` 不在注册表里，注册这些 id 为 `reserved-node`。
  3. `prepare` 拷注册表快照进准备结果，之后的注册与 `dispose` 不影响它；渲染只读准备结果，不取数。
  4. 轮按“用户发出的消息”划分，与 `harness.session` 的分页同一规则。
  5. 加载器注册的虚拟模块导出的是本包已加载的模块实例，`defineProfile` 的标记跨文件可识别。

## 证据

- 实现入口：[`packages/nb-harness/src/profile/profile.ts`](../../../packages/nb-harness/src/profile/profile.ts)、[`packages/nb-harness/src/profile/loader/loader.ts`](../../../packages/nb-harness/src/profile/loader/loader.ts)
- 合同测试：[`host.test.tsx`](../../../packages/nb-harness/src/profile/host.test.tsx)、[`prepare.test.tsx`](../../../packages/nb-harness/src/profile/prepare.test.tsx)、[`render.test.tsx`](../../../packages/nb-harness/src/profile/render.test.tsx)、[`request.test.tsx`](../../../packages/nb-harness/src/profile/request.test.tsx)、[`loader.test.tsx`](../../../packages/nb-harness/src/profile/loader/loader.test.tsx)
- Smoke：[`loader.test.tsx`](../../../packages/nb-harness/src/profile/loader/loader.test.tsx)（从真实临时目录加载 `.profile.tsx`）
- 批准依据：[Agent harness 内核](../../proposals/agent-harness-kernel.md) 的“Profile”一节与决策记录（开发者 2026-10-10 决定：节点、数据源与字段全部走注册；分区为 `System`、`History`、`Appending`，去掉 `ModelContext`；`History` 是会话条目回放的结果，可以有多个或没有，子节点是种子并可标“只在新会话写入”；`Appending` 放即将进入历史的消息且不合并；提醒用 `<system-reminder>`；去掉条件节点与按角色拆分消息节点；Profile 文件全部信任）。
