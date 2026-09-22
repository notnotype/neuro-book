---
schema: nbook.task/v2
taskId: t01-novel-understanding-spike
---

# 小说理解 Brief 与图谱 Spike

## 目标

用同一第一章和固定 DeepSeek V4 Flash 模型，形成可复核的 brief、`nb-memory` 候选图、World Engine/PlotBench投影边界和三级摘要证据，回答小说理解产物怎样服务问答、记忆、世界状态与剧情结构。

行为合同未变：本 Task 只产生隔离研究证据，不修改业务源码、公开API、持久化schema、模型路由或真实NeuroBook Project。

本 Task 从 legacy `00161-novel-understanding-spike` 迁入；既有 walkthrough 保留原 Task ID，作为迁移前 provenance。

## Agent 工作

1. 固定来源规范、提示词、模型身份、调用统计、原始输出和秘密边界；开发者已持续授权当前V7纯brief目标内的后续DeepSeek调用，无需逐次确认，但每次attempt必须独立命名并保持单次fetch、零重试与证据不可覆盖。
2. 对brief、候选图、HTML和三级摘要做事实归属、信息揭示顺序、实体/别名、状态变化、未决项、性格证据与跨系统owner审查，事实与建议投影分开。
3. 开发者接受L2 v4正文为第一章当前最佳可读L2成品和后续质量基准；该接受不覆盖v4提示词泛化性、密度目标或唯一ingest适用性。
4. v5正文因把昏暗房间后的倒叙改成时间正序，并发生感知、身份归属和过度压缩错误而被否决。
5. 通用L2 v6首次HTTP response成功，但保存阶段被本地长度校验中止；独立retry虽持久化正文并命中长度，仍因可见锚点、漏问名及事实边界问题被开发者否决。
6. 开发者确认v4继续是当前最佳正文；V7先尝试双层合同，随后明确收窄为只生成一份无段号brief。
7. 旧纯brief因段落门禁未形成正文；`v7-repaired`、`v7-repaired-v2`和`v7-repaired-v3`均返回HTTP`200`和严格单候选非空，但候选触发`brief-source-leak-found`，临时候选已删除，三份失败stats独立保留；v3首次增加了只含偏移、长度与hash的结构化诊断，命中长度为`11`。
8. `v7-repaired-v4`用开发者已接受的V4正文作为唯一模型输入，成功生成`1418`可见字候选；该候选仍有`11`处来源重合并带入“侵占此身”等语义增强。独立v5局部改写调用未消除重合，故不采用。最终由宿主确定性改写命中句并修正事实归属，形成`chapter-001-summary-level-2-brief-only-v7-final.md`：`979`可见字、`7`段、来源连续8字重合数`0`、trim后正文SHA-256 `645122080c83324505f38b3d5b7492d62ea5cc5cbcb261f7855323848dac27e8`、含末尾LF的文件字节SHA-256 `ee22e55838b4fb69d6b87ba8121e2b08ede3a6c887a11e04be277d8e86a786f2`。开发者已接受该文件为第一章当前L2 canonical。按开发者清理指令，历史对照文件与其他优化中间产物已从目录移除，生成脚本保留于`scripts/generate-v7-brief.ts`。

## 开发者参与

当前L2已获开发者接受，本Task进入清理与收尾。Agent可在本Task范围内继续模型调用，无需逐次请求授权；浏览器人工验收、产品写入、数据变更、其它模型/章节或其它受限动作仍需另行明确授权。

## 任务产物

