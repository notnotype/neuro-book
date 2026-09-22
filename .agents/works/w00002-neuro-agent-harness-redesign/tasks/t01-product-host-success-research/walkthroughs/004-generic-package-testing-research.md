# 通用包测试治理与两领域试点研究

> Task：`t01-product-host-success-research`；生成者：Leader（Agent）；日期：2026-09-11。
> 本材料为研究草案 + 试点证据，**不是** Proposal/Spec，也不修改任何源码。
> 证据方式：两次只读取证（`agent://SseDomainScout`、`agent://WriteEditToolsScout`）+ `docs/testing/README.md` + `packages/neuro-book/assets/reference/agent/sse.md`。**未运行任何测试/构建**：以下结论均为静态阅读所得；行数为实测读取值。

## 1. 现状事实（执行摘要）

### 1.1 仓库测试治理基线（`docs/testing/README.md`，代码事实）

- 临时根统一 `<系统Temp>/neuro-book/vitest/<runId>/`，由 `@notnotype/neuro-book-test-support/vitest` 的 setup/globalSetup 指定；每个 Vitest 配置的 `setupFiles` 第一项必须是该 setup，`globalSetup` 必须包含该 globalSetup。
- 测试必须清理自己创建的目录；废弃根由 `sweepStaleTmpRoots()` 按 owner marker + 24 小时窗口回收；禁止在仓库根、`.worktree/`、快照目录或系统 Temp 根直接写业务临时数据。
- 测试文件与被测源码同目录、命名 `<module>.test.ts`（JSX 用 `.test.tsx`）；配置显式声明 `root`；全量测试统一 `bun run test`（node 运行时）；**新测试目录必须加入对应配置的 `include`**；测试导入使用与源码一致的 `nbook/*` 别名。
- 平台差异用 `it.runIf/skipIf(process.platform === ...)`；CI 与本地同一套配置。
- 验证门禁按改动类型分级；未运行项要区分报告；提交前 `git diff --cached --check`。

### 1.2 SSE 领域（证据摘要）

**代码事实**

