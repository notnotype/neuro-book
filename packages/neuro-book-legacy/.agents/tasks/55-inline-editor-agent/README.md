# Inline Editor Agent

## Relative documents refs

- [Agent profile guide](../../../reference/agent/profile-guide.md)
- [Agent profile routing](../../../reference/agent/profile-routing.md)
- [Agent context](../../../reference/agent/context.md)
- [Project status](../../../PROJECT-STATUS.md)

## User Request / Topic

- 删除旧的 `/api/writing/continue` 行内续写接口和调用链，但不要删除 `NovelPromptBar` 组件。
- `NovelPromptBar` 至少要保留为一个类似的底部输入组件，并可以直接在它基础上重构成 Inline AI Prompt Bar。
- 删除旧 `/api/writing/continue` 接口残留。
- 在 `TipTapMarkdownEditor` 的 selection menu 中启用 AI 功能；当前 `AI Improve` 只是占位。
- 新增选区 AI 动作：改写、润色、扩写、缩写、续写、承接。
- 点击 selection menu 的 sparkles / AI 后，不显示临时小输入框，而是展开底部 Inline AI Prompt Bar，并把当前选区作为引用传入。
- 底部输入组件默认收起；展开后允许用户输入较长、较复杂的编辑要求。
- 输入组件需要能切换模型、绑定 session、显示当前选中文本引用、选择任务类型（带图标下拉）。
- 输入组件上方需要能流式显示当前 edit 工具调用正在修改的内容。
- `NovelPromptBar` 的挂载位置可能需要调整；Inline AI Prompt Bar 只在当前文件是 Markdown / 纯文本这类可文本编辑文件时启用，核心触发面来自 `TipTapMarkdownEditor` 的 selection menu。
- 提示词需要包含当前文件、行号、选区正文；选区正文用 XML 标签包裹。
- 润色类任务不再走旧 continue 接口，而是新增一个 profile；默认自动为该 profile 创建 session，用户也可以主动绑定 session。

## Goal

把 Markdown 富文本选区 AI 从旧的 `/api/writing/continue` 流式续写能力迁移到 Agent session 体系：用户在 TipTap 选区菜单点击 sparkles 后，底部 Inline AI Prompt Bar 自动展开并接收当前选区引用；用户可选择对话、改写、润色、扩写、缩写、续写或承接，输入更长的自然语言要求，选择 inline session 与模型，然后把带文件路径 / 行号 / XML 选区正文的 prompt 发送给 `inline.editor` profile 的 Project 级绑定 session。Agent 默认直接修改目标文件，而不是只返回建议。

验收证据：

- 旧 `NovelPromptBar` 不再承担 `/api/writing/continue` 续写职责，而是被重构为默认收起的 Inline AI Prompt Bar。
- `/api/writing/continue`、`NovelContinue*` DTO、OpenAPI 特判和前端调用全部删除。
- TipTap selection menu 的 sparkles / AI 按钮会展开底部 Prompt Bar，并把当前选区引用写入该输入栏。
- 底部 Prompt Bar 支持任务下拉、inline session 选择、独立新建 session、原地模型切换、选区引用展示和长文本编辑要求输入。
- Prompt Bar 只在当前 active file 是可编辑文本表面时渲染 / 启用；非文本文件、欢迎页、只读或不可编辑节点不显示这个入口。
- 发送后后台运行，不自动打开 / 聚焦 Agent 面板；Prompt Bar 自动创建或复用当前 Project Workspace 的 `inline.editor` session，只有用户显式点击“打开 Session 聊天”才进入右侧 Agent 面板。
- edit 工具调用运行时，输入框上方能流式显示当前修改内容或修改摘要。
- 发送到 Agent 的消息包含目标文件、选区行号定位、XML 包裹的选区正文和明确动作。
- `inline.editor` profile 可加载、可创建 session，并拥有 `read` / `edit` / `write` / `report_result` 工具。

## Current State

