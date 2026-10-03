# Task 63: Low-Code Form 前端集成实施报告

**实施时间**：2026-06-22  
**状态**：✅ 完成

## 集成目标

在前端 Agent 用户输入系统中集成 Low-Code Form，使工具可以通过 `userInputRequest.form` 动态渲染复杂表单。

## 设计原则

1. **向后兼容**：保留现有 `request_user_input` 的问答 UI
2. **自动检测**：根据 `args.form` 是否存在自动切换渲染模式
3. **统一提交**：Low-Code Form 数据通过 `resolution: { kind: "user_input", data: LowCodeJsonObject }` 提交

## 实施方案

### 1. 类型扩展

#### `agent-message.ts`

```typescript
export type AgentPendingUserInputSession = {
    assistantMessageId: string;
    status: "pending";
    questions: AgentPendingUserInputQuestion[];
    /** Task 63: Low-Code Form 表单规格（存在时优先使用 LowCodeForm 渲染）。 */
    form?: LowCodeFormDto;
    /** Task 63: 当存在 form 时，关联的 toolCallId 用于提交 resolution。 */
    formToolCallId?: string;
};
```

#### `toPendingUserInputSession()` 检测逻辑

```typescript
// 检测 Low-Code Form
const form = (args as any).form;
if (form && typeof form === "object" && Array.isArray((form as any).fields)) {
    return {
        assistantMessageId: ...,
        status: "pending",
        questions: [],
        form: form as LowCodeFormDto,
        formToolCallId: pending.toolCallId,
    };
}
```

**检测条件**：
- `args.form` 存在
- `form` 是对象
- `form.fields` 是数组

如果不满足，回退到原有的 `request_user_input` 或 `tool_approval` 模式。

### 2. UI 组件修改

#### `AgentUserInputPrompt.vue`

**状态管理**：
```vue
<script setup>
const lowCodeFormData = ref<LowCodeJsonObject>({});
const isLowCodeFormMode = computed(() => Boolean(props.session.form));
</script>
```

**条件渲染**：
```vue
<template>
    <!-- Low-Code Form 模式 -->
    <div v-if="isLowCodeFormMode && props.session.form">
        <LowCodeForm
            :form="props.session.form"
            v-model="lowCodeFormData"
            :disabled="props.submitting || props.readonly"
        />
        <button @click="submitLowCodeForm">提交</button>
        <button @click="ignoreLowCodeForm">忽略</button>
    </div>

    <!-- 原有问答模式 -->
    <div v-else-if="activeQuestion">
        <!-- 现有 UI -->
    </div>
</template>
```

**新增事件**：
```typescript
emit("submit-form", {
    assistantMessageId: props.session.assistantMessageId,
    toolCallId: props.session.formToolCallId,
    data: lowCodeFormData.value,
});
```

### 3. 事件透传链路

```
AgentUserInputPrompt @submit-form
  ↓
AgentComposer @submit-user-input-form
  ↓
AgentChatSurface submitUserInputForm()
  ↓
agentApi.invokeSession({ resolution: { kind: "user_input", data, toolCallId } })
```

#### `AgentChatSurface.vue` 提交函数

```typescript
const submitUserInputForm = async (payload: {
    assistantMessageId: string;
    toolCallId: string;
    data: LowCodeJsonObject;
}): Promise<void> => {
    await agentApi.invokeSession(activeSessionId.value, {
        mode: "continue",
        clientState: buildClientState(),
        resolution: {
            kind: "user_input",
            toolCallId: payload.toolCallId,
            data: payload.data,
        },
    });
};
```

### 4. DTO 扩展

#### `agent-session.dto.ts`

```typescript
z.object({
    kind: z.literal("user_input"),
    toolCallId: z.string().trim().min(1),
    /** Task 63: Low-Code Form 提交数据（存在时优先于 answers）。 */
    data: JsonValueSchema.optional(),
    answers: z.array(...).optional(),
}).refine((value) => value.data !== undefined || value.answers !== undefined, {
    message: "user_input resolution 必须提供 data 或 answers",
});
```

**校验规则**：
- `data` 和 `answers` 至少提供一个
- `data` 存在时为 Low-Code Form 模式
- `answers` 存在时为传统问答模式

### 5. 国际化

#### `zh-CN.ts` / `en-US.ts`

```typescript
userInput: {
    // ... 现有键
    formRequest: "表单请求" / "Form Request",
    fillForm: "填写完成后提交" / "Fill out and submit",
}
```

## 测试覆盖

### 单元测试

文件：`app/components/novel-ide/agent/agent-message-low-code-form.test.ts`

**测试场景**：
1. ✅ `args.form` 存在时，生成 Low-Code Form session
2. ✅ `args.form` 不存在时，保持原有 questions 模式
3. ✅ `args.form` 结构无效时，回退到 tool_approval 模式

**测试结果**：3 pass, 0 fail

