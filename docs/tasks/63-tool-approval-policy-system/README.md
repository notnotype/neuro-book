# Task 63: 工具用户输入请求系统（User Input Request）

## 任务概述

**创建时间**：2026-06-21  
**状态**：🟢 已实施，`request_user_input` 已从 Low-Code Form 拆出，底部多 pending 面板已收口
**优先级**：P1（功能增强）  
**前置依赖**：Task 62.1.2（多 pendingApprovals 支持）

### 背景

**核心认知转变**：工具"审批"本质上不是"批准/拒绝"，而是**工具在执行过程中主动请求用户输入**。

当前问题：
- 工具审批机制（`approvalRequired: true`）是静态的，无法根据参数动态决定
- `request_user_input` 是特殊实现，无法复用到其他工具
- 无法支持复杂的用户输入场景（如 LLM 生成表单）

本 task 目标：设计并实现统一的"用户输入请求"系统，让任何工具都能在执行时主动向用户请求输入（文本、选择、确认、复杂表单等）。

### 心智模型

```typescript
// 工具开发者视角
async execute(toolCallId, args) {
  // 工具执行中需要用户输入
  const userInput = await requestUserInput(formSpec);
  
  // 继续执行
  return processWithUserInput(userInput);
}
```

虽然实际实现是 Harness 暂停 → 等待用户 → 恢复执行，但从工具开发者视角看，就像是同步调用 `await requestUserInput()`。

---

## 需求分析

### 三种核心场景

**1. Yes/No 权限审批**
- **展示**：单选（批准/拒绝）
- **返回**：`{ approved: boolean }`
- **示例**：skill 执行权限确认
- **本质**：单个 `radio` 字段

**2. 问答列表（Request User Input）**
- **展示**：底部待处理面板分页展示，每题支持开放文本或单选 options，并在面板内填写 answer / note
- **返回**：`answers[]`，每项包含 `questionIndex`、可选 `selectedOptionIndex`、`note`、`ignored`
- **示例**：Agent 需要用户回答多个问题
- **本质**：专用问答协议，不走 Low-Code Form

**3. 结构化表单（LLM 生成）**
- **展示**：复杂表单（文本、数字、下拉、开关等）
- **返回**：结构化对象（根据表单定义）
- **示例**：配置数据库连接、API 参数等
- **本质**：完整的 Low-Code Form

### 当前方案：问答协议与 Low-Code Form 分离

Low-Code Form 基础设施保留给结构化表单工具；`request_user_input` 不再复用 Low-Code Form：
- ✅ 已有完整的前端组件（`app/components/common/low-code-form/`）
- ✅ 支持 8 种基础组件：text、textarea、number、switch、select、combobox、radio、checkbox
- ✅ 支持嵌套路径、验证、默认值
- ⚠️ 第一版不支持：文件上传、动态字段刷新、条件显隐
- ✅ `request_user_input` 只支持问题、单选 options、开放 note；不支持默认值、多选或推荐字段

**不需要删除 Low-Code Form 基础设施**，但它不再是 `request_user_input` 的入口。

---

## 设计方案

### 核心类型定义

```typescript
// 工具定义
type NeuroAgentTool = {
  key: string;
  name: string;
  parameters: TSchema;
  
  // 用户输入请求（可选）
  userInputRequest?: {
    when: (context: UserInputRequestContext) => Promise<UserInputFormSpec | null> | UserInputFormSpec | null;
  };
  
  execute: (
    toolCallId: string,
    args: unknown,
    userInput?: unknown  // 如果有 userInputRequest
  ) => Promise<ToolResult>;
};

// 上下文
type UserInputRequestContext = {
  args: unknown;
  session: { sessionId: number; profileKey: string; workspaceRoot: string; workspaceKey: string; projectPath?: string };
};

// 表单规格
type UserInputFormSpec = {
  form: LowCodeFormDto;     // 复用 Task 58 的结构
  resultSchema?: TSchema;   // 可选，可以自动推导
  prompt?: string;          // 展示提示
  layout?: "dialog" | "inline" | "fullscreen";  // 前端优化提示
};
```

