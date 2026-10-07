# t54 实施计划：K3 项目子进程、项目管理与客户端绑定

## Context

- **为什么做**：K1（[t52](../t52-kernel-instances-remote/README.md)）在内核实现了子实例与租约、远程服务路由与 `{project}` 目标的租约核对；K2（[t53](../t53-rpc-port-browser-connection/README.md)）接上了服务端 RPC 端口与浏览器连接，但只有**未绑定项目**的客户端。K3 让“项目”真正跑起来：服务端宿主管理项目（身份、登记表、租约与宽限期、崩溃），每个打开的项目一个子进程、里面一个 `location: "project"` 的内核实例，浏览器窗口按地址栏绑定一个项目代次，断线重连在宽限期内恢复原绑定，超过宽限期要求重新加载。
- **依据**：[多实例运行时拓扑](../../../../../docs/proposals/multi-instance-runtime-topology.md) 第 1–4、7、8 节与第 11 节 K3 行（2026-10-07 `accepted`）、[ADR 0024](../../../../../docs/adr/0024-multi-instance-runtime-topology.md)；Spec `runtime/application.md`（子实例与租约、本地能力，`implemented`）、`runtime/services.md`（按调用方门面）、`runtime/plugin-channel.md`、`runtime/server-host.md`、`runtime/browser-host.md`、`workspace/resources.md`。
- **拓扑稿已定的**：一个打开的项目一个子进程，不用 worker；内核只提供通用子实例机制，“项目”由服务端宿主定义；项目实例状态 `creating → available → idle-grace → stopping → terminated`；客户端一生只绑定一个项目代次或不绑定，项目写在地址栏 `/?project=<短名或 id>`，切换项目即重新加载；宽限期内重连恢复原绑定，超过宽限期拒绝恢复、客户端重启，绝不把旧绑定改投新代次；外部请求不得隐式打开项目；服务端停止先封闭接纳、再排空、再停项目子实例、最后停服务端实例与 RPC 端口。
- **开发者 2026-10-07 确认的**（本计划讨论中）：
  1. 进程间通信用 Bun IPC（实测见下表，判据见第 2 节）。
  2. 宽限期缺省 5 分钟（与旧应用的 `PROJECT_GRACE_MS` 相同，可经 `NBOOK_PROJECT_GRACE_MS` 调整）；项目子进程崩溃后不自动重启。
  3. 项目身份写进项目目录 `.nbook/project.json`；登记表放在状态根；短名由目录名生成、登记后不变。
  4. **不做防双开的锁**：拓扑稿第 2 节的“防止两个服务端进程同时打开同一项目的锁”与 `proper-lockfile` 是旧应用沿下来的设计。它保护的是项目实例独占的项目级持久数据（项目 SQLite、Storage 的 project 分区、带写入来源的文件监视），K3 还没有这类数据，锁什么也保护不了。推迟到出现项目级持久数据时（K4 或 History）再定，届时优先用数据本身的机制（SQLite 的锁、库里的拥有者记录），不另加目录锁文件。S0 同步修订拓扑稿。
  5. **项目管理由服务端宿主实现，并以宿主本地能力（`ApplicationManifest.capabilities`）直接提供服务 `projectsKey` 给服务端插件**；`nbook.projects` 只做项目管理的界面与给客户端的远程入口，不管生命周期；当前项目的身份随握手结果带回窗口，不另设项目入口的信息服务。
  6. **远程服务合同声明提供方在哪种位置**（`provider`），`.at()` 能由合同推出时可以省略，目标与合同不符时类型检查与运行时都拒绝。
  7. 没有租约的访问：服务端插件可以不取租约调用处于 `available` 的项目；项目处于宽限期或没在运行时一律 `denied`，不唤醒、不取消宽限期。
  8. “打开项目”列表带项目目录路径（omp 设计审查第 3 条的取舍）：项目目录是用户自己登记的位置，用来区分同名目录。`runtime.browser-host` 与 `workspace/resources.md` 的“浏览器不获得服务端路径”改为指状态根、安装目录等服务端内部路径；第三方浏览器插件接入时，随拓扑稿待定项 3 收紧这个服务的调用方。
