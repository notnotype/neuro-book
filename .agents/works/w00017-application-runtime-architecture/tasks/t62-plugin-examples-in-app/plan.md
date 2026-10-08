# t62 实施计划：示例插件搬到应用包并重组

## Context

- **为什么做**：开发者 2026-10-08 在 t60 的讨论中决定（Task README 记有原话来源）：
  - 示例教的是怎么写应用插件，要和内置插件（`nbook.storage`、`nbook.state`、`nbook.commands`）一起用。放在内核包 `packages/nb-runtime/examples/` 里引用内置插件，内核包就要依赖应用包，形成包之间的循环依赖，所以搬到 `packages/neuro-book/examples/`。
  - 示例在精不在多，8 个合并为 5 个；注释与文档要特别丰富，为此给示例开注释规则的例外。
  - `testing/` 目录的约定写进测试规范，并用架构检查拦住产品代码引用它。
- **期望结果**：
  - 内核包只留自己的合同测试；
  - 应用包的 `examples/` 有 5 个示例插件、5 个场景，覆盖内核的主要机制和内置插件的用法；
  - 每一步的注释讲清“做什么、为什么、不这样会怎样”，并链接 Spec；
  - `testing/` 有成文约定与机检。
- **依据**：[`runtime.plugins`](../../../../../docs/specs/runtime/plugins.md)、[`runtime.services`](../../../../../docs/specs/runtime/services.md)、[`runtime.plugin-api`](../../../../../docs/specs/runtime/plugin-api.md)（选用规则、可选功能）、[`runtime.plugin-channel`](../../../../../docs/specs/runtime/plugin-channel.md)（含 t61 的 `not-provided` 与输出 11 查询）、[`storage.persistence`](../../../../../docs/specs/storage/persistence.md)、[`state.store`](../../../../../docs/specs/state/store.md)、[`state.public`](../../../../../docs/specs/state/public-state.md)、[`workbench.commands`](../../../../../docs/specs/workbench/commands.md)；[ADR 0026](../../../../../docs/adr/0026-plugin-definitions-as-constants.md)。
- **行为合同**：不变。本 Task 只搬迁与重写示例、补规范与检查，不改内核与内置插件的行为；发现示例写不出来的内核缺口，记下交开发者，不在本 Task 里改内核。
- **工作方式**：
  - 由子代理在独立 worktree `.worktree/w00017-t62-examples`（分支 `refactor/w00017-t62-examples`，从本计划的提交切出）实施，逐片自跑验证、单独提交。
  - 主 Agent 审查后合回 `refactor/w00017-runtime-foundation`。与正在收口的 t61 并行：t61 只动 `packages/nb-runtime/src/remote/`、个别 Spec 与 t61 目录。
  - 测试用真实内核实例与真实内置插件，不用 mock、spy、假计时器与固定等待；时间由注入时钟推进；临时目录按 [`docs/testing/README.md`](../../../../../docs/testing/README.md) 的“临时目录与环境键”。

## 关键设计

### 1. 目录与引用规则（`packages/neuro-book/examples/`）

```text
packages/neuro-book/examples/
├── README.md               # 目录、概念、阅读顺序；不贴代码片段
├── plugins/<插件>/         # 与内置插件相同的目录格式：plugin.ts、shared/contracts.ts、backend/、web/
├── scenarios/NN-*.test.ts  # 场景：把插件装进运行实例、核对行为
└── testing/                # 场地（stage.ts）与探针（probes.ts）；不含断言
```

- 示例插件按第三方插件的写法：
  - 运行时只引用内置插件的 `nbook/plugins/<插件>/shared/contracts`，以及别的示例插件的 `shared/contracts.ts`；类型可以 `import type`；
  - 内核只经 `@notnotype/nb-runtime/<机制>` 引用；
  - `web/` 与 `backend/` 互不引用。
- 场地 `testing/stage.ts` 是宿主代码。它像产品宿主那样，把内置插件的定义（诊断、`nbook.state`、`nbook.commands`、`nbook.storage`）与示例插件装进各实例，提供宿主能力（时钟、状态根、项目）。服务端带路由，项目实例与窗口经 `@notnotype/nb-runtime/remote/testing` 的进程内链路连上。可以参照 `src/plugins/storage/testing/world.ts` 与内核原来的 `examples/scenarios/hosts.ts`。
- 类型检查：
  - `tsconfig.json` 的 `include` 加 `examples/testing`、`examples/scenarios`、`examples/plugins/*/plugin.ts`、`examples/plugins/*/backend`、`examples/plugins/*/shared`；
  - `tsconfig.web.json` 加 `examples/plugins/*/web`、`examples/plugins/*/shared`、`examples/plugins/*/plugin.ts`。
  - `bun test` 从包根运行，自然收进 `examples/scenarios`。
