# Task 63: 工具用户输入请求系统（User Input Request）

## 任务概述

**创建时间**：2026-06-21  
**状态**：🟢 设计完成，准备实施  
**优先级**：P1（功能增强）  
**前置依赖**：Task 62.1.2（多 pendingApprovals 支持）

> 注意：这是 Task 63 的早期设计副本，已被上层 `docs/tasks/63-tool-approval-policy-system/README.md` 的当前实现记录取代。当前 `request_user_input` 不再复用 Low-Code Form，也不支持多选、默认值或推荐字段；Low-Code Form 只保留给其它/未来结构化表单工具。

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
- **展示**：多个问题，每个问题可以是文本输入、单选、多选
- **返回**：`{ answer_0: "val1", answer_1: "val2", ... }`
- **示例**：Agent 需要用户回答多个问题
- **本质**：多个 `text`/`select`/`checkbox` 字段

**3. 结构化表单（LLM 生成）**
- **展示**：复杂表单（文本、数字、下拉、开关等）
- **返回**：结构化对象（根据表单定义）
- **示例**：配置数据库连接、API 参数等
- **本质**：完整的 Low-Code Form

### 统一方案：复用 Low-Code Form

所有"获取用户输入"都通过 Low-Code Form 实现：
- ✅ 已有完整的前端组件（`app/components/common/low-code-form/`）
- ✅ 支持 8 种基础组件：text、textarea、number、switch、select、combobox、radio、checkbox
- ✅ 支持嵌套路径、验证、默认值
- ⚠️ 第一版不支持：文件上传、动态字段刷新、条件显隐

**不需要新建"审批专用"组件**，直接复用现有基础设施。

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
## 三种场景的详细实现

### 场景 1：Yes/No 权限审批

```typescript
{
  name: "skill",
  userInputRequest: {
    when: () => ({
      prompt: "Agent 想要执行 skill，是否允许？",
      layout: "dialog",
      form: {
        fields: [{
          path: "approved",
          component: "radio",
          label: "请选择",
          options: [
            { value: true, label: "批准" },
            { value: false, label: "拒绝" }
          ],
          defaultValue: true
        }]
      }
    })
  },
  
  async execute(toolCallId, args, userInput) {
    if (!userInput?.approved) {
      return { content: [{ type: "text", text: "用户拒绝了操作" }] };
    }
    return executeSkill(args);
  }
}
```

### 场景 2：问答列表

```typescript
{
  name: "request_user_input",
  userInputRequest: {
    when: ({ args }) => {
      const { questions } = args;
      return {
        prompt: "Agent 需要你的输入",
        layout: "inline",
        form: {
          fields: questions.map((q, i) => ({
            path: `answer_${i}`,
            component: q.options ? (q.multiSelect ? "checkbox" : "select") : "text",
            label: q.question,
            options: q.options?.map(opt => ({ value: opt, label: opt })),
            required: true
          }))
        }
      };
    }
  },
  
  async execute(toolCallId, args, userInput) {
    const answers = Object.keys(userInput || {})
      .filter(k => k.startsWith("answer_"))
      .sort()
      .map(k => userInput![k]);
    return { content: [{ type: "text", text: "已收到用户输入" }], details: { answers } };
  }
}
```

### 场景 3：LLM 生成表单

```typescript
{
  name: "request_structured_input",
  userInputRequest: {
    when: ({ args }) => {
      const { prompt, fields } = args;
      return { prompt, layout: "inline", form: { fields } };
    }
  },
  
  async execute(toolCallId, args, userInput) {
    return { content: [{ type: "text", text: "已收到结构化输入" }], details: userInput };
  }
}
```

**LLM 使用示例**：
```json
{
  "prompt": "请配置数据库连接",
  "fields": [
    { "path": "host", "component": "text", "label": "主机地址", "defaultValue": "localhost" },
    { "path": "port", "component": "number", "label": "端口", "defaultValue": 3306, "min": 1, "max": 65535 },
    { "path": "database", "component": "select", "label": "数据库类型", 
      "options": [{ "value": "mysql", "label": "MySQL" }, { "value": "postgresql", "label": "PostgreSQL" }] }
  ]
}
```

---

## 执行流程

### Harness 侧

```typescript
async function executeTool(tool, toolCallId, args) {
  // 1. 检查是否需要用户输入
  if (tool.userInputRequest) {
    const formSpec = await tool.userInputRequest.when(buildContext(args));
    if (formSpec) {
      await pauseAndRequestUserInput(toolCallId, tool.name, args, formSpec);
      return; // 等待 continue
    }
  }
  
  // 2. 直接执行
  return await tool.execute(toolCallId, args);
}

async function continueWithUserInput(resolution) {
  const { toolCallId, data } = resolution;
  const { tool, args } = getWaitingTool(toolCallId);
  return await tool.execute(toolCallId, args, data);
}
```

