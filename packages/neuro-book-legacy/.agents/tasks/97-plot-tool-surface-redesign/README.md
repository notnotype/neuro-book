# Plot 工具面重排：save_* 合并 / 命名统一 / 分层绑定

> 状态：**已实施（2026-07-09 审查修复轮收口）**。设计定稿于 2026-07-08（用户五点拍板），随 [Task 93 Plot 规划层](../93-plot-planning-layer/README.md) 实施链落地（本任务 Slice 1 = 该链批次 1，93 的新工具直接按本文档新形态注册）；2026-07-09 审查修复轮补齐 D8 mutates 元数据与提示词/文档同步。遗留验收项见 §Verification。

## Relative documents refs

- [docs/tasks/93-plot-planning-layer](../93-plot-planning-layer/README.md)：规划层设计（Promise/Decision/节奏字段）；本任务由其 TODO「plot 工具面整体重新调整设计」独立而来，且为其实施前置。
- [docs/tasks/87-plot-two-trees-and-writer-modes](../87-plot-two-trees-and-writer-modes/README.md)：现有 plot 工具面的来源任务；本任务修复其 Act/Chapter 工具接线遗漏（见 F1）。
- `server/agent/tools/plot-tools.ts`：14 个工具定义处。
- `server/agent/tools/index.ts`：内置工具 registry（buildAgentTools）。
- `server/agent/profiles/profile-tools.ts`：`builtin.plot` 命名空间与 toolset 绑定 DSL。
- [reference/plot/system.md](../../../reference/plot/system.md) §Agent Tools：工具清单的文档真相源（随本任务改写）。

## User Request / Topic

Task 93 三轮评审时用户点名：「经过这次设计，后续还需要再重新调整设计一下 plot 工具」。2026-07-08 盘点 + 方案讨论后用户五点拍板：

1. create/update 合并 —— 同意；
2. 动词用 `save_`；
3. `get_plot_tree` / `get_chapter_plot` 改名；
4. 生命周期动作（archive/abandon/decide/drop）进 action —— 同意；
5. Act/Chapter 死代码不单独接线、随重排以新形态注册 —— 同意。

## Goal

把 plot 工具面从「膨胀轨迹 23-27 个、三套前缀、四个死代码工具」收敛为 **15 个（读 8 + 写 7）命名统一、意图显式、分层绑定**的工具面，并让 Task 93 新工具一步到位按新形态实施。验证方式：`bun run typecheck` 全绿 + `bun test server/agent`（含 plot-tools / profile 契约测试改写）+ `bun run profile:metadata` 重编译通过 catalog freshness gate + 真实会话冒烟「leader 用 `save_story_chapter` 补 ChapterBrief 信息控制 → brief status 走出 `needs_chapter_brief`」（F1 死锁修复的直接验证）。实施中若发现与 mode 系统读写判定、审批系统的架构冲突，停下报告而不是 hack 绕过。

## Current State

- **已实施**：15 工具（读 8 + 写 7）按下述目标形态注册进 registry 并分层绑定（`plotReadBindings` / `plotWriteBindings`）；writer 只持读组，leader.default / director 读写两组。
- 以下**现状矩阵**是 2026-07-08 实施前盘点，保留作历史对照——`plot-tools.ts` 当时定义 14 个工具：

| 工具 | 读/写 | registry | leader | director | writer |
| --- | --- | --- | --- | --- | --- |
| `get_plot_tree` | 读 | ✓ | ✓ | ✓ | ✓ |
| `get_story_thread` | 读 | ✓ | ✓ | ✓ | ✓ |
| `get_story_scene_context` | 读 | ✓ | ✓ | ✓ | ✓ |
| `get_scene_world_context` | 读 | ✓ | ✓ | ✓ | ✓ |
| `get_chapter_plot` | 读 | ✓ | ✓ | ✓ | ✓ |
| `get_chapter_writer_brief` | 读（编译） | ✓ | ✓ | ✓ | ✓ |
| `create_story_thread` / `update_story_thread` | 写 | ✓ | ✓ | ✓ | — |
| `create_story_scene` / `update_story_scene` | 写 | ✓ | ✓ | ✓ | — |
| `create_story_act` / `update_story_act` | 写 | **✗ 死代码** | — | — | — |
| `create_story_chapter` / `update_story_chapter` | 写 | **✗ 死代码** | — | — | — |

