# LOD 世界模拟系统

LOD（Level of Detail）模拟是 simulator.leader 在每次 Tick 中、subject 级模拟**之前**执行的世界层模拟。它用于丰富世界真实感、为后续冒险埋线。

## 核心规则

### 先世界，再角色

LOD 模拟必须在 subject 级模拟之前完成。角色在世界里行动，不是世界围着角色转。LOD 产出的事件可能影响角色行为（如突然的声响、光线变化），所以必须先确定世界发生了什么。

### 全知精确

LOD 模拟是 simulator.leader 自己的笔记，是**全知视角**产物。必须精确引用 lorebook 条目和真名：

- ✅ `一位女仆端着装有[治愈之泪](lorebook/item/healing-tear)的华丽盒子进来`
- ✅ `召唤纹路在洛丽塔女孩的[元素亲和力](lorebook/magic/elemental-affinity)作用下出现共鸣`
- ❌ `一个仆人端着一个神秘的盒子进来`
- ❌ `纹路神秘地发光了`

**例外**：如果 simulator 当时也没想好这个东西是什么，才允许用"神秘的""不明的"。这意味着这个道具/事件的设定留待后续自由发挥。

## LOD 层级

| 层级 | 范围 | 数量 | 说明 |
|------|------|------|------|
| LOD0 | 当前场景附近 | 4–6 个 | 必须有。角色可能直接感知到的变化 |
| LOD1 | 区域级（城堡、集市） | 2–4 个 | 通常有。当前场景外但同一建筑/区域内 |
| LOD2 | 城镇级别 | 1–2 个，可以没有 | 可选。城镇范围的事件 |
| LOD3 | 国家级别 | 通常没有 | 罕见。影响国家层面的大事件 |
| LOD4 | 世界级别 | 通常没有 | 极罕见。世界级变动 |

## LOD 事件类型

LOD 事件可以是：

- **纯装饰**：丰富世界真实感。蜡烛火焰跳动、鸽子被惊飞、光斑偏移。
- **伏笔**：为后续冒险留素材。冒险者公会发布讨伐委托、管家翻账本发现税收不达标。
- **即将进入场景的事件**：女仆端着热茶正在走向大厅（2 分钟后到达）。这些事件在当前 tick 不影响角色，但 simulator.leader 可以预知它们将在后续 tick 自然进入场景。

## LOD → actor 的信息过滤

LOD 产出后，simulator.leader 按角色感知范围过滤，将事件融入 actor-facing packet 的 `<gm>` 标签中：

- 角色能**直接感知**的 LOD0 事件：融入该 actor 的 `<gm>`
- 角色能**间接感知**的 LOD1 事件（远处的声音、气味）：可选融入
- 角色**不在场**的事件：不融入
- LOD 事件中引用的 lorebook 术语：必须转换为角色认知水平的描述
  - 给法师："召唤术式的残余魔力出现了元素亲和力共鸣" → 可以，法师知道这些概念
  - 给普通高中生："脚下的发光文字好像变色了" → 只能这样

## LOD → Writer Brief 的信息过滤

rp.leader 从 LOD 中挑选用户化身能感知的事件，用**用户视角的感官语言**描述（不使用 lorebook 术语），织入 Writer Brief 的场景和剧情中。

用户化身不在场的 LOD 事件不进 Brief。Brief 里没有的，writer 永远不知道。

## 示例

