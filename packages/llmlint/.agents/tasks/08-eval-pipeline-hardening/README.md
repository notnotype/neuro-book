# Eval 生成管线硬化 + 外部检测器接入 + reference 扩量（小验证轮）

> 本文是交给实现 agent 的**实现计划 + goal**，实现过程按 walkthrough 规则持续更新本文件。
> 权威规范：[../../../CONTEXT.md](../../../CONTEXT.md)（术语 + 不变量 I1–I11/D1–D5，本任务重点 I1/I2/I3/I8，另 **I10** 新增 CLI 也要 cwd 无关、**I11** 新语料同合规边界）、[../../../evals/METHODOLOGY.md](../../../evals/METHODOLOGY.md)（流程，代码按它实现）。

## User Request / Topic

四环体系（CONTEXT §1）落地后的第一批代码活：**环 ① 规则选择的全链路硬化**。用户点名的昂贵/脆弱点：

1. LLM 生成 render 最贵最脆弱——接口会坏；好在一个 brief × 一个模型只需生成一次、永久复用 → **恢复/重试必须可靠**。
2. web 数据（环 ②）慢慢补充，本轮不做。
3. 灵活 CLI 接口，用 **commander**。
4. **配置化**：AIGC 检测接口必须可换。
5. LLM 接口要有**限流、重试配置**。
6. **数据管理要调研建模**：小说 reference 的题材等元数据后续要用。
7. **token 预算**：render 前预估用量、render 后实报用量。
8. 提示词工程：**brief 抽取 prompt、抽取模型、render prompt 都要可配置**。

## Goal（给实现 agent 的一句话指令）

> 在 llmlint 仓 `evals/` 上实现：① calibre 批转 mobi + reference catalog 建模 + 2–3 个新题组入 corpus；② generator 硬化（commander CLI、eval 配置文件、prompt 版本化注册表、`claude -p`/`codex exec` CLI transport、按 provider 限流、token 预算预估/实报）；③ 可换的外部 AIGC 检测器 client（首个实现 = HF yuchuantian/AIGC_text_detector）+ 批量打分 + report 外部对照节；④ 跑一轮小验证（2–3 新题组 × 4–6 模型，含 ≥1 个 CLI 模型）出 report。全程遵守 CONTEXT 不变量（尤其 I8 prompt 版本纪律），贵结果（render/detector 分）一律落盘可续跑。

## 已锁决策（用户拍板）

| 决策 | 内容 |
|---|---|
| 本轮规模 | **小验证轮**：2–3 个新题组 × 4–6 模型（先验证工具链，避免未验证就上量翻车重跑） |
| mobi 处理 | calibre 已装 `C:\Program Files\Calibre2\ebook-convert.exe`，批转 epub 后走现有 epub 摄入 |
| catalog 位置 | **数据旁**：`C:\Users\<user>\Documents\CodeRepository\GithubProjects\neuro-book\datasets\aigc-detection\catalog.json`（llmlint evals 通过配置 `datasetsRoot` 跨仓读） |
| CLI 模型用途 | 默认只进 **render 面板**（造 AI 样本）；brief 抽取器仍用 HTTP 模型（CLI 慢、无 usage） |
| detector 本轮角色 | **eval 侧批量打分 + 报告对照**（reference 应低分 / render 应高分 = 外部效度）；web 端接入后置 |
| prompt 配置化 × I8 | prompt 做成**带版本 key 的 preset 注册表**（如 `brief-v2`、`render-v1`）；每个 render sample 记自己的 `promptVersion`，缺失或跨版本时 score 硬失败，不产混合报告 |

## 资源清单

- **reference 数据集**：`neuro-book/datasets/aigc-detection/`，**精选 100 本**（`books/` 约 667MB，金庸武侠约 40 本 mobi、网文经典 epub/txt），多作者多题材、基本 pre-2023（满足 I6）。**已有元数据**：`manifest.tsv`（100 行：排名/书名/作者/题材/知名度/文笔剧情分/入选理由/仓内路径/sha256）、`source-selected-100.tsv`、`to-supplement.tsv`、README（生成口径）。⚠ `007-诡秘之主` 已是现有题组种子，**新题组避开**，选不同作者不同题材（如：武侠金庸 / 宫斗甄嬛传 / 历史庆余年 / 无限流无限恐怖）。
- **AIGC 检测接口**：https://huggingface.co/spaces/yuchuantian/AIGC_text_detector 。**API 已实测（2026-07-03 smoke）**：
  - 协议：gradio 5.7.1，`POST https://yuchuantian-aigc-text-detector.hf.space/gradio_api/call/predict_zh` body `{"data":["文本"]}` → `{event_id}` → `GET .../predict_zh/{event_id}`（SSE），返回 `["AI"|"人类", 该标签置信度]`。**归一化**：标签=人类时 `P(AI)=1−prob`。
  - 端点 6 个：`predict_zh`（中文-V3，主用）/ `predict_zh4`（中文-V3-短文本）/ `predict_zh6`（中文-V2）+ 英文对应三个。
  - **静默截断已证实**：2173 字末尾追加 216 字 AI 段，分数与不加完全一致（16 位小数）；同段放开头分数 0.54→0.9998 → **只读前部窗口，超长不报错但尾部不可见**。窗口 >500 字、≤2173 字，确切边界 M3 用二分 smoke 钉死。
  - **域偏移警示**：真人类轻小说章节整篇被判 AI 0.537（前 500 字判人类 0.647）——该检测器在中文网文域噪声不小，恰是 M3 外部对照节要量化的东西；也再证 D5"检测器是仪表不是真值"。
  - 实测 2–7 秒/次（本轮无冷启动）；免费实例仍需重试 + 限速 + 可换。
