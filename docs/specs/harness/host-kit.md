---
schema: nbook.spec/v1
kind: behavior
status: implemented
capability: harness.host-kit
owners:
  - nb-harness
---

# Harness 宿主套件：宿主给的文件访问

## 目标与非目标

nb-harness 的宿主套件（工具、审批、压缩、守卫、会话句柄表、请求记录器这些宿主把内核装成产品时用的通用件）不认识任何应用的地址方案与文件服务。宿主给它一份按会话的文件访问：地址怎么改写、写哪里要另外问、本机读路径、读写、列出、哪些写属于哪次工具调用，以及以宿主身份保存大结果的全文。本 Spec 是这份接口的合同；NeuroBook 与 NeuroBot 各给一个实现，套件只经它读写。

不承诺：

- 套件其余各块（工具、审批、压缩、守卫、句柄表、请求记录器）的宿主无关行为：现在由 [`agent/builtin-tools.md`](../agent/builtin-tools.md)、[`agent/permissions.md`](../agent/permissions.md)、[`agent/compaction.md`](../agent/compaction.md)、[`agent/run-guards.md`](../agent/run-guards.md)、[`agent/sessions.md`](../agent/sessions.md)、[`agent/request-trace.md`](../agent/request-trace.md) 规定，第二个宿主接入时再从中抽出写进本 Spec。
- 地址的完整语法、方案注册、读授权与写授权的规则：属于宿主的文件服务（NeuroBook 见 [`workspace/resources.md`](../workspace/resources.md) 与 [`agent/resources.md`](../agent/resources.md)）。
- 写锁、改动记录、来源与操作分组的落点：由实现记，本 Spec 只要求写入能按调用区分（输出 8）。
- 监视与订阅、文件操作（移动、复制、删除）、glob 与 grep：不在这份接口里，工具在 `readPath` 交回的本机路径上自己做。
- 本机参考实现不是任何应用的正式实现：它不加写锁、不记来源、不按调用分组（输出 8 对它只是把调用的 `signal` 合进读写）。

## 术语与参与者

- **宿主**：把内核装成产品的应用（NeuroBook、NeuroBot），实现本接口。
- **套件**：nb-harness 的宿主套件，只经本接口读写。
- **单数地址**、**全局地址**：宿主自己的两种写法（例如 NeuroBook 的 `session://x` 与 `sessions://<id>/home/x`）；套件只认 `<方案>://<路径>` 的形状，不解析方案的含义。
- **虚拟根**：一个方案的根本身不对应真实目录，列出时得到说明与条目。
- **基线**：读到的内容的指纹，只用来交回给写的 `expect`。

## 输入与前置条件

宿主按内核给的会话上下文（`ToolSessionContext`）建文件访问；上下文变了（换 Profile、换主项目）就重新建，不跨上下文复用。接口（`@notnotype/nb-harness/kit/files` 交出，类型与浏览器可用的纯函数在同一入口）：

```ts
type FileFailure = {readonly ok: false; readonly code: string; readonly detail: string};
type FileResult<T> = {readonly ok: true; readonly value: T} | FileFailure;
interface Baseline { readonly hash: string }
type WriteExpect = Baseline | "absent" | "any";

interface FileCalls {
    read(address: string, options?: {signal?: AbortSignal}): Promise<FileResult<{bytes: Uint8Array; baseline: Baseline}>>;
    write(address: string, content: Uint8Array | string, options: {expect: WriteExpect; createParents?: boolean; signal?: AbortSignal}): Promise<FileResult<{baseline: Baseline}>>;
}
interface SessionFiles extends FileCalls {
    readonly layout: SessionLayout;
    expand(address: string): {readonly ok: true; readonly address: string} | FileFailure;
    classify(address: string): {readonly write: "allowed" | "ask" | "denied"} | FileFailure;
    readPath(address: string, options?: {signal?: AbortSignal}): Promise<FileResult<{path: string; kind: "file" | "directory" | "other"}>>;
    list(address: string, options?: {signal?: AbortSignal}): Promise<FileResult<DirectoryListing | VirtualListing>>;
    call(call: {callId: string; signal: AbortSignal}, info?: {title?: string}): FileCalls;
}
interface SessionLayout {
    readonly working: string;
    readonly scratch: readonly string[];
    readonly localWrites: readonly string[];
    readonly shellEnv: Readonly<Record<string, string>>;
    searchExcludes(root: string): readonly string[];
}
interface ArtifactStore {
    save(label: string, write: (sink: {write(chunk: Uint8Array): Promise<void>}) => Promise<void>): Promise<FileResult<{address: string}>>;
}
type SessionFilesFactory = (context: ToolSessionContext, owner: string | null) => SessionFiles;
```