- 旧入口在 `app/pages/index.vue` 的 `startContinue` / `stopContinue`，调用 `/api/writing/continue` 并把 SSE token 追加到 Markdown Studio。
- `server/api/writing/continue.post.ts` 已是 501 tombstone，但前端、DTO 和 OpenAPI 仍有残留。
- `NovelPromptBar.vue` 当前是旧底部输入 UI，结构上适合作为 Inline AI Prompt Bar 的改造基础：已有展开 / 收起、textarea 自适应高度、模型 / 推理展示和状态栏。
- 旧 `NovelPromptBar` 现在挂在 IDE 主布局底部，后续可能需要移动到 `MarkdownStudioWorkbench` / 文本编辑区附近，避免在非文本 workspace 视图中占位。
- `MarkdownSelectionMenu.vue` 当前有 disabled 的 `Improve` 按钮。
- `TipTapMarkdownEditor.vue` 已有 `selectedText()`、`selectedClipboardText()`、`replaceSelection()`、`appendMarkdown()` 等能力，可作为选区信息来源。
- `AgentChatSurface.vue` 已能创建 / 选择 / 调用 session，但还没有公开给外部组件发送 prompt 的最小桥接方法。
- Agent session 列表默认只查 `profileGroup: "leader"`；`inline.editor` 不应该混入主创 session 列表。

## Decisions / Discussion

- AI 结果默认直接修改文件。
- Inline AI session 默认按 Project Workspace 绑定复用。
- 新增 profile key 使用 `inline.editor`，中文名“Inline AI 编辑”。
- `NovelPromptBar` 不删除，改造成 Inline AI Prompt Bar；删除的是旧 `/api/writing/continue` 语义和调用链。
- Inline AI Prompt Bar 默认收起；selection menu 的 sparkles / AI 只负责展开它并传入当前选区引用。
- 任务选择放在 Prompt Bar 内部，用带图标的下拉菜单承载“对话、改写、润色、扩写、缩写、续写、承接”。
- 用户可能输入较多要求，所以不做临时 popover 输入框；Prompt Bar textarea 是主要输入面。
- Prompt Bar 显示当前绑定 session，并提供绑定 / 切换入口。
- Prompt Bar 内原地复用 Agent session 模型控制组件，模型覆盖只作用于当前 `inline.editor` session。
- Prompt Bar 显示当前选区引用卡片，包含文件名、行号状态、选区摘要和清除引用入口。
- edit 工具流式适配以“修改预览条 / diff 摘要 / 当前编辑片段”形式显示在输入框上方，不把大段工具流塞进按钮状态。
- Prompt Bar 的启用范围绑定当前 active editor：Markdown / 纯文本可编辑文件启用；欢迎页、不可编辑节点和非文本文件禁用或不渲染。
- 第一版 sparkles 触发只来自 `TipTapMarkdownEditor` selection menu；如后续要支持 Monaco / 源码纯文本选区，需要单独补选区捕获入口。
- Inline AI v1 只支持 TipTap 富文本选区菜单，不扩展源码模式 / Monaco 选区。
- AI 编辑结果默认直接写入文件，不增加逐次审批确认。
- Prompt Bar 允许无选区使用；无选区时任务目标是当前文件 / 当前编辑上下文，UI 明确显示“未绑定选区”。
- 第一版不支持源码模式 / Monaco 纯文本选区捕获；纯文本文件可显示 Prompt Bar，但选区引用触发后续单独补。
- edit 工具流式预览采用轻量粒度：显示正在编辑的文件、工具调用摘要和最近修改片段，不做完整实时 diff。
- AgentChatFlow 不展示完整选区正文；用户消息默认只展示选区 chip，实际选区正文通过 inline editor payload / profile prompt 转成 XML 给模型。
- Prompt Bar 允许多个选区引用；用户多次点击 selection menu sparkles 时追加新的选区 chip，而不是覆盖旧引用。
- Selection menu sparkles 文案改为“加入 AI 引用”或等价语义，避免被理解成点击后立即执行 AI 修改。
- Prompt Bar 发送成功后清空输入内容和选区 chips；失败时保留，方便用户修正后重发。
- Prompt Bar 文本域复用 `ReferencePlainTextEditor`，并扩展一个 inline selection reference chip。
- AgentTextBubble 的 Markdown 渲染也要支持 inline selection reference chip，使已发送消息能显示相同 chip。
- Selection chip 使用代码引用风格，例如 `[[src/components/Button.vue#L15-L32]]`、`[[src/main.ts#L80]]`、`[[README.md]]`；同时识别无括号短格式 `src/server.ts#45-67`。完整选区正文仍只保存在本轮 selection payload，不塞进可见消息。
- 行号定位基于当前序列化 Markdown 尽力匹配选区文本；唯一匹配给起止行号，重复或找不到时标记 `ambiguous` / `unknown` 并仍发送选区正文。
- 前端不直接替换选区；修改由 `inline.editor` 读取文件后使用文件工具完成。
- 只删除旧写作 `/api/writing/continue`；不要删除 Agent session 的 `mode: "continue"`，它仍用于审批恢复、空消息继续和 session tree retry。
- 用户主动管理 session 使用 PromptBar 内半透明 session 菜单，只列出当前 Project Workspace 的 `inline.editor` active sessions；session 列表自动刷新，新建 session 使用独立按钮，Project 级绑定 id 存在 localStorage。右侧 Agent 面板只作为显式聊天 / 调试入口。
- 所有 Agent 的 cwd 都是 Workspace Root；所有文件工具路径必须包含 project slug 前缀，格式为 `project-slug/manuscript/...`。
- 前端负责从 IDE store 的 Project Workspace 相对路径转换为完整路径；profile 只使用 payload 的完整原值，不做路径拼接或猜测。

