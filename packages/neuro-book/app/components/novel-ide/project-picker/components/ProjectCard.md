---
标签: [state:local]
---

# ProjectCard

书籍卡片项组件：负责在首页书架网格中展示单本作品的拟真书封、标题、简介、最近更新时间，以及悬浮管理操作（更换封面、删除作品）。

## 职责与特性

- **拟真书封与优雅降级**：优先渲染作品自定义图片封面，加载失败或无封面时自动回退为精致排版书封（带书脊装饰光影与羽毛标志）；
- **平滑交互物理反馈**：卡片悬停轻微抬起（`-translate-y-1.5`），点击 active 态微沉（`scale-[0.985]`），键盘聚焦显示环形聚焦环；
- **浮动操作栏**：悬浮/聚焦时展示设置封面与删除按钮，移动端常驻展示；
- **删除故障恢复**：内聚渲染删除恢复与重试提示块。

## 契约

```ts
interface ProjectCardProps {
    project: ProjectMetadataDto;
    deleteBusy?: boolean;
    deleteRecovery?: ProjectPickerRecoveryEntry;
    coverRefreshVersion?: number;
    failedCover?: boolean;
    resolveCoverUrl?: (projectRoot: string) => string;
    formatDate?: (dateString?: string | null) => string;
}

interface ProjectCardEmits {
    (e: "open", projectRoot: string): void;
    (e: "delete", project: ProjectMetadataDto): void;
    (e: "retry-delete-recovery", projectRoot: string): void;
    (e: "open-cover-dialog", project: ProjectMetadataDto): void;
    (e: "cover-error", projectRoot: string): void;
}
```
