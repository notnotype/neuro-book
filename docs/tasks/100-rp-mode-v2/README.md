# RP 模式 v2 重构设计

> 状态：Optimization In Progress（2026-07-28 开始运行逻辑系统性重构）。旧版 v2 已完成基础接入，本轮按新合同继续优化。

> 2026-07-28 新增的 18 组确认结论、依赖顺序与 P1-P9 实施计划见 [RP 模式运行逻辑优化计划](optimization-plan.md)。该文档优先于本文早期“已完成”描述；早期描述保留用于追溯既有实现。

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

## 九、数据面回归测试（2026-07-27，用户拍板「AI 代演」方案第一层）

用户提出用 AI 代替模型 API 做各模块测试；拍板两层方案：日常回归用「数据面仿真」（AI 代演 agent 输出、走真实工具/存储层），深度验收后续再做「桥接式真端到端」。第一层已落地，剧本统一用内置奇幻故事「勇者召唤」：

1. **`server/rp/rp-multi-tick-scenario.test.ts`**（RP 多 Tick 剧本回归）：bootstrap → Tick1 轻量通道 → Tick2 掷骰+pending → Tick3 兑现+揭示+滚动。在 rp-tick-flow 单 Tick 闭环之上覆盖实测复盘修复的全部机制：注册表（显示名/别名解析、重名建档拒绝 `bulaoer→id=brauer`、未登记报错）、`listTicks` 权威编号推进与 prose/report 缺失可见、真实 crypto 掷骰 + rolls.jsonl seq 校验、pending 到期兑现（删占位+落实主切片）、三级摘要滚动（近期→中期→远期）、轻量通道不写世界切片、main 世界线零回退、actor/god 视图隔离。
2. **`server/plot/writing-main-chain.test.ts`**（写作模式主链回归）：lorebook 内容节点 → World Engine main 初始化 → Plot 因果树（Phase/Thread/Scene + World Anchor + lorebook refs）→ 承载树（Act/Chapter + ChapterBrief 信息控制）→ Scene 挂章 → autonomous Writer Brief 编译（status=ready、含场景/信息控制/建议读取）→ manuscript frontmatter `chapter:` 反指可查（findProseForChapter）→ 状态推进切片 → rp 世界线拒绝（分离的写作侧视角）。

**测试立刻抓到的真 bug**：bootstrap skill 的 schema 模板用了 `z.object({}).passthrough()` 表示开放 secret——World Engine 校验器不支持 passthrough（未声明字段直接 400），真实开团会在初始化时反复失败。已改为 `z.record(z.string(), z.string())` 并在模板注释中说明。

**API 形状备忘（写测试时踩过）**：create 系列返回 detail 本体（含 diagnostics 扩展），无 `.thread`/`.scene` 包裹；Scene worldAnchor 输入只认日历字符串（startInstant/endInstant 输入被忽略，由 parseTime 派生），simple 日历 day 为 1-based；Writer Brief `ready` 需要 每场景锚点起止齐全 + world context 可解析 + 信息控制非空。

第二层（桥接式「AI 当模型」真端到端）待用户需要时搭建：本地 OpenAI 兼容 mock 服务落盘请求/等待 AI 写回应，验收完整 harness 编排。

## 十、运行逻辑优化 P1：持久开团状态与技术门禁（2026-07-28）

### 用户需求与设计整理

用户要求先整理讨论确认的 18 组议题，再按优化依赖顺序开始重构。完整产品合同与 P0-P9 顺序见 [RP 模式运行逻辑优化计划](optimization-plan.md)，覆盖主动事件、时间与惰性模拟、事件生命周期、地图生长、NPC 擢升、资源周期、关系认知、判定、开团状态机、世界切片树、RP UI、Agent 管线、关注度、异常恢复和 100 Tick 验收。

### 根因复核

旧 `adventure-intake.md`、`rp-v2-adventure-intake` 与 `rp-v2-bootstrap` 只用自然语言要求“企划确认前不落盘”。`rp.leader` 仍持有通用 write/edit/apply_patch/bash，并能创建 RP 子 Agent；系统没有持久草案、企划版本、真实用户审批或 Bootstrap 服务端门禁。因此 Prompt 违规会直接变成正式写入，测试也只断言 Prompt 包含文案，不能证明行为受限。

### 本阶段实现

1. 新增 `server/rp/intake-store.ts`：
   - 草案保存到 Project Workspace `.nbook/rp/intake/state.json`，内容版本快照保存到 `versions/`。
   - 八个必填字段：source、premise、avatar、playStyle、systems、boundaries、initialMap、opening。
   - 字段状态：missing、provisional、confirmed、conflict、disabled。
   - 实现 review、confirm、begin bootstrap、fail bootstrap、activate 和正式运行写入断言。
   - 字段内容变化递增版本并清空旧确认；Bootstrap 只接受 `confirmedVersion === version`。
2. 新增 `rp_intake` Agent 工具：
   - get/update_field/review/confirm/begin_bootstrap/fail_bootstrap/activate 七类操作。
   - confirm 通过 `userInputRequest` 强制暂停并展示“确认并开团”审批；没有真实 user resolution 时不能记录确认。
3. 新增 `intake-guard.ts` 并接入写面：
   - rp.* profile 在 bootstrapping/active 前不能用 write/edit/apply_patch 写正式 `rp/`。
   - `.nbook/rp/intake/` 永远禁止通用文件工具写入，只能走 `rp_intake`。
   - RP World Engine、角色写工具、RP 子 Agent create/invoke 使用同一运行门禁。
   - 从 rp.leader 移除 bash，消除绕过文件守卫的直接进程写入通道。
4. 重写开团稳定协议与三个 runtime 入口：
   - `reference/agent/rp-v2/adventure-intake.md` 改为持久状态源、三入口、八字段、最终审阅和技术门禁合同。
   - rp.leader profile、`rp-v2-adventure-intake`、`rp-v2-bootstrap`、`RP模式` 全部改用 `rp_intake`，不再以目录存在性猜测状态。

### 验证结果

- `intake-store.test.ts`、`rp-intake-tools.test.ts`：7/7 通过。
- 既有 RP Profile、角色工具、World Engine、文件工具回归：70/70 通过。
- `intake-guard.test.ts`：2/2 通过，直接覆盖“未确认正式写入被拒”“直接伪造状态被拒”“同版本确认后开放写入”。
- 一次合并回归除测试夹具最初未建立正确 File Scope 外，其余 31 项均通过；修正夹具后门禁测试全绿，业务代码无需为此调整。
- `bun run typecheck` 未通过，但报错均属于当前仓库既有基线：World Engine 状态概览深层类型实例化、旧 Profile 测试缺少 persona/customBottom 设置、World Engine facade AbsoluteFsPath 类型。新加入文件未出现在错误列表中。

### 与计划的出入

- 原计划只写“Bootstrap 和正式 RP 写入门禁”；实际检查发现通用文件工具还能直接覆盖 `.nbook/rp/intake/state.json`，因此额外增加 intake 状态文件防伪守卫。
- 为使文件守卫不可被进程命令绕过，额外从 rp.leader 移除 bash。现有 Bootstrap 只需要专用文件工具与 RP 工具，不依赖 bash。
- P2 及后续事件、资源、地图、切片树和 UI 尚未在本阶段实现，继续按 optimization-plan 顺序推进。

## 十一、运行逻辑优化 P2：回合事务与文件化更新（2026-07-28）

### 事务边界调研

- Agent Harness 已有单次模型 turn 的消息事务，但它只保证 session truth 写入顺序，不能替代 RP 世界结算事务。
- World Engine `executeCodeActWorld` 已在单次 CodeAct 脚本外包 SQLite transaction，脚本异常和超时会回滚；缺失的是“响应丢失后重试不重复执行”的幂等键。
- 旧 RP P5 让 world 写回与 writer 渲染并行，且正文面板按目录直接读取，可能展示尚未形成正式回合的 prose。

### 本阶段实现

1. 新增 `server/rp/turn-store.ts` 与 `rp_turn` 工具：
   - canonical 状态：draft、running、awaiting_player、committing、committed、failed、cancelled。
   - start 使用 Agent invocation requestKey 幂等复用，生成 `turn-{sequence}-{uuid}` 和确定性 `worldOperationId`。
   - 支持等待玩家、恢复、开始提交、提交、失败、取消和未完成扫描。
   - committing 阶段错误保持 committing，因为此时可能是“数据库已提交但响应丢失”；禁止直接取消，必须复用 operationId 恢复。
2. 文件化账本位于 Project Workspace `.nbook/rp/runtime/`：
   - `turns/{id}.json`：每回合 canonical 状态。
   - `turn-ledger.jsonl`：阶段变化。
   - `updates.jsonl`：committed 结算，按 turnId 去重。
   - `errors.jsonl`：失败阶段、Agent 和真实原因。
   - 工具只返回紧凑元数据，完整 settlement 不注入聊天上下文。
3. World Engine 幂等事务：
   - `executeCodeActWorld` 新增 `operationId`；`WorldOperation` 结果记录与世界切片写入在同一 SQLite 事务提交。
   - 同 operationId 重试直接返回首次 SuperJSON 结果，不再次执行脚本。
   - 失败/回滚事务不占用 operationId，修正后可复用同 id 重试。
   - `execute_world` 增加 RP 操作声明：state_read、turn_commit、bootstrap；rp.world 的 turn_commit 缺 operationId 会被工具层拒绝。
4. 子 Agent 与正文可见性门禁：
   - Bootstrap 允许初始化子 Agent；active 后，RP 子 Agent 必须绑定当前 invocation 的 running turn。
   - awaiting_player 阶段禁止子 Agent；committing 阶段只允许 rp.world。
   - 常规 Tick prose 只有在 turn committed 且登记 prosePath 后才进入 `listTickProse`；Tick 000000 开场仍由 Bootstrap 展示。
5. rp.leader 管线更新：
   - IC 开始先 start/resume；骰子或确认前 await_player。
   - writer 成功后 begin_commit；rp.world 使用 worldOperationId 写回；最后 commit 完整 settlement。
   - 任一失败记录 stage/agent/message，不展示未 committed 结果。

### 验证结果

- P2 核心专项：`turn-store.test.ts` 5/5 通过，覆盖 requestKey 复用、暂停恢复、文件账本、重复提交去重、失败记录、committing 响应中断恢复和正文可见性。
- World Engine CodeAct 新增 2 项幂等测试：重复 operationId 不重复写切片；失败事务不占用 id，修正后重试成功。
- P2 合并回归：7 个测试文件 67/67 通过；随后 Profile/工具/幂等专项 5 个文件 51/51 通过。

### 与计划的出入

