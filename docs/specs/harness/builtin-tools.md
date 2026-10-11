---
schema: nbook.spec/v1
kind: behavior
status: implemented
capability: harness.builtin-tools
owners:
  - nb-harness
---

# Harness 内置工具：文件访问、read 与 edit

## 目标与非目标

`nb-harness` 的 `builtin` 模块给运行时两个内置工具：`read`（读文件、列目录、看图片）与 `edit`（OMP hashline 协议的先读后改）。两者按 [`workspace.resources`](../workspace/resources.md) 的**资源地址** `方案://路径` 寻址：每个方案一个**提供者**，目录型提供者就是受根约束的**文件访问**接口 `FileAccess`（本地实现 `createLocalFileAccess` 把一个目录当根），虚拟提供者只读；方案由使用方登记，内核不预设。插件阶段由 `nbook.files` 的项目文件服务实现同一接口。两个工具按 [`harness.tools`](tools.md) 的协议定义（`defineTool`），与插件贡献的工具走同一条路。

不承诺：

- 项目级参数注入与多根（插件阶段的 `ToolInterceptor`）。
- 编辑协议本身的语义（锚点重映射、未展示行守卫、模糊匹配）：由 OMP 的编辑引擎决定，本模块只装配与落盘；错误文本照 OMP，不改写。
- 文件监视、协作锁、无覆盖冲突：由 [`workspace.files`](../workspace/files.md) 层面的能力负责。
- `read` 的第三方格式（PDF、docx 等）：第一批只有文本、目录与图片。

## 术语与参与者

- **资源地址**：`方案://路径`，路径用 `/` 分隔、相对方案根，根本身是空路径（`project://`）；规则照 [`workspace.resources`](../workspace/resources.md)。两个工具的路径一律是完整地址，不带方案的为 `invalid-address`。
- **方案与提供者**：方案名到提供者的登记（`ResourceAccess`）；目录型提供者是一个真实目录当根的 `FileAccess`（可只读），虚拟提供者的数据不在真实目录里，只读、不可编辑；按会话的方案（`local://`、`artifact://`）登记工厂，按会话 id 各建一份。
- **根**：目录型提供者的绝对目录；提供者眼里的路径都是根内的相对路径（方案根对应 `.`）。
- **根内路径**：相对路径经规范化后仍在根里（不以 `..` 走出根、不是绝对路径）；符号链接按真实路径再判一次。
- **快照与标签**：`read` 展示文本时把展示过的行登记到 OMP `EditStore`，得到标签 `#XXXX`；`edit` 的输入以 `[path#tag]` 开头，引擎据此核对“先读后改”。标签是文件内容的哈希（OMP 语义），不是会话私有的令牌；按会话隔离的是展示过的行与快照记录。
- **调用方**：运行时通过 `ToolSource` 取得这两个工具；`ToolContext.session.id` 决定用哪个会话的快照存储与按会话的提供者。

## 输入与前置条件

