# 上游复用选项与事件域（2026-09-18）

> 起因：开发者两问 —— ① 是否有共享 domain？要不要？`/sse` 是否含事件定义、是否可扩展？② `/file-tools` 能否直接用 OMP 暴露的接口？
> 方法：本地已装依赖（`@earendil-works/pi-agent-core@0.80.6`）反查 + npm registry 清单 + OMP 自带运行时文档（本机 OMP 安装）。只读，未改任何产品代码。

## 1. `/sse` 现状：不含事件定义，靠泛型扩展

证据（`packages/agent-kit/src/sse/writer.ts`）：

- 只有三个结构类型：`AgentSseFrame {readonly frame: Buffer}`、`AgentSseSubscription<Event extends AgentSseFrame>`、`AgentSseResponse`（最小 Node `ServerResponse` 表面）。
- `writeAgentEventStream<Event extends AgentSseFrame>(response, subscription)`：只搬运字节，不解析 payload、不知道事件名（`event:` 行由调用方预先序列化）。
- 可扩展性已成立：宿主用泛型参数注入自己的事件类型；不引入任何事件表。

## 2. 事件定义现状：三层，全在领域侧；kit/仓库无共享 domain

| 层 | 定义 | 位置 |
| --- | --- | --- |
| 库层（运行时事件） | `AgentEvent` 联合：agent_start/agent_end/turn_start/turn_end/message_start/message_update/message_end/tool_execution_start/tool_execution_update/tool_execution_end | `@earendil-works/pi-agent-core`（`dist/types.d.ts:360`），产品已直接 import（`server/agent/events/types.ts:1`） |
| 领域运行时层 | `NeuroAgentEvent = AgentEvent \| {type:"session_entry"} \| {type:"custom"}` | `server/agent/events/types.ts`（13 行） |
| 公开契约层 | `AgentSessionEventDto` 信封：`{eventEpoch, seq, sessionId, invocationId?, kind:"runtime"\|"session", event}` | `packages/neuro-book/shared/dto/agent-session.dto.ts:763` |

- 无共享 domain：`@notnotype/neuro-book-contracts` 仅含 desktop/安装/provider-config/platform/release 等合同（`packages/neuro-book-contracts/src/*`），不含 agent 事件；事件 DTO 在产品包内 `shared/dto/`。
- 序列化点：`server/agent/events/session-event-hub.ts:200-208`（分配 `seq` + `Buffer.from("event: ...\ndata: ...\n\n")`），即 frame 组装属于领域 hub，不属于 writer。

**结论/建议**：共享 domain = 要，但只共享「信封 + 游标 + 策略 seam」，不共享事件表。理由：writer/hub 的机制只需三个量 —— 字节大小、序号/epoch、降级策略；事件语义（`session_state_changed`、`tool_user_input_required`、`snapshot_required` 降级、`closeReason`）是领域知识。形态：`/sse` 内放结构契约（游标、`EventSerializer<Event>`、字节预算），hub 泛型化 + 注入 `serialize/estimateBytes/overflowPolicy`；事件 union 由宿主注入。出现第二个跨命名空间使用者（`./session` ↔ `./sse`）时再提升为独立 `./events` 命名空间。

## 3. 上游覆盖度（关键发现）：`@earendil-works/pi-agent-core@0.80.6` 已导出大量我们计划重抽的能力

| pi-agent-core 导出 | 对应 package-map 成员 | 备注 |
| --- | --- | --- |
| `truncateHead`/`truncateTail`/`truncateLine`/`formatSize`/`DEFAULT_MAX_LINES`/`DEFAULT_MAX_BYTES`/`TruncationResult` | `file-tools/truncate` | **与我们的实现行为完全一致**（见 §4） |
| `ExecutionEnv`/`NodeExecutionEnv`（fs + exec 原语：read/writeFile/appendFile/listDir/canonicalPath/createTemp*/exec(timeout,abort,onStdout…)） | `file-tools/tools`、`shell/shell` 的下层 | `FileSystem` 为纯接口，可注入 |
| `executeShellWithCapture`、`sanitizeBinaryOutput` | `shell/output` 一部分 | 含截断 + `fullOutputPath` 溢出落盘 + cancel |
| `Session`、`JsonlSessionRepo`、`JsonlSessionStorage`、memory 变体、`buildSessionContext`、`sessionEntryToContextMessages`、`uuidv7` | `session/log` | JSONL 树日志 + 上下文构建；repo 通过注入的 `FileSystem`（`Pick<...>`）访问磁盘 |
| `AgentHarness`、compaction（`compact`/`generateSummary`/`shouldCompact`…）、skills、prompt templates、system prompt | `./profile` 相邻、harness 本体 | 产品目前未用这些 |

