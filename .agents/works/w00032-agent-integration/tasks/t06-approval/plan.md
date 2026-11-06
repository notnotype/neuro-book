# t06 实施计划：权限规则与 Agent 模式

开发者 2026-11-06 确认方向（下面“开发者的决定”）；设计审查（omp 31 条、Sonnet 14 条）已处理，修订后的计划待开发者确认（文末“待确认”）。处理见 [evidences/design-review-disposition.md](evidences/design-review-disposition.md)。来源：开发者 2026-11-06 重新对了 Agent 模式，并要求黑白名单做成类似 clash 的规则系统（[t28 README](../t28-conversation-ui-followups/README.md) 的“Agent 模式”）；原来排在 t28 批 6，范围变大后放回本 Task，推进顺序不变：t28 前五批之后接着做。调研：[`research/2026-11-06-agent-modes-survey.md`](../../research/2026-11-06-agent-modes-survey.md)。

依据：本 Task 决定 1–8 与“规则与模式的关系”；[`harness/runtime.md`](../../../../../docs/specs/harness/runtime.md) 输出 39；改判决定 2（见“Agent 模式”）。

## 开发者的决定（2026-11-06，全部按推荐）

1. 规则从上到下，第一条命中生效（clash）。
2. 作品目录里的规则只接受询问与拒绝，放行不生效。
3. `discuss`、`plan` 下全部放行与放行规则都过不了模式闸门。
4. 模型进 `plan` 要用户批准。
5. 退出 `plan` 批准计划时可以同时选审批模式。
6. 这部分记在 t06，推进顺序不变：t28 前五批之后接着做。

此前同日的决定：`discuss`、`plan` 下写入直接拒绝并提示切换模式，可配置成弹审批；黑白名单做成规则系统（类似 clash），要能扩展（`ssh` 跑 PowerShell、`image-gen` 的关键词）。

## 技术选型

- shell 解析：`pi-natives` 的类型声明里没有解析接口，要另选库。候选 `unbash`（纯 TS、零依赖）与 `web-tree-sitter` 加 `tree-sitter-bash`（Codex 用 tree-sitter，要带 wasm）。第一片用约 30 条难样本（复合、管道、`$(...)`、重定向、here-doc、`bash -c`、环境变量前缀、未闭合引号）对照，能过就用 `unbash`，否则 tree-sitter。不手写解析器。否决 `shell-quote`（不懂语法结构）、`mvdan-sh`（GopherJS 产物、久未更新）。
- 不做操作系统沙箱：与 t12 决定一致。

## 关键设计

### 判定流水线（`plugins/agent/backend/permissions/`）

内核的审批钩子是所有调用的必经之处，内核不解析规则。`approveByMode` 换成下面的判定，结论来源分开记（`by`：规则、闸门、审批模式），不混成一个“询问”：

1. 算规则结果 R（放行、询问、拒绝、没命中，见“规则”）。
2. R 是拒绝：拒绝。
3. 模式闸门（只在 `discuss`、`plan`）：把这次调用分成三类（见“闸门怎样算写”）。“只读”往下走；“只写草稿”往下走，第 5 步按放行算；“写”：`modeWriteAction` 是 `deny` 时拒绝（码 `mode-blocked`，文字告诉模型切换模式）；是 `ask` 时询问，这个询问不被 R 的放行与 `yolo` 改变。
4. R 是放行：放行。R 是询问：询问，`yolo` 下放行（决定 6）。
5. 没命中，按审批模式：`effect` 是读放行；`ask` 询问；`allow-writes` 写放行、执行询问；`auto` 问审批模型（切片 6）；`yolo` 放行。

结果表（规则 × 闸门 × `yolo`）写进 Spec，测试逐格对照。

### 模式放在哪里

