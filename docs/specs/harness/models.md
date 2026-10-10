---
schema: nbook.spec/v1
kind: behavior
status: planned
capability: harness.models
owners:
  - nb-harness
---

# Harness 模型：目录、解析、角色与凭据

## 目标与非目标

`nb-harness` 的 `models` 模块用一份配置快照（[`harness.config`](config.md)）加 OMP 的内置目录回答“这次调用用哪个模型”：按模型引用解析出 OMP 的 `Model` 对象，按“显式指定 → 角色 → Profile 的模型 → Profile 的缺省角色 → 全局缺省”的链条选模型，检查模型能力是否满足要求；并用 OMP 的 `AuthStorage` 管凭据：API key 的存取、OAuth 登录与登出、账号查询。模型通信本身直接用 OMP（`streamSimple`），本模块只给出模型对象与凭据。

不承诺：

- 调用模型、重试、回退链：由 `runtime` 负责；本模块不发请求（真实模型只在一条冒烟测试里调用）。
- 从网络刷新模型目录（models.dev 等）：只用 OMP 包内置的目录与配置里自建的服务。
- 读环境变量取凭据：内核不读；开发与测试由使用方显式把 key 写进凭据存储。
- 用量统计与额度：OMP 的用量接口以后按需透出。
- OAuth 登录流程里的交互（打开链接、输入设备码）：由使用方实现 OMP 的 `OAuthController`。

## 术语与参与者

- **模型引用**：见 [`harness.config`](config.md)。
- **目录**：配置里自建服务的模型加 OMP 内置目录的模型；同一个 `providerId/modelId` 以配置里的为准。
- **选择链**：显式模型 → 指定的角色 → Profile 配置的模型 → Profile 声明的缺省角色 → 全局缺省模型。
- **凭据存储**：OMP `AuthStorage` 背后的 `AuthCredentialStore`：SQLite 文件，或使用方实现的接口。

## 输入与前置条件

```ts
// 公开入口 @notnotype/nb-harness/models
createModelCatalog(input: {config: HarnessConfig}): ModelCatalog;      // 纯函数式：只看传入的快照
interface ModelCatalog {
    list(): ModelSummary[];
    resolve(ref: string): ModelResult<Model>;
    select(request: SelectRequest): ModelResult<Selected>;
    checkCapabilities(model: Model, required: Capabilities): CapabilityProblem[];
}
type ModelSummary = {ref: string; name: string; provider: string; source: "config" | "bundled"; input: ("text" | "image")[]; supportsTools: boolean; contextWindow: number | null};
type SelectRequest = {model?: string; role?: string; profile?: {id: string; model?: string; defaultRole?: string}};
type Selected = {model: Model; via: "explicit" | "role" | "profile-model" | "profile-role" | "default"; role?: string};
type Capabilities = {tools?: boolean; images?: boolean};
type CapabilityProblem = {capability: "tools" | "images"; detail: string};

openCredentials(options: {sqlitePath: string}): Promise<ModelResult<Credentials>>;   // OMP 的 SQLite 凭据库；文件不存在则创建
createCredentials(store: AuthCredentialStore): Credentials;                         // 使用方自己实现的存储（插件阶段接 nbook.settings 的密钥）
interface Credentials {
    apiKeyFor(model: Model): Promise<string | undefined>;      // 只用凭据存储里的 API key 或 OAuth 令牌，不读环境变量
    setApiKey(provider: string, key: string): Promise<void>;
    removeApiKey(provider: string): Promise<void>;
    status(provider: string): {kind: "api_key" | "oauth" | null};
    loginProviders(): {id: string; name: string}[];
    login(provider: string, controller: OAuthController): Promise<ModelResult<{accountId?: string}>>;
    logout(provider: string): Promise<void>;
    accounts(provider: string): {accountId: string; label?: string}[];
    close(): void;
}
type ModelResult<T> = {ok: true; value: T} | {ok: false; code: ModelFailure; detail: string};
type ModelFailure = "invalid-model-ref" | "unknown-provider" | "unknown-model" | "unknown-role" | "role-not-bound" | "no-default-model"
    | "credentials-unavailable" | "login-failed" | "login-cancelled";
```

`Model`、`AuthCredentialStore`、`OAuthController` 是 OMP（`@oh-my-pi/pi-catalog`、`@oh-my-pi/pi-ai`）的类型。

