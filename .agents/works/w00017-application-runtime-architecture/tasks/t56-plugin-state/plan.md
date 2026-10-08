# t56 实施计划：K5 插件状态 store 与公开状态

## Context

- **为什么做**：K1–K4 交付了多实例内核、项目子进程与 `nbook.storage`。插件作者还没有声明自己状态的统一入口：内存状态、Storage 记录、派生值、给 `when` 与别的插件读的公开值各写各的；命令的 `when` 也没有产品来源（`src/plugins/commands/shared/plugin.ts` 的 `PRODUCT_CONTEXT_KEYS` 为空，声明了 `when` 的产品命令一律被拒）。旧应用一个 store 深度监听整份状态再写回，3000 个文件时切换文件 0.9–1.6 s（t42）。紧接着的外壳切片要用 store 写布局状态、用公开状态写面板命令的可用条件（开发者 2026-10-07 确定外壳排在 K5 之后）。
- **依据**：[插件的数据与状态](../../../../../docs/proposals/plugin-data-model.md) 第 3、4、11 节与待定项 1（2026-10-07 `accepted`）；[多实例运行时拓扑](../../../../../docs/proposals/multi-instance-runtime-topology.md) 第 11 节 K5 行；[ADR 0024](../../../../../docs/adr/0024-multi-instance-runtime-topology.md)；Spec `workbench/commands.md`（`implemented`）、`runtime/plugins.md`（`implemented`）、`runtime/plugin-manifest.md`（`planned`）、`storage/persistence.md`（2026-10-08 `implemented`）。omp 计划审查（[evidences/omp-plan-review.txt](evidences/omp-plan-review.txt)）12 条已并入本稿。
- **配套稿已定的**：
  - `defineStore` 是插件作者声明状态的唯一入口：`config`、`persisted`、`memory`、`derived`、`public`、`actions`；默认私有，只有 `public` 对外；只经 `actions` 写；每个持久化字段声明落到哪条记录、何时写由 action 决定，不深度监听；服务端数据的副本不进 store。store 随入口激活创建、停止时释放，属于定义它的实例。
  - 持久化字段是四部分：读取分类、已确认值与 revision、当前显示、未保存意图与保存状态。默认值只用于呈现、不自动保存；订阅只更新已确认值，何时应用到显示由拥有者决定；同一记录按提交顺序串行保存；冲突后由拥有者的窄 reducer 只重放本次修改，再条件保存一次；失败保留意图与当前显示，可重试或放弃。
  - `when` 只读本实例内存里的公开状态，同步、不失败；给 `when` 用的是正向布尔键。公开键的限定名、类型、未就绪时的取值写在声明层，激活时绑定读取函数，入口停止即撤回；合法但未绑定的键按未就绪求值；引用未声明的键、类型不符在登记时拒绝；两个插件声明同一限定名时两条都拒绝；声明了却没绑定的键按未就绪，`public` 里多出未声明的键拒绝绑定并记诊断。
  - K5 与 K6 的分界：`config` 字段在 K5 固定声明形状，真实配置来源与变更链归 K6，K5 不交付桩实现。
