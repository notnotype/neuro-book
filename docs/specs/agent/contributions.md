---
schema: nbook.spec/v1
kind: behavior
status: implemented
capability: agent.contributions
owners:
  - nbook.agent
---

# Agent 的贡献点：扩展、工具与 Profile

## 目标与非目标

插件经 `nbook.agent` 的三个贡献点给 Agent 加扩展、工具与 Profile；用户在状态根里写自己的 Profile，改了文件即时生效；用户按 Profile 增删工具。本 Spec 定义贡献的形状、何时激活提供方、会话的工具集与 Profile 目录怎样算出来，以及提供方停止时运行中的会话怎样。

不承诺：

- 这里只定义三个贡献点：`agent.extensions`、`agent.tools`、`agent.profiles`。压缩方法的 `agent.compactionMethods` 见 [`compaction.md`](compaction.md)。文档、Skill（`agent.skills`，见 [`skills.md`](skills.md) 的插件来源）、斜杠命令、`@` 引用与工具渲染器的贡献点由各自的能力定义。
- 没有内置 Profile；内置工具见 [`agent.builtin-tools`](builtin-tools.md)，内置扩展见 [`agent.run-guards`](run-guards.md)。它们同样经这三个贡献点交出，没有内部登记表（[ADR 0027](../../adr/0027-builtin-and-third-party-plugins-are-equal.md)）。
- 禁用插件前列出运行中会话的确认，依赖平台的运行期热插拔（[`runtime/plugin-hot-plug.md`](../runtime/plugin-hot-plug.md)）。
- 用户级 Profile 是受信的用户代码，与插件同等信任，不隔离。
- 底层永远不结束的工具调用，它的实现永远不释放（同进程代码，没有强制终止的边界）。

## 术语与参与者

- **提供方**：在入口里交出贡献的插件入口。
- **工具包装**：`nbook.agent` 交给内核的工具实现，每个会话每个工具一个；它在第一次执行时向提供方要真正的实现，撤回时作废。
- **代**：提供方一次激活交出的贡献；停止、再激活是新的一代。
- **用户级 Profile**：`<状态根>/user/profiles/<名>.profile.tsx`，key 为 `user.<名>`。

会话、Profile、扩展、工具声明的含义见 [`harness/runtime.md`](../harness/runtime.md) 与 [`harness/extensions.md`](../harness/extensions.md)。

## 输入与前置条件

| 贡献点 | 形状 | 声明（清单里，不激活就可读） | id |
|---|---|---|---|
| `agent.extensions` | 实现 | `{tags?: string[]; dependsOn?: string[]; install?: "on-request"}` | `<插件 id>.<名>` |
| `agent.tools` | 实现 | 工具声明里可序列化的部分（说明、参数、`providerName?`、`version`、`finish`、`concurrency`、`strict`、`effect` 的固定值）加 `group?: string`、`defaultForAll?: boolean`、`customFormat?: {syntax: "lark", definition: string}`（原样转给内核，模型按这份语法写参数） | `<插件 id>.<名>`，规则同 [`harness/models.md`](../harness/models.md) 的工具 id |
| `agent.evalObjects` | 无（只有声明） | `{name: string, summary: string, docs?: string}`：`name` 是 JS 标识符，`summary` 一行说明，`docs` 是 Markdown | `<插件 id>.<名>` |
| `agent.statusItems` | 实现（只接受浏览器入口） | `{title: Text, description?: Text, side: "left" \| "right", defaultVisible?: boolean}` | `<插件 id>.<名>` |
| `agent.profiles` | 实现 | `{name, description, tools: {required: string[]; optional: string[]}, role?: string, hidden?: boolean, defaultTools?: false, icon?: string, modelNeeds?: {vision?: boolean; thinking?: boolean; minContext?: number}, referencedExtensions?: string[]}`（`icon` planned） | `<插件 id>.<名>` |

