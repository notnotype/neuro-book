# Round 421 - Calendar.ts OpenPath Browser Acceptance

## 背景

Round 420 已把 World Engine 前端配置入口切到 `world-engine/calendar.ts`。真实浏览器窄验收时发现：旧 Project 缺少 `calendar.ts` 的情况下，主 IDE 虽然最终会创建并打开默认草稿，但打开链路会先触发一次 `selectWorkspacePath()`，服务端日志出现 `ENOENT` 噪音。

本轮继续限制在前端与前后端交互层，不改后端 Calendar 核心。

## 实际变更

- `openWelcomeWorkspacePath("world-engine/calendar.ts")` 改为先刷新 Project Workspace 文件树。
- 文件树已包含 `world-engine/calendar.ts` 时，直接打开现有文件。
- 文件树缺少 `world-engine/calendar.ts` 时，先通过 workspace-files create API 创建默认 Simple Calendar 草稿，再打开文件。
- 普通 schema / workspace 文件打开路径不变。

## 验证

- `bunx vitest run app/utils/world-engine-ide-entry.test.ts app/utils/world-engine-workbench-preview.test.ts`
  - 2 files / 9 tests passed。
- 真实浏览器窄验收：
  - 启动现有 `localhost:3001` dev server。
  - 新建临时 Project `workspace/world-engine-calendar-ui-20260623185500`。
  - 删除模板自带的 `world-engine/calendar.ts`，模拟旧 Project。
  - 打开 `/?project=workspace%2Fworld-engine-calendar-ui-20260623185500&openPath=world-engine%2Fcalendar.ts`。
  - 主 IDE 成功进入该 Project，URL 清掉 `openPath`，文件树与详情显示 `world-engine/calendar.ts`。
  - 通过 `/api/workspace-files/read` 确认自动创建的文件包含默认 Simple Calendar 注释与 `{eraName}{year}年{month}月{day}日` format。
  - `.agent/workspace/r421-dev.err.log` 没有新增 `ENOENT`。
- 清理：
  - 已关闭浏览器 tab。
  - 已删除临时 Project，`/api/projects` 不再返回该 Project。
  - 已关闭 dev server，`3001` 无 `Listen` 状态。

## 与计划出入

- 原计划只是收尾 Round 420 的浏览器验收；实际验收发现缺失 `calendar.ts` 时有一次前端先读后建导致的服务端日志噪音，因此补了一个很小的前端交互修正。
- 没有触碰后端 Calendar 实现，也没有改 `ming-ding-zhi-shi-2` 数据。