- **LLM HTTP**：neuro-book `workspace/.nbook/config.json` 已有 10 个 provider（bailian/deepseek/doubao/elysiver×4/lyclaude/siliconflow/xiaomi）；qwen3.7-plus、kimi-k2.6、MiniMax-M2.5 等新 id 靠现有"发现放行"机制直接可用。
- **LLM CLI**：经本机配置的中转网关访问（密钥只放环境变量或 gitignored 的本地配置，严禁进 git/文档）——claude 系走 `claude -p`、gpt-5.5 走 `codex exec`（env：`ANTHROPIC_BASE_URL`/`ANTHROPIC_AUTH_TOKEN`、`CODEX_API_KEY`）。

## 现有底子（不要重建）

`evals/generator/model-client.ts` 已有：`callWithRetry` + `classifyOutcome`（429/5xx/超时→retry，terminal→跳篇）、`AbortSignal.timeout` 墙钟硬超时、pi-ai HTTP 层重试；`generate.ts` 已有断点续跑（brief/render 文件存在即跳过）、逐篇 try/catch、`--list-models` 模型发现；`config.ts` 已有跨仓读 config.json、模型 id 放行、compat 标志。**CLI transport 必须插进同一个 classifyOutcome/callWithRetry seam**，不要另起炉灶。

## 里程碑

### M1 数据摄入 + catalog 建模
- **第 0 步（合规，I11）**：`datasets/aigc-detection/books/` 是 104 本版权书，在 neuro-book 仓当前 untracked——先把 `datasets/aigc-detection/books/` 加进 **neuro-book** `.gitignore`（catalog.json 是元数据，可进 git）。
- `evals/acquire/calibre.ts`：`ebook-convert` 包装（mobi→epub，批量、幂等：目标存在跳过）。⚠ 中文书名路径 + Windows spawn 编码，用数组参数 spawn、不拼 shell 字符串。
- **catalog = curation 状态层，不重复 manifest**（本条即用户说的"数据管理调研建模"）：书目身份（title/author/genre/评分/sha256）**以既有 `manifest.tsv` 为真相源**，不复制；新建 `catalog.json` 只记 curation 状态，按 `dataset_relative_path`（或 sha256）引用 manifest 行：`{ref, status(raw/converted/segmented/curated), convertedPath?, pubYear?, pov?, selectedChapters?[], notes?}`。manifest 的中文题材标签（如"经典武侠"）与 CONTEXT Genre 枚举做一次映射表（enumOrString 兼容）。
- acquire 吃转换产物 → 清洗/切章 → **agent 产出候选清单**（题组候选书 + 建议章节 + 每章摘录预览），**交用户确认后**才入 `evals/corpus/`（人工质量闸门保留，交互协议 = 一次清单确认），meta 带 `referenceSource/pubYear/author`。

### M2 generator 硬化
- **配置双文件**：`evals/eval.config.json`（真实配置，**gitignore**，可含密钥/env 值）+ `evals/eval.config.example.json`（无密钥，进 git；沿仓里 `llmlint.config.example.ts` 先例）。内容：render 面板、抽取器、prompt 版本选择、per-provider 限流 + **重试参数（maxAttempts/退避基数——现为代码常量，提为配置）**、datasetsRoot、detector 配置（端点/chunkChars/聚合方式）。CLI flag > config > 默认。
- `evals/generator/prompts.ts`：preset 注册表（现 brief.ts v2 / render.ts v1 的 prompt 移入，带版本 key）；每个 render sample 写 `promptVersion`，题组级字段只保留 brief/生成上下文；score 端发现缺版本或混版本直接失败（守 I8）。
- CLI transport：provider 配置 `transport: "cli"` + 命令模板；**prompt 走 stdin 传**（brief 数千字中文，Windows 命令行参数长度/转义/编码都是坑，禁止拼进 argv）；**system+user 合并契约显式化**（统一 `system\n\n---\n\nuser` 或用 CLI 的 system-prompt flag，所有 CLI 模型同一规则，保证与 HTTP 模型输入等价、byModel 可比）；并发固定 1；**claude 通道用 `--output-format json` 拿真实 usage**（codex 无则标"估算"）。插入现有 retry seam。
- 限流：per-provider `{concurrency, minIntervalMs}` 信号量（简单实现即可，别引重库）。
- token 预算 `evals/generator/budget.ts`：`generate --estimate` 干跑 = 按 brief 字数 + targetChars 折算（初始系数中文 ≈ chars/1.5）× 待生成篇数，分模型汇总打印；真跑后实报 = usage 累计；**自校准：每轮真跑后记录 estimate vs actual 比率，下轮估算用实测比率修正系数**。先只报 token 数，换算钱后置。
- `generate.ts`/`score.ts` 换 **commander**（子命令/flag 帮助一致化；保持现有 flag 语义兼容）。

