---
schema: nbook.spec/v1
kind: behavior
status: implemented
capability: models.service
owners:
  - nbook.models
  - nb-models
  - nb-harness
---

# 模型服务

## 目标与非目标

内置插件 `nbook.models` 管“用哪个模型、凭什么密钥”：用户添加的服务商与模型、密钥、模型角色，并给 harness 内核实现模型端口（[`harness/models.md`](../harness/models.md)）。Agent 插件、编辑器的行内 AI、应用里的 nb-story 都经它取模型；密钥不出这个插件。设置界面的合同见 [`models/settings-pages.md`](settings-pages.md)。

不承诺：

- OAuth 登录（用订阅账号）；各协议标准列表接口之外的发现方式（Ollama、LM Studio、LiteLLM 的专用接口）；兼容选项、扩展窗口、用命令取密钥；阶梯价；代理设置。重试次数在 [`agent.run-guards`](../agent/run-guards.md)。
- 不经 HTTP 请求的传输（Cursor、Bedrock 的签名认证、Codex 这类登录通道）：模板列出但不能添加（输出 19）。
- 协议检测只在实例现在的地址（或模板给那种协议的路由）上试四种对话协议，不猜别的地址，也不判断哪个模型能用（输出 26）。
- 在线目录只补打包目录里没有的模型：打包目录里已有的行不随在线目录更新（价目、窗口照打包的）。
- 凭据库被外部工具修改时的热更新：重开应用才看得到。
- 目录模型改名后的自动迁移：引用按“目录漂移”处理（输出 9）。
- 已知限制：写入前检查设置层是否可写，与锁内写之间用户恰好把设置文件改坏的窗口挡不住（要改设置拥有者的写入合同）。

## 术语与参与者

- **模板**：添加服务商时的起点。OMP 打包目录里的每个服务商是一个模板（协议、各协议的地址、模型元数据都来自目录），另有三个**空白模板** `blank-openai`、`blank-anthropic`、`blank-gemini`（没有目录，协议与地址由用户给）。
- **服务商**：模板的一个实例，同一模板可以建多份。名称、协议、地址、图标都能改；`template` 建后不变，只决定初始值和去哪查模型元数据。协议与地址都没改时称**跟随模板**。
- **`uid`**：服务商创建时生成的随机 128 位标识，永不复用；会话日志里的部署身份只认它（同名删建得到新的 `uid`）。v1 设置里的服务商没有 `uid`，读作 `legacy:<id>`，首次写入时原样写下。
- **来源**：一家服务商的模型从哪来（输出 25）：有这个部署的**服务商的列表**时是列表；没有时是**目录**——打包目录加在线目录里模板这家的对话模型（空白模板没有目录）。**来源模型**是来源里的模型；**手加的模型**是用户自己添加的。设置里的模型条目带来历 `origin: "source" | "manual"`。
- **部署**与**凭据**：列表缓存的两层有效性（输出 25）。部署由 `uid`、列表的变体、有效协议与有效地址算出；凭据是认证输入（密钥与生效的请求头）的 HMAC。
- **类型不明**：列表没说明是不是对话模型、目录里也没有同 id 的行的模型（行的 `kind: "unknown"`）。
- **中性身份**：改了协议或地址、或空白模板的服务商，发请求时不用模板的 OMP 服务商 id，用 `generic-endpoint`（[`harness/models.md`](../harness/models.md) 输出 21）。
- **模型角色**：梯度四档 `tiny`、`fast`、`main`、`deep`，专精角色 `compaction` 与用户自建的；每个角色绑一个模型（[模型角色合同](../../proposals/model-roles-contract.md)）。
- **凭据库**：`<状态根>/agent/credentials.db`，OMP 的 `AuthStorage`，明文 SQLite。
- **启动环境**：服务端进程启动时 `process.env` 的快照，早于任何导入 OMP 的模块（OMP 导入时会把家目录等处的 `.env` 并进 `process.env`，那些不算，口径同 ADR 0032）。

## 输入与前置条件

两个设置项（[`settings/configuration.md`](../settings/configuration.md)），都只允许用户层，只由 `nbook.models` 的服务端写（输出 6）：

```ts
// nbook.models/providers（v2；v1 形状的读法见下文）
type Providers = Array<{
    id: string;                       // [a-z0-9][a-z0-9._-]*，不含 /；由名称生成（输出 5），建后不变
    uid: string;                      // 见“术语”
    template: string;                 // 模板 id，建后不变
    region?: string;                  // 有地区的模板（Moonshot、MiniMax）选的地区
    name: string;                     // 不分大小写不重名
    icon?: {kind: "builtin"; key: string} | {kind: "file"; name: string} | {kind: "initial"};   // 不写是模板的图标（输出 21）
    api?: "openai-completions" | "openai-responses" | "anthropic-messages" | "google-generative-ai";   // 覆盖模板的协议；空白模板建立时写入
    baseUrl?: string;                 // 覆盖模板（或地区）的地址；空白模板必填
    apiKeyEnv?: string;               // 有值时密钥取这个环境变量，盖过凭据库
    auth: "default" | "bearer" | "none";
    headers?: Record<string, string>; // 值可写 env:<变量名>
    followSource: boolean;            // 服务商新出的模型自动加入（输出 22）
    excluded: string[];               // 用户移出的来源模型 id
    models: Array<{
        id: string;                   // 第一个 / 之后的整体（OpenRouter 的 id 自带 /）
        origin?: "source" | "manual"; // 来历；不写按 manual
        frozen?: true;                // 关掉自动加入时补的条目（输出 22）
        name?: string; group?: string; enabled: boolean;
        contextWindow?: number;       // 来源没给窗口时，启用前必填、正整数
        maxOutput?: number; vision?: boolean; reasoning?: boolean; efforts?: string[];
        compaction?: {mode: "reserve" | "percent" | "tokens"; value?: number};   // 自动压缩的触发点，覆盖全局；旧的 compactAt 读作 {mode: "tokens"}，保存时写新形状
        price?: [number, number, number, number] | null;   // 美元每百万 token：输入、输出、缓存读、缓存写；null 未知
        headers?: Record<string, string>;
    }>;
}>;
// nbook.models/roles
type Roles = {items: Array<{id: string; axis: "gradient" | "specialist"; name: string; description: string; model: string | null;
    effort?: "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";   // 角色的默认思考档，不写是跟随模型（输出 18）
    icon?: string;                                                              // 角色图标的键，键到图标的表在应用里}>};
```

来源模型在设置里只存用户改过的字段与启用开关，其余每次从来源读；没有条目的来源模型按来源值、启用，缺上下文窗口的不启用（要用户补上）。缺省的角色是四档加 `compaction`，都未绑定。

