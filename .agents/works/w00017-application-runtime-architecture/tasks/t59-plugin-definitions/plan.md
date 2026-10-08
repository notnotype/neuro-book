# t59 实施计划：插件定义统一为常量，宿主的东西走宿主能力服务

## Context

- **为什么做**：t58 之后，插件工厂只收“宿主给的配置”，但签名仍各不相同：`createClockServerPlugin({clock})`、`createStorageServerPlugin({location, path})`、`createProjectsBrowserPlugin({navigateDocument})`、`createCommandsPlugin(location)`，其余没有参数。开发者 2026-10-08 问参数的作用后同意统一：以后的第三方插件由宿主按清单的 `entries.<id>.main` 装载代码、只调用激活函数，中间没有工厂可以传参（`runtime/plugin-manifest.md`、`runtime/plugin-code-loading.md`），“工厂收参数”只有内置插件能用。统一后内置插件与第三方插件拿宿主的东西走同一条路。
- **开发者已同意的方向**（2026-10-08）：
  1. 普通插件没有工厂参数，插件定义是常量；整页导航、Storage 的库目录这类宿主的东西改为宿主能力服务，插件在 `dependencies` 里声明。
  2. 只有 `nbook.http`、`nbook.diagnostics` 保留工厂（理由见第 5 节）。
  3. `nbook.commands` 一份定义声明服务端与浏览器两个入口，`nbook.storage` 一份后端定义声明服务端与项目两个入口，不再按运行位置装配。
- **现状**：
  - 宿主能力服务已有三个，都按服务 id 定义在应用包：`windowProjectKey`（`src/shared/projects.ts`，浏览器宿主提供）、`projectsKey`（同文件，服务端宿主提供）、`currentProjectKey`（`src/project/current-project.ts`，项目宿主提供，含项目目录 `root`）。宿主在应用清单的 `capabilities` 里给出（`runtime/application.md` 的本地能力）。
  - 三个宿主各有一张“插件 id → 工厂”的表（`src/server/plugins.ts`、`src/project/plugins.ts`、`src/web/plugins.ts`）；浏览器的表一路传到窗口宿主（`web/boot.ts`、`main.ts`、`development-plugins.ts`、`testing/e2e-main.ts` → `web/host/window.ts`）。
  - 内核按整份定义检查服务 id 不重复（`nb-runtime/src/plugins/registration.ts` 的 `providedNames` 跨全部入口），所以 commands、Storage 现在合成一份定义会以 `duplicate-service` 整体拒绝。
- **审查**：omp 计划审查（`evidences/omp-plan-review.txt`）6 条发现全部核实成立，本稿已吸收：内核前置改动（第 0 节）、装配接点清单（第 3 节）、去掉源码形状检查改用类型约束（第 3 节）、例外判据写因果（第 5 节）、ADR 0025 的取代动作（文档表）、验收映射到真实消费路径（验收映射）。
- **工作方式**：worktree `.worktree/w00017-runtime-foundation` 逐片提交，文档随它描述的代码同片提交，只暂存本片文件；改到的存量 Spec 按规则一并清理；测试用真实内核实例，不用 mock、spy、假计时器、固定等待；对验收映射做变异检查；主 Agent 编码，最后 omp（默认模型）只读审查。不修改 `packages/neuro-book-legacy`。

## 关键设计

### 0. 内核：服务 id 按运行位置不重复（`packages/nb-runtime/src/plugins/registration.ts`）

- 唯一性从“整份插件定义”改为“同一运行位置的入口之间”：照 `receiversByLocation` 的做法按位置分组；同位置两个入口提供同一 id 仍以 `duplicate-service` 拒绝，不同位置的入口可以提供同一 id。
- 不变量不变：一个实例里一个服务 id 至多一个提供者。宿主只为本位置的入口声明提供者（`host.ts` 的登记循环），受阻推导按位置取提供者（`blocked.ts`），都不用改。
- 测试：同一份 `PluginDefinition`（server、browser 两个入口提供同一 id）在两个真实实例各自启动可用、对方入口为 `foreign-location`；同位置重复仍被拒绝（`src/plugins/registration.test.ts` 或现有登记测试增补）。

