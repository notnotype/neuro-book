---
schema: nbook.spec/v1
kind: behavior
status: planned
capability: runtime.plugin-channel
owners:
  - runtime
  - nbook.http
---

# 远程服务与 RPC 协议

2026-10-07 按 [多实例运行时拓扑](../../proposals/multi-instance-runtime-topology.md)（`accepted`）与 [ADR 0024](../../adr/0024-multi-instance-runtime-topology.md) 原地改写：原“插件通道”（浏览器入口只能经本插件通道调用本插件服务端）由内核路由的远程服务取代，文件路径与 capability 保持不变。HTTP 路由贡献的合同暂留在本文末节，随 `nbook.http` 相关 Spec 移出。

## 目标与非目标

插件之间跨运行实例的通信只有一种方式：远程服务。任意两个内核实例之间（服务端、项目、浏览器、TUI；客户端之间经服务端转发）都能调用与订阅对方声明的远程服务。内核负责路由、调用方标记、按需激活、超时、取消与失败结算；所有跨实例的边使用同一套对称协议，传输可替换。

明确不承诺：

- 不提供流原语（上行流、双向流）；合同可以以后增加流，届时调用与订阅不迁移。
- 不经远程服务传二进制；二进制经有时效的 HTTP 资源地址传递（[多实例运行时拓扑](../../proposals/multi-instance-runtime-topology.md) 第 7 节做法 B）。
- 不把等待用户回答的长交互挂在一次调用上；这类事项由插件持久化为待办，用户经普通调用回答。
- 不自动重放结果未知的写请求。
- 登录与鉴权随登录插件接入；未加载鉴权时 RPC 端口与 HTTP 端口同等信任本机进程。
- 不做发送背压与应用层心跳：服务端靠 WebSocket 的 ping 发现失联客户端，客户端靠关闭事件发现断线。

## 术语与参与者

- **实例种类**：`server`、`project`、`browser`、`tui`（运行位置，见 [`runtime.plugin-manifest`](plugin-manifest.md)）。
- **拓扑角色**：实例在路由拓扑里的位置：`hub`（服务端实例）、`project`（项目实例）、`client`（浏览器、TUI 这类客户端实例）。
- **远程服务合同**：插件共享模块里用 TypeBox 声明的合同：合同 id（以插件 id 加 `/` 开头）、整数版本、提供方位置、允许调用的实例种类、方法（输入、输出、读或写、业务失败码）、事件（订阅过滤参数、事件内容）。合同同时被提供方与调用方引用。
- **提供方位置**（合同的 `provider`）：哪种角色的实例提供这份合同：`server`（服务端实例）、`project`（项目实例）、`client`（客户端实例）、`any`（每个实例各有一份，例如命令系统的跨实例执行）。
- **远程提供项**：提供入口激活时以 `provideRemote(合同, (调用方) => 门面)` 交出的实现；本地调用与跨实例调用共用这一个工厂，门面规则同 [`runtime.services`](services.md) 的按调用方门面。
- **调用方身份**：运行实例、插件、入口、入口激活代次，委托时另附代理身份；只由内核填写。
- **目标**：`project`（本客户端绑定的项目代次）、`server`、`{project}`（指定项目当前运行的代次；能否到达由宿主的项目管理决定，路由按帧上的调用方身份经宿主给的访问回调询问，未提供时一律 `denied`；访问本身不打开项目，规则见 [`runtime.projects`](projects.md)）、`{client}`（指定客户端实例）。
- **绑定**：客户端实例一生绑定的项目代次，或不绑定；在握手时由服务端宿主决定（见下文“WebSocket 传输与握手”第 3 条），之后不变。
- **节点**：每个内核实例里负责远程服务的部分：登记本地提供项、发出与接收请求。
- **路由**：服务端实例里的节点额外维护实例登记表（种类、绑定的项目代次、连接代次）并转发请求；客户端只连服务端。
- **链路**：两个节点之间的传输，接口为 `{send(帧), onFrame(监听), onClose(监听), close()}`；帧无法编码（含不能序列化的值）时 `send` 同步抛错，链路已关闭时 `send` 丢弃帧；客户端与服务端之间是 WebSocket（见下文“WebSocket 传输与握手”），服务端与项目子进程之间是进程间通信（见下文“进程间链路”），测试与组合验证使用进程内链路。
- **连接代次**：一条链路建立时分配；链路断开即结算该链路上的全部在途请求与订阅。
- **内核 RPC 端口**：服务端宿主为远程服务单独监听的 WebSocket 端口，与 HTTP 端口分离（[`runtime.server-host`](server-host.md)）；浏览器经引导接口得知端口（[`runtime.browser-host`](browser-host.md)）。
- **客户端身份**：客户端实例跨重新加载稳定的标识（浏览器存在本地存储里），与每次启动都不同的实例 id 区分；服务端与项目实例没有。Storage 的 `local` 分区按它划分（随 K4）。
- **服务端进程标识（`boot`）**：服务端每次进程启动时生成，经握手告诉客户端；客户端据此区分“同一服务端进程的重连”与“服务端已重启”。
- **激活链**：请求触发了哪些入口的按需激活，由路由帧携带，用于发现等待环。