### 向后兼容测试

运行现有测试：`agent-message.test.ts`
- ✅ 18 pass, 0 fail
- 未破坏现有 `request_user_input` 和 `tool_approval` 逻辑

## 使用示例

### 后端工具定义（示例）

```typescript
{
    key: "configure_database",
    name: "configure_database",
    userInputRequest: {
        when: async (context) => ({
            form: {
                defaults: {},
                fields: [
                    {
                        path: "host",
                        component: "text",
                        label: "数据库主机",
                        placeholder: "localhost",
                        required: true,
                        options: [],
                    },
                    {
                        path: "port",
                        component: "number",
                        label: "端口",
                        defaultValue: 5432,
                        min: 1,
                        max: 65535,
                        options: [],
                    },
                    {
                        path: "ssl",
                        component: "switch",
                        label: "启用 SSL",
                        defaultValue: false,
                        options: [],
                    },
                ],
            },
        }),
    },
    execute: async (toolCallId, args, userInput) => {
        // userInput = { host: "localhost", port: 5432, ssl: false }
        return connectDatabase(userInput);
    },
}
```

### 前端渲染流程

1. 后端返回 `AgentPendingUserInputDto`，`args.form` 包含表单规格
2. `toPendingUserInputSession()` 检测到 `form`，生成 Low-Code Form session
3. `AgentUserInputPrompt` 检测到 `isLowCodeFormMode === true`
4. 渲染 `<LowCodeForm>` 组件
5. 用户填写表单，点击"提交"
6. 调用 `submitLowCodeForm()`，emit `submit-form` 事件
7. `AgentChatSurface.submitUserInputForm()` 构造 `resolution: { kind: "user_input", data }`
8. 提交到后端，工具的 `execute(toolCallId, args, userInput)` 接收 `data`

## 关键决策

### 1. 为何不新建独立组件？

**决策**：在 `AgentUserInputPrompt.vue` 中条件渲染 `LowCodeForm`

**理由**：
- Low-Code Form 本质上是"用户输入请求"的一种形式
- 共享相同的 pending 状态管理和提交逻辑
- 避免在 `AgentChatSurface` 中重复 session 判断逻辑

### 2. 为何 `data` 和 `answers` 互斥？

**决策**：`resolution.data` 存在时优先，`answers` 作为向后兼容

**理由**：
- Low-Code Form 返回结构化对象，不需要 `answers` 数组
- 保留 `answers` 字段用于传统问答模式
- DTO 校验确保至少提供一个

### 3. 检测条件为何包含 `Array.isArray(form.fields)`？

**决策**：检查 `form.fields` 是数组

**理由**：
- 防止后端传递畸形 `form` 对象
- 如果 `fields` 无效，`LowCodeForm` 无法渲染
- 回退到 `tool_approval` 模式，让用户看到原始参数

## 后续工作

### 前端完成
- ✅ 类型定义
- ✅ Session 转换逻辑
- ✅ UI 条件渲染
- ✅ 提交逻辑
- ✅ 事件透传
- ✅ DTO 扩展
- ✅ 国际化
- ✅ 单元测试

### 后端待办（Task 63 其他部分）
- ✅ 在 `neuro-agent-harness.ts` 中解析 `resolution.data`
- ✅ 传递 `userInput` 给工具的 `execute()` 函数
- ✅ 实现 `userInputRequest.when()` 调用链路
- ⏳ 更新 Agent Profile 配置系统使用 Low-Code Form

## 影响范围

### 修改文件
1. `shared/dto/agent-session.dto.ts` - 扩展 resolution schema
2. `app/components/novel-ide/agent/agent-message.ts` - 扩展 session 类型和转换逻辑
3. `app/components/novel-ide/agent/AgentUserInputPrompt.vue` - 条件渲染 Low-Code Form
4. `app/components/novel-ide/agent/AgentComposer.vue` - 透传 submit-form 事件
5. `app/components/novel-ide/agent/AgentChatSurface.vue` - 新增 submitUserInputForm 函数
6. `app/i18n/locales/zh-CN.ts` - 新增翻译键
7. `app/i18n/locales/en-US.ts` - 新增翻译键

### 新增文件
1. `app/components/novel-ide/agent/agent-message-low-code-form.test.ts` - 集成测试

### 风险评估
- ✅ 向后兼容：现有测试全部通过
- ✅ 类型安全：DTO 校验防止无效提交
- ✅ 用户体验：检测失败时回退到 tool_approval
- ✅ 测试覆盖：新增场景全部测试

## 总结

Task 63 前端集成已完成，Low-Code Form 成功集成到 Agent 用户输入系统。实现保持了向后兼容，新增功能通过自动检测透明启用。2026-06-28 追加修复后，`userInputRequest` 工具已经进入 durable pending/resume 链路，snapshot 恢复和 `resolution.data` 提交均由后端支持。
