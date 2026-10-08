---
schema: nbook.spec/v1
kind: behavior
status: planned
capability: settings.configuration
owners:
  - nbook.settings
---

# 配置

## 目标与非目标

内置插件 `nbook.settings` 让插件声明**配置项**（用户主动设定的偏好，例如界面语言、主题），按声明里的默认值、用户层、项目层合成每一项的有效值，并推到每个内核实例。所有已声明的项都可读；写入只限声明它的插件；用户直接改 JSON 文件即时生效。

不承诺：

- 通用设置界面、用户编辑的写入路径与密钥存储：本 Spec 只定它们的合同（“用户编辑”“密钥”两节，planned 子条目），随设置界面与第一个密钥使用者实现。
- 内存层、策略层、语言或资源级覆盖（VS Code 的 `[markdown]`）、多套用户配置（VS Code 的 Profile）、层间对象深合并：每个键整体覆盖。
- 启动配置：端口、状态根等由宿主的环境变量决定（[`runtime.server-host`](../runtime/server-host.md)），不经本插件。
- 跨设备同步。
- 第三方插件的读写写法：`get` 是同步的，同步服务只限内置插件（[`runtime.plugin-api`](../runtime/plugin-api.md)）。
- 与不走本插件写入锁的外部编辑器之间的写入互斥：只缩小竞态窗口（输出 13）。
- 已知限制：网络文件系统与部分容器挂载上收不到文件事件时，外部修改到下一次写入或重启才生效；Windows、macOS 未实测。

## 术语与参与者

- **配置项**：一条声明，键为 `<插件 id>/<名>`，与服务 id、公开键同一命名规则（[术语表](../runtime/glossary.md)）。
- **声明者**：声明配置项的插件。只有它能写这一项。
- **层**：`default`（声明里的默认值）、`user`（`<状态根>/settings.json`）、`project`（`<项目目录>/.nbook/settings.json`）。越具体越优先：项目层 > 用户层 > 默认值。
- **层拥有者**：user 层归服务端实例的 `nbook.settings` 入口，project 层归该项目当前项目实例的 `nbook.settings` 入口（与 [Storage](../storage/persistence.md) 的分区归属一致）。拥有者读写文件、校验、发布层快照。
- **层快照**：拥有者对一层的当前看法：状态、有效的键值、被丢弃的键、修订号。
- **有效值**：一个实例里，按本实例可用的层合成的值。
- **参与者**：声明者；`nbook.settings`（拥有贡献点 `settings.properties`，在服务端、项目、浏览器三种位置各有入口，提供 `settingsKey`）；读取方（任何插件）；用户（改文件，或以后经设置界面）。

## 输入与前置条件

### 声明

配置项写在声明者插件的**描述**里，作为顶层声明式贡献，贡献点 `settings.properties`，每个实例都登记（[`runtime.plugin-manifest`](../runtime/plugin-manifest.md)）：

```ts
// plugins/workbench/shared/contracts.ts
export const themeSetting = defineSetting({
    plugin: "nbook.workbench", name: "theme",
    schema: Type.Union([Type.Literal("nbook"), Type.Literal("macos")]),
    default: "nbook",
    title: {"zh-CN": "主题", "en-US": "Theme"},
});
// plugins/workbench/plugin.ts：描述 contributions 里放 themeSetting.contribution
```

| 字段 | 规则 |
|---|---|
| `plugin` + `name` | 键 `<插件 id>/<名>`；插件 id 是贡献方插件；名是以点分段的小驼峰（`appearance`、`editor.fontSize`），至多 128 个字符 |
| `schema` | 可 JSON 序列化的 TypeBox schema |
| `default` | JSON 能如实表示的值（规则同 [远程服务与 RPC 协议](../runtime/plugin-channel.md) 的帧编码：没有 `undefined`、非有限数、类实例、函数、循环），且符合 `schema` |
| `layers` | `["user"]`、`["project"]` 或两者，缺省两者 |
| `title` | 中英两份；`description` 可选，同样中英两份 |
| `restart` | 布尔，缺省 `false`：改后是否要重启才完全生效 |
| `secret` | 本期声明 `true` 被拒（密钥存储尚未实现） |

- 插件把对外的配置定义写在自己的 `shared/contracts.ts`，描述与读取方引用同一常量。
- **作者规则**：会执行程序、指定网络地址或凭据、改变数据位置的配置项必须只允许用户层：项目层文件可能来自别人的仓库。
- `restart: true` 不改变读取：服务照常给出最新的值，消费者自己决定只在启动时采用；界面据此提示“重启后生效”。

### 接口

