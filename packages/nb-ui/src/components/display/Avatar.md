---
标签: [state:local, env:timer, io:read]
---

# Avatar

`Avatar` 用固定尺寸的头像容器展示图片，并在图片缺失或加载失败时显示文字回退；它支持圆形或 squircle 外形，也允许调用方完全替换回退内容。图片加载状态和延迟回退由头像组件管理。

## 布局与交互

根节点是不可收缩的方形头像，尺寸由 `size` 选择：`xs`、`sm`、`md`、`lg`、`xl` 依次增大。默认 `squircle` 在 `lg`/`xl` 使用面板圆角，较小档使用控件圆角；`circle` 各尺寸均为圆形。图片覆盖容器并裁切适配；回退文字居中显示并转为大写。窄屏时尺寸不随视口变化。

头像不是操作控件，不提供键盘动作；悬停时有轻微放大视觉效果。无图片时立即显示回退，有图片时等候 `delayMs` 后才显示回退，图片成功加载后回退隐藏；图片加载失败时回退保留。图片的 `alt` 使用显式 `alt`，为空时回退到 `fallback`。

## 数据

```ts
type AvatarSize = "xs" | "sm" | "md" | "lg" | "xl";
type AvatarShape = "circle" | "squircle";

type AvatarProps = {
    /** 图片地址；默认空字符串，空时不创建图片节点。 */
    src?: string;
    /** 图片替代文本；默认空字符串。图片 alt 为空时使用 fallback。 */
    alt?: string;
    /** 默认回退文字；默认空字符串。未提供 fallback 时取 alt 的前两个字符。 */
    fallback?: string;
    /** 头像尺寸；默认 "md"。 */
    size?: AvatarSize;
    /** 外形；默认 "squircle"。 */
    shape?: AvatarShape;
    /** 有 src 时回退内容显示前的等待时间（毫秒）；默认 300。无 src 时不延迟。 */
    delayMs?: number;
};

type AvatarEmits = Record<never, never>;

type AvatarSlots = {
    /** 替代文字回退内容；可省略。 */
    fallback?(): unknown;
};
```

回退来源优先级为 `fallback` slot、非空 `fallback` prop、`alt` 前两个字符；三者均空时回退区域为空。无 expose API。根头像元素按 Vue 默认行为接收未声明 attrs、`class` 与 `style`。

`state:local` 标记上游维护的图片加载状态；`env:timer` 标记延迟回退所用的计时器。计时器用于避免图片快速加载时短暂闪出文字回退，只在存在图片地址时启用，销毁或延迟参数变化时由上游清理。

`io:read` 的理由：上游为检测图片加载状态创建 `Image` 并设置 `src`，组件的 `<img>` 也绑定同一地址；浏览器可能进行重复资源读取，具体是否复用缓存由浏览器决定。读取只用于呈现调用方指定的 `src` 图片，失败时回到同一回退内容，不读取业务数据或 store。

## 状态与边界

默认无 `src` 时展示回退内容；图片加载中，在延迟期内回退暂不渲染；图片加载完成后展示图片；加载失败后保留回退。组件没有禁用、只读、加载指示器或错误文案状态。

## 上游边界

Reka UI 负责图片加载状态判定及 AvatarImage / AvatarFallback 的呈现时序；本组件提供尺寸、形状、alt 回退规则和默认延迟值。图片请求的来源与内容由调用方通过 `src` 指定，不读取业务数据或 store。

## 已知偏差

- `delayMs` 显式设为 `0` 时，上游只在该值为 truthy 时启动计时器，而回退内容又只在该值为 `undefined` 时立即允许渲染。因此有 `src` 且 `delayMs=0` 时回退内容不会出现；不要用 0 表示“立即显示回退”，实现待订正。

## 注意事项

- 仅 `src` 非空时启用 `delayMs`；空地址下回退立即显示。
- 组件不提供图片错误图标或错误事件；加载失败与未提供图片都落到同一回退内容。
