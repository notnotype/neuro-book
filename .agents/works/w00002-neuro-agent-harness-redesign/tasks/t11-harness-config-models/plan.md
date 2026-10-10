# t11 实施计划：`config` 与 `models` 模块

## Context

- **为什么做**：Work 切片 3。`runtime` 要在每次调用开始时取定配置快照、按选择链选模型、取凭据；`tools` 的审批模式也读配置。这两个模块把“配置是什么形状、模型从哪来、凭据怎么拿”收口，`runtime` 只消费结果。
- **依据**：[`harness.config`](../../../../../docs/specs/harness/config.md)、[`harness.models`](../../../../../docs/specs/harness/models.md)（本 Task 新写的 `planned` Spec）；[Agent harness 内核](../../../../../docs/proposals/agent-harness-kernel.md)（`accepted`）的“配置”“模型与凭据”“模型角色”；[模型角色合同](../../../../../docs/proposals/model-roles-contract.md)。
- **开发者已确认的决定**：内核只接收合成好的配置快照与变化通知；凭据不进配置；校验失败的配置不被采用、旧快照继续有效、给出结构化问题列表；模型与凭据直接用 OMP，不另设适配器；内核不读环境变量；角色按合同解析，角色未绑定报配置错误、不回落。
- **工作方式**：同 t09、t10：逐片提交，主 Agent 编码，omp 计划审查与实现审查；测试用真实依赖（真实 SQLite 凭据库在临时目录）；每片做变异检查。真实模型冒烟只写不跑。

## 关键设计

### 1. 配置 schema 与校验（`src/config/schema.ts`、`validate.ts`）

- TypeBox 写出 `HarnessConfig` 的 schema（`additionalProperties: false`，未知字段报问题）；`Value.Errors` 的每条错误转成 `ConfigProblem`（`instancePath` 转成点与方括号记法）。先做 JSON 如实表示的遍历（复用 session 里的做法，但不导入 `session`：`config` 不依赖其它模块，另写一份小的）。
- schema 之外的规则（唯一性、模型引用语法、空字符串按未给出）在一个显式的检查函数里逐条收集，与 schema 的问题合并后一起返回（输出 1 的“全部问题”）。
- 规范化：缺省值用 `Value.Default` 之外的显式填充（只填四个有缺省的字段），再 `structuredClone` 后深冻结。

### 2. 存储（`src/config/store.ts`、入口 `config.ts`）

- `createConfigStore(initial)`：校验失败直接返回问题；成功持有 `current`。`replace` 校验成功后换引用、同步通知订阅者快照（每个监听函数单独 `try/catch`，抛错不影响其它与返回值）；失败不动 `current`、不通知。
- `package.json` 加 `./config`；模块表登记 `config`（只 `typebox`）。

### 3. 目录与解析（`src/models/catalog.ts`）

- `createModelCatalog({config})`：配置的 `ProviderConfig` 经 `@oh-my-pi/pi-catalog` 的 `buildModel` 构造 OMP `Model`（`cost` 填零、能力按 Spec 输出 2 的缺省）；内置目录经 `getBundledProviders`/`getBundledModels`/`getBundledModel`。`resolve` 先查配置、再查内置；`list` 合并并去重（配置优先）。
- 模型引用解析成 `{providerId, modelId}` 的函数单独写，`config` 的校验与这里共用同一个正则（各自声明，不跨模块导入）。

### 4. 选择链与能力（`src/models/select.ts`）

- `select` 按 Spec 输出 3 顺序逐环：每环“命中就解析并返回（解析失败按失败码返回）”，角色环 `unknown-role`/`role-not-bound` 直接返回不继续。
- `checkCapabilities` 只看 `supportsTools`（未声明按 `true`）与 `input`。

### 5. 凭据（`src/models/credentials.ts`）

- `openCredentials({sqlitePath})` → `AuthStorage.create(path)`（OMP 自带的 `SqliteAuthCredentialStore`），异常 → `credentials-unavailable`；`createCredentials(store)` → `new AuthStorage(store)`。
- `apiKeyFor(model)`：不用 OMP 的 `getApiKey`（实测它把环境变量排在存下的 API key 之前，OAuth 不可用时也回落到环境变量；计划审查第 1 条）：`get(provider)` 读存下的凭据，API key 直接返回 key，OAuth 经只看存储的 `getOAuthAccess` 换访问令牌，没有就是 `undefined`。
- 打开：`openCredentials` 先看文件头，已存在但不是 SQLite 的文件直接 `credentials-unavailable`、不交给 OMP（OMP 会把损坏库备份成 `.corrupt-…` 并换成空库，调用方看不出凭据丢了；计划审查第 4 条）；`createCredentials(store)` 改为异步，和 SQLite 入口一样先 `reload`（计划审查第 2 条：构造函数不读已有凭据）。`accounts` 不按 `accountId` 过滤，带 `credentialId` 与 `active`（计划审查第 3 条）。
- `setApiKey` → `set(provider, {type: "api_key", key})`；`removeApiKey` → `remove(provider)`；`status` 看 `getCredentialOrigin`/`hasOAuth`；`loginProviders` → OMP `getOAuthProviders()`；`login` → `AuthStorage.login(provider, controller)`，`controller.signal` 已中止或登录过程中中止 → `login-cancelled`，其它异常 → `login-failed`（`detail` 不含令牌）；`logout` → `logout`；`accounts` → `listOAuthAccounts`。
- `close` 后方法返回空值；用一个 `closed` 标志，不再碰 OMP 对象。