**v1 形状的读法**：设置里每个服务商可以是 v2，也可以是 v1 的 `{id, kind: "catalog" | "custom", name, baseUrl?, api?, apiKeyEnv?, auth, headers?, models}`，读的时候按 v1 运行时的语义归一，行为与升级前相同；第一次写服务商设置时整份写成 v2：

| v1 | 读作 |
|---|---|
| 目录服务商 | `template` 是它的 id；旧的 `api` 不起作用（v1 就是这样），`baseUrl` 是覆盖；`followSource: false`（只有显式加入的模型在列表里）；条目 `origin: "source"`，只保留 v1 运行时认的字段 `enabled`、`name`、`group`、`price`、`headers` 与压缩触发点，写在目录条目上的 `contextWindow`、`vision` 等本来就被忽略，首次写入后不再保留 |
| 自定义服务商 | `template` 是 `blank-anthropic`（`api` 是 `anthropic-messages` 时）或 `blank-openai`；字段全部保留，条目 `origin: "manual"` |
| 都没有 `uid` | `legacy:<id>`，首次写入时写下 |

写入带的 `expect` 是磁盘上的原值，不是归一后的值，所以 v1 的值不会因归一被误判为冲突（输出 6）。

进程内服务 `modelsKey` 与远程合同 `nbook.models/settings` 见输出 10、12。

另有两个设置项 `nbook.models/streamFirstEventTimeoutSeconds`、`streamIdleTimeoutSeconds`：整数 0–3600，缺省 300，0 表示不设，只允许用户层，显示在 [`agent.run-guards`](../agent/run-guards.md) 的分区里。

`nbook.models/catalogAutoUpdate`：布尔，缺省开，只允许用户层，显示在 `nbook.network` 的“网络”分区里；开着时模型服务在后台自动拉列表与在线目录（输出 25），关着时只在用户点“重新拉取”时拉。

启动环境 `NBOOK_MODELS_CATALOG_URL`：在线目录的地址，缺省 `https://catalog.stencil.so/models.json.zstd`；设成空串不取在线目录（离线环境；e2e 与测试场地这样设）。

## 输出与可观察行为

1. **密钥的来源**：服务商 `auth: "none"` 时不带密钥；`apiKeyEnv` 有值时取启动环境里的这个变量；否则取凭据库里这家的 API Key。请求头的值写 `env:<变量名>` 时同样取启动环境。只认启动环境：之后再设的变量要重启才生效。
2. **凭据库**：只经 OMP 的公开接口读写，只管 API Key 行。写入是 OMP 的替换语义：同一服务商在库里的其它凭据一并软删除（第一版库里只有本插件写的 API Key）。目录不存在时以 0700 建，库文件 0600；已有目录不改权限，做不到的平台（Windows）尽力而为。本进程是唯一写者（一个状态根一个服务端），内存里的状态以本进程的写为准。
3. **认证方式**：`default` 按接口格式（OpenAI 系 `Authorization: Bearer`，Anthropic `x-api-key`，Gemini `x-goog-api-key`；中性身份的 Anthropic 协议发 `Authorization: Bearer`）；`bearer` 另加 `Authorization: Bearer <密钥>`；`none` 见输出 1。
4. **请求头**：服务商级与模型级合在一起随每个请求发出，同名时模型的赢；它们的值与密钥一样在错误文字里遮盖（[`harness/models.md`](../harness/models.md) 输出 4）。
5. **配置的校验**：服务商的 id 由名称生成（转成 `[a-z0-9._-]`，转不出字符时用 `provider`），与已添加的冲突时加 `-2`、`-3`，建后不变；名称不分大小写不能与别家重名（新建与复制时自动加“ 2”“ 3”，改名重名为 `invalid-value`）；地址必须是 `http:` 或 `https:` 的 URL；空白模板不能没有地址；选的协议在模板里没有地址又没给覆盖地址时为 `invalid-value`。有效上下文窗口（用户填的，否则来源的）不明的模型只能停用，启用为 `model-incomplete`；不合校验的写入为 `invalid-value`。服务商设置整份序列化、再作为文本编码一层（写盘时设置全文就是这样进 RPC 帧的）后超过 768 KiB 的写入为 `invalid-value`；几百个模型的覆盖也远在其下。
6. **写入只经服务端**：两个设置项的每次改动都经远程方法按 id 打补丁；设置文件里这一项写着、但没通过设置的校验（设置层拒收、原文还在）时，写入为 `settings-unavailable`（`layer-invalid`），不把它当成空值整份盖掉，用户先去设置文件里修；服务端一个串行队列，每次读本层当前值、合并这一处、带 `expect` 写回（[`configuration.md`](../settings/configuration.md) 输出 25），得 `conflict` 就重读重合并，最多 3 次，仍冲突为 `write-conflict`。同一窗口连着改、两个窗口改不同的项、设置文件视图同时编辑都不会互相覆盖；两处改同一项的同一字段，后到的生效。直接改设置文件照常生效。
7. **快照**：服务端在内存里维护目录、两个设置项、凭据库里有 API Key 的服务商、启动环境里 `apiKeyEnv` 有没有值；设置变化、本进程写完凭据之后重算（与写入同一个串行队列）。入口激活时先打开凭据库并读完一次，之后才提供 `modelsKey`。远程合同的快照里服务商带模板、地区、图标、实际与模板的协议和地址、密钥状态、`followSource`、列表状态 `source`（输出 25）、模型数、启用数、移出数与这家的 `modelsRevision`，**不带模型行**（行经输出 23 分页读）；`modelsRevision` 在这家的模型行有任何变化（条目、移出、密钥状态、来源换了一份）时变，别家的不受影响。
8. **解析**（模型端口 `resolve(query)`）：

   | 用途 | 取模型 |
   |---|---|
   | `turn`、`background`（含预览、`complete()`） | 调用方指名的角色 → 会话里选的 `settings.model` → Profile 设置里的模型 → 角色（Profile 设置里的角色，没有则 `main`） |
   | `compaction` | 调用方指名的角色 → `compaction` |
   | `approval` | 调用方指名的角色 → `fast` |

   `settings.model` 除了模型引用，还可以是 `role:<角色 id>`（会话选的是角色，改绑后跟着变）：角色不存在或 id 为空得 `unknown-model`，存在但没绑定得 `role-unbound`。

   走到角色而它没有绑定：`role-unbound`（不回落到别的模型）；指名的或绑定的模型不在列表里（含已移出）、没启用、有效上下文窗口不明、目录里有但不能当对话模型发（行的状态 `unsupported`）：`unknown-model`；没有可用的密钥：`no-credentials`；`main` 也解析不到时同样按这几条。推理档按模型支持的档夹取（输出 18）。失败结果带上选中了什么：走到角色时（包括角色绑定的模型解析失败）带 `role`（角色 id），`no-credentials` 带 `provider`（服务商 id）；会话直接选了模型引用时没有 `role`。对话的提示卡据此写哪个角色、哪家服务商（[agent.conversation](../agent/conversation.md)）。
