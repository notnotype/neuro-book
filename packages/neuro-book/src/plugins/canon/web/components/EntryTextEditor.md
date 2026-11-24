---
标签: [state:local, state:inject, env:portal]
别名: ["主文字编辑", "整篇编辑", "Entry Text Editor"]
---

# EntryTextEditor

条目页文字分页的编辑视图（[`canon/author-ui.md`](../../../../../../../docs/specs/canon/author-ui.md) 输出 39、44 到 46）：主文字当一整篇改，一个源文字输入框；上面一行是有没有未提交的修改、暂存的状态、“插入”、“放弃”与“提交”。受控：整篇的文字、暂存与提交的状态都由宿主给，改动只发事件。整篇怎样写回各块（第一块放整篇、其余的块删掉）是宿主的事，这里不分块。

阅读视图是 `EntryText`；宿主在两者之间切换。

## 布局

纵向两部分：

- **状态行**：在最上面，不吸顶（条目页的页头已经吸在滚动区顶上）。左边是“有未提交的修改”（有改动时才写，前面一个圆点）、暂存的状态（“已暂存”“没有暂存”等）与“提交”点不了的原因（`submitBlocked`，有改动时才写；整批的说明里正写着同一句时不重复）。右边依次是“插入”（条目有字段可插时才出）、一个离开的按钮（有东西可丢时是“放弃”，否则是“取消”）与“提交”。另一个窗口也在改时多两个按钮“用这里的”“换成那边的”；上一次提交结果不明时写“正在确认上一次提交”与“再试”。整批的说明（提交被拒的原因、读不出最新的文字）另起一行，危险色；它出现时状态行滚进视野中间（在长条目的下半截用键盘提交的人要看得到）。
- **输入框**：整篇的源文字（Markdown 加 `{表达式}`），外面一个框，聚焦时框线用强调色；内核说写得不对时（`problem`）框线变危险色，输入框下面一行写原因（`role="alert"`）。

宽度由父容器封顶；`390×844` 下结构不变，状态行里按钮多到放不下时按钮换到下一行。

## 交互

- 输入：发 `update`（整篇文字）。输入框失焦发 `blur`（宿主据此立刻暂存）。
- “插入”是一个下拉菜单（nb-ui `DropdownMenu`），项是“设定组 · 字段”（`inserts`）。选了发 `insert`（要写入的写法与光标在整篇里的偏移，拿不到光标时是 `null`，宿主接在末尾），之后焦点回到输入框：菜单开着时焦点不在输入框里，所以光标的位置在打开菜单之前由输入框记着、选的时候再取。
- “放弃”先问一句（`AlertDialog`），确认才发 `discard`；没有东西可丢（没有改动、读得出块、不在等上一次提交的结局）时是“取消”，直接发 `cancel`，Esc 同它（有改动时 Esc 不接，输入法正在组字时的 Esc 也不算）。
- 给焦点（`focus()`）时输入框还没就绪（按需加载的输入框）：记下来，就绪时再给。
- 动效：状态行里各项、整批的说明与输入框下面的原因出现与消失都有过渡，时长与缓动取令牌；输入框里的文字不加。
- 提交在途、等上一次提交的结局时输入框只读、“插入”不可用。
- `frozen`（读不出块）时输入框只读、不出“插入”，能选能复制，只能放弃。

## 数据

“插入”的项类型 `InsertItem` 在 `entry-text-editor.ts`（宿主逻辑也用它）。

```ts
interface InsertItem {
    label: string;
    /** 写进源文字的写法，例如 `{panel.魔力}`；同一个菜单里不重复。 */
    snippet: string;
}

type Props = {
    /** 整篇的源文字，受控。 */
    text: string;
    /** 输入框下面要写的原因（内核说写得不对）；空串没有。 */
    problem: string;
    /** 有没提交的内容。 */
    dirty: boolean;
    saved: "none" | "saved" | "unsaved" | "failed" | "too-large" | "diverged";
    phase: "idle" | "submitting" | "confirming";
    /** “提交”不能点的原因（只读、断开……）；空串是能点（还要有改动）。 */
    submitBlocked: string;
    /** 整批的说明；空串没有。 */
    message: string;
    /** 读不出块：只能看与放弃。默认 false。 */
    frozen?: boolean;
    /** “插入”里列的写法；空数组时不出“插入”。默认空。 */
    inserts?: readonly InsertItem[];
    /** 源文字的输入框组件，合同见 `PlainSourceInput.md`（外露 `focus(caret?)` 与 `cursorOffset()`）；不给时用 `PlainSourceInput`。 */
    input?: Component;
    /** 交给输入框的语言 id；默认 "markdown"（Monaco 的 MDX 配色把花括号里的中文字段名标成错误，不用它）。 */
    language?: string;
};

type Emits = {
    (event: "update", text: string): void;
    /** 在 `offset` 处写入 `snippet`；`offset` 为 null 是取不到光标。 */
    (event: "insert", snippet: string, offset: number | null): void;
    (event: "blur"): void;
    (event: "submit"): void;
    (event: "discard"): void;
    (event: "cancel"): void;
    (event: "take-over"): void;
    (event: "adopt"): void;
    (event: "retry"): void;
};

type Exposed = {
    /** 把焦点放进输入框。 */
    focus(): void;
};
```

没有 slots；attrs 落在根上。

## 不支持

- 分块：块的增、拆、并、删、恢复、调换顺序都没有，提交时整篇写进第一块、其余的块删掉（宿主，见 `EntryPageHost.md`）。
- 编辑时看渲染结果与值：提交以后在阅读视图里看；源文字里照写 `{表达式}`。
- 插入条目引用：“插入”只列本条目各设定组的字段。

## 隐藏通道理由

- `state:local`：放弃的确认框开没开、输入框是不是在等按需加载。
- `state:inject`：经 `useCanonText()` 取翻译端口。
- `env:portal`：放弃的确认框与“插入”菜单渲染到 nb-ui `AlertDialog`、`DropdownMenu` 的 Teleport 目标。
