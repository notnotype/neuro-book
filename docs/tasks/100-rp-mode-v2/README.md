# RP 模式 v2 重构设计

> 状态：Design Confirmed（2026-07-26 与用户逐轮确认）。分阶段实施，本文档为基准合同。

## 背景

- RP 模式当前处于降级状态：`rp.leader` / `simulator.leader` 从 Agent 新建菜单隐藏（`AgentChatSurface.vue` hiddenWritingModeProfileKeys），默认项目模板不再创建 `simulation/` 与 RP agents 目录。
- 旧协议（`reference/agent/rp-tick/`）完整保留：四 profile 流水线（rp.leader → simulator.leader → simulator.actor → rp.writer）、LOD 世界模拟、actor-facing packet、writer brief、subject 六文件 + RAG 记忆。
- 旧世界状态用 `simulation/` 下 markdown 手工维护；写作模式已迁移 World Engine（切片 + 任意时刻推算），RP 未接入。

v2 目标：恢复 RP 模式并按新架构重设计——World Engine 作为唯一世界状态源、职责更细的 agent 分工、独立沉浸式界面、可审计的角色记忆体系。

## 一、Agent 架构（六角色）

| Profile | 人设 | 职责 | 备注 |
| --- | --- | --- | --- |
| `rp.leader` | 彩绘 | 主持、IC/OOC 审查、编剧 Writer Brief、终稿组装 | 职责不变 |
| `rp.world`（用户提案名 World.leader） | 无 | **仅**读写 World Engine：Tick 开始读当前切片状态并分发（剥除 secret）；Tick 结束写回切片 | 新增。命名避开与写作模式 `world.engine` 冲突 |
| `rp.screenwriter` | 无 | 一切「判断」：①事前判断（出场角色名单、是否需要群演及哪些群演、行动成功率、意外/小概率事件 + LOD 世界事件）②事后终裁（综合 actor 反应 + 判定 → 全知裁决结果报告）③维护各角色「未知信息」账本 | 新增。终裁归属是设计确认的关键补充 |
| `simulator.leader`（候选改名 `rp.cast`，开放项） | 无 | 按 screenwriter 的出场名单生成/复用 `simulator.actor` 子代理并调度，仅主要角色 | 职责收窄：不再裁决、不再写状态 |
| `rp.extras` | 无 | 单 agent 扮演本 Tick 全部非主要 NPC 群演；对出格行为按 NPC 职业/性格给出反应 | 新增。不按群演数量开子代理 |
| `rp.writer` | 小猫之神 | Writer Brief → 用户可见正文（草稿 → stop-slop → write → 润色） | 职责不变 |
| `simulator.actor` | 各角色 soul.md | 单角色第一人称扮演，三通道输出 | 沿用 |

## 二、Tick 流水线 v2

```
用户输入
  ↓ P0  rp.leader        IC/OOC 审查；OOC 直接回应不进流水线
  ↓ P1  rp.world         读当前时间切片状态,按接收方剥除 secret 后分发
  ↓ P2  rp.screenwriter  事前判断:出场名单/群演需求/成功率掷骰/意外事件/LOD 世界事件
  │       └─ 轻量 Tick 通道:判定「本轮无世界影响」→ 跳过 P3-P4,短链直达 P5
  ↓ P3  simulator.leader 主角 actors 并行 invoke   ∥   rp.extras 群演
  ↓ P4  rp.screenwriter  终裁:综合反应+判定 → 全知裁决结果报告;维护未知信息账本
  ↓ P5  rp.world 写回切片(含 pending 未来切片) ∥ rp.leader 编 Brief → rp.writer 渲染
  ↓ P6  rp.leader        组装:prose + 彩绘元场景
```

- P3 的 actor 调用必须并行；P5 的写回与编剧渲染并行。
- 群演反应并入终裁报告，不单独写 World Engine，除非某 NPC 被升格为正式 subject。

## 三、World Engine 改造