**关键设计点**：
- `when()` 返回 `null` = 直接执行，无需用户输入
- 完全复用 `LowCodeFormDto`，无需新建数据结构
- `execute()` 第三参数接收用户输入

---

## 2026-06-28 修复：durable pending / resume 链路

本轮修复 Task 63 落地后的 `request_user_input` 展示与恢复问题：

- `request_user_input` 已迁移为 `userInputRequest` 工具，不再依赖 `approvalRequired`；Harness 的 pending 查找必须使用统一的 user resolution tool keys，覆盖 `approvalRequired` 与 `userInputRequest` 两类会等待用户恢复的工具。
- `pendingApprovals` / `pendingUserInputs` DTO 字段名暂时保留兼容，但其语义已扩展为“等待用户 resolution 的 pending tool call”，不能只按 approval 理解。
- `resolution.kind === "user_input"` 同时支持旧 `answers` 与 Low-Code Form `data`；后端写入 toolResult 时把表单数据规范化到 `details.data.userInput`，供工具恢复执行读取。
- 前端 Low-Code Form pending 时，底部 Composer 的 Enter / 主按钮必须提交表单，不再走旧 questions 的 `continueQuestion()` 空分支。
- 修复验证重点：snapshot / live state reload 后仍能恢复 pending UI，`continue + resolution.data` 能闭合原 tool call 并复用 waiting invocation。

### 2026-06-28 系统性收口

代码审查发现 Task 63 初版仍有三类系统性风险：`formSpec` 只存在内存 Map、`userInputRequest` 暂停早于 profile 权限校验、`enter_plan_mode` / `exit_plan_mode` 迁到 Low-Code Form 后仍只用旧 `tool_approval` 更新 Plan Mode lifecycle。

本轮收口后的约束：

- pending metadata 必须 durable：等待用户 resolution 的 Low-Code Form metadata 写入 session custom entry `agent.pendingUserResolution.<toolCallId>`；snapshot、live state、list reload、新 harness 都从 transcript 恢复，不能只依赖实时 SSE 事件或进程内缓存。
- 权限校验必须前置：`approvalRequired` 与 `userInputRequest` 都属于 user resolution suspend point，进入 waiting 前必须通过工具存在性、profile allowed keys 和 exit plan preview 路径校验；未授权工具写错误 toolResult，不展示 pending UI。
- Plan Mode resolution 必须按 toolName + decision 处理：`enter_plan_mode` / `exit_plan_mode` 同时接受旧 `tool_approval.approved` 与 Low-Code Form `user_input.data.approved`，并统一更新 `ui.planMode.active` / `agent.planMode`。
- `exit_plan_mode` 的计划预览继续保留在 toolResult `details.data.planFilePath` / `details.data.planContent`，同时 Low-Code Form 用户提交保留在 `details.data.userInput`。

### 2026-06-30 request_user_input 协议收窄

本轮把 `request_user_input` 从 Low-Code Form 分支中拆出，避免专用问答工具继续承担复杂表单协议：

- LLM 参数只保留 `questions[].header/question/options[].label/description`；`recommended/defaultSelected/defaultOptionIndex/defaultOptionIndexes/multiSelect` 均被 schema 拒绝。
- `request_user_input.userInputRequest.when()` 只返回 `true`，pending snapshot / SSE / session projection 均不再给 request 工具附带或恢复 `formSpec`。
- 用户答案只保留单选 `selectedOptionIndex`、`note`、`ignored` 和可读 `text`；`selectedOptionIndexes` 与多选历史展示删除。
- 前端 `AgentUserInputPrompt` 继续使用分页问答卡：一题一页，note-only 可推进当前题，最后一题提交完整 `answers`。
- Low-Code Form 仍服务其它工具和未来独立表单工具，不再作为 `request_user_input` 的测试案例。
- 用户输入公开事件收敛为 `input.emit(raw event) -> projectRuntimeEvent() -> emitRuntimeEvent()` 单一路径，避免 SSE 重复 pending；`request_user_input` 继续不公开 `formSpec`。