## Implementation Walkthrough

- 2026-06-17：创建 task。根据用户要求和只读调研结果记录实现计划：旧 Prompt Bar 与 writing continue API 清理；TipTap selection menu 增加 inline AI 菜单；新增 `inline.editor` profile；通过 AgentChatSurface 暴露外部 prompt 发送桥；文档与 profile artifact 同步。
- 2026-06-17：根据 UI/UX 讨论修正计划：不删除 `NovelPromptBar`，而是在它基础上重构底部 Inline AI Prompt Bar；selection menu sparkles 只负责展开输入栏并传入选区引用；输入栏承担长文本要求、任务下拉、模型切换、session 绑定、选区引用展示和 edit 工具流式修改展示。
- 2026-06-17：补充挂载范围：Prompt Bar 不再按全局 IDE 底栏思路无条件显示，需要跟随文本编辑 surface；当前 Markdown / 纯文本可编辑文件启用，第一版 sparkles 触发来自 `TipTapMarkdownEditor`。
- 2026-06-17：用户确认四个关键 UX 决策：AI 编辑默认直接应用；Prompt Bar 允许无选区使用；第一版不做源码 / Monaco 选区捕获；流式预览显示文件、工具摘要和最近修改片段，不做完整实时 diff。
- 2026-06-17：用户确认第二批关键 UX / 协议决策：聊天里不展示选区正文；允许多个选区引用；发送成功后清空 Prompt Bar；复用 `ReferencePlainTextEditor` 作为输入面并新增 selection chip；`AgentTextBubble` Markdown 渲染也支持该 chip；绑定 session 仅限 `inline.editor`；无选区时由 AI 自行判断修改范围。
- 2026-06-18：只读调研现有代码后确认实现路径：保留并重构 `NovelPromptBar`，删除旧 `/api/writing/continue` 调用链；TipTap 富文本选区使用现有 `selectedClipboardText()` 作为 selection payload 正文来源；Prompt Bar 长输入复用 `ReferencePlainTextEditor`；Agent 调用复用 `AgentChatSurface` 的 session/invoke 能力和现有 `input -> payload` 映射，不新增业务 API；新增 `inline.editor` profile 使用现有 `read` / `edit` / `write` / `report_result` 工具。
- 2026-06-18：完成第一版实现。新增 `app/utils/inline-editor-selection.ts`；扩展 `ReferencePlainTextEditor` plain token/node、reference chip 视觉和 Agent Markdown 渲染，使 `[[path#Lx-Ly]]` selection chip 可解析、序列化和展示；TipTap selection menu 的 `Improve` 改为“加入 AI 引用”，事件链贯通到首页；`NovelPromptBar` 重构为 Inline AI Prompt Bar，支持任务下拉、多个选区 chip、长输入、session/model 入口和 edit/write 工具预览；`AgentChatSurface` 暴露 `openInlineEditorSession()`、`sendInlineEditorPrompt()` 和 `inlineEditPreview`，自动创建 / 复用 `inline.editor` session；新增 `inline.editor.profile.tsx` 和 payload schema，并编译系统 profile artifact；删除旧 `/api/writing/continue`、`NovelContinue*` DTO、OpenAPI route-map/generator SSE 特判和首页旧 SSE 调用链。
- 2026-06-18：审查后修复三类问题。短格式 selection chip 解析收窄为明确文件路径，避免把 `issue#123` 和 URL fragment 误识别为选区；TipTap 选区行号优先基于编辑器选区位置和序列化 Markdown 前缀推导，不再只依赖纯文本匹配；Prompt Bar 的 edit/write 预览只显示当前 `inline.editor` session 中正在运行的工具调用，避免无关历史工具污染。
- 2026-06-24：路径解析修复。Session 244 审查发现工具调用失败根因是前端传递裸路径 `manuscript/...`，但 Agent cwd 是 `workspace/`，导致解析为 `workspace/manuscript/...` 而非 `workspace/project-slug/manuscript/...`。修复方案：前端新增 `resolveInlineEditorTargetPath()` 和 `resolveInlineEditorReferences()` helper，在构造 payload 时自动加上 project slug 前缀；修正 Schema 和 profile prompt 的误导表述；增强 profile context 渲染 projectSlug/projectPath。与 writer 的路径协议完全对齐。
- 2026-06-28：半透明 session 管理调整。Inline AI 发送改为后台运行，不再自动打开右侧 Agent 面板或切换主 Agent active session；`AgentChatSurface` 维护独立 inline session snapshot/messages/SSE stream；`NovelPromptBar` 内新增当前 Project 的 `inline.editor` session 菜单，支持选择、自动刷新与独立新建，并展示后台 edit/write 预览和 `report_result.result` 摘要。显式点击“打开 Session 聊天”时才打开右侧 Agent 面板进入当前 inline session。
- 2026-07-03：系统性修复 PromptBar 半透明 session 细节。系统 profiles 统一重新编译，修复 `inline.editor` 默认 `chat` 任务在 runtime 中因 stale artifact 不可运行的问题；PromptBar 禁止“空输入 + 无引用”误发送；后台 live view 和 edit/write 预览只投影最新用户消息之后的当前 turn，避免新一轮开始时显示上一轮 thinking/content；Inline AI session 模型控件在运行、加载、保存或无 session 时统一禁用，并在被拦截或保存失败后恢复 snapshot 草稿，避免 UI 与真实 session 设置漂移。

