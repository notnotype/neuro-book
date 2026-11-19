# Task 14 — 采集线 A：LLM 修复一轮循环（repair loop）

> M4 的 repair 部分（METHODOLOGY §2.3 最后一段）：对已有 render 做 **render → 本地评测 → LLM 润色出 repair → 复测** 的一轮闭环，产出 before/after 数据并进报告。只做一轮，不做多轮循环；realism / critic 不在本任务。
> 权威规范：[../../CONTEXT.md](../../CONTEXT.md)（重点 **I5** repair 单独统计、**I8** prompt 版本化、**D1** repair 绝不进 lift/AUC）、[../../evals/METHODOLOGY.md](../../evals/METHODOLOGY.md)（§2.3 线 A 一轮即止、§6 meta 契约）。

## User Request / Topic

跑通「采集线 A 的 LLM 修复一轮循环」（llm render helper 通路）：

1. repair prompt 版本化（`repair-v1`），输入 = render 正文 + llmlint 命中摘要（agent 桶、按规则聚合、控长度），要求只修列出的问题、保剧情/人物/视角/篇幅（±20%）、只输出正文；提示词自包含，不带项目内部术语。
2. repair CLI（仿 generate.ts）：遍历 render → 同口径本地扫描 → 组 prompt → 经 model-client 调 `eval.config.repair.model` → 拒答守门 → 写 `repair-*.md` + 更新 meta（`repairOf` 新字段）；断点续跑、单篇失败只跳该篇。
3. meta 契约扩展 `repairOf`（METHODOLOGY 仅改 §6 蓝图 + §7 M4 行）。
4. 消费侧：corpus 透传 → metrics/report 新增 `repair` 报告节（docScore before/after 配对；detector sidecar 覆盖时报外部 P(AI) before/after）→ score.ts 组装 `report.repair`。**红线：不动 lift/docScore/AUC/holdout 任何计算路径。**
5. 配置：`eval-config.ts` 加 `repair?: {model, promptVersion?}` + 双 json。
6. 小验证轮真调 API（2 题组 × 各 2 篇 render，覆盖不同 render 模型）+ detect.ts 补外部分 + score 出报告。
7. 纯函数测试（prompt 组装、配对统计）。

## 关键决策

| 决策 | 内容 |
|---|---|
| repair 文件命名 | **源 render 文件名把 `render-` 前缀换成 `repair-`**（idx 与源 render 模型 slug 原样保留），如 `render-0001-deepseek-deepseek-v4-flash.md` → `repair-0001-deepseek-deepseek-v4-flash.md`。一篇 render 对应至多一份 repair（一轮口径）；修复模型记在 meta 的 `model` 字段，不进文件名。 |
| meta 条目形状 | `{file, role:"repair", model:<修复模型>, pairRef:<沿源 render>, repairOf:<源 render 文件名>, charCount, promptVersion:{repair:"repair-v1"}}`——promptVersion 记在**样本级**（组级 promptVersion 描述的是 render 生成，repair 独立成轮）。 |
| 问题清单口径 | 只取 `review==="agent"` 桶（human/none 是作者偏好/机械诊断，不驱动改写）；按规则聚合、命中数降序；三层封顶控 prompt 长度（≤25 规则 × ≤3 条去重引文 × ≤40 字/条），`repair-prompt.ts` 纯函数可单测。 |
| 拒答守门 | 输出可见字数 `< min(400, 原文可见字数×0.5)` 判失败，丢弃并记日志（伪 repair 会污染 before/after）。 |
| 外部分查表方式 | score.ts 读 detector sidecar 后**按当前正文重算内容 hash 查分**（key 算法抽到 `detector/scores.ts` 单一真相源，detect.ts 写侧共用）——内容一变即查不到=视为未打分，杜绝按文件名索引的陈旧分数。 |
| repair 进外部检测器 | detect.ts 的打分范围加入 `role:repair`；但 summary（外部 AUC/中位）仍只按 reference/render 汇总，repair 不进外部 AUC。 |
| `--limit` 语义 | 本轮最多**尝试生成**的篇数；已存在跳过不计 → 重跑同命令会继续补缺（断点续跑语义，见「与计划的出入」①）。 |
| 外部口径对称性 | `report.repair` 的外部统计只在「before/after 两侧都覆盖」的对上算，避免集合不对称造成伪差；HF 缺分允许缺省，不阻塞 docScore 口径。 |