- Agent → 开发者：`evidences/chapter-001-brief.json`、`chapter-001-graph.json`、`chapter-001-graph.html` 与 `walkthroughs/2026-08-26-research-result.md`，用于观察brief、原生图和建议投影。
- Agent → 开发者：各级最终提示词与brief结果（L1/L2/L3/L2 V7）、研究结论与生成脚本；精确列表见 `允许文件`。
- Agent → 开发者：L3 v3 提示词已按 L2 v5 之后的通用原则定稿：System Prompt 不含样章专名、节点、答案或未知项，作品名/章节/正文只作 User 参数；目标 `180–300` 可见字、`3–6` 句话。
- Agent → 开发者：L3 v3 已执行三次真实调用（purpose `chapter-001-summary-level-3-v3-official`），三次均 HTTP`200`、严格单候选非空、零重试；三次候选均命中来源连续8–9字重合门禁，stats独立保留。第三次候选保留于Temp，宿主确定性改写4处命中短语、收敛引号原话为0处并补首句感知标注后形成`evidences/chapter-001-summary-level-3-v3.md`：`246`可见字、`4`句、来源连续8字重合数`0`、trim后正文SHA-256 `6fe7ad85fdd27d2d3e332e76b8d694359b8843f35b0702643ffd51e6c8da036d`、含末尾LF的文件字节SHA-256 `5e5bdb1b5aed2d87cfa2da24ce7d79989a119a696fe274f0266457575782b52d`。该正文是宿主改写稿而非模型原始候选，等待开发者审查。
 - 开发者 → Leader：接受`evidences/chapter-001-summary-level-2-brief-only-v7-final.md`为第一章当前L2 canonical；v5、v6正文否决；旧模型原始L2对照文件已随清理指令移除。
- Leader → 后续design Task：只交接开发者已接受的结论、来源revision、未决问题与重开条件，不把Spike推论写成正式API/schema。

## 修改计划

1. 目录已按开发者清理指令收敛：只保留各级最终提示词与结果、图谱交付物、研究结论和生成脚本；既有中间产物不再作为恢复依赖。
2. 统一v6首次调用为“HTTP response成功、保存阶段被本地长度校验中止”；同名v6正文明确归属于独立retry。
3. 保留旧纯brief、四个repaired生成attempt及v5局部改写attempt的prompt、purpose与stats，不覆盖或改写历史事实。
4. 最终brief以已接受V4为语义底稿，经模型改写后由宿主确定性修正事实归属和来源重合句；验收只记录最终hash、长度、段落与来源重合数。
5. 模型候选只写系统临时根；失败诊断只记录偏移、长度和 hash，不记录候选片段，最终通过任务产物校验后才写正式文件。
6. `focused-test`、`smoke`、`browser`、`docs-check`、`governance-check`、`diff-check`全部有当前产物真实结果后才能完成Spike；未运行项保持阻断。

## 完成门禁

- 五个研究问题均有可追溯产物和开发者判断，或有明确 `evidence-insufficient`、缺口与重开条件。
- 来源保持 `chapter-source-normalization/v1`、`textChars=2122`、SHA-256 `22c9b12d0305da4b64ea39751e809ed47cf9254d574caf875fbff91ef82552ee`；模型调用purpose、次数、provider/model和统计可核对，配置秘密未泄露。
- `nb-memory` 原生图与 World Engine/PlotBench 建议投影清晰分离；单章证据不被夸大为全书质量或最终模块边界。
- `focused-test`、`smoke`、`browser`、`docs-check`、`governance-check`、`diff-check` 均有当前产物的真实结果；未授权或未运行项阻断完成。

## Leader 继续条件

开发者已明确本任务后续模型调用无需逐次授权。四个 repaired generation attempt 中，前三个被宿主连续 8 字门禁拒绝，第四个形成候选；v5 局部改写调用未消除重合。宿主随后完成确定性事实与隐私收尾，final 正文已通过零来源重合扫描并被开发者接受为第一章当前 L2 canonical。当前停止调用；browser 人工验收或产品写入仍需另行明确授权。

恢复所需最小集合：本 README、`context.md`、`evidences/chapter-001-source-normalized.txt`、`evidences/chapter-001-summary-level-2-brief-only-v7-final.md`（canonical L2）、`evidences/novel-qa-service.md`、`walkthroughs/2026-08-26-research-result.md`和`scripts/generate-v7-brief.ts`。研究仍在进行；未执行的研究验收和 browser 人工验收不宣称完成。

## 研究问题

