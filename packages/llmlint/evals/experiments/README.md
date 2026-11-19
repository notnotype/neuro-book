# evals/experiments — 元评测

这里放**回答「某个做法有没有用」**的一次性实验，与 `evals/score.ts` 那条常规判别力流水线分开：常规流水线量的是「每条规则区分 AI 与人的能力」，实验量的是「我们对生成或修复做的某个改动，有没有让输出更好」。

产物不进主语料 `evals/corpus/`：主语料固定 `render-v1`，而实验通常要换 render prompt 版本，混进去会触发 I8 的版本混用守门（`assertRenderPromptVersion`）。

## guide-arm：写作期约束有没有用

**问题**：把规则库投影成动笔前的写作约束（`llmlint guide`）注入系统提示词，输出是不是真的少了 AI 痕迹？这是 `llmlint guide` 这个能力唯一的验收依据——在此之前没有任何证据表明注入规则能改善输出。

**设计**：同一批 brief 上跑两臂，唯一变量是系统提示词里有没有约束块。

- 两臂都用 `render-v2`。空约束时它与 `render-v1` **逐字节等价**（`generator/prompts.test.ts` 守），所以差异只剩注入这一件事。
- **对照臂现生成，不复用主语料的历史 render**：那批是几周前产出的，直接拿来当对照会把模型漂移混进结论。
- 逐 brief 逐模型**两臂紧挨着跑**，让限流抖动与服务端波动对两臂等量作用。
- brief 复用主语料已有的，不重抽——重抽会引入第二个变量（I3 配对同源）。
- 每个题组的 `meta.json` 保存同一份完整 guide provenance：tier、profile、最终选中规则集合/数量和实际注入文本。三个指纹都是 `sha256:<64 lowercase hex>`；生成续跑、dry-run 与 `guide-compare` 都会先重建 guide 并逐字段核对，再读取或扫描样本。
- v2.0.1 的既有实验保留在 `guide-arm/` 与 `guide-arm-report/`，不拿 v3 guide 伪装回填。v3 的 guide 文本已变化，因此当前比较器会拒绝把这些旧样本当作 v3 结果；要得到 v3 结论必须写入新的 `guide-arm-v3/`。本轮只建立独立目录和 dry-run，不调用模型重跑。

```bash
# v3 新批次生成（缺省输出 guide-arm-v3；可续跑，旧 guide-arm 不会混入）
# 模型面板逐个跑：gemini / mimo 换 --models 值，其余参数必须一致
bun evals/experiments/guide-arm.ts --models deepseek/deepseek-v4-flash --tier standard --profile evals/report/report.json
bun evals/experiments/guide-arm.ts --dry-run --models deepseek/deepseek-v4-flash --tier standard --profile evals/report/report.json

# v3 外部检测器打分（主指标的来源）
bun evals/detector/detect.ts --corpus evals/experiments/guide-arm-v3 --out evals/experiments/guide-arm-v3-report

# 配对比较（--tier / --profile 必须与生成时一致，否则注入/留出集合对不上——
# 本轮实测踩过：漏掉 --profile 后注入集合 71→66，留出/注入两行数字全错，
# 而 docPAi / docScore / 字数三行不受影响，错得非常安静）
bun evals/experiments/guide-compare.ts --arm evals/experiments/guide-arm-v3 \
    --tier standard --profile evals/report/report.json \
    --detector evals/experiments/guide-arm-v3-report/detector-scores.json

# 多模型语料必须先用 --model 分层看；合并数字只作总览（见下面「合并跑会撒谎」）
bun evals/experiments/guide-compare.ts --arm evals/experiments/guide-arm-v3 \
    --tier standard --profile evals/report/report.json \
    --detector evals/experiments/guide-arm-v3-report/detector-scores.json --model gemini
```

**指标分三层，不能混**：

