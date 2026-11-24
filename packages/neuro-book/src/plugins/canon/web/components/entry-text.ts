/**
 * `EntryText` 的数据：世界服务给作者的渲染里的块（canon.rendering 输出 7）。语法树是 mdast 加 canon 的几种节点
 * （nb-canon 的 `AuthorNode`）；这里只写组件要读的那几个字段，不引 mdast 的类型。
 */

/** 语法树的一个节点：mdast 的节点或 canon 节点。 */
export interface EntryTextNode {
    readonly type: string;
    readonly children?: readonly EntryTextNode[];
    readonly value?: string;
    readonly depth?: number;
    readonly ordered?: boolean | null;
    readonly alt?: string | null;
    /* canon 节点（nb-canon 的 `AuthorNode`） */
    readonly path?: string;
    readonly entry?: string | null;
    readonly label?: string;
    readonly display?: string;
    readonly unknown?: true;
    readonly incomplete?: unknown;
    readonly source?: string;
    readonly reason?: string;
    readonly id?: string;
    readonly name?: string;
    readonly deleted?: boolean;
    readonly caption?: string;
    /** 节点在这一块源文字里的位置（mdast 给的，行从 1 起）；换成 canon 节点的没有。 */
    readonly position?: {readonly start: {readonly line: number}};
}

export type EntryTextBlock =
    | {readonly id: string; readonly tree: EntryTextNode}
    | {readonly id: string; readonly error: {readonly message: string; readonly line?: number; readonly column?: number}; readonly text: string};

/** 文字里一个值指向的地址。 */
export interface TextAddress {
    readonly entry: string;
    readonly path: string;
}

/** 地址的键：条目 id 不含“|”（内核的 id 只有字母、数字与冒号）。 */
export function addressKey(address: TextAddress): string {
    return `${address.entry}|${address.path}`;
}
