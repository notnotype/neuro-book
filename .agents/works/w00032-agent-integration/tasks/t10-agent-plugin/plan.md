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

**工作方式。** 开发者在场，按 implementation-planning：本稿先给开发者看要点、确认第 9 节的待确认项，再交 omp 做设计审查（后端与设计，阻塞）。代码在 Work 分支 `feat/w00032-agent-integration`（先快进到最新 master），Spec 与 Task 记录在主工作区的 master。

## 2. 技术选型

| 问题 | 选用 | 理由 | 否决 |
|---|---|---|---|
| 会话日志与锁 | 内核的 `createJsonlStore({root: <状态根>/agent/sessions})` | 现成：操作系统独占锁、`index.json` 列表按项目过滤 | 存进 `nbook.storage`（记录上限 1 MiB，不适合日志） |
| 用户级 Profile 打包 | `Bun.build`（target bun，SDK 与 JSX 运行时作外部模块，按内容哈希命名），装载走第三方插件同一条路（宿主模块表） | t05 第三轮已定；Bun 自带，不加依赖；与插件代码同一种信任与装载规则 | 直接 `import()` 源文件（Profile 导入的本地文件改了不生效、缓存删不干净） |
| 监听用户 Profile 的源文件 | `node:fs` 的 `watch`，只监听打包元数据里列出的源文件与 `user/profiles/` 目录 | 与 `server/dev/watch.ts` 同一写法；目录很小 | `chokidar`（多一个依赖，换不来什么） |
| 推送 | 远程服务的事件（`eventSource`），流式增量按 100 毫秒合并 | 决定 5：不另开 SSE；通道已有订阅、重建与 `onResync` | 照 nb-story 另开 SSE 端点 |

## 3. 关键设计

### 3.1 `packages/nb-harness`：Profile 代码变了通知打开着的会话

- `AgentHost` 新增 `profilesChanged(keys: readonly string[]): Promise<void>`：对用这些 Profile、打开着的会话按 `notifyExtensionsChanged` 同样的时机重新装配（运行中的等这次运行结束、空闲的立即），哈希变了写 `profileChanged{reason: "code-updated"}`；装配失败进只读（`dependency-missing` 或 `reassembly-failed`），与扩展撤回同一条路。
- 不变量：Profile 对象只经 `profiles.resolve` 取，会话不长期持有旧对象（t05 第三轮的回收前提）；哈希仍不算源码（`extensions.md` 输出 28），改了提示词不升 `version` 时下一次请求已用新对象，只是不写 `profileChanged`。
- `runtime.md` 输出 57 追加一句；测试在 `tests/kernel/` 的宿主场景里补。

### 3.2 `packages/neuro-book/src/plugins/agent/`（新插件 `nbook.agent`，本 Task 只有服务端入口）

照 `plugins/models/` 的布局：`plugin.ts`（描述，`locations: ["server"]`）、`shared/`（贡献点、合同、设置项、服务键）、`backend/`（入口与实现）、`locales/`。登记进 `src/manifest.ts`、`src/server/plugins.ts`、`builtin-names`（中文名“Agent”）与消息目录检查的列表。

服务端入口 `server`：

- **依赖**：必需 `diagnosticsKey`、`stateRootKey`、`settingsKey`；可选 `modelsKey`（不在时会话照常打开，发请求时以 `unavailable` 失败，决定 6）。Storage 本 Task 用不上，不列。
- **接收**：`agent.extensions`、`agent.tools`、`agent.profiles`（第 3.3 节）。
- **提供**：远程服务 `nbook.agent/sessions`（第 3.5 节）、服务键 `agentKey`（第 3.6 节）。
- **激活**：不写 `onStartup`，与 `nbook.models` 一样在远程服务首次被调用或服务键首次被依赖时激活。
- **停止**（`context.onStop`）：逐个 `closeSession(s, {reason: "interrupted"})`（运行写 `interrupted`、重新启用后界面据此显示“上次运行被中断”，t07 决定 7），再停监听与打包缓存。应用停止走同一路径。

### 3.3 贡献点与激活事件