- 实现：扩展是内核 `defineExtension` 的结果；工具是工厂 `{create(会话上下文): ToolImplementation}`，实现可以给按参数求等级的 `effect` 函数；Profile 是内核 `defineProfile` 的结果。工厂的第二个参数 `services` 带这个会话的资源视图 `services.resources`，工具经它按资源地址读写（[`agent.resources`](resources.md)）；`services.artifacts` 以宿主身份保存大结果的全文（同一 Spec 输出 11）。
- 激活事件前缀归 `nbook.agent`：`onAgentSession:open`、`onAgentTool:<工具 id>`、`onAgentProfile:<key>`（平台的事件都是“前缀:参数”，`onAgentSession` 的参数固定为 `open`）。提供方入口自己写上这些事件；SDK 的 `agentExtension`、`agentTool`、`agentProfile` 助手连同贡献声明一起给出。
- 设置项（用户层）：

```ts
"nbook.agent.toolBindings":   {[profileKey: string]: {added: string[]; removed: string[]}}
"nbook.agent.profileSettings": {[profileKey: string]: {model?: string; role?: string; approvalMode?: ApprovalMode}}
```

- 插件与用户 Profile 的代码经 SDK 子路径 `@notnotype/nb-plugin-sdk/agent`（定义用的构造函数、类型、模板节点）与它的 JSX 运行时取内核的写法；两者在服务端宿主模块表里（[`runtime/plugin-code-loading.md`](../runtime/plugin-code-loading.md)）。

## 输出与可观察行为

