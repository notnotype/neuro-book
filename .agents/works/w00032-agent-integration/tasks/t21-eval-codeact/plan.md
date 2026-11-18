# t21 计划：eval 工具（CodeAct）第一版

## Context

模型写一段 JS，在代码里批量调工具：跨很多章节的读、统计、按结果再改，一次调用做完，不用一轮轮调工具。另一个用处是给插件一个“全局对象”的出口：w00033（操作应用界面的 `nbook`）、w00034（浏览器 `browser`）、w00036（MCP 按需加载）都约定走 eval，不作内置工具，都在等它的贡献点。

开发者 2026-11-18 定的范围（[README](README.md) 决定 1 到 4）：

1. 常驻 JS 内核、代码里 `await tool.<名>(…)` 调会话里的工具、插件登记全局对象（一行摘要加文档地址，按需读）、对话里显示代码与输出；调模型（`judge`、`completion`）与派子代理留到下一批。
2. 每个会话一个常驻内核，顶层变量跨调用保留；回退、分叉、服务重启、空闲超时后重置，下一次调用的结果写明。
3. 整段代码按执行档审批；批准后代码里经 `tool.*` 的调用再按各自的档位照常审批。
4. 只做 JS（Bun），不支持装依赖。

参照：[omp 的 JS 内核](../../research/2026-11-18-omp-eval-js-kernel.md)、[宿主操作调研](../../research/2026-10-30-host-control-survey.md)第 5、6 节。与 omp 有意不同的两处：代码里调的工具照常审批、照常过拦截链、照常记日志（omp 的桥只校验参数就直接执行）；内核在 Agent 里调不到自己。

依赖的现有合同：[`harness/runtime.md`](../../../../../docs/specs/harness/runtime.md)（工具调用、审批阶段、`ctx.read`、`ctx.ask`、调用身份 输出 87）、[`agent/builtin-tools.md`](../../../../../docs/specs/agent/builtin-tools.md)（`shell` 的工作目录、环境、输出窗口与全文）、[`agent/permissions.md`](../../../../../docs/specs/agent/permissions.md)、[`agent/contributions.md`](../../../../../docs/specs/agent/contributions.md)、[`agent/resources.md`](../../../../../docs/specs/agent/resources.md)（`docs://`、资源视图的 `call(ctx)` 分组）。

工作方式：Spec 在计划确认后写（`planned`）；计划过设计审查（后端：omp；前端：Sonnet，界面部分在评审板定稿之后再审）；实现每片自跑验证、单独提交，Task 收口做一次实现审查（后端 omp、前端 Sonnet）。

## 技术选型

| 问题 | 选用 | 理由；否决 |
|---|---|---|
| 隔离与中止 | 每个内核一个 Bun 子进程（`Bun.spawn` 的 `ipc`），中止与超时 SIGKILL | 同步死循环只有杀进程能停；进程崩了不连累服务端。否决 Worker（omp 只作后备）与宿主内的 `node:vm`（停不下来；Bun 下 terminate 正在 `vm` 里跑的 Worker 会 SIGTRAP，见调研） |
| 执行与跨调用保留变量 | 间接 eval 在内核进程的全局上执行，顶层声明改写 | 同 omp，原因见调研；不用 `vm` 同上 |
| 改写用的解析器 | `acorn`（工作区已有，nb-canon 在用） | 小、稳定、给出位置，只做顶层改写够用。否决 `@babel/parser`（大，TS 不在范围）、`Bun.Transpiler`（不给 AST） |
| 输出窗口与全文 | 复用 nb-harness `kit/tools/shell-window.ts` 与 `shell` 存全文的做法 | 与 `shell` 一致，模型只学一套 |
| 值的显示 | `Bun.inspect` | 运行时自带；否决自写格式化 |

## 关键设计

### nb-harness 内核：工具里调工具（`packages/nb-harness/src/kernel/`）

只有内核能给“代码里调的工具”同样的审批、拦截与日志，所以在内核加一条正式通道，eval 只是第一个用它的工具。

