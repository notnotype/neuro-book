# Roleplay Flow Examples

本文用于把早期 `leader.rp`、subject、entity、lorebook 和 Tick 流程放进具体例子里跑一遍，避免目录协议只停留在抽象分类。

2026-06-09 note: 本文是早期 flow 示例。当前新合同只使用 `rp.leader` 作为 RP 用户交流、开局引导和陪伴主持层，`simulator.leader` 作为世界模拟和裁决内核。本文下方的 `leader.rp` 应按历史名称阅读，不作为当前推荐 profile 名。

本文使用当前目标目录名 `simulation/`。旧 `roleplay/` 目录不再作为新模板兼容目标；旧 Project Workspace 可按下列映射迁移：

```text
roleplay/gm.md            -> simulation/simulator.md
roleplay/actors/{id}/     -> simulation/subjects/{id}/
roleplay/playthrough/     -> simulation/runs/
```

`leader.rp` 是当前 RP 入口 profile。按新目录协议理解，它承担 simulator leader 职责：理解用户意图、读取模拟协议、调度 subject / entity simulator、维护信息控制、生成 writer brief，并把结果交给用户。

## Baseline

### 目录职责

- `lorebook/`：全知、稳定、无状态的作品说明书。记录类型、原型、规则和 canon。
- `simulation/subjects/`：信息控制主体。角色、玩家、可拟人化势力等会知道、误解、判断和行动的对象放这里。
- `simulation/entities/`：有状态实例。特殊物品、地点当前状态、机关、事件进程、任务、唯一碎片等放这里。
- `simulation/runs/`：本局运行和 Tick 产物。保存 user input、simulator scratch、subject result、entity update、writer brief 和 prose。
- `reference/`：外部素材和迁移输入，不直接当作稳定设定。

### 关键原则

- `leader.rp` 可以看全局，但给 subject 的输入必须是 subject-facing。
- subject 不能直接读取完整 lorebook。引用 `lorebook/...` 是内部关系，不是可见性授权。
- 普通、无差异、无隐藏状态的对象不需要实例化为 entity。
- 实例化 entity 的目的不是信息控制，而是状态追踪。
- 用户也是 subject，但 `leader.rp` 不替用户决定核心行动、台词、价值判断或长期目标。
- 剧情设计目前暂由 `leader.rp` 代劳；长期应拆给 plot / planner / scenario 机制。

## Flow 1: `leader.rp` 初始化

用户输入：

```text
开始 RP。用这个世界观开一局，主角是刚入学的炼金学生。
```

`leader.rp` 初始化时做四件事。

第一，读取运行协议和已有配置：

```text
simulation/config.yaml
simulation/cast.yaml
simulation/simulator.md
simulation/writer.md
lorebook/index.md
project.yaml
```

第二，了解机制和开局约束。开局设定暂时没有进入稳定规范，作者可以临时写在 `simulation/simulator.md`、`simulation/config.yaml`、`lorebook/world/`、`lorebook/system/` 或导入报告里。`leader.rp` 应主动寻找这些线索，但不要假装协议已经有固定字段。

第三，根据已有 cast 和用户目标创建或补齐主要 subject：

```text
simulation/subjects/player/
|-- subject.md
|-- events.md
|-- knowledge.md
|-- mind.md
`-- state.md

simulation/subjects/erina/
|-- subject.md
|-- events.md
|-- knowledge.md
|-- mind.md
`-- state.md
```

如果主角当前持有普通物品，只写入 subject state：

```yaml
inventory:
  - prototype: lorebook/item/consumable/blood-potion/
    visibleName: 血药
    quantity: 3
    subjectKnownEffect: 通常用于恢复伤势
```

如果开局给了唯一物品、隐藏状态物品、可追踪地点状态或正在推进的仪式，再创建 entity：

```text
simulation/entities/world-heart-fragment-a/
|-- entity.md
|-- events.md
`-- state.md
```

第四，给用户一个可行动现场。如果信息不足，`leader.rp` 应提出少量高影响问题；如果信息足够，应直接进入开局，而不是把后台初始化清单展示给用户。

推荐输出形态：

```text
你抵达艾瑟嘉德学院区的第一天，行李还没完全放下，炼金系的临时通行牌已经烫在掌心。