## 输入与前置条件

- 输入与输出按合同 schema 严格校验，多余字段被拒绝；校验在提供方执行一次（输入）、调用方执行一次（输出）。
- 帧上的调用方身份（含委托身份）与激活链只由内核填写，放在以 `$nb` 开头的帧字段里，与业务参数分开传递；业务参数（调用的输入、订阅的过滤参数）出现 `$nb` 开头的键，请求在未派发阶段以 `invalid-input` 拒绝。
- 握手时双方核对 wire 协议版本；不兼容时在处理任何业务帧、激活任何入口之前拒绝该链路（握手帧见下文“WebSocket 传输与握手”）。
- 合同版本：请求携带调用方编译时依赖的合同版本，提供方以自己提供的合同版本核对；第一版按整数精确匹配，兼容范围以后再加。
- 客户端实例一生只绑定一个项目代次或不绑定；`project` 目标按调用方绑定解析，不读取“当前项目”；没有绑定的调用方用 `project` 目标为 `target-gone`。

## 输出与可观察行为

1. **调用。** `context.remote.use(合同).at(目标).方法(输入, {signal?, timeout?})` 返回 `{ok: true, value}` 或 `{ok: false, code, cause?, detail?}`，不抛出业务失败。提供方门面方法收到已校验的输入与终止信号（调用方中止、调用方入口停止、提供方入口停止任一触发即触发）。目标写法由合同的提供方位置决定，类型上按它区分：

   | `provider` | 可用的目标 | 省略 `.at()` |
   |---|---|---|
   | `server` | `server` | 等于 `.at("server")` |
   | `project` | `project`、`{project}` | 等于 `.at("project")`（本客户端绑定的项目）；没有绑定的调用方（例如服务端插件）写 `{project: id}` |
   | `client` | `{client}` | 不可省略 |
   | `any` | 全部 | 不可省略 |

   运行时同样核对：目标与合同的提供方位置不符的调用在未派发阶段以 `invalid-input` 失败（说明目标与提供方位置不符），不发出请求。
2. **任意实例可达。** 客户端到服务端、到项目实例、到另一个客户端都由内核经服务端路由转发；插件不写转发代码。同一实例内的调用不经链路：同样按调用方取门面、同样核对身份与代次，只是参数与结果不序列化；宿主开启本地校验（开发模式）时本地调用也按合同校验，传不可序列化的值被拒。
3. **调用方不可伪造。** 提供方看到的调用方身份来自路由帧；委托时为原调用方并附代理身份。
4. **请求阶段与失败码。**

   | 阶段 | 结果 |
   |---|---|
   | 未派发：路由校验不过、目标与提供方位置不符、目标不存在或不可用、`{project}` 访问被拒、不在允许的调用方种类、版本不兼容、保留字段冲突 | 确定失败：`invalid-input`、`denied`、`target-gone`、`unavailable`、`version-changed` |
   | 已派发（目标已 ACK）、尚未收到结果 | 读方法：按原因报告 `target-gone`、`timeout`、`cancelled`，可以重试。写方法：一律 `unknown-outcome`，`cause` 为 `target-gone`、`timeout`、`cancelled` 或 `disconnected`，不自动重试 |
   | 提供方执行完毕 | 成功；合同声明的业务失败码；未声明的异常或输出不符合合同为 `provider-error` |

   ACK 只表示目标收到请求，不证明没有副作用。