- **形状调整（开发者 2026-10-08 同意先改计划）**：配套稿第 3 节的示例是对象写法（`persisted`、`memory`、`derived`、`public`、`actions` 几个分类）。类型原型实测，派生值引用另一个派生值时 TypeScript 推不出参数类型；公开键还要在插件定义、`public`、绑定处写三遍。本计划改为 setup 函数写法（第 3 节），六类数据与“只经 action 写”的要求不变；不直接用 Pinia（待确认第 2 项）。
- **拓扑稿 K5 行要求开始前固定**：公开键的静态声明（第 2 节）、持久化绑定的状态模型（第 3 节）、客户端镜像的键空间（不做镜像，改为直接问目标实例，第 6 节）。
- **与 t58、t59 的关系**：服务键按 id 识别、插件之间只引用对方的 `shared/contracts.ts`（ADR 0025）；插件定义是常量，宿主的东西走宿主能力服务（t59）。`nbook.state` 照此写成常量，本计划在 t59 之后实施。
- **现状**：
  - 命令表在创建时拿到一张上下文键表（键 → 不满足的原因），`when` 是这些键的 all-of，未登记的键在登记时拒绝（`src/plugins/commands/shared/context-keys.ts`）。产品表为空；Lab 命令场景用自己的表，值直接读 ref（`src/plugins/lab/web/fixtures/command-scene/`）。命令服务的 `onDidChange` 只在命令增减时通知，面板靠读取期间收集的响应式依赖刷新。
  - 内核的贡献校验是单条贡献的纯函数 `validate(descriptor)`，状态在查询时按存活登记推导、不缓存（`packages/nb-runtime/src/plugins/host.ts` 的 `#validation`）；入口贡献在贡献方激活时才交给接收者，已接受的入口贡献激活时必须给出实现。插件读不到贡献目录。
  - 每个实例只登记本位置的插件定义（后端与前端宿主各按清单装配本侧入口）：服务端的目录里没有浏览器入口的声明。
  - Storage 的订阅按写入顺序送达，但“只推当前状态，不重放中间值”，重连后只给当前基线；写请求派发后中断为 `unknown-outcome`，可能已经落盘（`storage/persistence.md` 输出 4、6 与“失败与恢复”）。
  - 正常停止时入口工作作用域先于必需依赖的借用释放：store 释放期间，本插件的 Storage 服务对象仍可用（`runtime/plugins.md` 输出 13）。宿主可给停止设截止（`runtime/application.md` 的 `stopDeadline`），但释放函数拿不到它：截止到达时停止结算为未完成，已在跑的释放继续跑（`runtime/lifecycle.md` 的关闭请求）。
  - 浏览器开发模式关闭了依赖发现，预构建清单写死在 `vite.config.ts`。
- **工作方式**：worktree `.worktree/w00017-runtime-foundation` 逐片提交，只暂存本片文件；测试用真实内核实例、真实 Storage 与 SQLite、进程内链路与本机 Chrome，不用 mock、spy、假计时器、固定等待；需要的时序只用真实运行时会出现的切口制造（见“验收映射”）；订阅类测试覆盖“首个事件早于建立返回”“结束早于建立返回”两种顺序；交付前对验收映射的每条判据做变异检查；主 Agent 编码，最后 omp（默认模型）只读审查。不修改 `packages/neuro-book-legacy`。

## 关键设计

### 1. 能力划分

| 能力 | 职责 | 依赖 |
|---|---|---|
| `state.public`（新 Spec `docs/specs/state/public-state.md`） | 公开键的声明与校验、激活绑定与撤回、本实例内的读取、未就绪、响应式失效 | `runtime.plugins` |
| `state.store`（新 Spec `docs/specs/state/store.md`） | `defineStore`：内存、持久化、派生、公开、action；持久化字段的状态与保存队列；寿命 | `storage.persistence`、`state.public` |
| `workbench.commands`（修订） | `when` 的键来自公开状态 | `state.public` |

### 2. 公开状态：贡献点 `state.public` 与内置插件 `nbook.state`（`packages/neuro-book/src/plugins/state/`）

- **声明**：入口下向贡献点 `state.public` 的贡献，贡献 id 是限定名 `<插件 id>/<名>`（与服务 id 同一规则），声明 `{type: "boolean" | "string" | "number", unready: <同类型的值>, reason?: LocalizedText}`；`reason` 只给布尔键，是值不为 true 时给用户看的原因。声明写在插件定义里、与命令贡献并列，内核目录在入口激活前就有它。
- **只声明一次**：插件作者用 `definePublicState(插件 id, {名: 声明})` 写一份常量，插件定义的入口贡献取它的 `contributions`，store 的 `publish` 也按它绑定（第 3 节），名字与类型由编译器核对，不在两处各写一遍。
- **校验**（点的 `validate`）：限定名前缀是贡献方插件 id、名字合规则、`unready` 与 `type` 一致。同一限定名两个插件都声明时由内核的 `duplicate-contribution` 两条都拒绝（现有行为）。
- **绑定与撤回**：实现是 `{kind: "bound", read(): 标量}` 或 `{kind: "unbound"}`。内核要求已接受的入口贡献都给出实现，store 的绑定助手对 `public` 里没有的声明交 `unbound`，所以“声明了却没给”与“读到的值恰好等于 unready”能分开。贡献方入口激活时交给 `nbook.state` 的接收者；入口停止时内核以 `scope-closed` 撤回，键回到未就绪。
- **读取服务** `publicStateKey`（`nbook.state` 在服务端、项目实例、浏览器三个位置各一份，同一份代码，各读本实例）：`read(key)` 返回 `{status: "ready", value}`、`{status: "unready", value: 声明的 unready}` 或 `{status: "undeclared"}`；`declaration(key)`。读取函数抛错或返回类型不符时按未就绪并记诊断。未绑定键的声明从内核目录取（第 5 节的 `context.declarations`）。
- **响应式失效**：绑定表放在 `@vue/reactivity` 的响应式集合里，`read` 无论走哪条路径都先读它，再同步调用 getter。绑定、撤回与 store 值的变化都会使读取过它的 `computed` 失效，命令面板不用另加通知；命令服务 `onDidChange` 的含义不变。
- 公开状态只在本实例求值，不跨实例查询，也不同步到别的实例；别的实例要知道某个窗口里的命令能不能用，直接问那个窗口（第 6 节）。