插件在入口的 `dependencies` 里声明 `settingsKey`（`nbook.settings` 的 `shared/contracts.ts`），解析得到按调用方生成的服务对象：

```ts
interface SettingsService {
    get<T>(setting: SettingDefinition<T>): DeepReadonly<T>;
    inspect<T>(setting: SettingDefinition<T>): SettingInspection<T>;
    onDidChange(listener: (keys: ReadonlySet<string>) => void): () => void;
    update<T>(setting: SettingDefinition<T>, value: T | undefined, options?: {layer?: "user" | "project" | "auto"}): Promise<SettingWriteResult>;
}
interface SettingInspection<T> {
    value: DeepReadonly<T>;
    source: "default" | "user" | "project";
    default: DeepReadonly<T>;
    user: LayerInspection<T>;      // 本实例没有这一层时为 {status: "absent"}
    project: LayerInspection<T>;
}
type LayerInspection<T> =
    | {status: "ok"; value?: DeepReadonly<T>}             // value 缺省：这层没有这个键
    | {status: "invalid"; detail: string; value?: DeepReadonly<T>}  // value 是上一份有效内容里的
    | {status: "unavailable"}
    | {status: "absent"};
type SettingWriteResult = {ok: true} | {ok: false; code: SettingsFailure; detail: string};
```

### 各位置可用的层

| 实例 | 层 |
|---|---|
| 服务端 | default、user |
| 项目实例 | default、user（订阅服务端）、project（本地） |
| 绑定项目的窗口 | default、user（服务端）、project（项目实例） |
| 未绑定项目的窗口 | default、user |

服务端不绑定项目；以后服务端按项目工作的功能显式选定项目、在该项目的实例里读，服务端不持有“当前项目”的配置。

### 文件

- 格式：JSON 对象，允许注释与尾随逗号，可带 UTF-8 BOM；文件里平铺写全键：`{"nbook.workbench/theme": "macos"}`。
- 文件不存在、空文件、只有注释：空层。读配置不创建文件或目录。
- 项目层文件可以进 Git（与 `.vscode/settings.json` 相同）。

## 输出与可观察行为

