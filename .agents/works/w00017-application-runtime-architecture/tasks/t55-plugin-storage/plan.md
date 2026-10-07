# t55 实施计划：K4 `nbook.storage`（插件记录、分区归实例、客户端代理）

## Context

- **为什么做**：K1–K3 让服务端、项目子进程与浏览器窗口各有内核实例并能互相调用。插件还没有地方记住“程序替用户记住的东西”（布局尺寸、展开的目录、视图定制、最近项目）：旧应用的做法是一个大 store 深度监听整份状态再写回（[插件的数据与状态](../../../../../docs/proposals/plugin-data-model.md) 第 2 节的教训）。K4 交付 `nbook.storage`：插件按记录声明要持久化的数据，记录按 user / project 分区落在对应的实例，浏览器经代理访问，读写有条件保存与订阅。K5 的 `defineStore` 持久化字段建在它上面；工作台布局的产品接入归外壳切片。
- **依据**：[多实例运行时拓扑](../../../../../docs/proposals/multi-instance-runtime-topology.md) 第 4 节（受控代理的委托、消费上下文）与第 11 节 K4 行；[插件的数据与状态](../../../../../docs/proposals/plugin-data-model.md) 第 5 节（2026-10-07 `accepted`）；[ADR 0024](../../../../../docs/adr/0024-multi-instance-runtime-topology.md)；Spec `storage/persistence.md`、`storage/boundaries.md`（`planned`，旧应用时期写成，按本计划原地改写）、`runtime/services.md`（委托，`implemented`）、`runtime/plugin-channel.md`、`runtime/plugin-api.md`。
- **拓扑稿与配套稿已定的**：
  - 按插件划分命名空间，不按入口；内核按调用方生成 Storage 服务实例，每个插件只能访问自己的命名空间。
  - 分区归实例：user 分区在服务端实例，project 分区在项目实例，浏览器与 TUI 不存数据，同样的接口经远程服务转给分区的拥有者。
  - 客户端代理不能用自己的身份转发：经内核签发的消费上下文转发，上下文携带原消费插件、入口激活代次、稳定客户端身份与精确项目代次，不能由业务参数自报。本地直用与经代理访问的是同一个命名空间。
  - 记录定义写在插件的共享模块里，三端共用；第一次打开时登记，同名不同形状的定义被拒绝；读取分类 `missing | ok | corrupt | unsupported-version | error`；条件保存；可按资源 id 寻址。
  - 不做 session/window 作用域（放 URL）；大文件不进记录。
  - K4 验收：客户端代理与本地直用访问同一命名空间、两插件隔离、`local` 按客户端分区、条件保存冲突、订阅与项目代次失效。留给后续：工作台布局的产品接入（外壳切片），备份与删除标记回收。
- **K3 留下的问题**：K3 去掉了防双开的锁，约定“出现项目级持久数据时再定，优先用数据本身的机制（SQLite 的锁、库里的拥有者记录）”。K4 的 project 分区就是第一份项目级持久数据，本计划第 1 节给出取舍（待确认第 1 项）。
- **旧应用的实现**（`packages/neuro-book-legacy/server/storage/`，约 9000 行，`storage/persistence.md` 按它写成）：每条记录一个 JSON 文件；分区用 `proper-lockfile` 加心跳的跨进程锁；身份域与使用主体；HTTP 请求头携带的访问上下文与 IndexedDB 里的客户端凭证；每 500 ms 轮询发现外部写入；每 owner 每分区 1024 条、16 MiB 的配额；删除标记的回收与分区代次；诊断原件区；旧浏览器存储的迁移。新架构里身份由内核调用方身份与路由的绑定提供，多数机制失去原来要防的东西，逐项列在“待确认”，交开发者决定保留、简化还是废弃。
- **工作方式**：worktree `.worktree/w00017-runtime-foundation` 逐片提交，只暂存本片文件；测试用真实内核实例、真实 SQLite、真实项目子进程、真实 Bun WebSocket 与本机 Chrome，不用 mock、spy、假计时器、固定等待；起子进程的测试在用例失败时也收口；交付前对验收映射的每条判据做变异检查；主 Agent 编码，最后 omp（默认模型）只读审查。不修改 `packages/neuro-book-legacy`。

