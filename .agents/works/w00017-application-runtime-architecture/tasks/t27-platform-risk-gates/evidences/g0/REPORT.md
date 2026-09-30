# G0 验证报告：自有服务端入口（P6）与 WebSocket 升级（P5）

> 由 G0 验证子代理撰写；子代理的写入工具不允许创建 `.md` 文件，正文由主会话按其交回的内容原样保存。

- 日期：2026-09-30（UTC）
- 运行时：生产为 Bun 1.4.2；`nuxi dev` 实际运行在 Node 26.10.0（见发现 5）
- 依赖版本：Nuxt 4.4.8、nitropack 2.13.4、h3 1.15.11、crossws 0.3.5、@nuxt/cli 3.36.1
- 源码基线：临时 worktree，HEAD `476d430b`，与 w00017 分支一致；改动见 `changes.diff`
- 端口：生产与预检用 3310–3314、3320，开发用 3311；未访问 3001
- State Root：会话临时目录下的 `g0-state/{prod,dev,unmigrated}`，未触碰用户数据
- 证据等级：实测是本次实际运行得到的；源码是读依赖或产品源码得到的；推断是由前两者推出、没有单独运行的

## 结论表

| # | 验证项 | 结论 | 证据等级 | 依据 |
|---|---|---|---|---|
| 1 | 用 `entry` 指定自有入口后，产品构建成功、入口路径不变 | 成立 | 实测＋源码 | `bun run nuxt:build` 完整跑完（含后处理、模块闭包检查、镜像验证）并发布；`runtime-contract.json` 的 start 入口（`server/commands/product-start.mjs`）和 `.output/server/index.mjs` 都没变。`entry` 只能在生产构建设置（发现 3） |
| 2 | 入口与路由共用同一模块图 | 成立 | 实测＋源码 | raw 产物中，入口从共享 chunk `chunks/nitro/nitro.mjs` 导入探针、关闭控制器和 `productRuntimeReady`；最终单文件产物中 `Symbol("g0-probe")` 只出现 1 次；运行时模块求值计数为 1，路由里的 `sameProbeModule`、`sameShutdownController`、`sameProductRuntimeReady`、`sameStartupPromise` 都是 true |
| 3 | 入口自建 HTTP 服务，在 Bun 下启动、处理请求、响应 SIGTERM 与停止通道并有序退出 | 成立 | 实测 | Bun 1.4.2 下先监听、约 50 ms 后就绪；SIGTERM 和 `POST /__nbook/control/shutdown` 都等在途的 3 秒请求完成后以退出码 0 结束，租约锁已释放。HTTP 停止通道没有经过入口（发现 2） |
| 4 | Desktop 与 Manager 的就绪探测、停止通道合同不变 | 成立（Manager 实测，Desktop 源码推断） | 实测＋源码 | 用 Manager 自己的 `waitForApplicationReady`（带 nonce）、`shutdownNativeProduct` 和 Owned Process 强制收口驱动 `product-command.mjs command start`，结果分别是就绪、`graceful`、强制收口后退出码 0。Electron 和 Tauri 只通过 Manager `desktop supervise` 的 NDJSON 事件间接依赖这两个函数，桌面壳未实跑 |
| 5 | 开发模式下，插件在 Nitro 初始化时建实例、在 close 钩子中停止，热重载后不残留 | 部分成立 | 实测＋源码 | 6 次普通重载中，旧实例都先关完（47–128 ms），新实例 0.8–2.4 s 后才初始化，没有并存。但 Nitro 不等旧 worker 关完就启动新 worker：旧实例关得比新 worker 启动慢时两份并存，新实例拿不到租约而失败，且不会自己恢复。关闭钩子抛错时租约泄漏。开发模式下停止通道和 SIGTERM 都不能有序停止进程 |
| 6 | 自有入口在 Bun 下用 crossws node 适配器完成 WebSocket 往返，并按现有 Cookie 会话鉴权 | 成立 | 实测 | 生产构建（鉴权默认开启）中：带登录 Cookie 的升级返回 101，hello 和 echo 两帧都带出 admin；不带 Cookie 和伪造 Cookie 都返回 401。`getCurrentUser` 不能直接用于升级，需要只读判定（发现 6）。开发模式的 WebSocket 未验证 |