门外有人敲了两下。导师助理说，新生登记处临时出了事故，需要你带着自己的基础药剂箱过去。

你现在可以直接行动，也可以先补充主角姓名、性格和随身物品。
```

## Flow 2: Roleplay 开局捏人物

用户输入：

```text
我要先捏人物。主角叫罗恩，贫民出身，想靠炼金改变命运。伙伴是一个人造龙姬。
```

`leader.rp` 判断这是 setup 流程，不急着进入 Tick。它应协助用户确认会影响长期模拟的要素：

- 主角身份、目标、弱点、初始资源。
- 伙伴是否已经认识主角。
- 伙伴是已有 lorebook 角色，还是用户新建角色。
- 是否需要属性、等级、技能、背包、初始地点。
- 用户希望轻规则、半规则，还是强数值规则。

如果用户愿意快速开始，`leader.rp` 可以使用默认值并说明可随时改。

可能写入：

```text
simulation/subjects/player/subject.md
simulation/subjects/player/knowledge.md
simulation/subjects/player/mind.md
simulation/subjects/player/state.md
simulation/subjects/erina/subject.md
simulation/subjects/erina/knowledge.md
simulation/subjects/erina/mind.md
simulation/subjects/erina/state.md
simulation/cast.yaml
```

如果“人造龙姬”已有上帝视角设定，进入：

```text
lorebook/character/erina/
```

如果她是本次用户临时创造的重要角色，也可以先建 subject，再在后续稳定后补 canonical lorebook：

```text
simulation/subjects/erina/
```

注意：伙伴 subject 的 `knowledge.md` 不能直接复制 `lorebook/character/erina/` 的秘密。它只写她本人知道、相信或合理误解的内容。

## Flow 3: 属性和规则设置

用户输入：

```text
这个世界有体力、魔力、炼金熟练度三个属性。主角体力低，魔力中等，炼金熟练度很高。
```

`leader.rp` 需要区分规则原型和当前状态。

如果这是作品通用规则，写入 lorebook system：

```text
lorebook/system/attributes/index.md
```

示例内容：

```yaml
type: system
subtype: attribute-rule
```

正文说明属性如何影响行动、失败、成长和描述。

主角当前数值或状态写入 subject state：

```yaml
attributes:
  stamina: low
  mana: medium
  alchemySkill: high
```

如果暂时没有正式数值系统，可以用自然语言保存，避免过早发明复杂规则：

```md
## 当前能力

罗恩体力偏弱，长时间奔跑或搬运重物容易疲惫；魔力量中等，能支撑基础炼成；炼金熟练度明显高于同龄新生。
```

## Flow 4: 进入 Tick

用户输入：

```text
我把世界之心交给绘璃奈，让她看看这是什么。
```

Tick 过程：

```text
user input
-> leader.rp 理解意图
-> leader.rp 验证状态和可行性
-> leader.rp 构造 subject-facing observation
-> selected subject simulators
-> leader.rp 世界裁决和 entity update
-> rp.writer
-> user-facing prose
-> runs/tick artifact
```

`leader.rp` 先检查：

- player 是否持有 `world-heart-fragment-a`。
- 绘璃奈是否在附近。
- 这块碎片当前可见外观是什么。
- player 是否知道它叫世界之心。
- 绘璃奈当前知道什么。

内部状态可能是：

```yaml
holder: simulation/subjects/player/
prototype: lorebook/item/artifact/world-heart/
fragmentId: a
trueAbility: 治疗与生命回响
subjectVisibleName: 五彩石
subjectVisibleProperties:
  - 内部像有光在缓慢流动
  - 靠近时能感到温热和生命力
```

发给绘璃奈 subject simulator 的信息不能写隐藏真相：

```text
罗恩把一块五彩斑斓的石头交到你手里。它比普通宝石温热，内部像有光在缓慢流动。你能感觉到它带着异常浓厚的生命气息，但你不能确定它的名字或完整来历。

