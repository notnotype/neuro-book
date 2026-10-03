# Monorepo Module 边界与迁移规范

## 目的

NeuroBook 以一个 monorepo 维护应用、共享合同与可独立维护的包。`Module` 是逻辑所有权和依赖边界，不等于当前目录，也不要求每个 Module 立即成为 npm 包。

本分支按 [NeuroBook v2：并排重建应用](../proposals/neuro-book-v2-rebuild.md) 从零重建应用：新应用位于 `packages/neuro-book`，旧应用改名为 `packages/neuro-book-legacy`，只作代码与行为参照。根只保留 workspace 编排与治理入口；交付链（打包、发布、安装、Manager、桌面版）已在本分支删除，新应用的交付另行设计。六个自治项目位于对应 `packages/*`，各自保留项目 docs、legacy Task 记录、状态和专属 `AGENTS.md`，默认继承根治理规则；current Work/Task 统一位于根 `.agents/works/`。

## 当前布局

| 边界 | 当前真相源 | 当前入口或消费方 | 当前状态 |
| --- | --- | --- | --- |
| 新应用 | `packages/neuro-book` | 后端进程入口 `src/server/main.ts`，前端入口 `src/web/main.ts`，开发命令 `bun run dev`；验证命令见包内 [`AGENTS.md`](../../packages/neuro-book/AGENTS.md) | 已有应用骨架：后端宿主、开发监督进程、浏览器宿主与空工作台；workbench 底座随后续步骤加入 |
| 内核 | `packages/nb-runtime` | 新应用的后端与浏览器宿主（第 3 步起） | 零运行时依赖，每个机制一个子路径入口；行为合同见 `docs/specs/runtime/` 的 lifecycle、services、plugins、application、diagnostics |
| 旧应用 | `packages/neuro-book-legacy` | 只读参照 | 依赖照装，不参加类型检查、测试与治理检查；包内含 w00017 阶段 1 的内核与宿主实现、ADR 0001–0021、legacy `.agents/tasks/` |
| Workspace 自治包 | `packages/nb-history/`、`nb-workflow/`、`nb-memory/`、`nb-ui/`、`neuro-agent-harness/`、`llmlint/` | 各包公开 exports、包内测试和应用消费者 | 各包独立 owner；`neuro-agent-harness` 已冻结，只服务 `llmlint`，待由 `nb-harness` 取代后退役 |
| Agent harness 重构 | `packages/nb-harness/`、`nb-profile/`、`nb-session/` | 包内测试 | w00002 新建；`nb-harness` 将作为 Agent 内置插件的基础 |
| 通用基础包 | `packages/owned-process/`、`file-snapshot-cache/`、`neuro-book-test-support/`、`neuro-book-contracts/` | 各包公开 exports | `neuro-book-contracts` 的交付链出口不再维护，旧应用退出时一并清理 |

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
- 插件之间只经内核登记的贡献点、服务与命令协作，不在运行时 import 其它插件的模块（[ADR 0022](../adr/0022-extensible-platform-and-plugin-trust.md)）。
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
- 不在新应用交付链设计前恢复打包、发布、安装、Manager 或桌面版。
- 不新建 runtime contract 平行包、跨存储事务框架或跨语言生成层。
- 不以浏览器、真实 Provider 或数据迁移结果替代 Module focused verification。

## 结构变更的持续条件

- 根 workspace、新应用和所有现存包的依赖图无反向环；领域包不得依赖应用。
- 新应用的开发、生产启动与测试都从明确入口工作。
- 生成物不回写错误的 owner 根。
- focused Module tests、应用集成测试、typecheck 和必要的平台门禁均有真实命令和证据。
- Task、ADR、Spec、CI workflow 与回滚说明同步完成。

相关长期边界见根 [AGENTS.md](../../AGENTS.md)、[packages/AGENTS.md](../../packages/AGENTS.md) 与 [ADR 0023](../adr/0023-v2-frontend-backend-stack.md)。当前规范注册表继续以本文件为 Monorepo / Module 唯一正文，不创建 `docs/specs/architecture/monorepo-boundaries.md` 副本。
