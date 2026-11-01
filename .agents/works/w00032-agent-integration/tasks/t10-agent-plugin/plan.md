# t10 Agent 插件骨架：实施计划

## 1. Context

**为什么做。** t20 的 harness 内核已合入（`createAgentHost`、会话的指令与查询、出站过滤、运行中撤回扩展），t09 的模型服务也已合入，但应用里还没有任何代码把内核接起来：没有会话放在哪、Profile 从哪来、插件怎样给 Agent 加工具与扩展、窗口怎样看一次运行。本 Task 做内置插件 `nbook.agent` 的服务端骨架，让后面的 Task（t12 工具、t11 压缩、t17 对话界面、t15 Skill、nb-story 迁到新内核）各自往上接，不再改骨架。

**依据。**

- t10 决定 1 到 8（2026-10-28，“方向先同意，具体实现时再细化调整”），见 [README](README.md)；t09 README 的推进建议：t10 连带 t03 的会话存放、t05 的 Profile 目录与重载。
- 前置决定：t03 决定 4、5（会话在状态根、单写者靠一个服务端）；t04 决定 2、4、6（工具工厂、绑定存用户配置、方案 D）；t05 存放三层与第三轮“打包加哈希”；t07 决定 7（中断后不自动续跑）；t08 的状态根布局（`<状态根>/agent/sessions/<id>/`、`<状态根>/user/profiles/`）。
- 内核合同：[`harness/runtime.md`](../../../../../docs/specs/harness/runtime.md) 输出 12、15、53–57，[`harness/session.md`](../../../../../docs/specs/harness/session.md) 输出 11、19，[`harness/extensions.md`](../../../../../docs/specs/harness/extensions.md) 输出 26–28。
- 平台：[`runtime/plugins.md`](../../../../../docs/specs/runtime/plugins.md) 输出 15–17、24，[`runtime/plugin-manifest.md`](../../../../../docs/specs/runtime/plugin-manifest.md)（激活事件前缀），[`runtime/plugin-channel.md`](../../../../../docs/specs/runtime/plugin-channel.md) 输出 7（订阅与 `onResync`），[`runtime/plugin-code-loading.md`](../../../../../docs/specs/runtime/plugin-code-loading.md) 输出 1、4（服务端装载与宿主模块表）。
- [`models/service.md`](../../../../../docs/specs/models/service.md) 输出 10（`modelsKey.port(profileDefaults)`）。

**调研到的现状**（2026-11-01，两份只读调研）：

- `createAgentHost` 只接 `agent.extensions`；工具（`SessionEnv.tools`）与 Profile（`SessionEnv.profiles.resolve`）由宿主自己供给与撤回。`AgentHost` 没有“全部关闭”。
- 内核与远程通道都没有推送限流、背压断开；通道断线重连后重建订阅并调 `onResync`，断线期间的事件不补发。内核给了补齐的接法：先订阅、再 `log({afterSeq})` 补到 `through`（`api/host.ts` 的 `SessionSnapshot.head` 注释）。
- Profile 的打包、哈希与重载没有任何实现；打开着的会话只在重开或 `changeProfile` 时重新解析 Profile。
- 应用里插件的启用、禁用目前下次启动才生效（`plugin-platform/backend/inventory.ts`）；运行期热插拔是 planned 的 [`runtime/plugin-hot-plug.md`](../../../../../docs/specs/runtime/plugin-hot-plug.md)。今天会让贡献撤回的只有：入口因依赖不可用而受阻、入口激活失败、应用停止。
- 第三方插件的服务端代码按宿主模块表装载，SDK 子路径登记在 `src/sdk/entries.ts`；表里还没有 Agent 的写法。

**工作方式。** 开发者在场，按 implementation-planning：第一稿开发者确认了第 9 节（README 决定 9–15），omp 设计审查第一轮 20 条（阻断 4、重要 16）全部成立，第二轮核对后新提 8 条（阻断 2、重要 6），本稿（第三稿）按两轮修订，处置见 [`evidences/design-review-disposition.md`](evidences/design-review-disposition.md)。代码在 Work 分支 `feat/w00032-agent-integration`（先快进到最新 master），Spec 与 Task 记录在主工作区的 master。

## 2. 技术选型

