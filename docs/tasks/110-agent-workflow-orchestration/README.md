# Task 110 · Agent Workflow 编排系统

- 状态：**设计定稿（脚本式）；spike 验收全绿；已完成初步接入（2026-07-20）——内核 vendor 进仓，跑在真实 session 层上，preview demo 页可用**
- Spike 仓：`C:\Users\notnotype\Documents\CodeRepository\GithubProjects\nb-workflow`（sibling 仓，真相源；`bun run sync:nb-workflow` 镜像到 `server/vendor/nb-workflow/`）
- 日期：2026-07-19 设计与 spike；2026-07-20 初步接入
- 相关：`reference/agent/sidecar-profile-pass.md`、`docs/agent/tools.md`、`server/agent/tools/agent-collaboration-tools.ts`、`server/agent/harness/neuro-agent-harness.ts`（invokeCore/runLoop/runSidecarPasses）、`server/agent/session/session-repo.ts`（forkSession/moveLeaf）、`server/world-engine/codeact-sandbox.ts`、`docs/drafts/TODOS.md`（invoke_workflow / 非阻塞 invoke / workflow 三条待办）

## 用户需求

三个驱动场景：

1. **拆书**：全文太长，一次读效果差。需要 leader 派发：小模型逐章摘要 → 高性能模型基于 brief 分析剧情（隔离文风干扰）→ 人工圈选好章节后高性能模型提取文风/手法/铺垫。
2. **写作流水线**：剧情规划 → writer 写正文 ↔ critic 批判循环 → 更新 World Engine / 文件。现由 leader 提示词手动追踪，约束弱、耗 leader 上下文。
3. **Sidecar 迁移**：现有 `SidecarProfilePass` 耦合在 harness 内（prepareRun/settleRun 两固定 stage + merge 四路输出 + keyed report 协议）。应下沉为 workflow 对 session 的 rewind/fork/append 普通操作。

功能要求（用户原话要点）：

- 与 World Engine 同思路的 code act：agent 既可单发工具，也可写代码组合工具（结果直接流转，不经模型转述）。**本任务不统一 code act 工具**，但 workflow 是统一 code act 的探索场。
- `invoke_agent` 已是通用原语，workflow 用 JS 直接调它；补上 session 操作原语以实现 sidecar。
- 人类可参与、可观测、session 可缓存（尽量可恢复）。参考：LangGraph、n8n、Claude Code。
- 调用方自己也能成为被编排的一部分。

## 核心定位

> **Workflow 是一段跑在服务端的 JS 编排脚本，把既有 agent 原语（invoke / create / checkout / append / fork）当宿主 API 调用；它自己以 session 形态存在，因此持久化、可观测、可恢复、可被再编排全部复用既有设施。**

与 World Engine 同构：`execute_world(code)` 组合 `world.*`；workflow 组合 `wf.agents.* / wf.sessions.*`。

## 已拍板

- **脚本式，不引入 LangGraph 图模式**（2026-07-19 用户确认）。理由四条：run-as-session 复用架构 / sidecar 需求本质命令式 / 作者是模型（code act 路线）/ 脚本可作未来可视化编辑器的编译目标（表达力不可逆）。
- 向 LangGraph 吸收的三个语义能力：journal entry 可编辑的 time-travel、挂起点 replay 恢复、fan-out 一等公民。

## V1 收敛（2026-07-19 第四轮，以本节为准）

用户裁定：第一版保持核心并简单，满足三个实际场景可用即可。后文各节为完整愿景记录，实施以本节范围为准。

### V1 保留

- `wf.args` / return + argsSchema / resultSchema
- `wf.agents.profile / create / acquire / invoke`；`wf.sessions.open`
- `SessionHandle` 六原语：`transcript / leaf / checkout / append / invoke / excursion`
- `wf.all`、`wf.map(items, fn, { concurrency })`（仅 failFast，失败脚本内 try/catch）
- `wf.ask / wf.log / wf.progress`；`wf.workspace.read`（journaled，超限 contentRef，无 hash 校验）
- Journal：序号 + 参数指纹，**只做同 run 恢复**（崩溃 / ask 挂起续跑）；改脚本重跑 = 新 run，不继承缓存
- 面 A（UI 触发）+ 面 B（`run_workflow`，仅 workflowKey）
- V1 脚本内直接禁用非确定性（无 wf.random/now）

### V1 砍掉 / 推迟（V2+）

`wf.step / retry / sleep / race / timeoutMs / random / now`；`rewind / label / tree / fork` 便捷层；map 的 `key` 与 `collect`；子 workflow；`phases` 骨架；AST 图；journal entry 编辑与 fork-run 迭代；workspace hash 校验；retain 三态（简化为 create 的 `ephemeral: true` 布尔，run 结束归档）；capability 三规则（简化为：可 open = 自己 create/acquire 的 + args 传入的）；跨 run 缓存；**面 C（profile 挂载 / sidecar 迁移）**——六原语已证明 sidecar 可表达，迁移等 A/B 跑稳后作独立任务（建议，待确认）。

