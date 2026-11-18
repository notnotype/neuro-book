---
schema: nbook.task/v2
taskId: t21-eval-codeact
status: done
updated: 2026-11-18
---

# eval 工具（CodeAct）

## 目标与范围

参照 omp 的 eval：常驻代码内核，代码里调用工具、模型与子代理；与 t04 搁置的工具发现一起考虑

来源：t12 讨论（2026-10-28）；t04 定工具发现搁置时开发者说以后有需求打算用 CodeAct 实现。

合同（planned）：新建 [`agent/eval.md`](../../../../../docs/specs/agent/eval.md)；[`harness/runtime.md`](../../../../../docs/specs/harness/runtime.md) 输出 90 到 102 与 [`harness/session.md`](../../../../../docs/specs/harness/session.md) 的兼容；[`agent/contributions.md`](../../../../../docs/specs/agent/contributions.md) 输出 24、25，[`agent/permissions.md`](../../../../../docs/specs/agent/permissions.md) 输出 24、25，[`agent/resources.md`](../../../../../docs/specs/agent/resources.md) 输出 16、17，[`agent/builtin-tools.md`](../../../../../docs/specs/agent/builtin-tools.md) 输出 29，[`agent/builtin-profiles.md`](../../../../../docs/specs/agent/builtin-profiles.md) 输出 18，[`agent/run-guards.md`](../../../../../docs/specs/agent/run-guards.md) 输出 15，[`agent/compaction.md`](../../../../../docs/specs/agent/compaction.md) 输出 9，[`ui/agent-conversation-view.md`](../../../../../docs/specs/ui/agent-conversation-view.md) 的子调用与场景 37。

## 已知情况

omp 的 eval（事实见[外部参照](../../../../../docs/research/agent-runtime-references.md)“omp 的 eval 与 Agent Hub”一节）：常驻内核（Python 子进程或 Bun 的 JS），每次调用执行一个单元、顶层状态保留；代码里可以 `tool.<名>(args)` 调会话里的工具、`judge`/`completion` 调模型、`agent`/`workpool` 派后台子代理分波次，`budget` 看额度，`%pip`/`%bun add` 装依赖。

对写作的用处：跨很多章节的批量检查（一段代码循环读章、批量判断）、统计、把子代理串成流水线。代价：内核状态不在会话日志里，回退与 fork 恢复不了（与 t03 的路径模型对不上）；内核管理与工具、模型、子代理三座桥的工作量大；执行任意代码属于执行档。2026-10-28 会话里的倾向：先只做 JS 后端（只依赖 Bun），与工具发现一起考虑。

## 后续确定的需求

- [t16](../t16-command-bridge/README.md)（开发者 2026-10-30）：Agent 操作 NeuroBook 界面与外部网站一定走 CodeAct，不作内置工具。eval 要有一个让插件登记全局对象的贡献点（名字、一行摘要、文档、宿主侧处理函数、审批档位），照 omp 的 prelude：eval 的工具描述里每个全局对象只有一行摘要加文档地址，完整文档在模型读它时才进上下文（事实见[调研](../../research/2026-10-30-host-control-survey.md)第 5 节）。使用方是 [w00033](../../../w00033-page-agent/README.md) 的 `nbook` 与 [w00034](../../../w00034-browser-use/README.md) 的 `browser`，所以 w00033 开工前本 Task 要重开。

- [t19](../t19-mcp/README.md)（开发者 2026-10-30）：MCP 服务的工具多时，照 Anthropic 的“用代码执行调 MCP”经 CodeAct 按需加载（[w00036](../../../w00036-mcp/README.md) 决定 6）。

## 决定

