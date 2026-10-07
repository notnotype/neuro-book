---
schema: nbook.spec/v1
kind: behavior
status: implemented
capability: runtime.server-host
owners:
  - application-runtime
---

# 服务端宿主：内核拥有进程

## 目标与非目标

服务端进程由宿主适配器与内核拥有：进程入口建立唯一的运行实例，按产品清单登记插件，执行启动门禁，由 `nbook.http` 插件监听 HTTP 端口，宿主另开内核 RPC 端口承载远程服务（[远程服务与 RPC 协议](plugin-channel.md)）；宿主还管理项目：每个打开的项目一个子进程（[项目与项目实例](projects.md)）。所有停止来源汇合到同一个有序停止流程，先封闭接纳并排空 HTTP 与 RPC，再停止项目子进程，最后按依赖逆序关闭插件；启动失败与停止结果以约定的退出码报告。开发模式与生产在同一套内核语义下运行。

明确不承诺：

- 不定义交付：打包分发、安装、Manager 与桌面版的启动与停止通道属于另行设计的交付链。
- 不定义浏览器宿主（[`runtime.browser-host`](browser-host.md)）与主线程卡死看门狗（[`runtime.stall-watchdog`](stall-watchdog.md)）。
- 不定义 Session Store 租约本身（[`agent.session-store-lease`](../../archived/specs/agent/session-store-lease.md)），只规定租约失效作为停止来源。
- 不支持一个进程中同时存在两个产品运行实例。

## 术语与参与者

- **宿主入口**：`packages/neuro-book/src/server/main.ts`；生产运行它的 Bun 打包产物，与全部后端代码处于同一模块图。
- **运行实例**：`runtime.application` 定义的一次启动；本能力中每个进程一个。
- **产品清单**：`packages/neuro-book/src/manifest.ts`，列出本应用加载的插件；后端按它装配插件的后端入口。
- **启动必需插件**：服务端入口失败即启动失败的插件。当前清单中有服务端入口的插件（`nbook.diagnostics`、`nbook.http`、`nbook.commands`）都是启动必需。它们的浏览器入口按窗口判定（[`runtime.browser-host`](browser-host.md)）。
- **停止来源**：进程信号（SIGTERM、SIGINT）、标准输入停止通道、Session Store 租约失效、启动失败、进程级未处理异常。启动失败由内核自行关闭已取得的资源；就绪前的请求都在等待、没有被接纳，因此不需要排空。
- **标准输入停止通道**：以 `--stop-stdin` 启动时，标准输入读到一行 `stop`、或标准输入结束（父进程已不在），都请求停止。Windows 上外部进程不能合作发送信号，开发监督进程与 smoke 用它停止后端。
- **排空**：停止接纳新请求、等待在途请求结束的阶段。
- **开发监督进程**：开发模式下启动并在后端文件变化时有序重启后端进程的进程。
- **项目子进程**：服务端为每个打开的项目起的 Bun 子进程，里面是 `project` 位置的运行实例（[`runtime.projects`](projects.md)）；归服务端的项目管理器所有。

## 输入与前置条件

- 启动参数：环境变量 `NBOOK_STATE_ROOT`（状态根，必填；日志写在 `<状态根>/logs/`）、`NBOOK_HOST`（缺省 `127.0.0.1`）、`NBOOK_PORT`（缺省 3000，0 表示由系统分配）、`NBOOK_WEB_ROOT`（前端构建产物目录，可选；相对路径按工作目录解析）、`NBOOK_RPC_PORT`（内核 RPC 端口，缺省 0 即由系统分配，浏览器经引导接口得知）、`NBOOK_ALLOWED_ORIGINS`（逗号分隔的额外页面来源，给页面不由本进程 HTTP 端口提供的情形，即开发模式的页面服务）、`NBOOK_PROJECT_GRACE_MS`（项目宽限期，缺省 300000）、`NBOOK_PROJECT_START_MS`（项目子进程报告启动结果的截止，缺省 30000）、`NBOOK_PROJECT_STOP_MS`（每个项目子进程的停止截止，缺省 20000；三项随 t54，都是 1..2^31-1 的整数毫秒）；命令行 `--stop-stdin`。参数无效时写出一行致命诊断并以 1 退出，不建立运行实例。内核不自行扫描替代根。
- 未加载鉴权插件时只允许监听回环地址（`127.0.0.1`、`::1`、`localhost`），其它地址按参数无效处理；HTTP 与 RPC 端口监听同一地址。`NBOOK_ALLOWED_ORIGINS` 的每一项必须是回环主机上的 `http` 来源（`http://127.0.0.1:<端口>` 之类，不带路径），否则同样按参数无效处理。
- 内置插件随产品清单构建；已安装插件来自状态根（[`runtime.plugin-install`](plugin-install.md)，尚未实现）。
- 生产与开发都运行在 Bun 上。

