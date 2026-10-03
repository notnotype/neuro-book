# 记忆引擎调研：mem0 vs graphiti（Task 113 第二轮）

> 日期：2026-07-22。归属：根 Task [113-memory-system](../../../../.agents/tasks/113-memory-system/README.md)（讨论中）。
> 取证方式注记：当日子代理与 WebFetch/WebSearch 通道因推理网关故障不可用，全部调研在主会话完成；外部事实取自两仓 README / 官方迁移文档 / 仓库目录结构（`gh api` 实查）与 Zep 官方博客原文，本仓事实取自代码直读。星数、版本等元数据均为 2026-07-22 实查值。

## 0. 结论速览

1. **三类需求不应由一个引擎通吃**。subject 记忆一格已有一个健康的自研在位引擎（events/memory 两层 + sqlite-vec RAG + LLM curator），候选引擎需要在实测中显著胜过在位者才值得引入。
2. **两个候选都过不了「Portable Windows 零服务器」硬门槛的完整体**：mem0 TS OSS 可进程内运行但没有任何持久化嵌入式向量库（要自写适配器）；graphiti 是 Python-only + 图数据库服务，嵌入式选项（Kuzu 已弃用、falkordblite 要 Py3.12+）在 Windows 上不可依赖。
3. 两家的公开基准数字互相矛盾且都是自报口径（§2.3），**不能作为选型依据**；要选型必须在我们自己的中文小说任务上跑（§4 评测体系）。
4. 纸面评测的当前倾向（待实测/拍板）：**不引入引擎依赖，偷设计**——从 graphiti 偷「失效标记不删除」的时序语义，从 mem0 v3 偷「检索端多信号融合」与「写入时带相关旧记忆做去重上下文」（后者 curator 已在做）；llmlint 共享是**访问形态**问题而非引擎问题。

## 0.5 修订记事（2026-07-24，B1 四引擎实测后）

B1 对比已实跑完毕（`nb-memory-bench` 仓，20 章 / 338 事实 / 31 题；对照表 `results/fanpai-loli/compare.md`，结论见 Task 113 README「B1 第二轮」节）。以下原文结论被实测修正：

1. **§0.2 / §2.1 / §3-G2「TS OSS 无持久化嵌入式向量库」已过时**：mem0ai@3.1.1 的内置 `memory` provider 已是 better-sqlite3 持久化实现（`dimension`/`dbPath` 可配）。但出现**新的等价障碍**：better-sqlite3 native addon 在 Bun/Windows 不可装载（oven-sh/bun#4290），NeuroBook 主进程要用仍需 node 子进程桥——G2 门槛结论（不能无条件进程内嵌入）实质不变，理由更换。
2. **新事实：mem0 OSS 的时间检索是商业墙**——`add({timestamp})` 与 `search({referenceDate})` 参数存在但直接抛错引导付费平台；OSS 无官方 as-of。评测中的 `mem0-tickfilter` 变体（adapter 层 tick 后过滤）证明该能力自己补极便宜且效果显著（泄漏 0/陈旧 0）。
3. **§4 评测执行设想（FalkorDB podman / REST sidecar）被实际执行取代**：本机无容器，graphiti 实际走 Python stdio 桥 + Neo4j Community 5.26 本机 zip；mem0 走 node stdio 桥。
4. **纸面倾向获实测支持并加强**：mem0 相对 baseline 无正确率优势（且 LLM 蒸馏摄入方差大，同配置两跑 entity 88.9%↔55.6%）；graphiti 在 mimo+中文+第一人称配置下 recall 仅 37.5%（图抽取丢描述性事实），不可用级别。偷设计三项按实测杠杆排序：时间过滤 > BM25/关键词融合 > curator 跨 topic 收敛。

---

## 1. 三类记忆需求（现状事实 + 需求刻画）

用户本轮明确的三类记忆：① 世界引擎 subject 记忆；② 用户记忆（习惯/技巧/经验）；③ llmlint 共享。