### 持久参与者（第 3 场景，推翻上版 archiveOnSuccess 默认）

模型翻转：**session 是持久一等公民，workflow 是无状态 conductor，每次 run 借用、用完归还。**

- 新原语 `wf.agents.acquire({ profileKey, tag, parent? })`：按 (project, profileKey, tag) 查未归档 session，找到复用，没有才 create（tag 写入 meta.tags）。跨 run 稳定。
- RP 回合形态：acquire leader → invoke prompt(用户输入) → map acquire+invoke 各 actor（parent: leader）→ leader followup 汇总。run 之间用户可直接与 leader 普通对话，下轮 acquire 到的还是它（含单聊历史）。
- 锁：workflow 持 session 排它锁期间用户消息被拒（"正在模拟中"）；反向 acquire 遇用户占用则等待/报忙。
- journal 恢复不与持久 session 冲突：已完成 invoke 按记录返回，不在目标树上重复发。
- 归属：acquire 的既有 session 不挂 run 子树；新建的按 `parent` 挂。

### Session meta 整理（本任务顺手做）

现状 header：`sessionId / profileKey / initial / workspaceRoot / workspaceKey / projectPath? / parentSessionId? / createdAt / title? / summary? / systemRole?:"summarizer"`；reduce 态另有 `model / thinkingLevel / customState / linkedAgents / archived / agentMode / title / summary`。

- 加 `kind: "chat" | "workflow" | "system"`（默认 chat）；`systemRole` 并入 system 细分并废弃（不做兼容）；列表隐藏按 kind。
- 加 `tags: string[]`（acquire 寻址 + UI 过滤）。
- 已知债标注不动：title/summary header 种子与 reduce 双轨（权威在 reduce）。

## 对象模型

| 对象 | 是什么 | 载体 |
|---|---|---|
| WorkflowDefinition | 脚本 + 元数据（key、`argsSchema`、`resultSchema`、`phases` 声明骨架） | `.nbook/agent/workflows/<key>.workflow.ts`，镜像 profile 的 builtin/用户两层 |
| WorkflowRun | 一次执行，**本身是 session**（`kind:"workflow"`），步骤即 entry | 现有 JSONL session 仓储 + session tree |
| Activity | 每次 `await wf.*` 副作用调用，记入 journal | run session 的 `workflow_step` entry 族 |

## 脚本 API（宿主注入 `wf`）

### Session 调度：统一游标语义

append-only 树上真原语只有两个：**`checkout(entryId)`**（= moveLeaf）与 **`append(msg)`**。rewind = checkout 到祖先；**分支没有创建 API**——checkout 非端点后 append 自然开叉（git detached HEAD + commit 同构）；恢复现场 = checkout 回旧 leaf。

```ts
type SessionHandle = {
    readonly id: number;
    // 读（均为 Activity）
    meta(): Promise<SessionMeta>;
    tree(): Promise<SessionTreeView>;                    // 树 + label + branch_summary
    transcript(opts?: { leaf?: EntryId; tail?: number }): Promise<TranscriptView>;
    leaf(): Promise<EntryId>;
    // 两个写原语
    checkout(entryId: EntryId): Promise<void>;           // 统一 rewind / 切分支 / 恢复现场
    append(msg: AppendMessage): Promise<EntryId>;        // leaf 非端点时自然开叉
    // 派生便捷层（纯糖）
    rewind(opts: { steps: number } | { to: EntryId }): Promise<EntryId>;  // 校验只向祖先
    label(entryId: EntryId, name: string): Promise<void>;                  // 复用 label entry
    invoke(opts: InvokeOptions): Promise<InvokeResult>;                    // 以当前 leaf 发起 run
    // 作用域安全旁路（sidecar 标准形态）：进入记住原 leaf，结束/异常自动 checkout 回原位
    excursion<T>(at: EntryId | "leaf", fn: (branch: SessionHandle) => Promise<T>): Promise<T>;
    fork(opts?: { at?: EntryId }): Promise<SessionHandle>;                 // 独立新 session
};
```

- 写锁：checkout/append/invoke 持 per-session 排它锁；同一 session 并发 invoke 宿主直接抛错（不静默排队）。
- `wf.caller`：发起本 run 的 session 句柄（面 A 为空）；`wf.run`：仅 stage 挂载（面 C）时存在，提供 `inject(messages)` / `patchState()`（对应旧 merge 的 runtimeMessages/runtimeState）。
- `wf.agents` 只管 profile 维度：`create(profileKey, {initial, retain?}) / profile(key) / detach(id)`；`wf.agents.invoke(id, ...)` 是 `wf.sessions.open(id).invoke(...)` 的糖。
- invoke 返回与现工具一致：`{ status: "completed"|"waiting"|"error", result?: {message, data}, error?, stats }`。**`waiting` 是普通返回值**（脚本可 `wf.ask` 转发用户再 followup），不再像 sidecar 那样直接判父 run 失败。

### 交互 / 时间 / 熵