- 原计划仅要求 turn ID 和幂等提交。调研发现“World 已提交但响应丢失”是最危险窗口，因此把 operationId 记录下沉到 World Engine SQLite 事务，而不是只在 JSONL 里做表面去重。
- 为避免半成品 prose 泄露，额外让正文面板按 committed prosePath 过滤。
- P7 的“世界状态更新窗口 UI”尚未实现；P2 已准备好按需读取的数据文件，UI 后续只做投影，不再请求 Agent 复述结算。

## 十二、运行逻辑优化 P3：正式事件与主动主持（2026-07-28）

### 本阶段目标

把“主持主动安排事件”从 Prompt 建议升级为服务端能力：四张候选必须完整、随机由服务端执行、地点失效和保留可追踪、active 名额与硬性事件例外可校验、连续五个平淡回合可靠触发，并在工具层约束 screenwriter / leader / world 的职责。

### 本阶段实现

1. 新增 `server/rp/event-store.ts`：
   - canonical 状态保存到 Project Workspace `.nbook/rp/runtime/events/state.json`，审计写入 `events-ledger.jsonl`。
   - 四卡必须恰好覆盖 calm、exciting、dangerous、unusual；同批共享 batchId，旧普通候选不删除而标记不可用。
   - 候选支持 save、discard、select、1-4 张范围服务端 random select；选择只确定入口，不预设结局。
   - 离开地点后普通候选 unavailable；saved 候选保留为 needs_revalidation，world 必须给出重新校验结果和具体原因。
   - 正式生命周期为 available/saved/selected/active/suspended 与六类终态；内部阶段只能从 entry 向 aftermath 前进。
   - 普通 active 最多三个；硬性日程、天气、约定和计划可临时成为第四焦点；玩家不参与时可 continued_without_player。
2. 新增 `rp_event` Agent 工具并实施硬权限：
   - screenwriter 只能 get/validate_candidates；
   - leader 只能 get 与玩家明确触发的 save/discard/select/random_select；
   - world 独占登记、失效、重新校验、激活、推进、暂停和结束。
   - 玩家视图不返回 hiddenSetup、compatibilityKey 或内部阶段。
3. 平淡回合触发器下沉到 `rp_turn commit`：
   - commit 新增 meaningfulEvent；只有 committed 回合进入计数，failed/cancelled/awaiting_player 不计。
   - 同 turnId 重试幂等；连续五次 false 后 candidateGenerationDue=true；以 calm_streak 登记新四卡后归零。
   - 该接线避免 world 在回合正式提交前提前计数。
4. Profile 与稳定契约更新：
   - leader 主动在新地点、新活动、计划到期、玩家请求或五次平淡后请求四卡，并按玩家指令操作。
   - screenwriter 只提交和校验入口提案；world 将事件账本与 World Engine 客观状态/pending 时间触发器对齐。
   - 新增 `reference/agent/rp-v2/event-lifecycle.md`，明确正式事件账本与 World Engine pending slice 不能互相替代。

### 验证结果

- `event-store.test.ts`：7/7 通过，覆盖四卡、批次替换、保留与地点失效、重新校验、服务端随机、互斥冲突、active 名额、硬性第四焦点、暂停/离场终态、五次平淡触发与 Bootstrap 开场事件。
- P3 联合回归：事件状态机、回合提交、事件工具权限与三个 Profile 契约共 4 个测试文件、26/26 通过。
- P1/P2 收尾合并回归：11 个测试文件、125/125 通过；user-assets 同步成功。
- P1-P3 最终合并回归：13 个测试文件、136/136 通过；覆盖开团、回合、事件、角色、World Engine 幂等、文件门禁、多 Tick 数据面和正文插图链路。
- `bun run typecheck` 仍被仓库既有基线阻断：World Engine 状态概览深层类型、旧 Profile 测试缺 persona/customBottom 设置、World Engine facade AbsoluteFsPath。P3 新增生产文件未产生新诊断；新增 Profile 测试只增加了同一既有 settings 夹具诊断。

### 与计划的出入

- 原计划让 world 维护平淡 Tick 计数。实现接线时发现 world 写回发生在 turn commit 之前，失败窗口会误计数，因此改由 `rp_turn commit` 在正式提交后更新，这是更严格的事务边界。
- 本阶段只完成事件数据面与 Agent 权限；左侧事件分页、四卡按钮和文件化更新窗口仍按计划留在 P7，避免在时间/地图/NPC 数据结构尚未稳定前重复返工 UI。
- 下一阶段进入 P4：时间、长跳与周期资源先行，再实现八维有向关系和三层认知。

## 十三、运行逻辑优化 P4：时间、资源、关系与认知（2026-07-28）

### 本阶段目标

把时间推进、长跳审批、周期资源、关系变化和角色认知从 Agent 自由描述收口为服务端可校验、可审计、可幂等重试的规则层，并统一接入 `rp_turn commit.rules`，避免 World、screenwriter 或 leader 在回合提交前写出互相矛盾的半套状态。

### 本阶段实现

1. 时间与长跳：
   - RP World Engine 最新 Instant 继续作为唯一当前时间源；IC 回合只记录 `startTime` / `endTime`，OOC 不推进时间。
   - 长时间跨度按一次批量变化推演与一次结算处理，不逐日伪造 Tick。
   - active / suspended 事件及区间内到期的硬性事件会阻断长跳；`approveRpLongJump` 产生绑定 turnId、起止 Instant 和全部阻断事件的真实玩家审批凭证。
2. 资源与周期：
   - 新增 `server/rp/mechanics-store.ts`，支持 ledger、time_derived、dynamic 三类资源，精确值统一使用整数最小单位。
   - 精确账户只允许玩家、常驻 NPC 和主要角色；资源支持上下界、状态词分段、周期规则、派生速率和声明式自定义增减逻辑。
   - 周期模块使用锚点、周期长度与连续阶段窗口；生育及自定义风险由服务端按 ppm 概率抽取，并以 operationId 保证重试幂等。
3. 关系模型：
   - 新增 `server/rp/relation-store.ts`，维护熟悉、信任、情感、吸引、尊重、依赖、恐惧、敌意八维有向关系，A→B 与 B→A 完全独立。
   - 标签不由数值阈值自动生成；每次变化记录 turnId、Tick、依据与原因。
   - 骰子不能直接改写关系；系统不能替玩家化身改变信任、情感与吸引，只有明确的玩家声明可写入。
4. 三层认知：
   - 新增 `server/rp/cognition-store.ts`，分离世界事实、角色 belief 与玩家 OOC knowledge。
   - important / secret 条目默认隐藏；`user_revealed` 只改变玩家 OOC 可见性，不自动创建化身认知。
   - 传闻按 rumor / uncertain 保存并要求相关性原因；解除隐藏与恢复隐藏必须来自真实用户审批。
5. 回合事务与 Agent 工具：
   - `rp_turn commit` 新增必需的 time、resources、relations、cognition 四组规则，先做跨领域完整预检，再按 turnId 幂等写入，全部成功后才标记 committed。
   - 中断时回合保持 committing，可修正后重试；非法关系变化等错误不会留下已经推进时间或扣除资源的半套状态。
   - 新增 `rp_mechanics`、`rp_relation`、`rp_cognition` 工具并按职责分配给 leader、screenwriter、world；正式关系与角色认知变化只允许经回合提交写入。
6. Profile 与稳定契约：
   - 更新 rp.leader、rp.screenwriter、rp.world 的 P4 流程与权限边界。
   - 新增 `reference/agent/rp-v2/mechanics-relations-cognition.md`，并同步 rp-v2 README、world-contract、RP 模式 Skill 与优化计划。

### 验证结果

- P4 三领域专项：3 个测试文件、11/11 通过。
- P4 联合回归：6 个测试文件、32/32 通过；其中跨领域预检用例证明非法 dice 关系变化会让回合保持 committing，且不会先写入时间或资源。
- user-assets 同步成功：344 项检查中 1 项资产更新，其余已一致。
- P1-P4 最终合并回归：17 个测试文件、78/78 通过；覆盖开团状态与审批、正式写入门禁、回合幂等、事件生命周期、角色认知与记忆、骰子、正文写入、多 Tick 数据面，以及 P4 四领域统一提交。
- `bun run typecheck` 仍被仓库既有基线阻断：`WorldEngineStateOverview.vue` 深层类型实例化、旧 Profile 测试缺 `personaPreset` / `customBottomSystemPrompt`、`world-engine.facade.ts` 的 `AbsoluteFsPath` 品牌类型。P4 新增生产文件没有新诊断。

### 与计划的出入

- 原计划可将时间、资源、关系和认知分别提交。实现时发现这会制造跨领域半提交，因此增加 `turn-rules-store.ts` 做统一预检，并把四组规则设为每个 IC commit 的必需输入；这是比原计划更严格的系统性约束。
- 长跳确认没有采用普通布尔字段，而是使用绑定具体 turn、时间区间与阻断事件集合的审批凭证，避免世界状态变化后复用旧确认。
- P4 只完成服务端规则层、工具和 Profile 契约。状态页的资源/周期/关系可见性与更新窗口继续留在 P7，避免先于 P5 地图/NPC 数据模型稳定而返工。
- 下一阶段进入 P5：层级地图、地点状态与秘密路线，以及 NPC 从群演到主要角色的生命周期和擢升门禁。

## 十四、运行逻辑优化 P5：层级地图与 NPC 生命周期（2026-07-28）

### 本阶段目标

让地图随玩家行动持续生长，同时保留传闻和秘密路线的未知感；让群演、具名 NPC、常驻 NPC、主要角色和长期离场角色拥有可审计的生命周期，并把地点冲突、小说地点删减和角色擢升从 Prompt 建议升级为真实玩家审批门禁。

### 本阶段实现

1. 新增 `server/rp/map-store.ts`：
   - 固定 world、region、town、district、building、sub_location 六级层级；父节点必须严格高于子节点。
   - 地点状态支持 rumored、discovered、familiar、unavailable、destroyed；首次抵达自动固化并至少变为 discovered。
   - 只有能持续承载世界结构、事件、NPC、资源或特殊连接的空间可以建节点；一次性背景空间由服务端拒绝。
   - 玩家投影会降级 rumored 节点，只显示模糊名称与大致方向；秘密路线在 discover 前完全消失。
   - 关闭、毁坏的地点和路线保留索引；destroyed 不能通过普通运行操作恢复。
   - 地图节点 id 与 RP World Engine location subject id 强制采用同一稳定标识；地图只保存层级、可见性与路线，不复制完整世界状态。
2. 地点提案、冲突和小说导入：
   - screenwriter / 玩家先提出地点，world 独占核对 canon、确认 World Engine subject 和正式 materialize。
   - 冲突必须记录具体原因；leader 的 `approve_conflict` 会触发真实玩家审批，批准后 world 仍需再次校验。
   - 小说地点用 `stage_import` 登记盘点来源和 complete/partial/vague 完整度；`confirm_import` 必须一次覆盖全部待确认候选，禁止主持静默漏删。
   - 提案、导入、materialize 和路线登记增加响应丢失重试幂等，避免重复节点或重复路线。