- 独立包 `packages/neuro-agent-harness`：`src/sse.ts`（54 行，WHATWG 帧序列化纯函数，固定 event/id/retry/data 顺序、多行 data、CR 校验）；`src/events.ts`（557 行，`SessionEventHub`：replay 默认 500 条/4MiB、live 128 条/1MiB、epoch 随机、count+bytes 双预算、`closeReason = consumer_closed | queue_overflow | hub_closed`、cursor epoch admission）；`src/event-publication.ts`（231 行，durable commit publication：generation fence、batch 原子 staging、因果守卫失败改发 `snapshot_required(commit_order)`）。三者均**无领域依赖**。
- 产品 `packages/neuro-book/server/agent/`：`events/session-event-hub.ts`（488 行，`AgentSessionEventHub`：同款 replay/live 预算、payload 超 `maxEventBytes`(128KiB) 同 seq 降级 `snapshot_required`、`pinReplayFrom/canReplayFrom/replayFloorSeq`；**帧不带 `id:` 字段**，序号在 JSON `seq`）；`events/agent-sse-writer.ts`（135 行，**已完全领域无关**：设置 event-stream/cache/keep-alive/x-accel-buffering 头、一次一帧、`write(false)` 等 drain、close/error/abort 竞争、finally 清理）；`jobs/agent-job-event-hub.ts`（**第三份**同构 hub 实现）；`events/public-*.ts` 投影族（377 行起，耦合 Pi 与产品 DTO）；前端 `app/utils/http/read-sse.ts`（170 行解析器）、`sse-reconnect-backoff.ts`（45 行，300/800/1500/3000/5000ms，稳定 5s 重置）、`useAgentSession*.ts`（766/507 行 reducer 与 single-flight 恢复）。
- 恢复语义：订阅以 `(eventEpoch, after)` 表达断点；缺 epoch 的非零 cursor、epoch 不一致、after 超前、replay 过期都只发 `snapshot_required` 且不 replay；`snapshot()` 返回不晚于 durable projection 的 cursor（ADR-0023 允许 overlap，去重是消费者职责）。
- **全仓 SSE 路径无 heartbeat 实现**；`serializeSseComment` 只有独立包定义并导出，产品未用。
- 测试（独立包，bun:test）：`sse-serialization`(44)、`sse-transport-consumer`(155)、`sse-http-transport`(69)+子进程 fixtures(112+326，Bun.serve 服务 + Node http 真实客户端、Last-Event-ID 续传、错误 epoch 409、Windows taskkill 回收)、`events.test`(552)、`event-cursor-epoch-admission`(47)、`persistence-events`(1300) 等。
- 测试（产品，vitest）：`session-event-hub.test.ts`(509)、`agent-sse-writer.test.ts`(197，FakeResponse 单测 + 真实 paused socket 断言 writableLength<256KiB)、`agent-job-event-hub.test.ts`(145)、`jobs/events.get.test.ts`(63)、前端 `read-sse.test`(147)、`sse-reconnect-backoff.test`(42)、`useAgentSession.test`(354)、`useAgentSessionStream.test`(1063)。
- 明显缺口：① session SSE 路由 `server/api/agent/sessions/[sessionId]/events.get.ts` **无专属测试**（jobs 路由有）；② 无 heartbeat 实现与测试；③ 无浏览器 EventSource、无代理/网关、无无限保持流的验证；④ 跨进程 hub 未验证；⑤ hub `close()` 清空 `seqBySession`，而产品恢复 DTO 依赖 hub 存续——该组合未测试。
- 文档漂移：`assets/reference/agent/sse.md` 的 Envelope 片段不含 `eventEpoch`，而 `shared/dto/agent-session.dto.ts` 的 DTO 必带；`Last-Event-ID` 只在独立包 fixture 使用，产品走 query `eventEpoch`+`after`。

**可通用化判断**：`sse.ts`、`events.ts`、`event-publication.ts`（独立包）与 `agent-sse-writer.ts`（产品）可领域无关化；产品两个 hub 与投影族需参数化（`maxEventBytes`、DTO 泛型化）后通用化；三处 hub 是**最明显的重复抽取点**。

### 1.3 write/edit 工具领域（证据摘要）

**代码事实**

- 产品实现（`packages/neuro-book/server/agent/tools/`）：`file-tools.ts`(863，read/write/edit/apply_patch/bash 五件套)、`apply-patch.ts`(511，Codex patch 解析/校验/规划/全量写 + 失败逆序回滚)、`tool-registry.ts`(89，注册与审批/写标记派生)、`approval.ts`(146)、`truncate.ts`(151，纯函数：2000 行/50KiB)、`types.ts`(272)、`file-tool-utils.ts`(47)、`output-accumulator.ts`(180)、`bash-output-store.ts`(325，lease/TTL/容量回收)。
- 合同要点：read 并行执行、`truncateHead`、图片经 attachment codec（不落 base64）；write 覆盖写 + mkdir -p；edit 精确多编辑预检（非空、唯一匹配、两两不重叠，全部通过才写，返回 diff）；apply_patch 先对全部目标授权、`VirtualFileState` 规划后逐写、失败逆序回滚（跨文件非真原子，rollback 尽力）；bash 走 `authorizeProcessCwd`、输出 `truncateTail` 超限暴露 `bash-output://` locator。
- 领域 seam（抽取时必须注入）：路径授权 `workspace-files/authorized-file-operation`、数据面互斥 `workspace-files/project-data-plane-guard`（按 workspace key 排序取锁防死锁）、写历史记账 `workspace-history/agent-file-recorder`、读取上下文记账 `context-access`、附件 codec、`message-utils.normalizeToolResultDetails`、`types.ts` 对 `NeuroAgentHarness`/`ToolSessionWriteSink` 等的依赖、`runtimePaths`。
- 测试（产品 vitest）：`file-tools.test.ts`(1041，真实 fs)、`file-tools.owned-process.test.ts`(71，mock owned-process 验 timeout/abort 终态分类)、`file-tools.output-cleanup.test.ts`(154，mock 输出收集器验异常路径仍关闭临时输出)、`apply-patch.test.ts`(54，仅路径提取)、`approval.test.ts`(264)、`builtin-tools-smoke.test.ts`(31)。
- 对照：独立包**没有任何 write/edit 实现**，只有 `tool.ts`(95)、`read-tool.ts`(76，Capability 外置授权/文件系统)、`capability.ts`(138)，测试用 bun:test；其 `ToolResult.content` 是 `string`，与产品的 `StoredContent[]` 模型不同。
- 缺口：write 无独立测试文件；无只读模式写审批注入的端到端测试；`apply-patch` 缺解析边界单测；无同文件并发写竞争测试；`truncate.ts`/`file-tool-utils.ts` 无专门单测；文档与实现冲突（`assets/reference/agent/workspace-tool-use.md` 称 apply_patch 不要传 JSON，而实现与测试均走 JSON `{patch}`）。
- 未发现 write/edit 的 Spec（`docs/specs/agent/` 只有 session-store-lease、session-abort、asset-install-runtime）。

