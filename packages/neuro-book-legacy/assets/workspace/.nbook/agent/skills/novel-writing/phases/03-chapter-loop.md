# 环节三：正文循环（写作 → 评审 → 修订）

指导 leader 调用普通 `writer` profile 把设计好的章节写成正文，然后评审、修订到可交付。原理见 `reference/world-engine/workflow.md` 第 6 节 Leader-Writer 协作；本文只讲操作流程。

本环节不负责重新设计剧情。默认前提是本章剧情事实已经在环节一/二中由用户确认，并且涉及的状态变化已经落进 World Engine。若用户只是说“写这一章”但剧情事实、时间范围、参与角色或结尾位置还没确认，先回环节一/二，再回来调用 writer。

核心契约：**writer 对 World Engine 只读**。所以协作围绕"写作前 leader 已经把世界状态推进好"展开——leader 先演化世界、设计剧情，再调用 writer；writer 自己查询 World Engine 写正文。

## 前置检查

开始前确认：

- 当前 Project Workspace 明确。
- 目标章节内容节点存在，例如 `manuscript/001-volume/001-chapter/`，其中 `index.md` 是写入目标。**若目标章节节点还不存在（新用户写第一章时常如此），先用 `workspace node new manuscript/NNN-volume --type volume` 建卷，再用 `workspace node new manuscript/NNN-volume/NNN-chapter --type chapter` 建章节，再继续。**
- World Engine 已初始化（有 calendar、纪元锚点、需追踪的角色 subject）。**若未初始化，先走 `novel-setup` 阶段四，再回来写章节。**
- 本章剧情事实已经确认，且已在环节二落入 World Engine。若还没有确认，不要在本环节里替用户临时定稿。
- 需要设定上下文时，已确定要建议 writer 读取的 lorebook 内容节点 path。

## 第一步：写作前先推进 World Engine（关键）

**世界状态先行。** 在调用 writer 之前，leader 先确认本章要发生的剧情事件已经按时间顺序写入 World Engine（解封、交流、追入、对峙……）。如果环节二已经推进过，只需用 `execute_world` 抽查相关 subject 和时间范围；如果还没推进，先回环节二完成剧情事实确认与状态写入，不要在本环节边设计边写。

推进时遵循**最少支持当前叙事**原则（详见 `reference/world-engine/recording-principles.md`）：

- 群体角色先用单一 subject 表示整体（"邪教徒巡逻队"而不是逐个邪教徒），需要时再拆分重要个体。
- 每个 subject 通常 1-2 条切面（起因 + 当前状态），不记录每一个细节行动。
- 临时龙套不建 subject，只在主角切面的 `events` 文本里提及。
- 角色需要展现之前未交代的能力 / 知识时，向更早时间插入一条 `kind=backstory` 切面溯源，而不是在当前时刻凭空 set。

操作边界（详见 `reference/world-engine/calendar-system.md` 与 `subject-lifecycle.md`）：

- 时间一律用项目 `world-engine/calendar.ts` 能 parse 的日历字符串。Simple Calendar 若配置了 `cycleNames` / `monthName`，可使用月份名；否则使用数字月份。禁止 raw instant。
- 同一 instant 只能有一个切面；目标时刻已存在切面时会冲突报错。优先用 `execute_world` 的 `world.slice.list({withPatches:true})` 或 `world.slice.get(sliceId)` 取得 `sliceId` / `patchId`，再用 `world.slice.editPatches` 合并或修正。只有整条切面作废时才用 `world.slice.delete` 物理删除。
- 写完后检查返回的 issues：`severity: "error"` 必须修；`severity: "advisory"` 确认本次语义符合预期即可，不落库。向用户解释时使用返回的 `title`、`message`、`explanation`，不要自行按 code 生成文案。
- 对用户用人话解释做了什么（"我把这段剧情记到时间线里了"），不抛 slice / patch / op 这些术语。

## 第二步：准备简化 brief 调用 writer

通过 `invoke_agent` 调用 `writer`。两个入口各有分工：

- `input`：传 `{path: "manuscript/001-volume/001-chapter/index.md", context: {lorebookEntries: ["lorebook/character/foo/", ...]}}`。
  - `path` 是本轮唯一写入目标，必须是当前 Project Workspace 相对路径，指向章节 `index.md`。
  - `context.lorebookEntries` 只传内容节点 path 字符串数组（目录路径，结尾带 `/`）。
- `message`（brief）：本章的写作任务正文。

brief 应当**简化**——因为写作前世界状态已推进好、writer 又能自查，只传剧情框架，不传可查询的状态细节：

| brief 应该传 | brief 不要传 |
| --- | --- |
| 章节目标 / 关键剧情点 | 详细角色状态 |
| 信息控制（谁知道什么 / 谁不知道什么） | 完整世界状态 |
| 写作约束（视角、节奏、章节如何收尾） | HP / 位置等可查询的细节 |
| 建议读取的 lorebook（也可放 input.context） | 完整时间线记录 |
| World Engine 查询提示（查哪些 subject、哪个时间范围） | patch 细节 |

**不要**把 HP、位置、完整状态塞进 brief。writer 会自己用 readonly `execute_world` 查到当前真值；把状态都塞进 brief 既冗余，又会让 writer 退化成纯执行者，还浪费了它的查询能力。

信息控制是 brief 的硬要求：按 subject 视角分别说明知识边界，例如「薇洛丝视角：不知道莉雅的真实身份」「反派视角：从教会典籍见过项链记载，认出标志但不确定眼前女孩是谁」。writer 据此控制每个角色的言行与心理披露。

