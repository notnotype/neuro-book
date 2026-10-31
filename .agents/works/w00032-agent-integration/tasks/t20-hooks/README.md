---
schema: nbook.task/v2
taskId: t20-hooks
status: active
updated: 2026-10-29
---

# 钩子：钩子点、读写能力、顺序与按 Profile 开关

## 目标与范围

定 Profile 钩子与插件全局钩子的统一接口：钩子点、能读写什么、先后顺序、出错与时限、写进上下文的内容怎样记日志、Profile 与用户怎样开关全局钩子

来源：需求 6、7；从 [t05](../t05-profile/README.md) 拆出（开发者 2026-10-28：钩子要单独一个 Task）。

合同：本 Task 只做设计讨论，行为合同未变；定稿后在计划里写明改哪些 Spec。

## 初步方向（t05 里讨论，2026-10-28）

开发者同意的方向：

- Profile 钩子与插件全局钩子同一套接口、同样可读写。
- 钩子点：会话开始、每次请求前、工具调用前、工具调用后、模型回复后、压缩前、一轮结束。
- 能读：历史、本次请求、工具、Profile 与它的设置。能写：末尾追加消息、加一段系统提示词、改工具参数或结果、拒绝、停止本次运行。
- 顺序：插件按依赖拓扑序在前，Profile 的钩子最后。
- 出错：工具调用前的钩子抛错按拒绝；其它钩子抛错跳过它这次写的内容并写诊断；每个钩子有执行时限。
- 钩子加的系统提示词放进 Profile 为它留的 `<Slot>`，没留就接在系统提示词末尾；每次请求都变的内容在预览里给“不利于缓存”的警告。

例子（用来检验设计）：记忆检索注入、文件变化感知、语言策略、预算停止、审批与路径改写、工具结果遮盖密钥、回复后检查剧透并要求重写、压缩前要求保留人物设定、一轮结束生成标题与整理记忆。

## 要讨论的问题

- 写进上下文的内容怎样记日志，性价比如何（开发者担心繁琐）。
- 不需要某些全局钩子的 Profile（例如 adhoc、摘要器不需要记忆系统）怎样声明；与用户按 Profile 开关的关系。
- 钩子能读写的具体形状；同一钩子点多个钩子改同一样东西时怎样合并。
- 与 t06 审批、t07 运行控制、t11 压缩、t13 history 的接口。

## 前置

t05、t06、t07。

## 讨论进展（2026-10-28）

讨论从“按钩子点定义结果”（参照 omp、Claude Code）走到“中间件与钩子混合”（参照 LangChain v1），最后开发者同意以事件模型为骨架：日志是事件、状态由日志折叠、请求是状态的视图、调用模型与执行工具是可拦截的副作用，Profile 与插件都是只做折叠、反应、视图、拦截四件事的扩展。方案与途中的决定写成提案 [Agent harness 的事件模型](../../../../../docs/proposals/agent-harness-event-model.md)（draft），外部参照见[调研](../../../../../docs/research/agent-runtime-references.md)“钩子”一节。

第二轮（2026-10-29）开发者全部同意：`reduce` 只看自己那一片、反应看同一份状态快照、视图只在发请求与预览时算；扩展的片默认私有、经导出的选择器共享；`pathState()`、`scope: "session"`、事件带版本；`prompt` 能读状态、按模型能力写条件、`<History render filter>`；视图加 `attach`（后来并进槽，见当前状态）、扩展的事件渲染、没留槽时丢弃并写诊断；预览也跑模型拦截链；循环由内核自己写（改 t02 决定 1，见 t02 决定 7）。提案按此修订，并补了“一次运行的数据流”一节。

## 当前状态

讨论完成（2026-10-29）：开发者认可提案第五稿，结束讨论。经过：

