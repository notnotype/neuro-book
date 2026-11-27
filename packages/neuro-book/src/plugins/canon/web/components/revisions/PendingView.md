---
标签: [state:local, state:inject]
别名: ["待处理", "Pending"]
---

# PendingView

底部面板里“待处理”视图的骨架（[`canon/author-ui.md`](../../../../../../../../docs/specs/canon/author-ui.md) 输出 23、27、28、30）：左边三组的列表（“待处理”“只是提示”“已处理”），右边选中那一条的详情（`PendingDetail`）。受控：各组的行、条数、展开了哪几组、选中哪一条、详情的内容都由宿主给（宿主是 `PendingViewHost`，行与详情由 `pending.ts` 折好），点了什么发出什么。它不读世界。

## 布局

- 从上到下：世界横幅（`WorldBanners`）；别人正在独占写入时一行“谁正在独占写入”加“强行解除”；结果不完整时一行一句“这些检查没有算出来：……”（`role="status"`）；剩下的高度是列表与详情。
- 视图宽 640 像素以上（容器查询，量的是视图自己的宽度）列表在左（40%，至少 240 像素）、详情在右，各自纵向滚动；更窄时上下排，各占一半高度。滚动条是叠在内容上的 nb-ui `OverlayScrollbar`。左右内边距取视图外框给的 `--view-inset-inline`。
- 每组一个展开按钮：箭头、组名、条数（还不知道时不写）。展开的组下面是这一组的行；正在读、还一条都没有时“读取中…”，读到了没有时一句空状态；一组没列完时末尾“再显示更多”。
- 一行写一句是什么（放不下时截断、悬停看全文）与它的位置（次级色，靠右）。选中的一行底色加深。

## 交互

- 点组的展开按钮发 `update:expanded`（新的展开列表）。
- 点一行或焦点移到一行上发 `select`（组与键）；详情跟着换（输出 30“移到哪条详情就显示哪条”）。
- 键盘（`roving.ts`）：上下键、Home、End 在所有展开的组的行之间移，只有选中的那一行（没有选中时是第一行）在 Tab 序列里。焦点在列表里时选中的那一行消失（世界变了，宿主换了选中），焦点移到新选中的那一行，不掉到页面上。
- 读屏：行是带 tabindex 的列表项，选中的那一行标 `aria-current="true"`，同 `ProviderRail`（选中跟着焦点走、一次只有一条，不用列表框的多选语义）；行的文字就是详情的标题，焦点移到哪一行就读出它，所以详情区不做实时播报。“谁正在独占写入”那一句是 `role="status"`，“强行解除”按钮在它外面。
- “再显示更多”发 `more`（组）；“强行解除”发 `break-exclusive`；详情里的点击原样转发 `open`、`open-chapter`。

## 数据

```ts
interface PendingGroupState {
    readonly rows: readonly PendingRow[];
    /** 组名后的条数；还不知道时为 null。 */
    readonly count: number | null;
    /** 展开了、还没读到。 */
    readonly loading: boolean;
    readonly more: boolean;
}

type PendingViewProps = {
    /** 三组；收起的组只用 `count`。必填。 */
    groups: Readonly<Record<PendingGroup, PendingGroupState>>;
    /** 展开的组。必填、受控。 */
    expanded: readonly PendingGroup[];
    /** 选中的那一条；默认 null。受控。 */
    selected?: {readonly group: PendingGroup; readonly key: string} | null;
    /** 选中那一条的详情；默认 null（写“选一条看详情”）。 */
    detail?: PendingDetailModel | null;
    /** 结果不完整的几句；默认空。 */
    notes?: readonly string[];
    /** 正在独占写入的持有者；默认空（没有人独占）。 */
    holder?: string;
    disconnected?: boolean;
    readOnly?: string;
};

type PendingViewEmits = {
    (event: "update:expanded", value: PendingGroup[]): void;
    (event: "select", group: PendingGroup, key: string): void;
    (event: "more", group: PendingGroup): void;
    (event: "open", target: PendingTarget): void;
    (event: "open-chapter", chapter: string): void;
    (event: "break-exclusive"): void;
    (event: "retry"): void;
};
```

没有插槽、没有 expose；attrs 落在根上。

## 状态

- 一组展开了还没读到：“读取中…”（`aria-busy`）。读到了没有：“没有待处理的问题”“没有提示”“还没有处理过的”。
- 没有选中：详情处写“选一条看详情”。
- 世界断开、只读：横幅；“强行解除”只在有人独占时出现。

## 不支持

- 换读取位置与模式：用缺省位置与实际模式，与状态栏的条数一样。
- 对一条做处理（标“有意为之”等）：第一批不做，从详情里点开对象去改。

## 隐藏通道理由

`state:inject`：经 `useCanonText()` 取宿主注入的翻译端口（命名空间 `nbook.canon`）。`state:local` 是列表与两个滚动元素的模板引用（焦点移动与叠加滚动条用）。
