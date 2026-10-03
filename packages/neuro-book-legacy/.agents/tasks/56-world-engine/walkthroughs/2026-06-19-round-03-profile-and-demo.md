# Round 03 - Profile And Real Demo

## Scope

本轮目标是把 World Engine 工具暴露给一个可运行 profile，并从用户视角新建 Project 跑一个实际例子，评估第一版是否顺手、是否有 bug。

## Actual Changes

- 更新 `server/agent/profiles/profile-tools.ts`：
  - 新增 `builtin.world.*` typed tool binding。
- 新增系统 profile：
  - `assets/workspace/.nbook/agent/profiles/builtin/world.engine.profile.tsx`
  - 职责：World Engine 验证与维护，不接旧 `simulation/` workflow。
  - 工具：文件读取/编辑 + World Engine 工具 + profile/session 只读工具。
- 编译 profile runtime artifact：
  - `.compiled/builtin__world.engine.mjs`
  - `.compiled/builtin__world.engine.types.d.ts`
  - `.compiled/manifest.json`
- 更新 `reference/agent/profile-routing.md`：
  - 加入 `world.engine` 的职责和错位路由。
- 新增 `server/agent/profiles/world-engine-profile.test.ts`。
- 修复真实试用发现的 Calendar bug：
  - `WorldCalendar.projection()` 示例时间混用了 number 与 bigint，调用 `get_world_schema` 会抛 `Invalid mix of BigInt and other type`。
  - 已改为 BigInt literal，并在 `world-engine.facade.test.ts` 增加 `getWorldSchema()` 回归断言。
- 优化真实试用发现的查询体验：
  - `queryState({ subjectIds })` 现在保持调用方传入的 subjectIds 顺序，方便 Agent/用户阅读。
- 优化真实试用发现的同 instant 体验：
  - `writeSlice` / `editSlice` 的 instant 冲突错误现在包含 `existingSliceId`、格式化 `time` 和 `title`。
  - `createSubject` 返回 `{ subjectId, sliceId, mergedIntoExistingSlice }`，明确 init mutations 写入了哪个 slice。

## Real Demo

创建真实试用 Project：

- `workspace/world-engine-demo/project.yaml`
- `workspace/world-engine-demo/world-engine/schema.yaml`
- `workspace/world-engine-demo/world-engine/calendar.yaml`

通过 Agent 工具 runtime 跑通：

1. `create_world_subject`
   - world
   - capital
   - phoenix
   - erina
   - old-sword
2. `get_world_schema`
3. `write_world_slice`
   - 黑潮战争
   - 凤凰王国立国
   - 艾莉娜出生
   - 488 年学徒艾莉娜
   - 城北遭遇战
4. `get_world_state`
   - 城北遭遇战后，艾莉娜 hp = 50，inventory 包含 `subject://old-sword`。
5. 补过去：
   - 在城北遭遇战前写入 `战前状态修正`，把艾莉娜 hp 设为 90。
   - 工具返回 `needsResettle: true`，`affectedSubjects: ["erina"]`。
6. `resettle_world_timeline`
   - 从 `复兴纪元488年 1月15日 13:00:00` 重结算 erina。
7. 再次 `get_world_state`
   - 艾莉娜 hp = 60，符合 90 - 30。

## Verification

- `bun scripts/build/profile.ts compile builtin/world.engine.profile.tsx --system`
  - 通过，写入 1 个 artifact。
- `bun scripts/build/profile.ts compile --all --system`
  - 通过。因为新增 `builtin.world.*` 改动了 profile 工具依赖，系统 profile artifact 需要全量刷新。
- `bun scripts/build/profile.ts status world.engine --system`
  - `world.engine: loaded`
- `bunx vitest run server/world-engine/world-engine.facade.test.ts server/agent/tools/world-engine-tools.test.ts server/agent/profiles/world-engine-profile.test.ts`
  - 通过：3 个测试文件，11 个用例。
  - 后续修复同 instant 体验后再次通过。
- `bunx vitest run server/agent/profiles/leader-assets-profile.test.ts server/agent/profiles/rp-profiles.test.ts server/agent/profiles/world-engine-profile.test.ts --reporter=dot`
  - 通过：3 个测试文件，23 个用例。
- 真实工具链试用脚本通过：
  - 使用 `createWorldEngineTools().executeWithContext()`，只传 Calendar 字符串。
  - 写入真实 `workspace/world-engine-demo/.nbook/project.sqlite`。

## Evaluation

好用的部分：

- Agent 工具层只传日历字符串，确实比 raw instant 更自然。
- `get_world_schema` 对 Agent 很关键；没有它很容易写错 attr/op/ref。
- `needsResettle` 能清楚提示“补过去影响了后续 old 缓存”，并且显式 re-settle 后状态正确。
- `list_world_slices` 输出 `time` 而不是 raw instant，符合工具层边界。

不顺手 / 易踩点：

- 同一 instant 只能一个 slice 的规则在手工试用时很容易踩到，尤其是 `create_world_subject` 的 init slice 和普通 event/correction 时间相同时。当前错误是正确的，但 Agent 提示应该更明确地建议“改用 edit_world_slice 合并到已有 slice，或选择相邻时间”。
- `create_world_subject` 会写 init slice；如果用户只是想注册 subject，再立刻在同一时间写事件，必须理解 init slice 已经占用了该 instant。
- `resettle_world_timeline` 的 `reSettledMutations` 会包含 from 当刻的 correction mutation 本身，而 `write_world_slice` 返回的 `affectedMutations` 只统计后续 mutation。这个差异合理，但需要在工具说明里解释。

已修复 bug：

- `get_world_schema` 调用 Calendar projection 时 BigInt 混用 number。
- `queryState({ subjectIds })` 不保持输入顺序。
- 同 instant 冲突错误缺少已有 slice 信息，Agent 不容易改用 `edit_world_slice`。
- `create_world_subject` 不返回 init slice 信息，用户不容易意识到 subject 初始化已经占用该时间点。

## Browser Testing

本轮仍未做浏览器测试。原因：World Engine 目前只有后端 facade、Agent tool runtime 和 profile；尚未提供 HTTP API 或前端 UI 操作面。按照项目指令，不自动进行浏览器验证。后续若接入前端/API，可再由用户确认后执行浏览器测试。

## Next Round

1. 优化 `write_world_slice` 同 instant 冲突错误提示，返回已有 slice id / time，便于 Agent 改用 `edit_world_slice`。
2. 评估是否给 `create_world_subject` 工具返回 init slice 信息，降低“注册 subject 占用 instant”的心智成本。
3. 设计 HTTP API 或前端最小入口，之后补浏览器验证。
4. 考虑在默认 Project 模板中加入 `world-engine/` 目录，让新 Project 开箱可试。
