---
name: llmlint
description: A Chinese-prose rule library with two entry points. Before writing, emit the rules as writing constraints to load into a system prompt or style guide. After writing, lint the draft with static rule hits, neural AIGC heatmaps, contextual review, approved repair, and local learning notes. Use when drafting or rewriting Chinese prose and you want to avoid AI writing tells up front, when you need a wording/sentence-pattern constraint list or style preset for a writer, and when reviewing Markdown or plain text for AI writing tells, naturalness, repetitive patterns, lint rules, repair plans, or llmlint configuration.
---

# llmlint

llmlint 的核心资产是一个中文正文规则库。它有**两个消费时机**，别只用后一个：

- **写之前**：`guide` 把规则投影成动笔前的写作约束，可以直接注入系统提示词或存成文风预设。规则库里有一类规则（语义规则）静态工具永远定位不到，模型读过是它们唯一的执行路径；对其余规则，事前不写也比事后重写便宜。
- **写之后**：`check` / `fix` / `detect` 在成稿上做稳定可复现的候选定位与外部 AIGC 热力图；Agent 结合语境复核、制定修复计划、在用户审批后改写，并把疑难判断沉淀为本地学习出口。

目标不是把规则命中或 P(AI) 清零，而是在守住原文事实、剧情功能、角色声音和文体意图的前提下，减少无功能的模板负担。静态命中和检测热区都是候选证据，不是修改命令。**写作约束同理**：某条写法在当前语境里承担剧情、人物声音、题材或载体功能时照写，不要为了绕开清单牺牲语义或可读性。

## Runtime

CLI 用 **Bun** 或 **Node + `tsx`** 运行。把 SkillCatalog 提供的绝对 `root` 记为 `<skill-root>`；若宿主 catalog 只提供 `SKILL.md` 的绝对 `location` / source locator，则使用其父目录。下文尖括号是占位符，执行前必须替换为实际绝对路径：

```bash
bun "<skill-root>/bin/llmlint.ts" <command>
```

裸 `node` 不能直接跑此 CLI。首次使用当前 skill，或依赖合同更新导致 `node_modules` 缺失时，必须先完成下方依赖门；不要先尝试 `status`，再等缺依赖报错。

## 写作期：动笔之前

用户要写正文、或要一份给写手用的文风约束时，先完成下面的依赖门，然后：

```bash
bun "<skill-root>/bin/llmlint.ts" guide
```

输出是 markdown，直接读或转交即可。它不需要任何输入文件——写之前没有文件可扫。

档位由 `--tier` 控制，由窄到宽是 `core < standard < wide < full`，缺省 `standard`：

- `core`：只有语义规则和有配对语料证据的规则。最省预算。
- `standard`：再加改法要重写整句的规则。日常默认。
- `wide` / `full`：`full` 会带上全部逐词替换与定点删除词表，体积明显变大。用户明确要「全部」时才用。

判别力档位需要外部 eval 报告，用 `--profile <report.json>` 传入；没有报告时 `core` 只剩语义规则、`wide` 等同 `standard`。规则启停沿用项目级 `llmlint.config.ts`，例如关掉 `vocabulary.r18` 后它不会出现在摘要里。

要把摘要长期挂进某个写作流程（例如存成文风预设文件），先向用户说明这是**从规则库生成**的产物：规则库更新后重新跑 `guide` 覆盖即可，不要手工编辑生成结果，否则下次同步会丢改动。

写作期摘要不替代成稿检查。写完仍然走下面的五步。

## Dependency Gate + Five-Step Loop

### 0. install 依赖门

使用上面从 SkillCatalog 推导出的 `<skill-root>`。在第一次运行任何 llmlint CLI 命令前，必须执行一次：

```bash
bun install --cwd "<skill-root>" --frozen-lockfile
```

