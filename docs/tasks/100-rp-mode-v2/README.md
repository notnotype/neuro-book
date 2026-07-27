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

1. **worldKey 隔离**：facade / repository / API / `execute_world` 增加 `worldKey` 维度（`main` = 写作模式，`rp` = RP 模式），同项目两条独立时间线与 subject 空间。**（后续强化，用户拍板）schema/calendar 也按 worldKey 分根**：main 用根 `world-engine/`，rp 用 `rp/world-engine/`，配置零共享；rp 配置缺失时明确报错，绝不回退写作模式配置。
2. **UI 切换**：Workbench 与状态总览面板增加模式切换按钮；leader（rp.leader / leader.default）经工具参数获得双模式读取权限。
3. **secret 可见性约定**：subject 可含 `secret` 子对象（隐藏动机/未揭示真相）。rp.world 分发状态时默认剥除；仅 rp.screenwriter（终裁）与 rp.leader（编暗线）取完整版。
4. **Pending Events = 未来切片**：「女仆两分钟后到达」类事件直接写成未来时间的切片（kind=`pending`），时间推进越过即自动到期，取代 current.md 手工记账。
5. **图数据即 subject 关系**：
   - 地点 subject schema 约定 `连接: [{目标: ref, 距离, 方向}]` → 地图面板数据源；
   - 角色 subject `关系: [{对象: ref, 类型, 好感}]` → 关系图数据源。
6. **透明掷骰（2026-07-27 升级为 2d6 用户亲掷制，用户拍板）**：骰值不再由 LLM 生成（存在分布偏置与叙事倾向污染）。screenwriter 只定 2d6 目标值（容易≥5/普通≥7/困难≥9/极难≥11）与难度依据、三档后果预案；rp.leader 遇「待掷骰」判定即结束回合向用户喊话；**用户点击 RP 界面悬浮骰子按钮**（`RpModeSurface`）→ `POST /api/projects/rp/dice` 服务端 crypto RNG 掷 2d6 → 追加写入 `rp/dice/rolls.jsonl`（`{seq,d1,d2,total,at}`，唯一真相源）→ 前端自动发送回执消息续流程 → rp.leader read 文件校验 seq 大于喊话前序号后传回 screenwriter 继续。差目标值 1-2 点判部分成功。判定全记录进切片 summary（`[掷骰#seq] 行动/目标/骰/结果`）。落地：`server/rp/dice-store.ts` + 路由 + `AgentChatSurface.sendUserMessage` 暴露 + 按钮 UI + adjudication/world-contract/rp.leader/screenwriter 提示词同步，dice-store 4 项单测 + API E2E 冒烟通过。

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

## 六.5、模式完全分离（2026-07-26 用户拍板追加）

RP 与写作模式在项目内**零共享**，防止互相干扰：

```
{项目}/
├── lorebook/ manual/ world-engine/ manuscript/   ← 写作模式专属（RP agent 禁区）
└── rp/                                            ← RP 模式专属（写作 agent 不进入）
    ├── world-engine/   RP 专属 schema/index.ts + calendar.ts（facade 按 worldKey 分根加载）
    ├── lorebook/       RP 世界观 canon
    ├── manual/         玩家手册/GM 手册（README/world-guide/rules-guide/gm-guide/player-guide）
    ├── characters/     角色主观认知层
    └── ticks/          终裁报告 + prose
```

- 初始化时可在用户授权下从写作素材**一次性拷贝改编**进 `rp/`，此后独立演化，运行时绝不跨读。
- rp 世界线配置缺失 → 明确报错引导初始化（bootstrap skill Step 2 负责建立），不回退主配置。
- 落地面：facade `configRoot(worldKey)` + API 六个 helper 透传 + rp.leader/rp.world/rp.screenwriter 提示词禁区条款 + rp-v2 协议文档目录图 + bootstrap skill + 测试（含「rp 配置缺失不回退」与「main 连配置都不共享」断言）。

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

## 七、首次 LLM 实测复盘与界面补强（2026-07-27）

用户配置模型 API 后完成首次真实跑团（项目 xin-xiao-shuo，19 个 agent 会话）。管线整体跑通（P0→P6 全阶段执行、两个 Tick 正文落盘、文件隔离守住），复盘发现的问题分两批：

### 会话日志暴露的管线问题（待修，按优先级）

