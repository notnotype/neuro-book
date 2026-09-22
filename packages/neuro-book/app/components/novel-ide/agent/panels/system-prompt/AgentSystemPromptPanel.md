---
标签: [state:local]
---

# AgentSystemPromptPanel

当前会话 System Prompt 的独立展示面板，位于对话流上方边界栏内。展开时通过 emit `load` 请求父级加载 prompt 文本，显示 Markdown 渲染结果；支持刷新、重试、关闭操作。

## 数据

```typescript
type Props = {
    /** 面板展开/收起状态（v-model）。 */
    modelValue: boolean;
    /** 当前 session 已加载的 System Prompt；null 表示未加载，空字符串表示 prompt 本身为空。 */
    value: string | null;
    /** 正在加载中。 */
    loading: boolean;
    /** 加载失败时的错误消息。 */
    error?: string;
    /** 点击 System Prompt 中的 workspace 引用时的回调。 */
    openReference?: (target: string) => void;
};

type Emits = {
    (e: "update:modelValue", value: boolean): void;
    (e: "load"): void;
    (e: "refresh"): void;
};

type Slots = {};
```

- **扩展面**：无 slots，无 expose。
- **不支持**：不直接发起网络请求，所有加载与刷新通过 emits 委托父级。