```ts
// 公开入口 @notnotype/nb-harness/builtin
createBuiltinTools(input: {resources: ResourceAccess; read?: {maxLines?: number; maxBytes?: number}; stores?: SnapshotStores}): ToolSource;   // 列出 read、edit；stores 不传则来源自己持有
readTool(input: {resources: ResourceAccess; stores: SnapshotStores; maxLines?: number; maxBytes?: number}): ToolDefinition;
editTool(input: {resources: ResourceAccess; stores: SnapshotStores}): ToolDefinition;
createSnapshotStores(): SnapshotStores;                      // 每个会话一个 OMP EditStore
interface SnapshotStores { forSession(sessionId: string): EditStore; release(sessionId: string): void; }

// 资源寻址（workspace.resources 的地址规则；方案由使用方登记，内核不预设）
type ResourceAddress = {scheme: string; path: string};      // 方案://路径；路径相对方案根，根是空路径
parseAddress(address: string): FilesResult<ResourceAddress>; // 不合规则为 invalid-address
formatAddress(address: ResourceAddress): string;
createResourceAccess(definitions: Record<string, SchemeDefinition>): ResourceAccess;   // 方案名 [a-z][a-z0-9+.-]*，缺说明抛 TypeError
type SchemeDefinition = {provider: ResourceProvider | ((context: SchemeContext) => ResourceProvider); doc: string};   // 工厂按会话各建一份并复用
type SchemeContext = {sessionId: string};
interface ResourceAccess { schemes(): {scheme: string; doc: string}[]; open(scheme: string, context: SchemeContext): ResourceProvider | undefined; }
type ResourceProvider = DirectoryProvider | VirtualProvider;
interface DirectoryProvider extends FileAccess { readonly kind: "directory"; readonly readonly: boolean; }   // 一个真实目录当根；readonly 的方案拒绝写入
interface VirtualProvider {                                  // 数据不在真实目录里，只读、不可编辑
    readonly kind: "virtual";
    stat(path: string): Promise<FilesResult<{kind: "file" | "directory"; bytes: number}>>;
    readText(path: string): Promise<FilesResult<string>>;
    list(path: string): Promise<FilesResult<{name: string; kind: "file" | "directory"}[]>>;
}

interface FileAccess {
    readonly root: string;                                   // 绝对路径
    resolve(path: string): FilesResult<string>;              // 只按字面规范化：根内相对路径 → 绝对路径；越界为 outside-root
    locate(path: string): Promise<FilesResult<string>>;     // 再按真实路径判：经符号链接指向根外、链接目标不存在都是 outside-root
    stat(path: string): Promise<FilesResult<{kind: "file" | "directory"; bytes: number}>>;
    readBytes(path: string): Promise<FilesResult<Uint8Array>>;
    list(path: string): Promise<FilesResult<{name: string; kind: "file" | "directory"}[]>>;   // 一层，按名字排序，目录在名字后带 /
    write(path: string, content: string): Promise<FilesResult<void>>;    // 整文件替换；父目录不存在时创建
    remove(path: string): Promise<FilesResult<void>>;
}
type FilesFailure = "invalid-address" | "unknown-scheme" | "read-only" | "outside-root" | "not-found" | "not-a-file" | "not-a-directory" | "io-failed";
type FilesResult<T> = {ok: true; value: T} | {ok: false; code: FilesFailure; detail: string};

// 子入口 @notnotype/nb-harness/builtin/local
createLocalFileAccess(options: {root: string; readonly?: boolean}): DirectoryProvider;   // root 必须是已存在的目录的绝对路径，否则抛 TypeError
createSessionDirectories(options: {root: string}): (context: SchemeContext) => DirectoryProvider;   // local:// 用：root/<会话 id>，第一次打开时创建
```

| 规则 | 内容 |
|---|---|
| `read` 参数 | `{path: string; offset?: integer >= 1; limit?: integer >= 0}`；`path` 是资源地址 |
| `edit` 参数 | `{input: string}`：OMP hashline 原文，首行 `[地址#tag]`，地址是目录型、非只读方案下的资源地址 |
| 工具风险 | `read` 为 `read`；`edit` 为 `write` |
| 预算 | `read` 文本缺省最多 2000 行、50 KiB（UTF-8），先到先停 |
| 路径 | 两个工具只接受完整的资源地址（裸路径、绝对路径、`~`、`.`/`..` 段为 `invalid-address`，没登记的方案为 `unknown-scheme`）；`FileAccess` 只接受根内相对路径，越界、指向根外的符号链接一律 `outside-root` |

## 输出与可观察行为

