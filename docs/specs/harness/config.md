---
schema: nbook.spec/v1
kind: behavior
status: implemented
capability: harness.config
owners:
  - nb-harness
---

# Harness 配置：快照、校验与变化通知

## 目标与非目标

`nb-harness` 的 `config` 模块把使用方合成好的一份配置变成内核用的**配置快照**：按 schema 校验、填缺省值、深冻结，并在快照被替换时通知订阅者。配置从哪来、分几层合成由使用方决定（独立运行时读一个 JSON 文件；插件阶段由 `nbook.settings` 合成后交来）。一次调用开始时取定一份快照，调用内不变。

不承诺：

- 配置文件的读写、分层合成、文件监视：由使用方负责。
- 凭据（API key、OAuth 令牌）：不进配置，见 [`harness.models`](models.md)。
- 引用是否真的存在（模型在不在目录里、角色绑定的模型能不能解析）：本模块只查形状与语法，存在性由 [`harness.models`](models.md) 在解析时判断。
- 配置项的扩展注册（插件阶段由各模块按贡献点扩展）：第一版的字段固定。

## 术语与参与者

- **配置快照**：一份校验通过、填好缺省值、深冻结的 `HarnessConfig`。
- **配置问题**：校验失败时的一条记录：字段路径与原因。
- **模型引用**：`<providerId>/<modelId>`：服务 id 是 `[A-Za-z0-9._-]+`，到第一个 `/` 为止；模型 id 是其后的全部，非空、没有空白与控制字符（OMP 目录里的模型 id 本身可以带 `/`、`:`、`~`，例如 `aiand/deepseek-ai/deepseek-v4-flash`）。
- **模型角色**：按 [模型角色合同](../../proposals/model-roles-contract.md) 的条目：`id`、`axis`、`name`、`description`、`modelKey`。

## 输入与前置条件

```ts
// 公开入口 @notnotype/nb-harness/config
validateHarnessConfig(input: unknown): ConfigResult<HarnessConfig>;
createConfigStore(initial: unknown): ConfigResult<ConfigStore>;
interface ConfigStore {
    readonly current: HarnessConfig;                                   // 深冻结的当前快照
    replace(next: unknown): ConfigResult<HarnessConfig>;               // 成功则换快照并通知；失败则不变、不通知
    subscribe(listener: (snapshot: HarnessConfig) => void): {release(): void};
}
type ConfigResult<T> = {ok: true; value: T} | {ok: false; code: "invalid-config"; problems: ConfigProblem[]};
type ConfigProblem = {path: string; reason: string};                  // path 如 "providers[1].baseUrl"

type HarnessConfig = {
    providers: ProviderConfig[];                                       // 自建或覆盖的模型服务；OMP 目录里的服务不必列出
    models: {defaultModel?: ModelRef};
    roles: {items: RoleItem[]};
    profiles: Record<string, {model?: ModelRef; settings?: JsonValue}>;
    approval: {mode?: "always-ask" | "write" | "auto" | "yolo"; tools: Record<string, "allow" | "deny" | "ask">};
};
type ModelRef = string;                                                // "<providerId>/<modelId>"
type ProviderConfig = {
    id: string;                                                        // [A-Za-z0-9._-]+；与 OMP 目录同名时覆盖目录里的该服务
    api: string;                                                       // OMP 的 Api 名，[a-z0-9-]+，例如 "openai-completions"；是否能派发由 harness.models 解析时判断
    baseUrl: string;                                                   // http(s) URL
    headers?: Record<string, string>;
    models: ProviderModelConfig[];
};
type ProviderModelConfig = {
    id: string; name?: string; contextWindow?: number; maxTokens?: number;
    input?: ("text" | "image")[]; reasoning?: boolean; supportsTools?: boolean;
};
type RoleItem = {id: string; axis: "gradient" | "specialist"; name: string; description: string; modelKey: ModelRef | null};
```

| 规则 | 内容 |
|---|---|
| 缺省值 | `providers: []`、`roles.items: []`、`profiles: {}`、`approval.tools: {}`；`models.defaultModel`、`approval.mode` 可以缺省 |
| 未知字段 | 顶层与各对象里未知的键是问题（`未知字段`），不静默忽略 |
| id | `providers[].id`、`roles.items[].id`、`profiles` 的键是 `[A-Za-z0-9._-]+`；`providers[].models[].id` 按模型 id 的规则（非空、无空白与控制字符）；各自在所属集合内唯一 |
| 模型引用 | `models.defaultModel`、`roles.items[].modelKey`、`profiles.*.model` 必须符合模型引用的语法；空字符串按未给出处理 |
| `baseUrl` | 能按 WHATWG 规则解析的 URL，协议是 `http` 或 `https`（这两种协议解析通过就有主机名） |
| 字典的键 | `profiles`、`approval.tools`、`providers[].headers` 的键不能是 `__proto__`、`constructor`、`prototype`（普通对象当字典用时这些键会改原型而不是存条目） |
| 数值 | `contextWindow`、`maxTokens` 是正整数 |
| 值 | 整份配置必须能被 JSON 如实表示（没有 `undefined`、函数、`NaN`、循环引用、稀疏数组的空洞） |