## 变更文件

**生成侧**
- `evals/generator/prompts.ts`：注册 `repair-v1`（自包含系统提示词）+ `REPAIR_PROMPTS` / `repairPrompt()`；`DEFAULT_PROMPT_VERSIONS` 加 `repair`。
- `evals/generator/repair-prompt.ts`（新）：`collectRepairFindings`（agent 桶过滤/按规则聚合/引文去重截断/三层封顶）+ `buildRepairUser`，纯函数。
- `evals/generator/repair.ts`（新）：commander CLI（`--corpus/--genre/--plot/--model/--limit/--repair-model/--config/--eval-config/--check`）；复用 proxy/限流/重试/预算设施；断点续跑；拒答守门；meta merge。
- `evals/generator/eval-config.ts`：`RepairConfig` 类型 + `EvalConfig.repair?`。
- `evals/eval.config.example.json` / `evals/eval.config.json`（gitignored）：`repair` 节（model=deepseek/deepseek-v4-flash，promptVersion=repair-v1；无任何密钥进 git）。

**消费侧**
- `evals/lib/scan.ts`：抽出 `loadEvalRules()`（scanAll 与 repair 共用，保证同口径规则加载）。
- `evals/lib/types.ts`：`Sample.repairOf` + `RepairPair`/`RepairStat` + `Report.repair`。
- `evals/lib/corpus.ts`：透传 `repairOf`。
- `evals/lib/metrics.ts`：`computeRepairStat()`（纯函数；repair 唯一消费口，主统计路径未动一行）。
- `evals/lib/report.ts`：`buildReport(..., repair)`。
- `evals/score.ts`：读完整 detector sidecar → `externalPAiByFile`（hash 查表）→ `computeRepairStat` → `report.repair`；摘要打印加 Repair 行。
- `evals/detector/scores.ts`（新）：sidecar 契约 + `detectorCacheKey()` 单一真相源。
- `evals/detector/detect.ts`：打分范围加 repair；cacheKey/类型改用 scores.ts（summary 计算未动）。

**测试 / 文档**
- `evals/generator/repair.test.ts`（新，5 测试）：清单聚合 4 项 + user 消息组装。
- `evals/lib/metrics.test.ts`（+3 测试）：docScore 配对/孤儿、外部覆盖子集口径、repair 不进主判别（I5）。
- `evals/METHODOLOGY.md`：**仅** §6 蓝图（`repairOf`、样本级 `promptVersion:{repair}`、role:repair 一行说明）+ §7 M4 行状态。
- `evals/README.md`：用法加 repair 一行 + 语料速览加 `repair-<idx>-<slug>.md`。
- 本文档。

## 验证结果（真实数字）

**跑前基线快照**（`evals/report/report.json`，2026-07-07 抄录；minSupport=3、holdout 未启用、CLI 探针混面板口径）：

- 规模：5 题组 / 26 reference / 100 render / 0 repair；activeRegexRules 303；命中规则 160。
- llmlint 检测器 **AUC 0.7427**（docScore 中位 人类 19.4755 / AI 25.1985，误杀 8.9443）；强判别 7 / anti 0。
- 外部检测器 **AUC 0.8704**（reference P(AI) 中位 0.2850 / render 0.9240，覆盖 26/100）。

**无漂移验证**：① 代码改动后、repair 生成前重跑 `score --min-support 3` → 上述全部数字逐位相等，`repair: null`；② repair 5 篇入库 + detect + score 后复核 → 核心数字仍逐位相等（AUC/中位/误杀/强判别数/规则数/外部 AUC 与中位/render·reference 计数均不变），仅 `counts.repair` 0→5、新增 `report.repair`。

**小验证轮**（修复模型 deepseek/deepseek-v4-flash，repair-v1，经 proxy；5 篇约 37k token）：

| 题组 | 源 render（模型） | docScore before→after | 外部 P(AI) before→after |
|---|---|---|---|
| gongdou/zhenhuan-zhuan | render-0001（gemini-3.1-pro） | 24.88 → 21.60 | 0.9231 → 0.8905 |
| gongdou/zhenhuan-zhuan | render-0001（deepseek-v4-flash） | 26.95 → 22.89 | 0.9851 → 0.9777 |
| gongdou/zhenhuan-zhuan | render-0002（deepseek-v4-flash） | 26.78 → 19.58 | 0.8720 → 0.8443 |
| light-novel/villain-loli | render-0001（mimo-v2.5-pro） | 25.32 → 18.88 | 0.9211 → 0.9190 |
| light-novel/villain-loli | render-0001（gpt-5.5） | 23.18 → 18.35 | 0.9723 → 0.9714 |