## 2026-08-01 底部多 pending 面板与提交所有权收口

### 诊断

- `canInvoke=false` 原本被投影成整个 Composer 的 `readonly`，同一个 `readonly` 又禁用了 `canResolveUserInput=true` 本应开放的选项和提交按钮。等待输入时同时出现“历史待回答卡片 + 灰色 Composer”，但真正的回答入口不可用。
- Surface 只把第一个 pending 交给交互组件；多 pending 分支会把第一项的回答用于当前项，并为后续审批自动生成“批准”。这会在用户未确认时执行工具，不能保留。
- 提交前调用 `clearPendingUserInputSession()` 会乐观移除权威状态。请求若在 Project、Session 或 pending 批次切换后迟到，旧 `catch/finally` 还可能回填错误或清除新批次提交态。
- 普通 Composer 被隐藏后，旧 watcher 仍会调用图片事务 `reset()`；正文与模型草稿能够保留，但图片草稿会被意外清空。

### 实现

- `AgentComposer` 现在在 `pendingUserInputSessions.length > 0` 时用唯一的 `AgentUserInputPrompt` 替换普通 Composer。聊天历史、Workspace 变更卡和用量状态继续显示；普通正文、模型和图片事务留在原组件状态中，pending 消失后恢复，不做清空。
- `AgentUserInputPrompt` 收敛为多 pending 面板：按服务端顺序投影问答、工具审批、模式切换和 Low-Code Form；稳定身份为 `toolCallId + questionIndex` 或表单 `toolCallId`。同 Project/Session 的 recovery/SSE 重投影按身份保留草稿，移除项才删除；跨 Project generation 或 Session 不继承。
- 有选项的问题使用原生单选语义并始终提供“其他答案”；普通选择允许可选说明，其他答案和开放回答要求正文。审批必须明确批准或拒绝；退出计划模式的补充建议继续生成拒绝当前切换的 resolution。Low-Code Form 必须显式确认，确认后再次修改会撤销确认。
- `agent-pending-resolution.ts` 成为局部纯状态边界：负责项目投影、完成判定、表单确认失效、草稿 reconcile、有序批次 key 和完整 `AgentResolutionDto[]` 构造。删除后续 pending 自动批准和单项/表单两套提交分支，所有项目完成后统一通过 `resolutions[]` 一次提交。
- `useAgentSession` 直接公开只读完整 pending 列表；Surface 不再从 `recoveryShell` 旁路重建。历史 `request_user_input`、`switch_mode` 和 Workflow 气泡只按 `toolCallId` 查询完整列表并展示等待状态，不再持有回答草稿或提交能力。未使用的旧 context 与乐观 `clearPendingUserInputSession()` 入口已删除。
- pending 提交和终止捕获 `AgentSurfaceOperationController owner + main sessionId + ordered pending batch key`。连接事件流、HTTP、recovery、错误发布和 `finally` 都校验发布权；请求固定发往捕获的 Session。Project、Session 或批次变化后的迟到成功/错误静默丢弃，旧 `finally` 只能释放自己的提交键。
- pending 不在提交前清空。HTTP 失败后强制 recovery：服务端仍显示原批次时保留草稿并允许重试；无法确认时进入 `unknown`，只允许显式重新同步，不自动重放 resolution。终止只受 `canAbort` 控制，即使 `canResolveUserInput=false` 仍可执行。
- `AgentPendingUserInputSession.form` 收紧为 `LowCodeFormDto`；`formSpec.form` 与 SSE `args.form` 都从 `unknown` 经过同一 schema。没有新增客户端通用表单验证器，复杂 schema 继续由既有 Low-Code Form 与服务端合同处理。

### 复杂度取舍与计划差异

