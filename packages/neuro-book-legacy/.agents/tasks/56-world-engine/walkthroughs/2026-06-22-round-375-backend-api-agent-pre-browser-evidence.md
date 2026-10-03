# Round 375 - Backend API Agent Pre Browser Evidence

## 背景

Round 363 / 370 / 374 已把真实作者流浏览器验收清单修到可执行状态；Round 373 已补前端静态入口和窄测试证据。由于项目规则要求不要自动执行浏览器验证，本轮继续补浏览器前的底层链路证据：确认后端核心、HTTP API、Agent 工具与 world.engine profile 当前仍通过目标测试。

## 本轮目标

- 运行 World Engine 后端 / API / Agent 目标测试。
- 不跑全量测试，不跑浏览器。
- 不修改代码和真实 Project 数据。
- 把结果写回任务文档，作为后续浏览器验收的基线。

## 执行命令

```bash
bunx vitest run "server/world-engine/world-engine.facade.test.ts" "server/api/projects/world-engine/[...segments].test.ts" "server/agent/tools/world-engine-tools.test.ts" "server/agent/profiles/world-engine-profile.test.ts"
```

## 结果

- 4 files passed。
- 138 tests passed。

## 结论

当前底层链路仍是绿的：

- `server/world-engine` facade / service / repository 核心行为通过。
- `/api/projects/world-engine/**` HTTP API 契约通过。
- Agent world-engine tools 通过。
- `world.engine` profile 相关测试通过。

这不等价于真实 UI 已通过。它只说明后续浏览器验收若失败，更可能优先排查 Workbench UI 状态编排、浏览器剪贴板、文件打开链路、真实 Project 路由或交互节奏，而不是先怀疑 World Engine 后端 / API / Agent 基础契约。

## 与计划出入

- 本轮没有执行浏览器验收；仍需用户明确允许后才能跑真实 UI。
- 本轮没有重复运行前端窄测试；前端静态证据已在 round 373 记录。
- 本轮没有运行全量 typecheck，避免被无关类型漂移干扰浏览器前证据。