## 关键设计

### 1. 介质：每个分区一个 SQLite 库（`bun:sqlite`）

- user 分区：`<状态根>/storage/user.sqlite`；project 分区：`<项目目录>/.nbook/storage.sqlite`（运行中另有 `-wal`、`-shm`）。旧 Spec 写的 `WorkspaceRoot/.nbook/storage/` 是旧应用的 Workspace Root，新应用没有这个概念。
- 一张表 `records`：`owner`（插件 id）、`key`、`resource`（缺省为空串）、`client`（`local` 记录为客户端身份，`shared` 为空串）、`revision`（分区内单调递增的整数，写入与删除都换新值，不复用）、`version`（记录定义的版本）、`value`（JSON 文本，删除标记为 NULL）、`updated_at`。主键 `(owner, key, resource, client)`。另一张 `originals` 存显式重置前的原件（第 4 节）。一张 `meta` 记库格式版本与分区的下一个 revision。
- 条件保存在一个 `BEGIN IMMEDIATE` 事务里读 revision、比较、写入：同一进程按调用串行，两个进程打开同一个库时由 SQLite 的锁保证“至多一个以同一旧 revision 成功”。`journal_mode=WAL`、`busy_timeout` 2 秒，等不到锁返回 `busy`（可重试）。
- **取舍**：不另加目录锁（K3 的承诺）；两个服务端进程同时打开同一项目时，两边的条件保存仍然正确，只是互相收不到对方写入的变更通知（旧应用靠 500 ms 轮询弥补，本计划不做，记为已知限制）；这时一边的订阅看到的 revision 会跳过另一边写入的值，所以 Spec 写明 revision 在分区内单调、不保证连续，订阅方不能用“不连续”判断漏收。SQLite 文件不能直接阅读与比较，但 Storage 是界面记忆、不是作品内容；作品文件仍是纯文本。备选是旧应用的“每条记录一个 JSON 文件加分区锁”：跨进程要靠锁文件与心跳，订阅要靠轮询，这两样正是新架构想去掉的。

### 2. 记录定义（`packages/neuro-book/src/shared/storage.ts`）

```ts
export const sizesRecord = defineRecord({
    key: "layout-sizes",            // 小写安全单段
    scope: "project",               // "user" | "project"
    locality: "local",              // "local" | "shared"，缺省 local
    version: 1,
    schema: Type.Object({...}, {additionalProperties: false}),
    keyed: false,                   // true 时按资源 id 寻址（open 的第二个参数）
    maxBytes: 64 * 1024,            // 单条上限，缺省 64 KiB，最多 1 MiB
});
```

- `defineRecord` 在模块加载时校验结构（键名、版本、schema 是关闭额外属性的对象、上限范围），返回冻结对象；它在 `src/shared/` 而不是 `nbook.storage` 插件里，因为每个插件都要在运行时调用它，而插件之间只允许 `import type`。
- **描述与指纹**：定义的规范 JSON：显式取出 `{key, scope, locality, version, keyed, maxBytes, schema}`，每一层对象都按键排序后序列化。不用 `JSON.stringify` 的 replacer 数组排序：它对每一层都按同一组键过滤，嵌套的 schema 会被清成 `{}`，只差 schema 的两个定义指纹相同（omp 审查实测）。TypeBox 1.x 的 schema 就是普通 JSON Schema，往返 JSON 后校验结果不变（2026-10-07 实测）。分区拥有者为每个 `(owner, key)` 记下第一次打开时的描述；之后描述不同的打开以 `definition-conflict` 拒绝（同一次运行里两个版本的代码，或客户端外壳比服务端旧），客户端据此提示刷新。描述只在内存里登记，不落库：重启后以新代码的定义为准，库里旧版本的值按第 4 节分类。

### 3. 服务与门面（`nbook.storage`，合同在 `src/plugins/storage/shared/contracts.ts`）