### 1. 新的宿主能力服务（`packages/neuro-book/src/shared/host.ts`）

| 服务 id | 形状 | 提供者 | 消费者 |
|---|---|---|---|
| `nbook/state-root` | `{readonly path: string}`：宿主已解析的绝对路径（`server/config.ts` 的 `resolve` 结果，不保证 realpath，首启时可以还不存在） | `server/start.ts` | `nbook.storage` 服务端入口，在 activate 里拼 `<path>/storage/user.sqlite` |
| `nbook/window-navigation` | `{navigateDocument(href: string): void}`：整页加载 | `web/host/window.ts`（取自 `BrowserWindowOptions.navigateDocument`） | `nbook.projects` 浏览器入口 |

- 键与 `projects.ts` 同层，宿主与插件共用；只依赖内核服务键类型，不放进 `nb-runtime` 或 Storage 的公开合同。宿主拥有根的定位，Storage 拥有根下的布局，所以给状态根而不是库文件路径。
- 项目入口的库目录用已有的 `currentProjectKey.root`（项目宿主冻结提供，当前代次不变），不另加；它的键从项目宿主目录（`src/project/current-project.ts`）移到 `src/shared/projects.ts`，插件不引用宿主目录（实施中补充）。状态根不发给浏览器。
- `web/mount.ts` 的整页导航属于宿主路由，保持原样，不经内核解析。

### 2. 插件定义改为常量（`packages/neuro-book/src/plugins/`）

- 按代码所在的一侧导出常量：`storageBackendPlugin`（`server`、`project` 两个入口，各自依赖 `nbook/state-root`、`currentProjectKey`，其余实现共用）、`storageBrowserPlugin`、`projectsBackendPlugin`、`projectsBrowserPlugin`（依赖 `nbook/window-navigation`）、`workbenchBrowserPlugin`、`labBrowserPlugin`；`commandsPlugin` 在 `shared/plugin.ts`、含 `server` 与 `browser` 两个入口。
- 常量只放静态描述与激活函数；命令表、`WeakMap`、订阅等可变状态留在 `activate` 里，每个实例各一份。
- 同一实例不同时登记一个插件的后端与浏览器两个常量（会 `duplicate-plugin`）：每个宿主只取本侧常量。
- 测试插件（`src/*/testing/`）按测试需要带参数，不受本规则约束（它们是测试宿主的一部分）。

### 3. 宿主装配（`src/server/`、`src/project/`、`src/web/`）

- 每个宿主两张表，类型就是边界：
  - `…PluginDefinitions: Readonly<Record<string, PluginDefinition>>`：普通插件，只能放常量；
  - `…HostPlugins`：宿主适配器的工厂，只有 diagnostics 与（服务端的）http，收宿主上下文。
  - 按清单装配时先查适配器、再查定义；两张表都没有时直接失败、产出 id 与清单不一致时失败，规则不变。
- 改掉旧的源码形状检查方案：不在 `architecture.test.ts` 用正则扫 `export function create…Plugin(`（箭头函数、再导出都能绕过）。普通插件能不能带参数，由定义表的类型约束挡住；迁移时删掉全部普通工厂。
- 要改的接点：
  - 服务端：`server/plugins.ts`（两张表与 `manifestServerPlugins`）、`server/start.ts`（提供 `nbook/state-root`）、`server/testing/fixture-entry.ts`（产品插件改按两张表取）。
  - 项目：`project/plugins.ts`、`project/start.ts`（`ProjectPluginContext` 不再需要 `config.root` 给 Storage）。
  - 浏览器：`web/plugins.ts`、`web/host/window.ts`（按两张表选插件、提供 `nbook/window-navigation`）、`web/boot.ts` 的 `WindowUiBoot`、`main.ts`、`development-plugins.ts`、`testing/e2e-main.ts`；消费表的 `web/host/window.test.ts`、`web/mount.dom.test.ts`。
  - 测试宿主：`server/testing/projects.ts` 的 `projectHarness` 从自己选的状态根提供 `nbook/state-root`，`plugins/storage/project-child.test.ts` 删掉在外部拼 user 库路径的写法；自建应用的 `storage.test.ts`（server、project、browser 三种实例）、`projects.test.ts`、`commands/shared/plugin.test.ts` 补对应能力或改用常量。

