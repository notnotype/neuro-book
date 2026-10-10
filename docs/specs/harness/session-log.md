---
schema: nbook.spec/v1
kind: behavior
status: implemented
capability: harness.session-log
owners:
  - nb-session
---

# 会话日志（append-only）

## 目标与非目标

一个 Agent 会话的全部可回放事实（用户与助手消息、工具调用与结果、压缩摘要、元数据）按追加顺序写入一份只增不改的日志。调用方得到连续的序号，进程重启后能续写，写到一半被中断的尾部能被识别并显式修复，而不是被静默吞掉或把后续写入接在损坏字节后面。

明确不承诺：

- 不负责多进程同时写同一会话：同一会话文件同一时刻只允许一个日志实例写入，跨进程互斥由宿主负责。
- 不提供改写、删除单条条目或分支（树形会话）；压缩只追加一条 `compaction` 条目，旧条目仍保留。
- 不解释条目语义：消息怎么进入模型上下文、压缩条目怎么替换历史，归 [`harness.agent-turn`](agent-turn.md) 等使用方。
- 不提供会话列表、索引、删除或保留期管理。

## 术语与参与者

- **会话日志（SessionLog）**：一个会话 id 对应的一份有序条目序列及其读写句柄。
- **条目（entry）**：日志中的一条记录，`kind` 取 `message`、`tool_call`、`tool_result`、`compaction`、`meta` 之一。每条都带 `seq` 和 `at`。
- **入参（entry input）**：调用方追加时提供的条目内容，不含 `seq` 和 `at`，由日志打戳。
- **seq**：日志分配的序号，从 1 开始，每条加 1，同一会话内唯一且连续。
- **at**：日志打戳的 ISO 8601 时间字符串，同一日志实例内单调不减。
- **中断尾**：JSONL 文件中第一条无法解析为合法条目的行（包括没有以换行结束的最后一行）及其后的全部字节。
- **内存实现 / JSONL 实现**：同一接口的两种存储。内存实现只在进程内存中；JSONL 实现一会话一文件。

## 输入与前置条件

- 创建内存日志：提供会话 id，可选时钟函数。内存实现不校验会话 id 形状。
- 创建 JSONL 日志：提供根目录、会话 id 和可选时钟函数。会话 id 必须匹配 `[A-Za-z0-9._-]{1,128}`；根目录必须已存在且是目录，日志不会创建它。
- `append(inputs)`：一批入参，可以为空。每条入参的字段形状由 `kind` 决定：

| kind | 字段 |
|---|---|
| `message` | `role`（`user`、`assistant`、`system`）、`text` |
| `tool_call` | `callId`、`toolName`、`argsJson`（参数的 JSON 文本） |
| `tool_result` | `callId`、`isError`、`text` |
| `compaction` | `summary`、`replacedThroughSeq`（被摘要替换到的最后一个 seq） |
| `meta` | `key`、`value`（任意 JSON 值） |

- `read(options)`：可选 `sinceSeq`（只要 `seq` 大于它的条目）与 `limit`（最多返回条数）。
- 前置状态：JSONL 实现在创建时读取已有文件；文件不存在视为空会话。

## 输出与可观察行为

- `append` 返回本批打戳后的完整条目，顺序与入参一致；`seq` 紧接日志当前最后一条，批内连续；空批返回空数组且不写任何东西。
- `read` 返回按 `seq` 升序的条目；先按 `sinceSeq` 过滤，再取前 `limit` 条。空日志返回空数组。
- `tail` 返回最后一条条目，空日志返回 `null`。
- `repair` 返回 `{droppedBytes}`：截掉的中断尾字节数；没有中断尾时为 0。
- JSONL 文件格式：`<root>/<sessionId>.jsonl`，UTF-8，每行一个完整条目的 JSON 对象，每行以 LF 结束。条目对象字段为 `kind`、`seq`、`at` 加上表中该 kind 的字段。
- JSONL 实现的 `read` 与 `tail` 每次重新读取文件，因此能看到同一文件被其它实例追加的条目。

## 状态与转换

| 当前状态 | 事件 | 结果 |
|---|---|---|
| 健康（无中断尾） | `append` 成功 | 条目落盘，下一 `seq` 前移 |
| 健康 | 文件尾被外部写入不完整内容 | 下一次 `read`、`tail` 或 `repair` 读文件时识别为中断尾 |
| 有中断尾 | `read` / `tail` | 只返回中断尾之前的完好前缀 |
| 有中断尾 | `append` | 拒绝，文件不变 |
| 有中断尾 | `repair` | 截断到完好前缀，回到健康；返回截掉的字节数 |
| 健康 | `repair` | 无变化，返回 0（幂等） |
| 进程重启 | 用同一根目录与会话 id 重新创建 | 读回已有条目，下一 `seq` 接在最后一条之后 |

同一日志实例内，`append`、`read`、`tail`、`repair` 按调用顺序串行执行；前一个操作失败不阻塞后续操作。

## 副作用与数据

- 内存实现：只有进程内存，无文件、网络或外部副作用。
- JSONL 实现：只读写 `<root>/<sessionId>.jsonl` 一个文件。`append` 以追加方式写入一批条目（整批一次写调用）；`repair` 把文件截断到完好前缀。日志不创建、不删除根目录，也不删除会话文件。
- 数据 owner 是创建日志的宿主：文件的保留、备份、删除与跨进程互斥由宿主负责。

## 失败与恢复