- **进程间通信的实测**（2026-10-07，Bun 1.4.2，本机 Linux，同时有其它测试在跑）：

  | 机制 | 子进程就绪 | 空子进程 RSS | 小消息往返 p50 / p99 | 100 KB 往返 p50 / p99 | SIGKILL 后父进程发现 |
  |---|---|---|---|---|---|
  | Bun IPC，`serialization: "json"` | 26 ms | 30 MB | 0.025 / 2.9 ms | 0.31 / 3.1 ms | 5 ms（`onDisconnect`） |
  | Bun IPC，`"advanced"` | 14 ms | 31 MB | 0.037 / 2.9 ms | 0.22 / 31 ms | 7 ms |
  | 子进程连回父进程的回环 WebSocket | 25 ms | 33 MB | 0.042 / 3.2 ms | 0.26 / 1.1 ms | 6 ms |

  三者性能与崩溃发现时间相近，选型看非性能判据（第 2 节）。数字只是空子进程的下限；带内核与插件的真实项目子进程在 S4 实测并写入 Spec。
- **工作方式**：worktree `.worktree/w00017-runtime-foundation` 逐片提交，只暂存本片文件；测试用真实内核实例、真实子进程、真实 Bun WebSocket 与本机 Chrome，不用 mock、spy、假计时器、固定等待，宽限期与截止用注入时钟；起子进程的测试在用例失败时也收口（`docs/testing/README.md` 的“子进程要收口”）；交付前对验收映射的每条判据做变异检查；主 Agent 编码，最后 omp（默认模型）只读审查。不修改 `packages/neuro-book-legacy`。

## 关键设计

### 1. 项目身份与登记表（宿主 `packages/neuro-book/src/server/projects/`）

- **项目身份**（`identity.ts`）：项目目录下 `.nbook/project.json`，内容 `{schema: 1, id: "<uuid>"}`。登记一个目录时若没有就创建（含 `.nbook/` 目录）；有则读取并校验。身份与路径分离：目录移动后再登记，按 id 认出是同一项目。
- **目录校验**：绝对路径（相对路径按服务端工作目录解析后再校验）、存在、是目录、可读写；取真实路径（`realpath`）登记；不接受状态根内部的目录。
- **登记表**（`registry.ts`）：`<状态根>/projects.json`，`{schema: 1, projects: [{id, name, path}]}`。写入用临时文件加改名，进程内串行。`name` 是短名：取目录名，转小写、只留 `[a-z0-9-]`、合并连续的 `-`，空则用 `project`，与已登记的重名时加 `-2`、`-3`；登记后不变。按短名或 id 解析项目；登记时 id 已在表中则更新路径（项目移动）。
- **不加锁**（确认第 4 项）：同一个服务端进程里，两个窗口本来就共用同一个项目实例；两个服务端进程同时打开同一目录在 K3 不拦，记入已知限制。

### 2. 项目子进程与进程间链路（宿主 `src/server/projects/` 与新的项目宿主 `src/project/`）

- **选 Bun IPC**（`Bun.spawn({ipc, serialization: "json"})`，子进程用 `process.send`、`process.on("message")`）。判据：
  - 不开端口、不需要令牌：只有父进程能连到子进程；回环 WebSocket 方案要让 RPC 端口接受“项目”角色的连接，就得另加令牌防本机其它进程冒充。
  - 链路寿命与进程绑定：子进程退出即 `onDisconnect`，正好对应“意外退出 → 这一代结束”。退出码要等 `proc.exited` 结算后才可靠（omp 实测：`onDisconnect` 回调里 `exitCode` 仍是 null，SIGKILL 时只有 `signalCode`）；`onDisconnect` 之后、`exited` 之前再 `send` 会抛错。
  - 标准输出与标准错误留给日志，逐行转发到服务端的输出（加 `[project <短名>#<代次>]` 前缀）。
  - 帧仍用 K2 的 JSON 编解码，IPC 只搬字符串：三条链路（进程内、WebSocket、IPC）的编码语义一致，不因为 IPC 能传 `Date`、`Map` 就放宽。
  - 代价：两端都必须是 Bun；Windows 上 Bun IPC 未实测（记入已知限制）。
