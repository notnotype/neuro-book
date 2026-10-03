# Round 03 - Report Follow-ups

## Context

用户要求把报告剩余问题一起修：`task_create` 状态不稳定、`world.getSlice` 被误当成 subjectId 查询、`EmbeddingText.vector` 语义不清，以及报告中 calendar/schema 热加载、delete/rollback 一致性等问题。

本轮保持既有决策：`world.slice.get(sliceId)` 不重载 subjectId；`task_create` 仍是分支局部状态，不改成全 session projection。

## Changes

- Task checklist：
  - `task_create` / `task_set_status` 写入 immediate custom state，保证同一轮后续工具可读。
  - 真实 agent turn 内同时排队 savePoint custom state，保证 transcript 持久化后任务清单仍在当前 active path。
  - 不使用 projection，因此移动到其他分支后不会看到该分支的任务清单。
- World API：
  - CodeAct `world.slice.list(options)` 增加 `subjectIds?: string[]` 与 `subjectMode?: "any" | "all"`。
  - `world.slice.get(sliceId)` 仍只接受 sliceId；tool description、builtin profile、reference 均改为按 subject 查切面用 `world.slice.list({subjectIds:["id"], withPatches:true})`。
- EmbeddingText：
  - 公共写入真实文本时拒绝手写 `vector` / `model`。
  - 收紧内部路径边界：`/events/0`、`/memory/key/vector` 这类绕过路径会被拒绝；events 只能 `append /events {text:"..."}`，memory 只能 key 级整条 `replace/remove`。
  - 保留空容器初始化与单条 `{text:"..."}` 写入契约；向量列仍由 `WorldPatch.text/vector/model` 与 `vectorize/search` 链路维护。
- Calendar / schema 热加载：
  - 只给 import URL 加 query 在 Bun 下无效；临时脚本确认同一路径 `.ts` 仍返回旧模块。
  - loader 改为导入同目录临时内容副本，导入完成后删除临时副本，避免长期污染 Project Workspace，同时让文件内容变化对应新模块路径。
- execute_world：
  - 增加 delete 后同脚本查询重算状态的覆盖。
  - 保留既有 throw/timeout 回滚测试，确认失败脚本不会留下 partial data。
- Product mirror test：
  - `bun test server/world-engine` 会同时匹配 `product/server/world-engine/**` 镜像测试；修正 `product/server/world-engine/zod-loader.test.ts` 的 schema helper import，避免宽命令因 product 路径下 `nbook/world-engine/schema` 解析失败而红。

## Verification

- `bun test server/world-engine/codeact.test.ts`：通过。
- `bun test server/world-engine/codeact.test.ts server/world-engine/world-engine.facade.test.ts server/world-engine/patch-operations.test.ts`：行为用例通过；第一次运行因新增用例后 afterAll 清理窗口不足超时，已把 codeact test 清理超时从 30s 调到 60s 后单测通过。
- `bunx vitest run server/agent/tools/task-tools.test.ts server/agent/tools/world-engine-tools.test.ts`：通过。
- `bunx vitest run server/agent/tools`：通过，13 files / 116 tests；`task-tools` 属 harness 集成测试，单用例 timeout 从 15s 调到 60s，避免 full suite 并行负载下误判为功能超时。
- `bun test product/server/world-engine/zod-loader.test.ts`：通过，8 tests。
- `bun test server/world-engine`：通过，249 tests；该宽命令包含 `server/world-engine/**` 与 `product/server/world-engine/**` 两套匹配结果。
- 临时热加载副本扫描：未发现残留 `.world-engine-*.ts`。

## Notes

- `world.getMany` / 旧平铺 API 未恢复。
- `workspace/ming-ding-zhi-shi-2` 的 `/events` 仍按 Round 01 决策保留 string，不改 SQLite。
- loader 热加载修复会短暂写入同目录 `.world-engine-*.ts` 临时副本；正常导入结束后立即删除。
