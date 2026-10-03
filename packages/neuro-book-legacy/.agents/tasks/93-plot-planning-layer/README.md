# Plot 规划层：Promise / Decision / 节奏字段

> 状态：**已实施（2026-07-09 审查修复轮收口）**——本次范围（数据层 + 维护/读取工具 + brief 消费段）全部落地，lint / ledger / report / workbench UI 仍暂缓（见 TODO）。设计定稿于 2026-07-08 三轮修订；实施经 4 个批次 + 1 个审查修复轮，见 §Implementation Walkthrough。遗留验收项（真实项目实测）见 §Verification。
>
> 2026-07-08 二轮修订要点：删 PromiseKind 三形态枚举（行为改由字段驱动）；cadence 降为提示性语义；Promise 自由文本收敛为三层分工（删 note）；伏笔类型改用按兑现机制的四分类 tags 词表；outcomeType 值域补全（null 不再承载业务语义，提炼为通用设计原则）；草稿系统化移出范围。
>
> 2026-07-08 三轮修订要点（对抗评审 + 用户拍板）：最小读取面并入 Slice 1（只写不读的账本无法跨会话维护）；**D25/D26 brief 消费拉回本次实施**（死账本风险处置：直接在 brief 消费，默认详细 brief，默认 writer 完美执行，写后核对交后续 critic）；按 D29 反扫自家 schema 补值——outcomeType 加 `passive`、DecisionStatus 加 `dropped`、beat 二态补 archived 映射；fulfilled 回退补多 payoff 边界；lint / ledger / report / UI 仍暂缓；plot 工具面重排已另立 [Task 97](../97-plot-tool-surface-redesign/README.md) 定稿（本任务实施前置）。

## Relative documents refs

- [reference/plot/system.md](../../../reference/plot/system.md)：Plot 两棵树、StoryThread/StoryScene、refs 词表（`foreshadows`/`pays_off` relation 已被本任务的 PromiseBeat 取代，D9 词表清理已执行）。
- [reference/plot/writer-brief.md](../../../reference/plot/writer-brief.md)：brief 9 段骨架与 status 阶梯（本任务 Slice 3 新增其中「本章 Promise 任务」段与「未决决策警告」段，见 D25/D26）。
- [docs/tasks/87-plot-two-trees-and-writer-modes](../87-plot-two-trees-and-writer-modes/README.md)：两棵树 + ChapterBrief 的来源任务；其 TODO「Plot Workbench UI 深化」「Thread 级 refs」与本任务相关。
- 外部调研（本轮完成，仓库在 `.agent/workspace/`）：
  - `storyforge`：伏笔一等实体 + 4 状态机 + 逾期检测 + 上下文注入（`src/lib/types/foreshadow.ts`、`src/lib/foreshadow/context.ts`）；candidate→confirmed 双层事实确认。
  - `oh-story-claudecode`：`追踪/伏笔.md` 账本 + F 编号 + 写前/写后闭环 + 密度阈值 + 审查规则（`skills/story-setup/references/templates/agents/consistency-checker.md`）。

## User Request / Topic

起点是「把伏笔系统做好」，经四轮讨论扩大为 **director 规划层**：

1. 现有系统（World Engine + 两棵树）都是**记录过去**（让 AI 不忘事），缺一个**面向未来**的规划层（让 AI 写得有逻辑、有意思）。
2. 核心诉求：**把藏在思维链中的规划思维持久化**——「为什么这里要这么安排」「这样写能激发读者兴趣」「这里安排一个伏笔，揭露时会产生什么戏剧性效果」。这些思维必须对人类透明（便于审查）、对下一个 Agent 可读（便于接手，不必重读全文重新推理）。
3. 用户提出 **Promise** 概念：感情线（发展/挫折/发糖）、性转线（周期性描写配给）、格里沙信仰线（人物弧）、伏笔——统一为「对读者的债务账本」，根据 Scene 动态更新（某场埋设、另一场呼应）。伏笔划入 Promise。
4. 用户引入 Sanderson 理论（MICE Quotient / Promise-Progress-Payoff / Yes-but,No-and / 张力呼吸感 / 第一定律伏笔公平性 / 角色能动性）及一份外部 AI 的映射方案，要求批判性整合。
5. 通过「阿斯塔利亚开局三章」模拟实测：结构决定与剧情点能落库，但**被否决方案、设计理由链、伏笔预期效果、强度阶梯、开放决策（含 deadline）、情绪曲线**全部蒸发——其中开放决策蒸发是事故级（下个会话的 Agent 会擅自写死或反复重新纠结）。
6. 2026-07-08 第二轮评审（用户意见）：cadence 只能是提示不能硬限制；质疑 PromiseKind 必要性并要求明确维护心智模型；给出按兑现机制的伏笔四分类（setup_payoff/prophecy/motif/mirror）；指出 payoffExpectation/note/summary 语义重叠；outcomeType 不要用 null 承载语义、显式语义利于 LLM；草稿暂不做（思维链 + ADR 够用）；消费点本次不实现。
7. 2026-07-08 第三轮（对对抗评审结论的拍板）：读取面缺口采纳，且经本次设计后**后续需对 plot 工具面整体重新调整设计**；死账本风险处置为「直接在 brief 消费」——默认使用详细 brief，**默认 writer 完美执行了 brief**（不做写后正文核对，核对交给后续 critic agent）。

## Goal

