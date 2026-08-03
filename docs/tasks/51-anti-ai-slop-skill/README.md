# 文本润色 Skill 和 CLI 工具

## User Request / Topic

创建一个完整的文本润色 skill 系统，帮助润色中文文本，并识别和修复套路化表达、AI 写作痕迹与八股文风格。系统原名 `anti-ai-slop`，2026-06-28 硬切重命名为 `llmlint`。

**2026-06-14 update**：用户面表述从旧的风格清理心智收敛为“文本润色”；步骤 3 增加 stop-slop 风格的快速审查清单和 Directness / Rhythm / Trust / Authenticity / Density 五维 50 分评分；stop-slop 的核心规则已本地化注入 static rules、LLM rules 和 category suggestions。

**2026-06-28 update**：`anti-ai-slop` 硬切重命名为 `llmlint`，旧 skill key 不保留 alias；CLI 模块化为自包含 ESM package。

**2026-06-29 update**：llmlint 规则升级为 flat Rule Registry；当时默认规则包为 `builtin/anti-ai-slop` ruleset，配置改为 `rulesets` / `namespaces` / `rules` 三层覆盖。规则入口后续已收敛到 `builtin/default`。

**2026-06-29 update 2**：`旧中文规则样本目录` 的 11 个中文规则样本曾取精华策展合并为单一 `builtin/cn`。该入口后续已与人工规则合并到 `builtin/default`。

**2026-06-29 update 3**：默认规则入口收敛为单一 `builtin/default`，合并原人工 anti-ai-slop 规则与中文策展规则；中文规则 ID 从 hash 改为英文语义 slug，例如 `cn.vocabulary.body.skull-head`。

**2026-06-29 update 4**：硬切删除旧格式兼容字段和公开单文件导入入口；`旧中文规则样本目录` 只作为官方默认规则集的策展素材。

**2026-06-30 update**：`builtin/default` 规则资产硬切为 `rules/` 层级目录递归加载，`ruleset.json` 不再声明规则文件清单，也不兼容旧根 `rules.json`。

**2026-08-01 update**：NeuroBook 内置 runtime 已同步到 sibling llmlint `3.0.0`。当前为 360 条规则、266 条默认 active，scope 分布 `all=240 / narrative=24 / quoted=2`；完整静态检查由 CLI/Agent 执行 regex+density+handler，Web/MachineScan 只执行 regex+handler span 扫描。当前实现、评测和贡献闭环以 sibling llmlint 的 Task 23/24 为权威，本文件后半部保留的 2026-06 MVP 清单只是历史过程，不再作为当前 TODO。

**核心需求**：
1. CLI 工具：类似 eslint 的文本检查器，输出问题列表
2. Agent Skill：完整的润色工作流程，包含 LLM 审查 + Web 调研 + 用户审批 + 自动修复
3. 规则系统：可扩展的规则库，支持 static（正则）和 llm（语境判断）两类规则

**后续计划**：
- 部署到网站，暴露给测试用户使用
- 收集用户数据来优化规则和助手
- 发展为完整的 AI 润色助手产品

## Goal

创建一个中文文本润色系统，验证点包括：

1. **CLI 工具可运行**：`bun .nbook/agent/skills/llmlint/bin/llmlint.ts check <file>` 输出类似 eslint 的格式化报告
2. **规则系统可扩展**：JSON 格式的规则定义，static 和 llm 规则分离
3. **Skill 可执行**：Agent 能按 6 步流程完成润色任务
4. **修复结果正确**：能识别并修复典型套路化表达（填充词、机械过渡、二元对比、公式化设问、空泛总结、节奏单调等）

**约束**：
- 第一版保持简单，不使用 jieba/词性标注/句法分析
- 纯 TypeScript 实现，使用正则表达式
- 不实现 --fix 自动修复（由 Agent 手动执行）
- 不支持自动多轮迭代

**使用范围**：
- 可读写 `assets/workspace/.nbook/agent/skills/llmlint/` 下所有文件
- 可集成到 workspace CLI
- 可调用 researcher agent 进行 web 调研

**迭代策略**：
- 先实现规则 JSON 文件（定义具体规则）
- 再实现 CLI 工具（llmlint package）
- 最后编写 SKILL.md（Agent 工作流程说明）
- 每个组件独立验证后再集成

