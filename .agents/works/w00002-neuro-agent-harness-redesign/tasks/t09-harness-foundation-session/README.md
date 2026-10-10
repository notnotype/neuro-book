---
schema: nbook.task/v2
taskId: t09-harness-foundation-session
---

# nb-harness 底座与 session 模块

## 目标

1. 搭好 `nb-harness` 的底座：一个模块一个子路径入口，模块边界由 `src/architecture.test.ts` 检查，旧原型整体移到 `src/prototype/`。
2. 写 [`harness.session`](../../../../../docs/specs/harness/session.md) 的 `planned` Spec，经 omp 设计审查定稿。
3. Spec 定稿后写实施计划（`plan.md`），按 Spec 实现 `session` 模块与 JSONL 存储。

非目标：`profile` 以外的其它模块；不删除旧原型与 `nb-session`、`nb-profile` 两个包（`runtime` 完成时删）。

## 当前状态（2026-10-10）

- **底座**（`44227693`，边界测试于本轮重写）：旧原型移到 `packages/nb-harness/src/prototype/`，包根入口 `.`、`./testing` 指向它；入口 `./session`（目前只有模块头注释）；`typebox` 依赖；包 `AGENTS.md` 改写为模块规则。边界测试改用 TypeScript 语法树读出导入：模块表（已登记 `session`、`profile`）、单向依赖、只经公开入口（`.js` 等后缀归一化，包名自引用按 `exports` 解析）、外部包与 Node 内置模块与动态导入的范围、禁止 `pi-coding-agent` 与 CommonJS 加载、旧原型与新模块互不引用（含测试与 `testing/`）、`src` 根目录只放测试、模块表无环。验证：`bun test` 31 pass、2 skip（原型的真实模型用例）；`bun run typecheck` 通过；变异检查中 `require`、`import = require`、非字面量动态导入、带注释与同一行第二条导入、`.js` 后缀引原型、包名自引用原型、根目录辅助文件、旧原型 `testing` 引新模块全部被报出，恢复后通过。
- **`harness.session` 的 Spec**：第一轮 omp 设计审查（报告 [`evidences/design-review.txt`](evidences/design-review.txt)，一个 omp 会话，跑满 1 小时后用原会话续跑补完）共 14 条：阻断 1、重要 12、建议 1，逐条核实全部成立，已修改（`39180770`、`2114ff13` 与本轮提交）：

  | # | 处理 |
  |---|---|
  | 1 阻断 | 模型上下文去掉一切无结果的工具调用（含待审批）；已用真实 OMP `Agent` 复现审查者的实验 |
  | 2 | 工具结果按“调用窗口”配对；审批记录所属助手消息的条目 id |
  | 3、4 | 崩溃收口只针对未结束的调用，分待审批、已拒绝、其余三种，补 `waiting` 或 `interrupted` |
  | 5 | 改写助手消息时去掉 `redactedThinking`、清除思考签名（照 OMP 回放） |
  | 6 | 设计稿去掉“批次原子”“旧版本迁移”两处矛盾 |
  | 7 | 写入失败后句柄只能关闭，恢复一律经重新打开、修复中断尾、收口 |
  | 8 | 订阅的六条边界行为 |
  | 9、10 | 边界测试重写（见上） |
  | 11 | 公开类型改为可编译写法，消息用 pi-ai 的 `Message` |
  | 12 | 各操作可能的失败码表与结构化定位字段 |
  | 13 | 持久性改为可观察的说法 |
  | 14 | 条目不可变 |

