# 113 - 记忆系统（Memory System）产品讨论

> 状态：**讨论中**（2026-07-21 起）。本目录先承载产品讨论与现状盘点，方案定稿后再补 Goal / 实施计划。
> 前置：Task 112（Passport / 官方站点）已定稿，账号讨论明确「记忆系统单独立项、不做大一统记忆数据库」，云端 scope 保留字 `memory:*` 已在 Passport spec 占位。

## Relative documents refs

- `reference/agent/profile-context-memory.md` — 现行 profile context memory 合同（context.md / memory.md / generated.md / context-access）。
- `docs/tasks/68-global-profile-home-resource-preset/README.md` — Profile Home 两层（Global / Project）与生命周期。
- `server/agent/profiles/profile-home.ts` — Profile Home facade；`clear()` 即 reset 清目录。
- `docs/agent/subject-rag-memory.md` 与 `reference/content/subject-rag-memory.md` — Subject RAG 合同（simulation 域，保持独立，本任务不碰）。
- nb-workshop 仓 `reference/passport/api-v1.md` §7 — `memory:*` scope 保留字。

## User Request / Topic

- 记忆系统拆分为**应用级记忆**（跨项目：用户习惯、写作经验）与**项目级记忆**（当前项目约定）。现有 agents 目录 / profile home 做了一部分但不完整。
- 需要分析多个方案后定形态。
- 前置拍板（账号讨论轮）：记忆云同步 / 共享记忆是另一条管线，不与本地记忆系统混做；私有记忆与公共知识贡献是两条完全分离的数据管线。

## 现状盘点（2026-07-21）

项目里已有三个「记忆形状」的东西：

1. **Profile Context Memory**（`{project}/agents/{profile}/memory.md`，Task 68 体系内）：项目级 × profile 私有的自由文本；同目录还有 context.md（上下文选择）、generated.md（程序推荐）、`.nbook/context-access/`（程序私有信号）。profile 严格隔离：writer 不能读 leader 的 memory。
2. **Subject RAG**（simulation 域）：`events.jsonl`（经历流）+ `memory.jsonl`（稳定认知）+ 可重建 `subject-rag.sqlite` 索引。合同健康且已拍板独立，本任务不动。
3. **原始记录**（session JSONL、nb-history 操作日志、compaction）：是日志不是记忆；记忆应是从中蒸馏的结论，记忆系统不应做成日志检索。

按「作用域 ×归属」四格看，现状唯一被占的格子是价值最低的那格：

| | 共享（所有 profile） | profile 私有 |
| --- | --- | --- |
| 应用级（跨项目） | ❌ 不存在 | Global Profile Home 存在但只放 persona 资源 |
| 项目级 | ❌ 不存在 | ✅ `agents/{profile}/memory.md` |

「用户讨厌形容词堆砌」是应用级共享知识，「本书人名不用儿化音」是项目级共享知识——现状都只能落进单 profile 私有文件，writer 学到的教训 leader 永远看不到。

现状三个具体缺陷：

1. **生命周期冲突**：memory.md 住在 Profile Home 里，builtin profile reset 调 `ctx.home.clear()` 会连长期记忆一起清掉（记忆与可重置资源同目录同生命周期，结构性错位，Task 68 已知问题）。
2. **无写入纪律**：自由文本、无条目结构、无查重、无大小控制，可预见地退化为越写越长、新旧矛盾。
3. **无检索形态**：整文件注入或不注入，没有「索引常驻 + 按需取一条」的中间态。

## Decisions / Discussion

### 助手主张（2026-07-21 第一轮，待用户拍板）

1. **事实源边界排除式定义**（认为是最重要的一条）：NeuroBook 已有大量结构化真相源——世界事实归 lorebook、剧情结构归 Plot（Promise/Decision/brief）、角色主观记忆归 Subject RAG、操作历史归 nb-history。记忆只存「**跨会话仍有用、且没有更专门归宿的经验与偏好**」，大致三类：用户偏好与反馈（含被纠正的教训）、协作方式约定、项目层面创作约定（非世界设定）。写入工具提示词必须明确「设定进 lorebook、剧情进 Plot、不要进记忆」，否则必然出现双真相源漂移。
2. **归属：普通写作域默认共享**。profile 隔离服务的是信息控制（writer-safe），那条线由 Subject RAG / brief / handoff 承担；普通域 leader/writer 间记忆隔离只有「教训不互通」的成本没有保密价值。应用级与项目级都是共享池，profile 差异体现在**注入策略**（按 profile 过滤条目）而非存储归属。`agents/{profile}/memory.md` 废弃或降级为不承载长期记忆的私签。simulation/RP 域完全不进本体系。
3. **形态：文件事实源 + 索引常驻 + 按需读取，v1 不上 RAG**。一条记忆一个 markdown 文件（frontmatter：类型 / 一句话描述 / 时间）+ 索引文件（每条一行）常驻相关 profile 上下文，正文用现有文件工具按需读。解决「不知道记过什么」与 token 成本，实现成本接近零。规模大了再加派生检索索引（复用 Subject RAG 的 embedding 设置与「sqlite 可删可重建」模式）。文件形态连带收益：用户可读可编辑（写作软件的记忆必须可审查）、git 友好、**Task 112 State Root 备份天然全量覆盖记忆（云端零额外设计）**；跨设备记忆同步 / 共享记忆是另一个项目（`memory:*` 已占位）。
4. **位置与生命周期：搬出 Profile Home**。应用级 `Workspace Root .nbook/memory/`；项目级 `{project}/memory/`（用户可见区，性质更像 lorebook 而非缓存）。与 Profile Home 物理分离后 reset/`clear()` 天然碰不到记忆——用代码结构约束「以后不再犯」，而非在 clear 里加豁免名单的 hack。存量 memory.md 迁移或弃用。
5. **写入纪律：显式工具 + 用户可审查**。save / update / delete 显式工具，契约强制先查索引避免重复、更新优先于新增、写明为什么值得记。不做自动会话摘要式积累（slop 制造机）。远期可加记忆审查 UI（列表 / 编辑 / 删除）。