```ts
await wf.ask({ kind: "select"|"text"|"approve", title, options?, multi? });  // 挂起点，落盘退内存
wf.log("...");  wf.progress({ phase, done, total });                          // 非 Activity，replay 静默
wf.now();  wf.random();                                                        // journaled（禁裸 Date.now/Math.random）
wf.args;   return value;                                                       // argsSchema / resultSchema 校验
```

## Activity 层 / Workflow 层

- **Workflow 层 = 脚本本体**：必须确定性；只有控制流、纯计算、Activity 调用；可无副作用 replay。
- **Activity 层 = 一切 journaled 副作用**：

```ts
type ActivityRecord = {
    key: ActivityKey;             // (step/分支路径, 路径内序号, kind, 参数指纹)
    kind: string;
    paramsFingerprint: string;    // 规范化 JSON 哈希，键序无关
    status: "completed" | "error" | "cancelled";
    result?: JsonValue;           // 字节预算内；超限落 contentRef（文件引用 + hash）
    error?: SerializedError;      // 失败也是记录 → replay 重新 throw 同一错误
    stats?: { elapsedMs; tokens? };
};
```

| 归属 | 成员 |
|---|---|
| Activity | agents.create/invoke/detach/profile；SessionHandle 全部读写（**读也算**：结果影响控制流且外部可变）；ask；now/random/sleep；workspace 只读读取；wf.workflow |
| 非 Activity | log/progress、纯计算 |
| 组合边界 | `wf.step(name, fn, {key?})`：命名 memo 边界，命中则整体跳过 fn；内部 Activity 路径以 step 名为前缀 |

workspace 读取的 journal 记 **content hash + 有界摘要**；replay 重读校验 hash，不符 = miss 重跑（"源文件改了要不要重跑"机械化）。

## 流程控制

原则：语言原生能力不重复发明（if/for/try-catch/函数）；宿主只补四类：**持久化、并发、时间、人类**。

```ts
await wf.all([...]);
await wf.map(items, fn, { concurrency, key: it => it.id, failure: "failFast"|"collect" });
    // collect → { ok: [...], failed: [...] }
await wf.retry(fn, { attempts, backoff });   // 每次尝试是独立 Activity，失败也 journal
await wf.agents.invoke(id, { ..., timeoutMs });
await wf.sleep({ ms } | { until });          // 持久化 timer，重启按 due 恢复
await wf.step(name, fn);
await wf.workflow(key, args);                // 嵌套限一层
```

- 异常：原生 try/catch；不 catch 则 run 失败，错误链可见。
- 取消：协作式，下一个 Activity 边界停；进行中 invoke 尽力中断；journal 记 cancelled；前缀保留可恢复。
- `wf.race` 推迟 V2（败者取消语义复杂，三场景用不上）。

## Session 管理

1. **归属**：workflow 内 create 的 session `parentSessionId = run session`（树聚合 / token 汇总 / 级联清理沿此边）。
2. **可见范围**：只能 open (a) 自己创建的；(b) `wf.caller` 及其 linked；(c) args 显式传入的 sessionId（发起方权限背书）。防面 B agent 借 workflow 翻任意 session。
3. **生命周期**：create 时 `retain: "keep"|"archiveOnSuccess"|"ephemeral"`，默认 archiveOnSuccess。**归档不影响 replay**（replay 只读 journal，不需子 session 活着）。
4. **跨 run 复用**：V1 不做池化，sessionId 走 args 传入。

## Journal 与缓存失效规则

`ActivityKey = (step/分支路径, 路径内序号, kind, 参数规范化指纹)`。replay 逐 Activity 与本路径 journal 下一条比对：全匹配 = 命中返回记录值；首次不匹配 = **本路径后缀失效转真实执行，兄弟路径不受影响**。键里没有代码文本。

**保持缓存**：已完成步骤之后的增改；改纯计算未动先前 Activity 参数；增删 log/progress/注释/变量名；random/now 已 journal 故下游指纹稳定；已完成 step（name+key 未变）整体命中（**内部编辑被忽略**）；map 带 key 时插入新项只跑新项。

**丢失（局部）**：某 Activity 参数变 → 本路径该点起后缀失效；序列中间插删 Activity → 序号移位后缀失效（用 wf.step 圈阶段规避）；map 无 key 且 items 增删重排 → 索引位移大面积失效；workspace 文件 hash 变 → 该读取 miss；手动"从此步重跑" / `--no-cache`。

配套：

- **step 命中忽略内部编辑是双刃剑**：UI 必须给已缓存 step 明确标识 + 一键失效，否则是最高频困惑源。
- **迭代模式 = fork run**：改脚本重跑 fork run session（journal 前缀随树带走），旧执行留树上。journal entry 可编辑（改某步记录值 → 该处开新分支重跑后缀）同一机制承载 time-travel。
- 随机与恢复的原理：可恢复的前提是"无**未被记录的**非确定性"（determinism given journal）。模型采样本身就是最大随机源，靠 journal 化解；random/now 同类。并发下 journal 键按"分支路径 + 分支内序号"而非全局完成顺序（否则 map 并发完成序漂移会破坏 replay）。

## 四个调用面

