---
验证入口: EditorArea
标签: [state:local]
---

# BackgroundSettingsBlock

一种背景的设置（[`ui/backgrounds.md`](../../../../../../docs/specs/ui/backgrounds.md) 输出 9）：标题行右边是种类（无、纯色、图片），选了纯色或图片时下面是预览；纯色时亮暗各一排色块，图片时是已传过的图、上传、填充、模糊与遮罩。

## 布局

预览高 96px，用和真实显示同一个 [`BackgroundLayer`](../../../../ui/background/BackgroundLayer.md)，里面放主文字、次要文字与链接三行，看得出字读不读得动。缩略图 80×48px，放不下换行。遮罩滑块占满余下的宽度，右边百分比固定宽度。

## 交互

- 选“图片”而还没有图时不写设置，只显示选图；选中或传完一张才写。缺省填充 `cover`、模糊开、遮罩 85。
- 遮罩滑块从这张图的实际下限开始；拖动时只改预览，松手才写。设置里的值低于下限时显示下限，不改写。
- 色块：当前明暗的颜色不合格时不写，显示原因；另一个明暗的颜色要切过去才算得出，切过去时同样显示原因、不应用。
- 状态行显示上传失败、图片读不出、颜色不合格；系统无障碍偏好让图不画时也说明。

## 数据

```ts
type Props = {
    title: string;
    value: EditorBackgroundSetting;
    allowColor: boolean;
    images: ReadonlyArray<string>;
    upload: (file: File) => Promise<{ok: true; address: string} | {ok: false; reason: string}>;
    disabled: boolean;
};
type Emits = {change: [value: EditorBackgroundSetting]};
```

## 不支持

自己写设置：改动都发给页面。