1. **文件访问**：`createLocalFileAccess` 要求 `root` 是已存在目录的绝对路径（否则抛 `TypeError`），文件系统的根 `/` 也可以。每个方法先 `locate`：规范化后不在根内为 `outside-root`（越界看的是父目录组件 `..`，`..foo` 这样的名字是合法的）；目标不存在为 `not-found`；`readBytes` 遇到目录为 `not-a-file`，`list` 遇到文件为 `not-a-directory`；其它系统错误为 `io-failed`（`detail` 带错误码）。`write` 创建缺失的父目录（仍须在根内）后整文件写入；`remove` 删除文件（目录为 `not-a-file`）。符号链接：目标在根内照常，指向根外为 `outside-root`；目标不存在的（悬空）链接也是 `outside-root`——写入会跟着它落到根外，而根内与否证明不了。
2. **read 文本**：目录型方案的文本文件输出首行 `[<地址>#<tag>]`，之后每行 `<行号>: <内容>`（行号从 1 起，`offset` 起算，按 `limit` 截），并把展示过的行按真实绝对路径登记到本会话的快照存储（`tag` 由它给出）；虚拟方案的文本同样分页，但没有标签头、不登记快照，`details.editable` 为 `false`。内容含 NUL 字节为错误 `binary`；`offset` 超过行数为错误 `invalid-arguments`。超过预算时只输出预算内的行，末尾加一行 `输出已截断：lines`（或 `bytes`），`details.truncated` 为 `true`、`details.reason` 为原因。`details` 另带 `path`（完整地址）、`lines`（展示的行数）。
3. **read 目录**：每个条目一行 `- <name>`，目录带 `/`，按名字排序，最多 500 项（超出加一行说明）；`details.kind: "directory"`、`entries` 为总数。
4. **read 图片**：扩展名为 png、jpg、jpeg、gif、webp 的文件以图片块返回（base64 与 `mimeType`），`details.bytes` 为字节数；不登记快照。
5. **read 失败**：地址不合规则为 `invalid-address`，方案没登记为 `unknown-scheme`；提供者的失败码照搬为工具错误码（`outside-root`、`not-found`、`io-failed`）；错误消息说明地址或提供者眼里的路径。
6. **edit**：工具说明是 OMP 的 hashline 语法说明（`editDescription("hashline")`，模型按它训练过）加本模块的约束（路径是资源地址并列出可用方案、头只能来自本会话的 `read`、只读与虚拟方案不能改、没有新建文件的工具）。执行前先核每个 `[地址#tag]` 头：带前后空白为 `invalid-address`（引擎会去空白，本模块不替它猜），地址不合规则为 `invalid-address`，方案没登记为 `unknown-scheme`，虚拟或只读方案为 `read-only`，再经提供者 `locate`（真实路径，符号链接也认得出）不在根内为 `outside-root`；任一失败整次不交给引擎（引擎会自己读头里的文件来核对标签并把内容回显在错误里，根外的文件连读都不能读）。然后用本会话的快照存储新建一个 OMP `EditSession`（hashline 模式，`urlSchemes` 是登记的方案，`enforceSeenLines` 开，`allowFuzzy` 开），引擎遇到带方案的头经 `resolveUrl` 回调向本模块要真实绝对路径（同一套核对），`input` 原样交给引擎；引擎决定要写的文件后，每个绝对路径按本次打开过的目录型提供者的根反查方案、转回相对路径经该提供者 `write`（`delete` 操作经 `remove`，`move` 先写目标再删源）落盘，一次 `edit` 可以跨方案改多个文件；引擎回显的文本（含新标签、头是地址）原样作为工具内容，`details.files` 列出每个文件的 `path`（地址）、`op`、`warnings`。引擎报错（伪造标签、未展示的行、解析失败）→ 错误结果，文本照引擎、`code: "edit-rejected"`，磁盘不变（引擎拒绝时回显的文件内容也算展示过，这是 OMP 的语义）。引擎要写的路径不在任何已打开方案的根内（例如 `move` 的目标）或提供者判越界（悬空链接）→ `outside-root`（访问层的码原样保留，只有真正的 I/O 失败才是 `io-failed`），整次不落盘。
7. **会话隔离**：快照存储按 `ToolContext.session.id` 分开：一个会话 `read` 登记的“展示过的行”不约束也不放行另一个会话。标签本身是文件内容的哈希（OMP 语义）：另一个会话拿同样的标签、文件内容没变时引擎照常接受；文件变了则按它的规则核对。`SnapshotStores.release(sessionId)` 丢弃该会话的存储。
8. **工具来源**：`createBuiltinTools` 返回的 `ToolSource` 列出 `read`、`edit` 两个描述符，`get` 返回同一份定义（引用稳定）。
9. **方案与提供者**：`createResourceAccess` 按方案名登记提供者或工厂（方案名不合规则、说明为空抛 `TypeError`）；`open(scheme, {sessionId})` 对没登记的方案返回 `undefined`，对工厂按会话 id 各建一份并复用（同一会话里 `read` 登记的快照与 `edit` 对的是同一个根）。`createLocalFileAccess({readonly: true})` 的 `write`、`remove` 为 `read-only`；`createSessionDirectories({root})` 的提供者根是 `root/<会话 id>`（id 里不是 `[A-Za-z0-9_.-]` 的字符换成 `_`），第一次打开时创建，不随会话结束删除。两个工具的说明列出 `schemes()` 的方案与说明，模型据此知道有哪些根。