### M3 外部检测器
- `evals/detector/`：`DetectorClient` 接口 `{name, version, detect(text) → {chunks, docAggregates}}`；首个实现 = HF `predict_zh`（协议见资源清单，冷启动重试+退避，限速）；配置可换（用户硬需求）。`version` 用 space revision/固定日期标（space 不自报版本）。
- **分块策略（截断已证实，必须自己切）**：
  - 边界 smoke：二分 `R[:500/1000/1500/2000]` vs 全文，钉死实际窗口 → 配置 `chunkChars`（初值 450）。
  - 切块：**句界对齐**（。！？…"累积，不切断句子），尾块 <150 字并入前块；eval 批量**不重叠**（未来 web 热力图可选 50% 重叠）。
  - 归一化：`P(AI) = 标签==AI ? prob : 1−prob`。
  - **sidecar 存每块原始结果** `{span, label, prob, pAi}`（原始存、聚合派生——D3 哲学，改聚合不重调 API）。
  - 文档级聚合双轨：**主 = 长度加权 mean(P(AI))**（语料整篇同源，mean 降方差，AUC 用它）；**副 = max 与 p75 同存**（未来 web 混合来源场景敏感指标）。热力图 = 每块 pAi。
- 批量打分 CLI（`detect.ts`，路径守 I10）：对 corpus 全样本打分 → **sidecar 缓存** `evals/report/detector-scores.json`（key = **样本内容 hash** + detector + version + chunkChars；存在跳过——贵结果落盘复用，同 render 哲学）。
- report 加**外部对照节**：按 role/model 的检测概率中位、外部检测器在同语料上的 AUC ↔ llmlint AUC 并排（外部效度 + 上限参照；⚠ 已知域偏移，见资源清单）；web report 页兼容展示（可后置到最小：json 里有数即可）。
- ⚠ detector 分数是**对照仪表**，不改变 docScore/lift 的任何计算（别混口径）。

### M4 小验证轮
- 2–3 新题组 × 4–6 模型（现有 3 + bailian qwen + ≥1 个 CLI 模型验 transport）全链路：estimate → generate（断点续跑演练：中断重跑跳过已完成）→ score → detect → report。
- **holdout 首次解锁**：现有 2 题组 + 新 2–3 = 4–5 ≥ `HOLDOUT_MIN_GROUPS(4)`，跑一次 `--holdout` 冒烟（还 M3-B 的账；题组仍少，train/test AUC 只作趋势看）。
- ⚠ **modelRanking 混面板 caveat**：新面板只 render 新题组，旧题组是旧 3 模型 → 全 corpus 模型排名把"模型差异"和"题材差异"混在一起；报告按题组/题材分层看排名，walkthrough 明写此 caveat。
- 更新本 walkthrough（实际结果 vs 计划出入）+ PROJECT-STATUS + METHODOLOGY §8 基线快照（若指标变化）。

### 2026-07-14 评测可信度守门（已完成）

- **prompt 版本改为样本级真相源**：`Sample.promptVersion` 由 corpus loader 透传，generator 对每个新 render 写入所用 render prompt 版本；断点续跑会在任何模型调用前预检已有文件，缺版本或与本轮版本不一致时直接停止，不会用题组默认值给旧文件“补身份”。
- **混合报告硬阻断**：`score.ts` 在扫描前校验全部 render；任一缺版本或多个版本并存都以退出码 1 结束，不创建新报告。成功报告新增 `renderPromptVersion` 顶层审计字段。当前 corpus 的 28 个旧 render 均缺样本级版本，守门验证已确认被拒绝；在版本来源被确认或重新生成前，不得人工猜填。
- **holdout 只认有效配对题组**：题组必须至少存在一条 `render.pairRef → reference.file` 同题组映射，才计入 `HOLDOUT_MIN_GROUPS`、train/test 切分、规则拟合集和 holdout AUC。reference-only、缺 `pairRef` 或悬空引用的题组全部排除。
- **针对性测试**：新增缺版本、混版本、单版本三组 corpus 合同测试；metrics 新增“4 个有效配对 + reference-only 仍按 4 组切分”和“总题组足够但仅 3 个有效配对仍关闭 holdout”测试。聚焦测试 12/12、根类型检查、fixture 端到端打分（AUC 1.000）通过。
- **基线发布冻结**：Task 08 M3 外部检测器对照和 M4 小验证轮完成前不发布新基线。当前观测 `0.530` 只是扩量过程中 reference 已增加、render 尚未补齐的中间语料状态，不能用于评价规则质量，也不写入 METHODOLOGY 基线快照。
- **与原计划的出入**：本轮只完成可信度前置守门，没有把 M3/M4 冒充完成，也没有为通过新校验而猜测旧 render 的 prompt 版本；外部检测器批量对照、4–6 模型补齐和首次正式配对 holdout 仍按后续里程碑执行。

### 2026-07-26 基线解冻：历史 render 的 promptVersion 有据回填（已完成）