9. **来源漂移**：设置里来历是 `source` 的条目在来源里没有了（服务商的列表不再有它，或 OMP 升级后目录里没有了），条目保留、模型行标 `missing`（界面写“服务商已不再提供”，可移除），解析为 `unknown-model`，写一条诊断；用户在界面里重新选。目录里有这一行、但它不能当对话模型发（传输不走 HTTP 请求的 Bedrock、Cursor、Codex，或图片生成这类不是对话类的模型）时，行标 `unsupported`，同样解析为 `unknown-model`。
10. **`modelsKey`**：`port(profileDefaults?)` 交出所有会话共用的模型端口，`profileDefaults(profile)` 每次解析都调，换 Profile、改 Profile 设置即时生效；`snapshot()` 给出启用的模型、角色及其有效性；`onChange`。
11. **检测**：`check` 发一条很短的请求（最大输出 min(32, 模型上限)、不带推理、超时 30 秒），结果是通过，或失败的类别、一句话与服务商原文（遮盖过、截到 8 KB）。结果不落盘。服务端没有批量检测：“检测全部”由调用方逐个调 `check`、自己限并发（设置页的做法见 [`models/settings-pages.md`](settings-pages.md) 输出 8）。
12. **远程合同 `nbook.models/settings`**（版本 5，服务端提供，浏览器调用；相对版本 4：删 `checkAll`，加 `detectApi`、`adoptApi`，快照的服务商加连接版本 `connection`；补丁一律“省略不改、`null` 清除”）：

    | 方法 | 读写 | 业务码 |
    |---|---|---|
    | `templates()` | read | 无 |
    | `snapshot()`，事件 `changed` | read | 无 |
    | `addProvider({template, region?, name?, baseUrl?, api?})` | write | `unknown-template`、`template-unavailable`、`invalid-value`、`write-conflict`、`settings-unavailable`、`credentials-unavailable` |
    | `duplicateProvider(id)` | write | `unknown-provider`、`invalid-value`、`write-conflict`、`settings-unavailable`、`credentials-unavailable`、`partially-applied` |
    | `updateProvider({id, patch})`（`name`、`region`、`baseUrl`、`api`、`auth`、`headers`、`followSource`）、`removeProvider` | write | `unknown-provider`、`invalid-value`、`write-conflict`、`settings-unavailable`（删除另有 `credentials-unavailable`） |
    | `setIcon({provider, icon})` | write | 同上，加 `icon-rejected` |
    | `providerModels({provider, scope?, offset, limit, revision?})`、`enabledModels({providers?, usable?, offset, limit, revision?})` | read | `unknown-provider`（前者）、`revision-changed` |
    | `modelsByReference({references})` | read | 无 |
    | `upsertModel`、`removeModel`、`setModels` | write | `unknown-provider`、`invalid-value`、`write-conflict`、`settings-unavailable`，加 `model-incomplete` |
    | `setRole`、`addRole`、`updateRole`、`removeRole` | write | `unknown-role`、`builtin-role`、`invalid-value`、`write-conflict`、`settings-unavailable` |
    | `setKey`、`clearKey` | write | `unknown-provider`、`invalid-value`、`credentials-unavailable`、`settings-unavailable`、`partially-applied` |
    | `refreshSource({provider})`：受理即回，结果经 `changed` 的快照交（输出 25）；会写缓存 | write | `unknown-provider`、`no-credentials`、`settings-unavailable` |
    | `check({provider, model})` | read | `unknown-provider`、`unknown-model` |
    | `detectApi({provider, model?})`：协议检测（输出 26） | read | `unknown-provider`、`no-credentials`、`no-model` |
    | `adoptApi({provider, api, connection})`：采纳检测出的协议 | write | `unknown-provider`、`connection-changed`、`invalid-value`、`write-conflict`、`settings-unavailable` |

    设置写入失败的映射：`invalid-value` 原样；`conflict` 重试后仍冲突为 `write-conflict`；层文件有错、写盘失败、连不上为 `settings-unavailable`。任何响应、事件与诊断里都没有密钥；`keyStatus` 只说有没有、读的是哪个变量、变量有没有值。请求头的值照设置文件原样出现在快照与事件里（设置文件对浏览器本来可读，设置页要显示与编辑它们），不进诊断与错误原文；凭据类的值应写成 `env:<变量名>`（见“边界与兼容”的信任边界）。
13. **`setKey`**：值以 `env:` 开头时先写 `apiKeyEnv`、再删库里的密钥；否则先写库、再清 `apiKeyEnv`。`apiKeyEnv` 有值时盖过库里的密钥，所以后一步失败时生效的仍是前一步之前的或之后的那一个、不会混用；这时返回 `partially-applied`，详情带写后的实际密钥状态。
14. **压缩角色的初值**：第一次绑 `fast` 而 `compaction` 未绑时，同一次写把 `compaction` 设成同一个模型（压缩先跟着快速档，之后各改各的）。
15. **删除时解除绑定**：删服务商、删模型、移出来源模型（进 `excluded`）之后，绑着它们的角色变成未绑定（`role-unbound`），不留指向不存在的模型的引用；停用模型不解除，角色这时解析为 `unknown-model`，重新启用即恢复。删服务商同时删掉凭据库里这家的密钥。
16. **请求的传输**：每次请求现读两个超时设置交给适配器（[`harness/models.md`](../harness/models.md) 输出 18），`maxHttpAttempts` 固定为 1；检测同样这样。
18. **角色的思考档**：
    - 角色可以设默认档 `effort`（`off` 或档位，不写是跟随模型）与图标键 `icon`。`setRole` 按字段打补丁：省略的不改，`null` 清除（`model: null` 解除绑定，`effort: null` 跟随模型，`icon: null` 用默认图标）；只改档或图标时不带出 `model`，也不触发输出 14（压缩跟着快速档只在 `fast` 从未绑定变成绑定时）。改绑模型时已存的档位保留，请求时按新模型的档夹取，界面说明实际用哪一档。
    - 请求的档位：会话里明确选的 > 解析到的角色的默认档 > 不发（模型按自己的默认）。角色的默认档是**这一次解析的属性**（`ModelResolution.defaultEffort`），不写进按模型缓存的信息：同一个模型绑给两个角色，各用各的；会话直接选模型（不经角色）时没有角色默认档。走角色时解析也带角色 id（`ModelResolution.role`），会话快照的 `model` 带 `role` 与 `defaultEffort`：界面“用 X 的默认”回到哪个角色，按内核这次解析走的角色，不按 Profile 声明的角色自己推。夹取、`off` 的含义与各条请求怎么用见 [`harness/models.md`](../harness/models.md) 输出 12。
    - 快照里每个模型带 `thinking`（推理能力：`none`、`fixed`、`levels` 加 `off`、`unset`、`verified`），按真实的 OMP 模型算；建不出模型（目录漂移、自定义缺窗口）时按配置的 `reasoning` 退成 `fixed` 或 `none`。
    - 请求里的内容见验收 4。
