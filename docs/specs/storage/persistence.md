---
schema: nbook.spec/v1
kind: behavior
status: planned
capability: storage.persistence
owners:
  - nbook.storage
  - runtime
---

# Storage：插件记录的持久化

2026-10-07 按 [插件的数据与状态](../../proposals/plugin-data-model.md) 第 5 节、[多实例运行时拓扑](../../proposals/multi-instance-runtime-topology.md) 第 4、11 节（均 `accepted`）与开发者确认的 [t55 实施计划](../../../.agents/works/w00017-application-runtime-architecture/tasks/t55-plugin-storage/plan.md) 原地改写。旧应用时期的合同（每条记录一个 JSON 文件、分区锁、身份域、访问上下文、轮询、配额、删除标记回收与旧数据迁移）不再适用，哪些废弃、哪些推迟见“边界与兼容”；旧应用的实现在 `packages/neuro-book-legacy/server/storage/`，只作参照。

## 目标与非目标

内置插件 `nbook.storage` 让插件记住“程序替用户记住的东西”：布局尺寸、展开的目录、视图定制、最近使用的对象。插件按**记录**声明要持久化的数据；记录按 user / project 分区，落在拥有该分区的内核实例里；浏览器窗口不存数据，同样的接口经远程服务转给分区的拥有者。读写有条件保存与订阅，读到的值先分类再交给插件。

明确不承诺：

- 不做备份恢复、项目 ZIP 导出、删除标记回收与分区代次、配额、记录格式的迁移函数、登录后的使用主体（身份域）、跨设备同步。
- 两个服务端进程同时打开同一项目时，不提供它们之间的变更通知。
- 不做 session / window 作用域：本标签页刷新后要保留的状态放进 URL；大文件不进记录。
- 不是权限沙箱：命名空间防误用，不防恶意的受信代码（[ADR 0022](../../adr/0022-extensible-platform-and-plugin-trust.md)）。
- 不规定消费方怎样把记录投影到界面（已确认值、当前显示与本地意图）：四部分状态模型归插件状态 store（K5，[插件的数据与状态](../../proposals/plugin-data-model.md) 第 3 节），布局专属的保存时机与冲突重放归工作台外壳的布局 Spec。
- 不定义插件私有目录与文件；它们随资源寻址与文件服务另定。

## 术语与参与者

- **记录定义**：插件共享模块里 `defineRecord({...})` 的结果，三端共用同一份。字段见“输入与前置条件”。
- **owner**：记录所属插件的 id。命名空间按插件划分、不按入口：同一插件的任何入口都读写同一份记录。
- **键与资源 id**：键是记录定义的名字；`keyed: true` 的定义按资源 id 寻址，一个资源 id 一条记录（例如按任务 id）。
- **scope**：`user`（跨项目，随用户）或 `project`（随项目目录）。
- **locality**：`local`（按客户端分开，一个客户端一份）或 `shared`（同一 owner、同一 scope 内共用一份）。缺省 `local`。
- **客户端身份**：客户端实例跨重新加载稳定的标识（浏览器存在本地存储里，[`runtime.browser-host`](../runtime/browser-host.md)）；同一浏览器配置的多个标签页共用一个。服务端与项目实例没有客户端身份。
- **分区**：一个 scope 的全部记录。user 分区归服务端实例；project 分区归该项目当前的项目实例（[`runtime.projects`](../runtime/projects.md)）。
- **分区拥有者**：打开分区库、执行读写的那个实例里的 `nbook.storage` 入口。
- **revision**：一条记录每次写入或删除得到的新标识。对插件是不透明字符串；在分区内单调递增、不复用，但不保证连续。
- **version**：记录定义的版本，正整数；记录格式或解释改变时提升。
- **描述与指纹**：记录定义去掉插件私有部分后的规范 JSON（见输出第 2 条）；分区拥有者用它判断两份定义是否相同。
- **删除标记**：删除后留下的行，带新的 revision、没有值；防止持有旧 revision 的保存把值复活。
- **原件区**：显式重置前保存被替换的原始内容，供诊断。
- **代理**：浏览器（以后的 TUI）里的 `nbook.storage` 入口，以原调用插件的身份把操作转给分区拥有者（[`runtime.services`](../runtime/services.md) 的委托与 [远程服务与 RPC 协议](../runtime/plugin-channel.md) 的经代理调用）。

## 输入与前置条件

### 记录定义