1. 第一章的中性结构化brief怎样支持小说问答、World Engine和PlotBench？
2. 只把brief交给独立模型调用后，`nb-memory`候选图应包含哪些Episode、Fact、Subject、State与关系？
3. 哪些理解结果进入World Engine动态状态/时间线、PlotBench剧情结构，哪些只留在`nb-memory`？
4. 全部处理、懒惰加载和连载新增内容怎样共用渐加处理模型？
5. 同一模型、正文与事实约束下，三级摘要的密度提示词和实际信息保留差异是什么？

## 决策范围

本Task只允许开发者根据真实产物判断brief最低字段与摘要密度、`nb-memory`小说理解边界、World Engine/PlotBench投影、渐加处理协议，以及后续优先研究哪份合同。不决定公开API、持久化schema、模型路由、缓存、数据库迁移或真实Project写入。

## 允许文件

- `evidences/novel-qa-service.md`（研究结论汇总）
- `evidences/chapter-001-brief.json`（brief 交付物）
- `evidences/chapter-001-graph.json`（原生图交付物）
- `evidences/chapter-001-graph.html`（建议投影交付物）
- `evidences/chapter-001-summary-prompt-revisions-v3.md`（L1 提示词）
- `evidences/chapter-001-summary-level-1-revised-v2.md`（L1 结果）
- `evidences/chapter-001-summary-level-2-prompt-v4.md`（L2 提示词）
- `evidences/chapter-001-summary-level-2-ingest-v4.md`（L2 ingest 基线）
- `evidences/chapter-001-summary-prompts-v2.md`（L1/L2/L3 v2 共用提示词）
- `evidences/chapter-001-summary-level-3-prompt-v3.md`（L3 提示词 v3 定稿）
- `evidences/chapter-001-summary-level-3-v3.md`（L3 结果，待审查）
- `evidences/chapter-001-summary-level-3-v3-official-call-stats.json`（L3 v3 调用统计）
- `evidences/chapter-001-summary-level-3-v3-retry-official-call-stats.json`（L3 v3 重试统计）
- `evidences/chapter-001-summary-level-3-v3-attempt-3-official-call-stats.json`（L3 v3 第三次统计）
- `evidences/chapter-001-summary-level-3-v2.md`（L3 结果）
- `evidences/chapter-001-summary-level-2-brief-only-prompt-v7-repaired-v4.md`（L2 V7 提示词）
- `evidences/chapter-001-summary-level-2-brief-only-v7-final.md`（L2 canonical，已接受）
- `walkthroughs/2026-08-26-research-result.md`（研究结论）
- `scripts/generate-v7-brief.ts`（生成脚本）
- `evidences/chapter-001-source-normalized.txt`（登记的第一章归一化正文）

**登记样本正文（2026-08-29 新增）。** `evidences/chapter-001-source-normalized.txt` 是 `.local/novels/转生反派萝莉，找茬魔法少女.epub` 的 `OEBPS/chapter_00001.xhtml` 经 `chapter-source-normalization/v1` 归一后的逐字正文：

| 项 | 值 |
| --- | --- |
| 成员 | `OEBPS/chapter_00001.xhtml` |
| 归一化 | `chapter-source-normalization/v1` |
| 字符数 / 可见字符数 | `2122` / `2044` |
| 段落数 | `77`（归一化后 1 行 = 1 段，文件第 N 行即第 N 段） |
| SHA-256 | `22c9b12d0305da4b64ea39751e809ed47cf9254d574caf875fbff91ef82552ee` |
| 文件末尾 | 无换行（`join("\n")` 的直接结果，多一个字节 hash 就对不上） |

小说、章节正文及研究产物可以按本 Task 的允许文件进入 Git；密钥等秘密不得复制进 Git。真实 Provider 调用与其数据是有价值的证据，应当留存——当前V7纯brief目标、同一第一章来源与DeepSeek官方provider/model范围内的后续调用无需逐次授权；每次仍须独立记录purpose与stats、单次fetch、零重试且不得覆盖证据。业务源码、Proposal、Spec、数据库、真实Project写入、其它模型或章节调用、远端动作和数据删除仍未授权。