- **IPC 信封**（`src/server/projects/ipc-envelope.ts`，父子共用）：`{t: "frame", d: <帧的 JSON 文本>}`、`{t: "started", status: "available" | "failed", detail}`、`{t: "stop"}`。链路适配复用 `src/shared/rpc-socket.ts` 的 `createSocketLink`（发一条文本、关闭；收到的帧与断开由宿主转入），控制信封不进链路。
- **项目宿主入口**（`src/project/main.ts`，生产打包为 `dist/server/project.js`，与 `dist/server/main.js` 同一次 `build:server`）：
  - 从环境变量读项目 id、短名、代次、真实路径、状态根；建诊断存储（日志写 `<状态根>/logs/project-<短名>-current.jsonl`）。
  - 建远程节点 `{id: "project:<id>#<代次>", kind: "project", role: "project", project: {id, generation}, client: null}`，经 IPC 链路连父进程的路由。
  - 建运行实例：清单里有 `project` 运行位置的入口；本地能力 `currentProjectKey` 向项目实例里的插件提供 `{id, name, generation, root}`（真实路径只在项目子进程与服务端里，不发给浏览器）。启动结果用 `started` 信封报给父进程。
  - 收到 `stop` 或 IPC 断开（父进程已不在）即按停止序列停止并退出：0 正常，1 失败。开发入口另有 `src/project/development-main.ts`（加开发清单，目前没有项目入口，与服务端入口对称）。
- **路由接受项目链路**（内核 `router.ts`）：`router.accept(link, {expect?: InstanceDescriptor})`：给了 `expect` 时 hello 的实例描述必须与之一致，否则以 `role` 拒绝。宿主为每个子进程给出它应有的身份，链路上不会出现别的项目或别的代次。
- **项目管理器**（`src/server/projects/manager.ts`）：在服务端运行实例上 `createChildInstances(application, {create, stop, graceMs, stopDeadlineMs, clock})`，键是项目 id。
  - `create(id, generation)`：起子进程 → 把 IPC 链路交给路由（带 `expect`）→ 等 `started`。等待有截止 `NBOOK_PROJECT_START_MS`（缺省 30 秒）。以下都按创建失败收口，抛错即 `create-failed`：截止到时 `SIGKILL` 子进程；等待期间 IPC 断开（子进程启动中退出）；子进程报 `started: failed`（实例启动失败）时发 `stop` 信封、等它退出，`NBOOK_PROJECT_STOP_MS` 到时 `SIGKILL`。项目宿主在启动序列的最后（运行实例可用之后）才发 `started`，不报半就绪。
  - `stop(handle, {signal})`：发 `stop` 信封，等 `proc.exited`；`signal` 到时 `SIGKILL` 并返回 `forced`。停止过程中的 `onDisconnect` 是预期的，不报告为意外退出。子进程以非 0 退出码结束（收口时出错）时照常返回 `closed`，同时写诊断 `project.stop.incomplete`（带退出码），不把它当作正常关闭而无痕。
  - 子进程在没有被要求停止时 IPC 断开：立即报告 `children.exited(id, generation)`，这一代结束、租约失效；退出码在 `proc.exited` 结算后写进诊断。不自动重启（确认第 2 项）。
- **服务端停止顺序**（拓扑稿第 2 节）：
  1. `beforeStop` 一开始同步封闭三处接纳：路由停止接纳（K2，只拒客户端、不拒项目成员）、HTTP 准入、项目管理器的接纳。K1 的子实例接纳要到内核 `stop()` 开始才关闭，而 `beforeStop` 的排空在那之前，最长 20 秒；所以项目管理器自己加一道门，`stopAdmission()` 之后的 `acquire` 与绑定都以 `admission-closed` 拒绝，不必等内核。
  2. HTTP 与 RPC 并行排空（K2）。
  3. 内核停止：`createChildInstances` 的停止阶段先停全部项目子进程并等真实退出（每个的截止为 `NBOOK_PROJECT_STOP_MS`，缺省 20 秒，到时强制结束并记为外部终止），再按依赖逆序关服务端插件。
  4. 关闭路由链路与 RPC 监听（K2）。

### 3. 客户端绑定与重连（内核 `protocol.ts`、`router.ts`、`node.ts`）

