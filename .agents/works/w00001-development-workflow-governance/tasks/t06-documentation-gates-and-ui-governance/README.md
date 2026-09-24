---
schema: nbook.task/v2
taskId: t06-documentation-gates-and-ui-governance
---

# 文档门禁与 UI 治理收口

## 目标与范围

开发者 2026-09-24 批准修复 DOC-H1/H2/H3，并采纳 UI 验收分档、implemented Spec 证据分类、受管组件范围、主工作区写入与 Work 收尾建议。行为合同未变：治理检查和文档契约调整，不改变产品运行时行为。

受管组件范围为 nb-ui barrel 对外导出的组件及 `packages/neuro-book/app/components/common/**` 下的 Vue 组件。为应用组件补文档时，同时满足 Component Lab 场景合同；无场景的组件按其实际宿主依赖补可运行场景或标记真实验证入口，不虚构状态。

非目标：修复其他 Work 的历史 Task 警告、清理任何 worktree/branch、运行真实 Provider/Model、远端写入或发布。

## 当前状态

治理规则、检查器、受管组件文档和应用 Component Lab 场景合同已完成；Lab 的 `data`（复合宿主输入）与 `input`（被测组件签名输入）通道已分离，并由 fixture 覆盖测试约束。checkout `.worktree/w00001-development-workflow-governance`，branch `feat/w00001-docs-anchor-check`。基础变更在本地提交 `f2887ff2`；本轮浏览器验收修正已单独提交到同一分支。远端动作未授权。

## 有效证据

| 验证 | 结果 |
|---|---|
| `bun x vitest run --config scripts/vitest.config.ts scripts/ci/check-documentation.test.ts` | 21/21 通过 |
| `bun scripts/ci/check-documentation.ts` | `failures: []`、`warnings: 72`、`checkedFiles: 6593`；警告来自历史 Work/Task 链接和既有 Spec 绑定，不属于本 Task 的失败门禁 |
| `bun run --cwd packages/neuro-book test -- app/component-lab/fixtures/index.test.ts app/component-lab/component-index.test.ts app/component-lab/fixtures/AgentSidebarViewFixture.test.ts` | 3 个文件、29/29 通过；包含新增 StructuredTextEditor 场景的组件签名合同与 AgentSidebar 原有回归 |
| `bun run --cwd packages/neuro-book nuxt:prepare` | 通过 |
| `git diff --cached --check` | 通过；仅有 git add 的既有 LF→CRLF 提示，无 diff-check 空白错误 |
| `playwright-cli open http://localhost:3000/lab` | 备用浏览器打开既有 live server 成功；标题为“组件 Lab”，渲染 `.lab-root`、108 个组件、五个检视 tab。该服务不是当前分支，未将其记作当前分支验收 |
| `bun run --cwd packages/neuro-book smoke:component-lab:core -- --url http://localhost:3000 --browser-executable "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"` | 既有 live server 页面可打开，但 3 项 smoke 断言失败：选中元素贴边标签、数组场景 `read_file`、数据面板“还原”；该服务未反映本分支新增的 `data/input` 场景改动 |
| `bun run --cwd packages/neuro-book smoke:component-lab:core -- --url http://127.0.0.1:3127 --browser-executable "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"` | 在当前分支隔离服务通过；包含五个检视 tab、选中贴边标签、数组场景数据、主题及窄屏偏好 |
| `browser.open(http://localhost:3000/lab)` | 内置 browser daemon 不可用；已使用备用 CLI 完成既有 live server 探测，未将既有服务冒充当前分支 |
| `bun x vue-tsc --noEmit --project tsconfig.json --pretty false` | 未通过：仍有 88 条旧 fixture 必填 prop 类型诊断；本轮触及的 ContextMenuFixture 与新增 StructuredTextEditorFixture 均无诊断。未将全局 typecheck 记作通过 |

当前分支使用系统临时目录下独立 State Root：先完成 4 个 App SQLite migrations，再验证 Application State 为 `already_current`；真实用户 State Root 未触碰。隔离服务位于 `http://127.0.0.1:3127/lab`，与其他 checkout 的 `localhost:3000` 分开。备用浏览器验证 StructuredTextEditor 富文本与 Markdown 源码场景可挂载、模式切换可用、浏览器控制台 0 errors / 0 warnings；390px 页面无横向溢出。修复了检查后贴边标签未渲染、首次场景初始化缺失必填 props、Teleport 根属性透传 warning、验证入口失效。
