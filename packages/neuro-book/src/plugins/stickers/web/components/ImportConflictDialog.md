---
标签: [state:local, state:inject]
---

# ImportConflictDialog

导入的 zip 与已有的表情包同名时的对话框（[`agent/stickers.md`](../../../../../../../docs/specs/agent/stickers.md) 输出 36）：左右对照“已有的”与“要导入的”（各一排缩略图、显示名与表情数），让用户选取消、另存为下一个空的包名，或替换已有的（危险色）。

## 布局

`sm` 尺寸，标题“已经有一个包名是 xxx 的表情包”。两列：每列一个小标题（已有的 / 要导入的）、最多四个固定大小的缩略格、名字、个数（读不出写“读不出表情数”）。页脚：取消靠左，另存与替换靠右；另存写“另存为 cat-2”（没有空的包名时写“另存”且不可用）；替换写“替换已有的”，危险色。两列下面是固定高度的一行小字：平时写“替换会删掉已有的这个包”，选择失败时换成原因（页脚被自己的按钮占了，用不了 Dialog 的状态行）。

## 交互

- 选“另存”或“替换”后对话框保持打开：忙碌时按钮不可用，失败的原因写在页脚状态行，成功才由页面关掉。取消关闭。
- 对话框关闭后焦点回到触发它的“导入 zip”。

## 数据

```ts
type PreviewItem = {url: string; label: string};

type ImportConflictDialogProps = {
    open: boolean;
    /** 包名 */
    name: string;
    existing: {title: string; count: number; items: readonly PreviewItem[]};
    /** 要导入的：读不出时 count 为 null、items 为空 */
    incoming: {title: string; count: number | null; items: readonly PreviewItem[]};
    /** 另存时会用的包名；没有空的为 null */
    copyAs: string | null;
    /** 已有的包拿不到版本令牌：“替换”停用，状态行写原因，只能另存；缺省 true */
    canReplace?: boolean;
    busy?: boolean;
    status?: string;
};

type ImportConflictDialogEmits = {
    (e: "update:open", value: boolean): void;
    (e: "choose", mode: "copy" | "replace"): void;
};
```

没有插槽与 `expose`，属性不透传。

## 隐藏通道理由

- `state:local`：没有。
- `state:inject`：文字经表情包插件的翻译端口取（`useStickersPageText`）。
