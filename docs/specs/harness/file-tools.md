---
schema: nbook.spec/v1
kind: behavior
status: implemented
capability: harness.file-tools
owners:
  - nb-harness
---

# 内置文件工具：read 与 edit

## 目标与非目标

模型能读文件、目录和图片，并能以“先读后改”的方式安全地修改文本文件：`read` 给出带行号和内容锚点的视图，`edit` 只接受基于这些锚点的修改，锚点伪造、未展示的行或无法对应的旧锚点都会被拒绝，磁盘保持不变。编辑语义（锚点格式、陈旧锚点重映射、模糊匹配、错误文案）完全由 OMP 编辑引擎决定，本工具只负责装配、写回磁盘和写前确认。

明确不承诺：

- 不限制访问范围：两个工具都不把路径限制在 `cwd` 内（见“边界与兼容”）。
- 不提供原子写入、备份、撤销或文件锁。
- 不读取归档、SQLite、URL 或 PDF 等文档格式；除图片外的二进制文件一律拒绝，插件可通过读取格式扩展。
- 不转发 LSP 诊断，也不转发编辑的流式预览。

## 术语与参与者

- **编辑快照存储（EditStore）**：OMP 原生对象，记录某个文件被展示过的内容版本与行号。同一 harness 中 `read` 与 `edit` 共用一个实例。
- **内容锚点（tag）**：编辑引擎为某个内容版本计算的 4 位十六进制标识。`read` 输出的第一行 `[显示路径#tag]` 就是锚点头。
- **已展示的行**：本次 `read` 实际输出的行号；hashline 模式下只能修改这些行。
- **编辑模式**：`hashline`（缺省，基于锚点的行操作）、`replace`、`patch`、`apply_patch`。
- **写前确认**：`edit` 写盘前调用的宿主回调，返回 false 即整体拒绝本次编辑。
- **读取格式**：插件提供的 `{id, canRead(path), read(path, {offset, limit})}`，让 `read` 能处理额外文件类型。

## 输入与前置条件

`read` 参数：

| 参数 | 说明 |
|---|---|
| `path` | 必需，非空；相对路径按 `cwd` 解析，也接受绝对路径 |
| `offset` | 起始行，1 起，缺省 1；必须是不小于 1 的整数 |
| `limit` | 最多展示多少行；非负整数时生效，其它值忽略 |

`read` 创建选项：`cwd`、`formats`、`maxLines`（缺省 2000）、`maxBytes`（缺省 50 KiB）、`store`。

`edit` 参数：唯一字段 `input`，非空字符串，内容是所选模式的原文载荷（hashline 模式以 `read` 给出的锚点头开头，后接行操作，例如 `PUT 2.=2:` 与 `+新内容`）。

`edit` 创建选项：`cwd`、`mode`（缺省 `hashline`）、`store`、`confirmWrite`、`allowFuzzy`（缺省 true）、`fuzzyThreshold`（缺省 0.8）、`enforceSeenLines`（缺省 true）、`localSandboxRoot`、`vaultRoots`、`homeDir`（缺省当前用户主目录）。

## 输出与可观察行为

`read` 按以下顺序判断目标：

1. 路径不存在：错误结果。
2. 目录：按名称排序列出一层条目，每行 `- 名称`，子目录名以 `/` 结尾；超过 500 项只列前 500 项并注明总数。
3. 插件读取格式：按注册顺序询问 `canRead`，第一个命中且返回非 null 的格式的文本即为结果，`details.format` 为其 id；返回 null 则继续询问下一个。
4. 扩展名为 `.png`、`.jpg`、`.jpeg`、`.gif`、`.webp`：返回 base64 图片内容与字节数。
5. 内容含 NUL 字节：错误结果“二进制文件不受支持”。
6. 文本：取 `offset`、`limit` 指定的窗口，再按行累加、先到先停地套用行数与字节预算；每行输出为 `行号: 内容`。传入 `store` 时，第一行是锚点头 `[path#tag]`，并把全文与已展示的行号登记到 `store`。被预算截断时末尾追加一行说明截断原因（`lines` 或 `bytes`）与文件总行数、总大小。`details` 含 `tag`、`truncated`、`reason`、`lines`。

