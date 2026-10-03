---
标签: [state:local]
---

# ProjectPickerHeader

项目选择器顶部标题与动作操作栏：呈现“作品书架”主标题、创作引导语以及快速动作入口。

## 职责与特性

- 桌面端与移动端响应式布局：桌面端水平两侧对齐，移动端（<=640px）顶部标题与底部双列紧凑网格（`grid-cols-2`）；
- 提供“打开素材库”与“新建作品”标准化操作入口；
- 支持根据上层全局加载态或创建态联动禁用。

## 契约

```ts
interface ProjectPickerHeaderProps {
    isLoading?: boolean;
    hasLoadError?: boolean;
    isCreating?: boolean;
}

interface ProjectPickerHeaderEmits {
    (e: "open-user-assets"): void;
    (e: "create-book"): void;
}
```
