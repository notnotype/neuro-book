---
schema: nbook.spec/v1
kind: behavior
status: implemented
capability: state.public
owners:
  - nbook.state
---

# 公开状态

## 目标与非目标

插件把自己的一部分状态以具名、带类型的**公开键**交给同一运行实例里的别的部分读：命令的 `when`、别的插件、以后的 Agent 工具。公开键先在插件定义里声明（内核目录在入口激活前就有它），入口激活时绑定读取函数，入口停止即撤回。读取同步、不失败：没有值时给声明里的“未就绪”取值。

不承诺：

- 跨实例读取或同步：公开状态只在所在实例求值，不复制到别的实例。别的实例要知道某个窗口里的状态，直接问那个窗口（例如 [`workbench.commands`](../workbench/commands.md) 的跨实例命令）。
- 写入：公开状态只读；改它的值由拥有它的插件自己的 action 完成（[`state.store`](store.md)）。
- 标量以外的类型（对象、数组、`null`）；变更事件流（读取方经响应式依赖或再次读取得知变化）。
- 权限：公开键对同一实例里的任何读取方可见；命名空间防误用，不防恶意的受信代码（[ADR 0022](../../adr/0022-extensible-platform-and-plugin-trust.md)）。

## 术语与参与者

- **公开键**：以限定名 `<插件 id>/<名>` 标识的一项公开状态，例如 `nbook.workbench/nonCompact`。
- **声明**：公开键的类型、未就绪取值与原因，写在插件定义里。
- **绑定**：入口激活时交给 `nbook.state` 的读取函数；入口停止时撤回。
- **未就绪**：键已声明，但此刻没有可用的绑定（入口未激活、已停止、声明了却没绑、读取函数出错）。
- **参与者**：声明公开键的插件（拥有者）；`nbook.state`（拥有贡献点 `state.public`，在服务端、项目、浏览器三种位置各有入口，提供读取服务）；读取方（`nbook.commands` 的 `when`、别的插件）。

## 输入与前置条件

### 声明

公开键是入口下向贡献点 `state.public` 的贡献，贡献 id 写限定名：

| 字段 | 规则 |
|---|---|
| 贡献 id | `<插件 id>/<名>`：插件 id 是贡献方插件；名 1–64 个字符，小写字母开头，其余为字母与数字 |
| `type` | `"boolean"`、`"string"`、`"number"` 之一 |
| `unready` | 与 `type` 同类型的值；未就绪时读到它 |
| `reason` | 可选，只给 `boolean` 键：值不为 `true` 时给用户看的原因（中英文本） |

同一限定名在一个插件里只声明一次（同一插件的不同入口之间也不行）。插件作者用一份常量同时写插件定义里的贡献与 store 里的绑定，名字与类型由编译器核对（[`state.store`](store.md)）。

### 读取

```ts
interface PublicStateService {
    read(key: string): PublicRead;
    declaration(key: string): PublicDeclaration | null;
}
type PublicRead =
    | {status: "ready"; value: boolean | string | number}
    | {status: "unready"; value: boolean | string | number}  // 声明的 unready
    | {status: "undeclared"};
```

读取服务的服务键由 `nbook.state` 的公开合同给出；需要它的入口在依赖里声明。每个实例的读取服务只认本运行位置入口声明的键。

## 输出与可观察行为

1. **登记期校验**：限定名前缀不是贡献方插件 id、名不合规则、`type` 不在三者之中、`unready` 与 `type` 不符、非布尔键给了 `reason`，各使这一条声明以 `invalid-declaration` 被拒，原因可查；同一插件的其它贡献照常。
2. **同名**：同一限定名出现两条声明（两个插件，或同一插件的两个入口）时两条都被拒，与登记顺序无关。
3. **描述先于实现**：声明在拥有者入口激活前就在目录里，读取方此时读到 `unready` 与声明的取值。
4. **绑定**：拥有者入口激活时交出绑定，此后 `read` 同步调用它的读取函数，得到 `ready` 与当前值。
5. **未绑定**：入口激活了，但对某个已接受的声明明确给出“未绑定”时，该键为未就绪；这与读取函数恰好返回 `unready` 同值的 `ready` 区分得开。
6. **撤回**：拥有者入口停止时绑定撤回，键回到未就绪；入口再次激活后重新绑定。
7. **读取函数出错**：读取函数抛错或返回的类型与声明不符时，这次读取为未就绪，并按拥有者插件记一条诊断；不向读取方抛错。
8. **未声明与别处声明**：`read` 一个没有已接受声明的键为 `undeclared`；只在别的运行位置的入口里声明的键，在本实例同样为 `undeclared`。
9. **响应式失效**：在 `@vue/reactivity` 的 `computed` 或 effect 里读过某个键时，该键的绑定、撤回与拥有者状态的变化都使它重新求值；读取方不用另订阅。
10. **只在本实例**：读取不跨实例，不发远程请求；两个窗口里同一个键的值各自独立。

## 状态与转换

一个已接受声明的键在一个实例里的状态：

| 状态 | 进入 | `read` |
|---|---|---|
| 未就绪（未激活） | 登记成功；拥有者入口停止 | `unready` |
| 已绑定 | 拥有者入口激活并交出绑定 | `ready`（读取函数出错时这一次为 `unready`） |
| 未绑定 | 拥有者入口激活但对该键交“未绑定” | `unready` |
| 已删除 | 声明被拒，或拥有者插件登记撤销 | `undeclared` |

