---
schema: nbook.spec/v1
kind: behavior
status: implemented
capability: agent.permissions
owners:
  - packages/neuro-book/src/plugins/agent/backend/permissions
---

# Agent 的权限规则

## 目标与非目标

用户按工具、参数、路径、命令写放行、询问、拒绝的规则，规则先于审批模式生效；`discuss`、`plan` 模式的闸门也在这里判定。工具与命令语言都不写死：规则只看工具 id、参数与工具交出的判定对象，所以第三方工具、将来跑 PowerShell 的 `ssh` 工具、`image-gen` 的提示词关键词都能写规则。

不承诺：

- **规则不是安全边界**：它覆盖模型通常的写法，不防刻意绕过。例如 `git push *` 不命中 `git -c x=y push`。要隔离用操作系统沙箱，本能力不做。
- 第一版不开放贡献点：匹配器类型与方言是代码里的表，第三方插件不能新增。

## 术语与参与者

- **规则**：一条 `{tool, when?, action, reason?}`。
- **层**：规则的来源，用户层、项目层、会话层。
- **判定对象**：工具从参数算出的、规则要看的东西（路径、命令、主机）。
- **方言**：把一种命令语言拆成单条命令并判断只读的解析器。
- **看不懂**：方言不能完整解析的命令。
- 审批模式见 [`harness/runtime.md`](../harness/runtime.md) 输出 39；Agent 模式见 [`agent/modes.md`](modes.md)。

## 输入与前置条件

```ts
type Rule = {tool: string; when?: Matcher; action: "allow" | "ask" | "deny"; reason?: string};
type Matcher =
    | {all: Matcher[]} | {any: Matcher[]} | {not: Matcher}
    | {type: "arg"; path: string; op: "eq" | "glob" | "regex" | "contains" | "keywords"; value: string | string[]}
    | {type: "path"; glob: string; access?: "read" | "write"}
    | {type: "command"; pattern: string}
    | {type: "subject"; kind: string; glob: string};

type Subject =
    | {kind: "command"; dialect: string; text: string}
    | {kind: "path"; access: "read" | "write"; address: string}
    | {kind: string; value: string};
```

| 层 | 来源 | 可写的动作 |
|---|---|---|
| 用户层 | 设置 `nbook.agent/permissionRules`（只在用户层） | 放行、询问、拒绝 |
| 项目层 | `project://.nbook/permissions.json`，内容是规则数组 | 询问、拒绝 |
| 会话层 | “本会话都批准”（[`harness/runtime.md`](../harness/runtime.md) 输出 39 的 `approvalRemembered`） | 放行 |

工具实现声明 `subjects(args)`，缺省没有。内置工具交出的对象见 [`agent/builtin-tools.md`](builtin-tools.md)。

## 输出与可观察行为

### 判定

1. 每次工具调用按下面的顺序判定，取第一个成立的：
   1. 规则结果是拒绝：拒绝。
   2. 模式闸门（[`agent/modes.md`](modes.md)）判定这次调用算写：按 `modeWriteAction` 拒绝或询问。这个询问不被放行规则与 `yolo` 改变。
   3. 规则结果是放行：放行。
   4. 规则结果是询问：询问；`yolo` 下放行。
   5. 闸门判定只写草稿：放行。
   6. 按审批模式：`effect` 是读放行；`ask` 询问；`allow-writes` 写放行、执行询问；`auto` 见输出 19；`yolo` 放行。
2. 规则结果按层算：每层内从上到下第一条命中；再合并，取第一个成立的：任一层拒绝；会话层放行；任一层询问；用户层放行；没命中。
3. `tool` 是工具 id 或给模型的名字的通配（`*` 匹配任意字符），`shell` 与 `nbook.agent.shell` 都算；第三方与 MCP 工具同样写。
4. `reason` 写进给模型的拒绝文字；没写时拒绝文字不带命中的条件。
5. 算不出来时（匹配器类型未知、抛错、判定对象取不到、工具提供方激活失败），拒绝与询问规则算命中，放行规则不算，写诊断 `permission-rule-unevaluable`。
6. 项目规则文件由宿主直接读（`.nbook/` 不经 Agent 的文件权限）。不存在时项目层为空；解析或校验不过时写诊断 `permission-rules-invalid`，这一层对写与执行的调用按询问算，读不受影响。项目层的放行规则不生效，写诊断 `permission-allow-ignored`。规则每次判定时读，改了下一次就生效。
7. 地址分类为“写入要询问”的（`user://`，[`agent/resources.md`](resources.md)）：规则结果不是拒绝时一律按询问算，放行规则、会话层与放行写入都不免，`yolo` 下放行。免得模型在放行写入下改掉用户设置里的规则。项目的 `.nbook/` 是控制目录，Agent 的文件工具本来就碰不到。