| 问题 | 选用 | 理由 | 否决 |
|---|---|---|---|
| 会话日志与锁 | 内核的 `createJsonlStore({root: <状态根>/agent/sessions})` | 现成：操作系统独占锁、`index.json` 列表按项目过滤 | 存进 `nbook.storage`（记录上限 1 MiB，不适合日志） |
| 用户级 Profile 打包 | `Bun.build`（target bun，SDK 与 JSX 运行时作外部模块，按内容哈希命名），自己的装载器，共用宿主模块表与外部导入检查 | t05 第三轮已定；Bun 自带，不加依赖。第三方插件装载器的输入是已安装插件、只认 `activate` 导出，不能直接用（审查 16）；这是 `plugin-code-loading.md` “不在状态根运行期编译”的例外，只对受信的用户代码 | 直接 `import()` 源文件（Profile 导入的本地文件改了不生效、缓存删不干净） |
| 监听用户 Profile 的源文件 | `node:fs` 的 `watch`，只监听打包元数据里列出的源文件与 `user/profiles/` 目录 | 与 `server/dev/watch.ts` 同一写法；目录很小 | `chokidar`（多一个依赖，换不来什么） |
| 推送 | 远程服务的事件（`eventSource`），流式增量按 100 毫秒合并 | 决定 5：不另开 SSE；通道已有订阅、重建与 `onResync` | 照 nb-story 另开 SSE 端点 |

## 3. 关键设计
### 3.1 `packages/nb-harness`：内核的三处改动

1. **宿主交的工具声明就是最终的工具集**（审查 1）。现在 `ToolBox.current()` 在 Profile 写了 `tools` 时只留它列出的，绑定加的工具与 `defaultForAll` 的工具会被滤掉，与 t04 决定 4（绑定在 Profile 之外、harness 只检查必需工具）冲突。改为：宿主交来的声明全部交给模型；Profile 的 `tools.required` 只用来判断必需工具缺失（缺了照旧 `tools-missing` 只读），`optional` 只给 Profile 检测“这个工具在不在”。改 `run/tools.ts` 与 `runtime.md` 输出 15。新内核在产品代码里还没有宿主（`nb-harness/kernel` 之外只有 nb-story 的内核验收门与模型服务的类型导入，2026-11-01 查过），所以直接改公共行为，不加“按 Profile 过滤”的开关；依赖过滤的内核测试与 nb-story 验收门随之改成宿主只交 Profile 要的工具（审查第二轮 1）。
2. **`AgentHost.profilesChanged(keys)`**（审查 2、17）。新的内核操作，不借 `notifyExtensionsChanged`：对用这些 key、打开着的会话，按会话当前的 key 重新调 `env.profiles.resolve`，解析不到进只读 `unknown-profile`；解析到就用新对象重新装配、重建资源与工具上下文，即使哈希没变也换掉对象（这样会话不持有旧 Profile，旧包才能被回收）；哈希变了写 `profileChanged{reason: "code-updated"}`。时机与等待照扩展变化：运行中的等这次运行结束、空闲的立即，与扩展变化攒在同一个待重新装配里一起做，返回的 Promise 在各会话做完后完成。失败沿用扩展变化已有的处理（审查第二轮核对 2）：写 `profileChanged` 失败时句柄进 `log-broken`、内存里的装配不变；写下之后宿主建资源或工具上下文失败时进只读 `reassembly-failed`，重开以日志为准。
3. **会话头加 `background?: true`**（审查 15、第二轮 7）：`CreateSessionOptions.background` 传入，`createSession` 写进会话头，打开时的头校验认它；`fork` 不继承（fork 是用户的操作，新会话总是前台）；`index.json` 的列表条目带它，索引重建时从会话头读回；`list` 可按它过滤。日志格式版本不变（新增可选字段，旧会话没有它即前台）。

测试在 `tests/kernel/` 的宿主场景里补；`runtime.md` 输出 15、57 与 `session.md` 输出 19 随之改。

### 3.2 `packages/neuro-book/src/plugins/agent/`（新插件 `nbook.agent`，本 Task 只有服务端入口）

照 `plugins/models/` 的布局：`plugin.ts`（描述，`locations: ["server"]`）、`shared/`（贡献点、合同、设置项、服务键）、`backend/`（入口与实现）、`locales/`。登记进 `src/manifest.ts`、`src/server/plugins.ts`、`builtin-names`（中文名“Agent”）与消息目录检查的列表。

服务端入口 `server`：

