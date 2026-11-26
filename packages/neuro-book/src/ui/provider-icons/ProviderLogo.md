---
标签: [state:inject]
别名: ["服务商 logo", "Provider Logo"]
---

# ProviderLogo

按 id 画服务商的 logo：取应用的服务商图标表（`ui/provider-icons`，`@lobehub/icons-static-svg`），单色的用文字色着色，多色的原样显示；表里没有、或地址表还没到时画首字母块（中性底、次要色）。模型页的 [`ProviderIcon`](../../plugins/models/web/components/ProviderIcon.md) 在它上面加了用户上传的图标；网页工具的“搜索与网页”页直接用它。

## 布局与交互

- 没有交互；整个零件是装饰，`aria-hidden`，名字由旁边的文字给。
- 外框是 `size` 见方，三种画法同样大小，换图不挪动旁边的文字。

## 数据

```ts
defineProps<{
    id: string | null;   // 图标表的键；null 直接画首字母
    name: string;        // 首字母块用
    size?: number;       // 像素，缺省 18
}>();
```

没有 emits、slots 与 expose；attrs 落在根元素上。

## 隐藏通道理由

- `state:inject`：图标表是模块级的响应式状态，晚到时重画。