- 内核包：
  - 删除 `packages/nb-runtime/examples/`（用 `git mv` 搬到应用包，保留历史）；
  - `tsconfig.json`、`tsconfig.browser.json` 去掉 `examples`；
  - `packages/nb-runtime/AGENTS.md` 的示例一句改为指向应用包的 `examples/`；
  - 应用包 `AGENTS.md` 的目录约定补一条 `examples/`。

### 2. 五个示例插件（`examples/plugins/`）

每个插件只演示少数几件事；讲解写在代码旁，链接 Spec。

| 插件 | 运行位置 | 演示什么 | 由哪几个旧插件合并 |
|---|---|---|---|
| `clock` | server | 依赖宿主能力（`hostClockKey`），包成共享服务（`provide`）；不声明激活事件，有入口依赖它时才激活；`context.scope.register` 登记一个随入口停止释放的资源（例如按注入时钟每分钟刷新的“当前小时”缓存），`context.signal` 得知停止 | clock |
| `notes` | server、browser | 服务端：依赖内置的 `nbook.storage`（必需依赖，笔记落进真实 SQLite，按调用方插件分开）；可选依赖 `clock`（`context.services.resolve`，有时给笔记打时间，没有时 `missing-provider` 照常工作）；提供远程合同 `example.notes/remote`，`provideRemote` 的工厂按调用方生成门面；事件 `changed`。浏览器端：按调用方提供本地服务（`providePerConsumer`），以收到的调用方身份（`context.remote.on`、`remoteDelegates`、代理允许清单）订阅 `changed`，维护一份**同步可读的笔记缓存**。按选用规则，在远程服务之上加了“同步视图”才值得包一层，不写只转发的包装 | notes、cloud-notes、greeter |
| `counter` | server、project | 一份后端定义含两个入口。`server` 入口：远程合同 `example.counter/remote`（第一次调用时按需激活、订阅、提供方看到的调用方）；用 `defineStore` 声明计数（持久化进 `nbook.storage`）与公开键 `example.counter/nonzero`；向 `nbook.commands` 贡献命令 `example.counter.reset`，`when` 引用该公开键。`project` 入口：每个项目实例一份的计数，合同 `provider: "project"`，窗口省略 `.at()` 即到达绑定的项目 | counter、board |
| `menu` | server | 定义贡献点 `menu.items`：逐条校验、接收者 `published` 与 `revoke`、执行时经 `implementation()` 取实现；`context.declarations` 列出已接受声明的标题，贡献方还没激活也列得出 | menu |
| `file-menu` | server | 向贡献点提交声明与实现，与拥有者之间没有服务依赖 | file-menu |

### 3. 五个场景（`examples/scenarios/`）

| 场景 | 插件 | 核对的行为 | 行为合同 |
|---|---|---|---|
| `01-services` | clock、notes（服务端） | 依赖解析与激活顺序；宿主不给时钟能力时 clock 受阻、notes 照常（可选依赖为 `missing-provider`）；给了时笔记带时间；入口停止时 `context.scope` 登记的资源释放、`signal` 触发 | services、plugins、application |
| `02-per-consumer` | notes（服务端） | 两个调用方插件各自只看到自己的笔记；调用方入口停止后它的门面释放；服务端实例重启后笔记仍在（同一状态根下的真实 SQLite） | services 输出 11–12、plugin-channel、persistence |
| `03-contribution-point` | menu、file-menu | 校验不合格只拒那一条；贡献方发布后可执行、停止后撤回；`context.declarations` 在贡献方未激活时已列出标题 | plugins 输出 15–18、23 |
| `04-remote-service` | counter | 窗口调用服务端与绑定的项目，订阅随发起入口停止而结束，`orThrow` 只取值；计数持久化、公开键变化使命令 `example.counter.reset` 可用与不可用；`context.remote.lookup` 在调用前得知项目实例没有装 counter（`not-provided`），窗口里的面板据此降级、不激活提供方；`instances()` 列出实例 | plugin-channel、projects、store、public-state、commands |
| `05-delegating-proxy` | notes（浏览器端） | 窗口里两个插件经代理各写各的笔记，服务端看到原调用方与 `via`；同步缓存随服务端的 `changed` 更新；不在代理允许清单时为 `denied` | services 输出 13、plugin-channel 输出 10 |

