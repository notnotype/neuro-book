# llmlint 外部研究：Agent RP、协作提示词、预设文风与进化

- 调研日期：2026-08-20
- 文档状态：进行中；非规范调研资料
- 研究对象：`packages/llmlint` 与公开仓库 `notnotype/llmlint`
- 目的：记录外部先例、可迁移方法、与 llmlint 当前边界的差异，以及尚未验证的研究空白
- 证据口径：外部论文/官方项目页面作为外部事实来源；本地代码、测试、实验产物和公开 GitHub API 作为 llmlint 状态来源

> 本文件不定义产品行为，也不授权实现。采用某项外部方法前，必须把稳定行为写入根 `docs/specs/` 或 `docs/standards/`；本文件保留调研过程和证据边界。

## 1. 结论先行

截至本轮调研，外部已经分别覆盖了以下组件：

1. 角色扮演提示和角色一致性评测；
2. writer–critic 迭代修订与多 Agent judge 辩论；
3. 自动提示词优化、反思式优化和进化式搜索；
4. 中文创意写作、网文、文风偏好和 AIGC 检测评测。

但没有找到与 llmlint 完全相同的公开系统：

> 中文规则库 → 写前约束投影 → 成稿静态/神经双路检测 → Agent 语境修复 → 人类盲评 → 台账学习 → writer/reviewer 双池进化。

最重要的外部方法论结论：

- 角色提示可以改善特定任务，但不能把“模型扮演某角色”直接当作角色真实性证明。
- writer、critic 和 reviewer 必须分语义；critic 是作者管线内部的修订组件，reviewer 是模拟人类判断的独立评委。
- LLM-as-judge 可以作诊断和预筛，但位置偏差、冗长偏差、自偏好和同模型评审偏差必须校准。
- 提示词进化的常见适应度是准确率等客观任务分数；直接把单一 AIGC 检测器或静态命中数作为文风适应度，会触发 Goodhart 风险。
- 中文小说/网文的公开评测正在快速增多，但“人类盲评不下降 + AI 痕迹下降 + 剧情/角色声音保持”的联合验收仍是明显缺口。

## 2. 术语边界

### 2.1 Agent RP 不是稳定的标准术语

外部文献中 `RP` 通常指 role-play/role-playing，实际对应四条不同研究线：

- 角色扮演提示：让单个模型采用某个角色以改善推理或生成；
- 人格模拟：评测模型能否保持角色背景、知识边界和说话风格；
- 角色型多 Agent 协作：用不同人设和职责组织对话；
- 社区产品语境中的 RP harness：角色卡、世界书、状态变量、事件和生成前后钩子。

因此，本文不把 `agent RP` 作为一个已经存在的 benchmark 名称。llmlint 包内没有精确 `agent rp` 实现；相邻的 `RP模式` 和 `rp.leader`/`rp.writer` 属于 NeuroBook 宿主侧历史能力。

### 2.2 guide、style preset 和 evolution 不是同一层

| 概念 | 外部/内部含义 | llmlint 当前状态 |
| --- | --- | --- |
| guide tier | 规则库投影成写作前约束的档位 | `core/standard/wide/full` 已实现，有单测和 guide-arm |
| style preset | 文风范本或跨样本文风蒸馏结果 | style-distill/style-arm 已实现并完成一次小规模人工盲评 |
| writer | 生成初稿的作者角色 | llmlint generator 有单次角色提示 |
| critic | 作者管线内部提出修订计划或修订稿的组件 | 设计中；既有 repair Agent 不等于已实现 critic pool |
| reviewer | 独立预测人类 judgment 的评分器 | 只有 proposed/Accepted 设计，没有实现 |
| evolution lab | 版本化候选、校准、冻结 holdout 和选择循环 | 只有本地 Accepted boundary spec，零 `evolution/` 代码 |

## 3. 外部先例矩阵（已核验）

### 3.1 Agent RP / 角色一致性