5. **按需激活。** 请求到达时目标实例上声明了该合同的入口未激活，内核按 `onRemote:<合同 id>` 激活它后再派发；激活失败或受阻得到 `unavailable` 并附原因；没有入口声明该合同为 `unavailable`。
6. **激活期调用与等待环。** 入口激活期间发出的远程调用，超时取作者给的值与内核上限（默认 10 秒，宿主可配置）中较小的一个。入站请求触发入口 E 激活时，E 激活期间发出的调用携带“入站激活链 + E”；任何节点发现需要等待的入口仍在激活中且已在链中，立即以 `unavailable`（`cause: activation-cycle`）失败并记诊断，不挂起；链上的入口若已结束激活（例如它激活期间发出调用但没有等待结果），不必等它，调用照常进行。环只沿同一条激活链检测：两条独立触发的激活互相等待时（例如两个启动激活的入口各自调用对方），由上面的超时上限兜底，调用方得到 `timeout`。
7. **订阅。** `use(合同).at(目标).事件.subscribe(过滤参数, 监听, {onResync?})` 返回可释放句柄，登记在订阅方的激活作用域上。提供方的 `subscribe(过滤参数, sink, {signal})` 每个订阅调用一次，过滤由提供方完成。订阅绑定两端精确的入口激活代次与所经连接代次：订阅方释放、任一入口开始停止、提供项撤回、任一实例失效或所经连接结束，都取消订阅、触发提供方的 `signal` 并丢弃迟到事件。同一订阅内按序送达；断线期间的事件不补发；连回同一服务端进程、同一项目代次时只重建仍有效的订阅，并调用 `onResync`，订阅方据此重取基线；服务端已换进程时不重建，订阅以 `server-restarted` 结束，绑定的项目代次已结束时以 `project-gone` 结束（见下文“WebSocket 传输与握手”第 4、7 条）。
8. **实例查询。** `context.remote.instances()` 列出当前在线的实例：种类、绑定的项目代次；不含连接细节。
9. **诊断。** 每次调用记录合同 id、方法、调用方插件、目标种类、耗时与结果码；不记录输入、输出与事件内容。

## WebSocket 传输与握手

客户端（浏览器，以后的 TUI）与服务端之间的链路。本节随 [w00017 t53](../../../.agents/works/w00017-application-runtime-architecture/tasks/t53-rpc-port-browser-connection/README.md) 实现；绑定字段（`bind`、`binding`、拒绝原因 `project-unavailable` 与 `project-gone`）与第 7 条随 [t54](../../../.agents/works/w00017-application-runtime-architecture/tasks/t54-project-child-process/README.md) 加入。

