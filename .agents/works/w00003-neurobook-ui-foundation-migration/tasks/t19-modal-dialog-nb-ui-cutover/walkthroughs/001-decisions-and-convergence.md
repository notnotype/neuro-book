---
schema: nbook.walkthrough/v1
taskId: t19-modal-dialog-nb-ui-cutover
sequence: 1
role: tasker
status: in_progress
createdAt: 2026-09-14T10:20:00+08:00
---

# t19 Walkthrough 001：D1–D7 定案与 19 文件收敛核对

## 结论

19 个文件的 nb-ui `Dialog` 迁移（工作树内未提交）已按 D1–D7 收敛：23 个 `Dialog` 实例全部显式声明 teleport 宿主，19 处 `closable` 保留，7 处确认按钮文案回到产品既有 i18n，三个死组件及其引用断言删除。10 个工作台型大窗口、`useDialog.ts`、旧 `common/Dialog.vue` 按决策保持不动。未做浏览器验收（本机 Chromium 不可用）。

## D1 / D2 核对：19 文件 / 23 实例

| 文件 | 行 | `teleport-target` | `closable` | `:confirm-label` |
|---|---|---|---|---|
| `app/components/common/LucideIconPickerDialog.vue` | 43 | `.novel-ide-theme` | 有 | — |
| `app/components/novel-ide/NovelIdeSettingsDialog.vue` | 1144 | `.novel-ide-theme` | 有 | 有 |
| `app/components/novel-ide/NovelIdeToolPanel.vue` | 443 | `.novel-ide-theme` | 有 | 有 |
| `app/components/novel-ide/NovelIdeToolPanel.vue` | 448 | `.novel-ide-theme` | 有 | — |
| `app/components/novel-ide/agent/AgentSessionDialog.vue` | 211 | `.novel-ide-theme` | 无（自带 `#header`） | — |
| `app/components/novel-ide/ai/FormAnnotationDialog.vue` | 87 | `.novel-ide-theme` | 有 | — |
| `app/components/novel-ide/plot/NovelPlotPanel.vue` | 1911 | `.novel-ide-theme` | 有 | — |
| `app/components/novel-ide/plot/NovelPlotPanel.vue` | 1943 | `.novel-ide-theme` | 有 | 有 |
| `app/components/novel-ide/plot/chapter-panel/PlotChapterEditorDialog.vue` | 166 | `.novel-ide-theme` | 有 | — |
| `app/components/novel-ide/plot/planning/PlotDecisionDecideDialog.vue` | 98 | `.novel-ide-theme` | 有 | — |
| `app/components/novel-ide/plot/planning/PlotDecisionEditorDialog.vue` | 322 | `.novel-ide-theme` | 有 | — |
| `app/components/novel-ide/plot/planning/PlotDecisionLedgerTab.vue` | 631 | `.novel-ide-theme` | 有 | — |
| `app/components/novel-ide/plot/planning/PlotPromiseBeatDialog.vue` | 128 | `.novel-ide-theme` | 有 | — |
| `app/components/novel-ide/plot/planning/PlotPromiseEditorDialog.vue` | 152 | `.novel-ide-theme` | 有 | — |
| `app/components/novel-ide/plot/thread-panel/PlotThreadEditorDialog.vue` | 440 | `.novel-ide-theme` | 有 | — |
| `app/components/novel-ide/profile/BackupRecoveryCodeDialog.vue` | 239 | `.novel-ide-theme` | 有 | — |
| `app/components/novel-ide/workspace/WorkspaceCharacterDetailPanel.vue` | 440 | `.novel-ide-theme` | 无（自带 `#header`） | — |
| `app/components/novel-ide/workspace/WorkspaceLocationProfileDialog.vue` | 202 | `.novel-ide-theme` | 无（自带 `#header`） | — |
| `app/components/novel-ide/workspace/WorkspaceRuleProfileDialog.vue` | 196 | `.novel-ide-theme` | 无（自带 `#header`） | — |
| `app/components/profile-template-editor/ProfileTemplateVisualEditor.vue` | 2372 | `.novel-ide-theme` | 有 | 有 |
| `app/pages/admin/users.vue` | 279 | `false` | 有 | 有 |
| `app/pages/admin/users.vue` | 309 | `false` | 有 | 有 |
| `app/pages/admin/users.vue` | 329 | `false` | 有 | 有 |