- **面 A · 用户/系统触发**：UI workflow 列表（argsSchema 生成表单，n8n 式）或事件触发；`wf.caller` 为空。拆书典型。
- **面 B · Agent 工具触发**：新工具 `run_workflow({ workflowKey, script?, args })`，返回与 invoke_agent 同构。`script` 为统一 code act 探索位，V1 不开放只留 schema 位。leader 一次调用交付整条流水线，约束从提示词自觉变为代码结构。
- **面 C · Profile 声明挂载**（sidecar 替代）：profile 声明 `workflows: [{ on: "prepareRun"|"settleRun", key }]`；harness 在 stage 只做"发起 run + 传 caller/run 句柄 + 等结束"。旧合同的 fork-leaf、toolKeys 收窄、keyed report、merge 四路、"waiting 即父败"全部退化为脚本普通代码。
- **面 D · 被再编排**：run 是 session → 可被 open/fork/rewind；`wf.caller` 可被 append/rewind/invoke——发起者同时是参与者。无需额外 API，是 run=session 的推论。

## 图与可视化（LangGraph 对比结论摘要）

脚本无法静态提取精确完整执行图（不可判定），但三种投影覆盖产品需求：`phases` 声明骨架（运行前预览）、AST 近似 CFG（workshop 分享页尽力而为）、**journal trace（精确，运行中实时展开）**——LangGraph 画"程序"，trace 画"执行"，盯屏看的是后者。完成 run 可一键导出图。逐维对比与四条选型理由见对话记录，核心：架构复用 / sidecar 本质命令式 / 作者是模型 / 图→脚本可编译而脚本→图有损。业界信号：LangGraph 自推 Functional API，Temporal/Inngest/Cloudflare Workflows/Claude Code 均为 durable-execution 脚本模式。

## 可观测性

- run 即 session → 步骤 entry 走 `session-event-hub` + public projection 既有管道，不建新通道。
- 子代理挂 run 子树，前端按树聚合——顺带解决 TODOS「前端不能实时显示 subagent」「记录小弟 token 消耗」。
- UI：run 列表（running/waiting/completed/error）+ 步骤树 + waiting 的 ask 应答卡片 + 已缓存 step 标识。

## 三场景形态（伪码见对话，要点）

- 拆书：`wf.map(chapters, 摘要, {concurrency, key: ch.id})` → plot.analyst 吃 briefs → `wf.ask` 圈选 → 提取文风。模型分层由 profile `runtimeDefaults` 表达，workflow 只挑 profile。
- 写作流水线：writer↔critic for 循环带上限 + `escalate` 时 `wf.ask` 升级给人 + 收尾 worldUpdater——约束是代码，leader 跳不过 critic。
- sidecar：`wf.caller.excursion(...)` 内检索 → `wf.caller.append(actor context)`。消失的概念：stage 内 keyed report_sidecar_result、outputFallback、merge 回调、waiting 即父败。

## 依赖的底层缺口

1. harness 可重入 / 非阻塞 invoke（`wf.map` 前提；TODOS 已有）。
2. waiting 向上传播：agent 阻塞调 run_workflow 时 `ask` 穿透到顶层用户（复用 invoke_agent waiting 状态机）。
3. session entry 联合类型加 `workflow_step` 族。
4. sidecar 迁移：`SidecarProfilePass` 标 deprecated，`actor.context-load` / `actor.memory-save` 面 C 重写作试点。

## 决策记录

| # | 决策 | 状态 |
|---|---|---|
| D1 | Run 载体 = session（`kind:"workflow"`） | 脚本式确认时隐含拍板 |
| D2 | agent 内联脚本 `script` 参数 V1 不开放，只留 schema 位 | 建议，待确认 |
| D3 | sidecar V1 迁移（两个 actor sidecar 试点） | 建议，待确认 |
| D4 | `wf.ask` 挂起穿透顶层用户，不给 agent 代答；后台 Run 在 owner Session 的 Composer Workflow 待处理区应答 | Task 111 已落地（`wait:true` 仅保留短流程阻塞入口） |
| D5 | 嵌套限一层 | 建议，待确认 |
| D6 | session 写原语统一为 checkout+append，分支无创建 API，旁路用 excursion 作用域 | 本轮定稿 |
| D7 | Activity/Workflow 两层：Activity=一切 journaled 副作用（含读），log/progress 非 Activity | 本轮定稿 |
| D8 | ActivityKey=(路径,序号,kind,参数指纹)，不含代码文本；step 名字键抗插入 | 本轮定稿 |
| D9 | map 支持 `key` 与 `failure:"collect"`；race 推迟 V2 | 本轮定稿 |
| D10 | session retain 默认 archiveOnSuccess；可见范围三条 capability 规则；V1 无池化 | 本轮定稿 |
| D11 | workspace 读取 journal 记 hash，replay 校验 | 本轮定稿 |
| D12 | 迭代 = fork run；journal entry 可编辑进 V1 需求 | **被 D13 推翻**：V2 |
| D13 | V1 收敛：范围以「V1 收敛」节为准；面 C 推迟（待确认） | 第四轮定稿 |
| D14 | 持久参与者：acquire 原语；retain 三态改 ephemeral 布尔；session 默认持久 | 第四轮定稿，推翻 D10 的 archiveOnSuccess 默认 |
| D15 | meta 加 kind + tags；systemRole 废弃并入 kind:"system" | 第四轮定稿 |