## 关键发现

### 1. 开发模式热重载有新旧实例重叠的窗口，重叠后新实例启动失败且不会自己恢复（最重要）

- 源码：nitropack 的 `DevServer.reload()` 对旧 worker 调用 `close()` 但不等结果，紧接着 `new NodeDevWorker()`。旧 worker 收到 shutdown 后跑 Nitro close 钩子，父线程一直等它发回 `exit` 消息；`NITRO_SHUTDOWN_TIMEOUT` 到期只打印警告，不会强制结束。每个 worker 是独立线程，`globalThis` 不共享，所以 `__nbookProductApplicationV1` 这类全局单例保护在开发模式下不起作用。
- 实测（`outputs/dev-events.jsonl`）：
  - 6 次普通重载：旧实例关闭耗时 47、87、67、128、54、54 ms；新 worker 分别在旧实例开始关闭后 1.70、1.81、1.68、2.38、0.82、0.79 s 才初始化，没有并存。这只是时序上碰巧安全，不是结构上的保证。
  - 模拟旧实例关闭要 4 秒（比如在跑的 Agent 任务需要收尾）：新 worker 0.91 s 后初始化，取租约时得到 `AgentSessionStoreLeaseHeldError`。旧实例 4 秒后才释放租约，但新实例的失败已被 `productRuntimeReady` 缓存，之后所有请求都返回 500，直到下一次热重载（`outputs/dev-reload-r6-delay4000.log`）。
  - 意外观察：分两步保存开发插件时，推断监视构建取到了“只有调用、没有 import”的中间状态，于是该 worker 的 close 钩子抛出 `existsSync is not defined`。hookable 串行执行钩子，第一个抛错会跳过后面的钩子，现有 `project-session-close` 插件的关闭也没执行。worker 随后被结束，租约锁残留（心跳停在 11:01:08），新实例启动失败，直到锁过期（30 秒）并再重载一次才恢复（`outputs/dev-reload-r4.log`、`outputs/dev-reload-r5.log`、`outputs/dev-server.log`）。

### 2. 停止路径没有汇合到入口；开发模式下两条停止路径都不能有序停止进程

- 生产，实测：
  - SIGTERM 走入口的 `requestStop`，事件顺序是 `stop-requested → slow-request-end → http-server-closed → close-hook-done → process-exit(0)`。
  - `POST /__nbook/control/shutdown` 由路由直接调用 `productShutdownController.requestProcessExit()`，事件里只有 `process-exit(0)`：没有停止接纳、没有关 WebSocket、没有跑 Nitro close 钩子（`outputs/prod-manager-events.jsonl`）。现在结果仍然正确，是因为关闭控制器自己会等在途请求，进程退出时连接随之关闭。但 P6 要求由宿主先停止接纳，这条路径目前不经过宿主。
  - 两条路径在排空期间对新请求的处理不同：SIGTERM 路径执行 `server.close()` 后新连接被拒绝；HTTP 路径保留监听，新请求得到 503。
- 开发，实测：
  - HTTP 停止通道在 worker 内执行：关闭步骤跑完、租约已释放，但 `process.exit(0)` 只结束 worker 线程，nuxi 进程继续存活，对所有请求返回 `worker exited with code 0`（`outputs/misc-observations.txt` C 节）。
  - 对进程组发 SIGTERM：nuxi 约 1 秒内退出，但没跑任何 close 钩子，租约锁残留（D 节）。
- 源码：@nuxt/cli 3.36.1 在 `--no-fork` 路径下只为 CPU profile 监听信号。
- 推断：`source-dev.ts` 的 Ctrl+C 流程会在收到 HTTP 202 后等满 30 秒，再强制结束。

### 3. `entry` 必须只在生产构建设置，并从预渲染配置中移除

