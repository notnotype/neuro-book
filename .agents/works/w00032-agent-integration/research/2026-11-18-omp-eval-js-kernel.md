# omp 的 eval：JS 内核怎样实现（2026-11-18）

供 [t21](../tasks/t21-eval-codeact/README.md) 设计用。源码是本机全局安装的 `@oh-my-pi/pi-coding-agent`，路径相对它的 `src/`。子代理走查；标“核实”的两条由主会话读过源码。较早的概览见 [`docs/research/agent-runtime-references.md`](../../../../docs/research/agent-runtime-references.md)“omp 的 eval 与 Agent Hub”与 [宿主操作调研](2026-10-30-host-control-survey.md)第 5、6 节，这里不重复。

## 进程与执行

- 一个会话一个内核，按“会话文件加工作目录”区分（`eval/js/context-manager.ts:112`、`eval/session-id.ts:5-7`）；子代理有自己的内核。
- 优先起子进程（同一个命令行二进制加隐藏参数，入口 `eval/js/process-entry.ts`，会 `chdir` 到会话目录），同步失败才退回 Bun Worker（`context-manager.ts:967-1033`）。不在宿主线程里跑：那样用户代码停不下来（`context-manager.ts:646-649`）。
- **不用 `node:vm`（核实）**：`eval/js/shared/indirect-eval.ts:6-8` 写明 Bun 在 Worker 正执行 `vm.runInContext` 里的同步循环时 `terminate()`，父进程会 SIGTRAP 崩溃。改用间接 eval（`globalThis.eval(src)`），在内核进程真实的 `globalThis` 上执行，带 `//# sourceURL` 让堆栈指向单元。
- 中止、超时一律杀进程（子进程 SIGKILL，`context-manager.ts:864-886`、`subprocess/worker-client.ts:470-476`）：同步死循环没有别的办法打断，代价是内核状态全丢，结果里写“变量没了”（`eval/js/executor.ts:88-96`）。

## 跨调用保留变量

- 函数声明与 `var` 在全局上天然保留；顶层 `const`、`let`、`class` 降成 `var`（`eval/js/shared/rewrite-imports.ts:984-1000`，间接 eval 每次给一个新的词法环境）。
- 有顶层 `await`、`return`、`for await` 时整段包进 `(async () => {…})()`，声明改写成对全局对象的赋值，函数声明在入口先装上以保留提升（同上）。
- 最后一个表达式与顶层 `return expr` 改写成 `__omp_set_final_expr__(expr)`，按 `console.log` 的格式回显，`undefined` 不显示（`rewrite-imports.ts:1085`、`1096`，`eval/js/shared/runtime.ts:583-587`）。不靠 eval 的完成值：异步包装里拿不到。
- 解析用 `@babel/parser`，第一次用到时才加载（`rewrite-imports.ts:98-112`）。
- 顶层 `import` 改写成 `await __omp_import__(…)`。

## 工具桥

- 内核里 `tool` 是 Proxy，`tool.<名>(args)` 发 `{type: "tool-call", id, name, args}`，宿主执行后回 `tool-reply`（`eval/js/shared/prelude.txt:99-109`、`eval/js/worker-core.ts:455-477`、`context-manager.ts:791-833`）。
- **桥接调用不审批（核实）**：`eval/js/tool-bridge.ts:272-336` 只做参数校验，然后直接 `tool.execute`，不经过会话循环的 `beforeToolCall`（扩展钩子与审批判定都在那里）。审批只对 eval 整段一次（`tools/eval.ts:346`，`approval = "exec"`）。
- 只禁止 `checkpoint` 与 `rewind`：它们要靠直接的 `toolResult` 生效（`eval/tool-bridge-policy.ts:4-6`）；`eval` 自己没被排除。
- 每次桥接调用的中止信号跟着单元走；等子代理、等后台这类委派工具时暂停单元计时（`eval/bridge-timeout.ts:46-65`）。
- 单元结束时还有没完成的桥接调用，结果等它们都结束再交回（`context-manager.ts:846-862`）；没 `await` 的 Promise 被拒绝时报“Unhandled rejection (missing await?)”（`worker-core.ts:95-111`）。

## 输出

- `console.log` 经桥收集，`util.inspect` 深度 6（`runtime.ts:960-999`）；`process.stdout.write` 也截进当前单元（`runtime.ts:876-912`）。
- 富输出：普通对象与长 JSON 附 JSON 视图，`console.table` 成表格视图，`console.log({type: "image", data, mimeType})` 是图片；每个视图至多 32 KiB、每单元至多 16 个（`runtime.ts:921-1047`、`tools/eval.ts:169-172`）。
- 文字内联至多 50 KiB，保留开头 20 KiB 与末尾的滚动窗口，全文另存，至多 16 MiB（`eval/js/executor.ts:111-119`、`tools/output-meta.ts:480-497`）。
- 抛错时把 `stack` 写进输出，结果标为出错（`executor.ts:236-237`、`tools/eval.ts:1028-1054`）。

