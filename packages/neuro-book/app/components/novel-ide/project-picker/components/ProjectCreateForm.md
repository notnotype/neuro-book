---
标签: [state:local]
---

# ProjectCreateForm

新建作品表单核心受控组件：提供书名输入、题材选择胶囊、作品简介输入与字符统计，以及内聚的创建中加载态。

## 职责与特性

- **双栏联动布局**：桌面端左侧呈现拟真书封预览 `ProjectCreateCoverPreview`，右侧为表单字段；移动端（<=640px）自适应垂直堆叠；
- **题材选择**：内建常用网文/小说题材快捷选择胶囊，切换即时反馈到拟真书封基色与徽标；
- **状态内聚（ui-development-spec §4.1）**：创建中状态（`isCreating`）完全在组件内部居中展现，固定占位高度（`min-h-[260px]`），杜绝外部布局跳动；
- **故障恢复**：支持展示恢复提示（`recoveryNotice`）与恢复失败重试（`recoveryError` / `retry-recovery`）。

## 契约

```ts
interface ProjectCreateFormProps {
    isCreating?: boolean;
    recoveryNotice?: string;
    recoveryError?: string;
    initialTitle?: string;
    initialSummary?: string;
    initialGenre?: string;
}

interface ProjectCreateFormEmits {
    (e: "submit", payload: {title: string; summary: string; genre?: string}): void;
    (e: "retry-recovery"): void;
}

interface ProjectCreateFormExpose {
    title: Ref<string>;
    summary: Ref<string>;
    genre: Ref<string>;
    focusTitle: () => void;
    reset: () => void;
}
```