| 编号 | 日期 | 决定 |
|---|---|---|
| 1 | 2026-11-18 | 开发者重开本 Task。第一版范围：常驻 JS 内核、代码里 `await tool.<名>(…)` 调会话里的工具、插件登记全局对象的贡献点（一行摘要加文档地址，按需读）、对话里显示代码与输出；代码里调模型（`judge`、`completion`）与派子代理（`agent`、`workpool`）留到下一批 |
| 2 | 2026-11-18 | 内核状态：每个会话一个常驻内核，顶层变量跨调用保留；回退、分叉、服务重启、空闲超时后内核重置，下一次调用的结果写明“内核已重置，之前的变量没了” |
| 3 | 2026-11-18 | 审批：整段代码按执行档审批（`ask`、`allow-writes` 询问并展示代码，`auto` 交审批模型，`yolo` 放行）；批准后代码里经 `tool.*` 调的工具再按各自的档位照常审批 |
| 4 | 2026-11-18 | 语言：只做 JS（Bun），不支持装依赖 |
| 5 | 2026-11-18 | 开发者确认[计划](plan.md)第 1 稿与三项待确认：eval 同 `shell`，作写作助手与临时帮手的可选工具；单元时限缺省 30 秒（等用户应答不计），内核空闲 30 分钟回收；全局对象第一版只有 `对象.方法(...参数)` 一种写法 |
| 6 | 2026-11-18 | 卡片的注意力排序（会话里问答）：eval 是思维链里的卡片，嵌套调用收成一行计数（例如“调用了 30 次工具：读了 28 个文件，改了 2 个”），改文件、出错、被拒的几次直接列出，其余点开看；嵌套调用读写的文件照常算进思维链摘要与轮末汇总；详情里代码在上、默认收起，输出在下；运行中显示已用时、已调用次数与当前一步。开发者补充：这几条做起来复杂时可以从简（例如运行中只转圈和用时） |
| 7 | 2026-11-18 | 开发者确认计划第 3 稿（设计审查三份报告的修订与“供开发者知悉”的几处）；另派一个子代理细读 omp 的 eval 做对照：omp 维护久、稳定，看它处理了而计划没有的 |
| 8 | 2026-11-18 | omp 对照（20 条建议，[`evidences/omp-eval-comparison.txt`](evidences/omp-eval-comparison.txt)）按推荐并进计划 3.1 稿与 Spec：内核拦没人接的错误、独立线程的父进程看门狗、Proxy 不交 `then`、值的显示改用 `node:util.inspect`、改写的边角（嵌套 `var`、函数名、严格模式、`import`、保留名、语法错误的代码框）、意外退出与握手超时、按单元归属输出与调用、说明按会话算并随列表升版本。单元时限改回决定 5 的原话“等用户应答不计”，工具执行计入（第 3 稿的“有嵌套调用在途就不计”会让自己没有时限的工具卡住单元），`invoke` 为此加 `onWaiting`。以后再做：可复用的初始化、进度行、自动转后台、压缩后列出变量 |
| 9 | 2026-11-18 | 开发者：eval 先做内核通道（切片 2）并合入，不等审批简化提案；实施那份提案时把 `cause` 也填进嵌套调用（已追加进它的决策记录） |
| 10 | 2026-11-18 | 开发者：切片 6 用 `.env` 里的 DeepSeek 密钥跑真实模型；真实模型数章节字数时把 read 的地址头与行号也算进去了，定为代码里调 `read` 交回对象（原文与分页信息分开），eval 与 read 的说明都写清；“read 加参数去掉行号省 token”记进 Work 的后续 |

## 设计审查

计划第 1 稿，三位审查者并行：omp（后端与事实核对）、Claude Opus（从整体看）、Claude Sonnet（对话视图一节）。依据的事实主会话抽查过（适配器按 `callId` 找调用、子代理树数 `toolStarted`、压缩放回最近文件、`remember` 规则、`settledEffects` 只认成功、`CollapsibleCard` 收起时没有正文、`mapEventContent`）。Opus 与 Sonnet 的修订成第 2 稿，omp 的叠加成[计划](plan.md)第 3 稿。

