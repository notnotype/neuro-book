---
schema: nbook.spec/v1
kind: behavior
status: implemented
capability: storage.persistence
owners:
  - nbook.storage
  - runtime
---

# Storage：插件记录的持久化

## 目标与非目标

内置插件 `nbook.storage` 让插件记住“程序替用户记住的东西”（布局尺寸、展开的目录、视图定制、最近使用的对象）。插件按**记录**声明要持久化的数据；记录分 user、project 两个分区，落在拥有该分区的内核实例里；浏览器窗口不存数据，同样的接口转给分区的拥有者。

不承诺：

- 备份恢复、项目 ZIP 导出、配额、记录格式的迁移函数、删除标记回收、登录后的使用主体、跨设备同步。
- 两个服务端进程同时打开同一项目时，它们之间的变更通知。
- session / window 作用域（刷新后要保留的状态放进 URL）；大文件。
- 权限沙箱：命名空间防误用，不防恶意的受信代码（[ADR 0022](../../adr/0022-extensible-platform-and-plugin-trust.md)）。
- 记录怎样投影到界面（已确认值、当前显示、本地意图）：归插件状态 store。
- 旧应用的 Storage 数据：不兼容，不迁移。

## 术语与参与者

- **记录定义**：插件共享模块里 `defineRecord({...})` 的结果，三端共用同一份。
- **owner**：记录所属插件的 id。按插件划分命名空间，不按入口。
- **scope**：`user`（随用户）或 `project`（随项目目录）。**locality**：`local`（每个客户端一份，缺省）或 `shared`（同一 owner、同一 scope 共用一份）。
- **客户端身份**：客户端实例跨重新加载稳定的标识，同一浏览器配置的标签页共用一个（[`runtime.browser-host`](../runtime/browser-host.md)）；服务端与项目实例没有。
- **分区拥有者**：user 分区归服务端实例，project 分区归该项目当前的项目实例（[`runtime.projects`](../runtime/projects.md)）。
- **revision**：每次写入或删除得到的新标识；对插件不透明，分区内单调递增、不复用、不保证连续。
- **version**：记录定义的版本，正整数。
- **删除标记**：删除后留下、带新 revision 的空记录。

## 输入与前置条件

### 记录定义

```ts
export const sizesRecord = defineRecord({
    key: "layout-sizes", scope: "project", locality: "local", version: 1,
    schema: Type.Object({sidebar: Type.Number(), panel: Type.Number()}, {additionalProperties: false}),
    keyed: false, maxBytes: 64 * 1024,
});
```

| 字段 | 规则 |
|---|---|
| `key` | 1–64 个字符，`[a-z0-9]` 开头，其余为 `[a-z0-9.-]` |
| `scope`、`locality` | 见术语；`locality` 缺省 `local` |
| `version` | 正整数 |
| `schema` | 顶层为对象且 `additionalProperties: false` 的 TypeBox schema |
| `keyed` | 缺省 `false`；`true` 时按资源 id 寻址，一个资源 id 一条记录 |
| `maxBytes` | 值的 JSON 文本按 UTF-8 计的上限，1 到 1 MiB，缺省 64 KiB |

- 不合规则的定义在模块加载时抛 `TypeError`。
- 资源 id：`keyed: true` 时必填，1–128 个字符，`[a-z0-9]` 开头，其余为 `[a-z0-9._-]`；`keyed: false` 时不得给出。
- 值必须是 JSON 能如实表示的数据（规则同 [远程服务与 RPC 协议](../runtime/plugin-channel.md) 的帧编码），并符合 schema。

### 接口

插件在入口的 `dependencies` 里声明 `nbook.storage` 的服务键 `storageKey`（从 `nbook.storage` 的 `shared/contracts.ts` 引用），解析得到按调用方生成的服务对象：

```ts
interface StorageService {
    open<T>(record: RecordDefinition<T>, resource?: string): Promise<OpenResult<T>>;
}
type OpenResult<T> = {ok: true; handle: RecordHandle<T>} | {ok: false; code: StorageFailure; detail: string};
interface RecordHandle<T> {
    read(): Promise<RecordSnapshot<T>>;
    save(value: T, options: {readonly expect: Revision | null}): Promise<WriteResult>;
    remove(options: {readonly expect: Revision | null}): Promise<WriteResult>;
    reset(value: T, options: {readonly expect: Revision | null}): Promise<WriteResult>;
    subscribe(listener: (snapshot: RecordSnapshot<T>) => void, options?: {onEnd?(reason: string): void}): Promise<SubscribeResult>;
}
type RecordSnapshot<T> =
    | {status: "missing"; revision: Revision | null}
    | {status: "ok"; value: T; revision: Revision}
    | {status: "corrupt" | "unsupported-version"; revision: Revision; detail: string}
    | {status: "error"; code: StorageFailure; detail: string};
type WriteResult = {ok: true; revision: Revision} | {ok: false; code: StorageFailure; detail: string};
type SubscribeResult = {ok: true; handle: {release(): void}} | {ok: false; code: StorageFailure; detail: string};
```