请只以绘璃奈当前可知信息回应。
```

绘璃奈可能回复：

```text
绘璃奈接过石头后明显怔了一下。她没有立刻把它还回去，而是压低声音问罗恩：“你从哪里得到这个的？”
```

`leader.rp` 裁决后调用 writer。writer brief 只包含可写信息和要呈现的结果，不给 writer 完整后台秘密，除非本 Tick 需要写出上帝视角旁白。

Tick 产物可以保存：

```text
simulation/runs/ticks/000001-world-heart-handoff/
|-- report.md
`-- prose.md
```

`report.md` 记录用户输入摘要、simulator scratch、subject result 摘要、entity update、writer-safe brief、commits 和后续钩子。`prose.md` 单独保存 writer 或 leader 最终给用户看的正文。`input.md`、actor packet、commit log 等机械文件后续可由 workflow/runtime 自动生成，不要求第一版手写。

## Flow 5: 普通物品和特殊物品

用户输入：

```text
我从背包里拿出一瓶血药喝下。
```

如果背包只有普通血药，不需要查找或创建三瓶 entity。`leader.rp` 从 player state 里扣除数量，裁决恢复效果。

```yaml
inventory:
  - prototype: lorebook/item/consumable/blood-potion/
    visibleName: 血药
    quantity: 2
```

如果用户拿的是被下毒的那一瓶，它必须是 entity：

```text
simulation/entities/poisoned-blood-potion-001/
```

player state 引用：

```yaml
inventory:
  - entity: simulation/entities/poisoned-blood-potion-001/
    visibleName: 血药
```

`leader.rp` 裁决时可以读取 entity hidden state，但 player subject 不会自动知道它有毒。用户喝下后，player events 记录“喝下血药”，entity events 记录“被罗恩饮用”，player state 记录中毒或异常反应。player knowledge 是否知道“有毒”，取决于症状、他人的说明和后续调查。

## Flow 6: 用户新建势力

用户输入：

```text
我要建立一个叫苍银学社的学生组织，专门研究禁忌炼金。
```

`leader.rp` 先判断这是作者级设定、角色行动，还是两者都有。

如果用户是在 setup / 作者口吻中创建世界设定，写入 canon：

```text
lorebook/faction/cangyin-society/index.md
```

如果这个组织需要长期决策、隐瞒信息、招募成员、制定计划，可以同时建立 subject：

```text
simulation/subjects/cangyin-society/
|-- subject.md
|-- events.md
|-- knowledge.md
|-- mind.md
`-- state.md
```

如果只是记录当前资源、成员数量、据点状态，也可以建立 entity：

```text
simulation/entities/cangyin-society-current-state/
|-- entity.md
|-- events.md
`-- state.md
```

如果用户是在故事内说“我宣布建立苍银学社”，`leader.rp` 还要裁决现实后果：有没有成员、学院是否承认、是否触犯规则、旁人反应如何。不能直接把用户宣言无条件变成世界事实。

## Flow 7: 用户制定规则

用户输入：

```text
这个世界里，任何复活术都会消耗施术者一段记忆。
```

如果这是作者级世界规则，写入：

```text
lorebook/world/rule/magic/resurrection-memory-cost/index.md
```

如果它会影响可运行玩法，例如复活流程、判定、代价表，写入：

```text
lorebook/system/resurrection/index.md
```

如果用户是在角色台词中说“我觉得复活术会消耗记忆”，这不是 canon，应该进入该 subject 的 knowledge 或 belief：

```text
simulation/subjects/player/knowledge.md
```

`leader.rp` 应根据输入语气判断，必要时问一句：

```text
这是你作为作者新增世界规则，还是罗恩在故事中提出的猜测？
```

## Flow 8: 用户新建房子

用户输入：

```text
我想让主角有一间在学院外的旧木屋，地下室可以做炼金实验。
```

如果这是稳定地点，写入 location canon：

```text
lorebook/location/艾瑟嘉德/学院外城区/旧木屋/index.md
lorebook/location/艾瑟嘉德/学院外城区/旧木屋/地下室/index.md
```

如果这间房子有当前状态，例如门锁、租约、损坏、储物、是否被监视、实验台状态，建立 entity：