1. **编码。** 每帧一条 JSON 文本消息。只接受 JSON 能如实表示的值：`null`、布尔、有限数、字符串、数组、原型为 `Object.prototype` 或 `null` 的普通对象；对象上值为 `undefined` 的属性省略（与可选字段缺省同义）。其它值（函数、symbol、bigint、`NaN` 与无穷、数组里的 `undefined`、`Date`、`Map` 等非普通对象、循环引用）使 `send` 同步抛错，按“失败与恢复”中业务值无法编码的规则结算。无法解析为 JSON 的消息是无效帧。
2. **端口与来源。** 服务端在内核 RPC 端口接受 WebSocket 升级，只接受路径 `/`，其它路径 404。升级请求带 `Origin` 头时必须在宿主给出的允许来源集合内（[`runtime.server-host`](server-host.md)），否则 403；不带 `Origin` 头的放行：浏览器发起的 WebSocket 握手总会带 `Origin`，网页无法省略，不带的只有本机的非浏览器客户端。单条消息上限 1 MiB，超过即断开；二进制经 HTTP 资源地址传递。
3. **握手。** 链路建立后客户端先发 `hello {wire, instance: {id, kind, role, project, client}, bind, boot}`，其中 `client` 是客户端身份（服务端与项目实例为 `null`）；`boot` 是上次握手得到的服务端进程标识，第一次连接为 `null`；`instance.project` 对客户端恒为 `null`，绑定由服务端决定；`bind` 是绑定请求：不绑定为 `null`，首次连接为 `{project: 项目引用}`（短名或 id），重连为已绑定的 `{project: id, generation}`，只有客户端（`role: client`）可以带。hello 不带各插件版本：每个请求帧已带调用方期望的合同版本，由提供方逐个请求核对。服务端依次判定：
   - **wire 版本先于一切。** `hello` 的 `wire` 是整数但与本端不同时，不校验其余字段（另一版本的 hello 可能是另一种形状），直接回 `reject {reason: "wire-version"}` 并关闭。`reject` 帧的形状 `{type: "reject", reason, message}` 跨 wire 版本不变，任何版本的客户端都读得懂新服务端的拒绝。
   - **服务端已换进程。** `boot` 不为 `null` 且与本进程的不同时回 `reject {reason: "server-restarted"}`，不再判定其余各项：项目代次号在新进程里从头编号，按旧进程的代次判断绑定可能撞上新进程里的同号代次。
   - **停止中。** 服务端已停止接纳时回 `reject {reason: "stopping"}`。
   - **实例 id。** 等于服务端自己的 id、`role` 为 `hub`、或不是客户端却带了 `bind` 的，以 `role` 拒绝。id 已在线时：种类、角色与客户端身份都与已登记的一致，且绑定一致（已登记的成员没有绑定时 `bind` 为 `null`；有绑定时 `bind` 是同一个 `{project: id, generation}`），视为同一实例重连，服务端关闭旧链路（其上在途请求与订阅按断开结算）、登记新链路，使服务端还没察觉旧连接断开时客户端也能重连；任一不一致回 `reject {reason: "duplicate-instance"}`。
   - **绑定。** `bind` 不为 `null` 时，路由交给宿主的绑定回调（[`runtime.projects`](projects.md) 输出第 7 条），等它的结果，期间不登记成员：首次连接按引用打开项目并取得租约；重连只在原代次仍在运行（含宽限期中）时取得，否则以 `project-gone` 拒绝，不改投新代次；项目不存在、未登记、创建失败或服务端正在停止，以 `project-unavailable` 拒绝并附说明；宿主没有提供绑定回调时同样是 `project-unavailable`。等待期间链路关闭的，绑定一出结果就释放租约。同一实例重连接管旧链路时，先为新链路取得租约，再关闭旧链路释放旧租约，使用者计数不会中途落到 0。
   - 通过后回 `welcome {wire, boot, binding}`，`binding` 为 `{id, name, generation}` 或 `null`；该成员的实例描述随之带上项目代次，`project` 目标与 `{project}` 访问都按它解析。成员链路关闭时释放绑定的租约。
4. **服务端重启与项目已结束。** 客户端节点记住第一次握手得到的 `boot` 与绑定，之后重连都带 `{project: id, generation}`。之后重连被以 `server-restarted` 拒绝（或 `welcome` 的 `boot` 与记下的不同，作为第二道防线），说明服务端已换进程，旧进程里与本实例有关的门面、订阅与等待都已不在：本节点的全部远程订阅以 `server-restarted` 结束、不重建，这条链路关闭，连接结果为 `server-restarted`；此后本节点的远程调用为 `unavailable`、再次连接仍返回 `server-restarted`。重连以 `project-gone` 被拒，或 `welcome` 里绑定的 id、代次与记下的不同（第二道防线，不接受改投），同样进入终态：订阅以 `project-gone` 结束、不重建，链路关闭，连接结果为 `project-gone`，之后调用为 `unavailable`。客户端宿主据此要求重新加载（浏览器见 [`runtime.browser-host`](browser-host.md)）。`boot` 与绑定都相同时按输出第 7 条重建订阅。
5. **协议违规。** 握手完成前收到 `hello` 以外的帧，或任何时候收到无法解析的帧，服务端记诊断并关闭这条链路；对端的在途请求随即按断开结算，不必等到超时。
6. **停止。** 服务端宿主停止时，路由依次：
   1. **停止接纳**：新的客户端 `hello` 以 `stopping` 拒绝；客户端成员发来的新请求与新订阅为 `unavailable`（说明服务端正在停止）。项目成员与宿主带 `expect` 交来的项目链路不受影响：项目子实例停止时还要经远程服务收口，正在创建的项目子实例也要能完成握手、再按停止序列收口。
   2. **排空**：等路由已接纳的在途请求（发给服务端插件的与转发给其它实例的）全部结算，有截止时间，到期返回“截止”。
   3. **关闭**：关闭全部成员链路，其上的请求与订阅按断开结算。
   三步都幂等。宿主怎样安排这三步与 HTTP 排空、插件关闭的先后见 [`runtime.server-host`](server-host.md)。
