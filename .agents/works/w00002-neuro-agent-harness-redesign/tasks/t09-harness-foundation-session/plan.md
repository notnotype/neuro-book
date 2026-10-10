# t09 实施计划：`session` 模块与 JSONL 存储

## Context

- **为什么做**：内核重做的第一个模块（Work 切片 1）。`runtime`、`compaction` 与以后的 `nbook.agent` 插件都建在会话日志上：模型上下文、等待中的审批、崩溃收口和界面分页都从条目回放得出。
- **依据**：[`harness.session`](../../../../../docs/specs/harness/session.md)（`planned`，两轮 omp 设计审查后定稿）；[Agent harness 内核](../../../../../docs/proposals/agent-harness-kernel.md)（`accepted`）的“会话”“事件、推送与分页”“模块划分与推进顺序”。
- **开发者已确认的决定**：条目是 OMP 会话条目的子集、只追加、事件溯源；存储只定接口，附内存与 JSONL 实现；v1 打开会话时读入全部条目；分页按轮、截断大字段、按 id 取完整内容；审批只做恢复；v1 的压缩回放只用文本摘要。
- **工作方式**：worktree `.worktree/w00002-neuro-agent-harness-redesign`、分支 `feat/w00002-harness-kernel`，逐片提交，只暂存本片文件。主 Agent 编码；完成后交 omp（默认模型）只读审查。测试用真实存储与真实临时目录，不用 mock、spy、假计时器、固定等待；对验收映射做变异检查。

## 关键设计

### 1. 条目与校验（`src/session/entries.ts`）

- 用 TypeBox 写出 `SessionHeader`、`EntryInput` 各变体与五种保留类型（`harness/invocation`、`harness/interaction`、`harness/seed`、`harness/reminder`、`harness/profile-state`）的 schema，`Value.Check` 校验。公开类型由 `Static<>` 导出，消息类型引 `@oh-my-pi/pi-ai` 的 `Message`（`import type`），保证与 OMP 的 `SessionEntry` 结构兼容；`message` 条目的消息按 OMP 四种角色各自的必填字段校验（user、developer 的 `content`、`timestamp`；assistant 的 `api`、`provider`、`model`、`usage`、`stopReason`、`timestamp` 与 `content` 块类型；toolResult 的 `toolCallId`、`toolName`、`content`、`isError`、`timestamp`），可选字段与 OMP 以后新增的字段原样保存（计划审查第 1 条：`import type` 不查运行时，浅校验会让缺字段的消息写进日志）。
- “能被 JSON 如实表示”单独一个遍历：拒绝 `undefined`、函数、`NaN`、`Infinity`、`bigint`、循环引用与非普通对象，返回第一处问题的路径，作为 `invalid-entry` 的 `detail`。
- 与已有条目相关的规则（同一 `interactionId` 至多一个 request、response 在 request 之后、`assistantEntryId` 指向助手 `message`）由日志句柄维护的索引判断，按“这批之前的条目 + 这批前面的输入”逐条校验；任何一条失败整批不写。
- 条目 id：8 位十六进制随机数，与本会话已有 id 冲突时重取（OMP 的做法）；会话 id 缺省用 `crypto.randomUUID()`（全局对象，不引 Node 内置模块）。
- 写入前 `structuredClone` 输入、补 `id`/`parentId`/`timestamp` 后深冻结（输出 19）。时间戳取 `now()`，比上一条早时沿用上一条（输出 4）。

### 2. 日志句柄（`src/session/log.ts`）

- `createSession`、`openSession` 组装句柄；状态为 可写 / 有中断尾 / 损坏 / 已关闭（Spec 的状态表），用一个字段表示，不用多个布尔。
- `append`、`repair` 进同一条 Promise 链依次执行（Spec“并发”）；前一次失败不阻断后一次，损坏状态下后续操作直接返回 `log-broken`。
- 订阅：订阅者表按加入顺序保存；推送在 `append` 的 Promise resolve 之前同步完成。输出 9 的六条边界逐条实现：监听函数抛错只结束该订阅（`onEnd("listener-error")`）；监听函数里 `release` 从下一条起停推；监听函数里 `append` 进链尾，自然排在当前这批推完之后；监听函数里 `close` 让当前这批剩下的不再推；在关闭或损坏的句柄上订阅立即 `onEnd`。推送循环每推一条都重新检查订阅与句柄状态。
- 序号就是条目在 `entries` 中的下标加 1；`entries` 对外是同一个冻结数组的只读视图，追加时换成新数组（旧引用不变）。