## Spike 结果（2026-07-19，nb-workflow）

「V1 收敛」全部 API 在 spike 中实现并验证：journal 重放（崩溃 rerun / ask 挂起 resume / 参数变更局部失效）、map 并发（分支路径 seq 与完成序无关）、SessionHandle 六原语 + excursion、acquire 持久参与者、锁互斥、ephemeral 归档、三种投影（skeleton / AST CFG / trace）。四场景（拆书 / 写作流水线 / RP 持久参与者 / sidecar 旁路）全流程测试通过。

接入期必须遵守的 spike 发现（详见 nb-workflow README「Spike 发现」）：

- **F2** SessionHandle 必须持显式游标，append/invoke 锚定游标而非全局 active leaf（否则挂起期间用户直聊会让重放写错位置）——进接入合同。
- **F3** `wf.all` 只收 thunk；沙盒需封禁裸 `Promise.all`（同路径 seq 争抢破坏身份键）。
- **F4** V1 只 journal 成功，失败步骤 rerun 重执行；错误重放的严格确定性留 V2。
- **F5** 挂起时释放锁；resume 重放命中 open/acquire 也重新加锁（锁是运行时态不进 journal）。
- 明确不在 spike 范围：沙盒化、journal 落 `workflow_step` entry、SSE 投影、waiting 穿透、harness 可重入、schema 校验——即接入任务的工作清单。
- **演示与事件流（07-19 第二轮）**：内核新增 `WorkflowEvent` 事件流（status/activity+cached/ask_pending/log/progress，即 SSE 公开投影的前置形态）；`bun run demo` 生成 `demo/index.html` 四板块——① 实跑事件回放播放器（trace 图逐步点亮、ask 暂停等应答、resume 后缓存命中快闪，即接入后用户体验）② 骨架+CFG 静态投影 ③ 改参数 rerun 失效着色（14 命中/2 重跑）④ RP leader session 树跨 run 生长（workflow/direct 双色）。

## 初步接入（2026-07-20）

目标：验证 session 操作能力真实可用——内核跑在 NeuroBook 真实 session 层上，产出 preview demo 页。**不是完全接入**：run 状态仍内存态、无 SSE、无面 B 工具、sidecar 未迁移。

### 内核端口化（sibling 仓，vendor 前置改造）

- 抽出 `src/ports.ts`：`SessionPort`（createSession/meta/findByTag/activeLeaf/setActiveLeaf/append/transcript/archive/lock/releaseAll，全异步）+ `AgentPort`（profileInfo/invoke(sessionId, fromLeaf, opts) → `AgentInvokeOutcome`）+ `WorkspacePort`。语义合同写在接口注释：append 显式锚定 parentId（F2）且自动移 leaf（对齐真实仓）；锁是运行时态。
- `EntryId` 从 number 改 **string**（对齐 `SessionEntryId`）；`SessionId` 保持 number。
- 内存实现改名 `MemorySessionStore` / `MockAgentPort`（mock invoke 的 entry 写入也走 SessionPort——因此**同一个 MockAgentPort 可直接跑在真实仓适配器上**，这是"mock 模型 × 真实 session"组合的关键）。
- 新增 `WorkflowRunner.begin()` 非阻塞启动（同步返回 runId，done 不 reject）+ 同 run 并发 execute 护栏；`createSession` 透传 `initial`（真实 profile 需要）。
- tsconfig 开 `noUncheckedIndexedAccess` 对齐 NeuroBook 严格度（防 vendor 漂移）。

### Vendor 与 NeuroBook 侧落点

