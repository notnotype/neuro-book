# NeuroBook 应用包

仓库共享规则见根 [`AGENTS.md`](../../AGENTS.md)；本文件只补充本包的约定。

本包是 NeuroBook v2 的现行应用代码。设计依据：[NeuroBook v2：并排重建应用](../../docs/proposals/neuro-book-v2-rebuild.md)、[ADR 0023](../../docs/adr/0023-v2-frontend-backend-stack.md)。旧应用 `packages/neuro-book-legacy` 只作参照，不在其中修改代码；需要旧行为时读它，按 Spec 在本包重写；原样迁入的旧代码同样逐条对照 Spec 复核，不以“与旧实现一致”作为正确的依据。

## 目录约定

- `src/manifest.ts`：产品清单，列出本应用加载的全部插件，是“加载了什么”的唯一入口；只引用各插件的 `plugin.ts` 描述。`src/development-manifest.ts` 是开发清单（Component Lab），只由后端开发入口 `src/server/development-main.ts`、项目子进程的开发入口 `src/project/development-main.ts` 与前端的 `src/web/development-plugins.ts` 引用，后者只在 `import.meta.env.DEV` 分支里动态加载；生产构建不含它们，`check:dist` 检查。
- `src/server/`：后端宿主（进程入口、启动参数、停止来源与退出码、按清单装配插件，`src/server/projects/` 是项目管理：身份、登记表、项目子进程与租约）；`src/project/`：项目宿主（项目子进程的入口，建立 `project` 位置的运行实例，见 [`runtime.projects`](../../docs/specs/runtime/projects.md)）；`src/web/`：前端宿主（Vite 入口、浏览器宿主、根组件）。
- `src/backend/`：服务端与项目子进程共用、不属于某个插件的后端工具（例如加锁替换文件 `locked-replace.ts`），可用 Node 与 Bun API；只由后端代码（宿主与插件的 `backend/`）引用，不引用插件。
- `src/ui/`：宿主与插件共用的前端组件（同名 `.md` 文档并列，Lab 自动收录），只引用前端库、`ui/` 与 `shared/`；只属于某个插件的界面组件放在插件的 `web/components/`。
- `src/shared/`：前后端宿主共用、与运行位置无关的代码：宿主之间的协议（例如浏览器引导的 TypeBox schema 与常量）、宿主提供给插件的能力的键（`host.ts`、`projects.ts`）、装配工具，以及各插件都要用的小工具（例如界面文本的中英两份 `localized-text.ts`）；不引用任何一侧的实现。插件自己的合同放在插件的 `shared/`。
- `src/plugins/<插件>/`：一个插件一个目录，`plugin.ts` 为插件描述（id、版本与运行位置）。`backend/` 放后端代码，服务端（`server`，应用级，一个进程）与项目子进程（`project`，每个打开的项目一个）共用这份代码，一份定义里按运行位置各写一个入口；`web/` 放浏览器窗口（`browser`，每个窗口一个）的代码；`shared/` 放两端共用、与运行位置无关的代码（TypeBox 合同，以及不碰 DOM、Bun 与 Node API 的逻辑，例如命令表），其中 `shared/contracts.ts` 是对其它插件公开的合同。`web/` 不引用 `backend/`，反之亦然，只经 `shared/` 交换类型与 schema。
- 插件之间只经内核的服务、贡献点与远程服务协作。运行时只引用对方的 `shared/contracts.ts`（服务键、远程合同、贡献点 id、schema、配置定义），类型可以 `import type`；服务键按服务 id 识别，同一 id 只在提供方的 `shared/contracts.ts` 定义一次，由 `src/architecture.test.ts` 检查。插件定义是常量，按代码所在的一侧导出（`backend/plugin.ts`、`web/plugin.ts`，两侧共用的放 `shared/plugin.ts`），没有工厂参数；要宿主的东西（状态根、项目目录、整页导航）就在入口的 `dependencies` 里依赖宿主能力，对别的插件的依赖同样写在那里（[ADR 0026](../../docs/adr/0026-plugin-definitions-as-constants.md)）。宿主（`src/server/`、`src/project/`、`src/web/`）是装配者，各有两张表：普通插件的定义表只能放常量，宿主适配器的工厂表只有诊断与 HTTP；新增宿主适配器要说明 ADR 0026 决策第 5 条的启动或停机依赖。测试插件（`testing/` 与测试文件里的）可以带参数。例外：Lab 的场景（`src/plugins/lab/web/fixtures/`）可以在运行时引用其它插件的 `web/` 与 `shared/`，用来挂载它们的组件、建场景自己的局部宿主；Lab 只在开发模式加载。
- `src/plugin-platform/`：第三方插件的通用管理，按 `shared/`、`backend/`（安装、登记、启动时的插件集合、服务端装载、文件端点的处理）、`web/`（浏览器装载与插件样式）、`build/`（构建预设）分目录。只依赖内核、`typebox` 等列名的通用件与 `src/backend/locked-replace.ts`，不引用 `src/plugins/`、NeuroBook 的合同与 `src/sdk/`，源码不写 NeuroBook 的名字；应用的名字与常量由平台档案（`src/plugin-platform-profile.ts`）给出，目录自己的测试用 `testing/` 里的 `acme` 档案。内置插件 `nbook.plugins` 建在它上面。这些由 `src/architecture.test.ts` 检查（[ADR 0030](../../docs/adr/0030-plugin-platform-layering.md)）。
- `src/sdk/`：插件作者的公开 API 的唯一入口（[`runtime.plugin-api`](../../docs/specs/runtime/plugin-api.md) 的“SDK 的组成”），只再导出内核与内置插件的公开合同；子路径只写在 `entries.ts` 一张表里，导出名单与公开面闭包有快照。
- `plugin-sdk/`：给插件作者的材料，打包成 SDK 包 `@notnotype/nb-plugin-sdk`：作者命令（`cli.ts`、`create-plugin.ts`）、模板、作者文档、打包脚本（`pack.ts`，`bun run build:sdk`）与它们的测试。SDK 的公开入口在 `src/sdk/`，构建预设在 `src/plugin-platform/build/`，本目录只绑定 NeuroBook 的档案。产品代码不引用 `plugin-sdk/`，由 `src/architecture.test.ts` 检查。
- `plugin-sdk/examples/`：示例插件与场景测试，教第三方插件怎么写（目录、概念与阅读顺序见 [`plugin-sdk/examples/README.md`](plugin-sdk/examples/README.md)），示例插件随 SDK 包分发。插件按 `src/plugins/` 的目录格式写，只从 SDK 导入，同样由 `src/architecture.test.ts` 检查；场景经 `plugin-sdk/examples/testing/` 的场地装进真实的内置插件运行，随 `bun run test` 运行。产品清单不含示例插件。注释是教学材料，注释规则的例外见根 [`AGENTS.md`](../../AGENTS.md) 的“注释”。
- 定义贡献点时规定贡献 id 的取法（例如插件 id、页面路径）：内核要求贡献 id 在同一贡献点内唯一，两个插件写同一个 id 时两条都被拒绝，不能让每个插件都写同一个固定 id。
- 配置（随 t64 实现）：插件在描述（`plugin.ts`）的 `contributions` 里声明配置项，定义用 `defineSetting`（`nbook/shared/settings`）写在自己的 `shared/contracts.ts`；读写经 `nbook.settings` 的 `settingsKey`，所有已声明的项都可读、只写自己声明的项。合同见 [`settings.configuration`](../../docs/specs/settings/configuration.md)。
- 命令（两端都可用）：插件向 `nbook.commands` 的贡献点 `commands.definitions` 提交，贡献 id 写命令 id（内置插件 `nbook.<域>.<动作>`，域取 [`workbench.commands`](../../docs/specs/workbench/commands.md) 的域词表，不是插件 id，不在词表里的贡献被拒绝；其它插件以自己的插件 id 开头）。命令随贡献方入口激活才进命令表，还没有按命令触发的激活事件，贡献命令的入口要启动即激活（`onStartup`）；要执行命令的入口在依赖里声明 `commandServiceKey`，按 id 执行。合同见 `src/plugins/commands/shared/contracts.ts` 与 [`workbench.commands`](../../docs/specs/workbench/commands.md)。
- 跨目录导入用 `nbook/*`（映射到 `src/*`）；同一插件或同一宿主目录内用相对导入。
- 前端不用全局 Pinia store；状态归插件所有，大块状态用浅层引用。
- 后端 HTTP 用 Hono，校验与接口描述用 TypeBox，不引入 Nuxt 与 Zod。
- 依赖：`dependencies` 只放后端进程导入的包（开发监督进程按其中的 workspace 包决定监视哪些源码目录）；只进前端构建的包（vue、vue-router、nb-ui、Tailwind 等）放 `devDependencies`。两份产物都由打包器打包，这样分不影响运行。

