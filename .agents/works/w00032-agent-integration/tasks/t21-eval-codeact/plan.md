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

工作方式：Spec 在计划确认后写（`planned`）；计划过设计审查（后端与事实：omp；从整体看：Claude Opus；对话视图一节：Sonnet）；实现每片自跑验证、单独提交，Task 收口做一次实现审查（后端 omp、前端 Sonnet）。

## 技术选型

| 问题 | 选用 | 理由；否决 |
|---|---|---|
| 隔离与中止 | 每个内核一个 Bun 子进程（`Bun.spawn` 的 `ipc`），中止与超时 SIGKILL | 同步死循环只有杀进程能停；进程崩了不连累服务端。否决 Worker（omp 只作后备）与宿主内的 `node:vm`（停不下来；Bun 下 terminate 正在 `vm` 里跑的 Worker 会 SIGTRAP，见调研） |
| 执行与跨调用保留变量 | 间接 eval 在内核进程的全局上执行，顶层声明改写 | 同 omp，原因见调研；不用 `vm` 同上 |
| 改写用的解析器 | `acorn`（工作区已有，nb-canon 在用） | 小、稳定、给出位置，只做顶层改写够用。否决 `@babel/parser`（大，TS 不在范围）、`Bun.Transpiler`（不给 AST） |
| 输出窗口与全文 | 复用 nb-harness `kit/tools/shell-window.ts` 与 `shell` 存全文的做法 | 与 `shell` 一致，模型只学一套 |
| 值的显示 | `Bun.inspect` | 运行时自带；否决自写格式化 |
| 全局对象的文档 | 手写一个小的 JSON Schema 到 TypeScript 声明的打印器 | 工具参数是 TypeBox 生成的 JSON Schema，只用到对象、数组、标量、枚举、联合、可选这几种；否决 `json-schema-to-typescript`（带 prettier，生成整份模块，体积与依赖都大） |

## 关键设计

第 2 稿按设计审查改过（Opus 从整体看 11 条、Sonnet 对话视图 13 条，处理见 README 的审查表；omp 的报告回来后再叠加）。

### nb-harness 内核：工具里调工具（`packages/nb-harness/src/kernel/`）

只有内核能给“代码里调的工具”同样的审批、拦截与日志（决定 3），所以在内核加一条正式通道；eval 是第一个用它的工具。

- **谁能调**：声明 `invokes: true` 的工具，执行时的 `ToolContext` 才有 `invoke(tool: string, args: Record<string, unknown>): Promise<ToolResult>`（`api/tool.ts`）。第一版只有 `nbook.agent.eval` 声明它。`invoke` 发起的调用拿到的上下文没有 `invoke`，嵌套只有一层。
- **谁能被调**：生效工具集里的工具，除了收尾工具、声明了 `invokes` 的工具、声明 `codeCallable: false` 的工具（靠 `toolResult` 归约改状态的工具，例如待办、切换模式：嵌套调用的结果不进扩展归约，从代码里调会只生效一半，所以直接拒）。不允许的得 `error`，码 `invoke-not-allowed`，不抛。
- **只能从代码里调的工具**：声明带 `global: {object, method}` 的工具不进请求的工具清单，也不进 `notice{tools-changed}` 的文字（仍进 `toolsAnnounced`，回退比对用）；只能经 `invoke` 调。别的规则（Profile 绑定、审批、拦截）不变。不另设可见性字段：以后 w00036 要“同一个工具在某些 Profile 里只走代码”时，加在 Profile 绑定上，Spec 写明这个方向。
- **流水线**（`run/tools.ts`，从 `runCall` 抽出可复用的一段，不复制）：调用 id 为 `<父 callId>~<n>`；参数校验、只读模式、审批钩子（`ApprovalCtx` 多 `within: {tool, invocation}`）；判定 `ask` 时立即写 `interactionRequested{kind: "approval"}` 并等，事项带 `within`（不进输出 79 的批量阶段：代码是一个一个调的）；嵌套工具经 `ctx.ask` 提问时事项同样带 `within`；然后拦截链、执行。
- **事件**：两个新的 ctrl、path 事件，成对出现，现有读 `toolStarted`、`toolResult` 的地方（对话视图的适配器、子代理树的计数、压缩时放回最近文件、组请求）都不受影响：
  - `nestedToolStarted{invocation, within, callId, tool, args, approval}`：开始执行时写。
  - `nestedToolResult{within, callId, tool, args, status, code?, by?, invocation?, preview, size, imageCount?}`：每个嵌套调用都写一条，没启动的（被拒、被拦、参数不对、不允许）也写，所以带 `args`（没启动的是代码传入的原参数）。结果正文只记前 2 KB 的 `preview` 与总字节数 `size`，图片只记张数：全文模型已经在父调用的结果里看到，界面的子行只要预览；批量读 300 章时全文进日志约 2.7 MB 一次，且不去重。
  - 每个嵌套事件单独成一个写入批，帧随之实时推给界面。
  - 出站过滤：两种事件的 `args` 按工具参数、`preview` 按工具结果走 `mapEventContent`（输出 54）。
