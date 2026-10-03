# Round 04 - Project Workspace 测试隔离与残留收口

日期：2026-08-01。前置：Round 02 已建立 Test Workspace Fixture 的 owner marker、初始化回滚、dispose 聚合错误和保守 sweep；本轮补齐会写 Project Workspace 的调用方。

## 问题与根因

部分测试虽然使用 `openProjectForTest()`，但没有显式声明 Runtime Workspace Root。helper 会回退到生产默认解析，测试 Project 因而落入源码仓库真实 `workspace/`。另有三个 Profile 测试直接使用 `resolve("workspace")`。这些调用方各自维护 5/20/30/100 次删除循环，部分循环在重试耗尽后静默返回；CodeAct、World Engine API 和 Plot API 还把目录累计到 `afterAll`，扩大了并行测试共享 Project Lifecycle、Occupancy lock 和 SQLite 句柄的窗口。

产品侧另有一层遮掩：World Engine Preview 按 `world-engine-test-*`、`world-engine-api-test-*`、`world-tools-test-*` 前缀隐藏 Project。这只能遮住部分命名，不能阻止真实写入，也让项目列表不再忠实反映磁盘数据。

## 实施

1. `openProjectForTest()` 现在必须读取到显式 `WorkspaceRuntimeRootContext.workspaceRoot`，缺失时在调用生产 `openProject()` 前 fail closed。新增 `removeProjectWorkspaceForTest()`，目标只能由当前隔离 Workspace Root 与单段 Project Root 解析；它先关闭 Project、强制回收已释放 SQLite handle，再使用 Node 严格递归删除，失败直接抛出。
2. SQL、World Engine tools、CodeAct、World Engine facade、World Engine API、Plot API 六个文件各自持有一个 suite 级 `createIsolatedWorkspaceAssets()`，默认共享只读 System Assets，不切换 cwd。每个测试仍创建独立 Project；CodeAct 与两个 API suite 改为 `afterEach` 删除。
3. RP、Leader Assets、Writer Contract 三个 Profile suite 改从隔离 Runtime Workspace Root 创建物理 fixture。RP 的测试 Session 同时显式携带同一 `workspaceRoot`，避免 DSL 按 Session 地址回到仓库根。
4. 审计原有 13 个 `openProjectForTest()` 调用文件。Profile HTTP 补显式 context 并把旧 `workspace/project` 入参收紧为 `project`；RAG visualization 保留已有临时 cwd 设计，只在同一动态模块实例设置/恢复 context，并把 Project Root 收紧为单段。其余调用方已有隔离 context。
5. Preview 删除全部测试前缀过滤，项目列表直接消费 `/api/projects` 的真实结果后做 80 项展示裁剪。没有新增其他前缀、启动清理或生产测试分支。
6. 长集合退出后检查 `%TEMP%` 时发现两棵半清理 fixture 已先失去 marker。`removeFixtureTree()` 因此改为把 owner marker 留到最后：任何子项失败都保留 marker 并抛错；仅在其余条目清空后删除 marker 与根目录，最终 `rmdir` 失败则恢复 marker。这样既有 24 小时 sweep 不会因部分删除而失去所有权证据。

没有新增 ADR：本轮只是把 ADR 0002 与 Task 125 既有 fixture owner 模型贯彻到漏网调用方。也没有引入 run 级共享可写 State Root、关闭文件并行、文件系统 mock 或新依赖。

## 验证

- helper fail-closed 与越界删除：`2/2`；越界用例显式拒绝 `../outside`，根外哨兵保持存在。
- fixture owner/sweep 与 helper 合集：`2 files / 6 tests`。顺带修正既有断言：Node `fs.access()` 成功值是 `undefined`，不是 `null`。
- 六个高风险文件并行连续三轮：每轮均为 `6/6 files`、`95/95 tests`。
- 三个 Profile 迁移文件：RP `9/9`；其余两个与 Profile HTTP、RAG、Preview 聚焦集合未出现失败。
- Preview 源码合同测试通过，且反向断言 `previewProjectTestPrefixes` 不存在。
- `bun run typecheck` 无报错。
- 高风险测试前后，真实 Workspace Root 的测试前缀目录清单完全不变，没有新 Project 或新锁 metadata。
- 本轮长集合留下的四个临时 fixture 均经 marker/PID/创建时间核对后删除；marker 顺序修复后的 fixture/helper 聚焦复跑结束无新增残留。

原有 13 调用方集合包含 `workspace-files.test.ts` 时仍有两项既有基线失败，单独复跑可稳定复现，与本轮隔离无关：

- system profile preflight 期望重新编译 `builtin/leader.assets.profile.tsx`，实际 `compiled` 为空。
- llmlint 资产断言仍期望 `2.0.1`，当前同步资产实际为 `3.0.0`。

本轮没有修改这两条无关合同，也没有用放宽断言掩盖。

## 一次性残留清理

验证完成后，逐项核对 manifest、fixture 结构和 Occupancy lock，只删除用户授权的四个 Project：三个 `world-tools-test-*` 与一个 `sql-tool-missing-invocation-*`。其中一个 World Tools Project 留有 stale lock；metadata 的 owner PID 已不存在，心跳超过 30 秒阈值约两小时，因此同时删除该精确 lock 目录和 metadata。

真实 Workspace Root 还存在另一个 SQL 测试目录和三个较新的 World Tools 测试目录。它们不在授权清单内，本轮保持不动；`lifecycle`、`record`、`reconcile`、`project-a` 也已复核保留。

## 与计划的出入

- 计划内结构与产品行为均按原方案落地。
- 额外修正一处 `fs.access()` 既有错误断言，并根据本轮真实半清理目录补强 marker-last 删除顺序；两项都服务既有 fixture owner/sweep 合同，不扩展生产架构。
- 清理时发现四个计划外测试目录；遵守精确授权边界，没有扩大删除范围。
- 未执行浏览器验证。本轮没有新增交互，Preview 人工走查仍是可选补充验收。