安装命令成功后才能进入 `status` 初始化门。只要依赖合同仍有效且 `node_modules` 存在，就直接复用，不要每轮重复安装；单纯版本、提示词、规则或源码更新不会使依赖合同失效。安装失败时停止本轮 llmlint 流程并向用户报告，不要绕过依赖门改用其它包管理器或让 Bun 隐式补包。

### 1. status 初始化门

每次开始正式审稿前先运行：

```bash
bun "<skill-root>/bin/llmlint.ts" status --format json
```

读取这些字段：
- `initialized`：是否完成本地初始化。
- `login`：当前固定为 `"none"`；本版本不实现登录。
- `sharing`：用户共享档位与自动/询问策略。
- `configPath`：项目级 `llmlint.config.ts` 路径；没有则为 `null`。
- `detector`：神经检测器 space、代理状态、缓存目录。

这是**软门**：`initialized:false` 不阻塞 `check` / `detect`。不要因为没初始化就停下不干活，按下面确认完档位继续本轮审稿即可。

如果 `initialized:false`：
1. 读 `status` 报的 `sharing` 实际值，向用户说明当前档位，以及每轮审稿结束后会**在本机攒下**什么：
   - `off`：什么都不攒。
   - `stats`：只有规则命中统计与检测分数，不含任何原文、文件名或评语。
   - `fragments`：再加轮目录内的安全快照名、疑难片段原文、你的判定与理由、修后那句评语；不保存原始绝对路径或项目目录。
   - `full`：再加修前修后全文——也就是会在你的用户目录里留一份正文副本；文件标识仍只用安全快照名。
2. 说明 `sharing.mode`：`auto`（缺省）表示每轮收尾自动攒进发件箱，`ask` 表示只列给你看、要你手动确认才写。
3. 说明这里说的是 **`contribute` 本地贡献链路**：数据只落在本机 `~/.llmlint/outbox/`，本版本没有登录（`login` 恒为 `none`）、没有上传通道。随时可以 `contribute --list` 查看，删文件即撤回。`detect` 是另一条外部检测链路，会按下文说明发送未缓存的正文块；`sharing.off` 也不会关闭它。
4. 用户确认后用用户级配置命令写入，不修改项目级 `llmlint.config.ts`。只在用户要求改档位时才写 `sharing.tier`：

```bash
bun "<skill-root>/bin/llmlint.ts" config set sharing.tier stats
bun "<skill-root>/bin/llmlint.ts" config set initialized true
```

可查看用户级设置：

```bash
bun "<skill-root>/bin/llmlint.ts" config get
bun "<skill-root>/bin/llmlint.ts" config get detector.proxy
```

`config` 只管理用户级 `settings.json`，不写项目级规则配置。需要调整规则时，由 Agent 生成 `llmlint.config.ts` diff，等待用户审批。

初始化门之后、跑 `check` 之前，还有两件事。

**① 问一句修前分**：「这稿你现在想继续读下去吗？0–5」。用户拒答就记 null，不追问，也不因此停下。放在这里是刻意的——等步骤 3 把「这稿多少处 AI 味」报完再问，分数会被报告带偏，修前修后的差值就废了。

**② 起一轮**：

```bash
bun "<skill-root>/bin/llmlint.ts" round begin <files...>
```

它会建 `.agent/llmlint/rounds/NNNN/`、把本轮全部输入文件快照进 `source/`、在台账里追加条目，并打印轮号与目录路径。本轮后续所有产物都写进这个目录，下文记作 `<轮目录>`。

**续修上一轮的修后稿时必须带 `--parent`**：

```bash
bun "<skill-root>/bin/llmlint.ts" round begin .agent/llmlint/rounds/0001/output/chapter.md --parent 1
```

父轮要显式说，不能靠「内容变没变」去猜：第 1 轮审第 1 章、第 2 轮审第 2 章时两轮内容本来就不同，猜会得出「用户中途手改过」的错误结论。另起一篇就不传 `--parent`。

### 2. check + detect 双路检测

先跑静态检查。**创作类正文（小说、散文、剧本）默认用 `--review all`**，并把 JSON 直接落进本轮目录：