3. 新增 `server/rp/npc-store.ts`：
   - 生命周期为未具名群演（不落 roster）→ named → resident → major → major_inactive。
   - 群演说出姓名后建立最低 named 记录；同名/别名冲突会拒绝重复档案。
   - screenwriter 只能给出非阻塞擢升建议；named 升 resident、named/resident 升 major 必须经过玩家审批。
   - 敌人、宿敌和竞争者与盟友拥有相同擢升资格；主要角色总数无硬上限，活跃软上限默认 8，超过只提示整理 inactive。
   - major 长期离场转 major_inactive，回归时恢复，角色档案不删除；actor session 保持惰性创建。
   - 升 major 会确保 `rp/characters/{id}/` 档案存在，并可从历史 Tick、事件和互动摘要按 sourceRef 幂等补建角色视角记忆。
   - resident/major 擢升后 resourceStatus=pending，world 通过 rp_mechanics 建立合理精确账户后显式标记 ready；普通 named 只保存 household。
4. 工具与权限：
   - 新增 `rp_map`：leader 负责玩家地点原案、导入确认和冲突审批；screenwriter 只提案；world 负责校验、抵达、状态和路线。
   - 新增 `rp_npc`：leader 负责玩家创建、擢升审批和拒绝建议；screenwriter 只建议；world 负责具名登记、出场状态和资源完成标记。
   - `confirm_import`、`approve_conflict`、`promote` 都使用 `userInputRequest`，Agent 不能伪造玩家同意。
5. Profile 与稳定契约：
   - rp.leader、rp.screenwriter、rp.world 已接入两个新工具和 P5 职责边界。
   - 新增 `reference/agent/rp-v2/map-npc-lifecycle.md`，并同步 rp-v2 README、world-contract、RP 模式 Skill 和优化计划。

### 验证结果

- P5 存储与工具专项：3 个测试文件、15/15 通过；覆盖层级校验、持久节点门槛、传闻降级、秘密路线、首次抵达、毁坏保留、冲突审批、整批导入确认、具名防重、敌对角色擢升、历史记忆补建、长期离场、精确资源待办、九名活跃主要角色软上限和重试幂等。
- P5 联合回归：4 个测试文件、26/26 通过；覆盖 map/npc 工具注册、权限矩阵、三个真实玩家审批入口和三个 RP Profile 契约。
- user-assets 同步成功：344 项检查中 1 项资产更新，其余已一致。
- P1-P5 最终合并回归：20 个测试文件、93/93 通过。
- `bun run typecheck` 仍被仓库既有基线阻断：World Engine 状态概览深层类型、旧 Profile 测试缺 persona/customBottom 设置、World Engine facade 的 AbsoluteFsPath 品牌类型。修正联合返回类型后，P5 新增生产文件没有新诊断。

### 与计划的出入

- 为避免建立第二套世界真相源，地图没有保存完整地点 attrs，而是保存 World Engine 同 id 的稳定目录、可见性和路线。这比原计划的笼统“地图状态”边界更严格。
- 小说地点来源形态跨 Lorebook、Plot、World Engine 和正文，存储层不直接解析四套格式；获得改编授权后的 leader 通过既有只读入口完成全量盘点，再把统一候选送入 `stage_import`。本阶段把“不漏项、逐项确认、冲突不静默选边”做成了服务端门禁。
- 地图目录与 World Engine 仍是两个持久介质，world 按“先确认 subject、后 materialize 目录”的顺序维护；跨介质统一事务留到 P6 回合编排收口，不在 P5 用文件补偿 hack 绕过。
- P7 才实现地图树、NPC 分组和擢升建议侧栏；P5 已提供稳定 player/GM 投影，UI 后续直接消费，不需要 Agent 复述。
- 下一阶段进入 P6：代码可见的回合编排、actor 同快照并行、失败恢复、四级关注度与三档运行强度。

## 十五、运行逻辑优化 P6：回合编排与关注度（2026-07-28）

### 本阶段目标

把旧 P0-P6 Prompt 流程升级为服务端可见、可恢复的阶段状态机，让多 actor 真正基于同一回合开始状态提案，并在 world 统一解决冲突后再终裁；同时建立四级关注度、三档运行强度和长跳惰性推演，使远端世界丰富度可控，但当前场景与确定性规则不被性能档位削弱。

### 本阶段实现

1. 新增 `server/rp/pipeline-store.ts`：
   - 每个 `rp_turn start` 自动建立 action_understanding → world_snapshot → condition_check → screenwriter_plan → actor_proposals → conflict_resolution → adjudication → narrative → world_commit → ui_update 十阶段状态。
   - 阶段只能相邻推进；screenwriter plan、cast、extras、world resolution 与 adjudication 必须绑定 world 捕获的同一 snapshotId。
   - snapshot 同时保存 World Instant、SHA-256 stateHash、公开摘要与 JSON 状态，响应丢失重试返回首次快照。
   - plan 声明的 expectedActorIds 缺一不可；主要 actor 失败始终阻塞且不能手工代演，只有同 actor 成功提交提案才能解除。extras 可重建，但仍必须真实提交。
   - world 逐项解决冲突；character_intent 存在 actor 来源时拒绝 screenwriter 覆盖。终裁必须晚于 world resolution；正文未登记、阻塞失败未恢复或未到 world_commit 时，`beginRpTurnCommit` 会拒绝。
   - commit 成功后自动进入 ui_update。公开 stageHistory 不保存思维过程或隐藏剧情。
2. 保留一个回合真相源：
   - `rp_turn` 仍是唯一回合状态与 committed 历史；pipeline 是 turn 下属阶段，不另建第二套事务。
   - World Engine operationId 保证客观世界写幂等；P4 rules 按 turnId 完整预检与幂等结算；pipeline 负责提交前产物门禁。
   - 这形成可恢复的统一逻辑事务，没有用 JSON 补偿伪装跨 SQLite/文件物理原子性。
3. 新增 `server/rp/focus-store.ts`：
   - 关注级别为 current、active_background、low_frequency、dormant；玩家 pinned 项必须真实审批且不被 world 自动平衡覆盖。
   - major / major_inactive 至少 low_frequency。当前与直接互动 NPC 永远独立处理；普通 named NPC 可批量交 extras。
   - light / standard / deep 的远端场景预算为 0 / 2 / 6，额外后台独立 NPC 上限为 0 / 3 / 8。
   - 三档都固定保留时间、资源、周期、硬事件、候选失效和显式概率等确定性模块。
   - 长跳保存单个 `.nbook/rp/runtime/long-jumps/{turnId}.json` 摘要，同 turnId 幂等，不逐日造 Tick。
4. 新增 `rp_pipeline` / `rp_focus` Agent 工具与硬权限：
   - leader 只推进阶段、登记叙事、管理强度/玩家固定关注度和协调恢复；不能代 screenwriter/world/cast/extras 产出。
   - world 捕获快照、解决冲突、平衡关注度、生成运行计划和记录长跳摘要。
   - screenwriter 提交 plan/adjudication；cast 提交主要 actor 汇总；extras 提交普通 NPC 汇总。
   - `set_focus` 使用 `userInputRequest` 取得真实玩家审批。
5. 回合与 Profile 接线：
   - `startRpTurn` 初始化 pipeline；`beginRpTurnCommit` 执行硬门禁；`commitRpTurn` 自动完成 ui_update。
   - rp.leader、rp.world、rp.screenwriter、rp.cast、rp.extras 已绑定各自工具并改用同 snapshotId 协作；任一失败必须报告阶段、真实原因、提交状态和恢复选项。
   - 每轮读取持久强度。轻量回合可以没有 actor/extras，但不能跳过空冲突收口、终裁、叙事和提交阶段。
6. 稳定契约：
   - 新增 `reference/agent/rp-v2/pipeline-focus-runtime.md`。
   - 同步 rp-v2 README、world-contract、RP 模式 Skill 与 Profile 契约。

### 验证结果

- P6 核心 store / 工具权限专项：3 个测试文件、11/11 通过，覆盖阶段顺序、快照幂等、主要 actor 阻塞、extras 重建、actor 优先冲突、叙事提交门禁、关注度固定、主要角色最低关注、三档预算、确定性模块和长跳单文件幂等。
- P6 回合与 Profile 联合：6 个测试文件、33/33 通过，覆盖旧 turn/intake 用例接入新硬门禁、工具注册、五个 Profile 的职责分离与同快照协议。
- P1-P6 最终合并回归：23 个测试文件、105/105 通过。
- `bun run typecheck` 仍被仓库既有基线阻断：World Engine 状态概览深层类型实例化、旧 Profile 测试缺 persona/customBottom 设置、World Engine facade 的 AbsoluteFsPath 品牌类型。P6 初次检查发现并修正工具 nullable 返回类型后，新增生产文件没有剩余诊断。
- user-assets 同步成功；未执行浏览器验证，按约定留给 P7 UI 完成后由用户决定是否验收。

### 与计划的出入

- 原计划“统一事务”若理解为跨 World Engine SQLite 与多个 JSON store 的物理原子事务，会需要补偿日志或分布式事务式复杂度。现有 operationId、turnId 幂等与 pipeline 门禁已经形成可恢复的逻辑原子边界，因此没有引入补偿 hack；这是性能、复杂度和可维护性更平衡的实现。
- 旧测试过去可直接 `begin_commit`，P6 后全部必须建立完整 pipeline。为非编排专项增加了最小合法测试 fixture，而不是在生产代码保留绕过入口，从设计上约束后续 Agent/测试不能重犯跳阶段问题。
- P6 只实现服务端状态、工具、Profile 和文件投影。运行进度、强度切换、待选事件操作与更新详情窗口按原计划进入 P7；浏览器验收也留到 UI 接线后统一执行。
- 下一阶段进入 P7：重构 RP 侧边栏四分页，接入运行进度、运行概况、待选事件操作、强度切换和文件化世界更新窗口。

## 十六、运行逻辑优化 P7：RP 侧边栏与世界更新窗口（2026-07-28）

### 目标

让玩家无需要求 Agent 复述即可查看当前运行状态、选择主持人准备的事件、浏览持续扩展的地图与角色名册，并按需查阅文件化世界结算；所有玩家视图必须剥离幕后事件安排、NPC 私密人设和 actor 内心提案。

### 实施结果

1. 玩家安全运行聚合：
   - 新增 `shared/dto/rp-runtime.dto.ts` 与 `server/rp/runtime-view-store.ts`，统一投影 intake、三档强度、四级关注对象、当前 turn、公开 pipeline 阶段/失败、事件、地图、NPC 名册、资源账户和回合统计。
   - `event-store` 提供单一 `readRpPlayerEvents` 投影，工具与 HTTP API 共用，明确过滤 `hiddenSetup`、兼容键、幕后阶段与内部时间字段；overview 不返回 NPC persona、actor proposals 或角色内心。
   - `turn-store` 新增全量倒序读取；更新摘要列表不携带 settlement，单回合详情只允许读取 committed turn。