方法都返回 Promise，不抛出业务失败。

### 在哪里能打开什么

| 调用方所在 | user 记录 | project 记录 | `local` 记录 |
|---|---|---|---|
| 服务端实例 | 可以 | `no-project`（经插件自己的项目入口访问） | `no-client` |
| 项目实例 | 可以（转给服务端） | 本项目代次的 | `no-client` |
| 浏览器窗口 | 可以（转给服务端） | 窗口绑定的项目代次的；没有绑定为 `no-project` | 本窗口的客户端身份那一份 |

调用方必须是插件入口，否则为 `denied`。

## 输出与可观察行为

1. **打开**：核对上表与资源 id 规则，在分区拥有者处打开分区库、登记这条记录的定义；不读值、不写默认值。三端都在 `open` 报告 `no-project`、`no-client`、`denied`、`invalid-resource`、`definition-conflict`，以及库打不开的 `unavailable`、`busy`、`io-error`。
2. **定义冲突**：分区拥有者记下每个 `(owner, key)` 第一次打开时的定义（`{key, scope, locality, version, keyed, maxBytes, schema}`，逐层按键排序比较）。同一次运行里再以不同定义打开或操作，为 `definition-conflict`（客户端外壳比服务端旧时出现，提示刷新）。登记不落库：拥有者重启后以新定义为准。
3. **读取分类**：`missing`（从未写过，revision 为 `null`；或删除标记）、`ok`（版本相同、能解析、符合 schema）、`corrupt`（不能解析或不符合 schema）、`unsupported-version`（版本不同，高低都算）、`error`（读取失败，不当作缺失）。值都先校验再交出；一条坏记录不影响别的记录与插件。
4. **条件保存**：`save` 只在当前 revision 等于 `expect` 时写入（从未写过为 `null`），成功返回新 revision。删除标记的 revision 不是 `null`，所以持有 `null` 或旧 revision 的保存不能复活已删除的值。
5. **删除与重置**：`remove` 同样以 revision 为条件，留下删除标记。`reset` 以 revision 为条件写入新值；当前是 `corrupt` 或 `unsupported-version` 时先把原件保存进原件区（每个分区最多 64 份、合计 4 MiB，满了为 `originals-full`），对其它状态与 `save` 相同。对 `corrupt`、`unsupported-version` 做 `save`、`remove` 为 `protected`。
6. **订阅**：先推一次当前快照，之后推送分区拥有者进程里对同一条记录（owner、键、资源 id、客户端分区）的每次写入，按写入顺序送达；只推当前状态，不重放每个中间值。
7. **命名空间**：owner 取内核填写的调用方身份里的插件，经代理时也是原插件；`local` 记录另按调用方的客户端身份分开。插件之间的同名记录互不可见；同一客户端身份的两个窗口共用一份 `local` 记录。接口上没有 owner、客户端或项目参数，插件无法指定别人的命名空间。

## 状态与转换

一条记录（owner、键、资源 id、客户端分区）：

| 当前 | 操作 | 结果 |
|---|---|---|
| 任意 | `expect` 与当前 revision 不同 | `conflict`，不变 |
| 从未写过、删除标记、`ok` | `save` 或 `reset` | `ok`，新 revision |
| `ok`、`missing` | `remove` | 删除标记，新 revision |
| `corrupt`、`unsupported-version` | `save`、`remove` | `protected`，不变 |
| `corrupt`、`unsupported-version` | `reset` | 原件进原件区，`ok`，新 revision |

**并发**：同一 revision 的两次写入至多一次成功，不论来自同一进程、两个窗口还是两个打开同一个库的进程；另一次为 `conflict`。

**时序与寿命**（调用方可以依赖）：

- 句柄在服务对象释放后失效：之后的操作为 `unavailable`，它建立的订阅以 `onEnd("released")` 结束。服务对象随调用方入口的这一代释放。
- 订阅结束时调用一次 `onEnd(原因)`：分区拥有者的 `nbook.storage` 入口停止为 `provider-stopped`；窗口绑定的项目代次结束、服务端已换进程，按 [远程服务与 RPC 协议](../runtime/plugin-channel.md) 的规则在窗口重连时以 `project-gone`、`server-restarted` 结束。调用方自己 `release` 不调用 `onEnd`。
- 断线后连回同一服务端进程、同一项目代次时，订阅自动重建，重建后先收到当时的快照；断线期间的写入不逐条补发。
- 经代理的写入在派发后断线为 `unknown-outcome`：调用方重读后按 revision 判断是否写入，不会被自动重放。
- 两个服务端进程交替写同一个库时，一方的订阅收不到另一方的写入，看到的 revision 会跳跃；不能用“不连续”判断漏收。