```ts
export const sizesRecord = defineRecord({
    key: "layout-sizes",
    scope: "project",
    locality: "local",
    version: 1,
    schema: Type.Object({sidebar: Type.Number(), panel: Type.Number()}, {additionalProperties: false}),
    keyed: false,
    maxBytes: 64 * 1024,
});
```

| 字段 | 规则 |
|---|---|
| `key` | 1–64 个字符，`[a-z0-9]` 开头，其余为 `[a-z0-9.-]` |
| `scope` | `user` 或 `project` |
| `locality` | `local` 或 `shared`，缺省 `local` |
| `version` | 正整数 |
| `schema` | TypeBox schema，顶层为 `type: "object"` 且 `additionalProperties: false` |
| `keyed` | 布尔，缺省 `false` |
| `maxBytes` | 值的 JSON 文本按 UTF-8 计的字节上限，1 到 1 MiB 之间的整数，缺省 64 KiB |

- `defineRecord` 在模块加载时校验以上规则，不合法时抛 `TypeError`；返回冻结对象。定义在 `src/shared/storage.ts`，因为每个插件都要在运行时调用它，而插件之间只允许 `import type`。
- 资源 id：`keyed: true` 时必填，1–128 个字符，`[a-z0-9]` 开头，其余为 `[a-z0-9._-]`；`keyed: false` 时不得给出。
- 值必须是 JSON 能如实表示的数据（与 [远程服务与 RPC 协议](../runtime/plugin-channel.md) 的帧编码同一规则），并符合 schema。

### 接口

插件依赖 `nbook.storage` 导出的服务键（由装配者交给插件工厂），解析得到按调用方生成的服务对象：

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

所有方法返回 Promise，不抛出业务失败（[`runtime.plugin-api`](../runtime/plugin-api.md) 的远程形态约束）。

### 在哪里能打开什么

| `nbook.storage` 的入口 | 位置 | 拥有的分区 | user 记录 | project 记录 | `local` 记录 |
|---|---|---|---|---|---|
| `server` | 服务端实例 | user | 直接读写 | `no-project`（服务端插件要碰项目数据，经自己的项目入口） | `no-client` |
| `project` | 项目实例 | 本项目代次的 project | 经远程服务 `nbook.storage/user` 转给服务端 | 直接读写 | `no-client` |
| `browser` | 浏览器窗口 | 无 | 经 `nbook.storage/user` 转给服务端 | 经 `nbook.storage/project` 转给窗口绑定的项目代次；没有绑定为 `no-project` | 按本窗口的客户端身份 |

调用方必须是插件入口；宿主能力、门禁这类非插件调用方得到 `denied`。

## 输出与可观察行为

1. **打开。** `open` 核对本位置能不能用这条记录（上表、资源 id 规则），并在分区拥有者处登记记录描述。失败码：`no-project`、`no-client`、`denied`、`invalid-resource`、`definition-conflict`，以及 `unavailable`、`busy`、`io-error`。三端在同一处报告这些失败；成功得到句柄。打开不读值、不写默认值。
2. **描述与定义冲突。** 描述是 `{key, scope, locality, version, keyed, maxBytes, schema}` 每一层对象都按键排序后的 JSON。分区拥有者为每个 `(owner, key)` 在内存里记下第一次打开时的描述；之后描述不同的打开与操作得到 `definition-conflict`（同一次运行里两个版本的代码，或客户端外壳比服务端旧），客户端据此提示刷新。描述不落库：拥有者重启或入口重新激活后，以新代码的定义为准，库里旧版本的值按第 3 条分类。第一版每次远程操作都带完整描述；以后可改为登记后只带指纹。
3. **读取分类。** `read` 返回：
   - `missing`：没有这一行（`revision` 为 `null`），或是删除标记（`revision` 为删除标记的 revision）。
   - `ok`：版本与定义相同，JSON 可解析且符合 schema。
   - `corrupt`：JSON 无法解析或不符合 schema。
   - `unsupported-version`：库里的版本与定义不同（高于或低于）。
   - `error`：读取失败（`busy`、`io-error`、`unavailable` 等），不当作缺失。
   读到的值都先校验再交给调用方。一条坏记录不影响别的记录与别的插件。