1. **扩展的接收。** `agent.extensions` 的贡献原样交给内核的插件宿主（[`harness/runtime.md`](../harness/runtime.md) 输出 57）：内核否决的（id 不合规则、重名、依赖成环）使这一批贡献按平台合同回滚；撤回原因 `activation-failed` 照传，其余都按 `deactivated` 交给内核。内核撤回失败时写诊断，交给平台的撤回照样完成。
2. **`onAgentSession:open`。** 每次建会话或打开会话之前触发一次（同一时刻只触发一次，后到的等它），激活所有声明了它、还没激活的入口；后来登记的提供方在下一次建或开会话时被激活，已打开的会话在它交出扩展后重新装配。提供扩展的入口要声明这个事件，没声明的，它的扩展只在入口因别的原因激活之后才生效。触发有失败时写诊断、照常继续：打开已有会话时 Profile 依赖的扩展缺失，会话进只读 `dependency-missing`；新建会话时建会话失败 `profile-invalid`，详情带缺的依赖。
3. **扩展提供方与 `agentKey`。** 提供方可以依赖 `agentKey`：建会话之前 `nbook.agent` 已经激活，触发 `onAgentSession:open` 时不成环。提供方不能在自己的激活里建会话或打开会话：那会等自己这次激活，平台按等待环处理，激活失败。
4. **工具集。** 一个会话的工具声明 = Profile 的 `required` + `optional` + 所有 `defaultForAll` 的工具 + 这个 Profile 绑定里的 `added` − `removed`；`required` 里的删不掉；声明不存在的 id 忽略。声明了 `defaultTools: false` 的 Profile 不加 `defaultForAll` 的工具，绑定的 `added` 照样生效。绑定的 `objects.added` 加上这些全局对象（输出 25）的全部方法、`objects.removed` 去掉它们的全部方法，先于方法级的 `added`、`removed` 套用；之后对象新增的方法跟着对象（planned）。声明了 `foreground: true` 的工具不进后台会话（会话头的 `background`）与 bot 归属的会话（会话头的 `owner`）的工具集；eval 说明与代码里的全局对象用同一份工具集（planned）。每次模型请求前现算，改了绑定或有工具增减，从下一次请求起生效。内核拿到的就是最终的工具集（[`harness/runtime.md`](../harness/runtime.md) 输出 15）。
5. **工具的激活。** 工具的声明来自清单，提供方没激活也交给模型；声明里的 `effect` 是提供方没激活时用的等级（应写最保守的），激活之后实现给了按参数求等级的函数就用它。会话第一次执行某个工具时触发 `onAgentTool:<id>`，激活成功后向提供方当前一代要实现、按会话建一次，之后复用；激活失败或提供方受阻，这次调用得 `tool-unavailable`，下一次执行再试。
6. **工具的撤回。** 提供方停止时（入口停了，插件还在登记里）：之后的执行得 `tool-unavailable`，声明不变；插件被注销（卸载）时声明随登记一起消失，之后的请求里没有这个工具。两种情况下执行中的调用继续，最多等 5 秒，到时以 `tool-unavailable` 结算，提供方之后交回的结果丢掉；交给平台的撤回在所有调用结算或 5 秒到时完成。真正的实现在它底层的执行都结束后 `dispose`，5 秒时还没结束的写诊断 `tool-abandoned`。提供方再激活后，下一次执行用新的一代重建实现。
7. **Profile 目录。** 目录列出插件贡献的与用户级的 Profile：key、名称、说明、来源、状态（`ok`、`unavailable`、`error`）与原因。插件 Profile 来自声明，不激活提供方；`profiles.resolve(key)` 时触发 `onAgentProfile:<key>`，再取实现。来源按登记判定：插件贡献了的 key 就是插件的（发布者叫 `user` 的插件也可以贡献 `user.` 开头的 key），用户级 Profile 撞上插件已用的 key 时标不可用，同名不覆盖。 声明了 `hidden: true` 的条目带上这个标记，仍在目录里，给人选 Profile 的界面不列出它。
8. **可用性。** Profile 的 `required` 工具有不在工具声明里的，状态 `unavailable`，原因写缺哪些；工具都在、引用的扩展（输出 26）有不在扩展声明里的（按清单算，不激活提供方），同样 `unavailable`，原因写缺哪些。
9. **用户级 Profile 的打包。** 文件改动后重新打包：入口是源文件，外部模块只有宿主模块表里的；导入表外的裸说明符、或在运行时算出模块名的导入（变量作说明符），以 `module-not-shared` 失败。打包结果以内容哈希命名、原子写入，导入后默认导出必须是 `defineProfile` 的结果，否则 `profile-invalid-export`。监听 `user/profiles/` 目录与包里用到的每个源文件；同一 Profile 同时只打一个包，后到的变化合并成下一次；打包与求值期间它用到的文件（或还不知道用到哪些文件时，它的目录里的文件）变了，这次的结果丢掉、再打一次。打包失败的，修好它用到的文件、或在 `user/profiles/` 里改动，就重试。
10. **用户级 Profile 的版本。** 生效的 `version` 是 Profile 自己写的 `version` 加 `+` 加包内容哈希的前 12 位：同一份源文件重启后版本不变，改了任何一个源文件版本就变。
11. **重载。** 用户级 Profile 的版本变了、或插件 Profile 的提供方停止与再激活时，用它的打开着的会话重新解析 Profile（[`harness/runtime.md`](../harness/runtime.md) 输出 57 的 `profilesChanged`）：运行中的等这次运行结束；版本变了写 `profileChanged{code-updated}`；解析不到进只读 `unknown-profile`，回来后解除。
12. **打包失败。** 打包或求值失败时继续用上一次成功的包，状态 `error`、带原因与位置；从来没成功过的状态 `unavailable`，解析不到。源文件被删后 Profile 从目录消失，用它的会话进只读 `unknown-profile`。
13. **Profile 设置。** 声明的 `role` 是这个 Profile 的缺省角色，设置里的 `role`、`model` 优先。`model`、`role` 作为这个 Profile 的模型缺省交给模型服务（[`models/service.md`](../models/service.md) 输出 10）；`approvalMode` 是新会话的初值。界面见 [`profile-settings.md`](profile-settings.md)。
14. **目录的详情。** 每项带 `tools`、`defaultTools?`、`referencedExtensions?`、`role?`、`modelNeeds?`，让界面不用激活提供方就能算工具集、能力缺口与有没有 Agent 模式。插件 Profile 来自声明；用户级来自上一次成功的包，从未成功时不带这几项，用户级没有 `role`。
15. **原因是结构化的。** 输出 7、8、12 的原因是判别式 `problem`：`{code: "tools-missing", tools}`、`{code: "extensions-missing", extensions}`、`{code: "key-taken"}`、`{code: "module-not-shared", module?}`、`{code: "invalid-export", expectedId?}`、`{code: "build-failed" | "load-failed", file, line?, message}`。`file` 是相对 `user/profiles/` 的名字，`message` 不带状态根与缓存的绝对路径，原文只进诊断。
16. **目录变化的通知。** 目录变了（新建、打包失败、成功后又失败、恢复，哈希没变也算；删除；工具、扩展或 Profile 的发布与撤回）发 `profileCatalogChanged`：扩展增减会改引用了它的 Profile 的可用性（输出 8）。它和输出 11 的重新解析是两回事：打包失败时会话继续用上一版，不重新解析。
17. **工具目录。** `toolCatalog` 列出已接受的工具声明：`{id, description, providerName, effect, plugin, defaultForAll?}`，`providerName` 是换算后交给模型的名字，`effect` 是声明里的固定值。
18. **用户级 Profile 的新建与删除。** `createUserProfile({name, description, system})` 把骨架一次写成 `user/profiles/<名>.profile.tsx`（后两项是骨架里的文字，由窗口按界面语言给），名字只能用小写字母、数字、连字符（不合规则 `invalid-name`），已有同名 `exists`，不覆盖；交回 `{key, address}` 时目录里已经有它。`deleteUserProfile({key})` 删入口文件，不是用户级或文件已不在的 `not-found`。