17. **压缩的触发点**：全局设置 `nbook.models/compaction`（在“运行可靠性”页的“上下文压缩”组）与模型配置的 `compaction` 同一个形状 `{mode, value?}`，模型的覆盖全局。`reserve`：留预留量，`value` 是把窗口当成这个数来算，没写就是内核的缺省；`percent`：窗口的百分比（`value` 必写、1 到 100，窗口未知时不给）；`tokens`：固定的触发点（`value` 必写）。超出范围的值在设置入口就按 `invalid-value` 拒绝。解析时窗口知道了才算成 `compactAt` 交给内核：超过窗口按窗口，没有意义或不大于 0 时不给，由内核按缺省算。全局设置改了，从下一次解析起生效。快照里的 `compaction` 是模型自己的配置，旧的 `compactAt` 给成 `{mode: "tokens"}`。
19. **模板与添加**：`templates()` 列出打包目录里有对话模型的服务商（加上 Cursor、Bedrock、Azure、Vertex、Codex 这类没有可发的对话模型、但用户会找的几家）与三个空白模板；每个带分组（国际、国内、网关、其他、自定义）、图标键、地区、各协议的地址（`routes`）、打包目录里的对话模型数、密钥怎么来（不要、API Key、登录），与能否添加：要登录（`login`）、认证方式不支持（`unsupported-auth`）、传输不经 HTTP 请求（`transport`）、地址带占位要用户给（`needs-address`）的不能添加。`addProvider` 对不能添加的模板为 `template-unavailable`，没有这个模板为 `unknown-template`；空白模板必须给名称与地址，协议缺省按模板；有地区的模板给的地区必须在表里；选的协议在模板里没有地址又没给地址为 `invalid-value`。新建与复制都先清掉凭据库里最后真正用到的那个 id 的遗留密钥（写设置时这个 id 被别处占了就换下一个、清那一个），再写设置，生成新的 `uid`；新建的都是 `followSource: true`（模板服务商一开始是目录里的全部对话模型；空白模板拉到列表之前没有模型）；免认证的模板 `auth: "none"`。
20. **复制**：`duplicateProvider` 复制整份配置（id 由原 id 加 `-copy` 生成，名称加“ 2”，新 `uid`）；凭据只复制有效的那一种：`apiKeyEnv` 随配置复制，库里的密钥复制一行。配置复制成了、密钥没复制成时为 `partially-applied`，带副本 id 与副本实际的密钥状态。
21. **图标**：`setIcon` 收内置图标的键、首字母块、`null`（回到模板的图标），或上传的 PNG（base64）：编码串至多 90 000 字符，解码后至多 64 KB、边长至多 256 像素、不是动图（第一块图像数据之前没有 `acTL`），并且能解码；不合格为 `icon-rejected`，`reason` 是 `not-png`、`too-large`、`animated`、`undecodable`、`write-failed`。上传的图存成状态根 `agent/provider-icons/<内容的 SHA-256>.png`（先写暂存文件再改名），设置里只存文件名；设置没写成时、删服务商之后、换图标之后，没有任何服务商引用的文件被回收（回收失败只记诊断）。图标文件经 `GET /api/nbook.models/icons/<文件名>` 读取：文件名必须是 64 位十六进制加 `.png`，不跟符号链接，带 `nosniff` 与 `sandbox` 的安全头，跨站请求被拒。
22. **模型清单**：一家的列表 = 来源模型（开着 `followSource` 时是来源里自动加入的全部模型——对话类、走 HTTP 请求的，图片生成等不进，类型不明的按输出 25 的规则；关着时只有设置里有条目的），去掉 `excluded`，加上手加的模型。手加的条目优先：目录后来有了同 id 的模型，这一行仍是手加的（不借目录的窗口与能力，移出时删掉而不是进 `excluded`）；手加的模型没覆盖协议时用模板的缺省协议。行上的开关就是 `enabled`；“管理模型”里移出的来源模型进 `excluded`、其覆盖不保留，可以找回。`setModels` 的 `add`：来源模型取消移出（关着自动加入时补一条条目），手加的新建或整条替换；`remove`：来源模型移出，手加的删除；绑着被移出模型的角色先解除绑定（输出 15）。关掉 `followSource` 时，给此刻在列表里、还没有条目的来源模型补 `{enabled: true, frozen: true}` 的条目，列表不变；重新打开时删掉仍只有冻结标记的条目，用户改过的去掉标记保留。来源模型的条目只存与来源值不同的字段。
23. **读模型行**：`providerModels` 按系列、名称、id 的稳定顺序分页交回一家的行（一页至多 200 行、编码后至多 512 KiB，按字节截短时 `nextOffset` 接着实际交出的最后一行；`scope: "available"` 是来源里有、不在列表里的：移出的、没加过的、类型不明不自动加入的），`enabledModels` 跨服务商交回启用的行，`usable: true` 时只交可用的（启用、状态 ok、这家有可用的密钥、协议与地址都有）。响应带 `revision`、`total`、`nextOffset`；后续页带首页的 `revision`，期间这家（或这几家）的行变了为 `revision-changed`，调用方从头重读。`modelsByReference` 一次至多 50 个引用，按 `<服务商>/<模型>` 取行（含未启用的），找不到的 `row` 为 null。行的状态 `missing`（输出 9）、`incomplete`（有效上下文窗口不明）、`kind`（`chat` 或类型不明的 `unknown`）、`enabled`（没有条目、缺窗口的为假）与 `usable` 都在服务端算，`overridden` 列出用户改过、与来源值不同的字段，有这样的字段时 `source` 带这几项的来源值（编辑时恢复用），否则为 null。
24. **发出请求的身份**：解析结果按 [`harness/models.md`](../harness/models.md) 输出 21、22 建：公开引用是 `<服务商 id>/<模型 id>`；部署身份 `deployment` 由 `uid`、有效协议与有效地址算出；签名绑定凭据的协议（OpenAI 兼容的 completions 之外）另带凭据身份，是认证输入（密钥与生效的服务商、模型请求头）经安装密钥（状态根 `agent/identity.key`，0600，首次启动随机生成，内容不合格时重新生成）做的 HMAC。解析之后服务商被改了协议、地址、认证方式、密钥来源、密钥值或请求头，已解析的结果再发请求为 `endpoint-mismatch`；会话下一轮重新解析。代理设置还没有：模型请求一律直连，不读进程环境里的代理变量。
25. **模型来源**：
    - **服务商的列表**：按有效协议、地址与认证（同对话请求：OpenAI 系 `Authorization: Bearer`；Anthropic 跟随模板时 `x-api-key`、否则 `Authorization: Bearer`，带 `anthropic-version`；Gemini `x-goog-api-key`；配置的请求头盖过这些）发 `GET`：OpenAI 兼容与 OpenRouter 是 `<地址>/models`（列表在 `data`，兼容服务的 `models`、`result`、`items` 与顶层数组也认），Anthropic 是 `/v1/models`（`after_id` 翻页），Gemini 是 `/models`（`pageToken` 翻页）。不跟随重定向、直连。只有读完整才算成功：读到末页；重复游标、超过 20 页、单页超过 8 MiB、超过 5000 行、不是列表的信封（错误信封、无关对象、类型不对的分页标志）都算失败，不截断；显示名截到 200 个字符。每一页发出前核对认证仍是当前的，配置或凭据一变在途的拉取立刻停。失败的说明只有状态码，不带服务商的正文（正文可能回显认证头）。失败分 `auth`（401、403）、`not-found`（404、405）、`unreachable`、`bad-response`（其余状态、3xx、不是完整的列表）、`timeout`（30 秒）、`no-credentials`、`storage`（存不下），失败时沿用上一份。成功的空表也是权威的：成员清空。
    - **分类与自动加入**：服务商不是空白模板时先查目录里同 id 的行：有就以目录为准（是对话模型就用目录的能力与单价，不是就丢掉，列表说“能生成内容”的图片模型也不收）；目录里没有的，列表自己说了类型的照它（Gemini 的 `supportedGenerationMethods`、OpenRouter 的输出模态），仍不明的是类型不明。类型不明的模型：空白模板里自动加入，id 含 `embed`、`rerank`、`whisper`、`tts`、`moderation` 的除外；没有上下文窗口的照样列出、不启用（待补字段，不默填猜测值）；目录模板里的不自动加入，只出现在可加的模型里。列表里带的窗口、最大输出、看图（Gemini、OpenRouter 与个别兼容服务给）当来源值。
    - **缓存**：每家一份 `<状态根>/agent/model-sources/<键>.json`，键是 `uid` 的 SHA-256 前 32 位十六进制（`{version: 1, uid, deployment, credential, checkedAt, rows}`，只存列表原生的字段，目录补值在读时现算），写入先落随机名、排他创建的暂存文件再改名，排到写盘时再核对一次身份与截止，作废的结果不写盘；形状不对、`uid` 与文件名不符的按没有缓存、写一条诊断。缓存只给同一部署用：改了地址或协议，旧列表不用、成员退回目录；凭据变了（换密钥、改认证头）旧列表照用、状态标 `changed`。删服务商后、启动时回收不在配置里的缓存文件。服务商设置读不到时（文件改坏了，读到的是上一次的有效值）不回收、不出站，手动拉取为 `settings-unavailable`。
    - **在线目录**：OMP 的 stencil 目录（zstd 压缩的 models.dev 副本）。传输超过 8 MiB、解压后超过 32 MiB、解不开或不是目录的整份拒收；逐行验证，窗口与上限不是正整数、原文价目不是非负有限数的行丢掉；验证成功才把原字节与 ETag 存进 `<状态根>/agent/model-catalog.json`，下次带 ETag 条件请求，`304` 只刷新时间。它只补打包目录里没有的模型；价目看原文有没有写（写了全为 0 是免费）。
    - **何时拉**：用户点“重新拉取”（`refreshSource`）随时受理；自动更新开着时，添加服务商、设好密钥之后跟着拉一次，启动时与之后每小时看一遍，对从没拉成过、或同一部署与凭据的列表超过一天的在后台拉，在线目录超过一天也拉。与最近一次拉取（成功或失败）或读到的缓存的部署、凭据不同的不自动拉（新地址不接手旧的认证），等用户重新拉取或设密钥；凭据按真正发出的认证头算。同一部署与凭据的在途拉取合并；不同的取消旧的。结果只在这时实例的部署与凭据仍与发出时相同才提交。
    - **快照里的状态** `source`：`state`（`none` 没有这个部署的列表；`ok`；`changed` 有一份但地址、协议或凭据改过）、`refreshing`、`checkedAt`（可用的那份是什么时候拉到的）、`error`（最近一次失败，成功后清掉）。