- **不进模型上下文与归约**：组请求不投影这两种事件；扩展归约看不到它们（Spec 写明，需要的扩展自己订）。回退、分叉跟着父调用所在的路径走。
- **并发**：同一个父调用里，`shared` 的嵌套调用可以并发，`exclusive` 的等在途的都完成、独占执行。
- **上限**：一次父调用至多 2,000 个嵌套调用，超出的得 `error`、码 `invoke-limit`。`loop-guard` 只数模型发起的调用，这条是代码里失控循环的上限。
- **中止与收尾**：嵌套调用用父调用的 `signal`；父调用结束后再来的 `invoke` 得 `error`（码 `parent-finished`）。内核不给没结果的嵌套调用补事件；读的一方按“父调用有结果、嵌套调用没有”算 `unknown`。
- **与审批简化提案的关系**：该提案要给询问与放行加 `cause`（同一段代码）。本片在它合入之后开工，嵌套调用的 `cause` 照它的写法填。

### nbook.agent：eval 工具与内核（`packages/neuro-book/src/plugins/agent/backend/eval/`）

- **工具** `nbook.agent.eval`（`providerName: "eval"`）：参数 `{code: string, title?: string, timeout?: number, reset?: boolean}`；`effect: "exec"`、`exclusive`、`strict`、`invokes: true`。说明文字（英文，给模型）：用法、`tool.<providerName>(args)` 的返回与失败、可用的全局对象各一行加文档地址、不支持顶层静态 `import`（用 `await import("node:…")`）、变量跨调用保留与何时丢。
- **审批**：执行档；审批钩子对 eval 一律 `remember: false`（没有“本会话都批准”“以后都允许”：一次点击就等于放开任意代码，理由同 `shell` 不许记解释器）。要少问的用户用审批模式。
- **内核宿主** `kernels.ts`：工具实现每个会话建一次，内核寿命挂在它上面，`dispose` 时杀进程。第一次调用时起子进程：`Bun.spawn([process.execPath, <kernel-entry>], {ipc, cwd, env})`，工作目录与环境同 `shell`（[`builtin-tools.md`](../../../../../docs/specs/agent/builtin-tools.md) 输出 18、20）。入口文件进应用包（`scripts/pack-app.ts`）。全服务端至多 8 个内核，超出时回收最久没用的那个，走下面的重置提示。
- **协议**（`protocol.ts`，TypeBox 校验两端消息）：宿主发 `run{cell, source}`、`reply{id, result}`；内核发 `log{cell, text}`、`display{cell, image}`、`call{id, cell, tool, args}`、`done{cell, value?, error?}`。`call` 由宿主转给 `ctx.invoke`。
- **内核** `kernel-entry.ts` 与 `rewrite.ts`：acorn 解析（`ecmaVersion: "latest"`、允许顶层 `await` 与 `return`），顶层 `const`/`let`/`class` 降为 `var`，有顶层 `await` 时包进异步函数、声明改成对全局的赋值，最后一个表达式与顶层 `return` 的值交回；`console.*` 与 `process.stdout.write` 收进本单元。
- **`tool.<名>(args)` 的返回**：类型由声明决定，每次都一样。工具声明了 `returns`（JSON Schema，同 MCP 的 `outputSchema`）时交回照它校验过的 `details`，不合格算这次调用出错；没声明时一律交回文字。嵌套结果带的图片并进本单元的图片。`error`、`denied`、`blocked`、`unknown` 抛 `ToolCallError{tool, status, code, message}`。`display(image)` 也把图片加进结果。
- **结果**：文字是输出加最后的值，失败时加去掉内核自身帧的堆栈；窗口与全文同 `shell`；图片至多 8 张，多的丢掉并注明，按 `read` 的规则缩放（`kit/tools/image.ts`）。
- **时限**：`timeout` 秒，缺省 30、1 到 3600；只计没有嵌套调用在途的时间（等审批、等提问、慢工具都不计，`invoke` 的签名不用为此加东西）；失控循环由嵌套调用上限兜住。超时或中止杀进程，结果写明“内核已重置”。
- **空闲回收**：30 分钟没有调用就杀进程。
- **重置的判定与提示**（决定 2）：每次结果的 `details` 带 `{kernel, cell}`；扩展 `nbook.agent.eval-state` 从 `toolResult` 归约出当前路径上最后一个单元，工具经 `ctx.read` 读它。路径上的不是内核最后跑的单元（回退、切分支）时先杀进程；内核不在（重启、空闲、超时、被回收）而路径上跑过单元时，这次结果第一行写明重置。分叉出的会话是新实现、新内核，同样提示。`reset: true` 主动重置。
- **审批预览**：不加新的预览类型。`preview.ts` 对 eval 交回 `{files: []}`，向导照现有做法列参数，eval 把 `code` 排在最前、带标题与时限（同 `shell` 的分支）；`auto` 模式的审批模型读的是请求里的 `args`，看到的是代码全文。