**阻塞条件**：
如果遇到无法通过正则实现的规则、或性能问题、或与现有 workspace CLI 集成冲突，需要停止并报告。

## Current State

**阶段**：已实现，2026-06-28 完成 llmlint 系统化重构

**已完成**：
- ✅ 需求讨论和确认
- ✅ 技术方案选型（TypeScript + 正则，不用 jieba）
- ✅ 规则系统设计（static/llm 分层）
- ✅ CLI 输出格式设计（类似 eslint）
- ✅ 完整的 6 步润色流程设计
- ✅ 规格说明文档（`.agent/workspace/anti-ai-slop-spec.md`）
- ✅ 规则 JSON 文件（rulesets/builtin/default/ruleset.json + rules/ 层级目录）
- ✅ CLI 检查工具（llmlint/bin/llmlint.ts + src 模块）
- ✅ SKILL.md 和 reference 文档
- ✅ 2026-06-14：注入 stop-slop 本地化规则，新增快速审查评分流程
- ✅ 2026-06-14：验证 JSON 解析、CLI static 命中、LLM rule 输出和自然文本反向样例
- ✅ 2026-06-28：硬切重命名为 `llmlint`，不保留 `anti-ai-slop` skill alias
- ✅ 2026-06-28：新增 `package.json`、`llmlint.config.example.ts`、模块化 `src/`
- ✅ 2026-06-29：迁移为 flat Rule Registry，并最终收敛到默认 `builtin/default` ruleset
- ✅ 2026-06-29：策展合并中文规则样本，并最终收敛到默认 `builtin/default`
- ✅ 2026-06-29：默认入口合并为 `builtin/default`，中文规则 ID 改为语义 slug
- ✅ 2026-06-29：硬切删除旧格式兼容字段和公开单文件导入入口
- ✅ 2026-06-30：默认规则资产硬切为 `rules/` 层级目录递归加载
- ✅ 2026-08-01：同步 llmlint 3.0.0；规则 scope、Guide provenance、本地 round/contribute 隐私与完整性边界已落地
- ✅ 2026-08-01：source、vendored snapshot、当前 user runtime 各 122 个文件，两段逐文件 SHA-256 差异为 0

**2026-08-02 update**：llmlint 3.0.1 落地四组 CLI/文档增强（sibling 仓开发，已 sync 回 NeuroBook vendor 与 user runtime）：① 新增 `report` 命令——吃 check/detect 两个 JSON 合成审稿报告（静态分级表按 level×review 桶聚合、密度指纹、检测两层结论、四象限自动交叉、规则信号密度排序），纯函数核心在 `skill/src/report.ts`（12 个 vitest 用例）；② 新增 `round metrics <轮>`——从轮目录 JSON 自动算台账 summary/retest 四项指标与 verdict 建议；③ detect JSON 的每个 chunk 增加 `preview` 字段（原文前 48 字，免去按 span 偏移自行切文本）；④ `round begin` 打印后续步骤 checklist。SKILL.md 与 cli-usage.md 修正 check/detect JSON 实际字段路径（rules 是字典、命中在 issues、detect 结果在 files[0]）与 check 退出码语义（high 命中 exit 1 是门禁非失败）。

NeuroBook 新增两个内置 workflow：`llmlint-review`（用 leader.default 作 CLI 执行器，逐文件并行 check+detect+report，detect 失败降级）与 `llmlint-full-review`（检测→报告→runner 生成 plan.md→wf.ask 人工审批→writer 按 plan 修复到轮目录 output/→复测+round metrics 出 verdict；writer 越权改原文件由 integrity 步骤 cmp/cp 快照强制回滚兜底）。调用需传 `skillRoot`（workflow 求值环境禁止 import/fs，不能自行定位 skill 路径）。

**当前边界**：`contribute` 只写本机 outbox，不联网；`detect` 会把未缓存正文分块发给配置的外部服务，`sharing.off` 不会关闭它。Web 不执行 density；这不是规则目录缺失，而是有意保持 span-only，完整静态结果以 CLI/Agent 为准。

## Decisions / Discussion

### 2026-06-28 llmlint 系统化重构

**决策**：将系统 skill key 从 `anti-ai-slop` 硬切为 `llmlint`，不保留旧 alias。后续默认规则入口已进一步合并为 `builtin/default`。