### 待用户拍板的分叉

1. **per-profile 私有记忆去留**：助手建议废除（普通域全共享）；或保留一格明确不算长期记忆的「profile 私签」。
2. **项目级记忆可见性**：`{project}/memory/`（用户可见，助手推荐）vs `.nbook` 下（隐藏）。
3. **写权限**：所有 profile 都能写共享池（助手倾向——教训往往在 writer 干活时产生，靠工具纪律与用户可审查兜底），vs 只有 leader 写。
4. **粒度**：一条一文件 + 索引（助手推荐，好删好改好查重）vs 单文件分节（简单但会退化成现在的 memory.md）。

四个分叉定案后即可写记忆系统合同文档；实施面很薄：目录约定 + 索引维护器 + 两三个工具 + 注入点改造 + memory.md 迁移。

### 方向更新（2026-07-22 第二轮，用户指示）

先做调研，再谈形态：明确当前记忆需求、制定评测体系，并评测两个候选开源引擎 **mem0**（mem0ai/mem0）与 **graphiti**（getzep/graphiti）。

用户明确当前要维护的三类记忆：

1. **世界引擎 subject 记忆**：现用 subject 的 `events` 与 `memory` 两个字段维护，目的是让故事中的角色有记忆。——注意：这把此前「Subject RAG 独立、不进本体系」的边界重新纳入了评测范围（要评统一引擎的可能性），第一轮主张 ① 的排除式边界随之待重审。
2. **用户记忆**：习惯、技巧、经验等（跨项目应用级）。
3. **llmlint 共享**：llmlint 与主应用共享记忆（具体形态调研中落实）。

调研产出：**`docs/research/memory-engines-mem0-graphiti.md`**（2026-07-22 完成）。内容：三类需求刻画（subject 记忆是**已实现的自研在位引擎**：events/memory 两层 + sqlite-vec RAG + memory.curator JSON Patch 收敛，不是空格子）、两候选引擎事实清单（mem0 2026-04 v3 转向 ADD-only + 检索端融合、图存储整删；graphiti bi-temporal 失效语义、Kuzu 弃用、Python-only）、基准之战不可采信的结论、需求×候选硬门槛对照（两候选均过不了 Portable Windows 零服务器门槛的完整体）、三种矛盾处理哲学对照（写时收敛 vs 读时排序 vs 失效标记保历史）、评测体系 B1/B2/B3（B1 subject 基准含**秘密泄漏率红线指标**）。

纸面倾向（待实测/拍板）：不引入引擎依赖、偷设计（graphiti 的失效语义进 SubjectMemory、mem0 v3 的检索融合进 subject_rag_search）；用户记忆维持文件式主张；llmlint 共享先拍访问形态（共享目录 / 实例 API / 云）。

### 评测执行拍板与 harness 建仓（2026-07-23）

用户拍板：**乙案，真跑 B1**，并把两个子拍板一并定了——评测代码落点 = **独立兄弟仓 `nb-memory-bench`**（沿用 nb-history/nb-workflow 模式）；语料来源 = **用户提供候选小说的若干章节**（可 LLM 提取事实或直接交给记忆框架，问题由 LLM 生成或用户提问，最终 LLM judge 判分）。用户给出「粉色头发转校生」模拟情景，点名两个关注点：**实体消解**（第一天公交上帮过的粉色头发女生 = 第二天自我介绍叫 A 的转校生）与**时间范围检索**（「第二天时粉色女孩是谁」不应包含第二天以后的记忆）。

harness 首版已建成（`nb-memory-bench` 首 commit `8a5da12`，typecheck + 3 离线冒烟测试全绿）：

- **评测体系定稿在该仓 README**（B1 真相源迁移至此）：探针改四类 recall / entity（实体消解）/ asof（时间点视角，考时间泄漏率）/ revision（认知反转，考陈旧率）；「秘密边界红线」在单视角剧情语料无对应维度，本轮暂缓。
- **污染控制内建**：每题跑裸模型直答对照（control），裸模型能答对的题标 contaminated，主指标剔除后计算——防知名小说「模型本来就背过」假召回。
- **时间双轨**：`tick`（harness 全序整数，判分权威）+ `time`（引擎可见的故事时间自由字符串）。
- **公平性合同**：答案统一由答题模型基于引擎检索片段生成（引擎只管检索）；引擎缺的能力（baseline 无 as-of 过滤）如实呈现不偷补。
- **baseline 引擎已接入**：主仓 `subject-memory.ts` 原样 vendor + curator 提示词照搬（子代理简化为单趟 JSON 调用）+ 检索口径照搬（events 6 / memory 4、cutoff 1.15、`topic: view` 切块）；sqlite-vec 换内存暴力余弦（数学等价，README 有 vendor 差异表）。
- **smoke 语料**：粉色头发情景手写 3 章 / 24 事实 / 10 探针，离线全管线回归用。
- CLI：`prepare extract` / `prepare probes`（LLM 草稿→人工校对定稿）与 `run`（摄入+答题+对照+判分+报告，产物落 `results/`）。

### B1 首轮跑分：baseline × 真实语料（2026-07-23）