### 3. 插件状态 store（`packages/neuro-book/src/shared/store/`）

- **位置与响应式内核**（配套稿待定项 1，已确认第 2 项）：应用包里的插件作者库，不进内核（内核保持不依赖框架），不用 Pinia。三端都用 `@vue/reactivity`（加为直接依赖，版本跟 `vue` 一致，当前 3.5.39）。浏览器里它必须与 Vue 用同一份响应式运行时，否则组件里的 `computed` 不随 store 刷新（omp 审查实测）：`vite.config.ts` 的预构建清单加 `@vue/reactivity`，开发模式与构建产物各验一次（S6）。`definePublicState` 也在这里，贡献点 id 与声明 schema 从 `nbook.state` 的 `shared/contracts.ts` 引用（ADR 0025：插件之间在运行时只引用对方的合同模块）。
- **形状**（setup 函数，Pinia setup store 与 Vue 组合式 API 的写法）：

  ```ts
  // 公开键只声明一次：插件定义与 store 共用
  export const layoutPublic = definePublicState("nbook.workbench", {
      nonCompact: {type: "boolean", unready: false, reason: NARROW_REASON},
      layoutReady: {type: "boolean", unready: false},
  });

  export const layoutStore = defineStore("layout", ({persist, publish}) => {
      const sizes = persist(sizesRecord, {initial: DEFAULT_SIZES});  // 持久化字段
      const compact = ref(false);                                     // 内存
      const nonCompact = computed(() => !compact.value);              // 派生
      publish(layoutPublic, {nonCompact, layoutReady: computed(() => sizes.ready)});
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

- **setup 的约束**：每次 `create` 运行一次，同步执行，在一个 `effectScope` 里运行，其中建立的 `computed`、`watch` 随 store 释放一起停止。只经上下文给的 `persist`、`publish`（K6 加读配置的辅助函数）接触外部，不自己做 I/O、不持有入口之外的资源。
- **读写边界**：`store.state` 是返回的 `state` 经 `readonly` 包装后的只读视图；其中的持久化字段句柄对外换成只含数据的视图（读取分类、已确认快照、显示、保存状态），不带任何方法。可写的 `ref` 与字段句柄的方法只留在 setup 闭包里，`store.actions` 是唯一的写入口。
- **公开绑定** `publish(declarations, bindings)`：`bindings` 的键必须与声明完全一致、值是对应类型的 `ref` 或 `computed`，漏绑、多绑、类型不符编译不过（类型原型已核实）。运行时仍按声明核对一遍（给不经类型检查的调用方）：多出的不绑并记诊断，没给的交 `unbound`。`store.contributions` 是交给内核的激活产出。
- **寿命**：`create` 把 store 登记在 `context.scope` 上，随入口代次释放。停止开始时（`context.signal`）不再接受新 action；释放时等在途保存结束，再按队列顺序发送已接受的意图（含一次冲突重放），直到队列空或队首失败；剩下的意图以 `cancelled` 结算并记诊断（已确认第 5 项）。宿主的停止截止到达时内核不再等这次释放，释放继续跑到进程退出。随后结束 Storage 订阅、停止 `effectScope`；之后 action 抛错。
- **配置**：K5 不提供读配置的辅助函数，也不交付桩实现；它的形状（在 setup 里按配置键取只读的有效值）写进 Spec 标 planned，随 K6 实现。
- **持久化字段** `persist(record, {initial})` 返回字段句柄。数据：
  - `base`：最新的已确认快照，即 Storage 快照的非 error 分支（`missing` 可带删除标记的 revision，`ok`，`corrupt` 与 `unsupported-version` 带 revision 无值）；打开中为 null。**只从 Storage 订阅更新**：订阅按写入顺序送达，所以迟到的保存结果不会让它倒退。保存结果只结算意图，不写 `base`；revision 不比较大小。
  - `failure`：`open` 失败（如 `no-project`）、读取错误或订阅结束时的失败码，否则 null。`ready` 为 `base` 已有或 `failure` 已定；`canSave` 为 `failure` 为 null 且 `base` 是 `missing` 或 `ok`。
  - `display`：当前显示。创建时为 `base` 的值，`missing` 时用 `initial`（只呈现，不保存）。
  - `queue`：排队意图数；`save`：`idle | saving | failed | unknown`，`failed` 与 `unknown` 附失败码。
- **保存队列**（字段句柄的方法，只在 setup 闭包里）：
  - `show(value)`：只改显示（例如拖动中）。
  - `commit(change)`：显示立即变为 `change(display)`，意图排到队尾，返回的 Promise 以这条意图**第一次**尝试的结果结算（`saved`、`failed`、`unknown`、`protected`、`cancelled`）。
  - 队首发送：以 `base` 为基础算出要写的值（`missing` 时以 `initial` 为基础，`expect` 仍取该 `missing` 快照的 revision），条件保存。`ok` 则这条结算。`conflict` 时读最新快照，把同一个 `change` 作用在它上面再保存一次；仍冲突或其它确定的失败，队首记 `failed`，**队列暂停**，后面的意图保留不发。`base` 为 `corrupt` 或 `unsupported-version` 时 `commit` 直接以 `protected` 结算，只能显式 `reset(value)`（`expect` 取该快照的 revision）。
  - `unknown-outcome`：写可能已经落盘。队首记 `unknown`，保留**这次要写的具体值与 `expect`**，队列暂停；不在新基础上重算 `change`，否则同一次修改可能生效两次（omp 实测 count 1→2→3）。
  - `retry()`：只对暂停的队首。`failed` 时按队首发送重来；`unknown` 时，若 `base` 的值已与要写的值相同就视为完成，否则以原值、原 `expect` 重发，再冲突仍为 `unknown`。要不要放弃由拥有者决定。
  - `discard()`：只对暂停的队首，移除它并以 `discarded` 结算，显示改为把剩余意图依次作用在 `base` 上的结果，队列继续。在途时不能放弃，返回 `busy`。
  - `adopt()`：显示改为把排队意图依次作用在最新 `base` 上的结果；不清意图。订阅带来新的 `base` 不自动改显示。
  - 订阅结束（`provider-stopped`、`project-gone`、`server-restarted`、`released`）或 `open` 失败：记 `failure`，`canSave` 立即为 false，在途保存按结果结算，排队的意图暂停。`reopen()` 重新打开并订阅，成功后由拥有者 `retry`。不自动重开：提供方单独停止时调用方的 store 仍活着（omp 实测），要不要重开由拥有者在恢复时机决定。

### 4. 命令的 `when` 读公开状态（`packages/neuro-book/src/plugins/commands/`）

- 注册表不再在创建时拿一张键表，改为一个键来源：登记期 `problem(key)` 给出拒绝原因或 null，求值期 `value(key)` 给出布尔值与不满足的原因。产品来源由公开状态实现；Lab 命令场景把本地表包成同一接口，`value` 直接读它的 ref，保留面板的响应式依赖（已确认第 6 项）。
- `commands.definitions` 的校验函数用第 5 节的查询：`when` 引用的键必须是本实例目录里已接受的 `state.public` 声明、类型为布尔。未就绪按 false，原因取声明的 `reason`。
- `nbook.commands` 的入口依赖 `publicStateKey`；删去 `PRODUCT_CONTEXT_KEYS` 与它的注释。

### 5. 内核：校验函数与入口能查已接受的声明（`packages/nb-runtime/src/plugins/`）

- 新增 `ContributionDeclarations {get(capability, id); list(capability)}`：只列此刻校验为 `accepted` 的贡献的 `{plugin, entry, location, declaration}`，与 `#validation` 同样按存活登记推导、不缓存、不产生诊断。
- 交给两处：`ContributionPointDefinition.validate(descriptor, declarations)`（第二个参数，原有校验函数不受影响）；`ActivationContext.declarations`。
- **环**：推导时记下当前路径上的贡献身份。查询重新进入路径上已有的贡献时抛出环错误，它穿过中间各层，到被重新进入的那条贡献才转为 `invalid-declaration`（“校验相互引用”），中间各层不把它当普通校验异常吞掉。这样环上的每条贡献无论从哪里开始查都被拒，无环的多级查询（A 查 B、B 查 C）照常可用。
- 已知限制照旧：已交付的贡献因别的插件后来登记而改判为 `rejected` 时不撤回已有交付，运行期出现与消失归 `runtime.plugin-hot-plug`。

