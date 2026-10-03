# Round 188：Calendar era 必须是字符串

## 背景

本轮继续按用户调整，暂停前端推进，只做后端与 API 设计收口。

Round 187 已要求显式存在的 `calendar.yaml` 根配置必须是 object。继续巡检 Calendar 可选字段时发现：`era` 如果显式配置为非字符串，例如 `era: 123`，旧逻辑会直接忽略并回退默认 `复兴纪元`。

显式配置错误不应被默认值吞掉，否则用户会误以为项目使用了自己的纪元文本。

## 变更

- `server/world-engine/calendar.ts`
  - 新增 `readEra()`。
  - `era` 未配置时继续使用默认 `复兴纪元`。
  - 显式配置 `era` 时必须是字符串；非字符串返回稳定 400：`era 必须是字符串`。
  - 空字符串仍允许，用于项目选择无 era 前缀的 format。
- `server/world-engine/world-engine.facade.test.ts`
  - Calendar 配置非法输入测试补 `era: 123` 回归。
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
  - passed。

## 与计划出入

- 原大路线仍包含前端 Preview / Workbench 收口；本轮按用户最新调整不做前端。
- 本轮只收紧 Calendar 配置的后端/API 输入边界，没有改前端或浏览器行为。
