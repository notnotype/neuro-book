---
标签: [state:local]
---

# ProjectPickerView

未选择 Project 时的首页项目选择与迎宾屏受控视图：展示项目书架网格、就地新建项目表单、空态引导、加载态/失败重试，以及封面管理和会话迁移归属恢复。

视图自身为纯受控组件，不直接引用 Pinia store、不发起服务端 HTTP/API 请求、不直接读写持久化，所有操作均通过事件派发给宿主（`ProjectPickerScreen.vue`）或 Lab 治具（`ProjectPickerViewFixture.vue`）。

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

1. **材质轴与层级轴**：
   * 页面直接铺在窗体底纹上（`var(--bg-main)`）；
   * 书卡属于层级轴，卡片底板消费 `var(--bg-panel)`，悬浮提升走 GPU 变换（`-translate-y-1` 与柔和阴影），不引起任何盒模型尺寸抖动；
   * 书卡封面使用 `aspect-[2/3]` 标准书籍比例，当封面缺失或加载失败时，退化为排版封面（含书名展示、书脊与页边仿真装饰线）。
2. **状态规范（对齐 ui-development-spec.md §4.1）**：
   * 加载态占满整屏，居中渲染微转动的 Spinner 与说明文字，不画暗示未知骨架结构的虚假占位；
   * 错误态展示清晰的状态图标、原因描述与明显的重试入口，带 `role="alert"`；
   * 零项目空态使用虚线边框和引导卡片，提供快捷新建动作。
3. **极简操作交互**：
   * 顶栏动作使用 nb-ui `Button` 标准规范；
   * 卡片悬浮操作栏采用半透明磨砂小底板，搭配 nb-ui `IconButton`（方案 2）；
   * 封面管理使用 nb-ui `Dialog`，包含即时选择预览与原图大图查看。