1. **角色重复建档（最严重）**：9 个角色目录实际约 5 个角色（brauer/bulaoer、veiluosi/weiluosi、chizhangfashi/staff-mage 各两套）。根因：中文名转目录 id 无统一音译规则，各 agent 各拼各的；screenwriter 猜目录名连吃 ENOENT。修复方向：角色 id 注册表 + `ensure` 前强制 recall + 工具层相似名拒绝。
2. **rp.world 初始化挣扎（33 次工具报错）**：schema 导出格式试错 ×13、沙盒内用 import/require ×4、查询超 10KB 不会选字段 ×4、试图用无权限的 bash 自建文件 ×2。修复方向：bootstrap skill 放可抄的完整 schema 模板 + execute_world 描述补沙盒限制说明。
3. **Tick 编号漂移**：ticks/ 缺 000001，角色记忆 Tick 号互不一致。修复方向：leader 每 Tick 开始宣告权威编号（或工具分配）。
4. **文档串味**：screenwriter 找 legacy 的 `rp/current.md` 和不存在的 `rp/lorebook/`。修复方向：清理 lod-simulation 遗留引用 + bootstrap 建齐目录骨架。
5. **骰子未触发**：本局剧情无判定点，`rp/dice/` 未创建，掷骰暂停流程未经实测。

### 用户体验问题（本轮已修 2 项 + 1 项挂 TODO）

1. **开团无引导**（挂 TODO）：应先问世界观/故事/扮演角色再初始化开团。后续做专门的开团引导 skill。
2. **正文链接打不开** ✅：RP 布局下 IDE 编辑器不可见，leader 给的 prose 链接点了没反应。落地：新增 `GET /api/projects/rp/prose`（`server/rp/prose-store.ts` 聚合 `rp/ticks/*/prose.md` 按 Tick 升序）+ 右侧可收起/可拖宽的正文阅读面板 `RpProsePanel.vue`（小说式连续排版、workspace 同步自动追更滚底、Tick 锚点定位高亮）；`RpModeSurface` 拦截 `rp/ticks/<dir>/prose.md` 引用直接在面板内定位，其余引用照旧透传。
3. **RP 会话混入 Agent 页面 / 切界面丢会话** ✅：根因两个——server `session-repo.isLeaderProfile` 把 rp.leader/simulator.leader 算进 "leader" 分组（Agent 页面列表混入 RP 会话）；两界面共用 `agent:last-session:${workspaceKey}` 存储键互相覆盖。落地：leader 分组收紧为 `leader.*` 前缀（RP 界面本就按 profileKey 精确过滤）；last-session 键带 profileKeyOverride 前缀按界面隔离；RP 左侧新增会话列表（复用 `AgentModeSessionSidebar`，左轨道按钮开关，仅列 rp.leader 会话，支持新建/置顶/改名/归档）。

变更文件：`server/agent/session/session-repo.ts`（+test）、`app/components/novel-ide/agent/AgentChatSurface.vue`、`server/rp/prose-store.ts`（新）、`server/api/projects/rp/prose.get.ts`（新）、`app/components/novel-ide/rp/RpProsePanel.vue`（新）、`app/components/novel-ide/rp/RpModeSurface.vue`。验证：session-repo + rp 测试 37/37 通过；prose-store 对真实项目数据烟囱测试通过。

### 管线问题修复落地（2026-07-27，问题 1-4 + 小问题；骰子实测与引导 skill 待后续）

