---
标签: [state:local]
---

# AgentComposerToolbar

Composer 底部操作工具栏。左侧提供模型与参数控制插槽（`#model-controls`）、图片文件选择按钮、输入框高度展开/收起切换按钮、以及 Agent 模式切换（普通/讨论/计划）；右侧提供统合的主执行按钮（支持发送、等待中停止、排队/追问以及继续等复合状态）。

## 数据

```typescript
type Props = {
    /** 输入框是否处于展开状态。 */
    composerExpanded: boolean;
    /** 输入框是否只读（或处于不可用状态）。 */
    composerReadonly: boolean;
    /** 当前会话是否正在运行中。 */
    running: boolean;
    /** 是否允许选择并登记图片。 */
    canRegisterImages: boolean;
    /** 当前 Agent 模式（normal | discuss | plan）。 */
    agentMode: AgentMode;
    /** 发送/执行按钮是否禁用。 */
    sendDisabled: boolean;
    /** 发送/执行按钮悬停提示文案。 */
    sendButtonTitle: string;
    /** 发送/执行按钮内嵌图标样式类。 */
    sendIconClass: string;
};

type Emits = {
    /** 展开/收起输入框。 */
    (e: "toggle-expand"): void;
    /** 循环切换 Agent 运行模式。 */
    (e: "cycle-mode"): void;
    /** 打开图片文件选择器。 */
    (e: "select-images"): void;
    /** 点击主发送/执行按钮。 */
    (e: "submit", event: MouseEvent): void;
};

type Slots = {
    /** 放置模型选择与参数面板控制器。 */
    "model-controls"?: () => any;
};
```

- **扩展面**：支持 `#model-controls` 作用域插槽注入模型选择器。
- **不支持**：不直接发起网络请求，动作统一通过 emits 冒泡至上层。
