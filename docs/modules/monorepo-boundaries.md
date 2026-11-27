# Monorepo Module 边界与迁移规范

## 目的

NeuroBook 以一个 monorepo 维护应用、共享合同与可独立维护的包。`Module` 是逻辑所有权和依赖边界，不等于当前目录，也不要求每个 Module 立即成为 npm 包。

本分支按 [NeuroBook v2：并排重建应用](../proposals/neuro-book-v2-rebuild.md) 从零重建应用：新应用位于 `packages/neuro-book`，旧应用改名为 `packages/neuro-book-legacy`，只作代码与行为参照。根只保留 workspace 编排与治理入口；交付链（打包、发布、安装、Manager、桌面版）已在本分支删除；新应用现在发构建产物的 npm 包、带 `nbook` 命令（[ADR 0033](../adr/0033-app-delivered-as-built-npm-package.md)），目录包、桌面壳、后台运行与服务器部署另行设计。六个自治项目位于对应 `packages/*`，各自保留项目 docs、legacy Task 记录、状态和专属 `AGENTS.md`，默认继承根治理规则；current Work/Task 统一位于根 `.agents/works/`。

## 当前布局

| 边界 | 当前真相源 | 当前入口或消费方 | 当前状态 |
| --- | --- | --- | --- |
| 新应用 | `packages/neuro-book` | 后端进程入口 `src/server/main.ts`，命令行 `src/cli/main.ts`（`nbook`，[`runtime.cli`](../specs/runtime/cli.md)），前端入口 `src/web/main.ts`，开发命令 `bun run dev`；npm 包由 `bun run build:app-package` 生成；验证命令见包内 [`AGENTS.md`](../../packages/neuro-book/AGENTS.md) | 已有应用骨架：后端宿主、开发监督进程、浏览器宿主与空工作台；前端基础（vue-router、Tailwind v4、nb-ui、Vitest 组件测试）与只在开发模式加载的 Component Lab（`/lab`）已加入；工作台外壳、命令与布局随后续步骤加入。第三方插件的通用管理（安装、登记、装载、构建预设）在 `src/plugin-platform/`，只依赖内核与列名的通用件、由应用的平台档案配置，不引用内置插件与 NeuroBook 的合同，出现第二个需要第三方插件的应用时搬成包（[ADR 0045](../adr/0045-shared-host-packages-for-second-app.md) 修订了 0030 的搬包条件）；两端宿主、模型服务与加锁替换中与应用无关的部分已抽成 `nb-host`、`nb-models`、`nb-file-lock`，应用只做装配；插件作者的公开 API 只经 `src/sdk/`；作者材料（作者命令、模板、作者文档、示例插件、打包出 SDK tarball）在 `plugin-sdk/`，产品代码不引用它。这几条由架构测试守住（[ADR 0030](../adr/0030-plugin-platform-layering.md)） |
| 内核 | `packages/nb-runtime` | 新应用的后端与浏览器宿主（第 3 步起） | 运行时依赖只有 TypeBox，每个机制一个子路径入口；与应用无关，应用的名字（清单的引擎键、保留的发布者）由宿主以平台档案传入（[ADR 0030](../adr/0030-plugin-platform-layering.md)）；行为合同见 `docs/specs/runtime/` 的 lifecycle、services、plugins、application、diagnostics；典型用法见应用包的示例插件 [`packages/neuro-book/plugin-sdk/examples/`](../../packages/neuro-book/plugin-sdk/examples/README.md) |
| 旧应用 | `packages/neuro-book-legacy` | 只读参照 | 依赖照装，不参加类型检查、测试与治理检查；包内含 w00017 阶段 1 的内核与宿主实现、ADR 0001–0021、legacy `.agents/tasks/` |
| Workspace 自治包 | `packages/nb-history/`、`nb-workflow/`、`nb-memory/`、`nb-ui/`、`neuro-agent-harness/`、`llmlint/` | 各包公开 exports、包内测试和应用消费者 | 各包独立 owner；`neuro-agent-harness` 已冻结，只服务 `llmlint`，待由 `nb-harness` 取代后退役 |
| Schema 表单 | `packages/nb-form/` | 核心（`.`，只依赖 TypeBox）与 Vue 渲染层（`./vue`，依赖 nb-ui）；`nb-ui`、`vue` 是 `./vue` 的可选 peer；验证命令见包内 [`AGENTS.md`](../../packages/nb-form/AGENTS.md) | w00027 t07 新建；应用与 dev-panel 都可以用，nb-harness 只用核心；不依赖应用包；行为合同见 [`ui/forms.md`](../specs/ui/forms.md) |
| 布局工具 | `packages/nb-layout/` | 核心（`.`，不依赖任何包：布局树、尺寸求解器、落点几何、拖动手势）与 Vue 层（`./vue`，只依赖 `vue` 与 `tabbable`：分隔条、渲染器、拖放反馈、拖动会话与落点登记；主题经 `--nb-layout-*` 变量、由 nb-ui 的 `tokens.css` 桥接，文字经 `./text` 的注入点）；验证命令见包内 [`AGENTS.md`](../../packages/nb-layout/AGENTS.md) | w00026 t04 从 nb-ui 拆出（[ADR 0044](../adr/0044-workbench-single-layout-tree.md)）；nb-ui 不依赖也不重导出它；nb-story、dev-panel 的分栏也用它（w00026 t14 从 nb-ui 冻结的那一份迁来，那一份已删）；工作台的布局文档在 nb-workbench-layout；做成通用布局库前 `private`（[ADR 0054](../adr/0054-nb-layout-general-library.md)）；行为合同见 [`ui/nested-grid.md`](../specs/ui/nested-grid.md) |
| 工作台布局层 | `packages/nb-workbench-layout/` | 核心（`.`，只经公开入口用 nb-layout：布局文档、投影到布局树、落点规则）与 Vue 层（`./vue`，依赖 nb-ui：标签条）；验证命令见包内 [`AGENTS.md`](../../packages/nb-workbench-layout/AGENTS.md) | w00026 t33 从 nb-layout 拆出（[ADR 0054](../adr/0054-nb-layout-general-library.md)）；`private`，许可证同仓库；行为合同见 [`ui/workbench-layout.md`](../specs/ui/workbench-layout.md) |
| Agent 对话视图 | `packages/nb-agent-ui/` | 核心（`.`，不依赖任何包，含 harness 适配器）与 Vue 渲染层（`./vue`，依赖 nb-ui 与 nb-layout 的分栏）；验证命令见包内 [`AGENTS.md`](../../packages/nb-agent-ui/AGENTS.md) | w00019 t10 新建；Markdown 显示与提示词编辑器由宿主注入（真实组件在 `nb-markdown`）；不依赖应用包；行为合同见 [`ui/agent-conversation-view.md`](../specs/ui/agent-conversation-view.md)，模型请求查看器 `AgentRequestTrace` 见 [`agent/request-trace.md`](../specs/agent/request-trace.md)（数据形状按结构声明，nb-harness 只是开发依赖，契约测试核对） |
| Markdown | `packages/nb-markdown/` | 纯 TS 入口（`.`，只依赖 `entities`，后端的字数也用；`./prompt-text` 守同样的规则，服务端认 `$` 标签用）、语言与编解码器（`./language`）、宿主接口与组件（`./host`、`./display`、`./chip`、`./prompt`、`./editor`，依赖 nb-ui 与 TipTap）；验证命令见包内 [`AGENTS.md`](../../packages/nb-markdown/AGENTS.md) | w00025 t16 从 `nbook.markdown` 抽出；不依赖应用包与插件内核，链接目标的分类、语言与诊断由宿主经 `provideMarkdownHost` 给；`nbook.markdown` 是它的宿主之一（方言的贡献、作品文件的分类、字数、编辑器控件留在插件）；行为合同见 [`ui/markdown-display.md`](../specs/ui/markdown-display.md)、[`ui/prompt-editor.md`](../specs/ui/prompt-editor.md)、[`workspace/markdown-dialect.md`](../specs/workspace/markdown-dialect.md) |
| Agent harness 重构 | `packages/nb-harness/`、`nb-profile/`、`nb-session/` | 包内测试 | w00002 新建；`nb-harness` 是内核加宿主套件（`src/kit/`），NeuroBook 与 NeuroBot 共用，应用专有的地址、文字与 id 由宿主传入；依赖 `nb-form` 的核心与 `nb-flock`（会话日志的单写者锁），不依赖应用包与 `nb-runtime` |
| 通用基础包 | `packages/owned-process/`、`file-snapshot-cache/`、`neuro-book-test-support/`、`neuro-book-contracts/` | 各包公开 exports | `neuro-book-contracts` 的交付链出口不再维护，旧应用退出时一并清理 |
| 开发工具 | `packages/dev-panel/` | `nbdev` 命令行（用户级 shim 指向主工作区）、开发者面板、根 `scripts/ci/dev-panel-records.test.ts` | 开发工具，不是产品功能：不进产品与发布产物；不依赖应用包、不导入根 `scripts/`；读写主工作区的 `.agents/works/` 与 `.local/agent/` |
| 剧情图谱 | `packages/nb-story/` | `nbstory` 命令行、`nbstory serve` 的独立服务与网页查看器、给外部 Agent 的 Skill；验证命令见包内 [`AGENTS.md`](../../packages/nb-story/AGENTS.md) | w00024 新建，单独使用；作为 npm 包发布，连同依赖的 9 个工作区包（nb-ui、nb-agent-ui、nb-form、nb-markdown、nb-harness、nb-profile、nb-session、nb-runtime、nb-flock，[ADR 0029](../adr/0029-workspace-packages-publish-source-to-npm.md)、[ADR 0052](../adr/0052-non-stale-file-lock-package.md)）；依赖 `nb-runtime` 的 `./remote`、`nb-ui`，书库、导入与问答配置的锁依赖 `nb-flock`，内置问答另依赖 `nb-harness`、`nb-profile`、`nb-session`，网页的问答页与设置页另依赖 `nb-agent-ui`、`nb-markdown`、`nb-form`（只进前端构建）；网页只引本包不碰 node 的 `src/contract/`，不引核心库与问答引擎；不依赖应用包与 `nb-memory`；行为合同见 `docs/specs/story/` |
| 世界引擎内核 | `packages/nb-canon/` | 作者视角的世界引擎：条目、剧情变更与修订的模型与计算、渲染与带值写法、世界服务的语义；验证命令见包内 [`AGENTS.md`](../../packages/nb-canon/AGENTS.md) | w00039 新建；主入口不引用 `node:*`，但带着 MDX 解析链，浏览器代码在运行时只引 `./schema`（Vite 开发模式下主入口的依赖加载不了，应用的 `src/architecture.test.ts` 检查）；`./schema` 只有 schema、Component 声明校验与值的显示文字（只依赖 TypeBox）；`./node` 是只在 Bun 里用的分段日志存储与世界服务；`./sample` 是星瑕样本与换成写入请求的转换，只给测试与生成样本作品的脚本用（Bun、Node）；运行时只依赖 TypeBox、MDX 解析链（micromark 及其扩展、acorn）与 `@notnotype/nb-time`；不依赖应用包；由应用的 canon 插件接存储、服务与界面；行为合同见 `docs/specs/canon/` |
| 故事时间 | `packages/nb-time/` | 历法、时间说法、时间约束网络（范围、依据、打架）、查询与按历法格式化；验证命令见包内 [`AGENTS.md`](../../packages/nb-time/AGENTS.md) | w00039 新建；没有运行时依赖、前后端共用，不引用 `node:*`；nb-canon 用它给剧情变更算时间，nb-story 用同一个包；行为合同见 `docs/specs/canon/time.md` |
| 文件锁 | `packages/nb-file-lock/` | 跨进程锁 `holdLock` 与加锁替换 `replaceLocked`；验证命令见包内 [`AGENTS.md`](../../packages/nb-file-lock/AGENTS.md) | w00043 新建，`private`；只有 `.` 一个入口、只在 Bun 进程里用；工作区里只有它直接依赖 `proper-lockfile`（4.1.2，补丁按“包名@版本”生效），锁的过期参数只此一份；与应用无关，不依赖应用包（[ADR 0045](../adr/0045-shared-host-packages-for-second-app.md)）；不判旧、持有到进程结束的锁在 `nb-flock`，两者怎么选见 [ADR 0052](../adr/0052-non-stale-file-lock-package.md) |
| 不判旧的文件锁 | `packages/nb-flock/` | 进程级独占锁 `tryLock`（`flock`、`LockFileEx`，进程怎样结束锁都由系统放掉）；验证命令见包内 [`AGENTS.md`](../../packages/nb-flock/AGENTS.md) | w00043 t12 新建，随 nb-story 发布到 npm；只有 `.` 一个入口、只在 Bun 里用；只导入 `bun:ffi` 与 `node:` 内置模块，没有运行时依赖；使用者是 nb-harness 的会话日志、nb-story 的书库、导入与问答配置、应用的 Skill 安装；与按过期判旧的 `nb-file-lock` 怎么选见 [ADR 0052](../adr/0052-non-stale-file-lock-package.md) |
| 两端宿主 | `packages/nb-host/` | 只监听回环、`Host` 与 `Origin` 核对、状态根认领、内核 RPC 端口、服务端进程的启动与停止 `startHostServer`、HTTP 与诊断两个宿主插件、浏览器一侧的内核实例与断线重连；验证命令见包内 [`AGENTS.md`](../../packages/nb-host/AGENTS.md) | w00043 新建，`private`；子路径 `./server`（Bun）、`./http/contracts`、`./socket`（不限）、`./web`（浏览器，只导入内核子路径与 TypeBox）、`./testing`（只给测试）；依赖 `nb-runtime`、`nb-file-lock`、Hono；应用名、产品名、插件 id、环境变量与端口缺省都由应用传入，不依赖应用包；行为合同见 `docs/specs/runtime/server-host.md`、`browser-host.md`（[ADR 0045](../adr/0045-shared-host-packages-for-second-app.md)） |
| 模型服务 | `packages/nb-models/` | 服务商与角色的配置形状、内置角色、设置页的远程合同定义、选择顺序与服务核心；验证命令见包内 [`AGENTS.md`](../../packages/nb-models/AGENTS.md) | w00043 新建，`private`；子路径 `./config`、`./contract`（不限，设置页用）、`./core`（Bun）、`./testing`（只给测试）；依赖 `nb-runtime`、`nb-harness`（只取 `kit/shapes`、`models` 与类型），合同 id、服务键与设置存储由应用给，不依赖应用包；行为合同见 `docs/specs/models/service.md`（[ADR 0045](../adr/0045-shared-host-packages-for-second-app.md)） |
| 页面引导 | `packages/nb-page-agent/` | 让 Agent 看懂并引导一个网页：文字快照与引用、定位、截图、高亮说明框；验证命令见包内 [`AGENTS.md`](../../packages/nb-page-agent/AGENTS.md) | w00033 新建，`private`；入口 `.`（页面引擎，浏览器用）、`./api`（参数与返回的 TypeBox schema，不碰 DOM）、`./attrs`（稳定名 `nbTarget`，不碰 DOM）、`./capture`（按 DOM 重画的截图，第一次截图时才加载）；只管一个页面里的事，界面文字、主题与悬停显示由宿主给，不依赖应用包、`nb-runtime` 与 Vue；NeuroBook 的宿主是内置插件 `nbook.page-agent`，行为合同见 [`agent/page-agent.md`](../specs/agent/page-agent.md) |
| 官方站 | `packages/nb-site-identity-contract/`、`nb-site-telemetry-contract/`、`nb-site-identity/`、`nb-site-telemetry/`、`nb-site-server/`、`nb-site-contract-tests/`、`nb-site-web/` | 进程入口 `nb-site-server` 的命令行 `nb-site`；合同测试起真实进程、只经 HTTP；验证命令与七个包共用的规则见 [`nb-site-server/AGENTS.md`](../../packages/nb-site-server/AGENTS.md) | w00037 新建，七个包都是 `private`；账号与统计两个模块装在一个 Bun 进程里，按能拆成服务的边界写（[ADR 0059](../adr/0059-official-site-one-process-split-ready-modules.md)），每个模块一个 SQLite 文件（[ADR 0061](../adr/0061-official-site-sqlite-file-per-module.md)）；依赖方向：两个合同包运行时只依赖 TypeBox，模块包只依赖自己的合同包，入口依赖两个模块包、两个合同包与 `nb-flock`，合同测试运行时只依赖两个合同包，前端不依赖模块包与入口，由入口的 `src/architecture.test.ts` 与合同测试、前端各自的 `boundary.test.ts` 检查；不依赖应用包；行为合同见 `docs/specs/site/` |