- **回填依据（确认而非猜测，满足 07-14「版本来源被确认」条件）**：① 各组 `meta.json` 组级 `promptVersion: {brief:"brief-v2", render:"render-v1"}` 是 `generate.ts` 生成当时自己写入的运行记录；② `generator/prompts.ts` 注册表中 render 提示词自始至终只存在 `render-v1` 一个版本（注册表注释亦明写「历史语料（round-04/05 生成）即按 brief-v2/render-v1 生成」），无歧义空间。
- **执行**：一次性脚本（scratchpad，不进仓）遍历 5 组 meta，给全部 **100 个 render 样本**回填样本级 `promptVersion:"render-v1"`；带双重安全阀（组级记录缺失/≠render-v1、已有样本级版本≠render-v1 均直接中止）。键序对齐 generator 新写形态（file/role/model/difficulty/promptVersion/pairRef/charCount）。git diff 恰好 5 文件 +100 行、零删除。
- **重跑 score**：守门通过、`renderPromptVersion:"render-v1"` 审计字段落报、warnings 空。语料 5 题组 / 26 reference / 100 render / 5 repair。corpus 合同聚焦测试 20/20 绿。
- **新报告要点（round-06 混面板；口径详见 METHODOLOGY §8）**：llmlint AUC **0.966**、docScore 中位 人类 2.47 / AI 8.86、人类误杀 0.00/千字、强判别 5、holdout train 0.949 / test 1.000（2 组小样本）、外部检测器 AUC 0.870（缓存复用，未重新请求）。
- ⚠ **与 round-05 不可比**：这是 Task 23 规则大整理（360 total / 266 active / 245 regex、消重 + 关噪声）后的第一份正式报告——docScore 量级整体下降约 8 倍、重复率 32.9%→0.0%、强判别 15→5 全部是**规则面变化**所致，不是语料或判别力退化。任何引用旧中位数做阈值/校准的消费方（web 报告校准文案等）随 registry 重烘自动更新，勿手抄旧数。
- 07-14 记录的「28 个旧 render」是当时 PR 分支上的语料状态；本轮解冻时主干实际为 100 个（round-05 均衡 77 + 补充轮 5 CLI 探针 23），全部回填。

## 验收

1. `bun test` 过（budget/限流/transport/分块聚合的纯函数部分按需加测，勿过度测试）。
2. 小轮 `report.json`：新题组进 lift、detector 对照节有数、≥1 个 CLI 模型 render 成功。
3. 断点续跑实测：kill 后重跑，已完成 brief/render/detector 分全部跳过。
4. 密钥合规：本地 gitignored 密钥文件里的 key 未出现在任何进 git 的文件里；`eval.config.json` 已 gitignore，`eval.config.example.json` 无密钥。
5. CLI 模型的 render 输入与 HTTP 模型等价（同 prompt 版本 + 同合并契约），byModel 可比。
6. 任一 render 缺样本级 `promptVersion` 或 corpus 内存在多个 render prompt 版本时，`score.ts` 必须失败且不覆盖报告。
7. holdout 门槛与 train/test 数量只统计存在有效 reference/render 映射的题组。

## 风险 / 开放项

- ~~HF Space API 形状未验证~~ **已实测通过**（协议/端点/截断/域偏移见资源清单）。残余：窗口确切边界待 M3 二分钉死；免费实例限流/波动；**域偏移**（网文域上该检测器噪声不小，对照结论要带此前提）。
- mobi→epub 转换质量参差 → clean 阶段人工抽查；calibre 处理中文书名路径注意 spawn 编码。
- `codex exec` 在本机是否可用未验证（M2 先 `--check` 单模型 smoke）。
- doubao render 长度不稳（同模型偶发大幅欠长）已知，byModel 分层会显形，不修。

## Implementation Log

### M1 数据摄入 + catalog 建模（2026-07-03 完成）
- neuro-book `.gitignore` 补 `datasets/aigc-detection/books/` + `converted/`（I11，已 check-ignore 验证）。
- `evals/acquire/calibre.ts`：`ebook-convert` 幂等包装（数组参数 spawn，中文路径安全）；实测转天龙八部/甄嬛传两本 mobi→epub 成功。
- `evals/acquire/catalog.ts`：catalog 状态层（`manifest.tsv` 为书目真相源，按 `dataset_relative_path` 引用，不复制字段）+ 中文题材→genreKey 映射表。
- `evals/acquire/candidates.ts`：候选清单工具（章题/字数/切段数/开头预览），供人工选章。
- clean.ts 补两处：`^Google 谷歌` 站点水印行过滤；`segmentChapter` 空行切不开时回退按单换行分段（calibre epub 无空行段落，否则整章成不可切巨段）。
- **入语料 3 新题组**（用户选定，风格/POV/年代拉满差异）：`wuxia/tianlong-babu`（金庸/1963/6单元）、`gongdou/zhenhuan-zhuan`（流潋紫/2007/5单元，章短~1.4k）、`wuxianliu/wuxian-kongbu`（zhttty/2007/5单元）。catalog.json 记 curation 状态。

### M2 generator 硬化（2026-07-03 完成）
- **配置双文件**：`eval.config.example.json`（进 git，无密钥）+ `eval.config.json`（gitignore，注入真 key）；`eval-config.ts` loader（json>example>内置默认）。相对 `modelsConfig`/`datasetsRoot` 按 llmlint 仓根解析（I10，跨仓读 NeuroBook config）。
- **prompts.ts 版本化注册表**（I8）：brief-v2 / render-v1 迁入，未知版本直接抛；meta.json 每题组写 `promptVersion {brief,render}`；`corpus.ts` 消费侧发现跨题组 render 版本混用→告警。
- **CLI transport**（`cli-transport.ts`）：spawn（Win 下 `cmd /c`）、prompt 走 stdin、system+user 合并契约 `system\n\n---\n\nuser`、claude `--output-format json` 拿真实 usage；接入同一 classifyOutcome/callWithRetry/gate。**⚠ 未端到端验证**：测试环境中转网关的 `claude -p` 网络挂起（90s 无输出）、`codex exec` 反复 "Reconnecting… 1/5"——上游不可达，非 transport 代码问题（deepseek HTTP smoke 1s 正常）。已把 CLI timeout 降到 120s 快退、默认 render 面板不含 CLI 模型（需要时 `--models` 显式加）。
- **限流**（`rate-limit.ts`）：per-provider 并发信号量 + minIntervalMs；`model-client` 两通道汇合于 `callModelDetailed`（经 gate + 统一重试）。
- **重试配置化**：`retry {maxAttempts, backoffBaseMs}` 从代码常量提进 eval.config，注入 model-client。
- **token 预算**（`budget.ts`）：`--estimate` 干跑分模型汇总（brief 已抽则实读、否则按目标字 0.5 估）；真跑实报 usage（CLI text 通道无 usage 标"估算"）；自校准（预估 vs 实报 output 修正 charsPerToken 写回 `report/budget-calibration.json`）。
- **commander 化**：generate.ts / score.ts 换 commander（flag 语义兼容）。
- **验证**：tsc 0 error；`bun test` model-client(10)+hardening(5) 全过；`--estimate` 全默认 5 模型面板跑通（跨仓 config 解析 ✓、断点续跑感知 ✓ deepseek 16 vs gemini 26、预算 ✓ ≈332k token）；`--check` deepseek HTTP smoke ✓。