- **`ToolContext.invoke?(tool: string, args: Record<string, unknown>): Promise<ToolResult>`**（`api/tool.ts`）。只给模型直接发起的调用；`invoke` 发起的调用拿到的上下文没有 `invoke`，所以嵌套只有一层，eval 调不到 eval。
- **`ToolDeclaration.exposure?: "model" | "code"`**，缺省 `model`。`code` 的工具不进请求的工具清单，只能经 `invoke` 调；别的规则（Profile 绑定、审批、拦截）不变。
- **流水线**（`run/tools.ts`，从 `runCall` 抽出可复用的一段，不复制）：调用 id 为 `<父 callId>~<n>`；不在生效工具集、是收尾工具、与父调用同一个工具时直接得 `error`（码 `invoke-not-allowed`，不抛）；参数校验、只读模式、审批钩子（`ApprovalCtx` 多一个 `within: {tool, invocation}`）；判定 `ask` 时立即写 `interactionRequested{kind: "approval"}` 并等（不进输出 79 的批量阶段：代码是一个一个调的），请求里带 `within`，界面据此写“eval 里的调用”；然后拦截链、`toolStarted`（ctrl，多 `within`）、执行、写新的 ctrl 事件 `nestedToolResult{invocation, within, callId, tool, status, code?, text, images?, details?}`。
- **不进模型上下文**：`nestedToolResult` 是 ctrl，组请求不投影它；模型只看到父调用的 `toolResult`。回退、分叉跟着父调用所在的路径走（path 事件）。
- **并发**：同一个父调用里，`shared` 的嵌套调用可以并发，`exclusive` 的等在途的都完成、独占执行。
- **中止与收尾**：嵌套调用用父调用的 `signal`；父调用结束后再来的 `invoke` 得 `error`（码 `parent-finished`）。打开会话时，有 `toolStarted{within}` 而没有对应结果的，照输出 34、53 记为 `unknown`。
- **守卫**：`loop-guard` 只数模型发起的调用；嵌套调用不计（写进 Spec）。
- **与审批简化提案的关系**：该提案要给询问与放行加 `cause`（同一段代码）。本片在它合入之后开工，嵌套调用的 `cause` 照它的写法填。

### nbook.agent：eval 工具与内核（`packages/neuro-book/src/plugins/agent/backend/eval/`）

- **工具** `nbook.agent.eval`（`providerName: "eval"`）：参数 `{code: string, title?: string, timeout?: number, reset?: boolean}`；`effect: "exec"`、`exclusive`、`strict`。说明文字（英文，给模型）：用法、`tool.<providerName>(args)` 的返回与失败、可用的全局对象各一行加文档地址、不支持顶层静态 `import`（用 `await import("node:…")`）、变量跨调用保留与何时丢。
- **内核宿主** `kernels.ts`：工具实现每个会话建一次（内核寿命挂在它上面，`dispose` 时杀进程）。第一次调用时起子进程：`Bun.spawn([process.execPath, <kernel-entry>], {ipc, cwd, env})`，工作目录与环境同 `shell`（[`builtin-tools.md`](../../../../../docs/specs/agent/builtin-tools.md) 输出 18、20）。入口文件要进应用包（`scripts/pack-app.ts`）。
- **协议**（`protocol.ts`，TypeBox 校验两端消息）：宿主发 `run{cell, source}`、`reply{id, result}`；内核发 `log{cell, text}`、`display{cell, image}`、`call{id, cell, tool, args}`、`done{cell, value?, error?}`。`call` 由宿主转给 `ctx.invoke`。
- **内核** `kernel-entry.ts` 与 `rewrite.ts`：acorn 解析（`ecmaVersion: "latest"`、允许顶层 `await` 与 `return`），顶层 `const`/`let`/`class` 降为 `var`，有顶层 `await` 时包进异步函数、声明改成对全局的赋值，最后一个表达式与顶层 `return` 的值交回；`console.*` 与 `process.stdout.write` 收进本单元。`tool` 是 Proxy：成功且只有文字时交回字符串，有 `details` 或图片时交回 `{text, details?, images?}`，`error`、`denied`、`blocked` 抛 `ToolCallError{tool, status, code, message}`；`display(image)` 把图片加进结果。
- **结果**：文字是输出加最后的值，失败时加去掉内核自身帧的堆栈；窗口与全文同 `shell`；图片至多 8 张，按 `read` 的规则缩放（`kit/tools/image.ts`）。
- **时限**：`timeout` 秒，缺省 30、1 到 3600；等用户应答（嵌套调用的审批、提问）的时间不计。超时或中止杀进程，结果写明“内核已重置”。
- **空闲回收**：30 分钟没有调用就杀进程。
- **重置的判定与提示**（决定 2）：每次结果的 `details` 带 `{kernel, cell}`；扩展 `nbook.agent.eval-state` 从 `toolResult` 归约出当前路径上最后一个单元，工具经 `ctx.read` 读它。路径上的不是内核最后跑的单元（回退、切分支）时先杀进程；内核不在（重启、空闲、超时）而路径上跑过单元时，这次结果第一行写明重置。分叉出的会话是新实现、新内核，同样提示。`reset: true` 主动重置。
- **审批预览**：`backend/builtin/preview.ts` 给 eval 交代码全文；`auto` 模式审批模型看到的也是它。

### 全局对象（`agent.tools` 的声明，`shared/points.ts`）

不另开贡献点：全局对象就是一个 `exposure: "code"` 的工具，声明多一个 `global: {name, summary, docs}`（`name` 是 JS 标识符，`summary` 一行英文，`docs` 是 Markdown）。这样审批（档位就是工具的 `effect`）、拦截、日志、Profile 绑定都现成。