- **第二轮 omp 设计审查**（报告 [`evidences/design-review-r2.txt`](evidences/design-review-r2.txt)，审查对象含 `harness.profile` 与设计稿；因模型额度两次中断，用原会话续跑补完）共 15 条：重要 14、建议 1，逐条核实全部成立，已修改：

  | # | 处理 |
  |---|---|
  | 1 | `History as="text"` 只能放在请求消息里，渲染本次调用之前的历史 |
  | 2 | 种子只能是 `User`、`Developer`；`harness/seed` 的 `details.role` 记下角色 |
  | 3 | 一次调用只 `prepare` 一次；新增 `refresh` 只刷新 `model-call` 数据源 |
  | 4 | 种子、提醒、摘要回放时带 `attribution: "agent"`；两份 Spec 的“轮”按用户发出的消息划分 |
  | 5 | `readPage` 收 `{header, entries}`，游标绑定会话 id，追加不影响已发出的游标 |
  | 6 | 只截断列出的正文类位置，类型、角色、id 等原样；不拆字符 |
  | 7 | 页大小按截断后计；场景 15 改为真正超预算的一轮，补追加后游标稳定 |
  | 8 | Profile 自定义 `ProfileResult`、`ProfileFailure`、`ProfileIssue` |
  | 9 | 节点定义按类别区分：内容节点 `layout`，有状态节点按 `id` 收旧状态、返回新状态 |
  | 10 | 开发者澄清 `Appending` 只在循环前写入；没有 `History` 时请求末尾接上本次调用的消息（`invocationStart`） |
  | 11 | 交给 OMP 的是 `entries` 的浅副本 |
  | 12 | 边界测试认出 `require` 的别名、`module.require`、`import.meta.require` |
  | 13 | `loader` 目录允许变量路径的动态导入 |
  | 14 | 产品代码不能引用 `testing/`（含同模块） |
  | 15 | v1 回放只用文本摘要，`remote` 压缩推迟（开发者确认） |

  边界测试的修改逐种写违规样本确认报出后删除；`bun test` 31 pass、2 skip，`typecheck` 通过。