### 全局对象（`agent.tools` 的声明加一个小贡献点，`shared/points.ts`）

一个方法就是一个工具，各有自己的 `parameters`、`effect`、`description`、`returns`；声明带 `global: {object, method}`。这样审批记忆与规则、审批预览、参数校验、拦截、日志、Profile 绑定都按方法、都现成，插件也不用自己分派。

- **对象**：新贡献点 `agent.evalObjects`，`{name, summary, docs?}`（`name` 是 JS 标识符，`summary` 一行英文，`docs` 是可选的 Markdown 说明），id `<插件 id>.<名>`。方法工具的 `global.object` 指向它。
- **内核里的写法**：`browser.goto({url})` 是 Proxy，映射为 `invoke(<方法工具的 id>, {url})`，单个对象参数，同 `tool.*`；返回同上。第一版没有插件提供的内核侧代码（句柄、回调这类更顺手的写法留给 w00033 设计时再加）。
- **重名**：对象名与内置名（`tool`、`display`、内核保留的全局）冲突时拒绝插件一方；两个插件登记同名对象时双方都不进会话，诊断写明两个来源（结果不随加载顺序变）。
- **文档**：`docs://eval/<对象名>`，由 nbook.agent 生成：一行摘要、插件写的说明、每个方法由 `parameters` 与 `returns` 生成的 TypeScript 签名加它的 `description`。eval 的说明只列这个会话里至少有一个方法在生效工具集的对象。
- **示例与验收**：`plugin-sdk/examples/` 加一个最小的全局对象示例（带讲解注释与场景测试）。

### 对话视图

注意力排序已定（README 决定 6），做起来复杂的地方可以从简。分工：子调用的数据、适配、计数与折叠卡片下的子行是通用能力，在 `packages/nb-agent-ui`；eval 的渲染器登记与详情组件是 `nbook.agent.eval` 的，在 `plugins/agent/web`。`activeCalls` 不变（eval 是前台调用，运行中的轮次本来就不收起）。