- 相邻工具：`execute_world`（CodeAct 读写合一，readonly/readwrite 靠 description 软表达）、`execute_sql`、subject 三工具。全工具面**无任何 delete/archive 动作**。
- leader 整体 toolset 约 30 个；Task 93 原计划再 +9 个 plot 工具。

### 盘点发现（本任务要修复的）

- 🔴 **F1 Act/Chapter 四个 CRUD 是死代码且被提示词引用**：`plot-tools.ts:181-196` 定义、`tools/index.ts:34-43` 未挂、`builtin.plot` 无绑定；而 `leader.default.profile.tsx:366` 指示 leader 用 `update_story_chapter` 维护 ChapterBrief。后果：brief status 停在 `needs_chapter_brief` 时 leader 无工具补信息控制（提示词又禁 SQL 绕过），Agent 自主流程死锁，只能用户 UI 手填。Task 87 接线遗漏。
- 🟡 **F2 Decision 无读取工具**：Task 93 三轮补了 Promise 读取面，open Decision 列表（director 规划必看）漏了。
- 🟡 **F3 Agent 无归档出口**：Thread/Scene 有 `archived` 状态但要从 update 的 status 参数里挖；Act/Chapter/Promise 连软删都没有。规划层是高频试错区。
- 🟡 **F4 命名三套前缀**：`get_plot_tree`（plot）vs `get_story_thread`（story）vs `get_chapter_plot`（chapter + 语序倒装）。

## Decisions / Discussion

**D1 保持细工具范式，否决 CodeAct 与 dispatch 聚合。**

- 否决 `execute_plot`（仿 execute_world 的 CodeAct）：World 走 CodeAct 是因为需要表达力（时间旅行查询 + 计算 + 批量 patch 事务）；plot 是强 schema 结构化 CRUD，CodeAct 丢参数校验、typed DTO、审批粒度三样，还把「读写靠 description 软表达」这个已知妥协扩散到第二个域（mode 系统需要静态判定读写），违反 Task 93 D29 显式语义原则。
- 否决 `plot_write(entity, action, payload)` dispatch：单工具参数 schema 是全实体字段巨型 union，LLM 理解负担不降反升。

**D2 写面合并：每实体一个 `save_*`，`action` 必填枚举显式声明意图**（拍板 1+2）。8+7=15 个 create/update 对收敛为 7 个工具。schema 形态：`action` 必填枚举 + 实体字段平铺可选 + 服务层按 action 校验必填（create 缺 title 等返回可读诊断）。**不用「无 id 即 create」的 upsert**——忘传 id 会静默建重复实体；显式 action 符合 D29。

**D3 读工具改名统一 story 前缀**（拍板 3）：`get_plot_tree` → `get_story_tree`；`get_chapter_plot` → `get_story_chapter`（其 DTO 本就是 chapter 详情 + scenes，新名字顺便暴露「读 ChapterBrief」的能力——现状 brief 字段没有正规读取入口）。`get_chapter_writer_brief` 不改（编译类，名字准确）。改名成本一次付清，越晚越贵。

**D4 生命周期动作进 action**（拍板 4）：`archive`（Thread/Scene）、`abandon`/`fulfill`（Promise）、`decide`/`drop`（Decision）作为 action 枚举值，不让 Agent 去 status 参数里挖。Agent 获得**软删出口**；物理删除仍不开放给 Agent（破坏性大，留给 UI/人）。

**D5 死代码修复方式**（拍板 5）：不按旧形态单独接线，直接随重排以 `save_story_act` / `save_story_chapter` 新形态注册（修 F1）。

**D6 读取工具「无 id = 列表」模式**：`get_story_promise(promiseId?)` 无 id 返回摘要列表、有 id 返回详情+beats；`get_story_decision(decisionId?)` 同型，无 id 返回 open 优先列表（修 F2）。先例：`get_story_thread` 无 id 用 `plot.selection`。将来 ledger 的派生告警挂 `get_story_promise` 列表形态，不再加工具。

**D7 绑定分层 bundle**：`profile-tools.ts` 导出 `plotReadBindings`（8 读）与 `plotWriteBindings`（7 写）预组合数组；writer 只 spread 读组，leader/director 两组都 spread。`builtin.plot.*` 逐项绑定保留（细粒度覆盖场景用）。