### 判定对象与匹配

8. `path` 对象的 `address` 是展开后的全局地址，规则里带方案的 `glob` 也先展开，所以 `project://a/*` 与全局写法等价；不带方案的（`**/.env`）原样比对。写重定向的相对路径从工作目录算，磁盘路径原样比对。区分大小写，不跟随符号链接。展开失败算“算不出来”。
9. 规则需要判定对象（`path`、`command`、`subject` 匹配器）而工具提供方还没激活时，先激活再判定；只看工具名与 `arg` 的规则不触发激活。
10. `arg` 的 `path` 是点分路径。`keywords` 是任一关键词出现，不分大小写；`regex` 是 ECMAScript 语法，写错算“算不出来”。

### 命令与方言

11. `command` 的 `pattern` 按词比对，不按文本：`git push *` 是前两个词相等，末尾的 `*` 表示后面可有可无；词内可用 `*` 通配。比对的是剥完包装、去掉引号的词。

    | 命令 | `git push *` |
    |---|---|
    | `git push`、`git push origin main`、`git 'push' origin` | 命中 |
    | `timeout 5 git push`、`bash -c 'git push'`、`a && git push` | 命中 |
    | `git -c x=y push` | 不命中 |

12. 一段命令拆成单条命令，包括 `$(...)`、反引号、进程替换、子 shell、循环与条件体、函数体、会展开的 here-doc 里的。逐条按第一条命中算，再合并：任一条拒绝就拒绝；任一条询问就询问；全部放行才放行；否则没命中。只读的条没命中不算数：`cd a && touch b` 只要放行 `touch`。
13. 反复剥包装（`timeout`、`time`、`nice`、`nohup`、`stdbuf`、`command`、`builtin`、`exec`、`env`）与环境变量前缀；选项认不出算看不懂。`bash -c '<字面量>'`（`sh`、`dash`、`zsh` 同）递归解析，最多 8 层。系统目录（`/bin`、`/sbin`、`/usr/bin`、`/usr/sbin`、`/usr/local/bin`、`/usr/local/sbin`）下的程序取文件名，别处的不取。
14. 看不懂的：语法错误、命令名有展开、`eval`、`xargs`、`source`、`.`、`parallel`、`find -exec` 这类、`bash -c` 的脚本不是字面量、从标准输入读脚本。这时放行规则不生效，询问与拒绝规则按整段文本包含比对（`git push *` 命中 `eval git push`）；闸门算写；`ask`、`allow-writes` 下询问；`yolo` 下放行。没有方言的命令同样处理。
15. 写重定向的目标作为 `path` 对象参加匹配（`/dev/null`、`/dev/stdout`、`/dev/stderr` 与文件描述符复制除外）。目标有展开时算“算不出来”。只看命令的放行规则不放行有写重定向的命令（`echo *` 不放行 `echo a > f`），要写路径规则。
16. 只读是白名单，到子命令与选项，清单外的都不算：`git log` 算，`git push`、`git branch -D`、`git -c x log`、`git log --output=f`、`find -delete`、`sed -i`、`sort -o`、`cp`、`mkdir` 不算。环境变量（前缀、`env`、外层 `bash -c` 上的）除语言、时区、颜色、终端尺寸类之外不算只读。要看选项才知道读写的命令（`find`、`sed`、`sort`、`git` 这类）参数有展开时不算只读；`sed` 脚本也是白名单，只认 `p`、`d`、`q`、`n`、`=` 与标志只有 `gpiIm` 和数字的替换。设置 `nbook.agent/readOnlyCommands` 能按词前缀追加（`npm ls`），不能删。
17. 一段命令全部只读且没有写重定向时，`shell` 的 `effect` 是 `read`；否则是 `exec`。

### 记住

