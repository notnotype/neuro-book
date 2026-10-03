# Round 231: 主体同步冲突提示改成 UI 行动

Round 230 已把“同步主体系统”会使用的初始化时间显示出来。继续按作者视角往下走，发现另一个小卡点：如果这个初始化时间已经存在非 `init` 切面，后端会正确返回 409，要求显式编辑已有 slice 或换时间；但前端冲突文案转译只识别 `edit_world_slice`，没有识别 `createSubject` 路径里的 `editSlice`。作者会看到偏 API 的 camelCase 提示。

本轮只改前端展示，不改变后端 `createSubject` 契约，不放宽“subject default 只能自动追加到 init slice”的规则。

## Changes

- `app/utils/world-engine-preview.ts`
  - `formatWorldEngineConflictMessage()` 新增 `目标时间已有非 init 切面` 分支。
  - 文案改为：目标时间已有普通切面，不能自动追加 subject 初始化；请在 Timeline 载入这个时间的 slice 显式合并，或把初始化时间改到相邻时间。
  - 继续保留后端返回的 `existingSliceId / time / title` 定位细节。
- `app/utils/world-engine-preview.test.ts`
  - 扩展同 instant 冲突纯函数测试，确认非 init 初始化冲突不再露出 `editSlice`，并保留 `existingSliceId`。

## Validation

- `bunx vitest run app/utils/world-engine-preview.test.ts app/utils/world-engine-ide-entry.test.ts`
- `bun run typecheck`

两项均通过。本轮未自动执行浏览器验证。

## Plan Diff

计划是继续找同步主体系统的真实使用卡点。实际只补了共享 formatter 的一个分支和一条纯函数断言，没有改 API、数据库或同步流程；这和当前“不继续抠畸形输入、只修作者第一眼卡住的地方”的方向一致。