## 输出与可观察行为

**启动序列：**

1. 读取启动参数；建立诊断存储（记录能力先于任何插件存在）、服务端的远程节点与路由，并监听内核 RPC 端口，在标准输出打印一行 `RPC listening on ws://<地址>`；RPC 端口监听失败（含已被占用）时写出致命诊断并以 1 退出，不建立运行实例。然后建立运行实例：根作用域、服务装配、插件宿主（远程节点交给插件宿主）、项目管理器（随 t54：本地能力 `projectsKey` 放进清单，路由的绑定与 `{project}` 访问回调接到它）；挂接进程信号、未处理异常与停止通道，每个实例只挂接一次。
2. 发现：产品清单中的插件，加上状态根中已启用插件的清单（尚未实现）。
3. 登记：按 [`runtime.plugin-manifest`](plugin-manifest.md) 校验与推导，不执行插件代码。启动必需插件的服务端入口受阻或清单无效时启动失败。
4. 启动激活：启动必需插件的入口与声明 `onStartup` 的入口，依赖先于依赖者（`nbook.diagnostics` 是依赖图的根）。
5. `nbook.http` 激活后用 Bun 监听，并在标准输出打印一行 `Listening on <地址>`。端口先监听，请求等待运行实例就绪，就绪后处理；宿主自有接口 `GET /api/runtime/health` 在就绪后返回 200。RPC 端口同样先监听：升级请求等运行实例就绪后才核对来源并升级，启动失败时得到 503。
6. 其余入口按激活事件懒激活。

**请求分发：** `nbook.http` 定义贡献点 `http.routes`。插件的服务端入口提交一个处理器（通常是 Hono 应用），贡献 id 写插件自己的 id（贡献点内的 id 唯一，见 [`runtime.plugins`](plugins.md)），挂到 `/api/<插件 id>/`，处理器收到的路径已去掉这个前缀；入口停止时摘下，之后的请求得到 404，摘下前的过渡期得到 503。`/api/runtime/` 留给宿主自有接口：`/health`，以及浏览器引导接口 `/browser-bootstrap`（[`runtime.browser-host`](browser-host.md)）。

**内核 RPC 端口：** 协议、握手与 `Origin` 规则见 [远程服务与 RPC 协议](plugin-channel.md) 的“WebSocket 传输与握手”。允许的来源是本进程 HTTP 端口在三个回环别名上的来源（`http://127.0.0.1:<端口>`、`http://localhost:<端口>`、`http://[::1]:<端口>`，端口取实际监听的端口），加上 `NBOOK_ALLOWED_ORIGINS`；比较前按 URL 规范化。服务端用 WebSocket ping 发现失联客户端：空闲 120 秒且不回应即断开。

**页面资源：** 设置了 `NBOOK_WEB_ROOT` 时，`/api/` 之外的路径由前端构建产物提供：只有 GET、HEAD；路径（含符号链接）不能越出该目录；没有扩展名的页面路径回退到 `index.html`，`/assets/` 下与带扩展名的缺失文件是 404；`/assets/` 下的文件长期缓存（Vite 只往这个目录放文件名带内容哈希的产物），其余（含 `index.html`）每次重新验证。页面资源同样经过准入，就绪前等待、排空期间 503。目录缺少 `index.html` 时 `nbook.http` 激活失败，即启动失败。未设置时 `/api/` 之外的路径一律 404（开发模式由 Vite 提供页面）。`/api` 命名空间（按解码后的路径判断）里没有匹配的路径不回退到页面。

**停止序列：** 任一停止来源触发后：

1. 同步封闭接纳：`nbook.http` 停止接纳新请求、RPC 路由停止接纳、项目管理器停止接纳（随 t54：之后的打开项目与客户端绑定被拒，见 [`runtime.projects`](projects.md) 输出第 11 条）。三处在同一个同步段里关闭，排空期间不会再有项目被打开。
2. HTTP 与 RPC 同时排空，两者都结束后才进入下一步：
   - `nbook.http` 停止接纳新请求：排空期间保持监听，对新请求返回 503；关闭已登记的事件流（不计入等待）；等待在途请求结束，排空上限 20 秒，超时后继续后续步骤并记为关闭未完成的一项。在途从请求被接纳起，到处理器返回且响应正文发送完毕（或被客户端取消）为止。客户端断开时处理器若还没返回，仍计入在途，因为它还在使用插件资源；处理器应响应请求的取消信号。
   - RPC 路由停止接纳（新的升级得到 503，已连接客户端的新 hello、新请求与新订阅被拒），再排空路由已接纳的在途远程请求，上限同为 20 秒，超时记为关闭未完成的一项。