4. **条件保存。** `save(value, {expect})` 只在记录当前的 revision 等于 `expect` 时写入（从未写过为 `null`；删除标记的 revision 不是 `null`，所以持有 `null` 的保存不能越过删除），成功返回新 revision。值不符合 schema 或无法编码为 `invalid-value`，超过 `maxBytes` 为 `too-large`，revision 已变为 `conflict`，当前是 `corrupt` 或 `unsupported-version` 为 `protected`。同一 revision 的两次保存至多一次成功，不论来自同一进程还是两个打开同一个库的进程。
5. **删除。** `remove({expect})` 同样以 revision 为条件，写入带新 revision 的删除标记；对 `corrupt`、`unsupported-version` 为 `protected`。
6. **重置。** `reset(value, {expect})` 以 revision 为条件写入新值；当前是 `corrupt` 或 `unsupported-version` 时，先把原件（原始文本与版本）写进原件区再替换。原件区每个分区最多 64 份、合计 4 MiB，满了拒绝重置（`originals-full`），不清旧原件。对其它状态与 `save` 相同。
7. **订阅。** `subscribe` 先推一次当前快照，之后分区拥有者进程里对同一 owner、键、资源 id、客户端分区的每次写入推送新快照；同一订阅内按写入顺序送达。订阅表示当前状态，不重放每个中间值。订阅随调用方的门面释放、调用方入口停止、分区拥有者的入口停止、绑定的项目代次结束或断线结束，`onEnd` 收到原因；连回同一服务端进程、同一项目代次时订阅重建，重建后先收到当时的快照。
8. **命名空间与客户端分区。** owner 取调用方身份里的插件（经代理时是原插件，不是 `nbook.storage`）；`local` 记录另按调用方身份里的客户端身份分开。两个插件的同名键互不可见；同一客户端身份的两个窗口共用一份 `local` 记录，两个客户端身份各一份；本地直用与经代理访问同一个命名空间。
9. **经代理的访问。** 浏览器里插件 X 的操作由 `nbook.storage` 的浏览器入口以 X 的身份转给分区拥有者；拥有者看到的调用方是 X，另附代理身份。调用方身份（含客户端身份）由内核填写，业务参数里没有 owner、客户端或项目字段。
10. **写请求结果未知。** 经代理的写请求在派发后链路中断时得到 `unknown-outcome`（[远程服务与 RPC 协议](../runtime/plugin-channel.md) 输出第 4 条）；调用方重读后按 revision 判断是否已写入，内核不重放。

## 状态与转换

以一条记录（owner、键、资源 id、客户端分区）为单位：

| 当前 | 操作 | 结果 |
|---|---|---|
| 从未写过（`missing`，revision `null`） | `save`/`reset` 带 `expect: null` | `ok`，新 revision |
| 任意 | 带的 `expect` 与当前 revision 不同 | `conflict`，记录不变 |
| `ok` | `save`/`reset` | `ok`，新 revision |
| `ok`、`missing` | `remove` | 删除标记（`missing`），新 revision |
| 删除标记 | `save`/`reset` 带删除标记的 revision | `ok`，新 revision |
| `corrupt`、`unsupported-version` | `save`、`remove` | `protected`，记录不变 |
| `corrupt`、`unsupported-version` | `reset` | 原件进原件区，`ok`，新 revision |

条件检查与写入在同一个数据库事务里完成。revision 在分区内单调递增：两个进程交替写同一个库时，订阅看到的 revision 会跳过另一个进程写入的值，订阅方不能用“不连续”判断漏收。

## 副作用与数据

- **落点**：user 分区 `<状态根>/storage/user.sqlite`；project 分区 `<项目目录>/.nbook/storage.sqlite`。运行中另有 SQLite 的 `-wal`、`-shm` 文件。目录不存在时创建。
- **库**：每个分区一个 SQLite 库，WAL 模式；表 `records`（owner、键、资源 id、客户端身份、revision、version、值、更新时间，主键为前四项）、`originals`（原件区）、`meta`（库格式版本、下一个 revision）。库格式版本是 1；遇到不认识的版本，分区的操作为 `io-error`，不改写这个库。
- **事务**：条件保存、删除与重置都在 `BEGIN IMMEDIATE` 事务里读 revision、比较、写入；等锁上限 2 秒，等不到为 `busy`（可以重试）。不另加目录锁。
- **生命周期**：分区库在第一次使用时打开；`nbook.storage` 的入口停止时先停止接纳新操作，等在途操作结算，再关闭库。项目子进程停止即关闭 project 分区。切换项目、组件卸载、插件禁用都不删除记录。
- **随项目目录走**：project 分区在项目目录里，项目移动或复制时随目录携带。项目放在 Git 里的用户需要忽略 `.nbook/storage.sqlite*`。

## 失败与恢复