Opus（11 条：重要 7、建议 4，[`evidences/design-review-opus.txt`](evidences/design-review-opus.txt)），全部成立、已改进计划：

| 条 | 问题 | 处理 |
|---|---|---|
| 1 | 嵌套调用开头复用 `toolStarted`、结尾新造事件，现有三处读方只看到一半；靠归约改状态的工具在代码里调时状态丢失 | 开头也用新事件 `nestedToolStarted`，与 `nestedToolResult` 成对，现有读方不变；嵌套结果不进归约，靠归约的工具声明 `codeCallable: false`，从代码里调直接拒 |
| 2 | 全局对象映射成一个 `{method, args}` 工具，审批记忆、规则、校验、生成文档都只能按整个对象 | 一个方法一个工具（`global: {object, method}`），对象经新贡献点 `agent.evalObjects` 登记摘要；文档由参数与 `returns` 生成 TypeScript 签名 |
| 3 | `tool.<名>` 返回字符串还是对象看这一次有没有 `details` | 返回由声明决定：有 `returns` 交回校验过的 `details`，没有一律文字；图片并进本单元 |
| 4 | eval 没规定“本会话都批准”记什么，按现行规则一次点击放开任意代码 | eval 一律 `remember: false` |
| 5 | “等用户应答不计时”需要 `invoke` 给不出的信号 | 改为“有嵌套调用在途就不计时”，另加每次父调用 2,000 个嵌套调用的上限 |
| 6 | 嵌套结果全文进日志，批量读 300 章一次约 2.7 MB 且不去重 | 只记前 2 KB 预览与字节数，图片只记张数 |
| 7 | 声明级的 `exposure` 装不下 MCP 按绑定的选择；`code` 工具无从发现 | 去掉 `exposure`，带 `global` 的方法工具才只走代码；按绑定选择的方向写进 Spec，留给 w00036 |
| 8 | `invoke` 发给每个工具，公开面过宽 | 声明 `invokes: true` 的工具才有，第一版只有 eval |
| 9 | 全局对象重名按加载顺序取舍 | 同名双方都不进会话并诊断 |
| 10 | 只有空闲回收，内核进程数没有上限 | 全服务端至多 8 个，超出回收最久没用的，走重置提示 |
| 11 | 界面切片之前合入的 eval 会弹出来历不明的询问 | 切片 5 之前 eval 不进内置 Profile |

Sonnet（13 条：重要 7、建议 6，[`evidences/design-review-sonnet.txt`](evidences/design-review-sonnet.txt)），全部成立、已改进计划：

| 条 | 问题 | 处理 |
|---|---|---|
| F1 | 嵌套读写只在父调用成功时计入，eval 失败时已写的文件从摘要与改动里消失 | 按子调用自己的状态计入 |
| F2 | 没启动的嵌套调用（被拒、被拦）没有参数可显示 | 每个嵌套调用都写 `nestedToolResult`，带 `args` |
| F3 | 只写了“适配器映射成子调用”，`children`、未知事件、孤儿子调用、`effects` 签名、原始视图与复制都没列 | 逐项写进计划；父调用有结果而子调用没有的按 `unknown` |
| F4 | 计数口径没定 | 嵌套调用不进步骤数、其余操作数与失败数，只在卡片里计；文件去重与思维链同一个函数 |
| F5 | 折叠的 `CollapsibleCard` 没有正文，放不下计数与改动 | 计数进副标题，改动、出错、被拒的几次作为卡片下方的缩进行，照工具组的做法 |
| F6 | 运行中进度在折叠的思维链里看不到；没有开始时刻 | `ToolCallView.startedAt`；副标题写次数与当前一步，用时在卡片里；思维链摘要行从简（决定 6 允许） |
| F7 | 待办项没有 `within`；批准前没有子调用；嵌套提问没处理；`node` 工具会在卡片里常显 | `PendingApprovalView.within`、等审批时的占位子调用、提问同样带来源、子调用一律按 `line` 画 |
| F8 | “eval 的预览是代码”与预览合同不符 | 不加预览类型，向导对 eval 把代码排在最前 |
| F9 | 没有只读的语法高亮部件 | 不做高亮，`AgentCodeBlock` 加标题 |
| F10 | 新事件要进出站过滤 | 两种事件的参数与预览走 `mapEventContent` |
| F11 | 缺适配器契约测试 | 加真内核、跟帧与重建两路一致的契约测试；e2e 只一个文件 |
| F12 | 代码流式生成时卡片标题为空 | `streamingArgs` 抽出 `title` |
| F13 | 渲染器放哪个包没分工 | 通用部分在 nb-agent-ui，eval 的渲染器在 `plugins/agent/web`；`activeCalls` 不变 |

