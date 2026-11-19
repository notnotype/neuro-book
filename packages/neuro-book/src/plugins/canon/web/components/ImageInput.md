---
标签: [state:inject]
别名: ["图片输入", "Image Input"]
---

# ImageInput

图片字段的值怎么填（[`canon/components.md`](../../../../../../../docs/specs/canon/components.md) 输出 15）：图片字段的值是 `{图片: 作品内路径, 说明: 文字}`，整值写。两个输入框，一个填作品里的路径，一个填说明；路径写得不合规则（带协议、以 `/` 开头、有 `..`、在 `.nbook/` 下）时下面写一句原因。确认条与列表元素对话框都用它。受控。

## 布局与交互

一列两个 nb-ui `Input`：路径（占位“作品里的路径，例如 图片/星瑕.png”）、说明。每改一个字发一次 `update:modelValue`（新的完整值）。两个都空时值是 `null`（未知）。路径不合规则、或只填了说明没填路径时，路径输入框标红，下面一行写原因；宿主给了 `problem`（服务退回的原因）时写它。

## 数据

```ts
type ImageValue = {readonly 图片: string; readonly 说明: string};

type ImageInputProps = {
    /** 当前值；null 是未知。受控。 */
    modelValue: ImageValue | null;
    /** 服务退回的原因；有时写在下面，优先于本地的检查。 */
    problem?: string;
    disabled?: boolean;
};

type ImageInputEmits = {
    "update:modelValue": [value: ImageValue | null];
};
```

没有插槽与 expose，attrs 落在外层。

## 不支持

- 选文件、上传、预览缩略图、检查文件在不在：只填路径（计划“不做”）。

## 隐藏通道理由

`state:inject`：经 canon 的翻译端口取标签、占位与原因的字。
