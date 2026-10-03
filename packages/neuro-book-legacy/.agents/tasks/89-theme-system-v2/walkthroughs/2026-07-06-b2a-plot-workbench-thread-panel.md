# B2a plot/workbench 与 thread-panel 硬编码清理

## 本轮目标

- 清理 `app/components/novel-ide/plot/workbench/*.vue` 与 `app/components/novel-ide/plot/thread-panel/*.vue` 中的 Tailwind 调色板类和 `dark:`。
- 不迁移 `plot-thread-panel.types.ts` 的分类色板定义。
- 按角色映射：主线/选中使用 accent，未解析/诊断使用 warning，完成/已连接使用 success，时间/路由信息使用 info，错误/删除使用 danger。

## 变更文件

- `app/components/novel-ide/plot/workbench/PlotWorkbenchSidebar.vue`
  - 选中 Thread 与主线强调迁移到 `--accent-*`。
  - Thread 状态徽标新增语义 class map。
  - `#5f3300` fallback 改为 `--accent-text`。
- `app/components/novel-ide/plot/workbench/PlotWorkbenchSceneList.vue`
  - Scene 状态徽标新增语义 class map。
  - 主线/写作提示/排序/依赖检查图标迁移到 accent/status 变量。
  - `#5f3300` fallback 改为 `--accent-text`。
- `app/components/novel-ide/plot/workbench/PlotWorkbenchSortableSceneCard.vue`
  - Scene 状态、World 时间、地点解析、占位 subject 徽标迁移到 status 变量。
- `app/components/novel-ide/plot/workbench/WorldEngineContextPanel.vue`
  - error/unresolved/subject type 徽标迁移到 danger/warning/success。
- `app/components/novel-ide/plot/workbench/SubjectMultiSelect.vue`
  - subject chip 与错误文案迁移到 info/danger。
- `app/components/novel-ide/plot/workbench/SubjectSingleSelect.vue`
  - 错误文案迁移到 danger。
- `app/components/novel-ide/plot/workbench/PlotWorkbenchInspector.vue`
  - unresolved 提示与 inline ref 高亮迁移到 warning/accent。
- `app/components/novel-ide/plot/workbench/PlotWorkbenchDialog.vue`
  - loading/error/success 状态点和错误 banner 迁移到 status 变量。
  - `#5f3300` fallback 改为 `--accent-text`。
- `app/components/novel-ide/plot/workbench/PlotWorkbenchPreviewWorkspace.vue`
  - 空态 warning 色和阴影迁移到主题变量。
- `app/components/novel-ide/plot/thread-panel/PlotThreadDetailPanel.vue`
  - 主线边框/图标、dirty 点、diagnostics 迁移到 accent/warning。
- `app/components/novel-ide/plot/thread-panel/PlotThreadScenePanel.vue`
  - 主线 chip 迁移到 accent；分类色板 chip 保持不动。
- `app/components/novel-ide/plot/thread-panel/PlotThreadEditorDialog.vue`
  - 错误/删除 hover/save 按钮文字迁移到 danger/text-inverse。
- `app/components/novel-ide/plot/thread-panel/PlotThreadSortableSceneRow.vue`
  - World 已连接徽标迁移到 success。
- `app/components/novel-ide/plot/thread-panel/PlotThreadPanelShell.vue`
  - 阴影颜色迁移到 `--shadow-color`。

## 验证结果

- 范围残留扫描：
  - `rg -n "(amber|yellow|rose|red|emerald|green|sky|blue|slate|gray|zinc|stone)-[0-9]|dark:|rgba\\(15,23,42|#5f3300" app/components/novel-ide/plot/workbench app/components/novel-ide/plot/thread-panel -g '*.vue'`
  - 结果：无匹配。
- `bun run typecheck`
  - 未通过。
  - 仍然只有 B1 已记录的无关错误：
    - `server/agent/profiles/writer-profile-contract.test.ts(61,17)` 缺少 `customTopSystemPrompt`。
    - `server/low-code-form/index.ts(798,13)` `LowCodeJsonValue | undefined` 赋给 `LowCodeJsonValue`。
- `bun run test`
  - 未通过。
  - 本轮全仓结果：21 个失败文件、59 个失败测试、4 个 unhandled errors。
  - 失败仍集中在服务端/agent/world-engine 超时、workspace-files hook timeout、agent harness session ENOENT、pi trace ENOTEMPTY 等，和 B2a 前端主题变量迁移无直接交集。

## 与计划的出入

- B2a 代码目标已完成。
- 分类色板定义文件未迁移，符合边界。
- 因全仓验证基线不绿，本批无法得到全绿验证；已记录实际结果。

## 下一步

- B2b 清理 `plot/tree/*`、plot preview、timeline、plot 顶层组件。