## 状态与转换

本模块的状态只有每个会话的快照存储（展示过的行与快照记录），随 `release(sessionId)` 丢弃，以及登记表里按会话建出的提供者（随登记表对象存活）；快照存储的寿命归装配方：自己建一份传给 `createBuiltinTools({stores})` 并在会话结束后 `release`，不传则由来源持有到来源被丢弃（运行时不替来源回收；插件阶段把它接到会话的生命周期上）。`release` 或进程重启后展示记录丢失，模型要重新 `read`；标签本身是内容哈希，文件未变时新存储仍可能接受它。`FileAccess` 无状态。

**时序**：`edit` 在同一次调用里先由引擎读当前文件、核对标签与展示行、计算结果，再逐个文件经 `FileAccess` 写；写失败时后面的文件不再写，已写的不回滚（引擎的多文件编辑本来就不是原子的）。原生引擎会把 writer 的异常吞成它自己的拒绝，所以写失败由本模块自己记录：结果为错误，`code` 是访问层给的码（`outside-root` 或 `io-failed`），`message` 说明哪个文件，`details.written` 列出这次已经落盘（写入或删除）的文件。

## 副作用与数据

只读写根内的文件；不读环境变量、不写日志。编辑引擎是 OMP 的原生模块（`@oh-my-pi/pi-natives`），它自己从磁盘读当前文件内容（Rust 侧，不经 `FileAccess`）：因为 `cwd` 与根一致，读到的是同一棵树；写全部经 `FileAccess`。

## 失败与恢复

| 失败码（工具结果的 `code`） | 含义 | 模型怎么办 |
|---|---|---|
| `invalid-address` | 不是 `方案://路径`，或路径含空段、`.`、`..`、反斜杠、NUL、盘符、前后空白 | 改用完整的资源地址 |
| `unknown-scheme` | 方案没登记 | 用说明里列出的方案 |
| `read-only` | 只读方案或虚拟方案的资源 | 只能 `read` |
| `outside-root` | 路径解析（含符号链接）后不在方案根内 | 改用根内的地址 |
| `not-found` / `not-a-file` / `not-a-directory` | 目标不存在或类型不对 | 先列目录确认 |
| `binary` | 文件含 NUL 字节 | 不读它 |
| `invalid-arguments` | `offset` 越界等 | 修正参数 |
| `edit-rejected` | 引擎拒绝：标签与当前文件对不上、改了未展示的行、解析失败 | 按引擎文本重新 `read` 后再改 |
| `io-failed` | 读写系统错误；`edit` 时 `details.written` 列出已落盘的文件 | 告诉用户 |

## 边界与兼容

- **公开接口**：`@notnotype/nb-harness/builtin` 与 `@notnotype/nb-harness/builtin/local` 中“输入与前置条件”列出的符号与类型；`FileAccess`、`ResourceProvider`、`ResourceAccess` 是插件阶段的公开 API（`nbook.files` 以项目文件服务实现 `project://` 等方案的提供者）。
- **依赖**：`tools`（`defineTool`、`ToolSource` 类型）；OMP `@oh-my-pi/pi-natives` 运行时（编辑引擎）；`typebox`；Node 内置模块只在 `local` 子入口。
- **与 OMP 的关系**：编辑语义与错误文本全部照 OMP；带方案的头由引擎经 `resolveUrl` 回调交给本模块解析（OMP 18.4 起）；OMP 升级改变 `EditSession` 的签名时 `typecheck` 先失败，改变回显格式时本模块的合同测试先失败。

## 验收与 Smoke