把规划思维从思维链升级为**入库、可查询的系统层**：新增 Promise（读者债务账本，含伏笔）+ Decision（ADR 式决策记录）两类实体与 Scene/Thread 节奏字段，并提供 Agent 维护工具（创建/推进/兑现/拍板）。**本次实施范围 = 数据层 + 维护/读取工具 + brief 消费段**（「本章 Promise 任务」+ open Decision 警告）；其余消费点（规划 lint、ledger/report 工具、UI）设计保留、暂缓实施、细节待专门讨论。验证方式：`bun test server/plot` 全绿 + 真实项目实测「建 Promise → 打 plant/advance/payoff beats → 读回详情与派生状态正确、Scene 状态变化后 beat 计划/事实二态正确、decide 转换与 risk 校验生效、目标章 brief 编译出 Promise 任务段与 open Decision 警告段」。实施中若发现与现有架构冲突，停下报告而不是 hack 绕过。

## Current State

- **已实施**：schema（StoryPromise / StoryPromiseBeat / StoryDecision + Scene/Thread 新字段）、服务层（派生/回退/decide 校验）、facade/HTTP、Agent 工具（按 Task 97 形态）、brief 两个消费段全部落地；详见 §Implementation Walkthrough。
- 实施前缺口（历史记录）：伏笔仅有 `StorySceneRef.relation` 自由字符串（`foreshadows`/`pays_off`）、Thread 当伏笔线的命名习惯、ChapterBrief 信息控制手填——无身份、无配对、无 deadline、无检查、不进 brief。
- Task 87 遗留（已由 [Task 99](../99-plot-planning-ui/README.md) 收口）：workbench 6 tab 空壳已重组为 3 个真 tab（线程规划/承诺账本/决策记录），refs 目标候选硬编码 demo 数据已改接真实内容节点数据。

## Decisions / Discussion

### A. 定位：四层图景

| 层 | 回答的问题 | 时态 |
| --- | --- | --- |
| World Engine | 世界里客观发生了什么 | 过去（事实） |
| 因果树 Phase→Thread→Scene | 事实如何编排成剧情 | 过去+近未来（编排） |
| 承载树 Act→Chapter→Prose | 读者按什么顺序看到什么 | 呈现 |
| **规划层 Promise/Decision（本任务）** | 我对读者许了什么愿、为什么这么安排 | **未来（债务与意图）** |

**D1 Thread 与 Promise 的区分口诀**（防 director 建错对象，写进 agent-spec）：推动事件因果的是 Thread（邪神复苏导致封印松动）；约束读者体验的是 Promise（读者要看到格里沙践行荣誉）。Thread 回答「接下来发生什么」，Promise 回答「我欠读者什么」。两者正交，Scene 是交点：一个 Scene 因果上属于一个 Thread，可同时服务多个 Promise。

### B. Promise 系统

**D2 Promise 统一心智模型，不设 kind 分类**（2026-07-08 修订：删除原 loop/arc/ration 三形态枚举）。不为伏笔单独建系统（「太久没发糖」和「伏笔逾期」是同一个检查器）；进一步，形态差异完全由**字段有无**驱动——有 `deadlineChapterId` 才有逾期概念，有 `cadenceChapters` 才有节奏提示，两者可同时存在（例：F2 项链既有「交汇事件章前必须揭示」的 deadline，又需要「每几章微呼应」的节奏提示——原三分类会强迫二选一，限制表达强度）。分类语义由 `tags` 承担（伏笔词表见 D8）。删 kind 后「是否还有未考虑到的 PromiseKind」问题随之消解：任何新承诺形态都是字段组合，无需扩枚举。

**Promise 的边界**：必须有「兑现」概念（向读者许愿 → 兑现）；纯约束（「全书不写 XX」）不是 Promise，归 Decision.risk 或 profile 约束。

**D2a 生命周期操作模型**（Agent 与系统如何维护 Promise）：

- **创建**：director/leader 在规划期（开卷设计/细纲）或成文复盘时调 `save_story_promise`（工具形态见 [Task 97](../97-plot-tool-surface-redesign/README.md)），写 summary（承诺内容）与 payoffExpectation（预期兑现效果）。writer 对 Promise 只读（与 Plot 只读一致）。
- **推进**：规划某场戏时决定「这场推进哪些线」→ `save_promise_beat`。**beat 的计划/事实二态是派生的**：beat 挂在 Scene 上，Scene.status 为 draft/active 时 beat 是计划，written/revised 后自动成为事实——beat 自身不设计划/事实字段（防漂移，延续 D5 派生原则）。
- **兑现**：打 payoff beat；服务层默认自动置 `fulfilled`（工具参数可关——弧光线里程碑后仍延续时不关）。
- **放弃**：显式置 `abandoned`（作者意图，不可派生）。
- **送达与闭环（writer 完美执行假设，三轮拍板）**：计划 beat 经 brief「本章 Promise 任务」段送达 writer（D25，本次实施）；**默认 writer 完美执行 brief**——Scene 标 written/revised 后计划 beat 即视为事实，不做写后正文核对；「正文是否真的兑现了 beats」的核对交给后续 critic agent（见 TODO）。
- **系统职责**：只做派生展示与提醒，不自动创建、不自动打 beat（comment 提取候选是后置增强）；ledger/lint 属暂缓消费点。

**D3 PromiseBeat 挂 Scene**（不挂 Chapter）：埋/呼/收都「发生在某场戏里」，粒度比章细，自动继承 World Engine 时间锚；这就是「Promise 根据 Scene 动态更新」的落地。storyforge/oh-story 锚章是因为它们没有 Scene 实体。

**D4 beat kind 四枚举**：`plant`（建立）/ `advance`（推进/呼应/投喂）/ `setback`（反挫，含伏笔的假揭露）/ `payoff`（兑现）。同一 Scene 对同一 Promise 只打一个 beat（`@@unique([promiseId, sceneId])`，kind 取主导）。

