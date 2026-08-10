# Task 133：书籍导入与文风蒸馏

> 状态：**设计定稿；导入线已实施，仿写线未实施**（2026-08-10 更新）。导入线实施详见本目录 `walkthroughs/import-line-a-d.md`。

## 用户需求

1. **书籍导入功能**，覆盖两个场景：
   - 作者已有作品迁移到 NeuroBook
   - 对一本书进行续写
   - 用户判断：两者都要先对每章用低等（廉价）模型做 summary
2. **[issue #14](https://github.com/notnotype/neuro-book/issues/14) 文风仿写**：蒸馏文风 + 提取 reference skill。issue 原文——
   > 就是比如用一些书的片段作为参考，相当于 skill 一样，武侠打戏 skill，修罗场 skill，修仙打戏 skill 等等（可以自定义的，以关键词或简短描述来确定什么场景用什么 skill），不同特定戏份参考不同作品片段

## 核心判断：两件事共用同一条链路

它们在实现上不是两件事。**「导入书 → 逐章低配 summary」正是「蒸馏文风 → 提取片段」的上游**：同一批章节正文，喂给不同分析维度，一路出剧情结构（续写用），一路出文风规则 + 场景片段（仿写用）。切章规则、采样策略、廉价模型分层是共享的。

因此本任务把两条产品线放在同一个 task 下，但分成可并行的两组批次。

## 已拍板决策（勿重议）

| # | 决策 | 结论 | 理由 |
| --- | --- | --- | --- |
| D1 | 续写场景的原文正文放哪 | **一律进 `manuscript/`** | 用户拍板。统一搬运逻辑，不按来源分流 |
| D2 | 逐章 summary 存哪 | **章节 `index.md` frontmatter 的 `summary` 字段** | 用户提议；核实后确认它**已是既有正式契约**，非新增 |
| D3 | issue #14 的形态 | **方案 A：片段库 + 索引路由**（扩展 writer 现有 references 槽） | 用户拍板 |
| D4 | 本轮范围 | 只出设计方案，不动代码 | 用户拍板 |

### D2 的核实记录

用户提出「放 frontmatter 如何」是反问。核实结论：这不是新设计，是复用既有契约。

- `server/workspace-files/content-node-schema.ts` 的 `WorkspaceContentFrontmatterSchema` 已含 `summary: z.string().describe("节点摘要。")`
- `assets/workspace/.nbook/templates/content-node-templates/chapter/index.md` 模板已含 `summary: ""`
- 真实项目 `workspace/ming-ding-zhi-shi-2/manuscript/002-volume/001-chapter/index.md` 已在使用
- `workspace node parse --json` 的输出字段含 `summary`，且**默认不含 body**——批量读 N 章摘要一条命令、极低开销
- `governance.source` / `governance.review` 可承载「导入来源」与「AI 生成待确认」

相比新增 `StoryChapter.summary` 字段的优势：零 schema 迁移、与正文同文件（改章 / 重命名不会脱节，而 Plot 侧的 chapterId 关联会因路径变动出问题）、批量读取已有专用 CLI。

**代价（如实记录）**：Plot 工具（SQLite）查不到章摘要，需走文件。这个分工是对的——摘要是内容层事实，Plot 是结构层。

**约定**：`summary` 一到三句、不换行、建议不超过 120 字。

---

## 现状盘点

### 已有的零件

| 零件 | 位置 | 能力 |
| --- | --- | --- |
| 素材落地 | skill `novel-import-tomato-reference` + `scripts/tomato-novel.ts`（709 行） | epub / 下载器目录 → `reference/tomato/{book_id}/`（metadata.json + full.md + chapters/ + images/）。**明确不写 manuscript/** |
| 轻量拆章 | workflow `split-book` | 单文件切章 → 逐章 adhoc 摘要 → 全书结构分析。不落盘 |
| 商业拆书 | workflow `book-deconstruct`（Task 124） | 一级标题切章 + 书名页跳过 + 头 5 尾 2 中段均匀采样 → 钩子/承诺/爽点/节奏 → 拆书报告。不落盘 |
| 承载树反建 | `server/plot/facade/plot.facade.ts` 的 `bootstrapCarrierTree()` | 扫 manuscript 目录 → 建 StoryAct/StoryChapter + Prose frontmatter `chapter:` 反指。幂等，Task 87 已实测（2 Act + 2 Chapter + 0 孤儿） |
| 内容节点脚手架 | `workspace node new` / `node parse` / `node validate` | 建标准内容节点、批量解析（支持 `--stdin` / `--ndjson` / `--json`） |
| 项目创建 | `workspace project create` | 从模板建 Project Workspace |
| skill 分流 | `novel-setup/SKILL.md` 入口判断 | 已写好「新开 / 导入 / 续写」三条分支 |
| writer 双预设槽 | `writer.profile.tsx:80-101` | `writingStylePreset`（条文式规则，52 个）+ `writingReferencePreset`（原文样本，**1 个**） |

### 一个关键先例

`assets/workspace/.nbook/agent/profiles/builtin/writer.home/styles/reborn-villain-loli-magic-girl.first-three-chapters.style.md` 的 frontmatter 写着：

```yaml
sourcePreset: 转生反派萝莉，找茬魔法少女·前三章
```

**「从一本书的片段蒸馏出一份文风规则」这件事已经被人手做过一次**——正是 issue #14 要自动化的。另外 52 个 style 的 frontmatter 带 `identifier`(uuid) / `enabled` / `role: system`，是从 SillyTavern 预设 JSON 导入的，不是蒸馏产物。

### 硬约束（决定形态，不可绕过）

| # | 约束 | 出处 | 影响 |
| --- | --- | --- | --- |
| C1 | `wf.workspace` 只有 `read(单文件)`，不能列目录、不能写文件 | `reference/agent/workflow/authoring.md:151` | 逐章处理的清单必须由 leader 传 args；落盘必须经真实 agent 或 leader |
| C2 | workflow 的 `model` 覆盖只能用用户可见模型，不能硬编码 | `server/vendor/nb-workflow/types.ts:127` + `authoring.md:71` | 廉价模型必须从 args 传入 |
| C3 | `resource-preset` 是单选，且**不支持子目录** | `server/low-code-form/resource-preset.ts:144` 明确 throw | 片段库只能扁平命名，不能一书一文件夹 |
| C4 | writer **看不到 SkillCatalog** | `writer.profile.tsx:436-444` HistorySet 只有 5 个 Import + 1 个写死路径 | issue 字面的「做成 skill」writer 发现不了 |
| C5 | skill 只有 system / user 两层，**没有项目层** | `server/agent/skills/skill-catalog.ts` | skill 形态承载不了「这本书用金庸打戏，那本书用起点修仙」 |
| C6 | **global 层 profile home 在 Project Workspace 之外，agent 文件工具够不着** | `globalProfileHomeRoot` → `workspace/.nbook/agents/{profile}/` | 索引路由只能覆盖项目层片段；蒸馏产物默认只能落项目层 |
| C7 | `bootstrapCarrierTree` 只有仓库根 CLI 入口 | `scripts/cli/bootstrap-carrier-tree.ts` 是唯一调用方 | AGENTS.md 禁止提示 agent 直接调用项目根 `scripts/`，agent 当前够不着 |

### C6 的反面：项目层片段库是可读的

`createLayeredProfileHomeFacade`：project 层 `{project}/agents/writer/` 优先，global 层兜底。实测 `workspace/ming-ding-zhi-shi-2/agents/writer/` 已有 55 个文件（`initializeWriterHome` 会把 52 个 style 完整复制进每个项目）。

关键：**`{project}/agents/writer/references/*.md` 在 Project Workspace 内，writer 的 `read` 工具直接够得着**（writer prompt 只禁止读*其他* profile 的 context memory）。这是方案 A 成立的基础。

---

## 产品线一：书籍导入

### 统一链路（D1 后不再分流）

```
0. 素材落地      novel-import-tomato-reference（已有）→ reference/tomato/{book}/
1. 搬运          【缺】reference/ → manuscript/{vol}/{chapter}/index.md 内容节点树
2. 逐章摘要      【缺】workflow 廉价模型 fan-out → 写回 frontmatter.summary
3. 承载树反建    【缺可达性】bootstrapCarrierTree（逻辑已有，agent 够不着）
4. 结构提议      【本轮不做】先用 split-book 顶着
5. 续写准备      【只改文案】读最后 N 章 → World Engine 初始切片
```

「迁移」与「续写」的区别只剩**导入后做什么**：迁移到第 3 步交给用户继续写；续写额外跑第 5 步。

### 缺口 1：搬运（reference → manuscript）

三个候选形态：

| 方案 | 做法 | 评价 |
| --- | --- | --- |
| **(a) 扩 `workspace` CLI** | `workspace node import-book <src> --volume 001-volume` | **推荐**。`node new` 已是内容节点脚手架的正式入口，`import-book` 是它的批量版；能同时服务「tomato 目录」「单个 full.md」「一堆 txt」三种来源；agent 通过 `workspace node ...` 稳定入口调用，符合 AGENTS.md |
| (b) 扩 tomato skill 的 CLI | 加 `import-manuscript` 子命令 | 否决。把「写 manuscript 内容节点」的职责放进一个 import skill 属越界；作者自己的 txt/docx 用不上 |
| (c) agent 用 write 逐章写 | 零代码 | 否决。300 章 = 300 次工具调用，不可行 |

**推荐 (a)**。设计要点：

- **切章**：复用 `book-deconstruct` 已验证的规则（`raw.replace(/\r\n/gu,"\n").split(/\n(?=# )/u)` 一级标题 + 书名页跳过），提取为共享逻辑，避免三处各写一份
- **命名**：`{序号:3位}-chapter`；卷划分 `--chapters-per-volume`（默认 100）或 `--single-volume`
- **frontmatter**：`type: chapter` / `status: draft` / `summary: ""` / `governance.source: imported` / `governance.review: proposed`
- **幂等**：已存在的章节目录默认跳过，`--force` 才覆盖
- **不写 `chapter:` 反指**——那是第 3 步 `bootstrapCarrierTree` 的职责，不要两处都写

### 缺口 2：`chapter-digest` workflow

受 C1 约束，落盘不能由 workflow 做。三个方案：

| 方案 | 做法 | 评价 |
| --- | --- | --- |
| (i) workflow 返回 `[{path, summary}]`，leader 逐个 `edit` | 零 CLI 改动 | 否决。300 章 = 300 次 edit |
| **(ii) 扩 CLI 加 `node set-summary --stdin`** | workflow 返回 JSON，leader 一条 bash 批量写回 | **推荐**。且「批量改 frontmatter 字段」本来就该有——现在 `node parse` 只读不写，能力面不对称 |
| (iii) 让真实 writer profile 写回 | 复用现成 agent | 否决。writer 是写正文的，语义错位；且一次只能写一个文件 |

其余设计：

- **args**：`chapterPaths`（逗号/换行分隔，由 leader 从 `workspace node parse` 结果列出）、`model`（廉价模型 key，受 C2 约束必须从 args 传，argsHint 提示「建议填便宜模型」）、`limit`（单 run 上限，默认 30）
- **分批**：leader 循环调用，避免单 run 过长
- **outputSchema**：`{summary, characters, events}`——`summary` 写回 frontmatter，`characters`/`events` 供第 4 步结构提议复用，不浪费这轮 token
- **phases**：`collect` / `digest`

### 缺口 3：承载树 bootstrap 的可达性（C7）

| 方案 | 评价 |
| --- | --- |
| **加 Plot 写工具 `bootstrap_carrier_tree`** | **推荐**。归入 Task 97 的 `mutatesWorkspace: true` 写工具面（只读模式硬门控）；leader 已持有 `plotWriteBindings`；逻辑幂等安全；agent 运行时 project 已 open，不需要 CLI 那套 openProject 编排 |
| 加 `workspace project bootstrap-tree` CLI | 次选。CLI 需重做 openProject + module activation（`scripts/cli/bootstrap-carrier-tree.ts` 已有一份），走工具更自然 |

### 缺口 4：结构提议（本轮不做）

`book-deconstruct` 做的是**商业拆书**（钩子/爽点/节奏），输出面向竞品分析。导入需要的是**结构提议**（Thread / Scene / 角色 / 世界观条目），输出 schema 不同。

未来若做，形态为新 workflow `book-structure-extract`：输入 = 逐章摘要（不是全文，省 token），输出 = `{threads, characters, worldFacts, openHooks}`，落库由 leader 逐条与用户确认。

**本轮刻意不做**：第 1-3 步跑通后，第 4 步先用现有 `split-book` 的 analysis 顶着，看真实反馈再决定。避免过度设计。

### 缺口 5：续写准备（只改文案，不加代码）

续写还需要「当前状态」——最后一章结束时人在哪、伤没伤、知道什么。这就是 World Engine 初始化，`novel-setup/phases/04-world-engine-init.md` 已有完整流程，只是输入从「用户口述」变成「最近 N 章正文 + 摘要」。

方案：在 `novel-setup` 入口判断的「续写」分支补一段——读最后 3-5 章正文 → 提取时间/地点/人物状态 → 按阶段四写初始切片。**零代码。**

---

## 产品线二：文风蒸馏与场景片段库（issue #14）

### 为什么不是 skill（C4 / C5）

issue 说「相当于 skill 一样」，但真做成 skill 有两个死结：writer 看不到 SkillCatalog（C4）、skill 没有项目层（C5）。而 writer 已有的 `references` 槽恰好是对的抽象——它已经是「原文样本给语感」，只是**单选**、**只有 1 个**、**没有场景路由**。

方案 A = 把这个槽从「单选一个」升级为「一批带触发描述的片段 + 索引路由」。

### 数据形态

片段放 `{project}/agents/writer/references/*.md`。frontmatter 扩两个可选字段：

```yaml
---
key: jinyong.close-combat
label: 金庸·近身缠斗
sourceTitle: 天龙八部
sourceChapters: 第 11 回节选
generatedFrom: reference/tomato/xxx/full.md
sceneTags: [武侠, 近身打斗, 一对一]          # 新增，可选
whenToUse: 两人贴身缠斗、招式往来、点到为止的比试   # 新增，可选
---
```

**向后兼容已核实**：`buildWritingReference` 走 home 分支时用 `WritingReferenceFrontmatterSchema.partial()`（`writer-writing-reference.ts:66`），`buildWritingStyle` 同理（`writer-writing-style.ts:68`）。老文件不加新字段不会坏，手写一个只有 `title:` 的文件也能用。

受 C3 约束，片段库**扁平命名**，用 `key` 前缀（`jinyong.` / `qidian-xiuxian.`）+ `sceneTags` 分类，不建子目录。

### 注入形态（关键设计）

writer prompt 现在把选中的那份 reference **全文**塞进 `<writing_reference>`。改造后：

- **只有 1 个片段文件** → 行为完全不变（全文注入），**零回归**
- **多于 1 个** → 除选中的那份仍全文注入（基础语感）外，追加索引：

```
<writing_reference_index>
可用文风参考片段。按本章场景挑 1-2 个 read 后再动笔；场景不匹配就都不读，不要为了用而用。
- agents/writer/references/jinyong.close-combat.md | 金庸·近身缠斗 | 两人贴身缠斗、招式往来、点到为止的比试
- agents/writer/references/xiuluochang.md | 修罗场对峙 | 多角关系当场撞破、台面下的话被摊开
</writing_reference_index>
```

**路径边界（C6）**：索引只列**项目层**片段（writer 的 `read` 够得着）。global 层片段仍只能通过 `writingReferencePreset` 单选全文注入。这条必须写进 prompt，否则 writer 会去 read 一个读不到的路径。

**设置项**：新增 `sceneReferenceRouting: "off" | "index"`，**默认 `off`**。理由：现有用户的 references 目录只有 1 个文件，行为本来就不变；但显式开关比「文件数量隐式决定行为」更可预测，也便于出问题时一键关掉。

**代价**：命中时 writer 多一次工具调用（read 片段）。可接受——它本来就要 read 目标文件和 lorebook。

### 蒸馏 workflow `style-distill`

- **args**：`samplePaths`（片段路径清单，逗号分隔）或 `bookPath` + 章节范围；`focus`（可选：只蒸馏打斗 / 对话 / 心理描写）；`model`（可选，蒸馏值得用好模型，与 chapter-digest 相反）
- **phases**：`collect` / `analyze` / `synthesize`
- **analyze**：多个 adhoc 并发，各自一个维度——①句式与节奏 ②用词与意象 ③对话写法 ④描写密度与视角 ⑤段落排版
- **synthesize**：汇总成条文式 `<Writing_style>` 规则，**对齐现有 52 个 style 的写法**（含「正确示例 / 错误示例」对照，见 `reborn-villain-loli-magic-girl.first-three-chapters.style.md`）
- **输出**：`{styleMarkdown, referenceMarkdown, suggestedKey, suggestedLabel, sceneTags, whenToUse}`
- **落盘**：受 C1 约束 workflow 不写文件，由 leader 用 `write` 落到 `{project}/agents/writer/styles/` 与 `references/`

### 版权边界（必须写进 skill）

片段是**外部作品原文**：

- 只落 Project Workspace 内，不进仓库、不进 global 资产
- 蒸馏出的**规则**可跨项目复用；**原文片段**不建议跨项目搬运
- skill 中明确提示这是个人学习与写作参考用途
- 不做自动下载、不做版权内容分发

### 触发入口

新 skill `novel-technique-style-distill`（放 novel-guide 的「随时可用层」）：

1. 用户指定参考来源（已导入的书 / 自己贴的片段）
2. 选范围（整书 / 指定章 / 指定场景类型）
3. `run_workflow style-distill`
4. leader 落盘 + 报告
5. 提示用户在设置里选中该预设，或依赖索引路由自动命中

`novel-guide/SKILL.md` 需加这个 skill 行与 workflow 行。

---

## 分批计划

| 批次 | 内容 | 依赖 | 冲突面 |
| --- | --- | --- | --- |
| **A** | `workspace node import-book` + `node set-summary` 两个 CLI 子命令；切章规则提取为共享逻辑 | 无 | Product-owned Workspace CLI domain + `.nbook/agent/bin/workspace` wrapper |
| **B** | `chapter-digest` workflow + Plot `bootstrap_carrier_tree` 工具 | A | workflows/ + server/plot + server/agent/tools |
| **C** | `novel-setup` 续写分支文案 + `novel-guide` 更新 | B | skills/ |
| **D** | writer references 索引路由（profile 改造 + `sceneReferenceRouting` 设置项 + frontmatter 扩字段） | 无 | writer.profile.tsx + writer-writing-reference.ts |
| **E** | `style-distill` workflow + `novel-technique-style-distill` skill | D | workflows/ + skills/ |

A→B→C 是导入线，D→E 是仿写线，**两组正交可并行**。

## 明确不做（避免过度设计）

- `book-structure-extract` workflow：先用 `split-book` 顶着，看真实反馈
- global 层片段库对 writer 可读：需要新机制（C6），本轮不碰
- `resource-preset` 子目录支持：C3 明确不支持，用扁平命名 + `sceneTags` 替代
- 自动下载书籍、版权内容分发
- 把 `split-book` / `book-deconstruct` 合并：三者定位不同（轻量结构 / 商业拆书 / 导入摘要），保持并存

## 待验证 / 风险

- **切章规则的通用性**：`\n(?=# )` 只对番茄导入产物验证过。作者自己的稿件（Word 转 md、`第一章` 无 `#`、`===` 分隔）需要 `--split-pattern` 逃生口
- **300 章规模的实际耗时**：`chapter-digest` 分批 30 章 × 10 轮，单轮并发 3 → 需要实测能否接受；廉价模型的摘要质量也需实测
- **索引路由的真实效果**：writer 会不会该读不读、或者滥读。D 批实施后需要真实会话观察，必要时退回「leader 在 `input.context.readablePaths` 点名」的方案 B
- **`initializeWriterHome` 每项目复制 52 个 style**：实测 `ming-ding-zhi-shi-2/agents/writer/` 有 55 个文件。片段库长大后这个复制策略要重新评估（不属本任务，但会被本任务放大）

## 变更文件

本轮**只新增本设计文档**，未改动任何代码或配置。