| 层 | 指标 | 为什么 |
| --- | --- | --- |
| 主指标 | 外部 AIGC 检测器 docPAi | 与规则库完全独立，不受循环论证影响 |
| 主要佐证 | **留出规则**命中 / 千字 | 注入某档后档外规则也该跟着降；只有注入的那批降 = 模型只是躲开了被告知的词 |
| sanity | 注入规则命中、整体 docScore | **循环**：把 llmlint 的规则塞进提示词再用 llmlint 数命中，近乎同义反复。只用来确认注入确实生效 |

判读：

- 主指标降 **且** 留出规则降 → 有证据支持。
- 只有注入规则降、留出规则不降 → 表层规避，不要采纳。
- 主指标不降 → 无论 docScore 降多少都不构成证据。

**结果（2026-07-27，三模型面板，各 26 对；档位 standard + profile，注入 71 / 留出 195）**：

| 指标（control → guide，中位） | deepseek-v4-flash | gemini-3.1-pro | mimo-v2.5-pro |
| --- | --- | --- | --- |
| 外部检测器 docPAi（主指标） | 0.896 → 0.776｜20/26｜**p=0.009** | 0.977 → 0.972｜17/26｜p=0.169 | 0.915 → 0.897｜14/26｜p=0.845 |
| 留出规则 / 千字（主要佐证） | 7.99 → 7.01｜20/26｜**p=0.009** | 10.34 → 9.82｜17/26｜p=0.169 | 9.21 → 7.57｜18/26｜p=0.076 |
| 注入规则 / 千字（sanity） | 1.72 → 1.47｜12/26｜p=0.845 | 0.69 → 0.69｜17/26｜p=0.169 | 2.33 → 2.02｜11/26｜p=0.557 |
| docScore / 千字（循环） | 8.81 → 7.95｜17/26｜p=0.169 | 10.44 → 8.93｜17/26｜p=0.169 | 10.32 → 9.61｜20/26｜p=0.009 |
| 可见字数 | 4085 → 3930｜15/26｜p=0.557 | 3613 → 2651｜23/26｜**p<0.001** | 3949 → 3437｜18/26｜p=0.076 |

人类参照（同题组 reference，26 篇）：留出规则 2.33 / 千字，docScore 2.47 / 千字。

**三个模型是三种画像，不能合并成一句话**：

- **deepseek：有证据支持注入**。主指标与留出规则同降（各 20/26、p = 0.009，预注册两指标按最严的 α = 0.01 也过）。最有信息量的是不显著的 sanity 行：如果模型只是躲开被告知的词，最该降的恰恰是注入规则命中；它没降而档外 195 条和外部检测器都降了，排除了「表层规避」这个主要替代解释。篇幅只动 89 字，约束没把它逼成惜字如金。三模型里唯一同时满足判读口径两条的。
- **gemini：没有可测的收益，有实打实的代价**。质量三层全不显著（docPAi 只动了 0.003），可见字数中位掉 757 字（**−26%**，23/26，p < 0.001）——约束没让它少 AI 味，只让它少写。它的 control 基线 0.977 逼近检测器饱和区，小改善可能被压缩；但 deepseek 证明这个指标有向下的空间，gemini 就是没往下走。
- **mimo：方向一致但证据不足**。规则侧全线同向（留出 −1.74 / 千字、p = 0.076；docScore 20/26、p = 0.009）说明它确实照着约束改了写法，但外部检测器不为所动（14/26、p = 0.845）；篇幅 −333 字（−8%、p = 0.076）介于两者之间。26 对判不了它有效或无效，只能说没看到 deepseek 那样的信号。

**合并跑会撒谎**：78 对合起来跑，五行里四行显著（docPAi p = 0.009、留出 p < 0.001、docScore p = 0.001、字数 p < 0.001），读起来像「面板整体有效」。分模型拆开才看到：全部质量信号来自 deepseek，字数信号主要来自 gemini。这就是 `--model` 过滤器存在的理由——跨模型面板必须先分层看，合并数字只作总览。

