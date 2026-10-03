# Round 186：Calendar 字符串单位必须大于 0

## 背景

本轮继续按用户调整，暂停前端推进，只做后端与 API 设计收口。

巡检 `world-engine/calendar.yaml` 配置边界时发现一个小漏洞：Round 181 已要求 YAML number 形式的 Calendar 单位必须是 JS safe integer 正整数，字符串形式用于表达超过 safe integer 的大整数。但 `readConfigBigInt()` 对字符串只检查 `^\d+$`，因此 `secondsPerMinute: "0"` 会被接受并转成 `0n`。

这与“正整数”契约不一致，也可能让后续 `format()` / `parse()` 在计算时走到除零。

## 变更

- `server/world-engine/calendar.ts`
  - 字符串单位解析后必须 `> 0n`。
  - `"0"` / `"000"` 这类输入返回稳定 400：`<key> 必须是正整数`。
- `server/world-engine/world-engine.facade.test.ts`
  - 在 Calendar 配置非法输入测试中补 `secondsPerMinute: "0"` 回归。
- 文档同步：
  - `docs/tasks/56-world-engine/README.md`
  - `docs/tasks/56-world-engine/sqlite-and-api.md`
  - `PROJECT-STATUS.md`

## 验证

- `bun run test server/world-engine/world-engine.facade.test.ts`
  - 1 file passed，67 tests passed。
- 首次目标组合测试出现 Vitest worker `EPIPE`，不是业务断言失败；复跑通过：
  - `bun run test server/world-engine/world-engine.facade.test.ts 'server/api/projects/world-engine/[...segments].test.ts' server/agent/tools/world-engine-tools.test.ts server/agent/profiles/world-engine-profile.test.ts`
  - 4 files passed，127 tests passed。
- `bun run typecheck`
  - 未通过，失败点是前端 Workbench mock 既有 props 缺口：
    - `app/pages/world-engine.workbench-preview.vue(719,14)`：`WorldEngineWorkbenchPreviewSidebar` 缺少必填 `width`。
    - `app/pages/world-engine.workbench-preview.vue(757,18)`：`WorldEngineWorkbenchPreviewMutationEditor` 缺少必填 `height`。
  - 本轮按“只做后端/API”范围没有修改前端。

## 与计划出入

- 原大路线仍包含前端 Preview / Workbench 收口；本轮按用户最新调整不做前端。
- 目标后端/API/Agent/Profile 测试已通过；全仓 typecheck 当前被前端 mock 页面阻塞，已在本记录和 `PROJECT-STATUS.md` 中说明。
