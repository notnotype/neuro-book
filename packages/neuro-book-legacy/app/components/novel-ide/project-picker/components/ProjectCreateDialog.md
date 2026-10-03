---
标签: [state:local, env:portal]
---

# ProjectCreateDialog

新建作品模态窗口：基于 `nb-ui` 的 `DialogWindow` 封装，提供带阴影与标题栏的浮动弹窗容器，内嵌 `ProjectCreateForm` 并提供底部操作动作栏。

## 职责与特性

- 封装可调整大小、可拖拽的 `DialogWindow` 浮层；
- 管理弹窗开启/关闭生命周期与重置焦点；
- 底部标准化主/次操作按钮，自适应 `isCreating` 忙碌状态；
- 防抖提交与快捷键提交支持。

## 契约

```ts
interface ProjectCreateDialogProps {
    isOpen: boolean;
    isCreating?: boolean;
    recoveryNotice?: string;
    recoveryError?: string;
    teleportTarget?: string | boolean;
}

interface ProjectCreateDialogEmits {
    (e: "cancel"): void;
    (e: "submit", payload: {title: string; summary: string; genre?: string}): void;
    (e: "retry-recovery"): void;
}
```
