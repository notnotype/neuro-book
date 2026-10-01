# 主 Agent 审查意见（第 1 轮）

测试侧的修法方向正确（经正规 owner 取得 Project、平台无关路径、API 测试不加载整套运行时），三项指标也达成了。但以下问题必须处理后才能验收。仍然只在 w00017 worktree 中工作，约束与上一轮相同（不提交、不 stash、不动 `packages/neuro-book/docs/research/README.md`）。

## 必须修改

1. **`server/agent/test/setup.ts` 破坏了测试日志隔离。** `server/app-logs/logger.ts` 第 184 行 `export const appLogger = new AppFileLogger()` 在模块求值时就调用 `resolveAppLogDirectory` 读取 `NEURO_BOOK_LOG_DIR`。你把动态导入改成静态 `import` 后，静态导入先于 `process.env.NEURO_BOOK_LOG_DIR = testLogRoot` 执行，日志器会绑定到默认目录，测试日志可能写进仓库。原来的写法与被你删掉的注释“Agent测试进程的日志必须隔离，不能通过默认cwd写入仓库Workspace Root”正是为了防止这一点。请恢复“先设环境变量、再取得真实日志器实例”的顺序，保留原注释。如果当初改它是为了修某个失败，说明是哪个失败、根因是什么，并用不破坏隔离的方式解决。

2. **`server/agent/profiles/profile-compile-worker-runtime.ts` 不得按错误文案分支。** 仓库规则：人类文案不是程序分支依据。另外这里暴露了一个真实的产品缺陷，不能用改错误类型掩盖：
   - Profile 编译的 dry-run 预览运行在 `worker_threads`（`profile-compile-worker.ts` 用 `new Worker(...)` 启动），而 t25 之后 Project 代次只能由主线程的 Product runtime owner 接纳。生产环境中，会话绑定了已打开 Project 的预览会在 worker 里得到“Product runtime 未就绪”；你的改法会把它报告成 `ProjectNotOpenError`，但那个 Project 在主线程其实是打开的。
   - 请先查明：master 上（t25 之前）这条预览路径在 worker 里是如何取得 Project 的；t25 之后正确的做法是什么（例如预览不需要打开 Project generation、改为只读访问，或者由主线程提供所需数据）。
   - 能在本任务范围内正确修复就修，并补一条测试覆盖“会话绑定已打开 Project 时 dry-run 预览成功”。修复涉及产品取舍时不要自行决定，写清现象、根因与可选方案，交给我。
   - 不论采用哪种方案，Product runtime 未就绪都应是可识别的错误类型（在 `product-project.ts` 中导出具体错误类或类型守卫），不再比较 `error.message`。
   - `harness.dispose()` 放进 `finally` 这一改动是对的，保留。

## 应该修改

3. **`server/runtime/product-project.ts` 的 `activeOwner` 生命周期。** 它在 owner 关闭后仍指向已关闭的 owner。请在 owner 关闭（`closing` 结算）或测试 owner 重置时清空它，确认测试 owner 与产品 owner 不会互相覆盖，并补一个单元测试：先登记探针再建立 owner，owner 关闭后再登记探针，新 owner 拿到的是最新的探针。

4. **`server/workspace-files/project-lifecycle.ts` 不得静默吞掉错误。** `.catch(() => undefined)` 改为写一条诊断（沿用文件中已有的日志方式）。另外说明哪条测试覆盖了“watcher ready 之前发生 rename”这一场景；如果没有，补一条。

5. **`app/component-lab/lab-subject.ts` 只改需要改的地方。** 放宽可选 v-model 的类型规则可以接受（Component Lab 规范只说 model 是 fixture 声明的受控值）。但请恢复与本次修复无关的注释改写：例如“v-model 受控值”被改成“v-model键”；`LabInputOf` 原来的三条说明被删掉，只保留对“可选 v-model 保持可选”的补充。

## 交付

- 改完后重跑三项验证（全量测试、两项 typecheck），覆盖本 Task `evidences/` 下的三个输出文件。
- 汇报每条审查意见的处理方式；第 2 条单独写调查结论。