- **依赖**：必需 `diagnosticsKey`、`stateRootKey`、`settingsKey`；可选 `modelsKey`（不在时会话照常打开，发请求时以 `unavailable` 失败，决定 6）。
- **接收**：`agent.extensions`、`agent.tools`、`agent.profiles`（第 3.3 节）。
- **提供**：远程服务 `nbook.agent/sessions`（第 3.5 节）、服务键 `agentKey`（第 3.6 节）。
- **激活**：不写 `onStartup`，与 `nbook.models` 一样在远程服务首次被调用或服务键首次被依赖时激活。
- **停止**（审查 8、第二轮 8）：服务有一道 `stopping` 门。`onStop` 里依次：
  1. 同步关门：之后的远程调用与 `agentKey` 调用得 `unavailable`，新订阅以同样的原因结束；
  2. 停 Profile 的监听，装载器进停止状态：不再开始新的打包，进行中的打包完成后只丢掉结果（不发布、不调 `profilesChanged`），等它们结束；
  3. 等已接纳的打开、建会话、指令登记完（第 3.5 节的句柄表把它们都记在表里），对此刻的打开表逐个 `closeSession(s, {reason: "interrupted"})`（运行写 `interrupted`，t07 决定 7）。
  
  有会话关闭失败时写诊断，继续关其余的，不吞掉。缓存的包留在磁盘上，下次启动按内容哈希复用。应用停止走同一路径。

### 3.3 贡献点与激活事件

本 Task 实现三个，其余六个在用到它们的 Task 里定义（README 决定 9）。

**`agent.extensions`**：实现式；声明 `{tags?, dependsOn?}`（内核 `ExtensionDeclaration`），id 带插件前缀。接收方是一个适配器（审查 3）：

- 平台句柄到内核 `ExtensionHandle` 用 `WeakMap` 一对一记住，同一个平台句柄总是交给内核同一个对象（内核的撤回按对象相等认句柄与代次）；`implementation()` 转调平台句柄的，不缓存（只在内核装配时取）。
- 平台 `prepare` 转内核 `prepare`，内核抛 `ExtensionRejected` 原样抛出，平台按自己的合同回滚这一批；`published` 转 `published`；`revoke` 对已发布的转内核 `revoke` 并把它的 Promise 交给平台，对只预占没发布的同样转（内核会删掉预占）。内核的 `published` 不抛（各会话的重新装配在后台做、失败进只读）；`revoke` 的 Promise 失败时写诊断并让交给平台的 Promise 完成，不让平台的停止卡在 Agent 这一侧（审查第二轮核对 3）。
- 撤回原因：平台的 `activation-failed` 映射到内核的 `activation-failed`，其余四种（`activation-stopped`、`scope-closed`、`receiver-closed`、`delivery-failed`）都映射到 `deactivated`；内核目前不按原因分支，映射只为诊断。

**激活事件 `onAgentSession`**（审查 5、6）：每次建会话或打开会话之前触发（同一时刻只触发一次，后到的等这一次），不只本进程第一次；已激活的入口不受影响，后来登记的提供方在下一次建或开会话时被激活，已打开的会话经 `published` 重新装配拿到它。提供扩展的入口必须声明 `onAgentSession`；声明了扩展贡献、却没声明这个事件的入口写一条诊断（它的扩展只有在入口因别的原因激活后才生效）。触发结果里有失败时写诊断、照常继续（审查第二轮 4）：打开已有会话时，缺的扩展若是 Profile 依赖的，装配按 `dependency-missing` 进只读（内核已有）；新建会话时内核的 `createSession` 装配失败就不建（`profile-invalid`，详情带缺的依赖），调用方拿到失败，不会得到一个只读的空会话。扩展提供方不能依赖 `agentKey`：`nbook.agent` 激活时会等 `onAgentSession`，提供方又等 `agentKey`，平台把这种等待环判为 `unavailable`，提供方激活失败；Spec 写明这条约束。

**`agent.tools`**：实现式；声明是 `ToolDeclaration` 里可序列化的部分加 `group?`、`defaultForAll?`（`effect` 只写固定值，按参数求等级的由实现给函数），id 带插件前缀。审查 4 指出内核按工具 id 缓存实现、声明不变时不会释放，所以撤回由宿主在自己这一层处理，不改内核：