**理由**：
- `llmlint` 更准确表达“像 eslint 一样规范 LLM 输出”的能力边界。
- 不保留双入口，避免 SkillCatalog 中长期出现两个候选，导致 Agent 选错旧 skill。
- 当前只有一个工具包，不做 monorepo；先在 skill 目录内按 ESM package 组织。

**变更**：
- 新入口：`assets/workspace/.nbook/agent/skills/llmlint/bin/llmlint.ts`。
- 规则最终收敛到 `rulesets/builtin/default/`。
- `llmlint.config.ts` 使用 `rulesets` / `namespaces` / `rules` 三层配置，支持 `off` / `warn` / `error` / `low` / `medium` / `high`。
- CLI 拆分为 config / rules / scanner / reporter / types / cli 模块，后续 Web 或编辑器复用时不需要解析命令行输出。

### 2026-06-14 文本润色升级

**决策**：保持 `anti-ai-slop` 名称、目录和 CLI 命令不变，将用户面表述收敛为“文本润色”。

**变更**：
- `SKILL.md` 的步骤 3 改为“LLM 深度审查 + 快速审查评分”。
- `references/workflow.md`、`references/patterns.md`、`references/cli-usage.md` 已同步为文本润色心智。
- `static-rules.json` 新增公式化设问、强调拐杖、负向列举、商务黑话、懒惰绝对词、金句式收束候选等规则。
- `llm-rules.json` 新增节奏单调、过度解释、缺少具体信息、隐藏行动者、金句感、段尾机械升华等语义规则。
- `category-suggestions.json` 新增对应坏例/好例和改写方向。

**验证**：
- JSON 三个规则文件均可被 PowerShell `ConvertFrom-Json` 解析。
- `check` 样例命中填充词、二元对比、公式化设问、商务黑话、机械列举等新增规则，high 级别按预期返回 exit code 1。
- `show-llm-rules` 可输出 8 条 LLM rule。
- 自然小说段落反向样例输出 `✓ No problems found`。

### 1. 技术栈选择

**决策**：使用 TypeScript + 正则，不使用 jieba

**理由**：
- 第一版规则（填充词、机械过渡）用正则足够
- 避免引入额外依赖和复杂度
- 保持与项目技术栈统一
- 性价比高（2-3 天可完成 MVP）

**排除方案**：
- ❌ Python + jieba：需要子进程调用，集成复杂
- ❌ 词性标注/句法分析：实现复杂，准确率提升有限

### 2. 规则分层设计

**决策**：规则分为 static 和 llm 两类，分文件存储

**Static Rules**：
- CLI 通过正则直接匹配，确定性高
- 包括：填充词、机械过渡词
- 存储：`rules/static-rules.json`

**LLM Rules**：
- CLI 标记可疑位置，由 LLM 根据语境判断
- 包括：二元对比结构（"不是...而是..."）
- 存储：`rules/llm-rules.json`
- LLM 审查时只需读取这一个文件

**好处**：
- 职责清晰：CLI 做确定性检查，LLM 做语境判断
- 性能优化：LLM 不需要加载 static rules
- 易于扩展：添加新规则时不影响现有逻辑

### 3. CLI 输出格式

**决策**：类似 eslint 的命令行文本格式

**格式特点**：
```
类别: 填充短语 (filler-phrases) - 8 个问题

  5:12   warning  填充词：其实                      filler-word-actually
  12:1   warning  填充词：值得注意的是              filler-worth-noting

  修复建议:
  这类填充词通常不增加实质内容...
```

**排除方案**：
- ❌ JSON：不直观，LLM 解析不友好
- ❌ Markdown：过于冗长，不适合命令行

**好处**：
- 开发者熟悉的格式
- 易于 LLM 解析
- 按类别分组，清晰易读
- 一类问题一个修复建议（不重复）

### 4. 修复建议粒度

**决策**：一类问题一个通用修复建议

**示例**：
- ❌ 每个"其实"都单独说明如何修复（重复啰嗦）
- ✅ "填充短语"类别统一说明：这类词通常不增加实质内容，建议直接删除

**好处**：
- 避免输出冗长重复
- 更易于 LLM 理解规律
- 便于用户批量修复

### 5. 用户输入方式

**决策**：支持文件路径和直接粘贴文本

**实现**：
- 文件路径：直接使用
- 粘贴文本：写入 `.agent/polish-input.md`