`edit`：

- 按模式解析 `input`，由编辑引擎规划修改；每个要写的文件依次经过写前确认与写盘。
- 成功时返回引擎生成的文本（hashline 模式为修改后的行视图，首行是新锚点头，可直接用于下一次编辑），`details` 列出每个文件的显示路径、操作与警告。
- 支持创建、更新、删除与移动（`apply_patch` 的 `Move to`、`Delete File`）；写入时自动创建父目录。
- 引擎判定失败（锚点伪造、修改了未展示的行、无法匹配等）时返回 `isError: true` 的结果，文本为引擎原文，磁盘不变。
- 文件在 `read` 之后被外部修改时，引擎尝试把旧锚点重映射到未变化的当前行；成功则照常写入，并在结果中带 “Recovered by remapping stale line anchors” 警告。这一自愈行为不可关闭，项目已接受。

## 状态与转换

- `read` 每次成功读取文本都会向 `store` 登记一个内容版本；`edit` 成功后由引擎自行登记新版本。宿主不得在编辑后手动登记，否则会污染已展示行的记录。
- `store` 只在内存中，随 harness 存活。
- `edit` 每次调用新建一个编辑会话，调用结束即关闭；工具声明为互斥执行（同一 Agent 中不与其它工具并发），`read` 声明为可共享执行。

## 副作用与数据

- `read`：只读文件与目录；向 `store` 登记快照。
- `edit`：创建、覆盖、删除、移动文件；写入使用直接覆盖，不是原子替换。删除时目标已不存在视为成功。
- 两者都不写日志；工具调用与结果由 [`harness.agent-turn`](agent-turn.md) 记录到会话日志。

## 失败与恢复

- `read`：`path` 为空、路径不存在、`offset` 不是正整数或超过文件行数、二进制文件，均返回错误结果而不抛出。插件读取格式抛出的异常不被捕获，交给 OMP 工具循环处理。
- `edit`：`input` 为空返回错误结果；写前确认返回 false 时返回“已拒绝写入”的错误结果且该文件不写；引擎判定失败返回引擎原文错误；写盘时的文件系统错误向上抛出，交给 OMP 工具循环处理。
- 多文件编辑中途失败时，已经写入的文件不回滚（从代码推断，未单独测试）。

## 边界与兼容

- 编辑语义与错误文本来自 OMP `@oh-my-pi/pi-natives@18.2.5` 的编辑引擎；错误文本是模型训练过的格式，不翻译、不改写。行为细节见 [OMP 能力报告第 4 节](../../../packages/nb-harness/docs/omp-capabilities.md)。
- **访问范围**：两个工具都接受绝对路径和包含 `..` 的相对路径，能读写 `cwd` 之外的任何当前用户可访问的文件（2026-10-01 实测：`../outside/o.txt` 被读取并改写）。[`harness.agent-turn`](agent-turn.md) 创建的 `edit` 没有传写前确认，因此模型可以不经确认改写这些文件。在补上访问边界之前，harness 只适合受信的本机使用。
- `localSandboxRoot`、`vaultRoots` 原样传给编辑引擎，本项目尚未定义它们的策略，也没有验证效果。
- 已知缺口（当前未保证，修复前不要依赖）：
  - 单行超过字节预算时，输出为 `1: `（看起来像空行）加截断说明，模型可能误以为该行为空。
  - 空文件输出 `1: `；以换行结尾的文件会多出一个空的末行编号（2026-10-01 真实 DeepSeek 运行中，模型据此把一行的文件描述为“两行，第二行为空”）。
  - 图片不受字节预算限制，整文件 base64 返回。

## 验收与 Smoke