产品对 pi 的使用面目前仅 7 处 import（全部为类型或两个 token 估算函数：`AgentEvent`/`AgentMessage`/`AgentTool`/`AgentToolCall`/`ThinkingLevel`/`estimateContextTokens`/`estimateTokens`），**没有**使用其 env/shell/session 实现。

## 4. `truncate` 重复实现证据

- `packages/neuro-book/server/agent/tools/truncate.ts` 与 `packages/agent-kit/src/file-tools/truncate.ts`：**内容逐字相同**（仅 CRLF/LF 差异，`diff` 规范化行尾后无差异）。
- 与 pi 的 `harness/utils/truncate.ts`（sourcemap 取出 345 行原始 TS）对比：我们的 151 行是它的精简副本；pi 版为超集（多 `truncateLine`、`GREP_MAX_LINE_LENGTH`、无 Buffer 环境回退）。
- 行为比对（6 组用例：默认、`maxLines`、`maxBytes`、超长单行、双限同时命中、中文多字节）：head/tail 输出 JSON 全等；默认值 `2000/51200` 相同；`formatSize(50817)` 均为 `49.6KB`；pi 独有 `truncateLine`。

## 5. `@earendil-works/pi-coding-agent`：文件工具已是带接缝的库 API（0.80.6 与我们锁定版本对齐）

npm 事实：`@earendil-works/pi-coding-agent@0.80.6` 存在（MIT，`engines.node >=22.19.0`，与 pi 0.80.6 同 gitHead 家族），描述即「Coding agent CLI with read, bash, edit, write tools and session management」；最新 0.85.1（同样 Node 引擎，unpacked 21.9 MB）。依赖含 `pi-ai`/`pi-tui`/`pi-agent-core`/`typebox`/`diff`/`highlight.js`/`@silvia-odwyer/photon-node`(wasm) 等。

0.80.6 导出（`dist/core/tools/index.d.ts`，与 0.85.1 一致）：

- 工具定义/实例：`createReadToolDefinition`、`createWriteToolDefinition`、`createEditToolDefinition`、`createBashToolDefinition`、`createGrepToolDefinition`、`createLsToolDefinition`、`createFindToolDefinition`；`createTool(s)`、`createCodingTools`、`createReadOnlyTools`、`createAllTools`；`allToolNames = {read,bash,edit,write,grep,find,ls}`。
- **接缝（原文注释："Override these to delegate … to remote systems (for example SSH)"）**：
  - `ReadOperations { readFile(abs): Promise<Buffer>; access(abs): Promise<void>; detectImageMimeType? }`
  - `WriteOperations { writeFile(abs, content): Promise<void>; mkdir(dir): Promise<void> }`
  - `EditOperations { readFile(abs); writeFile(abs, content); access(abs) }`
  - 另有 `BashOperations`/`GrepOperations`/`LsOperations`/`FindOperations`/`PowerShellOperations`。
- 辅助：`withFileMutationQueue`（数据面互斥）、`generateUnifiedPatch`/`generateDiffString`（diff/patch 文本）、`truncate*`/`formatSize`（与 agent-core 同源）。
- tool schema：`read {path,offset?,limit?}`、`write {path,content}`、`edit {path, edits:[{oldText,newText}]}`（**oldText/newText 替换式，无 Codex apply_patch**）。
- 耦合：`edit.d.ts` 顶部 import `@earendil-works/pi-tui` 的 `Box`（渲染组件同模块），import 即带入 TUI 依赖树；0.80.6 的 `exports` 只有 `.` 与 `./rpc-entry`（无子路径工具入口），只能从包根 import。

## 6. OMP（`can1357/oh-my-pi`）侧事实

谱系：OMP 是 pi-mono 的 fork；移植指南明确上游 scope 含 `@mariozechner/*` **与 `@earendil-works/*`**（`omp://porting-from-pi-mono.md`，上游锚 `b21b42d…`，2026-03-22），即与我们仓库依赖同源、兄弟分支。

**文件编辑方法（OMP 自带文档 + 源码核查）**

| 工具 | 形态 | 规模证据 |
| --- | --- | --- |
| `edit` | 文档列 4 模式（hashline 默认 / apply_patch / patch / replace），**代码实为 5 种**（多 `sloppy`，`EDIT_MODE_IDS` 原文）；`apply_patch` 无独立工具名，经 `EditTool.customWireName` 暴露；TS 外壳 731 行（模式装配/流式预览/审批/写回），**真正引擎是 Rust** `crates/pi-edit`（≈320 KB：patch.rs 51KB/fuzzy 47KB/diff_string 44KB；`EditWriter` trait 为宿主写回接缝） | `src/edit/index.ts`、`crates/pi-edit/src/lib.rs` |
| `write` | 整文件/归档/SQLite/内部资源/`conflict://`；`bun:sqlite`、`Bun.file()` | `src/tools/write.ts` ≈1452 行 |
| `read` | 单 path 目标（文件/目录/归档/SQLite/URL/图片/文档）；主干 2937 行 + 一组支持模块（read-format 23KB、output-meta 24KB、sqlite-reader 31KB…） | `src/tools/read.ts` |
| `ast_edit` / `ast_grep` / `grep` / `glob` | 结构化改写（staged resolve/reject）；检索类走 Rust | 516 / 388 / 1601 / 561 行 |
| `lsp` rename、`checkpoint`/`rewind` | 符号重命名；文件快照回滚 | `BUILTIN_TOOL_NAMES` 28 项 + 3 隐藏 = 31 |