omp（19 条：阻断 1、重要 18，[`evidences/design-review-omp.txt`](evidences/design-review-omp.txt)；第 9、11、15、16、17、19 条带真实运行的实验），成立的已改进计划：

| 条 | 问题 | 处理 |
|---|---|---|
| 1 | `invoke` 交回 `ToolResult`，装不下 `blocked`、`unknown` | 另立 `NestedOutcome`，`status` 必填；`unknown` 在代码里抛错并说明要先核对 |
| 2（阻断） | 父调用返回、单元超时不结算已受理的嵌套调用，父结果交出后还可能落盘或等审批 | `invoke` 收父工具给的 `signal`；触发后按顶层宽限期结算，父工具等结算写完再交结果；正常结束时等没 `await` 的在途调用 |
| 3 | 拦截层改派后，准入的禁止项与 `concurrency` 槽失效 | 改派后对最终目标再核准入与参数，不许改派到另一种 `concurrency`；顶层改派到只走代码的工具得 `code-only` |
| 4 | 恢复只认回复里的调用，嵌套的待审批、已批准未开始、已开始都不结算 | 打开会话时与顶层同一批结算嵌套调用 |
| 5 | 新的内核事件名让旧版把整份会话判成损坏 | 接受取舍：照 `session.md`“只加不改”与 t18 的先例，Spec 写明降级不受支持 |
| 6 | 用父 `callId` 加后缀造 id 会和顶层撞键 | 嵌套调用由内核造全局唯一的 id，按它关联 |
| 7 | 十次嵌套写入成十个组，来源也指不回唯一一次调用 | 同一次 eval 的嵌套写入共用一个组（按父调用的 `invocation`），来源是各自的嵌套 id。顶层来源用 `callId` 跨回复可能重复是现有问题，另记 |
| 8 | 压缩放回漏掉经 eval 读写的文件 | 放回显式认两种新事件 |
| 9 | 杀内核不杀它起的子进程（实测 `sleep` 留下） | 内核做进程组组长，杀整组；IPC 断开时内核自己收组；Windows 不在第一版验证 |
| 10 | 只改应用包的构建会漏掉 `dist/server` 的入口 | 入口按绝对路径定位，构建清单的所有读方一起改，起进程先握手 |
| 11 | 同一条回复的第二个 eval 读不到第一个的结果，会误判重置（实测） | 重置改用内核给的 `ctx.leafMoves`（`leafChanged` 的条数），不再比较结果里的单元标记 |
| 12 | 主创可以从 eval 派子代理，而派子代理留到下一批 | 派子代理、给子代理发话与答话声明 `codeCallable: false`；`shell` 在嵌套调用里不接受 `async` |
| 13 | eval 的“本会话都批准”会放行之后完全不同的代码 | 同 Opus 第 4 条：`remember: false`，直接提交得 `invalid-answer` |
| 14 | 只在请求里藏起只走代码的工具，执行端仍受理模型直接调它 | 执行端按来源判，得 `code-only` |
| 15 | `Bun.spawn` 传 `env` 是替换，还会读工作目录的 `.env`（实测） | 显式叠加服务端环境，`--no-env-file` |
| 16 | 回退没跨过 eval 时，路径上最后一个单元相同，不会重置（实测） | 同第 11 条，任何回退、切分支都重置，与决定 2 的字面一致 |
| 17 | 只把声明降成 `var`，严格模式下变量会丢（实测） | 改写只有一条路：整段包进异步函数，顶层声明改成对全局的赋值 |
| 18 | 脱敏时 `details` 不写日志，单元标记跟着丢 | 同第 11 条；“路径上跑过 eval”只数 eval 的 `toolResult`，脱敏也数得到 |
| 19 | 经 IPC 来的参数可能不是能写进日志的 JSON（实测 `Map`、`NaN`、`bigint` 都能过来） | 审批与写日志前核对，不合格只让这一次调用失败 |

