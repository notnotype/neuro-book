# t12 实施计划：基础工具（read、write、edit、grep、glob、shell）

第二稿（2026-11-02）：按第一轮设计审查修订，处理见 [evidences/design-review-disposition.md](evidences/design-review-disposition.md)。与第一稿最大的不同：读与搜索改为“经文件服务定位、核对包含之后在本机读真实文件”，写仍经资源视图；`edit` 在动手前预检并冻结基线；`shell` 的输出边跑边落盘。

## Context

Agent 插件（t10）有了工具贡献点，资源地址（t08）有了会话的资源视图，但还没有任何内置工具。本 Task 交第一批六个工具。

依据：本 Task README 的“决定”（2026-10-28）、“补充决定”与“开工前对齐”（2026-11-02）；[`agent/resources.md`](../../../../../docs/specs/agent/resources.md)、[`workspace/resources.md`](../../../../../docs/specs/workspace/resources.md)、[`agent/contributions.md`](../../../../../docs/specs/agent/contributions.md)、[`harness/models.md`](../../../../../docs/specs/harness/models.md)、[`harness/runtime.md`](../../../../../docs/specs/harness/runtime.md)、[`harness/session.md`](../../../../../docs/specs/harness/session.md)。

开发者已确认、不再议：

1. 第一批：`read`（能读图片，照 omp）、`write`（自动建上级目录）、`edit`（hashline 与 replace）、`grep`、`glob`、`shell`。`todo` 搁置，`ask`、`switch_mode` 归 t06。
2. `read`、`edit` 用 code agent 的默认做法，不针对长篇中文正文专门设计。
3. t12 只交工具，不接审批；工具声明自己的等级（读、写、执行）。
4. `shell`：brush shell，只在前台；超时缺省 300 秒、可设 1 到 3600 秒；工作目录有主项目时 `project://`、没有时 `session://`；输出截断、全文进 `session://artifacts/`；命令里的地址换成真实路径，虚拟地址报错；提供 `$NBOOK_PROJECT`、`$NBOOK_SESSION`；原样继承服务端的环境变量；安全上的洞第一版不补。
5. 工具说明用中文；失败在 `details` 给 `code`；`pi-natives` 原生 edit 的英文错误原样交回（ADR 0034）。
6. 不改 nb-agent-ui 的渲染器。`grep`、`glob` 第一版不在虚拟根上跑，虚拟根下的真实目录可以搜。

## 技术选型

| 问题 | 选用 | 理由 / 否决 |
|---|---|---|
| 行锚编辑 | `pi-natives` 的 `EditSession`、`EditStore`、`editInspect`、`editDescription`、`editGrammar` | 与 omp 同一引擎；`editInspect` 在动手前列出全部目标与文件操作 |
| 读文件的行号与头 | `hashlineFormatHeader`、`hashlineFormatNumberedLines` | 与 `EditSession` 认的格式一致 |
| 内容搜索、文件匹配 | `pi-natives` 的 `grep`（流式 `onMatch` 加 `signal`）、`glob`（`followLinks: false`） | 已定 |
| shell | `pi-natives` 的 `executeShell` | 已定；`ShellFilesystem` 让 shell 认 `scheme://` 的做法（omp）要实现几十种文件操作，第一版不用 |
| 图片缩放 | `Bun.Image` | Bun 1.4.4 自带，omp 同用 |

## 关键设计

### 读与写的分工

- **写**一律经资源视图（`services.resources`）：来源记为该会话、按基线条件保存、权限按 `agent/resources.md`。单个文件上限是文件服务的正文上限（约 960 KiB）。
- **读**（`read` 的文本与图片、`grep`、`glob`）不经文件服务的读方法，而是先经资源视图定位、再在服务端本机读真实文件：
  - 文件服务的 `realPath` 加 `follow` 选项：为真时跟随最后一段的链接，并核对解析后仍在方案根内、不是受保护位置（与 `read` 的包含规则相同，挂载方案照常按真实路径授权）；`projects://` 经项目合同带上同一选项（项目合同与 `user://` 合同版本加 1）。
  - 理由：文件服务的读一次交整份文本、有 960 KiB 上限、不能读字节；`read` 要分页读大文件（含 `artifacts/` 里的全文）、要读图片字节。只用不跟随链接的 `realPath` 再自己打开会被最后一段的根外链接读穿（审查第 2 条），所以必须由文件服务完成包含核对。
  - 已知限制：定位与读之间被换掉链接的竞态不防（只有 Agent 自己的 shell 能这样做，shell 本就不受文件工具规则约束）。
