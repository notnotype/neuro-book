---
schema: nbook.spec/v1
kind: behavior
status: implemented
capability: runtime.diagnostics
owners:
  - runtime-diagnostics
---

# 运行实例诊断与日志

## 目标与非目标

目标：为每个运行实例提供最小可用、可降级的结构化诊断与日志能力。宿主在激活任何业务插件之前就能报告启动与装配失败；诊断提供者可用后，同一运行实例内的插件、服务和领域模块通过同一条入口记录事件，并查询本实例最近的诊断。

覆盖范围：

- 诊断出口与结构化生命周期诊断：时间、级别、事件、来源（运行位置、运行实例、作用域、插件或服务、阶段）、原因与错误摘要。
- 出口按环境提供：后端在获授日志位置追加、轮转与保留；浏览器使用宿主console，不要求落盘。各位置查询缓冲均由诊断提供者自己拥有。
- 紧急最小输出与完整日志分离：完整日志失败时仍有最小输出，不需要 Storage、配置、身份或数据库参与。
- 本实例自有内存诊断查询、明确的保留预算及可观察降级状态；不扫描共享目录作为当前实例查询源。

非目标：

- 不建立遥测平台：不上报远端、不接入指标或追踪后端、不采集用户行为，不因诊断接入网络。
- 不替代领域审计与业务历史。Agent Session、Job、History/Trace 与业务操作结果由各自 owner 负责。
- 不成为Storage、配置、授权或通用文件能力的第二实现，不通过Storage转存日志。console通道只写；后端文件出口仅在获授日志位置管理日志，不对其它插件提供任意文件读取/目录管理/路径寻址或通用句柄。
- 不承诺日志是恶意代码的数据防泄漏沙箱；模式脱敏是受信代码的防误用边界。
- 本切片不启动 Project、Agent、模型或 UI；接口必须能让后续切片中的消费者记录与查询自身诊断。

## 术语与参与者

- 运行实例：某个运行位置（后端进程、浏览器标签页、桌面 renderer、受管 Worker）中一次启动的具体实例。诊断实例与记录归属该实例，不跨实例共享。
- 紧急最小输出：宿主在创建任何业务插件之前提供的失败输出通道。它先于插件存在，形态由宿主决定，用于启动前失败与诊断降级时的最小可见性；它不是配置、日志或授权服务的第二套实现。
- 诊断提供者：负责脱敏、事件归属、本实例有界内存记录与查询，并拥有其环境专用出口适配器；出口和缓冲随其作用域收口。
- 诊断事件：一条结构化记录，含时间戳、级别、事件名与消息，可带结构化数据、错误对象与来源（作用域、插件或服务、阶段、状态转换、调用关联）。
- 诊断出口：环境专用的输出适配器。浏览器宿主提供 console 等只写通道；后端宿主提供已校验日志位置与该位置的使用授予，诊断插件的文件出口只在该位置追加、轮转、枚举和回收自己拥有的日志。文件出口是插件实现的一部分，不向其它插件提供任意路径或通用文件句柄。
- 敏感值（secret）：凭据、token、cookie、API key、密码、恢复码、备份密钥等可用于鉴权或解密的材料；脱敏按已知敏感字段名与已知凭据字面模式识别，不承诺识别任意 secret。
- 降级：诊断提供者无法完成该运行位置的首选出口（例如后端日志位置不可写）时，仍接受记录并尽力输出到宿主兜底出口（例如紧急最小输出）；降级是可用状态上的可查询属性，且不静默丢弃启动失败。

## 输入与前置条件

- 宿主在任何业务插件激活前提供运行位置/实例身份、关闭信号与紧急最小输出。后端另提供已解析日志位置和使用授予；浏览器提供console等输出通道，不要求文件位置。查询所用有界内存记录由诊断提供者自己创建、拥有和淘汰，不由只写通道提供读取。
- 诊断提供者在运行实例内以自己的服务键登记；同一解析作用域最多一个提供者，并发首次取用共享一次初始化结果。
- 依赖方向：诊断不依赖 Storage、配置、身份授权、文件能力、SQLite 或 UI；出口由宿主注入，缺少文件能力不影响诊断启动。这些能力可以依赖诊断记录自身事件；缺少它们不能阻止诊断启动，也不能阻止启动失败被写出。反过来，诊断持有出口不意味着获得文件能力语义。
- 启动初期的事件不能因为“还没有订阅者”而丢失：记录能力先于任何订阅存在。
- 事件输入：级别、事件名与消息必填；结构化数据与错误对象可选。调用方不得主动传入凭据或业务正文，提供者仍按脱敏规则兜底。
- 静态依赖图与激活等待图共同成图：等待诊断激活的消费者是同一张图上的边，不得形成“诊断需要 Storage，Storage 又等待诊断”一类闭环。

