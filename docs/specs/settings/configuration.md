---
schema: nbook.spec/v1
kind: behavior
status: implemented
capability: settings.configuration
owners:
  - nbook.settings
---

# 配置

## 目标与非目标

内置插件 `nbook.settings` 让插件声明**配置项**（用户主动设定的偏好，例如界面语言、主题），按声明里的默认值、用户层、项目层合成每一项的有效值，并推到每个内核实例。所有已声明的项都可读；写入只限声明它的插件；用户直接改 JSON 文件即时生效。

不承诺：

- 设置窗口（分区、控件与给页面用的组件）：见 [`settings.window`](settings-window.md)；本 Spec 只定它写入用的用户编辑路径（输出 19）与声明里给界面用的字段。
- 密钥存储与本机层：本 Spec 只定合同（“密钥”“本机层”两节，planned 子条目），分别随第一个密钥使用者与桌面端实现。
- 内存层、策略层、语言或资源级覆盖（VS Code 的 `[markdown]`）、多套用户配置（VS Code 的 Profile）、层间对象深合并：每个键整体覆盖。
- 启动配置：端口、状态根等由宿主的环境变量决定（[`runtime.server-host`](../runtime/server-host.md)），不经本插件。
- 跨设备同步。
- 与不走本插件写入锁的外部编辑器之间的写入互斥：只缩小竞态窗口（输出 13）。
- 已知限制：网络文件系统与部分容器挂载上收不到文件事件时，外部修改到下一次写入或重启才生效；Windows、macOS 未实测。

## 术语与参与者

- **配置项**：一条声明，键为 `<插件 id>/<名>`，与服务 id、公开键同一命名规则（[术语表](../runtime/glossary.md)）。
- **声明者**：声明配置项的插件。只有它能写这一项。
- **层**：`default`（声明里的默认值）、`user`（`<状态根>/settings.json`）、`project`（`<项目目录>/.nbook/settings.json`）。越具体越优先：项目层 > 用户层 > 默认值。
- **层拥有者**：user 层归服务端实例的 `nbook.settings` 入口，project 层归该项目当前项目实例的 `nbook.settings` 入口（与 [Storage](../storage/persistence.md) 的分区归属一致）。拥有者读写文件、校验、发布层快照。
- **层快照**：拥有者对一层的当前看法：状态、有效的键值、被丢弃的键、修订号。
- **有效值**：一个实例里，按本实例可用的层合成的值。
- **参与者**：声明者；`nbook.settings`（拥有贡献点 `settings.properties`，在服务端、项目、浏览器三种位置各有入口，提供 `settingsKey`）；读取方（任何插件）；用户（改文件，或经设置窗口）。

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

