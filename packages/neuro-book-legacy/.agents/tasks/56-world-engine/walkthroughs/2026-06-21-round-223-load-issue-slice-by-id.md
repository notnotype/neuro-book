# Round 223: Load Issue Slice By Id

## 背景

Round 222 已把 subject timeline 过滤下推到 `GET /slices?subjectIds=...&subjectMode=...`，解决了“只过滤最近 200 条”的主要问题。但 Review Queue 仍有一个真实使用卡点：写入 / 编辑返回的 transient issue 可能指向当前 timeline 尚未加载的下游 slice。此前点击这类 issue 只会提示“当前未加载，无法定位到时间线”，作者仍然得自己去找。

## 本轮变更

- 新增 `GET /api/projects/world-engine/slices/:sliceId`：
  - 返回单个 slice 的 metadata、mutations 和读时 issues。
  - 复用 service 层 `getSlice(sliceId)`，sliceId 继续拒绝空白或带首尾空白。
- 真实 `WorldEngineWorkbenchDialog` 的 Review Queue 定位改为：
  - 先查当前 `slices` 是否已有目标。
  - 没有则调用 `GET /slices/:sliceId` 懒加载目标 slice，并放进当前 timeline。
  - 成功后继续清理 search / kind / status / subject 阻挡过滤，聚焦 issue subject 与具体 issue key。
  - 如果 sliceId 为空或读取失败，才保留原来的无法定位提示。

## 计划出入

- 本轮没有引入按 issue id 查询或后端持久 triage；只补最小 slice 单点读取。
- 懒加载的 slice 会追加进当前 timeline 集合，不额外做复杂排序。当前目标是让作者能定位和处理 issue；后续如果要做完整时间轴虚拟列表，再单独设计。
- 未自动执行浏览器验证，遵守当前项目要求。

## 验证

- `bunx vitest run 'server/api/projects/world-engine/[...segments].test.ts'`：通过，40 tests。
- `bunx vitest run app/utils/world-engine-ide-entry.test.ts`：通过，3 tests。
- `bun run typecheck`：通过。