另记（不在本 Task 改）：顶层工具调用写入的来源条目用的是 `callId`，服务商只保证它在一条回复里不重复，跨回复可能指错调用（omp 第 7 条顺带发现，base 上就有）。

影响产品行为的几处，供开发者知悉：eval 的询问没有“本会话都批准”“以后都允许”；嵌套调用在界面上只有 2 KB 预览；全局对象的方法收单个对象参数（`browser.goto({url})`）；切片 5 之前 eval 不进内置 Profile；任何回退、切分支都重置内核（照决定 2 的字面）；写过嵌套调用的会话，旧版本打不开。

## 实现审查

切片 2 到 5 合入后开了两份：后端派 omp（[报告](evidences/impl-review-omp.txt)，重要 2 条、建议 1 条，处理在 ecc46c50e 合入），前端派 Sonnet（[报告](evidences/impl-review-sonnet.txt)，重要 3 条、建议 4 条，处理在 676a052bd 合入）。

| Sonnet | 结论 | 处理 |
|---|---|---|
| F1 嵌套调用的参数被内核截短，行数按截短的内容算 | 成立，要改 | 内核在两种嵌套事件上写 `argsClipped`（不靠认那段注明的文字），适配器标成 `argsPreview`；读写影响统一经 `callEffects`，标了预览的改动不给增删行数，详情不画 diff。契约测试与计数测试各补一条 |
| F2 已用时在头部右侧，跑完时右侧的图标与箭头挪位置 | 成立，要改 | 已用时挪进副标题，紧跟工具摘要；头部右侧不再有只在运行中出现的零件 |
| F3 eval 参数里 `code` 在 `title` 前，生成代码期间卡片没有标题；没开始执行就写“正在运行” | 成立，要改 | 参数顺序改成 `title` 在前；详情只在开始执行之后写“正在运行” |
| F4 详情、副标题、两条来源取法、流式标题、被拒路径没有测试 | 成立，要改 | 加 `EvalDetail.dom.test.ts`（4 条）、流式 `title` 一条、`pendingWithin` 一条；e2e 改成批准一次、拒绝一次，断言被拒的那行与点开后的输出 |
| F5 出错、参数无效、结果未知的露出行与“正在调的那一个”没断言 | 成立，要改 | DOM 测试补出错、参数无效、结果未知三种露出，与两个子调用同时在跑时取最近受理的 |
| F6 收起的小条与停靠区只写工具名；后代会话的提问取不到来源 | 前半成立，要改；后半接受取舍 | 小条与停靠区同向导标题写来源，DOM 测试各一条；后代会话的提问原文不带 `within`，要会话树带上事件字段才行，窄场景，Spec 与代码注释写明是已知限制 |
| F7 几处小事 | 部分改 | 改：缺空格；改派时子行名字以开始事件为准；只重置内核时不画空的代码行；Lab 场景去掉 `as never` 并写明为什么让这一轮处在运行中；详情文档删掉 eval 不会出现的“只公开了预览”。不改：只重置时副标题写字（渲染器的 `summary` 拿不到翻译，详情的输出已写“内核已重置”）；`details.artifact` 做成可点的入口（输出文字里已有全文地址，模型照它读） |

