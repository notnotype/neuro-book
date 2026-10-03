# World Engine — 奇幻世界完整实例

> 本文件是 [README.md](README.md) 的子文档，用一个奇幻世界从「模板创建」到「演化 1 tick」完整走一遍设计模型，验证 [schema-design.md](schema-design.md) 与 [sqlite-and-api.md](sqlite-and-api.md) 是否自洽好用。
> 状态：**草案 / 示例**。其中「模板预制 subject」属于实现后的规范层 / 应用层工作，非世界引擎核心，本文只示意。

## 0. 时间换算基准（本例采用的奇幻历）

- 基准刻 = 1 秒（定论）。零点 `instant=0` = 复兴纪元 1 年 1 月 1 日 00:00:00。
- 本例历法：1 年 = 12 月，1 月 = 30 日，1 日 = 24 时，1 时 = 3600 秒。
  - **每年秒数** = 12×30×24×3600 = **31,104,000 秒**。
- 复兴纪元 N 年 1 月 1 日 00:00 的 instant = `(N-1) × 31,104,000`。
- 故事「现在」设定在 **复兴纪元 488 年**。
- 注意：历法通过 `world-engine/calendar.yaml` 做项目级 parse/format；底层仍只保存真实 instant，可直接比较 / reduce。下表给出本例字符串对应的 instant，便于核对。


| 时间点                               | 含义                   | instant（秒）    |
| ------------------------------------ | ---------------------- | ---------------- |
| 复兴纪元 1 年                        | 零点 / 公元            | `0`              |
| 复兴纪元 188 年                      | 远古战争               | `5,816,448,000`  |
| 复兴纪元 200 年                      | 凤凰王国建立           | `6,189,696,000`  |
| 复兴纪元 470 年                      | 主角艾莉娜出生         | `14,587,776,000` |
| 复兴纪元 488 年 风信之月 15 日 14:00 | 故事现在（城北遭遇战） | `15,151,500,000` |

## 1. 模板创建：`world-engine/` 默认长什么样

项目从模板创建（对齐现有 `project-directory-templates` 机制），新 Project Workspace 顶层多出 `world-engine/`：

```text
world-engine/
├── schema.yaml        # subject 类型定义（本例核心）
├── calendar.yaml      # 项目日历 parse/format 配置（本例采用 §0 的换算）
└── index.md          # directory-index frontmatter（中文 title + Lucide icon，驱动文件树展示）
```

`schema.yaml`（模板自带的奇幻默认 schema，可被作者改）：

```yaml
subjectTypes:
  world:
    desc: 世界本身，承载纪元、纪年、全局气候等
    attrs:
      era:        { kind: scalar, type: text,  default: "复兴纪元" }
      currentYear:{ kind: scalar, type: int }
      climate:    { kind: scalar, type: text,  default: "温和" }
      events:     { kind: list,   itemType: text }     # 世界级大事记

  character:
    desc: 角色（主角与 NPC 共用）
    attrs:
      hp:        { kind: scalar, type: int, default: 100 }
      maxHp:     { kind: scalar, type: int, default: 100 }
      level:     { kind: scalar, type: int, default: 1 }
      age:       { kind: scalar, type: int }
      location:  { kind: scalar, type: ref(location) }
      faction:   { kind: scalar, type: ref(faction) }
      mind:      { kind: scalar, type: text }
      equipment: { kind: object, fields: { head: {type: ref(item)}, chest: {type: ref(item)}, weapon: {type: ref(item)} } }
      inventory: { kind: collection, itemType: ref(item) }
      memory:    { kind: object, itemType: text }       # 开放字典 key=topic
      events:    { kind: list, itemType: text }

  faction:
    desc: 国家 / 阵营
    attrs:
      name:     { kind: scalar, type: text }
      treasury: { kind: scalar, type: int, default: 0 }
      capital:  { kind: scalar, type: ref(location) }
      events:   { kind: list, itemType: text }

  location:
    attrs:
      name:    { kind: scalar, type: text }
      control: { kind: scalar, type: ref(faction) }

  item:
    desc: 需要独立追踪状态的物品才建 subject。判断标准 = 这个物品是否需要随时间追踪的独立状态。
          有以下任一就建 subject：独立状态 / 隐藏真相 / 独特身份 / 持有人差异 / 损耗或激活状态 / 重要剧情身份。
          否则 inventory 直接放字符串元素即可：
            反例（不必建 subject）："干粮" / "火把" / "金币×10" —— 没有自己的耐久 / 历史 / 诅咒，inventory = ["干粮","火把"] 足矣。
            正例（建 subject）：被附魔会变化的剑、唯一道具、被下毒的血药、有耐久和持有人差异的装备。
          口诀：三瓶普通血药是 inventory 计数；一瓶被下毒的血药是 subject。
    attrs:
      name:       { kind: scalar, type: text }
      durability: { kind: scalar, type: int }
      enchants:   { kind: collection, itemType: text }
```