新扩展 `nbook.agent.modes` 拥有模式：设置 `{mode}`（`settingsChanged` 只在会话层，回退不切回，`fork` 带上，重启恢复，都是现有语义）；导出 `{mode}`，钩子用 `ApprovalCtx.read` 读（该接口的注释写的就是这个用途）；提醒也在这里。内核不认识模式。主 Profile 装它；没装的 Profile 没有模式，界面不显示。

内核改一处：`judgingSettings` 把扩展设置也算进去。放行之后、开始执行之前模式变了，按现在的模式重判（`tools.ts` 的 `stillHolds` 已有这条路）。这同时解决“同一回复里先切模式再写”和“等审批时别的窗口切了模式”。已开始的调用不追溯。

内核的 `readOnly` 不动：它在内核里直接拦，和模式无关；界面现在没有入口。

### 闸门怎样算写

- `effect` 是读：只读。
- 判定对象里有写路径，且全部落在当前会话目录（`session://`）或临时目录（`tmp://`），命令也都只读：只写草稿。`plan.md` 也在会话目录，`discuss` 写它不拦，`plan` 与 `discuss` 只差提示词。
- 其余都算写，包括没有判定对象的写工具、算不出的命令。

### 判定对象

工具实现声明 `subjects(args)`，缺省没有。匹配器只看对象与参数，不认具体工具：

```ts
type Subject =
    | {kind: "command"; dialect: string; text: string}
    | {kind: "path"; access: "read" | "write"; address: string}
    | {kind: string; value: string}; // 主机等，工具自己定义
```

- `shell` 交 `{kind: "command", dialect: "bash", text}` 与写重定向的路径；`read`、`write`、`edit` 交路径；将来 `ssh` 交 `{kind: "host", value: "prod"}` 与 `{kind: "command", dialect: "powershell", text}`。
- `address` 是 `SessionResources.expand` 展开后的全局地址，规则里的 glob 也先展开（写 `project://a/*` 与全局地址等价）。不跟随符号链接，区分大小写。展开失败算“算不出来”。重定向与文件工具走同一个展开。
- 工具提供方还没激活时：规则里有需要判定对象的匹配器命中这个工具，才先激活（`implementation` 本来就在第一次执行时做）；激活失败算“算不出来”。只看工具名与 `arg` 的规则不触发激活。

### 规则

```ts
type Rule = {tool: string; when?: Matcher; action: "allow" | "ask" | "deny"; reason?: string};
type Matcher =
    | {all: Matcher[]} | {any: Matcher[]} | {not: Matcher}
    | {type: "arg"; path: string; op: "eq" | "glob" | "regex" | "contains" | "keywords"; value: string | string[]}
    | {type: "path"; glob: string; access?: "read" | "write"}
    | {type: "command"; pattern: string}   // "git push *"
    | {type: "subject"; kind: string; glob: string};
```

- `tool` 是工具 id 的通配，MCP 与第三方工具同样能写。`image-gen` 的关键词：`{tool: "*.image-gen", when: {type: "arg", path: "prompt", op: "keywords", value: [...]}, action: "deny"}`，不用写代码。
- `reason` 由写规则的人写给模型看，写进拒绝文字；没写时不带命中条件。
- **三层**，每层内部从上到下第一条命中（决定 1），再合并：任一层拒绝就拒绝；否则会话层放行优先（用户刚点的“本会话都批准”）；否则任一层询问就询问；否则用户层放行；否则没命中。这样项目的询问盖不住用户的拒绝，用户的询问也不会让“本会话都批准”失效。
- **来源**：用户规则是设置 `nbook.agent/permissionRules`（`layers: ["user"]`）；项目规则是独立文件 `project://.nbook/permissions.json`（TypeBox 校验，不放进 `settings.json`：配置层是覆盖，这里要两层都读），只接受询问与拒绝，放行不生效并写诊断；每次判定读，改了下一次就生效。会话没有作品就没有这一层。不复用 `AGENTS.md`：那是给模型看的自然语言。
- **内置规则**：写 `project://.nbook/**` 与用户设置文件永远询问，不能写规则放开，免得模型在放行写入下改掉自己的规则。
- **算不出来时**（匹配器类型未知、抛错、判定对象取不到、项目规则文件解析失败）：拒绝与询问规则算命中，放行规则不算，写诊断。解析失败的项目规则文件按一条询问全部写与执行算。

