---
标签: [state:local, state:inject, env:portal]
别名: ["主文字编辑", "按块编辑", "Entry Text Editor"]
---

# EntryTextEditor

条目页文字分页的编辑视图（[`canon/author-ui.md`](../../../../../../../docs/specs/canon/author-ui.md) 输出 39、44 到 46）：主文字的每一块一个源文字输入框，可以加一块、从光标处拆开、并到上一块、删掉与恢复；上面一行是未提交几块、暂存的状态与“放弃”“提交”。受控：块的内容、每个动作能不能做、暂存与提交的状态都由宿主给，改动只发事件。

阅读视图是 `EntryText`；宿主在两者之间切换。

## 布局

纵向三部分：

- **状态行**：在最上面，不吸顶（条目页的页头已经吸在滚动区顶上）。左边是未提交的块数、暂存的状态（“已暂存”“没有暂存”等）与“提交”点不了的原因（`submitBlocked`，有改动时才写），右边是一个离开的按钮（有东西可丢时是“放弃”，否则是“取消”）与“提交”。另一个窗口也在改时多两个按钮“用这里的”“换成那边的”；上一次提交结果不明时写“正在确认上一次提交”与“再试”。整批的说明（提交被拒的原因、读不出最新的文字）另起一行，危险色；它出现时状态行滚进视野中间（在长条目的下半截用键盘提交的人要看得到）。
- **块**：按顺序排，每块一个框：框头左边是这一块的来历（“新加的”“剧情改过”），右边是三个动作；下面是输入框；有原因时再下面一行（`role="alert"`）。删掉的块缩成一行“删掉了这一块：开头几个字”与“恢复”。动过的块左边线是警告色，有原因的块边框是危险色。
- **加块的入口**：最前面一个“在最前面加一块”，每块下面一个“在这里加一块”。

宽度由父容器封顶；`390×844` 下结构不变，框头的动作折到第二行。

## 交互

- 输入：发 `update`（块的键与整段文字）。输入框失焦发 `blur`（宿主据此立刻暂存）。
- 加一块、从光标处拆开：发 `add`、`split`（带光标在这一块文字里的偏移；拿不到光标时是文末），宿主给出新块以后焦点进新块。并到上一块：发 `merge`，之后焦点进上一块。
- 不能做的动作：按钮不可用，悬停写原因（`blocked` 里的那一句）。
- “放弃”先问一句（`AlertDialog`），确认才发 `discard`；没有东西可丢（没有改动、读得出块、不在等上一次提交的结局）时是“取消”，直接发 `cancel`，Esc 同它（输入法正在组字时的 Esc 不算）。
- 给焦点时那一块的输入框还没就绪（按需加载的输入框）：记下来，就绪时再给。
- 动效：块的进出、状态行里各项、整批的说明与块下面的原因出现与消失都有过渡，时长与缓动取令牌；输入框里的文字不加。
- 提交在途、等上一次提交的结局时输入框只读、块的动作不可用。
- `frozen`（读不出块）时只列出各块的文字、不能改，能选能复制。

## 数据

```ts
interface EditorBlock {
    key: string;
    text: string;
    /** `gone` 是这一块在世界里已经不在了（等作者在冲突里选）。 */
    state: "same" | "edited" | "new" | "removed" | "gone";
    /** 剧情改过这一块：框头写一句。 */
    story: boolean;
    /** 各动作做不了的原因；空串是能做。`edit` 非空时输入框只读。 */
    blocked: {edit: string; remove: string; split: string; merge: string; add: string};
    /** 这一块下面要写的原因（写得不对、放不进这里）；空串没有。 */
    problem: string;
}

type Props = {
    blocks: readonly EditorBlock[];
    /** 在最前面加一块做不了的原因；空串是能做。 */
    addFirstBlocked: string;
    /** 未提交几块；0 是没有改动。 */
    count: number;
    saved: "none" | "saved" | "unsaved" | "failed" | "too-large" | "diverged";
    phase: "idle" | "submitting" | "confirming";
    /** “提交”不能点的原因（只读、断开……）；空串是能点（还要有改动）。 */
    submitBlocked: string;
    /** 整批的说明；空串没有。 */
    message: string;
    /** 读不出块：只能看与放弃。默认 false。 */
    frozen?: boolean;
    /** 源文字的输入框组件，合同见 `PlainSourceInput.md`；不给时用 `PlainSourceInput`。 */
    input?: Component;
    /** 交给输入框的语言 id；默认 "markdown"（Monaco 的 MDX 配色把花括号里的中文字段名标成错误，不用它）。 */
    language?: string;
};

type Emits = {
    (event: "update", key: string, text: string): void;
    /** 在这一块后面加一块；null 是最前。 */
    (event: "add", after: string | null): void;
    (event: "split", key: string, offset: number): void;
    (event: "merge", key: string): void;
    (event: "remove", key: string): void;
    (event: "restore", key: string): void;
    (event: "blur"): void;
    (event: "submit"): void;
    (event: "discard"): void;
    (event: "cancel"): void;
    (event: "take-over"): void;
    (event: "adopt"): void;
    (event: "retry"): void;
};

type Exposed = {
    /** 把焦点放进这一块的输入框。 */
    focusBlock(key: string): void;
};
```

没有 slots；attrs 落在根上。

## 不支持

- 调换块的顺序。
- 编辑时看值、插入条目引用的入口（源文字里照写 `{表达式}`）。

## 隐藏通道理由

- `state:local`：放弃的确认框开没开、加块以后焦点要去哪一块。
- `state:inject`：经 `useCanonText()` 取翻译端口。
- `env:portal`：放弃的确认框渲染到 nb-ui `AlertDialog` 的 Teleport 目标。