```ts
interface StorageService {
    open<T>(record: RecordDefinition<T>, resource?: string): Promise<OpenResult<T>>;
}
type OpenResult<T> = {ok: true; handle: RecordHandle<T>} | {ok: false; code: StorageFailure; detail: string};
interface RecordHandle<T> {
    read(): Promise<RecordSnapshot<T>>;
    save(value: T, options: {readonly expect: Revision | null}): Promise<WriteResult>;
    remove(options: {readonly expect: Revision | null}): Promise<WriteResult>;
    /** 只对 corrupt 与 unsupported-version：原件存入 originals 后写入新值。 */
    reset(value: T, options: {readonly expect: Revision | null}): Promise<WriteResult>;
    subscribe(listener: (snapshot: RecordSnapshot<T>) => void, options?: {onEnd?(reason: string): void}): Promise<SubscribeResult>;
}
type RecordSnapshot<T> =
    | {status: "missing"; revision: Revision | null}        // 从未写过为 null，删除后为删除标记的 revision
    | {status: "ok"; value: T; revision: Revision}
    | {status: "corrupt" | "unsupported-version"; revision: Revision; detail: string}
    | {status: "error"; code: StorageFailure; detail: string};
type WriteResult = {ok: true; revision: Revision} | {ok: false; code: StorageFailure; detail: string};
```

- `Revision` 是不透明字符串（实现里是 revision 整数的十进制），删除标记的 revision 同样非空。“从未写过”的 `expect` 是 `null`：只在没有这一行时写入。
- **`open` 是异步的、有失败通道**：它在分区拥有者处登记记录描述，并核对本位置能不能用这条记录，失败码 `definition-conflict`、`no-client`、`no-project`、`denied`、`invalid-resource`（资源 id 与 `keyed` 不符或不是小写安全单段），以及传输与分区的 `unavailable`、`busy`、`io-error`。这样三端在同一处报告这些失败（服务端本地能同步判断，浏览器要问分区拥有者），K5 的 store 初始化也有确定的落点；数据面方法全部返回 Promise，与 `runtime/plugin-api.md` 的远程形态约束一致。拥有者的入口重新激活后登记会丢，所以之后每次操作仍带描述，仍可能得到 `definition-conflict`。
- 失败码：`conflict`（revision 已变）、`invalid-value`（不符合 schema、不能序列化）、`too-large`、`protected`（对 corrupt / unsupported-version 做普通保存或删除）、`definition-conflict`、`no-client`（`local` 记录没有客户端上下文）、`no-project`（project 记录在没有项目分区可用的位置打开，见下）、`denied`（调用方不是插件入口）、`invalid-resource`、`busy`、`io-error`、`unavailable`（分区已关闭、项目代次已结束、服务端不可达）、`unknown-outcome`（写请求派发后中断，按远程服务的阶段规则）。读到的值都按定义的 schema 校验后才交给调用方。
- **门面按调用方生成**：`nbook.storage` 的入口以 `providePerConsumer(storageKey, (consumer) => 门面)` 提供；owner 取 `consumer.plugin`，`plugin` 为 null（宿主能力、门禁）以 `denied` 拒绝。门面释放时结束它建立的订阅。
- **入口与位置**：

  | 入口 | 位置 | 拥有的分区 | 别的 scope |
  |---|---|---|---|
  | `server` | 服务端 | user | project 记录 `no-project`（服务端插件要碰项目数据，经自己的项目入口） |
  | `project` | 项目子进程 | 本项目的 project | user 记录经远程服务 `nbook.storage/user` 转给服务端 |
  | `browser` | 窗口 | 无 | user 转给服务端；project 转给绑定的项目（`.at("project")`），没有绑定为 `no-project` |

  `local` 记录只对有客户端身份的调用方可用（浏览器，以后的 TUI）；服务端与项目实例里的插件打开 `local` 记录为 `no-client`。
