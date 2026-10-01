# t37 测试迁移

## 已删除文件的每个用例

| 旧文件与用例 | 当前行为覆盖 |
|---|---|
| `middleware/00-product-startup.test.ts`：启动失败时交给有序退出，而不是抛出会被 Nitro 吞掉的未捕获异常 | `runtime/product-startup.test.ts`：启动失败先同步写原因与迁移提示，再关闭已取得资源并以 1 退出，不产生未捕获异常；生产 L5 三子断言。 |
| `middleware/product-shutdown-drain.test.ts`：响应结束或连接关闭时只释放一次请求 lease | `features/http/admission.test.ts`：排空期间新请求返回 503，finish 与 close 重复到达只释放一次，所有在途完成才结算。 |
| 同文件：draining 后拒绝新请求 | 同一准入测试；真实 HTTP/SSE 用例；生产 L3、L4 的 `drain-new-request`。 |
| `plugins/project-session-close.test.ts`：Nitro close同时收口Agent、ProjectSession与plain Workspace File Index | `runtime/product-startup.test.ts`：停止按依赖逆序关闭 Agent、Project、索引与进程资源并为每个代次记录一次关闭；`host/development-plugin.test.ts`：Nitro 初始化与单一 close；生产 L3、L4 `close-order`。 |
| 同文件：前序关闭失败时仍尝试全部资源并汇总失败 | `runtime/product-startup.test.ts`：插件释放抛错仍关闭独立插件并保留依赖，停止结果为 incomplete；不会强行释放失败消费者仍持有的依赖；Project child 显式恢复测试。 |
| `runtime/shutdown/product-shutdown.test.ts`：运行时关闭在途时不刷写日志，全部插件完成后才完成关闭 | `runtime/product-startup.test.ts`：插件释放仍在途时不刷写日志，释放完成后才结算停止；正常停止以 0 结算，日志在所有插件关闭后刷写且重复 stop 共享结算。 |
| 同文件：运行时关闭不完整仍刷写诊断，最终保留 product-runtime 失败身份 | `runtime/product-startup.test.ts`：插件释放抛错仍关闭独立插件并保留依赖，停止结果为 incomplete；新增断言保留 `Product shutdown step 失败：product-runtime` 并最终刷写日志。 |
| `runtime/shutdown/product-shutdown-controller.test.ts`：并发与完成后的重复关闭共享同一个 Promise 且每步只执行一次 | `runtime/product-startup.test.ts`：正常停止以 0 结算，日志在所有插件关闭后刷写且重复 stop 共享结算；信号、停止路由和租约失效先后到达只停止一次；`foundation/server-host.test.ts`：停止前置步骤完成后才关闭资源，重复来源共享同一结算。 |
| 同文件：前序步骤失败仍执行剩余步骤并聚合带步骤名的错误 | `foundation/server-host.test.ts`：停止前置步骤失败仍关闭资源并保留失败原因；`runtime/product-startup.test.ts`：普通 HTTP 超时、插件关闭失败与日志刷写失败三用例，分别保留 `http-drain`、`product-runtime`、`app-logger` 原因。 |
| 同文件：draining 拒绝新请求，并等待已进入请求释放后再关闭 owner | `features/http/admission.test.ts`：503 与 finish/close 计数；`foundation/server-host.test.ts`：前置完成后才关闭资源；生产 L3、L4 完整归档与逆序关闭。 |
| 同文件：HTTP drain 超时后继续关闭 owner 并聚合 drain 错误 | `runtime/product-startup.test.ts`：普通在途请求超出 20 秒后仍关闭其余插件，最后刷写日志并以 1 退出；`features/http/admission.test.ts`：SSE 关闭挂起也受排空截止约束，超时明确报告未完成。 |
| 同文件：进程退出请求幂等，并按关闭结果选择退出码 | `runtime/product-startup.test.ts`：正常停止共享结算、来源竞争、HTTP 超时与释放失败；生产 L3–L6 真实退出码。 |
| 同文件：普通关闭失败时使用退出码1 | `runtime/product-startup.test.ts`：插件释放失败、HTTP 超时、日志刷写失败分别结算为 1。 |
| 同文件：compromised退出码立即进入draining且shutdown失败时仍保留专用退出码 | `runtime/product-startup.test.ts`：信号、停止路由和租约失效先后到达只停止一次，75 后再请求 1 仍以 75 退出；保留 lease-compromised、ready 校验期间失效与 observer 抛错用例。 |
| 同文件：lease失效后启动失败再请求通用失败码时保留专用退出码 | 同一竞争用例实际请求 75 后再请求 1，并注入 Agent 关闭失败，仍只退出一次且为 75。 |