- **握手字段**（wire 版本升为 2）：
  - `hello` 增加 `bind: {project: string} | {project: string; generation: number} | null`：首次连接按短名或 id 请求绑定；重连带上已绑定的 id 与代次。`instance.project` 对客户端恒为 `null`，绑定由服务端决定。
  - `welcome` 增加 `binding: {id, name, generation} | null`。
  - 新的拒绝原因：`project-unavailable`（不存在、未登记、创建失败、服务端正在停止，带说明）、`project-gone`（重连时原代次已结束）。
- **路由**：选项 `bindProject(request, clientInstanceId) → Promise<{ok: true, binding, release} | {ok: false, reason, message}>` 由宿主给出。路由把绑定写进该成员的实例描述，`project` 目标与 `{project}` 访问核对都按它；成员链路关闭时调用 `release`，最后一个使用者离开即进入宽限期。项目管理器的实现：
  - 首次（`bind: {project: 短名或 id}`）：解析后 `acquire(id, 持有者)`。
  - 重连（`bind: {project: id, generation}`）：`acquire(id, 持有者, {generation})`，只在这一代仍是 `available` 或 `idle-grace` 时取得，否则 `project-gone`。内核 `ChildInstances.acquire` 为此加 `generation` 选项（K1 的 `acquire` 只按键取当前代次，原代次正在停止时会等它结束后创建新代次，用来重连就会把旧绑定改投新代次）：指定代次不是当前代次、或已在 `stopping`、`terminated`，以新原因 `generation-gone` 拒绝，不等待、不创建。
  - `acquire` 结算后、登记成员之前再查一次项目管理器的门：门已关闭（服务端在绑定期间开始停止）就立即释放租约，以 `project-unavailable`（说明服务端正在停止）拒绝。
- **重连的“同一实例”判定**：K2 的 `sameInstance` 逐项比较实例描述，已登记成员的描述带绑定、新 hello 的 `instance.project` 恒为 `null`，照搬会把每个绑定窗口的重连都当 `duplicate-instance`。改为：`kind`、`role`、`client` 三项相同，且绑定一致（已登记成员没有绑定时 `bind` 为 `null`；有绑定时 `bind` 必须是同一 `{id, generation}`）。
  - 绑定是异步的（首次打开要等子进程创建，可能几秒）：hello 的处理在绑定结果出来之前不登记成员；这期间链路关闭则一拿到租约就释放；客户端在 welcome 之前不会发业务帧，收到的按协议违规处理（K2 规则不变）。
  - 同一实例重连接管旧链路（K2）时，新链路先取得租约、再关闭旧链路释放旧租约，使用者计数不会落到 0，不会误入宽限期。
- **节点**：`createRemoteNode({instance, bind?})`；首次 welcome 记下绑定（节点的实例描述随之带上项目代次），之后重连都带 `{id, generation}`。重连得到 `project-gone` 与得到不同 `boot` 一样进入终态：远程订阅以 `project-gone` 结束、不重建，之后调用为 `unavailable`，连接结果为 `project-gone`。第二道防线：重连的 welcome 里绑定的 id 或代次与已记下的不同，节点同样按 `project-gone` 进入终态并关闭链路，不接受改投。
- **绑定的项目代次结束时**（宽限期满、崩溃、服务端停止）：路由关闭绑定它的客户端链路；客户端重连得到 `project-gone`，窗口转入“项目已关闭”页。

### 4. `{project}` 目标的访问与租约（内核 `router.ts`、宿主项目管理器）

- 租约是“正在用这个项目”的登记：持有期间项目不会因宽限期满而停止；`{project}` 只能到达已经在运行的项目，访问本身不打开项目。
- `{project}` 目标的核对由宿主回调 `projectAccess(caller, projectId, generation) → "allowed" | "denied"` 决定（替换 K1 的 `holdsProjectLease`）。项目管理器的实现：
  - 调用方持有这一代的租约：放行。租约持有者由内核函数 `leaseHolderOf(调用方身份)` 编码为“实例 + 插件 + 入口 + 激活代次”，`projectsKey` 取得租约与路由核对 `{project}` 都用这一个函数，插件无法冒用别人的租约。`via`（委托的代理）不参与编码：租约记在发起它的入口这次激活名下，与经不经代理无关，入口 A 经代理取得的租约，A 直接调用也能用，代理 P 用 A 的身份转发时同样按 A 核对。
  - 没有租约、调用方是服务端实例上的插件、这一代处于 `available`：放行（确认第 7 项，文生图走查的通知）。
  - 其余 `denied`：处于 `idle-grace` 的项目对没有租约的调用方不可达，调用本身不取得租约，因此不会取消宽限期。
