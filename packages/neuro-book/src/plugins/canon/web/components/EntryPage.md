---
标签: [state:local, state:inject]
别名: ["条目页", "Entry Page"]
---

# EntryPage

条目页的骨架（[`canon/author-ui.md`](../../../../../../../docs/specs/canon/author-ui.md) 输出 6 到 9、27）：页头、状态说明、分页条；分页的内容是默认插槽。受控：位置、“算上计划”、当前分页都由宿主给（`EntryPageHost`），交互时发出新值。

## 布局与交互

- 最上面是世界横幅（`WorldBanners`）：断开时“世界已断开”与“重试”，世界只读时写原因（输出 28）；内容留着。
- 页头：名字（马甲条目后面是“是谁：某某”，某某是链接）、一句话简介；下面一行是别名与靠右的“在看”（`ViewPointPicker`，输出 7、34：故事线、时间点与“算上计划中的情节”；没有章、没有计划又只有主线时不出；窄屏占满一行）；右上角只有条目的“更多”；页头、分页条与内容同一个上限（内容净宽 760），内边距在列里面，三者左边对齐；下面是分页（`EntryTab`：图标、名字、条数，设定组与文字一段、看法一段）。滚动区不窄于 1040 像素时分页在内容左边竖排（`EntryPageNav`，吸在页头下面），窄于 1024 时在页头下面横排（nb-ui `Tabs` 的 `scroll`：放不下时分页条自己横向滚动，每页照旧写名字，选中的一页滚进看得见的范围；第一个看法前一条竖线分段），两个阈值之间保持原样；两种排法选中同一页，内容面板 `role="tabpanel"` 用 `aria-labelledby` 指向当前分页。可编辑又有能加的设定组时，横排的行尾、竖排的末尾有“添加一组设定”（菜单打开发 `add-open`，选一项发 `add-component`）。在一页上右键：先选中它，菜单里有“添加一组设定”（下一级是能加的组；有这一项时打开菜单同样发 `add-open`）与这一页是一组设定（`removable`）时的“去掉‘某某’这组设定”。页头、分页与内容同一个上限，内容净宽 760 像素（竖排时另加导航与间距 200）；`wide` 为真、并且滚动区不窄于 944 像素（竖排时 1144）时一起放宽，内容净宽 1496（主文字左右分屏，输出 48）。上限的变化没有过渡（过渡的中途会越过分屏的分界，版式在动画中间跳一下），竖排与横排之间也直接换。根上的 `data-wide` 只表示宿主要两栏，不表示已经放宽。宽度不够时时间点换到下一行。视口宽于 480 像素时页头吸顶；更窄时页头换成几行，吸顶会占掉大半个视口，不吸顶。根元素上有两个 CSS 变量，给要吸在页头下面的东西用（主文字的预览栏、竖排的分页）：`--entry-page-sticky-top` 是页头吸顶时的高度（不吸顶时 0），`--entry-page-viewport` 是滚动区看得到的高度（量不到时不设）。
- “原来选的那一章已经不在了”（`role="status"`）与“这时还没出场”写在时间点左边的标记里，不另起一行推开内容。
- 状态 `loading` 只有一行“读取中…”（`aria-busy`）；`failed`（第一次读取就失败了，例如连不上项目）只有“没有读出来”（`role="alert"`）；`missing` 只有“找不到这个条目”；`deleted` 只有原来的名字与“这个条目已删除”，`editable` 时另有“恢复这个条目”（`editReason` 非空时禁用）。这四种都没有页头控件与分页。

- 时间点后面是“更多”（只有图标的按钮，可读名“更多”）。`editable` 时里面先有“移动到……”，给了 `removableGroup` 时再有“去掉‘某某’这组设定”（`editReason` 非空时这几项不可用）；分隔以后是“删除条目”（危险色；`deletable` 为 false 时不可用）。
- `editable` 时名字与简介本身是按钮（`data-edit="entry.name"`、`data-edit="entry.summary"`；没有简介时写“一句话简介”），悬停与键盘聚焦时浅底加铅笔（铅笔一直占位，只换透明度，不挪字），点了发出带这个按钮的 `edit-name`、`edit-summary`，宿主在它上面开就地改的浮层。下面一行别名标签，各带“×”（可读名“去掉别名 某某”），末尾“添加别名”：点了出一个输入框，回车或失焦时非空就加上（已有的不再加），Escape 放弃。`editReason` 非空时这些按钮禁用、悬停提示是它；`busy` 时别名的加与去不可用。
- 确认条的插槽 `bar` 在页头下面、分页内容上面，各分页共用这一处。页头写入失败的原因不在这里：宿主把它放进浮动提示（`PageNotices`）的失败那一行，不推开内容。

