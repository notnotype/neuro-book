# Round 145: 父路径 A issue 多子路径收集

## 背景

本轮继续只推进后端与 API 设计，不做前端。

Round 144 已把 A issue 的下游检测从完全相同 attr 扩展为父子路径相关，但审查后发现仍有一个漏报：父路径整体 `set/unset` 只取第一条相关下游 mutation。若下游先有 `stats.note set`，再有 `stats.hp add` / `stats.mp add`，旧逻辑只会返回 `stats.note` 的 `masked`，后两个子路径的 `base-shifted` 会被吞掉。

## 实现

- `server/world-engine/world-engine.service.ts`
  - `collectAdvisories()` 改为扫描下游相关 mutation，而不是只取第一条。
  - 对父路径整体修改，按不同下游子路径分别返回第一条 A issue。
  - 增加 `attrPathContains()` 与 `isCoveredByPath()`，用于跳过已经被提醒或覆盖的子路径。
  - 若下游父路径整体覆盖当前路径，则返回 `masked` 后停止扫描该路径，保持“整体已被覆盖”的语义。

- `server/world-engine/world-engine.facade.test.ts`
  - 新增回归测试：编辑过去整体 `stats` object 后，同时返回 `stats.note masked`、`stats.hp base-shifted`、`stats.mp base-shifted`。

- `assets/workspace/.nbook/agent/profiles/.compiled/builtin__world.engine.*`
  - service 依赖变化后重新编译 `world.engine` profile artifact，避免 catalog 测试加载 stale artifact。

## 验证

- 已通过：`bunx vitest run server/world-engine/world-engine.facade.test.ts`
  - 1 file / 45 tests passed
- 已执行：`bun scripts/build/profile.ts compile world.engine --system`
  - wrote 1 artifact
- 已通过：`bunx vitest run server/world-engine/world-engine.facade.test.ts "server/api/projects/world-engine/[...segments].test.ts" server/agent/tools/world-engine-tools.test.ts server/agent/profiles/world-engine-profile.test.ts`
  - 4 files / 63 tests passed
- 未通过：`bun run typecheck`
  - 当前失败来自无关 `server/agent/profiles/profile-home.test.ts`
  - 报错为 profile home 测试里的 `upgrade` 回调返回 `Promise<ProfileHomeWriteResult>`，不符合 `void | Promise<void>` 类型

## 文档

- `docs/tasks/56-world-engine/README.md`
  - 增加第一百四十五轮状态与 walkthrough 索引。
- `docs/tasks/56-world-engine/sqlite-and-api.md`
  - 补充 A issue 多子路径收集规则。
- `PROJECT-STATUS.md`
  - 增加 round-145 后端/API 补充。

## 与计划出入

- 没有做前端，也没有做浏览器验收，符合用户当前“专注后端与 API 设计”的边界。
- `bun scripts/build/profile.ts compile --all --system` 曾返回非零且无输出；绕道执行 `status world.engine` 与单独编译 `world.engine` 成功。此绕道已记录在本 walkthrough。
