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

## 依据

- 设计：[Agent harness 内核](../../../../../docs/proposals/agent-harness-kernel.md)（`accepted`，2026-10-10）的“会话”“事件、推送与分页”“模块划分与推进顺序”与决策记录。
- 开发者 2026-10-10：先打好底座；旧原型移到 `src/prototype/`；先把 `session` 做好；写完后让 omp 审查；分页“没必要一次性做好”。

## 下一步

实施计划 [`plan.md`](plan.md) 待开发者确认 → 按计划 S1–S5 实现与合同测试（开发者 2026-10-10 确认第二轮的处理，设计稿已 `accepted`）。