1. **worldKey 隔离**：facade / repository / API / `execute_world` 增加 `worldKey` 维度（`main` = 写作模式，`rp` = RP 模式），同项目两条独立时间线与 subject 空间。
2. **UI 切换**：Workbench 与状态总览面板增加模式切换按钮；leader（rp.leader / leader.default）经工具参数获得双模式读取权限。
3. **secret 可见性约定**：subject 可含 `secret` 子对象（隐藏动机/未揭示真相）。rp.world 分发状态时默认剥除；仅 rp.screenwriter（终裁）与 rp.leader（编暗线）取完整版。
4. **Pending Events = 未来切片**：「女仆两分钟后到达」类事件直接写成未来时间的切片（kind=`pending`），时间推进越过即自动到期，取代 current.md 手工记账。
5. **图数据即 subject 关系**：
   - 地点 subject schema 约定 `连接: [{目标: ref, 距离, 方向}]` → 地图面板数据源；
   - 角色 subject `关系: [{对象: ref, 类型, 好感}]` → 关系图数据源。
6. **透明掷骰**：screenwriter 成功率判定输出结构化 `{行动, 难度依据, 概率, 掷骰结果}`，记入裁决报告与切片 summary；可选「明骰」模式供元场景展示。

## 四、角色信息与记忆体系（`rp/characters/`）

```
rp/characters/{角色id}/
├── 人设/
│   ├── soul.md          第一人称扮演手册(沿用现有格式)
│   └── 心境.md          短期情绪/意图/悬念,每 Tick 更新
├── 已知信息/
│   └── knowledge.md     状态性知识,永不老化,原地更新
├── 未知信息(god-view)/   screenwriter 维护;actor 永不可见
└── 记忆/
    ├── 摘要.md          三级粒度滚动(远期段落/中期行/近期每Tick一行)
    └── ticks/TickNNN.md 该角色视角的当 Tick 详情
```

规则（设计确认要点）：

- **信念非真相**：已知信息存角色「相信的」，被骗/误解照记；每条带 `来源 / 得知Tick / 属实(仅god-view可见)`。信念与 WE 客观事实的偏差是 screenwriter 的戏剧素材。
- **知识 vs 事件**：状态性知识（关系、物品位置）永驻已知信息；事件性经历 5-Tick 后滚入记忆归档，防止「钥匙在哪」被老化造成失忆。
- **未知信息 = god-view 戏剧反差账本**：screenwriter 写入（场外相关事件）、揭示时移入已知信息并标注得知方式；只有 screenwriter 与 rp.leader 可读。
- **记忆详情按角色视角存**：非化身角色的 TickNNN.md 由该角色 actor 三通道输出 + 所收 packet 拼成，**不得**直接存 prose 原文（防止记住未经历之事）；用户化身可引 prose 原文。
- **渐进式回忆**：摘要先行（便宜索引）→ 命中再细读 TickNNN → RAG 联想补充。实现为改造 `actor.context-load` / `actor.memory-save` sidecar。
- **与 WE 分工**：WE = 客观世界（发生了什么），characters/ = 主观认知（角色以为什么）；两边独立演进，不做同步，知识过时是合理剧情。
- **维护时序**：Tick 结束段——rp.world 写 WE ∥ 记忆维护（详情/摘要/知识/心境）∥ screenwriter 维护未知信息；每 N Tick 摘要滚动压缩。

## 五、RP 独立界面

- **独立入口**：与 agent 会话 / IDE 并列的 RP 界面。
- **主区域**：沉浸式对话流——prose 内联渲染（非文件链接）、彩绘元场景以不同样式区分、Tick 进行中显示阶段进度（世界推演中/正在写作…）。
- **侧边栏三面板**（数据源 = World Engine rp worldKey）：
  1. **世界**：当前时间、地点、在场角色、整体态势；
  2. **地图**：vue-flow 渲染地点连接图，初始空白，随剧情由 screenwriter 提取空间事实 → rp.world 写切片 → 自动生长；
  3. **角色状态**：每角色独立条目（复用状态总览卡片 + widget 体系）+ 角色关系图（vue-flow）。