### 1.1 世界引擎 subject 记忆（simulation 域）

现状是**已实现的自研引擎**，不是空格子（代码实查）：

- **数据模型**（`server/agent/tools/subject-memory.ts`）：
  - `SubjectEvent {tick?, time?, text}` → `simulation/subjects/<id>/events.jsonl`，append-only 经历流。`time` 是「角色可理解的故事时间」**自由字符串**（虚构历法，不是真实 datetime）。
  - `SubjectMemory {topic(主键), aliases?, view}` → `memory.jsonl`，稳定认知集合，topic 查重唯一。
- **三个工具**（`server/agent/tools/subject-memory-tools.ts`）：
  - `subject_event_append`：校验后追加 events，标 RAG dirty。
  - `subject_rag_search`：sqlite-vec 向量检索，强制单 source（events 默认 limit 6 / memory 默认 4），归一化距离截断 1.15，无 embedding 配置时显式失败（不做关键词 fallback）。
  - `subject_memory_update`：上报 facts → 拉起 `memory.curator` 子代理 → 返回 RFC 6902 JSON Patch → 代码校验后落盘（2 次重试，失败转 needs_review）。**这就是 mem0 v2 式「抽取→与既有记忆比对→增改删」的两段式管线，只是收敛动作走显式 JSON Patch + 代码校验。**
- **索引**（`server/agent/tools/subject-rag-index.ts`）：`.nbook/subject-rag.sqlite`，vec0 虚表按 subject_path+source_type 分区；**JSONL 是事实源，SQLite 是可重建缓存**；embedding provider/model/dimensions 变更即强制重建；embedding 仅支持 openai-compatible `/embeddings` 端点（批 32、向量归一化）。
- **读路径**（`simulator.actor.profile.tsx`）：actor 零工具、零文件访问，记忆由外部流程检索后以 `<actor-sidecar-context>` 注入；`subject.md` 全知秘密档只给 simulator.leader，**秘密绝不进 RAG**（信息控制是硬合同）。

需求刻画（候选引擎必须满足的领域特性）：

| 特性 | 说明 |
| --- | --- |
| 故事内时间 | 自由字符串时间线（虚构历法），非真实 datetime；时序推理要按叙事顺序不是墙钟 |
| per-subject 隔离 | 每个角色一个记忆视图；跨角色泄漏=穿帮 |
| 秘密边界 | 全知档/soul.md 分层；检索通道不得把「角色不该知道的事」召回给 actor |
| 中文 | 语料与查询全中文 |
| 事实源可文件化 | git diff、State Root 备份（Task 112）、用户可直接读改 |
| 认知会反转 | 「误解→修正」是叙事常态，矛盾处理语义是核心而非边角 |

### 1.2 用户记忆（应用级习惯 / 技巧 / 经验）

第一轮盘点结论仍然成立（[Task 113](../../../../.agents/tasks/113-memory-system/README.md)）：规模小（几十~几百条）、单条价值高、必须**用户可审查可编辑**、跨项目、显式写入纪律优于自动摘要积累。目前这格是空的（现存 `agents/{profile}/memory.md` 是项目级 × profile 私有，且住在可被 reset `clear()` 清掉的 Profile Home 里）。

### 1.3 llmlint 共享

对用户表述「llmlint 共享」的解读（按账号轮已拍板的「私有记忆与公共知识贡献两条管线分离」）：**llmlint 与主应用共享同一份用户写作偏好/教训记忆**，而非公共规则库贡献（后者归 Passport Contribution 管线）。若解读有偏差需用户纠正。

llmlint 侧现状（`llmlint/web/prisma/schema.prisma` 实查）：