## 输出与可观察行为

1. **目录**：`list` 给出配置里每个自建服务的每个模型（`source: "config"`）与 OMP 内置目录的全部模型（`source: "bundled"`）；同一个引用两边都有时只列配置里的。
2. **解析**：`resolve(ref)` 按模型引用返回 OMP `Model`：配置里有则按 `ProviderConfig` 与 `ProviderModelConfig` 构造（`api`、`baseUrl`、`headers`、`contextWindow`、`maxTokens`、`input`、`reasoning`、`supportsTools` 取配置的值，未给的能力按保守值：`input: ["text"]`、`reasoning: false`、`supportsTools: true`、`contextWindow: null`、`maxTokens: null`）；配置里没有则查 OMP 目录。语法不对为 `invalid-model-ref`，服务两边都没有为 `unknown-provider`，服务有但模型没有为 `unknown-model`。
3. **选择链**：`select` 依次看 `request.model`（有则解析，失败按解析的失败码返回）、`request.role`（角色不在 `roles.items` 为 `unknown-role`，`modelKey` 为 `null` 为 `role-not-bound`，不沿链继续）、`request.profile.model`、`request.profile.defaultRole`（同角色规则）、`config.models.defaultModel`；全部没有为 `no-default-model`。返回选中的模型与 `via`（命中的那一环）；经角色命中时附 `role`。
4. **能力检查**：`checkCapabilities` 对 `required.tools` 看 `model.supportsTools`（未声明按支持），对 `required.images` 看 `model.input` 含 `"image"`；不满足的各一条问题。
5. **凭据存储**：`openCredentials` 打开或创建 SQLite 凭据库；打不开为 `credentials-unavailable`。`createCredentials` 接受使用方实现的存储。两者返回的 `Credentials` 行为相同。
6. **取 key**：`apiKeyFor(model)` 返回该模型服务在凭据存储里的 API key，或 OAuth 令牌换来的访问令牌；存储里没有该服务的凭据时返回 `undefined`，即使进程的环境变量里有这个服务的 key。
7. **写 key**：`setApiKey` 写入后 `apiKeyFor` 立即可取、重开存储后仍在；`removeApiKey` 后为 `undefined`；`status` 反映当前凭据的种类。
8. **OAuth**：`loginProviders` 列出 OMP 支持登录的服务；`login` 用使用方的 `OAuthController` 完成登录并存下凭据，用户取消（`controller.signal` 中止）为 `login-cancelled`，其它失败为 `login-failed`；`logout` 删除该服务的凭据；`accounts` 列出已登录的账号。
9. **关闭**：`close` 后不再读写存储；再调用 `apiKeyFor` 等方法返回 `undefined` 或空数组，不抛出。
10. **纯函数式目录**：`createModelCatalog` 只读传入的快照；配置快照被替换时使用方用新快照另建目录。

## 状态与转换

目录没有状态。凭据存储的状态在 OMP 的存储里（SQLite 文件或使用方的实现）。

**时序与寿命**：

- `openCredentials` 返回后方法立即可用；`close` 后作废。
- 同一个 SQLite 文件可以被多个进程打开（OMP 的存储自己处理锁）；本模块不承诺跨进程的即时可见性。

## 副作用与数据

- **SQLite 凭据库**：路径由使用方给出，格式归 OMP；本模块不读写环境变量、不写别的文件。
- **OMP 的导入期副作用**：`@oh-my-pi/pi-utils` 在导入时读 `.env` 并改写 `Bun.env`（[OMP 能力报告](../../../packages/nb-harness/docs/omp-capabilities.md)）；本模块不依赖它改写的任何值。

## 失败与恢复

| 失败码 | 含义 | 调用方怎么办 |
|---|---|---|
| `invalid-model-ref` | 模型引用不是 `<providerId>/<modelId>` | 修正引用 |
| `unknown-provider` | 配置与 OMP 目录里都没有这个服务 | 在配置里加自建服务，或改引用 |
| `unknown-model` | 服务有，模型没有 | 改引用，或在自建服务里加模型 |
| `unknown-role` | 角色不在配置的 `roles.items` 里 | 修正角色 id 或配置 |
| `role-not-bound` | 角色存在但没有绑定模型 | 在配置里给角色绑定模型；不沿链回落 |
| `no-default-model` | 选择链走到底也没有模型 | 配置 `models.defaultModel` |
| `credentials-unavailable` | 凭据库打不开（路径、权限、文件损坏） | 检查路径与权限 |
| `login-failed` | OAuth 登录失败 | 看 `detail`，重试 |
| `login-cancelled` | 登录被使用方取消 | 不需要处理 |

