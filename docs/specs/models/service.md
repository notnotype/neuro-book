---
schema: nbook.spec/v1
kind: behavior
status: planned
capability: models.service
owners:
  - nbook.models
  - nb-harness
---

# 模型服务

## 目标与非目标

内置插件 `nbook.models` 管“用哪个模型、凭什么密钥”：用户添加的服务商与模型、密钥、模型角色，并给 harness 内核实现模型端口（[`harness/models.md`](../harness/models.md)）。Agent 插件、编辑器的行内 AI、应用里的 nb-story 都经它取模型；密钥不出这个插件。设置界面的合同另写（`models/settings-pages.md`，随界面实施）。

不承诺：

- OAuth 登录（用订阅账号）；发现方式之外的协议（Ollama、LM Studio、LiteLLM 的专用接口）；兼容选项、扩展窗口、用命令取密钥；阶梯价；代理、超时与重试设置。
- 凭据库被外部工具修改时的热更新：重开应用才看得到。
- 目录模型改名后的自动迁移：引用按“目录漂移”处理（输出 9）。

## 术语与参与者

- **服务商**：一个模型来源。**目录服务商**来自 OMP 的内置目录（Anthropic、DeepSeek……），能力与单价按目录；**自定义服务商**是用户填地址与接口格式的 OpenAI 兼容端点（中转站、本机的 vLLM 等）。
- **模型角色**：梯度四档 `tiny`、`fast`、`main`、`deep`，专精角色 `compaction` 与用户自建的；每个角色绑一个模型（[模型角色合同](../../proposals/model-roles-contract.md)）。
- **凭据库**：`<状态根>/agent/credentials.db`，OMP 的 `AuthStorage`，明文 SQLite。
- **启动环境**：服务端进程启动时 `process.env` 的快照，早于任何导入 OMP 的模块（OMP 导入时会把家目录等处的 `.env` 并进 `process.env`，那些不算，口径同 ADR 0032）。

## 输入与前置条件

两个设置项（[`settings/configuration.md`](../settings/configuration.md)），都只允许用户层，只由 `nbook.models` 的服务端写（输出 6）：

```ts
// nbook.models/providers
type Providers = Array<{
    id: string;                       // [a-z0-9][a-z0-9._-]*，不含 /；目录服务商即目录 id
    kind: "catalog" | "custom";
    name: string;
    baseUrl?: string;                 // 自定义必填；目录服务商写了就覆盖目录的地址
    api?: "openai-completions" | "openai-responses" | "anthropic-messages";   // 自定义必填
    apiKeyEnv?: string;               // 有值时密钥取这个环境变量，盖过凭据库
    auth: "default" | "bearer" | "none";
    headers: Record<string, string>;  // 值可写 env:<变量名>
    models: Array<{
        id: string;                   // 第一个 / 之后的整体（OpenRouter 的 id 自带 /）
        name?: string; group?: string; enabled: boolean;
        contextWindow?: number;       // 自定义模型启用时必填、正整数
        maxOutput?: number; vision?: boolean; reasoning?: boolean; efforts?: string[];
        compactAt?: number;
        price?: [number, number, number, number] | null;   // 美元每百万 token：输入、输出、缓存读、缓存写；null 未知
        headers: Record<string, string>;
    }>;
}>;
// nbook.models/roles
type Roles = {items: Array<{id: string; axis: "gradient" | "specialist"; name: string; description: string; model: string | null}>};
```

目录模型在设置里只存用户改过的字段，其余每次从目录读。缺省的角色是四档加 `compaction`，都未绑定。

进程内服务 `modelsKey` 与远程合同 `nbook.models/settings` 见输出 10、12。

## 输出与可观察行为

