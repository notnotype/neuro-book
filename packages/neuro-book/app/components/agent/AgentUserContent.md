---
标签: []
别名: ["用户消息正文", "User Content"]
---

# Agent 用户消息正文

一条用户消息的内容：按原顺序显示文字块与附件，正文只公开了预览时在末尾注明“仅显示预览”。用在分轮视图的用户气泡、steer 补充说明与原始视图里；外面的气泡、边框和投递状态由调用方负责。

## 布局

- 文字块保留换行，长词可断开；多个文字块之间留一点间距。
- 连续的附件排成一行，放不下时换行：
  - 图片（`mimeType` 以 `image/` 开头）显示为固定尺寸的缩略图，图片加载前后高度不变。地址为空时显示同尺寸的“不可用”占位，不发请求。
  - 其他附件显示为文件小标签：图标、文件名（过长截断，完整名称在悬停提示里）与大小。
- 正文只公开了预览（`contentOmitted`）时，末尾一行淡色“仅显示预览”。

## 数据

```ts
import type {UserMessageView} from "./agent-view.types";

type AgentUserContentProps = {
    /** 用户消息，必填；只读 blocks 与 contentOmitted。 */
    message: UserMessageView;
    /** 附件地址；返回 null 表示不可用。必填，对话视图传入 services.resolveAttachmentUrl。 */
    resolveAttachmentUrl: (locator: string, variant: "thumbnail" | "original") => string | null;
};
```

没有事件、插槽和 expose。未声明的 attribute、`class` 与 `style` 落到根节点。

## 不支持

- 点击缩略图查看原图：需要宿主提供打开附件的 action，等附件面板（S7）一起定。