**这轮面板顺带推翻了一条推断**：上一版结论写过「docPAi 基线 0.9+ 的模型有实测或强预期收益」。gemini 基线 0.969 是面板最高，实测收益为零、代价显著——**基线高只保证主指标可测（有下降空间），不保证注入有效**。收益必须逐模型实测，推不出来。

**同期的反向观察**：把 skill 装进 `~/.claude/skills/` 用 `claude -p` 实测时，Opus 5 读了 `guide` 之后照样写出「不是A，是B」——而那条就在 guide 第 42 行。它与本实验不矛盾，但**两个变量同时不同**（本实验注入 system prompt + deepseek；实测是 tool result 上下文 + Opus 5），需要一轮三臂最小实验拆开。详见 `.agents/tasks/23-skill-loop-and-service/README.md`。

**已知局限**（写进结论，不要略过）：

- **D5 只满足一半**。验收双条件是「检测概率下降 **且** 人评 `wantReadOn` 不降」；第 ② 层 critic 未建，人评拿不到，所以任何结论都是暂定的，不能据此宣布这个功能有效。
- **留出集合的耦合度**。`--tier standard` 注入 71 条、留出 195 条，而留出的大多是逐词替换类词表（`脊背→背`），与注入的结构类建议耦合较弱，降不降的信号偏钝。想要更硬的对照，可以把 66 条建议类规则随机对半分、注入一半留出一半——同类型同性质，留出半边该跟着降。那是机制实验，不是产品配置，另开一轮。
- **样本量**。`report()` 输出符号检验 p 值就是为了防止在十几对样本上过度解读方向；n=26 时大约要 18/26 才到 p<0.05。

## delivery-arm：旧批次无效，修复版待重跑

> **有效性更正（2026-07-31）**：旧 `delivery-arm/` 的 toolresult 命令漏传 `--profile`，因此 sysprompt 实际注入 71 条规则，toolresult 只得到 66 条；两个处理臂正文并不相同，投递位置不再是唯一变量。五组旧 meta 已标记 `invalid`，比较器会在扫描样本前拒绝它们。旧数表只能说明当时三个输出集合有差异，不能证明投递位置影响、模型强度是主因，或 Opus 5 的净收益方向；`control → sysprompt` 也只保留为描述性观察。

**问题**：`guide-arm` 显示注入约束有效（主指标 p = 0.009），但把 skill 装进 `~/.claude/skills/` 用 `claude -p` 实测时，Opus 5 读了 `guide` 之后照样写出「不是A，是B」——那条就在 guide 第 42 行。两个实验有**两个变量同时不同**：

| | 投递方式 | 写作模型 |
| --- | --- | --- |
| guide-arm | system prompt | deepseek-v4-flash |
| skill 实测 | tool result 上下文 | Opus 5 |

所以无法判断失败该归给投递位置，还是归给「强模型本来就不需要」。这个实验固定模型，只动投递方式。

**三臂**（都是 claude CLI 的 Opus 5）：

| 臂 | 约束在哪 |
| --- | --- |
| `control` | 不给约束 |
| `sysprompt` | system prompt（`--append-system-prompt-file`） |
| `toolresult` | tool result——prompt 要求先跑 `llmlint guide` 再动笔，还原真实 skill 路径 |

设计要点：

- 修复版把 profile 解析为绝对路径，并让 `sysprompt` 与 `toolresult` 使用同一 tier/profile。模型调用前真实运行一次同构 guide CLI，去掉 CLI 固有尾换行后与内存 guide 逐字节比较；不一致立即失败。
- **三臂的写作指令一律走 `--append-system-prompt-file`**，位置一致；user message 只放 brief（`toolresult` 臂额外前置一句取约束的指令）。否则「写作指令在哪」会变成第二个变量。
- `toolresult` 臂只给 `--allowedTools Bash`，它必须真的去跑 CLI 拿约束才算还原 skill 路径。跑没跑可以事后查 claude 的 session transcript。
- claude CLI 的 cwd 用系统临时目录：在仓内跑会让它自动发现 `AGENTS.md` / `CLAUDE.md`，把项目上下文混进写作任务。