`DirectoryListing` 是一层目录项（名字与种类），不带 `kind`，靠这一点与虚拟根区分；`VirtualListing` 是 `{kind: "virtual", description, entries}`，每个条目带全局地址，可带标题与几项元数据。`SessionFilesFactory` 的 `owner` 是用它的工具 id，作写入分组的缺省标题；不属于哪个工具时为 null。宿主的实现可以多带字段与选项（例如 NeuroBook 的分类多交回内容的分类，`call` 的 `info` 多收 `note`），套件不依赖它们。

## 输出与可观察行为

1. **改写**：`expand` 把单数地址改写成全局地址，全局地址原样通过；对改写结果再调一次得到同一个地址（幂等）。同步完成，不碰磁盘。地址不合法为 `invalid-address`；宿主自己的前提不满足时交宿主自己的码（例如 NeuroBook 没有主项目时 `project://` 为 `no-project`）。
2. **其余方法都先改写**：`classify`、`readPath`、`read`、`write`、`list` 收单数或全局地址，结果只取决于改写后的全局地址；改写失败时交回改写的失败，不做别的事。
3. **分类**：`classify` 交回写这个地址是 `allowed`、`ask` 还是 `denied`。`ask` 表示即使别的规则放行，写之前也要另外问用户；`denied` 的地址经 `write` 一定失败。
4. **本机读路径**：`readPath` 交回本机路径与种类（`file`、`directory`、`other`），按宿主的读授权核对。路径只用来读，往里写不经本接口、不算这次会话的写。方案没有登记为 `unknown-scheme`（`<方案>://` 只写方案名时同样如此，调用方可以用它探测方案在不在）；虚拟根为 `unsupported-capability`；不存在为 `not-found`。
5. **读**：`read` 交回字节与基线。不存在为 `not-found`，超过宿主的上限为 `too-large`，是目录为 `not-a-file`。宿主有虚拟根时，读虚拟根交回它的文字的字节（与输出 7 的列出是同一份内容）。
6. **写**：`write` 写整份内容，字符串按 UTF-8 编码，成功交回新基线，之后 `read` 读到的就是写入的内容：
   - `expect` 为基线时，当前内容的基线不同为 `conflict`、不写；
   - `expect` 为 `absent` 时，目标已存在为 `conflict`、不写；
   - `expect` 为 `any` 时不核对，覆盖；
   - 父目录不存在时，`createParents` 为真先建好，否则失败；
   - `signal` 在提交之前触发为 `cancelled`，目标保持原样；
   - 宿主不许写的位置为 `permission-denied`，不露出的位置为 `protected-path`，解析后落在根外为 `outside-root`；写虚拟根为 `permission-denied`；方案本身不支持写时（只读的方案）为 `unsupported-capability`，在授权之前就拒绝。
7. **列出**：`list` 对目录交回一层目录项，不读文件内容；对虚拟根交回 `VirtualListing`。不存在为 `not-found`，是文件为 `not-a-directory`。
8. **按调用绑定**：`call({callId, signal}, info?)` 交回绑定一次工具调用的 `read` 与 `write`：经它的写入在宿主的记录里属于这次调用（同一次调用的写入可以与别的调用区分开），`info.title` 给了时作这次调用的标题，否则用工厂的 `owner`，两者都没有时用宿主自己的缺省标题；调用的 `signal` 合进每次读写，触发后在途与之后的写都以 `cancelled` 结束。工具每次执行只调一次 `call`，复用交回的对象。
9. **失败经结果交回**：所有方法的预期失败都经 `{ok: false, code, detail}` 交回，不抛错；`detail` 用地址描述，不带服务端的绝对路径。失败码是开放字符串：下面“失败与恢复”表里的码含义固定，套件只按这些码分支；其余码（宿主自己的）由套件原样交给模型。
10. **布局**：`layout` 给套件用到的几处地址，都可以写单数地址：
    - `working`：`shell` 的工作目录，`grep`、`glob` 不给根时的缺省根；
    - `scratch`：写只落在这些根下时算“只写草稿”（模式闸门用）；
    - `localWrites`：在 `auto` 审批模式下不问审批者的写的根；
    - `shellEnv`：给 `shell` 的环境变量名与它指向的地址，定位不到本机路径的变量不设；
    - `searchExcludes(root)`：以这个全局地址为根搜索时不进的子目录（以 `/` 开头）；只省下无谓的读，搜到的每个结果的授权仍以 `readPath` 为准。