## Code Research Notes

### Reusable implementation points

- `app/components/novel-ide/NovelPromptBar.vue`
  - 当前已有默认收起 / 展开、高度上报、发送 / 停止按钮、模型 / 推理状态展示等底部输入栏外壳。
  - 后续不删除组件，而是在它基础上重构为 Inline AI Prompt Bar。
  - 旧 textarea 应替换或内嵌为 `ReferencePlainTextEditor`，保留高度上报与底栏交互思路。
- `app/components/markdown-studio/TipTapMarkdownEditor.vue`
  - 已有 `selectedText()` 可读纯文本选区。
  - 已有 `selectedClipboardText()`，通过 `getTextBetween(...textSerializers...)` 读取选区 Markdown，并能把引用节点输出为 Markdown。Inline AI 选区正文优先复用这个函数。
  - 已有 `getMarkdown()` / `replaceSelection()` / `appendMarkdown()` 等 editor handle，但 Inline AI v1 不直接前端替换选区，修改交给 Agent 文件工具。
- `app/components/common/form/ReferencePlainTextEditor.vue`
  - 已支持普通文本、workspace reference chip、skill chip、`submitOnEnter`、高度自适应和引用菜单。
  - Prompt Bar 的长文本输入面复用该组件，并扩展 selection chip。
- `app/utils/plain-reference-text.ts`
  - 已有 plain text token 化、ProseMirror doc 解析和序列化管线。
  - 适合扩展 `selection` token，支持 `[[path#Lstart-Lend]]` / `[[path#Lline]]` / `[[path]]` 以及短格式 `path#start-end`。
- `app/components/common/reference-chip.ts` 与 `app/styles/reference-chips.css`
  - 已集中处理 reference chip 视觉元数据与全局样式。
  - selection chip 应作为新的 entryType / tone 复用这条视觉系统。