- 独立 Nuxt/Nitro 应用 + Prisma SQLite（`data.db`），自有 User 体系，与 neuro-book **零互通通道**。
- 可蒸馏为记忆的原料已经在库里：
  - `MachineScan.hitsJson`（规则命中）→ 按用户聚合 = **高频笔癖**（「该用户总犯 X 规则」）。
  - `Revision.transitionKind`（static_fix/llm_fix/user_fix）+ `DocJudgment.improvementScore` → **修复接受/拒绝偏好**；`user_fix` 手改差异是最强风格信号。
- 消费点：repair agent 的 prompt 组装（`web/server/agent/neuro-agent-harness/profile.ts` / `pi-runtime.ts`）与检测工作台。
- 需求本质：**记忆必须能被第二个应用进程消费** → 这是访问形态问题（共享目录 / 实例 HTTP API / 云服务），不是引擎选型问题。Passport spec 已预留 `memory:*` scope。

---

## 2. 候选引擎调研

### 2.1 mem0（mem0ai/mem0）

元数据（2026-07-22 实查）：61.5k stars，Apache-2.0，主语言 TypeScript（monorepo），当日仍有 push；最新 release `cli-node-v0.2.11`（2026-07-13）。公司主导（YC S24）。

**2026-04「新记忆算法」（v3）是重大转向**（README + `docs/migration/oss-v2-to-v3.mdx`）：