brief 示例（节选）：

```
本章目标：薇洛丝在星陨遗迹深处解开莉雅的封印，两人初次交流后被追来的邪教徒巡逻队逼入绝境。
关键剧情点：1) 解封过程的异象 2) 莉雅失忆、只记得片段 3) 邪教徒追入，章末停在对峙瞬间。
信息控制：薇洛丝不知道莉雅真实身份与被封印原因；莉雅失忆，不知外面世界过了多久。
写作约束：薇洛丝单视角第三人称；节奏由探索转紧张；章末收在对峙未发生战斗的悬念上。
World Engine 查询提示：用 execute_world 查 weiluosi、liya、cultist-patrol-01 在「公元2020年4月12日 18:00」附近的状态。
建议读取：lorebook/location/ruins-meteor/。
```

## 第三步：writer 侧（自查状态后写正文）

writer 拥有 readonly `execute_world` 能力。它的典型流程是：读 brief 指定的 lorebook → 用 `execute_world` 按提示查相关 subject 在章节时间范围的状态 → 构思并写入正文到章节 `index.md` → `report_result` 报告落点。writer 的详细执行手册见 `novel-writer-execution` skill。

leader 不需要在此步骤干预；writer 是自主子代理。注意 writer 能查到角色真值，但在某个角色视角的叙述里不会让该角色"知道"他不该知道的设定——查询服务于写作一致性，不等于授权角色越界知情。

## 第四步：评审

writer 完成后，leader 对正文做评审。基础检查（每章必做）：

- 剧情点是否全部覆盖。
- 角色视角 / 信息边界是否越界（有没有让角色知道他不该知道的设定）。
- writer 是否有超出 brief 的自由发挥（新增角色、改变受伤程度、使用未预设能力）。
- 与 World Engine 状态是否一致（位置、伤势、持有物、认知）。

需要更严格评审时（用户要求、重点章节、开局章节），可扩展评审维度：节奏与爽点、文风与 AI 味、承诺兑现（对照 Plot Promise）、读者弃书风险。可用 `invoke_agent` 拉独立评审视角逐维度出具体问题清单，每条附可执行的修改建议。

> 本环节的写-评-修可以整体交给 `run_workflow` 的 `chapter-write-review-revise` 编排：它调用真实 writer 写入目标章节文件，三个评审维度（一致性/节奏/文风）并发挑问题，writer 按 major 问题修订循环。args 传 `chapterPath`（必填）+ `brief` 或 `chapterId`（至少一个）+ 可选 `lorebookEntries` / `reviewRounds`(1-3) / `revise`。前置与手动流程相同：剧情事实已拍板、World Engine 已推进、章节节点已存在。需要逐步人工把关或用户要参与每轮决策时，仍按本文手动循环。轻量非章节文本（简介、文案）用 `write-review-loop`（不写文件）。
>
> 写完若干章后想做全书体检，用 `consistency-audit` workflow：leader 先列章节路径、用 execute_world 预查相关角色状态整理成 worldFacts 文本，一并传入。

## 第五步：修订

按评审结论修改正文。默认不改变核心剧情事实。

1. 确认目标文件和修改范围。
2. 读取目标正文、相关 World Engine 状态、已确认剧情事实和必要 lorebook。
3. 判断修改类型：
   - 文风/语句：直接 edit。
   - 节奏/结构：先给修改方案，再按用户确认执行。
   - 事件结果变化（改变结果、物品状态、角色位置、伤势或信息披露）：先回环节二确认剧情事实，落库后再改正文。
4. 修改正文。
5. 复查视角边界、角色信息、World Engine 状态一致性和用户要求。
6. 如果产生新事实，记录后续 World Engine 回补事项；用户确认后再写入切面。

评审 → 修订可循环多轮，直到基础检查全过、用户满意。用户直接要求润色已有旧章节时，也从本步骤进入（跳过写作步骤）。

修订约束：

- 只修改用户指定范围或明确相关段落。
- 不引入未确认的核心设定或剧情转向。
- 如改变世界状态，已说明并提交或挂起 World Engine 回补。

## 两种协作模式

**模式 A：标准（推荐）**

```
leader 设计剧情 → leader 写作前推进 World Engine → leader 准备简化 brief → writer 自查并写正文 → leader 评审 → 修订
```

世界状态先行，writer 看到的状态始终一致。需要严格控制剧情走向时用这个模式。

**模式 B：自由发挥（可选，默认不推荐）**

```
leader 给大致方向 → writer 自由发挥（含剧情细节）→ leader 事后把偏离的状态变化补回 World Engine
```

仅在**用户明确允许 writer 自由发挥**的探索性写作时使用。leader 只给方向，writer 可增加新角色、改变受伤程度。写后 leader 读取正文、提取状态变化，补进 World Engine（创建新角色 subject、更新状态、补能力溯源）。此模式生成快、即兴感强，但 writer 承担了部分剧情设计、World Engine 滞后于正文、需要更多后处理，所以默认不推荐。

## 完成标准

- 正文写入唯一目标章节 `index.md`。
- 本章状态变化已在 World Engine：标准模式写作前已推进，自由模式写后已补回。
- writer 已通过 `report_result` 报告写入路径与剧情摘要。
- 评审基础检查全部通过：剧情点覆盖、视角与信息边界无越界、与 World Engine 一致。
- 修订产生的新事实已落库或显式挂起。