- 源码：
  - Nuxt 把 `nitro` 配置作为 `createNitro` 的 overrides 传入。c12 合并时 overrides 优先于预设层（预设通过 `extends` 加入），所以 nuxt.config 里的 `nitro.entry` 会顶掉 `nitro-dev` 预设的开发 worker 入口。
  - nitropack 的 `prerender()` 用 `...nitro.options._config` 创建 `nitro-prerender` 实例，同样会继承 `entry`；而预渲染器要求入口导出 `localFetch` 和 `closePrerenderer`。
- 实测可用的做法：在 nuxt.config 的内联模块里，只在 `!nuxt.options.dev` 时于 `nitro:config` 设置 `entry`，并在 `prerender:config` 中删除它。当前构建没有预渲染路由（日志里没有 `Initializing prerenderer`），所以预渲染这一分支没有实际触发。
- 推断：如果无条件设置 `entry`，开发 worker 会运行自有入口并去监听 `PORT`（和 nuxi 冲突），也不会向父线程报告地址，开发服务将不可用。

### 4. 启动门禁失败时进程不退出

- 实测：用未迁移的空 State Root 直接运行 `.output/server/index.mjs`，门禁失败（“NeuroBook 数据状态需要迁移”），8 秒后进程仍存活，`/api/app/version` 返回 500（`outputs/prod-startup-failure-events.jsonl`）。Manager 的就绪探测会把 500 当成“还没就绪”，一直重试到 120 秒超时，而不是马上发现进程退出。
- 源码：`server/middleware/00-product-startup.ts` 靠 `setImmediate(() => { throw error })` 终止进程，但入口调用的 nitropack `trapUnhandledNodeErrors()` 对 uncaughtException 只记录、不退出。原 node-server 入口也调用这个函数，所以推断这是现有问题；本次没有用原始构建复现。

### 5. 开发和生产运行在不同的 JS 运行时

- 实测：开发模式的租约记录是 `runtime: node, runtimeVersion: 26.10.0`，进程是 `node .../node_modules/.bin/nuxt dev --no-fork`——`bun x` 按 nuxt 可执行文件的 `#!/usr/bin/env node` 启动了 Node。生产租约记录是 `runtime: bun, 1.4.2`。开发者 3001 端口的服务也是同样的 node 进程（只用 `ps` 只读观察）。
- 影响：P6 说“开发与生产只在谁监听端口上不同”，这不准确。两者还在运行时、worker 线程模型、停止通道和实例重叠上不同。第 5 项的结论针对的是 Node 下的 nuxi dev；Bun 下的开发 worker 未验证。

### 6. crossws node 适配器在 Bun 下可用；升级鉴权需要只读判定

- 实测：独立预检（不经 Nuxt）和生产构建中，Bun 1.4.2 的 `node:http` 都会触发 `upgrade` 事件，crossws 0.3.5 自带的 ws 实现能完成 101 握手和双向收发。
- 源码与实测：
  - h3 对非 H3Event 的会话（比如 crossws 的升级请求）只读；没有会话 Cookie 时，`getUserSession` 会抛出 “Cannot initialize a new session”。
  - 现有 `getCurrentUser(event)` 需要 H3Event，并且会话失效时会调用 `clearAuthSession` 写回 Cookie，而升级请求没有可写的响应。
  - 所以本次在入口里另写了一个只读判定：检查会话用户 id、用户存在且为 active、`sessionVersion` 一致；鉴权关闭时直接放行。判定规则和 `getCurrentUser` 相同，只是不写 Cookie。
- 推断：开发模式不运行自有入口。如果 WebSocket 处理要在两种模式下共用，应注册到 `h3App.websocket`（Nitro 的 `experimental.websocket`）。这样开发时 nitro-dev 入口会处理升级、开发代理负责转发；生产入口则用 `wsAdapter(nitroApp.h3App.websocket)`。这条路径未验证。

### 7. 生产环境不依赖全局单例保护