- **远程服务**：`nbook.storage/user`（`provider: "server"`，调用方 `browser`、`tui`、`project`）与 `nbook.storage/project`（`provider: "project"`，调用方 `browser`、`tui`）。方法 `open`、`read`、`save`、`remove`、`reset`，输入带记录描述、资源 id、值与 `expect`（第一版每次带完整描述，Spec 记下以后可改为登记后只带指纹）；事件 `changes`（过滤参数 `{key, resource}`，内容是新快照）。分区拥有者收到的调用方身份是原插件（经代理时 `via` 为 `nbook.storage`），按第 5 节的消费上下文取 owner 与客户端身份。
- **订阅**：订阅建立时先推一次当前快照，之后同一分区拥有者进程里的每次写入推送新快照（只推给同 owner、同键、同资源、同客户端分区的订阅）。远程订阅的寿命沿用 K1：订阅方入口停止、项目代次结束、断线都结束订阅；重连同一代次重建并 `onResync`，订阅方据此重读。
- **生命周期**：分区库在第一次使用时打开，入口停止时先停止接纳、等在途操作结算、关闭库。项目子进程停止即关闭 project 分区。

### 4. 读取分类与版本

- `missing`：没有这一行，或是删除标记。`ok`：JSON 可解析、版本与定义相同、符合 schema。`corrupt`：JSON 无法解析或不符合 schema。`unsupported-version`：库里的版本与定义不同（高于或低于；新应用没有旧格式，定义级的迁移函数推迟，见待确认第 7 项）。`error`：读库失败。
- corrupt 与 unsupported-version 时普通 `save`、`remove` 为 `protected`；`reset` 以当前 revision 为条件，把原件（原始文本与版本，每个分区最多保留 64 份、总计 4 MiB，超出时拒绝重置，不清旧原件）写进 `originals`，再写入新值。

### 5. 内核：消费上下文带客户端身份，委托跨实例（`packages/nb-runtime`）

- **调用方身份加 `client`**：`ConsumerIdentity` 增加 `client: string | null`（调用方实例的稳定客户端身份）。运行实例的身份增加可选的 `client`（浏览器宿主传入 K2 的客户端身份，服务端与项目实例为 null），服务装配据此填写本地调用方；远程帧的调用方随之带 `client`（节点的 `toCallerFrame`、`toConsumer` 与门面缓存键 `consumerKey` 同步加上）。调用方身份里由实例描述决定的字段是 `location` 与 `client`：路由对每个成员发来的帧，把这两项置为登记的成员描述的 `kind` 与 `client`，节点自报不算数（现在路由只核对 `instanceId`，`location` 被合同的 `callers` 核对使用，也一并覆盖）。帧格式变化，wire 升为 3。项目代次不进身份：project 分区的拥有者就是这一代项目实例，路由按客户端的绑定把 `.at("project")` 送到这一代，发往已结束代次的请求在未派发阶段 `target-gone`；拓扑稿与配套稿里“上下文携带精确项目代次”在 S0 按这个承接方式改写。
- **跨实例委托**：K1 的委托只在同一实例内（`resolveFor`）。新增 `context.remote.on(consumer)`：返回以 `consumer` 的身份发出调用的 `RemoteAccess`，帧上的调用方是原调用方、`via` 为代理入口。核对与 `resolveFor` 相同：`consumer` 是装配签发给本入口门面的身份、签发它的门面还没释放、插件在代理允许清单内；入口另以 `remoteDelegates: ReadonlyArray<string>`（合同 id）声明可以代理哪些远程服务，`use()` 一个未声明的合同为 `denied`。与已有的 `delegates` 分工：`delegates` 管本地服务键的 `resolveFor`，`remoteDelegates` 管远程合同的 `remote.on`，两者都只对代理允许清单里的内置插件生效。
- **挂在签发记录下**：签发记录是服务装配私有的（`services/composition.ts` 的 `#issued`），插件宿主现在把远程访问的释放挂在入口的 `entry-work` 上（`plugins/host.ts` 的 `#remoteAccess`）。照现状挂，原调用方 X 停止后经代理建立的订阅要到 `nbook.storage` 的入口停止才结束。所以 S2 给装配加一个内部方法：按 `#resolveFor` 的三项核对签发身份，返回把释放步骤追加到这份签发记录的登记函数；`remote.on(consumer)` 交给节点的 `onRelease` 用它。释放顺序沿用 `#releaseDelegated`：先跑代理门面自己的 `release`（期间经代理的远程门面与订阅仍可用），再跑签发记录上的步骤（结束订阅、发 release 帧）。经代理的调用方身份带 `via`，与 X 自己直接远程访问的门面缓存键不同，两条释放路径互不相干；提供方处理 release 帧本来就按键幂等。
- `nbook.storage` 是唯一用到它的插件；三个宿主（服务端、项目子进程、窗口）的清单把 `nbook.storage` 放进代理允许清单（K1 的 `delegation` 选项，第一版只允许内置插件）。

