---
标签: [state:inject]
验证入口: PromptTextView
---

# PromptSticker

已发送文字里的一个表情（[`agent/stickers.md`](../../../../docs/specs/agent/stickers.md) 输出 44、45），`PromptTextView` 的内部零件，不从包入口导出。元素与 Markdown 展示器、编辑器里的表情相同（`language/syntax/sticker/view.ts` 的 `buildSticker`，样式在 `../stickers.css`）：先显示写法的原文，宿主端口查到后换成图；查不到、图读不出来时留原文。卸载时取消查询、释放表情。

## 数据

```ts
type PromptStickerProps = {
    /** 写法的原文。 */
    raw: string;
    /** 紧挨文字的一侧留间隙的类名（`stickerGapClasses` 的规则），空串是不留。 */
    gap?: string;
};
```

`state:inject`：宿主的表情端口（`useMarkdownHost().stickers`）与诊断出口（`report`）。