19. Profile 声明可派的子代理：`agent.profiles` 的声明加 `agents?: {allowed: string[]; recommended?: string[]}`，值是 Profile 的 key；`recommended` 里不在 `allowed` 的项忽略。不声明就是空白名单。Profile 目录的条目带上声明的 `agents`，白名单的合成与用途见 [`subagents.md`](subagents.md)。
20. Profile 声明可用的 Skill：`agent.profiles` 的声明加 `skills?: {allowed: string[] | "all"}`，值是 Skill 的 id，`"all"` 是 Skill 目录里的全部；不声明就是空白名单。白名单的合成与用途见 [`skills.md`](skills.md)。
21. Profile 的开场指令：`agent.profiles` 的声明加 `starters?: {text: string; icon?: string}[]`（`text` 非空，`icon` 是图标 class），对话第一屏的“试试这些”用它（[conversation.md](conversation.md) 输出 41）。只显示前 3 条，多写的不显示，不因此拒绝整个声明；文字与 `name` 一样不翻译。用户级 Profile 没有声明，没有开场指令。
22. 对话状态栏的项：`agent.statusItems` 的贡献在对话状态栏的目录里多一项（[conversation.md](conversation.md) 输出 45），实现 `{load(): Promise<Component>}`，组件的属性是 `{ctx}`（对话视图的 `AgentConversationContext`），画一小段行内内容；声明里 `side` 是缺省的一边（用户可以换到另一边，[conversation.md](conversation.md) 输出 45），`defaultVisible` 缺省关（用户勾上才显示），标题与说明是设置页与右键菜单里的文字，来源插件显示为“插件”。只接受浏览器入口的贡献，写在顶层是 `implementation-required`、写在服务端入口下是 `invalid-declaration`。组件渲染出错时只这一项不画（状态栏其余项照常）。插件被停用或撤回后这一项从目录里消失，设置里关于它的显隐、次序与边保留，插件回来时生效。
23. Profile 声明可用的表情包：`agent.profiles` 的声明加 `stickers?: {allowed: string[] | "all"}`，值是表情包 id；不声明就是空白名单。白名单的合成与用途见 [`stickers.md`](stickers.md)。
24. 工具声明的代码调用字段：`agent.tools` 的声明加 `invokes?: true`（执行时能经 `ctx.invoke` 调别的工具）、`codeCallable?: false`（不能被代码调用）、`global?: {object: string, method: string}`（是某个全局对象的方法，只能从代码里调）、`returns?: <JSON Schema>`（代码调用时交回的结构化值的形状）、`errors?: {[码]: <JSON Schema>}`（失败时交给代码的 `details` 的形状，见 [`eval.md`](eval.md) 输出 8，planned）、`foreground?: true`（只给有人在窗口前的会话，见输出 4，planned），含义见 [`harness/runtime.md`](../harness/runtime.md) 输出 90 到 99 与 [`eval.md`](eval.md)。`global.object` 必须是同一个插件登记的 `agent.evalObjects` 的 `name`，否则这个工具不进工具表，诊断 `eval-object-missing`。
25. 全局对象：`agent.evalObjects` 登记一个代码里可用的对象，它的方法是带 `global` 的工具（输出 24）。对象名与内核给的名字（`tool`、`display`、`console`、`require`）或 JS 运行时的全局（`Math`、`process`、`Bun` 等）冲突时这个对象不登记，诊断 `eval-object-conflict`；两个插件登记同名对象时双方都不登记，诊断 `eval-object-conflict` 写明两个来源。对象与方法的用法、文档见 [`eval.md`](eval.md)。
26. **按需扩展。** `agent.extensions` 的声明写 `install: "on-request"` 的扩展不自动装到所有 Profile，Profile 按 id 引用（`referencedExtensions`）才装；装配规则在内核（[`harness/extensions.md`](../harness/extensions.md) 输出 32、33）。插件 Profile 的引用只认 `agent.profiles` 声明里的 `referencedExtensions`：交给内核的 Profile 是实现加上声明的引用；实现里另写了不同的引用时以声明为准，写诊断 `profile-references-mismatch`。用户级 Profile 在 `defineProfile` 里写 `referencedExtensions`。同一代插件 Profile 的句柄每次解析交回同一个对象；入口停止中、撤回还没送达时解析不到（同没有这个 Profile），缓存不绕过这一步。内置的按需扩展是 Agent 模式 `nbook.agent.modes` 与它的提醒 `nbook.agent.mode-reminder`（[`agent/modes.md`](modes.md)）。