3. 停止全部项目子进程并等它们真实退出（随 t54）：每个子进程的截止为 `NBOOK_PROJECT_STOP_MS`，到时强制结束并记为外部观察到的终止；有子进程被强制结束或以非 0 退出码结束时，记为关闭未完成的一项。子进程停止期间服务端插件与路由仍可用，供项目实例收口时调用。
4. 其余插件入口按依赖逆序关闭（依赖者先、提供者后），`nbook.diagnostics` 最后关闭。服务端插件提供的远程服务随入口停止撤回，客户端的订阅随之结束。
5. 关闭 RPC 路由的全部链路并停止监听 RPC 端口。插件关闭期间链路保持，客户端看到的是服务不可用，而不是断线。
6. 以退出码结束进程：

| 结果 | 退出码 |
|---|---|
| 正常停止且全部关闭完成 | 0 |
| 启动失败；进程级未处理异常；或停止中有步骤失败、超时 | 1 |
| Session Store 租约失效触发的停止（无论关闭是否完成；随 Session Store 插件实现） | 75 |
| 主线程卡死被看门狗结束 | 76（[`runtime.stall-watchdog`](stall-watchdog.md)） |

- 多个停止来源先后到达时只执行一次停止；退出码取更具体的原因：已请求 75 后再请求 1 仍以 75 退出。
- 启动失败时先同步写出一行致命诊断（原因、失败的门禁或插件入口），再有序停止已取得的资源，然后以 1 退出；不依赖未捕获异常终止进程。内核关闭完成后再写一行 `runtime.startup.causes`，列出各失败入口的具体错误（紧急通道只带入口与代号，不带错误正文）。等待就绪的请求在致命诊断写出时即得到 503 `startup-failed`，先于监听关闭。按清单装配插件本身失败（还没有运行实例）时同样先写出致命诊断，再以 1 退出。
- 进程级未处理异常（未捕获异常、未处理的 Promise 拒绝）：同步写出致命诊断，按停止序列有序停止，以 1 退出。
- 关闭未完成时，进程退出前补写诊断存储中已接受的记录。

**项目子进程**（随 t54）：

- 服务端用自己的 Bun 可执行文件运行项目宿主入口：生产是打包产物中与服务端入口同目录的 `project.js`（同一次构建产出），开发模式是项目宿主的开发入口。子进程从环境变量得到项目 id、短名、代次、项目目录与状态根，经 Bun 进程间通信连到路由（[远程服务与 RPC 协议](plugin-channel.md) 的“进程间链路”）。
- 子进程的标准输出与标准错误逐行转发到服务端的同名输出，每行加前缀 `[project <短名>#<代次>]`；子进程的诊断写各自的日志位置 `<状态根>/logs/projects/<短名>/`。
- 启动结果有截止 `NBOOK_PROJECT_START_MS`：到时强制结束子进程；启动中退出、报告启动失败（先请求停止并等它退出，到停止截止强制结束）都按创建失败收口，写诊断，子进程不残留。项目的创建失败、崩溃只影响那个项目，不使服务端停止，也不改变服务端的退出码。

**开发模式：**