## 2. 模板预制 subject（规范层 / 应用层，非核心，示意）

模板初始化时预制几个开箱即用的 subject（实现后由初始化脚本 / leader agent 创建）：


| subject id  | type      | 说明       |
| ----------- | --------- | ---------- |
| `world`     | world     | 世界本身   |
| `phoenix`   | faction   | 凤凰王国   |
| `erina`     | character | 主角艾莉娜 |
| `capital`   | location  | 王都       |
| `northgate` | location  | 城北       |

`createSubject` 会先注册 subject 身份；如果 schema 为该 type 声明了 `default`，则生成或追加 **kind=init 的初始化 mutation**，把 default 写成一组 set mutation（见 §3 的初始化切面）。其中 `list` / `collection` 的 `set []` / `set [...]` 表示整组替换，value 必须是数组并按元素类型校验。自动追加只允许落到同 instant 已有的 `kind=init` 切面；如果该时刻已有普通事件切面，调用方需要用 `editSlice` 显式合并或选择其他初始化时间。没有 default 的 subject 不会创建空切面。

## 3. 项目初始化：用一个切片表示「公元」（= 世界的第一个切片）

时间系统初始化 = 在 `instant=0` 写一个 **kind=init 的「公元」切面**，这是**整个世界的第一个切片**，同时承载 world subject 的初值。

**零点不是一个独立机制**：它就是 world subject 的 init 切面的 instant。world 这个 subject 的 init 切面恰好落在 `0`，因此它的角色比其他 subject 多一层 —— **它定义了「什么时候是 0」**。未来若某项目想把零点改成「宇宙大爆炸前 100 年」，只要把 world 的 init 切面 instant 改成 `-3_153_600_000` 即可，所有其他切面照常工作，引擎不需要额外的「零点配置」机制。

后续创建新 subject 时，如果它有 default，就会在各自的「出生」instant 写入或追加 init mutation；如果同一 instant 已经有 `kind=init` 切面，则追加进该切面的 mutations；如果该 instant 已有普通事件切面，则调用方需要用 `editSlice` 显式合并或选择其他初始化时间。只有 world 的 init 切面同时充当纪元锚点。

```jsonc
// 切面 #0：公元 / 纪元锚点  @ instant=0
{
  "instant": 0,
  "kind": "init",
  "title": "复兴纪元 元年",
  "summary": "世界纪元起点（公元）。instant=0 即此刻。",
  "mutations": [
    { "subjectId": "world", "attr": "era",     "op": "set", "value": "复兴纪元" },
    { "subjectId": "world", "attr": "climate", "op": "set", "value": "温和" },
    { "subjectId": "world", "attr": "currentYear", "op": "set", "value": 1 }
  ]
}
```

这条切面就是「用一个切片表示公元」：它锚定 instant=0 的含义，并初始化 world 主体。**任何后续 reduce 都从这里起步**，因为它是 timeline 上最早的切面。

## 4. 为世界填历史（过去的切片）

历史 = 在「现在」之前的 instant 上补切面。下面按时间顺序补四段过去。