1. **密钥的来源**：服务商 `auth: "none"` 时不带密钥；`apiKeyEnv` 有值时取启动环境里的这个变量；否则取凭据库里这家的 API Key。请求头的值写 `env:<变量名>` 时同样取启动环境。只认启动环境：之后再设的变量要重启才生效。
2. **凭据库**：只经 OMP 的公开接口读写，只管 API Key 行。写入是 OMP 的替换语义：同一服务商在库里的其它凭据一并软删除（第一版库里只有本插件写的 API Key）。目录不存在时以 0700 建，库文件 0600；已有目录不改权限，做不到的平台（Windows）尽力而为。本进程是唯一写者（一个状态根一个服务端），内存里的状态以本进程的写为准。
3. **认证方式**：`default` 按接口格式（OpenAI 系 `Authorization: Bearer`，Anthropic `x-api-key`）；`bearer` 另加 `Authorization: Bearer <密钥>`；`none` 见输出 1。
4. **请求头**：服务商级与模型级合在一起随每个请求发出，同名时模型的赢；它们的值与密钥一样在错误文字里遮盖（[`harness/models.md`](../harness/models.md) 输出 4）。
5. **配置的校验**：自定义服务商的 id 由名字生成（转成 `[a-z0-9._-]`，中文名转成 `custom`），与已添加的和目录里的 id 冲突时加 `-2`、`-3`，建后不变；自定义模型 `enabled` 时上下文窗口必须是正整数，缺字段的模型只能停用；不合校验的写入为 `invalid-value`。
6. **写入只经服务端**：两个设置项的每次改动都经远程方法按 id 打补丁；服务端一个串行队列，每次读本层当前值、合并这一处、带 `expect` 写回（[`configuration.md`](../settings/configuration.md) 输出 25），得 `conflict` 就重读重合并，最多 3 次，仍冲突为 `write-conflict`。同一窗口连着改、两个窗口改不同的项、设置文件视图同时编辑都不会互相覆盖；两处改同一项的同一字段，后到的生效。直接改设置文件照常生效。
7. **快照**：服务端在内存里维护目录、两个设置项、凭据库里有 API Key 的服务商、启动环境里 `apiKeyEnv` 有没有值；设置变化、本进程写完凭据之后重算（与写入同一个串行队列）。入口激活时先打开凭据库并读完一次，之后才提供 `modelsKey`。
8. **解析**（模型端口 `resolve(query)`）：

   | 用途 | 取模型 |
   |---|---|
   | `turn`、`background`（含预览、`complete()`） | 调用方指名的角色 → 会话里选的 `settings.model` → Profile 设置里的模型 → 角色（Profile 设置里的角色，没有则 `main`） |
   | `compaction` | 调用方指名的角色 → `compaction` |
   | `approval` | 调用方指名的角色 → `fast` |

   走到角色而它没有绑定：`role-unbound`（不回落到别的模型）；指名的或绑定的模型不在、没启用、自定义模型缺上下文窗口：`unknown-model`；没有可用的密钥：`no-credentials`；`main` 也解析不到时同样按这几条。推理档按模型支持的档夹取（同 harness）。
9. **目录漂移**：设置里引用的目录模型不在目录里了（OMP 升级），引用保留并在快照里标 `missing`（原服务商与模型 id），解析为 `unknown-model`，写一条诊断；用户在界面里重新选。
10. **`modelsKey`**：`port(profileDefaults?)` 交出所有会话共用的模型端口，`profileDefaults(profile)` 每次解析都调，换 Profile、改 Profile 设置即时生效；`snapshot()` 给出启用的模型、角色及其有效性；`onChange`。
11. **检测**：`check` 发一条很短的请求（最大输出 min(32, 模型上限)、不带推理、超时 30 秒），结果是通过，或失败的类别、一句话与服务商原文（遮盖过、截到 8 KB）；`checkAll` 并发至多 4。结果不落盘。
12. **远程合同 `nbook.models/settings`**（版本 1，服务端提供，浏览器调用）：

    | 方法 | 读写 | 业务码 |
    |---|---|---|
    | `catalogProviders()` | read | 无 |
    | `catalogModels(provider)` | read | `unknown-provider` |
    | `snapshot()`，事件 `changed` | read | 无 |
    | `addProvider`、`updateProvider`、`removeProvider` | write | `unknown-provider`、`invalid-value`、`write-conflict`、`settings-unavailable` |
    | `upsertModel`、`removeModel`、`setModels` | write | 同上，加 `model-incomplete` |
    | `setRole`、`addRole`、`updateRole`、`removeRole` | write | `unknown-role`、`builtin-role`、`invalid-value`、`write-conflict`、`settings-unavailable` |
    | `setKey`、`clearKey` | write | `unknown-provider`、`invalid-value`、`credentials-unavailable`、`settings-unavailable`、`partially-applied` |
    | `discover(provider)` | read | `unknown-provider`、`no-credentials`、`not-supported`、`auth`、`unreachable`、`failed` |
    | `check`、`checkAll` | read | `unknown-provider`、`unknown-model` |

    设置写入失败的映射：`invalid-value` 原样；`conflict` 重试后仍冲突为 `write-conflict`；层文件有错、写盘失败、连不上为 `settings-unavailable`。任何响应、事件与诊断里都没有密钥与请求头的值；`keyStatus` 只说有没有、读的是哪个变量、变量有没有值。
