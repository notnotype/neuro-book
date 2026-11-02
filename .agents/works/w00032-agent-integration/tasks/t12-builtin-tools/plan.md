# t12 实施计划：基础工具（read、write、edit、grep、glob、shell）

第一稿（2026-11-02，开发者看过）：`grep`、`glob` 第一版不在虚拟根上跑。

## Context

Agent 插件（t10）有了工具贡献点，资源地址（t08）有了会话的资源视图，但还没有任何内置工具：Profile 里写不出能读写书、搜文件、跑命令的 Agent。本 Task 交第一批六个工具。

依据：本 Task README 的“决定”（2026-10-28）、“补充决定”与“开工前对齐”（2026-11-02，共 11 条）；[`agent/resources.md`](../../../../../docs/specs/agent/resources.md)（工具经 `services.resources` 读写）；[`agent/contributions.md`](../../../../../docs/specs/agent/contributions.md)（`agent.tools` 的声明与工厂）；[`harness/models.md`](../../../../../docs/specs/harness/models.md)（工具 id 与交给服务商的名字）；[`harness/runtime.md`](../../../../../docs/specs/harness/runtime.md)（工具执行与结果）。

开发者已确认、不再议：

1. 第一批：`read`（能读图片，照 omp）、`write`（自动建上级目录）、`edit`（hashline 与 replace 两种模式）、`grep`、`glob`、`shell`。`todo` 搁置（暂定照 omp 的 `op` 形状与结果），`ask`、`switch_mode` 归 t06。
2. `read`、`edit` 用 code agent 的默认做法，不针对长篇中文正文专门设计。
3. t12 只交工具：按地址分类决定要不要审批、`shell` 只读白名单怎样参与审批，都不在本 Task。工具声明自己的等级（读、写、执行）。
4. `shell`：`pi-natives` 内嵌的 brush shell，只在前台；超时缺省 300 秒、可设 1 到 3600 秒；工作目录有主项目时 `project://`、没有时 `session://`；输出过长截断、全文进 `session://artifacts/`；命令里能对应真实目录的地址换成绝对路径，虚拟地址报错；提供 `$NBOOK_PROJECT`、`$NBOOK_SESSION`；原样继承服务端的环境变量；安全上的洞第一版不补。
5. 工具说明用中文，失败在 `details` 给 `code`；`pi-natives` 原生 edit 的英文错误原样交回（ADR 0034）。
6. 不改 nb-agent-ui 的内置工具渲染器。

工作方式：代码在 Work worktree `.worktree/w00032-agent-integration`；Spec 与 Task 记录在主工作区。内核改动（图片）交 omp 审；工具实现交 omp 审。

## 技术选型

| 问题 | 选用 | 理由 / 否决 |
|---|---|---|
| 行锚编辑（hashline、replace） | `pi-natives` 的 `EditSession`、`EditStore`、`editDescription`、`editGrammar`（仓库已依赖，旧 harness 在用） | 与 omp 同一引擎，模型熟；不手写 |
| 读文件的行号与头 | `pi-natives` 的 `hashlineFormatHeader`、`hashlineFormatNumberedLines` | 与 `EditSession` 认的格式一致；旧 harness 自己拼的 `N: ` 前缀不用 |
| 内容搜索、文件匹配 | `pi-natives` 的 `grep`、`glob` | 已定；不调外部 `rg` |
| shell | `pi-natives` 的 `executeShell`（brush） | 已定；本机实测可用（Linux）；`ShellFilesystem` 把 `scheme://` 路径交给宿主的做法（omp）要实现几十种文件操作，第一版不用，改为执行前替换地址 |
| 图片缩放 | Bun 自带的 `Bun.Image`（Bun 1.4.4 已有，omp 同用） | 不引 `sharp` 一类依赖 |

## 关键设计

### 内核：工具结果带图片（`packages/nb-harness/src/kernel/`）