**D5 状态派生优先**：planted/echoed 等中间态从 beats 派生，结构上不可能漂移。存储态仅 `open / fulfilled / abandoned`（作者意图）。`fulfilled` 在打 payoff beat 时由服务层自动置（工具参数可关——里程碑式兑现后线仍延续的场合，如感情线「在一起」之后还有后续）。**回退边界（三轮补）**：删除或 archive 场景后**不再存在任何有效 payoff beat** 时才把 `fulfilled` 回退 `open`——弧光线多里程碑（多个 payoff beat）删其一不回退；手动置的 fulfilled 若被误伤，重置一次即可（工具幂等）。**archived 场的 beats 不参与任何派生**（视同不存在，记录保留）——D2a 的映射由此补全为三态：draft/active=计划，written/revised=事实，archived=不参与。

**D6 节奏字段两个（2026-07-08 修订 cadence 语义）**：`cadenceChapters?` 是**提示性参考节奏，不是硬约束**——「每 N 章必须一次描写」太机械，写作要恰到好处；它是 agent 记录节奏意图的地方，检查器只据此生成中性提示（「距上次推进已 N 章，参考节奏 M 章，可考虑安排」），永不阻断。`deadlineChapterId?` 是兑现期限（前沿越过即 overdue 警告——伏笔悬置属于真实风险，保留警告级）。两字段可同时存在（见 D2）。

**D7 自由文本三层分工，消费点互斥（2026-07-08 修订：删 `Promise.note`）**。原 summary/payoffExpectation/note 三个自由文本字段语义重叠，Agent 填写时无所适从。收敛为：

- `summary` = **向读者许了什么**（账本列表与规划上下文展示用）；
- `payoffExpectation?` = **兑现时预期的戏剧效果**（只给兑现场的 writer——「揭露时读者会回读第一章的改口细节产生 aha」的持久化，让 writer 知道这条线「图什么」）；
- `beat.note` = **单次推进的具体指示**（只给该场的 writer——「本次只写到发烫，不许发光」；强度阶梯天然分布在各 beat 的 note 上，不需要线级计划字段）。

三者回答的问题、消费时机、消费者各不相同，无重叠。

**D8 伏笔类型：按兑现机制四分类，做推荐 tags 词表不做枚举**（2026-07-08 修订，采纳用户给出的分类学；storyforge 按题材内容分的 10 类型仍判为过度）。四类连同兑现机制说明写进 agent-spec，供 LLM 显式理解（见 D29 显式语义原则）：

- **`setup_payoff`** —— 契诃夫之枪（含「角色身份」子情形）：具体元素、因果性回收、单点触发。公平性要求最严格（必有 plant，`payoff_without_plant` 检查的主要对象）。
- **`prophecy`** —— 预言/悬念（含「时间线」子情形）：明确断言，字面式或反讽式兑现；兑现方式写进 payoffExpectation（「预言按字面应验但代价出人意料」）。
- **`motif`** —— 象征/母题：意象重复、累积式/情绪式兑现，**不要求单点触发**。典型字段形态 = 无 deadline、有 cadence 提示、advance 累积，payoff 可选（意象完成时的情绪收束场）。
- **`mirror`** —— 镜像/平行：两条以上线索互相映照、比较式兑现，需要双线关联。**双线关联不需要新结构**：beats 挂 Scene 而 Scene 分属不同 Thread，一条 mirror Promise 的 beats 天然跨线分布（陈瑶↔薇洛丝镜像线的 beats 打在两人各自的场上），关联由 beats 分布自然表达。

`importance` 保留三档 low/medium/high（即「等级」——密度加权与摘要排序用）。

**D9 refs 清理**：`StorySceneRef` 推荐 relation 词表删除 `foreshadows`/`pays_off`（被 PromiseBeat 结构化取代），refs 退回纯引用职责。快速开发阶段，存量数据不迁移。

### C. Decision 系统（ADR 式）

**D10 Decision 独立表，不并入 Promise、不做节点嵌入属性**。理由：消费者不同——Promise 编译进 writer brief（正文别欠债），Decision 注入 director 规划上下文（规划别忘拍板、writer 别擅自写死）；嵌入属性做不了「扫描全部 open 决策」「一个决策服务多个实体」「决策自身生命周期」三件事。

**D11 生命周期 `open → decided → superseded / dropped`**：

- open 态：`question` + `options`（候选方案）+ `deadlineChapterId?`（如「莉雅误召真相必须在第 10-15 章前拍板」）；
- decided 态：`decision` + `motivation` + `rejectedAlternatives`（未选项及否决理由，decide 动作时从 options 转换生成）+ **`risk` 必填**（服务层校验）——risk 是 writer 的刹车点（「可理解部分写过重会削弱厌恶感，需控制配比」），没有 risk 的决策只告诉 Agent 往哪走没告诉哪停；
- superseded：被新决策取代，`supersededById` 链接；
- dropped（三轮按 D29 补值）：问题因剧情改道**失效**——既没拍板也没被新决策取代（如「鉴定异常机制二选一」随子情节整体删除而失去意义），失效原因写 note。原三值域漏掉「问题不复存在」这一业务状态。