7. **绑定的项目代次结束。** 某个项目代次结束（宽限期满后停止、崩溃、服务端停止）时，路由关闭绑定它的客户端链路；客户端重连得到 `project-gone`，按第 4 条进入终态。

## 进程间链路

服务端与项目子进程之间的链路（[`runtime.projects`](projects.md)），随 [w00017 t54](../../../.agents/works/w00017-application-runtime-architecture/tasks/t54-project-child-process/README.md) 实现。

1. **传输。** Bun 的进程间通信（`serialization: "json"`）。帧仍按“WebSocket 传输与握手”第 1 条编码为 JSON 文本，进程间通信只搬运这段文本，不因为它能传 `Date`、`Map` 而放宽编码；三种链路（进程内、WebSocket、进程间）的编码语义一致。服务端宿主与项目宿主之间的控制消息（启动结果、停止请求）与帧共用这条进程间通信，但不进入链路。
2. **寿命。** 子进程退出或进程间通信断开即链路关闭，其上在途请求与订阅按断开结算。链路关闭不等于知道了退出码：退出码要等子进程真正结束后才可靠，由宿主写进诊断。
3. **接受。** 宿主以 `router.accept(link, {expect})` 把子进程的链路交给路由，`expect` 是这个子进程应有的实例描述（`{id: "project:<id>#<代次>", kind: "project", role: "project", project: {id, generation}, client: null}`）；hello 的实例描述与它不完全一致时以 `role` 拒绝。链路上因此不会出现别的项目或别的代次。项目实例的 hello 不带 `bind`。
4. **方向。** 项目子进程只连服务端；它与客户端、与其它项目实例之间的调用都经服务端路由转发。

## 状态与转换

| 对象 | 状态与转换 |
|---|---|
| 请求 | 未派发 → 已派发（ACK）→ 已结算；只结算一次；结算后的迟到结果丢弃 |
| 订阅 | 建立中 → 活动 → 已取消（见输出第 7 条的取消条件）；重连时以新订阅替代，旧订阅不复活 |
| 链路 | 连接 → 握手（等绑定结果，`welcome` 或 `reject`）→ 已登记 → 断开；每次连接分配新的连接代次；断开即结算其上全部在途请求与订阅并释放绑定的租约；同一实例重连时旧链路被关闭；绑定的项目代次结束时被关闭 |
| 路由 | 接纳 → 停止接纳 → 已关闭；只前进不回退 |
| 客户端节点的服务端进程与绑定 | 未连接 → 已知 `boot` 与绑定 → 服务端已重启或项目已结束（终态：不再重连成功，远程调用为 `unavailable`） |
| 远程提供项 | 随提供入口激活可用，随入口停止撤回；撤回后新请求为 `unavailable`，在途请求按第 4 条阶段规则结算 |

- 同一方法的并发调用互不合并，各自执行。
- 目标实例代次结束后，发往旧代次的请求一律在未派发阶段失败，不改投新代次。

## 副作用与数据

- 远程服务本身不持久化任何数据；需要跨断线、跨重启保留的事项由提供插件自己持久化。
- 路由的实例登记表、在途请求表与订阅表是服务端实例内的内存状态。
- 诊断进入运行时诊断，不含业务内容。

## 失败与恢复

- 输入不符合合同：`invalid-input`，不调用提供方。
- 提供方返回值不符合合同或抛出未声明异常：`provider-error`，不把不合格数据交给调用方。
- 提供入口在处理过程中停止：调用方得到第 4 条已派发阶段的结果；之后到达的请求为 `unavailable`。
- 链路断开不证明对方已取消执行中的请求；内核不重放未确认的请求，写请求的结果由领域按自己的合同核对（例如按任务 id 幂等处理）。
- 激活等待环与激活期超时都返回结构化失败并记诊断，不挂起调用方。
- 业务值无法经链路编码（插件传了不能序列化的值）：参数或过滤参数为 `invalid-input`，结果为 `provider-error`，事件内容使订阅以 `provider-error` 结束；都立即结算，不等超时。
- 远程实现工厂必须同步返回对象；抛错、返回非对象或 Promise 时这次调用为 `provider-error` 并记诊断。
- 握手被拒：连接结果带 `reason`（`wire-version`、`server-restarted`、`stopping`、`duplicate-instance`、`role`、`project-unavailable`、`project-gone`）与说明，链路关闭；客户端宿主按原因决定提示刷新、稍后重连、显示无法打开项目或报告启动失败。