| 失败码 | 含义 | 调用方怎么办 |
|---|---|---|
| `conflict` | revision 已变 | 重读后决定是否重放 |
| `invalid-value` | 值不符合 schema 或无法编码 | 修正值 |
| `too-large` | 值超过 `maxBytes` | 缩小值 |
| `protected` | 对 `corrupt`、`unsupported-version` 做普通保存或删除 | 用 `reset` |
| `originals-full` | 原件区已满，拒绝重置 | 报告给用户 |
| `definition-conflict` | 同名记录的描述与已登记的不同 | 提示刷新 |
| `no-client` | `local` 记录在没有客户端身份的位置打开 | 改用 `shared` 或换位置 |
| `no-project` | project 记录在没有项目分区可用的位置打开 | 经项目入口 |
| `invalid-resource` | 资源 id 与 `keyed` 不符或不合规则 | 修正调用 |
| `denied` | 调用方不是插件入口 | — |
| `busy` | 2 秒内等不到库锁 | 稍后重试 |
| `io-error` | 库无法读写或格式版本不认识 | 报告给用户；库文件不被覆盖 |
| `unavailable` | 分区已关闭、项目代次已结束、服务端不可达 | 等宿主恢复或刷新 |
| `unknown-outcome` | 写请求派发后中断 | 重读后按 revision 判断 |

- 分区库打不开或读写出错时，只影响该分区的操作，不影响其它分区与别的插件；不删除、不重建这个库。
- `read` 的 I/O 失败返回 `error` 快照，不当作缺失；调用方在读取成功前不应写入默认值。
- 订阅的推送失败不撤销已经写入的结果。

## 边界与兼容

- **owner**：`nbook.storage`（记录、分区库、三端入口、远程服务 `nbook.storage/user` 与 `nbook.storage/project`）；内核提供按调用方门面、调用方的客户端身份与跨实例委托（[`runtime.services`](../runtime/services.md)、[远程服务与 RPC 协议](../runtime/plugin-channel.md)）。
- **别的插件的数据**：不经 Storage 读取别人的记录；需要共享的数据经拥有者插件自己的服务（[插件的数据与状态](../../proposals/plugin-data-model.md) 第 5 节）。
- **记录的公开接口**：`defineRecord` 的字段、`StorageService` 与失败码是公开接口；库的表结构不是公开接口。
- **旧合同的去向**（开发者 2026-10-07 确认）：

  | 旧机制 | 原本防什么 | 现在 |
  |---|---|---|
  | 每条记录一个 JSON 文件 + `proper-lockfile` 分区锁与心跳 | 两个进程同时写一个分区 | 改为 SQLite 事务，不加目录锁；代价是两个服务端进程同开一个项目时互相收不到变更通知 |
  | 身份域与使用主体 | 不同 data、不同登录用户的记录串号 | 推迟到登录插件；登录上线时迁一次库 |
  | HTTP 头里的访问上下文、IndexedDB 客户端凭证 | 浏览器自报身份与项目 | 废弃，由内核调用方身份、路由按成员描述覆盖的客户端身份与运行位置、项目绑定取代 |
  | 每 owner 每分区 1024 条、16 MiB 配额 | 插件写满磁盘 | 推迟到第三方插件能用 Storage 时；保留单条上限 |
  | 每 500 ms 轮询外部写入 | 发现别的进程写入 | 废弃，订阅只覆盖分区拥有者进程里的写入 |
  | 删除标记回收与分区代次 | 释放容量、使旧凭据失效 | 本期不做；删除标记照常保留 |
  | 记录格式的迁移函数 | 旧版本记录读出时迁移 | 推迟；版本不同一律 `unsupported-version`，可以 `reset` |
  | 诊断原件区（1024 份、16 MiB） | 重置前保留原始字节 | 保留简化版：每分区 64 份、4 MiB |
  | 多标签首次初始化客户端身份的收敛 | 两个标签页同时首次生成不同身份 | 不做；两个标签页同一瞬间首次打开可能各得一个身份，`local` 记录分成两份（已知限制） |
  | 旧浏览器存储的迁移 | 旧版本的布局与偏好 | 废弃：旧项目整体不兼容 |
- **已知限制**：两个服务端进程同时打开同一项目时互相收不到变更通知，revision 在订阅里会跳跃；SQLite 的 WAL 库放在网络盘上可能不可靠；Windows 与 macOS 未实测。

## 验收与 Smoke

