# 旧应用的 Agent 资产、评测做法与临时代理（2026-10-30）

- 问题：[t18](../tasks/t18-builtin-profiles/README.md) 要定第一批内置 Profile 与 Skill、提示词规范与评测方法。
- 做法：两个 Haiku 子代理分头盘点旧应用资产与仓库里的评测做法；主会话核对了数量（Profile 14、Skill 17、文风预设 53）、唯一的 `*.llm.test.ts`、旧应用 adhoc 与 omp task 的源码。
- 证据等级：**核实**为主会话读过原文；其余为子代理走查。

## 1. 旧应用的内置 Profile

目录 `packages/neuro-book-legacy/assets/workspace/.nbook/agent/profiles/builtin/`，TSX 写的 `defineAgentProfile`，分节用 XML 标签（`<role_definition>`、`<hard_rules>`），以中文为主；只有 writer 有 `manifest.version`。

| key | 用途 | 文件字符数 | 依赖的领域工具 |
|---|---|---|---|
| leader.default | 主创，默认统筹 | 19,888（核实） | World、Plot 读写，SQL，workflow，jobs |
| leader.assets | 维护 `.nbook` 资产 | 12,973 | — |
| writer | 正文写作，设置表单 8 项（含文风预设） | 26,779 | World 只读、Plot 读 |
| director | Thread、Scene 结构与伏笔 | 5,933 | Plot 读写 |
| world.engine | subject、slice 增删查 | 6,229 | World 读写 |
| rp.leader、rp.writer | 跑团主持与写作 | 18,212、17,103 | Plot 读 |
| simulator.leader、simulator.actor | 世界模拟与角色模拟 | 9,395、8,948 | Plot 读 |
| memory.curator | subject 记忆的 JSON Patch | 3,090 | — |
| researcher | 联网研究 | 5,105 | web_search、web_fetch |
| retrieval | 召回节点候选 | 4,370 | — |
| inline.editor | 选区短程编辑 | 7,037 | — |
| summarizer | 会话标题与摘要，每 16 次调用重写 | 2,501（核实） | — |

另有代码里注册的 `adhoc`（见第 4 节）与代码内兜底的 summarizer、default profile。没有提示词质量评测，只有结构上的合同测试（`server/agent/profiles/*.test.ts`）与要密钥的真实模型 smoke（`scripts/smoke/real-model/`）。

## 2. Skill、文风预设与参考文档

- Skill 17 个（`skills/<name>/SKILL.md`）：带脚本的 6 个（llmlint、novel-data、两个导入、skill-creator 中英两份）；小说写作类 9 个（novel-guide、novel-setup、novel-writing、novel-writer-execution、novel-idea-exploration、novel-genre-research、角色卡工坊、RP 模式、stop-slop）；Profile 编写类 2 个（profile-system-guide、tsx-profile-editing）。
- 文风预设 53 个（`profiles/builtin/writer.home/styles/*.md`），frontmatter 加文风指令正文，经 writer 设置表单的 `writingStylePreset` 选择、渲染为 `<writing_style>`。`.agents/tasks/133-style-eval` 只有一组样本，不构成结论。
- 参考文档（`assets/reference/agent/`）：profile-guide、profile-routing、context、profile-import、profile-compiled-artifacts、leader-default、skill-package、agent-asset-install、workflow/authoring 等，都按旧的 `defineAgentProfile` 写。

## 3. 仓库里的评测做法

- **nb-story 问答**（w00024 t05，`evidences/qa-eval/report.md`）：题集 56 题（图当目录）加 16 题（知情与身份），每题 3 遍；模型裁判看原文、四档结论；门槛写成整数（168 次里最多错 33）。gpt-6-luna 不开推理错 38/168，xhigh 错 11/168；渠道常报 upstream_error，靠重试补齐。
- **w00005 记忆图**：裁判二审波动约 ±3 个百分点；标准答案本身要二审修题；一轮约 126 元（deepseek-flash）。
- **llmlint 的 A/B**（`packages/llmlint/evals/experiments/guide-arm`）：同一批题，唯一变量是提示词；要分模型看，合并会出假显著；基线贴地板时没有分辨力。`docs/testing/README.md` 写 llmlint 准备退役。
- **真实模型测试约定**（`docs/testing/README.md`）：`*.llm.test.ts`，`NBOOK_LLM_TESTS=1` 才跑，断言结构化结果不断言措辞，运行前要开发者授权。现有只有 `packages/nb-harness/tests/harness.llm.test.ts`（核实），两条确定性断言。
- **w00031 t05** 中英文提示词评测：搁置。

## 4. 临时代理（adhoc）与派发参数

- **旧应用 adhoc**（核实，`server/agent/profiles/adhoc-profile.ts`）：初始输入 `{name?, systemPrompt, outputSchema?}`，任务放每次调用的消息；工具固定 `read` 加 `report_result`，注释写“防临时工提权；二期再议”；提示词是角色名、`systemPrompt` 与一段汇报纪律；schema 创建时校验、不合法即失败（`dataSchemaFromInitial`）。主要用于 Workflow 的并发帮工（`wf.agents.create("adhoc", …)`）。
- **omp task**（核实，`src/task/types.ts`）：`agent`（缺省 `task`）、`task`、`solutionSpace`、`name?`、`effort?`、`outputSchema?`、`schemaMode?`、`tools?`、`isolated?`。`outputSchema` 每次派发给；`tools` 是把 eval 里定义的工具额外交给子代理（要开 `eval.tools.enabled`），不是缩小。只读的 scout 工具为 read、find、grep、glob、web_search，没有 bash；缺省派全工具的 task。
- **Claude Code** Agent 工具：`description`、`prompt`、`subagent_type`、`model`、`effort`、`isolation`，没有工具参数；Explore 的工具是“除派子代理与写文件之外的全部”，含 Bash。