### 6. 跨实例命令：问目标实例（`packages/neuro-book/src/plugins/commands/`）

- **规则**：`when` 只在命令所在的实例求值。服务端命令的 `when` 只能引用服务端声明的键（登记期校验只看本实例的目录，自然成立）。别的实例要列出或执行某个窗口里的命令，直接问那个窗口，不在服务端保存窗口状态的副本。
- **远程服务** `nbook.commands/remote`（合同在 `commands/shared/contracts.ts`）：提供方位置 `client`，浏览器的 `nbook.commands` 入口提供；调用方位置 `server`（第一版只允许服务端调用，即拓扑稿待定项 3 的结论）。
  - `list({})`（读）：本实例的命令元数据（id、标题、描述、参数 schema、`effect`、暴露策略），每条带此刻按本地公开状态求出的可用性与不满足的原因；只列 `expose.agent` 不为 `never` 的命令。
  - `execute({id, args})`（写）：以 `{source: "agent", callerId: 调用方插件}` 走本地命令表的执行管线，执行前按本地状态复查 `when`，返回 `CommandResult`。要确认的命令返回 `confirmation-required`（确认界面随 Agent）。
- **失败**：窗口不在或断线由远程服务的失败码给出（`target-gone`、`unavailable`）；`execute` 是写方法，派发后断线为 `unknown-outcome`，与内核的规则一致。
- **服务端用法**：服务端插件以 `context.remote.use(commandsRemoteContract).at({client: 窗口实例 id})` 调用；窗口实例 id 从 `context.remote.instances()` 取。默认对哪个窗口由调用方决定（以后的 Agent 默认是发起会话的窗口）。
- 不做镜像的理由与代价见“已确认”第 1 项。