- **写入**：单趟 **ADD-only** 抽取——一次 LLM 调用抽全部新事实，**取消 UPDATE/DELETE 决策**；先取 top-10 相关旧记忆做去重上下文，MD5 精确去重，批量嵌入落库。旧算法（两次 LLM 调用：抽取+增改删裁决）被官方以「+20 分 LoCoMo、抽取延迟减半」的理由抛弃。记忆只增不改，**矛盾处理全部移到检索端排序**（「新旧并存，检索让最新最相关的浮上来」）。
- **读取**：语义检索出候选 + BM25 与实体匹配做 boost（不扩召回），三信号归一融合为单一 score；默认 top_k 20、threshold 0.1、rerank 关。查询路径零 LLM。
- **实体链接**：外部图存储（Neo4j/Memgraph/Kuzu/Neptune，~4000 行）**整体删除**，改为内置实体抽取 + 同向量库平行集合 `{collection}_entities`。
- **语言依赖**：实体抽取与词形还原靠 spaCy `en_core_web_sm`（Python extra；Py3.13 装不上）；TS 侧有自己的 `textLemmatized`。**全部英文中心**；缺 spaCy/fastembed 时优雅降级为纯语义检索。中文场景大概率只剩纯语义一路（官方无中文证据）。
- **作用域**：`user_id / agent_id / run_id` 三键 + metadata filters；「应用级/项目级/角色级」可以用键组合或分 collection 表达。
- **TS OSS 支持面**（目录实查，与 Python 基本平权）：25 个向量库（qdrant/pgvector/chroma/**memory(易失)**…）、18 家 LLM（openai/anthropic/deepseek/ollama/vllm/lmstudio/minimax…）、12 家 embedder、历史库 SQLite。**但没有任何持久化嵌入式向量库**（Python 侧有 faiss，TS 侧没有；chroma/qdrant 都要服务进程）——要在 Bun 进程内持久化必须自己实现 `base.ts` 向量库适配器（例如落到我们已有的 sqlite-vec）。
- **自托管 server**（`server/` 实查）：FastAPI + `pgvector/pgvector:pg17` docker compose，带 dashboard/API key/限流，默认开鉴权。= 一个现成的**跨应用记忆 HTTP 服务**，但代价是 Docker + Postgres。
- 成本：每次 add ≈ 1 次 LLM 调用 + 1 次检索 + 批量 embedding；search 零 LLM。
- 基准声称：LoCoMo 92.5 / LongMemEval 94.4——**官方自注「平台版含 OSS 没有的专有优化，OSS 用户别期待同样数字」**；评测框架已开源（mem0ai/memory-benchmarks，可借鉴探针格式）。

### 2.2 graphiti（getzep/graphiti）

元数据：29.0k stars，Apache-2.0，Python-only（要求 3.10+），v0.29.2（2026-06-08），当日仍有 push。Zep 公司主导，是 Zep 托管产品的开源内核。

- **模型**：时序上下文图谱。实体（带随时间演化的 summary）+ 事实边（三元组，带 valid_at/invalid_at 有效窗口）+ episode（原始数据，全部派生事实可溯源）。**矛盾事实标记失效、不删除**，可查「现在为真」与「任一时点为真」。这是对「角色认知反转」概念契合度最高的模型。
- **摄入**：每个 episode 走多阶段 LLM 管线（prompts 目录实查：extract_nodes / extract_edges / dedupe_nodes / dedupe_edges / summarize_nodes / summarize_sagas，另有合并版 extract_nodes_and_edges）——**每 episode 多次结构化输出调用**，靠 `SEMAPHORE_LIMIT`（默认 10）并发抵延迟，429 是官方文档专节处理的常见病。强依赖 structured output，官方明示小模型/宽松兼容端点会「输出 schema 错误、摄入失败」。
- **检索**：hybrid（embedding + BM25 + 图遍历）+ 多种 reranker（RRF/MMR/图距离为零 LLM；cross-encoder reranker 用 LLM logprobs，是可选项）。查询路径可做到零 LLM。
- **自定义本体**：Pydantic 实体/边类型（可定义 小说域 角色/地点/事件/关系），prescribed + learned 双模式。
- **作用域**：group_id 命名空间，可表达 per-subject / per-project 隔离。
- **后端现状**（README + driver 目录实查）：Neo4j 5.26 / FalkorDB 1.1.2 / Neptune+OpenSearch；**Kuzu 已弃用**（上游停维护，driver 带 DeprecationWarning 待移除）——嵌入式替代是 `falkordblite`（redislite 内嵌，**要求 Python 3.12+**）。零服务器部署在 Windows 上不可依赖（redislite 系历史上不支持原生 Windows）。
- **接口**：核心 Python 库；仓内 FastAPI REST server 与 MCP server（Docker + Neo4j 组合）。**OSS 无 TS/JS SDK**（TS/Go SDK 是 Zep 托管产品的能力）。
- Provider：OpenAI 默认；Anthropic/Gemini/Groq extra；任意 OpenAI-compatible baseURL 与 Ollama 走 `OpenAIGenericClient`（`structured_output_mode: json_schema|json_object` 两档）。
- 其他：默认开启匿名遥测（PostHog，env 可关）——本地优先产品里须默认关闭。
- 时间语义注意：bi-temporal 的 valid_at/invalid_at 是**真实 datetime**；虚构历法字符串无法承载，故事时间只能退化为摄入顺序或强行映射伪日期。

### 2.3 基准之战的教训

- 2025-04 mem0 论文自称 SOTA 胜 Zep；2025-05 Zep 发文《Lies, Damn Lies, & Statistics》反驳（实查原文）：指 mem0 错误配置 Zep 评测，自报 Zep 修正后 LoCoMo 75.14%，后又更新为「80% @ <200ms」。
- 2026-04 mem0 又发 92.5 的新数字，且明示平台版口径。
- 结论：**两家数字都是营销弹药，方法论互相指责，与我们的域（中文小说、虚构时间、秘密边界）零重叠**。选型只能靠自己的基准——这正是 §4 的存在理由。

---

## 3. 需求 × 候选对照（纸面评测）

硬门槛（G，不满足即该形态出局或降级为可选增强）：

| 门槛 | 现状自研 | mem0 TS OSS（进程内） | mem0 self-hosted server | graphiti（库/REST sidecar） |
| --- | --- | --- | --- | --- |
| G1 Bun/TS 进程内或 Portable Windows 可用 | ✅ | ✅ 进程内 | ❌ Docker+Postgres | ❌ Python 运行时 + 图数据库服务 |
| G2 零服务器持久化、事实源在 State Root 内 | ✅ JSONL+sqlite | ❌ 无持久嵌入式向量库（须自写适配器） | ❌ 数据在 Postgres | ❌（falkordblite 限 Py3.12+，Windows 不可依赖） |
| G3 openai-compatible baseURL | ✅ | ✅ | ✅ | ✅（structured output 质量另议） |
| G4 中文一等公民 | ✅（我们自己写提示词） | ⚠️ 实体/BM25 英文中心，中文退化纯语义 | 同左 | ⚠️ 抽取靠 LLM 理论可中文，无官方证据，BM25 分词存疑 |
| G5 用户可审查可编辑 | ✅ 明文 JSONL | ⚠️ 库内记录，ADD-only 会积累陈旧矛盾条目 | ⚠️ 有 dashboard | ⚠️ 图数据库内，需自建 UI |
| G6 per-subject 隔离 + 秘密边界 | ✅ 合同级 | ⚠️ 靠调用方纪律（filters） | 同左 | ⚠️ 靠 group_id 纪律 |
| 部署矩阵完整性（Portable+Docker 双模式都可用） | ✅ | ⚠️（适配器自研后可） | ❌ 仅 Docker 模式 | ❌ 仅 Docker/自部署模式 |

设计层对照（本轮真正的收获——三种矛盾处理哲学）：

| | 写时收敛（现状 curator） | 读时排序（mem0 v3） | 失效标记保历史（graphiti） |
| --- | --- | --- | --- |
| 矛盾处理 | LLM 裁决 patch，库内只有当前认知 | 只增不改，检索让新事实压过旧事实 | 旧事实标 invalid_at，历史可查 |
| 可审查性 | 最好（条目少而干净） | 最差（陈旧条目积累） | 好（但要理解时态） |
| 写入成本 | 高（curator 子代理往返） | 最低（1 次调用） | 最高（多阶段管线） |
| 「角色曾经误解过什么」 | ❌ 丢失 | ⚠️ 混在堆里 | ✅ 一等公民 |
| 失败模式 | curator 错删/错改 | 检索排序失灵时新旧打架 | 抽取失败污染图 |

纸面结论（待 §4 实测检验）：

1. **subject 记忆**：在位自研继续持有，值得偷两张图纸——① graphiti 的失效语义：`SubjectMemory` 增加「被取代/失效」表达（如 `supersededAt`/`supersededBy`），curator 从「替换 view」升级为「失效旧条目+新增新条目」，让「角色曾经的误解」可查（写手视角这是伏笔素材，不是垃圾）；② mem0 v3 的检索融合：sqlite-vec 语义候选之上加 BM25/topic 命中 boost（SQLite FTS5 即可，中文用 jieba/字级分词另议）。
2. **用户记忆**：两引擎在「几十条、高价值、必须可审查」的场景里都是负资产（mem0 ADD-only 积累脏数据，graphiti 杀鸡用牛刀）。第一轮「一条一 md 文件 + 索引常驻」主张维持。
3. **llmlint 共享**：先定访问形态再谈引擎。最薄可行通道（候选，待拍板）：(a) 共享目录——llmlint 读写 neuro-book 的应用级记忆目录（同机文件契约）；(b) 实例 HTTP API——neuro-book 暴露记忆读写端点，llmlint 作为客户端；(c) 云服务（`memory:*`，远期）。mem0 self-hosted server 只在 Docker 部署模式下是 (b) 的替代品，且把用户记忆事实源搬出 State Root，与 Task 112 备份契约冲突——不推荐为默认路径。

---

## 4. 评测体系（本轮制定的交付物）

原则（继承 llmlint 评测方法论）：指标先行、配对 lift、先建判别 harness 再谈优化；供应商基准一律不采信。

### 4.1 硬门槛清单（不跑分）

G1–G6 见 §3 表格，任何候选先过门槛再进基准；「部署矩阵缩水」（Portable 用户失去记忆功能）视同不通过。

### 4.2 基准 B1：subject 记忆（主战场）

- **语料**：中文故事事件流 100–300 条（真实项目模拟 run 导出，或按模板合成），带自由字符串故事时间、≥3 角色、≥5 条秘密边界事实（只有部分角色知道）、≥5 次认知反转（误解→修正）。
- **参赛方**：现状自研（baseline，`subject_rag_search` 原样）/ mem0 TS OSS（自写 sqlite-vec 适配器或内存库）/ graphiti（Python + FalkorDB docker，仅评测环境）。三方共用同一 LLM 与 embedding 配置。
- **探针四类**（每类 15–20 问，金标人工/半自动标注）：
  1. 事实回忆：「X 在事件 E 时做了什么」→ recall@k + LLM judge 正确率。
  2. 状态/关系追踪：「现在 X 对 Y 的态度」→ 正确率。
  3. 认知反转：反转后提问，返回旧认知记 **陈旧率**（越低越好）。
  4. 秘密边界：以角色 A 的视图提问只有 B 知道的事 → **泄漏率（红线指标，>0 直接出局）**。
- **成本与延迟**：摄入 token/事件、摄入墙钟、检索 p50。
- **判读**：候选替换在位者的条件 = 探针 1–3 显著 lift **且** 泄漏率为 0 **且** 部署矩阵不缩水；否则走「偷设计」路线。

### 4.3 基准 B2：用户偏好记忆（轻量）

- 30–50 条偏好/纠正散布进模拟会话，含 ≥5 次改主意。
- 探针：「当前应遵守的偏好」→ precision@k；改主意后旧偏好胜出记陈旧失败。
- 附加评审：把三方的最终记忆库明文导出给用户看——**可审查性是本场景一级指标**（预期 ADD-only 库最难看）。

### 4.4 基准 B3：llmlint 共享（架构验收单，不跑检索分）

跨进程读写可行性、两应用并发写安全、鉴权模型、Portable/Docker 双矩阵覆盖、llmlint 侧蒸馏任务（从 MachineScan/Revision 聚合出笔癖记忆）端到端跑通。

### 4.5 执行方式（开放问题，待用户拍板）

- **甲：就此纸面定案**。零成本；风险是 §3 的推断未经实测（尤其中文检索质量与 graphiti 抽取质量两项）。
- **乙：真跑 B1（推荐考虑）**：工作量 ≈ 评测脚本 + 语料制备 + 三方接入；token 成本量级 1–3M（约 300 事件 × 3 方摄入 + 探针），graphiti 需要临时 Docker FalkorDB 与 Python 环境。B2/B3 可纸面+人工评审解决。
- 乙的前置拍板：语料来源（真实项目导出 vs 合成）、评测代码落点（建议 `evals/` 或 `.agent/workspace`）。

## 5. 出处

- mem0 README（README.md@main，2026-07-22 取）；`docs/migration/oss-v2-to-v3.mdx`；仓库目录 `mem0-ts/src/oss/src/{vector_stores,llms,embeddings,storage}`、`mem0/vector_stores`、`server/`（gh api 实查）；release `cli-node-v0.2.11`。
- graphiti README（README.md@main，2026-07-22 取）；目录 `graphiti_core/{driver,prompts}`；release v0.29.2。
- Zep 博客《Lies, Damn Lies, & Statistics: Is Mem0 Really SOTA in Agent Memory?》（2025-05-06，2026-06-03 更新版原文）。
- 本仓：`server/agent/tools/subject-memory{,-tools}.ts`、`server/agent/tools/subject-rag-index.ts`、`assets/workspace/.nbook/agent/profiles/builtin/{simulator.actor,simulator.leader,memory.curator}.profile.tsx`、simulation subject 模板；llmlint 仓 `web/prisma/schema.prisma`。
- 原始文件留存：`.agent/workspace/memory-research/`（两份 README、v3 迁移文档、Zep 博客文本）。