配置按用户拍板：chat/judge/extract 统一 `mimo-v2.5-pro`（fufu.iqach.top），embedding `Qwen/Qwen3-Embedding-4B` 2560 维（siliconflow）。语料：《转生反派萝莉，找茬魔法少女》前 8 章（`scripts/epub-to-corpus.ts` 从 epub 转化，全书 658 章）→ extract 194 条事实草稿 → 人工校对定稿 **158 条**（清除两处 LLM 把南小风视角段编造成主角亲历的污染，共 36 条；extract prompt 已补视角切换防线）→ probegen 18 题草稿 → 人工校对定稿 **17 题**（删 1 题金标支撑全在污染段；修 asof 金标含未来信息等 6 处）。

**baseline 首轮结果**（`nb-memory-bench/results/fanpai-loli/baseline-facts/`，摄入 158 条 = 27 次 LLM / 132 秒，检索 p50 113ms）：

| 探针 | 结果 | 诊断 |
| --- | --- | --- |
| recall 6 题 | 全对 | 检索面基本功扎实 |
| entity 4 题 | **全对**（天蓝色少女=风信子、代号=真名南小风等） | curator 实体消解真实工作，memory 条目正确带 aliases「天蓝色的魔法少女」 |
| asof 5 题 | 泄漏率 20%（p012 把「变身后抵触消失」漏进变身前视角） | **无 as-of 过滤的铁证**：events 全时间线混检索；且自由字符串 time（「早晨」）无法让答题模型自行裁剪——prompt 层兜底不可行，必须引擎层过滤 |
| revision 2 题 | 陈旧率 50%（p017 答「有信心压制风信子」，实际认知是「借外力、经验远不如」） | **双层失守**：curator 没把 f127/f129 的实力自知蒸馏进任何 topic；events 检索被胜利叙事挤占。且 dump 显示「墨丘利秘典」topic 仍残留「后悔不安」与「反派魔法少女」topic 的「抵触消失」互相矛盾——**写时收敛的跨 topic 一致性盲区实证** |

评测方法论修正（已落 harness）：「不知道/还没有」型金标的 asof 题，裸模型答「不知道」撞金标造成污染假阳性 → `Probe.goldIsNegative` 豁免标记。豁免后真实污染 3/17=17.6%（p002 契约内容——书名即剧透；p011/p016 态度题可由书名推断），提示这本书对 mimo 有一定参数记忆暴露，多引擎对比时污染剔除逻辑必须保持。

**给「偷设计」清单的实证支撑**：① `subject_rag_search` 加时间过滤参数（graphiti 图纸）——p012 铁证；② 检索加 BM25/关键词融合（mem0 v3 图纸）——p013 中 f109 含「代号」字面却未被语义检索召回；③ curator 增加跨 topic 一致性收敛与「短期事件勿入 view」的执行强化——dump 实证「风信子」view 膨胀成战斗流水账。

### B1 第二轮：四引擎对比跑分（2026-07-23/24，M2+M3+M4 完成）

按 [PLAN-b1-engines-compare.md](./PLAN-b1-engines-compare.md) 执行完毕。语料扩至**前 20 章 / 338 条定稿事实 / 31 题**（新章校对又删 76 条视角污染——第 9/11/13/16 章有大段南嘉鱼/南小风视角，extract 防线仍需人工兜底）；mem0（node 进程桥，better-sqlite3 不能在 Bun/Windows 装载）与 graphiti（Python stdio 桥 + Neo4j 5.26 本机 zip）接入完成，`mem0-tickfilter` 变体（adapter 层批级 tick 后过滤，明标非引擎能力）同场。对照表真相源：`nb-memory-bench/results/fanpai-loli/compare.md`。

| 引擎×模式 | recall | entity | asof | revision | 时间泄漏率 | 陈旧率 | 摄入耗时 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| baseline（facts） | 87.5% | 77.8% | 50.0% | 33.3% | 11.1% | 0.0% | 886s |
| mem0（facts） | 87.5% | 88.9% | 33.3% | 33.3% | **33.3%** | 20.0% | 386s |
| mem0-tickfilter（facts） | **100%** | 55.6% | 50.0% | **100%** | **0.0%** | **0.0%** | 337s |
| graphiti（facts） | 37.5% | 62.5% | 25.0% | 0.0% | **0.0%** | 20.0% | 892s |
| mem0（raw） | 37.5% | 55.6% | 28.6% | 40.0% | 22.2% | 40.0% | 287s |
| graphiti（raw） | 42.9% | 44.4% | 0.0% | 0.0% | 11.1% | 40.0% | 936s |

**五条结论**（细节与错题分析见评测仓 results/）：

1. **mem0-tickfilter 是本轮最大发现**：读时排序哲学 + 一个便宜的 tick 后过滤 = 泄漏 0 / 陈旧 0 / recall 与 revision 满分。「`subject_rag_search` 加时间过滤参数」这张偷设计图纸从「有据」升级为「实测有效且高杠杆」。
2. **mem0 相对 baseline 没有正确率优势**：facts 模式 recall/entity 同档（entity 88.9 vs 77.8 在方差内），但无时间过滤时泄漏 33.3% 是 baseline 的三倍；唯一实质优势是 ADD-only 摄入快 2.3 倍。且**摄入方差大**：同配置两次独立摄入，entity 在 88.9% ↔ 55.6% 间摆动（LLM 蒸馏非确定性，库内容每次不同）。
3. **graphiti 在本配置（mimo + 中文 + 第一人称事实流）不可用级别**：图抽取偏「实体-关系」结构，系统性丢弃描述性/状态性事实（外貌、价格、账号名），recall 37.5%；bi-temporal 原生 as-of 真实工作（facts 泄漏 0%）但被抽取覆盖率拖死（asof 正确率仅 25%）；raw 模式下 valid_at 抽取质量降级，泄漏回升 11.1%。另有实体消解不稳（「叙述者/叙事者/我」三种指称并存）、偶发因果幻觉、摄入最贵（多阶段抽取 + 需 Neo4j 常驻 + mimo 偶发把 schema 原样回显需重试）。
4. **raw 模式全面差于 facts 模式**（两引擎一致）：整章交给引擎自带抽取丢信息严重——支持主仓现行「agent 抽好事实再上报」的用法。
5. **baseline 弱点画像不变但更清晰**：泄漏 11.1%（无 as-of）、扩语料后「答不知道」型漏召回显著（字面词如账号名/道具名未被纯语义检索召回）——BM25/关键词融合图纸再添实证；revision 33.3% 提示 curator 蒸馏与跨 topic 收敛仍是短板。