**发布与可复用性（决定性）**

- `@oh-my-pi/pi-coding-agent@18.2.5` 已发 npm（非 private，导出 `./edit`、`./tools`、`./tools/*`），但 **`import` 条件全部指向 `./src/*.ts` 原始 TS**，无 JS 产物；Node 无法执行（另有 Bun 专有 `.md` 文本导入、`bun:sqlite`、`Bun.file`）。
- 依赖闭包 ≈47 MB（含 pi-tui、puppeteer-core、otel、`@oh-my-pi/pi-natives`）；`pi-natives` 以 6 个平台包发布原生 `.node`（`EditSession`/`EditStore` 为 N-API 类，不可绕）。
- SDK（`omp://sdk.md`）是唯一程序化直调路径：`createAgentSession` / `BUILTIN_TOOLS.edit(session)`，前提 Bun ≥1.3.14 + `Settings.init()`（3523 行具体类）+ 原生 addon；RPC/ACP 只是把同一引擎包成进程/编辑器协议。
- 许可：MIT（Mario Zechner / Can Bölük / Stencil Labs），无障碍；阻碍在运行时而非法务。

**结论：OMP 的文件编辑能力不是可直接 import 复用的库**（Bun + Rust N-API 紧耦合、只发原始 TS、无版本兼容承诺）。与 `agent-kit`（Node/Bun 双跑、无构建、源码直出）定位不相容。

## 7. 选项与建议（`./file-tools`）

| 选项 | 内容 | 代价 |
| --- | --- | --- |
| A | 直接依赖 `@earendil-works/pi-coding-agent`，成员改为薄适配（注入 `*Operations` seam 做授权/互斥/记账/附件/输出） | 重量级依赖（21.9 MB 含 TUI/highlight.js/photon wasm）；`edit` 无 apply_patch；kit 由零依赖变依赖 pi |
| **B（建议）** | 只复用语义已冻结的**原语**：`pi-agent-core` 的 `truncate*`/`ExecutionEnv`/`executeShellWithCapture`；我们的工具接口**结构化对齐** pi 的 `*Operations`（readFile/writeFile/access/mkdir），宿主可注入 pi 实现或自研实现，但 kit 自身不 import pi | 需要一次接口对齐设计；`patch`（apply_patch）仍自研 |
| C | 维持自研 + 复制 | 重复维护（truncate 已是实例），上游修 bug 不会有收益 |

补充（scout 独立复核，结论收敛）：OMP 侧另有三条路径 —— 整体引入（推荐度低：47 MB 闭包 + 原生 addon + Bun-only）、**参考其 `crates/pi-edit` / `docs/tools/edit.md` 的协议语义自研**（推荐度中，唯一不牺牲 Node 兼容的路径）、**先自查 `@earendil-works/pi-coding-agent`**（该自查已由本报告 §5 完成：0.80.6 具备等价工具 + 注入接缝，但 `edit` 为 oldText/newText 替换式、无 apply_patch、模块耦合 pi-tui）。

结论：`patch`（Codex apply_patch）保留自研（产品已有 511 行）；若将来要 OMP 式行锚语义，可按 scout 的路径 B 参考 `crates/pi-edit` 的 hashline 协议自行实现，不引入 OMP 运行时。

补充：`truncate` 无论选哪条路都应停止自研副本 —— A 直接再导出、B 对齐行为并注明来源。

## 8. 未决问题

1. kit 是否允许**依赖** `@earendil-works/pi-*`（当前约定是「不得依赖」，证据表明至少 `truncate` 在重复造轮子）？
2. `./file-tools/patch` 的形态：继续 Codex apply_patch 自研，还是引入 OMP 风格 hashline（需先解决 Bun-only 与原生依赖）？
3. 是否在第二批成员开工前先做一次「上游覆盖度三分表」（复用 / 薄适配 / 自研）覆盖 package-map 全部候选成员？
4. `/sse/hub` 抽取时的策略 seam 具体形状（估字节、序列化、降级）——建 hub 前先出 API 形状简报。
