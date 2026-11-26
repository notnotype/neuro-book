---
标签: [state:local, state:inject]
别名: ["保存后的提示", "浮动提示", "Page Notices"]
---

# PageNotices

条目页、回执页、变更详情页共用的浮动提示（[`canon/author-ui.md`](../../../../../../../docs/specs/canon/author-ui.md) 输出 18、42）：作者刚保存的那一次、Agent 改了设定、这个页面自己的写入失败，各一行浮在页面下方，盖在内容上，不推开任何东西。受控：显示哪几行、作者的那一行什么时候自己收起，都由宿主（窗口里一份 `notices.ts`）决定；这里只画，把点了什么发出去，并在指针停着、焦点在里面时通过 `hold` 暂停收起。

## 布局

- 组件放在页面根元素的最末：一段至少与一行提示等高、栏更高时跟着栏高的留白（Agent 与作者两行同时在、窄了动作折行时最后几行照样滚得出来），加一个贴着滚动区底边的零高锚点（`position: sticky; bottom`）。提示从锚点往上叠，居中、最宽 640 像素；留白常在，提示出没时页面不动，最后几行能滚到提示上方。
- 从上到下：Agent 的一行（机器人图标、“Agent 改了设定：某某”与“之前还改了 N 次”、查看详情、还原或已还原、看改动记录、关闭），作者的一行（成功色的勾、修订标题与弱一档的“记在第 3 章”（提示带了 `where` 时）、查看详情、还原、关闭），失败的一行（危险色的圈、原因、关闭）。
- 标题单行截断（“记在某处”不截，窄了先截标题），失败原因可以换行；窄了（390 宽）动作换到第二行，靠右。

## 交互

- 每个按钮发对应的事件；“还原”发出时提示留着（宿主打开还原的对话框，成功后换成还原的那一条，对话框关闭时焦点回到“还原”）。
- Agent 那一行还原以后同一个按钮写“已还原”、带 `aria-disabled`、不再发事件（焦点不掉到页面外）。
- 指针进入作者那一行、焦点进入它，各调用一次 `hold()`；离开、焦点移到外面时放开。作者那一行没了（关掉、自己收起）与组件卸载时，放开所有还没放开的暂停（摘掉的行收不到指针离开）。
- 进出：从下面滑上来（`--motion-enter`），收起淡出并下移（`--motion-fast`、`--ease-dialog-leave`）；收起的那一行脱离排布、钉在原处，上面的行随之滑下来（`--motion-move`）；新的一条顶掉旧的时外框不动，标题原地换（`nb-ui-switch`）。
- 读屏：外层 `role="status"` 常在（空的时候也在），新的一行出现会被念到；失败那一行另是 `role="alert"`。

## 数据

```ts
type PageNoticesProps = {
    /** 作者自己刚保存的那一次；缺省 null。 */
    notice?: CanonNotice | null;
    /** Agent 改了设定；缺省 null。 */
    agent?: AgentNotice | null;
    /** 这个页面自己的写入失败的原因；缺省空串（不显示）。 */
    error?: string;
    /** 暂停作者提示自己收起，返回放开的函数；缺省 null（不暂停）。 */
    hold?: (() => () => void) | null;
};
type PageNoticesEmits = {
    (event: "receipt", revision: string): void;
    (event: "undo", notice: CanonNotice): void;
    (event: "revisions"): void;
    (event: "close"): void;
    (event: "close-agent"): void;
    (event: "close-error"): void;
};
```

没有插槽与 expose；attrs 落在根元素（留白那一层）上。

## 注意事项

- 必须是页面根元素的最后一个子元素，根元素要和内容一样高（三个宿主的根是 `min-h-full`），粘性定位才贴得住滚动区的底边。
- 页面里要滚进可见范围的东西（成段的编辑层）用 `scroll-margin-bottom` 给提示让位。

## 隐藏通道理由

`state:inject`：经 `useCanonText()` 取宿主注入的翻译端口（命名空间 `nbook.canon`）。`state:local`：记着哪些暂停还没放开。