**D12 挂靠与引用**：主锚点用 `anchorKind`（`story/act/chapter/thread/scene/promise/content`）+ 可空外键组（content 用 `anchorPath` 存 content-node 路径，如陈瑶人设决策锚 `lorebook/character/chen-yao/`），复用 `StorySceneRef` 的 targetKind 先例；`anchorKind=story` 无独立外键——`storyId` 本身就是 story 锚（表示「锚在全书层，无更窄锚点」）。`serves` / `dependsOn` 用 JSON 字符串数组存轻量引用——决策量级小（全书几百条封顶），反向查询全表扫可接受，不建关联表（有 `StoryThread.tags` JSON 先例）。**引用格式规范**（与 system.md 现有 refs 写法一致）：剧情对象用 `promise://{id}` / `decision://{id}` / `thread://{id}` / `scene://{id}`，内容节点用 Project Workspace 相对路径（`lorebook/...`）；服务层写入时校验格式与 id 存在性。**实现注记（三轮补）**：anchor 外键被 SetNull 后的 anchorKind 回退用**读时归一化**（anchorKind=scene 而 anchorSceneId 为 null → 视同 story），不做写时回退——删 Scene 走 scene 服务，不知道 Decision 的存在，写时回退有洞；`serves`/`dependsOn` 的死引用（目标被删，JSON 无 SetNull 保护）读取时容错标注失效、不做级联清理；`record_promise_beat`（→ Task 97 定稿名 `save_promise_beat`）的 scene×promise 与 Decision 的各 anchor 外键写入时须过 `plot-scope.guard` 同 story 校验（Task 87 的 assertAct/assertChapter 模式）。

**D13 不建 theme 实体**：「身份与腐蚀的镜像对照」这类主题 = 一条 story 级弧光 Promise，Decision.serves 指向它即可。

**D14 何时记 Decision 的启发式**（写进 director profile/skill）：*如果这个决策的理由不写下来，换一个 Agent 接手时大概率做出不同或更差的选择，就必须记。*

### D. Sanderson 工具映射（对外部 AI 方案的裁决）

**D15 采纳**：`StoryThread.miceType?`（`milieu/idea/character/event`，可选，复合线取主导）——消费点是「这条线怎样才算关」的语义提示（I 线=谜底揭晓，C 线=身份认同达成），进 director 规划上下文与 planning report。

**D16 采纳（2026-07-08 修订值域，三轮再补 `passive`）**：`StoryScene.outcomeType?` 值域为 `yes_but / no_and / yes_and / no_but / yes / no / no_conflict / passive`。**null 只表示「未填写」，不再承载「非冲突场」语义**——无冲突/日常/纯信息场显式填 `no_conflict`；干脆的成功/失败显式填 `yes` / `no`（爽文碾压场是 plain yes 的正当用法；原设计枚举里没有 plain 值，Agent 遇到这类场只能乱填 yes_but 污染数据，补全后「连续 plain 停滞」反而可检查）；`passive` = 本场主要角色只承受、未主动尝试（被绑走/被审讯不反抗/旁观大事件）——它与 `no_conflict` 是两种业务状态，混填会把能动性失守藏进正当的喘息场里，显式 `passive` 让 Agency 失守可直接计数（连续 passive 由 `outcome_monotone` 覆盖）。`StoryScene.pacingRole?`（`setup/escalation/breather/climax/resolution`，值域本身完整，null=未填无歧义）。outcomeType 定义锚定为「**本场主要行动者主动尝试**的结果」，不另建能动性字段。

**D29 由此提炼通用设计原则（全系统推广）**：**枚举值域必须覆盖全部业务语义，null 只表示「未填写」，绝不用 null 承载一种业务状态**；显式的语义值对 LLM 的理解与生成都显著更好（LLM 面对 null 无法区分「没想好」和「刻意如此」）。后续所有 schema 与工具参数设计遵循此原则。

**D17 修正（最重要）：节奏 lint 的坐标系是承载树章序，不是因果树**。读者感受的节奏由章序决定，因果树相邻两场可能隔三章。节奏字段挂 Scene，但所有节奏检查把 Scene 按 `chapterId + chapterSortOrder` 投影到章序后计算，检查窗口是「连续若干章 / 同一 Act」，不是 Phase。

**D18 修正：`openedAt/closedAt/nestingParent` 不做存储字段，全部派生**。线在读者视角的开=首个挂章 Scene 的章序位，关=payoff beat 所在章，嵌套=开闭区间的包含关系。存储即三个会漂移的冗余真相源。规划期（Scene 未挂章）的前瞻检查用 Promise `deadlineChapterId`。

**D19 修正：MICE 括号匹配为提示级 lint，主线（isMainThread）豁免**，不阻断。Sanderson 原话是「通常」；网文支线交错开闭常见。检查不依赖 miceType（只依赖开闭区间），所有非主线 Thread 参与。

**D20 修正：`yes_and` 不标慎用**——升级流的爽点连击就是 yes-and 链，是特性不是 bug。单调检测保留但阈值放宽（默认连续 5 场同型才提示）。

**D21 砍掉：`tensionLevel 0-10`**。虚假精度（AI 跨会话打分不稳、人也标不准），下游只消费高中低三档信息而 pacingRole 已携带（climax/breather 即局部极值）。张力可视化从 pacingRole 序列画分级折线。

### E. 草稿（2026-07-08 修订：移出本任务范围）

**D22 草稿暂不做系统化**：思维链内打草稿 + Decision（ADR）已够用——规划思考中值得持久化的「决策 + 理由 + 否决案」已由 Decision 承接，剩余自由发散留在思维链成本最低。原「workspace markdown 草稿目录 + candidate→confirmed 采纳流 + `<comment>` 三层互指」设计整体降级为 Follow-up（见 TODO），待 Decision 实际使用暴露真实需求后再启。判断标准保留为原则：**会被编译器/检查器消费的进 DB，只被人和 director 阅读的留文件**（lint 结果是派生物，实时计算不落库，不在此列）。

### F. 消费点（三轮拍板：D25/D26 本次实施；D27/D28 与 UI 暂缓）

