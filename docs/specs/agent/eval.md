---
schema: nbook.spec/v1
kind: behavior
status: implemented
capability: agent.eval
owners:
  - nbook.agent
---

# 代码执行（eval）

## 目标与非目标

给 Agent 一个写 JS 来批量做事的工具：模型写一段代码，在代码里调会话里的工具（`await tool.read({path})`）、用插件登记的全局对象，一次调用读很多章、统计、按结果再改，不用一轮轮调工具。每个会话一个常驻内核，顶层变量跨调用保留。代码里调的工具照常审批、过拦截、记日志（[`harness/runtime.md`](../harness/runtime.md) 输出 90 起）。

不承诺：

- 沙箱：代码能直接读写文件、联网、起进程，审批是唯一的门，与 `shell` 同档；代码绕过 `tool.*` 直接写的文件没有来源与分组，界面也看不到。
- Python、装依赖、`export`、TypeScript 语法。
- 代码里调模型与派子代理。
- 插件提供在内核里执行的代码（全局对象只有“对象.方法”一种写法）。
- 变量在回退、切分支、重启、空闲回收之后还在；`let x;` 这样不带初值的重复声明不会把已有的值清成 undefined。
- 自动转后台；表格、JSON 这类富输出（只有文字与图片）。
- Windows 上的进程组收口没有验证。
- 直接写到标准输出与错误的（没走 `console`、`process.stdout.write`）按写到的时刻归属：单元结束后才写的（例如没等完、继承了输出的子进程）算进那时正在执行的单元，没有单元在执行时丢掉；代码故意写出单元的结束标记会截断这个单元的输出。

## 术语与参与者

- **内核**：一个会话的 JS 执行进程，顶层变量在里面跨调用保留。
- **单元**：一次 `eval` 调用执行的那段代码。
- **全局对象**：插件经 `agent.evalObjects` 登记、在代码里可用的对象；它的**方法**是带 `global` 的工具（[`contributions.md`](contributions.md) 输出 24、25）。
- 嵌套调用、父调用见 [`harness/runtime.md`](../harness/runtime.md) 的术语。

## 输入与前置条件

工具 `nbook.agent.eval`，交给服务商的名字 `eval`，等级 `exec`，`exclusive`，参数严格校验：

| 参数 | 类型 | 说明 |
|---|---|---|
| `code` | string，必填 | 一段 JS（Bun 的运行时），可以用顶层 `await`、`for await`、`return` |
| `title` | string | 一句话说明这段代码做什么，界面用作标题 |
| `timeout` | 整数 | 单元时限，秒；缺省 30，1 到 3600 |
| `reset` | boolean | 先重置内核再执行；这时 `code` 可以为空（只重置） |

代码里可用：

- `tool.<名>(args)`：`<名>` 是工具交给服务商的名字（与模型调工具时用的相同，带 `-`、`.` 的写 `tool["名字"]`），参数是一个对象，不传按 `{}`。
- `<对象>.<方法>(args)`：这个会话里可用的全局对象，参数是一个对象。
- `display(image)`：`image` 是 `{data, mime}`，`data` 是 base64 字符串或字节。
- `console` 的方法与 `process.stdout.write`。
- 模块：顶层 `import` 与代码里的 `import(…)`；`node:`、`bun:`、绝对路径照原样，相对路径与包名按内核的工作目录解析。`require` 同样按工作目录。

## 输出与可观察行为

### 执行

1. 一次调用在本会话的内核里执行 `code`；顶层声明（`var`、`let`、`const`、`class`、函数、解构，以及嵌套在块、`if`、`try`、`for` 头里的 `var`）跨调用保留，同名的 `const` 可以在后一个单元重新声明，后一个单元改了全局变量，前一个单元定义的函数读到新值；带 `"use strict"` 的单元同样。最后一个表达式（或顶层 `return`）的值显示在结果末尾，`undefined` 不显示。
2. 结果文字是这个单元的输出（`console` 的各方法，`warn`、`error` 带前缀；`process.stdout.write`；内核进程在单元期间直接写到标准输出与错误的，例如没取 `.text()` 的 `Bun.$`）加最后的值；值与 `console` 的参数按 Node 的 inspect 格式（深度 6）转成文字，字符串原样。没有输出也没有值时写“（没有输出）”。窗口与全文同 `shell`（[`builtin-tools.md`](builtin-tools.md) 输出 21）。
3. 代码抛错或有语法错误：结果状态 `error`、码 `code-error`，文字是错误之前的输出加错误信息与堆栈（去掉内核自身的帧），堆栈的行号指向这段代码；语法错误给行、列与出错的两行。不执行、同样得 `code-error` 的：有 `export`；顶层声明了内核提供的名字（`tool`、`display`、`console`、`require` 与这个会话的全局对象名）。
4. 图片：`display(image)` 与代码里调的工具交回的图片都附在结果里，至多 8 张，多的丢掉并在文字里注明；缩放规则同 `read`（[`builtin-tools.md`](builtin-tools.md) 输出 7）。
5. 单元正常结束时还有没 `await` 的嵌套调用在途：等它们结束再交结果。这个单元发起的代码（包括没 `await` 的 Promise、定时器）里没人接的错误让单元失败（码 `code-error`，提示可能忘了 `await`），不让内核退出；单元结束之后才冒出来的不算进别的单元。

