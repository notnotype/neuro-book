---
标签: []
---

# BackgroundLayer

背景的画法（[`ui/backgrounds.md`](../../../../../docs/specs/ui/backgrounds.md)）：一层图加一层面色遮罩，铺满所在的定位祖先，不接收指针。设置页的预览和真实显示都用它，所以看到的就是生效的样子。遮罩的不透明度由调用方算好（`use-background-image.ts`），这里不判断可读性。

## 数据

```ts
type Props = {
    /** 图的地址；没有图（纯色底）为 null。 */
    url: string | null;
    fit?: "cover" | "contain" | "repeat";
    blur?: boolean;
    /** 遮罩不透明度，0–1。 */
    alpha?: number;
    /** 遮罩颜色；缺省 `--bg-panel`。 */
    color?: string | null;
};
```

## 不支持

自己加载与失败处理：图要先加载好再交进来。
