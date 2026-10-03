---
标签: [state:local]
---

# ProjectPickerEmptyState

零项目空态卡片组件：当工作区尚未创建任何小说作品时展现。

## 职责与特性

- 虚线边框质感面板，强化未就绪但随时可开始的创作氛围；
- 醒目的图书图标与友好文案提示；
- 醒目的“新建第一部作品”主行动点按钮。

## 契约

```ts
interface ProjectPickerEmptyStateEmits {
    (e: "create-book"): void;
}
```