26. **协议检测**：`detectApi` 对同一个实例试四种对话协议（OpenAI Chat Completions、OpenAI Responses、Anthropic、Google Gemini），四种并行、整次 15 秒、可取消，不写入。
    - **试哪个配置**：每种协议试的是“改用它之后的实例”：选回模板的协议即恢复跟随（混合协议的模板除外：没有覆盖时每个模型按目录各用各的协议，选哪种就钉成哪种）；地址没覆盖时用模板给这种协议的路由，模板没有这种协议的路由时用现在的地址。请求走与对话同一条构造与认证（各家的专用处理随身份走，输出 24 的身份规则照用，发送前同样核对完整地址），不带推理参数，最大输出 64。
    - **恰好一次 HTTP**：每种协议只放行一次请求；适配器要重发（OMP 对部分协议在内层重发）时不发第二次，这一行判失败。不跟随重定向、直连。
    - **通过的判据是首个生成证据**：适配器交出第一段非空的文字、思考或工具参数才算；握手、角色帧、`created`/`start` 事件、空候选不算；证据一到就中止读取与请求。证据之前的错误优先：非 2xx 读正文开头（8 KB）当原文、立即结束，不交给适配器（不留请求全文的诊断文件）；流里报错照适配器的错误给，报错之后连接挂着也不等到时限。没交增量、正常收尾且报了输出 token 的（思考不外露）也算通过，适配器的空回复重发对检测关掉。不流式、整段回 JSON 的网关对话也用不了，判失败。
    - **用哪个模型**：调用方给的（可以不在列表里），其次第一个启用的，再次来源里第一个对话模型；都没有为 `no-model`。要密钥却没有可用的密钥（或请求头引用的变量没有值，按服务商级与这个模型的请求头合好之后、与发请求同一份算）为 `no-credentials`，不发请求。
    - **结果**：`{model, connection, results}`，`connection` 是检测时快照里的连接版本；每种协议一行 `{api, baseUrl, connection, url, ok, status, ms, code, message}`：`baseUrl` 是试的地址、`url` 是实际请求的地址（都不带用户信息与查询串，请求本身照用完整的），`connection` 是改用这种协议之后的连接版本，`code` 是失败的码（`http`、`network`、`timeout`、`no-content`、`cancelled`，请求发出前的 `missing-key`、`endpoint-mismatch`、`unknown-model`、`transport-unsupported`、`no-address`，或适配器的错误码），`message` 是遮盖过、截到 8 KB 的服务商原文（密钥的原样与 JSON 转义形式都遮盖，先去控制字符再遮盖，截在密钥中间时那半个也去掉）。参数被拒的 4xx 原文照给，不归成“协议不支持”。
    - **连接版本**（快照的 `connection`）：实例的 `uid`、模板与地区、有效协议与地址、认证方式、密钥来源、是否跟随模板与认证输入（密钥与服务商级请求头，以及引用了却没有值的环境变量）变了就变；不含模型级请求头（协议是服务商级的选择），认证输入经安装密钥 HMAC，浏览器推不出密钥。
    - **采纳**：`adoptApi` 在串行队列里、对着从设置层读到的值算“改用 `api` 之后的实例”，它的连接版本必须等于交来的 `connection`（那一行的），否则为 `connection-changed`、不写；设置冲突重读时重新核对，不把结论套到别人改过的配置上。写进去的总是检测试过的那份。

