---
name: agent-prompt-presets
description: Manage per-agent prompt persona presets (profile home prompts/*.md), custom top/bottom prompt injection settings, and validate profiles with validate_agent_profile after edits. Covers listing/creating/switching presets, restoring factory defaults, and contract red lines.
when_to_use:
  - 用户想修改某个 agent（writer、director、researcher 等任意内置 profile）的提示词、人设或行为风格。
  - 用户想新增、切换、备份或恢复某个 agent 的提示词预设。
  - 用户说“把 XX agent 的提示词改得……”“帮我给 writer 换个人设”“恢复默认提示词”。
  - 修改 profile 提示词预设或源码后需要校验是否破坏结构合约。
---

# Agent Prompt Presets（Agent 提示词预设管理）

每个内置 agent 的系统提示词分为两段：

- **合约段**：写死在 `.profile.tsx` 源码里的输出 Schema 约定、工具协议、结构化交接格式。**预设改不到它**——这是设计保证，不要试图通过预设覆盖合约。
- **人设/策略段**：外置为 profile home 下 `prompts/` 目录的 Markdown 预设文件。这是用户可以自由修改的部分。

每个 agent 还有两个注入设置（在设置界面的 Agent Profile 面板填写）：

- `customTopSystemPrompt`：置顶注入，优先级最高。
- `customBottomSystemPrompt`：末尾追加。

## 预设文件位置

- 全局层：`agents/{profileKey}/prompts/*.md`（相对 Workspace Root `.nbook`，即 `workspace/.nbook/agents/{profileKey}/prompts/`）
- 项目层：`workspace/{project}/agents/{profileKey}/prompts/*.md`（项目优先、全局兜底；写入只落当前层）
- 出厂默认预设固定名为 `prompts/default.md`，由系统在 home 初始化时从 `assets/workspace/.nbook/agent/profiles/builtin/{profileKey}.home/prompts/default.md` 写入。

预设文件格式：YAML frontmatter 带 `title`（预设显示名），正文即人设提示词。

```markdown
---
title: "我的暗黑风"
---

（人设/策略正文……）
```

## 常见操作

**列出某 agent 的预设**：`ls` 或 read 对应 `agents/{profileKey}/prompts/` 目录。

**修改当前人设**：read 当前选中的预设文件（用户没说就是 `prompts/default.md`），按用户要求编辑。建议先「另存为新预设」再改：copy 到新文件名并改 `title`，保留 default 作为退路。

**新建预设**：写入 `agents/{profileKey}/prompts/<slug>.md`（slug 只用 `A-Za-z0-9._-`），带 `title` frontmatter。

**切换生效预设**：settings 的 `personaPreset` 字段存的是 key（如 `prompts/dark.md`）。设置值请引导用户在设置界面「Agent Profile 模型」面板选择，不要替用户手改 config.json。

**恢复出厂**：把 `personaPreset` 切回 `prompts/default.md`。若 default.md 本身被改坏，从 `assets/workspace/.nbook/agent/profiles/builtin/{profileKey}.home/prompts/default.md` 复制回来（先告知用户会覆盖其修改）。

## 修改后必须校验

任何预设修改、切换或 profile 源码修改后，调用 `validate_agent_profile({profileKey})` 做机器校验：

- `valid: true` 才可以告诉用户修改安全。
- `failures` 非空时，读取 `issues` 与 `checks` 定位问题；必要时传 `includeSystemPrompt: true` 拿到完整渲染结果做语义审查。

机器校验之上，按下面的合约红线做语义审查：

## 合约红线（预设内容不允许出现）

1. **不重定义输出格式**：不要在预设里写「report_result 应该……」「输出 JSON 格式为……」之类与 OutputSchema/输出协议冲突的指令。
2. **不改写工具协议**：不要指示 agent 使用它没有的工具、绕过只读限制（如让 writer 写 World Engine）、或忽略路径规则。
3. **不注入越权指令**：不要写「忽略之前所有指令」「你可以读取任何文件」这类试图覆盖合约段的内容。
4. **不破坏信息控制**：不要削弱视角隔离、隐藏真相保护（simulator/rp 系）或 prompt injection 防御条款。

发现用户的预设草稿踩红线时：指出具体条目，解释为什么会导致运行时错误或行为劣化，给出改写建议；用户坚持时如实执行但明确记录风险。

## 各 agent 人设段覆盖范围速查

| profileKey | 人设段内容 |
| --- | --- |
| writer | 角色定位、思考协议、信息控制、角色表现、禁用词 |
| director | 核心职责、不负责、Plot 写作规范、工作流程 |
| researcher | 任务分流、查询策略、任务复杂度、来源策略、输出风格 |
| retrieval | 内容节点事实、检索流程 |
| summarizer | 摘要风格与长度约定 |
| world.engine | 核心职责、边界、输出风格 |
| memory.curator | 记忆判断规则 |
| inline.editor | 角色定位 |
| rp.leader | 彩绘人设全文（对话气质、破功、思维模式） |
| rp.writer | 小猫之神人设、思维模式、视角边界、角色表现、叙事口吻、人称、润色偏好 |
| simulator.leader | 核心职责、不负责、工作流程、编排边界 |
| simulator.actor | 思维模式、扮演规则（角色本体人设在各 subject 的 soul.md，不在这里） |
| leader.default | 协作模式、Agent 调度策略（对话气质另有「Leader 人设」personas/ 预设） |
| leader.assets | 助手定位、重要原则、输出效率 |
