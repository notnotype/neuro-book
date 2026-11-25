---
标签: [state:local]
别名: ["服务商图标", "Provider Icon"]
---

# ProviderIcon

设置页里画服务商图标的小零件（[`models/settings-pages.md`](../../../../../../../docs/specs/models/settings-pages.md) 标题区、左栏、添加对话框）：取服务商里存的图标，没存（跟随模板）时取模板的图标，解析不出画首字母块。

## 布局与交互

- 没有交互；整个零件是装饰，`aria-hidden`，名字由旁边的文字给。
- 上传的图标按读取路由 `/api/nbook.models/icons/<文件名>` 画成多色图，加载失败换首字母块。
- 内置图标、模板图标与首字母块交给共用的 [`ProviderLogo`](../../../../ui/provider-icons/ProviderLogo.md)（取应用的图标表，单色的用文字色着色，多色的原样显示，表晚到之后首字母自动换成图标）。
- 空白模板、选了“首字母”、没登记的都画首字母块：中性底、次要色，取名称首字，不按名字配色。

## 数据

```ts
defineProps<{
    icon?: ProviderIcon | null;   // 服务商里存的图标；null 是跟随模板
    template: string;             // 模板 id
    name: string;                 // 首字母块用
    size?: number;                // 像素，缺省 18
}>();
```

## 隐藏通道理由

- `state:local`：上传的图片是否加载失败。