## 六、兼容与迁移

- legacy `simulation/` 体系、旧 profile、旧 rp-tick 文档保留不删；历史项目继续可用。
- v2 使用全新 `rp/` 目录约定，无存量包袱。
- SillyTavern 导入的 `--rp` 迁移通道后续对准新体系。

## 开放项（实施中决策）

- `simulator.leader` 是否改名 `rp.cast` 或并入 screenwriter 事前段。
- prose 内联渲染的实现细节（流式/一次性）。
- 轻量 Tick 的判定标准细则。
- 摘要滚动压缩的 N 取值与触发方式。

## 实施计划（分五阶段）

| 阶段 | 内容 | 关键交付 | 依赖 |
| --- | --- | --- | --- |
| **P1 World Engine worldKey 隔离** ✅ | facade/API/execute_world 加 worldKey（rp = 独立 `.nbook/world-rp.sqlite`，惰性建库，schema/calendar 共享）；Workbench 头部世界线切换 | 已完成：隔离单测 + API E2E + UI 编译验证全部通过 | 无（一切的基础） |
| **P2 记忆体系** ✅ | `server/rp/character-store.ts`（目录骨架/K-U 条目/属实批注/记忆提交/三级摘要滚动原语）；`rp_character_recall` / `rp_character_update` / `rp_memory_commit` 三工具 + builtin 注册；协议文档 `reference/agent/rp-v2/character-memory.md` | 已完成：12 项单测通过（格式往返/reveal 转移/滚动压缩/视图隔离/端到端）。actor sidecar 改造移至 P3（与新 profile 一体，不动 legacy simulator.actor） | P1 不强依赖，可并行 |
| **P3 Agent 层** ✅ | 新 profile ×5：rp.world / rp.screenwriter / rp.cast / rp.extras / rp.actor（含双 sidecar 接新记忆体系）；rp.leader 契约段重写为 v2 六角色编排（彩绘人设不变）；v2 协议文档三份（rp-v2/README + world-contract + adjudication）；subject RAG 工具扩展支持 rp/characters/ 路径 | 已完成：19 profile 全部编译通过，rp-profiles 等 34 项测试全绿。开放项落定：simulator.leader/simulator.actor 保留为 legacy 不动，v2 用 rp.cast/rp.actor | P1、P2 |
| **P4 RP 界面** ✅ | **真正的第三布局**（用户确认后由弹窗演进）：头部左上角 Agent/IDE/RP 三态滑块切换；RP 选中时内容区渲染 `RpModeSurface`（IDE 头部常驻，Agent/IDE 布局 v-show 保活）。左侧 `RpSidebar` 三面板（与 IDE 侧栏同侧，可收起）——世界（当前时间/世界状态/登场要素/最近事件含 pending 标记）、地图（vue-flow 地点连接图，`rp-graph.ts` 自适应提取 subject 引用建边）、角色（每角色独立卡片 + 关系图，secret 剥除）；右侧沉浸对话流（AgentChatSurface + `profileKeyOverride="rp.leader"`，workspace 同步自动刷新侧栏） | 已完成：组件全部编译通过，catalog 7 个 rp.* loaded，页面 200。浏览器交互验证待用户执行 | P1（数据）、P3（流水线） |
| **P5 联调与收尾** ✅ | `rp-v2-bootstrap` skill（五步从零到可玩：材料确认→rp.world 初始化→角色建档→开场白→可选 state-view）；数据面端到端流水线测试 `server/rp/rp-tick-flow.test.ts`（bootstrap→Tick001 全闭环：世界线隔离/secret 剥除/掷骰记录/pending 切片/记忆提交/账本揭示/终裁落盘断言全绿）；PROJECT-STATUS 更新（Summary + 任务表 + 待验收 TODO 五项） | 已完成。LLM 全流水线实测与浏览器交互验收移交用户（需模型 Key），见 PROJECT-STATUS TODO | 全部 |
