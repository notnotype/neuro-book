---
schema: nbook.spec/v1
kind: behavior
status: planned
capability: state.store
owners:
  - neuro-book
---

# 插件状态 store

## 目标与非目标

插件作者在一处声明一个入口的全部状态：内存状态、持久化到 [`storage.persistence`](../storage/persistence.md) 记录的字段、派生值、交给 [`state.public`](public-state.md) 的公开键，以及改它们的 action。默认私有，只经 action 写。持久化字段把“已确认的值”“当前显示”“还没保存的修改”分开，何时写由 action 决定，不深度监听整份状态；冲突时只重放这一次修改。store 随入口代次创建与释放，属于定义它的实例。

不承诺：

- 读配置的辅助函数：形状见输出第 19 条（planned），随配置能力实现；本能力不提供替代实现。
- 服务端数据的副本与查询缓存；跨实例共享同一个 store；全局 store 注册表。
- `unknown-outcome` 的自动判定（写可能已落盘时由拥有者决定重试或放弃）。
- 强制退出与浏览器页面关闭时保存完未发出的修改。
- 开发者工具面板与热更新。

## 术语与参与者

- **store 定义**：`defineStore(name, setup)` 的结果，模块级常量。**store 实例**：入口激活时由定义创建的一份，随这一代入口释放。
- **action**：setup 返回的函数，store 的唯一写入口。
- **持久化字段**：setup 里 `persist(record, ...)` 得到的句柄，对应一条 Storage 记录。
- **base**：字段最新的已确认快照。**display**：当前显示的值。**意图**：一次 `commit` 交出的修改（`change` 函数）。**队首**：排队意图里最早的一条。
- **参与者**：插件作者（写 setup 与 action）；读取方（组件、同插件的代码，经只读视图）；`nbook.storage`（持久化）；`nbook.state`（公开键）。

## 输入与前置条件

```ts
const layoutPublic = definePublicState("nbook.workbench", {
    nonCompact: {type: "boolean", unready: false, reason: NARROW_REASON},
});

const layoutStore = defineStore("layout", ({persist, publish}) => {
    const sizes = persist(sizesRecord, {initial: DEFAULT_SIZES});
    const compact = ref(false);
    const nonCompact = computed(() => !compact.value);
    publish(layoutPublic, {nonCompact});
    return {
        state: {compact, nonCompact, sizes},
        actions: {
            setCompact(value: boolean) { compact.value = value; },
            resize(next: Sizes) { return sizes.commit((base) => ({...base, ...next})); },
        },
    };
});

// 插件定义的入口：contributions: [...layoutPublic.contributions]
// 入口激活时：
const store = layoutStore.create(context, {storage});
return {contributions: store.contributions};
```

| 接口 | 规则 |
|---|---|
| `definePublicState(插件 id, {名: 声明})` | 声明规则见 [`state.public`](public-state.md)；结果的 `contributions` 写进插件定义的入口，同一份常量交给 `publish` |
| `defineStore(name, setup)` | `name` 1–64 个字符，小写字母开头，其余为小写字母、数字与 `-`；在同一插件里只用于区分诊断 |
| setup 上下文 | `persist(record, {initial, resource?})`、`publish(declarations, bindings)`；不给别的 I/O |
| setup 返回 | `{state, actions}`：`state` 是要给读取方看的 ref、computed 与字段；`actions` 是函数 |
| `create(context, {storage})` | 在入口的 `activate` 里调用；`context` 是激活上下文，`storage` 是该入口解析到的 Storage 服务 |
| `publish` 的 `bindings` | 键与声明完全一致，值是对应类型的 `ref` 或 `computed`；漏绑、多绑、类型不符编译不过 |

字段句柄（只在 setup 的闭包里有方法）：

```ts
interface PersistedField<T> {
    readonly base: Snapshot<T> | null;          // Storage 快照的非 error 分支；打开中为 null
    readonly failure: StorageFailure | null;
    readonly ready: boolean;                     // base 已有或 failure 已定
    readonly canSave: boolean;                   // failure 为 null 且 base 是 missing 或 ok
    readonly display: T;
    readonly queue: number;                      // 排队意图数
    readonly save: {state: "idle" | "saving"} | {state: "failed" | "unknown"; code: string};
    show(value: T): void;
    commit(change: (current: T) => T): Promise<CommitResult>;
    reset(value: T): Promise<CommitResult>;
    retry(): Promise<CommitResult>;
    discard(): "discarded" | "busy" | "nothing";
    adopt(): void;
    reopen(): Promise<void>;
}
type CommitResult = "saved" | "failed" | "unknown" | "protected" | "cancelled" | "discarded";
```