- `app/utils/markdown/render.ts`
  - Agent Markdown 渲染已通过 Marked inline extension 把 workspace reference 渲染为 chip。
  - selection chip 应在这里增加 inline extension，让已发送消息和 Agent 气泡显示一致。
- `app/components/novel-ide/agent/AgentChatSurface.vue`
  - 已有 `createSession`、`selectSession`、`refreshSessionsWithQuery`、`agentApi.invokeSession(..., { mode: "prompt", message, input, clientState })` 和 `stopRun`。
  - 后续新增 expose 方法即可让外部 Prompt Bar 发送 inline editor invocation。
- `shared/dto/agent-session.dto.ts` 与 `server/agent/http.ts`
  - `AgentInvokeRequestDtoSchema` 已支持 `input`。
  - HTTP 层 `toInvokeInput()` 已把 `body.input` 映射为 harness `payload`。
  - 因此 Inline AI 不需要新增 HTTP API 字段或新业务接口。
- `server/agent/tools/file-tools.ts`
  - `read` / `edit` / `write` 已满足 inline editor profile 的文件读写需要。
  - `edit` 返回 `details.diff` 和 `firstChangedLine`，可作为 Prompt Bar 顶部轻量修改预览的数据来源。

### Important corrections from code reading

- 当前 Agent `read` 工具支持 `offset` / `limit`，并在截断时提示显示行号范围，但不会给正文逐行加 `L12 |` 前缀。
- 因此前端 selection payload 需要自行计算 `startLine` / `endLine`；profile 渲染 XML 时也应自行把选区正文格式化为 `L12 | ...` 这类定位片段。
- 前端目前没有现成的 “TipTap selection -> Markdown line range” 工具。v1 使用完整 Markdown 与 `selectedClipboardText()` 做唯一匹配：
  - 唯一命中：`match: "unique"`，生成 `[[path#L12-L18]]`。
  - 多处命中：`match: "ambiguous"`，生成 `[[path]]`，payload 仍保留选区正文。
  - 无法命中：`match: "unknown"`，生成 `[[path]]`，payload 仍保留选区正文。
- `AgentChatSurface` 当前 session 列表默认查 `profileGroup: "leader"`；`inline.editor` 不应混入主创 session 列表，Prompt Bar 需要单独管理绑定的 inline session id。
- 旧 writing continue 服务端接口已经是 tombstone，但前端、DTO、OpenAPI route-map 和 generator 特判仍有残留，需要一起删除。

### Files expected to change

- Prompt Bar / IDE host:
  - `app/components/novel-ide/NovelPromptBar.vue`
  - `app/pages/index.vue`
- TipTap selection event chain:
  - `app/components/markdown-studio/MarkdownSelectionMenu.vue`
  - `app/components/markdown-studio/TipTapMarkdownEditor.vue`
  - `app/components/markdown-studio/MarkdownStudio.vue`
  - `app/components/markdown-studio/MarkdownStudioWorkbench.vue`
- Selection chip and Markdown rendering:
  - `app/utils/inline-editor-selection.ts` or equivalent new utility
  - `app/utils/plain-reference-text.ts`
  - `app/components/common/form/tiptap/plain-reference-text-extensions.ts`
  - `app/components/common/reference-chip.ts`
  - `app/styles/reference-chips.css`
  - `app/utils/markdown/render.ts`
  - `app/utils/plain-reference-text.test.ts`
  - `app/utils/markdown/render.test.ts`
- Agent bridge and profile:
  - `app/components/novel-ide/agent/AgentChatSurface.vue`
  - `server/agent/profiles/builtin-contracts.ts` if shared schema is preferred
  - `assets/workspace/.nbook/agent/profiles/builtin/inline.editor.profile.tsx`
  - generated compiled profile artifacts after running profile build scripts
- Old continue removal:
  - `server/api/writing/continue.post.ts`
  - `shared/dto/novel.dto.ts`
  - `server/openapi/route-map.ts`
  - `server/openapi/generate-spec.ts`
  - old `startContinue` / `stopContinue` state and SSE parser in `app/pages/index.vue`

### Implementation order