1. **同一命名空间。** 服务端插件 X 直用写 user/shared 记录，浏览器里的插件 X 经代理读到同一值，反之亦然；项目实例里的插件 X 直用写 project 记录，浏览器里的 X 经代理读到同一值。
2. **插件隔离。** 插件 A、B 写同名键互不可见；B 不能经任何路径读写 A 的记录。
3. **客户端分区。** 两个客户端身份写同一 `local` 记录各自一份；同一客户端身份的两个窗口共用一份；服务端与项目实例打开 `local` 记录为 `no-client`；服务端插件打开 project 记录为 `no-project`。
4. **条件保存。** 同一 revision 的两次保存至多一次成功、另一次为 `conflict`；删除后持有旧 revision 或 `null` 的保存为 `conflict`；两个进程同时以同一 revision 写同一个库，恰好一个成功。
5. **读取分类。** 缺失、正常、坏 JSON 与 schema 不符（`corrupt`）、版本不同（`unsupported-version`）各一例；库文件头被写坏时为 `error`（`io-error`），文件不被覆盖；`corrupt` 与 `unsupported-version` 时 `save`、`remove` 为 `protected`，`reset` 把原件写进原件区后写入新值；原件区满时 `originals-full`。
6. **记录定义。** 不合规则的定义在加载时抛错；只差 schema 的两份定义描述不同；同一 owner 同名键的描述不同时 `open` 为 `definition-conflict`；资源 id 与 `keyed` 不符为 `invalid-resource`；超过上限为 `too-large`，不符合 schema 为 `invalid-value`。
7. **订阅。** 订阅先收到当前快照，之后收到写入（含另一个窗口经代理的写入）；调用方入口停止后订阅结束；绑定的项目代次结束时订阅以项目已结束结束，项目再次打开后新代次读到磁盘上的值。
8. **生命周期。** `nbook.storage` 的入口停止后操作为 `unavailable`、库已关闭；项目子进程停止后 project 分区关闭。

Smoke：合同测试用真实内核实例、真实 SQLite 与真实项目子进程；`e2e/storage.e2e.ts` 在本机 Chrome 里用两个浏览器上下文与同一上下文的两个标签页，走完 `local` 隔离、同客户端共用、条件保存冲突、项目记录跨窗口共享与项目重新打开后仍在。

## 证据

- 批准目标：[插件的数据与状态](../../proposals/plugin-data-model.md) 第 5 节与 [多实例运行时拓扑](../../proposals/multi-instance-runtime-topology.md) 第 4、11 节（2026-10-07 `accepted`）、[ADR 0024](../../adr/0024-multi-instance-runtime-topology.md)；介质、废弃与推迟的取舍由开发者 2026-10-07 在 [t55 实施计划](../../../.agents/works/w00017-application-runtime-architecture/tasks/t55-plugin-storage/plan.md) 中确认（设计审查见 [omp 设计审查](../../../.agents/works/w00017-application-runtime-architecture/tasks/t55-plugin-storage/evidences/omp-design-review.txt)）。
- 实现进展（随 [w00017 t55](../../../.agents/works/w00017-application-runtime-architecture/tasks/t55-plugin-storage/README.md)，本文保持 `planned`，晋升待开发者审批）：记录定义与公开接口在 `packages/neuro-book/src/shared/storage.ts`；`nbook.storage` 在 `packages/neuro-book/src/plugins/storage/`（`server/partition.ts` 分区库，`server/owner.ts` 分区拥有者的本地路线与远程实现，`server/plugin.ts` 服务端与项目入口，`web/plugin.ts` 浏览器入口，`shared/contracts.ts` 服务键 `storageKey` 与远程合同，`shared/facade.ts` 按调用方的服务对象，`shared/remote-route.ts` 经代理的远程路线）。拥有者一侧的失败经远程合同的业务失败码 `storage-failed` 带回 Storage 失败码（Storage 的 `denied`、`unavailable`、`unknown-outcome` 与路由层失败码同名）。场景 1–4、6–8 由 `src/plugins/storage/storage.test.ts`（真实内核实例与进程内链路）与 `project-child.test.ts`（真实项目子进程），场景 4–6 的分区一侧（含两个 Bun 进程写同一个库）由 `server/partition.test.ts`，记录定义由 `src/shared/storage.test.ts`，场景 3、4、7 与项目记录跨窗口、跨项目代次由 `e2e/storage.e2e.ts`，打包产物里的 user 分区由 `smoke:server` 的 S8 覆盖。
- 旧合同的依据（只作参照）：[ADR 0020](../../../packages/neuro-book-legacy/docs/adr/0020-user-project-storage-boundaries.md)、[ADR 0021](../../../packages/neuro-book-legacy/docs/adr/0021-local-storage-persistence.md)。
