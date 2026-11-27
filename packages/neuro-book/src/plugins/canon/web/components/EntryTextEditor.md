---
标签: [state:local, state:inject, env:portal, env:timer]
别名: ["主文字编辑", "整篇编辑", "Entry Text Editor"]
---

# EntryTextEditor

条目页文字分页的编辑视图（[`canon/author-ui.md`](../../../../../../../docs/specs/canon/author-ui.md) 输出 39、44 到 46、48）：主文字当一整篇改，富文本（`EntryRichInput`）或源文字的输入框；上面一行状态与动作。受控：整篇的文字、记下的模式、暂存与提交的状态都由宿主给，改动只发事件。整篇怎样写回各块（第一块放整篇、其余的块删掉）是宿主的事，这里不分块。

阅读视图是 `EntryText`；宿主在两者之间切换。

## 布局

纵向两部分：

- **状态行**：在最上面，不吸顶（条目页的页头已经吸在滚动区顶上）。分两区：
  - 右区（`data-text-bar-row="1"`）：“有未提交的修改”（有改动时才写，前面一个圆点）、暂存的状态（“已暂存”“没有暂存”等）、“提交”点不了的原因（`submitBlocked`，有改动时才写；整批的说明里正写着同一句时不重复）、富文本里没应用的小块改动被丢掉时的一句，再是离开的按钮（有东西可丢时是“放弃”，否则是“取消”）与“提交”。另一个窗口也在改时多两个按钮“用这里的”“换成那边的”；上一次提交结果不明时写“正在确认上一次提交”与“再试”。
  - 左区（`data-text-bar-row="2"`）：“插入”（有可插的东西时才出）、“富文本 / 源文字”切换（给了 `rich` 才出，包它的元素带 `data-text-mode`：实际用的模式）、“显示全部分支”（富文本里、文字里有条件时才出，`data-text-branches`），读不进富文本的原因（`data-mode-problem`，警告色）。
  - 本组件不窄于 560 像素时一行：左区在左、右区在右，右区的按钮靠右；左区的控件多了少了（切换模式时“显示全部分支”出现与消失）右区不动。更窄时固定两行：第一行右区，第二行左区。
  - 整批的说明（提交被拒的原因、读不出最新的文字）另起一行，危险色；它出现时状态行滚进视野中间（在长条目的下半截用键盘提交的人要看得到）。
- **输入框**：外面一个框，聚焦时框线用强调色。富文本是 `EntryRichInput`；源文字是 `input`（缺省 `PlainSourceInput`），框上带 `data-text-source`。内核说写得不对时（`problem`）框线变危险色，输入框下面一行写原因（`data-text-problem`，`role="alert"`）；源文字停顿约四分之一秒后在浏览器里检查一遍（`../entry-check.ts`，带 `rich.baseline`），有问题时同样变色，下面一行写第几行、第几列与原因（`data-source-problem`，`data-line`、`data-column`）；`problem` 在时只写它。

宽度由父容器封顶。`390×844` 下状态行是两行。

## 交互

- 输入：发 `update`（整篇文字）。输入框失焦发 `blur`（宿主据此立刻暂存）。
- 模式：实际用的模式是记下的 `mode`，除了两种“这一次落在源文字”：挂上时记下的是富文本、稿却读不进去（`richProblem`：写得不对，或条件在富文本里读不出来），切换旁写“这一版里有写法要先在源文字里改好”；提交被内核拒收（`problem` 出现）时正在富文本里，切到源文字、光标落在浏览器里同一份文法找到的那一处（找不到时在文首）。作者自己切一次就回到照记下的模式。
- 切换：从源文字切回富文本先检查，读不进去不切，切换旁写第几行要改好（或条件读不出来）；作者再改字收起。切过去时光标落在同一段的大致位置：先问旧输入框的 `cursorOffset()`，新输入框就绪后 `focus(偏移)`。记下的模式变了才发 `update:mode`（落在源文字以后再切回富文本，记下的本来就是富文本，不发）。
- “显示全部分支”是一个开关：发 `update:showBranches`，开没开由宿主记。
- “插入”是一个下拉菜单（nb-ui `DropdownMenu`）：给了 `rich` 时是“值”（下一级是“设定组 · 字段”，`inserts`）、“计算”“条件”“条目”（有 `rich.find` 或在源文字里时才出），项的右边写触发键（`{`、`@`）；没有 `rich` 时直接列字段。字段由输入框自己在光标处写入（它的 `insert`：进它的撤销历史、光标落在写法后面，照打字一样发 `update`），之后焦点回到输入框；输入框拒了（检查不过、光标在代码里）就不写；输入框还没就绪时把写法接在整篇末尾发 `update`。富文本里的计算、条件、条目交给输入框的 `openInsert`（开浮层或条目列表，焦点给它们，不拉回输入框）；源文字里写进模板（`INSERT_TEMPLATES`）让作者接着填。
- “放弃”先问一句（`AlertDialog`），确认才发 `discard`；没有东西可丢（没有改动、读得出块、不在等上一次提交的结局）时是“取消”，直接发 `cancel`，Esc 同它（有改动时 Esc 不接，输入法正在组字时的 Esc 也不算）。
- 给焦点（`focus()`）时输入框还没就绪（按需加载的输入框、刚切了模式）：记下来，就绪时再给。
- 动效：状态行里各项、整批的说明、输入框下面的原因出现与消失都有过渡，时长与缓动取令牌；输入框里的文字不加。
- 提交在途、等上一次提交的结局时输入框只读、“插入”不可用。
- `frozen`（读不出块）时输入框只读、不出“插入”，能选能复制，只能放弃。