- `scripts/cli/sync-nb-workflow.ts` + `bun run sync:nb-workflow` → `server/vendor/nb-workflow/`（VENDOR.json 溯源，机器同步勿手改；与 nb-history 同模式）。
- **D15 子集落地**：`SessionMetadata` 加 `kind?: "chat"|"workflow"|"system"` + `tags?: string[]`（可选，落最终位置）；`MessageSessionEntry.origin` 联合加 `"workflow"`；`repo.createSession` 透传。systemRole 废弃并入、列表按 kind 隐藏**未做**（留正式接入）。
- `server/agent/workflow/workflow-session-port.ts`：`NeuroWorkflowSessionPort` 落在 `JsonlSessionRepository` 上。映射：checkout=moveLeaf；append=appendEntry({parentId}) 显式锚定；archive=追加 session_archived entry；transcript=沿 parentId 回溯只投影 message entry（origin: workflow→workflow，其余→direct）；findByTag=listSessions({profileKey}) 收窄后逐个读 tags（O(n) 读，正式接入要做索引）。创建路由：`workflow.demo.*` 前缀直落 repo（无需真实 profile），真实 profile 走注入的 `harness.createAgent`（含 initial 校验）。mock 助手回复构造合法 `AssistantMessage`（provider:"nb-workflow"/model:"mock-responder"/usage 全零，开放联合类型合法）。
- `workflow-agent-port.ts`：`HarnessAgentPort`（真实一轮 = `harness.invokeAgent({sessionId, mode, message, payload, caller:{kind:"user"}, block:true})`；invoke 前游标≠当前 leaf 则先 moveLeaf；error → throw（F4）；queued → throw 暴露并发冲突）+ `RoutingAgentPort` 按 profileKey 前缀分流 mock/真实。
- `workflow-demo-service.ts`：单例组装 + run 事件环形缓冲（绝对游标）+ trace mermaid 服务端计算（进行中虚线橙/本次缓存命中绿/ask 体育场）+ 参与者提取（journal 的 create/acquire 看 result、open 解析指纹）+ 真实 session 树 mermaid（origin 三色 + active leaf 标记，标签过净化层）。
- 路由 `server/api/agent/workflow-demo/*`：scenarios / runs(list|post) / runs/[runId](get?after|resume|rerun) / sessions/[sessionId]/tree / direct-chat。run 快照路由返回类型显式收窄 `unknown`（RunView 递归 JsonValue 进 Nuxt 类型化路由表会 TS2589 爆栈，线上边界按无类型 JSON，前端断言）。
- Demo 页 `app/pages/workflow.preview.vue`（路由 `/workflow.preview`）+ `app/components/workflow-preview/`（RunPanel 轮询面板 / SessionTree 真树卡片 / Mermaid 渲染器）+ `app/utils/workflow-preview/render-mermaid.ts`（mermaid 11 惰性单例）。前端只渲染服务端算好的 mermaid 字符串。新依赖 `mermaid@11`。

### Demo 场景（五个）

1. **拆书**（mock）：并发摘要（concurrency=2）→ 剧情分析 + if 追加分支 → ask 圈选挂起 → 文风提取；完成后可改 styleMode 旋钮 rerun 演示局部失效。
2. **写作流水线**（mock）：writer↔critic 上限 4 轮，耗尽升级 ask approve，worldUpdater 收尾恰好一次。
3. **RP 持久参与者**（mock）：acquire leader/actor（tag 跨 run 复用真实 session）；树卡片内可直聊（origin=manual 黄色 entry 插进主线），再跑一轮历史连续。
4. **Sidecar 旁路**（mock）：对持久 caller session 做 excursion 探针（旁支留真树上），结论 append 回主线。
5. **真实 Agent 并发问答**（真模型）：用户填真实 profileKey（默认 writer）→ 并发 3 路真实 create+invoke（每路真实 session，admission 按 session 隔离天然支持并发）→ 汇总 invoke。**注意**：simulator.* 等重契约 profile（subject 文件、sidecar）不适合裸调用——真实 RP 属于完全接入范畴。

### 验证

- 核心测试 `server/agent/workflow/workflow-session-port.test.ts`（vitest，4 用例）：端口语义（锚定开叉/auto-leaf/checkout/transcript 投影/archive/findByTag）、RP 跨 run 复用 + 直聊插主线 + 锁互斥、excursion 旁支留真树、ask resume 前缀零重跑且真实 entry 零重复写。**4/4 一次通过**。
- `nuxt typecheck` 全绿；session-repo 回归 23/23；sibling 13 tests + tsc（含新严格度）全绿。
- 浏览器走查待用户（`bun run dev` → `/workflow.preview`）。

### 接入期新发现（追加进合同）

- **F6 递归类型防线**：`JsonValue` 递归类型不能进 Nuxt 类型化路由表（$fetch Serialize）也不能进 `ref<T>`（UnwrapRef）——路由边界收窄 unknown + 前端断言；组件态用 `shallowRef`。
- **F7 mock 助手消息**：pi-ai `Api/ProviderId` 是开放联合，合成 AssistantMessage 用显式 mock 标识（provider:"nb-workflow"）诚实合法；`parseStoredMessage` 严格 exact-keys 校验可过。
- **F8 创建双路**：repo.createSession（免 profile 校验，mock/kind/tags 可用）与 harness.createAgent（真实 profile 全校验，暂无 kind/tags 面）是两条创建路径，正式接入要在 harness.createAgent 面补 kind/tags。
- **F9 typescript 包禁 ESM import**：`projection/cfg.ts` 顶层 `import ts from "typescript"` 会被 Nitro dev 的 rollup 拉进模块图解析（~9MB 单文件包），叠加本仓基础内存后触达 V8 4GB 堆上限，`bun run dev` 在 Nitro build 阶段 OOM（exit 134）。修复：改 `import type` + `createRequire` 运行时 require（与 `world-engine/single-file-typescript-config-import.ts`、`profile-dsl-source-parser.ts` 既有先例同款），sibling 697b7e8 已修并重新 sync vendor；dev boot + scenarios API 验证通过。
- 已知边界：进程内锁不拦真实聊天入口（真实 invoke 靠 harness admission 串行；直聊互斥要等正式接入统一到 harness 层）；`input/data` 结构化值以 JSON 代码块存进 message 正文（仅展示，不做往返——内核场景逻辑不依赖历史结构化值）；run 状态/事件缓冲内存态，重启即失。