```bash
bun "<skill-root>/bin/llmlint.ts" check <files...> --review all --format json > <轮目录>/check-source.json
```

非创作文本（技术文档、公告、说明）用默认的 agent 桶就够：

```bash
bun "<skill-root>/bin/llmlint.ts" check <files...> --format json > <轮目录>/check-source.json
```

落盘之后再读这个文件做步骤 3。**不要把命中数字抄进台账**——`contribute` 会直接从这份 JSON 统计命中分布，抄一遍只是多一次抄错的机会。

`check` 的退出码是 eslint 式门禁：有 high 命中时 exit 1、无 high 时 exit 0——JSON 输出不受影响（stdout 照常完整、stderr 保持空）。脚本和 Agent 不要用退出码判断「是否成功」，要看 JSON 是否生成。

为什么创作类要 `--review all`：默认 agent 桶只收「低误杀、可直接交 Agent 处理」的规则，规则整理已把大量语境敏感规则下沉到 human 桶。实测一篇 P(AI) 0.88 的轻小说，agent 桶只给 5 条命中，而这篇最强的 AI 味特征（比喻密度 19 处 / 10.25 每千字）整体在 human 桶——只看 agent 桶会漏掉本篇最该讨论的问题。

两个桶的用法不同，不要混：
- `agent` 桶是默认**可修**入口。
- `human` 桶参与四象限判断、密度判断和「问 / 留」分流，但默认不进「修」。要修 human 桶命中，必须先向用户说明理由并取得同意。

`check --format json` 的紧凑形态字段路径（实测按名猜会踩坑）：顶层 `{kind, filePath, summary, filter, rules, issues, densityIssues?, diagnostics, registry}`。`summary` 含 `total/high/medium/low/visibleChars`（`visibleChars` 是修复前后篇幅对比的同分母口径）；`rules` 是**对象字典**（ruleId → `{namespace,title,level,review,fixability,scope,action,note?}`），不是数组；逐处命中在 **`issues[]`**（每项 `{ruleId,line,column,endLine,endColumn,match,context:{before,current,after}}`，`context` 各裁 24 字）；密度指纹在 `densityIssues[]`（`{ruleId,line,column,hits,perKilo,samples}`）。要看规则的 `detector.targets` / `source` / `scope` 才加 `--rule-detail`（体积大 4 倍以上，日常审稿别用）。

再跑神经检测：

```bash
bun "<skill-root>/bin/llmlint.ts" detect <files...> --format json > <轮目录>/detect-source.json
```

`detect --format json` 的结构：顶层 `{kind:"detect", files:[...]}`，单文件时结果在 **`files[0]`** 下，字段 `{filePath, docPAi, maxPAi, spread, cached, chunks:[{span,line,pAi,rank,relative,preview?}]}`。`docPAi` 是整篇均值、`spread` 是文内极差（四象限守门用）、`chunks[]` 保持原文顺序、`rank` 是 P(AI) 降序位次、`relative` 是相对整篇均值的偏离、`preview` 是原文前 40–60 字（v3.0.1+，不用再按 `span` 偏移自行切文本）。

`detect` 使用默认 HF Space `yuchuantian-aigc-text-detector.hf.space`，按句界分块并缓存正文哈希。网络失败时报告失败原因和代理设置建议；已完成文件的缓存仍可保留。代理可配置：

```bash
bun "<skill-root>/bin/llmlint.ts" config set detector.proxy http://127.0.0.1:7890
```

**隐私边界要单独说明**：`detect` 会把本地缓存未命中的正文块 POST 到 `status.detector.space` 指向的外部检测服务；请求只含正文块，不发送输入文件名或项目路径。远端是否记录请求、保存多久以及如何处理正文不受 llmlint 控制，使用默认 HF Space 时同样如此。用户不希望正文离机时不要运行 `detect`；`sharing.tier` 和 `sharing.mode` 只控制 `contribute` 发件箱，`sharing.off` 不会禁用或改变 `detect`。