1. Add inline editor protocol utilities:
   - `InlineEditTask`
   - `InlineEditReference`
   - `InlineEditPayload`
   - selection chip parse / build helpers
   - Markdown line-range locator based on unique selection text match
2. Add selection chip support to plain reference text editor and Agent Markdown rendering.
3. Enable TipTap selection menu sparkles:
   - rename disabled `Improve` to “加入 AI 引用”
   - emit selection event instead of executing AI immediately
   - build selection payload from `selectedClipboardText()` and active file path
   - forward event through `MarkdownStudio` and `MarkdownStudioWorkbench`
4. Refactor `NovelPromptBar` into Inline AI Prompt Bar:
   - default collapsed
   - task dropdown with icons
   - session binding and model override controls
   - selection chips display without full selection text
   - `ReferencePlainTextEditor` long input
   - lightweight edit preview above input
5. Add `AgentChatSurface` inline editor bridge:
   - expose `sendInlineEditorPrompt(payload)`
   - create or reuse `inline.editor` session
   - send visible message plus hidden payload via `input`
   - block or report if inline session is already running / waiting
6. Add `inline.editor` builtin profile:
   - declare payload schema
   - render payload into compact XML
   - use `read` before editing
   - prefer `edit` over `write`
   - call `report_result` after completion
7. Remove old `/api/writing/continue` chain and regenerate OpenAPI.
8. Run profile validation / compile and TypeScript checks.

## Selection Chip Syntax

Selection chip 使用代码引用风格，不使用复杂 URI：

```md
src/server.ts#45-67
[[src/components/Button.vue#L15-L32]]
[[src/main.ts#L80]]
[[README.md]]
[[src/api.ts#L10-L20]]
[[src/db.ts#L30-L45]]
```

- Prompt Bar 自动插入的 canonical chip 使用双中括号：`[[path#Lstart-Lend]]`。
- 手写 / 粘贴时也识别无括号短格式：`path#45-67`。
- 多行选区：`[[src/components/Button.vue#L15-L32]]` 或 `src/server.ts#45-67`。
- 单行选区：`[[src/main.ts#L80]]`。
- 文件级引用或行号无法唯一定位时：`[[README.md]]`，chip title / payload 中保留 `match: ambiguous | unknown` 状态。
- 路径优先使用 workspace 相对路径；显示空间不足时 chip label 可折叠为文件名，但序列化文本保留完整 path。
- 可见 chip 文本只保存定位摘要；完整选区正文保存在 Prompt Bar selection payload，并在发送时作为 `inline.editor` invoke payload 传入。
- Agent 可见的完整选区内容由 `inline.editor` profile 从 payload 渲染为 XML；AgentTextBubble 只渲染 chip，不渲染正文。

## Inline Edit Prompt Format

Inline AI 的提示词协议分三层：可见聊天消息只是 UI 回执；hidden payload 是前端到 `inline.editor` profile 的稳定协议；真正给模型看的内容由 profile 根据 payload 渲染成 XML。不要让 Agent 从可见 Markdown 消息里反解析选区正文。

### Visible message

可见消息只展示任务、引用 chip 和用户要求，不展示完整选区正文：

```md
**润色** [[manuscript/001/chapter.md#L12-L18]] [[manuscript/001/chapter.md#L31-L36]]

让这段更克制一点，减少解释，多用动作和环境表达情绪。
```

无选区时展示当前文件引用：

```md
**改写** [[manuscript/001/chapter.md]]

整体压低叙述腔，保留剧情信息，只改明显啰嗦的句子。
```

### Hidden payload

payload 保持轻量、结构化，并作为 `inline.editor` profile 的唯一可靠输入协议：

```ts
type InlineEditTask =
    | "rewrite"
    | "polish"
    | "expand"
    | "condense"
    | "continue_after"
    | "bridge";

type InlineEditPayload = {
    version: 1;
    task: InlineEditTask;
    targetPath: string;
    instruction: string;
    references: InlineEditReference[];
};

type InlineEditReference = {
    ref: string;
    path: string;
    range?: {
        startLine: number;
        endLine: number;
    };
    match: "unique" | "ambiguous" | "unknown";
    text: string;
};
```