- 内核拿到的实现是宿主的一个包装，每个会话每个工具一个。包装第一次执行时触发 `onAgentTool:<id>`，等激活后从提供方当前的句柄 `create(会话上下文)` 建真正的实现，之后复用。
- 提供方撤回时：包装立刻标记这一代作废，之后的执行得 `tool-unavailable`；正在执行的调用继续，最多等 5 秒（平台停止的第一步，提案 P11），到时包装以 `tool-unavailable` 结算这次调用，之后提供方的迟到结果丢掉。有两个“完成”（审查第二轮 2）：交给平台的 `revoke` Promise 在所有调用结算或 5 秒到时完成，不等底层；真正的实现等它底层的执行都真正结束才 `dispose`，5 秒到时还没结束的写诊断 `tool-abandoned`，底层永远不结束就永远不 `dispose`（同进程的受信代码，没有强制终止的边界，提案 P11 的“放弃”一步）。提供方再激活后，包装下一次执行用新的一代重建实现。
- 内核释放包装（工具离开工具集、会话关闭）时，包装释放它持有的真正实现。
- 声明从清单来，提供方没激活也交给模型（决定 4）。

**`agent.profiles`**：实现式；声明 `{name, description, tools: {required, optional}}`，key 带插件前缀（`story.qa`）。列表从声明来；`profiles.resolve(key)` 时触发 `onAgentProfile:<key>` 再取实现；提供方撤回时对用它的打开着的会话调 `profilesChanged`，解析不到的进只读 `unknown-profile`，提供方回来后再调一次即恢复。

`nbook.agent` 自己的内置 Profile（t18）与内置工具（t12）也走这三个贡献点，不另开内部登记表（ADR 0027）。

### 3.4 Profile 目录、工具绑定与 Profile 设置（`backend/profiles.ts`、`backend/profile-bundles.ts`、`backend/tools.ts`、`shared/settings.ts`）

- **三层**：内置（`builtin.`，本 Task 没有，t18 加）、插件贡献（`<插件 id>.`）、用户级（`user.<名>`，源文件 `<状态根>/user/profiles/<名>.profile.tsx`）。key 由来源前缀区分，不覆盖。
- **用户级的装载器**（审查 16、18）：
  - 每个用户 Profile 一个状态机：当前发布的包、进行中的打包代次、最近一次失败。文件事件只把“要重新打包”记下，同一 Profile 同时只打一个包；打包开始时重新读源文件集合，完成时代次不是最新的就丢掉结果（旧包不会盖过新包）。
  - 打包：`Bun.build` 入口是源文件，外部模块只有宿主模块表里的；打包元数据里的输入就是要监听的文件集合。产物先写临时文件再改名到 `<状态根>/agent/cache/profiles/<名>-<内容哈希>.js`。一个状态根只有一个服务端（ADR 0033），不处理跨进程同时打包。
  - 外部导入检查：沿用第三方插件装载时对裸说明符的检查（`plugin-code-loading.md` 输出 4 的规则：不是共享模块、不是 Node 与 Bun 内置模块的以 `module-not-shared` 失败），实现上共用同一个检查函数。
  - 求值：导入新包，要求默认导出是内核 `defineProfile` 的结果；装载前删掉上一个包的模块缓存条目。
  - 版本（审查 17）：生效的 `version` 是 Profile 自己写的 `version` 加 `+` 加包的内容哈希前 12 位。重启后同一份源文件得到同一个哈希；源文件改了哈希就变，打开着的会话写 `profileChanged{code-updated}`、已提交的轮按新 Profile 重新渲染。
  - 失败：打包或求值失败时保留上一次成功的包继续用，目录里这个 Profile 标“有错误”并带原因与位置；从来没成功过的标“不可用”，用它的会话解析不到、进只读。源文件被删时 Profile 从目录消失，用它的会话进只读 `unknown-profile`。
  - 监听：`node:fs` 的 `watch` 监听 `user/profiles/` 目录与每个 Profile 打包元数据里的源文件；事件只作“可能变了”的信号，打包前以内容为准（编辑器先写临时文件再改名、一次保存多个事件都只触发一次打包）。
- **可用性**：用户级与插件 Profile 的必需工具不在生效声明里时，目录标“不可用”并写明缺哪个（t05）。
- **SDK 子路径 `@notnotype/nb-plugin-sdk/agent`** 与它的 JSX 运行时：转出内核的定义构造函数（`defineProfile`、`defineExtension`、`ext`、`slice` 等）、类型与 `./prompt` 的模板节点；登记在 `src/sdk/entries.ts`（服务端共享），插件 SDK 的包检查与纯度检查随之更新（打进了内核的插件构建失败）。
- **工具绑定**（t04 决定 4）：用户层设置项 `nbook.agent.toolBindings`，形状 `{[profileKey]: {added: string[]; removed: string[]}}`。会话的工具 = Profile 必需 + 可选 + 声明了 `defaultForAll` 的 + `added` − `removed`（必需的删不掉）；每个边界现算，改绑定从下一次请求起生效。
- **Profile 设置**（t05、t09）：用户层设置项 `nbook.agent.profileSettings`，形状 `{[profileKey]: {model?: string; role?: string; approvalMode?: ApprovalMode}}`。`model`、`role` 经 `modelsKey.port(profile => …)` 交给模型服务；`approvalMode` 是新会话的初值。
- 两个设置项本 Task 不做界面，可在设置文件里手改。

