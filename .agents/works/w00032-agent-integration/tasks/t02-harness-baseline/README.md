---
schema: nbook.task/v2
taskId: t02-harness-baseline
status: planned
updated: 2026-10-29
---

# harness 底座：两条线对照与移植清单

## 目标与范围

以 master 的 nb-harness 为底座，逐块评估内核分支 `feat/w00002-harness-kernel` 的能力，定移植清单、harness 与 Agent 插件的分工，以及 harness Spec 的状态。

来源：需求 4；[报告](../t01-survey/artifacts/report/index.html)第 4 条；开发者 2026-10-28 定底座：master 为底座、参考内核分支。

合同：本 Task 只做设计讨论，行为合同未变；定稿后在计划里写明改哪些 Spec。

## 要讨论的问题

- 内核分支的能力逐块定“移过来、改了再移、不要”：会话树、审批与提问通道、插话与排队、配置与凭据、模型角色、压缩、资源地址与 artifact 溢出、插件扩展点、上下文槽、运行期更换与 Profile 重载、插件工具名换算。
- master 上 nb-story 实战得出的修正全部保留：密钥遮盖、余额不足归 `quota`、截断识别、相邻 user 消息合并、进程中断与停服收尾、启动环境取密钥。
- harness 与 Agent 插件的分工：报告第 4 条的建议是按“离开 NeuroBook 还能不能用”分。
- 包分不分开：分支并成一个包；master 是三个包，nb-story 依赖它们且已发 npm。
- OMP 版本：仓库锁定 18.2.5，分支 18.4.6，本机 omp 已到 18.12.3。
- Spec：`agent/harness.md` 晋升与实现对齐；分支上的 8 份 `docs/specs/harness/*` 怎样处置。
- 内核分支 t20 的 5 条待确认（插件 Slot、ask 与 yolo、提问后重启回答、插件工具名换算、在 interaction 事件里立即应答）。

## 材料

- [调研](../../research/2026-10-28-repo-survey.md)“harness 的两条线”一节
- [`agent/harness.md`](../../../../../docs/specs/agent/harness.md)、[master 的提案](../../../../../docs/proposals/nb-harness-profile-and-tools.md)
- 分支上的 `docs/proposals/agent-harness-kernel.md` 与 `docs/specs/harness/*`（`git show feat/w00002-harness-kernel:<路径>`）

## 前置

无。t03 到 t11 都建在它上面。

## 决定（开发者 2026-10-28，全部同意推荐）

1. 底座的做法：合同以 master 为准，代码以分支为主体。把分支的 `nb-harness` 整包搬到 master，补上 master 独有的几项（收尾工具与 `TurnResult`、`complete()`、错误正文的密钥遮盖、余额不足归 `quota`、进程中断与停服收尾、相邻 user 消息合并、只用指定的密钥环境变量；截断识别与 Profile 工具三层计划时逐项对照），nb-story 与 nb-agent-ui 的适配器改用新接口，新接口保留它们依赖的语义（单轮调用、`TurnResult`、收尾工具、`complete()`）。不逐块改写进 master 的 `createHarness`：分支要移的部分占大半，且共用 `runtime/session.ts` 的会话状态机。
2. 包：一个包、子路径导出（沿用 2026-10-10 的决定）。`nb-session`、`nb-profile` 停更，nb-story 下个版本改依赖 `nb-harness` 的子路径；npm 上给旧包标 deprecated 是远端写入，到时另请授权。
3. 分工按“离开 NeuroBook 还能不能用”：
   - harness：运行时、会话格式与存储接口、Profile 渲染、工具登记与发现、审批判定与提问通道、压缩、模型目录与凭据接口、资源地址的登记机制、通用文件工具；master 的 SSE 序列化作为 `transport` 子路径保留（nb-story 服务端在用）。
   - Agent 插件：会话存放位置、具体的地址方案与映射目录、凭据库路径、NeuroBook 专有工具（命令桥、history）、HTTP 路由、界面与设置。
4. OMP：搬包时升到当时最新（2026-10-28 为 18.13.2），作为第一个切片单独提交并跑 nb-story 测试；计划时先读 18.4 到最新的 changelog。
5. Spec：分支的 8 份 `docs/specs/harness/*` 随代码搬到 master，先标 planned，合入后晋升；`agent/harness.md` 独有的条目并进对应那份后删除。分支上 w00002 t09 到 t20 的记录拷到 master 留作来历。
6. 分支 t20 的 5 条待确认推到各自 Task：`<Slot>` 到 t05；插件工具名换算到 t04；ask 遇 yolo、重启后回答提问、在事件里立即应答到 t06。分支 t17 到 t20 的“待开发者评审”在对应 Task 讨论时一起看。

7. （2026-10-29 修订第 1 条）循环由内核自己写，不再套 OMP 的 `Agent`，与服务商通信只用 `streamSimple`（[事件模型提案](../../../../../docs/proposals/agent-harness-event-model.md)的“基本循环”）。分支的 `runtime/session.ts` 也套在 `Agent` 上，所以运行时这一层（会话状态机、审批、插话、中止与收口）按语义参照、不照搬代码；会话格式、工具登记、模型目录与凭据、压缩、Profile 渲染仍以分支为主体。

依据的事实（2026-10-28 核实）：分支 nb-harness 实现 7,192 行、测试 7,160 行，只依赖 OMP 18.4.6 与 typebox；master 三个包实现 3,201 行、测试 2,441 行；nb-story 有 12 个文件、nb-agent-ui 有 1 个文件引用这三个包；三个包与 nb-story 0.1.1 都已在 npm。

## 当前状态

讨论完成（2026-10-28），实现由后续 Task 完成，2026-11-07 核对后关闭（开发者同意）。本 Task 不再单独实施。

- 决定 1、7：内核由 [t20](../t20-hooks/README.md) 自写并合入（`packages/nb-harness/src/kernel`），分支的代码没有整包搬。
- 决定 3（分工）：t10 起的 `nbook.agent` 按它落地。
- 决定 4：OMP 现在是 18.14.0。
- 决定 5：`docs/specs/harness/` 下的 Spec 已写，还是 `planned`；晋升与 `agent/harness.md` 的处置见 t20 的“下一步”。

## 剩下的事

nb-story、nb-agent-ui 迁新内核，`nb-session`、`nb-profile` 停更：转 [t31](../t31-nb-story-new-kernel/README.md)。