事件：选线发 `update:line`（空串是按章节自动），选位置发 `update:position`，“算上计划”发 `update:planned`，切分页发 `update:tab`，点“是谁”的链接发 `open-entry`，点“重试”发 `retry`，选“删除条目”发 `delete`（确认对话框在宿主里）；点名字、简介发 `edit-name`、`edit-summary`（带被点的按钮），别名发 `aliases`（`{add}` 或 `{remove}`），“更多”的两项发 `move`、`remove-component`，“添加一组设定”发 `add-open` 与 `add-component`（带类型 id），已删除页的“恢复”发 `restore`。对话框与写入都在宿主里。

## 数据

```ts
type EntryPageStatus = "loading" | "failed" | "missing" | "deleted" | "normal";

type EntryPageProps = {
    status: EntryPageStatus;
    name?: string;
    summary?: string;
    sameAs?: {readonly id: string; readonly name: string} | null;
    /** nb-ui `Select` 的选项。 */
    /** “在看”菜单里的章（`positions.ts` 的 `positionChapters`）；默认空。 */
    chapters?: readonly PositionChapter[];
    position?: string;
    planned?: boolean;
    /** 作品里有计划中的情节；默认 false。 */
    canPlan?: boolean;
    /** 页头的写入在途；默认 false。 */
    busy?: boolean;
    /** 在所选位置上还没出场；默认 false。 */
    notAppeared?: boolean;
    positionGone?: boolean;
    /** 位置、线与“按计划”现在不能换的原因（有没提交的主文字）；非空时这三个控件不可用、悬停写原因。默认空。 */
    positionLocked?: string;
    /** 要两栏的宽度（主文字开着预览时）：滚动区放得下两栏才放宽。默认 false。 */
    wide?: boolean;
    disconnected?: boolean;
    /** 世界只读的原因；默认空（可以写）。 */
    readOnly?: string;
    /** 可选的线；默认空（不画线选择）。 */
    lineOptions?: readonly {readonly id: string; readonly name: string | null; readonly depth: number}[];
    /** 窗口在看的线；空串是按章节自动。 */
    line?: string;
    /** 这一页按自己的位置实际读的线；默认主线。 */
    resolvedLine?: string;
    /** nb-ui `Tabs` 的项。 */
    /** 分页（`entry-tabs.ts`）；默认空。 */
    tabs?: readonly EntryTab[];
    /** 能加的设定组；默认空（不出“添加一组设定”）。 */
    addable?: readonly {readonly value: string; readonly label: string}[];
    tab?: string;
    /** “删除条目”可用；默认 false。 */
    deletable?: boolean;
    /** 页头的写入入口都出；默认 false。 */
    editable?: boolean;
    /** 写入入口不可用的原因：入口禁用、悬停提示是它；默认空（可用）。 */
    editReason?: string;
    /** 读取位置上的别名；默认空。 */
    aliases?: readonly string[];
    /** 当前是数据分页时这组设定的名字：“更多”里多一项“去掉这组设定”；默认空。 */
    removableGroup?: string;
};

type EntryPageEmits = {
    "update:position": [value: string];
    "update:planned": [value: boolean];
    "update:tab": [value: string];
    "update:line": [value: string];
    "open-entry": [id: string];
    retry: [];
    delete: [];
    "edit-name": [anchor: HTMLElement];
    "edit-summary": [anchor: HTMLElement];
    aliases: [change: {readonly add?: readonly string[]; readonly remove?: readonly string[]}];
    move: [];
    "add-component": [type: string];
    "add-open": [];
    "remove-component": [];
    restore: [];
};
```

默认插槽是当前分页的内容，放在 `role="tabpanel"` 里；`bar` 插槽在页头之下、分页内容之上，放确认条；`deleted` 插槽只在条目已删除时渲染，在“已删除”与恢复按钮下面，放这个条目还留着的没提交的主文字。

## 状态

见上面四种 `status`、断开与只读。禁用、只读：写入入口不在这里。

## 隐藏通道理由

- `state:inject`：经 `useCanonText()` 取宿主注入的翻译端口（命名空间 `nbook.canon`）。
- `state:local`：量到的三个尺寸（页头的高度、滚动区的高度与宽度）。滚动区是最近的会纵向滚动的上级元素（编辑区的页面容器），本组件用 `ResizeObserver` 量它与页头，不改它。
