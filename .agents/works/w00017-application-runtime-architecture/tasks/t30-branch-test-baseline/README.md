---
schema: nbook.task/v2
taskId: t30-branch-test-baseline
---

# 修复 w00017 分支的测试与类型检查基线

## 目标与范围

[t29](../t29-master-sync/README.md) 同步 master 后发现：本分支原有 416 条只在 w00017 上失败的测试、`typecheck:runtime-foundation` 92 个错误，另有 master 带来的 nuxt typecheck 7 个错误。合入 master 前先修复，使阶段 1 从可信的基线开始。行为合同未变：只修测试基础设施与既有回归，不改产品行为；若测试暴露出真实产品缺陷，单独说明。

- 编码由 omp `gpt-6.1-sol` 完成（2026-09-30 开发者同意 omp 作为编码主力、yolo 审批模式），任务说明见 [brief.md](brief.md)；主会话审查 diff、自行重跑验证并提交。
- 验收：`bun run test` 中“只有 w00017 基线失败”的 416 条全部通过且不新增失败；`typecheck:runtime-foundation` 与 nuxt `typecheck` 均为 0 错误。
- 只在 w00017 worktree 中工作，不执行远端操作。

## 当前状态

2026-10-01 验收通过。omp 共三轮（第三轮第一次启动因 stdin 是未关闭的管道而空等 4 小时，加 `< /dev/null` 后重跑），主会话两轮审查意见见 [reviews/](reviews/)。

**主会话验收（自行重跑）：**

- `bun run typecheck:runtime-foundation`、`bun run typecheck`：均为 0 错误（[acceptance-typecheck.txt](evidences/acceptance-typecheck.txt)）。
- `bun run test`：23 条失败、22 个未处理错误（[acceptance-test-full.txt](evidences/acceptance-test-full.txt)），逐条对照 [t29 的 master 基线清单](../t29-master-sync/evidences/failing-tests-comparison.txt)全部在内；原 416 条分支回归全部消除，`subject-memory-tools` 的 2 条基线失败顺带修复。omp 自己的输出见 `evidences/test-full.txt` 等。

**根因与修法：**

- 测试打开 Project 时没有经正规 owner：相关测试在构造 Project 或 Agent 之前设置隔离的 workspace 运行上下文，结束时完整关闭 Project owner；`product-project.ts` 允许 Agent 在场探针先于 owner 登记（owner 关闭时清除对它的引用），不削弱“Product runtime 未就绪不接纳 Project generation”的门禁。
- `product-startup.test.ts` 的路径断言改为平台无关；workspace-files API 测试不再经 `importOriginal` 加载整套运行时。
- `typecheck:runtime-foundation` 的范围收窄到运行时机制、宿主适配器与三个基础服务插件；依赖 Nuxt 自动导入的产品适配层（`product-browser-runtime.ts`、workspace-files 适配、`app/features`）改由 nuxt typecheck 覆盖。
- Component Lab：可选的 v-model prop 在 `model` 层保持可选（规范只要求 model 是 fixture 声明的受控值），Agent 侧栏场景不再被迫给固定宽度。

**暴露并修复的产品缺陷：**

- Profile 编译的 dry-run 预览在 `worker_threads` 中执行 prepare。t25 之后 Project 代次只能由主线程的 Product owner 接纳，会话绑定已打开 Project 时预览在生产中会失败。改为 worker 只编译、把临时 profile 目录交回主线程，由主线程经 Product owner 执行预览并清理；新增“会话绑定已打开 Project 时预览成功”的集成测试。`ProductRuntimeNotReadyError` 成为可识别的错误类型。
- `ProjectLifecycle` 在 watcher ready 之前发生的 rename 会丢失：ready 后追加一次物理复核，失败写诊断；新增回归测试。

## 下一步

提交本 Task 后合入 master（快进），再开 t31 生命周期 smoke。