**拍板建议（待用户确认）**：维持「不引依赖、偷设计」路线，且优先级由实测排序——① `subject_rag_search` 加时间过滤参数（tickfilter 已证高杠杆）；② 检索加 BM25/关键词融合（漏召回主因）；③ curator 跨 topic 一致性收敛（revision 短板）。mem0/graphiti 引擎本体均不引入：mem0 无正确率优势且摄入不可复现，graphiti 在中文+此模型档位不可用。

过程新增避坑（详见记忆文件与评测仓 README §5）：better-sqlite3 在 Bun/Windows 不可用→node 进程桥；mimo 网关对非流式请求也返回 `text/event-stream` 头→openai SDK 拒解析，node 侧要本地反代、Python 侧 httpx hook；Neo4j 官方源 CloudFront 地域封锁→走本机代理下载；graphiti SEMAPHORE_LIMIT=3 摄入 6.5min/episode，提到 10 后 20s/episode；mimo 网关有整段故障窗口，LLM 客户端重试需 10 分钟级耐力、桥内按错误类型分级退避。

### 第三轮：episode / 图 / 主体注册表形态（2026-07-26）

用户在 B1 结论之上提出目标形态，助手回应后收敛如下。

**用户提案**：

1. 采用认知科学与 graphiti 的命名（episode 等）。episode 层对两个域（知识库/剧情、agent memory）都必须；图可选构建，agent memory 通常不需要图。
2. baseline 的语义层其实是「有节点无边」的退化图，因此难做实体消解（节点「粉发女孩」与「小雪」被当两个无关主体）。核心理念：**保持图的节点，精简**——按类型定义关键主体（势力、人物、有状态的物品、特殊物品，参照 World Engine subject 定义）参与消歧；次要主体只参与检索。
3. 批评 graphiti 消歧成本（理解为 M×N 次 LLM 调用，主张优化成 O(新节点) 次：「LLM 能在一张简单小图上完美新增一个节点」）。
4. fanpai-loli 图谱观察两条：确定事实（如「秘典安排今日任务」）不该进图，走 facts/events 更好，可大幅缩图；「定身陷阱」节点滚动式 summary + 苏天晴↔定身陷阱双边冗余、且看不出实体本身是什么——偏好「节点属性」式设计（节点里存这个东西是什么）。

**助手回应要点**：

1. **收敛判断**：用户拼出的「关键主体注册表 + 状态 + episode」正是 World Engine 数据模型（类型化 Subject + slices/patches + 时间轴）在记忆域的重现；subject 类型词汇（势力/人物/有状态物品）与 World Engine Zod schema 同源。
2. **episode 精确化**：agent memory 域**不新建 episode 存储**——session JSONL 就是 episodes，记忆条目带出处链接即可；episode 作为独立存储只在剧情/KB 域需要。episode 层的核心价值 = 语义层成为**可重建派生物**（B1 实证：mem0 同配置两次摄入 entity 88.9↔55.6 摆动——无 episode 层则语义层不可复现、不可 A/B）。tick 提为一等公民命名。
3. **边的下场**：facts 写入时归一化到 subject ID 之后，**边不需要作为存储对象存在**——一条 fact 标了两个 subject ID 就是一条边，关系查询 = 按 ID 对查 facts。图塌缩为「注册表 + 倒排索引」，边是派生视图。实体消解由此重新定位：**不是图算法问题，是写入时的 ID 归一化问题**（每 episode 一次「抽取+归一」联合调用，注册表全量进上下文，百级主体轻松放下）。
4. **M×N 修正**：graphiti 实际实现是 hybrid search 拉候选短名单 + 每个新实体（新版 batch）一次裁决调用，调用量本就 ~O(新实体)，不是 M×N。真正的病是**判据质量与静默失败**：候选靠模糊检索（漏真候选→凭空多实体，B1「叙述者/叙事者/我」三分身实证）、裁决判据是滚动 summary（漂移）、错误合并无声且永久。小注册表方案赢在可靠性而非成本：全量封闭小世界进上下文（消灭候选召回问题）、判据 = 策展本体描述（消灭漂移）、合并 = 显式可审查事件（消灭静默失败）。用户第一点结论保留，罪名从「太贵」改「不可靠」。
5. **判据替换**：「确定 vs 可能变」→ **happening vs state**。happening（发生过的事，tick t 发生、作为历史永真、永不失效）→ facts 层 append-only；state（当前状态/关系，有有效期语义）→ 状态层。graphiti 把两者都揉进 edge+bi-temporal，图被冻结的 happening 撑爆——用户观察到的图膨胀根源。happening 分流走 facts 后，图（注册表+状态）自然精简。
6. **滚动 summary 设计目的解读**（回答用户直问）：① 检索锚点（node summary 被 embedding，实体中心查询可召回节点）；② 消解判据（新 mention 的裁决上下文）；③ 免 schema 兜底（默认管线无类型，散文 summary 是无类型容器；graphiti 的 opt-in entity_types 就是用户偏好的类型化属性设计，与 WorldSubject+Zod 同构）。双边并存 = 每条关系陈述独立成边 + 刻意不做「购买⇒拥有」蕴含推理。该偷的形态：注册表节点 = **类型 + aliases（带 tick）+ 一行本体描述（显式更新，curator 触发，不随 episode 自动滚动）+ 可选类型化属性**；活动流水留在 facts 按 ID 查。本体描述不是装饰——它就是消解调用的判据材料。
7. **alias 合并带 tick**（助手强烈主张）：「粉发女孩=小雪」是 t=5 才成立的知识；注册表记「t≥5 已知同一人」，as-of 查询在 t<5 视作两实体。graphiti 全局合并与 baseline 永不合并在 as-of 视角下都错；带 tick 的 alias 事件两个都修。Subject RAG memory.jsonl 的 aliases 字段（艾琳娜例子）已在手工做此事，现升格为正式机制。
8. **次要主体**：不注册、不消解，作为字面文本留在 facts 靠 BM25/关键词召回（恰落偷设计②射程——账号名/道具名 B1 实证漏召回的就是它们）；需设计次要→关键升级路径（注册后从 episode 重放补归一——episode 层再次兜底）。

