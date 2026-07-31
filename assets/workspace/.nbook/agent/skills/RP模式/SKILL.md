---
name: RP模式
description: 进入 NeuroBook RP 模式（v2）的总入口说明：顶栏 Agent/IDE/RP 三态布局、rp.leader 六角色 Tick 流水线、rp/ 子树材料结构、开团/继续冒险的正确路径。legacy simulator 体系不再是普通入口。
when_to_use:
  - 用户说进入 RP、开始 roleplay、跑角色扮演、开团、和角色互动
  - 用户询问 RP 模式怎么用、rp.leader / rp.world / rp.screenwriter / rp.writer 是什么
---

# RP 模式（v2）

RP 模式 v2 的普通用户入口是**顶栏 Agent/IDE/RP 三态切换的 RP 布局**：左侧世界/地图/角色面板 + 会话列表，中间 rp.leader（彩绘）沉浸对话流，右侧跑团正文阅读面板，右下角 2d6 掷骰按钮。

## 前置检查

- 当前 Project Workspace 必须存在 `project.yaml`。
- RP 的一切材料都在项目的 `rp/` 子树：`rp/manual/`（玩家手册）、`rp/lorebook/`（世界观 canon）、`rp/world-engine/`（schema + 历法）、`rp/characters/{id}/`（角色档案与记忆，id 以 `rp/characters/registry.json` 注册表为准）、`rp/ticks/`（每 Tick 的 report.md 与 prose.md）、`rp/dice/`（掷骰记录）。
- Bootstrap 开场正文先写 `rp/bootstrap/staging/opening-prose.md`；只有服务端完成 config → world → map → characters → opening_event → narrative 验收并激活后，才发布到 `rp/ticks/000000-initial-state/prose.md`。
- config 阶段通过 `rp_intake op=initialize_config` 生成受信 Schema/Calendar；现代/校园/都市用 gregorian，固定长度架空历法用 simple。Agent 不手写这两个 TypeScript 配置；checkpoint 失败后停留原阶段，修正后直接重试。
- **与写作模式完全分离**：根 `manual/`、`lorebook/`、`world-engine/`、`manuscript/` 是写作模式的，RP agent 不读写；仅开团引导「改编路线」允许在用户授权下一次性拷贝改编进 `rp/`。

## 启动方式

1. 切换到顶栏 RP 布局（或新建 `rp.leader` 会话）。rp.leader 负责开局引导、陪伴交流与流水线编排。
2. 第一项操作是 `rp_intake op=get`。只有 phase=active 才按已有冒险继续；其他阶段恢复持久草案，不以 `rp/` 目录是否存在猜测进度。
3. **新项目开团**：rp.leader 先走 `rp-v2-adventure-intake`，支持引导开团、快速提案或改编现有设定。每项回答写入 Project Workspace `.nbook` 草案；完整企划必须由玩家在 RP 左侧“状态”页点击“确认并开团”，再由同版本 `begin_bootstrap` 开放正式初始化。**Agent 没有确认操作，也不能跳过门禁直接写 rp/ 或调用 RP 子 Agent。**
4. **已有冒险**：rp.leader 介绍这是什么世界、扮演谁、进行到哪，由用户选择继续 / 新开 / 调整化身。

## 角色分工（v2 六角色流水线）

`rp.leader`（主持编排；每个 IC 回合先用 rp_turn 绑定事务，Tick 编号由 rp_tick_info 宣告）→ `rp.world`（捕获唯一 snapshotId）→ `rp.screenwriter`（提交 plan）→ `rp.cast`/`rp.actor`（主要角色同快照并行）∥ `rp.extras`（普通 NPC）→ `rp.world`（冲突收口）→ `rp.screenwriter`（终裁）→ `rp.writer`（用户可见正文）→ worldOperationId 幂等写回与 rp_turn commit。每一步由 `rp_pipeline` 代码门禁；主要 actor 失败不能代演，未登记正文不能提交。

每轮通过 `rp_focus` 读取 light / standard / deep。强度只影响远端世界丰富度，当前场景、直接互动角色、硬事件和确定性结算永不降级；长跳只做一次批量推演与一个摘要文件，不逐日造 Tick。完整结算和阶段状态写 `.nbook/rp/runtime/`，不塞聊天上下文。候选四卡和正式事件仍由 `rp_event` 维护。协议细节见 `reference/agent/rp-v2/README.md`。

`world_snapshot` 中 rp.world 固定执行 `rp_focus get → execute_world state_read → rp_focus rebalance → rp_focus plan_runtime → rp_pipeline capture_snapshot`。`execute_world` 结果顶层 `worldInstant` 是后续计划使用的 bigint 十进制原值；`rebalance` 根字段只有 `op/projectPath/tick/current/activeBackground/lowFrequency`，根节点没有 `reason`；`plan_runtime` 根字段只有 `op/projectPath/turnId/longJump/startInstant/endInstant/currentNpcIds/directInteractionNpcIds`，不得传日历显示文本或 `worldSummary`；`set_focus` 只归 rp.leader 并需要玩家确认，rp.world 禁止调用。