## 输出与可观察行为

- 记录：调用返回“已接受”结果；底层写入失败不把调用方的业务操作判为失败，降级状态可查询。
- 事件可观察结构：每条新记录必须带提供者写入的运行位置与实例身份，调用方不能覆盖；其它来源字段缺失时标记未知。时间戳、级别、事件与既有消息语义保留，但消息遵守脱敏。落盘身份可置于既有 `data` 的保留来源字段中，不改JSONL外层字段含义。
- 脱敏：以已知敏感字段名（token、password、cookie、authorization 等）与已知凭据字面模式为依据，把事件消息、结构化数据与错误 message/stack 中的匹配值替换为占位符；结构化数据优先输出安全 metadata（字段名、类型、长度、摘要指纹）而不是原值。脱敏不以识别任意 secret 为目标：未列入字段名与模式的自由文本原值不会被可靠识别，受信调用方仍负责不写入凭据。序列化有长度、深度与条目上限，截断发生在脱敏之后。
- 出口与保留：后端文件出口按既有逐行JSONL和预算执行轮转、保留；浏览器输出到console，不要求落盘。所有位置均有提供者自己管理的有界内存记录，超限淘汰最旧项；这是当前实例诊断查询的唯一来源，不扫描共享目录重建历史。
- 内存预算由装配方显式提供或采用诊断提供者声明的有限默认值；启动前校验为有限正上限，生效预算与淘汰/截断状态可查询。不依赖业务Config才能确定预算。
- 查询：按级别与来源过滤本实例有界内存记录，返回结果与截断信息。旧日志、其它实例日志和无可确认实例身份的记录不进入当前实例查询；后端既有历史日志检索仍由原日志能力入口负责。
- 紧急输出：诊断不可用或降级时，启动失败与关键阶段结果仍出现在紧急输出；紧急输出不保证结构化查询，也不复制完整日志职责。
- 降级可见：至少能查询“当前是否降级”及降级原因；降级不静默。

## 状态与转换

| 状态 | 进入事件 | 允许做的事 | 离开条件 |
| --- | --- | --- | --- |
| 创建中 | 运行实例创建提供者 | 建立有界内存记录与环境出口；文件出口确认日志位置授予 | 成功 → 可用；输出不可用但兜底成立 → 降级可用；提供者本身失败 → 停止中收口 |
| 可用 | 初始化成功（正常或降级） | 接受记录、查询、轮转与保留 | 显式关闭 → 停止中 |
| 停止中 | 关闭请求 | 拒绝新消费者绑定与新业务记录；已接纳消费者的清理路径仍可继续记录；取消记录请求或调用方不再等待都不等于写入已终止 | 全部已登记收口成功 → 已关闭；收口失败或超时 → 阶段仍是停止中并报告“关闭未完成”，保留失败资源、owner 与原因，不报已关闭 |
| 已关闭 | 收口完成 | 无；迟到记录不得复活实例或静默重建日志文件 | — |

- 管理阶段只有创建中、可用、停止中、已关闭四种；“关闭未完成”不是第五阶段，而是停止中在收口失败或超时时的结果与报告，实例留在停止中并保留失败 owner。
- 重复正常关闭共享本次结果，不重复副作用；只有显式恢复操作才另起一次关闭尝试，重试失败收口；上一次收口仍处于 pending（超时但未结束）时不得与之重入或并发重跑同一清理；无显式操作则不自动循环重试。
- 运行实例隔离：不同实例不共享提供者与查询缓冲。同一物理日志位置在协作运行实例之间只能有一个存活的文件出口owner；授予冲突的实例不写该位置，进入可查询的降级并使用自身缓冲/紧急输出，不抢占、不轮转或回收别人的日志。该授予是宿主协作边界，不是对任意外部进程的强制锁。
- 取消与迟到：取消请求或调用方放弃等待不证明操作已终止；未结算的记录与收口保持登记，只有全部清理成功才报告已关闭。
- 停止顺序：先收口消费者，最后关闭提供者；提供者关闭时仍被使用的写入通道应产生可见失败或诊断，而不是静默丢弃。

## 副作用与数据

