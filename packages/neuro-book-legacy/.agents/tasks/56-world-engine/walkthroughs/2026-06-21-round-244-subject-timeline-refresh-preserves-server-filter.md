# Round 244: Subject Timeline Refresh Preserves Server Filter

## Context

上一轮已让 Slice Composer 在 subject 过滤视角下参考已知整体 timeline 时间窗口。但继续从作者真实使用路径检查时发现：文档和实现都已经把 subject timeline 过滤切到服务端 `GET /slices?subjectIds=...&subjectMode=...`，以避免长 timeline 只在最近 200 条里做前端过滤；可部分常用动作仍会在完成后调用全量 `loadWorld()`。

这些动作包括：

- 顶栏刷新。
- metadata / mutation value 保存。
- 创建 subject / 同步主体系统。
- 删除当前 slice。
- Slice Composer 写入或编辑成功。

如果作者正处于单 subject / 多 subject 时间线，这些路径会先回到全量 timeline，再由 Slice List 在当前 200 条结果上做本地 subject 过滤。短 timeline 下不明显，长 timeline 下可能重新漏掉较早命中的 subject slice。

## Changes

- 在 `WorldEngineWorkbenchDialog.vue` 中新增 `LoadWorldOptions` 类型，复用 `autoSelectSlice / preferredSliceId / preferredSubjectIds`。
- 新增 `refreshWorldForCurrentTimeline()`：
  - 先调用 `loadWorld()` 刷新 schema / subjects / RAG overview / 全量时间窗口。
  - 如果当前仍有已注册 subject 过滤，再调用 `reloadTimelineForCurrentSubjectFilter()`，继续使用服务端 subject timeline。
  - 删除 slice 这类需要保持无选中状态的路径会把 `autoSelectSlice: false` 传给第二段刷新。
- 让常用动作改走 `refreshWorldForCurrentTimeline()`：
  - 保存 slice 编辑。
  - 创建示例世界。
  - 创建 subject。
  - 同步主体系统成功 / 部分成功。
  - 删除当前 slice。
  - Slice Composer 保存。
  - 顶栏刷新按钮。
- `reloadTimelineForCurrentSubjectFilter()` 接收 `autoSelectSlice` 并传给 `applyDefaults()`，避免删除后 subject filtered timeline 重新自动选中下一条 slice。
- 更新 `world-engine-ide-entry.test.ts` 的静态契约，防止这些入口退回全量本地过滤。

## Verification

- `bunx vitest run app/utils/world-engine-ide-entry.test.ts`
- `bun run typecheck`

均通过。

## Browser

本轮未自动执行浏览器验证。若需要，可在用户明确允许后跑主 IDE Workbench：进入 subject timeline，点击刷新、保存一个 slice 元信息、删除一个测试 slice，确认列表仍按服务端 subject 过滤结果展示。

## Result

实际结果与计划一致：没有改后端 API / DTO，没有做 issue triage 持久化，也没有扩大测试面。修正只覆盖当前作者连续操作中最容易把 subject 视角退回本地过滤的入口。