**临时目录**：`.agent/`（不是 `.agent/workspace/`）

### 6. 审批和输出方式

**审批**：
- Agent 自主选择审批方式（文本回复 or request_user_input）
- 不强制使用 request_user_input
- 用户可以回复"跳过第 3、5 项"等自然语言指令

**输出**：
- 生成新文件（`.agent/polish-output.md`）
- 保留原文件不动
- 提供完整的修复报告

### 7. 第一版规则范围

**Static Rules（6 个）**：
| Category | Rule | Pattern | Severity |
|----------|------|---------|----------|
| 填充短语 | 填充词：其实 | `其实\|实际上\|事实上` | warning |
| 填充短语 | 填充词：值得注意的是 | `值得注意的是\|需要指出的是\|需要强调的是` | warning |
| 填充短语 | 填充词：可以说 | `可以说\|不得不说` | warning |
| 填充短语 | 填充词：让我们 | `让我们` | warning |
| 机械过渡 | 机械列举结构 | `首先.*?其次.*?(?:最后\|再次)` | error |
| 机械过渡 | 机械对比结构 | `一方面.*?另一方面` | warning |

**LLM Rules（2 个）**：
| Category | Rule | Pattern | Severity |
|----------|------|---------|----------|
| 二元对比 | 二元对比结构 | `不是.*?而是` | warning |
| 二元对比 | 问题定义对比 | `(?:问题\|答案\|关键)不是.*?是` | warning |

**不包含（性价比低）**：
- ❌ 排比结构检测（需要句法分析）
- ❌ 空洞表达检测（需要语义理解）
- ❌ 过度书面语（需要词典和频率统计）

### 8. 迭代支持策略

**决策**：不自动多轮迭代，但支持用户继续提修复

**不支持**：
- ❌ 修复后自动再次检查
- ❌ 循环直到没有问题

**支持**：
- ✅ 用户："第 12 行还是有问题"
- ✅ Agent 读取当前文件，继续分析和修复
- ✅ 用户可以多次调用 skill

**理由**：
- 避免无限循环
- 给用户控制权
- 降低首次实现复杂度

## Verification / Test

### 1. CLI 工具测试

**测试用例 1**：基本检查
```bash
bun .nbook/agent/skills/llmlint/bin/llmlint.ts check test-input.md
```
期望输出：按 high / medium / low 分段的问题列表，包含行列范围、规则、命中文本和修复建议

**测试用例 2**：测试文本内容
```markdown
这个问题很复杂。其实我们可以从另一个角度来看。

值得注意的是，这种方法在实践中效果显著。

首先，我们需要分析问题。其次，要制定方案。最后，执行计划。

不是因为天气不好，而是因为路况复杂。
```

期望识别：
- 第 1 行：填充词"其实"
- 第 3 行：填充词"值得注意的是"
- 第 5 行：机械列举结构
- 第 7 行：二元对比结构（需要 LLM 判断）

### 2. Skill 工作流程测试

**测试场景**：完整的润色流程

1. 用户提供文本（粘贴或文件路径）
2. Agent 执行 CLI 检查
3. Agent 分析结果，对 LLM rules 进行判断
4. Agent 生成修复计划，展示给用户
5. 用户确认
6. Agent 执行修复
7. Agent 展示修复报告

**验证点**：
- ✅ CLI 正确识别问题
- ✅ LLM 能正确判断"不是...而是..."是否需要修复
- ✅ 修复建议合理
- ✅ 修改后的文本正确
- ✅ 报告清晰完整

### 3. 规则扩展测试

**测试场景**：添加新规则

1. 在 `static-rules.json` 添加新规则
2. 重新运行 CLI 检查
3. 验证新规则生效

期望：无需修改代码，只需更新 JSON

### 4. 边界情况测试

- 空文件
- 超长文件（10000+ 行）
- 包含代码块的文本（不应该检查代码块内容）
- 包含对话的文本（对话中的"其实"可能是合理的）

## Implementation Walkthrough

### 阶段 1：规则定义 ✅ 已完成

**任务**：创建 3 个规则 JSON 文件