- **本轮按开发者决定的修订**：条目对齐 OMP 会话条目（harness 状态用 `custom` 条目，保留类型五种）、种子与压缩后的回放顺序、分页（按轮、截断大字段、按 id 读取）、与 OMP `prepareCompaction` 兼容。
- **S1 条目、内存存储、日志句柄**（本提交，按 [`plan.md`](plan.md) 第 1、2、3、6 节）：`src/session/` 的 `types.ts`、`entries.ts`（TypeBox 按判别字段选变体校验、JSON 如实表示检查、保留类型表、interaction 的关系规则）、`memory-store.ts`（存 JSON 文本）、`log.ts`（Promise 链串行、订阅快照推送、损坏与关闭状态）；两种存储共用的场景在 `testing/store-scenarios.ts`。`bun test src/session` 16 pass，`typecheck` 通过；变异检查四处（订阅者快照、写存储前加入 entries、时间戳单调、监听函数抛错）都被测试报出。计划审查（omp）此时仍在进行，其结论涉及 S1 的部分另起提交处理。
- **S2 JSONL 存储**（本提交，计划第 3 节）：子入口 `./session/jsonl`；中断尾与行号按字节算；`append` 用 `r+` 在末尾写，会话文件被删除时报错而不是重建无头文件；`list` 逐个读取、损坏的跳过。两种存储跑同一组场景；`bun test src/session` 36 pass；变异检查四处（行号、半行当完整行、repair 截错位置、`a` 标志重建文件）都被报出。
- **S3 回放与崩溃收口**（本提交，计划第 4 节）：`replay.ts` 的 `buildModelContext`（调用窗口配对、压缩后顺序、改写助手消息）、`sessionStatus`、`sessionSettings`、`fold`/`defineProjection`、`planRecovery`（结果条目的时间戳取最后一个条目，保证确定性）。场景 6 在两种存储上跑，并把上下文交给真实 OMP `Agent`、用自定义 `streamFn` 截下发往模型的请求核对配对；`bun test src/session` 50 pass。变异检查五处（用户消息关窗、清签名、去掉出错消息、收口跳过待审批、种子与摘要顺序）起初两处没被报出，补了两条用例后全部报出。给 runtime 的记录：OMP `Agent` 缺省的 `convertToLlm` 只保留 user、toolResult 与助手消息，developer 角色的种子会被它丢掉，runtime 交上下文时要自己传保留四种角色的 `convertToLlm`（测试里就是这样做的）。
- **S4 分页与按 id 读取**（本提交，计划第 5 节）：`paging.ts`：轮按用户发出的消息划分（第一条用户消息之前的条目按 Spec 自成一轮），游标是 base64url 的 `{s: 会话 id, q: 一轮起点的序号}`，页大小按截断后的 JSON 计，截断只碰正文、思考、工具参数、custom 数据、摘要，图片数据超预算置空，按字符边界截。场景 15 用三十轮（含 200 KiB 单字段与二十个 15 KiB 字段的一轮）跑完整翻页；`bun test src/session` 55 pass。
- **S5 与 OMP 兼容、Spec 证据**（本提交）：`omp-compat.test.ts` 用真实 `prepareCompaction`（`remoteEnabled: false`）核对条目可直接交给 OMP、切点是我们的条目 id、再次准备时认得前一个压缩条目；类型层面断言每个变体可赋给 OMP 的 `SessionEntry`；记录 OMP 在最后一个条目是压缩条目时不准备压缩（压缩模块要在种子重新写入之后再调用）与 Agent 缺省 `convertToLlm` 丢 developer 的事实。Spec 加“实现合同”与三条证据行，注册表标“待晋升”（晋升由开发者批准）。
- **计划审查（omp）**：已处理第 1 条（消息按 OMP 必填字段校验，`8dd21b79`）、第 2 条（`append` 入队时取副本）、第 3 条（重开时深冻结存储返回的条目，补测试）、第 4 条（`close` 与进行中的写入：写入照常完成并进入 `entries`，`repair` 不把已关闭的句柄改回可写，这一处是实际的 bug）、第 5 条（订阅快照的规则写进计划并补两种交错的测试；补发途中 `close` 时该订阅也收到结束通知，这一处是实际的缺口）、第 6 条（async 监听函数的 rejection 与 `onEnd` 抛错都接住）、第 7 条（Agent 缺省 `convertToLlm` 丢 developer：S5 已记录并测试）、第 10 条（中断尾按原始字节算：实现本来就是，补了切在多字节字符中间的用例）、第 11 条（`list` 遇到读不出的文件返回 `store-failed`，实际的缺口）、第 12 条（`open` 核对会话头 id 与文件名，实际的缺口）、第 13 条（`create` 写头失败时删文件；不做自动回收的取舍记在待确认清单）。审查跑满 90 分钟被截停，用原会话续跑补完报告（[`evidences/plan-review.txt`](evidences/plan-review.txt)）：登记 11 条（全部“重要”，阻断 0、建议 0）、未核实 2 项（第 8 条收口计划部分写入后的幂等性、第 9 条切点找不到时的回放，都补了测试并写进计划）；对两条风险的判断：OMP 类型形状变化只有 `typecheck` 能发现（包门禁已含），浅校验的风险已由第 1 条处理。
- **实现审查（omp，进行中）**：已写出的 7 条全部成立并已修：存储接口的 `append`/`repair` 自己查会话 id（路径穿越）；重开时查 id 唯一、parentId 链与 interaction 关系（JSONL 给行号，`openSession` 对任何存储再查一遍）；`header` 深冻结、句柄用私有 id；JSONL 写入循环处理短写；完整行按严格 UTF-8 解码；async `onEnd` 的 rejection 接住；根级的 `custom.data`、`custom_message.details` 字符串也截断。变异检查五处都被报出（短写一处没有可控的真实复现方式，只核对代码）。

## 依据

- 设计：[Agent harness 内核](../../../../../docs/proposals/agent-harness-kernel.md)（`accepted`，2026-10-10）的“会话”“事件、推送与分页”“模块划分与推进顺序”与决策记录。
- 开发者 2026-10-10：先打好底座；旧原型移到 `src/prototype/`；先把 `session` 做好；写完后让 omp 审查；分页“没必要一次性做好”。

## 下一步

实施计划 [`plan.md`](plan.md) 待开发者确认 → 按计划 S1–S5 实现与合同测试（开发者 2026-10-10 确认第二轮的处理，设计稿已 `accepted`）。