### 6. 宿主接线与清单

- 插件描述 `src/plugins/storage/plugin.ts`：位置 `server`、`project`、`browser`；三端工厂登记在 `src/server/plugins.ts`、`src/project/plugins.ts`、`src/web/plugins.ts`。服务键 `storageKey` 由装配者交给需要它的插件工厂（包里的约定）；记录定义从 `src/shared/storage.ts` 取。
- 服务端与项目实例里它是启动必需插件（与 K3 一致，服务端清单里的插件都必需）；窗口里不是必需插件，激活失败只影响用到它的插件。
- 测试插件 `test.remote-probe` 加三端的 Storage 用法（服务端直用 user 记录、项目入口直用 project 记录、浏览器经代理访问两种），并挂观察入口，供合同测试与 e2e 使用。

## Spec 与文档改动（S0）

| 文档 | 改什么 |
|---|---|
| `docs/specs/storage/persistence.md` | 原地改写为 v2 合同（`planned`）：分区归实例、落点与 SQLite 介质、记录定义与指纹、`open` 与读取分类、条件保存与失败码、订阅（revision 单调不连续）、委托与客户端身份、生命周期；旧合同里废弃或推迟的部分按待确认的结论列在“边界与兼容”（含多标签首次打开的已知限制），旧应用的实现留作参照。旧的“布局投影与保存反馈”是消费方行为，不留在 Storage：四部分状态模型已在 `plugin-data-model.md` 第 3 节，归 K5 的 store Spec，布局专属的规则归外壳切片的布局 Spec，改写说明里写明去向 |
| `docs/specs/storage/boundaries.md` | 身份与上下文改为内核调用方身份与路由绑定；删去 Workspace Root、身份域、访问上下文的表述；Config 一节指向 K6 |
| `docs/specs/runtime/services.md` | 调用方身份增加 `client`；委托增加跨实例的 `context.remote.on`（新条目标“随 t55 实现”） |
| `docs/specs/runtime/plugin-channel.md` | 帧上调用方的 `client`，路由覆盖 `location` 与 `client`，wire 3；精确项目代次由路由按绑定解析、旧代次 `target-gone`；经代理的远程调用与 `remoteDelegates`；去掉“委托只在同一实例内”的已知限制 |
| `docs/specs/runtime/plugins.md`、`plugin-manifest.md` | 入口字段 `remoteDelegates`，开头写清它与 `delegates` 的分工；激活上下文的 `remote.on` |
| `docs/specs/runtime/application.md` | 运行实例身份的可选 `client` |
| `docs/specs/runtime/plugin-api.md` | `ctx.storage` 改为 `nbook.storage` 服务；插件私有目录随资源寻址与文件服务另定 |
| `docs/proposals/plugin-data-model.md` | 第 5 节去掉“加上项目锁”，写明 project 分区的写入方由 SQLite 事务保证；“上下文携带精确项目代次”改为由路由按绑定解析；决策记录 |
| `docs/proposals/multi-instance-runtime-topology.md` | 决策记录加 K4 的取舍 |

## 切片