## 状态与转换

工具包装（每个会话每个工具）：

| 状态 | 事件 | 下一状态 |
|---|---|---|
| 未建 | 第一次执行，激活成功 | 已建（第 n 代） |
| 未建 | 激活失败 | 未建（这次 `tool-unavailable`） |
| 已建（第 n 代） | 提供方停止 | 作废（执行中的最多等 5 秒） |
| 作废 | 执行 | 作废（`tool-unavailable`） |
| 作废 | 提供方再激活后执行 | 已建（第 n+1 代） |
| 任意 | 内核释放（离开工具集、会话关闭） | 结束（释放持有的实现） |

用户级 Profile：`未打包 → 打包中 → 已发布 | 失败`；`已发布` 之后的变化进 `打包中`，期间保留已发布的包；失败时 `已发布` 的包不变。

时序与寿命：

- 工具声明从提供方登记起可用，与激活无关；实现只在提供方当前一代激活期间可用。
- 交给平台的工具撤回最迟 5 秒完成；扩展撤回在内核各会话摘下它后完成（[`harness/runtime.md`](../harness/runtime.md) 输出 57）。
- 用户 Profile 打包期间，解析拿到的是上一次发布的包；发布与 `profilesChanged` 在同一步，此后的解析拿到新包。
- `nbook.agent` 停止时，监听先停，进行中的打包完成后结果丢掉，不发布。

## 副作用与数据

- 打包结果：`<状态根>/agent/cache/profiles/<名>-<内容哈希>.js`。按内容复用，停止时不删；不再被引用的旧包在启动时清理。
- 设置项写在用户层的设置文件（[`settings/configuration.md`](../settings/configuration.md)）。

## 失败与恢复

| 码 | 含义 | 调用方怎么办 |
|---|---|---|
| `tool-unavailable` | 工具的提供方没激活、受阻或已撤回 | 模型照常拿到失败的工具结果；恢复插件后再试 |
| `tool-abandoned` | 诊断：撤回时调用 5 秒没结束 | 无；提供方的实现没释放 |
| `module-not-shared` | 用户 Profile 导入了宿主模块表之外的包 | 改用共享的包或相对导入 |
| `profile-invalid-export` | 用户 Profile 的默认导出不是 `defineProfile` 的结果 | 改源文件 |
| `unknown-profile`、`dependency-missing`、`profile-invalid` | 见 [`harness/runtime.md`](../harness/runtime.md) | 恢复提供方或改 Profile |