18. “本会话都批准”记的是规则：审批请求带 `remember`（要记住的规则，界面点之前就显示）。`shell` 按命令前缀记（`git diff *`），前缀到子命令（`git`、`npm` 这类）或命令名（`touch *`），复合命令里要问的每条一条；太宽的前缀（解释器、shell、`rm`、`sudo` 等，没有子命令的 `git`）、看不懂的命令、有写重定向的命令不能记（`remember: false`），这时没有这个选项，应答 `allow-session` 得 `invalid-answer`。别的工具记整个工具。不跨 `fork`。旧日志里没有规则的 `approvalRemembered` 按整个工具算。

### 审批模型

19. `auto`（判定第 6 步）：读放行；写工具的写路径全部落在作品与会话草稿里时放行，同放行写入；其余问审批模型（`purpose: "approval"`，走 `fast` 角色，没绑时用对话模型）。排在这一步之前的规则、闸门与“写入要询问”的地址，模型改变不了。
20. 审批模型只看：用户亲手打的字、之前的工具调用（工具与参数）、这次调用（工具、等级、参数、判定对象）。不看助手文字、工具结果与附件内容，所以 Agent 说服不了它，文件或网页里的指令也传不到它。这次调用超过长度上限时不问模型，转问用户：不能拿截断的内容判定。
21. 模型必须调用判定工具一次，答放行或转人工并附一句理由。答放行才放行，`by` 是 `mode:auto`；答转人工时询问用户，向导显示它的理由。不合法、超时（30 秒）、模型失败或没有可用模型都询问用户，写诊断 `permission-auto-failed`，向导写明这次没有判定。请求进日志与用量。`auto` 不是安全边界：模型会漏判。

### 设置入口

22. 设置窗口 AI 分类有“权限规则”页：
    - “我的规则”（用户层）可增删改、上移下移；表单写得了单个条件，嵌套条件用 JSON；手写在设置文件里的规则照样显示。
    - 绑定作品时列出这本书的规则，只读；放行规则标明不生效，文件坏了写明后果。
    - 同页改 `readOnlyCommands`、`modeWriteAction`；这三项不再出现在“其它”。
23. 审批向导的“以后都允许”：写进“我的规则”末尾，不盖过已有的拒绝，同时按“本会话都批准”应答，当场生效。记的内容同输出 18；不能记时（`remember: false`）没有这个选项。已有同样的规则时不重复写。写入失败时这次与本会话仍然批准，界面提示没有存下。

## 状态与转换

规则没有状态：每次判定读当前的用户设置与项目文件，会话层来自日志。

时序与寿命：

- 判定之后、开始执行之前，规则变了不重判；Agent 模式、审批模式变了时放行过的调用重判（[`harness/runtime.md`](../harness/runtime.md) 输出 79）。已开始的调用不追溯。
- 会话层规则回退与重开都不撤销，`fork` 不带。

## 副作用与数据

- 用户规则：`<状态根>/settings.json`。项目规则：`<项目目录>/.nbook/permissions.json`，可以进 Git。
- 诊断：`permission-rule-unevaluable`、`permission-rules-invalid`、`permission-allow-ignored`、`permission-auto-failed`。

## 失败与恢复

| 码 | 含义 | 调用方怎么办 |
|---|---|---|
| `rule-denied` | 规则拒绝了这次调用，文字带 `reason` | 模型换个做法 |
| `mode-blocked` | 模式闸门拒绝（[`agent/modes.md`](modes.md)） | 模型申请切换模式或换个做法 |

## 边界与兼容

项目规则文件来自作品，可能是别人写的：放行不生效，询问与拒绝只影响使用这个作品的会话。规则与判定对象的形状是对第三方工具的公开合同。

## 验收与 Smoke

1. 用户层 `git push *` 拒绝，项目层 `git *` 询问：拒绝。
2. 用户层 `shell` 询问，会话里对 `git diff *` 本会话都批准：`git diff` 放行，`git status` 询问。
3. 用户层拒绝加本会话批准：拒绝。
4. `yolo` 下：没命中放行、询问规则放行、拒绝规则拒绝、看不懂的放行。
5. 未知匹配器的拒绝规则命中，放行规则不命中，都写诊断。
6. `image-gen` 提示词关键词的拒绝规则不用写代码。
7. `auto`：读与作品内写放行；执行类调用交审批模型，答放行才放行，答转人工、输出不合法、超时、模型失败都转问用户；规则的放行、询问与拒绝先于模型；`user://` 的写模型放行不了；模型看不到助手文字与工具结果。
8. “以后都允许”：写进用户规则末尾，当场生效；一批里两条同时选，两条都存下；存不下时这次与本会话仍批准。
9. 设置页：增删改、上移下移、连点不丢；这本书的规则只读，坏了或读不到都写明；手写的规则来回不变。