- **输出里的地址一律是全局地址**（`resources.expand` 的结果）：hashline 头、目录列表、搜索结果、edit 的文件名、`artifacts/` 的链接。输入接受单数与全局两种写法。理由：`agent/resources.md` 已定“工具结果里的地址是全局形式”；单数地址在 fork 或换 Profile 后会指向别处。

### 内核：工具结果带图片（`packages/nb-harness/src/kernel/`）

- `ToolResult` 与 `toolResult` 事件加 `images?: readonly {data: string /* base64 */, mime: string, width?: number, height?: number}[]`。超过 16 KB 的字符串自动进 `blobs/`（现有机制，审查者已用真实存储验证读回一致）。
- `ContentBlock.image` 从 `blob` 改为带 `data`（它没有使用方）。组请求时 `tool` 消息在文字后附图片块。
- **脱敏与改写**：工具拦截交回 `redacted: true` 的结果时，内核丢掉图片（与丢 `details` 同一处）；判断“结果被改写”时同时比较文字与图片（图片按 `data` 的哈希比）；原文记录的 `rawHash` 覆盖图片。出站过滤（`mapEventContent` 一类）对图片不做文字替换，只按“改写”规则整块保留或去掉。
- **token 估算**：自动压缩与预览的估算里，图片按固定口径计（宽 × 高 / 750，至多 1,600；没有尺寸时按 1,600），不按 base64 的长度算。
- **适配器**（`model/omp.ts`）：`tool` 消息的图片块转成 `ImageContent`；模型不支持图片输入时换成一行文字（格式、尺寸、“当前模型不能看图”）。用户消息里的图片仍不支持。

### 工具的落点与声明（`packages/neuro-book/src/plugins/agent/backend/builtin/`）

- `nbook.agent` 的服务端入口自己贡献 `agent.tools`，id `nbook.agent.<名>`，`providerName` 用模型熟悉的名字：

  | id | providerName | 等级 | 并发 |
  |---|---|---|---|
  | `nbook.agent.read` | `read` | 读 | shared |
  | `nbook.agent.write` | `write` | 写 | exclusive |
  | `nbook.agent.edit` | `edit`（hashline） | 写 | exclusive |
  | `nbook.agent.edit-replace` | `edit`（replace） | 写 | exclusive |
  | `nbook.agent.grep` | `grep` | 读 | shared |
  | `nbook.agent.glob` | `glob` | 读 | shared |
  | `nbook.agent.shell` | `shell` | 执行 | exclusive |

- 两种 edit 是两条贡献，Profile 只绑一条（缺省 hashline）；同一会话绑了两条按 `harness/runtime.md` 输出 15 处理。
- `agent.tools` 的声明加可选的 `customFormat`（`{syntax: "lark", definition}`），`AgentTools` 原样转给内核：hashline 的语法（`editGrammar("hashline")`）要随声明交给模型（审查第 17 条）。replace 没有语法，参数是 `{path, old_string, new_string, replace_all?}`。
- 一个会话的 `read`、`write`、`edit` 共用一份 `EditStore`，按会话 id 引用计数，持有它的工具都 `dispose` 时清掉。
- 共用的辅助（`builtin/address.ts`）：
  - 定位：`realPath(…, {follow: true})`；目标不存在时（`shell` 的新文件、edit 的新建）从最近的已存在祖先定位，再接上余下的段（段已由地址规则校验），不预先建任何东西；
  - 建上级目录：按段 `create(…, "directory")`，`conflict` 时再定位一次，确是目录才继续，是文件或链接就报 `not-a-directory`；
  - 大结果：宿主身份写进 `sessions://<会话>/home/artifacts/<调用 id>-<工具>.log`，**直接流式写盘**（定位 `artifacts/` 目录的真实路径后在本机追加写），单个文件上限 64 MiB，超出时停止写并在文件末尾与工具结果里注明；写盘失败不影响工具结果，结果里注明“全文没能保存”与原因。