- 合计 23 个实例；`closable` 19 处（D2 的 4 处例外全部自带 `#header`）；`teleport-target` 23/23 显式，无隐式默认。
- 19 个文件都从 `@notnotype/nb-ui/components` 导入 `Dialog`（无一保留 `nbook/app/components/common/Dialog.vue` 导入）。
- 行号为本轮结束时的位置；表中同一文件出现两行是同一文件内的两个实例。

## D3(b)：确认按钮文案（前后对照）

| 文件 | 行 | 迁移后默认值（本轮前） | 本轮动作 |
|---|---|---|---|
| `app/pages/admin/users.vue` | 279 | nb-ui 硬编码「确认」 | `:confirm-label="t('common.confirm')"` |
| `app/pages/admin/users.vue` | 309 | 同上 | 同上 |
| `app/pages/admin/users.vue` | 329 | 同上 | 同上 |
| `app/components/novel-ide/NovelIdeToolPanel.vue` | 443 | 同上 | 同上 |
| `app/components/novel-ide/NovelIdeSettingsDialog.vue` | 1151 | 同上 | 同上 |
| `app/components/novel-ide/plot/NovelPlotPanel.vue` | 1949 | 同上 | 同上 |
| `app/components/profile-template-editor/ProfileTemplateVisualEditor.vue` | 2378 | 同上 | 同上 |

- 取值来源：既有 i18n `common.confirm`（zh-CN「确定」/ en-US「Confirm」），即旧 `common/Dialog.vue` 的确认按钮原文；未新增 key。
- 合同里写「6 处」，而清单按文件列出为 7 处（`users.vue` 3 处 + 4 个文件各 1 处）；按清单全部落地。
- `NovelPlotPanel.vue` 与 `ProfileTemplateVisualEditor.vue` 此前没有任何 i18n 用法，为使文案来源唯一，各补 `const {t} = useI18n();`（写法与 `NovelIdeToolPanel.vue` 一致）。
- 全部 23 个实例的 footer 形态核对（确认没有漏掉的默认确认按钮）：7 个走**默认 footer** 且已带 `:confirm-label`（上表）；11 个用自定义 `#footer` 插槽（按钮文案由插槽自己写：`AgentSessionDialog`、`FormAnnotationDialog`、`NovelPlotPanel:1911`、`PlotChapterEditorDialog`、`PlotDecisionDecideDialog`、`PlotDecisionEditorDialog`、`PlotDecisionLedgerTab`、`PlotPromiseBeatDialog`、`PlotPromiseEditorDialog`、`PlotThreadEditorDialog`、`BackupRecoveryCodeDialog`）；5 个无 footer（`LucideIconPickerDialog`、`NovelIdeToolPanel:448`、`WorkspaceCharacterDetailPanel`、`WorkspaceLocationProfileDialog`、`WorkspaceRuleProfileDialog`）。

## D6(a)：删除清单与测试处理

删除（3 个组件）：

- `app/components/novel-ide/rag/NovelRagPanel.vue`
- `app/components/novel-ide/rag/NovelRagInspectorDialog.vue`
- `app/components/markdown-studio/MarkdownStudioTutorialAgentDialog.vue`

测试处理（只删与这三个组件相关的断言/用例）：

- `app/components/novel-ide/rag/NovelRagPanel.contract.test.ts` → 改名 `rag-entry-visibility.contract.test.ts`（文件名与 describe 都在引用已删除的组件，留着会误导）。
  - 删除「保留基础空状态和真实 RAG API 入口」「加载失败时清空旧数据…」两个用例（整段读 `NovelRagPanel.vue`）；
  - 删除「隐藏 Activity Bar RAG Inspector 入口，但保留独立 dialog 实现」中读 `NovelRagInspectorDialog.vue` 的断言与 `index.vue` 里对该 dialog 的引用断言；
  - 保留：写作模式隐藏 RAG tab（tabs / 活动栏 / 工具面板）、活动栏不提供 RAG Inspector 入口、`NovelRagInspectorSidebar/Main/Detail.vue` 三个仍在仓库的组件的内容断言。