## 2. 测试治理规范草案（`D-TEST-01` 候选）

> 2026-09-11 开发者补充方向：**TDD**；**只测关键、不追求数量**；**smoke 测试很重要**；**允许测试做真实 LLM API 调用**（DeepSeek，凭据在 `.env`）。本草案已并入这些约束。
> 以下为候选草案，供开发者判断；每节都尽量给出证据来源。

### 2.0 方法论与克制原则（开发者输入）

- **TDD**：新行为先写失败测试（RED）→ 最小实现（GREEN）→ 重构；bug 修复先写复现测试（Prove-It），确认失败后再修。测试是验收证据，不是事后说明。
- **只测关键**：覆盖合同、边界、失败与恢复、并发、资源释放与安全边界；不写镜像实现细节、措辞或框架行为的测试；不为可逆小改动强制测试（与根 `AGENTS.md` 一致）。
- **Smoke 必测**：每个包至少一条 smoke——构建产物可导入 + 一条最小真实路径（如帧序列化往返、一个工具在临时目录完成一次写读）。
- **真实 LLM API（禁止 mock 模型数据）**：测试若需要 LLM 响应，直接调用真实 DeepSeek——**不要 mock LLM API 数据**；变量 `DEEPSEEK_API_KEY`（可选 `DEEPSEEK_API_BASE`，默认 `https://api.deepseek.com/v1`）；凭据只放 `.env`（已被 `.gitignore` 忽略），不得入库、不得打印、不得进入错误正文或用例名。

### 2.1 分层与边界

| 层 | 内容 | 允许依赖 | 现有例子 |
| --- | --- | --- | --- |
| L1 纯函数单元 | 序列化、截断、解析、路径提取 | 无 IO | `sse-serialization`、`truncate`（缺专测） |
| L2 公共合同 | 公共 API 行为、schema 拒绝、错误分类、返回值形状 | 无 IO 或内存假件 | `read-tool-factory`、`event-cursor-epoch-admission` |
| L3 组件集成 | hub/store/事件循环、预算溢出、恢复语义、并发与顺序 | 内存 store、脚本化运行时 | `events.test`、`session-event-hub.test` |
| L4 进程与真实 IO | 真实 socket/子进程/真实 fs、backpressure、回收 | 真实进程、临时根 | `sse-http-transport`+fixtures、`file-tools.test`、`agent-sse-writer` 真实 socket |
| L5 宿主验收 | 路由、鉴权、代理、浏览器、部署 | 宿主环境 | 属宿主，不进通用包 |

规则候选：通用包**必须**具备 L1–L3；L4 必须覆盖"进程/IO 边界存在"的部分（至少 1 条真实路径）；每包另必须有 1 条 smoke（构建/导入 + 最小真实路径，见 §2.0）；L5 明确不属于包。