- 实测与源码：Rollup 把入口和路由共用的模块放进 `chunks/nitro/nitro.mjs`，产品后处理再用 esbuild（不拆分）打成单个 `index.mjs`，两步之后都只有一份模块实例。
- 探针特意用模块私有的 Symbol 加全局求值计数，避免被现有 `globalThis.__nbookProductApplicationV1` 掩盖重复实例。

## 踩到的坑

- 产品镜像构建会检查构建期间源码有没有变化。第一次构建时在 worktree 里新建了 harness 文件，后处理都过了，最后仍被 `Product build 期间 Source 输入发生变化：sourceDigest` 拒绝。构建期间不能改动 worktree。
- 本机内存紧张：第二次构建的 `nuxt:build:raw` 被 OOM 杀掉（当时另一个子代理的 nuxt dev 占约 3.7 GB，交换区接近用尽），第三次才成功。
- `create-admin` 的用户名是位置参数，没有 `--username`；密码从 stdin 原样读取，不去掉换行。
- 分两步保存开发插件时，监视构建取到中间状态，close 钩子抛错。这反而暴露了发现 1 里关闭钩子不隔离失败的问题。
- `bun x nuxt dev` 实际跑的是 Node，不是 Bun。

## 对设计 P6（及 P5）的修改建议

需要改设计，但不需要推翻“内核拥有进程”的方向：生产侧第 1、2、3、4、6 项都成立，要改的是开发适配器和停止路径。

1. **生产入口配置。** 写明 `entry` 由一个 Nuxt 模块只在非开发构建时注入，并在 `prerender:config` 里移除。另外注明：自有入口依赖 nitropack 的内部导出（`#nitro-internal-pollyfills`，以及 `nitropack/runtime/internal` 里的 `trapUnhandledNodeErrors`），升级 nitropack（尤其是 Nitro 3）时要重新验证。
2. **停止路径汇合。**
   - `/__nbook/control/shutdown` 改为调用宿主的 `requestStop("control:http")`，和信号走同一条路径：先停止接纳、关 WebSocket，再按依赖逆序关闭。
   - 进程信号只由宿主挂接一次。现在 `productRuntimeReady` 用 `signals: []` 建立实例，信号是入口直接挂的。
   - 写明停止期间对新请求的处理：是保留监听并返回 503，还是停止监听。
3. **启动门禁失败。** 入口 `await` 启动结果，失败时有序停止并以约定退出码退出；不再靠 uncaughtException 终止进程，因为 `trapUnhandledNodeErrors` 会把它吞掉。
4. **开发适配器（P6“开发模式”一段需要重写）。**
   - 新实例取得进程级资源（Session Store 租约等）之前，必须等同一进程里的旧实例释放。Nitro 不会等旧 worker 关完，所以适配器要自己串行化。例如：开发模式下租约持有者是同一 pid 的旧 worker 时，在有界时间内等待；或者由主进程侧协调。不要立即失败。
   - 开发模式的启动失败不能被 `productRuntimeReady` 永久缓存，要允许下一次请求或重载重试。
   - 内核停止只注册一个不抛错的 Nitro close 钩子，其余关闭由内核按依赖逆序管理，不让各个插件自己挂 Nitro close（因为 hookable 遇到第一个抛错就会跳过后面的钩子）。
   - 重新设计开发模式的停止通道：worker 里的 `process.exit` 只结束线程，nuxi `--no-fork` 也不处理 SIGTERM。一个可选做法是写一个只在开发时启用、运行在 nuxi 主进程里的 Nuxt 模块，接管 SIGINT/SIGTERM 和停止请求并调用 `nuxt.close()`，需要另行验证。
   - 删掉“开发与生产只在谁监听端口上不同”，改为列出三处差异：运行时（Node 与 Bun）、停止通道、实例重叠。
5. **P5 WebSocket。** 从 `getCurrentUser` 拆出不写 Cookie 的只读身份判定，HTTP 中间件和 WebSocket 升级共用；WebSocket 处理注册到 `h3App.websocket`，让开发和生产用同一份处理（待验证）。

## 未验证边界

