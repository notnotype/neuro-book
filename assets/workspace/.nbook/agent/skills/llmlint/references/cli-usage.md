# CLI 工具使用说明

> 下文命令用 `bun` 演示；CLI 是 TypeScript，参数与运行器无关 —— Bun 原生运行，Node 通过 [`tsx`](https://github.com/privatenumber/tsx) 运行（把 `bun` 换成 `npx tsx`）。裸 `node` 不行：源码用了无扩展名相对导入，需 `tsx` 或 Bun 解析。`<skill-root>` 优先取 SkillCatalog 提供的绝对 `root`；宿主只提供 `SKILL.md` 的绝对 `location` / source locator 时，使用其父目录。尖括号只是占位符，执行前替换为实际绝对路径。

## 首次使用：安装依赖

首次使用当前 skill，或依赖合同更新导致 `node_modules` 缺失时，必须在运行 `status`、`check`、`detect` 等任何 CLI 命令前执行：

```bash
bun install --cwd "<skill-root>" --frozen-lockfile
```

安装失败时不要继续运行 CLI，也不要依赖 Bun 运行时隐式补包。依赖已安装且依赖合同未更新时不必重复执行。

## 基本用法

查看本地初始化状态、共享设置、项目配置路径和检测器状态：

```bash
bun "<skill-root>/bin/llmlint.ts" status
bun "<skill-root>/bin/llmlint.ts" status --format json
```

管理用户级 `settings.json`：

```bash
bun "<skill-root>/bin/llmlint.ts" config get
bun "<skill-root>/bin/llmlint.ts" config get sharing.tier
bun "<skill-root>/bin/llmlint.ts" config set sharing.tier stats
```

`config` 只管理用户级设置，不会修改项目级 `llmlint.config.ts`。

检查文件中的静态 detector 命中项：

```bash
bun "<skill-root>/bin/llmlint.ts" check <文件路径>
```

估算文本 P(AI) 并按文内位次列出最可疑 / 最不可疑段落：

```bash
bun "<skill-root>/bin/llmlint.ts" detect <文件路径>
bun "<skill-root>/bin/llmlint.ts" detect <文件路径> --format json
```

输出动笔之前的写作约束要点（markdown，不需要输入文件）：

```bash
bun "<skill-root>/bin/llmlint.ts" guide
bun "<skill-root>/bin/llmlint.ts" guide --tier full
bun "<skill-root>/bin/llmlint.ts" guide --tier core --profile evals/report/report.json
```

检视当前启用的规则库：

```bash
bun "<skill-root>/bin/llmlint.ts" rules
bun "<skill-root>/bin/llmlint.ts" rules --detector semantic
bun "<skill-root>/bin/llmlint.ts" rules --namespace vocabulary
```

指定配置文件：

```bash
bun "<skill-root>/bin/llmlint.ts" --config llmlint.config.ts check <文件路径>
```

输出 JSON：

```bash
bun "<skill-root>/bin/llmlint.ts" --format json check <文件路径>
bun "<skill-root>/bin/llmlint.ts" --format json rules
bun "<skill-root>/bin/llmlint.ts" --format json detect <文件路径>
```

`guide` 只有 markdown 一种形态：它的产物本身就是要贴进提示词或存成预设的散文，JSON 包装没有消费者。

长文件按最低级别过滤：

```bash
bun "<skill-root>/bin/llmlint.ts" check <文件路径> --min-level medium
bun "<skill-root>/bin/llmlint.ts" check <文件路径> --min-level high
```

按审查受众过滤（默认 `agent`，只展示需要 Agent/LLM 处理的命中）：

```bash
bun "<skill-root>/bin/llmlint.ts" check <文件路径>                 # 等同 --review agent
bun "<skill-root>/bin/llmlint.ts" check <文件路径> --review human  # 偏作者人工/风格偏好的命中
bun "<skill-root>/bin/llmlint.ts" check <文件路径> --review none   # 机械/诊断类命中
bun "<skill-root>/bin/llmlint.ts" check <文件路径> --review all    # 不按受众过滤，全部展示
```

显示完整命中行：

```bash
bun "<skill-root>/bin/llmlint.ts" check <文件路径> --show-lines
```

检查多个文件或整个目录（目录递归收集 `.md` / `.markdown` / `.txt`）：

```bash
bun "<skill-root>/bin/llmlint.ts" check a.md b.md
bun "<skill-root>/bin/llmlint.ts" check manuscript/
```

也支持 glob 模式（`**` 递归、`!` 排除、`{a,b}` 花括号）：

```bash
bun "<skill-root>/bin/llmlint.ts" check 'manuscript/**/*.md'
bun "<skill-root>/bin/llmlint.ts" check 'manuscript/**/*.md' '!manuscript/drafts/**'
```

> glob 模式按相对当前工作目录解析；用引号包住模式，避免被 shell 提前展开。目录参数（如 `manuscript/`）则在该目录内递归。

对 Markdown 文件，默认跳过代码块 / frontmatter / 行内代码 / 链接等结构区域，避免把代码、链接当正文误杀。`--scan-all` 关闭遮罩，扫描全部内容：

```bash
bun "<skill-root>/bin/llmlint.ts" check chapter.md --scan-all
```

## fix：确定性机械修复

`fix` 只应用 `fixability: auto` 的规则——零宽字符删除、省略号/破折号尾部清理等**无需判断**的机械修复。重复感叹号/问号这类语气符号只作为人工提示，不再自动压缩。删填充词、改写句式等语义修复不在此列，仍由 Agent 读上下文、经用户审批后处理（默认写本轮 `output/` 目录，见下面的 `round`）。

默认 dry-run：只打印将修复什么（含 before → after 预览，零宽等不可见字符会被显形为 `▯`），不改文件；存在待修复项时退出码为 `1`（可用于「禁止零宽字符入库」一类 CI 门禁）。`--write` 才写回原文件：

```bash
bun "<skill-root>/bin/llmlint.ts" fix manuscript/            # 预览（不落盘）
bun "<skill-root>/bin/llmlint.ts" fix manuscript/ --write    # 写回原文件
bun "<skill-root>/bin/llmlint.ts" fix chapter.md --format json
```

`fix` 同样默认尊重 Markdown 遮罩：代码块 / frontmatter 内的内容不会被改动，`--scan-all` 可关闭。

## round：多轮修订谱系

一次审稿 = 一轮。`round begin` 建目录、快照修前正文、在台账追加条目，并打印轮号与目录路径：

```bash
bun "<skill-root>/bin/llmlint.ts" round begin chapter.md
bun "<skill-root>/bin/llmlint.ts" round begin a.md b.md                                   # 多文件一轮
bun "<skill-root>/bin/llmlint.ts" round begin .agent/llmlint/rounds/0001/output/chapter.md --parent 1
```

产物布局（全部在项目内的 `.agent/llmlint/`，与项目一起走，不进用户目录）：

```
.agent/llmlint/
    session.json                 台账：跨轮累积的唯一沉淀
    rounds/0001/
        source/chapter.md        修前快照
        check-source.json        步骤 2 的 check --format json
        detect-source.json       步骤 2 的 detect --format json
        plan.md                  修复计划
        output/chapter.md        修后稿
        check-output.json        复测 check
        detect-output.json       复测 detect
```

- **轮号**取「台账里最大轮号」与「rounds/ 现有目录号」两者的最大值 +1，四位零填充。中断轮留下的目录会占住号不被复用——复用会让两轮产物混进同一个目录。
- **`--parent`** 声明本轮续修的是哪一轮的 `output`。必须显式给，不能靠内容比对推：第 1 轮审第 1 章、第 2 轮审第 2 章时内容天然不同，推断会得出「用户中途手改过」的错误结论。另起一篇就不传。
- 多文件按 basename 镜像进 `source/`，重名自动加数字前缀；项目内台账 `sourceFiles` 保留原始路径以便本轮定位，但贡献载荷只导出这些轮目录快照名。
- 不自动清理旧轮。想省空间就自己删轮目录，删掉不影响已经导出的发件箱条目（那些是自包含的）。

## contribute：按档裁剪落本地发件箱

把已完成的轮裁剪成一条自包含记录，写进用户级发件箱 `~/.llmlint/outbox/`（`LLMLINT_HOME` 可覆盖）。**本版本不联网、不发送，也没有 `--send` 通道。**

```bash
bun "<skill-root>/bin/llmlint.ts" contribute                       # 只列将导出什么，不落盘
bun "<skill-root>/bin/llmlint.ts" contribute --yes                 # 真写
bun "<skill-root>/bin/llmlint.ts" contribute --yes --round 2       # 只导第 2 轮
bun "<skill-root>/bin/llmlint.ts" contribute --auto --round 2      # 由用户设置决定，五步流程步骤 5 用这个
bun "<skill-root>/bin/llmlint.ts" contribute --list                # 列发件箱现有条目
```

`--auto` 的四种结局由命令自己判并打印一行：

| 设置 | 结局 |
| --- | --- |
| `sharing.tier = off` | 什么都不做，连准备都不做 |
| `initialized = false` | 不做，提示先过初始化门（同意的落点在那里） |
| `sharing.mode = ask` | 只列不写，提示加 `--yes` |
| `sharing.mode = auto`（缺省） | 直接写 |

按档裁剪：

| 内容 | stats | fragments | full |
| --- | --- | --- | --- |
| 命中统计、检测分、字数 | ✓ | ✓ | ✓ |
| wantReadOn 修前/修后 | ✓ | ✓ | ✓ |
| 文件标识 | 只有数量 | 只用轮目录安全快照名 | 只用轮目录安全快照名 |
| 疑难片段原文、判定、理由、评语 | 只有计数 | ✓ | ✓ |
| 修前/修后全文 | — | — | ✓ |

条目自包含且不引用原始绝对路径或项目目录。`stats` 只含数字、时间、规则/检测器信息、随机项目 ID 与 SHA-256，不含文件名、正文、片段、理由、评语或配置建议。`full` 档要求本轮 `output/` 还在；用户删了轮目录就如实降级成 `fragments` 并在条目里写明原档。

已导出的轮会在台账里打上 `contributedAt`，不会重复导出。发件箱只进不出，用 `--list` 查看攒了什么，删文件或整个目录就是撤回。

## check 输出格式

`check` 运行 regex、handler 和 density detector。regex/handler 是逐处候选；density 是全文或段落级分布指纹。命中表示“可以被稳定识别”，不表示一定要修复。

每条规则有三个互相独立的维度：
- `level`（high / medium / low）：只表严重度，决定 `--min-level` 过滤和退出码。
- `review`（agent / human / none）：审查受众，决定默认进入哪个审查出口。`check` 默认只展示 `review: agent` 的命中，把破折号、比喻、泛词形副词等更偏作者偏好的命中归到 `human`，把零宽字符和省略号/破折号尾部清理等机械命中归到 `none`。
- `fixability`（auto / candidate / manual）：机械修复能力，决定能否被 `fix` 命令自动改写。`fix` 只应用 `auto` 桶（零宽字符、省略号/破折号尾部清理）；`check` 永远不改写。

规则作者还必须决定 `scope`。加载后的 active 规则始终带 resolved scope；stylish 在非 `all` 规则旁显示 `[叙述]` / `[引号内]`，位置窗口显示为同一标签的文首/文末后缀。scope 不是项目偏好，`llmlint.config.ts` 不能覆盖。

默认规则集的实际分布约为 `auto=2 / candidate=0 / 其余 manual`。`action.type: "replace"` 与 `action.replacement` 只说明规则带有替换模板，不代表模板可直接执行；应用权限由规则经过 ruleset、namespace、rule 配置覆盖后得到的最终 `fixability` 决定。用户可显式把指定 regex replace 规则提升为 `candidate`，供逐条人工确认。

默认输出先按 high / medium / low 分段，再按规则分组。每条命中显示位置范围和命中文本，不重复打印完整原文行：

```text
manuscript/chapter-01.md

filler-word-actually [filler] (无意义填充词)
  来源：builtin/default；级别：medium；审查：agent；修复：candidate
  1:9-10  match: 其实

  1 occurrence. 建议删除。

✖ 1 problem (1 medium) 已隐藏：78 条按审查受众隐藏。
```

加 `--show-lines` 时，命中行会改为完整原文行，并用 `<mark>` 标出命中片段：

```text
  1:9-10  这个问题很复杂。<mark>其实</mark>我们可以从另一个角度来看。
```

每个问题包含：
- 行号和闭区间列范围
- 命中文本
- rule id、namespace、ruleset 来源
- 规则级别统计
- 规则 action 中的删除、替换候选或提示

handler 命中可能带 `detail`，用于说明动态计数，例如连续短句数量。density 命中在 stylish 输出中以“密度指纹”分段显示，包含命中次数、每千字密度和样本。

`--min-level` 会隐藏低于指定级别的候选，并在 stylish / JSON 输出中记录被隐藏数量。默认值是 `low`，即显示全部级别。
`check` 的退出码是 eslint 式门禁：有 high 命中时 exit 1、无 high 时 exit 0；JSON 照常完整输出（stdout）、stderr 保持空，脚本不要用退出码判断「是否成功」。
`--review` 会按审查受众过滤候选，默认 `agent`。`--review` 与 `--min-level` 是两个独立过滤器，被隐藏数量分别统计为“按审查受众隐藏”和“按级别隐藏”。
`--show-lines` 只影响 stylish 输出。JSON 的 `context` 默认裁到命中前后各 24 个码点；要完整整行前后文用 `--rule-detail`。

## rules 输出格式

`rules` 输出纯文本，按 namespace 分组、一条一行，方括号里是 `[级别/审查受众/判据类别]`。不带过滤时覆盖当前配置下的全部 active 规则。

**语义规则会自动展开完整判定说明与示例**——对这类规则 `detector.prompt` 就是规则的全部内容，只给标题等于没给。其余判据类别的正文是 targets/patterns，属于实现细节，要看走 `--format json`。

示例：

```text
规则库（判据 semantic）
8 / 266 条 active；规则包 builtin/default

abstraction.hollow
  hollow-summary-paragraph  [medium/human/semantic]  空泛总结段
    改成具体结果、动作、情绪变化、论点推进或可观察场景。
    判定说明：
      判断段落是否只是把前文包装成空泛总结，而没有推进事实、情绪、论点或场景。
      ...
      - 命中例: 几次调整之后，事情似乎走向了更开阔的地方。｜理由: 句子只给出抽象方向感，没有说明调整带来什么具体变化。
      - 对照例（不该报）: 他把空杯放回桌面，终于明白这场谈判已经结束。｜理由: 这句用具体动作和认知变化完成段落收束。
```

示例分两种，**照对照例判断能少误报**：`命中例` 是该报的；`对照例（不该报）` 是形近但正当的写法，规则记录里是 `hit: false`。

没有符合条件的规则时输出 `没有符合条件的规则。`。

## guide 输出格式

`guide` 输出 markdown，分四段（空段自动省略）：

- **优先注意：静态工具查不出来的** —— 语义规则，带命中例与对照例。
- **写作原则** —— 改法要重写整句的规则，一条一行。
- **优先换掉的词** —— 逐词替换类，按 namespace 聚成一行一组。
- **直接不用的写法** —— 定点删除类，同样按 namespace 聚合。

抬头有一段框架说明（这不是禁令清单，承担功能的写法照写），并声明未标注范围的规则默认适用全文；只有例外规则带 `[叙述]`、`[引号内]` 和文首/文末窗口标签。末尾声明档位与条数。生成结果不要手工编辑——规则库更新后重新跑 `guide` 覆盖即可。

## JSON 输出格式

`check --format json` 默认输出**紧凑形态**：规则元数据按 id 去重到顶层 `rules`，逐处命中只引用 `ruleId`。JSON 不缩进（消费者是 Agent，缩进是纯上下文开销）。

```json
{
  "kind": "check",
  "filePath": "manuscript/chapter-01.md",
  "configPath": "llmlint.config.ts",
  "summary": {"total": 2, "high": 0, "medium": 2, "low": 0, "visibleChars": 3131},
  "filter": {"review": "agent", "hiddenByReview": 78, "minLevel": "low", "hiddenByLevel": 0},
  "registry": {"rulesets": ["builtin/default"], "totalRules": 360, "activeRules": 266, "disabledRules": 94},
  "diagnostics": [],
  "rules": {
    "cn.cliche.vague-transition-phrase": {
      "namespace": "cliche",
      "title": "删特定词汇或短语",
      "level": "medium",
      "review": "agent",
      "fixability": "manual",
      "scope": {"layer": "all"},
      "action": {"type": "replace", "replacements": [""]},
      "note": "默认收窄：Agent 默认只保留「取而代之的是」和更明确的「近乎于」。"
    }
  },
  "issues": [
    {
      "ruleId": "cn.cliche.vague-transition-phrase",
      "line": 3, "column": 52, "endLine": 3, "endColumn": 57,
      "match": "取而代之的是",
      "context": {"before": "…深黑色的封面上没有书名，", "current": "取而代之的是", "after": "一道道诡异的发光纹路，像某种失传已久的…"}
    }
  ]
}
```

不变量：`issues[]` 与 `densityIssues[]` 的每个 `ruleId` 都能在顶层 `rules` 里查到；`rules` 只含本次报告实际涉及的规则。

`context.before` / `context.after` 各裁到 24 个码点，被裁一侧带 `…` 标记（scanner 内部给的是整行，中文长段落一行常有 150+ 字）。需要完整段落时直接读原文。

`summary.visibleChars` 是正文可见字数，**与 density 的「/千字」同分母**：只数 CJK / 字母 / 数字，跳过结构行与遮罩区（代码块、frontmatter、链接），标点和空白不计。它的用处是修复前后对比篇幅——审稿流程要求删减不超过两成（见 `workflow.md` 步骤 4）。不要用 `wc -m` 替代：那个数把标点空白都算进去，与规则命中的千字口径不是一套尺子，算出来的删减比例会失真。stylish 输出在总结行之后也给这个数。

`--rule-detail` 恢复完整形态：命中内联完整规则对象（含 `detector.targets`、`source.canonicalKey`、`scope`）、`registry` 带逐 namespace 明细、无顶层 `rules`、缩进 2 空格。写规则、核对 canonicalKey、排查 overlap 时用它；日常审稿不要用——同一篇正文上它比紧凑形态大 4 倍以上。

```bash
bun "<skill-root>/bin/llmlint.ts" check chapter.md --review all --rule-detail --format json
```

检查多个文件时 `kind` 为 `"check-multi"`：顶层 `registry` / `diagnostics` / `filter` / `rules` 为全局（`rules` 跨全部文件共享，所以多文件的去重收益比单文件更大），`files[]` 给逐文件 `{filePath, summary, issues}`，`summary` 为聚合统计。`fix --format json` 输出 `kind: "fix"`，含 `write`、逐文件 `ruleCounts` 与 `totalOccurrences`。

有 density 命中时，`check` 和 `check-multi` 会额外输出 `densityIssues`（同样只带 `ruleId`）：

```json
{
  "ruleId": "story-deslop.explanation-chain",
  "line": 1,
  "column": 1,
  "hits": 8,
  "perKilo": 18.5,
  "samples": ["这意味着", "必须确认"]
}
```

`rules --format json` 输出（`filter` 回显本次过滤条件；`detector: "all"` / `namespace: null` 表示不过滤）：

```json
{
  "kind": "rules",
  "configPath": "llmlint.config.ts",
  "registry": {"rulesets": [], "totalRules": 0, "activeRules": 0, "disabledRules": 0, "namespaces": []},
  "diagnostics": [],
  "rules": [],
  "filter": {"detector": "all", "namespace": null}
}
```

`status --format json` 输出：

```json
{
  "kind": "status",
  "version": "3.0.0",
  "initialized": false,
  "login": "none",
  "sharing": {"tier": "fragments", "mode": "auto", "anonymous": false},
  "configPath": null,
  "detector": {
    "space": "yuchuantian-aigc-text-detector.hf.space",
    "proxyConfigured": false,
    "cacheDir": "~/.llmlint/cache"
  }
}
```

`detect --format json` 输出：

```json
{
  "kind": "detect",
  "files": [
    {
      "filePath": "chapter.md",
      "docPAi": 0.53,
      "maxPAi": 0.91,
      "spread": 0.71,
      "cached": false,
      "chunks": [
        {"span": [0, 120], "line": 1, "pAi": 0.91, "rank": 1, "relative": 0.38},
        {"span": [120, 260], "line": 9, "pAi": 0.2, "rank": 2, "relative": -0.33}
      ]
    }
  ]
}
```

本地缓存命中时不会再次请求；未命中的正文块会 POST 到 `status.detector.space` 指向的外部服务，默认是 HF Space。请求只含正文块，不含输入文件名或项目路径；远端日志与保留策略不受 llmlint 控制。`sharing.off` 只影响上面的 `contribute` 发件箱，不会关闭 `detect`。

`spread`（文内 P(AI) 极差 = max − min）、`rank`（文内 P(AI) 降序位次，1 起）和 `relative`（`pAi − docPAi`）是报告层派生字段，不写进 content-hash 缓存，所以 `cached:true` 时同样存在。

`docPAi` 是各 chunk 分数按可见字数加权的均值，不是独立打的一次分。由此有两条恒等关系可用来自检：单 chunk 文件的 `docPAi` 必然等于该 chunk 的 `pAi`，且 `spread` 必然为 0（只有一个 chunk 时无极差可言）；`maxPAi` 必然等于 `rank` 为 1 的那个 chunk 的 `pAi`。

用法：`docPAi` 判整篇是否可疑（绝对阈值 0.85）；挑文内段落用 `rank` 取两端，不要用绝对阈值——整篇 AI 生成的文本常常全部 chunk 都超过任何固定阈值。`spread < 0.15` 说明文内没有可分辨的高低差，此时段落级的「最可疑 / 最不可疑」只是噪声（0.15 是未校准的起点，只在一篇 `spread` 0.707 的样本上定过方向，落在 0.1–0.2 区间时不要当二值判据）。`chunks` 保持原文顺序，位次单独由 `rank` 表达。

## Regex Detector 与 Semantic Detector

`regex` detector 负责定位逐处候选文本，例如：
- 填充词：其实、实际上、事实上
- 机械过渡：首先...其次...最后...
- 二元对比：不是...而是...
- 问题定义对比：问题/答案/关键不是...是...
- 公式化设问：为什么这么说、这意味着什么、试想一下
- 强调拐杖：毫无疑问、显而易见、说到底、归根结底
- 元叙述公告：下面将介绍、接下来将、本文将从
- 商务黑话：赋能、抓手、闭环、拉通、落地等候选词
- 懒惰绝对词：所有人、永远、一定、毫无例外等候选词

`semantic` detector 负责无法靠固定正则稳定定位的问题，例如：
- 空泛总结段
- 语体错位
- 节奏单调
- 过度解释
- 缺少具体信息
- 隐藏行动者
- 金句感
- 段尾机械升华

二元对比、公式化设问、商务黑话等虽然可以被 regex detector 定位，但修复决策仍需要上下文判断。不要因为 CLI 命中就自动修改。

`density` detector 负责分布问题，例如套词密度、解释链密度、微动作复读、动作清单和公文腔公告。它按全部门槛 AND 判定，命中后只给人工/Agent 提示，不提供机械替换。

`handler` rule 负责声明式模型表达不了的纯函数算法，例如 not-is 状态机、碎句号、过度精炼和低连接密度。handler 名必须是内置注册表键名；未知名会被跳过并产生 warning。

### scope、density 与 ignoreTerms

- `scope.layer:"narrative"`：只扫成对引号外的叙述层；引号段在扫描视图中是等长 `。` 占位，行列和 span 仍对应原文。规则作者不要依赖“数句号”。
- `scope.layer:"quoted"`：只扫同一行内成对的 `「」`、`『』`、`“”`、`‘’`、`【】`，并包含开闭分隔符。ASCII 直引号、未闭合和跨行分隔符不进入 quoted。
- `scope.layer:"all"`：同时扫描 narrative 与 quoted；磁盘规则省略 `scope` 时归一为它。一条规则只声明一个 layer，不使用数组。
- `scope.position`：只扫开头或结尾可见字符窗口，例如章尾预告腔只看文末 600 字。
- scope 由规则作者定义，项目配置不能覆盖。
- `ignoreTerms`：项目级豁免词。regex、density、handler 的命中与豁免词区间重叠都会被丢弃。

### detector 与 review 是两个不同概念

- `detector`（regex / density / handler / semantic）决定**判据是什么性质**：词法 / 统计 / 算法 / 语义。前三种由 `check` 静态扫描命中，semantic 没有可稳定定位的特征，靠 `rules --detector semantic` 交给 Agent 读全文判断。
- `review`（agent / human / none）决定一条静态命中**默认给谁看**。`check --review agent` 是需要 Agent 处理的静态审查入口；它和 `rules --detector semantic` 是两个互补的 Agent 审查面，完整审查时两者都要跑。
- `review` 只管审查期，不要拿它当写作期的取舍依据：`human` 表示「置信度不足，别让 Agent 自动改」，而写作期多提一句约束不会损坏既有正文。写作期的取舍是 `guide --tier`。

## 彩色输出

stylish 输出在交互式终端（TTY）下按语义着色：级别 high 红、medium 黄、low 暗；规则 id 青色、命中文本黄色、汇总 `✖` 红 / `✓` 绿；`fix` 预览 before 红、after 绿。
被管道、重定向或 Agent 抓取（非 TTY）、设置环境变量 `NO_COLOR`、或用 `--format json` 时，自动退化为纯文本，不输出任何 ANSI 转义码，保证机读安全。

## 退出码

- `0`：未发现问题，或只有 low/medium 级别问题
- `1`：发现 high 级别问题，或 CLI 执行失败

退出码跟随当前可见视图：只对未被 `--review` / `--min-level` 过滤掉的 high 命中置 `1`；被隐藏桶（如 `--review agent` 默认隐藏的 human/none 命中）不影响退出码。需要让所有 high 命中都参与判定时用 `--review all --min-level low`。

多文件 check 的退出码取各文件的或：任一文件存在可见 high 命中即 `1`。`fix` 的退出码：dry-run 下存在待修复项为 `1`、无待修为 `0`；`--write` 成功落盘为 `0`。

在 Agent 工作流程中，退出码 `1` 不一定代表命令失败；需要结合 stderr 和输出内容判断。

## 在 Agent 中使用

标准流程：

1. 执行 `check <file>`，获取静态 detector 命中项。
2. 执行 `rules --detector semantic`，获取需要主动全文审查的语义规则。
3. 复核 regex 命中项，读取上下文后判断修复、保留或需要用户确认。
4. 对每条语义规则主动审查全文；没有候选也要在计划中说明“未发现明显问题”。
5. 执行快速审查清单，并给出 Directness / Rhythm / Trust / Authenticity / Density 五维评分。
6. 用面向用户的 Markdown 生成审查结论和修复计划，不要输出 JSON、YAML 或 TypeScript interface。

## 常见问题

### 为什么“不是...而是...”不是语义规则？

因为它可以被正则稳定识别。它确实需要上下文判断是否修复，但这是“修复决策”需要 LLM，不是“候选定位”需要 LLM。

### 为什么 CLI 没有输出 50 分评分？

评分依赖全文语气、语境、节奏和作者意图，由 Agent 在步骤 3 完成。CLI 只负责确定性候选定位。

### CLI 工具可以自动修复吗？

只有 `fixability: auto` 的机械规则（零宽字符、省略号/破折号尾部清理）可由 `fix` 命令确定性修复（见上文「fix」节：默认 dry-run，`--write` 才落盘）。删填充词、改写句式等语义修复不在此列，仍由 Agent 读上下文、经用户审批后执行。`check` 本身永不改写正文。

### 如何配置规则包？

优先创建 `llmlint.config.ts` 选择已经安装的 ruleset，并按 namespace 或 rule id 调整级别：

```typescript
export default {
    rulesets: [
        "builtin/default",
    ],
    namespaces: {
        modifier: "medium",
        "vocabulary.r18": "off",
        "商务黑话": "off",
    },
    rules: {
        "filler-word-actually": "warn",
        "firstly-secondly": "error",
        "filler-lets": "off",
    },
};
```

合并顺序由 `rulesets` 数组决定。同一个 ruleset 内部固定从 `rules/` 目录递归加载所有 `.json` 规则数组文件；目录层级只是内置资产维护结构，不是新的用户配置入口。同 namespace 不同 id 会追加；同 id 会被后加载规则覆盖，CLI 会在 diagnostics 中提醒来源变化。

覆盖值可用字符串简写或对象。字符串是对象的语法糖：`off` = `{enabled:false}`，`warn`/`error`/级别 = `{enabled:true, level:X}`。对象 `{ enabled?, level?, review?, fixability? }` 只覆盖显式字段；想启用一条默认禁用的规则必须显式写 `enabled: true`（纯属性对象如 `{review:"human"}` 不改启停状态）。

默认配置会启用 `builtin/default`。它已包含 R18/成人词汇规则；普通项目可用 `namespaces: {"vocabulary.r18": "off"}` 关闭，不需要手改 `rules/vocabulary/r18.json`。

### CLI 工具支持哪些文件格式？

任何 UTF-8 编码的文本文件。通常用于 Markdown 和纯文本文件。