### 2.2 每个包必测的关键面（最小集合）

> 只测关键：以下是必测的最小集合；以"能证明行为的最少测试"为先，不为覆盖更全而扩张。

1. 公共 API 往返与形状（序列化/反序列化、schema 校验、拒绝非法输入 fail-closed）。
2. 边界与上限（字节/条数/行数预算、超限降级或显式报错）。
3. 生命周期与资源释放（订阅关闭、监听器清理、临时文件关闭、close 后语义）。
4. 并发与顺序（多订阅者 FIFO、publish 不可变性、锁序、批量原子性）。
5. 恢复与重放（cursor/epoch/gap → 恢复信号；overlap 去重责任）。
6. 错误分类（可重试/不可重试、终态映射，如 timeout/abort 分类）。
7. 平台分支（路径语义、spawn/信号、CRLF，`runIf/skipIf`）。

### 2.3 放置、命名与运行方式

- 包内与被测源码同目录 `<module>.test.ts`；每个包自己的测试配置显式声明 `root`，并纳入根 CI 的 include 或等价清单。
- 导入一律包内相对或包名导入；**禁止** `nbook/*` 等产品别名。
- 运行器候选：与仓库一致用 **vitest + node 运行时**（`docs/testing` 的既有结论：`bun --bun` 有 interop 差异）；旧包的 `bun:test` 视为历史，不扩散。
- 每个包必须能独立执行：`bun run --cwd packages/<pkg> test`（或包内脚本名）并且失败可定位。

### 2.4 临时根与 fixture

- 复用 `@notnotype/neuro-book-test-support`（**仅 devDependency**）：通用包不得在运行时依赖它；包若要离开本仓，需自带等价物（记为已知边界）。
- 测试自清理；子进程 fixture 必须有明确的终止与回收（SSE fixture 的 Windows taskkill 是正面例子）；禁止写仓库根与业务目录。

### 2.5 真实 LLM API 测试（DeepSeek，开发者允许）

- 变量：`DEEPSEEK_API_KEY`（运行环境提供），`DEEPSEEK_API_BASE` 可选（默认 `https://api.deepseek.com/v1`）；与产品既有模板约定一致（`packages/neuro-book/server/utils/app-config.test.ts`、`env-template.test.ts` 已使用这两个变量名）。
- 凭据来源：仓库根 `.env`（`.gitignore` 已忽略 `.env`/`.env.local`）或 CI secret；测试只读环境变量，不落盘、不打印、不进错误正文与用例名。
- **范围（开发者规则，2026-09-11）：不要 mock LLM API 数据。** 测试只要需要 LLM 响应，就直接调用真实 LLM（DeepSeek）；假件只用于完全不涉及 LLM 的层（纯函数、hub、工具 seam）。
- 运行约定（已定）：显式声明单次调用上限与超时；断言结构化结果（HTTP 状态、字段形状、finish 原因），不断言措辞；缺凭据时 **skip 并在汇总中记录未运行**（skip 的用例在 Task 证据中计为"未验证"，不得写成通过）。
- 归层：属 L4/冒烟层，不进日常快速回路。

### 2.6 CI 与证据

- 门禁候选：包测试 + 该包 typecheck + `diff-check`；未运行项写明原因；`focused 通过 ≠ 全量通过`。
- 发布准备（当包出现外部消费者时再加）：`tsc -b` 构建 + pack smoke（旧包已有 `pack:smoke` 先例）。

### 2.7 与 `docs/testing/README.md` 的关系（候选）

- 在 `docs/testing/` 下**扩展一节"通用包测试合同"**，不在包内维护第二份正文；包 README 只链接。

## 3. 试点 A：SSE 能力

### 3.1 领域耦合与可通用化清单

