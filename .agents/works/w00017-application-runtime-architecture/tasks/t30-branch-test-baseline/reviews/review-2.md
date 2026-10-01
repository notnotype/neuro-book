# 主 Agent 审查意见（第 2 轮）

“worker 只编译、主线程经 Product owner 执行 prepare 预览”的执行边界正确，保留。`ProductRuntimeNotReadyError`、`activeOwner` 清理、watcher 诊断与新增的回归测试也都接受。以下问题处理后即可验收，约束不变（不提交、不 stash、不动 `packages/neuro-book/docs/research/README.md`）。

## 必须修改

1. **新引入的 bug：** `server/agent/profiles/profile-compile-worker.ts` 的 `ProfileCompileWorkerService` 在 worker 结果处理的 `catch` 分支里删掉了 `this.running.delete(task.id);`。失败的任务会一直留在 `running` 中。恢复它，并补一条测试：preview 或 publish 阶段抛错后，该任务不再计入运行中（按服务现有的可观察方式断言，例如 drain 或状态查询能结束）。

2. **冗余的第二条预览路径：** `server/api/agent/profiles/preview-prepare.post.ts` 新增的 `catch (isProductRuntimeNotReadyError)` 分支经 `withProfileSourceOverride` 再做一次预览。预览已经在主线程执行，主线程 Product runtime 未就绪时这条 fallback 同样会失败，它没有可达的成功场景。删除这段 fallback 与为它新增的 import，恢复原来的单一路径。如果你认为它有可达的成功场景，写出具体场景并用测试证明，否则删除。

3. **worker 回传 `productRuntimeError` 是否可达：** 预览推迟到主线程后，worker 内的 `runProfileCompile` 还会不会遇到 `ProductRuntimeNotReadyError`？逐条列出可能触发的调用路径。不可达就删除 `productRuntimeErrorResult`、`ProfileCompileProductRuntimeError` 与 `throwLifecycleError` 里对应的分支；可达就保留，并补一条测试覆盖那条路径。

4. **恢复被删的注释：** `server/agent/test/setup.ts` 中 `// 在测试文件注册局部 mock 前绑定真实实例，teardown 不能再次经过 mocked module graph。` 这一行被删掉了，恢复到原位置（紧挨着那条动态 import 之前）。本轮除恢复外不要改这个文件。

5. **补回原因注释：** `server/workspace-files/project-lifecycle.ts` 新增的 `watcher.ready` 复核上方，补回第 1 轮你写过的原因注释（openProject 不等待 watcher ready，ready 之前发生的 rename 由首次物理复核收口），这是维护者需要知道的非显然原因。

## 交付

- 重跑三项验证（全量测试、两项 typecheck），覆盖本 Task `evidences/` 下的三个输出文件。
- 汇报每一条的处理；第 3 条写出调用路径分析。
