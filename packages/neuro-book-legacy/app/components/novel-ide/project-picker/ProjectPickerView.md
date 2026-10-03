---
标签: [state:local]
---

# ProjectPickerView

未选择 Project 时的首页项目选择与迎宾屏受控视图：展示项目书架网格、新建项目对话框、空态引导、加载态/失败重试，以及封面管理和原图预览。

视图自身为纯受控组件，不直接引用 Pinia store、不发起服务端 HTTP/API 请求、不直接读写持久化，所有操作均通过事件派发给宿主（`ProjectPickerScreen.vue`）或 Lab 治具（`ProjectPickerViewFixture.vue`）。

## 组件结构与职责解耦

- `ProjectPickerView.vue`：受控主视图编排器，负责组织页面流与各子状态；
- `components/ProjectPickerHeader.vue`：页面标题、描述及移动端响应式双列操作按钮（打开素材库 / 新建作品）；
- `components/ProjectPickerEmptyState.vue`：零项目空态卡片；
- `components/ProjectCreateDialog.vue`：新建作品弹窗外壳（包装 `DialogWindow`，管理尺寸、窗口拖拽与底部动作按钮）；
- `components/ProjectCreateForm.vue`：纯表单组件（书名与简介字段、字符统计、恢复重试处理，以及内聚的创建中 `isCreating` 居中加载态）；
- `components/ProjectCard.vue`：书籍卡片（2:3 真实书封与优雅排版降级、悬停抬起、移动端紧凑操作栏）；
- `components/ProjectCoverDialog.vue`：封面上传、清除与状态恢复对话框；
- `OriginalImagePreviewDialog.vue`：原图大图预览弹窗。

## 契约

```ts
interface ProjectPickerViewProps {
    projects: readonly ProjectMetadataDto[];
    isLoading?: boolean;
    loadError?: string;
    isCreating?: boolean;
    isCreateFormOpen?: boolean;
    createRecoveryNotice?: string;
    createRecovery?: ProjectPickerRecoveryEntry;
    deleteBusyRoots?: ReadonlySet<string>;
    pickerRecoveries?: ProjectPickerRecoveryState;
    coverRecoveries?: ProjectCoverRecoveryState;
    coverRefreshVersions?: Record<string, number>;
    failedCoverRoots?: ReadonlySet<string>;
    recoveryExpanded?: boolean;
    recoveryLoading?: boolean;
    recoveryLoaded?: boolean;
    recoveryError?: string;
    recoverySessions?: readonly AgentSessionSummaryDto[];
    recoveryTotal?: number;
    recoveryHasMore?: boolean;
    recoveryActionId?: number | null;
    resolveCoverUrl?: (projectRoot: string) => string;
    resolveOriginalCoverUrl?: (projectRoot: string) => string;
}

interface ProjectPickerViewEmits {
    (e: "open", projectRoot: string): void;
    (e: "open-user-assets"): void;
    (e: "open-create-form"): void;
    (e: "cancel-create-form"): void;
    (e: "create", payload: {title: string; summary: string}): void;
    (e: "retry-create-recovery"): void;
    (e: "delete", project: ProjectMetadataDto): void;
    (e: "retry-delete-recovery", projectRoot: string): void;
    (e: "retry-load"): void;
    (e: "toggle-recovery"): void;
    (e: "load-more-recovery"): void;
    (e: "retry-recovery"): void;
    (e: "recover-session", payload: {session: AgentSessionSummaryDto; targetProjectRoot: string | null}): void;
    (e: "upload-cover", payload: {project: ProjectMetadataDto; file: File}): void;
    (e: "clear-cover", project: ProjectMetadataDto): void;
    (e: "retry-cover-recovery", projectRoot: string): void;
    (e: "cover-error", projectRoot: string): void;
}
```

## 设计与交互规则

1. **材质轴与层级轴（Surface 模型规范）**：
   * 视图容器与 `main` 版心流遵循**「不给面」原则**，不硬编码背景色，背景材质由宿主（应用主窗体底纹或 Lab 展台 Panel 磨砂盒）自然透出；
   * 书卡与状态卡片属于**层级轴（层级 +1）**，卡片底板消费 `var(--bg-panel)`，悬浮提升走 GPU 变换（`-translate-y-1.5` 与柔和阴影），确保盒模型尺寸零抖动；
   * 书卡封面使用 `aspect-[2/3]` 标准书籍比例，当封面图片缺失或加载失败时，自动回退为排版封面（含书名展示、书脊与页边仿真装饰线）。
2. **表单内聚与状态下限（对齐 ui-development-spec.md §4.1）**：
   * 新建表单与弹窗解耦，表单组件自闭环处理「创建中」（`isCreating`）状态，加载态居中且锁定高度，带 `role="status"` 与 `aria-busy="true"`，防止布局位移；
   * 全屏加载态与错误态占满所在视口，带独立可播报可访问语义。
3. **移动端（390px 视口）适配准则**：
   * 页面主操作按钮在窄屏下采用自适应双列网格（`grid-cols-2`），大幅降低垂直高度占用；
   * 书架网格间距微调为 `gap-x-3.5 gap-y-6`，卡片右上角操作栏收紧边距（`p-0.5`）；
   * 封面降级文字在窄屏下自适应微调字号，杜绝长书名溢出或换行拥挤。