### 4. 示例（`packages/nb-runtime/examples/`）

- 示例宿主提供宿主能力 `example.host/clock`：键定义在 `examples/shared/host.ts`（与应用包的 `src/shared/host.ts` 同一角色；平台中立，插件的浏览器类型检查会递归检查它），`Stage` 创建实例时经 `ApplicationManifest["capabilities"]` 给出，测试注入手动时钟。`clock` 插件依赖它、包成按小时报时的 `ClockService`，改为常量 `clockPlugin`。其余示例插件改为常量。
- README 的工厂规则改为：普通插件是常量；要宿主的东西就依赖宿主能力服务；宿主适配器是例外，例外要说明第 5 节的启动与停机依赖。

### 5. ADR 0026（`docs/adr/0026-plugin-definitions-as-constants.md`）

- 完整写出当前决策：继承 ADR 0025 第 1、2 条（服务键按服务 id 识别；运行时只引用对方的 `shared/contracts.ts`）与身份对象等未变约束；替换第 3 条与“工厂签名统一、宿主按清单取工厂”的后果。
- 例外判据按因果写，不用“进程级资源”：diagnostics 的存储与紧急出口要在内核启动之前就能记录，覆盖启动期的诊断；http 的准入与监听结果参与宿主就绪和停机前的排空。两者整体作为宿主适配器装配，配置随工厂传入。新增例外要说明同样的启动或停机依赖，不能只凭“用到文件、端口”或“按实例不变”。
- 0025 正文不动，frontmatter 改为 `status: superseded`、`superseded-by: docs/adr/0026-plugin-definitions-as-constants.md`；ADR 索引加 0026 并注明取代关系。0026 区分已接受的方向与 S1、S2 才落地的现状，不先宣称代码已支持。

## Spec 与文档改动（随代码同片）

| 文档 | 改什么 | 片 |
|---|---|---|
| `docs/adr/0026-…`（新）、`0025-…` frontmatter、`docs/adr/README.md` | 第 5 节 | S0 |
| `docs/specs/runtime/plugins.md` 第 45 行、`plugin-manifest.md` 第 29 行 | 服务 id 在同一运行位置的入口之间不重复，不同位置可以提供同一 id；补验收场景 | S1 |
| `docs/specs/runtime/server-host.md`、`browser-host.md`、`projects.md` | 宿主提供的本地能力加 `nbook/state-root`、`nbook/window-navigation`；装配从“工厂表”改为“定义表与宿主适配器”；`browser-host.md` 实现合同里的 `factories`、`BrowserPluginContext` 与第 139 行“跨插件只用 `import type`”旧约定 | S2 |
| `docs/specs/storage/persistence.md` | 第 64 行“由装配者交给插件工厂”；公开入口改为 `storageBackendPlugin`、`storageBrowserPlugin`，库目录来自宿主能力 | S2 |
| `docs/specs/workbench/commands.md` | `createCommandsPlugin(location)` 改为 `commandsPlugin` | S2 |
| `packages/neuro-book/AGENTS.md` 第 13、14、31 行 | 插件定义是常量、宿主能力服务、两个例外、宿主的两张表 | S2 |
| `packages/nb-runtime/examples/README.md` | 第 4 节 | S3 |

