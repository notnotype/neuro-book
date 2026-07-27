# RP v2 Tick Protocol

RP 模式 v2 的世界推进协议。六角色流水线，World Engine（worldKey="rp"）为唯一客观状态源，`rp/characters/` 为角色主观认知层。设计基准见 docs/tasks/100-rp-mode-v2/README.md。

## 角色分工

| Profile | 职责 | 关键约束 |
| --- | --- | --- |
| `rp.leader` | 主持（彩绘）：IC/OOC 审查、流水线编排、编剧 Writer Brief、终稿组装 | 不写任何世界内正文；不自己裁决世界 |
| `rp.world` | World Engine 唯一读写通道：Tick 开始读状态分发、结束写回切片 | 一律 worldKey="rp"；默认剥除 secret；见 [world-contract.md](world-contract.md) |
| `rp.screenwriter` | 一切判断：事前判断（出场名单/群演/成功率掷骰/意外+LOD）、事后终裁、未知信息账本维护 | 全知层；见 [adjudication.md](adjudication.md) |
| `rp.cast` | 按名单创建/复用 `rp.actor` 并**并行**调度，组装 actor-facing packet | 只接触过滤后材料，不接触 god-view |
| `rp.actor` | 单角色第一人称扮演（每主要角色一个），三通道输出 | 记忆走 `rp/characters/`；见 [character-memory.md](character-memory.md) |
| `rp.extras` | 单 agent 扮演本 Tick 全部群演 NPC | 不写文件；只消费上级注入的材料 |
| `rp.writer` | Writer Brief → 用户可见正文 | 见 [writer-brief.md](writer-brief.md) 与 [rp-writer-interaction.md](rp-writer-interaction.md) |

packet 标签规范见 [actor-packet.md](actor-packet.md)（`<gm>/<character>/<knowledge>/<directive>`）；LOD 世界模拟见 [lod-simulation.md](lod-simulation.md)。

## Tick 流水线

```
用户输入
 ↓ P0  rp.leader        IC/OOC 审查。OOC 直接回应，不进流水线。
 ↓ P1  rp.world         读当前切片状态（worldKey=rp），输出剥除 secret 的状态分发摘要。
 ↓ P2  rp.screenwriter  事前判断：出场名单 / 群演需求 / 成功率掷骰 / 意外事件 + LOD。
 │       └─ 轻量通道：判定「本轮无世界影响」→ 跳过 P3-P4，直达 P5。
 ↓ P3  rp.cast 主角 actors 并行  ∥  rp.extras 群演          ← 必须并行
 ↓ P4  rp.screenwriter  终裁：综合三通道反应 + 判定结果 → 全知裁决报告；维护未知信息账本。
 ↓ P5  rp.world 写回切片 ∥ rp.leader 编 Brief → rp.writer 渲染   ← 可并行
 ↓ P6  rp.leader        组装：prose 链接 + 彩绘元场景。各角色记忆维护由 actor 的 memory-save sidecar 在 P3 结束时完成。
```

编排要点（rp.leader 责任）：

- P1/P2/P4 的产物在阶段间原样转发，不要自己改写裁决内容。
- P3 的多个 actor invoke 互不依赖，**必须在同一轮并行发出**；rp.extras 与 actors 并行。
- 轻量通道：screenwriter 判定 `世界影响: 无`（纯对话、原地观察、纯情绪交流）时，rp.leader 直接编 Brief 交 writer，本 Tick 不写世界切片、不派 actor。
- 群演反应并入终裁报告，不单独写 World Engine，除非 screenwriter 决定把某 NPC 升格为正式 subject/角色。
- 每个 prose artifact 一个新的 rp.writer session；Brief 协议不变。

## RP 专属目录（与写作模式完全分离）

RP 模式的一切材料都在项目的 `rp/` 子树内，**与写作模式零共享**——RP agent 不读写作模式的 `lorebook/`、`manual/`、`world-engine/`、`manuscript/`，写作模式 agent 也不进 `rp/`。初始化时可从写作素材**一次性拷贝改编**（用户主导），运行时绝不跨读。

```
rp/
├── world-engine/             RP 专属 schema + calendar（结构镜像根 world-engine/：schema/index.ts + calendar.ts）
│                             数据存 .nbook/world-rp.sqlite；worldKey=rp 的一切读写用这套配置
├── lorebook/                 RP 世界观 canon（screenwriter 全知读取）
├── manual/                   玩家手册层：README.md / world-guide.md / rules-guide.md / gm-guide.md / player-guide/
├── characters/{id}/          角色主观认知层（见 character-memory.md）
└── ticks/{NNNNNN-slug}/
    ├── report.md             screenwriter 终裁报告（全知，god-view）
    └── prose.md              用户可见正文
```

## 开团顺序（新冒险）

1. **开团引导**（[adventure-intake.md](adventure-intake.md) / `rp-v2-adventure-intake` skill）：rp.leader 分流——已有冒险介绍进度让用户选；无材料时问用户走「改编写作模式 lorebook」还是「从零问答共创」，冒险企划书经用户确认后落盘 rp/manual/ + rp/lorebook/。绝不跳过引导直接编剧本开跑。
2. **技术初始化**（`rp-v2-bootstrap` skill Step 2 起）：
   - rp.leader 建 `rp/world-engine/`（schema/index.ts + calendar.ts，抄 skill 里的模板）；调用 rp.world 建立初始世界状态（world subject + 化身/关键 NPC 首切片，worldKey=rp）。
   - 对每个主要角色 `rp_character_update op=ensure` 建 `rp/characters/{id}/` 档案——**必带 name 显示名与 aliases**，id 登记进注册表（soul.md 按 [../rp-tick/subject-creation-guide.md](../rp-tick/subject-creation-guide.md) 方法论撰写）。
   - 开场白 Brief 交 rp.writer，写入 `rp/ticks/000000-initial-state/prose.md`。

## Tick 产物落盘

- Tick 编号的唯一权威是 `rp_tick_info`（扫描 rp/ticks/ 返回 nextTick）：rp.leader 每 Tick 开始时取号并向全管线宣告，任何 agent 不得自行推算。000000 固定为初始化；`{NNNNNN-slug}` 的 slug 用短横线英文短语。
- 客观状态变化只写 World Engine 切片，不再维护 legacy 的 current.md/state.md；Pending Events 用未来时间切片（kind="pending"）表达。

## 与 legacy / 写作模式的边界

- `simulation/` 体系（simulator.leader / simulator.actor / rp-tick 旧协议）保留供历史项目使用。v2 全部落在 `rp/` 目录与 `rp.*` profile，两套互不迁移、互不混用。
- 写作模式的 `lorebook/`、`manual/`、`world-engine/`（main 世界线）对 RP agent 是禁区；反之写作模式 agent 不读写 `rp/`。防止两模式互相污染设定与状态。
