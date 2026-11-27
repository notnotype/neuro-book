---
标签: [state:local, state:inject, env:portal, env:global]
别名: ["条目文字", "Entry Text"]
---

# EntryText

条目页的文字分页（[`canon/author-ui.md`](../../../../../../../../docs/specs/canon/author-ui.md) 输出 9、10）：显示世界服务给作者的渲染（[`canon/rendering.md`](../../../../../../../../docs/specs/canon/rendering.md) 输出 7）。文字里的每个值是一个按钮，点了贴着它弹出来历的浮层（插槽，输出 11）。这是阅读视图：右上“编辑”进整篇编辑（`EntryTextEditor`，输出 39）。改什么、怎样写进世界由宿主定。受控。


## 布局与交互

正文排版，宽度由父容器封顶。每块是源文加值表：组件对源文跑与内核同一份条目文法（`@notnotype/nb-canon/grammar`），段落、标题、列表、引用、强调、删除线、行内代码、代码块、链接（只显示文字）、换行、分隔线、表格自己画，正文里的实体画成它表示的字，行内代码与代码块里的标签照原文。活的标签按名字与起点对上值表里的一项：

- 值（`V` 的 `of`）：带虚线下划线的按钮，可读名是“显示名：值”；未知写“未知”、不完整后面写“不完整”，都用警告色；本条目的字段在所选位置之前改过的，后面用次级色写“第 N 章改过”这类标记（`marks`）。带 `aria-haspopup="dialog"`，单击发 `value`（这一处，`placeKey`：块 id、标签起点与地址），开着的那一处 `aria-expanded` 为 true、底色浅亮；按钮带 `data-place`（这一处）、`data-value`（地址）。
- 算出来的值（`V` 的 `expr`）：次级色，悬停提示是式子原文；不可点。
- 条件（`If`）：只画生效的那一支；没有生效的支时，有判断未知就写“未知”（警告色），都不成立就什么都不画。
- 条目引用（`Ref`，或值是引用）：到那个条目的链接，单击发 `entry`；已删除的写原来的名字，次级色，不可点。
- 读不到的值（带原因）、图片（`Image` 与值是图片的 `V`）：次级色的一句，分别是原因与说明。
- 没登记的标签：次级色的“需要插件”。
- 出错的块：它的纯文本与一句原因（危险色），别的块照常。值表与源文对不上（某一项对不上活的标签，或某个活的标签没有项）的块同样按出错显示，不按位置猜。
- 来历的浮层（`open` 指的那一处）：nb-ui `Popover` 锚在那个值按钮上（传送到 body），里面一块（`data-origin-popover`，名字“某某的来历”，可聚焦）放插槽。打开时焦点进这一块；按值按钮上下哪边地方大选定边，之后内容变高不换边（避让只在这一边上挪）；宽 440 像素、窄窗口时占满宽度减两边空白，高度最多视口的六成、超出的在里面滚，读取中先占三行高。关上的三种：按 Esc（焦点回到那个值）或点条目页里别处，发 `close`（宿主清掉记下的那一处）；在值按钮上再点一次是 `value`（宿主按切换处理）；点到条目页外面（标签条、设定树）只收起、不发事件，重新挂上（切到别的标签再回来）时照 `open` 打开。记下的那一处已经不在了（块改了、值落在没生效的支里），块读到以后发 `close`。
- 能改（`editable`）：右上“编辑”，单击发 `edit`；没有主文字时整个分页只有一行整行可点的淡字“写点什么…”（铅笔图标，读屏名“开始写”，指着与键盘聚焦时浮出浅底、字色加深，`--motion-fast`），单击同样发 `edit`。`editReason` 非空时它们不可用，悬停写原因。

## 数据

```ts
type EntryTextBlock =
    | {readonly id: string; readonly source: string; readonly values: readonly EntryTextValue[]}
    | {readonly id: string; readonly error: {readonly message: string; readonly line?: number; readonly column?: number}; readonly text: string};

interface TextAddress {
    readonly entry: string;
    readonly path: string;
}

type EntryTextProps = {
    blocks: readonly EntryTextBlock[];
    /** 这个条目的 id：值节点不写条目时指它自己。 */
    self: string;
    /** 本条目各字段的“改过”标记，按路径；默认没有。 */
    marks?: Readonly<Record<string, string>>;
    /** 开着来历的那一处（`entry-text.ts` 的 `placeKey`）；默认没有。 */
    open?: string;
    /** 出“编辑”（没有主文字时是一行“写点什么…”）；默认 false。 */
    editable?: boolean;
    /** 不能进编辑的原因；非空时那个按钮不可用。默认空串。 */
    editReason?: string;
};

type EntryTextEmits = {
    /** 点了一个值：这一处（`placeKey`），地址用 `placeAddress` 取。 */
    (event: "value", place: string): void;
    /** 来历的浮层在条目页里被关上，或记下的那一处不在了。 */
    (event: "close"): void;
    (event: "entry", id: string): void;
    (event: "edit"): void;
};

type EntryTextSlots = {
    /** 浮层里的来历（`OriginList`）。 */
    origin?(props: {address: TextAddress}): unknown;
};
```

`EntryTextValue` 是 nb-canon 的 `AuthorValue`（值表的一项，canon.rendering 输出 7），见 `entry-text.ts`；对齐在那里的 `layoutBlock`。

## 状态

- 默认：如上。空数据：没有块时，能改是一行可点的“写点什么…”，不能改写“还没有主文字”。禁用：`editReason` 非空时“编辑”不可用。加载中、只读：没有。

## 不支持

- 改文字里的值：值的“改”在数据分页（输出 10）。
- 编辑主文字：在 `EntryTextEditor`，改的是整篇的源文字（Markdown 加标签）。
- 在剧情里改某一块、加一块或删掉一块：阅读视图没有这些入口（输出 39 的第一版把主文字当一整篇）。

## 隐藏通道理由

- `state:local`：浮层锚着的值按钮（关上后留着上一个，等原语把焦点还回去）、点到页面外收起的标记、选定的边。
- `state:inject`：经 `useCanonText()` 取翻译端口。
- `env:portal`：来历的浮层渲染到 nb-ui `Popover` 的 Teleport 目标（body）。
- `env:global`：在 document 上按捕获阶段听 pointerdown，记下最近一次按在哪（浮层关上时分辨页面里还是页面外）；卸载时解除。
