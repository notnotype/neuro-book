# Walkthrough：导入线实施（批次 A-D）

> 2026-08-10。本文件记录整书导入管线（Task 133 产品线一）从设计到实施的落地过程、决策出入与验证结果。仿写线（批次 E，style-distill）未实施。

## 目标与范围

把 Task 133 的导入线设计变成可运行的管线：外部书稿 → manuscript 切章落盘 → 逐章摘要 → 承载树反建 → 结构提取（主线/角色/世界观/钩子）→ 续写准备。配套 Issue [#22](https://github.com/notnotype/neuro-book/issues/22)。

## 计划与实际出入

| 项 | 原计划（Task 133 设计） | 实际实施 | 原因 |
| --- | --- | --- | --- |
| 切章 | 单一正则切章（`\n(?=# )`）+ `--split-pattern` 逃生口 | **三层漏斗**：模式库评分 → AI 结构化描述 → 语义切分兜底 | 用户拍板升级：作者自备 txt 格式千奇百怪，单一正则覆盖不了；AI 读样本找模式比用户手写正则门槛低 |
| AI 产物形态 | 设计文档未定 | **结构化描述**（`ChapterPatternDescription`：prefix/numbering/suffix/separator/titleOptional），代码组装正则 | 让 AI 自由写正则可能误匹配/灾难回溯；结构化描述可解释、可验证 |
| 结构提取 | 刻意推迟（先用 split-book 顶着） | **提前实施**（`book-structure-extract`） | 用户拍板：世界书总结是本轮核心诉求，不等反馈 |
| 落盘确认 | dry-run 统计后落盘 | CLI 默认只 dry-run，`--apply` 才写盘 | 与设计一致，落实为显式参数 |
| 卷划分 | `--chapters-per-volume` 默认 100 | 同设计 + `--single-volume` / `--volume <名>` | 覆盖单卷/多卷两种书稿 |
| 修改旧文 | 设计文档未细述 | `set-summary` 支持单章 `--summary`，改完只重算该章 | 用户要求续写 + 修改旧文都要，局部刷新是成本关键 |

## 关键决策（实施中新增）

### D1：切章置信度与书名页

- 模式库内置 7 个模式（Markdown 一级标题 / 第X章 / Chapter N / 数字点 / 中文数字 / 二三级标题 / 分隔线），按命中数 + 章长合理性 + 均匀度评分选最优。
- 置信度判定：至少 2 章且平均章长落在 [800, 10000] 区间 → high，否则 low（提示用户检查）。
- 首块正文 < 50 字判定为书名页剔除（与 book-deconstruct 口径一致）。
- 章节字数 < 500 或 > 12000 标记为 anomalies，dry-run 界面标红。

### D2：AI 产物三态

workflow 只做「读样本 → 产出结构化描述」，不直接落盘（受 C1 约束）：

1. `--split-pattern <regex>`：用户手工指定（逃生口，保留）。
2. `--pattern-json <json>`：AI 结构化描述 → `compileAiPatternRegex` 组装正则。
3. `--split-points <json>`：AI 输出每章起始行号，按行切。

三者都经同一个 `import-book` CLI 落盘，落盘逻辑唯一。

### D3：切章共享逻辑的落地形态

Task 133 要求「切章规则提取为共享逻辑」，但 workflow 沙盒（`workflow-catalog.ts` 的 evaluate 无 require）禁止 workflow import 外部模块。因此：

- 共享逻辑落在 `server/workspace-files/book-chapter-splitting.ts`，服务 `import-book` CLI。
- `split-book` / `book-deconstruct` 两个 workflow 保持内联（沙盒限制），不强行共享。
- 三者口径已在 `book-chapter-splitting.test.ts` 覆盖（标题切分、书名页、异常章）。

### D4：编码检测

`decodeBookText` 先按 UTF-8（fatal）解码，失败回退 GBK（老书常见）。`TextDecoder("gbk")` 在 Bun 可用，无需新增依赖。测试用真实 GBK 字节序列（Windows CP936）验证。

### D5：章节 frontmatter

落盘 frontmatter 与 Task 133 D2 一致：`type: chapter` / `status: draft` / `summary: ""` / `governance.source: imported` / `governance.review: proposed`。正文原样保留（含标题行），不丢原文。

### D6：结构提取的输入与分批

- 输入 = 逐章摘要（`workspace node parse --json manuscript` 生成 `{path, title, summary}[]`），不吃正文。
- 按卷分组（path 中 `manuscript/{vol}/...`），卷内超过 12000 字符再切批，每批一个 adhoc 粗提取，最后汇总员合并去重。
- 输出 `{threads, characters, worldFacts, openHooks}`，落库由 leader 与用户分类批量审核后执行（用户拍板：不逐条确认）。

## 变更文件

### 批次 A（切章落地）

| 文件 | 内容 |
| --- | --- |
| `server/workspace-files/book-chapter-splitting.ts` | 共享切章逻辑：模式库评分、AI 描述组装、行号切分、编码检测、dry-run 统计 |
| `server/workspace-files/book-chapter-splitting.test.ts` | 14 项单测（模式库/编码/AI 产物/书名页/异常章） |
| `server/workspace-files/workspace-command.ts` | `node import-book` 命令（dry-run + `--apply` 落盘、幂等、卷划分） |
| `server/workspace-files/workspace-command-import-book.test.ts` | CLI 集成测试（dry-run/apply/幂等/force/分卷/GBK/逃生口/AI 产物/目录输入） |

### 批次 B（摘要管线）

| 文件 | 内容 |
| --- | --- |
| `server/workspace-files/workspace-command.ts` | `node set-summary` 命令（单章 `--summary` + 批量 `--stdin` JSON Lines） |
| `server/workspace-files/workspace-command-import-book.test.ts` | set-summary 测试 |
| `assets/workspace/.nbook/agent/workflows/chapter-digest/workflow.ts` | 逐章摘要 workflow（分批、model 覆盖、目录自动补 index.md） |
| `server/agent/workflow/workflow-builtins.test.ts` | chapter-digest 运行级回归（正常/缺参/limit） |

### 批次 C（承载树 + 结构提取）

| 文件 | 内容 |
| --- | --- |
| `server/agent/tools/plot-tools.ts` | `bootstrap_carrier_tree` 写工具（mutatesWorkspace: true） |
| `server/agent/tools/plot-tools.test.ts` | 读写元数据计数更新 |
| `assets/workspace/.nbook/agent/workflows/book-structure-extract/workflow.ts` | 结构提取 workflow（分卷粗提取 + 汇总去重） |
| `server/agent/workflow/workflow-builtins.test.ts` | book-structure-extract 运行级回归 |
| `assets/workspace/.nbook/agent/skills/novel-import-book/SKILL.md` | 六步导入管线 skill |
| `assets/workspace/.nbook/agent/skills/novel-guide/SKILL.md` | 登记新 skill 与两个 workflow |

### 批次 D（续写准备）

| 文件 | 内容 |
| --- | --- |
| `assets/workspace/.nbook/agent/skills/novel-setup/SKILL.md` | 导入/续写分支指向导入管线 |
| `assets/workspace/.nbook/agent/skills/novel-setup/phases/04-world-engine-init.md` | 续写场景：只做结尾切片，不回溯全书 |

## 验证

- 单测：`book-chapter-splitting.test.ts` 14 项、`workspace-command-import-book.test.ts` 13 项、`workflow-builtins.test.ts` 9 项（含 chapter-digest 3 项 + book-structure-extract 2 项新增）全过。
- `plot-tools.test.ts` 22 项在本机用无 globalSetup 最小配置通过（本机 Windows 无管理员权限，globalSetup 的 symlink 会 EPERM，基线同样失败）。
- 根 typecheck：仅既有失败（Prisma generated client 缺失、隐式 any），无新增错误。
- 端到端 smoke：6 章书稿 → import-book dry-run（confidence high、6 章、无异常）→ `--apply` 落盘 6 章 → set-summary `--stdin` 批量写回 6 条 → `node parse` 读回 summary 正确。链路 A→B 贯通；C（承载树）与结构提取需要真实 Project SQLite，本机未跑真实模型级验证。

## 未实施 / 后续

- **批次 E（文风蒸馏 style-distill）**：未实施，设计不变（Task 133 产品线二）。
- **真实项目级验证**：`bootstrap_carrier_tree` 与 `book-structure-extract` 需要真实 Project Workspace + 真实模型走一遍，浏览器验收不自动执行（AGENTS.md 边界）。
- **300+ 章真实耗时**：分批 30 章 × 10 轮的实际耗时与廉价模型摘要质量需真实书稿实测。
- **切章逃生口**：dry-run 界面 + 人工修正兜底；长尾格式（`===` 分隔、无标记）靠 AI 规则发现层覆盖。