## 边界与兼容

- **owner**：runtime（合同、节点、路由、协议、按需激活、绑定的握手）；传输由各宿主提供（WebSocket 随 K2，进程间通信随 K3）；项目的打开、租约与访问规则由服务端宿主的项目管理提供（[`runtime.projects`](projects.md)）。
- **与服务装配的关系**：远程提供项的门面规则沿用 [`runtime.services`](services.md) 的按调用方门面与委托；远程服务不进入依赖图（[`runtime.plugin-manifest`](plugin-manifest.md) 第 5 条）。
- **与 HTTP 的关系**：插件之间不经 HTTP 通信；HTTP 只服务浏览器原生加载与外部调用方（见末节）。
- **安全**：第一版完全信任（[ADR 0022](../../adr/0022-extensible-platform-and-plugin-trust.md)）；调用方身份与委托防误用、不防恶意代码。客户端互调的权限规则与登录接入时的使用者限制待后续补充。
- **兼容**：合同 id、版本、提供方位置、失败码与目标写法是公开接口；帧格式与 wire 协议版本是内核内部协议，变更时提升 wire 版本（加入绑定字段时升为 2）；`reject` 帧的形状与 `hello` 的 `wire` 字段跨版本不变。
- **开发模式**：页面经引导接口得知 RPC 端口后直连后端，不经页面服务代理 WebSocket；后端每次重启对已打开的页面都是服务端重启（[`runtime.server-host`](server-host.md)）。

## 验收与 Smoke

1. **调用与校验。** 调用方经进程内链路调用另一实例的远程服务得到结果；多余字段或类型错误的输入为 `invalid-input`，提供方未被调用；提供方返回不合格数据为 `provider-error`。
2. **任意实例可达。** 三个真实内核实例（服务端与两个客户端，或服务端、客户端与项目）互调；客户端到客户端经服务端转发；同实例调用与跨实例调用结果一致；开启本地校验时本地调用传不可序列化值被拒。
3. **调用方不可伪造。** 提供方看到的调用方是真实发起入口与激活代次；业务参数含保留字段被拒；经代理时为原调用方并附代理身份。
4. **请求阶段。** 每个阶段的失败码各一例；写请求派发后链路断开得到 `unknown-outcome` 附 `cause`；读请求同样情况按原因报告。
5. **版本。** wire 协议版本不兼容时链路在业务帧前被拒；合同版本不一致为 `version-changed`。
6. **按需激活。** 首次远程调用按 `onRemote:<合同 id>` 激活懒入口并成功；激活失败为 `unavailable` 附原因。
7. **等待环与激活期超时。** 两个入口激活期间互相远程调用：双方得到 `unavailable`（`activation-cycle`）而不是挂起；激活期间只发出调用、不等待结果的入口先结束激活后，被它触发的入口再调用它照常成功；激活期调用的超时上限生效（注入时钟）。
8. **订阅。** 四种取消条件（订阅方释放、任一入口停止、提供项撤回、连接结束）各一例；迟到事件被丢弃；同一项目代次内重连后订阅重建并收到 `onResync`；旧代次订阅不复活。
9. **`{project}` 目标。** 访问回调拒绝时为 `denied`，没有访问回调时一律 `denied`；项目代次结束后发往它的请求为 `target-gone`。
10. **握手与来源。** 带不允许 `Origin` 的升级得到 403、不带 `Origin` 的放行；`wire` 不同的 hello（其余字段是另一版本的形状）得到 `wire-version` 拒绝；`welcome` 带 `boot`；hello 带客户端身份。
11. **重连与服务端重启。** 连回同一 `boot`：订阅重建并收到 `onResync`。连到另一个服务端进程：hello 带的 `boot` 不同即以 `server-restarted` 拒绝，订阅以 `server-restarted` 结束且不重建，连接结果为 `server-restarted`，之后的调用为 `unavailable`。同一实例重连接管旧链路，旧链路上已派发的写请求为 `unknown-outcome`；描述不一致为 `duplicate-instance`。
12. **协议违规。** 握手前的业务帧、无法解析的帧使链路关闭并留诊断，对端在途请求立即结算。
13. **停止。** 停止接纳后新 hello 以 `stopping` 拒绝，客户端新请求为 `unavailable`，项目成员照常；排空等在途请求结算，到截止时间返回截止；关闭断开全部成员。
14. **编码。** JSON 编码遇函数、symbol、bigint、非有限数、数组里的 `undefined`、非普通对象与循环引用时抛错，请求、结果与事件按阶段结算。
15. **绑定。** 带 `bind` 的 hello 得到带 `binding` 的 `welcome`，`project` 目标到达绑定的代次；绑定回调拒绝时为 `project-unavailable`；重连带原代次，在代次仍在时恢复绑定、订阅重建并收到 `onResync`，代次已结束时为 `project-gone`，节点进入终态、订阅以 `project-gone` 结束；`welcome` 的绑定与记下的不同同样进入终态。绑定的客户端重连按同一实例接管，不是 `duplicate-instance`；同 id 但绑定不同仍是 `duplicate-instance`；非客户端带 `bind` 以 `role` 拒绝。绑定期间链路关闭，租约随即释放；绑定的项目代次结束时客户端链路被关闭。
16. **提供方位置。** `provider: "server"` 的合同省略 `.at()` 到达服务端；`provider: "project"` 的合同省略 `.at()` 到达绑定的项目；目标与提供方位置不符为 `invalid-input` 且没有发出请求。
17. **进程间链路。** 真实子进程经进程间通信与服务端互相调用；`expect` 不符的 hello 以 `role` 拒绝；子进程退出后其上写请求为 `unknown-outcome`、订阅以断开结束。