- **数据**（`nb-agent-ui`）：`ToolCallView` 加 `children?: ToolCallView[]` 与 `startedAt?: number`，写进 `ui/agent-conversation-view.md` 的 `Message[]` 形状。适配器（`kernel-transcript.ts`）认 `nestedToolStarted`、`nestedToolResult` 与带 `within` 的 `interactionRequested`：按 `within.invocation` 挂到父调用下；等审批时先放一个占位子调用，开始或结果到时按 `callId` 补上；父调用有结果而子调用没有的按 `unknown` 收口。原始视图与“复制工具调用”也列出子调用。流式生成参数时，`streamingArgs` 同样抽出 `title`，卡片标题不空。
- **计数**：嵌套调用读写的文件按子调用自己的状态算进思维链摘要与轮末改动（父调用失败时，失败前已经写成的照样列出），用注册表按子调用的工具名取 `effects`，放在 `conversation-turns.ts` 的通用逻辑里；文件去重与思维链用同一个函数。嵌套调用不进步骤数、“另有几次操作”与失败次数，它们只在卡片里计数与列出。
- **卡片**：eval 是 `card`。折叠时副标题写计数（“调用了 30 次工具：读了 28 个文件，改了 2 个”）；改文件、出错、被拒的几次作为卡片下方紧随的缩进行列出（照工具组“收起时出错项单独露出”的做法，由 `AgentChainBlock` 对有子调用的卡片画，展开状态按子调用 id 记在现有的 `openSet` 里）；子调用一律按 `line` 画（`shell` 这类 `card`、`task_create` 这类 `node` 都不例外）。展开后：代码在上、默认收起（`AgentCodeBlock` 加标题，不做语法高亮：现在没有只读高亮部件，要时另找库），输出与图片在下，再下面是全部子调用。
- **运行中**：副标题写“已调用 12 次 · read 第十二章”（从子调用推出）；卡片里显示已用时（`ctx.now - startedAt`，含等审批的时间）。思维链收起时摘要行仍是 eval 的标题（决定 6 允许从简）。
- **审批向导**：`PendingApprovalView` 加 `within?: {tool: string}`，`session-host.ts` 的映射带上，向导标题写“eval 里的调用”（两种语言）；提问向导同样。批量与“第 n / N 个”照旧适用。

## Spec 与文档改动

- 新建 `docs/specs/agent/eval.md`（planned）：工具、审批、内核寿命与上限、输出、`tool.*` 的返回、时限、重置提示、全局对象与文档。
- `harness/runtime.md`：输出 96 起：`invokes`、`codeCallable`、`global` 工具不进清单、`invoke` 的流水线、两种新事件与出站过滤、嵌套的审批与提问、并发、上限、中止与收尾。
- `agent/contributions.md`：`agent.tools` 的 `invokes`、`codeCallable`、`global`、`returns`；新贡献点 `agent.evalObjects`。
- `agent/permissions.md`：嵌套调用照常判定、事项带来源；eval 是执行档且不能记。
- `agent/resources.md`：`docs://eval/`。
- `agent/builtin-profiles.md`：eval 进主创与临时帮手的可选工具（决定 5），随切片 5 生效。
- `ui/agent-conversation-view.md`：`children`、`startedAt`、计数规则、卡片下的子行、向导的来源。
- `plugin-sdk` 作者文档：全局对象。

## 切片

