# Round 222: Slice Subject Filter API

## 背景

继续沿“作者真的拿它写世界，第一个卡住的地方在哪”推进。真实 Workbench 已能按 subject 过滤 timeline，但旧实现是先从 `GET /slices?limit=200&withMutations=true` 拉最近 200 条，再在前端过滤。长时间线下查看单个 subject 的轨迹会漏掉较早切片，Review Queue 也可能提示目标 slice 未加载。

## 本轮变更

- `GET /api/projects/world-engine/slices` 新增 `subjectIds` 和 `subjectMode` query：
  - `subjectIds=erina,moran`
  - `subjectMode=any | all`，默认按 `any` 处理。
- service / repository 层把 subject 过滤下推到 slice 查询：
  - `any`：slice 中任一 mutation 命中所选 subject。
  - `all`：slice 中必须分别存在每个所选 subject 的 mutation。
- 真实 `WorldEngineWorkbenchDialog` 的 subject timeline 过滤改为 timeline-only reload：
  - 左栏选择 subject、切片卡片“只看 subject timeline”、移除 / 清空 subject 过滤、切换 `any/all` 都会重新读取服务端 filtered slices。
  - schema、subjects、RAG overview 仍只在完整 `loadWorld()` 时读取，避免每次切 subject 都重载全部数据。
  - pending simulation subject 不会传给 World Engine `subjectIds`，避免尚未注册身份的主体触发后端 subject 不存在错误。

## 计划出入

- 原先文档把 `GET /slices` subject 过滤列为后续 API 设计问题；本轮已实现最小服务端过滤，并接入真实 Workbench。
- 本轮没有继续扩展 kind / health 服务端过滤；这些仍保持前端过滤，因为当前真正会漏数据的是 subject timeline。
- 未自动执行浏览器验证，遵守当前项目要求；如要验收，需要用户明确允许后再跑主 IDE Workbench。

## 验证

- `bunx vitest run 'server/api/projects/world-engine/[...segments].test.ts'`：通过，40 tests。
- `bunx vitest run app/utils/world-engine-ide-entry.test.ts`：通过，3 tests。
- `bun run typecheck`：通过。