## 副作用与数据

- **落点**：user 分区 `<状态根>/storage/user.sqlite`；project 分区 `<项目目录>/.nbook/storage.sqlite`。运行中另有同名的 `-wal`、`-shm` 文件；目录不存在时创建。project 分区随项目目录移动、复制；项目放在 Git 里时需要忽略 `.nbook/storage.sqlite*`。
- **格式**：每个分区一个 SQLite 库，库格式版本 1。没有任何表的库（含空文件）当作新库初始化；其余文件必须带本插件认识的格式版本，否则（不是 SQLite、别的应用的库、缺格式标记、版本不认识）该分区的操作为 `io-error`，不改写、不删除这个文件。
- **寿命**：分区库在第一次使用时打开；拥有它的 `nbook.storage` 入口停止（服务端或项目子进程停止）时关闭，之后的操作为 `unavailable`。切换项目、组件卸载、插件禁用都不删除记录。

## 失败与恢复

| 失败码 | 含义 | 调用方怎么办 |
|---|---|---|
| `conflict` | revision 已变 | 重读后决定是否重放 |
| `invalid-value` | 值不符合 schema 或无法编码 | 修正值 |
| `too-large` | 值超过 `maxBytes` | 缩小值 |
| `protected` | 对 `corrupt`、`unsupported-version` 做普通保存或删除 | 用 `reset` |
| `originals-full` | 原件区已满，拒绝重置 | 报告给用户 |
| `definition-conflict` | 同名记录的定义与已登记的不同 | 提示刷新 |
| `no-client` | `local` 记录在没有客户端身份的位置打开 | 改用 `shared` 或换位置 |
| `no-project` | project 记录在没有项目分区可用的位置打开 | 经项目入口 |
| `invalid-resource` | 资源 id 与 `keyed` 不符或不合规则 | 修正调用 |
| `denied` | 调用方不是插件入口 | — |
| `busy` | 2 秒内等不到库锁（别的进程正在写同一个库） | 稍后重试 |
| `io-error` | 库无法读写，或格式不认识 | 报告给用户；库文件不被覆盖 |
| `unavailable` | 分区已关闭、项目代次已结束、服务端不可达 | 等宿主恢复或刷新 |
| `unknown-outcome` | 经代理的写请求派发后中断 | 重读后按 revision 判断 |

一个分区出错只影响该分区；读取失败返回 `error` 快照，调用方在读取成功前不应写入默认值。

## 边界与兼容

- **owner**：`nbook.storage` 拥有记录、分区库与三端入口；内核提供按调用方的服务对象、调用方的客户端身份与跨实例委托（[`runtime.services`](../runtime/services.md)、[远程服务与 RPC 协议](../runtime/plugin-channel.md)）。
- **公开接口**：`defineRecord` 的字段、`StorageService` 与失败码。远程服务 `nbook.storage/user`、`nbook.storage/project` 是本插件三端之间的协议，不是给别的插件的接口；别的插件直接调用它们，也只到自己的命名空间。
- **别的插件的数据**：不经 Storage 读取，经拥有者插件自己的服务。
- **已知限制**：两个标签页在同一瞬间首次打开时可能各得一个客户端身份，`local` 记录分成两份；库放在网络盘上可能不可靠；Windows 与 macOS 未实测。

## 验收与 Smoke

1. **同一命名空间**：服务端插件 X 写 user 记录，浏览器里的 X 读到同一值，反之亦然；项目实例里的 X 写 project 记录，浏览器里的 X 读到同一值；项目实例里的 X 读到服务端写的 user 记录。
2. **插件隔离**：A、B 的同名记录互不可见；B 直接调用远程服务也只读到自己的。
3. **客户端分区与位置**：两个客户端身份各一份 `local` 记录，同一客户端的两个窗口共用；服务端与项目实例打开 `local` 记录为 `no-client`；服务端插件与没有绑定项目的窗口打开 project 记录为 `no-project`。
4. **条件保存**：同一 revision 的两次保存一次成功、一次 `conflict`；删除后持有旧 revision 或 `null` 的保存为 `conflict`；两个进程以同一 revision 写同一个库，恰好一个成功；别的进程占着库锁超过上限时为 `busy`。
5. **读取分类与重置**：缺失、正常、坏 JSON、schema 不符、版本不同各一例；库文件不是 SQLite、是别的应用的 SQLite 库、格式版本不认识时 `open` 与读写都为 `io-error` 且文件不变；`corrupt` 时 `save` 为 `protected`，`reset` 保存原件后写入；原件区满时 `originals-full`。
6. **定义与值**：不合规则的定义加载时抛错；只差 schema 的两份定义被判为不同；同名不同定义为 `definition-conflict`；资源 id 不合为 `invalid-resource`；超限为 `too-large`，不符合 schema 为 `invalid-value`。
7. **订阅**：先收到当前快照（经服务端转发订阅项目实例里的 project 记录也一样），再收到服务端与另一个窗口的写入；监听里再写同一条记录时，每个订阅仍按写入顺序收到；断线后连回同一服务端，订阅先收到断线期间写入后的快照、不结束；窗口绑定的项目代次结束后，窗口重连时订阅以 `project-gone` 结束；项目再次打开后新代次读到磁盘上的值。
8. **寿命**：服务端停止后 user 分区关闭，已打开的句柄为 `unavailable`；项目子进程退出前关闭 project 分区；一条订阅的 `onEnd` 抛错时，其余订阅照样结束、库照样关闭。