- 一条命令 `bun run dev` 同时启动页面服务（Vite，前端热更新）与后端子进程。页面在 `NBOOK_DEV_PORT`（缺省 3000），后端在 `NBOOK_DEV_BACKEND_PORT`（缺省 3001，整个会话固定，0 表示启动时取一个空闲端口），后端的 RPC 端口为 `NBOOK_DEV_RPC_PORT`（缺省 0，每次启动后端由系统分配），都只监听 `127.0.0.1`。监督进程把 RPC 端口与页面服务在三个回环别名上的来源（`NBOOK_ALLOWED_ORIGINS`）传给后端；页面经引导接口得知 RPC 端口后直连后端，不经页面服务代理 WebSocket，后端每次重启对已打开的页面都是服务端重启。未设置 `NBOOK_STATE_ROOT` 时状态根是 `packages/neuro-book/.dev-state/`（git 忽略，每个 worktree 一份）。
- 页面服务把 `/api` 代理到后端，代理前先过一道门：后端启动或重启中时请求等它就绪；后端启动失败或已退出时直接返回 503 `backend-unavailable`，浏览器显示连接失败页；会话结束中返回 503 `stopping`。
- 后端子进程跑开发入口 `src/server/development-main.ts`：与产品入口相同，另在产品清单之外加载开发清单（`src/development-manifest.ts`，目前是 Component Lab，见 [`ui.component-lab`](../ui/component-lab.md)），引导接口随之列出它们；生产构建只打包产品入口。项目子进程同样跑项目宿主的开发入口；后端重启时按停止序列先停它打开的项目子进程（随 t54）。
- 监督进程以 `--stop-stdin` 启动后端子进程，就绪以 `GET /api/runtime/health` 返回 200 为准（`Listening on` 只说明端口已监听）。后端文件（本包 `src/` 与后端用到的 workspace 包源码中的 `.ts`、`.json`；不含前端 `web/` 与 `ui/`、测试、`testing/` 与监督进程自身 `server/dev/`；后端用到的 workspace 包取包的 `dependencies`，只进前端构建的包放在 `devDependencies`）变化时，去抖 100 ms 后经停止通道按停止序列有序停止旧进程，等它退出后再启动新进程；同一时刻只有一个后端进程持有进程级资源。重启中的新改动不追加重启。新进程启动失败或运行中退出时，监督进程报告原因并等待下一次文件变化，不循环重启。
- 监督进程收到第一个 SIGTERM、SIGINT 时，停止监视，先有序停止后端子进程，再停止页面服务后退出：后端以 0 退出时会话以 0 结束，否则以 1；等待改动时最近一个后端已经失败，同样以 1 结束。第二个信号不再等排空，直接结束后端，以 1 结束。终端 Ctrl+C 同时发给后端的 SIGINT 与停止通道汇合为同一次停止。页面端口被占用时以 1 退出，不启动后端。
- 插件热插拔（[`runtime.plugin-hot-plug`](plugin-hot-plug.md)）实现后，改为只重载变化的插件。

## 状态与转换

| 当前 | 事件 | 结果 |
|---|---|---|
| 未启动 | 进程启动 | 启动中；端口监听后请求等待 |
| 启动中 | 全部启动门禁通过 | 可用；等待中的请求开始处理 |
| 启动中 | 启动必需插件失败或受阻 | 停止中，结束时退出码 1 |
| 启动中、可用 | 任一停止来源 | 停止中（封闭接纳 → HTTP 与 RPC 排空 → 停止项目子进程 → 依赖逆序关闭 → 关闭 RPC 链路与监听） |
| 停止中 | 再次收到停止来源 | 不重复执行；按上表更新退出码 |
| 停止中 | 全部关闭完成 | 退出（0 或原因对应的退出码） |
| 停止中 | 某步失败或超时 | 继续其余步骤，结束时退出码 1（或 75、76） |

开发模式重启：旧后端进程停止中 → 旧进程退出 → 新后端进程启动中。

## 副作用与数据

- 宿主挂接的进程信号、未处理异常监听与停止通道归宿主，停止结算后移除。
- 启动失败与停止未完成写入诊断日志与标准错误；不删除任何用户数据。
- HTTP 监听归 `nbook.http` 的激活作用域，入口关闭时断开剩余连接。RPC 监听与路由归宿主，插件全部关闭后断开剩余连接。
- 项目子进程归宿主的项目管理器，随宽限期满、崩溃或服务端停止结束；服务端不结束自己没有创建的进程。项目登记表与项目身份文件见 [`runtime.projects`](projects.md)。

## 失败与恢复

- 启动参数无效：写出致命诊断，以 1 退出，不建立运行实例。
- 启动失败（含端口已被占用）：有序停止、以 1 退出。RPC 端口监听失败发生在运行实例建立之前，写出致命诊断后直接以 1 退出。
- 排空超时（HTTP 或 RPC）：继续关闭其余插件，退出码 1。
- 某个插件关闭抛错：记录错误，继续关闭其余插件，退出码 1。
- 租约失效：立即进入停止并拒绝新请求，退出码 75；已取得排他资源在依赖仍被使用时不提前释放。
- 开发模式新后端进程启动失败：监督进程报告原因，下一次文件变化时重试；不强行抢占资源。
- 项目子进程停止超时：强制结束并记为外部终止，继续其余步骤，退出码 1。服务端被强制结束时，项目子进程发现进程间链路断开后自行按停止序列退出。
- 强制结束（`SIGKILL`、断电）：不保证任何关闭步骤执行；下次启动按持久化数据与领域合同恢复。

## 边界与兼容

