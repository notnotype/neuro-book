# t58 实施计划：服务键按 id 识别、插件后端目录改名 `backend/`、补项目级示例

## Context

- **为什么做**：开发者 2026-10-08 看示例插件时指出三处模糊（t57 的讨论）：工厂参数各不相同（有的收宿主配置、有的收别的插件的服务键、有的没有）；插件、入口、服务等概念不清；插件只有 `server/`、`web/` 两个目录，看不出应用级、项目级、客户端级。同日开发者同意三项改动，并要求相关规范文档一起改：
  1. 服务键改为按服务 id 字符串识别，工厂参数只剩宿主给的配置；
  2. 插件里放后端代码的 `server/` 目录改名 `backend/`（服务端与项目子进程共用这份代码）；
  3. 补项目级示例，示例 README 讲清“插件两端用远程服务、对外用本地服务”。
- **现状**：
  - `defineServiceKey(name)` 每次返回新对象，同名不等价（`packages/nb-runtime/src/services/services.ts`）；装配只认 `ApplicationManifest.keys` / `ServiceAssemblyOptions.keys` 里登记过的键，登记时引用未登记的键为 `unknown-service-key`（`plugins/registration.ts`）。内核在 `services/assembly.ts`、`composition.ts`、`plugins/blocked.ts`、`host.ts` 里以键对象作 Map 的键；`blocked.ts` 另因 `AssemblyReport` 只给键名而按名称匹配本地能力。
  - 应用包的 `keys` 由 `src/shared/service-keys.ts` 的 `collectServiceKeys` 从各插件自己的声明收集而来，所以“只认受信键”实际挡不住什么；它原本防的是插件凭猜名字解析到没交给它的服务，在 ADR 0022 的完全信任前提下已不需要，按插件隔离数据由按调用方门面与内核填写的调用方身份负责。
  - 因为键按对象身份比较、插件之间又只 `import type`，依赖别的插件的服务时由宿主把键对象交给工厂（`packages/neuro-book/AGENTS.md` 目录约定）；`nbook.storage` 连自己的键也由宿主交进来，示例插件则直接导入自己的键，不统一。
  - 规划中的插件清单本来就以字符串写依赖与提供项（`runtime/plugin-manifest.md` 的 `entries.<id>.requires`、`provides`）。
  - 插件的后端代码在 `src/plugins/<插件>/server/`（diagnostics、http、projects、storage）与 `packages/nb-runtime/examples/plugins/<插件>/server/`；`nbook.storage` 的 `server/plugin.ts` 同时装在服务端与项目实例。`src/architecture.test.ts` 按路径段 `server`、`web` 判定前后端；开发监督进程按“不含 `web` 段”判定后端文件，不受改名影响。
  - 示例场景只起服务端与窗口实例，没有项目实例。
- **工作方式**：worktree `.worktree/w00017-runtime-foundation` 逐片提交，只暂存本片文件；批量改名与替换先 dry run，命中不确定时逐处编辑；测试用真实内核实例，不用 mock、spy、假计时器、固定等待；交付前对验收映射的每条判据做变异检查；主 Agent 编码，最后 omp（默认模型）只读审查。不修改 `packages/neuro-book-legacy`。

## 关键设计

### 1. 服务键按 id 识别（`packages/nb-runtime/src/services/`、`plugins/`、`application/`）

- `defineServiceKey<T>(id)` 只是给一个服务 id 配上类型；同一个 id 定义两次是同一个键。内核内部一律以 `key.name` 作 Map 的键与比较依据（`assembly.ts`、`composition.ts`、`blocked.ts`、`host.ts` 的各处 `Map<ServiceKey, …>`、`=== key`）；`blocked.ts` 不再区分“插件键按身份、本地能力按名称”。
- 删去 `ServiceAssemblyOptions.keys`、`ApplicationManifest.keys`、`ServiceAssembly.hasKey` 与登记拒绝原因 `unknown-service-key`：依赖一个没有任何入口或宿主能力提供的服务 id，按现有规则以 `missing-service` 受阻。服务 id 的形状规则（`<插件 id>/<名>`、保留名 `channel`、同一插件内不重复）不变。
- 类型：同一 id 在两处用不同的 `T` 定义，编译器查不出来；约定只在提供方插件的 `shared/contracts.ts` 定义一次，别处引用它（第 3 节）。
- 不变：唯一提供者、重复提供隔离、调用方身份与委托（签发记录仍按身份对象登记，`runtime.services` 实现合同第 5 条）。

### 2. 工厂参数与宿主能力（`packages/neuro-book/src/`、`packages/nb-runtime/examples/`）