**第三轮新分叉（作为 spike 工作假设进入验证，spike 结果反哺拍板）**：

- **A** 剧情域状态层：复用 World Engine 存储 vs 记忆系统自带轻量状态层（助手荐后者起步 + 类型词汇同源 + 显式「注册表→WorldSubject」导出桥；理由：拆书发生在 World Engine 初始化之前，摄入期模糊中间态不适合直接灌进带 schema 校验的模拟引擎）。
- **B** alias 消解是否带 tick（助手强烈荐带，as-of 正确性前提）。
- **C** happening/state 二分是否采纳为 facts 层/状态层分界判据（助手荐采纳）。

### Spike 立项（2026-07-26）

用户拍板：按第三轮形态做**自研记忆框架 spike**，持续迭代优化，最终产出「spike 探索期间架构不断优化重构的库」。计划见 [PLAN-spike-memory-framework.md](./PLAN-spike-memory-framework.md)（Goal / 工作假设 / 架构草图 / 里程碑 S0-S5 / 迭代纪律）。评测面复用 `nb-memory-bench`，nb-memory 作为新引擎 adapter 同场对比，验收基线 = mem0-tickfilter 的 B1 成绩。

### Spike 结论（2026-07-27，S0-S5 完成）

`nb-memory` 库建成（sibling 仓，公开 API 合同见其 README，决策考古见 `docs/adr/0001~0003`）。B1 同题集对照（fanpai-loli，facts 模式）：

| 指标 | nb-memory | baseline（主仓 subject 等价内核） |
| --- | --- | --- |
| entity | 76.3%（19 题双跑均值，单跑峰值 94.4%） | 68.4% |
| **时间泄漏率** | **0%（跨全部 11 跑）** | 22.2% |
| asof | 71–100% | 57.1% |
| 摄入成本 | 22 次 LLM / ~3 分钟 | 57 次 / 21 分钟 |
| 分身（同实体拆多主体） | 0 | 存在 |
| revision | 37.5%（未达标，见下） | 40% |

**分叉 A/B/C 判定**（详见 ADR 0003 六条工作假设逐条）：**A 证实**（轻量自带状态层可行，World Engine 导出桥无需求未做）、**B 证实**（alias 带 tick 是泄漏 0 的直接支撑，as-of 审计双跑无泄漏）、**C 部分证实**（happening/state 二分自洽、取代链可审计无跨 topic 矛盾，但 state 对 revision 问答的增益**未被 bench 证明**）。D/E/F 亦证实：边作派生视图可行、写入时归一化 22 次调用完成消解、关键主体注册表稳定收敛 7–15 个。

**S3 未达标的诚实归因**：病灶在①状态检索命中率（问「经济来源」而状态名「生计来源」召不回；无关状态因字面含主体名挤位）②评测分辨率（revision 计分题仅 8–11 道、污染率 6.3–18.8% 摆动，单跑散布 25–75%，<20pp 改动无法辨识）。用户拍板停止刷分、记录现状收口，优化留正式实现阶段。

**方法论沉淀**（跨任务通用）：跨题集分数不可比（旧门槛须同题集复测才作数）；单跑数字不可信（同配置 entity 两跑差 33pp）；裁决协议 = 扩题量 → 双跑均值 → 同题集对照；判卷方差与摄入方差需分开归因。

### 正式实现第一轮：双时间轴 / 持久化 / 查询计划（2026-07-31 ~ 08-01）

用户拍板「按这个方向持续设计并优化 nb-memory」。本轮四块改动全部落在 sibling 仓 `nb-memory`（决策考古见其 `docs/adr/0004`、`0005`）。

**① 视角与知识边界（ADR 0004）。** 把「视角」拆成叙述视角 / 知识边界 / 称呼视角三层，确立核心判断：**as-of tick 本质上是一个降维成一维的知识边界**——「t=5 时我还不知道她叫艾琳娜」和「C 不知道 A 私下告诉 B 的事」是同一类约束，前者沿时间轴、后者沿人际轴。推论：任何把多视角搬进库内的方案都会把 as-of 从一维扩到二维，让全部正确性论证作废。据此拍板 D1 一库一视角（不加 `perspective` 维度）、D2 知识边界留摄入侧、D3 抽取策略参数化、D4 库内只加事实可信度标记。识别出唯一必须进库的缺口：**上帝视角下 fact = 真相，角色视角下 fact = 见闻，而见闻可能是假的**。