## 输出与可观察行为

1. **setup**：每次 `create` 同步运行一次 setup；其中建立的 `computed`、`watch` 随 store 释放一起停止。
2. **只读视图**：`store.state` 是只读视图：读取方写它不改变状态；其中的持久化字段只有数据（`base`、`failure`、`ready`、`canSave`、`display`、`queue`、`save`），不带方法。
3. **只经 action 写**：`store.actions` 是唯一的写入口；可写的 ref 与字段方法只在 setup 闭包里。
4. **公开绑定**：`store.contributions` 是交给内核的激活产出，把 `publish` 的绑定交给 `state.public`。绕过类型检查时，`bindings` 里多出的键不绑定并记诊断；声明里有、`bindings` 没给的键交“未绑定”（[`state.public`](public-state.md) 输出第 5 条）。
5. **字段的初值**：字段打开成功前 `ready` 为 false、`display` 为 `initial`；拿到首个快照后 `base` 为它，`display` 为它的值，`missing` 时为 `initial`。`initial` 只用于呈现，不自动保存。
6. **base 只来自订阅**：`base` 只随 Storage 订阅送来的快照更新，按订阅顺序；保存的结果只结算意图，不改 `base`。迟到的保存结果因此不会让 `base` 倒退。
7. **新的 base 不改显示**：订阅带来新的 `base` 时 `display` 不变；`adopt()` 把排队意图依次作用在最新 `base` 上，结果作为 `display`，不清意图。
8. **show**：只改 `display`（例如拖动中），不排意图、不保存。
9. **commit**：`display` 立即变为 `change(display)`，意图排到队尾；返回的 Promise 以这条意图**第一次**尝试的结果结算。同一字段的意图按提交顺序一条一条发送。
10. **队首发送**：以 `base` 的值为基础算出要写的值（`missing` 时以 `initial` 为基础），以 `base` 的 revision 作 `expect` 条件保存；成功则这条以 `saved` 结算。
11. **冲突重放一次**：条件保存得到 `conflict` 时，读最新快照，把同一个 `change` 作用在它上面再保存一次；仍冲突或得到其它确定的失败，队首以 `failed` 结算并记失败码，**队列暂停**，后面的意图保留不发、仍体现在 `display` 里。
12. **受保护的记录**：`base` 为 `corrupt` 或 `unsupported-version` 时 `commit` 直接以 `protected` 结算、不写；只能 `reset(value)` 覆盖，`expect` 取该快照的 revision。
13. **结果不确定**：保存得到 `unknown-outcome`（写可能已经落盘）时队首以 `unknown` 结算，保留这次要写的**具体值与 `expect`**，队列暂停；不在新 `base` 上重算 `change`。
14. **retry**：只作用于暂停的队首。`failed` 时按第 10、11 条重来；`unknown` 时，若 `base` 的值已等于要写的值则以 `saved` 结算，否则以原值、原 `expect` 重发，再冲突仍为 `unknown`。返回这次尝试的结果。
15. **discard**：只作用于暂停的队首：移除它（这条以 `discarded` 结算），`display` 改为把剩余意图依次作用在 `base` 上的结果，队列继续。队首正在发送时返回 `busy`；没有暂停的队首时返回 `nothing`。
16. **订阅结束与打开失败**：`open` 失败或订阅结束（`provider-stopped`、`project-gone`、`server-restarted`、`released`）时 `failure` 记下失败码，`canSave` 立即为 false；在途的保存按它的结果结算，排队的意图暂停。不自动重开；`reopen()` 重新打开并订阅，成功后 `failure` 清空，由拥有者 `retry`。
17. **停止**：入口开始停止后调用 action 抛错（可按错误类型判定）。store 释放时先等在途保存结束，再按队列顺序发送已接受的意图（含一次冲突重放），直到队列空或队首失败；剩下的意图以 `cancelled` 结算并记一条诊断。随后结束 Storage 订阅、停止 setup 的响应式作用域。
18. **私有**：store 实例只经创建它的入口交出的视图与 action 访问；同一定义在两个入口或两个实例里创建的是两份，互不相见。
19. **读配置（planned）**：setup 上下文增加按配置键取只读有效值的辅助函数，值随配置变化更新；形状与失败语义随配置能力定。