- 浏览器窗口只持有握手时为它取得的那个项目的租约，平时用 `.at("project")`；用 `{project: 别的项目}` 得到 `denied`。项目实例之间第一版不能互相取租约。

### 5. 合同声明提供方的位置（内核 `contract.ts`、`node.ts`，插件宿主 `host.ts`）

- `defineRemoteService({..., provider: "server" | "project" | "client" | "any"})`：这份合同由哪种位置的实例提供。`client` 指浏览器、TUI 这类客户端实例；`any` 指每个实例各有一份（例如命令系统的跨实例执行）。
- 调用写法（类型上按 `provider` 区分）：
  - `provider: "server"`：`context.remote.use(合同).方法(...)`，`.at()` 可省略（等于 `.at("server")`），写别的目标是类型错误。
  - `provider: "project"`：省略 `.at()` 等于 `.at("project")`（本客户端绑定的项目）；服务端插件这类没有绑定的调用方要写 `.at({project: id})`。
  - `provider: "client"`、`"any"`：必须写 `.at(...)` 指明哪个实例。
- 运行时同样核对：目标与 `provider` 不符的调用在未派发阶段以 `invalid-input` 失败（说明“目标与合同的提供方位置不符”），不发出请求。
- 提供方一侧：入口激活产出的远程提供项，合同的 `provider` 与本实例的角色不符（例如 `provider: "server"` 的合同出现在项目实例的入口里）是输出阶段失败 `remote-location-mismatch`，与 K1 的 `missing-remote`、`undeclared-remote` 在插件宿主的同一处输出核对（`host.ts`）。插件宿主现在只知道运行位置字符串、不知道拓扑角色；`RemoteHostBinding` 加只读的 `instance`（节点的实例描述），插件宿主从它取角色（`hub` 对应 `server`、`project` 对应 `project`、`client` 对应 `client`）。没有配置远程节点的实例不做这项核对（它也没有远程提供项可用）。
- 现有合同按此补字段：内核测试的 `echo` 合同为 `any`；测试探针 `test.remote-probe/probe` 为 `server`，K3 另加 `provider: "project"` 的项目探针合同。

### 6. 宿主能力 `projectsKey`（宿主 `src/server/projects/`，键与类型在 `src/shared/projects.ts`）

- 服务端宿主把项目管理器包成本地能力，放进服务端清单的 `capabilities`：插件在依赖里声明 `projectsKey` 就能用，与依赖插件提供的服务一样。服务键由宿主在装配时交给需要它的插件工厂（沿用包里的约定）。
- 以按调用方门面提供（`perConsumer`）：每个调用方入口的每次激活各得一个门面，门面知道调用方身份。核实：`services/composition.ts` 的绑定对本地能力与插件提供项走同一条路径，按调用方门面对两者都生效，但还没有测试，K3 补上。
- 操作：
  - `list()`：已登记项目，每项带运行状态（未运行、运行中的代次、宽限期中）；
  - `register(path)`：校验并登记目录，返回 `{id, name}`；
  - `resolve(短名或 id)`；
  - `acquire(短名或 id) → {status: "acquired", lease: {id, name, generation, revoked, release()}} | {status: "rejected", reason, detail}`：租约记在调用方这次激活名下，持有者就是门面收到的调用方身份；调用方入口停止时门面释放，未释放的租约一并释放。
- 使用者：`nbook.projects` 的服务端入口；以后的 Agent harness（会话取得项目租约、`projects://`）。

### 7. 产品插件 `nbook.projects`（界面与客户端的远程入口）

- **服务端入口**：依赖 `projectsKey`，把“列出项目”“登记目录”包成远程服务 `nbook.projects/projects`（`provider: "server"`，`callers: ["browser", "tui"]`），供浏览器与以后的 TUI 调用。列表含短名、项目目录路径与运行状态（确认第 8 项）。
- **浏览器入口**：命令 `nbook.projects.open`（“打开项目”）：经命令面板的快速输入列出已登记项目（短名、路径、是否运行），选中即整页导航到 `/?project=<短名>`；输入目录路径并确认则先登记再导航。窗口绑定了项目时在工作台显示当前项目短名（从窗口的绑定结果取，不另调服务）。
- 以后的书架页、最近打开、新建项目、移除登记、重命名都归这个插件；K3 只做上面两件。

