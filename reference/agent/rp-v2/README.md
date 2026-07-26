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
| `rp.writer` | Writer Brief → 用户可见正文 | 沿用 [../rp-tick/writer-brief.md](../rp-tick/writer-brief.md) 与 [../rp-tick/rp-writer-interaction.md](../rp-tick/rp-writer-interaction.md) |

packet 标签规范沿用 [../rp-tick/actor-facing-packet.md](../rp-tick/actor-facing-packet.md)（`<gm>/<character>/<knowledge>/<directive>`）。

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

## 开场 / 初始化

1. rp.leader 读 manual/、确认化身；调用 rp.world 建立初始世界状态（world subject + 化身/关键 NPC 首切片，worldKey=rp）。
2. 对每个主要角色调用 `rp_character_update op=ensure` 建 `rp/characters/{id}/` 档案（soul.md 按 [../rp-tick/subject-creation-guide.md](../rp-tick/subject-creation-guide.md) 方法论撰写）。
3. 开场白 Brief 交 rp.writer，写入 `rp/ticks/000000-initial-state/prose.md`。

## Tick 产物落盘

```
rp/
├── characters/{id}/          角色主观认知层（见 character-memory.md）
└── ticks/{NNNNNN-slug}/
    ├── report.md             screenwriter 终裁报告（全知，god-view）
    └── prose.md              用户可见正文
```

- Tick 号从 000001 递增（000000 固定为初始化）；`{NNNNNN-slug}` 的 slug 用短横线英文短语。
- 客观状态变化只写 World Engine 切片，不再维护 legacy 的 current.md/state.md；Pending Events 用未来时间切片（kind="pending"）表达。

## 与 legacy 的边界

`simulation/` 体系（simulator.leader / simulator.actor / rp-tick 旧协议）保留供历史项目使用。v2 全部落在 `rp/` 目录与 `rp.*` profile，两套互不迁移、互不混用。