## 状态与转换

持久化字段的保存状态：

| `save.state` | 进入 | 离开 |
|---|---|---|
| `idle` | 创建；队列空；队首结算为 `saved` 后下一条也已发完 | 有意图要发 → `saving` |
| `saving` | 队首开始发送 | `saved` → 下一条或 `idle`；确定失败 → `failed`；`unknown-outcome` → `unknown` |
| `failed` / `unknown`（暂停） | 见输出第 11、13 条 | `retry` → `saving`；`discard` → 下一条或 `idle` |

时序与寿命：

- `create` 返回时 setup 已运行完，字段在打开中（`ready` 为 false）；首个快照到达前 `commit` 照常排队，等字段就绪后再发。
- 订阅的首个快照可能早于 `open` 的建立返回，结束也可能早于建立返回；两种顺序下字段的状态都按第 5、16 条结算，不留下活订阅。
- 同一字段同一时刻至多一个保存在途。
- 入口停止开始到 store 释放之间，action 已抛错，已接受的意图仍按第 17 条发送。宿主给停止设了截止时，截止只决定内核等多久，不中断这次发送；之后进程退出则剩下的不保证。
- 释放之后字段句柄的方法与 action 都抛错；只读视图保留最后的值。

## 副作用与数据

- 持久化只经 `nbook.storage` 的记录与条件保存；store 自己不写文件、不留缓存。
- 诊断：`publish` 多出的键、停止时以 `cancelled` 结算的意图（按拥有者插件，带字段与条数）。

## 失败与恢复

| 结果 | 含义 | 拥有者怎么办 |
|---|---|---|
| `saved` | 这条意图已落盘 | 无 |
| `failed` | 冲突重放后仍冲突，或确定的失败（失败码随 `save.code`） | `retry`、`discard`，或 `adopt` 后重新提交 |
| `unknown` | 写可能已落盘 | `retry`（不会重复应用）或 `discard` |
| `protected` | 记录损坏或版本不认识 | 用 `reset` 覆盖，或保持只读 |
| `cancelled` | 停止时没有发出 | 无（下次启动按落盘的值） |
| `discarded` | 被 `discard` 移除 | 无 |

`open` 与订阅的失败码沿用 [`storage.persistence`](../storage/persistence.md)。

## 边界与兼容

- 公开接口：`defineStore`、`definePublicState`、setup 上下文、字段句柄与只读视图、`CommitResult`。
- 内置插件从应用包的共享库使用；第三方插件以后从插件公开 API 的包使用（[`runtime.plugin-api`](../runtime/plugin-api.md)）。
- 浏览器里 store 与 Vue 组件共用同一份响应式运行时：组件里读 store 的 `computed` 随 store 刷新。

## 验收与 Smoke

1. **两个窗口窄改同一条记录**：Given 同一客户端的两个窗口打开同一条记录，值有 `left`、`right` 两个独立字段；When 两边在同一轮里各改一个字段并提交；Then 后者冲突一次后在最新值上重放、保存成功，最终两个字段的修改都在；对方窗口的 `base` 更新而 `display` 不变，`adopt` 后才更新。
2. **结果不确定后重试**：Given 写已落盘、回包前链路断开；When 断线期间别处又写了一次，重连后 `retry`；Then 修改不被应用两次；`base` 已等于要写的值时直接以 `saved` 结算。
3. **停止时发出**：Given action 已提交两条意图、第一条在途；When 入口正常停止；Then 两条依次落盘，停止后 action 抛错；第一条确定失败时第二条以 `cancelled` 结算并有诊断。
4. **提供方单独停止**：Given 项目入口的 Storage 停止而 store 仍活着；Then `canSave` 立即为 false，排队意图暂停；`reopen` 后 `retry` 成功。

Smoke：`e2e/state.e2e.ts`，同一浏览器两个标签页窄改探针记录的不同字段，两边的修改都保留。

## 证据

- 批准依据：[插件的数据与状态](../../proposals/plugin-data-model.md) 第 3、11 节与待定项 1（2026-10-07 `accepted`）；开发者 2026-10-08 在 [t56 实施计划](../../../.agents/works/w00017-application-runtime-architecture/tasks/t56-plugin-state/plan.md) 中确认：setup 写法、用 `@vue/reactivity` 自己实现、不用 Pinia、放应用包共享库，正常停止时发出已接受的意图。