**D8 `mutates` 元数据（实施时确认）**：建议工具定义层加 `mutates: boolean`，让 mode 系统按元数据而非名字前缀判定读写。实施前先确认 mode 系统当前的判定机制，若已有等价机制则跟随现状，不重复造。

**D9 排序**：本任务是 Task 93 实施的前置切片——93 的 `save_story_promise` / `save_promise_beat` / `save_story_decision` / `get_story_promise` / `get_story_decision` 直接按本形态实施；本任务自身只动现有 8 实体（act/chapter/thread/scene 的写面 + 两个读改名 + bundle）。

### 目标工具面（15 个 = 读 8 + 写 7）

**写 7：**

| 工具 | action 值域 | 说明 |
| --- | --- | --- |
| `save_story_act` | `create / update` | 新注册（修 F1） |
| `save_story_chapter` | `create / update` | 新注册（修 F1）；含 ChapterBrief 字段组 |
| `save_story_thread` | `create / update / archive` | 合并现有 create/update |
| `save_story_scene` | `create / update / archive` | 合并现有 create/update；Task 93 的 outcomeType/pacingRole 字段在此 |
| `save_story_promise` | `create / update / abandon / fulfill` | Task 93 Slice 1 按此形态实施 |
| `save_promise_beat` | `set / remove` | beat 子实体独立，避免与 promise 字段混杂 |
| `save_story_decision` | `create / update / decide / drop` | decide 强制 risk（Task 93 D11） |

**读 8：**

| 工具 | 变化 |
| --- | --- |
| `get_story_tree` | 原 `get_plot_tree` 改名；附 Promise/Decision 摘要计数（Task 93） |
| `get_story_thread` | 不变（含 miceType 透出） |
| `get_story_scene_context` | 不变（含新字段与 promiseBeats 透出，Task 93） |
| `get_scene_world_context` | 不变 |
| `get_story_chapter` | 原 `get_chapter_plot` 改名；chapter 详情（含 brief）+ 挂章 scenes |
| `get_chapter_writer_brief` | 不变（Task 93 Slice 3 在其输出加两段） |
| `get_story_promise(promiseId?)` | 新增（Task 93）；无 id=摘要列表 |
| `get_story_decision(decisionId?)` | 新增（修 F2）；无 id=open 优先列表 |

净效果：功能覆盖变大（Act/Chapter 接活、Decision 可读、归档出口），工具数从轨迹 23-27 收到 15；writer 只见 8 个读工具。

## 迁移同步点清单（硬切，不留兼容）

1. `server/agent/tools/plot-tools.ts`：写面重构 + 读改名；
2. `server/agent/tools/index.ts`：registry 挂新键（补挂 act/chapter）；
3. `server/agent/profiles/profile-tools.ts`：`builtin.plot` 键名更新 + `plotReadBindings` / `plotWriteBindings` bundle 导出；
4. 三个 profile：leader.default / director / writer 的 toolset 改 spread bundle + **提示词文本里的工具名全部替换**（leader:366 等自然语言引用，grep `get_plot_tree\|get_chapter_plot\|create_story\|update_story` 全量清）；
5. reference 文档：system.md §Agent Tools、agent-spec.md、writer-brief.md、leader-default.md；
6. 测试：plot-tools.test.ts、writer-profile-contract / leader-assets-profile 契约测试 fixture；
7. `bun run profile:metadata` 重编译（catalog freshness gate）。

## Verification / Test

已实施（2026-07-09 审查修复轮后规整；按 Task 87 经验 shard 隔离跑，未全仓并跑）：

- `bun test ./server/agent/tools`：147 pass——plot-tools.test.ts 覆盖 save_*/get_* 行为、action 必填与可读中文诊断、F1 修复链路（`save_story_chapter` 透传 ChapterBrief 信息控制字段）、读写元数据守护用例（7 个 save_* 标 `mutatesWorkspace`、8 个 get_* 不标）。
- `bunx vitest run server/agent/profiles`：170 tests 通过（writer / leader-assets 契约测试断言新工具面；`bun run profile:metadata` 重编译过 catalog freshness gate）。注：catalog.test.ts 的 publisher 用例在整 shard 高负载下偶发 5s 超时，单独重跑 43/43 通过，属负载型 flake、非本任务回归。
- `bun run typecheck`：plot 相关文件 0 error。
- **F1 真实会话冒烟未执行（验收降级声明）**：Goal 中「leader 用 `save_story_chapter` 补 ChapterBrief 信息控制 → brief status 走出 `needs_chapter_brief`」的真实会话链路，当前由单测分段覆盖（工具已注册进 registry 与 leader bundle、leader 提示词已指示用法、brief status 阶梯未动，chapter-writer-brief 单测覆盖 status 流转）；「模型在真实会话中是否会用新工具走出死锁」尚未验证，与 Task 93 真实项目实测合并列入待办，待用户浏览器/真实会话验收时执行。