```markdown
## LOD 世界模拟

### LOD0 — 仪式大厅

1. 西侧一扇彩色玻璃窗没有完全关紧，风灌进来让最近的三根蜡烛同时晃了一下，
   蜡油滴落在铁烛台上发出连续的啪嗒声。

2. 地面上的召唤纹路（[异界召唤术式](lorebook/magic/summoning-ritual) 的残余）
   持续熄灭中，但洛丽塔女孩附近的一段因为她的
   [元素亲和力](lorebook/magic/elemental-affinity) 出现了微弱的共鸣反应。

3. 台阶右侧的一名卫兵膝盖旧伤发作，悄悄换了一下重心。

4. 大厅顶部横梁上有一只灰色的鸽子，被运动男生越来越大的声音惊到，
   扑棱着飞到了另一根横梁上，掉下来几片灰尘。

5. 阳光角度偏移，彩色玻璃窗投射的光斑从大厅中央向西侧移了约半步。
   原本照在召唤纹路上的一束红色光现在落在了眼镜女生脚下的
   [知识之环](lorebook/magic/knowledge-circle) 上，
   让那些淡蓝色符文短暂地泛出了一层淡紫色。

### LOD1 — 子爵城堡

1. 厨房里厨师长正在准备晚宴。女仆莉丝正往仪式大厅方向走，
   手里端着热茶和杯子，大约两分钟后到达大厅侧门。

2. 东塔书房里管家正在翻阅账本，上个月的税收又没有达标。

3. 马厩传来一阵马的嘶鸣。
   今早从[金谷城](lorebook/location/goldvalley-city)来的信使的马还没有喂饱。

### LOD2 — 金谷城

1. [冒险者公会](lorebook/organization/adventurer-guild)发布了新的讨伐委托：
   近郊农田出现异常的[土元素虫群](lorebook/creature/earth-elemental-swarm)，
   已经毁了三块麦田，佣金 15G。
```

## Pending Events：写入 current.md

上面 LOD 事件类型中的"即将进入场景的事件"（如女仆莉丝两分钟后到达），以及当前尚未兑现的伏笔，必须写入 `current.md` 的 `## Pending Events` 段，防止跨 tick 遗忘。

Pending Events 是 [simulation.md](../../content/simulation.md) 中 current.md "pending next steps" 概念的结构化形式，不是新增的第二套机制——用它承载所有"已经生成、等待在后续 tick 兑现"的世界事件。

```markdown
## Pending Events

- [约 2 分钟后 / Tick 004 前后] 女仆莉丝端着热茶到达仪式大厅侧门（来源：Tick 002 LOD1）
- [未定] 金谷城冒险者公会的土元素虫群委托，可能与召唤魔力波动有关（来源：Tick 002 LOD2，伏笔）
```

每轮读取 current.md 时检查 Pending Events：

- **到期**：纳入本轮 LOD0 / 场景事件，并从 Pending Events 删除
- **未到期**：保留
- **已失效**（剧情走向使其不再可能发生）：删除，必要时在裁决报告"预告"段说明

裁决报告的"预告"段与 Pending Events 口径一致：预告是给 rp.leader 看的可读版，Pending Events 是写回 current.md 的持久版。

## `<knowledge>` 与角色记忆文件的去重

`<knowledge>`（见 [actor-facing-packet.md](actor-facing-packet.md)）是**新信息注入**通道；mind.md / memory.jsonl 是**信息存储**。组装 packet 做信息控制检查时：

- 只注入“本轮场景需要、且角色长期信息（`soul.md` / `events.jsonl` / `memory.jsonl` / `mind.md`）尚未覆盖”的知识。判断依据是授权上级或外部流程读取到的 subject 文件内容；不要把 `subject.md` 的隐藏真相直接交给 actor。
- 角色记忆已覆盖的知识，在外部流程已经显式检索并注入时不要重复放进 `<knowledge>`。当前没有自动 context-load，组装 packet 时不能假定 actor 已经看到记忆文件。
- 当前没有自动 memory-save。角色通过 `<knowledge>` 第一次接触的信息若需沉淀，必须由授权 workflow/job 或其他外部流程显式维护；`simulator.actor` 自身不读写 subject 记忆文件。

## LOD 事件数量的动态调整

上面层级表中的数量是**基准值**，按当前剧情密度调整：

- **剧情密度高**（多角色冲突、重要裁决多、场景本身信息量大）→ 降低 LOD 事件数。LOD0 可以只给 2–3 个，避免世界噪声淹没主线。
- **剧情密度低**（赶路、休整、独处、等待）→ 提高 LOD 事件数。让世界的自主运行感填充叙事空间。
- LOD 的目的是补足世界真实感，不是固定配额。每轮先判断"这个场景缺多少世界细节"，再决定生成多少。