### 3.5 会话服务与推送（`backend/sessions.ts`、`backend/frames.ts`、`shared/contracts.ts`）

**`SessionEnv` 的装配**：`store` 是 `createJsonlStore({root: <状态根>/agent/sessions})`；`profiles`、`tools`、`extensions` 见第 3.3、3.4 节；`models` 是 `modelsKey.port(...)`，模型服务不可用时给一个总是 `unavailable` 的端口；`resources` 本 Task 只实现 `session://`（`<会话目录>/home/`），其余方案解析不到（t08）；`sessions.get(id, issuer)` 经句柄表打开、交回 `session.as(issuer)`；`clock` 用系统时钟；`approve` 见下；`outbound`、`compaction` 不给。

**审批**（t06 规则表之前的最小实现，README 决定 15）：`read` 放行；`yolo` 全放行；`allow-writes` 放行 `write`；其余 `ask`。

**句柄表**（审查 7）：自己维护，不用 `AgentHost` 里那张 Map 做并发控制。每个会话 id 一条记录，状态 `opening`、`open`、`closing`：

- 引用：命令与查询在执行期间、订阅在取消之前、`waitRun` 与 `startTask` 的 `result` 在完成之前各持一个引用；进行中的打开或关闭用共享的 Promise，同时到达的请求等同一个结果，不会两次碰存储锁。
- 交出的视图（审查第二轮 5）：`sessions.get(id, issuer)`、`agentKey` 与远程层拿到的都是句柄表的代理 `SessionApi`，本身不持引用；代理的每个方法调用时向句柄表取会话（没开就开）、按上面的规则持引用、调用完放掉。所以调用方可以长期拿着视图，会话照样能空闲关闭，下次调用再打开。
- 关闭：引用归零、没有运行时开始 30 秒的空闲计时（注入时钟）；到点时在同一个串行段里重新检查引用与运行，都没有才转 `closing`。`closing` 中到达的请求等关闭完成后重新打开，不撞还没释放的锁。
- 建会话：`create` 完成后记录直接进 `open`；同一个 id 的并发建会话由存储的 `session-exists` 裁决。

**远程合同 `nbook.agent/sessions`**（版本 1，服务端提供，调用方只有 `browser`；审查 11：项目实例要用时再按调用方身份与项目绑定的校验另加）：

- **调用方身份**（审查 9）：浏览器的调用都是用户，服务端对会话的指令与查询一律经 `session.as({kind: "user"})`；多 Agent 的会话身份只经同进程的 `sessions.get(id, issuer)` 与 `agentKey`，不经远程合同。
- **方法**：`list({project?, archived?, background?})`；`create({profile, initial?, project?})`；内核的全部指令（各带 `sessionId` 与 `commandId`）；查询（`snapshot`、`log`、`rewindTargets`、`path`、`siblings`、`runResult`、`preview`、`diagnostics`）；`profiles()`（目录、可用性与错误）；`eventChunk`、`previewChunk`（见下文“大小”）；`startTask`（第 3.6 节）。
- **失败码**（审查 12）：每个方法在合同里列自己的业务失败码与详情 schema，取内核那个指令或查询实际会给的码（`api/codes.ts` 按指令分的表）；通道保留的码（`unavailable`、`timeout`、`unknown-outcome` 等）不进业务码表。合同的 TypeBox 类型与内核类型之间用一个类型层的对照测试锁住。
- **大小**（审查 13、第二轮 6）：通道一条消息上限 1 MiB。远程合同用 Agent 自己的投影类型，不冒充内核类型：
  - `log` 的条目是 `{kind: "event", event} | {kind: "oversized", seq, type, bytes}`；按条数（内核上限 2000）之外再按编码后的字节数截断，每页不超过 512 KiB，`more` 照实给。`frames` 里的 `log` 帧同样用这个投影。
  - 大事件的读回：`eventChunk({sessionId, seq, index})` → `{text, last}`，把整条事件按 JSON 编码后按 256 KiB 切段，调用方按序拼起来再解析，不按字段分。
  - `preview` 的结果是 `{kind: "inline", preview} | {kind: "oversized", token, bytes}`，大的经 `previewChunk({token, index})` 同样分段读，令牌 5 分钟有效；`diagnostics` 按条数分页、每页同样受 512 KiB 限制。
  - 合并后的增量帧超过 64 KiB 就切开。