- 会话 id 不合法（含路径分隔符、空串或超长）：创建被拒绝，错误信息含非法 id，不触碰文件系统。
- 根目录不存在或不是目录：创建被拒绝，错误信息含根目录路径。
- 存在中断尾时 `append`：拒绝并提示先调用 `repair`，错误信息含中断尾字节数与文件路径；文件不变。
- 写文件失败（磁盘满、权限等）：`append` 以底层错误拒绝；日志实例内的计数不前移。底层写调用本身部分写入时，残留字节在下一次读取时表现为中断尾，按上表修复。
- 恢复是显式的：日志不会自动截断中断尾，修复动作只发生在调用 `repair` 时，宿主可以先保留现场再决定修复。

## 边界与兼容

- 包 `@notnotype/nb-session` 只依赖 Node 内置模块，不依赖 NeuroBook 产品、OMP 或其它领域包；运行时要求 Bun 1.3.14 及以上（以 TS 源码作为包入口）。
- 会话 id 的字符集限制用来防止路径穿越；放宽它是兼容性变化。
- JSONL 行格式是持久化合同：新增条目 kind 或字段属于格式演进，读取方遇到不认识的 kind 会把该行视为中断尾。因此新增 kind 必须先让读取端认识它，再写入。
- 已知缺口（当前未保证，修复前不要依赖）：
  - 解析只检查必需字段的类型，不检查 `seq` 是否连续，也不检查 `meta.value` 的形状；人工编辑文件造成的 `seq` 跳号或重复会被原样读出。
  - JSONL 实现的 `append` 不重新读取文件，`seq` 以本实例最后一次读到的状态为准；两个实例同时写同一文件会产生重复 `seq`。这与“单写者”前提一致，但没有检测或报错。
  - 文件中间出现空行会被当作中断尾的起点。
  - JSONL 实现读文件时把所有错误（不只是文件不存在，也包括权限不足、路径是目录）都当作空会话：`read` 返回空数组、`tail` 返回 `null`，而不是报错。

## 验收与 Smoke

1. Given 新会话，When 先追加 1 条、再追加 3 条，Then 两次返回的 `seq` 分别为 `[1]` 与 `[2,3,4]`，`read` 返回 4 条且按 `seq` 升序。
2. Given 空日志，When `read` 与 `tail`，Then 得到空数组与 `null`。
3. Given 4 条条目，When `read({sinceSeq: 2})`、`read({limit: 2})`、`read({sinceSeq: 1, limit: 1})`，Then 分别得到 `seq` `[3,4]`、`[1,2]`、`[2]`。
4. Given `meta` 与 `compaction` 入参，When 追加后读取，Then 字段原样往返。
5. Given JSONL 日志写入 3 条，Then 文件恰好 3 个非空行、每行可解析、文件以 LF 结尾。
6. Given JSONL 会话已有 1 条，When 用同一根目录和 id 新建实例并追加，Then 新条目 `seq` 为 2，`read` 读回两条。
7. Given JSONL 文件尾被追加半行 JSON，When `read`，Then 只返回完好的条目；When `append`，Then 拒绝且提示中断尾；When `repair`，Then 返回的 `droppedBytes` 等于半行字节数，再次 `repair` 返回 0，之后 `append` 的 `seq` 接在完好前缀之后。
8. Given 会话 id `../escape` 或空串，或根目录不存在，When 创建 JSONL 日志，Then 拒绝。
9. Smoke：在包目录运行 `bun examples/jsonl-log.ts`，输出追加、重开续写、中断尾修复三个阶段的结果并以 0 退出。

## 实现合同

- **owner**：`packages/nb-session`（`@notnotype/nb-session`）。使用方 [`harness.agent-turn`](agent-turn.md) 通过 `SessionLog` 接口写入，不感知存储实现。
- **公开接口**：包根导出 `createMemorySessionLog`、`createJsonlSessionLog`、`SessionLog`、`SessionReadOptions`、条目与入参类型、`SESSION_ID_PATTERN`、`isValidSessionId`。逐项说明见包内 [API 参考](../../../packages/nb-session/docs/api.md)。
- **关键不变量**：
  - 每个实例有一个串行队列，所有操作都经过它；队列中前一个任务失败不影响后续任务。
  - 时钟把 `now()` 的结果钳制为不早于上一次，保证 `at` 单调不减。
  - JSONL 扫描从文件头开始逐行解析，遇到第一条不可解析的行或没有 LF 结尾的行就停止；完好前缀的字节数决定 `repair` 的截断点。
  - 存在中断尾时 `append` 必须拒绝，不能把新条目接在损坏字节之后。

## 证据

- 实现入口：[`jsonl-log.ts`](../../../packages/nb-session/src/jsonl-log.ts)、[`memory-log.ts`](../../../packages/nb-session/src/memory-log.ts)、[`entries.ts`](../../../packages/nb-session/src/entries.ts)
- 合同测试：[`session-log.test.ts`](../../../packages/nb-session/tests/session-log.test.ts)
- Smoke：[`examples.test.ts`](../../../packages/nb-session/tests/examples.test.ts)（运行 [`examples/jsonl-log.ts`](../../../packages/nb-session/examples/jsonl-log.ts)）
- 批准依据：2026-09-18 开发者批准以 OMP 为底座重建 harness 并拆出 nb-session（[w00002 Work](../../../.agents/works/w00002-neuro-agent-harness-redesign/README.md)）；实现见 [t06](../../../.agents/works/w00002-neuro-agent-harness-redesign/tasks/t06-nb-harness-rebuild/README.md)，本规范由 [t07](../../../.agents/works/w00002-neuro-agent-harness-redesign/tasks/t07-harness-specs-and-docs/README.md) 按代码与测试补写。