所有 `packages/*` 默认继承根 Rule/Skill、临时根、安全和 Git 规则。包可以保留自己的 `AGENTS.md`、`docs/`、legacy `.agents/tasks/` 和 `PROJECT-STATUS.md`，但 current Work/Task 只在根 `.agents/works/` 创建；`AGENTS.md` 必须引用 `../../AGENTS.md`。`.agent/.local` 必须被忽略且不得跟踪，`.worktree` 只允许迁移期间短暂存在并在 checkpoint 前清理。linked worktree 统一位于主 checkout 的 `/.worktree/` 下，主 checkout 是唯一目录外例外。

跨包依赖必须通过 workspace package 名和声明版本进入公开入口，不深导入其它包的源码。

## Module 必须声明的合同

每个新 Module 或迁移中的 Module 在 Task/设计记录中至少声明：

1. **Owner**：谁拥有实现、持久化真相源、删除语义和失败恢复。
2. **Interface**：调用方能使用的类型、命令或 DTO；不把内部实现类型当作公开合同。
3. **依赖方向**：允许的运行时依赖、type-only 依赖、禁止的反向依赖和宿主 adapter。
4. **数据边界**：文件、SQLite、JSON、缓存、编译 artifact 和运行临时目录分别由谁创建、验证、清理。
5. **入口**：开发、生产启动和测试分别从哪里进入；不保留同义 fallback。
6. **验证**：Module focused tests、typecheck，以及需要真实进程、浏览器或 Provider 证据的集成门禁。
7. **迁移撤销点**：中间产物、旧入口、journal、marker 和失败时的保留/恢复规则。