1. **登记期校验**：声明的键前缀不是贡献方插件 id、名不合规则、`schema` 不能 JSON 序列化、`default` 不是 JSON 能如实表示的值或不符合 schema、`layers` 为空或含未知层、`title` 缺语言、`secret: true`，各使这一条声明以 `invalid-declaration` 被拒，原因可查；同一插件的其它贡献照常。
2. **同键**：两条声明用同一个键时两条都被拒，与登记顺序无关。
3. **每个实例都知道全部声明**：声明在描述里，服务端、项目实例与窗口都登记全部插件的声明，不论声明者在本位置有没有入口、入口是否已激活。
4. **层的校验**：拥有者逐键校验文件内容：已声明、符合 schema、本层允许的键进入层快照；不符合 schema 或本层不允许的键被丢弃，记一条诊断（键与原因，不含值），同一份文件内容只记一次；没有声明的键（插件未装或已停用）留在文件里、不进层快照、不报错。
5. **层无效**：文件无法解析、根不是对象、同一键出现多次（任意深度）时，层为 `invalid`：层快照保留上一份有效内容（启动时即无效则为空），写入为 `layer-invalid`，文件不被改动；文件修好后层恢复为 `ok`。
6. **合成**：每个键取本实例可用、且声明允许的层里最具体的值，没有则取默认值；对象值整体覆盖，不合并。
7. **读取**：`get` 同步、不失败，返回深冻结的值；在 `@vue/reactivity` 的 computed 或 effect 里读时，值变化后重新求值。`inspect` 同样是响应式的，层状态变化（变为 `invalid`、恢复、`unavailable`）时重新求值。读取方改不动读到的值，也影响不到别的读取方。
8. **变化通知**：`onDidChange` 在本实例的有效值变化时调用一次，给出变化的键；同一次层更新只调用一次；层状态变化而有效值不变时不调用。
9. **外部修改即时生效**：用户在编辑器里保存文件（原地覆写、写临时文件再改名替换、先截断再写入）、删除文件、删除并重建 `.nbook` 目录、文件所在目录起初不存在后被创建、`settings.json` 是符号链接且链接改指或目标被替换，拥有者都会在最后一次文件事件之后约 50 毫秒重读，变化推到所有订阅这一层的实例。
10. **层快照的发布**：层的状态、有效键值、被丢弃的键、无效原因任一变化就发布新快照；都没变（例如只改了注释或格式）不发布。拥有者自己写入后，文件事件带回的同一内容不再发布。
11. **写入授权**：`update` 只写调用方插件自己声明的项（调用方取内核填写的身份，经代理时也是原插件）。依次核对：已声明（否则 `undeclared`）、调用方是声明者（`denied`）、值是 JSON 能如实表示的值且符合 schema（`invalid-value`）、目标层允许（`layer-not-allowed`）、目标层在本实例可用（`no-project`）。`value` 为 `undefined` 表示删除这一层里的这个键；删除不存在的键成功、无副作用。
12. **目标层**：`layer` 缺省为 `"auto"`：本实例的项目层有这个键就写项目层，否则写用户层；只允许用户层的项总写用户层。写入用户层而项目层覆盖了这一键时，写入成功、层值更新、有效值不变。
13. **写入文件**：拥有者只改这一个键，其余内容按原文保留（注释、其它键、未声明的键、BOM、换行风格、缩进风格）；替换已有键的值不动其它文本；新增键按原文的缩进追加；删除独占几行的键只删去那几行（连同它的行尾注释），其余行不动，与别的内容同在一行的键删除后这一行可能被重排。写入先写同目录的临时文件再改名替换；改名前文件被别人改过时从新内容重做；编辑后的文本重新校验通过才落盘。两个拥有者（两个服务端打开同一项目）经文件旁的写入锁串行，各改的键都保留；不走锁的外部编辑器只靠改名前的核对缩小窗口。
14. **符号链接与权限**：`settings.json` 是符号链接时写入替换链接的最终目标，链接保持不变；链接悬空时读为空层、写入为 `write-failed`，链接不动。文件存在但当前用户不可写（只读位）时写入为 `write-failed`，文件与层快照不变。
15. **读到自己的写入**：`update` 成功返回时，本实例已应用这次写入后的层快照（并发写入时，可能已是别人更晚的值）；其它实例经订阅收到。
16. **就绪**：`nbook.settings` 入口激活时等本实例各层的第一份快照，每层至多 3 秒。依赖 `settingsKey` 的入口拿到服务时，已到的层是文件里的值。超时的层为 `unavailable`、按默认值继续并记诊断，快照晚到时照常应用并通知变化。
17. **层不可达与恢复**：订阅一层失败或订阅被结束时，该层为 `unavailable`，按其它层与默认值合成并记诊断。窗口在连接回到在线时重新订阅因连接问题失败的层；同一服务端进程、同一项目代次内断线重连，已建立的订阅由内核重建并先收到当时的快照（[远程服务与 RPC 协议](../runtime/plugin-channel.md) 输出 7）。服务端已换进程、项目代次已结束时窗口整体失效（[`runtime.browser-host`](../runtime/browser-host.md)），不重试。
18. **审计**：拥有者每次写入记一条诊断：键、层、调用方插件与 `via`、结果码，不记值；外部修改记变化的键。

### 用户编辑（planned）

19. 拥有者的远程服务另有用户编辑方法：写任何已声明项的允许层，只接受内核填写的调用方是 `nbook.settings` 自己且没有经过代理的请求；按 schema 与层校验，记审计。设置界面是 `nbook.settings` 自己的入口，经这条路径写入。直接改文件也是用户编辑。

### 密钥（planned）

20. 声明 `secret: true` 的项只在服务端有值：任何接口不把值发往客户端，客户端只能看到“已设置/未设置”、只能写入或清除；无法解密时读取为 `secret-unreadable`；审计不记值。存储方式随第一个使用者定，不用明文加打码。

## 状态与转换

一层（拥有者看到的）：

| 当前 | 事件 | 结果 |
|---|---|---|
| 任意 | 文件不存在、空、只有注释 | `ok`，没有键 |
| 任意 | 文件可解析、根是对象、没有重复键 | `ok`，按输出 4 取键 |
| `ok` | 文件无法解析、根不是对象、有重复键 | `invalid`，保留上一份有效内容 |
| `invalid` | 写入 | `layer-invalid`，不变 |
| `invalid` | 文件修好 | `ok` |

一个实例里的一层：`等待首个快照` →（收到）`ok`/`invalid`；→（超时、订阅失败）`unavailable` →（晚到的快照、重新订阅成功）`ok`/`invalid`。

**并发**：同一拥有者对同一文件的重读与写入按到达顺序串行；两个窗口同时写同一键，后处理的胜出，两边最终一致；写不同键互不覆盖。

**时序与寿命**（调用方可以依赖）：

- 服务对象随调用方入口的这一代释放；释放后 `get` 返回最后的值，`update` 为 `unavailable`，`onDidChange` 不再调用。
- 写入结果与订阅推送可能乱序到达：本实例只应用同一拥有者启动标识下修订号更大的快照，不会倒退。
- 写请求发出后断线、超时或取消为 `unknown-outcome`：不自动重发，以随后的层快照为准。
- 拥有者停止时拒绝新的读写，已接纳的写入走完并结算，关闭文件监视，删除自己的临时文件与写入锁。