> 2026-07-08 三轮拍板：**D25（brief Promise 任务段）与 D26（open Decision 警告段）拉回本次实施**——死账本风险的处置是让数据层立即有 brief 消费闭环（计划 beat 送达 writer 才可能成为事实，见 D2a 完美执行假设）。D27-D28（ledger / report / lint）与 workbench UI 仍暂缓、待专门讨论。

**D25 brief 编译器新增「本章 Promise 任务」段（本次实施）**（插在「关键剧情点」之后）：本章 scenes 的 beats → `[建立]/[推进]/[反挫]/[兑现]` 指令 + beat.note + 兑现场附 payoffExpectation（指令措辞参考 storyforge：埋设「自然埋下线索，不要提前解释答案」/ 推进「侧面提及制造回忆但保持悬念」/ 兑现「揭示兑现，避免只重复提示」）。**默认详细形态**（beat.note 与 payoffExpectation 全文输出，不做精简档）。原设计的段尾全局告警摘要（overdue/stale top-N）依赖 lint 计算，**随 D28 暂缓**——本次只编本章 beats 的直读数据；status 阶梯不动。

**D26 open Decision 注入 brief 为警告段（本次实施），第一版不做 status 阻断**。触及判定：anchor 命中本章 / 本章内 Scene / 本章 Scene 所属 Thread / 本章 beats 的 Promise，以及 story 级且 deadline 距本章 ≤3 章的。措辞「此处有未决决策 D-x，候选是…，不得擅自写死」。不阻断的理由：story 级 open 决策会误伤所有章；观察实际使用后再决定是否升级为 `needs_decision` status 档（记入 TODO）。

**D27 director 规划工具 `get_promise_ledger` + `get_planning_report`**：前者返回开放 Promise 账本（含派生告警），后者返回规划 lint 体检报告——这是「提醒后续 Agent 规划时考虑这些因素」的落点。

**D28 规划 lint 清单**（实时计算不落库，全部按章序投影；Scene 未挂章的 beat 不参与顺序类检查、参与存在性检查）。

**写作进度前沿（frontier）定义**——`*_overdue` / `*_stale` 三条 lint 的基准坐标：前沿 = 承载树章序投影中最后一个「有成稿迹象」的章的序位；成稿迹象 = 该章下存在 status ∈ {written, revised} 的 Scene，**或**该章有 Prose frontmatter 反指（复用 `ChapterProseService`），两个信号取较大者。全书无成稿迹象时前沿为 0，overdue/stale 类 lint 静默（规划期不告警）。

| lint | 规则 | 级别 |
| --- | --- | --- |
| `promise_overdue` | 前沿超过 deadlineChapter 章序仍未 payoff | 警告 |
| `promise_stale` | 前沿距上次 beat 所在章的章数 > cadenceChapters（中性措辞：「可考虑安排」） | 提示 |
| `promise_density` | open Promise 数按 importance 加权超阈值（参考 oh-story：单卷开放 ≤15-20） | 提示 |
| `payoff_without_plant` | 有 payoff beat 无 plant beat（收了没埋 = 机械降神，Sanderson 第一定律的结构化底线） | 警告 |
| `beat_order_inverted` | payoff 所在章序 < plant 所在章序 | 警告 |
| `mice_bracket_cross` | 非主线 Thread 开闭区间交叉（腰斩嫌疑） | 提示 |
| `consecutive_climax` | 连续 N 章 pacingRole=climax 无 breather | 提示 |
| `act_no_climax` | 一个 Act 内无任何 climax | 提示 |
| `outcome_monotone` | 连续 ≥5 场同 outcomeType | 提示 |
| `decision_overdue` | open Decision 的 deadline 章序 < 前沿 | 警告 |

## Schema 草案（Prisma，`prisma/project.schema.prisma`）