- 插件入口的工厂只收**宿主给的配置**：运行位置、库文件路径、开关、宿主拥有的对象（例如时钟）。别的插件的服务一律在 `dependencies` 里按服务键声明，键从对方的 `shared/contracts.ts` 引用。
- 宿主在运行期才有的数据仍是宿主能力服务（`ApplicationManifest.capabilities`，例如 `windowProjectKey`），不变。
- 改造面：`createWorkbenchBrowserPlugin({commands, windowProject})`、`createStorageServerPlugin({storage, …})`、`createStorageBrowserPlugin({storage, windowProject})`、`createProjectsBrowserPlugin({quickPick, …})`、测试插件（`src/server/testing/`、`src/project/testing/`、`src/web/testing/`）、`src/server/plugins.ts`、`src/project/plugins.ts`、`src/web/plugins.ts` 的装配；删去 `collectServiceKeys` 及各处 `keys:`。

### 3. 插件之间可以引用对方的 `shared/contracts.ts`

- 现行约定“插件之间只 `import type`”的理由是键对象的身份：运行时导入对方模块会得到另一份键对象（以后第三方插件各自打包时尤其如此）。键按 id 识别后这条理由消失，改为：插件可以在运行时引用别的插件的 `shared/contracts.ts`（服务键、远程合同、贡献点 id、schema），不引用对方的 `backend/`、`web/` 与 `shared/` 里的其它模块。`const COMMANDS: typeof COMMANDS_POINT = "commands.definitions"` 这类重写字面量的写法随之改为直接引用。
- `src/architecture.test.ts` 增加这条边界：跨插件的运行时导入只允许指向对方的 `shared/contracts`。

### 4. 后端目录改名 `backend/`

- `src/plugins/<插件>/server/` → `backend/`（diagnostics、http、projects、storage，含 `storage/server/testing/`），`packages/nb-runtime/examples/plugins/<插件>/server/` → `backend/`；`git mv` 保留历史，导入与注释里的路径随之改。宿主目录 `src/server/`、`src/project/` 不改：它们是两个进程的宿主，不是插件代码。
- `src/architecture.test.ts` 的后端判定加上路径段 `backend`（宿主的 `server/`、`project/` 照旧算后端）。
- 工厂命名照旧按运行位置（`createStorageServerPlugin` 给 `server` 与 `project` 两个位置），文件名 `backend/plugin.ts`。

### 5. 示例（`packages/nb-runtime/examples/`）

- 按第 1–4 节改：`greeter` 的工厂不再收键，`clock` 的时钟仍经参数（宿主拥有的对象）；目录改名 `backend/`。
- 新增项目级插件 `project-notes`：`project` 入口持有本项目的笔记（远程服务，提供方位置 `project`），浏览器入口包成本地服务；场景宿主 `Stage` 增加起项目实例与按项目绑定窗口（参照 `packages/neuro-book/src/plugins/storage/storage.test.ts` 的 `world()`），场景 06 覆盖：窗口经 `.at("project")` 读写本项目、两个项目代次的数据各在各的实例里、项目代次结束后订阅以 `project-gone` 结束。
- README：插件、入口、服务、远程服务、贡献的概念表（t57 讨论里的那张）；“插件两端用远程服务、对外用本地服务”；运行位置与目录的对应（应用级 `server`、项目级 `project`、客户端级 `browser`；`backend/` 给前两者，`web/` 给浏览器）；工厂参数规则。

## Spec 与文档改动

| 文档 | 改什么 |
|---|---|
| `docs/specs/runtime/services.md` | 服务键按 id 识别、没有受信键清单；实现合同第 1 条改写；输出与场景里涉及“未登记键”的条目同步；证据的批准依据加开发者 2026-10-08 的决定 |
| `docs/specs/runtime/plugins.md` | 登记拒绝原因去掉 `unknown-service-key`；实现合同里受阻推导“插件键按对象身份匹配”一句改写 |
| `docs/specs/runtime/application.md` | 应用清单去掉 `keys` |
| `docs/specs/runtime/plugin-manifest.md` | 说明代码定义的插件与清单一样以服务 id 声明依赖（实现进展） |
| `docs/adr/0025-service-keys-by-id.md`（新） | 记录服务键从“对象即凭据”改为按 id 识别：原设计防什么、为什么在完全信任下不再需要、代价（同一 id 不同类型查不出来）；对应 ADR 0022 |
| `packages/neuro-book/AGENTS.md` | 目录约定：`backend/`、`web/`、`shared/`；插件之间可以引用对方的 `shared/contracts.ts`；工厂只收宿主配置；删去“由宿主把服务键交给工厂” |
| `packages/nb-runtime/AGENTS.md` | 服务键按 id 识别的一句（链接 ADR） |
| `docs/specs/storage/persistence.md`、`runtime/server-host.md`、`runtime/diagnostics.md` | 实现合同与证据里的 `…/server/…` 路径改为 `…/backend/…` |
| `packages/nb-runtime/examples/README.md` | 第 5 节 |

已接受的提案（例如 `multi-instance-runtime-topology.md`）里的旧路径是当时的记录，不改。

## 切片

文档随它描述的代码同片提交：Spec 里的源码链接要指向存在的文件，约定要与代码一致。改到的存量 Spec 按“改到哪份清理哪份”一并清理正文里的 Task 引用与“证据”一节（只留批准依据、实现入口、合同测试、Smoke 四种行）。