**实际完成**：
- ✅ 创建了 3 个规则 JSON 文件
- ✅ static-rules.json：6 个规则（填充短语 4 个 + 机械过渡 2 个）
- ✅ llm-rules.json：2 个规则（二元对比 2 个）
- ✅ category-suggestions.json：3 个类别的修复建议和示例
- ⚠️ 遇到问题：JSON 中的中文引号（""）导致解析失败
- ✅ 解决方案：全部替换为直角引号（「」），确保 JSON 有效性

**验证**：
```bash
python -m json.tool <file>.json  # 所有 JSON 文件通过验证
```

### 阶段 2：CLI 工具实现 ✅ 已完成

**任务**：实现 checker.ts

**实际完成**：
- ✅ 实现 checker.ts（约 200 行）
- ✅ 使用 Bun 的 import.meta.dir 获取脚本目录
- ✅ 使用 Bun.file().json() API 加载规则（避免编码问题）
- ✅ 实现按类别分组输出
- ✅ 实现类似 eslint 的格式化输出
- ✅ 支持 `--min-level` 级别过滤
- ✅ 正确的退出码（error 时返回 1）

**验证**：
```bash
bun assets/workspace/.nbook/agent/skills/llmlint/bin/llmlint.ts check .agent/test-input.md
```

输出示例：
```
检查文件: C:\Users\...\test-input.md

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

类别: 填充短语 - 5 个问题
  1:9   ⚠️ warning  填充词：其实    filler-word-actually
  ...

✖ 9 个问题 (1 errors, 8 warnings)
  ├─ 7 个可直接修复 (static rules)
  └─ 2 个需要 LLM 判断 (llm rules)
```

### 阶段 3：集成到 Workspace CLI ⏸️ 暂缓

**决策**：无需集成，作为独立工具使用

**理由**：
- NeuroBook 的 skill 脚本是独立 CLI 工具，不是 workspace 子命令
- 参考 `tomato-novel.ts` 和 `silly-tavern-card.ts` 的模式
- Agent 使用 bash 工具直接调用即可

### 阶段 4：编写 SKILL.md ✅ 已完成

**任务**：为 Agent 提供完整的工作流程说明

**实际完成**：
- ✅ 完整的 SKILL.md（约 200 行）
- ✅ 包含 frontmatter 定义（name, description, when_to_use）
- ✅ 详细的 6 步工作流程说明
- ✅ 工具清单和使用说明
- ✅ 第一版规则清单
- ✅ 注意事项和迭代支持说明

**关键设计**：
- 面向 Agent 编写（命令式、程序化）
- 流程清晰，每步都有具体的实现指导
- 包含决策逻辑（何时自动修复、何时 LLM 判断、何时调用 researcher）

### 阶段 5：创建参考文档 ✅ 已完成

**任务**：补充深度内容，保持 SKILL.md 简洁

**实际完成**：
- ✅ patterns.md：中文 AI 味道模式库（约 250 行）
  - 3 个核心特征详解
  - 其他常见 AI 味道（未实现的规则）
  - 识别技巧和合理使用情况
- ✅ cli-usage.md：CLI 工具使用说明（约 180 行）
  - 基本用法和选项
  - 输出格式详解
  - 常见问题
  - 在 Agent 中使用的示例
- ✅ workflow.md：完整流程详解（约 400 行）
  - 6 步流程深度解释
  - 决策树和边界情况
  - 错误恢复策略
  - 完整示例

**关键内容**：
- patterns.md 可以帮助用户理解什么是 AI 味道
- cli-usage.md 是 CLI 工具的完整文档
- workflow.md 是 Agent 执行的详细指南

## 实现总结

### 已完成的产物

1. **规则文件**（rules/ 层级目录）：
   - `rulesets/builtin/default/ruleset.json`
   - `rulesets/builtin/default/rules/absolute/index.json`
   - `rulesets/builtin/default/rules/vocabulary/r18.json`

2. **CLI 工具**：
   - `bin/llmlint.ts` + `src/` 模块
   - 支持多种选项
   - 类似 eslint 的输出格式

3. **Skill 定义**：
   - `SKILL.md`（约 200 行）
   - 完整的工作流程说明

4. **参考文档**（3 个 Markdown）：
   - `references/patterns.md`（约 250 行）
   - `references/cli-usage.md`（约 180 行）
   - `references/workflow.md`（约 400 行）

5. **测试文件**：
   - `.agent/test-input.md`（测试用例）

### 验证结果