**② 双时间轴（ADR 0005 T1-T8）。** 按用户指示对齐 graphiti 双时间：`tick` 保留为摄入序（永远单调，仍是知识边界权威），新增可选 `instant`（bigint 秒，故事时间，**可回退**）。倒叙章节 tick 递增而 instant 后退，这是必须双轴的直接理由。`asOfTick` 与 `asOfInstant` 两轴独立同为 AND，各自回答不同问题；别名 / ontology / state 有效区间全部双轴。Calendar 不进库走宿主注入（bigint 与 World Engine 日历内核同构，便于后续抽出独立包）。

一个自查发现的真实缺口：**双轴形态建好后，主摄入路径一条 instant 都写不进去**——消解产出的登记、别名、状态提案全只有 tick。补法是引擎从本批事实推导（模型不知道世界零点的秒数，不该问它要）。

**③ 向量持久化（ADR 0005 S1-S7）。** 用户指出「向量全在内存是重大缺陷」。深入调研后**没有照抄主仓**：主仓其实有两套方案且取舍相反——`subject-rag-index` 是 sqlite-vec + 4× 超采后截断（近似过滤），`world-engine` 是 BLOB 列 + SQL 前置过滤 + 内存精确余弦。**后者才是本库需要的形态**，前者的超采截断正是 as-of 泄漏的经典来源。

关键论证：本库查询几乎永远带过滤，先过滤再暴力扫描的成本正比于**存活集**，而 ANN 无论怎么过滤都要扫全图——**成本模型是反的**。真正的瓶颈从来不是 ANN，是每次 open 都要把全库重新嵌入。

红线：**下推谓词只能放宽，不能收紧**。SQL 只减少读回行数，权威判据只有一份 `passesFilter`，由差分测试（5 查询 × 21 组过滤组合逐位比对）钉死。

嵌入时机采用混合：默认录入时嵌入，`deferEmbedding` 下只落库、由 `backfillVectors` 补齐；**字面路不需要向量，所以降级时检索仍可用**，但 `stats().pendingVectors` 如实暴露降级状态。

**④ 查询计划（ADR 0005 P1-P7）。** 补上多跳断点：现有 `search` 的主体锚点来自「问题文本里字面提到的主体」，「昨天遇到的女孩」没有专名就断了。用 JSON 计划而非检索 DSL（模型天生会输出、可缓存可回放**可评测**）。三种产出方式共用同一份 schema：启发式（零 LLM）/ 便宜模型（方案 B，注册表快照是其指代消解天花板）/ 手写。执行计划零 LLM，规划失败一律降级并如实返回 `degraded`。

刻意的限制：**tick 不是时间**，日历表达只在有 instant 时解析，否则记入 `unresolved`，绝不硬映射成 tick 窗口。

**顺带修掉的三处真实问题**（都不是本轮引入的）：门面每次检索对同一个 query 调 **10 次** embedding；SQLite wrapper 每次调用新 prepare 且从不 finalize（丢语句缓存 + Windows 下句柄不释放）；`subjectTypes` 首版把类型约束寄生在 `subjectIds` 上被补充召回整体覆盖（已改用 `subjectGroups` all-of 语义，只增不覆盖）。

**可回馈主仓的三点**（本轮调研查证，非推测）：
1. `server/agent/tools/subject-rag-index.ts:135,141` 的 4× 超采后截断是近似过滤，该数据规模下换成 exact filter-first 更正确且不更慢。
2. `server/world-engine/world-engine.service.ts:526-549` 查询时嵌入**没有写回**——`updatePatchVector` 全仓只在 `:451` 的 `vectorize()` 里调用一次，于是每次 `searchText` 都在重嵌同一批行。没有写回的 lazy = 每次全价重算。
3. `subject-rag-index.ts:391` 换 embedding 模型直接报错要求删库，可改成渐进重嵌（对缓存合适，对记忆不合适）。

**评测环境事故与处置**：回归跑分时答题阶段被 `chat HTTP 400`（空 body）中断，摄入好的 338 条事实全废。诊断确认是**网关侧偶发故障**——完全相同的请求连发 20 次有 9 次失败（45%），与本轮改动无关。harness 修两处：空 body 的 400 归入可重试（真参数错误一定带 body，足以区分）；这类抖动用固定 400ms 重试而非指数退避（退避是为缓解过载而设，随机故障不需要缓解，用退避会把一次抖动放大成一分多钟干等）。

### 第一轮回归评测与失败归因（2026-08-01）

完整报告在 sibling 仓 `nb-memory/docs/reports/2026-08-01-round1-regression.md`；跨引擎台账在 bench `results/fanpai-loli/compare.md`（不入库）。

跑 1（`2026-08-01T03-01-47-109Z`，fanpai-loli / facts / 48 题）对照 S5 收口版基线（07-27T02-42）：

| 指标 | 基线 | 本轮 |
| --- | --- | --- |
| recall / entity / asof / revision | 75.0 / 84.2 / 75.0 / 25.0 | **85.7** / 84.2 / 75.0 / **60.0** |
| as-of 泄漏率 | 0.0% | 0.0% |
| revision 陈旧率 | 41.7% | **16.7%** |
| 检索 p50 | 519ms | **108ms** |

**三条必须一起读的限定**（写在这里是为了防止后来者把这组数字当成能力提升的证据）：

1. **新增四项里只有向量持久化真正进了评测路径。** bench adapter 走 `memory.search()`，所以查询计划（`executePlan` 一次没被调用）与 `ingestRaw` 这轮**零覆盖**，`instant` 轴在本语料上也没有数据来源。上表说明的是「没弄坏」，不是「新增带来了改善」。
2. **单跑不构成判据**（ADR 0003 方法论）。revision 只有 10 道计分题、asof 只有 4 道，历史单跑散布 25–75%；recall 的 +10.7pp 只相当于一道题。
3. **跑 2 未完成**：摄入正常（338 条 / 23 次 LLM / 290s），答题阶段遇 mimo 网关整体下线（503「没有可用的内网节点」）中止。守候任务自动重启的那一跑摄入耗时 2.75 小时且 6 批联合消解失败，答题阶段再次耗尽预算——即便跑完也不构成干净的方差对照。