本 Task 实现三个，其余六个在用到它们的 Task 里定义（第 9 节待确认 1）：

| 贡献点 | 形状 | 接收方做什么 | 激活事件 |
|---|---|---|---|
| `agent.extensions` | 实现；声明 `{tags?, dependsOn?}`（内核 `ExtensionDeclaration`），id 带插件前缀 | 平台的 `prepare/published/revoke` 转给 `AgentHost.extensions`；平台的撤回原因映射到内核的 `RevokeReason` | `onAgentSession`：本进程第一次建或开会话之前触发一次，激活所有提供扩展的入口（扩展从装配起就参与归约，不能等用到才激活） |
| `agent.tools` | 实现；声明是 `ToolDeclaration` 里可序列化的部分加 `group?`、`defaultForAll?`；`effect` 声明里只写固定值，按参数求等级的工具由实现给函数；id 带插件前缀 | 声明从清单来，不激活也交给模型（决定 4）；第一次调用某个工具时触发 `onAgentTool:<id>`，再取实现、按会话建一次（`create(会话上下文)`）；实现撤回后已建的释放，之后的调用得 `tool-unavailable`，声明保留（t04 方案 D） | `onAgentTool:<工具 id>` |
| `agent.profiles` | 实现；声明 `{name, description, tools: {required, optional}}`，key 带插件前缀（`story.qa`） | 列表从声明来；解析时触发 `onAgentProfile:<key>` 再取实现；撤回时对用它的打开着的会话调 `profilesChanged`，解析不到的进只读（`unknown-profile`） | `onAgentProfile:<key>` |

- 决定 2 的 `agent.hooks` 由 t20 改成扩展：钩子就是扩展里的 `intercept`、`on`、`contribute`，贡献点叫 `agent.extensions`（内核已按这个名字实现）。决定 4 的 `onAgentHook:<钩子点>` 随之改成 `onAgentSession`。
- 决定 2 写的 `agent.profiles`“声明式、插件包里 `.profile.tsx` 的路径，Agent 插件打包加载”改成实现式（第 9 节待确认 2）：内置插件在打包好的应用里没有源文件路径；第三方插件的入口已由 SDK 构建预设打成一个文件、按宿主模块表装载，Profile 跟着入口走，升级时随插件重载。打包加哈希只用于用户级 Profile。
- `nbook.agent` 自己的内置 Profile（t18）与内置工具（t12）也走这三个贡献点，不另开内部登记表（ADR 0027：内置与第三方同等）。

### 3.4 Profile 目录、工具绑定与 Profile 设置（`backend/profiles.ts`、`backend/tools.ts`、`shared/settings.ts`）

- **三层**：内置（`builtin.`，本 Task 没有，t18 加）、插件贡献（`<插件 id>.`）、用户级（`user.`，`<状态根>/user/profiles/<名>.profile.tsx`）。同名不覆盖：key 由来源前缀区分。
- **用户级的装载**：`Bun.build` 打成一个文件放 `<状态根>/agent/cache/profiles/<名>-<内容哈希>.js`，外部模块只有宿主模块表里的（新增 SDK 子路径 `@notnotype/nb-plugin-sdk/agent` 与它的 JSX 运行时），表外的导入按 `module-not-shared` 失败；装载前删掉上一个包的模块缓存条目。只监听打包元数据里的源文件与目录本身；文件改了重新打包，哈希变了调 `profilesChanged`。打包或求值失败时这个 Profile 在列表里标“不可用”并带原因，用它的会话进只读。
- **可用性**：用户级与插件 Profile 的必需工具不在生效声明里时，列表标“不可用”并写明缺哪个（t05）。
- **SDK 子路径 `@notnotype/nb-plugin-sdk/agent`**：转出内核的 `defineProfile`、`defineExtension`、`ext`、`slice` 等定义用的构造函数、类型与 `./prompt` 的模板节点；JSX 运行时另一个子路径。登记在 `src/sdk/entries.ts`（服务端共享），插件 SDK 的包检查随之更新。
- **工具绑定**（t04 决定 4）：用户层设置项 `nbook.agent.toolBindings`，形状 `{[profileKey]: {added: string[]; removed: string[]}}`。会话的工具 = Profile 必需 + 可选 + 声明了 `defaultForAll` 的 + `added` − `removed`（必需的删不掉）；每个边界现算（内核 `tools.declarations` 每个边界调一次），所以改绑定从下一次请求起生效。
- **Profile 设置**（t05、t09）：用户层设置项 `nbook.agent.profileSettings`，形状 `{[profileKey]: {model?: string; role?: string; approvalMode?: ApprovalMode}}`。`model`、`role` 经 `modelsKey.port(profile => …)` 交给模型服务；`approvalMode` 是新会话的初值。
- 两个设置项本 Task 不做界面（设置页随 t17 或单独的 Task），可在设置文件里手改。