### 7. 宿主接线与测试探针

- `nbook.state` 进产品清单（`src/manifest.ts`）与三个宿主的装配（`src/server/plugins.ts`、`src/project/plugins.ts`、`src/web/plugins.ts`），`nbook.commands` 依赖它；`vite.config.ts` 预构建清单加 `@vue/reactivity`。
- `test.remote-probe` 的服务端入口加控制路由，经 `nbook.commands/remote` 列出与执行指定窗口的命令（第 6 节的 e2e 用）。
- `test.remote-probe` 的浏览器入口：声明一个公开布尔键与一条带 `when` 的命令；store 有一个持久化字段，绑新的探针记录 `probe-pair`（user/local，值为两个独立字段 `{left, right}`，用来证明两个窗口各自的窄修改都保留）。`window.__nbRemoteProbe` 加切换键值、提交、读字段状态与冲突次数的调试接口，供 e2e 使用。

## Spec 与文档改动（S0）

| 文档 | 改什么 |
|---|---|
| `docs/specs/state/public-state.md`（新，`planned`） | 第 2 节的合同：声明、校验、绑定与撤回、`unbound`、读取与未就绪、响应式失效、只在本实例求值、不同步到别的实例 |
| `docs/specs/state/store.md`（新，`planned`） | 第 3 节的合同：setup 写法与它的约束、读写边界、`definePublicState` 与 `publish`、寿命与停止时的队列结算、持久化字段的数据、保存队列与各操作的结果、`unknown-outcome`、订阅结束与 `reopen`；读配置的辅助函数标 planned 并链接 K6 |
| `docs/specs/README.md` | 注册两份新 Spec |
| `docs/specs/workbench/commands.md` | 上下文键改为公开状态的布尔键，`when` 在登记时按公开状态的声明校验、未就绪按 false；`when` 只在命令所在的实例求值；跨实例列出与执行命令（第 6 节）；新条目标“（planned）”；“上下文键（第一批）”一节说明它们是 Lab 本地表 |
| `docs/specs/runtime/plugins.md` | 输出第 15 条增补校验函数与入口可查已接受的声明、环的判定（planned） |
| `docs/specs/runtime/plugin-manifest.md` | 公开键作为入口下的 `state.public` 贡献声明 |
| `docs/specs/runtime/plugin-api.md` | 插件状态入口改为 `defineStore`，链接 `state/store.md` |
| `docs/proposals/plugin-data-model.md` | 决策记录追加一行：形状调整与不用 Pinia、待定项 1 的结论、公开状态做成贡献点、`unknown-outcome` 不重算、第 4 节“镜像”改为直接问目标实例（实施中修正：提案 `accepted` 后正文冻结，第 3 节的示例不改，以 `state/store.md` 为准） |
| `docs/proposals/multi-instance-runtime-topology.md` | 决策记录：K5 不做客户端镜像，跨实例命令改为直接问目标实例；`.at({client})` 第一版只允许服务端调用（待定项 3） |