场景顶部各写一段讲解：这个场景要说明什么、阅读顺序、与哪几个插件对应。

### 4. 教学注释的例外（根 `AGENTS.md`、`docs/standards/code/common.md`）

- 在两处“注释”一节各加一条例外：`packages/neuro-book/examples/` 的注释是教学材料，可以逐步讲解这一步做什么、为什么、不这样会怎样，并链接 Spec；讲解随场景测试一起改。产品代码的注释规则不变。
- `examples/README.md` 只做目录、概念、阅读顺序与“写法与维护”，不贴代码片段。旧 README 里的概念表与关系图保留并改写到新插件上。

### 5. `testing/` 目录的约定与检查（`docs/testing/README.md`、`packages/neuro-book/src/architecture.test.ts`）

- **约定**：写进 `docs/testing/README.md` 的“测试文件组织”。
  - `testing/` 放测试支持代码：测试工具、测试插件与测试入口、共用场地、e2e 外壳。
  - 它不含断言，可以带参数。
  - 产品代码不引用 `testing/`，也不引用内核的 `*/testing` 入口。
  - `e2e` 构建配置（`vite.e2e.config.ts`）引用 e2e 外壳是唯一的例外。
- **检查**：`architecture.test.ts` 增加三条规则，并在“每条规则都能拦下对应的违规”里各补反例：
  1. 产品代码（`src/` 下除测试文件与 `testing/` 以外）不得导入路径段含 `testing` 的模块，也不得导入 `@notnotype/nb-runtime/*/testing`；
  2. 产品代码不得导入 `examples/`；
  3. 扫描范围扩到 `examples/plugins/`，示例插件按插件规则检查：跨插件的运行时导入只指向对方的 `shared/contracts.ts`（含内置插件），`web/` 与 `backend/` 互不引用。

### 6. 文档同步

- `docs/modules/monorepo-boundaries.md` 内核一行的“零运行时依赖”改为“运行时依赖只有 TypeBox”，并指向应用包的示例；根 `AGENTS.md` 仓库结构里 `nb-runtime/` 一行的“零依赖”同样改。
- 搜索 `docs/`、各 `AGENTS.md` 与两个包里对 `nb-runtime/examples` 的引用，一并改到新位置。`.agents/works/` 下已完成 Task 的历史记录不改。

## 切片

| 片 | 对应设计 | 提交边界 | 自跑验证 |
|---|---|---|---|
| S0 | 第 4、5 节的约定、第 6 节 | 根 `AGENTS.md`、`common.md`、`docs/testing/README.md`、`monorepo-boundaries.md` | `bun run docs:check`、`bun run governance:check` |
| S1 | 第 1 节 | `git mv` 搬迁原样的 8 个插件与 6 个场景，改引用、tsconfig 与两个包的 `AGENTS.md`，场景照旧通过 | 两包 `typecheck`；`bun run --cwd packages/nb-runtime test`；`bun run --cwd packages/neuro-book test:bun` |
| S2 | 第 5 节的检查 | `architecture.test.ts` 的三条规则与反例 | 同 S1；把一条规则的判定改成永远不报，确认反例用例失败 |
| S3 | 第 2、3 节：clock、notes 与场景 01、02、05 | 新场地 `testing/stage.ts` 装内置插件；clock、notes 合并重写 | 同 S1 |
| S4 | 第 2、3 节：counter、menu、file-menu 与场景 03、04 | counter 合并 board，加 store、公开键、命令、`lookup` | 同 S1 |
| S5 | 第 4 节的 README、收口 | `examples/README.md` 重写；删去不再用的旧文件；Task 证据 | `bun run test:affected --typecheck --since <计划提交>`、`docs:check`、`governance:check` |

每片交付前，对本片的关键断言做一次变异检查：回退对应实现，确认场景失败。

## 验收映射

| 行为 | 由谁覆盖 |
|---|---|
| 场景覆盖第 2 节表里每个插件演示的机制 | 第 3 节五个场景 |
| 内核包不再含示例、不依赖应用包 | 内核 `typecheck` 与 `test`；`packages/nb-runtime/package.json` 没有对应用包的依赖 |
| 产品代码不引用 `testing/`、内核 `*/testing` 入口与 `examples/`；示例插件只经合同模块互相引用 | `src/architecture.test.ts` 的规则与反例 |
| 示例不进产品构建 | 产品清单不引用示例；架构规则 2；主 Agent 合回后跑 `bun run --cwd packages/neuro-book build`（含 `check:dist`） |

