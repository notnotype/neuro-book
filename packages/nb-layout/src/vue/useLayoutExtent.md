# useLayoutExtent

量一个元素的布局尺寸（`clientWidth`、`clientHeight`）：挂上时量一次，之后由 `ResizeObserver` 在尺寸变了时再量，两轴都没变时不发新值。

```ts
const box = useTemplateRef<HTMLElement>("box");
const extent = useLayoutExtent(box); // Ref<{width, height} | null>
```

- `null` 表示元素还没挂上（或已经卸载）；`{width: 0, height: 0}` 是真的零。两种要分开处理：前者不能拿来开手势，后者是“没有空间”。
- 量的是布局盒：不随祖先的 `transform` 缩放。`getBoundingClientRect()` 量的是变换之后的矩形，带缩放的容器（例如淡入时 `scale(0.99)`）会把它量小，所以这里不用它。
- 它包含内边距、不含边框：拿它给自己的内容排版时，要扣掉内边距。

给 `NestedGrid` 量尺寸不用它：`NestedGrid` 自己量根盒，经 [`useGridHost`](useGridHost.md) 交给宿主。它给的是别的场合，例如宿主要按某个盒子的大小决定显示什么。
