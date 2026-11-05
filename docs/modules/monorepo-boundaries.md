# Monorepo Module 边界与迁移规范

## 目的

NeuroBook 以一个 monorepo 维护应用、共享合同与可独立维护的包。`Module` 是逻辑所有权和依赖边界，不等于当前目录，也不要求每个 Module 立即成为 npm 包。

本分支按 [NeuroBook v2：并排重建应用](../proposals/neuro-book-v2-rebuild.md) 从零重建应用：新应用位于 `packages/neuro-book`，旧应用改名为 `packages/neuro-book-legacy`，只作代码与行为参照。根只保留 workspace 编排与治理入口；交付链（打包、发布、安装、Manager、桌面版）已在本分支删除；新应用现在发构建产物的 npm 包、带 `nbook` 命令（[ADR 0033](../adr/0033-app-delivered-as-built-npm-package.md)），目录包、桌面壳、后台运行与服务器部署另行设计。六个自治项目位于对应 `packages/*`，各自保留项目 docs、legacy Task 记录、状态和专属 `AGENTS.md`，默认继承根治理规则；current Work/Task 统一位于根 `.agents/works/`。

## 当前布局

| 边界 | 当前真相源 | 当前入口或消费方 | 当前状态 |
| --- | --- | --- | --- |
| 新应用 | `packages/neuro-book` | 后端进程入口 `src/server/main.ts`，命令行 `src/cli/main.ts`（`nbook`，[`runtime.cli`](../specs/runtime/cli.md)），前端入口 `src/web/main.ts`，开发命令 `bun run dev`；npm 包由 `bun run build:app-package` 生成；验证命令见包内 [`AGENTS.md`](../../packages/neuro-book/AGENTS.md) | 已有应用骨架：后端宿主、开发监督进程、浏览器宿主与空工作台；前端基础（vue-router、Tailwind v4、nb-ui、Vitest 组件测试）与只在开发模式加载的 Component Lab（`/lab`）已加入；工作台外壳、命令与布局随后续步骤加入。第三方插件的通用管理（安装、登记、装载、构建预设）在 `src/plugin-platform/`，只依赖内核与列名的通用件、由应用的平台档案配置，不引用内置插件与 NeuroBook 的合同，将来出现第二个使用插件模式的应用时搬成包；插件作者的公开 API 只经 `src/sdk/`；作者材料（作者命令、模板、作者文档、示例插件、打包出 SDK tarball）在 `plugin-sdk/`，产品代码不引用它。这几条由架构测试守住（[ADR 0030](../adr/0030-plugin-platform-layering.md)） |
| 内核 | `packages/nb-runtime` | 新应用的后端与浏览器宿主（第 3 步起） | 运行时依赖只有 TypeBox，每个机制一个子路径入口；与应用无关，应用的名字（清单的引擎键、保留的发布者）由宿主以平台档案传入（[ADR 0030](../adr/0030-plugin-platform-layering.md)）；行为合同见 `docs/specs/runtime/` 的 lifecycle、services、plugins、application、diagnostics；典型用法见应用包的示例插件 [`packages/neuro-book/plugin-sdk/examples/`](../../packages/neuro-book/plugin-sdk/examples/README.md) |
| 旧应用 | `packages/neuro-book-legacy` | 只读参照 | 依赖照装，不参加类型检查、测试与治理检查；包内含 w00017 阶段 1 的内核与宿主实现、ADR 0001–0021、legacy `.agents/tasks/` |
| Workspace 自治包 | `packages/nb-history/`、`nb-workflow/`、`nb-memory/`、`nb-ui/`、`neuro-agent-harness/`、`llmlint/` | 各包公开 exports、包内测试和应用消费者 | 各包独立 owner；`neuro-agent-harness` 已冻结，只服务 `llmlint`，待由 `nb-harness` 取代后退役 |
| Schema 表单 | `packages/nb-form/` | 核心（`.`，只依赖 TypeBox）与 Vue 渲染层（`./vue`，依赖 nb-ui）；验证命令见包内 [`AGENTS.md`](../../packages/nb-form/AGENTS.md) | w00027 t07 新建；应用与 dev-panel 都可以用；不依赖应用包；行为合同见 [`ui/forms.md`](../specs/ui/forms.md) |
| Agent 对话视图 | `packages/nb-agent-ui/` | 核心（`.`，不依赖任何包，含 harness 适配器）与 Vue 渲染层（`./vue`，依赖 nb-ui）；验证命令见包内 [`AGENTS.md`](../../packages/nb-agent-ui/AGENTS.md) | w00019 t10 新建；Markdown 显示与提示词编辑器由宿主注入（真实组件在 `nb-markdown`）；不依赖应用包；行为合同见 [`ui/agent-conversation-view.md`](../specs/ui/agent-conversation-view.md) |
| Markdown | `packages/nb-markdown/` | 纯 TS 入口（`.`，只依赖 `entities`，后端的字数也用）、语言与编解码器（`./language`）、宿主接口与组件（`./host`、`./display`、`./chip`、`./prompt`、`./editor`，依赖 nb-ui 与 TipTap）；验证命令见包内 [`AGENTS.md`](../../packages/nb-markdown/AGENTS.md) | w00025 t16 从 `nbook.markdown` 抽出；不依赖应用包与插件内核，链接目标的分类、语言与诊断由宿主经 `provideMarkdownHost` 给；`nbook.markdown` 是它的宿主之一（方言的贡献、作品文件的分类、字数、编辑器控件留在插件）；行为合同见 [`ui/markdown-display.md`](../specs/ui/markdown-display.md)、[`ui/prompt-editor.md`](../specs/ui/prompt-editor.md)、[`workspace/markdown-dialect.md`](../specs/workspace/markdown-dialect.md) |
| Agent harness 重构 | `packages/nb-harness/`、`nb-profile/`、`nb-session/` | 包内测试 | w00002 新建；`nb-harness` 将作为 Agent 内置插件的基础 |
| 通用基础包 | `packages/owned-process/`、`file-snapshot-cache/`、`neuro-book-test-support/`、`neuro-book-contracts/` | 各包公开 exports | `neuro-book-contracts` 的交付链出口不再维护，旧应用退出时一并清理 |
| 开发工具 | `packages/dev-panel/` | `nbdev` 命令行（用户级 shim 指向主工作区）、开发者面板、根 `scripts/ci/dev-panel-records.test.ts` | 开发工具，不是产品功能：不进产品与发布产物；不依赖应用包、不导入根 `scripts/`；读写主工作区的 `.agents/works/` 与 `.local/agent/` |
| 剧情图谱 | `packages/nb-story/` | `nbstory` 命令行、`nbstory serve` 的独立服务与网页查看器、给外部 Agent 的 Skill；验证命令见包内 [`AGENTS.md`](../../packages/nb-story/AGENTS.md) | w00024 新建，单独使用；作为 npm 包发布，连同依赖的 8 个工作区包（nb-ui、nb-agent-ui、nb-form、nb-markdown、nb-harness、nb-profile、nb-session、nb-runtime，[ADR 0029](../adr/0029-workspace-packages-publish-source-to-npm.md)）；依赖 `nb-runtime` 的 `./remote`、`nb-ui`，内置问答另依赖 `nb-harness`、`nb-profile`、`nb-session`，网页的问答页与设置页另依赖 `nb-agent-ui`、`nb-markdown`、`nb-form`（只进前端构建）；网页只引本包不碰 node 的 `src/contract/`，不引核心库与问答引擎；不依赖应用包与 `nb-memory`；行为合同见 `docs/specs/story/` |
| 世界引擎内核 | `packages/nb-canon/` | 作者视角的世界引擎：条目、剧情变更与修订的模型与计算、渲染与带值写法、世界服务的语义；验证命令见包内 [`AGENTS.md`](../../packages/nb-canon/AGENTS.md) | w00039 新建；主入口前后端共用、不引用 `node:*`，`./schema` 只有 schema 与 Component 声明校验（只依赖 TypeBox，浏览器用），`./node` 是只在 Bun 里用的分段日志存储与世界服务；运行时只依赖 TypeBox、MDX 解析链（micromark 及其扩展、acorn）与 `@notnotype/nb-time`；不依赖应用包；由应用的 canon 插件接存储、服务与界面；行为合同见 `docs/specs/canon/` |
| 故事时间 | `packages/nb-time/` | 历法、时间说法、时间约束网络（范围、依据、打架）、查询与按历法格式化；验证命令见包内 [`AGENTS.md`](../../packages/nb-time/AGENTS.md) | w00039 新建；没有运行时依赖、前后端共用，不引用 `node:*`；nb-canon 用它给剧情变更算时间，nb-story 用同一个包；行为合同见 `docs/specs/canon/time.md` |

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