## 状态与转换

- 入口激活：打开凭据库 → 读设置与目录 → 读来源缓存与在线目录的副本、回收孤立的缓存文件（输出 25）→ 建快照 → 提供 `modelsKey` 与远程合同；自动更新开着时随后在后台拉过期的，不等。打开失败时入口激活失败，`modelsKey` 不可用，调用方按依赖缺失处理。
- 时序与寿命：
  - `resolve` 同步，用的是最近一次重算的快照；本进程的写在写入方法返回之前已反映进快照。
  - 解析时有密钥、请求前密钥被清掉：请求以 `auth`、`missing-key` 失败（模型请求已开始，按普通模型失败收口）。
  - 拉取在途时改了这家的地址、协议或凭据，或删了这家：迟到的结果不提交、不写盘。
  - 协议检测在途时调用方取消（远程调用的中止）：四种协议的请求一起中止，结果为取消。检测之后配置或凭据变了：结果仍会交回，采纳时为 `connection-changed`。
  - 入口停止：先让在途的拉取全部作废并取消（读到一半的响应体也停），至多等 2 秒收尾；再等串行队列走完已接纳的写入，关闭凭据库；之后 `modelsKey` 不可用，远程调用得 `unavailable`。

## 副作用与数据

- 设置文件（用户层）的两个键；凭据库文件；上传的服务商图标 `agent/provider-icons/*.png`（没有服务商引用时回收）；安装密钥 `agent/identity.key`（0600，换了它旧回复的签名不再送回）；列表缓存 `agent/model-sources/*.json` 与在线目录副本 `agent/model-catalog.json`（输出 25，0600，删了只是下次重新拉）。都在状态根下，不随作品走。
- 诊断：写入（不记值）、来源漂移、权限做不到、图标写入与回收失败、列表与在线目录的拉取、拒收与读写失败（不记密钥与请求头）。
- 外联：服务商的列表请求、检测与协议检测（每种协议一次）发往用户配置的地址或模板的路由；在线目录取自 `catalog.stencil.so`（只在自动更新开着、或启动环境改了地址时；不带用户数据）。

## 失败与恢复

| 码 | 含义 | 调用方怎么办 |
|---|---|---|
| `no-credentials` | 这家没有可用的密钥 | 去设置里填密钥或设环境变量 |
| `unknown-model` | 模型不在、没启用或缺上下文窗口 | 去设置里选别的模型或补字段 |
| 列表状态的 `error.reason`（`auth`、`not-found`、`unreachable`、`bad-response`、`timeout`、`no-credentials`、`storage`） | 拉服务商的列表没成（输出 25），沿用上一份 | 按原因改密钥、地址，或稍后重新拉取 |
| `role-unbound` | 要的角色没有绑定模型 | 去“模型角色”绑定 |
| `write-conflict` | 重试 3 次仍有别处同时在写 | 稍后重试 |
| `settings-unavailable` | 设置文件有错或写不进去 | 先修好设置文件 |
| `credentials-unavailable` | 凭据库读写失败 | 看诊断 |
| `partially-applied` | `setKey` 或复制服务商两步只成了一步 | 按返回的实际状态再操作 |
| `model-incomplete` | 启用的模型有效上下文窗口不明 | 补字段后再启用 |
| `unknown-template` | 没有这个模板 | 重新读模板表 |
| `template-unavailable` | 模板不能添加（要登录、传输或认证不支持、地址带占位） | 换模板，或用空白模板填地址 |
| `icon-rejected` | 上传的图标不合格，`reason` 写原因 | 换一张图 |
| `revision-changed` | 分页读到一半，这家的模型行变了 | 从第一页重读 |
| `endpoint-mismatch` | 请求地址与配置不符，或解析之后服务商被改过 | 不重发；下一轮重新解析 |
| `no-model` | 协议检测没有能用的模型 | 给一个模型 id 再检测 |
| `connection-changed` | 协议检测之后地址或凭据变过，采纳不写 | 重新检测 |

## 边界与兼容

- 公开接口：`modelsKey`（`shared/contracts.ts`）、远程合同 `nbook.models/settings`、两个设置项的形状。
- 降级：角色设置写了 `effort` 或 `icon` 之后再装回这之前的版本，旧版本按它的 schema 把整个“模型角色”设置项当成无效丢弃（读到的是缺省：四档加压缩都未绑定），主力等绑定看起来没了；没写过这两个字段的设置不受影响。服务商设置第一次写成 v2 之后再装回旧版本，旧版本同样把整个服务商设置项当成无效丢弃（读到的是空表，密钥仍在凭据库里）。不为降级做保护，应用的发布说明“数据与升级”写明。
- 升级：v1 设置照“输入与前置条件”的读法归一，行为不变；目录条目上被 v1 运行时忽略的字段首次写入后不再保留；v1 里已存的 Bedrock、Cursor、Codex 这类不经 HTTP 请求的模型保留条目，标 `unsupported`、不能发送。OpenRouter 照旧按启动环境的 `PI_OPENROUTER_RESPONSES` 选 Chat Completions 或 Responses。升级到合同 v4 的版本后第一次启动，自动更新开着时给有密钥的服务商各拉一次列表，列表里没有的旧条目标 `missing`。应用的最低 Bun 版本是 1.4.4，CLI 与服务入口都在启动时核对；设了环境代理的用户，模型请求改为直连。
- 依赖 `@notnotype/nb-harness/models`（目录、凭据库、按配置建出解析结果）。OMP 升级时目录与能力随之变。
- 信任边界：浏览器只拿到“有没有密钥”；设置文件里只有变量名，不放密钥。请求头的值写在设置文件里，界面在名称像凭据时提示改用 `env:`。

## 验收与 Smoke

