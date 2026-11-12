/**
 * 浮层何时出（docs/specs/workbench/markdown-editing.md 输出 30）：判断的是“进入”，不是“在里面”。在批注中间连打几个字、再按一下
 * 方向键修错字，光标一直在这条批注里，卡片不该弹出来盖住正在写的字。
 *
 * 宿主每次选区变化的事务算一次：把这一刻光标处各条批注的身份（`CommentInfo.identity`）与上一次的集合交给它。只能看选区变化的
 * 事务：刷新引用链接、保持选区的装饰、写回回填也会产生事务，混进来会把“最近一次事务”变成无关的。
 */

export interface CommentEntryEvent {
    /** 这一刻光标处各条批注的身份。 */
    readonly inside: ReadonlyArray<string>;
    readonly selectionEmpty: boolean;
    /** 这次事务改了文档：是输入（或程序改动），不是光标自己走进来。 */
    readonly docChanged: boolean;
    /** 输入法组字中，`view.composing`。 */
    readonly composing: boolean;
}

export interface CommentEntry {
    /** 记下来，下一次作“上一次”用。选区不空时是空集合：选区折回批注里时算进入。 */
    readonly inside: ReadonlySet<string>;
    /** 这一次进入了一条新的批注：卡片该出现。 */
    readonly open: boolean;
    /** 卡片该收起：改了文档、或选区不空（这时出选区菜单）。 */
    readonly close: boolean;
}

export function commentEntry(previous: ReadonlySet<string>, event: CommentEntryEvent): CommentEntry {
    const inside: ReadonlySet<string> = event.selectionEmpty ? new Set(event.inside) : new Set();
    const close = event.docChanged || !event.selectionEmpty;
    const entered = [...inside].some((identity) => !previous.has(identity));
    return {inside, close, open: !close && !event.composing && entered};
}
