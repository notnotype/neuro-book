# 审查意见 1

上一轮运行在 3 小时上限处被截停，`delivery.md` 尚未写出。先用 `git status` 与 `git diff` 核对现状，再处理下面各项。

整体方向认可：开发主进程宿主经 `BroadcastChannel` 协调 worker；热重载在 `dev:reload` 上先停旧实例；停止路由与信号经主进程收口退出；交接等待只针对同一 pid 的 runtime 租约。L7、L8 与 `bun run dev` 的 SIGTERM 停止链在你的证据里已通过。

## 范围收窄（开发者已决定）

“开发模式由下一次请求在同一 worker 内重试”不做。原因：Storage 宿主与文件索引仍是模块级单例，关闭后不能在同一模块图里重建；让插件真正拥有可重建的资源，属于以后把它们做成完整插件的工作，不为本任务提前做。开发模式改为只靠热重载重试：每次热重载都建立新 worker 与新模块图，启动失败不会延续到下一次。

据此删除：
- `product-startup.ts` 中的重试状态与 `ensureProductRuntime()`（`retryBlocked`、`retryAfterStop`、`stopFinished`、`DEVELOPMENT_RETRY_STOP_WAIT_MS`，以及只为重试服务的 `mode` 字段），`startProductRuntime()` 对已存在实例的处理恢复为 HEAD 写法；
- `server/middleware/00-product-http.ts` 恢复为 HEAD；
- `server/host/development-storage-retry.test.ts` 与只覆盖请求重试的测试用例；
- 如果开发适配器能直接持有 `startProductRuntime()` 返回的实例，就不再需要 `stopCurrentProductRuntime()`；保留它要说明理由。

开发模式启动失败后，准入照旧返回 503（`PRODUCT_STARTUP_FAILED`）并带原因；交接超时的诊断要写明“热重载后可重试”。

## 必须修改

1. **交接等待不能卡死在残留锁上。** 现在的循环看到锁目录存在、持有者是同一 pid 时只等待，从不尝试获取。旧 worker 被直接结束时（G0 实测出现过），锁目录会残留；proper-lockfile 原本会在心跳停止超过 `AGENT_SESSION_STORE_LEASE_STALE_MS` 后接管，现在每次都等满 45 秒再失败，热重载也恢复不了，比改动前更差。改为每次轮询都尝试获取，由 proper-lockfile 判定是否过期；只有获取失败、且持有者是同一 pid 的 runtime 租约时才继续等待。补一个用例：同一 pid 的锁目录心跳已过期时，新实例不等到期限就能取得租约。

2. **删除开发模式专有的 owner 文件删除**（`removeLeaseOwner` 与 `stopEntry` 中的 `rm`）。开发与生产应以同一方式释放租约。任务说明里“释放租约锁与 owner 文件”这句措辞不准确，smoke 只检查锁目录。如果确实有场景需要它，先写一个修改前失败的测试证明。

3. **热重载期间就绪的新 worker 不能收到停止命令。** `onMessage` 在有待完成的停止时，把新就绪的 worker 加进目标并发出停止命令。进程停止（信号、停止路由、`host:close`）时这样做是对的；但来源是 `hmr:reload` 时，新 worker 正是替代者，不能停。按停止来源区分处理，并补一个用例。

4. **核实 `vite:compiled` 钩子是否需要。** 本项目 `ssr: false`。从 `@nuxt/vite-builder` 源码看，开发模式下它只在服务端配置建立时调用一次，之后热重载不会再触发。实测或读源码确认它在开发时何时触发、与 `@nuxt/nitro-server` 里同一钩子上的 `nuxt.server.reload()` 谁先执行。如果它不保护任何实际的重载路径，就删除这个钩子。

5. **说明信号监听替换的依据。** 在 `delivery.md` 中写明：`captureDevelopmentSignalListeners()` 要移除的是哪个依赖在哪里注册的监听（文件与行号），不移除会怎样（例如抢先退出、跳过排空）。保留现有的“遇到未知监听即失败”的做法。

## 验证

命令从 worktree 根目录执行：
- `bun run --cwd packages/neuro-book test -- server/host server/runtime server/features server/middleware server/routes server/agent/session shared/source-dev-launcher.test.ts`：全部通过；
- `typecheck:runtime-foundation`、`scripts:typecheck`、`typecheck`：0 错误；
- `smoke:runtime-foundation -- --host server`：通过；
- `smoke:product-lifecycle -- --only L7,L8 --skip-build --browser-executable /usr/bin/google-chrome-stable --report <证据目录>/rework-1-lifecycle-dev-report.json`：两项通过，报告里没有 `pending`；
- `bun run dev` 停止链：SIGTERM、SIGINT 各一次，同第一轮的记录项；
- 生产 L1–L6、L10 与全量测试由主 Agent 跑，你不用跑。

输出保存为证据目录下的 `rework-1-*` 文件。

## 交付

本轮也有 3 小时上限。**先写 `delivery.md`**（按任务说明“最终汇报”的 8 节，覆盖第一轮与本轮的设计；范围收窄后的行为写成最终状态），验证跑完后再补结果，避免再次在交付前被截停。末尾加“返工 1”一节，逐条说明上面 1–5 项的处理。

一次只跑一个重任务；构建期间不要改动 worktree。禁止清单仍然有效，汇报前逐条自查。