- 只写运行实例的出口（有文件系统时为日志位置，无文件系统时为 console 与内存缓冲）与紧急输出通道，不写 Storage、配置、数据库或业务工作区。
- 浏览器console/紧急通道仅写；后端文件出口拥有已授予日志位置中的追加、轮转与保留。预算按该独占位置计算，禁止越位置回收；输出通道与内存查询缓冲不是两套可独立修改的行为真相源。
- 后端文件出口、其句柄/队列及有界内存记录由诊断插件拥有；宿主拥有紧急通道及日志位置授予，授予在写入/轮转收口完成后释放。调用方拥有事件业务含义。
- 关闭不删除业务数据，不以scope退出触发历史日志回收；日志维护只按显式保留预算操作本位置中的归属日志。
- 后端日志位置是 `<状态根>/logs/`，状态根由 [`runtime.server-host`](server-host.md) 的启动参数 `NBOOK_STATE_ROOT` 给出；新应用不读取旧应用的 `NEURO_BOOK_LOG_DIR`，不搬迁旧应用的历史文件。不能从“两个进程配置了同一路径”推断它们可安全同时轮转；冲突按降级处理。
- 不发起网络副作用：无遥测、无上报；断网环境与联网环境行为一致。

## 失败与恢复

- 首选出口不可用（日志位置无法创建或写入、缓冲不可分配）：进入降级；记录调用仍然成功返回，业务结果不受影响；启动关键失败仍出现在紧急输出。
- 脱敏或序列化环节异常：以最小固定描述替代原始负载，绝不输出未脱敏原文。
- 查询失败：返回明确错误，不返回被截断却伪装完整的集合。
- 关闭失败（flush、句柄释放等）：阶段保留在停止中并报告“关闭未完成”，保留失败 owner 与原因，可诊断；只有显式恢复操作才另起一次关闭尝试，且不与仍 pending 的收口重入；不假报已关闭，不提前放弃日志位置所有权。
- 强制退出、进程被杀或浏览器卸载：不承诺最后一次写入已完成；后续启动按既有日志现状呈现，不把缺失记录伪装成已确认。
- 重试政策：无自动重试循环；有限重试必须来自显式策略，并且不能让记录调用变成业务失败。

## 边界与兼容

- runtime-diagnostics 拥有日志实现与结构化生命周期诊断。它不是遥测平台、审计系统、业务历史，也不是 Storage、配置或身份授权的替代。
- 依赖方向单向：其它插件与领域消费诊断；诊断不反向依赖它们，也不要求它们先就绪才能报告启动错误。
- 脱敏与容量上限是受信代码的防误用边界：按已知敏感字段名与凭据模式工作，不承诺识别任意 secret，也不因自由文本扫描成为数据防泄漏沙箱；内置同进程代码仍是受信代码。
- 诊断只管理所授予日志位置，不承担业务文件I/O；无文件系统的位置以console和提供者有界内存记录满足合同，不因缺少落盘不可用。
- 后端保留逐行 JSONL、既有字段与级别/事件含义；新记录在 `data` 中增补来源身份，不重写旧日志。旧应用的 `packages/neuro-book-legacy/server/app-logs/` 只作移植参照，不是本合同的证据。
- 本切片验收只要求诊断提供者在真实日志目录（后端运行位置）与无文件系统出口下独立可用，不要求 Project、Agent、模型或 UI 启动；后续消费者按本合同接入，不建立第二份日志正文。

## 验收与 Smoke

以下场景在系统临时根下以真实日志文件、真实插件宿主与真实子进程判定，遵守测试与临时根合同；运行入口与覆盖映射见「实现合同」。