## 边界与兼容

- **公开接口**：`@notnotype/nb-harness/models` 中“输入与前置条件”列出的符号与类型。
- **依赖**：依赖 `config` 模块的类型；运行时依赖 OMP 的 `@oh-my-pi/pi-ai`（`AuthStorage`、OAuth 注册表）与 `@oh-my-pi/pi-catalog`（内置目录、`buildModel`）。
- **信任边界**：凭据只在服务端进程里；本模块不把 key 写进日志、错误信息或返回的 `Model` 对象。
- **兼容**：OMP 升级改变目录或凭据库格式时，按 OMP 的迁移处理；本模块的接口不变。

## 验收与 Smoke

1. 配置里自建一个服务并覆盖 OMP 目录里同名服务的一个模型：`list` 里该引用只出现一次且 `source: "config"`，`resolve` 得到配置的 `baseUrl`；目录里另一个模型照常解析为 `bundled`。
2. 选择链：显式模型优先；角色未绑定为 `role-not-bound` 且不回落到 Profile 的模型；Profile 的模型其次；Profile 的缺省角色再次；最后全局缺省；全部没有为 `no-default-model`。
3. 凭据：在真实临时目录新建 SQLite 凭据库，`setApiKey` 后 `apiKeyFor` 可取、重开后仍在、`removeApiKey` 后为 `undefined`；进程环境变量里放一个服务的 key 而存储里没有时 `apiKeyFor` 为 `undefined`。
4. 真实模型冒烟（`*.llm.test.ts`，只在 `bun run test:llm` 下运行，需要开发者授权）：从环境变量把一个服务的 key 写进临时凭据库，用目录解析该模型、取 key，经 OMP `streamSimple` 完成一次最短的对话。

Smoke：`packages/nb-harness` 的 `bun test src/models`；真实模型冒烟 `bun run test:llm`。

## 实现合同

- 公开入口：`@notnotype/nb-harness/models`（`createModelCatalog`、`openCredentials`、`createCredentials`、`parseModelRef` 与“输入与前置条件”的类型）。
- owner：`nb-harness` 的 `models` 模块；对 `config` 只 `import type`；运行时依赖 `@oh-my-pi/pi-ai`（`AuthStorage`、OAuth 注册表）与 `@oh-my-pi/pi-catalog`（内置目录、`buildModel`）。
- 内部不变量（都有测试锁定）：
  1. 目录只看传入的配置快照；配置里的模型覆盖 OMP 目录里的同名模型。
  2. 选择链每环命中即返回，角色环的失败不回落。
  3. API key 直接读存下的凭据，不经 OMP 的 `getApiKey`（它把环境变量排在存下的 key 之前）；只有 OAuth 经 `getApiKey` 换访问令牌。
  4. `openCredentials` 打开后先 `reload`，否则已有凭据读不到。

## 证据

- 实现入口：[`packages/nb-harness/src/models/models.ts`](../../../packages/nb-harness/src/models/models.ts)
- 合同测试：[`catalog.test.ts`](../../../packages/nb-harness/src/models/catalog.test.ts)、[`credentials.test.ts`](../../../packages/nb-harness/src/models/credentials.test.ts)（真实临时目录里的 SQLite 凭据库）
- Smoke：[`models.llm.test.ts`](../../../packages/nb-harness/src/models/models.llm.test.ts)（真实模型，只在 `bun run test:llm` 下运行；尚未运行，待开发者授权）
- 批准依据：[Agent harness 内核](../../proposals/agent-harness-kernel.md) 的“模型与凭据（直接使用 OMP）”“模型角色”两节（开发者 2026-10-10 决定：不另设适配器层，模型与凭据直接用 OMP；内核不读环境变量；角色按模型角色合同解析）与 [模型角色合同](../../proposals/model-roles-contract.md)（`accepted`）。
