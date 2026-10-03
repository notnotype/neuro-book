---
标签: [state:local, state:inject]
别名: ["提问留痕卡片", "用户输入留痕卡片", "Request User Input Card"]
---

# AgentRequestUserInputCard

Agent 在对话流中发起的用户提问与输入工具调用的只读审计卡片（Tool Call: `request_user_input`）。遵循**方案 A【精密 IDE 工单卡】(Precision Command Card / Inline Inspector)**与 `packages/nb-ui` 核心设计语言。

用户交互作答由底部的待处理面板（`AgentUserInputPrompt`）统一承载，本卡片作为不可变留痕记录沉淀在聊天流中：

1. **真实语义与接口契约归正**：
   - 严格对齐后端 `RequestUserInputSchema`（`control-tools.ts`），解耦独立系统审批（`approvalRequired` / `switch_mode`）；
   - 在 `tool-render-registry.ts` 中注册为 `mode: "message"`，直接作为会话流的一级顶层消息卡片渲染，彻底脱离 `AgentToolNode` 的多余折叠外框。
2. **精准支持双题型形状（Question Shapes）**：
   - **选择题型（Choice Question，`options` 存在且非空）**：
     - 展示提问题干、已选选项（浅微光底色 + 实心 Check）、选项说明；
     - 未被选中的候选项通过 `Collapsible` 平滑折叠展开收纳，节约纵向空间。
   - **开放问答题型（Open-ended Question，`options` 为空或省略）**：
     - 结构化展示开放提问题干，直接呈现作者答复的自然语言文本块，绝不渲染虚假选项或多余折叠按钮。
3. **规范复用 `nb-ui` 原生组件**：
   - **`Badge`**：承载顶栏状态微标（`tone="success"|"warning"|"danger"`，带 `dot` 状态圆点）、题目分组标头（`variant="outline"`）与选中项微徽标；
   - **`Separator`**：承载区段分隔发丝线，代替机械边框与盒子套盒；
   - **`Collapsible`**：驱动未选候选项平滑折叠展开，自带高度与透明度过渡。
4. **出版物引线式排版（Notes & 开放输入）**：
   - 补充说明（Notes）采用左侧 2px 细引线自然缩进排版（`border-l-2 border-[var(--accent-main)]/50`），通透内敛。
5. **纯只读不可变留痕**：
   - 卡片在聊天流中无表单交互、无按钮点击，所有决策均通过底部待处理面板完成。