1. 没有改服务端 API、DTO、数据库、主题变量或全局状态机，也没有新增依赖。Task 129 已有 Surface operation owner 足以承担 Project generation，本轮只增加 pending 批次维度；另建全局审批状态机会重复现有 Session 真相源。
2. 没有改为审批弹窗。回答经常需要回看历史、工具参数和计划内容，底部非模态面板保留上下文，也消除了原截图中的双层大块区域。
3. 没有实现第二套 Low-Code Form 客户端校验器。当前缺陷是能力映射和所有权，不是 schema 能力不足；复制服务端验证会增加漂移和维护成本。
4. 历史气泡没有保留第二套交互入口，只显示等待状态与结果摘要。这样既避免两个草稿源，也让批量提交顺序只有一个 owner。

### Verification

- 聚焦与相邻回归：12 files / 115 tests 通过，覆盖 resolution builder、多问题、多审批、多表单、确认后修改、完整 pending recovery/live event/tool result 增删、Task 129 activation/stream owner、interaction policy、Composer draft、消息与 Low-Code Form 投影。
- 新增 deferred Promise 回归直接使用 `AgentSurfaceOperationController` 和 Surface 同一 pending owner 判定，覆盖 Project/Session/批次变化、同 scope 新 revision、迟到发布拒绝及旧 `finally` 不清新提交键。
- `bun run typecheck`：全仓通过。
- 按仓库规则未自动运行浏览器验收。截图场景的可点击选项、普通 Composer 替换、多 pending 逐项完成、终止能力、明暗主题及 1440/390 视口仍待用户明确授权后验证；390 只验 Composer/面板，不代表整页移动端适配。

## 2026-08-01 面板固定高度与富文本回答收口

### 用户反馈与诊断

- 多 pending 面板只有正文 `max-height`，外层没有稳定 block size。问题标题、选项数、回答框和 Low-Code Form 高度不同会直接改变整个 Composer 区域高度，切题时形成明显布局跳动。
- “其他答案”、开放回答和补充说明仍使用原生 `textarea`，绕过了普通 Composer 的 `AgentComposerInput -> ReferencePlainTextEditor` 链路，因此无法使用 `@` 引用菜单、Workspace/剧情/selection chip 和 skill token。
- 不能把被隐藏的普通 Composer 草稿临时改作 pending 回答：普通消息正文、模型和图片事务属于另一份草稿所有权。复用同一个编辑器能力、继续按 pending item 保存独立字符串草稿，才能避免切题和恢复时串数据。

### 实现

- `AgentUserInputPrompt` 外层固定为 `clamp(320px, 50dvh, 420px)`，内部按 header、status、content、footer 四行布局。问题/选项与 Low-Code Form 在 content 内滚动，footer 保持原位；切换项目时内容滚动回顶部。
- 问答内容进一步分成可滚动的问题区和停靠底部的回答区。问题再长也只滚动选项，回答编辑器不会被推出面板；编辑器自身在 72–112px 内随内容增长。
- 三类文本回答统一复用 `AgentComposerInput`，继续写入 `AgentPendingQuestionDraft.note`。编辑器按 `toolCallId + questionIndex` 挂载，选择“其他答案”或计划建议后自动聚焦，Enter 输入换行，批次推进仍只由面板按钮控制。
- pending 回答复用 Surface 的引用菜单和 skill catalog，过滤会改写 Session 的斜杠命令；`canResolveUserInput`、提交中和 unknown 结果继续投影为编辑器 readonly，真实 `contenteditable=false` 与 `aria-readonly` 由通用编辑器同步。
- `AgentComposerInput` 只增加可选的尺寸、Enter 行为和可访问性名称参数，默认值保持普通 Composer 行为。`ReferencePlainTextEditor` 同步可访问性名称；没有新增组件、依赖、主题变量或状态机。
- 图片文件入口明确关闭。本轮没有给 `AgentResolutionDto` 虚构附件字段；未来图片回答需要单独定义 resolution 附件归属、上传恢复和 Harness/模型输入合同，但无需再次替换编辑器。