```prisma
enum StoryPromiseStatus { open fulfilled abandoned }
enum StoryPromiseImportance { low medium high }
enum StoryPromiseBeatKind { plant advance setback payoff }
enum StoryDecisionStatus { open decided superseded dropped }
enum StorySceneOutcomeType { yes_but no_and yes_and no_but yes no no_conflict passive }
enum StoryScenePacingRole { setup escalation breather climax resolution }
enum StoryThreadMiceType { milieu idea character event }
enum StoryDecisionAnchorKind { story act chapter thread scene promise content }

// 规划层:对读者的债务。不设 kind 分类——行为由字段有无驱动:
// 有 deadlineChapterId 才有逾期概念,有 cadenceChapters 才有节奏提示,两者可同时存在。
model StoryPromise {
  id                Int                    @id @default(autoincrement())
  storyId           Int
  name              String                 // per-story 唯一 slug,供互指引用
  title             String
  status            StoryPromiseStatus     @default(open)
  importance        StoryPromiseImportance @default(medium)
  summary           String                 @default("") // 向读者许了什么(账本展示用)
  payoffExpectation String?                // 兑现时预期的戏剧效果(只给兑现场 writer)
  cadenceChapters   Int?                   // 提示性参考节奏,非硬约束;null=无节奏提示
  deadlineChapterId Int?                   // 兑现期限;null=无逾期概念
  tags              String                 @default("[]") // 伏笔四词表 setup_payoff/prophecy/motif/mirror 等
  createdAt         DateTime               @default(now())
  updatedAt         DateTime               @default(now()) @updatedAt
  story             Story                  @relation(fields: [storyId], references: [id], onDelete: Cascade)
  deadlineChapter   StoryChapter?          @relation(fields: [deadlineChapterId], references: [id], onDelete: SetNull)
  beats             StoryPromiseBeat[]

  @@unique([storyId, name])
  @@index([storyId, status])
}

// Promise 在某场戏上的推进记录。同场同线仅一条,kind 取主导。
model StoryPromiseBeat {
  id        Int                  @id @default(autoincrement())
  promiseId Int
  sceneId   Int
  kind      StoryPromiseBeatKind
  note      String?              // 本次推进的规划说明:"只写到发烫,不许发光"
  createdAt DateTime             @default(now())
  updatedAt DateTime             @default(now()) @updatedAt
  promise   StoryPromise         @relation(fields: [promiseId], references: [id], onDelete: Cascade)
  scene     StoryScene           @relation(fields: [sceneId], references: [id], onDelete: Cascade)

  @@unique([promiseId, sceneId])
  @@index([sceneId])
}

// 规划层:ADR 式决策记录。open 态防 writer 写死,decided 态供审查与接手。
model StoryDecision {
  id                   Int                     @id @default(autoincrement())
  storyId              Int
  name                 String                  // per-story 唯一 slug(如 d-liya-truth)
  title                String
  status               StoryDecisionStatus     @default(open)
  question             String                  // 待决问题(open 态核心)
  options              String                  @default("[]") // [{option, note}]
  deadlineChapterId    Int?                    // 必须在此章前拍板
  decision             String?                 // 结论;decided 时非空(服务层校验)
  motivation           String?                 // 为什么;decided 时非空
  rejectedAlternatives String                  @default("[]") // [{option, whyRejected}],decide 时从 options 未选项转换
  risk                 String?                 // 刹车点;decided 时必填(服务层校验)
  serves               String                  @default("[]") // ["promise://3","lorebook/character/chen-yao/"]
  dependsOn            String                  @default("[]") // ["decision://2"]
  supersededById       Int?
  anchorKind           StoryDecisionAnchorKind @default(story)
  anchorActId          Int?
  anchorChapterId      Int?
  anchorThreadId       Int?
  anchorSceneId        Int?
  anchorPromiseId      Int?
  anchorPath           String?                 // anchorKind=content 时的 content-node 路径
  note                 String?
  createdAt            DateTime                @default(now())
  updatedAt            DateTime                @default(now()) @updatedAt
  story                Story                   @relation(fields: [storyId], references: [id], onDelete: Cascade)
  // anchor 外键均 SetNull;读取时归一化:anchorKind 对应外键为 null 时视同 story(不做写时回退)

  @@unique([storyId, name])
  @@index([storyId, status])
}
```

已有表加字段：

```prisma
model StoryThread {
  miceType StoryThreadMiceType? // 线型:决定"怎样才算关"(idea=谜底揭晓,character=身份认同达成)
}
model StoryScene {
  outcomeType StorySceneOutcomeType? // 本场主要行动者主动尝试的结果;null 仅=未填写,非冲突场填 no_conflict,被动承受场填 passive
  pacingRole  StoryScenePacingRole?  // 张弛角色;节奏 lint 按章序投影消费
}
```

DTO 层新增 `StoryPromiseDtoSchema` / `StoryPromiseBeatDtoSchema` / `StoryDecisionDtoSchema` 及对应 zod 枚举，风格对齐 `shared/dto/plot.dto.ts` 现有 z.enum 小写值。

> 草案省略事项（实施时按 Prisma 硬性要求补全，不构成设计变更）：Story 侧补 `promises StoryPromise[]` / `decisions StoryDecision[]` 反向关系；StoryChapter 侧补 Promise.deadlineChapter 与 Decision.anchorChapterId 的反向关系（同模型多关系需显式 `@relation("name")` 命名）；StoryScene 侧补 `promiseBeats StoryPromiseBeat[]`；StoryDecision 的五个 anchor 外键与 `supersededById` 自引用同样需要 `@relation` 命名。

## Agent 工具面

> 工具形态已由 [Task 97 plot 工具面重排](../97-plot-tool-surface-redesign/README.md) 定稿（2026-07-08 五点拍板：save_* 合并 + 显式 action + 读改名 + 生命周期动作进 action），本节按新形态记录；Task 97 为本任务实施前置。

**维护（本次实施）**：`save_story_promise`（action: `create/update/abandon/fulfill`）、`save_promise_beat`（action: `set/remove`，自动 fulfilled 逻辑开关）、`save_story_decision`（action: `create/update/decide/drop`，decide 强制 risk）；现有工具随 Task 97 合并为 `save_story_scene` / `save_story_thread` 并携带新字段（outcomeType/pacingRole、miceType）。
**读取（本次实施，三轮补——裸数据直读，非派生告警；只写不读的账本无法跨会话查重/复盘/推进）**：`get_story_promise(promiseId?)`（无 id=摘要列表，有 id=详情：字段 + beats 及所在场/章位 + 派生态；原 list_story_promises 并入此工具）、`get_story_decision(decisionId?)`（无 id=open 优先列表，Task 97 补漏）、`StorySceneDetailDto` 增 `promiseBeats`（`get_story_scene_context` 顺带获得「这场服务哪些线」视角）、`get_story_tree`（原 get_plot_tree）附带 openPromiseCount 与 Scene/Thread 新字段透出。
**brief 消费（本次实施）**：`get_chapter_writer_brief` 无签名变化，输出新增「本章 Promise 任务」段与 open Decision 警告段（D25/D26）。
**暂缓（随消费点讨论）**：ledger 派生告警挂 `get_story_promise` 列表形态、`get_planning_report`（lint 体检）。

## 实施分片（2026-07-08 三轮重排：读取面与 brief 消费拉回）