1. **角色 id 注册表**（问题 1，工具层强约束）：`rp/characters/registry.json` 为 id 唯一权威。`character-store.ts` 新增 `readCharacterRegistry`（文件缺失时从已有目录合成，兼容老项目）/`registerRpCharacter`（同 id 幂等合并别名；显示名/别名撞其他 id 时拒绝并指回已有 id）/`resolveCharacterId`（接受 id/显示名/别名；未登记抛错并列出全部已登记角色）。工具层：`ensure` 新增 name（新角色必填）/aliases 参数；其余所有 op 与 recall 先经 resolve；`rp_memory_commit` 移除静默 auto-ensure（拼错 id 不再悄悄裂档）。契约：leader ensure 必带中文显示名+称呼别名；screenwriter/cast 绝不猜目录名、未登记角色报给 leader 建档。测试：注册表约束用例（重名拒绝/名称解析/未登记报错/幂等合并）。
2. **权威 Tick 计数**（问题 4）：`prose-store.listTicks` 扫描 rp/ticks/ 得 `{ticks[hasProse/hasReport], maxTick, nextTick}`；新工具 `rp_tick_info`（builtin.rp.tickInfo，绑 rp.leader）。契约：leader 进流水线前调用并向每个下游宣告「本 Tick = N」，全管线只用宣告值（prose/report 目录、切片标题、memory commit 的 tick），任何 agent 不得自行推算。
3. **rp.world 初始化防挣扎**（问题 2）：execute_world 工具描述明确「纯 async 代码体，无 import/require/export、无文件系统；大列表在脚本内 map 成短行控制 10KB；配置缺失原样报错不自救不换 worldKey」；rp.world 契约同步补条款（无文件工具、不重试同一失败脚本）；worldKey 参数描述修正为「rp = 独立配置根 rp/world-engine/，无回退」；bootstrap skill Step 2 内嵌**可直接抄改的** schema/index.ts（`export const WorldSchema = {类型: z.object(...)}` 平面对象 + Ref/连接/关系/secret 约定字段）与 calendar.ts 模板。
4. **文档串味清理**（问题 3）：新建 `reference/agent/rp-v2/` 四份 v2 文档——lod-simulation.md（pending → World Engine 未来切片，废除 current.md）、actor-packet.md（screenwriter 组装/cast 分发命名、knowledge 与 K 条目去重）、writer-brief.md 与 rp-writer-interaction.md（`rp/ticks/` 路径 + rp_tick_info 编号纪律，废除 `simulation/runs/`）；rp.screenwriter/rp.cast/rp.actor/rp.leader/rp.writer 五个 profile 的 import 全部从 `rp-tick/` legacy 切到 `rp-v2/`（legacy 文档保留给 simulator.* 用）；screenwriter 契约明确「v2 没有 rp/current.md」；bootstrap Step 1 建齐 rp/manual、rp/lorebook、rp/characters、rp/ticks 骨架。
5. **小问题**：rp.leader 契约加「文件工具一律 Project-relative 路径，绝对路径会被拒绝」；`/api/workspace-files/read` 的 ENOENT 由 unhandled 500 改为 404（消除 state-view.json 探测日志噪声）。

验证：rp 全套 + tools + rp-profiles + read 端点测试 29 项全绿；真实项目烟囱测试（nextTick=3 正确、注册表从 9 个旧目录合成、未登记名报错带全量对照表）。遗留：⑤ 掷骰流程实测、开团引导 skill（用户拍板后续做）、xin-xiao-shuo 历史重复档案未合并。

## 八、开团引导（2026-07-27 用户需求追加）

**问题**：实测中用户说「开始跑团」后 AI 直接自编一套剧本开跑，没有让用户选择已有剧本或引导新建。

**落地**：

1. **协议文档** `reference/agent/rp-v2/adventure-intake.md`（注入 rp.leader 上下文）：
   - 铁律：开团是用户的创作决策，AI 只提案不代决；每轮最多 1-2 问带选项；「随便/你来定」= 给一个具体提案请确认；企划书未经用户确认不落盘不开场。
   - 第 0 步分流：rp/ 有进行中冒险 → 介绍进度问「继续/新开/调整」；无材料 → 问走哪条路。
   - 路线 A（改编写作设定）：用户选 A 即授权读根 lorebook/（模式分离唯一例外，一次性拷贝改编）→ 一页纸摘要 → 逐项补 RP 缺口（化身原创还是原作角色/时间线/危险度/禁区）→ 改编落盘 rp/lorebook/ + rp/manual/。
   - 路线 B（从零共创）：问答式六话题——类型基调 → 世界核心规则 → 化身 → 其他角色期望 → 规则与危险度 → 开局方式（指定/AI 出 2-3 候选/随机盲开）。
   - 收束：冒险企划书确认 → 落盘 rp/manual/ 三件套 + rp/lorebook/ 核心条目 → 交 rp-v2-bootstrap Step 2 起做技术初始化。
2. **skill 入口** `rp-v2-adventure-intake`（用户可调用的摘要版，指向已注入协议）。
3. **rp.leader 契约**：小屋新增「开局分流」硬规则（收到开团意图先 read rp/manual + rp_tick_info 探明现状，绝不自编剧本直接开跑）+ HistorySet 注入 adventure-intake.md；「拷贝改编」措辞收紧为仅路线 A 授权例外。
4. **配套清理**：rp-v2-bootstrap Step 1 改为「材料缺失交给 intake，本 skill 不聊设定」；legacy `RP模式` skill 整体重写为 v2 入口（原 v1 内容全是 simulator.leader/simulation/ 体系，是潜在串味源）；rp-v2/README.md 补「开团顺序」一节并把 writer/packet 文档链接从 rp-tick 换到 rp-v2 版。

验证：rp-profiles 编译测试 10/10 通过；dev server 重启后 user-assets sync 生效，skill catalog API 列出 rp-v2-adventure-intake / 更新后的 rp-v2-bootstrap 与 RP模式。待用户实测：新项目说「开始跑团」应看到两条路的选择而不是直接开跑。
