---
schema: nbook.spec/v1
kind: behavior
status: planned
capability: agent.eval
owners:
  - nbook.agent
---

# 代码执行（eval）

## 目标与非目标

给 Agent 一个写 JS 来批量做事的工具：模型写一段代码，在代码里调会话里的工具（`await tool.read({path})`）、用插件登记的全局对象，一次调用读很多章、统计、按结果再改，不用一轮轮调工具。每个会话一个常驻内核，顶层变量跨调用保留。代码里调的工具照常审批、过拦截、记日志（[`harness/runtime.md`](../harness/runtime.md) 输出 90 起）。

不承诺：

- 沙箱：代码能直接读写文件、联网、起进程，审批是唯一的门，与 `shell` 同档；代码绕过 `tool.*` 直接写的文件没有来源与分组，界面也看不到。
- Python、装依赖、顶层静态 `import`、TypeScript 语法。
- 代码里调模型与派子代理。
- 插件提供在内核里执行的代码（全局对象只有“对象.方法”一种写法）。
- 变量在回退、切分支、重启、空闲回收之后还在。
- 自动转后台；表格、JSON 这类富输出（只有文字与图片）。
- Windows 上的进程组收口没有验证。

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
| `timeout` | number | 单元时限，秒；缺省 30，1 到 3600 |
| `reset` | boolean | 先重置内核再执行 |

代码里可用：

- `tool.<名>(args)`：`<名>` 是工具交给服务商的名字（与模型调工具时用的相同），参数是一个对象。
- `<对象>.<方法>(args)`：这个会话里可用的全局对象，参数是一个对象。
- `display(image)`：`image` 是 `{data, mime}`，`data` 是 base64 字符串或字节。
- `console` 的方法与 `process.stdout.write`。
- Bun 与 Node 的内置模块经 `await import("node:…")`、`await import("bun:…")`。

## 输出与可观察行为

### 执行

1. 一次调用在本会话的内核里执行 `code`；顶层声明（`var`、`let`、`const`、`class`、函数）跨调用保留，后一个单元改了全局变量，前一个单元定义的函数读到新值；带 `"use strict"` 的单元同样。最后一个表达式（或顶层 `return`）的值显示在结果末尾，`undefined` 不显示。
2. 结果文字是这个单元的输出（`console` 与 `process.stdout.write`，按先后）加最后的值；值与 `console` 的参数按 Bun 的格式化转成文字。窗口与全文同 `shell`（[`builtin-tools.md`](builtin-tools.md) 输出 21）。
3. 代码抛错或有语法错误：结果状态 `error`、码 `code-error`，文字是错误之前的输出加错误信息与堆栈（去掉内核自身的帧），堆栈的行号指向这段代码。顶层有静态 `import` 时不执行，得 `code-error`，说明改用 `await import(…)`。
4. 图片：`display(image)` 与代码里调的工具交回的图片都附在结果里，至多 8 张，多的丢掉并在文字里注明；缩放规则同 `read`（[`builtin-tools.md`](builtin-tools.md) 输出 7）。
5. 单元正常结束时还有没 `await` 的嵌套调用在途：等它们结束再交结果。

### 代码里调工具

6. `tool.<名>(args)` 与 `<对象>.<方法>(args)` 发起一个嵌套调用（[`harness/runtime.md`](../harness/runtime.md) 输出 90 到 101），准入、审批、拦截、事件与收口都照那里。
7. 交回的值由工具声明决定，每次都一样：声明了 `returns` 的，成功时交回照它校验过的结构化值（不合格算这次调用出错）；没声明的，成功时交回结果文字。图片并进本单元的结果（输出 4）。
8. 结局不是 `ok` 时抛 `ToolCallError`，带 `tool`、`status`、`code` 与说明；`unknown` 的说明写明“不知道有没有执行完，先核对再重做”。代码可以 `catch` 它接着跑。
9. 参数不是一个能写进日志的 JSON 对象时，这一次调用以 `invalid-arguments` 失败，别的不受影响。

### 内核的寿命与重置

10. 内核在本会话第一次调 `eval` 时起，工作目录与布局变量同 `shell`（[`builtin-tools.md`](builtin-tools.md) 输出 18、20），环境继承服务端，不读工作目录里的 `.env`。
11. 内核在这些时候重置（之前的变量没了）：上次调用之后叶子被移动过（回退、切分支）；`reset: true`；单元超时或被停止；30 分钟没有调用；整个服务端的内核超过 8 个时最久没用的那个；服务端重启；分叉出的会话从新内核开始。
12. 新内核第一次执行时，若当前路径上已经有过 `eval` 的结果，结果第一行写明内核已重置、之前的变量没了，并写原因（回退或切分支、主动重置、超时、停止、空闲、被回收、重启或分叉）。
13. 重置时连同内核起的子进程一起结束，结束了才交结果；服务端异常退出时内核自己结束它与它起的子进程。

### 时限与停止

14. 单元时限只计没有嵌套调用在途的时间：等审批、等提问、慢工具都不计。到时限：先按 [`harness/runtime.md`](../harness/runtime.md) 输出 100 结算在途的嵌套调用，再重置内核；结果状态 `error`、码 `timeout`，文字是已有的输出加重置说明。
15. 运行被停止时同样先结算嵌套调用、再重置内核；结果照运行中止的规则（[`harness/runtime.md`](../harness/runtime.md) 输出 25）。