**CLI 工具测试**：
```bash
bun assets/workspace/.nbook/agent/skills/llmlint/bin/llmlint.ts check .agent/test-input.md
```

成功检测：
- ✅ 5 个填充短语问题
- ✅ 2 个机械过渡问题（1 error + 1 warning）
- ✅ 2 个二元对比问题（标记为需要 LLM 判断）
- ✅ 输出格式正确
- ✅ 退出码正确（1，因为有 error）

**规则覆盖率**：
- 6 个 static rules 全部生效
- 2 个 llm rules 正确标记

### 遇到的问题和解决方案

**问题 1：JSON 解析失败**
- **现象**：`JSON Parse error: Unrecognized token '其'`
- **原因**：JSON 字符串中包含未转义的中文引号（""）
- **解决**：全部替换为直角引号（「」）

**问题 2：路径解析错误**
- **现象**：SCRIPT_DIR 路径重复
- **解决**：使用 Bun 的 `import.meta.dir` API

**问题 3：编码问题**
- **现象**：readFileSync + JSON.parse 在某些情况下失败
- **解决**：使用 Bun.file().json() API

### 技术亮点

1. **纯 TypeScript + 正则**：无需 jieba 等外部依赖
2. **规则驱动**：规则和代码分离，易于扩展
3. **分层检查**：static rules（确定性）+ llm rules（语境判断）
4. **结构化输出**：类似 eslint，LLM 友好
5. **完整文档**：Agent 和用户都有对应的文档

### 性能数据

- **规则加载**：< 10ms
- **文本扫描**：约 1ms / 100 行
- **总耗时**：< 100ms（1000 行以内）

## Historical TODO / Follow-ups（2026-06）

以下内容保留早期实现过程，不代表 3.0.0 当前待办；当前待办以 sibling llmlint Task 23/24 为准。

### 当前 MVP 范围（已完成）
- ✅ 实现规则 JSON 文件
- ✅ 实现 CLI 工具（llmlint package）
- ⏸️ 集成到 workspace CLI（暂缓，独立工具即可）
- ✅ 编写 SKILL.md
- ✅ 创建参考文档
- ✅ 测试和验证
- [ ] 更新 PROJECT-STATUS.md
- [ ] 实际使用测试（由用户或其他 Agent 测试）
1. 创建 `rules/static-rules.json`
2. 创建 `rules/llm-rules.json`
3. 创建 `rules/category-suggestions.json`

**文件结构**：
```json
// static-rules.json
[
  {
    "id": "filler-word-actually",
    "name": "填充词：其实",
    "category": "填充短语",
    "severity": "warning",
    "pattern": "其实|实际上|事实上",
    "description": "填充词"其实"是典型的 AI 写作痕迹",
    "reasoning": "这类词通常不增加实质内容，只是 AI 为了让语气显得自然而添加的填充"
  },
  ...
]

// llm-rules.json
[
  {
    "id": "not-but-structure",
    "name": "二元对比结构",
    "category": "二元对比",
    "severity": "warning",
    "pattern": "不是.*?而是",
    "description": "可能的二元对比结构",
    "reasoning": ""不是...而是..."结构是 AI 写作的常见模式，但某些情况下可能是合理的强调对比",
    "llmJudgmentPrompt": "判断这个"不是...而是..."结构是否是不必要的 AI 味道，还是作者有意的强调对比。如果可以直接陈述后半部分而不损失语义，则应该标记。",
    "llmExamples": [...]
  },
  ...
]

// category-suggestions.json
{
  "填充短语": {
    "fixSuggestion": "这类填充词通常不增加实质内容，只是 AI 为了让语气显得自然而添加的填充。建议直接删除，或替换为更有实质意义的过渡。",
    "examples": [...]
  },
  ...
}
```

### 阶段 2：CLI 工具实现

**任务**：
1. 创建 `cli/checker.ts`
2. 实现规则加载
3. 实现文本扫描
4. 实现输出格式化
5. 集成到 workspace CLI

**核心逻辑**：
```typescript
// 1. 加载规则
const staticRules = loadStaticRules();
const llmRules = loadLLMRules();
const suggestions = loadCategorySuggestions();

// 2. 扫描文本
const issues = scanText(content, [...staticRules, ...llmRules]);

// 3. 按类别分组
const grouped = groupByCategory(issues);

// 4. 格式化输出
printReport(grouped, suggestions);
```