## 切片

| 片 | 对应设计 | 提交边界 | 自跑验证 |
|---|---|---|---|
| S0 | Spec 改动表 | 文档；验收映射改写为新 Spec 的编号 | `bun run docs:check`、`bun run governance:check` |
| S1 | 第 5 节 | 内核的声明查询与环判定 | `bun run --cwd packages/nb-runtime typecheck`、`test`；`bun run --cwd packages/neuro-book typecheck` |
| S2 | 第 2 节 | `nbook.state`：贡献点、接收者、响应式读取服务；三个宿主接线 | 同 S1，另 `bun run --cwd packages/neuro-book test:bun` |
| S3 | 第 4 节 | 命令的键来源、`when` 校验与求值、Lab 适配 | 同 S2，另 `test:vitest` |
| S4 | 第 3 节的形状、setup 约束、读写边界、公开绑定、寿命 | `defineStore`、`definePublicState`、`publish`；`@vue/reactivity` 依赖与预构建清单 | 同 S3 |
| S5 | 第 3 节的持久化字段与保存队列 | 持久化字段 | 同 S2 |
| S6 | 第 6 节 | 跨实例命令：远程服务、浏览器入口提供、服务端调用 | 同 S3 |
| S7 | 第 7 节 | 测试探针与 e2e（构建产物与开发模式） | 同 S3，另 `test:e2e` |
| S8 | — | Spec 实现合同与证据、Task 证据、omp 审查与修正 | `bun run test:affected --typecheck --since <计划提交>`、`test:e2e`、`smoke:server`、`docs:check`、`governance:check`；记录 `dist/server` 体积变化 |

## 验收映射

实施中的调整：

- 切片顺序：S4、S5（store）先于 S1 提交。t59 的 omp 审查进行时不改它在审的内核文件，store 也不依赖 S1。
- 内核另加贡献接收者可选的 `published` 回调（`runtime/plugins.md` 输出 24）：commit 时贡献方的激活还可能失败撤回、`implementation()` 取不到，激活事务的发布又可能隔着 await；`nbook.state` 在 commit 时就把绑定放进响应式表的话，这段时间里读过它的 computed 会停在“未就绪”且之后没人让它失效。
- 开发模式的 e2e 不跑“面板即时变化”：开发会话只有产品与 Lab，没有声明公开键的插件。它要防的是 store 与 Vue 用了两份响应式运行时，改为直接核对预构建的 `@vue/reactivity` 与 `vue` 导出同一个 `ref`（去掉 Vite 预构建项的变异得到 false）。
- `WorkbenchCommandHost.dom.test.ts` 不增补：面板随公开状态变化由 `plugin.test.ts`（computed 随值与入口停止变化）与 `state.e2e.ts`（生产构建里面板开着时切换）覆盖。