- **Slice 1 — Promise 数据层 + 读取面**：schema（Promise/Beat + Scene/Thread 新字段一次迁移）→ 服务层（状态派生、fulfilled 自动置与多 payoff 回退边界、beat 计划/事实/archived-不参与三态随 Scene.status 派生）→ facade/HTTP → agent 维护 + 读取工具。验收：真实项目建 Promise → 打 plant/advance/payoff beats → 读回详情与派生态正确、Scene 状态流转/archive/删除的联动正确。
- **Slice 2 — Decision**：表 + 服务（decide 转换、risk 必填校验、dropped、anchor 读时归一化）→ 维护工具。
- **Slice 3 — brief 消费**：「本章 Promise 任务」段（详细形态）+ open Decision 警告段接入 `chapter-writer-brief.service.ts` 分段渲染；status 阶梯与工具签名不动。验收：目标章有计划 beats 与触及的 open Decision 时 brief 编译出对应段落，无数据时段落不出现。
- **随片文档**：system.md 登记新实体与 refs 词表清理、agent-spec.md 补 D1 口诀 + D8 伏笔四词表 + D14 启发式、writer-brief.md 补两个新段（随 Slice 1/2/3 走，不单列）。
- **暂缓（待消费点专门讨论后再排）**：章序投影 + 十条 lint、`get_promise_ledger` / `get_planning_report`、workbench UI（含 Task 87 遗留空 tab/demo 数据清理）。

测试策略：状态派生、beat 三态联动、fulfilled 回退边界、decide 转换、brief 新段渲染写测试；CRUD 薄层不过度测试。

## Verification / Test

已实施（含 2026-07-09 审查修复轮；按 shard 隔离跑，未全仓并跑）：

- `bun test ./server/plot`：70 pass / 15 files——promise 派生与 fulfilled 回退边界（多 payoff 不回退、archived 场不算有效 payoff、只回退 fulfilled 等）、decision decide/drop/superseded 不变式与 chosenOption 骨架、anchor 与 serves/dependsOn 格式/存在性校验、brief「本章 Promise 任务」与「未决决策警告」渲染（含触及判定六分支）、Scene archive/delete → 回退联动接线顺序断言、Thread delete → 回退联动接线顺序断言。
- `bun test ./server/agent/tools`：147 pass（`save_story_promise` / `save_promise_beat` / `save_story_decision` 的 action 校验与诊断、两读工具列表/详情双模式、读写元数据守护）。
- `bunx vitest run server/agent/profiles`：170 tests + `bun run profile:metadata` 重编译通过（整 shard 下 catalog publisher 用例偶发负载超时，单跑全过，非回归）。
- `bun x prisma generate --schema prisma/project.schema.prisma` 随 schema 变更执行。
- `bun run typecheck`：plot 相关文件 0 error。
- **真实项目实测未执行（验收降级声明）**：Goal 中「建 Promise → 打 plant/advance/payoff beats → 读回派生态 → decide 转换 → 目标章 brief 编译出两段」的端到端链路已由上述服务层 + 工具层单测分段覆盖（工具→facade→服务→brief 的接线各段均有断言），但未在真实项目/真实 Agent 会话跑通全链；与 Task 97 的 F1 冒烟合并列入待办，待用户验收时执行。

## Implementation Walkthrough

按「实施分片」以 4 个实施批次 + 1 个审查修复轮（2026-07-09，三维审查 15 findings）完成：

- **Slice 1 — Promise 数据层 + 读取面**：`prisma/project.schema.prisma` 一次迁移落全部新表与枚举——`StoryPromise` / `StoryPromiseBeat` + `Scene.outcomeType/pacingRole` + `Thread.miceType`，`StoryDecision` 表与其枚举也提前随此迁移建齐（见偏差节）；`PromiseService` 实现存储态仅 open/fulfilled/abandoned、中间态从 beats 派生、payoff 自动置 fulfilled（`autoFulfill` 可关、archived 场不触发）、回退边界 `revertFulfilledWithoutValidPayoff`（注释里维护「调用清单」：凡能让 Scene/beat 消失或失效的路径都必须过此入口）；beat 计划/事实/archived 三态随 Scene.status 派生；facade/HTTP + `save_story_promise` / `save_promise_beat` / `get_story_promise` 工具（Task 97 形态）。
- **Slice 2 — Decision**：`StoryDecision` 表 + `DecisionService`——状态不变式对合并后最终字段状态校验（decided 需 decision/motivation/risk 非空，dropped 需 note 写失效原因，superseded 需 supersededById）、decide 转换从 options 未选项生成 rejectedAlternatives 骨架、anchor 读时归一化（外键 SetNull 后视同 story）、serves/dependsOn 写入校验格式与同 story 存在性、读取死引用容错标注；`save_story_decision` / `get_story_decision` 工具。
- **Slice 3 — brief 消费**：`chapter-writer-brief.service.ts` 新增「本章 Promise 任务」段（D25 详细形态：[建立]/[推进]/[反挫]/[兑现] 指令措辞 + beat.note 全文 + 兑现场附 payoffExpectation；archived 场不下发、abandoned 线不下发）与「未决决策警告」段（D26：anchor 四分支 + 本章 beats 的 Promise + story 级 deadline ≤3 章，「不得擅自写死」措辞，不做 status 阻断）；DTO 增 `promiseTasks` / `openDecisions` 结构化字段；status 阶梯与工具签名未动。
- **随片文档**：system.md 登记三实体与 15 工具清单、agent-spec.md 补 D1 口诀 + D8 伏笔四词表 + D14 启发式、writer-brief.md 补两个新段。
- **审查修复轮（2026-07-09）**：补执行 D9 refs 词表清理（system.md 删 `foreshadows`/`pays_off` + 改用 `save_promise_beat` 指引）；`deleteStoryThread` 补 Promise 回退联动（Thread 删除 = 批量 Scene 删除，与 `deleteStoryScene` 同模式：先按场收集受影响 Promise → 删除 → 统一回退）并为 Scene/Thread 两处联动接线补顺序断言测试（防「算法对、接线漏」再发）；Decision anchor 的 content 路径复用 serves/dependsOn 的路径卫生规则（拒绝绝对路径/盘符/反斜杠/目录穿越）；decide 时 `chosenOption` 与显式 `rejectedAlternatives` 同传显式拒绝（消灭静默失效）；brief Decision 触及判定的 Promise 集合改为直接取本章全部场 beats（含 archived 场，与 Scene/Thread「宁多勿漏」口径对齐并同步注释）；writer/director 提示词与 writer skill 补 `get_story_promise` / `get_story_decision` 枚举与规划层职责；Task 97 D8 mutates 元数据落地（7 个 save_* 标 `mutatesWorkspace`，只读模式硬门控）。