| omp | 结论 | 处理 |
|---|---|---|
| 1 内核按管道上的结束标记判单元收齐：没等完、继承了输出的子进程晚写的字归到下一个单元；代码能伪造标记截断输出 | 成立，接受取舍 | 与 Spec 输出 2“单元期间直接写到的并进这个单元”的字面一致；要按单元区分直接写 fd 的输出得每个单元换一次 fd，Bun 没有不经 FFI 的做法。伪造标记要代码故意为之，代码本来就有全部权限。`eval.md` 的“不承诺”写明这两点 |
| 2 嵌套调用排队等锁时被取消，队列里摘的不是放进去的那个对象，取消的 exclusive 一直挡着后面的 shared | 成立，要改 | 入队与取消用同一个对象，摘掉之后再推一次队列（挡在队首的 exclusive 摘掉后，后面的 shared 当场开始）；`runtime.md` 输出 98 补一句。`invoke.test.ts` 补一条，两处做过变异检查 |
| 3 嵌套写调用批准后排队等锁，期间会话改成只读，拿到锁照样执行 | 成立，要改 | 拿锁挪到判定之后、建实现之前，拿到锁时设置和判定时不同就按现在的重判，要问就再问（同顶层的输出 79）；`runtime.md` 输出 92 补一句。`invoke.test.ts` 补一条，做过变异检查 |

## 当前状态

2026-11-18 重开，范围已定（决定 1 到 4）；计划第 1 稿已获开发者确认（决定 5），卡片的注意力排序已定（决定 6）。设计审查三份报告都已处理，[计划](plan.md)到第 3 稿。调研：[omp 的 JS 内核](../../research/2026-11-18-omp-eval-js-kernel.md)。

实施（分支 `feat/w00032-t21-eval`，worktree `.worktree/w00032-t21-eval`）：