没有 Owner、Interface 和验证命令的目录拆分只是文件搬家，不得作为 Module 迁移开始条件。

## 允许的依赖方向

```text
领域 Module / 稳定合同 / 内核
        ↑
内置插件（各自的后端、前端与共用合同）
        ↑
后端宿主 / 前端宿主
```

- UI、HTTP 路由和 CLI 负责解析输入、授权、错误映射和编排；领域 Module 负责业务规则和数据所有权。
- 插件之间只经内核登记的贡献点、服务、远程服务与命令协作；运行时只引用对方对外公开的合同模块（新应用里是 `shared/contracts.ts`：服务键、远程合同、贡献点 id、schema、配置定义），不 import 对方的实现（[ADR 0022](../adr/0022-extensible-platform-and-plugin-trust.md)、[ADR 0026](../adr/0026-plugin-definitions-as-constants.md)）。
- 根 `scripts/` 只保留跨 workspace 的治理与自动化；应用专属的 smoke、seed 与开发命令进入应用包。
- 应用与领域包不得依赖 `@notnotype/neuro-book-legacy`；从旧应用迁入的代码整理后进入新位置，不保留对旧路径的引用。
- 共享 DTO 或 verifier 只有在实际存在跨宿主复用且不会形成反向环时才下沉，不为“看起来干净”提前抽包。