- 已领域无关（可直接作为抽取来源）：独立包 `sse.ts`/`events.ts`/`event-publication.ts`；产品 `agent-sse-writer.ts`。
- 需参数化：产品 `session-event-hub.ts`（`maxEventBytes`、DTO → 泛型 payload）、`agent-job-event-hub.ts`（同构去重）。
- 必须留在宿主：HTTP 路由与鉴权、DTO 投影族、前端 reducer、heartbeat（当前不存在，需显式决定"不服务"或实现）。

### 3.2 候选包边界（`D-SPLIT-01` 试点部分）

- 候选 S1（建议）：**领域级单包 + subpath 模块导出**，例如 `agent-sse` 暴露 `frame`（序列化/解析）、`hub`（有界 replay/live、cursor/epoch、预算降级）、`writer`（backpressure 写帧）三个子路径；三处重复 hub 合并为一份实现，产品侧通过参数化接入。
- 候选 S2：更细（frame/hub/writer 各自成包）——解耦最大、包与版本维护成本最高。
- 候选 S3：更粗（与 write/edit 合成一个包）——包最少、复用边界模糊。
- 基线来源问题：SSE 的独立包实现已领域无关且带测试；产品实现耦合 DTO。若从零重写（严格"从 NeuroBook 抽"）会丢掉这部分现成资产，建议在 `D-SPLIT-01` 中一并决定"SSE 基线取独立包实现还是产品实现"。

### 3.3 测试矩阵（按 §2.2）

| 合同面 | 层 | 现有覆盖 | 缺口 → 建议 |
| --- | --- | --- | --- |
| 帧序列化/解析 | L1 | `sse-serialization`(44)、前端 `read-sse.test`(147) | 补 CR/LF、多行 data、128KiB 上限的共享断言 |
| hub 预算与降级 | L3 | `events.test`(552)、`session-event-hub.test`(509) | 合并后需保留两套断言；补"降级后 seq 不推进"的跨实现对照 |
| cursor/epoch admission | L2/L3 | `event-cursor-epoch-admission`(47) + 产品 16 条 | 补 hub `close()` 后恢复语义（scout 标注未测） |
| 恢复循环（宿主消费） | L3 | `sse-transport-consumer`(155) | 抽包后作为通用消费侧合同测试保留 |
| 真实 socket/HTTP | L4 | `sse-http-transport`(69)+fixtures | 明确 `Last-Event-ID` 与 query cursor 两条路径的归属；无限保持流列为 known gap |
| backpressure | L4 | `agent-sse-writer.test`(197，真实 paused socket) | 补 drain 期间 close 竞争 |
| 包 smoke | L4 | 无（包尚未建立） | 新增：构建产物可导入 + 序列化往返 + 1 条真实 socket 往返 |
| heartbeat | — | 无 | 显式决定：实现 + 测试，或声明"不服务"并写入合同 |

### 3.4 示例测试设计（1 条，可运行形态）

- **hub 超预算降级**：构造 payload 超 `maxEventBytes` 的 publish，断言：①订阅者收到同 seq 的 `snapshot_required`，②seq 不推进，③后续正常事件 seq 连续；再构造慢消费者阻塞，断言 live 队列溢出时 `closeReason=queue_overflow` 且不泄露缓冲。目标层 L3，依赖仅内存 store 与假订阅者。

## 4. 试点 B：write/edit 通用工具

### 4.1 领域耦合与 seam 注入候选

| seam | 现状实现 | 注入后的通用合同候选 |
| --- | --- | --- |
| 路径授权 | `authorizeFileOperation`/`authorizeProcessCwd` | `AuthorizePath(op, path) → resolved target | reject` |
| 数据面互斥 | `project-data-plane-guard`（按 workspace key 排序） | `withFileMutation(target, fn)` 由宿主提供 |
| 写历史记账 | `agent-file-recorder` | `onFileChange(change)` 回调（best-effort） |
| 附件 | attachment codec + 图片策略 | `AttachmentSink`（read 图片路径） |
| 输出存储 | `bash-output-store`/`output-accumulator` | `OutputSink`（bash 输出持久化与 locator） |