## 副作用与数据

- **落点**：user 层 `<状态根>/settings.json`；project 层 `<项目目录>/.nbook/settings.json`。写入时目录不存在则创建。
- **临时文件与锁**：写入期间目标文件旁有临时文件与锁目录 `<目标>.lock`，只在读到改名之间存在。持有者定期刷新锁目录的修改时间，10 秒没有刷新视为残留、可被接管；约 3 秒等不到锁为 `write-failed`。
- **格式兼容**：文件是用户可编辑的数据，没有格式版本；键名与值的含义由声明者负责兼容。

## 失败与恢复

| 失败码 | 含义 | 调用方怎么办 |
|---|---|---|
| `denied` | 调用方不是这一项的声明者 | — |
| `undeclared` | 键没有被接受的声明 | 检查声明 |
| `invalid-value` | 值不符合 schema 或不是 JSON 能如实表示的值 | 修正值 |
| `layer-not-allowed` | 声明不允许写这一层 | 换层 |
| `no-project` | 本实例没有项目层（服务端、未绑定项目的窗口） | 在项目里写，或写用户层 |
| `layer-invalid` | 文件当前无效 | 让用户修好文件 |
| `write-failed` | 没有写入：写盘出错、只读、链接悬空、写入锁等不到、改名前冲突重试用尽、编辑后校验不过；`detail` 区分 | 报告给用户；不报已保存 |
| `unavailable` | 层的拥有者不可达或服务对象已释放 | 等恢复 |
| `unknown-outcome` | 写请求发出后中断，可能已写入 | 等层快照 |

一层出错只影响这一层；读取永不失败，出错的层按默认值与其它层合成。

## 边界与兼容

- **owner**：`nbook.settings` 拥有配置文件、层快照、贡献点 `settings.properties` 与三端入口；内核提供顶层声明式贡献的登记、按调用方门面与跨实例委托。
- **公开接口**：`defineSetting`、`SettingDefinition`、`SettingsService` 与失败码（`nbook/shared/settings`）；`settingsKey`。远程服务 `nbook.settings/user`、`nbook.settings/project` 是本插件实例之间的协议，别的插件直接调用也只能写自己声明的项。
- **信任**：项目层可能来自别人的仓库，靠作者规则（只允许用户层）挡住能改本机行为的项；命名空间与声明者核对防误用，不防恶意的受信代码（[ADR 0022](../../adr/0022-extensible-platform-and-plugin-trust.md)）。

## 验收与 Smoke

1. **合成与位置**：用户层主题 `macos`、项目层主题 `nbook`：服务端与未绑定窗口读到 `macos`，项目实例与绑定窗口读到 `nbook`；项目层里的界面语言被丢弃并记诊断；`inspect` 给出来源层与各层的值。
2. **跨实例写入**：窗口里的工作台写主题，另一个窗口与项目实例即时收到；`update` 返回时本窗口已是新值；别的插件写工作台的主题为 `denied`。
3. **外部修改**：用编辑器的三种保存方式改用户层文件，所有窗口即时变化；文件改坏时各实例的 `inspect` 变为 `invalid` 且值不变、写入为 `layer-invalid`，改回同样的值后恢复 `ok`；删除并重建 `.nbook` 后再改仍生效；链接改指另一个目标后改新目标仍生效。
4. **文件保留**：带注释、BOM、CRLF、制表符缩进与未声明键的文件，经窗口写一个键后其余内容不变。
5. **两个写入者**：两个服务端进程打开同一项目，各写一个不同的键，两键都在文件里。
6. **就绪与恢复**：服务端在窗口订阅前断开，窗口按默认值启动；连接恢复后收到文件里的值。
7. **只读与链接**：只读文件、悬空链接写入为 `write-failed`，文件与链接不变。

Smoke：`smoke:server` 经打包产物在带注释的 `settings.json` 上以客户端身份写一个键，注释保留；文件损坏时服务端照常启动并记诊断。`e2e/settings.e2e.ts` 在本机 Chrome 覆盖场景 2、3 与界面语言、主题的显示。

## 证据

- 批准依据：[插件的数据与状态](../../proposals/plugin-data-model.md) 第 6、7、8 节、[多实例运行时拓扑](../../proposals/multi-instance-runtime-topology.md) 第 6、11 节、[ADR 0024](../../adr/0024-multi-instance-runtime-topology.md)；设计轮决定由开发者 2026-10-08 确认，见 [t64 实施计划](../../../.agents/works/w00017-application-runtime-architecture/tasks/t64-plugin-settings/plan.md)。
