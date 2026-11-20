---
标签: [state:inject, env:global]
别名: ["可排序列表", "Sortable List"]
---

# SortableList

几组竖排的项，能拖动或用键盘排序、可以跨组（行为合同 [`ui/sortable-list.md`](https://github.com/notnotype/neuro-book/blob/master/docs/specs/ui/sortable-list.md)）。拖动是实时布局：被拖的那一行跟手，邻居让开，预览就是放下后的样子，不画落点线；手势与工作台用同一个拖动会话，起拖门槛、Esc 取消与键盘一致。每一行除把手以外的内容由宿主用插槽画，组件不管行里的控件。逻辑都在 composable `useSortable`，不是这种版式（横排、自己的行结构）的地方直接用它。

## 布局

自上而下按分区：分区头（缺省写标题），下面这一区的行；空的分区放一行“拖到这里”作落点。每行左边是把手（六点），右边是插槽内容，把手在与内容第一行同高的盒子里竖直居中（行高取 `--nb-layout-sortable-first-line`，缺省是行自己的 `1lh`，宿主的第一行行高不同时设它）。行宽随容器，内容的截断与换行归插槽。`390×844` 下结构不变。

被拿起的行底是 `--nb-layout-bg-panel`，有一层投影（`--nb-layout-sortable-held-shadow`，宿主旋钮，可以设在子树上），盖在邻居上；拖动中别的行没有悬停底色。

## 交互

- 指针在一行上按下并移过门槛就拿起，抓住的点一直在指针下；按在行里的按钮、输入框、链接上不起拖。触摸只从把手起拖（按住）。
- 拖动中被拖的行沿竖直方向跟手，夹在列表范围里（含空分区的占位）；后沿过了下一行的中线（往上是前沿过了上一行的中线）邻居就让开，过了分区头就进了那一区。刚换过去时，往回挪不到 12px 不换回来，不会在分区头附近来回跳。松手调一次 `onMove`，回到原位不调；Esc、窗口失焦整场回原样，被拖的行从看到的地方滑回。
- `onMove` 返回 Promise 时，放下后的次序留到它 settle，期间不能再拿起；失败时回到 `sections` 的次序。失败的 Promise 在这里会再抛一次（不吞错）：宿主自己报告原因，并让交回的 Promise 在报告之后完成。
- 键盘：把手是按钮，可访问名“移动某项”，描述指向所在分区的标题，悬停提示写用法。空格拿起，上下键一步一位（跨分区），回车放下，Esc 取消，焦点回到把手；拖动中 Tab 回到第一个位置。
- 拿起、换位、放下、取消经一个看不见的 `role="status"` 播报。

## 数据

```ts
type SortableListProps = {
    /** 分区与它们的项（按呈现顺序）。受控：放下后由调用方改了再交回来。 */
    sections: readonly {id: string; title: string; keys: readonly string[]}[];
    /** 一项的名字：把手的可访问名与播报用。 */
    label: (key: string) => string;
    /** 停用：不能拿起，把手停用；默认 false。一场进行中变成停用时整场中止。 */
    disabled?: boolean;
    /** 放下且位置变了才调；返回 Promise 时放下后的次序留到它 settle。模板里写 `@move`。 */
    onMove?: (move: {key: string; from: {section: string; index: number}; to: {section: string; index: number}}) => void | PromiseLike<unknown>;
};

type SortableListSlots = {
    /** 一行除把手以外的内容。`held`：这一行正被拿着（含放下后滑回原位的那一下）。 */
    item(props: {itemKey: string; held: boolean; section: string}): VNodeChild;
    /** 分区头的内容；缺省写标题（`role="heading"`，第 4 级）。 */
    head?(props: {section: string; title: string}): VNodeChild;
};
```

`onMove` 是函数属性而不是事件：要拿到它返回的 Promise。模板里照常写 `@move="…"`，Vue 把它编成 `onMove` 这个键；不要声明成名叫 `move` 的属性，那样 `@move` 接不上。没有 expose；attrs 落在根元素上。

## 状态

- **停用**：不能拿起，把手停用，行没有抓手光标。
- **空分区**：一行“拖到这里”，是那一区第 0 位的落点。
- **等写入**：放下后到 `onMove` 的 Promise settle 之前，次序是放下的样子，不能再拿起。
- 加载中、出错：没有这些状态。

## 不支持

- 网格形状；横排（`useSortable` 的 `axis: "horizontal"`）没有组件，也没有使用方验证。
- 列表长到要滚动时的边缘滚动。
- 多选一起拖。

## 注意事项

- `sections` 在拖动中被别处改了次序或分区，整场取消；勾选这类只改行内容的变化不影响。
- 行上不要绑定 `style`：被拖的行跟手写的是元素的 `translate`，绑定的 `style` 在重渲染时会盖掉它。

## 隐藏通道理由

- `state:inject`：经 `LAYOUT_TEXT_KEY` 注入的翻译函数（把手的可访问名、提示、占位、播报）；没有注入时用自带的源语言目录，同 [Splitter](Splitter.md) 的“文字”。
- `env:global`：拖动会话在拿起后到放下前在窗口上监听指针、按键、失焦与尺寸变化，放下即拆；闲时只有列表根上的按下、点击与按键监听。