Smoke：场景 1–9 由内核合同测试以真实内核实例与进程内链路覆盖（[w00017 t52](../../../.agents/works/w00017-application-runtime-architecture/tasks/t52-kernel-instances-remote/README.md)）；场景 10–14 由内核合同测试与服务端宿主的真实 Bun WebSocket 测试覆盖，真实 Chrome 上的连接、断线重连、刷新与服务端重启由 `packages/neuro-book/e2e/rpc.e2e.ts` 核对（[w00017 t53](../../../.agents/works/w00017-application-runtime-architecture/tasks/t53-rpc-port-browser-connection/README.md)）；场景 15、16 由内核合同测试覆盖，场景 17 与绑定的真实子进程、真实 Chrome 验收随 [w00017 t54](../../../.agents/works/w00017-application-runtime-architecture/tasks/t54-project-child-process/README.md)（`e2e/projects.e2e.ts`）。

## HTTP 路由贡献（待移交 `nbook.http` 的 Spec）

以下是 2026-09-30 已确认、仍然有效的 HTTP 路由贡献合同，属于 `nbook.http` 的对外 HTTP 边缘，与远程服务无关；随 `nbook.http` 相关 Spec 的修订整体移出本文。

- **声明**：清单字段为方法、路径、鉴权方式（`session`：需要登录，默认；`none`：公开，由处理函数自行校验调用方，例如 webhook 签名）、可选的输入与输出 schema。第三方插件的路径必须位于 `/api/plugins/<插件 id>/raw/` 之下；内置插件可以保留现有路径。
- **处理函数**：Web 标准的 `(request: Request, ctx) => Response`。
- **生命周期**：路由随所属入口激活可用，随入口停止撤回；插件禁用后已登录请求得到 503 `plugin-unavailable`，未登录请求得到 401；卸载后已登录请求得到 404。
- **冲突**：两条路由贡献方法与路径相同时，冲突的路由全部被拒绝并报告，不按登记顺序决定谁生效；插件的其它贡献照常。
- **验收**：示例第三方插件在 `/api/plugins/<id>/raw/hook` 声明 `none` 鉴权的路由，未登录可访问；声明在该前缀之外的路径使该条贡献被拒绝；禁用、卸载与冲突按上述结果。

## 证据

