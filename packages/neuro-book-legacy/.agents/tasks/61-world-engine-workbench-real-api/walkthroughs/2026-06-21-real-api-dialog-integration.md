# 2026-06-21 Real API Dialog Integration

## Summary

- 将主 IDE 里的 `WorldEngineWorkbenchDialog.vue` 从旧 `Timeline / Edit / State / Schema` 调试台替换为 mock workbench 验证过的三栏工作台。
- 新工作台读取真实 `/api/projects/world-engine/**` 数据：schema、subjects、slices、state query、full state，并支持 slice metadata / mutation value 保存、删除 slice、创建 subject、一键示例世界。
- `/world-engine.workbench-preview` 继续保留为 mock-only UI / UX 实验场；本轮没有改后端 DTO 或 API。

## Changes

- `WorldEngineWorkbenchDialog.vue`
  - 使用 `WorldEngineWorkbenchPreviewSidebar`、`WorldEngineWorkbenchPreviewSliceList`、`WorldEngineWorkbenchPreviewMutationEditor` 和 `WorldEngineWorkbenchPreviewInspector` 组成真实三栏 Workbench。
  - 读取 `GET /schema`、`GET /subjects`、`GET /slices?limit=200&withMutations=true`，并把真实 slices 规范成 preview 组件需要的强数组结构。
  - 选中 slice 后通过 `POST /state/query` 查询触及 subjects 的当前 / 前一切片状态；展开完整世界时按需调用 `GET /state?at=<slice.time>`。
  - metadata patch 和 mutation value patch 都通过 `POST /slices/:id/edit` 显式保存；删除当前 slice 调 `DELETE /slices/:id`。
  - 保留旧入口里的刷新、创建 subject、一键示例世界、删除当前 slice、打开独立 Preview 能力。
  - issue triage、metadata draft、value draft 都保持当前 Dialog 会话态，不写入 `localStorage`。
- `app/utils/world-engine-workbench-real.ts`
  - 新增真实 Workbench 专用 helper：slice normalize、edit body 构造、持久 issue key、transient issue 合并。
- `WorldEngineWorkbenchPreviewMutationEditor.vue`
  - 新增批量 `updateMutationValues` 事件，让真实页面可以把多条 value patch 合并成一次 edit API 保存。
- `WorldEngineWorkbenchPreviewInspector.vue`
  - 支持真实页面传入保存按钮文案、metadata 状态后缀、remote full snapshot loading / error / subjects，并在展开完整世界时请求父组件加载。
- `WorldEngineWorkbenchPreviewSidebar.vue`
  - 增加 actions slot，真实 Dialog 用来放 `WorldEngineSubjectCreator`。
- `world-engine.workbench-preview.vue`
  - 适配批量 value patch 事件，mock preview 仍逐条应用本地 reducer。
- `world-engine-ide-entry.test.ts`
  - 补充真实 Dialog 使用新三栏组件、真实 API endpoint、edit/delete/state/full snapshot、会话态 drafts 和保留入口的静态契约断言。

## Verification

- `bunx vitest run app/utils/world-engine-ide-entry.test.ts app/utils/world-engine-workbench-preview.test.ts`
- `bun run typecheck`

## Notes

- 计划与实际结果基本一致：真实 API 接入、三栏替换、session draft、issue triage 和 mock preview 保留均已完成。
- 实际实现中没有把旧完整 Mutation Builder 嵌回真实三栏工作台；复杂新建 slice / 结构编辑仍建议继续走独立 `/world-engine.preview`。
- `WorldEngineWorkbenchDialog.vue` 作为真实 API 容器目前约 1021 行。为降低迁移风险本轮没有继续拆分，后续应优先抽出 API/session composable 或 shell 子组件，避免真实 Workbench 后续扩展继续推高单文件体量。
- 未自动做浏览器验证；按项目约定，后续需要用户明确确认后再看主 IDE Dialog 的 1920 宽屏和较窄桌面视口。