## 边界与兼容

- 公开接口：三个贡献点的声明形状与实现形状、三个激活事件与写清单的助手、两个设置项的形状、SDK 子路径 `@notnotype/nb-plugin-sdk/agent`。内核的定义接口因此是插件 SDK 的公开接口，改它就是 SDK 的破坏性变更。
- 用户级 Profile 在状态根里运行期打包，是 [`runtime/plugin-code-loading.md`](../runtime/plugin-code-loading.md) “不在运行期编译”的例外，只对用户自己写的 Profile；不借此安装第三方代码。

## 验收与 Smoke

1. 一个测试插件交出工具与扩展，另一个交出 Profile：建会话前扩展的提供方被激活，工具没执行前提供方不激活但模型看得到工具；第一次执行激活提供方；停掉工具的提供方，下一次调用 `tool-unavailable`，再激活后恢复。
2. 用户在 `user/profiles/` 写一个 Profile，导入同目录的另一个文件：建会话、对话一轮；改那个被导入的文件，下一次请求用新内容、日志里有 `code-updated`；改成导入表外的包，目录标错误、会话继续用上一版；删掉源文件，会话只读。
3. 工具绑定给这个 Profile 加一个它没写的工具、去掉一个可选工具，下一次请求的工具集跟着变。
4. 一个测试插件交出 Profile，声明里引用 `nbook.agent.modes`、工具里没有 `switch_mode`：目录带这个引用，对话里有模式控件，用户切到计划模式成功；草稿里先选计划再新建，建好就是计划模式。另一个只列了 `switch_mode`、不引用的：没有模式控件（开发者 2026-11-25 报告的“发送失败(unknown-extension)”不再出现）。

Smoke：`packages/neuro-book/src/plugins/agent/` 的插件测试。

## 实现合同

- **公开入口**：`nbook/plugins/agent/shared/points`（三个贡献点的定义与声明类型、激活事件、写清单的助手 `agentExtension`、`agentTool`、`agentProfile`）、`nbook/plugins/agent/shared/settings`（两个设置项）；SDK 子路径 `@notnotype/nb-plugin-sdk/agent` 与 `/agent/jsx-runtime`（只给服务端，转出内核的定义写法、类型、模板节点与上面的助手）。
- **owner 与依赖方向**：`nbook.agent` 的服务端入口拥有三个贡献点与接收者，依赖设置、状态根、宿主时钟，可选依赖 `nbook.models`；扩展的接收者把贡献转给内核的插件宿主（`@notnotype/nb-harness/kernel` 的 `createAgentHost`），工具与 Profile 由本插件自己经 `SessionEnv.tools`、`SessionEnv.profiles` 交给内核。用户级 Profile 的装载共用平台的宿主模块表与外部导入检查（`plugin-platform/backend/loader.ts`）；插件构建预设的纯度名单含 nb-harness。
- **关键不变量**：
  - 内核拿到的工具实现是本插件的包装，每个会话每个工具一个：一次调用从等工厂起整段算在途，执行前复核中止、撤回与关闭；撤回时交给平台的完成最迟 5 秒，真正的释放等底层都结束（输出 5、6，`agent.test.ts`“工具”几条）。
  - 扩展的接收者对同一个平台句柄总交给内核同一个对象，`implementation()` 不缓存（输出 1，`agent.test.ts`、内核 `host.test.ts`）。
  - Profile 的来源按登记判定，不只看前缀；用户 Profile 撞上插件的 key 不可用（输出 7，`agent.test.ts`“来源按登记判定”）。
  - 用户 Profile 每个一个打包状态机：打包期间相关文件变了结果作废、失败保留上一次的包、失败后相关目录有变化就重试；生效版本带包的内容哈希；包按真实路径缓存（输出 9–12，`profiles.test.ts`）。
  - 会话还在建或打开时到达的扩展与 Profile 变化，进表后补做一次（内核 `host.test.ts`“会话还在建时到达的”）。

