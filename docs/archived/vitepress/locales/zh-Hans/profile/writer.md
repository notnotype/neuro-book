# Writer

::: tip 普通作者不用读这一页
这页讲的是 `writer` profile 的内部合同（输入格式、字段、工具边界），面向 profile 作者和开发者。

**你只是想让 AI 写章节的话**，直接跟 leader 说就行，它会自动调用 writer——看 [写出前三章](/tutorials/04-first-three-chapters) 即可。
:::

`writer` 是正式正文写作 agent。它的任务是把已经明确的写作目标、Plot 上下文、设定引用和写作约束落实到本轮指定的 Markdown 文件。

它不是 planner，不是 retrieval，也不维护剧情结构或世界状态——它对剧情和 World Engine **只读**。

## 长期 Writer Session

普通 `writer` 是可复用写作工位。创建时使用空 initial：

```json
{
  "profileKey": "writer",
  "initial": {}
}
```

每轮调用通过 `invoke_agent.message` 写清自然语言任务，通过 `invoke_agent.input` 指定唯一目标文件和建议读取清单：

```json
{
  "message": "请续写这一章，从主角推开档案室门开始，到她发现账册缺页并决定隐瞒为止。\n\n【Scene 上下文】\n- 场景：皇宫西配殿档案室，傍晚\n- 时间范围：帝纪520年4月12日 申时-酉时\n- 出场角色：萧云舒（主角，女官）\n- 前情：主角被派来调查账目，但她怀疑这是陷阱\n- 关键剧情点：主角发现账册第8页被撕掉，意识到有人故意留下痕迹\n- 信息控制：主角知道账册缺页，但不知道是谁撕的；读者和主角知道的一样多\n- World Engine 查询提示：查询萧云舒在帝纪520年4月12日酉时的状态、位置和心理状态\n\n写完后润色一次并 report_result 汇报实际修改路径和约 100 字剧情摘要。",
  "input": {
    "path": "my-novel/manuscript/001-volume/003-chapter/index.md",
    "context": {
      "lorebookEntries": ["my-novel/lorebook/character/protagonist/"],
      "readablePaths": ["my-novel/manuscript/001-volume/002-chapter/index.md"]
    }
  }
}
```

`message` 必须可独立表达本轮任务：写什么、范围、约束、结束条件和交付要求。`input.context` 只是结构化引用清单，不能替代任务说明。

**注**：遗留字段 `context.threadIds/sceneIds/plotIds` 可选保留向后兼容，但 writer 不会使用它们独立读取 Plot。需要 Scene/World Context 时，必须由 leader 编译完整 brief 后放入 `message`。

## Profile 预设

`writer` 通过 profile settings 提供可视化预设配置。入口在设置页的“Agent Profile 模型”面板中，`writer` 卡片会显示“Profile 预设”区域。

当前字段：

- `customTopSystemPrompt`：最高优先级置顶提示词，插入在 Writer 系统提示词最前面，是优先级最高的自定义规则；留空不注入。
- `writingStylePreset`：默认文风要求（条文式规则），来自当前 Project Workspace 的 `agents/writer/styles/`，可在 Project Config 中选择、编辑、新增、重命名和删除非当前资源。
- `writingReferencePreset`：默认文风参考样本（供模仿的正文），来自当前 Project Workspace 的 `agents/writer/references/`，可在 Project Config 中选择、编辑、新增、重命名和删除非当前资源。
- `narrativePerson`：默认人称，支持第一人称、第二人称、第三人称。
- `paragraphRhythm` / `wordCountControl` / `polishingWorkflow` / `adultStylePrompt`：段落节奏、默认字数、润色工作流和成人风格增强；都是长期默认值，本轮 message 明确要求时以任务为准，`adultStylePrompt` 留空则完全不注入。

这些设置保存在 Config 的 `agent.profiles.writer.settings` patch 中。Global Config 只能保存 selected key / 人称这类配置值，不绑定某个 Project 的资源文件；Project Config 可对单个字段选择“继承”或“覆盖”，并把资源内容变更随同一次保存提交。保存后下一次 writer prepare / run 生效，已有长期 session 不需要重建。

第一次打开 Project scope 的 Agent Profile 模型面板，或运行当前 Project 的 `writer` 前，系统会确保 `agents/writer/` 已初始化。默认资源来自内置 `writer.home`，写入时只补缺失文件，不覆盖用户已经改过的文风或参考样本。Project scope 中的“重置 Home”会清空并按当前 profile 版本重新生成这些资源。

优先级：

- 本轮 `invoke_agent.message` 中明确提出的文风、人称或叙事要求优先。
- 其次使用 `ctx.settings` 中的 profile 预设。
- 最后回退到 writer profile 内置默认值。

不要把文风、人称这类默认偏好放回 `initial` 或 `invoke_agent.input`。`initial` 仍是创建期稳定数据，`input` 仍是单次任务的结构化载荷。

## Writer 能看到什么

writer prepare 阶段只注入：

- `input.path` 对应的唯一目标文件。
- 可推导的 `projectPath`、`projectSlug` 和可选 `chapterPath`。
- `lorebookEntries`、`readablePaths` 建议读取清单。

writer 不自动读取 Plot、lorebook 或普通文件正文。**本轮需要的 Scene / World Context 由上游 leader 通过 `get_chapter_writer_brief` 编译后，完整写入 `invoke_agent.message`。**

Writer 按需主动调用工具：

- `read`：读取目标文件、lorebook 节点 `index.md` / `state.md` 或 `readablePaths`。
- `execute_world`：只读查询 World Engine 状态（查询角色位置、HP、关系等）。

第一版不在文件工具层做硬权限限制；writer prompt 会要求只写 `input.path`，并只按需读取 `message` 和 `context` 指向的材料。

## 写作前的准备

调用 writer 前，leader 应尽量准备好：

- `input.path`：唯一目标Markdown文件，必须是当前Project Workspace相对路径，例如`manuscript/.../index.md`。
- `message`：本轮正文任务、范围、重点、禁忌和结束条件。
- **Scene / World Context**：leader 用 `get_chapter_writer_brief` 编译后的章节 brief，包含：
  - 关键剧情点和 Scene 摘要
  - 时间范围和出场 subjects
  - 信息控制要求（谁知道什么）
  - World Engine 查询提示（"查询主角在纪元12345的状态"）
- 设定引用：建议读取的 lorebook entries 或 readablePaths。
- 禁止改动的事实和边界。

如果剧情状态尚未裁决，先使用 World Engine 推进流程，而不是让 writer 自己判断世界怎么变。

## RP Writer 不同

`rp.writer` 只用于 RP Tick 的可见文本渲染。它的 profile initial 为空，只消费上级注入的 Writer Brief。普通 `writer` 用于正式正文文件，不承担 RP Tick 主持或世界状态维护。

## 继续阅读

- [Novel Writing Workflow](https://github.com/notnotype/neuro-book/blob/master/packages/neuro-book/assets/reference/agent/novel-writing-workflow.md)
- [写出前三章](/tutorials/04-first-three-chapters)
- [Leader 协作协议](https://github.com/notnotype/neuro-book/blob/master/packages/neuro-book/assets/reference/agent/leader-default.md)