### SSE 事件

```typescript
{
  type: "tool.user-input-required",
  toolCallId: "call_abc",
  toolName: "skill",
  args: { skillName: "example" },
  userInputSpec: {
    prompt: "Agent 想要执行 skill，是否允许？",
    layout: "dialog",
    form: { fields: [...] }
  }
}
```

### Continue API

```typescript
{
  mode: "continue",
  resolution: {
    kind: "user_input",
    toolCallId: "call_abc",
    data: { approved: true }  // Low-Code Form 返回的数据
  }
}
```

### 前端处理

```vue
<template>
  <LowCodeForm
    :form="userInputSpec.form"
    :modelValue="formData"
    @update:modelValue="formData = $event"
  />
  <button @click="submit">提交</button>
</template>

<script setup>
function submit() {
  agentApi.continue({
    resolution: {
      kind: "user_input",
      toolCallId: spec.toolCallId,
      data: formData
    }
  });
}
</script>
```

---
## 实现计划

### 阶段 1：核心机制（3-4 天）

**后端实现**：
- [ ] 定义 `UserInputFormSpec`、`UserInputRequestContext` 类型
- [ ] 工具类型添加 `userInputRequest` 字段
- [ ] Harness 工具执行前调用 `userInputRequest.when()`
- [ ] 发送 `tool.user-input-required` SSE 事件
- [ ] Continue API 统一为 `kind: "user_input"` + `data: LowCodeJsonObject`（移除旧格式）
- [ ] 工具的 `execute()` 第三参数接收 `userInput`
- [ ] Snapshot 和 SSE 事件中命名改为 `pendingUserInputs`

**测试**：
- [ ] userInputRequest.when() 返回 null 时直接执行
- [ ] userInputRequest.when() 返回 form 时暂停
- [ ] continue 后 userInput 正确传给 execute()

**影响模块**：
- `server/agent/tools/types.ts`
- `server/agent/harness/neuro-agent-harness.ts`
- `shared/dto/agent-session.dto.ts`

**预计工作量**：3-4 天

---

### 阶段 2：前端适配（2-3 天）

**前端实现**：
- [ ] 处理 `tool.user-input-required` SSE 事件
- [ ] 渲染 `LowCodeForm`（复用现有组件）
- [ ] 根据 `layout` 提示选择渲染容器（dialog/inline/fullscreen）
- [ ] 收集表单数据，发送 `continue({ resolution: { kind: 'user_input', data } })`
- [ ] 移除旧的 `kind: 'tool_approval'` 处理逻辑

**布局优化**：
- [ ] 确认对话框样式（单个 radio 字段）
- [ ] 问答列表样式（多个 answer_* 字段）

**影响模块**：
- `app/components/novel-ide/agent/useAgentSession.ts`
- `app/components/novel-ide/agent/AgentRequestUserInputBubble.vue`
- `app/composables/useAgentSessionApi.ts`

**预计工作量**：2-3 天

---

### 阶段 3：迁移现有工具（1-2 天）

**迁移清单（4 个内置工具）**：
- [ ] `request_user_input`
- [ ] `skill`
- [ ] `enter_plan_mode`
- [ ] `exit_plan_mode`
- [ ] 移除 `approvalRequired` 字段

**回归测试**：
- [ ] 所有迁移工具的功能测试
- [ ] 确认用户体验无降级

**影响范围**：只有 4 个内置工具，无第三方 profile 依赖

**预计工作量**：1-2 天

---

### 阶段 4：新增 LLM 生成表单工具（1 天）

**新工具实现**：
- [ ] 新增 `request_structured_input` 工具
- [ ] LLM parameters 包含 `prompt` 和 `fields`
- [ ] userInputRequest.when() 直接返回表单定义
- [ ] execute() 返回完整表单数据

**文档和示例**：
- [ ] LLM 使用指南
- [ ] 各组件使用示例
- [ ] 典型场景示例（数据库配置、API 配置）

**预计工作量**：1 天

---

### 阶段 5：文档与测试（0.5 天）

**文档更新**：
- [ ] 用户输入请求设计文档
- [ ] 工具开发指南更新
- [ ] Low-Code Form 字段参考

**集成测试**：
- [ ] 端到端：Yes/No 审批流程
- [ ] 端到端：问答列表流程
- [ ] 端到端：LLM 生成表单流程
- [ ] 端到端：多个 pendingUserInputs 同时处理

**预计工作量**：0.5 天

---

## 里程碑

- [ ] **M1 - 核心机制完成**（预计 3-4 天）
  - Harness 支持 userInputRequest
  - SSE 事件和 API 统一为新格式

- [ ] **M2 - 前端适配完成**（预计 2-3 天）
  - 前端渲染 Low-Code Form
  - 布局优化完成