- 切片 1（Spec，`planned`）已在 master：b2655ce58、f756817c5、230a79020。
- 切片 3 之一（dd28c3f25、79822481a）：输出窗口与全文挪进套件的 `kit/tools/output-capture.ts` 供 `shell` 与 eval 共用；eval 的内核：子进程与进程组、握手与协议版本、父进程看门狗线程、单元改写（`rewrite.ts`）、按单元归属的输出与调用、没人接的错误、直接写 fd 的输出用结束标记收全、意外退出。`backend/eval/kernel.test.ts` 与 `rewrite.test.ts` 19 条（真实子进程），看门狗与“等在途调用”两处做过变异检查。
- 切片 2（内核通道，按决定 9 先合入，0e7fb6704）：`ToolContext.invoke` 与 `NestedOutcome`、只走代码的工具（清单、执行端、`tools-changed` 与 `toolsAnnounced` 的 `code` 标记）、嵌套调用的身份与准入、改派后再核、两种新事件与出站过滤、嵌套的审批与提问带来源、`onWaiting`、并发锁、2,000 的上限、收口与宽限期、恢复（与顶层同一批）、`leafMoves`、压缩放回认嵌套调用。`run/invoke.test.ts` 12 条（含两条真 `kill -9` 的恢复）；父调用收口、只走代码的预检、恢复三处做过变异检查（预检那处第一次没抓到：执行前的再核也拦住了，用例改成断言“不进审批阶段”）。nb-harness 全量 853 条过（一条存储用例负载 21 时超时，单独重跑过）；应用 Agent 插件 457 条过；两包类型检查过。
- 切片 3 之二（917cfe30f 合入；eval 工具已贡献，还没进任何内置 Profile）：`backend/eval/tool.ts`（每会话的内核、`leafMoves` 判回退、路径上数 eval 次数的扩展 `nbook.agent.eval-state` 决定重置提示、累计时限与 `onWaiting` 暂停、`returns` 校验、图片至多 8 张、全文同 `shell`、空闲 30 分钟与 8 个的总数上限）；声明的 `invokes`、`codeCallable`、`global`、`returns` 接进 `agent.tools` 并传给内核；派子代理三件与 `switch_mode` 标 `codeCallable: false`；审批钩子加 `rememberable`，eval 交回 false；资源视图按父调用给嵌套写入成组；套件 `shell` 在嵌套调用里拒 `async`（`async-in-code`）；`build:server`、应用包与命令行测试都产出 `eval-kernel.js`，应用包的发布检查按原文放行内核的一处动态导入与看门狗的 Blob Worker；界面文字补 eval 的一句说明。`eval.test.ts` 8 条（真实服务端与子进程）、`resources.test.ts` 加 1 条；“不能记”、回退重置、嵌套写入成组三处做过变异检查。Agent 插件 498 条过（架构检查一条负载 33 时超时，放宽上限单独跑过）。
- 切片 4（全局对象，88043837e、65515af4d 合入；按自主推进做，没有单独的设计审查，几处细化写在[计划](plan.md)“切片 4 的细化”，由 Task 收口的实现审查一起审）：贡献点 `agent.evalObjects`（`implementation: "none"`，SDK `/agent` 加 `evalObject` 助手）；`backend/eval/objects.ts` 挑有效对象（与内核名、宿主全局重名的不登记，两个插件同名的双方都不登记，诊断 `eval-object-conflict`），方法的对象不是同一插件的有效对象时工具不进工具表（`eval-object-missing`）；`docs://eval/<名>.md` 激活时生成到状态根的 `agent/eval-docs/`，签名由 `parameters` 与 `returns` 打印；eval 的说明按会话列出对象、版本写成 `1+<哈希>`，换 Profile 后模型收到 `tools-changed`。示例插件 `word-stats` 与场景 10（3 条，含会话中途换 Profile）、`objects.test.ts` 6 条；方法过滤、按会话的说明（两条用例各抓一次）、同名、宿主全局冲突四处做过变异检查。场景 10 测出换 Profile 会重置内核（内核换 Profile 时重建全部工具实现），Spec 输出 11、12 补上这个时机，原因写成“服务重启、分叉或换了 Profile”，记进[待确认清单](../../pending-confirmations.md)。顺带：SDK 的组件清单补上 master 上落下的 `DateInput`、`TagInput` 与 t38 落下的 `SortableList`（`src/sdk` 的测试在 master 上就失败）；会话宿主一条改写历史的用例只等“有说明”，上一步的说明还在时会提前放行，负载高时失败，改成等这一步的码。SDK 打包测试有 4 条 vue-tsc 在负载 35 时超过 60 秒，分支基点上同样负载同样超时，放宽上限后 4 条都过。
- 切片 5（界面，aeab77d90、32f0920bf、c7f7b86ba 合入）：nb-agent-ui 的 `ToolCallView` 加 `children`、`startedAt`，事项加 `within`；适配器认两种嵌套事件与带 `within` 的事项（按外层调用的 `invocation` 挂子调用，等审批时先占位，结果只给预览，外层有结果而子调用没有的按 `unknown` 收口，流式参数抽出 `title`）；子调用读改的文件按它自己的状态算进思维链摘要与轮末改动；卡片副标题接计数、运行中写已调用几次与正在调的那一个、头部写已用时，收起时改了文件与出错、被拒、结果未知的子调用露在卡片下，展开后列出全部；原始视图列子调用；向导标题写“eval 里的调用：…”。应用：eval 的渲染器与详情 `EvalDetail`（代码在上默认收起，输出在下，图片只写张数），会话宿主带上 `within`，eval 进主创与临时帮手的可选工具、主创提示词加 eval 一节（version 5）；Lab 三个场景；e2e 一条（`agent-conversation.e2e.ts` 末尾）。契约测试加 3 条（真内核，跟帧与重建相同）、计数 2 条、DOM 5 条；子调用计数、父调用收口、审批占位、卡片下的子行、已用时、向导来源、宿主的 `within` 映射七处做过变异检查（最后一处经 e2e）。e2e 第一次跑时消息留在输入框没发出去，之后连跑三次都过，trace 被覆盖，原因没查明。“复制工具调用”入口在视图里不存在，没做；图片不画、运行中的卡片都写用时、向导来源写 eval，三条记进[待确认清单](../../pending-confirmations.md)。Agent 插件 475 条、nb-agent-ui 280 加 170 条过（`session-tree` 一条纯 CPU 用例负载 35 时超 5 秒，与 master 对照、重跑都过）。
- 切片 6（真实模型，02a1eeaee、17087803d 合入）：`eval.llm.test.ts`，五章各不同字数，让模型用一次 eval 读完、统计、把结果写进文件，询问模式下逐个批准。第一次跑：链路都通（eval 批准、代码里的写工具带来源批准），但字数每章多 46，因为代码里 `tool.read` 交回的是带地址头与行号的文字。按决定 10 改成代码里调 `read` 交回对象（套件 read 在嵌套调用里给 `details`，宿主声明 `READ_RETURNS`；顶层不带，原文不在日志里多存一份），read 版本升到 2，eval 与 read 的说明写清；补套件 read、`eval.test.ts` 各一条。重跑：一次 eval 读五章，字数全对，写工具的事项带来源。模型 deepseek-flash，密钥只经环境变量传入，输出遮盖过。
- 收口：Sonnet 的处理、read 交回对象与切片 6 在最新 master 上重跑受影响的验证后合入（nb-agent-ui、Agent 插件、应用的单测与类型检查、三份构建、`agent-conversation.e2e.ts:783`，负载 37）；omp 的处理（ecc46c50e）跑了 nb-harness 内核测试，`log/store.test.ts` 一条在负载 27 时超时，master 上同样。`runtime.md` 输出 96 的 `argsClipped` 与对话视图 Spec 的小条来源两处，是被 w00043 的 5cb584b1f 一起提交的，内容无误。

