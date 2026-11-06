# t06 实施计划：权限规则与 Agent 模式

开发者 2026-11-06 确认方向（下面“开发者的决定”），实施前再做设计审查。来源：开发者 2026-11-06 重新对了 Agent 模式，并要求黑白名单做成类似 clash 的规则系统（[t28 README](../t28-conversation-ui-followups/README.md) 的“Agent 模式”）；原来排在 t28 批 6，范围变大后放回本 Task，推进顺序不变：t28 前五批之后接着做。调研：[`research/2026-11-06-agent-modes-survey.md`](../../research/2026-11-06-agent-modes-survey.md)。

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

内核的审批钩子已是所有调用的必经之处，内核不解析规则。`approveByMode` 换成：

1. 工具交出判定对象；
2. 按规则列表算出结果（放行、询问、拒绝或没命中）；
3. 结果是拒绝：拒绝；
4. 模式闸门：`discuss`、`plan` 下这次调用算写，就拒绝并告诉模型切换模式，配置成弹审批时改为询问；
5. 结果是放行、询问：照办；
6. 没命中：按审批模式。`yolo` 下询问也放行、拒绝照样拦（决定 6）。

闸门排在放行规则之前，也不受 `yolo` 影响：模式是用户选的“这会儿不改东西”，放行规则与全部放行回答的是“要不要问”。

### 判定对象

工具声明 `subjects(args)`，缺省没有。匹配器只看对象与参数，不认具体工具：

```ts
type Subject =
    | {kind: "command"; dialect: string; text: string}
    | {kind: "path"; access: "read" | "write"; address: string}
    | {kind: string; value: string}; // 主机等，工具自己定义
```

`shell` 交 `{kind: "command", dialect: "bash", text}`；`read`、`write`、`edit` 交路径；将来 `ssh` 交 `{kind: "host", value: "prod"}` 与 `{kind: "command", dialect: "powershell", text}`。

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
- `reason` 写进给模型的拒绝文字，让它知道怎样改。
- 匹配器类型放一张表，贡献点 `agent.permissionMatchers` 能加新的；存储形状用 TypeBox 校验，未知类型的规则不生效并写诊断。
- 顺序：从上到下第一条命中生效（clash）。列表拼接顺序：项目规则、用户规则、会话规则。项目规则来自作品目录，只接受询问与拒绝，放行规则不生效并写诊断（别人给的作品不能自带放行）。会话规则排在用户规则后面，“本会话都批准”不能盖过用户写的拒绝。

### shell 的匹配（方言）

方言放一张表，贡献点 `agent.commandDialects`，第一版只有 `bash`：

```ts
type Dialect = {id: string; parse(text: string): ParsedCommand | {opaque: true}; readOnly(command: SimpleCommand): boolean};
type SimpleCommand = {argv: string[]; redirects: {write: boolean; target: string}[]; hasExpansion: boolean};
```

- 拆成单条命令后逐条按第一条命中算，再合并：任一条拒绝就拒绝，任一条询问就询问，全部放行才放行，有没命中的就算没命中。`$(...)`、子 shell、循环体里的命令也拆出来，一起参加合并。
- 剥一组固定的包装（`timeout`、`time`、`nice`、`nohup`、`stdbuf`、`command`、`builtin`）与环境变量前缀；`bash -c '<字面量>'` 递归解析；绝对路径取文件名后匹配（`/bin/rm` 算 `rm`）。`xargs`、`find -exec`、`eval`、参数里有展开的命令名算看不懂。
- 看不懂的：放行规则不生效，询问与拒绝规则按文本照样匹配；没有方言的命令同样处理。写重定向的目标按 `path` 匹配（`/dev/null` 除外）。
- 只读清单在方言里，细到子命令与选项（`git log` 读、`git push` 不算；`find -delete`、`sed -i`、`git branch -D` 不算）。全部只读且没有写重定向时，`shell` 的 `effect` 是 `read`，内核现有的 `effectOf` 支持按参数算。清单能在设置里追加，不能删。
- Spec 写明：规则不是安全边界，只覆盖模型通常的写法（三家都这样）。

### “本会话都批准”

现在 `approvalRemembered{tool, scope: "tool"}` 记整个工具，批准一次 `shell` 就放开所有命令。改成带规则：`shell` 按命令前缀（`git diff *`），一次一条命令一条规则；不建议太宽的前缀（解释器、shell、`git`、`rm`、`sudo` 等，名单参照 Codex），这时只批准这一次。向导上写明要记住什么。另加“以后都允许”写进用户规则。这里要动内核的事件形状。

### Agent 模式

三种，会话级设置，回退不切回（决定 7），和审批模式是两个独立的维度：

- `normal`：不注入提示词。
- `discuss`：只讨论。读、只读 shell、写临时目录与会话目录放行；别的写被闸门挡住。
- `plan`：`discuss` 加写计划，计划写 `session://plan.md`（压缩时已经会放回，[`agent/compaction.md`](../../../../../docs/specs/agent/compaction.md) 输出 8）。

改判决定 2 的部分：写入不再弹审批，直接拒绝并提示切换模式，配置 `modeWriteAction: "deny" | "ask"` 可改成弹审批。

- **提示词**：放消息里，不进系统提示词，工具集不随模式变，缓存不受影响（Claude Code 文档的做法）。切换时一条完整提醒，之后每轮一句短的；回到 `normal` 时一句“已退出”。
- **切换**：用户走模式菜单、Shift+Tab、`/plan`、`/mode`，立刻生效。模型用 `switch_mode{mode}` 申请，走审批向导，用户批准才生效。
- **退出 `plan`**：模型 `switch_mode{mode: "normal"}` 时向导显示计划全文，选项：批准并开始（可同时选审批模式）、继续改（带附言）。不做清上下文：要时用户自己 `/compact`。
- **界面**：模式菜单分两组，组件已有两组的写法；非 `normal` 在状态栏标出。

## Spec 与文档改动

新 `agent/permissions.md`（规则、判定对象、方言、流水线）、新 `agent/modes.md`，注册表加行；`harness/runtime.md` 输出 39 改 `approvalRemembered`；`agent/contributions.md` 加两个贡献点；`agent/builtin-tools.md` 写工具的判定对象；`agent/conversation.md` 模式菜单与向导。t06 决定 2 记改判。

## 切片

1. 解析库对照，定选型；`bash` 方言：拆分、包装、只读清单（大表测试）。
2. 规则与匹配器、流水线，替换 `approveByMode`；`shell` 动态 `effect`。
3. 记住规则（内核事件形状、向导文字、“以后都允许”）。
4. 模式：设置、闸门、提醒、`switch_mode`、退出 `plan` 的向导、菜单、`/plan` `/mode`。
5. 规则的设置入口：第一版用 nb-form 编辑列表，设计另出静态稿。

## 验收映射

Spec 写好后补。

## 验证

真实内核加本机端点的合同测试：`image-gen` 关键词、复合命令各种组合、项目规则的放行不生效、会话规则不盖用户拒绝、`discuss` 下每一档工具、`yolo` 加 `plan`、未知方言。真实模型冒烟：`plan` 走完写计划、批准、开始。

## 审查

计划确认后 omp 设计审查，前端部分另派 Sonnet。实现审查 omp 一次、Sonnet 一次。

## 不做与风险

- 不做：操作系统沙箱；PowerShell 方言；模型自己免批准进 `plan`；规则集从远端订阅（clash 的 rule-providers）。
- 风险：只读清单写错会放过写操作，大表测试加 Spec 写明“不是安全边界”。第一条命中的列表写错顺序可能盖掉拒绝：规则设置页要标出永远不会命中的规则（以后做）。
