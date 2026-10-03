# Round 04 - HTTP API

## Scope

本轮目标是在已有 `WorldEngineFacade` 和 Agent 工具之上，补一个可被前端 / 外部调试面调用的最小 HTTP API。这样后续浏览器验证和 UI 接入可以走真实 Project API，而不是只通过测试或 Agent tool runtime。

## Plan

1. 调研现有 Project API 路由模式。
2. 实现 World Engine 最小 HTTP/API 入口。
3. 补 API 级烟测，覆盖日历字符串边界。
4. 更新任务文档。
5. 做一轮代码审查式自检，记录未做浏览器验证的原因与下一步。

## Actual Changes

- 新增 `server/api/projects/world-engine/[...segments].ts`：
  - `GET schema`：返回 Agent / UI 友好的 schema 与 calendar 格式投影。
  - `GET subjects`：列出 subject 身份，支持 `type` query。
  - `POST subjects`：创建 subject，`time` 使用项目日历字符串。
  - `GET slices`：列出 timeline slices，支持 `limit/from/to/withMutations`。
  - `POST slices`：写入新 slice。
  - `POST slices/:sliceId/edit`：整块替换已有 slice。
  - `GET state`：调试用全量世界状态，返回 `time` 而不是 raw instant。
  - `POST state/query`：业务 / 前端局部查询入口，要求 `subjectIds` 或 `type` 至少一个。
  - `POST resettle`：显式重结算。
- 新增 `server/api/projects/world-engine/[...segments].test.ts`：
  - 直接调用 event handler，走真实 Project SQLite、真实 schema/calendar、真实 facade。
  - 覆盖创建 subject、写两个 slice、编辑过去 slice、显式 resettle、查询状态、列 slices、全量 state 调试入口。
  - 覆盖 `state/query` 拒绝未收窄的全量查询。
- 修复 `bun run typecheck` 暴露的 World Engine 严格类型问题：
  - `server/world-engine/index.ts` 补导出 `WorldMutationOp`。
  - `calendar.ts` / `schema-loader.ts` / `world-engine.service.ts` 补齐 `noUncheckedIndexedAccess` 下的索引与默认值收窄。
  - `world-engine-tools.test.ts` 的 `appendCustomState` mock 改为返回真实 `SessionEntry` 形状。
  - `world-engine-profile.test.ts` 对 `AgentMessage` 测试文本提取做显式 cast。

## Decisions

- HTTP API 边界与 Agent 工具一致：输入 / 输出时间都使用项目日历字符串，不把 raw `bigint` / 十进制 instant 暴露给调用方。
- 路由形状对齐 `server/api/projects/plot/[...segments].ts`：`projectPath` 仍放 query，不把 `workspace/<project>` 塞进 URL path。
- `state/query` 和 Agent 工具一样禁止裸全量查询；调试需要全量时使用 `GET state`，语义上更明确。
- `editSlice` 继续使用第一版“整块替换”语义。

## Verification

- `bunx vitest run server/world-engine/world-engine.facade.test.ts server/agent/tools/world-engine-tools.test.ts server/api/projects/world-engine/[...segments].test.ts`
  - 通过：3 个测试文件，11 个用例。
- `bun run typecheck`
  - 通过。
- `bunx vitest run server/world-engine/world-engine.facade.test.ts server/agent/tools/world-engine-tools.test.ts server/agent/profiles/world-engine-profile.test.ts server/api/projects/world-engine/[...segments].test.ts`
  - 通过：4 个测试文件，13 个用例。

## Browser Testing

本轮没有自动进行浏览器验证。项目指令要求不要自动进行浏览器验证；当前已具备 HTTP API 面，下一步可以在用户确认后启动 dev server，用浏览器或 API 面板验证真实 Project 的 schema / subjects / slices / state/query / resettle 链路。

## Code Review Notes

- API 输入校验使用 zod；`value` 作为 JSON 边界用递归 JSON schema 接收，真实 attr/op/schema 校验仍在 `WorldEngineService`。
- 当前没有新增前端 UI，因此还不能从普通用户界面直接操作 World Engine。
- 当前 API 没有独立 OpenAPI meta；如果后续要暴露给前端生成客户端或 API 文档，需要补 DTO / route meta。
- 本轮顺手清掉了 World Engine 相关 typecheck 红点；这不是原计划的功能项，但属于实现质量门禁，已记录为绕道。

## Walkthrough Delta

计划与实际基本一致。唯一偏差是浏览器验证没有在本轮自动执行，原因是项目明确要求浏览器验证需要用户确认；实现上已先补齐可验证的 HTTP API 面。