1. **第二稿与介绍页**：开发者要求的可视化内核介绍页发布为 `intro` 产物（[页面](artifacts/intro/index.html)，v1、v2）；用旧应用的 `leader.default` 验证了新设计。
2. **最后几轮讨论**（开发者同意）：日志记事实、历史是投影（`core.history` 是内置扩展，只有 Profile 能替换）；模板四节点 `<History>`、`<Input>`、`<Transcript>`、`<Slot>`；去掉 `tail`、`attach`；内核只留必须固定的部分。
3. **spike**（开发者要求）：[`spike/`](spike/README.md) 做了一个最小内核，第一版 15 个场景（`evidences/spike-r1.txt`）。
4. **第一轮深入审查**（开发者要求“简单的深入审查”，重点灵活性、API 形状、好用程度、性能）：omp（gpt-6.1-sol，架构、不变量、性能，32 条：阻断 9、重要 21、建议 2）与 Claude Opus（照 API 写了四个扩展与 Profile，17 条：重要 8、建议 9），报告 `evidences/design-review-r1-omp.txt`、`design-review-r1-opus.txt`。
5. **按审查改写**：spike 第二版（API 重写、内核补恢复、单写者、并行工具、中止、压缩、换 Profile、幂等与因果、依赖排序），40 个场景检查全过、`typetest.ts` 七种写错都是编译错误（`evidences/spike-r2.txt`）；提案改成第三稿，“原型与审查”一节列出改动，“第三稿的修订”一节列出改变了已定写法、待开发者确认的六处。
6. **第二轮审查**：Opus 用第二版 API 重写四个例子（第一轮 17 条：已解决 10、部分解决 7；新 12 条：阻断 1、重要 5、建议 6）；omp 核对第一轮 32 条（已解决 11、部分 17、改为待定项 3、没解决 1）并找出新 9 条（阻断 3、重要 6）。报告 `evidences/design-review-r2-opus.txt`、`design-review-r2-omp.txt`。
7. **按第二轮改完**：spike 53 个场景检查全过、八种写错是编译错误（`evidences/spike-r3.txt`）；提案补了适配器合同、压缩与 t11 的对齐、换 Profile 的版本与资源、单写者队列、出错隔离表等。
8. **介绍页 v3** 发布。开发者觉得复杂，要求从头推一遍；讨论中指出记忆检索结果只能排在用户输入之后、而很多时候用户输入要在请求最后。
9. **第四稿**（开发者提出“异步状态机”的设计并要求注意压缩）：输入缓冲区与指令（steer、followup）；对话的形状改为开场、已提交的轮、进行中的这一轮，一轮结束才提交进 `Message[]`；Profile 的 `turn` 与 `commit`；模板节点 `<History>`、`<Turn>`、`<Slot>`；压缩按轮与步切、保留进行中这一轮的输入；推迟 `sample`、预览过去的请求可复现、一般的缓存诊断、工具并发分类。只写了类型与主创例子（[`spike/v4/`](spike/v4/leader.default.tsx)，过 tsc，`v4/typetest.ts` 五处写错是编译错误），spike 没有按第四稿重写。
10. **第四稿的修订**（2026-10-29）：开发者同意去掉 `prelude`（开场改为一片状态加稳定的槽 `opening()`）；按开发者要求优化接口形状（按事件名挂处理函数 `on`、`reduce` 按事件名的表、事件名驼峰并去掉 `K`/`is`、`input` 与 `steer` 分开、`ctx` 按入口分档、`emit`/`set`/`continue` 直接调用、完整变量名、Profile 自己就是最里层的扩展），写在提案第 16 节与 `spike/v4/`（tsc 通过，`v4/typetest.ts` 十一处写错是编译错误）。
11. **接口设计**（开发者要求）：三个 Sonnet（插件作者、Profile 作者、宿主与工具链）、一个 Fable（独立设计）、一个 omp（架构与不变量）各自做接口设计并兼做架构审查，报告 `evidences/api-design-*.txt`。
12. **第五稿**：按五份报告汇总，取舍写在提案第 20 节；接口在 [`spike/v5/`](spike/v5/api.ts)（`api.ts`、`host.ts`、`testing.ts`、`plugins.ts`、`profiles.tsx`、`tests.example.ts`），只有类型，tsc 通过，`v5/typetest.ts` 二十九处写错都报出预期的错误；第三稿 spike 仍 53/53。
13. **定稿**（开发者 2026-10-29）：能独立成扩展或写成纯函数的便利写法做成 helper，不做成字段（`reminder()`、`opening()`、`standardLayout()`、`finalOnly()`、`withoutEvents()`、`format.withRender()`），理由是便利字段太多会加重心智负担；撤掉为 `remind` 字段加的保留事件。`spike/v5/` 随之改写，tsc 通过，`typetest.ts` 二十九处写错都报出预期的错误。认可第三至五稿改变已定写法的地方。t20 改了内核，实施时排在最前。