- **事件 `frames`**，过滤 `{sessionId}`（审查 14）：每个远程订阅持有一个自己的内核订阅（`session.subscribe`），在这个订阅里合并：同一请求、同一部分、同一调用的连续增量拼成一帧，100 毫秒最多推一次；任何非增量帧到达时先推出攒着的增量，顺序不变；合并后按本订阅重新编号 `n`。远程订阅结束时取消内核订阅与计时器、放掉句柄引用。
- **补齐**：调用方先订阅、再用 `log({afterSeq})` 补到 `through`，丢掉 seq 不大于它的帧；`onResync` 时按最后收到的 seq 再补一次（决定 5）。补齐只看日志的 seq，不重放增量；服务端换了进程时订阅以 `server-restarted` 结束，调用方重新开始。

### 3.6 `agent.startTask`（决定 7、README 决定 12）

- 远程方法 `startTask({taskId, profile, initial?, input, project?, background?})` → `{sessionId, runId}`，写操作（审查 10、20、第二轮 3）。`taskId` 由调用方生成，格式是 UUID；服务端用 `task-<taskId>` 作会话 id 建会话（内核自己生成的会话 id 不带这个前缀，普通会话不会撞上）。已存在（`session-exists`）时打开它，核对会话头的 Profile、项目与 `background` 与这次的参数一致，不一致得 `task-conflict`；一致就以 `taskId` 作 `commandId` 发一次 `send`（空闲时同时开始运行）。同一个 `commandId` 参数不同时内核得 `command-id-conflict`，原样作为 `task-conflict` 交回。所以调用结果未知时调用方用同一个 `taskId` 重发，得到同一个 `{sessionId, runId}`，跨服务端重启也成立（幂等记录就是会话日志本身）；会话已建、`send` 前失败的，重发补上 `send`。
- 结果从 `runResult({sessionId, runId})` 取，运行结束时 `frames` 里有 `runEnded`。
- 服务键 `agentKey`：`startTask(...)` → `{sessionId, runId, result: Promise<RunResult>}`，`result` 即内核的 `waitRun`，期间持有句柄引用；另有 `running(): {sessionId, profile}[]`，留给以后禁用前的确认界面。
- `background: true` 写进会话头（第 3.1 节第 3 条），会话列表默认不列。

### 3.7 停止与撤回对运行中会话的影响（决定 6）

| 什么停了 | 会话怎样 | 由谁保证 |
|---|---|---|
| 工具的提供方 | 声明保留；之后的调用 `tool-unavailable`；执行中的最多等 5 秒，到时结算为 `tool-unavailable` | 第 3.3 节的工具包装 |
| 扩展的提供方 | 运行中跳过它、空闲时重新装配，缺依赖进只读 | 内核（`extensions.md` 输出 26、27） |
| Profile 的提供方 | 用它的会话 `profilesChanged`，解析不到进只读 | 第 3.1、3.3 节 |
| `nbook.models` | 下一次请求 `unavailable` | 第 3.5 节的端口 |
| `nbook.agent` 自己 | 关门、所有会话按 `interrupted` 关闭 | 第 3.2 节 |

禁用前列出运行中会话的确认界面依赖平台的运行期热插拔（planned），本 Task 不做。

## 4. Spec 与文档改动

- 新建 `docs/specs/agent/contributions.md`（planned，`agent.contributions`）：三个贡献点的声明形状、id 规则、激活事件与提供方的约束（必须声明 `onAgentSession`、不能依赖 `agentKey`）、工具绑定的合成规则、Profile 三层与可用性、用户级 Profile 的打包、版本、失败与重载（写明这是“状态根不运行期编译”的受信例外）、停止与撤回的影响（第 3.7 节的表）。
- 新建 `docs/specs/agent/sessions.md`（planned，`agent.sessions`）：会话存放与列表、句柄寿命、远程合同的方法与失败码、大小上限与占位、`frames` 的合并与补齐、`startTask` 的幂等与 `agentKey`、审批的最小规则、停止的关门与收口。依赖 `agent.contributions`，单向。
- `harness/runtime.md` 输出 15（宿主的声明是最终工具集）、57（`profilesChanged`）；`harness/session.md` 输出 19（列表条目带 `background`）；会话头的字段表。
- `runtime/plugin-code-loading.md` 目标与非目标：注明用户级 Profile 的运行期打包是 `agent.contributions` 定义的例外。
- `runtime/plugin-manifest.md` 第 72 行的例子 `onAgentTool:<工具名>` 改成 `onAgentTool:<工具 id>`。
- `docs/specs/README.md` 注册两份新 Spec；`agent/harness.md`（旧 harness 的 Spec）不动，由迁移 Task 处理。

