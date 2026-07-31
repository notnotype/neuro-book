---
name: rp-v2-bootstrap
description: Bootstrap RP mode v2 for a project from zero to playable - RP world timeline init (worldKey=rp), character dossiers under rp/characters/, avatar creation with the user, opening prose, and optional state-view config. For rp.leader hosting a project's first RP session.
when_to_use:
  - 用户在 RP 模式下开始一个还没有任何 RP 运行态的项目（rp/ 目录为空、rp 世界线无切片）。
  - 用户说「开始跑团」「进入 RP」「帮我捏个角色开新冒险」而项目尚未初始化。
  - RP 化身或关键 NPC 需要补建档案。
---

# RP v2 Bootstrap：从零到可玩

按顺序完成五步。每步都是幂等的——中断后重跑不会破坏已有内容。协议细节见已注入的 rp-v2 参考文档（README / world-contract / adjudication / character-memory）。

## Step 1：确认世界观材料 + 建目录骨架（rp/ 子树）

- 第一项操作必须是 `rp_intake op=get`。只有 phase=confirmed 且 confirmedVersion=version 时才调用 `rp_intake op=begin_bootstrap`；版本由服务端自动绑定，不传 version。begin_bootstrap 返回 phase=bootstrapping、stage=config 后才能执行本节后续写入。不能用 rp/manual 是否存在替代技术门禁。
- 先建齐 `rp/` 目录骨架（幂等；缺哪个建哪个，各放一个说明用途的 README.md 占位）：`rp/manual/`、`rp/lorebook/`、`rp/characters/`、`rp/ticks/`。下游 agent 会按需读这些目录，骨架缺失会让它们白吃 ENOENT。
- 读 `rp/manual/README.md`、`rp/manual/player-guide/`、`rp/manual/gm-guide.md` 与 `rp/lorebook/` 核心设定。
- **材料缺失（新冒险）时，本 skill 不负责聊设定**：先走开团引导 `rp-v2-adventure-intake`（改编写作模式 lorebook 或从零问答共创，冒险企划书经用户确认后落盘 rp/manual/ + rp/lorebook/），再回到这里从 Step 2 继续。不要跳过引导空转生成。
- **RP 与写作模式完全分离**：仅开团引导改编路线允许在用户授权下从写作模式的 manual/、lorebook/ 一次性拷贝改编进 `rp/`；此后两份独立演化，运行时绝不跨读。**v2 没有 `rp/current.md`**——跨 Tick 状态全部由 World Engine 承载，不要建这个文件。

## Step 2：建立 RP 世界引擎配置 + 初始化世界线

先调用 `rp_intake op=initialize_config` 建立 `rp/world-engine/schema/index.ts` 与 `calendar.ts`。这两个文件由服务端受信模板生成，**禁止用 write/edit/apply_patch 手写或猜测格式**：

- 现代、校园、都市、现实、近未来题材：`calendarPreset="gregorian"`。
- 固定长度月份/年份的架空历法：`calendarPreset="simple"`；可传 `eraBefore` / `eraAfter` 修改纪元名。
- 服务端生成的 Zod Schema 固定包含可运行的 world/character/location，以及地图、关系与 secret 所需字段。故事特有资源优先用 RP mechanics 动态资源承载，不在 Bootstrap 阶段随意改 Schema。
- 初始化工具会立即用生产 loader 复验生成结果；工具成功后再调用 `checkpoint_bootstrap stage=config`。

然后 invoke rp.world，消息写明「初始化」并给出：纪年/开局时间、world subject 初始状态、化身与关键 NPC 的首切片事实（位置/关键数值/持有物）。要求它：

- 一律 worldKey="rp"（绝不碰写作模式主世界线）。
- 地点 subject 带 `连接` 字段、角色 subject 带 `关系` 字段（地图与关系图面板靠它们生长）；schema 不含这些字段时如实报告即可，不硬造。
- 隐藏状态放进 subject 的 `secret` 子对象。