13. **`setKey`**：值以 `env:` 开头时先写 `apiKeyEnv`、再删库里的密钥；否则先写库、再清 `apiKeyEnv`。`apiKeyEnv` 有值时盖过库里的密钥，所以后一步失败时生效的仍是前一步之前的或之后的那一个、不会混用；这时返回 `partially-applied`，详情带写后的实际密钥状态。
14. **压缩角色的初值**：第一次绑 `fast` 而 `compaction` 未绑时，同一次写把 `compaction` 设成同一个模型（压缩先跟着快速档，之后各改各的）。
15. **删除时解除绑定**：删服务商、删模型（含“管理模型”里移出）之后，绑着它们的角色变成未绑定（`role-unbound`），不留指向不存在的模型的引用；停用模型不解除，角色这时解析为 `unknown-model`，重新启用即恢复。删服务商同时删掉凭据库里这家的密钥。

## 状态与转换

- 入口激活：打开凭据库 → 读设置与目录 → 建快照 → 提供 `modelsKey` 与远程合同。打开失败时入口激活失败，`modelsKey` 不可用，调用方按依赖缺失处理。
- 时序与寿命：
  - `resolve` 同步，用的是最近一次重算的快照；本进程的写在写入方法返回之前已反映进快照。
  - 解析时有密钥、请求前密钥被清掉：请求以 `auth`、`missing-key` 失败（模型请求已开始，按普通模型失败收口）。
  - 入口停止：串行队列走完已接纳的写入，关闭凭据库；之后 `modelsKey` 不可用，远程调用得 `unavailable`。

## 副作用与数据

- 设置文件（用户层）的两个键；凭据库文件。都在状态根下，不随作品走。
- 诊断：写入（不记值）、目录漂移、权限做不到。

## 失败与恢复

| 码 | 含义 | 调用方怎么办 |
|---|---|---|
| `no-credentials` | 这家没有可用的密钥 | 去设置里填密钥或设环境变量 |
| `unknown-model` | 模型不在、没启用或缺上下文窗口 | 去设置里选别的模型或补字段 |
| `role-unbound` | 要的角色没有绑定模型 | 去“模型角色”绑定 |
| `write-conflict` | 重试 3 次仍有别处同时在写 | 稍后重试 |
| `settings-unavailable` | 设置文件有错或写不进去 | 先修好设置文件 |
| `credentials-unavailable` | 凭据库读写失败 | 看诊断 |
| `partially-applied` | `setKey` 两步只成了一步 | 按返回的实际状态再操作 |
| `model-incomplete` | 启用的自定义模型缺上下文窗口 | 补字段后再启用 |

## 边界与兼容

- 公开接口：`modelsKey`（`shared/contracts.ts`）、远程合同 `nbook.models/settings`、两个设置项的形状。
- 依赖 `@notnotype/nb-harness/models`（目录、凭据库、按配置建出解析结果）。OMP 升级时目录与能力随之变。
- 信任边界：浏览器只拿到“有没有密钥”；设置文件里只有变量名，不放密钥。请求头的值写在设置文件里，界面在名称像凭据时提示改用 `env:`。

## 验收与 Smoke

1. 自定义服务商（本机假的 OpenAI 兼容端点）：添加、设密钥、拉取模型、加入并补上下文窗口、启用、绑定 `main`、Agent 一轮对话走到这个端点；删除服务商后 `main` 为 `role-unbound`。
2. 两个窗口经真实 RPC 同时改两个不同的服务商，两处改动都在；设置文件视图在服务端合并期间写入，内容不丢。
3. `setKey` 的 `env:` 与原文互换；启动环境里有、`process.env` 里后来才有的变量不算。

Smoke：`packages/neuro-book/src/plugins/models/` 的插件测试与 `e2e/models.e2e.ts`（实施时建）。

## 证据

- 批准依据：w00032 t09 决定 1 到 32（[Task README](../../../.agents/works/w00032-agent-integration/tasks/t09-models/README.md)）、[模型角色合同](../../proposals/model-roles-contract.md)
