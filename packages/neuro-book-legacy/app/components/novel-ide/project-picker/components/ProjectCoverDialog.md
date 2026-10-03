---
标签: [state:local, env:portal]
---

# ProjectCoverDialog

作品封面配置与上传模态对话框：负责为指定作品上传、预览、清除或重新设置 2:3 比例封面图片。

## 职责与特性

- 支持 PNG、JPEG、WebP、AVIF 栅格图片格式与体积校验；
- 提供即时本地 Object URL 预览与原图大图放大预览触发；
- 支持清除已有封面并优雅回退；
- 支持异常与恢复状态处理。

## 契约

```ts
interface ProjectCoverDialogProps {
    modelValue: boolean;
    project: ProjectMetadataDto | null;
    busy?: boolean;
    recoveryNotice?: string;
    recoveryError?: string;
    coverUrl?: string;
    apiError?: string;
}

interface ProjectCoverDialogEmits {
    (e: "update:modelValue", value: boolean): void;
    (e: "upload", file: File): void;
    (e: "clear"): void;
    (e: "retry-recovery"): void;
    (e: "preview-original"): void;
}
```
