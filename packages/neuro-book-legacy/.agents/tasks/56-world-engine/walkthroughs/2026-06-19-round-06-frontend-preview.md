# Round 06 - Frontend Preview

## Scope

本轮目标是补一个最小前端入口，让 World Engine 能从用户视角通过真实 API 操作，而不是只停留在 facade / Agent 工具 / HTTP 测试层。

## Plan

1. 调研现有前端 Project API 调用和 preview 页面组织方式。
2. 新增独立 World Engine preview 页面。
3. 抽出输入解析工具并补测试。
4. 运行相关测试与 typecheck。
5. 更新 walkthrough 与状态文档。

## Actual Changes

- 新增 `app/pages/world-engine.preview.vue`：
  - 路由：`/world-engine.preview`
  - 读取真实 `/api/projects` Project 列表。
  - 支持新建 Project Workspace；新 Project 会走默认模板，因此自带 `world-engine/schema.yaml` / `calendar.yaml`。
  - 读取真实 World Engine API：
    - `GET schema`
    - `GET subjects`
    - `GET slices`
    - `POST subjects`
    - `POST slices`
    - `POST state/query`
    - `POST resettle`
  - 页面分区：
    - Project / Schema
    - Subjects / Timeline / State Query
    - Create Subject / Write Slice / Query / Resettle
- 新增 `app/utils/world-engine-preview.ts`：
  - `parseCsvList()`
  - `parseMutationJson()`
  - `formatPreviewJson()`
  - 明确把 `JSON.parse` 当作 `unknown` 输入边界，再逐层校验为 World Engine mutation。
- 新增 `app/utils/world-engine-preview.test.ts`：
  - 覆盖 CSV 输入、合法 mutation JSON、空数组和非法 op。

## Decisions

- 先做独立 preview/debug 页面，不直接塞进主 IDE 面板。原因：第一版还需要验证交互是否顺手，直接进入主产品导航会扩大产品承诺。
- 页面走真实 API，不用 mock 数据。这样后续浏览器验证可以同时验证 Project 创建、默认模板、HTTP API、World Engine reduce 链路。
- mutation 暂时用 JSON textarea 输入。它不够产品化，但适合第一版验证 schema/op/value 边界；正式 UI 后续再做结构化 mutation editor。

## Verification

- `bunx vitest run app/utils/world-engine-preview.test.ts server/api/projects/world-engine/[...segments].test.ts server/world-engine/world-engine.facade.test.ts`
  - 通过：3 个测试文件，10 个用例。
- `bun run typecheck`
  - 第一次发现 `subjects[0]` 在 `noUncheckedIndexedAccess` 下需要显式收窄；已修复。
  - 复跑通过。
- `bunx vitest run app/utils/world-engine-preview.test.ts server/api/projects/world-engine/[...segments].test.ts server/world-engine/world-engine.facade.test.ts server/agent/tools/world-engine-tools.test.ts server/agent/profiles/world-engine-profile.test.ts`
  - 通过：5 个测试文件，16 个用例。

## Browser Testing

本轮仍未自动浏览器验证。项目指令要求不要自动进行浏览器验证；当前已经具备 `/world-engine.preview` 页面，下一步在用户确认后可以启动 dev server 并验证：

1. 打开 `/world-engine.preview`。
2. 新建一个 Project。
3. 确认 schema/calendar 加载。
4. 创建 `world` 或 `character` subject。
5. 写入 slice。
6. 查询 state。
7. 需要时执行 resettle。

## Code Review Notes

- 这不是最终产品 UI，只是最小真实链路入口。
- `state/query` 仍然要求 subjectIds 或 type，避免误拉全量世界状态。
- 当前页面没有编辑已有 slice；API 已支持 `slices/:sliceId/edit`，正式 UI 后续需要补整块替换交互。
- 当前页面没有浏览器实际截图验证；这一步必须等用户确认。

## Walkthrough Delta

计划与实际一致。没有遇到实现堵塞；唯一小修是 `noUncheckedIndexedAccess` 类型收窄。