## 后端

- 插件提供 HTTP 接口时，在后端入口向贡献点 `http.routes` 提交一个处理器（通常是 Hono 应用），贡献 id 写插件自己的 id，挂载在 `/api/<插件 id>/`；合同见 `src/plugins/http/shared/contracts.ts` 与 [`runtime.server-host`](../../docs/specs/runtime/server-host.md)。`/api/runtime/` 留给宿主。
- 长连接（事件流）在处理器里经 `env.registerEventStream(close)` 登记，否则会拖住排空。
- 记录诊断用 `@notnotype/nb-runtime/diagnostics` 的 `diagnosticsKey` 服务，不直接写文件或另建日志器。
- 测试需要额外插件时经 `startServer({plugins})` 注入（见 `src/server/testing/`），产品代码不加测试分支。
- 必须最先运行的代码（拍下启动环境、接管进程级处理）与外部包（打包时 `--external` 的包）的导入在同一个 bundle 里时，打包器会把外部包的导入提到文件最前、先于它求值。这类代码放在入口里，其余代码用 `await import` 加载并开代码分割（例子见 `src/server/main.ts`，原因见 [ADR 0036](../../docs/adr/0036-app-package-installs-omp.md)）。

## 前端

- 窗口启动、引导与失败页的合同见 [`runtime.browser-host`](../../docs/specs/runtime/browser-host.md)。插件的浏览器入口在 `src/web/plugins.ts` 的定义表登记；窗口只登记引导集合里出现的插件。页面经 `nbook.workbench` 的贡献点 `workbench.pages` 交出（贡献 id 写页面路径），路由归宿主（`src/web/router.ts`）。
- 样式：Tailwind v4（`@tailwindcss/vite`）一份引擎，入口 `src/web/tailwind.css` 同时编译应用与 nb-ui 源码里的原子类，分层与 reset 的原因见该文件头注释；主题变量来自 nb-ui 主题包。
- 浏览器基线：Chrome、Edge 119，Firefox 124，Safari 17.4（`vite.config.ts` 的 `BROWSER_TARGETS`）；不使用基线之外的浏览器 API。
- 测试分两个运行器：纯 TS 模块、后端与窗口合同用 `bun test`；Vue 组件测试命名 `*.dom.test.ts`，由 Vitest 在 happy-dom 里运行（`vitest.config.ts` 沿用 Vite 配置，包内 `bunfig.toml` 让 `bun test` 跳过它们）。需要真实布局的交互（尺寸、拖放、滚动）走 Playwright（`e2e/`）。
- `bun test` 不能导入 `.vue`：Bun 测试会导入的模块（例如工作台交出的根界面）用 `defineComponent` 与渲染函数写。
- 插件的浏览器入口（含它在后端类型检查范围内的引用链）引前端包时，只引不带 DOM、不带编辑内核的入口；带 DOM 的部分放进按需加载的 `.vue`：后端类型检查对 `.vue` 只看通配声明（`src/types/vue-sfc.d.ts`），入口里静态或动态 `import()` 引到的包源码都会被展开检查。例子见 `nbook.markdown` 的 `web/components/MarkdownHosted.vue`。
- `vite.config.ts` 关闭了依赖发现、预构建清单写死（依赖发现进行中时 Vite 的 `close()` 不结算，开发命令停止时会卡住）；页面直接或经 nb-ui 用到新的第三方包，或已列入包的新子路径（例如 `typebox/compile`）时加进 `optimizeDeps.include`：漏列的 CommonJS 模块在开发模式加载失败，漏列的子路径不进预构建、首次加载按需打包，e2e 曾因此间歇失败。
- Component Lab（[`ui.component-lab`](../../docs/specs/ui/component-lab.md)）是开发插件 `src/plugins/lab/`：新组件写同名 `.md` 就进索引，可挂载的组件在 `src/plugins/lab/web/fixtures/index.ts` 登记场景（场景登记门禁 `fixtures/index.dom.test.ts`）。 `src/plugins/drafts/` 是界面设计评审的静态稿目录：只出现在草稿 worktree、从不提交，不是插件，在 Lab 里显示为 `drafts/…`；用法见 [`design-review`](../../.agents/skills/design-review/SKILL.md#草稿放在哪里)，做静态稿不要另建目录。

## 命令

```text
bun run dev              # 开发模式：页面 http://127.0.0.1:4217/（RPC 4218、后端 4219；被占用时三个一起加 100），后端改动后有序重启；状态根缺省 .dev-state/。给自己或开发者用的开发服务用 nbdev dev start（自动避让端口，以 [dev] backend-ready 判就绪）；手动指定任一端口时三个都不避让，页面返回 200 不代表后端已经起来
NBDEV_SAMPLE=1 bun run dev   # 另在后端就绪后放样例作品 .dev-sample/sample/（被 Git 忽略，只补缺少的文件），日志打 [dev] open-path /?project=sample；失败打 [dev] sample-failed <原因>，服务照常运行。nbdev dev start --sample 设这个变量（src/server/dev/sample.ts）
bun run typecheck        # 类型检查：后端 tsc、前端 vue-tsc、组件测试与 e2e 的 vue-tsc
bun run test             # bun test（合同测试，含真实子进程）后接 Vitest 组件测试
bun run test:e2e         # 构建后用本机 Chrome 跑浏览器验收（Playwright 由 Node 运行）
bun run build            # 打包后端到 dist/server、前端到 dist/web，最后 check:dist 确认产物不含开发插件与本机路径
bun run smoke:server     # 打包后对产物运行进程级 smoke
bun run lab:shot -- -c <组件> --url <开发页面地址>   # 对 Lab 场景截图并检查溢出（Node 运行，对着 bun run dev）
bun run page:shot -- --url <开发页面地址> [--path /]   # 截产品页面：等页面画出（data-page-rendered）、画面稳定（没有有限动画与 aria-busy；无限循环的动画不等，列在报告里）再截，--click、--wait-for 按出现顺序执行、取第一个可见的匹配项；输出 page.png 与 report.json。停在宿主失败页（connection-failed、project-unavailable 等）时以 2 退出并写明是哪种，专门截失败页加 --allow-host-failure（Node 运行，对着 bun run dev；参数见 --help）
bun run page:shot -- --url <开发页面地址> --path '/?project=sample' --click '[data-explorer-row="project://正文"]' --wait-for '[data-explorer-row="project://正文/第一章 雾港.md"]' --click '[data-explorer-row="project://正文/第一章 雾港.md"]' --wait-for '[data-editor-group-active] [data-editor-kind="markdown"] [data-editor-prose]'   # 打开样例作品并点开第一章（要 NBDEV_SAMPLE=1 起的开发服务）
bun run perf:files       # Files 的性能验收（files-explorer 验收 12）：生成 3000 个文件的样本、生产构建，本机 Chrome 逐项测；在参考机器上跑，浏览器部分由 Node 运行
NBOOK_STATE_ROOT=<目录> bun run start   # 运行打包产物（同时提供页面）
```