## 验证

- 每片：见切片表。
- 收口：子代理跑 `test:affected --typecheck --since <计划提交>`、`docs:check`、`governance:check`。主 Agent 合回后再跑应用包 `build`（含 `check:dist`），并与 t61 的收口一起跑 e2e。
- 未验证的边界：示例只在进程内链路上运行，真实浏览器与真实子进程里的同样用法由产品的 e2e 覆盖，示例不另起 e2e。

## 不做与风险

- **不做**：
  - 拥有者定义的激活事件（`activationEventPrefixes`）的示例。现在只有宿主能调用 `PluginHost.triggerActivationEvent`，激活上下文里没有触发入口，插件写不出“菜单打开时才激活贡献方”。这是内核缺口，交开发者决定是否补一个面向插件的触发接口；本 Task 只在 `file-menu` 的注释里说明为什么它要启动即激活。
  - 工作台视图的示例（随外壳实现补）。
  - 插件清单文件格式（`runtime.plugin-manifest` 实现后再改）。
- **风险**：
  - 示例装进真实内置插件后场景变慢。场地按需装插件，每个场景只起需要的实例；超过 200 毫秒的场景在收口报告里列出。
  - 示例第一次真正使用 `defineStore` 与服务端的 `nbook.storage`，可能暴露这些内置插件的问题。属于内置插件的缺陷，记下并交主 Agent，不在示例里绕开。

## 实施中的调整

实施时发现的事实与改法，按切片记录。

- **S1**：`packages/nb-runtime/AGENTS.md` 的“边界”里也写着“运行时零依赖”，与 `monorepo-boundaries.md` 同一处过时，一并改为“运行时依赖只有 TypeBox”。`runtime/plugins.md` 里没有指向示例目录的引用（只有“证据”一节指向 t57 Task 的历史链接），不改。
- **S3**：
  - **宿主时钟的键留在 `examples/shared/host.ts`**。第 1 节的目录树没有 `shared/`；但产品宿主没有时钟能力，示例插件又不能引用 `testing/`（规则 1 的精神），键只能放在插件与场地都能引用的平台中立处。`HostClock` 加了 `schedule`，与内核 `RuntimeClock` 同形。
  - **可选依赖的原因分两种**。实测 clock 装了但因缺宿主时钟受阻时，notes 解析可选依赖得到 `provider-rejected`，不是计划写的 `missing-provider`；只有根本没装 clock 才是 `missing-provider`。场景 01 两种都覆盖，notes 按原因记 `info` 或 `warn` 诊断，正好对应 `runtime.plugin-api` “可选功能”表的两种情况。
  - **clock 不做“当前小时”缓存**，改为 `until(at)`：入口只占一个宿主计时器，对准最早的等待；计时器登记在 `context.scope` 上、收口时释放；`context.signal` 一触发就把还在等的调用以 `stopped` 答复。这样两者分工不同、各自可以观察（场地时钟数出未释放的计时器；停止完成后等待已结算），变异检查也能分别打到。实测整个实例停止时，内核先向所有入口发出 signal、再按依赖逆序释放资源，注释里的说法以此为据。
  - **clock 的服务改为异步方法**（`now()`、`until()` 返回 Promise）：示例按第三方插件的写法，本地服务按数据面约束写（`runtime.plugin-api` 的“远程形态约束”）。
  - **notes 的笔记带 `via` 字段**（经哪个插件代理写入），场景 05 用它观察“服务端看到 via”；合同 `callers` 为 `server`、`browser`，服务端插件直接用合同。
  - **场景 02 的“门面释放”**：远程门面没有 `ServiceRevokedError`，可观察的是调用方停止后它手里的旧客户端得到 `cancelled`、同一插件下一代读到原来的笔记、别的调用方不受影响。实测 `provideRemote` 的 `release` 在调用方停止时被调用；浏览器入口在门面工厂里取 `remote.on(调用方)` 得到 `denied`，注释据此写。
  - 场地加了 `Stage.attach(app, 定义, 入口)`：把插件装进子作用域并激活，返回停止函数，用于演示调用方停止。
  - 旧场景 03、04、06 在 S4 之前仍用旧的 `scenarios/hosts.ts`，只把探针的导入改到 `testing/probes.ts`；`hosts.ts` 在 S4 删除。README 只改了插件与场景表，S5 重写。