## 数据

`InsertItem`、`RichContext`、`INSERT_TEMPLATES` 与 `offsetOf` 在 `entry-text-editor.ts`（宿主逻辑也用）。

```ts
interface InsertItem {
    label: string;
    /** 写进源文字的写法，例如 `<V of="panel.魔力" />`；同一个菜单里不重复。 */
    snippet: string;
}

/** 富文本要的东西（`EntryRichInput` 的属性）。`fields`、`marks` 要引用稳定：换了引用输入框会整篇重对值。 */
interface RichContext {
    self: string;
    fields: readonly EntryField[];
    marks: Readonly<Record<string, string>>;
    values: TextValueTable | null;
    computing: boolean;
    find: EntryFind | null;
    baseline: ReadonlySet<string>;
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
    /** “插入”的字段；空数组时没有“值”。默认空。 */
    inserts?: readonly InsertItem[];
    /** 源文字的输入框组件，合同见 `PlainSourceInput.md`（外露 `focus(caret?)`、`insert(text)` 与 `cursorOffset()`）；不给时用 `PlainSourceInput`。 */
    input?: Component;
    /** 交给源文字输入框的语言 id；默认 "markdown"。宿主给 `canon-entry`（`entry-language.ts`）。 */
    language?: string;
    /** 富文本要的东西；默认 null：只有源文字，没有模式切换。 */
    rich?: RichContext | null;
    /** 记下的模式；默认 "rich"。 */
    mode?: "rich" | "source";
    /** 富文本的条件画出全部分支；默认 false。 */
    showBranches?: boolean;
};

type Emits = {
    (event: "update", text: string): void;
    (event: "blur"): void;
    (event: "submit"): void;
    (event: "discard"): void;
    (event: "cancel"): void;
    (event: "take-over"): void;
    (event: "adopt"): void;
    (event: "retry"): void;
    /** 作者切了模式：要记下的模式。 */
    (event: "update:mode", value: "rich" | "source"): void;
    (event: "update:showBranches", value: boolean): void;
};

type Exposed = {
    /** 把焦点放进输入框；`caret` 同输入框的合同。 */
    focus(caret?: "start" | "end" | number): void;
};
```

没有 slots；attrs 落在根上。

## 不支持

- 分块：块的增、拆、并、删、恢复、调换顺序都没有，提交时整篇写进第一块、其余的块删掉（宿主，见 `EntryPageHost.md`）。
- 源文字里的波浪线：问题只写在输入框下面一行（要改编辑器插件 `CodeInput` 的合同，另记后续）。
- “插入”里的图片（要一个选图的对话框，待定）。

## 隐藏通道理由

- `state:local`：放弃的确认框开没开、输入框是不是在等就绪、这一次落在源文字的原因、切回富文本被拦下的原因、源文字检查出的问题、没应用的小块改动被丢掉的那一句。
- `env:timer`：源文字停顿以后再检查（`setTimeout`，同小块取值的停顿）。
- `state:inject`：经 `useCanonText()` 取翻译端口。
- `env:portal`：放弃的确认框与“插入”菜单渲染到 nb-ui `AlertDialog`、`DropdownMenu` 的 Teleport 目标。