### M3 外部检测器（2026-07-03 完成）
- **HF API 实测确认**（写进资源清单）：gradio 5.7.1，`POST /gradio_api/call/predict_zh {data:[text]}` → event_id → SSE `["标签","prob"]`；静默截断证实（>窗口尾部不可见）；域偏移（真人类章节被判偏 AI）。
- `detector/chunk.ts`：句界对齐分块（~450 字，不切断句子，尾块<150 并前，span 回指原文）；4 个纯逻辑测试过（句界/偏移/并块/无标点兜底）。
- `detector/hf-client.ts`：`DetectorClient` 接口（可换）+ `HfDetector`；P(AI) 归一化（标签=人类→1−prob）；文档级聚合**长度加权 mean（主）+ max/p75（副）**；限速 + 冷启动退避重试。
- `detector/detect.ts`：commander CLI；**sidecar 缓存** `report/detector-scores.json`（key = 内容 sha256 + detector + version + chunkChars，内容变才失效）；外部对照摘要（reference vs render P(AI) 中位 + AUC + byModel）写进缓存。
- **report 对照节**：`rocAuc` 从 metrics.ts 导出复用（与 llmlint AUC 同口径，保证公平对照）；`Report.externalDetector` 新字段；score.ts 读 detector-scores.json 的 summary 原样搬进 report.json（detect.ts 产出、score.ts 消费，单一真相源）；⚠ detector 分数是对照仪表，**不改 docScore/lift 任何计算**。
- **验证**：tsc 0；chunk 测试 4/4 过；**真实 HF 端点跑通**——8 reference 样本 P(AI) 中位 **0.335**（chunked mean 比单发全文的 0.537 更像人，印证分块避开了截断伪影）；**sidecar 缓存生效**（重跑 8 命中/0 新打分）；detect→score→report.json 的 `externalDetector` 字段贯通（含 name/version/chunkChars/中位/AUC/byModel）。

### M4 小验证轮（2026-07-03 完成）
全链路真跑 `estimate → generate（断点续跑）→ score --holdout → detect → report`。

**规模（实际 vs 计划）**：5 题组（旧 lotm/villain-loli + 新 wuxia/tianlong-babu、gongdou/zhenhuan-zhuan、wuxianliu/wuxian-kongbu）× 3 模型 / **65 render**。计划是"2–3 新题组 × 4–6 模型"；**出入**：① doubao 在两个新组反复撞 240s 超时，降级为 deepseek+mimo 2 模型跑完（gongdou 仍是 3 模型全的），so 新组模型覆盖不均；② 未上 gemini/glm（控 wall-clock，验证工具链够用）。

**结果**：
- **llmlint 检测器 AUC 0.681**（docScore 中位 人类 19.48 / AI 25.15，误杀 8.94）——**较旧 2 组的 0.833 下降**。根因不是回归而是**判别力 genre-dependent**：新增古典武侠（天龙八部 1963，文白夹杂）+ 宫斗 + 无限流后，规则集对网文体裁强、对古典/文学体裁弱被稀释出来——**这正是 task profile 论点的实证**（换语料=换 profile，判别力随之变）。
- **holdout 首次解锁**（5 组 ≥4）：train 3 组 AUC 0.616 / **test 2 组 AUC 0.778**（test>train，未过拟合，小样本波动）。
- **强判别 6 条**（跨 genre 存活的耐久 tell）：`repeated-de-pairs` effLift 5.05、`few-degree` 4.33、`subject-measure-word` 3.86、`baguwen.vague-amount-noun` 3.41（逐章 15/16）、`vague-transition-phrase` 3.14、`absolute-claim-modifier` 3.14。
- **外部检测器对照（环②/④/漏网三挂载点的地基验证）**：HF 检测器 **AUC 0.941 ≫ llmlint 0.681**（同口径 rocAuc、同语料）；reference P(AI) 中位 0.285 / render 0.907。**证实"外部检测器是强 oracle 地基、不是对手"**——llmlint 差异化在可解释而非检测准确率；0.941↔0.681 的 gap = 检测器抓到但规则漏掉的样本 = **新规则矿**。
- **模型榜 ⚠ 混面板 caveat**：doubao docScore 16.02 / 外部 P(AI) 0.747 双榜"最像人"，**但 doubao 只 render 了 gongdou（宫斗短章）**，是体裁混淆不是模型更强；deepseek（25.60 / 0.945）、mimo（29.19 / 0.923）覆盖全 5 组可比。
- **预算自校准生效**：charsPerToken 1.5 → 1.275（真跑 est vs actual 修正，写回 budget-calibration.json）。
- **断点续跑真实演练**：中途停/换面板重启，已完成 brief/render 全部跳过，只补缺格。