### shell 的匹配（方言）

方言放一张表，第一版只有 `bash`：

```ts
type Dialect = {id: string; parse(text: string): ParsedCommand | {opaque: true}; readOnly(command: SimpleCommand): boolean};
type SimpleCommand = {argv: string[]; redirects: {write: boolean; target: string}[]; hasExpansion: boolean};
```

- 拆成单条命令后逐条按第一条命中算，再合并：任一条拒绝就拒绝，任一条询问就询问，全部放行才放行，有没命中的就算没命中。`$(...)`、子 shell、循环体里的命令也拆出来，一起参加合并。解析要么完整，要么 `opaque`，不交半棵树；`parse` 抛错算 `opaque`。
- 反复剥包装（`timeout`、`time`、`nice`、`nohup`、`stdbuf`、`command`、`builtin`）与环境变量前缀，直到不是包装；包装的选项认不出就算看不懂。`bash -c '<字面量>'` 递归解析；绝对路径取文件名后匹配（`/bin/rm` 算 `rm`）。`xargs`、`find -exec`、`eval`、参数里有展开的命令名算看不懂。
- `command` 的 `pattern` 按 argv 词匹配，不按文本：`git push *` 是前两个词相等，末尾的 `*` 表示后面可有可无，词内可用 glob。匹配对象是剥完包装的 argv，引号已去掉。`git -c x=y push` 不命中（写进 Spec 的例子，属于“不是安全边界”）。
- 看不懂的：放行规则不生效，询问与拒绝规则按整段文本 glob 照样匹配。`discuss`、`plan` 下算写；`ask`、`allow-writes` 下询问；`yolo` 下放行：全部放行是用户选的（决定 6）。写重定向的目标按 `path` 匹配（`/dev/null` 除外）。
- 只读清单在方言里，白名单到子命令与选项（`git log` 读、`git push` 不算；`find -delete`、`sed -i`、`git branch -D` 不算；能启动子程序的选项如 `git -c`、`--ext-diff`、`--output` 不算），清单外一律不算只读（`cp`、`mv`、`mkdir` 都不在内）。全部只读且没有写重定向时，`shell` 的 `effect` 是 `read`。清单能在设置里追加，不能删。
- Spec 写明：规则不是安全边界，只覆盖模型通常的写法（三家都这样）。

### “本会话都批准”

现状：`approvalRemembered{tool, scope:"tool"}` 写进日志、传给钩子，但 `approveByMode` 没看（从代码推断：现在点了下一次还问）。切片 2 先接上。

改成带规则：

- 钩子的 `ask` 结论带 `remember?: JsonValue`（后端算好的规则，内核不解释），进 `interactionRequested` 的请求，界面点之前就看得到。`shell` 按命令前缀（`git diff *`），复合命令一条命令一条规则。太宽的前缀（解释器、shell、`git`、`rm`、`sudo` 等，名单参照 Codex）与看不懂的命令没有 `remember`，向导不给这个按钮。别的工具仍记整个工具，向导写明。
- `resolve` 的 `allow-session` 把 `remember` 写进 `approvalRemembered`（新增可选字段 `rule`，事件字段只加不改）。旧事件没有 `rule`，还是整个工具。`ApprovalInfo.remembered` 换成规则列表。`fork` 不复制（现有语义），写进 Spec。
- 向导的联动：同批里被同一条规则覆盖的才一起选中。
- “以后都允许”写进用户规则，和规则设置入口同批（切片 5）：先有地方看、能撤销。

### Agent 模式

三种，会话级设置，回退不切回（决定 7），和审批模式是两个独立的维度：