## Implementation Walkthrough

随 Task 93 实施链（4 个实施批次 + 2026-07-09 审查修复轮）按「迁移同步点清单」硬切完成：

1. `plot-tools.ts`：写面合并为 7 个 `save_*`（必填 `action` 枚举 + 实体字段平铺可选 + 执行层按 action 校验并给可读中文诊断，如 create 缺 name/title、archive 与显式 status 冲突均点名报错）；读面改名 `get_story_tree` / `get_story_chapter` 并新增 `get_story_promise` / `get_story_decision`（无 id = 列表模式，D6）。
2. Act/Chapter 死代码按 D5 以 `save_story_act` / `save_story_chapter` 新形态直接注册（修 F1，不按旧形态过渡）。
3. `tools/index.ts` registry 挂 15 键；`profile-tools.ts` 输出 `plotReadBindings`（8）/ `plotWriteBindings`（7）bundle（D7），`builtin.plot.*` 逐项绑定保留。
4. leader.default / director / writer 三 profile 改 spread bundle，提示词工具名全量替换（grep 旧名清零）；审查修复轮补齐 writer `<tool_permissions>` 枚举（此前漏列两个新读工具）与 director 职责/工具边界/工作流程对 Promise/Decision 的覆盖。
5. reference 文档：system.md §Agent Tools 重写为 15 工具清单（含使用规则），agent-spec.md / writer-brief.md / leader-default.md 同步；审查修复轮补执行 D9 的 system.md refs 词表清理（删 `foreshadows`/`pays_off`）。
6. 测试：plot-tools.test.ts 全面改写 + writer/leader 契约测试 fixture 更新 + `bun run profile:metadata` 重编译。
7. **D8 落地（审查修复轮）**：确认 mode 系统等价机制已存在——`NeuroAgentTool.mutatesWorkspace` 元数据（`tool-registry.workspaceMutatingToolKeys()` 收集，harness 在 discuss/plan 只读模式对标注工具注入写审批），故**不另造 `mutates` 字段、跟随现状**；`tool()` helper 增加**必填** `options.mutates` 强制每个新 plot 工具显式声明读写意图，7 个 `save_*` 标 `mutatesWorkspace: true`（落库 project.sqlite 属 Project Workspace 状态变更，语义吻合 Task 90 只读模式意图）。plot 写面自此在只读模式下从提示词软约束升级为 harness 硬门控；Task 90 TODO 中「plot 走提示词软约束」的 tradeoff 对 plot 不再适用（bash / execute_sql / execute_world 等参数级读写工具仍按该 TODO 走软约束，待统一「改状态」标记 + 参数级判定）。

## 实施分片

- **Slice 1 — 现有面重排**：plot-tools.ts 写面合并（save_story_act/chapter/thread/scene）+ 读改名（get_story_tree/get_story_chapter）→ registry/builtin.plot/bundle → profile toolset 与提示词同步 → reference 文档同步 → 测试改写 + profile:metadata。验收含 F1 冒烟（leader 补 ChapterBrief 走出 needs_chapter_brief）。
- **Slice 2 —（归属 Task 93）** 规划层工具按本形态实施：`save_story_promise` / `save_promise_beat` / `save_story_decision` / `get_story_promise` / `get_story_decision`。本任务只定形态，实施与验收在 93 的分片内。

## TODO / Follow-ups

- **F1 真实会话冒烟**：见 §Verification 验收降级声明，待用户真实会话/浏览器验收时执行。
- **ledger 告警挂 `get_story_promise` 列表形态**：随 Task 93 消费点批次（lint/ledger 暂缓项）。
- `execute_world` 的 readonly/readwrite description 软门控是历史妥协，本任务不动；若将来做硬门控（Task 87 curated 模式的 harness seam），可复用 `mutatesWorkspace` 同一机制做参数级判定扩展。