**遗留**：doubao 新组补齐（3 模型均衡）、gemini/glm 上量、CLI transport 端到端（换可达 provider）留给后续正式轮。

## 验收对照（计划 5 条；⚠ 两条已由补充轮关闭，2026-07-08 回写）
1. `bun test` 89/89 过（含 model-client/hardening/chunk/metrics）✅
2. report.json：新题组进 lift ✅、detector 对照节有数（AUC 0.941）✅、≥1 CLI 模型 render ✅（M4 当轮上游不可达曾降级 ⚠ → 补充轮 1/5 关闭：codex/gpt-5.5 与 claude-opus-4-8[1M]、claude-fable-5[1M] 均经 proxy 端到端产出 render 入面板）
3. 断点续跑实测 ✅
4. 密钥合规：eval.config.json 已 gitignore、example 无 key ✅
5. CLI 模型输入等价性 ✅（M4 当轮因上游不可达未比对 ⚠ → 补充轮 1 关闭：codex 经 stdin/合并契约对同 brief 产出干净 88 字 render，JSONL 解析无 banner 污染、usage 真实回报 in12.7k/out388）

## 补充轮：proxy + CLI 端到端 + provider 可用性排查（2026-07-03）

**根因：所有 provider 访问要走 http proxy（本机代理）。** 上一轮"CLI 挂起/Reconnecting"全是**没走代理**导致——中转网关 TLS 握手在 schannel 阶段就断（curl exit 35 / http 000）。deepseek/HF 恰好直连能通才造成"只有 CLI 坏"的假象。

**改动**：`eval.config` 加 `proxy` 字段 → generate.ts/detect.ts 启动时设 `HTTP(S)_PROXY` 进程 env（**Bun fetch（pi-ai HTTP）+ spawn 子进程（CLI）都走代理**）+ `resolveCliModel` 也把 proxy 注入 CLI 子进程 env。codex 输出改用 `--json` JSONL，新增 `parseCodexJson`（取末条 `item.completed` 且 `item.type=agent_message` 的 text + turn.completed 的 usage），output 类型扩为 `text|claude-json|codex-json`。

**CLI transport 端到端验证 ✅（终于）**：codex/gpt-5.5 经 proxy 对一段科幻 brief 产出干净 88 字 render（JSONL 解析无 banner 污染、真实 usage in12.7k/out388、预算自校准 0.958、落盘）。这是 CLI transport 首次真正端到端跑通。

**provider 可用性排查（用户要的"哪些确实不能用"）**：

| provider / 模型 | transport | 结论 | 证据 |
|---|---|---|---|
| **relay-codex / gpt-5.5** | CLI(codex) | ✅ **可用**（经 proxy） | 端到端产出 render，8s/次 |
| **relay-claude / claude-\*** | CLI(claude) | ❌ **后端 503**（暂不可用） | 经 proxy 连通但恒 `503 Service Unavailable`（含 opus-4-8/fable-5/sonnet；不带 1m-context header 时是 400"请启用 1m 上下文"，带了 header 转 503） |
| **elysiver-glm / glm-5.2** | HTTP | ❌ **无权限**（不可用） | 16/16 终态 `403 无权访问 glm-5.2-shared 分组` |
| **doubao / seed-2-1-pro** | HTTP | ⚠ **flaky** | 短章可出、长章反复 `240s 超时`（gongdou/light-novel 全出，wuxia 6 中仅 1，wuxianliu 0） |
| **elysiver-gemini / gemini-3.1-pro** | HTTP | ✅ 可用但**篇幅失控** | 16/16 出，但 36–7361 字乱飘（常大幅超 ref） |
| deepseek-v4-flash / mimo-v2.5-pro | HTTP | ✅ 稳定 | 全 5 组齐 |
| bailian / qwen3.6-plus | HTTP | ❌ 缺 key | config.json 该 provider 无 apiKey |

**补齐后最终面板（82 render / 4 可用模型）**：deepseek+mimo 全 5 组齐；gemini 3 组（gongdou/light-novel/wuxia）；doubao 部分；glm 0（死）。AUC **0.664**、**强判别升到 9**、holdout test 0.778、外部检测器 **AUC 0.944**（ref P(AI) 0.285 / render 0.923）。模型榜 docScore：doubao 16.51 < gemini 21.79 < deepseek 25.60 < mimo 29.19；外部检测器 P(AI)：doubao 0.716 < mimo 0.923 < gemini 0.939 < deepseek 0.945——**两个独立检测器都判 doubao 最不像 AI**（但都受 doubao 只 render 短章混淆，deepseek/mimo 最可比）。

**遗留**：claude 系待中转网关后端恢复再验；doubao 长章超时是模型行为（byModel 显形，不修）；glm-5.2 需账户开通 shared 分组权限；gemini 篇幅失控可加长度约束档。

## 补充轮 2：claude/doubao 问题攻克（2026-07-03，调研中转网关的多账号管理 + doubao/gemini）

参考一个多账号管理器的做法（账号轮换、keepalive/preempt）后，**claude 与 doubao 都攻克**：