## 物理迁移步骤

1. **冻结基线**：读取根规则、相关 Task、包规则和入口；记录当前工作树、生成物和未跟踪文件。不得 stash、prune、reset 或覆盖已有改动。
2. **绘制调用图**：用语言服务、测试配置、`package.json`、workflow 和脚本入口确认所有消费者。字符串搜索只能补充，不能替代符号引用和动态入口审计。
3. **先定 Interface**：为目标 Module 写输入/输出、错误、生命周期、数据所有权和依赖方向；公开合同变化先更新 Spec/ADR，再迁移实现。
4. **建立目标包骨架**：补齐 `package.json`、exports、tsconfig、测试配置和生成物边界。目标包不得通过相对路径偷读其它包或根 `node_modules`。
5. **单次迁移一个 Module**：先迁实现和测试，再迁所有调用方、配置（含 `.gitattributes` 中按路径写的规则）、workflow、文档和生成器。导入采用明确的目标入口；不保留旧路径 alias、deprecated re-export 或静默 fallback。
6. **隔离运行数据**：测试、验收、cache 和 scratch 使用 `NBOOK_AGENT_TEMP_ROOT` 及受控子目录；任何 fixture 不得写入仓库 `.agent/tmp/`、`.worktree/`、包级 `.worktree/` 或目标包源码树。
7. **完成验证后删除旧边界**：确认旧路径引用为零、目标包独立 typecheck/test 通过、集成门禁通过，再删除旧实现和旧入口。删除前保留 provenance 或 Task 证据。
8. **记录实际偏差**：Task 写明未运行的浏览器、真实 Provider 门禁和剩余风险；不要把 focused test 写成全仓或产品验收。