## 证据

- 批准依据：w00032 t10 决定 1–8 与实施阶段的决定 9–15（[Task README](../../../.agents/works/w00032-agent-integration/tasks/t10-agent-plugin/README.md)）；t04 决定 2、4、6，t05 存放三层与“打包加哈希”；开发者 2026-11-01 批准晋升为 `implemented`；`role`、`hidden`、`defaultTools` 见 [w00032 t18](../../../.agents/works/w00032-agent-integration/tasks/t18-builtin-profiles/README.md)。第一屏与开场指令：[w00032 t36 计划](../../../.agents/works/w00032-agent-integration/tasks/t36-conversation-panel-redesign/plan.md)，开发者 2026-11-16 确认（t36 决定 1、5、9）。；输出 22（`agent.statusItems`）依据 [w00032 t37 计划](../../../.agents/works/w00032-agent-integration/tasks/t37-status-line-customization/plan.md)，开发者 2026-11-17 确认；输出 22 的“声明的一边是缺省”依据 [w00032 t38](../../../.agents/works/w00032-agent-integration/tasks/t38-status-line-sorting/README.md) 决定 3（开发者 2026-11-18）；工具集里的对象级绑定与 `foreground`、声明的 `errors`（输出 4、24 的 planned 部分）依据 [w00033 t03 计划](../../../.agents/works/w00033-page-agent/tasks/t03-ui-guide/plan.md)（开发者 2026-11-26 确认）
- 实现入口：[`backend/plugin.ts`](../../../packages/neuro-book/src/plugins/agent/backend/plugin.ts)、[`backend/agent.ts`](../../../packages/neuro-book/src/plugins/agent/backend/agent.ts)、[`backend/extensions.ts`](../../../packages/neuro-book/src/plugins/agent/backend/extensions.ts)、[`backend/tools.ts`](../../../packages/neuro-book/src/plugins/agent/backend/tools.ts)、[`backend/profiles.ts`](../../../packages/neuro-book/src/plugins/agent/backend/profiles.ts)、[`backend/profile-bundles.ts`](../../../packages/neuro-book/src/plugins/agent/backend/profile-bundles.ts)、[`shared/points.ts`](../../../packages/neuro-book/src/plugins/agent/shared/points.ts)、[`src/sdk/agent.ts`](../../../packages/neuro-book/src/sdk/agent.ts)；`agent.statusItems`：[`shared/status-item-point.ts`](../../../packages/neuro-book/src/plugins/agent/shared/status-item-point.ts)、[`web/status-items.ts`](../../../packages/neuro-book/src/plugins/agent/web/status-items.ts)
- 合同测试：[`agent.test.ts`](../../../packages/neuro-book/src/plugins/agent/agent.test.ts)（真实服务端内核、真实设置与模型服务、本机的 OpenAI 兼容端点、运行中登记与注销插件）、[`profiles.test.ts`](../../../packages/neuro-book/src/plugins/agent/profiles.test.ts)（真实文件与运行期打包）、[`tasks.test.ts`](../../../packages/neuro-book/src/plugins/agent/tasks.test.ts)（扩展提供方的激活）、内核 [`host.test.ts`](../../../packages/nb-harness/src/kernel/session/host.test.ts)、[`build-plugin.test.ts`](../../../packages/neuro-book/plugin-sdk/build-plugin.test.ts)（纯度名单）；`starters`（输出 21）：[`agent.test.ts`](../../../packages/neuro-book/src/plugins/agent/agent.test.ts)；输出 22：[`status-line.dom.test.ts`](../../../packages/neuro-book/src/plugins/agent/web/status-line.dom.test.ts)（接收者、撤回、坏项不影响其余）
- Smoke：[`agent.llm.test.ts`](../../../packages/neuro-book/src/plugins/agent/agent.llm.test.ts)（`test:llm`，真实模型经远程合同跑一轮）
