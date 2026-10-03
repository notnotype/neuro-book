# ADR 0008：Application State Catalog 可演进且以健康启动提交

- 状态：Accepted
- 日期：2026-07-28
- 关联任务：[Task 105](../../../../.agents/tasks/105-unified-installation-manager/README.md)、[Task 118](../../.agents/tasks/118-project-catalog-snapshot-path-integration/README.md)
- 补充：[ADR 0005](0005-application-state-migration-ownership.md)

## 背景

catalog v2 假定 runtime 只会看到当前 sentinel 和 journal。真实升级数据包含 complete v1、complete v2、中断的旧 run，以及 v1 sentinel 顶层 `previousSentinel`。若放宽 Nitro parser 或让 Manager 枚举 Product step，会把历史格式知识带回运行时与安装器。

同时，迁移 apply 成功不代表升级成功。候选 Product 可能在 ready 前退出、健康检查失败或返回错误版本；若 Manager 已提前提交 Operation，旧 Product 与新数据之间将失去可恢复事务边界。

## 决策

1. migration Module 内维护 v1、v2、v3 历史 catalog registry；Nitro runtime 只导入 current v3 parser，并只接受 complete v3 sentinel。
2. complete 旧 catalog 只作为新 v3 run 的输入，不复用旧 runId。incomplete run 只能按其 journal catalogVersion 执行 resume 或 rollback；完成旧 run 后由下一次 apply 创建 v3 run。
3. future catalog、损坏、runId 冲突与 checksum 不一致全部 fail closed，不猜测、不降级为 `manual_required`。
4. v3 journal 在 apply 前保存旧 sentinel 的原始 bytes、SHA-256 和存在性。rollback 逐字节恢复；原本不存在时删除本 run 创建的 sentinel。parser 对象不能替代原始恢复材料。
5. `apply/resume/rollback` 从状态检查到最终提交全程持有 Application State 顶层独占 lease；apply 取得 lease 后重新执行 preflight。子步骤 lease 继续证明各自 artifact 所有权。
6. current v3 catalog 顺序固定为 `app-sqlite → agent-attachment-v1 → agent-session-v2 → agent-session-v2-review-repair`。Fresh State Root 完整执行同一 catalog。
7. `applied` 才是不可变迁移合同已经完成的永久证明；`skipped` 只描述上一次 preflight 没有工作。planner 必须重新检查动态 step 和曾经 skipped 的 step。Session v2 readiness 同时依据 Session 自有 sentinel/dry-run；complete v3 若发现 repair 工作，使用新 runId 创建同 catalog 的 repair-only run，不提升 catalog 版本。
8. Manager 对 migration JSON 只做结构校验：catalogVersion 是正整数，step id 是唯一稳定 slug。Release 构建再验证 automatic 声明引用目标 Product 当前 catalog。
9. Operation Journal 新写 v5，install、adopt、update、start 都先用候选 Product 运行只读 plan，把 runId 和计划写入 Journal 后才进入有副作用阶段。v3/v4 只在读取边界转换。同版本 update 也必须 plan；只有 `already_current` 才返回 unchanged。
10. 任何 `planned` 结果都保守进入服务静止证明、外层 App SQLite checkpoint/backup、Product apply、launch、目标版本健康检查和 Operation commit 的统一事务。native 端口被未知进程占用时在状态写入前 fail closed；Manager 不猜测或终止未知进程。
11. native、Windows Portable 和 container 统一返回 `ApplicationLaunch`。候选只有通过 ready、目标 `/api/app/version` 和健康检查后，Manager 才提交 migration 与 Operation；ready 前失败先精确终止本次候选，再反序回滚。
12. container start 必须区分操作前 `running/stopped/missing`。既有 running 容器只验证健康且不成为候选；stopped/missing 启动后发布精确 container id。存在迁移时先停止本 installation 的 running 容器，恢复时回到原运行状态。
13. 容器 Operation 在 Compose 进入可能创建候选的阶段前写入 `candidate-container` planned effect，在健康检查前再 durable 写入精确 container id。中断恢复必须先按该 id 停止候选并 checkpoint `stopped: true`，才可回滚 Application State；若只留下 planned 屏障而没有可验证 id，则 fail closed，不重新查询 Compose 猜测身份。
14. Native Product 继续由 Owned Process 持有。Windows 使用 Job Object；POSIX 使用独立 supervisor 持有 process group。两个平台都以宿主 IPC 断开作为 `host-disconnect`，Manager 异常退出时由 supervisor 收口本次候选，不持久化裸 PID 或扫描系统进程。
15. ready 后的正常进程退出不回滚已提交迁移。Windows Portable `--no-health-check` 只允许计划为 `already_current` 的启动。非 Manager Container 启动不得在 entrypoint 旁路执行数据库迁移，只能经过 Product readiness gate 给出统一迁移命令。

## 原因

历史 parser 放在 migration-only registry，可以支持跨版本升级而不污染当前 runtime。原始 sentinel 与全局 lease分别解决可逆性和并发写入；step 自身的 journal/lease仍保留细粒度证据。

健康启动是 Manager 能观察到的最小有效提交点。它既证明目标 Product 可读取迁移后状态，也允许在失败时恢复旧 Product、外层数据库备份和原始 Application State。

## 后果

- 新 catalog 必须新增 descriptor、历史 fixture、resume/rollback 证明和 Release 声明。
- Manager 不得导入 Session decoder 或枚举 step；Product 不得在 Nitro 启动时自动改数据。
- Source、Product、Container 和 Windows Portable 必须携带同一 JSON runner 与所有 current catalog step。
- plan 保持纯只读；manual_required 必须在停服务和修改状态前返回。
- Product runner 的本地文件检查按 Profile 检查真实 bootstrap 文件；不能把命令参数误当成宿主文件路径。Container runner 不检查宿主 Product 文件。
- 容器恢复只终止本次候选 container id，native 恢复只终止 owned process tree。
- 候选容器 identity 尚未 durable 发布的崩溃窗口会保留未提交 Journal 并阻止自动状态回滚；这是明确的人工恢复边界，不允许用当前 Compose 容器替代候选身份。

## 未采用方案

- 放宽 runtime sentinel parser：会让历史格式成为长期兼容合同。
- 让 Manager 理解 catalog：每个 Product schema 变化都要同步发布 Manager 领域代码。
- apply 成功即提交：候选启动失败时无法保证旧 Product 可读。
- 只依赖 install lock：手工 CLI 不经过 Manager，仍可能与另一个 CLI 并发写入。