- **claude ✅ 端到端跑通**（此前"503"是误判）。两个真因：① 之前那个 key 属于**额度耗尽的账号** → 换一个有额度账号的 key 后不再 503。② 中转网关用**模型名 `[1M]` 后缀**启用长上下文——裸 `claude-sonnet-4-5` 报 400"请启用1m上下文"，`claude-opus-4-8[1M]` 直接成功。线索来自 shell env 里现成的模型名后缀。中转网关调 claude 的方式与我们的 CLI transport 完全一致（`claude -p --model` + 同 env），差别只在 key 和模型名。**`claude-opus-4-8[1M]` 经 pipeline 产出干净 render**（in3.7k/out371）；sonnet[1M] 偏慢易超时（claude timeout 提到 300s）。
- **doubao ✅ 换模型解决**。`doubao-seed-2-1-pro` 是**推理模型**，长章（brief 长）时思考烧满 240s 墙钟 → 超时。换**写作模型 `doubao-seed-character-251128`**：同一条 tianlong 长章（4064 字 ref）**13.7 秒**产出 2948 字正规武侠正文（vs 2-1-pro 的 240s×3 全超时）。默认面板已改用 character。
- **gemini：非损坏，但两个毛病**。① 篇幅偏长（1791–2619 字连贯散文，无 markdown/作者注，只是话多）；② **偶发安全拒答被当 render 写入**——`zhenhuan-zhuan/render-0005` 是 36 字 "我必须绕过该话题…"。**已加拒答/截断守门**（render < min(400, 目标×0.2) 字判伪 render 跳过），并删除该污染样本 + 从 meta 摘除。
- **bailian（本地密钥文件里的 qwen3.7-plus/qwen3.6-plus/kimi-k2.6/MiniMax-M2.5）：config.json 里 bailian `apiKey` 为空**，且无其它 provider 供这些模型 → **需要一个百炼(dashscope)key 才能用**（待用户提供）。

**更新后 provider 结论**：✅ deepseek / mimo / **doubao-seed-character-251128** / gemini(话多+加了拒答守门) / codex-gpt5.5(CLI) / **claude-opus-4-8[1M](CLI，需有额度账号key)**；❌ glm-5.2(403无权限)、bailian(缺key)、doubao-seed-2-1-pro(推理超时,已弃)。默认 render 面板 = deepseek+mimo+doubao-character+gemini（4 稳定），CLI/claude 需要时 `--models` 显式加。

## 补充轮 3：超时可配 + bailian 禁用 + brief 溯源（2026-07-03）

- **doubao 超时加大（用户要求）**：`model-client.ts` 原有 240s **硬上限** `capMs=min(provider.timeoutMs,240s)` 会截断任何更长的 provider 超时。改：① `HARD_TIMEOUT_CAP_MS` 240s→**600s**（给推理模型长章足够时间；⚠ 副作用=真挂起的兜底也变 600s）；② eval.config 加 **`providerTimeouts`**（providerId→ms）经 `resolveAnyModel` 覆盖 HTTP 模型墙钟。配 `{"doubao": 600000}` → doubao 有效超时 600s（实测 resolve 生效）。这样只 doubao 放宽、其它模型仍走各自 provider 默认。
- **bailian 禁用不测（用户要求）**：renderModels 已不含 bailian；example 加 `$note_bailian` 说明"config.json 里 bailian apiKey 为空，需补百炼(dashscope) key 才能用"。
- **brief 溯源（用户问）**：brief 生成模型 = `extractor` = **`xiaomi-token-plan-cn/mimo-v2.5-pro`**（可换）；prompt = `generator/prompts.ts` 的 **`brief-v2`**（"剧情拆解助手"，只记剧情内容、严禁文体，守 I1；输出 题材视角/人物/节拍/信息控制/情绪走向，maxTokens 4000）。
- 配置最终态：`renderModels = deepseek + mimo + doubao-seed-character-251128 + gemini`，`extractor = mimo`，`proxy = 127.0.0.1:7890`，`providerTimeouts.doubao = 600s`，`cliProviders` claude(opus-4-8[1M]/300s) + codex(gpt-5.5)。测试 105/105、tsc 0、无密钥泄漏。

## 补充轮 4：干净均衡面板重评（2026-07-03，禁 doubao + 扩样本）

用户要求"扩大样本 + doubao 也禁用"。删除全部 doubao render（14 条，文件+meta），面板改为 **deepseek + mimo + gemini 三模型**，补齐到每组每模型齐全（gemini 补 wuxianliu/lotm）。**首次得到均衡面板**：deepseek 26 / mimo 26 / gemini 25（一条 gemini 对无限恐怖恐怖章的安全拒答被拒答守门 28 字挡下）/ 77 render。

**去掉 doubao 混淆后判别信号显著变强**（同语料同规则）：
| 指标 | 混面板(82,含doubao) | **均衡(77,无doubao)** |
|---|---|---|
| llmlint AUC | 0.664 | **0.727** ↑ |
| 强判别规则 | 9 | **15** ↑ |
| holdout test AUC | 0.778 | **0.807** ↑ |
| 外部检测器 AUC | 0.944 | **0.968** ↑ |

- 强判别 top：`repeated-de-pairs` 5.37 / `rough-manner-modifier` 4.75 / `few-degree` 4.54 / `vague-transition-phrase` 4.33 / `baguwen.vague-amount-noun` 3.87(15/16)。
- **模型榜现在可比**（均衡面板）：docScore gemini 22.26 < deepseek 25.60 < mimo 29.19；外部 P(AI) mimo 0.923 < deepseek 0.945 < gemini 0.969。
- **有意思的分歧**：gemini 在 llmlint 上最"像人"（docScore 最低 22.26，话多但规则密度低），在神经检测器上却最"像 AI"（P(AI) 0.969 最高）——**它的啰嗦干净散文躲过了表层规则、却被神经检测器抓住**，正是"漏网新规则矿"的活案例（环③新规则来源）。
- doubao 之前"双检测器最像人"确认是**混淆假象**（只 render 短章）——移除后该伪结论消失。