- `normal`：不注入提示词。
- `discuss`：只讨论。读、只读 shell、写临时目录与会话目录放行；别的写被闸门挡住。
- `plan`：`discuss` 加写计划，计划写 `session://plan.md`（压缩时已经会放回，[`agent/compaction.md`](../../../../../docs/specs/agent/compaction.md) 输出 8）。

改判决定 2 的部分：写入不再弹审批，直接拒绝并提示切换模式；`modeWriteAction: "deny" | "ask"` 可改成弹审批，是用户设置（`layers: ["user"]`），每次判定读。

- **提示词**：用现有的 `reminder()`（`watch` 模式，`every: 1`）：放在这一轮开头的消息里，不进系统提示词，工具集不随模式变。值变了那轮一条完整提醒，之后每轮一句短的，回到 `normal` 时一句“已退出”、之后不写。缓存的承诺写成可观察的：同模式连续多轮前缀不变，切换只影响新写的这条之后。压缩、回退后再提醒一次是 helper 现有的行为。
- **用户切换**：模式控件、Shift+Tab、`/plan`、`/mode`，走 `changeSettings`，立刻生效。还没有会话时存在宿主里，建会话后、第一次发送前提交，能先开 `plan` 再发第一条。
- **模型切换**：工具 `switch_mode{mode}`（现有渲染器读 `targetMode`，改成 `mode`）。它不走审批：`effect` 是 `read`，闸门、规则的放行和 `yolo` 都碰不到它；实现里用 `ToolContext.ask` 问用户，请求带 `{kind: "mode-switch", from, to, plan?}`，向导按这个画专门的视图。所以任何审批模式下都要用户答（决定 4），也不会被自己的闸门拦。写了 `deny` 规则还能禁掉。后台会话没人答，失败。目标已是当前模式：直接返回，不问。
- **退出 `plan`**：工具在执行时读 `session://plan.md`，把正文放进请求，这时同一回复里先写的计划已落盘。没有计划或超过 256 KB：工具失败并告诉模型，不问用户。向导选项：批准并开始（可同时选审批模式）、继续改（带附言）。批准用一次 `changeSettings` 同时改模式与审批模式；工具结果带上批准的计划正文和“开始实现”，模型下一次请求就看到，用户看到的和模型拿到的是同一份。继续改：结果是附言，模式不变。不做清上下文：要时用户自己 `/compact`。
- **界面**：见“界面”。

### 界面

静态稿另出，定了再写：模式控件的形态（见文末第 3 问）、退出 `plan` 向导的版式（长计划占满向导、批准控件固定在下面）、状态栏标记、规则设置页。行为先定下面这些：

- `mode-blocked` 单独的文字（“计划模式下不能修改文件”），不落到“已被规则拒绝”。不做卡片上的一键切换：闸门拒绝时没有向导，输入框上的模式控件就在。规则拒绝显示 `reason`。
- Shift+Tab：补全菜单开着时不切模式；没有监听者的编辑器（就地编辑）不吞这个键；切换后 `aria-live` 播报。
- `/plan`：切到 `plan`，已在 `plan` 不动；带文字时切完把文字发出去。`/mode <名>`：只管 Agent 模式，接 key 与显示名，不接审批模式；没参数切下一种；名字不对提示可选项。
- 规则设置页第一版：列表按来源分区，项目区只读；一条规则是 `tool` + 一个叶子匹配器 + `action` + `reason`，nb-form 能结构化；嵌套的 `when` 用 JSON 字段兜底。

## Spec 与文档改动

新 `agent/permissions.md`（规则、判定对象、方言、流水线与结果表）、新 `agent/modes.md`，注册表加行；`harness/runtime.md` 输出 39 改 `approvalRemembered` 与 `judgingSettings`；`agent/builtin-tools.md` 写工具的判定对象与 `switch_mode`；`agent/conversation.md` 与 `ui/agent-conversation-view.md` 模式控件（Spec 现在写“点开菜单分两组”，和实现不符，按第 3 问改）与向导。t06 决定 2 记改判，决定 3 的“没声明按执行”删掉（`effect` 是必填）。

