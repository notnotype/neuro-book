---
标签: [state:local, state:inject]
别名: ["富文本主文字", "Entry Rich Input"]
---

# EntryRichInput

条目主文字的富文本输入框（[`canon/author-ui.md`](../../../../../../../docs/specs/canon/author-ui.md) 输出 48）：作者看到的是排好版的文字，标签是不能打字进去的小块。它是 `EntryTextEditor` 的一种输入框，和源文字的输入框（`PlainSourceInput`、编辑器插件的 `CodeInput`）**同一个合同**：受控的整篇源文、`update:modelValue`、`focus(caret?)`、`cursorOffset()`、`insert(text)`、`readonly`。所以条目页的状态行、暂存、提交、冲突都不用知道它是富文本还是源文字。

和别的富文本输入不同的地方：读写都经章节编辑器同一套编解码器（nb-markdown），加条目语法模块（`../entry-syntax.ts`）。作者没动过的块原样写回，改过的块按规范写法重写并读回校验；条件 `<If>…</If>` 整段是一个小块，作者拆不坏。

## 合同逐项对照

| 合同 | 在富文本里 |
|---|---|
| `modelValue` → 显示 | 第一次挂上时整篇读入。之后 `modelValue` 变了：与最近一次交出的相同是回声，不动；不同（“换成那边的”、冲突里选“现在的”、重连后读到的暂存）就只把不同的那一段换掉，撤销历史保留，这次替换不进撤销。 |
| `update:modelValue` | 每次文档变化后整篇写出，写得出就交出（与上一次交出的相同不交）。写不出（不应发生：小块的改动都先过写入前的检查）时不交出，输入框下面写一句“这一处写不出”，暂存留着最后一次交出的文字；作者撤销那一步就恢复。 |
| `focus(caret?)` | 焦点进编辑区，`"start"`、`"end"` 把光标放到文首、文末。 |
| `cursorOffset()` | 光标所在的顶层块之前的整篇写出长度，加块内按纯文字数的偏移（编解码器不给节点到源文偏移的对照，切到源文字时光标落在同一块里的大致位置）。 |
| `insert(text)` | `text` 是一段源文（“插入”菜单给的写法），读成节点插在光标处，有选区时换掉选区；插入后的整篇过写入前的检查才落，否则不插、返回 false。只读时返回 false。 |
| `readonly` | 不能编辑，不交出；能选、能复制。 |

## 数据

```ts
type Props = {
    /** 整篇源文，受控。 */
    modelValue: string;
    /** 编辑区的可访问名称。 */
    label: string;
    /** 合同里有的属性，富文本用不上（读法固定是条目语法）。 */
    language?: string;
    /** 默认 false。 */
    readonly?: boolean;
    /** 写入前检查用的没登记标签的基线（`../entry-check.ts` 的 `baselineOf`，开始编辑时读到的那一版）；默认空。 */
    baseline?: ReadonlySet<string>;
};

type Emits = {
    "update:modelValue": [text: string];
    "focus": [];
    "blur": [];
};

type Exposed = {
    focus(caret?: "start" | "end"): void;
    cursorOffset(): number | null;
    insert(text: string): boolean;
};
```

没有 slots；attrs 落在根元素上。

## 布局

一个随内容增高的编辑区（不自己滚动，跟着条目页滚），正文的字号与行距同阅读视图；编辑区下面在写不出时多一行原因（危险色，`role="alert"`）。`390×844` 下照样占满内容列宽。

## 不支持

- 小块的样子、点开小块改、`{` 与 `@` 插入、值的显示：w00055 t03 的后续切片（S3）加；这一版小块显示标签原文。
- 块级的条件、跨行的条件在富文本里改：跨行的条件各标签各一个小块，只能在源文字里改。
- 从外面粘进来的含标签的纯文字按写法读入：按文字处理（写成 `\<V`），在源文字里粘才是标签。

## 隐藏通道理由

- `state:local`：编辑器的实例、原文对照、最近一次交出的文字、写不出的那一句。
- `state:inject`：经 `useCanonText()` 取翻译端口写“这一处写不出”。
