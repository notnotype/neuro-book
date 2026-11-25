---
标签: [state:inject]
别名: ["图片输入", "Image Input"]
---

# ImageInput

图片字段的值怎么填（[`canon/components.md`](../../../../../../../docs/specs/canon/components.md) 输出 15，[`canon/author-ui.md`](../../../../../../../docs/specs/canon/author-ui.md) 输出 53）：图片字段的值是 `{图片: 作品内路径, 说明: 文字}`，整值写。确认条、列表元素对话框与专门界面的就地改都用它（经 `FieldInput`）。受控：值由宿主给；候选与上传由宿主一层做、注入进来（`images.ts` 的 `provideImagePicking`；确认条、元素对话框、就地改里的它隔着几层组件，不一层层传），它只发动作。

## 布局与交互

- 宿主注入了能用的候选与上传（窗口里有文件服务）时，上面一行“作品里的图片”与“上传”，下面一块固定高度的方格（四列，至多 12 张，多出来在方格里滚动）：作品图片文件夹里的候选（`CanonImage` 缩略图），选中的那张描强调色边。每次挂上都让宿主重列一次（别处可能加了图），上一处的原因与提示也一并清掉。点一张：值换成它的路径（说明不变）。“上传”打开选文件框（只列 PNG、JPEG、GIF、WebP）；上传中“上传”换成“取消上传”（同一个按钮只换文字，焦点留在它上面），方格末尾一格写“正在上传…”，Escape 取消上传、不往外传；传好以后值换成存下的路径（重名时是实际的名字），新图排在候选最前面。
- 下面是手填作品里的路径（有候选时占位写“或者填作品里的路径”），再下面是说明。两个都空时值是 `null`（未知）。
- 原因写在最下面一行（`role="alert"`）；取消上传以后的那句“图可能已经写进作品”不算失败，没有原因时用次要色写在同一行（`role="status"`）。原因里上传与列候选失败的优先，其次是宿主给的 `problem`，再次是本地的检查（路径不合规则：带协议、以 `/` 开头、有 `..`、在 `.nbook/` 下；只填了说明没填路径），本地检查不过时路径输入框标红。
- 没有注入时只有说明与路径两个输入框。

## 数据

```ts
type ImageValue = {readonly 图片: string; readonly 说明: string};

type ImageInputProps = {
    /** 当前值；null 是未知。受控。 */
    modelValue: ImageValue | null;
    /** 服务退回的原因。 */
    problem?: string;
    disabled?: boolean;
};

type ImageInputEmits = {
    "update:modelValue": [value: ImageValue | null];
};
```

没有插槽与 expose，attrs 落在外层。

## 不支持

- 按名字在整部作品里找图、别的目录里的候选（手填路径）；文件在别处被换掉以后刷新缩略图（重新打开页面）。

## 隐藏通道理由

`state:inject`：候选与上传（`useImagePicking`，宿主一层做读写，组件只发动作）；canon 的翻译端口；缩略图的取图地址经 `CanonImage` 注入的函数算。