## 补充轮 5：加中转网关 CLI 模型（2026-07-03，用户要求试 gpt-5.5/claude 系）

把中转网关的 5 个模型逐个 smoke（经 proxy + 有额度账号 key）：**gpt-5.5 ✅、claude-opus-4-8[1M] ✅、claude-fable-5[1M] ✅**；**claude-opus-4-6 已下线、claude-opus-4-7 两次 180s 超时无输出**（claude 延迟受账号队列/挤占主导）。把 3 个可用的加进面板生成——**全量 26×3 太慢**（claude 队列，~2.5hr），跑到 gongdou 全 + light-novel 部分即停（各模型 n=7–8，宫斗+轻小说 2 体裁；孤儿 render 已补进 meta）。

**最重要发现——两检测器交叉对照暴露 claude 的隐身能力**（每模型 llmlint docScore vs 外部神经检测器 P(AI)）：

| 模型 | llmlint docScore（越低越像人） | 外部 P(AI)（越低越像人） | n |
|---|---|---|---|
| gemini-3.1-pro | 22.26 | 0.969 | 25 |
| deepseek-v4-flash | 25.60 | 0.945 | 26 |
| gpt-5.5 | 25.72 | 0.941 | 8 |
| **claude-fable-5[1M]** | **27.16** | **0.071** | 7 |
| **claude-opus-4-8[1M]** | **28.52** | **0.130** | 8 |
| mimo-v2.5-pro | 29.19 | 0.923 | 26 |

- 除 claude 外**所有模型两检测器一致**（高 docScore ↔ 高 P(AI)，都被判 AI）。
- **claude 系是唯一反例**：外部神经检测器判它**近乎人类**（P(AI) 0.07–0.13，读作 87–93% 人类），是所有模型里最难被神经检测的中文 AI 文本；**但 llmlint 的可解释规则仍抓住它**（docScore 27–28 ≫ 人类 19.48）。
- **这是 llmlint 价值主张的最强证据**：当黑盒神经检测器在最强模型（claude）上失效时，规则 linter 仍能顶出 AI 味、且能指出**是哪条规则**。对照 gemini（llmlint 漏、神经抓）恰好互补——**两个检测器各有盲区，规则库 + 神经检测器联用才完整**（呼应四环体系"检测器是地基不是对手 + 漏网探测器"）。
- ⚠ caveat：CLI 模型 n=7–8（仅 宫斗+轻小说 2 体裁），非 5 体裁全覆盖；claude"读作人类"是 15 样本 2 体裁的强信号，值得深挖但非终论。外部整体 AUC 因 claude 拉低到 0.870（不是回归，是 claude 难检测把 AI 分布拉向人类侧）。
- 可用 provider 追加：gpt-5.5(codex)、claude-opus-4-8[1M]、claude-fable-5[1M]（均 CLI，需 proxy+有额度账号 key）；claude-opus-4-6(下线)/4-7(超时) 不可用。

## 后续演进与交接（2026-07-07/08，跨任务链接）

本任务 Goal（M1→M4）已于 2026-07-03 全部完成，无未竟里程碑。用户 2026-07-07 指令转向「web + llm render helper 两条通路」，以下是**建立在本管线之上**的后续演进，实现细节归各自 walkthrough，此处记录对本管线的增量与配置漂移：

- **线 A repair 一轮循环（[Task 14](../14-line-a-repair-loop/README.md)）**：直接复用本任务 M2 的全部硬化设施（eval.config 双文件、限流/重试/token 预算、断点续跑、拒答守门口径）与 M3 的检测器 sidecar 缓存；generator 新增 `repair.ts` + `repair-v1` prompt（I8 版本化注册表扩展）；**meta 契约新增 `repairOf` 字段**（METHODOLOGY §6 已同步）；`report.repair` 配对统计（不触 lift/AUC，零漂移验证）。首批 5 对：docScore 中位 25.32→19.58（−20%）而神经检测器仅 −0.7pp——**表层规则一轮修复撼不动神经检测器**，与补充轮 5 的盲区互补结论同向。
- **eval.config 配置漂移（用户拍板，Task 13 D-E）**：`classifier.model` 与 `repair.model` 由 deepseek 改为 **`xiaomi-token-plan-cn/mimo-v2.5-pro`**（LLM 通道统一先用 mimo）；renderModels/extractor/proxy/cliProviders 不变。
- **M3 检测器口径进 web（[Task 13](../13-web-five-step-flow/README.md) W3）**：`detector/chunk.ts` 句界分块纯函数经 alias 复用进 nitro 服务端，gradio 协议/P(AI) 换算/长度加权聚合同算法落 `MachineDetect`（含热力图 chunksJson）；nitro=node 侧代理用 `node-fetch-native/proxy` dispatcher（Bun env 注入方案不适用于 undici，本任务补充轮 1 的 proxy 结论在 node 侧的等价物）。
- **report 判别产物进产品（Task 13 D-D）**：`report.json` 的 per-rule verdict 构建期烘进 web `registry.json`（160 条，strong 7），驱动「强判别静态替换」过滤——**发现 strong∩auto 当前为空集**（7 条 strong 全 candidate），产品级一键清理近不可见属数据现状。

仍属未来工作（归 METHODOLOGY §7 路线图，不归本任务）：M3-C brief/extractor 元评测、M4-of-方法论 的 realism 难度档与 critic、doubao/gemini/claude 面板均衡上量。
