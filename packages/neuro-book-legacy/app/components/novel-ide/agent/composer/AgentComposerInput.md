---
标签: [state:local]
---

# AgentComposerInput

Agent Composer 纯文本与富媒体输入框零件。封装 `ReferencePlainTextEditor`，支持 `@` 实体触发、`/` 技能/命令触发、拖拽/粘贴/选择图片节点、Shift+Tab 快速切换 Agent 模式以及高度自适应与受控展开。

## 数据

```typescript
type Props = {
    /** 输入框绑定的文本值。 */
    modelValue: string;
    /** 输入框无内容时的占位文案。 */
    placeholder?: string;
    /** 无障碍标签。 */
    ariaLabel?: string;
    /** 菜单刷新标识符。 */
    menuRefreshKey?: string | number;
    /** 触发菜单（@ 和 /）的解析器。 */
    resolveMenu: (context: AgentTriggerMenuContext) => AgentTriggerMenuState;
    /** 技能触发开始回调。 */
    onSkillTriggerStart?: () => void;
    /** 是否去除默认边框（嵌入 Composer 复合外壳时为 true）。 */
    borderless?: boolean;
    /** 是否处于高度展开状态。 */
    expanded?: boolean;
    /** 是否只读。 */
    readonly?: boolean;
    /** 编辑器实例重置计数代次。 */
    generation?: number;
    /** 是否允许输入或拖入图片。 */
    enableImageFiles?: boolean;
    /** 最小高度（像素）。 */
    minHeight?: number;
    /** 最大高度（像素）。 */
    maxHeight?: number;
    /** 回车是否触发提交（展开时默认为 false）。 */
    submitOnEnter?: boolean;
    /** 为 true 时，Ctrl/Meta+Enter 在展开输入框中也提交。 */
    submitOnModifierEnter?: boolean;
};

type Emits = {
    (e: "update:modelValue", value: string): void;
    (e: "submit", payload?: {ctrlKey?: boolean; metaKey?: boolean}): void;
    (e: "cycle-mode"): void;
    (e: "image-files", payload: {files: File[]; position?: number}): void;
    (e: "pending-image-retry", uploadId: string): void;
    (e: "pending-image-remove", uploadId: string): void;
    (e: "image-document", nodes: ComposerImageNode[]): void;
    (e: "image-files-blocked"): void;
};

type Expose = {
    clearPendingImages: () => void;
    failPendingImage: (uploadId: string, error: string) => void;
    focus: () => void;
    insertImage: (image: PlainImageNodeAttrs, position?: number) => void;
    insertPendingImages: (items: Array<{uploadId: string; name: string}>, position?: number) => void;
    insertText: (text: string) => void;
    getText: () => string;
    hydrateImages: (items: readonly PlainImageNodeAttrs[]) => void;
    removePendingImage: (uploadId: string) => void;
    removeImageAt: (imageIndex: number) => void;
    replacePendingImage: (uploadId: string, image: PlainImageNodeAttrs) => void;
    startPendingImage: (uploadId: string) => void;
};

type Slots = {};
```

- **扩展面**：无 slots，expose 导出编辑器底层焦点控制与图片事务操作。
- **不支持**：不直接处理图片持久化上传，图片文件仅通过 emits 派发由事务管理层处理。
