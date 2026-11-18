---
标签: [state:local, state:inject]
---

# StickerGrid

表情包页（[`agent/stickers.md`](../../../../../../../docs/specs/agent/stickers.md) 输出 26）的表情网格：把一个表情包的表情与两类不是表情的图（认不出的、清单没列的）按组排成固定大小的格子，选中一个交给属性栏。图片大小、宽高比不影响网格：每格 72px 见方，图在里面按比例缩小、居中，透明底的小表情与不透明的宽图、竖图落在同一个框里。

## 布局

- 组从上到下：认不出（名字当不了表情名的图）、常用、其他、文件夹里还没加进来的；没有的组不画。组头写组名与个数；常用组头带一个说明图标；没加进来的组头靠右有“全部加进来”（只读时没有）；列表被截过时组头写“还有 N 张没列出”。
- 每组一个 `grid`，列数按宽度自动（格子 84px 宽，列间 8px）。格子下写名字（单行截断，悬停看全名）；认不出与没加进来的写文件名，图淡显。
- “添加”格是虚线框的按钮，排在“其他”组末尾（没有“其他”时排在“常用”组末尾；一个有表情的组也没有时单独一行）。上传中的图在它前面各占一个带转圈的占位格。
- 还没有任何图的表情包：整个网格区是一个大落点，写“拖进图片，或点这里选择文件”。
- 只读（插件的包）：没有“添加”格、不收拖放、不能删。
- 拖进文件时（`dragging`）网格上盖一层强调色虚线框的落点提示，写“松开，添加 N 张图片”。

## 交互

- 每组是一个 `listbox`，格子是 `option`，`aria-selected` 标选中；整个网格只有一个格子在 Tab 序里（选中的，没有选中时第一个）。焦点即选中：方向键左右按顺序（跨组接续）、上下按当前组的实际列数移动，Home、End 到头尾；Delete 请求删除选中的（页面先确认）；Esc 取消选中。上下方向键的列数从组的网格布局量出来，没有布局时按 1 列。
- 点格子选中，再点同一格不取消（取消用 Esc 或属性栏的“返回表情包”）。
- “添加”格点开系统的文件选择（图片，可多选），选完发出 `add-images`；拖放由页面统一处理（窗口级兜底），网格只标出落点（`data-sticker-dropzone`）。

## 数据

```ts
import type {StickerPackDetail} from "../../shared/contracts";
import type {UploadItem} from "../upload-queue";

type StickerGridProps = {
    detail: StickerPackDetail;
    /** 选中格的键（`stickerKey`、`extraKey`）；没有为 null */
    selected: string | null;
    /** 这个包正在传的图 */
    uploads?: readonly UploadItem[];
    readonly?: boolean;
    /** 页面看到文件在拖：画落点提示 */
    dragging?: boolean;
    /** 拖进来的文件个数（落点提示用） */
    dragCount?: number;
};

type StickerGridEmits = {
    (e: "select", key: string | null): void;
    (e: "delete", key: string): void;
    (e: "add-images", files: File[]): void;
    (e: "list-files", files: "all"): void;
};
```

没有插槽与 `expose`，属性不透传。

## 隐藏通道理由

- `state:local`：隐藏的文件输入的引用，与方向键移动时用来找格子的根元素引用。
- `state:inject`：文字经表情包插件的翻译端口取（`useStickersPageText`）。

## 不支持

- 拖动排序、多选。