Smoke：`packages/neuro-book/src/plugins/agent/permissions.llm.test.ts`（`test:llm`，真实模型：`auto` 放行一次、转人工一次；`plan` 走完）。

## 实现合同

- **公开入口**：设置 `nbook.agent/permissionRules`、`readOnlyCommands`、`modeWriteAction`；项目文件 `.nbook/permissions.json`；规则形状 `RuleSchema`（`nbook/plugins/agent/shared/permissions`）；工具交出判定对象的 `AgentToolImplementation.subjects`（`shared/points`）；远程方法 `projectPermissionRules`（`nbook.agent/sessions`）。判定本身没有公开接口：内核只认 `ApproveHook`，`nbook.agent` 在创建运行时把钩子接上。
- **owner 与依赖方向**：`backend/permissions` 拥有判定；依赖 `nbook.files`（展开地址、读项目根）、`unbash`（`bash` 解析）与内核的 `ApprovalCtx`（`read`、`model`）；内核不认识规则。设置页在 `web/permission-page.ts`，只经配置服务写用户层。
- **关键不变量**：
  - 判定顺序固定且是纯函数：规则拒绝、闸门、放行、询问、只写草稿、审批模式（`rules.test.ts`“判定顺序”）。
  - 算不出来时偏向收紧：拒绝与询问算命中，放行不算，不生效的放行不挡后面的拒绝（`rules.test.ts`“一层的结果”）。
  - 只读是白名单到子命令、选项与展开：`sed` 脚本、`env` 变量、带展开的参数都不放过（`bash-dialect.test.ts`“只读清单”）。
  - `auto` 的模型只看用户亲手打的字与工具调用，输出靠强制调用判定工具，不是恰好一次合法调用就转问用户（`auto-review.test.ts`）。
  - 用户规则的写入排成一个队、每次带比较，同一拍的两次追加都落盘（`web/permission-page.dom.test.ts`“规则写入”）。

## 证据

- 批准依据：开发者 2026-11-06（[t06 计划](../../../.agents/works/w00032-agent-integration/tasks/t06-approval/plan.md) 的“开发者的决定”与“确认结果”）；开发者 2026-11-07 批准晋升为 `implemented`。
- 实现入口：[`backend/permissions/hook.ts`](../../../packages/neuro-book/src/plugins/agent/backend/permissions/hook.ts)、[`judge.ts`](../../../packages/neuro-book/src/plugins/agent/backend/permissions/judge.ts)、[`rules.ts`](../../../packages/neuro-book/src/plugins/agent/backend/permissions/rules.ts)、[`bash-dialect.ts`](../../../packages/neuro-book/src/plugins/agent/backend/permissions/bash-dialect.ts)、[`auto-review.ts`](../../../packages/neuro-book/src/plugins/agent/backend/permissions/auto-review.ts)、[`project-rules.ts`](../../../packages/neuro-book/src/plugins/agent/backend/permissions/project-rules.ts)
- 合同测试：[`permissions.test.ts`](../../../packages/neuro-book/src/plugins/agent/permissions.test.ts)（真实内核、真实 `shell`、本机端点）、[`auto-review.test.ts`](../../../packages/neuro-book/src/plugins/agent/auto-review.test.ts)、[`rules.test.ts`](../../../packages/neuro-book/src/plugins/agent/backend/permissions/rules.test.ts)、[`bash-dialect.test.ts`](../../../packages/neuro-book/src/plugins/agent/backend/permissions/bash-dialect.test.ts)、[`builtin-tools-project.test.ts`](../../../packages/neuro-book/src/plugins/agent/builtin-tools-project.test.ts)、[`permission-page.dom.test.ts`](../../../packages/neuro-book/src/plugins/agent/web/permission-page.dom.test.ts)
- Smoke：[`permissions.llm.test.ts`](../../../packages/neuro-book/src/plugins/agent/permissions.llm.test.ts)（`test:llm`，真实模型）