### 观测反馈轮（2026-07-20 第二轮）

用户对 demo 页的五条反馈全部落地：

1. **人话化**：新增 `server/agent/workflow/workflow-run-vm.ts` 观测 VM 构建器——`labels`（activityKey → 「写手#566：提问「写第一章」」这类中文标签，profile 中文名表 `PROFILE_NAMES` 在 scenarios）、事件流日志行全部人话；内核 `activity_started` 事件补带参数指纹（sibling 改 + 回灌）供进行中节点打标签。
2. **session 为节点的图**：`flowMermaid`（mermaid sequenceDiagram）——参与者=编排器/各 session（中文名）/用户；请求箭头落在 started 时刻、返回箭头落在完成时刻，**并发交错与 writer↔critic 交替天然可见**；create/acquire/append 是 note，ask 是 WF→用户箭头，缓存命中标 ⚡。前端把它作为主视图，Activity 级 trace 收进「工程视图」details。
3. **workflow 代码展示**：场景 DTO 加 `code`（`def.run.toString()` 运行时源码），场景卡 details 展示。
4. **real-fanout 排队根因**：`JsonlSessionRepository.nextSessionId` 是 seq 文件「读→写回+1」非原子读改写，`wf.map` 并发 create（App 里首个并发建 session 的调用方）两分支拿到同一 sessionId → 后 invoke 落在同一 session 上被 admission 排队。**修复：分配挂进程内串行链**（session-repo.ts `sessionSeqChain`）+ 并发唯一性回归测试。这是接入验证挖出的真实层既有缺陷。
5. **phase 与用户参与 / 前端包装**：runState 返回结构化 VM `{labels, phases, flowMermaid, traceMermaid, participants}`——`phases` 由 progress 事件切段把 activity/ask 归属到声明骨架（status: pending/active/done）；前端据此自绘 phase 步进条（含 🙋 参与点徽标）、ask 卡片、参与者中文名芯片。**这是「用户 ↔ 前端 ↔ workflow」模式的地基：服务端出结构化投影，前端自行组装 UI**，也是正式接入时 public projection DTO 的雏形。挂起中的 pendingAsk 以占位记录进 labels 与 trace（橙色体育场节点，用户在图上能看到「卡在哪等我」）。

验证：workflow 模块 7/7（含 VM 构建器 2 用例 + 并发回归）+ session-repo 23/23 + `nuxt typecheck` 全绿。sibling 至 `6da7e59`（activity_started 带指纹）。

### 观测第三轮（2026-07-20：演示节奏 + 运行中高亮 + 多可视化）

用户两条反馈：演示跑太快看不清 + 再多几种可视化方式（点名方向：以 session 为节点、create 长节点、每次 invoke 长一条边的实时生长图）。全部落地，不动 vendor/内核：

1. **演示速度可调**：`demoKnobs.speedFactor`（默认 4）作用于全部 mock responder 的 sleep（不进参数指纹，replay/缓存语义零影响）；startRun 请求透传，页面「演示速度」选择（1×/4×/8×）。
2. **运行中高亮**：demo 服务 `running` 表打点 `startedAt`（`EventBuffer` 条目附服务端接收时刻 `TimedEvent`）；VM 新增 `runningNow`（key/label/目标 sessionId/startedAt）→ 面板状态行下「⏳ 正在运行」呼吸脉冲 chip（含已耗时），正在被调用的参与者 chip 橙色脉冲 + 💭；running 轮询 700ms→500ms。
3. **三种新可视化**（`workflow-run-vm.ts` 推导，前端 tab 切换：对话流/时间线/直播卡片/关系图）：
   - **泳道时间线** `timeline`（新组件 WorkflowTimeline.vue，纯 HTML/CSS）：每 session 一条泳道，started→完成为条形，编排器级 activity（ask/workspace.read）归编排器泳道；进行中条 end=null 右端开放+呼吸；缓存命中瞬时窄条标 ⚡。并发交错与耗时直观可见。
   - **Agent 直播卡片** `live`（WorkflowAgentCards.vue）：每参与者一卡——💭 思考中（脉冲）/✔ 空闲 + 最近一次收到的指令与最新回复。
   - **实时生长关系图** `relationMermaid`（用户点名方向）：编排器为起点，create/acquire 长 session 节点，**每次 invoke 一条独立边**（「第n次·提问「…」」），writer↔critic 循环表现为两节点间不断加边；进行中的 invoke/pendingAsk 为橙色虚线边 + 忙碌节点橙色样式，轮询重渲染即「生长」；边 >60 退化为聚合计数边防炸图。
   - 备选路（用户提的「在 workflow 里加类似 progress 的标注代码」）本轮未用——三种图都能从既有事件/journal 推导；若后续视图缺语义再走该路。

