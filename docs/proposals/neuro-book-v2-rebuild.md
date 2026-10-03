# NeuroBook v2：并排重建应用

## 状态

`reviewing`（2026-10-03）。依据的开发者决定见[决策记录](#决策记录)；正文中“待开发者确认”一节列出的事项确认后改为 `accepted`。

## 问题

w00017 阶段 1 已经在 `packages/neuro-book` 中建立运行时内核、三类宿主与内置插件（六项 `runtime.*` Spec 为 `implemented`），但继续在这个包上推进 Files 竖切时遇到三类阻力：

1. **看不清底座。** 应用的全部功能都接在一个 3605 行的主页面 `app/pages/index.vue` 和一个 2309 行的 `novelIde` 全局 store 上；后端 `server/` 目录职责混杂，大量 Spec 已与实现脱节。加载了哪些插件、底座是什么样子，无法从代码一眼看出。
2. **框架在和底座抢控制权。** 内核与宿主已经拥有插件生命周期与进程，但 Nuxt/Nitro 仍在构建、开发进程模型与入口上设限：开发热重载要在 nuxi 主线程与 Nitro worker 之间协调（t38，`4705141b`）；生产入口要覆盖 Nitro 的 entry 并还原预渲染配置（`nuxt.config.ts`）；打包把 CJS 解析到 ESM 入口（`15139144`）；Nitro 插件要逐个迁入内置插件（t40，`7e820f0a`）。阶段 3 计划的插件运行期装载、卸载与路由贡献，与 Nuxt 构建期按文件约定生成的路由与插件相冲突。
3. **旧结构拖慢 Files 竖切。** t42 实测，3000 个文件时切换文件 0.9–1.6 s，主因是全局 store 的深度订阅（[t42](../../.agents/works/w00017-application-runtime-architecture/tasks/t42-files-baseline-research/README.md)）；在旧结构里修它，修完的部分随后又要被资源管理器与编辑器的重做替换。

## 目标与非目标

**目标：**

- 在同一仓库并排新建应用包 `packages/neuro-book-v2`，从零构建；旧包改名为 `packages/neuro-book-legacy`，只作代码与行为参照。
- 新应用先只有**运行时底座 + workbench 底座**：加载了哪些插件由一份产品清单列明，一眼可见。
- 在这个壳子上做 Files 竖切：工作台、一个文件资源管理器视图、Lab 中已有的编辑器组件。
- 去掉 Nuxt，前后端分离：前端 Vue 3 + Vite，后端 Bun + Hono，校验与接口描述统一用 TypeBox。
- 仓库只保留壳子用得到的东西：删除打包、发布、Manager 与桌面交付链，过时文档归档。

**非目标：**

- 旧包继续可运行或继续维护。旧包只作代码参照，不保证可构建、可运行。
- 本轮迁回 Agent、剧情、设定集、世界引擎、RAG 等功能。它们以后逐个作为插件迁回，届时各自按旧代码与归档的 Spec 重新确认合同。
- 产品打包、安装与桌面版。新应用先只有开发模式与最简单的生产启动；交付链在功能足够后另行设计。
- 合入 master。w00017 是长期分支，合并时一次处理与 master 的差异（主工作区未提交的 w00019 改动是 Lab 界面，届时迁入新应用）。

## 当前行为与证据

- 内核 `packages/neuro-book/runtime/`：6109 行（不含测试），只依赖 Node 内置模块，不引用 `server/`、`app/` 或其它包，可原样迁出。
- `nuxt.config.ts` 设 `ssr: false`：应用本来就是纯前端渲染，没用到 Nuxt 的服务端渲染；用到的 Nuxt 模块是 `nuxt-auth-utils`、`@pinia/nuxt`、`pinia-plugin-persistedstate/nuxt`、`@nuxtjs/i18n`、`@unocss/nuxt`、`@nuxtjs/color-mode`、`@vueuse/nuxt`，都有纯 Vue/Vite 的对应物。
- `@notnotype/nb-ui` 只有 `src/module.ts`（53 行）是 Nuxt 模块包装，组件本身是纯 Vue。
- 鉴权是 Nitro 中间件（`server/middleware/auth.ts`、`00-product-http.ts`），不是插件。
- 校验库：TypeBox（`typebox` 1.1.38）用于 Agent 工具、变量、Profile（Agent 框架要求）以及 Manager、contracts；Zod（4.3.6）用于 `shared/` 数据结构、服务端接口校验与前端。
- `packages/neuro-book-contracts` 的出口大多是交付链的合同（`release`、`product-runtime`、`desktop`、`installation` 等）。
- 打包脚本 `scripts/build/` 与发布脚本写死 `packages/neuro-book`。

## 方案

### 1. 仓库整理

| 对象 | 处理 |
|---|---|
| `packages/neuro-book` | 改名为 `packages/neuro-book-legacy`，移出 Bun workspaces、类型检查与测试；包内文档（`docs/adr`、`docs/proposals`、`docs/research` 等）随包进入旧包，成为参照 |
| `packages/neuro-book-manager`、`desktop/`、`scripts/build`、`scripts/release`、`scripts/install`、`scripts/deploy`、`RELEASE.md` 及根 `package.json` 中对应脚本 | 删除（git 历史与 master 中保留） |
| `packages/neuro-book-contracts` | 交付链出口随交付链删除；剩余出口按实际消费者核对后保留或删除 |
| Agent 相关库（`nb-harness`、`nb-profile`、`nb-session`、`nb-memory`、`nb-history`、`nb-workflow`、`neuro-agent-harness`、`llmlint`）与通用库（`owned-process`、`file-snapshot-cache`、`neuro-book-test-support`、`nb-ui`） | 原样保留：它们是独立的库，壳子不加载，以后功能迁回时使用 |
| `docs/specs` 中不在壳子范围的 Spec（Agent、媒体、模型角色选择、Agent 界面等） | 移入 `docs/archive/specs/`，保留原目录结构；登记表移除，归档目录的 README 写明“不是当前合同” |
| `docs/standards`、`docs/testing` 中针对旧包与交付链的条目，`vitepress/` 用户文档站 | 移入 `docs/archive/`；仍适用的通用规范保留并按新应用改写 |
| 仍有效的设计文档：ADR 0022（可扩展平台与插件信任）、`extensible-application-platform.md`、`project-file-foundation.md`、`workbench-view-host.md`、VS Code 调研 | 从旧包移到仓库级 `docs/`（`docs/adr/`、`docs/proposals/`、`docs/research/`），更新指向它们的链接 |
| 根 `AGENTS.md`、`README.md`、`PROJECT-STATUS.md`、`packages/AGENTS.md`、`docs/modules/monorepo-boundaries.md` | 按新结构改写：写明 `neuro-book-v2` 是现行代码，`neuro-book-legacy` 只作参照 |

`.agents/works/` 下的历史 Work 不动，它们是治理记录。

### 2. 技术选型

| 层 | 选择 | 理由 |
|---|---|---|
| 前端 | Vue 3 + Vite + vue-router + vue-i18n + UnoCSS + nb-ui | 沿用现有组件与 Lab；去掉 Nuxt 后构建与入口完全由我们决定，热更新交给 Vite |
| 前端状态 | 插件自有的响应式状态，不用全局 Pinia store，不用全局持久化插件 | 状态归属一目了然；避免 t42 发现的整 store 深度遍历；大块状态（文件树、正文）用浅层引用 |
| 后端运行时 | Bun | 与现有产品、测试支持库一致 |
| 后端 HTTP | Hono | 只管路由与中间件，不带依赖注入与生命周期，与内核不重叠；基于 Web 标准的 Request/Response，Bun 与 Node 行为一致，测试可直接 `app.request()`；维护者多、发布频繁 |
| 校验与接口描述 | TypeBox | 定义即 JSON Schema，插件通道、OpenAPI、插件配置与模型工具参数共用一种描述；与 Agent 框架一致 |

### 3. 包划分与目录约定

```text
packages/
├── nb-runtime/              # 内核：生命周期、服务装配、插件、应用门禁、诊断（自旧包 runtime/ 迁出）
└── neuro-book-v2/
    ├── src/
    │   ├── manifest.ts      # 产品清单：本应用加载哪些插件，唯一入口
    │   ├── server/          # 后端宿主：进程入口、开发监督进程、Bun 监听
    │   ├── web/             # 前端宿主：Vite 入口、浏览器宿主、根组件
    │   └── plugins/
    │       └── <插件>/
    │           ├── plugin.ts      # 插件描述：依赖、提供的服务、入口
    │           ├── server/        # 后端部分（可无）
    │           ├── web/           # 前端部分（可无）
    │           ├── shared/        # 前后端共用的 TypeBox 合同
    │           └── <插件>.md      # 指向对应 Spec 的简短说明
    ├── vite.config.ts
    └── AGENTS.md
```

- 一个插件的前端、后端与共用合同放在同一目录，不再分成 `server/`、`app/` 两棵大树；前后端各自构建，`web/` 不得引用 `server/`，反之亦然，只经 `shared/` 交换类型与 schema。
- 内核独立成包，前后端共用；宿主与插件不得绕过内核直接管理彼此的生命周期。
- 名称 `neuro-book-v2` 是迁移期的包名；旧包退出后是否改回 `neuro-book` 另定。

### 4. 宿主与开发模式

- **后端宿主**：进程由宿主拥有，沿用 `runtime.server-host` 的停止来源汇合、排空与退出码；`nbook.http` 用 Bun 监听，按插件前缀把请求分发给各插件的 Hono 子应用，插件启停时挂上或摘下，不依赖框架支持运行期删路由。
- **开发模式**：一条命令同时启动 Vite（前端热更新）与后端监督进程；Vite 把 API 请求代理到后端。后端文件变化时，监督进程按 `runtime.server-host` 的停止序列有序停止后端再启动。插件热插拔（阶段 3）实现后，再改为只重载变化的插件。
- **浏览器宿主**：Vite 入口在挂载根组件前建立窗口运行实例，沿用 `runtime.browser-host` 的引导接口与失败页。
- **生产启动**：`vite build` 产出静态资源，后端打包后同时提供静态资源与 API。不做安装与打包。
- **鉴权**：作为可选内置插件，向 `nbook.http` 贡献请求守卫；底座不含鉴权。壳子阶段只监听本机地址，默认不加载。
- **Lab**：只在开发模式加载的内置插件，由它贡献 Lab 页面。

### 5. 从旧包迁什么

| 迁移（整理后搬入） | 对应来源 |
|---|---|
| 内核 | `runtime/`（含测试） |
| 宿主的停止、排空、退出码逻辑 | `server/host/`、`server/features/http/`（Nitro 相关部分重写） |
| 诊断插件与日志写入 | `server/features/runtime-diagnostics/`、`server/app-logs/` |
| 浏览器宿主 | `app/runtime/browser-host.ts`、`app/runtime/browser-window.ts`（Nuxt 插件部分重写） |
| 工作台外壳、命令、快速打开、布局 | `app/components/workbench/`、`app/utils/workbench/`、`app/features/workbench/` |
| 编辑器组件 | `app/components/editor-workbench/`、`app/components/markdown-studio/` |
| Lab 与已解耦组件 | `app/component-lab/`、`app/components/common/` 等 |

迁移时去掉 Nuxt 自动导入、改为显式 import，不保留对旧包的引用。其余后端（项目、文件、存储、Agent 等）只作参照，按 Spec 以插件形式重写。

### 6. 推进顺序与验收

每一步一个 Task，前一步有真实结果后再开下一步：

1. **仓库整理**：按方案第 1 节改名、删除、归档、移动有效文档。验收：`docs:check`、`governance:check` 通过；剩余包的类型检查与测试通过；根入口文档描述的结构与实际一致。
2. **内核包**：`nb-runtime` 迁出，测试全部通过，无外部依赖。
3. **应用骨架**：后端宿主、`nbook.http`、`nbook.diagnostics`、开发监督进程、Vite 前端与浏览器宿主；打开后是空工作台。验收：启动、各类停止来源、退出码、排空、开发模式改后端文件后有序重启、浏览器引导与失败页（从 `smoke:product-lifecycle` 迁移宿主相关检查）。
4. **workbench 底座**：工作台外壳、命令、快速打开、布局持久化；Lab 插件。验收：现有 `workbench.*`、`ui.workbench-shell`、`ui.component-lab` 的验收场景在新应用上通过。
5. **Files 竖切**：资源层（`workspace.resources`，用于 Opus 与 omp 的对照实验）→ 文件资源管理器视图 → 编辑器打开与切换，性能按 `workbench.files-explorer` 的标准与参考机器验收。

## 备选方案与取舍

| 问题 | 采用 | 放弃的方案及原因 |
|---|---|---|
| 重建方式 | 并排新建、旧包改名只读 | 在旧包里大删：删完仍在旧目录结构里，不干净；另起仓库：失去共享库与治理记录 |
| 旧包命名 | 改名为 `neuro-book-legacy` | 保留原名、新包另起名：交付链与大量文档链接本来就要删除或归档，保留原名的好处不成立；当前分支是最新进度，与 master 的差异在合并时一次处理 |
| 前端框架 | 去掉 Nuxt，Vue + Vite | 保留 Nuxt：未用服务端渲染，构建期约定与我们自有的插件和宿主冲突 |
| 后端框架 | Hono | NestJS：自带依赖注入、模块与生命周期，与内核重复；模块启动时静态装配，不适合运行期启停插件；依赖装饰器元数据，esbuild 与 Bun 不生成。Elysia：自带依赖注入与分作用域的生命周期，与内核重叠；Bun 优先，Node 需适配器；几乎单人维护 |
| 校验库 | TypeBox | Zod：转换与自定义校验无法表达为 JSON Schema，而新应用的接口、插件配置与模型工具参数都以 JSON Schema 为中心 |
| 过时文档 | 归档到 `docs/archive/` | 直接删除：以后迁回功能时仍需参照旧合同 |

## 数据、接口、安全、迁移、发布与回滚影响

- **数据**：壳子阶段不读写用户作品与旧 State Root；Files 竖切使用的项目目录格式沿 `workspace.*` Spec。
- **接口**：新应用的 HTTP 接口按 `runtime.plugin-channel` 重新定义，不兼容旧包接口。
- **安全**：壳子默认不加载鉴权插件，只监听本机地址；需要远程访问时加载鉴权插件。
- **发布**：本分支不发布；master 上的现有产品不受影响。
- **回滚**：全部改动在 w00017 分支上；旧包在分支内保留，master 不变。

## 对 Spec 的预期改动

- `runtime.server-host`：开发模式一节由“nuxi 主线程与 worker 协调”改为“开发监督进程有序重启后端”；生产入口去掉 Nitro 相关描述。
- `runtime.browser-host`：入口由 Nuxt 客户端插件改为 Vite 入口。
- `runtime.plugin-channel`、`runtime.api-docs`：HTTP 层为 Hono，接口描述为 TypeBox。
- 现有 `implemented` 的 `runtime.*`、`workbench.*`、`ui.*` Spec：实现迁入新应用并重新通过验收后，证据改指新代码；在此之前登记表注明“实现迁移中”。
- 不在壳子范围的 Spec 归档（见方案第 1 节），登记表随之更新。
- `storage.*`：Storage 将重新设计（Issue #246）；壳子阶段的布局持久化方式见下一节。

## 待开发者确认

1. 壳子阶段的布局持久化：先存浏览器本地（localStorage），等 Storage 重新设计后再改，还是先做一个最简的服务端存储插件？建议前者。
2. 旧包移出 workspaces 后只作文本参照（建议），还是保留在 workspaces 中、依赖照装但不检查？
3. `vitepress/` 用户文档站归档（建议），还是删除？
4. 新包名 `neuro-book-v2` 在旧包退出后是否改回 `neuro-book`：现在不决定也可以。

## 决策记录

| 日期 | 决策者 | 结论 |
|---|---|---|
| 2026-10-03 | 开发者 | t42 之后暂停在旧包上推进 Files 竖切；在同一仓库并排新建应用、从零构建；旧包只读作参照；w00017 成为长期分支，暂不合 master |
| 2026-10-03 | 开发者 | 新应用先只有运行时底座与 workbench 底座，Files 竖切在这个壳子上验证（工作台、一个文件资源管理器视图、Lab 中的编辑器组件）；账户与登录做成可选内置插件；Lab 可做成插件；store 深度订阅不在旧包修复 |
| 2026-10-03 | 开发者 | 旧包改名为 `neuro-book-legacy`；打包脚本、Manager、桌面版删除；过时文档归档到一个目录；与 master 的差异在合并时处理，主工作区的 w00019 改动是 Lab 界面，迁移难度不大 |
| 2026-10-03 | 开发者 | 去掉 Nuxt，前后端分离；后端用 Hono（与 NestJS、Elysia 比较后）；校验统一用 TypeBox |