```jsonc
// 切面 #1：远古战争  @ 复兴纪元188年  instant=5,816,448,000
{
  "instant": 5816448000,
  "kind": "event",
  "title": "黑潮战争",
  "summary": "三百年前，黑潮自北方降临，旧王朝覆灭。",
  "mutations": [
    { "subjectId": "world", "attr": "events", "op": "listAppend",
      "value": "复兴纪元188年：黑潮战争爆发，旧王朝覆灭，大陆进入百年混乱。" },
    { "subjectId": "world", "attr": "climate", "op": "set", "value": "寒冷（黑潮余波）" }
  ]
}

// 切面 #2：凤凰王国建立  @ 复兴纪元200年  instant=6,189,696,000
{
  "instant": 6189696000,
  "kind": "event",
  "title": "凤凰王国立国",
  "mutations": [
    // 王国 subject 的初始化也可并入此切面（或它自己的 init 切面）
    { "subjectId": "phoenix", "attr": "name",     "op": "set", "value": "凤凰王国" },
    { "subjectId": "phoenix", "attr": "treasury", "op": "set", "value": 100000 },
    { "subjectId": "phoenix", "attr": "capital",  "op": "set", "value": "subject://capital" },
    { "subjectId": "phoenix", "attr": "events",   "op": "listAppend",
      "value": "复兴纪元200年：初代凤凰王统一南境，定都王都。" },
    { "subjectId": "world",   "attr": "events",   "op": "listAppend",
      "value": "复兴纪元200年：凤凰王国立国。" }
  ]
}

// 切面 #3：主角出生  @ 复兴纪元470年  instant=14,587,776,000
{
  "instant": 14587776000,
  "kind": "event",
  "title": "艾莉娜出生",
  "mutations": [
    { "subjectId": "erina", "attr": "age",      "op": "set", "value": 0 },
    { "subjectId": "erina", "attr": "faction",  "op": "set", "value": "subject://phoenix" },
    { "subjectId": "erina", "attr": "location", "op": "set", "value": "subject://capital" }
  ]
}
```

> 演示「往前插切面」的灵活性：若作者此刻突然设定「黑潮战争其实还有前因，公元150年有过预兆」，只需在对应项目日历时间再 `writeSlice` 一条，timeline 自动按底层时间戳归位。add 类 mutation 对前插更稳定；set 类若影响下游语义，写入结果会通过 `base-shifted` / `masked` issues 提醒作者确认。

## 5. 为世界填现状（接近「现在」的切片）

把主角从出生推进到 488 年的当前状态。这里用一条 18 岁的成长切面把现状交代清楚。

```jsonc
// 切面 #4：现状定格  @ 复兴纪元488年 风信之月15日 08:00  instant≈15,151,478,800
{
  "instant": 15151478800,
  "kind": "event",
  "title": "488年·学徒艾莉娜",
  "summary": "故事开场前的现状：18岁，见习骑士，驻王都。",
  "mutations": [
    { "subjectId": "world", "attr": "currentYear", "op": "set", "value": 488 },
    { "subjectId": "erina", "attr": "age",      "op": "set", "value": 18 },
    { "subjectId": "erina", "attr": "level",    "op": "set", "value": 3 },
    { "subjectId": "erina", "attr": "hp",       "op": "set", "value": 80 },
    { "subjectId": "erina", "attr": "mind",     "op": "set", "value": "渴望证明自己" },
    { "subjectId": "erina", "attr": "memory.师门", "op": "set", "value": "敬畏" },
    { "subjectId": "erina", "attr": "location", "op": "set", "value": "subject://capital" }
  ]
}
```

### reduce 验证：过去 vs 现在

- **`getWorldState(at = 6,189,696,000)`（复兴纪元200年）** → 只叠 ≤ 该 instant 的切面（#0,#1,#2）：

  - world: era=复兴纪元, climate=寒冷（黑潮余波）, currentYear=1, events=[黑潮战争, 凤凰立国]
  - phoenix: name=凤凰王国, treasury=100000, capital=`subject://capital`
  - erina: **尚不存在有效状态**（#3 出生切面在此 instant 之后，被截断）→ 体现「倒叙看 200 年时主角还没出生」。
- **`getWorldState()`（默认最新 = 488年现状）** → 叠全部切面：

  - world: era=复兴纪元, climate=寒冷（黑潮余波）, currentYear=488, events=[3 条]
  - erina: age=18, level=3, hp=80, faction=`subject://phoenix`, location=`subject://capital`, mind="渴望证明自己", memory={师门:"敬畏"}

**同一套切面，传不同 `at` 就 reduce 出不同时代的世界 —— 这就是设计的核心价值。**

## 6. 演化 1 tick：城北遭遇战

「演化一个 tick」= 世界引擎在当前最新 instant 之后追加一个切面，记录这一刻所有 subject 的变化。