### 8. 浏览器绑定（宿主 `src/web/host/`）

- 窗口从地址栏读 `project` 参数（没有则不绑定，行为同 K2），交给节点的 `bind`；`ready` 状态增加 `project: {id, name, generation} | null`（来自 welcome 的绑定结果）。工作台经宿主提供给浏览器插件的本地能力读取当前项目，供 `nbook.projects` 显示短名。
- 首连失败：`project-unavailable` 为新的宿主页“无法打开项目”（附原因，可重试，另给“不打开项目”链接回到 `/`）；连接会话把 `project-gone` 当终态，窗口转入“项目已关闭”页（只给刷新与回到 `/`）。
- 重连规则不变（退避、每次重取引导）；宽限期内重连恢复原绑定，订阅重建并 `onResync`。

### 9. 真实子进程与浏览器验收用的探针

- 测试插件 `test.remote-probe` 增加项目入口：提供项目探针合同（`provider: "project"`，`echo` 返回项目实例身份与 `currentProjectKey` 的 id、代次），控制路由增加“让项目子进程崩溃”（项目入口调用 `process.exit(70)`，只在测试插件里）与“不持租约通知项目”（服务端入口经 `{project: id}` 调用项目探针，供宽限期不唤醒的验收）。
- 宿主测试入口（`src/server/testing/fixture-entry.ts`）与项目宿主的测试入口（`src/project/testing/fixture-entry.ts`）按 `NBOOK_TEST_PLUGINS` 装配测试插件；宽限期与停止截止经启动参数 `NBOOK_PROJECT_GRACE_MS`、`NBOOK_PROJECT_STOP_MS` 设置，测试用短值，不是测试分支。

## Spec 与文档改动（S0）

| 文档 | 改什么 |
|---|---|
| 新 `docs/specs/runtime/projects.md`（`runtime.projects`，`planned`） | 项目身份与 `.nbook/project.json`、登记表与短名、项目实例状态表在宿主侧的含义（创建、宽限期、崩溃、停止）、项目子进程宿主与 IPC 链路、`currentProjectKey`、宿主能力 `projectsKey` 与租约归属、`nbook.projects` 的远程服务与命令、`{project}` 访问规则、不加锁的取舍与已知限制、实测的子进程启动时间与内存 |
| `docs/specs/runtime/plugin-channel.md` | wire 2：`hello.bind`、`welcome.binding`、`project-unavailable`、`project-gone`；绑定代次结束时关闭客户端链路；`router.accept` 的 `expect`；`{project}` 核对改为宿主的访问回调；合同的 `provider` 与 `.at()` 的省略、不符时的失败；进程间链路一节 |
| `docs/specs/runtime/plugins.md` | 远程提供项的 `provider` 与实例角色不符为 `remote-location-mismatch`；角色来自远程节点 |
| `docs/specs/runtime/server-host.md` | 启动参数 `NBOOK_PROJECT_GRACE_MS`、`NBOOK_PROJECT_START_MS`、`NBOOK_PROJECT_STOP_MS`；项目子进程启动失败、启动超时、停止时非 0 退出的收口与诊断；本地能力 `projectsKey`；停止序列加“封闭项目接纳”“停止项目子进程并等退出”；项目子进程的输出转发；打包多一个入口；验收场景 |
| `docs/specs/runtime/browser-host.md` | `/?project=` 绑定；`ready` 带项目；“无法打开项目”“项目已关闭”宿主页；场景；安全段“浏览器不获得服务端路径”改为指状态根、安装目录等内部路径，用户登记的项目目录路径可以显示给用户 |
| `docs/specs/runtime/application.md` | 子实例的 `acquire` 增加 `generation` 选项与拒绝原因 `generation-gone`（新条目标“随 t54 实现”）；实现合同补：`project` 位置的运行实例由项目宿主建立，本地能力可用按调用方门面 |
| `docs/specs/workspace/resources.md` | `project://` 由客户端绑定的项目实例提供，不再依赖 `nbook.project` 浏览器入口；增加 `projects://`（登记表，供 Agent，随 nb-harness 实现）；“不向浏览器暴露服务端绝对路径”同样改为指内部路径。只改合同文字，提供者随第 6 步 Files 实现 |
| `docs/proposals/multi-instance-runtime-topology.md` | 第 2 节去掉防双开的锁（推迟到出现项目级持久数据时）；第 4 节目标写法补“合同声明提供方位置、`.at()` 可省略”；第 8 节项目管理改为宿主能力 `projectsKey` 加 `nbook.projects` 的界面与远程入口；决策记录加 2026-10-07 这几条 |
| `packages/neuro-book/AGENTS.md` | 目录约定加 `src/project/`（项目子进程宿主） |