- `ToolResult` 加 `images?: readonly {data: string /* base64 */, mime: string, width?: number, height?: number}[]`；`toolResult` 事件的数据同样带上。会话日志对超过 16 KB 的字符串自动转进 `blobs/`（现有机制），不另做图片存储。
- `ContentBlock` 的 `image` 改为带 `data`（base64）而不是 `blob` 哈希：它现在没有任何使用方（适配器遇到就抛错），读回日志时大块字符串已经换回原文。
- 组请求时 `tool` 消息的内容在文字之后附图片块；拦截链照常看到它们（冻结规则不变）。
- OMP 适配器（`model/omp.ts`）：`tool` 消息的图片块转成 `ImageContent`；当前模型不支持图片输入（`capabilities.vision` 为假）时，换成一行文字（格式、尺寸、“当前模型不能看图”），不发图片。用户消息里的图片仍不支持，不在本 Task。
- 已知代价：图片随事件留在内存里的会话状态中，一张最大 20 MB 原图缩放后通常几百 KB；会话多、图多时再改为按需读 blob。

### 工具的落点与声明（`packages/neuro-book/src/plugins/agent/backend/builtin/`）

- `nbook.agent` 的服务端入口自己贡献 `agent.tools`。工具 id 按贡献点的插件前缀规则写成 `nbook.agent.<名>`，`providerName` 写模型熟悉的名字：

  | id | providerName | 等级 | 并发 |
  |---|---|---|---|
  | `nbook.agent.read` | `read` | 读 | shared |
  | `nbook.agent.write` | `write` | 写 | exclusive |
  | `nbook.agent.edit` | `edit` | 写 | exclusive |
  | `nbook.agent.edit-replace` | `edit` | 写 | exclusive |
  | `nbook.agent.grep` | `grep` | 读 | shared |
  | `nbook.agent.glob` | `glob` | 读 | shared |
  | `nbook.agent.shell` | `shell` | 执行 | exclusive |

- 两种 edit 模式是两条贡献（说明与参数格式不同），交给服务商的名字都是 `edit`；Profile 只绑其中一条，缺省用 hashline 那条。同一个会话绑了两条时，按 [`harness/runtime.md`](../../../../../docs/specs/harness/runtime.md) 输出 15，换算后同名的声明不进工具集，诊断 `tool-declaration-invalid`。
- 一个会话的 `read` 与 `edit` 共用一份 `EditStore`（`read` 登记看过的快照与行，`edit` 靠它核对行锚）：按会话 id 引用计数，两个工具都 `dispose` 时清掉。
- 共用的辅助（`builtin/address.ts`）：
  - 地址到真实路径：`services.resources.realPath`；真实路径换回地址：按本次调用里解析过的前缀替换（只用于把 `grep`、`glob` 的结果与 edit 的写回请求换回地址）。
  - 建上级目录：按段 `create(…, "directory")`，`conflict` 当作已存在。
  - 大结果：超出上限时，全文以宿主身份写进 `sessions://<会话>/home/artifacts/<调用 id>-<工具>.log`（`nbook.agent` 自己的服务端文件服务门面，不带 `as`，所以能写 Agent 只读的 `artifacts/`），交回截断的文字与这个地址的单数写法 `session://artifacts/…`。
- 所有失败交 `status: "error"`、`code` 用文件服务与资源视图的失败码（`not-found`、`permission-denied`、`no-project` 等），文字给模型看得懂的中文说明。

### `read`（`builtin/read.ts`）

- 参数：`path`（资源地址）、`offset?`（起始行，从 1 开始）、`limit?`（行数）。照 Claude Code 与旧 harness 的形状，不用 omp 写在路径里的 `:50-200` 选择器。
- 文本：经 `resources.read` 取文字与基线；输出 `[地址#TAG]` 头（`hashlineFormatHeader`）加带行号的行（`hashlineFormatNumberedLines`）；一次至多 2000 行、50 KB，超出时截断并注明总行数与怎样接着读。`EditStore.recordSnapshot(真实路径, 全文, 看过的行)`。
- 目录与虚拟根：经 `resources.list`，列一层（目录名带 `/`），至多 500 项；虚拟根交回它的说明与条目（`renderVirtual`）。
- 图片（png、jpeg、gif、webp，按扩展名与文件头判断）：经 `resources.realPath` 取真实路径读字节（资源视图没有读字节的方法；真实路径的授权与读相同）；超过 20 MB 报 `too-large`；用 `Bun.Image` 缩到最长边 1568 像素；交回一行说明（地址、格式、原始与缩放后的尺寸）加 `images`。模型不能看图时由适配器降级（见上）。
- 别的二进制：报 `not-text`，说明可以用 `shell` 处理。