静态命中不是判决，P(AI) 也不是单独裁决。二者都只是审稿证据。

### 3. 合成报告

把 `check` 与 `detect` 合成一个面向用户的审稿报告：

- 静态分级表：按 `high / medium / low` 和 `review` 桶列出规则命中。密度指纹单列一段，字段是 `hits`（总命中次数）、`perKilo`（每千可见字）、`samples`（去重样本）；handler 命中的动态计数在 `detail`。密度指纹是分布结论，一条代表全文或一段，不能当逐处替换指令。
- 检测结论分两层，不要混：
  - **整篇层（绝对）**：`docPAi >= 0.85` 才说「这篇整体可疑」。这是唯一使用绝对阈值的地方。
  - **文内层（相对）**：按 `chunks[].rank`（P(AI) 文内降序位次）取两端，各取 `ceil(chunk 数 / 4)` 个。`relative` 字段是该 chunk 相对本篇均值的偏离。
- 四象限有效性守门：先看 `spread`（文内 P(AI) 极差）。**`spread < 0.15` 时四象限对这篇不适用**——整篇 AI 生成的文本常常全部 chunk 都在 0.98 以上，此时「高位 / 低位」只是噪声。这种情况直接报告「整篇均匀可疑」，改用规则信号密度排候选优先级，不要硬套象限。
  - 0.15 这个数是**未校准的起点**：它只在一篇 `spread` 0.707 的样本上定过方向，那篇根本没触及边界。所以不要把它当硬判据——`spread` 落在 0.1–0.2 区间时，两种读法都要在报告里说明，并以规则信号为主。
- `spread >= 0.15` 时做四象限交叉：
  - 规则密集 × 文内高位：确认疑难，优先读上下文，必要时交用户判定。
  - 规则静默 × 文内高位：漏网新规则候选。记录片段和观察，不直接大改。
  - 规则密集 × 文内低位：**规则与检测器分歧，需人工裁决**。不要仅凭这一点就判定规则误报或建议关规则——文内低位不等于检测器认为它像人写（实测一篇里 rank 最低第二位的 chunk 仍有 P(AI) 0.929），而且检测器本身会漏报。要建议 `llmlint.config.ts` 覆盖，必须另有独立证据：同一规则在真人文本上反复命中，或按规则替换会损失原文信息。
  - 规则静默 × 文内低位：不打扰。
- 语义规则：执行 `rules --detector semantic`，按输出的判定说明与示例主动阅读全文，审查无法静态定位的问题。示例分命中例与对照例（`hit: false`），对照例是「形近但不该报」，照它判断可以少误报。

每个候选必须归入三类之一：

- **修**：确认是无功能的模板负担，并给出最小改法。
- **留**：命中承担剧情、人物、节奏、题材或载体功能，说明保留理由。
- **问**：证据不足或修改会改变作者意图，把冲突点交给用户判断。

报告不要输出原始 JSON 给用户。只摘取必要行号、规则、文内位次和建议。

报一条命中要同时给出 `rules[ruleId].title`、原文实际 `match`，以及 `action`（替换类给目标词，删除类说明删什么）。只报 title 不够——同一条规则在不同位置命中的原文不同，读者要看到自己写的那个词才能判断。

### 4. 修复 ↔ 复测一轮

生成 `<轮目录>/plan.md`，内容包括：
- 统计摘要，以及四象限摘要（`spread < 0.15` 时改为说明为何不适用）。
- 明确建议修复、建议保留、需要用户确认的项目。
- 每项引用行号、原文片段、修复理由。

等待用户审批后执行修复。默认写入 `<轮目录>/output/<原文件名>`，只有用户明确要求时才直接修改原文件——**即使直接改了原文件，也仍要把改后内容拷一份进 `output/`**，否则这一轮的谱系缺一半，full 档拿不出修前修后配对。

轮目录不互相覆盖：第二轮审稿写进 `rounds/0002/`，第一轮的计划与改稿原样留在 `rounds/0001/`。不要自动清理旧轮，用户想删自己删。