配置与材料完成后调用 `rp_intake op=checkpoint_bootstrap stage=config`；只有返回 stage=world 才调用 rp.world。世界主体和初始切片建立后 checkpoint world；只有返回 stage=map 才建立初始地图：让 rp.screenwriter 对每个地点分别调用 `rp_map op=propose origin=bootstrap`，每次只在根字段提交一个地点，绝不把 `candidates`、`view` 或 `decisions` 混入 propose；再让 rp.world 确保对应 location subject 存在并逐项 `review`。rp.leader 与 rp.world 都不能代替 screenwriter 提交 Bootstrap 提案。完成后 checkpoint map。服务端会真实加载 Schema/Calendar 并检查数据库与地图，不接受自然语言“已经完成”。校验失败会停留在当前阶段；修正后直接重试 checkpoint，不需要重复 begin_bootstrap。

## Step 3：角色建档（rp/characters/）

对化身与每个关键 NPC：

1. `rp_character_update op=ensure` 建骨架并登记注册表：**必须带 `name`（中文显示名）和 `kind`**（玩家化身为 `player`，其余为 `npc`），常用称呼放 `aliases`（如「子爵」「白发女孩」）；id 用简短小写拉丁串（如 `brauer`）。注册表按显示名防重复——同一角色第二次 ensure 换拼法会被拒绝并返回已有 id。之后全管线引用该角色只用注册表 id 或显示名。
2. 按 subject-creation-guide 方法论写 soul.md（第一人称扮演手册：我是谁/性格调色盘/说话方式/我知道什么/想要什么怕什么/不会做什么），`op=write_soul` 写入。**化身（player）的 soul.md 侧重身份与处境，性格留给用户输入**。
3. `op=write_mood` 写开局心境。
4. 开局已知的关键信息用 `op=add_knowledge` 落账（含来源）；开局就该有的戏剧反差交给 rp.screenwriter 用 `op=add_unknown` 登记。

角色档案完成后，让 rp.world 把企划中已经确认具名的初始 NPC 登记进 `rp_npc` roster；未具名群演不入 roster，禁止用“未具名女性”“神秘路人”等描述伪造姓名。没有具名初始 NPC 时空 roster 合法。随后调用 `rp_intake op=checkpoint_bootstrap stage=characters`。再在 opening_event 阶段登记第一个 active opening 事件并 checkpoint opening_event。

## Step 4：开场白

生成开场白 Writer Brief（`<context>` 通常为空，`<beats>` 写化身入场/身体感/可见人物/第一选择点），创建 rp.writer 写入暂存路径 `rp/bootstrap/staging/opening-prose.md`。写入后调用 `rp_intake op=checkpoint_bootstrap stage=narrative`；返回 ready_to_activate 后调用 `rp_intake op=activate`。激活会重新验收全部阶段，并由服务端发布到 `rp/ticks/000000-initial-state/prose.md`。激活成功前不展示正文或链接。

## Step 5（可选）：状态面板配置

用户想让侧栏角色卡更好看时，按 `world-engine-state-view` skill 写 `world-engine/state-view.json`（hp 配 progress、物品配 item-list 等）。RP 侧栏与 World Engine Workbench 都会消费它。

## 完成标准

- `rp/world-engine/` 配置就绪（schema + calendar，独立于写作模式）。
- rp 世界线有 world subject 与开局切片（RP 侧栏「世界」面板能显示时间与登场要素）。
- 化身与关键 NPC 在 rp/characters/ 下有 soul/心境/已知信息。
- 开场正文先由 rp.writer 写入 staging，再由服务端激活流程发布到 `rp/ticks/000000-initial-state/prose.md`，用户只收到已发布链接。
- 已调用无 version 参数的 `rp_intake op=activate`，状态为 active。阶段校验失败由服务端自动记录阶段和原因；其他主动中断可调用 `fail_bootstrap message={真实原因}`，不展示未提交的开场结果。
- 之后进入常规 Tick 流水线（见 rp-v2/README.md）。