### 6. 真实模型冒烟（`src/models/models.llm.test.ts`）

- 只在 `NBOOK_LLM_TESTS=1`（包脚本 `test:llm`）下运行，否则 `skipIf`：从 `DEEPSEEK_API_KEY` 写进临时凭据库，`resolve("deepseek/deepseek-chat")`，`apiKeyFor`，`streamSimple` 一次只要求回答“ok”。按 `docs/testing/README.md` 的真实模型测试规则放在 `*.llm.test.ts`。本 Task 不运行它（需要开发者授权）。

### 7. 边界测试与包配置

- 模块表：`config`（`typebox` 运行时，无 Node 内置模块）、`models`（`typebox` 运行时、`@oh-my-pi/pi-ai` 与 `@oh-my-pi/pi-catalog` 运行时、依赖模块 `config` 的类型；不允许 Node 内置模块——SQLite 路径交给 OMP）。`models` 对 `config` 只 `import type`。
- `package.json` 加 `./config`、`./models`。

## Spec 与文档改动

| 文档 | 改什么 | 片 |
|---|---|---|
| `docs/specs/harness/config.md`、`models.md` | 本 Task 新写（`planned`）；实现中发现歧义先改 Spec；收口时加“实现合同”与证据行 | 计划时、S3 |
| `docs/specs/README.md` | 两行登记（已做）；收口时标“待晋升” | S3 |
| `packages/nb-harness/package.json`、`src/architecture.test.ts` | 两个入口、模块表两行 | S1、S2 |
| 本 Task README | 每片完成后更新 | 各片 |

## 切片

| 片 | 内容 | 关键设计 | 自跑验证 |
|---|---|---|---|
| S1 | `config`：schema、校验、规范化、存储 | 1、2、7 | `bun test src/config`、`bun run typecheck`、`bun test src/architecture.test.ts` |
| S2 | `models`：目录、解析、选择链、能力检查、凭据与 OAuth 接口、冒烟测试文件 | 3、4、5、6、7 | `bun test src/models`、同上 |
| S3 | Spec 证据与注册表；omp 实现审查 | 全部 | `bun test`、仓库根 `bun run governance:check` 与 `bun run docs:check` |

## 验收映射

| Spec 条目 | 测试 |
|---|---|
| `harness.config` 输出 1–6；场景 1–3；失败码 | `src/config/config.test.ts` |
| `harness.models` 输出 1–4、10；场景 1、2；解析与选择的失败码 | `src/models/catalog.test.ts` |
| `harness.models` 输出 5–9；场景 3；`credentials-unavailable`、`login-cancelled`、`login-failed` | `src/models/credentials.test.ts`（真实临时目录的 SQLite；OAuth 的取消用已中止的 `signal`，失败用不存在的服务 id） |
| `harness.models` 场景 4 | `src/models/models.llm.test.ts`（不在本 Task 运行） |

## 验证

- 包内 `bun test src/config src/models`、`bun run typecheck`；凭据测试用 `createTestTmpRoot` 的真实目录，`afterAll` 关闭存储再删目录。
- 变异检查：问题列表只报第一条、缺省值不填、`replace` 失败也通知、配置不覆盖内置目录、角色未绑定回落到 Profile、`apiKeyFor` 不先查 `hasNonEnvCredential`（环境变量场景应失败）。
- 未验证边界：真实模型冒烟（待授权）；OAuth 真实登录（需要浏览器交互）；多进程共用一个凭据库。

## 不做与风险

- 不做：从网络刷新目录；用量与额度；配置文件读写；审批相关的配置含义（只校验形状）。
- 风险：OMP 内置目录很大，`list` 每次全量构造；第一版接受（只在界面列目录时调用）。
- 风险：`hasNonEnvCredential` 是 OMP 的非文档化方法名（源码里有注释说明用途）；OMP 升级后若改名，`typecheck` 会先失败。