- 内核里 `<name>.<方法>(...args)` 是 Proxy，调 `invoke(<工具 id>, {method, args})`，插件按 `method` 分派。第一版没有插件提供的内核侧代码（句柄、回调这类更顺手的写法留给 w00033 设计时再加）。
- 名字与内置名（`tool`、`display`、内核保留的全局）或别的全局冲突时，后登记的不进这个会话并诊断。
- 文档：`docs://eval/<name>`，由 nbook.agent 按声明生成，读法同别的 `docs://`。eval 的说明只列这个会话生效工具集里的全局对象。
- 示例与验收：`plugin-sdk/examples/` 加一个最小的全局对象示例（带讲解注释与场景测试）。

### 对话视图（`packages/nb-agent-ui`、`plugins/agent/web`）

- eval 卡片：标题（`title` 或代码第一行）、代码（高亮）、输出、图片、里面调过的工具作为子行（可点开，复用各工具已有的详情）、重置提示。
- 审批向导：eval 的预览是代码；嵌套调用的询问写明“eval 里的调用”。
- 先出静态稿上评审板，开发者定稿后再写组件与 Spec 的界面部分。

## Spec 与文档改动

- 新建 `docs/specs/agent/eval.md`（planned）：工具、内核寿命、输出、时限、重置提示、全局对象与文档。
- `harness/runtime.md`：输出 96 起，`invoke`、`exposure`、`nestedToolResult`、嵌套审批、并发、中止与恢复。
- `agent/contributions.md`：`agent.tools` 的 `exposure` 与 `global`。
- `agent/permissions.md`：嵌套调用照常判定，询问带来源；eval 是执行档。
- `agent/resources.md`：`docs://eval/`。
- `agent/builtin-profiles.md`：eval 进哪些 Profile（待确认 1）。
- `ui/agent-conversation-view.md`：eval 卡片与嵌套询问（评审板之后）。
- `plugin-sdk` 作者文档：全局对象。

## 切片

1. **Spec**：上面除界面以外的条目，`planned`。
2. **内核通道**（nb-harness）：`invoke`、`exposure`、事件、恢复。验证：nb-harness 的 bun 测试（真实内核、测试工具），类型检查。
3. **eval 工具与内核**（nbook.agent）：子进程、改写、协议、输出、时限、空闲、重置、审批预览、打包。验证：`plugins/agent/eval.test.ts`（真实服务端内核、真实子进程），`rewrite.test.ts`，应用包测试。
4. **全局对象**：声明、Proxy、`docs://eval/`、SDK 示例。验证：同上加示例的场景测试。
5. **界面**：评审板定稿 → 卡片、子行、审批向导、Lab 场景、e2e。
6. **真实模型**：`eval.llm.test.ts`（批量读几章做统计；调一个要审批的写工具）。

## 验收映射

Spec 写好后按编号补；先列要覆盖的场景：

- 变量跨两次调用保留；顶层 `await` 下也保留；最后一个表达式的值显示。→ `rewrite.test.ts`、`eval.test.ts`
- 死循环到时限被杀，结果写明重置，下一次调用照常。→ `eval.test.ts`
- 代码里调 `write`：`allow-writes` 下放行、`ask` 下问一次且询问带来源；拒绝时代码收到 `ToolCallError`。→ nb-harness 测试、`eval.test.ts`
- 嵌套调用的写入来源是嵌套调用的条目、同一组；`nestedToolResult` 不进请求。→ `eval.test.ts`、nb-harness 测试
- 回退到 eval 之前再调：内核重置并提示；分叉出的会话同样。→ `eval.test.ts`
- 中途停止：子进程被杀，在途的嵌套调用收到中止。→ `eval.test.ts`
- 全局对象：只在绑定了它的 Profile 里可用；文档地址读得到。→ 示例场景测试
- 界面：评审板之后补。

## 验证

- 受影响的单测与类型检查（nb-harness、neuro-book、nb-agent-ui）。
- 真实子进程、真实服务端内核的合同测试；应用包里起得来内核（`pack-app.test.ts`）。
- 界面切片：Lab 场景与覆盖它的 e2e。
- 真实模型 smoke（`test:llm`）。
- 未验证边界：Windows 上的子进程与 SIGKILL（只在 Linux 跑）；内存占用只记一次读数。

## 不做与风险

- 不做：代码里调模型与子代理（下一批）；Python；装依赖；插件的内核侧代码；自动转后台；富输出里的表格与 JSON 视图（只有文字与图片）。
- 没有沙箱：代码能直接读写文件、联网、起进程，审批是唯一的门（决定 3，与 `shell` 同档）。代码绕过 `tool.*` 直接写文件时，没有来源与分组。
- 每个有内核的会话多一个 Bun 进程（约几十 MB），靠空闲回收兜住。
- 与审批简化提案改同一段内核代码，切片 2 排在它合入之后。

## 待确认

1. eval 进哪些内置 Profile：推荐同 `shell`，作主创（`nbook.agent.main`）与临时帮手（`nbook.agent.adhoc`）的可选工具。
2. 缺省值：单元时限 30 秒（同 omp），空闲 30 分钟回收内核。
3. 全局对象第一版只有 `对象.方法(...参数)` 一种写法，没有插件提供的内核侧代码；w00033、w00034 要句柄或回调时再加。
