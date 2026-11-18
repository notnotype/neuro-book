---
标签: [state:local, state:inject]
---

# StickerPackRail

表情包页（[`agent/stickers.md`](../../../../../../../docs/specs/agent/stickers.md) 输出 25）的左栏：按来源分组列出表情包，一行是第一个表情的缩略图、显示名与表情数；“我的”组头有“新建”，底部有“导入 zip”。结构与键盘同 Profile 页的 [`ProfileRail`](../../../agent/web/components/ProfileRail.md)，数据不同，所以各写一份。

## 布局

固定 168px 宽，右边一条分割线，自己纵向滚动；底部“导入 zip”贴底。一行 32px：缩略图 22px、名字（单行截断）、有认不出的图时的警示图标、无效的表情包的错误图标、表情数。没有缩略图（零个表情、无效）时画占位图标。页面窄于 600px 时整栏由页面隐藏，改用顶上的下拉。

## 交互

- 一行是一个按钮，`aria-current="page"` 标当前项；只有当前项在 Tab 序里（roving tabindex），上下方向键、Home、End 移动并选中，焦点跟着走。
- “新建”“导入 zip”发出对应事件；`disabled` 时都不可用。

## 数据

```ts
import type {RailGroup} from "../pack-view";

type StickerPackRailProps = {
    groups: readonly RailGroup[];
    /** 当前选中的表情包 id；没有为 null */
    current: string | null;
    disabled?: boolean;
};

type StickerPackRailEmits = {
    (e: "select", id: string): void;
    (e: "create"): void;
    (e: "import"): void;
};
```

没有插槽与 `expose`，属性不透传。

## 隐藏通道理由

- `state:local`：没有，`ref` 只放根元素以便把焦点移到当前项。
- `state:inject`：文字经表情包插件的翻译端口取（`useStickersPageText`）。