1. 文件访问（真实临时目录）：根内读写列删各一次；`../x`、绝对路径、指向根外的符号链接、指向不存在目标的悬空链接（写入也被拒，根外不出现文件）都是 `outside-root`；`..foo.txt` 这样的根内文件照常；不存在 `not-found`；目录当文件读 `not-a-file`；根不存在或不是目录时构造抛 `TypeError`。
2. read：地址 `project://a.txt` 的文本带标签头与行号；裸路径、`..` 段为 `invalid-address`，没登记的方案为 `unknown-scheme`；`offset`/`limit` 只展示请求的行且快照只登记这些行；超过行数预算时截断并说明；含 NUL 的文件 `binary`；缺失 `not-found`；目录列一层；png 返回图片块。
3. edit（真实引擎）：先读后改落盘正确、回显含新标签；用回显的标签连续第二次编辑；只展示第 1 行却改第 3 行被拒且磁盘不变；伪造标签被拒；文件被外部改动后按 OMP 语义重映射并带警告；一个会话只展示第 1 行的记录不约束另一个会话（隔离的是展示记录，标签是内容哈希）；头里的路径经符号链接指向根外时 `outside-root`、带 `..` 段或空白时 `invalid-address`，都不交给引擎、不泄露根外文件内容、不落盘。
5. 方案与提供者：地址规则逐条；按会话的工厂给不同会话不同的根并复用；一次 `edit` 跨 `project://` 与 `local://` 改两个文件、回显与 `details.files` 都是地址；只读方案 `docs://` 能 `read`、`edit` 为 `read-only`、提供者的写也为 `read-only`；虚拟方案能列、能按 `offset`/`limit` 读、没有标签头、`edit` 为 `read-only`。
4. 经运行时（脚本化模型）：一次调用里模型先 `read` 再 `edit`，文件内容改变，日志里有两个工具结果。

Smoke：`packages/nb-harness` 的 `bun test src/builtin`。

## 实现合同

- 公开入口：`@notnotype/nb-harness/builtin`（`createBuiltinTools`、`readTool`、`editTool`、`createSnapshotStores`、`createResourceAccess`、`parseAddress`、`formatAddress` 与类型）、`@notnotype/nb-harness/builtin/local`（`createLocalFileAccess`、`createSessionDirectories`）。
- owner：`nb-harness` 的 `builtin` 模块；依赖 `tools` 的公开入口与 `@oh-my-pi/pi-natives` 的编辑引擎；Node 内置模块只在 `local` 子入口。
- 内部不变量（都有测试锁定）：
  1. 两个工具不直接 `import` Node 的文件系统模块；所有读写经 `FileAccess`（引擎自己的读除外）。
  2. `read` 登记的 `seenLines` 就是展示出来的行号。
  3. 引擎要写的每个路径都先按本次打开过的提供者反查方案、再经该提供者 `resolve`，不在任何根内整次不写。
  4. 两个工具只接受完整的资源地址；方案由使用方登记，本模块不预设。

## 证据

- 批准依据：[Agent harness 内核](../../proposals/agent-harness-kernel.md) 的“插件的落脚点”（文件访问 `FileAccess`：内核缺省受根约束的本地文件，插件阶段经 `nbook.files`）与“影响”一节（内置文件工具经 `FileAccess` 受根约束，修复越过 cwd 读写的问题）；开发者 2026-10-10 决定做完内核再做内置读写工具。
- 实现入口：[`packages/nb-harness/src/builtin/builtin.ts`](../../../packages/nb-harness/src/builtin/builtin.ts)、[`local/local.ts`](../../../packages/nb-harness/src/builtin/local/local.ts)
- 合同测试：[`local/local.test.ts`](../../../packages/nb-harness/src/builtin/local/local.test.ts)、[`read.test.ts`](../../../packages/nb-harness/src/builtin/read.test.ts)、[`edit.test.ts`](../../../packages/nb-harness/src/builtin/edit.test.ts)（真实临时目录与真实 OMP 编辑引擎）、[`runtime.test.tsx`](../../../packages/nb-harness/src/builtin/runtime.test.tsx)（经运行时，脚本化模型）
- Smoke：不适用——合同测试已用真实引擎与真实文件系统
