# Round 09：EmbeddingText / issue 文档 / 测试分层审查修复

## 背景

本轮接续 Task 75 的审查收口。用户确认四个问题一起修：

- `EmbeddingText` 公共写入必须收紧为严格 `{text:"非空文本"}`。
- Task 56 当前契约文档要更新到 `WorldPatch` / 分组 API / 单文件 TS 配置，不只保留历史提示。
- Task 76 是独立 active task，负责 WorldIssue catalog 与 UI 展示契约，必须纳入变更并和 Task 56 / 75 建立交叉链接。
- server 测试不能读取 `app/components/**`，避免前端组件重构误伤后端测试。

## 改动

- `server/world-engine/world-engine.service.ts`
  - 新增 EmbeddingText 单条 payload 校验：只允许 `{text:"非空文本"}`。
  - 拒绝 `{}`、非字符串 text、空白 text、额外 metadata、手写 `vector/model`。
  - 保留已有边界：允许 `replace /events []`、`replace /memory {}` 初始化空容器；拒绝非空整块 replace；拒绝 `/events/0`、`/memory/key/vector` 等内部路径。
- `server/world-engine/world-engine.facade.test.ts`
  - 增加 array 与 record 两种 EmbeddingText 容器的无效 payload 回归测试。
- `server/world-engine/world-issue-catalog.test.ts`
  - 移除读取前端 Vue 组件的断言。
  - server 测试只覆盖 catalog 完整性、reference 镜像和 Task 56 链接。
- `app/utils/world-engine-workbench-preview.test.ts`
  - 继续由前端侧测试覆盖 Workbench 不再按 `issue.code` 二次生成解释。
- `docs/tasks/56-world-engine/README.md`
  - Current State 更新到当前 `WorldSubject` / `WorldSlice` / `WorldPatch`、`execute_world` 分组 API、`world.slice.get(sliceId)` 与 `world.slice.list({subjectIds})` 边界。
  - issue 契约链接到 `reference/world-engine/issues.md` 和 Task 76。
- `docs/tasks/56-world-engine/sqlite-and-api.md`
  - 当前 SQLite / API 契约改为 `WorldPatch`、`PatchInput`、`patches`、`withPatches`。
  - schema/calendar 入口改为 `world-engine/schema/index.ts` 与 `world-engine/calendar.ts` 单文件 TS 配置。
  - reduce 伪代码改用 `WorldPatch` 与 `applyPatch(... replace/increment/remove/append)`。
- `docs/tasks/75-world-engine-api-calendar-embedding-cleanup/README.md`
  - 增加 Task 76 交叉链接，明确本任务负责 API / loader / EmbeddingText，Task 76 负责 issue catalog / UI 展示契约。
- `docs/tasks/76-world-engine-issue-contract/README.md`
  - 增加 Related Tasks，反向链接 Task 56 与 Task 75。

## 版本控制收口

本轮确认并显式纳入 World Engine 相关新增文件：

- `server/world-engine/single-file-typescript-config-import.ts`
- `server/world-engine/world-issue-builder.ts`
- `server/world-engine/world-issue-catalog.ts`
- `server/world-engine/world-issue-catalog.test.ts`
- `reference/world-engine/issues.md`
- `docs/tasks/76-world-engine-issue-contract/README.md`
- Task 75 的 Round 03 到 Round 09 walkthrough 文件。

## 验证

- `bun test server/world-engine/world-engine.facade.test.ts`：通过，25 pass。
- `bun test server/world-engine/world-issue-catalog.test.ts`：通过，4 pass。
- `bun test app/utils/world-engine-workbench-preview.test.ts`：通过，8 pass。
- `bun test server/world-engine`：通过，258 pass。
- `bunx vitest run server/agent/tools`：通过，13 files / 118 tests。
- `bun run typecheck`：通过。
- 静态检查：
  - `docs/tasks/76-world-engine-issue-contract/README.md` 与相关新增 runtime/reference 文件已被 `git ls-files --error-unmatch` 命中。
  - 无 `.world-engine-*.ts` 临时文件残留。
  - `fresh-typescript-import` / “保留相对 import 语义” 无命中。
  - `world.getMany` / `editMutations` / `write_world_slice` 只剩迁移说明或“不可用”测试语境。

## 与计划出入

实现范围与计划一致。唯一需要说明的是：Task 56 的历史 walkthrough 与旧实现流水中仍保留 `mutation`、`schema.yaml` 等旧词，这是历史记录，不作为当前协议面清零对象；本轮只修 Current State、SQLite/API 当前契约段和相关链接。
