# OMP 与服务端进程的隔离：调研与 Worker 方案

w00032 t09 决定 34 的落地稿：OMP 的 postmortem 在导入时装上进程级信号与异常处理，抢走服务端宿主的有序停止。本稿先列调研到的做法与证据，再写选定的 Worker 方案，交审查。原生插件的分发已由决定 33 定（`@oh-my-pi/*` 不打进 bundle，应用包清单依赖它们）。

## 问题与证据

- `@oh-my-pi/pi-utils` 的 `postmortem.ts` 在模块顶层、`Bun.isMainThread` 为真时注册 SIGINT、SIGTERM、SIGHUP、`uncaughtException`、`unhandledRejection` 与 `exit` 的处理：信号来时跑完 `postmortem.register` 登记的清理（最多 10 秒）就以 130、143、129 调 `exitProcess` 硬退出；未捕获的异常与 rejection 走 `exitAfterFatal`，同样硬退出。没有关闭的开关（查过全部 `process.env` 读取）。Worker 线程里只注册 `exit`。
- 服务端宿主（`packages/neuro-book/src/server/host.ts`）自己挂这几个事件：信号与未处理异常汇合成一次有序停止（排空、项目子进程先收口、按依赖逆序关闭），退出码由装配方决定。两套处理同时挂着时 postmortem 先退出进程。实测：`server-projects.test.ts` 场景 14、15 的服务端以 143、129 退出（期望 0）。
- 哪些导入会装上它（2026-11-01 在本机逐个导入、数 `process.listenerCount("SIGTERM")`）：`@oh-my-pi/pi-ai`、`pi-ai/auth-retry`、`pi-catalog`、`pi-catalog/build` 会装；`pi-ai/error/flags`、`pi-catalog/compat/auth` 不装。nb-harness 的 `./kernel` 入口会装（经 `model/omp.ts`、`model/redact.ts`、`model/process.ts`），`./kernel/contracts` 不装。
- OMP 自己只经 `postmortem.register` 登记清理（`pi-ai` 的 auth-broker 快照缓存、观测用量、OAuth 刷新），不主动调 `fatal`、`quit`、`exitProcess`。

## 调研到的做法

| 做法 | 怎么做 | 代价与隐患 |
|---|---|---|
| A. 导入后摘掉监听 | 服务端入口的第一批导入里先导入 OMP，比对导入前后的 `process.listeners(事件)`，摘掉新增的；宿主停止时调 `postmortem.cleanup()` 跑 OMP 登记的清理 | 改动最小。依赖 postmortem“导入时在 `process` 上注册”这个内部行为：OMP 改成首次使用时才注册，处理就悄悄回来，只能靠场景测试发现；同一进程里任何晚加载的 OMP 模块（另一份版本）都会再装一次 |
| B. OMP 放进 Worker 线程 | 所有导入 OMP 的代码只在一个 Worker 里运行，主线程经消息调用 | 见下文。隔离完整，不依赖 OMP 内部行为；要把 nb-harness 拆成“主线程可导入、不碰 OMP”与“Worker 侧”两半，模型调用、目录、凭据走消息 |
| C. OMP 放进子进程 | 同 B，换成受管子进程 | 隔离最强（OMP 崩溃不带走服务端），但跨进程开销更大；终端的 Ctrl+C 发给整个进程组，子进程里的 postmortem 会以 130 先退出，要另开进程组；流式输出要走 IPC |
| D. 给 OMP 上游加开关 | 提议例如一个全局标记或环境变量让 postmortem 不装进程级处理 | 长期最好，时间不由我们定；可与 A 或 B 并行提 |
| E. 运行时改写模块 | `Bun.plugin` 在加载 `postmortem.ts` 时改写源码 | 比 A 更脆，否决 |

结论：没有比 B 更好且不依赖 OMP 内部行为的做法。A 便宜但脆；C 的隔离 B 已够用（本问题是进程级处理，不是崩溃隔离）。按决定 34 选 B，并建议另向 OMP 上游提 D。

## Worker 方案

### 边界

- **Worker（“模型线程”）拥有全部 OMP 运行时导入**：内置目录、`/models` 发现、`buildModel`、凭据库（OMP `AuthStorage`）、`streamSimple` 调用。
- **主线程不导入任何会装上 postmortem 的模块**：nb-harness 内核（会话、循环、日志、视图）与 neuro-book 的宿主、插件只导入不碰 OMP 运行时的模块；类型导入不受限。
- 守门：nb-harness 加架构测试，主线程入口（`./kernel`、`./models` 的客户端部分）的模块图里没有 `@oh-my-pi/*` 的运行时导入；neuro-book 加真实进程测试，服务端启动并用过模型服务后，`process` 上 SIGTERM、SIGHUP、SIGINT、`uncaughtException`、`unhandledRejection` 的监听只有宿主自己的（场景 14、15 本身也守着）。