### 3.5 会话服务与推送（`backend/sessions.ts`、`shared/contracts.ts`）

**`SessionEnv` 的装配**：`store` 见上；`profiles`、`tools`、`extensions` 见第 3.3、3.4 节；`models` 是 `modelsKey.port(...)`，模型服务不可用时给一个总是 `unavailable` 的端口；`resources` 本 Task 只实现 `session://`（`<会话目录>/home/`），其余方案解析不到（t08）；`sessions.get` 走本服务的打开表；`clock` 用系统时钟；`approve` 见下；`outbound` 不给；`compaction` 不给（t11）。

**审批**（t06 的规则表之前的最小实现）：`read` 放行；`yolo` 全放行；`allow-writes` 放行 `write`；其余 `ask`。t12 按推进建议补 yolo 与 auto 的完整语义。

**会话句柄的寿命**：命令、查询或订阅到达时打开（已开就复用）；没有订阅者、没有运行、30 秒内没有命令时关闭。同一会话只在本服务端打开一次（锁由内核保证，t03 决定 5）。

**远程合同 `nbook.agent/sessions`**（版本 1，服务端提供，调用方 `browser`、`project`）：

- 方法：`list({project?, archived?})`；`create({profile, initial?, project?})`；内核的全部指令（`send`、`enqueue`、`edit`、`remove`、`resolve`、`start`、`abort`、`rewind`、`switchBranch`、`fork`、`compact`、`changeSettings`、`changeProfile`、`setTitle`、`archive`，各带 `sessionId` 与 `commandId`）；查询（`snapshot`、`log`、`rewindTargets`、`path`、`siblings`、`runResult`、`preview`、`diagnostics`）；`profiles()`（目录与可用性）；`startTask`（第 3.6 节）。输入、输出与失败码照内核类型写成 TypeBox；失败码照内核 `api/codes.ts` 原样透传。
- 事件 `frames`，过滤 `{sessionId}`：照内核的帧（`log`、`delta`、`status`、`diagnostic`、`progress`）。`delta` 按订阅者合并：同一请求、同一部分、同一调用的连续增量拼成一帧，100 毫秒最多推一次；`log`、`status` 到达时先推出攒着的增量，顺序不变。
- 补齐：调用方先订阅、再用 `log({afterSeq})` 补到 `through`，丢掉 seq 不大于它的帧；`onResync` 时按最后收到的 seq 再补一次（决定 5）。服务端换了进程时订阅以 `server-restarted` 结束，调用方重新开始。
- 多个窗口订阅同一会话共用一个打开的句柄，每个订阅一份合并缓冲。
- 不做“积压过多断开”（第 9 节待确认 3）：通道不报积压，本 Task 只靠合并压低帧数。

### 3.6 `agent.startTask`（决定 7）

- 远程方法 `startTask({profile, initial?, input, project?, background?})` → `{sessionId, runId}`，建会话、受理输入、开始运行后立即返回；结果从 `runResult({sessionId, runId})` 取，运行结束时 `frames` 里有 `runEnded`。不挂在一次调用上等结果：运行可能停下等审批，通道合同不把等用户的长交互挂在调用上（`plugin-channel.md` 目标与非目标）。
- 服务键 `agentKey`（同进程的服务端插件用，例如以后的 nb-story 插件）：`startTask(...)` → `{sessionId, runId, result: Promise<RunResult>}`，`result` 即内核的 `waitRun`。
- `background` 只记进会话头供列表区分（后台会话默认不进会话列表），本 Task 不做别的。