时序与寿命：

- 绑定在拥有者入口激活结算、贡献交付之后才可读；激活期间读到未就绪。
- 撤回与入口停止同一时机：入口开始停止后，读取不再调用它的读取函数。
- 读取函数在读取方调用 `read` 的同一调用栈里同步执行；绑定不缓存值。
- 拥有者入口重新激活是新的一代，旧的读取函数不会再被调用。

## 副作用与数据

无持久化：声明随插件定义，绑定随入口代次，都在内存里。读取函数出错时记诊断（来源为拥有者插件）。

## 失败与恢复

| 情况 | 结果 | 调用方怎么办 |
|---|---|---|
| 声明不合规则 | 这一条 `invalid-declaration`，原因可查 | 修正声明 |
| 同名 | 两条都 `duplicate-contribution` | 改名 |
| 读取函数抛错或类型不符 | 这次读取为未就绪，记诊断 | 由拥有者修正；读取方按未就绪处理 |
| `nbook.state` 不可用 | 依赖读取服务的入口按依赖规则受阻（[`runtime.plugins`](../runtime/plugins.md)） | 无 |

## 边界与兼容

- 公开接口：贡献点 `state.public` 的声明形状、限定名规则、读取服务与它的服务键。
- 声明形状将来扩展只加可选字段；`type` 的取值只增不改。
- 第三方插件的公开键随插件清单以 JSON 声明（[`runtime.plugin-manifest`](../runtime/plugin-manifest.md)），规则相同。
- 读取服务是同步的，按 [`runtime.plugin-api`](../runtime/plugin-api.md) 的选用规则属于内置插件之间的内部服务，只给内置插件依赖。第三方插件声明公开键不受影响；第三方读取公开状态的异步写法随第三方插件 API 设计。

## 验收与 Smoke

1. **懒激活的键**：Given 插件 A 的浏览器入口声明 `A/ready`（布尔，`unready: false`）、不随启动激活；Then 激活前读到 `unready`；激活并绑定后读到当前值；在 `computed` 里读过它的读取方随值变化重新求值；入口停止后回到 `unready`。
2. **两个窗口**：Given 两个窗口都装着 A；When 只在一个窗口把值改为 `true`；Then 另一个窗口读到的仍是自己的值。
3. **同名与别处声明**：Given 插件 B 也声明了 `A/x`；Then A、B 的两条都被拒（同名先于前缀检查），与登记顺序无关；B 撤销登记后 A 的一条恢复为已接受。同一插件服务端与浏览器入口都声明 `A/y` 时两条都被拒；只在浏览器入口声明的键，在服务端实例里为 `undeclared`。

Smoke：`e2e/state.e2e.ts`，同一浏览器的两个标签页里各自切换探针插件的公开键，命令面板的候选只随本页的值变化。

## 实现合同

- **公开入口**：`nbook/plugins/state/shared/contracts`（`PUBLIC_STATE_POINT`、`publicStateKey`、`PublicStateService`、`PublicStateDeclaration`、`PublicStateBinding`、`PublicStateRead`）；插件定义 `statePlugin`（`nbook/plugins/state/shared/plugin`，服务端、项目、浏览器三个入口代码相同）。插件作者写声明与绑定用 [`state.store`](store.md) 的 `definePublicState`。
- **owner 与依赖方向**：`nbook.state` 拥有贡献点 `state.public`，依赖 `nbook.diagnostics` 与 `@vue/reactivity`，未绑定键的声明从内核的已接受贡献查询；读取方（`nbook.commands` 的 `when`）只依赖 `publicStateKey`。
- **关键不变量**：
  - 贡献点校验只看这一条声明；同名交给内核的 `duplicate-contribution`，两条都拒（输出 1、2）。
  - 绑定在贡献方发布（接收者的 `published`）后才放进响应式绑定表，入口停止时撤回；`read` 先读这张表再同步调用读取函数、不缓存值，所以绑定、撤回与拥有者状态的变化都使读过它的 `computed` 重新求值（输出 4、6、9）。
  - 读取函数抛错或返回类型不符时这次读取为未就绪、按拥有者插件记诊断，不向读取方抛错（输出 7）。
  - 每个实例只认本运行位置入口声明的键，读取不跨实例（输出 8、10）。

## 证据

- 实现入口：[`state/shared/plugin.ts`](../../../packages/neuro-book/src/plugins/state/shared/plugin.ts)、[`state/shared/contracts.ts`](../../../packages/neuro-book/src/plugins/state/shared/contracts.ts)
- 合同测试：[`state.test.ts`](../../../packages/neuro-book/src/plugins/state/state.test.ts)（输出 1–10、验收 1–3）
- Smoke：[`state.e2e.ts`](../../../packages/neuro-book/e2e/state.e2e.ts)（测试外壳与真实服务端，本机 Chrome；另含开发模式的响应式运行时核对）
- 批准依据：[插件的数据与状态](../../proposals/plugin-data-model.md) 第 4、11 节（2026-10-07 `accepted`）；[多实例运行时拓扑](../../proposals/multi-instance-runtime-topology.md) 第 11 节 K5 行；开发者 2026-10-08 在 [t56 实施计划](../../../.agents/works/w00017-application-runtime-architecture/tasks/t56-plugin-state/plan.md) 中确认：公开状态做成贡献点 `state.public`、由内置插件 `nbook.state` 拥有，只在本实例求值、不做客户端镜像。