### nb-harness 的拆分

- `./kernel` 入口去掉 `ompCall`、`ompModelInfo`（移到 Worker 侧）与 `onProcessInterrupt`、`onProcessTermination`（移到新子路径 `./process`，nb-story 的命令行用；它跑在自己的进程里，仍要和 postmortem 共处）。`model/redact.ts` 不再从 `pi-ai/auth-retry` 取 `NO_AUTH_SENTINEL`：在 Worker 侧把无认证请求换成 OMP 要的哨兵值，主线程不需要知道它。`model/classify.ts` 只用 `pi-ai/error/flags`（不装 postmortem），留在原处、随 Worker 侧使用。
- `./models` 拆成两半：
  - **客户端**（主线程可导入）：类型、`env:` 帮助函数、可序列化的目标描述（`ModelTarget`、`ProviderTarget`，已经是纯数据）、`createModelHost(options)` 返回的句柄：`catalog()`、`discover(target)`、`credentials` 的读写、`call(target, request, signal, onDelta)`。全部异步。
  - **Worker 侧**（新子路径 `./models/worker`，Worker 入口导入它）：现在的 `catalog.ts`、`credentials.ts`、`target.ts` 里碰 OMP 的部分，以及 `ompCall`。
- 模型端口的形状不变（`ModelPort.resolve` 同步交回 `info` 与 `call`）：`info` 由主线程从目录快照算出（目录是纯数据，Worker 启动时取一次、目录或设置变了重取），`call` 把请求发给 Worker。

### 消息协议

- 每条请求带 `id` 与 `op`；回复 `{id, ok, value}` 或 `{id, ok: false, error: {code, message}}`，错误按码分支，不按文字。
- `call`：主线程发 `{id, op: "call", target, request}`，Worker 边收边发 `{id, delta}`，结束发结果；主线程的 `signal` 中止时发 `{op: "abort", id}`，Worker 中止对应的 OMP 请求并照常以中止结算。`ModelRequest`、`ModelDelta`、`ModelResponse` 都是纯数据，可结构化克隆；函数（例如异步取密钥）不过线：密钥在 Worker 里按目标描述的 `KeyAccess` 从凭据库或启动环境快照取。
- 启动环境快照（`startupEnvKey`）在创建 Worker 时经 `workerData` 交过去，Worker 不读自己的 `process.env`。

### 寿命

- `nbook.models` 服务端入口激活时创建 Worker（模型服务启动要目录），停用时先让在途请求以“模型线程已停止”失败、再 `terminate()`。
- Worker 自己死掉（未捕获的异常或 rejection 会关掉 Worker，实测主线程不受影响）：在途请求以同一个失败码结算，记一条诊断；下一次请求重建，连续失败退避。模型调用上这个失败归为可重试的错误种类（具体映射写进 Spec）。
- 实测数据（2026-11-01，本机）：Worker 起来并导入 `pi-catalog`、`pi-ai` 约 200 毫秒；同一进程两个 Worker 各加载一次原生插件可行；主线程收到 SIGTERM 后按自己的有序停止退出、退出码 0。

### 构建与分发

- 决定 33：`@oh-my-pi/*` 作外部模块，服务端产物运行时从 `node_modules` 解析。
- Worker 入口是单独的构建产物，文件名固定（例如 `server/model-worker.js`）。Bun 1.4.4 的 `bun build` 不改写 `new Worker(new URL("./x.ts", import.meta.url))` 里的路径（实测原样保留 `.ts`），所以宿主按自己是源码还是产物选文件名，选不到时启动即失败并说明。
- 应用包检查（`scripts/pack-app.ts`）现在拒绝 `new Worker(` 文本：改成只允许这一处、且产物里必须有对应文件。

### 影响到的 Task

- t09：模型服务的服务端改为经句柄调用（目录、发现、凭据、模型调用都变异步）。
- t10（harness 接入）：会话循环留在主线程，只有模型调用过线；工具照常在主线程执行。项目子进程里若也要跑会话，它另起自己的模型线程或经服务端的模型端口调用，在 t10 定。
- nb-story：不受影响（自己的命令行进程，继续用 `./process`）。

## 留给审查的问题

1. 主线程“同步 `resolve`、异步 `call`”与目录快照的一致性：目录在 Worker 里刷新、主线程快照还没更新时的解析结果。
2. 跨线程流式调用的背压：增量很多时 `postMessage` 的排队与内存。
3. Worker 死掉与重建期间会话的行为；中止与 Worker 退出同时发生。
4. 凭据库（SQLite）只在 Worker 里打开，主线程与命令行（`nbook` 子命令）是否还有别的读写者。
5. 测试：依赖用真的（真实 Worker、真实 OMP），故障注入怎么做而不在产品代码里加测试专用分支。