- `app/utils/novel-writing-mode-entries.test.ts`：删除 `expect(toolPanel).not.toContain("NovelRagPanel")`（组件删除后该断言恒真），其余用例保留。

grep 证据（2026-09-14，工作树）：

```text
git grep -n -e NovelRagPanel -e NovelRagInspectorDialog -e MarkdownStudioTutorialAgentDialog \
  -- . ':(exclude).agents' ':(exclude)packages/neuro-book/.agents'
→ 无输出

grep -rn "NovelRagPanel\|NovelRagInspectorDialog\|MarkdownStudioTutorialAgentDialog" packages scripts desktop docs vitepress
→ 仅命中 .agents 历史任务记录（packages/neuro-book/.agents/tasks/**）、node_modules/.cache/nuxt 的旧自动导入声明、node_modules/.vite 的旧测试结果缓存
```

- 代码引用归零。历史 Task 记录（`.agents/`、`packages/neuro-book/.agents/`）按惯例不改写；`node_modules` 缓存会在下次 `nuxt prepare` / 测试运行时重建。

## D5(d)：冻结清单（本批未改，全部仍消费旧入口）

`PlotWorkbenchDialog`（`body-class="!gap-0 !overflow-hidden !p-0"`）、`WorldEngineWorkbenchDialog`（同上 + `:teleport-target="false"`、另用 `useDialog`）、`DiffWorkbenchDialog`（`:closable="false"` + `body-class="min-h-0"`）、`UserProfileWorkbenchDialog`、`AgentSessionTreeDialog`、`AgentTraceViewerDialog`、`WorkspaceHistoryInboxDialog`（`size="xl"` + `!p-0 !overflow-hidden`）、`ProfileTemplatePreviewDialog`、`WorkspaceCreateFileDialog`、`NovelIdeProfileDialog`（`size="xl"` + `:show-footer="false"`）。

旧入口剩余真实消费者 11 个 = 上面 10 个 + `app/composables/useDialog.ts`（`h(Dialog, ...)` 3 处）；`NovelIdeModelSelect.vue` 只在注释里提到该路径，不算依赖。

## 未列出的取舍（不在本批范围，报告给开发者）

1. `NovelRagInspectorDialog.vue` 删除后，`NovelRagInspectorSidebar/Main/Detail.vue` 与 `rag-inspector-workbench.types.ts` 已无消费者（本轮保留，`rag-entry-visibility.contract.test.ts` 仍在断言这三个组件的内容）。
2. `askTutorialAgent` / `askTutorialAgentDescription`（zh-CN / en-US）在 `MarkdownStudioTutorialAgentDialog.vue` 删除后不再被任何代码引用。
3. 工作树里有上一批遗留的未跟踪文件（`.tmp-d4-*.mjs`、`.tmp-d4-*.png`、`.tmp-html.mjs`），未读取、未修改、未删除。

## 验证证据（全部实际执行）

```text
bun x vue-tsc --noEmit -p packages/neuro-book/tsconfig.json
→ 无输出，退出码 0

bun run --cwd packages/nb-ui test
→ 16 files / 279 passed（未改 nb-ui，作回归对照）

bun run test -- profile-template rag-entry-visibility（packages/neuro-book）
→ 4 files / 11 passed

bun x vitest run --config vitest.tmp-dialog-cutover.config.ts（临时配置，仅把 app/utils/novel-writing-mode-entries.test.ts 纳入 include）
→ 1 file / 6 passed；临时配置已删除

bun run docs:check
→ {"failures":[],"checkedFiles":5534}

bun run governance:check
→ {"failures":[],"warnings":[]}
```

## 未完成项

- **浏览器验收未做**：D4（焦点陷阱 / 背景滚动锁）在真实页面上的表现、7 处确认按钮在两种语言下的实际渲染，都需要一次真实浏览器复核；本机 Chromium 启动超时，无替代环境。
- 10 个冻结窗口的迁移依赖 backlog 1（nb-ui Dialog 的 `padded/flush`）；命令式对话框依赖 backlog 2；旧组件删除依赖两者。
- 上述「未列出的取舍」三项待新授权。