改到的存量 Spec 按“改到哪份清理哪份”一并清理正文里的 Task 引用与“证据”一节。`plugin-code-loading.md` 的 CommonJS“登记工厂”是模块求值机制，不改。

## 切片

| 片 | 对应设计 | 提交边界 | 自跑验证 |
|---|---|---|---|
| S0 | 第 5 节 | ADR 0026、0025 frontmatter、ADR 索引 | `docs:check`、`governance:check` |
| S1 | 第 0 节 | 内核按位置的唯一性与测试；plugins、plugin-manifest 两份 Spec | `bun run --cwd packages/nb-runtime test`、`typecheck` |
| S2 | 第 1–3 节 | 宿主能力、插件常量、三个宿主与测试宿主、相关测试；随片的 Spec 与 AGENTS | `bun run test:affected --typecheck`、`test:e2e`、`smoke:server` |
| S3 | 第 4 节 | 示例 | `bun run --cwd packages/nb-runtime test`、`typecheck` |
| S4 | — | Task 证据、omp 审查与修正 | `bun run test:affected --typecheck --since <计划提交>`、`test:e2e`、`smoke:server`、`docs:check`、`governance:check` |

## 验收映射

| 行为 | 测试 |
|---|---|
| 同一份定义的两个位置入口在各自实例可用、另一侧为 `foreign-location`；同位置重复提供仍被拒绝 | nb-runtime 登记测试增补（S1）；`plugins/commands/shared/plugin.test.ts` 用 `commandsPlugin` 同时起 server、browser 两个真实实例，命令表互相隔离 |
| 服务端 Storage 入口在状态根下打开 user 库，路径来自 `nbook/state-root` | `storage.test.ts`（hub 实例提供状态根能力）；`smoke:server` S8 只证明 user 分区 |
| 项目入口在项目目录下打开 project 库，路径来自 `currentProjectKey.root` | `project-child.test.ts`（真实项目子进程，跨代次读回） |
| 宿主没有提供能力时，依赖它的入口按 `missing-service` 受阻，结构化原因含 key | `storage.test.ts` 增补 |
| 浏览器的“打开项目”经命令服务执行、导航经 `nbook/window-navigation` | `projects.test.ts` 把直接调 `openProject` 的用例提升为真实浏览器内核：经 `commandServiceKey.execute("nbook.project.open")` 触发，只在宿主能力接点记录导航；`e2e/projects.e2e.ts` 走真实页面 |
| 普通插件不能以带参数的工厂进入宿主 | 定义表的类型约束（`typecheck`） |
| 示例的时钟来自宿主能力，测试推进时钟后问候改变 | `examples/scenarios/01-services.test.ts` |

变异检查与负向用例分开：缺能力受阻是负向行为；变异是去掉插件对能力的依赖或改错库落点、让 foreign 入口误激活，要求上表对应的正向用例失败。

## 验证

- 每片：上表的自跑命令。
- 收口：`bun run test:affected --typecheck --since <计划提交>`、`test:e2e`、`smoke:server`、`docs:check`、`governance:check`；上节的变异检查。
- 未验证的边界：第三方插件按清单装载（`runtime/plugin-manifest.md` 未实现）。

## 不做与风险

- **不做**：插件清单文件与代码装载；把 `nbook.http`、`nbook.diagnostics` 也改成常量；新增通用的“基础设施插件”类别。
- **风险**：宿主能力变多以后哪些该是能力、哪些该是适配器的工厂参数，以 ADR 0026 的因果判据为准；评审新增例外时核对它。

## 已确认（开发者 2026-10-08）

1. 新增两个宿主能力 `nbook/state-root`、`nbook/window-navigation`，Storage 的项目入口用已有的 `currentProjectKey.root`。
2. 常量按代码所在的一侧导出（后端不能引用前端代码）；插件清单实现后，清单就是跨两侧的那一份描述。
3. 写 ADR 0026 取代 ADR 0025（0025 正文不改）。