// 一个插件的多条：插件 id 只写一次；不写 title 时登记处补约定键（settings-window 的“约定键”），名是键；每项的值类型由它自己的 schema 推出
export const {settings: codeSettings, contributions: codeContributions} = defineSettings("nbook.editor", {
    "code.fontSize": {schema: Type.Integer({minimum: 8, maximum: 40}), default: 14},   // 标题键 settings.code.fontSize.title
    "code.wordWrap": {schema: Type.Boolean(), default: true, title: "Word Wrap"},       // 字符串是不翻译的字面文字
});
// 描述 contributions 里放 ...codeContributions；读写用 codeSettings["code.fontSize"]
```

`defineSettings(plugin, items)` 返回 `{settings, contributions}`：`settings` 按名给出与逐条 `defineSetting` 相同的定义，`contributions` 按声明顺序；有一项不合规则时整体抛 `TypeError`。

| 字段 | 规则 |
|---|---|
| `plugin` + `name` | 键 `<插件 id>/<名>`；插件 id 是贡献方插件；名是以点分段的小驼峰（`appearance`、`editor.fontSize`），至多 128 个字符 |
| `schema` | 可 JSON 序列化的 TypeBox schema |
| `default` | JSON 能如实表示的值（规则同 [远程服务与 RPC 协议](../runtime/plugin-channel.md) 的帧编码：没有 `undefined`、非有限数、类实例、函数、循环），且符合 `schema` |
| `layers` | `["user"]`、`["project"]` 或两者，缺省两者 |
| `title` | 可选，文字（字符串、语言映射或文字引用，见 [`ui/i18n`](../ui/i18n.md)），写了原样保留；省略时登记处补成声明者插件目录里的约定键（[`settings.window`](settings-window.md)“约定键”）。`description` 可选，同样是文字，省略就是没有 |
| `section` | 可选，设置窗口里所在的分区 id（[`settings.window`](settings-window.md) 的分区 id 写法）；可以是别的插件贡献的分区 |
| `group` | 可选，分区里的小组 id（一个小写段，至多 64 个字符）；只能和 `section` 一起写 |
| `order` | 可选，小组内的顺序，-1000000 到 1000000 之间的数；同值按键 |
| `choices` | 可选。`[{value, title, description?}]`：`schema` 是若干字面量的联合（`Type.Union` 的成员全是字符串、有限数或布尔的 `Type.Literal`）时，与字面量一一对应，每项的 `title` 可以省略，省略时同样补约定键。或 `{from: "<选项提供者 id>"}`：动态选项，只用在字符串的 `schema` 上，提供者 id 的写法同分区 id，存不存在不在登记时核对；提供者见 [`settings.window`](settings-window.md)“选项提供者” |
| `ui` | 可选，设置窗口画这一项的界面提示，`ui.forms` 的 `x-form` 里与单个字段有关的几项（[`ui.forms`](../ui/forms.md)）：`widget`、`placeholder`、`unit`（文字）、`rows`（1 到 50 的整数）、`searchable`、`itemLabel`；写的控件要能用在这种值上（同 `ui.forms` 输出 2），`itemLabel` 要是列表项的字段 |
| `applies` | `"now"`（缺省）、`"next-run"`、`"next-session"`、`"restart"`：改动什么时候完全生效 |
| `secret` | 本期声明 `true` 被拒（密钥存储尚未实现） |

- 插件把对外的配置定义写在自己的 `shared/contracts.ts`，描述与读取方引用同一常量。
- **作者规则**：会执行程序、指定网络地址或凭据、改变数据位置的配置项必须只允许用户层：项目层文件可能来自别人的仓库。
- `applies` 不改变读取：服务照常给出最新的值，消费者自己决定什么时候采用（下次运行、下次会话、重启后）；设置窗口据此在标题后标注生效时机。
- 分区与小组存不存在不在登记时核对：分区是浏览器入口的贡献，配置项在每个实例都登记。指向不存在的分区或小组时怎样呈现，见 [`settings.window`](settings-window.md)。

### 接口

插件在入口的 `dependencies` 里声明 `settingsKey`（`nbook.settings` 的 `shared/contracts.ts`），解析得到按调用方生成的服务对象：

```ts
interface SettingsService {
    get<T>(setting: SettingDefinition<T>): DeepReadonly<T>;
    inspect<T>(setting: SettingDefinition<T>): SettingInspection<T>;
    declaration(setting: SettingDefinition<unknown>): SettingDeclaration | null;   // 本实例接受的、补全过的声明；没有接受时为 null
    onDidChange(listener: (keys: ReadonlySet<string>) => void): () => void;
    update<T>(setting: SettingDefinition<T>, value: NoInfer<T> | undefined, options?: {layer?: "user" | "project" | "auto"}): Promise<SettingWriteResult>;
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

1. **登记期校验**：声明的键前缀不是贡献方插件 id、名不合规则、`schema` 不能 JSON 序列化、`default` 不是 JSON 能如实表示的值或不符合 schema、`layers` 为空或含未知层、`title` 或 `description` 不是文字、`choices` 或 `ui` 不合上表的规则、`secret: true`，各使这一条声明以 `invalid-declaration` 被拒，原因可查；同一插件的其它贡献照常。
2. **同键**：两条声明用同一个键时两条都被拒，与登记顺序无关。
3. **每个实例都知道全部声明**：声明在描述里，服务端、项目实例与窗口都登记全部插件的声明，不论声明者在本位置有没有入口、入口是否已激活。
4. **层的校验**：拥有者逐键校验文件内容：已声明、符合 schema、本层允许的键进入层快照；不符合 schema 或本层不允许的键被丢弃，记一条诊断（键与原因，不含值），同一份文件内容只记一次；没有声明的键（插件未装或已停用）留在文件里、不进层快照、不报错。
5. **层无效**：文件无法解析、根不是对象、同一键出现多次（任意深度）时，层为 `invalid`：层快照保留上一份有效内容（启动时即无效则为空），写入为 `layer-invalid`，文件不被改动；文件修好后层恢复为 `ok`。无效的层快照除了 `detail`，还带不含位置的原因 `reason` 与出错位置 `position: {line, column}`（同输出 24 `invalid-text` 的位置写法；出错处无法定位时没有 `position`）。
6. **合成**：每个键取本实例可用、且声明允许的层里最具体的值，没有则取默认值；对象值整体覆盖，不合并。
7. **读取**：`get` 同步、不失败，返回深冻结的值；在 `@vue/reactivity` 的 computed 或 effect 里读时，值变化后重新求值。`inspect` 同样是响应式的，层状态变化（变为 `invalid`、恢复、`unavailable`）时重新求值。读取方改不动读到的值，也影响不到别的读取方。
8. **变化通知**：`onDidChange` 在本实例的有效值变化时调用一次，给出变化的键；同一次层更新只调用一次；层状态变化而有效值不变时不调用。
9. **外部修改即时生效**：用户在编辑器里保存文件（原地覆写、写临时文件再改名替换、先截断再写入）、删除文件、删除并重建 `.nbook` 目录、文件所在目录起初不存在后被创建、`settings.json` 是符号链接且链接改指或目标被替换，拥有者都会在最后一次文件事件之后约 50 毫秒重读，变化推到所有订阅这一层的实例。
10. **层快照的发布**：层的状态、有效键值、被丢弃的键、无效原因任一变化就发布新快照；都没变（例如只改了注释或格式）不发布。拥有者自己写入后，文件事件带回的同一内容不再发布。
11. **写入授权**：`update` 只写调用方插件自己声明的项（调用方取内核填写的身份，经代理时也是原插件）。依次核对：已声明（否则 `undeclared`）、调用方是声明者（`denied`）、值是 JSON 能如实表示的值且符合 schema（`invalid-value`）、目标层允许（`layer-not-allowed`）、目标层在本实例可用（`no-project`）。`value` 为 `undefined` 表示删除这一层里的这个键；删除不存在的键、写入与文件里相同的值都成功、无副作用（不建目录、不碰文件，只读文件也一样）。
12. **目标层**：`layer` 缺省为 `"auto"`：本实例的项目层有这个键就写项目层，否则写用户层；只允许用户层的项总写用户层。写入用户层而项目层覆盖了这一键时，写入成功、层值更新、有效值不变。
13. **写入文件**：拥有者只改这一个键，其余内容按原文保留（注释、其它键、未声明的键、BOM、换行风格、缩进风格）；替换已有键的值不动其它文本；新增键按原文的缩进追加；删除独占几行的键只删去那几行（连同它的行尾注释），其余行不动，与别的内容同在一行的键删除后这一行可能被重排。写入先写同目录的临时文件再改名替换；改名前文件被别人改过时从新内容重做；编辑后的文本重新校验通过才落盘。两个拥有者（两个服务端打开同一项目）经文件旁的写入锁串行，各改的键都保留；不走锁的外部编辑器只靠改名前的核对缩小窗口。
14. **符号链接与权限**：`settings.json` 是符号链接时写入替换链接的最终目标，链接保持不变；链接悬空时读为空层、写入为 `write-failed`，链接不动。文件存在但当前用户不可写（只读位）时写入为 `write-failed`，文件与层快照不变。
15. **读到自己的写入**：`update` 成功返回时，本实例已应用这次写入后的层快照（并发写入时，可能已是别人更晚的值）；其它实例经订阅收到。
16. **就绪**：`nbook.settings` 入口激活时等本实例各层的第一份快照，每层至多 3 秒。依赖 `settingsKey` 的入口拿到服务时，已到的层是文件里的值。超时的层为 `unavailable`、按默认值继续并记诊断，快照晚到时照常应用并通知变化。
17. **层不可达与恢复**：订阅一层失败或订阅被结束时，该层为 `unavailable`，按其它层与默认值合成并记诊断。窗口在连接回到在线时重新订阅因连接问题失败的层；同一服务端进程、同一项目代次内断线重连，已建立的订阅由内核重建并先收到当时的快照（[远程服务与 RPC 协议](../runtime/plugin-channel.md) 输出 7）。服务端已换进程、项目代次已结束时窗口整体失效（[`runtime.browser-host`](../runtime/browser-host.md)），不重试。
18. **审计**：拥有者每次写入记一条诊断：键、层、调用方插件与 `via`、结果码，不记值；外部修改记变化的键。

### 用户编辑

19. 层拥有者的远程服务另有用户编辑方法 `edit`（设值）与 `unset`（删去这一层里的这个键）：写任何已声明项，不核对声明者。拥有者先核对调用方：内核填写的调用方必须是 `nbook.settings` 自己、没有经过代理，别的插件与经代理的请求（包括 `nbook.settings` 代别的入口发出的）不论键与值一律 `denied`；之后依次核对已声明（`undeclared`）、值（`invalid-value`）、本层允许（`layer-not-allowed`）。删除不存在的键、写入相同的值、文件的保留原文、无效层与写入失败同输出 11、13、14；审计（输出 18）标明是用户编辑。设置窗口（[`settings.window`](settings-window.md)）是 `nbook.settings` 自己的入口，经这条路径写入：本窗口没有项目层时写项目层为 `no-project`；成功返回时本窗口已应用写后的层快照，其它实例经订阅收到（同输出 15）。直接改文件也是用户编辑。

### 密钥（planned）

20. 声明 `secret: true` 的项只在服务端有值：任何接口不把值发往客户端，客户端只能看到“已设置/未设置”、只能写入或清除；无法解密时读取为 `secret-unreadable`；审计不记值。存储方式随第一个使用者定，不用明文加打码。

### 界面字段

21. **界面字段的登记期校验**：`section` 不是分区 id 的写法、`group` 不是小组 id 的写法或没有 `section`、`order` 不是范围内的有限数、`choices` 用在不是字面量联合的 `schema` 上或与字面量不一一对应（少一个、多一个、值不是字面量、同一值出现两次）或选项的 `title`、`description` 不是文字、动态选项 `{from}` 用在不是字符串的 `schema` 上或提供者 id 写法不对、`ui` 有表外的键或文字字段不是文字或控件用不到这种值上或 `itemLabel` 不是列表项的字段、`applies` 不是四个值之一，以及声明了字段表以外的字段（包括已删除的 `restart`），各使这一条声明以 `invalid-declaration` 被拒，原因可查；同一插件的其它贡献照常（同输出 1）。

### 本机层（planned）

22. 只在本机生效的项（与这台机器有关的路径、显示缩放）放在本机层：值只在写入它的机器上生效。随桌面端实现，层的落点、优先级与声明写法到时补进本 Spec；在此之前声明里写本机层按未知层被拒（输出 1）。

### 层文件的位置

23. **层快照带文件路径**：层快照可以带这一层文件的绝对路径（可选字段 `path`），设置窗口在这一层无效时把它指给用户（[`settings.window`](settings-window.md) 输出 13）。项目层的拥有者带上它：文件在用户登记的作品目录里，那条路径本就显示给用户（[`runtime.projects`](../runtime/projects.md)“路径可见性”）；用户层的文件在状态根下，状态根是服务端内部路径、不发给浏览器，用户层的快照不带路径。同一个拥有者的路径不变，不参与“内容变了才发布”的比较（输出 10）。远程合同只加可选字段，版本不变。

### 整份读写

24. **设置文件的全文**：两份远程合同（版本 2）另有 `readText`、`writeText` 与事件 `text`，给设置窗口的“设置文件”视图（[`settings.window`](settings-window.md) 输出 23）。调用方核对同用户编辑（输出 19）：只接受 `nbook.settings` 自己、没有经过代理的请求，别的一律 `denied`。
    - `readText() → {text, revision, exists}`：这一层文件的原始文本；`revision` 是文件原始字节的 SHA-256 十六进制，与层快照的修订号无关；文件不存在时 `exists` 为假、`text` 为空串、`revision` 是空字节的摘要。文件存在但读不了，或不是合法的 UTF-8，为 `read-failed`（替换字符写回去会改掉用户文件里的字节）。
    - `writeText({text, revision}) → {revision, snapshot}`：在拥有者的写入队列与写入锁里，以磁盘上的当前文本为准：当前文件原始字节的摘要不是 `revision` 为 `conflict`，文件不变；`text` 按读取的检查不过（语法错误、根不是对象、任意深度的重复键）为 `invalid-text`，失败详情的 `detail` 是不带位置的中文原因、另带 `position: {line, column}`（从 1 起，BOM 不算，列按 UTF-16 码元），文件与快照不变。通过后原样写入（注释、格式、未声明的键都照 `text`），不合 schema 或本层不允许的键照写、按输出 5 丢弃并列入问题；成功带回新的修订号与写后的层快照。层 `invalid` 时照样可以写，这是修好文件的路。写盘失败同输出 14。
    - 事件 `text`：订阅先推一次当前文本的修订号，之后原始文本变了就推（监视到的外部修改与本拥有者的任何写入），只改注释、格式也推；层快照照旧只在内容变了时发布（输出 10）。

### 比较后写入

25. **`update` 的 `expect`**：`update(setting, value, {expect: {value: v}})` 只在目标层里这个键当前的值等于 `v` 时写（按规范化的 JSON 文本比，对象的键序不算；`v` 为 `undefined` 表示期望这一层还没有这个键），否则为 `conflict`、文件与快照不变。比较在拥有者的写入队列与写入锁里、以磁盘上的当前文本做，所以期间从设置文件视图、外部编辑或另一个实例写入的内容不会被盖掉；调用方重读后在新值上再改。核对顺序在输出 11 的各项之后、写盘之前；不给 `expect` 时行为不变。远程合同的 `set`、`remove` 只加可选字段，版本不变。

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

- 服务对象是按调用方门面，随调用方入口的这一代释放（[`runtime/services.md`](../runtime/services.md)）：释放后访问它抛 `ServiceRevokedError`，`onDidChange` 不再调用；释放前已发出的 `update` 照常结算。同一个函数由两个调用方各登记一次是两项，一方取消或释放不影响另一方。
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
| `denied` | 调用方不是这一项的声明者；用户编辑时调用方不是 `nbook.settings` 自己或经过了代理 | — |
| `undeclared` | 键没有被接受的声明 | 检查声明 |
| `invalid-value` | 值不符合 schema 或不是 JSON 能如实表示的值 | 修正值 |
| `layer-not-allowed` | 声明不允许写这一层 | 换层 |
| `no-project` | 本实例没有项目层（服务端、未绑定项目的窗口） | 在项目里写，或写用户层 |
| `layer-invalid` | 文件当前无效 | 让用户修好文件 |
| `write-failed` | 没有写入：写盘出错、只读、链接悬空、写入锁等不到或在写入期间被别的进程接管、改名前冲突重试用尽、编辑后校验不过；`detail` 区分 | 报告给用户；不报已保存 |
| `unavailable` | 层的拥有者不可达 | 等恢复 |
| `unknown-outcome` | 写请求发出后中断，可能已写入 | 等层快照 |
| `read-failed` | 整份读：文件存在但读不了（输出 24） | 报告给用户，修好权限后重读 |
| `conflict` | 整份写：文件在读出之后被别处改过（输出 24）；带 `expect` 的写：当前值不是期望的（输出 25） | 重新读取，在新文本或新值上再改 |
| `invalid-text` | 整份写：文本不是合格的设置文件，带出错位置（输出 24） | 按位置修正文本 |

一层出错只影响这一层；读取永不失败，出错的层按默认值与其它层合成。

## 边界与兼容

- **owner**：`nbook.settings` 拥有配置文件、层快照、贡献点 `settings.properties` 与三端入口；内核提供顶层声明式贡献的登记、按调用方门面与跨实例委托。
- **公开接口**：`defineSetting`、`SettingDefinition`、`SettingsService` 与失败码（`nbook/shared/settings`）；`settingsKey`。声明字段只增不改，新增的可选字段不影响旧声明；已删除的 `restart` 由 `applies` 取代。远程服务 `nbook.settings/user`、`nbook.settings/project` 是本插件实例之间的协议，别的插件直接调用也只能写自己声明的项，用户编辑与整份读写方法只对 `nbook.settings` 自己开放；版本 2 加了 `readText`、`writeText` 与 `text` 事件，两份一起升，打包 smoke 里手写的请求帧随之改版本。
- **信任**：项目层可能来自别人的仓库，靠作者规则（只允许用户层）挡住能改本机行为的项；命名空间与声明者核对防误用，不防恶意的受信代码（[ADR 0022](../../adr/0022-extensible-platform-and-plugin-trust.md)）。

## 验收与 Smoke

1. **合成与位置**：用户层主题 `macos`、项目层主题 `nbook`：服务端与未绑定窗口读到 `macos`，项目实例与绑定窗口读到 `nbook`；项目层里的界面语言被丢弃并记诊断；`inspect` 给出来源层与各层的值。
2. **跨实例写入**：窗口里的工作台写主题，另一个窗口与项目实例即时收到；`update` 返回时本窗口已是新值；别的插件写工作台的主题为 `denied`。
3. **外部修改**：用编辑器的三种保存方式改用户层文件，所有窗口即时变化；文件改坏时各实例的 `inspect` 变为 `invalid` 且值不变、写入为 `layer-invalid`，改回同样的值后恢复 `ok`；删除并重建 `.nbook` 后再改仍生效；链接改指另一个目标后改新目标仍生效。
4. **文件保留**：带注释、BOM、CRLF、制表符缩进与未声明键的文件，经窗口写一个键后其余内容不变。
5. **两个写入者**：两个服务端进程打开同一项目，各写一个不同的键，两键都在文件里。
6. **就绪与恢复**：服务端在窗口订阅前断开，窗口按默认值启动；连接恢复后收到文件里的值。
7. **只读与链接**：只读文件、悬空链接写入为 `write-failed`，文件与链接不变。
8. **用户编辑**：绑定作品的窗口里，设置窗口的入口以 `nbook.settings` 的身份写工作台声明的主题：用户层文件的注释与别的键不变，返回时本窗口已是新值，另一个窗口与项目实例经订阅收到；写本作品层再 `unset` 回到用户层的值；别的插件直接调用与经代理的 `nbook.settings` 请求都为 `denied`，文件不变；审计标明是用户编辑。

Smoke：`smoke:server` 经打包产物在带注释的 `settings.json` 上以客户端身份写一个键，注释保留；文件损坏时服务端照常启动并记诊断。`e2e/settings.e2e.ts` 在本机 Chrome 覆盖场景 2、3 与界面语言、主题的显示。

## 实现合同

- **公开入口**：`nbook/shared/settings`（`defineSetting`、`settingDeclarationProblem`、`SettingDefinition`、`SettingDeclaration`（登记后，`title` 总有值）、`SettingChoiceDeclaration`、作者写下的形状 `WrittenSettingDeclaration` 与 `WrittenSettingChoice`（`title` 可省）、补全函数 `completeSettingDeclaration`、`SETTING_APPLIES`、`literalUnionValues`、`SettingsService`、`SettingInspection`、`SettingWriteResult`、`SETTINGS_FAILURES`、`SETTINGS_POINT`）；`nbook/plugins/settings/shared/contracts`（服务键 `settingsKey`、配置项 `localeSetting` 与生成它的 `localeSettingFor(语言集合)`、`displayLocale(设置服务)`、三条设置命令共用的 `switchSetting`，远程合同 `userSettingsContract`、`projectSettingsContract`：版本 2，方法 `set`、`remove`、`edit`、`unset`、`readText`、`writeText`，事件 `layer`、`text`）；用户编辑在浏览器里的调用入口是 `plugins/settings/web/window-source.ts` 的设置窗口数据来源，只经服务发给 `nbook.settings` 自己的入口，不是公开接口；插件定义 `settingsBackendPlugin`（服务端入口拥有用户层，文件在宿主能力 `stateRootKey` 给出的状态根下；项目入口拥有项目层，文件在 `currentProjectKey.root` 下）与 `settingsBrowserPlugin`（配置核心入口 `browser` 与贡献“切换界面语言”的 `commands` 入口；不装工作台的测试实例用只有核心入口的 `settingsBrowserCore`）。各插件的配置定义写在自己的 `shared/contracts.ts`（工作台的 `themeSetting`、`appearanceSetting`），描述的 `contributions` 引用同一常量。界面语言的取值、设置窗口里的选项与“切换界面语言”命令的参数都由 `nbook/shared/host-locales` 的 `HOST_LOCALES` 生成（`hostLocaleSchema` 给出只接受集合内语言的枚举 schema），加一种界面语言只改这个集合与宿主目录（[`ui/i18n`](../ui/i18n.md)）。
- **owner 与依赖方向**：`nbook.settings` 依赖内核的顶层贡献登记（`runtime.plugin-manifest` 输出 11，宿主经 `nbook/manifest` 的 `pluginsAt`、`definitionAt` 装配）、按调用方门面、远程服务与跨实例委托（`remoteDelegates`、`context.remote.on`）；三个位置的入口都依赖诊断与宿主时钟 `clockKey`，浏览器另依赖窗口的项目绑定与连接状态 `windowConnectionKey`。文件解析与单键编辑用 `jsonc-parser`，写入锁用 `proper-lockfile`，都只在服务端与项目子进程里。命令系统、工作台与项目界面依赖 `settingsKey` 取显示语言；配置核心不依赖它们，“切换界面语言”在另一个入口里，免得服务装配的静态环（可选依赖也算）。
- **关键不变量**：
  - 层文件只在拥有它的实例里读写；别的实例经远程服务到达，拥有者按内核填写的调用方身份核对声明者，用户编辑另核对调用方是 `nbook.settings` 自己且没有经过代理，不信任输入（输出 11、19，验收 2、8）。
  - 同一文件的重读与写入在拥有者的同一个串行队列里，核对通过的写入同步排进队列，停止时等它走完；快照内容变了才换修订号并发布（输出 10、15，“时序与寿命”）。
  - 编辑后的文本重新解析并通过读取的检查才落盘；写入持锁、改名前核对文件身份，悬空链接与只读文件不写（输出 13、14，验收 4、5、7）。
  - 监视路径与链接目标上最近存在的目录，目录身份变了先关旧监视再建新的；合并与截止都经注入的时钟（输出 9、16）。
  - 实例只应用同一启动标识下修订号更大的快照；远程快照逐层冻结；首个快照的截止不取消订阅，建立失败或结束的层在窗口回到在线时重新订阅，终态原因不重订（输出 7、15–17）。

## 证据

- 批准依据：[插件的数据与状态](../../proposals/plugin-data-model.md) 第 6、7、8 节、[多实例运行时拓扑](../../proposals/multi-instance-runtime-topology.md) 第 6、11 节、[ADR 0024](../../adr/0024-multi-instance-runtime-topology.md)；设计轮决定由开发者 2026-10-08 确认，见 [t64 实施计划](../../../.agents/works/w00017-application-runtime-architecture/tasks/t64-plugin-settings/plan.md)。
- 实现入口：[`src/shared/settings.ts`](../../../packages/neuro-book/src/shared/settings.ts)、[`plugins/settings/backend/plugin.ts`](../../../packages/neuro-book/src/plugins/settings/backend/plugin.ts)、[`plugins/settings/web/plugin.ts`](../../../packages/neuro-book/src/plugins/settings/web/plugin.ts)、[`plugins/settings/shared/instance.ts`](../../../packages/neuro-book/src/plugins/settings/shared/instance.ts)、[`plugins/settings/backend/layer-owner.ts`](../../../packages/neuro-book/src/plugins/settings/backend/layer-owner.ts)、[`plugins/settings/web/window-source.ts`](../../../packages/neuro-book/src/plugins/settings/web/window-source.ts)
- 合同测试：[`settings.test.ts`](../../../packages/neuro-book/src/plugins/settings/settings.test.ts)、[`commands.test.ts`](../../../packages/neuro-book/src/plugins/settings/commands.test.ts)、[`layer-owner.test.ts`](../../../packages/neuro-book/src/plugins/settings/backend/layer-owner.test.ts)、[`layer-text.test.ts`](../../../packages/neuro-book/src/plugins/settings/shared/layer-text.test.ts)、[`instance.test.ts`](../../../packages/neuro-book/src/plugins/settings/shared/instance.test.ts)、[`layers.test.ts`](../../../packages/neuro-book/src/plugins/settings/shared/layers.test.ts)、[`settings.test.ts`（声明）](../../../packages/neuro-book/src/shared/settings.test.ts)、[`sections.test.ts`（界面字段经内核登记）](../../../packages/neuro-book/src/plugins/settings/web/sections.test.ts)；整份读写（输出 24）：`layer-owner.test.ts`“整份读写”（真实文件），[`window.test.ts`](../../../packages/neuro-book/src/plugins/settings/window.test.ts)“设置文件视图”（经远程合同版本 2）
- Smoke：[`smoke-server.ts`](../../../packages/neuro-book/scripts/smoke-server.ts)（S9，含版本 2 的整份读与冲突）、[`settings.e2e.ts`](../../../packages/neuro-book/e2e/settings.e2e.ts)