### 与设计的偏差（实施中拍板，已接受）

- **schema 全量一次迁移提前**：Decision 表与全部新枚举随 Slice 1（Promise 批次）的 schema 迁移一次建齐，Slice 2 只做服务/DTO/工具/HTTP——少跑一轮 prisma generate；分片边界只影响执行顺序，实体形态与设计一致。
- `Decision.deadlineChapterId` 不建外键（Promise 侧 deadlineChapter 有 SetNull 外键，Decision 侧随建表拍板省掉）：写入时过 `plot-scope.guard` 同 story 校验，读取按需查章表容错——id 非空而 deadlineChapter 摘要为空即「期限章已删」，字段组合表达；brief 的 story 级期限判定此时无从计算章序、不触发。
- Decision anchor 的工具/DTO 输入归一为 `{kind, id?, path?}` 三字段（服务层解析为各外键落库），不是 schema 草案的逐外键平铺——LLM 参数面更简洁，存储形态不变。
- beats 的 HTTP 面为 `PUT /promises/:id/beats`（upsert）+ `DELETE /promises/:id/beats/:sceneId`，不是独立子资源 CRUD（同场同线仅一条的 upsert 语义天然贴合）。
- decide 转换加 `chosenOption` 可选参数（「未选项」隐含被选项概念）：传则排除被选项、其余 options 转 rejectedAlternatives 骨架（不命中 options 报可读诊断），不传 = 结论为全新方案、全部候选转骨架；显式提供 `rejectedAlternatives` 视为整体替换（跳过骨架生成），与 `chosenOption` 同传显式拒绝。
- dropped 强制 note 非空（D11「失效原因写 note」的服务层校验实现）。
- brief 两段的措辞与判定细化：D25 三条参考措辞扩写为四 kind 完整指令句（模块级常量 `PROMISE_BEAT_DIRECTIVES`，将来 curated 精简档 / critic 核对可复用）；abandoned 线的 beats 不下发任务（设计未明说——已放弃的线不该指示 writer 推进）；story 级 open Decision 的「deadline 距本章 ≤3 章」实现为含期限已到/已过（未决而期限已过更需警告，措辞区分「已到而仍未拍板」/「临近」）。
- `get_story_tree` 摘要计数除 `openPromiseCount` 外加了 `openDecisionCount`。
- 真实项目实测降级为单测链路覆盖 + 待真实会话验收（见 §Verification）。

## TODO / Follow-ups

- **真实项目实测 / F1 真实会话冒烟**（验收降级遗留）：端到端链路目前只有单测分段覆盖，见 §Verification 声明；与 [Task 97](../97-plot-tool-surface-redesign/README.md) 的 F1 冒烟一并在用户真实会话/浏览器验收时执行。
- **消费点专门讨论**（数据层落地后；brief 段已拉回本次，见 D25/D26）：章序投影 + 十条 lint、`get_promise_ledger` / `get_planning_report`、workbench UI、「是否升级为 `needs_decision` 硬阻断」。设计意向见 D27-D28。**workbench UI 的直读部分已由 [Task 99](../99-plot-planning-ui/README.md) 先行落地**（承诺账本/决策记录两 tab + 节奏字段编辑 + Scene 侧 beats 芯片）；lint/ledger/报告与告警展示仍待此批次。
- **writer 执行核对 critic**（三轮用户点名）：「默认 writer 完美执行 brief」是有意简化，误差回收交给写后 critic——审查正文是否真的兑现了本章计划 beats（oh-story「细纲说要回收、正文真回收了吗」断线检查的 agent 化），可与下条 `<comment>` 提取合流为同一机制（正文锚点既是候选 beat 来源也是核对证据）。
- **草稿系统化**（已从本任务移出，见 D22）：如 Decision 实际使用后仍暴露自由草稿的持久化需求，再启「workspace markdown 草稿目录 + candidate→confirmed 采纳流」；届时需确认 Agent 文件工具路径映射白名单（当前仅 `lorebook/`、`manuscript/`、`workspace/`）。
- **`<comment>` → beat 候选提取**（后置增强，与 critic 条合流）：正文里 `<comment>promise://f-necklace 第二次呼应</comment>` 由索引器提取为候选 beat，director 确认后落库。
- **curated 模式的 Promise 段形态**：等 Task 87 遗留的 curated 模式落地后再设计（当前只有 autonomous）。
- **字段覆盖率风险**：outcomeType/pacingRole 可选 → director 不填则未来节奏 lint 无米下锅。缓解：director profile 要求关键场必填 + planning report 头部报告字段覆盖率。
- **lint 阈值可配置**：outcome_monotone 连续 5、密度 15-20 等默认值先硬编码常量，需要时再进 settings。
- Task 87 遗留合并追踪：workbench 深化并入消费点批次；Thread 级 refs 泛化独立不动。
