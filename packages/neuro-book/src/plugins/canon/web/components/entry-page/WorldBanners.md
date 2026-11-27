---
标签: [state:inject]
别名: ["世界横幅", "World Banners"]
---

# WorldBanners

三种页面（条目页、回执页、变更详情页）顶上的世界横幅（[`canon/author-ui.md`](../../../../../../../../docs/specs/canon/author-ui.md) 输出 27、28）。受控：断开与只读的原因由宿主按读取层算好（`writable.ts` 的 `readOnlyBanner`）。

## 布局与交互

- 断开：警告色横幅“世界已断开”，右边“重试”，点了发 `retry`。
- 只读：警告色横幅，写宿主给的原因（“世界只读：……”“不确定世界里写进去了什么，先不能写”）。
- 两条都是贴边的整宽横条（nb-ui `Banner`，同编辑器的横幅），`role="status"`，可以同时出现（断开在上）；都没有时什么也不画。

## 数据

```ts
type WorldBannersProps = {
    disconnected?: boolean;
    /** 世界只读的原因；默认空（可以写）。 */
    readOnly?: string;
};
type WorldBannersEmits = {(event: "retry"): void};
```

## 隐藏通道理由

`state:inject`：经 `useCanonText()` 取宿主注入的翻译端口（命名空间 `nbook.canon`）。