## 5. 切片

| 片 | 内容 | 对应 | 自跑验证 |
|---|---|---|---|
| 0 | 内核三处改动 | 3.1 | `bun test packages/nb-harness`、nb-story 的内核验收门 |
| 1 | 两份 Spec 与内核 Spec 的改动（master） | 4 | `bun run docs:check` |
| 2 | 插件描述、服务端入口与停止门、三个贡献点的接收方（扩展适配器、工具包装）、激活事件、登记、两个设置项、插件 Profile 目录、句柄表与同进程的 `agentKey`；内核 `AgentHost.close` 加 `interrupted` | 3.2、3.3、3.4 的绑定与设置、3.5 的句柄表 | 插件测试、`builtin-manifest.test.ts`、全量 `bun test` |
| 3 | SDK 子路径 `agent`；用户级 Profile 的装载器与重载、可用性 | 3.4 | 插件测试（真实文件改动、改名保存、打包失败）、插件 SDK 的包与纯度检查 |
| 4 | 远程合同、大小上限与投影、`frames` 的合并与补齐 | 3.5 | 插件测试（真实远程链路、本机假模型端点） |
| 5 | `startTask`、余下的停止与撤回场景 | 3.6、3.7 | 插件测试 |
| 6 | 收口：`test:affected`、`test:llm` 加一条真实模型（DeepSeek）经远程合同跑一轮 | — | 见第 7 节 |

实施中的调整（2026-11-01）：第 2 片的接收者要有会话宿主才测得到，句柄表与同进程的 `agentKey` 从第 4 片挪进第 2 片；SDK 子路径挪到第 3 片，与用到它的用户级 Profile 一起做。激活事件要带参数（平台的 `<前缀>:<参数>`），`onAgentSession` 实际是 `onAgentSession:open`；模型服务不在时内核没有 `unavailable` 码，用 `no-model`；扩展提供方“没声明事件”的诊断做不出来（平台不给入口的激活事件），改为由写清单的助手保证。Spec 已随之改。

每片单独提交；第 0 片（改内核）与第 4 片（并发多）完成后当场派实现审查，其余在收口时一次审。

## 6. 验收映射

Spec 编号在第 1 片写定后回填；先按场景列。测试都用真实服务端内核、真实远程链路（`createRemoteRouter`），不直接调内部函数。

