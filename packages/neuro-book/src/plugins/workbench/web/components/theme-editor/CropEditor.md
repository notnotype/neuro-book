---
标签: [state:local, state:inject, env:timer]
别名: ["取景编辑", "Crop Editor"]
验证入口: ThemeEditor
---

# CropEditor

场景取景的编辑（[`theme/editor.md`](../../../../../../../../docs/specs/theme/editor.md) 输出 12、13）：五个取景框叠在同一张原图上，选中的实线，其余淡显；右边列表选框、改数值。拖框、拉右下角缩放和改数值互相同步，每一步都经 `change` 交给模型，工作台里对应位置同时变化。

## 布局

两栏：左边是原图（占满栏宽，比例不变）和叠在上面的框，下面一句提示；右边 220px：五个位置的列表（色块加名字），选中项下面是它的数值输入（大小、位置；空状态是位置与内容中心），一个“清除这个位置的取景”。组件宽度不足 520px 时两栏变成上下。每个框用固定的标注色（不取主题色：它们叠在任意一张图上），左上角带位置名；选中的框是实线、右下角带缩放手柄（空状态没有：它的大小由 `cover` 定），别的框是虚线、淡显。

## 交互

- 拖框：指针按住框移动，框不出图；空状态的框比图大时只限制位置。拖的过程中框先画在本地，隔 120ms 和停手时各发一次 `change`，不会每个像素写一次记录（`env:timer`：节流只能在手势所在的组件里做）。
- 缩放：拖右下角，按参照盒的比例缩放，左上角不动。
- 数值：输入停手后发 `change`，大小或位置只写了一个时另一个取缺省（`auto 118%` 或 `1000px auto`，位置 `50% 50%`）。
- 读不懂的写法（手写或导入的声明）：该位置没有框，数值仍能改，列表下提示一句；一旦在输入里改，就按编辑器的形式写。
- 框的位置与大小用参照盒（默认布局下各位置的大致尺寸）换算，是示意：真实尺寸随窗口变，所以工作台里的同时变化是最后的依据。

## 数据

```ts
type Props = {
    imageUrl: string;
    crop: ThemeDeclaration["crop"] | undefined;
};
type Emits = {
    change: [region: CropRegion, css: CropCss | undefined];  // undefined：清掉这个位置
    "content-x": [value: number | undefined];
    "load-failed": [];
};
```

换算在 `crop-model.ts`（纯函数，单独测）。文字取自 `nbook.workbench` 的 `themeEditor.scene.*`，经注入的翻译端口。
