# Round 187：Calendar 根配置必须是 object

## 背景

本轮继续按用户调整，暂停前端推进，只做后端与 API 设计收口。

Round 186 修复了 Calendar 单位字符串 `"0"` 被误接受的问题。继续巡检 `world-engine/calendar.yaml` 入口时发现另一条静默回退路径：如果整个 `calendar.yaml` 写成数组或标量，旧逻辑会把 YAML parse 结果强转成对象，然后读取不到任何字段，最终静默使用默认 Calendar。

显式存在但结构错误的配置不应被解释成“没有配置”。

## 变更

- `server/world-engine/calendar.ts`
  - YAML parse 结果先保持 `unknown`。
  - `normalizeCalendarConfig()` 入口新增根结构校验。
  - `null` / `undefined` 保持默认 Calendar 语义，兼容缺文件和空文件。
  - 非 object 或 array 返回稳定 400：`calendar 配置必须是 object`。
- `server/world-engine/world-engine.facade.test.ts`
  - Calendar 配置非法输入测试补数组根配置回归：`- nope`。
- 文档同步：
  - `docs/tasks/56-world-engine/README.md`
  - `docs/tasks/56-world-engine/sqlite-and-api.md`
  - `PROJECT-STATUS.md`

## 验证

- `bun run test server/world-engine/world-engine.facade.test.ts`
  - 1 file passed，67 tests passed。
- `bun run test server/world-engine/world-engine.facade.test.ts 'server/api/projects/world-engine/[...segments].test.ts' server/agent/tools/world-engine-tools.test.ts server/agent/profiles/world-engine-profile.test.ts`
  - 4 files passed，127 tests passed。
- `bun run typecheck`
  - 未通过，失败点是前端 i18n 既有缺口：
    - `app/i18n/locales/en-US.ts(1611,3)` 缺少 `worldEngine`。
  - 本轮按“只做后端/API”范围没有修改前端。

## 与计划出入

- 原大路线仍包含前端 Preview / Workbench 收口；本轮按用户最新调整不做前端。
- 目标后端/API/Agent/Profile 测试已通过；全仓 typecheck 当前被前端 i18n 缺口阻塞，已在本记录和 `PROJECT-STATUS.md` 中说明。