```text
simulation/entities/player-old-cabin/
|-- entity.md
|-- events.md
`-- state.md
```

player state 可以引用：

```yaml
home:
  location: lorebook/location/艾瑟嘉德/学院外城区/旧木屋/
  currentState: simulation/entities/player-old-cabin/
```

如果地下室里的炼金阵、封印门、隐藏箱子有独立状态，可以分别建立 entity；普通桌椅和常见工具不需要实体化。

## Flow 9: 剧情设计临时代劳

理想状态下，剧情设计不应该由 `leader.rp` 完整承担。`leader.rp` 更适合做即时世界模拟、裁决、信息控制和 Tick 编排。

当前没有独立 plot / scenario planner 时，`leader.rp` 可以临时代劳，但要遵守边界：

- 只设计当前场景的压力、冲突和因果后果，不提前锁死长线剧情。
- 遇到会改变作品方向的大设定，向用户确认。
- 不为了推进剧情强行改变用户 subject 的意图。
- 不把未发生的剧情写进 lorebook canon。
- 临时构思先放在 `simulation/runs/current.md` 或 tick scratch；稳定事实发生后再沉淀到 lorebook、subject events 或 entity events。

例子：

```text
用户：我今晚偷偷潜入学院禁库。
```

`leader.rp` 可以设计当前场景障碍：巡逻、门禁、禁库钥匙、同行 NPC 的反应。它不应直接决定“今晚必然撞见最终反派”，除非已有 plot 设定或用户想要强剧情推进。

## Flow 10: 其他常见关系

### 隐藏身份

`lorebook/character/prince-b/index.md` 记录 B 是王族。A 目前不知道，A 的 `knowledge.md` 只写“B 是普通学生”。当 A 发现证据后，更新 A events 和 knowledge。

### 契约和债务

契约文本本身可以是 `lorebook/item/document/contract/...`。某一份已经签署、可毁坏、可转让、能被偷走的契约是 entity。谁知道契约条款，写入对应 subject knowledge。

### 位置和容器

普通物品在背包里，可以直接写 subject state。重要物品藏在箱子里，箱子有锁、有陷阱、有隐藏夹层，则箱子和物品都可以是 entity。

### 正在推进的事件

“十年前的战争”是 lorebook event。“今晚 2/3 进度的召唤仪式”是 entity，因为它有参与者、进度、可中断条件和当前状态。

### 势力关系

稳定阵营关系可以写在 `lorebook/faction/...` 正文。当前外交状态、临时停战、暗中背叛或谈判进度可以写入 faction subject state 或 entity state。

### 伙伴加入

用户在 Tick 中救下一个 NPC。`leader.rp` 先把事件写入 player / NPC events。只有当 NPC 会长期同行、需要单独 knowledge/mind/state，才建立 subject 并加入 `cast.yaml`。

## Leader Checklist

每次 `leader.rp` 面对用户输入时，先做这个判断：

1. 这是作者级设定、角色行动、系统规则、还是纯粹询问？
2. 是否需要进入 setup 流程，还是已经是 Tick？
3. 需要创建 subject 吗？只有信息控制主体才创建 subject。
4. 需要创建 entity 吗？只有需要状态追踪的实例才创建 entity。
5. 需要写 lorebook 吗？只有稳定 canon、原型、规则才写 lorebook。
6. 哪些 subject 应该被告知？每个 subject 能看到什么？
7. 哪些状态发生变化？写 subject state、entity state，还是只写 run artifact？
8. 是否需要 writer？简单回应可由 `leader.rp` 直接叙述；正式正文交给 `rp.writer`。
9. 是否需要向用户确认？只有高影响、不可逆、改变作品方向或输入含混时才问。

## First-version Boundaries

- 第一版不要求完整持久化记忆系统。
- 第一版不要求正式 GraphRAG who-knows-what schema。
- 第一版不要求独立 plot planner；`leader.rp` 临时代劳剧情压力设计。
- 第一版不要求所有 state 都结构化成 YAML；自然语言 snapshot 可接受。
- 第一版不要求每个物品、地点、NPC 都实体化或 subject 化。
- 第一版应优先保证 subject 上下文纯净：不把上帝视角 lorebook、其他 subject knowledge、simulator scratch 直接注入 subject。