## 切片

| 片 | 对应设计 | 提交边界 | 自跑验证 |
|---|---|---|---|
| S0 | Spec 改动表 | 新 Spec、7 份文档修订、README 注册表、包 AGENTS | `bun run docs:check`、`bun run governance:check` |
| S1 | 第 5 节 | 合同 `provider`、`.at()` 省略与核对、`remote-location-mismatch` | `bun run --cwd packages/nb-runtime typecheck`、`bun run --cwd packages/nb-runtime test`、`bun run --cwd packages/neuro-book typecheck` |
| S2 | 第 3、4 节内核部分 | wire 2 握手字段、绑定与 `project-gone`、重连的同一实例判定、节点核对绑定、`accept` 的 `expect`、访问回调与 `leaseHolderOf`、`ChildInstances.acquire` 的 `generation` 选项；本地能力的按调用方门面补测试 | 同 S1 |
| S3 | 第 1 节 | 身份、登记表 | 同 S1，另 `bun run --cwd packages/neuro-book test:bun` |
| S4 | 第 2 节 | 项目宿主入口、IPC 信封与链路、项目管理器、停止顺序、打包多一个入口；实测启动时间与内存 | 同 S3，另 `bun run --cwd packages/neuro-book build`（含 `check:dist`） |
| S5 | 第 3、4、6 节宿主部分 | 路由的绑定回调与访问回调接到项目管理器；绑定代次结束时关客户端链路；宿主能力 `projectsKey` | 同 S3 |
| S6 | 第 7 节 | `nbook.projects` 的服务端与浏览器入口 | 同 S3，另 `bun run --cwd packages/neuro-book test:vitest` |
| S7 | 第 8 节 | 窗口绑定、宿主页 | 同 S6 |
| S8 | 第 9 节 | 探针的项目入口、e2e | `bun run --cwd packages/neuro-book test:e2e` |
| S9 | — | Spec 实现合同与证据、Task 证据、omp 审查与修正 | `bun run test:affected --typecheck --since <计划提交>`、`bun run --cwd packages/neuro-book smoke:server`、`docs:check`、`governance:check` |

## 验收映射