### 代码里调工具

6. `tool.<名>(args)` 与 `<对象>.<方法>(args)` 发起一个嵌套调用（[`harness/runtime.md`](../harness/runtime.md) 输出 90 到 101），准入、审批、拦截、事件与收口都照那里。
7. 交回的值由工具声明决定，每次都一样：声明了 `returns` 的，成功时交回照它校验过的结构化值（不合格算这次调用出错）；没声明的，成功时交回结果文字。内置的 `read` 声明了 `returns`，交回原文与分页信息分开的对象（[`builtin-tools.md`](builtin-tools.md) 输出 30）。图片并进本单元的结果（输出 4）。
8. 结局不是 `ok` 时抛 `ToolCallError`，带 `tool`、`status`、`code` 与说明，代码可以 `catch` 它接着跑。`unknown` 的说明写明“不知道有没有执行完，先核对再重做”（planned）。工具声明了 `errors`（[`contributions.md`](contributions.md)）且这次的码在声明里时，`ToolCallError` 另带 `details`：照声明校验过、按 JSON 序列化后至多 8 KB 的 UTF-8；不合格或超长的不带，说明末尾写明。
9. 参数不是一个能写进日志的 JSON 对象时（函数、`Symbol` 这类传不出内核的值，`NaN`、`Map` 这类传得出去、日志写不下的值），这一次调用以 `invalid-arguments` 失败，别的不受影响。名字不是这个会话能调的工具时以 `unknown-tool` 失败，说明列出能调的名字。上一个单元留下的代码（定时器、没 `await` 的 Promise）在它结束之后才发起的调用得 `parent-finished`。

### 内核的寿命与重置

10. 内核在本会话第一次调 `eval` 时起，工作目录与布局变量同 `shell`（[`builtin-tools.md`](builtin-tools.md) 输出 18、20），环境继承服务端，不读工作目录里的 `.env`。
11. 内核在这些时候重置（之前的变量没了）：内核意外退出（包括代码里 `process.exit`，以及两次调用之间被外部结束）；上次调用之后叶子被移动过（回退、切分支）；`reset: true`；单元超时或被停止；30 分钟没有调用；整个服务端的内核超过 8 个时最久没用的那个；服务端重启；分叉出的会话从新内核开始；会话换了 Profile（换走又换回来也算）；工作目录或布局变量与起内核时不同（例如项目同一个 id 换了目录）。会话关闭不重置：内核留着，照样按 30 分钟空闲与 8 个的上限回收；会话再打开后叶子没移动、Profile 没换时接着用，变量还在。
12. 新内核第一次执行时，若当前路径上已经有过 `eval` 的结果，结果第一行写明内核已重置、之前的变量没了，并写原因（回退或切分支、主动重置、超时、被停止、意外退出、空闲、被回收、换了 Profile、工作目录变了；会话关闭期间到点的空闲与回收照样写这两个原因；服务重启与分叉写成同一个原因，新内核分不出是哪一种；服务端只为最近用过的 256 个会话记着原因，更早的也写成这个）。每个单元开始时工作目录是会话的工作目录，代码里改过的不带到下一个单元。
13. 重置时连同内核起的子进程一起结束，结束了才交结果；服务端异常退出时内核自己结束它与它起的子进程。

### 时限与停止

14. 单元时限从内核开始执行这个单元算起（起内核的时间不算，握手另有期限），累计计时，只扣掉嵌套调用等用户应答（审批、同步提问，以及嵌套工具经 `waitingForUser` 自报的等待，planned）的时间，工具执行本身计入。到时限：先按 [`harness/runtime.md`](../harness/runtime.md) 输出 100 结算在途的嵌套调用，再重置内核；结果状态 `error`、码 `timeout`，文字是已有的输出加重置说明。
15. 运行被停止时同样先结算嵌套调用、再重置内核；结果照运行中止的规则（[`harness/runtime.md`](../harness/runtime.md) 输出 25），状态 `error`、码 `aborted`，已有的输出保留。内核意外退出时在跑的单元得 `kernel-exited`，文字是已有的输出、退出码或信号与内核错误流的最后一段。