| 片 | 对应设计 | 提交边界 | 自跑验证 |
|---|---|---|---|
| S0 | — | ADR 0025 | `bun run docs:check`、`bun run governance:check` |
| S1 | 第 1 节 | 内核按 id 识别、删去 `keys` 与 `unknown-service-key`；内核测试与示例同步；`runtime/services.md`、`plugins.md`、`application.md`、`plugin-manifest.md` 与 `packages/nb-runtime/AGENTS.md` | `bun run --cwd packages/nb-runtime typecheck`、`test`；`docs:check`、`governance:check` |
| S2 | 第 2、3 节 | 应用包：删去 `collectServiceKeys` 与 `keys:`、工厂只收宿主配置、跨插件引用 `shared/contracts`、边界测试；`packages/neuro-book/AGENTS.md` 的引用规则 | `bun run test:affected --typecheck` |
| S3 | 第 4 节 | 后端目录改名（应用包与示例）、边界测试；`packages/neuro-book/AGENTS.md` 的目录约定、Spec 里的路径（`persistence.md`、`server-host.md`、`diagnostics.md`） | 同 S2，另 `build`、`check:dist`、`test:e2e`、`smoke:server` |
| S4 | 第 5 节 | 示例：工厂参数、项目级插件与场景、README | `bun run --cwd packages/nb-runtime test`、`typecheck` |
| S5 | — | Task 证据、omp 审查与修正 | `bun run test:affected --typecheck --since <计划提交>`、`test:e2e`、`smoke:server`、`docs:check`、`governance:check` |

## 验收映射

| 行为 | 测试 |
|---|---|
| 同一 id 定义两次的键可互换：提供方用一处定义、依赖方用另一处定义，照常解析到同一个服务 | 内核 `services/services.test.ts` 增补 |
| 依赖没人提供的服务 id 以 `missing-service` 受阻（不再有 `unknown-service-key`）；两个入口提供同一 id 照旧按重复提供隔离 | `plugins/entry-dependencies.test.ts`、`services.test.ts` 现有用例按新语义调整 |
| 不传 `keys` 的应用清单照常启动；宿主能力仍按 id 提供 | `application/*.test.ts`、应用包宿主测试 |
| 跨插件的运行时导入只允许对方的 `shared/contracts`；`backend/` 不引用 `web/`，反之亦然 | `src/architecture.test.ts` |
| 改名后服务端、项目子进程、浏览器照常装配；开发模式按后端文件重启 | `test:affected`、`test:e2e`、`smoke:server`、`src/server/dev/watch.test.ts` |
| 项目级示例：窗口经 `.at("project")` 读写本项目；两个项目各自的数据；项目代次结束后订阅以 `project-gone` 结束 | `examples/scenarios/06-project-instance.test.ts` |

## 验证

- 每片：上表的自跑命令；改名一片另跑 `bun run --cwd packages/neuro-book build` 与 `check:dist`（打包产物不受目录名影响）。
- 收口：`bun run test:affected --typecheck --since <计划提交>`、`test:e2e`、`smoke:server`、`docs:check`、`governance:check`；对验收映射的每条判据做变异检查（例如把内核比较改回对象身份，同 id 两处定义的用例应失败）。
- 未验证的边界：第三方插件各自打包后按 id 解析（清单与代码装载未实现，随 `runtime.plugin-manifest`）。

## 不做与风险

- **不做**：插件清单文件（`package.json`）与它的校验；第三方插件的打包与代码装载；宿主目录 `src/server/`、`src/project/` 改名。
- **风险**：
  - 内核与应用包里以 `keys:` 构造实例的测试较多（内核约 16 个文件、应用包约 15 处），逐处删除时检查是否有用例在测“同名不等价”，有则按新语义改写而不是删掉。
  - 同一 id 两处定义成不同类型时编译器查不出来：约定只在提供方定义一次，第 3 节的边界测试保证别处是引用而不是重写。
  - t56（K5）计划的第 2、6 节写到了 `server/` 与工厂交键，确认本计划后随之改写。

## 待确认

1. **删去应用清单的 `keys` 与 `unknown-service-key`**：依赖没人提供的 id 改为按 `missing-service` 受阻。`keys` 原本防的是凭猜名字解析到没交给你的服务，应用包现在的 `keys` 就是从插件声明里收集来的，实际没有在防。
2. **插件之间允许运行时引用对方的 `shared/contracts.ts`**（只限这个文件）：这样服务键、远程合同、贡献点 id 都只定义一次；`shared/` 里的其它模块与 `backend/`、`web/` 仍不能跨插件引用。
3. **新写一份 ADR 0025** 记录服务键从“对象即凭据”改为按 id 识别。它推翻的是第一片的设计，属于难以逆转的接口决定；不写 ADR 的话就只记在 `runtime/services.md` 的证据里。