## Spec 晋升

omp 逐句核对（[报告](evidences/spec-promotion-omp.txt)：91 句，可去掉 12、改写 5、留 76），处理见[处理记录](evidences/spec-promotion-resolution.txt)。补测时又找出三处代码问题并修正（c33229619）：意外退出时内核起的子进程不结束；同一条回复里先重置再调 eval 时没有重置提示；传不出内核的参数报成代码错误而不是 `invalid-arguments`。单元时限与空闲回收改用宿主时钟，测试推时钟、不按真实时长等。

晋升结果：`eval.md` 整份晋升为 `implemented`（补了实现合同与证据），留 4 句标“（planned）”：`kernel-unavailable` 经 eval 交回、`unknown` 结局的说明、会话关闭之后的调用与关闭时正在起的内核、验收 4 的两种打包产物。`builtin-tools.md` 输出 29、30，`contributions.md` 的 `agent.evalObjects` 与输出 24、25，`resources.md` 输出 16、17，`builtin-profiles.md` 输出 18，`compaction.md` 输出 9 那一句，对话视图 Spec 的子调用、已用时、来源与验收 37，标记都去掉了。改写的几处：`timeout` 是整数；停止的码 `aborted` 进失败表；虚拟根的条目不带结尾斜杠；`docs://eval` 不带结尾斜杠；时限从内核开始执行算起；“待办”从不能调的清单里删掉（应用里没有这个工具）。

## 下一步

完成。剩下 4 句 planned 等以后有对应的测试场合再补：发布检查从两种打包产物起服务时顺带验收 4；会话关闭与 `kernel-unavailable` 要能在应用里换掉内核入口才测得到。
