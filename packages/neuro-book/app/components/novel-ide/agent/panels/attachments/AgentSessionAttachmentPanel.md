---
标签: [state:local, env:global, env:portal]
---

# AgentSessionAttachmentPanel

当前会话的全分支附件目录浮层面板。以网格形式展示已上传的图片与文件附件，支持缩略图预览、原图弹窗查看、文件下载与图片插入 Composer。搜索与翻页通过 emits 委托父级执行。

## 隐藏通道理由

- `env:global`：监听全局 `Escape` 键盘事件与面板外点击（`onClickOutside`）以关闭附件浮层。
- `env:portal`：挂载 `OriginalImagePreviewDialog` 预览原图时，底层 `Dialog` 默认 teleport 到 `.novel-ide-theme`（可通过 `teleportTarget: false` 内联渲染）。

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
    /** 搜索关键字（v-model:search）。 */
    search: string;
    /** 禁止插入（如当前无法编辑 Composer）。 */
    insertDisabled: boolean;
    /** 自定义附件 URL 解析函数；缺省走服务端 `agentAttachmentUrl`。 */
    resolveAttachmentUrl?: AgentAttachmentUrlResolver;
    /** 原图预览 Dialog 的 teleport 目标选择器；传 false 时禁用 teleport。 */
    teleportTarget?: string | boolean;
};

type Emits = {
    (e: "update:search", value: string): void;
    (e: "load-more"): void;
    (e: "insert", item: AgentSessionAttachmentItemDto): void;
    (e: "close"): void;
};

type Slots = {};
```

- **扩展面**：无 slots，无 expose，`$attrs` 透传至主面板 `<section>` 根节点。
- **不支持**：不直接发起网络请求，搜索和翻页通过 emits 委托父级。

