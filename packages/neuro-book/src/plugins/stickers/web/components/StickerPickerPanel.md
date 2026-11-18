---
标签: [state:local, state:inject]
别名: ["表情选择器", "Sticker Picker"]
---

# StickerPickerPanel

表情选择器的面板（[`agent/stickers.md`](../../../../../../../docs/specs/agent/stickers.md) 输出 39 到 43）。Markdown 编辑器的工具栏、斜杠菜单与 Agent 输入框的表情按钮打开它；外框（弹层）由宿主给，面板只画里面。经选择器服务的 `loadPanel()` 取到的是绑好服务的版本，宿主不传 `picker`。

## 布局

自上而下，宽 352px（窄窗口里不超过宿主给的宽度），高 420px：

- **搜索框**：打开时焦点在这里。
- **标签行**：第一个是“最近用过”（时钟图标，没有最近用过时不画），其余是各表情包的第一张图；当前的只用底色标出，不画边线。搜索时收起。
- **网格**：按组排，“最近用过”在前，其余每个表情包一组，组头写显示名，插件的包另写插件名；每行 6 格，格子正方形，图在里面按比例缩小、居中，不写字。网格自己滚动；滚到哪一组，那一组的标签亮。
- **底部一行**：指着（悬停或键盘焦点）的表情：小图、名字、写法（等宽、淡色、放不下时截断）。没指着时是第一个表情。
- **搜索结果**：不分组，名字以查询开头的在前；没有结果时一句“没有叫“…”的表情”。
- **没有表情包**：图标、一句“还没有表情包”与“在设置里新建”。

## 交互

- 点格子发 `pick(item, false)`；按住 Shift 点发 `pick(item, true)`（宿主插入后不关面板）。
- 键盘：搜索框里按下方向键进网格；网格里左右按顺序、上下按 6 列移动（跨组时到下一组的同一列，组不够长取最后一个），Home、End 到头尾；回车同点击，Shift+回车同 Shift 点。搜索框里按回车选第一个结果（没有结果时什么也不做）。
- 点标签滚到那一组，焦点留在原处。
- Esc 时发 `close("escape")`（宿主把焦点还回去），焦点离开面板（点了外面、Tab 出去）时发 `close("blur")`（宿主不抢焦点）。“在设置里新建”打开设置的表情包页并发 `close("blur")`。
- “最近用过”按打开那一刻定下，按住 Shift 连着插时不重排；打开时目录还没到的，到了再取一次。
- 网格是 `listbox`，格子是 `option`，可访问名称是表情的名字（悬停提示是写法）；整个网格只有一个格子在 Tab 序里。

## 数据

```ts
import type {StickerPicker, StickerPickerItem} from "../../shared/contracts";

type StickerPickerPanelProps = {
    /** 选择器服务：分组、搜索、最近用过；在渲染里读，随目录与记录更新。 */
    picker: StickerPicker;
};

type StickerPickerPanelEmits = {
    (event: "pick", item: StickerPickerItem, keepOpen: boolean): void;
    (event: "close", reason: "escape" | "blur"): void;
};
```

`state:local`：搜索文字、指着的表情、亮着的标签。`state:inject`：表情包页的文字（`useStickersPageText`）。

## 不支持

收藏、自定排序、拖动表情出去（Spec 的“不承诺”）。