- 批准目标：[多实例运行时拓扑](../../proposals/multi-instance-runtime-topology.md) 第 4、5、10 节与 [ADR 0024](../../adr/0024-multi-instance-runtime-topology.md)（2026-10-07 `accepted`）；审查与复审见 [t51 证据](../../../.agents/works/w00017-application-runtime-architecture/tasks/t51-runtime-topology-design/evidences/)。原插件通道合同的依据为 [可扩展应用平台设计](../../proposals/extensible-application-platform.md) P5 与 [ADR 0022](../../adr/0022-extensible-platform-and-plugin-trust.md) 第 3 条，被取代的部分以 ADR 0024 为准。
- 实现：内核部分已随 [w00017 t52](../../../.agents/works/w00017-application-runtime-architecture/tasks/t52-kernel-instances-remote/README.md) 实现，包入口 `@notnotype/nb-runtime/remote`（合同、协议、节点、路由）与 `@notnotype/nb-runtime/remote/testing`（进程内链路）。场景 1–9 由 [`protocol.test.ts`](../../../packages/nb-runtime/src/remote/protocol.test.ts)、[`routing.test.ts`](../../../packages/nb-runtime/src/remote/routing.test.ts)、[`activation.test.ts`](../../../packages/nb-runtime/src/remote/activation.test.ts) 与 [`children.test.ts`](../../../packages/nb-runtime/src/application/children.test.ts) 覆盖，模块的依赖方向由 [`remote.test.ts`](../../../packages/nb-runtime/src/remote/remote.test.ts) 的源码守卫锁定：只依赖 TypeBox 与 lifecycle、services 入口，不依赖插件宿主与应用内核。WebSocket 传输与握手随 [w00017 t53](../../../.agents/works/w00017-application-runtime-architecture/tasks/t53-rpc-port-browser-connection/README.md) 实现：内核的 `json-codec.ts`（`encodeJsonFrame`、`decodeJsonFrame`、`FrameEncodingError`；进程内测试链路也用它）、`protocol.ts` 的 `wireMismatch`、路由的 `boot` 选项与 `stopAdmission`、`drain`、`close`、节点的服务端重启识别；宿主一侧的端口、来源与套接字适配见 [`runtime.server-host`](server-host.md)、[`runtime.browser-host`](browser-host.md) 的实现合同。场景 10–14 由 [`protocol.test.ts`](../../../packages/nb-runtime/src/remote/protocol.test.ts)、[`json-codec.test.ts`](../../../packages/nb-runtime/src/remote/json-codec.test.ts) 与 [`routing.test.ts`](../../../packages/nb-runtime/src/remote/routing.test.ts) 的握手、重连、协议违规与路由停止各组覆盖。绑定、合同的提供方位置与进程间链路（场景 15–17）依据 [多实例运行时拓扑](../../proposals/multi-instance-runtime-topology.md) 第 3、4 节与开发者 2026-10-07 在 [t54 实施计划](../../../.agents/works/w00017-application-runtime-architecture/tasks/t54-project-child-process/plan.md) 中的确认，随 t54 实现。本文保持 `planned`，进程间链路实现后再评估晋升。
- 内核部分的已知限制：委托只在同一实例内，经代理转发到另一实例的委托未实现；合同版本只做整数精确匹配；等待环只沿单条激活链检测，跨链的互相等待只受激活期超时上限约束；激活链只记入口、不记代次，同一入口失败恢复后的新一代若正在激活，会被旧一代留下的链误判为环；`{project}` 目标的租约在建立请求或订阅时核对，订阅建立后租约释放不取消订阅，到该项目代次结束时才取消；拓扑稿第 10 节“服务端向项目推送事件不需要租约”由 `{project}` 的无租约访问规则承担（[`runtime.projects`](projects.md) 输出第 9 条）。
- 验证依据：[G0 报告](../../../.agents/works/w00017-application-runtime-architecture/tasks/t27-platform-risk-gates/evidences/g0/REPORT.md)（旧宿主上的 WebSocket 升级）；新宿主上的 Bun WebSocket 由 t53 的合同测试、smoke 与 e2e 实测。
- 传输的已知限制：不做发送背压与应用层心跳；同一实例重连时按描述一致接管旧链路，不核对凭据（鉴权随登录插件）。
