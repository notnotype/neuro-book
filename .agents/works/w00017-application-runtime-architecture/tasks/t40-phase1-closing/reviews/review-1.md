# 审查意见 1

整体实现正确：5 个 Nitro 插件的职责都迁进了内置插件并随实例注册与注销，`nbook.diagnostics` 进入产品清单且依赖图保证桥接先激活、最后撤销，smoke 与包装进程链的退出码修复有修改前失败、修改后通过的真实子进程证据，L1–L10 全部通过。包装进程在服务被信号结束时报告 128 加信号号的取舍（容器 PID 1 对自发的同一信号可能没有默认终止行为）接受。先用 `git status` 与 `git diff` 核对现状，再处理下面一项。

关于你汇报的两条：
- `storage-service.test.ts` 的“并发写入期间读取只会看到完整旧记录或完整新记录”在 t34–t39 每一次全量测试中都失败，属于分支的已知基线，不阻塞本任务，不用处理。
- `server/storage/workbench-migration-e2e.test.ts`、`server/utils/server-timing.test.ts` 的改动接受：它们直接引用被删除的旧入口。

## 必须修改

**撤销产品日志器的日志位置授予，只保留进程内的单一写入者。**

任务说明要求的“同一日志目录只能有一个写入者”，是指产品诊断出口不另开一个指向同一目录的 JSONL 写入者，你用 `appLogger.writeDiagnostic` 借用同一个 writer 已经做到了。让 `AppFileLogger` 自己取得目录锁（`log-location.ts`、`open()`、`#managed`/`#grantLost`/`#canWrite` 的写入门禁、`degraded`）超出了本任务，并引入了新的失败方式：

- 取不到授予时，`appLogger` 的全部写入（`info`/`error`、桥接过来的 `console.error`、`fatalSync`）都被静默丢弃。生产环境里 JSONL 是唯一稳定的出口，这等于整个进程没有日志；`runtime.diagnostics` 要求冲突时改用自身缓冲与紧急输出，这里没有做到。
- 开发模式下 `nbook.diagnostics` 最先激活，以 `retries: 0` 取授予；旧 worker 还没释放时，新 worker 在整个生命周期内都不写日志文件。Session Store 租约有 t38 的同进程交接等待，日志授予没有。

产品日志目录的跨进程互斥需要单独设计（冲突时的输出去向、开发模式交接、是否按进程分文件），不在阶段 1 收尾内做。本任务改为：

- `AppFileLogger` 不取目录锁，写入行为恢复为 HEAD（不因授予而丢弃写入）；保留 `writeDiagnostic` 与收尾所需的 `close()`（最后刷写并关闭 writer）。
- 产品诊断出口的打开不再取授予，借用 `appLogger` 的 writer 输出。
- `log-location.ts` 若只为这次迁移而从 `server/features/runtime-diagnostics/jsonl-exporter.ts` 抽出，就把授予代码恢复到 `jsonl-exporter.ts` 的 HEAD 写法，删除 `log-location.ts`；foundation 的 JSONL 出口仍按 `runtime.diagnostics` 取授予。
- 对应的测试随之调整；在汇报中写明“产品 `AppFileLogger` 仍不参与位置授予”这条限制保持不变。

## 验证

命令从 worktree 根目录执行：
- `bun run --cwd packages/neuro-book test -- server/plugins server/features server/runtime server/host server/middleware server/routes server/app-logs server/storage server/config scripts/db scripts/smoke`：除基线 `storage-service.test.ts` 那一条外全部通过；
- `typecheck:runtime-foundation`、`scripts:typecheck`、`typecheck`：0 错误；
- `smoke:runtime-foundation -- --services`：通过（foundation 出口的位置冲突降级仍成立）；
- 重做完成标准第 5 步的生产日志探针：`app.logs.ready` 可读，`console.error` 只写一条；
- 生产 L1–L10 与全量测试由主 Agent 跑，你不用跑。

输出保存为证据目录下的 `rework-1-*` 文件，在 `delivery.md` 末尾加“返工 1”一节说明处理结果，并相应修改第 2、3 节与第 7 节第 1、4 条。

一次只跑一个重任务；禁止清单仍然有效，汇报前逐条自查。