其余（`truncate.ts`、`file-tool-utils.ts`、`tool-registry.ts`、`apply-patch.ts` 的解析/规划）近乎领域无关，可直接迁出。

### 4.2 候选包边界（`D-SPLIT-01` 试点部分）

- 候选 W1（建议）：**领域级单包 + subpath 模块导出**，例如 `agent-file-tools` 暴露 `truncate`、`patch`（解析/规划/回滚）、`tools`（read/write/edit 的 schema + 执行体，经 §4.1 seam 注入）；bash 是否纳入另定（其依赖进程托管与输出存储）。
- 候选 W2：更细（truncate / patch / tools 各自成包）。
- 候选 W3：更粗（与 SSE 合并）。
- 边界注意：`edit`/`apply_patch` 的结果模型（`StoredContent[]` + `details`）需与独立包的 `string` 模型对齐后再定合同。

### 4.3 测试矩阵（按 §2.2）

| 合同面 | 层 | 现有覆盖 | 缺口 → 建议 |
| --- | --- | --- | --- |
| 截断/工具函数 | L1 | 借道 `file-tools.test.ts` | 给 `truncate`/`file-tool-utils` 建专测 |
| read 合同 | L2/L3 | `file-tools.test.ts` 大量 | 抽出后补"越权路径拒绝"的 seam 级断言 |
| write 合同 | L2/L3 | 混在 `file-tools.test.ts` | 独立测试文件；补只读模式写审批注入的端到端用例 |
| edit 预检 | L2 | 已有（重复/重叠/整体不写） | 抽包后保留为合同测试 |
| apply_patch | L1/L2 | 仅路径提取(54) | 补解析边界单测；补"跨文件失败逆序回滚、无部分写"的注入式测试 |
| bash 输出/进程 | L3/L4 | owned-process(71)、output-cleanup(154) | 抽包后作为边界合同保留 |
| 包 smoke | L4 | 无（包尚未建立） | 新增：构建产物可导入 + 临时目录 write→read 往返 |
| 并发写同文件 | L3 | 无 | 新增：注入式锁 or 断言宿主互斥被调用 |

### 4.4 示例测试设计（1 条，可运行形态）

- **apply_patch 跨文件失败回滚**：注入 fake fs 记录写序列与 fake 授权（全部通过），让第二个文件写入抛错，断言：①第一个文件被回滚（逆序），②无残留部分写，③错误分类为工具错误且不吞掉失败文件信息。目标层 L2/L3，依赖注入 seam 即可，无需真实 fs。

## 5. 未检查项与边界

- 未运行任何测试/构建；scout 为静态阅读；两份 scout 报告各自列了未读完文件清单。
- 文档/代码漂移两处：`sse.md` Envelope 缺 `eventEpoch`；`workspace-tool-use.md` 与 apply_patch JSON 参数实现冲突。
- 未确认：测试运行器从 `.env` 读取变量的接线方式（`bun run test` 走 node 运行时，Bun 不会自动加载 `.env`；需要显式 loader 或 CI secret）。
- 未验证：跨进程 hub、浏览器 EventSource、代理/网关、生产部署、无限保持流。
- 本材料不代表包边界终稿；`D-SPLIT-01` 的包名、粒度与基线来源均待开发者判断。

## 6. 来源

- 仓库治理：`docs/testing/README.md`；`packages/neuro-book/assets/reference/agent/sse.md`；`docs/specs/agent/session-abort.md`。
- 只读取证报告：`agent://SseDomainScout`、`agent://WriteEditToolsScout`（含逐文件清单、行数与缺口判断）。
- 关键文件：`packages/neuro-agent-harness/src/{sse,events,event-publication,tool,read-tool,capability}.ts`；`packages/neuro-book/server/agent/{events,session,jobs,tools}/**`；`packages/neuro-book/shared/dto/agent-session.dto.ts`；`packages/neuro-book/app/utils/http/read-sse.ts`。