```jsonc
// 切面 #5（tick）：城北遭遇战  @ 复兴纪元488年 风信之月15日 14:00  instant=15,151,500,000
{
  "instant": 15151500000,
  "kind": "event",
  "title": "城北遭遇战",
  "summary": "艾莉娜在城北遭遇伏击，受伤，夺得一把旧剑。",
  "mutations": [
    // 主角移动到城北
    { "subjectId": "erina", "attr": "location", "op": "set", "value": "subject://northgate" },
    // 受伤：用 add 相对增量（对插切面免疫，逆=add+30）
    { "subjectId": "erina", "attr": "hp", "op": "add", "value": -30 },
    // 捡到剑：先创建 item subject（实际由应用层先 createSubject），再入背包、装备
    { "subjectId": "sword-01", "attr": "name", "op": "set", "value": "锈蚀长剑" },
    { "subjectId": "erina", "attr": "inventory", "op": "collectionAdd", "value": "subject://sword-01" },
    { "subjectId": "erina", "attr": "equipment.weapon", "op": "set", "value": "subject://sword-01" },
    // 心理与认知变化
    { "subjectId": "erina", "attr": "mind", "op": "set", "value": "警惕，意识到王都外并不安全" },
    { "subjectId": "erina", "attr": "memory.师门", "op": "set", "value": "怀疑（为何无人来援）" },
    // 经历流
    { "subjectId": "erina", "attr": "events", "op": "listAppend",
      "value": "风信之月15日午后，在城北遭伏击，左肩中箭，夺得伏兵的锈蚀长剑。" },
    // 世界级记录（可选）
    { "subjectId": "northgate", "attr": "name", "op": "set", "value": "城北哨道" }
  ]
}
```

### tick 后 `getWorldState()`（默认最新 = 15,151,500,000）

```jsonc
{
  "instant": 15151500000,
  "subjects": [
    { "subjectId": "world",  "type": "world",
      "attrs": { "era": "复兴纪元", "climate": "寒冷（黑潮余波）", "currentYear": 488,
                 "events": ["...黑潮战争...", "...凤凰立国...", ...] } },
    { "subjectId": "phoenix","type": "faction",
      "attrs": { "name": "凤凰王国", "treasury": 100000, "capital": "subject://capital" } },
    { "subjectId": "erina",  "type": "character",
      "attrs": { "age": 18, "level": 3, "hp": 50,                       // 80 + (-30)
                 "location": "subject://northgate",
                 "faction": "subject://phoenix",
                 "mind": "警惕，意识到王都外并不安全",
                 "memory": { "师门": "怀疑（为何无人来援）" },
                 "inventory": ["subject://sword-01"],
                 "equipment": { "weapon": "subject://sword-01" },
                 "events": ["...", "风信之月15日午后…夺得锈蚀长剑。"] } },
    { "subjectId": "sword-01","type": "item",
      "attrs": { "name": "锈蚀长剑" } },
    { "subjectId": "northgate","type": "location",
      "attrs": { "name": "城北哨道" } }
  ]
}
```

- `hp` 用 `add -30` → reduce 时在前值 80 上累加得 50，**且若有人往 488年之前再插一条扣血切面，本 tick 的 -30 不需改动**。
- `equipment.weapon` 与 `inventory` 都指向 `subject://sword-01`，**ref 不展开**；要剑的状态另调 `getWorldState` 看 sword-01。
- 回退本 tick：第一版使用 `deleteSlice` 物理删除切面 #5，然后重新 reduce；删除后若下游相对 op 缺基，会返回 `broken-relative` issue。`deleteSlice` 不可恢复，也不会自动删除应用层提前创建的 subject 身份（例如 `sword-01`），如果未来需要保留审计轨迹或可恢复撤销，需要另行设计补偿切面 / 撤销机制。

## 7. 这个例子验证了什么

- **时间初始化**：instant=0 的「公元」切面锚定纪元，自包含。
- **历史可补**：过去就是更早时间点的切面；往前插后由 reduce 得到最新状态，set 对下游语义的影响通过 A issues 提醒确认。
- **任意时刻世界状态**：同一切面序列 + 不同 `at` → reduce 出 200 年 / 488 年 / tick 后三种世界，主角在 200 年「还没出生」天然成立。
- **一个 tick**：就是追加一个切面记录该刻所有 subject 变更；reduce 立刻反映。
- **5 种 op、4 种 kind、subject:// 引用、不双向、不自动解** 全部在一个连贯故事里跑通，模型自洽。