1. 真实日志读回与位置冲突：实例A获授临时日志位置，写入事件后能从本实例查询并在关闭后从文件读回；实例B请求同一存活位置时文件出口降级，不写/轮转/回收A的文件，B仍能查询自身缓冲和报告冲突。A收口并释放授予后新实例可获同一位置；查询不引入A或无来源身份的历史记录。
2. 脱敏：记录含 token、password、cookie 与恢复码样式值的事件消息、结构化数据与错误对象 → 出口输出中均为占位符或安全 metadata（字段名、长度、摘要）；截断不泄漏被截断内容；未列入已知字段名与凭据模式的自由文本记为已知限制，不作为脱敏承诺。
3. 无 Storage 依赖：只启动诊断提供者（不启动 Storage、配置、身份、数据库、Project）→ 能记录事件，并能报告一个模拟的启动门禁失败；不存在“先有 Storage 才能报启动错误”的依赖。
4. 降级：把日志位置指向不可写位置（例如父路径被普通文件占据）→ 记录调用不抛出、业务操作结果不受影响、降级状态与原因可查询；启动关键失败出现在紧急输出。
5. 关闭：关闭后记录不复活实例、不静默重建日志文件；重复关闭共享同一结果；关闭失败时阶段保留在停止中并报告“关闭未完成”，显式恢复操作另起一次关闭尝试且不与仍 pending 的收口重入。
6. 轮转与保留：持有日志位置授予的实例写入超过单文件上限，发生轮转且该位置历史总量受预算约束；回收不越位置、不触碰其它owner或业务文件。第二实例的冲突请求不触发回收。
7. 无遥测：在禁止出网的环境中运行 → 行为与联网一致，不产生对外上报调用。
8. 无文件系统出口：宿主只提供console/紧急输出，诊断提供者建立自身有界内存记录；能够记录、过滤查询并按预算淘汰最旧项，不读写文件、不要求只写console通道返回记录。

## 实现合同

- **实现 owner 与入口**：runtime-diagnostics。平台中立机制唯一公开入口 `packages/nb-runtime/src/diagnostics/diagnostics.ts`（包入口 `@notnotype/nb-runtime/diagnostics`；`createDiagnosticsStore`、`createDiagnosticsPlugin`、`diagnosticsKey`、`mechanismObservers`、`recordingEmergency`、`DiagnosticsError` 与脱敏函数，`export type *`）。后端入口在新应用 `packages/neuro-book/src/plugins/diagnostics/server/`：`plugin.ts`（`createServerDiagnosticsPlugin({store, exporter})`，激活期间把 `console.warn`、`console.error` 记入诊断）、`jsonl-exporter.ts`（`createJsonlExporterFactory`、`createStderrFallback`、日志位置授予）、`log-writer.ts`（JSONL 追加、轮转与保留）；诊断存储由后端宿主在建立运行实例前创建，日志位置为 `<状态根>/logs/`。浏览器入口在 `packages/neuro-book/src/plugins/diagnostics/web/`：`plugin.ts`（`createBrowserDiagnosticsPlugin({store, console})`，每个窗口运行实例一份诊断存储，由窗口在建立实例前创建；不桥接 console，出口本身写 console）、`console-exporter.ts`（`createConsoleExporterFactory`、`createConsoleFallback`）。脱敏只有内核 `redaction.ts` 一份实现。
- **依赖方向**：机制目录只导入同目录与 `../lifecycle`、`../services`、`../plugins`、`../application`（仅类型），不导入框架、进程、DOM、文件或网络；后端出口只导入机制入口、Node 文件 API 与 `proper-lockfile`；浏览器出口只导入机制入口。前两条由源码守卫测试锁定，浏览器一侧由新应用的 `src/architecture.test.ts` 锁定。
- **关键不变量**：
  - 装配方在 `createApplication` 之前创建 store（默认 1000 条、单条消息 4000 字符，非法预算装配期抛错）；`mechanismObservers(store)` 经清单观察者记录 lifecycle/plugins 事件；插件激活时挂接出口并补写挂接前缓冲。`recordingEmergency(store, emergency)` 把宿主紧急报告先记为 fatal `application.<stage>-emergency` 再转交独立紧急输出，所以必需门禁失败在收口前进入记录。
  - 记录结果只有 `accepted` 或 `rejected: stopping|closed|invalid-input`，出口写失败、出口自报失守只让 store 降级（`status().degraded`），error/fatal 改走兜底通道；兜底自身抛错被吞掉。
  - 服务释放即 `store.shutdown()`：先拒绝新记录，补写后关闭出口；出口关闭失败抛 `close-incomplete`、阶段留在 `stopping`，再次 `shutdown()`（经 `Application.recover`）只重试失败步骤且并发调用共享同一尝试；关闭后 `attach` 抛 `closed`，查询仍可用。
  - JSONL 出口用目录内 `server-logs.lock`（proper-lockfile，stale 30 s／update 10 s，retries 0）取得位置授予；拿不到即 `location-conflict` 降级，不写、不轮转、不回收；释放前核对锁目录身份（dev/ino/birthtime），已被接管则只报失守、不删他人锁。只回收 `server-current.jsonl` 与 `server-<时间>-<pid>-<token>.jsonl`，来源身份写在 `data.$source`。