2. HTTP 操作面：
   - 新增 overview、updates、update、intensity、events 五个 RP API，并用 `withRpApiProject` 统一 Project Workspace open gate 与路径解析。
   - 强度切换直接持久化 `light / standard / deep`；事件操作直接支持保留、放弃、选择入口与玩家指定 1–4 张随机范围，不消耗一次 Agent 调用。
3. 四分页侧栏：
   - `RpSidebar.vue` 收敛为数据宿主和分页外壳，新增独立的状态、事件、地图、角色组件，单文件均低于 200 行。
   - 状态页展示世界时间、引导阶段、十阶段运行进度、公开摘要、失败原因与恢复选项、强度、回合统计、关注度、资源和 World Engine 摘要。
   - 事件页展示平淡 Tick 计数、候选生成提示、候选四种基调、可用性原因、保留/放弃/选择及 1–4 张随机；进行中和终态事件独立分组。
   - 地图页使用稳定层级目录展示传闻/发现/熟悉/不可用/毁坏节点，保留 World Engine 客观关系图；角色页展示 named/resident/major/major_inactive 名册、公开状态、关系图和擢升建议。
4. 文件化更新窗口：
   - 新增非模态 `RpUpdateWindow.vue`，打开时分页读取更新摘要，点击某一 Tick 才加载时间、资源、关系、长跳、公开阶段历史和完整 settlement。
   - 更新窗口再次打开会刷新摘要；Project Workspace 切换时清空旧详情，防止跨项目残留。

### 验证结果

- P7 聚合专项：3 个测试文件、12/12 通过；覆盖玩家投影不泄密、更新摘要分页、settlement 按需读取以及未提交回合拒绝作为正式更新。
- P1-P7 合并回归：24 个测试文件、108/108 通过。
- `bun run typecheck` 未报告 P7 新文件诊断；命令仍被仓库既有基线阻断：World Engine 状态概览深层类型实例化、旧 Profile 测试缺 persona/customBottom 设置、World Engine facade 的 AbsoluteFsPath 品牌类型。检查时 Profile 设置基线已影响更多既有测试文件，但与 P7 无关。
- 新增组件主题类审计通过，没有 Tailwind 调色板类或 `dark:` 变体；最大 P7 组件 176 行。
- 未自动执行浏览器验证，按项目约定留给用户决定是否验收。

### 与计划的出入

- 原计划的“地图树”本阶段实现为稳定层级目录加既有关系图，而不是另引入第二套图形树组件；目录更适合保留 unavailable/destroyed 节点，关系图继续表达非层级连接，数据职责更清楚。
- 更新详情以 committed turn settlement 作为文件化真相源，UI 不把每轮详细结算写回聊天上下文；这与计划一致，并进一步把摘要列表和完整详情拆成两次读取，降低常驻页面状态开销。
- 下一阶段进入 P8：实现有四分支上限、替换审批、安全切片、恢复门禁与分支认知隔离的世界切片树。

## 十七、运行逻辑优化 P8：世界切片树（2026-07-28）

### 目标

在 World Engine 不可恢复的单线增量切面之上建立 RP 专属可恢复时间线：玩家可以只读预览旧节点、建立安全切片、恢复或创建分支；每个节点最多四条直接分支，替换必须显式选择；分支后角色记忆严格隔离，玩家 OOC 认知继续保留。

### 实施结果

1. 可恢复时间线真相源：
   - 新增 `server/rp/timeline-store.ts`，树索引和材料固定写入 `.nbook/rp/branches/`，不修改写作模式 main 世界线，也不把 branch 目录递归包含进自己。
   - 节点恢复范围覆盖 `world-rp.sqlite` 的 WorldSubject/WorldSlice/WorldPatch/WorldOperation、`.nbook/rp/runtime/`、`rp/ticks/`、`rp/dice/` 与 `rp/characters/`；基础 manual/lorebook/schema/calendar 和 intake 跨分支共享。
   - World Engine 采用结构化导出和单 SQLite 事务重建，不复制运行中的数据库文件；Windows/libSQL 导出与恢复路径强制回收句柄。
2. 混合存储与完整性：
   - 根、安全、分支点和每 10 层节点保存完整材料，其他节点保存相对父节点的变化文件与删除路径。
   - manifest 保存最终完整文件哈希、变化/删除集合和清单哈希；预览与恢复从最近完整节点重放并校验每个载荷及最终索引，失败时拒绝恢复。
3. 四分支门禁：
   - 根节点永久锁定；每节点最多四个未归档直接子分支，后代不限。
   - 第五分支必须显式指定当前 active 节点的未锁定直接子分支；根、active、锁定节点不可替换。替换采用归档，材料不物理删除。
   - `rp_turn begin_commit` 在 World Engine 写回前检查容量；满四分支时阻断，不能先产生世界提交再补选择。时间线启用后每个 committed Tick 自动建立节点。
4. 恢复与认知隔离：
   - 恢复要求 active 冒险、无未完成回合及显式 `confirmed: true`；默认先建立完整安全切片，安全切片需要第五分支时同样要求替换选择。
   - cognition 升级为 schemaVersion 2：当前分支 facts/beliefs 随节点恢复，`oocFacts` 保存玩家跨时间线事实副本；OOC 副本不进入当前客观事实，也不自动成为角色 belief。
   - active 骰子日志随分支恢复，旧骰仍保存在分支节点材料中，不因回滚被物理抹除或偷偷重掷。
   - 恢复完成后 RP 前端新建 `rp.leader` 会话，使新的 cast/actor 子会话链从恢复后的角色档案和 belief 开始，不继承旧分支聊天上下文。
5. HTTP 与界面：
   - 新增 timeline GET/POST、timeline-preview GET、timeline-restore POST 四个入口，复用 Project Workspace open gate；GET 不隐式初始化。
   - 状态页新增“切片树”入口。非模态树窗口支持初始化、树状浏览、锁定/解锁、手工检查点、归档替换、只读预览和恢复确认。
   - 预览展示材料完整性，以及 active→目标节点在回合、事件、地图、NPC、资源、关系、认知、骰子和 World Engine 切面上的数量变化与不同文件数。
6. 稳定契约：
   - 新增 `reference/agent/rp-v2/timeline-branches.md`，并更新 RP v2 README、RP 模式 Skill 与 rp.leader 契约，明确 Agent 不能删除 WorldSlice 或改文件模拟回滚。

### 验证结果

- P8 核心专项：3 个测试文件、16/16 通过；覆盖根锁定、完整/差量、四分支替换、锁定拒绝、安全切片、OOC/角色认知隔离、真实 `world-rp.sqlite` 导出恢复、committed Tick 自动节点与 world commit 容量门禁。
- P1-P8 合并回归：25 个测试文件、114/114 通过。最终并行复跑曾出现一次 Vitest worker 无断言失败的异常退出（24 文件、111 项已完成），改用 `--maxWorkers=1` 后当前代码完整通过 25/25、114/114；记录为 Windows/libSQL 并行测试进程波动，不掩盖失败。
- `bun run typecheck` 未报告 P8 新文件诊断；仍被既有 World Engine 深层类型实例化、Profile 测试 settings 基线和 AbsoluteFsPath 品牌路径诊断阻断。
- P8 UI 主题审计通过，无 Tailwind 调色板类或 `dark:` 变体；`RpTimelineWindow.vue` 275 行，核心 store 644 行，均低于 800 行限制。
- 未自动执行浏览器验证，按项目约定由用户决定是否验收。

### 与计划的出入

- “阶段性完整切片 + 中间变化记录”落实为逻辑文件级完整/差量，而不是复制整份 SQLite 或为每个 RP store 设计一套专用 replay reducer；前者能统一恢复多个文件 store，且通过哈希保持可验证性。
- 替换分支采用可恢复归档而非物理删除。它仍从普通四分支树中移除并释放容量，但降低误操作丢失历史的风险。
- 恢复不仅重置角色文件与 cognition belief，还主动新建主持会话，解决长期复用 actor session 可能跨分支泄漏上下文的问题；这是原计划认知隔离要求在 Agent runtime 层的必要补强。
- 下一阶段进入 P9：跨 store 一致性检查、损坏恢复阶梯、固定随机测试能力和 100 Tick/多时间线长期验收。

## 十八、运行逻辑优化 P9：一致性、异常恢复与长期验收（2026-07-29）

### 目标

为长期 RP 世界建立分档一致性审计、安全修复边界和损坏恢复阶梯；将所有影响玩法结果的随机入口纳入仅测试可用的固定种子；用真实 100 Tick、规模数据和多时间线恢复完成 P1-P9 数据面硬验收。

### 实施结果

1. 三档一致性审计：
   - 新增 `server/rp/consistency-store.ts` 与 `.nbook/rp/runtime/consistency/latest.json`，统一返回 `healthy / warning / blocked`、问题、修复、档位和耗时。
   - light 覆盖 schema、turn/settled 幂等、时间资源、active 切片和 SQLite quick check；standard 增加地图/NPC、事件/关注度、关系/认知、全部 pipeline/正文引用；deep 逐节点物化时间线并运行 SQLite integrity/foreign-key check。
   - 唯一安全自动修复是依据 `parentId` 重建 timeline `childrenIds`。剧情、资源、关系、认知、正文和 World patch 一律标记 `player_confirmation`，不自动改值。
2. 生命周期门禁与玩家投影：
   - 已存在 RP intake 的项目打开后后台运行 standard；普通小说项目不创建 RP 状态。
   - `beginRpTurnCommit` 在 World 写回前运行 light 并阻断 error；长跳计划运行 standard；恢复前后运行 standard。
   - RP 状态页新增一致性摘要和 light/standard/deep 手工按钮；详细报告只落项目文件。committed 正文与 pipeline narrative 路径冲突时显示三种玩家处理方向，服务端不代选真相。
3. 切片损坏恢复阶梯：
   - 恢复先 materialize 目标，通过后才建立安全切片，避免目标已坏却改变当前树状态。
   - 失败后沿祖先链寻找最近可验证节点，问题写入 `.nbook/rp/branches/problems/{reportId}.json`，包含目标、尝试链、失败原因、祖先和建议操作。
   - 时间线窗口展示报告和最近可验证节点，只允许先查看；不会自动切换 active 或编造替代状态。
4. 固定测试随机：
   - 新增 `server/rp/random-source.ts`；正常游玩继续使用服务端 crypto RNG，`withRpTestRandomSeed()` 在非 test 环境直接拒绝。
   - AsyncLocalStorage 隔离并发测试；骰子、四卡候选抽取和 ppm 风险结算已迁移，ID 用 randomUUID 不进入玩法随机序列。