执行每项修复前先读命中前后文，确认它承担的信息、因果、视角和语气。按 **删 → 压 → 换** 处理：先删无信息负担；删后断裂则压缩重复说明；只有必要语义必须保留时才改写。改动限定到解决问题所需的最小范围，不整段重写无关内容。

**篇幅预算：删减不超过两成。** 修复前的 `check` 报告里 `summary.visibleChars` 是修复前篇幅，复测报告里同一字段是修复后篇幅，用这两个数算删减比例（这个口径与「/千字」同分母，不要用 `wc` 之类的外部计数，它把标点空白也算进去，比出来的比例会失真）。

删减接近或超过两成时**停下来向用户报告，不要自行继续**：说明删了哪些类别的内容、为什么、以及哪些是你判断可以恢复的。「删」是三种手法里最容易失控的一种——清单里每一条单独看都该删，累加起来就能把一章削掉三分之一，而静态命中和检测分数在这个过程中都会变好，指标不会替你报警。

修复完成后只复测一轮（创作类正文同样用 `--review all`），JSON 同样落进本轮目录：

```bash
bun "<skill-root>/bin/llmlint.ts" check <轮目录>/output/<原文件名> --review all --format json > <轮目录>/check-output.json
bun "<skill-root>/bin/llmlint.ts" detect <轮目录>/output/<原文件名> --format json > <轮目录>/detect-output.json
```

复测的判据是三条同时成立：**静态命中减少、没有引入新命中、篇幅在原文 ±20% 以内**。前两条只看规则，第三条防的是「靠删够多来清零命中」——少了它，前两条可以用把正文删薄来满足。

检测分数只作参考，不作目标：实测一轮修复后 `docPAi` 可能不降反升，改动最集中的 chunk 甚至升 6 个百分点——「压缩抽象壳」的改写有时更贴近模型惯用表达。看到分数没降不要再开一轮，也不要为了压分数改写更多句子。

如果复测仍有高风险问题，报告剩余风险，不无限循环。不要为了压低检测分数牺牲语义、角色声音或可读性。

### 5. 台账与学习出口

台账 `.agent/llmlint/session.json` 是唯一跨轮累积的产物。本轮条目在步骤 1 `round begin` 时已经建好，这一步是**把它填完，不是追加新条目**：读文件，找到 `round` 等于本轮轮号的那一项，补上下面的字段，其余轮原样保留。

```json
{
    "version": 3,
    "projectId": "round begin 生成，不要改",
    "rounds": [
        {
            "round": 1,
            "parentRound": null,
            "startedAt": "round begin 写的，不要改",
            "completedAt": "",
            "status": "completed",
            "sourceFiles": [],
            "settings": {"sharingTier": "", "login": "none"},
            "summary": {"staticIssues": 0, "densityIssues": 0, "docPAi": 0, "spread": 0},
            "retest": {"staticIssues": 0, "densityIssues": 0, "docPAi": 0, "spread": 0, "verdict": "pass"},
            "decisions": [],
            "localConfigSuggestions": [],
            "judgment": {"wantReadOnBefore": null, "wantReadOnAfter": null, "comment": null, "blind": false},
            "contributedAt": null
        }
    ]
}
```

要填的是：`completedAt`、`status` 改 `completed`、`summary`、`retest`、`decisions`、`localConfigSuggestions`、`judgment`。