11. **宿主写全文**：`ArtifactStore.save(label, write)` 以宿主身份（不代表会话）为当前会话新建一份全文：写入函数正常结束即提交，交回它的全局地址；写入函数抛错时不留下文件、交回失败。`label` 只收单段、不含路径分隔符，否则为 `invalid-address`。会话经 `SessionFiles.write` 写不了全文所在的位置（`permission-denied`），读照常。
12. （planned）**自动转后台。** `shellTool(dialects, background?, auto?)` 的第三个参数 `ShellAutoBackground` 可选，不给时和现在一样：`threshold({args, call, context}, signal)` 交回门槛（宿主时钟上到点完成的 Promise）或 null；`prepare(...)` 异步占任务 id 与名额、建输出目录，交回 `BackgroundTarget` 或 null；门槛到了之后一个同步步骤里，命令已结束或调用已中止就 `discard()`、照前台交回，否则 `take({prepared, output, done, abort})` 交回此后接收输出的出口与给模型的结果，命令断开这次调用的信号、照原时限跑完。`output` 是到此刻的输出（`OutputSoFar`）：还没超出窗口时是内存里的全部文字（`text`），超出之后是系统临时目录里的暂存（`spool` 的描述符与路径），连同字节数、换行数、结尾与是否到了 64 MiB；`take` 交回之后暂存归接手的一方。`prepare` 失败或 `take` 抛错时 `discard()`、留在前台，暂存仍归套件、命令结束时照常删掉，失败的原因写进前台的结果。代码里调的不转。

## 状态与转换

本接口不引入持久状态。

时序与寿命：

- 一份 `SessionFiles` 属于建它时的会话上下文。会话换 Profile 或主项目后，旧对象交回的结果仍按旧上下文；调用方按新上下文向工厂重新取，不保留旧对象。
- `call` 交回的对象在这次工具调用结束后不再使用；调用的 `signal` 触发之后，经它的写一律为 `cancelled`。
- `read` 交回的基线在下一次写入成功之前一直可用作 `expect`。
- 并发写同一目标时谁赢由宿主的写锁定（NeuroBook 见 [`workspace/resources.md`](../workspace/resources.md) 的暂存与提交）；本机参考实现不加锁，不承诺并发写的结果。

## 副作用与数据

- 写入、文件与全文的落点由宿主定；本接口只要求写入可按调用区分（输出 8），全文与会话的写分开（输出 11）。
- `readPath` 交回的路径只读；套件在它上面做的搜索不改磁盘。

## 失败与恢复

| 码 | 含义 | 调用方怎么办 |
|---|---|---|
| `not-found` | 资源不存在 | 改地址或先建 |
| `unknown-scheme` | 没有这个方案 | 不重试 |
| `unsupported-capability` | 这个位置不支持该操作（例如虚拟根的本机路径、只读方案的写） | 不重试 |
| `invalid-address` | 地址或路径不合法，或 `save` 的 `label` 不是单段 | 修正地址 |
| `protected-path` | 不露出的位置 | 不重试 |
| `outside-root` | 解析后落在根外 | 不重试 |
| `not-a-file`、`not-a-directory` | 种类不符 | 换方法或地址 |
| `permission-denied` | 不许写这个位置，或写虚拟根 | 不重试 |
| `conflict` | 写的 `expect` 与当前内容不符 | 重读再写 |
| `too-large` | 超过宿主的读上限 | 不整份读 |
| `cancelled` | 调用的 `signal` 在提交之前触发 | 不重试 |

其余码由宿主定，套件原样交给模型。

## 边界与兼容

- 公开入口：`@notnotype/nb-harness/kit/files`（接口类型与几个纯函数，浏览器可用，不引 node）；`@notnotype/nb-harness/kit/files/local`（本机参考实现，给套件自己的测试与没有文件服务的宿主参考）；`@notnotype/nb-harness/kit/testing`（参数化的合同测试，宿主用它核对自己的实现）。
- 宿主的实现只在宿主的进程里用，不交给别的插件：能代表会话读写的对象不出宿主。
- 新增失败码只追加；已有码的含义不变。

## 验收与 Smoke