| 行为（拓扑稿 K3 行在前） | 测试 |
|---|---|
| 打开：窗口按 `/?project=` 绑定，项目子进程创建、窗口 ready 带项目代次 | `src/server/projects/manager.test.ts`（真实子进程）、`window.test.ts` 增补、`e2e/projects.e2e.ts`（新） |
| 两窗口共用同一项目代次，各自的实例与订阅独立 | `window.test.ts` 增补、`e2e/projects.e2e.ts` |
| 宽限期内重连恢复原绑定：同一代次、订阅 `onResync` | 内核 `routing.test.ts` 增补（注入时钟）、`window.test.ts`（TCP 转发掐断）、e2e（`routeWebSocket`） |
| 超过宽限期重连：`project-gone`，窗口转入“项目已关闭”，不改投新代次 | 内核 `routing.test.ts`、`window.test.ts`、e2e |
| 关闭后子进程真实退出，再打开得到新代次 | `manager.test.ts`（注入时钟推过宽限期，看子进程退出码） |
| 崩溃：子进程意外退出，这一代结束、租约失效，绑定的窗口得知 | `manager.test.ts`、`window.test.ts`、e2e（探针的崩溃控制路由） |
| 服务端停止时新握手被拒、排空期间打开项目被拒（`admission-closed`）、项目子进程先于服务端插件退出、强制结束记为外部终止 | `server.test.ts` 增补（真实子进程服务端带项目） |
| `idle-grace` 中到达的外部回调不唤醒项目：没有租约的服务端调用得到 `denied`，宽限期照常结束 | `server.test.ts` 增补（探针的“不持租约通知项目”控制路由，注入时钟） |
| 租约归属：`projectsKey` 取得的租约记在调用方这次激活名下，入口停止即释放；路由按帧上的调用方身份核对，别的插件持不到这份租约 | `src/server/projects/projects-capability.test.ts`（新，真实内核与项目管理器） |
| 本地能力的按调用方门面 | 内核 `services/per-consumer.test.ts` 增补 |
| 合同 `provider`：省略 `.at()` 走默认目标、不符的目标被拒、提供方位置不符为 `remote-location-mismatch` | 内核 `protocol.test.ts`、`routing.test.ts`、`plugins` 的远程提供项测试增补 |
| 身份文件、登记与短名、项目移动、目录校验 | `identity.test.ts`、`registry.test.ts`（真实临时目录） |
| wire 2 握手字段、`expect` 不符被拒、访问回调 | 内核 `protocol.test.ts`、`routing.test.ts` 增补 |
| 绑定窗口重连按同一实例接管（不是 `duplicate-instance`）；绑定不同的同 id 实例仍被拒 | 内核 `routing.test.ts` 增补 |
| 原代次正在停止或已结束时，按代次取租约得到 `generation-gone`，不等待、不创建新代次；节点收到不同的绑定即 `project-gone` | 内核 `children.test.ts` 增补（注入时钟）、`routing.test.ts` 增补 |
| 绑定期间服务端开始停止：取得的租约立即释放、窗口得到 `project-unavailable` | `server.test.ts` 增补 |
| 租约持有者编码：经代理取得的租约，发起入口直接调用与经代理调用都按它放行；别的入口不行 | `projects-capability.test.ts` |
| 项目子进程启动超时、启动中退出、实例启动失败都按 `create-failed` 收口、子进程不残留；停止时非 0 退出写诊断 | `manager.test.ts`（真实子进程，测试入口按环境变量制造这几种情形） |
| “打开项目”命令：列出、登记新目录、导航；工作台显示项目短名 | `nbook.projects` 的合同测试与组件测试、e2e |
| 打包产物能起项目子进程 | `scripts/smoke-server.ts` 增补一个场景：登记临时目录、经 RPC 绑定、子进程起来并报身份 |
| 子进程启动时间与内存 | S4 的测量脚本输出写入 Spec 与证据 |

## 验证

- 每片：上表的自跑命令。
- 收口：`bun run test:affected --typecheck --since <计划提交>`、`bun run --cwd packages/neuro-book test:e2e`、`bun run --cwd packages/neuro-book smoke:server`、`docs:check`、`governance:check`；对验收映射的每条判据做变异检查。
- 端到端：`e2e/projects.e2e.ts` 用测试外壳与真实服务端子进程，在本机 Chrome 里走完“打开项目 → 两窗口共用 → 掐断重连 → 关闭两个窗口等宽限期满 → 再打开得到新代次 → 崩溃 → 服务端停止”。
- 未验证的边界：Windows（含 Bun IPC）；macOS；两个服务端进程同时打开同一项目（不拦，见已知限制）；Agent 会话的租约与 `projects://` 提供者（随 nb-harness）；项目内的 Storage 分区（K4）；Files 提供者（第 6 步）。

## 不做与风险

- **不做**：防双开的锁（确认第 4 项）；书架页；项目重命名与删除登记；项目内的插件热插拔；崩溃自动重启；`.at({client})` 的权限规则（拓扑稿待定项 3）；项目内诊断汇到服务端出口（K3 先各写各的日志文件）。
- **风险**：
  - 往用户目录写 `.nbook/project.json`：用户能看到的副作用（已确认）。
  - 每个打开的项目常驻一个 Bun 进程（空进程约 30 MB，带内核与插件的实测在 S4）；没有上限提示，记入已知限制。
  - wire 升到 2、合同多一个必填字段：K2 的客户端与服务端同时升级，外壳与服务端版本不一致时按 K2 的规则提示刷新；现有合同（只有测试合同）随 S1 补字段。
  - 合同 `provider` 改变 K1 的调用写法（`.at()` 可省略）：K1 的测试与 Spec 示例在 S1 一并改，`docs/` 中搜旧写法。