- `references.length > 0` 表示选区任务；`references.length === 0` 表示无选区任务，由 AI 根据 `targetPath` 和 `instruction` 判断最小必要修改范围。
- `ref` 是用户可见的 chip 字符串，例如 `[[manuscript/001/chapter.md#L12-L18]]`。
- `text` 是完整选区正文，只存在于 hidden payload，不写入可见聊天消息。
- `continue_after` 用于避免和 Agent session 的 `mode: "continue"` 概念混淆；UI 仍显示为“续写”。

### Profile XML

`inline.editor` profile 把 hidden payload 渲染成模型输入。选区正文只在这里出现一次：

```xml
<inline_edit v="1" task="polish" op="replace" target="manuscript/001/chapter.md" scope="selection">
  <instruction>让这段更克制一点，减少解释，多用动作和环境表达情绪。</instruction>
  <refs>
    <ref id="r1" source="[[manuscript/001/chapter.md#L12-L18]]" path="manuscript/001/chapter.md" lines="12-18" match="unique"><![CDATA[
L12 | ...
L13 | ...
L14 | ...
]]></ref>
  </refs>
</inline_edit>
```

无选区时：

```xml
<inline_edit v="1" task="rewrite" op="replace" target="manuscript/001/chapter.md" scope="auto">
  <instruction>整体压低叙述腔，保留剧情信息，只改明显啰嗦的句子。</instruction>
</inline_edit>
```

`op` 由 task 派生，不暴露给用户选择：

- `rewrite` / `polish` / `expand` / `condense` -> `replace`
- `continue_after` -> `insert_after`
- `bridge` -> `bridge`

### Profile rules

`inline.editor` profile 的固定规则：

```text
你是 Inline AI 编辑器。根据 <inline_edit> 修改目标文件。

规则：
- 先 read target 文件确认上下文；引用路径不同于 target 时，也先 read 引用文件。
- 优先用 edit 做局部修改，只有确实需要整体重写时才用 write。
- scope="selection" 时，优先只修改 refs 指向的范围及必要衔接文本。
- scope="auto" 时，根据 instruction 判断最小必要修改范围。
- L12 | 这类行号只是定位标记，不是正文，不能写回文件。
- task=continue_after 时，在最后一个引用范围之后续写。
- task=bridge 时，补出承上启下的过渡；如果有两个引用，优先连接 r1 到 r2。
- 完成后用 report_result 简短说明改了哪里。
```

## Implemented / Follow-ups

- Done: 旧 `/api/writing/continue` 前端调用、服务端 route、DTO、OpenAPI route-map 和 generator SSE 特判已删除；Agent session 的 `mode: "continue"` 未删除。
- Done: `NovelPromptBar.vue` 已重构为默认收起的 Inline AI Prompt Bar，并只在当前文件是 Markdown / 纯文本可编辑文件时由首页渲染。
- Done: Prompt Bar 输入面复用 `ReferencePlainTextEditor`，默认一行起步并支持展开长输入；任务下拉支持对话、改写、润色、扩写、缩写、续写、承接；发送成功清空输入和 selection chips，失败保留。
- Done: selection chip 支持 `[[path#Lstart-Lend]]`、`[[path#Lline]]`、`[[path]]` 与短格式 `path#start-end`；Agent Markdown 渲染显示为“选区” chip。
- Done: TipTap selection menu 的 AI 入口改成“加入 AI 引用”，点击只追加引用并展开 Prompt Bar，不立即发送。
- Done: 事件链已贯通 `MarkdownSelectionMenu -> TipTapMarkdownEditor -> MarkdownStudio -> MarkdownStudioWorkbench -> app/pages/index.vue -> AgentChatSurface`。
- Done: `inline.editor` 系统 profile 已新增并编译，工具包含 `read`、`edit`、`write`、`report_result`，payload 被渲染成 XML，选区正文只出现在 hidden payload / profile prompt 中。
- Done: `AgentChatSurface` 已支持自动创建 / 复用 Project 级 `inline.editor` session，并暴露 edit/write 工具轻量预览给 Prompt Bar。
- Done: 短格式 selection chip 已收窄，`issue#123` / `https://example.com/a#45` 不会再被误识别；`src/server.ts#45-67` 仍会 canonical 序列化为 `[[src/server.ts#L45-L67]]`。
- Done: TipTap selection chip 行号定位优先使用编辑器选区位置，包含标题 / Markdown 标记的选区也能尽力生成行号；失败时仍回退到旧的唯一文本匹配。
- Done: Prompt Bar 顶部 edit/write 预览已限制为当前 `inline.editor` session 的运行中工具调用，不展示主创 session 或历史已完成工具调用。
- Done: Inline AI 发送后后台运行，不自动打开右侧 Agent 面板、不切换主 Agent active session；PromptBar 内可选择当前 Project 的 `inline.editor` sessions、独立新建 session、原地调整 inline session 模型，并流式展示当前 session 的思考、正文、edit/write 预览和最终 `report_result.result`。
- Done: PromptBar 发送条件已收紧为空输入无引用不可发送；页面发送入口也保留同样 guard，仍允许“有输入但无选区”处理当前文件。
- Done: PromptBar 的后台 live view / edit-write 预览只显示当前 inline turn；新一轮发送追加用户消息后不会继续展示上一轮 assistant 流内容。
- Done: Inline AI session 模型控件在运行、加载、保存和无 session 时统一禁用；被防御式拦截或保存失败时会恢复当前 snapshot 草稿。
- Done: 系统 profile compiled artifacts 已整体刷新，`inline.editor` 与其它系统 profiles 在 runtime status 中均为 loaded。
- Done: `reference/agent/profile-routing.md` 和 `PROJECT-STATUS.md` 已同步。
- Follow-up: v1 只支持 TipTap 富文本 selection menu 选区捕获；Monaco / 源码模式选区捕获后续单独补。