1. 空白模板的服务商（本机假的 OpenAI 兼容端点）：添加、设密钥后自动拉到列表（模型缺上下文窗口、不启用）、重新拉取、补上下文窗口、启用、绑定 `main`、Agent 一轮对话走到这个端点；删除服务商后 `main` 为 `role-unbound`。
2. 两个窗口经真实 RPC 同时改两个不同的服务商，两处改动都在；设置文件视图在服务端合并期间写入，内容不丢。
3. `setKey` 的 `env:` 与原文互换；启动环境里有、`process.env` 里后来才有的变量不算。
4. 角色的思考档（输出 18）：本机假端点实收的请求体里，可真关闭的模型选“关闭”发关闭开关，只能降档的模型发最低档，强制思考的模型不选也发最低档，不推理与不能调档的模型不发推理字段；主力设了默认档、会话没选时请求用它，会话选了就用会话的、选“跟随”回到角色的；同一个模型绑给两个角色各用各的。
5. 模板与身份（输出 19 到 24）：同一模板添加两份，各有自己的 `uid`、公开引用与图标；v1 设置文件经真实设置场地读进来行为不变、第一次写入整份换成 v2；环境变量改写地址（含只改路径）时请求不发出；同名删了重建或同址换凭据之后，经会话关闭重开的回放不送回旧签名。
6. 模型来源（输出 25）：本机假端点按四种协议的真实形状回列表，实收的地址与认证头对；分页中途失败不交回半份；改地址后不自动去新地址拉、改认证头后照用旧列表；拉取在途时换了认证，迟到的结果不提交；重启后读缓存不出站；本机端点回 zstd 的在线目录，打包里没有的模型出现在跟随模板的服务商里，过期后带 ETag 重取。
7. 协议检测（输出 26）：本机假端点只会说 OpenAI Chat Completions，其余路径回 404：四种协议各实收恰好一次、只有 Chat Completions 通过；采纳 Responses 后快照的连接版本等于那一行的，同一次检测的别的行照样能采纳；改了地址或换了密钥之后采纳为 `connection-changed`；目录模板选回模板的协议后连接版本回到原值；混合协议的模板（OpenCode Zen）四行各发自己协议的路径，采纳模板的缺省协议后普通检测也发它。四种协议的假端点（握手后挂起、流里报错及报错后挂起、只报输出 token、500、400 回显密钥及密钥跨在 8 KB 上）上，证据到了就关连接，只有握手的到时限判超时，失败不重发、原文里没有密钥。

Smoke：`packages/neuro-book/src/plugins/models/` 的插件测试与 `e2e/models.e2e.ts`。

## 实现合同

- **公开入口**：`nbook/plugins/models/shared/contracts`（服务键 `modelsKey`、远程合同 `modelsSettingsContract`，转出别的插件在用的快照形状与 `hasCredentials`、`roleReference`、`roleOfReference`）、`nbook/plugins/models/shared/settings`（设置项 `nbook.models.providers`、`nbook.models.roles` 的登记）；`@notnotype/nb-models`：`./config`（配置形状、内置角色 `BUILTIN_ROLES` 与 `MODEL_ROLE_IDS`、引用与服务商 id 的规则、压缩触发点）、`./contract`（快照与结果形状、远程合同的定义 `modelsSettingsSpec` 与 `ModelsSettingsContract`、`ModelsService`）、`./core`（`createModelsCore`、选择顺序 `chooseModel`、配置存储接口 `ModelsConfigStore`、模板表 `listTemplates`、图标校验 `checkPng` 与存储接口 `IconStore`、来源文件的存储接口 `SourceStore` 与键 `sourceKeyOf`）；`@notnotype/nb-harness/models`（目录与目录视图 `createCatalogView`、在线目录 `fetchOnlineCatalog`/`parseOnlineCatalog`、列表请求 `listModels`、凭据库 `openCredentials`、`env:` 的读法、`buildResolution`、协议检测 `probeProtocol`）与 `@notnotype/nb-harness/process-guard`（`takeOverOmpProcessHandlers`）。
- **owner 与依赖方向**：配置形状、规则、选择顺序、合同定义与服务核心（快照、串行写入、检测与发现）在 nb-models，与应用无关；id、设置项与远程合同实例在 `nbook.models`（[ADR 0045](../../adr/0045-shared-host-packages-for-second-app.md)）。`nbook.models` 的服务端入口打开凭据库、把设置服务适配成 `ModelsConfigStore`（`backend/settings-store.ts`）、建核心并交出服务键与远程合同；浏览器入口只是远程合同的调用方（设置页见 [`models.settings-pages`](settings-pages.md)）。它依赖 `nbook.settings`（配置服务）、nb-models 与 `nb-harness/models`；`nb-harness/models` 只引用内核公开入口与允许的几个 OMP 包。Agent 内核经模型端口取解析结果，不直接读设置。OMP 不打进 bundle、服务端入口先于它接管进程级处理（[ADR 0036](../../adr/0036-app-package-installs-omp.md)）。
- **关键不变量**：
  - 配置只经服务端写，每次写是对一个设置项的读改写；设置文件被别处改过时重读再合并，两个窗口同时改不同服务商两处都在（输出 5、6，`models.test.ts`“配置的校验与写入”，nb-models `core/core.test.ts`）。核心依赖的存储语义写在 `ModelsConfigStore` 的接口注释里，由 nb-models 的合同测试对内存实现与应用的适配器（`settings-store.test.ts`，真实设置场地）各跑一遍。
  - 密钥只在凭据库或启动环境里：`env:` 存成变量名、只认启动时拍下的环境，原文写库；任何响应、事件与诊断里都没有密钥（输出 1、2、12、13，`models.test.ts`“密钥”）。
  - 目录模型在设置里只存用户改过的字段，快照照样合出目录的值；目录里没有了的模型标 missing、绑着它的角色为 unknown-model（输出 9，`models.test.ts`“目录模型只存用户改过的”“目录漂移”）。
  - 删除模型或服务商之后没有角色指向它（输出 15，`models.test.ts`“配置的校验与写入”）。
  - 设置里的服务商新旧形状都接受，读的时候归一（`config/normalize.ts`），第一次写入整份写成 v2；`expect` 用磁盘原值（nb-models `providers.test.ts`“v1 设置的读法”，`models.test.ts`“v1 设置文件与图标路由”）。
  - 模型清单由来源（服务商的列表或目录）与设置里的覆盖现算（`core/members.ts`），设置里不存来源的副本（`providers.test.ts`“自动加入、冻结与移出”）。
  - 来源的拉取、缓存与提交在 `core/sources.ts`：每个 `uid` 一个代次，结果只在身份仍是当前的时提交，每页发出前与写盘前都核对；停止时作废、取消、限时收尾（输出 25，nb-models `sources.test.ts`）。
  - 请求发出前在最内层核对完整地址，解析之后服务商被改过的结果不能再发（nb-harness `tests/models.test.ts`、`kernel/model/omp.test.ts`）。
  - 协议检测每种协议恰好一次 HTTP：`probeProtocol`（nb-harness `models/probe.ts`）经 `ResolveHooks.send` 接管地址核对之后的最内层发送，第二次发送不发；非 2xx 在这里读完正文、不交给适配器；2xx 的正文只有适配器一个读者，经过时留下开头。采纳与检测用同一个“改用之后的实例”（`core.ts` 的 `withApi`），在写队列里按连接版本核对（输出 26，nb-harness `tests/probe.test.ts`，`models.test.ts`“协议检测”）。
  - 加载 OMP 之前接管它挂在 `process` 上的处理，服务端停止结算后再跑它登记的清理，每个退出出口都等这次清理（`nb-harness` 的 `process-guard.test.ts`，`server.test.ts` 的停止与退出码）。