- [ ] **M3 - 迁移完成**（预计 1-2 天）
  - 4 个内置工具迁移
  - 回归测试通过

- [ ] **M4 - 新功能完成**（预计 1 天）
  - LLM 生成表单工具可用

**总预计工作量**：7.5-10.5 天

---

## 验证场景

### 功能验证
- [ ] Yes/No 审批：批准后工具正常执行
- [ ] Yes/No 审批：拒绝后工具跳过
- [ ] 问答列表：用户输入正确传给工具
- [ ] 动态决策：根据参数动态决定是否需要用户输入
- [ ] 多个用户输入请求：同时存在时前端正确渲染
- [ ] LLM 生成表单：复杂表单正确渲染和提交
- [ ] 无 userInputRequest 的工具：直接执行

### 硬切验证
- [ ] 旧的 `approvalRequired` 字段已移除
- [ ] 旧的 `kind: "tool_approval"` resolution 已移除
- [ ] 4 个内置工具迁移后功能正常

### 性能验证
- [ ] 大型表单（20+ 字段）渲染性能
- [ ] 多个用户输入请求（5+）前端渲染性能
- [ ] userInputRequest.when() 执行时间 < 100ms

---

## 依赖关系

**前置依赖**：
- **Task 62.1.2（多 pendingApprovals 支持）必须先完成**
- 否则无法同时处理多个工具的用户输入请求

**执行策略**：
- Task 62 的 1.1（Sidecar）和 1.2（多 pendingApprovals）可以并行开发
- Task 62.1.2 完成后，Task 63 可以立即开始
- 无需等待整个 Task 62 完成

**后续依赖**：
- Task 64（TSX DSL）是可选的，取决于观察期反馈

---

## 技术债与未来扩展

### 当前不支持的功能

**Low-Code Form 限制**（第一版不做）：
- ❌ 文件上传字段
- ❌ 动态字段刷新（字段 A 变化时，字段 B 的 options 更新）
- ❌ 条件显隐（根据某字段值显示/隐藏其他字段）
- ❌ 分组和折叠
- ❌ 日期/时间选择器
- ❌ 富文本编辑器

**原因**：保持简单，快速验证整体流程

### 未来扩展

#### Task 64: TSX DSL（可选）

**条件**：JSON 格式成为 LLM 生成瓶颈

**内容**：
- 实现 TSX → Low-Code JSON 编译器
- LLM 使用类似 HTML 的语义标签描述表单
- 向后兼容 JSON 格式

**预计工作量**：3-5 天

#### 高级表单能力（按需）

根据实际需求逐步扩展：
- 字段间依赖刷新
- 条件显隐
- 分组和折叠
- 文件上传
- 日期/时间选择器

---

## 关键设计决策

1. **硬切，不做向后兼容** ✅
   - 只需迁移 4 个内置工具
   - 无第三方 profile 依赖
   - 简化代码，避免维护两套机制

2. **复用 Low-Code Form** ✅
   - 无需新建组件
   - 自动获得验证、默认值等能力

3. **TSX DSL 延后** ✅
   - 第一版用 JSON 验证流程
   - 收集 LLM 使用反馈后决定

4. **工具的心智模型：同步 await** ✅
   - 对工具开发者透明
   - 实际实现：Harness 暂停 → 等待用户 → 恢复

---

## 变更记录

### 2026-06-22
- 完成详细设计文档
- 确认硬切策略：只需迁移 4 个内置工具，无第三方依赖
- 确认 Low-Code Form 限制：第一版不支持文件上传、动态字段、条件显隐
- 确认 TSX DSL 延后到观察期后
- 明确前置依赖：Task 62.1.2 必须先完成
- 补充三种场景详细实现示例
- 补充执行流程（Harness 侧、SSE 事件、Continue API、前端）
- 补充 5 个阶段的详细实现计划
- 补充验证场景和里程碑

### 2026-06-21
- 创建 task 目录和文档
- 从"工具审批策略"重新定位为"用户输入请求"
- 完成核心设计和类型定义

---

## 相关文档

- [Task 62: Harness 黑盒合同与 SSE 恢复修复](../62-harness-contract-sse-recovery-fixes/README.md)
- [Task 58: Agent Profile Settings Low-Code](../58-agent-profile-settings-low-code/README.md)
- [控制工具源码](../../../server/agent/tools/control-tools.ts)
- [工具类型定义](../../../server/agent/tools/types.ts)
- [Low-Code Form DTO](../../../shared/dto/low-code-form.dto.ts)
- [Low-Code Form 组件](../../../app/components/common/low-code-form/)
- [黑盒合同](../18-agent-runtime-pipeline-hooks/HARNESS-BLACK-BOX-CONTRACT.md)