- **失败码**（写进新 Spec）：资源视图与文件服务的码原样（`not-found`、`permission-denied`、`conflict`、`too-large`、`no-project`、路由层的 `unknown-outcome` 等）；`edit` 引擎的失败为 `edit-<errorKind>`（例如 `edit-no_match`、`edit-unseen_lines`），写回时文件服务的失败保留它自己的码；`shell` 为 `exit-nonzero`、`timeout`、`cancelled`；`grep` 正则不合法为 `invalid-pattern`；虚拟根上搜索为 `unsupported-capability`。码放在 `details.code`，不按英文文字判断。

### `read`（`builtin/read.ts`）

- 参数：`path`、`offset?`（≥ 1 的整数）、`limit?`（1 到 2000 的整数）。
- 文本：定位后在本机按行流式读窗口；一次至多 2000 行、50 KB；单行超过 2000 字符截断并标出。输出全局地址的 `[地址#TAG]` 头加带行号的行。`EditStore.recordSnapshot(真实路径, 全文, 完整展示的行)`：完整展示的行为空时（例如首行就超出预算）传 `[0]`（引擎的“没有看过任何行”），不传 `[]`（引擎把空集当作不限行，审查第 12 条）；截断了的长行不算完整展示。文件超过 4 MiB 时不登记快照（引擎的上限），头里不给标记，说明这个文件只能用 `write` 整份改或用 `shell`。
- 目录与虚拟根：经 `resources.list` 列一层，至多 500 项。
- 图片（png、jpeg、gif、webp，按文件头判断）：定位后读字节；超过 20 MB 报 `too-large`；`Bun.Image` 缩到最长边 1568 像素；交回一行说明与 `images`。
- 别的二进制报 `not-text`。

### `write`（`builtin/write.ts`）

- 参数：`path`、`content`。不存在就建（先建上级目录，再 `create` 文件，`conflict` 说明别人刚建了，转为覆盖流程），存在就覆盖：取当前基线后 `write`，两步之间被改了得 `conflict`。
- 写完登记 `EditStore`（全部行都算看过：内容是模型给的），交回全局地址的 `[地址#TAG]` 与行数。

### `edit`（`builtin/edit.ts`）

动手前预检，写回时只用预检冻结的基线（审查第 1、9、11 条）：

1. `editInspect(mode, args)` 列出全部目标路径与文件操作。任何目标不是合法的资源地址（裸路径、相对路径、未登记的方案）、或有删除、移动操作的，整次拒绝，什么都不读、不写。
2. 对每个目标经资源视图 `read` 取文字与基线并冻结（不存在的目标记为“新建”）。
3. 起 `EditSession`：`urlSchemes` 登记全部方案，`resolveUrl` 用定位（`follow`）把地址换成真实文件；`cwd` 设为一个不存在的目录，`homeDir` 同样不用真实主目录，堵住引擎的本地路径分支。
4. 写回：按真实路径找回目标；已存在的用冻结的基线 `write`（引擎读之后、写回之前被别人改了，都会 `conflict`）；新建的先建上级目录再 `create`、`write`。
5. 多个文件时，前面已写成、后面失败的，结果里如实列出已改与失败的文件及各自的码，并让已改文件的快照失效（`EditStore` 重新登记新内容）；不承诺整次原子。
- 输出：引擎的 `outcome.text`（英文原样）；`details` 带模式、`code` 与逐文件结果。

### `grep` 与 `glob`（`builtin/search.ts`）