## 输出与可观察行为

1. **校验与规范化**：`validateHarnessConfig` 对输入逐条检查上表的规则，列出**全部**问题而不是第一条；通过时返回填好缺省值、深冻结的快照，输入对象本身不被修改。
2. **问题的定位**：每个问题带字段路径（点与方括号记法，例如 `roles.items[2].modelKey`）与一句原因；同一字段多个问题各一条。
3. **新建存储**：`createConfigStore(initial)` 对 `initial` 做输出 1 的校验：失败则返回 `invalid-config`，不产生存储。
4. **替换**：`replace(next)` 校验通过时换成新快照并返回它，订阅者各收到一次新快照；校验失败时返回问题，`current` 不变，订阅者不被通知。替换成同样内容的配置也算一次替换（新快照、通知一次）。
5. **快照不可变**：`current` 与通知给订阅者的是同一个深冻结对象；修改它抛出 `TypeError`，不影响存储。
6. **订阅**：`subscribe` 不补发当前快照（调用方自己读 `current`）；`release` 后不再收到通知。监听函数抛错只影响它自己，`replace` 照常成功，其它订阅者照常收到。

## 状态与转换

存储只有一份当前快照；`replace` 成功时整体替换。没有并发语义：`replace` 是同步的。

**时序与寿命**：

- `createConfigStore` 返回后 `current` 立即可用。
- `replace` 返回前订阅者已被同步通知。
- 调用方在一次调用开始时读一次 `current` 并持有它；之后 `replace` 不影响已持有的快照（它是不可变对象）。

## 副作用与数据

无 I/O、无全局状态。配置的持久化格式归使用方；本模块不定义文件格式与版本。

## 失败与恢复

| 失败码 | 含义 | 调用方怎么办 |
|---|---|---|
| `invalid-config` | 配置不符合规则；`problems` 逐条给出路径与原因 | 修正配置；存储已有快照时旧快照继续有效 |

## 边界与兼容

- **公开接口**：`@notnotype/nb-harness/config` 中“输入与前置条件”列出的符号与类型。
- **依赖**：不依赖 `nb-harness` 的其它模块；不依赖 OMP。
- **兼容**：`HarnessConfig` 的形状是对外合同；新增字段要有缺省值，旧配置仍能通过校验。

## 验收与 Smoke

1. 一份带两个自建服务、四个角色、两个 Profile 的完整配置通过校验，缺省值补齐，快照深冻结；同一份配置里改坏三处（重复的角色 id、`baseUrl` 不是 URL、`defaultModel` 少一段）一次得到三条问题，路径各自正确。
2. 存储：`replace` 坏配置后 `current` 不变、订阅者没有收到；`replace` 好配置后订阅者收到一次，`release` 后不再收到；监听函数抛错不影响另一个订阅者与返回值。
3. 未知字段与 JSON 不能表示的值各得到一条问题。

Smoke：`packages/nb-harness` 的 `bun test src/config`。

## 实现合同

- 公开入口：`@notnotype/nb-harness/config`（`validateHarnessConfig`、`createConfigStore`、`MODEL_REF_PATTERN`（模型引用的语法，供界面在提交前校验）与“输入与前置条件”的类型）。
- owner：`nb-harness` 的 `config` 模块；只依赖 TypeBox，不依赖本包其它模块与 OMP。
- 内部不变量（都有测试锁定）：
  1. 校验分三步（JSON 如实表示、schema、唯一性与引用语法），schema 不通过时后两步照跑，问题一次列全；同一字段的 schema 错误按路径合并。
  2. 快照是输入的深拷贝再深冻结，输入不被修改。
  3. `replace` 失败不动 `current`、不通知；监听函数抛错互不影响。

## 证据

- 批准依据：[Agent harness 内核](../../proposals/agent-harness-kernel.md) 的“配置”一节（开发者 2026-10-10 决定：内核只接收合成好的配置快照与变化通知；凭据不进配置；校验失败的配置不被采用，旧快照继续有效，并给出结构化的问题列表）。
- 实现入口：[`packages/nb-harness/src/config/config.ts`](../../../packages/nb-harness/src/config/config.ts)
- 合同测试：[`config.test.ts`](../../../packages/nb-harness/src/config/config.test.ts)
- Smoke：不适用——纯函数模块，合同测试即全部可观察行为