```bash
# 生成（可续跑；--per-group 缺省 1，即每题组一章）
bun evals/experiments/delivery-arm.ts --profile evals/report/report.json
bun evals/experiments/delivery-arm.ts --dry-run --profile evals/report/report.json

# 打分
bun evals/detector/detect.ts --corpus evals/experiments/delivery-arm-v2 --out evals/experiments/delivery-arm-v2-report

# 三次两两比较（--arms 基线,处理）
for arms in control,sysprompt control,toolresult sysprompt,toolresult; do
    bun evals/experiments/guide-compare.ts --arm evals/experiments/delivery-arm-v2 --arms "$arms" \
        --tier standard --profile evals/report/report.json \
        --detector evals/experiments/delivery-arm-v2-report/detector-scores.json
done
```

**修复版未来判读**（尚未调用模型重跑）：

- `sysprompt` 明显优于 `toolresult` → 投递位置是主因，`guide` 在 Agent 宿主里需要换接入方式（不能只靠 Agent 跑一次 CLI 把输出读进上下文）。
- 两臂都不优于 `control` → 「强模型本来就不需要」，`guide` 的价值集中在弱模型，产品上应按模型分级建议。
- 两臂都优于 `control` 且彼此接近 → 投递位置不重要，skill 实测那次失败是单样本噪声。

**规模**：3 臂 × 15 章 = 45 次调用（`--per-group 3`，5 题组各 3 章；语料共 26 章可用）。脚本可续跑（已存在的文件跳过），扩到更多章是纯增量。

15 对时符号检验的可达 p：12/15 → 0.035，13/15 → 0.007。所以这个规模够做显著性结论，但只在效应明确时——效应量小的话 15 对仍然会给出「不显著」，那时该扩样本而不是改判读口径。

**旧批次描述性结果（2026-07-27，claude-opus-5，15 对；实验 invalid，不得作因果归因）**：

| 指标 | control | sysprompt | toolresult |
| --- | --- | --- | --- |
| 外部检测器 docPAi（主指标） | 0.241 | 0.230 | 0.149 |
| 留出规则命中 / 千字 | 4.696 | 3.071 | 4.804 |
| 注入规则命中 / 千字 | 1.105 | 0.301 | 1.601 |
| docScore 去重 span / 千字 | 5.349 | 3.462 | 6.138 |
| 可见字数 | 3098 | **2344** | 2980 |

逐对符号检验（负 = 处理臂更低）：

| 对比 | docPAi | 留出规则 | 注入规则 | docScore | 字数 |
| --- | --- | --- | --- | --- | --- |
| control → sysprompt | 9/15，p=0.607 | 11/15，p=0.118 | 11/14，p=0.057 | 12/15，p=0.035 | 13/15，**p=0.007** |
| control → toolresult | 12/15，p=0.035 | 7/15，p=1.000 | 8/15，p=1.000 | 7/15，p=1.000 | 8/15，p=1.000 |
| sysprompt → toolresult | 12/15，p=0.035 | 4/15，p=0.118 | 1/15，**p=0.001** | 1/15，**p=0.001** | 4/15，p=0.118 |

**多重比较**：这一轮有 3 个预注册对比 × 1 个主指标 = 3 个主要检验，Bonferroni α = 0.05/3 = 0.0167。两个 docPAi 的 p = 0.035 都**大于**该阈值，所以**主指标上没有任何对比在校正后显著**。规则侧 `sysprompt → toolresult` 的 p = 0.001 校正后仍然显著，但它是循环指标。

**当前结论：旧批次没有资格回答投递位置或 Opus 5 收益；下面四点只记录当时观测，不是有效实验结论。**