### 3.7 停止与撤回对运行中会话的影响（决定 6）

| 什么停了 | 会话怎样 | 由谁保证 |
|---|---|---|
| 工具的提供方 | 声明保留；之后的调用 `tool-unavailable`；执行中的调用超时由内核结算为已中断 | 第 3.3 节的接收方 + 内核 |
| 扩展的提供方 | 运行中跳过它、空闲时重新装配，缺依赖进只读 | 内核（`extensions.md` 输出 26、27） |
| Profile 的提供方 | 用它的会话 `profilesChanged`，解析不到进只读 | 第 3.1、3.3 节 |
| `nbook.models` | 下一次请求 `unavailable` | 第 3.5 节的端口 |
| `nbook.agent` 自己 | 所有会话按 `interrupted` 关闭 | 第 3.2 节 |

禁用前列出运行中会话的确认界面依赖平台的运行期热插拔（planned），本 Task 不做；`agentKey` 提供 `running(): {sessionId, profile}[]` 留给那时用。

## 4. Spec 与文档改动

- 新建 `docs/specs/agent/contributions.md`（planned，`agent.contributions`）：三个贡献点的声明形状、id 规则、激活事件、工具绑定的合成规则、Profile 三层与可用性、用户级 Profile 的打包与重载、停止与撤回的影响（第 3.7 节的表）。
- 新建 `docs/specs/agent/sessions.md`（planned，`agent.sessions`）：会话存放与列表、句柄寿命、远程合同的方法与 `frames`、合并与补齐、`startTask` 与 `agentKey`、审批的最小规则、`nbook.agent` 停止时的收口。依赖 `agent.contributions`，单向。
- `harness/runtime.md` 输出 57：补 `profilesChanged`。
- `runtime/plugin-manifest.md` 第 72 行的例子 `onAgentTool:<工具名>` 改成 `onAgentTool:<工具 id>`。
- `docs/specs/README.md` 注册两份新 Spec；`agent/harness.md`（旧 harness 的 Spec）不动，由迁移 Task 处理。
- t10 README 记下第 9 节的结论与决定 2、4 的改动。

## 5. 切片

| 片 | 内容 | 对应 | 自跑验证 |
|---|---|---|---|
| 0 | Work 分支快进到 master；内核 `profilesChanged` | 3.1 | `bun test packages/nb-harness` |
| 1 | 两份 Spec（master） | 4 | `bun run docs:check` |
| 2 | 插件描述、服务端入口、三个贡献点与接收方、激活事件、登记、两个设置项、SDK 子路径 `agent` | 3.2、3.3、3.4 的绑定与设置 | 插件测试、`builtin-manifest.test.ts`、插件 SDK 的包检查 |
| 3 | Profile 目录：插件层、用户层的打包与重载、可用性 | 3.4 | 插件测试（真实文件改动与重新打包） |
| 4 | 会话服务：`SessionEnv`、审批、句柄寿命、远程合同、`frames` 的合并与补齐 | 3.5 | 插件测试（真实远程合同、本机假模型端点） |
| 5 | `startTask`、`agentKey`、停止与撤回 | 3.6、3.7 | 插件测试 |
| 6 | 收口：`test:affected`、`test:llm` 加一条真实模型（DeepSeek）经远程合同跑一轮 | — | 见第 7 节 |

每片单独提交；第 4 片完成后当场派实现审查（没把握的切片当场审），其余在收口时一次审。

## 6. 验收映射

Spec 编号在第 1 片写定后回填；先按场景列：