**验证**：
- 运行 `bun .nbook/agent/skills/llmlint/bin/llmlint.ts check test.md`
- 检查输出格式
- 验证行号准确性

### 阶段 3：Skill 定义

**任务**：
1. 创建 `SKILL.md`
2. 编写完整的 6 步工作流程说明
3. 包含 CLI 使用说明
4. 包含 LLM 审查逻辑
5. 包含 Web 调研时机
6. 包含修复执行方法

**SKILL.md 结构**：
```markdown
# 去 AI 味道（Anti-AI-Slop）

## 何时使用
- 用户请求润色文本、去除 AI 味道、优化写作风格
- 用户提供文本说"这看起来很 AI"

## 工作流程

### 步骤 1：获取输入文本
...

### 步骤 2：CLI 静态检查
...

### 步骤 3：LLM 深度审查
...

### 步骤 4：生成修复计划
...

### 步骤 5：执行修复
...

### 步骤 6：生成报告
...

## 工具使用

### CLI 检查
```bash
bun .nbook/agent/skills/llmlint/bin/llmlint.ts check <file>
bun .nbook/agent/skills/llmlint/bin/llmlint.ts check <file> --min-level medium
```

### Web 调研
当遇到专有名词、科幻设定、同人梗等不确定内容时：
invoke_agent("researcher", { query: "..." })

### 文本修复
read: 读取原文
edit: 执行修改（从后往前，避免偏移）
write: 生成报告
```

### 阶段 4：测试和优化

**任务**：
1. 创建测试文本
2. 运行完整流程
3. 验证修复结果
4. 调整规则和提示词

### 阶段 5：文档更新

**任务**：
1. 更新 `PROJECT-STATUS.md`
2. 更新本 task README
3. 创建参考文档 `references/patterns.md`（可选）

## Historical TODO / Follow-ups（2026-06，续）

### 当前 MVP 范围
- [x] 实现规则 JSON 文件
- [x] 实现 CLI 工具（llmlint package）
- [x] 编写 SKILL.md
- [x] 测试和验证
- [x] 更新 PROJECT-STATUS.md
- [x] 2026-06-14：将用户面心智收敛为文本润色
- [x] 2026-06-14：注入 stop-slop 本地化规则
- [x] 2026-06-14：加入快速审查清单和 50 分评分
- [x] 2026-06-28：重命名为 llmlint 并硬切旧 skill key
- [x] 2026-06-28：改为自包含 ESM package
- [x] 2026-06-28：支持 `llmlint.config.ts` 规则覆盖
- [x] 2026-06-29：升级为 flat Rule Registry，加入 ruleset / namespace / rule 三层配置、override diagnostics、curated 默认规则集生成和 JSON 输出
- [x] 2026-06-29：策展合并 `旧中文规则样本目录`，通过内部模块生成单一中文精选 ruleset
- [x] 2026-06-29：合并官方默认 ruleset 为 `builtin/default`，中文规则 ID 语义化
- [x] 2026-06-29：优化 CLI stylish 输出，按 high / medium / low 分段，默认紧凑显示行列范围和命中文本，并支持 `--min-level`
- [x] 2026-06-29：新增 `--show-lines`，小文件或人类阅读时显示完整命中行与 `<mark>`

### 后续增强（第二版）
- [ ] 为快速审查评分沉淀更稳定的示例集
- [x] 支持完整命中行上下文
- [ ] 支持 namespace / rule 维度的临时 CLI 过滤
- [ ] 性能优化（大文件处理）

### 长期规划
- [ ] Web 版本部署（暴露给测试用户）
- [ ] 收集用户数据优化规则
- [ ] 支持风格自定义
- [ ] 支持特定领域（科幻、同人等）
- [ ] 词性标注（如需要）
- [ ] 排比结构检测
- [ ] 情感公式化检测
- [ ] 发展为完整的 AI 润色助手产品

## References

- 规格说明文档：`.agent/workspace/anti-ai-slop-spec.md`
- 设计讨论：`.agent/workspace/rule-system-design.md`
- 实现难度分析：`.agent/workspace/anti-ai-slop-analysis.md`
- 润色流程设计：`.agent/workspace/polish-workflow-design.md`
- stop-slop skill 参考：`assets/workspace/.nbook/agent/skills/stop-slop/`