### 3. 存储（`src/session/memory-store.ts`、`src/session/jsonl/jsonl.ts`）

- 内存存储：`Map<会话 id, {header, lines}>`，保存 JSON 文本而不是对象，使 `open` 读回的是 JSON 往返后的值，与 JSONL 一致（输出 5、18）。
- JSONL 存储（子入口 `./session/jsonl`，唯一用 `node:fs/promises` 的地方）：
  - `create`：`open(path, "wx")` 写会话头，`EEXIST` → `session-exists`，其它错误 → `store-failed`；不创建 `root`。
  - `open`：整读文件，按 `\n` 切行；最后一段不以换行结束就是中断尾（输出 6）；完整行逐行 `JSON.parse` 并按条目 schema 校验，失败给 `corrupt-session` 与行号（输出 7）；会话头 `version` 不是 1 → `unsupported-version`（输出 8）。
  - `append`：一批拼成一个字符串，`appendFile` 一次写入；出错 → `store-failed`。
  - `repair`：截到最后一个换行处（`truncate`）。
  - `list`：`readdir` 出 `*.jsonl`，逐个 `open`，损坏的跳过（输出 17）。
- 会话 id 的格式由日志与两种存储共同检查（防止路径穿越）。

### 4. 回放（`src/session/replay.ts`）

- `buildModelContext`：按输出 12 的五步实现。先确定本段历史与回放序列（种子、摘要、`firstKeptEntryId` 起的保留部分、其余），再按调用窗口配对工具调用与结果，最后改写被去掉调用的助手消息（去 `redactedThinking`、清思考签名、空消息整条去掉）。`custom_message` 转消息时种子按 `details.role`，其余为用户消息，都带 `attribution: "agent"`；摘要包成一段固定说明加摘要原文的文字（措辞参照 OMP 的 `compaction-summary-context.md`，写在本模块里）：不在运行时导入 OMP，因为 `pi-agent-core` 经 `pi-utils` 在导入时读 `.env`、改写 `Bun.env`（包 `AGENTS.md` 的 OMP 一节）。
- `sessionStatus`、`sessionSettings`、`fold`/`defineProjection`：各写成一个 `Projection`，内部用 `fold` 实现，保证与使用方自定义回放走同一条路径。
- `planRecovery`：找最后一个 `invocation`，判定是否未结束及其范围，按输出 16 的三类与收尾条目产生 `EntryInput[]`；不读句柄状态。

### 5. 分页（`src/session/paging.ts`）

- 先按“轮”的定义把条目切成轮（用户发出的 `message` 开始新一轮）。
- 截断按输出 21 列出的位置写成一张路径规则表，遍历条目时只对表内位置截断；按 UTF-8 截断时退到字符边界。截断结果的字节数用 `JSON.stringify` 后 `TextEncoder` 计算。
- 游标：`base64url(JSON.stringify({s: 会话 id, q: 下一页最后一轮之后第一个条目的序号}))`；解码失败、会话 id 不同、`q` 不在 `1..entries.length` 或不在轮的起点 → `invalid-cursor`。
- `readEntry`：按 id 查下标。

### 6. 公开入口（`src/session/session.ts`、`package.json`）

- `session.ts` 只做再导出与模块头注释（链接 Spec）。`package.json` 增加 `"./session/jsonl": "./src/session/jsonl/jsonl.ts"`。
- 测试共用的场景（同一组行为对两种存储各跑一遍）放在 `src/session/testing/store-scenarios.ts`，暂不作为子入口导出：只有本模块的测试使用。

### 7. 边界测试（`src/architecture.test.ts`）

- 不改：`session` 对 OMP 只有 `import type`，模块表已是这样登记。