以上路径统一相对于 `packages/neuro-book/server/`。

## 改写与有意删除的旧断言

| 文件与旧用例 | 当前覆盖或删除理由 |
|---|---|
| `runtime/product-startup.test.ts`：产品目录包含六个 available 服务端插件及完整真实依赖 | 改为“CLI 启动函数在端口已占用时不监听，七个必需插件可用，stop 后实例关闭”，真实占用端口，并核对七插件及依赖。 |
| 同文件：诊断观察者写入原诊断字段和本位置目录 | 删除实现复制式断言；L2 与 L3、L4 实际读取 `runtime.plugins.catalog` / `runtime.plugins.diagnostic` JSONL 验证激活与关闭依赖顺序。 |
| 同文件：同一 realm 模块重载复用仍活门禁（不模拟 Nitro Dev 跨 worker） | 删除已淘汰的 globalThis 所有权语义，不伪造同等覆盖；保留同一模块图并发启动共享门禁用例；真实 HMR 的 L7 为本次参考证据，完整交接/重试仍属 #244。 |
| 同文件：启动门禁失败时记录fatal诊断并请求有序退出，而不是依赖未捕获异常 | 改为迁移失败同步输出、输出先于释放、退出 1、无 unhandledRejection 的用例；真实 L5。 |
| 同文件其余 20 个原用例 | 用新 `startProductRuntime()` 句柄执行原行为。迁移门禁、Project owner、Files 操作、依赖逆序、关闭不完整、显式恢复、lease 失效及影子 Workspace 均保留；精确名称见 `rewritten-tests-audit.json`。observer 同步抛错现预期 ready 拒绝并停止 75，而非错误地发布 ready。 |
| `foundation/server-host.test.ts`：只依赖 runtime.application 入口；不 import Nitro/H3、数据库或产品启动模块 | 删除源码字符串匹配；直接宿主行为测试仍不需要 Nitro/H3/数据库，真实 runtime smoke 验证信号、失败、deadline 与移除监听。 |
| `routes/__nbook/control/shutdown.post.test.ts`：正确 token 返回 202 并只请求 controller 退出 | 改为“正确 token 返回 202，响应结束后才经宿主请求停止”，重复 finish/close 只触发一次，来源为 `control:http`。 |
| 同文件：客户端先断开时也请求 controller 退出 | 改为“客户端先断开时也只经宿主请求停止一次”；四个授权/loopback 测试保留。 |
| `api/workspace-files/events.get.test.ts`：客户端断开导致 push closed-stream 错误时会清理订阅 | 恢复 HEAD 的 `TypeError("stream is closing or closed")` fixture；补充排空关闭失败仍退订、完成 operation 且向 HTTP 返回原原因用例。其余五个原用例保留。 |
| 根 `scripts/build/nuxt-output-contract.test.ts`：Nitro plugin 不得用不会被 runtime 等待的 async callback 启动后台门禁 | 删除源码扫描及已删除中间件字符串断言；开发初始化/close 行为由开发适配器测试承担，就绪门禁由准入测试与 L5 承担，生产 entry/prerender 注入由真实生产构建承担。其余 8 个用例实际运行并通过；未迁移其它 Nitro 插件。 |

## 新增边界

`features/http/admission.test.ts` 覆盖就绪等待、启动失败、释放一次、迟到 SSE、SSE 主动 EOF、SSE 挂起截止和原失败聚合；`runtime/product-startup.test.ts` 补充来源竞争、HTTP 超时、最后日志时序与日志失败；`host/development-plugin.test.ts` 覆盖初始化启动及单一不抛错的 close。

返工前指定范围：21 文件 / 148 用例通过，包含停止来源绑定注册事件名的适配器用例；此用例不证明 Node/Bun 的真实信号回调无参数。输出 `server-tests-signal-fix.log`。根构建合同：1 文件 / 8 用例通过，输出 `build-contract-tests-signal-fix.log`。未运行全量 `bun run test`。返工后的有效验证见 `delivery.md` 的“返工 1”小节。