1. **Spec**：上面的条目，`planned`。
2. **内核通道**（nb-harness）：`invokes`、`codeCallable`、`global`、流水线、两种事件、出站过滤、上限、恢复。验证：nb-harness 的 bun 测试（真实内核、测试工具），类型检查。
3. **eval 工具与内核**（nbook.agent）：子进程、改写、协议、返回、输出、时限、空闲与总数上限、重置、审批与 `remember`、打包。验证：`plugins/agent/eval.test.ts`（真实服务端内核、真实子进程）、`rewrite.test.ts`、应用包测试。这一片不进内置 Profile：界面做好之前，用户在询问里看不出那些调用来自代码。
4. **全局对象**：贡献点、Proxy、重名、`docs://eval/` 与声明生成、SDK 示例。验证：同上加示例的场景测试。
5. **界面**：数据、适配、计数、卡片与子行、向导；eval 进内置 Profile。验证：适配器契约测试（真内核，跟帧与重建两路结果相同）、DOM 测试与 Lab 场景（手写 `Message[]`）、一个 e2e 文件（嵌套审批出现并能批准，批准后计数变化）；做完截图给开发者看。
6. **真实模型**：`eval.llm.test.ts`（批量读几章做统计；调一个要审批的写工具）。

## 验收映射

Spec 写好后按编号补；先列要覆盖的场景：

- 变量跨两次调用保留；顶层 `await` 下也保留；最后一个表达式的值显示。→ `rewrite.test.ts`、`eval.test.ts`
- 死循环到时限被杀，结果写明重置，下一次调用照常；等嵌套审批的时间不计时。→ `eval.test.ts`
- 代码里调 `write`：`allow-writes` 下放行、`ask` 下问一次且事项带来源；拒绝时代码收到 `ToolCallError`，`nestedToolResult` 带参数；eval 的询问没有“本会话都批准”。→ nb-harness 测试、`eval.test.ts`
- 嵌套调用的写入来源是嵌套调用的条目；两种新事件不进请求、不进归约；`codeCallable: false` 的工具与收尾工具被拒；超过 2,000 次得 `invoke-limit`。→ nb-harness 测试、`eval.test.ts`
- `tool.<名>` 有 `returns` 时交回校验过的对象，没有时交回文字。→ `eval.test.ts`
- 回退到 eval 之前再调：内核重置并提示；分叉出的会话同样；超过 8 个内核时最久没用的被回收并提示。→ `eval.test.ts`
- 中途停止：子进程被杀，在途的嵌套调用收到中止。→ `eval.test.ts`
- 全局对象：只在绑定了它的方法时可用；同名两方都不进；文档里有生成的签名。→ 示例场景测试
- 界面：父调用失败时已写成的嵌套写入仍列在改动里；被拒的写入列出目标；跟帧与重建出的子调用相同；运行中副标题的次数与当前一步。→ 适配器契约测试、nb-agent-ui DOM 测试、Lab 场景与 e2e

## 验证

- 受影响的单测与类型检查（nb-harness、neuro-book、nb-agent-ui）。
- 真实子进程、真实服务端内核的合同测试；应用包里起得来内核（`pack-app.test.ts`）；e2e 的构建带内核入口。
- 界面切片：Lab 场景与覆盖它的 e2e。
- 真实模型 smoke（`test:llm`）。
- 未验证边界：Windows 上的子进程与 SIGKILL（只在 Linux 跑）；内存占用只记一次读数（空子进程约 34 MB，Opus 审查时实测）。

## 不做与风险

- 不做：代码里调模型与子代理（下一批）；Python；装依赖；插件的内核侧代码；自动转后台；富输出里的表格与 JSON 视图（只有文字与图片）；代码的语法高亮；“只在某些 Profile 里走代码”的绑定（w00036）。
- 没有沙箱：代码能直接读写文件、联网、起进程，审批是唯一的门（决定 3，与 `shell` 同档）。代码绕过 `tool.*` 直接写文件时，没有来源、分组，界面也看不到。
- 嵌套结果的全文不在日志里：界面的子行只有 2 KB 预览。
- 每个内核一个 Bun 进程（空的约 34 MB），由 8 个的总数上限与空闲回收兜住。
- 与审批简化提案改同一段内核代码，切片 2 排在它合入之后。

## 待确认

第 1 稿的三项已确认（README 决定 5）。第 2 稿没有新的待确认项；按审查改动里影响产品行为的几处（eval 的询问不能记住、嵌套结果只留预览、全局对象的方法收单个对象参数、切片 5 之前 eval 不进内置 Profile）列在 README 的审查表里，供开发者知悉。