**换 DeepSeek 答题重跑（08-01T13-22）**。mimo 网关持续不可用，用户指定改用项目配置里的 `deepseek/deepseek-v4-flash` 作答题与判卷模型（embedding 端点未动）。**口径与历史跑次断裂**——公平性合同只在同一答题模型内部成立，这不是跑 1 的方差对照。结果：recall 75.0 / entity **89.5**（历史第二高）/ asof 62.5 / revision 50.0，泄漏 0.0%，陈旧率 25.0%，检索 p50 134ms。

**这一跑真正重要的不是正确率，是污染率 16.7% → 2.1%。** 污染题 = 裸模型不看检索片段也能答对的题（模型自带原著先验），对记忆库没有区分度、主指标里剔除。DeepSeek 对这部作品几乎无先验（48 题只污染 1 题），**有效样本量接近翻倍**：asof 计分题 4 → 8、revision 10 → 12。这直接抬高了评测的统计分辨率——**比扩题集更快地缓解了 ADR 0003 记的「分母太小、单跑无裁决力」这个长期限制**，建议后续评测固定用先验知识少的答题模型。同时 **as-of 泄漏率 0.0% 在计分题翻倍后依然成立**，这个结论比之前更强。

**失败模式高度集中**：10 道错题里 8 道判词是「回答称无法确定」，只有 2 道是给出旧认知。**瓶颈几乎完全在召回**，不在时间语义、也不在答题模型的理解力。其中 p018「匿名账号叫什么」、p021「南嘉鱼是谁」、p037「猫娘兽人与风信子什么关系」三道全是主体识别盲区。

**当轮补上了这个缺口**（nb-memory `179042c`：`findSubjects.describedAs`）。ontology 版本链本身就是一条取代链，展平成带失效区间的索引条目（`source: "subject"`），as-of 语义因此完全由 `passesFilter` 承担——这条新路径上不另写时间判据。`describedAs` 只走语义路：字面路的价值是专名召回，而这里恰恰没有专名，CJK bigram 会让「银发的剑士」和「戴兜帽的陌生人」因共享一个「的」互相召回；**解主体对错解的容忍度远低于普通检索，解错会把后续整跳锚到错误主体，比解不出更糟**。顺带修一处既有不一致：主体卡注入无视 `sources` 过滤。79 pass / 0 fail，typecheck 绿。**但它尚未接进评测路径，效果未量化**——靶子已明确（p018 / p021 / p037）。

**唯一可硬归因的改善是检索 p50。** 不依赖判卷，且原因追到一处确定的代码事实：门面每次检索把主查询拆成约 10 个子查询，修复前每个子查询各自嵌入一遍同一段文本，现在一次 `embedQuery()` 复用；差值约 410ms 与 9 次多余的 embedding 往返一致。

**失败归因（5 题，逐题回库转储核对目标是否存在）分出三类根因，无一在时间层**——as-of 泄漏率 0.0% 跨全部历史跑次继续保持：

| 题 | 根因 | 目标在库中？ |
| --- | --- | --- |
| p042 | 检索未命中（目标就在相邻 tick，措辞不匹配） | 在 |
| p044 | 取代链选环错误：召回了链上最新一环，而那一环的 view 跑题（写成粉丝数，不含可见性） | 在 |
| p017 | 抽取漏抽 | **不在** |
| p037 | 主体识别失败（见下） | 在 |

**p037 用离线实验钉死一处结构性缺口。** 在已落盘的库上跑三组对照（零 LLM，只付一次 embedding）：现状 `search()` 15 条**未命中**；把主体钉成南嘉鱼后第 4 位就是答案；主体对查询（`subjectGroups` all-of）7 条里第 4、5 位都是答案。**只要主体解对，答案就在 top-5**——缺的只有把"学校认识的猫娘兽人"这句描述解析成主体 id 这一环。

而主体识别的唯一实现是 `SubjectRegistry.mentionedIn()` 的一行 `text.includes(name)`，**查询侧不含专名时整条主体锚定路径失效**。`findSubjects` 只能按结构解（时间窗 / 类型 / 共现）补不上；主体卡也不在索引里（只在检索后由 `subjectCards()` 注入），`sources: ["registry"]` 检索返回空。这同时是 ADR 0003 记的 p018「反向专名题」钉子户的病根。已登记为 ADR 0005 未决 #5，候选做法是把主体卡纳入索引 + `findSubjects` 增 `describedAs` 分支，**零 LLM、只多一次 embedding**。

**harness 又修一处**（`1cea381`）：抖动重试与整段故障重试改用独立预算。两种故障交替出现时共用一个计数器，中间插进来的一次 400 抖动会把退避阶数按回低位，整段故障的等待预算在几秒内被短延迟耗光——这正是跑 2 作废的直接原因。现在抖动 15 次固定 400ms、整段故障 20 次指数退避（约覆盖 30 分钟），预算按「单跑 50 分钟」的代价定。**未修**：答题阶段单题失败仍会中止整跑（没有断点续跑），修它要动 `AnswerRecord` 类型与报告口径、引入「未答题」新分母，会伤害与历史跑次的可比性。

### 第一轮收口（2026-08-01 ~ 08-02，已结束）

用户拍板两个分叉后开工，计划与全过程见 [PLAN-round1-closeout.md](./PLAN-round1-closeout.md)：