### `write`（`builtin/write.ts`）

- 参数：`path`、`content`。整份写入：不存在就建（先建上级目录），存在就覆盖。
- 覆盖时先 `read` 取当前基线再 `write`；两次之间被别人改了得 `conflict`，原样报给模型（让它重读）。
- 写完把新内容登记进 `EditStore`，交回 `[地址#TAG]` 与“已写入 N 行”，模型可以接着用 hashline 改。

### `edit`（`builtin/edit.ts`）

- 照旧 harness 的 `createEditTool` 装配 `EditSession`，改三处：
  - `policy.urlSchemes` 登记全部地址方案（单数与全局的），`resolveUrl` 用 `resources.realPath` 把地址换成真实文件，失败时交回模型看得懂的拒绝（`error`）；
  - 写回（`apply` 的 writer）不直接写磁盘：按真实路径找回地址，取当前基线后经 `resources.write`；新建文件先建上级目录再 `create`；`delete`、`move` 两种操作拒绝（文件服务这次没有删除与改名），说明改用 `shell`；
  - 模式固定为这条贡献的模式（hashline 或 replace）。
- 输出照引擎的 `outcome.text`（英文原样），`details` 带模式与改了哪些文件。

### `grep` 与 `glob`（`builtin/search.ts`）

- `grep` 参数：`pattern`（正则）、`path?`（缺省 `shell` 的工作目录对应的地址）、`glob?`（文件过滤）、`ignoreCase?`、`context?`（上下文行数）、`limit?`（缺省 100 条）。`glob` 参数：`pattern`、`path?`、`limit?`（缺省 200 个）。参数名与缺省值照 omp 的 `grep`、`glob` 定稿前再对一次。
- 都先把 `path` 换成真实路径交给 `pi-natives`，结果里的真实路径换回地址。`path` 是虚拟根（如 `docs://`、`sessions://`）时报 `unsupported-capability`，说明改在它下面的真实目录上搜（如 `docs://builtin/`）；虚拟根下的真实目录照常搜（开发者 2026-11-02 定）。
- 结果按地址逐个过一遍授权（同一文件只查一次，`resources.realPath` 能取到才保留）：真实目录里有挂载方案不露出的文件（例如会话目录的 `index.json`），搜索不能把它们带出来。
- 超出条数上限时截断并注明；全文不另存（搜索可以重跑）。

### `shell`（`builtin/shell.ts`）

- 参数：`command`、`timeout?`（秒，1 到 3600，缺省 300）。
- 工作目录：`project://` 的真实路径；没有主项目时 `session://` 的真实路径（第一次用时建好）。
- 地址替换：执行前扫描命令，按引号状态找出 `<方案>://…` 形式的地址（只认已注册的方案与单数地址），换成真实路径；在引号外的路径含空白或特殊字符时加单引号。换不成真实路径的（虚拟根、`projects://` 的根）在执行前报错，不跑命令。
- 环境：继承服务端环境，另加 `NBOOK_PROJECT`（主项目的真实路径，没有时不设）、`NBOOK_SESSION`（`session://` 的真实路径）。
- `executeShell` 的 `signal` 接工具执行的 `signal`，`timeoutMs` 接参数；输出边收边累计，交回最后 50 KB / 2000 行（照 omp 截尾部），全文超出时存进 `session://artifacts/`；末尾一行写退出码、是否超时或被中止。
- Windows：brush shell 是否可用未验证，计划里标为未验证边界。

## Spec 与文档改动