## 切片

1. 解析库对照，定选型；`bash` 方言：拆分、包装、只读清单（大表测试）。
2. 规则与匹配器、流水线，替换 `approveByMode`（接上 `remembered`）；`shell` 动态 `effect`；项目规则文件。
3. 记住规则（内核事件字段、向导文字与联动）。
4. 模式：扩展、闸门、`judgingSettings`、提醒、`switch_mode`、退出 `plan` 的向导、控件、`/plan` `/mode`、新会话先选模式。静态稿先给开发者看。
5. 规则设置入口与“以后都允许”：静态稿先给开发者看。
6. `auto`：规则没命中时问审批模型。提示词只含工具、参数、判定对象；答放行才放行；答拒绝、输出不合法、超时、模型失败都转问用户，不放行；请求记进日志与用量。

## 验收映射

写 Spec 时按编号补，先列要覆盖的决策矩阵，都用真实内核加本机端点，指定模型一次回复里的工具调用：

- 流水线：规则（拒绝、询问、放行、没命中）× 闸门（三类，`deny`、`ask`）× 审批模式（四种）。
- 三层合并：项目询问 + 用户拒绝；用户询问 + 本会话批准；用户拒绝 + 本会话批准；项目放行不生效；项目文件坏了。
- 算不出来：未知匹配器的拒绝、询问、放行规则；工具未激活；激活失败；`parse` 抛错。
- 时序：同一回复切模式加写（两种顺序，切入与切出）；等审批时切模式；模式变了只重判放行过的。
- 记忆：旧 `approvalRemembered` 回放；`fork` 不继承；太宽的前缀没有按钮。
- `switch_mode`：`yolo` 下仍要问；批准同时改审批模式；同回复先写计划再切；没有计划；后台会话；重启后重新问。
- 模式：回退不切回，`fork` 带上，提醒的次数与位置，连续多轮请求前缀不变。
- `auto`：放行、拒绝、不合法、失败。

界面行为用组件测试与 e2e：向导变体、Shift+Tab、新会话先选模式、`/plan`、`/mode`。

## 验证

上面的合同测试；shell 判定用真实解析库跑大表。真实模型冒烟：`plan` 走完写计划、批准、开始；`auto` 判一次放行、一次转人工。

## 审查

实现审查 omp 一次、Sonnet 一次。

## 不做与风险

- 不做：操作系统沙箱；PowerShell 方言；模型自己免批准进 `plan`；规则集从远端订阅（clash 的 rule-providers）；批准版本的哈希校验（工具结果带的就是向导里那份）；把规则拒绝的理由分成给模型和给用户两份。
- 风险：只读清单写错会放过写操作，大表测试加 Spec 写明“不是安全边界”。第一条命中的列表写错顺序可能盖掉拒绝：规则设置页要标出永远不会命中的规则（以后做）。

## 待确认

1. **三层怎样合并**：决定 1 的“第一条命中”只在一层内成立，跨层按上面“规则”一节的优先级。推荐这样：纯粹拼成一条列表的话，项目的询问会盖住用户的拒绝。
2. **贡献点**：`agent.permissionMatchers`、`agent.commandDialects` 这次开不开给插件？推荐先不开，匹配器与方言是代码里的表，形状就是将来贡献点的形状，第一个真实消费者（`ssh`）来时再开；工具的 `subjects` 与规则现在就对第三方可用，`image-gen` 关键词、MCP 工具不用贡献点。少掉 SDK 接入与撤回语义。
3. **模式控件**：现在是两个独立控件（Agent 模式点一下切下一种、审批模式下拉），Spec 写的是一个菜单分两组，`DropdownMenu` 不支持组标题。推荐保持两个控件，两个状态都一直看得见，改 Spec。
4. **`auto` 放进 t06**：开发者 2026-11-06 同意，放最后一片（切片 6）。