| Spec 条目 | 测试 |
|---|---|
| `state/store.md` 输出 1–3 | `src/shared/store/store.test.ts`“输出 1–3”；同文件的类型合同（`@ts-expect-error`） |
| `state/store.md` 输出 4 | `store.test.ts`“输出 4”；`state.test.ts` 的读取 |
| `state/store.md` 输出 5–8 | `store.test.ts`“输出 5–8” |
| `state/store.md` 输出 9–11、验收 1 | `store.test.ts` 两个窗口窄改（恰好重放一次）、重放后仍冲突、discard、`change` 在最新值上抛错、`show` 与冻结的参数；`e2e/state.e2e.ts` 在真实 Chrome 两个标签页里窄改都保留（冲突是否发生取决于时序，不作为重放的证据） |
| `state/store.md` 输出 12 | `store.test.ts` 删除标记、`corrupt`、`unsupported-version` 三例（坏数据由测试直接写进库） |
| `state/store.md` 输出 13–14、验收 2 | `store.test.ts` 结果不确定两例（分区拥有者一侧的订阅者在收到这次写入的通知时关掉窗口链路） |
| `state/store.md` 输出 16、验收 4 | `store.test.ts` 提供方停止一例（项目实例有序停止，`reopen` 在提供方回来之前仍失败）、读取错误一例（库表临时改名得到真实的读取错误，恢复后 `reopen` 拿到基线、`retry` 落盘） |
| `state/store.md` 输出 17、验收 3 | `store.test.ts` 窗口里正常停止、队首失败后 `cancelled` 两例 |
| `state/store.md` 输出 6 的“迟到的保存结果不倒退” | 由“`base` 只随订阅更新”的结构保证；进程内链路造不出“结果先于基线到达”的时序，不单独测 |
| `state/public-state.md` 输出 1–10、验收 1–3 | `src/plugins/state/state.test.ts`（真实内核实例） |
| `workbench/commands.md`“`when` 读公开状态”、验收 15 | `plugins/commands/shared/plugin.test.ts` 增补（computed 随值与入口停止变化） |
| `workbench/commands.md`“跨实例列出与执行”“跨实例调用失败”、验收 14 | `src/plugins/commands/shared/remote.test.ts`（含列出后窗口状态变化、执行时复查与审计里的调用方）、`e2e/state.e2e.ts` |
| `runtime/plugins.md` 输出 23、验收 26 | nb-runtime `src/plugins/declarations.test.ts` |
| 浏览器里组件的 `computed` 随 store 与公开状态刷新（`state/store.md`“边界与兼容”） | `e2e/state.e2e.ts`：生产构建的测试外壳里面板开着时切换开关、候选即时变化；开发模式核对预构建的 `@vue/reactivity` 与 `vue` 导出同一个 `ref` |

## 验证

- 每片：上表的自跑命令。
- 收口：`bun run test:affected --typecheck --since <计划提交>`、`bun run --cwd packages/neuro-book test:e2e`、`smoke:server`、`docs:check`、`governance:check`；对验收映射的每条判据做变异检查。
- 端到端：`e2e/state.e2e.ts` 用测试外壳与真实服务端子进程，在本机 Chrome 里走完“同一客户端两个标签页 → 一边打开开关，面板只在这一边列出带 `when` 的命令，面板开着时即时变化 → 两边在同一轮里各自窄改 `probe-pair` 的一个字段 → 一边冲突后重放成功，两个字段都保留 → 另一边 `base` 更新而显示不变，`adopt` 后更新”；开发模式另跑面板即时变化一条。
- 未验证的边界：TUI 的命令（同一远程服务，TUI 宿主接入时验证）；Agent 选择目标窗口与确认流程（随 Agent）；`config` 字段（K6）；外壳的产品接入；浏览器页面关闭时的保存（页面卸载不等 Promise，只能尽力）。

## 不做与风险

