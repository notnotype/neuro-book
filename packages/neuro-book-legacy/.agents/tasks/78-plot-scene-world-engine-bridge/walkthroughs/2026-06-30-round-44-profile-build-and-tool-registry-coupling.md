# 2026-06-30 Round 44 - Profile Build And Tool Registry Coupling

## Scope

本轮审查 Slice 1 到 Slice 4 与 profile build / tool registry 的耦合。目标是防止后续实现时只改 TSX 源码或只改 tool runtime，导致编译产物、profile helper 或运行时 registry 不一致。

本轮不修改业务代码。

## Evidence

Task 79 `Profile Build System` 已锁定：

- `.profile.tsx` 是编辑真相源。
- `.compiled` 是运行真相源。
- 普通 runtime 请求只读产物，不在热路径编译。
- runtime 严格阻止 stale / failed profile，不静默回退上次成功产物。

当前代码证据：

- `assets/workspace/.nbook/agent/profiles/builtin/director.profile.tsx` 直接声明 director 的 toolset。
- `server/agent/profiles/profile-tools.ts` 的 `builtin.plot` 只列出当前 Plot tools；还没有 `getChapterWriterBrief` binding。
- `server/agent/tools/index.ts` 通过 `createPlotTools()` 注册全局 runtime tool；还没有 `getChapterWriterBrief`。
- `server/agent/tools/plot-tools.ts` 目前所有 Scene/Thread 读取工具会按需读写 `plot.selection`；brief tool 需要明确不修改 selection。
- profile tests 直接 import TSX 源；它们不能证明 `.compiled` 产物已经更新，但能证明源码合同。

## Coupling Points

### Profile source vs compiled runtime

改 `leader.default.profile.tsx` / `director.profile.tsx` / `writer.profile.tsx` 后，源码测试可以立刻覆盖，但真实运行还取决于 profile 编译系统是否重新发布成功。

实现 Slice 1 时至少要跑源码级 profile tests；若用户要求实际运行验证，再追加 profile build/status 验证，不要把源码 test 当成 `.compiled` runtime 已刷新证明。

### Tool runtime vs profile binding

新增 `get_chapter_writer_brief` 必须同步三层：

- `server/agent/tools/plot-tools.ts`：定义 tool runtime。
- `server/agent/tools/index.ts`：注册到全局 builtin runtime。
- `server/agent/profiles/profile-tools.ts`：给 profile 作者提供 typed binding。

只改其中一层都会形成浅 Interface：调用方必须知道工具存在于哪层、缺哪层。

### Tool semantics vs selection state

当前 Plot tools 的 `get_story_thread`、`get_story_scene_context`、`get_scene_world_context`、create/update 会更新 `plot.selection`。brief tool 的 Interface 是显式 `chapterPath`，不应改变 selection。

这不是实现细节，是 Agent 易用性合同：brief 读取不能暗中改变后续 Scene 默认目标。

## Test Implication

Slice 1 tests:

- 源码级 profile tests 足够；不要求 profile compile。
- 必须说明旧 session history 不迁移。

Slice 4 tests:

- `plot-tools.test.ts` 断言 `get_chapter_writer_brief` 不调用 `appendCustomState`。
- `server/agent/tools/index.ts` 对缺失 tool 的 `requireDefinition()` 会在启动时报错；新增 registry test 可选，但 profile tests 能间接发现 binding 缺失。
- director profile test 断言 rootToolKeys 包含 brief tool。
- leader/writer profile tests 断言第一阶段不包含 brief tool。

Runtime verification:

- 若进入真实产品验证，先看 profile build/status，确认 profile 不是 stale / failed。
- 业务测试通过不等于编译产物刷新；这是 Task 79 语境下必须单独说明的验收边界。

## Result

后续实现 `get_chapter_writer_brief` 时，tool registry / profile binding / profile source / compiled runtime 是四个不同证据面。Task 78 第一阶段可以先用源码测试推进，但最终 Agent 易用性验收必须确认 runtime profile 编译状态，不然会出现“代码已改、Agent 仍不可用”的假完成。

