# 审查意见 1

整体设计与实现正确：`beforeStop` 前置排空、准入、停止汇合、退出码优先级、开发适配器、CLI 启动函数都按要求完成，L1–L6 全部通过。先用 `git status` 与 `git diff` 核对现状，再处理下面两项。

## 必须修改

1. **更正信号监听器的注释与汇报。** `server/runtime/foundation/server-host.ts` 写着“Node/Bun 的 signal listener 不接收信号名”，这不成立。主 Agent 实测：`process.on("SIGTERM", (...args) => …)` 在 Node 与 Bun 下收到的参数都是 `["SIGTERM", 15]`。这个结论来自审查子代理（`http-review.json`），没有经过实测。闭包绑定注册时的信号名可以保留，它让来源不依赖监听器参数，但注释要写真实原因，不能断言运行时不传参数。`delivery.md` 第 8 节的回写建议 1 撤回；第 2 节与第 7 节第 3 条中的相同说法一并更正。

2. **撤销与排空无关的 SSE 改动。** 任务说明只允许为“排空时关闭事件流”修改 SSE 路由与 `server/utils/event-stream.ts`。下面这些超出了范围：
   - `isClosingEventStreamError`：重写判定方式（改为错误码加调用方传入的连接终态），删掉了原有的说明注释，并给两个路由加了新参数；
   - `server/api/projects/presence.get.ts`：心跳与首帧的 `catch` 改为写日志、`heartbeatTimer` 的类型、`onClosed` 的处理方式；
   - `server/api/workspace-files/events.get.ts`：`isClosingEventStreamError` 的新参数。

   恢复成 HEAD 的写法，只保留排空需要的改动：登记 `registerHttpEventStream`，以及让排空能观察到关闭结果所必需的代码。如果某一处确实是排空在 Bun 下正常工作所必需的，先写一个修改前失败的测试证明它，再保留最小改动，并保留、更新原有注释。在汇报中逐处说明保留的每一处改动为什么是排空需要的。`server/api/workspace-files/events.get.test.ts` 随之调整。

## 验证

命令从 worktree 根目录执行：
- `bun run --cwd packages/neuro-book test -- server/runtime server/features server/middleware server/routes server/host server/api/workspace-files server/api/projects server/api/agent`：全部通过；
- `bun run --cwd packages/neuro-book typecheck:runtime-foundation`、`scripts:typecheck`；
- `bun run --cwd packages/neuro-book smoke:product-lifecycle -- --only L1,L3,L4 --browser-executable /usr/bin/google-chrome-stable --report <证据目录>/rework-1-lifecycle-report.json`（含生产构建）：全部通过；
- 输出保存为证据目录下的 `rework-1-*.txt`，在 `delivery.md` 末尾追加“返工 1”一节，并按第 1 项更正前文。

一次只跑一个重任务；构建期间不要改动 worktree。