`report.repair` 聚合：配对 **5**（孤儿 0）｜docScore 中位 **25.32 → 19.58**（配对差中位 **−4.82**/千字，约 −20% 相对降幅）｜改善 **5/5**｜外部 P(AI) 中位 **0.9231 → 0.9190**（配对差中位 **−0.0074**）｜下降 **5/5**（覆盖 5/5，HF 本轮稳定无跳过：126 缓存命中 + 5 新打分）。

**解读（如实）**：一轮修复对 llmlint docScore 降幅显著（毕竟问题清单就是照规则开的，属预期内的"应题作答"）；但外部神经检测器 P(AI) 只微降（中位 −0.7pp，最大单篇 −3.3pp，五篇仍全在 0.84+）——**表层规则修复几乎撼不动神经检测器**，与 Task 08 的"两检测器盲区互补"发现一致，也正是 D5 验收要"多检测器 + 人评"双条件的实证。repair 数据可信度低（机器自监督），终审仍归采集线 B 人评。

**其它验证**：`tsc --noEmit` 0 错误；`bun test evals` **39/39**（含新增 8 测试）；fixture 自检 AUC 1.000 正常；断点续跑实测（重跑已存在文件复用、仅重登 meta）；repair 正文抽查干净（无 markdown 代码块/解释/标题）；篇幅全部在 ±20% 内（2226→2184、2211→2176、3713→3602、3236→3160、2427→2400）；密钥合规（新改动无任何 key 进 git 文件，eval.config.json 本就 gitignored）。

**复现命令**：

```bash
bun evals/generator/repair.ts --check
bun evals/generator/repair.ts --genre gongdou --plot zhenhuan-zhuan --model deepseek/deepseek-v4-flash --limit 1
bun evals/generator/repair.ts --genre gongdou --plot zhenhuan-zhuan --model elysiver-gemini/gemini-3.1-pro --limit 1
bun evals/generator/repair.ts --genre light-novel --plot villain-loli --model xiaomi-token-plan-cn/mimo-v2.5-pro --limit 1
bun evals/generator/repair.ts --genre light-novel --plot villain-loli --model relay-codex/gpt-5.5 --limit 1
bun evals/detector/detect.ts        # 旧样本走 sidecar 缓存，只对 repair 新打分
bun evals/score.ts --min-support 3  # report.repair 出数
```

## 与计划的出入

1. **验证轮 5 篇而非 4 篇**：验证断点续跑时重跑了第一条命令，`--limit`"已存在跳过不计"的语义使其复用 repair-0001 后继续补生成了 repair-0002-deepseek。语义符合设计（断点续跑=继续补缺），多出的一篇如实保留为数据点。
2. **detect.ts 顺带小重构**：cacheKey/缓存类型抽到 `evals/detector/scores.ts`——score.ts 读侧需要同一 hash 算法查逐篇分，抽共享模块而非复制算法（防写读两侧漂移），summary 计算未动。
3. **HF 免费实例本轮稳定**：计划里"超时/失败则跳过"的降级路径未触发（代码里保留：单篇检测失败跳过、`report.repair` 外部字段允许缺省）。
4. 其余按计划落地：meta 样本级 `promptVersion:{repair}`、METHODOLOGY 只动 §6/§7-M4、未触碰 PROJECT-STATUS / CONTEXT / web / 13 号任务。

## TODO / Follow-ups

- **扩量**：当前仅 5 篇验证轮；全量 render（100 篇）跑 repair 后 before/after 统计才有面板级说服力（预算 ≈ 全量 render 的 1.5–2 倍 token）。
- **多修复模型对比**：目前只有 deepseek 做修复者；换 claude/gemini 修复者的 before/after 对比（谁更会"去 AI 味"）值得一轮。
- **清单封顶的残留**：问题清单 ≤25 规则封顶，命中类目超限的长章一轮修不完；可做"复扫 repair 残留命中"报表或第二轮（本任务按规范一轮即止）。
- **web 报告页展示 `report.repair`**（web/ 本任务禁改，留给 web 侧任务）。
- realism 难度档 / critic 评分员（M4 其余部分）未建。