1. 同一份合同测试由本机参考实现与 NeuroBook 的实现各跑一遍，覆盖输出 1 到 7、9、11 与两个宿主都有的失败码；虚拟根与不露出的位置只对有它们的宿主跑。按调用分组的记录（输出 8）、读上限与布局的取值（输出 10）合同测试看不到，由各宿主自己的测试核对。
2. 经 `call` 写入的两次调用，在宿主的记录里分属两次调用；同一次调用里的两次写属于同一次调用。
3. 调用的 `signal` 已经触发后经它写：结果为 `cancelled`，目标保持原样。

Smoke：`@notnotype/nb-harness/kit/testing` 的合同测试对本机参考实现跑一遍。

## 实现合同

- **公开入口**：`@notnotype/nb-harness/kit/files`（本 Spec 的接口类型、`KNOWN_FILE_FAILURES`、内核读取端口的适配 `kernelResources` 与几个地址纯函数）、`@notnotype/nb-harness/kit/files/local` 的 `localFiles`、`@notnotype/nb-harness/kit/testing` 的 `sessionFilesContract(name, setup)`。
- **owner 与依赖方向**：nb-harness 定接口、本机参考实现与合同测试，不依赖任何宿主。NeuroBook 的实现在 `nbook.agent`，建在 `nbook.files` 的写入接口上（暂存、提交、改动记录与来源都在那一层，[ADR 0040](../../adr/0040-file-writes-staged-and-committed-by-root-owner.md)）；工厂只在 `nbook.agent` 内部传给套件，不经 `AgentService` 交给别的插件。
- **关键不变量**：
  - `kit/files` 入口没有运行时导入，浏览器可用（nb-harness 的 `kit/architecture.test.ts`）。
  - 合同测试按夹具参数化：宿主没给虚拟根或不露出的位置时，对应用例不跑；按调用分组的记录合同测试看不到，宿主要自己测（NeuroBook 的 `resources.test.ts`“验收 6”与“host-kit 输出 8、验收 2”）。
  - NeuroBook 的分组在一次调用第一次写时建一次，这次调用的写入共用，两次调用各一组（同上两条）。
  - NeuroBook 的 `classify` 与方案的写授权是两份判断，宿主写的位置在两处各列一份：改一处要同改另一处，合同测试“输出 3、6”与“输出 11”核对两者一致。
  - 宿主写全文不带会话身份，落在会话 home 的 `artifacts/` 下，会话读得到、写不了；写入函数抛错时连写了一半的文件也不留（合同测试“输出 11”）。

## 证据

- 批准依据：[w00032 t32](../../../.agents/works/w00032-agent-integration/tasks/t32-harness-backfill/README.md) 的“决定”（开发者 2026-11-09 同意补回 nb-harness，2026-11-10 定公开子路径）、[ADR 0035](../../adr/0035-harness-log-driven-kernel.md)、[ADR 0040](../../adr/0040-file-writes-staged-and-committed-by-root-owner.md)
- 实现入口：[`kit/files/index.ts`](../../../packages/nb-harness/src/kit/files/index.ts)（接口与共用函数）、[`kit/files/local.ts`](../../../packages/nb-harness/src/kit/files/local.ts)（本机参考实现）、[`kit/testing/files-contract.ts`](../../../packages/nb-harness/src/kit/testing/files-contract.ts)（合同测试）；NeuroBook 的实现在 [`backend/resources.ts`](../../../packages/neuro-book/src/plugins/agent/backend/resources.ts)
- 合同测试：[`kit/files/local.test.ts`](../../../packages/nb-harness/src/kit/files/local.test.ts)（本机参考实现）、[`resources.test.ts`](../../../packages/neuro-book/src/plugins/agent/resources.test.ts)（NeuroBook 的实现，经真实插件宿主）、[`kit/files/kernel-resources.test.ts`](../../../packages/nb-harness/src/kit/files/kernel-resources.test.ts)；布局的取值经真实工具核对：[`builtin-tools.test.ts`](../../../packages/neuro-book/src/plugins/agent/builtin-tools.test.ts)、[`builtin-tools-project.test.ts`](../../../packages/neuro-book/src/plugins/agent/builtin-tools-project.test.ts)（工作目录与环境变量）、[`modes.test.ts`](../../../packages/neuro-book/src/plugins/agent/modes.test.ts)（只写草稿）、[`auto-review.test.ts`](../../../packages/neuro-book/src/plugins/agent/auto-review.test.ts)（`auto` 下不问的写）
- Smoke：[`kit/files/local.test.ts`](../../../packages/nb-harness/src/kit/files/local.test.ts)（对本机参考实现跑整份合同测试）