| 片 | 对应设计 | 提交边界 | 自跑验证 |
|---|---|---|---|
| S0 | Spec 改动表 | 文档 | `bun run docs:check`、`bun run governance:check` |
| S1 | 第 5 节前半 | 调用方身份的 `client`、路由覆盖、wire 3 | `bun run --cwd packages/nb-runtime typecheck`、`test`；`bun run --cwd packages/neuro-book typecheck` |
| S2 | 第 5 节后半 | 跨实例委托：`remoteDelegates`、`context.remote.on`、装配按签发记录挂释放步骤的内部方法 | 同 S1 |
| S3 | 第 1、2、4 节 | 记录定义（`src/shared/storage.ts`）、分区库（`src/plugins/storage/server/partition.ts`）：条件保存、删除标记、分类、上限、原件、描述登记、进程内变更通知 | 同 S1，另 `bun run --cwd packages/neuro-book test:bun` |
| S4 | 第 3 节 | `nbook.storage` 三端入口、门面、远程服务、代理、订阅、生命周期 | 同 S3 |
| S5 | 第 6 节 | 宿主接线、代理允许清单、探针的 Storage 用法、e2e | 同 S3，另 `test:vitest`、`test:e2e` |
| S6 | — | Spec 实现合同与证据、Task 证据、omp 审查与修正 | `bun run test:affected --typecheck --since <计划提交>`、`bun run --cwd packages/neuro-book smoke:server`、`docs:check`、`governance:check` |

## 验收映射

| 行为（拓扑稿 K4 行在前） | 测试 |
|---|---|
| 客户端代理与本地直用访问同一命名空间：服务端插件 X 直用写 user/shared 记录，浏览器里的插件 X 经代理读到同一值，反之亦然；项目入口直用与浏览器经代理访问 project 记录同理 | `src/plugins/storage/storage.test.ts`（真实内核实例、进程内链路、真实 SQLite）、`window.test.ts` 增补 |
| 两插件隔离：A、B 同名键互不可见；B 不能经任何路径读写 A 的记录 | `storage.test.ts` |
| `local` 按客户端分区：两个客户端身份各自一份，同一客户端身份的两个窗口共用一份；服务端与项目实例打开 `local` 为 `no-client` | `storage.test.ts`、`e2e/storage.e2e.ts`（两个浏览器上下文、同一上下文两个标签页） |
| 条件保存冲突：同一 revision 的两次保存至多一次成功；删除后旧 revision 的保存不复活；两个进程同时写同一个库 | `partition.test.ts`（真实 SQLite；两个 Bun 子进程并发写同一个库文件） |
| 订阅与项目代次失效：订阅先收到当前快照，之后收到写入；项目代次结束订阅结束；新代次读到磁盘上的值 | `storage.test.ts`（真实项目子进程，K3 的测试支持）、e2e |
| 读取分类：missing、ok、corrupt（坏 JSON、schema 不符）、unsupported-version、error（库文件头写入垃圾字节后打开：`io-error`，与 corrupt 区分，且不覆盖该文件）；corrupt 与 unsupported-version 时普通保存为 `protected`，`reset` 保存原件后写入 | `partition.test.ts` |
| 记录定义：结构不合法在加载时抛错；只差 schema 的两个定义指纹不同；同一 owner 同名键描述不同时 `open` 为 `definition-conflict`；资源 id 与 `keyed` 不符为 `invalid-resource`；值超过上限为 `too-large`、不符合 schema 为 `invalid-value` | `src/shared/storage.test.ts`、`partition.test.ts`、`storage.test.ts` |
| 调用方身份的 `client`：本地调用方带本实例的客户端身份；路由用成员描述覆盖自报的 `client` 与 `location` | 内核 `per-consumer.test.ts`、`routing.test.ts` 增补 |
| 跨实例委托：经 `remote.on(consumer)` 的调用在提供方看到原调用方与 `via`；伪造或别的入口签发的身份、未声明的合同、不在允许清单为 `denied`；原调用方入口停止（代理入口仍在）后经代理建立的订阅结束、提供方的门面释放，代理门面的 `release` 运行期间经代理的调用仍可用 | 内核 `delegation.test.ts`、`routing.test.ts` 增补 |
| 生命周期：入口停止后操作为 `unavailable`、库已关闭；项目子进程停止关闭 project 分区 | `storage.test.ts` |

## 验证

