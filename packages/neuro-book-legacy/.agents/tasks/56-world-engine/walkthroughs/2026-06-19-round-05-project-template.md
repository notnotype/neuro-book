# Round 05 - Project Template

## Scope

本轮目标是让普通新建 Project Workspace 开箱带有 World Engine 配置。此前真实 demo 项目已经能跑，但默认 Project 模板没有 `world-engine/`，用户新建项目后还需要手工补 schema/calendar。

## Plan

1. 调研 Project Workspace 默认目录模板机制。
2. 在系统模板中加入 `world-engine/schema.yaml` 与 `world-engine/calendar.yaml`。
3. 补测试：新 Project 创建后能直接被 `WorldEngineFacade` 读取 schema/calendar，并能创建 world subject。
4. 跑相关测试与 typecheck。
5. 更新任务 walkthrough 与状态文档。

## Actual Changes

- 新增默认模板文件：
  - `assets/workspace/.nbook/templates/project-directory-templates/world-engine/schema.yaml`
  - `assets/workspace/.nbook/templates/project-directory-templates/world-engine/calendar.yaml`
- 默认 schema 只提供项目级合同，不创建 subject 实例或 slice：
  - `world`
  - `character`
  - `faction`
  - `location`
  - `item`
- 默认 calendar 使用第一版固定进位的简明奇幻历：
  - `复兴纪元`
  - `"{era}{year}年 {month}月{day}日 {hour:02}:{minute:02}:{second:02}"`
  - 30 天/月，12 月/年。
- 更新 `server/workspace-files/workspace-files.test.ts`：
  - 模板复制后断言存在 `world-engine/schema.yaml` 和 `world-engine/calendar.yaml`。
  - Project Workspace 创建 + 初始化 SQLite 后，调用 `worldEngineFacade.formatTime()` / `getWorldSchema()` / `createSubject()` / `queryState()` 验证新项目能直接使用 World Engine。
  - 顺手修正同一测试中已漂移的模板断言：当前 `AGENTS.md` / `lorebook/index.md` 文案已不同于旧断言；临时测试 root 下仓库 reference 链接会报 `invalid-ref`，该类问题不再阻断模板结构验证。

## Decisions

- 默认模板只放配置，不预置数据库状态。原因：`WorldSubject` / `WorldSlice` 是运行态，应该由用户或 Agent 在项目语境里显式创建。
- 默认 schema 保守覆盖常见小说 / RP 世界元素，但允许项目删除或扩展。第一版不做 schema migration，修改 schema 后由作者 / Agent 显式修正旧 mutation。
- `world-engine/` 是 Project Workspace 顶层目录，和 `lorebook/world/`、旧 `simulation/` 明确分工。

## Verification

- `bunx vitest run server/workspace-files/workspace-files.test.ts -t "小说目录模板会创建最小 lorebook 骨架且通过内容节点校验|创建 Project Workspace 时会写入 manifest、初始化 Project SQLite 并加载模板"`
  - 通过：2 个用例。
- `bunx vitest run server/workspace-files/workspace-files.test.ts server/world-engine/world-engine.facade.test.ts server/api/projects/world-engine/[...segments].test.ts server/agent/tools/world-engine-tools.test.ts server/agent/profiles/world-engine-profile.test.ts`
  - 通过：5 个测试文件，89 个用例。
- `bun run typecheck`
  - 通过。

## Browser Testing

本轮仍未自动浏览器验证。原因同前：项目指令要求不要自动进行浏览器验证。当前已具备新 Project 模板 + HTTP API；下一轮在用户确认后可以启动 dev server，从浏览器/API 路径创建或打开一个新 Project 验证。

## Code Review Notes

- 模板文件是纯配置，不会在 Project 创建时写入 World* 表，因此不会给用户带来隐藏运行态。
- `createSubject` 测试覆盖了默认 schema 的 default attr 能被写入 init slice。
- 仍未提供普通前端 UI；用户目前可通过 Agent `world.engine` profile 或 HTTP API 使用。

## Walkthrough Delta

计划与实际基本一致。绕道点：`workspace-files.test.ts` 中同一模板测试存在旧文案断言和 `invalid-ref` 断言漂移；已在本轮修正，并记录在 Actual Changes 中。
