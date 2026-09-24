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

治理规则、检查器、受管组件文档和应用 Component Lab 场景合同已完成；Lab 的 `data`（复合宿主输入）与 `input`（被测组件签名输入）通道已分离，并由 fixture 覆盖测试约束。产品业务运行时未改。checkout `.worktree/w00001-development-workflow-governance`，branch `feat/w00001-docs-anchor-check`。改动已提交到当前本地 checkout；远端动作未授权。

## 有效证据

| 验证 | 结果 |
|---|---|
| `bun x vitest run --config scripts/vitest.config.ts scripts/ci/check-documentation.test.ts` | 21/21 通过 |
| `bun scripts/ci/check-documentation.ts` | `failures: []`、`warnings: 72`、`checkedFiles: 6592`；警告来自历史 Work/Task 链接和既有 Spec 绑定，不属于本 Task 的失败门禁 |
| `bun run --cwd packages/neuro-book test -- app/component-lab/fixtures/index.test.ts app/component-lab/fixtures/AgentSidebarViewFixture.test.ts app/component-lab/component-index.test.ts` | 3 个文件、29/29 通过；签名合同测试显式给动态加载 36 个受检组件留出 30 秒冷启动窗口 |
| `bun run --cwd packages/neuro-book nuxt:prepare` | 通过 |
| `git diff --cached --check` | 通过；仅有 git add 的既有 LF→CRLF 提示，无 diff-check 空白错误 |
| `playwright-cli open http://localhost:3000/lab` | 备用浏览器打开既有 live server 成功；标题为“组件 Lab”，渲染 `.lab-root`、108 个组件、五个检视 tab。该服务不是当前分支，未将其记作当前分支验收 |
| `bun run --cwd packages/neuro-book smoke:component-lab:core -- --url http://localhost:3000 --browser-executable "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"` | 既有 live server 页面可打开，但 3 项 smoke 断言失败：选中元素贴边标签、数组场景 `read_file`、数据面板“还原”；该服务未反映本分支新增的 `data/input` 场景改动 |
| `bun run --cwd packages/neuro-book smoke:component-lab:core -- --url http://127.0.0.1:3127 --browser-executable "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"` | 当前分支隔离服务在启动门禁处停止：待应用 4 个 App SQLite migrations，且 Application State 尚未初始化；未执行迁移，也未触碰真实用户 State Root |
| `browser.open(http://localhost:3000/lab)` | 内置 browser daemon 不可用；已使用备用 CLI 完成既有 live server 探测，未将既有服务冒充当前分支 |

localhost:3000 的浏览器探测证明既有 Lab 页面可达；完整 smoke 的失败不能归因于当前分支。当前分支完整浏览器验收和 smoke 复测受迁移门禁与 browser daemon 不可用双重阻塞；不修改其他 Work 的历史警告，也不执行受限迁移动作。
