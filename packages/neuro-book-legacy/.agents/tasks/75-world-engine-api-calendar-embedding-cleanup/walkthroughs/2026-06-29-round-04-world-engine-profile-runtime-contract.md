# Round 04：world.engine 运行时 profile 契约收口

## 背景

广审查发现 `leader.default` 和工具 description 已经迁移，但 `world.engine` 这个实际维护 World Engine 的 builtin profile 仍残留旧协议：

- 时间示例仍使用 `星辉历312年 5月5日 14:00`。
- issues 仍按 `E（broken-relative / dangling-ref）/ A（base-shifted / masked）` 解释。
- 输出要求仍写 `E/A 判断`。

由于 runtime 只加载 `.compiled` artifact，修源码后必须同步编译，否则实际 agent 仍会看到旧提示词。

## 修复内容

1. 更新 `world.engine.profile.tsx`：
   - 时间示例改为默认公历 `公元2020年4月12日 18:00`。
   - issues 改为按 `severity="error"` / `severity="advisory"` 处理。
   - 用户解释优先使用返回的 `title/message/explanation`，避免直接抛内部 code。
   - 输出摘要从 `E/A 判断` 改为 `error/advisory 处理结论`。

2. 更新 `execute_world` 工具 description：
   - 首句从 current Project Workspace 改为 specified Project Workspace，和 `projectPath` 必填 schema 对齐。

3. 补强 `world-engine-profile.test.ts`：
   - 正向断言默认公历示例、`severity`、`title/message/explanation`。
   - 负向断言 `星辉历`、`broken-relative / dangling-ref`、`E/A 判断`。

4. 同步 `.compiled`：
   - 执行 `bun scripts/build/profile.ts compile world.engine --system`。
   - 静态扫描确认 `builtin__world.engine.mjs` 不再残留旧历法与旧 issue 分类文案。
   - 因 `execute_world` 工具 description 首句也发生变化，继续执行 `bun scripts/build/profile.ts compile --all --system`，全量同步系统 profile runtime artifact。

## 验证

- `rg --hidden --no-ignore -F "星辉历" assets/workspace/.nbook/agent/profiles/builtin/world.engine.profile.tsx assets/workspace/.nbook/agent/profiles/.compiled/builtin__world.engine.mjs`
- `rg --hidden --no-ignore -F "E/A 判断" assets/workspace/.nbook/agent/profiles/builtin/world.engine.profile.tsx assets/workspace/.nbook/agent/profiles/.compiled/builtin__world.engine.mjs`
- `rg --hidden --no-ignore -F "broken-relative / dangling-ref" assets/workspace/.nbook/agent/profiles/builtin/world.engine.profile.tsx assets/workspace/.nbook/agent/profiles/.compiled/builtin__world.engine.mjs`
- `rg --hidden --no-ignore -F "公元2020年4月12日 18:00" assets/workspace/.nbook/agent/profiles/builtin/world.engine.profile.tsx assets/workspace/.nbook/agent/profiles/.compiled/builtin__world.engine.mjs`
- 已通过：`bun run test server/agent/profiles/world-engine-profile.test.ts server/agent/profiles/leader-assets-profile.test.ts server/agent/tools/world-engine-tools.test.ts`（3 files / 23 tests）。

## 与计划出入

本轮不改 World Engine runtime API 行为，不清理历史 walkthrough 中作为迁移背景出现的旧术语。修复范围限定在当前会喂给 Agent 的 runtime profile、tool description、compiled artifact 和任务状态记录。
