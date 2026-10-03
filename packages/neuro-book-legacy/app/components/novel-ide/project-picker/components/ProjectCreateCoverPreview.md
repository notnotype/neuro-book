---
标签: [state:local]
---

# ProjectCreateCoverPreview

拟真书籍封面即时预览组件：在新建作品流程中提供高沉浸感、实时联动的拟真书封展示。

## 职责与特性

- 拟真 2:3 纵横比纸质书封质感；
- 实时联动外层输入的书名，动态计算截断与字号；
- 支持多种题材情绪色彩（玄幻修真、科幻未来、都市职场、悬疑惊悚、世界设定、通用创作）；
- 书脊压痕与立体页边光影效果，带来专注而庄重的创作仪式感。

## 契约

```ts
interface ProjectCreateCoverPreviewProps {
    title: string;
    genre?: string;
}
```