- **describedAs 接入方式**：先按用户拍板走 `search()` 内兜底，**验证为负**——描述索引要的是「指代短语」，灌整个问句会被句中另一个实体带偏（实测：「学校认识的猫娘兽人」第 1 位解对，整句解出的却是风信子/白貂精灵）。抽短语这步绕不过去，而它正是规划器的职责，遂改走原选项 1（补规划器 + `--planner llm`）。
- **收口边界 = nb-memory 库收口**，主仓集成不在本轮。

**成果**：

1. **机制确证**：p037「猫娘兽人与风信子什么关系」wrong → correct，规划器抽出「学校认识的猫娘兽人」解出南嘉鱼；有零 chat 的离线实验独立佐证，不依赖判卷。p018 也翻转，功劳是顺带修掉的**主体卡注入缺陷**（卡是上下文注入而非被检索的层，先前让它跟随 `sources` 过滤，规划器给个 `sources:["state"]` 就把答案所在的卡丢了）。
2. **新基线**：DeepSeek `off` 双跑均值 recall 68.8 / entity 81.6 / asof 74.1 / revision 45.0，泄漏 **0.0%**，检索 p50 120ms。
3. **摸清了评测的真实分辨率**（本轮方法论上最重要的收获）：**entity 双跑散布 15.8pp**，而 ADR 0003 记的 mimo 时代是 5.2pp；asof 更是 23.2pp。散布来自**摄入 + 答题 + 判卷三重随机性叠加**，其中摄入最根本——两轮抽取出的 registry/state 不同，等于在两个不同的库上答题。**推论：10pp 以内的单跑差异一律没有裁决力**，此前若干「改善」据此要按噪声重读，「DeepSeek 污染率 2.1%」也修正为均值约 5%。
4. **跨全部 5 跑唯一稳定的结论：as-of 时间泄漏率 0.0%**，在计分题数、答题模型、检索路径都变过的情况下依然为零。

**决定**：`--planner llm` 不作默认路径（确定的检索 p50 涨 60 倍 + asof 有退化嫌疑 + 其余指标测不出差异），保留为可选开关；基线用 `off`。批次 B（`describedAs` 相似度下限）按「数据不足以验证」主动跳过并留档。

## TODO / Follow-ups

- [x] ~~用户拍板评测执行方式~~：已定乙案真跑 B1；harness 落独立仓 `nb-memory-bench`（2026-07-23 首版建成）。
- [x] ~~语料与模型配置~~：已定《转生反派萝莉，找茬魔法少女》前 8 章 + mimo-v2.5-pro + Qwen3-Embedding-4B；baseline 首轮跑分完成（见上节）。
- [x] ~~执行 [PLAN-b1-engines-compare.md](./PLAN-b1-engines-compare.md)~~：M2/M3/M4 全部完成（2026-07-23/24，见「B1 第二轮」节）。
- [x] ~~执行 [PLAN-spike-memory-framework.md](./PLAN-spike-memory-framework.md)~~：**S0-S5 全部完成（2026-07-27）**，产物 = sibling 仓 `nb-memory`。结论见上节「Spike 结论」，逐轮跑分与错题分析见 PLAN §7 与 bench `results/fanpai-loli/`。
- [x] ~~第三轮分叉 A/B/C 以 spike 验证~~：A/B 证实、C 部分证实（详见 ADR 0003）。
- [ ] **用户拍板主仓 subject 侧路线**（spike 已给出裁决依据）：① 换用 nb-memory（vendor 进仓，泄漏 0/成本 1/7/分身 0 全面优于在位内核）；② 在位内核原地移植偷设计三项（时间过滤优先——泄漏 22.2%→0 是最大单项收益）。
- [ ] 遗留优化项（正式实现阶段做，非 spike 债）：~~主体识别只有字面包含一条路~~ **已实现并经评测确证**（`findSubjects.describedAs` + 规划器抽短语，p037 靶子翻转）；**混合策略**（仅在字面路解不出主体时才升级到规划器，把 60 倍检索代价限制在需要的查询上）；`describedAs` 相似度下限（p021 是「把署名当描述」的解错实例）；规划器把「署名/代号」误当描述；状态检索命中率（topic 归一化 / 当前状态清单注入）。
- [x] ~~把查询计划接进 bench 评测路径~~：已接 `--planner llm`（默认 off，保留 `search()` 对照）。结论是不作默认路径。
- [x] ~~**提高评测分辨率**~~：--reuse 对照实验做了，**噪声大头是答题+判卷而非摄入**（§5e 推翻 §5d）。--reuse 的真实价值是省掉 37 分钟摄入（13 分钟 vs 80 分钟）。**固定污染集**才是降噪的正确方向——已用 3 轮投票标定 probes.jsonl，分母从此固定（p028 一题，污染率 2.1%，不再每轮浮动 2.1%-12.5%）。
- [ ] 评测工具：答题时把生成的查询计划一并落盘（本轮遗漏）；断点续跑；判卷多次投票降噪。
- [ ] 用户拍板 llmlint 共享的访问形态：共享目录 / 实例 HTTP API / 云服务（远期）。
- [ ] 用户拍板第一轮四个分叉（私有记忆去留 / 项目级可见性 / 写权限 / 粒度）——用户记忆文件式形态若维持，这四叉仍然有效。
- [ ] 定稿后撰写记忆系统合同文档（建议落 `reference/agent/`），补本任务 Goal 与实施计划；若采「偷设计」路线，subject 侧改造（SubjectMemory 失效语义、subject_rag_search 检索融合）单独排批次。
- [ ] 存量 `agents/{profile}/memory.md` 的迁移 / 弃用方案。
- [ ] Profile Home reset 与记忆生命周期分离的落地（呼应 Task 68 已知问题）。
- [ ] 远期另立项：跨设备记忆同步 / 共享记忆服务（Passport `memory:*` scope）、记忆审查 UI。