## 世界切片树

- 玩家从 RP 状态页打开“切片树”，初始化根切片、查看分支、锁定、归档替换、建立检查点或恢复旧节点。点击旧节点只是只读预览，不改变 active 时间线。
- 时间线树启用后，每个 committed Tick 自动建立节点。每个节点最多四条直接子分支；第五条必须由玩家选择一个未锁定、非根、非 active 的分支归档替换。
- `rp_turn begin_commit` 若报告四分支容量不足，停止提交并请玩家在切片树窗口处理；不得绕过门禁。
- 玩家提出回滚或分支时，引导其使用切片树。Agent 不得批量删除 WorldSlice、写 gm_override 或改运行文件模拟回滚，也不得替玩家确认安全切片。
- 恢复会切换 World Engine、运行文件、正文、骰子、关系与角色记忆；玩家 OOC 认知保留。前端会新建 rp.leader 会话，使新的 cast/actor 会话链不继承旧分支上下文。

## 主动主持与候选四卡

- 进入新地点、新活动、计划到期、玩家主动要求，或连续五个 committed 平淡回合后，主持应主动请求 calm / exciting / dangerous / unusual 四张候选，不等待玩家替主持编排事件。
- 玩家可保留、放弃、选择，或指定 1-4 张由服务端随机；选择只固定入口，不固定结局。
- 普通 active 事件最多三个；硬性日程、预报天气、约定和已启动计划可临时成为第四焦点，但不强迫玩家参与。
- 事件详情与结算保存在 Project Workspace `.nbook/rp/runtime/events/` 和账本文件中，不反复注入聊天上下文。

## 时间、资源、关系与认知

- 当前时间只以 RP World Engine Instant 为准；IC 回合只记 startTime/endTime，OOC 不推进。长跳先 plan_jump，存在阻断时必须用 approve_jump 取得玩家审批凭证。
- 资源和周期由 rp_mechanics 以整数规则结算；长跨度一次批量结算，不逐日造 Tick。私密周期与概率默认不展示，随机只由服务端按 operationId 抽取。
- 关系是八维有向边；骰子不能直接改关系，标签不从阈值自动生成，系统不能替化身决定信任/情感/吸引。
- 世界事实、角色信念、玩家 OOC 可见性三层分离；user_revealed 不自动成为 avatar_known。
- P4 变化通过 rp_turn commit.rules 统一预检并幂等收口，详细流水写入 `.nbook/rp/runtime/`，不塞聊天上下文。

## 层级地图与 NPC 生命周期

- `rp_map` 维护 world→region→town→district→building→sub_location 的稳定目录、发现状态和路线；完整地点事实仍只在 RP World Engine。
- rumored 地点只显示模糊名称与大致方向；秘密路线发现前完全隐藏。首次抵达自动固化，关闭或毁坏后节点仍保留。
- screenwriter 只提地点，world 负责校验和保存。Bootstrap map 阶段由 screenwriter 逐地点调用 `propose origin=bootstrap`；常规运行使用 `origin=screenwriter`。`propose` 每次只接受根字段中的一个地点，不能传批量导入字段。相同 requestedId 的定义发生变化时必须用 `replace_proposal` 显式替换，旧提案保留为 superseded；地点与设定冲突时必须展示原因并由玩家审批，不能静默选边。
- 小说改编地点盘点必须覆盖 Lorebook、Plot、World Engine 和正文，完成后整批让玩家确认纳入/排除；不完整项可保持 partial/vague。
- `rp_npc` 生命周期为具名→常驻→主要→长期离场。群演报出姓名即登记 named，但擢升必须玩家确认；敌人、宿敌和竞争者也可成为主要角色。
- Bootstrap characters 阶段只登记企划中已经具名的初始 NPC；未具名群演不进入 roster，没有具名初始 NPC 时允许空 roster 开团。
- 活跃主要角色软上限默认 8，不是硬限制。升 major 可从历史 Tick、事件和互动摘要补建记忆；actor session 在实际出场时惰性创建。
- resident/major 需要由 world 通过 rp_mechanics 建立合理精确账户；普通 named NPC 只保留粗粒度 household。

## legacy 边界

`simulator.leader` / `simulator.actor` / `simulation/` 目录是 v1 legacy 体系，仅供历史项目使用，不作为 v2 入口；两套互不迁移、互不混用。SillyTavern 卡导入仍可先用 `novel-import-silly-tavern-card`，产物再经开团引导改编进 `rp/`。