5. 长期硬验收：
   - 新增 `rp-p9-long-run.test.ts`，100 个回合真实走十阶段 pipeline、提交前 light 审计、committed 状态和自动切片，不使用伪造 turn 文件。
   - 场景含 20 个具名角色、30 个层级地图节点、10 个周期资源与 10 个周期模块，覆盖 light/standard/deep 三档、4 次长跳、主线 + 两条支线和支线角色记忆恢复隔离。
   - 最终 active 主线 100 committed Tick，deep 审计为 healthy，无 error、重复结算或跨分支角色记忆泄漏。
6. 稳定合同：
   - 新增 `reference/agent/rp-v2/consistency-recovery.md`，并更新 RP v2 README、时间线 reference、优化计划和仓库状态。

### 验证结果

- P9 专项：固定随机 3/3、一致性 2/2、切片树 7/7、100 Tick 1/1 全部通过；100 Tick 单场景约 120 秒。
- P1-P9 首次合并复跑：28 个测试文件，119/120 通过；唯一失败是旧 `intake-guard` fixture 直接 active 但未建立 `world-rp.sqlite`，新 light 门禁正确拒绝。fixture 已按真实 Bootstrap 合同补库，失败文件随后 3/3 通过。
- 最终全量复跑：28 个测试文件、121/121 通过，使用 `--pool=forks --maxWorkers=1` 隔离 Windows/libSQL 文件级运行环境；测试范围包含 100 Tick 长期场景。
- `bun run typecheck` 未报告 P9 新文件诊断；仍被既有 World Engine 深层类型实例化、Profile settings fixture 与 AbsoluteFsPath 品牌路径诊断阻断。
- 新增/修改的 `timeline-store.ts` 784 行、`consistency-store.ts` 347 行、`RpTimelineWindow.vue` 294 行、`RpStatusPanel.vue` 181 行，均低于 800 行限制；UI 未新增 Tailwind 调色板类或 `dark:`。
- 未自动执行浏览器验证，按项目约定由用户决定是否验收状态按钮、问题报告与恢复交互。

### 与计划的出入

- 项目打开审计采用路由层 fire-and-forget，而不是放入 ProjectSession 核心资源属主；这样避免普通项目被 RP 模块反向依赖，并且打开响应不被大世界审计阻塞。
- “上一验证节点恢复”落实为诊断和玩家候选，而不是自动 fallback。自动回退会改变剧情，违背已确认的玩家控制边界。
- 固定随机没有覆盖 randomUUID；UUID 只影响标识符，不影响判定结果，把它固定反而会制造跨测试文件碰撞。
- 100 Tick 验收比原计划更严格：每 Tick 真实经过完整 pipeline、提交审计和时间线捕获，因此耗时约两分钟，但能够同时证明幂等、切片增长和长期审计成本。

## 十九、服务器实测修复：RP 工具 Provider schema（2026-07-29）

### 问题与根因

- 用户启动服务器并向 `rp.leader` 发送消息后，Provider 返回 `Invalid schema for function 'rp_intake'`，说明函数参数根类型为 null。
- `rp_intake` 及另外八个 RP 多操作工具直接使用根级 `Type.Union` 作为 `parameters`；TypeBox 生成的根节点只有 `anyOf`，没有函数调用协议要求的 `type: "object"`。
- `AgentToolRegistry` 与 pi-ai Provider adapter 均原样透传该 schema，请求在任何 RP 业务逻辑执行前即被拒绝。`rp_intake` 只是 profile 顺序中第一个非法工具，单独修它会继续暴露下一项。

### 实施结果

1. 新增 `providerObjectSchema()`：把对象操作 union 投影为顶层 object，合并所有分支属性；所有分支共同要求的字段保持必填，其余字段仅在 Provider 视图中可选。
2. `rp_intake`、`rp_event`、`rp_mechanics`、`rp_cognition`、`rp_map`、`rp_npc`、`rp_pipeline`、`rp_focus`、`rp_turn` 的原始 union 全部迁入 `validationSchema`，执行期仍按 `op` 严格校验，没有放宽业务合同。
3. `AgentToolRegistry` 在 Provider 投影前强制检查 parameters 根节点；未来内置工具或 Profile override 再暴露根级 union 时，会在本地给出明确错误，不再向模型服务发送注定失败的请求。
4. 稳定 Profile 工具契约新增“模型可见 parameters 必须为 object”的编写规则。

### 变更文件

- `server/agent/tools/provider-object-schema.ts` 与对应测试。
- 九个 `server/agent/tools/rp-*-tools.ts` 多操作工具。
- `server/agent/tools/tool-registry.ts`、`tool-registry.test.ts`、`builtin-tools-smoke.test.ts`。
- `reference/agent/profile-guide.md`、本任务 walkthrough、优化计划与仓库状态。

### 验证结果

- schema/registry/intake 针对性回归：4 个文件、9/9 通过。
- RP 工具与 Profile 联合回归：9 个文件、32/32 通过；全部内置模型可见工具均为 object 根，九个 RP 工具均保留 union validationSchema。
- `bunx tsc --noEmit --pretty false` 不再报告本次新增文件诊断；全仓仍被既有 Vue `SelectOption` 导出、Profile settings 测试夹具和 World Engine `AbsoluteFsPath` 品牌路径问题阻断。
- 未自动执行浏览器验证；修复目标是服务器 Provider 请求合同，下一步由用户重启服务后重新发送 RP 消息实测。

### 与计划的出入

- 原 P1-P9 数据面测试只验证工具注册、权限和业务结果，没有模拟 Provider 对函数参数根节点的合同检查，因此 121 项长期回归没有发现该请求层错误。本次新增全内置工具遍历和注册表 fail-fast，补齐了这层验收缺口。

## 二十、RP 页面重挂载后会话列表恢复（2026-07-29）

### 问题与根因

- RP 对话产生 session 后，切换到 Agent/IDE、重启开发服务器后重新进入 RP，已有 session 暂时不显示；新建任意 session 后，旧 session 与新 session 会一起恢复。
- session 文件和服务端索引没有丢失。`RpModeSurface` 在 `index.vue` 中使用 `v-if`，离开 RP 会销毁内部 `AgentChatSurface`；重新进入时组件以 `active=true` 初始挂载。
- `AgentChatSurface` 原先只在 `props.active` 发生 `false → true` 变化时调用 `ensureSessionReady()`。Vue 非 immediate watcher 不处理初始 true，且原 `onMounted` 只加载模型、Profile 与 DOMPurify，因此新实例的 `sessions` 保持空数组。
- 新建流程会在创建后调用 `refreshSessions()`，所以它表现为“新建后旧会话突然全部回来”。普通 Agent 页面通过 `v-show` 保活，并在布局切换时显式 ensure，不受该缺口影响。

### 实施结果

1. 通用 `AgentChatSurface` 挂载完成后检查 `props.active`；初始已激活时调用现有幂等 `ensureSessionReady()`，恢复过滤后的会话列表、localStorage 中记忆的上次 session 和 recovery/stream。
2. 保留原 active watcher，继续处理挂载后的激活切换；挂载恢复与 watcher 即使相邻触发，也由 `ensureSessionRequest` 合并，不会重复创建或加载 session。
3. 修复落在通用对话面生命周期，而不是在 `RpModeSurface` 添加一次性刷新，避免未来其他按需挂载的 profile 界面重复出现同类问题。
4. `novel-writing-mode-entries.test.ts` 新增 RP `v-if` + `rp.leader` override + 初始 active 挂载恢复合同。

### 验证结果

- 会话生命周期专项：`novel-writing-mode-entries`、session list request guard、session API 与服务端 session repository 共 4 个文件、40/40 通过。
- `bunx tsc --noEmit --pretty false` 没有报告本次修改文件诊断；仍被既有 Vue `SelectOption` 导出、Profile settings 测试夹具和 World Engine `AbsoluteFsPath` 品牌路径问题阻断。
- 未自动执行浏览器验证。用户可通过“进入 RP → 发送消息 → 切到 IDE/Agent → 再进入 RP”确认旧 session 与上次对话自动恢复，无需再新建 session。

### 与计划的出入

- 仓库当前没有 Vue Test Utils 组件挂载基础设施，因此回归测试沿用现有前端源代码合同测试，结合 session API/repository 行为测试覆盖；没有为这一处生命周期修复新增测试依赖。

## 二十一、开团确认迁移到 RP 左侧状态页（2026-07-29）

### 问题与复现证据

- 用户完成开团引导后没有看到预期的确认弹窗或按钮，并提出将“确认并开团”放到左侧状态页。
- 实际 `rp.leader` session 显示：企划推进到 v8 后调用 `review`，状态进入 `reviewing`；随后漏掉 `confirm`，直接调用 `begin_bootstrap`，服务端正确拒绝“当前企划 v8 尚未以同版本确认”，再读状态仍为 `reviewing`。因此本次没有产生任何 pending UI。
- 即使 Agent 正确调用旧 `confirm`，`agent-message.ts` 也只投影 form 与 toolCallId，丢弃 formSpec 的 `layout` 和 `prompt`；`AgentComposer` 固定把所有表单放在输入框上方。旧文档所述 dialog 实际从未实现。
- RP 布局还监听了一个通用对话面没有发出的 `sync-workspace` 事件；`review` 写入后侧栏可能保持旧快照，进一步延迟确认入口出现。

### 实施结果

1. 确认权改为玩家 UI 独占：
   - `rp_intake` 模型 schema 删除 `confirm`，工具不再创建确认 pending；Agent 无法确认或代按。
   - 新增 `POST /api/projects/rp/intake-confirm`，请求必须为 `{version, confirmed: true}`，并经过 Project open gate。
   - store 只接受 `reviewing` 的当前版本；版本变化、字段不完整或阶段错误均拒绝。确认后仍只进入 `confirmed`，不会由按钮直接执行 Bootstrap。
2. 状态投影与左侧按钮：
   - runtime overview 从单一 `intakePhase` 升级为 `intake` 摘要，公开 phase、version、confirmedVersion 与 Bootstrap 状态/失败原因，不返回企划字段正文。
   - 左侧“状态”页在 `phase=reviewing` 时显示绑定当前版本的“确认并开团”主按钮；confirmed、bootstrapping、active 和失败状态显示对应说明，不重复确认。
   - 按钮由持久状态驱动，不依赖聊天 pending，页面切换、session 恢复或服务器重启后仍可恢复。
3. 主持续跑与刷新：
   - `RpModeSurface` 在主持回合从 running 变为空闲时刷新侧栏与正文，因此 `review` 回合结束即能显示按钮，不依赖无实现的 workspace sync 事件。
   - 玩家确认后，当前 `rp.leader` 空闲时自动发送“RP 状态页操作”回执，要求先 `get` 核对 confirmedVersion 再 `begin_bootstrap`。
   - 若确认时主持仍在运行，则等待本轮结束；若主持已经自行进入 bootstrapping/active，则复核状态后不重复发消息。