| 场景 | 测试 |
|---|---|
| 插件贡献的工具：声明不激活也给模型，第一次调用激活提供方；提供方停止后 `tool-unavailable`、声明还在 | `agent.test.ts`“工具” |
| 扩展：第一次开会话前激活提供方；运行中撤回跳过、空闲重新装配 | `agent.test.ts`“扩展” |
| 工具绑定：缺省合成、`added`、`removed`、必需删不掉，改了下一次请求生效 | `agent.test.ts`“绑定” |
| 用户级 Profile：改它导入的本地文件后重新打包，打开着的会话下一次请求用新的；导入表外模块标不可用 | `profiles.test.ts` |
| 窗口 A 发起运行、关掉，窗口 B 订阅后补齐到最新；断线重连后 `onResync` 补齐不漏不重 | `sessions.test.ts` |
| 增量 100 毫秒合并，`log` 帧之前先推出攒着的增量 | `sessions.test.ts`（注入时钟） |
| 无订阅、空闲 30 秒后关闭句柄，再来命令时重开 | `sessions.test.ts`（注入时钟） |
| `startTask` 立即返回，`runResult` 拿到收尾工具的参数；`agentKey` 的 `result` 完成 | `sessions.test.ts` |
| 模型服务不在时请求 `unavailable`；`nbook.agent` 停止时运行写 `interrupted` | `sessions.test.ts` |
| 真实模型一轮（经远程合同） | `agent.llm.test.ts` |

## 7. 验证

- 测试用真实服务端内核、真实设置与远程合同（照 `plugins/models/testing/world.ts` 建一个 `agentWorld`）、本机的假 OpenAI 兼容端点；时间相关的用注入时钟，不按固定时长等。
- 收口：`bun run test:affected`、`bun run governance:check`、`bun run docs:check`、`test:llm`（DeepSeek，密钥只按白名单取）。
- 没有界面，本 Task 不跑 e2e；未验证的边界：浏览器侧的帧消费（t17）、平台运行期热插拔下的撤回（planned）。

## 8. 不做与风险

**不做**：项目级入口（t12 有第一个要项目数据的工具时建）、浏览器入口与界面（t17）、六个后续贡献点（t08 `agent.docs`、t11 `agent.compactionMethods`、t15 `agent.skills`、t17 `agent.slashCommands`、`agent.references`、`agent.toolRenderers`）、内置 Profile（t18）与内置工具（t12）、t06 的规则表、`session://` 以外的资源方案（t08）、旧格式迁移脚本（迁移 Task）、nb-story 迁到新内核、两个设置项的界面。

**风险**：

- 用户 Profile 的打包每次留下约一个模块大小的内存（t05 实测可接受）；频繁保存时打包的耗时与并发，按“同一 Profile 同时只打一个包、后到的合并成一次”处理。
- 宿主模块表新加 `@notnotype/nb-plugin-sdk/agent`，把内核的定义接口变成插件的公开接口：以后内核改定义接口就是 SDK 的破坏性变更。
- 远程合同的输入输出照内核类型写成 TypeBox，内核类型改了要同步改；用一个类型层的对照测试锁住。

## 9. 待确认

1. **本 Task 的范围线**：只实现 `agent.extensions`、`agent.tools`、`agent.profiles` 三个贡献点与服务端入口；其余六个贡献点、项目级入口、浏览器入口在用到它们的 Task 里建，不先建空壳。（推荐：这样每个贡献点建的时候就有使用方和测试。）
2. **`agent.profiles` 改成实现式**（第 3.3 节）：插件的 Profile 跟着插件入口装载，打包加哈希只用于用户级 Profile。（推荐，理由见第 3.3 节。）
3. **不做“积压过多断开”**：通道没有发送背压（`plugin-channel.md` 明写不做），本 Task 只做 100 毫秒合并；真要断开得先给通道加背压，另开 Task。（推荐。）
4. **`startTask` 立即返回 `{sessionId, runId}`**，结果另取（第 3.6 节），与决定 7 的“结果为 `TurnResult`”在远程调用上不同；同进程的 `agentKey` 给 `Promise`。（推荐。）
5. **激活事件**：`onAgentHook:<钩子点>` 改成 `onAgentSession`，并新增 `onAgentProfile:<key>`。（随 t20 的改动，推荐。）
6. **新增 SDK 子路径 `@notnotype/nb-plugin-sdk/agent`**，内核的定义接口成为插件 SDK 的公开接口。（推荐：否则第三方插件与用户 Profile 都写不了。）
7. **句柄寿命 30 秒**、**审批的最小规则**（第 3.5 节）：小的实现取值，按推荐定，不同意再改。