| 先例 | 任务与结构 | 公开证据 | 对 llmlint 的可迁移性与限制 |
| --- | --- | --- | --- |
| [Role-Play Prompting](https://aclanthology.org/2024.naacl-long.228/) | 单 Agent 角色提示用于零样本推理 | AQuA `53.5%→63.8%`；Last Letter `23.8%→84.2%` | 可借鉴角色提示 A/B；不直接证明中文文风或角色声音质量 |
| [RoleLLM](https://aclanthology.org/2024.findings-acl.878/) | 角色档案、Context-Instruct、RoleGPT、RoCIT；RoleBench 角色级数据 | RoleBench 约 `168,093` 条样本、100 个角色 | 可借鉴角色档案和说话风格维度；目标是对话角色扮演，不是规则修复 |
| [CharacterEval](https://aclanthology.org/2024.acl-long.638/) | 中文多轮角色扮演评测 | `1,785` 段对话、`23,020` 样本、77 个中文角色、13 个指标 | 可借鉴中文角色一致性、多维评测和人工质控；不等于小说成稿质量评测 |
| [ECHO](https://arxiv.org/abs/2404.13957) | 图灵式盲评：人类区分真人与模型角色扮演 | 角色扮演 GPTs 成功率约 `48.3%` | 可借鉴盲评协议；人机判别本身不能替代想读度或语义保真度 |
| [CAMEL](https://arxiv.org/abs/2303.17760) | 角色型 Agent 通过 inception prompting 自主协作 | 两角色驱动任务对话；无统一创意写作基准 | 可借鉴角色职责和协作协议；缺少直接可用的质量指标 |

### 3.2 Writer–critic / reviewer 协作

| 先例 | 协作结构 | 评测与结论 | 对 llmlint 的边界 |
| --- | --- | --- | --- |
| [Self-Refine](https://arxiv.org/abs/2303.17651) | generator → feedback provider → refiner；同一模型可扮演三角色 | 7 类任务，平均绝对提升约 `20%` | 支持“生成—反馈—修订”链；自评不能当人类真值 |
| [Multiagent Debate](https://arxiv.org/abs/2305.14325) | 多实例提案—辩论—共识 | 数学、策略推理和事实性任务改善 | 辩论结构可迁移；事实性指标不能直接替代文风偏好 |
| [ChatEval](https://arxiv.org/abs/2308.07201) | 多个人格化 judge 逐一讨论并输出证据与分数 | 开放问答/NLG；强调顺序偏差缓解 | 可借鉴 reviewer team；需保留位置交换和独立校准 |
| [MATEval](https://arxiv.org/abs/2403.19305) | 多 Agent 讨论、自反思、错误定位、类型和分数 | 开放文本评估相关性较高 | 报告结构接近 llmlint 的定位报告；仍不能取代人类终审 |
| [CritiCS](https://aclanthology.org/2024.emnlp-main.1046/) | 长故事两阶段批评：批评者集合 + leader；人类可替代角色 | 创意和读者卷入提升，连贯性保持 | 最接近 llmlint 的创作批评管线；没有静态规则和 AI 味双路验收 |
| [AutoGen](https://arxiv.org/abs/2308.08155) | LLM、工具和人类混合的可编程对话模式 | 多领域示例，无统一创意写作指标 | 是协作基础设施，不是质量证据 |

外部偏差证据还包括：

- [Judging LLM-as-a-Judge](https://arxiv.org/abs/2306.05685)：位置偏差、冗长偏差、自我增强偏差；GPT-4 judge 与人类偏好一致率报告超过 `80%`，但不是完美一致。
- [LLM Evaluators Recognize and Favor Their Own Generations](https://arxiv.org/abs/2404.13076)：自识别能力与自偏好强度相关，支持作者模型与 reviewer 分离。

这与 llmlint 的 D5 相符：机器信号只能诊断，盲评的人类 `wantReadOn` 才能作为终审条件。

### 3.3 提示词优化与进化

| 先例 | 方法 | 结果/数据 | 主要限制 |
| --- | --- | --- | --- |
| [APE](https://arxiv.org/abs/2211.01910) | LLM 生成候选指令，再按任务分数选择 | 24 个 NLP 任务中 19 个优于或持平人工指令 | 适应度是客观任务指标，不适合直接验主观文风 |
| [OPRO](https://arxiv.org/abs/2309.03409) | LLM 根据历史解和分数迭代生成新解 | GSM8K 最高约 `+8%`，BBH 最高约 `+50%` | 可能过拟合开发集，调用成本高，缺人类文风验收 |
| [EvoPrompt](https://arxiv.org/abs/2309.08532) | prompt population + LLM mutation/crossover | 31 个数据集；BBH 最高约 `+25%` | 开发集适应度优化；没有 llmlint D5 双条件 |
| [PromptBreeder](https://proceedings.mlr.press/v235/fernando24a.html) | 任务提示和“变异提示”本身双层自指涉进化 | 算术、常识推理和分类任务改善 | 人类可读性、稳定性和主观质量未系统验证 |
| [PromptWizard](https://aclanthology.org/2025.findings-acl.1025/) | 批评—综合式提示和示例自进化 | 覆盖 `45` 个任务；报告成本/调用下降 | 仍依赖可量化下游指标 |
| [TextGrad](https://arxiv.org/abs/2406.07496) | 用自然语言反馈作为“梯度”优化提示、代码和写作变量 | GPQA `51%→55%`；LeetCode-Hard 相对提升约 `20%` | 反馈模型不是人类真值，需独立 holdout |
| [A Survey on Self-Evolution of LLMs](https://arxiv.org/abs/2404.14387) | 经验获取 → 精化 → 更新 → 评测四阶段框架 | 综述与分类学 | 可作为 llmlint 台账—学习出口的结构参照，不是具体实现 |

外部先例没有解决 llmlint 最关键的联合目标：

```text
人类 wantReadOn 不下降
+ 外部检测风险下降
+ 剧情/人物/视角/篇幅合同保持
+ 题材和受众生态位不被总体平均值吞没
```

## 4. 外部写作、文风和检测评测

| 先例 | 数据/方法 | 可迁移结论 |
| --- | --- | --- |
| [WritingPreferenceBench](https://writingpreferencebench.github.io/) | `1,800` 对人工偏好，含 `600` 中文、8 个体裁；序列奖励模型约 `52.7%`、zero-shot judge 约 `53.9%`、生成式奖励模型约 `81.8%` | 主观偏好不能用单一浅层分数；推理和文化/体裁分层重要 |
| [EssayBench](https://arxiv.org/abs/2506.02596) | `728` 条中文提示、4 种体裁、15 个模型、分层人工评分 | 约束写作需要体裁特定评分，不宜只用通用质量分 |
| [WebNovelBench](https://arxiv.org/abs/2505.14818) | `4,000+` 部中文网文、24 个模型、八维 LLM judge 和 PCA 百分位 | 可借鉴以人类作品分布为锚的长篇网文评测；需独立人评校准 |
| [WritingBench](https://github.com/X-PLUG/WritingBench) | 中英双语写作 benchmark；每个 query 生成实例级 rubric | guide/预设可采用实例级判据，但机器 critic 只作诊断 |
| [The Reader is the Metric](https://aclanthology.org/2025.findings-acl.1304/) | 5 个数据集、`1,471` 个故事、`101` 名 annotator、17 个文本特征；强调 reader-profile-sensitive evaluation | “好文”不是单一标量；llmlint 的 niche/slice 设计有外部依据 |
| [CS4](https://arxiv.org/abs/2410.04197) | 通过约束数量和特异度控制故事创造力 | guide tier 可以作为实验旋钮，但需监测连贯性和篇幅代价 |
| [GYAFC](https://aclanthology.org/N18-1012/) | 成对风格迁移语料和人工偏好 | 可借鉴 before/after 成对盲评协议 |
| [RAID](https://aclanthology.org/2024.acl-long.674/) | 超过 600 万条生成文本；多模型、领域、攻击、解码策略 | 中文检测评测应补未见模型、解码变化和对抗扰动 |
| [DetectGPT](https://arxiv.org/abs/2301.11305) | 无训练检测；假新闻 AUROC `0.81→0.95` | 检测器是仪表，不是文风真值 |
| [C-ReD](https://aclanthology.org/2026.findings-acl.2119/) | 中文 AI 生成文本、真实提示和跨模型泛化 | 可作为中文检测 benchmark 设计参照，但需要确认与网文场景的覆盖 |

## 5. 与 llmlint 当前状态的对照

### 已实现或已有证据

- `packages/llmlint/evals/generator/prompts.ts`：`brief-v2`、`render-v1/v2`、`repair-v1/v2`、Agent prompt 版本化。
- `packages/llmlint/evals/generator/prompts.test.ts`：空约束时 `render-v2` 与 `render-v1` 逐字节相等；未知版本硬失败。
- `packages/llmlint/skill/src/guide.ts`：`core/standard/wide/full`，外部 profile，`GuideProvenance` 指纹。
- `packages/llmlint/evals/experiments/guide-arm.ts` 与 `guide-compare.ts`：写作期约束元评测。
- `packages/llmlint/evals/experiments/style-distill*.ts`：reference 只读、匿名分析、style-distill-v1。
- `packages/llmlint/evals/experiments/style-arm.ts`：四臂风格候选实验。
- `packages/llmlint/.agents/tasks/archived/133-style-eval/README.md`：20 份正文、5 pair、78 次提交，n=5 方向性结果。
- **版本边界**：本文引用的 `style-arm-v2` 结果来自本地 Task 133 归档与公开 PR [#7](https://github.com/notnotype/llmlint/pull/7) 的 `feat/t133-style-eval` 分支；截至本次核验 PR #7 仍为 open、未合并。公开 `master` 主要是 `style-arm-v1`，不能把 v2 结果写成公开 master 已合并成果。
- `packages/llmlint/docs/specs/evolution/evolution-lab-boundary.md`：Accepted 目标边界，但不是实现。

### 明确未实现

- `evolution/` 目录及 `EvolutionRun`；
- 独立 `ReviewerPrediction` 数据模型；
- writer/critic/reviewer 双池运行器；
- 冻结人类 holdout 驱动的 reviewer shadow；
- 公开 Arena；
- M3-C brief/extractor 元评测；
- M5 显形回归集；
- 自动化真实模型 smoke；
- RP 或角色声音质量 benchmark。

## 6. 研究空白与迁移风险

1. **单一指标 Goodhart**：不能只优化 llmlint 命中、docScore 或外部 `P(AI)`；必须保留人类盲评和语义/篇幅合同。
2. **作者/评委自偏好**：writer、critic、reviewer 至少要有清晰的语义边界，最好使用不同模型或经校准的独立评委。
3. **同题泄漏**：calibration、prompt 示例和 holdout 必须按 brief/pair/题组切分，同一故事的不同版本不能跨 split。
4. **小样本文风结果**：Task 133 的 `n=5` 只能方向性描述；不能把 distilled 已采纳写成统计显著胜者。
5. **中文网文覆盖不足**：公开 benchmark 已出现，但没有看到针对“写前规则约束 + 写后修复 + AI 味/想读双条件”的公开 benchmark。
6. **文风蒸馏稳定性不足**：需要 shuffle、换模型、跨题材和独立 holdout 复跑。
7. **评委偏差未闭环**：任何 reviewer 进入候选淘汰前，都必须先在冻结人类 holdout 上报告 MAE/RMSE、pair accuracy、排序相关和最差 slice。

## 7. 当前状态与已核验的新研究

- 当前状态：外部先例已建立；本轮已补核验 2025–2026 的中文长篇写作、创意写作评委、风格个性化和提示词进化研究。
- 当前文档不是 spec，不作为实现入口。
- 最新研究的共同方向不是“再加一个总分”，而是：成对偏好、分层 rubric、独立评委、结构化解释、轨迹审计、跨题材/跨风格鲁棒性。
- 推荐的后续研究顺序：
  1. 用 `LitBench`/`ChangJuan`/`HoWToBench` 校准 reviewer 和长篇写作指标；
  2. 用 `WebNovelBench` 与中文叙事结构研究补齐网文/剧情层；
  3. 以 `LLM Review`、`EvolvR`、`Iterative Dual-Model Alignment` 比较 reviewer topology，但保留人类 holdout；
  4. 以 `SePO`、`Feedback Descent` 和优化轨迹研究设计候选搜索与变异台账。

## 8. 验证边界
### 已验证

- 本地 llmlint 核心 prompt、guide、实验脚本、测试和 Task 133 归档；
- 本地 Accepted/Proposed evolution 文档；
- `https://api.github.com/repos/notnotype/llmlint` 的公开仓库元数据、commit、Issue/PR、tag/release；
- 本节 3–4 中列出的外部论文、benchmark 和官方项目页的主要摘要或指标；
- 本轮新增的 2025–2026 来源的官方 ACL Anthology/arXiv 元数据和摘要，见 §9。
### 从代码推断

- 由当前实现与实验入口推断：新研究可以指导 evolution/、reviewer calibration 和 D5 设计，但不能据此宣称这些能力已实现或已在本仓库复现。


### 尚未验证

- 本地 `packages/llmlint` 与公开仓库逐文件 hash 一致性；
- Task 133 原始 judgment、style-arm-v2 语料和私池数据库；
- guide-arm-v3、delivery-arm-v2 的真实模型重跑；
- 新论文的完整附录、全部代码路径、数据许可和独立复现实验；
- 新论文的“state of the art”表述是否能迁移到中文网文和 llmlint 的 D5 双条件。

本文件后续新增内容必须把“已验证”“从代码推断”“尚未验证”分开，不得把搜索摘要写成实验事实。

## 9. 2025–2026 最新研究补充

本节只记录本轮直接读取官方 ACL Anthology 或 arXiv 页面后的摘要级事实。`A` 表示官方页面/论文 HTML 已读取；`B` 表示结果来自论文自述，尚未在本地复现；`C` 表示只看到搜索摘要或官方 README，不能单独支撑强结论。

### 9.1 中文长篇和创意写作评测

| 来源 | 证据 | 新信息 | 对 llmlint 的直接启发 | 限制 |
| --- | --- | --- | --- | --- |
| [LitBench（EACL 2026）](https://aclanthology.org/2026.eacl-long.362/) | A/B | 训练集 `43,827` 个故事 pair，测试集 `2,480` 个 Reddit pair；论文报告最强 OTS judge Claude-3.7-Sonnet 与人类偏好 `73%` 一致，Bradley–Terry 和 generative reward model 达 `78%`；另有 online human study | 评委候选必须用人类 pair holdout 校准；“大模型 judge”不能默认当真值 | 语料来自 Reddit，非中文网文；论文摘要未提供 llmlint 所需的 AI 痕迹和剧情保真双轴 |
| [ChangJuan（Findings ACL 2026）](https://aclanthology.org/2026.findings-acl.2044/) | A/B | `300` 部中文小说，含 metadata、人类评分和大规模用户评论；将评论蒸馏为剧情、人物等方面的共识优缺点；长篇评测使用长度/细节平衡摘要、代表性片段、方面评审和 genre-aware 权重；论文报告 8B CLEM，并将 Qwen3 与人类 judgment 的 Kendall tau 从 `24.8` 提到 `34.1` | 进化 run 的 reviewer report 应保存 aspect-level judgment、摘要/片段选择和题材权重，不只保存总分 | 长篇摘要可能丢失句子级 AI 味；需要检查数据许可和完整代码后再复用 |
| [HoWToBench / Tree-of-Writing（ACL 2026）](https://aclanthology.org/2026.acl-long.317/) | A/B | 中文写作 benchmark 覆盖 `12` 个 genre、`1302` 条 instruction 和 completion/outline-guided/open-ended 三类任务；Tree-of-Writing 显式建模子特征聚合权重，论文报告与人类 judgment 的 Pearson `0.93`；对文本扰动比普通 overlap 和 LLM judge 更稳 | guide/style 评测应分解为剧情保真、人物、结构、语言、可读性等子轴，再报告聚合权重和扰动鲁棒性 | 仍是 benchmark/judge 体系；`0.93` 是论文报告值，不是本仓库复现实验 |
| [WebNovelBench（Findings EACL 2026）](https://aclanthology.org/2026.findings-eacl.94/) | A/B | 使用 `4,000+` 部中文网文，把评测定义为 synopsis-to-story；八个叙事质量维度由 LLM judge 评分，PCA 聚合后映射到人类作品 percentile；比较 `24` 个模型，并区分人类名作、流行网文和 LLM 生成 | 适合作为中文网文长篇质量的外部参照和 percentile 设计参考 | 主要是 LLM-as-judge；与 llmlint 的静态规则、before/after 和私有盲评合同不同 |
| [Creative Convergence or Imitation?](https://arxiv.org/html/2603.14430v1) | A/B | 针对中文网文定义 `34` 个叙事功能；从 `100` 部、5 类主要 genre 的网文构造约 `1.0k` 个专家标注片段；两位标注者 agreement 报告 `κ≈0.83`；论文报告多数模型对叙事功能的整体识别有限，Qwen3/Doubao 总体 accuracy 约 `0.364` | 这提供了“结构性 AI 同质化/剧情塌缩”而不是词面 AI 味的诊断方向；可作为未来 M5 显形回归或 brief fidelity 轴的候选来源 | 当前是 arXiv v1；数据扩充含 DeepSeek-R1，数据集、许可和完整实验需独立检查 |

**修正记录**：旧草稿把 WebNovelBench 的 arXiv 版本 `2505.14818` 当作 2025 发表信息；本轮以 ACL Anthology 的 Findings EACL 2026 页面为主引用，公开发表信息为 2026-03、Anthology ID `2026.findings-eacl.94`。

### 9.2 Reviewer、批评拓扑与人类偏好

| 来源 | 证据 | 新信息 | 对 llmlint 的启发 | 风险 |
| --- | --- | --- | --- | --- |
| [LLM Review](https://arxiv.org/html/2601.08003) | A/B | 提出 Blind Peer Review：三个有固定 persona 的 writer 独立写初稿，互评后各自私下修订，不看其他人的修订稿，以减少多 Agent 互动造成的创意同质化；SciFi-100 为 `100` 个 prompt、约 300-word story；使用 5 个 judge 维度、9 名人类 annotator，并加入相对 SFGram 的 lexical/semantic novelty | reviewer 可以共享 critique，但不应共享彼此的最终修订轨迹；应记录“看到什么/不能看到什么”的信息流合同 | 2026-01 arXiv v1；论文摘要声称优于多 Agent baseline，但仍是预印本自述；场景是英文短科幻，不是中文网文 |
| [EvolvR（ACL 2026）](https://aclanthology.org/2026.acl-long.878/) | A/B | 以 pairwise comparison 为基础，多 persona 自合成 score-aligned CoT，再用多 Agent 自过滤，训练 evaluator/reward model；论文报告在 StoryER、HANNA、OpenMEVA 三个 benchmark 达到 SOTA，并用于指导故事生成 | 可参考“pairwise + 结构化解释 + evaluator 训练”的 reviewer candidate 形态；但必须把 reviewer prediction 与 `DocJudgment` 物理分离 | 论文摘要不足以判断人类 holdout 如何冻结、过滤 Agent 是否独立、SOTA 是否跨模型稳定 |
| [Iterative Dual-Model Alignment](https://aclanthology.org/2026.acl-long.648/) | A/B | Alpha 是 pairwise story engagement classifier，Beta 是 rubric-guided comparative explanation generator；两个 8B 模型迭代共训练：Alpha 反馈指导 Beta 的 DPO，Beta 的解释再用 KL-based contrastive objective 训练 Alpha；在 HANNA 人类 pair 数据上报告多轮优于单模型 baseline | critic/reviewer 可以分成“偏好预测”和“解释生成”两个独立组件；解释质量和偏好准确率分别验收 | 这是一种训练闭环，不等于离线候选池；预测器仍不能覆盖人类真值 |

### 9.3 Prompt evolution 和轨迹审计

| 来源 | 证据 | 新信息 | 对 llmlint 的启发 | 限制 |
| --- | --- | --- | --- | --- |
| [SePO](https://arxiv.org/html/2606.04465v1) | A/B | 自指涉地同时优化 task agent prompt 和 prompt agent 自身 prompt；维护 archive；先在多任务池 pre-train，再对目标任务 fine-tune；覆盖 AIME'25、ARC-AGI-1、GPQA、MBPP、Sudoku 五个 benchmark，论文报告相对 Manual-CoT 平均 `+4.49` 个百分点 | 未来 AuthorPool 可把 prompt optimizer 也版本化，但必须把 optimizer prompt、候选 archive、任务 split 一起落盘 | 适应度是数学/代码/逻辑准确率；不是人类文风或 D5 双目标；arXiv v1 |
| [Feedback Descent](https://arxiv.org/html/2511.07919) | A/B | 每轮保留 pairwise preference 和解释性 textual feedback，不把反馈压成单一 bit；inference-time 迭代修改文本 artifact；覆盖视觉、prompt optimization、molecule 三域，并报告 prompt optimization 的 train/validation/test 切分 | 适合借鉴“保留反馈原文 + 当前最佳 + 候选 + 接受/拒绝 + 轨迹”的 EvolutionRun artifact；外部反馈可作为方向，不是人类真值替代 | 没有中文小说实验；文本反馈质量和 evaluator 偏差仍需校准 |
| [What Makes an LLM a Good Optimizer?](https://aclanthology.org/2026.findings-acl.1252/) | A/B | 收集 `15` 个 LLM、`8` 个任务的搜索轨迹；强 optimizer 更像局部 refiner，持续小步改进并逐渐局部化；弱 optimizer 更容易 semantic drift、偶发突破后停滞；novelty 本身不能预测最终性能 | EvolutionRun 必须记录 parent、mutation、semantic drift、接受率和局部改进，而不能只保存最终 top-k；“多样性”不能自动当 fitness | 结论来自论文跨任务轨迹分析；未针对创意写作或中文文风 |

### 9.4 文风个性化和内容保持

| 来源 | 证据 | 新信息 | 对 llmlint 的启发 | 限制 |
| --- | --- | --- | --- | --- |
| [Evaluating Style-Personalized Text Generation](https://arxiv.org/html/2508.06374v3) | A/B | 8 个写作任务、3 个 setting（domain discrimination、authorship attribution、LLM personalized vs non-personalized），最终 `636` 个实例；结论是多种互补 metric ensemble 稳定优于单一 metric，且没有 SPTG gold standard | style-arm 的机器诊断应至少区分 style match、内容保持、AI detection；可报告 ensemble disagreement，不只报 docPAi | 目标是作者个性化 style，不是中文网文；论文是 arXiv v3 |
| [Persona-Augmented Benchmarking](https://aclanthology.org/2025.emnlp-main.1155/) | A/B | 在相同语义内容上改写 prompt 的 persona/style；不同写法会显著改变多个模型和任务的估计性能，且有跨模型触发低/高表现的风格 | guide/benchmark 的输入风格也是混淆变量；评测应对 prompt 表达和 persona 做鲁棒性分层 | 研究的是 benchmark 输入，不是生成成稿文风；不应直接当 style preset 效果证据 |
| [Catch Me If You Can? Not Yet](https://aclanthology.org/2025.findings-emnlp.532/) | A/B | 超过 `40,000` 次/模型生成、超过 `400` 位真实作者；用 authorship attribution、verification、style matching、AI detection 的 ensemble；结构化 news/email 较易模仿，blog/forum 等隐式风格较难 | 支持“文风蒸馏必须与独立 style discrimination 和 AI detection 组合验证”，不能用单次读者评分宣称完成模仿 | 语料是日常写作，非小说；结果与中文网文泛化未验证 |
| [Mind the Style Gap](https://aclanthology.org/2025.findings-emnlp.1175/) | A/B | 发现现有 content-preservation metric 在旧数据上会产生误导性高相关；新建高 variation 测试集后，style-aware metric 更符合人类 judgment；说明普通 metric 会把 style change 误当内容保持 | style-arm 必须加入“剧情/人物/信息控制是否保留”的独立评测，并在高变化对照上验证，不能只看文本相似度 | 论文研究 style transfer，不是长篇叙事；具体小模型方法需要读取完整实验后再采用 |

### 9.5 长篇偏好、读者分歧与 style-over-story

| 来源 | 证据 | 新信息 | 对 llmlint 的启发 | 限制 |
| --- | --- | --- | --- | --- |
| [StoryAlign / StoryRMB](https://arxiv.org/html/2605.04831) | A/B | StoryRMB 含 `1,133` 个 human-verified preference instances，每个 instance 是一个 premise、1 个 chosen story、3 个 rejected stories；论文报告现有 reward model 最好仅 `66.3%`；另构造约 `100,000` 个 preference pairs，训练 StoryReward，并用于 best-of-N 选择 | reviewer 校准应使用 premise 内的 chosen/rejected 结构和五个子维度（coherence、creativity、characterization、fluency、relevance）；候选淘汰保留 pairwise 与维度标签 | 选择流程先用 4 个 LLM 多数投票、强分歧再人工标注/验证；论文是 arXiv v1，100k pairs 不是全人工真值；中文/英文平台数据许可需检查 |
| [Towards A “Novel” Benchmark](https://aclanthology.org/2025.findings-acl.1114/) | A/B | Findings ACL 2025；为长篇 fiction 提出 Macro/Meso/Micro 三层、10 个指标；数据含英文/中文、人类/LLM/人机协作文本；人评报告 LLM 文本的 “high-starting, low-ending” 模式，十个 LLM 的分层自动评测仅得到 moderate correlation | D5 不能只看开头改良；应加入长程收尾、伏笔回收、结局完整性和层级汇总；不同层用不同评委比一个全局 judge 更合理 | 论文摘要没有给出可直接迁移的中文网文 split 和完整人评协议；moderate correlation 是论文自述 |
| [Evaluation Framework for AI Creativity](https://arxiv.org/html/2601.03698) | A/B | 用 Novelty、Value、Adherence、Resonance 四个维度、11 个子维度；`115` 名读者评估 12 个短故事；论文报告即时判断偏 Resonance、反思后 Novelty/Technical Value 与 Adherence 权重上升，Creativity 与 Enjoyment 驱动因素不同 | “想继续读”不能由“创造力”代理；机器反馈、即时 reader preference、反思后 rubric 应分开记录 | 英文、单模型、3 主题、每人一个故事；arXiv v1；不覆盖中文长篇 |
| [The Reader is the Metric](https://aclanthology.org/2025.findings-acl.1304/) | A/B | Findings ACL 2025；汇总 5 个公开数据集、`1,471` 个故事和 `101` 名 annotator；读者偏好聚成偏 surface/readability 与偏 holistic/theme/rhetorical dynamics 两类；作者据此主张 reader-sensitive evaluation | 人类盲评需记录受众/评审 profile 或至少报告最差 audience slice；总体均值会掩盖专家与普通读者冲突 | 使用 reference-less textual features 和英语短文本；profile 聚类不是 llmlint D5 的直接真值 |
| [Style over Story](https://aclanthology.org/2026.findings-acl.1361/) | A/B | Findings ACL 2026；构建 `200` 个 narratology-grounded constraints，让 `6` 个 LLM 在 basic/quality/creativity 三种 instruction 下选择；论文报告模型稳定偏好 Style，而 Event、Character、Setting 跨模型更分歧 | 这是 reviewer style bias 的直接警报：style score 上升不能替代剧情/人物/场景保持；应单独报告内容选择的跨模型一致性 | 研究 LLM 的选择偏好，不是改稿效果；摘要未给中文网文实验 |
| [Capturing Classic Authorial Style](https://aclanthology.org/2026.conll-main.31/) | A/B | CoNLL 2026；用 authorship-verification 监督训练 style-similarity judge，把输出校准为 `[0,1]` reward，再以 GRPO 训练 8B 长篇生成器；4 位经典作者上论文报告平均 style score `0.893` | style reward 必须做独立 authorship verification 校准，并与内容/剧情 holdout 并行；可参考无需 DPO accept/reject 的 reward 形态 | 英文经典作者、自动 style judge；`0.893` 是论文结果，不能转写成中文文风或人类认可 |

### 9.6 多 Agent Prompt Evolution 的 2026 进展

| 来源 | 证据 | 新信息 | 对 llmlint 的启发 | 限制 |
| --- | --- | --- | --- | --- |
| [MAS-PromptBench](https://arxiv.org/html/2606.23664) | A/B | 覆盖 4 个框架、9 个任务、5 种 topology、3 种 communication、4 种 team size；将 MAS prompt gain 定义为优化前后差值；论文报告最多 `+24.0` points，也有最多 `−16.0` points，且 topology/team size 敏感 | evolution lab 的最小切片必须固定 topology、模型、评测 split 和通信合同；必须报告回归而不只报告 best candidate | 任务是 reasoning/coding/tool-calling；arXiv v1；无创意写作或 D5 双目标 |
| [MAPRO](https://aclanthology.org/2026.findings-eacl.233/) | A/B | Findings EACL 2026；把 MAS prompt optimization 写成 MAP inference，用 language-guided max-product belief propagation，并以 topology-aware refinement 和 downstream blame 做 credit assignment | writer/critic/reviewer 变异应绑定到 trace 中的责任节点；父 prompt、下游失败和局部修改必须可回溯 | 论文报告跨任务 SOTA，但摘要未提供中文创意写作或人评 holdout |
| [Learning to Evolve / TPGO](https://aclanthology.org/2026.findings-acl.1534/) | A/B | Findings ACL 2026；将 agents、tools、workflows 建模为 Textual Parameter Graph，用 trace 派生 textual gradients，以 GRAO 从历史优化经验学习更新策略；在 GAIA、MCP-Universe 报告更高 success rate | `EvolutionRun` 不应只把 prompt 当字符串；应把角色、工具、workflow、候选和 trace 作为可演化节点，并记录 optimizer 的历史经验 | agent benchmark，不是故事；摘要未给出可直接比较的 D5 数字 |
| [Self-Evolving Multi-Agent Systems via Textual Backpropagation](https://aclanthology.org/2026.findings-acl.483/) | A/B | Findings ACL 2026；ANN 用 forward phase 动态分解任务、backward phase 反馈修正 global/local collaboration，使 roles/prompts/coordination 自演化；论文报告 7 个 benchmark 上优于多 Agent baseline | 进化边界应包含 role、coordination 和 aggregation，不应只优化 writer prompt；需要严格防止 evaluator 反向改变终审真值 | 论文目标是准确率/适应性；未覆盖创意写作、人类盲评或安全治理 |
| [SAGE](https://arxiv.org/html/2606.18902) | A/B | arXiv v2；把 APO 视为 noisy black-box search，用 residual search、遗传搜索和带 diagnostic code execution 的 agent pipeline 比较；生产 mental-health chatbot 的论文自述为 8 个 noisy A/B cycle 累积 next-day retention `+13%` | 进化 run 应同时保留定性诊断、统计验证和单调 hill-climbing 接受规则；SAGE 的代码诊断思路可迁移到规则命中/检测 slice | 真实用户部署和 retention 结果未在本仓库复现；健康场景不可直接迁移；优化目标仍是单一业务指标 |
| [Helix](https://arxiv.org/html/2603.19732v1) | A/B | arXiv v1；用 Planner、Prompt-Architect、Question-Architect、Mediator、Question-Generator、Question-Judge 组成双轨 co-evolution，同时优化 prompt 和 question reformulation；12 个 benchmark 论文报告最高 `+3.95%` | brief、guide 和 writer prompt 可能是耦合变量；但 question reformulation 不得在 D5 中偷偷改变用户 brief，必须记录原始/变换后的输入 | task benchmark，不是创意写作；code 在论文摘要中声明待接收后公开 |

**本轮未纳入强证据**：CHI 2026 的 [Can Good Writing Be Generative?](https://doi.org/10.1145/3772318.3791276) 已由 Crossref 核验为 `2026-04-13` 的 ACM proceedings article，但 ACM 页面返回 HTTP `403` 且 Crossref 无摘要；[Evaluating the Evaluators](https://openreview.net/forum?id=sx5GdUCpkj) 页面触发 OpenReview browser verification。本文件不把它们的标题或搜索摘要扩写成研究结论。

## 10. 新研究合并后的判断

本轮新增文献把“相邻先例”与“llmlint 集成空白”分得更清楚：

1. **创意写作 reviewer 先例已经存在。** LitBench、StoryAlign、EvolvR、LLM Review、Iterative Dual-Model Alignment 都覆盖了 pairwise preference、维度化解释、盲审信息流或故事 reward model；不能再说公开没有创意写作评委研究。
2. **中文长篇 benchmark 已经存在。** ChangJuan、WebNovelBench、HoWToBench 和 “Towards A Novel Benchmark” 覆盖中文长篇、网文、Macro/Meso/Micro 层级和多维质量评估；缺口不是“有没有 benchmark”，而是它们是否覆盖 llmlint 的 before/after D5 合同。
3. **Prompt/MAS evolution 已有成熟相邻路线。** MAS-PromptBench、MAPRO、TPGO、ANN、SAGE 和 Helix 分别覆盖 topology-aware credit、trace/textual gradient、角色/工作流演化、诊断代码、黑盒搜索或 prompt–input 共进化；不能再把“进化实验室”描述成没有外部先例的概念。
4. **style-over-story 是现实风险。** Style over Story、CoNLL style reward、The Reader is the Metric 和 Evaluation Framework 都说明 style、reader profile、即时/反思判断可能与剧情、人物、享受度分离；style score 或 creativity score 都不能替代 wantReadOn 和剧情保真。

在本轮检索的公开资料中，仍未找到同时满足以下条件的系统：

- 把中文规则库投影成写前 guide，再用独立 detector、静态规则和人类盲评联合验收；
- 把 `AI flavor ↓`、`wantReadOn ↔/↑`、剧情保真和角色声音保持作为同一个进化 fitness contract；
- 把 style distillation、writer/critic pipeline、reviewer calibration/holdout 放入同一个可审计 run；
- 对中文网文做改前—改后、独立模型/独立评委、冻结人类 holdout 的公开双目标实验。

因此，llmlint 的潜在新颖点不应写成“第一个创意写作进化系统”或“第一个中文长篇 benchmark”，而应收窄为：

> 面向中文网文的、规则约束与人类盲评双闸门的作者/评委离线进化实验协议。

该表述仍需实现 `evolution/`、冻结 holdout 和足够规模的人类数据后才能作为项目贡献；当前只是研究判断。