4. 稳定合同与真实 runtime：
   - rp.leader Profile、开团 Skill、RP 模式 Skill 与稳定 reference 全部改为“review → 展示企划 → 指向状态页 → 结束回合”。
   - 系统 Profile 重新编译，强制同步真实 user runtime；当前运行副本不再包含 `op=confirm` 旧流程。

### 验证结果

- 最终联合回归：5 个测试文件、27/27 通过，覆盖确认请求 schema、版本竞态、Agent schema 不暴露 confirm、运行概况安全投影、Profile 合同与前端按钮/续跑接线。
- `bun run typecheck` 仍被仓库既有 World Engine 深层类型实例化、Profile settings 测试夹具和 AbsoluteFsPath 品牌路径问题阻断；没有报告本次新增 API、DTO、RP 组件或工具代码诊断。
- 系统资产预处理成功：19 个 Profile 中编译 1 个 stale Profile，真实 user runtime 更新 1 个 Profile；两个 RP Skill 已同步。
- 未自动执行浏览器验证。建议用户在当前停留于 `reviewing` 的项目上重新进入 RP，确认左侧按钮出现并点击后自动恢复 Bootstrap。

### 与计划的出入

- 原诊断方案曾考虑让左侧按钮作为旧 pending approval 的第二入口；实际 session 证明 Agent 可能根本不创建 pending，因此该方案仍会隐藏按钮。最终改为由持久 intake 状态直接驱动、UI 独占确认权。
- 没有补做通用 Low-Code Form 的 dialog 渲染。RP 开团不再依赖该布局；通用 `layout` 丢失属于独立前端能力问题，不应为本次开团入口引入全局模态行为。

## 二十二、Bootstrap 阶段状态机与开场正文发布门禁（2026-07-29）

### 问题与根因

- 玩家点击左侧“确认并开团”后，主持已经输出开场正文，但状态页仍停在“正在初始化”；同时 World Engine 状态提示“schema 必须导出 `{ subjectTypes: {...} }` 或 WorldSchema 注册表对象”。这说明聊天正文与可运行世界的完成状态没有同一份服务端真相源。
- 旧流程只有粗粒度 `bootstrapping` 状态。`begin_bootstrap` 后，Agent 可以先写 Tick 000000 正文，再尝试 Schema、Calendar、世界、地图和角色初始化；任何中途失败都不会阻止正文 API 展示开场内容，也无法准确指出失败发生在哪个步骤。
- 旧 `activate`、`begin_bootstrap` 接受由模型提供的版本参数，阶段完成主要依靠 Agent 自述；服务端没有逐阶段检查真实文件、World Engine 数据、地图映射、角色档案、开场事件和正文产物。
- 当前测试项目 `workspace/xing-tong-jiao-huan-2` 的 `rp/world-engine/schema/index.ts` 确实导出了错误形态，`calendar.ts` 也不是生产 loader 可加载的 Gregorian 配置；intake 却停在错误的运行中状态，开场正文已经写入正式 Tick，因此 UI 同时出现“初始化中”和正文。

### 实施结果

1. Intake 升级为 `schemaVersion: 2`，Bootstrap 改为服务端六阶段状态机：
   - `config`：要求正式手册、Lorebook 目录、Schema 与 Calendar 存在，并用生产 loader 真实加载；Schema 必须至少包含 `world`、`character`、`location`。
   - `world`：要求 RP 独立数据库存在基础主体和至少一个带 patch 的初始切片。
   - `map`：要求至少一个已固化地点，且每个地图节点对应真实的 World Engine location subject。
   - `characters`：要求角色注册表、人设、开局心境与 NPC roster 均已建立。
   - `opening_event`：要求存在已激活的 opening 事件。
   - `narrative`：要求开场正文先写入 staging；六阶段通过后进入 `ready_to_activate`，激活成功后才成为 `complete`。
2. `rp_intake` 收口模型权限：
   - `begin_bootstrap` 自动绑定服务端 `confirmedVersion`，模型不再传入 version。
   - 新增 `checkpoint_bootstrap stage=...`；只能校验当前阶段，成功后推进到相邻阶段，失败自动回到 `confirmed` 并持久化失败阶段、原因与时间。
   - `activate` 不再接收 version，并在发布前重新执行六阶段全量验收；`fail_bootstrap` 的失败阶段由服务端状态推断。
3. 按阶段限制工具与子 Agent 写面：配置、World、地图、角色、事件与叙事只能在各自阶段修改；Bootstrap 期间禁止直接写正式 `rp/ticks/**`，`rp.writer` 只能写 `rp/bootstrap/staging/opening-prose.md`。
4. 开场正文采用原子发布门禁：
   - 初始化期间暂存于 `rp/bootstrap/staging/opening-prose.md`。
   - 全阶段验收通过后移动到 `rp/ticks/000000-initial-state/prose.md`，正式文件已存在时拒绝覆盖；若最终状态落盘失败，则把正文移回 staging。
   - 正文 API 在 intake 非 `active` 时固定返回空，Tick 000000 不再绕过状态门禁。因此正文不会早于世界初始化显示。
5. World Engine 状态检查从“文件存在”升级为真实加载 Schema/Calendar，并向状态页返回缺失项和加载错误；左侧状态页展示当前 Bootstrap 阶段与 `n/6` 进度，不再只有无法定位的“正在初始化”。
6. Profile、RP Skill、Bootstrap Skill 与稳定 reference 已同步新合同；系统资产重新编译并同步真实 user runtime，运行副本已确认包含 `checkpoint_bootstrap` 与 staging 路径。

### 当前项目恢复

- 修正 `workspace/xing-tong-jiao-huan-2/rp/world-engine/schema/index.ts` 为合法 `WorldSchema`，并把 `calendar.ts` 改为 Gregorian default 配置；补齐 `rp/lorebook/README.md`。
- 原开场正文完整移动到 staging，没有删除内容；intake 保留玩家已确认的 v8 企划，但从错误的 `bootstrapping/running` 恢复为 `phase=confirmed`、`bootstrap.status=failed`、`stage=config`。
- 没有伪造 World、地图、NPC roster 或开场事件。服务器重启后，主持应从 `config` 阶段按新合同重新验收和构建。
- 实际只读校验结果：Schema 与 Calendar 均可由生产 loader 加载，intake 为 `confirmed`，正文 API 可见条目为 0。

### 变更范围

- 服务端：`server/rp/bootstrap-store.ts`、`intake-store.ts`、`intake-guard.ts`、RP runtime/world status 与正文读取路径。
- Agent 工具与权限：`server/agent/tools/rp-intake-tools.ts`、RP Profile 工具合同及对应测试。
- 前端：`app/components/novel-ide/rp/RpStatusPanel.vue` 的阶段、进度和失败信息展示。
- 稳定资产：`assets/workspace/.nbook/agent/` 下 RP Profile/Skill、`reference/agent/rp-v2/` 合同，以及当前测试 Project Workspace 的 RP 配置和暂存正文。

### 验证结果

- Bootstrap/门禁第一轮回归：5 个文件、26/26 通过；Bootstrap 编排、World status 与 Profile 契约：4 个文件、46/46 通过。
- 修正共用夹具后，完整 `server/rp` 回归最终为 22 个测试文件、95/95 通过；其中 100 Tick 长期验收正常完成并以 deep healthy 收口。
- `bunx tsc --noEmit --pretty false` 不再报告本轮 `WorldEngineFacade` 的 `AbsoluteFsPath` 错误。全仓检查仍被既有 Vue `SelectOption` 导出错误和 Profile settings 测试夹具缺少 persona/custom prompt 字段阻断。
- 未自动执行浏览器验证。建议重启服务器后，在当前项目中发送“继续开团”，观察状态页依次推进六阶段，且只有激活完成后正文才出现。

### 与计划的出入

- 首次完整 RP 回归出现 6 个失败文件。根因不是业务回归，而是共用测试夹具为了通过新的真实激活验收而新增了开场事件、NPC 和初始切片，污染了旧测试对“空业务状态”的假设。最终夹具改为先通过真实激活验收，再清空仅用于验收的种子产物；受影响文件和 100 Tick 场景均重新通过。
- 原计划只需要阻止错误激活；实际 UI 症状证明“正文可见性”也必须绑定 intake active 状态，因此额外引入 staging→正式 Tick 的发布门禁，并恢复当前项目中已经提前写出的正文。
- 当前没有让通用 Agent Harness 在“主持自然结束但从未调用 checkpoint”时自动标记 Bootstrap 失败。现有硬门禁保证后续阶段不能越过、正文不能提前显示、checkpoint 校验失败会自动落盘；若以后增加回合结束钩子，应通过通用扩展点实现，避免 Harness 反向依赖 RP 模块。

## 二十三、Bootstrap config 标准初始化与原阶段恢复（2026-07-29）

### 问题与根因

- 真实 Agent 在 `config` 阶段反复手写 `schema/index.ts` 与 `calendar.ts`。Schema 曾用普通 `{shape: {}}` 伪造 Zod 对象；Calendar 则混入另一套并不存在于当前 loader 的 `unit/seconds/weekStart/epochZero` 字段，并误以为最大单位必须声明 `parent`。
- 当前 Simple Calendar 的真实合同是以 `baseUnit` 作为隐式根，`units` 只声明从小到大的固定换算链，例如 `{name: "minute", parent: "second", ratio: 60}`；Gregorian 则不需要 `units`。
- 旧失败处理把 intake 回退到 `confirmed`，迫使 Agent 每次重新 `begin_bootstrap`。这扩大了无效循环，也让“修正当前配置”与“重新开始初始化”混在一起。

### 实施结果

1. `rp_intake` 新增 `initialize_config`：Agent 只选择 `gregorian` 或 `simple` 预设与可选纪元名，服务端生成真实 Zod `WorldSchema` 和受信 Calendar，并立即通过生产 loader 验证。
2. 标准 Schema 固定提供 `world`、`character`、`location` 及 RP 后续阶段依赖的核心属性；config checkpoint 增加属性级语义校验，避免“文件能 import 但无法承载运行状态”的空壳配置通过。
3. `WorldSchemaLoader` 明确要求每个 subject type 都是真实 `z.object(...)`；普通 `{shape: {}}` 现在直接给出可操作错误，不能再伪造注册表。
4. Bootstrap 失败保持 `phase=bootstrapping`、`status=failed`、原 `stage` 与 `completedStages`。修正后可直接重试当前 checkpoint，不再重复 begin；状态页显示“初始化需要修正”和具体原因。
5. Bootstrap 期间通用 write/edit/apply_patch 被禁止修改 `rp/world-engine/schema/index.ts` 与 `calendar.ts`，从工具权限层约束 Agent 使用标准初始化入口；manual/lorebook 仍可在 config 失败后继续修正。
6. rp.leader Profile、两份 RP Skill 与稳定 reference 全部改用新合同；内置 Profile 已重新编译并同步真实 user runtime。