### 说明与全局对象

16. 给模型的说明写明：怎样调工具与全局对象、交回什么与失败时抛什么、每次调用都要 `await`、变量什么时候会丢、失败后只重试失败的那一步；列出这个会话里可用的全局对象，每个一行摘要加文档地址 `docs://eval/<对象名>.md`（[`resources.md`](resources.md) 输出 16）。至少有一个方法在生效工具集里的对象才可用、才列出。说明随会话的生效工具集算出，列表变了工具版本跟着变，模型在下一次请求前收到 `tools-changed`（[`harness/runtime.md`](../harness/runtime.md) 输出 16），会话中途不会悄悄换说明。
17. 文档按需读：说明里只有一行摘要，完整的方法签名与说明在文档地址里。签名里字段带说明与缺省的，对象类型分行写、字段前写说明；都没有的仍写成一行。方法声明了 `errors` 的，文档列出各码与 `details` 的形状。

### 审批

18. `eval` 的审批见 [`permissions.md`](permissions.md) 输出 25：执行档，询问不能记。代码里调的工具照 [`permissions.md`](permissions.md) 输出 24 逐个判定。
19. 代码里不能调：收尾工具、`eval` 自己、派子代理与给子代理发话和答话、切换模式（得 `invoke-not-allowed`）；`shell` 的 `async` 见 [`builtin-tools.md`](builtin-tools.md) 输出 29。
20. **重置的提醒。** 空闲回收、被登记表回收、两次调用之间内核进程意外退出，这三种重置是当场知道的：给会话发一条不带唤起的提醒“eval 的内核已重置（原因），之前的变量没了”（[`harness/runtime.md`](../harness/runtime.md) 输出 112；（planned）以宿主身份 `{plugin: "nbook.agent", label: "eval"}`、`key: "eval-kernel"`），会话关着也发；下一次 eval 结果的第一行照旧写（输出 12）。新一代内核起来、能用之后，还没取走的那条撤回，（planned）发送与撤回在同一条串行队列里，旧一代的提醒不会晚于新内核受理。执行中的崩溃、回退、换 Profile、换目录、主动重置写在结果里，（planned）不发提醒。

## 状态与转换

| 内核 | 事件 | 下一状态 |
|---|---|---|
| 没有 | 调用 `eval` | 启动中 |
| 启动中 | 握手成功 | 执行中 |
| 启动中 | 入口不可用、版本不符、进程起不来 | 没有（这次调用失败） |
| 执行中 | 单元结束 | 空闲 |
| 执行中 | 超时、停止 | 没有 |
| 空闲 | 调用 `eval`（叶子没移动、没 `reset`） | 执行中 |
| 空闲 | 叶子移动后调用、`reset: true` | 执行中（先重置） |
| 空闲 | 会话关闭 | 空闲（内核留着，空闲计时照旧） |
| 空闲 | 30 分钟没调用、被回收、服务端停止 | 没有 |
| 任意 | 进程意外退出 | 没有（下一次调用起新内核并提示） |

时序与寿命：

- `eval` 是 `exclusive`：同一个会话同一时刻只有一个单元在执行；同一条回复里的几个 `eval` 依次执行，后一个读得到前一个留下的变量。
- 叶子有没有移动按 [`harness/runtime.md`](../harness/runtime.md) 输出 102 的计数判断：同一条回复里的几次调用看到同一个值，不会互相判成重置。
- 单元的结果在它的嵌套调用都结算之后才交回（输出 5、14）。
- 会话关闭不结束内核，会话再打开后的调用接着用留着的内核（输出 11）。关闭前那次打开的工具实现上再来的调用直接失败，不起内核（planned：公开接口里关闭的会话不再有运行，没有测试）。
- 服务端停止时，会话都关完之后结束全部内核与它们起的子进程，会话关闭之后留着的也一样。
- 服务端异常退出（包括内核正卡在同步死循环里）时，内核与它起的子进程随之结束。

## 副作用与数据