- **验收映射**：场景 1、2、4–6 → `packages/neuro-book/src/plugins/diagnostics/server/jsonl-exporter.test.ts`（真实临时目录读回、冲突、脱敏、父路径被文件占据、关闭、接管、轮转与冲突不回收）；场景 2、3、5、8 → `packages/nb-runtime/src/diagnostics/diagnostics.test.ts`（有界记录/淘汰、脱敏、只装配诊断与模拟必需门禁失败、经 `createApplication` 的关闭未完成与显式恢复）与 `packages/neuro-book/src/plugins/diagnostics/web/console-exporter.test.ts`（按级别写 console、写入失败降级而记录照常接受）；场景 7 → 同一 JSONL 测试文件的源码导入守卫；后端入口的 `console.warn`、`console.error` 桥接（照常输出、记入诊断、关闭后恢复）→ 同目录 `plugin.test.ts`。内核与前后端出口的测试分别在 `packages/nb-runtime`、`packages/neuro-book` 经 `bun run test` 运行。
- **实际 smoke**：`bun run smoke:runtime-foundation -- --services` 在真实子进程中验证日志读回、来源身份、敏感样本只剩占位符、并发实例 `location-conflict` 降级且未写占用位置、缺失诊断提供者时紧急输出可见、启动门禁失败写入诊断日志。

## 证据

- 实现入口：[`diagnostics.ts`](../../../packages/nb-runtime/src/diagnostics/diagnostics.ts)、后端入口 [`plugin.ts`](../../../packages/neuro-book/src/plugins/diagnostics/server/plugin.ts)、浏览器入口 [`plugin.ts`](../../../packages/neuro-book/src/plugins/diagnostics/web/plugin.ts)
- 合同测试：[`diagnostics.test.ts`](../../../packages/nb-runtime/src/diagnostics/diagnostics.test.ts)、[`jsonl-exporter.test.ts`](../../../packages/neuro-book/src/plugins/diagnostics/server/jsonl-exporter.test.ts)、[`plugin.test.ts`](../../../packages/neuro-book/src/plugins/diagnostics/server/plugin.test.ts)、[`console-exporter.test.ts`](../../../packages/neuro-book/src/plugins/diagnostics/web/console-exporter.test.ts)
- Smoke：[`runtime-foundation.ts`](../../../packages/neuro-book-legacy/scripts/smoke/runtime-foundation.ts)（`bun run smoke:runtime-foundation`）。这是旧应用宿主上的 smoke，运行的是旧应用里的内核副本；新应用宿主的 smoke 随应用骨架建立。
- 批准依据：开发者于 2026-09-20 明确接受总体推进方向（第一切片止于环境适配入口与小内核，第二切片用内置服务插件验证），并要求把两片沉淀为 `planned` Spec；[应用运行时与内置插件架构提案](../../../packages/neuro-book-legacy/docs/proposals/application-runtime-and-plugins.md) 的内置插件划分表把 `runtime-diagnostics` 定义为提供日志实现与结构化生命周期诊断、早期必需、完整日志失败仍有最小输出的服务。
- 实现 provenance：[w00017 应用运行时与内置插件架构](../../../.agents/works/w00017-application-runtime-architecture/README.md) 与其 [t04 底座两切片规范与整体实施路径任务](../../../.agents/works/w00017-application-runtime-architecture/tasks/t04-foundation-spec-plan/README.md)。
- 实现与验证：[w00017 t10](../../../.agents/works/w00017-application-runtime-architecture/tasks/t10-runtime-diagnostics/README.md)（机制、双出口与合同测试）、[t13 第二片集成复核](../../../.agents/works/w00017-application-runtime-architecture/tasks/t13-services-integration-review/README.md)（组合 smoke 与逐条核对后晋升）。
- 产品装配：`nbook.diagnostics` 已进入产品清单（[t40](../../../.agents/works/w00017-application-runtime-architecture/tasks/t40-phase1-closing/README.md)），装配入口 `server/features/runtime-diagnostics/product-plugin.ts`；产品诊断出口借用 `appLogger` 的同一 JSONL writer，进程内不另开写入者，进程级日志桥接（consola、`console.warn`/`console.error`、未处理异常）随该插件激活安装、关闭撤销。
- 已知限制：产品 `AppFileLogger` 仍不参与位置授予锁，与 foundation 的 JSONL 出口或另一进程同时指向同一目录时不互斥；无遥测证据是静态导入守卫，不是运行期网络拦截；未知字段名下的自由文本脱敏只覆盖已知凭据模式。