## Spec 与文档改动

| 文档 | 改什么 | 片 |
|---|---|---|
| `docs/specs/harness/session.md` | 实现中发现 Spec 有歧义或错误时先改 Spec 再改代码；收口时加“实现合同”与三条证据标签 | 各片、S5 |
| `docs/specs/README.md` | 注册表“说明”列写一句范围并加“待晋升”；晋升为 `implemented` 由开发者批准 | S5 |
| `packages/nb-harness/AGENTS.md` | 只在模块规则变化时改（例如 `testing/` 子入口） | 按需 |
| 本 Task README | 每片完成后更新当前状态 | 各片 |

## 切片

| 片 | 内容 | 关键设计 | 自跑验证 |
|---|---|---|---|
| S1 | 条目与校验、内存存储、日志句柄（新建、追加、订阅、关闭、写入失败、不可变） | 1、2、3 的内存部分、6 | `bun test src/session`、`bun run typecheck`、`bun test src/architecture.test.ts` |
| S2 | JSONL 存储：打开、中断尾、损坏行、版本、修复、列出；两种存储跑同一组场景 | 3 | 同上 |
| S3 | 回放：模型上下文、会话状态与设置、自定义回放、崩溃收口 | 4 | 同上，另跑 OMP `Agent` 的配对场景 |
| S4 | 分页与按 id 读取 | 5 | 同上 |
| S5 | OMP 兼容（`prepareCompaction` 与压缩后回放）、Spec 证据、注册表、omp 只读审查 | 全部 | `bun test`、`bun run typecheck`、仓库根 `bun run governance:check` 与 `bun run docs:check` |

每片一个提交；实现与它的测试、它改到的 Spec 同片提交。

## 验收映射

| `harness.session` | 测试 |
|---|---|
| 输出 1–4、9–11、19；场景 1、2、5、12、13 | `src/session/log.test.ts`（内存与 JSONL 各一遍，场景 7） |
| 输出 5–8、17、18；场景 3、4、7、11 | `src/session/jsonl/jsonl.test.ts` |
| 输出 12；场景 9、10、14 | `src/session/replay.test.ts` |
| 输出 13、14、15、16；场景 6、8 | `src/session/recovery.test.ts`（场景 6 的末段用真实 OMP `Agent` 加自定义 `streamFn` 捕获发往模型的上下文，不联网） |
| 输出 20–22；场景 15、16 | `src/session/paging.test.ts` |
| 输出 23；场景 14 的 OMP 部分 | `src/session/omp-compat.test.ts`（真实 `prepareCompaction`，`remoteEnabled: false`） |
| 失败码表 | 各测试按失败码断言；每个失败码至少一处 |

## 验证

- 包内 `bun test`、`bun run typecheck`；JSONL 用 `@notnotype/neuro-book-test-support/tmp` 的 `createTestTmpRoot` 建真实目录与文件。
- 写入中途失败（场景 11）用一个遵守 `SessionStore` 接口的测试存储：委托 JSONL 存储，`append` 时先写入这批的前几行与半行再返回失败。这是使用方自定义存储的合法情形，不改产品代码。
- 变异检查：逐条破坏关键规则（不配调用窗口、不清签名、不检查跨会话游标、不按字符边界截断等），确认对应测试失败后恢复。
- 未验证边界：断电与操作系统崩溃（Spec 不承诺）；多进程同时写（Spec 不承诺）；真实模型请求（本模块不调用模型）。

## 不做与风险

- 不做：分支与重试的操作、按范围从文件读取、附件外置、会话删除与归档、远程原生压缩的回放、`runtime` 与 `compaction` 模块。
- 风险：OMP 18.2.5 的 `SessionEntry` 有我们不用的变体与字段，兼容只保证“我们的条目是它的子集”；OMP 升级改变条目形状时，`omp-compat.test.ts` 会先失败。
- 风险：`message` 条目只做浅校验，深层字段错误（例如工具调用参数不是对象）要到交给 OMP 时才暴露；目前按 Spec 处理，出现实际问题再收紧并先改 Spec。
