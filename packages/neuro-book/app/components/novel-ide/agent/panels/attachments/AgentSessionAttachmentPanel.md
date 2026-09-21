---
标签: [io:read]
---

# AgentSessionAttachmentPanel

当前会话的全分支附件目录浮层面板。以网格形式展示已上传的图片与文件附件，支持缩略图预览、原图弹窗查看、文件下载与图片插入 Composer。搜索与翻页通过 emits 委托父级执行。

## 数据

```typescript
type Props = {
    /** 当前会话 ID，用于构造附件 URL。 */
    sessionId: number;
    /** 当前页附件列表。 */
    items: AgentSessionAttachmentItemDto[];
    /** 附件总数。 */
    total: number;
    /** 是否有更多附件可加载。 */
    hasMore: boolean;
    /** 正在加载中。 */
    loading: boolean;
    /** 搜索关键字（v-model）。 */
    search: string;
    /** 禁止插入（如当前无法编辑 Composer）。 */
    insertDisabled: boolean;
};

type Emits = {
    (e: "update:search", value: string): void;
    (e: "load-more"): void;
    (e: "insert", item: AgentSessionAttachmentItemDto): void;
    (e: "close"): void;
};

type Slots = {};
```

- **阻断原因**：构造缩略图与原图 URL 依赖运行中的服务端（`agentAttachmentUrl`），挂载 `OriginalImagePreviewDialog`（`common/`）需要完整 Dialog 环境。
- **不支持**：不直接发起网络请求，搜索和翻页通过 emits 委托父级。