- 每片：上表的自跑命令。
- 收口：`bun run test:affected --typecheck --since <计划提交>`、`bun run --cwd packages/neuro-book test:e2e`、`smoke:server`、`docs:check`、`governance:check`；对验收映射的每条判据做变异检查。
- 端到端：`e2e/storage.e2e.ts` 用测试外壳与真实服务端子进程、真实项目子进程，在本机 Chrome 里走完“两个浏览器上下文各写 local 记录互不可见 → 同一上下文两个标签页共用 → 两标签页同 revision 保存一个冲突 → 项目记录跨窗口共享并在项目重新打开后仍在 → 订阅收到另一窗口的写入”。
- 未验证的边界：Windows 与 macOS；两个服务端进程同时打开同一项目时的变更通知（不提供）；TUI；工作台布局的产品接入（外壳切片）；K5 的 `defineStore` 持久化字段。

## 不做与风险

- **不做**：备份恢复、项目 ZIP 导出、删除标记回收与分区代次；配额（待确认第 4 项）；定义级迁移（待确认第 7 项）；登录后的使用主体（待确认第 2 项）；工作台布局接入；插件私有目录；跨设备同步。
- **风险**：
  - wire 升到 3、调用方身份多一个字段：K1–K3 的测试与 Spec 一并改；`implemented` 的 `runtime.services` 增补条目。
  - 往项目目录写 `.nbook/storage.sqlite`：用户能看到的副作用（与 K3 的 `.nbook/project.json` 同一目录）；项目放在 Git 里的用户要忽略它。
  - SQLite 在 WAL 下的库文件放在网络盘上可能不可靠：本地优先产品，记为已知限制。

## 待确认

逐项说明旧机制原本防什么、新架构里还需不需要、去掉的代价。2026-10-07 开发者确认：11 项均按下面的建议执行。

1. **介质与锁**：建议每个分区一个 SQLite 库，条件保存靠 SQLite 事务，不加目录锁（第 1 节）。旧应用的“每条记录一个 JSON 文件 + `proper-lockfile` 分区锁 + 心跳”防的是两个进程同时写一个分区；SQLite 自己就有跨进程锁。去掉锁的代价：两个服务端进程同开一个项目时互相收不到变更通知，订阅看到的 revision 会跳过对方写入的值。
2. **身份域与使用主体**（旧：防不同 data、不同登录用户的记录串号）：登录还没做，只有本机一个主体。建议推迟到登录插件，库里不留主体列，届时再迁移。代价：登录上线时要迁一次库。
3. **访问上下文**（旧：HTTP 头里的访问标识、空闲到期、IndexedDB 客户端凭证，防浏览器自报身份与项目）：由内核调用方身份、路由按成员描述覆盖的客户端身份与运行位置、项目绑定取代，建议废弃。
4. **配额**（旧：每 owner 每分区 1024 条、16 MiB，防插件写满磁盘）：现在只有内置插件。建议保留单条上限（64 KiB，最多 1 MiB），配额推迟到第三方插件能用 Storage 时。代价：内置插件写入失控时没有兜底。
5. **外部写入的轮询**（旧：每 500 ms 读一次，发现别的进程写入）：建议废弃，订阅只覆盖本进程的写入（第 1 节的代价）。
6. **删除标记回收与分区代次**：拓扑稿已定本期不做；删除标记照常保留，防旧 revision 复活。
7. **定义级迁移**（旧：owner 提供迁移函数，旧版本记录读出时迁移、保留原件）：新应用没有旧格式。建议推迟；版本不同一律 `unsupported-version`，可以显式 `reset`。代价：第一次改记录格式的插件要先补迁移机制。
8. **诊断原件区**（旧：损坏或高版本记录被重置前保存原始字节，1024 份、16 MiB）：建议保留简化版（每分区 64 份、4 MiB，第 4 节）。
9. **客户端身份多标签首次初始化收敛**（旧：IndexedDB 事务防两个标签页同时首次生成不同身份）：K2 已用 localStorage 的随机值；两个标签页同一瞬间首次打开可能各得一个身份，`local` 记录分成两份。建议不做，Spec 记为已知限制。
10. **旧浏览器存储的迁移**：旧项目不兼容，建议废弃。
11. **服务端插件访问 project 分区**：建议不支持（`no-project`），服务端插件要碰项目数据就经自己的项目入口；以后有需要再加 `{project}` 目标。