| 场景 | 测试 |
|---|---|
| Profile 写了 `tools` 时，绑定加的与 `defaultForAll` 的工具也交给模型；必需缺失仍只读 | nb-harness `tests/kernel/` |
| `profilesChanged`：同哈希也换对象；哈希变写 `code-updated`；解析不到只读、回来后恢复；运行中等运行结束 | nb-harness `tests/kernel/` |
| 扩展：每次建或开会话前触发 `onAgentSession`，晚登记的提供方下次被激活；`prepare` 抛错时平台整批回滚、内核不留预占；提供方依赖 `agentKey` 时激活失败并有诊断 | `agent.test.ts`“扩展” |
| 工具：声明不激活也给模型，第一次执行激活提供方；撤回后新调用 `tool-unavailable`；执行中的调用 5 秒后结算、实现随后释放；提供方回来后重建 | `agent.test.ts`“工具”（注入时钟） |
| 绑定：缺省合成、`added`、`removed`、必需删不掉，改了下一次请求生效 | `agent.test.ts`“绑定” |
| 用户级 Profile：改它导入的本地文件后重新打包、会话下一次请求用新的；先写临时文件再改名只打一次包；打包失败保留旧包并标错；从未成功的标不可用；导入表外模块 `module-not-shared`；删掉源文件后会话只读 | `profiles.test.ts` |
| 句柄表：两个窗口同时首次打开得到同一个句柄；空闲关闭进行中来命令，等关闭后重开；空闲 30 秒后关闭 | `sessions.test.ts`（注入时钟） |
| 窗口 A 发起运行、关掉，窗口 B 订阅后补齐；断线重连后 `onResync` 补齐不漏不重 | `sessions.test.ts` |
| 增量 100 毫秒合并、按订阅编号，非增量帧前先推出；两个订阅互不影响 | `sessions.test.ts`（注入时钟） |
| 大小：超过 256 KiB 的事件换占位、经 `event` 分段读回；`log` 按字节分页 | `sessions.test.ts` |
| 失败码：每个方法的业务码经真实链路到达调用方，详情合 schema | `sessions.test.ts` |
| `startTask` 立即返回；同一 `taskId` 重发得同一 `{sessionId, runId}`；建了会话、没 `send` 时重发补上；`agentKey` 的 `result` 完成 | `sessions.test.ts` |
| 停止：关门后的调用 `unavailable`；打开进行中的会话也被关闭；运行写 `interrupted` | `sessions.test.ts` |
| 停止时进行中的 Profile 打包完成后不发布 | `profiles.test.ts` |
| `startTask` 的 `taskId` 撞上参数不同的已有任务得 `task-conflict` | `sessions.test.ts` |
| 写请求发出后断线得 `unknown-outcome`，同一 `taskId`、`commandId` 重发得到同一个结果 | `sessions.test.ts`（真实链路断开连接） |
| 代理视图：长期持有的视图不挡空闲关闭，下次调用重新打开 | `sessions.test.ts`（注入时钟） |
| 工具撤回：底层永不结束时平台的撤回 5 秒完成、写 `tool-abandoned`、不 `dispose` | `agent.test.ts`“工具” |
| 新建会话时 Profile 依赖的扩展激活失败：建会话失败、详情带缺的依赖 | `agent.test.ts`“扩展” |
| `background`：建会话写入、fork 不继承、索引重建后还在 | nb-harness `tests/kernel/` |
| 模型服务不在时请求 `unavailable` | `sessions.test.ts` |
| 真实模型一轮（经远程合同） | `agent.llm.test.ts` |

## 7. 验证

- 测试照 `plugins/models/testing/world.ts` 建一个 `agentWorld`：真实服务端内核、真实设置与远程链路、本机的假 OpenAI 兼容端点；时间相关的用注入时钟，不按固定时长等。
- 收口：`bun run test:affected`、`bun run governance:check`、`bun run docs:check`、`test:llm`（DeepSeek，密钥只按白名单取）。
- 没有界面，本 Task 不跑 e2e；未验证的边界：浏览器侧的帧消费（t17）、平台运行期热插拔下的撤回（planned）。

## 8. 不做与风险

**不做**：项目级入口与项目实例作调用方（t12 或要用时）、浏览器入口与界面（t17）、六个后续贡献点（t08 `agent.docs`、t11 `agent.compactionMethods`、t15 `agent.skills`、t17 `agent.slashCommands`、`agent.references`、`agent.toolRenderers`）、内置 Profile（t18）与内置工具（t12）、t06 的规则表、`session://` 以外的资源方案（t08）、旧格式迁移脚本（迁移 Task）、nb-story 迁到新内核、两个设置项的界面、积压断开（README 决定 11）。

**风险**：

- 用户 Profile 每次重新打包留下约一个模块大小的内存（t05 实测可接受）。
- `@notnotype/nb-plugin-sdk/agent` 把内核的定义接口变成插件的公开接口：以后内核改定义接口就是 SDK 的破坏性变更。
- 工具撤回的 5 秒等待在提供方卡住时会让平台的停止多等 5 秒；底层永远不结束的工具实现永远不释放（受信的同进程代码，没有隔离）。
- 远程合同的类型与内核类型两处要同步，靠类型层的对照测试发现漂移。

## 9. 待确认（开发者 2026-11-01 已按推荐确认，见 README 决定 9–15）

1. 范围线：三个贡献点与服务端入口。
2. `agent.profiles` 实现式。
3. 不做积压断开。
4. `startTask` 立即返回，结果另取。
5. `onAgentSession`、`onAgentProfile:<key>`。
6. SDK 子路径 `@notnotype/nb-plugin-sdk/agent`。
7. 句柄 30 秒、最小审批规则。

设计审查后新增、按推荐做的取舍（不改已确认的方向，汇报时列出）：远程合同只给浏览器调用（审查 11）；`onAgentSession` 每次建或开会话前触发（审查 6）；工具撤回等 5 秒（审查 4）；用户 Profile 的生效版本带包哈希（审查 17）；会话头加 `background`（审查 15）。