1. Given 文件 `alpha\nbeta\ngamma\n` 与共享 `store`，When `read`，Then 首行匹配 `[a.txt#XXXX]`，之后为 `1: alpha`、`2: beta`、`3: gamma`、`4: `，且 `store` 中该文件的当前锚点等于首行的 tag。
2. Given 4 行文件，When `read` 且 `offset: 2, limit: 2`，Then 只输出 `2: l2`、`3: l3`。
3. Given 文件只有 5 行，When `offset: 99`，Then 错误结果含“offset 越界”。
4. Given `maxLines: 3` 与 10 行文件，When `read`，Then 输出到 `3: line-3` 为止，`details.reason` 为 `lines`，末尾注明截断。
5. Given 含 NUL 字节的文件、不存在的路径，Then 分别得到“二进制文件不受支持”与“文件不存在”错误。
6. Given 含文件与子目录的目录，Then 输出 `- b.txt`、`- sub/`，`details.kind` 为 `directory`。
7. Given 两个都能读该文件的插件格式，Then 采用先注册者的输出。
8. Given `read` 得到的锚点头，When `edit` 输入 `PUT 2.=2:` 与 `+BETA`，Then 文件变为 `alpha\nBETA\ngamma\n`；再用回显的新锚点改第 3 行也成功。
9. Given 只 `read` 了第 1 行，When 修改第 3 行，Then 错误结果含 “never displayed”，磁盘不变。
10. Given 伪造的锚点 `#0000`，Then 错误结果且磁盘不变。
11. Given `read` 后文件头部被外部插入一行，When 用旧锚点改原第 2 行，Then 成功写入正确的行，结果含重映射警告。
12. Given 写前确认恒返回 false，Then 错误结果含“已拒绝写入”，磁盘不变。
13. Given `apply_patch` 模式，When 一次补丁更新并移动 `old.txt` 到 `nested/new.txt`、删除 `remove.txt`，Then 新文件内容正确，旧文件与被删文件都不存在。
14. Smoke：在包目录运行 `bun examples/file-tools.ts`，不调用模型，演示读取、编辑、拒绝伪造锚点与写前确认，以 0 退出。

## 实现合同

- **owner**：`packages/nb-harness`。
- **公开接口**：`createReadTool(options)`、`createEditTool(options)`、`ReadToolOptions`、`EditToolOptions`、`EditToolMode`、`PluginReadFormat`，以及 `read` 使用的文本预算函数 `truncateText`。两个工具都实现 OMP `AgentTool`，名称固定为 `read` 与 `edit`。
- **关键不变量**：
  - `read` 登记到 `store` 的是全文与“实际展示的行号”，不是请求的窗口；预算截断后的行不算已展示。
  - `edit` 的写回函数是引擎与磁盘的唯一接口：写前确认拒绝时抛出模块内部错误，由工具捕获并转成错误结果；不能返回空内容代替拒绝，因为引擎会把返回值当作已写入内容登记。
  - `edit` 以 `{input: 原文}` 的 JSON 形状交给引擎（`rawInput: false`），字段名必须是 `input`。
  - `blockAutoGenerated` 固定为 true、`planActive` 固定为 false。

## 证据

- 实现入口：[`read.ts`](../../../packages/nb-harness/src/tools/read.ts)、[`edit.ts`](../../../packages/nb-harness/src/tools/edit.ts)、[`text-budget.ts`](../../../packages/nb-harness/src/text-budget.ts)
- 合同测试：[`read-tool.test.ts`](../../../packages/nb-harness/tests/read-tool.test.ts)、[`edit-tool.test.ts`](../../../packages/nb-harness/tests/edit-tool.test.ts)
- Smoke：[`examples.test.ts`](../../../packages/nb-harness/tests/examples.test.ts)（运行 [`examples/file-tools.ts`](../../../packages/nb-harness/examples/file-tools.ts)）
- 批准与实现：同 [`harness.agent-turn`](agent-turn.md#证据)；陈旧锚点重映射语义由开发者在 t06 中接受（[实施记录](../../../.agents/works/w00002-neuro-agent-harness-redesign/tasks/t06-nb-harness-rebuild/walkthroughs/001-implementation-2026-09-18.md)）。