### 当前项目恢复

- `workspace/xing-tong-jiao-huan-2` 已写入标准 Gregorian Calendar 与真实 Zod Schema。
- 使用生产 `checkpointRpBootstrap(..., "config")` 验收通过，intake 已从 `config` 推进到 `world`，`completedStages=["config"]`；没有伪造 World、地图、角色、事件或正文数据。
- 主持下一次恢复时应从 `world` 阶段继续创建基础 subject 与初始切片，而不是再次修改配置或重新 begin。

### 验证结果

- 定向回归：5 个文件、26/26 通过，覆盖 Gregorian/Simple 预设、真实 Zod、伪 shape 拒绝、失败后原阶段重试、工具合同、Profile 合同和通用文件写入门禁。
- 完整 `server/rp` 回归：22 个文件、95/95 通过。
- 系统资产预处理：19 个 Profile 中重编译 1 个 stale Profile；真实 user runtime 更新 1 个 Profile、2 项 Skill 资产。
- `bunx tsc --noEmit --pretty false` 没有报告本轮生产代码或新增测试诊断；全仓仍被既有 Vue `SelectOption` 导出与 Profile settings 测试夹具缺字段问题阻断。
- 未自动执行浏览器验证。服务器重启后可让主持继续开团，观察其从 `world` 阶段继续而不再猜写 Schema/Calendar。

### 与计划的出入

- 推荐方案原本聚焦 Calendar 示例与失败重试；实施时进一步把 Schema/Calendar 的生成权收归服务端，并增加通用文件工具硬门禁。仅改提示词无法系统性阻止模型再次发明配置字段，这一扩展是防止同类故障复发的必要约束。
- 第一轮测试发现标准 Schema 源码模板中的正则斜杠转义错误，生成文件无法编译；修正模板后，现有“生成后立即用生产 loader 验证”的测试已覆盖该边界。
- 当前项目原计划停留在可重试 config；由于生产 loader 与完整 RP 回归均通过，本轮按恢复流程实际执行了 config checkpoint，并诚实推进到 world。后续业务数据仍由主持按玩家企划生成。

## 二十四、Bootstrap map 提案权限与单地点协议修复（2026-07-29）

### 问题与根因

- `workspace/wo-de-xiao-yuan-sheng-huo` 已通过 config 与 world，但在 map 阶段无法建立任何提案：screenwriter、world、leader 对 `origin=bootstrap` 全部被 `rp_map` 拒绝，而 world 的 `review` 又只能处理已存在提案。
- 设计职责并未漏分配：screenwriter 提出地点，world 核对 canon/World Engine 并 review 固化，leader 只负责编排或代玩家提交 `origin=player`。实际缺口是工具 Schema 已声明 `bootstrap` 来源，权限实现却没有任何合法调用者。
- Provider 可见 object 投影还使模型多次把 `propose` 误写成 `candidates[]` 批量形状；执行 Schema 中 `propose` 实际只接受根字段中的一个地点，`candidates` 只属于 `stage_import`。

### 实施结果

1. `rp_map` 在执行 `propose origin=bootstrap` 前读取服务端 intake 状态；只有 `rp.screenwriter + bootstrapping/map` 组合获准。
2. active、其他 Bootstrap 阶段、缺少运行状态时均拒绝 bootstrap 来源；rp.world 与 rp.leader 没有获得 Bootstrap 提案权，常规职责边界保持不变。
3. 工具描述明确 `propose` 每次只接收根字段中的一个地点；多个地点逐次调用，禁止混入 `view`、`candidates` 或 `decisions`。
4. rp.leader、rp.screenwriter、rp.world Profile，两份 RP Skill 与稳定地图生命周期 reference 已同步相同合同；系统 Profile 已重新编译并同步真实 user runtime。
5. 当前 Project Workspace 仍保持 `bootstrapping/failed`、`stage=map`、`completedStages=[config, world]`，地图 state 不存在。本次没有伪造任何地点；主持恢复后应直接重试 map 阶段，无需重新确认、begin 或重做前两阶段。

### 验证结果

- 定向回归：3 个测试文件、21/21 通过，覆盖 `bootstrapping/map` 放行、错误阶段与 active 拒绝、world 越权拒绝、单地点合法 Schema 和 `propose+candidates[]` 非法 Schema。
- 完整 `server/rp` 回归：22 个测试文件、95/95 通过。
- 系统资产预处理成功：19 个 Profile 中重编译 3 个 stale Profile；真实 user runtime 更新 3 个 Profile 与 2 项 Skill 资产，并已只读确认新合同存在。
- `bunx tsc --noEmit --pretty false` 没有报告本轮 `rp-map-tools.ts` 或新增回归测试诊断；全仓仍被既有 Vue `SelectOption` 导出错误及 Profile settings 测试夹具缺少 persona/custom prompt 字段阻断。
- 未自动执行浏览器验证。服务器重启后可让主持“修正当前阶段后直接重试”，观察 screenwriter 逐地点提案、world review、checkpoint map 推进。

### 与计划的出入

- 第一轮完整 RP 回归在 120 秒命令上限内未完成，也未报告失败；延长到 300 秒后正常以 95/95 通过，确认只是单进程测试集耗时，不是本轮死锁。
- 原方案仅要求更新 leader/screenwriter 合同；实施时也为 rp.world 增加“不能 propose、缺提案时退回 screenwriter”的明确指令，避免 world 在 review 失败后继续猜测写权限。这没有扩大其工具权限。

## 二十五、Bootstrap characters 的 world 调用窗口与空 roster 语义（2026-07-29）

### 问题与根因

- `workspace/wo-de-xiao-yuan-sheng-huo` 完成 config/world/map 和化身朝雾悠真的档案后，characters checkpoint 因 NPC roster 为空失败。
- `rp_npc` 工具权限本身正确：`register_named` 归 rp.world；NPC store 也正确要求 Bootstrap characters 阶段写入。但更外层的子 Agent 门禁只允许在 world/map/opening_event 调用 rp.world，遗漏 characters，形成没有可执行交集的双层门禁。
- 第二个矛盾来自验收语义：NPC 生命周期规定“未具名群演不落 roster”，characters checkpoint 却无条件要求 roster 非空。当前开场只有尚未报上姓名的女大学生，主持因此尝试把“未具名女大学生”作为 name 登记，既违反生命周期也会污染玩家可见名册。
- 既有测试分别覆盖了 NPC 权限和带具名 NPC 的完整 Bootstrap，但没有覆盖“子 Agent 阶段矩阵 × NPC store 阶段”或“只有化身的开团”，所以单层测试全部通过仍未发现组合死锁。

### 实施结果

1. Bootstrap 子 Agent 门禁允许 rp.world 在 `characters` 阶段被调用；screenwriter、writer 等其他子 Agent 仍被拒绝。
2. `register_named` 仍只允许 rp.world，leader 没有获得 NPC 写权限；NPC store 仍把 Bootstrap 写入限制在 characters，常规职责边界未放宽。
3. characters 验收继续要求角色注册表非空，并逐一验证所有已建档角色的 soul 与 mood；NPC roster 改为可空。若 roster 已存在仍由 Zod 读取完成结构校验。
4. Bootstrap 合同明确：企划中已确认具名的初始 NPC 由 world 在 characters 阶段登记；未具名群演不入 roster，不能用描述性占位词伪造姓名；独角或无具名 NPC 的开场允许空 roster。
5. 当前 Project Workspace 保留 `bootstrapping/failed + characters`、前三阶段完成、朝雾悠真档案完成和 NPC state 不存在。本次没有代为 checkpoint，也没有登记“未具名女大学生”；主持恢复后直接重试 characters 即可。

### 验证结果

- 定向联合回归：4 个测试文件、24/24 通过，新增覆盖 characters 阶段 world 调用、screenwriter/writer 拒绝，以及仅有化身且无 roster 时推进到 opening_event。
- 完整 `server/rp` 回归：22 个测试文件、97/97 通过。
- 系统资产预处理成功：19 个 Profile 中重编译 2 个 stale Profile；真实 user runtime 更新 2 个 Profile 与 2 项 Skill 资产，并已只读确认新合同存在。
- `bunx tsc --noEmit --pretty false` 没有报告本轮 intake guard、Bootstrap validator 或新增测试诊断；全仓仍被既有 Vue `SelectOption` 导出错误及 Profile settings 测试夹具缺少 persona/custom prompt 字段阻断。
- 未自动执行浏览器验证。服务器重启后让主持修正当前阶段并直接重试；本项目不需要创建占位 NPC，characters 应进入 opening_event。

### 与计划的出入

- 诊断前表面方案可以只把 rp.world 加入 characters 调用列表，但那仍会迫使所有冒险至少伪造一个具名 NPC。实施按确认方案同时修正无条件 roster 验收，消除了权限死锁和数据语义错误。
- 当前 World Engine 已有一个用于开场安排的内部女性角色 subject，但她尚未向玩家报出姓名，因此本轮没有将其自动投影进玩家可见 roster；待实际互动中具名后再由 world 登记。

## 二十六、world_snapshot 隐藏审批、Agent 状态投影与原回合恢复（2026-07-30）

### 问题与根因

- 首个常规回合 `turn-000001-07e45918` 已成功读取 RP World Engine，Instant 为 `7808400`（公元1年4月1日 09:00），但 pipeline 一直停在 `world_snapshot` 且 `snapshot=null`。
- rp.world 第一次 `rebalance` 缺少三个必填数组；第二次补齐数组后仍在根节点多传 `reason`，被严格 union Schema 拒绝。随后模型改用只归 rp.leader 的 `set_focus`。
- 工具执行期已有 `assertFocusPermission`，但 Harness 的顺序是先运行 `userInputRequest.when()`、创建 pending，再进入 `executeWithContext`。因此越权的 world `set_focus` 没有立即返回权限错误，而是生成隐藏确认表单并让子 Agent 进入 waiting。
- `get_agent` 又通过 `sessionSummary()` 把所有 Agent 状态硬编码成 `idle`。leader 同时收到 invocation 正在等待、continue 报 `active_invocation_exists`、get_agent 却报 idle，最终误判 world 已失败并登记阻塞 failure。

### 实施结果

