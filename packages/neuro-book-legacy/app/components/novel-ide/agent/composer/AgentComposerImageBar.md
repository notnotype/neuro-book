---
标签: [state:local]
---

# AgentComposerImageBar

Composer 图片附件栏与校验条，挂载在输入框上方。用于展示已加入正文的图片缩略图、移除按钮、模型无多模态能力警告提示以及图片元数据校验失败时的重试入口。

## 数据

```typescript
type Props = {
    /** 当前正文中引用的稳定图片列表。 */
    images: Array<{target: string; label: string}>;
    /** 当前选中模型是否声明支持图片输入。 */
    modelSupportsImages: boolean;
    /** 图片元数据校验错误信息，null 表示无错误。 */
    metadataError?: string | null;
    /** 是否只读。 */
    readonly?: boolean;
    /** 根据 target 解析图片可访问 URL 的解析函数。 */
    getImageUrl: (target: string) => string | null;
};

type Emits = {
    /** 移除指定索引处的图片。 */
    (e: "remove-image", index: number): void;
    /** 重新校验图片元数据。 */
    (e: "retry-metadata"): void;
};

type Slots = {};
```

- **扩展面**：无 slots，无 expose，attrs 透传至根元素。
- **不支持**：不在组件内部直接发起网络删除或修改 Markdown，仅发出 `remove-image` 事件由上层修改。