### 复杂度取舍与计划差异

1. 实现与批准计划一致：没有复用普通 Composer 草稿，没有修改服务端 API、DTO、数据库或 pending owner，也没有建立第二套富文本编辑器。
2. 没有为 CSS 高度编写 jsdom 假测试。jsdom 不做真实布局，无法证明切题像素高度一致；正确验收缝仍是真实浏览器的 `getBoundingClientRect()`。
3. 没有自动运行浏览器验收，遵守仓库规则。图片能力保持显式未支持，避免只显示图片 chip、但模型实际收不到附件的假闭环。

### Verification

- 最小反馈环：`agent-pending-resolution.test.ts` + `plain-reference-text.test.ts`，2 files / 21 tests 通过。
- Task 63/129 相邻回归：12 files / 118 tests 通过；新增用例覆盖引用 Markdown、selection chip、skill token 和多行文本从编辑器序列化到完整 resolution 的保真。
- `bun run typecheck`：全仓通过，退出码 0。
- 浏览器待验收：连续切换短问题/长选项/开放回答/表单时的同高；`@` 选择 chip、切走返回和提交规范化；普通 Composer 草稿隔离；明暗主题与 1440/390 视口。

## 2026-08-03 Composer Enter 快捷键回归修复

### 用户反馈与诊断

- GitHub Issue [#44](https://github.com/notnotype/neuro-book/issues/44) 记录了普通 Composer 无法用 Enter 发送、Agent 运行期间无法用 Ctrl+Enter 发送 followup 的稳定回归。
- `AgentComposerInput` 新增可选 Boolean prop `submitOnEnter` 后，使用 `props.submitOnEnter ?? !props.expanded` 计算默认行为。Vue 会把未传入的 Boolean prop 解析为 `false`，因此普通 Composer 永远无法回退到原来的 `!expanded`，底层编辑器不会发出 `submit`。
- `AgentComposer.submitComposer()` 中的 send、steer 和 followup 分支没有丢失；问题发生在 `AgentComposerInput -> ReferencePlainTextEditor` 的键盘事件门禁。

### 实现

- `AgentComposerInput.submitOnEnter` 使用明确的 `true` 默认值，折叠输入框继续用 Enter 提交，展开输入框继续把普通 Enter 用作换行，不再依赖 Vue 对缺省 Boolean prop 的隐式投影。
- `ReferencePlainTextEditor` 新增默认关闭的 `submitOnModifierEnter`。普通提交与 Ctrl/Meta+Enter 提交分别受独立门禁控制；Shift+Enter 和引用菜单打开时的 Enter 行为不变。
- 普通 Composer 只在 Agent 正在运行且正文非空时开启 modifier 提交，使展开输入框也能用 Ctrl/Meta+Enter 发送 followup。pending 回答编辑器显式关闭两种提交，继续由面板按钮推进批次。
- 没有修改消息 API、Session 状态、图片事务、数据结构、配置、安装或安全边界，也没有新增测试文件。

### Verification

- Vue SFC 编译探针通过：`submitOnEnter` 编译为 `default: true`，`submitOnModifierEnter` 编译为 `default: false`。
- 新 worktree 首次 `bun run typecheck` 因缺少 `server/generated/prisma/client` 失败；执行既有 `bun run generate` 后重跑，`bun run typecheck` 全仓通过，退出码 0。失败没有修改后端业务文件。
- 按用户要求没有新增或运行额外测试。按仓库规则没有自动运行浏览器验收；折叠/展开、空闲/运行中以及 Enter/Shift+Enter/Ctrl+Enter/Meta+Enter 的真实交互仍待用户验收。

### 计划差异

- 代码范围、快捷键合同、文档边界和不新增测试均与批准计划一致。唯一额外步骤是在新 worktree 中生成 typecheck 所需的 Prisma client；生成物未纳入本次改动。