- `grep` 参数：`pattern`、`path?`（缺省 `shell` 的工作目录）、`glob?`、`ignoreCase?`、`context?`（0 到 10）、`limit?`（1 到 500，缺省 100）。`glob` 参数：`pattern`、`path?`、`limit?`（1 到 1000，缺省 200）。
- 虚拟根报 `unsupported-capability`。搜索根经定位（`follow`）得到；`glob` 设 `followLinks: false`。
- 授权按“边搜边过滤”：用流式 `onMatch`，每个文件第一次出现时经定位核对（换回全局地址后 `realPath(follow)` 能取到才保留，结果缓存），够了 `limit + 1` 条可见结果就经 `signal` 停下，多出的那一条只用来判断“还有更多”。这样不露出的文件（会话目录的 `index.json`、`blobs/`）占不掉配额（审查第 10 条）。
- 预算：`grep` 的 `maxColumns` 500；格式化后的结果至多 50 KB；`grep` 30 秒、`glob` 5 秒的期限，期限到了交回已有的结果并注明“不完整”，与“没有匹配”分开。不另存全文（可以缩小范围重搜）。

### `shell`（`builtin/shell.ts`）

- 参数：`command`、`timeout?`（秒，1 到 3600，缺省 300）。
- 工作目录：`project://` 定位后的真实路径；没有主项目时 `session://`（第一次用时建好）。
- 地址替换：只认直接写出的地址（已登记的方案与单数写法，`<方案>://` 后到空白或引号结束），按所在的引号上下文编码替换后的真实路径：
  - 引号外：整段单引号包起，路径里的 `'` 写成 `'\''`；
  - 单引号内：路径里的 `'` 写成 `'\''`；
  - 双引号内：路径里的 `$`、反引号、`\`、`"` 前加 `\`。

  目标不存在的地址按“从最近的已存在祖先定位”换成路径（`mkdir`、重定向、`cp` 的目标照常可用）；虚拟根与换不成真实路径的在执行前报错。heredoc、变量拼接、命令替换里的地址不保证替换（说明里写明只认直接写出的地址）。
- 环境：继承服务端环境，另加 `NBOOK_PROJECT`（没有主项目时不设）、`NBOOK_SESSION`。
- 输出：执行一开始就把输出流写进 `artifacts/` 的日志（上限 64 MiB），内存里只留最后 50 KB / 2000 行；结束后交回尾部窗口、退出码与是否超时或被中止，输出超过窗口时附全文的全局地址（可用 `read` 分页读）。退出码非 0 为 `exit-nonzero`。`signal` 接工具执行的 `signal`，超时、中止、异常时都关闭日志文件。
- Windows：未验证。

## Spec 与文档改动

- 新建 `docs/specs/agent/builtin-tools.md`（planned）：六个工具的参数、输出、上限、失败码、读写分工、全局地址、`shell` 的工作目录、地址替换与引号规则、环境变量、`artifacts/` 的写法与上限、两种 edit 的绑定、已知限制。
- `docs/specs/harness/runtime.md`：工具结果可带图片；脱敏、改写判断与出站过滤对图片的规则；压缩与预览按图片口径估算；适配器对不能看图的模型降级（追加输出条目，planned）。
- `docs/specs/workspace/resources.md`：服务端文件服务的 `realPath` 加 `follow`；项目与 `user://` 合同版本 7；`shell`、glob、grep 的 planned 标注随本 Task 改写。
- `docs/specs/agent/contributions.md`：`agent.tools` 的声明加 `customFormat`。
- `docs/specs/agent/resources.md`：“Smoke”一行指向本 Task 的工具验收。
- `docs/specs/README.md` 注册表加 `agent/builtin-tools.md`。

## 切片