1. **`sysprompt` 确实让模型更遵守约束**：注入规则命中中位 1.105 → 0.301，与 `toolresult` 直接比是 1/15、p = 0.001（校正后仍显著）。约束进 system prompt 比进 tool result 有效得多，这一半的假设成立。
2. **规则侧 `sysprompt` 朝人类基线移动**：docScore 5.349 → 3.462（12/15、p = 0.035），人类参照是 2.47。留出规则 4.696 → 3.071 同向（11/15、p = 0.118）。
3. **但主指标不显著，而这一次不能读成「无效」**：`control → sysprompt` 的 docPAi 是 9/15、p = 0.607。原因见下面的基线表——**Opus 5 的 docPAi 基线（0.227）已经低于人类 reference（0.285）**，指标没有下降空间。本文件那条「主指标不降 → 不构成证据」的口径隐含假设是主指标有分辨力；在贴地板的模型上它不成立，此时 docPAi 既不能证实也不能证伪。
4. **篇幅代价是真实的**：`sysprompt` 中位 2344 字 vs `control` 3098 字，13/15、p = 0.007。目标字数是人类原章长度（中位约 3099），`control` 基本达标而 `sysprompt` 欠 24%。这正是 guide 抬头那句「不要为了绕开清单牺牲语义或可读性」想防的过度规避，**没防住**。规则命中降了、篇幅也降了，到底是「变简洁」还是「被削薄」，只有 D5 第二条件能判——所以这一轮的净收益是**未知**，不是负。

`toolresult` 臂 docPAi 反而最低（0.149，对 control 12/15）校正后不显著，且它的规则侧同时是三臂最差，两者矛盾，按噪声处理不做解读。

### 模型基线参考（决定主指标在哪些模型上可用）

来自主语料 100 篇 render + 26 篇 reference（`evals/report/report.json` 的 `externalDetector.byModel` 与 `modelRanking`）：

| 模型 | 外部检测器 docPAi | llmlint docScore / 千字 |
| --- | --- | --- |
| elysiver-gemini/gemini-3.1-pro | 0.969 | 10.76 |
| deepseek/deepseek-v4-flash | 0.945 | 7.64 |
| relay-codex/gpt-5.5 | 0.941 | 6.11 |
| xiaomi-token-plan-cn/mimo-v2.5-pro | 0.923 | 11.27 |
| relay-claude/claude-opus-4-8 | **0.130** | 7.25 |
| relay-claude/claude-fable-5 | **0.071** | 6.42 |
| **人类 reference** | **0.285** | **2.47** |

两件事从这张表读出来：

- **两个维度的排序不一致**。claude 系在 docPAi 上比人类还低，但规则侧仍是 6.4–7.25（人类 2.47），仍有 2.6 倍的模板负担。「躲过神经检测器」和「不写套路」是两回事，`guide` 与 `check` 分别对着这两件事。
- **主指标只在 docPAi 基线明显高于人类的模型上有分辨力**。gemini / deepseek / gpt-5.5 / mimo 都在 0.92+，`guide-arm` 在 deepseek 上能看到 0.896 → 0.776 正因如此。claude 系（含本轮 Opus 5）在地板上，测它们必须换主指标——候选是规则侧朝人类基线的距离，但那是循环指标，需要另设独立裁判（第 ② 层人评是唯一现成出口）。

**产品含义**：只保留有效 guide-arm 三模型证据：deepseek 有效、gemini 不建议默认注入、mimo 证据不足。旧 delivery-arm 不能支持任何 claude/Opus 分级，也不能用来判断 system prompt 与 tool result 的优劣；这些问题必须等 `delivery-arm-v2` 或独立人评。

**局限**：n=15；D5 第二条件仍拿不到，而这一轮恰恰出现篇幅显著缩短——最需要人评的正是这种情况；跨实验的模型比较不是配对设计，基线表来自主语料而非本实验语料。

## 语料合规

实验语料是本项目自产的 AI 正文，不含受版权保护的采集内容，随仓保存（与 `evals/corpus/` 的合规边界不同，见 I11）。