- `summary` / `retest` 记 `docPAi` 与 `spread`，不记「热区数」——热区数依赖绝对阈值，跨篇不可比。`retest.verdict` 写 `pass` / `fail`，判据见步骤 4。
- **规则命中分布不写进台账**：它在 `<轮目录>/check-source.json` 与 `check-output.json` 里，`contribute` 直接读那两个文件。
- `decisions` 每项记：文件、行号、规则 id、原文片段、用户判定（`fix` / `keep` / `ask`）、保留或修复的理由。这是学习出口最有价值的部分——「用户说这处要留着，因为它承担角色声音」正是规则误报的一手证据。
- `judgment`：`wantReadOnBefore` 是步骤 1 问到的分；复测通过后再问一次同样的问题记进 `wantReadOnAfter`，可以顺带请用户留一句话记进 `comment`。拒答记 null，不阻塞。`blind` 恒 `false` 且不要改——这是作者给自己的稿子打分，不是盲评，如实标注才不会被将来的分析误用。
- `projectId` / `startedAt` / `round` / `parentRound` 是 `round begin` 写的，不要改。

本地学习出口只能给 diff 建议，例如关闭某条误报规则、把某 namespace 移到 human 桶、添加 `ignoreTerms`。未经用户批准，不写 `llmlint.config.ts`。

台账填完后跑一次：

```bash
bun "<skill-root>/bin/llmlint.ts" contribute --auto --round <本轮轮号>
```

它按用户的共享设置把本轮裁剪成一条自包含记录，落进用户级发件箱 `~/.llmlint/outbox/`。**本版本只落本地，不联网、不发送。** 落还是不落由命令自己判，你不需要读设置去分支——它会打印一行说明：`sharing.tier = off` 不做；没过初始化门不做；`sharing.mode = ask` 只列不写；`mode = auto`（缺省）直接写。把那行原样转达给用户即可。

用户问起攒了什么、想删掉时：`contribute --list` 列出发件箱里的条目，直接删文件或整个目录就是撤回。

## Repair Discipline

修复时使用 [repair-guide.md](references/repair-guide.md)：
- 删除优先，先删无信息负担，再重写必要句子。
- 只改表达，不改剧情、人设和时间线；不能删除有功能的信息，也不新增原文没有的事件。
- 对白先分类：保留角色声音，拿不准归入需确认。
- 数据包腔、系统公告、技术说明可以保留载体，但不要让叙述者变成 API 文档。
- 不用同义词轮换、模板身体反应、硬拆短句或新增感官细节掩盖命中。
- 不追求零命中或更低检测分数；修后语义、角色声音和可读性优先。
- 每轮修复有收敛边界，不因检测分数继续无意义打磨。

## Rule Author Notes

完整的规则数据模型（磁盘形态、四类判据、loader 不变量、命中类型、紧凑投影）见 [rule-model.md](references/rule-model.md)。下面只列写规则时最容易踩的几条。

- 四个判据类别命名的是判据性质，不是执行者：`regex` 词法、`density` 统计、`handler` 算法、`semantic` 语义。
- 一条规则只声明一个 `scope.layer`：`narrative` 只扫引号外叙述，`quoted` 只扫成对分隔符内文本，`all` 同时扫两层；磁盘省略时 loader 归一为 `all`。scope 由规则作者定义，项目配置不能覆盖。
- `scope.layer:"narrative"` 扫描的是引号外等长占位视图；引号段呈现为等长 `。`。规则不能依赖“数句号”判断。
- `scope.layer:"quoted"` 扫描同一行内成对的 `「」`、`『』`、`“”`、`‘’`、`【】`（含分隔符）；ASCII 直引号、未闭合或跨行分隔符不进入 quoted。
- `density` 表示分布指纹，命中一条代表全文或一段的统计结论，不能机械替换。
- `ignoreTerms` 是项目级白名单；命中与术语区间重叠会被三种 detector 统一跳过。
- `examples` 的每一项必须显式声明 `hit`，并且**至少配一个 `hit: false` 的对照例**——形近但正当的写法不写清楚，写作期摘要会教模型连它一起躲开。
- `review: "human"` 只表示「置信度不足，别让 Agent 自动改」，不表示这条规则在写作期不该提。两个时机的代价结构不同。

## References

- [CLI 详细使用说明](references/cli-usage.md)
- [中文文本润色模式库](references/patterns.md)
- [完整流程详解](references/workflow.md)
- [修复指导](references/repair-guide.md)