- Electron、Tauri 和 Manager `desktop supervise` 全链路没有实跑，因为需要安装布局和产品回执。Desktop 的结论来自源码：两者只消费 Manager 发出的 NDJSON `ready`/`stopped` 事件，这些事件由本次实测过的 `waitForApplicationReady` 和 `launch.shutdown()`（也就是 `shutdownNativeProduct`）产生。
- Windows：SIGTERM 不能用于有序停止，只能走 HTTP 通道加强制结束；没有测。
- 开发模式在 Bun 下（`bun --bun x nuxt dev`）的 worker 行为，以及经 nitro 开发代理的 WebSocket 升级，都没有验证。
- `ServerRuntimeHost` 自己挂接进程信号没有验证：本次信号由入口挂接，运行实例由 `productRuntimeReady` 以 `signals: []` 建立。
- P6 第 2 条（按清单登记插件、启动门禁）和第 4 条（http 插件按依赖逆序关闭）还没有实现，没有验证。
- 原 node-server 入口下“门禁失败不退出”只是源码推断，没有用原始构建复现。
- 自有入口没有实现 `NITRO_SSL_CERT`/`NITRO_SSL_KEY`、`NITRO_UNIX_SOCKET`、定时任务（`startScheduleRunner`）这些 node-server 选项；产品当前是否用到它们没有核查。
- 容器里作为 PID 1 运行的场景，只通过 Owned Process 向进程组发 SIGTERM（包括 product-start 包装进程转发信号）间接覆盖。
- 没有对改动跑 typecheck 或单元测试；实验代码只用于验证，不是可以合入的实现。

## 复现

临时 worktree 根目录记为 `$WT`，会话临时目录记为 `$SCR`。harness 用相对路径导入，所以要把 `harness/prod-harness.ts` 放到 `$WT/g0-harness/` 下。

1. 应用 `changes.diff`：新增 `server/host/product-host-entry.ts`、`server/g0/probe.ts`、`server/api/g0/{probe,slow}.get.ts`、`server/plugins/00-g0-dev-runtime.ts`，并修改 `nuxt.config.ts`。然后在 `$WT` 执行 `bun install`。
2. 构建：`cd $WT/packages/neuro-book && bun run nuxt:build`。构建期间不要改动 worktree。
3. 生产验证（端口任选，避开 3001），每步的事件时间线写在 `<stateRoot>/g0-events.jsonl`：
   - `bun g0-harness/prod-harness.ts prepare $SCR/g0-state/prod 3310`：通过产品命令执行迁移并创建管理员；
   - `... manager $SCR/g0-state/prod 3310`：Manager 就绪探测、登录、WebSocket、HTTP 停止通道；
   - `... sigterm $SCR/g0-state/prod 3312`：直接运行 `index.mjs` 并发 SIGTERM；
   - `... force $SCR/g0-state/prod 3313`：Owned Process 强制收口。
4. 开发验证：
   - `source harness/dev-env.sh`；
   - 用 `bun --no-install run migrate:deploy` 和 `bun --no-install run migrate:application-state -- --apply` 准备 State Root；
   - 运行 `bun --no-install run dev:runtime`；
   - 用 `bash harness/dev-reload.sh <修订号> route|deep` 触发热重载；
   - 往 `$G0_EVENT_LOG.close-delay-ms` 写入毫秒数，可以模拟旧实例慢关闭。

## 文件

- `changes.diff`：对产品源码的全部改动（含新文件）
- `harness/`：`prod-harness.ts`、`dev-env.sh`、`dev-reload.sh`、`standalone-ws.mjs`
- `outputs/`：
  - 构建：`build-product-image-excerpt.log`、`item1-build-evidence.txt`、`raw-nitro-output-evidence.txt`
  - 生产场景：`prod-*.log` 和 `prod-*-events.jsonl`
  - 开发：`dev-server.log`（已去除颜色码）、`dev-reload-r*.log`、`dev-events.jsonl`
  - 其它：`misc-observations.txt`（WebSocket 预检、各次构建尝试、开发停止通道、运行时、门禁失败）
