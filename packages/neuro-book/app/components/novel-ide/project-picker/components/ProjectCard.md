---
标签: [state:local]
---

# ProjectCard

书籍卡片项组件：负责在首页书架网格中展示单本作品的拟真书封、标题、简介、最近更新时间，以及悬浮管理操作（更换封面、删除作品）。

## 职责与特性

- **拟真书封与优雅降级**：优先渲染作品自定义图片封面，加载失败或无封面时自动回退为精致排版书封（带书脊装饰光影与羽毛标志）；
- **题材与标签体系**：支持通过 `tags` 传入作品题材标签，消费 `@notnotype/nb-ui` 标准 `Badge`（soft 模式）呈现清晰分类；
- **平滑物理动效与防假死悬浮**：卡片悬停轻柔微抬（`-translate-y-[3px]`，缓动曲线 `cubic-bezier(0.2, 0.8, 0.2, 1)`），点击 active 态干脆微下沉（`scale(0.985)`，80ms 反馈）；通过 `@media(hover: hover)` 与 `:has(:focus-visible)` 防止移动端与鼠标点击后操作栏残留假死；
- **浮动操作栏**：悬浮/键盘聚焦时展示设置封面与删除按钮，移动端常驻展示；
- **删除故障恢复**：内聚渲染删除恢复与重试提示块。

## 契约

```ts
interface ProjectCardProps {
    project: ProjectMetadataDto;
    tags?: readonly string[];
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