- **不做**：`config` 字段的实现（K6）；按命令触发的激活事件（懒激活插件的命令仍在激活后才进命令表）；服务端数据副本的查询缓存（配套稿待定项 2）；只读检视（待定项 3）；产品消费者（已确认第 4 项）；客户端镜像（已确认第 1 项）；`unknown-outcome` 的自动判定（要操作 id 与去重合同，另行设计）。
- **风险**：
  - `validate` 多一个参数：内核里所有贡献点不受影响；环由路径判定拒绝。
  - `workbench.commands` 是 `implemented`：新条目标 planned，现有测试（Lab 场景与命令面板）先原样通过再换键来源。
  - `@vue/reactivity` 进服务端与项目子进程：打包体积小幅增加；浏览器里漏进第二份响应式运行时会让组件不刷新，由开发模式与构建产物两条 e2e 把关。

## 已确认（开发者 2026-10-08）

开发者同意按推荐的做，“先做出来再继续看”。

1. **跨实例命令直接问目标实例，不做客户端镜像**（取代原先的“推迟”建议）。配套稿第 4 节的镜像是为了让服务端同步、不失败地判断窗口状态；服务端现在没有这样的使用方，列出与执行窗口命令本来就是异步的，直接问窗口得到的总是那一刻的真实状态，也不用让浏览器的声明在服务端可见。`when` 只在命令所在的实例求值；`.at({client})` 第一版只允许服务端调用（拓扑稿待定项 3）。代价：服务端判断一个窗口的命令要一次往返；以后出现必须同步判断窗口状态的使用方时再加镜像。结论记入拓扑稿与配套稿的决策记录。
2. **store 用 setup 写法、自己用 `@vue/reactivity` 实现，放应用包的共享库**（`src/shared/store/`），不进内核，不用 Pinia（配套稿待定项 1）。
   - 写法：对象写法在派生值互相引用时推不出类型，公开键要写三遍；setup 写法类型自然推断，`publish` 的漏绑、多绑、类型不符编译不过（类型原型已核实）。
   - 不用 Pinia：它是全局注册表，谁导入了定义都能拿到并改状态（`$patch`），而这里要求归插件私有、只经 action 写；它的 store 在一个 pinia 实例里是单例，这里要随入口代次创建与释放；它的对等依赖是完整的 `vue`，服务端与项目子进程只需要 `@vue/reactivity`；持久化字段与公开绑定无论如何都要自己写。Pinia 多给的是 Vue devtools 面板与热更新，需要时可单独接 `@vue/devtools-api`。
   - 不进内核：内核目前只依赖 TypeBox，放进去会让它依赖一个响应式框架。代价：浏览器里要保证与 Vue 共用一份响应式运行时（第 3 节）；第三方插件以后从插件公开 API 的包拿到它，随 `runtime/plugin-api.md` 定。
3. **公开状态做成贡献点 `state.public`，由新内置插件 `nbook.state` 拥有**，限定名 `<插件 id>/<名>`，内核只加“查已接受的声明”。复用现有的目录、去重、激活交付与撤回，内核不新增“公开状态”概念。备选是放进 `nbook.commands`：公开状态还要给 Agent 与别的插件读，不只是 `when`，所以建议单独一个插件。
4. **K5 没有产品消费者**，外壳是第一个；本 Task 用测试探针验证。备选是把命令面板最近使用改成持久化字段作为样板，但配套稿第 8 节把它定为运行状态。
5. **正常停止时发出已接受的意图**：停止开始即封闭 action；释放时按队列顺序发送已接受的意图，直到队列空或队首失败，剩下的以 `cancelled` 结算并记诊断；宿主的停止截止只决定内核等多久，不中断这次释放。理由：store 释放时本插件的 Storage 服务对象仍可用（必需依赖的借用后释放），已被 action 接受的修改丢掉是主动丢数据。备选是停止时直接丢弃未发出的意图（停止更快、可预测，但正常关闭也会丢掉刚做的修改）。强制退出与浏览器页面关闭都不保证。
6. **Lab 命令场景保留本地键表**：Lab 是开发工具，场景自带命令表与键，不进产品的公开状态；注册表的键来源接口同时满足两者。