## 本轮不做的事情

- 不修改旧应用 `packages/neuro-book-legacy` 的代码；需要旧行为时读它，在新应用按 Spec 重写。
- 新应用只发 [ADR 0033](../adr/0033-app-delivered-as-built-npm-package.md) 的 npm 包（`scripts/pack-app.ts` 生成，源码包保持 `private`）；目录包、桌面壳、后台运行与服务器部署在各自的提案通过前不做，不恢复 Manager。工作区包发布到 npm 按 [ADR 0029](../adr/0029-workspace-packages-publish-source-to-npm.md)。
- 不新建 runtime contract 平行包、跨存储事务框架或跨语言生成层。
- 不以浏览器、真实 Provider 或数据迁移结果替代 Module focused verification。

## 结构变更的持续条件

- 根 workspace、新应用和所有现存包的依赖图无反向环；领域包不得依赖应用。
- 新应用的开发、生产启动与测试都从明确入口工作。
- 生成物不回写错误的 owner 根。
- focused Module tests、应用集成测试、typecheck 和必要的平台门禁均有真实命令和证据。
- Task、ADR、Spec、CI workflow 与回滚说明同步完成。

相关长期边界见根 [AGENTS.md](../../AGENTS.md)、[packages/AGENTS.md](../../packages/AGENTS.md) 与 [ADR 0023](../adr/0023-v2-frontend-backend-stack.md)。当前规范注册表继续以本文件为 Monorepo / Module 唯一正文，不创建 `docs/specs/architecture/monorepo-boundaries.md` 副本。