## 寿命

- 单元时限缺省 30 秒，1 到 3600，`0` 关掉（`tools/tool-timeouts.ts:12`）。名为 `idle-timeout.ts` 的其实是单元时限计时器，可暂停。
- 没有空闲回收：内核只在 `reset: true`、会话释放、中止或超时时结束。
- 内核状态在宿主的登记表里，经一条隐藏消息告诉模型“活着”“死了，状态没了”“历史里的变量没有恢复，要重新执行”（`eval/state.ts:343-363`、`session/agent-session.ts:7385-7425`）。压缩不清变量。
- 可选的自动转后台，缺省关（`tools/eval.ts:593-721`）。工具本身 `exclusive`。

## 全局对象（prelude）

- 形状：`name`、`documentation`、`javascript`（内核里执行的代码）、`exports`（要占的全局名）、`approval?`、`enabled?()`、`invoke(params, ctx)`（`eval/preludes.ts:32-67`）。内置 `browser`、`computer` 等四个。
- 内核里的代码第一次用到时才装进去，名字和保留全局冲突时报错（`runtime.ts:453-501`）。宿主侧经同一条桥（名字 `__prelude__`）调 `invoke`，调之前按 prelude 的 `approval` 审批（`eval/preludes.ts:94-162`）。传函数时用 `String(fn)` 序列化（`tools/browser/prelude.js:14-22`）。
- 每个 prelude 是一个文档主题 `xd://eval/<名>`，工具描述里只放文档首行作摘要（`tools/eval.ts:232-266`、`eval/preludes.ts:83-86`）。

## 安全

完全开放：`require`、`fs`、`fetch`、`Bun`、`process` 都能用（`runtime.ts:643-724`），没有沙箱；能力的门槛只有 eval 整段的 exec 审批与 prelude 自己的审批。

## 工具参数

`language`（`py` 或 `js`）、`code`、`title?`、`timeout?`（秒）、`reset?`；`strict`（`tools/eval.ts:114-160`）。描述约 4 KB，另有 judge、helpers、agents 三个按需主题。

## 未验证边界

- 当前发行版实际走子进程还是 Worker 没有跑起来看，只读了代码。
- 桥接调用除 ACP 权限代理外有没有别处补审批，没有找到。
- `tool.eval(…)` 嵌套运行的实际行为没有试。

## 第二轮：拿计划第 3 稿逐项对照（2026-11-18）

开发者要求另派一个子代理细读 omp 的 eval 与更新日志（只覆盖 18.8.6 到 18.14.1，2026-10-08 到 10-31），逐项对照 [t21 的计划](../tasks/t21-eval-codeact/plan.md)。全文（八个方面、每条带 `文件:行` 与判断、更新日志逐条表）在 [`evidences/omp-eval-comparison.txt`](../tasks/t21-eval-codeact/evidences/omp-eval-comparison.txt)。标“实测”的是子代理在 Bun 1.4.4 上跑出来的；主会话又在真实的内核入口上复现了其中几条（下面注明）。

计划因此补上的（详见计划 3.1 稿）：

- 没 `await` 的 rejection 与定时器里抛的错会让 Bun 进程直接退出（实测），内核要装两个处理器并归到单元；IPC 回调里产生的 rejection 要多等两轮宏任务才派发（主会话复现）。
- “父进程没了就收掉自己”要放在独立线程里轮询：主线程被同步死循环占住时 IPC 断开的事件派发不到（omp issue #14340；主会话用 `while (true) {}` 加杀父进程复现，线程版能收掉）。
- `tool` 这类 Proxy 对 `then` 交回函数时，`await tool` 会卡到超时（实测）。
- 值的显示用 `node:util.inspect`（深度 6、宽 120），字符串原样：`Bun.inspect` 把顶层字符串转成带引号与转义的一行（实测）。
- 改写的边角：嵌套在块里的 `var`（omp #15859）、函数名、`"use strict"` 仍要是第一条语句（omp 的两种模式在这里都有问题，实测）、跨单元重复声明、语法错误给位置与代码框、拦保留名、顶层 `import` 改成 `await import()`、动态 `import()` 按工作目录解析（间接 eval 里按内核入口所在目录，实测）。
- 内核意外退出（含退出码 0）给带退出码与 stderr 尾部的失败；握手超时与单元时限分开；超时、中止、崩溃都保留已有的输出。
- 说明文字的几句（失败后只重试失败的那一步、不要重复已成功的设置、批量调用可能失败时用 `Promise.allSettled`）。