Smoke：`smoke:server` 经打包产物保存、读回一条 user 记录，重启后读到同一个值；`e2e/storage.e2e.ts` 在本机 Chrome 里覆盖场景 3、4、7 与项目记录跨窗口共享。

## 实现合同

- **公开入口**：`nbook/shared/storage`（`defineRecord`、`StorageService`、`RecordHandle`、`RecordSnapshot`、`WriteResult`、`STORAGE_FAILURES`）；`nbook/plugins/storage/shared/contracts` 的 `storageKey` 与远程合同 `userStorageContract`、`projectStorageContract`；插件定义 `storageBackendPlugin`（服务端与项目两个入口，代码相同；user 库在宿主能力 `stateRootKey` 给出的状态根下的 `storage/user.sqlite`，project 库在 `currentProjectKey.root` 下的 `.nbook/storage.sqlite`）与 `storageBrowserPlugin`。
- **owner 与依赖方向**：`nbook.storage` 依赖内核的按调用方门面、远程服务与跨实例委托（`remoteDelegates`、`context.remote.on`），服务端与项目入口依赖 `nbook.diagnostics` 与给出库文件位置的宿主能力（宿主没有提供时入口按 `missing-service` 受阻），浏览器入口依赖窗口的项目绑定；分区库直接用 `bun:sqlite`。别的插件只依赖 `storageKey`，不依赖分区库与远程合同。
- **关键不变量**：
  - 分区库只在拥有它的实例里打开；别的实例经远程服务到达，拥有者按内核填写的调用方身份取 owner 与客户端身份，不信任输入里的身份（场景 1、2）。
  - 先认库再改库：只有一张表都没有的库才在写锁里再认一次并建表，其余文件为 `io-error` 且不改写（输出 1、场景 5）。
  - 条件写入在 `BEGIN IMMEDIATE` 事务里比较 revision 再写；通知在提交之后按提交顺序排队派发，监听跳过已收到的 revision，派发途中被停掉的监听不再收到（场景 4、7）。
  - 一条订阅至多结束一次，结束早于建立返回时不登记为活订阅；服务对象释放与分区关闭逐条隔离 `onEnd` 的异常，全部收口后再报告第一个（场景 7、8）。

## 证据

- 批准依据：[插件的数据与状态](../../proposals/plugin-data-model.md) 第 5 节、[多实例运行时拓扑](../../proposals/multi-instance-runtime-topology.md) 第 4、11 节、[ADR 0024](../../adr/0024-multi-instance-runtime-topology.md)；介质与旧机制的取舍见 [t55 实施计划](../../../.agents/works/w00017-application-runtime-architecture/tasks/t55-plugin-storage/plan.md) 的“待确认”（开发者 2026-10-07 确认）。
- 实现入口：[`packages/neuro-book/src/plugins/storage/backend/plugin.ts`](../../../packages/neuro-book/src/plugins/storage/backend/plugin.ts)、[`web/plugin.ts`](../../../packages/neuro-book/src/plugins/storage/web/plugin.ts)、[`src/shared/storage.ts`](../../../packages/neuro-book/src/shared/storage.ts)
- 合同测试：[`storage.test.ts`](../../../packages/neuro-book/src/plugins/storage/storage.test.ts)、[`project-child.test.ts`](../../../packages/neuro-book/src/plugins/storage/project-child.test.ts)、[`partition.test.ts`](../../../packages/neuro-book/src/plugins/storage/backend/partition.test.ts)、[`owner.test.ts`](../../../packages/neuro-book/src/plugins/storage/backend/owner.test.ts)、[`storage.test.ts`（记录定义）](../../../packages/neuro-book/src/shared/storage.test.ts)
- Smoke：[`smoke-server.ts`](../../../packages/neuro-book/scripts/smoke-server.ts)（S8）、[`storage.e2e.ts`](../../../packages/neuro-book/e2e/storage.e2e.ts)