1. 工具协议新增统一只读 `authorize(context, args)` 钩子，`defineAgentTool`、runtime 包装与旧 runtime→definition 包装均完整传递；顺手补齐旧包装遗漏的 `userInputRequest` 传递。
2. Harness 在任何 `userInputRequest`、显式 approval 或只读模式写审批前，先完成 profile 工具可用性、参数 prepare、严格 Schema 校验和领域预授权。预授权失败直接写错误 tool result，不创建 pending；执行期原权限断言继续保留作为纵深防御。
3. `rp_focus`、`rp_map`、`rp_npc`、`rp_mechanics`、`rp_cognition` 五个同时具有角色权限和用户确认的 RP 工具全部接入预授权。Bootstrap map 的阶段检查也复用同一授权路径，没有放宽任何 Agent 职责。
4. `AgentSummary.status` 扩展为 `idle | running | waiting`；`get_agent` 单查和拥有列表均使用真实 runtime projection/active invocation，不再返回硬编码 idle。
5. `rp_focus` 合同收紧并同步到 rp.world Profile、RP Skill 与稳定 reference：world_snapshot 固定使用 `rp_focus get → execute_world state_read → rp_focus rebalance → rp_focus plan_runtime → rp_pipeline capture_snapshot`；关注计划基于刚读取的客观状态，`rebalance` 根字段没有 `reason`；`set_focus` 只归 leader 与玩家确认，world 禁止调用。

### 当前回合恢复

- 通过 Harness 正式 abort 流程结束 session 49 的旧 waiting invocation，落盘对应错误 tool result 与 aborted lifecycle，并清空 follow-up 队列；没有手改 JSONL。
- 在同一 turn 上按正式 store 顺序执行合法 `rebalance → plan_runtime → capture_snapshot`，随后把原 world failure 标记为成功重试：
  - runtime plan：`runtime-plan-536f5895-4798-4374-becf-a4c842b07769`；standard；直接互动 NPC 为 `npc-active-female-student-01`；远端预算 2。
  - snapshot：`snapshot-669d9f1268f7e130a0a4`；worldInstant `7808400`；stateHash `308e142eb37f31c611264434c3b4828235e0f5b297f5ab75faa497b86287000e`。
  - pipeline 仍停在 `world_snapshot`，snapshot 已存在，旧 blocking failure 已 resolved；没有推进 condition_check 或后续剧情。
- 只读复核 session 49：`status=idle`、`activeInvocation=null`、`pendingUserInputs=[]`、follow-up count 为 0。

### 验证结果

- RP 相关联合回归：8 个测试文件、43/43 通过，覆盖关注度、地图/NPC、规则、pipeline store、首回合闭环、Agent collaboration 与 RP Profile。
- Harness 全文件 183 项中，本轮新增“预授权早于 userInputRequest 且不产生 pending”和“get_agent 等待/恢复状态”均通过；另有 1 个既有“删除 session 模型后的恢复投影”用例稳定失败（期望已删除模型引用、实际为 null），与本轮工具授权和状态投影链路无关。
- `bunx tsc --noEmit --pretty false` 没有报告本轮生产代码或新增测试错误；全仓仍被既有 Vue `SelectOption` 导出和 Profile settings 测试 fixture 缺 persona/custom prompt 字段阻断。
- 系统资产预处理成功：19 个 stale Profile 重新编译；真实 user runtime 更新 1 项 RP Skill 资产。

### 与计划的出入

- 原计划预计在恢复后由主持自然继续；为严格遵守“不推进 condition_check 后剧情”，本轮只直接恢复了确定性的 focus/runtime plan/snapshot 数据并解除旧 failure，没有再次调用模型，也没有推进 pipeline 邻接阶段。
- 全仓 Harness 回归暴露了一个与本轮无关、可稳定复现的既有模型恢复测试失败，因此验证结果没有写成“全绿”；本轮新增的两项 Harness 回归已单独复跑通过。

## 二十七、运行计划契约、地图提案恢复与玩家图谱交互（2026-07-30）

### 问题与根因

- `turn-000002-4a8cf3c2` 在 `world_snapshot` 调用 `rp_focus plan_runtime` 时携带了 `worldSummary`。该字段只属于 `record_long_jump`，严格执行 Schema 正确拒绝；但模型可见的 `providerObjectSchema()` 把不同 op 的字段扁平合并为可选属性，造成 Provider 接受、执行期拒绝的契约错位。
- 即使删除 `worldSummary`，调用仍把“地下城历1年1月1日 11:50”作为 `startInstant`。运行计划后续会用 `BigInt()` 比较 Instant，因此格式化日历文本还会制造第二次失败。
- 地图 `propose` 对相同 requestedId 无条件返回旧活动提案，无法修正 `endforest.parentId=null`；`endforest-ancient-ruin` 随之因父节点未登记保持 conflict。
- RP 角色页只循环 NPC roster，World Engine 中的玩家化身与未进入 NPC lifecycle 的角色不会渲染；地图与关系图直接从完整 World Engine attrs 推导，既没有读取稳定地图/正式关系账本，也存在把未 materialize 地点和隐藏角色字段带到浏览器的风险。
- `RpGraphCanvas` 已发出 `selectNode`，但父组件没有监听，也没有大图入口，因此节点点击无效果。

### 实施结果

1. `providerObjectSchema()` 保留顶层 `type: object`，同时通过 `anyOf` 暴露每个 op 的精确分支；Harness 执行前按 `op` 选择同一分支校验。九个使用该公共投影的 RP 多操作工具同步获得一致契约和当前分支字段级错误，不再依赖提示词猜测可选字段组合。
2. `plan_runtime` 的 `startInstant/endInstant` 在模型 Schema 与 focus store 两层都限定为 bigint 十进制字符串，并拒绝逆序区间；`execute_world` 结果新增固定原始 `instant`，工具文本明确显示为 `worldInstant`。rp.world Profile、RP Skill 与稳定 reference 加入完整合法示例，并明确 `worldSummary` 只属于长跳摘要。
3. `rp_map` 新增 `replace_proposal`：只替换 proposed/pending_import/conflict，保持 requestedId 与 origin；旧提案标记 superseded 并用双向 id 保留审计链，materialized 节点禁止替换。重复 propose 若定义不同会列出差异字段并引导显式替换，不再静默返回旧数据。
4. 角色注册表新增明确的 `kind: player | npc`；玩家 overview 合并 World Engine 角色身份、注册表和 NPC roster，按玩家化身、主要、常驻、具名、非活跃主要及其他角色分类。玩家 DTO 移除 aliases，角色详情不再读取完整 World Engine attrs。
5. 地图图只从 `runtime.map.nodes/routes` 构建；关系图只从正式 relation store 的玩家投影构建。新增共用 `RpGraphWindow`，地图与关系图均提供“放大查看”，缩略图或大图节点可点击，右侧展示节点详情与关联节点。
6. 真实 Project Workspace `workspace/xin-xiao-shuo` 已通过正式 store API 恢复：旧地图 conflict 提案保留为 superseded，新提案按 `dungeon-continent → endforest → endforest-ancient-ruin` materialize；角色注册表已标记 `liukang=player`、`dingdang=npc`。
7. 同一回合旧 world failure 已标记 retried，运行计划为 `runtime-plan-b03bdde9-7e4a-4440-9109-fc57ea967502`（Instant `42600 → 42660`），快照为 `snapshot-71b36f3fbe55ffc29956`。Pipeline 仍停在 `world_snapshot`，没有推进 condition_check、角色反应、正文或世界提交。

### 验证结果

- 首轮定向回归：6 个测试文件、24/24 通过。
- 完整 RP/工具/World Engine/图谱联合回归：26 个测试文件、139/139 通过。
- `bunx tsc --noEmit --pretty false` 没有本轮诊断；全仓只剩既有 `app/components/novel-ide/settings/model-settings-view.ts` 的 Vue `SelectOption` 导出错误。
- `bun run typecheck` 没有报告本轮 RP Vue 组件诊断；全仓被既有 `WorldEngineStateOverview.vue:204` 的 TypeScript 深层类型实例化错误阻断。
- 系统资产预处理成功：19 个 Profile 无 stale；真实 user runtime 更新 2 项 RP Skill/Profile 资产，并已只读确认新合同存在。
- 已只读复核真实地图、focus plan 与 pipeline 文件。按仓库规则未自动进行浏览器验证。

### 与计划的出入

- 原方案只要求让 state_read 同时返回 raw Instant 与格式化时间；实际实现把 raw Instant 固定提升到所有 `execute_world` 结果元数据，避免 Agent 脚本忘记主动 return，同时不改变脚本正文的自由返回值。
- 关系图当前真实项目的正式 relation state 为空，因此修复后会显示刘康、叮当两个角色节点但没有关系边；不会再用 World Engine 的临时 `关系` attrs 猜造正式关系。
- 为避免新增节点详情扩大泄密面，本轮取消角色页对完整 World Engine attrs 的展示，改为只消费玩家安全 overview；这比最初单纯补点击事件的范围更严格，但符合 RP 玩家视图既有安全契约。

## 二十八、RP 引导期 overview 初始化门禁（2026-08-01）

### 问题与根因

- RP 独立世界线的 `rp/world-engine/schema/index.ts` 与 `rp/world-engine/calendar.ts` 按契约只在玩家确认企划后，由 Bootstrap config 阶段的受信工具生成；`draft/reviewing/confirmed` 引导期缺少该目录是正常状态。
- RP 侧栏刷新时先请求 `/api/projects/rp/overview`。该接口原本无条件调用 `listSubjects(..., "rp")`，在侧栏随后请求 `/api/projects/world-engine/status?worldKey=rp` 之前就加载 RP Schema/Calendar，因此未初始化项目稳定报“Project 缺少 world-engine/calendar.ts”。
- 重启只会重新加载持久化的 intake 状态，不会自动越过玩家确认执行 Bootstrap，所以异常在每次启动后都会重复出现；发布包内的写作模式 `world-engine/` 模板并未缺失。

### 实施结果

1. RP overview 先通过 `getWorldStatus(projectPath, "rp")` 检查独立世界线配置状态。
2. 未初始化时跳过 World Engine 角色查询，以空角色主体列表聚合 intake、事件、地图、角色注册表等当前可用的玩家侧数据；侧栏继续通过 status API 展示“尚未初始化/待创建”状态。
3. 初始化完成后仍从 `worldKey=rp` 的独立数据库和配置根读取 character subjects，未回退或复用写作模式世界线。
4. 新增 API handler 回归，分别约束未初始化时不调用 `listSubjects`、初始化完成后继续合并 RP 角色主体。

### 验证结果

- 定向回归：`server/api/projects/rp/overview.get.test.ts` 与 `server/world-engine/world-engine.facade.test.ts` 共 5 项通过，27 项按筛选跳过。
- 验证覆盖引导期缺少 `rp/world-engine/`、RP 世界线严格隔离，以及初始化完成后的正常角色读取。
- 按仓库规则未自动执行浏览器验证；本轮不打包、不创建新版本或 GitHub Release。

### 与计划的出入

- 诊断时用户将现象判断为发布后 RP 依赖目录整体漏打包；实际确认写作模式模板文件存在，缺少的是尚未进入 Bootstrap 的 RP 独立配置根。修复因此落在 API 初始化门禁，而不是给所有 Project Workspace 预建 RP 配置，避免破坏受信生成与模式隔离契约。