- 每个有内核的会话多一个子进程（连同代码起的子进程），会话关闭之后至多再留 30 分钟；内核里的变量不落盘，重置之后就没了（输出 11）。
- 日志里：父调用照常写 `toolStarted` 与 `toolResult`，嵌套调用写 [`harness/runtime.md`](../harness/runtime.md) 输出 96 的事件（结果只有 2 KB 预览）。
- 结果全文超出窗口时同 `shell` 存全文。
- 代码经 `tool.*` 写的文件，来源与分组见 [`resources.md`](resources.md) 输出 17。

## 失败与恢复

| 码 | 含义 | 调用方怎么办 |
|---|---|---|
| `code-error` | 代码抛错、有语法错误、有 `export`、声明了内核提供的名字、没人接的错误 | 改代码重试；只重试失败的那一步 |
| `timeout` | 单元超过时限，内核已重置 | 拆小、加大 `timeout`，重新建变量 |
| `kernel-unavailable` | 内核起不来（入口不可用、版本不符、进程起不来），带原因（planned） | 不重试同一段代码；把原因告诉用户 |
| `kernel-exited` | 执行中内核意外退出（带退出码或信号与错误流的尾部），内核已重置 | 看原因；重新建变量后重试 |
| `returns-mismatch` | 工具成功了，但交回的结构不符合它声明的 `returns`；代码里以 `ToolCallError` 收到 | 告诉用户这个工具交回的结构不对；代码里可以 `catch` 后改用别的办法 |
| `aborted` | 运行被停止，内核已重置（输出 15） | 运行已经停了；下一次调用重新建变量 |
| `invoke-not-allowed`、`code-only`、`invoke-limit`、`parent-finished`、`async-in-code` | 嵌套调用的拒绝，代码里以 `ToolCallError` 收到 | 见 [`harness/runtime.md`](../harness/runtime.md) 输出 92 到 100、[`builtin-tools.md`](builtin-tools.md) 输出 29 |

## 边界与兼容

- 公开接口：工具 id `nbook.agent.eval` 与上面的参数；`agent.tools` 声明的 `invokes`、`codeCallable`、`global`、`returns` 与贡献点 `agent.evalObjects`（[`contributions.md`](contributions.md) 输出 24、25）；`docs://eval`。
- 信任边界：代码以服务端进程的权限运行，没有沙箱；`eval` 按权限规则判定，经用户批准或规则、审批模式放行之后才执行（输出 18）。
- 全局对象的方法收单个对象参数；以后加插件的内核侧代码、句柄、回调时只加不改。

## 验收与 Smoke

1. 一条回复里两个 `eval`：第一个定义变量与函数、读三章并统计，第二个用这些变量接着算；回退到第一个之前再调，结果第一行写明重置，变量没了。
2. 代码在 `ask` 审批模式下调 `write`：询问写明是 eval 里的调用，拒绝之后代码 `catch` 住 `ToolCallError` 接着跑，结果里写明哪次被拒；对话里卡片列出被拒的那一次。
3. 死循环到时限：内核与它起的 `sleep` 子进程都结束，结果写明重置；下一次调用照常、提示重置。
4. 从应用包与 `dist/server` 各起一次服务，在另一个目录的会话里调一次 `eval`；服务端环境里的哨兵变量在，工作目录 `.env` 里的变量不在（planned：从源码起的服务已验证这几点，两种打包产物还没有）。
5. 示例插件登记一个全局对象与它的方法：代码里调到并拿到 `returns` 声明的对象，方法不进模型的工具清单，没绑定方法的会话里没有这个对象；读 `docs://eval/<对象名>.md` 看到生成的签名；另一个插件登记同名对象时两个都不可用并有诊断。

Smoke：`packages/neuro-book/src/plugins/agent/eval.llm.test.ts`（`test:llm`，真实模型批量读章统计、调一个要审批的写工具）。

## 实现合同