0. **Spec**（主工作区）。
1. **内核：工具结果带图片**：结果与事件、组请求、脱敏与改写、出站过滤、token 口径、适配器与降级。验证：nb-harness 测试。
2. **文件服务的 `follow` 与声明的 `customFormat`**：`realPath(follow)`（挂载方案、`user://`、`projects://` 与项目合同）、合同版本 7；`agent.tools` 声明与 `AgentTools` 转发。验证：files、agent 测试。
3. **工具底座**：`builtin/` 目录、贡献声明、按会话的 `EditStore`、定位与建目录、流式 `artifacts/` 写入、失败码。
4. **`read` 与 `write`**（含图片）。
5. **`edit`**（预检、冻结基线、写回、部分失败）。
6. **`grep` 与 `glob`**。
7. **`shell`**。
8. **收口**：受影响测试、类型检查、治理与文档检查、变异检查；真实模型 smoke（DeepSeek，经本计划授权：一个只绑这六个工具的测试 Profile 读一个文件、改一行、`grep` 找到它、`shell` 统计行数）；然后实现审查。

## 验收映射

| Spec 条目 | 覆盖 |
|---|---|
| `harness/runtime.md` 图片 | `nb-harness`：带图片的结果写进日志、重开与 fork 后一致、大图进 blob；脱敏丢掉图片、只改图片也算改写、出站过滤不碰图片字节；500 KiB 的图不会触发压缩；适配器转图片块、不能看图的模型得到文字 |
| `workspace/resources.md` 的 `follow` | `files/schemes.test.ts`、`files/projects-scheme.test.ts`：最后一段是根外链接时 `follow` 为 `outside-root`、不 `follow` 照旧；指向受保护位置的链接被拒；旧版本合同得 `version-changed` |
| `read` | `agent/builtin-tools.test.ts`：全局地址的头与行号、分页、长行截断、首行超预算时快照不放行编辑、超过 960 KiB 的文件能分页读、目录与虚拟根、图片缩放、根外链接读不到、二进制报错 |
| `write` | 新建并建上级目录、上级是文件时 `not-a-directory`、覆盖、`conflict`、写不了的位置 `permission-denied`、写完能直接 hashline 改 |
| `edit` | hashline 改一行、陈旧的行锚被拒、replace、裸路径与相对路径整次拒绝且不泄露内容、删除与移动整次拒绝、引擎读之后被别人改了得 `conflict` 不覆盖、两个文件第二个失败时如实报告、新建文件、`customFormat` 经贡献点到达模型请求 |
| `grep`、`glob` | 结果是全局地址、虚拟根报错而它下面的真实目录可以搜、不露出的文件占满原生配额时仍拿到可见结果、`limit + 1` 判截断、长行截断与总字节上限、期限到了标“不完整”、非法正则 |
| `shell` | 工作目录（有项目与没有项目）、地址替换（引号外、单引号内、双引号内；路径含空格、`$`、反引号、`'`）、新文件目标、虚拟地址执行前报错、环境变量、超时、中止、超过 1 MiB 的输出完整落盘并能分页读回、内存里只留尾部、`exit-nonzero`、fork 之后 `artifacts/` 链接仍指向原会话 |
| 组合 | `agent/builtin-tools.llm.test.ts`（真实模型 smoke） |

## 验证

- `bun run test:affected -- --since <本 Task 的起点>`；nb-harness 测试；`bun run typecheck`；`governance:check`、`docs:check`；关键规则做变异检查。
- 真实模型 smoke 用 DeepSeek（`.env` 的 `DEEPSEEK_*`，不打印密钥）。
- 未验证的边界：Windows 上的 brush shell；服务商实际怎样计图片 token（只按固定口径估算）。

## 不做与风险

- 不做：`todo`；审批接线与 `shell` 只读白名单（t06）；`shell` 转后台（t22）；删除、移动与 apply_patch、patch 模式；`read` 读 PDF 与 omp 的其它格式；用户消息里的图片；改渲染器；单个文件超过 960 KiB 时的 `write`、`edit`（文件服务的正文上限）。
- 风险：
  - 地址替换只认直接写出的地址；heredoc、变量拼接里的地址可能漏换。
  - 定位与读之间的链接替换竞态不防。
  - `edit` 多文件时不原子：中途失败如实报告已改的文件。
  - 图片随会话状态留在内存里。