- 新建 `docs/specs/agent/builtin-tools.md`（planned）：六个工具的参数、输出、上限、失败码、与资源地址的关系、`shell` 的工作目录、地址替换与环境变量、两种 edit 模式的绑定规则、已知限制（shell 不受文件工具规则约束、写入记为外部）。
- `docs/specs/harness/runtime.md`：工具结果可带图片（追加输出条目，planned），适配器对不能看图的模型降级。
- `docs/specs/agent/resources.md`：“Smoke”一行改为指向本 Task 的工具验收。
- `docs/specs/workspace/resources.md`：`shell`、glob、grep 的 planned 标注随本 Task 改写为实现。
- `docs/specs/README.md` 注册表加 `agent/builtin-tools.md`。

## 切片

0. **Spec**（主工作区）：上面全部 Spec 改动。
1. **内核：工具结果带图片**：`ToolResult.images`、事件、组请求、OMP 适配器与降级。验证：nb-harness 测试（含日志读回、超过 16 KB 进 blob）。
2. **工具底座**：`builtin/` 目录、贡献声明、按会话的 `EditStore`、地址辅助、建上级目录、大结果写进 `artifacts/`。验证：agent 测试。
3. **`read` 与 `write`**（含图片）。验证：agent 测试经脚本化端点调用。
4. **`edit`**（hashline、replace）。
5. **`grep` 与 `glob`**。
6. **`shell`**。
7. **收口**：受影响测试、类型检查、治理与文档检查；真实模型 smoke（DeepSeek，经本 Task 计划授权）：一个只绑这六个工具的测试 Profile 读一个文件、改一行、`grep` 找到它、`shell` 统计行数；然后实现审查。

## 验收映射

| Spec 条目 | 覆盖 |
|---|---|
| `harness/runtime.md` 新输出：工具结果带图片 | `nb-harness` 的 `kernel/run/tools.test.ts`（带图片的结果写进日志、读回一致、大图进 blob）、`kernel/model/omp.test.ts`（工具消息转成图片块；不能看图的模型得到文字） |
| `agent/builtin-tools.md` 的 `read` | `agent/builtin-tools.test.ts`：文本带头与行号、分页与截断、目录与虚拟根、图片缩放与说明、二进制报错、不存在的地址 |
| `write` | 同上：新建并建上级目录、覆盖、`conflict`、写不了的位置 `permission-denied`、写完能直接 hashline 改 |
| `edit` | 同上：hashline 改一行、陈旧的行锚被拒、replace 模式、`delete`/`move` 被拒、写入来源为该会话 |
| `grep`、`glob` | 同上：结果是地址、虚拟根报错而它下面的真实目录可以搜、会话目录里不露出的文件不出现在结果里、条数截断 |
| `shell` | 同上：工作目录（有项目与没有项目）、地址替换（引号内外、带空格的路径）、虚拟地址执行前报错、环境变量、超时、中止、长输出截断并存进 `artifacts/` |
| 组合 | `agent/builtin-tools.llm.test.ts`（真实模型 smoke） |

## 验证

- `bun run test:affected -- --since <本 Task 的起点>`；nb-harness 测试；`bun run typecheck`；`governance:check`、`docs:check`；关键规则做变异检查。
- 真实模型 smoke 用 DeepSeek（`.env` 的 `DEEPSEEK_*`，不打印密钥）。
- 未验证的边界：Windows 上的 brush shell；不支持图片输入的模型实际收到的降级文字（只在适配器测试里核对）。

## 不做与风险

- 不做：`todo`（搁置）；审批接线与 `shell` 只读白名单（t06）；`shell` 转后台（t22）；`delete`、`move` 与 apply_patch、patch 模式；`read` 读 PDF 与 omp 那些格式（SQLite、压缩包、`?q=` 问图）；用户消息里的图片；改渲染器。
- 风险：
  - 地址替换按文本扫描，遇到 heredoc、变量拼接等写法会漏换或误换：漏换时命令拿到的是地址字面量，通常以“找不到文件”失败；说明里写明只认直接写出的地址。
  - `edit` 写回时先读基线再写：引擎核对的是它读到的内容，与写回之间被别人改了得 `conflict`，不会覆盖别人的改动。
  - 图片随会话状态留在内存里，会话多、图多时占内存。