- **公开入口**：工具 `nbook.agent.eval`（`nbook.agent` 经 `agent.tools` 贡献）；`agent.tools` 声明的 `invokes`、`codeCallable`、`global`、`returns` 与贡献点 `agent.evalObjects`（SDK `@notnotype/nb-plugin-sdk/agent` 的 `evalObject`）；`docs://eval`。代码里调工具经 nb-harness 的 `ToolContext.invoke`（[`harness/runtime.md`](../harness/runtime.md) 输出 90 起）。
- **owner 与依赖方向**：`nbook.agent` 的服务端入口持有全服务端的内核登记表，每个会话的内核按会话 id 存在里面；内核是 `bun` 子进程，入口 `eval-kernel.js` 随 `build:server` 与应用包产出；依赖 nb-harness 的嵌套调用通道与输出暂存（`kit/tools` 的 `OutputCapture`），不反向依赖。
- **关键不变量**：
  - 内核进程是自己进程组的组长：重置、回收、意外退出与服务端停止时整组结束，服务端异常退出时由内核里的看门狗线程收组（输出 13，`eval.test.ts`“死循环到时限”“process.exit”“会话关闭不结束内核”“服务端停止时结束全部内核”，`backend/eval/kernel.test.ts`“服务端被杀”）。
  - 内核与重置原因按会话 id 存在登记表里，不挂在会话的工具实现上：会话关闭时工具实现释放，内核留着，再打开后新的工具实现接着用；叶子移动与换 Profile 都按日志里的计数比（后者是扩展 `nbook.agent.eval-state` 数的 `profileChanged`），关闭前后可比；工作目录与布局变量每次调用重新解析，与起内核时比；正在执行的（包括还在起内核的）不被登记表丢掉或回收（输出 11、12，`eval.test.ts`“会话关闭不结束内核”“会话关闭之后回退”“换了 Profile 之后再调”，`eval-projects.test.ts`，`backend/eval/kernel.test.ts`“内核登记表”）。
  - 输出按单元归属：经 IPC 的消息带单元号，直接写到标准输出与错误的靠两条管道上的结束标记分界（输出 2、5，`backend/eval/kernel.test.ts`）。
  - 重置提示看当前路径上的 eval 结果数（扩展 `nbook.agent.eval-state`），同一条回复里还没写进日志的，看这个会话在叶子没动过时跑过的单元（输出 12，`eval.test.ts`“reset: true”）。
  - 单元时限与空闲回收都在宿主注入的时钟上，握手按真实时间；每次调用的每个出口都重新计空闲，提前交回的（语法错误）也算（输出 11、14，`eval.test.ts`“等审批的时间不算进时限”“30 分钟没有调用”）。
  - 代码里调工具一律经 `ctx.invoke`，宿主不另走执行路径：准入、审批、拦截与日志都同模型调工具（输出 6，`eval.test.ts`“询问模式下 eval 的审批不能记”）。

## 证据

- 批准依据：[w00032 t21](../../../.agents/works/w00032-agent-integration/tasks/t21-eval-codeact/README.md) 的决定 1 到 7 与[计划](../../../.agents/works/w00032-agent-integration/tasks/t21-eval-codeact/plan.md)第 3 稿（开发者 2026-11-18 确认）；会话关闭后保留内核：[w00032 t40](../../../.agents/works/w00032-agent-integration/tasks/t40-eval-kernel-survives-session-close/README.md)（开发者 2026-11-19 确认）；`ToolCallError.details`、自报的等用户与签名的字段说明（输出 8、14、17 的 planned 部分）依据 [w00033 t03 计划](../../../.agents/works/w00033-page-agent/tasks/t03-ui-guide/plan.md)（开发者 2026-11-26 确认）
- 实现入口：[`backend/eval/tool.ts`](../../../packages/neuro-book/src/plugins/agent/backend/eval/tool.ts)、[`kernels.ts`](../../../packages/neuro-book/src/plugins/agent/backend/eval/kernels.ts)、[`kernel-entry.ts`](../../../packages/neuro-book/src/plugins/agent/backend/eval/kernel-entry.ts)、[`rewrite.ts`](../../../packages/neuro-book/src/plugins/agent/backend/eval/rewrite.ts)、[`objects.ts`](../../../packages/neuro-book/src/plugins/agent/backend/eval/objects.ts)
- 合同测试：[`eval.test.ts`](../../../packages/neuro-book/src/plugins/agent/eval.test.ts)（真实服务端内核、真实内核子进程、本机的 OpenAI 兼容端点）、[`eval-projects.test.ts`](../../../packages/neuro-book/src/plugins/agent/eval-projects.test.ts)（另加真实项目子进程）、[`backend/eval/kernel.test.ts`](../../../packages/neuro-book/src/plugins/agent/backend/eval/kernel.test.ts)、[`rewrite.test.ts`](../../../packages/neuro-book/src/plugins/agent/backend/eval/rewrite.test.ts)、[`objects.test.ts`](../../../packages/neuro-book/src/plugins/agent/backend/eval/objects.test.ts)、示例场景 [`10-eval-object.test.ts`](../../../packages/neuro-book/plugin-sdk/examples/scenarios/10-eval-object.test.ts)
- Smoke：[`eval.llm.test.ts`](../../../packages/neuro-book/src/plugins/agent/eval.llm.test.ts)（`test:llm`，真实模型）
