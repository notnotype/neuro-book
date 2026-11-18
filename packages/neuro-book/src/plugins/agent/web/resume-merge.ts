/**
 * 恢复方式“合并一起发”（docs/specs/agent/conversation.md 输出 47、50）：把用户留着的话与这次写的字合成一条。各条按入队顺序，之间空一行；
 * 附件随各自的文字保留，同一个地址只带一次；附件与粘贴块的 `#N` 按提示词文字的写法整体重新编号（nb-markdown 的 `concatPromptTexts`），
 * 不然几条各自从 1 数起的编号会撞上。宿主、会话排的话不进来：它们由内核在合成的那一条前面放行。
 */

import {concatPromptTexts} from "@notnotype/nb-markdown/prompt-text";

export interface MergeAttachment {
    readonly uri: string;
}

export interface MergePart<A extends MergeAttachment> {
    readonly text: string;
    readonly attachments?: readonly A[];
}

/** 要替换的留着的话：`edits` 是读到它时的修改次数，内核据此判断它在这之后有没有被改过（`input-stale`）。 */
export interface HeldPart<A extends MergeAttachment> extends MergePart<A> {
    readonly id: string;
    readonly edits: number;
}

export interface Merged<A extends MergeAttachment> {
    readonly input: {readonly text: string; readonly attachments?: readonly A[]};
    readonly replaces: readonly {readonly id: string; readonly edits: number}[];
}

export function mergeHeld<A extends MergeAttachment>(held: readonly HeldPart<A>[], typed: MergePart<A> | null): Merged<A> {
    const parts: readonly MergePart<A>[] = typed === null ? held : [...held, typed];
    const seen = new Set<string>();
    const attachments = parts.flatMap((part) => part.attachments ?? []).filter((attachment) => {
        if (seen.has(attachment.uri)) return false;
        seen.add(attachment.uri);
        return true;
    });
    return {
        input: attachments.length === 0 ? {text: concatPromptTexts(parts.map((part) => part.text))} : {text: concatPromptTexts(parts.map((part) => part.text)), attachments},
        replaces: held.map((part) => ({id: part.id, edits: part.edits})),
    };
}