4. **声明状态机视图**（用户追加提案，已做原型）：场景侧声明 `machine: MachineDecl {nodes, edges}`（原型放 `DemoScenario`，验证好用后上提内核 `WorkflowDefinition`）；状态更新 API = 既有 `wf.progress({node: "<key>"})`（内核 `ProgressState` 加 `node?: string` 指针字段，sibling `2ed1d3c` + 回灌）——**声明是图，progress 是指针**，与流程逻辑完全解耦。VM `machineMermaid`：全貌图运行前即可见，运行时当前节点橙色虚线、走过的绿色、循环重访标 ×n、刚发生的转移边橙色加粗。拆书（含 if 分支双出边）与写作流水线（review 驳回/通过/升级三出边 + revise 回环）已声明；面板「状态机」tab 仅在声明时出现并置于首位。

5. **状态图 API 二轮 → `wf.chart`**（内核级，sibling `a871cf2` + 回灌；取代 progress.node 指针原型，`ProgressState.node` 已移除）：
   - **零预置，图只在执行中长出来**（用户三轮拍板：不要初始化图，要看拆书慢慢长）：`chart.node(key, title?)` / `chart.edge(from, to, label?)` 增量声明，代码走到哪、图长到哪。`MachineDecl` 预声明骨架已删（二轮曾做混合式，三轮推翻）。
   - **并发 = token**：`chart.enter/leave/move(key, {token, sessionId})`——一个 token 一条并行执行线（默认 "main"，map 分支用 item id 当 token），多个 token 同时停留即并发可见；token 可附 sessionId，节点徽标显示「💭写手#12」= 哪个 agent 在这个状态上干活。`move` = leave+enter+确保边存在（边走过次数 ×n，刚走的加粗）。
   - 非 journaled 纯观测（与 log/progress 同级），replay 时随代码重跑自然重建。VM `buildChart` 消费 chart 事件渲染 mermaid。
   - 场景构图形态：**拆书 = 起点 →「chN 摘要」逐章长节点（扇出）→ 完成即长「合并」边汇入剧情分析 → if 长出深度伏笔 → 圈选后只长用户选中章的文风节点（第二次扇出）→ 完成**；流水线 = draft/review/revise 回环节点带 session 徽标；RP = leader 派发后 actor 节点才出现；**sidecar = 同一 session 的两个分支节点**（主线 →「excursion 开叉」→ 旁支（检索员帮工名留在节点上）→「结论写回主线」回主线，强调不是两个 agent）；real-fanout = 议题 → 各角度节点扇出（真实 session 并发）→ 汇总去重。
   - **四轮打磨（用户反馈）**：图 **append-only（只增不删）**，每条边带全局执行序号 ①②③…（同一条边多次走过 = 多个序号，如回环边「②驳回 ④驳回」）——**终图本身就是可回放的流程记录**，也为后续重放动画铺路；节点**持久**显示打过工的 agent 中文名〔写手#12〕（不随 token 离开消失，活跃只用颜色表达，避免标签闪变导致 mermaid 重排）。

验证：workflow 模块 7/7（VM 用例扩了时间线/卡片/关系图/状态图断言，事件入参改 `TimedEvent`）+ `nuxt typecheck` 全绿。sibling 至 `a871cf2`。浏览器走查待用户。

### 2026-07-28 Preview 观察边界收口（Task 111 联动）

`WorkflowRunPanel` 继续只轮询 Run HTTP 快照；其 Job 区域只在正式 Run 带非空 Job ID 时订阅共享 Jobs feed，用于后台预览和取消。demo Run 没有 Job ID，启动、切换、应答和重放不创建 Jobs SSE consumer，也不读取 Jobs 列表。

正式 `/workflow.preview` 页面首次加载或用户点击刷新正式列表时，显式读取一次 Jobs 列表以恢复现有正式 Run，并把该原子列表游标作为 Job 观察基线。Run 的应答、重放和切换只重启 Run 轮询，不再强制刷新全量 Jobs；waiting resume 后的 Job running 由服务端事件发布，不由前端补偿请求猜测。

## 后续 TODO

- [ ] 状态图增强（用户已提，本轮未做）：边显示流经的数据摘要；token 沿边移动的重放动画（边序号已铺路）
- [ ] D2-D5 逐条确认
- [ ] 沙盒方案细化（World Engine codeact-sandbox 弱隔离 MVP 能否直接承载长驻 async 脚本）
- [ ] `workflow_step` entry 与 public projection 的 DTO 设计（run-as-session 持久化，取代 demo 服务的内存 run 态）
- [ ] 面 C 挂载后 harness 瘦身范围评估（runSidecarPasses 拆除清单）
- [ ] 正式接入清单：waiting 穿透 / 面 B `run_workflow` 工具 / 脚本沙盒化 / findByTag 索引化 / harness.createAgent 面补 kind+tags / 直聊互斥统一到 harness / D15 剩余（systemRole 并入 + 列表隐藏）——已立项 [Task 111](../111-workflow-agent-integration/README.md) 承接
- [ ] 实施阶段规划（建议顺序：journal 内核 → 面 A + 拆书 → 面 B + 流水线 → 面 C sidecar 迁移）