### 说明与全局对象

16. 给模型的说明写明：怎样调工具与全局对象、交回什么与失败时抛什么、不支持顶层静态 `import`、变量什么时候会丢；列出这个会话里可用的全局对象，每个一行摘要加文档地址 `docs://eval/<对象名>`（[`resources.md`](resources.md) 输出 16）。至少有一个方法在生效工具集里的对象才可用、才列出。
17. 文档按需读：说明里只有一行摘要，完整的方法签名与说明在文档地址里。

### 审批

18. `eval` 的审批见 [`permissions.md`](permissions.md) 输出 25：执行档，询问不能记。代码里调的工具照 [`permissions.md`](permissions.md) 输出 24 逐个判定。
19. 代码里不能调：收尾工具、`eval` 自己、派子代理与给子代理发话和答话、待办、切换模式（得 `invoke-not-allowed`）；`shell` 的 `async` 见 [`builtin-tools.md`](builtin-tools.md) 输出 29。

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
| 空闲 | 30 分钟没调用、被回收、会话关闭、服务端停止 | 没有 |
| 任意 | 进程意外退出 | 没有（下一次调用起新内核并提示） |

时序与寿命：

- `eval` 是 `exclusive`：同一个会话同一时刻只有一个单元在执行；同一条回复里的几个 `eval` 依次执行，后一个读得到前一个留下的变量。
- 叶子有没有移动按 [`harness/runtime.md`](../harness/runtime.md) 输出 102 的计数判断：同一条回复里的几次调用看到同一个值，不会互相判成重置。
- 单元的结果在它的嵌套调用都结算之后才交回（输出 5、14）。
- 会话关闭时结束内核；内核与它起的子进程在会话关闭之后不再运行。

## 副作用与数据

- 每个有内核的会话多一个子进程（连同代码起的子进程）；没有别的持久数据。
- 日志里：父调用照常写 `toolStarted` 与 `toolResult`，嵌套调用写 [`harness/runtime.md`](../harness/runtime.md) 输出 96 的事件（结果只有 2 KB 预览）。
- 结果全文超出窗口时同 `shell` 存全文。
- 代码经 `tool.*` 写的文件，来源与分组见 [`resources.md`](resources.md) 输出 17。

## 失败与恢复

| 码 | 含义 | 调用方怎么办 |
|---|---|---|
| `code-error` | 代码抛错、有语法错误或顶层静态 `import` | 改代码重试 |
| `timeout` | 单元超过时限，内核已重置 | 拆小、加大 `timeout`，重新建变量 |
| `kernel-unavailable` | 内核起不来（入口不可用、版本不符、进程起不来），带原因 | 不重试同一段代码；把原因告诉用户 |
| `kernel-exited` | 执行中内核意外退出，内核已重置 | 重新建变量后重试 |
| `invoke-not-allowed`、`code-only`、`invoke-limit`、`parent-finished`、`async-in-code` | 嵌套调用的拒绝，代码里以 `ToolCallError` 收到 | 见 [`harness/runtime.md`](../harness/runtime.md) 输出 92 到 100、[`builtin-tools.md`](builtin-tools.md) 输出 29 |

## 边界与兼容

- 公开接口：工具 id `nbook.agent.eval` 与上面的参数；`agent.tools` 声明的 `invokes`、`codeCallable`、`global`、`returns` 与贡献点 `agent.evalObjects`（[`contributions.md`](contributions.md) 输出 24、25）；`docs://eval/`。
- 信任边界：代码以服务端进程的权限运行，没有沙箱；能执行它的只有经过审批（或审批模式放行）的调用。
- 全局对象的方法收单个对象参数；以后加插件的内核侧代码、句柄、回调时只加不改。

## 验收与 Smoke

1. 一条回复里两个 `eval`：第一个定义变量与函数、读三章并统计，第二个用这些变量接着算；回退到第一个之前再调，结果第一行写明重置，变量没了。
2. 代码在 `ask` 审批模式下调 `write`：询问写明是 eval 里的调用，拒绝之后代码 `catch` 住 `ToolCallError` 接着跑，结果里写明哪次被拒；对话里卡片列出被拒的那一次。
3. 死循环到时限：内核与它起的 `sleep` 子进程都结束，结果写明重置；下一次调用照常、提示重置。
4. 从应用包与 `dist/server` 各起一次服务，在另一个目录的会话里调一次 `eval`；服务端环境里的哨兵变量在，工作目录 `.env` 里的变量不在。
5. 示例插件登记一个全局对象与两个方法：代码里调到；读 `docs://eval/<对象名>` 看到生成的签名；另一个插件登记同名对象时两个都不可用并有诊断。

Smoke：`packages/neuro-book/src/plugins/agent/eval.llm.test.ts`（`test:llm`，真实模型批量读章统计、调一个要审批的写工具）。

## 证据

- 批准依据：[w00032 t21](../../../.agents/works/w00032-agent-integration/tasks/t21-eval-codeact/README.md) 的决定 1 到 7 与[计划](../../../.agents/works/w00032-agent-integration/tasks/t21-eval-codeact/plan.md)第 3 稿（开发者 2026-11-18 确认）