## Verification

- Passed: `bun vitest run app/utils/plain-reference-text.test.ts app/utils/markdown/render.test.ts`
- Passed: `bun scripts/build/profile.ts check --all --system`
- Passed: `bun scripts/build/profile.ts compile --all --system`
- Passed: `bun scripts/build/profile.ts status --all --system`
- Passed with existing route-map warnings: `bun run generate:openapi`。命令成功退出，但仍报告 24 个 Plot route-map 条目文件不存在；该问题不是本任务新增。
- Passed: `bunx vue-tsc --noEmit --pretty false`
- Passed: 浏览器交互审查已运行。打开 `http://localhost:3000/?project=workspace%2Fming-ding-zhi-shi-2`，进入 `manuscript/001-volume/001-chapter/index.md` 后，selection menu 的“加入 AI 引用”可展开 Prompt Bar，任务下拉可见改写 / 润色 / 扩写 / 缩写 / 续写 / 承接；未点击发送以避免真实改写文件。控制台无新增 error，仅有 Nuxt timer warning。
- Passed after review fixes: `bunx vitest run app/utils/plain-reference-text.test.ts app/utils/markdown/render.test.ts`
- Blocked after review fixes: `bunx vue-tsc --noEmit --pretty false` 和浏览器复验当前被本地依赖状态阻塞。`node_modules` 缺少 package.json 已声明的 `@nuxtjs/i18n`，页面进入 Nuxt 错误页；`bun install --frozen-lockfile` 拒绝执行，因为当前 `bun.lock` 没有该依赖且 frozen 模式会要求改锁文件。该问题不是 Inline Editor Agent 改动引入。
- Blocked current PromptBar optimization: `bunx vue-tsc --noEmit --pretty false` 当前失败在既有 `app/components/novel-ide/plot/NovelPlotPanel.vue` 的 `chapterPath/chapterId` 类型不一致；本轮修改相关文件未出现在报错列表中。
- Passed current system profile refresh: `bun scripts/build/profile.ts compile --all --system` 重新生成 14 个系统 profile artifact；`bun scripts/build/profile.ts status --all --system` 确认全部系统 profiles 为 `loaded`。
- Passed current inline artifact spot-check: 新 `inline.editor` artifact 包含 `Literal("chat")`、`task=chat` contract 和 `case "chat"` 默认指令分支。
- Blocked current PromptBar system-fix typecheck: `bunx vue-tsc --noEmit --pretty false` 仍失败在既有 `app/components/novel-ide/plot/NovelPlotPanel.vue` 的 `chapterPath/chapterId` 类型不一致；Inline AI 相关文件未出现在报错列表中。