## 证据

- 批准依据：w00032 t09 决定 1 到 32（[Task README](../../../.agents/works/w00032-agent-integration/tasks/t09-models/README.md)）、[模型角色合同](../../proposals/model-roles-contract.md)；开发者 2026-11-01 批准晋升为 `implemented`；配置形状、合同定义与核心抽进 nb-models 依据 [ADR 0045](../../adr/0045-shared-host-packages-for-second-app.md)（开发者 2026-11-10 同意）。解析失败带 `role`、`provider`：[w00032 t36 计划](../../../.agents/works/w00032-agent-integration/tasks/t36-conversation-panel-redesign/plan.md)的“模型不可用的提示卡”，开发者 2026-11-16 确认（t36 决定 1、9）。服务商是模板的实例、身份与发送前核对、合同 v3、图标：[w00032 t43](../../../.agents/works/w00032-agent-integration/tasks/t43-models-ux/README.md) 决定 1、2、4、13、20、23、25 至 29 与[计划](../../../.agents/works/w00032-agent-integration/tasks/t43-models-ux/plan.md)的段 B1；模型来源（输出 25）、合同 v4：同一 Task 决定 26、27 与计划的段 B2a；协议检测（输出 26）、合同 v5、去掉服务端批量检测：同一 Task 决定 7、13、25、26 与计划的段 B2b；取舍见 [ADR 0057](../../adr/0057-models-ux-sources-identity-egress.md) 与 [ADR 0058](../../adr/0058-models-wire-identity-full-url-and-uid.md)。
- 实现入口：[`backend/plugin.ts`](../../../packages/neuro-book/src/plugins/models/backend/plugin.ts)、[`backend/settings-store.ts`](../../../packages/neuro-book/src/plugins/models/backend/settings-store.ts)、[`shared/contracts.ts`](../../../packages/neuro-book/src/plugins/models/shared/contracts.ts)、nb-models [`core/core.ts`](../../../packages/nb-models/src/core/core.ts)、[`core/choice.ts`](../../../packages/nb-models/src/core/choice.ts)、[`core/store.ts`](../../../packages/nb-models/src/core/store.ts)、[`core/templates.ts`](../../../packages/nb-models/src/core/templates.ts)、[`core/members.ts`](../../../packages/nb-models/src/core/members.ts)、[`core/sources.ts`](../../../packages/nb-models/src/core/sources.ts)、[`backend/source-store.ts`](../../../packages/neuro-book/src/plugins/models/backend/source-store.ts)、[`config/normalize.ts`](../../../packages/nb-models/src/config/normalize.ts)、[`backend/icons.ts`](../../../packages/neuro-book/src/plugins/models/backend/icons.ts)、[`backend/secret.ts`](../../../packages/neuro-book/src/plugins/models/backend/secret.ts)、[`nb-harness/src/models/`](../../../packages/nb-harness/src/models/index.ts)（协议检测在 [`probe.ts`](../../../packages/nb-harness/src/models/probe.ts)）、[`server/omp-process.ts`](../../../packages/neuro-book/src/server/omp-process.ts)
- 合同测试：[`models.test.ts`](../../../packages/neuro-book/src/plugins/models/models.test.ts)（真实设置场地、真实凭据库、真实远程合同与本机的 OpenAI 兼容端点）、[`settings-store.test.ts`](../../../packages/neuro-book/src/plugins/models/backend/settings-store.test.ts)、nb-models [`core.test.ts`](../../../packages/nb-models/src/core/core.test.ts)、[`providers.test.ts`](../../../packages/nb-models/src/core/providers.test.ts)（模板、添加与复制、v1 读法、冻结与移出、分页、图标、身份）、[`backend/icons.test.ts`](../../../packages/neuro-book/src/plugins/models/backend/icons.test.ts)、[`choice.test.ts`](../../../packages/nb-models/src/core/choice.test.ts)、[`memory-store.test.ts`](../../../packages/nb-models/src/testing/memory-store.test.ts)、[`roles.test.ts`](../../../packages/nb-models/src/config/roles.test.ts)、[`compaction.test.ts`](../../../packages/nb-models/src/config/compaction.test.ts)、[`nb-harness/tests/models.test.ts`](../../../packages/nb-harness/tests/models.test.ts)、模型来源（输出 25）：nb-models [`sources.test.ts`](../../../packages/nb-models/src/core/sources.test.ts)、nb-harness [`listing.test.ts`](../../../packages/nb-harness/tests/listing.test.ts)、[`online-catalog.test.ts`](../../../packages/nb-harness/tests/online-catalog.test.ts)、[`backend/source-store.test.ts`](../../../packages/neuro-book/src/plugins/models/backend/source-store.test.ts)、[`boundary.test.ts`](../../../packages/nb-harness/src/models/boundary.test.ts)、协议检测（输出 26）：nb-harness [`probe.test.ts`](../../../packages/nb-harness/tests/probe.test.ts)（四种协议的本机假端点）、[`process-guard.test.ts`](../../../packages/nb-harness/tests/process-guard.test.ts)；真实模型：[`models.llm.test.ts`](../../../packages/neuro-book/src/plugins/models/models.llm.test.ts)（`test:llm`）；解析失败带 `role`、`provider`（输出 8）：[`models.test.ts`](../../../packages/neuro-book/src/plugins/models/models.test.ts)、[`core.test.ts`](../../../packages/nb-models/src/core/core.test.ts)；快照原样带上：[`session.test.ts`](../../../packages/nb-harness/src/kernel/session/session.test.ts)
- Smoke：[`models.e2e.ts`](../../../packages/neuro-book/e2e/models.e2e.ts)（验收 1 的界面部分：设密钥后拉到列表、重新拉取、类型不明的加入，删除后角色未绑定；验收 5：协议检测每种协议恰好一次请求）