## 实施进展（2026-10-30）

- 实施计划 [plan.md](plan.md) 第二版：第一版经六位审查者 108 条意见（[处理表](evidences/plan-review-r1-disposition.md)），开发者按推荐定了六处（计划第 1 节决定 5–10）；第二轮快速审查 Opus 19 条、omp 13 条已并入。
- Work 分支 `feat/w00032-agent-integration`，worktree `.worktree/w00032-agent-integration`。
- 第 0 片完成（`5343ed4e6`）：OMP 升到 18.14.0；修了 `NO_AUTH_SENTINEL` 的导出位置与 `EditPolicy` 的新字段；目录快照 69 → 79 家；本机回环端点的输出上限按模型自己写的值（nb-story 的 Spec 与 README 同步，`17b64d9aa`）。nb-harness 94 个测试、两条真实模型 smoke 通过；`test:affected` 只剩 nb-ui 的 `NB_UI_VERSION` 一条，在 master 上同样失败，与本 Task 无关。

- 第 1 片完成（开发者 2026-10-31 同意接受提案）：提案改 `accepted`，决策记录追加计划第 1 节决定 1–13 与“第五稿到定稿的差异”表，正文第 2、3、7、8、9、11、20 节与待定项按定稿改写；新 [ADR 0035](../../../../../docs/adr/0035-harness-log-driven-kernel.md)；新建 [`harness/session.md`](../../../../../docs/specs/harness/session.md)（planned，输出 1–21、场景 1–6）与 [`harness/extensions.md`](../../../../../docs/specs/harness/extensions.md)（骨架，输出 1–27）。Work 分支上：`src/kernel/api/` 定稿类型、定义用的构造函数、模板节点与 JSX 运行时、子路径导出 `./kernel`、`./kernel/contracts`、`./prompt`（`./kernel/testing` 随第 2 片的 `createTestSession` 加）、`tsconfig` 的 JSX 设置、`architecture.test.ts`、`tests/kernel/typetest.tsx`（36 处写错逐条核对过报错原因）。与计划的出入：`ToolCall` 的工具 id 字段叫 `tool`；`compaction/` 依赖 `run/`、反向经回调（已改进计划）；helper 只有签名，实现在第 3、4 片。
- 第 2 片完成（纵切）：`log/`（会话目录、写入批、大块内容、操作系统锁、修复与校验；内存存储就是同一份 JSONL 存储跑在内存文件上）、`model/`（OMP 适配器）、`state/`、`extension/` 的最小装配、`dispatch/`（队列与 `SessionCore`）、`run/`（`send`、`enqueue`、`start`、`abort`、不带工具的循环、恢复、运行结果）、`view/`（模板渲染、缺省布局、`format`）、`session/`、最小的 `createTestSession`。新建 [`harness/runtime.md`](../../../../../docs/specs/harness/runtime.md)、[`harness/models.md`](../../../../../docs/specs/harness/models.md)；验收映射在计划第 6 节。测量与真实模型见 [`evidences/slice2-measure.txt`](evidences/slice2-measure.txt)：2 万条存储层打开 115–160 ms；每条回复 5,000 字时只读回就 166 MB，接近 200 MB 的预算，第 3 片一并看；DeepSeek 真实模型一轮、重开、再一轮通过；t04 在官方接口上的复测未验证（没有凭据）。
- 与计划的出入（已改进计划与 Spec）：会话锁改用操作系统的独占锁（照 nb-story `platform/flock.ts`），原计划“Bun 没有跨平台 flock”的理由不成立，进程号加令牌的陈旧回收有竞争窗口；存储不做 `fork`，由内核建新会话再追加；`commandAccepted` 排在受理批最后，它的 seq 就是批末的 seq。
- 待开发者定：`flock.ts` 现在 nb-story 与 nb-harness 各一份（同一件事写两份）。候选：迁移 Task 里让 nb-story 改用 nb-harness 导出的锁（nb-story 已依赖 nb-harness），或另建一个小的共享包；推荐前者。
- 第 3 片完成：按决定 14 删去 `assistant.text`、打开时按块流式读（2 万条、每条 5,000 字：文件 65→35 MB，打开后常驻 166→56 MB，打开 160→105 ms）；装配的全部检查（拒绝的与只留诊断的）、反应与写入批（并发、按装配序写、整批丢弃、深度上限、时限、运行中止）、`continue`、`mount` 与外部事实（空闲立刻写、运行中到边界）、清理、`reminder()`、`opening()`、扩展事件的版本。Profile 哈希定为不算源码哈希、改了要升 `version`（`extensions.md` 输出 28）。2 万条经完整的 `openSession` 打开 128–169 ms、堆上活数据 22–36 MB、常驻增量 52–72 MB，在预算内（[`evidences/slice2-measure.txt`](evidences/slice2-measure.txt) 第四节）。
- 实现中订正的：`emit` 统一为 `emit(名字, 数据?, {key?})`（没有数据的事件要幂等键时第二个参数写 `undefined`，避免运行时分不清第一个参数是数据还是选项）；`run` 的循环在回复的反应被中止时以 `aborted` 收口，不再提交成 `completed`。
- 第 4 片完成：新建 [`harness/profile.md`](../../../../../docs/specs/harness/profile.md)（视图：模板、轮的渲染、提交与槽）。模板节点放错位置（`template-invalid`）或 `<Turn />` 不是恰好一个（`turn-node-count`）时请求算不出来、按 `profile-failed` 收口；`<Tag>` 属性转义；`render` 抛错用缺省文字；已提交的轮每轮只渲染一次（按轮对象缓存，回退与切分支照样命中，装配结果换了整份作废），`commit` 抛错或交回不成对的消息改用缺省提交；请求发出前校验工具调用与结果成对（`request-invalid`）；槽的四种诊断（没摆、会变的放进系统块、撞名、`contribute` 抛错）；开发模式下的前缀稳定与提交一致检查；`outline` 移进 `view/`；`finalOnly`、`withoutEvents`。2 万条算一次请求冷 38–42 ms、热 23–30 ms，在 50 ms 预算内，大头是请求哈希（[`evidences/slice2-measure.txt`](evidences/slice2-measure.txt) 第五节）。
- 第 4 片实现审查（omp，开发者 2026-10-31 要求没把握的切片当场审）：9 条，8 条成立已改（Work 分支 `0b7a71e58`），1 条不成立；第 1 条（缺省提交借用读视图的 `turn`，重开后提交会变）待开发者定，推荐把 `turn` 改成纯函数。见 [`evidences/slice4-impl-review.txt`](evidences/slice4-impl-review.txt)。
- 第 4 片定下的：开发检查跟现有的开发模式开关（`NODE_ENV` 不是 `production`）走，不另加 `SessionEnv` 字段；没写 `commit` 时用 Profile 的 `turn` 提交（视图取第一次需要它的那次请求的），`turn` 依赖视图而提交结果变了由 `commit-differs` 提示。

## 下一步

下一片是第 5 片（工具与拦截：工具声明与名字换算、工具实现的建与释放、段并发、`runChain` 四条链、输入链在受理时跑与脱敏、审批钩子的放行与拒绝、`toolsAnnounced`、收尾工具与动态 `yield`）。全部切片之后做一次深入审查（开审前报计划与预算）。介绍页（`intro` v3）已过时，随实现更新。