- **owner**：application-runtime（宿主适配器）；内核合同沿用 [`runtime.application`](application.md)、[`runtime.lifecycle`](lifecycle.md)。
- **兼容**：退出码 0、1、75、76 的含义保持不变。v2 去掉了旧应用的 `.output/server/index.mjs` 入口、`PRODUCT_SHUTDOWN_PATH` 控制请求与产品启动包装进程；它们服务的 Manager 与桌面版已在 v2 分支删除。
- **鉴权**：鉴权是可选的内置插件，向 `nbook.http` 贡献请求守卫；未加载时宿主只监听回环地址。
- **开发模式问题** 对应 [#244](https://github.com/notnotype/neuro-book/issues/244)。

## 验收与 Smoke

1. **同一模块图。** 生产打包产物中宿主入口与请求处理取得的是同一份后端模块实例。
2. **启动失败退出。** Given 启动必需插件激活失败或端口已被占用；Then 进程写出致命诊断后以 1 退出，不存活为只返回 503 的服务。
3. **有序停止。** Given 一个进行中的长请求；When 发送 SIGTERM；Then 新请求得到 503、长请求完成、插件按依赖逆序关闭，进程以 0 退出。
4. **停止通道不绕过排空。** 经标准输入 `stop` 停止时，行为与场景 3 相同；标准输入结束时同样有序停止。
5. **租约失效。** 模拟租约失效：进程停止并以 75 退出；随后又发生关闭失败，仍以 75 退出。
6. **排空超时。** 在途请求超过 20 秒：继续关闭其余插件，以 1 退出。
7. **开发重启。** 修改后端文件：旧后端进程有序停止后新进程启动，没有两个进程同时监听；新进程启动失败时监督进程不循环重启。
8. **开发停止。** 对开发监督进程发送 SIGTERM：后端子进程有序停止后监督进程退出。
9. **关闭步骤隔离。** 注入一个插件关闭时抛错：其余插件仍被关闭，退出码 1。
10. **未处理异常。** 插件代码抛出未捕获异常：写出致命诊断，有序停止，以 1 退出。
11. **参数校验。** 缺少状态根或监听地址不是回环地址：以 1 退出，不监听。`NBOOK_RPC_PORT` 不是端口号、`NBOOK_ALLOWED_ORIGINS` 含非回环或非 `http` 的来源：同样以 1 退出。
12. **RPC 端口。** 启动后标准输出有 `RPC listening on`；就绪前的升级等待，启动失败时得到 503；带不允许 `Origin` 的升级得到 403，HTTP 端口的三个回环来源与 `NBOOK_ALLOWED_ORIGINS` 列出的来源放行；RPC 端口被占用时以 1 退出。
13. **RPC 停止。** Given 一个客户端正在等待服务端插件的远程请求；When 任一停止来源请求停止；Then 新升级得到 503、该请求完成后插件才关闭，RPC 排空超过 20 秒时以 1 退出；停止后 RPC 端口不再接受连接。
14. **项目子进程的停止顺序**（随 t54）。Given 一个打开的项目与绑定它的窗口；When 发送 SIGTERM；Then 新握手与新的打开项目被拒，项目子进程先于服务端插件退出，进程以 0 退出。
15. **项目子进程停止超时**（随 t54）。Given 一个不响应停止请求的项目子进程；When 服务端停止；Then 到 `NBOOK_PROJECT_STOP_MS` 时它被强制结束并记为外部终止，其余步骤照常，进程以 1 退出。
16. **项目参数与输出**（随 t54）。`NBOOK_PROJECT_GRACE_MS`、`NBOOK_PROJECT_START_MS`、`NBOOK_PROJECT_STOP_MS` 不是合法毫秒数时以 1 退出；项目子进程的输出带 `[project <短名>#<代次>]` 前缀出现在服务端输出里。

Smoke：生产打包产物在 Bun 下用临时状态根运行场景 1、2、4、11，以及一次 RPC 握手（场景 12 的来源核对）和一次打开项目（随 t54：登记临时目录、经 RPC 绑定、项目子进程报告身份）；开发模式运行场景 7、8，并核对页面直连 RPC 端口、后端重启后页面显示服务端已重启。

## 实现合同

- **实现 owner 与入口**：application-runtime。进程入口 `packages/neuro-book/src/server/main.ts`（产品清单）与 `development-main.ts`（另加开发清单），两者只差清单，启动与退出都在 `src/server/process.ts`（`runServerProcess(manifest)`）；启动参数 `src/server/config.ts`（`readServerConfig(argv, env, cwd)`，失败抛带 `code` 的 `ServerConfigError`）；宿主适配器 `src/server/host.ts`（`startServerHost(options)` 返回 `ServerHost`：`requestStop(source)`、`stopSource`、`stopped`、`beforeStopError`、`detached`；选项含 `signals`、`process`、`stopInput`、`beforeStop`、`onFatal`、`emergency`）；装配 `src/server/start.ts`（`startServer({config, manifest?, plugins?, process?, signals?, stopInput?, clock?, onListening?, onRpcListening?, writeFatal?})`，`manifest` 缺省为产品清单 返回 `RunningServer`：`ready`、`stopped`（含退出码）、`url`、`rpcUrl`、`requestStop(source)`；退出码在停止结束后由启动结果、未处理异常与停止中的失败一次算出；RPC 端口监听失败或插件装配失败时写出致命诊断后抛 `ServerAssemblyError`）；内核 RPC 端口 `src/server/rpc/listener.ts`（`startRpcListener({host, port, router, admit, allowOrigin, reportError})` 返回 `RpcListener {url, port, stop()}`，升级的门与来源核对见下）与两端共用的套接字链路 `src/shared/rpc-socket.ts`（`createSocketLink(socket)`、`RPC_PATH`、`RPC_MAX_MESSAGE_BYTES`）；允许来源的计算 `loopbackOrigins(pageUrl)` 在 `src/server/config.ts`；后端插件装配 `src/server/plugins.ts`（`manifestServerPlugins(context)` 按本进程清单取工厂，清单有后端入口而无工厂时失败；向 `nbook.http` 传入按同一清单列出插件的引导接口与 `NBOOK_WEB_ROOT`）。项目（随 t54）：项目管理器 `src/server/projects/manager.ts`（`createProjectManager(options)` 返回 `ProjectManager`：`list`、`acquire(引用, 持有者, {generation?})`、`holds`、`running`、`stopAdmission`、`shutdownProblems`、路由回调 `bind`、`access`，宿主能力的 `provision`），身份与目录校验 `identity.ts`，登记表 `registry.ts`（`createProjectRegistry`），IPC 信封与链路 `ipc.ts`；`startServer` 的选项 `projectEntry`（缺省为产品入口：打包产物里与 `main.js` 同目录的 `project.js`，源码里是 `src/project/main.ts`）、`projectEnv`、`projectOutput`、`projectClock`，`RunningServer.projects`；项目宿主在 `src/project/`（`main.ts` 与 `development-main.ts` 两个入口只差清单，`process.ts` 的 `runProjectProcess`，`start.ts` 的 `startProject`，启动参数 `config.ts`，本地能力 `current-project.ts` 的 `currentProjectKey`，按清单装配 `plugins.ts`）；后端适配器 `startServerHost` 多了 `location` 选项，服务端与项目子进程共用。HTTP 准入与排空在 `src/plugins/http/server/admission.ts`，分发与 `http.routes` 接收在 `dispatch.ts`，贡献点合同在 `contracts.ts`，页面资源在 `static.ts`（`openStaticFiles(root)`），插件定义在 `plugin.ts`（`createHttpPlugin` 选项含 `hostRoutes`、`staticRoot`）。开发模式在 `src/server/dev/`：`main.ts`（入口）、`run.ts`（`runDev(...)`：会话与信号）、`supervisor.ts`（`createDevSupervisor({launch, clock, onEvent, debounceMs?})`：后端状态 `starting | running | restarting | waiting | stopping | stopped` 与代理前的门 `admit()`）、`backend-process.ts`（`spawnBackend`）、`frontend.ts`（Vite 中间件模式与自有 HTTP 服务）、`watch.ts`（监视根与后端文件判定）、`config.ts`。
- **关键不变量**：
  - 一个进程只有一个产品运行实例；进程信号、未处理异常监听与停止通道只由宿主挂接一次，停止结算后移除。
  - 启动失败之外的停止来源经 `ServerHost.requestStop` 汇合，只执行一次；进程级未处理异常先交 `onFatal` 记录，再由宿主以 `fatal:<kind>` 请求停止。`beforeStop`（HTTP 排空）先于内核停止，失败仍继续关闭并记入 `beforeStopError`。启动失败由内核自行关闭，宿主随之结算并移除监听。退出码按 75 > 1 > 0 取值，退出码在启动结果确定后才结算。
  - `nbook.http` 只依赖 `nbook.diagnostics`；就绪前请求等待，启动失败与排空期间返回 503，事件流经 `registerEventStream` 登记后不计入等待、排空开始即关闭。插件处理器每次请求经 `implementation()` 取得，入口停止后不再被调用。
  - RPC 监听先于插件装配（引导接口要告诉浏览器实际端口），运行实例之前只建了远程节点与路由，没有要关闭的插件资源。升级先过 HTTP 准入的门（与页面资源同一道门：就绪前等待，启动失败与排空开始后 503），再核对 `Origin`：顺序不能反，HTTP 端口为 0 时允许的来源要等 `nbook.http` 监听后才知道。
  - `beforeStop` 并行执行 HTTP 排空与 RPC 排空（路由先停止接纳再排空，两者各有 20 秒上限、用同一个注入时钟），任一未完成都记为停止步骤失败；内核关闭全部插件之后才关闭路由链路与 RPC 监听，启动失败时同样关闭。
  - 测试插件只经 `startServer({plugins})` 注入，产品清单与产品代码不含测试分支。
  - 项目（随 t54）：停止的同步段里先关项目管理器的接纳，再开始两路排空；项目管理器建在服务端运行实例上（子实例的停止阶段在内核关闭插件之前停完项目子进程），宿主能力 `projectsKey` 等项目管理器建好再交出（内核在建立运行实例的同步段里就开始启动激活）。项目子进程先把链路交给路由（带 `expect`）再起进程；没有被要求停止时 IPC 断开或进程结束即报告这一代结束，退出码等进程真正结束后写诊断；停止中被强制结束或以非 0 退出的子进程计入停止问题，退出码 1。项目子进程只认 SIGTERM，终端的 Ctrl+C 不让它自行退出；它的日志位置是 `<状态根>/logs/projects/<短名>/`。
- **合同测试**：项目（随 t54）`src/server/server-projects.test.ts`（同进程：绑定与共用代次、宽限期内重连与期满后 `project-gone`、崩溃、宽限期中不唤醒、停止开始后打开被拒与绑定中的租约释放；真实子进程：场景 14 的收口顺序与场景 15 的强制结束）、`src/server/projects/manager.test.ts`（真实项目子进程：打开、关闭与崩溃、启动与停止的收口、父实例停止）、`projects-capability.test.ts`、`registry.test.ts`，`config.test.ts` 的项目时限；`src/server/server.test.ts`（真实子进程：启动、标准输入与 SIGTERM 停止、在途请求、启动失败、关闭失败、未捕获异常、未处理的 Promise 拒绝、标准输入结束、非回环地址；同进程：排空超时、启动失败时等待就绪的请求得到 503、未处理异常汇合为一次停止且停止后监听全部移除、插件装配失败、页面目录缺少 index.html）、`src/server/config.test.ts`、`src/plugins/http/server/admission.test.ts`、`src/plugins/http/server/dispatch.test.ts`、`src/plugins/http/server/static.test.ts`；开发模式 `src/server/dev/supervisor.test.ts`（真实后端子进程：场景 7 的有序重启、去抖、启动失败不循环、运行中退出、门）、`src/server/dev/run.test.ts`（真实会话子进程：场景 8 的停止顺序、终端 Ctrl+C、第二个信号、页面端口被占用）、`src/server/dev/watch.test.ts`、`src/server/dev/config.test.ts`。RPC 端口：`src/server/rpc/listener.test.ts`（真实 Bun 监听与内核路由：来源、路径、门、消息上限、停止后拒绝连接）、`server.test.ts` 的 RPC 一组（同进程：两类允许来源与额外来源、在途远程请求时停止、RPC 排空超时、启动失败时等待中的升级得到 503、RPC 端口被占用；真实子进程：`RPC listening on` 与停止后端口关闭）、`config.test.ts`（RPC 端口与额外来源的解析与拒绝）、`src/server/dev/run.test.ts`（开发会话把页面来源传给后端、重启后经引导取得新端口）。
- **实际 smoke**：`bun run smoke:server`（先打包再运行场景 1、2、4、11、页面资源、RPC 握手 S6 与打包产物的项目绑定 S7），检查未执行时以非零退出；开发模式由 `e2e/dev.e2e.ts`（`bun run test:e2e`）以真实的 `bun run dev` 入口、本机 Chrome 运行场景 7、8，并核对页面直连 RPC 端口、后端重启后页面显示服务端已重启。

## 证据

- 批准目标：[可扩展应用平台设计](../../proposals/extensible-application-platform.md) P6 与 P11（2026-09-30 开发者同意生命周期部分按验证证据写入）；[ADR 0022](../../adr/0022-extensible-platform-and-plugin-trust.md) 第 2 条；v2 的宿主与开发模式见 [NeuroBook v2：并排重建应用](../../proposals/neuro-book-v2-rebuild.md) 方案第 4 节（2026-10-03 `accepted`）与 [ADR 0023](../../adr/0023-v2-frontend-backend-stack.md)。
- 验证依据：[G0 报告](../../../.agents/works/w00017-application-runtime-architecture/tasks/t27-platform-risk-gates/evidences/g0/REPORT.md)。
- 实现入口：[`main.ts`](../../../packages/neuro-book/src/server/main.ts)、[`start.ts`](../../../packages/neuro-book/src/server/start.ts)、[`host.ts`](../../../packages/neuro-book/src/server/host.ts)、[`http 插件`](../../../packages/neuro-book/src/plugins/http/server/plugin.ts)、开发模式 [`run.ts`](../../../packages/neuro-book/src/server/dev/run.ts) 与 [`supervisor.ts`](../../../packages/neuro-book/src/server/dev/supervisor.ts)
- 合同测试：[`server.test.ts`](../../../packages/neuro-book/src/server/server.test.ts)、[`server-projects.test.ts`](../../../packages/neuro-book/src/server/server-projects.test.ts)、[`manager.test.ts`](../../../packages/neuro-book/src/server/projects/manager.test.ts)、[`config.test.ts`](../../../packages/neuro-book/src/server/config.test.ts)、[`admission.test.ts`](../../../packages/neuro-book/src/plugins/http/server/admission.test.ts)、[`dispatch.test.ts`](../../../packages/neuro-book/src/plugins/http/server/dispatch.test.ts)、[`static.test.ts`](../../../packages/neuro-book/src/plugins/http/server/static.test.ts)、[`supervisor.test.ts`](../../../packages/neuro-book/src/server/dev/supervisor.test.ts)、[`run.test.ts`](../../../packages/neuro-book/src/server/dev/run.test.ts)
- Smoke：[`smoke-server.ts`](../../../packages/neuro-book/scripts/smoke-server.ts)（`bun run smoke:server`）、[`dev.e2e.ts`](../../../packages/neuro-book/e2e/dev.e2e.ts)（`bun run test:e2e`）、[`projects.e2e.ts`](../../../packages/neuro-book/e2e/projects.e2e.ts)
- 内核 RPC 端口与开发模式直连见 [t53](../../../.agents/works/w00017-application-runtime-architecture/tasks/t53-rpc-port-browser-connection/README.md)（2026-10-07），场景 12、13 与开发模式的直连已由上述合同测试、smoke 与 e2e 覆盖。
- 项目子进程、项目参数、停止序列的“封闭接纳”与“停止项目子进程”两步、场景 14–16：依据 [多实例运行时拓扑](../../proposals/multi-instance-runtime-topology.md) 第 2 节（2026-10-07 `accepted`）与开发者 2026-10-07 在 [t54 实施计划](../../../.agents/works/w00017-application-runtime-architecture/tasks/t54-project-child-process/plan.md) 中的确认，随 [t54](../../../.agents/works/w00017-application-runtime-architecture/tasks/t54-project-child-process/README.md) 实现，由上述合同测试、`smoke:server` 的 S7 与 `e2e/projects.e2e.ts` 覆盖。
- 实现与验证：旧应用阶段 1 见 w00017 [t34](../../../.agents/works/w00017-application-runtime-architecture/tasks/t34-builtin-service-plugins/README.md)、[t37](../../../.agents/works/w00017-application-runtime-architecture/tasks/t37-server-host-entry/README.md)、[t38](../../../.agents/works/w00017-application-runtime-architecture/tasks/t38-development-host/README.md)、[t40](../../../.agents/works/w00017-application-runtime-architecture/tasks/t40-phase1-closing/README.md)（2026-10-02 开发者批准晋升 `implemented`）；v2 后端宿主见 [t46](../../../.agents/works/w00017-application-runtime-architecture/tasks/t46-server-host/README.md)，开发模式与页面资源见 [t47](../../../.agents/works/w00017-application-runtime-architecture/tasks/t47-web-host-dev-supervisor/README.md)。
- 已知限制：
  - 租约失效（场景 5）随 Session Store 插件实现；退出码 76 随看门狗实现。
  - Windows 上未实测（含开发模式的 Ctrl+C 与文件监视）；POSIX 信号路径由 Linux 上的真实子进程测试覆盖。
  - RPC 链路不做发送背压：大量事件推送时未发出的消息在内存里堆积（本机回环下风险低）；鉴权上线前，不带 `Origin` 的本机进程都能连 RPC 端口，与未加载鉴权时的 HTTP 端口同等信任。
